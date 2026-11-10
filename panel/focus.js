/* panel/focus.js
   The focus meter (ln beta/alpha, personal baselines) and the always-on-top floating meter.
   Classic script: shares the page's global scope with the other panel/*.js files (load order is set in muse-panel.html).
   Uses: core.js, dsp.js, ui.js */
"use strict";
/* ============ focus ============
   F = ln( beta power / alpha power ), smoothed ~3 s.  Meter = 25 + 50 x (F - low) / (high - low), held to 0..100 (low baseline = 25, high baseline = 75).
   Uses the true band signal; sliders and mutes only change what is drawn. */
const CAL_SEC=+(params.get("cal")||10),MIN_SPAN=0.4;
const focus={ema:null,fast:null,lo:null,hi:null,cal:null,result:""};
function quantile(s,q){const p=(s.length-1)*q,i=Math.floor(p),f=p-i;return s[i]+(s[Math.min(i+1,s.length-1)]-s[i])*f;}
function focusPct(){
  if(focus.ema==null||focus.lo==null||focus.hi==null||focus.hi-focus.lo<0.05)return null;
  return Math.max(0,Math.min(100,25+(focus.ema-focus.lo)/(focus.hi-focus.lo)*50)); // low baseline = 25, high baseline = 75, the rest extends from there
}
function renderFocus(){
  const p=focusPct(),txt=p==null?"--":String(Math.round(p));
  $("fnum").textContent=txt;
  [...fbar.children].forEach((s,i)=>s.classList.toggle("lit",p!=null&&i<Math.round(p/100*FSEG)));
  let note;
  if(focus.cal)note=focus.cal.msg();
  else if(!S.connected)note="Connect to use focus";
  else if(S.usable===0)note="No sensor contact";
  else if(focus.lo==null||focus.hi==null)note=focus.result||"Press the button to set baselines";
  else note=focus.result||"Baselines set. Focus is live.";
  $("fnote").textContent=note;
  $("btnCal").disabled=!(S.connected&&!focus.cal);
  $("btnCal").classList.toggle("on",focus.lo!=null&&focus.hi!=null&&!focus.cal);
  if(S.pip){S.pip.num.textContent=txt;[...S.pip.bar.children].forEach((s,i)=>s.classList.toggle("lit",p!=null&&i<Math.round(p/100*FSEG)));S.pip.note.textContent=p==null?(S.connected?"Set baselines in the panel":"Not connected"):"";}
  sendGame(p);
  updateMarioBtn();
}
/* ============ floating focus meter (small always-on-top window) ============ */
const PIP_CSS=`
*{box-sizing:border-box;margin:0;padding:0}
body{background:radial-gradient(ellipse at 20% 0%,#2a1d6e,#050a26 65%);color:#eaf3ff;font-family:"Segoe UI",sans-serif;padding:10px 14px;height:100vh;overflow:hidden;border:1px solid #6a5cff}
.t{font-size:11px;letter-spacing:.34em;color:#8fa6ff}
.n{font-size:46px;font-weight:300;line-height:1.05;text-shadow:0 0 14px rgba(120,150,255,.9)}
.b{display:flex;align-items:flex-end;gap:3px;height:34px;margin-top:4px}
.b span{flex:1;background:rgba(60,50,190,.45);border:1px solid rgba(140,120,255,.55)}
.b span.lit{background:linear-gradient(0deg,#9a4bff,#3fd6ff 70%,#fff);border-color:#7fe6ff}
.s{font-size:11px;color:#9fb2e6;margin-top:3px;min-height:14px;letter-spacing:.04em}`;
async function toggleFloat(){
  if(S.pip){S.pip.w.close();return;}
  if(!("documentPictureInPicture" in window)){toast("The floating meter needs Microsoft Edge or Chrome, version 116 or newer.","error");return;}
  try{
    const w=await documentPictureInPicture.requestWindow({width:300,height:136});
    try{w.moveTo(screen.availLeft+screen.availWidth-320,screen.availTop+8);}catch(e){}
    const st=w.document.createElement("style");st.textContent=PIP_CSS;w.document.head.appendChild(st);
    w.document.body.innerHTML=`<div class="t">FOCUS</div><div class="n" id="n">--</div><div class="b" id="b"></div><div class="s" id="s"></div>`;
    const bar=w.document.getElementById("b");for(let i=0;i<FSEG;i++){const s=w.document.createElement("span");s.style.height=(22+i*(78/(FSEG-1)))+"%";bar.appendChild(s);}
    S.pip={w,num:w.document.getElementById("n"),bar,note:w.document.getElementById("s")};
    $("btnFloat").classList.add("on");$("btnFloat").lastChild.textContent="Close float";
    w.addEventListener("pagehide",()=>{S.pip=null;$("btnFloat").classList.remove("on");$("btnFloat").lastChild.textContent="Float focus";});
    renderFocus();
    toast("Floating meter is on. Minimize this panel (do not close it) and the meter stays on top. Drag it to the top right if you like.","info",9000);
  }catch(e){console.error(e);toast("Could not open the floating meter. Press the button again.","error");}
}
$("btnFloat").addEventListener("click",toggleFloat);
