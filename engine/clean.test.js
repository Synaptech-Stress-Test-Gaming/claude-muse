/* Tests for engine/clean.js (A1-A5). Run: node engine/clean.test.js */
"use strict";
const U = require("./util.js"), F = require("./fixtures.js"), Cl = require("./clean.js"), K = require("./testkit.js");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }
const rms = (a, i0, i1) => { let s = 0; for (let i = i0; i < i1; i++) s += a[i] * a[i]; return Math.sqrt(s / (i1 - i0)); };

// A1 a 1 s burst of 20x amplitude on 2 channels
{ const fs = 125, rec = F.eeg({ device: "cyton", fs, seconds: 120, seed: 3 }), X = rec.data.filter((_, c) => c !== 8).map(x => Float32Array.from(x));
  const B0 = 100 * fs, B1 = 101 * fs; for (const c of [2, 5]) for (let i = B0; i < B1; i++) X[c][i] *= 20;
  const asr = Cl.ASR({ fs, channels: X.map((_, c) => c) }), Y = asr.processArray(X, (a, b) => !(b > 99.5 && a < 101.5));
  const drop = [2, 5].map(c => 1 - rms(Y[c], B0, B1) / rms(X[c], B0, B1)), keep = [0, 7, 12].map(c => Math.abs(rms(Y[c], 70 * fs, 95 * fs) / rms(X[c], 70 * fs, 95 * fs) - 1));
  ok(asr.calibrated() && drop.every(d => d >= 0.7), "A1 burst-window RMS on the two channels drops " + drop.map(d => (100 * d).toFixed(0) + "%").join(", ") + " (>= 70%)");
  ok(keep.every(d => d < 0.05), "A1 clean stretches change " + keep.map(d => (100 * d).toFixed(2) + "%").join(", ") + " (< 5%)"); }
// A2 ASR off -> output identical to input
{ const fs = 125, rec = F.eeg({ device: "cyton", fs, seconds: 20, seed: 4 }), X = rec.data.slice(0, 15), asr = Cl.ASR({ fs, channels: X.map((_, c) => c), cfg: { calibS: 1e9 } }), Y = asr.processArray(X);
  ok(Y.every((y, c) => y.every((v, i) => v === X[c][i])), "A2 without a calibration (ASR inactive) the output equals the input");
  const r = K.rec("cyton", 20, 5), a = K.run(r, { engine: { flags: { asr: false } } }), b = K.run(r, { engine: { flags: { asr: false, nlms: false } } });
  ok(a.outs.every(o => o.quality.asr === null) && JSON.stringify(a.outs) === JSON.stringify(b.outs), "A2 flag off: the pipeline reads xa unchanged (no ASR state, identical output)"); }
// A3 calibration never uses masked seconds
{ const fs = 125, rec = F.eeg({ device: "cyton", fs, seconds: 100, seed: 6 }), X = rec.data.filter((_, c) => c !== 8).map(x => Float32Array.from(x)), Xa = X.map(x => Float32Array.from(x));
  const bad = []; for (let t = 10; t < 90; t += 9) { bad.push([t, t + 2]); for (const c of [1, 4, 9]) for (let i = t * fs; i < (t + 2) * fs; i++) Xa[c][i] += 300 * Math.sin(i); }
  const clean = (a, b) => !bad.some(([u, v]) => b > u - 0.5 && a < v + 0.5);
  const A = Cl.ASR({ fs, channels: X.map((_, c) => c) }), B = Cl.ASR({ fs, channels: X.map((_, c) => c) }); A.processArray(X, clean); B.processArray(Xa, clean);
  const d = A.export().thr.map((v, i) => Math.abs(B.export().thr[i] / v - 1)); ok(Math.max(...d) < 0.1, "A3 artifacts inside masked seconds leave the thresholds within " + (100 * Math.max(...d)).toFixed(2) + "% (< 10%)"); }
// A4 NLMS
{ const fs = 250, n = fs * 40, rg = U.rng(4), ref = new Float64Array(n), accT = [], accM = [], h = Array.from({ length: 20 }, (_, i) => Math.exp(-i / 5) * (i % 2 ? -1 : 1) * 30);
  const l1 = U.lp(6, fs), l2 = U.lp(6, fs), hp = U.hp(0.5, fs);           // head movement: band-limited random motion (0.5-6 Hz)
  for (let i = 0; i < n; i++) ref[i] = 0.2 * hp.p(l2.p(l1.p(rg.normal())));
  const eeg = new Float32Array(n), art = new Float32Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let q = 0; q < 20 && i - q >= 0; q++) s += h[q] * ref[i - q]; art[i] = s * 100; eeg[i] = 5 * rg.normal() + art[i]; }
  const N = Cl.NLMS({ fs, channels: [0] }), xa = [eeg], xc = [new Float32Array(n)];
  for (let i = 0; i < n; i++) { N.pushRef(i / fs, 0, 0, 1 + ref[i]); N.process(i, xa, xc, i); }
  let pin = 0, pout = 0; for (let i = 20 * fs; i < n; i++) { pin += art[i] * art[i]; const res = xc[0][i] - (eeg[i] - art[i]); pout += res * res; }
  ok(10 * Math.log10(pin / pout) >= 10, "A4 NLMS reduces the accelerometer artifact by " + (10 * Math.log10(pin / pout)).toFixed(1) + " dB after 20 s (>= 10 dB)");
  const r = K.rec("cyton", 20, 7), a = K.run(r, { engine: { flags: { asr: false, nlms: false } } }), b = K.run(r, { engine: { flags: { asr: false } } });
  ok(JSON.stringify(a.outs) === JSON.stringify(b.outs), "A4 NLMS flag off (the default) -> identical output"); }
// A5 4-channel ASR on the Muse fixture
{ const fs = 256, rec = F.eeg({ device: "muse", fs, seconds: 100, seed: 8 }); F.clench(rec, 80); F.blink(rec, 85);
  const asr = Cl.ASR({ fs, channels: [0, 1, 2, 3] }), Y = asr.processArray(rec.data.map(x => Float32Array.from(x)));
  ok(asr.calibrated() && Y.every(y => y.every(v => isFinite(v))), "A5 4-channel ASR (Muse fixture) runs without NaN"); }
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
