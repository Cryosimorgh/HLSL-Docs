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

## v2.1.0: incremental auto-download and GPU throughput

The **Updates** control in the Sunder toolbar checks the official GitHub Releases
manifest after startup. By default it automatically downloads only the **files
whose SHA-256 differs** from the installed application. It does not install them
until **Restart and install update** is clicked and confirmed. The Go server
stages and verifies every downloaded asset before a separate helper replaces
managed files and restarts the application. Shader files opened from disk or
saved outside this installation are not update targets. An initial installation
still requires the full ZIP. The release workflow publishes individual assets
and `sunder-update-manifest.json` alongside the full Windows ZIP.

The framebuffer now supports user-entered dimensions from 1 to 2048 per axis
(subject to a 64 MiB float4 output limit, approximately 128 MiB of output plus
staging, and the actual WebGPU adapter's limits). **Apply** changes the shader's
WIDTH/HEIGHT source defines, so it requires a new compile. Increasing the
resolution increases fragment workloads and the total readback size.

**FPS = Max** removes the previous 30/60 FPS scheduling target. The browser can
submit the next frame as soon as the previous GPU completion arrives, but this
is not a guarantee of a particular FPS. Full-color framebuffer shaders now
prefer a direct WebGPU preview drawn from the actual GPU storage buffer, with
periodic readbacks for statistics. If unsupported, the previous readback/2D
canvas renderer is still used. 'Frame wall' and 'Scheduling wait' counters help
distinguish rendering, GPU work and frame scheduling.

**Compiler mode:** Fast edit uses DXC `-O1`, optimized mode uses `-O3`.
Successful WGSL results are SHA-256 cached both in browser memory and under the
per-user Sunder cache directory, keyed by HLSL source, entry point,
optimization mode and local compiler binary metadata. Modified shader sources
are recompiled. Native Windows DXC/Naga and GPU throughput should still be
benchmarked on the target machine; no universal FPS or cold compile speed is
claimed.
