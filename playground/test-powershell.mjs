// Windows CI integration tests for the shipping PowerShell/.NET backend.
// Node is a TEST CLIENT only; the Windows release bundles no node.exe.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import {join} from "node:path";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import net from "node:net";

const folder=fileURLToPath(new URL(".",import.meta.url));
const script=join(folder,"server.ps1");
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
const temp=await mkdtemp(join(tmpdir(),"hlsl-ps-test-"));
const ready=join(temp,"ready.json");
const dxc=process.env.HLSL_TEST_DXC || process.execPath;
const naga=process.env.HLSL_TEST_NAGA || process.execPath;
const integration=!!(process.env.HLSL_TEST_DXC && process.env.HLSL_TEST_NAGA);
const socket=net.createServer();
await new Promise(ok=>socket.listen(0,"127.0.0.1",ok));
const port=socket.address().port;
await new Promise(ok=>socket.close(ok));
const base="http://127.0.0.1:"+port;
async function fetchedStatus(request){
  const response=await request;
  try{return response.status}finally{await response.arrayBuffer();}
}
const ps=spawn("powershell.exe",[
    "-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass",
    "-File",script,"-Port",String(port),"-DxcPath",dxc,"-NagaPath",naga,
    "-SiteRoot",folder,"-ReadyFile",ready,
    "-StartupGraceMs","60000","-LeaseTimeoutMs","15000","-ExitDelayMs","600"
],{windowsHide:true,stdio:["ignore","pipe","pipe"]});
let stderr="",stdout="";
ps.stderr.on("data",x=>stderr+=String(x));
ps.stdout.on("data",x=>stdout+=String(x));
function post(path,obj,origin){
    const headers={"Content-Type":"application/json"};
    if(origin)headers.Origin=origin;
    return fetch(base+path,{method:"POST",headers,body:JSON.stringify(obj)});
}
async function exited(){
    for(let n=0;n<80;n++){
        if(ps.exitCode!==null||ps.signalCode!==null)return;
        await sleep(100);
    }
    throw Error("Server didn't shut down. stderr: "+stderr);
}
try {
    let readyOk=false;
    for(let i=0;i<100;i++){
        if(ps.exitCode!==null)break;
        try {const r=await fetch(base+"/api/health");await r.arrayBuffer();if(r.ok){readyOk=true;break;}}catch{}
        await sleep(100);
    }
    assert.ok(readyOk,"Server not ready: "+stderr+"\n"+stdout);
    const health=await(await fetch(base+"/api/health")).json();
    assert.equal(health.backend,"powershell-dotnet");
    const page=await fetch(base+"/");
    assert.equal(page.status,200);
    assert.match(await page.text(),/HLSL Workbench/);
    assert.equal(await fetchedStatus(fetch(base+"/browser-gpu.js")),200);
    assert.equal(await fetchedStatus(fetch(base+"/gpu-visualizer.js")),200,"GPU renderer script must be served.");
    assert.equal(await fetchedStatus(fetch(base+"/hlsl-highlight.js")),200,"HLSL syntax coloring must load from localhost.");
    for(const asset of ["hlsl-docs-data.js","hlsl-fold-docs.js","hlsl-intellisense.js","hlsl-reference.js","hlsl-reference.html",
      "vendor/codemirror/show-hint.js","vendor/codemirror/show-hint.css"]){
      assert.equal(await fetchedStatus(fetch(base+"/"+asset)),200,"Missing local HLSL documentation/folding asset: "+asset);
    }
    assert.equal(await fetchedStatus(fetch(base+"/animation-runner.js")),200,"Animation engine must load from localhost.");
    assert.equal(await fetchedStatus(fetch(base+"/julia-loop.hlsl")),200,"Julia HLSL source must load from localhost.");
    assert.equal(await fetchedStatus(fetch(base+"/julia-rgba.hlsl")),200);
    assert.equal(await fetchedStatus(fetch(base+"/particles-rgba.hlsl")),200);
    const css=await fetch(base+"/workbench.css");
    assert.equal(css.status,200,"Workbench stylesheet must be served.");
    assert.match(css.headers.get("content-type")||"",/text\/css/);
    await css.arrayBuffer();
    assert.equal(await fetchedStatus(fetch(base+"/circle-mask.hlsl")),200,"Circle shader reference must be served.");
    assert.equal(await fetchedStatus(fetch(base+"/unknown")),404);
    const cors=await post("/api/session/open",{}, "http://untrusted.example");
    assert.equal(cors.status,403,"Origin policy must reject foreign pages");
    await cors.arrayBuffer();
    const one=await post("/api/session/open",{});
    const two=await post("/api/session/open",{});
    assert.equal(one.status,200);assert.equal(two.status,200);
    const a=(await one.json()).token,b=(await two.json()).token;
    assert.notEqual(a,b);
    let h=await(await fetch(base+"/api/health")).json();
    assert.equal(h.activeTabs,2);
    assert.equal(await fetchedStatus(post("/api/session/close",{token:a})),200);
    assert.equal(await fetchedStatus(post("/api/session/ping",{token:b})),200);
    h=await(await fetch(base+"/api/health")).json();
    assert.equal(h.activeTabs,1);
    const invalid=await post("/api/compile",{source:'#include "/etc/passwd"',entry:"CSMain"});
    assert.equal(invalid.status,400);
    await invalid.arrayBuffer();
    async function compileVerified(source){
      for(let attempt=0;attempt<3;attempt++){
        let response;
        try{
          response=await post("/api/compile",{source,entry:"CSMain"});
          const body=await response.text();
          if(response.status!==200)throw Error("DXC/Naga compilation rejected: "+body);
          return JSON.parse(body);
        }catch(error){
          if(error.message.startsWith("DXC/Naga compilation rejected:")||attempt===2)throw error;
          await new Promise(resolve=>setTimeout(resolve,100*(attempt+1)));
        }
      }
    }
    if(integration){
        for(const name of ["particle-step.hlsl","circle-mask.hlsl","julia-loop.hlsl","julia-rgba.hlsl","particles-rgba.hlsl"]){
            const shader=await readFile(join(folder,name),"utf8");
            const converted=await compileVerified(shader);
            assert.match(converted.wgsl,/@compute/);
            assert.equal(converted.mapping.u0,16);
            assert.equal(converted.cacheHit,false,"First compilation must run real tools");
            assert.ok(Number.isFinite(converted.compileMs),"Server must report compiler latency");
            console.log("PASS real DXC + Naga conversion:",name);
        }
        const shader=await readFile(join(folder,"julia-rgba.hlsl"),"utf8");
        const cached=await compileVerified(shader);
        assert.equal(cached.cacheHit,true,"Identical HLSL must reuse DXC/Naga translation");
        assert.equal(cached.compileMs,0,"Cache hit must skip compiler processes");
        assert.match(cached.wgsl,/@compute/);
        const recompiled=await compileVerified(shader+"\n// cache invalidation");
        assert.equal(recompiled.cacheHit,false,"Edited HLSL must invalidate compilation cache");
        console.log("PASS compiler cache hit/invalidation:",cached.cacheHit,recompiled.cacheHit);
    }
    assert.equal(await fetchedStatus(post("/api/session/close",{token:b})),200);
    await exited();
    assert.equal(ps.exitCode,0,"Server crashed: "+stderr);
    console.log("PASS PowerShell bridge: routes, request guards, 2 tabs, clean exit"+(integration?", real DXC+Naga compile":""));
}catch(error){
    console.error("PowerShell HTTP test failed:",error);
    console.error("SERVER STDERR:",stderr.slice(-12000));
    console.error("SERVER STDOUT:",stdout.slice(-12000));
    throw error;
}finally{
    if(ps.exitCode===null && ps.signalCode===null)ps.kill();
    await rm(temp,{recursive:true,force:true});
}
