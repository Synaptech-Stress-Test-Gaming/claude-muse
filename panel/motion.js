/* panel/motion.js
   Head movement from the Muse accelerometer (about 52 readings per second, 3 per packet, in g).
   motionLevel() gives the recent movement in milli-g (gravity removed), or null when no accelerometer data is arriving.
   Used by the arousal meter; also handy for a head-movement filter.
   Classic script: shares the page's global scope with the other panel/*.js files. Uses: nothing. */
"use strict";
const MO={packets:0,lastAt:0,g:null,acc:0,n:0,rms:null};
function motionReset(){MO.packets=0;MO.lastAt=0;MO.g=null;MO.acc=0;MO.n=0;MO.rms=null;}
function decodeAccel(dv){ // 2-byte packet counter, then 3 readings of x,y,z (16-bit signed, 1/16384 g)
  const out=[];for(let i=0;i<3;i++){const b=2+i*6;out.push([dv.getInt16(b)/16384,dv.getInt16(b+2)/16384,dv.getInt16(b+4)/16384]);}
  return out;
}
function onAccel(seq,samples){
  MO.lastAt=Date.now();MO.packets++;
  for(const s of samples){
    if(!MO.g){MO.g=s.slice();continue;}
    let m=0;for(let k=0;k<3;k++){MO.g[k]+=(s[k]-MO.g[k])*0.05;const d=s[k]-MO.g[k];m+=d*d;} // slow average = gravity; what is left is movement
    MO.acc+=m;MO.n++;
  }
}
function motionLevel(){
  if(!MO.packets||Date.now()-MO.lastAt>3000)return null;
  if(MO.n){const r=Math.sqrt(MO.acc/MO.n)*1000;MO.acc=0;MO.n=0;MO.rms=MO.rms==null?r:MO.rms+0.5*(r-MO.rms);}
  return MO.rms;
}
