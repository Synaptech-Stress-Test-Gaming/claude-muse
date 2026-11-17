/* Tests for engine/fixtures.js: determinism, band powers on the priors, injector ground truth, frames. Run: node engine/fixtures.test.js */
"use strict";
const U = require("./util.js"), F = require("./fixtures.js"), Fr = require("./frame.js");
const PRIORS = require("./priors.json");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }

// determinism
{
  const a = F.eeg({ device: "cyton", fs: 125, seconds: 10, seed: 4 }), b = F.eeg({ device: "cyton", fs: 125, seconds: 10, seed: 4 }), c = F.eeg({ device: "cyton", fs: 125, seconds: 10, seed: 5 });
  F.blink(a, 3); F.blink(b, 3); F.clench(a, 5); F.clench(b, 5);
  ok(a.data.every((x, i) => x.every((v, k) => v === b.data[i][k])), "same seed gives identical data (with injectors)");
  ok(a.data[0][100] !== c.data[0][100], "different seed gives different data");
  const e1 = F.ecg({ fs: 250, seed: 2, seconds: 20 }), e2 = F.ecg({ fs: 250, seed: 2, seconds: 20 }); ok(e1.data.every((v, i) => v === e2.data[i]), "ECG deterministic");
}
// band powers land on the priors (engine-like: 2 s windows, three 1 s Welch segments, ln per window, mean over windows and channels)
const SETS = { cyton: { thetaF: ["F3", "F4", "F8"], alphaP: ["P3", "P4", "P7", "P8", "O1", "O2"], betaLoC: ["C3", "C4", "P3", "P4"] }, muse: { thetaF: ["AF7", "AF8"], alphaP: ["TP9", "TP10"], betaLoC: ["TP9", "TP10"] } };
const BAND = { thetaF: [4, 8], alphaP: [8, 12], betaLoC: [13, 20] };
function featMeans(rec) {
  const fs = rec.fs, out = {};
  for (const k in SETS[rec.device]) { const acc = [];
    for (let w = 0; w + 2 * fs <= rec.n; w += Math.round(fs / 2)) { let s = 0; for (const nm of SETS[rec.device][k]) { const x = rec.data[rec.channels.indexOf(nm)]; let p = 0;
      for (let sg = 0; sg < 3; sg++) { const r = U.psd(x, fs, w + Math.round(sg * fs / 2), fs); p += U.bandPower(r.P, r.df, BAND[k][0], BAND[k][1]); } s += Math.log(p / 3); } acc.push(s / SETS[rec.device][k].length); }
    out[k] = U.mean(acc); }
  return out;
}
for (const [dev, fs] of [["cyton", 125], ["cyton", 250], ["muse", 256]]) {
  const m = featMeans(F.eeg({ device: dev, fs, seconds: 120, seed: 3 }));
  for (const k in m) ok(Math.abs(m[k] - PRIORS[dev].features[k].mu) < 0.3, dev + " fs " + fs + " " + k + " = " + m[k].toFixed(2) + " (prior " + PRIORS[dev].features[k].mu + " +/- 0.3)");
}
{ // focused fixture moves the features the right way
  const n = featMeans(F.eeg({ device: "cyton", fs: 125, seconds: 60, seed: 8 })), f = featMeans(F.eeg({ device: "cyton", fs: 125, seconds: 60, seed: 8, theta: 1.6, alpha: 0.6 }));
  ok(f.thetaF - n.thetaF > 0.3 && n.alphaP - f.alphaP > 0.3, "focused fixture: theta up " + (f.thetaF - n.thetaF).toFixed(2) + ", alpha down " + (n.alphaP - f.alphaP).toFixed(2));
}
// injector ground truth
{
  const rec = F.eeg({ device: "cyton", fs: 125, seconds: 20, seed: 1 }), before = rec.data.map(x => x.slice());
  const ev = F.blink(rec, 5.0)[0];
  ok(ev.type === "blink" && ev.onset === 5 && Math.abs(ev.offset - 5.25) < 1e-12, "blink truth onset/offset exact");
  const fp1 = rec.channels.indexOf("Fp1"), o1 = rec.channels.indexOf("O1");
  let maxIn = 0, maxOut = 0; for (let i = 0; i < rec.n; i++) { const d = Math.abs(rec.data[fp1][i] - before[fp1][i]), t = i / 125; if (t >= 5 && t <= 5.25) maxIn = Math.max(maxIn, d); else maxOut = Math.max(maxOut, d); }
  ok(Math.abs(maxIn - 150) < 3 && maxOut === 0, "blink only changes data inside its interval, peak 150 uV on Fp1 (" + maxIn.toFixed(1) + ")");
  let o1d = 0; for (let i = 0; i < rec.n; i++) o1d = Math.max(o1d, Math.abs(rec.data[o1][i] - before[o1][i])); ok(Math.abs(o1d - 7.5) < 0.5, "blink is 5% on O1");
  const cl = F.clench(rec, 10)[0]; ok(cl.sub === "clench" && cl.onset === 10 && Math.abs(cl.offset - 10.4) < 1e-12, "clench truth");
  const t7 = rec.channels.indexOf("T7"); let s = 0, k = 0; for (let i = Math.round(10.05 * 125); i < Math.round(10.35 * 125); i++) { const d = rec.data[t7][i] - before[t7][i]; s += d * d; k++; }
  ok(Math.abs(Math.sqrt(s / k) - 60) < 8, "clench is about 60 uV RMS on T7 (" + Math.sqrt(s / k).toFixed(1) + ")");
  const db = F.doubleBlink(rec, 14, 350); ok(db.length === 3 && db[2].type === "double_blink" && Math.abs(db[1].onset - 14.35) < 1e-12, "double blink truth");
  F.gap(rec, 17, 0.5); ok(rec.gapMask && rec.gapMask[Math.round(17.2 * 125)] === 1, "gap mask set");
  const fr = F.frames(rec, 40); let gapsSeen = 0, total = 0; fr.forEach(f => { Fr.validate(f); gapsSeen += f.gaps.length; total += f.samples[0].length; });
  ok(gapsSeen === 1 && total === rec.n - Math.round(0.5 * 125), "frames validate, carry one gap entry and skip the lost samples");
  const g = fr.find(f => f.gaps.length); ok(g.gaps[0].n === Math.round(0.5 * 125) && g.gaps[0].at === g.sampleIndex, "gap entry n and at are exact");
  ok(fr.some(f => f.accel && f.accel.t.length > 0), "frames carry accelerometer samples");
}
{ // ECG / rr series
  const rr = F.rrSeries({ n: 300, meanMs: 850, rmssdMs: 40, seed: 2 }); let s = 0; for (let i = 1; i < rr.length; i++) s += (rr[i] - rr[i - 1]) ** 2;
  ok(Math.abs(Math.sqrt(s / (rr.length - 1)) - 40) < 0.2 && Math.abs(U.mean(rr) - 850) < 1e-6, "rrSeries hits the RMSSD target within 0.2 ms");
  const e = F.ecg({ fs: 125, rrMs: rr, seconds: 60 }); ok(e.rTimes.length > 60 && e.data.length === 7500, "ECG fixture length and beats");
  const p = F.ppg({ fs: 64, rrMs: rr, seconds: 30 }); ok(p.data.length === 1920 && p.beats.length > 30, "PPG fixture");
}
{ // people are different, sessions jitter
  const a = F.person(1), b = F.person(2); ok(a.iaf !== b.iaf && a.iaf >= 8.5 && a.iaf <= 11.5 && a.apExp >= 0.8 && a.apExp <= 1.8, "person parameters in range and distinct");
  const s1 = F.session(a, 1), s2 = F.session(a, 2); ok(s1.gain.C3 !== s2.gain.C3 && Math.abs(s1.bandJitter.alpha) <= 0.15, "session jitter");
}
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
