// Verify the tab-owned compiler lifecycle without installing DXC or a GPU.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const server = fileURLToPath(new URL("./server.mjs", import.meta.url));
const basePort = 48631;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function startServer(port) {
  const proc = spawn(process.execPath, [server], {
    env: { ...process.env, HLSL_PORT:String(port),
      HLSL_LEASE_TIMEOUT_MS:"1800", HLSL_EXIT_DELAY_MS:"600",
      HLSL_STARTUP_GRACE_MS:"2500" },
    stdio:["ignore","pipe","pipe"]
  });
  let error="";
  proc.stderr.on("data",x=>error+=x);
  const base="http://127.0.0.1:"+port;
  for(let i=0;i<55;i++) {
    if(proc.exitCode!==null)break;
    try { const r=await fetch(base+"/api/health");if(r.ok)return {proc,base}; }
    catch { }
    await sleep(100);
  }
  proc.kill();
  throw Error("Server failed to start: "+error);
}
function post(base,path,body={}) {
  return fetch(base+"/api/session/"+path,{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)
  });
}
async function waitStopped(proc,limitMs=6000) {
  if(proc.exitCode!==null||proc.signalCode!==null)return;
  await Promise.race([
    new Promise(ok=>proc.once("exit",ok)),
    sleep(limitMs).then(()=>{throw Error("Server failed to exit without a browser tab.");})
  ]);
}
let one,two,third;
try {
  one=await startServer(basePort);
  const a=await post(one.base,"open"),b=await post(one.base,"open");
  assert.equal(a.status,200);assert.equal(b.status,200);
  const {token:tokenA}=await a.json(),{token:tokenB}=await b.json();
  assert.notEqual(tokenA,tokenB);
  let health=await (await fetch(one.base+"/api/health")).json();
  assert.equal(health.activeTabs,2);
  assert.equal((await post(one.base,"close",{token:tokenA})).status,200);
  await sleep(1250);
  health=await (await fetch(one.base+"/api/health")).json();
  assert.equal(health.activeTabs,1,"One remaining tab must keep service alive.");
  assert.equal((await post(one.base,"ping",{token:tokenB})).status,200);
  assert.equal((await post(one.base,"close",{token:tokenB})).status,200);
  await waitStopped(one.proc,5000);

  // Simulate browser crash: no pagehide beacon, so lease expires.
  two=await startServer(basePort+1);
  const lease=await post(two.base,"open");
  assert.equal(lease.status,200);
  await waitStopped(two.proc,7000);

  // Simulate launcher/browser failure: no tab ever opens.
  third=await startServer(basePort+2);
  await waitStopped(third.proc,7000);
  console.log("PASS: per-tab leases, multi-tab safety, explicit close, crash fallback and startup-grace cleanup");
} finally {
  for(const v of [one,two,third]) {
    if(v && v.proc.exitCode===null && v.proc.signalCode===null) v.proc.kill();
  }
}
