/* Tests for engine/motion.js (same scenarios as panel/motion.test.js, plus the EEG proxy). Run: node engine/motion.test.js */
"use strict";
const U = require("./util.js"), M = require("./motion.js"), F = require("./fixtures.js"), P = require("./preproc.js");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }

function runGate(kind, rec, opts) {
  const g = M.Gate(Object.assign({ kind }, opts || {})), fsA = rec.accel.fs; g.setFs(fsA);
  const trace = []; let ai = 0, gi = 0;
  for (let t = 0.05; t <= rec.n / rec.fs + 1e-9; t += 0.05) {
    while (ai < rec.accel.x.length && ai / fsA <= t) { g.pushAccel(ai / fsA, rec.accel.x[ai], rec.accel.y[ai], rec.accel.z[ai]); ai++; }
    if (rec.gyro) while (gi < rec.gyro.x.length && gi / fsA <= t) { g.pushGyro(gi / fsA, rec.gyro.x[gi], rec.gyro.y[gi], rec.gyro.z[gi]); gi++; }
    trace.push({ t, s: g.step(t, 0.05) });
  }
  return { g, trace };
}
for (const kind of ["muse", "cyton"]) {
  const rec = F.eeg({ device: kind, fs: kind === "muse" ? 256 : 125, seconds: 60, seed: 2 });
  F.motion(rec, 40, 3);
  const { g, trace } = runGate(kind, rec);
  const before = trace.filter(x => x.t > 3 && x.t < 39.9);
  ok(before.every(x => x.s === "VALID"), kind + ": still -> VALID the whole time before the movement");
  const enter = trace.find(x => x.t >= 40 && x.s === "MOVEMENT");
  ok(enter && enter.t - 40 <= 0.5, kind + ": 3 s movement -> MOVEMENT within 0.5 s (" + (enter ? (enter.t - 40).toFixed(2) : "never") + " s)");
  const back = trace.find(x => x.t > 43 && x.s === "VALID");
  ok(back && back.t - 43 >= 1.5 && back.t - 43 <= 2.0, kind + ": VALID again 1.5-2.0 s after it stops (" + (back ? (back.t - 43).toFixed(2) : "never") + " s)");
  const ev = g.drain().filter(e => e.onset > 10); ok(ev.length === 1 && ev[0].onset < 40.2 && ev[0].offset > 44 && ev[0].sub === "movement", kind + ": one motion event with onset/offset (plus the start-up no_data event)");
  ok(g.th.acc.entry >= 0.5 * 0.02 && g.th.acc.entry >= 1.5 * g.th.acc.exit, kind + ": self-tuned thresholds respect the floors (entry " + g.th.acc.entry.toFixed(4) + ")");
}
// stale data -> NO_DATA
{ const rec = F.eeg({ device: "muse", fs: 256, seconds: 20, seed: 3 }); const g = M.Gate({ kind: "muse" }); g.setFs(52); let s = null;
  for (let i = 0; i < rec.accel.x.length; i++) { const t = i / 52; if (t > 10) break; g.pushAccel(t, rec.accel.x[i], rec.accel.y[i], rec.accel.z[i]); g.pushGyro(t, rec.gyro.x[i], rec.gyro.y[i], rec.gyro.z[i]); if (i % 3 === 0) s = g.step(t + 0.1, 0.05); }
  ok(s === "VALID", "data flowing -> VALID");
  ok(g.step(10.4, 0.05) === "VALID" && g.step(10.8, 0.05) === "NO_DATA", "no motion sample for 0.5 s -> NO_DATA (never read as still)");
  const g2 = M.Gate({ kind: "muse" }); g2.setFs(52); for (let i = 0; i < 520; i++) { g2.pushAccel(i / 52, 0, 0, 1); }
  ok(g2.step(10.1, 0.05) === "MOVEMENT" || g2.state !== "NO_DATA", "gyro never seen: the gate runs on the accelerometer alone"); }
{ const g = M.Gate({ kind: "muse" }); g.setFs(52); for (let i = 0; i < 520; i += 3) { g.pushAccel(i / 52, 0, 0, 1); }
  ok(g.step(10.05, 0.05) === "NO_DATA", "fewer than 0.48 fs samples in the window -> NO_DATA"); }
{ const g = M.Gate({ kind: "muse", th: { acc: { entry: 0.05, exit: 0.02 }, gyro: { entry: 20, exit: 8 }, calibrated: true } }); ok(g.th.acc.entry === 0.05 && g.th.gyro.exit === 8, "the panel's still-calibration thresholds are used when given"); }

// EEG proxy
function runProxy(kind, rec) {
  const fs = rec.fs, pp = P.create({ fs, nCh: rec.channels.length }), px = M.Proxy({ fs, nCh: rec.channels.length, kind }), slotN = Math.round(0.25 * fs), out = [];
  const good = rec.channels.map((_, c) => c).filter(c => c !== rec.ecgChannel);
  for (let i = 0; i < rec.n; i++) { for (const c of good) { pp.run(c, rec.data[c][i]); px.push(c, pp.xb); } if ((i + 1) % slotN === 0) out.push({ t: (i + 1) / fs, s: px.slot((i + 1) / fs, good) }); }
  return out;
}
for (const kind of ["cyton", "muse"]) {
  const rec = F.eeg({ device: kind, fs: kind === "muse" ? 256 : 125, seconds: 60, seed: 5, accel: false });
  if (kind === "cyton") F.addEcg(rec, {});
  F.motion(rec, 40, 3); F.blink(rec, 20); F.blink(rec, 25, { ampUv: 200 }); F.voluntaryBlink(rec, 30);
  const tr = runProxy(kind, rec);
  ok(tr.filter(x => x.t > 10 && x.t < 39.9).every(x => x.s === "VALID"), kind + " proxy: blinks do not fire it");
  const en = tr.find(x => x.t >= 40 && x.s === "MOVEMENT"); ok(en && en.t - 40 <= 0.75, kind + " proxy: fires on a common 80 uV 3 Hz wave (" + (en ? (en.t - 40).toFixed(2) : "never") + " s)");
  const bk = tr.find(x => x.t > 43.2 && x.s === "VALID"); ok(bk && bk.t - 43 <= 2.5, kind + " proxy: VALID after 1.5 s without such a slot");
}
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
