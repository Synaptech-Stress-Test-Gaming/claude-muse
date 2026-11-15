/* adapters/muse.js
   Turns the panel's Muse buffers into engine frames (engine/frame.js format).
   Fed by the tap lines in panel/dsp.js (emit), panel/pulse.js (onPpg), panel/motion.js (onMotion) through panel/engine-link.js.
   The panel's own maths is not touched: this only copies values out.
   - EEG: ys from emit() (offset-removed uV). sampleIndex = idx - idx0. The first 2 s after a reset are skipped (the panel's offset filter is settling).
     A jump of the aligned index by more than 1 becomes a gap of (jump - 1) samples; nothing is filled. 12 samples per frame (about 47 ms).
   - Pulse: the samples appended to PL.bp since the last call (PL.mk = 0 -> NaN). Times are sample positions on a 64 Hz clock anchored to the EEG stream.
   - Motion: 3 samples per packet, wall time now - (2 - k) * 1000/52 ms (like onMotion), mapped to stream time.
   Wall-clock mapping: on every emitted EEG frame wallOffset = Date.now()/1000 - (sampleIndex + n)/256.
   Pure apart from the getters passed in. UMD: MuseEngine.Adapters.Muse. Tested by adapters/muse.test.js. */
"use strict";
(function (root) {
  const E = root.MuseEngine = root.MuseEngine || {};
  E.Adapters = E.Adapters || {};

  function create(o) {
    o = Object.assign({ fs: 256, channels: ["TP9", "AF7", "AF8", "TP10"], frameN: 12, settleN: 512, now: () => Date.now(), getContact: () => null, getPL: () => null, motionTh: null }, o);
    const fs = o.fs, C = o.channels.length;
    const A = { streamId: 1, idx0: null, lastIdx: null, buf: o.channels.map(() => []), bufStart: null, pendingGap: null, wallOffset: null,
      ppgQ: [], ppgT: null, ppgPos: null, ppgFilled: 0, accQ: [], gyrQ: [], frames: 0 };
    function flush() {
      const n = A.buf[0].length; if (!n) return;
      const si = A.bufStart, f = { device: "muse", streamId: A.streamId, fs, channels: o.channels.slice(), sampleIndex: si, t0: si / fs,
        samples: A.buf.map(b => Float32Array.from(b)), gaps: A.pendingGap ? [A.pendingGap] : [], accel: null, gyro: null, ppg: null, ecg: null,
        contact: null, aux: { ppgHr: null, flags: { impedance: false, simulated: false } } };
      A.pendingGap = null; A.buf.forEach(b => { b.length = 0; }); A.bufStart = null;
      A.wallOffset = o.now() / 1000 - (si + n) / fs;
      const c = o.getContact(); f.contact = c ? Array.from(c, v => v == null ? 0 : v) : o.channels.map(() => 0);
      const pl = o.getPL(); if (pl && (pl.state === "LIVE" || pl.state === "WEAK") && pl.bpm != null) f.aux.ppgHr = pl.bpm;
      if (A.ppgQ.length) { f.ppg = { fs: 64, t0: A.ppgQ[0].t, data: Float32Array.from(A.ppgQ, s => s.v) }; A.ppgQ.length = 0; }
      const mk = (q, kind) => { if (!q.length) return null; const r = { fs: 52, t: Float64Array.from(q, s => s.t), xyz: new Float32Array(q.length * 3) }; q.forEach((s, i) => { r.xyz[3 * i] = s.x; r.xyz[3 * i + 1] = s.y; r.xyz[3 * i + 2] = s.z; }); q.length = 0; return r; };
      f.accel = mk(A.accQ); f.gyro = mk(A.gyrQ);
      A.frames++;
      if (o.onFrame) o.onFrame(f);
      return f;
    }
    function eeg(ys, idx) {
      if (A.lastIdx != null && idx <= A.lastIdx) reset();                    // the panel restarted its index (alignment mode change): new stream
      if (A.idx0 == null) A.idx0 = idx;
      const si = idx - A.idx0;
      if (A.lastIdx != null) { const jump = idx - A.lastIdx; if (jump > 1 && si >= o.settleN) { flush(); const lostBefore = Math.max(0, Math.min(jump - 1, si - o.settleN)); if (lostBefore > 0) A.pendingGap = { at: si, n: lostBefore }; } }
      A.lastIdx = idx;
      if (si < o.settleN) return;
      if (A.bufStart == null) A.bufStart = si;
      for (let c = 0; c < C; c++) A.buf[c].push(ys[c]);
      if (A.buf[0].length >= o.frameN) flush();
    }
    function streamT(wallMs) { return A.wallOffset == null ? null : wallMs / 1000 - A.wallOffset; }
    function ppg() {
      const pl = o.getPL(); if (!pl || !pl.bp) return;
      const L = pl.bp.length;
      if (A.ppgPos == null || pl.filled < A.ppgFilled) { A.ppgPos = pl.bpPos; A.ppgFilled = pl.filled; A.ppgQ.length = 0; A.ppgT = null; return; }
      const m = (pl.bpPos - A.ppgPos + L) % L; A.ppgFilled = pl.filled;
      if (!m) return;
      const tNew = streamT(o.now()); if (tNew == null) { A.ppgPos = pl.bpPos; return; }
      const tFirst = tNew - (m - 1) / 64;
      if (A.ppgT == null || Math.abs(A.ppgT - tFirst) > 0.5) A.ppgT = tFirst;               // re-anchor the 64 Hz clock only when it drifted
      for (let k = 0; k < m; k++) { const i = (A.ppgPos + k) % L; A.ppgQ.push({ t: A.ppgT, v: pl.mk[i] ? pl.bp[i] : NaN }); A.ppgT += 1 / 64; }
      A.ppgPos = pl.bpPos;
      if (A.ppgQ.length > 64 * 4) A.ppgQ.splice(0, A.ppgQ.length - 64 * 4);
    }
    function motion(kind, v, now) {
      now = now == null ? o.now() : now; const q = kind === "acc" ? A.accQ : A.gyrQ;
      for (let k = 0; k < 3 && 3 * k + 2 < v.length; k++) { const t = streamT(now - (2 - k) * 1000 / 52); if (t == null) continue; q.push({ t, x: v[3 * k], y: v[3 * k + 1], z: v[3 * k + 2] }); }
      if (q.length > 52 * 4) q.splice(0, q.length - 52 * 4);
    }
    function reset() {
      A.streamId++; A.idx0 = null; A.lastIdx = null; A.buf.forEach(b => { b.length = 0; }); A.bufStart = null; A.pendingGap = null; A.wallOffset = null;
      A.ppgQ.length = 0; A.ppgT = null; A.ppgPos = null; A.ppgFilled = 0; A.accQ.length = 0; A.gyrQ.length = 0;
    }
    return { eeg, ppg, motion, reset, flush, state: A, get streamId() { return A.streamId; } };
  }
  const API = { create };
  E.Adapters.Muse = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
