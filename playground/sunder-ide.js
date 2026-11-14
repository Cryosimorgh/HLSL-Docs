// Sunder IDE shell: actions and live labels around the existing real HLSL runtime.
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const editor = $("code");
  const source = () => window.HLSLFoldDocs?.editor?.getValue() ?? editor.value;
  const focusEditor = () => {const cm=window.HLSLFoldDocs?.editor;if(cm)cm.focus();else editor.focus();};
  const run = () => { if (!$('run-gpu').disabled) $('run-gpu').click(); };
  const animate = () => { if (!$('animate-gpu').disabled) $('animate-gpu').click(); };
  const fileNew = () => window.HLSLDesktopFiles?.newDocument?.();

  const serverLink = $('server-url');
  if (serverLink) {
    const local = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(location.origin);
    serverLink.textContent = local ? location.host : 'Offline';
    serverLink.href = local ? location.origin + '/' : '#';
    if (!local) $('server-dot')?.classList.add('is-offline');
    else fetch('/api/health', {cache:'no-store'}).then(response => {
      if (!response.ok) $('server-dot')?.classList.add('is-offline');
    }).catch(() => $('server-dot')?.classList.add('is-offline'));
  }

  $('new-file')?.addEventListener('click',fileNew);
  $('new-document-tab')?.addEventListener('click',fileNew);
  $('close-document')?.addEventListener('click',fileNew);
  $('show-shortcuts')?.addEventListener('change',event => {
    $('shortcuts-panel').hidden = !event.target.checked;
  });
  $('preview-expand')?.addEventListener('click', () => {
    const expanded = document.querySelector('.workbench')?.classList.toggle('preview-maximized');
    $('preview-expand').setAttribute('aria-pressed', String(!!expanded));
    $('preview-expand').setAttribute('aria-label', expanded?'Restore editor and preview':'Expand preview');
    $('preview-expand').title = expanded?'Restore editor and preview':'Expand preview';
    if (!expanded) focusEditor();
  });
  function closeMenus() {
    for (const id of ['advanced-actions','workspace-settings','editor-actions']) {
      const element=$(id);if(element)element.open=false;
    }
  }
  // Only one popup menu should remain open at once.
  for (const id of ['advanced-actions','workspace-settings','editor-actions']) {
    $(id)?.addEventListener('toggle',event => {
      if (!event.target.open)return;
      for (const sibling of ['advanced-actions','workspace-settings','editor-actions'])
        if(sibling!==id&&$(sibling))$(sibling).open=false;
    });
  }
  document.addEventListener('pointerdown',event=>{
    if (!event.target.closest('details.header-menu,details.toolbar-more,details.editor-actions')) closeMenus();
  },true);
  document.addEventListener('keydown',event => {
    if (event.defaultPrevented || event.isComposing || event.key==='Process') return;
    const ctrl = event.ctrlKey||event.metaKey;
    const key=event.key.toLowerCase();
    if (event.key==='F5' && !event.altKey && !ctrl) {event.preventDefault();run();}
    else if (event.key==='F6' && !event.altKey && !ctrl) {event.preventDefault();animate();}
    else if (ctrl && key==='o') {event.preventDefault();$('open-file')?.click();}
    else if (ctrl && key==='n') {event.preventDefault();fileNew();}
    else if (ctrl && event.shiftKey && key==='s') {event.preventDefault();event.stopPropagation();$('download')?.click();}
    else if (event.key==='Escape') {
      closeMenus();
      if(document.querySelector('.workbench.preview-maximized')) $('preview-expand')?.click();
    }
  },true);

  // Counters are sourced from the running GPU animation, never invented values.
  const syncMetrics=()=>{
    const fps=($('animation-fps')?.textContent||'—').trim();
    const frames=($('animation-frames')?.textContent||'0').trim();
    const readback=($('animation-readback-ms')?.textContent||'—').trim();
    $('preview-live-fps').textContent=fps==='—'||fps==='…'?'— FPS':fps+' FPS';
    $('performance-overview').textContent=fps==='—'||fps==='…'?'No frames yet':fps+' FPS · '+readback+' readback';
    const panel=$('gpu-visual-panel');
    if(panel && !panel.hidden){
      const match=source().match(/^\s*#\s*define\s+WORKBENCH_WIDTH\s+(\d+)/m);
      const matchY=source().match(/^\s*#\s*define\s+WORKBENCH_HEIGHT\s+(\d+)/m);
      $('preview-resolution').textContent=match&&matchY?
        match[1]+' × '+matchY[1]:'GPU output';
    } else $('preview-resolution').textContent='Shader output';
    document.querySelector('.status-message .status-dot')?.classList.toggle('is-offline',
      $('compile-status')?.classList.contains('is-error')||false);
  };
  const metricsNodes=['animation-fps','animation-frames','animation-readback-ms','compile-status','gpu-visual-panel'];
  const observer=new MutationObserver(syncMetrics);
  for(const id of metricsNodes){if($(id)){const opts={childList:true,subtree:true,characterData:true};if(id==='gpu-visual-panel'){opts.attributes=true;opts.attributeFilter=['hidden'];}observer.observe($(id),opts);}}
  syncMetrics();
  window.SunderIDEShell={get previewExpanded(){return !!document.querySelector('.workbench.preview-maximized')},syncMetrics};
})();
