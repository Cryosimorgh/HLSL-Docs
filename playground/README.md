# HLSL Workbench — GPU Compute and Continuous Animation

**[Download complete Windows Workbench v1.8.2](https://github.com/Cryosimorgh/HLSL-Docs/releases/download/v1.8.2/HLSL-Playground-Windows-v1.8.2.zip)** · [Release notes](../RELEASE_NOTES_v1.8.2.md) · [HLSL Handbook](../HLSL-Handbook.md)

## Run the Windows client

1. Extract the **entire** v1.8.2 ZIP to a new folder.
2. Double-click **Start-HLSL-Playground.cmd**. The Windows PowerShell/.NET compiler host opens a localhost browser tab.
3. Choose **Julia animation** (default) or **GPU particles**. Click **Animate** to see the shader change over time. Pause, Step, Reset and Resume control repeated WebGPU compute dispatches.
4. Click **Compile & Run HLSL** for a single GPU frame. Output, source code, error diagnostics and generated WGSL are inspectable.
5. Closing the final browser tab or ending the session stops the compiler host. Hidden tabs automatically pause animation.

No Node, Zig or Rust installation is required; the full Windows ZIP includes DXC and Naga. The previously quarantined Zig `hlsl-server.exe` is neither bundled nor launched.

## Foldable code and inline reference

The editor starts with collapsible HLSL code sections. Use **Fold all**, **Unfold all**, or **Full editor**. Expanded sections have an **Edit section** button; edits modify the shader that is actually compiled. Hover a recognized HLSL symbol for short **What / Does / Use** explanations, a separate HLSL code example, and a link to the searchable [offline reference](hlsl-reference.html). Press **F1** on a recognized term in the full editor.

## Verify the startup source

v1.8.2 fixes a critical v1.8.0 startup error where a nonexistent preset-button ID prevented the Julia shader from loading. On startup the editor must show `#define WORKBENCH_WIDTH 256` and `RWStructuredBuffer<float4> Framebuffer : register(u0)`. If you see the old `struct Ball` shader, you are using an outdated browser tab or package. Use a fresh v1.8.2 extraction and the new tab opened by its CMD launcher.

A real Chromium test now checks this on every frontend change, including switching between Julia and GPU particles and preserving the editor when the independent JavaScript sandbox settings change.

## Pure-HLSL-defined pixels and animation

The two new presets provide actual **RGBA framebuffer output written by HLSL**. The host does not recolor particle positions or synthesize a picture in JavaScript.

Your HLSL source controls output resolution, pixel color, and how the pixel values change over time:

~~~hlsl
#define WORKBENCH_WIDTH 256
#define WORKBENCH_HEIGHT 256

cbuffer WorkbenchFrame : register(b7)
{
    float Time;
    float DeltaTime;
    float Width;
    float Height;
    float Frame;
    float Padding0;
    float Padding1;
    float Padding2;
};

RWStructuredBuffer<float4> Framebuffer : register(u0);

[numthreads(8,8,1)]
void CSMain(uint3 tid : SV_DispatchThreadID)
{
    if (tid.x >= WORKBENCH_WIDTH || tid.y >= WORKBENCH_HEIGHT) return;
    uint i = tid.y * WORKBENCH_WIDTH + tid.x;
    float2 uv = (float2(tid.xy) + 0.5f) /
                float2(WORKBENCH_WIDTH, WORKBENCH_HEIGHT);
    Framebuffer[i] = float4(uv.x, uv.y, 0.4f + 0.4f*sin(Time), 1.0f);
}
~~~

No `animation` JSON manifest is required. The client recognizes `Framebuffer:u0` and `WorkbenchFrame:b7` in the HLSL text, reads `WORKBENCH_WIDTH` and `WORKBENCH_HEIGHT`, and allocates a `float4` array for the output. DXC maps `u0` to WGSL binding **16** and `b7` to binding **39**. On each frame, JavaScript supplies `Time`, `DeltaTime`, and `Frame`; it dispatches the shader and displays the **actual red, green, blue and alpha values read back from WebGPU**. It does not choose a palette or compute the pixel colors.

The HLSL output contract is intentionally narrow: up to 512×512, maximum 4 MiB of float4 pixels, shader entry `CSMain` and explicitly defined framebuffer/time registers. An HLSL program cannot schedule browser animation frames or create its own graphics canvas; the JavaScript host still controls those operations. Existing advanced JSON buffer manifests remain available for other compute shader layouts.

The examples `julia-rgba.hlsl` and `particles-rgba.hlsl` are fully editable. The **GPU particles** shader procedurally animates 24 independently moving dots with RGB colors and glow, rather than solving inter-particle physics. The independent JavaScript physics sandbox under **Other labs** is still a separate teaching tool.

**From a source checkout:** run `git pull` and `Start-HLSL-Playground.cmd`. The first run downloads checksum-pinned DXC/Naga compiler-only tools when necessary. Do not restore old custom Zig server binaries.

## See what your HLSL shader actually produced

The **GPU output visualization** is the main right-hand pane of the workbench after **Compile & Run HLSL**. Raw output and generated WGSL remain in optional inspectors. Unlike the JavaScript particle demo, it is drawn from `GPUBuffer.mapAsync()` **after the translated shader has executed on WebGPU**.

- **Circle mask example:** click the new preset, then **Compile & Run HLSL**. It generates 1,024 input positions on a 32×32 grid, uses a circle radius of `0.34` (world units) and edge width `0.025`, and displays a 2D heatmap. Aqua cells have mask near 1; dark cells have mask near 0. A summary reports min, max, mean and count of cells with mask ≥0.5.
- **Other float4 outputs:** a scatter plot shows x/y coordinates; the color represents the third float channel (z). If the source contains a circle mask, the summary identifies all-zero masks instead of leaving a blank result.
- **Scalar buffers:** numeric outputs such as `float`, `uint` and `int` appear as bar charts. The full buffer statistics are based on all values, even if the textual dump is truncated.

To customize the view, set `resources[].visualize` on the inspected output, for example:

~~~json
{
  "binding": 16,
  "access": "read_write",
  "byteLength": "grid",
  "inspect": true,
  "display": "vec4",
  "applyToCanvas": false,
  "visualize": {
    "mode": "grid-mask",
    "grid": { "width": 32, "height": 32, "xMax": 2.2, "yMax": 1 },
    "channel": 2
  }
}
~~~

The input `t0` uses `{"binding":0,"access":"read","preset":"grid","grid":{"width":32,"height":32,"xMax":2.2,"yMax":1}}`. The grid preset generates positions in float4 tuples, so no huge JSON array needs to be pasted. When dispatch is `"auto"`, the client dispatches enough workgroups to cover the entire grid, not only the live physics particle count.

**Why an earlier circle shader looked blank:** its `radius` came from the physics ball radius at cbuffer byte 20, not a configurable circle radius. With particles resting near `y=0.986` and the circle centered at `y=0.5`, every computed mask was zero. Moreover, applying `float4(x,y,mask,0)` back into the physics simulation treated the mask as x-velocity. The client now keeps mask results separate and reports zero coverage explicitly.

The mask example uses an explicit `EdgeWidth` instead of `fwidth()` because the current Naga translator doesn't accept the `SPV_KHR_compute_shader_derivatives` extension. It also uses scalar float padding in its b0 cbuffer to avoid WGSL uniform alignment incompatibilities with `float3`.

## Editor highlighting and preview controls

The HLSL editor colors known types, keywords, comments, numbers, functions, resources, registers and variable identifiers without requiring IntelliSense or any editor download. The editable source remains a native textarea; the syntax layer is only visual. The GPU plot uses a larger area with less empty padding while preserving correct X/Y geometry. Collapsed sections use chevrons, not add/remove icons.

## Continuous HLSL animation (new in v1.8.2)

The **Julia animation** preset is ready on startup. Press **Animate** to compile HLSL once and repeatedly dispatch it through WebGPU. This is not a static image or a simulated JavaScript replay.

**Pause** freezes future dispatches, **Step** submits one new GPU dispatch, **Resume** uses the same GPU pipeline, and **Reset** restores the initial uniform values and persistent buffers. FPS and frame counts describe completed GPU readback frames (not a hardware GPU timestamp benchmark). The preview is updated from `GPUBuffer.mapAsync` each frame. Background tabs pause automatically.

The Julia preset generates 128×128 input positions, uses a bounded 100-iteration `z = z² + c` loop per GPU thread, and evolves the Julia constant from a float32 **Phase** uniform. The shader source is `julia-loop.hlsl`. Its resource manifest includes:

~~~json
{
  "animation": { "binding": 32, "component": 0, "speed": 1, "fps": 30 }
}
~~~

You can set the animation rate to 15, 24, 30 or 60 target FPS. This is a target, not a guaranteed throughput. Any compatible HLSL compute shader can use this mechanism if it has a float32 time/phase uniform at the specified binding/component and that uniform actually affects the output. Ordinary static shaders will not animate merely by being dispatched again.

The GPU buffers persist during animation, but there is no automatic input/output ping-pong for iterative simulation algorithms yet. The current preview reads the output back to the CPU every frame, so very large grids may be slower than GPU-only rendering.

For a single diagnostic dispatch, press **Compile & Run HLSL** instead; it remains supported.

## What happens when you click Run

~~~text
Editable HLSL (CSMain)
        ↓ POST /api/compile to localhost PowerShell/.NET
DXC HLSL / Shader Model 6.0
        ↓ SPIR-V
Precompiled Naga translator
        ↓ WGSL
Browser WebGPU (GPU compute dispatch)
        ↓
GPU output readback → Result panel
~~~

This is **real execution of WGSL translated from HLSL** on the GPU, not native Direct3D DXIL execution. A WebGPU-capable browser and GPU/driver are needed.

## Edit buffer bindings

The HLSL editor has a **Buffer bindings and dispatch** JSON panel. HLSL register spaces are shifted by DXC so they don't collide in the generated WGSL:

| HLSL register | WebGPU binding | Example |
| --- | --- | --- |
| t0 | 0 | `StructuredBuffer<float> Input` |
| u0 | 16 | `RWStructuredBuffer<float> Output` |
| b0 | 32 | `cbuffer Params` |
| s0 | 48 | Sampler, if the host actually supplies one (current host only provides buffers) |

Supported fields include `entry` (e.g. `CSMain`), `dispatch` (`"auto"` or `[x,y,z]`), and a `resources` array with `binding`, `access` (`read`, `read_write`, `uniform`), `data` (numeric inputs), `byteLength` (zeroed output buffer), `preset` (`particles` or `parameters`), `inspect`, `display`, and optional `applyToCanvas`.

The starter particle shader uses 16-byte `Ball` records and a 32-byte HLSL cbuffer. The separate JavaScript particle visualization shows analogous update math and workgroup occupancy. It's not a GPU benchmark or a native D3D12 physics runtime.

## Browser-only alternative

Opening `playground/index.html` directly without the launcher provides the JavaScript particle simulation, source editor, and **WGSL-only GPU lab**. You can edit WGSL and click **Run WGSL on GPU** to execute a simple float-array compute shader without a local process. That panel runs WGSL directly, **not HLSL**.

## Limits and diagnostics

- The local host accepts only loopback connections with the correct Host/Origin, has a static-file allowlist and limits source/body size, compiler output size and subprocess duration.
- The page can run compatible **compute shaders with explicit buffer bindings**, not every HLSL script. Vertex/pixel stages, ray tracing, arbitrary textures/samplers, shader includes and unsupported DXC/Naga conversions aren't automatically supported.
- If compilation fails, read the DXC/Naga error in the output panel. If shader compilation works but execution fails, inspect generated WGSL and the WebGPU device/feature error.
- On Windows, the launcher logs are written to `%TEMP%\hlsl-playground-run-<id>\server.stderr.log` and `server.stdout.log`.
- No antivirus bypass or Defender exclusion is required. The new host does **not** execute the older custom Zig binary.
- Run only shader code you trust. GPU shader execution can still trigger driver/device errors.

## Developer tests

The repository's Windows CI runs `node playground/test-powershell.mjs` **only as a test client**, including real DXC/Naga compilation through the PowerShell HTTP API. Users do not need Node.

[See source](server.ps1) · [Release notes](../RELEASE_NOTES_v1.8.2.md)
