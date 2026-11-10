// Real Chromium/Edge end-to-end check, NO mocked DOM and NO GPU required.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createServer} from "node:http";
import {readFile,mkdtemp,rm,access} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve,extname} from "node:path";
import {setTimeout as sleep} from "node:timers/promises";
import {fileURLToPath} from "node:url";

const root=fileURLToPath(new URL(".",import.meta.url));
const candidates=process.platform==="win32"?[
  join(process.env.PROGRAMFILES||"C:\\Program Files","Google","Chrome","Application","chrome.exe"),
  join(process.env["PROGRAMFILES(X86)"]||"C:\\Program Files (x86)","Microsoft","Edge","Application","msedge.exe"),
  join(process.env.PROGRAMFILES||"C:\\Program Files","Microsoft","Edge","Application","msedge.exe")
]:["/usr/bin/chromium","/usr/bin/google-chrome","/usr/bin/chromium-browser"];
let binary;
for(const c of candidates){try{await access(c);binary=c;break}catch{}}
if(!binary)throw Error("Chrome or Edge is needed for real browser bootstrap validation.");
const mime={".html":"text/html",".js":"application/javascript",".css":"text/css",
  ".hlsl":"text/plain",".md":"text/plain"};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url||"/","http://127.0.0.1");
  if(url.pathname.startsWith("/api/session/")){
    res.writeHead(200,{"Content-Type":"application/json"});
    res.end(JSON.stringify({token:"browser-test",ok:true}));return;
  }
  const name=url.pathname==="/"? "index.html":decodeURIComponent(url.pathname.slice(1));
  if(!/^[\w./-]+$/.test(name)||name.includes("..")){
    res.writeHead(403);res.end();return;
  }
  try{
    const bytes=await readFile(resolve(root,name));
    res.writeHead(200,{"Content-Type":mime[extname(name)]||"application/octet-stream"});
    res.end(bytes);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const url="http://127.0.0.1:"+server.address().port+"/";
const dir=await mkdtemp(join(tmpdir(),"hlsl-browser-"));
const child=spawn(binary,[
  "--headless=new","--no-first-run","--no-default-browser-check",
  "--disable-extensions","--disable-background-networking","--no-sandbox",
  "--disable-gpu","--disable-dev-shm-usage","--disable-breakpad",
  "--remote-debugging-port=0","--user-data-dir="+dir,"about:blank"
],{stdio:"ignore",windowsHide:true});
let socket;
try{
  let port=0;
  for(let i=0;i<400;i++){
    if(child.exitCode!==null)throw Error("Browser exited on startup: "+child.exitCode);
    try{port=Number((await readFile(join(dir,"DevToolsActivePort"),"utf8")).split(/\r?\n/)[0]);}catch{}
    if(port)break;
    await sleep(100);
  }
  assert.ok(port,"Browser DevToolsActivePort was never created.");
  const pages=await (await fetch("http://127.0.0.1:"+port+"/json/list")).json();
  const page=pages.find(x=>x.type==="page");
  assert.ok(page,"Chrome did not create a debug page.");
  socket=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error("WebSocket timeout")),8000);
    socket.addEventListener("open",()=>{clearTimeout(timer);resolve()},{once:true});
    socket.addEventListener("error",e=>{clearTimeout(timer);reject(e)},{once:true});
  });
  const pending=new Map(),failures=[];let id=0;
  socket.addEventListener("message",e=>{
    const m=JSON.parse(String(e.data));
    if(m.id&&pending.has(m.id)){
      const {resolve,reject}=pending.get(m.id);pending.delete(m.id);
      if(m.error)reject(Error(m.error.message));else resolve(m.result);
    }else if(m.method==="Runtime.exceptionThrown"){
      failures.push(m.params.exceptionDetails.text+" "+(m.params.exceptionDetails.exception?.description||""));
    }
  });
  const command=(method,params={})=>new Promise((resolve,reject)=>{
    const n=++id;pending.set(n,{resolve,reject});
    socket.send(JSON.stringify({id:n,method,params}));
  });
  const evaluate=async expression=>{
    const r=await command("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
    return r.result.value;
  };
  await command("Runtime.enable");
  await command("Page.enable");
  await command("Page.navigate",{url});
  let ready=false;
  for(let i=0;i<100;i++){
    ready=await evaluate('document.readyState==="complete" && !!window.HLSLAnimation && !!window.HLSLRunnerAPI');
    if(ready)break;
    await sleep(100);
  }
  assert.ok(ready,"Main page and animation script did not load.");
  const startup=await evaluate('({src:document.getElementById("code").value,selected:document.getElementById("example-julia").getAttribute("aria-pressed"),spec:(()=>{try{return JSON.stringify(window.HLSLRunnerAPI.parseManifest())}catch(e){return "ERROR: "+e.message}})(),manifest:document.getElementById("bindings").value})');
  console.log("BOOT-DIAGNOSTIC",JSON.stringify({sourceHead:startup.src.slice(0,180),selected:startup.selected,spec:startup.spec.slice(0,450),manifest:startup.manifest.slice(0,180),exceptions:failures}));
  assert.match(startup.src,/FractalColor/,"The Julia shader MUST appear at startup, not the legacy physics shader.");
  assert.match(startup.src,/RWStructuredBuffer<float4> Framebuffer/);
  assert.equal(startup.selected,"true");
  const parsed=JSON.parse(startup.spec);
  assert.equal(parsed.autoFramebuffer,true);
  assert.equal(parsed.resources[0].visualize.mode,"grid-rgba");
  assert.ok(!JSON.parse(startup.manifest).animation,"No animation JSON should be present.");

  const particle=await evaluate('(()=>{document.getElementById("restore-example").click();return {src:document.getElementById("code").value,automatic:window.HLSLRunnerAPI.parseManifest().autoFramebuffer,selected:document.getElementById("restore-example").getAttribute("aria-pressed")};})()');
  assert.match(particle.src,/float3 particle/,"GPU particles preset did not load its full-color HLSL.");
  assert.equal(particle.selected,"true");
  assert.equal(particle.automatic,true);

  const restored=await evaluate('(()=>{document.getElementById("example-julia").click();document.getElementById("gravity").value="2.3";document.getElementById("gravity").dispatchEvent(new Event("input"));return {src:document.getElementById("code").value,selected:document.getElementById("example-julia").getAttribute("aria-pressed")};})()');
  assert.match(restored.src,/FractalColor/,"Changing the separate sandbox must not overwrite the live HLSL shader.");
  assert.equal(restored.selected,"true");
  const folded=await evaluate(`(() => {
    const view=window.HLSLFoldDocs?.editor;
    const source=document.getElementById("code");
    const dom=document.querySelector(".editor-frame > .CodeMirror");
    const find=window.HLSLFoldDocs?.getFoldRange;
    return {
      enabled:!!view,
      cmVisible:!!dom && getComputedStyle(dom).display!=="none",
      lineNumbers:!!dom?.querySelector(".CodeMirror-linenumbers"),
      gutter:!!dom?.querySelector(".CodeMirror-foldgutter"),
      noCards:document.querySelectorAll(".code-section, #code-sections").length===0,
      same:!!view && view.getValue()===source.value,
      folds:[...Array(view?.lineCount()||0).keys()].filter(n=>!!find(n)).length,
      docs:!!window.HLSLDocs?.get("float4")
    };
  })()`);
  assert.equal(folded.enabled,true,"CodeMirror editor did not initialize.");
  assert.equal(folded.cmVisible,true,"One live code editor must be visible.");
  assert.equal(folded.lineNumbers,true,"VS Code-style line-number gutter is required.");
  assert.equal(folded.gutter,true,"In-place folding gutter is required.");
  assert.equal(folded.noCards,true,"Old independent collapsible code cards must be gone.");
  assert.equal(folded.same,true,"Compilation must use the exact editable CodeMirror source.");
  assert.ok(folded.folds>=2,"Functions and cbuffer must have foldable brace ranges.");
  assert.equal(folded.docs,true);

  const foldAndHelp=await evaluate(`(() => {
    const view=window.HLSLFoldDocs.editor,original=view.getValue();
    document.getElementById("fold-all").click();
    const marks=view.getAllMarks().filter(m=>m.__isFold).length;
    const widgets=document.querySelectorAll(".CodeMirror-foldmarker").length;
    const fullPreserved=document.getElementById("code").value===original;
    document.getElementById("unfold-all").click();
    const unfolded=view.getAllMarks().filter(m=>m.__isFold).length;
    const hover=window.HLSLFoldDocs.showHelp("float4");
    const tip=document.getElementById("hlsl-help-tooltip");
    return {
      marks,widgets,fullPreserved,unfolded,hover,
      tooltipVisible:!tip.hidden,
      what:document.getElementById("hlsl-help-what").textContent,
      use:document.getElementById("hlsl-help-use").textContent,
      example:document.getElementById("hlsl-help-example").textContent,
      separateExample:!!tip.querySelector("pre.doc-example > code"),
      href:document.getElementById("hlsl-help-link").getAttribute("href")
    };
  })()`);
  assert.ok(foldAndHelp.marks>0&&foldAndHelp.widgets>0,
    "Fold all must hide ranges IN the editor behind inline markers.");
  assert.equal(foldAndHelp.fullPreserved,true,"Folding must not modify compiled HLSL.");
  assert.equal(foldAndHelp.unfolded,0,"Unfold all must restore all hidden lines.");
  assert.equal(foldAndHelp.hover,true);
  assert.equal(foldAndHelp.tooltipVisible,true);
  assert.ok(foldAndHelp.what&&foldAndHelp.use);
  assert.match(foldAndHelp.example,/float4/);
  assert.equal(foldAndHelp.separateExample,true);
  assert.equal(foldAndHelp.href,"hlsl-reference.html#float4");

  const pinnedHelp=await evaluate(`(() => {
    const cm=window.HLSLFoldDocs.editor;
    let line=-1,col=-1;
    for(let i=0;i<cm.lineCount();i++){
      const n=cm.getLine(i).indexOf("float4");
      if(n>=0){line=i;col=n+2;break;}
    }
    const coords=cm.charCoords({line,ch:col},"window");
    const event=new MouseEvent("contextmenu",{
      bubbles:true,cancelable:true,button:2,buttons:2,
      clientX:coords.left,clientY:coords.top+3
    });
    cm.getWrapperElement().dispatchEvent(event);
    const tooltip=document.getElementById("hlsl-help-tooltip");
    const pinned=window.HLSLFoldDocs.helpPinned;
    const suppressed=event.defaultPrevented;
    const visible=!tooltip.hidden;
    const selectable=getComputedStyle(tooltip).userSelect!=="none" &&
      getComputedStyle(tooltip).pointerEvents!=="none";
    const anchor=tooltip.querySelector("a");
    const link=anchor?.getAttribute("href")||"";
    tooltip.dispatchEvent(new MouseEvent("mouseenter"));
    cm.getWrapperElement().dispatchEvent(new MouseEvent("mouseleave",{bubbles:false}));
    const stillVisible=!tooltip.hidden;
    tooltip.dispatchEvent(new MouseEvent("contextmenu",{cancelable:true}));
    const stillPinned=window.HLSLFoldDocs.helpPinned;
    window.HLSLFoldDocs.dismissHelp();
    return {pinned,suppressed,visible,selectable,link,stillVisible,stillPinned,
      dismissed:tooltip.hidden};
  })()`);
  assert.equal(pinnedHelp.pinned,true,"Right-click on HLSL token must pin documentation.");
  assert.equal(pinnedHelp.suppressed,true,"Right-click should prevent the browser context menu.");
  assert.equal(pinnedHelp.visible,true,"Right-click must show documentation.");
  assert.equal(pinnedHelp.selectable,true,"Docs must allow text selection and clicks.");
  assert.match(pinnedHelp.link,/hlsl-reference\.html#/,"Docs link should be navigable.");
  assert.equal(pinnedHelp.stillVisible,true,"Moving from token to tooltip must not dismiss it.");
  assert.equal(pinnedHelp.stillPinned,true,"Tooltip right-click should preserve pin.");
  assert.equal(pinnedHelp.dismissed,true,"Pinned help must have an explicit dismiss action.");

  const editing=await evaluate(`(() => {
    const view=window.HLSLFoldDocs.editor;
    const before=view.getValue();
    view.replaceRange("// LIVE EDIT VIA CODEMIRROR\\n",{line:0,ch:0});
    const changed=view.getValue();
    return {
      changed:changed.startsWith("// LIVE EDIT VIA CODEMIRROR"),
      synced:document.getElementById("code").value===changed,
      compiled:window.HLSLRunnerAPI.editor.value===changed,
      preserved:changed.includes("FractalColor"),
      notes:document.querySelectorAll(".code-section").length,
      beforeLength:before.length,afterLength:changed.length
    };
  })()`);
  assert.equal(editing.changed,true,"In-editor typing must change CodeMirror text.");
  assert.equal(editing.synced,true,"Editor edits must sync to the canonical textarea.");
  assert.equal(editing.compiled,true,"DXC must compile the edited complete source.");
  assert.equal(editing.preserved,true,"Folding/editor changes must not destroy shader functions.");
  assert.equal(editing.notes,0,"There must be no detached code cards.");

  const reload=await evaluate(`(() => {
    document.getElementById("example-julia").click();
    const source=document.getElementById("code").value;
    return {
      sourceRestored:!source.includes("LIVE EDIT VIA CODEMIRROR"),
      synchronized:source===window.HLSLFoldDocs.editor.getValue(),
      foldable:!!window.HLSLFoldDocs.getFoldRange(5)
    };
  })()`);
  assert.equal(reload.sourceRestored,true,"Switching presets must replace editor source.");
  assert.equal(reload.synchronized,true,"Preset swap must synchronize CodeMirror and compiler.");
  assert.equal(reload.foldable,true,"Folding gutter must work after preset replacement.");
  const completion=await evaluate(`(() => {
    const view=window.HLSLFoldDocs.editor;
    const api=window.HLSLIntelliSense;
    const result={attached:!!api};
    if(!api)return result;
    const last=view.lastLine(),end=view.getLine(last).length;
    view.replaceRange("\\nfloat result = smoo",{line:last,ch:end});
    view.setCursor(view.lastLine(),view.getLine(view.lastLine()).length);
    api.complete();
    result.open=api.popupOpen;
    result.hasPopup=!!document.querySelector(".CodeMirror-hints");
    result.hasSmoothstep=api.suggestions.some(item=>item.name==="smoothstep");
    const option=[...document.querySelectorAll(".CodeMirror-hint")]
      .find(el=>el.textContent.includes("smoothstep"));
    result.optionVisible=!!option;
    if(option){
      option.click();
      result.accepted=view.getValue().includes("float result = smoothstep()");
      result.synced=view.getValue()===document.getElementById("code").value;
      result.parameter=api.signature?.name;
      result.argument=api.signature?.active;
      result.signatureVisible=!document.getElementById("hlsl-signature-help").hidden;
    }
    return result;
  })()`);
  assert.equal(completion.attached,true,"HLSL IntelliSense did not attach to CodeMirror.");
  assert.equal(completion.open,true,"Ctrl+Space completion model did not open.");
  assert.equal(completion.hasPopup,true,"No real completion dropdown shown in Chromium.");
  assert.equal(completion.hasSmoothstep,true,"Expected intrinsic in completion model.");
  assert.equal(completion.optionVisible,true,"Expected intrinsic suggestion in actual DOM.");
  assert.equal(completion.accepted,true,"Clicking completion did not insert function().");
  assert.equal(completion.synced,true,"Accepted completion must update the compiled HLSL source.");
  assert.equal(completion.parameter,"smoothstep","Function signature help missing after completion.");
  assert.equal(completion.argument,0,"Signature help should start at argument 1.");
  assert.equal(completion.signatureVisible,true,"Function signature tooltip must be visible.");

  const localCompletion=await evaluate(`(() => {
    const ed=window.HLSLFoldDocs.editor,api=window.HLSLIntelliSenseEngine;
    const result=api.suggest(ed.getValue()+"\\nFractalC",{line:ed.lineCount(),ch:8},true);
    const names=result.items.map(x=>x.name);
    const vec=api.suggest(ed.getValue()+"\\nfloat3 shade;\\nshade.r",
      {line:ed.lineCount()+1,ch:7},true);
    return {hasLocal:names.includes("FractalColor"),
      hasRgb:vec.items.some(x=>x.name==="rgb"),
      hasRgba:vec.items.some(x=>x.name==="rgba")};
  })()`);
  assert.equal(localCompletion.hasLocal,true,"User-defined function should be suggested.");
  assert.equal(localCompletion.hasRgb,true,"float3 member completion should suggest rgb.");
  assert.equal(localCompletion.hasRgba,false,"float3 member completion must not invent rgba.");

  const reference=await fetch(url+"hlsl-reference.html");
  assert.equal(reference.status,200);
  assert.match(await reference.text(),/HLSL quick reference/);
  assert.deepEqual(failures,[],"Uncaught browser exceptions during startup and preset switching.");
  console.log("PASS Chromium: presets, in-editor gutter folds, hover HLSL docs, separate examples, CodeMirror edits, completion, function signatures and full-source compilation and no uncaught exceptions.");
}finally{
  try{socket?.close()}catch{}
  try{child.kill()}catch{}
  await new Promise(resolve=>server.close(resolve));
  try{await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200})}catch{}
}