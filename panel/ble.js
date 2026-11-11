/* panel/ble.js
   Getting data in: Muse 2 Bluetooth (Web Bluetooth) connect/retry/disconnect, battery, and the simulated headband used by ?demo=1.
   Classic script: shares the page's global scope with the other panel/*.js files (load order is set in muse-panel.html).
   Uses: core.js, dsp.js, ui.js */
"use strict";
/* ============ Muse protocol ============ */
const enc=cmd=>{const b=new TextEncoder().encode("X"+cmd+"\n");b[0]=b.length-1;return b;};
function decodeEEG(dv){
  const out=[];
  for(let i=0;i<6;i++){const b=2+i*3,a=dv.getUint8(b),m=dv.getUint8(b+1),c=dv.getUint8(b+2);
    out.push((a<<4)|(m>>4),((m&15)<<8)|c);}
  return out.map(v=>(v-2048)*0.48828125); // microvolts, straight from the headband's 12-bit values
}
function decodePPG(dv){ // 6 readings of 24 bits each, after the 2-byte packet counter
  const out=[];for(let i=0;i<PPG_PKT;i++){const b=2+i*3;out.push((dv.getUint8(b)<<16)|(dv.getUint8(b+1)<<8)|dv.getUint8(b+2));}
  return out;
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function linkOnce(dev){
  const server=await dev.gatt.connect();
  const svc=await server.getPrimaryService(SVC);
  const ctrl=await svc.getCharacteristic(CTRL);await ctrl.startNotifications();
  for(let i=0;i<4;i++){const c=await svc.getCharacteristic(EEG[i]);
    c.addEventListener("characteristicvaluechanged",e=>{const dv=e.target.value;handlePacket(i,dv.getUint16(0),decodeEEG(dv));});
    await c.startNotifications();}
  try{const t=await svc.getCharacteristic(TELE);t.addEventListener("characteristicvaluechanged",e=>{const dv=e.target.value;if(dv.byteLength>=4)setBattery(dv.getUint16(2)/512);});await t.startNotifications();}catch(e){}
  try{const ac=await svc.getCharacteristic(U("000a")); // accelerometer (head movement); optional
    ac.addEventListener("characteristicvaluechanged",e=>{const dv=e.target.value;if(dv.byteLength>=20)onAccel(dv.getUint16(0),decodeAccel(dv));});
    await ac.startNotifications();}catch(e){console.warn("accelerometer not available",e);}
  S.ctrl=ctrl;
  if(!PL.fallback){try{const p=await svc.getCharacteristic(PPG_IR);
    p.addEventListener("characteristicvaluechanged",e=>{const dv=e.target.value;if(dv.byteLength>=2+PPG_PKT*3)onPpg(dv.getUint16(0),decodePPG(dv));});
    await p.startNotifications();}catch(e){console.warn("pulse sensor not available",e);}}
  await ctrl.writeValueWithoutResponse(enc("h"));await ctrl.writeValueWithoutResponse(enc(PL.fallback?"p21":"p50"));
  await ctrl.writeValueWithoutResponse(enc("s"));await ctrl.writeValueWithoutResponse(enc("d"));
}
const IS_MAC=/Mac/i.test(navigator.platform||navigator.userAgent||"");
const HELP="Could not link with your Muse 2. Try this: 1) Close the Muse app on any phone or tablet. 2) "+(IS_MAC?"On this Mac, open System Settings: under Privacy & Security > Bluetooth allow your browser, and under Bluetooth remove 'Muse' if it is listed.":"In Windows Settings, Bluetooth & devices, remove 'Muse' if it is listed.")+" 3) Turn the headband off, then on again. 4) Press Connect.";
async function connectMuse(userClicked){
  if(S.connecting||S.connected)return;
  S.connecting=true;S.userDisconnected=false;setButtons();
  try{
    if(DEMO)return startDemo();
    if(!navigator.bluetooth)throw Object.assign(new Error("Bluetooth is not available in this window. Use the Open Muse Panel launcher."),{name:"NoBT"});
    setStatus("search","Searching");
    let dev=S.device;
    if(!dev){try{const known=navigator.bluetooth.getDevices?await navigator.bluetooth.getDevices():[];dev=known.find(d=>/muse/i.test(d.name||""));}catch(e){}}
    if(!dev){
      if(!userClicked){S.connecting=false;setButtons();setStatus("search","Press Connect once");return;}
      dev=await navigator.bluetooth.requestDevice({filters:[{namePrefix:"Muse"}],optionalServices:[SVC]});
    }
    S.device=dev;dev.removeEventListener("gattserverdisconnected",onDrop);dev.addEventListener("gattserverdisconnected",onDrop);
    setStatus("search","Connecting");
    let lastErr=null;
    for(let a=1;a<=3;a++){
      try{resetStream();motionReset();await linkOnce(dev);lastErr=null;break;}
      catch(e){lastErr=e;try{dev.gatt.disconnect();}catch(_){}await sleep(1200*a);}
    }
    if(lastErr)throw lastErr;
    S.fails=0;S.everConnected=true;S.connected=true;S.connecting=false;setStatus("on","Connected");setButtons();
    // safety net: if no brain data arrives with the pulse mode on, fall back to brain-only mode
    setTimeout(()=>{if(S.connected&&!DEMO&&S.emitted===0&&S.ctrl&&!PL.fallback){PL.fallback=true;const c=S.ctrl,w=m=>c.writeValueWithoutResponse(enc(m));
      w("h").then(()=>w("p21")).then(()=>w("s")).then(()=>w("d")).catch(()=>{});toast("Switched to brain-signals-only mode (no pulse).","info",6000);}},6000);
  }catch(err){
    S.connecting=false;S.connected=false;setButtons();console.error(err);
    if(err&&err.name==="NotFoundError"){setStatus("search","Press Connect");return;}
    S.fails++;setStatus("bad","Not connected");
    toast(err&&err.name==="NoBT"?err.message:HELP,"error",14000);
    if(S.fails<3&&S.everConnected)scheduleRetry();
  }
}
function onDrop(){
  S.connected=false;S.connecting=false;setButtons();setBattery(null);if(S.rec)stopRec(true);
  if(S.userDisconnected){setStatus("bad","Disconnected");return;}
  setStatus("search","Lost signal, retrying");scheduleRetry();
}
let retryT=null;
function scheduleRetry(){clearTimeout(retryT);if(S.userDisconnected)return;retryT=setTimeout(()=>connectMuse(false),2500);}
function disconnectMuse(){
  S.userDisconnected=true;clearTimeout(retryT);
  if(DEMO){stopDemo();return;}
  try{if(S.device&&S.device.gatt.connected)S.device.gatt.disconnect();}catch(e){}
  S.connected=false;S.connecting=false;setButtons();setStatus("bad","Disconnected");setBattery(null);if(S.rec)stopRec(true);
}
function setBattery(p){
  if(p==null){$("batFill").style.width="0";$("batText").textContent="--";return;}
  p=Math.max(0,Math.min(100,p));$("batFill").style.width=p+"%";$("batText").textContent=Math.round(p)+"%";
}

/* ============ simulated headband (testing only: add ?demo=1 to the address) ============ */
let demoT=null,demoN=0,demoP=0;window.demoAlpha=28;window.demoBeta=14;window.demoHr=72;window.demoGamma=6;window.demoMotion=3;
function startDemo(){
  resetStream();motionReset();S.connected=true;S.connecting=false;setStatus("on","Simulated data");setBattery(87);setButtons();
  demoT=setInterval(()=>{
    const n=demoN++;
    for(let c=0;c<4;c++){
      if(DROP&&c===2&&Math.random()<0.08)continue;
      const arr=[];
      for(let k=0;k<PKT;k++){const t=(n*PKT+k)/FS;
        arr.push(40*Math.sin(2*Math.PI*2.1*t+c)*(1+.4*Math.sin(t*.7))+22*Math.sin(2*Math.PI*6*t+c)+window.demoAlpha*Math.sin(2*Math.PI*10*t)+window.demoBeta*Math.sin(2*Math.PI*21*t+c*2)+window.demoGamma*Math.sin(2*Math.PI*38*t+c)+(Math.random()-.5)*(c===3?260:6));}
      handlePacket(c,n&0xffff,arr);
    }
    if(n%2===0&&!(DROP&&Math.random()<0.05)){ // simulated pulse sensor: one 6-reading packet every ~94 ms
      const arr=[],f=window.demoHr/60;
      for(let k=0;k<PPG_PKT;k++){const t=(demoP*PPG_PKT+k)/PPG_FS;
        arr.push(Math.round(60000+700*Math.sin(2*Math.PI*0.25*t)+900*(Math.sin(2*Math.PI*f*t)+0.35*Math.sin(4*Math.PI*f*t+1))+(Math.random()-.5)*80));}
      onPpg(demoP&0xffff,arr);
    }
    if(n%2===0)demoP++;
    if(n%5!==4){ // simulated accelerometer: gravity plus movement of about demoMotion milli-g
      const a=window.demoMotion/1000,sm=[];for(let k=0;k<3;k++)sm.push([(Math.random()*2-1)*a,(Math.random()*2-1)*a,1+(Math.random()*2-1)*a]);
      onAccel(n&0xffff,sm);}
  },47);
}
function stopDemo(){clearInterval(demoT);S.connected=false;setButtons();setStatus("bad","Disconnected");setBattery(null);if(S.rec)stopRec(true);}
