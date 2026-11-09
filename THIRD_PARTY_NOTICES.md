# Third-party tools — HLSL Playground Windows v1.5.0

The HLSL Handbook and PowerShell/.NET HTTP bridge source are distributed under this repository's MIT License. The Windows portable client additionally includes external compiler binaries. Those remain owned and licensed by their respective upstream authors.

| Component | Upstream | Version in bundle | License |
| --- | --- | --- | --- |
| Windows PowerShell/.NET host | Windows system installation | Windows PowerShell 5.1 | Microsoft Windows licensing; no binary is bundled or redistributed |
| Microsoft DirectX Shader Compiler (DXC) | https://github.com/microsoft/DirectXShaderCompiler | v1.9.2609, Windows x64 | See upstream DXC license and redistribution terms |
| Naga CLI | https://github.com/gfx-rs/wgpu/tree/trunk/naga-cli | Prebuilt naga-cli 30.0.1 from this project's prior compiler toolchain | MIT OR Apache-2.0; see upstream notices |

The Naga executable is reused from the previously built Windows compiler-tool package; users do not need to install Rust or Cargo. The release package includes **only** DXC and Naga executables/DLLs under `tools/`; the previously flagged custom `hlsl-server.exe` is **not included or executed**.

DXC converts HLSL to SPIR-V, Naga converts SPIR-V to WGSL, and the browser executes WGSL through WebGPU. This is not a native Direct3D 12 DXIL runtime.

Always consult upstream licenses and redistributable notices for the compiler binaries. Distribution of the tools does not transfer ownership or change their licensing terms.
