/* engine/features.js
   Every hop, on the window [t - D - 2, t - D]: per usable channel the Welch PSD (mean of the 1 s segments that engine/mask.js allows),
   band powers (uV^2) and their ln; channel-set features = mean of the per-channel ln powers over the set's usable channels.
     theta 4-8 Hz, alpha 8-12 Hz (or IAF +/- 2 once adopted), betaLo 13-20 Hz, broad 1-45 Hz, shape6 (1-4, 4-8, 8-13, 13-20, 20-30, 30-45; shape only)
     thetaF  Cyton F3, F4 (+F8)          Muse AF7, AF8
     alphaP  Cyton P3, P4, P7, P8, O1, O2 Muse TP9, TP10
     betaLoC Cyton C3, C4, P3, P4         Muse TP9, TP10
     ratioD  Cyton ln((theta + alpha) / betaLo) with powers averaged over C3, C4, P3, P4 (drowsiness; not on the Muse)
   Never beta above 20 Hz, gamma or theta/beta for focus.
   IAF: clean, eyes-open, time-weighted mean log-PSD of the posterior set (1 Hz grid, 2-40 Hz); line fit of ln P vs ln f over 3-40 Hz without 7-14 Hz
   (aperiodic exponent = -slope, offset = intercept); IAF = largest residual in 7-13 Hz with parabolic interpolation; valid when the peak residual >= 0.2
   and >= 5 min of clean data went in. It is adopted only at the start of a later session (feature key alphaP@iaf).
   UMD: MuseEngine.Features. Tested by engine/features.test.js. */
