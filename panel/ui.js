/* panel/ui.js
   Look and behaviour of the page: builds the stage, toasts, status lamp, buttons, view switch, and the canvas drawing (bands, raw view, pulse).
   Classic script: shares the page's global scope with the other panel/*.js files (load order is set in muse-panel.html).
   Uses: core.js, pulse.js */
"use strict";
/* ============ build UI on the stage ============ */
const mk=(tag,cls,css,html,parent)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(css)e.style.cssText=css;if(html!=null)e.innerHTML=html;(parent||$("bandlayer")).appendChild(e);return e;};
BANDS.forEach((b,i)=>{
  const [wx,wy,ww,wh]=b.wave;
  // covers hide the picture's sample waves, sliders and mute buttons
  mk("div","cov",`left:${wx-2}px;top:${wy-3}px;width:${ww+4}px;height:${wh+6}px`);
  mk("div","cov dark",`left:1010px;top:${b.L-17}px;width:254px;height:62px`);
  mk("div","cov dark",`left:1284px;top:${b.mc-34}px;width:126px;height:68px`);
  mk("canvas","wave",`left:${wx}px;top:${wy}px;width:${ww}px;height:${wh}px`).id="cv"+i;
  const rd=mk("div","rd",`left:285px;top:${b.rmsY-8}px`,"--");rd.id="rd"+i;
  const sb=mk("div","sliderbox",`left:1012px;top:${b.L-16}px;width:250px;height:58px`,
    `<div class="sn t">STRENGTH</div><div class="sv t" id="sv${i}">100%</div><input type="range" min="0" max="100" value="100" id="sl${i}" aria-label="${b.name} strength">`);
  const mu=mk("button","oct mute",`left:1290px;top:${b.mc-27}px;--bd:#6a8cff;--glow:rgba(110,150,255,.7)`,"Mute");mu.id="mu"+i;
  const sl=$("sl"+i),upd=()=>{b.gain=sl.value/100;$("sv"+i).textContent=sl.value+"%";sl.style.setProperty("--p",sl.value+"%");};
  sl.addEventListener("input",upd);upd();
  mu.addEventListener("click",()=>{b.muted=!b.muted;mu.textContent=b.muted?"Unmute":"Mute";mu.classList.toggle("on",b.muted);sb.classList.toggle("rowdim",b.muted);$("cv"+i).style.opacity=b.muted?.5:1;});
});
const sensorsEl=$("sensors");
SENSORS.forEach((n,i)=>{const d=mk("div","sensor",`left:${i*39}px`,`<div class="sl"><span class="lamp"></span>${n}</div><span class="q">--</span>`,sensorsEl);d.id="sen"+i;});
{const d=mk("div","sensor hr","left:156px",`<div class="sl"><span class="lamp"></span>HR</div><span class="q">--</span>`,sensorsEl);d.id="sen4";}
/* raw view panel: 4 brain sensors + the pulse sensor */
const rawov=$("rawov");
const RAWROWS=SENSORS.map((n,i)=>({n,sub:SENSOR_SUB[i].toUpperCase(),un:"Unfiltered signal",a:"CONTACT",b:"RMS"}));
RAWROWS.push({n:"HEART",sub:"PULSE (INFRARED)",un:"Offset removed, auto scale",a:"SIGNAL",b:"HEART RATE",hr:true});
RAWROWS.forEach((o,i)=>{
  mk("div","rawrow",`left:0;top:${6+i*79}px;width:1166px;height:76px`,
   `<div class="nm t"${o.hr?' style="color:#ff4a5e"':''}>${o.n}</div><div class="sb t"${o.hr?' style="color:#ff8c9b"':''}>${o.sub}</div><div class="un t">${o.un}</div>
    <canvas class="wave" id="rc${i}" style="left:210px;top:4px;width:700px;height:68px${o.hr?';border-color:rgba(255,70,100,.55)':''}"></canvas>
    <div class="pk t" style="left:930px;top:26px">${o.a}</div><b class="pv t" id="rq${i}" style="left:930px;top:40px">--</b><div class="pk t" style="left:1040px;top:26px">${o.b}</div><b class="pv t" id="rr${i}" style="left:1040px;top:40px${o.hr?';color:#ff3b4e;text-shadow:0 0 10px rgba(255,40,70,.8)':''}">--</b>`,rawov);
});
const FSEG=25,fbar=$("fbar");
for(let i=0;i<FSEG;i++){const s=document.createElement("span");s.style.height=(22+i*(78/(FSEG-1)))+"%";fbar.appendChild(s);}

/* fit the 16:9 stage to the window */
function fit(){const k=Math.min(innerWidth/1672,innerHeight/941);S.k=k;
  $("stage").style.transform=`translate(${(innerWidth-1672*k)/2}px,${(innerHeight-941*k)/2}px) scale(${k})`;}
fit();addEventListener("resize",fit);

function toast(msg,kind,ms){const t=$("toast");t.className=kind==="info"?"info":"";t.style.display="flex";$("toastText").textContent=msg;clearTimeout(toast.t);toast.t=setTimeout(()=>t.style.display="none",ms||6000);}
function setStatus(kind,text){$("lamp").className=kind;$("statusText").textContent=text;}
function setButtons(){
  $("btnConnect").disabled=S.connected||S.connecting;
  $("btnDisconnect").disabled=!(S.connected||S.connecting);
  $("btnStart").disabled=!S.connected||!!S.rec;
  $("btnStop").disabled=!S.rec;
}
function setView(v){S.view=v;rawov.classList.toggle("show",v==="raw");$("btnBand").classList.toggle("on",v==="bands");$("btnView").classList.toggle("on",v==="raw");}
$("btnBand").addEventListener("click",()=>setView("bands"));
$("btnView").addEventListener("click",()=>setView("raw"));
$("btnFull").addEventListener("click",()=>{try{document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();}catch(e){}});

