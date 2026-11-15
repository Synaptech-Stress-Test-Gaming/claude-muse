/* engine/metrics.js
   FOCUS, STRESS and DROWSINESS models on top of the normalized features (engine/norm.js). Within-person relative indices, not validated measures.
   FOCUS (both devices): focusRaw = wTheta z(thetaF) - wAlpha z(alphaP) + wBeta z(betaLoC)  (defaults 1, 1, 0.5; tunable 0-2).
     Counts only when thetaF and alphaP are valid and the window is eyes-open; betaLoC is optional. focusRaw is normalized itself
     (prior 0 +/- 1.5, 90 min within-session offset), then an EMA (tau about 2 s, on usable windows only), then the score.
     conf = cleanFrac x channelShare x badgeConf x aliasFactor x ceiling (1.0 Cyton, 0.7 Muse).
   STRESS (labelled STRESS, measures arousal): hr z(hr8) 0.45/0.65, hrv -z(lnRmssd) 0.40/0.20, eeg -z(alphaP) 0.15/0.15 (Cyton/Muse weights);
     missing components are dropped and the weights renormalised (never treated as 0); at least one cardiac component is needed
     (else unavailable, "no ECG" / "no pulse"). Exertion guard: motion over 30% of the last 20 s, or hr8 up > 15 bpm in 20 s while lnRmssd did not
     fall -> held ("movement"), nothing learned. stressRaw normalized (prior 0 +/- 0.62 Cyton / 0.70 Muse, 45 min offset), EMA tau 4 s.
   DROWSINESS (Cyton only, null on the Muse): markers ratioD, blink duration, blink rate (|z| x 0.5), PERCLOS, alpha "spindles", each a z against the
     LIFETIME tier only (frozen in the session); zD = mean of the available z, capped at +1 unless >= 2 markers are each above +0.5; EMA tau 60 s.
     Until the profile holds 10 clean minutes for these markers: learning, value null ("Needs 10 min of history").
   UMD: MuseEngine.Metrics. Tested by engine/metrics.test.js. */
