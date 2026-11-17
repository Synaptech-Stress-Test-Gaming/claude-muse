/* Tests for engine/ecg.js (C1-C6). Run: node engine/ecg.test.js */
"use strict";
const U = require("./util.js"), F = require("./fixtures.js"), Ecg = require("./ecg.js");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }

function run(data, fs, opts) {
  const e = Ecg.create(Object.assign({ fs }, opts || {})), outs = []; let next = 0.25;
  for (let i = 0; i < data.length; i++) { e.push(i, data[i]); while ((i + 1) / fs >= next - 1e-9) { outs.push(e.hop(next)); next += 0.25; } }
  return { e, outs };
}
const rmssdOf = rr => { let s = 0; for (let i = 1; i < rr.length; i++) s += (rr[i] - rr[i - 1]) ** 2; return Math.sqrt(s / (rr.length - 1)); };
/* RMSSD from the engine's accepted intervals vs the truth over the same span (adjacent accepted pairs only) */
function rmssdErr(e, truthTimes, t0, t1) {
  const acc = e.accepted().filter(a => a.t > t0 && a.t <= t1); let s = 0, n = 0;
  for (let k = 1; k < acc.length; k++) if (acc[k].ok && acc[k - 1].ok) { const d = acc[k].rr - acc[k - 1].rr; s += d * d; n++; }
  const tt = truthTimes.filter(t => t > t0 - 2 && t <= t1), rr = []; for (let k = 1; k < tt.length; k++) rr.push((tt[k] - tt[k - 1]) * 1000);
  return { est: Math.sqrt(s / n), truth: rmssdOf(rr.slice(1)), n };
}
function match(found, truth, t0, t1, tol) { const tr = truth.filter(t => t >= t0 && t <= t1), fd = found.filter(t => t >= t0 && t <= t1); let miss = 0, extra = 0, maxErr = 0;
  for (const t of tr) { const m = fd.find(f => Math.abs(f - t) < tol); if (!m) miss++; else maxErr = Math.max(maxErr, Math.abs(m - t)); } for (const f of fd) if (!tr.some(t => Math.abs(f - t) < tol)) extra++; return { miss, extra, maxErr, n: tr.length }; }

// C1 every beat found, RMSSD error < 3 ms at 125 Hz with refinement, refinement never worse
for (const rm of [40, 20]) for (const fs of [125, 250, 500]) {
  const rr = F.rrSeries({ n: 200, meanMs: 850, rmssdMs: rm, seed: 3 }), ecg = F.ecg({ fs, rrMs: rr, seconds: 125, seed: 5 });
  const { e } = run(ecg.data, fs), m = match(e.peaks(), ecg.rTimes, 3, 120, 0.05);
  const e0 = run(ecg.data, fs, { refine: false }).e, err = rmssdErr(e, ecg.rTimes, 5, 120), ae = Math.abs(err.est - err.truth);
  // "the error" of the refinement comparison is the RMS error of the measured RR intervals (what RMSSD inherits); the RMSSD difference itself is ~0.1 ms noise
  const rrErr = ee => { const p = ee.peaks().filter(t => t > 5 && t < 120), d = []; for (let k = 1; k < p.length; k++) { const a = ecg.rTimes.reduce((b, t) => Math.abs(t - p[k - 1]) < Math.abs(b - p[k - 1]) ? t : b), b2 = ecg.rTimes.reduce((b, t) => Math.abs(t - p[k]) < Math.abs(b - p[k]) ? t : b); d.push(((p[k] - p[k - 1]) - (b2 - a)) * 1000); } return Math.sqrt(U.mean(d.map(v => v * v))); };
  const r1 = rrErr(e), r0 = rrErr(e0);
  ok(m.miss === 0 && m.extra === 0, "C1 RMSSD " + rm + " fs " + fs + ": all " + m.n + " beats found, no extras (constant filter delay " + (1000 * m.maxErr).toFixed(1) + " ms)");
  ok((fs !== 125 || ae < 3) && r1 <= r0 + 1e-9, "C1 RMSSD " + rm + " fs " + fs + ": RMSSD error " + ae.toFixed(2) + " ms" + (fs === 125 ? " (< 3)" : "") + "; RR error " + r1.toFixed(2) + " ms with refinement <= " + r0.toFixed(2) + " ms without");
}
// C2 inverted ECG -> same result
{ const rr = F.rrSeries({ n: 200, meanMs: 850, rmssdMs: 40, seed: 4 }), a = F.ecg({ fs: 125, rrMs: rr, seconds: 125, seed: 6 }), b = F.ecg({ fs: 125, rrMs: rr, seconds: 125, seed: 6, invert: true });
  const ea = run(a.data, 125).e, eb = run(b.data, 125).e, ma = match(ea.peaks(), a.rTimes, 25, 120, 0.05), mb = match(eb.peaks(), b.rTimes, 25, 120, 0.05);
  const ra = rmssdErr(ea, a.rTimes, 30, 120), rb = rmssdErr(eb, b.rTimes, 30, 120);
  ok(mb.miss === 0 && mb.extra === 0 && eb.state.sign === -1 && Math.abs(ra.est - rb.est) < 3, "C2 inverted ECG: polarity flipped (sign " + eb.state.sign + "), all beats after the flip, RMSSD " + ra.est.toFixed(1) + " vs " + rb.est.toFixed(1)); void ma; }
