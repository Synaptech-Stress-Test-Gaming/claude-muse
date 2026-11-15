/* engine/pipeline.js
   MuseEngine.CONFIG (every tunable constant) and MuseEngine.create(): wires the stages in the fixed order.
   Skeleton: ingest + gap bookkeeping + hop clock; every metric is "unavailable". The stages are added in later steps. */
"use strict";
(function (root) {
  const E = root.MuseEngine = root.MuseEngine || {};
  const req = (name, file) => E[name] || (typeof require !== "undefined" ? require(file) : null);
  const U = req("Util", "./util.js");

  const CONFIG = {
    hop: 0.25, win: 2, delay: 0.5, delayAsrExtra: 0.5, holdS: 3.0, staleRestartS: 30, keepS: 30
  };
  E.CONFIG = CONFIG;

  function create(opts) {
    const Fr = req("Frame", "./frame.js");
    opts = Object.assign({ device: "muse", fs: 256, channels: null, ecgChannel: -1, mains: 60, flags: null, priors: E.PRIORS || null, tuned: E.TUNED || null, store: null, legacyProvider: null, ownerBaseRate: 0.7 }, opts);
    const cfg = U.deepMerge(CONFIG, opts.tuned && opts.tuned.config ? opts.tuned.config : null);
    const st = { streamId: null, n: 0, lastIdx: -1, nextHop: null, out: null, gaps: Fr.GapBook() };
    const eng = { onEvent: null, cfg };
    function output(t) {
      const na = r => ({ value: null, conf: 0, state: "unavailable", reason: r || null });
      const lg = opts.legacyProvider ? opts.legacyProvider() : null;
      return { t, device: opts.device, profile: { id: null, label: null, confidence: 0, state: "uncertain", badge: "Identifying…" },
        focus: na(), stress: Object.assign(na(), { components: { hr: { z: null, valid: false, bpm: null }, hrv: { z: null, valid: false, rmssdMs: null }, eeg: { z: null, valid: false } }, exertion: false }),
        drowsiness: opts.device === "cyton" ? Object.assign(na(), { markers: {} }) : null, events: [],
        quality: { perChannel: [], excluded: [], ecg: null, motion: "no_data", packetLoss: 0, asr: null, warnings: [] }, legacy: { focus: lg ? lg.focus : null, stress: lg ? lg.stress : null } };
    }
    eng.push = function (f) {
      Fr.validate(f);
      if (st.streamId !== f.streamId) { st.streamId = f.streamId; st.lastIdx = f.sampleIndex - 1; st.nextHop = null; }
      (f.gaps || []).forEach(g => st.gaps.add(g.at, g.n, f.fs));
      st.lastIdx = f.sampleIndex + f.samples[0].length - 1;
      const t = (st.lastIdx + 1) / f.fs, outs = [];
      if (st.nextHop == null) st.nextHop = Math.ceil(t / cfg.hop) * cfg.hop;
      while (st.nextHop <= t + 1e-9) { st.out = output(st.nextHop); outs.push(st.out); st.nextHop += cfg.hop; }
      return outs;
    };
    eng.idle = function () { return st.out; };
    eng.output = () => st.out;
    eng.endSession = () => null;
    eng.debug = () => st;
    return eng;
  }
  E.create = create;
  const API = { CONFIG, create };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
