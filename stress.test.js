/* Stress meter core tests. Run: node stress.test.js  (or open stress-test.html in a browser) */
"use strict";
const St = (typeof require !== "undefined" && typeof module !== "undefined") ? require("./stress.js") : window.Stress;
const out = []; let fails = 0;
function ok(c, msg) { out.push((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }
const near = (a, b, t) => Math.abs(a - b) <= t;
const sine = (f, amp, n = 512) => Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * f * i / 256));

// spectrum: power lands in the right band
const p10 = St.bandPowers(sine(10, 20)), p20 = St.bandPowers(sine(20, 20)), p38 = St.bandPowers(sine(38, 20));
ok(p10.alpha > 20 * p10.beta && p10.alpha > 20 * p10.gamma, "10 Hz sine is alpha");
ok(p20.beta > 20 * p20.alpha && p20.beta > 20 * p20.gamma, "20 Hz sine is beta");
ok(p38.gamma > 20 * p38.alpha && p38.gamma > 20 * p38.beta, "38 Hz sine is gamma");
ok(near(Math.sqrt(p10.alpha / p20.beta), 1, 0.1), "equal amplitude gives similar band power");

// features: more beta -> higher ln(beta/alpha); more 38 Hz -> more tension
const calm = St.eegFeatures([sine(10, 20).map((v, i) => v + 3 * Math.sin(2 * Math.PI * 20 * i / 256) + 1 * Math.sin(2 * Math.PI * 38 * i / 256))], false);
const tense = St.eegFeatures([sine(10, 20).map((v, i) => v + 12 * Math.sin(2 * Math.PI * 20 * i / 256) + 8 * Math.sin(2 * Math.PI * 38 * i / 256))], false);
ok(tense.ratio > calm.ratio + 1 && tense.tension > calm.tension + 1, "more beta and face tension raise both features");
ok(St.eegFeatures([sine(10, 20)], true).ratio === null && St.eegFeatures([], false).tension === null, "artifact rejection and no-sensor give no value");

// meter: baseline then score
const r = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5; })();
const M = St.makeMeter({ minSamples: 10, ema: 1 });
ok(M.score({ hr: 70 }) === null && !M.ready(), "no score before calibration");
M.startCal();
for (let i = 0; i < 30; i++) M.push({ hr: 70 + r() * 4, ratio: -1 + r() * 0.3, tension: -3 + r() * 0.3 });
ok(M.finishCal() && M.ready(), "calibration with enough samples succeeds");
const calmV = M.score({ hr: 70, ratio: -1, tension: -3 });
ok(near(calmV, 20, 6), "your calm baseline scores about 20 (" + calmV.toFixed(1) + ")");
const midV = M.score({ hr: 80, ratio: -0.7, tension: -2.7 });
const highV = M.score({ hr: 110, ratio: 0, tension: -2 });
ok(midV > calmV + 10 && highV > midV && highV >= 99, "higher heart rate, beta/alpha and tension raise the score (" + midV.toFixed(0) + ", " + highV.toFixed(0) + ")");
ok(M.score({ hr: 55, ratio: -1.5, tension: -3.5 }) < 10, "calmer than baseline scores below 10");

// works without a heart rate signal: weights renormalise
const M2 = St.makeMeter({ minSamples: 10, ema: 1 });
M2.startCal(); for (let i = 0; i < 20; i++) M2.push({ hr: null, ratio: -1 + r() * 0.3, tension: -3 + r() * 0.3 });
ok(M2.finishCal() && !M2.base.hr, "calibrates without heart rate");
ok(M2.score({ hr: null, ratio: 0, tension: -2 }) > 90 && M2.used.join() === "ratio,tension", "scores from the signals that exist");
const M3 = St.makeMeter({ minSamples: 10 }); M3.startCal(); for (let i = 0; i < 5; i++) M3.push({ hr: 70, ratio: -1, tension: -3 });
ok(M3.finishCal() === false && !M3.ready(), "too few samples fails safely");
// flat baseline: sd floor stops a tiny change from exploding
const M4 = St.makeMeter({ minSamples: 10, ema: 1 }); M4.startCal(); for (let i = 0; i < 20; i++) M4.push({ hr: 70, ratio: -1, tension: -3 }); M4.finishCal();
ok(M4.score({ hr: 71, ratio: -0.98, tension: -2.98 }) < 30, "a tiny change on a flat baseline stays low");

