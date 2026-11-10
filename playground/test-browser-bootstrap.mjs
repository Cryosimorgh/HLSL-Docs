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
  "--disable-gpu","--remote-debugging-port=0","--user-data-dir="+dir,"about:blank"
],{stdio:"ignore",windowsHide:true});
let socket;
try{
  let port=0;
  for(let i=0;i<150;i++){
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
  const startup=await evaluate('({src:document.getElementById("code").value,selected:document.getElementById("example-julia").getAttribute("aria-pressed"),automatic:window.HLSLRunnerAPI.parseManifest().autoFramebuffer,mode:window.HLSLRunnerAPI.parseManifest().resources[0].visualize.mode,manifest:document.getElementById("bindings").value})');
  assert.match(startup.src,/FractalColor/,"The Julia shader MUST appear at startup, not the legacy physics shader.");
  assert.match(startup.src,/RWStructuredBuffer<float4> Framebuffer/);
  assert.equal(startup.selected,"true");
  assert.equal(startup.automatic,true);
  assert.equal(startup.mode,"grid-rgba");
  assert.ok(!JSON.parse(startup.manifest).animation,"No animation JSON should be present.");

  const particle=await evaluate('(()=>{document.getElementById("restore-example").click();return {src:document.getElementById("code").value,automatic:window.HLSLRunnerAPI.parseManifest().autoFramebuffer,selected:document.getElementById("restore-example").getAttribute("aria-pressed")};})()');
  assert.match(particle.src,/float3 particle/,"GPU particles preset did not load its full-color HLSL.");
  assert.equal(particle.selected,"true");
  assert.equal(particle.automatic,true);

  const restored=await evaluate('(()=>{document.getElementById("example-julia").click();document.getElementById("gravity").value="2.3";document.getElementById("gravity").dispatchEvent(new Event("input"));return {src:document.getElementById("code").value,selected:document.getElementById("example-julia").getAttribute("aria-pressed")};})()');
  assert.match(restored.src,/FractalColor/,"Changing the separate sandbox must not overwrite the live HLSL shader.");
  assert.equal(restored.selected,"true");
  assert.deepEqual(failures,[],"Uncaught browser exceptions during startup and preset switching.");
  console.log("PASS Chromium: Julia source at startup, manifestless RGBA, GPU particles switch, no silent source overwrite.");
}finally{
  try{socket?.close()}catch{}
  try{child.kill()}catch{}
  await new Promise(resolve=>server.close(resolve));
  try{await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200})}catch{}
}