/* ============================================================
   Table Tennis tournament logic — server-side authoritative copy.
   Ported from the original single-page app. Same algorithms and
   state machine; DOM reads/alerts replaced with plain arguments
   and thrown errors so a WebSocket server can drive it.

   v1.1 — multi-stage tournaments:
   - every stage of the tournament is chosen: round robin,
     elimination (with byes), hybrid, or pools (n pools, x players,
     w qualifiers each)
   - a stage can feed its qualifiers into any next stage, chosen
     live at each boundary or pre-declared with 'then:' directives
   - directive lines in the roster box configure everything
   - H2H tie-break ladder for pool / round-robin qualification
   - cross-pool bracket seeding (1A vs 2B …) for knockouts
   - undo last score, strict table-tennis scoring, 'limit:' cap
   ============================================================ */

function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
// Deterministic shuffle for lotteries: same seed string -> same order,
// so every place that ranks a dead-even group agrees with every other
// place (qualification, seeding, display) within one tournament.
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

// Build a knockout bracket from an ORDERED seed list. Pads with BYE
// entities up to the next power of two, pairs seed i vs seed P+1-i
// (so byes land against the top seeds — standard practice), and
// auto-resolves any BYE match as an 11–0 walkover so the draw moves
// on by itself.
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
  // auto-play BYE matches (walkover, no table impact — a bye isn't a player)
  round1.forEach(m=>{
    if(m.a==="BYE" || m.b==="BYE"){
      const byeSide = m.a==="BYE";
      m.played=true;
      m.winner = byeSide ? m.b : m.a;
      m.scoreA = byeSide ? 0 : 11;
      m.scoreB = byeSide ? 11 : 0;
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
  entities.forEach(code=>{ t[code]={code, wins:0, losses:0, pf:0, pa:0, diff:0}; });
  return t;
}
function updateTable(table, a, sa, b, sb){
  table[a].pf+=sa; table[a].pa+=sb;
  table[b].pf+=sb; table[b].pa+=sa;
  if(sa>sb){ table[a].wins++; table[b].losses++; } else { table[b].wins++; table[a].losses++; }
  table[a].diff=table[a].pf-table[a].pa;
  table[b].diff=table[b].pf-table[b].pa;
}
function compareTeams(t1,t2){
  if(t1.wins!==t2.wins) return t2.wins-t1.wins;
  if(t1.losses!==t2.losses) return t1.losses-t2.losses;
  return t2.diff-t1.diff;
}
function standingsOf(table, codes){
  return codes.map(c=>table[c]).sort(compareTeams);
}

// ---- Tie-break helpers ----
function tiedGroup(st, startIndex){
  if(startIndex>=st.length) return [];
  const base=st[startIndex];
  return st.filter(t=>t.wins===base.wins && t.losses===base.losses && t.diff===base.diff);
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

/* ============================================================
   v1.1 — ROSTER DIRECTIVES
   Optional lines in the roster box:

     format: rr|elim|hybrid|pools|auto   — stage 1 (auto = classic
                                           count-based behaviour)
     pools: N                            — auto-split into N pools
     qualify: W                          — winners per pool (default 1)
     then: rr:4, elim                    — pre-declared later stages
     limit: N                            — per-stage match cap
     rules: strict                       — 11-point win-by-2 scoring

   Blank lines split the names into blocks — each block is one
   pool (custom sizes), and a 'qualify: W' line inside a block
   sets that pool's winners.
   ============================================================ */

const DIRECTIVE_RE=/^\s*(format|pools|qualify|then|limit|rules)\s*:\s*(.*)$/i;

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
  const directives={format:null, pools:null, qualify:null, then:null, limit:null, rules:null};
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
        // a 'qualify:' before anything else is the global default;
        // once names/blocks have started it configures the block
        // it sits in (or the block about to start)
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
  return String(raw).split(",").map(s=>s.trim()).filter(Boolean).map(tok=>{
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
  }).filter((spec,i,arr)=>{
    const last=i===arr.length-1;
    if(last && spec.fmt==="rr" && spec.advance!=null)
      throw new Error("The last stage in 'then:' must crown a champion — rr:"+spec.advance+" leaves players hanging. Put it earlier in the chain.");
    if(!last && (spec.fmt==="elim" || spec.fmt==="hybrid" || (spec.fmt==="rr" && spec.advance==null)))
      throw new Error("'"+spec.fmt+"' finishes the tournament — remove the stages after '"+tok+"'.");
    return true;
  });
}

function parseDirectives(d){
  const out={format:null, pools:null, qualify:null, pipeline:[], limit:null, strict:false};
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
  return out;
}

/* ============================================================
   v1.1 — LADDER RANKING (pool / round-robin qualification order)

   Order within a group:
     1. wins
     2. wins in matches BETWEEN the tied players (head-to-head)
     3. point difference in those head-to-head matches
     4. overall point difference
     5. overall points for
     6. lottery (recorded in S.lotto — the app flags it happened)

   This always terminates — no infinite tie-break replays.
   ============================================================ */

function orderGroupLadder(codes, stageIdx, recordLotto){
  const clean=[...new Set(codes)].filter(c=>c && c!=="BYE" && S.table[c]);
  if(clean.length<2) return clean;
  // collect head-to-head results among these codes from rounds that
  // belong to the given stage (untagged rounds count as current too)
  const h2h={};
  clean.forEach(c=>h2h[c]={wins:0, diff:0});
  for(const r of S.schedule.rounds){
    if(stageIdx!=null && r.stageIndex!=null && r.stageIndex!==stageIdx) continue;
    for(const m of r){
      if(!m.played || !m.a || !m.b) continue;
      if(h2h[m.a]===undefined || h2h[m.b]===undefined) continue;
      if(m.a==="BYE" || m.b==="BYE") continue;
      const w=m.scoreA>m.scoreB?m.a:m.b;
      h2h[w].wins++;
      h2h[m.a].diff+=m.scoreA-m.scoreB;
      h2h[m.b].diff+=m.scoreB-m.scoreA;
    }
  }
  const sorted=clean.slice().sort((a,b)=>{
    if(S.table[b].wins!==S.table[a].wins) return S.table[b].wins-S.table[a].wins;
    if(h2h[b].wins!==h2h[a].wins) return h2h[b].wins-h2h[a].wins;
    if(h2h[b].diff!==h2h[a].diff) return h2h[b].diff-h2h[a].diff;
    if(S.table[b].diff!==S.table[a].diff) return S.table[b].diff-S.table[a].diff;
    if(S.table[b].pf!==S.table[a].pf) return S.table[b].pf-S.table[a].pf;
    return 0;
  });
  // any run still dead-even after every criterion is drawn by lot —
  // seeded so the same run always comes out the same way
  const out=[];
  let i=0;
  while(i<sorted.length){
    let j=i+1;
    const same=(x,y)=>S.table[x].wins===S.table[y].wins && h2h[x].wins===h2h[y].wins &&
      h2h[x].diff===h2h[y].diff && S.table[x].diff===S.table[y].diff && S.table[x].pf===S.table[y].pf;
    while(j<sorted.length && same(sorted[i],sorted[j])) j++;
    let run=sorted.slice(i,j);
    if(run.length>1){
      run=seededShuffle(run, S.seed+"|"+(stageIdx==null?"x":stageIdx)+"|"+run.slice().sort().join(","));
      if(recordLotto && !S.lotto.includes(run[0])) S.lotto.push(...run);
    }
    out.push(...run);
    i=j;
  }
  return out;
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
    S.rankOrder=null; return;
  }
  const seen=new Set(order);
  S.elimOrder.forEach(c=>{ if(!seen.has(c)){ order.push(c); seen.add(c); } });
  S.rankOrder=order;
}

/* ============================================================
   APP STATE (single shared game — one tournament per server run)
   ============================================================ */

function createInitialState(){
  return {
    step:"roster",
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
    // v1.1
    directives:{format:null,pools:null,qualify:null,pipeline:[],limit:null,strict:false},
    blocks:[],
    stages:[],
    stageIndex:-1,
    stageChoice:null,
    rankOrder:null,
    elimOrder:[],
    lotto:[],
    undoStack:[],
    seed:String(Math.random())
  };
}

let S = createInitialState();
function getState(){ return S; }

// Wire format: custom properties stored on round ARRAYS (eliminated,
// stageLabel) are silently dropped by JSON.stringify, so they never
// reached the browser — the elimination banner and OUT tags in the
// original app could never actually fire. Project them into a plain
// object keyed by round index instead.
function getStateForWire(){
  const wire={...S};
  if(S.schedule){
    const roundMeta={eliminated:{}, stageLabel:{}};
    S.schedule.rounds.forEach((r,i)=>{
      if(r && r.eliminated && r.eliminated.length) roundMeta.eliminated[i]=r.eliminated.slice();
      if(r && r.stageLabel) roundMeta.stageLabel[i]=r.stageLabel;
    });
    wire.schedule={...S.schedule, rounds:S.schedule.rounds, roundMeta};
  }
  return wire;
}

/* ============================================================
   STEP TRANSITIONS — driven by explicit arguments.
   ============================================================ */

function reset(){ S = createInitialState(); }

function submitRoster(raw){
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
  if(names.length<2) throw new Error("Enter at least 2 player names.");

  const {codeMap, codeToName}=assignCodes(names);
  S.names=names; S.codeMap=codeMap; S.codeToName=codeToName;
  S.directives=directives;
  S.blocks=blocks.map(b=>({names:b.names.slice(), qualify:b.qualify!=null?b.qualify:directives.qualify}));
  S.pipeline=directives.pipeline.slice();
  S.limit=directives.limit;
  S.rules={strict:directives.strict};

  if(names.length%2!==0){
    S.mode="single";
    S.entities=Object.values(codeMap);
    S.labelOf=Object.fromEntries(names.map(n=>[codeMap[n], n]));
    routeStage1();
  } else {
    S.step="mode";
  }
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

// Decide how the first stage begins: a directive builds it straight
// away; otherwise the admin picks from the stage-choice screen.
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
  } else {
    buildStage(cfg.fmt, S.entities, {});
  }
}

