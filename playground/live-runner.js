// Editable HLSL compute -> DXC SPIR-V -> Naga WGSL -> real browser WebGPU.
// The separate offline physics animation is still a JavaScript teaching model.
(() => {
"use strict";
const $ = id => document.getElementById(id);
const editor = $("code"), manifestArea = $("bindings"), status = $("compile-status"),
      results = $("gpu-output"), wgslArea = $("wgsl-output"), runButton = $("run-gpu");
const maxBytes = 4*1024*1024, maxTotal = 8*1024*1024, maxGroups = 1024;
const isBridgeOrigin = /^http:\/\/127\.0\.0\.1:\d+$/.test(location.origin);
function setStatus(message,error=false) {
  status.textContent=message; status.style.color=error?"#ffa8a8":"#9ce3ff";
}
function defaultManifest() {
  return {entry:"CSMain",dispatch:"auto",resources:[
    {binding:0,access:"read",preset:"particles"},
    {binding:16,access:"read_write",byteLength:"particles",inspect:true,display:"vec4",applyToCanvas:true},
    {binding:32,access:"uniform",preset:"parameters"}
  ]};
}
manifestArea.value=JSON.stringify(defaultManifest(),null,2);
function parseManifest() {
  let p;
  try{p=JSON.parse(manifestArea.value)}catch(e){throw Error("Invalid bindings JSON: "+e.message)}
  if (!p || Array.isArray(p) || typeof p!=="object") throw Error("Expected a bindings JSON object.");
  if (!/^[A-Za-z_]\w{0,63}$/.test(p.entry||"")) throw Error("Invalid HLSL entry point.");
  if (!Array.isArray(p.resources) || p.resources.length<1 || p.resources.length>12)
    throw Error("Declare 1-12 buffer resources.");
  const seen=new Set();
  for(const r of p.resources) {
    if(!r || !Number.isInteger(r.binding) || r.binding<0 || r.binding>127 ||
       seen.has(r.binding)) throw Error("Invalid/duplicate binding index.");
    seen.add(r.binding);
    if(!["read","read_write","uniform"].includes(r.access)) throw Error("Invalid resource access.");
    if(r.preset && !["particles","parameters"].includes(r.preset)) throw Error("Invalid resource preset.");
    if(r.dataType && !["f32","u32","i32"].includes(r.dataType)) throw Error("Invalid dataType.");
    if(r.display && !["f32","u32","i32","vec4"].includes(r.display)) throw Error("Invalid display format.");
  }
  if(p.dispatch!=="auto" && (!Array.isArray(p.dispatch) || p.dispatch.length!==3 ||
     !p.dispatch.every(n=>Number.isInteger(n)&&n>=1&&n<=maxGroups)))
    throw Error('dispatch must be "auto" or [x,y,z] in 1..1024.');
  return p;
}
function physicsParams() {
  const c=window.HLSLPlayground.config(), bytes=new ArrayBuffer(32), v=new DataView(bytes);
  // HLSL cbuffer packing: dt,gravity,bounce,drag at 0..15;
  // count as u32 at byte 16; radius,worldWidth,pad at 20,24,28.
  [c.dt,c.gravity,c.bounce,c.drag].forEach((x,i)=>v.setFloat32(i*4,x,true));
  v.setUint32(16,c.count,true);v.setFloat32(20,c.radius,true);
  v.setFloat32(24,c.worldWidth,true);
  return new Uint8Array(bytes);
}
function particles() {
  const b=window.HLSLPlayground.particles(),a=new Float32Array(b.length*4);
  b.forEach((p,i)=>a.set([p.x,p.y,p.vx,p.vy],i*4));
  return new Uint8Array(a.buffer);
}
function bytesFor(r) {
  if(r.preset==="particles")return particles();
  if(r.preset==="parameters")return physicsParams();
  if(r.byteLength!==undefined) {
    const n=r.byteLength==="particles"?window.HLSLPlayground.config().count*16:r.byteLength;
    if(!Number.isInteger(n)||n<4||n>maxBytes||n%4)throw Error("Invalid buffer size for binding "+r.binding);
    return new Uint8Array(n);
  }
  if(Array.isArray(r.data)) {
    if(!r.data.length||r.data.length*4>maxBytes||!r.data.every(Number.isFinite))
      throw Error("Input data must be a nonempty finite-number array under 4 MiB.");
    const a=new ArrayBuffer(r.data.length*4),v=new DataView(a),type=r.dataType||"f32";
    r.data.forEach((x,i)=>{
      if(type==="f32")v.setFloat32(i*4,x,true);
      else {
        if(!Number.isInteger(x)||(type==="u32"?(x<0||x>4294967295):(x<-2147483648||x>2147483647)))
          throw Error("Out-of-range 32-bit integer in binding "+r.binding);
        if(type==="u32")v.setUint32(i*4,x,true);else v.setInt32(i*4,x,true);
      }
    });
    return new Uint8Array(a);
  }
  throw Error("Binding "+r.binding+": define preset, byteLength or data array.");
}
function showBuffer(bytes,kind) {
  const dv=new DataView(bytes),words=Math.min(bytes.byteLength/4,128);
  if(kind==="vec4") {
    const lines=[];
    for(let i=0;i+3<words;i+=4)
      lines.push("#"+(i/4)+": "+[0,1,2,3].map(j=>Number(dv.getFloat32((i+j)*4,true).toPrecision(6))).join(", "));
    return lines.join("\n")+(words<bytes.byteLength/4?"\n…truncated":"");
  }
  const items=[];
  for(let i=0;i<words;i++){
    const x=kind==="u32"?dv.getUint32(i*4,true):kind==="i32"?dv.getInt32(i*4,true):dv.getFloat32(i*4,true);
    items.push(kind==="f32"?Number(x.toPrecision(7)):x);
  }
  return JSON.stringify(items)+(words<bytes.byteLength/4?"\n…truncated":"");
}
function compiledEntry(wgsl) {
  const m=wgsl.match(/@compute\b[\s\S]{0,600}?\bfn\s+([A-Za-z_]\w*)\s*\(/);
  if(!m)throw Error("WGSL converter did not output a compute entry point.");
  return m[1];
}
function compiledSize(wgsl) {
  const m=wgsl.match(/@workgroup_size\s*\(\s*(\d+)(?:\s*,\s*(\d+))?(?:\s*,\s*(\d+))?\s*\)/);
  if(!m)throw Error("Cannot determine compiled @workgroup_size.");
  return [Number(m[1]),Number(m[2]||1),Number(m[3]||1)];
}
async function run(){
  if(!isBridgeOrigin)throw Error("Start the local compiler: node playground/server.mjs, then open http://127.0.0.1:4173/");
  if(!navigator.gpu)throw Error("No WebGPU support. Use a compatible Chromium/Edge browser and GPU.");
  const spec=parseManifest(),source=editor.value;
  if(!source||source.length>65536)throw Error("HLSL source must be 1-65536 characters.");
  setStatus("Compiling HLSL using DXC, then converting SPIR-V to WGSL…");
  results.textContent="";wgslArea.textContent="";
  const response=await fetch("/api/compile",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({source,entry:spec.entry}),signal:AbortSignal.timeout(35000)});
  const result=await response.json();
  if(!response.ok)throw Error(result.error||"Compilation failed.");
  const wgsl=result.wgsl;
  wgslArea.textContent=wgsl;
  const entry=compiledEntry(wgsl),size=compiledSize(wgsl);
  const dispatch=spec.dispatch==="auto"?
    [Math.ceil(window.HLSLPlayground.config().count/size[0]),1,1]:spec.dispatch;
  if(dispatch.some(x=>!Number.isInteger(x)||x<1||x>maxGroups))throw Error("Dispatch exceeds tutorial limits.");
  const adapter=await navigator.gpu.requestAdapter();
  if(!adapter)throw Error("No WebGPU adapter available.");
  if(dispatch.some((x,i)=>x>adapter.limits.maxComputeWorkgroupsPerDimension))
    throw Error("Dispatch exceeds device workgroup limits.");
  const device=await adapter.requestDevice();
  device.addEventListener("uncapturederror",e=>setStatus("WebGPU: "+e.error.message,true));
  const allocations=[],readbacks=[];
  try {
    const module=device.createShaderModule({code:wgsl});
    const info=await module.getCompilationInfo();
    const errs=info.messages.filter(x=>x.type==="error");
    if(errs.length)throw Error("WGSL validation:\n"+errs.map(x=>x.lineNum+":"+x.linePos+" "+x.message).join("\n"));
    const pipeline=await device.createComputePipelineAsync({layout:"auto",compute:{module,entryPoint:entry}});
    let total=0;
    const entries=[];
    for(const r of spec.resources){
      const input=bytesFor(r),length=Math.max(16,input.byteLength);
      total+=length;if(length>maxBytes||total>maxTotal)throw Error("Buffer capacity limit exceeded.");
      if(r.access==="uniform" && length%16)throw Error("Uniform buffer length must be 16-byte aligned.");
      const usage=r.access==="uniform"?
        GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST:
        GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;
      const buffer=device.createBuffer({size:length,usage});
      if(input.byteLength)device.queue.writeBuffer(buffer,0,input);
      allocations.push({r,buffer,length});
      entries.push({binding:r.binding,resource:{buffer}});
    }
    const bindGroup=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries});
    const encoder=device.createCommandEncoder();
    const pass=encoder.beginComputePass();
    pass.setPipeline(pipeline);pass.setBindGroup(0,bindGroup);
    pass.dispatchWorkgroups(...dispatch);pass.end();
    for(const a of allocations.filter(x=>x.r.inspect===true)){
      if(a.r.access==="uniform")throw Error("Cannot read back a uniform as a writable buffer.");
      const mapped=device.createBuffer({size:a.length,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      readbacks.push({a,mapped});
      encoder.copyBufferToBuffer(a.buffer,0,mapped,0,a.length);
    }
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    const lines=["GPU compute dispatch completed.","Path: HLSL → DXC SPIR-V → Naga WGSL → WebGPU",
      "Entry: "+entry+"; threads/group: "+size.join("×")+"; groups: "+dispatch.join("×")];
    if(result.log)lines.push("Compiler:\n"+result.log);
    for(const {a,mapped} of readbacks){
      await mapped.mapAsync(GPUMapMode.READ);
      const copy=mapped.getMappedRange().slice(0);
      mapped.unmap();
      const format=a.r.display||"f32";
      lines.push("\nBinding "+a.r.binding+" ("+a.length+" bytes):\n"+showBuffer(copy,format));
      if(a.r.applyToCanvas&&format==="vec4"){
        const values=new Float32Array(copy),n=window.HLSLPlayground.config().count;
        if(values.length>=n*4&&n<=256) {
          window.HLSLPlayground.applyGpuParticles(values);
          lines.push("Updated "+n+" particle states in the visualizer.");
        }
      }
    }
    results.textContent=lines.join("\n");
    setStatus("GPU run succeeded. Review buffer output below.");
  }finally{
    for(const r of readbacks)r.mapped.destroy();
    for(const a of allocations)a.buffer.destroy();
    device.destroy();
  }
}
runButton.addEventListener("click",async()=>{
  runButton.disabled=true;
  try{await run()}
  catch(e){results.textContent=String(e.stack||e);setStatus("Run failed: "+e.message,true)}
  finally{runButton.disabled=false}
});
$("restore-example").addEventListener("click",()=>{
  editor.dataset.dirty="";
  window.HLSLPlayground.restoreExample();
  manifestArea.value=JSON.stringify(defaultManifest(),null,2);
  setStatus("Restored particle HLSL shader and bindings.");
});
$("example-scale").addEventListener("click",()=>{
  editor.value=[
    "// Editable HLSL: this kernel doubles eight input floats.",
    "StructuredBuffer<float> Input : register(t0);",
    "RWStructuredBuffer<float> Output : register(u0);",
    "[numthreads(64, 1, 1)]",
    "void CSMain(uint3 tid : SV_DispatchThreadID)",
    "{",
    "    if (tid.x >= 8) return;",
    "    Output[tid.x] = Input[tid.x] * 2.0;",
    "}"
  ].join("\n");
  editor.dataset.dirty="1";
  manifestArea.value=JSON.stringify({
    entry:"CSMain",dispatch:[1,1,1],resources:[
      {binding:0,access:"read",dataType:"f32",data:[1,2,3,4,5,6,7,8]},
      {binding:16,access:"read_write",byteLength:32,inspect:true,display:"f32"}
    ]},null,2);
  setStatus("Loaded array-scaling example. Edit it and click Run on GPU.");
});
$("show-wgsl").addEventListener("change",e=>wgslArea.hidden=!e.target.checked);
setStatus(isBridgeOrigin?
  "Ready: run editable HLSL via local compiler + browser WebGPU.":
  "Offline code editor ready. Real GPU runs require the local compiler server (see README).");
})();
