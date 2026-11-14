// Real-time HLSL compute: compile once, dispatch repeatedly and advance a
// selected float32 uniform from requestAnimationFrame. No simulated frames.
// GPU buffers/pipeline persist until stopped; only the inspected output is
// copied to a reusable MAP_READ staging buffer each frame.
(() => {
  "use strict";
  const api=window.HLSLRunnerAPI;
  const $=id=>document.getElementById(id);
  const startButton=$("animate-gpu"),pauseButton=$("pause-gpu"),
        stepButton=$("step-gpu"),resetButton=$("reset-gpu");
  const fpsLabel=$("animation-fps"),frameLabel=$("animation-frames"),
        timeLabel=$("animation-time"),
        compileLabel=$("animation-compile-ms"),pipelineLabel=$("animation-pipeline-ms"),
        readbackLabel=$("animation-readback-ms"),drawLabel=$("animation-draw-ms"),
        firstFrameLabel=$("animation-first-frame-ms");
  if(!api||!startButton) return;
  const maxBytes=4*1024*1024,maxTotal=8*1024*1024;
  let current=null,starting=false,serial=0;
  const now=()=>performance.now();
  const setStatus=(s,error=false)=>api.setStatus(s,error);
  const updateUI=()=>{
    const active=!!current,playing=active&&current.running;
    startButton.disabled=starting||playing;
    startButton.textContent=starting?"Compiling…":(active?"Resume":"Animate");
    pauseButton.disabled=!playing;
    stepButton.disabled=starting;
    resetButton.disabled=starting;
    api.runButton.disabled=starting||playing;
  };
  const resetMetrics=()=>{
    fpsLabel.textContent="—";
    frameLabel.textContent="0";
    timeLabel.textContent="0.0 s";
    compileLabel.textContent="—";
    pipelineLabel.textContent="—";
    firstFrameLabel.textContent="—";
    readbackLabel.textContent="—";
    drawLabel.textContent="—";
  };
  const updateMetrics=(s,frameMs)=>{
    frameLabel.textContent=s.frameCount.toLocaleString();
    timeLabel.textContent=s.elapsed.toFixed(2)+" s";
    if(!s.lastMeasured) s.lastMeasured=now();
    if(now()-s.lastMeasured>=500){
      fpsLabel.textContent=(s.countSinceMeasured*1000/(now()-s.lastMeasured)).toFixed(1);
      s.countSinceMeasured=0;
      s.lastMeasured=now();
    }
    if(s.frameCount===1)fpsLabel.textContent="…";
  };
  function validateAnimation(spec) {
    const a=spec.animation;
    if(!a||typeof a!=="object")throw Error(
      "This HLSL shader has no built-in animation output. For manifestless animation, declare "+
      "RWStructuredBuffer<float4> Framebuffer : register(u0), "+
      "cbuffer WorkbenchFrame : register(b7), and WORKBENCH_WIDTH/HEIGHT in the HLSL source. "+
      "Select Julia animation or GPU particles for a working example. "+
      "Use Compile & Run HLSL for a one-shot buffer shader."
    );
    const binding=a.binding??32,component=a.component??0,
          speed=a.speed??1,fps=a.fps??30;
    if(!Number.isInteger(binding)||binding<0||binding>127||
       !Number.isInteger(component)||component<0||component>1023||
       !Number.isFinite(speed)||Math.abs(speed)>100||
       ![15,24,30,60].includes(fps))
      throw Error("Invalid animation binding/component/speed/fps (allowed FPS: 15,24,30,60).");
    const target=spec.resources.find(r=>r.binding===binding);
    if(!target||target.access!=="uniform"||!Array.isArray(target.data)||
       component>=target.data.length)
      throw Error("Animation binding must reference a float32 uniform data array and a valid component.");
    if((target.dataType||"f32")!=="f32")throw Error("Animation uniform must use float32 data.");
    return {binding,component,speed,fps};
  }
  function dispose(s) {
    if(s.disposed||s.inFlight)return;
    s.disposed=true;
    if(s.readback)try{s.readback.destroy()}catch{}
    for(const a of s.allocations)try{a.buffer.destroy()}catch{}
    try{s.device.destroy()}catch{}
  }
  function stop(){
    serial++;
    const s=current;
    if(!s){updateUI();return;}
    s.running=false;
    if(s.raf)cancelAnimationFrame(s.raf);
    s.raf=0;
    s.stopping=true;
    current=null;
    dispose(s);
    updateUI();
  }
  function pause(){
    if(!current||!current.running)return;
    current.running=false;
    if(current.raf)cancelAnimationFrame(current.raf);
    current.raf=0;
    current.lastTs=0;
    setStatus("Paused · frame "+current.frameCount+" · resume or step.");
    updateUI();
  }
  async function prepare(){
    if(!api.isBridgeOrigin)throw Error("Launch the Windows client and use its localhost tab to animate HLSL.");
    if(!navigator.gpu)throw Error("WebGPU is not available in this browser.");
    const spec=api.parseManifest(),source=api.editor.value,manifestText=api.manifestArea.value;
    const animation=validateAnimation(spec);
    if(!source||source.length>65536)throw Error("Invalid HLSL source length.");
    const compileStart=now();
    const compiled=await api.compileForWebGPU(source,spec.entry);
    const compileMs=now()-compileStart;
    const wgsl=compiled.wgsl;
    setStatus("HLSL "+(compiled.cacheHit?"cache hit":"compiled")+" in "+
      compileMs.toFixed(0)+" ms. Creating GPU pipeline…");
    api.wgslArea.textContent=wgsl;
    const entry=api.compiledEntry(wgsl),size=api.compiledSize(wgsl);
    const g=api.gridConfig(spec);
    const count=spec.resources.some(r=>r.preset==="grid")?
      g.width*g.height:window.HLSLPlayground.config().count;
    const dispatch=spec.dispatch==="auto"?
      spec.autoFramebuffer?
        [Math.ceil(spec.resources[0].visualize.grid.width/size[0]),
         Math.ceil(spec.resources[0].visualize.grid.height/size[1]),1]:
        [Math.ceil(count/size[0]),1,1]:
      spec.dispatch;
    if(dispatch.some(n=>!Number.isInteger(n)||n<1||n>1024))
      throw Error("Invalid dispatch size for animation.");
    const setupStart=now();
    const adapter=await navigator.gpu.requestAdapter();
    if(!adapter)throw Error("No WebGPU adapter available.");
    if(dispatch.some(n=>n>adapter.limits.maxComputeWorkgroupsPerDimension))
      throw Error("Workgroup dispatch exceeds GPU device limits.");
    const device=await adapter.requestDevice();
    const allocations=[];
    let readback=null;
    try {
      const module=device.createShaderModule({code:wgsl});
      const info=await module.getCompilationInfo();
      const errors=info.messages.filter(m=>m.type==="error");
      if(errors.length)throw Error("WGSL validation: "+errors.map(m=>m.message).join("; "));
      const pipeline=await device.createComputePipelineAsync({
        layout:"auto",compute:{module,entryPoint:entry}
      });
      let total=0;
      const entries=[];
      for(const r of spec.resources){
        const input=api.bytesFor(r,spec),length=Math.max(16,input.byteLength);
        if(length>maxBytes||(total+=length)>maxTotal)
          throw Error("Animation GPU buffer capacity exceeded.");
        if(r.access==="uniform"&&length%16)
          throw Error("Uniform buffer length must be a multiple of 16 bytes.");
        const usage=r.access==="uniform"?
          GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST:
          GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;
        const buffer=device.createBuffer({size:length,usage});
        if(input.byteLength)device.queue.writeBuffer(buffer,0,input);
        allocations.push({r,buffer,length,initial:input.slice()});
        entries.push({binding:r.binding,resource:{buffer}});
      }
      const bindGroup=device.createBindGroup({
        layout:pipeline.getBindGroupLayout(0),entries
      });
      const a=allocations.find(x=>x.r.binding===animation.binding);
      const inspect=allocations.find(x=>x.r.inspect===true);
      if(!a||!inspect||inspect.r.access==="uniform")
        throw Error("Animation requires an inspected output storage buffer.");
      if((animation.component+1)*4>a.length)
        throw Error("Animation component exceeds the uniform buffer length.");
      readback=device.createBuffer({
        size:inspect.length,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ
      });
      const initialPhase=new DataView(a.initial.buffer,a.initial.byteOffset,a.initial.byteLength)
        .getFloat32(animation.component*4,true);
      const s={
        device,pipeline,bindGroup,dispatch,allocations,readback,inspect,
        uniform:a,config:animation,initialPhase,phase:initialPhase,
        source,manifestText,autoFramebuffer:!!spec.autoFramebuffer,frameCount:0,elapsed:0,raf:0,lastTs:0,
        compileMs,pipelineMs:now()-setupStart,cacheHit:!!compiled.cacheHit,
        dxcMs:compiled.dxcMs,nagaMs:compiled.nagaMs,
        readbackMs:0,drawMs:0,
        running:false,inFlight:false,stopping:false,disposed:false,
        lastMeasured:0,countSinceMeasured:0
      };
      device.lost.then(info=>{
        if(current===s){
          stop();
          setStatus("WebGPU device lost: "+info.message,true);
        }
      });
      return s;
    }catch(e){
      if(readback)readback.destroy();
      for(const a of allocations)a.buffer.destroy();
      device.destroy();
      throw e;
    }
  }
  // At most ONE outstanding GPU submission/readback. No overlapped mapAsync.
  // requestAnimationFrame is used only for scheduling, not for faking pixels.
  async function frame(s,dt=1/30){
    if(s.inFlight||s.disposed||s.stopping)return;
    s.inFlight=true;
    const start=now();
    try{
      s.phase+=dt*s.config.speed;
      s.elapsed+=dt;
      const uniform=s.uniform.initial.slice();
      const values=new DataView(uniform.buffer,uniform.byteOffset,uniform.byteLength);
      values.setFloat32(s.config.component*4,s.phase,true);
      if(s.autoFramebuffer){
        // WorkbenchFrame (b7) is defined in HLSL: Time, DeltaTime, Width,
        // Height, Frame. All source-controlled except host timing itself.
        values.setFloat32(4,dt,true);
        values.setFloat32(16,s.frameCount+1,true);
      }
      s.device.queue.writeBuffer(s.uniform.buffer,0,uniform);
      const encoder=s.device.createCommandEncoder();
      const pass=encoder.beginComputePass();
      pass.setPipeline(s.pipeline);
      pass.setBindGroup(0,s.bindGroup);
      pass.dispatchWorkgroups(...s.dispatch);
      pass.end();
      encoder.copyBufferToBuffer(s.inspect.buffer,0,s.readback,0,s.inspect.length);
      const readbackStart=now();
      s.device.queue.submit([encoder.finish()]);
      await s.readback.mapAsync(GPUMapMode.READ);
      // Render directly from the mapped range while it is valid. No 1 MiB
      // per-frame ArrayBuffer copy; finally unmaps before the next dispatch.
      const data=s.readback.getMappedRange();
      if(s.stopping||current!==s)return;
      s.readbackMs=now()-readbackStart;
      const drawStart=now();
      window.HLSLGPUVisualize.render({
        bytes:data,format:s.inspect.r.display||"f32",
        binding:s.inspect.r.binding,visualize:s.inspect.r.visualize,
        source:s.source,worldWidth:api.gridConfig({resources:[]}).xMax
      });
      s.drawMs=now()-drawStart;
      s.frameCount++;
      if(s.frameCount===1&&s.startClickMs)
        firstFrameLabel.textContent=(now()-s.startClickMs).toFixed(0)+" ms";
      if(s.frameCount===1||s.frameCount%15===0){
        readbackLabel.textContent=s.readbackMs.toFixed(1)+" ms";
        drawLabel.textContent=s.drawMs.toFixed(1)+" ms";
      }
      s.countSinceMeasured++;
      updateMetrics(s,now()-start);
      // Avoid rebuilding a long textual dump on every animation frame.
      if(s.frameCount===1||s.frameCount%30===0){
        api.results.textContent="Continuous GPU compute · frame "+s.frameCount+
          "\nPhase: "+s.phase.toFixed(4)+
          "\nDispatch: "+s.dispatch.join(" × ")+
          "\nGPU buffer: "+s.inspect.length+" bytes"+
          "\nFrame includes GPU readback; see the live image above."+
          "\n\nFirst results:\n"+api.showBuffer(data,s.inspect.r.display||"f32");
      }
      if(s.frameCount===1||s.frameCount%30===0)
        setStatus("Animating · "+s.frameCount+" real WebGPU dispatches completed.");
    }finally{
      // A buffer must be unmapped before it can be the target of another copy.
      if(s.readback.mapState==="mapped")s.readback.unmap();
      s.inFlight=false;
      if(s.stopping)dispose(s);
    }
  }
  function schedule(s){
    if(!s.running||s.raf||s.stopping)return;
    s.raf=requestAnimationFrame(async timestamp=>{
      s.raf=0;
      if(current!==s||!s.running||document.hidden)return;
      const interval=1000/s.config.fps;
      if(s.lastTs && timestamp-s.lastTs<interval-1){
        schedule(s);return;
      }
      const dt=s.lastTs?Math.min(Math.max((timestamp-s.lastTs)/1000,0),0.15):1/s.config.fps;
      s.lastTs=timestamp;
      try{await frame(s,dt)}
      catch(e){
        stop();
        api.results.textContent=String(e.stack||e);
        $("debug-output-panel").open=true;
        setStatus("Animation failed: "+e.message,true);
      }
      if(current===s&&s.running)schedule(s);
    });
  }
  async function start(){
    if(starting)return;
    if(current&&(current.source!==api.editor.value||(!current.autoFramebuffer&&current.manifestText!==api.manifestArea.value))){
      stop(); // Rebuild when user changes shader or resource configuration.
    }
    if(current){
      if(!current.running){current.running=true;current.lastTs=0;schedule(current);updateUI();setStatus("Resumed continuous GPU animation.");}
      return;
    }
    const ticket=++serial;
    const startClickMs=now();
    starting=true;updateUI();
    setStatus("Compiling HLSL once for continuous GPU animation…");
    try {
      const session=await prepare();
      if(ticket!==serial){session.stopping=true;dispose(session);return;}
      current=session;
      session.startClickMs=startClickMs;
      resetMetrics();
      compileLabel.textContent=session.compileMs.toFixed(0)+" ms"+(session.cacheHit?" (cached)":"");
      pipelineLabel.textContent=session.pipelineMs.toFixed(0)+" ms";
      compileLabel.title=session.cacheHit?"Cached compiler output":
        "DXC "+session.dxcMs+" ms; Naga "+session.nagaMs+" ms";
      current.running=true;
      schedule(current);
      setStatus("Running · shader compiled once; time uniform updates every GPU frame.");
    }catch(e){
      api.results.textContent=String(e.stack||e);
      $("debug-output-panel").open=true;
      setStatus("Animation failed: "+e.message,true);
    }finally{starting=false;updateUI();}
  }
  async function step(){
    if(starting)return;
    if(current&&(current.source!==api.editor.value||(!current.autoFramebuffer&&current.manifestText!==api.manifestArea.value)))stop();
    if(!current){
      await start();
      if(!current)return;
      pause();
      // scheduled first frame may not run before pause, so force one.
    }else pause();
    try{await frame(current,1/current.config.fps)}
    catch(e){stop();setStatus("GPU step failed: "+e.message,true);}
  }
  async function reset(){
    if(starting)return;
    if(!current){resetMetrics();window.HLSLGPUVisualize.clear();return;}
    pause();
    if(current.inFlight){
      // The pending frame owns the mapping; pause and wait for its completion.
      while(current&&current.inFlight)await new Promise(r=>requestAnimationFrame(r));
    }
    if(!current)return;
    const s=current;
    for(const a of s.allocations){
      s.device.queue.writeBuffer(a.buffer,0,a.initial);
    }
    s.phase=s.initialPhase;s.frameCount=0;s.elapsed=0;s.lastTs=0;
    s.lastMeasured=0;s.countSinceMeasured=0;
    resetMetrics();
    await frame(s,0);
    setStatus("Animation reset · initial GPU state restored.");
  }
  startButton.addEventListener("click",()=>{void start()});
  pauseButton.addEventListener("click",pause);
  stepButton.addEventListener("click",()=>{void step()});
  resetButton.addEventListener("click",()=>{void reset()});
  window.addEventListener("pagehide",stop);
  document.addEventListener("visibilitychange",()=>{
    if(document.hidden&&current?.running)pause();
  });

  // Source file is the authority for dimensions, GPU color, and time usage.
  // No animation resource JSON is required or accepted in this mode.
  const builtins={
    julia:"// Pure HLSL animated Julia fractal with its OWN RGB colors.\n// The Workbench auto-detects Framebuffer:u0, WorkbenchFrame:b7 and defines.\n// No animation manifest or input-position buffer is required.\n#define WORKBENCH_WIDTH 192\n#define WORKBENCH_HEIGHT 192\ncbuffer WorkbenchFrame : register(b7)\n{\n    float Time;\n    float DeltaTime;\n    float Width;\n    float Height;\n    float Frame;\n    float Padding0;\n    float Padding1;\n    float Padding2;\n};\nRWStructuredBuffer<float4> Framebuffer : register(u0);\n\nfloat3 FractalColor(float t)\n{\n    float3 a = float3(0.02f, 0.04f, 0.10f);\n    float3 b = float3(0.04f, 0.45f, 0.68f);\n    float3 c = float3(1.00f, 0.55f, 0.20f);\n    float3 d = float3(1.00f, 0.90f, 0.62f);\n    float3 lower = lerp(a, b, smoothstep(0.0f, 0.4f, t));\n    float3 upper = lerp(c, d, smoothstep(0.55f, 1.0f, t));\n    return lerp(lower, upper, smoothstep(0.35f, 0.75f, t));\n}\n\n[numthreads(8, 8, 1)]\nvoid CSMain(uint3 tid : SV_DispatchThreadID)\n{\n    if (tid.x >= WORKBENCH_WIDTH || tid.y >= WORKBENCH_HEIGHT) return;\n    uint i = tid.y * WORKBENCH_WIDTH + tid.x;\n    float2 uv = (float2(tid.xy) + 0.5f) /\n                float2(WORKBENCH_WIDTH, WORKBENCH_HEIGHT);\n\n    float2 z = (uv - 0.5f) * 3.1f;\n    float2 c = float2(-0.745f + 0.18f * cos(Time * 0.32f),\n                       0.186f + 0.14f * sin(Time * 0.23f));\n    uint n = 0u;\n    float m2 = 0.0f;\n    [loop]\n    for (uint k = 0u; k < 90u; ++k)\n    {\n        m2 = dot(z, z);\n        if (m2 > 256.0f) break;\n        z = float2(z.x*z.x - z.y*z.y, 2.0f*z.x*z.y) + c;\n        ++n;\n    }\n    float escaped = (float)n / 90.0f;\n    float3 rgb = FractalColor(saturate(pow(escaped, 0.55f)));\n    if (n == 90u) rgb = float3(0.008f, 0.014f, 0.026f);\n    Framebuffer[i] = float4(saturate(rgb), 1.0f);\n}\n",
    particles:"// Pure HLSL GPU-rendered moving particles.\n// Each pixel receives its RGB color from this shader, NOT from JavaScript.\n// Particles follow independent triangular-wave bouncing trajectories.\n// This is a procedural visual demo, not an inter-particle collision solver.\n#define WORKBENCH_WIDTH 192\n#define WORKBENCH_HEIGHT 192\ncbuffer WorkbenchFrame : register(b7)\n{\n    float Time;\n    float DeltaTime;\n    float Width;\n    float Height;\n    float Frame;\n    float Padding0;\n    float Padding1;\n    float Padding2;\n};\nRWStructuredBuffer<float4> Framebuffer : register(u0);\n\nfloat Hash(float x)\n{\n    uint u = asuint(x);\n    u ^= u >> 16u;\n    u *= 0x7feb352du;\n    u ^= u >> 15u;\n    u *= 0x846ca68bu;\n    u ^= u >> 16u;\n    return float(u & 0x00ffffffu) / 16777215.0f;\n}\nfloat2 Bounce(float2 v) { return 1.0f - abs(frac(v) * 2.0f - 1.0f); }\n\n[numthreads(8, 8, 1)]\nvoid CSMain(uint3 tid : SV_DispatchThreadID)\n{\n    if (tid.x >= WORKBENCH_WIDTH || tid.y >= WORKBENCH_HEIGHT) return;\n    uint i = tid.y * WORKBENCH_WIDTH + tid.x;\n    float2 uv = (float2(tid.xy) + 0.5f) /\n                float2(WORKBENCH_WIDTH, WORKBENCH_HEIGHT);\n\n    float3 rgb = float3(0.009f, 0.016f, 0.028f);\n    float2 coord = uv;\n    for (uint p = 0u; p < 24u; ++p)\n    {\n        float k = float(p) + 1.0f;\n        float2 start = float2(Hash(k * 1.3f), Hash(k * 2.1f));\n        float2 velocity = float2(0.08f + 0.10f*Hash(k*3.7f),\n                                  0.07f + 0.11f*Hash(k*4.3f));\n        float2 pos = 0.08f + 0.84f *\n          Bounce(start + Time * velocity * float2(1.0f, 1.2f));\n        float2 diff = coord - pos;\n        float d2 = dot(diff, diff);\n        float radius = 0.010f + 0.009f * Hash(k*5.3f);\n        float core = 1.0f - smoothstep(radius*radius*0.36f, radius*radius, d2);\n        float halo = (1.0f - smoothstep(radius*radius, radius*radius*9.0f, d2)) * 0.22f;\n        float3 particle = float3(\n            0.30f + 0.70f*Hash(k*6.7f),\n            0.35f + 0.65f*Hash(k*7.7f),\n            0.42f + 0.58f*Hash(k*8.7f)\n        );\n        rgb += particle * (core + halo);\n    }\n    Framebuffer[i] = float4(saturate(rgb), 1.0f);\n}\n"
  };
  function loadBuiltin(which){
    stop();
    const isJulia=which==="julia";
    api.setActivePreset(isJulia?"example-julia":"restore-example");
    api.editor.value=builtins[which];
    api.editor.dataset.dirty="1";
    window.HLSLHighlight?.refresh();
    api.manifestArea.value=JSON.stringify({
      note:"Frame data and the RGBA GPU output are inferred from HLSL. No animation manifest required.",
      mode:"source-controlled"
    },null,2);
    window.HLSLGPUVisualize.clear();
    resetMetrics();
    api.results.textContent="Ready: HLSL defines Framebuffer:u0 (RGBA) and WorkbenchFrame:b7 (time). Click Animate.";
    setStatus((isJulia?"Julia fractal":"Moving colored particles")+
      " ready · GPU colors and motion are computed in HLSL.");
  }
  function loadJulia(){loadBuiltin("julia");}
  function loadParticles(){loadBuiltin("particles");}
  $("example-julia").addEventListener("click",loadJulia);
  window.HLSLAnimation={stop,pause,start,step,reset,loadJulia,loadParticles};
  updateUI();
  loadJulia();
})();