// Render actual WebGPU readback buffers. This is NOT a CPU approximation
// of the shader: only values returned from GPUBuffer.mapAsync reach this code.
(() => {
"use strict";
const $ = id => document.getElementById(id);
const panel=$("gpu-visual-panel"), canvas=$("gpu-visual"), summary=$("gpu-visual-summary"),
      title=$("gpu-visual-title"), legend=$("gpu-visual-legend");
const W=canvas.width, H=canvas.height;
const finite=n=>Number.isFinite(n);
const fmt=n=>finite(n)?Number(n.toPrecision(5)).toString():"non-finite";
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const hasMaskSource=s=>/\bmask\b/i.test(s)&&/\bsmoothstep\s*\(/i.test(s);
function clear(){
  panel.hidden=true;
  summary.textContent="";
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
  // Dark slate = zero, bright aqua = one. Not a predicted circle overlay.
  const c=x=>Math.round(x);
  return "rgb("+c(25+72*t)+","+c(46+178*t)+","+c(70+133*t)+")";
}
function setup(ctx,label) {
  const m={left:55,top:36,width:W-82,height:H-92};
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle="#091425";ctx.fillRect(0,0,W,H);
  ctx.fillStyle="#0e2033";ctx.fillRect(m.left,m.top,m.width,m.height);
  ctx.strokeStyle="#4c6176";ctx.lineWidth=1;
  ctx.strokeRect(m.left,m.top,m.width,m.height);
  ctx.fillStyle="#d3e6f4";ctx.font="15px system-ui,sans-serif";
  ctx.fillText(label,m.left,m.top-12);
  return m;
}
function axes(ctx,m,xMax,yMax){
  ctx.font="12px system-ui,sans-serif";
  ctx.fillStyle="#b7cce0";
  ctx.fillText("x = 0",m.left,H-30);
  ctx.fillText("x = "+fmt(xMax),m.left+m.width-76,H-30);
  ctx.fillText("y = 0",m.left-44,m.top+12);
  ctx.fillText("y = "+fmt(yMax),m.left-52,m.top+m.height);
}
function drawGrid(ctx, v, count, opts){
  const grid=opts.grid||{};
  const gw=grid.width, gh=grid.height;
  if(!Number.isInteger(gw)||!Number.isInteger(gh)||gw*gh!==count||gw<2||gh<2)
    throw Error("Grid visualization requires grid.width × grid.height to match GPU output sample count.");
  const channel=opts.channel??2;
  const m=setup(ctx,"GPU circle mask · 2D grid");
  const values=[];
  for(let i=0;i<count;i++){
    const z=v[i*4+channel];
    values.push(z);
    ctx.fillStyle=palette(z);
    const x=m.left+(i%gw)*m.width/gw,
          y=m.top+Math.floor(i/gw)*m.height/gh;
    ctx.fillRect(x,y,Math.ceil(m.width/gw)+0.25,Math.ceil(m.height/gh)+0.25);
  }
  axes(ctx,m,grid.xMax??1,grid.yMax??1);
  const st=stats(values);
  return {st,kind:"mask",description:gw+"×"+gh+" GPU samples, displayed as image cells"};
}
function drawScatter(ctx,v,count,opts,maskMode,defaultXMax){
  const m=setup(ctx,maskMode?"GPU circle mask · particle positions":"GPU float4 output · positions");
  const channel=opts.channel??2;
  const maxX=finite(opts.xMax)&&opts.xMax>0?opts.xMax:defaultXMax,
        maxY=finite(opts.yMax)&&opts.yMax>0?opts.yMax:1;
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
  const m=setup(ctx,"GPU numeric output · bar chart");
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
    ctx.fillStyle=value>=0?"#72d9bb":"#e8aa8b";
    ctx.fillRect(m.left+k*barW+0.5,Math.min(y,zero),Math.max(1,barW-1),Math.max(1,Math.abs(y-zero)));
  }
  ctx.fillStyle="#b7cce0";ctx.font="12px system-ui,sans-serif";
  ctx.fillText("min "+fmt(st.min),m.left,H-30);
  ctx.fillText("max "+fmt(st.max),m.left+m.width-104,H-30);
  return {st,kind:"scalar",description:count+" "+kind+" values; "+(step>1?"sampled every "+step+" entries":"all entries shown")};
}
function render({bytes,format,binding,visualize,source,worldWidth}) {
  panel.hidden=false;
  const ctx=canvas.getContext("2d");
  if(!ctx)throw Error("Canvas 2D context unavailable for GPU output visualization.");
  let result,mode;
  const opts=visualize||{};
  title.textContent="GPU output · binding "+binding;
  if(format==="vec4"){
    if(bytes.byteLength%16)throw Error("float4 visualization requires 16-byte-aligned output.");
    const v=new Float32Array(bytes),count=v.length/4;
    mode=opts.mode||(hasMaskSource(source)?"scatter-mask":"scatter");
    if(!["grid-mask","scatter-mask","scatter"].includes(mode))throw Error("Unknown float4 visualization mode: "+mode);
    result=mode==="grid-mask"
      ?drawGrid(ctx,v,count,opts)
      :drawScatter(ctx,v,count,opts,mode==="scatter-mask",worldWidth||1);
  }else{
    const dv=new DataView(bytes),v=[];
    for(let i=0;i<bytes.byteLength;i+=4)
      v.push(format==="u32"?dv.getUint32(i,true):format==="i32"?dv.getInt32(i,true):dv.getFloat32(i,true));
    result=drawBars(ctx,v,format);
  }
  const {st,kind,description}=result;
  const details=["Binding "+binding,description,
    "min "+fmt(st.min),"max "+fmt(st.max),"mean "+fmt(st.mean)];
  if(kind==="mask"){
    details.push(st.positive+"/"+st.valid+" samples have mask ≥ 0.5");
    if(st.valid>0&&st.positive===0)details.push(
      "ALL MASKS ZERO — nothing lies inside the chosen circle. Increase its radius or use the 2D grid preset.");
    if(st.valid>0&&st.positive===st.valid)details.push("All sampled points lie inside the mask.");
  }
  if(st.valid!==st.n)details.push((st.n-st.valid)+" non-finite channel values");
  summary.textContent=details.join(" · ");
  legend.textContent=kind==="mask"
    ?"Dark = mask 0 (outside) · Aqua = mask 1 (inside) · Intermediate colors = smooth edge"
    :kind==="channel"
    ?"Color maps float4.z (0 dark → 1 aqua); z is not necessarily a mask"
    :"Aqua = positive · Salmon = negative · Horizontal line = zero";
  return result;
}
window.HLSLGPUVisualize={render,clear,stats,hasMaskSource};
})();
