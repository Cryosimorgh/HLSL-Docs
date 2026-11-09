// CI-only frontend syntax and DOM contract checks; shipped backend is Zig.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
const root=fileURLToPath(new URL(".",import.meta.url));
const html=await readFile(root+"index.html","utf8");
const runner=await readFile(root+"live-runner.js","utf8");
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
assert.ok(html.includes("zig-server.zig"));
console.log("PASS: frontend JavaScript and Zig-backed session/run controls");