"use strict";
(function (root) {
  const E = root.MuseEngine = root.MuseEngine || {};
  const U = E.Util || (typeof require !== "undefined" ? require("./util.js") : null);
  const SETS = {
    cyton: { thetaF: ["F3", "F4", "F8"], alphaP: ["P3", "P4", "P7", "P8", "O1", "O2"], betaLoC: ["C3", "C4", "P3", "P4"], ratioD: ["C3", "C4", "P3", "P4"], iaf: ["P7", "P8", "O1", "O2"] },
    muse: { thetaF: ["AF7", "AF8"], alphaP: ["TP9", "TP10"], betaLoC: ["TP9", "TP10"], iaf: ["TP9", "TP10"] }
  };
  const SHAPE = [[1, 4], [4, 8], [8, 13], [13, 20], [20, 30], [30, 45]];

  function create(o) {
    o = Object.assign({ fs: 250, device: "cyton", channels: [], eegIdx: null, iaf: null }, o);
    const fs = o.fs, eeg = o.eegIdx || o.channels.map((_, i) => i);
    const sets = {}; for (const k in SETS[o.device]) sets[k] = SETS[o.device][k].map(n => o.channels.indexOf(n)).filter(i => i >= 0 && eeg.includes(i));
    const minCh = o.device === "cyton" ? 2 : 1;
    const hiHz = Math.min(45, fs / 2 - 5);
    const cache = new Map();
    const iafAcc = { sum: new Float64Array(39), w: 0 };            // 2..40 Hz
    // the preprocessing low-pass (two biquads at min(45, fs/2 - 5) Hz) bends the spectrum above about 25 Hz; the aperiodic fit undoes it exactly
    const lpHz = Math.min(45, fs / 2 - 5), lpRef = U.lp(lpHz, fs), lnGain2 = new Float64Array(39);
    for (let f = 2; f <= 40; f++) lnGain2[f - 2] = 4 * Math.log(lpRef.gainAt(f, fs));
    const S = { iaf: o.iaf && o.iaf.valid ? o.iaf.hz : null };
    function alphaBand() { return S.iaf ? [S.iaf - 2, S.iaf + 2] : [8, 12]; }
    /* PSD of channel c averaged over its segments; getSeg(c, i0, i1) -> samples */
    function chanPsd(c, segs, getSeg) {
      let acc = null, n = 0, df = 0;
      for (const [a, b] of segs) {
        const key = c + ":" + a + ":" + b; let r = cache.get(key);
        if (!r) { r = U.psd(getSeg(c, a, b), fs); cache.set(key, r); }
        if (!acc) { acc = new Float64Array(r.P.length); df = r.df; }
        for (let k = 0; k < acc.length; k++) acc[k] += r.P[k]; n++;
      }
      if (!n) return null; for (let k = 0; k < acc.length; k++) acc[k] /= n; return { P: acc, df };
    }
    /* win: {sets: {name: windowInfo}, t}; returns features */
    function compute(win, getSeg) {
      if (cache.size > 4000) cache.clear();
      const out = {}, per = {}, ab = alphaBand();
      const psdOf = c => { if (per[c] !== undefined) return per[c]; let segs = null; for (const k in win.sets) { const w = win.sets[k]; if (w && w.segments && w.segments[c]) { segs = w.segments[c]; break; } } per[c] = segs ? chanPsd(c, segs, getSeg) : null; return per[c]; };
      const bp = (c, lo, hi) => { const p = psdOf(c); return p ? U.bandPower(p.P, p.df, lo, hi) : null; };
      const mk = (name, band) => {
        const w = win.sets[name], set = sets[name] || [];
        const f = { x: null, valid: false, cleanFrac: w ? w.cleanFrac : 0, nCh: 0, nChSet: set.length, eyesClosed: !!(w && w.eyesClosed), reason: w ? w.reason : "no contact", chans: [] };
        if (!w || !w.usable) return f;
        const v = []; for (const c of w.chanIdx) { const p = bp(c, band[0], band[1]); if (p != null) { v.push(Math.log(p + 1e-12)); f.chans.push(c); } }
        if (v.length >= minCh) { f.x = U.mean(v); f.valid = true; f.nCh = v.length; } else f.reason = f.reason || "no contact";
        return f;
      };
      out.thetaF = mk("thetaF", [4, 8]);
      out.alphaP = mk("alphaP", ab); out.alphaP.key = S.iaf ? "alphaP@iaf" : "alphaP";
      out.betaLoC = mk("betaLoC", [13, 20]);
      if (o.device === "cyton") {
        const w = win.sets.ratioD, f = { x: null, valid: false, cleanFrac: w ? w.cleanFrac : 0, nCh: 0, nChSet: (sets.ratioD || []).length, eyesClosed: !!(w && w.eyesClosed), reason: w ? w.reason : null };
        if (w && w.usable) { let th = 0, al = 0, be = 0, n = 0; for (const c of w.chanIdx) { const a = bp(c, 4, 8), b = bp(c, ab[0], ab[1]), d = bp(c, 13, 20); if (a == null) continue; th += a; al += b; be += d; n++; }
          if (n >= minCh) { f.x = Math.log((th + al) / n + 1e-12) - Math.log(be / n + 1e-12); f.valid = true; f.nCh = n; } }
        out.ratioD = f;
      }
      // spectral shape over every usable channel (epoch detector), per-channel broad power
      const shape = SHAPE.map(() => 0); let ns = 0; out.broad = {};
      for (const c in per) { const p = per[c]; if (!p) continue; const lp = SHAPE.map(([a, b]) => Math.log(U.bandPower(p.P, p.df, a, Math.min(b, hiHz)) + 1e-12)), m = U.mean(lp);
        lp.forEach((v, i) => { shape[i] += v - m; }); ns++; out.broad[c] = Math.log(U.bandPower(p.P, p.df, 1, hiHz) + 1e-12); }
      out.shape6 = ns ? shape.map(v => v / ns) : null;
      out._psd = per;
      return out;
    }
    /* IAF accumulation from the posterior set (call with clean, eyes-open windows) */
    function accumulateIaf(feat, w) {
      const set = sets.iaf || []; let acc = null, n = 0;
      for (const c of set) { const p = feat._psd[c]; if (!p) continue; const v = new Float64Array(39);
        for (let f = 2; f <= 40; f++) { const k = f / p.df, k0 = Math.floor(k), fr = k - k0; const a = p.P[Math.min(k0, p.P.length - 1)], b = p.P[Math.min(k0 + 1, p.P.length - 1)]; v[f - 2] = Math.log(a * (1 - fr) + b * fr + 1e-12); }
        if (!acc) acc = new Float64Array(39); for (let i = 0; i < 39; i++) acc[i] += v[i]; n++; }
      if (!n || !(w > 0)) return;
      for (let i = 0; i < 39; i++) iafAcc.sum[i] += w * (acc[i] / n - lnGain2[i]); iafAcc.w += w;
    }
    function iafEstimate() {
      if (!(iafAcc.w > 0)) return { valid: false, hz: null, apExp: null, apOff: null, peak: null, cleanS: 0 };
      const lp = Array.from(iafAcc.sum, v => v / iafAcc.w), fx = [], fy = [];
      for (let f = 3; f <= 40; f++) if (f < 7 || f > 14) { fx.push(Math.log(f)); fy.push(lp[f - 2]); }
      const fit = U.linfit(fx, fy), res = f => lp[f - 2] - (fit.intercept + fit.slope * Math.log(f));
      let best = 7, bv = -Infinity; for (let f = 7; f <= 13; f++) { const r = res(f); if (r > bv) { bv = r; best = f; } }
      let hz = best; if (best > 7 && best < 13) { const a = res(best - 1), b = res(best), c = res(best + 1), den = a - 2 * b + c; if (den < 0) hz = best + 0.5 * (a - c) / den; }
      return { valid: bv >= 0.2 && iafAcc.w >= 300, hz, apExp: -fit.slope, apOff: fit.intercept, peak: bv, cleanS: iafAcc.w, logPsd: lp };
    }
    return { compute, accumulateIaf, iafEstimate, sets, minCh, alphaBand, state: S, iafAcc };
  }
  const API = { create, SETS, SHAPE };
  E.Features = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
