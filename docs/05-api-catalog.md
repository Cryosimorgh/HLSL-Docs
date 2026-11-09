# 05 — HLSL API catalog: intrinsics, resource methods, semantics and attributes

[← Resources](04-resources-host.md) · [Handbook](../README.md) · [Next: advanced topics →](06-advanced.md)

**Purpose.** This is a grouped, example-driven map of HLSL's public built-in API surface. Each call below shows a **representative** overload; many operations accept scalar/vector variants, different types or out parameters. For an **exhaustive overload list**, feature requirements and exact signatures, follow the official [Microsoft intrinsic-function index](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-intrinsic-functions), [HLSL reference](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl) and [Shader Model 6 wave reference](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/shader-model-6-0). Do **not** infer an API is supported in a stage/profile solely because its name appears here.

## 1. Saturation, interpolation and scalar utilities

| Intrinsic | Representative call | Result and intent |
| --- | --- | --- |
| abs | abs(x) | Magnitude per component |
| min / max | min(a,b), max(a,b) | Component-wise bounds |
| clamp | clamp(x, lo, hi) | Clamp to range |
| saturate | saturate(x) | Clamp to [0,1] |
| lerp | lerp(a,b,t) | Linear interpolation |
| step | step(edge,x) | 0 below edge, 1 otherwise |
| smoothstep | smoothstep(lo,hi,x) | Smooth cubic ramp |
| sign | sign(x) | Sign of value |
| all / any | all(mask), any(mask) | Boolean reduction |
| distance | distance(a,b) | Euclidean separation |
| length | length(v) | Vector magnitude |
| normalize | normalize(v) | Unit direction |
| rcp / rsqrt | rcp(x), rsqrt(x) | Approximate reciprocal / reciprocal sqrt |

~~~hlsl
float3 ClampColor(float3 linearRGB)
{
    float intensity = smoothstep(0.2f, 0.8f, length(linearRGB));
    return saturate(lerp(float3(0,0,0), linearRGB, intensity));
}
~~~

- **What:** length measures intensity, smoothstep creates a ramp, lerp blends values, saturate clamps output.
- **Why:** Use built-ins for standard operations instead of writing branching equivalents.
- **Caution:** normalize(0) is not a robust normalization policy; guard near-zero input.

## 2. Trigonometry and exponentials

| Group | Built-ins | Typical use |
| --- | --- | --- |
| Trigonometric | sin, cos, tan, asin, acos, atan, atan2, sincos | Angles, oscillation, orientation |
| Hyperbolic | sinh, cosh, tanh | Specialized math |
| Angle conversion | radians, degrees | Degrees ↔ radians |
| Exponentials | exp, exp2, pow, ldexp | Growth, powers, scaling |
| Logarithms | log, log2, log10 | Exposure, base conversion |
| Roots | sqrt, rsqrt | Distances and normalization |

~~~hlsl
float2 Rotate2D(float2 p, float angleRadians)
{
    float s, c;
    sincos(angleRadians, s, c);
    return float2(c * p.x - s * p.y, s * p.x + c * p.y);
}
~~~

- **What:** sincos computes two trigonometric outputs with one intrinsic call.
- **Why:** Reusing sin/cos values avoids duplicate calculations and makes 2D rotation explicit.
- **Caution:** pow on negative bases with non-integer exponents may produce NaN; validate domains.

## 3. Rounding, remainders and decomposition

| Built-ins | Representative calls | Use |
| --- | --- | --- |
| floor / ceil / round / trunc | floor(x) | Quantization and indices |
| frac | frac(x) | Fractional part |
| fmod | fmod(x,y) | Signed floating remainder |
| modf | modf(x, wholePart) | Separate integer and fractional parts |
| frexp | frexp(x, exponent) | Mantissa + exponent |
| f16tof32 / f32tof16 | f16tof32(bits), f32tof16(x) | Half conversion bit representation |

~~~hlsl
float Wrap01(float x)
{
    return frac(x); // x - floor(x), including negative inputs
}
~~~

