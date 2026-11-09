# HLSL Playground v1.5.1 — One-click client and working checkout bootstrap

This maintenance release provides a complete and tested Windows client with the corrected setup guide and no custom Zig server executable. It supersedes v1.5.0 for new installations.

## Run it

1. Download **HLSL-Playground-Windows-v1.5.1.zip** and extract the whole ZIP to a new folder.
2. Double-click **Start-HLSL-Playground.cmd**.
3. The included PowerShell/.NET localhost host opens the browser editor automatically.
4. Click **Array example**, edit its HLSL code and press **Compile & Run HLSL**.
5. Read the output numbers or compiler error. The host exits automatically when the last playground tab closes.

**No need to install Rust, Node.js, Zig or compiler tools.** Microsoft DXC and a precompiled Naga executable are included. Only these upstream compiler binaries (and their required DLLs) are shipped; **no hlsl-server.exe** is present.

## Source checkout users

If you use `C:\a\HLSL-Docs` or another cloned repository, `git pull` and run `Start-HLSL-Playground.cmd`. The launcher downloads the compiler-only v1.5.0 archive into a per-user cache on the first run, verifies its published SHA-256 and reuses the tools afterward. It never downloads or runs the previously quarantined custom Zig server executable.

## Pipeline

HLSL text → Microsoft DXC (Shader Model 6, SPIR-V) → prebuilt Naga (WGSL) → browser WebGPU dispatch → GPU output readback. The current host is for buffer-oriented **compute shaders**, not arbitrary HLSL graphics/ray tracing programs.

The separate **Run WGSL on GPU** browser-only exercise and JavaScript particle simulator remain available without a local compiler server.

## Validation

- Windows PowerShell 5.1 server handles HTTP requests, Host/Origin checks and tab leases, then terminates cleanly.
- CI compiles the included particle HLSL shader through the actual localhost compiler API using real DXC and Naga.
- CI runs the assembled one-click launcher from the ZIP, recompiles HLSL, and checks process exit after session closure.
- CI independently tested a clean checkout without compilers, confirming SHA-256-pinned compiler bootstrap and successful HLSL compilation.
- Browser WebGPU execution still depends on compatible graphics hardware and driver support; the test runner cannot qualify every user device.

### Background about the earlier binary

A custom Zig `hlsl-server.exe` in a previous release was quarantined by Defender and crashed. v1.5.1 uses a different auditable PowerShell/.NET localhost host, and never executes the old custom binary. This is not an instruction to disable security software or restore older executables.

[Repository](https://github.com/Cryosimorgh/HLSL-Docs) · [Full client instructions](playground/README.md)
