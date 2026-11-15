/* engine/clean.js
   Optional cleaning: ASR (artifact subspace reconstruction; default on for the Cyton, off for the Muse) and an accelerometer NLMS
   filter (default off; switched on only by tools/autotune.py when it improves artifact immunity).

   Parts of this file are a JavaScript port of asrpy (https://github.com/DiGyt/asrpy), Copyright (c) 2021 Dirk Gütlin and contributors,
   BSD 3-Clause License:

     Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following
     conditions are met:
     1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
     2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer
        in the documentation and/or other materials provided with the distribution.
     3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived
        from this software without specific prior written permission.
     THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
     LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
     COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
     (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
     HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
     ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

   Simplifications against asrpy: no spectral-shaping (Yule-Walker) filter before the statistics; median / 1.4826 MAD of the component RMS
   instead of the truncated-Gaussian fit; non-overlapping 0.5 s RMS windows; processing in 0.5 s blocks with a raised-cosine blend of the
   reconstruction matrix across each block.
   Calibration is automatic, from seconds the event detector marks clean on every channel: it starts after 60 s of clean data and is redone
   after every further 60 s from the most recent 5 min. It is stored per profile and device and used at the next session start.
   UMD: MuseEngine.Clean. Tested by engine/clean.test.js (A1-A5). */
