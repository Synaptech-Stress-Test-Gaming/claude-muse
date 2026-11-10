/* panel/dsp.js
   Signal path: packet alignment (no interpolation), offset removal, band filtering, sensor contact quality, 1 s status refresh. Julian: put the blink / head-movement filter here (see emit()).
   Classic script: shares the page's global scope with the other panel/*.js files (load order is set in muse-panel.html).
   Uses: core.js, pulse.js, ui.js */
"use strict";
/* ============ stream handling (no interpolation, nothing invented) ============ */
function resetStream(){
  S.maps.forEach(m=>m.clear());S.seqLast=[null,null,null,null];S.seqAbs=[0,0,0,0];S.nextIdx=null;S.maxIdx=-1;
  S.alignMode="seq";S.qArr=[[],[],[],[]];S.stall=0;S.lastEmitted=0;S.emitted=0;S.lostSamples=0;S.cnt=0;S.arrIdx=0;
  S.hp.forEach(h=>{h.x=0;h.y=0;});S.rms=[null,null,null,null];S.pct=[null,null,null,null];S.rmsAcc.forEach(a=>{a.s=0;a.n=0;});
  S.raw.forEach(a=>a.fill(0));S.rawPos=0;BANDS.forEach(b=>{b.buf.fill(0);b.pos=0;b.scale=null;makeFilters(b);});
  ppgFullReset();
}
function handlePacket(ch,seq,vals){
  S.cnt+=vals.length;
  if(S.alignMode==="arrival"){vals.forEach(v=>S.qArr[ch].push(v));while(S.qArr.every(a=>a.length))emit(S.qArr.map(a=>a.shift()),S.arrIdx++);return;}
  if(S.seqLast[ch]==null){S.seqAbs[ch]=seq;}
  else{const d=(seq-S.seqLast[ch])&0xffff;if(d===0)return;S.seqAbs[ch]+=d;}
  S.seqLast[ch]=seq;
  const base=S.seqAbs[ch]*PKT;
  for(let i=0;i<vals.length;i++)S.maps[ch].set(base+i,vals[i]);
  if(base+vals.length-1>S.maxIdx)S.maxIdx=base+vals.length-1;
  if(S.nextIdx==null){
    if(!S.maps.every(m=>m.size>0))return;
    S.nextIdx=Math.max(...S.maps.map(m=>Math.min(...m.keys())));
  }
  for(;;){
    const i=S.nextIdx;
    if(S.maps.every(m=>m.has(i))){const v=S.maps.map(m=>{const x=m.get(i);m.delete(i);return x;});S.nextIdx++;emit(v,i);continue;}
    if(S.maxIdx-i>60){S.maps.forEach(m=>m.delete(i));S.nextIdx++;S.lostSamples++;continue;} // a packet never arrived: skip it, do not fill it in
    break;
  }
}
function emit(vals,idx){
  S.emitted++;
  const ys=[0,0,0,0];
  for(let c=0;c<4;c++){
    const h=S.hp[c],uv=vals[c],y=uv-h.x+0.995*h.y;h.x=uv;h.y=y;ys[c]=y; // only the constant offset is removed
    S.rmsAcc[c].s+=y*y;S.rmsAcc[c].n++;
    if(Math.abs(y)>300)S.artUntil=Date.now()+1200;
  }
  if(S.emitted<FS*2)return; // first 2 seconds: offset filter still settling, not shown
  for(let c=0;c<4;c++)S.raw[c][S.rawPos]=ys[c];
  S.rawPos=(S.rawPos+1)%BUF_LEN;
  let sum=0,n=0;
  for(let c=0;c<4;c++){const r=S.rms[c];if(r==null||(r>0.5&&r<400)){sum+=ys[c];n++;}}
  S.usable=n;
  const x=n?sum/n:0;
  const bv=[];
  for(const b of BANDS){
    const v=b.f2.p(b.f1.p(x));b.buf[b.pos]=v;b.pos=(b.pos+1)%BUF_LEN;
    b.energy+=v*v;b.eN++;b.e2+=v*v;b.n2++;bv.push(v);
  }
  if(S.rec){S.rec.samples++;recPush(idx,ys,bv);}
}
/* every aligned reading is kept while recording: 4 sensors, 5 band signals, sensors in use, focus */
const REC_COLS=14,REC_MAX_SEC=600;
function recPush(idx,ys,bv){
  const r=S.rec;
  if(r.n>=r.cap){if(!r.full){r.full=true;setTimeout(()=>stopRec(true,"The 10 minute limit was reached."),0);}return;}
  if(r.startIdx==null)r.startIdx=idx;
  const i=r.n++,o=i*REC_COLS;r.t[i]=(idx-r.startIdx)/FS;
  for(let c=0;c<4;c++)r.d[o+c]=ys[c];
  for(let b=0;b<5;b++)r.d[o+4+b]=bv[b];
  r.d[o+9]=S.usable;r.d[o+10]=focus.ema==null?NaN:focus.ema;const p=focusPct();r.d[o+11]=p==null?NaN:p;
  r.d[o+12]=PL.bpm==null?NaN:PL.bpm;r.d[o+13]=PL.pct==null?NaN:PL.pct; // heart rate updates once per second
}
const fmt=s=>String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");
function setSess(running){
  if(running){const s=Math.floor((Date.now()-S.rec.t0)/1000);$("sessT").textContent=fmt(s);$("sessN").textContent=S.rec.samples.toLocaleString();$("sessM").textContent="Recording. File saves when you stop";}
}
setInterval(()=>{
  SENSORS.forEach((nm,i)=>{
    const a=S.rmsAcc[i],rms=a.n?Math.sqrt(a.s/a.n):0;if(a.n)S.rms[i]=rms;a.s=0;a.n=0;
    let raw;
    if(rms<0.5)raw=0;else if(rms<3)raw=(rms-0.5)/2.5*100;else if(rms<=40)raw=100;else if(rms<200)raw=(200-rms)/160*100;else raw=0;
    S.pct[i]=S.pct[i]==null?raw:S.pct[i]+0.5*(raw-S.pct[i]);
    const el=$("sen"+i),q=el.querySelector(".q");let cls="",txt="--";
    if(S.connected&&S.emitted>0){const p=Math.round(S.pct[i]);txt=p+"%";cls=p>=70?"good":p>=40?"fair":"poor";}
    el.className="sensor "+cls;q.textContent=txt;
    $("rq"+i).textContent=txt;
    $("rr"+i).textContent=S.connected&&S.rms[i]!=null?rms.toFixed(1)+" µV":"--";
  });
  const rate=S.cnt/4;S.cnt=0;
  const tot=S.emitted+S.lostSamples,dp=tot?S.lostSamples/tot*100:0;
  $("rate").textContent=S.connected?(rate>0?"Live data":"Connected, waiting for data"):"";
  $("stRate").textContent=S.connected&&rate>0?Math.round(rate)+" Hz":"-- Hz";
  $("stDrop").textContent=(S.connected&&tot?dp.toFixed(1):"--")+"% lost";
  $("stUse").textContent=(S.connected&&S.emitted>FS*2?S.usable:"-")+"/4 in use";
  if(S.connected&&rate>0){S.stall=S.emitted===S.lastEmitted?S.stall+1:0;S.lastEmitted=S.emitted;
    if(S.stall>=3&&S.alignMode==="seq"){S.alignMode="arrival";S.maps.forEach(m=>m.clear());}}
  BANDS.forEach((b,i)=>{
    b.power=b.eN?Math.sqrt(b.energy/b.eN):0;b.energy=0;b.eN=0;
    $("rd"+i).textContent=S.connected&&S.emitted>FS*2?b.power.toFixed(1)+" µV RMS"+(b.muted?" (muted)":""):"--";
  });
  ppgAnalyse();hrUi();
  if(S.rec){
    S.rec.contactN++;for(let c=0;c<4;c++)S.rec.contactSum[c]+=S.pct[c]==null?0:S.pct[c];
    if(Date.now()<S.artUntil)S.rec.artSec++;
    setSess(true);
  }
},1000);
