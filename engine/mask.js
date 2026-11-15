/* engine/mask.js
   Mask timeline: masked intervals {t0, t1, reason, chans (channel indices) | null = all}, pruned after 30 s, plus open (pending) masks
   and window flags (eyes closed).
   | event                        | mask start     | mask end                                         | channels                          | reason      |
   | blink, blink_voluntary       | onset - 100 ms | offset + 400 ms                                  | frontal group                     | blink       |
   | saccade                      | onset - 100 ms | offset + 300 ms                                  | frontal group                     | blink       |
   | emg_burst other              | onset - 100 ms | offset + 300 ms                                  | burst channels + their groups;    | muscle      |
   |                              |                |                                                  | all if >= 4 (Muse >= 2) in burst  |             |
   | emg_burst clench, tension    | onset - 100 ms | offset + 300 ms                                  | all                               | muscle      |
   | emg_burst chew, talk         | onset - 100 ms | offset + 1000 ms                                 | all                               | muscle      |
   | motion (incl. no_data)       | onset - 200 ms | max(last over-threshold + 500 ms, gate VALID)    | all                               | movement    |
   | gap                          | gap start      | gap end + 2 s                                    | all                               | signal lost |
   | electrode_pop                | onset          | onset + 1 s                                      | that channel                      | no contact  |
   | bad_contact                  | while excluded |                                                  | that channel (all: impedance)     | no contact  |
   windowInfo(t0, t1, chans, minChannels) -> {usable, cleanFrac, channels, segments, reason, eyesClosed}:
   per channel the unmasked runs; from each run >= 1 s, 1 s segments with 50% overlap from the run start plus one aligned to the run end when
   >= 0.25 s is left over; a channel is usable with >= 1 segment and >= 60% unmasked; the set is usable with >= minChannels usable channels.
   UMD: MuseEngine.Mask. Tested by engine/mask.test.js. */
