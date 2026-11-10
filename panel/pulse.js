/* panel/pulse.js
   Pulse sensor: heart-rate estimate from the infrared pulse signal (PL, onPpg, ppgAnalyse, hrUi).
   Classic script: shares the page's global scope with the other panel/*.js files (load order is set in muse-panel.html).
   Uses: core.js (FS-independent biquad helpers) */
"use strict";
/* ============ pulse (heart rate) ============
   Infrared pulse sensor on the forehead, 64 readings per second. Offset removed, then a 0.7-3.5 Hz pass band.
   Rate = strongest repeat period in the last 8 s (normalised autocorrelation); shown only when the repeat is clear, otherwise "--". */
const PL={seqLast:null,lost:0,packets:0,lastAt:0,n:0,hp:{x:null,y:0},f1:null,f2:null,
  raw:new Float32Array(PPG_FS*4),rawPos:0,bp:new Float32Array(PPG_FS*8),mk:new Uint8Array(PPG_FS*8),skip:0,bpPos:0,filled:0,
  scaleRaw:null,scaleBp:null,hist:[],bpm:null,pct:null,r:0,bad:0,state:"--",since:0,warned:false,fallback:false};
function ppgFilters(){const f0=Math.sqrt(0.7*3.5),Q=f0/(3.5-0.7);PL.f1=biquadFs(f0,Q,PPG_FS);PL.f2=biquadFs(f0,Q,PPG_FS);}
function ppgSignalReset(){PL.hp.x=null;PL.hp.y=0;ppgFilters();PL.n=0;PL.raw.fill(0);PL.bp.fill(0);PL.mk.fill(0);PL.skip=0;PL.rawPos=0;PL.bpPos=0;PL.filled=0;PL.hist=[];PL.bpm=null;PL.pct=null;PL.bad=0;PL.scaleRaw=null;PL.scaleBp=null;}
function ppgFullReset(){PL.seqLast=null;PL.lost=0;PL.packets=0;PL.lastAt=0;PL.since=Date.now();PL.warned=false;PL.state="--";ppgSignalReset();}
ppgFullReset();
function onPpg(seq,vals){
  PL.lastAt=Date.now();PL.packets++;
  if(PL.seqLast!=null){const d=(seq-PL.seqLast)&0xffff;if(d===0)return;
    if(d>1){PL.lost+=d-1;
      if(d>2)ppgSignalReset();
      else if(PL.n>=PPG_FS*2){ // 1-2 packets missing: leave an empty stretch in the timeline, never fill it in
        for(let k=0;k<(d-1)*PPG_PKT;k++){PL.raw[PL.rawPos]=NaN;PL.rawPos=(PL.rawPos+1)%PL.raw.length;PL.bp[PL.bpPos]=NaN;PL.mk[PL.bpPos]=0;PL.bpPos=(PL.bpPos+1)%PL.bp.length;if(PL.filled<PL.bp.length)PL.filled++;}
        PL.skip=24; // the filter needs a moment to settle after a gap
      }}}
  PL.seqLast=seq;
  for(const x of vals){
    const h=PL.hp;if(h.x==null){h.x=x;h.y=0;}
    const y=x-h.x+0.995*h.y;h.x=x;h.y=y;PL.n++;
    const b=PL.f2.p(PL.f1.p(y));
    if(PL.n<PPG_FS*2)continue; // first 2 s: offset removal and filters still settling, not shown
    PL.raw[PL.rawPos]=y;PL.rawPos=(PL.rawPos+1)%PL.raw.length;
    PL.bp[PL.bpPos]=b;PL.mk[PL.bpPos]=PL.skip>0?0:1;if(PL.skip>0)PL.skip--;PL.bpPos=(PL.bpPos+1)%PL.bp.length;
    if(PL.filled<PL.bp.length)PL.filled++;
  }
}
function ppgAnalyse(){
  if(!S.connected){PL.state="--";PL.bpm=null;PL.pct=null;PL.hist=[];return;}
  const age=Date.now()-PL.lastAt;
  if(PL.packets===0||age>3000){PL.state=(Date.now()-PL.since>10000)?"NO DATA":"WAIT";PL.bpm=null;PL.pct=null;PL.hist=[];return;}
  if(PL.filled<PPG_FS*6){PL.state="WAIT";return;}
  const L=PL.bp.length,n=Math.min(PL.filled,L),x=new Float32Array(n),m=new Uint8Array(n);
  for(let i=0;i<n;i++){const k=(PL.bpPos-n+i+L*2)%L;x[i]=PL.bp[k];m[i]=PL.mk[k];}
  const lo=Math.round(PPG_FS*60/180),hi=Math.round(PPG_FS*60/40),r=new Float32Array(hi+3);
  let best=lo,bv=-1;
  for(let l=lo-1;l<=hi+1;l++){let s=0,e1=0,e2=0; // only pairs where both readings really arrived
    for(let i=0;i+l<n;i++){if(m[i]&m[i+l]){const a=x[i],b=x[i+l];s+=a*b;e1+=a*a;e2+=b*b;}}
    const d=Math.sqrt(e1*e2);r[l]=d>0?s/d:0;
    if(l>=lo&&l<=hi&&r[l]>bv){bv=r[l];best=l;}}
  const hh=Math.round(best/2);
  if(hh>=lo){let hb=hh,hv=-1;for(let l=hh-2;l<=hh+2;l++)if(l>=lo&&l<=hi&&r[l]>hv){hv=r[l];hb=l;}
    if(hv>=0.85*bv){best=hb;bv=hv;}} // a clear repeat at half the period means the true period is the shorter one
  let lag=best;
  if(best>lo&&best<hi){const a=r[best-1],b=r[best],c=r[best+1],den=a-2*b+c;if(den<0)lag=best+0.5*(a-c)/den;}
  const inst=PPG_FS*60/lag,pRaw=Math.max(0,Math.min(1,(bv-0.15)/0.65))*100;
  PL.pct=PL.pct==null?pRaw:PL.pct+0.5*(pRaw-PL.pct);PL.r=bv;
  if(bv>=0.3&&inst>=40&&inst<=180){
    PL.hist.push(inst);if(PL.hist.length>5)PL.hist.shift();PL.bad=0;
    const s=[...PL.hist].sort((p,q)=>p-q);PL.bpm=s[Math.floor(s.length/2)];PL.state=PL.pct>=40?"LIVE":"WEAK";
  }else{PL.bad++;PL.state="WEAK";if(PL.bad>=4){PL.hist=[];PL.bpm=null;}}
}
function hrUi(){
  const on=S.connected,have=on&&PL.bpm!=null;
  $("hrNum").textContent=have?String(Math.round(PL.bpm)):"--";
  $("hrState").textContent=on?PL.state:"--";
  $("hrFill").style.width=have?Math.max(2,Math.min(100,(PL.bpm-40)/140*100))+"%":"0";
  const el=$("sen4"),q=el.querySelector(".q");let cls="",txt="--";
  if(on&&PL.pct!=null&&PL.state!=="NO DATA"&&PL.state!=="WAIT"){const p=Math.round(PL.pct);txt=p+"%";cls=p>=70?"good":p>=40?"fair":"poor";}
  el.className="sensor hr "+cls;q.textContent=txt;
  $("rq4").textContent=txt;$("rr4").textContent=have?Math.round(PL.bpm)+" bpm":"--";
  if(on&&PL.state==="NO DATA"&&!PL.warned){PL.warned=true;toast("No pulse data is coming from the headband yet. Brain signals are fine. Make sure the headband sits snug on your forehead, then press Disconnect and Connect once.","info",9000);}
}
