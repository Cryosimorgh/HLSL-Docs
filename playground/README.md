# Interactive HLSL Compute Shader Playground

**[Open the tutorial source](index.html)** · **[View the real compute shader](particle-step.hlsl)** · **[HLSL Handbook](../README.md)**

The offline mode is a small, dependency-free tutorial for learning what **HLSL compute shaders** do. It makes parameters and dispatch sizes visible before you build a full Direct3D 12 host application.

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

## Edit and actually run a compute shader on the GPU

The lower-left code box is now an editable HLSL editor. It supports two modes:

- **Offline learning (open index.html directly):** edit, copy and save the source. The particle canvas uses its independent JavaScript model and the **Run on GPU** action explains that the compiler bridge is needed.
- **Real GPU execution (local server):** edit source and buffer bindings, compile with DXC's SPIR-V backend, translate to WGSL using Naga, then dispatch using the browser's **WebGPU** device. The result buffers appear under the editor; compatible particle output can also update the canvas.

**Requirements:** Node.js 20+, DXC with SPIR-V codegen enabled, [Naga CLI](https://github.com/gfx-rs/wgpu/tree/trunk/naga) and a modern WebGPU browser (for example recent Chrome/Edge with a capable GPU).

Install Naga (requires Rust/Cargo):

~~~powershell
cargo install naga-cli --locked
~~~

Install DXC from [Microsoft's releases](https://github.com/microsoft/DirectXShaderCompiler/releases), and ensure `dxc` and `naga` are on PATH. From the **repository root** run:

~~~powershell
node playground/server.mjs
~~~

Open **http://127.0.0.1:4173/** in a WebGPU-compatible browser. If required, set environment variables `DXC_PATH`, `NAGA_PATH` and `HLSL_PORT` before starting the server.

### Run a different HLSL program

1. Click **Array example** under the editor. The shader doubles eight floats.
2. Edit the HLSL body (for example, change the multiplier from `2.0` to `3.0`).
3. Inspect **Buffer bindings and dispatch** JSON. This example binds t0 at WebGPU binding **0**, u0 at **16**, and reads output 16; inputs are eight float32 values.
4. Click **Run on GPU**. The tool shows DXC/Naga diagnostics, the computed output array and optionally the generated WGSL.
5. Change the JSON and shader to experiment with another compute buffer layout or entry point.

The resource JSON format supports:

| Key | Meaning |
| --- | --- |
| `entry` | HLSL compute entry function, default `CSMain` |
| `dispatch` | `"auto"` for one-dimensional current particle count, or `[x,y,z]` explicit workgroup counts |
| `resources[].binding` | WebGPU binding number (DXC t0→0, u0→16, b0→32 by default) |
| `resources[].access` | `read`, `read_write` or `uniform` |
| `resources[].dataType` | `f32`, `u32` or `i32` for custom `data` input arrays |
| `resources[].data` | CPU-uploaded array of numeric values; 4 bytes per value |
| `resources[].preset` | `particles` or `parameters`; values pulled from top sliders and live model |
| `resources[].byteLength` | Zero-initialized buffer length in bytes or `"particles"` |
| `resources[].inspect` | If true, copy this storage buffer to CPU after dispatch |
| `resources[].display` | Output decode: `f32`, `u32`, `i32`, `vec4` |
| `resources[].applyToCanvas` | Interpret vec4 values as (x,y,vx,vy) and display the GPU state |

**Not literally any HLSL program:** This runner is a **compute-only, buffer-oriented host**. Graphics shaders need vertex inputs, attachments and a render pipeline; ray tracing needs a different GPU API. Compute shaders using unsupported intrinsics, textures, samplers, groups beyond limits, device-only features, unsupported SPIR-V-to-WGSL transforms or arbitrary host layouts can fail. WebGPU executes **WGSL translated from your HLSL**, not native DXIL/D3D12. For direct HLSL on D3D12, a native D3D12 host is needed.

**Security:** The compiler bridge is bound to 127.0.0.1, rejects cross-origin requests and `#include` directives, applies size and compilation time limits, and never shells out through editable command strings. Untrusted GPU shaders can nevertheless hang a GPU or trigger a driver/device reset. Only run source you trust.

### Run the test harness

~~~powershell
node playground/test.mjs
~~~

This checks the editor's JavaScript syntax, the local server and basic error handling with **mock compiler binaries**, not real GPU execution. The repository's GitHub Actions workflow also attempts a DXC → Naga shader translation smoke test on Linux.

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
