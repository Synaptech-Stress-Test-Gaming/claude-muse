/* engine/events.js
   One artifact event detector that both masks artifacts (engine/mask.js) and feeds the buttons (engine/buttons.js).
   Samples go in one at a time (push, on xb = DC-removed + notched); decisions run every 50 ms of stream time (tick) on a 250 ms look-back,
   with longer histories where stated. Types made here: blink, blink_voluntary, eyes_closed, saccade, emg_burst (sub clench|chew|talk|tension|other),
   electrode_pop. (gap, bad_contact and motion come from frame.js, contact.js and motion.js; the pipeline merges them.)
   Event: {type, sub, onset, offset, conf, channels, amp, durMs, t (stream time it was finalised)}.

   Blink: v = mean over usable eye channels of lp(10 Hz) of xb; m = running median of v (30 s, every 50 ms, outside events); sigma = 1.4826 MAD.
     Slope d = (v(t) - v(t - 20 ms)) / 0.02. A = max(blinkFloorUv, 4 sigma_v, 0.4 medAmp); Dthr = max(blinkDerivFloor, 4 sigma_d).
     Candidate |d| >= Dthr; peak = largest |v - m| in the next 400 ms (>= A); onset/offset = 10% of the peak (back <= 300 ms, forward <= 1000 ms;
     no return within 1000 ms = not a blink, handed to eyes_closed as a closing deflection). durMs = width at 50%; accepted 80-800 ms.
     Voluntary when amp >= max(1.5 medAmp, medAmp + 3 madAmp) or durMs >= 350. Only spontaneous blinks update medAmp/madAmp/duration/polarity.
     Added check (see IMPLEMENTATION_NOTES): the eye deflection must be at least 2x the deflection of the non-frontal channels, so a common
     head-movement wave is not read as a blink.
   eyes_closed: alpha envelope ea = 500 ms average of |bp 8-13 Hz| over the posterior channels; onset when ea >= 2 x its 60 s running median for 1 s
     with no blink in that second and (Cyton) a closing deflection in the 1.5 s before; offset on an eye deflection or ea < 1.3 x median for 500 ms.
   saccade: dd = lp10(left eye) - lp10(right eye), ss = their sum; |dd(t) - dd(t-100 ms)| >= max(40, 5 sigma) with the sum change < half of it.
   emg_burst: per channel hp 25 Hz, lp 55 Hz (fs < 250) or min(100, fs/2 - 5), |.|, 75 ms average = envelope e; baseline b = running median of e
     (60 s, non-burst, every 50 ms); r = e/b; in burst from r >= 3 held 100 ms until r < 2 held 50 ms; overlapping channel bursts merge.
   electrode_pop: a step > popSlope/fs on one channel only (none on other channels within +/-50 ms), not during a burst there, at most 3 steps
     within +/-100 ms; or |xb| > satUv on one channel.
   Passive self-tuning only: no instructed action exists anywhere.
   UMD: MuseEngine.Events. Tested by engine/events.test.js. */
