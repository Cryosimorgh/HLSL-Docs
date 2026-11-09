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
const ps=spawn("powershell.exe",[
    "-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass",
    "-File",script,"-Port",String(port),"-DxcPath",dxc,"-NagaPath",naga,
    "-SiteRoot",folder,"-ReadyFile",ready,
    " -StartupGraceMs","9000","-LeaseTimeoutMs","8000","-ExitDelayMs","600"
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
        try {const r=await fetch(base+"/api/health");if(r.ok){readyOk=true;break;}}catch{}
        await sleep(100);
    }
    assert.ok(readyOk,"Server not ready: "+stderr+"\n"+stdout);
    const health=await(await fetch(base+"/api/health")).json();
    assert.equal(health.backend,"powershell-dotnet");
    const page=await fetch(base+"/");
    assert.equal(page.status,200);
    assert.match(await page.text(),/HLSL Compute Playground/);
    assert.equal((await fetch(base+"/browser-gpu.js")).status,200);
    assert.equal((await fetch(base+"/gpu-visualizer.js")).status,200,"GPU renderer script must be served.");
    assert.equal((await fetch(base+"/circle-mask.hlsl")).status,200,"Circle shader reference must be served.");
    assert.equal((await fetch(base+"/unknown")).status,404);
    const cors=await post("/api/session/open",{}, "http://untrusted.example");
    assert.equal(cors.status,403,"Origin policy must reject foreign pages");
    const one=await post("/api/session/open",{});
    const two=await post("/api/session/open",{});
    assert.equal(one.status,200);assert.equal(two.status,200);
    const a=(await one.json()).token,b=(await two.json()).token;
    assert.notEqual(a,b);
    let h=await(await fetch(base+"/api/health")).json();
    assert.equal(h.activeTabs,2);
    assert.equal((await post("/api/session/close",{token:a})).status,200);
    assert.equal((await post("/api/session/ping",{token:b})).status,200);
    h=await(await fetch(base+"/api/health")).json();
    assert.equal(h.activeTabs,1);
    const invalid=await post("/api/compile",{source:'#include "/etc/passwd"',entry:"CSMain"});
    assert.equal(invalid.status,400);
    if(integration){
        for(const name of ["particle-step.hlsl","circle-mask.hlsl"]){
            const shader=await readFile(join(folder,name),"utf8");
            const response=await post("/api/compile",{source:shader,entry:"CSMain"});
            if(response.status!==200) throw Error(name+" failed: "+await response.text());
            const converted=await response.json();
            assert.match(converted.wgsl,/@compute/);
            assert.equal(converted.mapping.u0,16);
            console.log("PASS real DXC + Naga conversion:",name);
        }
    }
    assert.equal((await post("/api/session/close",{token:b})).status,200);
    await exited();
    assert.equal(ps.exitCode,0,"Server crashed: "+stderr);
    console.log("PASS PowerShell bridge: routes, request guards, 2 tabs, clean exit"+(integration?", real DXC+Naga compile":""));
}finally{
    if(ps.exitCode===null && ps.signalCode===null)ps.kill();
    await rm(temp,{recursive:true,force:true});
}