"use strict";
(function (root) {
  const E = root.MuseEngine = root.MuseEngine || {};
  const PRIORITY = ["signal lost", "no contact", "movement", "muscle", "blink"];
  const DEF = { blinkPre: 0.1, blinkPost: 0.4, saccPre: 0.1, saccPost: 0.3, emgPre: 0.1, emgPost: 0.3, chewPost: 1.0, motionPre: 0.2, motionPost: 0.5, gapPost: 2.0, popS: 1.0, keepS: 30, minUsableFrac: 0.6, segS: 1.0, tailS: 0.25 };

  function create(o) {
    o = Object.assign({ fs: 250, device: "cyton", channels: [], groups: null, eegIdx: null, cfg: null }, o);
    const k = Object.assign({}, DEF, o.cfg || {}), fs = o.fs, G = o.groups || {}, all = o.eegIdx || o.channels.map((_, i) => i);
    const groupOf = c => { const out = new Set([c]); for (const g of ["frontal", "temporal", "posterior", "other"]) if ((G[g] || []).includes(c)) G[g].forEach(x => out.add(x)); return [...out]; };
    const M = { list: [], open: [], flags: [], openFlags: [] };
    function addInt(t0, t1, reason, chans, ev) { if (t1 <= t0) return null; const it = { t0, t1, reason, chans: chans ? [...new Set(chans)] : null, ev: ev || null }; M.list.push(it); return it; }
    /* turn a finalised event into its mask interval(s) */
    function add(ev) {
      const front = G.frontal && G.frontal.length ? G.frontal : null;
      switch (ev.type) {
        case "blink": case "blink_voluntary": return addInt(ev.onset - k.blinkPre, ev.offset + k.blinkPost, "blink", front, ev);
        case "saccade": return addInt(ev.onset - k.saccPre, ev.offset + k.saccPost, "blink", front, ev);
        case "emg_burst": {
          if (ev.sub === "chew" || ev.sub === "talk") return addInt(ev.onset - k.emgPre, ev.offset + k.chewPost, "muscle", null, ev);
          if (ev.sub === "clench" || ev.sub === "tension") return addInt(ev.onset - k.emgPre, ev.offset + k.emgPost, "muscle", null, ev);
          const ci = ev.chanIdx || (ev.channels || []).map(n => o.channels.indexOf(n)).filter(i => i >= 0);
          const allCh = ci.length >= (o.device === "muse" ? 2 : 4);
          return addInt(ev.onset - k.emgPre, ev.offset + k.emgPost, "muscle", allCh ? null : [].concat(...ci.map(groupOf)), ev);
        }
        case "motion": return addInt(ev.onset - k.motionPre, Math.max((ev.lastOver != null ? ev.lastOver : ev.offset) + k.motionPost, ev.validAt != null ? ev.validAt : ev.offset), "movement", null, ev);
        case "gap": return addInt(ev.onset, ev.offset + k.gapPost, "signal lost", null, ev);
        case "electrode_pop": { const ci = ev.chanIdx || (ev.channels || []).map(n => o.channels.indexOf(n)); return addInt(ev.onset, ev.onset + k.popS, "no contact", ci, ev); }
        case "bad_contact": { if (ev.offset == null) return null; const ci = ev.global ? null : (ev.channels || []).map(n => o.channels.indexOf(n)); return addInt(ev.onset, ev.offset, "no contact", ci, ev); }
        case "eyes_closed": M.flags.push({ t0: ev.onset, t1: ev.offset, name: "eyesClosed" }); return null;
        default: return null;
      }
    }
    /* open masks: [{t0, reason, chans}] valid until replaced (the pipeline sets them every tick); they extend to +infinity */
    function setOpen(list) { M.open = list.filter(Boolean); }
    function setOpenFlags(list) { M.openFlags = list.filter(Boolean); }
    function prune(tNow) { const lo = tNow - k.keepS; M.list = M.list.filter(x => x.t1 >= lo); M.flags = M.flags.filter(x => x.t1 >= lo); }
    function intervalsFor(c, t0, t1) {
      const out = [];
      for (const it of M.list) if (it.t1 > t0 && it.t0 < t1 && (it.chans == null || it.chans.includes(c))) out.push(it);
      for (const it of M.open) if (it.t0 < t1 && (it.chans == null || it.chans.includes(c))) out.push({ t0: it.t0, t1: Infinity, reason: it.reason });
      return out;
    }
    function maskedAt(c, t) { return intervalsFor(c, t, t + 1e-9).length > 0; }
    function windowInfo(t0, t1, chans, minChannels) {
      const i0 = Math.round(t0 * fs), i1 = Math.round(t1 * fs), n = i1 - i0, segN = Math.round(k.segS * fs), hop = Math.round(segN / 2), tailN = Math.round(k.tailS * fs);
      const res = { usable: false, cleanFrac: 0, channels: [], chanIdx: [], segments: {}, reason: null, eyesClosed: false, fracs: {} };
      const reasonCount = {};
      let fracSum = 0;
      for (const c of chans) {
        const m = new Uint8Array(n), its = intervalsFor(c, t0, t1);
        for (const it of its) { const a = Math.max(0, Math.round(it.t0 * fs) - i0), b = Math.min(n, it.t1 === Infinity ? n : Math.round(it.t1 * fs) - i0);
          for (let i = a; i < b; i++) if (!m[i]) { m[i] = 1; reasonCount[it.reason] = (reasonCount[it.reason] || 0) + 1; } }
        let clean = 0; for (let i = 0; i < n; i++) if (!m[i]) clean++;
        const frac = n ? clean / n : 0, segs = [];
        let i = 0; while (i < n) { if (m[i]) { i++; continue; } let j = i; while (j < n && !m[j]) j++;
          if (j - i >= segN) { let s = i; for (; s + segN <= j; s += hop) segs.push([i0 + s, i0 + s + segN]); const last = s - hop + segN; if (j - last >= tailN) segs.push([i0 + j - segN, i0 + j]); }
          i = j; }
        res.fracs[c] = frac;
        if (segs.length && frac >= k.minUsableFrac) { res.channels.push(o.channels[c]); res.chanIdx.push(c); res.segments[c] = segs; fracSum += frac; }
      }
      res.usable = res.chanIdx.length >= Math.max(1, minChannels || 1);
      res.cleanFrac = res.usable ? fracSum / res.chanIdx.length : 0;
      if (!res.usable) { let best = null, bc = -1; for (const r of PRIORITY) if ((reasonCount[r] || 0) > bc) { bc = reasonCount[r] || 0; best = r; } res.reason = bc > 0 ? best : "no contact"; }
      res.eyesClosed = M.flags.some(f => f.t1 > t0 && f.t0 < t1) || M.openFlags.some(f => f.t0 < t1);
      return res;
    }
    /* the reason covering "now" for a channel set (for the recorder) */
    function reasonAt(t, chans) { let best = null, bi = 99; for (const c of chans || all) for (const it of intervalsFor(c, t, t + 1e-6)) { const p = PRIORITY.indexOf(it.reason); if (p < bi) { bi = p; best = it.reason; } } return best; }
    function coverage(t0, t1) { /* fraction of [t0,t1] covered by an all-channel mask of each reason (exertion guard) */
      const out = {}; for (const it of M.list.concat(M.open.map(x => ({ t0: x.t0, t1: Infinity, reason: x.reason, chans: x.chans })))) { if (it.chans != null) continue; const a = Math.max(t0, it.t0), b = Math.min(t1, it.t1); if (b > a) out[it.reason] = (out[it.reason] || 0) + (b - a); }
      for (const r in out) out[r] = Math.min(1, out[r] / (t1 - t0)); return out; }
    return { add, addInt, setOpen, setOpenFlags, prune, windowInfo, maskedAt, reasonAt, coverage, intervalsFor, state: M, cfg: k };
  }
  const API = { create, PRIORITY, DEF };
  E.Mask = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
