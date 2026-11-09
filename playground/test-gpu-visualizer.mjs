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
  "gpu-visual-legend":{textContent:""}
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

// Zero-mask output must give a visible diagnostic, not an apparently blank panel.
output.forEach((_,i)=>{if(i%4===2)output[i]=0;});
rendered=viz.render({
  bytes:output.buffer,format:"vec4",binding:16,
  source:"float mask = smoothstep(a,b,d);",worldWidth:4
});
assert.equal(rendered.st.positive,0);
assert.match(nodes["gpu-visual-summary"].textContent,/ALL MASKS ZERO/);

// Ordinary numeric output displays a bar chart and correct min/max.
rendered=viz.render({
  bytes:new Float32Array([-2,0,2,6]).buffer,
  format:"f32",binding:16,source:"scalar"
});
assert.equal(rendered.st.min,-2);
assert.equal(rendered.st.max,6);
assert.equal(rendered.st.mean,1.5);
viz.clear();
assert.equal(nodes["gpu-visual-panel"].hidden,true);
console.log("PASS: GPU-readback heatmap, zero-mask explanation, scatter, numeric bars and reset");
