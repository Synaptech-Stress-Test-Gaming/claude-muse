/* engine/contact.js
   Contact quality 0-100 per channel, once per second.
   Muse: the panel's value (frame.contact, RMS based) is used as it is.
   Cyton, from the last 1 s: q = min(sRail, sRms, sLine, sImp), smoothed Q <- Q + 0.5 (q - Q).
     sRail 0 if more than 2% of raw samples are at |x| >= 178 125 uV, else 100
     sRms  from the RMS of xa: 0 below 1 uV, 0->100 from 1 to 3, 100 from 3 to 80 (dry-electrode range), 100->0 from 80 to 190 (prompt: 200; changed so a 150 uV channel scores < 40, see docs/IMPLEMENTATION_NOTES.md), 0 above
     sLine from the mains power (Goertzel on the DC-blocked, un-notched signal) / 1-45 Hz power: 100 up to 2, linear in log10 to 30 at 20, 30 above
     sImp  from an impedance result of the last 30 min: 100 up to 750 kOhm, 100->40 up to 2500 kOhm, 20 above
   Exclusion with hysteresis: excluded when Q < 40, back in after Q >= 50 for 3 consecutive seconds.
   UMD: MuseEngine.Contact. Tested by engine/contact.test.js. */
"use strict";
(function (root) {
  const E = root.MuseEngine = root.MuseEngine || {};
  const U = E.Util || (typeof require !== "undefined" ? require("./util.js") : null);
  const DEF = { railUv: 178125, railFrac: 0.02, rmsLo: 1, rmsGood: 3, rmsHi: 80, rmsMax: 190, lineGood: 2, lineBad: 20, impGood: 750, impBad: 2500, impMaxAgeS: 1800, exclude: 40, include: 50, includeS: 3 };

  function scoreRms(r, k) { if (!(r >= k.rmsLo)) return 0; if (r < k.rmsGood) return 100 * (r - k.rmsLo) / (k.rmsGood - k.rmsLo); if (r <= k.rmsHi) return 100; if (r < k.rmsMax) return 100 * (k.rmsMax - r) / (k.rmsMax - k.rmsHi); return 0; }
  function scoreLine(lr, k) { if (!(lr > k.lineGood)) return 100; if (lr >= k.lineBad) return 30; return 100 - 70 * Math.log10(lr / k.lineGood) / Math.log10(k.lineBad / k.lineGood); }
  function scoreImp(kohm, k) { if (kohm == null || kohm <= k.impGood) return 100; if (kohm <= k.impBad) return 100 - 60 * (kohm - k.impGood) / (k.impBad - k.impGood); return 20; }

  function create(o) {
    o = Object.assign({ fs: 250, device: "cyton", channels: [], eegIdx: null, mains: 60, cfg: null }, o);
    const k = Object.assign({}, DEF, o.cfg || {}), C = o.channels.length, eeg = o.eegIdx || o.channels.map((_, i) => i);
    const S = { Q: new Array(C).fill(null), q: new Array(C).fill(null), excluded: new Array(C).fill(false), goodRun: new Array(C).fill(0), since: new Array(C).fill(null),
      imp: new Array(C).fill(null), impAt: new Array(C).fill(-1e9), events: [], detail: new Array(C).fill(null) };
    function hysteresis(c, t) {
      const Q = S.Q[c];
      if (!S.excluded[c]) { if (Q < k.exclude) { S.excluded[c] = true; S.since[c] = t; S.goodRun[c] = 0; S.events.push({ type: "bad_contact", phase: "start", onset: t, channels: [o.channels[c]], t }); } }
      else { if (Q >= k.include) S.goodRun[c]++; else S.goodRun[c] = 0;
        if (S.goodRun[c] >= k.includeS) { S.excluded[c] = false; S.events.push({ type: "bad_contact", phase: "end", onset: S.since[c], offset: t, channels: [o.channels[c]], t, durMs: (t - S.since[c]) * 1000 }); S.since[c] = null; S.goodRun[c] = 0; } }
    }
    /* Cyton: get(c) -> {raw, xd, xa} arrays of the last 1 s for channel c */
    function update(t, get) {
      for (const c of eeg) {
        const w = get(c); if (!w || !w.raw || w.raw.length < o.fs * 0.5) continue;
        let rail = 0; for (let i = 0; i < w.raw.length; i++) if (Math.abs(w.raw[i]) >= k.railUv) rail++;
        const railedFrac = rail / w.raw.length, r = Math.sqrt(U.variance(w.xa));
        let lineRatio = 0;
        if (o.mains < o.fs / 2) { const m = U.mean(w.xd), d = Float64Array.from(w.xd, v => v - m); const pl = U.goertzelPower(d, o.mains, o.fs); const { P, df } = U.psd(d, o.fs); const pb = U.bandPower(P, df, 1, 45); lineRatio = pl / Math.max(pb, 1e-12); }
        const kohm = t - S.impAt[c] <= k.impMaxAgeS ? S.imp[c] : null;
        const q = Math.min(railedFrac > k.railFrac ? 0 : 100, scoreRms(r, k), scoreLine(lineRatio, k), scoreImp(kohm, k));
        S.q[c] = q; S.Q[c] = S.Q[c] == null ? q : S.Q[c] + 0.5 * (q - S.Q[c]);
        S.detail[c] = { railedFrac, rms: r, lineRatio, kohm };
        hysteresis(c, t);
      }
    }
    /* Muse: the panel's values */
    function passthrough(t, values) { for (const c of eeg) { const v = values[c]; if (v == null) continue; S.q[c] = v; S.Q[c] = v; hysteresis(c, t); } }
    function setImpedance(c, kohm, t) { S.imp[c] = kohm; S.impAt[c] = t; }
    function excludedNames() { return eeg.filter(c => S.excluded[c]).map(c => o.channels[c]); }
    function drain() { const e = S.events; S.events = []; return e; }
    function reset() { S.Q.fill(null); S.excluded.fill(false); S.goodRun.fill(0); S.since.fill(null); }
    return { update, passthrough, setImpedance, excludedNames, drain, reset, state: S, isExcluded: c => S.excluded[c] };
  }
  const API = { create, scoreRms, scoreLine, scoreImp, DEF };
  E.Contact = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
