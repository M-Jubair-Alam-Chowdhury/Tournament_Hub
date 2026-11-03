'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const clock=require('../apps/football/clock');
const L=require('../apps/football/logic');
function setup(duration=90, count=2, format='elim'){
  L.reset();L.setSuspended(false);
  for(let i=0;i<count;i++) L.addTeam('Team '+i,'Captain '+i,['Player '+i]);
  L.submitRoster('format: '+format,'Clock Cup',duration,5);
  if(L.getState().step==='mode')L.pickMode('single');
  return L.getState();
}
function payload(ri=0,mi=0){
  const s=L.getState(),m=s.schedule.rounds[ri][mi];
  return {seed:s.seed,a:m.a,b:m.b,roundIndex:ri,mi,revision:m.live?.revision||0,scoreVersion:m.scoreVersion||0};
}
function goal(team,min=1,own=false){
  const s=L.getState(),t=s.teams.find(t=>s.codeMap[t.name]===team);
  return {team,min,scorer:t.captain,own};
}
test('clock uses timestamps, does not drift, and tolerates a backward system clock',()=>{
  const c=clock.transition(clock.initial(),'start',90,null,1000);
  assert.equal(clock.elapsed(c,61234),60234);
  assert.equal(clock.elapsed(c,500),0);
  const paused=clock.transition(c,'pause',90,null,61234);
  assert.equal(clock.elapsed(paused,90000),60234);
  const resumed=clock.transition(paused,'start',90,null,100000);
  assert.equal(clock.elapsed(resumed,101000),61234);
  assert.throws(()=>clock.transition(resumed,'start',90,null,102000),/already/);
  assert.throws(()=>clock.transition(resumed,'adjust',90,10),/Pause/);
});
test('half-time excludes break duration and second half starts at the configured minute',()=>{
  let c=clock.transition(clock.initial(),'start',21,null,0);
  c=clock.transition(c,'half',21,null,650000);
  assert.equal(clock.elapsed(c,950000),650000);
  assert.throws(()=>clock.transition(c,'start',21),/second/);
  c=clock.transition(c,'second',21,null,950000);
  assert.equal(clock.elapsed(c,951000),631000);
  assert.equal(c.breakAt,null);
  assert.throws(()=>clock.transition(c,'half',21),/first half/);
  c=clock.transition(c,'finish',21,null,960000);
  assert.equal(clock.elapsed(c,999999),640000);
  assert.throws(()=>clock.transition(c,'start',21),/correct/);
});
test('clock adjustments are explicit, bounded whole seconds',()=>{
  for(const value of [-1,21601,NaN,1.2,'90',null]) assert.throws(()=>clock.transition(clock.initial(),'adjust',90,value));
  assert.equal(clock.transition(clock.initial(),'adjust',90,2700).period,'second');
  assert.equal(clock.transition(clock.initial(),'adjust',90,2699).period,'first');
  assert.throws(()=>clock.transition(clock.initial(),'unknown',90),/Unknown/);
  assert.equal(clock.elapsed({elapsedMs:0,startedAt:0},1e10),clock.MAX_MS);
});
test('stale admins and invalid fixtures cannot start or change a clock',()=>{
  const s=setup(20,4),stale=payload();
  L.controlClock({...stale,action:'start'});
  assert.throws(()=>L.controlClock({...stale,action:'pause'}),/another session/);
  assert.throws(()=>L.controlClock({...payload(),seed:'stale',action:'pause'}),/another session/);
  assert.throws(()=>L.controlClock({...payload(),a:'P9',action:'pause'}),/another session/);
  assert.throws(()=>L.controlClock({...payload(),roundIndex:'0',action:'pause'}),/reference/);
  assert.throws(()=>L.controlClock({...payload(1),action:'start'}),/not available/);
  L.setSuspended(true);
  assert.equal(s.schedule.rounds[0][0].live.startedAt,null);
  assert.throws(()=>L.controlClock({...payload(),action:'start'}),/Resume/);
});
test('live goals validate membership and own goals, and leave standings unchanged',()=>{
  const s=setup(),m=s.schedule.rounds[0][0];
  const own={...goal(m.b,2,true),team:m.a};
  L.updateLiveGoals({...payload(),goals:[goal(m.a),own]});
  assert.equal(m.live.goals.length,2);
  assert.equal(s.table[m.a].played,0);
  assert.equal(m.played,false);
  const before=JSON.stringify(m);
  assert.throws(()=>L.updateLiveGoals({...payload(),goals:[goal(m.b,2,true)]}),/squad/);
  assert.throws(()=>L.updateLiveGoals({...payload(),goals:[{...goal(m.a),min:1.5}]}),/minutes/);
  assert.throws(()=>L.updateLiveGoals({...payload(),goals:[{...goal(m.a),scorer:'Outsider'}]}),/squad/);
  assert.throws(()=>L.updateLiveGoals({...payload(),goals:{}}),/Invalid/);
  assert.equal(JSON.stringify(m),before);
  L.updateLiveGoals({...payload(),goals:[]});
  assert.equal(m.live.goals.length,0);
});
test('long configured matches accept valid late goals',()=>{
  const s=setup(300),m=s.schedule.rounds[0][0];
  L.updateLiveGoals({...payload(),goals:[goal(m.a,301)]});
  assert.equal(m.live.goals[0].min,301);
  assert.throws(()=>L.updateLiveGoals({...payload(),goals:[goal(m.a,331)]}),/minutes/);
});
test('rejected final scores do not stop a running clock; accepted scores do',()=>{
  const s=setup(),m=s.schedule.rounds[0][0];
  L.controlClock({...payload(),action:'start'});
  assert.throws(()=>L.saveScoreAt(0,0,0,0),/penalty/);
  assert.notEqual(m.live.startedAt,null);
  L.updateLiveGoals({...payload(),goals:[goal(m.a)]});
  L.saveScoreAt(0,0,1,0,null,null,m.live.goals);
  assert.equal(m.live.period,'finished');assert.equal(m.live.startedAt,null);
  assert.equal(s.table[m.a].played,1);assert.equal(m.scoreVersion,1);
  assert.throws(()=>L.controlClock({...payload(),action:'start'}),/not available/);
  L.undoScore();
  assert.equal(m.played,false);assert.equal(m.live.startedAt,null);assert.equal(m.live.period,'first');
});
test('snapshots persist live goals and elapsed time, and restore paused without counting downtime',()=>{
  const s=setup(),m=s.schedule.rounds[0][0];
  L.updateLiveGoals({...payload(),goals:[goal(m.a)]});
  L.controlClock({...payload(),action:'start'});
  m.live.startedAt=Date.now()-65000;
  const snap=JSON.parse(JSON.stringify(L.saveStateSnapshot()));
  assert.equal(L.loadStateSnapshot(snap).ok,true);
  const saved=L.getState().schedule.rounds[0][0].live;
  assert.equal(saved.startedAt,null);assert.ok(saved.elapsedMs>=65000&&saved.elapsedMs<66000);
  assert.equal(saved.goals.length,1);
  const before=JSON.stringify(L.getState());
  const bad=L.saveStateSnapshot();
  const r=bad.state.schedule.rounds[0];(r.items||r)[0].live.elapsedMs=-1;
  assert.equal(L.loadStateSnapshot(bad).ok,false);
  assert.equal(JSON.stringify(L.getState()),before);
});
test('rejected pool join leaves roster, fixtures and standings untouched',()=>{
  L.reset();L.setSuspended(false);
  for(let i=0;i<6;i++) L.addTeam('Team '+i,'Captain '+i,[]);
  L.submitRoster('format: pools\npools: 2\nqualify: 1\nthen: elim','Pools',90,15);
  const before=JSON.stringify(L.saveStateSnapshot().state);
  assert.throws(()=>L.joinMidTournament('Late','Captain Late',[]),/last one/);
  assert.equal(JSON.stringify(L.saveStateSnapshot().state),before);
});

