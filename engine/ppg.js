/* engine/ppg.js
   Heart rate and HRV from the Muse forehead pulse (the panel's 0.7-3.5 Hz band-passed PL.bp samples, 64 Hz, NaN = missing).
   Uses Stress.findBeats and Stress.ibisFromBeats from stress.js by reference, on sample positions (stream time), not arrival times.
   hr8 from the last 8 s (>= 4 intervals), falling back to aux.ppgHr (the panel's autocorrelation rate) when beats are too few;
   lnRmssd over 30-60 s with >= 15 intervals, step 5 s. The Muse PPG RMSSD reads about 1.9x high against ECG, so it is only used as a
   relative change (z-scored against the person's own Muse history, with its own prior).
   UMD: MuseEngine.Ppg. Tested by engine/ppg.test.js (P1). */
"use strict";
(function (root) {
  const E = root.MuseEngine = root.MuseEngine || {};
  const getStress = () => root.Stress || (typeof require !== "undefined" ? require("../stress.js") : null);

  function create(o) {
    o = Object.assign({ fs: 64, keepS: 70 }, o);
    const St = o.Stress || getStress(), fs = o.fs;
    const S = { t0: null, x: [], lastT: null, nextHrv: 5, hrv: null, auxHr: null, beats: [] };
    /* a chunk of pulse samples starting at stream time t0 */
    function push(chunk, auxHr) {
      if (auxHr != null) S.auxHr = auxHr;
      if (!chunk || !chunk.data || !chunk.data.length) return;
      let t = chunk.t0;
      if (S.t0 == null) { S.t0 = t; S.lastT = t - 1 / fs; }
      const expect = S.lastT + 1 / fs;
      if (t > expect + 0.5 / fs) { const miss = Math.round((t - expect) * fs); for (let k = 0; k < miss && k < fs * 10; k++) S.x.push(NaN); }   // a hole stays a hole (NaN)
      else if (t < expect - 0.5 / fs) { const over = Math.round((expect - t) * fs); chunk = { data: chunk.data.slice(over) }; }   // overlap: keep the clock
      for (const v of chunk.data) S.x.push(v);
      S.lastT = S.t0 + (S.x.length - 1) / fs;
      const keep = Math.round(o.keepS * fs); if (S.x.length > keep + 10 * fs) { const cut = S.x.length - keep; S.x.splice(0, cut); S.t0 += cut / fs; }
    }
    function beatsIn(t0, t1) {
      const i0 = Math.max(0, Math.round((t0 - S.t0) * fs)), i1 = Math.min(S.x.length, Math.round((t1 - S.t0) * fs)); if (i1 - i0 < fs * 3) return [];
      const seg = Float32Array.from(S.x.slice(i0, i1));
      return St.findBeats(seg, fs).map(p => S.t0 + (i0 + p) / fs);
    }
    function hop(t) {
      if (S.t0 == null) return { t, hr8: S.auxHr, lnRmssd: null, rmssdMs: null, hrvNew: false, quality: 0, state: S.auxHr != null ? "aux" : "none" };
      const tEnd = Math.min(t, S.lastT);
      const b8 = beatsIn(tEnd - 8, tEnd), ibi8 = St.ibisFromBeats(b8);
      let hr8 = ibi8.length >= 4 ? 60000 / (ibi8.reduce((a, b) => a + b, 0) / ibi8.length) : null, src = "beats";
      if (hr8 == null) { hr8 = S.auxHr; src = S.auxHr != null ? "aux" : "none"; }
      let hrvNew = false;
      if (t >= S.nextHrv) { S.nextHrv = t + 5; const span = Math.min(60, tEnd - S.t0);
        if (span >= 30) { const ib = St.ibisFromBeats(beatsIn(tEnd - span, tEnd)); const r = ib.length >= 15 ? St.rmssd(ib) : null; S.hrv = r ? { lnRmssd: Math.log(r), rmssd: r } : null; } else S.hrv = null;
        hrvNew = true; }
      const nanFrac = (() => { const n = Math.min(S.x.length, 8 * fs); let k = 0; for (let i = S.x.length - n; i < S.x.length; i++) if (!(S.x[i] === S.x[i])) k++; return n ? k / n : 1; })();
      const quality = src === "beats" ? Math.max(0, 1 - nanFrac) : src === "aux" ? 0.5 : 0;
      return { t, hr8, lnRmssd: S.hrv ? S.hrv.lnRmssd : null, rmssdMs: S.hrv ? S.hrv.rmssd : null, hrvNew, quality, state: src, beats8: b8.length };
    }
    function reset() { S.t0 = null; S.x = []; S.hrv = null; }
    return { push, hop, reset, beatsIn, state: S };
  }
  const API = { create };
  E.Ppg = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
