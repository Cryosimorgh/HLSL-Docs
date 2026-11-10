// Framebuffer HLSL convention: source is the ONLY place defining RGB output
// and dimensions. Auto resources must be inferred without JSON animation data.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import vm from "node:vm";
const root=fileURLToPath(new URL(".",import.meta.url));
const runner=await readFile(root+"live-runner.js","utf8");
const i=runner.indexOf("function inferFramebufferSpec(source) {");
const j=runner.indexOf("function parseManifest() {",i);
assert.ok(i>=0&&j>i,"HLSL spec parser must exist");
const infer=vm.runInNewContext("("+runner.slice(i,j).trim()+")");
for(const name of ["julia-rgba.hlsl","particles-rgba.hlsl"]){
  const hlsl=await readFile(root+name,"utf8");
  const spec=infer(hlsl);
  assert.ok(spec?.autoFramebuffer,"HLSL source must configure framebuffer automatically");
  assert.equal(spec.entry,"CSMain");
  assert.equal(spec.resources.length,2,"Only RGBA framebuffer and frame uniform needed");
  assert.equal(spec.resources[0].binding,16,"u0 must map to DXC-shifted binding 16");
  assert.equal(spec.resources[1].binding,39,"b7 must map to DXC-shifted binding 39");
  assert.equal(spec.resources[0].display,"vec4");
  assert.equal(spec.resources[0].visualize.mode,"grid-rgba");
  assert.equal(spec.resources[0].visualize.grid.width,256);
  assert.equal(spec.resources[0].visualize.grid.height,256);
  assert.equal(spec.resources[0].byteLength,256*256*16);
  assert.equal(spec.animation.binding,39);
  assert.equal(spec.resources[1].data[2],256);
  assert.equal(spec.resources[1].data[3],256);
  assert.ok(/Framebuffer\s*\[i\]\s*=\s*float4/.test(hlsl),
    "Actual shader must write output RGB values, not positions/velocities");
  assert.ok(!/StructuredBuffer<float4>\s+Input\b/.test(hlsl),
    "No JavaScript-generated input positions required");
}
assert.equal(infer("RWStructuredBuffer<float4> Output : register(u0);"),null);
assert.throws(()=>infer("#define WORKBENCH_WIDTH 2048\n#define WORKBENCH_HEIGHT 2048\n"+
  "cbuffer WorkbenchFrame : register(b7) {float Time;};\n"+
  "RWStructuredBuffer<float4> Framebuffer : register(u0);"),/Framebuffer HLSL/);
console.log("PASS source-only HLSL framebuffer inference, RGB output, b7 time binding and size limits");
