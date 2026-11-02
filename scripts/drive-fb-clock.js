'use strict';
/* Drives a football tournament over the wire so the browser can look
   at the live clock: two teams, a 90-minute match, clock running. */
const WS=require('ws');
const port=process.argv[2]||4177;
const token=process.argv[3]||'demo-password-1';
const adjust=parseInt(process.argv[4]||'0',10); // optional: park clock at N seconds
const c={messages:[],state:null};
const ws=new WS(`ws://127.0.0.1:${port}/football/`);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wait=fn=>new Promise((r,j)=>{let i=0;const t=setInterval(()=>{if(fn()){clearInterval(t);r();}if(++i>200){clearInterval(t);j(Error('timeout'));}},20);});
ws.on('message',raw=>{const m=JSON.parse(raw);c.messages.push(m);if(m.state)c.state=m.state;});
const send=(type,payload)=>ws.send(JSON.stringify({type,payload}));
(async()=>{
  await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
  await wait(()=>c.state);
  send('auth',{token});
  await wait(()=>c.messages.some(m=>m.type==='authOk'));
  send('addTeam',{teamName:'Rovers',captain:'Aiden',players:[]});
  send('addTeam',{teamName:'United',captain:'Bruno',players:[]});
  await wait(()=>c.state.teams.length===2);
  send('submitRoster',{raw:'format: elim',duration:90,breakMins:15,name:'Visual Cup'});
  await wait(()=>c.state.step==='play'&&c.state.matchIndex);
  const p=()=>{const m=c.state.matchIndex.matches[0];return {seed:c.state.seed,a:m.a,b:m.b,roundIndex:0,mi:0,revision:m.live?.revision||0,scoreVersion:m.scoreVersion||0};};
  send('controlClock',{...p(),action:'start'});
  await wait(()=>c.state.matchIndex.matches[0].live?.startedAt!=null);
  if(adjust>0){
    send('controlClock',{...p(),action:'pause'});
    await wait(()=>c.state.matchIndex.matches[0].live?.startedAt==null);
    send('controlClock',{...p(),action:'adjust',seconds:adjust});
    await wait(()=>c.state.matchIndex.matches[0].live?.elapsedMs===adjust*1000);
    send('controlClock',{...p(),action:'start'});
    await wait(()=>c.state.matchIndex.matches[0].live?.startedAt!=null);
  }
  console.log('READY:',JSON.stringify({step:c.state.step,live:c.state.matchIndex.matches[0].live}));
  ws.close();
  process.exit(0);
})().catch(e=>{console.error('DRIVER ERROR:',e.message);process.exit(1);});
