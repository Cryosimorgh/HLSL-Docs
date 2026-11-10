// Contract test for continuous WebGPU execution. The mock GPU is NOT hardware
// validation: it verifies compile-once, changing float32 time uniforms,
// repeated dispatch/readback, pause/step/reset, and cleanup.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import vm from "node:vm";
const source=await readFile(fileURLToPath(new URL("./animation-runner.js",import.meta.url)),"utf8");
new vm.Script(source,{filename:"animation-runner.js"});
const callbacks=new Map();
let nextRaf=1,clock=0,compileCalls=0,dispatches=0,destroyed=0;
const phaseReadings=[],renders=[],statuses=[];
const nodes={};
function node(id){
  if(!nodes[id])nodes[id]={
    textContent:"",disabled:false,value:"",dataset:{},open:false,
    addEventListener(name,cb){this["on"+name]=cb},
    setAttribute(name,value){this[name]=value}
  };
  return nodes[id];
}
const bufferUsage={UNIFORM:1,COPY_DST:2,STORAGE:4,COPY_SRC:8,MAP_READ:16};
const uniforms=new Map();
const allBuffers=[];
function makeBuffer({size}){
  const b={
    size,bytes:new Uint8Array(size),destroyed:false,
    async mapAsync(){},
    getMappedRange(){return this.bytes.buffer},
    unmap(){},
    destroy(){if(!this.destroyed){this.destroyed=true;destroyed++;}}
  };
  allBuffers.push(b);return b;
}
const device={
  queue:{
    writeBuffer(buffer,offset,bytes){
      const a=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes.buffer??bytes);
      buffer.bytes.set(a,offset);
    },
    submit(cmds){
      for(const cmd of cmds){
        for(const p of cmd.dispatches){
          dispatches++;
          const b0=p.bindGroup.entries.find(e=>e.binding===39).resource.buffer;
          const u0=p.bindGroup.entries.find(e=>e.binding===16).resource.buffer;
          const phase=new DataView(b0.bytes.buffer).getFloat32(0,true);
          phaseReadings.push(phase);
          const output=new Float32Array(u0.bytes.buffer);
          for(let k=0;k<output.length/4;k++){
            output[k*4]=k%4;
            output[k*4+1]=Math.floor(k/4);
            output[k*4+2]=phase;
            output[k*4+3]=1;
          }
        }
        for(const copy of cmd.copies)
          copy.dst.bytes.set(copy.src.bytes.slice(0,copy.size),0);
      }
    }
  },
  createShaderModule(){return{getCompilationInfo:async()=>({messages:[]})}},
  async createComputePipelineAsync(){return{getBindGroupLayout:()=>({})}},
  createBuffer:makeBuffer,
  createBindGroup({entries}){return{entries}},
  createCommandEncoder(){
    const cmd={dispatches:[],copies:[]};
    const pass={
      setPipeline(){},setBindGroup(_slot,g){this.bindGroup=g},
      dispatchWorkgroups(...groups){cmd.dispatches.push({groups,bindGroup:this.bindGroup})},
      end(){}
    };
    return{
      beginComputePass:()=>pass,
      copyBufferToBuffer(src,_off,dst,_o,size){cmd.copies.push({src,dst,size})},
      finish:()=>cmd
    };
  },
  lost:new Promise(()=>{}),
  destroy(){destroyed++}
};
const gpu={async requestAdapter(){return{
  limits:{maxComputeWorkgroupsPerDimension:65535},
  async requestDevice(){return device}
}}};
const win={
  HLSLRunnerAPI:{
    editor:node("code"),manifestArea:node("bindings"),runButton:node("run-gpu"),
    results:node("gpu-output"),wgslArea:node("generated-wgsl"),
    isBridgeOrigin:true,
    setStatus:(...a)=>statuses.push(a),
    setActivePreset:id=>{node(id).pressed=true},
    parseManifest:()=>{
      const src=node("code").value;
      const w=Number(src.match(/#define WORKBENCH_WIDTH (\d+)/)?.[1]);
      const h=Number(src.match(/#define WORKBENCH_HEIGHT (\d+)/)?.[1]);
      if(!w||!h)throw Error("Missing HLSL framebuffer dimensions in test");
      return {entry:"CSMain",dispatch:"auto",autoFramebuffer:true,
        animation:{binding:39,component:0,speed:1,fps:30},
        resources:[
          {binding:16,access:"read_write",byteLength:w*h*16,inspect:true,
           display:"vec4",visualize:{mode:"grid-rgba",grid:{width:w,height:h,xMax:w,yMax:h}}},
          {binding:39,access:"uniform",dataType:"f32",data:[0,0,w,h,0,0,0,0]}
        ]};
    },
    bytesFor(r,spec){
      if(r.preset==="grid"){
        const g=r.grid,a=new Float32Array(g.width*g.height*4);
        for(let i=0;i<g.width*g.height;i++){
          a[i*4]=(i%g.width+.5)/g.width;
          a[i*4+1]=(Math.floor(i/g.width)+.5)/g.height;
        }
        return new Uint8Array(a.buffer);
      }
      if(typeof r.byteLength==="number")return new Uint8Array(r.byteLength);
      if(r.byteLength==="grid"){
        const g=spec.resources[0].grid;
        return new Uint8Array(g.width*g.height*16);
      }
      return new Uint8Array(new Float32Array(r.data).buffer);
    },
    compiledEntry:()=> "CSMain",
    compiledSize:()=>[64,1,1],
    gridConfig:spec=>spec.resources.find(r=>r.grid)?.grid||{xMax:1},
    showBuffer:()=>"..."
  },
  HLSLHighlight:{refresh(){}},
  HLSLGPUVisualize:{
    clear(){},render(x){renders.push(new Float32Array(x.bytes)[2]);return{}}
  },
  HLSLPlayground:{config:()=>({count:64})},
  addEventListener(event,cb){this["on"+event]=cb}
};
const doc={
  hidden:false,
  getElementById:node,
  addEventListener(event,cb){this["on"+event]=cb}
};
for(const id of ["animate-gpu","pause-gpu","step-gpu","reset-gpu",
                 "animation-fps","animation-frames","animation-time"])node(id);
const context={
  window:win,document:doc,console,performance:{now:()=>clock},
  navigator:{gpu},
  fetch:async(url)=>{
    assert.equal(url,"/api/compile");
    compileCalls++;
    return{ok:true,async json(){return{wgsl:"@compute @workgroup_size(64) fn CSMain() {}"}}};
  },
  AbortSignal:{timeout:()=>({})},
  GPUBufferUsage:bufferUsage,GPUMapMode:{READ:1},
  requestAnimationFrame:fn=>{const id=nextRaf++;callbacks.set(id,fn);return id},
  cancelAnimationFrame:id=>callbacks.delete(id)
};
vm.runInNewContext(source,context,{filename:"animation-runner.js"});
assert.match(node("code").value,/float Time/);
const spec=win.HLSLRunnerAPI.parseManifest();
assert.equal(spec.animation.binding,39);
assert.equal(spec.resources[0].visualize.mode,"grid-rgba");
assert.equal(spec.autoFramebuffer,true);
assert.ok(!JSON.parse(node("bindings").value).animation,"Animation manifest must not be required");

const anim=win.HLSLAnimation;
await anim.start();
assert.equal(compileCalls,1,"HLSL compiled exactly once when starting animation");
async function tick(ms){
  clock=ms;
  const list=[...callbacks.entries()];
  callbacks.clear();
  for(const [,cb] of list)await cb(ms);
  for(let i=0;i<5;i++)await Promise.resolve();
}
await tick(100);
await tick(145);
await tick(190);
assert.ok(dispatches>=3,"Multiple GPU dispatches required for animation");
assert.equal(compileCalls,1,"Compilation must not recur for each animation frame");
assert.ok(renders.length>=3,"Each completed GPU frame must update visualization");
assert.ok(phaseReadings[1]>phaseReadings[0],"Phase uniform must advance between frames");
assert.ok(renders[2]!==renders[0],"Readback must reflect time-varying output");
const pausedAt=dispatches;
anim.pause();
await tick(250);
assert.equal(dispatches,pausedAt,"Paused animation must not submit GPU work");
await anim.step();
assert.equal(dispatches,pausedAt+1,"Step must dispatch exactly one GPU frame");
await anim.start();
assert.equal(compileCalls,1,"Resume must reuse already compiled GPU pipeline");
await tick(310);
assert.ok(dispatches>pausedAt+1);
anim.pause();
await anim.reset();
assert.ok(Math.abs(phaseReadings.at(-1))<1e-6,"Reset must restore initial Phase");
assert.equal(node("animation-frames").textContent,"1");
anim.stop();
await tick(400);
assert.ok(destroyed>0,"Stopped animation must release GPU buffers/device");
assert.equal(callbacks.size,0,"Stopped animation must cancel outstanding rAF callbacks");
console.log("PASS manifestless HLSL animate: compile once, 3+ GPU dispatches, varying time/RGBA readback, pause/step/resume/reset/cleanup");
