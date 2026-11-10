// Render actual WebGPU readback buffers. This is NOT a CPU approximation
// of the shader: only values returned from GPUBuffer.mapAsync reach this code.
(() => {
"use strict";
const $ = id => document.getElementById(id);
const panel=$("gpu-visual-panel"), canvas=$("gpu-visual"), summary=$("gpu-visual-summary"),
      title=$("gpu-visual-title"), legend=$("gpu-visual-legend"), empty=$("gpu-preview-empty");
const W=canvas.width, H=canvas.height;
const finite=n=>Number.isFinite(n);
const fmt=n=>finite(n)?Number(n.toPrecision(5)).toString():"non-finite";
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const hasMaskSource=s=>/\bmask\b/i.test(s)&&/\bsmoothstep\s*\(/i.test(s);
// Reuse large offscreen image buffers across successive GPU frames.
const rasters=new Map();
function rasterFor(w,h,ctx){
  if(typeof document.createElement!=="function"||typeof ctx.drawImage!=="function")return null;
  const key=w+"x"+h;
  if(rasters.has(key))return rasters.get(key);
  const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
  const context=canvas.getContext("2d");
  const image=context?.createImageData?.(w,h);
  if(!image)return null;
  if(rasters.size>=2)rasters.clear();
  const raster={canvas,context,image};rasters.set(key,raster);
  return raster;
}
function clear(){
  panel.hidden=true;
  if(empty)empty.hidden=false;
  summary.textContent="";
  summary.classList?.remove("warning");
}
function stats(values) {
  let min=Infinity,max=-Infinity,sum=0,positive=0,valid=0;
  for(const v of values){
    if(!finite(v))continue;
    valid++;min=Math.min(min,v);max=Math.max(max,v);sum+=v;
    if(v>=0.5)positive++;
  }
  return {n:values.length,valid,min:valid?min:NaN,max:valid?max:NaN,
          mean:valid?sum/valid:NaN,positive};
}
function palette(t) {
  t=clamp(finite(t)?t:0,0,1);
  // Charcoal = zero; warm amber = one. Colors are derived only from GPU data.
  const c=x=>Math.round(x);
  return "rgb("+c(29+205*t)+","+c(39+147*t)+","+c(50+69*t)+")";
}
function setup(ctx,label,worldAspect=1) {
  // Match the plot's physical X/Y aspect ratio; never stretch circles.
  const aspect=clamp(finite(worldAspect)&&worldAspect>0?worldAspect:1,0.2,5);
  const available=Math.min(W-58,H-64);
  const width=aspect>=1?available:available*aspect;
  const height=aspect>=1?available/aspect:available;
  const m={left:(W-width)/2,top:(H-height)/2-8,width,height};
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle="#10151c";ctx.fillRect(0,0,W,H);
  ctx.fillStyle="#202936";ctx.fillRect(m.left,m.top,m.width,m.height);
  ctx.strokeStyle="#455264";ctx.lineWidth=1;
  ctx.strokeRect(m.left+.5,m.top+.5,m.width,m.height);
  return m;
}
function axes(ctx,m,xMax,yMax){
  ctx.font="12px ui-monospace,Consolas,monospace";
  ctx.fillStyle="#8897a7";
  ctx.fillText("0",m.left,m.top+m.height+22);
  ctx.fillText(fmt(xMax),Math.max(m.left,m.left+m.width-35),m.top+m.height+22);
  ctx.fillText("0",Math.max(4,m.left-38),m.top+8);
  ctx.fillText(fmt(yMax),Math.max(4,m.left-38),m.top+m.height);
}
function fractalRGB(v){
  // Discrete palette derived from GPU escape-time intensity, not a CPU fractal.
  const t=clamp(finite(v)?v:0,0,1);
  const stops=[
    [0.00,18,27,43],[0.06,38,53,95],[0.18,37,104,146],
    [0.36,84,160,166],[0.62,228,178,110],[1.00,246,232,198]
  ];
  let a=stops[0],b=stops[stops.length-1];
  for(let i=1;i<stops.length;i++)if(t<=stops[i][0]){a=stops[i-1];b=stops[i];break;}
  const p=clamp((t-a[0])/(b[0]-a[0]||1),0,1);
  return [Math.round(a[1]+(b[1]-a[1])*p),
          Math.round(a[2]+(b[2]-a[2])*p),
          Math.round(a[3]+(b[3]-a[3])*p)];
}
function drawGrid(ctx, v, count, opts,fractal=false){
  const grid=opts.grid||{};
  const gw=grid.width,gh=grid.height;
  if(!Number.isInteger(gw)||!Number.isInteger(gh)||gw*gh!==count||gw<2||gh<2)
    throw Error("Grid visualization requires width × height to match GPU output sample count.");
  const channel=opts.channel??2;
  const xMax=grid.xMax??1,yMax=grid.yMax??1;
  const m=setup(ctx,fractal?"Julia set":"GPU mask",xMax/yMax);
  const values=new Float32Array(count);
  // Fast path: plot 16,384 pixels with ONE drawImage, rather than thousands
  // of fillRect and CSS string allocations every animation frame.
  let bitmap=null,image=null,pixelContext=null;
  if(typeof document.createElement==="function"&&typeof ctx.drawImage==="function"){
    bitmap=document.createElement("canvas");
    bitmap.width=gw;bitmap.height=gh;
    pixelContext=bitmap.getContext("2d");
    if(pixelContext?.createImageData)image=pixelContext.createImageData(gw,gh);
  }
  for(let i=0;i<count;i++){
    const z=v[i*4+channel];
    values[i]=z;
    const rgb=fractal?fractalRGB(z):null;
    if(image){
      const p=i*4;
      if(fractal){
        image.data[p]=rgb[0];image.data[p+1]=rgb[1];image.data[p+2]=rgb[2];
      }else{
        const t=clamp(finite(z)?z:0,0,1);
        image.data[p]=Math.round(29+205*t);
        image.data[p+1]=Math.round(39+147*t);
        image.data[p+2]=Math.round(50+69*t);
      }
      image.data[p+3]=255;
    }else{
      ctx.fillStyle=fractal?"rgb("+rgb.join(",")+")":palette(z);
      const x=m.left+(i%gw)*m.width/gw,y=m.top+Math.floor(i/gw)*m.height/gh;
      ctx.fillRect(x,y,Math.ceil(m.width/gw)+0.25,Math.ceil(m.height/gh)+0.25);
    }
  }
  if(image){
    pixelContext.putImageData(image,0,0);
    const oldSmooth=ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(bitmap,m.left,m.top,m.width,m.height);
    ctx.imageSmoothingEnabled=oldSmooth;
  }
  axes(ctx,m,xMax,yMax);
  return {st:stats(values),kind:fractal?"fractal":"mask",
    description:gw+"×"+gh+" GPU readback samples; "+(fractal?"escape iterations":"mask")};
}
function drawRGBA(ctx,v,count,opts){
  const g=opts.grid||{},w=g.width,h=g.height;
  if(!Number.isInteger(w)||!Number.isInteger(h)||w*h!==count)
    throw Error("HLSL Framebuffer dimensions do not match GPU output byte length.");
  const m=setup(ctx,"HLSL RGBA framebuffer",w/h);
  const bright=new Float32Array(count);
  const raster=rasterFor(w,h,ctx);
  const pixels=raster?.image||null,bitmap=raster?.canvas||null,off=raster?.context||null;
  for(let i=0;i<count;i++){
    const j=i*4;
    const r=clamp(finite(v[j])?v[j]:0,0,1);
    const g0=clamp(finite(v[j+1])?v[j+1]:0,0,1);
    const b=clamp(finite(v[j+2])?v[j+2]:0,0,1);
    const a=clamp(finite(v[j+3])?v[j+3]:1,0,1);
    bright[i]=0.2126*r+0.7152*g0+0.0722*b;
    if(pixels){
      pixels.data[j]=Math.round(r*255);
      pixels.data[j+1]=Math.round(g0*255);
      pixels.data[j+2]=Math.round(b*255);
      pixels.data[j+3]=Math.round(a*255);
    }else{
      ctx.fillStyle="rgba("+Math.round(r*255)+","+Math.round(g0*255)+","+
        Math.round(b*255)+","+a+")";
      const x=m.left+(i%w)*m.width/w,y=m.top+Math.floor(i/w)*m.height/h;
      ctx.fillRect(x,y,Math.ceil(m.width/w)+.1,Math.ceil(m.height/h)+.1);
    }
  }
  if(pixels){
    off.putImageData(pixels,0,0);
    const smooth=ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(bitmap,m.left,m.top,m.width,m.height);
    ctx.imageSmoothingEnabled=smooth;
  }
  return {st:stats(bright),kind:"rgba",
    description:w+"×"+h+" full-color pixels from HLSL float4(r,g,b,a) WebGPU output"};
}
function drawScatter(ctx,v,count,opts,maskMode,defaultXMax){
  const channel=opts.channel??2;
  const maxX=finite(opts.xMax)&&opts.xMax>0?opts.xMax:defaultXMax,
        maxY=finite(opts.yMax)&&opts.yMax>0?opts.yMax:1;
  const m=setup(ctx,maskMode?"GPU mask · positions":"GPU float4 · positions",maxX/maxY);
  const values=[];
  const step=Math.max(1,Math.ceil(count/15000));
  for(let i=0;i<count;i++){
    const j=i*4, x=v[j],y=v[j+1],z=v[j+channel];
    values.push(z);
    if(i%step!==0||!finite(x)||!finite(y))continue;
    const px=m.left+clamp(x/maxX,0,1)*m.width,
          py=m.top+clamp(y/maxY,0,1)*m.height;
    ctx.fillStyle=palette(z);
    ctx.beginPath();ctx.arc(px,py,count>3000?2.3:4.2,0,Math.PI*2);ctx.fill();
  }
  axes(ctx,m,maxX,maxY);
  return {st:stats(values),kind:maskMode?"mask":"channel",
    description:count+" GPU output points (x/y), colored by float4 component "+["x","y","z","w"][channel]};
}
function drawBars(ctx, v, kind){
  const values=Array.from(v), st=stats(values);
  const m=setup(ctx,"GPU numeric output · bar chart",1.4);
  const low=finite(st.min)?Math.min(0,st.min):0,
        high=finite(st.max)?Math.max(0,st.max):1;
  const range=high-low||1, count=values.length;
  const step=Math.max(1,Math.ceil(count/400));
  const n=Math.ceil(count/step), barW=m.width/n;
  const yFor=value=>m.top+m.height*(1-(value-low)/range);
  const zero=yFor(0);
  ctx.strokeStyle="#62788c";ctx.beginPath();ctx.moveTo(m.left,zero);ctx.lineTo(m.left+m.width,zero);ctx.stroke();
  for(let k=0;k<n;k++){
    const value=values[k*step];
    if(!finite(value))continue;
    const y=yFor(value);
    ctx.fillStyle=value>=0?"#e8bc75":"#df8b83";
    ctx.fillRect(m.left+k*barW+0.5,Math.min(y,zero),Math.max(1,barW-1),Math.max(1,Math.abs(y-zero)));
  }
  ctx.fillStyle="#b7cce0";ctx.font="12px system-ui,sans-serif";
  ctx.fillText("min "+fmt(st.min),m.left,m.top+m.height+28);
  ctx.fillText("max "+fmt(st.max),m.left+m.width-108,m.top+m.height+28);
  return {st,kind:"scalar",description:count+" "+kind+" values; "+(step>1?"sampled every "+step+" entries":"all entries shown")};
}
function render({bytes,format,binding,visualize,source,worldWidth}) {
  panel.hidden=false;
  if(empty)empty.hidden=true;
  const ctx=canvas.getContext("2d");
  if(!ctx)throw Error("Canvas 2D context unavailable for GPU output visualization.");
  let result,mode;
  const opts=visualize||{};
  title.textContent="Output · binding "+binding;
  if(format==="vec4"){
    if(bytes.byteLength%16)throw Error("float4 visualization requires 16-byte-aligned output.");
    const v=new Float32Array(bytes),count=v.length/4;
    mode=opts.mode||(hasMaskSource(source)?"scatter-mask":"scatter");
    if(!["grid-mask","grid-fractal","grid-rgba","scatter-mask","scatter"].includes(mode))throw Error("Unknown float4 visualization mode: "+mode);
    result=mode==="grid-rgba"?
      drawRGBA(ctx,v,count,opts):
      (mode==="grid-mask"||mode==="grid-fractal")?
        drawGrid(ctx,v,count,opts,mode==="grid-fractal"):
        drawScatter(ctx,v,count,opts,mode==="scatter-mask",worldWidth||1);
  }else{
    const dv=new DataView(bytes),v=[];
    for(let i=0;i<bytes.byteLength;i+=4)
      v.push(format==="u32"?dv.getUint32(i,true):format==="i32"?dv.getInt32(i,true):dv.getFloat32(i,true));
    result=drawBars(ctx,v,format);
  }
  const {st,kind,description}=result;
  const set=(id,value)=>{const node=$(id);if(node)node.textContent=value;};
  set("viz-samples",st.n.toLocaleString("en-US"));
  set("viz-coverage",(kind==="mask"||kind==="fractal"||kind==="rgba")&&st.valid?(100*st.positive/st.valid).toFixed(1)+"%":"—");
  const coverageLabel=$("viz-coverage-label");
  if(coverageLabel)coverageLabel.textContent=kind==="fractal"?"High iteration":kind==="rgba"?"Bright pixels":"Coverage";
  set("viz-range",fmt(st.min)+" – "+fmt(st.max));
  set("viz-mean",fmt(st.mean));
  summary.classList?.remove("warning");
  if(kind==="rgba"){
    title.textContent="HLSL framebuffer · binding "+binding;
    summary.textContent=description;
  }else if(kind==="fractal"){
    title.textContent="Julia fractal · binding "+binding;
    summary.textContent="Live GPU escape-time image · "+st.n+" samples";
  }else if(kind==="mask") {
    title.textContent="Circle mask · binding "+binding;
    summary.textContent=st.positive+"/"+st.valid+" samples have mask ≥ 0.5";
    if(st.valid>0&&st.positive===0) {
      summary.textContent+=" · All masks zero. Increase radius or adjust sample positions.";
      summary.classList?.add("warning");
    }else if(st.valid>0&&st.positive===st.valid) {
      summary.textContent+=" · All samples are inside.";
    }
  }else summary.textContent=description;
  if(st.valid!==st.n) {
    summary.textContent+=" · "+(st.n-st.valid)+" non-finite values";
    summary.classList?.add("warning");
  }
  legend.textContent=kind==="rgba"?"RGB and alpha are written in the HLSL shader. The browser only displays GPU readback pixels.":
    kind==="fractal"?"Deep blue → teal → amber = increasing escape iteration count":
    kind==="mask"?
    "0 — outside · 1 — inside · Amber — positive mask":
    kind==="channel"?"XY position · color represents channel "+(opts.channel??2):
    "Above baseline: amber · Below baseline: red";
  return result;
}
window.HLSLGPUVisualize={render,clear,stats,hasMaskSource};
})();
