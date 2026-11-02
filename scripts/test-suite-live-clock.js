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
