/* Arousal / fear meter (experimental): the 0-100 score from the "Muse 2 Stress / Fear Meter" spec.
   F = 100 * clip(0.40 H + 0.35 V + 0.25 E, 0, 1)
     H = heart-rate rise        (HR - HRbase) / (HRhigh - HRbase)
     V = HRV (RMSSD) drop       (HRVbase - HRV) / (HRVbase - HRVlow)
     E = beta/alpha rise        (R - Rbase) / (Rhigh - Rbase)
   This estimates physiological physiological arousal, not fear. Excitement, surprise, movement and muscle tension look the same.
   Rules from the spec that are enforced here:
     - a missing or rejected measurement is never treated as zero; with fewer than three valid components the score is a PARTIAL score
       (weights renormalised, partial:true, confidence = share of weight used) and with none the score is withheld;
     - if nothing valid arrives for STALE_MS the last score is kept but marked stale:true;
     - the score is smoothed (EMA, alpha 0.25) only when a new valid measurement arrives.
   Pure maths, no DOM. Tested in arousal.test.js. Wired to the stress card by stress.js (attach). */
"use strict";
(function (root) {

const W = { hr: 0.40, hrv: 0.35, eeg: 0.25 };
const EPS = 1e-10, STALE_MS = 5000, ALPHA = 0.25;
const clip = (x, lo, hi) => Math.min(hi == null ? 1 : hi, Math.max(lo == null ? 0 : lo, x));
const ok = v => v != null && isFinite(v);

/* ---------- component equations (return null for an invalid input, never 0) ---------- */
function hrComponent(hr, base, high) { if (!ok(hr)) return null; if (!(high > base)) throw new Error("Invalid heart-rate calibration"); return clip((hr - base) / (high - base)); }
function hrvComponent(hrv, base, low) { if (!ok(hrv)) return null; if (!(base > low)) throw new Error("Invalid HRV calibration"); return clip((base - hrv) / (base - low)); }
function eegComponent(r, base, high) { if (!ok(r)) return null; if (!(high > base)) throw new Error("Invalid EEG calibration"); return clip((r - base) / (high - base)); }

/* RMSSD in ms of successive IBI differences (spec section 5: sqrt(mean(diff^2))). null with fewer than 2 intervals. */
function rmssd(ibisMs) {
  if (!ibisMs || ibisMs.length < 2) return null;
  let s = 0; for (let i = 1; i < ibisMs.length; i++) { const d = ibisMs[i] - ibisMs[i - 1]; s += d * d; }
  return Math.sqrt(s / (ibisMs.length - 1));
}
/* beta / (alpha + eps) from band powers. */
const betaAlpha = (alpha, beta) => beta / (alpha + EPS);
/* combine per-channel ratios by their median (spec section 6); channels that are null/NaN are left out. */
function medianRatio(ratios) {
  const a = ratios.filter(ok).sort((x, y) => x - y), n = a.length;
  return n ? (n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : null;
}
/* combined score from components. Missing ones (null) are dropped and the weights renormalised.
   Returns {score, partial, confidence, used} or null when no component is valid. */
function combine(c) {
  let ws = 0, acc = 0; const used = [];
  Object.keys(W).forEach(k => { if (ok(c[k])) { acc += W[k] * c[k]; ws += W[k]; used.push(k); } });
  if (!ws) return null;
  return { score: clip(acc / ws * 100, 0, 100), partial: used.length < 3, confidence: ws, used };
}
function label(s) { return s <= 20 ? "Low arousal" : s <= 40 ? "Mild arousal" : s <= 60 ? "Moderate arousal" : s <= 80 ? "High arousal" : "Very high arousal"; }
function smooth(next, prev, alpha) { alpha = alpha == null ? ALPHA : alpha; return prev == null ? next : alpha * next + (1 - alpha) * prev; }

/* Starting estimates for the personalised references, from the spec's example (65 -> 105 bpm, 42 -> 20 ms, 0.85 -> 1.5).
   NOT validated: replace them with values measured from real recordings. */
function defaultRefs(base) {
  const r = {};
  if (ok(base.hr)) r.hrHigh = base.hr + 40;
  if (ok(base.hrv)) r.hrvLow = base.hrv * 0.5;
  if (ok(base.ratio)) r.ratioHigh = base.ratio * 1.75;
  return r;
}
const median = a => medianRatio(a);

function makeArousalMeter(cfg) {
  cfg = cfg || {};
  const minN = cfg.minSamples || 30, alpha = cfg.alpha || ALPHA, staleMs = cfg.staleMs || STALE_MS;
  const M = { base: null, refs: null, rec: null, value: null, raw: null, comp: {}, used: [], partial: false, confidence: 0, lastValidAt: null, lastIn: {}, error: "" };
  M.startBaseline = () => { M.rec = { hr: [], hrv: [], ratio: [] }; M.error = ""; };
  M.recording = () => !!M.rec;
  /* f = {hr, hrv, ratio} already screened by the caller (null where the signal is invalid or movement-gated) */
  M.pushBaseline = f => { if (!M.rec) return; ["hr", "hrv", "ratio"].forEach(k => { if (ok(f[k])) M.rec[k].push(f[k]); }); };
  M.baselineCount = () => M.rec ? Math.max(M.rec.hr.length, M.rec.hrv.length, M.rec.ratio.length) : 0;
  /* needs `minSamples` clean readings per signal; the others are left out (no baseline means that component is skipped later) */
  M.finishBaseline = (refs) => {
    const r = M.rec; M.rec = null; if (!r) return false;
    const base = {}; ["hr", "hrv", "ratio"].forEach(k => { if (r[k].length >= minN) base[k] = median(r[k]); });
    if (!Object.keys(base).length) { M.error = "Not enough clean signal during the baseline."; return false; }
    M.base = base; M.refs = Object.assign(defaultRefs(base), refs || {}); M.value = null; M.raw = null; M.lastValidAt = null; M.error = "";
    return true;
  };
  M.setBaseline = (base, refs) => { M.base = base; M.refs = Object.assign(defaultRefs(base), refs || {}); M.value = null; M.raw = null; M.lastValidAt = null; };
  M.ready = () => !!M.base;
  M.components = f => {
    const b = M.base, r = M.refs, c = { hr: null, hrv: null, eeg: null };
    if (!b) return c;
    if (b.hr != null) c.hr = hrComponent(f.hr, b.hr, r.hrHigh);
    if (b.hrv != null) c.hrv = hrvComponent(f.hrv, b.hrv, r.hrvLow);
    if (b.ratio != null) c.eeg = eegComponent(f.ratio, b.ratio, r.ratioHigh);
    return c;
  };
  /* one update with the newest measurements. Returns the result object of spec section 13 (score null until a valid measurement). */
  M.update = (f, now) => {
    now = now == null ? Date.now() : now;
    const c = M.components(f), res = combine(c);
    M.comp = c; M.lastIn = f;
    if (res) { M.raw = res.score; M.value = smooth(res.score, M.value, alpha); M.used = res.used; M.partial = res.partial; M.confidence = res.confidence; M.lastValidAt = now; }
    else { M.used = []; M.partial = false; M.confidence = 0; }
    return M.result(now);
  };
  M.stale = now => M.lastValidAt == null || (now == null ? Date.now() : now) - M.lastValidAt > staleMs;
  M.result = now => {
    now = now == null ? Date.now() : now;
    const have = M.value != null, st = M.stale(now);
    return {
      stress_score: have ? Math.round(M.value * 100) / 100 : null,
      score_valid: have && !st,
      stale: have && st,
      partial: have && M.partial,
      confidence: M.confidence,
      label: have ? label(M.value) : "No score",
      heart_rate_bpm: ok(M.lastIn.hr) ? M.lastIn.hr : null,
      rmssd_ms: ok(M.lastIn.hrv) ? M.lastIn.hrv : null,
      beta_alpha_ratio: ok(M.lastIn.ratio) ? M.lastIn.ratio : null,
      components: { heart_rate: M.comp.hr == null ? null : M.comp.hr, hrv_decrease: M.comp.hrv == null ? null : M.comp.hrv, eeg: M.comp.eeg == null ? null : M.comp.eeg },
      signal_quality: { ppg_valid: ok(M.lastIn.hr), hrv_valid: ok(M.lastIn.hrv), eeg_valid: ok(M.lastIn.ratio), motion_valid: M.lastIn.motionOk !== false },
      timestamp: now / 1000
    };
  };
  return M;
}

const API = { W, EPS, STALE_MS, clip, hrComponent, hrvComponent, eegComponent, rmssd, betaAlpha, medianRatio, combine, label, smooth, defaultRefs, makeArousalMeter };
if (typeof module !== "undefined" && module.exports) module.exports = API;
root.Arousal = API;
})(typeof window !== "undefined" ? window : globalThis);
