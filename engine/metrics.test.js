/* Tests for engine/metrics.js (M1-M8): M1-M7 through the pipeline on fixtures, M8 at the model level. Run: node engine/metrics.test.js */
"use strict";
const K = require("./testkit.js"), F = K.F, U = require("./util.js"), Mt = require("./metrics.js"), N = require("./norm.js"), PRI = require("./priors.json");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }
const vals = (outs, key, a, b) => outs.filter(o => o.t >= a && o.t < b && o[key] && o[key].value != null).map(o => o[key].value);
const meanIn = (outs, key, a, b) => { const v = vals(outs, key, a, b); return v.length ? K.mean(v) : NaN; };
const smooth = (a, b, t, w) => t <= a ? 0 : t >= a + w ? 1 : (t - a) / w;

// M1 focus rises with "focused", falls with "relaxed", sits near 50 when neutral (after 5 min of neutral history)
for (const dev of ["cyton", "muse"]) {
  const mod = t => { const f = smooth(300, 0, t, 5) - smooth(420, 0, t, 5), r = smooth(480, 0, t, 5);
    return { theta: 1 + 0.6 * f - 0.3 * r, alpha: 1 - 0.4 * f + 0.6 * r }; };
  const r = K.rec(dev, 600, 11, { eeg: { mod } }), { outs } = K.run(r);
  const neu = meanIn(outs, "focus", 240, 300), foc = meanIn(outs, "focus", 360, 420), rel = meanIn(outs, "focus", 540, 600);
  ok(foc > 65, "M1 " + dev + ": focused (theta x1.6, alpha x0.6) -> focus " + foc.toFixed(1) + " (> 65)");
  ok(rel < 35, "M1 " + dev + ": relaxed (theta x0.7, alpha x1.6) -> focus " + rel.toFixed(1) + " (< 35)");
  ok(neu >= 40 && neu <= 60, "M1 " + dev + ": neutral -> focus " + neu.toFixed(1) + " (40-60)");
}
// M2 EMG immunity, M3 blink immunity: 240 s of clean history, then the 120 s test stretch (T0 .. T0 + 120)
const T0 = 240;
function immunity(dev, inject, label, limitCtl, rangeCheck) {
  const clean = K.rec(dev, T0 + 130, 21), dirty = K.rec(dev, T0 + 130, 21); inject(dirty);
  const a = K.run(clean).outs, b = K.run(dirty).outs, c = limitCtl ? K.run(dirty, { engine: { cfg: { mask: { disabled: true } } } }).outs : null;
  const pair = (x, y) => { const m = new Map(x.map(o => [o.t.toFixed(2), o.focus.value])); return y.filter(o => o.t >= T0 && o.focus.value != null && m.get(o.t.toFixed(2)) != null).map(o => [m.get(o.t.toFixed(2)), o.focus.value]); };
  const p = pair(a, b), ma = K.mean(p.map(q => q[0])), mb = K.mean(p.map(q => q[1]));
  const cleanV = vals(a, "focus", T0, T0 + 130), lo = Math.min(...cleanV) - 2, hi = Math.max(...cleanV) + 2, dirtyV = vals(b, "focus", T0, T0 + 130);
  ok(Math.abs(mb - ma) <= 2, label + " " + dev + ": mean focus shift " + (mb - ma).toFixed(2) + " points (<= 2), " + p.length + " hops compared");
  if (rangeCheck) ok(dirtyV.every(v => v >= lo && v <= hi), label + " " + dev + ": the trace never leaves [min - 2, max + 2] of the clean trace");
  if (c) { const pc = pair(a, c), mc = K.mean(pc.map(q => q[1])) - K.mean(pc.map(q => q[0])); ok(Math.abs(mc) > 5, label + " " + dev + ": control with masking disabled shifts the mean by " + mc.toFixed(1) + " points (> 5)"); }
}
for (const dev of ["cyton", "muse"]) {
  immunity(dev, r => { for (let t = T0 + 5; t < T0 + 120; t += 10) F.emgBurst(r, t, { durMs: 500, ampUv: 30, loHz: 13, sub: "clench" }); }, "M2", true, true);
  immunity(dev, r => { for (let t = T0 + 2; t < T0 + 120; t += 3) F.blink(r, t, { ampUv: 150 }); }, "M3", false, false);
}
// M4 eyes closed 20 s (Cyton): focus held/stale, never a rise from the alpha change; alphaP statistics unchanged
{ const base = K.rec("cyton", 200, 31), ec = K.rec("cyton", 200, 31); F.eyesClosed(ec, 150, 20);
  const A = K.run(base), B = K.run(ec);
  const before = B.outs.filter(o => o.t <= 150 && o.focus.value != null).slice(-1)[0].focus.value;
  const during = B.outs.filter(o => o.t > 150 && o.t <= 170.5);
  ok(during.every(o => o.focus.value == null || o.focus.value <= before + 2), "M4 focus never rises during 20 s of eyes closed (last open value " + before.toFixed(1) + ")");
  ok(during.filter(o => o.t > 153).every(o => o.focus.state === "held" || o.focus.state === "stale"), "M4 focus is held, then stale, while the eyes are closed");
  const la = A.eng.metrics.feats.alphaP, lb = B.eng.metrics.feats.alphaP;
  const ma = la.epoch.a.m, mb = lb.epoch.a.m;
  ok(Math.abs(ma - mb) < 0.05, "M4 alphaP statistics unchanged by the eyes-closed stretch (epoch mean " + ma.toFixed(3) + " vs " + mb.toFixed(3) + ")"); }
