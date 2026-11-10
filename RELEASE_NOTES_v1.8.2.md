# HLSL Workbench v1.8.2 — Foldable Code and Contextual HLSL Help

This release includes the foldable shader editor and hover-to-documentation features in the **complete Windows download**. Previous source versions had the editor components, but the v1.8.1 portable packaging omitted their JavaScript and documentation assets, so they did not work in the shipped client.

## Code sections
- The workbench starts in **Code sections** mode. Top-level shader declarations, resources, functions, attributes and preprocessor directives are divided into collapsible chunks.
- **Fold all**, **Unfold all**, and **Full editor** switch between compact and unrestricted source views.
- Expand a chunk and select **Edit section** to edit that code. Changes update the same canonical HLSL source used by **Compile & Run HLSL** and **Animate**; collapsing a chunk does not remove code.
- For complex edits, use **Full editor** to avoid limitations of simple brace-based chunk detection.

## Hover reference
- Hover a recognized HLSL keyword, type, resource, attribute, or built-in function to see three short descriptions: **What**, **Does**, and **Use**.
- Each hover card contains a **separate HLSL code example block** and a link to a local quick-reference page.
- The reference page includes a searchable index, concise explanations and independent code examples.
- Press **F1** when the caret is on a recognized term in the full editor. Folded code has focusable documentation terms.
- This is a curated offline reference, not IntelliSense, a full HLSL parser, or a semantic language server. Unknown user-defined symbols do not have automatic documentation.

## Installation
Download **HLSL-Playground-Windows-v1.8.2.zip**, extract into a new folder, and double-click **Start-HLSL-Playground.cmd**. The complete package includes Microsoft DXC, Naga, the PowerShell/.NET local compiler host, all JavaScript, local documentation, examples and source. No Node, Zig or Rust installation is needed.

The Julia and GPU particle examples still compute their framebuffer RGB colors directly in HLSL, with automatically supplied time and no animation JSON manifest.

## Tests
Frontend checks verify folding, tooltip and documentation controls and script ordering. The packaged-client test now verifies that **all four documentation assets are physically included and served by the extracted Windows package**, and that the actual HTML contains the code-section and hover-reference interface. The release pipeline also compiles HLSL with real DXC/Naga and tests startup and shutdown. Browser GPU animation remains dependent on local WebGPU support.

[Repository](https://github.com/Cryosimorgh/HLSL-Docs)