- **What:** frac creates a repeating 0..1 interval.
- **Why:** Useful for periodic UVs and tiling without branching.
- **Caution:** For signed remainders, frac and fmod are not interchangeable.

## 4. Vector and matrix algebra

| Intrinsic | Representative call | Purpose |
| --- | --- | --- |
| dot | dot(a,b) | Scalar projection / energy |
| cross | cross(a,b) | 3D perpendicular vector |
| reflect | reflect(incident, normal) | Mirror reflection |
| refract | refract(incident, normal, eta) | Refraction |
| faceforward | faceforward(n,i,ng) | Orient a normal |
| mul | mul(matrix, vector) | Matrix/vector product |
| transpose | transpose(m) | Swap rows/columns |
| determinant | determinant(m) | Matrix determinant |

~~~hlsl
float3 ReflectVelocity(float3 v, float3 normal)
{
    float3 n = normalize(normal);
    return reflect(v, n);
}
~~~

- **What:** reflect(v,n) computes v - 2*dot(n,v)*n for unit n.
- **Why:** It expresses specular reflection or a simple elastic bounce without hand-written algebra.
- **Caution:** Collision response with mass, friction and restitution generally needs more than reflect.

## 5. Bitwise and bit reinterpretation

| Built-ins | Calls | Purpose |
| --- | --- | --- |
| asuint / asint / asfloat | asuint(f), asfloat(u) | Same bits, different 32-bit interpretation |
| asdouble | asdouble(low,high) | Rebuild double from 32-bit words |
| countbits | countbits(mask) | Population count |
| firstbithigh / firstbitlow | firstbithigh(mask) | Bit-scan positions |
| reversebits | reversebits(x) | Reverse bit order |

~~~hlsl
uint CountSetBits(uint flags)
{
    uint count = countbits(flags);
    return count;
}
~~~

- **What:** countbits counts one-bits in the integer.
- **Why:** Useful for compact flags, occupancy masks and wave ballots.
- **Caution:** Bitcasts preserve bit patterns; a cast such as (uint)floatValue does numeric conversion.

## 6. Floating-point validation and fused arithmetic

| Built-ins | Representative call | Why |
| --- | --- | --- |
| isfinite | isfinite(x) | Reject INF/NaN |
| isinf | isinf(x) | Detect infinities |
| isnan | isnan(x) | Detect NaNs |
| mad | mad(a,b,c) | Multiply-add semantics |
| fma | fma(a,b,c) | Fused multiply-add where supported |

~~~hlsl
bool IsValidPosition(float3 p)
{
    return all(isfinite(p)) && all(abs(p) < 1000000.0f);
}
~~~

- **What:** Checks that all coordinates are finite and inside a chosen simulation domain.
- **Why:** Non-finite state can rapidly contaminate reductions, hashes and collision calculations.
- **Precision:** mad and fma can have different rounding / contraction requirements; confirm their target-specific signatures when exact numerical behavior matters.

## 7. Pixel derivatives, sample data and attribute evaluation

| Built-ins | Context |
| --- | --- |
| ddx, ddy, fwidth | Pixel screen-space derivatives |
| ddx_coarse, ddx_fine, ddy_coarse, ddy_fine | Coarse/fine derivative variants |
| EvaluateAttributeAtSample | Evaluate an interpolant at an MSAA sample |
| EvaluateAttributeCentroid | Evaluate at centroid |
| EvaluateAttributeSnapped | Evaluate at specified pixel offset |
| GetRenderTargetSampleCount / GetRenderTargetSamplePosition | Sample count and position |
| clip | Discard pixel based on signed condition |

~~~hlsl
float EdgeAA(float distanceToEdge)
{
    float pixelWidth = max(fwidth(distanceToEdge), 1e-5f);
    return saturate(0.5f - distanceToEdge / pixelWidth);
}
~~~

- **What:** fwidth estimates edge movement over a pixel, then clamps coverage.
- **Why:** Simple antialiasing for analytic distance fields.
- **Restriction:** ddx/ddy/fwidth are pixel-stage operations in ordinary SM6 usage. Never assume compute kernels have standard pixel derivatives.

