# 02 — Graphics pipeline, texture sampling and pixel output

[← Fundamentals](01-fundamentals.md) · [Handbook](../README.md) · [Next: compute →](03-compute-memory.md)

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

[← Fundamentals](01-fundamentals.md) · [Next: compute →](03-compute-memory.md)
