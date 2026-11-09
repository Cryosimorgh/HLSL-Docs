# 06 — Advanced HLSL, portability, precision, validation and performance

[← API catalog](05-api-catalog.md) · [Handbook](../README.md) · [Next: Sunder case study →](07-sunder-case-study.md)

## 1. Feature gates: never equate compiler support with GPU support

| Capability | Typical gate | Verify |
| --- | --- | --- |
| Wave intrinsics | Shader Model 6.0 and relevant D3D12 support | CheckShaderModel, wave-related device options |
| Native 16-bit types | Suitable SM6.2+ target, DXC switch and hardware | Device native 16-bit capability and compiler target |
| Mesh/amplification shaders | SM6.5 and mesh shader support | D3D12 mesh shader tier |
| 64-bit/interlocked extension functions | SM6.6, resource-specific support | D3D12 options, DXC version and individual operation |
| ResourceDescriptorHeap / SamplerDescriptorHeap | SM6.6 bindless resource features | Root signature flags and relevant D3D12 device support |
| Advanced texture/wave/quad features | SM6.7/SM6.8+ as applicable | Exact specification and feature queries |
| DXR ray tracing | DXR tier and library targets | D3D12 raytracing tier, state object support |
| Shader Model profile | e.g. cs_6_0 | D3D12 device CheckFeatureSupport |

~~~cpp
// Host-side illustration, not HLSL:
D3D12_FEATURE_DATA_SHADER_MODEL model = { D3D_SHADER_MODEL_6_6 };
device->CheckFeatureSupport(
    D3D12_FEATURE_SHADER_MODEL, &model, sizeof(model));
// Inspect the returned HighestShaderModel; never infer it from the SDK.
~~~

- **What:** The host queries actual supported shader model rather than hard-coding a compiler target.
- **Why:** Your SDK or DXC can generate a profile that the selected device cannot execute.
- **Important:** A single Shader Model number may not fully imply optional hardware tiers, native precision or ray tracing availability; query those separately.

## 2. Native 16-bit values vs minimum-precision values

~~~hlsl
// Requires appropriate DXC flags, target and device support:
float16_t a = (float16_t)0.5f;
float16_t b = (float16_t)1.25f;
float16_t c = a * b;

min16float preferredLowPrecision = 0.5f;
float regularFP32 = 0.5f;
~~~

~~~powershell
dxc -T cs_6_2 -E CSMain -enable-16bit-types -Fo fp16.dxil fp16.hlsl
~~~

- **What:** float16_t requests a 16-bit floating-point type where enabled. min16float is a minimum-precision type whose realized precision is implementation dependent.
- **Why:** Explicit types help control storage and arithmetic, but only after feature verification.
- **Risk:** FP16 may overflow or lose detail in physics contacts, reduction sums and world-space transforms. Profile and bound error first.

## 3. Resource arrays, non-uniform indexing and bindless patterns

~~~hlsl
Texture2D<float4> Textures[8] : register(t0, space1);
SamplerState Samp : register(s0);

float4 ReadMaterial(uint materialIndex, float2 uv)
{
    uint index = min(materialIndex, 7u);
    return Textures[NonUniformResourceIndex(index)].SampleLevel(Samp, uv, 0);
}
~~~

- **What:** NonUniformResourceIndex marks an index that may differ across lanes in a wave.
- **Why:** Without correct non-uniform annotation, the compiler may make unsafe assumptions about resource selection.
- **Host:** Bind an appropriate range of descriptors; validate that every index is within the bound descriptor range and that root signature resource flags are compatible.
- **Advanced:** SM6.6 resource-descriptor heap indexing uses different syntax and root signature flags; use it only when the target explicitly supports it.

## 4. Precision and reproducibility

~~~hlsl
float3 SafeNormalize(float3 v)
{
    float len2 = dot(v, v);
    if (!isfinite(len2) || len2 < 1e-20f) return float3(0,0,0);
    return v * rsqrt(len2);
}
~~~

- **What:** Rejects invalid/tiny magnitude before reciprocal-square-root normalization.
- **Why:** Division by tiny values can generate invalid normals and blow up iterative solvers.
- **Determinism:** Wave reduction order, unordered atomic scheduling and floating-point associativity vary across hardware. For strict replay, require an explicit algorithm/order and test it—not only the same shader source.
- **FP64:** Double data types do not imply IEEE-identical behavior or equal throughput on all GPUs. Measure the selected adapter.

## 5. Modern memory model caveats

~~~hlsl
RWStructuredBuffer<uint> Flags : register(u0);
groupshared uint local[64];

[numthreads(64,1,1)]
void Phase(uint lane : SV_GroupIndex)
{
    local[lane] = lane;
    GroupMemoryBarrierWithGroupSync();
    if (lane == 0) Flags[0] = local[63];
}
~~~

- **What:** All lanes publish local storage before lane 0 reads it.
- **Why:** The barrier is needed for groupshared ordering, not for unrelated command queue synchronization.
- **No dispatch-global barrier:** Use staged dispatches and host-side barriers. Advanced shader-model memory features must not be silently substituted for a global rendezvous.

## 6. HLSL → SPIR-V for Vulkan

~~~powershell
dxc -spirv -T cs_6_0 -E CSMain -Fo compute.spv compute.hlsl
~~~

