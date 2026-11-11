// Native desktop file integration. Associated .hlsl files arrive via an opaque
// document ID; browser JavaScript never gets arbitrary filesystem access.
(() => {
  "use strict";
  const $=id=>document.getElementById(id);
  const source=$("code"),fileLabel=$("desktop-file-label"),saveButton=$("save-file"),
    chooseButton=$("open-file"),filePicker=$("desktop-file-picker");
  const params=new URLSearchParams(location.search);
  let active=null, cleanSource="", importedName="", saving=false;
  function content(){return window.HLSLFoldDocs?.editor?.getValue()??source.value;}
  function title(){
    const modified=!!(active||importedName)&&content()!==cleanSource;
    const name=active?.name||importedName||"Untitled.hlsl";
    fileLabel.textContent=(modified?"● ":"")+name;
    fileLabel.title=active?(active.path||active.name):"Use Open to import a shader; Save As downloads a copy";
    saveButton.disabled=saving;
    document.title=name+" — Sunder HLSL Workbench";
  }
  function applySource(value){
    window.HLSLAnimation?.stop();
    source.value=value;
    source.dataset.dirty="1";
    window.HLSLHighlight?.refresh();
    source.dispatchEvent(new Event("input",{bubbles:true}));
    window.HLSLFoldDocs?.editor?.refresh();
    window.HLSLRunnerAPI?.setActivePreset("");
  }
  function detach(){active=null;importedName="";cleanSource="";title()}
  function notify(message,error=false){window.HLSLRunnerAPI?.setStatus(message,error)}
  async function loadAssociated(id){
    try{
      const response=await fetch("/api/documents/"+encodeURIComponent(id),{cache:"no-store"});
      const data=await response.json();
      if(!response.ok)throw Error(data.error||"Unable to read shader");
      active={id:data.id,name:data.name,baseline:data.baseline};importedName="";
      applySource(data.source);
      cleanSource=content();
      title();
      notify("Opened "+active.name+" · shader not compiled or executed. Ctrl+S saves to the original file.");
      window.HLSLFoldDocs?.editor?.focus();
    }catch(e){notify("Could not open associated shader: "+e.message,true)}
  }
  async function save(){
    if(!active){$("download")?.click();return}
    if(saving)return;
    saving=true;saveButton.disabled=true;
    try{
      const updated=content(),response=await fetch("/api/documents/"+encodeURIComponent(active.id),{
        method:"PUT",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({source:updated,baseline:active.baseline})
      });
      const result=await response.json();
      if(!response.ok)throw Error(result.error||"Save failed");
      active.baseline=result.baseline;cleanSource=updated;
      notify("Saved "+active.name+" to disk.");
    }catch(e){notify("Save failed: "+e.message+". Use Save .hlsl to export a copy.",true)}
    finally{saving=false;title()}
  }
  saveButton.addEventListener("click",()=>{void save()});
  document.addEventListener("keydown",event=>{
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="s"){
      event.preventDefault();event.stopPropagation();void save();
    }
  },true);
  // File picker allows opening any local HLSL source without elevated native
  // privileges. The browser sandbox cannot overwrite that file; use Save .hlsl.
  chooseButton.addEventListener("click",()=>filePicker.click());
  filePicker.addEventListener("change",async()=>{
    const file=filePicker.files?.[0];if(!file)return;
    filePicker.value="";
    if(!/\.(hlsl|hlsli)$/i.test(file.name)||file.size>65536){notify("Choose a .hlsl/.hlsli file of at most 64 KiB.",true);return}
    if((active||importedName)&&content()!==cleanSource&&!confirm("Discard unsaved edits to "+(active?.name||importedName)+"?"))return;
    const value=await file.text();
    detach();importedName=file.name;applySource(value);cleanSource=content();title();
    notify("Imported "+file.name+" · use Save .hlsl to export a copy.");
  });
  source.addEventListener("input",()=>{if(active||importedName)title()});
  window.HLSLFoldDocs?.editor?.on("change",()=>{if(active||importedName)title()});
  // Switching examples must detach the on-disk file first, otherwise Ctrl+S
  // could inadvertently overwrite a real shader with demo code.
  for(const button of document.querySelectorAll(".preset-button")){
    button.addEventListener("click",event=>{
      if(!active)return;
      if(content()!==cleanSource&&!confirm("Discard unsaved edits to "+active.name+"?")){
        event.preventDefault();event.stopImmediatePropagation();return;
      }
      detach();
      history.replaceState(null,"",location.pathname);
    },true);
  }
  window.addEventListener("beforeunload",event=>{
    if(active&&content()!==cleanSource){event.preventDefault();event.returnValue=""}
  });
  const newTemplate=[
    "// New HLSL framebuffer shader · change the RGB expression to begin.",
    "#define WORKBENCH_WIDTH 256",
    "#define WORKBENCH_HEIGHT 256",
    "cbuffer WorkbenchFrame : register(b7) {",
    "    float Time, DeltaTime, Width, Height;",
    "    float Frame, Padding0, Padding1, Padding2;",
    "};",
    "RWStructuredBuffer<float4> Framebuffer : register(u0);",
    "[numthreads(8, 8, 1)]",
    "void CSMain(uint3 tid : SV_DispatchThreadID) {",
    "    if (tid.x >= WORKBENCH_WIDTH || tid.y >= WORKBENCH_HEIGHT) return;",
    "    uint i = tid.y * WORKBENCH_WIDTH + tid.x;",
    "    float2 uv = (float2(tid.xy) + 0.5) / float2(WORKBENCH_WIDTH, WORKBENCH_HEIGHT);",
    "    Framebuffer[i] = float4(uv.x, uv.y, 0.5 + 0.5*sin(Time), 1.0);",
    "}",""]; 
  function newDocument(){
    if((active||importedName)&&content()!==cleanSource&&!confirm("Discard unsaved changes and create a new shader?"))return false;
    detach();applySource(newTemplate.join("\n"));cleanSource=content();title();
    notify("New shader ready. Compile with F5 or animate with F6.");
    window.HLSLFoldDocs?.editor?.focus();
    return true;
  }
  window.HLSLDesktopFiles={save,newDocument,detach,get activeFile(){return active?.name||importedName||null},
    get dirty(){return !!(active||importedName)&&content()!==cleanSource}};
  title();
  const id=params.get("document");
  if(id&&/^[0-9a-f]{24}$/.test(id))void loadAssociated(id);
})();
