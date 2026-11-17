/* engine/frame.js
   The common frame format (adapter -> engine), its validation, the stream clock and gap bookkeeping.
   A gap of n samples before index i spans stream time [(i - n)/fs, i/fs]. Lost samples are never filled in.
   Pure, no DOM. UMD: MuseEngine.Frame. Tested by engine/frame.test.js. */
"use strict";
(function (root) {
  const E = root.MuseEngine = root.MuseEngine || {};

  function fail(msg) { throw new Error("Bad frame: " + msg); }
  const isArr = a => a && (Array.isArray(a) || ArrayBuffer.isView(a));
  function validate(f) {
    if (!f || typeof f !== "object") fail("not an object");
    if (f.device !== "muse" && f.device !== "cyton") fail("device must be muse or cyton (got " + f.device + ")");
    if (!(typeof f.fs === "number" && f.fs >= 100)) fail("fs must be a number >= 100 (got " + f.fs + ")");
    if (!Array.isArray(f.channels) || !f.channels.length) fail("channels must be a non-empty array of names");
    if (!Number.isInteger(f.sampleIndex) || f.sampleIndex < 0) fail("sampleIndex must be a non-negative integer");
    if (!Array.isArray(f.samples) || f.samples.length !== f.channels.length) fail("samples must have one array per channel");
    const n = f.samples[0] ? f.samples[0].length : -1;
    if (!(n >= 1)) fail("each channel needs at least 1 sample");
    for (let c = 0; c < f.samples.length; c++) {
      const a = f.samples[c]; if (!isArr(a) || a.length !== n) fail("channel " + f.channels[c] + " has " + (a && a.length) + " samples, expected " + n);
      for (let i = 0; i < n; i++) if (!(a[i] === a[i]) || !isFinite(a[i])) fail("channel " + f.channels[c] + " sample " + i + " is not a finite number");
    }
    if (f.t0 != null && Math.abs(f.t0 - f.sampleIndex / f.fs) > 1e-6) fail("t0 must equal sampleIndex / fs");
    if (f.gaps != null) { if (!Array.isArray(f.gaps)) fail("gaps must be an array"); f.gaps.forEach(g => { if (!(Number.isInteger(g.at) && g.n >= 1)) fail("gap entries need integer at and n >= 1"); }); }
    for (const k of ["accel", "gyro"]) if (f[k] != null) { const m = f[k]; if (!isArr(m.t) || !isArr(m.xyz) || m.xyz.length !== 3 * m.t.length) fail(k + " needs t and interleaved xyz of 3 x length"); }
    if (f.ppg != null && (!isArr(f.ppg.data) || !(f.ppg.fs > 0) || typeof f.ppg.t0 !== "number")) fail("ppg needs fs, t0 and data");
    if (f.ecg != null && (!isArr(f.ecg.data) || f.ecg.data.length !== n)) fail("ecg data must have the same length as the EEG samples");
    if (f.contact != null && (!Array.isArray(f.contact) || f.contact.length !== f.channels.length)) fail("contact needs one value per channel");
    return true;
  }
  function makeClock(fs) { return { fs, t: idx => idx / fs, idx: t => Math.round(t * fs) }; }

  function GapBook() {
    const list = [];
    return {
      add(at, n, fs) { const g = { t0: (at - n) / fs, t1: at / fs, at, n }; list.push(g); return g; },
      list() { return list; },
      prune(tMin) { while (list.length && list[0].t1 < tMin) list.shift(); },
      overlaps(t0, t1) { return list.some(g => g.t1 > t0 && g.t0 < t1); },
      lostIn(t0, t1) { let s = 0; for (const g of list) s += Math.max(0, Math.min(t1, g.t1) - Math.max(t0, g.t0)); return s; },
      clear() { list.length = 0; }
    };
  }
  const API = { validate, makeClock, GapBook };
  E.Frame = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
