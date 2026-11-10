// CI-only unit tests: verify charts use GPU readback values, not CPU masks.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import vm from "node:vm";

const file=fileURLToPath(new URL("./gpu-visualizer.js",import.meta.url));
const source=await readFile(file,"utf8");
const commands=[];
const ctx={
  clearRect(...a){commands.push(["clearRect",...a])},
  fillRect(...a){commands.push(["fillRect",...a])},
  strokeRect(){},fillText(){},beginPath(){},arc(){},fill(){},moveTo(){},lineTo(){},stroke(){},
  set fillStyle(v){this._fillStyle=v},get fillStyle(){return this._fillStyle},
  set strokeStyle(v){},set font(v){},set lineWidth(v){}
};
const nodes={
  "gpu-visual-panel":{hidden:true},
  "gpu-visual":{width:800,height:400,getContext:()=>ctx},
  "gpu-visual-summary":{textContent:""},
  "gpu-visual-title":{textContent:""},
  "gpu-visual-legend":{textContent:""},
  "gpu-preview-empty":{hidden:false},
  "viz-samples":{textContent:""},
  "viz-coverage":{textContent:""},
  "viz-coverage-label":{textContent:""},
  "viz-range":{textContent:""},
  "viz-mean":{textContent:""}
};
const window={};
vm.runInNewContext(source,{window,document:{getElementById:id=>nodes[id]},console});
const viz=window.HLSLGPUVisualize;
assert.ok(viz);
assert.equal(viz.hasMaskSource("float mask = smoothstep(a,b,d);"),true);
assert.equal(viz.hasMaskSource("float vx = 3.0;"),false);

// A 4x4 GPU buffer with eight ones and eight zeroes must report 8/16 coverage.
const output=new Float32Array(16*4);
for(let i=0;i<16;i++){
  output[i*4]=i%4;
  output[i*4+1]=Math.floor(i/4);
  output[i*4+2]=i<8?1:0;
}
let rendered=viz.render({
  bytes:output.buffer,format:"vec4",binding:16,source:"mask = smoothstep(...);",
  worldWidth:4,
  visualize:{mode:"grid-mask",channel:2,grid:{width:4,height:4,xMax:4,yMax:4}}
});
assert.equal(rendered.st.positive,8);
assert.equal(rendered.st.valid,16);
assert.equal(rendered.st.mean,0.5);
assert.match(nodes["gpu-visual-summary"].textContent,/8\/16 samples have mask/);
assert.equal(nodes["gpu-visual-panel"].hidden,false);
assert.ok(commands.filter(c=>c[0]==="fillRect").length>=18);
const gridRect=commands.filter(c=>c[0]==="fillRect")[1];
assert.ok(Math.abs(gridRect[3]-gridRect[4])<0.01,
  "A unit-square circle mask must have equal pixel dimensions, not an ellipse.");
assert.equal(nodes["gpu-preview-empty"].hidden,true,"Successful GPU output must replace empty state.");
assert.equal(nodes["viz-samples"].textContent,"16");
assert.equal(nodes["viz-coverage"].textContent,"50.0%");


// Zero-mask output must give a visible diagnostic, not an apparently blank panel.
output.forEach((_,i)=>{if(i%4===2)output[i]=0;});
rendered=viz.render({
  bytes:output.buffer,format:"vec4",binding:16,
  source:"float mask = smoothstep(a,b,d);",worldWidth:4
});
assert.equal(rendered.st.positive,0);
assert.match(nodes["gpu-visual-summary"].textContent,/all masks zero/i);

// Ordinary numeric output displays a bar chart and correct min/max.
rendered=viz.render({
  bytes:new Float32Array([-2,0,2,6]).buffer,
  format:"f32",binding:16,source:"scalar"
});
assert.equal(rendered.st.min,-2);
assert.equal(rendered.st.max,6);
assert.equal(rendered.st.mean,1.5);
// Julia fractal mode must render the GPU's iteration intensity, not a CPU image.
const julia=new Float32Array(4*4*4);
for(let i=0;i<16;i++){julia[i*4]=i%4;julia[i*4+1]=Math.floor(i/4);julia[i*4+2]=i/15;}
const juliaResult=viz.render({
  bytes:julia.buffer,format:"vec4",binding:16,source:"Julia loop",
  visualize:{mode:"grid-fractal",grid:{width:4,height:4,xMax:1,yMax:1},channel:2}
});
assert.equal(juliaResult.kind,"fractal");
assert.equal(juliaResult.st.valid,16);
assert.equal(juliaResult.st.min,0);
assert.equal(juliaResult.st.max,1);
assert.match(nodes["gpu-visual-title"].textContent,/Julia fractal/);
assert.equal(nodes["viz-coverage"].textContent,"50.0%");
// No JavaScript palette for HLSL framebuffer: the three output channels are literal RGB.
const rgba=new Float32Array([
  1,0,0,1, 0,1,0,1,
  0,0,1,1, 0.5,0.5,0.5,1
]);
const rgbaResult=viz.render({
  bytes:rgba.buffer,format:"vec4",binding:16,
  source:"RWStructuredBuffer<float4> Framebuffer : register(u0)",
  visualize:{mode:"grid-rgba",grid:{width:2,height:2,xMax:2,yMax:2}}
});
assert.equal(rgbaResult.kind,"rgba");
assert.equal(rgbaResult.st.valid,4);
assert.match(nodes["gpu-visual-title"].textContent,/HLSL framebuffer/);
assert.match(nodes["gpu-visual-legend"].textContent,/RGB and alpha/);
assert.equal(nodes["viz-coverage-label"]?.textContent,"Bright pixels");
viz.clear();
assert.equal(nodes["gpu-visual-panel"].hidden,true);
console.log("PASS: GPU-readback heatmap, zero-mask explanation, scatter, numeric bars and reset");