// two-phase calibration: learns which signals respond for this person
{
  const noise = () => r() * 0.2;
  const T = St.makeMeter({ minSamples: 10, ema: 1 });
  T.startCal(); for (let i = 0; i < 30; i++) T.push({ hr: 70 + r() * 2, ratio: -1 + noise(), tension: -3 + noise() });
  T.endPhase(); T.startPhase("stress");
  for (let i = 0; i < 30; i++) T.push({ hr: 100 + r() * 2, ratio: -1 + noise(), tension: -2 + noise() }); // hr and tension respond, beta/alpha does not
  T.endPhase();
  ok(T.build() && T.model.mode === "two-point", "two-point model is built from calm + task");
  const st = Object.fromEntries(T.report.map(x => [x.key, x.status]));
  ok(st.hr === "used" && st.tension === "used" && st.ratio === "ignored", "responsive signals are used, the unresponsive one is ignored (" + JSON.stringify(st) + ")");
  ok(near(T.score({ hr: 70, ratio: -1, tension: -3 }), 20, 4), "calm scores about 20 in two-point mode");
  ok(near(T.score({ hr: 100, ratio: -1, tension: -2 }), 80, 4), "task level scores about 80");
  ok(near(T.score({ hr: 85, ratio: -1, tension: -2.5 }), 50, 6), "halfway between scores about 50");
  ok(T.score({ hr: 140, ratio: -1, tension: -1 }) === 100 && T.score({ hr: 40, ratio: -1, tension: -4 }) < 5, "scores clamp to 0..100");
  ok(!("ratio" in T.z) && T.used.join() === "hr,tension", "ignored signal does not contribute");
  // task changed nothing: fall back and say so
  const W = St.makeMeter({ minSamples: 10, ema: 1 });
  W.startCal(); for (let i = 0; i < 30; i++) W.push({ hr: 70 + r() * 2, ratio: -1 + noise(), tension: -3 + noise() }); W.endPhase();
  W.startPhase("stress"); for (let i = 0; i < 30; i++) W.push({ hr: 70 + r() * 2, ratio: -1 + noise(), tension: -3 + noise() }); W.endPhase();
  ok(W.build() && W.model.mode === "baseline-only" && W.model.weak === true, "a task that changes nothing falls back to baseline-only and is flagged weak");
  // task with a missing heart rate during the task still works with the rest
  const H = St.makeMeter({ minSamples: 10, ema: 1 });
  H.startCal(); for (let i = 0; i < 30; i++) H.push({ hr: 70 + r() * 2, ratio: -1 + noise(), tension: -3 + noise() }); H.endPhase();
  H.startPhase("stress"); for (let i = 0; i < 30; i++) H.push({ hr: null, ratio: 0, tension: -3 + noise() }); H.endPhase();
  H.build(); const hs = Object.fromEntries(H.report.map(x => [x.key, x.status]));
  ok(hs.hr === "no data in task" && hs.ratio === "used" && H.model.mode === "two-point", "missing signal in the task is skipped, others still used");
}
// arithmetic task
{
  const k = St.makeTask(1022, 13);
  ok(k.prompt() === "1022 - 13" && k.answer("1009") && k.answer(996) && k.cur === 996 && k.correct === 2, "task accepts correct answers and advances");
  ok(!k.answer(5) && k.cur === 1022 && k.wrong === 1, "a wrong answer sends you back to the start");
}

// pulse beats, heart rate variability, asymmetry
{
  const fs = 64, beatsT = []; let t = 0.5;
  for (let i = 0; i < 40; i++) { beatsT.push(t); t += i % 2 ? 0.85 : 0.75; }              // IBIs alternate 750/850 ms: successive difference 100 ms
  const x = new Float32Array(fs * 28);
  for (let i = 0; i < x.length; i++) { let v = 0; for (const b of beatsT) { const d = i / fs - b; if (Math.abs(d) < 0.4) v += Math.exp(-d * d / (2 * 0.06 * 0.06)); } x[i] = v - 0.15; }
  const found = St.findBeats(x, fs).map(p => p / fs), ibis = St.ibisFromBeats(found), r = St.rmssd(ibis);
  ok(found.length >= 30 && near(found[1] - found[0], 0.75, 0.03), "finds the beats in a pulse signal (" + found.length + ")");
  ok(r != null && near(r, 100, 20), "RMSSD recovers about 100 ms from alternating intervals (" + (r && r.toFixed(0)) + ")");
  ok(St.rmssd([800, 810, 790]) === null, "RMSSD needs enough intervals");
  const ib = St.ibisFromBeats([0, 0.2, 1.0, 1.8, 3.9, 4.7]).map(Math.round).join();
  ok(ib === "800,800,800", "impossible and jumpy intervals are dropped (" + ib + ")");
  const w7 = sine(10, 10), w8 = sine(10, 20);
  ok(near(St.faa(w7, w8), Math.log(4), 0.1), "frontal asymmetry is ln(alpha AF8) - ln(alpha AF7)");
}
// signals that move opposite to the usual direction (HRV falls, asymmetry can go either way)
{
  const M = St.makeMeter({ minSamples: 10, ema: 1 }), q = () => r() * 0.2;
  M.startCal(); for (let i = 0; i < 30; i++) M.push({ hr: 70 + r() * 2, hrv: 60 + r() * 4, faa: 0.1 + q() }); M.endPhase();
  M.startPhase("stress"); for (let i = 0; i < 30; i++) M.push({ hr: 95 + r() * 2, hrv: 25 + r() * 4, faa: -0.4 + q() }); M.endPhase();
  M.build(); const st = Object.fromEntries(M.report.map(x => [x.key, x]));
  ok(st.hrv.status === "used" && st.faa.status === "used" && st.hr.status === "used", "falling HRV and shifted asymmetry are used (two-sided)");
  ok(near(M.score({ hr: 70, hrv: 60, faa: 0.1 }), 20, 5) && near(M.score({ hr: 95, hrv: 25, faa: -0.4 }), 80, 5), "calm scores about 20 and task level about 80 when signals fall");
  // baseline-only mode ignores signals with no known direction and flips HRV
  const B = St.makeMeter({ minSamples: 10, ema: 1 }); B.startCal(); for (let i = 0; i < 30; i++) B.push({ hrv: 60 + r() * 4, faa: 0.1 + q() }); B.finishCal();
  ok(B.score({ hrv: 20, faa: 5 }) > 80 && B.used.join() === "hrv", "baseline-only: lower HRV raises the score; asymmetry is not used without a task");
}

if (typeof document !== "undefined") { document.body.style.cssText = "font:14px monospace;white-space:pre;padding:16px;background:#111;color:#ddd"; document.body.textContent = out.join("\n") + "\n\n" + (fails ? fails + " FAILED" : "ALL PASSED"); }
else { console.log(out.join("\n")); console.log(fails ? fails + " FAILED" : "ALL PASSED"); process.exit(fails ? 1 : 0); }
