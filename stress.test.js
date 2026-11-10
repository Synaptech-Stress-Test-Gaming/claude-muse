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

if (typeof document !== "undefined") { document.body.style.cssText = "font:14px monospace;white-space:pre;padding:16px;background:#111;color:#ddd"; document.body.textContent = out.join("\n") + "\n\n" + (fails ? fails + " FAILED" : "ALL PASSED"); }
else { console.log(out.join("\n")); console.log(fails ? fails + " FAILED" : "ALL PASSED"); process.exit(fails ? 1 : 0); }
