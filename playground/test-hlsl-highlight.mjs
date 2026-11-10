// Pure frontend checks: syntax colors preserve source and native text editing.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import vm from "node:vm";
const script=await readFile(fileURLToPath(new URL("./hlsl-highlight.js",import.meta.url)),"utf8");
const listeners={};
const editor={
  value:"#define COUNT 64\ncbuffer Params : register(b0) {\n  float4 Color;\n};\n// <script>alert(1)</script>\n[numthreads(64, 1, 1)]\nvoid CSMain(uint3 tid : SV_DispatchThreadID) {\n  float mask = smoothstep(0.1, 0.8, length(Color.xy));\n  Output[tid.x] = float4(mask, 0, 0, 1);\n}",
  scrollTop:10,scrollLeft:4,
  addEventListener:(event,cb)=>{listeners[event]=cb}
};
const mirror={scrollTop:0,scrollLeft:0},display={innerHTML:""};
const window={};
vm.runInNewContext(script,{
  document:{getElementById:id=>({
    code:editor,"code-highlight":mirror,"code-highlight-content":display
  })[id]},
  window,requestAnimationFrame:cb=>cb()
});
const highlighter=window.HLSLHighlight;
assert.ok(highlighter,"Highlight API unavailable");
const html=display.innerHTML;
for(const tag of ["tok-preprocessor","tok-comment","tok-type","tok-resource","tok-number","tok-function","tok-identifier","tok-semantic","tok-keyword","tok-builtin"]){
  assert.ok(html.includes('class="'+tag+'"'),"Expected "+tag+" in highlighted HLSL");
}
assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"),
  "User source must be HTML-escaped: never execute HLSL as HTML");
assert.ok(!html.includes("<script>"),"Raw script tag must not be inserted into the mirror");
assert.equal(mirror.scrollTop,10);
assert.equal(mirror.scrollLeft,4);
editor.scrollTop=92;editor.scrollLeft=27;
listeners.scroll();
assert.equal(mirror.scrollTop,92);
assert.equal(mirror.scrollLeft,27);
editor.value="// new code\nfloat4 other = float4(1.0,2.0,3.0,4.0);";
listeners.input();
assert.ok(display.innerHTML.includes("new code"),"Editing must update the mirror");
assert.ok(display.innerHTML.includes("tok-number"));
editor.value="float4 cloned = float4(0.2, 0.5, 0.8, 1);";
highlighter.refresh();
assert.ok(display.innerHTML.includes("cloned"),"Programmatic preset changes must refresh");
console.log("PASS HLSL syntax tokens, escaped source, native editor syncing and scrolling");
