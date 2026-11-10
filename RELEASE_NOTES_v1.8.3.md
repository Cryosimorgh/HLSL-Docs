# HLSL Workbench v1.8.3 — Real In-Editor Code Folding

**Replaces the v1.8.2 folding interface.** The prior release presented one separate card for each code section, requiring individual "Edit section" controls. That is not how folding behaves in VS Code.

## What changed

- **One genuine editable code surface:** A locally bundled CodeMirror 5 editor, with continuous line numbers and folding chevrons in the gutter.
- **Fold functions and buffers in place:** Click the arrow beside a HLSL block to collapse its body to a small inline marker. Click again to expand it. No cards, duplicated code views, or secondary textareas.
- **Fold all / Unfold all** operate on the same code editor. Ctrl+Alt+[ / Ctrl+Alt+] fold/unfold at the cursor.
- **Preserved compilation:** Folding changes only the display. The complete shader text remains the canonical source for HLSL→DXC→Naga, source export, and animation. Edits update that source immediately.
- **Curated HLSL hover reference remains:** Hover recognized HLSL symbols for short What / Does / Use explanations, a separate example code block, and a link to the searchable offline documentation. F1 shows the reference for the symbol under the cursor.
- **Offline library:** CodeMirror 5.65.21 and the C-like syntax and folding add-ons are included in the ZIP under `playground/vendor/codemirror/`. CodeMirror is MIT-licensed; attribution and the full upstream LICENSE are bundled.
- **Fallback:** If a developer opens an incomplete source checkout without the vendored files, the original native textarea remains editable. The release ZIP always includes the editor assets.

## Install the complete Windows package

1. Download `HLSL-Playground-Windows-v1.8.3.zip`.
2. Extract the **entire ZIP into a clean folder**.
3. Start `Start-HLSL-Playground.cmd`.
4. Verify the shader is a single editor with a line-number gutter and fold arrows alongside `cbuffer WorkbenchFrame`, `FractalColor`, and `CSMain`. Use those arrows or **Fold all / Unfold all**.
5. Hover `float4`, `RWStructuredBuffer`, or `numthreads` to inspect the short tooltip and separate HLSL example.

The complete archive still includes the Windows PowerShell/.NET launcher, DXC, Naga, all sample HLSL shaders, animated Julia and particle demos, and documentation. Users do **not** need Node, npm, Zig or Rust.

## Validation

- Real Chromium integration tests verify in-editor line numbers and folding gutter, in-place collapsed markers, full-source preservation, edits reflected in the DXC source, hover documentation, and preset reloads without stale content.
- Windows packaging checks confirm all required CodeMirror assets exist inside the complete ZIP and are served by the local PowerShell host.
- Existing GPU/animation tests, real DXC→Naga compilation tests and packaged launcher startup/shutdown checks remain in the release pipeline.
- Actual WebGPU animation still depends on local browser and GPU support.

[Source repository](https://github.com/Cryosimorgh/HLSL-Docs)
