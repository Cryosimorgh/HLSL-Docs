---
name: hlsl-engineer
description: Design, write, review, debug and optimize HLSL shaders for Direct3D 11/12, DXC/FXC, Shader Model 5/6, GPU compute, graphics, texture sampling, resource bindings and GPU physics. Use for HLSL code changes, shader compilation errors, API/semantic lookups, cbuffer/layout mismatches, wave and atomic operations, GPU synchronization, shader correctness/performance investigations, or explaining shaders with annotated examples. Do not use for unrelated CPU-only code or for claiming untested GPU behavior.
---

# HLSL Engineer

A workflow skill derived from the [HLSL Handbook](https://github.com/Cryosimorgh/HLSL-Docs). Prioritize correct shader contracts over plausible-looking code. Identify **what** a construct does, **why** it is needed, **where** it is supported and **how** to verify it.

## Operating procedure

1. **Identify the target and boundaries.** Determine the host API (D3D11, D3D12, Vulkan/SPIR-V), compiler (FXC/DXC), shader stage (vs/ps/cs/hs/ds/gs/ms/as/lib), target Shader Model, resources, expected input/output and whether native GPU execution is available. Do not silently assume a feature exists because DXC can compile it.
2. **Inspect the smallest relevant surface.** In a repository, use `rg --files`, `rg -n`, `find` or Git search to find shader entry points, included layouts, binding/PSO setup, compiler commands and a targeted test. Read only matching files/ranges. Do not dump build artifacts, generated files, logs or dependency trees into context.
3. **Trace the entire contract.** Map each shader register (b/t/u/s and space) to its actual host binding. Check cbuffer 16-byte packing and D3D12 CBV 256-byte placement alignment; structured-buffer strides; raw-buffer *byte* offsets; texture view compatibility; output targets; dispatch dimensions and bounds checks.
4. **Choose the smallest correct change.** Separate GPU passes when work requires cross-group synchronization. Use group barriers only for group-wide convergence; use UAV/resource barriers and fences on the host where required. Consider double buffering for read-after-write dependencies. Write valid HLSL, not pseudocode disguised as compilable code.
5. **Explain each non-obvious part.** For any example, include a compact What / Why / Constraint explanation covering entry-point semantics, register mappings, thread indexing, storage format and precision.
6. **Validate in layers.** First compile the exact entry/profile with the project's DXC/FXC and relevant defines/includes. Inspect compiler errors. Then run a targeted GPU test if a compatible Windows/Vulkan environment exists; check the debug layer, GPU-based validation, errors, capacities, output bit patterns and timing. If no runtime is available, state that compilation and execution remain unverified.
7. **Adversarially check.** Exercise n=0, n=1, boundary counts (groupSize±1), max capacity, misalignment, NaN/INF, degenerate geometry, hash collisions, atomic contention, race conditions, divergence around `*WithGroupSync`, device capability mismatch, stale descriptors and resource-state transitions.
8. **Report succinctly.** State files changed, target and entry points, commands run, tests passed/failed, evidence and remaining unknowns. Do not claim numerical determinism, race freedom, feature support or performance improvements without testing.

## Topic lookup — load only what the task needs

- **[API map](references/api-map.md):** shader stages and semantics, math intrinsics, texture/buffer APIs, barriers, wave operations and Shader Model caveats.
- **[Review and test matrix](references/review-matrix.md):** host-shader ABI, hazards, debugging and gate checklist.
- **[Handbook](https://github.com/Cryosimorgh/HLSL-Docs/blob/main/HLSL-Handbook.md):** full illustrated reference (single Markdown file). Prefer the individual chapter for narrow questions:
  - [Fundamentals](https://github.com/Cryosimorgh/HLSL-Docs/blob/main/docs/01-fundamentals.md)
  - [Graphics + textures](https://github.com/Cryosimorgh/HLSL-Docs/blob/main/docs/02-graphics-textures.md)
  - [Compute, memory, waves](https://github.com/Cryosimorgh/HLSL-Docs/blob/main/docs/03-compute-memory.md)
  - [Bindings + host](https://github.com/Cryosimorgh/HLSL-Docs/blob/main/docs/04-resources-host.md)
  - [HLSL API catalog](https://github.com/Cryosimorgh/HLSL-Docs/blob/main/docs/05-api-catalog.md)
  - [Advanced features](https://github.com/Cryosimorgh/HLSL-Docs/blob/main/docs/06-advanced.md)
  - [Sunder case study](https://github.com/Cryosimorgh/HLSL-Docs/blob/main/docs/07-sunder-case-study.md)
- **[Interactive tutorial](https://github.com/Cryosimorgh/HLSL-Docs/tree/main/playground):** an offline Canvas/JavaScript visualization plus an optional real compute execution mode: edited HLSL is compiled by local DXC to SPIR-V, translated by Naga into WGSL and dispatched by the browser using WebGPU with explicit buffer bindings. **Do not describe the offline JavaScript simulation as executing HLSL, or the WebGPU pathway as native D3D12/DXIL execution.**

## Quick canonical example (SM 6.0 compute)

```hlsl
StructuredBuffer<float> Source : register(t0);
RWStructuredBuffer<float> Destination : register(u0);
cbuffer Config : register(b0)
{
    uint count;
    float gain;
    float2 pad;
};

[numthreads(64, 1, 1)]
void CSMain(uint3 tid : SV_DispatchThreadID)
{
    uint i = tid.x;
    if (i >= count) return;
    Destination[i] = Source[i] * gain;
}
```

- **What:** One thread processes one float; the last partial group is guarded.
- **Why:** Adjacent lanes read/write contiguous elements, with independent writes and no inter-thread barrier.
- **Host contract:** b0 CBV + t0 SRV + u0 UAV, compatible root signature/PSO, ceil(count/64) dispatched groups, required transitions/barriers. Compile with `dxc -T cs_6_0 -E CSMain -Fo shader.dxil shader.hlsl`. A compiled binary alone does not run a dispatch.

## Strict boundaries

- Consult [official Microsoft HLSL reference](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl) and [intrinsic index](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-intrinsic-functions) for exact signatures, stages and minimum targets. This handbook is not exhaustive for every historical overload.
- Distinguish Shader Model, HLSL language version (`-HV`), compiler target and optional GPU feature tiers.
- `row_major` controls matrix packing, not multiplication order; `asfloat` bitcasts, while `(float)` converts numerically.
- Interlocked operations alone do not imply all memory fences; `GroupMemoryBarrierWithGroupSync` is **not** a global dispatch barrier.
- Do not assume fixed wave size, deterministic floating-point reduction order, cross-device bitwise replay, or D3D11 compatibility with SM6/D3D12 features.
- In GPU physics, keep source/trial/accepted state distinct when the validator controls publication; never loosen correctness thresholds to get a pass.
