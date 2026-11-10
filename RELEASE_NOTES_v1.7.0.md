# HLSL Workbench v1.7.0 — Real Continuous GPU Animation

This release fixes the fundamental limitation of the earlier Workbench: **running an HLSL shader no longer has to produce only a static screenshot**. v1.7.0 has an actual continuous GPU dispatch loop, with an animated Julia-set example.

## Use it

1. Download and extract **HLSL-Playground-Windows-v1.7.0.zip** to a new folder.
2. Double-click **Start-HLSL-Playground.cmd**, then use the localhost tab it opens.
3. The **Julia animation** preset is loaded by default.
4. Click **Animate** (not the one-shot **Compile & Run HLSL** button).
5. Watch the Julia fractal evolve. Frame and observed FPS counters change as completed WebGPU dispatches are read back.
6. **Pause** to freeze it, **Step** for one dispatch, **Resume** to continue, or **Reset** to restore the initial phase.
7. Adjust Julia parameters under **Resource bindings & dispatch**. On the next Animate/Step, changed HLSL or bindings are recompiled once.

## How the live loop actually works

- The frontend calls the existing local PowerShell/.NET compiler host **once** per shader/configuration.
- DXC compiles the HLSL compute shader to SPIR-V; Naga translates it to WGSL. The WebGPU compute pipeline is created once.
- All GPU storage/uniform buffers are retained across animation frames. The runtime writes an updated float32 phase to a selected uniform component using `GPUQueue.writeBuffer`, submits a new WebGPU compute dispatch, then copies the output to a reusable staging buffer and maps it.
- Each completed GPU buffer is drawn into the preview. The Julia preset renders 128×128 samples with a deep-blue/teal/amber escape-iteration palette. The renderer uses pixel image data and one scaled canvas draw for the grid, rather than issuing thousands of CSS-colored rectangles.
- One GPU dispatch/readback is in flight at a time. The animation is paced with `requestAnimationFrame` and a target FPS. If compilation, GPU work or readback are slow, *actual* FPS may be lower.
- Closing the tab, changing presets, or stopping the session cancels scheduling and releases allocated GPU resources. Hidden tabs pause automatically.

**No infinite HLSL kernel loops are required.** The bounded fractal iteration is inside each compute invocation. The continuous animation itself is managed by the browser.

## Animate other HLSL compute shaders

The buffer manifest supports:

```json
"animation": {
  "binding": 32,
  "component": 0,
  "speed": 1,
  "fps": 30
}
```

These values mean: update the first float32 value of uniform buffer binding 32 by 1 unit per elapsed second, targeting up to 30 frames/s. Supported target rates: 15, 24, 30, 60. The shader must actually reference that uniform to produce different frames; arbitrary static shaders will remain visually unchanged. For iterative simulations, writable storage buffers persist between dispatches until Reset; application-specific input/output ping-pong is not yet automatic.

The Julia HLSL source is included at `playground/julia-loop.hlsl`.

## Validation and limitations

- JavaScript integration tests verify the animation controller: **one compile, multiple real WebGPU API submissions**, changing time uniforms, distinct readbacks, pause, step, resume without recompilation, reset and GPU-resource cleanup. Those tests use a mocked WebGPU device and do not demonstrate physical GPU performance.
- Windows CI compiles **julia-loop.hlsl** through actual DXC → Naga over the PowerShell HTTP API, and tests the complete packaged launcher, static routes and tab shutdown.
- Browser GPU execution depends on the user's driver and WebGPU support; high-FPS rendering and all Windows device/driver combinations have not been physically qualified.
- The buffer readback preview currently incurs CPU/GPU synchronization each frame. For much higher-performance simulations, a future GPU-only rendering pass is recommended.
- Only supported compute shaders and explicitly bound resources can run. This is not a universal HLSL graphics/Direct3D runtime.

The package contains Microsoft DXC and the prebuilt Naga executable and uses the Windows PowerShell/.NET host. No Rust, Node or Zig installation is required. The quarantined older custom `hlsl-server.exe` is not shipped.

Source: https://github.com/Cryosimorgh/HLSL-Docs
