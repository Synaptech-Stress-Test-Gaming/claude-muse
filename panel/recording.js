/* panel/recording.js
   Recording: start/stop, session report, CSV and summary downloads.
   Classic script: shares the page's global scope with the other panel/*.js files (load order is set in muse-panel.html).
   Uses: core.js, dsp.js, focus.js */
"use strict";
/* ============ recording: full breakdown + file download ============ */
function startRec(){
  if(!S.connected||S.rec)return;
  $("report").classList.remove("show");
  S.rec={t0:Date.now(),startDate:new Date(),samples:0,n:0,cap:FS*REC_MAX_SEC,t:new Float64Array(FS*REC_MAX_SEC),d:new Float32Array(FS*REC_MAX_SEC*REC_COLS),
    startIdx:null,contactSum:[0,0,0,0],contactN:0,artSec:0,lost0:S.lostSamples,pLost0:PL.lost,fLo:focus.lo,fHi:focus.hi,full:false};
  setButtons();$("btnStart").classList.add("on");setSess(true);
}
const COLNAMES=["TP9_uV","AF7_uV","AF8_uV","TP10_uV","delta_uV","theta_uV","alpha_uV","beta_uV","gamma_uV","sensors_in_use","focus_index_ln_beta_over_alpha","focus_0_to_100","heart_rate_bpm","heart_signal_pct","arousal_0_to_100"];
function pad2(n){return String(n).padStart(2,"0");}
function stamp(d){return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate())+"_"+pad2(d.getHours())+"-"+pad2(d.getMinutes())+"-"+pad2(d.getSeconds());}
function colStats(r,c){let cnt=0,sum=0,sq=0,mn=Infinity,mx=-Infinity;
  for(let i=0;i<r.n;i++){const v=r.d[i*REC_COLS+c];if(v!==v)continue;cnt++;sum+=v;sq+=v*v;if(v<mn)mn=v;if(v>mx)mx=v;}
  return {cnt,mean:cnt?sum/cnt:NaN,rms:cnt?Math.sqrt(sq/cnt):NaN,min:mn,max:mx};}
