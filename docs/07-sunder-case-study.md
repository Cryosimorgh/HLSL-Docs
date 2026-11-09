# 07 — Real-world HLSL case study: Sunder GPU physics

[← Advanced](06-advanced.md) · [Handbook](../README.md)

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

[← Advanced](06-advanced.md) · [Handbook](../README.md)
