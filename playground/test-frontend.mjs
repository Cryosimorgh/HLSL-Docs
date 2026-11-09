// CI-only frontend syntax and DOM contract checks; shipped backend is Zig.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
const root=fileURLToPath(new URL(".",import.meta.url));
const html=await readFile(root+"index.html","utf8");
const runner=await readFile(root+"live-runner.js","utf8");
const browserGpu=await readFile(root+"browser-gpu.js","utf8");
new vm.Script(browserGpu,{filename:"browser-gpu.js"});
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .filter(m=>!m[0].includes("src="));
assert.equal(scripts.length,2);
new vm.Script(scripts[1][1]);
new vm.Script(runner);
for(const id of ["code","bindings","run-gpu","close-playground","compile-status","gpu-output"]) {
    assert.ok(html.includes('id="'+id+'"'),"Missing DOM element: "+id);
}
assert.ok(runner.includes("/api/compile"));
assert.ok(runner.includes("/api/session/") && runner.includes('sessionCall("open")'));
assert.ok(html.includes("Start-HLSL-Playground.cmd"), "The editor must point users to the one-click launcher.");
for(const id of ["wgsl-code","wgsl-input","wgsl-output","wgsl-run","wgsl-reset"]) {
    assert.ok(html.includes('id="'+id+'"'),"Missing standalone GPU teaching control: "+id);
}
assert.ok(html.includes('src="browser-gpu.js"'));
assert.ok(html.includes('id="run-gpu" class="primary" type="button">Compile &amp; Run HLSL'),"HLSL compile/run button must be enabled.");
console.log("PASS: frontend scripts, browser WGSL lab, and enabled HLSL compile/run controls");
