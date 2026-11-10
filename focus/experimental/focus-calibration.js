/* Quick muscle calibration for the Corrected and Gate-only scores (CAL button).
   8 s relaxed, then 2 x (4 s clench jaw + scrunch forehead, 2 s relax) = 20 s. For each forehead sensor with skin contact it fits
   the resting levels and the muscle gain (Theil-Sen), refuses a poor fit, and stores calibration.json-format data in localStorage.
   Needs from the panel: S, FS, toast, renderFocus, $, focus. Needs from focus-engine.js: CWIN, setCal, calibCheck, chanBands, chanOK, PIPE_FP, CAL_WHY. */
"use strict";
const CKEY = "muse2panel.calib";
function loadSavedCal(){try{const s=localStorage.getItem(CKEY);if(s){const why=setCal(JSON.parse(s));if(why)CAL_WHY=why;}}catch(e){CAL=null;CAL_WHY="Saved calibration could not be read";}}
/* ============ quick muscle calibration (CAL button): 20 s relaxed, then 3 jaw clenches. Fits rest levels and the muscle gain in the panel. ============ */
let QC=null;
const QC_REST=8,QC_REPS=2,QC_END=QC_REST+6*QC_REPS; // 8 s relaxed, then 2 x (4 s tense + 2 s relax) = 20 s
function startQuickCal(){
  if(!S.connected){toast("Connect the headband first, then press CAL.","info");return;}
  if(QC||focus.cal)return;
  QC={rest:[],clench:[],msg(){const t=S.emitted/FS-QC.t0;
    if(t<QC_REST)return "CAL 1/2: relax your face, eyes open ("+Math.ceil(QC_REST-t)+"s)";
    const k=Math.floor((t-QC_REST)/6),u=(t-QC_REST)%6;
    return u<4?"CAL 2/2: CLENCH your jaw AND scrunch your forehead, hard ("+Math.ceil(4-u)+"s, rep "+(k+1)+" of "+QC_REPS+")":"CAL: relax (rep "+(k+1)+" of "+QC_REPS+")";},t0:S.emitted/FS};
  renderFocus();
}
function theilSen(x,y){const sl=[],n=x.length,st=Math.max(1,Math.floor(n/150));
  for(let i=0;i<n;i+=st)for(let j=i+1;j<n;j+=st)if(x[j]!==x[i])sl.push((y[j]-y[i])/(x[j]-x[i]));
  if(!sl.length)return null;sl.sort((a,b)=>a-b);const g=sl[sl.length>>1];
  const ic=[];for(let i=0;i<n;i++)ic.push(y[i]-g*x[i]);ic.sort((a,b)=>a-b);return {g,b0:ic[ic.length>>1]};}
const meanOf=a=>a.reduce((p,q)=>p+q,0)/a.length,sdOf=a=>{const m=meanOf(a);return Math.sqrt(meanOf(a.map(v=>(v-m)**2)));};
const quant=(a,q)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(q*(s.length-1)))];};
function qcStep(f){
  const t=S.emitted/FS-QC.t0;
  if(S.emitted-S.gapAt<CWIN)return;
  if(t>=3&&t<QC_REST)QC.rest.push(f);
  else if(t>=QC_REST&&t<QC_END){const u=(t-QC_REST)%6;if(u>=1&&u<4)QC.clench.push(f);} // only windows lying entirely inside a tense period
  if(t>=QC_END){const q=QC;QC=null;finishQuickCal(q);}
}
function finishQuickCal(q){
  const fail=m=>{toast("Calibration failed: "+m,"info",9000);focus.result="Calibration failed: "+m;renderFocus();};
  if(q.rest.length<12||q.clench.length<12)return fail("not enough clean data (contact lost?). Try again.");
  const rest={},gains={},r2={},chans=[],notes=[];let ratios=[];
  const pp=q.clench.map(w=>Math.max(w[0].p2p,w[1].p2p)).filter(v=>v<300);
  const p2pLim=Math.max(100,Math.min(300,1.2*(pp.length?quant(pp,.9):100)));
  for(let c=0;c<2;c++){
    const nm=c?"AF8":"AF7";
    if(!chanOK(c+1)){notes.push(nm+" has no skin contact ("+Math.round(S.pct[c+1]||0)+"%), so it is skipped");continue;}
    const R=q.rest.map(w=>w[c]);
    const r={emg:meanOf(R.map(w=>w.emg)),alpha:meanOf(R.map(w=>w.alpha)),beta:meanOf(R.map(w=>w.beta))};
    r.margin=2*sdOf(R.map(w=>w.emg));
    const use=[...q.rest.map(w=>w[c]),...q.clench.map(w=>w[c])].filter(w=>w.p2p<300);
    const x=use.map(w=>Math.max(w.emg-r.emg-r.margin,0)),y=use.map(w=>w.beta);
    const nex=x.filter(v=>v>0).length,peak=Math.max(...q.clench.map(w=>w[c].emg))/r.emg;
    if(nex<8){notes.push(nm+": muscle level only rose "+peak.toFixed(1)+"x, clench harder");continue;}
    const fit=theilSen(x,y);if(!fit||!(fit.g>0)){notes.push(nm+": beta did not rise with muscle");continue;}
    const my=meanOf(y),pred=x.map(v=>fit.b0+fit.g*v),rr=1-y.reduce((a,v,i)=>a+(v-pred[i])**2,0)/y.reduce((a,v)=>a+(v-my)**2,0);
    if(!(rr>=0.2)){notes.push(nm+": muscle explains too little of beta (R² "+rr.toFixed(2)+")");continue;}
    rest[nm]=r;gains[nm]=fit.g;r2[nm]=rr;chans.push(nm);
    ratios=ratios.concat(q.clench.map(w=>w[c].emg/r.emg).filter(v=>v>1));
  }
  if(!chans.length)return fail(notes.join("; ")+". Try again.");
  const Th=Math.max(3,Math.min(20,ratios.length?quant(ratios,.75):5));
  const c={version:1,fingerprint:PIPE_FP,source:"quick-panel-calibration",created:new Date().toISOString(),channels:chans,rest,gains,r2,T_heavy:Th,T_gate_only:3,floor:0.2,max_removed_frac:0.6,max_hold_s:3,p2p_limit_uV:p2pLim};
  const why=setCal(c);
  if(why)return fail(why);
  try{localStorage.setItem(CKEY,JSON.stringify(c));}catch(e){}
  focus.result="Calibration done using "+chans.join(" + ")+(notes.length?" ("+notes.join("; ")+")":"")+". Press Auto Set Baselines, then pick Corrected or Gate.";
  toast("Calibration done on "+chans.join(" + ")+". Corrected and Gate-only are now available."+(notes.length?" Note: "+notes.join("; "):""),"info",9000);renderFocus();
}

function initFocusCalibration(){
  $("fmLoad").addEventListener("click",e=>{if(e.shiftKey)$("calFile").click();else startQuickCal();});
  $("calFile").addEventListener("change",e=>{ // load a calibration.json made elsewhere
    const f=e.target.files[0];e.target.value="";if(!f)return;
    f.text().then(txt=>{
      let c=null,why="";try{c=JSON.parse(txt);}catch(err){why="Calibration file is not valid JSON";}
      if(!why)why=calibCheck(c);
      if(why){CAL_WHY=why;toast("Calibration rejected: "+why,"info");}
      else{setCal(c);try{localStorage.setItem(CKEY,txt);}catch(err){}toast("Calibration loaded. Corrected is available. Press Auto Set Baselines to set its range.","info");}
      renderFocus();
    });
  });
}
