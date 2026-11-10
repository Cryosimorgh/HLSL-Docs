// Pure-model tests for offline HLSL completion. No GPU, network, or mocks of a
// compiler: these check the exact lexical capabilities we advertise.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import vm from "node:vm";
const root=fileURLToPath(new URL(".",import.meta.url));
const docs=await readFile(root+"hlsl-docs-data.js","utf8");
const implementation=await readFile(root+"hlsl-intellisense.js","utf8");
new vm.Script(implementation,{filename:"hlsl-intellisense.js"});
const win={};
vm.runInNewContext(docs,{window:win,console});
vm.runInNewContext(implementation,{window:win,console});
const engine=win.HLSLIntelliSenseEngine;
assert.ok(engine,"IntelliSense lexical engine was not exported.");

const shader=[
  "#define WORKBENCH_WIDTH 256",
  "cbuffer WorkbenchFrame : register(b7) {",
  "    float Time;",
  "};",
  "RWStructuredBuffer<float4> Framebuffer : register(u0);",
  "float3 FractalColor(float3 color, float t) {",
  "    float3 rgb = color;",
  "    return lerp(rgb, float3(0, 0, 0), t);",
  "}",
  "[numthreads(8,8,1)]",
  "void CSMain(uint3 tid : SV_DispatchThreadID) {",
  "    float3 shade = FractalColor(float3(0.1, 0.2, 0.3), Time);",
  "    Framebuffer[0] = float4(shade, 1.0);",
  "}"
].join("\n");

function matches(ending,manual=true){
  const src=shader+"\n"+ending;
  return engine.suggest(src,{line:src.split("\n").length-1,ch:ending.length},manual);
}
const names=x=>x.items.map(c=>c.name);
const symbols=engine.symbolMap(shader);
assert.ok(symbols.functions.has("FractalColor"),"User function declaration must be indexed.");
assert.match(symbols.functions.get("FractalColor"),/float3 FractalColor\(float3 color, float t\)/);
assert.equal(symbols.typesByName.get("rgb"),"float3","Variable type needed for swizzle help.");
assert.equal(symbols.typesByName.get("tid"),"uint3","Function parameters must be indexed.");
assert.ok(names(matches("Frac")).includes("FractalColor"));
assert.ok(names(matches("WORKBENCH_W")).includes("WORKBENCH_WIDTH"),
  "The user's #define must be discoverable.");
assert.ok(names(matches("Fra")).includes("Framebuffer"),
  "The user's GPU resource must be discoverable.");
assert.ok(names(matches("Tim")).includes("Time"),"Constant buffer field must be discoverable.");
assert.ok(names(matches("smoo")).includes("smoothstep"),"HLSL intrinsics must complete.");
assert.ok(names(matches("float")).includes("float3"),"Vector types should be suggested.");
assert.ok(names(matches("cb")).includes("cbuffer"),"HLSL declarations should be suggested.");
const swizzle=names(matches("rgb.r"));
assert.ok(swizzle.includes("rgb")&&!swizzle.includes("rgba"),
  "HLSL float3 offers rgb, but not 4-component rgba swizzles.");
assert.ok(!names(matches("rgb.xy")).includes("xyzw"),"float3 must not offer 4D swizzles.");
const three=names(matches("tid."));
assert.ok(three.includes("xyz")&&!three.includes("w"),"uint3 swizzles should be 3D.");
const regs=names(matches("register(t"));
assert.ok(regs.includes("t0")&&!regs.includes("float"),"Register names only in register(...).");
const semantics=names(matches("uint3 id : SV_"));
assert.ok(semantics.includes("SV_DispatchThreadID"));
const preprocessor=names(matches("#def"));
assert.ok(preprocessor.includes("define")&&!preprocessor.includes("float3"));
assert.ok(names(matches("// smooth")).length===0,
  "Never autocomplete identifiers inside line comments.");
assert.ok(names(matches('float s = "smoo')).length===0,
  "Never autocomplete identifiers inside strings.");
const automatic=engine.suggest(shader+"\na",{line:shader.split("\n").length,ch:1},false);
assert.ok(automatic.items.length>0&&automatic.items.length<=16,
  "First typed identifier should show a bounded automatic suggestion list.");
assert.ok(automatic.items.some(x=>x.name==="abs"||x.name==="all"),
  "Automatic suggestions should include relevant HLSL built-ins.");
const builtInCall=shader+"\nfloat x = smoothstep(0.1f, ";
const arg=engine.signatureAt(builtInCall,{line:shader.split("\n").length,
  ch:builtInCall.split("\n").at(-1).length});
assert.equal(arg.name,"smoothstep");
assert.equal(arg.active,1);
assert.match(arg.signature,/smoothstep\(minValue, maxValue, x\)/);
const ownCall=shader+"\nfloat3 c = FractalColor(float3(0.1, 0.2, 0.3), ";
const fnHelp=engine.signatureAt(ownCall,{line:shader.split("\n").length,
  ch:ownCall.split("\n").at(-1).length});
assert.equal(fnHelp.name,"FractalColor");
assert.equal(fnHelp.active,1);
assert.match(fnHelp.signature,/float3 FractalColor\(float3 color, float t\)/);
assert.equal(engine.signatureAt(shader,{line:0,ch:5}),null);
console.log("PASS HLSL offline IntelliSense: lexical user symbols, builtins, swizzles, registers, semantics, macros, signatures, no comment/string suggestions");
