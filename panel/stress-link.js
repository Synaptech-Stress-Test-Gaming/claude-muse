/* panel/stress-link.js
   Hands the experimental stress meter (../stress.js) the panel's live signals. If the signal path changes (for example a new blink filter),
   update only the callbacks below. Loaded after stress.js. */
"use strict";
/* experimental stress meter: reads the panel's live buffers (see stress.js) */
window.StressMeter=Stress.attach({
  demo:DEMO,calSec:params.get("stcal")||30,
  connected:()=>S.connected,
  heartRate:()=>(PL.bpm!=null&&PL.state!=="NO DATA"&&PL.state!=="WAIT")?PL.bpm:null,
  artifact:()=>Date.now()<S.artUntil,
  frontalWindows:()=>{const w=[];w.af7=null;w.af8=null;if(S.emitted<FS*4)return w;
    for(const c of [1,2]){const r=S.rms[c];if(r!=null&&r>0.5&&r<400){const a=new Float32Array(512);for(let i=0;i<512;i++)a[i]=S.raw[c][(S.rawPos-512+i+BUF_LEN)%BUF_LEN];w.push(a);if(c===1)w.af7=a;else w.af8=a;}}
    return w;},
  ppgWindow:()=>{if(PL.filled<PPG_FS*6)return null;const L=PL.bp.length,n=Math.min(PL.filled,L),x=new Float32Array(n);
    for(let i=0;i<n;i++){const k=(PL.bpPos-n+i+L*2)%L;x[i]=PL.bp[k];}return {x,fs:PPG_FS,pos:PL.bpPos,len:L,filled:PL.filled};}
});
