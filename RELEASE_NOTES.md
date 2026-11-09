# HLSL Engineer Skill v1.0.0

**First public release** — 9 November 2026

## Included

- **hlsl-engineer Agent Skill** at .agents/skills/hlsl-engineer/SKILL.md, compatible with the open Agent Skills folder format and discoverable by Codex when this repository is opened.
- Two concise, load-on-demand reference files: **API decision map** and **shader review/adversarial testing matrix**.
- **Interactive HLSL Compute Playground** at playground/index.html: single-page, offline HTML/CSS/JavaScript tutorial with editable gravity, drag, wall restitution, timestep, body count and compute workgroup size, step/pause/reset, drag-to-launch and lane occupancy visualization.
- **particle-step.hlsl**: corresponding authentic HLSL compute kernel, independently compilable by DXC with cs_6_0; requires a D3D12 host for GPU execution.
- **Complete HLSL Handbook**: seven chapters of annotated examples, charts and API/engine architecture notes, including the Sunder GPU physics case study.

## Installation

**Codex repo-local:** clone this repository and open it in Codex. The skill is at .agents/skills/hlsl-engineer/SKILL.md and can be used explicitly with $hlsl-engineer or matched implicitly when the task calls for it.

**Manual personal install:** copy the hlsl-engineer directory into ~/.agents/skills/hlsl-engineer, preserving the references subdirectory. Restart Codex if it does not discover the skill.

**Browser tutorial:** download the release ZIP and open playground/index.html in a browser. No dependencies, server or internet are required.

## Validation boundary

- Verified the required skill frontmatter, expected references and example source file presence.
- Parsed the interactive tutorial's inline JavaScript for syntax errors.
- Verified guards and conceptual mapping between CPU model and HLSL snippets.
- **Not GPU-verified:** Native DXC compilation on Windows, D3D12 shader dispatch and hardware throughput were not run by this release workflow. The browser demonstration executes JavaScript, not HLSL.

## Compatibility and references

- Open Agent Skills specification: https://agentskills.io/specification
- Modern HLSL examples target **DXC / DirectX 12 / Shader Model 6.0**, with stages and feature availability explained in the Handbook.
- HLSL official reference: https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl
- Sunder case study: https://github.com/Cryosimorgh/Sunder

The release archive bundles the skill folder, playground and single-file handbook. The original repository MIT License applies.
