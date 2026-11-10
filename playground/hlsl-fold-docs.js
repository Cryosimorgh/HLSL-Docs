// Dependency-free code folding and contextual HLSL help.
// Canonical compiled text stays in #code. Folding is a view over that source.
// User edits in section textareas update the same canonical source byte-for-byte.
// Docs and example snippets are text nodes; shader input never becomes HTML.
(() => {
  "use strict";
  const $=id=>document.getElementById(id);
  const source=$("code"), frame=document.querySelector(".editor-frame"),
    view=$("code-sections"), toggle=$("toggle-code-sections"),
    foldAll=$("fold-all"), unfoldAll=$("unfold-all"), tooltip=$("hlsl-help-tooltip");
  const docs=window.HLSLDocs;
  if(!source||!frame||!view||!toggle||!tooltip||!docs)return;
  let sections=[],inSectionEdit=false,folding=false,activeKey="";
  const help={
    title:$("hlsl-help-title"),what:$("hlsl-help-what"),
    does:$("hlsl-help-does"),use:$("hlsl-help-use"),
    example:$("hlsl-help-example"),link:$("hlsl-help-link")
  };

  // Count braces outside strings/comments. Folding never changes shader text.
  function cleanLine(line,state){
    let cleaned="",quote=null;
    for(let j=0;j<line.length;j++){
      const c=line[j],n=line[j+1];
      if(state.block){
        if(c==="*"&&n==="/"){state.block=false;cleaned+="  ";j++;}
        else cleaned+=" ";
      }else if(quote){
        if(c==="\\"){cleaned+="  ";j++;}
        else if(c===quote){quote=null;cleaned+=" ";}
        else cleaned+=" ";
      }else if(c==="/"&&n==="*"){
        state.block=true;cleaned+="  ";j++;
      }else if(c==="/"&&n==="/"){
        cleaned+= " ".repeat(line.length-j);break;
      }else if(c==='"'||c==="'"){quote=c;cleaned+=" ";}
      else cleaned+=c;
    }
    return cleaned;
  }
  function beginsChunk(line){
    const s=line.trim();
    return /^#\s*(?:define|include|if|elif|else|endif|pragma|undef)\b/.test(s)
      || /^(?:cbuffer|tbuffer|struct|typedef)\b/.test(s)
      || /^(?:(?:RW)?StructuredBuffer|(?:RW)?ByteAddressBuffer|ConstantBuffer|(?:RW)?Texture\w*|Sampler\w*)\b/.test(s)
      || /^\[\s*(?:numthreads|loop|unroll|branch|flatten)\b/.test(s)
      || /^(?:(?:static|inline|const|precise)\s+)*(?:void|float\d?(?:x\d)?|half\d?|uint\d?|int\d?|bool\d?|double\d?)\s+[A-Za-z_]\w*\s*\(/.test(s);
  }
  function labelFor(block,index){
    const lines=block.split(/\r?\n/);
    const useful=lines.map(l=>l.trim()).filter(l=>l&&!l.startsWith("//")&&!l.startsWith("/*")&&!l.startsWith("*"));
    const first=useful[0]||"Comments / declarations";
    if(/^\[\s*numthreads/.test(first)){
      const fn=useful.find(l=>/\b(?:void|float\d?|uint|int)\s+\w+\s*\(/.test(l));
      return fn?fn.replace(/\s*\{.*/,"").slice(0,92):"Compute entry point";
    }
    return first.replace(/\s*\{.*/,"").replace(/;\s*$/,"").slice(0,92);
  }
  function splitSource(text){
    const lines=text.match(/[^\n]*\n|[^\n]+$/g)||[""];
    const starts=[0];let depth=0;
    const st={block:false};
    for(let i=0;i<lines.length;i++){
      const raw=lines[i];
      const cleaned=cleanLine(raw,st);
      if(i>0&&depth===0&&beginsChunk(cleaned)&&i!==starts[starts.length-1])
        starts.push(i);
      for(const c of cleaned){
        if(c==="{")depth++;
        else if(c==="}")depth=Math.max(0,depth-1);
      }
    }
    const result=[];
    for(let j=0;j<starts.length;j++){
      const first=starts[j],last=(starts[j+1]??lines.length);
      const snippet=lines.slice(first,last).join("");
      result.push({label:labelFor(snippet,j),line:first+1,lines:last-first,text:snippet});
    }
    return result;
  }
  const TOKEN=/(?:\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|^[ \t]*#[^\r\n]*|"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|\b(?:0[xX][\da-fA-F]+|[0-9]+(?:\.[0-9]*)?(?:[eE][-+]?\d+)?[fFuU]?)\b|[A-Za-z_]\w*|[^\w])/gm;
  const keyword=/^(?:if|else|for|while|return|struct|cbuffer|const|static|break|continue|true|false)$/;
  const type=/^(?:float|float[2-4]|float[2-4]x[2-4]|half|int|int[2-4]|uint|uint[2-4]|bool|void)$/;
  const resource=/^(?:RWStructuredBuffer|StructuredBuffer|RWByteAddressBuffer|ByteAddressBuffer|ConstantBuffer)$/;
  function decorateCode(pre,text){
    pre.replaceChildren();
    let last=0,m;
    TOKEN.lastIndex=0;
    while((m=TOKEN.exec(text))){
      if(m.index>last)pre.append(document.createTextNode(text.slice(last,m.index)));
      const raw=m[0],item=docs.get(raw);
      let klass="";
      if(/^\/\/|^\/\*/.test(raw))klass="tok-comment";
      else if(/^\s*#/.test(raw))klass="tok-preprocessor";
      else if(/^["']/.test(raw))klass="tok-string";
      else if(/^(?:\d|\.\d)/.test(raw))klass="tok-number";
      else if(keyword.test(raw))klass="tok-keyword";
      else if(type.test(raw))klass="tok-type";
      else if(resource.test(raw))klass="tok-resource";
      else if(/^SV_/.test(raw))klass="tok-semantic";
      else if(item)klass="tok-builtin";
      if(klass||item){
        const span=document.createElement("span");
        span.className=klass+(item?" doc-term":"");
        if(item){span.dataset.hlslDoc=item.key;span.tabIndex=0;}
        span.textContent=raw;pre.append(span);
      }else pre.append(document.createTextNode(raw));
      last=m.index+raw.length;
    }
    if(last<text.length)pre.append(document.createTextNode(text.slice(last)));
  }

  function show(item,x,y){
    if(!item)return hide();
    if(activeKey!==item.key){
      activeKey=item.key;
      help.title.textContent=item.title+" · "+item.key;
      help.what.textContent=item.what;
      help.does.textContent=item.does;
      help.use.textContent=item.use;
      help.example.textContent=item.example;
      help.link.href="hlsl-reference.html#"+encodeURIComponent(item.key);
    }
    tooltip.hidden=false;
    const width=tooltip.offsetWidth||330,height=tooltip.offsetHeight||230;
    const left=Math.max(8,Math.min(x+15,window.innerWidth-width-9));
    let top=y+18;
    if(top+height>window.innerHeight-8)top=y-height-12;
    tooltip.style.left=Math.round(left)+"px";
    tooltip.style.top=Math.max(8,Math.round(top))+"px";
  }
  function hide(){
    tooltip.hidden=true;
    activeKey="";
  }

  // Approximate monospace hit testing over the transparent native textarea.
  // It leaves selection, composition, input handling and IME entirely native.
  let charWidth=8,lineHeight=23;
  function measure(){
    const css=getComputedStyle(source),canvas=document.createElement("canvas");
    const ctx=canvas.getContext("2d");
    if(ctx){ctx.font=css.font;charWidth=ctx.measureText("M").width||8;}
    lineHeight=parseFloat(css.lineHeight)||23;
  }
  function hoveredWord(e){
    const rect=source.getBoundingClientRect();
    const css=getComputedStyle(source);
    const x=e.clientX-rect.left+source.scrollLeft-parseFloat(css.paddingLeft||"0");
    const y=e.clientY-rect.top+source.scrollTop-parseFloat(css.paddingTop||"0");
    if(x<0||y<0)return null;
    const lines=source.value.split("\n");
    const row=Math.floor(y/lineHeight);
    if(row<0||row>=lines.length)return null;
    const line=lines[row],col=Math.floor(x/charWidth);
    if(col<0||col>=line.length)return null;
    const comment=line.indexOf("//");
    if(comment>=0&&col>=comment)return null;
    const pattern=/[A-Za-z_]\w*/g;let m;
    while((m=pattern.exec(line))){
      if(col>=m.index&&col<m.index+m[0].length)return docs.get(m[0]);
    }
    return null;
  }
  source.addEventListener("mousemove",e=>{
    const item=hoveredWord(e);
    if(item)show(item,e.clientX,e.clientY);else hide();
  });
  source.addEventListener("mouseleave",e=>{
    if(!tooltip.contains(e.relatedTarget))hide();
  });
  source.addEventListener("keydown",e=>{
    if(e.key!=="F1"){hide();return;}
    const i=source.selectionStart,txt=source.value;
    let a=i,b=i;
    while(a>0&&/\w/.test(txt[a-1]))a--;
    while(b<txt.length&&/\w/.test(txt[b]))b++;
    const item=docs.get(txt.slice(a,b));
    if(item){e.preventDefault();const rect=source.getBoundingClientRect();
      show(item,rect.left+Math.min(rect.width/2,200),rect.top+75);}
  });
  source.addEventListener("scroll",hide,{passive:true});
  view.addEventListener("mouseover",e=>{
    const term=e.target.closest?.("[data-hlsl-doc]");
    if(term){const item=docs.get(term.dataset.hlslDoc);
      show(item,e.clientX,e.clientY);}
  });
  view.addEventListener("mouseout",e=>{
    if(!e.relatedTarget?.closest?.("[data-hlsl-doc]")&&
       !tooltip.contains(e.relatedTarget))hide();
  });
  view.addEventListener("focusin",e=>{
    const term=e.target.closest?.("[data-hlsl-doc]");
    if(term){const rect=term.getBoundingClientRect();
      show(docs.get(term.dataset.hlslDoc),rect.left,rect.bottom);}
  });
  view.addEventListener("focusout",e=>{
    if(!tooltip.contains(e.relatedTarget))hide();
  });
  tooltip.addEventListener("mouseleave",hide);
  document.addEventListener("keydown",e=>{if(e.key==="Escape")hide();});
  window.addEventListener("blur",hide);

  function renderSections(){
    const prior=new Map(sections.map(s=>[s.label,s.node?.open]));
    sections=splitSource(source.value);
    const frag=document.createDocumentFragment();
    let index=0;
    for(const block of sections){
      const details=document.createElement("details");
      details.className="code-section";
      details.open=prior.has(block.label)?prior.get(block.label):
        (/CSMain\s*\(|FractalColor\s*\(/.test(block.label));
      const summary=document.createElement("summary");
      const name=document.createElement("span");name.className="section-name";
      name.textContent=block.label;
      const lines=document.createElement("span");
      lines.className="section-lines";
      lines.textContent="Line "+block.line+" · "+block.lines+" lines";
      summary.append(name,lines);
      const body=document.createElement("div");
      body.className="section-body";
      const pre=document.createElement("pre");
      pre.className="section-code";
      decorateCode(pre,block.text);
      const editButton=document.createElement("button");
      editButton.type="button";editButton.className="minor-button section-edit-button";
      editButton.textContent="Edit section";
      const chunkEditor=document.createElement("textarea");
      chunkEditor.className="section-editor";
      chunkEditor.spellcheck=false;chunkEditor.autocapitalize="off";
      chunkEditor.value=block.text;
      chunkEditor.hidden=true;
      chunkEditor.setAttribute("aria-label","Edit "+block.label);
      chunkEditor.rows=Math.min(24,Math.max(4,block.lines+1));
      editButton.addEventListener("click",()=>{
        chunkEditor.hidden=!chunkEditor.hidden;
        pre.hidden=!chunkEditor.hidden;
        editButton.textContent=chunkEditor.hidden?"Edit section":"Show highlighted view";
        if(!chunkEditor.hidden)chunkEditor.focus();
        else decorateCode(pre,block.text);
      });
      chunkEditor.addEventListener("input",()=>{
        block.text=chunkEditor.value;
        inSectionEdit=true;
        source.value=sections.map(s=>s.text).join("");
        source.dataset.dirty="1";
        source.dispatchEvent(new Event("input",{bubbles:true}));
        inSectionEdit=false;
      });
      body.append(editButton,pre,chunkEditor);
      details.append(summary,body);
      block.node=details;
      frag.append(details);
      index++;
    }
    view.replaceChildren(frag);
  }
  function refresh(){
    if(inSectionEdit)return;
    if(folding)renderSections();
  }
  function toggleView(force){
    folding=typeof force==="boolean"?force:!folding;
    frame.hidden=folding;
    view.hidden=!folding;
    toggle.setAttribute("aria-pressed",String(folding));
    toggle.textContent=folding?"Full editor":"Code sections";
    foldAll.hidden=!folding;
    unfoldAll.hidden=!folding;
    hide();
    if(folding){renderSections();view.scrollTop=0;}
  }
  toggle.addEventListener("click",()=>toggleView());
  foldAll.addEventListener("click",()=>{
    for(const block of sections)block.node.open=false;
  });
  unfoldAll.addEventListener("click",()=>{
    for(const block of sections)block.node.open=true;
  });
  // Preset source writes call HLSLHighlight.refresh(). Hook it without
  // changing compilation or the existing editable source buffer.
  const original=window.HLSLHighlight?.refresh;
  if(original)window.HLSLHighlight.refresh=function(...args){
    const result=original(...args);
    refresh();
    return result;
  };
  source.addEventListener("input",refresh);
  measure();
  window.addEventListener("resize",measure);
  window.HLSLFoldDocs={splitSource,refresh,toggleView,get sections(){return sections;}};
  // Directly visible foldable chunks, not a simulated editor screenshot.
  toggleView(true);
})();