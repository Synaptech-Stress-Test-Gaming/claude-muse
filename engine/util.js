/* engine/util.js
   Shared maths for the engine: seeded random numbers, robust statistics, ring buffers, biquad filters (RBJ cookbook),
   FFT, one-segment PSD, Goertzel, symmetric eigen-decomposition (cyclic Jacobi), Cholesky, small matrix helpers, line fit.
   Pure, no DOM. UMD: MuseEngine.Util in the page, require("./util.js") in Node. Tested by engine/util.test.js. */
"use strict";
(function (root) {
  const E = root.MuseEngine = root.MuseEngine || {};

  /* ---------- random numbers (mulberry32) ---------- */
  function rng(seed) {
    let a = (seed >>> 0) || 0x9e3779b9;
    let spare = null;
    const g = {
      next() { a = (a + 0x6D2B79F5) | 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; },
      normal() {
        if (spare != null) { const s = spare; spare = null; return s; }
        let u = 0, v = 0; while (u <= 1e-12) u = g.next(); v = g.next();
        const r = Math.sqrt(-2 * Math.log(u)); spare = r * Math.sin(2 * Math.PI * v); return r * Math.cos(2 * Math.PI * v);
      },
      range(lo, hi) { return lo + (hi - lo) * g.next(); },
      int(lo, hi) { return lo + Math.floor(g.next() * (hi - lo + 1)); }
    };
    return g;
  }

  /* ---------- statistics ---------- */
  const sortNum = a => Array.from(a).sort((x, y) => x - y);
  function quantile(s, q) { const n = s.length; if (!n) return NaN; const p = (n - 1) * q, i = Math.floor(p), f = p - i; return s[i] + (s[Math.min(i + 1, n - 1)] - s[i]) * f; }
  function median(a) { return quantile(sortNum(a), 0.5); }
  function mad(a, m) { if (m == null) m = median(a); return median(Array.from(a, v => Math.abs(v - m))); }
  const clamp = (x, lo, hi) => x < lo ? lo : x > hi ? hi : x;
  const clamp01 = x => clamp(x, 0, 1);
  function mean(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : NaN; }
  function variance(a, m) { if (m == null) m = mean(a); let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return a.length ? s / a.length : NaN; }
  function moment(a, k) { const m = mean(a), v = variance(a, m); let s = 0; for (let i = 0; i < a.length; i++) s += Math.pow(a[i] - m, k); return (s / a.length) / Math.pow(v, k / 2); }
  function kurtosis(a) { return moment(a, 4); }
  function skewness(a) { return moment(a, 3); }
  function pearson(a, b) {
    const n = Math.min(a.length, b.length); let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
    let s = 0, sa = 0, sb = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; s += x * y; sa += x * x; sb += y * y; }
    return sa > 0 && sb > 0 ? s / Math.sqrt(sa * sb) : 0;
  }
  const isNum = v => typeof v === "number" && isFinite(v);

  /* ---------- buffers ---------- */
  function Ring(n) {
    const d = new Float32Array(n); let pos = 0, count = 0;
    return {
      n, push(x) { d[pos] = x; pos = (pos + 1) % n; if (count < n) count++; },
      get(i) { return d[(pos - 1 - i + n * 2) % n]; },          // i = 0 is the newest
      get count() { return count; },
      copyLast(m, out) { m = Math.min(m, count); out = out || new Float32Array(m); for (let i = 0; i < m; i++) out[i] = d[(pos - m + i + n * 2) % n]; return out; },
      clear() { pos = 0; count = 0; }
    };
  }
  /* running median over the last windowN pushed values (sorted insertion; for update rates of 20 Hz or less) */
  function RunningMedian(windowN) {
    const q = [], s = [];
    const ins = v => { let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < v) lo = m + 1; else hi = m; } s.splice(lo, 0, v); };
    const del = v => { let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < v) lo = m + 1; else hi = m; } s.splice(lo, 1); };
    return {
      push(v) { q.push(v); ins(v); if (q.length > windowN) del(q.shift()); },
      median() { return quantile(s, 0.5); },
      quantile(p) { return quantile(s, p); },
      mad() { const m = quantile(s, 0.5); return median(s.map(v => Math.abs(v - m))); },
      get count() { return q.length; },
      values() { return s; },
      clear() { q.length = 0; s.length = 0; }
    };
  }

  /* ---------- biquads (RBJ cookbook, direct form I) ---------- */
  function Biquad(b0, b1, b2, a0, a1, a2) {
    const f = { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
    f.p = function (x) { const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2; this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y; };
    f.process = f.p;
    f.reset = function () { this.x1 = this.x2 = this.y1 = this.y2 = 0; };
    /* magnitude response at f Hz (for tests) */
    f.gainAt = function (fr, fs) { const w = 2 * Math.PI * fr / fs; const re = (c, s) => ({ c, s });
      const nr = this.b0 + this.b1 * Math.cos(-w) + this.b2 * Math.cos(-2 * w), ni = this.b1 * Math.sin(-w) + this.b2 * Math.sin(-2 * w);
      const dr = 1 + this.a1 * Math.cos(-w) + this.a2 * Math.cos(-2 * w), di = this.a1 * Math.sin(-w) + this.a2 * Math.sin(-2 * w); re(0, 0);
      return Math.hypot(nr, ni) / Math.hypot(dr, di); };
    return f;
  }
  function hp(fc, fs, Q) { Q = Q || Math.SQRT1_2; const w = 2 * Math.PI * fc / fs, c = Math.cos(w), al = Math.sin(w) / (2 * Q); return Biquad((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al); }
  function lp(fc, fs, Q) { Q = Q || Math.SQRT1_2; const w = 2 * Math.PI * fc / fs, c = Math.cos(w), al = Math.sin(w) / (2 * Q); return Biquad((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al); }
  function bp(f0, fs, Q) { const w = 2 * Math.PI * f0 / fs, c = Math.cos(w), al = Math.sin(w) / (2 * Q); return Biquad(al, 0, -al, 1 + al, -2 * c, 1 - al); }
  function notch(f0, fs, Q) { Q = Q || 30; const w = 2 * Math.PI * f0 / fs, c = Math.cos(w), al = Math.sin(w) / (2 * Q); return Biquad(1, -2 * c, 1, 1 + al, -2 * c, 1 - al); }
  /* one-pole DC blocker y[n] = x[n] - x[n-1] + r y[n-1]; the first sample after a reset primes x[n-1] (no start-up step) */
  function dcBlock(fc, fs) {
    const r = Math.exp(-2 * Math.PI * fc / fs);
    return { r, x1: null, y1: 0, p(x) { if (this.x1 == null) this.x1 = x; const y = x - this.x1 + this.r * this.y1; this.x1 = x; this.y1 = y; return y; }, reset() { this.x1 = null; this.y1 = 0; } };
  }
  /* centred-free moving average over n samples (causal) */
  function MovingAvg(n) { const b = new Float64Array(Math.max(1, n)); let i = 0, s = 0, c = 0; return { p(x) { s += x - b[i]; b[i] = x; i = (i + 1) % b.length; if (c < b.length) c++; return s / c; }, reset() { b.fill(0); i = 0; s = 0; c = 0; } }; }

  /* ---------- FFT, windows, spectra ---------- */
  function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }
  function ifft(re, im) { for (let i = 0; i < im.length; i++) im[i] = -im[i]; fft(re, im); const n = re.length; for (let i = 0; i < n; i++) { re[i] /= n; im[i] = -im[i] / n; } }
  const hannCache = {};
  function hann(n) { if (hannCache[n]) return hannCache[n]; const w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1 || 1)); return hannCache[n] = w; }
  /* one-sided PSD of one segment in uV^2/Hz: mean removed, Hann window, zero-padded to the next power of two */
  function psd(x, fs, i0, n) {
    i0 = i0 || 0; n = n == null ? x.length - i0 : n;
    const nfft = nextPow2(n), w = hann(n), re = new Float64Array(nfft), im = new Float64Array(nfft);
    let m = 0; for (let i = 0; i < n; i++) m += x[i0 + i]; m /= n;
    let sw = 0; for (let i = 0; i < n; i++) { re[i] = (x[i0 + i] - m) * w[i]; sw += w[i] * w[i]; }
    fft(re, im);
    const P = new Float64Array(nfft / 2 + 1), k0 = 2 / (fs * sw);
    for (let k = 0; k <= nfft / 2; k++) P[k] = k0 * (re[k] * re[k] + im[k] * im[k]);
    return { P, df: fs / nfft, nfft };
  }
  function bandPower(P, df, lo, hi) { let s = 0; const k0 = Math.ceil(lo / df - 1e-9); for (let k = Math.max(0, k0); k < P.length && k * df < hi; k++) s += P[k] * df; return s; }
  /* power (mean square) of the component at f Hz, by the Goertzel recursion over the whole array */
  function goertzelPower(x, f, fs, i0, n) {
    i0 = i0 || 0; n = n == null ? x.length - i0 : n;
    const w = 2 * Math.PI * f / fs, c = 2 * Math.cos(w); let s1 = 0, s2 = 0;
    for (let i = 0; i < n; i++) { const s = x[i0 + i] + c * s1 - s2; s2 = s1; s1 = s; }
    const re = s1 - s2 * Math.cos(w), im = s2 * Math.sin(w);
    return 2 * (re * re + im * im) / (n * n);
  }

  /* ---------- matrices (flat row-major Float64Array, n x n) ---------- */
  function jacobiEig(Ain, n) {
    const A = Float64Array.from(Ain), V = new Float64Array(n * n);
    for (let i = 0; i < n; i++) V[i * n + i] = 1;
    let tr = 0; for (let i = 0; i < n; i++) tr += Math.abs(A[i * n + i]);
    for (let sweep = 0; sweep < 60; sweep++) {
      let off = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i * n + j] * A[i * n + j];
      if (Math.sqrt(off) < 1e-12 * (tr || 1)) break;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q]; if (Math.abs(apq) < 1e-300) continue;
        const app = A[p * n + p], aqq = A[q * n + q], th = (aqq - app) / (2 * apq);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) { const akp = A[k * n + p], akq = A[k * n + q]; A[k * n + p] = c * akp - s * akq; A[k * n + q] = s * akp + c * akq; }
        for (let k = 0; k < n; k++) { const apk = A[p * n + k], aqk = A[q * n + k]; A[p * n + k] = c * apk - s * aqk; A[q * n + k] = s * apk + c * aqk; }
        for (let k = 0; k < n; k++) { const vkp = V[k * n + p], vkq = V[k * n + q]; V[k * n + p] = c * vkp - s * vkq; V[k * n + q] = s * vkp + c * vkq; }
      }
    }
    const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => A[a * n + a] - A[b * n + b]);
    const values = new Float64Array(n), vectors = new Float64Array(n * n);
    idx.forEach((src, dst) => { values[dst] = A[src * n + src]; for (let k = 0; k < n; k++) vectors[k * n + dst] = V[k * n + src]; });
    return { values, vectors };   // column j of `vectors` is the eigenvector of values[j]; values ascending
  }
  function cholesky(A, n) {
    const L = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
      let s = A[i * n + j]; for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
      if (i === j) { if (s <= 0) throw new Error("cholesky: matrix not positive definite"); L[i * n + i] = Math.sqrt(s); } else L[i * n + j] = s / L[j * n + j];
    }
    return L;
  }
  function matMul(A, B, n, m, p) { m = m == null ? n : m; p = p == null ? n : p; const C = new Float64Array(n * p); for (let i = 0; i < n; i++) for (let k = 0; k < m; k++) { const a = A[i * m + k]; if (a === 0) continue; for (let j = 0; j < p; j++) C[i * p + j] += a * B[k * p + j]; } return C; }
  function transpose(A, n, m) { m = m == null ? n : m; const T = new Float64Array(n * m); for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) T[j * n + i] = A[i * m + j]; return T; }
  /* function of a symmetric matrix: V diag(f(lambda)) V^T */
  function symFn(A, n, fn) { const { values, vectors } = jacobiEig(A, n); const R = new Float64Array(n * n);
    for (let k = 0; k < n; k++) { const f = fn(values[k]); if (f === 0) continue; for (let i = 0; i < n; i++) { const vi = vectors[i * n + k] * f; for (let j = 0; j < n; j++) R[i * n + j] += vi * vectors[j * n + k]; } } return R; }
  function pinvSym(A, n, tol) { const { values } = jacobiEig(A, n); const mx = Math.max(...Array.from(values, Math.abs)); const th = tol == null ? 1e-10 * mx : tol; return symFn(A, n, l => Math.abs(l) > th ? 1 / l : 0); }
  function sqrtmSym(A, n) { return symFn(A, n, l => Math.sqrt(Math.max(0, l))); }
  /* general (non-symmetric) square inverse with partial pivoting; for small matrices */
  function inv(A, n) {
    const M = Float64Array.from(A), I = new Float64Array(n * n); for (let i = 0; i < n; i++) I[i * n + i] = 1;
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r * n + c]) > Math.abs(M[p * n + c])) p = r;
      if (Math.abs(M[p * n + c]) < 1e-300) return null;
      if (p !== c) for (let k = 0; k < n; k++) { let t = M[c * n + k]; M[c * n + k] = M[p * n + k]; M[p * n + k] = t; t = I[c * n + k]; I[c * n + k] = I[p * n + k]; I[p * n + k] = t; }
      const d = M[c * n + c]; for (let k = 0; k < n; k++) { M[c * n + k] /= d; I[c * n + k] /= d; }
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r * n + c]; if (f === 0) continue; for (let k = 0; k < n; k++) { M[r * n + k] -= f * M[c * n + k]; I[r * n + k] -= f * I[c * n + k]; } }
    }
    return I;
  }
  /* Moore-Penrose pseudo-inverse of a general n x m matrix via the symmetric one: pinv(A) = pinvSym(A^T A) A^T */
  function pinv(A, n, m) { const At = transpose(A, n, m); const AtA = matMul(At, A, m, n, m); return matMul(pinvSym(AtA, m), At, m, m, n); }

  function linfit(x, y) {
    const n = x.length; let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; sxy += x[i] * y[i]; }
    const d = n * sxx - sx * sx, slope = d ? (n * sxy - sx * sy) / d : 0;
    return { slope, intercept: (sy - slope * sx) / n };
  }
  /* deep merge of plain objects (b over a), arrays replaced */
  function deepMerge(a, b) {
    if (b == null) return a; if (a == null || typeof a !== "object" || Array.isArray(a) || typeof b !== "object" || Array.isArray(b)) return b;
    const o = Object.assign({}, a); for (const k of Object.keys(b)) o[k] = deepMerge(a[k], b[k]); return o;
  }
  const clone = o => JSON.parse(JSON.stringify(o));

  const API = { rng, sortNum, quantile, median, mad, clamp, clamp01, mean, variance, kurtosis, skewness, pearson, isNum, Ring, RunningMedian,
    Biquad, hp, lp, bp, notch, dcBlock, MovingAvg, nextPow2, fft, ifft, hann, psd, bandPower, goertzelPower,
    jacobiEig, cholesky, matMul, transpose, symFn, pinvSym, sqrtmSym, inv, pinv, linfit, deepMerge, clone };
  E.Util = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
