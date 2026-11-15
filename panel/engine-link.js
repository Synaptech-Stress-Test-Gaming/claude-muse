/* panel/engine-link.js
   Glue between the device adapters, the new engine (engine/*.js) and the panel: connect dispatch (Muse / Cyton), frames -> engine,
   window.EngineOut for the UI, game link and recorder. Loaded after panel/stress-link.js and the engine scripts.
   Classic script: top-level names start with eng / Eng (checked against the rest of the repo). */
"use strict";
const engState = { muse: null, cy: null, eng: null, engKey: null, out: null, lastFrameWall: 0, cfg: null, selfcheck: null, stats: null, helper: { state: "idle", text: "", fix: null },
  frames: 0, errors: [], hops: 0, eventsSeen: {}, userConnect: false };
window.EngineOut = null;
const engM = () => window.MuseEngine;

/* ---------- device choice (only while disconnected) ---------- */
function engSetDevice(d) {
  if (d !== "muse" && d !== "cyton") return false;
  if (S.connected || S.connecting) { toast("Disconnect first, then switch the device.", "info", 4000); return false; }
  S.dev = d; try { localStorage.setItem("muse2panel.device", d); } catch (e) {}
  engState.eng = null; engState.engKey = null; engState.out = null; window.EngineOut = null;
  if (typeof engUiDevice === "function") engUiDevice();
  setStatus("search", d === "cyton" ? "Press Connect" : "Press Connect once");
  return true;
}

/* ---------- connect / disconnect ---------- */
function engConnect(userClicked) {
  if (S.dev !== "cyton") return connectMuse(userClicked);
  if (S.connected || S.connecting) return;
  S.connecting = true; S.userDisconnected = false; setButtons(); setStatus("search", "Connecting");
  resetStream();
  const M = engM(), useSim = DEMO && params.get("helper") !== "1";
  const common = { onFrame: engOnFrame, onMessage: engOnHelperMsg, onStatus: engOnHelperStatus };
  engState.cy = useSim ? M.Adapters.CytonSim.create(Object.assign({ fs: +(params.get("simfs") || 125), script: params.get("script") || "default" }, common))
    : M.Adapters.Cyton.create(Object.assign({ url: "ws://127.0.0.1:" + (params.get("wsport") || 8766) }, common));
  engState.cy.start();
}
function engDisconnect() {
  if (S.dev !== "cyton") { engEndSession(); return disconnectMuse(); }
  S.userDisconnected = true;
  if (engState.cy) engState.cy.stop(); engState.cy = null;
  engEndSession();
  S.connected = false; S.connecting = false; setButtons(); setStatus("bad", "Disconnected"); if (S.rec) stopRec(true);
  if (typeof engRecStop === "function" && engRecActive()) engRecStop(true);
}
function engOnHelperStatus(s) {
  engState.helper = s;
  if (S.dev !== "cyton") return;
  if (s.state === "streaming") { if (!S.connected) { S.connected = true; S.connecting = false; S.everConnected = true; setButtons(); } setStatus("on", DEMO && params.get("helper") !== "1" ? "Simulated Cyton" : "Cyton live"); }
  else if (s.state === "lost") { S.connected = false; S.connecting = true; setButtons(); setStatus("search", "Lost signal, retrying"); }
  else if (s.state === "down") { S.connected = false; S.connecting = true; setButtons(); setStatus("search", "Waiting for the helper"); }
  else if (s.state === "connecting" && !S.connected) setStatus("search", "Connecting");
}
function engOnHelperMsg(m) {
  if (m.type === "config") engState.cfg = m;
  else if (m.type === "selfcheck") engState.selfcheck = m;
  else if (m.type === "stats") engState.stats = m;
  if (typeof engUiHelperMsg === "function") engUiHelperMsg(m);
}

/* ---------- Muse taps (one line each in dsp.js, pulse.js, motion.js) ---------- */
function engMuseAdapter() {
  if (!engState.muse) engState.muse = engM().Adapters.Muse.create({ onFrame: engOnFrame, getContact: () => S.pct, getPL: () => PL });
  return engState.muse;
}
function engTapEeg(ys, idx) { if (S.dev === "muse") engMuseAdapter().eeg(ys, idx); }
function engTapPpg() { if (S.dev === "muse") engMuseAdapter().ppg(); }
function engTapMotion(kind, v, now) { if (S.dev === "muse") engMuseAdapter().motion(kind, v, now); }
function engTapReset() { if (engState.muse) engState.muse.reset(); }

/* ---------- frames -> engine ---------- */
function engEnsureEngine(f) {
  const key = f.device + "|" + f.streamId + "|" + f.fs + "|" + f.channels.join(",");
  if (engState.eng && engState.engKey === key) return engState.eng;
  if (engState.eng) engEndSession();
  const M = engM(), cfg = engState.cfg;
  engState.eng = M.create({ device: f.device, fs: f.fs, channels: f.channels, ecgChannel: f.device === "cyton" && cfg ? cfg.ecgChannel : -1,
    unusedChannels: f.device === "cyton" && cfg ? cfg.unusedChannels : [], mains: cfg && cfg.mains || 60,
    flags: { asr: f.device === "cyton", nlms: false }, priors: M.PRIORS, tuned: M.TUNED || null, store: window.engStore || null,
    legacyProvider: f.device === "muse" ? () => ({ focus: S.connected ? pctOf(focus) : null, stress: window.StressMeter ? StressMeter.value() : null }) : null,
    motionTh: f.device === "muse" && MOT.th && MOT.th.calibrated ? MOT.th : null });
  engState.eng.onEvent = engOnButton;
  engState.engKey = key;
  return engState.eng;
}
function engOnFrame(f) {
  try {
    const eng = engEnsureEngine(f);
    engState.lastFrameWall = Date.now(); engState.frames++;
    if (typeof engDisplayFrame === "function") engDisplayFrame(f);
    if (typeof engRecFrame === "function") engRecFrame(f);
    const outs = eng.push(f);
    for (const o of outs) engOnOutput(o);
  } catch (e) { engState.errors.push(String(e && e.message || e)); if (engState.errors.length < 4) console.error(e); }
}
function engOnOutput(o) {
  engState.out = o; window.EngineOut = o; engState.hops++;
  (o.events || []).forEach(e => { engState.eventsSeen[e.type] = (engState.eventsSeen[e.type] || 0) + 1; });
  if (typeof engRecHop === "function") engRecHop(o);
}
function engOnButton(ev) { engState.eventsSeen[ev.type] = (engState.eventsSeen[ev.type] || 0) + 1; if (typeof engUiButton === "function") engUiButton(ev); if (typeof engGameEvent === "function") engGameEvent(ev); }
function engEndSession() { try { if (engState.eng) engState.eng.endSession(); } catch (e) { engState.errors.push(String(e.message || e)); } }
addEventListener("beforeunload", engEndSession);

/* no data for 500 ms: advance hold/fade ("signal lost") */
setInterval(() => {
  if (!engState.eng || !engState.lastFrameWall) return;
  const dt = Date.now() - engState.lastFrameWall;
  if (dt > 500) { const o = engState.eng.idle(0.25); if (o) engOnOutput(o); }
}, 250);
