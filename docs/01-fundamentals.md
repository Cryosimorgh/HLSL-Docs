# 01 — HLSL fundamentals: the language and GPU execution model

> **Scope:** Modern High-Level Shader Language (HLSL), primarily Direct3D 12 + DXC + Shader Model 6.x. Older D3D11/FXC differences are marked explicitly. Examples use HLSL unless stated otherwise.

[← Handbook](../README.md) · [Next: graphics and textures →](02-graphics-textures.md)

## 1. What HLSL is—and is not

HLSL describes programs executed at programmable GPU pipeline stages. It is **not** the Direct3D API: host code creates resources, descriptor bindings, command lists and synchronization; shaders read and write those resources.

~~~mermaid
flowchart LR
  A["Host application (CPU)"] --> B["Upload constants / buffers / textures"]
  B --> C["Bind descriptors + pipeline"]
  C --> D["Record Draw / Dispatch"]
  D --> E["GPU executes HLSL"]
  E --> F["Render targets / UAV buffers"]
  F --> G["Readback / presentation"]
~~~

**Example — a minimal pixel shader**

~~~hlsl
float4 ps_main() : SV_Target0
{
    return float4(0.1f, 0.5f, 0.9f, 1.0f);
}
~~~

- **What:** The entry point returns RGBA, with a declared render-target semantic.
- **Why:** The rasterizer runs the pixel shader for covered samples; the Direct3D render-target format and blending state decide the final stored value.
- **Host requirement:** Bind a render target, create a suitable graphics PSO, draw geometry. This function alone cannot display a window.

## 2. Source → compiled shader → GPU commands

~~~mermaid
flowchart TD
  A[".hlsl / .hlsli sources"] --> B["Preprocessing and includes"]
  B --> C["DXC compiler + entry point + target profile"]
  C --> D["DXIL shader container"]
  D --> E["Driver / D3D12 PSO creation"]
  E --> F["Root signature and bound resources"]
  F --> G["Draw / Dispatch / DispatchRays"]
  G --> H["GPU execution"]
~~~

**Compile an example:**

~~~powershell
dxc -T cs_6_0 -E CSMain -Fo example.dxil example.hlsl
dxc -T vs_6_0 -E VSMain -Fo vertex.dxil example.hlsl
dxc -T ps_6_0 -E PSMain -Fo pixel.dxil example.hlsl
~~~

- **What:** -T selects a target *profile* (stage + Shader Model); -E selects the entry function; -Fo writes output.
- **Why:** A file can contain multiple entry points; graphics stages require distinct binaries. DXC emits DXIL for D3D12 SM6 profiles.
- **Check:** D3D12 feature support and shader-model support at runtime. A successful compile is not proof that a particular GPU can execute the shader.
- **Legacy:** FXC generally targets DXBC and SM 5.1 or earlier; DXC is the normal SM6 compiler. SPIR-V output is a separate DXC configuration, not DXIL.

## 3. Stages and jobs

| Stage | Profile prefix | Job |
| --- | --- | --- |
| Vertex | vs_ | Per-vertex transform and varyings |
| Hull | hs_ | Tessellation control and patch constants |
| Domain | ds_ | Evaluate tessellated coordinates |
| Geometry | gs_ | Process/emit primitives; often expensive |
| Pixel | ps_ | Surface shading, depth and render-target outputs |
| Compute | cs_ | General GPU work (simulation, processing, culling) |
| Amplification / task | as_ | Dispatch mesh shader work |
| Mesh | ms_ | Generate vertices/primitives without classic IA/VS stages |
| Ray tracing libraries | lib_ | DXR entry points such as ray-generation, miss, closest-hit |

**Selection example**

~~~hlsl
// Use compute for physics: no rasterization needed.
[numthreads(64, 1, 1)]
void Integrate(uint3 dispatchID : SV_DispatchThreadID)
{
    // Independently process a body by dispatchID.x.
}
~~~

