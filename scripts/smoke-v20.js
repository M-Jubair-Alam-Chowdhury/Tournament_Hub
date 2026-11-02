'use strict';
/* Quick smoke test for the v2.0 flow: instant spectate, corner-button
   login (claimHost + token), and the 45' auto-whistle with extra time. */
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),WS=require('ws');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-v20-smoke-'));
const port=4127;
let child;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function boot(env){
  child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),DATA_DIR:dir,ADMIN_TOKENS:env||'',DATABASE_URL:''},stdio:['ignore','pipe','pipe']});
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
    console.log('— open mode (no ADMIN_TOKENS) —');
    await boot('');
    // 1. drop-in visitor spectates right away
    const v1=await open(`ws://127.0.0.1:${port}/football/?viewer=1`);
    await wait(()=>v1.state,'v1 welcome');
    ok(v1.messages[0].role==='guest','drop-in visitor is a spectator (guest)');
    ok(v1.messages[0].state.step==='roster','scoreboard state arrives without any login page');
    // 2. claimHost from the corner button
    await send(v1,'claimHost',{});
    await wait(()=>v1.messages.some(m=>m.type==='authOk'),'authOk');
    await wait(()=>v1.messages.some(m=>m.type==='state'&&m.hasAdmin),'broadcast shows admin');
    ok(true,'claimHost promotes the spectator to host');
    // 3. a second spectator cannot claim
    const v2=await open(`ws://127.0.0.1:${port}/football/?viewer=1`);
    await wait(()=>v2.state,'v2 welcome');
    await send(v2,'claimHost',{});
    await wait(()=>v2.messages.some(m=>m.type==='error'),'error msg');
    ok(/already running/.test(v2.messages.find(m=>m.type==='error').message),'second claim is refused');
    // 4. the /login URL redirects into the app
    const http=await fetch(`http://127.0.0.1:${port}/football/login`,{redirect:'manual'});
    ok(http.status===302&&/\/football\/$/.test(http.headers.get('location')),'/login redirects to the scoreboard');
    const http2=await fetch(`http://127.0.0.1:${port}/football/api/auth-info`);
    ok(http2.status===404,'old auth-info endpoint is gone');
    // 5. football auto-whistle: 2-minute match => first half ends at 1:00.
    //    Set the clock to 0:59 first so the whistle blows ~1s after start.
    await send(v1,'addTeam',{teamName:'Alpha',captain:'A',players:[]});
    await send(v1,'addTeam',{teamName:'Beta',captain:'B',players:[]});
    await send(v1,'submitRoster',{raw:'format: elim',duration:2,breakMins:1});
    await wait(()=>v1.state.step!=='roster'&&v1.state.matchIndex,'drawn');
    const p=()=>{const m=v1.state.matchIndex.matches[0];return {seed:v1.state.seed,a:m.a,b:m.b,roundIndex:0,mi:0,revision:m.live?.revision||0,scoreVersion:m.scoreVersion||0};};
    await send(v1,'controlClock',{...p(),action:'start'});
    await wait(()=>v1.state.matchIndex.matches[0].live?.startedAt!=null,'clock started');
    ok(true,'clock is running');
    await send(v1,'controlClock',{...p(),action:'pause'});
    await wait(()=>v1.state.matchIndex.matches[0].live?.startedAt==null,'clock paused');
    await send(v1,'controlClock',{...p(),action:'adjust',seconds:59});
    await wait(()=>v1.state.matchIndex.matches[0].live?.elapsedMs===59000,'clock adjusted to 0:59');
    await send(v1,'controlClock',{...p(),action:'start'});
    await wait(()=>v1.state.matchIndex.matches[0].live?.startedAt!=null,'clock restarted');
    await wait(()=>v1.state.matchIndex.matches[0].live?.startedAt==null,'auto-stop fired');
    const stopped=v1.state.matchIndex.matches[0].live;
    ok(stopped.elapsedMs===60000,'clock stopped exactly at the 45-equivalent (1:00 of a 2-min match)');
    ok(stopped.period==='first','still first half after the whistle');
    // 6. resume is refused; +1 min extra restarts it
    await send(v1,'controlClock',{...p(),action:'start'});
    await wait(()=>v1.messages.slice(-3).some(m=>m.type==='error'&&/half is over/.test(m.message)),'start refused');
    ok(true,'resume past the line is refused with guidance');
    await send(v1,'controlClock',{...p(),action:'extra',minutes:1});
    await wait(()=>v1.state.matchIndex.matches[0].live?.extraFirst===1,'extra recorded');
    await wait(()=>v1.state.matchIndex.matches[0].live?.startedAt!=null,'clock resumed with extra');
    const live=v1.state.matchIndex.matches[0].live;
    ok(live.extraFirst===1&&live.startedAt!=null,'+1 min extra time resumes play past the line');
    await send(v1,'controlClock',{...p(),action:'pause'});
    // 7. viewer cannot touch the clock
    await send(v2,'controlClock',{...p(),action:'extra',minutes:1});
    await wait(()=>v2.messages.slice(-3).some(m=>m.type==='error'&&/Only the admin/.test(m.message)),'viewer refused');
    ok(true,'spectator cannot add extra time');
    v1.ws.terminate(); v2.ws.terminate();
    await stop();
    fs.rmSync(dir,{recursive:true,force:true});

    console.log('— auth mode (ADMIN_TOKENS set) —');
    const dir2=fs.mkdtempSync(path.join(os.tmpdir(),'hub-v20b-'));
    child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),DATA_DIR:dir2,ADMIN_TOKENS:'secret-token-9',DATABASE_URL:''},stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('boot timeout')),8000);
      child.once('exit',code=>{clearTimeout(timer);reject(Error('exit '+code));});
      child.stdout.on('data',d=>{if(String(d).includes('Tournament Hub')){clearTimeout(timer);resolve();}});
    });
    const g=await open(`ws://127.0.0.1:${port}/table-tennis/?viewer=1`);
    await wait(()=>g.state,'guest welcome');
    ok(g.messages[0].role==='guest'&&g.messages[0].authRequired===true,'token server: visitor spectates');
    // wrong password -> inline authFail
    await send(g,'auth',{token:'wrong'});
    await wait(()=>g.messages.some(m=>m.type==='authFail'),'authFail');
    ok(true,'wrong password is rejected');
    // right password -> admin
    await send(g,'auth',{token:'secret-token-9'});
    await wait(()=>g.messages.some(m=>m.type==='authOk'),'authOk');
    ok(true,'correct password promotes to admin');
    // claimHost is refused on token servers
    const g2=await open(`ws://127.0.0.1:${port}/table-tennis/?viewer=1`);
    await wait(()=>g2.state,'g2 welcome');
    await send(g2,'claimHost',{});
    await wait(()=>g2.messages.some(m=>m.type==='error'&&/admin password/.test(m.message)),'claim refused');
    ok(true,'claimHost is refused on token servers');
    g.ws.terminate(); g2.ws.terminate();
    await stop();
    fs.rmSync(dir2,{recursive:true,force:true});
    console.log(process.exitCode?'— SMOKE FAILED —':'— smoke passed —');
  }catch(e){
    console.error('SMOKE ERROR:',e.message);
    process.exitCode=1;
    try{await stop();}catch(_){}
    fs.rmSync(dir,{recursive:true,force:true});
  }
})();
