// Check the official GitHub release manifest through our loopback Go host.
// Downloads stage SHA-256-verified changed files only; installation is opt-in.
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const status=$('update-status'),auto=$('auto-download-updates');
  if(!status||!auto)return;
  if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(location.origin)){
    status.textContent='Use the Go-hosted application to receive updates.';return;
  }
  const key='sunder-ide-update-auto-download';
  try{auto.checked=localStorage.getItem(key)!=='off'}catch{}
  auto.addEventListener('change',()=>{try{localStorage.setItem(key,auto.checked?'on':'off')}catch{}});
  let state=null,busy=false;
  const formatBytes=bytes=>bytes<1024*1024?Math.round(bytes/1024)+' KiB':(bytes/1048576).toFixed(2)+' MiB';
  async function request(route,method='GET'){
    const response=await fetch('/api/update/'+route,{method,cache:'no-store',headers:{'Content-Type':'application/json'},body:method==='POST'?'{}':undefined});
    const data=await response.json().catch(()=>({error:'Invalid update response'}));
    if(!response.ok)throw Error(data.error||'HTTP '+response.status);
    return data;
  }
  function render(){
    if(!state)return;
    const available=state.available;
    const ready=state.ready;
    $('download-update').hidden=!available||ready;
    $('install-update').hidden=!available||!ready;
    $('update-alert').hidden=!available;
    if(!available){status.textContent='Up to date ('+state.current+').';return;}
    status.textContent=ready?'Ready: '+state.version+' ('+state.changed.length+' changed files, '+formatBytes(state.downloadBytes)+'). Restart to install.':
      state.version+' available: '+state.changed.length+' changed files, '+formatBytes(state.downloadBytes)+' to download (not the full archive).';
  }
  async function check(){
    if(busy)return;
    busy=true;status.textContent='Checking official release…';
    try{
      state=await request('check');render();
      if(state.available&&!state.ready&&auto.checked)await download(true);
    }catch(error){status.textContent='Update check unavailable: '+error.message;}
    finally{busy=false}
  }
  async function download(automatic=false){
    if(!automatic&&busy)return;
    if(!automatic)busy=true;
    status.textContent='Downloading only changed files; verifying SHA-256…';
    $('download-update').disabled=true;
    try{state=await request('download','POST');render();}
    catch(error){status.textContent='Update download failed: '+error.message;}
    finally{$('download-update').disabled=false;if(!automatic)busy=false}
  }
  async function install(){
    if(busy||!state?.ready)return;
    if(!confirm('Install verified changes for '+state.version+'? The Go server will restart. Save any edited shaders first.'))return;
    busy=true;status.textContent='Installing update and restarting Go host…';
    try{await request('install','POST');status.textContent='Server restarting. Reload the page after the update.';}
    catch(error){status.textContent='Could not install update: '+error.message;busy=false;}
  }
  $('check-updates')?.addEventListener('click',()=>{void check()});
  $('download-update')?.addEventListener('click',()=>{void download()});
  $('install-update')?.addEventListener('click',()=>{void install()});
  // Don't block initial editor load or compilation.
  setTimeout(()=>{void check()},1200);
})();
