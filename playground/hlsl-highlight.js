// Lightweight, dependency-free HLSL syntax coloring for a native textarea.
// Highlight layer is visual only: the real textarea retains selections,
// IME composition, clipboard, undo/redo, keyboard handling and source text.
// No IntelliSense, code execution, network requests or HTML injection.
(() => {
  "use strict";
  const editor = document.getElementById("code");
  const mirror = document.getElementById("code-highlight");
  const display = document.getElementById("code-highlight-content");
  if (!editor || !mirror || !display) return;

  const kw = new Set(("if else for while do switch case default break continue " +
    "return discard struct cbuffer tbuffer typedef static const uniform volatile " +
    "groupshared in out inout true false namespace class").split(" "));
  const resource = new Set(("StructuredBuffer RWStructuredBuffer Buffer RWBuffer " +
    "Texture1D Texture2D Texture3D TextureCube RWTexture1D RWTexture2D " +
    "RWTexture3D SamplerState SamplerComparisonState ByteAddressBuffer " +
    "RWByteAddressBuffer ConstantBuffer AppendStructuredBuffer " +
    "ConsumeStructuredBuffer").split(" "));
  const builtin = new Set(("length distance dot cross normalize saturate clamp " +
    "lerp smoothstep step min max abs floor ceil round sqrt rsqrt pow exp exp2 " +
    "sin cos tan atan2 fmod frac sign mul transpose ddx ddy fwidth " +
    "asfloat asint asuint countbits firstbithigh InterlockedAdd " +
    "GroupMemoryBarrierWithGroupSync GetDimensions register numthreads").split(" "));
  const sem = /^SV_[A-Za-z0-9_]+$/;
  const types = /^(?:void|bool|int|uint|dword|half|float|double|min16float|min16int|min16uint)(?:[1-4](?:x[1-4])?)?$/;
  const escapes = s => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  const tokens = /\/\*[\s\S]*?(?:\*\/|(?![\s\S]))|\/\/[^\r\n]*|^[ \t]*#[^\r\n]*|"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|(?:0[xX][\da-fA-F]+|\b(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?[fFuUlL]?\b)|[A-Za-z_]\w*|[^\w]/gm;
  function classify(token, text, end, last) {
    if (token.startsWith("//") || token.startsWith("/*")) return "comment";
    if (/^[ \t]*#/.test(token)) return "preprocessor";
    if (token[0]==='"' || token[0]==="'") return "string";
    if (/^(?:0[xX][\da-fA-F]+|(?:\d|\.\d))/.test(token)) return "number";
    if (kw.has(token)) return "keyword";
    if (resource.has(token)) return "resource";
    if (types.test(token)) return "type";
    if (sem.test(token) || /^[tubs]\d+$/.test(token)) return "semantic";
    if (builtin.has(token)) return "builtin";
    if (/^[A-Za-z_]\w*$/.test(token)) {
      if (last === ".") return "property";
      if (text.slice(end).match(/^\s*\(/)) return "function";
      return "identifier";
    }
    if (/^[\[\](){};,.<>:=+\-*/%!&|^~?]+$/.test(token)) return "punctuation";
    return "";
  }
  function highlight(text) {
    tokens.lastIndex=0;
    let html="", match, last="", end=0, prev=0;
    while ((match=tokens.exec(text))) {
      // The regex includes a single-character fallback, so all text survives.
      const raw=match[0], start=match.index;
      if (start > prev) html+=escapes(text.slice(prev,start));
      const cls=classify(raw,text,start+raw.length,last);
      html+=cls?'<span class="tok-'+cls+'">'+escapes(raw)+'</span>':escapes(raw);
      if (!/^\s+$/.test(raw)) last=raw;
      end=start+raw.length; prev=end;
    }
    if (end<text.length) html+=escapes(text.slice(end));
    // Keep the last empty line visible at the same height as the textarea.
    return html + (text.endsWith("\n") ? " " : "\n");
  }
  function syncScroll() {
    mirror.scrollTop=editor.scrollTop;
    mirror.scrollLeft=editor.scrollLeft;
  }
  let scheduled=false;
  function refresh() {
    if (scheduled) return;
    scheduled=true;
    requestAnimationFrame(()=>{
      scheduled=false;
      display.innerHTML=highlight(editor.value);
      syncScroll();
    });
  }
  editor.addEventListener("input",refresh);
  editor.addEventListener("scroll",syncScroll,{passive:true});
  editor.addEventListener("compositionend",refresh);
  window.HLSLHighlight={highlight,refresh,syncScroll};
  refresh();
})();