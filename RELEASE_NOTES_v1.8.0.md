# HLSL Workbench v1.8.0 — Pure-HLSL Colors and Manifestless Animation

The previous particle preset produced near-zero third-channel values, rendered them as point colors, and did not show a meaningful moving scene. The animation JSON was also required merely to animate a time uniform.

**v1.8.0 introduces an explicit, source-defined GPU framebuffer contract.** In this mode the shader computes every RGBA pixel itself and the host supplies frame timing automatically. No `animation` JSON or separate input buffer is needed.

## Windows: complete client

Download **HLSL-Playground-Windows-v1.8.0.zip**, extract everything to a new folder, and double-click `Start-HLSL-Playground.cmd`. The complete package includes PowerShell/.NET launcher, DXC, Naga, editor, sample shaders, and runtime. No Rust, Node or Zig installation is needed.

At startup **Julia animation** is selected. Press **Animate**, not `Compile & Run HLSL` (which intentionally dispatches once). The fractal now writes its own RGB channels in HLSL via `FractalColor`. To inspect an alternative, select **GPU particles** and press **Animate**. Each simulated pixel's color is computed in the HLSL shader and written into a `float4` framebuffer; the browser is not choosing particle colors or interpreting velocities as colors.

The particle preset demonstrates **procedural bouncing particle trajectories**, not ball-to-ball collision physics or a persistent solver. It does nevertheless execute all visual/motion/color mathematics on the GPU.

## Self-contained HLSL contract

Place these declarations inside your HLSL compute shader:

```hlsl
#define WORKBENCH_WIDTH 256
#define WORKBENCH_HEIGHT 256

cbuffer WorkbenchFrame : register(b7)
{
    float Time;
    float DeltaTime;
    float Width;
    float Height;
    float Frame;
    float Padding0;
    float Padding1;
    float Padding2;
};

RWStructuredBuffer<float4> Framebuffer : register(u0);
```

Then define `[numthreads(8,8,1)] void CSMain(uint3 tid : SV_DispatchThreadID)` and write `Framebuffer[tid.y*WORKBENCH_WIDTH+tid.x] = float4(r,g,b,a)` after checking bounds.

The host detects `Framebuffer:u0`, `WorkbenchFrame:b7` and `WORKBENCH_WIDTH/HEIGHT` **directly from HLSL** and allocates the output buffer and time uniform. `u0` maps to WebGPU binding 16, and `b7` to binding 39 through DXC register shifts. Workgroup dispatch is derived from the compiled shader's `numthreads` size. Resolution must be 32–512 pixels per dimension with no more than 4 MiB of output (RGBA float32).

Each frame, the host updates `Time`, `DeltaTime` and `Frame` and executes the shader again. A successful readback of `Framebuffer` is displayed as the actual RGB/alpha image, not a JavaScript-generated palette, velocity scatter plot or demonstration approximation. The client also reports brightness-based statistics.

This is still an API convention, not a claim that arbitrary HLSL code can create an OS animation loop: **JavaScript must schedule WebGPU dispatches**, and WebGPU must marshal output pixels to the browser canvas. Pure HLSL controls rendered content, pixel color and time-dependent behavior; the host owns scheduling and resource presentation.

## Examples included

- `playground/julia-rgba.hlsl`: animated Julia fractal with RGB palette code in HLSL.
- `playground/particles-rgba.hlsl`: 24 independently moving, colored procedural particles using HLSL-defined bouncing trajectories and glow.
- Older compute samples and advanced manual JSON bindings remain supported for non-framebuffer shaders.

## Validation

- Unit tests verify HLSL-only framebuffer inference, output resolution, b7 timing mapping, RGBA readback, and repeated WebGPU submissions with changing time and no animation JSON.
- Windows CI compiles both RGB examples using **real DXC→Naga** via the PowerShell compiler API.
- Windows release CI tests the full extracted package's launcher, shader compilation and shutdown.
- Browser hardware performance and correctness on your GPU still require local verification. Continuous readback can constrain achieved FPS.
- The quarantined older custom Zig `hlsl-server.exe` is not shipped.

Repository: https://github.com/Cryosimorgh/HLSL-Docs
