/* panel/motion.js
   Motion gate: reads the Muse 2 accelerometer and gyroscope and decides when head movement makes the EEG untrustworthy.
   This is MEASUREMENT GATING, not artifact removal: while movement is flagged the focus scores stop updating (the last valid value is held and
   marked as held), and they resume after the headband has been still for MOT.STABLE_S. The EEG filters, bands and formulas are not touched.
   The accelerometer cannot see jaw clenching or forehead tension without head movement; those still need the EEG-side checks in focus/.
   Classic script: shares the page's global scope with the other panel/*.js files. Loads before dsp.js (dsp.js calls motionStep()).
   Needs: S, FS, toast (optional), localStorage (optional). Tested by panel/motion.test.js. */
"use strict";
const MOT={
  K_ENTRY:5,K_EXIT:3,        // threshold = baseline median + k x MAD (starting values, tune from recordings)
  STABLE_S:1.5,              // still time required before measurement resumes
  WIN_S:1.0,MARGIN_S:0.25,   // motion window = the 1 s EEG window the focus step just used, plus a margin on each side of the timestamps
  STALE_S:0.5,MIN_SAMPLES:25,// no motion packet for this long, or fewer samples than this in the window = no usable motion data
  PKT_FS:52,                 // Muse accelerometer / gyroscope rate (3 samples per packet)
  CAL_SEC:30,CAL_MIN_KEEP:0.6,CAL_OUT_K:8,
  FLOOR:{acc:0.0015,gyro:0.3},                           // smallest MAD allowed, so a perfectly quiet calibration cannot give a hair-trigger
  DEFAULT:{acc:{entry:0.02,exit:0.01},gyro:{entry:10,exit:5},calibrated:false}, // provisional until the user runs the still calibration
  KEY:"muse2panel.motcal",
  th:null
};
MOT.th=JSON.parse(JSON.stringify(MOT.DEFAULT));
try{const j=JSON.parse(localStorage.getItem(MOT.KEY)||"null");if(j&&j.acc&&j.acc.entry>j.acc.exit&&j.acc.exit>0){MOT.th=j;MOT.th.calibrated=true;}}catch(e){}

function mkMot(){
  return {acc:{t:[],m:[]},gyro:{t:[],m:[]},seq:{acc:null,gyro:null},accSeen:false,gyroSeen:false,
    state:"VALID",stable:0,lastStep:0,status:"UNAVAILABLE",bad:false,
    accRms:NaN,gyroRms:NaN,quality:NaN,lastValidT:-1e9,badSec:0,cal:null,calMsg:""};
}
function resetMotion(){S.mot=mkMot();}
resetMotion();

/* A real gyroscope reads a constant few deg/s when perfectly still (zero-rate offset; 7.5 deg/s measured on one Muse 2), which is above the
   5 deg/s "still" threshold, so the gate never released. The offset is the long-run mean per axis (a head cannot keep turning one way), tracked
   with a 10 s average after a quick start, and removed before the samples are used by this gate and by the engine. */
function gyroUnbias(m,v){
  const b=m.gBias||(m.gBias={n:0,o:[0,0,0]}),out=v.slice();
  for(let k=0;k<3&&3*k+2<v.length;k++){
    b.n++;const a=b.n<104?1/b.n:1/(MOT.PKT_FS*10);
    for(let j=0;j<3;j++){b.o[j]+=(v[3*k+j]-b.o[j])*a;out[3*k+j]=v[3*k+j]-b.o[j];}
  }
  return out;
}

/* one packet = 3 samples of x/y/z in physical units (g, deg/s). Timestamps are the arrival time spread back over the packet. */
function onMotion(kind,seq,v,now){
  const m=S.mot;if(!m)return;
  if(m.seq[kind]===seq)return;m.seq[kind]=seq;
  now=now==null?Date.now():now;
  if(kind==="gyro")v=gyroUnbias(m,v);
  const q=m[kind],keep=now-6000;
  for(let k=0;k<3&&3*k+2<v.length;k++){
    q.t.push(now-(2-k)*1000/MOT.PKT_FS);q.m.push(Math.hypot(v[3*k],v[3*k+1],v[3*k+2]));
  }
  while(q.t.length&&q.t[0]<keep){q.t.shift();q.m.shift();}
  if(kind==="acc")m.accSeen=true;else m.gyroSeen=true;
  if(typeof engTapMotion==="function")engTapMotion(kind,v,now);
}

