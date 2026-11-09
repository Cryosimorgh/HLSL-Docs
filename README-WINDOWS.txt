HLSL Playground v1.5.1 — one-click Windows client

HOW TO RUN
1. Download HLSL-Playground-Windows-v1.5.1.zip from
   https://github.com/Cryosimorgh/HLSL-Docs/releases/tag/v1.5.1
2. Extract the entire ZIP to a new folder.
3. Double-click Start-HLSL-Playground.cmd.
4. The launcher starts a localhost server using the Windows PowerShell/.NET
   runtime already included in Windows. A browser tab opens automatically.
5. Click "Array example", edit its HLSL code, then "Compile & Run HLSL".
   The host uses DXC + Naga to generate WGSL, and WebGPU runs it on your GPU.
6. Close the tab or press Close playground to stop the local server.

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
program. Custom buffer layouts require matching resource JSON. Browser
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