// M5 stress: HR +12 bpm and RMSSD x0.6 after 5 min of rest
{ const rr1 = F.rrSeries({ n: 360, meanMs: 60000 / 70, rmssdMs: 40, seed: 3 }), rr2 = F.rrSeries({ n: 260, meanMs: 60000 / 82, rmssdMs: 24, seed: 4 });
  const rr = []; let t = 0.6; for (const v of rr1) { if (t > 300) break; rr.push(v); t += v / 1000; } for (const v of rr2) rr.push(v);
  const r = K.rec("cyton", 480, 41, { ecg: false }); F.addEcg(r, { rrMs: rr });
  const { outs } = K.run(r);
  const rest = meanIn(outs, "stress", 150, 300), high = meanIn(outs, "stress", 420, 480);
  ok(high > 75, "M5 HR +12 bpm and RMSSD x0.6 -> stress " + high.toFixed(1) + " (> 75)");
  ok(rest >= 40 && rest <= 60, "M5 rest -> stress " + rest.toFixed(1) + " (40-60)");
  const o = outs.find(x => x.t === 250), c = o.stress.components;
  ok(c.hr.valid && c.hrv.valid && c.eeg.valid && Math.abs(c.hr.bpm - 70) < 3 && c.hrv.rmssdMs > 20, "M5 component valid flags and values (hr " + c.hr.bpm.toFixed(1) + " bpm, rmssd " + c.hrv.rmssdMs.toFixed(1) + " ms)"); }
// M6 missing components
{ const r = K.rec("cyton", 60, 51), { outs } = K.run(r), o = outs.find(x => x.t === 15);
  ok(o.stress.value != null && o.stress.components.hr.valid && !o.stress.components.hrv.valid, "M6 no HRV yet (15 s): weights renormalised, stress " + (o.stress.value || 0).toFixed(1) + " is still produced");
  const r2 = K.rec("cyton", 40, 52, { ecg: false }), o2 = K.run(r2).outs.find(x => x.t === 30);
  ok(o2.stress.state === "unavailable" && o2.stress.value === null && o2.stress.reason === "no ECG", "M6 no ECG at all -> unavailable, value null, reason 'no ECG'");
  const r3 = K.rec("muse", 40, 53, { ppg: false }), o3 = K.run(r3).outs.find(x => x.t === 30);
  ok(o3.stress.state === "unavailable" && o3.stress.reason === "no pulse", "M6 Muse without pulse -> unavailable, 'no pulse'"); }
