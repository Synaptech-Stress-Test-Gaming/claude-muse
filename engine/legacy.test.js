/* Tests for engine/legacy.js. Run: node engine/legacy.test.js */
"use strict";
const U = require("./util.js"), F = require("./fixtures.js"), Lg = require("./legacy.js");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }

// transcription of the panel's three formulas (panel/gamelink.js loop, panel/focus.js pctOf, gamelink.js finishCal)
const panelF = (am, bm) => Math.log((bm + 1e-3) / (am + 1e-3));
const panelPct = f => (f.ema == null || f.lo == null || f.hi == null || f.hi - f.lo < 0.05) ? null : Math.max(0, Math.min(100, 25 + (f.ema - f.lo) / (f.hi - f.lo) * 50));
function q(s, x) { const p = (s.length - 1) * x, i = Math.floor(p), f = p - i; return s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * f; }
function panelCal(vals) { const s = vals.slice().sort((a, b) => a - b), q1 = q(s, .25), q3 = q(s, .75), iqr = q3 - q1, inl = s.filter(v => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
  let lo = q(inl, .1), hi = q(inl, .9); if (hi - lo < 0.4) { const m = (lo + hi) / 2; lo = m - 0.2; hi = m + 0.2; } return { lo, hi }; }

const fs = 125, rec = F.eeg({ device: "cyton", fs, seconds: 40, seed: 5 }), eeg = rec.channels.map((_, i) => i);
const L = Lg.LegacyFocus({ fs }); let ema = null, fast = null; const fasts = []; let maxErr = 0;
L.startCal(5);
for (let t = 1.25; t <= 30; t += 0.25) {
  const i1 = Math.round(t * fs), x = new Float32Array(fs);
  for (let k = 0; k < fs; k++) { let s = 0; for (const c of eeg) s += rec.data[c][i1 - fs + k]; x[k] = s / eeg.length; }
  L.hop(x, true, t);
  const { P, df } = U.psd(x, fs), F2 = panelF(U.bandPower(P, df, 8, 13), U.bandPower(P, df, 13, 30));
  ema = ema == null ? F2 : ema + 0.08 * (F2 - ema); fast = fast == null ? F2 : fast + 0.22 * (F2 - fast); if (t <= 15 + 1e-9) fasts.push(fast);
  maxErr = Math.max(maxErr, Math.abs(ema - L.ema), Math.abs(fast - L.fast));
}
ok(maxErr < 1e-12, "matches the panel formula (F = ln((beta+1e-3)/(alpha+1e-3)), ema 0.08, fast 0.22) on a fixture");
const cal = panelCal(fasts);
ok(L.lo != null && Math.abs(L.lo - cal.lo) < 0.05 && Math.abs(L.hi - cal.hi) < 0.05, "calibrate() replicates finishCal (lo " + L.lo.toFixed(3) + " / hi " + L.hi.toFixed(3) + ")");
L.ema = L.lo; ok(Math.abs(L.pct() - 25) < 1e-9, "pct = 25 at the low baseline"); L.ema = L.hi; ok(Math.abs(L.pct() - 75) < 1e-9, "pct = 75 at the high baseline");
ok(L.pct() === panelPct(L), "pct() equals the panel's pctOf");
const before = L.ema; const x = new Float32Array(fs).map((_, k) => 50 * Math.sin(2 * Math.PI * 20 * k / fs)); L.hop(x, false, 31);
ok(L.ema === before, "held (no update) while the motion gate is not VALID");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