// C3 one dropped and one extra beat per 60 s
{ const rr = F.rrSeries({ n: 200, meanMs: 850, rmssdMs: 40, seed: 7 }), ecg = F.ecg({ fs: 125, rrMs: rr, seconds: 125, seed: 8, drop: [40, 110], extra: [75, 130] });
  const { e, outs } = run(ecg.data, 125), acc = e.accepted();
  ok(acc.some(a => a.kind === "missed") && acc.some(a => a.kind === "extra"), "C3 the dropped beat is classified missed and the extra beat extra (" + acc.filter(a => a.kind !== "ok").map(a => a.kind).join(",") + ")");
  const tt = []; let t = 0.6; for (const v of rr) { tt.push(t); t += v / 1000; }
  const err = rmssdErr(e, tt, 5, 120); ok(Math.abs(err.est - err.truth) < 3, "C3 RMSSD error " + Math.abs(err.est - err.truth).toFixed(2) + " ms (< 3)");
  const hrs = outs.filter(o => o.t > 20 && o.hr8 != null); let worst = 0;
  for (const o of hrs) { const b = tt.filter(x => x > o.t - 8 && x <= o.t); const truth = 60000 / U.mean(b.slice(1).map((x, k) => (x - b[k]) * 1000)); worst = Math.max(worst, Math.abs(o.hr8 - truth)); }
  ok(hrs.length > 300 && worst < 1, "C3 heart-rate error " + worst.toFixed(2) + " bpm (< 1) over " + hrs.length + " hops"); }
// C4 scale invariance
{ const rr = F.rrSeries({ n: 200, meanMs: 850, rmssdMs: 40, seed: 9 }), base = F.ecg({ fs: 125, rrMs: rr, seconds: 90, seed: 10 });
  const p1 = run(base.data, 125).e.peaks(), p05 = run(base.data.map(v => v * 0.5), 125).e.peaks(), p2 = run(base.data.map(v => v * 2), 125).e.peaks();
  const same = (a, b) => a.length === b.length && a.every((t, i) => Math.abs(t - b[i]) < 0.0005);
  ok(same(p1, p05) && same(p1, p2), "C4 amplitude x0.5 and x2 give identical beat times (within 0.5 ms)"); }
// C5 white noise or EEG -> no ECG
{ const r = U.rng(5), noise = Float32Array.from({ length: 125 * 90 }, () => 30 * r.normal()), eeg = F.eeg({ device: "cyton", fs: 125, seconds: 90, seed: 3 }).data[2];
  for (const [nm, d] of [["white noise", noise], ["EEG", eeg]]) { const { e, outs } = run(d, 125), last = outs[outs.length - 1];
    ok(e.windows().every(w => !w.valid) && outs.every(o => o.hr8 == null && o.lnRmssd == null) && last.state === "none", "C5 " + nm + ": all windows invalid, hr8/lnRmssd null, state none"); } }
// C6 a window with 25% of its beats corrupted -> no HRV value for it
{ const rr = F.rrSeries({ n: 200, meanMs: 850, rmssdMs: 40, seed: 11 }).slice(); const cor = rr.slice();
  for (let k = 80; k < 150; k += 4) { cor[k] += 220; cor[k + 1] -= 220; }        // 25% of the beats displaced by 220 ms
  const clean = F.ecg({ fs: 125, rrMs: rr, seconds: 125, seed: 12 }), bad = F.ecg({ fs: 125, rrMs: cor, seconds: 125, seed: 12 });
  const oc = run(clean.data, 125).outs, ob = run(bad.data, 125).outs;
  const at = (outs, t) => outs.find(o => Math.abs(o.t - t) < 0.01);
  ok(at(oc, 120).lnRmssd != null, "C6 clean control has an HRV value at 120 s (" + Math.exp(at(oc, 120).lnRmssd).toFixed(1) + " ms)");
  ok(at(ob, 120).lnRmssd == null, "C6 25% of beats corrupted in the window -> no HRV value"); }
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
