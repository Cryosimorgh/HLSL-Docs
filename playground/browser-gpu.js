// Dependency-free browser WebGPU teaching lab: WGSL, NOT HLSL.
// No native server, subprocess, compiler binaries, or network requests.
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const shader = $("wgsl-code"), input = $("wgsl-input"),
        output = $("wgsl-output"), run = $("wgsl-run");
  const starter = [
    "// Real GPU compute in WebGPU Shading Language (WGSL).",
    "// Edit the multiplier and run with no local native server.",
    "@group(0) @binding(0) var<storage, read> numbers: array<f32>;",
    "@group(0) @binding(1) var<storage, read_write> results: array<f32>;",
    "",
    "@compute @workgroup_size(64)",
    "fn main(@builtin(global_invocation_id) id: vec3<u32>) {",
    "  let i = id.x;",
    "  if (i >= arrayLength(&numbers)) { return; }",
    "  results[i] = numbers[i] * 2.0;",
    "}"
  ].join("\n");
  shader.value = starter;
  input.value = "[1, 2, 3, 4, 5, 6, 7, 8]";
  $("wgsl-reset").addEventListener("click", () => {
    shader.value = starter;
    input.value = "[1, 2, 3, 4, 5, 6, 7, 8]";
    output.textContent = "Reset. Edit WGSL and click Run WGSL.";
  });
  run.addEventListener("click", async () => {
    run.disabled = true;
    output.textContent = "Preparing browser WebGPU device…";
    let device, src, dst, staging;
    try {
      if (!navigator.gpu) {
        throw Error("WebGPU is unavailable in this browser or context. Try an up-to-date Chrome/Edge browser with GPU acceleration.");
      }
      const values = JSON.parse(input.value);
      if (!Array.isArray(values) || values.length < 1 || values.length > 1024 ||
          !values.every(n => typeof n === "number" && Number.isFinite(n))) {
        throw Error("Input must be a JSON array of 1–1024 finite numbers.");
      }
      const sourceText = shader.value;
      if (sourceText.length > 32 * 1024) throw Error("WGSL source too large (32 KiB maximum).");
      const match = sourceText.match(/@workgroup_size\s*\(\s*(\d+)/);
      if (!match) throw Error("Include literal @workgroup_size(N) in WGSL.");
      const groupSize = Number(match[1]);
      if (!Number.isInteger(groupSize) || groupSize < 1 || groupSize > 256) {
        throw Error("Workgroup size must be from 1 to 256.");
      }
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw Error("No WebGPU adapter available.");
      device = await adapter.requestDevice();
      const gpuErrors = [];
      device.addEventListener("uncapturederror", ev => gpuErrors.push(ev.error.message));
      const f32 = new Float32Array(values), size = f32.byteLength;
      src = device.createBuffer({
        size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      });
      dst = device.createBuffer({
        size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
      });
      staging = device.createBuffer({
        size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
      });
      device.queue.writeBuffer(src, 0, f32);
      const module = device.createShaderModule({ code: sourceText });
      const compilation = await module.getCompilationInfo();
      const errors = compilation.messages.filter(m => m.type === "error");
      if (errors.length) {
        throw Error("WGSL compilation failed:\n" +
          errors.map(m => m.lineNum + ":" + m.linePos + " " + m.message).join("\n"));
      }
      const pipeline = await device.createComputePipelineAsync({
        layout: "auto", compute: { module, entryPoint: "main" }
      });
      const group = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: src } },
          { binding: 1, resource: { buffer: dst } }
        ]
      });
      const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(Math.ceil(values.length / groupSize));
      pass.end();
      encoder.copyBufferToBuffer(dst, 0, staging, 0, size);
      device.queue.submit([encoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const result = new Float32Array(staging.getMappedRange().slice(0));
      staging.unmap();
      await device.queue.onSubmittedWorkDone();
      if (gpuErrors.length) throw Error("WebGPU errors: " + gpuErrors.join("; "));
      output.textContent = "WebGPU computed result (float32):\n" +
        JSON.stringify(Array.from(result).map(n => Number(n.toPrecision(7)))) +
        "\n\nReal GPU execution of WGSL. No HLSL translation or native executable involved.";
    } catch (error) {
      output.textContent = "Could not run WGSL:\n" + String(error.message || error);
    } finally {
      if (staging) staging.destroy();
      if (dst) dst.destroy();
      if (src) src.destroy();
      if (device) device.destroy();
      run.disabled = false;
    }
  });
})();
