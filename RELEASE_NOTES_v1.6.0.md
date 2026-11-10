# HLSL Workbench v1.6.0 — Interface Redesign

The v1.5.x interface was a long tutorial page with narrow columns, competing panels, undersized code/output text, noisy diagnostic prose and a stretched circle preview. This release replaces it with a focused **compute shader workbench**.

## What's different

- **Editor and output together:** a responsive two-pane workbench. On narrow screens, the result moves below the code.
- **Actual output first:** the GPU readback plot is the main result. Raw buffer dumps and generated WGSL are expandable inspectors instead of large always-visible panes.
- **Correct geometry:** plotting preserves world-space aspect ratio; a circle on a 1×1 domain is circular, not stretched into an ellipse.
- **Useful numbers without clutter:** samples, mask coverage, range and mean are shown in a compact row. All-zero masks still produce an explanation.
- **Subdued visual design:** neutral dark surfaces, restrained warm accent, readable code typography, consistent spacing and fewer nested boxes.
- **Circle mask ready on launch:** the 32×32 circle shader preset loads by default. The example samples the unit square (x/y from 0 to 1), so the circle is round and easy to verify.
- **Controls where they belong:** preset switcher (Circle / Array / Particles), Copy/Save, Compile & Run and Ctrl+Enter shortcut live beside the editor. Resource binding JSON remains available as an expandable advanced section.
- **Optional labs moved aside:** the JavaScript particle sandbox, independent WGSL-only exercise and dispatch notes are collapsed under **Other labs**.
- **Fixed inspector collision:** the independent WGSL lab and the HLSL-generated WGSL panel no longer share an HTML element ID.
- **Errors are still accessible:** failed compile/dispatch automatically expands the raw diagnostic panel.

## Run it

1. Download and fully extract **HLSL-Playground-Windows-v1.6.0.zip** into a clean folder.
2. Double-click **Start-HLSL-Playground.cmd**.
3. In the new localhost tab, the **Circle mask** preset is ready. Press **Compile & Run HLSL** (or Ctrl+Enter while editing code).
4. Observe the 2D mask in the **Output** pane. Expand **Raw buffer & diagnostics** or **Generated WGSL** if you need details.
5. Open **Resource bindings & dispatch** to change the circle center, radius and edge width. Run again.

## Compatibility

The compute backend is unchanged: Windows PowerShell/.NET localhost service, Microsoft DXC (HLSL→SPIR-V), prebuilt Naga (SPIR-V→WGSL) and browser WebGPU. No Rust, Zig or Node installation is required. The old quarantined Zig server is **not** bundled.

This is a compatible buffer-based compute shader environment, not arbitrary native DXIL/D3D12, graphics or ray-tracing execution.

## Validation

CI checks frontend JavaScript syntax, unique DOM IDs, stylesheet and resource routes, pane hierarchy, circle aspect ratio, actual buffer statistics, and GPU output display logic. Windows tests validate the PowerShell server, source checkout, DXC/Naga compilation and clean tab-based shutdown; release packaging also tests the installed client.

As with prior releases, browser WebGPU execution depends on the user's GPU/driver, and GPU hardware behavior has not been qualified on every device.

Repository: https://github.com/Cryosimorgh/HLSL-Docs