"use strict";
(function (root) {
  const E = root.MuseEngine = root.MuseEngine || {};
  const U = E.Util || (typeof require !== "undefined" ? require("./util.js") : null);
  const N = E.Norm || (typeof require !== "undefined" ? require("./norm.js") : null);
  const FEATURES = { cyton: ["thetaF", "alphaP", "betaLoC", "ratioD", "hr", "lnRmssd", "blinkDur", "blinkRate", "perclos", "spindleRate", "focusRaw", "stressRaw"],
    muse: ["thetaF", "alphaP", "betaLoC", "hr", "lnRmssd", "focusRaw", "stressRaw"] };
  const EEG_KEYS = ["thetaF", "alphaP", "alphaP@iaf", "betaLoC", "ratioD"], DROWSY_KEYS = ["ratioD", "blinkDur", "blinkRate", "perclos", "spindleRate"];
  const DEF = {
    focus: { wTheta: 1, wAlpha: 1, wBeta: 0.5, offsetTauMin: 90, emaS: 2, ceilingCyton: 1.0, ceilingMuse: 0.7 },
    stress: { cyton: { hr: 0.45, hrv: 0.40, eeg: 0.15 }, muse: { hr: 0.65, hrv: 0.20, eeg: 0.15 }, offsetTauMin: 45, emaS: 4, ceilingCyton: 1.0, ceilingMuse: 0.8, exertMotionFrac: 0.3, exertHrBpm: 15, exertWinS: 20 },
    drowsy: { emaS: 60, needLifetimeS: 600, ratioWinS: 20, ratioNeedS: 8, updateS: 2, blinkWinS: 60, blinkMin: 5, capZ: 1, needTwoZ: 0.5, rateWeight: 0.5 }
  };
  function create(o) {
    o = Object.assign({ device: "muse", priors: null, cfg: null, iafKey: "alphaP" }, o);
    const dev = o.device, k = U.deepMerge(DEF, o.cfg || {}), P = o.priors.features;
    const feats = {};
    function mkFeat(key) { const base = key === "alphaP@iaf" ? "alphaP" : key; const pr = P[base]; if (!pr) return null;
      // EEG power features re-anchor on a new contact epoch; ratioD is a log ratio (an electrode gain change cancels) and a drowsiness marker: lifetime tier only
      const opt = { isEeg: ["thetaF", "alphaP", "alphaP@iaf", "betaLoC"].includes(key) };
      if (DROWSY_KEYS.includes(key)) opt.lifetimeOnly = true;
      if (key === "focusRaw") opt.offsetTau = k.focus.offsetTauMin * 60;
      if (key === "stressRaw") opt.offsetTau = k.stress.offsetTauMin * 60;
      return N.feature(pr, opt); }
    for (const key of FEATURES[dev].concat(o.iafKey === "alphaP@iaf" ? ["alphaP@iaf"] : [])) { const f = mkFeat(key); if (f) feats[key] = f; }
    const alphaKey = o.iafKey === "alphaP@iaf" && feats["alphaP@iaf"] ? "alphaP@iaf" : "alphaP";
    const S = { zf: null, zs: null, zd: null, hrHist: [], lnHist: [], ratioHist: [], lastDrowsyT: -1e9, drowsyMarkers: null, sessions: 0 };
    const sig = z => 100 / (1 + Math.exp(-1.7 * z));
    const ema = (prev, z, a) => prev == null ? z : prev + a * (z - prev);
    function badgeOf(key) { const f = feats[key]; return N.badge(f ? f.personalTime() : 0, S.sessions); }

    /* inp: {t, hop, feats, cardiac:{hr8, lnRmssd, hrvNew, sqi, quality}, motionFrac20, aliasWarn, drowsy:{blinkDurs60, blinkCount60, perclos, spindleRate}} */
    function hop(inp) {
      const ups = [], t = inp.t, h = inp.hop || 0.25, F = inp.feats;
      // ---------- FOCUS
      const th = F.thetaF, al = F.alphaP, be = F.betaLoC;
      const eyesClosed = !!(th.eyesClosed || al.eyesClosed);
      const focus = { usable: false, value: null, conf: 0, reason: null, learning: false, available: true, z: null };
      const fl = k.focus;
      if (th.valid && al.valid && !eyesClosed) {
        const zt = feats.thetaF.z(th.x), za = feats[alphaKey].z(al.x), zb = be.valid ? feats.betaLoC.z(be.x) : null;
        const raw = fl.wTheta * zt - fl.wAlpha * za + (zb != null ? fl.wBeta * zb : 0);
        const cf = U.mean([th.cleanFrac, al.cleanFrac].concat(be.valid ? [be.cleanFrac] : []));
        const z = feats.focusRaw.z(raw);
        if (S.restartFocus) { S.zf = null; S.restartFocus = false; }
        S.zf = ema(S.zf, z, 1 - Math.exp(-h * cf / fl.emaS));
        const share = U.mean([th.nCh / th.nChSet, al.nCh / al.nChSet, be.valid ? be.nCh / be.nChSet : 0]);
        const b = badgeOf("focusRaw");
        focus.usable = true; focus.value = sig(S.zf); focus.z = S.zf; focus.raw = raw;
        focus.conf = U.clamp01(cf * share * b.conf * (inp.aliasWarn ? 0.7 : 1) * (dev === "cyton" ? fl.ceilingCyton : fl.ceilingMuse));
        focus.learning = feats.thetaF.learning() || feats[alphaKey].learning();
        focus.badge = b;
        ups.push({ key: "focusRaw", x: raw, w: h * cf });
      } else focus.reason = eyesClosed ? "eyes closed" : (!th.valid ? th.reason : al.reason) || "no contact";
      if (!eyesClosed) {
        if (th.valid) ups.push({ key: "thetaF", x: th.x, w: h * th.cleanFrac });
        if (al.valid) ups.push({ key: alphaKey, x: al.x, w: h * al.cleanFrac });
        if (be.valid) ups.push({ key: "betaLoC", x: be.x, w: h * be.cleanFrac });
      }
      // ---------- STRESS
      const sw = k.stress[dev], card = inp.cardiac || {}, stress = { usable: false, value: null, conf: 0, reason: null, learning: false, available: true, exertion: false,
        components: { hr: { z: null, valid: false, bpm: card.hr8 != null ? card.hr8 : null }, hrv: { z: null, valid: false, rmssdMs: card.rmssdMs != null ? card.rmssdMs : null }, eeg: { z: null, valid: false } } };
      const C = stress.components;
      if (card.hr8 != null && isFinite(card.hr8)) { C.hr.z = feats.hr.z(card.hr8); C.hr.valid = C.hr.z != null; }
      if (card.lnRmssd != null && isFinite(card.lnRmssd)) { const z = feats.lnRmssd.z(card.lnRmssd); C.hrv.z = z == null ? null : -z; C.hrv.valid = z != null; }
      if (al.valid && !eyesClosed) { const z = feats[alphaKey].z(al.x); C.eeg.z = z == null ? null : -z; C.eeg.valid = z != null; }
      // exertion guard
      S.hrHist.push({ t, hr: card.hr8, ln: card.lnRmssd }); while (S.hrHist.length && S.hrHist[0].t < t - k.stress.exertWinS) S.hrHist.shift();
      const old = S.hrHist.find(x => x.hr != null);
      const hrRise = old && card.hr8 != null ? card.hr8 - old.hr : 0, lnOld = S.hrHist.find(x => x.ln != null), lnChange = lnOld && card.lnRmssd != null ? card.lnRmssd - lnOld.ln : 0;
      const exertion = (inp.motionFrac20 || 0) > k.stress.exertMotionFrac || (hrRise > k.stress.exertHrBpm && lnChange >= -0.05);
      if (!C.hr.valid && !C.hrv.valid) { stress.available = false; stress.reason = dev === "cyton" ? "no ECG" : "no pulse"; }
      else {
        let s = 0, wsum = 0; for (const key of ["hr", "hrv", "eeg"]) if (C[key].valid) { s += sw[key] * C[key].z; wsum += sw[key]; }
        const raw = s / wsum, z = feats.stressRaw.z(raw);
        if (S.restartStress) { S.zs = null; S.restartStress = false; }
        S.zs = ema(S.zs, z, 1 - Math.exp(-h / k.stress.emaS));
        const b = badgeOf("hr"), sqi = dev === "cyton" ? (card.sqi || 0) : (card.quality != null ? card.quality : 0.5);
        stress.value = sig(S.zs); stress.z = S.zs; stress.raw = raw; stress.badge = b;
        stress.conf = U.clamp01(wsum * sqi * b.conf * (dev === "cyton" ? k.stress.ceilingCyton : k.stress.ceilingMuse));
        if (exertion) { stress.exertion = true; stress.usable = false; stress.reason = "movement"; }
        else { stress.usable = true;
          if (C.hr.valid) ups.push({ key: "hr", x: card.hr8, w: h });
          if (C.hrv.valid && card.hrvNew) ups.push({ key: "lnRmssd", x: card.lnRmssd, w: 5 });
          ups.push({ key: "stressRaw", x: raw, w: h }); }
      }
      // ---------- DROWSINESS (Cyton)
      let drowsiness = null;
      if (dev === "cyton") {
        const dk = k.drowsy, rd = F.ratioD;
        S.ratioHist.push({ t, x: rd && rd.valid && !rd.eyesClosed ? rd.x : null, w: rd && rd.valid ? rd.cleanFrac : 0 }); while (S.ratioHist.length && S.ratioHist[0].t < t - dk.ratioWinS) S.ratioHist.shift();
        drowsiness = { usable: false, value: null, conf: 0, reason: null, learning: false, available: true, markers: { ratio: { z: null, valid: false }, blinkDur: { z: null, valid: false }, blinkRate: { z: null, valid: false }, perclos: { z: null, valid: false }, spindles: { z: null, valid: false } } };
        const life = feats.ratioD ? feats.ratioD.life.W : 0;
        if (t - S.lastDrowsyT >= dk.updateS) {
          S.lastDrowsyT = t; const M = {}, d = inp.drowsy || {};
          const okR = S.ratioHist.filter(x => x.x != null); if (okR.length * h >= dk.ratioNeedS) M.ratio = U.mean(okR.map(x => x.x));
          if (d.blinkDurs60 && d.blinkDurs60.length >= dk.blinkMin) M.blinkDur = U.median(d.blinkDurs60);
          if (d.blinkCount60 != null && d.blinkWinS >= 30) M.blinkRate = d.blinkCount60 * 60 / d.blinkWinS;
          if (d.perclos != null) M.perclos = d.perclos;
          if (d.spindleRate != null) M.spindleRate = d.spindleRate;
          S.drowsyMarkers = M;
          const key = { ratio: "ratioD", blinkDur: "blinkDur", blinkRate: "blinkRate", perclos: "perclos", spindleRate: "spindleRate" };
          for (const m in M) ups.push({ key: key[m], x: M[m], w: dk.updateS });
        }
        const M = S.drowsyMarkers || {}, mk = drowsiness.markers, zs = [], strong = [];
        const put = (name, key, val, fn) => { if (val == null || !feats[key]) return; const z = feats[key].z(val); if (z == null) return; const zz = fn ? fn(z) : z; mk[name] = { z: zz, valid: true }; zs.push(zz); if (zz > dk.needTwoZ) strong.push(name); };
        put("ratio", "ratioD", M.ratio); put("blinkDur", "blinkDur", M.blinkDur); put("blinkRate", "blinkRate", M.blinkRate, z => dk.rateWeight * Math.abs(z));
        put("perclos", "perclos", M.perclos); put("spindles", "spindleRate", M.spindleRate);
        if (life < dk.needLifetimeS) { drowsiness.learning = true; drowsiness.reason = "learning"; drowsiness.usable = false; drowsiness.needLearning = true; }
        else if (zs.length) {
          let zD = U.mean(zs); if (zD > dk.capZ && strong.length < 2) zD = dk.capZ;
          S.zd = ema(S.zd, zD, 1 - Math.exp(-h / dk.emaS));
          drowsiness.usable = true; drowsiness.value = sig(S.zd); drowsiness.z = S.zd; drowsiness.conf = U.clamp01(zs.length / 5 * N.badge(life, S.sessions).conf);
        } else drowsiness.reason = F.ratioD && F.ratioD.eyesClosed ? "eyes closed" : (F.ratioD && F.ratioD.reason) || "no contact";
      }
      return { focus, stress, drowsiness, updates: ups };
    }
    function apply(u) { const f = feats[u.key]; if (!f) return null; return f.update(u.x, u.w); }
    function newEpoch() { for (const key of EEG_KEYS) if (feats[key]) feats[key].newEpoch(); }
    function loadLifetime(byKey, base, sessions) { for (const key in feats) feats[key].loadLifetime((byKey && byKey[key]) || [], base && base[key]); S.sessions = sessions || 0; }
    function summary() { const out = {}; for (const key in feats) out[key] = feats[key].summary(); return out; }
    function stalled() { return EEG_KEYS.some(key => feats[key] && feats[key].stall); }
    return { hop, apply, newEpoch, loadLifetime, summary, stalled, feats, alphaKey, state: S, cfg: k, restart(m) { if (m === "focus") S.restartFocus = true; if (m === "stress") S.restartStress = true; } };
  }
  const API = { create, FEATURES, DEF, EEG_KEYS, DROWSY_KEYS };
  E.Metrics = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
