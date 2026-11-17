/* panel/guide.js
   Setup guide: four steps with live checks (connect, fit, baselines, play). Opens by itself the first time, and from the Guide button.
   It only presses the panel's own buttons, so it cannot get out of step with them.
   Classic script. Uses: core.js (S, DEMO), pulse.js (PL), focus.js (focus), ../arousal.js link (ArousalMeter), ../game/menu.js (GameMenu). */
"use strict";
(function(){
const $=id=>document.getElementById(id),KEY="musePanelGuideSeen";
const g=document.createElement("div");g.id="guide";
g.innerHTML=`<div class="box">
  <button class="x" id="gdClose">CLOSE (Esc)</button>
  <h2>SETUP GUIDE</h2><div class="sub" id="gdSub">Four steps. Each one turns green by itself when it is done.</div>
  <div class="step" data-s="1"><div class="n">1</div><div class="b"><h3>Connect the headband</h3>
    <p>Turn the Muse 2 on, close the Muse app on your phone, then press Connect and pick your Muse in the browser's list. Use Chrome or Edge.</p>
    <div class="live" id="gd1"></div></div><button id="gdConnect">CONNECT</button></div>
  <div class="step" data-s="2"><div class="n">2</div><div class="b"><h3>Check the fit</h3>
    <p>All four sensors should read 70% or more: two behind the ears, two on the forehead. Move hair away, sit the band snugly, and stay still for a few seconds.</p>
    <div class="live" id="gd2"></div></div></div>
  <div class="step" data-s="3"><div class="n">3</div><div class="b"><h3>Set your baselines</h3>
    <p><b>Arousal</b> sets itself: just sit still for 15 seconds. <b>Focus</b> needs one button press, then 10 seconds drifting from relaxed to concentrating.</p>
    <div class="live" id="gd3"></div></div><button id="gdCal">SET FOCUS BASELINES</button></div>
  <div class="step" data-s="4"><div class="n">4</div><div class="b"><h3>Play</h3>
    <p>Open the game menu. Defuse uses your arousal; Mario Kart uses your focus.</p><div class="live" id="gd4"></div></div><button id="gdPlay">OPEN GAMES</button></div>
  <label class="again"><input type="checkbox" id="gdAgain"> Show this guide when the panel opens</label>
</div>`;
document.body.appendChild(g);
let timer=null;
const seen=()=>{try{return localStorage.getItem(KEY)==="1";}catch(e){return false;}};
const setSeen=v=>{try{v?localStorage.setItem(KEY,"1"):localStorage.removeItem(KEY);}catch(e){}};
function open(){g.style.display="flex";$("gdAgain").checked=!seen();render();clearInterval(timer);timer=setInterval(render,400);}
function close(){g.style.display="none";clearInterval(timer);setSeen(!$("gdAgain").checked);}
function render(){
  const on=S.connected,pct=S.pct.map(v=>v==null?null:Math.round(v)),fit=on&&S.emitted>0&&pct.every(v=>v!=null&&v>=70),someFit=on&&pct.filter(v=>v!=null&&v>=70).length>=2;
  const fOk=focus.lo!=null&&focus.hi!=null,ar=window.ArousalMeter,arSt=ar?ar.state():"waiting",arOk=!!(ar&&ar.ready());
  const done=[on,fit,on&&fOk&&arOk,false];
  $("gd1").innerHTML=on?`<span class="ok">Connected${DEMO?" (simulated data)":""}.</span>`:S.connecting?"Connecting...":`Not connected.${DEMO?" Demo mode: Connect starts simulated data.":""}`;
  $("gd2").innerHTML=!on?"Connect first.":["TP9","AF7","AF8","TP10"].map((n,i)=>`<span class="${pct[i]==null?"":pct[i]>=70?"ok":pct[i]>=40?"mid":"bad"}">${n} ${pct[i]==null?"--":pct[i]+"%"}</span>`).join(" &nbsp; ")+` &nbsp; <span class="${PL.bpm!=null?"ok":"mid"}">pulse ${PL.bpm!=null?"ok":"not yet"}</span>`+(fit?"":someFit?"<br>Usable, but adjust the weak sensors for better readings.":"<br>Adjust the band until the numbers rise.");
  $("gd3").innerHTML=!on?"Connect first.":`<span class="${arOk?"ok":"mid"}">Arousal: ${arOk?"live":arSt==="resting"?"measuring your rest, sit still...":"waiting for signals"}</span> &nbsp; <span class="${fOk?"ok":"mid"}">Focus: ${focus.cal?"recording... drift from relaxed to concentrating":fOk?"baselines set":"not set yet"}</span>`;
  $("gd4").innerHTML=on&&arOk?`<span class="ok">Ready.</span> ${fOk?"":"(Mario Kart also needs focus baselines.)"}`:"You can already open the games: Defuse has a test mode with a slider.";
  let cur=done.indexOf(false)+1;
  g.querySelectorAll(".step").forEach(el=>{const i=+el.dataset.s;el.classList.toggle("done",!!done[i-1]);el.classList.toggle("cur",i===cur);});
  $("gdConnect").disabled=on||S.connecting;$("gdConnect").textContent=on?"CONNECTED":"CONNECT";
  $("gdCal").disabled=!on||!!focus.cal;$("gdCal").textContent=fOk?"SET FOCUS AGAIN":"SET FOCUS BASELINES";
}
$("gdClose").addEventListener("click",close);
g.addEventListener("pointerdown",e=>{if(e.target===g)close();});
addEventListener("keydown",e=>{if(e.key==="Escape"&&g.style.display==="flex"){e.stopPropagation();close();}},true);
$("gdConnect").addEventListener("click",()=>$("btnConnect").click());
$("gdCal").addEventListener("click",()=>$("btnCal").click());
$("gdPlay").addEventListener("click",()=>{close();if(window.GameMenu)GameMenu.open();});
const btn=$("btnGuide");if(btn)btn.addEventListener("click",open);
window.PanelGuide={open,close};
addEventListener("load",()=>{if(!seen()&&params.get("guide")!=="0")open();});
})();
