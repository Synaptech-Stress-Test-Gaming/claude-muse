/* panel/gamelink.js
   Connects the panel to games: the game-menu hookup and the focus/sensor feed sent to external games on 127.0.0.1:8765.
   Classic script: shares the page's global scope with the other panel/*.js files (load order is set in muse-panel.html).
   Uses: core.js, focus.js, game/menu.js */
"use strict";
/* ============ Game menu (game/menu.js) ============
   Games register in game/menu.js. The panel only supplies the live signals; add a game there, not here. */
function focusReady(){return focus.lo!=null&&focus.hi!=null&&focus.hi-focus.lo>=0.05;}
function stressLive(){return !!(window.ArousalMeter&&ArousalMeter.ready());}   // "stress" is the old name of the arousal meter
function marioReady(){return focusReady();}   // kept for older callers
function updateMarioBtn(){}                    // renderFocus() still calls this; the menu needs no per-frame update
addEventListener("load",()=>GameMenu.attach({button:$("btnMario"),note:null,
  ctx:()=>({stage:$("stage"),connected:S.connected,focusReady:focusReady(),stressLive:stressLive(),
    focus:()=>S.connected?focusPct():null,
    stress:()=>{const v=window.ArousalMeter&&ArousalMeter.value();return v==null?0:v/100;},
    sensors:()=>SENSORS.map((nm,i)=>{const p=S.connected&&S.emitted>0&&S.pct[i]!=null?Math.round(S.pct[i]):null;return{txt:p==null?"--":p+"%",cls:p==null?"":p>=70?"good":p>=40?"fair":"poor"};}),
    status:()=>S.connected?(S.emitted>0?"Muse live":"Muse waiting"):"Muse not connected"})}));
/* ============ game link: the focus meter (0-100) is sent to the game running on this computer ============ */
const GAME_URL="http://127.0.0.1:8765/";
let gameBusy=false,gameLast=0,gameOk=false;
function sendGame(p){
  const now=Date.now();
  if(gameBusy||now-gameLast<(gameOk?230:2000))return;
  gameLast=now;gameBusy=true;
  const opt=S.connected?{method:"POST",mode:"cors",headers:{"Content-Type":"text/plain"},body:JSON.stringify({focus:p==null?null:Math.round(p*10)/10,sensors:S.pct.map(v=>v==null?null:Math.round(v)),arousal:(window.ArousalMeter&&ArousalMeter.value()!=null)?Math.round(ArousalMeter.value()*10)/10:null})}:{method:"GET",mode:"cors"};
  fetch(GAME_URL,opt).then(r=>{gameOk=r.ok;}).catch(()=>{gameOk=false;}).finally(()=>{
    gameBusy=false;const e=$("gameLink");
    e.textContent=gameOk?"GAME: LINKED":"GAME: OFF";e.style.color=gameOk?"#35e6ff":"#6f82c4";});
}
function startCal(){
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
  focus.lo=lo;focus.hi=hi;focus.result=note;renderFocus();
}
setInterval(()=>{
  const a=BANDS[2],b=BANDS[3],ok=a.n2>=20&&b.n2>=20;
  const am=ok?a.e2/a.n2:0,bm=ok?b.e2/b.n2:0;a.e2=a.n2=b.e2=b.n2=0;
  if(!S.connected){focus.ema=null;focus.fast=null;focus.cal=null;renderFocus();return;}
  if(ok&&S.usable>0){
    const F=Math.log((bm+1e-3)/(am+1e-3));
    focus.ema=focus.ema==null?F:focus.ema+0.08*(F-focus.ema);
    focus.fast=focus.fast==null?F:focus.fast+0.22*(F-focus.fast);
    if(focus.cal){focus.cal.all.push(focus.fast);if(Date.now()>S.artUntil)focus.cal.vals.push(focus.fast);}
  }
  if(focus.cal&&(Date.now()-focus.cal.t0)/1000>=CAL_SEC)finishCal();
  renderFocus();
},250);
$("btnCal").addEventListener("click",startCal);
