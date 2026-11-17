/* panel/engine-link.js
   Glue between the device adapters, the new engine (engine/*.js) and the panel: connect dispatch (Muse / Cyton), frames -> engine,
   window.EngineOut for the UI, game link and recorder, the Cyton display (bands, raw view, ECG row) and Legacy focus on the Cyton.
   Loaded after panel/stress-link.js and the engine scripts. Classic script: top-level names start with eng / Eng. */
"use strict";
const engState = { muse: null, cy: null, eng: null, engKey: null, out: null, lastFrameWall: 0, firstFrameWall: 0, cfg: null, selfcheck: null, stats: null, helper: { state: "idle", text: "", fix: null },
  frames: 0, errors: [], hops: 0, eventsSeen: {}, lastEvents: [], gameEvents: [], fsDisp: null, disp: null, wifiLoss: [], wifiBad: false, legacyCy: null };
window.EngineOut = null;
const engM = () => window.MuseEngine;

/* tuned values from tools/autotune.py, when present (absent until Julian runs it; an error is ignored) */
(function () { const s = document.createElement("script"); s.src = "engine/tuned.js"; s.onerror = () => {}; document.head.appendChild(s); })();
/* profile store (engine/profiles.js): localStorage museengine.profiles.v1, in memory when storage is blocked */
window.engStore = (window.MuseEngine && MuseEngine.Profiles) ? MuseEngine.Profiles.create({ storage: (() => { try { return window.localStorage; } catch (e) { return null; } })() }) : null;

/* ---------- device choice: any time; a click on the other device disconnects the current one first, then connects the new one ---------- */
function engSetDevice(d) {
  if (d !== "muse" && d !== "cyton") return false;
  if (d === S.dev) return true;
  if (S.connected || S.connecting) { engDisconnect(); S.connected = false; S.connecting = false; }
  S.dev = d; try { localStorage.setItem("muse2panel.device", d); } catch (e) {}
  engState.eng = null; engState.engKey = null; engState.out = null; window.EngineOut = null;
  engDisplaySetup(d === "cyton" ? (engState.fsDisp || 125) : FS);
  if (typeof engUiDevice === "function") engUiDevice();
  setStatus("search", d === "cyton" ? "Press Connect" : "Press Connect once");
  renderFocus(); setButtons();
  engConnect(false);      // Cyton: start looking for the helper at once; Muse: reconnect a headset this browser already knows (else "Press Connect once")
  return true;
}

/* ---------- connect / disconnect ---------- */
/* Cyton: three ways in, all behind the Connect button.
   - the USB dongle, read by the browser itself (adapters/cyton-serial.js, Web Serial): no helper, no Python;
   - the WiFi Shield through the helper (adapters/cyton.js -> tools/cyton_helper.py on ws://127.0.0.1:8766);
   - the simulator (adapters/cyton-sim.js; ?demo=1, or "Try a simulated board" in the connect sheet).
   Connect opens the Connect page (panel/engine-ui.js: USB dongle | WiFi Shield switch, live steps, closes itself once data flows);
   it resumes the link used last at once when it can (a dongle this browser already allowed, or the running WiFi link).
   Page load does the same silently, or says "Press Connect".
   The dongle is always read by the browser and the helper only looks for the WiFi Shield, so the two never fight over the board. */
