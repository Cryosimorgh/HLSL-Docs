# Shader review, error diagnosis and adversarial matrix

Use this for reviews, performance regressions, broken rendering or unsafe GPU physics.

## 1. Minimal inspection

1. Search names, not entire repositories: rg --files -g '*.hlsl' -g '*.hlsli'; rg -n 'entry|register\(|numthreads|Dispatch|RootSignature' relevant/directories.
2. Read targeted shader entry point, relevant includes/generated layout **only**, and the host path that binds its descriptors and dispatch/draws.
3. Check compiler executable/version, exact -T/-E/-D/-I/-HV/-enable-16bit-types settings and hash the transitive includes.
4. Find a targeted test and run it **before** edits when practical. Record baseline diagnostics.

## 2. Cross-check matrix

| Layer | Required evidence | Typical failure |
|---|---|---|
| Compilation | DXC/FXC profile, entry and diagnostics | Wrong stage, unsupported intrinsic |
| Features | D3D12 CheckFeatureSupport and tiers | DXIL compiles but device rejects |
| Registers | Shader b/t/u/s ↔ host CBV/SRV/UAV/Sampler bindings | Black output, invalid reads |
| Constant ABI | 16-byte cbuffer field packing, 256-byte CBV placement | Wrong parameters |
| Data ABI | Structured stride / ByteAddress offset | Corrupt positions |
| Dispatch | ceil(count/groupSize), in-shader bounds guard | Last-group overflow |
| Barriers | Within-group convergence vs host resource/UAV barrier | Race / stale state |
| Resources | State transitions, heap/view format, lifetime and fences | Validation error or deadlock |
| Math | Finite inputs, tolerance, degenerate cases and units | NaNs, drift, unstable solver |
| Performance | GPU timestamps vs CPU submit/readback/UI | Misreported speedups |

## 3. Dangerous patterns

**Data-dependent return before a barrier:**

~~~hlsl
// WRONG if only some lanes return:
if (lane >= count) return;
GroupMemoryBarrierWithGroupSync();
~~~

Use a mask and have all group lanes reach the same barrier, then do guarded work.

**Cross-group dependency in one dispatch:**

~~~hlsl
// WRONG: a group barrier cannot wait for other groups.
if (groupID.x == 0) Publish();
GroupMemoryBarrierWithGroupSync();
if (groupID.x > 0) ReadPublished();
~~~

Split phases into dispatches and order with host barriers, or redesign algorithm.

**Improper raw buffer addressing:**

~~~hlsl
ByteAddressBuffer Data : register(t0);
uint raw = Data.Load(index); // WRONG if index means a 32-bit element
uint good = Data.Load(4 * index);
~~~

**Incorrect buffer-size assumption:** Shader count must be <= allocated capacity, and every computed byte offset must fit the view. A bounds guard for the logical count does not verify every descriptor is large enough.

**Non-deterministic floating-point aggregation:** Unordered atomics/reductions reorder sums; verify tolerances and replay claims.

## 4. Runtime validation progression

- Compile shader with same flags as application.
- Validate root signature and PSO creation with D3D12 debug layer.
- Run n=0, n=1, n=groupSize-1, groupSize, groupSize+1, maximum n.
- Include NaN/Inf, zero normals, extreme positions, hash collisions and overflowing contact/append capacity.
- Validate GPU results using CPU oracle and permitted tolerances.
- Verify no partial state publication after failure. Check rollback, generation/epoch, error counters and accepted-state readback.
- Capture GPU times separately from CPU enqueue/sync/presentation costs.
- Check device removal/recreation and live object leaks when resource lifetime changes.

## 5. Report template

~~~text
Target: D3D12 / cs_6_0 / DXC <version>
Changed: <path:lines>
Problem: <one-line cause and effect>
Validated: <exact compile command> — PASS/FAIL
GPU runtime: <device, test> — PASS/FAIL/NOT RUN
Edge cases: <counts and failure injection>
Performance: <GPU timestamp before/after or NOT MEASURED>
Remaining: <risks and environment constraints>
~~~

## 6. Teaching mode

When a user wants to *learn*, prefer the offline interactive playground at https://github.com/Cryosimorgh/HLSL-Docs/tree/main/playground . It uses JavaScript to visualize analogous simulation math; it does NOT execute an HLSL shader. Point to the separate DXC-compilable source for actual HLSL syntax. Explain how the sliders map to cbuffer values, how group size affects dispatch count, and why source/destination buffers avoid races.
