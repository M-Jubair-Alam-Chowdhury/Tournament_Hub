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
