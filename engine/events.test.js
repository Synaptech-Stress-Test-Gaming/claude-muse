/* Tests for engine/events.js (E1-E6), fixtures at fs 125 (Cyton) and 256 (Muse). Run: node engine/events.test.js */
"use strict";
const U = require("./util.js"), F = require("./fixtures.js"), P = require("./preproc.js"), Ev = require("./events.js"), M = require("./motion.js");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }

/* the pipeline's stages 1-4 in miniature: preprocessing, events every 50 ms, motion gate, gaps */
function run(rec, opts) {
  opts = opts || {};
  const fs = rec.fs, C = rec.channels.length, eeg = rec.channels.map((_, i) => i).filter(i => i !== rec.ecgChannel);
  const pp = P.create({ fs, nCh: C }), ev = Ev.create({ fs, device: rec.device, channels: rec.channels, eegIdx: eeg, det: opts.det || null, cfg: opts.cfg || null });
  const gate = rec.accel ? M.Gate({ kind: rec.device }) : null; if (gate) gate.setFs(rec.accel.fs);
  const out = [], tickN = Math.round(0.05 * fs), xb = new Float64Array(C), xd = new Float64Array(C); let ai = 0, gi = 0, lost = 0;
  for (let i = 0; i < rec.n; i++) {
    if (rec.gapMask && rec.gapMask[i]) { lost++; continue; }
    if (lost) { ev.gap(i, lost); for (let c = 0; c < C; c++) pp.reset(c); out.push({ type: "gap", onset: (i - lost) / fs, offset: i / fs }); lost = 0; }
    for (let c = 0; c < C; c++) { pp.run(c, rec.data[c][i]); xb[c] = pp.xb; xd[c] = pp.xd; }
    ev.push(i, xb, xd);
    if ((i + 1) % tickN === 0) {
      const t = (i + 1) / fs;
      ev.tick(t).forEach(e => out.push(e));
      if (gate) { const a = rec.accel; while (ai < a.x.length && ai / a.fs <= t) { gate.pushAccel(ai / a.fs, a.x[ai], a.y[ai], a.z[ai]); ai++; }
        if (rec.gyro) while (gi < rec.gyro.x.length && gi / a.fs <= t) { gate.pushGyro(gi / a.fs, rec.gyro.x[gi], rec.gyro.y[gi], rec.gyro.z[gi]); gi++; }
        gate.step(t, 0.05); gate.drain().forEach(e => { if (e.onset > 3) out.push(e); }); }
    }
  }
  return { events: out, ev };
}
const DEVS = [["cyton", 125], ["muse", 256]];
const mkRec = (dev, fs, seconds, seed) => { const r = F.eeg({ device: dev, fs, seconds, seed }); if (dev === "cyton") F.addEcg(r, {}); return r; };
const lab = e => e.type + (e.sub ? "/" + e.sub : "") + "@" + e.onset.toFixed(2);

// E1 clean data: zero events
for (const [dev, fs] of DEVS) { const r = run(mkRec(dev, fs, 600, 11)); const e = r.events.filter(x => x.onset > 3);
  ok(e.length === 0, "E1 " + dev + " fs " + fs + ": 10 min of clean EEG -> " + e.length + " events" + (e.length ? " (" + e.slice(0, 4).map(lab).join(", ") + ")" : "")); }

