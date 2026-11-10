# HLSL Workbench v1.8.1 — Critical Browser Startup Fix

**This release supersedes v1.8.0.** The v1.8.0 Windows package can show a Julia animation button selected while the editor still contains the old JavaScript particle tutorial shader. Pressing Animate then fails with an error about an absent animation JSON manifest.

## Root cause and fix

The real browser threw `TypeError: Cannot read properties of null (reading 'setAttribute')` during startup because `setActivePreset()` referenced a nonexistent button ID, `example-rgba-particles`. This aborted `loadJulia()` **before** it populated the editor and the HLSL-only framebuffer configuration. The old inline tutorial also wrote a legacy particle shader on initial load, and the main runner separately loaded a circle preset, making startup fragile.

v1.8.1 corrects the preset ID list to match the real HTML, removes the competing legacy-shader initialization, and leaves the source-controlled Julia/particle animation script responsible for initial shader selection. Changes to the standalone JavaScript physics sandbox no longer silently overwrite a loaded framebuffer HLSL shader.

The obsolete error that simply demanded an `animation` JSON object is replaced with an explanation of the supported HLSL-only framebuffer convention if you actually load an incompatible shader.

## How to run the complete client

1. Download **HLSL-Playground-Windows-v1.8.1.zip**.
2. **Extract the entire ZIP into a new folder**, not over the older release.
3. Double-click **Start-HLSL-Playground.cmd** and use its newly opened localhost browser tab.
4. Confirm the editor starts with `#define WORKBENCH_WIDTH 256`, `cbuffer WorkbenchFrame : register(b7)` and `RWStructuredBuffer<float4> Framebuffer : register(u0)`, rather than the old `struct Ball` / `Source` / `Destination` shader.
5. Click **Animate**. The Julia fractal should produce time-changing RGB pixels on WebGPU; change to **GPU particles** to view individually colored moving procedural particles.
6. The browser should not ask for an animation JSON manifest for either built-in preset.

## Verified

- A **real headless Chromium end-to-end test** now loads the actual HTML and deferred scripts, verifies the Julia shader is present on startup, verifies the HLSL-only framebuffer spec and absence of animation JSON, switches to the GPU particles preset and back, changes the separate physics sandbox settings, and checks that no uncaught JavaScript exception or unexpected shader overwrite occurs.
- Static tests enforce that every preset referenced by the JavaScript initializer exists in the actual HTML.
- Existing mocked-WebGPU tests cover repeated dispatches, changing time values, pause/step/resume/reset and resource cleanup.
- Windows CI compiles the Julia and particle full-color HLSL shaders with real DXC→Naga, and verifies portable launcher startup, static assets and shutdown.
- Actual WebGPU rendering on every device/driver remains unverified by CI. A successful browser bootstrap does not itself guarantee WebGPU hardware support or target FPS.

The shader still computes all RGBA pixel values in HLSL, with automatic `WorkbenchFrame` timing; the browser controls frame scheduling and output presentation. The GPU particle preset uses independently moving procedural particles, **not** ball-to-ball collision physics.

The archive includes the complete portable Windows client, Microsoft DXC, Naga, launcher and shader sources. No Node, Rust or Zig installation is required; the previously quarantined custom Zig server is not included.

[Source repository](https://github.com/Cryosimorgh/HLSL-Docs) · [HLSL framebuffer guide](playground/README.md)