// Turn typed roster blocks into pool descriptors.
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

// Balanced snake deal: shuffle, then 1,2,…N / N,…,2,1 so pools
// stay even in size.
function autoSplitPoolsCfg(entities, n, w){
  n=parseInt(n,10);
  w=(w==null||w==="")?1:parseInt(w,10);
  if(!Number.isFinite(n) || n<1) throw new Error("Number of pools needs to be 1 or more.");
  const maxN=Math.max(1, Math.floor(entities.length/2));
  if(n>maxN) throw new Error(entities.length+" entrants can't fill "+n+" pools of at least 2 — use "+maxN+" or fewer.");
  const minSize=Math.floor(entities.length/n);
  if(!Number.isFinite(w) || w<1) throw new Error("Qualifiers per pool needs to be 1 or more.");
  if(w>=minSize) throw new Error("With "+n+" pools the smallest pool has "+minSize+" players — it can't qualify "+w+".");
  const shuffled=shuffle(entities.slice());
  const raw=Array.from({length:n},()=>[]);
  shuffled.forEach((c,i)=>{
    const row=Math.floor(i/n), col=i%n;
    const p=(row%2===0)?col:(n-1-col);
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

  // match cap: an explicit 'limit:' always applies; the classic 21
  // guard only protects the automatic legacy draw
  const count=stageMatchCount(stage);
  if(S.limit!=null && count>S.limit)
    throw new Error("That stage needs "+count+" matches — over the "+S.limit+"-match limit. Add 'limit: "+count+"' (or higher) to the roster to allow it.");

  S.stageIndex=S.stages.length-1;
  S.step="play";
  S.roundIndex=stage.roundStart;
  refreshRankOrder();
}

/* ---- Stage-choice screen (boundary between stages) ---- */

function enterStageChoice(stageNum, entrants, preselect){
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
    counts:{
      rr:n*(n-1)/2,
      elim:nextPow2(n)-1,
      hybrid:(n%2===0 && !isPowerOfTwo(n))?countMatches(n).matches:null,
      pools:null
    }
  };
}

function pickStage(p){
  if(S.step!=="stageChoice" || !S.stageChoice) throw new Error("There's no stage to pick right now.");
  const c=S.stageChoice;
  const format=normFormat(p && p.format);
  if(!format || format==="auto") throw new Error("Pick a format: round robin, elimination, hybrid or pools.");
  const entrants=c.entrants;

  if(format==="hybrid"){
    if(!(entrants.length%2===0 && !isPowerOfTwo(entrants.length)))
      throw new Error("Hybrid needs an even field that isn't a power of two (like 6, 10 or 12) — it has "+entrants.length+" entrants.");
    buildStage("hybrid", entrants, {});
  }
  else if(format==="pools"){
    const pools=autoSplitPoolsCfg(entrants, p.poolCount, p.poolQualify);
    buildStage("pools", entrants, {pools});
  }
  else if(format==="rr"){
    buildStage("rr", entrants, {advance:p.advance});
  }
  else {
    // elimination fed by an earlier stage is cross-seeded from it
    const prev=S.stages[S.stages.length-1];
    const seededOrder=(prev && prev.type==="pools")
      ? seedOrderFromPools(prev, entrants)
      : shuffle(entrants.slice());
    buildStage("elim", entrants, {seededOrder});
  }
  refreshRankOrder();
}

// Cross-pool seeding: all pool winners (ranked by their own pool
// record) first, then all runners-up, etc. Pairing seed i against
// seed P+1-i then guarantees pool rivals only meet late in the
// bracket — the classic 1A vs 2B draw. Only the qualifying players
// are seeded.
function seedOrderFromPools(stage, qualifiers){
  const qset=new Set(qualifiers);
  const byPosition=[];
  stage.pools.forEach(p=>{
    // rank AMONG the qualifiers of this pool — position 1 seeds, then
    // position 2 seeds, etc.
    const ordered=orderGroupLadder(p.members, stage.idx, true).filter(c=>qset.has(c));
    ordered.forEach((code,i)=>{
      if(!byPosition[i]) byPosition[i]=[];
      byPosition[i].push(code);
    });
  });
  const flat=[];
  byPosition.forEach(group=>{
    // within one position, rank by overall record then point diff
    group.sort((a,b)=>{
      const ta=S.table[a], tb=S.table[b];
      if(ta.wins!==tb.wins) return tb.wins-ta.wins;
      return tb.diff-ta.diff;
    });
    flat.push(...group);
  });
  return flat;
}

/* ---- Boundaries ---- */

function boundary(qualifiers){
  const q=[...new Set(qualifiers)].filter(c=>c && c!=="BYE");
  if(q.length<=1){
    if(q.length===1) S.champion=q[0];
    S.step="standings";
    refreshRankOrder();
    return;
  }
  const spec=S.pipeline.length?S.pipeline.shift():null;
  enterStageChoice(S.stages.length+1, q, spec);
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
    boundary(stage.qualifiers);
  }
}