// E2 each injector -> the right type/sub, onset within 100 ms
const INJ = [
  ["blink", r => F.blink(r, 30), "blink", null],
  ["voluntary blink", r => F.voluntaryBlink(r, 30), "blink_voluntary", null],
  ["saccade", r => F.saccade(r, 30), "saccade", null],
  ["clench", r => F.clench(r, 30), "emg_burst", "clench"],
  ["chew (4 bursts)", r => F.chew(r, 30, 4), "emg_burst", "chew"],
  ["talk (6 s)", r => F.talk(r, 30, 6), "emg_burst", "talk"],
  ["tension (3 s)", r => F.tension(r, 30, 3), "emg_burst", "tension"],
  ["pop", r => F.pop(r, 30, r.device === "muse" ? "TP10" : "C3"), "electrode_pop", null],
  ["gap", r => F.gap(r, 30, 1), "gap", null],
  ["motion", r => F.motion(r, 30, 3), "motion", null],
  ["eyes_closed", r => F.eyesClosed(r, 30, 8), "eyes_closed", null]
];
for (const [dev, fs] of DEVS) for (const [name, inj, type, sub] of INJ) {
  if (name === "eyes_closed" && dev === "muse") continue;
  const rec = mkRec(dev, fs, 50, 21); const truth = inj(rec)[0]; const { events } = run(rec);
  const win = events.filter(e => e.onset > 25 && e.onset < 42);
  const tol = type === "eyes_closed" ? 0.3 : 0.1;
  if (type === "emg_burst" && (sub === "talk" || sub === "chew")) {
    const bursts = win.filter(e => e.type === "emg_burst"), others = win.filter(e => e.type !== "emg_burst"), good = bursts.filter(e => e.sub === sub).length;
    const need = sub === "chew" ? bursts.length >= 3 && good === bursts.length : good >= 0.8 * bursts.length && !bursts.some(e => e.sub === "clench" || e.sub === "chew");
    ok(need && others.length === 0 && bursts.length && Math.abs(bursts[0].onset - truth.onset) <= tol,
      "E2 " + dev + " " + name + ": " + good + "/" + bursts.length + " bursts labelled " + sub + " (" + bursts.map(e => e.sub).join(",") + ")" + (bursts[0] ? ", first onset " + (bursts[0].onset - truth.onset).toFixed(3) + " s" : "") + (others.length ? "; also " + others.map(lab).join(",") : ""));
    continue;
  }
  const hits = win.filter(e => e.type === type && (sub == null || e.sub === sub));
  let others = win.filter(e => e.type !== type || (sub != null && e.sub !== sub));
  if (type === "eyes_closed") others = others.filter(e => e.onset > 37.5 && (e.type === "blink" || e.type === "blink_voluntary") ? false : true);   // the opening may read as a blink
  const first = hits[0];
  ok(first && Math.abs(first.onset - truth.onset) <= tol && others.length === 0 && hits.length === 1, "E2 " + dev + " " + name + " -> " + type + (sub ? "/" + sub : "") +
    (first ? " onset " + (first.onset - truth.onset).toFixed(3) + " s" : " not found") + (others.length ? "; also " + others.map(lab).join(",") : "") + (hits.length > 1 ? "; " + hits.length + " hits" : ""));
}

// E3 60 spontaneous blinks, 110-190 uV, 2-5 s apart
for (const [dev, fs] of DEVS) {
  const rec = mkRec(dev, fs, 260, 31), r = U.rng(5); let t = 10; const truth = [];
  for (let k = 0; k < 60; k++) { truth.push(F.blink(rec, t, { ampUv: r.range(110, 190) })[0]); t += r.range(2, 5); }
  const { events } = run(rec); const b = events.filter(e => e.type === "blink"), v = events.filter(e => e.type === "blink_voluntary");
  const matched = truth.filter(tr => b.some(e => Math.abs(e.onset - tr.onset) < 0.15)).length;
  ok(matched >= 57 && v.length === 0, "E3 " + dev + ": " + matched + "/60 detected as blink, " + v.length + " as voluntary");
}
// E4 self-tuning on the Cyton: 20 blinks with median 90 uV, then a 150 uV blink is voluntary
{ const rec = mkRec("cyton", 125, 120, 41), r = U.rng(6); let t = 10;
  for (let k = 0; k < 20; k++) { F.blink(rec, t, { ampUv: r.range(80, 100) }); t += r.range(2, 4); }
  const big = F.blink(rec, t + 2, { ampUv: 150 })[0];
  const { events, ev } = run(rec); const det = ev.det();
  ok(Math.abs(det.blinkAmpMed - 90) / 90 <= 0.15, "E4 medAmp after 20 blinks of 90 uV = " + det.blinkAmpMed.toFixed(1) + " (within 15%)");
  const e = events.find(x => Math.abs(x.onset - big.onset) < 0.15); ok(e && e.type === "blink_voluntary", "E4 a 150 uV blink is then blink_voluntary (" + (e && e.type) + ")"); }
// E5 a clench during talking is still an emg_burst; chew bursts are not clench
{ const rec = mkRec("cyton", 125, 60, 51); F.talk(rec, 20, 8); const cl = F.clench(rec, 24)[0]; F.chew(rec, 40, 4);
  const { events } = run(rec); const cov = events.filter(e => e.type === "emg_burst" && e.onset <= cl.offset && e.offset >= cl.onset);
  ok(cov.length >= 1, "E5 a clench during talking is still an emg_burst (" + cov.map(e => e.sub).join(",") + ")");
  const chew = events.filter(e => e.type === "emg_burst" && e.onset > 39 && e.onset < 45); ok(chew.length >= 3 && !chew.some(e => e.sub === "clench"), "E5 chew bursts are not labelled clench (" + chew.map(e => e.sub).join(",") + ")"); }
// E6 a blink is not a pop; a 60 uV RMS EMG burst produces no electrode_pop
for (const [dev, fs] of DEVS) { const rec = mkRec(dev, fs, 60, 61); F.blink(rec, 20, { ampUv: 250 }); F.voluntaryBlink(rec, 25); F.emgBurst(rec, 35, { durMs: 600, ampUv: 60 }); F.clench(rec, 45);
  const { events } = run(rec); const pops = events.filter(e => e.type === "electrode_pop"); ok(!pops.length, "E6 " + dev + ": blinks and 60 uV RMS EMG bursts give no electrode_pop" + (pops.length ? " (" + pops.map(lab).join(",") + ")" : "")); }
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