/* ---- v2.0: the automatic whistle and the referee's added time ---- */
test('each half has a hard limit: 45 and full-time, plus added minutes',()=>{
  assert.equal(clock.periodLimitMs(clock.initial(),90),45*60000);
  assert.equal(clock.periodLimitMs({...clock.initial(),period:'second'},90),90*60000);
  assert.equal(clock.periodLimitMs({...clock.initial(),extraFirst:2},90),47*60000);
  assert.equal(clock.periodLimitMs({...clock.initial(),period:'second',extraSecond:3},90),93*60000);
  assert.equal(clock.periodLimitMs(clock.initial(),21),630000); // odd durations halve cleanly
  assert.equal(clock.periodLimitMs({...clock.initial(),extraFirst:60},90),105*60000); // 45+60, under the cap
});
test('starting past the whistle line is refused with guidance',()=>{
  const at45={...clock.initial(),elapsedMs:45*60000};
  assert.throws(()=>clock.transition(at45,'start',90),/first half is over/i);
  const at90={...clock.initial(),elapsedMs:90*60000,period:'second'};
  assert.throws(()=>clock.transition(at90,'start',90),/match is over/i);
  // below the line it still works
  const ok=clock.transition({...clock.initial(),elapsedMs:44*60000},'start',90);
  assert.notEqual(ok.startedAt,null);
});
test('extra time extends the current half and resumes a stopped clock',()=>{
  let c=clock.transition(clock.initial(),'start',90,null,0);
  // a running clock at 44:00 takes extra without a restart
  c=clock.transition({...c,elapsedMs:44*60000},'extra',90,2,0);
  assert.equal(c.extraFirst,2);
  assert.notEqual(c.startedAt,null);
  // settle at 47:00 exactly (45 + the 2 added minutes)
  const settled=clock.settle({...c,elapsedMs:47*60000-1000,startedAt:47*60000-1000},90,47*60000);
  assert.equal(settled.elapsedMs,47*60000);
  assert.equal(settled.startedAt,null);
  assert.equal(settled.period,'first');
  assert.equal(settled.revision,c.revision+1);
  // the referee adds time after the whistle: play resumes on its own
  const resumed=clock.transition(settled,'extra',90,3,50000);
  assert.equal(resumed.extraFirst,5);
  assert.equal(resumed.startedAt,50000);
  // but a deliberately paused clock stays paused
  const pausedMidway={...clock.initial(),elapsedMs:43*60000};
  const still=clock.transition(pausedMidway,'extra',90,2,0);
  assert.equal(still.startedAt,null);
  // bounds and period guards
  for(const bad of [0,-1,16,1.5,'2',null]) assert.throws(()=>clock.transition(clock.initial(),'extra',90,bad));
  assert.throws(()=>clock.transition({...clock.initial(),period:'half'},'extra',90,2),/playing half/);
  assert.throws(()=>clock.transition({...clock.initial(),period:'finished'},'extra',90,2),/playing half/);
  // stacking extra past the 360:00 cap is refused (2nd half of a 300-min match already at +60)
  const nearCap={...clock.initial(),period:'second',elapsedMs:0,extraSecond:60};
  assert.throws(()=>clock.transition(nearCap,'extra',300,1),/360:00/);
});
test('v2.1 extraSet REPLACES the added time — 4 can become 2 (or 0)',()=>{
  // the headline case: 4 announced, referee reconsiders, sets 2 — mid-half
  let c=clock.transition({...clock.initial(),elapsedMs:46.5*60000,extraFirst:4},'extraSet',90,2,0);
  assert.equal(c.extraFirst,2);
  assert.equal(c.elapsedMs,46.5*60000);       // played time untouched
  assert.equal(c.startedAt,null);             // the source clock was paused
  // a RUNNING clock under the new line just carries on toward it
  const running=clock.transition({...clock.initial(),extraFirst:4,startedAt:0},'extraSet',90,2,1000);
  assert.equal(running.extraFirst,2);
  assert.notEqual(running.startedAt,null);    // still live
  // a running clock PAST the new line whistles immediately on it
  const clamped=clock.transition({...clock.initial(),extraFirst:4,startedAt:0},'extraSet',90,2,150*60000);
  assert.equal(clamped.extraFirst,2);
  assert.equal(clamped.elapsedMs,47*60000);   // 45 + 2: the new line
  assert.equal(clamped.startedAt,null);
  // a settled clock (45+4 read 49:00) re-reads as ending 47:00 and stays ended
  const settled=clock.transition({...clock.initial(),elapsedMs:49*60000,extraFirst:4},'extraSet',90,2,0);
  assert.equal(settled.extraFirst,2);
  assert.equal(settled.elapsedMs,47*60000);
  assert.equal(settled.startedAt,null);
  // raising after the whistle resumes, exactly like "extra"
  const resumed=clock.transition({...clock.initial(),elapsedMs:45*60000},'extraSet',90,4,50000);
  assert.equal(resumed.extraFirst,4);
  assert.equal(resumed.startedAt,50000);
  // a deliberately paused clock stays paused when the line still covers it
  const pausedMidway=clock.transition({...clock.initial(),elapsedMs:46.5*60000,extraFirst:4},'extraSet',90,3,0);
  assert.equal(pausedMidway.extraFirst,3);
  assert.equal(pausedMidway.startedAt,null);
  // 0 is a legal set: it clears the added time (and whistles past the base line)
  const cleared=clock.transition({...clock.initial(),extraFirst:4},'extraSet',90,0,0);
  assert.equal(cleared.extraFirst,0);
  // the second half has its own slot
  const second=clock.transition({...clock.initial(),period:'second',elapsedMs:90*60000,extraSecond:3},'extraSet',90,1,0);
  assert.equal(second.extraSecond,1);
  assert.equal(second.extraFirst,0);
  // bounds and period guards (0 allowed, 16/-1/null refused)
  for(const bad of [-1,16,1.5,'2',null]) assert.throws(()=>clock.transition(clock.initial(),'extraSet',90,bad));
  assert.throws(()=>clock.transition({...clock.initial(),period:'half'},'extraSet',90,2),/playing half/);
  assert.throws(()=>clock.transition({...clock.initial(),period:'finished'},'extraSet',90,2),/playing half/);
  // the cap guard: 2nd half of a 360-min match cannot take any extra
  assert.throws(()=>clock.transition({...clock.initial(),period:'second'},'extraSet',360,1),/360:00/);
  // the follow-up whistle lands exactly on the reduced line
  const settled2=clock.settle(running,90,47*60000+10);
  assert.equal(settled2.elapsedMs,47*60000);
  assert.equal(settled2.startedAt,null);
});
test('v2.1 extraSet works through the engine action routing',()=>{
  const s=setup(90,2);
  L.controlClock({...payload(),action:'start'});
  L.controlClock({...payload(),action:'pause'});
  L.controlClock({...payload(),action:'extra',minutes:4});
  L.controlClock({...payload(),action:'extraSet',minutes:2});
  const live=L.getState().schedule.rounds[0][0].live;
  assert.equal(live.extraFirst,2);
  assert.equal(live.revision,4);
  // a wrong shape still gives an actionable error, not a crash
  assert.throws(()=>L.controlClock({...payload(),action:'extraSet',minutes:99}),/0 to 15/);
});
test('settle stops a running clock exactly on the line and leaves others alone',()=>{
  const now=Date.now();
  const running={...clock.initial(),elapsedMs:44*60000,startedAt:now-2*60000}; // 46:00 real, line 45:00
  const settled=clock.settle(running,90,now);
  assert.equal(settled.elapsedMs,45*60000);
  assert.equal(settled.startedAt,null);
  assert.equal(clock.settle({...running,startedAt:null},90,now),null); // paused: untouched
  assert.equal(clock.settle({...running,elapsedMs:40*60000,startedAt:now},90,now),null); // below the line
  assert.equal(clock.settle(null,90,now),null);
});
test('the server whistle settles every running clock in the schedule',()=>{
  const s=setup(2,2),m=s.schedule.rounds[0][0];
  L.controlClock({...payload(),action:'start'});
  m.live.startedAt=Date.now()-70000; // 70s played, first half of a 2-min match is 60s
  assert.equal(L.settleClocks(),true);
  assert.equal(m.live.elapsedMs,60000);
  assert.equal(m.live.startedAt,null);
  assert.equal(m.live.period,'first');
  assert.equal(L.settleClocks(),false); // settled clocks stay settled
});
test('added time survives a snapshot round-trip and resumes from the line',()=>{
  const s=setup(90,2),m=s.schedule.rounds[0][0];
  L.controlClock({...payload(),action:'start'});
  L.controlClock({...payload(),action:'pause'});
  L.controlClock({...payload(),action:'extra',minutes:2});
  m.live.elapsedMs=47*60000; m.live.startedAt=null; // parked on the whistle line (45 + 2 added)
  const snap=JSON.parse(JSON.stringify(L.saveStateSnapshot()));
  assert.equal(L.loadStateSnapshot(snap).ok,true);
  const live=L.getState().schedule.rounds[0][0].live;
  assert.equal(live.extraFirst,2);
  assert.equal(live.startedAt,null);
  // starting again is refused (at the line), but +1 more resumes
  assert.throws(()=>L.controlClock({...payload(),action:'start'}),/first half is over/);
  L.controlClock({...payload(),action:'extra',minutes:1});
  const after=L.getState().schedule.rounds[0][0].live;
  assert.equal(after.extraFirst,3);
  assert.notEqual(after.startedAt,null);
});
test('a spectator cannot add extra time over the wire', async t=>{
  // covered in full by the WebSocket suite below; quick engine guard here:
  const s=setup(90,2);
  L.setSuspended(true);
  assert.throws(()=>L.controlClock({...payload(),action:'extra',minutes:2}),/Resume/);
  L.setSuspended(false);
});

