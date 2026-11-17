/* panel/arousal-link.js
   Feeds the arousal meter (../arousal.js) from the panel's live signals and draws it: the compact AROUSAL box under the heart
   rate, and a details window (click the box). If the signal path changes, only the three reader functions below need updating.
   Classic script. Uses: core.js (S, FS, BUF_LEN, DEMO, params), pulse.js (PL, PPG_FS), motion.js (motionLevel), ../arousal.js. */
"use strict";
(function(){
const TICK_MS=250,$=id=>document.getElementById(id);
const meter=Arousal.makeMeter({restSec:+(params.get("rest")||15)});
let beats=[],absPos=0,lastPos=null,lastFilled=0,hist=[],last=performance.now(),wasOn=false,feat={};

/* ---- readers: the only places that touch the panel's buffers ---- */
function readHeartRate(){ // beats are timed by sample position (device clock), so Bluetooth jitter does not leak in
  const fallback=(PL.bpm!=null&&PL.state!=="NO DATA"&&PL.state!=="WAIT")?PL.bpm:null;
  if(PL.filled<PPG_FS*4||Date.now()-PL.lastAt>3000){beats=[];lastPos=null;return fallback;}
  const L=PL.bp.length,n=Math.min(PL.filled,L),x=new Float32Array(n);
  for(let i=0;i<n;i++)x[i]=PL.bp[(PL.bpPos-n+i+L*2)%L];
  if(lastPos==null||PL.filled<lastFilled){beats=[];absPos=0;}else absPos+=(PL.bpPos-lastPos+L)%L;
  lastPos=PL.bpPos;lastFilled=PL.filled;
  Arousal.findBeats(x,PPG_FS).forEach(p=>{const t=(absPos-(n-1-p))/PPG_FS;if(!beats.length||t>beats[beats.length-1]+0.33)beats.push(t);});
  const tEnd=absPos/PPG_FS;beats=beats.filter(t=>t>tEnd-12);
  const hr=Arousal.hrFromBeats(beats.filter(t=>t>tEnd-8));
  return hr!=null?hr:fallback;
}
function readForehead(){ // last 2 s of the two forehead sensors, only those with usable contact
  const w=[];if(S.emitted<FS*4)return w;
  for(const c of [1,2]){const r=S.rms[c];if(r!=null&&r>0.5&&r<400){const a=new Float32Array(512);for(let i=0;i<512;i++)a[i]=S.raw[c][(S.rawPos-512+i+BUF_LEN)%BUF_LEN];w.push(a);}}
  return w;
}
function readMotion(){return typeof motionLevel==="function"?motionLevel():null;}

/* ---- details window ---- */
const det=document.createElement("div");det.id="arDetails";
det.innerHTML=`<div class="box">
  <button class="x" id="arClose">CLOSE (Esc)</button>
  <h2>AROUSAL</h2><div class="sub">How activated your body is compared with your own resting level. 0 = at rest, 100 = strongly activated.</div>
  <div class="top"><div class="num" id="arBig">--</div><canvas id="arGraph" width="1040" height="220"></canvas></div>
  <div class="rows">
    <div class="r" data-k="hr"><i></i><b>HEART RATE</b><span class="val">--</span><span class="m"><u></u></span><em>from the pulse sensor. Rises when you are worked up.</em></div>
    <div class="r" data-k="tension"><i></i><b>MUSCLE TENSION</b><span class="val">--</span><span class="m"><u></u></span><em>forehead and jaw muscles (try clenching your jaw).</em></div>
    <div class="r" data-k="motion"><i></i><b>MOVEMENT</b><span class="val">--</span><span class="m"><u></u></span><em>fidgeting and head tremor (try nodding).</em></div>
  </div>
  <div class="btns"><button id="arRest">MEASURE MY REST AGAIN</button><span id="arMsg"></span></div>
  <div class="demo" id="arDemo" style="display:none"><b>DEMO SIGNAL (simulated headband)</b>
    <label>Heart rate <input type="range" id="adHr" min="50" max="130" value="72"><span id="adHrV">72</span></label>
    <label>Face tension <input type="range" id="adGa" min="2" max="60" value="6"><span id="adGaV">6</span></label>
    <label>Movement <input type="range" id="adMo" min="1" max="60" value="3"><span id="adMoV">3</span></label></div>
  <div class="note">This is not a stress or anxiety measurement. It cannot tell stress from excitement, effort or caffeine, and it is only meaningful compared with your own rest on the same day. Brain signals (EEG) are not used here: they drive the focus meter.</div>
</div>`;
document.body.appendChild(det);
const open=()=>{det.style.display="flex";render();},close=()=>{det.style.display="none";};
$("arBox").addEventListener("click",open);$("arClose").addEventListener("click",close);
det.addEventListener("pointerdown",e=>{if(e.target===det)close();});
addEventListener("keydown",e=>{if(e.key==="Escape"&&det.style.display==="flex"){e.stopPropagation();close();}},true);
$("arRest").addEventListener("click",()=>{meter.rebaseline();hist=[];render();});
if(DEMO){$("arDemo").style.display="block";[["adHr","demoHr"],["adGa","demoGamma"],["adMo","demoMotion"]].forEach(([id,v])=>{const e=$(id);e.addEventListener("input",()=>{window[v]=+e.value;$(id+"V").textContent=e.value;});});}

/* ---- loop ---- */
function tick(){
  const now=performance.now(),dt=Math.min(1,(now-last)/1000);last=now;
  if(!S.connected){if(wasOn){meter.rebaseline();beats=[];lastPos=null;hist=[];}wasOn=false;feat={};render();return;}
  wasOn=true;
  feat={hr:readHeartRate(),tension:Arousal.tensionOf(readForehead()),motion:readMotion()};
  meter.push(feat,dt);
  if(meter.value!=null){hist.push(meter.value);if(hist.length>240)hist.shift();}
  render();
}
const fmt={hr:p=>Math.round(p.raw)+" bpm"+(p.base!=null?"  (rest "+Math.round(p.base)+")":""),
  tension:p=>p.base!=null?(p.delta>=0?"+":"")+p.delta.toFixed(1)+" vs rest":"measuring rest",
  motion:p=>p.base!=null?p.delta.toFixed(1)+"x rest":"measuring rest"};
function render(){
  const on=S.connected,v=on?meter.value:null,st=meter.state,left=meter.restLeft;
  const state=!on?"--":st==="live"?"LIVE":st==="resting"?"REST "+Math.ceil(left)+"s":"WAIT";
  $("arNum").textContent=v==null?"--":String(Math.round(v));$("arState").textContent=state;
  $("arFill").style.width=(v==null?0:Math.max(2,v))+"%";
  $("arNote").textContent=!on?"connect to use":st==="waiting"?"waiting for signals":st==="resting"?"sit still: measuring your rest":(left?"adding a signal... ":"")+"vs your rest · click for details";
  const dots={hr:"arH",tension:"arT",motion:"arM"};
  Arousal.KEYS.forEach(k=>{const p=meter.parts[k],el=$(dots[k]);el.className="inl "+(!on||p.raw==null?"":p.base==null?"rest":"on");el.style.setProperty("--lv",p.v==null?0:p.v);});
  if(det.style.display!=="flex")return;
  $("arBig").textContent=v==null?(st==="resting"?Math.ceil(left)+"s":"--"):String(Math.round(v));
  det.querySelectorAll(".r").forEach(row=>{const k=row.dataset.k,p=meter.parts[k];
    row.className="r "+(!on||p.raw==null?"off":p.base==null?"rest":"on");
    row.querySelector(".val").textContent=!on?"not connected":p.raw==null?"no signal":fmt[k](p);
    row.querySelector("u").style.width=(p.v==null?0:p.v*100)+"%";});
  $("arMsg").textContent=!on?"Connect the headband first.":st==="waiting"?"Waiting for signals. Check the headband fit.":st==="resting"?"Sit still and relax: measuring your resting level ("+Math.ceil(left)+" s).":meter.used().length<3?"Live, using: "+meter.used().map(k=>Arousal.LABEL[k].toLowerCase()).join(", ")+"."+(meter.parts.hr.raw==null?" No pulse signal yet (seat the headband snugly on your forehead).":""):"Live.";
  const cv=$("arGraph"),g=cv.getContext("2d"),W=cv.width,H=cv.height;g.clearRect(0,0,W,H);
  g.strokeStyle="rgba(110,150,255,.22)";g.lineWidth=1;g.fillStyle="rgba(160,180,235,.8)";g.font="18px sans-serif";
  [0,50,100].forEach(val=>{const y=H-6-val/100*(H-12);g.beginPath();g.moveTo(0,y);g.lineTo(W,y);g.stroke();g.fillText(String(val),6,y-4);});
  if(hist.length>1){g.strokeStyle="#ffb347";g.lineWidth=3;g.beginPath();hist.forEach((val,i)=>{const x=W-(hist.length-1-i)/240*W,y=H-6-Math.max(0,Math.min(100,val))/100*(H-12);i?g.lineTo(x,y):g.moveTo(x,y);});g.stroke();}
}
setInterval(tick,TICK_MS);render();
const api={value:()=>(S.connected&&meter.state==="live")?meter.value:null,ready:()=>S.connected&&meter.state==="live",state:()=>meter.state,parts:()=>meter.parts,meter,open,_tick:tick};
window.ArousalMeter=api;window.StressMeter=api; // StressMeter: old name, kept so older code keeps working
})();
