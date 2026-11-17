/* Arousal meter tests. Run: node arousal.test.js  (or open arousal-test.html in a browser) */
"use strict";
const A = (typeof require !== "undefined" && typeof module !== "undefined") ? require("./arousal.js") : window.Arousal;
const out = []; let fails = 0;
function ok(c, msg) { out.push((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }
const near = (a, b, t) => Math.abs(a - b) <= t;
const DT = 0.25;
const run = (M, f, sec) => { let v = null; for (let i = 0; i < Math.round(sec / DT); i++) v = M.push(typeof f === "function" ? f(i) : f, DT); return v; };
const REST = { hr: 70, tension: -4.5, motion: 3 };

// resting baseline is automatic
{
  const M = A.makeMeter();
  ok(M.state === "waiting" && M.value === null, "starts in 'waiting' with no value");
  run(M, REST, 5);
  ok(M.state === "resting" && M.value === null && near(M.restLeft, 10, 0.5), "first seconds are the resting baseline (countdown " + (M.restLeft && M.restLeft.toFixed(1)) + ")");
  run(M, REST, 11);
  ok(M.state === "live" && M.value < 3, "goes live by itself after the rest period, near 0 at rest (" + M.value.toFixed(1) + ")");
  ok(near(M.parts.hr.base, 70, 0.5) && near(M.parts.tension.base, -4.5, 0.05), "resting values are stored per signal");
}
// each signal moves the score, and it responds within about 2 seconds
{
  const M = A.makeMeter(); run(M, REST, 17);
  const v1 = run(M, { hr: 95, tension: -4.5, motion: 3 }, 3);
  ok(v1 > 60 && v1 < 80, "heart rate +25 bpm alone gives a clearly raised score (" + v1.toFixed(0) + ")");
  const M2 = A.makeMeter(); run(M2, REST, 17);
  const after1s = run(M2, { hr: 70, tension: -2.5, motion: 3 }, 1), after3s = run(M2, { hr: 70, tension: -2.5, motion: 3 }, 2);
  ok(after1s > 25 && after3s > 50 && after3s < 70, "a jaw clench shows within 1 s and settles around 58 (" + after1s.toFixed(0) + ", " + after3s.toFixed(0) + ")");
  const M3 = A.makeMeter(); run(M3, REST, 17);
  const v3 = run(M3, { hr: 70, tension: -4.5, motion: 24 }, 3);
  ok(v3 > 40 && v3 < 60, "8x resting movement alone raises the score (" + v3.toFixed(0) + ")");
  const M4 = A.makeMeter(); run(M4, REST, 17);
  ok(run(M4, { hr: 100, tension: -2.5, motion: 30 }, 4) > 97, "everything raised together reaches the top");
  ok(run(M4, REST, 5) < 5, "and it comes back down at rest");
}
// missing signals: the meter works with what it has, and a late signal gets its own baseline
{
  const M = A.makeMeter(); run(M, { hr: null, tension: -4.5, motion: null }, 17);
  ok(M.state === "live" && M.used().join() === "tension", "works with muscle tension only (no pulse, no accelerometer)");
  ok(run(M, { hr: null, tension: -2.9, motion: null }, 3) > 90, "one signal alone can fill the scale");
  run(M, { hr: 80, tension: -4.5, motion: null }, 5);
  ok(M.parts.hr.base === null && M.state === "live" && M.restLeft > 0, "a signal that appears later is baselined on its own without stopping the meter");
  run(M, { hr: 80, tension: -4.5, motion: null }, 11);
  ok(near(M.parts.hr.base, 80, 0.5) && M.used().join() === "hr,tension", "and then joins in");
  const N = A.makeMeter(); run(N, { hr: null, tension: null, motion: null }, 20);
  ok(N.state === "waiting" && N.value === null, "no signals at all: stays waiting, never invents a value");
}
// robustness
{
  const M = A.makeMeter(); run(M, i => ({ hr: i % 13 === 0 ? 140 : 70, tension: i % 17 === 0 ? -1 : -4.5, motion: 3 }), 17);
  ok(near(M.parts.hr.base, 70, 1) && near(M.parts.tension.base, -4.5, 0.1), "blinks and glitches during the rest period do not shift the baseline (median)");
  run(M, { hr: 250, tension: -4.5, motion: 3 }, 2);
  ok(M.parts.hr.v === null, "impossible heart rates are ignored");
  const D = A.makeMeter(); run(D, REST, 17); run(D, { hr: 62, tension: -4.5, motion: 3 }, 120);
  ok(D.parts.hr.base < 65, "if you relax below the baseline, the resting value follows you down (" + D.parts.hr.base.toFixed(1) + ")");
  ok(run(D, { hr: 70, tension: -4.5, motion: 3 }, 3) > 10, "so returning to the old level now reads as slightly raised");
  const Nz = A.makeMeter(); let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5;
  run(Nz, () => ({ hr: 70 + rnd() * 3, tension: -4.5 + rnd() * 0.5, motion: 3 + rnd() * 1.5 }), 17);
  let mx = 0; for (let i = 0; i < 120; i++) mx = Math.max(mx, Nz.push({ hr: 70 + rnd() * 3, tension: -4.5 + rnd() * 0.5, motion: 3 + rnd() * 1.5 }, DT));
  ok(mx < 8, "ordinary resting noise stays near zero (noise floor): max " + mx.toFixed(1));
  D.rebaseline(); ok(D.state === "waiting" && D.value === null && D.parts.hr.base === null, "rebaseline starts over");
}
// signal helpers
{
  const sine = (f, amp) => Array.from({ length: 512 }, (_, i) => amp * Math.sin(2 * Math.PI * f * i / 256));
  const calm = A.tensionOf([sine(10, 20).map((v, i) => v + 1 * Math.sin(2 * Math.PI * 38 * i / 256))]);
  const tense = A.tensionOf([sine(10, 20).map((v, i) => v + 15 * Math.sin(2 * Math.PI * 38 * i / 256))]);
  ok(tense > calm + 3 && A.tensionOf([]) === null, "muscle tension rises with 30-44 Hz power; none without a sensor");
  const fs = 64, x = new Float32Array(fs * 10);
  for (let i = 0; i < x.length; i++) { let v = 0; for (let b = 0.4; b < 10; b += 0.75) { const d = i / fs - b; if (Math.abs(d) < 0.4) v += Math.exp(-d * d / (2 * 0.06 * 0.06)); } x[i] = v - 0.15; }
  const hr = A.hrFromBeats(A.findBeats(x, fs).map(p => p / fs));
  ok(near(hr, 80, 1.5), "heart rate from pulse beats: 0.75 s apart reads 80 bpm (" + (hr && hr.toFixed(1)) + ")");
  ok(A.hrFromBeats([0, 0.8]) === null, "too few beats gives no heart rate");
}

if (typeof document !== "undefined") { document.body.style.cssText = "font:14px monospace;white-space:pre;padding:16px;background:#111;color:#ddd"; document.body.textContent = out.join("\n") + "\n\n" + (fails ? fails + " FAILED" : "ALL PASSED"); }
else { console.log(out.join("\n")); console.log(fails ? fails + " FAILED" : "ALL PASSED"); process.exit(fails ? 1 : 0); }
