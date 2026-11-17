/* engine/motion.js
   Motion gate: port of panel/motion.js as a pure class, plus an EEG-derived proxy for boards without an accelerometer.
   Gate: features over the last 1.25 s: acc = RMS of consecutive differences of the accelerometer magnitude (gravity cancels),
   gyro = RMS of the gyro magnitude (Muse only). Missing or stale data (no sample for 0.5 s, or fewer than 0.48 x fs_acc samples in the window)
   is never read as "no movement": state NO_DATA, masked like movement.
   Hysteresis: MOVEMENT when acc > entry or gyro > gEntry; VALID only after both are under the exit thresholds for 1.5 s.
   The exit test reads the newest 0.3 s of the window (the full 1.25 s window would add 1.25 s to every release; see IMPLEMENTATION_NOTES).
   Thresholds need no calibration: start {acc 0.02/0.01 g, gyro 10/5 deg/s} (or the panel's still-calibration MOT.th when the user ran it),
   then after 30 s of VALID features they self-tune from the median/MAD of the VALID features of the last 5 min:
   entry = max(0.5 default, median + 5 max(MAD, floor)), exit = max(0.5 default, median + 3 max(MAD, floor)), entry >= 1.5 exit.
   Proxy (no accelerometer): per good channel low-pass xb at 4 Hz, RMS per 250 ms slot; a channel jumps when that RMS >= 4 x its 60 s running median;
   MOVEMENT when >= 50% (Muse 75%) of the good channels jump in the same slot; VALID after 1.5 s without such a slot.
   UMD: MuseEngine.Motion. Tested by engine/motion.test.js. */
