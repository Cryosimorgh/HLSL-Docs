HLSL Playground v1.9.0 — one-click Windows client

HOW TO RUN
1. Download HLSL-Playground-Windows-v1.9.0.zip from
   https://github.com/Cryosimorgh/HLSL-Docs/releases/tag/v1.9.0
2. Extract the entire ZIP to a new folder.
3. Double-click Start-HLSL-Playground.cmd.
   The HLSL editor has line numbers and VS Code-style fold arrows in its
   gutter. Click an arrow to collapse a function or buffer IN PLACE.
   Use Fold all / Unfold all. Hover float4, cbuffer or RWStructuredBuffer
   for short HLSL help and a separate example block.
   Press Ctrl+Space (or Complete) for code suggestions. The client recognizes
   HLSL types, built-ins, variables and functions in the current shader.
   Function calls show parameter hints; Ctrl+Shift+Space requests them.
   This is local/offline editing help, not full DXC semantic IntelliSense.
4. The launcher starts a localhost server using the Windows PowerShell/.NET
   runtime already included in Windows. A browser tab opens automatically.
5. The "Julia animation" preset loads automatically. Click "Animate" to
   see continuously changing GPU-generated RGB fractal pixels.
   Select "GPU particles" then "Animate" for 24 moving colored particles
   generated directly by HLSL. Pause, Step, Reset and Resume are available.
   The shader writes float4(red, green, blue, alpha) pixels to Framebuffer:u0.
   No animation JSON manifest is required for either of these examples.
   The host uses DXC + Naga to generate WGSL, and WebGPU runs it on your GPU.
6. Close the tab or press Close playground to stop the local server.

VERIFY THE CORRECT CLIENT
- The first HLSL lines should include #define WORKBENCH_WIDTH 256.
- They should NOT begin with // Sample host cbuffer values or struct Ball.
- If you see the old physics shader, close the tab, extract v1.9.0 in a
  fresh folder, and run that folder's CMD file.

NO INSTALLATION NEEDED
- No Rust/Cargo installation.
- No Node.js installation.
- No Zig installation or custom hlsl-server.exe.
- DXC and a prebuilt Naga converter are inside tools/ in this ZIP.
- No admin privileges or global PATH changes are needed.

EXPLAINING THE ARCHITECTURE
Browser HLSL editor -> loopback PowerShell/.NET bridge -> DXC HLSL-to-SPIR-V
-> precompiled Naga SPIR-V-to-WGSL -> browser WebGPU compute dispatch.
The browser also has a separate WGSL-only GPU lab and a JavaScript particle
simulation, which work without a local compilation server.

LIMITS
This is a supported-compute-subset playground, not any arbitrary HLSL GPU
program. Framebuffer HLSL automatically configures u0 and b7 from source.
Other custom buffer layouts may still require resource JSON. Browser
WebGPU support depends on graphics drivers and settings.

TROUBLESHOOTING
- Do not use old releases with the quarantined hlsl-server.exe.
- Open the fresh http://127.0.0.1:<port>/ tab created by the launcher,
  not a file:/// tab from an earlier extracted copy.
- Logs: %TEMP%/hlsl-playground-run-<id>/server.stderr.log
- If the Run button reports a compile error, open the Buffer bindings
  JSON and ensure it matches the HLSL shader's resource registers.
- If WebGPU is not available in your browser, try a current Chrome/Edge
  with GPU support; the JavaScript animation still runs.
- Do not disable or exclude security software to run this project.

Source and issue tracker: https://github.com/Cryosimorgh/HLSL-Docs
