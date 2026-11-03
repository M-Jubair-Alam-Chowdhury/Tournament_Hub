'use strict';
/* Smoke test for the v2.1 flow: the pool draft board (hand-drawn pools
   over the wire) and extraSet — the referee replacing announced added
   time (4 min -> 2 min) with the whistle landing on the new line. */
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),WS=require('ws');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-v21-smoke-'));
const port=4131;
let child;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function boot(){
  child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),DATA_DIR:dir,ADMIN_TOKENS:'',DATABASE_URL:''},stdio:['ignore','pipe','pipe']});
  child.stderr.on('data',d=>process.stderr.write(d));
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('boot timeout')),8000);
    child.once('exit',code=>{clearTimeout(timer);reject(Error('exit '+code));});
    child.stdout.on('data',d=>{if(String(d).includes('Tournament Hub')){clearTimeout(timer);resolve();}});
  });
}
async function stop(){ if(!child||child.exitCode!=null)return; await new Promise(r=>{child.once('exit',r);child.kill();}); }
function open(url){
  const ws=new WS(url),c={ws,messages:[],state:null};
  ws.on('message',raw=>{const m=JSON.parse(raw);c.messages.push(m);if(m.state)c.state=m.state;});
  ws.on('error',()=>{});
  return new Promise((r,j)=>{ws.once('open',()=>r(c));ws.once('error',j);});
}
async function wait(fn,desc){ for(let i=0;i<200;i++){ if(fn())return true; await sleep(20);} throw Error('timeout: '+desc); }
async function send(c,type,payload){ c.ws.send(JSON.stringify({type,payload})); }
const ok=(cond,msg)=>{ if(cond)console.log('  ✓',msg); else {console.log('  ✗ FAIL:',msg); process.exitCode=1;} };

