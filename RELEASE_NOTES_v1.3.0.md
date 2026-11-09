# HLSL Playground v1.3.0 — Zig backend, zero Rust/Node installation

The local compiler server is now implemented in **Zig 0.13.0**, replacing Node.js. The Windows portable ZIP bundles a compiled Zig server, Microsoft DXC, and precompiled Naga. You do not need to install Rust, Cargo, Node.js, or the Zig compiler.

## Quick start

1. Download **HLSL-Playground-Windows-v1.3.0.zip** from this release and extract it completely.
2. Double-click **Start-HLSL-Playground.cmd**.
3. The launcher starts the Zig backend on 127.0.0.1 and opens the tutorial in your browser.
4. Edit a supported HLSL compute shader and click **Run on GPU**.
5. Click **Close playground & stop server** or close the last tutorial tab. The server exits automatically. If the tab disappears without a close event, the heartbeat fallback shuts the service down, normally within approximately 45 seconds.

## Backend and shader execution

- **HTTP and lifecycle:** Zig executable, loopback only, same-origin/Host checks, bounded requests, safe static allowlist, per-tab leases and idle exit.
- **Shader compiler:** Microsoft DXC converts HLSL to SPIR-V.
- **Shader translator:** Naga converts SPIR-V to WGSL using a **prebuilt executable**.
- **Execution:** Browser WebGPU executes WGSL and reads back output buffers.
- **Bundled dependencies:** hlsl-server.exe, dxc.exe, dxcompiler.dll and naga.exe.

Naga's source is Rust, but the package **only runs an already-compiled binary**. The packaging workflow reuses the Naga executable from this project's previous Windows release. It does not call Cargo or install Rust.

## Verification and limitations

The Zig backend is compiled and tested on Windows and Linux. The release workflow checks actual DXC→Naga conversion and the bundled Windows launcher/session auto-shutdown. WebGPU execution still depends on the browser, driver and GPU.

This is a buffer-oriented **compute** playground, not an arbitrary D3D12 graphics, mesh, ray tracing or native DXIL execution environment. Only run shader code you trust.

Source and documentation: https://github.com/Cryosimorgh/HLSL-Docs
