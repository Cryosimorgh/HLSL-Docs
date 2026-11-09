# Interactive HLSL Compute Shader Playground

**[Open the tutorial source](index.html)** · **[View the real compute shader](particle-step.hlsl)** · **[HLSL Handbook](../README.md)**

This is a small, dependency-free tutorial for learning what **HLSL compute shaders** do. It makes parameters and dispatch sizes visible before you build a full Direct3D 12 host application.

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
