/* Arousal meter: how activated your BODY is compared with your own resting level (0 = at rest, 100 = strongly activated).

   Why "arousal" and not "stress": stress is a psychological state and cannot be read directly from a headband. What CAN be
   measured is the body's activation that comes with it (and with excitement, effort or caffeine). This meter is honest about that:
     - heart rate  (pulse sensor): rises with arousal. The most dependable of the three.
     - muscle tension (30-44 Hz on the forehead sensors): jaw clenching, frowning, tensing up. This is EMG, not brain activity.
     - movement (accelerometer): fidgeting and head tremor.
   Brain signals (EEG) are deliberately NOT used here; they belong to the focus meter. See docs/RESEARCH_AROUSAL.md.

   No manual calibration: the first seconds after signals arrive are taken as "rest" (sit still), then the meter is live.
   Each signal is compared with its own resting value, and the resting value slowly follows you down if you relax further.

   This file has no page code (see panel/arousal-link.js). Tested by arousal.test.js. */
"use strict";
(function (root) {

const TUNING = {
  restSec: 15,          // seconds of sitting still used as the resting baseline (per signal)
  hrSpan: 25,           // bpm above rest that counts as fully activated
  tensionSpan: 1.6,     // ln units of 30-44 Hz share above rest that count as fully tense (a firm jaw clench is well above this)
  motionSpan: 8,        // movement this many times the resting level counts as full
  motionFloor: 1.5,     // milli-g: resting movement is never taken as smaller than this
  weights: { hr: 0.5, tension: 0.3, motion: 0.2 },
  peakShare: 0.4,       // score = (1 - peakShare) * weighted mean + peakShare * strongest signal, so one clear signal still shows
  deadSd: 1.5,          // changes smaller than this many resting standard deviations are treated as rest (noise floor)
  smoothSec: 0.8,       // smoothing of the final score
  driftSec: 45          // the resting value follows you down this slowly when you are calmer than the baseline
};
const KEYS = ["hr", "tension", "motion"];
const LABEL = { hr: "HEART RATE", tension: "MUSCLE TENSION", motion: "MOVEMENT" };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const median = a => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };

/* ---------- signal helpers ---------- */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
/* Muscle tension from forehead windows (each 512 samples at 256 Hz, in uV): ln( power 30-44 Hz / power 1-44 Hz ). null if no window. */
function tensionOf(windows) {
  if (!windows || !windows.length) return null;
  let g = 0, t = 0;
  windows.forEach(x => {
    const n = 512, re = new Float64Array(n), im = new Float64Array(n);
    let mean = 0; for (let i = 0; i < n; i++) mean += x[i]; mean /= n;
    for (let i = 0; i < n; i++) re[i] = (x[i] - mean) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
    fft(re, im);
    for (let k = 2; k < 88; k++) { const p = re[k] * re[k] + im[k] * im[k]; t += p; if (k >= 60) g += p; }   // bin = 0.5 Hz: 1-44 Hz total, 30-44 Hz "gamma"
  });
  return Math.log((g + 1e-6) / (t + 1e-6));
}
/* Beats in a band-passed pulse signal (NaN = missing). Returns positions in samples (fractional). */
function findBeats(x, fs) {
  const n = x.length, minDist = Math.round(0.35 * fs), beats = [];
  let sum = 0, cnt = 0; for (let i = 0; i < n; i++) if (x[i] === x[i]) { sum += x[i] * x[i]; cnt++; }
  if (cnt < fs * 3) return beats;
  const thr = 0.35 * Math.sqrt(sum / cnt);
  for (let i = 1; i < n - 1; i++) {
    const a = x[i - 1], b = x[i], c = x[i + 1];
    if (!(a === a && b === b && c === c) || b < thr || b < a || b <= c) continue;
    const den = a - 2 * b + c, pos = i + (den < 0 ? 0.5 * (a - c) / den : 0);
    if (beats.length && pos - beats[beats.length - 1] < minDist) { if (b > x[Math.round(beats[beats.length - 1])]) beats[beats.length - 1] = pos; continue; }
    beats.push(pos);
  }
  return beats;
}
/* Heart rate (bpm) from beat times in seconds: mean of the last few plausible intervals. null if fewer than 3. */
function hrFromBeats(times, lastN) {
  const ib = [];
  for (let i = 1; i < times.length; i++) { const d = times[i] - times[i - 1]; if (d >= 0.33 && d <= 1.5 && (!ib.length || Math.abs(d - ib[ib.length - 1]) <= 0.3 * ib[ib.length - 1])) ib.push(d); }
  const r = ib.slice(-(lastN || 6)); if (r.length < 3) return null;
  return 60 / (r.reduce((a, b) => a + b, 0) / r.length);
}

/* ---------- the meter ---------- */
function makeMeter(tuning) {
  const T = Object.assign({}, TUNING, tuning || {}); T.weights = Object.assign({}, TUNING.weights, (tuning || {}).weights || {});
  const M = { T, value: null, parts: {}, state: "waiting", restLeft: null };
  const fresh = () => ({ base: null, sd: 0, buf: [], t: 0, v: null, raw: null, delta: null });
  KEYS.forEach(k => M.parts[k] = fresh());
  M.rebaseline = () => { KEYS.forEach(k => M.parts[k] = fresh()); M.value = null; M.state = "waiting"; M.restLeft = null; };
  /* each signal is compared on its own scale: bpm, ln units, or ln(movement) */
  const U = (k, x) => k === "motion" ? Math.log(Math.max(x, T.motionFloor)) : x;
  const SPAN = { hr: T.hrSpan, tension: T.tensionSpan, motion: Math.log(T.motionSpan) };
  /* one reading: f = {hr, tension, motion} (null = not available right now); dt = seconds since the previous reading */
  M.push = (f, dt) => {
    let wsum = 0, acc = 0, peak = 0, resting = 0, live = 0;
    KEYS.forEach(k => {
      const p = M.parts[k]; let x = f[k];
      if (k === "hr" && x != null && (x < 40 || x > 190)) x = null;
      p.raw = (x == null || !isFinite(x)) ? null : x;
      if (p.raw == null) { p.v = null; p.delta = null; return; }
      const u = U(k, p.raw);
      if (p.base == null) {                                   // still measuring this signal's resting level
        p.buf.push(u); p.t += dt; resting = Math.max(resting, T.restSec - p.t);
        if (p.t >= T.restSec && p.buf.length >= 8) { p.base = median(p.buf); p.sd = 1.4826 * median(p.buf.map(v => Math.abs(v - p.base))); p.buf = []; }
        else { p.v = null; return; }
      }
      if (u < p.base) p.base += (u - p.base) * Math.min(1, dt / T.driftSec);   // calmer than the baseline: follow slowly
      const dead = Math.min(T.deadSd * p.sd, 0.25 * SPAN[k]);
      p.delta = k === "motion" ? Math.exp(u - p.base) : u - p.base;            // shown to the user: bpm above rest, ln units, or "x rest"
      p.v = clamp((u - p.base - dead) / SPAN[k], 0, 1);
      acc += T.weights[k] * p.v; wsum += T.weights[k]; peak = Math.max(peak, p.v); live++;
    });
    if (!live) { M.state = resting > 0 ? "resting" : "waiting"; M.restLeft = resting > 0 ? resting : null; M.value = null; return null; }
    M.state = "live"; M.restLeft = resting > 0 ? resting : null;
    const raw = 100 * ((1 - T.peakShare) * acc / wsum + T.peakShare * peak);
    M.value = M.value == null ? raw : M.value + (raw - M.value) * (1 - Math.exp(-dt / T.smoothSec));
    return M.value;
  };
  M.used = () => KEYS.filter(k => M.parts[k].v != null);
  return M;
}

const API = { TUNING, KEYS, LABEL, fft, tensionOf, findBeats, hrFromBeats, makeMeter, median };
if (typeof module !== "undefined" && module.exports) module.exports = API;
root.Arousal = API;
})(typeof window !== "undefined" ? window : globalThis);