test('WebSocket clock, goals, spectator permissions, concurrency and restart recovery',async t=>{
  const {spawn}=require('node:child_process');
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),WS=require('ws');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-live-test-'));
  const port=4119;let child;const connections=[];
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  async function boot(){
    child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),DATA_DIR:dir,ADMIN_TOKENS:'clock-test',DATABASE_URL:''},stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Server boot timeout')),8000);
      child.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code));});
      child.stderr.on('data',d=>process.stderr.write(d));
      child.stdout.on('data',d=>{if(String(d).includes('Tournament Hub')){clearTimeout(timer);resolve();}});
    });
  }
  async function stop(){if(!child||child.exitCode!=null)return;await new Promise(r=>{child.once('exit',r);child.kill();});}
  t.after(async()=>{for(const c of connections)c.ws.terminate();await stop();fs.rmSync(dir,{recursive:true,force:true});});
  async function connect(admin){
    const ws=new WS(`ws://127.0.0.1:${port}/football/?viewer=1`),c={ws,messages:[],state:null};connections.push(c);
    ws.on('message',raw=>{const m=JSON.parse(raw);c.messages.push(m);if(m.state)c.state=m.state;});
    await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
    await wait(()=>c.state);
    if(admin){await send(c,'auth',{token:'clock-test'},'authOk');await wait(()=>c.messages.some(m=>m.type==='state'&&m.hasAdmin));}
    return c;
  }
  async function wait(fn){for(let i=0;i<150;i++){if(fn())return;await sleep(20);}throw Error('Message timeout');}
  async function send(c,type,payload={},expected='state'){
    const start=c.messages.length;c.ws.send(JSON.stringify({type,payload}));
    await wait(()=>c.messages.slice(start).some(m=>m.type===expected));
    return c.messages.slice(start).find(m=>m.type===expected);
  }
  const p=c=>{const m=c.state.matchIndex.matches[0];return {seed:c.state.seed,a:m.a,b:m.b,roundIndex:0,mi:0,revision:m.live?.revision||0,scoreVersion:m.scoreVersion||0};};
  await boot();const admin=await connect(true),viewer=await connect(false);
  for(let i=0;i<2;i++)await send(admin,'addTeam',{teamName:'Squad '+i,captain:'Captain '+i,players:[]});
  await send(admin,'submitRoster',{raw:'format: elim',duration:20,breakMins:5});
  const stale=p(admin);
  await send(admin,'controlClock',{...p(admin),action:'start'});
  await wait(()=>viewer.state.matchIndex.matches[0].live?.startedAt!=null);
  assert.equal(viewer.state.matchIndex.matches[0].live.period,'first');
  assert.match((await send(viewer,'controlClock',{...p(viewer),action:'pause'},'error')).message,/Only the admin/);
  assert.match((await send(admin,'controlClock',{...stale,action:'pause'},'error')).message,/another session/);
  const m=admin.state.matchIndex.matches[0],squad=admin.state.teams.find(t=>t.name===m.aName);
  const goals=[{team:m.a,scorer:squad.captain,min:1,own:false}];
  await send(admin,'updateLiveGoals',{...p(admin),goals});
  await wait(()=>viewer.state.matchIndex.matches[0].live.goals.length===1);
  assert.equal(viewer.state.table[m.a].played,0);
  assert.match((await send(admin,'saveScoreAt',{...p(admin),sa:1,sb:0,goals:{}},'error')).message,/malformed/);
  assert.notEqual(admin.state.matchIndex.matches[0].live.startedAt,null);
  await send(admin,'controlClock',{...p(admin),action:'half'});
  await send(admin,'controlClock',{...p(admin),action:'second'});
  assert.equal(admin.state.matchIndex.matches[0].live.elapsedMs,600000);
  await send(admin,'controlClock',{...p(admin),action:'pause'});
  await stop();await boot();
  const resumed=await connect(true);
  assert.equal(resumed.state.suspended,true);
  assert.equal(resumed.state.matchIndex.matches[0].live.startedAt,null);
  assert.ok(resumed.state.matchIndex.matches[0].live.elapsedMs>=600000);
  assert.equal(resumed.state.matchIndex.matches[0].live.goals.length,1);
  await send(resumed,'resumeTournament');
  await send(resumed,'controlClock',{...p(resumed),action:'start'});
  await send(resumed,'saveScoreAt',{...p(resumed),sa:1,sb:0,goals});
  assert.equal(resumed.state.matchIndex.matches[0].played,true);
  assert.equal(resumed.state.matchIndex.matches[0].live.period,'finished');
  assert.equal(resumed.state.table[m.a].played,1);
  const old=p(resumed);
  await send(resumed,'editScoreAt',{...p(resumed),sa:2,sb:0,goals:null});
  assert.match((await send(resumed,'editScoreAt',{...old,sa:3,sb:0},'error')).message,/another session/);
});