const engCyCommon = () => ({ onFrame: engOnFrame, onMessage: engOnHelperMsg, onStatus: engOnHelperStatus });
function engStartCy(adapter, kind) {
  if (engState.cy) { try { engState.cy.stop(); } catch (e) {} }
  S.connecting = true; S.userDisconnected = false; setButtons(); setStatus("search", "Connecting");
  resetStream(); engState.firstFrameWall = 0;   // timers such as the 20 s "no ECG" help count from this connection
  engState.cyKind = kind; engState.cy = adapter; engState.helper = { state: "connecting", text: "", fix: null };
  adapter.start();
  return adapter;
}
function engStartCySim() { return engStartCy(engM().Adapters.CytonSim.create(Object.assign({ fs: +(params.get("simfs") || 125), script: params.get("script") || "default" }, engCyCommon())), "sim"); }
function engStartCyHelper() { try { localStorage.setItem("muse2panel.cytonLink", "wifi"); } catch (e) {} return engStartCy(engM().Adapters.Cyton.create(Object.assign({ url: "ws://127.0.0.1:" + (params.get("wsport") || 8766) }, engCyCommon())), "helper"); }
function engStartCyDongle(port) { try { localStorage.setItem("muse2panel.cytonLink", "dongle"); } catch (e) {} return engStartCy(engM().Adapters.CytonSerial.create(Object.assign({ port }, engCyCommon())), "dongle"); }
/* is the helper listening? (one WebSocket attempt, no retry loop) */
function engProbeHelper(ms) {
  return new Promise(res => {
    let ws, done = false; const end = v => { if (done) return; done = true; try { ws && ws.close(); } catch (e) {} res(v); };
    try { ws = new WebSocket("ws://127.0.0.1:" + (params.get("wsport") || 8766)); } catch (e) { return res(false); }
    ws.onopen = () => end(true); ws.onerror = () => end(false); ws.onclose = () => end(false); setTimeout(() => end(false), ms || 1500);
  });
}
async function engConnect(userClicked) {
  if (S.dev !== "cyton") return connectMuse(userClicked);
  if (S.connected || S.connecting) return;
  engState.cyUserClicked = !!userClicked;
  const M = engM();
  if (DEMO && params.get("link") === "dongle") {                  // the dongle path with a fake board (Connect opens the page; page load connects at once)
    if (userClicked && typeof engUiCyConnect === "function") return engUiCyConnect({ last: "dongle" });
    return engStartCyDongle(M.Adapters.CytonSerial.fakePort({ source: engFakeCySource() }));
  }
  if (DEMO && params.get("helper") !== "1") return engStartCySim();
  let last = "dongle"; try { last = localStorage.getItem("muse2panel.cytonLink") || "dongle"; } catch (e) {}
  const [helperUp, port] = await Promise.all([engProbeHelper(3000), M.Adapters.CytonSerial.knownPort()]);
  if (S.dev !== "cyton" || S.connected || S.connecting) return;
  if (userClicked && typeof engUiCyConnect === "function") return engUiCyConnect({ last: helperUp && !port ? "wifi" : last, helperUp, port });   // the Connect page (resumes at once when it can)
  if (helperUp && (last === "wifi" || !port)) return engStartCyHelper();
  if (port) return engStartCyDongle(port);
  setStatus("search", "Press Connect");
}
/* ?demo=1&link=dongle: the simulator's signals sent through the real dongle code path (packets, Daisy pairing, gains) */
function engFakeCySource() {
  const sim = engM().Adapters.CytonSim.create({ fs: 125, script: params.get("script") || "default" });
  let chunk = -1, base = 0, frames = [], fi = 0, k = 0;
  return (i, leadOff) => {
    for (;;) { const f = frames[fi]; if (f && k < f.samples[0].length) break; if (f) { fi++; k = 0; continue; } chunk++; frames = sim.buildChunk(chunk); fi = 0; k = 0; }
    const f = frames[fi], v = new Float32Array(16); for (let c = 0; c < 16; c++) v[c] = f.samples[c][k] + (leadOff[c] ? 25 * Math.sin(2 * Math.PI * 31.25 * i / 125) : 0); k++;
    return v;
  };
}
function engDisconnect() {
  if (S.dev !== "cyton") { engEndSession(); return disconnectMuse(); }
  S.userDisconnected = true;
  if (engState.cy && engState.cyKind === "helper") { try { engState.cy.send("shutdown"); } catch (e) {} }   // the WiFi link exits with the panel's Disconnect
  if (engState.cy) engState.cy.stop(); engState.cy = null;
  engEndSession(); engState.eng = null; engState.engKey = null;
  S.connected = false; S.connecting = false; setButtons(); setStatus("bad", "Disconnected"); if (S.rec) stopRec(true);
}
function engOnHelperStatus(s) {
  engState.helper = s;
  if (typeof engUiCyConnectProgress === "function") engUiCyConnectProgress("status", s);
  if (S.dev !== "cyton") return;
  if (s.state === "streaming") { if (!S.connected) { S.connected = true; S.connecting = false; S.everConnected = true; setButtons(); } setStatus("on", DEMO && params.get("helper") !== "1" ? "Simulated Cyton" : "Cyton live"); }
  else if (s.state === "lost") { S.connected = false; S.connecting = true; setButtons(); setStatus("search", "Lost signal, retrying"); }
  else if (s.state === "down" && engState.cyKind === "dongle") {     // the dongle path stops on errors (unplugged, board off, port busy): say why, offer the sheet
    S.connected = false; S.connecting = false; engState.cy = null; setButtons(); setStatus("bad", "Not connected");
    if (typeof EngConn !== "undefined" && EngConn.open) {}                 // the Connect page shows the reason in its steps
    else if (engState.cyUserClicked && typeof engUiCyConnect === "function") engUiCyConnect(s.text); else { toast(s.text, "error", 9000); setStatus("search", "Press Connect"); } }
  else if (s.state === "down") { S.connected = false; S.connecting = true; setButtons(); setStatus("search", "Waiting for the helper"); }
  else if (s.state === "connecting" && !S.connected) setStatus("search", "Connecting");
}
function engOnHelperMsg(m) {
  if (typeof engUiCyConnectProgress === "function") engUiCyConnectProgress("msg", m);
  if (m.type === "config") engState.cfg = m;
  else if (m.type === "selfcheck") { engState.selfcheck = m; if (engState.eng) engState.eng.setHelperInfo(m); }
  else if (m.type === "stats") { engState.stats = m;
    // WiFi reliability: above 2% loss for 30 s -> the dongle warning
    engState.wifiLoss.push({ t: Date.now(), bad: m.link === "wifi" && m.lossPct > 2 }); while (engState.wifiLoss.length && engState.wifiLoss[0].t < Date.now() - 30000) engState.wifiLoss.shift();
    engState.wifiBad = engState.wifiLoss.length >= 25 && engState.wifiLoss.every(x => x.bad); }
  else if (m.type === "error") toast(m.message + (m.fix ? " " + m.fix : ""), "error", 9000);
  else if (m.type === "status" && !S.connected && engState.cyKind === "helper" && (m.state === "connecting" || m.state === "reconnecting")) setStatus("search", "Looking for the Cyton (WiFi)");
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
  engState.eng = M.create({ device: f.device, fs: f.fs, channels: f.channels, ecgChannel: f.device === "cyton" && cfg ? cfg.ecgChannel : f.device === "cyton" ? f.channels.indexOf("ECG") : -1,
    unusedChannels: f.device === "cyton" && cfg ? cfg.unusedChannels : [], mains: cfg && cfg.mains || 60, accel: f.device === "cyton" && cfg && cfg.accel === false ? false : null,
    priors: M.PRIORS, tuned: M.TUNED || null, store: window.engStore || null,
    legacyProvider: f.device === "muse" ? () => ({ focus: S.connected ? pctOf(focus) : null, stress: window.StressMeter ? StressMeter.value() : null }) : null,
    motionTh: f.device === "muse" && MOT.th && MOT.th.calibrated ? MOT.th : null, undoPanelHp: f.device === "muse" });
  engState.eng.onEvent = engOnButton;
  if (engState.selfcheck && f.device === "cyton") engState.eng.setHelperInfo(engState.selfcheck);
  if (f.device === "cyton") engLegacyLoad();
  engState.engKey = key;
  return engState.eng;
}
function engOnFrame(f) {
  try {
    const eng = engEnsureEngine(f);
    engState.lastFrameWall = Date.now(); if (!engState.firstFrameWall) engState.firstFrameWall = engState.lastFrameWall; engState.frames++;
    if (f.device === "cyton") engDisplayFrame(f);
    if (typeof engRecFrame === "function") engRecFrame(f);
    const outs = eng.push(f);
    for (const o of outs) engOnOutput(o);
  } catch (e) { engState.errors.push(String(e && e.message || e)); if (engState.errors.length < 4) console.error(e); }
}
function engOnOutput(o) {
  engState.out = o; window.EngineOut = o; engState.hops++;
  (o.events || []).forEach(e => { engState.eventsSeen[e.type] = (engState.eventsSeen[e.type] || 0) + 1; engState.lastEvents.push(e); });
  if (engState.lastEvents.length > 20) engState.lastEvents.splice(0, engState.lastEvents.length - 20);
  if (typeof engRecHop === "function") engRecHop(o);
}
function engOnButton(ev) { engState.eventsSeen[ev.type] = (engState.eventsSeen[ev.type] || 0) + 1; if (typeof engUiButton === "function") engUiButton(ev); if (typeof engGameEvent === "function") engGameEvent(ev); }
function engEndSession() { try { if (engState.eng) engState.eng.endSession(); } catch (e) { engState.errors.push(String(e.message || e)); } }
addEventListener("beforeunload", engEndSession);
/* no data for 500 ms: advance hold/fade ("signal lost") */
setInterval(() => {
  if (!engState.eng || !engState.lastFrameWall) return;
  if (Date.now() - engState.lastFrameWall > 500) { const o = engState.eng.idle(0.25); if (o) engOnOutput(o); }
}, 250);

