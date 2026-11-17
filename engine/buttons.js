/* engine/buttons.js
   BUTTONS on the Cyton: events, not scores. Emitted through eng.onEvent at once and also listed in output.events. Not emitted on the Muse.
   double_blink: two blink_voluntary events whose peaks are 150-600 ms apart, with no third blink peak within 400 ms after the second peak;
     emitted at max(second blink offset, second peak + 400 ms) (Julian's document: 600 ms; 400 ms keeps the 400 ms latency target).
     Suppressed while the motion gate is not VALID and within 300 ms of a saccade. Refractory 800 ms. conf = the smaller blink confidence.
   clench_tap: an emg_burst labelled clench (T7 and T8 >= 3x baseline, one burst of 200-600 ms), no other burst in the preceding 1.5 s,
     neither chewing nor talking active (look-back only: a look-ahead would break the latency target); while talking was active in the last 3 s
     the ratio needed is x1.5 (4.5). Refractory 500 ms. Emitted at the burst offset.
   Every event carries conf and a unique increasing id (the pipeline assigns ids).
   UMD: MuseEngine.Buttons. Tested by engine/buttons.test.js. */
"use strict";
(function (root) {
  const E = root.MuseEngine = root.MuseEngine || {};
  const DEF = { dbMinMs: 150, dbMaxMs: 600, thirdMs: 400, refrDbMs: 800, refrClMs: 500, saccadeMs: 300, preQuietS: 1.5, talkBoost: 1.5, ratioIn: 3.0 };
  function create(o) {
    o = Object.assign({ device: "cyton", cfg: null }, o);
    const k = Object.assign({}, DEF, o.cfg || {}), on = o.device === "cyton";
    const B = { vol: [], blinks: [], pend: null, lastDb: -1e9, lastCl: -1e9, lastSacc: -1e9, bursts: [], out: [] };
    /* feed finalised detector events (with the gate state and the detector's activity at that time) */
    B.onEvents = function (evs, ctx) {
      for (const e of evs) {
        if (e.type === "saccade") B.lastSacc = e.onset;
        if (e.type === "blink" || e.type === "blink_voluntary") {
          B.blinks.push(e); if (B.blinks.length > 20) B.blinks.shift();
          if (B.pend && e.peak > B.pend.peak2 && e.peak - B.pend.peak2 <= k.thirdMs / 1000) B.pend = null;     // a third blink: not a double blink
          if (e.type === "blink_voluntary") {
            const prev = B.vol[B.vol.length - 1];
            if (prev && !prev.used && !B.pend) { const d = (e.peak - prev.peak) * 1000;
              if (d >= k.dbMinMs && d <= k.dbMaxMs) { prev.used = e.used = true; B.pend = { peak1: prev.peak, peak2: e.peak, off2: e.offset, conf: Math.min(prev.conf, e.conf), sign: e.sign || 0, emitAt: Math.max(e.offset, e.peak + k.thirdMs / 1000), gateOk: ctx.gateValid, onset: prev.onset }; } }
            B.vol.push(e); if (B.vol.length > 20) B.vol.shift();
          }
        }
        if (e.type === "emg_burst") {
          const prevEnd = B.bursts.length ? B.bursts[B.bursts.length - 1].offset : -1e9; B.bursts.push(e); if (B.bursts.length > 20) B.bursts.shift();
          if (!on || e.sub !== "clench") continue;
          const quiet = e.onset - prevEnd >= k.preQuietS, need = e.talkRecent ? k.ratioIn * k.talkBoost : k.ratioIn;
          if (quiet && !e.chewing && !e.talking && e.amp >= need && e.offset - B.lastCl >= k.refrClMs / 1000 && ctx.gateValid !== false) {
            B.lastCl = e.offset; B.out.push({ type: "clench_tap", t: ctx.t, onset: e.onset, offset: e.offset, conf: e.conf, channels: e.channels, amp: e.amp, durMs: e.durMs, sub: null }); }
        }
      }
    };
    /* every tick: emit a pending double blink once its time has come */
    B.tick = function (t, ctx) {
      if (B.pend && t >= B.pend.emitAt) {
        // a third blink may be forming (a candidate that started after the second blink, or one split off its falling edge): wait for it
        // (the eye signal is up again by at least the blink threshold: a falling tail of the second blink does not count)
        const open = ctx.blinkOpenSince != null && ctx.blinkOpenSince >= B.pend.off2 - 0.05 && ctx.blinkOpenSince <= B.pend.peak2 + k.thirdMs / 1000;
        if (open && (ctx.blinkOpenLevel || 0) >= 1.0) B.pend.sawRise = true;           // up by at least the blink threshold A
        if (open && B.pend.sawRise && t < B.pend.emitAt + 0.6) return drain();   // a third blink may be forming: wait for it
        const p = B.pend; B.pend = null;
        const okGate = ctx.gateValid !== false && p.gateOk !== false, okSacc = Math.abs(p.peak1 - B.lastSacc) > k.saccadeMs / 1000 && Math.abs(p.peak2 - B.lastSacc) > k.saccadeMs / 1000;
        if (on && okGate && okSacc && p.peak2 - B.lastDb >= k.refrDbMs / 1000) { B.lastDb = p.peak2; B.out.push({ type: "double_blink", t, onset: p.onset, offset: p.off2, peak: p.peak2, conf: p.conf, channels: null, amp: null, durMs: (p.off2 - p.onset) * 1000, sub: null }); }
      }
      return drain();
    };
    function drain() { const e = B.out; B.out = []; return e; }
    return B;
  }
  const API = { create, DEF };
  E.Buttons = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