/* features over the motion samples that cover the EEG window (by timestamp). null = motion data missing or stale. */
function motionFeatures(now){
  const m=S.mot,lo=now-(MOT.WIN_S+MOT.MARGIN_S)*1000;
  const pick=(q,diff)=>{
    if(!q.t.length||now-q.t[q.t.length-1]>MOT.STALE_S*1000)return null;
    const a=[];for(let i=0;i<q.t.length;i++)if(q.t[i]>=lo)a.push(q.m[i]);
    if(a.length<MOT.MIN_SAMPLES)return null;
    let s=0,n=0;
    if(diff){for(let i=1;i<a.length;i++){const d=a[i]-a[i-1];s+=d*d;n++;}}      // gravity cancels in consecutive differences
    else{for(let i=0;i<a.length;i++){s+=a[i]*a[i];n++;}}
    return Math.sqrt(s/n);
  };
  const acc=pick(m.acc,true);if(acc==null)return null;
  let gyro=null;
  if(m.gyroSeen){gyro=pick(m.gyro,false);if(gyro==null)return null;}              // gyro was streaming and stopped: fail safe
  return {acc,gyro};
}

/* call once per 250 ms focus step, before the focus scores are computed. Sets S.mot.bad / S.mot.status. */
function motionStep(now){
  const m=S.mot;if(!m)return;
  now=now==null?Date.now():now;
  const dt=m.lastStep?Math.min(0.5,(now-m.lastStep)/1000):0.25;m.lastStep=now;
  if(!m.accSeen){m.status="UNAVAILABLE";m.bad=false;m.accRms=m.gyroRms=m.quality=NaN;return;} // this headband/firmware sends no motion: gate off, and the panel says so
  const f=motionFeatures(now);
  if(!f){ // missing or stale motion data is never read as "no movement"
    m.status="NO_MOTION_DATA";m.bad=true;m.state="MOVEMENT";m.stable=0;m.accRms=m.gyroRms=m.quality=NaN;m.badSec+=dt;return;
  }
  m.accRms=f.acc;m.gyroRms=f.gyro==null?NaN:f.gyro;
  const T=MOT.th,gy=f.gyro!=null;
  const over=f.acc>T.acc.entry||(gy&&f.gyro>T.gyro.entry);
  const under=f.acc<T.acc.exit&&(!gy||f.gyro<T.gyro.exit);
  if(m.state==="VALID"){if(over){m.state="MOVEMENT";m.stable=0;}}
  else if(under){m.stable+=dt;if(m.stable>=MOT.STABLE_S){m.state="VALID";m.stable=0;}}
  else m.stable=0;                                                              // hysteresis: only the lower (exit) threshold counts as still
  m.bad=m.state!=="VALID";m.status=m.bad?"MOVEMENT_DETECTED":"VALID";
  m.quality=Math.max(0,1-Math.max(f.acc/T.acc.entry,gy?f.gyro/T.gyro.entry:0));
  if(m.bad)m.badSec+=dt;else m.lastValidT=now;
  if(m.cal){
    m.cal.f.push({acc:f.acc,gyro:f.gyro});
    if(now-m.cal.t0>=MOT.CAL_SEC*1000)finishMotionCal();
  }
}

