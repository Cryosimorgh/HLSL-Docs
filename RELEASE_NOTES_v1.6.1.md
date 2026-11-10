# HLSL Workbench v1.6.1 — Tighter Preview, Syntax Coloring and Clear Empty State

This release includes the **complete portable Windows client** with all required files and the DXC/Naga compiler binaries. It is not a patch-only download.

## UI improvements

- **Denser GPU output:** Reduced nested container padding, expanded the preview canvas and removed oversized internal plot margins. The visualizer retains correct world-space aspect ratios for circles and non-square domains.
- **HLSL syntax coloring:** A lightweight built-in highlighter colors keywords, user variables, resource types, HLSL types/vectors/matrices, functions, built-in operations, numeric literals, comments, string literals, register/semantic annotations, member access and preprocessor directives.
- **Editing stays native:** Syntax is drawn in a noninteractive layer behind the existing textarea. Caret, selection, undo/redo, copy/paste, keyboard shortcuts, IME and source compilation continue using the unchanged editable HLSL text.
- **Preset-aware highlighting:** Switching among Circle mask, Array transform and Particles, and updating the example source from the simulation, refreshes the coloring immediately.
- **Meaningful empty output:** Removed the misleading plus-sign illustration. The new neutral plot icon and **Run to preview output** text describe what happens next.
- **Disclosure indicators:** Resource bindings, diagnostics, WGSL output and optional labs now use right/down chevrons instead of plus/minus symbols.

## Run the complete client

1. Download **HLSL-Playground-Windows-v1.6.1.zip**.
2. Extract into a new folder (do not mix it with older installs).
3. Double-click **Start-HLSL-Playground.cmd**. The launcher starts the PowerShell/.NET localhost compiler and opens your browser.
4. The Circle mask example is loaded. Click **Compile & Run HLSL** or use **Ctrl+Enter**.
5. View the full GPU readback visualization alongside highlighted HLSL code. To inspect details, expand **Resource bindings & dispatch** or **Raw buffer & diagnostics**.

No Rust, Node.js or Zig installation is needed for this Windows client. It contains Microsoft DXC and a prebuilt Naga shader converter, and does not bundle the previously quarantined custom Zig server.

## Validation

- CI checks HLSL token categories, safe HTML escaping of user-written shader code, scroll alignment, editable-source refresh, workbench DOM structure, and GPU preview math.
- Windows CI checks static asset serving, the actual DXC → SPIR-V → Naga WGSL compiler pipeline, packaged launcher startup and session shutdown.
- Rendering still depends on the user's WebGPU-capable browser and graphics driver; CI is not a substitute for device-specific visual testing.

Repository: https://github.com/Cryosimorgh/HLSL-Docs
