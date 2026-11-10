/* Focus engine: the Corrected and Gate-only scores. A PROXY for focus, not a validated measure.
   Loaded by muse-panel.html as a plain script (it shares the panel's globals). Tested by focus/focus.test.js.
   Needs from the panel (read at call time): S, FS, BUF_LEN, focus (legacy state), quantile, MIN_SPAN.
   Provides: PIPE_FP, CST_NAMES, CHIDX, chanOK, fc, fg, CAL, CAL_WHY, calibCheck, setCal, chanBands, evalWin, corrStep, baseOf.
   Also uses QC and qcStep from focus-calibration.js. */
"use strict";
/* ============ CORRECTED focus (muscle-corrected ln(beta/alpha); a PROXY, not validated focus) ============
   Runs on every 250 ms window whichever score is shown, with its own smoothing and baselines (fc), so switching is instant.
   Per channel AF7/AF8, linear power from one 256-point Hann periodogram: excess = max(emg - emg_rest - margin, 0); beta_neural = beta - g * excess.
   Decision order (first match wins): rejected_gap, rejected_blink (+0.5 s holdoff), holdoff, rejected_emg_heavy, corrected_emg, ok.
   Needs calibration.json (from tools/calibrate.py) whose pipeline fingerprint equals PIPE_FP; otherwise the option is disabled and says why. */
