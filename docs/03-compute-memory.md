# 03 — Compute shaders, thread indexing, GPU memory and synchronization

[← Graphics](02-graphics-textures.md) · [Handbook](../README.md) · [Next: resources + host →](04-resources-host.md)

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

[← Graphics](02-graphics-textures.md) · [Next: resources + host →](04-resources-host.md)