"use strict";
(function (root) {
  const E = root.MuseEngine = root.MuseEngine || {};
  const U = E.Util || (typeof require !== "undefined" ? require("./util.js") : null);
  const DEF = { acc: { entry: 0.05, exit: 0.025 }, gyro: { entry: 30, exit: 15 }, stableS: 0.75, winS: 1.25, staleS: 0.5, minFrac: 0.48, tuneAfterS: 30, tuneSpanS: 300,
    kEntry: 5, kExit: 3, floor: { acc: 0.0015, gyro: 0.3 }, onsetBackS: 0.2, lagS: 0.1, exitWinS: 0.3,
    proxy: { lpHz: 4, slotS: 0.25, k: 4, medS: 60, fracCyton: 0.5, fracMuse: 0.75, warmS: 5 } };

  function Gate(o) {
    o = Object.assign({ kind: "cyton", cfg: null, th: null }, o);
    const k = U.deepMerge(DEF, o.cfg || {});
    const th = { acc: Object.assign({}, k.acc), gyro: Object.assign({}, k.gyro) };
    if (o.th && o.th.acc && o.th.acc.entry > o.th.acc.exit) { th.acc = { entry: o.th.acc.entry, exit: o.th.acc.exit }; if (o.th.gyro) th.gyro = { entry: o.th.gyro.entry, exit: o.th.gyro.exit }; }
    const G = { state: "VALID", stable: 0, acc: { t: [], m: [] }, gyro: { t: [], m: [] }, gyroSeen: false, accSeen: false, th, validFeat: [], validTime: 0, tunedAt: 0,
      lastOver: -1e9, open: null, events: [], feat: null, kind: o.kind, lastT: null };
    function push(q, t, x, y, z, keepS) { q.t.push(t); q.m.push(Math.hypot(x, y, z)); const lo = t - keepS; let i = 0; while (i < q.t.length && q.t[i] < lo) i++; if (i) { q.t.splice(0, i); q.m.splice(0, i); } }
    G.pushAccel = (t, x, y, z) => { G.accSeen = true; G.fsAcc = G.fsAcc || (o.kind === "muse" ? 52 : 25); push(G.acc, t, x, y, z, 6); };
    G.pushGyro = (t, x, y, z) => { G.gyroSeen = true; push(G.gyro, t, x, y, z, 6); };
    G.setFs = fs => { G.fsAcc = fs; };
    /* returns {full, recent}: full = the 1.25 s window (entry, validity); recent = its last exitWinS seconds (exit test) */
    function feature(q, t, diff, fsA) {
      if (!q.t.length) return null;
      let last = -1; for (let i = q.t.length - 1; i >= 0; i--) if (q.t[i] <= t) { last = i; break; }
      if (last < 0 || t - q.t[last] > k.staleS) return null;
      const lo = t - k.winS, a = [], ta = []; for (let i = 0; i <= last; i++) if (q.t[i] >= lo) { a.push(q.m[i]); ta.push(q.t[i]); }
      if (a.length < k.minFrac * fsA) return null;
      const rms = (from) => { let s = 0, n = 0;
        if (diff) { for (let i = Math.max(1, from); i < a.length; i++) { const d = a[i] - a[i - 1]; s += d * d; n++; } }
        else for (let i = from; i < a.length; i++) { s += a[i] * a[i]; n++; }
        return n ? Math.sqrt(s / n) : null; };
      let r0 = a.length - 1; while (r0 > 0 && ta[r0 - 1] >= t - k.exitWinS) r0--;
      const full = rms(0), recent = rms(Math.max(0, r0 - (diff ? 1 : 0)) + (diff ? 1 : 0));
      return { full, recent: recent == null ? full : recent };
    }
    function selfTune(tNow) {
      const lo = tNow - k.tuneSpanS; while (G.validFeat.length && G.validFeat[0].t < lo) G.validFeat.shift();
      const one = (key, def) => { const v = G.validFeat.map(f => f[key]).filter(x => x != null); if (v.length < 20) return null; const m = U.median(v), mad = Math.max(U.mad(v, m), k.floor[key]);
        let en = Math.max(def.entry, m + k.kEntry * mad), ex = Math.max(def.exit, m + k.kExit * mad);   /* self-tuning may loosen the gate but never makes it stricter than the defaults */ if (en < 1.5 * ex) en = 1.5 * ex; return { entry: en, exit: ex }; };
      const a = one("acc", k.acc); if (a) G.th.acc = a;
      if (G.gyroSeen) { const g = one("gyro", k.gyro); if (g) G.th.gyro = g; }
    }
    /* t = stream time of the EEG; dt = time since the last step */
    G.step = function (tEeg, dt) {
      const t = tEeg - k.lagS; dt = dt == null ? 0.05 : dt;
      const fsA = G.fsAcc || 25;
      const A = feature(G.acc, t, true, fsA);
      let Gy = null, missing = A == null;
      if (G.gyroSeen) { Gy = feature(G.gyro, t, false, o.kind === "muse" ? 52 : fsA); if (Gy == null) missing = true; }
      const fa = A && A.full, fg = Gy && Gy.full, ra = A && A.recent, rg = Gy && Gy.recent;
      G.feat = { acc: fa, gyro: fg };
      const prev = G.state;
      if (missing) { G.state = "NO_DATA"; G.stable = 0; G.lastOver = t; }
      else {
        const over = fa > G.th.acc.entry || (fg != null && fg > G.th.gyro.entry);
        const under = ra < G.th.acc.exit && (rg == null || rg < G.th.gyro.exit);
        if (ra > G.th.acc.exit || (rg != null && rg > G.th.gyro.exit)) G.lastOver = t;
        if (G.state === "VALID") { if (over) { G.state = "MOVEMENT"; G.stable = 0; } }
        else if (under) { G.stable += dt; if (G.stable >= k.stableS) { G.state = "VALID"; G.stable = 0; } }
        else G.stable = 0;
        if (G.state === "VALID" && prev === "VALID") { G.validFeat.push({ t, acc: fa, gyro: fg }); G.validTime += dt;
          if (G.validTime >= k.tuneAfterS && t - G.tunedAt >= 1) { G.tunedAt = t; selfTune(t); } }
      }
      if (prev === "VALID" && G.state !== "VALID") G.open = { type: "motion", sub: G.state === "NO_DATA" ? "no_data" : "movement", onset: t - k.onsetBackS, lastOver: t, silent: !G.everValid };
      if (!missing && G.state === "VALID") G.everValid = true;     // the start-up no_data stretch is masked but not reported
      if (G.open) G.open.lastOver = Math.max(G.open.lastOver, G.lastOver);
      if (prev !== "VALID" && G.state === "VALID" && G.open) { const ev = Object.assign(G.open, { offset: t, validAt: t, t: tEeg }); G.events.push(ev); G.open = null; }
      G.lastT = t;
      return G.state;
    };
    G.drain = () => { const e = G.events; G.events = []; return e; };
    G.reset = () => { G.state = "VALID"; G.stable = 0; G.acc = { t: [], m: [] }; G.gyro = { t: [], m: [] }; G.open = null; };
    return G;
  }

  function Proxy(o) {
    o = Object.assign({ fs: 250, nCh: 1, kind: "cyton", cfg: null }, o);
    const k = U.deepMerge(DEF, o.cfg || {}).proxy, slotN = Math.round(k.slotS * o.fs), frac = o.kind === "muse" ? k.fracMuse : k.fracCyton;
    const ch = []; for (let c = 0; c < o.nCh; c++) ch.push({ f1: U.lp(k.lpHz, o.fs), f2: U.lp(k.lpHz, o.fs), s: 0, n: 0, med: U.RunningMedian(Math.round(k.medS / k.slotS)), last: 0 });
    const P = { state: "VALID", quiet: 0, open: null, events: [], slots: 0, lastJump: 0, jumps: [] };
    P.push = (c, xb) => { const s = ch[c], y = s.f2.p(s.f1.p(xb)); s.s += y * y; s.n++; };
    P.resetChannel = c => { const s = ch[c]; s.f1.reset(); s.f2.reset(); s.s = 0; s.n = 0; };
    /* called every slot (250 ms) with the list of good channel indices */
    P.slot = function (t, good) {
      let jumps = 0, n = 0;
      for (const c of good) { const s = ch[c]; if (s.n < slotN * 0.5) { s.s = 0; s.n = 0; continue; } const r = Math.sqrt(s.s / s.n); s.s = 0; s.n = 0;
        const warm = s.med.count >= k.warmS / k.slotS; const m = s.med.median(); const j = warm && r >= k.k * m; if (j) jumps++; n++; s.med.push(r); }
      for (let c = 0; c < ch.length; c++) if (!good.includes(c)) { ch[c].s = 0; ch[c].n = 0; }
      P.slots++; P.lastJump = n ? jumps / n : 0;
      const moving = n > 0 && jumps / n >= frac;
      const prev = P.state;
      if (moving) { P.state = "MOVEMENT"; P.quiet = 0; if (prev === "VALID") P.open = { type: "motion", sub: "proxy", onset: t - k.slotS, lastOver: t }; else if (P.open) P.open.lastOver = t; }
      else if (P.state === "MOVEMENT") { P.quiet += k.slotS; if (P.quiet >= DEF.stableS) { P.state = "VALID"; P.quiet = 0; if (P.open) { P.events.push(Object.assign(P.open, { offset: t, validAt: t, t })); P.open = null; } } }
      return P.state;
    };
    P.drain = () => { const e = P.events; P.events = []; return e; };
    return P;
  }
  const API = { Gate, Proxy, DEF };
  E.Motion = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
