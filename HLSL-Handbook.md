# HLSL Handbook — Complete Single-File Edition

**High-Level Shader Language (HLSL), DXC, DirectX 12, Shader Model 6, Graphics and Compute Shader Programming**

Independent reference and tutorial. Last reviewed: 2026-11-09. The original chapter files with easier navigation are [in the README](README.md). This document combines them for single-file reading, downloading and offline search.

## Contents

- [Chapter 1: fundamentals](#01--)
- [Chapter 2: graphics textures](#02--)
- [Chapter 3: compute memory](#03--)
- [Chapter 4: resources host](#04--)
- [Chapter 5: api catalog](#05--)
- [Chapter 6: advanced](#06--)
- [Chapter 7: sunder case study](#07--)

---

# 01 — HLSL fundamentals: the language and GPU execution model

> **Scope:** Modern High-Level Shader Language (HLSL), primarily Direct3D 12 + DXC + Shader Model 6.x. Older D3D11/FXC differences are marked explicitly. Examples use HLSL unless stated otherwise.

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

---

# 02 — Graphics pipeline, texture sampling and pixel output

## 1. How the graphics pipeline works

~~~mermaid
flowchart LR
  A["Vertex input / vertex ID"] --> VS["Vertex shader"]
  VS --> T["Optional hull + tessellation + domain"]
  T --> G["Optional geometry shader"]
  G --> R["Rasterizer and interpolation"]
  R --> PS["Pixel shader"]
  PS --> OM["Depth/stencil + blending + render targets"]
~~~

**Minimal textured pipeline:**

~~~hlsl
cbuffer Camera : register(b0)
{
    float4x4 viewProj;
};

Texture2D<float4> Diffuse : register(t0);
SamplerState LinearSampler : register(s0);

struct VSInput
{
    float3 position : POSITION;
    float2 uv       : TEXCOORD0;
};
struct Varyings
{
    float4 position : SV_Position;
    float2 uv       : TEXCOORD0;
};
Varyings VSMain(VSInput v)
{
    Varyings o;
    o.position = mul(viewProj, float4(v.position, 1));
    o.uv = v.uv;
    return o;
}
float4 PSMain(Varyings v) : SV_Target0
{
    return Diffuse.Sample(LinearSampler, v.uv);
}
~~~

- **What:** b0 is a constant buffer; t0 is a texture SRV; s0 is a sampler. Vertex input comes from the input assembler; output goes through rasterization.
- **Why:** Positions are transformed to clip space, while UVs are interpolated to each fragment. The sampler controls filtering and addressing.
- **Caution:** The example uses column-vector math (mul(matrix, vector)); provide a host matrix with matching convention/layout.

## 2. Clip space, NDC and viewport

~~~mermaid
flowchart LR
  A["Object coordinates"] --> B["World"]
  B --> C["View / camera"]
  C --> D["Clip coordinates (x,y,z,w)"]
  D --> E["Perspective divide x/w,y/w,z/w"]
  E --> F["D3D NDC: x,y in [-1,1], z in [0,1]"]
  F --> G["Viewport pixels / depth"]
~~~

~~~hlsl
float4 clip = mul(viewProj, float4(worldPos, 1.0f));
// D3D clip-space convention (typical): x and y in [-w,+w],
// z in [0,w] before divide. Correct projection setup is required.
~~~

- **What:** The VS writes **clip-space** float4 to SV_Position; rasterization performs clipping, perspective divide and viewport transform.
- **Why:** Dividing by w yourself in the VS generally loses correct clipping/perspective behavior.
- **Caution:** Reverse-Z depth and custom projection matrices change depth mapping; verify viewport, depth test and projection together.

## 3. Rasterization, derivatives and front faces

~~~hlsl
Texture2D<float4> Albedo : register(t0);
SamplerState Samp : register(s0);

float4 PSMain(float2 uv : TEXCOORD0, bool front : SV_IsFrontFace)
    : SV_Target0
{
    float2 scale = float2(length(ddx(uv)), length(ddy(uv)));
    float4 c = Albedo.Sample(Samp, uv);
    return front ? c : float4(c.rgb * 0.3f, c.a);
}
~~~

- **What:** ddx/ddy compute screen-space derivatives; SV_IsFrontFace identifies front-facing primitives.
- **Why:** Texture Sample uses derivatives to choose filtering/mip level. Derivatives are tied to pixel quads and are not generally available in ordinary compute shaders.
- **Risk:** Derivatives in divergent control flow can be undefined or implementation-sensitive. Compute shaders typically use SampleLevel or SampleGrad with explicit LOD/gradients.

## 4. Texture objects and methods

| Object / method | Representative syntax | Purpose |
| --- | --- | --- |
| Texture2D<float4> | Texture2D<float4> tex : register(t0); | Read-only 2D texture (SRV) |
| Texture2DArray / TextureCube | Texture2DArray<float4> a; | Arrays / cube maps |
| Texture3D / Texture1D | Texture3D<float4> volume; | Volumes / one-dimensional |
| Texture2DMS | Texture2DMS<float4> ms; | Multisample texture |
| RWTexture2D<float4> | RWTexture2D<float4> outTex : register(u0); | Writeable texture UAV |
| Sample | tex.Sample(samp, uv) | Filtered sampling with implicit LOD |
| SampleLevel | tex.SampleLevel(samp, uv, lod) | Explicit LOD |
| SampleGrad | tex.SampleGrad(samp, uv, ddxUV, ddyUV) | Explicit gradients |
| SampleBias | tex.SampleBias(samp, uv, bias) | Mip bias |
| SampleCmp | depth.SampleCmp(cmpSamp, uv, ref) | Comparison sampling |
| Gather / GatherRed | tex.Gather(samp, uv) | Fetch nearby channel samples |
| Load | tex.Load(int3(x,y,mip)) | Direct texel read, no filtering |
| GetDimensions | tex.GetDimensions(w,h) | Query dimensions |

**Sampling example:**

~~~hlsl
Texture2D<float4> Heightmap : register(t0);
SamplerState LinearClamp : register(s0);

float SampleHeight(float2 uv, int2 pixel)
{
    uint w, h;
    Heightmap.GetDimensions(w, h);
    float filtered = Heightmap.SampleLevel(LinearClamp, uv, 0).r;
    float exactTexel = Heightmap.Load(int3(pixel, 0)).r;
    return lerp(exactTexel, filtered, 0.5f);
}
~~~

- **What:** SampleLevel filters with explicit mip 0; Load reads an integer-addressed texel; GetDimensions reports dimensions.
- **Why:** Simulation kernels often require exact texels, whereas rendering benefits from filtering.
- **Caution:** The pixel coordinate must be valid. Boundaries, mip levels, residency and texture formats require explicit policy.

## 5. Samplers, color spaces and format traps

~~~hlsl
Texture2D<float4> ColorMap : register(t0);
SamplerState LinearWrap : register(s0);

float4 PSMain(float2 uv : TEXCOORD0) : SV_Target0
{
    float4 base = ColorMap.Sample(LinearWrap, uv);
    return float4(base.rgb, base.a);
}
~~~

- **What:** Sampling uses filtering/address modes supplied by a D3D sampler state; HLSL only declares the binding.
- **Why:** Keep image data and sampling policy separate; different materials can share textures or samplers.
- **Color:** An SRGB SRV generally converts sampled RGB to linear values. Render to an sRGB-capable target where appropriate; do not blindly apply pow(x, 1/2.2) and then also use sRGB output conversion (double conversion).
- **Formats:** A texture's typed HLSL declaration and view format must be compatible. For RWTexture2D, hardware/format support for typed UAV stores/loads must be checked.

## 6. Render targets, blending, alpha, depth and discard

~~~hlsl
struct Fragment
{
    float4 color : SV_Target0;
    float  depth : SV_Depth;
};

Fragment PSMain(float2 uv : TEXCOORD0, float4 pos : SV_Position)
{
    float r2 = dot(uv - 0.5f, uv - 0.5f);
    if (r2 > 0.25f) discard;
    Fragment f;
    f.color = float4(1.0f, 0.4f, 0.1f, 1.0f);
    f.depth = pos.z;   // pixel-stage SV_Position.z is depth-space
    return f;
}
~~~

- **What:** SV_Target0 writes render target 0; SV_Depth overrides rasterizer-generated depth; discard suppresses an output.
- **Why:** Procedural impostors can reject fragments and write analytically computed depth.
- **Trade-off:** Custom depth, UAV writes and discard can affect early-Z and performance. Blend state, sample mask and depth/stencil state live in the host pipeline, not inside this shader.

## 7. Vertex/instance ID instead of vertex buffers

~~~hlsl
struct Out { float4 clip : SV_Position; };

Out VSMain(uint vertex : SV_VertexID, uint instance : SV_InstanceID)
{
    float2 corners[6] = {
        float2(-1,-1), float2(-1,1), float2(1,1),
        float2(-1,-1), float2(1,1), float2(1,-1)
    };
    float2 center = float2((instance % 16u) * 0.125f - 0.9f, 0.0f);
    Out o;
    o.clip = float4(center + corners[vertex] * 0.05f, 0, 1);
    return o;
}
~~~

- **What:** SV_VertexID identifies 0–5 of each generated quad; SV_InstanceID selects one of many placements.
- **Why:** An instanced draw can generate billboard geometry without uploading per-vertex data.
- **Host:** DrawInstanced(6, instanceCount, 0, 0). Ensure no illegal vertex index; the shader assumes six vertices per instance.

## 8. Tessellation, geometry, mesh and amplification

These are distinct alternatives/optional stages—not features that must all be used at once.

~~~hlsl
// Geometry-stage sketch (not a full pipeline):
[maxvertexcount(3)]
void GSMain(triangle Varyings tri[3],
            inout TriangleStream<Varyings> outStream)
{
    outStream.Append(tri[0]);
    outStream.Append(tri[1]);
    outStream.Append(tri[2]);
    outStream.RestartStrip();
}
~~~

- **What:** A geometry shader receives a primitive and can emit a strip.
- **Why:** It can transform or duplicate primitives, but it is not generally the fastest approach for high-volume particle/geometry expansion.
- **Tessellation:** Hull shaders define per-patch control and tess factors; domain shaders evaluate generated coordinates.
- **Mesh shaders:** Shader Model 6.5-era mesh pipelines use mesh/amplification stages and require explicit D3D12 device capability checks. Their output/dispatch attributes differ from VS/GS.
- **Recommendation:** Prefer VS instancing or compute-driven culling unless measurements justify special stages.

## 9. Ray tracing HLSL (DXR)

~~~hlsl
RaytracingAccelerationStructure Scene : register(t0);

struct Payload
{
    float3 radiance;
};

[shader("miss")]
void Miss(inout Payload payload)
{
    payload.radiance = float3(0.02f, 0.04f, 0.08f);
}
~~~

- **What:** A miss shader writes a payload when a ray traverses the acceleration structure without a hit.
- **Why:** Ray tracing is a separate D3D12 pipeline: shader libraries, shader tables, acceleration structures and DispatchRays are host-managed.
- **Not a complete ray tracer:** Closest-hit/raygen/hit group exports, root arguments, payload sizes and state-object creation are also required. See the official DXR documentation for those APIs.

## 10. Practical image/graphics debugging

~~~hlsl
float4 PSMain(float2 uv : TEXCOORD0) : SV_Target0
{
    // Visualize UV coordinates rather than texture color:
    return float4(saturate(uv), 0.0f, 1.0f);
}
~~~

- **What:** Red is U; green is V.
- **Why:** This isolates vertex input, interpolation and orientation from texture import and sampler state.
- **Check:** Triangle winding/culling, clip-space w, viewport, color-space conversions, depth range, descriptor type and root signature compatibility.

## Primary sources

- [HLSL semantics](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-semantics)
- [HLSL texture object methods](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-to-getdimensions)
- [Intrinsic functions](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-intrinsic-functions)
- [Root signatures](https://learn.microsoft.com/en-us/windows/win32/direct3d12/root-signatures)

---

# 03 — Compute shaders, thread indexing, GPU memory and synchronization

## 1. Dispatch, groups, threads and global index

~~~mermaid
flowchart TD
  D["Dispatch(3, 2, 1)"] --> G["6 thread groups"]
  G --> A["Group (0,0,0)"]
  G --> B["Group (1,0,0)"]
  G --> C["... Group (2,1,0)"]
  A --> T["numthreads(8,4,1) = 32 threads"]
  T --> I["SV_GroupThreadID: local (0..7,0..3,0)"]
  T --> J["SV_DispatchThreadID: global coordinates"]
~~~

~~~hlsl
RWStructuredBuffer<uint> Out : register(u0);
cbuffer Config : register(b0) { uint width; uint height; uint2 pad; };

[numthreads(8, 4, 1)]
void CSMain(uint3 gid : SV_GroupID,
            uint3 local : SV_GroupThreadID,
            uint3 global : SV_DispatchThreadID,
            uint lane : SV_GroupIndex)
{
    if (global.x >= width || global.y >= height) return;
    uint i = global.y * width + global.x;
    Out[i] = lane + 32u * gid.x;
}
~~~

- **What:** Local IDs index within a group; GroupIndex flattens the group; DispatchThreadID is global; GroupID chooses the group.
- **Why:** Global IDs index datasets, while local IDs index groupshared scratch arrays.
- **Host:** Dispatch(ceil(width/8), ceil(height/4), 1) in D3D12. The third dimension supports 3D datasets.
- **Limits:** For modern cs_5_0+ profiles, numthreads product is at most 1024; dimensions and Dispatch limits are separately constrained by the API/device.

## 2. One thread per item: vector update

~~~hlsl
StructuredBuffer<float3> Position : register(t0);
StructuredBuffer<float3> Velocity : register(t1);
RWStructuredBuffer<float3> NextPosition : register(u0);

cbuffer Step : register(b0)
{
    uint count;
    float dt;
    float2 padding;
};

[numthreads(256, 1, 1)]
void Integrate(uint3 id : SV_DispatchThreadID)
{
    uint i = id.x;
    if (i >= count) return;
    NextPosition[i] = Position[i] + dt * Velocity[i];
}
~~~

- **What:** Each valid invocation writes exactly one output element.
- **Why:** Independent writes avoid atomics and intra-pass data races.
- **Design:** Use source and destination buffers when a pass must not see neighbors' partially updated values. A single in-place output is safe only if there is no cross-element dependency.

## 3. Groupshared memory and group barriers

~~~hlsl
StructuredBuffer<float> In : register(t0);
RWStructuredBuffer<float> GroupSums : register(u0);
cbuffer Config : register(b0) { uint count; uint3 pad; };

groupshared float sharedData[64];

[numthreads(64, 1, 1)]
void SumGroup(uint3 gid : SV_GroupID,
              uint lane : SV_GroupIndex)
{
    uint i = gid.x * 64u + lane;
    sharedData[lane] = (i < count) ? In[i] : 0.0f;
    GroupMemoryBarrierWithGroupSync();

    for (uint stride = 32u; stride > 0u; stride >>= 1u)
    {
        if (lane < stride)
            sharedData[lane] += sharedData[lane + stride];
        GroupMemoryBarrierWithGroupSync();
    }
    if (lane == 0u) GroupSums[gid.x] = sharedData[0];
}
~~~

- **What:** groupshared declares one scratch array per thread group. All 64 threads populate it before reading neighbors; barriers synchronize accesses.
- **Why:** Without the first barrier, thread 0 may read another lane before it stores its value. Each reduction iteration also needs a barrier.
- **Critical rule:** All threads in the group must reach WithGroupSync at the same control-flow point. Never return or branch around it for only some lanes. This example masks out-of-range loads instead of exiting early.
- **Limits:** Groupshared capacity is device/profile dependent; measure occupancy and register use.

## 4. Barrier meanings—not all barriers are interchangeable

| Function | Visibility / purpose | Group execution sync? |
| --- | --- | --- |
| GroupMemoryBarrier() | Order groupshared memory within group | No |
| GroupMemoryBarrierWithGroupSync() | groupshared + group rendezvous | Yes |
| DeviceMemoryBarrier() | Order device memory accesses in documented scope | No |
| DeviceMemoryBarrierWithGroupSync() | Device memory ordering plus group sync | Yes |
| AllMemoryBarrier() | Group and device memory ordering | No |
| AllMemoryBarrierWithGroupSync() | Both categories plus group sync | Yes |

~~~hlsl
groupshared uint ready;
[numthreads(64,1,1)]
void SafeGroup(uint lane : SV_GroupIndex)
{
    if (lane == 0u) ready = 123u;
    GroupMemoryBarrierWithGroupSync();
    uint value = ready; // group has published the write
}
~~~

- **What:** This is an **intra-dispatch, intra-group** synchronization pattern.
- **Why:** No ordinary group barrier synchronizes *all thread groups in a dispatch*. For a global multi-stage algorithm, split into dispatches and use D3D12 resource/UAV barriers as needed on the host.
- **Advanced:** Shader Model 6.8 adds more memory-model facilities; do not assume legacy intrinsics become global barriers.

## 5. Atomics (Interlocked*) and uniqueness

~~~hlsl
RWByteAddressBuffer CounterAndIndices : register(u0);
// byte offset 0: counter; byte offset 4 onward: output indices.

[numthreads(64,1,1)]
void AppendIndex(uint3 id : SV_DispatchThreadID)
{
    if ((id.x & 1u) != 0u) return;
    uint slot;
    CounterAndIndices.InterlockedAdd(0u, 1u, slot);
    if (slot < 1024u)
        CounterAndIndices.Store(4u + slot * 4u, id.x);
}
~~~

- **What:** InterlockedAdd atomically increments a counter and retrieves its old value into slot.
- **Why:** Multiple threads reserve unique slots without collisions.
- **Hazard:** The counter still grows past 1024; this code prevents out-of-bounds stores but does not implement bounded admission or overflow recovery. A production capacity contract must specify overflow behavior and error reporting.
- **Memory model:** Atomics do **not** automatically imply all required memory fences for associated payload writes.

## 6. Atomic families and data types

| Family | Representative names | Why |
| --- | --- | --- |
| Arithmetic | InterlockedAdd | Unique tickets, counters |
| Min/max | InterlockedMin / InterlockedMax | Reductions, extrema |
| Bitwise | InterlockedAnd / Or / Xor | Flags and masks |
| Exchange | InterlockedExchange | Publish a value |
| Compare/exchange | InterlockedCompareExchange | Lock-free conditional update |
| Compare/store | InterlockedCompareStore | Conditional mutation without returned old value |

~~~hlsl
groupshared uint minimum;
[numthreads(64,1,1)]
void MinExample(uint lane : SV_GroupIndex)
{
    if (lane == 0) minimum = 0xffffffffu;
    GroupMemoryBarrierWithGroupSync();
    InterlockedMin(minimum, lane * 3u);
    GroupMemoryBarrierWithGroupSync();
    uint result = minimum; // result == 0
}
~~~

- **What:** Atomic minimum prevents lost updates from concurrent lanes.
- **Why:** A regular minimum = min(minimum, x) is a read-modify-write race.
- **Type restrictions:** Classical interlocked ops are typically int/uint; SM6.6 adds selected 64-bit and floating-point atomic capabilities under specific resource/device conditions. Check exact support per target/profile.

## 7. Data layouts: AoS, SoA and AoSoA

~~~mermaid
flowchart TD
  A["Array of Structures (AoS)"] --> A1["[x0,y0,z0,v0] [x1,y1,z1,v1] ..."]
  B["Structure of Arrays (SoA)"] --> B1["[x0,x1,...] [y0,y1,...] [z0,z1,...]"]
  C["Array of Structures of Arrays"] --> C1["Tiles of SoA fields"]
~~~

~~~hlsl
ByteAddressBuffer State : register(t0);
cbuffer Layout : register(b0) { uint count; uint3 padding; };

// SoA 32-bit fields: field 0 is x, field 1 is y, field 2 is z.
float ReadField(uint body, uint field)
{
    uint byteOffset = 4u * (field * count + body);
    return asfloat(State.Load(byteOffset));
}

float3 ReadPosition(uint body)
{
    return float3(ReadField(body, 0), ReadField(body, 1), ReadField(body, 2));
}
~~~

- **What:** One field for all bodies sits contiguously in memory.
- **Why:** If neighboring lanes load the same field for adjacent bodies, addresses are adjacent and can be coalesced efficiently.
- **Trade-off:** Reading many attributes for one body may need multiple memory regions; profile actual access patterns. ByteAddressBuffer indexing is in **bytes**, not float elements.

## 8. Raw buffers, bitcasts and double-precision storage

~~~hlsl
RWByteAddressBuffer State : register(u0);

double ReadDouble(uint byteOffset)
{
    uint2 words = State.Load2(byteOffset);
    return asdouble(words.x, words.y);
}

void WriteDouble(uint byteOffset, double value)
{
    uint low, high;
    asuint(value, low, high);
    State.Store2(byteOffset, uint2(low, high));
}
~~~

- **What:** A double is represented by two 32-bit words, read at an 8-byte-aligned position in this example.
- **Why:** Raw buffers expose exact byte-level layouts used by mixed CPU/GPU simulation systems.
- **Warning:** Double math support and throughput differ by device. A double cannot be treated as two independent float values; asdouble/asuint here are bit reinterpretations.
- **Host:** Define matching offsets with explicit types, alignment and endian assumptions; test serialization with known bit patterns.

## 9. Waves, lanes and cooperative operations (SM 6.0+)

~~~hlsl
RWStructuredBuffer<uint> WaveTotals : register(u0);

[numthreads(64,1,1)]
void CountWave(uint3 id : SV_DispatchThreadID)
{
    uint active = ((id.x & 1u) == 0u) ? 1u : 0u;
    uint total = WaveActiveSum(active);
    if (WaveIsFirstLane())
    {
        // wave index may vary by device; one output per wave requires
        // an explicitly derived or reserved index, not this demo.
        WaveTotals[id.x] = total;
    }
}
~~~

- **What:** WaveActiveSum reduces over active lanes in the current wave; WaveIsFirstLane selects one active lane.
- **Why:** Wave operations can avoid groupshared barriers for local reductions.
- **Caveat:** Hardware wave size can vary; 64 threads are not necessarily one wave. For production, reserve output slots safely or use a group-specific index. Helper lanes and divergent flow affect participation.

**Common wave API families**

- Queries: WaveGetLaneCount, WaveGetLaneIndex, WaveIsFirstLane.
- Votes: WaveActiveAllTrue, WaveActiveAnyTrue, WaveActiveBallot, WaveActiveCountBits.
- Broadcast/shuffle: WaveReadLaneAt, WaveReadLaneFirst.
- Reductions: WaveActiveSum, WaveActiveProduct, WaveActiveMin, WaveActiveMax, WaveActiveBitAnd/Or/Xor.
- Prefix: WavePrefixSum, WavePrefixProduct, WavePrefixCountBits.
- Quad: QuadReadAcrossX/Y/Diagonal, QuadReadLaneAt (stage/profile constraints apply).

## 10. Multi-pass algorithms and host-side UAV synchronization

~~~mermaid
flowchart LR
  A["Dispatch A: build spatial hash"] --> B["UAV barrier"]
  B --> C["Dispatch B: generate contacts"]
  C --> D["UAV barrier"]
  D --> E["Dispatch C: solve"]
  E --> F["UAV barrier"]
  F --> G["Dispatch D: publish accepted state"]
~~~

~~~cpp
// D3D12 host-side pseudocode; not HLSL:
DispatchBuildGrid();
ResourceBarrier(UAVBarrier(gridBuffer)); // order UAV writes/reads
DispatchGenerateContacts();
ResourceBarrier(UAVBarrier(contactBuffer));
DispatchSolve();
~~~

- **What:** A D3D12 UAV barrier establishes ordering across relevant UAV operations on the command list/queue.
- **Why:** A group barrier inside HLSL cannot guarantee that separate thread groups have finished writing before another group reads their results.
- **Transition:** When a resource changes use (UAV → SRV, copy source, etc.), the host may need a resource-state transition or enhanced barrier; a UAV barrier alone is not a state transition.
- **Caution:** Cross-queue synchronization also needs appropriate fences; don't assume command-list barrier calls alone cover independent queues.

## 11. Shared-memory race patterns

~~~hlsl
groupshared uint tile[64];

[numthreads(64,1,1)]
void ReadAfterWrite(uint lane : SV_GroupIndex)
{
    tile[lane] = lane;
    GroupMemoryBarrierWithGroupSync();
    uint neighbor = tile[(lane + 1u) & 63u];
    // neighbor is safe because each lane completed its write.
}
~~~

- **What:** Synchronization surrounds a cross-lane dependency.
- **Why:** GPU dispatch threads are not executed in source-code order across lanes.
- **Don't:** Use globallycoherent as a substitute for a global barrier; coherence controls visibility scope, not an implicit all-groups rendezvous.

## 12. Practical performance and correctness checklist

~~~hlsl
// Pattern: guard before work, separate source/destination, contiguous writes.
[numthreads(256,1,1)]
void Kernel(uint3 id : SV_DispatchThreadID)
{
    uint i = id.x;
    if (i >= count) return;
    Out[i] = SomeFunction(In[i]);
}
~~~

- Prefer contiguous accesses; measure memory bandwidth and bytes per body.
- Avoid over-large groups when register pressure reduces occupancy; benchmark 64, 128, 256 where sensible.
- Distinguish shader execution time from CPU submit, synchronization, readback and presentation.
- Use GPU timestamps, D3D12 debug layer, GPU-based validation and controlled workloads.
- Check every capacity and overflow path; rejected/failed writes must not publish partially accepted simulation state.
- Ensure all required barriers and state transitions exist across passes.
- Never infer deterministic/replayable physics merely from passing a few visual frames.

## Sources

- [numthreads](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/sm5-attributes-numthreads)
- [RWByteAddressBuffer methods](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/sm5-object-rwbyteaddressbuffer)
- [InterlockedAdd and memory fence warning](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/interlockedadd)
- [HLSL Shader Model 6 wave operations](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/hlsl-shader-model-6-0-features-for-direct3d-12)
- [D3D12 resource barriers](https://learn.microsoft.com/en-us/windows/win32/direct3d12/using-resource-barriers-to-synchronize-resource-states-in-direct3d-12)

---

# 04 — Resource objects, binding, D3D12 root signatures and host integration

## 1. The binding contract: shader declarations vs host resources

~~~mermaid
flowchart LR
  A["HLSL register(b0): cbuffer"] <--> D["D3D12 root CBV / descriptor"]
  B["HLSL register(t0): read-only SRV"] <--> E["D3D12 SRV descriptor"]
  C["HLSL register(u0): read-write UAV"] <--> F["D3D12 UAV descriptor"]
  G["HLSL register(s0): sampler"] <--> H["Sampler heap / static sampler"]
  D --> R["Root signature + pipeline state"]
  E --> R
  F --> R
  H --> R
~~~

**Example shader**

~~~hlsl
cbuffer Params : register(b0, space0)
{
    uint count;
    float gain;
    float2 pad;
};

StructuredBuffer<float> Source : register(t0, space0);
RWStructuredBuffer<float> Destination : register(u0, space0);

[numthreads(64,1,1)]
void CSMain(uint3 id : SV_DispatchThreadID)
{
    uint i = id.x;
    if (i < count) Destination[i] = gain * Source[i];
}
~~~

- **What:** b is CBV constants; t is SRV/read-only resource; u is UAV/read-write resource; s is sampler. space0 is a register namespace.
- **Why:** The CPU can update descriptors/bindings without changing shader source. The root signature must cover everything statically referenced by the shader.
- **Host:** Create resources, SRV/UAV/CBV descriptors or root descriptors, upload constants, bind a compatible root signature and compute PSO, transition states, Dispatch.

## 2. Resource declaration and method taxonomy

| HLSL declaration | Access | Key operations |
| --- | --- | --- |
| cbuffer / ConstantBuffer<T> | Constant read | Field access |
| Buffer<T> | Typed SRV | [index], GetDimensions |
| RWBuffer<T> | Typed UAV | [index], selected atomics |
| StructuredBuffer<T> | Structured SRV | [index], GetDimensions |
| RWStructuredBuffer<T> | Structured UAV | [index], Interlocked* on supported elements |
| AppendStructuredBuffer<T> | Append UAV | Append(value) |
| ConsumeStructuredBuffer<T> | Consume UAV | Consume() |
| ByteAddressBuffer | Raw SRV | Load, Load2/3/4, GetDimensions |
| RWByteAddressBuffer | Raw UAV | Load*, Store*, Interlocked* |
| Texture* | Texture SRV | Sample*, Gather*, Load, GetDimensions |
| RWTexture* | Texture UAV | [index], GetDimensions; selected atomics |
| SamplerState | Sampler | Passed to texture Sample* |
| SamplerComparisonState | Comparison sampler | Passed to SampleCmp* |
| RaytracingAccelerationStructure | DXR scene | TraceRay requires DXR stage/context |

**Example—structured vs raw reads**

~~~hlsl
struct Particle { float3 position; float radius; };
StructuredBuffer<Particle> Particles : register(t0);
ByteAddressBuffer Raw : register(t1);

float radiusA(uint i) { return Particles[i].radius; }
float radiusB(uint i) { return asfloat(Raw.Load(i * 16u + 12u)); }
~~~

- **What:** StructuredBuffer handles element stride; ByteAddressBuffer requires explicit byte offsets.
- **Why:** Structured layouts are easy to maintain, while raw layouts support tightly controlled binary schemas and cross-language mappings.
- **Watch:** Raw offsets and typed/structured strides are not interchangeable; they must match the view and CPU allocation.

## 3. Constant buffer packing (a major source of bugs)

~~~hlsl
cbuffer Params : register(b0)
{
    float3 velocity;   // byte 0, 4, 8
    float deltaTime;   // byte 12 — fills the 16-byte register
    float2 viewSize;   // byte 16, 20
    float2 jitter;     // byte 24, 28
    float weights[3];  // byte 32, 48, 64 (not byte 32,36,40)
};
~~~

~~~text
16-byte register c0: [velocity.x][velocity.y][velocity.z][deltaTime]
16-byte register c1: [viewSize.x][viewSize.y][jitter.x ][jitter.y ]
16-byte register c2: [weights[0]][padding ][padding ][padding ]
16-byte register c3: [weights[1]][padding ][padding ][padding ]
16-byte register c4: [weights[2]][padding ][padding ][padding ]
~~~

- **What:** Scalars/vectors pack inside 16-byte registers unless they would cross a register boundary. Arrays typically start each element on a new 16-byte register.
- **Why:** A host struct of three consecutive floats for weights **does not match** the HLSL cbuffer weights[3] layout.
- **Host fix:** Use explicitly padded host structures, scalar/vector groups or reflection-generated layouts.
- **D3D12 CBV:** The GPU virtual-address offset for constant buffer views must obey 256-byte placement alignment; the data layout inside the buffer still follows HLSL packing rules.
- **Note:** StructuredBuffer layout is a different contract; do not apply cbuffer packing rules wholesale to structured data.

## 4. Root signatures and descriptor tables (Direct3D 12)

~~~hlsl
#define ROOT_SIG "CBV(b0), " \
                 "DescriptorTable(SRV(t0)), " \
                 "DescriptorTable(UAV(u0))"

[RootSignature(ROOT_SIG)]
[numthreads(64,1,1)]
void CSMain(uint3 id : SV_DispatchThreadID)
{
    // use resources declared elsewhere in the file
}
~~~

- **What:** A root signature maps shader register ranges to D3D12 root arguments/descriptor tables.
- **Why:** D3D12 requires an explicit binding layout so the driver can validate and optimize pipeline resource access.
- **Alternative:** Define/serialize the root signature in host code instead of embedding it in HLSL.
- **Constraint:** Every shader in a pipeline must be compatible with the bound root signature; descriptor table ranges must match register spaces and heap types. Samplers use a separate descriptor heap/table from CBV/SRV/UAV descriptors.

## 5. Register spaces and multiple material sets

~~~hlsl
cbuffer FrameData    : register(b0, space0) { float time; float3 pad0; };
Texture2D<float4> A : register(t0, space1);
Texture2D<float4> B : register(t0, space2);
SamplerState Samp   : register(s0, space0);
~~~

- **What:** A and B both use t0 but occupy different register spaces.
- **Why:** A renderer can reserve namespaces for frame, material and instance resources.
- **Reminder:** Space is a binding namespace, not a GPU memory address. D3D11 has a different binding model and no D3D12 root signature.

## 6. ConstantBuffer<T> and structured constants

~~~hlsl
struct CameraData
{
    float4 eye;
    float4 forward;
};

ConstantBuffer<CameraData> Camera : register(b0);

float3 EyePosition() { return Camera.eye.xyz; }
~~~

- **What:** This is a typed constant-buffer resource declaration.
- **Why:** Reusable named structs can describe common shader parameters.
- **Check:** CPU field offsets must still match HLSL cbuffer packing. Types such as bool have host representation pitfalls; use uint flags in shared binary schemas.

## 7. Read-only vs read-write buffers: a safe transform

~~~hlsl
StructuredBuffer<float4> Input : register(t0);
RWStructuredBuffer<float4> Output : register(u0);
cbuffer Parameters : register(b0) { uint n; float amplitude; float2 pad; };

[numthreads(128,1,1)]
void CSMain(uint3 tid : SV_DispatchThreadID)
{
    uint i = tid.x;
    if (i >= n) return;
    float4 v = Input[i];
    Output[i] = float4(v.xyz * amplitude, v.w);
}
~~~

- **What:** Input is SRV; Output is UAV.
- **Why:** A two-buffer pass gives an explicit snapshot-style dependency and a clear barrier point before later consumers.
- **Caveat:** Input and Output can alias only under carefully defined rules. Avoid simultaneous conflicting views/access of the same bytes.

## 8. Upload and readback lifecycle

~~~mermaid
flowchart TD
  U["CPU fills upload resource"] --> C["Copy to default-heap GPU resource"]
  C --> T["Transition to desired GPU usage"]
  T --> S["Bind + Dispatch / Draw"]
  S --> B["UAV barrier or transition as needed"]
  B --> K["Copy GPU result into readback resource"]
  K --> F["Signal and wait for GPU fence"]
  F --> M["CPU maps readback and verifies result"]
~~~

**Host pseudocode**

~~~cpp
// Pseudocode; SDK types, error checks and transitions omitted.
Upload(initialData);
Transition(stateBuffer, COPY_DEST, UNORDERED_ACCESS);
SetComputePipelineState(pso);
SetComputeRootSignature(rootSig);
SetDescriptors(...);
Dispatch((count + 127) / 128, 1, 1);
Transition(outputBuffer, UNORDERED_ACCESS, COPY_SOURCE);
CopyBufferRegion(readback, outputBuffer);
SubmitAndWaitForFence();
MapReadbackAndInspect();
~~~

- **What:** Upload/readback resource operations are performed on the host; shaders never call a CPU Map function.
- **Why:** Shader code has no direct authority to allocate GPU resources, change D3D12 resource states or wait on a CPU fence.
- **Production:** Track actual resource-state history; do not treat the pseudocode as fully compilable D3D12 C++.

## 9. D3D11 vs D3D12 vs DXC/FXC

| Area | D3D11 | D3D12 |
| --- | --- | --- |
| Binding | API binding slots via device context | Root signature + descriptor heaps/tables |
| Synchronization | Many hazards managed implicitly by runtime | Application explicitly handles barriers and queues |
| Pipeline creation | Stage objects/states | Pipeline State Objects |
| Shader compiler (typical) | FXC, DXBC (SM5) | DXC, DXIL (SM6) |
| Resource use | SRV/UAV/CBV | Same concepts plus explicit state and descriptor management |
| CPU overhead | More implicit runtime work | More explicit application control |

**Example—same shader register syntax, different host contract**

~~~hlsl
Texture2D<float4> Albedo : register(t0);
SamplerState Sampler : register(s0);
float4 PSMain(float2 uv:TEXCOORD0):SV_Target0
{
    return Albedo.Sample(Sampler, uv);
}
~~~

- **What:** The HLSL declaration is portable across many D3D11/D3D12 contexts.
- **Why:** The resource binding *implementation* is API-specific: SetShaderResources/SetSamplers vs descriptor heaps/root tables.

## 10. Compilers: reproducible DXC command line

~~~powershell
dxc -T cs_6_0 -E CSMain -Fo build/compute.dxil shaders/compute.hlsl
dxc -T cs_6_0 -E CSMain -Zi -Qembed_debug -Od -Fo build/compute.debug.dxil shaders/compute.hlsl
dxc -dumpbin build/compute.dxil
~~~

- **What:** First command compiles; second preserves embedded debug information and disables optimization for debugging; third dumps shader metadata/disassembly.
- **Why:** Capture exact compiler version, arguments and include hashes for reproducible builds.
- **Check:** Actual debug switches and behavior can vary with DXC release. Query dxc -help from your installed compiler.
- **Validation:** Compile errors are not the same as D3D12 PSO creation errors; inspect both compile diagnostics and runtime debug-layer diagnostics.

## 11. Host/shader interface tests

~~~hlsl
ByteAddressBuffer HostBytes : register(t0);
RWByteAddressBuffer Result : register(u0);

[numthreads(1,1,1)]
void VerifyABI()
{
    uint word = HostBytes.Load(0);
    Result.Store(0, word == 0x12345678u ? 1u : 0u);
}
~~~

- **What:** This reads an exact 32-bit known value and reports a pass/fail flag.
- **Why:** A one-thread ABI test isolates descriptor/view/offset mistakes before large physics dispatches.
- **Adversarial tests:** zero count, max count, non-multiple group sizes, missing/wrong descriptor type, buffer capacity mismatch, all-zero and non-finite input, repeated create/destroy, device loss and rollback behavior.

## 12. Sources

- [Resource binding in HLSL](https://learn.microsoft.com/en-us/windows/win32/direct3d12/resource-binding-in-hlsl)
- [D3D12 root signatures](https://learn.microsoft.com/en-us/windows/win32/direct3d12/root-signatures)
- [Specifying root signatures in HLSL](https://learn.microsoft.com/en-us/windows/win32/direct3d12/specifying-root-signatures-in-hlsl)
- [Constant buffer packing](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-packing-rules)
- [D3D12 resource barriers](https://learn.microsoft.com/en-us/windows/win32/direct3d12/using-resource-barriers-to-synchronize-resource-states-in-direct3d-12)
- [DXC compiler source and documentation](https://github.com/microsoft/DirectXShaderCompiler)

---

# 05 — HLSL API catalog: intrinsics, resource methods, semantics and attributes

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

---

# 06 — Advanced HLSL, portability, precision, validation and performance

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
cbuffer Config : register(b0) { uint count; uint3 pad; };
[numthreads(128,1,1)]
void CopyCoalesced(uint3 tid : SV_DispatchThreadID)
{
    if (tid.x >= count) return;
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

---

# 07 — Real-world HLSL case study: Sunder GPU physics

> This chapter explains real patterns observed in [Cryosimorgh/Sunder](https://github.com/Cryosimorgh/Sunder) on the **main** branch when this guide was prepared (2026-11-09). It is not a claim that every experimental Sunder feature is production-qualified. The other chapters teach HLSL generically.

## 1. Sunder pipeline: physics compute, validation and rendering

~~~mermaid
flowchart LR
  S["CPU/Zig+C host"] --> C["DXC → cs_6_0 DXIL"]
  C --> P["D3D12 physics compute passes"]
  P --> V["Validation and accepted-state publication"]
  V --> R["Vertex shader + pixel shader renderer"]
  R --> H["Window + debug statistics"]
  S --> P
~~~

**Selected real source paths** (from the repository):

| Path | Why examine it |
| --- | --- |
| [physics3.hlsl](https://github.com/Cryosimorgh/Sunder/blob/main/physics3.hlsl) | Native 3D sphere/plane physics compute passes |
| [physics-math.hlsl](https://github.com/Cryosimorgh/Sunder/blob/main/physics-math.hlsl) | Shared math helpers |
| [build_physics3.py](https://github.com/Cryosimorgh/Sunder/blob/main/build_physics3.py) | DXC shader compilation/build caching |
| [g7_render.hlsl](https://github.com/Cryosimorgh/Sunder/blob/main/g7_render.hlsl) | Vertex/pixel shaders for 3D sphere impostors |
| [render.hlsl](https://github.com/Cryosimorgh/Sunder/blob/main/render.hlsl) | 2D/planar rendering and diagnostics |
| [layout.hlsl](https://github.com/Cryosimorgh/Sunder/blob/main/layout.hlsl) | Generated memory addressing and cbuffer contract |
| [docs/ENGINE_ARCHITECTURE.md](https://github.com/Cryosimorgh/Sunder/blob/main/docs/ENGINE_ARCHITECTURE.md) | Architecture, gates and qualification status |

**Why this design:** Different compute passes handle different responsibilities, and the visual renderer reads accepted physics state. Rendering a plausible animation alone does not qualify physics correctness.

## 2. Sunder's actual raw-buffer declaration pattern

~~~hlsl
// Adapted from physics3.hlsl. Registers reflect Sunder's source.
ByteAddressBuffer source : register(t0);
RWByteAddressBuffer trial : register(u1);
RWByteAddressBuffer accepted : register(u0);

cbuffer Config : register(b0)
{
    uint n, buckets, contactCapacity, iterations;
    uint dtBits, gxBits, gyBits, gzBits;
    // More fields follow in the actual file.
};
~~~

- **What:** source is an SRV, trial and accepted are UAVs, Config is a CBV.
- **Why:** One simulation step can read an immutable source, write a trial result and keep a distinct accepted publication path.
- **Contract:** The host's descriptor bindings and cbuffer offsets must match the shader exactly. A register declaration does not allocate a buffer.

## 3. Sunder's structure-of-arrays field addressing

~~~hlsl
float ReadField(uint i, uint f)
{
    // 4 bytes per float field; fields are n elements apart.
    return asfloat(source.Load(4 * (f * n + i)));
}
~~~

~~~text
source raw bytes:
field 0 (x): [x0 x1 x2 ... xN-1]
field 1 (y): [y0 y1 y2 ... yN-1]
field 2 (z): [z0 z1 z2 ... zN-1]

address(body=i, field=f) = 4 * (f * n + i)
~~~

- **What:** f selects a field; i selects the body; Load consumes a byte offset; asfloat reinterprets 32-bit float bits.
- **Why:** Adjacent GPU lanes evaluating the same field access adjacent 4-byte words.
- **Failure mode:** Using capacity instead of n (or the reverse) in one pass changes every field offset after the first. Schemas and host tests are mandatory.

## 4. Double values stored as pairs of 32-bit words

~~~hlsl
double ReadDouble(RWByteAddressBuffer buffer, uint offset)
{
    uint2 pair = buffer.Load2(offset);
    return asdouble(pair.x, pair.y);
}

void WriteDouble(RWByteAddressBuffer buffer,
                 uint offset, double value)
{
    uint lo, hi;
    asuint(value, lo, hi);
    buffer.Store2(offset, uint2(lo, hi));
}
~~~

- **What:** 64-bit numbers are encoded/decoded through raw buffer words.
- **Why:** Sunder's 3D solver mixes field representations and uses double-precision computations in selected places.
- **Caveat:** Exact buffer location, spacing and interpretation are part of the ABI. Do not use two 32-bit float loads to approximate a double.

## 5. Sunder compute entry points

~~~hlsl
// Pattern adapted from the source, omitting physics details:
uint LinearID(uint3 groupID, uint lane)
{
    return (groupID.x + 65535u * groupID.y) * 256u + lane;
}

[numthreads(256,1,1)]
void ExamplePass(uint3 group : SV_GroupID,
                 uint lane : SV_GroupIndex)
{
    uint i = LinearID(group, lane);
    if (i >= n) return;
    // Work on body i.
}
~~~

- **What:** A flattened group index plus lane index addresses a body.
- **Why:** Sunder supports workload indexing beyond a single group axis using an explicit flattening convention.
- **Watch:** The constant 65535 is **part of Sunder's dispatch/indexing contract**, not an HLSL universal formula. A different dispatch geometry requires matching host and shader logic.
- **Safety:** The count guard is essential before state reads.

## 6. Atomic insertion into a spatial structure

~~~hlsl
RWByteAddressBuffer Grid : register(u2);

void Insert(uint bucket, uint bodyID, uint nextOffset)
{
    uint previous;
    Grid.InterlockedExchange(4u * bucket, bodyID, previous);
    Grid.Store(nextOffset, previous);
}
~~~

- **What:** Atomically swaps the bucket head and stores the previous head as the next link.
- **Why:** Multiple bodies can land in the same cell/hash bucket without losing a head update.
- **Important:** This is a conceptual extraction of Sunder's approach; ordering, bucket initialization, bounds and per-dispatch barriers must be inspected in the complete implementation.
- **Adversarial case:** Force many bodies into the same hash bucket; confirm that traversal terminates, does not duplicate/loss bodies and detects overflow.

## 7. Sunder's actual DXC build invocation

The repository's [build_physics3.py](https://github.com/Cryosimorgh/Sunder/blob/main/build_physics3.py) constructs commands equivalent to:

~~~powershell
dxc -T cs_6_0 -Gis -E p3_clear -Fo evidence/p10/build/p3_clear.dxil physics3.hlsl
dxc -T cs_6_0 -Gis -E p3_prepare -Fo evidence/p10/build/p3_prepare.dxil physics3.hlsl
dxc -T cs_6_0 -Gis -E p3_hash -Fo evidence/p10/build/p3_hash.dxil physics3.hlsl
~~~

- **What:** One source file holds multiple compute entry points; each is compiled separately for cs_6_0.
- **Why:** The host can dispatch distinct phases with distinct shader binaries.
- **Reproducibility:** The build script hashes source dependencies, commands and tools to reuse verified outputs safely.
- **Note:** The source also contains more pass entries; the list above is deliberately illustrative, not exhaustive.

## 8. Graphics: sphere impostors

~~~hlsl
struct VertexOut
{
    float4 position : SV_Position;
    float3 center : TEXCOORD0;
    float2 corner : TEXCOORD1;
    nointerpolation float radius : TEXCOORD2;
};

VertexOut SphereVS(uint vertex : SV_VertexID,
                   uint instance : SV_InstanceID)
{
    // Build a screen-facing quad around each sphere center.
    // Actual clip construction is in g7_render.hlsl.
}
~~~

- **What:** The vertex shader uses vertex and instance IDs to generate a quad for each body.
- **Why:** A pixel shader can ray-test the exact sphere silhouette and write analytic depth without storing a tessellated sphere mesh per body.
- **Limitation:** This excerpt is a layout sketch, not a compilable vertex shader; see linked source for the complete camera transform and return value.

## 9. Correctness model: accepted-state publication

~~~mermaid
flowchart TD
  A["Read source state"] --> B["Prepare trial"]
  B --> C["Generate possible contacts"]
  C --> D["Iterative solve"]
  D --> E{"All invariants valid?"}
  E -- "Yes" --> F["Publish accepted state"]
  E -- "No" --> G["Record error; do not publish invalid step"]
~~~

~~~hlsl
// Illustrative acceptance guard, not Sunder's full validator.
RWByteAddressBuffer ErrorFlags : register(u4);

void ReportFailure(uint code)
{
    ErrorFlags.InterlockedOr(0u, code);
}
~~~

- **What:** Error bits are accumulated atomically.
- **Why:** A shader may detect invalid input, contact-capacity exhaustion or numerical failure. The host and later passes must not conflate a failed trial with accepted state.
- **Qualification:** See [Sunder's architecture and gates](https://github.com/Cryosimorgh/Sunder/blob/main/docs/ENGINE_ARCHITECTURE.md) for what has actually been measured, accepted and excluded.

## 10. A minimal audit plan for a real engine

~~~text
HLSL source
  → compile with exact DXC target + defines
  → verify register and ABI layout against host
  → verify buffer size, zero and max population
  → test collisions, overflow, NaN, degeneracy
  → validate staged barriers and readback fences
  → compare against a CPU oracle
  → benchmark GPU time without readback/presentation conflation
  → record hashes, device, driver and exact command line
~~~

~~~powershell
# Existing Sunder development paths (Windows prerequisites apply):
python build_physics3.py
python dev_test.py affected --files physics3.hlsl
python dev_test.py full
~~~

- **What:** Build a targeted shader path, run affected tests, then use a fuller suite only when necessary.
- **Why:** A fast, reproducible targeted failure catches the most common shader bugs before expensive end-to-end validation.
- **Caveat:** Commands depend on Sunder's Windows SDK, Zig and runtime setup. This documentation has **not** run the native Windows GPU suite.

## Sources

- [Cryosimorgh/Sunder](https://github.com/Cryosimorgh/Sunder)
- [Sunder README](https://github.com/Cryosimorgh/Sunder/blob/main/README.md)
- [Sunder native 3D HLSL](https://github.com/Cryosimorgh/Sunder/blob/main/physics3.hlsl)
- [Sunder native 3D build](https://github.com/Cryosimorgh/Sunder/blob/main/build_physics3.py)
- [Sunder 3D rendering shaders](https://github.com/Cryosimorgh/Sunder/blob/main/g7_render.hlsl)
- [Sunder architecture and gate record](https://github.com/Cryosimorgh/Sunder/blob/main/docs/ENGINE_ARCHITECTURE.md)