## 8. Atomics and memory barriers

| API | Representative syntax | Notes |
| --- | --- | --- |
| InterlockedAdd | InterlockedAdd(dest, value, old) | Atomic add |
| InterlockedAnd / Or / Xor | InterlockedOr(dest, bits) | Atomic flags |
| InterlockedMin / Max | InterlockedMin(dest, value) | Atomic extrema |
| InterlockedExchange | InterlockedExchange(dest, value, old) | Atomic replacement |
| InterlockedCompareExchange | InterlockedCompareExchange(dest, compare, new, old) | Compare-and-swap |
| InterlockedCompareStore | InterlockedCompareStore(dest, compare, new) | Compare-and-store |
| GroupMemoryBarrier | GroupMemoryBarrier() | Groupshared ordering |
| GroupMemoryBarrierWithGroupSync | GroupMemoryBarrierWithGroupSync() | Ordering + group sync |
| DeviceMemoryBarrier | DeviceMemoryBarrier() | Device-access ordering |
| DeviceMemoryBarrierWithGroupSync | DeviceMemoryBarrierWithGroupSync() | Device ordering + group sync |
| AllMemoryBarrier | AllMemoryBarrier() | Groupshared + device ordering |
| AllMemoryBarrierWithGroupSync | AllMemoryBarrierWithGroupSync() | Both + group sync |

~~~hlsl
groupshared uint counter;
[numthreads(64,1,1)]
void Count(uint lane : SV_GroupIndex)
{
    if (lane == 0u) counter = 0u;
    GroupMemoryBarrierWithGroupSync();
    InterlockedAdd(counter, 1u);
    GroupMemoryBarrierWithGroupSync();
    uint groupTotal = counter; // 64 when all lanes participate
}
~~~

- **What:** Counter initialization and final read are separated from concurrent increments by group-wide barriers.
- **Why:** Atomics make the increment race-free, but do not replace the barriers around the phase changes.
- **Warning:** WithGroupSync must be executed in convergent group control flow. Cross-group barriers belong to the host command stream.

## 9. Wave operations (SM 6.x; inspect stage-specific requirements)

| Family | Built-ins |
| --- | --- |
| Lane/wave identification | WaveGetLaneCount, WaveGetLaneIndex, WaveIsFirstLane |
| Vote / ballot | WaveActiveAllTrue, WaveActiveAnyTrue, WaveActiveBallot, WaveActiveCountBits |
| Broadcast | WaveReadLaneAt, WaveReadLaneFirst |
| Arithmetic reduction | WaveActiveSum, WaveActiveProduct, WaveActiveMin, WaveActiveMax |
| Bitwise reduction | WaveActiveBitAnd, WaveActiveBitOr, WaveActiveBitXor |
| Prefix | WavePrefixSum, WavePrefixProduct, WavePrefixCountBits |
| Equality | WaveActiveAllEqual |
| Quad | QuadReadAcrossX, QuadReadAcrossY, QuadReadAcrossDiagonal, QuadReadLaneAt |

~~~hlsl
uint CountActive(bool qualifies)
{
    uint count = WaveActiveCountBits(qualifies);
    return count;
}
~~~

- **What:** Counts qualifying **active lanes in the caller's wave**.
- **Why:** Efficient local vote/reduction with no explicit groupshared scratch.
- **Caution:** Wave size and active-lane masks vary; never assume exactly 32 or 64 active lanes. Quad operation support depends on stage and Shader Model revision.

## 10. Texture sampling and object APIs