/* ============ drawing ============ */
const FONT="'Segoe UI',Arial,sans-serif";
function prep(cv){const d=(window.devicePixelRatio||1)*S.k,w=cv.clientWidth,h=cv.clientHeight;
  const pw=Math.round(w*d),ph=Math.round(h*d);if(cv.width!==pw||cv.height!==ph){cv.width=pw;cv.height=ph;}
  const g=cv.getContext("2d");g.setTransform(d,0,0,d,0,0);g.clearRect(0,0,w,h);return {g,w,h};}
function grid(g,w,h,label){
  g.strokeStyle="rgba(110,150,255,.18)";g.lineWidth=1;g.beginPath();
  for(let k=1;k<4;k++){const x=Math.round(w*k/4)+.5;g.moveTo(x,0);g.lineTo(x,h);}
  g.moveTo(0,h/2+.5);g.lineTo(w,h/2+.5);g.stroke();
  g.fillStyle="rgba(160,180,235,.85)";g.font="9.5px "+FONT;g.textAlign="left";g.fillText("4 s",5,h-4);g.textAlign="right";g.fillText("now",w-5,h-4);
  if(label){g.textAlign="right";g.fillText(label,w-6,11);}
}
function trace(g,w,h,buf,pos,amp,color,len){
  const mid=h/2,lim=h/2-2;len=len||buf.length;
  const path=()=>{g.beginPath();let pen=false;for(let x=0;x<w;x++){const idx=(pos+Math.floor(x/w*len))%buf.length;let v=buf[idx]*amp;if(v!==v){pen=false;continue;} // a missing reading leaves a break in the line
    v=Math.max(-lim,Math.min(lim,v));pen?g.lineTo(x,mid-v):g.moveTo(x,mid-v);pen=true;}};
  g.lineJoin="round";g.strokeStyle=color;g.globalAlpha=.22;g.lineWidth=4.5;path();g.stroke();
  g.globalAlpha=1;g.lineWidth=1.4;path();g.stroke();
}
function draw(){
  BANDS.forEach((b,i)=>{
    const {g,w,h}=prep($("cv"+i));
    let pk=0;for(let k=0;k<BUF_LEN;k+=2){const a=Math.abs(b.buf[k]);if(a>pk)pk=a;}
    pk=Math.max(pk,0.5);b.scale=(b.scale==null||pk>b.scale)?pk:b.scale+0.04*(pk-b.scale); // window fits the largest value of the last 4 s
    const amp=b.muted?0:b.gain*(h/2-3)/b.scale;
    const eff=b.gain>0.01?b.scale/b.gain:null;
    grid(g,w,h,!S.connected?"":b.muted?"muted":(eff?"±"+(eff<10?eff.toFixed(1):Math.round(eff))+" µV full height":"off"));
    if(S.connected)trace(g,w,h,b.buf,b.pos,amp,b.muted?"#7f8fc0":b.color);
    if(S.connected&&S.usable===0){g.fillStyle="#ff9db0";g.font="13px "+FONT;g.textAlign="center";g.fillText("No sensor contact",w/2,h/2-6);}
  });
  if(S.view==="raw"){
    SENSORS.forEach((n,i)=>{
      const {g,w,h}=prep($("rc"+i));
      grid(g,w,h,"±"+RAW_SCALE+" µV fixed scale");
      g.strokeStyle="rgba(110,150,255,.12)";g.beginPath();const y1=h/2-(h/2-2)*100/RAW_SCALE,y2=h/2+(h/2-2)*100/RAW_SCALE;g.moveTo(0,y1);g.lineTo(w,y1);g.moveTo(0,y2);g.lineTo(w,y2);g.stroke();
      if(S.connected)trace(g,w,h,S.raw[i],S.rawPos,(h/2-2)/RAW_SCALE,"#7fe0ff");
    });
  }
  {const {g,w,h}=prep($("hrCv"));
    g.strokeStyle="rgba(255,90,110,.2)";g.beginPath();g.moveTo(0,h/2+.5);g.lineTo(w,h/2+.5);g.stroke();
    if(S.connected&&PL.filled>0)pulseDraw(g,w,h,PL.bp,(PL.bpPos-PPG_FS*4+PL.bp.length)%PL.bp.length,PPG_FS*4,"scaleBp");}
  if(S.view==="raw"){const {g,w,h}=prep($("rc4"));grid(g,w,h,"auto scale");
    if(S.connected&&PL.filled>0)pulseDraw(g,w,h,PL.raw,PL.rawPos,PL.raw.length,"scaleRaw");}
  requestAnimationFrame(draw);
}
function pulseDraw(g,w,h,buf,start,len,key){ // pulse windows fit the largest value of the last 4 s
  let pk=0;for(let k=0;k<len;k+=2){const a=Math.abs(buf[(start+k)%buf.length]);if(a>pk)pk=a;}
  pk=Math.max(pk,1e-6);const cur=PL[key];PL[key]=(cur==null||pk>cur)?pk:cur+0.04*(pk-cur);
  trace(g,w,h,buf,start,(h/2-3)/PL[key],"#ff2a3d",len);
}
requestAnimationFrame(draw);
