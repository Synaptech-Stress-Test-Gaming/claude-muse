/* Tests for engine/ppg.js (P1). Run: node engine/ppg.test.js */
"use strict";
const U = require("./util.js"), F = require("./fixtures.js"), Pg = require("./ppg.js");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }
const rmssdOf = rr => { let s = 0; for (let i = 1; i < rr.length; i++) s += (rr[i] - rr[i - 1]) ** 2; return Math.sqrt(s / (rr.length - 1)); };

const rr = F.rrSeries({ n: 200, meanMs: 820, rmssdMs: 40, seed: 2 }), p = F.ppg({ fs: 64, rrMs: rr, seconds: 120, seed: 4 });
const data = Float32Array.from(p.data);
for (let i = Math.round(70 * 64); i < Math.round(71.5 * 64); i++) data[i] = NaN;          // a 1.5 s hole
const pg = Pg.create({}), outs = [];
for (let k = 0; k * 6 < data.length; k++) { pg.push({ t0: k * 6 / 64, data: data.slice(k * 6, k * 6 + 6) }, 72); const t = (k + 1) * 6 / 64; if (Math.floor(t / 0.25) > Math.floor(k * 6 / 64 / 0.25)) outs.push(pg.hop(t)); }
// the band-pass delays every detected beat by the same amount: the truth uses the same (shifted) 8 s window,
// and intervals across the hole do not exist for either side
const det = pg.beatsIn(20, 60), delay = U.median(det.map(t => t - p.beats.reduce((b, x) => Math.abs(x - t) < Math.abs(b - t) ? x : b)));
let worst = 0, wt = null, n = 0;
for (const o of outs) {
  if (o.t < 15 || o.hr8 == null || o.state !== "beats") continue;
  const b = p.beats.map(x => x + delay).filter(x => x > o.t - 8 && x <= o.t);
  const iv = b.slice(1).map((x, k) => [b[k], x]).filter(([a0, a1]) => !(a1 > 70 && a0 < 71.7));
  const truth = 60000 / U.mean(iv.map(([a0, a1]) => (a1 - a0) * 1000));
  if (Math.abs(o.hr8 - truth) > worst) { worst = Math.abs(o.hr8 - truth); wt = o.t; } n++;
}
ok(n > 300 && worst < 1, "P1 heart rate within 1 bpm of the truth (worst " + worst.toFixed(2) + " bpm at " + wt + " s, over " + n + " hops)");
const beats = pg.beatsIn(60, 80); ok(!beats.some(t => t > 70 && t < 71.5), "P1 NaN gaps do not create beats");
const last = outs[outs.length - 1], truthR = rmssdOf(rr.slice(Math.round(60 / 0.82), Math.round(120 / 0.82)));
ok(last.rmssdMs != null && Math.abs(last.rmssdMs - truthR) < 6, "P1 RMSSD " + (last.rmssdMs || 0).toFixed(1) + " ms vs truth " + truthR.toFixed(1) + " ms (within 6 ms)");
{ const q = Pg.create({}); q.push({ t0: 0, data: new Float32Array(64).fill(NaN) }, 71); const o = q.hop(1); ok(o.hr8 === 71 && o.state === "aux", "too few beats -> falls back to aux.ppgHr"); }
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
