/* Focus mode switch: which score drives the panel (Legacy, Corrected or Gate-only). All three are computed continuously;
   this only changes what is displayed and sent to the game. Corrected and Gate-only are proxies, not validated focus.
   Needs from the panel: $, S, focus, pctOf, toast, renderFocus. Needs from the engine: fc, fg, CAL, CAL_WHY, CST_NAMES. QC comes from focus-calibration.js. */
"use strict";
const MKEY = "muse2panel.focusmode";
let MODE_PREF="legacy";
try{const m=localStorage.getItem(MKEY);MODE_PREF=m==="corrected"||m==="gate"?m:"legacy";}catch(e){}
function corrOK(){return !!CAL;}
function effMode(){return MODE_PREF!=="legacy"&&corrOK()?MODE_PREF:"legacy";}
const MODE_NAME={legacy:"Legacy",corrected:"Corrected",gate:"Gate-only"};
function shown(){const m=effMode();return m==="corrected"?fc:m==="gate"?fg:focus;}
function focusPct(){
  if(effMode()!=="legacy"){const s=shown();return s.valid?pctOf(s):null;} // an invalid window is a gap (no number), never a held value
  return pctOf(focus);
}
function setMode(m){
  MODE_PREF=m;try{localStorage.setItem(MKEY,m);}catch(e){}
  if(m!=="legacy"&&!corrOK())toast(MODE_NAME[m]+" is unavailable: "+CAL_WHY,"info");
  renderFocus();
}
/* the switch buttons, the label, the status badge and the note under FOCUS. Called from renderFocus(). */
function renderFocusSwitch(){
  const em=effMode(),sh=shown();
  $("fmL").classList.toggle("on",em==="legacy");$("fmC").classList.toggle("on",em==="corrected");$("fmG").classList.toggle("on",em==="gate");
  $("fmG").disabled=!corrOK();$("fmG").title=corrOK()?"Gate-only: new extractor and gate, no subtraction (a proxy, not validated focus)":"Gate-only unavailable: "+CAL_WHY;
  $("fmC").disabled=!corrOK();$("fmC").title=corrOK()?"Muscle-corrected score (a proxy, not validated focus)":"Corrected unavailable: "+CAL_WHY;
  $("fform").innerHTML=em==="legacy"?"LEGACY ln(&beta;&divide;&alpha;)":em==="gate"?"GATE-ONLY (proxy)":"CORRECTED (proxy)";
  let note;
  if(QC)note=QC.msg();
  else if(focus.cal)note=focus.cal.msg();
  else if(!S.connected)note="Connect to use focus";
  else if(S.usable===0)note="No sensor contact";
  else if(sh.lo==null||sh.hi==null)note=focus.result||"Press the button to set baselines";
  else note=focus.result||"Baselines set. Focus is live.";
  const fn=$("fnote");fn.textContent="";
  if(em!=="legacy"){
    const nm=CST_NAMES[sh.st]||"warming up",b=document.createElement("b");b.id="cstat";
    b.className=sh.st===1||sh.st===2?"":sh.st===6?"hold":"rej";b.textContent=nm+(sh.st?(sh.valid?" \u00b7 valid":" \u00b7 invalid"):"");
    fn.appendChild(b);
  }
  fn.appendChild(document.createTextNode(note+(MODE_PREF!=="legacy"&&!corrOK()?" "+MODE_NAME[MODE_PREF]+" unavailable: "+CAL_WHY+". Showing Legacy.":(!corrOK()?" (Corrected and Gate-only off: "+CAL_WHY+". Press CAL)":""))));
}
function initFocusSwitch(){
  $("fmL").addEventListener("click",()=>setMode("legacy"));
  $("fmC").addEventListener("click",()=>setMode("corrected"));
  $("fmG").addEventListener("click",()=>setMode("gate"));
}
