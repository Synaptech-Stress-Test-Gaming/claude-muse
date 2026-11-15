/* Tests for engine/preproc.js. Run: node engine/preproc.test.js */
"use strict";
const P = require("./preproc.js");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }
const rms = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

for (const fs of [125, 250, 256]) {
  // DC offset of 20 mV removed to < 1 uV after 5 s
  { const p = P.create({ fs, nCh: 1 }); let mx = 0; for (let i = 0; i < fs * 8; i++) { p.run(0, 20000 + 3 * Math.sin(2 * Math.PI * 10 * i / fs)); if (i > fs * 5) mx = Math.max(mx, Math.abs(p.xb - 3 * Math.sin(2 * Math.PI * 10 * i / fs))); }
    ok(mx < 1, "fs " + fs + ": 20 mV DC removed (max residual " + mx.toFixed(3) + " uV after 5 s)"); }
  // 60 Hz 20 uV line reduced >= 30 dB (steady state), 10 Hz changed < 5%
  { const p = P.create({ fs, nCh: 1 }), ib = [], ia = [], i10 = [];
    for (let i = 0; i < fs * 40; i++) { p.run(0, 20 * Math.sin(2 * Math.PI * 60 * i / fs)); if (i > fs * 30) { ib.push(p.xb); ia.push(p.xa); } }
    const db = 20 * Math.log10(rms(ib) / (20 / Math.SQRT2)), da = 20 * Math.log10(rms(ia) / (20 / Math.SQRT2));
    ok(db <= -30, "fs " + fs + ": 60 Hz reduced " + db.toFixed(1) + " dB in xb (>= 30)");
    ok(da <= -30, "fs " + fs + ": 60 Hz reduced " + da.toFixed(1) + " dB in xa");
    const q = P.create({ fs, nCh: 1 }); for (let i = 0; i < fs * 10; i++) { q.run(0, 10 * Math.sin(2 * Math.PI * 10 * i / fs)); if (i > fs * 6) i10.push(q.xa); }
    const ch = Math.abs(rms(i10) / (10 / Math.SQRT2) - 1); ok(ch < 0.05, "fs " + fs + ": 10 Hz amplitude changed " + (100 * ch).toFixed(2) + "% (< 5%)"); }
}
// filter state resets after a gap
{ const p = P.create({ fs: 250, nCh: 2 }); for (let i = 0; i < 500; i++) { p.run(0, 1000 + i); p.run(1, 5); }
  p.reset(0); const y0 = p.run(0, 3000); ok(y0 === 0, "after reset the DC blocker restarts from the new level (no step)");
  p.run(1, 5); ok(Math.abs(p.xb) < 1e-9, "other channels keep their state"); }
{ const p = P.create({ fs: 125, nCh: 1, mains: 60 }); ok(p.useNotch, "notch used at 125 Hz for 60 Hz mains (60 <= 60.5)"); const q = P.create({ fs: 100, nCh: 1, mains: 60 }); ok(!q.useNotch, "notch skipped when mains > fs/2 - 2"); }
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
