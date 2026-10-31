/* Football tournament logic — server-side, authoritative.
   Plain arguments in, errors out; the WebSocket server drives it.

   v1.1 multi-stage tournaments + roster directives + H2H ladder
   v1.2 choice system (who advances, seeding, pool splits) + events
   v1.3 full-state snapshots (save/load/resume)
   v1.4 play-in qualifiers, point-limit scoring, standings ladders */

function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
// Deterministic shuffle: same seed string -> same order everywhere.
function seededShuffle(arr, seedStr){
  let h=2166136261>>>0;
  for(let i=0;i<seedStr.length;i++){ h^=seedStr.charCodeAt(i); h=Math.imul(h,16777619)>>>0; }
  const rand=()=>{ h^=h<<13; h>>>=0; h^=h>>>17; h^=h<<5; h>>>=0; return h/4294967296; };
  const a=arr.slice();
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(rand()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
function isPowerOfTwo(n){ return n>0 && (n & (n-1))===0; }
function v2(n){ let k=0; while(n%2===0){ n/=2; k++; } return k; }
function nextPow2(n){ let p=1; while(p<n) p*=2; return p; }

function assignCodes(names){
  const codeMap={}, codeToName={};
  names.forEach((name,i)=>{ const c="P"+(i+1); codeMap[name]=c; codeToName[c]=name; });
  return {codeMap, codeToName};
}

function countMatches(n){
  if(n%2!==0) return {type:"round-robin", matches:n*(n-1)/2};
  if(isPowerOfTwo(n)) return {type:"elimination", matches:n-1};
  const k=v2(n), m=n/Math.pow(2,k);
  const elim=n-m, rr=m*(m-1)/2, final=1;
  return {type:"hybrid", matches:elim+rr+final, elim, rr, final, m, k};
}

function generateRoundRobin(list){
  let arr=list.slice();
  let n=arr.length;
  if(n%2!==0){ arr.push("BYE"); n++; }
  const numRounds=n-1, half=n/2;
  const fixed=arr[0];
  let rotating=arr.slice(1);
  const rounds=[];
  for(let r=0;r<numRounds;r++){
    const current=[fixed,...rotating];
    const matches=[];
    for(let i=0;i<half;i++){
      const a=current[i], b=current[n-1-i];
      if(a!=="BYE" && b!=="BYE") matches.push({a,b,played:false});
    }
    rounds.push(matches);
    rotating.unshift(rotating.pop());
  }
  return rounds;
}

function generateEliminationBracket(list){
  const n=list.length;
  const shuffled=shuffle(list);
  const rounds=[];
  const round1=[];
  for(let i=0;i<n/2;i++) round1.push({a:shuffled[2*i], b:shuffled[2*i+1], played:false});
  rounds.push(round1);
  const numRounds=Math.log2(n);
  let matchesInRound=n/4;
  for(let r=2;r<=numRounds;r++){
    const arr=[];
    for(let i=0;i<matchesInRound;i++) arr.push({a:null,b:null,played:false});
    rounds.push(arr);
    matchesInRound/=2;
  }
  return rounds;
}

// Knockout bracket from an ORDERED seed list: pad with BYEs to the
// next power of two, top seeds face the byes, walkovers auto-play.
function buildSeededBracket(ordered){
  const list=ordered.filter(c=>c && c!=="BYE");
  if(list.length<2) throw new Error("A bracket needs at least 2 entrants.");
  const P=nextPow2(list.length);
  const seeds=list.slice();
  for(let i=list.length;i<P;i++) seeds.push("BYE");
  const rounds=[];
  const round1=[];
  for(let i=0;i<P/2;i++) round1.push({a:seeds[i], b:seeds[P-1-i], played:false});
  rounds.push(round1);
  const numRounds=Math.log2(P);
  let matchesInRound=P/4;
  for(let r=2;r<=numRounds;r++){
    const arr=[];
    for(let i=0;i<matchesInRound;i++) arr.push({a:null,b:null,played:false});
    rounds.push(arr);
    matchesInRound/=2;
  }
  // BYE matches auto-resolve as a 3-0 walkover (football convention).
  const walk=3;
  round1.forEach(m=>{
    if(m.a==="BYE" || m.b==="BYE"){
      const byeSide = m.a==="BYE";
      m.played=true;
      m.winner = byeSide ? m.b : m.a;
      m.scoreA = byeSide ? 0 : walk;
      m.scoreB = byeSide ? walk : 0;
    }
  });
  return rounds;
}

function advanceRound(rounds, roundIndex, winners){
  const next=rounds[roundIndex+1];
  for(let i=0;i<winners.length/2;i++){
    next[i].a=winners[2*i];
    next[i].b=winners[2*i+1];
  }
}

function buildSchedule(entities){
  const n=entities.length;
  if(n%2!==0){
    const rrRounds=generateRoundRobin(entities);
    return {kind:"rr", rounds:rrRounds, rrTotal:rrRounds.length};
  }
  if(isPowerOfTwo(n)) return {kind:"elim", rounds:generateEliminationBracket(entities)};
  const k=v2(n);
  const shuffled=shuffle(entities);
  const rounds=[];
  const round1=[];
  for(let i=0;i<shuffled.length/2;i++) round1.push({a:shuffled[2*i], b:shuffled[2*i+1], played:false});
  rounds.push(round1);
  let remaining=shuffled.length/2;
  for(let r=2;r<=k;r++){
    const arr=[];
    for(let i=0;i<remaining/2;i++) arr.push({a:null,b:null,played:false});
    rounds.push(arr);
    remaining/=2;
  }
  return {kind:"hybrid", rounds, k};
}

function buildForbiddenMap(pairs, codeMap){
  const forbidden={};
  pairs.forEach(([nameX,nameY])=>{
    const cx=codeMap[nameX], cy=codeMap[nameY];
    (forbidden[cx]=forbidden[cx]||new Set()).add(cy);
    (forbidden[cy]=forbidden[cy]||new Set()).add(cx);
  });
  return forbidden;
}
function backtrackPairing(codes, used, forbidden, teams){
  if(used.size===codes.length) return true;
  const a=codes.find(c=>!used.has(c));
  let candidates=codes.filter(c=>!used.has(c) && c!==a && !(forbidden[a]&&forbidden[a].has(c)));
  candidates=shuffle(candidates);
  for(const b of candidates){
    used.add(a); used.add(b); teams.push([a,b]);
    if(backtrackPairing(codes,used,forbidden,teams)) return true;
    teams.pop(); used.delete(a); used.delete(b);
  }
  return false;
}
function pairIntoTeamsWithConstraints(codes, forbidden){
  const shuffled=shuffle(codes);
  const used=new Set(), teams=[];
  const ok=backtrackPairing(shuffled, used, forbidden, teams);
  if(!ok) return null;
  return teams.map(([a,b])=>({code:a+"-"+b, members:[a,b]}));
}

function initTable(entities){
  const t={};
  entities.forEach(code=>{ t[code]={code, played:0, wins:0, draws:0, losses:0, pf:0, pa:0, diff:0, pts:0}; });
  return t;
}
function updateTable(table, a, sa, b, sb){
  table[a].pf+=sa; table[a].pa+=sb;
  table[b].pf+=sb; table[b].pa+=sa;
  table[a].played=(table[a].played||0)+1; table[b].played=(table[b].played||0)+1;
  if(sa>sb){ table[a].wins++; table[b].losses++; table[a].pts=(table[a].pts||0)+3; }
  else if(sb>sa){ table[b].wins++; table[a].losses++; table[b].pts=(table[b].pts||0)+3; }
  else { table[a].draws=(table[a].draws||0)+1; table[b].draws=(table[b].draws||0)+1;
         table[a].pts=(table[a].pts||0)+1; table[b].pts=(table[b].pts||0)+1; }
  table[a].diff=table[a].pf-table[a].pa;
  table[b].diff=table[b].pf-table[b].pa;
}
function compareTeams(t1,t2){
  // football table: points (3 win / 1 draw), goal difference, goals scored
  if(t1.pts!==t2.pts) return t2.pts-t1.pts;
  if(t1.diff!==t2.diff) return t2.diff-t1.diff;
  return t2.pf-t1.pf;
}
function standingsOf(table, codes){
  return codes.map(c=>table[c]).sort(compareTeams);
}

// ---- Tie-break helpers ----
function tiedGroup(st, startIndex){
  if(startIndex>=st.length) return [];
  const base=st[startIndex];
  return st.filter(t=>t.pts===base.pts && t.diff===base.diff && t.pf===base.pf);
}
function buildTieBreakSchedule(codes){
  if(codes.length<2) return null;
  return buildSchedule(codes);
}
function tieBreakCompleteWinnerOrder(tb){
  if(tb.schedule.kind==='elim') {
    const rounds=tb.schedule.rounds;
    const final=rounds[rounds.length-1];
    if(final && final[0] && final[0].played) {
      return [final[0].winner, final[0].winner===final[0].a ? final[0].b : final[0].a];
    }
    return null;
  }
  if(tb.schedule.kind==='hybrid') {
    const rounds=tb.schedule.rounds;
    const final=rounds[rounds.length-1];
    if(final && final[0] && final[0].isFinal && final[0].played) {
      return [final[0].winner, final[0].winner===final[0].a ? final[0].b : final[0].a];
    }
    return null;
  }
  const rrRounds=tb.schedule.rounds;
  const last=rrRounds[rrRounds.length-1];
  if(last && last[0] && last[0].isFinal) {
    if(!last[0].played) return null;
    const winner=last[0].winner;
    const loser=winner===last[0].a ? last[0].b : last[0].a;
    const st=standingsOf(S.table,tb.candidates);
    return [winner, loser, ...st.map(t=>t.code).filter(c=>c!==winner&&c!==loser)];
  }
  return null;
}

/* Roster directives:
     format: rr|elim|hybrid|pools|auto — stage 1 (auto = classic)
     pools: N / qualify: W              — pool count and winners
     then: rr:4, elim                   — pre-declared later stages
     limit: N                           — match cap for auto draws
     rules: strict                      — win-by-2 past the limit
     duration: N                        — full-time minutes (default 90)
     break: N                           — half-time break minutes (default 15)
     byes: classic                      — free byes instead of play-ins
   Blank lines split the names into pool blocks; 'qualify: W' inside
   a block sets that pool's winners. */

const DIRECTIVE_RE=/^\s*(format|pools|qualify|then|limit|rules|duration|break|byes)\s*:\s*(.*)$/i;

function normFormat(v){
  const s=String(v||"").trim().toLowerCase();
  if(["rr","roundrobin","round-robin","round robin","robin"].includes(s)) return "rr";
  if(["elim","elimination","knockout","ko","bracket"].includes(s)) return "elim";
  if(["hybrid","mix","mixed"].includes(s)) return "hybrid";
  if(["pools","pool","groups","group","groupstage","group-stage","group stage"].includes(s)) return "pools";
  if(["auto","classic","default"].includes(s)) return "auto";
  return null;
}

function parseIntStrict(val, what){
  const n=parseInt(val,10);
  if(!Number.isFinite(n)) throw new Error("'"+what+":' needs a whole number — got '"+val+"'.");
  return n;
}

function parseRoster(raw){
  const lines=String(raw||"").split(/\r?\n/);
  const directives={format:null, pools:null, qualify:null, then:null, limit:null, rules:null, duration:null, break:null, byes:null};
  const blocks=[{names:[], qualify:null}];
  let sawDirective=false;
  let started=false; // any name or finished block seen yet?
  for(const line of lines){
    const t=line.trim();
    if(!t){
      if(blocks[blocks.length-1].names.length) blocks.push({names:[], qualify:null});
      continue;
    }
    const m=t.match(DIRECTIVE_RE);
    if(m){
      sawDirective=true;
      const key=m[1].toLowerCase(), val=m[2].trim();
      if(key==="qualify"){
        // before any names: global default; after: configures its block
        if(!started){
          directives.qualify=parseIntStrict(val,"qualify");
        } else {
          blocks[blocks.length-1].qualify=parseIntStrict(val,"qualify");
        }
      } else if(key==="then"){
        directives.then=(directives.then?directives.then+",":"")+val;
      } else {
        directives[key]=val;
      }
      continue;
    }
    blocks[blocks.length-1].names.push(t);
    started=true;
  }
  while(blocks.length && blocks[blocks.length-1].names.length===0 && blocks[blocks.length-1].qualify==null) blocks.pop();
  return {directives, blocks, sawDirective};
}

function parsePipeline(raw){
  if(!raw) return [];
  const specs=String(raw).split(",").map(s=>s.trim()).filter(Boolean).map(tok=>{
    const parts=tok.split(":").map(x=>x.trim());
    const fmt=normFormat(parts[0]);
    if(!fmt) throw new Error("Unknown stage in 'then:': '"+tok+"'. Use rr, elim, hybrid or pools.");
    if(fmt==="auto") throw new Error("'auto' can't be used inside 'then:'.");
    const spec={fmt};
    if(parts.length>1){
      if(fmt==="rr"){
        if(parts.length>2) throw new Error("Use rr:N in 'then:' — got '"+tok+"'.");
        spec.advance=parseIntStrict(parts[1],"rr");
        if(spec.advance<2) throw new Error("rr:N in 'then:' needs N of 2 or more.");
      } else if(fmt==="pools"){
        spec.poolCount=parseIntStrict(parts[1],"pools");
        if(parts.length>2) spec.qualify=parseIntStrict(parts[2],"pools");
      } else {
        throw new Error("Counts after a stage only work for rr or pools — got '"+tok+"'.");
      }
    }
    return spec;
  });
  // a chain must keep flowing and end with a champion
  specs.forEach((spec,i)=>{
    const last=i===specs.length-1;
    if(last && spec.fmt==="rr" && spec.advance!=null)
      throw new Error("The last stage in 'then:' must crown a champion — rr:"+spec.advance+" leaves players hanging. Put it earlier in the chain.");
    if(!last && (spec.fmt==="elim" || spec.fmt==="hybrid" || (spec.fmt==="rr" && spec.advance==null)))
      throw new Error("'"+spec.fmt+"' finishes the tournament — remove the stages after it.");
  });
  return specs;
}

function parseDirectives(d){
  const out={format:null, pools:null, qualify:null, pipeline:[], limit:null, strict:false, duration:null, breakMins:null, byes:null};
  if(d.format!=null && d.format!==""){
    out.format=normFormat(d.format);
    if(!out.format) throw new Error("Unknown 'format:' value '"+d.format+"'. Use rr, elim, hybrid, pools or auto.");
  }
  if(d.pools!=null && d.pools!==""){
    out.pools=parseIntStrict(d.pools,"pools");
    if(out.pools<1) throw new Error("'pools:' needs 1 or more.");
  }
  if(d.qualify!=null && d.qualify!==""){
    out.qualify=parseIntStrict(d.qualify,"qualify");
    if(out.qualify<1) throw new Error("'qualify:' needs 1 or more.");
  }
  if(d.then) out.pipeline=parsePipeline(d.then);
  if(d.limit!=null && d.limit!==""){
    out.limit=parseIntStrict(d.limit,"limit");
    if(out.limit<1) throw new Error("'limit:' needs 1 or more.");
  }
  if(d.rules!=null && d.rules!==""){
    const r=String(d.rules).trim().toLowerCase();
    if(["strict","tt","official"].includes(r)) out.strict=true;
    else if(["off","normal","free","casual"].includes(r)) out.strict=false;
    else throw new Error("Unknown 'rules:' value '"+d.rules+"'. Use strict or off.");
  }
  if(d.duration!=null && d.duration!==""){
    out.duration=parseIntStrict(d.duration,"duration");
    if(out.duration<1 || out.duration>300) throw new Error("'duration:' can be 1 to 300 minutes — got "+d.duration+".");
  }
  if(d["break"]!=null && d["break"]!==""){
    out.breakMins=parseIntStrict(d["break"],"break");
    if(out.breakMins<0 || out.breakMins>60) throw new Error("'break:' can be 0 to 60 minutes — got "+d["break"]+".");
  }
  if(d.byes!=null && d.byes!==""){
    const b=String(d.byes).trim().toLowerCase();
    if(["playin","play-in","play","qualifiers","qualify"].includes(b)) out.byes="playin";
    else if(["classic","byes","free","off"].includes(b)) out.byes="classic";
    else throw new Error("Unknown 'byes:' value '"+d.byes+"'. Use playin or classic.");
  }
  return out;
}

/* Group ladder order: points, then head-to-head points and diff
   (this stage), overall goal difference, goals scored — and a
   dead-level run is first settled by the head-to-head between just
   those teams, then by a seeded lottery. Always terminates — no
   infinite tie-break replays. */

function orderGroupLadder(codes, stageIdx, recordLotto){
  const clean=[...new Set(codes)].filter(c=>c && c!=="BYE" && S.table[c]);
  if(clean.length<2) return clean;
  // head-to-head results among these codes, this stage only
  const h2h={};
  clean.forEach(c=>h2h[c]={pts:0, diff:0});
  for(const r of S.schedule.rounds){
    if(stageIdx!=null && r.stageIndex!=null && r.stageIndex!==stageIdx) continue;
    for(const m of r){
      if(!m.played || !m.a || !m.b) continue;
      if(h2h[m.a]===undefined || h2h[m.b]===undefined) continue;
      if(m.a==="BYE" || m.b==="BYE") continue;
      if(m.scoreA>m.scoreB) h2h[m.a].pts+=3;
      else if(m.scoreB>m.scoreA) h2h[m.b].pts+=3;
      else { h2h[m.a].pts+=1; h2h[m.b].pts+=1; }
      h2h[m.a].diff+=m.scoreA-m.scoreB;
      h2h[m.b].diff+=m.scoreB-m.scoreA;
    }
  }
  const sorted=clean.slice().sort((a,b)=>{
    if(S.table[b].pts!==S.table[a].pts) return S.table[b].pts-S.table[a].pts;
    if(h2h[b].pts!==h2h[a].pts) return h2h[b].pts-h2h[a].pts;
    if(h2h[b].diff!==h2h[a].diff) return h2h[b].diff-h2h[a].diff;
    if(S.table[b].diff!==S.table[a].diff) return S.table[b].diff-S.table[a].diff;
    if(S.table[b].pf!==S.table[a].pf) return S.table[b].pf-S.table[a].pf;
    return 0;
  });
  // dead-even runs: the international criterion — head-to-head
  // among the level teams (this stage) — settles it first; only a
  // run that even that can't split is drawn by lot (seeded, so the
  // draw is always the same way)
  const out=[];
  let i=0;
  while(i<sorted.length){
    let j=i+1;
    const same=(x,y)=>S.table[x].pts===S.table[y].pts && h2h[x].pts===h2h[y].pts &&
      h2h[x].diff===h2h[y].diff && S.table[x].diff===S.table[y].diff && S.table[x].pf===S.table[y].pf;
    while(j<sorted.length && same(sorted[i],sorted[j])) j++;
    let run=sorted.slice(i,j);
    if(run.length>1){
      const mini=orderAmongRun(run, stageIdx);
      if(mini) run=mini;
      else {
        run=seededShuffle(run, S.seed+"|"+(stageIdx==null?"x":stageIdx)+"|"+run.slice().sort().join(","));
        if(recordLotto && !S.lotto.includes(run[0])) S.lotto.push(...run);
      }
    }
    out.push(...run);
    i=j;
  }
  return out;
}

// Head-to-head mini-table among a dead-level run — matches between
// those teams, this stage only: points, then goal difference, then
// goals scored. Returns the ordered run, or null when even that
// leaves them level (a drawn pair, an unplayed fixture, or a cycle).
function orderAmongRun(run, stageIdx){
  if(!S.schedule || run.length<2) return null;
  const set=new Set(run);
  const t={};
  run.forEach(c=>t[c]={code:c, pts:0, pf:0, pa:0});
  let played=false;
  for(const r of S.schedule.rounds){
    if(stageIdx!=null && r.stageIndex!=null && r.stageIndex!==stageIdx) continue;
    for(const m of r){
      if(!m || !m.played || !m.a || !m.b) continue;
      if(m.a==="BYE" || m.b==="BYE") continue;
      if(!set.has(m.a) || !set.has(m.b)) continue;
      played=true;
      t[m.a].pf+=m.scoreA; t[m.a].pa+=m.scoreB;
      t[m.b].pf+=m.scoreB; t[m.b].pa+=m.scoreA;
      if(m.scoreA>m.scoreB) t[m.a].pts+=3;
      else if(m.scoreB>m.scoreA) t[m.b].pts+=3;
      else { t[m.a].pts+=1; t[m.b].pts+=1; }
    }
  }
  if(!played) return null;
  const ordered=run.slice().sort((a,b)=>
    (t[b].pts-t[a].pts) || ((t[b].pf-t[b].pa)-(t[a].pf-t[a].pa)) || (t[b].pf-t[a].pf));
  const first=t[ordered[0]], last=t[ordered[ordered.length-1]];
  if(first.pts===last.pts && first.pf-first.pa===last.pf-last.pa && first.pf===last.pf) return null;
  return ordered;
}

function refreshRankOrder(){
  if(!S.stages.length || !S.schedule){ S.rankOrder=null; return; }
  const stage=S.stages[S.stageIndex] || S.stages[S.stages.length-1];
  let order=[];
  if(stage.type==="pools"){
    stage.pools.forEach(p=>{ order.push(...orderGroupLadder(p.members, stage.idx, false)); });
  } else if(stage.type==="rr"){
    order=orderGroupLadder(stage.entrants, stage.idx, false);
  } else {
    // knockout ladder: alive players first (best record on top), then
    // the eliminated, latest exit first — champion, runner-up, …
    const outs=[...new Set(S.elimOrder)].filter(c=>c && c!=="BYE");
    const outSet=new Set(outs);
    const alive=(stage.entrants||[]).filter(c=>c && c!=="BYE" && !outSet.has(c) && S.table[c]);
    alive.sort((a,b)=>{
      const ta=S.table[a], tb=S.table[b];
      if(ta.pts!==tb.pts) return tb.pts-ta.pts;
      return tb.diff-ta.diff;
    });
    order=[...alive, ...outs.slice().reverse()];
  }
  const seen=new Set(order);
  S.elimOrder.forEach(c=>{ if(!seen.has(c)){ order.push(c); seen.add(c); } });
  S.rankOrder=order;
}

/* ============================================================
   APP STATE — one shared game per server run
   ============================================================ */

function createInitialState(){
  return {
    step:"roster",
    teams:[],            // football squads: {name, captain, players[]}
    names:[],
    codeMap:{}, codeToName:{},
    mode:null,
    forbidden:[],
    entities:[],
    labelOf:{},
    matchInfo:null,
    schedule:null,
    roundIndex:0,
    table:{},
    champion:null,
    tieBreak:null,
    decision:null,
    errorMsg:"",
    directives:{format:null,pools:null,qualify:null,pipeline:[],limit:null,strict:false,duration:null,breakMins:null,byes:null},
    blocks:[],
    stages:[],
    stageIndex:-1,
    stageChoice:null,
    rankOrder:null,
    elimOrder:[],
    lotto:[],
    undoStack:[],
    events:[],
    tournamentName:null,
    // v1.6 — setup text and timing as entered, for a restart prefill
    rosterDraft:null,
    // football — full-time length and half-time break, in minutes
    duration:90,
    breakMins:15,
    seed:String(Math.random())
  };
}

let S = createInitialState();
function getState(){ return S; }

// Session state: a cold boot restores a tournament SUSPENDED —
// an admin must resume before anything changes.
let suspended = false;
let pausedAt = null;
function isSuspended(){ return suspended; }
function setSuspended(v, at){
  suspended = !!v;
  pausedAt = suspended ? (at || new Date().toISOString()) : null;
}

// JSON.stringify drops custom properties stored on round ARRAYS
// (stageIndex, eliminated, stageLabel) — project them into roundMeta
// instead. The client reads roundMeta; nothing else survives.
function getStateForWire(){
  const wire={...S};
  if(S.schedule){
    const roundMeta={eliminated:{}, stageLabel:{}, stageIndex:{}};
    S.schedule.rounds.forEach((r,i)=>{
      if(r && r.eliminated && r.eliminated.length) roundMeta.eliminated[i]=r.eliminated.slice();
      if(r && r.stageLabel) roundMeta.stageLabel[i]=r.stageLabel;
      if(r && r.stageIndex!=null) roundMeta.stageIndex[i]=r.stageIndex;
    });
    wire.schedule={...S.schedule, rounds:S.schedule.rounds, roundMeta};
  }
  wire.needsWinner=roundNeedsWinner(S.roundIndex);
  wire.suspended=suspended;
  wire.pausedAt=pausedAt;
  return wire;
}

/* ---- step transitions ---- */

function reset(){ S = createInitialState(); }

// Back button: drop the draw, keep the setup. Registered squads,
// tournament name and timing come back pre-filled so one team (or one
// of its players) can be unselected and the draw rebuilt.
function restartTournament(){
  if(S.step==="roster") throw new Error("Already on the setup screen.");
  const keep={
    teams:(S.teams||[]).map(t=>({name:t.name, captain:t.captain, players:(t.players||[]).slice()})),
    rosterDraft:S.rosterDraft!=null?S.rosterDraft:null,
    tournamentName:S.tournamentName||null,
    duration:S.duration||null,
    breakMins:S.breakMins!=null?S.breakMins:null
  };
  reset();
  S.teams=keep.teams;
  S.rosterDraft=keep.rosterDraft;
  S.tournamentName=keep.tournamentName;
  S.duration=keep.duration!=null?keep.duration:90;
  S.breakMins=keep.breakMins!=null?keep.breakMins:15;
}

// Audit trail of notable decisions; the client turns new entries
// into toasts.
function noteEvent(text){
  S.events.push({t:Date.now(), text:String(text)});
  if(S.events.length>40) S.events.splice(0, S.events.length-40);
}

// Football squads — registered one at a time before the draw.
function addTeam(teamName, captain, players){
  if(S.step!=="roster") throw new Error("Teams can only be added before the draw is built.");
  const tn=String(teamName||"").trim().slice(0,40);
  const cap=String(captain||"").trim().slice(0,40);
  if(!tn) throw new Error("Enter a team name.");
  if(!cap) throw new Error("Enter the captain's name.");
  if(DIRECTIVE_RE.test(tn)) throw new Error("That team name looks like a setup directive — pick another.");
  if(S.teams.some(t=>t.name.toLowerCase()===tn.toLowerCase()))
    throw new Error("A team called '"+tn+"' is already added.");
  const list=(Array.isArray(players)?players:String(players||"").split(/\r?\n|,/))
    .map(x=>String(x).trim().slice(0,40)).filter(Boolean);
  const seen=new Set([cap.toLowerCase()]);
  for(const pl of list){
    if(seen.has(pl.toLowerCase())) throw new Error("'"+pl+"' appears more than once in this team.");
    seen.add(pl.toLowerCase());
  }
  S.teams.push({name:tn, captain:cap, players:list.slice(0,40)});
}
function removeTeam(i){
  if(S.step!=="roster") throw new Error("Teams can only be removed before the draw is built.");
  if(Number.isInteger(i) && i>=0 && i<S.teams.length) S.teams.splice(i,1);
}

// 'raw' now carries only optional directive lines; the entrants are the
// registered teams.
function submitRoster(raw, name, duration, breakMins){
  if(S.teams.length<2) throw new Error("Add at least 2 teams first.");
  S.rosterDraft=String(raw||"");   // kept for a restart prefill
  const dirLines=String(raw||"").split(/\r?\n/).filter(l=>DIRECTIVE_RE.test(l));
  raw=dirLines.concat(S.teams.map(t=>t.name)).join("\n");
  const parsed=parseRoster(raw);
  const blocks=parsed.blocks.filter(b=>b.names.length>0);
  const enhanced=parsed.sawDirective || blocks.length>=2;
  const directives=parseDirectives(parsed.directives); // throws on bad values

  let names=blocks.flatMap(b=>b.names);
  if(enhanced){
    const seen=new Set();
    for(const n of names){
      if(seen.has(n)) throw new Error("'"+n+"' appears more than once — each name (and each pool) needs unique players.");
      seen.add(n);
    }
  }else{
    names=[...new Set(names)]; // legacy behaviour: silent de-dupe
  }
  if(names.length<2) throw new Error("Add at least 2 teams first.");

  const {codeMap, codeToName}=assignCodes(names);
  S.names=names; S.codeMap=codeMap; S.codeToName=codeToName;
  S.directives=directives;
  S.blocks=blocks.map(b=>({names:b.names.slice(), qualify:b.qualify!=null?b.qualify:directives.qualify}));
  S.pipeline=directives.pipeline.slice();
  S.limit=directives.limit;
  S.rules={strict:directives.strict};
  S.tournamentName=(typeof name==="string" && name.trim())?name.trim().slice(0,60):null;

  // football timing: the roster fields win when given, then a
  // 'duration:' / 'break:' line, then 90 / 15.
  const readMin=(v,lo,hi,label)=>{
    if(v==null || v==="") return null;
    const n=parseInt(v,10);
    if(!Number.isFinite(n) || n<lo || n>hi)
      throw new Error("'"+label+"' needs a whole number from "+lo+" to "+hi+".");
    return n;
  };
  let dur=readMin(duration,1,300,"Full time (minutes)");
  if(dur==null) dur=directives.duration;
  S.duration=dur!=null?dur:90;
  let brk=readMin(breakMins,0,60,"Break time (minutes)");
  if(brk==null) brk=directives.breakMins;
  S.breakMins=brk!=null?brk:15;

  // every team enters as one competitor — no singles/teams choice
  S.mode="single";
  S.entities=Object.values(codeMap);
  S.labelOf=Object.fromEntries(names.map(n=>[codeMap[n], n]));
  routeStage1();
}

function pickMode(mode){
  if(mode!=="single" && mode!=="team") throw new Error("Unknown mode.");
  const multi=S.blocks.length>=2;
  if(mode==="team" && multi)
    throw new Error("Blank-line pool groups only work in singles mode — for teams use the Pools option or 'pools: N'.");
  S.mode=mode;
  if(mode==="single"){
    S.entities=Object.values(S.codeMap);
    S.labelOf=Object.fromEntries(S.names.map(n=>[S.codeMap[n], n]));
    routeStage1();
  } else {
    S.step="pairing";
  }
}

function addForbidden(x,y){
  if(!x||!y||x===y) return;
  const exists=S.forbidden.some(([a,b])=>(a===x&&b===y)||(a===y&&b===x));
  if(!exists) S.forbidden.push([x,y]);
}
function removeForbidden(i){ S.forbidden.splice(i,1); }

function formTeams(){
  const codes=Object.values(S.codeMap);
  const forbidden=buildForbiddenMap(S.forbidden, S.codeMap);
  const teams=pairIntoTeamsWithConstraints(codes, forbidden);
  if(!teams){
    S.errorMsg="No valid team arrangement exists with the current 'never together' rules. Remove a constraint and try again.";
    return;
  }
  S.errorMsg="";
  S.entities=teams.map(t=>t.code);
  S.labelOf={};
  teams.forEach(t=>{
    const label=t.members.map(c=>S.codeToName[c]).join(" & ");
    S.labelOf[t.code]=label;
  });
  S.step="teamsFormed";
}

function goToPairing(){ S.step="pairing"; }

function confirmTeamsAndDraw(){ routeStage1(); }

// First stage: a directive builds it straight away; otherwise the
// admin picks on the stage-choice screen.
function routeStage1(){
  const cfg=stage1Config();
  if(cfg) buildStage1(cfg);
  else enterStageChoice(1, S.entities, null);
}

function stage1Config(){
  const d=S.directives;
  const multi=S.blocks.length>=2;
  if(d.format==="auto") return {fmt:"auto"};
  if(d.format!=null){
    if(d.format==="pools"){
      if(multi && d.pools!=null)
        throw new Error("Pick one: either blank-line groups in the roster or 'pools: "+d.pools+"' — not both.");
      if(multi) return {fmt:"pools", useBlocks:true};
      if(d.pools!=null) return {fmt:"pools", poolCount:d.pools, qualify:d.qualify!=null?d.qualify:1};
      throw new Error("'format: pools' needs either 'pools: N' or blank-line groups in the roster.");
    }
    if(multi) throw new Error("Blank-line groups only make sense for pools — remove them or use 'format: pools'.");
    if(d.pools!=null) throw new Error("'pools: N' only applies to pool stages — use 'format: pools'.");
    return {fmt:d.format};
  }
  if(multi) return {fmt:"pools", useBlocks:true};
  if(d.pools!=null) return {fmt:"pools", poolCount:d.pools, qualify:d.qualify!=null?d.qualify:1};
  if(d.qualify!=null) throw new Error("'qualify:' only makes sense together with pools.");
  return null; // no directive → admin chooses live
}

function buildStage1(cfg){
  if(cfg.fmt==="auto"){ goToDraw(); return; }
  if(!S.schedule) S.schedule={kind:"rr", rounds:[]};
  if(cfg.fmt==="pools"){
    const pools=cfg.useBlocks
      ? blocksToPools(S.blocks)
      : autoSplitPoolsCfg(S.entities, cfg.poolCount, cfg.qualify);
    buildStage("pools", S.entities, {pools});
  } else if(cfg.fmt==="elim"){
    // a non-power-of-two knockout plays its way down (v1.4)
    buildElimStage(S.entities, {byes:(S.directives.byes||"playin")});
  } else {
    buildStage(cfg.fmt, S.entities, {});
  }
}

// Typed roster blocks -> pool descriptors.
function blocksToPools(blocks){
  if(blocks.length<1) throw new Error("No pools found.");
  return blocks.map((b,i)=>{
    const members=b.names.map(n=>S.codeMap[n]).filter(Boolean);
    if(members.length<2) throw new Error("Pool "+poolLetter(i)+" ("+b.names.join(", ")+") needs at least 2 players.");
    let q=b.qualify!=null?b.qualify:1;
    if(q<1) throw new Error("Pool "+poolLetter(i)+": 'qualify:' needs 1 or more.");
    if(q>=members.length) throw new Error("Pool "+poolLetter(i)+" has "+members.length+" players — it can't qualify "+q+". Use fewer winners.");
    return {name:poolLetter(i), members, qualify:q};
  });
}

function poolLetter(i){ return String.fromCharCode(65+i); }

// Balanced snake deal: 1,2,…N / N,…,2,1 keeps pool sizes even.
function autoSplitPoolsCfg(entities, n, w, opts){
  opts=opts||{};
  n=parseInt(n,10);
  w=(w==null||w==="")?1:parseInt(w,10);
  if(!Number.isFinite(n) || n<1) throw new Error("Number of pools needs to be 1 or more.");
  const maxN=Math.max(1, Math.floor(entities.length/2));
  if(n>maxN) throw new Error(entities.length+" entrants can't fill "+n+" pools of at least 2 — use "+maxN+" or fewer.");
  const minSize=Math.floor(entities.length/n);
  if(!Number.isFinite(w) || w<1) throw new Error("Qualifiers per pool needs to be 1 or more.");
  if(w>=minSize) throw new Error("With "+n+" pools the smallest pool has "+minSize+" players — it can't qualify "+w+".");

  // how the field is dealt: random, by season rating, or entry order
  const mode=opts.mode?String(opts.mode).toLowerCase():"random";
  let ordered=entities.slice();
  if(mode==="rating"){
    const ratings=opts.ratings||{};
    ordered.sort((a,b)=>{
      const ra=ratingLookup(ratings,a); const rb=ratingLookup(ratings,b);
      return (rb==null?1000:rb)-(ra==null?1000:ra);
    });
    noteEvent("Pools seeded by season rating — top players spread apart.");
  } else if(mode==="order" || mode==="manual"){
    if(opts.order && opts.order.length){
      const set=new Set(entities);
      const ord=opts.order.filter(c=>set.has(c));
      entities.forEach(c=>{ if(!ord.includes(c)) ord.push(c); });
      ordered=ord;
    }
    noteEvent("Pools split in entry order.");
  } else {
    ordered=shuffle(ordered);
  }
  const raw=Array.from({length:n},()=>[]);
  // rating splits snake so strength stays balanced; entry order
  // deals like cards
  const snake=!(mode==="order" || mode==="manual");
  ordered.forEach((c,i)=>{
    const row=Math.floor(i/n), col=i%n;
    const p=snake ? ((row%2===0)?col:(n-1-col)) : col;
    raw[p].push(c);
  });
  return raw.map((members,i)=>({name:poolLetter(i), members, qualify:w}));
}

function stageMatchCount(stage){
  if(stage.type==="pools") return stage.pools.reduce((sum,p)=>sum+p.members.length*(p.members.length-1)/2,0);
  const n=stage.entrants.length;
  if(stage.type==="rr") return n*(n-1)/2;
  if(stage.type==="elim") return nextPow2(n)-1;
  if(stage.type==="hybrid") return countMatches(n).matches;
  return 0;
}

/* ---- v1.4 play-in qualifiers ----
   A knockout over a non-power-of-two field no longer pads with
   free byes. Instead: randomly drawn 3-player round robins (top 2
   qualify), 4-player groups where the maths forces it, leftovers
   drawn straight into the bracket. 'byes: classic' keeps the old
   behaviour. */

// How n (not a power of two, n>=3) plays down to one: each 3-group
// eliminates 1 player, each 4-group eliminates 2.
function playInPlan(n){
  const P=nextPow2(n)/2;                      // bracket size to reach
  const K=n-P;                                // players to eliminate
  const g4=Math.max(0, Math.ceil((3*K-n)/2)); // 4-player groups
  const g3=K-2*g4;                            // 3-player groups
  const direct=n-4*g4-3*g3;                   // drawn straight in
  const matches=g3*3+g4*6;                    // round-robin matches
  return {bracket:P, g3, g4, groups:g3+g4, direct, matches, total:matches+(P-1)};
}

// Elimination stage, with play-ins unless the field is already a
// power of two or classic byes were asked for.
function buildElimStage(entrants, opts){
  opts=opts||{};
  const n=entrants.length;
  const classic=String(opts.byes||"").toLowerCase()==="classic";
  if(classic || n<3 || isPowerOfTwo(n)){
    return buildStage("elim", entrants, {seededOrder:opts.seededOrder});
  }
  const plan=playInPlan(n);
  const dealt=shuffle(entrants.slice()); // totally random, as asked
  const groups=[];
  let cur=0;
  for(let i=0;i<plan.g4;i++){ groups.push({name:null, members:dealt.slice(cur,cur+4), qualify:2}); cur+=4; }
  for(let i=0;i<plan.g3;i++){ groups.push({name:null, members:dealt.slice(cur,cur+3), qualify:2}); cur+=3; }
  groups.forEach((g,i)=>{ g.name=poolLetter(i); });
  const direct=dealt.slice(cur);
  noteEvent("Play-in draw (random): "+groups.map(g=>g.name+" — "+g.members.map(c=>S.labelOf[c]||c).join(", ")).join(" · ")+(direct.length?(" · straight into the bracket: "+direct.map(c=>S.labelOf[c]||c).join(", ")):""));
  noteEvent("Play-in round robins — top 2 of each group qualify. No free wins.");
  const stage=buildStage("pools", entrants, {pools:groups});
  const st=S.stages[S.stages.length-1];
  st.autoElim={seedMode:opts.seedMode||"auto", ratings:opts.ratings||null, direct};
  return stage;
}

// A play-in stage finished: build its bracket from the qualifiers
// and the drawn-straight players.
function finishAutoElim(stage){
  const ae=stage.autoElim||{};
  const direct=(ae.direct||[]).filter(c=>c && c!=="BYE");
  const winners=[], runners=[];
  stage.pools.forEach(p=>{
    const ordered=orderGroupLadder(p.members, stage.idx, false);
    if(ordered[0]) winners.push(ordered[0]);
    if(ordered[1]) runners.push(ordered[1]);
  });
  const field=[...winners, ...direct, ...runners];
  const mode=String(ae.seedMode||"auto").toLowerCase();
  let order;
  if(mode==="random"){
    order=shuffle(field.slice());
    noteEvent("Play-in bracket drawn at random.");
  } else if(mode==="rating"){
    const ratings=ae.ratings||{};
    order=field.slice().sort((a,b)=>{
      const ra=ratingLookup(ratings,a), rb=ratingLookup(ratings,b);
      return (rb==null?1000:rb)-(ra==null?1000:ra);
    });
    noteEvent("Play-in bracket seeded by season rating.");
  } else {
    const byRec=(a,b)=>{
      const ta=S.table[a]||{pts:0,diff:0}, tb=S.table[b]||{pts:0,diff:0};
      return (tb.pts-ta.pts)||(tb.diff-ta.diff);
    };
    winners.sort(byRec); runners.sort(byRec);
    order=[...winners, ...shuffle(direct.slice()), ...runners];
    noteEvent("Bracket cross-seeded: play-in winners, then the drawn-straight players, then runners-up.");
  }
  buildStage("elim", order, {seededOrder:order});
}

/* ---- Rest spacing (v1.4.3) ----
   Nobody plays more than REST_LIMIT matches in a row. Runs whenever
   fresh rounds join the schedule: the played history sets each
   player's rest clock, then matches swap places WITHIN their round
   only, so pairings, pool bookkeeping and round counts stay intact.
   At most one player can sit on a streak at any point, so a round
   with 2+ matches always has a clean pick; one-match finals after a
   3-way round robin are the only case left alone. */
const REST_LIMIT=2;

function spaceRounds(fromIdx){
  const rounds=S.schedule.rounds;
  if(!rounds || !rounds.length) return;
  const from=Math.max(0, Math.min(fromIdx, rounds.length-1));
  const streak={};
  const bump=(m)=>{
    const ps=new Set([m.a,m.b].filter(p=>p && p!=="BYE"));
    for(const p of Object.keys(streak)) streak[p]=ps.has(p)?streak[p]+1:0;
    ps.forEach(p=>{ if(streak[p]==null) streak[p]=1; });
  };
  for(let i=0;i<from;i++) rounds[i].forEach(bump);
  for(let i=from;i<rounds.length;i++){
    const round=rounds[i];
    if(!round.length || round.some(m=>m.isFinal)) continue; // finals stay put
    const remaining=round.slice();
    const ordered=[];
    while(remaining.length){
      const pick=remaining.find(m=>{
        const ps=[m.a,m.b].filter(p=>p && p!=="BYE");
        return ps.length===0 || ps.every(p=>(streak[p]||0)<REST_LIMIT);
      }) || remaining[0]; // forced: a one-match round can't be spaced
      remaining.splice(remaining.indexOf(pick),1);
      ordered.push(pick);
      bump(pick);
    }
    round.length=0;
    round.push(...ordered); // same array object, custom props survive
  }
}

/* ---- Building a stage ---- */

function buildStage(format, entrants, opts){
  opts=opts||{};
  if(S.step==="stageChoice") S.stageChoice=null;
  entrants=[...new Set(entrants)].filter(c=>c && c!=="BYE");
  if(entrants.length<2) throw new Error("A stage needs at least 2 entrants.");

  if(!S.schedule) S.schedule={kind:"rr", rounds:[]};
  if(Object.keys(S.table).length===0){ S.table=initTable(entrants); }
  S.labelOf["BYE"]="— bye —";

  const stage={type:format, entrants, roundStart:S.schedule.rounds.length, roundCount:0};
  S.stages.push(stage);
  const stageIdx=S.stages.length-1;
  stage.idx=stageIdx;
  const tag=(r)=>{ r.stageIndex=stageIdx; return r; };

  if(format==="pools"){
    const pools=opts.pools;
    if(!pools || !pools.length) throw new Error("A pool stage needs pools.");
    if(pools.length===1 && entrants.length>2 && pools[0].qualify>=pools[0].members.length)
      throw new Error("The pool can't qualify everyone.");
    stage.pools=[];
    let cursor=S.schedule.rounds.length;
    pools.forEach(p=>{
      const members=[...new Set(p.members)].filter(c=>c && c!=="BYE");
      if(members.length<2) throw new Error("Pool "+p.name+" needs at least 2 players.");
      if(p.qualify<1 || p.qualify>=members.length)
        throw new Error("Pool "+p.name+" has "+members.length+" players — set its winners to between 1 and "+(members.length-1)+".");
      const rounds=generateRoundRobin(members).filter(r=>r.length>0);
      rounds.forEach(r=>{ tag(r); r.stageLabel="Pool "+p.name; S.schedule.rounds.push(r); });
      stage.pools.push({name:p.name, members, qualify:p.qualify, roundStart:cursor, roundCount:rounds.length});
      cursor+=rounds.length;
    });
    stage.roundCount=cursor-stage.roundStart;
    stage.qualifiers=[];
    S.schedule.kind="rr"; // display fallback label
    S.matchInfo={type:"pools", matches:stageMatchCount(stage), pools:stage.pools.length};
  }
  else if(format==="rr"){
    let advance=opts.advance!=null?parseInt(opts.advance,10):null;
    if(advance!=null && (!Number.isFinite(advance) || advance<2))
      throw new Error("'Advance top N' needs N of 2 or more — or leave it blank to finish here.");
    if(advance!=null && advance>=entrants.length)
      throw new Error(entrants.length+" entrants can't advance "+advance+" — leave it blank to finish here.");
    if(entrants.length===2 && advance!=null)
      throw new Error("With 2 entrants the stage plays straight to a final — leave 'advance' blank.");
    const rounds=generateRoundRobin(entrants).filter(r=>r.length>0);
    if(entrants.length===2 && advance==null){
      rounds[0][0].isFinal=true; // the single match IS the final
    }
    rounds.forEach(r=>{ tag(r); S.schedule.rounds.push(r); });
    stage.roundCount=rounds.length;
    stage.advance=advance;
    S.schedule.kind="rr";
    // keep the legacy helper fields in sync so tie-break marking works
    S.schedule.rrStart=stage.roundStart;
    S.schedule.rrCount=stage.roundCount;
    S.schedule.rrTotal=S.schedule.rounds.length;
    S.matchInfo={type:"round-robin", matches:stageMatchCount(stage)};
  }
  else if(format==="elim"){
    let order=opts.seededOrder || shuffle(entrants.slice());
    // safety net: the order must be exactly the entrants, nothing more
    const eset=new Set(entrants);
    order=order.filter(c=>eset.has(c));
    const oset=new Set(order);
    entrants.forEach(c=>{ if(!oset.has(c)) order.push(c); });
    const rounds=buildSeededBracket(order);
    rounds.forEach(r=>{ tag(r); S.schedule.rounds.push(r); });
    stage.roundCount=rounds.length;
    S.schedule.kind="elim";
    S.matchInfo={type:"elimination", matches:stageMatchCount(stage)};
  }
  else if(format==="hybrid"){
    if(entrants.length%2!==0 || isPowerOfTwo(entrants.length))
      throw new Error("Hybrid needs an even number of entrants that isn't a power of two (like 6, 10 or 12).");
    const sched=buildSchedule(entrants);
    sched.rounds.forEach(r=>{ tag(r); S.schedule.rounds.push(r); });
    stage.roundCount=sched.rounds.length;
    stage.k=sched.k;
    S.schedule.kind="hybrid";
    S.schedule.k=sched.k;
    S.matchInfo={type:"hybrid", matches:stageMatchCount(stage)};
  }
  else throw new Error("Unknown stage format: "+format);

  // a hand-picked stage is never capped — the card showed the match
  // count first. Only the automatic draw honours 'limit:'.
  const count=stageMatchCount(stage);
  if(S.limit!=null && count>S.limit)
    noteEvent(count+" matches — over the "+S.limit+"-match cap, but the format was picked by hand.");

  S.stageIndex=S.stages.length-1;
  S.step="play";
  S.roundIndex=stage.roundStart;
  spaceRounds(stage.roundStart);
  refreshRankOrder();
}

/* ---- Stage-choice screen (boundary between stages) ---- */

function enterStageChoice(stageNum, entrants, preselect, picker){
  const q=[...new Set(entrants)].filter(c=>c && c!=="BYE");
  const n=q.length;
  S.step="stageChoice";
  S.stageChoice={
    stageNum,
    entrants:q,
    preselect:preselect?{
      fmt:preselect.fmt,
      advance:preselect.advance!=null?preselect.advance:null,
      poolCount:preselect.poolCount!=null?preselect.poolCount:null,
      qualify:preselect.qualify!=null?preselect.qualify:null
    }:null,
    counts:(function(){
      const rr=n*(n-1)/2;
      const needsPlayin=(n>=3 && !isPowerOfTwo(n));
      const plan=needsPlayin?playInPlan(n):null;
      return {
        rr,
        elim:plan?plan.total:(nextPow2(n)-1),
        elimPlayin:plan,
        hybrid:(n%2===0 && !isPowerOfTwo(n))?countMatches(n).matches:null,
        pools:null
      };
    })(),
    // lets the admin redraw WHO advances at a boundary
    picker: picker?{
      type:picker.type||"pools",
      groups:(picker.groups||[]).map(g=>({
        name:g.name||null,
        members:(g.members||[]).filter(c=>c && c!=="BYE"),
        count:g.count|0,
        auto:(g.auto||[]).filter(c=>c && c!=="BYE")
      }))
    }:null
  };
}

function pickStage(p, ctx){
  if(S.step!=="stageChoice" || !S.stageChoice) throw new Error("There's no stage to pick right now.");
  ctx=ctx||{};
  const c=S.stageChoice;
  const format=normFormat(p && p.format);
  if(!format || format==="auto") throw new Error("Pick a format: round robin, elimination, hybrid or pools.");

  // decide WHO plays this stage (default: standings order)
  let entrants=c.entrants;
  if(c.picker){
    entrants=resolveAdvancing(c.picker, p);
    if([...new Set(entrants)].length!==entrants.length)
      throw new Error("Duplicate picks — each player can only advance once.");
    applyAdvancing(entrants);
  }

  if(format==="hybrid"){
    if(!(entrants.length%2===0 && !isPowerOfTwo(entrants.length)))
      throw new Error("Hybrid needs an even field that isn't a power of two (like 6, 10 or 12) — it has "+entrants.length+" entrants.");
    buildStage("hybrid", entrants, {});
  }
  else if(format==="pools"){
    const pools=autoSplitPoolsCfg(entrants, p.poolCount, p.poolQualify, {
      mode:p.splitMode,
      ratings:ctx.ratings,
      order:splitOrderSource(entrants)
    });
    buildStage("pools", entrants, {pools});
  }
  else if(format==="rr"){
    buildStage("rr", entrants, {advance:p.advance});
  }
  else {
    // non-power-of-two knockout: play-ins unless classic byes
    const byes=(p && p.byesMode!=null)?String(p.byesMode).toLowerCase()
      :String(S.directives.byes||"playin").toLowerCase();
    if(!isPowerOfTwo(entrants.length) && byes!=="classic"){
      buildElimStage(entrants, {byes:"playin", seedMode:p && p.seedMode, ratings:ctx.ratings});
    } else {
      const order=resolveSeedOrder(entrants, p, ctx);
      buildStage("elim", entrants, {seededOrder:order});
    }
  }
  refreshRankOrder();
}

/* ---- choosing who advances (standings / random / by hand) ---- */

function resolveAdvancing(picker, p){
  const mode=p && p.qmode ? String(p.qmode).toLowerCase() : "auto";
  if(mode==="auto" || mode==="standings"){
    return picker.groups.flatMap(g=>g.auto.slice(0, g.count));
  }
  if(mode==="random"){
    const out=[];
    picker.groups.forEach(g=>{
      const drawn=shuffle(g.members.slice()).slice(0, g.count);
      out.push(...drawn);
      noteEvent("Random draw"+(g.name?(" — Pool "+g.name):"")+": "+drawn.map(c=>S.labelOf[c]||c).join(", "));
    });
    return out;
  }
  if(mode==="picks" || mode==="manual"){
    const picks=Array.isArray(p.picks)?p.picks.slice():[];
    const required=picker.groups.reduce((s,g)=>s+g.count,0);
    if(picks.length!==required)
      throw new Error("Pick exactly "+required+" players to advance — you've chosen "+picks.length+".");
    const eligible=new Set(picker.groups.flatMap(g=>g.members));
    const seen=new Set();
    for(const code of picks){
      if(!eligible.has(code)) throw new Error("'"+(S.labelOf[code]||code)+"' isn't in the group(s) that can advance.");
      if(seen.has(code)) throw new Error("'"+(S.labelOf[code]||code)+"' is picked twice.");
      seen.add(code);
    }
    picker.groups.forEach(g=>{
      const inGroup=picks.filter(code=>g.members.includes(code));
      if(inGroup.length!==g.count)
        throw new Error((g.name?("Pool "+g.name):"The group")+" sends "+g.count+" — you picked "+inGroup.length+" from it.");
    });
    noteEvent("Advanced by pick: "+picks.map(c=>S.labelOf[c]||c).join(", "));
    return picks;
  }
  throw new Error("Unknown qualifier mode '"+mode+"'.");
}

// Rewrites the previous stage's elimination marks so OUT tags and
// the ladder agree with the actual advancing set.
function applyAdvancing(entrants){
  const keep=new Set(entrants.filter(c=>c && c!=="BYE"));
  const stage=S.stages[S.stages.length-1];
  if(!stage || !S.schedule) return;
  if(stage.type==="pools"){
    stage.qualifiers=entrants.slice();
    stage.pools.forEach(p=>{
      const last=S.schedule.rounds[p.roundStart+p.roundCount-1];
      if(last) last.eliminated=p.members.filter(c=>!keep.has(c));
    });
  } else if(stage.type==="rr" && stage.advance){
    stage.advancers=entrants.slice();
    const last=S.schedule.rounds[stage.roundStart+stage.roundCount-1];
    if(last) last.eliminated=stage.entrants.filter(c=>!keep.has(c));
  }
  S.elimOrder=[];
  S.schedule.rounds.forEach(r=>{ if(r && r.eliminated && r.eliminated.length) S.elimOrder.push(...r.eliminated); });
}

/* ---- bracket seeding modes ---- */

function ratingLookup(ratings, code){
  const label=S.labelOf[code]||code;
  if(ratings[label]!=null) return ratings[label];
  const k=String(label).trim().toLowerCase();
  return ratings[k]!=null?ratings[k]:null;
}

function resolveSeedOrder(entrants, p, ctx){
  const mode=p && p.seedMode ? String(p.seedMode).toLowerCase() : "auto";
  const prev=S.stages[S.stages.length-1];
  if(mode==="auto" || mode==="cross"){
    if(prev && prev.type==="pools"){
      noteEvent("Bracket cross-seeded from the pools (1A vs 2B …).");
      return seedOrderFromPools(prev, entrants);
    }
    return shuffle(entrants.slice());
  }
  if(mode==="random"){
    noteEvent("Bracket drawn at random: "+shuffle(entrants.slice()).map(c=>S.labelOf[c]||c).join(" vs "));
    return shuffle(entrants.slice());
  }
  if(mode==="rating"){
    const ratings=(ctx && ctx.ratings)||{};
    const order=entrants.slice().sort((a,b)=>{
      const ra=ratingLookup(ratings,a); const rb=ratingLookup(ratings,b);
      return (rb==null?1000:rb)-(ra==null?1000:ra);
    });
    noteEvent("Bracket seeded by season rating: "+order.map(c=>S.labelOf[c]||c).join(" > "));
    return order;
  }
  if(mode==="manual" || mode==="order"){
    const order=Array.isArray(p.seedOrder)?p.seedOrder.slice():[];
    if(!isPermutation(order, entrants))
      throw new Error("Set the full seeding order — every advancing player exactly once.");
    noteEvent("Bracket seeded by hand: "+order.map(c=>S.labelOf[c]||c).join(" > "));
    return order;
  }
  throw new Error("Unknown seeding mode '"+mode+"'.");
}

function isPermutation(order, entrants){
  const a=[...new Set(order)];
  return a.length===order.length && a.length===entrants.length && a.every(c=>entrants.includes(c));
}

// Entry-order pool split source: the ladder if there is one, else
// the entrant list as given.
function splitOrderSource(entrants){
  const set=new Set(entrants);
  if(S.rankOrder && S.rankOrder.length){
    const ord=S.rankOrder.filter(c=>set.has(c));
    if(ord.length===entrants.length) return ord;
  }
  return entrants.slice();
}

// Cross-pool seeding: pool winners first, then runners-up, etc.
// Pairing seed i vs seed P+1-i keeps pool rivals apart late (1A vs 2B).
function seedOrderFromPools(stage, qualifiers){
  const qset=new Set(qualifiers);
  const byPosition=[];
  stage.pools.forEach(p=>{
    // rank among this pool's qualifiers: position 1 seeds first
    const ordered=orderGroupLadder(p.members, stage.idx, true).filter(c=>qset.has(c));
    ordered.forEach((code,i)=>{
      if(!byPosition[i]) byPosition[i]=[];
      byPosition[i].push(code);
    });
  });
  const flat=[];
  byPosition.forEach(group=>{
    // within one position: record, then point diff
    group.sort((a,b)=>{
      const ta=S.table[a], tb=S.table[b];
      if(ta.pts!==tb.pts) return tb.pts-ta.pts;
      return tb.diff-ta.diff;
    });
    flat.push(...group);
  });
  return flat;
}

/* ---- Boundaries ---- */

function boundary(qualifiers, picker){
  const q=[...new Set(qualifiers)].filter(c=>c && c!=="BYE");
  if(q.length<=1){
    if(q.length===1) S.champion=q[0];
    S.step="standings";
    refreshRankOrder();
    return;
  }
  const spec=S.pipeline.length?S.pipeline.shift():null;
  enterStageChoice(S.stages.length+1, q, spec, picker);
}

function poolAdvance(stage, idx, round){
  const pool=stage.pools.find(p=>idx>=p.roundStart && idx<p.roundStart+p.roundCount);
  if(!pool) return;
  if(idx!==pool.roundStart+pool.roundCount-1) return; // mid-pool: plain advance
  const ordered=orderGroupLadder(pool.members, stage.idx, true);
  const quals=ordered.slice(0,pool.qualify);
  const outs=pool.members.filter(c=>!quals.includes(c));
  round.eliminated=outs;
  S.elimOrder.push(...outs);
  stage.qualifiers=(stage.qualifiers||[]).concat(quals);
  if(pool===stage.pools[stage.pools.length-1]){
    S.stageIndex++;
    // a play-in stage chains straight into its bracket, no choice screen
    if(stage.autoElim){ finishAutoElim(stage); return; }
    // default qualifiers plus the redraw menu for the next choice
    const groups=stage.pools.map(p=>{
      const ord=orderGroupLadder(p.members, stage.idx, false);
      return {name:p.name, members:p.members.slice(), count:p.qualify, auto:ord.slice(0,p.qualify)};
    });
    boundary(stage.qualifiers, {type:"pools", groups});
  }
}

function rrAdvance(stage, round){
  const ordered=orderGroupLadder(stage.entrants, stage.idx, true);
  const adv=ordered.slice(0,stage.advance);
  const outs=stage.entrants.filter(c=>!adv.includes(c));
  round.eliminated=outs;
  S.elimOrder.push(...outs);
  S.stageIndex++;
  boundary(adv, {type:"rr", groups:[{name:null, members:stage.entrants.slice(), count:stage.advance, auto:adv.slice()}]});
}

function finishStep(idx){
  const sched=S.schedule;
  if(S.step==="stageChoice") return; // waiting for the admin to pick the next stage
  if(idx+1>=sched.rounds.length){
    S.step="standings";
  } else {
    S.roundIndex=idx+1;
  }
}

// stage index for ladder calls made from the decision/tie-break flow
function curStageIdx(){
  const st=S.stages[S.stageIndex];
  return st?st.idx:null;
}

/* ---- Legacy automatic draw (format: auto) ---- */

function goToDraw(){
  const info=countMatches(S.entities.length);
  S.matchInfo=info;
  const cap=S.limit!=null?S.limit:21;
  if(info.matches>cap){
    S.step="toomany";
    return;
  }
  S.schedule=buildSchedule(S.entities);
  S.table=initTable(S.entities);
  S.tieBreak=null;
  S.roundIndex=0;
  S.step="play";
}

// Escape hatch off the "too many matches" screen.
function chooseStage(){
  if(S.step!=="toomany") throw new Error("There's nothing to choose right now.");
  S.matchInfo=null;
  enterStageChoice(S.stages.length+1, S.entities, null);
}

/* ---- Playing a round ---- */

// Score rules: whole numbers (goals), 0 or more. Level scores are
// real results; knockout matches settle them with a penalty shootout.
function scoreProblem(sa, sb){
  if(typeof sa!=="number" || typeof sb!=="number" || !Number.isFinite(sa) || !Number.isFinite(sb))
    return "Enter two scores.";
  if(!Number.isInteger(sa) || !Number.isInteger(sb))
    return "Scores are whole numbers.";
  if(sa<0 || sb<0)
    return "Scores can't go below 0.";
  if(sa>99 || sb>99)
    return "Scores can't go above 99.";
  return null;
}

// Does a match in this round have to produce a winner (knockout /
// final) — as opposed to a round-robin or pool match where a draw stands?
function roundNeedsWinner(idx, round){
  if(!S.schedule) return false;
  round=round||S.schedule.rounds[idx];
  if(!round) return false;
  if(round.some(m=>m && m.isFinal)) return true;
  const sched=S.schedule;
  if(S.tieBreak){
    const tb=S.tieBreak;
    if(tb.schedule.kind==='elim') return true;
    if(tb.schedule.kind==='hybrid') return tb.stage==='hybrid' && (idx-tb.start)<=tb.schedule.k-1;
    return false;
  }
  const stage=S.stages[S.stageIndex];
  if(stage && stage.type==="pools") return false;
  if(sched.kind==='elim') return true;
  if(sched.kind==='hybrid') return idx<=sched.k-1;
  return false;
}

function saveScore(mi, sa, sb, penA, penB){
  if(!S.schedule) throw new Error("The draw hasn't been built yet.");
  const round=S.schedule.rounds[S.roundIndex];
  if(!round) throw new Error("That match doesn't exist.");
  const m=round[mi];
  if(!m) throw new Error("That match doesn't exist.");
  // sa/sb arrive over JSON (NaN becomes null); scoreProblem catches that
  const problem=scoreProblem(sa, sb);
  if(problem) throw new Error(problem);
  if(m.played) throw new Error("That score is already saved — use Undo to change it.");
  if(m.a==="BYE" || m.b==="BYE") throw new Error("A bye doesn't need a score.");
  let pa=null, pb=null;
  if(sa===sb && roundNeedsWinner(S.roundIndex, round)){
    if(!Number.isInteger(penA) || !Number.isInteger(penB) || penA<0 || penB<0 || penA>99 || penB>99)
      throw new Error("Level after full time — enter the penalty shootout score to decide the winner.");
    if(penA===penB) throw new Error("A shootout needs a winner — the penalty scores can't be level.");
    pa=penA; pb=penB;
  }
  S.undoStack.push({
    roundIndex:S.roundIndex, mi,
    match:{a:m.a,b:m.b,played:m.played,scoreA:m.scoreA,scoreB:m.scoreB,winner:m.winner,penA:m.penA,penB:m.penB,draftA:m.draftA,draftB:m.draftB},
    rowA:S.table[m.a]?{...S.table[m.a]}:null,
    rowB:S.table[m.b]?{...S.table[m.b]}:null
  });
  m.scoreA=sa; m.scoreB=sb; m.played=true;
  m.penA=pa; m.penB=pb;
  m.winner = sa>sb ? m.a : sb>sa ? m.b : (pa!=null ? (pa>pb ? m.a : m.b) : null);
  updateTable(S.table, m.a, sa, m.b, sb);
  refreshRankOrder();
}

function undoScore(){
  if(!S.schedule) throw new Error("The draw hasn't been built yet.");
  const u=S.undoStack.pop();
  if(!u) throw new Error("Nothing to undo.");
  if(u.roundIndex!==S.roundIndex)
    throw new Error("Too late to undo — the draw already moved on. Undo only works inside the current round.");
  const round=S.schedule.rounds[u.roundIndex];
  const m=round[u.mi];
  if(!m) throw new Error("That match doesn't exist.");
  Object.assign(m, u.match);
  if(u.rowA && S.table[m.a]) Object.assign(S.table[m.a], u.rowA);
  if(u.rowB && S.table[m.b]) Object.assign(S.table[m.b], u.rowB);
  refreshRankOrder();
}

function draftScore(mi, which, value){
  if(!S.schedule) return;
  const round=S.schedule.rounds[S.roundIndex];
  const m=round[mi];
  if(!m) return;
  if(which==="a") m.draftA=value; else m.draftB=value;
}

function roundComplete(round){ return round.every(m=>m.played); }

function continueTournament(){
  if(!S.schedule) throw new Error("The draw hasn't been built yet.");
  const sched=S.schedule, idx=S.roundIndex, round=sched.rounds[idx];
  if(!round) return;
  if(!roundComplete(round)) throw new Error("Enter all scores to continue.");
  S.undoStack=[]; // the round is sealed once we advance

  if(S.tieBreak){
    const tb=S.tieBreak;
    const baseRounds=tb.schedule.rounds;
    const baseLast=baseRounds.length-1;

    if(tb.schedule.kind==='elim'){
      if(idx===tb.start+baseLast){
        const order=tieBreakCompleteWinnerOrder(tb);
        if(!order) return;
        finishTieBreak(order);
      } else {
        const winners=round.map(m=>m.winner);
        round.eliminated=round.map(m=>m.winner===m.a?m.b:m.a).filter(c=>c!=="BYE");
        advanceRound(S.schedule.rounds,idx,winners);
      }
    } else if(tb.schedule.kind==='hybrid'){
      const localIdx=idx-tb.start;
      if(tb.stage==='hybrid' && localIdx<tb.schedule.k-1){
        const winners=round.map(m=>m.winner);
        round.eliminated=round.map(m=>m.winner===m.a?m.b:m.a).filter(c=>c!=="BYE");
        advanceRound(S.schedule.rounds,idx,winners);
      } else if(tb.stage==='hybrid' && localIdx===tb.schedule.k-1){
        const survivors=round.map(m=>m.winner);
        round.eliminated=round.map(m=>m.winner===m.a?m.b:m.a).filter(c=>c!=="BYE");
        tb.survivors=survivors;
        const rrRounds=generateRoundRobin(survivors);
        tb.stage='hybrid-rr';
        tb.rrStart=S.schedule.rounds.length;
        tb.rrCount=rrRounds.length;
        S.schedule.rounds.push(...rrRounds);
        spaceRounds(tb.rrStart);
      } else if(tb.stage==='hybrid-rr'){
        const rrIndex=idx-tb.rrStart;
        if(rrIndex===tb.rrCount-1){
          const st=standingsOf(S.table,tb.survivors);
          const group=tiedGroup(st,0);
          if(group.length===st.length){
            tb.regens=(tb.regens||0)+1;
            if(tb.regens>=2){
              // still tied after a replay — settle it with the ladder
              finishTieBreak(orderGroupLadder(tb.survivors, curStageIdx(), true));
            } else {
              const rrRounds=generateRoundRobin(tb.survivors);
              tb.rrStart=S.schedule.rounds.length;
              tb.rrCount=rrRounds.length;
              S.schedule.rounds.push(...rrRounds);
              spaceRounds(tb.rrStart);
            }
          } else {
            finishTieBreak(st.map(t=>t.code));
          }
        }
      }
    } else if(tb.schedule.kind==='rr'){
      const rrIndex=idx-tb.start;
      if(rrIndex===tb.rrCount-1){
        const st=standingsOf(S.table,tb.candidates);
        const group=tiedGroup(st,0);
        if(group.length===st.length){
          tb.regens=(tb.regens||0)+1;
          if(tb.regens>=2){
            finishTieBreak(orderGroupLadder(tb.candidates, curStageIdx(), true));
          } else {
            const rrRounds=generateRoundRobin(tb.candidates);
            tb.start=S.schedule.rounds.length;
            tb.rrStart=tb.start;
            tb.rrCount=rrRounds.length;
            S.schedule.rounds.push(...rrRounds);
            spaceRounds(tb.start);
          }
        } else {
          finishTieBreak(st.map(t=>t.code));
        }
      }
    }
  }
  else if(round[0] && round[0].isFinal){
    S.champion=round[0].winner;
    // record the runner-up's exit so the ladder and OUT tags are exact
    const runnerUp=round[0].winner===round[0].a ? round[0].b : round[0].a;
    if(runnerUp && runnerUp!=="BYE" && !(round.eliminated||[]).includes(runnerUp)){
      round.eliminated=[...(round.eliminated||[]), runnerUp];
      S.elimOrder.push(runnerUp);
    }
  }
  else {
    const stage=S.stages[S.stageIndex];

    if(stage && stage.type==="pools"){
      poolAdvance(stage, idx, round);
    }
    else if(sched.kind==='elim'){
      const winners=round.map(m=>m.winner);
      round.eliminated=round.map(m=>m.winner===m.a?m.b:m.a).filter(c=>c!=="BYE");
      if(round.eliminated.length) S.elimOrder.push(...round.eliminated);
      if(idx+1<sched.rounds.length) advanceRound(sched.rounds,idx,winners);
      else S.champion=winners[0];
    }
    else if(sched.kind==='hybrid'){
      if(round[0] && round[0].isFinal){
        S.champion=round[0].winner;
      } else if(idx<sched.k-1){
        const winners=round.map(m=>m.winner);
        round.eliminated=round.map(m=>m.winner===m.a?m.b:m.a).filter(c=>c!=="BYE");
        if(round.eliminated.length) S.elimOrder.push(...round.eliminated);
        advanceRound(sched.rounds,idx,winners);
      } else if(idx===sched.k-1){
        const survivors=round.map(m=>m.winner);
        round.eliminated=round.map(m=>m.winner===m.a?m.b:m.a).filter(c=>c!=="BYE");
        if(round.eliminated.length) S.elimOrder.push(...round.eliminated);
        sched.survivors=survivors;
        sched.rrStart=sched.rounds.length;
        const rrRounds=generateRoundRobin(survivors);
        sched.rrCount=rrRounds.length;
        S.schedule.rounds.push(...rrRounds);
        spaceRounds(sched.rrStart);
      } else {
        const rrIndex=idx-sched.rrStart;
        if(rrIndex===sched.rrCount-1){
          startRoundRobinDecision(sched.survivors);
          if(S.tieBreak){ return; }
        }
      }
    }
    else if(sched.kind==='rr'){
      if(stage && stage.roundStart!=null){
        if(idx===stage.roundStart+stage.roundCount-1){
          if(stage.advance){
            rrAdvance(stage, round);
          } else {
            startRoundRobinDecision(stage.entrants);
            if(S.tieBreak){ return; }
          }
        }
        // mid-stage rounds just advance
      } else if(idx===sched.rrTotal-1){
        startRoundRobinDecision();
        if(S.tieBreak){ return; }
      }
    }
  }

  finishStep(idx);
  refreshRankOrder();
}

function startTieBreak(candidates,target){
  const clean=[...new Set(candidates)];
  if(clean.length<=target){
    return clean;
  }
  S.tieBreak={stage:null,candidates:clean,target,schedule:null,start:0,rrStart:0,rrCount:0};
  const ts=buildTieBreakSchedule(clean);
  if(!ts) return null;
  S.tieBreak.schedule=ts;
  S.tieBreak.stage=ts.kind;
  S.tieBreak.start=S.schedule.rounds.length;
  S.tieBreak.rrStart=S.tieBreak.start;
  S.tieBreak.rrCount=ts.rounds.length;
  S.schedule.rounds.push(...ts.rounds);
  spaceRounds(S.tieBreak.start);
  S.roundIndex=S.tieBreak.start;
  return null;
}

function markRoundRobinOut(qualifiers, rrCodes){
  const keep=new Set(qualifiers);
  const participants=rrCodes || (S.schedule.kind==='rr' ? S.entities : S.schedule.survivors);
  const roundIndex=S.schedule.kind==='rr'
    ? S.schedule.rrTotal-1
    : (S.schedule.rrStart!=null ? S.schedule.rrStart+S.schedule.rrCount-1 : -1);
  if(roundIndex<0 || !S.schedule.rounds[roundIndex]) return;
  const round=S.schedule.rounds[roundIndex];
  const already=new Set(round.eliminated||[]);
  participants.forEach(c=>{
    if(!keep.has(c)) already.add(c);
  });
  round.eliminated=[...already].filter(c=>c!=="BYE");
}

function finishTieBreak(order){
  const tb=S.tieBreak;
  const unique=order.filter((c,i,a)=>c && a.indexOf(c)===i);
  const qualifiers=unique.slice(0,tb.target);

  const current=S.schedule.rounds[S.roundIndex];
  current.eliminated=[...(current.eliminated||[]),...tb.candidates.filter(c=>!qualifiers.includes(c))].filter(c=>c!=="BYE");
  tb.result=qualifiers;
  tb.done=true;

  if(tb.context==='top2'){
    markRoundRobinOut(qualifiers.slice(0,2), tb.rrParticipants);
  } else if(tb.context==='second'){
    markRoundRobinOut([S.decision.first,qualifiers[0]], tb.rrParticipants);
  }

  const context=tb.context;
  S.tieBreak=null;
  if(context==='top2'){
    S.schedule.rounds.push([{a:qualifiers[0],b:qualifiers[1],played:false,isFinal:true}]);
  } else if(context==='second'){
    const first=S.decision.first;
    S.schedule.rounds.push([{a:first,b:qualifiers[0],played:false,isFinal:true}]);
  }
}

function startRoundRobinDecision(rrParticipants){
  const participants=rrParticipants || S.entities;
  const st=standingsOf(S.table,participants);
  if(st.length<2) return;

  const topGroup=tiedGroup(st,0);

  if(topGroup.length>=2){
    const result=startTieBreak(topGroup.map(t=>t.code),2);
    if(result){
      markRoundRobinOut(result.slice(0,2),participants);
      S.schedule.rounds.push([{a:result[0],b:result[1],played:false,isFinal:true}]);
    } else {
      S.tieBreak.context='top2';
      S.tieBreak.rrParticipants=participants.slice();
    }
    return;
  }

  const secondGroup=tiedGroup(st,1);
  if(secondGroup.length<=1){
    markRoundRobinOut([st[0].code,st[1].code],participants);
    S.schedule.rounds.push([{a:st[0].code,b:st[1].code,played:false,isFinal:true}]);
    return;
  }

  const result=startTieBreak(secondGroup.map(t=>t.code),1);
  if(result){
    markRoundRobinOut([st[0].code,result[0]],participants);
    S.schedule.rounds.push([{a:st[0].code,b:result[0],played:false,isFinal:true}]);
  } else {
    S.decision={first:st[0].code};
    S.tieBreak.context='second';
    S.tieBreak.rrParticipants=participants.slice();
  }
}

/* ---- season archive snapshot ----
   Who played, every real match (byes excluded), the final order,
   champion, events. Ranking prefers the engine's ladder. */
function getTournamentRecord(){
  if(!S.schedule) return null;
  const matches=[];
  S.schedule.rounds.forEach((r,ri)=>{
    (r||[]).forEach(m=>{
      if(m && m.played && m.a && m.b && m.a!=="BYE" && m.b!=="BYE"){
        matches.push({round:ri+1, a:S.labelOf[m.a]||m.a, b:S.labelOf[m.b]||m.b, sa:m.scoreA, sb:m.scoreB, winner:S.labelOf[m.winner]||null, pens:(m.penA!=null?[m.penA,m.penB]:null)});
      }
    });
  });
  let order=(S.rankOrder && S.rankOrder.length)?S.rankOrder.slice():null;
  if(!order){
    try{ order=standingsOf(S.table,S.entities).map(t=>t.code); }catch(e){ order=S.entities.slice(); }
  }
  if(S.champion) order=[S.champion, ...order.filter(c=>c!==S.champion)];
  const ranking=order.filter(c=>c && c!=="BYE").map(c=>S.labelOf[c]||c);
  return {
    id:S.seed,
    date:new Date().toISOString(),
    name:S.tournamentName||null,
    mode:S.mode,
    stages:S.stages.map(st=>({type:st.type, entrants:st.entrants.length, pools:st.pools?st.pools.length:null, advance:st.advance||null})),
    participants:S.entities.map(c=>S.labelOf[c]||c),
    matches,
    ranking,
    champion:S.champion?(S.labelOf[S.champion]||null):null,
    events:(S.events||[]).slice()
  };
}

/* ---- snapshot save/load (resume after a restart) ----
   JSON.stringify drops custom props on arrays (rounds carry them),
   so deepSafe lifts them into {__arr:true, items:[...]} wrappers
   and deepRevive re-attaches them. Validation happens before
   anything is swapped in: a bad file is rejected whole. */

const SNAPSHOT_V = 3;
const VALID_STEPS = ["roster","mode","pairing","teamsFormed","toomany","stageChoice","play","standings"];

function isPlainObj(x){ return x !== null && typeof x === "object" && !Array.isArray(x); }

function deepSafe(v){
  if (Array.isArray(v)){
    // own string-keyed props = custom properties on this array
    const props = Object.keys(v).filter(k => !/^\d+$/.test(k));
    const items = v.map(deepSafe);
    if (props.length){
      const rec = { __arr: true, items };
      for (const k of props) rec[k] = deepSafe(v[k]);
      return rec;
    }
    return items;
  }
  if (isPlainObj(v)){
    const out = {};
    for (const k of Object.keys(v)) out[k] = deepSafe(v[k]);
    return out;
  }
  return v;
}

function deepRevive(v){
  if (Array.isArray(v)) return v.map(deepRevive);
  if (isPlainObj(v)){
    if (v.__arr === true && Array.isArray(v.items)){
      const arr = v.items.map(deepRevive);
      for (const k of Object.keys(v)){
        if (k === "__arr" || k === "items") continue;
        arr[k] = deepRevive(v[k]);
      }
      return arr;
    }
    const out = {};
    for (const k of Object.keys(v)) out[k] = deepRevive(v[k]);
    return out;
  }
  return v;
}

function saveStateSnapshot(){
  return {
    v: SNAPSHOT_V,
    savedAt: new Date().toISOString(),
    state: deepSafe(S)
  };
}

// Saved rounds: plain arrays, or {__arr:true, items:[...]} wrappers.
function roundItemsOf(r){
  if (r == null) return null;
  if (Array.isArray(r)) return r;
  if (isPlainObj(r) && r.__arr === true && Array.isArray(r.items)) return r.items;
  return undefined; // malformed
}

function validateSnapshot(snap){
  if (!isPlainObj(snap)) return "not a JSON object";
  if (snap.v !== SNAPSHOT_V) return "saved by a different version of the app";
  const st = snap.state;
  if (!isPlainObj(st)) return "missing tournament state";
  if (!VALID_STEPS.includes(st.step)) return "unknown step";
  if (typeof st.seed !== "string" || !st.seed) return "missing tournament id";
  if (st.step !== "roster"){
    if (!Array.isArray(st.names) || st.names.length < 2) return "roster too short";
    if (!Array.isArray(st.entities) || !st.entities.length) return "no entrants";
    if (!isPlainObj(st.labelOf)) return "missing name map";
    if (!isPlainObj(st.table)) return "missing standings table";
    for (const c of st.entities){
      if (typeof c !== "string" || !c) return "bad entrant code";
      if (typeof st.labelOf[c] !== "string") return "missing name for an entrant";
    }
  }
  if (["stageChoice","play","standings"].includes(st.step)){
    if (!isPlainObj(st.schedule) || !Array.isArray(st.schedule.rounds)) return "missing draw";
    for (const r of st.schedule.rounds){
      const items = roundItemsOf(r);
      if (items === undefined) return "a round is malformed";
      if (!items) continue;
      for (const m of items){
        if (m == null) continue;
        // a/b must exist; null marks a TBD slot later in a bracket
        const badSide = (v) => v != null && typeof v !== "string";
        if (!isPlainObj(m) || !("a" in m) || !("b" in m) || badSide(m.a) || badSide(m.b)) return "a match is malformed";
      }
    }
    if (st.step === "play"){
      if (!Number.isInteger(st.roundIndex) || st.roundIndex < 0 || st.roundIndex >= st.schedule.rounds.length)
        return "round pointer out of range";
      const cur = roundItemsOf(st.schedule.rounds[st.roundIndex]);
      if (!cur || !cur.length) return "current round is empty";
    }
  }
  if (st.undoStack != null && !Array.isArray(st.undoStack)) return "corrupt undo stack";
  if (st.events != null && !Array.isArray(st.events)) return "corrupt event log";
  return null; // valid
}

function loadStateSnapshot(snap){
  const problem = validateSnapshot(snap);
  if (problem) return { ok:false, reason:"Not a tournament saved by this app (" + problem + ")." };
  let st;
  try { st = deepRevive(snap.state); }
  catch (_) { return { ok:false, reason:"Not a tournament saved by this app (unreadable)." }; }
  // post-revive sanity: the current round must be real
  if (st.step === "play"){
    const cur = st.schedule.rounds[st.roundIndex];
    if (!Array.isArray(cur) || !cur.length) return { ok:false, reason:"Not a tournament saved by this app (bad current round)." };
  }
  // defensive defaults — never trust a file blindly
  st.events = Array.isArray(st.events) ? st.events : [];
  st.undoStack = Array.isArray(st.undoStack) ? st.undoStack : [];
  st.stages = Array.isArray(st.stages) ? st.stages : [];
  st.blocks = Array.isArray(st.blocks) ? st.blocks : [];
  st.teams = Array.isArray(st.teams) ? st.teams : [];
  Object.values(isPlainObj(st.table)?st.table:{}).forEach(r=>{
    if(!r) return;
    r.draws=r.draws||0; r.played=r.played!=null?r.played:(r.wins||0)+r.draws+(r.losses||0);
    if(r.pts==null) r.pts=(r.wins||0)*3+r.draws;
  });
  st.forbidden = Array.isArray(st.forbidden) ? st.forbidden : [];
  st.directives = isPlainObj(st.directives) ? st.directives
    : {format:null,pools:null,qualify:null,pipeline:[],limit:null,strict:false,duration:null,breakMins:null,byes:null};
  st.labelOf = isPlainObj(st.labelOf) ? st.labelOf : {};
  st.table = isPlainObj(st.table) ? st.table : {};
  // old files have no timing; football defaults apply
  st.duration = (Number.isInteger(st.duration) && st.duration>=1 && st.duration<=300) ? st.duration : 90;
  st.breakMins = (Number.isInteger(st.breakMins) && st.breakMins>=0 && st.breakMins<=60) ? st.breakMins : 15;
  delete st.points;
  S = st;
  return { ok:true };
}

module.exports = {
  getState,
  getStateForWire,
  reset,
  restartTournament,
  addTeam,
  removeTeam,
  submitRoster,
  pickMode,
  addForbidden,
  removeForbidden,
  formTeams,
  goToPairing,
  confirmTeamsAndDraw,
  goToDraw,
  chooseStage,
  saveScore,
  draftScore,
  continueTournament,
  pickStage,
  undoScore,
  roundComplete,
  getTournamentRecord,
  saveStateSnapshot,
  loadStateSnapshot,
  isSuspended,
  setSuspended
};