/* ============ still calibration: sit still ~30 s, thresholds = median + k x MAD of the windows ============ */
const med=a=>{const s=[...a].sort((x,y)=>x-y),n=s.length;return n?(n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2):NaN;};
const madOf=(a,m0)=>med(a.map(v=>Math.abs(v-m0)));
function motionCalibrate(feats){ // pure: returns {th} or {error}
  const N=feats.length;if(N<40)return {error:"Too little motion data ("+N+" windows). Check the headband is on and press again."};
  const hasG=feats.every(f=>f.gyro!=null);
  const base=(key)=>{const v=feats.map(f=>f[key]),m0=med(v);return {m0,mad:Math.max(madOf(v,m0),MOT.FLOOR[key])};};
  const ba=base("acc"),bg=hasG?base("gyro"):null;
  if(ba.m0>MOT.DEFAULT.acc.entry||(hasG&&bg.m0>MOT.DEFAULT.gyro.entry))return {error:"The headband was moving for most of the calibration. Sit still and press again."}; // the median itself is not "still"
  const kept=feats.filter(f=>f.acc<=ba.m0+MOT.CAL_OUT_K*ba.mad&&(!hasG||f.gyro<=bg.m0+MOT.CAL_OUT_K*bg.mad)); // windows where the user moved are discarded
  if(kept.length<MOT.CAL_MIN_KEEP*N)return {error:"You moved during calibration ("+(N-kept.length)+" of "+N+" windows were not still). Sit still and press again."};
  const one=(key)=>{const v=kept.map(f=>f[key]),m0=med(v),mad=Math.max(madOf(v,m0),MOT.FLOOR[key]);
    return {entry:m0+MOT.K_ENTRY*mad,exit:m0+MOT.K_EXIT*mad,median:m0,mad};};
  const th={acc:one("acc"),gyro:hasG?one("gyro"):MOT.th.gyro,calibrated:true,gyroUsed:hasG,t:Date.now()};
  return {th,kept:kept.length,total:N};
}
function startMotionCal(){
  const m=S.mot;
  if(!S.connected||!m)return;
  if(!m.accSeen){if(typeof toast==="function")toast("No motion data from this headband, so there is nothing to calibrate.","info");return;}
  m.cal={t0:Date.now(),f:[]};m.calMsg="";
}
function finishMotionCal(){
  const m=S.mot,r=motionCalibrate(m.cal.f);m.cal=null;
  if(r.error){m.calMsg=r.error;if(typeof toast==="function")toast(r.error,"error");return;}
  MOT.th=r.th;m.state="VALID";m.stable=0;
  try{localStorage.setItem(MOT.KEY,JSON.stringify(r.th));}catch(e){}
  m.calMsg="Motion calibrated ("+r.kept+" still windows)";
  if(typeof toast==="function")toast(m.calMsg,"info");
}

/* the line in the heart-rate card: click it to calibrate */
function motionUi(){
  const el=$("stMot");if(!el)return;const m=S.mot;let t="motion --",cls="";
  if(S.connected&&m){
    if(m.cal)t="motion CAL "+Math.max(0,Math.ceil(MOT.CAL_SEC-(Date.now()-m.cal.t0)/1000))+"s";
    else if(m.status==="UNAVAILABLE")t=S.emitted>FS*3?"no motion data from headband":"motion --";
    else if(m.status==="NO_MOTION_DATA")t="motion data missing";
    else if(m.bad)t="MOVING, measurement paused";
    else t="motion ok"+(MOT.th.calibrated||(typeof engIsNew==="function"&&engIsNew())?"":" (uncalibrated)");
    cls=m.bad&&!m.cal?"bad":"";
  }
  el.textContent=t;el.className="inl"+(cls?" "+cls:"");
  el.title=typeof engIsNew==="function"&&engIsNew()?"Head movement gate (the new engine tunes its thresholds by itself)":"Click, then sit still for "+MOT.CAL_SEC+" s to calibrate the movement thresholds";
}

/* ============ recording columns (appended after the focus columns; nothing renamed) ============ */
const MOTION_REC_COLNAMES=["motion_acc_rms_g","motion_gyro_rms_dps","motion_state"];
const MOTION_STATE_NAMES=["unavailable","valid","movement_detected","no_motion_data"];
function motionRecFill(d,o){ // o = index of the first motion column in this row
  const m=S.mot;if(!m){d[o]=d[o+1]=d[o+2]=NaN;return;}
  d[o]=m.accRms;d[o+1]=m.gyroRms;d[o+2]=m.status==="VALID"?1:m.status==="MOVEMENT_DETECTED"?2:m.status==="NO_MOTION_DATA"?3:0;
}
function motionRecFormat(k,v){ // k = 0..2 within the motion columns
  if(k===2)return MOTION_STATE_NAMES[v]||"";
  return v!==v?"":v.toFixed(4);
}