const CWIN=256,CHOP=64;
const PIPE_FP="fs=256;win=256;hop=64;taper=hann;psd=onesided-density;hp=0.995;ch=AF7,AF8;avg=meanpower;log=ln;bands=delta1-4,theta4-8,alpha8-13,beta13-30,beta_lo13-20,emg30-40";
const CST_NAMES=["","ok","corrected_emg","rejected_emg_heavy","rejected_blink","rejected_gap","holdoff","no_contact"];
const chanOK=c=>S.pct[c]!=null&&S.pct[c]>=40; // a forehead sensor with usable skin contact (1 = AF7, 2 = AF8)
const CHIDX={AF7:1,AF8:2};
let CAL=null,CAL_WHY="No calibration loaded";
const mkSt=()=>({ema:null,fast:null,lo:null,hi:null,raw:NaN,st:0,valid:false,ratio:NaN,rem:NaN,t:-1,lastValidT:-1e9});
const fc=mkSt(),fg=mkSt(); // fc = corrected, fg = gate-only
function calibCheck(c){
  if(!c||typeof c!=="object")return "Calibration file is not valid";
  if(c.version!==1)return "Calibration version "+c.version+" is not supported";
  if(c.fingerprint!==PIPE_FP)return "Calibration does not match this panel's settings (recalibrate)";
  const ok=v=>typeof v==="number"&&isFinite(v);
  if(!Array.isArray(c.channels)||!c.channels.length||c.channels.some(ch=>!CHIDX[ch]))return "Calibration lists no usable sensor";
  for(const ch of c.channels){
    const r=c.rest&&c.rest[ch],g=c.gains&&c.gains[ch];
    if(!r||!ok(r.emg)||!ok(r.alpha)||!ok(r.beta)||!ok(r.margin)||r.emg<=0||r.alpha<=0||r.beta<=0)return "Calibration is missing rest levels for "+ch;
    if(!ok(g)||g<0)return "Calibration has no valid muscle gain for "+ch;
  }
  for(const k of ["T_heavy","floor","max_removed_frac","max_hold_s","p2p_limit_uV"])if(!ok(c[k])||c[k]<=0)return "Calibration is missing "+k;
  return "";
}
function setCal(c){
  const why=calibCheck(c);
  CAL=why?null:c;CAL_WHY=why;
  for(const s of [fc,fg]){s.ema=s.fast=s.lo=s.hi=null;s.st=0;s.valid=false;s.raw=s.ratio=s.rem=NaN;s.lastValidT=-1e9;}
  return why;
}
/* one-sided PSD band powers from a 256-sample Hann periodogram (radix-2 FFT) */
const HANN=new Float64Array(CWIN),HSUM2=(()=>{let s=0;for(let i=0;i<CWIN;i++){HANN[i]=0.5-0.5*Math.cos(2*Math.PI*i/CWIN);s+=HANN[i]*HANN[i];}return s;})();
const FFT_RE=new Float64Array(CWIN),FFT_IM=new Float64Array(CWIN);
function fft(re,im){
  const n=re.length;
  for(let i=1,j=0;i<n;i++){let b=n>>1;for(;j&b;b>>=1)j^=b;j^=b;if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}}
  for(let len=2;len<=n;len<<=1){
    const a=-2*Math.PI/len,wr=Math.cos(a),wi=Math.sin(a);
    for(let i=0;i<n;i+=len){let cr=1,ci=0;
      for(let k=0;k<len/2;k++){
        const u=i+k,v=i+k+len/2,xr=re[v]*cr-im[v]*ci,xi=re[v]*ci+im[v]*cr;
        re[v]=re[u]-xr;im[v]=im[u]-xi;re[u]+=xr;im[u]+=xi;
        const t=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=t;}}}
}
function chanBands(c){ // returns {alpha,beta,emg,p2p} in uV^2 (linear), 1 Hz bins
  const buf=S.raw[c];let mean=0,mn=Infinity,mx=-Infinity;
  for(let k=0;k<CWIN;k++){const v=buf[(S.rawPos-CWIN+k+BUF_LEN)%BUF_LEN];FFT_RE[k]=v;mean+=v;if(v<mn)mn=v;if(v>mx)mx=v;}
  mean/=CWIN;for(let k=0;k<CWIN;k++){FFT_RE[k]=(FFT_RE[k]-mean)*HANN[k];FFT_IM[k]=0;}
  fft(FFT_RE,FFT_IM);
  const sc=2/(FS*HSUM2),df=FS/CWIN,P=k=>(FFT_RE[k]*FFT_RE[k]+FFT_IM[k]*FFT_IM[k])*sc*df;
  const band=(lo,hi)=>{let s=0;for(let k=Math.ceil(lo/df);k*df<hi;k++)s+=P(k);return s;};
  return {alpha:band(8,13),beta:band(13,30),emg:band(30,40),p2p:mx-mn};
}
function evalWin(st,f,C,subtract,chs){ // st = state (fc or fg); subtract=true -> corrected, false -> gate-only (same extractor and gate, no subtraction)
  const t=S.emitted/FS,n=chs.length;
  let beta=0,alpha=0,heavy=false,anyExcess=false,ratio=0,rem=0;
  for(let i=0;i<n;i++){
    const r=C.rest[chs[i]],g=subtract?C.gains[chs[i]]:0,x=f[i];
    const excess=Math.max(x.emg-r.emg-r.margin,0),removed=g*excess,bn=x.beta-removed;
    ratio=Math.max(ratio,x.emg/r.emg);rem=Math.max(rem,x.beta>0&&subtract?removed/x.beta:0);
    if(excess>0)anyExcess=true;
    if(subtract&&(bn<C.floor*r.beta||removed>C.max_removed_frac*x.beta))heavy=true;
    beta+=bn/n;alpha+=x.alpha/n;                                               // mean power over the working forehead sensors, then ln
  }
  st.ratio=ratio;st.rem=subtract?rem:NaN;
  if(ratio>(subtract?C.T_heavy:(C.T_gate_only||3))||heavy||!(beta>0)||!(alpha>0)){st.st=3;return;} // 4. heavy muscle: rejected (gate-only uses the old 3x gate)
  const F=Math.log(beta)-Math.log(alpha);
  st.raw=F;st.valid=true;st.st=subtract&&anyExcess?2:1;st.lastValidT=t;        // 5/6. corrected_emg (corrected only) / ok
  st.ema=st.ema==null?F:st.ema+0.08*(F-st.ema);
  st.fast=st.fast==null?F:st.fast+0.22*(F-st.fast);
  if(focus.cal)focus.cal[st===fc?"valsC":"valsG"].push(st.fast);
}
function corrStep(){
  if(QC&&S.connected)qcStep([chanBands(1),chanBands(2)]);
  if(!S.connected||!CAL){for(const s of [fc,fg]){s.st=0;s.valid=false;}return;}
  const t=S.emitted/FS,C=CAL,used=C.channels.filter(nm=>chanOK(CHIDX[nm])),f=used.map(nm=>chanBands(CHIDX[nm]));
  for(const s of [fc,fg]){s.t=t;s.raw=NaN;s.ratio=NaN;s.rem=NaN;s.valid=false;}
  let early=0;
  if(!used.length)early=7;                                                     // no forehead sensor has skin contact
  else if(S.emitted-S.gapAt<CWIN)early=5;                                           // 1. packet gap inside the window
  else if(f.some(w=>w.p2p>C.p2p_limit_uV)){early=4;S.holdUntil=t+0.5;} // 2. blink / big swing (+0.5 s hold-off)
  else if(t<S.holdUntil)early=6;                                               // 3. hold-off
  if(early){fc.st=fg.st=early;return;}
  evalWin(fc,f,C,true,used);evalWin(fg,f,C,false,used);
}
function baseOf(src){ // same baseline recipe as the legacy score (outliers out, 10th/90th percentile, minimum span)
  if(src.length<12)return null;
  const s=[...src].sort((x,y)=>x-y),q1=quantile(s,.25),q3=quantile(s,.75),iqr=q3-q1;
  const inl=s.filter(v=>v>=q1-1.5*iqr&&v<=q3+1.5*iqr);
  let lo=quantile(inl,.10),hi=quantile(inl,.90);
  if(hi-lo<MIN_SPAN){const mid=(lo+hi)/2;lo=mid-MIN_SPAN/2;hi=mid+MIN_SPAN/2;}
  return {lo,hi};
}
