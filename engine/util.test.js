/* Tests for engine/util.js. Run: node engine/util.test.js */
"use strict";
const U = require("./util.js");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }

// FFT peak
{
  const fs = 256, n = 256, re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.sin(2 * Math.PI * 10 * i / fs);
  U.fft(re, im);
  let best = 0, bv = -1; for (let k = 0; k <= n / 2; k++) { const m = Math.hypot(re[k], im[k]); if (m > bv) { bv = m; best = k; } }
  ok(best === 10, "FFT of a 10 Hz sine at fs 256 peaks in bin 10 (got " + best + ")");
}
// PSD band power of a 20 uV-peak sine = 200 uV^2
for (const fs of [125, 250, 256]) {
  const n = 2 * fs, x = new Float64Array(n); for (let i = 0; i < n; i++) x[i] = 20 * Math.sin(2 * Math.PI * 10.3 * i / fs + 0.4);
  const { P, df } = U.psd(x, fs), p = U.bandPower(P, df, 6, 15);
  ok(Math.abs(p - 200) / 200 < 0.03, "psd band power of a 20 uV sine at fs " + fs + " = " + p.toFixed(2) + " (200 +/- 3%)");
}
// Jacobi on a random symmetric 16x16
{
  const r = U.rng(7), n = 16, A = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) { const v = r.normal(); A[i * n + j] = v; A[j * n + i] = v; }
  const { values, vectors } = U.jacobiEig(A, n);
  let err = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { let s = 0; for (let k = 0; k < n; k++) s += vectors[i * n + k] * values[k] * vectors[j * n + k]; err = Math.max(err, Math.abs(s - A[i * n + j])); }
  ok(err < 1e-9, "Jacobi reconstructs a random symmetric 16x16 (max error " + err.toExponential(2) + ")");
  let asc = true; for (let k = 1; k < n; k++) if (values[k] < values[k - 1]) asc = false; ok(asc, "eigenvalues ascending");
  const S = U.matMul(A, U.transpose(A, n), n); S[0] += 1; const L = U.cholesky(S, n); const R = U.matMul(L, U.transpose(L, n), n);
  let e2 = 0; for (let i = 0; i < n * n; i++) e2 = Math.max(e2, Math.abs(R[i] - S[i])); ok(e2 < 1e-9, "Cholesky reconstructs");
  const P = U.pinvSym(S, n), I = U.matMul(P, S, n); let e3 = 0; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) e3 = Math.max(e3, Math.abs(I[i * n + j] - (i === j ? 1 : 0)));
  ok(e3 < 1e-6, "pinvSym of a full-rank matrix is its inverse");
}
// notch
for (const fs of [125, 256]) {
  const f = U.notch(60, fs, 30);
  const g60 = 20 * Math.log10(f.gainAt(60, fs)), g10 = 20 * Math.log10(f.gainAt(10, fs));
  ok(g60 <= -30 && Math.abs(g10) <= 0.5, "notch at fs " + fs + ": 60 Hz " + g60.toFixed(1) + " dB, 10 Hz " + g10.toFixed(3) + " dB");
  // also by simulation
  const g = U.notch(60, fs, 30); let pin = 0, pout = 0; for (let i = 0; i < fs * 30; i++) { const x = Math.sin(2 * Math.PI * 60 * i / fs), y = g.p(x); if (i > fs * 20) { pin += x * x; pout += y * y; } }
  ok(10 * Math.log10(pout / pin) <= -30, "notch simulation at fs " + fs + " attenuates 60 Hz >= 30 dB (steady state)");
}
// rng
{
  const a = U.rng(1), b = U.rng(1), xa = [], xb = []; for (let i = 0; i < 100; i++) { xa.push(a.next(), a.normal()); xb.push(b.next(), b.normal()); }
  ok(JSON.stringify(xa) === JSON.stringify(xb), "rng(1) is reproducible");
  const c = U.rng(2); let s = 0, s2 = 0; for (let i = 0; i < 20000; i++) { const v = c.normal(); s += v; s2 += v * v; }
  ok(Math.abs(s / 20000) < 0.03 && Math.abs(s2 / 20000 - 1) < 0.05, "normal() has mean 0 and variance 1");
}
// stats
ok(U.median([3, 1, 2]) === 2 && U.mad([1, 2, 3, 4, 100]) === 1, "median and MAD");
{ const r = U.rng(3), a = []; for (let i = 0; i < 50000; i++) a.push(r.normal()); ok(Math.abs(U.kurtosis(a) - 3) < 0.1, "Pearson kurtosis of Gaussian is about 3"); }
{ const rm = U.RunningMedian(5); [5, 1, 4, 2, 3, 100].forEach(v => rm.push(v)); ok(rm.median() === 3, "RunningMedian drops old values"); }
{ const g = U.goertzelPower(Float64Array.from({ length: 250 }, (_, i) => 10 * Math.sin(2 * Math.PI * 50 * i / 250)), 50, 250); ok(Math.abs(g - 50) < 1, "Goertzel power of a 10 uV sine = 50 uV^2 (" + g.toFixed(2) + ")"); }
{ const f = U.linfit([0, 1, 2, 3], [1, 3, 5, 7]); ok(Math.abs(f.slope - 2) < 1e-12 && Math.abs(f.intercept - 1) < 1e-12, "linfit"); }
{ const d = U.dcBlock(0.5, 250); let y = 0; for (let i = 0; i < 1250; i++) y = d.p(20000 + Math.sin(i)); ok(Math.abs(y) < 5, "dcBlock removes a 20 mV offset"); }

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