- **What:** The attribute sets threads per compute group.
- **Why:** A physics solver does not need to produce triangles or fragments. Mesh/geometry/ray stages are for different pipeline contracts.
- **Caveat:** Shader Model and D3D12 feature support depend on the stage; not every device supports mesh or ray tracing.

## 4. Types, scalars, vectors and matrices

Common scalar types: bool, int, uint, float (32-bit), double (64-bit where supported), int64_t, uint64_t; min-precision types and native 16-bit types require careful distinction. Vectors have 1–4 components: float3; matrices: float4x4 (rows × columns).

~~~hlsl
float3 position = float3(1.0f, 2.0f, 3.0f);
float4 homogeneous = float4(position, 1.0f);
float2 xy = position.xy;                 // component swizzle
uint rawBits = asuint(position.x);       // bit reinterpretation
float copiedBits = asfloat(rawBits);
float converted = (float)rawBits;        // NUMERIC conversion, not bitcast
~~~

- **What:** Constructors fill components; .xy swizzles selected lanes; asuint/asfloat preserve 32-bit patterns.
- **Why:** Bit reinterpretation is necessary for packed buffers and float bit storage; numeric casts change values.
- **Pitfall:** double operations require device and shader support. Do not assume all math intrinsics have equally fast or available double implementations.

### Matrices, multiplication order and layout

~~~hlsl
cbuffer Transform : register(b0)
{
    row_major float4x4 worldViewProjection;
};

float4 TransformPoint(float3 p)
{
    return mul(float4(p, 1.0f), worldViewProjection);
}
~~~

- **What:** mul(vector, matrix) uses row-vector algebra. row_major chooses the matrix storage major order for the shader constant.
- **Why:** CPU and GPU must agree on both multiplication convention **and** byte layout. Transpose on the host or change conventions intentionally; do not fix a mismatch by trial and error.
- **Important:** row_major/column_major control matrix storage and packing; they do not by themselves transpose an arithmetic expression. Default matrix packing is typically column-major unless changed.

## 5. Functions, structs and parameter modifiers

~~~hlsl
struct Material
{
    float3 baseColor;
    float roughness;
};

float Luminance(float3 c)
{
    return dot(c, float3(0.2126f, 0.7152f, 0.0722f));
}

void Evaluate(in Material m, out float intensity)
{
    intensity = saturate(Luminance(m.baseColor));
}
~~~

- **What:** Struct groups related values. in passes an input; out writes a caller-visible output.
- **Why:** Functions make cross-stage math reusable, and explicit parameter direction documents intent.
- **Also:** inout reads and writes. Overloads and templates have version-sensitive rules; HLSL 2021 extends C++-style support. Shader entry points can have stage-specific attributes and semantics.

## 6. Conditionals, loops, hints and safe indexing

~~~hlsl
StructuredBuffer<float3> Positions : register(t0);
RWStructuredBuffer<float> Distances : register(u0);
cbuffer Settings : register(b0) { uint count; float3 origin; };

[numthreads(64, 1, 1)]
void CSMain(uint3 id : SV_DispatchThreadID)
{
    uint i = id.x;
    if (i >= count) return;            // dispatch is rounded up
    float3 delta = Positions[i] - origin;
    Distances[i] = length(delta);
}
~~~

- **What:** Per-thread guard prevents reading/writing past logical element count.
- **Why:** Dispatch group sizes are fixed; the final group often has unused lanes.
- **Performance:** Divergent branches can reduce SIMD/wave efficiency; prefer correctness, then profile. Attributes [branch], [flatten], [loop], [unroll] are compiler hints, not performance guarantees.
- **Safety:** An out-of-bounds UAV access is never a valid capacity-management strategy. Initialize outputs before reading them.

## 7. Preprocessor, includes and compile-time configuration

~~~hlsl
#ifndef WORKGROUP_SIZE
#define WORKGROUP_SIZE 64
#endif

#include "shared_math.hlsli"

[numthreads(WORKGROUP_SIZE, 1, 1)]
void CSMain(uint3 id : SV_DispatchThreadID)
{
    // ...
}
~~~

