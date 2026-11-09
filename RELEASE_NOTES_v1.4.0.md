# HLSL Handbook Playground v1.4.0 — Browser-only GPU lab

## Security-first release

Earlier Windows portable packages contained a Zig executable that Microsoft Defender quarantined as `Trojan:Win32/Sabsik.TE.A!ml` (severe), and the user reported an `0xC0000005` crash. **Do not restore or run those previous native executables.** See [security issue #1](https://github.com/Cryosimorgh/HLSL-Docs/issues/1).

This release deliberately contains **no Windows executables, DLLs, PowerShell launchers, Rust/Cargo, Node runtime, DXC, Naga, installation commands or local HTTP server**. It is a separate, static browser tutorial.

## How to use

1. Download **HLSL-Playground-Browser-v1.4.0.zip** and extract it.
2. Open `playground/index.html` using a browser that supports WebGPU (such as recent Chrome or Edge with GPU acceleration).
3. Use the **real GPU lab (WGSL · WebGPU)**: edit the multiplier in the WGSL code, change the input float array, then click **Run WGSL on GPU**. The browser will compile WGSL and dispatch GPU compute, then show the resulting numbers.
4. Explore the separate JavaScript particle simulation and read/edit the HLSL sample code.

**Important distinction:** WGSL is WebGPU Shading Language, not HLSL. This mode does **not** compile HLSL to WGSL or run arbitrary HLSL programs. The HLSL editor remains available for learning and saving code; its native Run function is disabled while the security investigation is open.

If your browser lacks WebGPU in the file URL context, the JavaScript simulator still works. Try an up-to-date WebGPU-capable browser/secure context without running untrusted native files.

## Source fix implemented but not shipped as a binary

The Zig backend source no longer calls `std.process.exit(0)` from a detached monitor thread while separate HTTP handler threads may exist. It now runs request handling on the main thread and wakes the listener for orderly exit. Windows/Linux CI validated 40 parallel-client requests and normal zero-code shutdown.

This fixes a plausible dangerous lifetime pattern but **does not prove** that it caused the previous access violation. It has not cleared Microsoft's malware classification; a reviewed native executable will require independent security analysis.

## Verification and distribution

- Browser JavaScript syntax and DOM/control contract are checked by CI.
- Zig backend source build and HTTP/clean-exit regression tests passed on Windows and Linux, but **no native backend binary is shipped**.
- The ZIP packaging CI rejects executable, DLL, batch, and PowerShell files.
- GPU execution in browser depends on the device, OS and browser; it has not been verified on the user's computer.

Repository: https://github.com/Cryosimorgh/HLSL-Docs
