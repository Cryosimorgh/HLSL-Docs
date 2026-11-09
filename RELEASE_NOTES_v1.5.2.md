# HLSL Playground v1.5.2 — Actual GPU Output Visualization

This update makes the HLSL editor **visually demonstrate what the shader actually computed** instead of displaying only an output-buffer text dump or treating every result as particle velocities.

## What's new

- **GPU output plot after every successful dispatch.** The playground reads back WebGPU output buffers and draws their contents on a dedicated canvas. This is the executed GPU result, not the offline JavaScript physics animation.
- **Circle mask example:** a button fills the HLSL editor and JSON manifest with a complete 32×32 grid experiment (1,024 sample positions), separate circle center/radius/edge width uniforms, and a 2D GPU-derived heatmap. Dark cells are near mask 0; aqua cells are near mask 1; intermediate colors show edge softness.
- **Meaningful statistics:** mask coverage (samples ≥0.5), count, min/max/mean, and an explicit explanation when all mask values are zero.
- **Other shaders:** float4 output can be plotted as x/y scatter colored by z; plain float/int/uint output renders as a bar chart.
- **Output-layout safety:** If the shader generates a mask, the client will not mistake the mask (float4.z) for a particle velocity and corrupt the physics animation.
- **Improved compatibility messages:** unsupported fwidth/ddx/ddy compute derivatives now explain the current Naga limitation. The circle example uses explicit edge width and scalar cbuffer padding for WGSL uniform alignment.
- **Full buffer coverage:** visualization and statistics use all readback samples even when the textual output is truncated after a few rows.

## Run the circle mask

1. Extract **HLSL-Playground-Windows-v1.5.2.zip** to a new folder and double-click `Start-HLSL-Playground.cmd`.
2. Click **Circle mask example** in the HLSL editor.
3. Click **Compile & Run HLSL**. The dedicated **GPU output visualization** shows the circle against the entire 32×32 sample grid.
4. Expand **Buffer bindings and dispatch**, change the four leading `b0` float values (center x, center y, radius, softness), and rerun. The heatmap should change.
5. Compare with the numerical output and optionally check **Show generated WGSL**.

The default circle radius is **0.34 world units**. The former failed visual example used the physics-ball radius, only about 0.014, with particles around y=0.986. It consequently yielded zero mask values; the old client also fed those values back as velocities. Neither is a valid visual test of a circle mask.

## Compatibility and checks

- Uses the existing Windows PowerShell/.NET localhost service with Microsoft DXC → SPIR-V → prebuilt Naga → WGSL → WebGPU. No Rust, Zig or Node installation is needed.
- The package does not contain the previously quarantined custom Zig server.
- CI compiles both the physics and circle-mask HLSL through real DXC/Naga over the local API.
- CI checks browser JavaScript syntax and verifies 2D heatmap coverage, all-zero warnings, scalar plots, and reset behavior against known readback buffers.
- CI tests the bundled launcher and tab-based shutdown. Actual GPU drawing requires a working WebGPU browser/GPU and is not hardware-qualified for every system.

This remains a **compute-shader, buffer-oriented** client, not a universal arbitrary-HLSL renderer. Non-compute shaders, texture/sampler pipelines and unsupported SPIR-V features need different host support.

[Repository](https://github.com/Cryosimorgh/HLSL-Docs) · [Visual output guide](playground/README.md)
