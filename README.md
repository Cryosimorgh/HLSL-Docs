# HLSL Handbook — High-Level Shader Language, DirectX 12 & GPU Shader Programming

**A practical HLSL reference and tutorial** for graphics shaders, compute shaders, DirectX 12, DirectX Shader Compiler (DXC), Shader Model 6, GPU memory, texture sampling, resource bindings and shader intrinsics.

Learn **how the HLSL language and GPU pipeline fit together**, with diagrams, annotated code, explanations of **what each API does and why it is used**, common failure modes and links to Microsoft's canonical specifications. Includes real HLSL patterns from the [Sunder GPU physics engine](https://github.com/Cryosimorgh/Sunder).

**[Read or save the complete single-file Markdown edition →](HLSL-Handbook.md)** · [Browse the chapter index below](#start-here-the-complete-hlsl-guide)

> Independent learning resource; **not official Microsoft documentation**. Focus: modern Direct3D 12 + DXC + SM6.x. Differences for D3D11/FXC and newer hardware features are explicitly marked. Last reviewed: **9 November 2026**.

## Run the HLSL compute client on Windows (v1.5.0)

**[Download the Windows HLSL client](https://github.com/Cryosimorgh/HLSL-Docs/releases/download/v1.5.0/HLSL-Playground-Windows-v1.5.1.zip)** · [Release notes, checksum and compiler tools](https://github.com/Cryosimorgh/HLSL-Docs/releases/tag/v1.5.1)

Extract the ZIP, double-click **Start-HLSL-Playground.cmd**, and use the new localhost browser tab. Click **Array example**, edit the HLSL code, then **Compile & Run HLSL**. The resulting buffer values are shown underneath. No Node, Zig or Rust installation is required.

The client uses Windows PowerShell/.NET as an auditable **localhost compiler host**, Microsoft DXC to compile HLSL to SPIR-V, prebuilt Naga to generate WGSL, and browser WebGPU to execute compatible compute shaders. The local host stops after the final tab disconnects.

A source checkout also works: its updated launcher downloads only the compiler tools from the versioned GitHub release, validates their SHA-256, and caches them privately. It never launches the older Zig `hlsl-server.exe`.

**Compatibility boundaries:** This is a supported buffer-oriented **compute-shader** host, not a universal HLSL/Direct3D execution environment. WebGPU support depends on the browser and GPU. The old Zig binary was quarantined and crashed on one Windows machine; this release removes that custom executable rather than requiring antivirus exclusions.

For a **completely browser-only tutorial** without a local host, use the independent [editable WGSL WebGPU exercise](playground/index.html) or [browser-only v1.4.0 ZIP](https://github.com/Cryosimorgh/HLSL-Docs/releases/tag/v1.4.0). This runs WGSL, not HLSL.

## Learn interactively and use the Agent Skill

| Resource | Use it for |
| --- | --- |
| **[HLSL Engineer Agent Skill](.agents/skills/hlsl-engineer/SKILL.md)** | Reusable Codex/Agent Skills workflow for writing, reviewing and debugging HLSL shaders |
| **[Interactive HLSL editor + GPU runner](playground/README.md)** | Edit HLSL compute code and buffer bindings; compile with local DXC/Naga and run translated WGSL on WebGPU, with outputs and compiler errors |
| **[Offline particle tutorial](playground/index.html)** | Opens locally without a server, but cannot execute HLSL; use the launcher for GPU runs |
| **[DXC-compilable compute shader](playground/particle-step.hlsl)** | See the actual HLSL source corresponding to the simulation math |
| **[Zig launcher repair (v1.3.2)](RELEASE_NOTES_v1.3.2.md)** | One-click Windows setup with no Rust/Node install, Zig server and WebGPU execution |

The offline canvas **models compute-shader equations in JavaScript**. For real compute execution, launch the local compiler bridge and use the browser's WebGPU mode; it runs WGSL translated from your HLSL, not native D3D12 DXIL. See the [setup guide](playground/README.md).

### Install the Agent Skill

Clone the repository and open it with Codex; the skill lives in `.agents/skills/hlsl-engineer/`. Alternatively copy that directory to `~/.agents/skills/hlsl-engineer/` for personal use. Invoke it as `$hlsl-engineer` when writing/debugging shaders.

[Latest releases](https://github.com/Cryosimorgh/HLSL-Docs/releases) · [Zig launcher auto-bootstrap](RELEASE_NOTES_v1.3.2.md) · [Original v1.0.0 notes](RELEASE_NOTES.md)

## Start here: the complete HLSL guide

| Chapter | Topics |
| --- | --- |
| [01 · HLSL fundamentals](docs/01-fundamentals.md) | Language syntax, variables, types, functions, matrices, semantics, shader stages, DXC compilation |
| [02 · Graphics shaders and textures](docs/02-graphics-textures.md) | Vertex shader, pixel shader, clip space, rasterization, texture sampling, SamplerState, depth, instancing, mesh/DXR overview |
| [03 · Compute shaders and GPU memory](docs/03-compute-memory.md) | numthreads, Dispatch, thread IDs, groupshared, barriers, atomics, waves, raw buffers, SoA layouts |
| [04 · Resources and DirectX 12 integration](docs/04-resources-host.md) | cbuffer packing, SRV/UAV/CBV, register spaces, descriptor tables, root signatures, host/GPU lifecycle, D3D11 vs D3D12 |
| [05 · HLSL API and intrinsic catalog](docs/05-api-catalog.md) | Math intrinsics, Texture2D methods, RWByteAddressBuffer, Interlocked*, wave APIs, semantics, attributes, shader-object methods |
| [06 · Advanced HLSL and validation](docs/06-advanced.md) | SM6 feature gates, FP16/FP64, bindless/non-uniform indexing, SPIR-V, GPU debugging, correctness and optimization |
| [07 · Sunder engine case study](docs/07-sunder-case-study.md) | Real D3D12 compute physics, DXIL compilation, SoA addressing, double bit-storage, shader passes and rendering |

### HLSL architecture at a glance

~~~mermaid
flowchart LR
    H["HLSL source (.hlsl/.hlsli)"] --> D["DXC (-T profile, -E entry)"]
    D --> I["DXIL binary"]
    I --> P["D3D12 pipeline state"]
    CPU["CPU host: buffers, descriptors, root signature"] --> P
    P --> G["GPU: compute / vertex / pixel stages"]
    G --> O["UAV buffers / render targets"]
~~~

**Why this structure matters:** HLSL supplies the shader program. Direct3D allocates resources, binds them, handles synchronization and submits draw/dispatch calls. A compiled shader by itself does not create a GPU pipeline.

## Five-minute HLSL compute shader tutorial

Create a file named **scale.hlsl**:

~~~hlsl
// Resources: t0 is a read-only SRV; u0 is a read/write UAV.
StructuredBuffer<float> Input : register(t0);
RWStructuredBuffer<float> Output : register(u0);

// b0 holds CPU-provided constants.
cbuffer Parameters : register(b0)
{
    uint count;
    float scale;
    float2 padding;
};

// 64 GPU threads per compute group.
[numthreads(64, 1, 1)]
void CSMain(uint3 tid : SV_DispatchThreadID)
{
    uint i = tid.x;
    if (i >= count) return;      // Guard the final partial group.
    Output[i] = Input[i] * scale; // Each thread writes one element.
}
~~~

**What the code does:**

1. **StructuredBuffer** reads an array of input floats; **RWStructuredBuffer** writes results. The host must bind valid descriptors.
2. **cbuffer** holds a count and multiplier. Padding makes the host layout easy to map to 16-byte cbuffer registers.
3. **numthreads(64,1,1)** declares 64 invocations per group. This is a starting point, not a universally optimal size.
4. **SV_DispatchThreadID** is the global thread index. It identifies which array element belongs to each thread.
5. The **bounds guard** avoids accessing data beyond count when dispatch size is rounded up.
6. The assignment multiplies an input by scale and writes the corresponding output. Independent output indices avoid write races.

Compile with **DXC**:

~~~powershell
dxc -T cs_6_0 -E CSMain -Fo scale.dxil scale.hlsl
~~~

- **-T cs_6_0**: compile for the compute shader stage with Shader Model 6.0.
- **-E CSMain**: choose the shader entry point.
- **-Fo scale.dxil**: write compiled DXIL.

The **D3D12 host** then creates a compute PSO, binds the root signature, CBV/SRV/UAV resources, and dispatches **ceil(count / 64)** groups. Shader compilation and dispatch are different steps. See [Compute and memory](docs/03-compute-memory.md) and [Resources and host integration](docs/04-resources-host.md).

## Topics covered

- **HLSL syntax:** scalars, vectors, matrices, structs, swizzles, loops, functions, preprocessor, HLSL 2021 language version.
- **Graphics pipeline:** vertex, hull, domain, geometry, pixel, mesh/amplification, ray tracing overview.
- **Texture APIs:** Texture2D, Sample, SampleLevel, Load, Gather, GetDimensions, texture formats, samplers, filtering and color space.
- **Compute HLSL:** Dispatch, numthreads, SV_GroupID, SV_GroupIndex, SV_DispatchThreadID, groupshared, UAV barriers and wave intrinsics.
- **Resource binding:** CBV, SRV, UAV, b/t/u/s registers, register spaces, root signatures, descriptor tables and cbuffer packing.
- **Intrinsic functions:** math, bitwise, derivatives, atomics, memory barriers, wave operations, shader attributes and system-value semantics.
- **Shader programming in practice:** compile/debug with DXC, test raw-buffer layouts, validate synchronization, handle precision and performance.

## Who this is for

**Beginners:** Follow chapters 01–04 in order, compiling small examples and reading each "What / Why / Pitfall" explanation.

**Game-engine and graphics programmers:** Use chapters 02, 04, 05 and 06 for shader API lookup, binding errors, texture sampling and architecture decisions.

**GPU compute/physics developers:** Start at chapter 03, then the [Sunder case study](docs/07-sunder-case-study.md) for real raw-buffer, double-precision and staged-solver patterns.

## Documentation boundaries

This repository is a **broad technical handbook**, not a machine-generated copy of every historical Microsoft HLSL API overload. The [API catalog](docs/05-api-catalog.md) groups the major language intrinsics, object methods and stage semantics with representative code. For **every individual overload, exact minimum Shader Model, stage restrictions and special resource requirements**, always follow [Microsoft's intrinsic index](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-intrinsic-functions) and official version-specific docs.

Code samples are educational, and host-side examples may be explicitly marked as pseudocode. GPU/device testing is not claimed; compile and validate on your actual DXC/SDK/GPU combination before production use.

## Official references and tooling

| Resource | Why it matters |
| --- | --- |
| [Microsoft: High-level shader language (HLSL)](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl) | Official entry point for syntax, stages and reference |
| [Microsoft: HLSL intrinsic functions](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-intrinsic-functions) | Canonical built-in function index |
| [Microsoft: HLSL semantics](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-semantics) | Stage interface and system-value semantics |
| [Microsoft: constant buffer packing](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-packing-rules) | Crucial host/shader memory layout rules |
| [Microsoft: D3D12 root signatures](https://learn.microsoft.com/en-us/windows/win32/direct3d12/root-signatures) | Descriptor and root-binding design |
| [Microsoft: Shader Model 6](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/shader-model-6-0) | Wave operations and shader model evolution |
| [Microsoft: DirectXShaderCompiler](https://github.com/microsoft/DirectXShaderCompiler) | DXC source, releases and language/compiler notes |
| [Sunder GPU Physics](https://github.com/Cryosimorgh/Sunder) | Example engine used in the case study |

## Contributing and license

Corrections with **a small, compiling HLSL example**, supported Shader Model/stage and an authoritative reference are welcome as GitHub issues or pull requests. Explain **what the construct does, why it is used, and what can go wrong**. Avoid unattributed copying of proprietary documentation.

Distributed under the repository's [MIT License](LICENSE). Microsoft, DirectX, Direct3D, HLSL, DXC, DXIL and Shader Model are names of their respective owners.

**Begin with [Chapter 01: HLSL fundamentals →](docs/01-fundamentals.md)**
