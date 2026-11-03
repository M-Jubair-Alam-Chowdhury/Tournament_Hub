/* Preserve an in-progress input when an unrelated live update redraws a view. */
window.hubCaptureInputs=function(root,scope){
  if(root.dataset.inputScope!==scope) return null;
  const focused=document.activeElement;
  return {scope,focus:focused?.id,selection:typeof focused?.selectionStart==='number'?focused.selectionStart:null,
    fields:[...root.querySelectorAll('input[id],textarea[id],select[id]')].filter(x=>x.type!=='file').map(x=>({id:x.id,value:x.value,checked:x.checked}))};
};
window.hubRestoreInputs=function(root,scope,snapshot){
  root.dataset.inputScope=scope;
  if(!snapshot||snapshot.scope!==scope) return;
  for(const saved of snapshot.fields){const input=document.getElementById(saved.id);if(input&&root.contains(input)){input.value=saved.value;if(input.type==='checkbox')input.checked=saved.checked;}}
  const focused=document.getElementById(snapshot.focus);
  if(focused&&root.contains(focused)){focused.focus({preventScroll:true});if(snapshot.selection!=null)try{focused.setSelectionRange(snapshot.selection,snapshot.selection);}catch(_){}}
};
/* v2.1 — dark mode. One key for the whole hub (same origin, shared by
   the landing page and both apps). v2.2: LIGHT is the default — dark
   only when the visitor turned it on (localStorage "hubTheme" ===
   "dark"), never merely because the OS prefers it. The page head adds
   the class before first paint — this only keeps the browser chrome
   (meta theme-color) in sync and flips it. */
window.hubApplyTheme=function(pref){
  // null = "resolve the stored choice" (used once at load so the head
  // bootstrap and this layer agree); no stored choice = light.
  let mode=pref;
  if(mode==null){ try{ mode=localStorage.getItem("hubTheme"); }catch(_){} }
  const dark=mode==="dark";
  document.documentElement.classList.toggle("dark",dark);
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta){
    if(!meta.dataset.lightValue) meta.dataset.lightValue=meta.getAttribute("content")||"#173d32";
    meta.setAttribute("content",dark?"#0f1611":meta.dataset.lightValue);
  }
  return dark;
};
window.hubToggleTheme=function(){
  const dark=!document.documentElement.classList.contains("dark");
  try{ localStorage.setItem("hubTheme",dark?"dark":"light"); }catch(_){}
  window.hubApplyTheme(dark?"dark":"light");
  document.querySelectorAll('.theme-fab,.theme-toggle').forEach(btn=>{
    btn.setAttribute("aria-label",dark?"Switch to light mode":"Switch to dark mode");
    btn.title=dark?"Light mode":"Dark mode";
  });
};
window.hubApplyTheme(null);

// Modal keyboard navigation, without interfering with native selects.
document.addEventListener('keydown',event=>{
  if(event.key!=='Tab') return;
  const dialog=document.querySelector('#mxModal [role="dialog"]');
  if(!dialog) return;
  const targets=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,a[href]')].filter(x=>x.getClientRects().length);
  const first=targets[0],last=targets[targets.length-1];
  if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first?.focus();}
});
