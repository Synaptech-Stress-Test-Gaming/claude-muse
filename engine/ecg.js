/* engine/ecg.js
   Heart rate and HRV from the Cyton's ECG channel (fs 125 or 250 Hz and up). Everything is scale-invariant (the uV scale of the ECG channel
   at gain 12 may be off by a constant factor depending on the BrainFlow version), and the polarity flips itself.
   1 filter: y = hp 5 Hz + lp 15 Hz (detection), w = hp 0.5 + lp 40 (quality, template)
   2 polarity: every 10 s the skewness of sign*w over the last 10 s (w: see IMPLEMENTATION_NOTES); flip after two checks below -0.5
   3 Elgendi two moving averages: s = y^2, MAqrs (97 ms, centred), MAbeat (611 ms, centred), THR = MAbeat + 0.08 mean(s, 8 s);
     blocks with MAqrs > THR at least W1 wide are QRS complexes, R = max of sign*y in the block; >= 300 ms between peaks (the larger is kept)
   4 sub-sample refinement (parabola through the 3 samples around the peak) - needed at 125 Hz
   5 fallback: a rescaled Pan-Tompkins runs when every window has been invalid for 10 s while w still looks like ECG (kurtosis > 5)
   6 RR cleaning (300-2000 ms; med5 +/- 25%; missed beat 1.75-2.25 med5 = two beats for HR, dropped for RMSSD; extra beat merged for HR, dropped for RMSSD)
   7 Lipponen-Tarvainen style flags over the RMSSD window (Th = 5.2 x quartile deviation of |dRR| and |mRR|)
   8 window quality (10 s, step 5 s): kurtosis(w) >= 5 and mean correlation of each beat with the mean beat >= 0.8; sqi = that correlation
   9 outputs: hr8 (>= 4 intervals in 8 s, valid window), lnRmssd over 30-60 s (>= 30 s of valid windows, >= 20 successive differences,
     none if > 20% of the beats were rejected), the beat template (100 points) for identity, state ok | weak | none.
   UMD: MuseEngine.Ecg. Tested by engine/ecg.test.js (C1-C6). */