| Object / family | Representative APIs | Details |
| --- | --- | --- |
| Texture1D/2D/3D/Cube | Sample, SampleBias, SampleLevel, SampleGrad | Filtered sampling |
| Comparison/depth sampling | SampleCmp, SampleCmpLevelZero | Compare texture depth/reference |
| Gather | Gather, GatherRed/Green/Blue/Alpha, GatherCmp | Fetch nearby component values |
| Direct texel access | Load | Integer coordinates and explicit mip/sample |
| Size query | GetDimensions | Width, height, mips, array slices, sample count variants |
| Typed UAV textures | RWTexture2D<T>[int2] | Read/write via index |
| MSAA textures | Texture2DMS<T>.Load | Sample-indexed texel read |
| Residency | CheckAccessFullyMapped(status) | Sparse/tiled-resource status |
| Samplers | SamplerState / SamplerComparisonState | Used with texture methods |

~~~hlsl
Texture2D<float4> Src : register(t0);
SamplerState Samp : register(s0);

float4 ReadTwoWays(float2 uv, int2 pixel)
{
    float4 filtered = Src.SampleLevel(Samp, uv, 0);
    float4 exact = Src.Load(int3(pixel, 0));
    return 0.5f * (filtered + exact);
}
~~~

- **What:** SampleLevel uses sampler filtering; Load fetches a texel without filtering.
- **Why:** Choose filtering for display, exact indexed access for data processing.
- **Need exact overloads?** See the official [Texture object documentation](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-to-getdimensions) and linked methods.

## 11. Buffer object method APIs

| Buffer object | Representative methods |
| --- | --- |
| ByteAddressBuffer | Load, Load2, Load3, Load4, GetDimensions |
| RWByteAddressBuffer | Load*, Store, Store2, Store3, Store4, InterlockedAdd/And/Or/Xor/Min/Max/Exchange/CompareExchange/CompareStore, GetDimensions |
| StructuredBuffer<T> | Operator [], GetDimensions |
| RWStructuredBuffer<T> | Operator [], GetDimensions, selected Interlocked* on eligible elements |
| AppendStructuredBuffer<T> | Append |
| ConsumeStructuredBuffer<T> | Consume |
| Buffer<T> | Operator [], GetDimensions |
| RWBuffer<T> | Operator [], GetDimensions, selected Interlocked* |

~~~hlsl
RWByteAddressBuffer Bits : register(u0);

void SetAndRead(uint index, uint value, out uint old)
{
    uint offsetBytes = index * 4u;
    Bits.InterlockedExchange(offsetBytes, value, old);
}
~~~

- **What:** Exchange atomically replaces the 32-bit word at the given byte offset.
- **Why:** Index multiplication is mandatory for byte-addressing. Recording the previous word supports state-transition diagnostics.
- **Caution:** Specific object-method overloads and typed atomic formats vary with shader model.

## 12. System-value semantics by stage

| Semantic | Used for |
| --- | --- |
| SV_Position | Clip position out of vertex-like stages; rasterized position into pixel shader |
| SV_Target0..n | Pixel outputs to render targets |
| SV_Depth, SV_DepthGreaterEqual, SV_DepthLessEqual | Pixel depth outputs |
| SV_VertexID, SV_InstanceID | System-generated vertex and instance indices |
| SV_PrimitiveID | Primitive identity where stage allows |
| SV_IsFrontFace | Front/back facing in pixel stage |
| SV_SampleIndex, SV_Coverage | Multisample/sample coverage information |
| SV_DispatchThreadID | Compute global thread index |
| SV_GroupID | Compute group index |
| SV_GroupThreadID | Compute local 3D thread index |
| SV_GroupIndex | Compute local flattened thread index |
| SV_DomainLocation | Domain shader tessellation coordinates |
| SV_OutputControlPointID | Hull shader output control-point index |
| SV_TessFactor, SV_InsideTessFactor | Tessellation factors |
| SV_GSInstanceID, SV_RenderTargetArrayIndex, SV_ViewportArrayIndex | Selected geometry/raster routing values |
| SV_ShadingRate | Variable-rate shading where supported |
| SV_Barycentrics | Barycentric coordinates under supported profile |
| SV_ViewID | Multi-view instancing where supported |

~~~hlsl
[numthreads(8,8,1)]
void WriteID(uint3 thread : SV_DispatchThreadID,
             uint3 group : SV_GroupID)
{
    // thread.xy identifies data coordinates;
    // group.xy identifies the dispatched tile.
}
~~~