function buildReport(r){
  const dur=r.n?r.t[r.n-1]:0,dropped=S.lostSamples-r.lost0,total=r.n+dropped;
  const rep={r,name:"Muse2_recording_"+stamp(r.startDate),started:r.startDate.toLocaleString(),dur,n:r.n,dropped,dropPct:total?dropped/total*100:0,
    rate:dur>0?(r.n-1)/dur:0,art:r.artSec,
    sensors:SENSORS.map((n,i)=>{const st=colStats(r,i);return {n,sub:SENSOR_SUB[i],contact:r.contactN?r.contactSum[i]/r.contactN:0,rms:st.rms,min:st.min,max:st.max,pp:st.max-st.min};}),
    bands:BANDS.map((b,i)=>{const st=colStats(r,4+i);return {n:b.name,range:b.range,rms:st.rms,max:Math.max(Math.abs(st.min),Math.abs(st.max))};}),
    use:colStats(r,9),fidx:colStats(r,10),fpct:colStats(r,11),hr:colStats(r,12),hrq:colStats(r,13),hrLost:PL.lost-r.pLost0};
  rep.hrValid=r.n?rep.hr.cnt/r.n*100:0;
  const tot=rep.bands.reduce((a,b)=>a+(b.rms||0)**2,0);rep.bands.forEach(b=>b.share=tot?(b.rms||0)**2/tot*100:0);
  let a50=0,a75=0,nv=0;for(let i=0;i<r.n;i++){const v=r.d[i*REC_COLS+11];if(v!==v)continue;nv++;if(v>=50)a50++;if(v>=75)a75++;}
  rep.f50=nv?a50/nv*100:NaN;rep.f75=nv?a75/nv*100:NaN;
  rep.lo=focus.lo;rep.hi=focus.hi;rep.baseChanged=(r.fLo!==focus.lo||r.fHi!==focus.hi);
  return rep;
}
const f1=(v,d=1)=>(v==null||v!==v||!isFinite(v))?"n/a":v.toFixed(d);
function reportText(R){
  const L=[];L.push("MUSE 2 RECORDING SUMMARY");L.push("Started: "+R.started);L.push("Length: "+f1(R.dur,2)+" s");
  L.push("Readings kept per sensor: "+R.n+" (measured rate "+f1(R.rate,1)+" per second, headband rate 256)");
  L.push("Dropped readings: "+R.dropped+" ("+f1(R.dropPct,2)+"%). Gaps are left as gaps in the time column, nothing is filled in.");
  L.push("Seconds with a big noise burst (blink or jaw clench): "+R.art);L.push("");
  L.push("SENSORS (offset removed, no other processing)");
  R.sensors.forEach(s=>L.push(s.n+" ("+s.sub+"): contact "+f1(s.contact,0)+"%, RMS "+f1(s.rms)+" uV, min "+f1(s.min)+" uV, max "+f1(s.max)+" uV, peak to peak "+f1(s.pp)+" uV"));
  L.push("Sensors in use on average: "+f1(R.use.mean,2)+" of 4");L.push("");
  L.push("WAVE TYPES (band filtered, average of the sensors in use)");
  R.bands.forEach(b=>L.push(b.n+" "+b.range[0]+"-"+b.range[1]+" Hz: RMS "+f1(b.rms)+" uV, largest swing "+f1(b.max)+" uV, share of band power "+f1(b.share,1)+"%"));L.push("");
  L.push("FOCUS  (index = ln(beta/alpha) smoothed 3 s; 0 to 100 uses your baselines)");
  if(R.lo!=null&&R.hi!=null){L.push("Baselines: low "+f1(R.lo,2)+", high "+f1(R.hi,2)+(R.baseChanged?" (changed during this recording)":""));
    L.push("Focus 0-100: min "+f1(R.fpct.min,0)+", average "+f1(R.fpct.mean,0)+", max "+f1(R.fpct.max,0));
    L.push("Time at 50 or above: "+f1(R.f50,0)+"%. Time at 75 or above: "+f1(R.f75,0)+"%.");}
  else L.push("No baselines were set, so only the raw focus index is in the data file. Index: min "+f1(R.fidx.min,2)+", average "+f1(R.fidx.mean,2)+", max "+f1(R.fidx.max,2));
  L.push("");L.push("HEART RATE  (forehead pulse sensor, 64 readings per second, updated once per second from the last 8 seconds)");
  if(R.hr.cnt)L.push("Average "+f1(R.hr.mean,0)+" bpm, lowest "+f1(R.hr.min,0)+", highest "+f1(R.hr.max,0)+". A rate is shown only when the pulse repeats clearly; "+f1(R.hrValid,0)+"% of the recording has one. Average pulse signal "+f1(R.hrq.mean,0)+"%. Lost pulse packets: "+R.hrLost+".");
  else L.push("No clear heart rate was read during this recording. Lost pulse packets: "+R.hrLost+".");
  L.push("");L.push("DATA FILE COLUMNS");L.push("time_s plus: "+COLNAMES.join(", "));
  return L.join("\r\n");
}
function csvOf(r){
  const rows=["time_s,"+COLNAMES.join(",")];
  for(let i=0;i<r.n;i++){const o=i*REC_COLS;let line=r.t[i].toFixed(4);
    for(let c=0;c<REC_COLS;c++){const v=r.d[o+c];line+=","+(v!==v?"":(c===9?String(v):c===12?v.toFixed(1):c===13?v.toFixed(0):c===14?v.toFixed(1):v.toFixed(3)));}
    rows.push(line);}
  return rows.join("\r\n");
}
function download(name,text,type){
  const blob=new Blob(["﻿"+text],{type:type+";charset=utf-8"}),a=document.createElement("a");
  a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},4000);
}
let LASTREP=null;
function showReport(R,saved,why){
  LASTREP=R;const rr=$("report");
  const lines=(a)=>a.map(x=>`<div class="ln"><span>${x[0]}</span><b>${x[1]}</b></div>`).join("");
  rr.innerHTML=`
   <div class="rh"><h2>SESSION REPORT</h2><div class="rs">${R.started}${why?" | "+why:""}</div></div>
   <div class="cols">
    <div class="box"><h3>RECORDING</h3>${lines([["Length",f1(R.dur,1)+" s"],["Readings per sensor",R.n.toLocaleString()],["Measured rate",f1(R.rate,0)+" per s"],["Dropped",R.dropped+" ("+f1(R.dropPct,1)+"%)"],["Noise-burst seconds",R.art],["Sensors in use (avg)",f1(R.use.mean,1)+" of 4"]])}
      <h3 style="margin-top:14px">FOCUS</h3>${R.lo!=null&&R.hi!=null?lines([["Baseline low / high",f1(R.lo,2)+" / "+f1(R.hi,2)],["Lowest",f1(R.fpct.min,0)],["Average",f1(R.fpct.mean,0)],["Highest",f1(R.fpct.max,0)],["Time at 50+",f1(R.f50,0)+"%"],["Time at 75+",f1(R.f75,0)+"%"]]):lines([["Baselines","not set"],["Raw index avg",f1(R.fidx.mean,2)],["Raw index range",f1(R.fidx.min,2)+" to "+f1(R.fidx.max,2)]])}</div>
    <div class="box"><h3>SENSORS (offset removed only)</h3>
      <table><tr><th>SENSOR</th><th>CONTACT</th><th>RMS &micro;V</th><th>MIN</th><th>MAX</th><th>P-P</th></tr>
      ${R.sensors.map(s=>`<tr><td>${s.n}</td><td>${f1(s.contact,0)}%</td><td>${f1(s.rms)}</td><td>${f1(s.min)}</td><td>${f1(s.max)}</td><td>${f1(s.pp)}</td></tr>`).join("")}</table>
      <h3 style="margin:14px 0 8px;color:#ff7088">HEART RATE (pulse sensor)</h3>${R.hr.cnt?lines([["Average",f1(R.hr.mean,0)+" bpm"],["Lowest / highest",f1(R.hr.min,0)+" / "+f1(R.hr.max,0)+" bpm"],["Time with a clear rate",f1(R.hrValid,0)+"%"],["Pulse signal (avg)",f1(R.hrq.mean,0)+"%"],["Lost pulse packets",R.hrLost]]):lines([["Heart rate","none read"],["Lost pulse packets",R.hrLost]])}</div>
    <div class="box"><h3>WAVE TYPES</h3>
      <table><tr><th>BAND</th><th>HZ</th><th>RMS &micro;V</th><th>PEAK</th><th>SHARE</th></tr>
      ${R.bands.map(b=>`<tr><td>${b.n}</td><td>${b.range[0]}-${b.range[1]}</td><td>${f1(b.rms)}</td><td>${f1(b.max)}</td><td>${f1(b.share,0)}%</td></tr>`).join("")}</table></div>
   </div>
   <div class="btns"><button class="oct" id="rpCsv">Download data (CSV)</button><button class="oct" id="rpTxt">Download summary (TXT)</button><button class="oct" id="rpClose">Close</button></div>
   <div class="note">${saved?"Saved to your Downloads folder as "+R.name+".csv. ":""}Every reading is in the CSV. Gaps from dropped readings stay as gaps in the time column.</div>`;
  rr.classList.add("show");
  $("rpCsv").onclick=()=>download(R.name+".csv",csvOf(R.r),"text/csv");
  $("rpTxt").onclick=()=>download(R.name+"_summary.txt",reportText(R),"text/plain");
  $("rpClose").onclick=()=>rr.classList.remove("show");
}
function stopRec(auto,why){
  if(!S.rec)return;const r=S.rec;S.rec=null;
  $("btnStart").classList.remove("on");setButtons();
  if(r.n<FS){$("sessT").textContent=fmt(Math.round((Date.now()-r.t0)/1000));$("sessN").textContent=String(r.n);$("sessM").textContent="Too short to save (under 1 second)";
    toast("That recording was under 1 second, so nothing was saved.","info",5000);return;}
  const R=buildReport(r);
  $("sessT").textContent=fmt(Math.round(R.dur));$("sessN").textContent=R.n.toLocaleString();
  let saved=false;
  try{download(R.name+".csv",csvOf(r),"text/csv");saved=true;}catch(e){console.error(e);}
  $("sessM").textContent=saved?"Saved to Downloads":"Press Download in the report";
  showReport(R,saved,auto?(why||"Ended: signal lost"):"");
}
