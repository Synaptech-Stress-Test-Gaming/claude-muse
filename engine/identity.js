/* engine/identity.js
   Person auto-detection without name entry. A soft posterior over the stored profiles plus "a new person"; never compared across devices.
   Expected accuracy: Muse EEG only about 60-80% closed-set; Cyton EEG + ECG about 90-97%. So: a one-tap correction (the badge's tick/cross),
   no profile update before identity is confident (profiles change only at commit), and population priors while uncertain.
   Identity vector of a session (clean, motion-free, eyes-open windows after contact is good):
     eeg     mean log-PSD on a 1 Hz grid 2-40 Hz per channel group, mean removed per group (Cyton posterior / central-parietal / frontal = 117 dims;
             Muse temporal / frontal = 78 dims); the posterior (Muse temporal) group weighs 2x
     iaf     individual alpha frequency; ap: aperiodic exponent and offset; ecg (Cyton): mean beat, 100 points, z-scored, >= 30 beats
     hr      resting heart rate; contact: per-channel contact pattern; grav: resting accelerometer direction (when present)
   Per profile and block: mean over its sessions and a diagonal variance with shrinkage var = (n s^2 + 5 v0)/(n + 5);
   LL = (Deff / D) sum_d log N(x_d; mean, var + obsVar); "new person" uses the population mean and variance. Prior: owner 0.7, other known
   profiles share 0.2, new 0.1 (with no other profiles: owner 0.7, new 0.3). Posterior = normalised prior x exp(LL).
   Decision: gather 45 s of clean data; evaluate every 15 s; accept a hypothesis at posterior >= 0.8 with a margin >= 0.2 twice in a row;
   after 3 min of clean data: a known profile with >= 0.5 -> tentative (scored with that profile, NOT merged unless the user taps the tick),
   else a new Guest. The first session ever belongs to the owner.
   UMD: MuseEngine.Identity. Tested by engine/identity.test.js. */
