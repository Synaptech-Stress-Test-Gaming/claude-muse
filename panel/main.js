/* panel/main.js
   Wiring and start-up. Must load last.
   Classic script: shares the page's global scope with the other panel/*.js files (load order is set in muse-panel.html).
   Uses: all other panel/*.js */
"use strict";
/* ============ wiring ============ */
$("btnConnect").addEventListener("click",()=>connectMuse(true));
$("btnDisconnect").addEventListener("click",disconnectMuse);
$("btnStart").addEventListener("click",startRec);
$("btnStop").addEventListener("click",()=>stopRec(false));
if(params.get("view")==="raw")setView("raw");
setButtons();setStatus("search","Searching");renderFocus();
connectMuse(false);
addEventListener("beforeunload",()=>{try{if(S.device&&S.device.gatt.connected)S.device.gatt.disconnect();}catch(e){}});
