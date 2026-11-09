# HLSL Playground v1.3.2 — Source checkout launcher repair

This maintenance release fixes the failure `Missing dxc.exe` when launching from a cloned GitHub repository or source ZIP. It also removes stale Node.js text from the Windows launcher and makes the offline browser message distinguish an old tab from a locally running server.

## What works

1. Download and extract **HLSL-Playground-Windows-v1.3.2.zip**, or clone the latest HLSL-Docs repository.
2. Double-click **Start-HLSL-Playground.cmd** at the project root.
3. The full portable ZIP runs with its bundled Zig backend, DXC and precompiled Naga. A source checkout **downloads a verified runtime automatically** on first launch and reuses a per-user cache on later runs.
4. Use the newly opened localhost page to edit and run compatible HLSL compute shaders.
5. Close the final playground tab or use the Close button. The Zig server exits automatically.

## Automatic checkout repair

The checkout bootstrap fetches the pinned Windows v1.3.1 runtime ZIP (about 15 MB) from the project's GitHub release, compares the SHA-256 against the published asset, extracts the portable tools to a per-user app-data cache, and launches that verified runtime. This neither installs Zig/Rust/Node globally nor requires changes to PATH. The cached runtime is reused on subsequent starts.

A source checkout does not contain executable assets. Earlier launchers incorrectly assumed those files were present and immediately failed with the `Missing dxc.exe` message. The new launcher handles that condition.

## Note about the old Node.js message

An existing browser tab opened from an older version or by opening `playground/index.html` directly may still show `node playground/server.mjs`. Close that tab and open the **new** localhost page launched from the v1.3.2 tools. The current backend is written in Zig; Node.js and Cargo are not needed on your machine.

## Verification

The Windows release workflow builds the Zig server and checks actual HLSL-to-WGSL translation through its local HTTP endpoint. It tests the bundled launcher, tab-based shutdown, and the source-checkout bootstrap without preinstalled compiler files. Browser WebGPU availability remains device-dependent. The editor runs compatible compute shaders via translated WGSL; it is not a general Direct3D executable.