"use strict";
(function (root) {
  const E = root.MuseEngine = root.MuseEngine || {};
  const U = E.Util || (typeof require !== "undefined" ? require("./util.js") : null);
  const getProfiles = () => E.Profiles || (typeof require !== "undefined" ? require("./profiles.js") : null);
  const GROUPS = { cyton: [["P7", "P8", "O1", "O2"], ["C3", "C4", "P3", "P4"], ["Fp1", "Fp2", "F3", "F4", "F8"]], muse: [["TP9", "TP10"], ["AF7", "AF8"]] };
  const DEF = { gatherS: 45, evalS: 15, decideS: 180, accept: 0.8, margin: 0.2, tentative: 0.5, ownerBase: 0.7, saveS: 60, museEegDeff: 4, minLogLR: Math.log(3),
    blocks: { eeg: { within: 0.20, pop: 0.50, deff: 8 }, iaf: { within: 0.4, pop: 1.0, deff: 1 }, ap: { within: [0.15, 0.3], pop: [0.4, 0.8], deff: 1 },
      ecg: { within: 0.15, pop: 0.70, deff: 10 }, hr: { within: 8, pop: 12, deff: 0.5 }, contact: { within: 15, pop: 25, deff: 0.5 }, grav: { within: 0.10, pop: 0.30, deff: 0.5 } } };
  const FREQ = []; for (let f = 2; f <= 40; f++) FREQ.push(f);
  const logN = (x, m, v) => -0.5 * Math.log(2 * Math.PI * v) - 0.5 * (x - m) * (x - m) / v;

  function create(o) {
    o = Object.assign({ device: "muse", store: null, ownerBaseRate: 0.7, cfg: null }, o);
    const k = U.deepMerge(DEF, o.cfg || {}), dev = o.device;
    const store = o.store || getProfiles().create({ storage: null });
    const I = { store, state: "gathering", sid: null, seq: 0, start: null, cleanS: 0, nextEval: k.gatherS, okRun: { id: null, n: 0 }, profileId: null, label: null, conf: 0, merged: false,
      first: false, acc: null, accW: 0, hrS: 0, hrN: 0, contactS: null, contactN: 0, tpl: null, lastSave: 0, summarizer: null, metrics: null, lastPost: null, decidedAt: null };
    function newSession(t) { I.sid = store.nextSessionId(); I.seq = +I.sid.slice(2); I.start = store_now(); I.state = "gathering"; I.cleanS = 0; I.nextEval = k.gatherS; I.okRun = { id: null, n: 0 };
      I.profileId = null; I.label = null; I.conf = 0; I.merged = false; I.first = false; I.acc = null; I.accW = 0; I.hrS = 0; I.hrN = 0; I.contactS = null; I.contactN = 0; I.tpl = null; I.lastSave = t || 0; I.decidedAt = null;
      if (store.isFirstEver()) { const p = store.ensureOwner(); decide(p.id, "confirmed", 1, true); I.first = true; } }
    function store_now() { return Date.now(); }
    /* ---- the session's identity vector ---- */
    function obsVector(channels) {
      if (!I.acc || I.accW <= 0) return null;
      const v = { eeg: [], eegW: [] }, groups = GROUPS[dev] || [];
      let posterior = null;
      groups.forEach((g, gi) => { const a = I.acc[gi]; if (!a || a.w <= 0) return; const mean = a.sum.map(x => x / a.w), m = U.mean(mean);
        mean.forEach(x => { v.eeg.push(x - m); v.eegW.push(gi === 0 ? 2 : 1); }); if (gi === 0) posterior = mean; });
      if (!v.eeg.length) return null;
      if (posterior) { const fx = [], fy = []; FREQ.forEach((f, i) => { if (f >= 3 && (f < 7 || f > 14)) { fx.push(Math.log(f)); fy.push(posterior[i]); } });
        const fit = U.linfit(fx, fy); v.ap = [-fit.slope, fit.intercept]; let best = 7, bv = -Infinity; for (let f = 7; f <= 13; f++) { const r = posterior[f - 2] - (fit.intercept + fit.slope * Math.log(f)); if (r > bv) { bv = r; best = f; } }
        v.iaf = bv >= 0.2 ? [best] : null; }
      if (I.tpl) v.ecg = Array.from(I.tpl);
      if (I.hrN > 20) v.hr = [I.hrS / I.hrN];
      if (I.contactN > 5) v.contact = I.contactS.map(x => x / I.contactN);
      delete v.eegW; v.eegW = groups.map((g, gi) => I.acc[gi] && I.acc[gi].w > 0 ? FREQ.map(() => gi === 0 ? 2 : 1) : []).flat();
      void channels; return v;
    }
    I.vector = obsVector;
    /* ---- likelihoods ---- */
    function blockLL(name, x, mean, varArr, w) {
      const b = k.blocks[name], D = x.length; let s = 0, ws = 0;
      const deff = name === "eeg" && dev === "muse" ? k.museEegDeff : b.deff;   // Muse: 2 groups, 4 sensors near the ears and the eyes
      for (let d = 0; d < D; d++) { const within = Array.isArray(b.within) ? b.within[d] : b.within, wd = w ? w[d] : 1; s += wd * logN(x[d], mean[d], varArr[d] + within * within); ws += wd; }
      return deff * s / ws;
    }
    function profileModel(id) {
      const hist = store.identityHistory(id, dev); if (!hist.length) return null;
      const M = {}; for (const name of ["eeg", "iaf", "ap", "ecg", "hr", "contact", "grav"]) {
        const xs = hist.map(h => h[name]).filter(x => x && x.length); if (!xs.length) continue; const D = xs[0].length; if (xs.some(x => x.length !== D)) continue;
        const n = xs.length, b = k.blocks[name], mean = [], vr = [];
        for (let d = 0; d < D; d++) { const col = xs.map(x => x[d]), m = U.mean(col), s2 = n > 1 ? U.variance(col, m) * n / (n - 1) : 0, v0 = Math.pow(Array.isArray(b.within) ? b.within[d] : b.within, 2);
          mean.push(m); vr.push((n * s2 + 5 * v0) / (n + 5)); }
        M[name] = { mean, var: vr };
      }
      return M;
    }
    function popModel(models, x) {
      const P = {}, ids = Object.keys(models);
      for (const name of Object.keys(x)) { if (name === "eegW" || !x[name]) continue; const b = k.blocks[name]; if (!b) continue; const D = x[name].length;
        const have = ids.map(i => models[i][name]).filter(m => m && m.mean.length === D);
        let mean;
        if (have.length >= 2) mean = Array.from({ length: D }, (_, d) => U.mean(have.map(m => m.mean[d])));
        else if (name === "eeg") { const groups = GROUPS[dev], out = []; groups.forEach((g, gi) => { if (!(I.acc[gi] && I.acc[gi].w > 0)) return; const t = FREQ.map(f => -1.5 * Math.log(f)), m = U.mean(t); t.forEach(v => out.push(v - m)); }); mean = out; }
        else if (name === "iaf") mean = [10]; else if (name === "ap") mean = [1.3, x.ap[1]]; else if (name === "ecg") mean = new Array(D).fill(0); else if (name === "hr") mean = [70];
        else if (name === "contact") mean = new Array(D).fill(80); else mean = x[name].slice();
        const pv = Array.from({ length: D }, (_, d) => { const p = Array.isArray(b.pop) ? b.pop[d] : b.pop, w = Array.isArray(b.within) ? b.within[d] : b.within; return p * p - w * w > 0 ? p * p - w * w : p * p; });
        P[name] = { mean, var: pv };
      }
      return P;
    }
    function posterior(x) {
      const profiles = store.listProfiles().filter(p => store.identityHistory(p.id, dev).length || p.owner), models = {};
      for (const p of profiles) { const m = profileModel(p.id); if (m) models[p.id] = m; }
      const pop = popModel(models, x), hyps = [];
      const ownerId = store.data.ownerId, others = Object.keys(models).filter(id => id !== ownerId);
      const llOf = M => { let s = 0; for (const name in pop) { const mm = M && M[name] && M[name].mean.length === x[name].length ? M[name] : pop[name]; s += blockLL(name, x[name], mm.mean, mm.var, name === "eeg" ? x.eegW : null); } return s; };
      if (models[ownerId]) hyps.push({ id: ownerId, prior: o.ownerBaseRate, ll: llOf(models[ownerId]) });
      others.forEach(id => hyps.push({ id, prior: 0.2 / others.length, ll: llOf(models[id]) }));
      hyps.push({ id: "new", prior: others.length ? 0.1 : 1 - (models[ownerId] ? o.ownerBaseRate : 0), ll: llOf(null) });
      const mx = Math.max(...hyps.map(h => h.ll)); let z = 0; hyps.forEach(h => { h.p = h.prior * Math.exp(h.ll - mx); z += h.p; }); hyps.forEach(h => { h.p /= z; });
      return hyps.sort((a, b) => b.p - a.p);
    }
    I.posterior = x => posterior(x || obsVector());
    function loadInto(id) {
      if (!I.metrics) return;
      const lt = id ? store.lifetime(id, dev) : { byKey: {}, base: null, sessions: 0 };
      I.metrics.loadLifetime(lt.byKey, lt.base, lt.sessions);
    }
    function decide(id, state, conf, merged) {
      if (id === "new") id = store.newGuest().id;
      const p = store.getProfile(id); I.profileId = id; I.label = p ? p.label : null; I.state = state; I.conf = conf; I.merged = merged; I.decidedAt = I.cleanS;
      loadInto(id);
    }
    function evaluate() {
      const x = obsVector(); if (!x) return;
      const post = posterior(x); I.lastPost = post; const best = post[0], second = post[1] ? post[1].p : 0;
      // the data itself must prefer the winner (likelihood ratio >= 3 over the runner-up), so the owner prior alone never confirms anyone
      const evid = post.length > 1 ? best.ll - Math.max(...post.slice(1).map(h => h.ll)) : Infinity;
      if (best.p >= k.accept && best.p - second >= k.margin && evid >= k.minLogLR) { I.okRun = I.okRun.id === best.id ? { id: best.id, n: I.okRun.n + 1 } : { id: best.id, n: 1 }; }
      else I.okRun = { id: null, n: 0 };
      if (I.okRun.n >= 2) { decide(best.id, best.id === "new" ? "guest" : "confirmed", best.p, true); return; }
      I.state = "uncertain";
      if (I.cleanS >= k.decideS) { const bk = post.find(h => h.id !== "new");
        if (bk && bk.p >= k.tentative) decide(bk.id, "tentative", bk.p, false); else decide("new", "guest", (post.find(h => h.id === "new") || { p: 0 }).p, true); }
    }
    /* every hop: accumulate the identity vector on clean windows, evaluate every 15 s of clean data */
    I.observe = function (a) {
      I.metrics = a.metrics || I.metrics;
      if (I.sid == null) newSession(a.t);
      if (a.clean && a.feats && a.feats._psd) {
        const groups = GROUPS[dev] || []; if (!I.acc) I.acc = groups.map(() => ({ sum: new Float64Array(FREQ.length), w: 0 }));
        groups.forEach((g, gi) => { const idx = g.map(n => (a.channels || []).indexOf(n)).filter(i => i >= 0 && a.feats._psd[i]);
          if (!idx.length) return; const acc = I.acc[gi];
          for (const c of idx) { const p = a.feats._psd[c]; FREQ.forEach((f, j) => { const kk = f / p.df, k0 = Math.floor(kk), fr = kk - k0, A = p.P[Math.min(k0, p.P.length - 1)], B = p.P[Math.min(k0 + 1, p.P.length - 1)]; acc.sum[j] += Math.log(A * (1 - fr) + B * fr + 1e-12) * a.hop / idx.length; }); }
          acc.w += a.hop; });
        I.accW += a.hop; I.cleanS += a.hop;
        if (a.card && a.card.hr8 != null) { I.hrS += a.card.hr8; I.hrN++; }
        if (a.contact) { const q = a.contact.map(v => v == null ? 0 : v); if (!I.contactS) I.contactS = q.map(() => 0); q.forEach((v, i) => { I.contactS[i] += v; }); I.contactN++; }
        if (a.ecgTemplate) I.tpl = a.ecgTemplate;
        if ((I.state === "gathering" || I.state === "uncertain") && I.cleanS >= I.nextEval) { I.nextEval += k.evalS; evaluate(); }
      }
      if (I.decidedAt != null && I.state !== "uncertain" && I.summarizer && a.t - I.lastSave >= k.saveS) { I.lastSave = a.t; try { commit(I.summarizer()); } catch (e) {} }
      return I.profile();
    };
    I.profile = function () {
      const stt = I.state === "gathering" ? "uncertain" : I.state;
      return { id: I.profileId, label: I.label, confidence: I.conf, state: stt, badge: stt === "uncertain" ? "Identifying…" : I.first ? (I.label || "Julian") + " (first session)" : "", merged: I.merged, sessionId: I.sid };
    };
    function commit(sum) {
      if (!sum || I.sid == null) return null;
      const rec = Object.assign({}, sum, { id: I.sid, seq: I.seq, profileId: I.profileId, device: dev, start: I.start, end: store_now(), idState: I.state === "gathering" ? "uncertain" : I.state, merged: !!(I.profileId && I.merged),
        identity: obsVector() || null });
      if (!rec.profileId) rec.merged = false;
      return store.commitSession(rec);
    }
    I.setSummarizer = fn => { I.summarizer = fn; };
    I.endSession = function (sum) { const r = commit(sum); return r; };
    I.restart = function (t) { if (I.summarizer) { try { commit(I.summarizer()); } catch (e) {} } if (I.metrics && I.metrics.resetSession) I.metrics.resetSession(); I.sid = null; newSession(t); loadInto(I.profileId); };
    I.confirm = function () { if (!I.profileId) return false; I.merged = true; if (I.state === "tentative") I.state = "confirmed"; store.confirmSession(I.sid); if (I.summarizer) commit(I.summarizer()); return true; };
    I.relabel = function (pid) { if (pid === "new") pid = store.newGuest().id; const p = store.getProfile(pid); if (!p) return false; I.profileId = pid; I.label = p.label; I.state = "confirmed"; I.conf = 1; I.merged = true; I.first = false;
      if (I.summarizer) commit(Object.assign(I.summarizer(), {})); store.relabelSession(I.sid, pid); loadInto(pid); return true; };
    return I;
  }
  const API = { create, GROUPS, DEF };
  E.Identity = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
