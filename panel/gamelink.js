/* panel/gamelink.js
   Connects the panel to games: the game-menu hookup and the focus/sensor feed sent to external games on 127.0.0.1:8765.
   Classic script: shares the page's global scope with the other panel/*.js files (load order is set in muse-panel.html).
   Uses: core.js, focus.js, game/menu.js */
"use strict";
/* ============ Game menu (game/menu.js) ============
   Games register in game/menu.js. The panel only supplies the live signals; add a game there, not here. */
function focusReady(){
  if(engIsNew()){const o=window.EngineOut;return !!(S.connected&&o&&["live","held","learning"].includes(o.focus.state));} // New: connected and focus live, held or learning
  if(S.dev==="cyton")return engLegacyPct()!=null;
  const f=shown();return f.lo!=null&&f.hi!=null&&f.hi-f.lo>=0.05;}
function stressLive(){if(engIsNew()){const o=window.EngineOut;return !!(S.connected&&o&&o.stress.state!=="unavailable");}return !!(window.StressMeter&&S.connected&&StressMeter.ready());}
/* the number games get as focus: New -> the engine focus (null when stale/unavailable); Legacy -> today's value */
function gameFocus(){if(!S.connected)return null;if(engIsNew()){const f=window.EngineOut&&EngineOut.focus;return f&&["live","held","learning"].includes(f.state)?f.value:null;}return S.dev==="cyton"?engLegacyPct():pctOf(focus);}
const engGameQ=[]; // button events for the in-page games (a separate queue from the HTTP one)
function engGameEvent(ev){engGameQ.push({id:ev.id,type:ev.type,t:ev.t,conf:ev.conf});if(engGameQ.length>64)engGameQ.shift();const q=engHttpQueue();if(q)q.push(ev);}
function marioReady(){return focusReady();}   // kept for older callers
function updateMarioBtn(){}                    // renderFocus() still calls this; the menu needs no per-frame update
addEventListener("load",()=>GameMenu.attach({button:$("btnMario"),note:null,
  ctx:()=>({stage:$("stage"),connected:S.connected,focusReady:focusReady(),stressLive:stressLive(),
    focus:()=>gameFocus(), // games always get the focus score, even when the panel shows stress
    stress:()=>{if(engIsNew()){const s=window.EngineOut&&EngineOut.stress;return S.connected&&s&&s.value!=null?s.value/100:null;}const v=window.StressMeter&&StressMeter.value();return v==null?0:v/100;},
    metrics:()=>window.EngineOut?{focus:EngineOut.focus,stress:EngineOut.stress,drowsiness:EngineOut.drowsiness}:null,
    events:()=>engGameQ.splice(0),engine:engMode,device:S.dev,
    sensors:()=>engSensors4().map(p=>({txt:p==null?"--":Math.round(p)+"%",cls:p==null?"":p>=70?"good":p>=40?"fair":"poor"})),
    status:()=>{const d=S.dev==="cyton"?"Cyton":"Muse";return S.connected?(S.emitted>0?d+" live":d+" waiting"):d+" not connected";}})}));
/* 4 contact numbers for old games: the Muse sensors, or on the Cyton the contact of Fp1, Fp2, O1, O2 */
function engSensors4(){
  if(S.dev!=="cyton")return S.pct.map(v=>S.connected&&S.emitted>0&&v!=null?v:null);
  const o=window.EngineOut,ch=engState.cfg?engState.cfg.channels:null;if(!o||!ch||!S.connected)return [null,null,null,null];
  return ["Fp1","Fp2","O1","O2"].map(n=>{const i=ch.indexOf(n);return i>=0?o.quality.perChannel[i]:null;});}