/* ---------- Cyton display: band rows, raw view (Fp1, C3, P3, O1) and the ECG row, at the Cyton rate ---------- */
function engDisplaySetup(fs) {
  engState.fsDisp = fs;
  BANDS.forEach(b => { const f0 = Math.sqrt(b.range[0] * b.range[1]), Q = f0 / (b.range[1] - b.range[0]); b.f1 = biquadFs(f0, Q, fs); b.f2 = biquadFs(f0, Q, fs); b.buf.fill(0); b.pos = 0; b.scale = null; });
  S.raw.forEach(a => a.fill(0)); S.rawPos = 0;
  engState.disp = { hp: null, ecgHp: { x: null, y: 0 }, ecgK: 0 };
  // the Cyton raw view: every channel (offset removed, nothing else), the same length as the panel's other rows; 1 s RMS per channel
  engState.cyBuf = []; engState.cyPos = 0; engState.cyRms = []; engState.cyAcc = [];
}
function engDisplayFrame(f) {
  if (engState.fsDisp !== f.fs) engDisplaySetup(f.fs);
  const D = engState.disp, C = f.channels.length, ecg = f.ecg ? f.ecg.channel : -1, n = f.samples[0].length, rawIdx = ["Fp1", "C3", "P3", "O1"].map(x => f.channels.indexOf(x));
  if (!D.hp || D.hp.length !== C) D.hp = f.channels.map(() => ({ x: null, y: 0 }));
  if (engState.cyBuf.length !== C) { engState.cyBuf = f.channels.map(() => new Float32Array(BUF_LEN)); engState.cyPos = 0; engState.cyRms = f.channels.map(() => null); engState.cyAcc = f.channels.map(() => ({ s: 0, n: 0 })); }
  engState.cyNames = f.channels; engState.cyEcg = ecg;
  const o = window.EngineOut, ex = o ? new Set(o.quality.excluded) : new Set();
  const use = f.channels.map((nm, c) => c !== ecg && nm !== "ECG" && !ex.has(nm));
  for (let k = 0; k < n; k++) {
    let s = 0, m = 0; const ys = new Array(C);
    for (let c = 0; c < C; c++) { const h = D.hp[c], x = f.samples[c][k]; if (h.x == null) h.x = x; const y = x - h.x + 0.995 * h.y; h.x = x; h.y = y; ys[c] = y; if (use[c]) { s += y; m++; } }
    S.emitted++; S.usable = m;
    for (let c = 0; c < C; c++) { engState.cyBuf[c][engState.cyPos] = ys[c]; const a = engState.cyAcc[c]; a.s += ys[c] * ys[c]; a.n++; if (a.n >= f.fs) { engState.cyRms[c] = Math.sqrt(a.s / a.n); a.s = 0; a.n = 0; } }
    engState.cyPos = (engState.cyPos + 1) % BUF_LEN;
    for (let r = 0; r < 4; r++) S.raw[r][S.rawPos] = rawIdx[r] >= 0 ? ys[rawIdx[r]] : 0;
    S.rawPos = (S.rawPos + 1) % BUF_LEN;
    const x = m ? s / m : 0;
    for (const b of BANDS) { const v = b.f2.p(b.f1.p(x)); b.buf[b.pos] = v; b.pos = (b.pos + 1) % BUF_LEN; b.energy += v * v; b.eN++; b.e2 += v * v; b.n2++; }
    if (ecg >= 0 && (D.ecgK++ % 2 === 0)) {   // the heart row is drawn from PL at about 64 Hz: every 2nd ECG sample (no resampling of the data itself)
      const h = D.ecgHp, xe = f.samples[ecg][k]; if (h.x == null) h.x = xe; const y = xe - h.x + 0.98 * h.y; h.x = xe; h.y = y;
      PL.bp[PL.bpPos] = y; PL.mk[PL.bpPos] = 1; PL.bpPos = (PL.bpPos + 1) % PL.bp.length; if (PL.filled < PL.bp.length) PL.filled++;
      PL.raw[PL.rawPos] = y; PL.rawPos = (PL.rawPos + 1) % PL.raw.length;
    }
  }
}
if (S.dev === "cyton") engDisplaySetup(125);

