// CI-only frontend syntax and DOM contract checks; shipped backend is Zig.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
const root=fileURLToPath(new URL(".",import.meta.url));
const html=await readFile(root+"index.html","utf8");
const runner=await readFile(root+"live-runner.js","utf8");
const animation=await readFile(root+"animation-runner.js","utf8");
const browserGpu=await readFile(root+"browser-gpu.js","utf8");
const visualizer=await readFile(root+"gpu-visualizer.js","utf8");
const hlslHighlight=await readFile(root+"hlsl-highlight.js","utf8");
const folds=await readFile(root+"hlsl-fold-docs.js","utf8");
const docsData=await readFile(root+"hlsl-docs-data.js","utf8");
const docsReference=await readFile(root+"hlsl-reference.js","utf8");
const docsPage=await readFile(root+"hlsl-reference.html","utf8");
const css=await readFile(root+"workbench.css","utf8");
new vm.Script(visualizer,{filename:"gpu-visualizer.js"});
new vm.Script(hlslHighlight,{filename:"hlsl-highlight.js"});
new vm.Script(folds,{filename:"hlsl-fold-docs.js"});
new vm.Script(docsData,{filename:"hlsl-docs-data.js"});
new vm.Script(docsReference,{filename:"hlsl-reference.js"});
new vm.Script(browserGpu,{filename:"browser-gpu.js"});
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .filter(m=>!m[0].includes("src="));
assert.equal(scripts.length,2);
new vm.Script(scripts[1][1]);
new vm.Script(runner);
new vm.Script(animation,{filename:"animation-runner.js"});
for(const id of ["code","bindings","run-gpu","close-playground","compile-status","gpu-output"]) {
    assert.ok(html.includes('id="'+id+'"'),"Missing DOM element: "+id);
}
assert.ok(runner.includes("/api/compile"));
assert.ok(runner.includes("/api/session/") && runner.includes('sessionCall("open")'));
assert.ok(html.includes('href="README.md"'), "Workbench must link to setup instructions.");
const docs=await readFile(root+"README.md","utf8");
assert.ok(docs.includes("Start-HLSL-Playground.cmd"), "Setup guide must identify the Windows launcher.");
for(const id of ["wgsl-code","wgsl-input","wgsl-output","wgsl-run","wgsl-reset"]) {
    assert.ok(html.includes('id="'+id+'"'),"Missing standalone GPU teaching control: "+id);
}
assert.ok(html.includes('src="browser-gpu.js"'));
assert.ok(html.includes('src="gpu-visualizer.js"'));
assert.ok(html.includes('src="hlsl-highlight.js"'),"HLSL syntax mirror script missing");
for(const filename of ["hlsl-docs-data.js","hlsl-fold-docs.js"]){
  assert.ok(html.includes('src="'+filename+'"'),"Missing local fold/documentation script: "+filename);
  assert.ok(html.indexOf('src="'+filename+'"')<html.indexOf('src="live-runner.js"'),
    "Fold help must initialize before the shader presets are loaded.");
}
assert.ok(html.indexOf('src="hlsl-docs-data.js"')<html.indexOf('src="hlsl-fold-docs.js"'),
  "HLSL help data must load before hover/fold logic.");
for(const id of ["code-sections","toggle-code-sections","fold-all","unfold-all",
  "hlsl-help-tooltip","hlsl-help-title","hlsl-help-what","hlsl-help-does",
  "hlsl-help-use","hlsl-help-example","hlsl-help-link"]){
  assert.ok(html.includes('id="'+id+'"'),"Missing fold or hover control "+id);
}
assert.ok(docsPage.includes('src="hlsl-docs-data.js"'));
assert.ok(docsPage.includes('id="reference-list"'));
assert.ok(docsData.includes('"float4"')&&docsData.includes('"numthreads"')&&
  docsData.includes('"RWStructuredBuffer"'));
assert.ok(folds.includes("source.dispatchEvent(new Event("),
  "Chunk edits must update canonical source and notify the compile runner.");

assert.ok(html.includes('src="animation-runner.js"'),"Continuous GPU scheduler script missing");
assert.ok(html.indexOf('src="live-runner.js"')<html.indexOf('src="animation-runner.js"'),
  "Base runner API must be initialized before continuous mode");
