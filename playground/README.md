# Interactive HLSL Compute Playground

**[Download the Windows v1.5.0 client](https://github.com/Cryosimorgh/HLSL-Docs/releases/download/v1.5.0/HLSL-Playground-Windows-v1.5.0.zip)** · [Handbook](../README.md) · [Compute shader source](particle-step.hlsl)

## Run real HLSL on Windows

1. Extract the **entire** Windows v1.5.0 ZIP into a new folder.
2. Double-click **Start-HLSL-Playground.cmd** at the root of that folder.
3. The launcher starts a loopback-only **PowerShell/.NET** compiler bridge and opens your browser to `http://127.0.0.1:<port>/`. Use this new browser tab, not a `file://` tab.
4. In the HLSL editor, click **Array example**. Try changing `Input[tid.x] * 2.0` to `Input[tid.x] * 3.0`.
5. Click **Compile & Run HLSL**. The panel shows the output array and any compilation diagnostics. Enable **Show generated WGSL** to inspect the translated shader.
6. Close the tab or click **Close playground & stop server**. The local host exits when the last connected playground tab closes. If the browser crashes, a heartbeat timeout closes it automatically.

**No installation required** of Zig, Rust, Cargo or Node. The ZIP includes Microsoft DXC and a prebuilt Naga shader translator, while the host uses the Windows PowerShell and .NET runtime. Neither the package nor the launcher runs the previously flagged `hlsl-server.exe` Zig binary.

**From a source checkout:** update your clone (`git pull`) and double-click the CMD launcher. If the compiler tools are missing, the launcher downloads the **compiler-only** v1.5.0 ZIP, verifies its pinned SHA-256 and caches it in your per-user application-data directory. It does not download a custom server EXE.

## What happens when you click Run

~~~text
Editable HLSL (CSMain)
        ↓ POST /api/compile to localhost PowerShell/.NET
DXC HLSL / Shader Model 6.0
        ↓ SPIR-V
Precompiled Naga translator
        ↓ WGSL
Browser WebGPU (GPU compute dispatch)
        ↓
GPU output readback → Result panel
~~~

This is **real execution of WGSL translated from HLSL** on the GPU, not native Direct3D DXIL execution. A WebGPU-capable browser and GPU/driver are needed.

## Edit buffer bindings

The HLSL editor has a **Buffer bindings and dispatch** JSON panel. HLSL register spaces are shifted by DXC so they don't collide in the generated WGSL:

| HLSL register | WebGPU binding | Example |
| --- | --- | --- |
| t0 | 0 | `StructuredBuffer<float> Input` |
| u0 | 16 | `RWStructuredBuffer<float> Output` |
| b0 | 32 | `cbuffer Params` |
| s0 | 48 | Sampler, if the host actually supplies one (current host only provides buffers) |

Supported fields include `entry` (e.g. `CSMain`), `dispatch` (`"auto"` or `[x,y,z]`), and a `resources` array with `binding`, `access` (`read`, `read_write`, `uniform`), `data` (numeric inputs), `byteLength` (zeroed output buffer), `preset` (`particles` or `parameters`), `inspect`, `display`, and optional `applyToCanvas`.

The starter particle shader uses 16-byte `Ball` records and a 32-byte HLSL cbuffer. The separate JavaScript particle visualization shows analogous update math and workgroup occupancy. It's not a GPU benchmark or a native D3D12 physics runtime.

## Browser-only alternative

Opening `playground/index.html` directly without the launcher provides the JavaScript particle simulation, source editor, and **WGSL-only GPU lab**. You can edit WGSL and click **Run WGSL on GPU** to execute a simple float-array compute shader without a local process. That panel runs WGSL directly, **not HLSL**.

## Limits and diagnostics

- The local host accepts only loopback connections with the correct Host/Origin, has a static-file allowlist and limits source/body size, compiler output size and subprocess duration.
- The page can run compatible **compute shaders with explicit buffer bindings**, not every HLSL script. Vertex/pixel stages, ray tracing, arbitrary textures/samplers, shader includes and unsupported DXC/Naga conversions aren't automatically supported.
- If compilation fails, read the DXC/Naga error in the output panel. If shader compilation works but execution fails, inspect generated WGSL and the WebGPU device/feature error.
- On Windows, the launcher logs are written to `%TEMP%\hlsl-playground-run-<id>\server.stderr.log` and `server.stdout.log`.
- No antivirus bypass or Defender exclusion is required. The new host does **not** execute the older custom Zig binary.
- Run only shader code you trust. GPU shader execution can still trigger driver/device errors.

## Developer tests

The repository's Windows CI runs `node playground/test-powershell.mjs` **only as a test client**, including real DXC/Naga compilation through the PowerShell HTTP API. Users do not need Node.

[See source](server.ps1) · [Release notes](../RELEASE_NOTES_v1.5.0.md)
