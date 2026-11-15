/* engine/norm.js
   Self-calibrating normalization: the "no calibration, keeps learning" core.
   Julian's rule, exactly: every clean window updates the running statistics weighted by elapsed clean time,
     new_mean = (T mean + dt x) / (T + dt), across sessions,
   implemented as a weighted Welford/West accumulator (W, m, S) with these safeguards against its known failure (a cumulative mean absorbs
   sustained states: after H minutes of history, a state held T minutes keeps only H/(H+T) of its shift):
   - two tiers: a session accumulator, and a lifetime state that is frozen during a session and rebuilt by folding the stored session summaries
     (forget 0.98 per session, cap at 10 h of clean data, so drift over weeks is tracked);
   - a normal-inverse-gamma population prior (n = W / 10 s, T0 = 120 s of pseudo-data) -> Student-t predictive -> z;
   - winsorizing at c +/- 3 robust sigma (MAD from a 200-bin histogram), with an anti-stall rule;
   - contact epochs for EEG power features (re-anchor the location, keep the spread);
   - a slow within-session offset for the composites (focus 90 min, stress 45 min).
   Weights are seconds of NEW clean time (a 0.25 s hop gives 0.25 s even though the window is 2 s). Unusable windows and gaps give nothing and age nothing.
   score = 100 / (1 + exp(-1.7 z)): 50 = usual for you, about 88 = +2 sigma, about 12 = -2 sigma. No min-max anywhere.
   UMD: MuseEngine.Norm. Tested by engine/norm.test.js (N1-N14). */
