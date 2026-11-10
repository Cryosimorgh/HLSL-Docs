# HLSL Workbench v1.9.0 — Offline HLSL Completion and Signature Help

This version adds code completion and IntelliSense-style editing to the existing, VS Code-style inline-folding HLSL editor. The complete Windows ZIP includes everything required: the PowerShell/.NET local compiler, DXC, Naga, CodeMirror editor, autocomplete add-on, HLSL completion engine, documentation, animated examples and startup script.

## Use IntelliSense in the editor

- **Ctrl+Space** (or **Complete** in the toolbar) opens a suggestion popup at the cursor.
- Typing two or more letters, or `.` after a known vector, can trigger contextual suggestions automatically.
- The popup recognizes HLSL syntax, scalar/vector/matrix types, shader resource declarations, compiler intrinsics, preprocessor directives, register slots and system-value semantics.
- It also scans **this shader** for user-defined variables, constant-buffer fields, GPU resources, `#define` names, function declarations and parameters. It suggests those names alongside predefined HLSL symbols.
- For known vectors, it offers compatible component/swizzle suggestions such as `.x`, `.xyz`, `.rgb` for `float3`, without proposing a four-component `.rgba` on that type.
- Select suggestions with the keyboard or a single click. Completing a function inserts `function()` and places the cursor between the parentheses.
- While editing a call such as `smoothstep(minValue, maxValue, x)`, **signature help** displays its name and argument position. The same mechanism reads ordinary user-defined function signatures.
- **Ctrl+Shift+Space** explicitly requests parameter hints. **F1** continues to show brief HLSL documentation and a separate code example. Existing folding, editor history, compilation, and animation remain integrated.
- The dropdown and local docs do not need an internet connection; `show-hint.js`, `show-hint.css`, and the new `hlsl-intellisense.js` are packaged in the Windows ZIP.

## Scope and limitations

This is **IntelliSense-style lexical completion**, not a full Microsoft/DXC HLSL language server. Symbol extraction is heuristic and file-local; it cannot guarantee correct overload resolution, visibility, variable scope, external includes, or semantic validation. Code that the editor can suggest might still fail DXC/Naga/WebGPU compilation. Compiler errors remain the authoritative source of truth. Some HLSL language features are unsupported by the browser's SPIR-V→WGSL conversion path.

The completion system doesn't upload source code to any cloud service. The source remains in the local browser tab and only goes to the localhost compiler endpoint when the user runs it.

## Install

1. Download **HLSL-Playground-Windows-v1.9.0.zip** from the release.
2. Extract **the complete ZIP** into a fresh folder.
3. Run **Start-HLSL-Playground.cmd**.
4. In the Julia example type `smooth` inside a function, or click **Complete**, and select `smoothstep`. Try `FractalC` to complete the shader's `FractalColor` function. Enter a function call to see its argument signature.
5. Click **Animate** to use the existing continuous HLSL GPU animation, or **Compile & Run HLSL** to execute one frame.

No Node, npm, Rust, or Zig installation is needed for the distributed Windows client.

## Verification

- Unit tests exercise predefined and user-defined completions, macro names, HLSL registers, semantics, compatible vector swizzles, signatures and suppression inside comments/strings.
- **Real Chromium** tests open the shipped editor UI, verify the popup and a click accepting a function suggestion, verify function signature help, and confirm edits reach the compiled source.
- The Windows release pipeline verifies that every offline autocomplete asset is in the packaged client and served by the local host, tests real DXC→Naga compilation, and validates packaged launcher startup and final-tab shutdown.
- Actual WebGPU rendering and driver performance still require verification on the target machine.

[Source repository](https://github.com/Cryosimorgh/HLSL-Docs)
