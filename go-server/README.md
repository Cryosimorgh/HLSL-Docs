# Sunder Go-hosted HLSL Workbench

The Go server is a persistent, loopback-only host for the existing HLSL IDE. It uses local Microsoft DXC and Naga executables for the actual HLSL → SPIR-V → WGSL compilation; the browser executes the translated compute shaders with WebGPU. Closing the tab does not stop the server.

## Windows source build

1. Install Go 1.22+ for Windows x64.
2. In the repository root, run `node playground/install-editor-vendor.mjs` if CodeMirror vendor assets are missing (Node is only for source setup, not running the packaged app).
3. Put DXC and Naga in `tools/dxc/dxc.exe`, `tools/dxc/dxcompiler.dll`, `tools/dxc/dxil.dll`, and `tools/naga/naga.exe`. The portable Windows release contains these compiler binaries.
4. Run `BUILD-WINDOWS.cmd` in the repo root. It restores the embedded icon resource if necessary and builds `HLSLWorkbench.exe`.
5. Run `Start-HLSL-Workbench.cmd` (or double-click the executable). Use `Stop-HLSL-Workbench.cmd` to stop the service.

`Install-File-Association.cmd` registers an **Open with** entry for `.hlsl` and `.hlsli`. Windows still requires the user to set it as the default application. File opens are restricted to explicit local desktop requests and use opaque document IDs. The editor can save opened on-disk files with baseline checks; browser-imported files use Save As.

The browser UI lives in `playground/index.html`, with theme overrides in `playground/sunder-ide.css` and the toolbar shell in `playground/sunder-ide.js`. Everything remains functional without an internet service or a separate language server. The server port defaults to `38457` and is shown in the interface header. GPU execution depends on browser/driver support.

### Tests

```powershell
cd go-server
go test -race ./...
node ../playground/test-editor-vendor.mjs  # only if present
```

The Go tests cover API boundaries and file save conflicts; browser tests are required to qualify editor interaction and a Windows GPU to qualify native performance.
