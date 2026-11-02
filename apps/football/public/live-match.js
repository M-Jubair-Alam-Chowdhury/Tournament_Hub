/* Clock rendering is derived from a server timestamp + monotonic browser time.
   Intervals only repaint text; they never advance tournament state. */
let CLOCK_ANCHOR = {server:0, local:0};
let CLOCK_OFFLINE_AT=null;
function syncClockAnchor(){ CLOCK_OFFLINE_AT=null; CLOCK_ANCHOR={server:S?.serverNow||Date.now(),local:performance.now()}; }
function serverTime(){ if(CLOCK_OFFLINE_AT!=null)return CLOCK_OFFLINE_AT; return CLOCK_ANCHOR.server+performance.now()-CLOCK_ANCHOR.local; }
function indexedMatch(id){ return S?.matchIndex?.matches.find(m=>m.id===id); }
function liveTime(live){
  if(!live) return 0;
  return Math.min(21600000,Math.max(0,live.elapsedMs+(live.startedAt==null?0:Math.max(0,serverTime()-live.startedAt))));
}
function formatClock(ms){
  const seconds=Math.floor(ms/1000);
  return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
}
function goalMinuteMax(){return Math.max(130,(S?.duration||90)+30);}
function clockStatus(live){
  if(CONNECTION_LOST) return 'Offline · last known time';
  if(!live) return 'Ready for kick-off';
  if(live.period==='half') return 'Half-time';
  if(live.period==='finished') return 'Full-time';
  return (live.period==='second'?'2nd half':'1st half')+' · '+(live.startedAt!=null?'Live':'Paused');
}
function clockPayload(m){return {seed:S.seed,a:m.a,b:m.b,roundIndex:m.roundIndex,mi:m.mi,revision:m.live?.revision||0, scoreVersion:m.scoreVersion||0};}
function liveClockHTML(m,modal=false){
  const live=m.live;
  const id=m.id;
  const canEdit=MY_ROLE==='admin'&&!S.suspended&&!m.played&&!m.annulled;
  const running=live?.startedAt!=null;
  const period=live?.period||'first';
  const off=CONNECTION_LOST?' disabled':'';
  const controls=canEdit?`<div class="live-clock-controls">
    ${['first','second'].includes(period)?`<button type="button" class="btn tiny${running?' secondary':''}" onclick="clockAction('${id}','${running?'pause':'start'}')"${off}>${ic(running?'pause':'play',12)} ${running?'Pause':live?'Resume':'Kick off'}</button>`:''}
    ${period==='first'&&live?`<button type="button" class="btn tiny secondary" onclick="clockAction('${id}','half')"${off}>Half-time</button>`:''}
    ${period==='half'?`<button type="button" class="btn tiny" onclick="clockAction('${id}','second')"${off}>${ic('play',12)} Start 2nd half</button>`:''}
    ${period==='second'?`<button type="button" class="btn tiny secondary" onclick="clockAction('${id}','finish')"${off}>Full-time</button>`:''}
  </div>`:'';
  return `<section class="live-console" data-clock-id="${id}" data-modal="${modal?'1':'0'}" aria-label="Match clock">
    <div class="live-clock-row"><div class="live-clock-readout"><span class="live-clock-time" role="timer" aria-label="Elapsed match time">${formatClock(liveTime(live))}</span><span class="live-clock-status${running?' running':''}">${clockStatus(live)}</span></div>${controls}</div>
    <div class="live-clock-progress" aria-hidden="true"><span style="width:${Math.min(100,liveTime(live)/((S.duration||90)*600))}%"></span></div>
    <div class="live-clock-foot"><span data-clock-detail>${S.duration||90} min match · ${S.breakMins??15} min break</span>
      ${canEdit&&!running?`<details class="clock-adjust"><summary>Adjust time</summary><label>Minutes <input type="number" min="0" max="360" value="${Math.floor(liveTime(live)/60000)}" aria-label="Clock minutes"></label> <label>Seconds <input type="number" min="0" max="59" value="${Math.floor(liveTime(live)/1000)%60}" aria-label="Clock seconds"></label> <button type="button" class="btn tiny secondary" onclick="adjustClock('${id}',this)"${off}>Set</button></details>`:''}
    </div>
    ${!modal&&canEdit?`<button type="button" class="btn secondary live-open-sheet" onclick="openMatchForm('${id}','score')">${ic('plus',14)} Record goal / finish match</button>`:''}
  </section>`;
}
function clockAction(id,action,seconds){
  const m=indexedMatch(id);
  if(!m) return toast('This match is no longer available.','error');
  sendAction('controlClock',{...clockPayload(m),action,seconds});
}
function adjustClock(id,button){
  const inputs=button.closest('details').querySelectorAll('input');
  const mins=readWholeNumber(inputs[0]),secs=readWholeNumber(inputs[1]);
  if(mins==null||secs==null||mins<0||mins>360||secs<0||secs>59||mins*60+secs>21600)
    return toast('Enter a time from 0:00 to 360:00.','error');
  clockAction(id,'adjust',mins*60+secs);
}
function readWholeNumber(input){
  const value=input?.value?.trim();
  return value!=null&&/^\d+$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):null;
}
function clockTick(){
  if(typeof S==='undefined'||!S) return;
  document.querySelectorAll('[data-clock-id]').forEach(box=>{
    const live=indexedMatch(box.dataset.clockId)?.live;
    const time=liveTime(live);
    box.querySelector('.live-clock-time').textContent=formatClock(time);
    box.querySelector('.live-clock-progress span').style.width=Math.min(100,time/((S.duration||90)*600))+'%';
    const detail=box.querySelector('[data-clock-detail]');
    if(live?.period==='half'&&live.breakAt!=null){
      const left=Math.max(0,(S.breakMins??15)*60000-(serverTime()-live.breakAt));
      detail.textContent=left>0?'Break remaining '+formatClock(left):'Break complete · start the second half when ready';
    }
  });
  const min=document.getElementById('g-min');
  if(min?.dataset.auto==='1'&&OPEN_FORM?.mode!=='correct'){
    const live=indexedMatch(OPEN_FORM.id)?.live;
    min.value=String(Math.min(goalMinuteMax(),Math.floor(liveTime(live)/60000)+1));
  }
}
function paintClockState(){clockTick();}
function goalMinManual(el){if(el) delete el.dataset.auto;}
function goalMinAuto(el){if(el&&el.value===''){el.dataset.auto='1';clockTick();}}
function useClockMinute(){const el=document.getElementById('g-min');if(el){el.dataset.auto='1';clockTick();}}
function refreshModalClock(){
  const box=document.querySelector('#mxModal [data-clock-id]');
  const m=OPEN_FORM&&indexedMatch(OPEN_FORM.id);
  if(box&&m) box.outerHTML=liveClockHTML(m,true);
  clockTick();
}
function syncLiveForm(){
  if(!OPEN_FORM) return;
  const F=OPEN_FORM,m=indexedMatch(F.id);
  if(!m||F.seed!==S.seed||m.a!==F.a||m.b!==F.b||m.annulled||MY_ROLE!=='admin'){
    closeMatchForm(true);return;
  }
  refreshModalClock();
  if(F.mode==='correct'&&!F.submitting&&F.scoreVersion!==(m.scoreVersion||0)){closeMatchForm(true);toast('This result was corrected in another session. Open it again to review the latest score.','info');return;}
  if(F.mode==='correct'||F.submitting) return;
  const revision=m.live?.revision||0;
  if(revision!==F.revision){
    const goalsChanged=JSON.stringify(F.goals)!==JSON.stringify(m.live?.goals||[]);
    F.revision=revision;
    F.pendingGoals=false;
    F.goals=(m.live?.goals||[]).map(g=>({...g}));
    if(goalsChanged||F.liveEdited){
      F.editingIdx=null;
      syncGoalScores();
      repaintGoalBox();
      refreshGoalNeed();
      F.liveEdited=false;
    }
  }
}
function syncGoalScores(){
  const F=OPEN_FORM;if(!F) return;
  document.getElementById('ix-sa').value=String(F.goals.filter(g=>g.team===F.a).length);
  document.getElementById('ix-sb').value=String(F.goals.filter(g=>g.team===F.b).length);
}
function commitLiveGoals(){
  const F=OPEN_FORM;
  syncGoalScores();
  if(F.mode==='correct') return;
  const m=indexedMatch(F.id);
  F.pendingGoals=true;F.liveEdited=true;
  if(!sendAction('updateLiveGoals',{...clockPayload(m),revision:F.revision,goals:F.goals})) F.pendingGoals=false;
}
function liveGoalError(){
  const F=OPEN_FORM;
  if(!F) return;
  F.submitting=false;
  if(F.pendingGoals){
    F.pendingGoals=false;F.liveEdited=false;
    const m=indexedMatch(F.id);
    F.goals=(m?.live?.goals||[]).map(g=>({...g}));
    F.revision=m?.live?.revision||0;
    syncGoalScores();repaintGoalBox();refreshGoalNeed();
  }
  const btn=document.getElementById('finishMatchButton');
  if(btn){btn.disabled=false;btn.textContent=F.mode==='correct'?'Save correction':'Save final score';}
}
setInterval(clockTick,250);