"use strict";
(function (root) {
  const E = root.MuseEngine = root.MuseEngine || {};
  const U = E.Util || (typeof require !== "undefined" ? require("./util.js") : null);
  const DEF = { tauC: 10, T0: 120, forget: 0.98, Tcap: 36000, winsorK: 3, minPersonalS: 60, sigmaFloor: 0.25, stallS: 60, stallZ: 2, stallTau: 5,
    epochLambdaS: 30, epochFreezeS: 120, epochHoldS: 300, epochSettleS: 600, epochFactor: 0.25, fastTau: 300, nBins: 200, binSpan: 10,
    cusumK: 0.5, cusumH: 5.5 };   // h: prompt 5; 5.5 keeps false alarms under 1 per 10 h (see IMPLEMENTATION_NOTES, N9/N10)

  /* ---------- histogram: 200 bins over mu0 +/- 10 sd0, weights in seconds, mergeable, decays by scaling ---------- */
  function Hist(mu0, sd0, nBins, span) {
    nBins = nBins || DEF.nBins; span = span || DEF.binSpan;
    const lo = mu0 - span * sd0, hi = mu0 + span * sd0, bw = (hi - lo) / nBins;
    const h = { mu0, sd0, lo, hi, bw, n: nBins, w: new Float64Array(nBins), total: 0 };
    h.idx = x => Math.min(nBins - 1, Math.max(0, Math.floor((x - lo) / bw)));
    h.add = (x, w) => { if (!(w > 0) || !isFinite(x)) return; h.w[h.idx(x)] += w; h.total += w; };
    h.scale = f => { for (let i = 0; i < nBins; i++) h.w[i] *= f; h.total *= f; return h; };
    h.mergeIn = o => { for (let i = 0; i < nBins; i++) h.w[i] += o.w[i]; h.total += o.total; return h; };
    h.copy = () => { const c = Hist(mu0, sd0, nBins, span); c.w.set(h.w); c.total = h.total; return c; };
    h.quantile = q => { if (!(h.total > 0)) return NaN; const target = q * h.total; let s = 0;
      for (let i = 0; i < nBins; i++) { const nx = s + h.w[i]; if (nx >= target && h.w[i] > 0) return lo + bw * (i + (target - s) / h.w[i]); s = nx; } return hi; };
    h.mad = () => { const m = h.quantile(0.5); if (!isFinite(m)) return NaN; // MAD by bisection on the folded distribution
      let a = 0, b = hi - lo; for (let it = 0; it < 40; it++) { const c = (a + b) / 2; if (massWithin(m, c) < 0.5 * h.total) a = c; else b = c; } return (a + b) / 2; };
    function massWithin(m, d) { const x0 = m - d, x1 = m + d; let s = 0; for (let i = 0; i < nBins; i++) { const b0 = lo + i * bw, b1 = b0 + bw, ov = Math.max(0, Math.min(b1, x1) - Math.max(b0, x0)); if (ov > 0) s += h.w[i] * ov / bw; } return s; }
    h.percentile = x => { if (!(h.total > 0)) return null; const k = h.idx(x); let s = 0; for (let i = 0; i < k; i++) s += h.w[i]; s += h.w[k] * Math.min(1, Math.max(0, (x - (lo + k * bw)) / bw)); return 100 * s / h.total; };
    h.serialize = () => { const b = []; for (let i = 0; i < nBins; i++) if (h.w[i] > 0) b.push(i, +h.w[i].toPrecision(9)); return { mu0, sd0, n: nBins, span, b }; };
    return h;
  }
  function histFrom(o) { const h = Hist(o.mu0, o.sd0, o.n, o.span); for (let i = 0; i < o.b.length; i += 2) { h.w[o.b[i]] = o.b[i + 1]; h.total += o.b[i + 1]; } return h; }

  /* ---------- accumulators ---------- */
  function acc(prior) { return { W: 0, m: 0, S: 0, hist: Hist(prior.mu, prior.sd) }; }
  function accAdd(a, x, w) { if (!(w > 0)) return a; const W2 = a.W + w, d = x - a.m; a.m += (w / W2) * d; a.S += w * d * (x - a.m); a.W = W2; a.hist.add(x, w); return a; }
  function merge(a, b) {
    const W = a.W + b.W, hist = a.hist.copy().mergeIn(b.hist);
    if (!(W > 0)) return { W: 0, m: 0, S: 0, hist };
    const m = (a.W * a.m + b.W * b.m) / W, S = a.S + b.S + (a.W * b.W / W) * (a.m - b.m) * (a.m - b.m);
    return { W, m, S, hist };
  }
  function forget(a, f) { f = f == null ? DEF.forget : f; return { W: a.W * f, m: a.m, S: a.S * f, hist: a.hist.copy().scale(f) }; }
  function cap(a, T) { T = T == null ? DEF.Tcap : T; if (a.W <= T) return a; const k = T / a.W; return { W: T, m: a.m, S: a.S * k, hist: a.hist.copy().scale(k) }; }
  function accSer(a) { return { W: a.W, m: a.m, S: a.S, hist: a.hist.serialize() }; }
  function accDe(o, prior) { return { W: o.W, m: o.m, S: o.S, hist: o.hist ? histFrom(o.hist) : Hist(prior.mu, prior.sd) }; }
  /* fold session summaries (chronological) on top of a base */
  function fold(summaries, prior, base, k) {
    k = Object.assign({}, DEF, k || {}); let L = base ? accDe(base, prior) : acc(prior);
    for (const s of summaries) { if (!s) continue; L = cap(merge(forget(L, k.forget), s.hist && s.hist.b ? accDe(s, prior) : s), k.Tcap); }
    return L;
  }

  /* ---------- normal-inverse-gamma posterior ---------- */
  function posterior(c, prior, k) {
    const tauC = k.tauC, k0 = k.T0 / tauC, a0 = k0 / 2, b0 = a0 * prior.sd * prior.sd;
    const n = c.W / tauC, kn = k0 + n, mn = n > 0 ? (k0 * prior.mu + n * c.m) / kn : prior.mu, an = a0 + n / 2;
    const bn = b0 + (n > 0 ? (c.S / tauC) / 2 + k0 * n * (c.m - prior.mu) * (c.m - prior.mu) / (2 * kn) : 0);
    const scale = Math.sqrt(bn * (kn + 1) / (an * kn));
    return { n, kn, mn, an, bn, nu: 2 * an, scale, share: n / (k0 + n) };
  }
  const scoreOf = z => 100 / (1 + Math.exp(-1.7 * z));

  /* ---------- one feature ---------- */
  function feature(prior, opts) {
    const k = Object.assign({}, DEF, opts || {}), isEeg = !!k.isEeg, offTau = k.offsetTau || null, lifeOnly = !!k.lifetimeOnly;
    const F = { prior, k, life: acc(prior), sess: acc(prior), epoch: null, eOff: 0, off: 0, clipRun: 0, clipEma: 0, stall: false, fast: { m: null, v: 0 },
      winsor: k.winsor !== false, cache: null, sigmaR: null, sigmaAt: -1, stats: { clipped: 0, updates: 0 } };
    if (isEeg) F.epoch = { a: acc(prior), Te: 0, frozen: false, merged: false, lam: 0, n: 0 };
    function combinedEx() {                    // lifetime (forgotten once) + session; for EEG the current epoch is excluded until merged
      if (lifeOnly) return F.life;
      return merge(forget(F.life, k.forget), F.sess);
    }
    function post() { if (!F.cache) { const c = combinedEx(); F.cache = { c, p: posterior(c, prior, k) }; } return F.cache; }
    function location() { return isEeg ? F.exAnchor.mn + F.eOff : post().p.mn; }
    function personal() { return F.life.W + F.sess.W + (isEeg && F.epoch && !F.epoch.merged ? F.epoch.a.W : 0); }
    function sigmaR() {
      if (personal() < k.minPersonalS) return prior.sd;
      if (F.sigmaR == null || F.stats.updates - F.sigmaAt >= 20) {
        const h = merge(forget(F.life, k.forget), F.sess).hist; if (isEeg && F.epoch && !F.epoch.merged) h.mergeIn(F.epoch.a.hist);
        const s = 1.4826 * h.mad(); F.sigmaR = isFinite(s) ? Math.max(s, k.sigmaFloor * prior.sd) : prior.sd; F.sigmaAt = F.stats.updates;
      }
      return Math.max(F.sigmaR, k.sigmaFloor * prior.sd);
    }
    /* add one clean-window value x with weight w seconds. Returns {x (winsorized), clipped (-1/0/1), stall} */
    F.update = function (x, w) {
      if (!(w > 0) || !isFinite(x)) return { x: null, clipped: 0, stall: false };
      F.stats.updates++;
      const sr = sigmaR(), c = location();
      let xw = x, clipped = 0;
      if (F.winsor) { if (x > c + k.winsorK * sr) { xw = c + k.winsorK * sr; clipped = 1; } else if (x < c - k.winsorK * sr) { xw = c - k.winsorK * sr; clipped = -1; } }
      if (clipped) F.stats.clipped++;
      // anti-stall: the 5 s average of the standardized residual stays beyond 2 sigma on one side for 60 s of clean time
      const zr = (x - c) / sr, a = 1 - Math.exp(-w / k.stallTau); F.clipEma += a * (zr - F.clipEma);
      if (Math.abs(F.clipEma) > k.stallZ && (F.clipRun === 0 || Math.sign(F.clipEma) === F.clipSide)) { F.clipSide = Math.sign(F.clipEma); F.clipRun += w; } else { F.clipRun = 0; F.clipSide = 0; }
      F.stall = F.clipRun > k.stallS;
      // fast tier (report / change detection only)
      const af = 1 - Math.exp(-w / k.fastTau); if (F.fast.m == null) F.fast.m = x; else { const d = x - F.fast.m; F.fast.m += af * d; F.fast.v = (1 - af) * (F.fast.v + af * d * d); }
      // within-session offset (composites): off <- off + (w/tau)(resid - off), clamped to +/- 0.5
      if (offTau) { const zRaw = (xw - location()) / post().p.scale; F.off = U.clamp(F.off + (w / offTau) * (zRaw - F.off), -0.5, 0.5); }
      if (isEeg) {
        // the epoch is scored against history only (exAnchor, fixed at the epoch start) + eOff, so its own data never moves the anchor twice
        const ep = F.epoch, we = w * (ep.Te < k.epochSettleS ? k.epochFactor : 1);
        accAdd(ep.a, xw, we); ep.Te += w;
        if (!ep.frozen) { ep.lam = ep.Te / (ep.Te + k.epochLambdaS); F.eOff = ep.lam * (ep.a.m - F.exAnchor.mn); if (ep.Te >= k.epochFreezeS) ep.frozen = true; }
        if (!ep.merged && ep.Te >= k.epochHoldS) { F.sess = merge(F.sess, ep.a); ep.merged = true; }
        else if (ep.merged) accAdd(F.sess, xw, we);
      } else accAdd(F.sess, xw, w);
      F.cache = null;
      return { x: xw, clipped, stall: F.stall };
    };
    /* a new contact epoch (EEG power features only): keep the spread, re-anchor the location */
    F.newEpoch = function () {
      if (!isEeg) { F.clipRun = 0; F.clipEma = 0; F.stall = false; return; }
      F.cache = null;
      F.epoch = { a: acc(prior), Te: 0, frozen: false, merged: false, lam: 0 }; F.eOff = 0; F.clipRun = 0; F.clipEma = 0; F.stall = false;
      F.exAnchor = post().p;      // history-only posterior used for this whole epoch
    };
    F.z = function (x) {
      if (!isFinite(x)) return null;
      const P = isEeg && F.exAnchor ? F.exAnchor : post().p;
      const loc = P.mn + (isEeg ? F.eOff : 0);
      let z = (x - loc) / P.scale;
      if (offTau) z -= F.off;
      return isFinite(z) ? z : null;
    };
    F.score = x => { const z = F.z(x); return z == null ? null : scoreOf(z); };
    F.location = location;
    F.scale = () => (isEeg && F.exAnchor ? F.exAnchor : post().p).scale;
    F.posterior = () => post().p;
    F.learning = () => isEeg && F.epoch.Te < k.epochFreezeS;
    F.personalTime = personal;
    F.percentile = x => { const h = merge(forget(F.life, k.forget), F.sess).hist; return h.total >= 200 * k.tauC ? h.percentile(x) : null; };
    /* lifetime from stored session summaries (chronological), on top of an optional base */
    F.loadLifetime = function (summaries, base) { F.life = fold(summaries || [], prior, base, k); F.cache = null;
      if (isEeg) { F.exAnchor = post().p; const ep = F.epoch; if (ep && ep.a.W > 0) F.eOff = ep.lam * (ep.a.m - F.exAnchor.mn); } };
    /* the session's contribution (an unmerged epoch younger than 5 min is not stored) */
    F.summary = () => accSer(F.sess);
    F.serialize = () => ({ v: 1, prior, k: opts || {}, life: accSer(F.life), sess: accSer(F.sess), epoch: isEeg ? { a: accSer(F.epoch.a), Te: F.epoch.Te, frozen: F.epoch.frozen, merged: F.epoch.merged, lam: F.epoch.lam } : null,
      eOff: F.eOff, off: F.off, exAnchor: F.exAnchor, clipRun: F.clipRun, clipEma: F.clipEma, clipSide: F.clipSide || 0, fast: F.fast });
    F.resetSession = () => { F.sess = acc(prior); F.off = 0; F.cache = null; if (isEeg) F.newEpoch(); };
    if (isEeg) F.exAnchor = post().p;
    return F;
  }
  function deserialize(o) {
    const f = feature(o.prior, o.k);
    f.life = accDe(o.life, o.prior); f.sess = accDe(o.sess, o.prior); f.eOff = o.eOff; f.off = o.off; f.clipRun = o.clipRun; f.clipEma = o.clipEma; f.clipSide = o.clipSide; f.fast = o.fast; f.cache = null;
    if (o.epoch) f.epoch = { a: accDe(o.epoch.a, o.prior), Te: o.epoch.Te, frozen: o.epoch.frozen, merged: o.epoch.merged, lam: o.epoch.lam };
    f.exAnchor = o.exAnchor || (o.epoch ? f.posterior() : null);
    return f;
  }

  /* ---------- two-sided CUSUM ---------- */
  function Cusum(o) {
    o = Object.assign({ k: DEF.cusumK, h: DEF.cusumH }, o);
    const C = { hi: 0, lo: 0, alarms: 0, k: o.k, h: o.h };
    C.step = z => { C.hi = Math.max(0, C.hi + z - o.k); C.lo = Math.max(0, C.lo - z - o.k); if (C.hi > o.h || C.lo > o.h) { C.alarms++; C.hi = 0; C.lo = 0; return true; } return false; };
    C.reset = () => { C.hi = 0; C.lo = 0; };
    return C;
  }
  /* ---------- contact-epoch detector (evaluated once per clean second) ----------
     data: {lnRms:[per channel], lineDb:[per channel], shape:[6] | null, cov: Float64Array(n*n) | null, n}
     A new epoch when at least 2 criteria fire within 30 s: 1 broadband step, 2 line-noise jump, 3 spectral shape, 4 Riemannian distance (Cyton), 5 CUSUM. */
  function EpochDetector(o) {
    o = Object.assign({ nCh: 4, cyton: false, madK: 3, madFloor: 0.05, lineDb: 6, lineFrac: 0.25, shapePct: 0.99, shapeMin: 120, holdS: 5, cusumBlockS: 20, within: 30 }, o);
    const D = { t: 0, ref: null, fires: {}, hist: [], shapes: [], shapeD: [], riem: [], riemD: [], over: { line: 0, shape: 0, riem: 0 }, cus: [], block: [], blockT: 0, sig: [], fired: [] };
    function reset() { D.ref = { lnRms: [], line: [], shapeSum: null, shapeN: 0, cov: null, covN: 0 }; D.hist = []; D.shapeD = []; D.riemD = []; D.over = { line: 0, shape: 0, riem: 0 }; D.cus = []; for (let c = 0; c < o.nCh; c++) D.cus.push(Cusum({ k: DEF.cusumK, h: DEF.cusumH })); D.block = []; D.fires = {}; }
    reset();
    function riemann(A, B, n) { // sqrt(sum ln^2 lambda) of the generalized eigenvalues: whiten B by Cholesky, eig of L^-1 A L^-T
      try { const L = U.cholesky(B, n), Li = U.inv(L, n); if (!Li) return null; const M = U.matMul(U.matMul(Li, A, n), U.transpose(Li, n), n);
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const v = (M[i * n + j] + M[j * n + i]) / 2; M[i * n + j] = v; M[j * n + i] = v; }
        const ev = U.jacobiEig(M, n).values; let s = 0; for (const l of ev) { const ll = Math.log(Math.max(l, 1e-12)); s += ll * ll; } return Math.sqrt(s); } catch (e) { return null; } }
    function q99(a) { return U.quantile(U.sortNum(a), o.shapePct); }
    D.second = function (t, d) {
      D.t = t; const R = D.ref, fired = [];
      D.hist.push(d); if (D.hist.length > 5) D.hist.shift();
      if (d.lnRms) d.lnRms.forEach((v, c) => { if (v != null && isFinite(v)) { (R.lnRms[c] = R.lnRms[c] || []).push(v); if (R.lnRms[c].length > 3600) R.lnRms[c].shift(); } });
      if (d.lineDb) d.lineDb.forEach((v, c) => { if (v != null && isFinite(v)) { (R.line[c] = R.line[c] || []).push(v); if (R.line[c].length > 3600) R.line[c].shift(); } });
      // 1 broadband step
      if (D.hist.length === 5 && d.lnRms) { let n = 0, tot = 0; d.lnRms.forEach((_, c) => { const r = R.lnRms[c]; if (!r || r.length < 30) return; tot++;
          const recent = U.median(D.hist.map(h => h.lnRms[c]).filter(v => v != null)), med = U.median(r), mad = Math.max(U.mad(r, med), o.madFloor); if (Math.abs(recent - med) > o.madK * mad) n++; });
        if (tot && n >= 0.5 * tot) fired.push("broadband"); }
      // 2 line-noise jump for 5 s
      if (d.lineDb) { let n = 0, tot = 0; d.lineDb.forEach((v, c) => { const r = R.line[c]; if (!r || r.length < 30 || v == null) return; tot++; if (Math.abs(v - U.median(r)) > o.lineDb) n++; });
        D.over.line = tot && n >= o.lineFrac * tot ? D.over.line + 1 : 0; if (D.over.line >= o.holdS) fired.push("line"); }
      // 3 spectral shape
      if (d.shape) { if (!R.shapeSum) R.shapeSum = d.shape.map(() => 0); const mean = R.shapeSum.map(v => R.shapeN ? v / R.shapeN : 0);
        if (R.shapeN >= 10) { const dist = Math.sqrt(d.shape.reduce((s, v, i) => s + (v - mean[i]) ** 2, 0)); const ready = D.shapeD.length >= o.shapeMin;
          const over = ready && dist > q99(D.shapeD); D.over.shape = over ? D.over.shape + 1 : 0; if (D.over.shape >= o.holdS) fired.push("shape"); if (!over) { D.shapeD.push(dist); if (D.shapeD.length > 3600) D.shapeD.shift(); } }
        R.shapeSum = R.shapeSum.map((v, i) => v + d.shape[i]); R.shapeN++; }
      // 4 Riemannian distance of the 5 s covariance (Cyton)
      if (o.cyton && d.cov && d.n) { const n = d.n;
        if (!R.cov) { R.cov = Float64Array.from(d.cov); R.covN = 1; }
        else { const dist = riemann(d.cov, R.cov, n); if (dist != null) { const ready = D.riemD.length >= o.shapeMin, over = ready && dist > q99(D.riemD);
            D.over.riem = over ? D.over.riem + 1 : 0; if (D.over.riem >= o.holdS) fired.push("riemann"); if (!over) { D.riemD.push(dist); if (D.riemD.length > 3600) D.riemD.shift(); }
            if (R.covN < 60) { R.covN++; for (let i = 0; i < R.cov.length; i++) R.cov[i] += (d.cov[i] - R.cov[i]) / R.covN; } } } }
      // 5 CUSUM on 20 s block means of ln RMS, standardized by the robust sigma
      if (d.lnRms) { D.block.push(d.lnRms); if (D.block.length >= o.cusumBlockS) { let alarms = 0, tot = 0;
          for (let c = 0; c < o.nCh; c++) { const r = R.lnRms[c]; if (!r || r.length < 60) continue; tot++; const vals = D.block.map(b => b[c]).filter(v => v != null); if (!vals.length) continue;
            const med = U.median(r), sr = Math.max(1.4826 * U.mad(r, med), o.madFloor); if (D.cus[c].step((U.mean(vals) - med) / sr)) alarms++; }
          if (tot && alarms > tot / 2) fired.push("cusum"); D.block = []; } }
      fired.forEach(f => { D.fires[f] = t; });
      const recent = Object.keys(D.fires).filter(f => t - D.fires[f] <= o.within);
      D.fired = fired;
      if (recent.length >= 2) { const which = recent.slice(); reset(); return { newEpoch: true, which }; }
      return { newEpoch: false, which: fired };
    };
    D.reset = reset;
    return D;
  }
  /* quarantine: updates wait 5 s of stream time; an event detected later that covers one drops it */
  function Quarantine(delayS) {
    const Q = { items: [], delay: delayS == null ? 5 : delayS };
    Q.push = (t, t0, t1, apply) => Q.items.push({ t, t0, t1, apply });
    Q.flush = (tNow, dropped) => { const keep = []; for (const it of Q.items) { if (tNow - it.t < Q.delay) { keep.push(it); continue; } if (!(dropped && dropped(it.t0, it.t1))) it.apply(); } Q.items = keep; };
    Q.clear = () => { Q.items = []; };
    return Q;
  }
  function badge(P, sessions) {
    const min = P / 60;
    if (min > 60 || (sessions || 0) >= 3) return { text: "Personal, high", conf: 1.0 };
    if (min >= 15) return { text: "Personal, medium", conf: 0.85 };
    if (min >= 3) return { text: "Learning you (" + Math.floor(min) + " min)", conf: 0.4 + 0.3 * (min - 3) / 12 };
    return { text: "Population norms", conf: 0.4 };
  }
  const API = { DEF, Hist, histFrom, acc, accAdd, merge, forget, cap, fold, posterior, feature, deserialize, Cusum, EpochDetector, Quarantine, score: scoreOf, badge, accSer, accDe };
  E.Norm = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