(async()=>{
  try{
    console.log('— v2.1: pool draft board + adjustable added time —');
    await boot();
    const admin=await open(`ws://127.0.0.1:${port}/football/?viewer=1`);
    await wait(()=>admin.state,'welcome');
    await send(admin,'claimHost',{});
    await wait(()=>admin.messages.some(m=>m.type==='authOk'),'host claimed');
    // six teams, no directives -> the stage-choice screen
    for(const n of ['Alpha','Beta','Gamma','Delta','Epsilon','Zeta'])
      await send(admin,'addTeam',{teamName:n,captain:'C'+n,players:[]});
    await send(admin,'submitRoster',{raw:'',duration:4,breakMins:1}); // 4-min match: halves at 2:00
    await wait(()=>admin.state.step==='stageChoice','stage choice');
    ok(admin.state.stageChoice.entrants.length===6,'six entrants registered');
    // the draft board's message: hand-drawn pools with names + per-pool qualify
    await send(admin,'pickStage',{format:'pools',pools:[
      {name:'North',members:['P1','P2','P3'],qualify:1},
      {name:'South',members:['P4','P5','P6'],qualify:2}
    ]});
    await wait(()=>admin.state.step==='play','pools built');
    const st=admin.state.stages[0];
    ok(st.pools.length===2&&st.pools[0].name==='North'&&st.pools[1].name==='South','hand-drawn pools with custom names are live');
    ok(st.pools[1].qualify===2,'per-pool qualifier counts land (South sends 2)');
    const labels=Object.values(admin.state.schedule.roundMeta.stageLabel||{});
    ok(labels.some(l=>/North/.test(l))&&labels.some(l=>/South/.test(l)),'round headers carry the pool names on the wire');
    // a malformed board is rejected with an actionable message
    await send(admin,'reset',{});
    await wait(()=>admin.state.step==='roster','reset');
    for(const n of ['Alpha','Beta','Gamma','Delta'])
      await send(admin,'addTeam',{teamName:n,captain:'C'+n,players:[]});
    await send(admin,'submitRoster',{raw:'',duration:4,breakMins:1});
    await wait(()=>admin.state.step==='stageChoice','stage choice 2');
    await send(admin,'pickStage',{format:'pools',pools:[
      {name:'A',members:['P1','P2','P3']},
      {name:'B',members:['P3','P4']}
    ]});
    await wait(()=>admin.messages.slice(-4).some(m=>m.type==='error'&&/two pools/.test(m.message)),'dup rejected');
    ok(true,'a team placed in two pools is rejected over the wire');
    // rebuild valid pools for the clock part
    await send(admin,'pickStage',{format:'pools',pools:[
      {name:'A',members:['P1','P2'],qualify:1},
      {name:'B',members:['P3','P4'],qualify:1}
    ]});
    await wait(()=>admin.state.step==='play','pools built 2');
    const p=()=>{const m=admin.state.matchIndex.matches[0];return {seed:admin.state.seed,a:m.a,b:m.b,roundIndex:m.roundIndex,mi:m.mi,revision:m.live?.revision||0,scoreVersion:m.scoreVersion||0};};
    // park the clock one second under the 2:00 half-line, then run to the whistle
    await send(admin,'controlClock',{...p(),action:'adjust',seconds:119});
    await wait(()=>admin.state.matchIndex.matches[0].live?.elapsedMs===119000,'parked at 1:59');
    await send(admin,'controlClock',{...p(),action:'start'});
    await wait(()=>admin.state.matchIndex.matches[0].live?.startedAt!=null,'clock running');
    await wait(()=>admin.state.matchIndex.matches[0].live?.startedAt==null,'whistle at 2:00');
    ok(admin.state.matchIndex.matches[0].live.elapsedMs===120000,'whistle exactly on the half line (2:00)');
    // referee announces 2 minutes of added time -> play resumes
    await send(admin,'controlClock',{...p(),action:'extraSet',minutes:2});
    await wait(()=>admin.state.matchIndex.matches[0].live?.extraFirst===2,'extra set to 2');
    await wait(()=>admin.state.matchIndex.matches[0].live?.startedAt!=null,'resumed with the raise');
    ok(true,'extraSet raises the allowance and play resumes after the whistle');
    // ...then takes the time back UNDER the played clock: the half ends
    // on the new line the moment the allowance shrinks below it
    await sleep(600); // the clock ticks just past 2:00
    await send(admin,'controlClock',{...p(),action:'extraSet',minutes:0});
    await wait(()=>admin.state.matchIndex.matches[0].live?.startedAt==null,'immediate whistle');
    const clamped=admin.state.matchIndex.matches[0].live;
    ok(clamped.extraFirst===0&&clamped.elapsedMs===120000&&clamped.startedAt==null,
       'clearing the allowance under the played time whistles on the base line (2:00)');
    // re-raising after that whistle resumes play again — 1 minute now
    await send(admin,'controlClock',{...p(),action:'extraSet',minutes:1});
    await wait(()=>admin.state.matchIndex.matches[0].live?.extraFirst===1&&admin.state.matchIndex.matches[0].live?.startedAt!=null,'resumed with 1 min');
    ok(true,'re-raising the allowance resumes the ended half');
    // pause, then clear the allowance: the half ends on the base line and stays ended
    await send(admin,'controlClock',{...p(),action:'pause'});
    await wait(()=>admin.state.matchIndex.matches[0].live?.startedAt==null,'paused');
    await send(admin,'controlClock',{...p(),action:'extraSet',minutes:0});
    await wait(()=>admin.state.matchIndex.matches[0].live?.extraFirst===0,'extra cleared');
    const ended=admin.state.matchIndex.matches[0].live;
    ok(ended.startedAt==null&&ended.elapsedMs===120000,'clearing the allowance ends the half on the base line and leaves it ended');
    // a spectator gets an actionable refusal, not a crash
    const viewer=await open(`ws://127.0.0.1:${port}/football/?viewer=1`);
    await wait(()=>viewer.state,'viewer welcome');
    await send(viewer,'controlClock',{...p(),action:'extraSet',minutes:2});
    await wait(()=>viewer.messages.slice(-3).some(m=>m.type==='error'&&/Only the admin/.test(m.message)),'viewer refused');
    ok(true,'a spectator cannot change the added time');
    admin.ws.terminate(); viewer.ws.terminate();
    await stop();
    fs.rmSync(dir,{recursive:true,force:true});
    console.log(process.exitCode?'— SMOKE FAILED —':'— smoke passed —');
  }catch(e){
    console.error('SMOKE ERROR:',e.message);
    process.exitCode=1;
    try{await stop();}catch(_){}
    fs.rmSync(dir,{recursive:true,force:true});
  }
})();
