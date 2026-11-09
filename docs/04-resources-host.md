# 04 — Resource objects, binding, D3D12 root signatures and host integration

[← Compute](03-compute-memory.md) · [Handbook](../README.md) · [Next: API catalog →](05-api-catalog.md)

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

[← Compute](03-compute-memory.md) · [Next: API catalog →](05-api-catalog.md)
