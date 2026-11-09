HLSL Playground — Windows portable launcher

1. Extract the ENTIRE Windows portable ZIP, OR clone the repository.
   A source checkout auto-downloads the checked, SHA256-pinned portable
   toolchain to your per-user app data cache on first launch.
2. Double-click Start-HLSL-Playground.cmd.
3. The launcher starts a Zig server and opens the tutorial in your default browser.
   Zig hlsl-server.exe, DXC and prebuilt Naga are INCLUDED in this portable package.
   No Rust/Cargo/Node/Zig installation or global PATH changes are needed.
4. Edit HLSL and use Run on GPU for supported WebGPU compute shaders.
5. Click "Close playground & stop server" or close the browser tab.
   The Zig compiler service exits automatically when the LAST active tab
   closes. If the browser crashes, the service exits after a heartbeat
   timeout (usually within about 45 seconds). An unopened session shuts
   down after 90 seconds. Other browser tabs are never force-closed.

The browser itself cannot start or kill processes. The launcher owns a
loopback-only local Zig service. When you press Close, the page may go blank
instead of physically closing the tab, depending on browser security rules.

If the launch fails:
- See .playground-runtime/<run>/server.stderr.log and server.stdout.log.
- Confirm WebGPU is enabled in Chrome/Edge and the GPU is compatible.
- Run the launcher from an extracted folder, not inside the ZIP.
- An antivirus/Windows SmartScreen prompt may appear because the launcher
  and bundled open-source binaries are not code-signed.

This WebGPU path converts HLSL -> SPIR-V -> WGSL. It does not run native D3D12
DXIL, and is limited to supported compute shaders / declared buffers.
Read playground/README.md for supported APIs, custom buffer JSON and limits.

Bundled third-party licenses/notices: THIRD_PARTY_NOTICES.md.
Repository: https://github.com/Cryosimorgh/HLSL-Docs
