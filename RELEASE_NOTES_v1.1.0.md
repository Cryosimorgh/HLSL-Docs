# HLSL Engineer Skill v1.1.0 — Editable Shader Playground

Released November 2026.

## What's new

- The shader example is now an **editable HLSL source editor**, not a read-only code preview.
- The editor preserves user modifications when sliders change. Copy / save now use **the edited code**; a Reset example button restores the starter.
- Added a **Run on GPU** button, compiler diagnostics, output-buffer inspector and an optional generated-WGSL view.
- Added an editable **buffer and dispatch JSON** contract so shaders can receive custom f32/u32/i32 arrays, constant buffers and read/write buffer allocations.
- Includes two ready-to-use compute examples: **particle physics** and **array scaling**.
- Added a **local-only compiler bridge** running DXC (HLSL → SPIR-V) and Naga (SPIR-V → WGSL), plus browser WebGPU execution of compatible compute kernels.
- Added a regression test for the HTML/JavaScript editor, local HTTP routes and compiler-process wiring.

## How to use

1. Extract the ZIP or clone the repository.
2. For **offline learning**, open \`playground/index.html\`. The editor, JavaScript particle animation and saving source work without any server.
3. For **real GPU compute**, install Node.js 20+, DXC with the SPIR-V backend and Naga CLI (\`cargo install naga-cli --locked\`). Use a WebGPU-capable desktop browser.
4. From the repository root, run \`node playground/server.mjs\` and open **http://127.0.0.1:4173/**.
5. Edit the shader and resource JSON, then click **Run on GPU**. Read the result buffer and compilation diagnostics.
6. See [the setup guide](playground/README.md) for the binding contract, limits and experiments.

## Compatibility / technical boundaries

- The browser runs **WGSL translated from HLSL** using WebGPU; this is **not** native DXIL execution through Direct3D 12.
- The included host is **compute-only and buffer-oriented**. It does **not** execute arbitrary graphics, mesh, ray-tracing or unsupported shader-model programs.
- The editable source needs an entry point, suitable workgroup size, and matching JSON host bindings and buffer layout.
- The offline simulation remains JavaScript. Changing or running the HLSL editor is a separate operation.
- Local shaders can hang the GPU or cause device resets. Run only trusted code.
- DXC/Naga toolchain binaries are not bundled.

## Validation

**Passed in GitHub Actions:** Node.js syntax checks of the HTML scripts and browser runner, local-only server / input validation and origin checks, mock compiler process integration.

**Unverified:** Real DXC SPIR-V → Naga WGSL compilation and real GPU execution. The CI runner could not retrieve the published DXC binary due to upstream HTTP 504, so it did not run the genuine converter. Do not interpret green smoke tests as GPU-runtime qualification. Test on a local system with DXC, Naga and WebGPU before relying on results.

## Files

~~~text
.agents/skills/hlsl-engineer/           Agent Skill and reference sheets
playground/index.html                   Editable HLSL tutorial and canvas
playground/live-runner.js               WebGPU run / buffer binding / readback
playground/server.mjs                   Local-only DXC/Naga compile service
playground/particle-step.hlsl           Actual compute shader example
playground/test.mjs                     Node.js smoke checks
playground/README.md                    Full setup and binding guide
HLSL-Handbook.md                        Complete reference
~~~

[Repository](https://github.com/Cryosimorgh/HLSL-Docs) · [Playground guide](playground/README.md) · [Skill](.agents/skills/hlsl-engineer/SKILL.md)