- **What:** These semantics are inputs supplied by the pipeline rather than ordinary user variables.
- **Why:** They connect one invocation to its geometry, raster context or compute dispatch.
- **Read exact legality:** [Microsoft semantic table](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-semantics). Stage availability and semantics are not uniform.

## 13. Attributes and control-flow annotations

| Attribute / modifier | Typical use |
| --- | --- |
| [numthreads(x,y,z)] | Compute group size |
| [unroll], [loop], [fastopt] | Loop compilation hints |
| [branch], [flatten] | Branch optimization hints |
| [allow_uav_condition] | Annotate loops with UAV-dependent termination for appropriate compiler paths |
| [maxvertexcount(n)] | Geometry shader maximum output |
| [domain("tri" / "quad" / "isoline")] | Hull/domain tessellation domain |
| [partitioning("integer" / "fractional_even" / ...)] | Tessellation partitioning |
| [outputtopology(...)] | Tessellation output topology |
| [outputcontrolpoints(n)] | Hull shader control points |
| [patchconstantfunc("name")] | Hull patch-constant function |
| [instance(n)] | Geometry shader instance count |
| [RootSignature("...")] | Embedded D3D12 binding layout |
| [shader("raygeneration" / "miss" / "closesthit" / ...)] | DXR shader kind |
| [outputtopology("triangle")] + [numthreads(...)] | Mesh shader declarations, with further mesh-specific requirements |

~~~hlsl
float Poly(float x)
{
    float y = 1.0f;
    [unroll]
    for (int i = 0; i < 4; ++i)
        y = y * x + 1.0f;
    return y;
}
~~~

- **What:** [unroll] requests loop unrolling.
- **Why:** Removing control overhead may help short constant-trip loops.
- **Caution:** Unrolling can increase code size/register pressure; attributes are stage/compiler specific and not a substitute for measuring performance.

## 14. Legacy API names and less-common intrinsics

The Microsoft index also includes **dst, lit, noise, D3DCOLORtoUBYTE4, msad4, errorf, printf, abort** and the **Process* TessFactors** families, plus legacy fixed-function sampler calls:

~~~hlsl
// Old FXC-era HLSL style; do not use for new DXC/SM6 code:
sampler2D LegacySampler : register(s0);
float4 LegacyPS(float2 uv : TEXCOORD0) : COLOR0
{
    return tex2D(LegacySampler, uv);
}
~~~

- **What:** tex1D / tex2D / tex3D / texCUBE and their bias/grad/lod/proj variants belong to older HLSL programming styles.
- **Why:** Recognize them when maintaining legacy shaders; modern code uses typed texture objects and SamplerState with Sample* methods.
- **Also indexed:** ProcessTriTessFactorsAvg/Max/Min; ProcessQuadTessFactorsAvg/Max/Min; Process2DQuadTessFactorsAvg/Max/Min; ProcessIsolineTessFactors. These are specialist hull-shader tessellation helpers.
- **Do not copy blindly:** Intrinsics like noise or shader printf have profile/tooling restrictions. Confirm compiler support before use.

## 15. How to look up *any* API correctly

~~~text
Name → overload signature → minimum Shader Model → allowed stages
     → resource format / feature support → memory/precision semantics
     → host binding requirements → test on target driver
~~~

~~~hlsl
// Example lookup candidate:
float a = lerp(0.0f, 1.0f, 0.25f);
~~~

- **What:** The expression uses a standard arithmetic intrinsic.
- **Why:** The lookup sequence matters more for uncommon APIs, where signature, feature gates, stage legality and host setup are easy to conflate.
- **Primary indexes:** [Intrinsic functions](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-intrinsic-functions); [HLSL reference](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl); [Shader Model 6 waves](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/shader-model-6-0); [DXC compiler](https://github.com/microsoft/DirectXShaderCompiler).

[← Resources](04-resources-host.md) · [Next: advanced topics →](06-advanced.md)
