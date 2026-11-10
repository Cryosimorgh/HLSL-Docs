# HLSL Workbench v1.9.1 — Faster Runs and Usable Editor Help

This update addresses slow repeated shader compilation and animation preview overhead, while making IntelliSense and HLSL documentation usable without hunting for keyboard shortcuts.

## Performance changes

- The localhost PowerShell/.NET compiler caches up to four **successful DXC→Naga translations** by SHA-256 of HLSL source plus entry point. Repeated builds of unchanged code skip both compiler processes. Any edit invalidates that shader's cache key; nothing is stored on disk.
- The **GPU particles** preset replaces costly per-pixel trigonometric hashing, `exp` and `sqrt` operations with integer hashing and squared-radius gradients. Pixel motion and RGBA colors are still computed entirely in HLSL. The appearance may differ slightly from v1.9.0.
- The RGBA preview **reuses its image buffer and offscreen canvas** instead of allocating a new pixel array every rendered frame. This reduces CPU allocation pressure.
- The animation now reports **Compile**, **GPU + readback**, **Draw**, actual **FPS**, frames, and elapsed time. These identify the stage responsible for delays. The GPU figure is wall time including readback, *not* isolated GPU shader execution time.
- When GPU work takes longer than the target frame interval, the animation advances using the actual elapsed time (up to a one-second cap), rather than artificially slowing the time uniform.

**Limits:** The browser still reads a float4 framebuffer back from the GPU to JavaScript on each frame. Some systems may remain slow because readback and canvas conversion have real costs. The GPU driver controls pipeline compilation; no hardware-independent FPS guarantee is possible.

## Code completion and documentation

- **Automatic completions** begin as soon as a valid identifier character is typed (and on known vector dot members). The automatic list is bounded; Ctrl+Space still opens suggestions explicitly.
- **Shortcuts are shown directly below the HLSL editor:** Ctrl+Space complete, Ctrl+Shift+Space parameter help, F1 explain, right-click a recognized symbol to pin its reference, Esc to dismiss, Ctrl+Alt+[ / ] fold/unfold, Ctrl+Enter compile.
- HLSL documentation no longer vanishes immediately when moving from a highlighted token to the popup. The popup has a grace period, allows text selection and clicking its separate HLSL examples/docs link, and stays open while hovered.
- **Right-click on a documented HLSL symbol** opens a **pinned** reference and suppresses the normal browser context menu for that symbol. Right-click inside the reference keeps it pinned. Click the × button, press Esc, or click away to close. Ordinary right-clicks on unrecognized code retain the browser menu.

## Complete Windows download

Download **HLSL-Playground-Windows-v1.9.1.zip**, extract it into a **clean folder**, and double-click `Start-HLSL-Playground.cmd`. All editor files, DXC, Naga, examples and PowerShell/.NET backend are included; no Node, Rust or Zig installation required.

## Verification

- Real Chromium regression tests check folding, auto completion, HLSL function help, right-click pinning, browser-menu suppression, text-selectable documentation and full source synchronization.
- Windows CI compiles the HLSL examples with real DXC/Naga, checks cache hits and invalidation on changed shader source, and validates the tab-based localhost server lifecycle.
- The complete Windows ZIP is checked by the release pipeline. Device-specific GPU/driver performance requires local observation using the new latency counters.

[Repository](https://github.com/Cryosimorgh/HLSL-Docs)
