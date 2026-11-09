// Node.js built-in smoke checks for the editable playground.
// Mock compiler executables only test HTTP and process wiring; real shader
// conversion is tested separately in CI when DXC and Naga are available.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here=fileURLToPath(new URL(".",import.meta.url));
const temp=await mkdtemp(join(tmpdir(),"hlsl-runner-test-"));
const port=48117;
const base="http://127.0.0.1:"+port;
let child;
try{
  const html=await readFile(join(here,"index.html"),"utf8");
  const live=await readFile(join(here,"live-runner.js"),"utf8");
  new vm.Script(live,{filename:"live-runner.js"});
  const inline=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].filter(m=>!m[0].includes("src="));
  assert.equal(inline.length,2,"Expected HLSL source + JavaScript app scripts");
  new vm.Script(inline[1][1],{filename:"index-inline.js"});
  assert.match(html,/id="code" class="code-editor"/);
  assert.match(html,/id="run-gpu"/);
  assert.match(html,/id="bindings"/);
  assert.match(html,/src="live-runner.js"/);
  assert.match(live,/await fetch\("\/api\/compile"/);
  const dxc=join(temp,"fake-dxc.cjs");
  const naga=join(temp,"fake-naga.cjs");
  await writeFile(dxc,[
    "#!/usr/bin/env node",
    "const fs=require('node:fs');",
    "const a=process.argv.slice(2);",
    "if(!a.includes('-spirv')||!a.includes('-fvk-u-shift'))process.exit(9);",
    "fs.writeFileSync(a[a.indexOf('-Fo')+1],Buffer.from([3,2,35,7]));"
  ].join("\n"));
  await writeFile(naga,[
    "#!/usr/bin/env node",
    "const fs=require('node:fs');",
    "const a=process.argv.slice(2);",
    "if(a.length!==2)process.exit(8);",
    "fs.writeFileSync(a[1], '@compute @workgroup_size(64,1,1) fn CSMain() {}');"
  ].join("\n"));
  await chmod(dxc,0o755); await chmod(naga,0o755);
  child=spawn(process.execPath,[join(here,"server.mjs")],{
    env:{...process.env,HLSL_PORT:String(port),DXC_PATH:dxc,NAGA_PATH:naga},
    stdio:["ignore","pipe","pipe"]
  });
  let lastError="";
  child.stderr.on("data",d=>lastError+=String(d));
  let ready=false;
  for(let i=0;i<50;i++){
    if(child.exitCode!==null)break;
    try{const r=await fetch(base+"/");if(r.ok){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(ready,"Server did not start: "+lastError);
  const page=await fetch(base+"/");
  assert.equal(page.status,200);
  assert.match(await page.text(),/Editable HLSL compute shader source/);
  const missing=await fetch(base+"/not-allowed.txt");
  assert.equal(missing.status,404);
  const cors=await fetch(base+"/api/compile",{method:"POST",
    headers:{"Content-Type":"application/json",Origin:"http://evil.test"},
    body:JSON.stringify({entry:"CSMain",source:"void CSMain() {}"})});
  assert.equal(cors.status,403);
  const include=await fetch(base+"/api/compile",{method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({entry:"CSMain",source:'#include "/etc/passwd"\nvoid CSMain(){}'})});
  assert.equal(include.status,400);
  assert.match((await include.json()).error,/Includes are disabled/);
  const good=await fetch(base+"/api/compile",{method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({entry:"CSMain",source:"[numthreads(64,1,1)] void CSMain(uint3 id:SV_DispatchThreadID) {}"})});
  assert.equal(good.status,200);
  const result=await good.json();
  assert.match(result.wgsl,/@compute/);
  assert.equal(result.mapping.u0,16);
  console.log("PASS inline JavaScript syntax, editor controls, server routes, rejects and compiler process wiring");
}finally{
  if(child){child.kill();await new Promise(r=>{if(child.exitCode!==null||child.signalCode!==null)r();else child.once("exit",r)});}
  await rm(temp,{recursive:true,force:true});
}