for(const id of ["example-julia","animate-gpu","pause-gpu","step-gpu","reset-gpu",
  "animation-fps","animation-frames","animation-time","viz-coverage-label"]){
  assert.ok(html.includes('id="'+id+'"'),"Missing continuous GPU control: "+id);
}
assert.ok(runner.includes("window.HLSLRunnerAPI="),"Animation engine needs reusable HLSL compilation helpers.");
assert.ok(animation.includes("requestAnimationFrame"),"Animation must schedule real frames.");
assert.ok(animation.includes("queue.submit"),"Animation must submit GPU commands on repeated frames.");

assert.ok(html.indexOf('src="hlsl-highlight.js"')<html.indexOf('src="live-runner.js"'),"Highlighter must load before preset initialization");
assert.ok(html.includes('href="workbench.css"'),"Missing workbench styles.");
assert.ok(html.indexOf('src="gpu-visualizer.js"')<html.indexOf('src="live-runner.js"'),
  "The GPU visualization must load before the runner initializes the circle preset.");
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
assert.equal(ids.length,new Set(ids).size,"Duplicate HTML IDs route data to the wrong inspector.");
assert.equal(ids.filter(id=>id==="wgsl-output").length,1);
assert.ok(ids.includes("generated-wgsl"),"Generated WGSL needs its own dedicated panel.");
assert.ok(html.includes('id="gpu-visual" width="640" height="640"'),"GPU chart must have square native resolution.");
assert.ok(html.includes('class="workspace-grid"'),"Editor and preview should form one focused workbench.");
const presetLoop=runner.match(/for\(const id of \[(.*?)\]\)\s*\$\(id\)\.setAttribute\("aria-pressed"/s);
assert.ok(presetLoop,"Active-preset UI code missing.");
const declaredPresetIds=[...presetLoop[1].matchAll(/"([^"]+)"/g)].map(x=>x[1]);
for(const id of declaredPresetIds){
  assert.ok(ids.includes(id),"CRITICAL: setActivePreset accesses missing DOM element "+id);
}
assert.ok(ids.includes("restore-example"),"GPU particle preset must use its real DOM ID.");
assert.ok(!declaredPresetIds.includes("example-rgba-particles"),
  "Never use nonexistent example-rgba-particles button in startup initializer.");

assert.ok(html.includes('id="code-highlight"'),"Syntax mirror element missing");
assert.ok(html.includes('id="code-highlight-content"'),"Syntax coloring content missing");
assert.ok(css.includes(".tok-keyword")&&css.includes(".tok-identifier")&&css.includes(".tok-number"),"Token palette missing");
assert.ok(css.includes("caret-color")&&css.includes("-webkit-text-fill-color:transparent"),"Native editor cursor/highlighting overlay missing");
assert.ok(!html.includes('class="empty-graphic" aria-hidden="true"></div>'),"Old plus-sign empty state must not be retained");
assert.ok(html.includes("Run to preview output"),"Empty state needs an actionable title");
assert.ok(css.includes('content:"▸"')&&css.includes('content:"▾"'),"Disclosure chevrons must replace add/remove symbols");
assert.ok(html.includes('<details id="debug-output-panel">'),"Raw output must be secondary, not the main result.");
assert.ok(html.indexOf('id="code"')<html.indexOf('id="scene"'),"HLSL compute must precede the simulation lab.");
assert.ok(css.includes(".workspace-grid")&&css.includes("@media(max-width:850px)"),
  "Responsive layout rules required.");
assert.ok(runner.includes('e.key==="Enter"'),"Keyboard shortcut must be available.");
assert.ok(html.includes('id="example-circle"'),"Missing circle-mask preset.");
for(const id of ["gpu-visual-panel","gpu-visual","gpu-visual-summary","gpu-visual-legend"]) {
    assert.ok(html.includes('id="'+id+'"'),"Missing GPU result visualization element: "+id);
}
assert.ok(runner.includes('window.HLSLGPUVisualize.render(preview)'),"GPU buffer readback must be plotted.");
assert.ok(runner.includes('&&!isMaskShader'),"Mask outputs must not overwrite particle velocities.");
assert.ok(runner.includes('preset:"grid"'),"Circle preset needs real 2D input sample grid.");

assert.ok(html.includes('id="run-gpu" class="primary" type="button">Compile &amp; Run HLSL'),"HLSL compile/run button must be enabled.");
console.log("PASS: workbench layout, unique output IDs, keyboard shortcut, browser GPU lab and HLSL runner");
