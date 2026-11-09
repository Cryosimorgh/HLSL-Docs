# Third-party tools in the optional Windows portable package

The source-only HLSL Handbook and skill use this repository's MIT License.
The **Windows portable release** additionally bundles independently developed
compiler and runtime executables. They are not authored by this repository.

| Binary | Upstream | Version chosen for portable build | License |
|---|---|---|---|
| hlsl-server.exe (Zig source in playground/zig-server.zig) | https://ziglang.org | Built using Zig 0.13.0; compiler not bundled | Local application source under repository MIT License |
| dxc.exe, dxcompiler.dll (and associated runtime DLLs) | https://github.com/microsoft/DirectXShaderCompiler | v1.9.2609 | See upstream DXC license and redistribution notices |
| naga.exe | https://github.com/gfx-rs/wgpu/tree/trunk/naga-cli | naga-cli 30.0.1 | MIT OR Apache-2.0; retain upstream notice and license requirements |

The packaging job checks versions and includes available licensing documents.
The Naga binary is reused from the already published v1.2.0 Windows package: end users do not need Rust or Cargo. Distribution of these tools does not transfer ownership or
change their terms. Users may consult the upstream project licenses.

**Runtime limitation:** DXC translates HLSL to SPIR-V, and Naga translates
SPIR-V to WGSL. The browser executes WGSL via WebGPU. The portable bundle is
not a native D3D12 runner and is limited to compatible compute shaders and
the provided resource/dispatch host.