~~~hlsl
#ifdef __spirv__
[[vk::binding(0, 0)]]
#endif
RWStructuredBuffer<uint> Output : register(u0);
~~~

- **What:** A SPIR-V-enabled DXC build can compile HLSL to Vulkan-targeted SPIR-V. [[vk::binding]] is a Vulkan-specific binding annotation.
- **Why:** One source language can feed Direct3D and Vulkan pipelines, but descriptor mapping, coordinate conventions and supported intrinsics may differ.
- **Verify:** Use SPIR-V validation and Vulkan runtime feature checks. Producing .spv does not guarantee HLSL/D3D12 semantics map exactly.

## 7. Diagnosing a black screen or blank texture

~~~hlsl
float4 PSMain(float4 pos : SV_Position) : SV_Target0
{
    return float4(1, 0, 1, 1); // magenta: isolate output pipeline
}
~~~

- **What:** Removes all resource dependencies from the pixel shader.
- **Why:** If a magenta target appears, isolate the failing path to descriptors, texture import, coordinates or logic. If not, inspect PSO, input topology, viewport/scissor, draw calls, render-target state, depth and root signature.
- **Tools:** D3D12 debug layer, GPU-based validation, PIX/RenderDoc (where supported), DXC diagnostics, GPU timestamp queries.

## 8. Compiler and validation workflow

~~~powershell
dxc -help
dxc -T cs_6_0 -E CSMain -Zi -Qembed_debug -Od -Fo debug.dxil shader.hlsl
dxc -T cs_6_0 -E CSMain -O3 -Fo release.dxil shader.hlsl
dxc -dumpbin release.dxil
~~~

- **What:** Inspect switches, compile a debug binary and optimized binary, dump metadata.
- **Why:** Optimization can change register use, instruction scheduling and observable performance. A reproducible test captures compiler version and full arguments.
- **Boundary:** This is a compile workflow. Runtime resource correctness requires a real hardware execution test.

## 9. Performance model and common traps

~~~hlsl
StructuredBuffer<float> Source : register(t0);
RWStructuredBuffer<float> Result : register(u0);
[numthreads(128,1,1)]
void CopyCoalesced(uint3 tid : SV_DispatchThreadID)
{
    if (tid.x >= count) return;  // count supplied by a cbuffer
    Result[tid.x] = Source[tid.x];
}
~~~

- **What:** Coalesced memory access helps hide latency and improves useful bandwidth.
- **Why:** Many compute workloads are limited by memory traffic rather than arithmetic throughput.
- **Watch:** Random reads, high atomic contention, register spills, barrier stalls, wave divergence, tiny dispatch overhead and excessive GPU→CPU readback.
- **Measurements:** Compare GPU timestamp durations and aggregate bytes/work. Separate initialization, warmup, execution, readback and display.

## 10. Security, correctness and hostile-input tests

~~~hlsl
RWByteAddressBuffer Errors : register(u0);
cbuffer Config : register(b0) { uint n; uint capacity; uint2 pad; };

[numthreads(256,1,1)]
void Validate(uint3 id : SV_DispatchThreadID)
{
    if (id.x >= n) return;
    if (n > capacity)
    {
        Errors.InterlockedOr(0, 1u);
        return;
    }
    // Process only when host allocates at least capacity entries.
}
~~~

- **What:** Checks logical count against advertised capacity and records an error bit.
- **Why:** A shader cannot fix an insufficient allocation; it can decline to publish invalid work.
- **Host first:** Never bind an undersized resource. Validate counts/strides/offsets on the CPU and on critical shader paths as defense in depth.
- **Test matrix:** n=0,1,63,64,65,1023,1024,1025, max cap; zero-sized or degenerate scenes; NaN/INF; adversarial hash collisions; overflow; repeated dispatch; device loss; cross-device comparisons.

## 11. Choosing the right type of shader

~~~text
Need pixels from triangles?       → vertex + pixel
Need data-parallel transformation? → compute
Need tessellated surfaces?        → hull + domain (if supported)
Need procedural primitive output? → compare mesh shaders vs instancing
Need world-space ray queries?     → DXR or available ray-query path
~~~

~~~hlsl
// For a general simulation, start with an independent compute kernel:
[numthreads(128,1,1)]
void CSMain(uint3 id : SV_DispatchThreadID)
{
    if (id.x >= count) return;
    Next[id.x] = SolveOne(Current[id.x]);
}
~~~

- **What:** One invocation handles one item with a bound guard.
- **Why:** It is the easiest concurrency pattern to verify; add shared-memory optimizations and wave reductions only after profiling.

## 12. Primary references

- [Microsoft: Shader Model 6.0](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/shader-model-6-0)
- [Microsoft: Shader Model 6.0 wave operations](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/hlsl-shader-model-6-0-features-for-direct3d-12)
- [Microsoft: resource binding in HLSL](https://learn.microsoft.com/en-us/windows/win32/direct3d12/resource-binding-in-hlsl)
- [DXC SPIR-V documentation](https://github.com/microsoft/DirectXShaderCompiler/blob/main/docs/SPIR-V.rst)
- [DXC language versions](https://github.com/microsoft/DirectXShaderCompiler/wiki/Language-Versions)
- [DXC source and release notes](https://github.com/microsoft/DirectXShaderCompiler)

[← API catalog](05-api-catalog.md) · [Next: Sunder case study →](07-sunder-case-study.md)
