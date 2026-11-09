# HLSL Playground v1.2.0 — One-click startup and automatic shutdown

The interactive HLSL tutorial now has a **Windows one-click launcher** and an automatic session lifecycle. The portable Windows ZIP includes its required tools; users do not need to install Node.js, DXC, Naga or Rust globally.

## Run (Windows)

1. Download **HLSL-Playground-Windows-v1.2.0.zip** from this release.
2. Extract the **entire ZIP** into a writable folder.
3. Double-click **Start-HLSL-Playground.cmd**.
4. The launcher finds its bundled Node.js, DXC and Naga, starts the loopback-only local compiler service on an available port, and opens the tutorial in your default browser.
5. Edit HLSL and use **Run on GPU** for supported WebGPU compute shaders.
6. Click **Close playground & stop server** or close the tutorial tab. The service shuts down automatically when the **last** connected playground tab leaves.

**Cleanup guarantees:** Explicit Close and ordinary tab closure send a session-release request. A browser crash or missing unload event triggers heartbeat expiration after approximately 45 seconds. A server that never receives a tab exits after approximately 90 seconds. The launcher never terminates your whole browser or unrelated tabs. Browser security may prevent physically closing a tab opened from a launcher; in that case Close navigates to a blank page while terminating the app service.

## Under the hood

- Each page owns a unique server-side lease and sends heartbeats; multiple open tabs are tracked separately.
- The local Node service binds **127.0.0.1**, not a publicly accessible interface.
- The server runs DXC and Naga as child processes only when converting a user-submitted shader, with compiler time and output limits.
- All compiler children are terminated when the Node service shuts down.
- The local launcher is self-contained in the portable Windows ZIP; the source-only ZIP can still use preinstalled Node, DXC and Naga.

## Safety and limitations

- WebGPU executes WGSL **translated from HLSL** (via DXC SPIR-V and Naga); this is not native DXIL/D3D12 shader execution.
- Supported workloads are buffer-oriented compute kernels with explicit host bindings, not literally every HLSL program. Graphics and ray tracing need different runtime pipelines.
- Compiling untrusted shader code can stress the GPU and driver. Only execute source you trust.
- Compiler/runtime binaries are from their upstream projects. See THIRD_PARTY_NOTICES.md; they are not authored by this repository.
- Browser WebGPU support depends on your browser, OS, GPU and driver.
- The repo does not silently install system-wide software or make global PATH modifications.

## Validation

- Node integration tests cover session creation, multiple tabs, explicit closure, heartbeat timeout and the never-opened startup fallback.
- Browser JavaScript syntax checks, HTTP routing and local compiler mock-process tests are also included.
- The portable CI build verifies that the bundled DXC and Naga binaries can translate the sample HLSL to WGSL before publishing.
- Hardware WebGPU execution is still device-dependent and must be verified on the target system.

## Files added or changed

- Start-HLSL-Playground.cmd / Start-HLSL-Playground.ps1 — one-click launcher
- playground/server.mjs — browser session leases, auto-exit and child process shutdown
- playground/live-runner.js and playground/index.html — session heartbeats and Close button
- playground/test-lifecycle.mjs — close / crash / multi-tab tests
- .github/workflows/release-windows-playground.yml — bundled, portable Windows release

For support and source: https://github.com/Cryosimorgh/HLSL-Docs