/* ============ game link: the focus meter (0-100) is sent to the game running on this computer ============ */
const GAME_URL="http://127.0.0.1:8765/";
let gameBusy=false,gameLast=0,gameOk=false,gameSeq=0;const gameSession=Date.now();
let engHttpQ_=null; // button events, resent until the server acknowledges them (created once the engine scripts have loaded)
function engHttpQueue(){if(!engHttpQ_&&window.MuseEngine&&MuseEngine.GameBody)engHttpQ_=MuseEngine.GameBody.queue();return engHttpQ_;}
/* v2 body (engine/gamebody.js): the first five fields keep their old meaning; p = the Legacy focus (panel/focus.js passes pctOf(focus)) */
function sendGame(p){
  const now=Date.now();
  if(gameBusy||now-gameLast<(gameOk?230:2000))return;
  gameLast=now;gameBusy=true;
  let body;
  if(window.MuseEngine&&MuseEngine.GameBody)body=MuseEngine.GameBody.build({engine:engMode,device:S.dev,mode:effMode(),sensors:engSensors4(),motion:S.dev==="cyton"?(window.EngineOut?EngineOut.quality.motion.toUpperCase():null):(S.mot?S.mot.status:null),
    legacyFocus:S.dev==="cyton"?engLegacyPct():p,legacyStale:S.dev==="cyton"?!!(window.EngineOut&&EngineOut.quality.motion!=="valid"):motionHeld(),out:S.connected?window.EngineOut:null,session:gameSession,seq:++gameSeq,events:engHttpQueue()?engHttpQueue().batch():[]});
  else body={focus:p==null?null:Math.round(p*10)/10,mode:effMode(),sensors:S.pct.map(v=>v==null?null:Math.round(v)),motion:S.mot?S.mot.status:null,stale:motionHeld()};
  const opt=S.connected?{method:"POST",mode:"cors",headers:{"Content-Type":"text/plain"},body:JSON.stringify(body)}:{method:"GET",mode:"cors"};
  fetch(GAME_URL,opt).then(r=>{gameOk=r.ok;return r.ok&&S.connected?r.json().catch(()=>({ok:true})):null;}).then(j=>{const q=engHttpQueue();if(q&&S.connected)q.reply(j);}).catch(()=>{gameOk=false;}).finally(()=>{
    gameBusy=false;const e=$("gameLink");
    e.textContent=gameOk?"GAME: LINKED":"GAME: OFF";e.style.color=gameOk?"#35e6ff":"#6f82c4";e.dataset.state=gameOk?"on":"off";});
}
function startCal(){
  if(S.dev==="cyton"&&typeof engLegacyCal==="function")return engLegacyCal(); // Cyton Legacy baselines: engine/legacy.js
  if(!S.connected||focus.cal)return;const t0=Date.now();focus.result="";
  focus.cal={t0,vals:[],all:[],msg(){const left=Math.max(0,CAL_SEC-(Date.now()-t0)/1000);return "RECORDING "+Math.ceil(left)+"s. Drift from relaxed to concentrating";}};
  renderFocus();
}
function finishCal(){
  const c=focus.cal;focus.cal=null;
  const src=c.vals.length>=20?c.vals:c.all;
  if(src.length<12){focus.result="No usable signal in the 10 seconds. Check the sensor percentages and press again.";renderFocus();return;}
  const s=[...src].sort((x,y)=>x-y),q1=quantile(s,.25),q3=quantile(s,.75),iqr=q3-q1;
  const inl=s.filter(v=>v>=q1-1.5*iqr&&v<=q3+1.5*iqr);
  let lo=quantile(inl,.10),hi=quantile(inl,.90),note="Baselines set. Focus is live.";
  if(hi-lo<MIN_SPAN){const mid=(lo+hi)/2;lo=mid-MIN_SPAN/2;hi=mid+MIN_SPAN/2;note="Baselines set (small change seen). Press again and shift your focus more for a wider range.";}
  focus.lo=lo;focus.hi=hi;focus.result=note;saveBaselines();
  renderFocus();
}
setInterval(()=>{
  const a=BANDS[2],b=BANDS[3],ok=a.n2>=20&&b.n2>=20;
  const am=ok?a.e2/a.n2:0,bm=ok?b.e2/b.n2:0;a.e2=a.n2=b.e2=b.n2=0;
  if(!S.connected){focus.ema=null;focus.fast=null;focus.cal=null;focus.raw=null;renderFocus();return;}
  if(ok&&S.usable>0&&!(S.mot&&S.mot.bad)){ // movement gate: no new legacy window is accepted while moving (the last value is held)
    const F=Math.log((bm+1e-3)/(am+1e-3));focus.raw=F;
    focus.ema=focus.ema==null?F:focus.ema+0.08*(F-focus.ema);
    focus.fast=focus.fast==null?F:focus.fast+0.22*(F-focus.fast);
    if(focus.cal){focus.cal.all.push(focus.fast);if(Date.now()>S.artUntil)focus.cal.vals.push(focus.fast);}
  }
  if(focus.cal&&(Date.now()-focus.cal.t0)/1000>=CAL_SEC)finishCal();
  renderFocus();
},250);
$("btnCal").addEventListener("click",startCal);
$("stMot").addEventListener("click",startMotionCal);
initFocusSwitch();loadBaselines();renderFocus();
