# HLSL Playground v1.3.1 — Zig backend maintenance release

Includes the Zig backend migration and the current source-tree cleanup.

**No Rust, Cargo, Node.js, or Zig SDK is required for the Windows portable ZIP.** The release bundles a compiled Zig HTTP/compile service, DXC and a precompiled Naga binary. Naga is implemented upstream in Rust, but only its binary is used.

### Start and stop

1. Extract HLSL-Playground-Windows-v1.3.1.zip.
2. Double-click Start-HLSL-Playground.cmd.
3. Edit supported HLSL compute shaders and press Run on GPU.
4. Press Close playground & stop server, or close the last browser tab.

Tab leases, origin checks and heartbeat timeouts are handled by Zig. All sessions closed normally stop the service within seconds; browser crashes are cleaned up by heartbeat expiration.

### What's verified

- Zig 0.13 backend builds on Linux and Windows and passes its HTTP/session tests.
- Windows release checks the bundled launcher, source → DXC SPIR-V → Naga WGSL **through the Zig HTTP endpoint**, then verifies shutdown.
- The obsolete Node backend and Rust-installing workflows have been removed from main. Historical release assets remain available on their versioned tags.
- Native WebGPU execution is device/browser-dependent. This is a buffer-backed compute playground, not a native DXIL/Direct3D runtime.

Read playground/README.md for source builds and supported input layouts.
