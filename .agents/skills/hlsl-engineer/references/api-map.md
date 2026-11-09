# HLSL API decision map

This is a **routing sheet**, not a substitute for version-specific Microsoft signature documentation.

## Compile targets

| Purpose | Typical target | Host requirements |
|---|---|---|
| Ordinary compute | cs_6_0 | D3D12 + DXIL/SM6 support |
| Vertex/pixel | vs_6_0 / ps_6_0 | D3D12 graphics PSO and matching semantics |
| Older D3D11 | cs_5_0, vs_5_0, ps_5_0 | FXC/DXBC path; D3D11 binding model |
| Mesh/amplification | ms_6_5 / as_6_5 | Device mesh shader tier and D3D12 setup |
| Ray tracing | lib_6_x | DXR state objects, SBT/AS and feature tier |

**Do not claim:** A higher DXC target automatically proves runtime hardware capability.

## Pipeline objects and semantics

- **Compute:** SV_DispatchThreadID (global uint3), SV_GroupID (group uint3), SV_GroupThreadID (local uint3), SV_GroupIndex (flattened uint).
- **Vertex:** SV_VertexID, SV_InstanceID; VS output SV_Position **clip** position.
- **Pixel:** SV_Position (raster coordinates), SV_Target0..n, SV_Depth, SV_IsFrontFace; derivatives ddx, ddy, fwidth.
- **Stage link:** generic TEXCOORDn/SV* semantics matched between stages; use nointerpolation for integer IDs.
- **Bindings:** b# CBV, t# SRV, u# UAV, s# sampler, optional register space#; root signature must be compatible.

## Main intrinsic groups

| Group | Examples | Gotcha |
|---|---|---|
| Arithmetic | abs, min, max, clamp, saturate, lerp, step, smoothstep | Saturate clamps to [0,1] |
| Geometry | dot, cross, length, normalize, distance, reflect, refract, mul | normalize(0) invalid for reliable simulation |
| Trigonometry | sin, cos, sincos, tan, atan2, radians, degrees | Input angle units in radians |
| Exponents | exp, exp2, log, log2, pow, sqrt, rsqrt, rcp | Check domain, FP precision |
| Rounding | ceil, floor, round, trunc, frac, fmod | frac differs from signed remainder |
| Bits | asfloat, asuint, asint, asdouble, countbits, firstbithigh, reversebits | Bitcast != numerical cast |
| Validation | isfinite, isinf, isnan | Validate before normalization/hash |
| Textures | Sample, SampleLevel, SampleGrad, SampleCmp, Gather, Load, GetDimensions | Implicit LOD primarily pixel stage |
| Buffers | Load/Load2/3/4, Store/Store2/3/4, Interlocked*, Append, Consume | ByteAddress offsets are bytes |
| Atomics | InterlockedAdd/Min/Max/Or/Xor/Exchange/CompareExchange | Atomic does not mean full fence |
| Sync | GroupMemoryBarrierWithGroupSync, DeviceMemoryBarrier*, AllMemoryBarrier* | Group sync does not span dispatch groups |
| Waves | WaveActiveSum, WaveReadLaneAt, WaveActiveBallot, WavePrefixSum, WaveGetLaneCount | Varying hardware wave size |
| Derivatives | ddx, ddy, fwidth, ddx_fine, ddy_coarse | Pixel-stage and divergence restrictions |

## Select the right resource

~~~hlsl
cbuffer Config : register(b0) { uint count; float dt; float2 pad; };
StructuredBuffer<float3> Position : register(t0);
RWStructuredBuffer<float3> NextPosition : register(u0);

[numthreads(64,1,1)]
void CSMain(uint3 tid : SV_DispatchThreadID)
{
    uint i = tid.x;
    if (i >= count) return;
    NextPosition[i] = Position[i]; // independent writes
}
~~~

- Use **StructuredBuffer<T>** for typed element/stride abstraction.
- Use **ByteAddressBuffer** for explicit binary ABI and SoA field offsets: offset = 4 * (field * count + index).
- Use **Texture2D** and SamplerState for filtered images, RWTexture2D for writable images.
- Use **groupshared** for within-group scratch; all threads must converge on WithGroupSync.
- Use **separate dispatches + host barriers** for global phases.

## Layout example

~~~hlsl
cbuffer Params : register(b0)
{
    float3 gravity; // 0..11
    float timestep; // 12..15; fills 16-byte register
    float weights[2]; // offsets 16 and 32, not 16 and 20
};
~~~

- D3D12 CBV placement must be 256-byte aligned; don't confuse that with 16-byte packing inside constants.
- HLSL bool and CPU bool representations can differ; prefer uint flags in binary interfaces.
- Matrices: mul(vector, matrix) and mul(matrix, vector) require consistent conventions; row_major/column_major govern packing.

## For exact signatures / feature gates

- https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-intrinsic-functions
- https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-semantics
- https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-packing-rules
- https://learn.microsoft.com/en-us/windows/win32/direct3d12/resource-binding-in-hlsl
- https://github.com/microsoft/DirectXShaderCompiler
