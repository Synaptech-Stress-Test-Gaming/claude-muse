/* adapters/cyton-sim.js
   Simulated Cyton + Daisy inside the browser (used by ?demo=1&device=cyton, no Python needed). Produces the same frames as
   adapters/cyton.js would decode from the helper, from engine/fixtures.js, on a 40 ms timer, plus helper-style config/selfcheck/stats
   messages so the panel shows them. Scripts (30 s cycle, same as cyton_helper.py --sim-script):
     default: blink 5 s; double blink 8.00 + 8.35 s; jaw-clench tap 12 s; head movement 15-18 s; electrode pop on C3 22 s; chewing 25-27.5 s
     quiet: no artifacts.   artifacts: one artifact every 4 s through all types.
   Channel 9 (index 8, the F7 pins) carries an ECG at about 68 bpm; DC offsets of up to +/-20 mV; 60 Hz hum of 5 uV.
   UMD: MuseEngine.Adapters.CytonSim. */
"use strict";
(function (root) {
  const E = root.MuseEngine = root.MuseEngine || {};
  E.Adapters = E.Adapters || {};
  const F = () => E.Fixtures || (typeof require !== "undefined" ? require("../engine/fixtures.js") : null);
  const U = () => E.Util || (typeof require !== "undefined" ? require("../engine/util.js") : null);
  const NAMES = ["Fp1", "Fp2", "C3", "C4", "P7", "P8", "O1", "O2", "ECG", "F8", "F3", "F4", "T7", "T8", "P3", "P4"];
  const CYCLE = 30;

  function scriptInject(Fx, rec, script, k) {
    if (script === "quiet") return;
    if (script === "artifacts") {
      const kinds = ["blink", "double", "clench", "chew", "talk", "tension", "motion", "pop", "saccade"];
      for (let j = 0; j < 7; j++) { const t = 2 + 4 * j, kind = kinds[(k * 7 + j) % kinds.length];
        if (kind === "blink") Fx.blink(rec, t); else if (kind === "double") Fx.doubleBlink(rec, t, 350); else if (kind === "clench") Fx.clench(rec, t);
        else if (kind === "chew") Fx.chew(rec, t, 3, 1.2); else if (kind === "talk") Fx.talk(rec, t, 2.5); else if (kind === "tension") Fx.tension(rec, t, 2);
        else if (kind === "motion") Fx.motion(rec, t, 2); else if (kind === "pop") Fx.pop(rec, t, "C3"); else Fx.saccade(rec, t); }
      return;
    }
    Fx.blink(rec, 5); Fx.doubleBlink(rec, 8.0, 350); Fx.clench(rec, 12); Fx.motion(rec, 15, 3); Fx.pop(rec, 22, "C3"); Fx.chew(rec, 25, 3, 1.2);
  }

  function create(o) {
    o = Object.assign({ onFrame: null, onMessage: null, onStatus: null, fs: 125, seed: 1, script: "default", now: () => Date.now(), setInterval: (f, ms) => setInterval(f, ms), clearInterval: id => clearInterval(id) }, o);
    const Fx = F(), Ut = U(), fs = o.fs, r = Ut.rng(o.seed * 17 + 3);
    const dc = NAMES.map(() => (r.next() * 2 - 1) * 20000);
    const rr = Fx.rrSeries({ n: 20000, meanMs: 60000 / 68, rmssdMs: 35, seed: o.seed + 9 });
    const beats = []; { let t = 0.6; for (const v of rr) { beats.push(t); t += v / 1000; } }
    const S = { timer: null, wall0: null, queue: [], chunk: -1, sent: 0, streamId: 1, impUntil: 0, impRes: null, stopped: true, statsAt: 0, frames: 0 };
    function buildChunk(k) {
      const rec = Fx.eeg({ device: "cyton", fs, seconds: CYCLE, seed: o.seed * 1000 + k, mainsUv: fs / 2 > 62 ? 5 : 0 });
      rec.channels = NAMES.slice();                                   // index 8 carries the ECG, named ECG by the helper config
      scriptInject(Fx, rec, o.script, k);
      const c0 = k * CYCLE, inRange = beats.filter(b => b >= c0 - 0.6 && b < c0 + CYCLE + 0.6);
      const rrMs = []; for (let i = 1; i < inRange.length; i++) rrMs.push((inRange[i] - inRange[i - 1]) * 1000); rrMs.push(rrMs[rrMs.length - 1] || 880);
      const e = Fx.ecg({ fs, rrMs, seconds: CYCLE, startS: inRange[0] - c0, seed: o.seed + k, morph: null });
      rec.data[8] = e.data; rec.ecgChannel = 8;
      for (let c = 0; c < 16; c++) { const x = rec.data[c]; for (let i = 0; i < x.length; i++) x[i] += dc[c]; }
      const fr = Fx.frames(rec, 40, { streamId: S.streamId }), off = Math.round(c0 * fs);
      fr.forEach(f => { f.sampleIndex += off; f.t0 = f.sampleIndex / fs; f.channels = NAMES.slice(); f.ecg = { fs, data: f.samples[8], channel: 8 }; f.contact = null;
        if (f.accel) f.accel.t = f.accel.t.map(t => t + c0); f.aux.flags.simulated = true; });
      return fr;
    }
    function msg(m) { if (o.onMessage) o.onMessage(m); }
    function config() { return { type: "config", streamId: S.streamId, fs, boardFs: fs, decim: 1, channels: NAMES.slice(), ecgChannel: 8, unusedChannels: [], accel: true, link: "sim", mains: 60, gainEeg: 24, gainEcg: 12 }; }
    function selfcheck() {
      return { type: "selfcheck", daisy: true, nCh: 16, perChannel: NAMES.map(n => ({ name: n, railed: false, flat: false, rmsUv: 8, lineRatio: 0.02 })), accel: { present: true, reason: null },
        rate: { requested: fs, measured: fs, lossPct: 0 }, alias: { checked: fs === 125, freqHz: 5, ratio: 1, warn: false }, ftdi: { checked: false, burstMs: null, warn: false, fix: null },
        ecg: { configured: 9, detected: true, channel: 9, kurtosis: 12, acPeak: 0.6, bpm: 68, moved: false }, warnings: [] };
    }
    function tick() {
      if (S.stopped) return;
      const now = o.now(), due = Math.floor((now - S.wall0) / 1000 * fs);
      let guard = 0;
      while (guard++ < 200) {
        if (!S.queue.length) { S.chunk++; S.queue = buildChunk(S.chunk); }
        const f = S.queue[0], end = f.sampleIndex + f.samples[0].length;
        if (end > due) break;
        S.queue.shift();
        if (now < S.impUntil) f.aux.flags.impedance = true;
        S.frames++;
        if (o.onFrame) o.onFrame(f);
      }
      if (S.impRes && now >= S.impUntil) { S.impRes.forEach(x => msg(x)); msg({ type: "impedance_done", results: S.impRes }); S.impRes = null; msg({ type: "status", state: "streaming", link: "sim", detail: "", t: now / 1000 }); }
      if (now - S.statsAt >= 1000) { S.statsAt = now; msg({ type: "stats", fs, lossPct: 0, lostTotal: 0, link: "sim", uptimeS: Math.round((now - S.wall0) / 100) / 10, clientDrops: 0 }); }
    }
    function start() {
      S.stopped = false; S.wall0 = o.now(); S.queue = []; S.chunk = -1;
      if (o.onStatus) o.onStatus({ state: "streaming", text: "Simulated Cyton (no helper)", fix: null });
      msg({ type: "hello", proto: 1, helper: "cyton-sim (browser)", version: "1.0", simulated: true });
      msg({ type: "status", state: "streaming", link: "sim", detail: "simulated in the browser", t: S.wall0 / 1000 });
      msg(config()); msg(selfcheck());
      S.timer = o.setInterval(tick, 40);
    }
    function stop() { S.stopped = true; if (S.timer != null) o.clearInterval(S.timer); S.timer = null; if (o.onStatus) o.onStatus({ state: "idle", text: "Disconnected", fix: null }); }
    function send(cmd) {
      if (cmd === "impedance_sweep") { const now = o.now(); S.impUntil = now + 8000; msg({ type: "status", state: "impedance", link: "sim", detail: "contact check running", t: now / 1000 });
        S.impRes = NAMES.map((n, c) => c === 8 ? null : { type: "impedance", channel: c, name: n, kohm: Math.round(150 + 600 * r.next()), rmsUv: 0 }).filter(Boolean); return true; }
      if (cmd === "stop_impedance") { S.impUntil = 0; return true; }
      if (cmd === "ping") { msg({ type: "pong" }); return true; }
      return false;
    }
    return { start, stop, send, tick, state: S, get config() { return config(); }, buildChunk };
  }
  const API = { create, NAMES };
  E.Adapters.CytonSim = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