"use strict";
(function (root) {
  const E = root.MuseEngine = root.MuseEngine || {};
  const U = E.Util || (typeof require !== "undefined" ? require("./util.js") : null);
  const DEF = {
    cyton: { blinkFloorUv: 60, blinkDerivFloor: 600, blinkAmpMed: 120, blinkAmpMad: 30 },
    muse: { blinkFloorUv: 40, blinkDerivFloor: 400, blinkAmpMed: 80, blinkAmpMad: 20 },
    blinkK: 4, blinkAmpFrac: 0.4, volFactor: 1.5, volMadK: 3, volDurMs: 350, blinkMinMs: 80, blinkMaxMs: 800, blinkCommonRatio: 2,
    emgRatioIn: 3.0, emgRatioOut: 2.0, emgBaseFloorUv: 0.5, emgInMs: 100, emgOutMs: 50, emgEnvMs: 75, emgBaseS: 60, emgStallS: 60,
    popSlope: 12500, satUv: 300, eyesClosedIn: 2.0, eyesClosedOut: 1.3, saccadeUv: 40, saccadeK: 5
  };
  const GROUPS = {
    cyton: { eye: ["Fp1", "Fp2"], frontal: ["Fp1", "Fp2", "F3", "F4", "F8", "F7"], temporal: ["T7", "T8"], posterior: ["O1", "O2", "P3", "P4"] },
    muse: { eye: ["AF7", "AF8"], frontal: ["AF7", "AF8"], temporal: ["TP9", "TP10"], posterior: ["TP9", "TP10"] }
  };
  function groupsFor(device, channels, eegIdx) {
    const G = GROUPS[device] || GROUPS.cyton, ix = n => { const i = channels.indexOf(n); return i >= 0 && eegIdx.includes(i) ? i : -1; };
    const g = {}; for (const k in G) g[k] = G[k].map(ix).filter(i => i >= 0);
    const named = new Set([].concat(g.frontal, g.temporal, g.posterior)); g.other = eegIdx.filter(i => !named.has(i));
    g.nonFrontal = eegIdx.filter(i => !g.frontal.includes(i));
    return g;
  }

  function create(o) {
    o = Object.assign({ fs: 250, device: "cyton", channels: [], eegIdx: null, cfg: null, det: null, undoPanelHp: false, mains: 60 }, o);
    const fs = o.fs, C = o.channels.length, eeg = o.eegIdx || o.channels.map((_, i) => i), dev = o.device;
    const k = U.deepMerge(DEF, o.cfg || {}), kd = Object.assign({}, k[dev] || k.cyton, (o.cfg && o.cfg[dev]) || {});
    const G = groupsFor(dev, o.channels, eeg);
    const L = Math.round(35 * fs), n20 = Math.max(1, Math.round(0.02 * fs)), n100 = Math.round(0.1 * fs), n50 = Math.round(0.05 * fs);
    const fhi = fs < 250 ? 55 : Math.min(100, fs / 2 - 5), envN = Math.max(1, Math.round(k.emgEnvMs / 1000 * fs));
    const excluded = new Uint8Array(C);
    // ---- per-channel filter state
    function mkCh() { return { mn: o.mains && o.mains < fs / 2 - 2 ? U.notch(o.mains, fs, 4) : null, lp: U.lp(10, fs), h1: U.hp(25, fs), l1: U.lp(fhi, fs), ma: U.MovingAvg(envN), a1: U.bp(Math.sqrt(8 * 13), fs, 2), a2: U.bp(Math.sqrt(8 * 13), fs, 2), prev: null }; }
    const ch = []; for (let c = 0; c < C; c++) ch.push(mkCh());
    // ---- histories (indexed by absolute sample index modulo L)
    const vR = new Float32Array(L), eyeR = G.eye.map(() => new Float32Array(L)), otherR = new Float32Array(L), eaR = new Float32Array(L);
    // restored eye signal: the 0.5 Hz DC blocker is undone (and the panel's 0.995 one-pole on the Muse when undoPanelHp) and replaced by a
    // 0.05 Hz leaky integrator, so a blink keeps its shape (no 30-60% undershoot that would split it in two). Used for amplitude, onset, offset, width.
    const vrR = new Float32Array(L), eyeRR = G.eye.map(() => new Float32Array(L));
    const rEng = Math.exp(-2 * Math.PI * 0.5 / fs), rPan = 0.995, lam = Math.exp(-2 * Math.PI * 0.05 / fs);
    const mkRest = () => ({ y1: 0, z1: 0, x: 0, lp: U.lp(10, fs) });
    const rest = G.eye.map(mkRest);
    const S = {
      idx: -1, validFrom: 0, lastTickIdx: -1, scanFrom: 0,
      vMed: U.RunningMedian(Math.round(30 / 0.05)), dMed: U.RunningMedian(Math.round(30 / 0.05)), oMed: U.RunningMedian(Math.round(30 / 0.05)), ddMed: U.RunningMedian(Math.round(30 / 0.05)),
      cand: null, lastBlinkT: -1e9, lastBlinkOn: -1e9, lastBlinkOff: -1e9, lastBlinkSign: 0, inEvent: false,
      blinkAmps: [], blinkDurs: [], blinkSigns: [], nBlinks: 0,
      medAmp: (o.det && o.det.blinkAmpMed) || kd.blinkAmpMed, madAmp: (o.det && o.det.blinkAmpMad) || kd.blinkAmpMad, durMed: (o.det && o.det.blinkDurMed) || null,
      sign: (o.det && o.det.blinkSign) || 0, detN: (o.det && o.det.n) || 0,
      // emg
      env: new Float64Array(C), base: [], inB: new Uint8Array(C), above: new Int32Array(C), below: new Int32Array(C), cross: new Float64Array(C), bOn: new Float64Array(C), maxR: new Float64Array(C),
      merged: null, bursts: [], chewUntil: -1e9, talkUntil: -1e9, talkSeen: -1e9, lastBurstEnd: -1e9, emgStart: 0, emgCount: 0,
      // alpha
      eaMed: U.RunningMedian(Math.round(60 / 0.05)), eaRun: null, eyesClosed: null, ecLow: 0, closingT: [], alphaHist: U.RunningMedian(Math.round(300 / 0.25)), alphaBurst: null, alphaBursts: [],
      // saccade, pops
      lastSacc: -1e9, steps: [], satAt: new Float64Array(C).fill(-1e9),
      out: [], provisional: []
    };
    for (let c = 0; c < C; c++) S.base.push(U.RunningMedian(Math.round(k.emgBaseS / 0.05)));
    const tOf = i => i / fs, at = (R, i) => R[((i % L) + L) % L];

    function setExcluded(c, v) { excluded[c] = v ? 1 : 0; }
    const use = list => list.filter(c => !excluded[c]);

    /* one sample of xb for every channel (array indexed by channel), absolute sample index i */
    /* xd (DC-blocked, not notched) is optional: when given, the EMG envelope uses it through a low-Q (4) mains notch, because the
       Q 30 notch of xb rings for a few hundred ms after a strong burst and stretched every clench past 600 ms */
    function push(i, xb, xd) {
      S.idx = i; const p = i % L;
      // eye channels
      const eye = use(G.eye); let vs = 0, nv = 0;
      let vrs = 0;
      for (let q = 0; q < G.eye.length; q++) { const c = G.eye[q], y = ch[c].lp.p(xb[c]); eyeR[q][p] = y;
        const R = rest[q], d1 = xb[c] - rEng * R.y1; R.y1 = xb[c]; let d = d1;
        if (o.undoPanelHp) { const z = R.z1 + d1; d = z - rPan * R.z1; R.z1 = z; }            // z = signal before the panel's one-pole (cumulative)
        R.x = lam * R.x + d; const yr = R.lp.p(R.x); eyeRR[q][p] = yr;
        if (!excluded[c]) { vs += y; vrs += yr; nv++; } }
      vR[p] = nv ? vs / nv : 0; vrR[p] = nv ? vrs / nv : 0;
      // non-frontal reference (common-mode check)
      let os = 0, no = 0; for (const c of G.nonFrontal) { if (excluded[c]) continue; const y = ch[c].lpo ? ch[c].lpo.p(xb[c]) : (ch[c].lpo = U.lp(10, fs)).p(xb[c]); os += y; no++; } otherR[p] = no ? os / no : 0;
      // alpha envelope
      let as = 0, na = 0; for (const c of G.posterior) { const y = ch[c].a2.p(ch[c].a1.p(xb[c])); if (!excluded[c]) { as += Math.abs(y); na++; } }
      if (!S.eaMA) S.eaMA = U.MovingAvg(Math.round(0.5 * fs)); eaR[p] = S.eaMA.p(na ? as / na : 0);
      // EMG envelopes, burst state per sample, pops
      const t = tOf(i), settled = i >= S.validFrom;
      for (const c of eeg) {
        const s = ch[c], src = xd ? (s.mn ? s.mn.p(xd[c]) : xd[c]) : xb[c], e = s.ma.p(Math.abs(s.l1.p(s.h1.p(src)))); S.env[c] = e;
        if (s.prev != null && settled && !excluded[c]) { const st = Math.abs(xb[c] - s.prev); if (st > k.popSlope / fs) S.steps.push({ i, c, t }); if (Math.abs(xb[c]) > k.satUv && t - S.satAt[c] > 1) { S.satAt[c] = t; S.steps.push({ i, c, t, sat: true }); } }
        s.prev = xb[c];
        if (!settled || excluded[c]) continue;
        const b = Math.max(k.emgBaseFloorUv, S.base[c].count ? S.base[c].median() : e), r = e / b;
        if (S.merged) S.merged.rAll[c] = Math.max(S.merged.rAll[c] || 0, r);
        if (!S.inB[c]) {
          if (r >= k.emgRatioIn) { if (S.above[c] === 0) S.cross[c] = t; S.above[c]++; S.maxR[c] = Math.max(S.maxR[c], r);
            if (S.above[c] >= k.emgInMs / 1000 * fs) { S.inB[c] = 1; S.bOn[c] = S.cross[c]; S.below[c] = 0; burstChannelStart(c, S.cross[c]); } }
          else { S.above[c] = 0; S.maxR[c] = 0; }
        } else {
          S.maxR[c] = Math.max(S.maxR[c], r);
          if (r < Math.max(k.emgRatioOut, 0.1 * S.maxR[c])) { S.below[c]++;   // end also at 10% of the peak ratio: the notch rings after a strong burst
            if (S.below[c] >= k.emgOutMs / 1000 * fs) { S.inB[c] = 0; S.above[c] = 0; burstChannelEnd(c, t - k.emgOutMs / 1000 - 0.8 * k.emgEnvMs / 1000); } }   // the 75 ms envelope average lags the falling edge
          else S.below[c] = 0;
          if (S.merged && t - S.bOn[c] > k.emgStallS) { S.base[c].clear(); S.inB[c] = 0; burstChannelEnd(c, t); }   // anti-stall: accept the level as the new baseline
        }
      }
    }
    // ---- EMG merging and sub-labels
    function burstChannelStart(c, t) {
      if (!S.merged) S.merged = { onset: t, chans: new Set(), open: new Set(), maxR: {}, rAll: {}, label: null };
      S.merged.chans.add(c); S.merged.open.add(c); S.merged.onset = Math.min(S.merged.onset, t);
    }
    function burstChannelEnd(c, t) {
      const m = S.merged; if (!m) return;
      m.maxR[c] = Math.max(m.maxR[c] || 0, S.maxR[c]); S.maxR[c] = 0; m.open.delete(c); m.offset = Math.max(m.offset || 0, t);
      if (!m.open.size) finishBurst(m, t);
    }
    function finishBurst(m, tNow) {
      S.merged = null;
      const chans = [...m.chans], dur = m.offset - m.onset, rOf = list => { const v = use(list).filter(c => m.rAll[c] != null).map(c => m.rAll[c]); return v.length ? U.median(v) : 0; };
      const tL = G.temporal[0], tR = G.temporal[1];
      const temporalBoth = G.temporal.length === 2 && m.chans.has(tL) && m.chans.has(tR);
      // r of every channel during the burst (also those that stayed under the start ratio): the temporal pair's asymmetry and the group medians
      const asym = G.temporal.length === 2 && use(G.temporal).length === 2 ? Math.abs(Math.log((m.rAll[tL] || 1e-9) / (m.rAll[tR] || 1e-9))) : 0;
      const frontDom = G.frontal.length > 0 && G.temporal.length > 0 && rOf(G.frontal) > 1.5 * rOf(G.temporal);
      const b = { onset: m.onset, offset: m.offset, durMs: dur * 1000, chans, maxR: Math.max(...chans.map(c => m.maxR[c] || 0)), temporalBoth, asym, frontDom, sub: null, ev: null };
      S.bursts.push(b); while (S.bursts.length && S.bursts[0].onset < tNow - 6) S.bursts.shift();
      // chew: >= 3 bursts with regular onsets 0.4-1.43 s apart (CV < 0.35) within the last 4 s
      const rec = S.bursts.filter(x => x.onset >= tNow - 4 && !x.frontDom);          // talk-like (frontal) bursts never count as chewing
      let chew = false;
      if (rec.length >= 3) { const iv = []; for (let q = 1; q < rec.length; q++) iv.push(rec[q].onset - rec[q - 1].onset);
        const ok = iv.every(v => v >= 0.4 && v <= 1.43), mu = U.mean(iv), cv = Math.sqrt(U.variance(iv, mu)) / mu; chew = ok && cv < 0.35; }
      const talkMany = !chew && S.bursts.filter(x => x.onset >= tNow - 3).length >= 3;
      if (dur > 1) b.sub = "tension";
      else if (frontDom) { b.sub = "talk"; S.talkUntil = m.offset + 1.5; S.talkSeen = m.offset; }       // speech muscles are perioral/frontal; chewing is temporal
      else if (chew) { b.sub = "chew"; rec.forEach(x => { if (x.ev && x.sub !== "tension") { x.ev.sub = "chew"; x.ev.relabel = true; } x.sub = x.sub === "tension" ? x.sub : "chew"; }); S.chewUntil = m.offset + 1.5; }
      else if (talkMany || asym > 0.7 || frontDom) { b.sub = "talk"; S.talkUntil = m.offset + 1.5; S.talkSeen = m.offset; }
      else if (temporalBoth && dur >= 0.2 && dur <= 0.6) b.sub = "clench";
      else b.sub = "other";
      if (b.sub === "chew") S.chewUntil = m.offset + 1.5;
      const conf = U.clamp((b.maxR - k.emgRatioIn) / k.emgRatioIn + 0.5, 0.3, 1);
      const ev = { type: "emg_burst", sub: b.sub, onset: m.onset, offset: m.offset, conf, channels: chans.map(c => o.channels[c]), chanIdx: chans, amp: b.maxR, durMs: b.durMs, t: tNow,
        temporalBoth, asym, frontDom, chewing: tNow < S.chewUntil, talking: tNow < S.talkUntil, talkRecent: tNow - S.talkSeen < 3 };
      b.ev = ev; S.lastBurstEnd = m.offset; S.out.push(ev);
    }

    // ---- blink helpers
    function blinkThresholds() {
      const sv = 1.4826 * (S.vMed.count > 20 ? S.vMed.mad() : 0), sd = 1.4826 * (S.dMed.count > 20 ? S.dMed.mad() : 0);
      return { A: Math.max(kd.blinkFloorUv, k.blinkK * sv, k.blinkAmpFrac * S.medAmp), D: Math.max(kd.blinkDerivFloor, k.blinkK * sd), sv, sd };
    }
    const vAt = i => at(vR, i), vrAt = i => at(vrR, i);
    function localBase(R, i) { const a = []; for (let j = i - Math.round(0.2 * fs); j <= i - Math.round(0.03 * fs); j++) a.push(at(R, j)); return a.length ? U.median(a) : at(R, i); }
    function emit(ev) { S.out.push(ev); return ev; }
    function processCandidate(tNow, iNow) {
      const c = S.cand, iPk0 = c.i, iPk1 = c.i + Math.round(0.4 * fs);
      if (iNow < iPk1) return;
      if (!c.peak) {
        let pk = 0, ip = c.i; for (let i = iPk0; i <= iPk1; i++) { const a = Math.abs(vrAt(i) - c.m); if (a > pk) { pk = a; ip = i; } }
        if (pk < c.A) { S.rej = { why: "small", pk, A: c.A, t: tOf(c.i) }; S.cand = null; S.scanFrom = iPk1; return; }
        const sg = Math.sign(vrAt(ip) - c.m);
        if (sg === -S.lastBlinkSign && tOf(c.i) - S.lastBlinkOff < 1.2) { S.cand = null; S.scanFrom = iPk1; return; }   // filter rebound right after a blink
        let on = null; for (let i = ip; i >= ip - Math.round(0.3 * fs) && i >= S.validFrom; i--) if (Math.abs(vrAt(i) - c.m) < 0.1 * pk) { on = i; break; }
        c.peak = { pk, ip, sg, on: on == null ? ip - Math.round(0.3 * fs) : on };
      }
      const P = c.peak; let off = null, split = false, minV = Infinity, minI = P.ip;
      for (let i = P.ip; i <= Math.min(iNow, P.ip + fs); i++) {
        const sv = P.sg * (vrAt(i) - c.m);
        if (Math.abs(vrAt(i) - c.m) < 0.1 * P.pk) { off = i; break; }
        if (sv < minV) { minV = sv; minI = i; }
        // a second blink starts before the first has returned (double blinks overlap): end the first at the dip
        if (minV < 0.6 * P.pk && sv > minV + 0.25 * P.pk) { off = minI; split = true; break; }
      }
      if (off == null) {
        if (iNow > P.ip + fs) { S.closingT.push({ t: tOf(P.on), sign: P.sg }); while (S.closingT.length > 10) S.closingT.shift(); S.cand = null; S.scanFrom = iNow; checkEyesOpen(tOf(P.on)); }
        return;
      }
      S.cand = null; S.scanFrom = off;
      if (split) S.cand = { i: off, ds: P.sg, A: c.A, m: c.m, mo: c.mo, me: c.me, splitFrom: P.ip };
      // width at 50%
      let a = P.ip, b = P.ip; while (a > P.on && Math.abs(vrAt(a) - c.m) >= 0.5 * P.pk) a--; while (b < off && Math.abs(vrAt(b) - c.m) >= 0.5 * P.pk) b++;
      const durMs = (b - a) / fs * 1000, tOn = tOf(P.on), tOff = tOf(off), tPk = tOf(P.ip);
      if (S.eyesClosed) { closeEyes(tOn); return; }                         // any eye deflection while eyes are closed = opening
      if (durMs < k.blinkMinMs || durMs > k.blinkMaxMs) { S.rej = { why: "dur", durMs, t: tOn }; return; }
      // common-mode check: a blink is frontal; a head-movement wave is everywhere
      let oDev = 0; for (let i = Math.max(c.i, P.ip - Math.round(0.1 * fs)); i <= P.ip + Math.round(0.1 * fs); i++) oDev = Math.max(oDev, Math.abs(at(otherR, i) - c.mo));
      if (G.nonFrontal.length && P.pk < k.blinkCommonRatio * oDev) { S.rej = { why: "common", pk: P.pk, oDev, t: tOn }; return; }
      // two eye channels: same sign, ratio 1/3..3; opposite signs = saccade
      let agree = true, two = false;
      if (use(G.eye).length === 2) { two = true; const qa = G.eye.indexOf(use(G.eye)[0]), qb = G.eye.indexOf(use(G.eye)[1]);
        const da = at(eyeRR[qa], P.ip) - c.me[qa], db = at(eyeRR[qb], P.ip) - c.me[qb];
        if (Math.sign(da) !== Math.sign(db)) { if (tPk - S.lastSacc > 0.3) { S.lastSacc = tPk; emit({ type: "saccade", sub: null, onset: tOn, offset: tOn + 0.2, conf: 0.6, channels: G.eye.map(i => o.channels[i]), amp: P.pk, durMs: 200, t: tNow }); } return; }
        const ra = Math.abs(da) / Math.max(1e-9, Math.abs(db)); if (ra < 1 / 3 || ra > 3) agree = false; }
      if (two && !agree) { S.rej = { why: "agree", t: tOn }; return; }
      if (S.nBlinks + S.detN >= 10 && S.sign && P.sg !== S.sign) return;    // learned polarity
      const vol = P.pk >= Math.max(k.volFactor * S.medAmp, S.medAmp + k.volMadK * S.madAmp) || durMs >= k.volDurMs;
      const conf = U.clamp(P.pk / c.A - 1, 0.3, 1) * (two ? 1 : 0.7);
      const ev = emit({ type: vol ? "blink_voluntary" : "blink", sub: null, onset: tOn, offset: tOff, peak: tPk, conf, channels: use(G.eye).map(i => o.channels[i]), amp: P.pk, durMs, t: tNow, sign: P.sg });
      S.lastBlinkT = tNow; S.lastBlinkOn = tOn; S.lastBlinkOff = tOff; S.lastBlinkSign = P.sg; S.lastBase = { m: c.m, mo: c.mo, me: c.me };
      S.closingT.push({ t: tOn, sign: P.sg, blink: true }); while (S.closingT.length > 10) S.closingT.shift();
      if (!vol) {
        S.blinkAmps.push(P.pk); S.blinkDurs.push(durMs); S.blinkSigns.push(P.sg); S.nBlinks++;
        if (S.blinkAmps.length > 200) { S.blinkAmps.shift(); S.blinkDurs.shift(); S.blinkSigns.shift(); }
        if (S.blinkAmps.length >= 10) { S.medAmp = Math.max(U.median(S.blinkAmps), kd.blinkFloorUv); S.madAmp = Math.max(U.mad(S.blinkAmps), 0.05 * S.medAmp); S.durMed = U.median(S.blinkDurs);
          const pos = S.blinkSigns.filter(s => s > 0).length / S.blinkSigns.length; S.sign = pos >= 0.8 ? 1 : pos <= 0.2 ? -1 : 0; }
      }
      return ev;
    }
    function closeEyes(t) {
      const ec = S.eyesClosed; if (!ec) return; S.eyesClosed = null; S.ecLow = 0;
      emit({ type: "eyes_closed", sub: null, onset: ec.onset, offset: t, conf: dev === "cyton" ? 0.8 : 0.5, channels: G.posterior.map(i => o.channels[i]), amp: ec.ratio, durMs: (t - ec.onset) * 1000, t: S.idx / fs });
    }
    function checkEyesOpen() {}
    // ---- the 50 ms tick
    function tick(t) {
      const iNow = S.idx; if (iNow < 0) return drain();
      const settled = iNow >= S.validFrom + Math.round(0.5 * fs);
      if (settled) {
        const v = vAt(iNow), d = (v - vAt(iNow - n20)) / 0.02;
        if (!S.cand && !S.inBlinkWindow) { S.vMed.push(v); S.dMed.push(d); S.oMed.push(at(otherR, iNow)); }
        // eye channel medians for the two-channel test
        S.eyeMeds = S.eyeMeds || G.eye.map(() => U.RunningMedian(600)); if (!S.cand) G.eye.forEach((c, q) => S.eyeMeds[q].push(at(eyeR[q], iNow)));
        // saccade
        if (G.eye.length === 2 && use(G.eye).length === 2) {
          const ddNow = at(eyeR[0], iNow) - at(eyeR[1], iNow), ddOld = at(eyeR[0], iNow - n100) - at(eyeR[1], iNow - n100);
          const ssNow = at(eyeR[0], iNow) + at(eyeR[1], iNow), ssOld = at(eyeR[0], iNow - n100) + at(eyeR[1], iNow - n100), dd = ddNow - ddOld, ds = ssNow - ssOld;
          const sdd = S.ddMed.count > 20 ? 1.4826 * S.ddMed.mad() : 0; S.ddMed.push(dd);
          if (Math.abs(dd) >= Math.max(k.saccadeUv, k.saccadeK * sdd) && Math.abs(ds) < 0.5 * Math.abs(dd) && t - S.lastSacc > 0.4 && iNow - n100 >= S.validFrom) {
            S.lastSacc = t; emit({ type: "saccade", sub: null, onset: t - 0.1, offset: t + 0.1, conf: 0.7, channels: G.eye.map(i => o.channels[i]), amp: Math.abs(dd), durMs: 200, t }); }
        }
        // blink candidates
        if (use(G.eye).length) {
          if (!S.cand) {
            const th = blinkThresholds(); const from = Math.max(S.scanFrom, S.validFrom + Math.round(0.5 * fs), iNow - Math.round(0.3 * fs));
            for (let i = from; i <= iNow; i++) { const di = (vAt(i) - vAt(i - n20)) / 0.02;
              if (Math.abs(di) >= th.D) {
                // right after a blink the pre-candidate stretch is still the previous blink's tail: keep that blink's baseline
                const recent = S.lastBase && tOf(i) - S.lastBlinkOff < 0.6;
                S.cand = { i, ds: Math.sign(di), A: th.A, m: recent ? S.lastBase.m : localBase(vrR, i), mo: recent ? S.lastBase.mo : localBase(otherR, i), me: recent ? S.lastBase.me : eyeRR.map(R => localBase(R, i)) }; break; } }
            if (!S.cand) S.scanFrom = iNow + 1;
          }
          if (S.cand) processCandidate(t, iNow);
        }
        // eyes closed (alpha envelope)
        if (G.posterior.length && use(G.posterior).length) {
          const ea = at(eaR, iNow), ma = S.eaMed.count ? S.eaMed.median() : ea;
          if (!S.eyesClosed) {
            if (S.eaMed.count >= 200 && ea >= k.eyesClosedIn * ma) {
              if (!S.eaRun) S.eaRun = { t0: t, ratio: ea / ma };
              S.eaRun.ratio = Math.max(S.eaRun.ratio, ea / ma);
              if (t - S.eaRun.t0 >= 1.0) {
                const noBlink = S.lastBlinkOn < S.eaRun.t0;
                let onset = S.eaRun.t0, okClose = dev !== "cyton";
                if (dev === "cyton") { const cl = S.closingT.filter(x => x.t >= S.eaRun.t0 - 1.5 && x.t <= S.eaRun.t0 + 0.2); if (cl.length) { okClose = true; onset = cl[cl.length - 1].t; } }
                if (noBlink && okClose) { S.eyesClosed = { onset, ratio: S.eaRun.ratio }; S.ecLow = 0; }
              }
            } else { S.eaRun = null; S.eaMed.push(ea); }
          } else {
            if (ea < k.eyesClosedOut * ma) { S.ecLow += 0.05; if (S.ecLow >= 0.5) closeEyes(t - 0.5); } else S.ecLow = 0;
          }
          // alpha bursts (drowsiness "spindles"): 0.5-2 s above median + 3 sigma of ea, eyes open only
          if (!S.eyesClosed && (S.tickN = (S.tickN || 0) + 1) % 5 === 0) S.alphaHist.push(ea);
          if (!S.eyesClosed && S.alphaHist.count > 60) { const thr = S.alphaHist.median() + 3 * 1.4826 * S.alphaHist.mad();
            if (ea > thr) { if (!S.alphaBurst) S.alphaBurst = t; } else if (S.alphaBurst != null) { const dur = t - S.alphaBurst; if (dur >= 0.5 && dur <= 2) S.alphaBursts.push(t); S.alphaBurst = null; } }
          while (S.alphaBursts.length && S.alphaBursts[0] < t - 600) S.alphaBursts.shift();
        }
        // EMG baselines (non-burst samples, every 50 ms)
        for (const c of eeg) if (!S.inB[c] && !excluded[c]) S.base[c].push(S.env[c]);
        // live tension label
        if (S.merged && t - S.merged.onset > 1 && !S.merged.tensionMarked) { S.merged.tensionMarked = true; }
        // pops: evaluate steps older than 100 ms
        const keep = [];
        for (const s of S.steps) {
          if (s.t > t - 0.1) { keep.push(s); continue; }
          if (s.t < t - 0.5) continue;
          if (s.done) continue;
          const near = S.steps.filter(x => x !== s && Math.abs(x.t - s.t) <= 0.05);
          const chans = new Set(near.map(x => x.c));
          if (chans.size + 1 >= Math.max(2, 0.5 * use(eeg).length)) { s.done = true; S.commonSteps = (S.commonSteps || 0) + 1; continue; }     // common to many channels: motion proxy
          const others = [...chans].filter(c => c !== s.c);
          const same = S.steps.filter(x => x.c === s.c && Math.abs(x.t - s.t) <= 0.1).length;
          if (others.length === 0 && !S.inB[s.c] && same <= 3 && !(S.merged && S.merged.chans.has(s.c))) {
            S.steps.filter(x => x.c === s.c && Math.abs(x.t - s.t) <= 0.1).forEach(x => { x.done = true; });
            if (!S.lastPop || S.lastPop[s.c] == null || s.t - S.lastPop[s.c] > 1) { S.lastPop = S.lastPop || {}; S.lastPop[s.c] = s.t;
              emit({ type: "electrode_pop", sub: s.sat ? "saturation" : null, onset: s.t, offset: s.t + 0.05, conf: 0.8, channels: [o.channels[s.c]], chanIdx: [s.c], amp: null, durMs: 50, t }); }
          } else s.done = true;
        }
        S.steps = S.steps.filter(s => s.t > t - 0.5);
      }
      S.lastTickIdx = iNow;
      return drain();
    }
    function drain() { const e = S.out; S.out = []; return e; }
    /* gap of n samples before index i: reset the filters, drop open candidates, close an open burst at the gap start */
    function gap(i, n) {
      for (let c = 0; c < C; c++) { const s = mkCh(); ch[c] = s; } for (let q = 0; q < rest.length; q++) rest[q] = mkRest();
      S.eaMA = null; S.cand = null; S.eaRun = null; S.steps = [];
      if (S.merged) { [...S.merged.open].forEach(c => { S.inB[c] = 0; burstChannelEnd(c, (i - n) / fs); }); }
      S.inB.fill(0); S.above.fill(0); S.below.fill(0);
      S.validFrom = i + Math.round(0.5 * fs); S.scanFrom = S.validFrom;
      if (S.eyesClosed) closeEyes((i - n) / fs);
    }
    /* intervals still open (for provisional masks) */
    function pending(t) {
      const p = [];
      if (S.merged) p.push({ type: "emg_burst", sub: "open", onset: S.merged.onset, chanIdx: [...S.merged.chans] });
      if (S.cand) p.push({ type: "blink", sub: "open", onset: tOf(S.cand.i) - 0.3, split: !!S.cand.splitFrom, slope: S.cand.ds, level: S.idx >= 0 ? Math.abs(vrAt(S.idx) - S.cand.m) / S.cand.A : 0 });
      if (S.eyesClosed) p.push({ type: "eyes_closed", sub: "open", onset: S.eyesClosed.onset });
      if (S.eaRun && t - S.eaRun.t0 > 0.3) p.push({ type: "eyes_closed", sub: "candidate", onset: S.eaRun.t0 - 1.5 });
      return p;
    }
    function det() { return { blinkAmpMed: S.medAmp, blinkAmpMad: S.madAmp, blinkDurMed: S.durMed, blinkSign: S.sign, n: S.detN + S.nBlinks }; }
    function activity(t) { return { chewing: t < S.chewUntil, talking: t < S.talkUntil, talkRecent: t - S.talkSeen < 3, lastBurstEnd: S.lastBurstEnd, inBurst: !!S.merged, eyesClosed: !!S.eyesClosed }; }
    return { push, tick, gap, pending, det, activity, setExcluded, groups: G, state: S, cfg: k, devCfg: kd };
  }
  const API = { create, DEF, GROUPS, groupsFor };
  E.Events = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
