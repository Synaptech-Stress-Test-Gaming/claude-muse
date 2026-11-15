/* engine/fixtures.js
   Seeded synthetic data for tests, the in-browser Cyton simulator and the synthetic validation recording.
   Everything is deterministic for a given seed. Amplitudes are in uV, accelerometer in g, gyro in deg/s.

   A "record" is { device, fs, channels, n, data:[Float32Array per channel], events:[truth events], gapMask, accel, gyro, ppg, ecgChannel, truth }.
   eeg() builds one; the injectors add artifacts to it and push their exact ground truth into rec.events; frames() cuts it into engine frames.

   EEG model per channel: aperiodic noise with PSD ~ f^-apExp (made by shaping white noise in the frequency domain; scaled to noiseUv RMS in 1-45 Hz)
   plus three narrowband oscillators (sinusoids with a random phase walk, line width about 0.3 Hz): theta 6 Hz, alpha at the IAF, low beta 16.5 Hz.
   Each oscillator is sized so that the band power of the channel equals (role weight x factor x target), where the target is the population prior of
   engine/priors.json; so with the defaults the engine's log band powers land on the priors.
   Pure, no DOM. UMD: MuseEngine.Fixtures. Tested by engine/fixtures.test.js. */
"use strict";
(function (root) {
  const E = root.MuseEngine = root.MuseEngine || {};
  const U = E.Util || (typeof require !== "undefined" ? require("./util.js") : null);

  const CYTON_CH = ["Fp1", "Fp2", "C3", "C4", "P7", "P8", "O1", "O2", "F7", "F8", "F3", "F4", "T7", "T8", "P3", "P4"];
  const MUSE_CH = ["TP9", "AF7", "AF8", "TP10"];
  // band power targets in uV^2 = exp(prior mu) of engine/priors.json (thetaF, alphaP, betaLoC)
  // x 1.1 compensates the downward bias of averaging ln(power) over short windows (about -0.1 ln)
  const TARGET = { cyton: { theta: 1.1 * Math.exp(2.3), alpha: 1.1 * Math.exp(2.5), betaLo: 1.1 * Math.exp(1.2) }, muse: { theta: 1.1 * Math.exp(2.8), alpha: 1.1 * Math.exp(2.3), betaLo: 1.1 * Math.exp(1.5) } };
  const BANDS = { theta: [4, 8], alpha: [8, 12], betaLo: [13, 20] };
  // role weights (share of the target power) per channel: [theta, alpha, betaLo]
  const ROLE = {
    Fp1: [0.8, 0.3, 0.5], Fp2: [0.8, 0.3, 0.5], F3: [1, 0.3, 0.5], F4: [1, 0.3, 0.5], F7: [1, 0.3, 0.5], F8: [1, 0.3, 0.5],
    C3: [0.4, 0.6, 1], C4: [0.4, 0.6, 1], P3: [0.3, 1, 1], P4: [0.3, 1, 1], P7: [0.3, 1, 0.5], P8: [0.3, 1, 0.5], O1: [0.3, 1, 0.5], O2: [0.3, 1, 0.5],
    T7: [0.4, 0.4, 0.5], T8: [0.4, 0.4, 0.5], AF7: [1, 0.3, 0.5], AF8: [1, 0.3, 0.5], TP9: [0.4, 1, 1], TP10: [0.4, 1, 1]
  };
  const GROUPS = {
    cyton: { eye: ["Fp1", "Fp2"], frontal: ["Fp1", "Fp2", "F3", "F4", "F7", "F8"], temporal: ["T7", "T8"], posterior: ["O1", "O2", "P3", "P4", "P7", "P8"] },
    muse: { eye: ["AF7", "AF8"], frontal: ["AF7", "AF8"], temporal: ["TP9", "TP10"], posterior: ["TP9", "TP10"] }
  };
  const chIdx = (rec, name) => rec.channels.indexOf(name);
  const raisedCos = (u) => u <= 0 || u >= 1 ? 0 : 0.5 - 0.5 * Math.cos(2 * Math.PI * u);   // 0..1..0 over u in [0,1]
  const ramp = (t, t0, t1, rampS) => t < t0 || t > t1 ? 0 : Math.min(1, (t - t0) / rampS, (t1 - t) / rampS);

  /* aperiodic noise, PSD ~ f^-exp (flat below 0.5 Hz), scaled to `rmsUv` RMS in 1-45 Hz. Returns {x, bandPow:{theta,alpha,betaLo}} */
  function aperiodic(n, fs, exp, rmsUv, r) {
    const nfft = U.nextPow2(n), re = new Float64Array(nfft), im = new Float64Array(nfft);
    for (let k = 1; k < nfft / 2; k++) {
      const f = k * fs / nfft, a = Math.pow(Math.max(f, 0.5), -exp / 2);
      re[k] = r.normal() * a; im[k] = r.normal() * a; re[nfft - k] = re[k]; im[nfft - k] = -im[k];
    }
    const pw = (lo, hi) => { let s = 0; for (let k = 1; k < nfft / 2; k++) { const f = k * fs / nfft; if (f >= lo && f < hi) s += re[k] * re[k] + im[k] * im[k]; } return 2 * s / (nfft * nfft); };
    const p145 = pw(1, Math.min(45, fs / 2)), sc = rmsUv / Math.sqrt(p145);
    const bandPow = {}; for (const b in BANDS) bandPow[b] = pw(BANDS[b][0], BANDS[b][1]) * sc * sc;
    U.ifft(re, im);
    const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = re[i] * sc;
    return { x, bandPow };
  }
  /* phase of a narrowband oscillator (random phase walk; line width about widthHz) */
  function oscPhase(n, fs, f0, r, widthHz) {
    const sd = Math.sqrt(2 * Math.PI * (widthHz || 0.3) / fs), ph = new Float64Array(n); let p = r.next() * 2 * Math.PI;
    for (let i = 0; i < n; i++) { p += 2 * Math.PI * f0 / fs + sd * r.normal(); ph[i] = p; }
    return ph;
  }

  /* ---------- people and sessions (for identity tests) ---------- */
  function person(seed) {
    const r = U.rng(1000 + seed * 7919);
    const p = { seed, iaf: r.range(8.5, 11.5), apExp: r.range(0.8, 1.8), bandAmp: { theta: Math.exp(r.range(-0.3, 0.3)), alpha: Math.exp(r.range(-0.3, 0.3)), betaLo: Math.exp(r.range(-0.3, 0.3)) },
      ecg: { rt: r.range(0.15, 0.4), qrsW: r.range(0.8, 1.3), tDelay: r.range(0.22, 0.3), qAmp: r.range(0.05, 0.25), sAmp: r.range(0.1, 0.35) }, hr: r.range(55, 85),
      chanGain: {}, grav: null };
    CYTON_CH.concat(MUSE_CH).forEach(c => { p.chanGain[c] = r.normal() * 0.15; });
    const g = [r.normal() * 0.15, r.normal() * 0.15, 1]; const m = Math.hypot(...g); p.grav = g.map(v => v / m);
    return p;
  }
  function session(p, seedOfDay) {
    const r = U.rng(50000 + p.seed * 131 + seedOfDay * 17);
    const s = { person: p, seedOfDay, bandJitter: { theta: r.range(-0.15, 0.15), alpha: r.range(-0.15, 0.15), betaLo: r.range(-0.15, 0.15) }, gain: {}, hrJitter: r.range(-3, 3) };
    CYTON_CH.concat(MUSE_CH).forEach(c => { s.gain[c] = r.range(-0.2, 0.2); });
    return s;
  }

  /* ---------- EEG ---------- */
  function eeg(o) {
    o = Object.assign({ device: "cyton", fs: 125, seconds: 60, seed: 1, theta: 1, alpha: 1, betaLo: 1, iaf: 10, apExp: 1.5, noiseUv: 6, dcUv: 0, mainsUv: 0, mainsHz: 60, accel: true, mod: null }, o);
    const ses = o.session || null, per = o.person || (ses ? ses.person : null);
    if (per) { o.iaf = per.iaf; o.apExp = per.apExp; }
    const dev = o.device, fs = o.fs, n = Math.round(o.seconds * fs), chs = o.channels || (dev === "muse" ? MUSE_CH : CYTON_CH);
    const r = U.rng(o.seed * 2654435761 >>> 0);
    const tgt = {}; for (const b in BANDS) tgt[b] = TARGET[dev][b] * (per ? per.bandAmp[b] : 1) * (ses ? Math.exp(ses.bandJitter[b]) : 1);
    const freq = { theta: 6, alpha: o.iaf, betaLo: 16.5 };
    const phase = {}; for (const b in BANDS) phase[b] = oscPhase(n, fs, freq[b], r, 0.3);
    const stepN = Math.max(1, Math.round(0.05 * fs)), nSteps = Math.ceil(n / stepN) + 1;
    const fac = { theta: new Float32Array(nSteps), alpha: new Float32Array(nSteps), betaLo: new Float32Array(nSteps) };
    for (let s = 0; s < nSteps; s++) { const m = o.mod ? o.mod(s * stepN / fs) : null; for (const b in BANDS) fac[b][s] = (m && m[b] != null ? m[b] : 1) * o[b]; }
    const rec = { device: dev, fs, channels: chs.slice(), n, data: [], events: [], gapMask: null, accel: null, gyro: null, ppg: null, ecgChannel: -1, truth: { iaf: o.iaf, apExp: o.apExp }, comp: { alpha: [] }, opts: o, rng: U.rng((o.seed * 40503 + 7) >>> 0) };
    chs.forEach((name, c) => {
      const ap = aperiodic(n, fs, o.apExp, o.noiseUv, r), x = ap.x, w = ROLE[name] || [0.3, 0.3, 0.5], alphaComp = new Float32Array(n);
      for (let bi = 0; bi < 3; bi++) {
        const b = ["theta", "alpha", "betaLo"][bi], T = w[bi] * tgt[b], ph = phase[b], noiseP = ap.bandPow[b], f = fac[b];
        const ampAt = s => Math.sqrt(2 * Math.max(T * f[s] - noiseP, 0.05 * T));
        for (let i = 0; i < n; i++) { const s = (i / stepN) | 0, u = i / stepN - s, a = ampAt(s) * (1 - u) + ampAt(Math.min(s + 1, nSteps - 1)) * u, v = a * Math.sin(ph[i]); x[i] += v; if (bi === 1) alphaComp[i] = v; }
      }
      const g = Math.exp(((per ? per.chanGain[name] || 0 : 0) + (ses ? ses.gain[name] || 0 : 0)) / 2);
      if (g !== 1) for (let i = 0; i < n; i++) { x[i] *= g; alphaComp[i] *= g; }
      if (o.mainsUv) { const ph0 = r.next() * 6.283; for (let i = 0; i < n; i++) x[i] += o.mainsUv * Math.sin(2 * Math.PI * o.mainsHz * i / fs + ph0); }
      if (o.dcUv) { const dc = (r.next() * 2 - 1) * o.dcUv; for (let i = 0; i < n; i++) x[i] += dc; }
      rec.data.push(x); rec.comp.alpha.push(alphaComp);
    });
    if (o.accel) accelStill(rec, { grav: per ? per.grav : null });
    return rec;
  }

  /* resting accelerometer (and gyro on the Muse) */
  function accelStill(rec, o) {
    o = o || {}; const fsA = o.fs || (rec.device === "muse" ? 52 : 25), nA = Math.floor(rec.n / rec.fs * fsA), r = U.rng(rec.opts.seed * 31 + 5);
    const g = o.grav || [0, 0, 1], noise = o.noise == null ? 0.002 : o.noise;
    const a = { fs: fsA, x: new Float32Array(nA), y: new Float32Array(nA), z: new Float32Array(nA) };
    for (let i = 0; i < nA; i++) { a.x[i] = g[0] + noise * r.normal(); a.y[i] = g[1] + noise * r.normal(); a.z[i] = g[2] + noise * r.normal(); }
    rec.accel = a;
    if (rec.device === "muse") { const gy = { fs: fsA, x: new Float32Array(nA), y: new Float32Array(nA), z: new Float32Array(nA) }; for (let i = 0; i < nA; i++) { gy.x[i] = 0.5 * r.normal(); gy.y[i] = 0.5 * r.normal(); gy.z[i] = 0.5 * r.normal(); } rec.gyro = gy; }
    return rec;
  }

  /* ---------- injectors (each returns the injected truth events and also appends them to rec.events) ---------- */
  function addEv(rec, ev) { rec.events.push(ev); return ev; }
  function weightsFor(rec, kind) {
    const dev = rec.device;
    return rec.channels.map(nm => {
      if (kind === "blink") { if (dev === "muse") return nm === "AF7" || nm === "AF8" ? 0.6 : 0.05; return nm === "Fp1" || nm === "Fp2" ? 1 : ["F3", "F4", "F7", "F8"].includes(nm) ? 0.4 : 0.05; }
      return 0;
    });
  }
  function blink(rec, t, o) {
    o = Object.assign({ ampUv: 150, durMs: 250, sign: 1, type: "blink" }, o);
    const fs = rec.fs, w = weightsFor(rec, "blink"), d = o.durMs / 1000, i0 = Math.round(t * fs), i1 = Math.round((t + d) * fs);
    for (let c = 0; c < rec.channels.length; c++) { if (!w[c] || c === rec.ecgChannel) continue; const x = rec.data[c]; for (let i = Math.max(0, i0); i < Math.min(rec.n, i1); i++) x[i] += o.sign * o.ampUv * w[c] * raisedCos((i / fs - t) / d); }
    return [addEv(rec, { type: o.type, onset: t, offset: t + d, peak: t + d / 2, amp: o.ampUv, durMs: o.durMs })];
  }
  function voluntaryBlink(rec, t, o) { return blink(rec, t, Object.assign({ ampUv: 280, durMs: 420, type: "blink_voluntary" }, o)); }
  function doubleBlink(rec, t, gapMs, o) {
    gapMs = gapMs || 350; const a = voluntaryBlink(rec, t, o)[0], b = voluntaryBlink(rec, t + gapMs / 1000, o)[0];
    return [a, b, addEv(rec, { type: "double_blink", onset: t, offset: b.offset, peak2: b.peak })];
  }
  /* band-limited white noise (20 Hz .. min(110, fs/2-3) Hz) with 20 ms ramps, unit RMS */
  function emgNoise(rec, n) {
    const fs = rec.fs, fhi = Math.min(110, fs / 2 - 3), r = rec.rng;
    const h1 = U.hp(20, fs), h2 = U.hp(20, fs), l1 = U.lp(fhi, fs), l2 = U.lp(fhi, fs), pre = Math.round(0.2 * fs), y = new Float32Array(n);
    let s = 0; for (let i = -pre; i < n; i++) { const v = l2.p(l1.p(h2.p(h1.p(r.normal())))); if (i >= 0) { y[i] = v; s += v * v; } }
    const k = 1 / Math.sqrt(s / n || 1); for (let i = 0; i < n; i++) y[i] *= k; return y;
  }
  function addNoise(rec, c, t0, t1, rmsUv) {
    if (c < 0 || c === rec.ecgChannel || !rmsUv) return; const fs = rec.fs, i0 = Math.max(0, Math.round(t0 * fs)), i1 = Math.min(rec.n, Math.round(t1 * fs)); if (i1 <= i0) return;
    const nz = emgNoise(rec, i1 - i0), x = rec.data[c];
    for (let i = i0; i < i1; i++) x[i] += rmsUv * nz[i - i0] * ramp(i / fs, t0, t1, 0.02);
  }
  function emgBurst(rec, t, o) {
    o = Object.assign({ durMs: 300, chans: null, ampUv: 40, sub: "other", record: true }, o);
    const d = o.durMs / 1000, chans = o.chans || rec.channels, amps = o.amps || {};
    rec.channels.forEach((nm, c) => { const a = amps[nm] != null ? amps[nm] : chans.includes(nm) ? o.ampUv : 0; addNoise(rec, c, t, t + d, a); });
    return o.record ? [addEv(rec, { type: "emg_burst", sub: o.sub, onset: t, offset: t + d, channels: chans })] : [];
  }
  function muscleAmps(rec, tempUv, frontUv, otherUv) {
    const G = GROUPS[rec.device], a = {};
    rec.channels.forEach(nm => { a[nm] = G.temporal.includes(nm) ? tempUv : G.frontal.includes(nm) ? frontUv : otherUv; }); return a;
  }
  function clench(rec, t, durMs) {
    durMs = durMs || 400;
    return emgBurst(rec, t, { durMs, amps: muscleAmps(rec, 60, 15, 6), chans: GROUPS[rec.device].temporal, sub: "clench" });
  }
  function chew(rec, t, n, rateHz) {
    n = n || 4; rateHz = rateHz || 1.2; const out = [];
    // chewing works mostly on one side: the working side 45 uV, the other side 15 uV (see IMPLEMENTATION_NOTES)
    const G = GROUPS[rec.device], work = rec.rng.next() < 0.5 ? 0 : 1;
    for (let k = 0; k < n; k++) { const amps = muscleAmps(rec, 45, 12, 4); G.temporal.forEach((nm, q) => { amps[nm] = q === work ? 45 : 15; }); emgBurst(rec, t + k / rateHz, { durMs: 280, amps, record: false }); }
    out.push(addEv(rec, { type: "emg_burst", sub: "chew", onset: t, offset: t + (n - 1) / rateHz + 0.28, n }));
    return out;
  }
  function talk(rec, t, seconds) {
    const r = rec.rng, G = GROUPS[rec.device]; let u = t;
    while (u < t + seconds - 0.1) {
      const dur = r.range(0.12, 0.45), lr = Math.exp(r.range(-1.2, 1.2)), front = r.range(18, 35), temp = r.range(6, 18);   // speech: perioral/frontal muscles dominate
      const amps = {}; rec.channels.forEach(nm => { const left = /[13579]$|AF7|TP9/.test(nm); amps[nm] = G.frontal.includes(nm) ? front : G.temporal.includes(nm) ? temp * (left ? lr : 1 / lr) : 4; });
      emgBurst(rec, u, { durMs: Math.min(dur, t + seconds - u) * 1000, amps, record: false });
      u += dur + r.range(0.15, 0.9);
    }
    return [addEv(rec, { type: "emg_burst", sub: "talk", onset: t, offset: t + seconds })];
  }
  function tension(rec, t, seconds) {
    emgBurst(rec, t, { durMs: seconds * 1000, amps: muscleAmps(rec, 20, 25, 5), record: false });
    return [addEv(rec, { type: "emg_burst", sub: "tension", onset: t, offset: t + seconds })];
  }
  function motion(rec, t, seconds, o) {
    o = Object.assign({ g: 0.15, eegUv: 80 }, o); const fs = rec.fs;
    for (let c = 0; c < rec.channels.length; c++) { if (c === rec.ecgChannel) continue; const x = rec.data[c];
      for (let i = Math.max(0, Math.round(t * fs)); i < Math.min(rec.n, Math.round((t + seconds) * fs)); i++) { const tt = i / fs; x[i] += o.eegUv * Math.sin(2 * Math.PI * 3 * tt) * ramp(tt, t, t + seconds, 0.15); } }
    for (const k of ["accel", "gyro"]) { const a = rec[k]; if (!a) continue; const amp = k === "accel" ? o.g : 60;
      for (let i = Math.floor(t * a.fs); i < Math.min(a.x.length, Math.ceil((t + seconds) * a.fs)); i++) { const tt = i / a.fs, rr = ramp(tt, t, t + seconds, 0.1); a.x[i] += amp * Math.sin(2 * Math.PI * 2 * tt) * rr; a.y[i] += 0.6 * amp * Math.sin(2 * Math.PI * 2 * tt + 1) * rr; a.z[i] += amp * Math.sin(2 * Math.PI * 2 * tt + 0.5) * rr; } }
    return [addEv(rec, { type: "motion", onset: t, offset: t + seconds })];
  }
  function pop(rec, t, ch, stepUv) {
    stepUv = stepUv || 200; const c = typeof ch === "number" ? ch : chIdx(rec, ch), fs = rec.fs, x = rec.data[c];
    for (let i = Math.max(0, Math.round(t * fs)); i < rec.n; i++) { const v = stepUv * Math.exp(-(i / fs - t) / 1.0); if (Math.abs(v) < 0.01) break; x[i] += v; }
    return [addEv(rec, { type: "electrode_pop", onset: t, offset: t + 0.05, channels: [rec.channels[c]] })];
  }
  function gap(rec, t, seconds) {
    if (!rec.gapMask) rec.gapMask = new Uint8Array(rec.n);
    const i0 = Math.round(t * rec.fs), i1 = Math.min(rec.n, Math.round((t + seconds) * rec.fs)); for (let i = i0; i < i1; i++) rec.gapMask[i] = 1;
    return [addEv(rec, { type: "gap", onset: i0 / rec.fs, offset: i1 / rec.fs })];
  }
  function saccade(rec, t, o) {
    o = Object.assign({ ampUv: 60, dir: 1 }, o); const G = GROUPS[rec.device].eye, fs = rec.fs;
    G.forEach((nm, k) => { const c = chIdx(rec, nm); if (c < 0) return; const s = (k === 0 ? 1 : -1) * o.dir * o.ampUv, x = rec.data[c];
      for (let i = Math.max(0, Math.round(t * fs)); i < rec.n; i++) { const u = i / fs - t, v = s * Math.min(1, u / 0.03) * Math.exp(-u / 0.5); if (u > 4) break; x[i] += v; } });
    return [addEv(rec, { type: "saccade", onset: t, offset: t + 0.2 })];
  }
  function eyesClosed(rec, t, seconds, o) {
    o = Object.assign({ stepUv: 150 }, o); const fs = rec.fs, G = GROUPS[rec.device], w = weightsFor(rec, "blink");
    // closing: a fast deflection that stays up (eyes roll up), slowly relaxing; opening: the same back down
    for (let c = 0; c < rec.channels.length; c++) { if (!w[c] || c === rec.ecgChannel) continue; const x = rec.data[c];
      for (let i = Math.max(0, Math.round(t * fs)); i < Math.min(rec.n, Math.round((t + seconds + 0.6) * fs)); i++) {
        const u = i / fs - t; let v = Math.min(1, u / 0.15) * (0.6 + 0.4 * Math.exp(-u / 2));
        if (u > seconds) { const q = (u - seconds) / 0.25; v *= Math.max(0, 1 - q); }
        x[i] += o.stepUv * w[c] * v; } }
    // posterior alpha x3 in amplitude (see IMPLEMENTATION_NOTES): add 2 x the channel's own alpha component
    const k = o.alphaFactor != null ? o.alphaFactor - 1 : 2;
    G.posterior.forEach(nm => { const c = chIdx(rec, nm); if (c < 0) return; const a = rec.comp.alpha[c], x = rec.data[c];
      for (let i = Math.max(0, Math.round((t + 0.3) * fs)); i < Math.min(rec.n, Math.round((t + seconds) * fs)); i++) x[i] += k * a[i] * ramp(i / fs, t + 0.3, t + seconds, 0.3); });
    return [addEv(rec, { type: "eyes_closed", onset: t, offset: t + seconds })];
  }

  /* ---------- heart ---------- */
  function rrSeries(o) {
    o = Object.assign({ n: 200, meanMs: 850, rmssdMs: 40, seed: 1 }, o); const r = U.rng(o.seed * 977 + 3), d = [];
    for (let k = 0; k < o.n; k++) d.push(Math.sin(2 * Math.PI * k / 4.5) + 0.5 * r.normal());
    let s = 0; for (let k = 1; k < o.n; k++) s += (d[k] - d[k - 1]) ** 2; const rm = Math.sqrt(s / (o.n - 1)), m = U.mean(d), k0 = o.rmssdMs / rm;
    return d.map(v => o.meanMs + k0 * (v - m));
  }
  /* ECG: Gaussian R (sigma 12 ms, 1000 uV), Q and S notches, T wave (sigma 60 ms, 250 uV, +250 ms), 0.3 Hz baseline wander, 10 uV noise.
     o: {fs, rrMs, seconds?, seed, invert, gain, drop:[k], extra:[k], morph:{rt,qrsW,tDelay,qAmp,sAmp}, startS} -> {data, rTimes} */
  function ecg(o) {
    o = Object.assign({ fs: 125, rrMs: null, seed: 1, invert: false, gain: 1, drop: [], extra: [], morph: null, startS: 0.6, noiseUv: 10, wanderUv: 100 }, o);
    const m = Object.assign({ rt: 0.25, qrsW: 1, tDelay: 0.25, qAmp: 0.15, sAmp: 0.25 }, o.morph || {});
    const fs = o.fs, rr = o.rrMs || rrSeries({ n: 400, seed: o.seed });
    let times = [], t = o.startS; for (let k = 0; k < rr.length; k++) { times.push(t); t += rr[k] / 1000; }
    const seconds = o.seconds || t + 0.5, n = Math.round(seconds * fs);
    times = times.filter(x => x < seconds - 0.5);
    const beats = []; times.forEach((tt, k) => { if (!o.drop.includes(k)) beats.push(tt); if (o.extra.includes(k) && k + 1 < times.length) beats.push(tt + 0.45 * (times[k + 1] - tt)); });
    beats.sort((a, b) => a - b);
    const x = new Float32Array(n), r = U.rng(o.seed * 61 + 11), sR = 0.012 * m.qrsW;
    const g = (u, s) => Math.exp(-0.5 * (u / s) * (u / s));
    for (const tb of beats) { const i0 = Math.max(0, Math.floor((tb - 0.15) * fs)), i1 = Math.min(n, Math.ceil((tb + m.tDelay + 0.3) * fs));
      for (let i = i0; i < i1; i++) { const u = i / fs - tb; x[i] += 1000 * (g(u, sR) - m.qAmp * g(u + 0.028 * m.qrsW, 0.008 * m.qrsW) - m.sAmp * g(u - 0.03 * m.qrsW, 0.01 * m.qrsW) + m.rt * g(u - m.tDelay, 0.06)); } }
    const ph = r.next() * 6.28; for (let i = 0; i < n; i++) x[i] += o.wanderUv * Math.sin(2 * Math.PI * 0.3 * i / fs + ph) + o.noiseUv * r.normal();
    const s = (o.invert ? -1 : 1) * o.gain; if (s !== 1) for (let i = 0; i < n; i++) x[i] *= s;
    return { data: x, rTimes: beats, fs };
  }
  function addEcg(rec, o) {
    o = Object.assign({ ch: rec.channels.indexOf("F7") }, o); const per = rec.opts.person || (rec.opts.session && rec.opts.session.person);
    const hr = per ? per.hr + (rec.opts.session ? rec.opts.session.hrJitter : 0) : 70;
    const rrMs = o.rrMs || rrSeries({ n: Math.ceil(rec.n / rec.fs / (60 / hr)) + 5, meanMs: 60000 / hr, rmssdMs: o.rmssdMs || 35, seed: rec.opts.seed + 101 });
    const e = ecg(Object.assign({ fs: rec.fs, rrMs, seconds: rec.n / rec.fs, seed: rec.opts.seed + 7, morph: per ? per.ecg : null }, o));
    rec.data[o.ch] = e.data; rec.ecgChannel = o.ch; rec.truth.rTimes = e.rTimes; rec.truth.rrMs = rrMs; return rec;
  }
  /* pulse (PPG) like the panel's PL.bp: one smooth pulse per beat, band-passed 0.7-3.5 Hz */
  function ppg(o) {
    o = Object.assign({ fs: 64, rrMs: null, seconds: 60, seed: 1, delayMs: 200, noise: 5 }, o); const fs = o.fs, n = Math.round(o.seconds * fs), x = new Float32Array(n), r = U.rng(o.seed * 13 + 1);
    const rr = o.rrMs || rrSeries({ n: Math.ceil(o.seconds) * 3, seed: o.seed }); let t = 0.5; const beats = [];
    for (const v of rr) { if (t > o.seconds) break; beats.push(t + o.delayMs / 1000); t += v / 1000; }
    const g = (u, s) => Math.exp(-0.5 * (u / s) * (u / s));
    for (const tb of beats) for (let i = Math.max(0, Math.floor((tb - 0.4) * fs)); i < Math.min(n, Math.ceil((tb + 0.8) * fs)); i++) { const u = i / fs - tb; x[i] += 1000 * (g(u, 0.07) + 0.3 * g(u - 0.25, 0.06)); }
    const f0 = Math.sqrt(0.7 * 3.5), Q = f0 / 2.8, b1 = U.bp(f0, fs, Q), b2 = U.bp(f0, fs, Q), y = new Float32Array(n);
    for (let i = 0; i < n; i++) y[i] = b2.p(b1.p(x[i] + o.noise * r.normal()));
    return { data: y, beats, fs };
  }
  function addPpg(rec, o) {
    o = o || {}; const hr = o.hr || 70; const rrMs = o.rrMs || rrSeries({ n: Math.ceil(rec.n / rec.fs) * 2, meanMs: 60000 / hr, rmssdMs: o.rmssdMs || 40, seed: rec.opts.seed + 55 });
    const p = ppg({ fs: 64, rrMs, seconds: rec.n / rec.fs, seed: rec.opts.seed + 3 }); rec.ppg = { fs: 64, data: p.data }; rec.truth.ppgBeats = p.beats; rec.truth.rrMs = rrMs; return rec;
  }

  /* ---------- frames ---------- */
  function frames(rec, frameMs, o) {
    o = Object.assign({ streamId: 1, contact: null, ppgHr: null }, o);
    const fs = rec.fs, N = Math.max(1, Math.round((frameMs || (rec.device === "muse" ? 46.875 : 40)) / 1000 * fs)), out = [], mask = rec.gapMask;
    let i = 0, lost = 0, accI = 0, gyrI = 0, ppgI = 0;
    const aux = (a, from, toT) => { if (!a) return null; const t = [], xyz = []; let k = from; while (k < a.x.length && k / a.fs < toT) { const tt = k / a.fs, gi = Math.floor(tt * fs);
        if (!(mask && gi < rec.n && mask[gi])) { t.push(tt); xyz.push(a.x[k], a.y[k], a.z[k]); } k++; } return { next: k, v: { fs: a.fs, t: Float64Array.from(t), xyz: Float32Array.from(xyz) } }; };
    while (i < rec.n) {
      if (mask && mask[i]) { lost++; i++; continue; }
      const start = i; let end = i; while (end < rec.n && end - start < N && !(mask && mask[end])) end++;
      const gaps = lost ? [{ at: start, n: lost }] : []; lost = 0;
      const tEnd = end / fs, f = { device: rec.device, streamId: o.streamId, fs, channels: rec.channels.slice(), sampleIndex: start, t0: start / fs,
        samples: rec.data.map(x => x.slice(start, end)), gaps, accel: null, gyro: null, ppg: null, ecg: null,
        contact: rec.device === "muse" ? (o.contact ? o.contact(start / fs) : rec.channels.map(() => 95)) : null, aux: { ppgHr: o.ppgHr, flags: { impedance: false, simulated: true } } };
      const a = aux(rec.accel, accI, tEnd); if (a) { accI = a.next; f.accel = a.v; }
      const g = aux(rec.gyro, gyrI, tEnd); if (g) { gyrI = g.next; f.gyro = g.v; }
      if (rec.ppg) { const p = rec.ppg, k0 = ppgI; let k = ppgI; while (k < p.data.length && k / p.fs < tEnd) k++; ppgI = k;
        if (k > k0) { const d = p.data.slice(k0, k); for (let q = 0; q < d.length; q++) { const gi = Math.floor((k0 + q) / p.fs * fs); if (mask && gi < rec.n && mask[gi]) d[q] = NaN; } f.ppg = { fs: p.fs, t0: k0 / p.fs, data: d }; } }
      if (rec.ecgChannel >= 0) f.ecg = { fs, data: rec.data[rec.ecgChannel].slice(start, end), channel: rec.ecgChannel };
      out.push(f); i = end;
    }
    return out;
  }

  const API = { CYTON_CH, MUSE_CH, TARGET, ROLE, GROUPS, BANDS, aperiodic, person, session, eeg, accelStill, blink, voluntaryBlink, doubleBlink, emgNoise, emgBurst, clench, chew, talk, tension,
    motion, pop, gap, saccade, eyesClosed, rrSeries, ecg, addEcg, ppg, addPpg, frames };
  E.Fixtures = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
