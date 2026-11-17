/* engine/legacy.js
   Legacy focus for the Cyton, in parallel with the new engine (on the Muse the panel's own legacy code keeps running instead).
   Every hop: Welch power of the time-domain MEAN of the usable EEG channels over the last 1 s, alpha 8-13 Hz and beta 13-30 Hz;
     F = ln((beta + 1e-3) / (alpha + 1e-3)); ema <- ema + 0.08 (F - ema); fast <- fast + 0.22 (F - fast); no update while the motion gate is not VALID.
   calibrate(): the panel's finishCal() (10 s of `fast` values, inliers within 1.5 IQR, 10th/90th percentiles, minimum span 0.4).
   pct(): the panel's pctOf() = 25 + 50 (ema - lo) / (hi - lo), held to 0..100 (low baseline = 25, high baseline = 75).
   The formulas are the Legacy ones on purpose (beta 13-30 Hz includes forehead muscle); they are kept for comparison, not changed.
   UMD: MuseEngine.Legacy. Tested by engine/legacy.test.js. */
"use strict";
(function (root) {
  const E = root.MuseEngine = root.MuseEngine || {};
  const U = E.Util || (typeof require !== "undefined" ? require("./util.js") : null);
  const MIN_SPAN = 0.4, CAL_SEC = 10;
  function quantile(s, q) { const p = (s.length - 1) * q, i = Math.floor(p), f = p - i; return s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * f; }
  function LegacyFocus(o) {
    o = Object.assign({ fs: 250 }, o);
    const L = { ema: null, fast: null, lo: null, hi: null, cal: null, raw: null, result: "" };
    /* x: the mean of the usable EEG channels over the last 1 s (Float32Array); gateValid: motion gate */
    L.hop = function (x, gateValid, t) {
      if (x && x.length >= o.fs * 0.9 && gateValid) {
        const { P, df } = U.psd(x, o.fs), a = U.bandPower(P, df, 8, 13), b = U.bandPower(P, df, 13, 30);
        const F = Math.log((b + 1e-3) / (a + 1e-3)); L.raw = F;
        L.ema = L.ema == null ? F : L.ema + 0.08 * (F - L.ema);
        L.fast = L.fast == null ? F : L.fast + 0.22 * (F - L.fast);
        if (L.cal) L.cal.vals.push(L.fast);
      }
      if (L.cal && t != null && t - L.cal.t0 >= CAL_SEC) L.finishCal();
    };
    L.startCal = t => { L.cal = { t0: t == null ? 0 : t, vals: [] }; L.result = ""; };
    L.finishCal = function () {
      const c = L.cal; L.cal = null; if (!c) return null;
      if (c.vals.length < 12) { L.result = "No usable signal in the 10 seconds. Check the contact grid and press again."; return null; }
      const s = c.vals.slice().sort((x, y) => x - y), q1 = quantile(s, .25), q3 = quantile(s, .75), iqr = q3 - q1;
      const inl = s.filter(v => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
      let lo = quantile(inl, .10), hi = quantile(inl, .90); L.result = "Baselines set. Focus is live.";
      if (hi - lo < MIN_SPAN) { const mid = (lo + hi) / 2; lo = mid - MIN_SPAN / 2; hi = mid + MIN_SPAN / 2; L.result = "Baselines set (small change seen)."; }
      L.lo = lo; L.hi = hi; return { lo, hi };
    };
    L.calibrate = L.startCal;
    L.pct = function () { if (L.ema == null || L.lo == null || L.hi == null || L.hi - L.lo < 0.05) return null; return Math.max(0, Math.min(100, 25 + (L.ema - L.lo) / (L.hi - L.lo) * 50)); };
    L.setBaselines = (lo, hi) => { if (isFinite(lo) && isFinite(hi) && hi - lo >= 0.05) { L.lo = lo; L.hi = hi; } };
    return L;
  }
  const API = { LegacyFocus, MIN_SPAN, CAL_SEC };
  E.Legacy = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
