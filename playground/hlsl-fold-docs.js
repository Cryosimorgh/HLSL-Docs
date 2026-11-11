// VS Code-style, in-editor HLSL folding with an offline CodeMirror 5 editor.
// No secondary cards or per-chunk textareas. Collapsing is a view operation:
// the same full #code source always feeds DXC, export, and animation.
// CodeMirror 5.65.21 and addons are shipped locally (MIT).
(() => {
  "use strict";
  const $=id=>document.getElementById(id);
  const source=$("code"),frame=document.querySelector(".editor-frame");
  const foldAllButton=$("fold-all"),unfoldAllButton=$("unfold-all");
  const tooltip=$("hlsl-help-tooltip"),docs=window.HLSLDocs;
  const CM=window.CodeMirror;
  if(!source||!frame||!docs||!tooltip)return;
  if(!CM||typeof CM.fromTextArea!=="function"||typeof CM.prototype?.foldCode!=="function"){
    // Source checkout without vendored editor: leave the native textarea usable
    // rather than displaying inert folding controls or hiding the shader.
    if(foldAllButton)foldAllButton.hidden=true;
    if(unfoldAllButton)unfoldAllButton.hidden=true;
    console.warn("Offline CodeMirror assets unavailable; native HLSL editor remains editable.");
    return;
  }
  const help={
    title:$("hlsl-help-title"),what:$("hlsl-help-what"),
    does:$("hlsl-help-does"),use:$("hlsl-help-use"),
    example:$("hlsl-help-example"),link:$("hlsl-help-link")
  };
  const types=/^(?:void|bool|int|uint|half|float|double|min16float|min16int|min16uint)(?:[1-4](?:x[1-4])?)?$/;
  const resources=/^(?:(?:RW)?StructuredBuffer|(?:RW)?ByteAddressBuffer|ConstantBuffer|(?:RW)?Texture\w*|Sampler\w*)$/;
  CM.defineMode("hlsl",cfg=>{
    const cpp=CM.getMode(cfg,"text/x-c++src");
    return {
      startState:()=>CM.startState(cpp),
      copyState:state=>CM.copyState(cpp,state),
      token(stream,state){
        const cls=cpp.token(stream,state),token=stream.current();
        if(cls==="comment"||cls==="string")return cls;
        if(resources.test(token))return "variable-2";
        if(types.test(token))return "type";
        if(/^SV_\w+$/.test(token))return "atom";
        if(/^#[a-z]/i.test(token))return "meta";
        if(docs.get(token)&&!/^\s/.test(token))return "builtin";
        return cls;
      },
      indent:cpp.indent?.bind(cpp),
      electricChars:cpp.electricChars
    };
  });

  // Fold on a function/control/declaration line, even when the opening brace
  // is placed on its next line. Never fold an arbitrary #define or a single
  // line and never rewrite the source while folding.
  const header=/^\s*(?:(?:cbuffer|tbuffer|struct|namespace|class)\b|(?:(?:(?:static|inline|const|precise)\s+)*(?:void|float\d?(?:x\d)?|half\d?|uint\d?|int\d?|bool\d?|double\d?)\s+[A-Za-z_]\w*\s*\()|(?:if|for|while|else|switch|do)\s*(?:\(|\{|\b)|\{)/;
  function strippedLines(cm){
    const lines=[],state={block:false};
    for(let i=0;i<cm.lineCount();i++){
      const raw=cm.getLine(i),characters=raw.split("");
      let quote="",single=false;
      for(let j=0;j<characters.length;j++){
        const c=characters[j],n=characters[j+1];
        if(state.block){
          characters[j]=" ";
          if(c==="*"&&n==="/"){characters[++j]=" ";state.block=false;}
        }else if(quote){
          characters[j]=" ";
          if(c==="\\"){if(j+1<characters.length)characters[++j]=" ";}
          else if(c===quote)quote="";
        }else if(c==="/"&&n==="*"){
          characters[j]=" ";
          if(j+1<characters.length)characters[++j]=" ";
          state.block=true;
        }else if(c==="/"&&n==="/"){
          characters.fill(" ",j);break;
        }else if(c==='"'||c==="'"){quote=c;characters[j]=" ";}
      }
      lines.push(characters.join(""));
    }
    return lines;
  }
  let scanCache={gen:-1,lines:[]};
  function getScan(cm){
    const gen=cm.changeGeneration();
    if(scanCache.gen!==gen){
      scanCache={gen,lines:strippedLines(cm)};
    }
    return scanCache.lines;
  }
  function rangeFinder(cm,start){
    const raw=cm.getLine(start.line)||"";
    const clean=getScan(cm);
    const headerLine=clean[start.line]||"";
    if(!header.test(headerLine))return null;
    let openLine=-1,openCol=-1;
    for(let n=start.line;n<Math.min(start.line+3,cm.lineCount());n++){
      const value=clean[n]||"";
      const pos=value.indexOf("{");
      if(pos>=0){openLine=n;openCol=pos;break;}
      if(n>start.line&&value.trim()!==""&&value.trim()!=="{")break;
    }
    if(openLine<0)return null;
    let depth=0;
    for(let n=openLine;n<cm.lineCount();n++){
      const value=clean[n];
      for(let p=n===openLine?openCol:0;p<value.length;p++){
        const char=value[p];
        if(char==="{")depth++;
        else if(char==="}"&&--depth===0){
          if(n<=start.line)return null;
          return {from:CM.Pos(start.line,raw.length),to:CM.Pos(n,p+1)};
        }
      }
    }
    return null;
  }

  // Passive documentation must never chase the mouse or interrupt scrolling.
  // Wait until the pointer has rested on a symbol; explicit F1/right-click pin
  // stays immediate. A scroll also requires a fresh deliberate hover.
  const hoverDelayMs=800, scrollQuietMs=1000;
  let activeKey="",cm,pinned=false,hideTimer=0,hoverTimer=0;
  let selecting=false,tooltipSelecting=false,scrollQuietUntil=0;
  const pinState=$("hlsl-help-pin-state");
  function cancelHover(){
    if(hoverTimer){clearTimeout(hoverTimer);hoverTimer=0;}
  }
  function cancelHide(){if(hideTimer){clearTimeout(hideTimer);hideTimer=0;}}
  function hide(force=false){
    if(pinned&&!force)return;
    cancelHover();cancelHide();
    tooltip.hidden=true;activeKey="";
    if(force)pinned=false;
    if(pinState)pinState.textContent="Hover 0.8s or right-click to pin";
  }
  function scheduleHide(){
    if(pinned||tooltipSelecting)return;
    cancelHover();cancelHide();
    hideTimer=setTimeout(()=>{
      hideTimer=0;
      if(!tooltipSelecting&&!tooltip.matches(":hover"))hide();
    },350);
  }
  function show(item,clientX,clientY,pin=false){
    if(!item){scheduleHide();return;}
    if(pinned&&!pin)return;
    cancelHover();cancelHide();
    if(pin)pinned=true;
    if(pinState)pinState.textContent=pinned?"Pinned · Esc or × to close":"Hover 0.8s or right-click to pin";
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
    const w=tooltip.offsetWidth||340,h=tooltip.offsetHeight||240;
    const left=Math.max(8,Math.min(clientX+14,window.innerWidth-w-8));
    const top=clientY+h+18>window.innerHeight?
      Math.max(8,clientY-h-14):clientY+18;
    tooltip.style.left=left+"px";tooltip.style.top=top+"px";
  }
  function queueHover(item,x,y){
    // Every movement restarts the dwell timer. Changing symbols before it
    // fires never opens a popup. Keep an existing popup during the brief
    // pointer journey into it so links/text remain reachable.
    cancelHover();cancelHide();
    if(selecting||performance.now()<scrollQuietUntil)return;
    hoverTimer=setTimeout(()=>{
      hoverTimer=0;
      if(!pinned&&!selecting&&performance.now()>=scrollQuietUntil)
        show(item,x,y);
    },hoverDelayMs);
  }
  function interruptForScroll(){
    scrollQuietUntil=performance.now()+scrollQuietMs;
    cancelHover();
    hide(); // Pinned documentation remains available while scrolling.
  }
  function wordAt(cm,pos){
    const line=cm.getLine(pos.line);
    if(!line)return null;
    let word;
    for(const match of line.matchAll(/[A-Za-z_]\w*/g)){
      if(match.index<=pos.ch&&pos.ch<match.index+match[0].length){
        word=match[0];break;
      }
    }
    // Prevent misleading docs when the token belongs to a comment or string.
    if(!word)return null;
    const style=cm.getTokenTypeAt({line:pos.line,ch:pos.ch+1})||"";
    if(/\b(?:comment|string)\b/.test(style))return null;
    return docs.get(word);
  }
  function showAtCursor(editor){
    const pos=editor.getCursor(),item=wordAt(editor,pos);
    if(!item)return;
    const coords=editor.charCoords(pos,"window");
    show(item,coords.left,coords.bottom,true);
  }
  cm=CM.fromTextArea(source,{
    mode:"hlsl",lineNumbers:true,lineWrapping:false,
    tabSize:4,indentUnit:4,indentWithTabs:false,
    styleActiveLine:false,
    gutters:["CodeMirror-foldgutter","CodeMirror-linenumbers"],
    foldGutter:true,
    foldOptions:{rangeFinder,widget:"…"},
    viewportMargin:10,
    extraKeys:{
      "Ctrl-Enter":()=>{ $("run-gpu")?.click(); },
      "Cmd-Enter":()=>{ $("run-gpu")?.click(); },
      "F1":editor=>showAtCursor(editor),
      "Ctrl-Alt-[":editor=>editor.foldCode(editor.getCursor(),null,"fold"),
      "Ctrl-Alt-]":editor=>editor.foldCode(editor.getCursor(),null,"unfold")
    }
  });
  frame.classList.add("has-codemirror");
  const originalMirror=$("code-highlight");
  if(originalMirror)originalMirror.hidden=true;
  cm.setSize("100%","100%");

  // Keep the existing #code as the single canonical HLSL source.
  // CodeMirror edits are copied back immediately (not just at form submit).
  let syncing=false;
  cm.on("change",editor=>{
    if(syncing)return;
    const value=editor.getValue();
    if(source.value===value)return;
    source.value=value;
    source.dataset.dirty="1";
    source.dispatchEvent(new Event("input",{bubbles:true}));
  });
  function refresh(){
    if(cm.getValue()===source.value)return;
    syncing=true;
    const selection=cm.getCursor();
    cm.setValue(source.value);
    cm.setCursor(Math.min(selection.line,cm.lastLine()),selection.ch);
    syncing=false;
  }
  const highlighter=window.HLSLHighlight;
  if(highlighter){
    const original=highlighter.refresh;
    highlighter.refresh=function(...args){
      const outcome=original?.(...args);
      refresh();
      return outcome;
    };
  }
  source.addEventListener("input",refresh);
  function foldAll(){
    cm.operation(()=>{
      for(let line=cm.lastLine();line>=0;line--){
        if(rangeFinder(cm,CM.Pos(line,0))){
          cm.foldCode(CM.Pos(line,0),{rangeFinder,widget:"…"},"fold");
        }
      }
    });
    cm.focus();
  }
  function unfoldAll(){
    cm.operation(()=>{
      for(const mark of cm.getAllMarks()){
        if(mark.__isFold)mark.clear();
      }
    });
    cm.focus();
  }
  foldAllButton?.addEventListener("click",foldAll);
  unfoldAllButton?.addEventListener("click",unfoldAll);
  const wrapper=cm.getWrapperElement();
  wrapper.addEventListener("mousemove",event=>{
    if(pinned)return;
    // Mouse-down selection, scrollbar dragging, wheel scrolling and rapid
    // pointer movement should never cause the reference popup to appear.
    if(selecting||event.buttons||performance.now()<scrollQuietUntil){
      cancelHover();hide();return;
    }
    if(event.target.closest?.(".CodeMirror-gutters")){
      scheduleHide();return;
    }
    const pos=cm.coordsChar({left:event.clientX,top:event.clientY},"window");
    const item=wordAt(cm,pos);
    if(!item){scheduleHide();return;}
    if(!tooltip.hidden&&activeKey===item.key){
      cancelHover();cancelHide();return;
    }
    queueHover(item,event.clientX,event.clientY);
  });
  wrapper.addEventListener("mouseleave",event=>{
    cancelHover();
    if(tooltip.contains(event.relatedTarget)){cancelHide();return;}
    scheduleHide();
  });
  wrapper.addEventListener("pointerdown",event=>{
    cancelHover();
    if(event.button!==2){
      selecting=true;
      hide();
    }
  });
  document.addEventListener("pointerup",()=>{
    selecting=false;
    if(tooltipSelecting){
      tooltipSelecting=false;
      if(!tooltip.matches(":hover"))scheduleHide();
    }
  });
  // Right-click is an explicit request: open immediately, without waiting.
  wrapper.addEventListener("contextmenu",event=>{
    if(event.target.closest?.(".CodeMirror-gutters"))return;
    const pos=cm.coordsChar({left:event.clientX,top:event.clientY},"window");
    const item=wordAt(cm,pos);
    if(!item)return; // Normal browser context menu for unknown symbols.
    event.preventDefault();event.stopPropagation();
    show(item,event.clientX,event.clientY,true);
  });
  tooltip.addEventListener("mouseenter",()=>{cancelHover();cancelHide();});
  tooltip.addEventListener("mouseleave",()=>{
    if(!tooltipSelecting)scheduleHide();
  });
  tooltip.addEventListener("pointerdown",()=>{
    tooltipSelecting=true;cancelHide();
  });
  tooltip.addEventListener("contextmenu",event=>{
    event.preventDefault();event.stopPropagation();
    if(!tooltip.hidden){pinned=true;cancelHover();cancelHide();
      if(pinState)pinState.textContent="Pinned · Esc or × to close";}
  });
  $("hlsl-help-close")?.addEventListener("click",()=>hide(true));
  document.addEventListener("pointerdown",event=>{
    if(pinned&&!tooltip.contains(event.target)&&
       !wrapper.contains(event.target))hide(true);
  },true);
  document.addEventListener("wheel",event=>{
    if(!tooltip.contains(event.target))interruptForScroll();
  },{capture:true,passive:true});
  window.addEventListener("scroll",interruptForScroll,{passive:true});
  cm.on("scroll",interruptForScroll);
  cm.on("cursorActivity",()=>{
    cancelHover();scheduleHide();
  });
  document.addEventListener("keydown",event=>{if(event.key==="Escape")hide(true);});
  window.addEventListener("blur",()=>hide(true));
  window.HLSLFoldDocs={
    editor:cm,refresh,foldAll,unfoldAll,
    showHelp:key=>{const item=docs.get(key);if(item)show(item,160,100,true);return !!item;},
    get helpPinned(){return pinned;},
    dismissHelp:()=>hide(true),
    getFoldRange:line=>rangeFinder(cm,CM.Pos(line,0))
  };
  refresh();
})();