/* Arousal meter tests. Run: node arousal.test.js */
"use strict";
const A = require("./arousal.js");
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const near = (a, b, t) => Math.abs(a - b) <= (t || 1e-9);

// spec examples
ok(near(A.hrComponent(85, 65, 105), 0.5), "H example = 0.5");
ok(near(A.combine({ hr: 0.7, hrv: 0.65, eeg: 0.6 }).score, 65.75), "score example = 65.75");
ok(A.hrComponent(200, 65, 105) === 1 && A.hrComponent(40, 65, 105) === 0, "H is clipped to 0..1");
ok(near(A.hrvComponent(31, 42, 20), 0.5), "V: halfway from baseline to low = 0.5");
ok(near(A.eegComponent(1.175, 0.85, 1.5), 0.5), "E: halfway = 0.5");
ok(A.hrComponent(null, 65, 105) === null && A.hrvComponent(NaN, 42, 20) === null, "invalid input gives null, not 0");
let threw = 0; try { A.hrComponent(70, 100, 100); } catch (e) { threw++; } try { A.hrvComponent(30, 20, 20); } catch (e) { threw++; } try { A.eegComponent(1, 2, 1); } catch (e) { threw++; }
ok(threw === 3, "invalid calibrations throw");

// RMSSD
ok(near(A.rmssd([800, 810, 790, 800]), Math.sqrt((100 + 400 + 100) / 3)), "RMSSD of successive differences");
ok(A.rmssd([800]) === null && A.rmssd([]) === null, "RMSSD needs 2 intervals");
ok(A.medianRatio([1, 5, 2, null, NaN]) === 2 && A.medianRatio([1, 3, 2, 4]) === 2.5 && A.medianRatio([null]) === null, "median ignores invalid channels");
ok(near(A.betaAlpha(2, 4), 2, 1e-6) && isFinite(A.betaAlpha(0, 1)), "beta/alpha with epsilon");

// partial scores
const p = A.combine({ hr: 1, hrv: null, eeg: 0 });
ok(p.partial && near(p.score, 100 * 0.4 / 0.65) && near(p.confidence, 0.65) && p.used.join() === "hr,eeg", "partial score renormalises weights and flags it");
ok(A.combine({ hr: null, hrv: null, eeg: null }) === null, "no valid component = no score");

// labels
ok(A.label(0) === "Low arousal" && A.label(20) === "Low arousal" && A.label(21) === "Mild arousal" && A.label(50) === "Moderate arousal" && A.label(70) === "High arousal" && A.label(95) === "Very high arousal", "display labels");

// meter end to end
const M = A.makeArousalMeter({ minSamples: 10 });
ok(!M.ready() && M.update({ hr: 80 }, 0).stress_score === null, "no score before baseline");
M.startBaseline(); for (let i = 0; i < 12; i++) M.pushBaseline({ hr: 65, hrv: 42, ratio: 0.85 });
ok(M.finishBaseline() && M.ready() && M.base.hr === 65 && M.refs.hrHigh === 105 && near(M.refs.hrvLow, 21) && near(M.refs.ratioHigh, 1.4875), "baseline medians and default references");
let r = M.update({ hr: 65, hrv: 42, ratio: 0.85 }, 1000);
ok(near(r.stress_score, 0) && r.score_valid && !r.partial, "baseline reading scores 0");
r = M.update({ hr: 105, hrv: 21, ratio: 1.4875 }, 2000);
ok(near(r.stress_score, 25) && near(r.components.heart_rate, 1), "smoothing: first new valid reading moves 25% of the way");
for (let i = 0; i < 60; i++) r = M.update({ hr: 105, hrv: 21, ratio: 1.4875 }, 3000 + i * 1000);
ok(r.stress_score > 99 && r.label === "Very high arousal", "converges to 100 and labels it");
const before = M.value;
r = M.update({ hr: null, hrv: null, ratio: null, motionOk: false }, 63000);
ok(M.value === before && r.score_valid === true && r.components.heart_rate === null && r.signal_quality.motion_valid === false, "rejected measurement keeps the last score and does not smooth in a zero");
r = M.result(63000 + 6000);
ok(r.stale === true && r.score_valid === false, "no valid update for 5 s marks the score stale");
r = M.update({ hr: 105, hrv: null, ratio: null }, 70000);
ok(r.partial && near(r.confidence, 0.4) && r.score_valid, "heart rate alone gives a reduced-confidence partial score");

// baseline without HRV: that component is skipped
const M2 = A.makeArousalMeter({ minSamples: 10 }); M2.startBaseline(); for (let i = 0; i < 12; i++) M2.pushBaseline({ hr: 70, hrv: null, ratio: 1 });
M2.finishBaseline(); r = M2.update({ hr: 90, hrv: 20, ratio: 1.5 }, 0);
ok(M2.base.hrv === undefined && r.components.hrv_decrease === null && r.partial, "signal with too little baseline data is skipped");
const M3 = A.makeArousalMeter({ minSamples: 10 }); M3.startBaseline(); M3.pushBaseline({ hr: 70 });
ok(!M3.finishBaseline() && !M3.ready() && M3.error, "too little baseline data fails with a message");

console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