/* ---------- Legacy focus on the Cyton (engine/legacy.js runs inside the engine) ---------- */
const ENG_LEG_KEY = "muse2panel.baselines.cyton";
function engLegacy() { return engState.eng && engState.eng.legacy ? engState.eng.legacy : null; }
function engLegacyLoad() { const L = engLegacy(); if (!L) return; try { const b = JSON.parse(localStorage.getItem(ENG_LEG_KEY)); if (b) L.setBaselines(b.lo, b.hi); } catch (e) {} }
function engLegacyPct() { const L = engLegacy(); return S.connected && L ? L.pct() : null; }
function engLegacyState() { const L = engLegacy(); return L ? { cal: !!L.cal, lo: L.lo } : { cal: false, lo: null }; }
function engLegacyCal() { const L = engLegacy(), o = window.EngineOut; if (!L || !S.connected) return; L.startCal(o ? o.t : 0); engState.legCalWall = Date.now(); renderFocus();
  const watch = setInterval(() => { if (!L.cal) { clearInterval(watch); try { if (L.lo != null) localStorage.setItem(ENG_LEG_KEY, JSON.stringify({ lo: L.lo, hi: L.hi, t: Date.now() })); } catch (e) {} renderFocus(); } }, 250); }
function engLegacyNote(st) { const L = engLegacy(); if (!S.connected) return "Connect to use " + (st ? "stress" : "focus");
  if (L && L.cal) return "RECORDING " + Math.max(0, Math.ceil(10 - (Date.now() - engState.legCalWall) / 1000)) + "s. Drift from relaxed to concentrating";
  if (!L || L.lo == null) return (L && L.result) || "Press the button to set baselines"; return (L.result || "Baselines set. Focus is live.") + (st ? " Stress = 100 minus focus." : ""); }

/* ---------- identity: the tick confirms, the cross relabels the whole session (engine/identity.js + engine/profiles.js) ---------- */
function engProfileConfirm() { const id = engState.eng && engState.eng.identity; if (id && id.confirm()) toast("Thanks. This session now counts for " + (id.label || "you") + ".", "info", 4000); }
function engProfileRelabel(pid) { const id = engState.eng && engState.eng.identity; if (!id) return; if (id.relabel(pid)) toast("This session now belongs to " + (id.label || "the chosen profile") + ".", "info", 4000); }
