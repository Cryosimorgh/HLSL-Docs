# HLSL Playground v1.5.0 — Working PowerShell/.NET Client

The previous Windows Zig server is **not used**. This version uses an auditable Windows PowerShell/.NET TCP host to compile HLSL with DXC and Naga and dispatch compatible compute code with browser WebGPU.

## Windows one-click installation

1. Download and extract **HLSL-Playground-Windows-v1.5.0.zip** in a fresh folder.
2. Double-click **Start-HLSL-Playground.cmd**. This starts the local PowerShell HTTP service using Windows' built-in .NET runtime and opens the browser.
3. Click **Array example**, edit the shader (e.g. multiply by 3 instead of 2), then click **Compile & Run HLSL**.
4. The local compiler returns WGSL, the browser executes it on WebGPU and shows the output buffer. The starter particle kernel can also update the visualization.
5. Close the tab or press **Close playground & stop server**. The local host exits automatically after its last tab disconnects.

## Included

- PowerShell 5.1-compatible compiler host (`playground/server.ps1`): loopback-only, source/input limits, origin/host checks, session leases, compiler child process timeout, graceful exit.
- Windows launcher: `Start-HLSL-Playground.cmd` and `Start-HLSL-Playground.ps1`.
- Microsoft DXC executable and required DLLs from upstream v1.9.2609.
- Prebuilt Naga CLI from the project's earlier compiler-toolchain bundle. No Rust/Cargo/Node/Zig installation on the user's machine.
- Editable HLSL buffer-oriented compute tutorial, independent WGSL browser GPU lab, particle simulation, handbook and reference files.

**No custom Zig hlsl-server.exe is included in the archive.** An older Zig executable was detected by Defender and crashed on the user's device; do not restore or run that older executable.

## Limitations

This is **not a general HLSL or Direct3D runtime**: it supports compute shaders that convert through DXC SPIR-V and Naga WGSL with explicit buffer bindings and a WebGPU-capable browser. Graphics, ray tracing, resources not described in the binding JSON, and unsupported intrinsics require different host-side support.

Using the HLSL editor from a raw file URL shows source only: real HLSL compilation requires the localhost host launched via the CMD file. The browser-only WGSL lab and JavaScript particle simulator can run without the host.

## Validation

- Windows CI passes HTTP route, Host/Origin, HLSL source validation, multi-tab session and clean server-exit tests.
- Windows CI compiled the actual particle-step.hlsl through **the PowerShell HTTP API**, verifying the returned WGSL contains an @compute entry.
- Windows release packaging tests the assembled launcher and HTTP compiler again before publishing.
- GPU execution is dependent on the user's browser, GPU and driver. No claim that all hardware/driver combinations were tested.
- The existing Defender finding for the **older Zig executable** has not been adjudicated. This client avoids executing or shipping that binary rather than disabling security controls.

[Source repository](https://github.com/Cryosimorgh/HLSL-Docs) · [Documentation](playground/README.md) · [Original Zig binary investigation](https://github.com/Cryosimorgh/HLSL-Docs/issues/1)