"use strict";
(function (root) {
  const E = root.MuseEngine = root.MuseEngine || {};
  const U = E.Util || (typeof require !== "undefined" ? require("./util.js") : null);

  function create(o) {
    o = Object.assign({ fs: 125, refine: true, keepS: 75 }, o);
    const fs = o.fs, W1 = Math.max(3, Math.round(0.097 * fs)), W2 = Math.round(0.611 * fs), h1 = W1 >> 1, h2 = W2 >> 1, n8 = Math.round(8 * fs);
    const mkF = () => ({ a: U.hp(5, fs), b: U.lp(15, fs), c: U.hp(0.5, fs), d: U.lp(40 < fs / 2 - 2 ? 40 : fs / 2 - 5, fs) });
    let F = mkF();
    const S = { b0: 0, y: [], w: [], cs: [0], n: 0, p: null, inB: false, bStart: 0, sign: 1, negChecks: 0, posChecks: 0, nextSkew: 10, peaks: [], beats: [],
      validFrom: 0, windows: [], nextWin: 10, rrHist: [], acc: [], pend: null, lastOut: null, nextHrv: 5, hrv: null, invalidSince: null, pt: null, ptStats: null,
      template: null, tplN: 0, lastHr: null, lastRmssdAt: -1e9 };
    const idx = i => i - S.b0;
    function trim() { const keep = Math.round(o.keepS * fs); if (S.y.length > keep + 10 * fs) { const cut = S.y.length - keep; S.y.splice(0, cut); S.w.splice(0, cut); S.cs.splice(0, cut); S.b0 += cut; } }
    /* one raw ECG sample at absolute index i */
    function push(i, x) {
      if (S.n === 0) { S.b0 = i; }
      const y = F.b.p(F.a.p(x)), w = F.d.p(F.c.p(x));
      S.y.push(y); S.w.push(w); S.cs.push(S.cs[S.cs.length - 1] + y * y); S.n = i + 1;
      if (S.p == null) S.p = i;
    }
    function sumS(a, b) { a = Math.max(a, S.b0); b = Math.min(b, S.n); if (b <= a) return 0; return S.cs[idx(b)] - S.cs[idx(a)]; }
    function detect() {
      const end = S.n - h2 - 1;
      for (let i = S.p; i <= end; i++) {
        if (i - h2 < S.validFrom) continue;
        const qrs = sumS(i - h1, i + h1 + 1) / (2 * h1 + 1), beat = sumS(i - h2, i + h2 + 1) / (2 * h2 + 1);
        const m8 = sumS(Math.max(S.validFrom, i - n8), i + 1) / Math.max(1, i + 1 - Math.max(S.validFrom, i - n8));
        const above = qrs > beat + 0.08 * m8;
        if (above && !S.inB) { S.inB = true; S.bStart = i; }
        else if (!above && S.inB) { S.inB = false; if (i - S.bStart >= W1) peakIn(S.bStart, i); }
      }
      S.p = Math.max(S.p, end + 1);
    }
    function peakIn(a, b) {
      let best = a, bv = -Infinity; for (let i = a; i < b; i++) { const v = S.sign * S.y[idx(i)]; if (v > bv) { bv = v; best = i; } }
      let off = 0;
      if (o.refine && best > S.b0 && best + 1 < S.n) { const y0 = S.sign * S.y[idx(best - 1)], y1 = S.sign * S.y[idx(best)], y2 = S.sign * S.y[idx(best + 1)], den = y0 - 2 * y1 + y2; if (den < 0) off = 0.5 * (y0 - y2) / den; }
      const t = (best + off) / fs, last = S.peaks[S.peaks.length - 1];
      if (last && t - last.t < 0.3) { if (bv > last.amp) { S.peaks[S.peaks.length - 1] = { t, i: best, amp: bv }; } return; }
      S.peaks.push({ t, i: best, amp: bv });
      if (S.peaks.length > 400) S.peaks.shift();
      onPeak();
    }
    /* ---- RR cleaning (step 6) ---- */
    function onPeak() {
      const P = S.peaks; if (P.length < 2) return;
      const a = P[P.length - 2], b = P[P.length - 1], rr = (b.t - a.t) * 1000;
      const acc = S.acc, med5 = S.rrHist.length >= 3 ? U.median(S.rrHist.slice(-5)) : null;
      if (S.pend) { const pd = S.pend; S.pend = null;                   // the previous interval was short: an extra beat if the two together match med5
        if (pd.med5 && Math.abs(pd.rr + rr - pd.med5) <= 0.25 * pd.med5) { acc.push({ t: b.t, rr: pd.rr + rr, hr: [pd.rr + rr], ok: false, kind: "extra" }); return; }
        acc.push({ t: pd.t, rr: pd.rr, hr: [], ok: false, kind: "reject" }); }
      if (rr < 300 || rr > 2000) { acc.push({ t: b.t, rr, hr: [], ok: false, kind: "range" }); if (rr > 2000) S.rrHist = []; return; }
      if (med5 && Math.abs(rr - med5) > 0.25 * med5) {
        if (rr >= 1.75 * med5 && rr <= 2.25 * med5) { acc.push({ t: b.t, rr, hr: [rr / 2, rr / 2], ok: false, kind: "missed" }); return; }
        if (rr < 0.6 * med5) { S.pend = { t: b.t, rr, med5 }; return; }
        acc.push({ t: b.t, rr, hr: [], ok: false, kind: "reject" }); return;
      }
      acc.push({ t: b.t, rr, hr: [rr], ok: true, kind: "ok" }); S.rrHist.push(rr); if (S.rrHist.length > 20) S.rrHist.shift();
      while (acc.length && acc[0].t < b.t - 120) acc.shift();
    }
    /* ---- window quality (step 8) ---- */
    function windowQuality(t1) {
      const t0 = t1 - 10, i0 = Math.max(S.b0, Math.round(t0 * fs)), i1 = Math.min(S.n, Math.round(t1 * fs));
      if (i1 - i0 < 8 * fs || i0 < S.validFrom) return { t0, t1, valid: false, sqi: 0 };
      const w = S.w.slice(idx(i0), idx(i1)), k = U.kurtosis(w);
      const pre = Math.round(0.25 * fs), post = Math.round(0.4 * fs), beats = [];
      for (const p of S.peaks) if (p.i - pre >= i0 && p.i + post < i1) beats.push(S.w.slice(idx(p.i - pre), idx(p.i + post)));
      if (beats.length < 3) return { t0, t1, valid: false, sqi: 0, kurt: k };
      const L = beats[0].length, mean = new Float64Array(L); beats.forEach(b => { for (let j = 0; j < L; j++) mean[j] += b[j] / beats.length; });
      const corr = U.mean(beats.map(b => U.pearson(b, mean)));
      const valid = k >= 5 && corr >= 0.8;
      return { t0, t1, valid, sqi: valid ? corr : 0, kurt: k, corr, nBeats: beats.length, meanBeat: mean };
    }
    /* ---- Lipponen-Tarvainen style flags over a list of accepted intervals (step 7) ---- */
    function ltFlags(rrs) {
      const n = rrs.length, flags = new Uint8Array(n); if (n < 20) return flags;
      const qd = a => { const s = U.sortNum(a); return (U.quantile(s, 0.75) - U.quantile(s, 0.25)) / 2; };
      const d = rrs.map((v, k) => k ? v - rrs[k - 1] : 0), th1 = 5.2 * qd(d.slice(Math.max(1, n - 91)).map(Math.abs));
      const m = rrs.map((v, k) => v - U.median(rrs.slice(Math.max(0, k - 5), k + 6))), th2 = 5.2 * qd(m.slice(Math.max(0, n - 91)).map(Math.abs));
      for (let k = 1; k < n; k++) {
        if (th1 > 0 && Math.abs(d[k]) > th1 && k + 1 < n && Math.sign(d[k + 1]) === -Math.sign(d[k]) && Math.abs(d[k + 1]) > th1) flags[k] = 1;
        if (th2 > 0 && Math.abs(m[k]) > th2) flags[k] = 1;
      }
      return flags;
    }
    function rmssdOver(t0, t1) {
      const items = S.acc.filter(a => a.t > t0 && a.t <= t1); if (!items.length) return { rmssd: null, n: 0, rejFrac: 1 };
      const rejected = items.filter(a => !a.ok).length, rejFrac = rejected / items.length;
      const okIdx = []; items.forEach((a, k) => { if (a.ok) okIdx.push(k); });
      const rrs = okIdx.map(k => items[k].rr), fl = ltFlags(rrs);
      let s = 0, n = 0; for (let q = 1; q < okIdx.length; q++) { if (okIdx[q] !== okIdx[q - 1] + 1 || fl[q] || fl[q - 1]) continue; const dd = rrs[q] - rrs[q - 1]; s += dd * dd; n++; }
      return { rmssd: n ? Math.sqrt(s / n) : null, n, rejFrac, flagged: fl.reduce((a, b) => a + b, 0) };
    }
    /* ---- the template for identity: mean beat, 100 points from -0.25 RRmed to +0.45 RRmed, z-scored ---- */
    function updateTemplate() {
      const rrMed = S.rrHist.length ? U.median(S.rrHist) : null; if (!rrMed) return;
      const pre = 0.25 * rrMed / 1000, post = 0.45 * rrMed / 1000;
      for (const p of S.peaks) { if (p.tpl || p.t + post > (S.n - 1) / fs || p.t - pre < S.b0 / fs) continue; p.tpl = true;
        const v = new Float64Array(100); for (let j = 0; j < 100; j++) { const tt = p.t - pre + (pre + post) * j / 99, x = tt * fs, i = Math.floor(x), fr = x - i; v[j] = S.sign * (S.w[idx(i)] * (1 - fr) + S.w[idx(i + 1)] * fr); }
        const m = U.mean(v), sd = Math.sqrt(U.variance(v, m)) || 1; for (let j = 0; j < 100; j++) v[j] = (v[j] - m) / sd;
        if (!S.template) S.template = new Float64Array(100); S.tplN++; const a = 1 / Math.min(S.tplN, 200); for (let j = 0; j < 100; j++) S.template[j] += a * (v[j] - S.template[j]); }
    }
    /* ---- fallback Pan-Tompkins (rescaled), run in parallel when Elgendi gives no valid window ---- */
    function panTompkins(t0, t1) {
      const i0 = Math.max(S.b0 + 2, Math.round(t0 * fs)), i1 = Math.min(S.n, Math.round(t1 * fs)), mw = Math.round(0.15 * fs), out = [];
      const d = [], q = []; for (let i = i0; i < i1; i++) { const v = (2 * S.y[idx(i)] + S.y[idx(i - 1)] - S.y[idx(i - 2)]) / 8; d.push(v * v); }
      let acc = 0; for (let k = 0; k < d.length; k++) { acc += d[k] - (k >= mw ? d[k - mw] : 0); q.push(acc / mw); }
      let spk = U.quantile(U.sortNum(q), 0.98) * 0.5, npk = U.quantile(U.sortNum(q), 0.5), last = -1e9, lastSlope = 0;
      for (let k = 1; k + 1 < q.length; k++) { if (!(q[k] > q[k - 1] && q[k] >= q[k + 1])) continue; const thr = npk + 0.25 * (spk - npk), t = (i0 + k) / fs;
        if (q[k] > thr && t - last > 0.2) { const slope = Math.abs(S.y[idx(i0 + k)] - S.y[idx(i0 + k - 1)]); if (t - last < 0.36 && slope < 0.5 * lastSlope) { npk = 0.125 * q[k] + 0.875 * npk; continue; }
          out.push(t); last = t; lastSlope = slope; spk = 0.125 * q[k] + 0.875 * spk; } else npk = 0.125 * q[k] + 0.875 * npk; }
      return out;
    }
    /* called every hop with the stream time t (all samples up to t pushed) */
    function hop(t) {
      detect(); trim();
      // polarity
      if (t >= S.nextSkew) { S.nextSkew = t + 10; const i0 = Math.max(S.b0, S.validFrom, S.n - 10 * fs); if (S.n - i0 > 5 * fs) { const sk = U.skewness(S.w.slice(idx(i0), idx(S.n)).map(v => S.sign * v));   // on w (0.5-40 Hz): after the 5-15 Hz band-pass the QRS is nearly symmetric
          if (sk < -0.5) { S.negChecks++; if (S.negChecks >= 2) { S.sign = -S.sign; S.negChecks = 0; } } else S.negChecks = 0; } }
      // windows every 5 s
      while (t >= S.nextWin) { const w = windowQuality(S.nextWin); S.windows.push(w); if (S.windows.length > 40) S.windows.shift(); S.nextWin += 5;
        if (!w.valid) { if (S.invalidSince == null) S.invalidSince = w.t1; } else S.invalidSince = null;
        if (S.invalidSince != null && w.t1 - S.invalidSince >= 10 && w.kurt > 5) S.pt = { until: w.t1 + 30 }; }
      if (S.pt && t > S.pt.until) S.pt = null;
      updateTemplate();
      const lastWin = S.windows[S.windows.length - 1], winOk = !!(lastWin && lastWin.valid);
      // hr8
      const rec = S.acc.filter(a => a.t > t - 8); const hrRR = [].concat(...rec.map(a => a.hr));
      const hr8 = winOk && hrRR.length >= 4 ? 60000 / U.mean(hrRR) : null;
      // lnRmssd every 5 s over the last 30-60 s
      if (t >= S.nextHrv) { S.nextHrv = t + 5; const span = Math.min(60, t - S.validFrom / fs);
        const wins = S.windows.filter(w => w.t1 > t - span && w.t0 >= t - span - 5), validS = wins.filter(w => w.valid).length * 5;
        const r = span >= 30 ? rmssdOver(t - span, t) : { rmssd: null, n: 0, rejFrac: 1 };
        S.hrv = validS >= 30 && r.rmssd != null && r.n >= 20 && r.rejFrac <= 0.2 ? { lnRmssd: Math.log(r.rmssd), rmssd: r.rmssd, t, n: r.n } : null;
        S.hrvNew = true; }
      const recentValid = S.windows.slice(-6).some(w => w.valid);
      const state = winOk && hr8 != null ? "ok" : recentValid ? "weak" : "none";
      S.lastHr = hr8;
      const out = { t, hr8, lnRmssd: S.hrv ? S.hrv.lnRmssd : null, rmssdMs: S.hrv ? S.hrv.rmssd : null, hrvNew: !!S.hrvNew, sqi: lastWin ? lastWin.sqi : 0, state,
        template: S.tplN >= 30 ? Array.from(S.template) : null, polarity: S.sign, fallback: !!S.pt };
      S.hrvNew = false; S.lastOut = out;
      return out;
    }
    function gap(i, n) { F = mkF(); S.inB = false; S.validFrom = i + Math.round(1.0 * fs); S.rrHist = []; S.pend = null; S.p = Math.max(S.p || 0, i);
      // samples are not stored for the gap: restart the buffers at i
      S.y = []; S.w = []; S.cs = [0]; S.b0 = i; S.n = i; S.p = i; S.peaks = []; }
    return { push, hop, gap, state: S, rmssdOver, ltFlags, panTompkins, peaks: () => S.peaks.map(p => p.t), accepted: () => S.acc.slice(), windows: () => S.windows.slice() };
  }
  const API = { create };
  E.Ecg = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
