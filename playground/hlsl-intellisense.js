// Offline HLSL completion + signature help for the existing CodeMirror editor.
// Deliberately lightweight: not a semantic compiler, language server or LSP.
// Suggestions come from a curated HLSL catalog and declarations in THIS source.
// All user-controlled text is rendered through textContent (never innerHTML).
(() => {
  "use strict";
  const docs=window.HLSLDocs;
  const CM=window.CodeMirror;
  const builtinSignatures={
    abs:"abs(x)",acos:"acos(x)",all:"all(x)",any:"any(x)",
    asfloat:"asfloat(x)",asint:"asint(x)",asuint:"asuint(x)",
    atan2:"atan2(y, x)",ceil:"ceil(x)",clamp:"clamp(x, minValue, maxValue)",
    cos:"cos(x)",cross:"cross(x, y)",ddx:"ddx(x)",ddy:"ddy(x)",
    distance:"distance(a, b)",dot:"dot(a, b)",exp:"exp(x)",exp2:"exp2(x)",
    floor:"floor(x)",fmod:"fmod(x, y)",frac:"frac(x)",fwidth:"fwidth(x)",
    lerp:"lerp(x, y, s)",length:"length(x)",log:"log(x)",log2:"log2(x)",
    max:"max(a, b)",min:"min(a, b)",mul:"mul(a, b)",
    normalize:"normalize(x)",pow:"pow(x, y)",reflect:"reflect(i, n)",
    round:"round(x)",rsqrt:"rsqrt(x)",saturate:"saturate(x)",
    sign:"sign(x)",sin:"sin(x)",smoothstep:"smoothstep(minValue, maxValue, x)",
    sqrt:"sqrt(x)",step:"step(edge, x)",tan:"tan(x)",
    transpose:"transpose(m)",GroupMemoryBarrierWithGroupSync:"GroupMemoryBarrierWithGroupSync()",
    InterlockedAdd:"InterlockedAdd(dest, value)",
    GetDimensions:"GetDimensions(count, stride)"
  };
  const keywordWords=("if else for while do switch case default break continue "+
    "return discard struct cbuffer tbuffer typedef const static inline "+
    "groupshared uniform volatile precise in out inout true false namespace "+
    "register numthreads loop unroll branch flatten").split(" ");
  const resources=("StructuredBuffer RWStructuredBuffer ByteAddressBuffer "+
    "RWByteAddressBuffer ConstantBuffer Buffer RWBuffer "+
    "Texture1D Texture2D Texture3D TextureCube RWTexture1D RWTexture2D "+
    "RWTexture3D SamplerState SamplerComparisonState "+
    "AppendStructuredBuffer ConsumeStructuredBuffer").split(" ");
  const baseTypes=["float","int","uint","bool","half","double","void","min16float",
    "min16int","min16uint"];
  const types=new Set(baseTypes);
  for(const base of ["float","int","uint","bool","half","double","min16float","min16int","min16uint"]){
    for(let n=2;n<=4;n++)types.add(base+n);
  }
  for(const base of ["float","int","uint","half","double"]){
    for(let x=2;x<=4;x++)for(let y=2;y<=4;y++)types.add(base+x+"x"+y);
  }
  const semanticWords=("SV_DispatchThreadID SV_GroupID SV_GroupIndex "+
    "SV_GroupThreadID SV_Position SV_Target SV_Target0 SV_Target1 "+
    "SV_VertexID SV_InstanceID SV_PrimitiveID SV_IsFrontFace "+
    "SV_Depth SV_DepthLessEqual SV_DepthGreaterEqual SV_SampleIndex "+
    "SV_Coverage SV_RenderTargetArrayIndex SV_ViewportArrayIndex").split(" ");
  const directives=["define","ifdef","ifndef","endif","else","elif","include","pragma","undef"];
  const registerWords=["b0","b1","b2","b7","t0","t1","t2","u0","u1","u2","s0","s1"];
  const kindRank={local:0,parameter:1,function:2,variable:3,macro:4,type:5,
    resource:6,intrinsic:7,semantic:8,keyword:9,directive:10,register:11,swizzle:0,method:2};
  const clean=s=>String(s||"").replace(/\/\*[\s\S]*?\*\//g,m=>m.replace(/[^\n]/g," "))
    .replace(/\/\/[^\r\n]*/g,m=>" ".repeat(m.length))
    .replace(/"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?/g,m=>m.replace(/[^\n]/g," "));
  function symbolMap(source){
    const text=clean(source).slice(0,131072);
    const results=new Map(),typesByName=new Map(),functions=new Map();
    function add(name,kind,type="",signature="",description=""){
      if(!/^[A-Za-z_]\w*$/.test(name)||name.length>128)return;
      if(!results.has(name)||kind==="function"){
        results.set(name,{name,kind,type,signature,description});
      }
      if(type)typesByName.set(name,type);
      if(signature)functions.set(name,signature);
    }
    let m;
    const macro=/^\s*#\s*define\s+([A-Za-z_]\w*)\b/gm;
    while((m=macro.exec(text)))add(m[1],"macro","","", "Defined by #define in this shader");
    const defs=/\b(?:struct|cbuffer|tbuffer)\s+([A-Za-z_]\w*)/g;
    while((m=defs.exec(text)))add(m[1],"type","","","Declared in this shader");
    const typePattern="(?:void|float(?:[1-4](?:x[1-4])?)?|int(?:[1-4](?:x[1-4])?)?|"+
      "uint(?:[1-4](?:x[1-4])?)?|half(?:[1-4](?:x[1-4])?)?|"+
      "bool(?:[1-4])?|double(?:[1-4](?:x[1-4])?)?|[A-Za-z_]\\w*)";
    // Functions: anchored to a return type and balanced-enough parameter list
    // for ordinary HLSL. Ignore macros, comments and obviously invalid tokens.
    const functionPattern=new RegExp("\\b("+typePattern+")\\s+([A-Za-z_]\\w*)\\s*\\(([^()]{0,350})\\)\\s*(?::\\s*[A-Za-z_]\\w*\\s*)?(?=\\{|\\n\\s*\\{)","g");
    while((m=functionPattern.exec(text))){
      const [_,returnType,name,args]=m;
      if(keywordWords.includes(name))continue;
      const signature=returnType+" "+name+"("+args.trim()+")";
      add(name,"function",returnType,signature,"Function defined in this shader");
      for(const part of args.split(",")){
        const p=part.match(/^\s*(?:(?:in|out|inout|const)\s+)*([A-Za-z_]\w*(?:<[^>]+>)?)\s+([A-Za-z_]\w*)\b/);
        if(p)add(p[2],"parameter",p[1],"","Function parameter");
      }
    }
    // Resources including parameterized HLSL storage types.
    const resourcePattern=/\b((?:RW)?StructuredBuffer|(?:RW)?ByteAddressBuffer|ConstantBuffer|(?:RW)?Texture\w*|Sampler\w*)\s*(?:<\s*([A-Za-z_]\w*(?:[1-4])?)\s*>)?\s+([A-Za-z_]\w*)/g;
    while((m=resourcePattern.exec(text)))add(m[3],"resource",m[1],m[2]?"Resource of "+m[2]:"","Declared GPU resource");
    // Variables/struct fields/constant-buffer fields.
    const variablePattern=new RegExp("\\b((?:float|int|uint|bool|half|double|min16float|min16int|min16uint)(?:[1-4](?:x[1-4])?)?|[A-Za-z_]\\w*)\\s+([A-Za-z_]\\w*)\\s*(?=\\[|[=;,):])","g");
    while((m=variablePattern.exec(text))){
      const [_,type,name]=m;
      if(keywordWords.includes(type)||keywordWords.includes(name)||functions.has(name))continue;
      add(name,"variable",type,"","Declared in this shader");
    }
    return {results:[...results.values()],typesByName,functions};
  }
  function catalog(){
    const items=new Map();
    const add=(name,kind,description="",signature="")=>{
      if(items.has(name))return;
      items.set(name,{name,kind,description,signature});
    };
    for(const name of keywordWords)add(name,"keyword","HLSL syntax");
    for(const name of resources)add(name,"resource","HLSL resource type");
    for(const name of types)add(name,"type","HLSL numeric type");
    for(const name of semanticWords)add(name,"semantic","HLSL system-value semantic");
    for(const name of directives)add(name,"directive","Preprocessor directive");
    for(const name of registerWords)add(name,"register","Resource binding register");
    for(const [name,signature] of Object.entries(builtinSignatures))
      add(name,"intrinsic","HLSL built-in function",signature);
    for(const item of docs?.list||[]){
      // Curated HLSL descriptions override generic catalog labels.
      const existing=items.get(item.key)||{name:item.key,kind:"intrinsic"};
      items.set(item.key,{...existing,description:item.what||existing.description||"",
        signature:existing.signature||"",doc:item});
    }
    return [...items.values()];
  }
  const fixedCatalog=catalog();
  const cached={source:null,symbols:null};
  function getSymbols(source){
    if(cached.source!==source){
      cached.source=source;cached.symbols=symbolMap(source);
    }
    return cached.symbols;
  }
  function contextFor(source,pos){
    const lines=source.split("\n"),line=lines[pos.line]||"",before=line.slice(0,pos.ch);
    const found=before.match(/([A-Za-z_]\w*)$/);
    const prefix=found?found[1]:"";
    const left=before.slice(0,before.length-prefix.length);
    const member=left.match(/\b([A-Za-z_]\w*)\s*\.\s*$/);
    const register=/\bregister\s*\(\s*$/.test(left);
    const preproc=/^\s*#\s*[a-zA-Z_]*$/.test(before);
    const semantic=/:\s*(?:SV_\w*)?$/.test(before) && !/\?\s*\w*:$/.test(before);
    return {prefix,member:member?.[1]||null,register,preproc,semantic,left,line,before};
  }
  const swizzles={
    1:["x","r"],
    2:["x","y","r","g","xy","yx","rg","gr"],
    3:["x","y","z","r","g","b","xy","yz","xyz","rgb","zyx","bgr"],
    4:["x","y","z","w","r","g","b","a","xy","yz","zw","xyz","xyzw","rgba","rgb","bgra","www"]
  };
  function suggest(source,pos,manual=false){
    if(!source||source.length>131072)return {from:pos.ch,to:pos.ch,items:[]};
    const lines=source.split("\n"),line=lines[pos.line]||"";
    const c=contextFor(source,pos);
    const from=pos.ch-c.prefix.length;
    const skipped=clean(line.slice(0,pos.ch));
    if(c.prefix && skipped.slice(-c.prefix.length).trim()==="")return {from,to:pos.ch,items:[]};
    // Prefix is inside a line comment or quoted string; never suggest code.
    if(skipped.trimEnd().length<=from && /["']|\/\//.test(line.slice(0,from)))
      return {from,to:pos.ch,items:[]};
    if(!manual&&!c.member&&!c.register&&!c.preproc&&c.prefix.length<2)
      return {from,to:pos.ch,items:[]};
    const symbols=getSymbols(source);
    let pool;
    if(c.member){
      const type=symbols.typesByName.get(c.member)||"";
      const dim=Number(type.match(/(?:float|uint|int|bool|half|double)([1-4])(?:x|$)/)?.[1]||0);
      if(dim){
        pool=(swizzles[dim]||[]).map(name=>({name,kind:"swizzle",description:"Vector component or swizzle of "+type}));
      }else if(symbols.results.some(x=>x.name===c.member&&x.kind==="resource")){
        pool=[{name:"GetDimensions",kind:"method",signature:"GetDimensions(count, stride)",description:"Query resource dimensions"}];
      }else pool=[];
    }else if(c.register)pool=fixedCatalog.filter(x=>x.kind==="register");
    else if(c.preproc)pool=fixedCatalog.filter(x=>x.kind==="directive");
    else if(c.semantic)pool=fixedCatalog.filter(x=>x.kind==="semantic");
    else pool=[...symbols.results,...fixedCatalog.filter(x=>!["register","directive","semantic"].includes(x.kind))];
    const q=c.prefix.toLowerCase(),seen=new Set();
    const items=pool.filter(item=>{
      const name=item.name;
      if(seen.has(name)||!name.toLowerCase().startsWith(q))return false;
      // Prevent duplicate completion when only the already typed exact name fits.
      if(!manual&&name===c.prefix)return false;
      seen.add(name);return true;
    }).sort((a,b)=>{
      const lhs=(kindRank[a.kind]??9),rhs=(kindRank[b.kind]??9);
      return lhs-rhs||a.name.localeCompare(b.name);
    }).slice(0,28);
    return {from,to:pos.ch,items,context:c};
  }
  // Parses the innermost open function call, counts its top-level comma
  // separators, and returns known (curated or locally declared) signatures.
  function signatureAt(source,pos){
    const lines=source.split("\n");
    const before=(lines.slice(0,pos.line).join("\n")+(pos.line?"\n":"")+
      (lines[pos.line]||"").slice(0,pos.ch)).slice(-1800);
    const stripped=clean(before);
    const stack=[];let i=0;
    for(;i<stripped.length;i++){
      const ch=stripped[i];
      if(ch==="("){
        const head=stripped.slice(Math.max(0,i-160),i).match(/([A-Za-z_]\w*)\s*$/);
        stack.push({name:head?.[1]||"",commas:0,index:i});
      }else if(ch===")"&&stack.length)stack.pop();
      else if(ch===","&&stack.length)stack[stack.length-1].commas++;
    }
    const symbols=getSymbols(source);
    for(let n=stack.length-1;n>=0;n--){
      const call=stack[n];if(!call.name)continue;
      const signature=symbols.functions.get(call.name)||
        builtinSignatures[call.name]||
        (docs?.get(call.name)?.example?.split("\n").find(x=>x.includes(call.name+"("))||"");
      if(!signature)continue;
      return {name:call.name,signature:signature.trim().slice(0,240),
        active:call.commas,description:docs?.get(call.name)?.what||""};
    }
    return null;
  }
  window.HLSLIntelliSenseEngine={suggest,symbolMap,signatureAt,builtinSignatures};

  const editor=window.HLSLFoldDocs?.editor;
  if(!CM?.showHint||!editor){
    console.warn("HLSL completion is unavailable: offline show-hint addon or editor missing.");
    return;
  }
  const $=id=>document.getElementById(id);
  const signatureBox=$("hlsl-signature-help");
  let delay=0;
  function showSignature(){
    if(!signatureBox)return;
    const info=signatureAt(editor.getValue(),editor.getCursor());
    if(!info){signatureBox.hidden=true;return;}
    $("hlsl-signature-name").textContent=info.name;
    $("hlsl-signature-code").textContent=info.signature;
    $("hlsl-signature-argument").textContent="Argument "+(info.active+1);
    $("hlsl-signature-summary").textContent=info.description||"Function declared in shader";
    const caret=editor.cursorCoords(null,"window");
    const w=signatureBox.offsetWidth||330,h=signatureBox.offsetHeight||115;
    signatureBox.style.left=Math.max(8,Math.min(caret.left,window.innerWidth-w-10))+"px";
    signatureBox.style.top=(caret.bottom+h+8>window.innerHeight?
      Math.max(8,caret.top-h-8):caret.bottom+6)+"px";
    signatureBox.hidden=false;
  }
  function closeSignature(){if(signatureBox)signatureBox.hidden=true;}
  function hintFunction(cm){
    const pos=cm.getCursor(),result=suggest(cm.getValue(),pos,true);
    const from=CM.Pos(pos.line,result.from),to=CM.Pos(pos.line,result.to);
    return {
      from,to,list:result.items.map(item=>{
        const isFunction=item.kind==="function"||item.kind==="intrinsic"||
          item.kind==="method";
        return {
          text:item.name,
          displayText:item.name,
          className:"hlsl-hint-"+item.kind,
          render(element){
            const label=document.createElement("span");
            label.className="hlsl-hint-name";label.textContent=item.name;
            const kind=document.createElement("span");
            kind.className="hlsl-hint-kind";kind.textContent=item.kind;
            element.append(label,kind);
            if(item.description){
              const description=document.createElement("span");
              description.className="hlsl-hint-description";
              description.textContent=item.description.slice(0,95);
              element.append(description);
            }
          },
          hint(editor,data){
            const text=item.name;
            const next=editor.getRange(data.to,CM.Pos(data.to.line,
              editor.getLine(data.to.line).length)).trimStart();
            if(isFunction&&!next.startsWith("(")){
              editor.replaceRange(text+"()",data.from,data.to,"+hlsl-complete");
              editor.setCursor(CM.Pos(data.from.line,data.from.ch+text.length+1));
              showSignature();
            }else{
              editor.replaceRange(text,data.from,data.to,"+hlsl-complete");
              editor.setCursor(CM.Pos(data.from.line,data.from.ch+text.length));
            }
          }
        };
      })
    };
  }
  function complete(force=true){
    if(editor.state.completionActive)return;
    const position=editor.getCursor();
    const candidate=suggest(editor.getValue(),position,force);
    if(!candidate.items.length)return;
    editor.showHint({hint:hintFunction,completeSingle:false,
      closeOnUnfocus:true,alignWithWord:true});
  }
  function queueCompletion(cm,change){
    if(change.origin!=="+input")return;
    if(!change.text||change.text.length!==1)return;
    const fragment=change.text[0]||"";
    if(!/^[A-Za-z_.]$/.test(fragment))return;
    clearTimeout(delay);
    delay=setTimeout(()=>{
      if(!cm.hasFocus()||cm.state.completionActive)return;
      complete(false);
    },90);
  }
  editor.on("inputRead",queueCompletion);
  editor.on("cursorActivity",()=>{
    clearTimeout(delay);
    showSignature();
  });
  editor.on("blur",()=>{
    clearTimeout(delay);
    closeSignature();
  });
  editor.on("scroll",closeSignature);
  const keyMap={
    "Ctrl-Space":()=>complete(true),
    "Cmd-Space":()=>complete(true),
    "Ctrl-Shift-Space":()=>showSignature(),
    "Cmd-Shift-Space":()=>showSignature(),
  };
  editor.addKeyMap(keyMap);
  $("trigger-completion")?.addEventListener("click",()=>{
    editor.focus();complete(true);
  });
  window.HLSLIntelliSense={
    complete,showSignature,closeSignature,
    get editor(){return editor;},
    get suggestions(){return suggest(editor.getValue(),editor.getCursor(),true).items;},
    get signature(){return signatureAt(editor.getValue(),editor.getCursor());},
    get popupOpen(){return !!editor.state.completionActive;}
  };
})();