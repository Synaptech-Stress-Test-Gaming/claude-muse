/* panel/core.js
   Constants, shared state (S), URL options (?demo=1), band filters (biquads). Every other panel file reads these.
   Classic script: shares the page's global scope with the other panel/*.js files (load order is set in muse-panel.html).
   Uses: (nothing: loaded first) */
"use strict";
/* ============ constants ============ */
const FS = 256, PKT = 12;
const SVC = "0000fe8d-0000-1000-8000-00805f9b34fb";
const U = n => "273e" + n + "-4c4d-454d-96be-f03bac821358";
const CTRL = U("0001"), TELE = U("000b");
const EEG = [U("0003"), U("0004"), U("0005"), U("0006")];
const PPG_IR = U("0010"); // pulse sensor, infrared channel (muse-js: 000f ambient, 0010 infrared, 0011 red)
const PPG_FS = 64, PPG_PKT = 6;
const SENSORS = ["TP9","AF7","AF8","TP10"];
const SENSOR_SUB = ["Left ear","Left forehead","Right forehead","Right ear"];
// stage geometry follows the reference picture (1672 x 941)
const BANDS = [
  {key:"delta", name:"Delta", range:[1,4],   color:"#58b4ff", wave:[484,252,510,70], rmsY:312, L:304, mc:325},
  {key:"theta", name:"Theta", range:[4,8],   color:"#d06bff", wave:[484,336,510,69], rmsY:394, L:369, mc:398},
  {key:"alpha", name:"Alpha", range:[8,13],  color:"#35e6ff", wave:[484,421,510,66], rmsY:479, L:443, mc:473},
  {key:"beta",  name:"Beta",  range:[13,30], color:"#a58bff", wave:[484,505,510,65], rmsY:562, L:518, mc:546},
  {key:"gamma", name:"Gamma", range:[30,44], color:"#ff55e6", wave:[484,585,510,62], rmsY:643, L:592, mc:619}
];
const BUF_LEN = FS*4;
const RAW_SCALE = 200;
const params = new URLSearchParams(location.search);
const DEMO = params.get("demo") === "1", DROP = params.get("drop") === "1";
const $ = id => document.getElementById(id);

/* ============ state ============ */
const S = {
  device:null, connected:false, connecting:false, userDisconnected:false, fails:0, everConnected:false,
  maps:[new Map(),new Map(),new Map(),new Map()], seqLast:[null,null,null,null], seqAbs:[0,0,0,0],
  nextIdx:null, maxIdx:-1, alignMode:"seq", qArr:[[],[],[],[]], stall:0, lastEmitted:0,
  emitted:0, lostSamples:0, cnt:0, arrIdx:0,
  hp:[{x:0,y:0},{x:0,y:0},{x:0,y:0},{x:0,y:0}], rms:[null,null,null,null], rmsAcc:[{s:0,n:0},{s:0,n:0},{s:0,n:0},{s:0,n:0}],
  pct:[null,null,null,null], usable:4, artUntil:0,
  raw:[0,1,2,3].map(()=>new Float32Array(BUF_LEN)), rawPos:0,
  rec:null, view:"bands", pip:null, k:1
};
function biquad(f0,Q){return biquadFs(f0,Q,FS);}
function biquadFs(f0,Q,fs){
  const w=2*Math.PI*f0/fs, a=Math.sin(w)/(2*Q), c=Math.cos(w), a0=1+a;
  return {b0:a/a0,b2:-a/a0,a1:-2*c/a0,a2:(1-a)/a0,x1:0,x2:0,y1:0,y2:0,
    p(x){const y=this.b0*x+this.b2*this.x2-this.a1*this.y1-this.a2*this.y2;this.x2=this.x1;this.x1=x;this.y2=this.y1;this.y1=y;return y;}};
}
function makeFilters(b){const f0=Math.sqrt(b.range[0]*b.range[1]),Q=f0/(b.range[1]-b.range[0]);b.f1=biquad(f0,Q);b.f2=biquad(f0,Q);}
BANDS.forEach(b=>{b.buf=new Float32Array(BUF_LEN);b.pos=0;b.gain=1;b.muted=false;b.scale=null;b.energy=0;b.eN=0;b.power=0;b.e2=0;b.n2=0;makeFilters(b);});
