# Interactive HLSL Compute Shader Playground

## Current safe way to run GPU code

**Native Windows HLSL execution is temporarily disabled.** The older Zig server executable was quarantined by Defender as `Trojan:Win32/Sabsik.TE.A!ml` and reported a `0xC0000005` access violation. Do not restore, allowlist, or run previous binary releases. See [security issue #1](https://github.com/Cryosimorgh/HLSL-Docs/issues/1).

The tutorial now includes an **independent, editable WGSL compute lab** that needs no native executable or local server. Open `playground/index.html` in a browser with WebGPU support and use **Run WGSL on GPU**. Change the shader's multiplier or input array, then inspect the GPU-computed output. This runs *WGSL*, WebGPU's shading language, **not HLSL**. You can still edit, copy and save HLSL in the separate panel, but compiling/running it is on hold pending security review. Offline JavaScript particle animation works even without WebGPU.

For direct GPU execution, WebGPU must be available in the browser context; if the file URL doesn't expose it, host the files with a trusted static HTTPS server. Do not use the quarantined Zig executable to serve the page.

### Security and compatibility fix underway

The Zig backend source no longer terminates its process from detached request threads. Its idle monitor signals the main thread and wakes the socket to permit orderly shutdown. CI now checks clean exit codes and parallel localhost clients on Windows and Linux. This addresses a **plausible crash mechanism**, but does **not** prove the user's access violation is resolved or change the Defender classification. Native binaries remain on hold until independent review.



**[Open the tutorial source](index.html)** · **[View the real compute shader](particle-step.hlsl)** · **[HLSL Handbook](../README.md)**

The offline mode is a small, dependency-free tutorial for learning what **HLSL compute shaders** do. It makes parameters and dispatch sizes visible before you build a full Direct3D 12 host application.

## Browser-only usage (recommended while native binaries are on hold)

1. Download the [current source ZIP](https://github.com/Cryosimorgh/HLSL-Docs/archive/refs/heads/main.zip), extract it and open `playground/index.html`.
2. Use the **WGSL** editor and **Run WGSL on GPU** with a WebGPU-capable browser. The editor's output comes from a real WebGPU compute dispatch, without a downloaded native server.
3. Change the multiplier in the WGSL source and compare results. The HTML also contains the offline JavaScript physics simulation and the HLSL code viewer.

**Safety:** The old Windows portable binaries remain under investigation. Do not start `hlsl-server.exe` or use previous ZIPs; the current Windows launcher intentionally blocks execution. The source-tree Zig HTTP server has been refactored and stress-tested, but has **not** been cleared for distribution by Microsoft's security review.

### Developer-only Zig backend source

The Zig 0.13 source remains available at `playground/zig-server.zig` for auditing. The automated Windows and Linux tests use an explicit `-mcpu baseline` target and assert a clean zero-code process exit; those tests are **not** a malware classification or a guarantee for every device. If the Microsoft security and independent reproduction gates eventually pass, the project can build a reviewed, signed distribution.

## Run it

1. Download the repository ZIP via GitHub's **Code → Download ZIP** (or clone it).
2. Open **playground/index.html** in a modern browser. No server, packages, internet or compilation needed.
3. Change the **particle count**, **gravity**, **restitution**, **drag**, **fixed timestep**, **threads per group** and **playback speed** controls.
4. Pause, step one frame, reset, and drag on the canvas to launch balls. The demo stops at 256 bodies.
5. Watch workgroup occupancy and idle-lane counts update. Read the shader snippet and click **Save .hlsl file**.

> **Important:** The visualization runs **JavaScript**, not HLSL. Its math and per-thread indexing model correspond to the included HLSL compute shader. It does not run on the GPU, benchmark shader throughput, or teach real GPU scheduling. The .hlsl file is real shader source that can be compiled with DXC; executing it needs a compatible Direct3D host.

## Try these experiments

| Settings | Prediction | What to learn |
|---|---|---|
| 65 bodies, group 64 | 2 groups, 63 idle lanes | ceil(count / numthreads) and bounds guards |
| 128 bodies, group 64 | 2 groups, zero idle lanes | Exact workgroup partition |
| Bounce 0 versus 1 | Lose normal velocity versus elastic boundary response | Restitution |
| Gravity 0 versus 5 | Drift versus accelerating downward motion | Integration |
| Timestep 4ms versus 40ms | Larger timesteps change collision overshoot/error | Numerical stability |
| Drag 0 versus 2 | Persistent versus damped motion | exp(-drag * dt) |

## HLSL source editor — native execution paused

The HLSL panel remains editable: change shader code, inspect the example's resource-binding JSON, copy it or save a `.hlsl` file. The **Run HLSL** control is intentionally disabled while the native backend's Defender detection and access-violation crash remain under investigation.

The old architecture was HLSL → DXC SPIR-V → Naga WGSL → WebGPU, with explicit resources at t0, u0 and b0. The Zig server source and tests remain available for review, but **do not execute the previously quarantined compiled server or use historical portable releases**.

### Run WGSL directly instead

The independent browser-only exercise directly accepts WGSL (WebGPU Shading Language). It initializes a float array, executes a WGSL compute shader using two storage bindings and shows the resulting output array. It does not perform any HLSL compilation.

To learn the relationship between languages, compare the HLSL `[numthreads(64,1,1)]` and `SV_DispatchThreadID` constructs with WGSL `@workgroup_size(64)` and `@builtin(global_invocation_id)`. Both represent related compute concepts, but they are **not** interchangeable source languages.

## Compile actual HLSL

Requires [Microsoft DirectX Shader Compiler (DXC)](https://github.com/microsoft/DirectXShaderCompiler) in PATH.

~~~powershell
cd playground
dxc -T cs_6_0 -E CSMain -Fo particle-step.dxil particle-step.hlsl

# Choose a different compile-time workgroup size:
dxc -T cs_6_0 -E CSMain -D GROUP_SIZE=128 -Fo particle-step-128.dxil particle-step.hlsl
~~~

This produces **DXIL**, not a standalone executable. A D3D12 application must:

1. Create and upload the initial **Ball** struct array into an SRV buffer (t0).
2. Create an output UAV buffer (u0) with sufficient capacity; bind the **Params** CBV (b0) using HLSL cbuffer packing.
3. Create a compatible root signature and compute pipeline state from the compiled shader.
4. Dispatch ceil(count/GROUP_SIZE) groups.
5. Add the correct UAV/resource barriers and transfer the result before the next iteration; double-buffer source/destination rather than reading partially updated values.
6. Read back after GPU fence completion to validate results.

The HLSL source is intentionally small: it handles **one ball per invocation** and collides only with the **four boundary walls**, not with other balls.

## File map

~~~text
playground/
  index.html             Browser-only interactive tutorial (HTML/CSS/JS)
  particle-step.hlsl     Matching real HLSL compute kernel for DXC
  README.md              This guide
~~~

## Accuracy notes

- The simulation uses a fixed timestep and explicit Euler-style velocity/position update, with exponential velocity damping.
- Ball positions use normalized vertical coordinates 0..1 and an aspect-ratio-derived horizontal world extent. Y increases downward.
- Sliders represent **host-uploaded cbuffer values** in a native D3D12 implementation, but the browser stores them as JavaScript numbers.
- The workgroup demonstration is a sequential model of thread indexing—not a real parallel GPU implementation.
- No shader binary or native GPU test was executed for this tutorial in the documentation environment.

For deeper reading: [compute + memory](../docs/03-compute-memory.md), [resources + D3D12 host](../docs/04-resources-host.md), and [Sunder physics patterns](../docs/07-sunder-case-study.md).
