/* engine/preproc.js
   Per-channel causal filters (state reset after every gap):
     xd = dcBlock(0.5 Hz)                       DC removed, not notched (contact line-noise ratio)
     xb = notch(mains, Q 30) of xd              used by the event detectors and contact (notch skipped when mains > fs/2 - 2)
     xa = low-pass min(45, fs/2 - 5) Hz twice   used by ASR, NLMS and the spectral features
   At 125 Hz per channel the 120 Hz mains harmonic folds to 5 Hz (inside theta); the helper measures it (tools/README.md).
   The RBJ notch at 60 Hz with fs 125 sits close to Nyquist and is very narrow: it needs about 4 s to settle after a reset.
   UMD: MuseEngine.Preproc. Tested by engine/preproc.test.js. */
"use strict";
(function (root) {
  const E = root.MuseEngine = root.MuseEngine || {};
  const U = E.Util || (typeof require !== "undefined" ? require("./util.js") : null);

  function create(o) {
    o = Object.assign({ fs: 250, mains: 60, nCh: 1, dcHz: 0.5, notchQ: 30, lpMax: 45 }, o);
    const fs = o.fs, lpHz = Math.min(o.lpMax, fs / 2 - 5), useNotch = o.mains <= fs / 2 - 2;
    const ch = [];
    function mk() { return { dc: U.dcBlock(o.dcHz, fs), nt: useNotch ? U.notch(o.mains, fs, o.notchQ) : null, l1: U.lp(lpHz, fs), l2: U.lp(lpHz, fs) }; }
    for (let c = 0; c < o.nCh; c++) ch.push(mk());
    const P = { fs, lpHz, useNotch, xd: 0, xb: 0, xa: 0,
      run(c, x) { const s = ch[c]; const d = s.dc.p(x), b = s.nt ? s.nt.p(d) : d; this.xd = d; this.xb = b; this.xa = s.l2.p(s.l1.p(b)); return this.xb; },
      reset(c) { ch[c] = mk(); },
      resetAll() { for (let c = 0; c < ch.length; c++) ch[c] = mk(); } };
    return P;
  }
  const API = { create };
  E.Preproc = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
