// HTTP contract, session lifecycle and validation tests for Zig backend.
// Uses Node only as CI test client; Node is NOT bundled or required by users.
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const dir=fileURLToPath(new URL(".",import.meta.url));
const exe=join(dir,process.platform==="win32"?"hlsl-server.exe":"hlsl-server");
const port=48551,base="http://127.0.0.1:"+port;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const child=spawn(exe,[],{
  env:{...process.env,HLSL_PORT:String(port),
    HLSL_STARTUP_GRACE_MS:"2500",HLSL_LEASE_TIMEOUT_MS:"1500",
    HLSL_EXIT_DELAY_MS:"600",DXC_PATH:"dxc-does-not-exist",NAGA_PATH:"naga-does-not-exist"},
  stdio:["ignore","pipe","pipe"]
});
let stderr="";child.stderr.on("data",d=>stderr+=d);
async function post(path,body,origin){
 const headers={"Content-Type":"application/json"};
 if(origin)headers.Origin=origin;
 return fetch(base+path,{method:"POST",headers,body:JSON.stringify(body)});
}
async function untilExit(){
 for(let i=0;i<80;i++){
  if(child.exitCode!==null||child.signalCode!==null)return;
  await delay(100);
 }
 throw Error("Zig backend stayed alive after close");
}
try{
 let ready=false;
 for(let i=0;i<80;i++){
  try{const r=await fetch(base+"/api/health");if(r.ok){ready=true;break;}}catch{}
  if(child.exitCode!==null)break;
  await delay(100);
 }
 assert.ok(ready,"Cannot connect Zig HTTP backend: "+stderr);
 const health=await(await fetch(base+"/api/health")).json();
 assert.equal(health.backend,"zig");
 assert.equal(health.activeTabs,0);
 // Exercise simultaneous local clients without detached Zig request threads.
 // Must not crash or confuse per-connection request headers.
 const burst = await Promise.all(Array.from({length:40},()=>fetch(base+"/api/health")));
 assert.ok(burst.every(x=>x.status===200),"Concurrent health burst should succeed.");
 const states = await Promise.all(burst.map(x=>x.json()));
 assert.ok(states.every(x=>x.backend==="zig"),"All responses must belong to Zig backend.");
 const page=await fetch(base+"/");
 assert.equal(page.status,200);
 assert.match(await page.text(),/HLSL Compute Playground/);
 const runner=await fetch(base+"/live-runner.js");
 assert.equal(runner.status,200);
 const blocked=await fetch(base+"/../../etc/passwd");
 assert.equal(blocked.status,404);
 const cors=await post("/api/session/open",{}, "http://attacker.example");
 assert.equal(cors.status,403);
 const openA=await post("/api/session/open",{});
 const openB=await post("/api/session/open",{});
 assert.equal(openA.status,200);assert.equal(openB.status,200);
 const tokenA=(await openA.json()).token,tokenB=(await openB.json()).token;
 assert.ok(tokenA!==tokenB);
 let stats=await(await fetch(base+"/api/health")).json();
 assert.equal(stats.activeTabs,2);
 assert.equal((await post("/api/session/close",{token:tokenA})).status,200);
 await delay(500);
 assert.equal((await post("/api/session/ping",{token:tokenB})).status,200);
 stats=await(await fetch(base+"/api/health")).json();
 assert.equal(stats.activeTabs,1);
 const include=await post("/api/compile",{entry:"CSMain",source:'#include "/tmp/private"\nvoid CSMain(){}'});
 assert.equal(include.status,400);
 const badEntry=await post("/api/compile",{entry:"bad entry",source:"void CSMain(){}"});
 assert.equal(badEntry.status,400);
 const badJson=await fetch(base+"/api/compile",{method:"POST",headers:{"Content-Type":"application/json"},body:"{"});
 assert.equal(badJson.status,400);
 assert.equal((await post("/api/session/close",{token:tokenB})).status,200);
 await untilExit();
 assert.equal(child.exitCode,0,
   "Zig server must exit normally (zero), not crash with STATUS_ACCESS_VIOLATION/0xC0000005: "+stderr);
 console.log("PASS Zig server: 40 concurrent clients, validation, multitab leases and graceful zero-code exit");
}finally{
 if(child.exitCode===null&&child.signalCode===null)child.kill();
}