~~~powershell
dxc -T cs_6_0 -E CSMain -D WORKGROUP_SIZE=128 -I shaders/include -Fo out.dxil shader.hlsl
~~~

- **What:** -D sets a macro; -I adds an include search directory.
- **Why:** Variants can be compiled from one source without runtime branching.
- **Watch:** A changed include must invalidate incremental-build caches. Track both compiler options and transitive includes in build hashes.

## 8. Semantics: interfaces, not arbitrary decoration

~~~hlsl
struct VSOut
{
    float4 clip : SV_Position;
    float2 uv   : TEXCOORD0;
};

VSOut VSMain(float3 pos : POSITION, float2 uv : TEXCOORD0)
{
    VSOut o;
    o.clip = float4(pos, 1);
    o.uv = uv;
    return o;
}
~~~

- **What:** POSITION and TEXCOORD0 identify vertex-input layout elements; SV_Position is clip-space position output; TEXCOORD0 carries a varying.
- **Why:** The Direct3D pipeline links shader stages by semantics and (where relevant) indices. TEXCOORD0 is a generic interpolator name—not necessarily a UV.
- **Check:** PS input semantics must match the VS output. System-value semantics have stage-specific legality; see [the official semantic table](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-semantics).

## 9. Interpolation

~~~hlsl
struct VSOut
{
    float4 clip : SV_Position;
    float2 uv : TEXCOORD0;                 // perspective-correct by default
    nointerpolation uint objectID : TEXCOORD1; // constant per primitive
};

float4 PSMain(VSOut input) : SV_Target0
{
    return float4(input.uv, (input.objectID & 1u) ? 1.0f : 0.0f, 1);
}
~~~

- **What:** nointerpolation stops per-pixel interpolation of integer IDs.
- **Why:** Integer identifiers cannot sensibly be interpolated; continuous UVs generally should be.
- **Also:** noperspective, centroid, sample and linear interpolation variants serve different rasterization/antialiasing use cases.

## 10. Shader Model vs language version vs API

| Term | Controls | Example |
| --- | --- | --- |
| Shader Model | Shader feature/instruction requirements | cs_6_0, ps_6_6 |
| HLSL language version | Parser/type-system semantics | -HV 2021 |
| Graphics API | Resource binding, command submission, PSOs | D3D11 vs D3D12 |
| Hardware features | Actually executable capabilities | Wave ops, native fp16, mesh shaders, DXR |

**Example**

~~~powershell
dxc -HV 2021 -T cs_6_0 -E CSMain -Fo shader.dxil shader.hlsl
~~~

- **What:** HLSL 2021 syntax is selected separately from compute Shader Model 6.0.
- **Why:** A syntax feature does not automatically enable newer GPU instructions; likewise a newer profile does not silently change all language-version choices.

## 11. Integer, floating-point and precision traps

~~~hlsl
uint packed = 0x3f800000u;
float one = asfloat(packed);    // 1.0: same bits
float huge = (float)packed;    // numeric conversion (~1.065e9)
float d = 1.0f / 3.0f;        // approximate 32-bit result
bool ok = isfinite(d) && (abs(d) < 1.0f);
~~~

- **What:** HLSL float is IEEE-style 32-bit data, but operation ordering, denorm handling, optimization and hardware can affect results.
- **Why:** Reproducible simulation requires explicit tolerance policies and checked numerical invariants; do not assume bitwise identical outputs across devices.
- **Native 16-bit:** DXC's -enable-16bit-types changes semantics of width-specific 16-bit scalar types on supported targets; min16float is a *minimum precision* promise and is not equivalent to guaranteed 16-bit storage.

## 12. Official authoritative references

- [Microsoft: HLSL overview](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl)
- [Microsoft: HLSL reference and intrinsics](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-intrinsic-functions)
- [Microsoft: semantics](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-semantics)
- [Microsoft: constant buffer packing](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-packing-rules)
- [DXC: language versions](https://github.com/microsoft/DirectXShaderCompiler/wiki/Language-Versions)

[← Handbook](../README.md) · [Next: graphics and textures →](02-graphics-textures.md)