function rrAdvance(stage, round){
  const ordered=orderGroupLadder(stage.entrants, stage.idx, true);
  const adv=ordered.slice(0,stage.advance);
  const outs=stage.entrants.filter(c=>!adv.includes(c));
  round.eliminated=outs;
  S.elimOrder.push(...outs);
  S.stageIndex++;
  boundary(adv);
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

/* ---- Legacy automatic draw (format: auto) — behaviour preserved ---- */

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

/* ---- Playing a round ---- */

function validTTScore(sa,sb){
  const hi=Math.max(sa,sb), lo=Math.min(sa,sb);
  if(hi>=11 && hi-lo>=2) return true; // a game: 11–7, 13–11 …
  if(hi===2 && lo<2) return true;    // best-of-3 match: 2–0, 2–1
  if(hi===3 && lo<3) return true;    // best-of-5 match: 3–0 … 3–2
  return false;
}

function saveScore(mi, sa, sb){
  if(!S.schedule) throw new Error("The draw hasn't been built yet.");
  const round=S.schedule.rounds[S.roundIndex];
  if(!round) throw new Error("That match doesn't exist.");
  const m=round[mi];
  if(!m) throw new Error("That match doesn't exist.");
  // sa/sb travel over JSON, where NaN becomes null — treat anything that
  // isn't a genuine finite number the same as an invalid score.
  const bad = typeof sa!=="number" || typeof sb!=="number" || !Number.isFinite(sa) || !Number.isFinite(sb);
  if(bad || sa===sb) throw new Error("Enter two different, valid scores.");
  if(m.played) throw new Error("That score is already saved — use Undo to change it.");
  if(m.a==="BYE" || m.b==="BYE") throw new Error("A bye doesn't need a score.");
  if(S.rules && S.rules.strict && !validTTScore(sa,sb))
    throw new Error("Strict scoring is on: enter a game score (winner reaches 11 and wins by 2, like 11–7 or 13–11) or a best-of match score (2–0, 2–1, 3–0, 3–1, 3–2).");
  S.undoStack.push({
    roundIndex:S.roundIndex, mi,
    match:{a:m.a,b:m.b,played:m.played,scoreA:m.scoreA,scoreB:m.scoreB,winner:m.winner,draftA:m.draftA,draftB:m.draftB},
    rowA:S.table[m.a]?{...S.table[m.a]}:null,
    rowB:S.table[m.b]?{...S.table[m.b]}:null
  });
  m.scoreA=sa; m.scoreB=sb; m.played=true;
  m.winner = sa>sb ? m.a : m.b;
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
      } else if(tb.stage==='hybrid-rr'){
        const rrIndex=idx-tb.rrStart;
        if(rrIndex===tb.rrCount-1){
          const st=standingsOf(S.table,tb.survivors);
          const group=tiedGroup(st,0);
          if(group.length===st.length){
            tb.regens=(tb.regens||0)+1;
            if(tb.regens>=2){
              // full tie even after a replay — settle it with the ladder
              finishTieBreak(orderGroupLadder(tb.survivors, curStageIdx(), true));
            } else {
              const rrRounds=generateRoundRobin(tb.survivors);
              tb.rrStart=S.schedule.rounds.length;
              tb.rrCount=rrRounds.length;
              S.schedule.rounds.push(...rrRounds);
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
          }
        } else {
          finishTieBreak(st.map(t=>t.code));
        }
      }
    }
  }
  else if(round[0] && round[0].isFinal){
    S.champion=round[0].winner;
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

module.exports = {
  getState,
  getStateForWire,
  reset,
  submitRoster,
  pickMode,
  addForbidden,
  removeForbidden,
  formTeams,
  goToPairing,
  confirmTeamsAndDraw,
  goToDraw,
  saveScore,
  draftScore,
  continueTournament,
  pickStage,
  undoScore,
  roundComplete
};