"use strict";
(function (root) {
  const E = root.MuseEngine = root.MuseEngine || {};
  const U = E.Util || (typeof require !== "undefined" ? require("./util.js") : null);
  const DEF = { k: 20, calibS: 60, recalibS: 60, spanS: 300, blockS: 0.5, maxDimsFrac: 0.66, removedMasked: 0.5, dropTop: 0.1 };

  function covOf(X, C, n) { const m = new Float64Array(C); for (let c = 0; c < C; c++) { let s = 0; for (let k = 0; k < n; k++) s += X[c][k]; m[c] = s / n; }
    const S = new Float64Array(C * C); for (let a = 0; a < C; a++) for (let b = a; b < C; b++) { let s = 0; const xa = X[a], xb = X[b]; for (let k = 0; k < n; k++) s += (xa[k] - m[a]) * (xb[k] - m[b]); S[a * C + b] = S[b * C + a] = s / n; } return S; }

  /* calibration from clean blocks: blocks = [Float32Array[C] of n samples] */
  function calibrate(blocks, C, fs, k) {
    // 1 s block covariances (pairs of 0.5 s blocks), drop the 10% with the largest trace, mean
    const covs = []; for (let i = 0; i + 1 < blocks.length; i += 2) { const n = blocks[i][0].length + blocks[i + 1][0].length, X = []; for (let c = 0; c < C; c++) { const a = new Float32Array(n); a.set(blocks[i][c]); a.set(blocks[i + 1][c], blocks[i][0].length); X.push(a); } covs.push(covOf(X, C, n)); }
    if (covs.length < 5) return null;
    const tr = covs.map(S => { let t = 0; for (let c = 0; c < C; c++) t += S[c * C + c]; return t; }), cut = U.quantile(U.sortNum(tr), 1 - k.dropTop);
    const Cov = new Float64Array(C * C); let nUsed = 0; covs.forEach((S, i) => { if (tr[i] > cut && nUsed > 0) return; nUsed++; for (let j = 0; j < C * C; j++) Cov[j] += S[j]; });
    for (let j = 0; j < C * C; j++) Cov[j] /= nUsed;
    const M = U.sqrtmSym(Cov, C), V = U.jacobiEig(M, C).vectors;
    // component RMS over 0.5 s windows
    const rms = []; for (let c = 0; c < C; c++) rms.push([]);
    for (const B of blocks) { const n = B[0].length; for (let q = 0; q < C; q++) { let s = 0; for (let t = 0; t < n; t++) { let y = 0; for (let c = 0; c < C; c++) y += V[c * C + q] * B[c][t]; s += y * y; } rms[q].push(Math.sqrt(s / n)); } }
    const thr = rms.map(a => { const m = U.median(a); return m + k.k * 1.4826 * U.mad(a, m); });
    const T = new Float64Array(C * C); for (let i = 0; i < C; i++) for (let j = 0; j < C; j++) T[i * C + j] = thr[i] * V[j * C + i];   // T = diag(mu + k sigma) V^T
    return { M, T, C, thr };
  }
  /* reconstruction matrix for one block */
  function reconstruct(X, C, n, cal, maxDims) {
    const Cw = covOf(X, C, n), { values: Dw, vectors: Vw } = U.jacobiEig(Cw, C);
    const keep = new Uint8Array(C); let removed = 0;
    for (let i = 0; i < C; i++) { let s = 0; for (let r = 0; r < C; r++) { let v = 0; for (let j = 0; j < C; j++) v += cal.T[r * C + j] * Vw[j * C + i]; s += v * v; }
      keep[i] = (Dw[i] < s || i < C - maxDims) ? 1 : 0; if (!keep[i]) removed++; }
    if (!removed) return null;
    const VtM = U.matMul(U.transpose(Vw, C), cal.M, C);           // Vw^T M
    for (let i = 0; i < C; i++) if (!keep[i]) for (let j = 0; j < C; j++) VtM[i * C + j] = 0;
    return U.matMul(U.matMul(cal.M, U.pinv(VtM, C, C), C), U.transpose(Vw, C), C);   // R = M pinv(keep o (Vw^T M)) Vw^T
  }

  function ASR(o) {
    o = Object.assign({ fs: 250, channels: [], cfg: null, stored: null }, o);
    const k = Object.assign({}, DEF, o.cfg || {}), fs = o.fs, ch = o.channels, C = ch.length, bn = Math.round(k.blockS * fs), maxDims = Math.floor(k.maxDimsFrac * C);
    const A = { cal: null, blocks: [], cleanS: 0, nextCal: k.calibS, Rprev: null, removed: 0, stats: { blocks: 0, masked: 0 } };
    if (o.stored && o.stored.M && o.stored.channels && o.stored.channels.join() === ch.join()) A.cal = { M: Float64Array.from(o.stored.M), T: Float64Array.from(o.stored.T), C, thr: o.stored.thr || null, stored: true };
    /* every 0.5 s: process the block [iEnd - bn, iEnd) from src rings into dst rings; isClean(t0,t1) = no mask on any channel */
    A.step = function (t, iEnd, src, dst, L, isClean) {
      const i0 = iEnd - bn; if (i0 < 0) return null;
      const X = ch.map(c => { const a = new Float32Array(bn); for (let q = 0; q < bn; q++) a[q] = src[c][((i0 + q) % L + L) % L]; return a; });
      if (isClean && isClean(i0 / fs, iEnd / fs)) { A.blocks.push(X); A.cleanS += k.blockS; const maxB = Math.round(k.spanS / k.blockS); if (A.blocks.length > maxB) A.blocks.shift();
        if (A.cleanS >= A.nextCal) { const c = calibrate(A.blocks, C, fs, k); if (c) { A.cal = c; } A.nextCal = A.cleanS + k.recalibS; } }
      let R = null; if (A.cal) { try { R = reconstruct(X, C, bn, A.cal, maxDims); } catch (e) { R = null; } }
      let vin = 0, vout = 0;
      for (let q = 0; q < bn; q++) {
        const w = 0.5 - 0.5 * Math.cos(Math.PI * (q + 1) / bn);   // raised-cosine blend from the previous R to the new one
        for (let a = 0; a < C; a++) {
          let yNew = X[a][q], yOld = X[a][q];
          if (R) { yNew = 0; for (let b = 0; b < C; b++) yNew += R[a * C + b] * X[b][q]; }
          if (A.Rprev) { yOld = 0; for (let b = 0; b < C; b++) yOld += A.Rprev[a * C + b] * X[b][q]; }
          const y = (1 - w) * yOld + w * yNew; dst[ch[a]][((i0 + q) % L + L) % L] = y; vin += X[a][q] * X[a][q]; vout += y * y;
        }
      }
      A.Rprev = R; A.stats.blocks++;
      A.removed = vin > 0 ? Math.max(0, 1 - vout / vin) : 0;
      if (A.removed > k.removedMasked) { A.stats.masked++; return { masked: true, t0: i0 / fs, t1: iEnd / fs, removed: A.removed }; }
      return { masked: false, removed: A.removed };
    };
    /* plain-array helper for tests: X = [Float32Array per channel], returns cleaned copies */
    A.processArray = function (X, isCleanAt) {
      const n = X[0].length, L = n + bn, src = X.map(x => { const a = new Float32Array(L); a.set(x); return a; }), dst = src.map(x => Float32Array.from(x)), all = []; for (let c = 0; c < C; c++) all.push(c);
      const save = ch.slice(); ch.length = 0; all.forEach(c => ch.push(c));
      for (let e = bn; e <= n; e += bn) A.step(e / fs, e, src, dst, L, isCleanAt ? (a, b) => isCleanAt(a, b) : () => true);
      ch.length = 0; save.forEach(c => ch.push(c));
      return dst.map(d => d.subarray(0, n));
    };
    A.gap = () => { A.Rprev = null; };
    A.calibrated = () => !!A.cal;
    A.removedFrac = () => Math.round(1000 * A.removed) / 1000;
    A.export = () => A.cal ? { M: Array.from(A.cal.M), T: Array.from(A.cal.T), thr: A.cal.thr, channels: ch.slice() } : null;
    A.debug = () => ({ calibrated: !!A.cal, cleanS: A.cleanS, blocks: A.stats.blocks, masked: A.stats.masked, removed: A.removed });
    return A;
  }

  /* accelerometer NLMS: reference = |accel| minus its 2 s running mean, interpolated to the EEG rate; per channel L taps, step mu */
  function NLMS(o) {
    o = Object.assign({ fs: 250, channels: [], cfg: null }, o);
    const k = Object.assign({ mu: 0.1, eps: 1e-6, maxTaps: 128, tapsS: 0.4 }, o.cfg || {}), fs = o.fs, Lt = Math.min(k.maxTaps, Math.round(k.tapsS * fs));
    const N = { ref: [], refT: [], w: o.channels.map(() => new Float64Array(Lt)), buf: new Float64Array(Lt), pos: 0, have: 0, lastRefT: -1e9, avg: [] };
    N.pushRef = function (t, x, y, z) { const m = Math.hypot(x, y, z); N.avg.push({ t, m }); while (N.avg.length && N.avg[0].t < t - 2) N.avg.shift();
      const mean = N.avg.reduce((s, a) => s + a.m, 0) / N.avg.length; N.refT.push(t); N.ref.push(m - mean); if (N.ref.length > 400) { N.ref.shift(); N.refT.shift(); } N.lastRefT = t; };
    function refAt(t) { const T = N.refT; if (!T.length || t > N.lastRefT + 0.5 || t < T[0]) return null; let i = T.length - 1; while (i > 0 && T[i - 1] > t) i--;
      if (i === 0 || T[i] <= t) return N.ref[Math.min(i, T.length - 1)]; const a = T[i - 1], b = T[i], f = (t - a) / (b - a || 1); return N.ref[i - 1] * (1 - f) + N.ref[i] * f; }
    /* sample i: reads xa, writes xc at ring position p */
    N.process = function (i, xa, xc, p) {
      const r = refAt(i / fs), have = r != null;
      N.buf[N.pos] = have ? r : 0; N.pos = (N.pos + 1) % Lt; if (have) N.have++;
      let rr = 0; for (let q = 0; q < Lt; q++) rr += N.buf[q] * N.buf[q];
      o.channels.forEach((c, j) => { const w = N.w[j]; let y = 0; for (let q = 0; q < Lt; q++) y += w[q] * N.buf[(N.pos - 1 - q + 2 * Lt) % Lt];
        const x = xa[c][p], e = x - y; xc[c][p] = e;
        if (have) { const g = k.mu * e / (rr + k.eps); for (let q = 0; q < Lt; q++) w[q] += g * N.buf[(N.pos - 1 - q + 2 * Lt) % Lt]; } });   // weights freeze while accel is missing
    };
    N.gap = () => { N.buf.fill(0); N.pos = 0; };
    N.taps = Lt;
    return N;
  }
  const API = { ASR, NLMS, calibrate, reconstruct, DEF };
  E.Clean = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