// M7 exertion: HR +25 bpm in 15 s with motion covering 50% -> held, reason movement, nothing learned
{ const rr = []; let t = 0.6; while (t < 240) { const v = 60000 / 70 + 20 * Math.sin(t); rr.push(v); t += v / 1000; } while (t < 300) { const bpm = 70 + 25 * Math.min(1, (t - 240) / 15), v = 60000 / bpm + 10 * Math.sin(t); rr.push(v); t += v / 1000; }
  const r = K.rec("cyton", 300, 61, { ecg: false }); F.addEcg(r, { rrMs: rr }); for (let s = 241; s < 296; s += 2) F.motion(r, s, 1);
  let W250 = null, W290 = null;
  const { outs } = K.run(r, { each: (o, eng) => { if (o.t === 252) W250 = eng.metrics.feats.hr.personalTime(); if (o.t === 290) W290 = eng.metrics.feats.hr.personalTime(); } });
  const seg = outs.filter(o => o.t >= 255 && o.t < 290);
  ok(seg.every(o => (o.stress.state === "held" || o.stress.state === "stale") && o.stress.reason === "movement"), "M7 exertion: stress held/stale with reason movement (" + [...new Set(seg.map(o => o.stress.state + "/" + o.stress.reason))].join(",") + ")");
  ok(W250 != null && W250 === W290, "M7 heart-rate statistics unchanged while exerting (W " + W250 + " -> " + W290 + ")"); }
// M8 drowsiness (model level)
{ const P = PRI.cyton.features, feats0 = { thetaF: { valid: false }, alphaP: { valid: false }, betaLoC: { valid: false } };
  const sd = k => P[k].sd, mu = k => P[k].mu;
  // 15 min of lifetime history at the prior means
  const hist = Mt.create({ device: "cyton", priors: PRI.cyton }); const rg = U.rng(8);
  for (let t = 0; t < 900; t += 2) for (const [k, x] of [["ratioD", mu("ratioD") + 0.3 * sd("ratioD") * rg.normal()], ["blinkDur", mu("blinkDur") + 0.3 * sd("blinkDur") * rg.normal()], ["blinkRate", mu("blinkRate") + 0.3 * sd("blinkRate") * rg.normal()]]) hist.apply({ key: k, x, w: 2 });
  const sums = hist.summary(), mk = () => { const m = Mt.create({ device: "cyton", priors: PRI.cyton }); const by = {}; for (const k in sums) by[k] = [sums[k]]; m.loadLifetime(by, null, 1); return m; };
  const runD = (m, seconds, ratioZ, durZ, ec) => { let o = null; for (let t = 0.25; t <= seconds; t += 0.25) { const f = Object.assign({}, feats0, { ratioD: { x: mu("ratioD") + ratioZ(t) * sd("ratioD"), valid: true, cleanFrac: 1, eyesClosed: !!(ec && ec(t)) } });
      const dur = mu("blinkDur") + durZ(t) * sd("blinkDur"); o = m.hop({ t, hop: 0.25, feats: f, cardiac: {}, drowsy: { blinkDurs60: [dur, dur, dur, dur, dur, dur], blinkCount60: 17, blinkWinS: 60, perclos: null, spindleRate: null } }); } return o; };
  const m1 = mk(), o1 = runD(m1, 600, () => 1.5, () => 1.5);
  ok(o1.drowsiness.usable && o1.drowsiness.value > 70, "M8 ratioD +1.5 sigma and blink duration +1.5 sigma over 10 min -> " + o1.drowsiness.value.toFixed(1) + " (> 70)");
  const m2 = mk(), o2 = runD(m2, 600, () => 3, () => 0);
  ok(Math.abs(o2.drowsiness.value - 100 / (1 + Math.exp(-1.7))) < 1.5, "M8 ratioD alone at +3 sigma is capped at the score for z = +1 (" + o2.drowsiness.value.toFixed(1) + " vs 84.6)");
  const m3 = mk(); runD(m3, 120, () => 0, () => 0); const before = m3.state.zd; const o3 = runD(m3, 60, () => 4, () => 0, () => true);
  ok(m3.state.zd <= before + 0.05, "M8 60 s of eyes closed with high alpha -> no rise (z " + before.toFixed(2) + " -> " + m3.state.zd.toFixed(2) + ")"); void o3;
  const m4 = Mt.create({ device: "cyton", priors: PRI.cyton }), o4 = runD(m4, 30, () => 2, () => 2);
  ok(o4.drowsiness.learning && o4.drowsiness.value === null, "M8 a new profile -> learning, value null");
  const r = K.rec("muse", 20, 9), { outs } = K.run(r); ok(outs.every(o => o.drowsiness === null), "M8 the Muse -> drowsiness === null"); void N; }
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
