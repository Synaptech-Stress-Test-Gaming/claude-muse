/* engine/pipeline.js
   MuseEngine.CONFIG (every tunable constant, deep-merged with MuseEngine.TUNED.config when present) and MuseEngine.create(opts),
   which wires the stages in this fixed order:
     1 ingest + gap bookkeeping (frame.js)         every frame
     2 preprocessing (preproc.js)                   every sample      raw -> xd, xb, xa
     3 contact (contact.js)                         every 1 s
     4 events (events.js) + motion (motion.js)      every 50 ms       -> events, masks (mask.js)
     5 cleaning (clean.js), optional               ASR every 500 ms, NLMS per sample   xa -> xc
     6 features (features.js)                       every hop (0.25 s) on the 2 s window that ends D seconds in the past
     7 metric models (metrics.js, ecg.js, ppg.js, buttons.js)   hop (buttons at once, at stage 4)
     8 normalization (norm.js)                      hop (updates wait 5 s in quarantine)
     9 hold/fade + output (holdfade.js)             hop
   Analysis delay D = 0.5 s (+0.5 s with ASR): a mask always exists before its window is scored, so detection lag never leaks into a score.
   All timing is stream time (sampleIndex / fs), so runs are deterministic. Pure apart from the optional profile store. */
"use strict";
(function (root) {
  const E = root.MuseEngine = root.MuseEngine || {};
  const req = (name, file) => E[name] || (typeof require !== "undefined" ? require(file) : null);
  const U = req("Util", "./util.js");

  const CONFIG = {
    hop: 0.25, win: 2, delay: 0.5, delayAsrExtra: 0.5, holdS: 3.0, staleRestartS: 30, keepS: 30, tickS: 0.05, quarantineS: 5, epochGapS: 5, identityGapS: 30,
    preproc: { dcHz: 0.5, notchQ: 30, lpMax: 45 },
    contact: { railUv: 178125, railFrac: 0.02, rmsLo: 1, rmsGood: 3, rmsHi: 80, rmsMax: 190, lineGood: 2, lineBad: 20, impGood: 750, impBad: 2500, exclude: 40, include: 50, includeS: 3 },
    motion: { acc: { entry: 0.02, exit: 0.01 }, gyro: { entry: 10, exit: 5 }, stableS: 1.5, winS: 1.25, staleS: 0.5, minFrac: 0.48, noAccelS: 10 },
    events: { cyton: { blinkFloorUv: 60, blinkDerivFloor: 600, blinkAmpMed: 120, blinkAmpMad: 30 }, muse: { blinkFloorUv: 40, blinkDerivFloor: 400, blinkAmpMed: 80, blinkAmpMad: 20 },
      blinkK: 4, volFactor: 1.5, emgRatioIn: 3.0, emgRatioOut: 2.0, emgBaseFloorUv: 0.5, popSlope: 12500, satUv: 300 },
    mask: { blinkPre: 0.1, blinkPost: 0.4, saccPre: 0.1, saccPost: 0.3, emgPre: 0.1, emgPost: 0.3, chewPost: 1.0, motionPre: 0.2, motionPost: 0.5, gapPost: 2.0, popS: 1.0 },
    norm: { tauC: 10, T0: 120, forget: 0.98, Tcap: 36000, winsorK: 3 },
    focus: { wTheta: 1, wAlpha: 1, wBeta: 0.5, offsetTauMin: 90, emaS: 2 },
    stress: { cyton: { hr: 0.45, hrv: 0.40, eeg: 0.15 }, muse: { hr: 0.65, hrv: 0.20, eeg: 0.15 }, offsetTauMin: 45, emaS: 4 },
    drowsy: { emaS: 60, needLifetimeS: 600 },
    buttons: { dbMinMs: 150, dbMaxMs: 600, thirdMs: 400, refrDbMs: 800, refrClMs: 500, preQuietS: 1.5, talkBoost: 1.5 },
    asr: { k: 20, calibS: 60, recalibS: 60, spanS: 300, blockS: 0.5, maxDimsFrac: 0.66, removedMasked: 0.5 },
    nlms: { mu: 0.1, eps: 1e-6, maxTaps: 128, tapsS: 0.4 }
  };
  E.CONFIG = CONFIG;
  const REASONS = ["movement", "muscle", "blink", "no contact", "no ECG", "no pulse", "signal lost", "eyes closed", "learning"];

  function create(opts) {
    const Fr = req("Frame", "./frame.js"), Pp = req("Preproc", "./preproc.js"), Ct = req("Contact", "./contact.js"), Mo = req("Motion", "./motion.js"),
      Ev = req("Events", "./events.js"), Mk = req("Mask", "./mask.js"), Ft = req("Features", "./features.js"), Ec = req("Ecg", "./ecg.js"), Pg = req("Ppg", "./ppg.js"),
      Nm = req("Norm", "./norm.js"), Mt = req("Metrics", "./metrics.js"), Bt = req("Buttons", "./buttons.js"), Hf = req("HoldFade", "./holdfade.js"), Lg = req("Legacy", "./legacy.js");
    let Cl = null; try { Cl = req("Clean", "./clean.js"); } catch (e) { Cl = null; }
    let Id = null; try { Id = req("Identity", "./identity.js"); } catch (e) { Id = null; }
    let PRI = opts && opts.priors; if (!PRI) { try { PRI = req("PRIORS", "./priors.js"); } catch (e) { PRI = null; } }
    opts = Object.assign({ device: "muse", fs: 256, channels: null, ecgChannel: -1, unusedChannels: [], mains: 60, flags: null, tuned: null, store: null, legacyProvider: null,
      ownerBaseRate: 0.7, motionTh: null, accel: null, undoPanelHp: null, cfg: null }, opts);
    const dev = opts.device, fs = opts.fs, chans = (opts.channels || (dev === "muse" ? ["TP9", "AF7", "AF8", "TP10"] : [])).slice(), C = chans.length;
    const tuned = opts.tuned || null;
    // tuned.config is either per device ({cyton: {...}, muse: {...}}, as tools/autotune.py writes it) or one object for both
    const tc = tuned && tuned.config ? (tuned.config.cyton || tuned.config.muse ? tuned.config[dev] || null : tuned.config) : null;
    const cfg = U.deepMerge(U.deepMerge(CONFIG, tc), opts.cfg || null);
    const flags = Object.assign({ asr: dev === "cyton", nlms: false }, cfg.flags || {}, opts.flags || {});
    const priorsDev = U.deepMerge(PRI[dev], tuned && tuned.priors && tuned.priors[dev] ? tuned.priors[dev] : null);
    const ecgCh = dev === "cyton" ? (opts.ecgChannel != null ? opts.ecgChannel : -1) : -1;
    const unused = new Set(opts.unusedChannels || []);
    const eegIdx = chans.map((_, i) => i).filter(i => i !== ecgCh && !unused.has(i) && chans[i] !== "ECG");
    const D = cfg.delay + (flags.asr && Cl ? cfg.delayAsrExtra : 0), hop = cfg.hop, L = Math.round(cfg.keepS * fs);

    // ---- modules
    const pre = Pp.create(Object.assign({ fs, mains: opts.mains, nCh: C }, cfg.preproc));
    const contact = Ct.create({ fs, device: dev, channels: chans, eegIdx, mains: opts.mains, cfg: cfg.contact });
    const det = opts.store && opts.store.detFor ? opts.store.detFor(dev) : null;
    const events = Ev.create({ fs, device: dev, channels: chans, eegIdx, cfg: cfg.events, det, mains: opts.mains, undoPanelHp: opts.undoPanelHp != null ? opts.undoPanelHp : dev === "muse" && !!opts.legacyProvider });
    const G = events.groups;
    const mask = Mk.create({ fs, device: dev, channels: chans, groups: G, eegIdx, cfg: cfg.mask });
    let gate = Mo.Gate({ kind: dev, cfg: cfg.motion, th: opts.motionTh });
    const proxy = Mo.Proxy({ fs, nCh: C, kind: dev });
    const feat = Ft.create({ fs, device: dev, channels: chans, eegIdx, iaf: opts.iaf || null });
    const ecg = ecgCh >= 0 ? Ec.create({ fs }) : null, ppg = dev === "muse" ? Pg.create({}) : null;
    const metrics = Mt.create({ device: dev, priors: priorsDev, cfg: { focus: cfg.focus, stress: cfg.stress, drowsy: cfg.drowsy }, iafKey: opts.iaf && opts.iaf.valid ? "alphaP@iaf" : "alphaP" });
    const buttons = Bt.create({ device: dev, cfg: cfg.buttons });
    const hf = { focus: Hf.create({ holdS: cfg.holdS, restartS: cfg.staleRestartS, hop }), stress: Hf.create({ holdS: cfg.holdS, restartS: cfg.staleRestartS, hop }), drowsiness: Hf.create({ holdS: cfg.holdS, restartS: cfg.staleRestartS, hop }) };
    const legacy = dev === "cyton" ? Lg.LegacyFocus({ fs }) : null;
    const asr = flags.asr && Cl ? Cl.ASR({ fs, channels: eegIdx, cfg: cfg.asr, stored: opts.store && opts.store.asrFor ? opts.store.asrFor(dev) : null }) : null;
    const nlms = flags.nlms && Cl ? Cl.NLMS({ fs, channels: eegIdx, cfg: cfg.nlms }) : null;
    const quarantine = Nm.Quarantine(cfg.quarantineS), epochDet = Nm.EpochDetector({ nCh: eegIdx.length, cyton: dev === "cyton" });
    const identity = Id ? Id.create({ device: dev, store: opts.store, ownerBaseRate: opts.ownerBaseRate, cfg: cfg.identity }) : null;

    // ---- sample store (30 s rings indexed by absolute sample index)
    const R = { raw: [], xd: [], xa: [], xc: [], xb: [] }; for (let c = 0; c < C; c++) { R.raw.push(new Float32Array(L)); R.xd.push(new Float32Array(L)); R.xa.push(new Float32Array(L)); R.xb.push(new Float32Array(L)); if (asr || nlms) R.xc.push(new Float32Array(L)); }
    const have = new Uint8Array(L);
    const ring = (arr, a, b) => { const out = new Float32Array(b - a); for (let i = a; i < b; i++) out[i - a] = arr[((i % L) + L) % L]; return out; };
    const getSeg = (c, a, b) => ring(asr || nlms ? R.xc[c] : R.xa[c], a, b);

    const st = { streamId: null, firstIdx: null, idx: -1, t: 0, nextTick: null, nextHop: null, nextSec: null, nextSlot: null, out: null, gaps: Fr.GapBook(), evId: 0, newEvents: [], outEvents: [],
      accelSeen: false, noAccelSince: null, useProxy: opts.accel === false, gateState: "VALID", motionHist: [], cleanSec: 0, cleanSecCount: 0, recv: [], lostHist: [], epochStart: 0, epochs: 0,
      dropZones: [], muse: { contact: null, ppgHr: null }, impedance: false, aliasWarn: false, warnings: new Set(), blinks: [], eyesClosed: [], lastFrameIdx: null, firstT: null,
      sessionStart: null, hops: 0, legacyBuf: null, mapCheck: { done: false, eye: [], post: [] }, ecgOut: null, ppgOut: null, gyroSeen: false, nlmsRef: null, sessionCount: 0 };
    const eng = { onEvent: null, cfg, flags, device: dev, fs, channels: chans, eegIdx, D, legacy };
    const xbArr = new Float64Array(C), xdArr = new Float64Array(C);

    function nextId() { return ++st.evId; }
    function emitEvent(ev) {
      if (ev.id == null) ev.id = nextId();
      if (ev.t == null) ev.t = st.t;
      st.outEvents.push(ev);
      const it = mask.add(ev);
      if (it && it.chans == null && ev.type !== "gap") st.dropZones.push({ t0: it.t0, t1: it.t1, at: st.t });
      if (ev.type === "eyes_closed") { st.dropZones.push({ t0: ev.onset - 0.5, t1: ev.offset + 0.5, at: st.t }); st.eyesClosed.push({ t0: ev.onset, t1: ev.offset }); }
      if (ev.type === "blink") { st.blinks.push({ t: ev.onset, durMs: ev.durMs, amp: ev.amp, peak: ev.peak }); if (st.blinks.length > 200) st.blinks.shift(); }
      return ev;
    }
    function newEpoch(why) {
      metrics.newEpoch(); epochDet.reset(); st.epochStart = st.t; st.epochs++;
      st.dropZones.push({ t0: -Infinity, t1: st.t, at: st.t + 1e-9 });   // nothing queued before the epoch is learned
      if (identity && why === "gap30") identity.restart && identity.restart(st.t);
    }
    function resetStreamState() {
      pre.resetAll(); for (let c = 0; c < C; c++) proxy.resetChannel(c); have.fill(0);
      gate = Mo.Gate({ kind: dev, cfg: cfg.motion, th: gate.th });
      st.accelSeen = false; st.noAccelSince = null; st.useProxy = opts.accel === false; st.lastFrameIdx = null;
    }
    /* ---------------- stage 4: every 50 ms ---------------- */
    function stageTick(t) {
      const tick = cfg.tickS;
      // events
      const evs = events.tick(t);
      // motion gate or EEG proxy
      if (!st.useProxy && !st.accelSeen && st.firstT != null && t - st.firstT >= cfg.motion.noAccelS) st.useProxy = true;
      let gs;
      if (st.useProxy) { gs = proxy.state; }
      else { gs = gate.step(t, tick); gate.drain().forEach(e => { if (!e.silent) emitEvent(Object.assign(e, { t })); }); }
      st.gateState = st.useProxy ? (proxy.state === "VALID" ? "VALID" : "MOVEMENT") : gs;
      st.motionHist.push({ t, bad: st.gateState !== "VALID" }); while (st.motionHist.length && st.motionHist[0].t < t - 20) st.motionHist.shift();
      // finalized detector events -> masks, buttons
      const act = events.activity(t);
      for (const e of evs) emitEvent(e);
      buttons.onEvents(evs, { t, gateValid: st.gateState === "VALID" });
      const pend = events.pending(t), blinkOpen = pend.find(p => p.type === "blink" && p.sub === "open");
      for (const b of buttons.tick(t, { gateValid: st.gateState === "VALID", blinkOpenSince: blinkOpen ? blinkOpen.onset + 0.3 : null, blinkOpenSplit: blinkOpen ? blinkOpen.split : false, blinkOpenLevel: blinkOpen ? blinkOpen.level : 0 })) {
        b.id = nextId(); b.t = t; st.outEvents.push(b); if (eng.onEvent) { try { eng.onEvent(b); } catch (e) {} } }
      // open masks: bursts in progress, blink candidates, motion, impedance, excluded channels
      const open = [];
      for (const p of pend) {
        if (p.type === "emg_burst") { const ci = p.chanIdx || []; open.push({ t0: p.onset - cfg.mask.emgPre, reason: "muscle", chans: ci.length >= (dev === "muse" ? 2 : 4) ? null : [].concat(...ci.map(c => [c].concat(["frontal", "temporal", "posterior", "other"].filter(g => G[g].includes(c)).map(g => G[g]).flat()))) }); }
        if (p.type === "blink") open.push({ t0: p.onset, reason: "blink", chans: G.frontal });
      }
      if (st.gateState !== "VALID") { const o = st.useProxy ? proxy.open : gate.open; open.push({ t0: (o ? o.onset : t) - cfg.mask.motionPre, reason: "movement", chans: null }); }
      if (st.impedance) open.push({ t0: st.impedanceSince, reason: "no contact", chans: null });
      eegIdx.forEach(c => { if (contact.isExcluded(c)) open.push({ t0: contact.state.since[c] != null ? contact.state.since[c] : t, reason: "no contact", chans: [c] }); });
      mask.setOpen(open);
      const ecOpen = pend.filter(p => p.type === "eyes_closed");
      mask.setOpenFlags(ecOpen.map(p => ({ t0: p.onset })));
      // eyes closed: from the moment it is detected, nothing queued from those windows is learned (the event itself is finalised only at the offset)
      const ecReal = ecOpen.find(p => p.sub === "open");
      if (ecReal && !st.ecZone) { st.ecZone = { t0: ecReal.onset - 0.5, t1: Infinity, at: t, keep: true }; st.dropZones.push(st.ecZone); }
      if (!ecReal && st.ecZone) { st.ecZone.t1 = t + 0.5; st.ecZone.at = t; st.ecZone.keep = false; st.ecZone = null; }
      // proxy slot every 250 ms
      if (st.useProxy && t >= st.nextSlot - 1e-9) { st.nextSlot += 0.25; const good = eegIdx.filter(c => !contact.isExcluded(c)); proxy.slot(t, good); proxy.drain().forEach(e => emitEvent(Object.assign(e, { t }))); }
      // quarantine
      quarantine.flush(t, (a, b) => st.dropZones.some(z => z.t1 > a && z.t0 < b));
      st.dropZones = st.dropZones.filter(z => z.keep || z.at > t - 10);
      if (metrics.stalled()) newEpoch("stall");
      void act;
    }
    /* ---------------- stage 3 (and epoch checks): every 1 s ---------------- */
    function stageSecond(t) {
      const i1 = st.idx + 1, i0 = Math.max(i1 - fs, st.firstIdx);
      if (i1 - i0 < fs * 0.5) return;
      if (dev === "muse") { if (st.muse.contact) contact.passthrough(t, st.muse.contact); }
      else contact.update(t, c => ({ raw: ring(R.raw[c], i0, i1), xd: ring(R.xd[c], i0, i1), xa: ring(R.xa[c], i0, i1) }));
      eegIdx.forEach(c => events.setExcluded(c, contact.isExcluded(c)));
      for (const e of contact.drain()) { if (e.phase === "end") emitEvent({ type: "bad_contact", sub: null, onset: e.onset, offset: e.offset, channels: e.channels, conf: 1, t, durMs: e.durMs }); else st.outEvents.push(Object.assign({ id: nextId(), type: "bad_contact", sub: "start", offset: null, conf: 1 }, e)); }
      // clean-second bookkeeping and the contact-epoch detector (clean seconds only)
      const clean = !mask.state.list.concat(mask.state.open.map(x => ({ t0: x.t0, t1: Infinity, chans: x.chans }))).some(it => it.chans == null && it.t1 > t - 1 && it.t0 < t);
      if (clean) {
        st.cleanSec++;
        const good = eegIdx.filter(c => !contact.isExcluded(c));
        const lnRms = eegIdx.map(c => good.includes(c) ? Math.log(Math.sqrt(U.variance(ring(R.xa[c], i0, i1))) + 1e-9) : null);
        const lineDb = dev === "cyton" ? eegIdx.map(c => { const d = contact.state.detail[c]; return d ? 10 * Math.log10(d.lineRatio + 1e-12) : null; }) : null;
        let cov = null, n = 0;
        if (dev === "cyton" && good.length >= 3 && i1 - Math.max(st.firstIdx, i1 - 5 * fs) >= 4 * fs) { n = good.length; const j0 = Math.max(st.firstIdx, i1 - 5 * fs), X = good.map(c => ring(R.xa[c], j0, i1)), m = X.map(x => U.mean(x));
          cov = new Float64Array(n * n); const len = X[0].length; for (let a = 0; a < n; a++) for (let b = a; b < n; b++) { let s = 0; for (let k = 0; k < len; k++) s += (X[a][k] - m[a]) * (X[b][k] - m[b]); cov[a * n + b] = cov[b * n + a] = s / len; }
          let tr = 0; for (let a = 0; a < n; a++) tr += cov[a * n + a]; for (let a = 0; a < n; a++) cov[a * n + a] += 1e-3 * tr / n; }
        const r = epochDet.second(st.cleanSec, { lnRms, lineDb, shape: st.lastShape || null, cov, n });
        if (r.newEpoch) newEpoch("detector");
      }
      // channel map check (Cyton, once after 3 min)
      if (dev === "cyton" && !st.mapCheck.done && t - st.firstT >= 180) { st.mapCheck.done = true; mapCheck(); }
    }
    function mapCheck() {
      const fp = ["Fp1", "Fp2"].map(n => chans.indexOf(n)).filter(i => i >= 0), oc = ["O1", "O2"].map(n => chans.indexOf(n)).filter(i => i >= 0);
      const ratios = []; for (const b of st.blinks.slice(-30)) { if (b.peak == null) continue; const ip = Math.round(b.peak * fs); if (st.idx - ip > L - fs || ip > st.idx) continue;
        const dev2 = (c) => { const base = R.xb[c][((ip - Math.round(0.25 * fs)) % L + L) % L]; return Math.abs(R.xb[c][(ip % L + L) % L] - base); };
        const e = U.mean(fp.map(dev2)), o = U.mean(oc.map(dev2)); if (o > 0) ratios.push(e / o); }
      const blinkOk = ratios.length < 5 || U.median(ratios) > 2;
      const est = feat.iafEstimate(), alphaOk = !st.lastPostVsFront || st.lastPostVsFront > 0;
      if (!blinkOk || !alphaOk || (est && est.cleanS > 120 && est.peak != null && est.peak < 0.05)) st.warnings.add("Channel map may not match the default Ultracortex layout");
    }
    /* ---------------- stages 6-9: every hop ---------------- */
    function stageHop(t) {
      st.hops++;
      const t1 = t - D, t0 = t1 - cfg.win;
      const sets = {}; for (const k in feat.sets) sets[k] = mask.windowInfo(t0, t1, feat.sets[k], feat.minCh);
      // nothing before the stream started
      if (t0 < st.firstT) for (const k in sets) sets[k] = Object.assign(sets[k], { usable: false, reason: "signal lost", cleanFrac: 0 });
      const F = feat.compute({ sets }, getSeg);
      st.lastShape = F.shape6;
      if (F.alphaP.valid && !F.alphaP.eyesClosed && F.alphaP.cleanFrac > 0.9) feat.accumulateIaf(F, hop * F.alphaP.cleanFrac);
      if (dev === "cyton" && F.alphaP.valid && F.thetaF.valid) st.lastPostVsFront = 1;
      // cardiac
      let card = {};
      if (ecg) { const o = ecg.hop(t); st.ecgOut = o; card = { hr8: o.hr8, lnRmssd: o.lnRmssd, rmssdMs: o.rmssdMs, hrvNew: o.hrvNew, sqi: o.sqi, state: o.state }; }
      else if (ppg) { const o = ppg.hop(t); st.ppgOut = o; card = { hr8: o.hr8, lnRmssd: o.lnRmssd, rmssdMs: o.rmssdMs, hrvNew: o.hrvNew, quality: o.quality, state: o.state }; }
      // drowsiness inputs (Cyton)
      let drowsy = null;
      if (dev === "cyton") {
        const tw = t - 60, b60 = st.blinks.filter(b => b.t >= tw), long = b60.filter(b => b.durMs > 500);
        const ecS = st.eyesClosed.reduce((s, e) => s + Math.max(0, Math.min(t, e.t1) - Math.max(tw, e.t0)), 0) + (events.activity(t).eyesClosed ? Math.min(60, t - (events.state.eyesClosed ? events.state.eyesClosed.onset : t)) : 0);
        const win = Math.min(60, t - st.firstT);
        drowsy = { blinkDurs60: b60.map(b => b.durMs), blinkCount60: b60.length, blinkWinS: win, perclos: win >= 30 ? Math.min(1, (ecS + long.reduce((s, b) => s + b.durMs / 1000, 0)) / win) : null,
          spindleRate: win >= 30 ? events.state.alphaBursts.filter(x => x >= tw).length * 60 / win : null };
        st.eyesClosed = st.eyesClosed.filter(e => e.t1 > t - 120);
      }
      const motionFrac20 = st.motionHist.length ? st.motionHist.filter(m => m.bad).length / st.motionHist.length : 0;
      if (hf.focus.staleFor > cfg.staleRestartS) metrics.restart("focus");
      if (hf.stress.staleFor > cfg.staleRestartS) metrics.restart("stress");
      const m = metrics.hop({ t, hop, feats: F, cardiac: card, motionFrac20, aliasWarn: st.aliasWarn, drowsy });
      const xv = f => f && f.valid && !f.eyesClosed ? f.x : null;
      st.lastRaw = { thetaF: xv(F.thetaF), alphaP: xv(F.alphaP), betaLoC: xv(F.betaLoC), ratioD: xv(F.ratioD), hr: card.hr8 == null ? null : card.hr8, lnRmssd: card.lnRmssd == null ? null : card.lnRmssd, focusRaw: m.focus.raw == null ? null : m.focus.raw, stressRaw: m.stress.raw == null ? null : m.stress.raw };
      // identity (profile choice) before any learning
      let prof = { id: null, label: null, confidence: 0, state: "guest", badge: "" };
      if (identity) prof = identity.observe({ t, feats: F, channels: chans, card, ecgTemplate: st.ecgOut ? st.ecgOut.template : null, contact: eegIdx.map(c => contact.state.Q[c]), clean: F.alphaP.valid && F.thetaF.valid && st.gateState === "VALID" && !F.alphaP.eyesClosed && F.alphaP.cleanFrac > 0.9, metrics, hop });
      // learning: quarantined updates
      for (const u of m.updates) if (u.w > 0 && isFinite(u.x)) quarantine.push(t, t0 - 0.5, t1 + 0.5, () => metrics.apply(u));
      // hold / fade
      const fo = hf.focus.step(m.focus), so = hf.stress.step(m.stress), dro = m.drowsiness ? hf.drowsiness.step(m.drowsiness) : null;
      const badgeF = Nm.badge(metrics.feats.focusRaw.personalTime(), metrics.state.sessions);
      if (prof && prof.state !== "guest" && prof.state !== "uncertain" && !prof.badge) prof.badge = badgeF.text;
      // legacy
      let lg = { focus: null, stress: null };
      if (legacy) { const good = eegIdx.filter(c => !contact.isExcluded(c)), i1 = st.idx + 1, i0 = Math.max(st.firstIdx, i1 - fs);
        if (good.length && i1 - i0 >= fs * 0.9) { const x = new Float32Array(i1 - i0); for (const c of good) { const s = ring(R.xa[c], i0, i1); for (let k = 0; k < x.length; k++) x[k] += s[k] / good.length; } legacy.hop(x, st.gateState === "VALID", t); }
        lg = { focus: legacy.pct(), stress: null }; }
      else if (opts.legacyProvider) { try { const v = opts.legacyProvider(); if (v) lg = { focus: v.focus == null ? null : v.focus, stress: v.stress == null ? null : v.stress }; } catch (e) {} }
      // output
      const warnings = [...st.warnings];
      if (!G.eye.filter(c => !contact.isExcluded(c)).length) warnings.push("No usable eye channel: blink detection off");
      if (!G.temporal.filter(c => !contact.isExcluded(c)).length) warnings.push("No usable temporal channel: clench detection off");
      if (st.aliasWarn) warnings.push("Mains hum folds into theta at 125 Hz: theta-based confidence lowered");
      const tot = st.lostHist.reduce((s, x) => s + x.lost, 0), rec = st.recv.reduce((s, x) => s + x.n, 0);
      const mq = st.useProxy ? "proxy" : st.gateState === "VALID" ? "valid" : st.gateState === "NO_DATA" ? "no_data" : "movement";
      const sComp = m.stress.components;
      const o = {
        t, device: dev, profile: prof,
        focus: { value: fo.value, conf: fo.conf, state: fo.state, reason: fo.reason },
        stress: { value: so.value, conf: so.conf, state: so.state, reason: so.reason, components: sComp, exertion: !!m.stress.exertion },
        drowsiness: dro ? { value: dro.value, conf: dro.conf, state: dro.state, reason: dro.reason, markers: m.drowsiness.markers } : null,
        events: st.outEvents.splice(0),
        quality: { perChannel: chans.map((_, c) => contact.state.Q[c] == null ? null : Math.round(contact.state.Q[c])), excluded: contact.excludedNames(),
          ecg: ecg ? { bpm: st.ecgOut ? st.ecgOut.hr8 : null, sqi: st.ecgOut ? st.ecgOut.sqi : 0, state: st.ecgOut ? st.ecgOut.state : "none" } : null,
          motion: mq, packetLoss: tot + rec > 0 ? Math.round(1000 * tot / (tot + rec)) / 10 : 0, asr: asr ? { on: true, calibrated: asr.calibrated(), removedFrac: asr.removedFrac() } : null, warnings },
        legacy: lg
      };
      if (m.drowsiness && m.drowsiness.needLearning) { o.drowsiness.state = "learning"; o.drowsiness.value = null; o.drowsiness.conf = 0; o.drowsiness.reason = "learning"; }
      if (o.drowsiness && o.drowsiness.state === "learning") o.drowsiness.value = null;
      st.out = o;
      return o;
    }
    /* ---------------- stage 1: ingest ---------------- */
    eng.push = function (f) {
      Fr.validate(f);
      const outs = [];
      if (st.streamId !== f.streamId) {
        if (st.streamId != null) { resetStreamState(); newEpoch("stream"); }
        st.streamId = f.streamId; st.firstIdx = f.sampleIndex; st.idx = f.sampleIndex - 1; st.firstT = f.sampleIndex / fs;
        st.nextTick = Math.ceil(st.firstT / cfg.tickS + 1e-9) * cfg.tickS; st.nextHop = Math.ceil(st.firstT / hop + 1e-9) * hop; st.nextSec = Math.ceil(st.firstT) + 1; st.nextSlot = st.nextTick;
        if (st.sessionStart == null) { st.sessionStart = st.firstT; metrics.newEpoch(); st.epochStart = st.firstT; }
      }
      // gaps (explicit or implied by the index)
      let gapN = 0;
      for (const g of f.gaps || []) gapN = Math.max(gapN, g.n);
      if (st.lastFrameIdx != null && f.sampleIndex > st.lastFrameIdx && !gapN) gapN = f.sampleIndex - st.lastFrameIdx;
      if (gapN > 0 && st.lastFrameIdx != null) {
        const g = st.gaps.add(f.sampleIndex, gapN, fs);
        events.gap(f.sampleIndex, gapN); pre.resetAll(); if (ecg) ecg.gap(f.sampleIndex, gapN); for (let c = 0; c < C; c++) proxy.resetChannel(c);
        if (asr) asr.gap(); if (nlms) nlms.gap();
        emitEvent({ type: "gap", sub: null, onset: g.t0, offset: g.t1, conf: 1, channels: null, durMs: (g.t1 - g.t0) * 1000, t: g.t1 });
        st.lostHist.push({ t: g.t1, lost: gapN });
        if (g.t1 - g.t0 > cfg.identityGapS) newEpoch("gap30"); else if (g.t1 - g.t0 > cfg.epochGapS) newEpoch("gap");
        // stages run up to the gap end so the clock stays continuous
        st.idx = f.sampleIndex - 1; runClock(f.sampleIndex / fs, outs);
      }
      // auxiliary streams
      if (f.accel && f.accel.t.length) { st.accelSeen = true; gate.setFs(f.accel.fs || (dev === "muse" ? 52 : 25)); for (let k = 0; k < f.accel.t.length; k++) { gate.pushAccel(f.accel.t[k], f.accel.xyz[3 * k], f.accel.xyz[3 * k + 1], f.accel.xyz[3 * k + 2]); if (nlms) nlms.pushRef(f.accel.t[k], f.accel.xyz[3 * k], f.accel.xyz[3 * k + 1], f.accel.xyz[3 * k + 2]); } }
      if (f.gyro && f.gyro.t.length) for (let k = 0; k < f.gyro.t.length; k++) gate.pushGyro(f.gyro.t[k], f.gyro.xyz[3 * k], f.gyro.xyz[3 * k + 1], f.gyro.xyz[3 * k + 2]);
      if (ppg) ppg.push(f.ppg, f.aux ? f.aux.ppgHr : null);
      if (f.contact) st.muse.contact = f.contact;
      const imp = !!(f.aux && f.aux.flags && f.aux.flags.impedance);
      if (imp && !st.impedance) { st.impedance = true; st.impedanceSince = f.sampleIndex / fs; }
      else if (!imp && st.impedance) { st.impedance = false; emitEvent({ type: "bad_contact", sub: "impedance", global: true, onset: st.impedanceSince, offset: f.sampleIndex / fs, conf: 1, channels: null, t: f.sampleIndex / fs }); }
      // samples
      const n = f.samples[0].length;
      for (let k = 0; k < n; k++) {
        const i = f.sampleIndex + k, p = ((i % L) + L) % L;
        for (let c = 0; c < C; c++) { const x = f.samples[c][k]; pre.run(c, x); R.raw[c][p] = x; R.xd[c][p] = pre.xd; R.xb[c][p] = pre.xb; R.xa[c][p] = pre.xa; xbArr[c] = pre.xb; xdArr[c] = pre.xd; if (st.useProxy) proxy.push(c, pre.xb); }
        have[p] = 1;
        events.push(i, xbArr, xdArr);
        if (ecg) ecg.push(i, f.samples[ecgCh][k]);
        if (nlms) nlms.process(i, R.xa, R.xc, p); else if (asr) for (const c of eegIdx) R.xc[c][p] = R.xa[c][p];
        st.idx = i;
        runClock((i + 1) / fs, outs);
      }
      st.lastFrameIdx = f.sampleIndex + n;
      st.recv.push({ t: st.t, n }); while (st.recv.length && st.recv[0].t < st.t - 10) st.recv.shift(); while (st.lostHist.length && st.lostHist[0].t < st.t - 10) st.lostHist.shift();
      return outs;
    };
    function runClock(t, outs) {
      st.t = t;
      while (st.nextTick <= t + 1e-9) {
        const tt = st.nextTick; st.nextTick = Math.round((st.nextTick + cfg.tickS) * 1e6) / 1e6;
        if (asr && tt >= (st.nextAsr || 0)) { st.nextAsr = tt + cfg.asr.blockS; const res = asr.step(tt, st.idx + 1, R.xa, R.xc, L, (a, b) => !mask.state.list.concat(mask.state.open.map(x => ({ t0: x.t0, t1: Infinity, chans: x.chans }))).some(it => it.t1 > a && it.t0 < b));
          if (res && res.masked) emitEvent({ type: "emg_burst", sub: "asr", onset: res.t0, offset: res.t1, conf: 0.5, channels: null, chanIdx: eegIdx.slice(), t: tt, durMs: (res.t1 - res.t0) * 1000, internal: true }); }
        stageTick(tt);
      }
      while (st.nextSec <= t + 1e-9) { const ts = st.nextSec; st.nextSec += 1; stageSecond(ts); }
      while (st.nextHop <= t + 1e-9) { const th = st.nextHop; st.nextHop = Math.round((st.nextHop + hop) * 1e6) / 1e6; outs.push(stageHop(th)); }
    }
    eng.idle = function (dt) {
      dt = dt || hop; if (!st.out) return null;
      const o = JSON.parse(JSON.stringify(st.out)); o.events = [];
      for (const key of ["focus", "stress", "drowsiness"]) { if (!o[key]) continue; const r = hf[key].idle(dt); o[key].value = r.value; o[key].conf = r.conf; o[key].state = r.state; o[key].reason = r.reason; }
      st.out = o; return o;
    };
    eng.output = () => st.out;
    eng.lastRaw = () => st.lastRaw || null;   // the hop's raw feature values (tools/replay.js, tools/autotune.py)
    eng.setHelperInfo = function (info) { if (info && info.alias && info.alias.warn) st.aliasWarn = true; if (info && info.warnings) info.warnings.forEach(w => st.warnings.add(w)); };
    eng.setImpedance = (c, kohm) => contact.setImpedance(c, kohm, st.t);
    function summarize() { const iaf = feat.iafEstimate(); return { device: dev, montage: montageKey(), cleanSec: st.cleanSec, features: metrics.summary(), det: events.det(), iaf: { valid: iaf.valid, hz: iaf.hz, apExp: iaf.apExp }, asr: asr ? asr.export() : null }; }
    if (identity) identity.setSummarizer(summarize);
    eng.endSession = function () {
      const sum = summarize();
      if (identity) { try { const r = identity.endSession(sum); if (r) return r; } catch (e) {} }
      return sum;
    };
    function montageKey() { return dev + "|" + eegIdx.map(c => chans[c]).sort().join(",") + (ecgCh >= 0 ? "|ecg" : ""); }
    eng.montage = montageKey;
    eng.identity = identity;
    eng.metrics = metrics; eng.features = feat; eng.mask = mask; eng.events = events; eng.contact = contact;
    eng.debug = () => ({ t: st.t, hops: st.hops, epochs: st.epochs, cleanSec: st.cleanSec, gate: st.gateState, proxy: st.useProxy, aliasWarn: st.aliasWarn, D, flags,
      features: Object.fromEntries(Object.entries(metrics.feats).map(([k2, f2]) => [k2, { loc: f2.location(), scale: f2.scale(), W: f2.personalTime(), eOff: f2.eOff, learning: f2.learning() }])),
      det: events.det(), iaf: feat.iafEstimate(), quarantine: quarantine.items.length, ecg: st.ecgOut, ppg: st.ppgOut, asr: asr ? asr.debug() : null });
    return eng;
  }
  E.create = create;
  const API = { CONFIG, create, REASONS };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
