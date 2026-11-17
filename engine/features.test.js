/* Tests for engine/features.js. Run: node engine/features.test.js */
"use strict";
const U = require("./util.js"), Fx = require("./fixtures.js"), Ft = require("./features.js"), Mk = require("./mask.js"), Ev = require("./events.js"), P = require("./preproc.js");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }

function setup(rec, maskFn) {
  const fs = rec.fs, C = rec.channels.length, eeg = rec.channels.map((_, i) => i).filter(i => i !== rec.ecgChannel);
  const pp = P.create({ fs, nCh: C }), xa = rec.data.map(() => new Float32Array(rec.n));
  for (let i = 0; i < rec.n; i++) for (let c = 0; c < C; c++) { pp.run(c, rec.data[c][i]); xa[c][i] = pp.xa; }
  const G = Ev.groupsFor(rec.device, rec.channels, eeg), mask = Mk.create({ fs, device: rec.device, channels: rec.channels, groups: G, eegIdx: eeg });
  if (maskFn) maskFn(mask);
  const ft = Ft.create({ fs, device: rec.device, channels: rec.channels, eegIdx: eeg });
  const getSeg = (c, a, b) => xa[c].subarray(a, b);
  const win = (t0, t1) => { const sets = {}; for (const k in ft.sets) sets[k] = mask.windowInfo(t0, t1, ft.sets[k], ft.minCh); return { sets }; };
  return { ft, getSeg, win, mask, xa };
}
// band powers of known sines within 5%
for (const fs of [125, 250, 256]) {
  const dev = fs === 256 ? "muse" : "cyton", chs = dev === "muse" ? Fx.MUSE_CH : Fx.CYTON_CH, n = fs * 10;
  const rec = { device: dev, fs, channels: chs, n, data: chs.map(() => { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = 10 * Math.sin(2 * Math.PI * 6 * i / fs) + 6 * Math.sin(2 * Math.PI * 10 * i / fs + 1) + 4 * Math.sin(2 * Math.PI * 16.5 * i / fs + 2); return x; }), ecgChannel: -1 };
  const s = setup(rec), f = s.ft.compute(s.win(6, 8), s.getSeg);
  const e = (x, want) => Math.abs(Math.exp(x) / want - 1);
  ok(e(f.thetaF.x, 50) < 0.05 && e(f.alphaP.x, 18) < 0.05 && e(f.betaLoC.x, 8) < 0.05, "fs " + fs + ": theta/alpha/betaLo powers " + [f.thetaF.x, f.alphaP.x, f.betaLoC.x].map(v => Math.exp(v).toFixed(2)).join("/") + " (50/18/8 within 5%)");
}
// one masked channel: the set feature comes from the others
{ const rec = Fx.eeg({ device: "cyton", fs: 125, seconds: 20, seed: 3 });
  const a = setup(rec), b = setup(rec, m => m.add({ type: "electrode_pop", onset: 10.2, chanIdx: [rec.channels.indexOf("O1")] }));
  const fa = a.ft.compute(a.win(10, 12), a.getSeg), fb = b.ft.compute(b.win(10, 12), b.getSeg);
  ok(fb.alphaP.valid && fb.alphaP.nCh === 5 && fa.alphaP.nCh === 6, "a window with one masked channel still yields alphaP from the other 5");
  ok(Math.abs(fb.alphaP.x - fa.alphaP.x) < 0.3, "and the value stays close (" + fa.alphaP.x.toFixed(3) + " vs " + fb.alphaP.x.toFixed(3) + ")"); }
// IAF and aperiodic exponent
for (const [dev, fs] of [["cyton", 125], ["muse", 256]]) {
  const rec = Fx.eeg({ device: dev, fs, seconds: 400, seed: 9, iaf: 9.4, apExp: 1.3, theta: 0.01, betaLo: 0.01 });
  const s = setup(rec);
  for (let t = 2; t + 2 <= 400; t += 0.25) { const f = s.ft.compute(s.win(t, t + 2), s.getSeg); s.ft.accumulateIaf(f, 0.25); }
  const est = s.ft.iafEstimate();
  ok(est.valid && Math.abs(est.hz - 9.4) <= 0.3, dev + ": IAF 9.4 Hz recovered as " + est.hz.toFixed(2) + " Hz (+/- 0.3), peak residual " + est.peak.toFixed(2));
  ok(Math.abs(est.apExp - 1.3) <= 0.15, dev + ": aperiodic exponent 1.3 recovered as " + est.apExp.toFixed(3) + " (+/- 0.15)");
}
// masked segments never contribute: a 500 uV burst inside a masked stretch
{ const rec = Fx.eeg({ device: "cyton", fs: 125, seconds: 20, seed: 4 }), rec2 = Fx.eeg({ device: "cyton", fs: 125, seconds: 20, seed: 4 });
  const r = U.rng(3); for (const nm of ["P3", "P4", "O1", "O2", "P7", "P8", "C3", "C4", "F3", "F4", "F8"]) { const c = rec2.channels.indexOf(nm); for (let i = Math.round(11.05 * 125); i < Math.round(11.4 * 125); i++) rec2.data[c][i] += 500 * r.normal(); }
  const mf = m => m.addInt(11.0, 11.5, "muscle", null);
  const a = setup(rec, mf), b = setup(rec2, mf);
  const fa = a.ft.compute(a.win(10, 12), a.getSeg), fb = b.ft.compute(b.win(10, 12), b.getSeg);
  const d = Math.max(Math.abs(fa.thetaF.x - fb.thetaF.x), Math.abs(fa.alphaP.x - fb.alphaP.x), Math.abs(fa.betaLoC.x - fb.betaLoC.x));
  ok(fa.alphaP.valid && d < 0.02, "a 500 uV burst inside a masked stretch changes the features by " + d.toFixed(4) + " ln (< 0.02)"); }
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
