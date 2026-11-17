/* engine/profiles.js
   Profile store: localStorage key "museengine.profiles.v1"; every access in try/catch (a private window or full storage must not break the
   panel: the store then runs in memory and says notSaved).
   Only per-session SUMMARIES are stored, never raw data. A profile's lifetime statistics and identity template are always rebuilt by folding
   its sessions in time order on top of `base` (engine/norm.js fold), which makes relabel, merge and "forget me" exact.
   At most 60 sessions per profile and device: older ones are folded into `base` (after which they can no longer be relabelled).
   At most 20 guest profiles: the oldest guest with under 5 min of data is removed.
   Privacy: templates and summaries stay in this browser's storage; only a profile label and a confidence number go to the game link.
   { schemaVersion: 1, ownerId, guestCounter, sessionCounter,
     profiles: { id: { id, label, owner, created, devices: { muse|cyton: { montage, base: {feature: summary}, baseSessions, det, iaf, asr } } } },
     sessions: [ { id, profileId, device, montage, start, end, cleanSec, idState, merged, features: {key: {W,m,S,hist}}, identity: {...} } ] }
   UMD: MuseEngine.Profiles. Tested by engine/profiles.test.js. */
"use strict";
(function (root) {
  const E = root.MuseEngine = root.MuseEngine || {};
  const N = E.Norm || (typeof require !== "undefined" ? require("./norm.js") : null);
  const KEY = "museengine.profiles.v1", MAX_SESS = 60, MAX_GUESTS = 20, OWNER_LABEL = "Julian";
  const clone = o => JSON.parse(JSON.stringify(o));

  function create(o) {
    o = Object.assign({ storage: null, now: () => Date.now(), key: KEY, ownerLabel: OWNER_LABEL }, o);
    const P = { data: null, notSaved: false, listeners: [] };
    function empty() { return { schemaVersion: 1, ownerId: null, guestCounter: 0, sessionCounter: 0, profiles: {}, sessions: [] }; }
    P.load = function () {
      let d = null;
      try { const s = o.storage ? o.storage.getItem(o.key) : null; if (s) d = JSON.parse(s); } catch (e) { d = null; P.notSaved = !o.storage; }
      P.data = d && d.schemaVersion === 1 ? d : empty();
      if (!o.storage) P.notSaved = true;
      return P.data;
    };
    P.save = function () {
      if (!o.storage) { P.notSaved = true; return false; }
      try { o.storage.setItem(o.key, JSON.stringify(P.data)); P.notSaved = false; return true; } catch (e) { P.notSaved = true; return false; }
    };
    const D = () => P.data || P.load();
    P.ensureOwner = function () {
      const d = D(); if (d.ownerId && d.profiles[d.ownerId]) return d.profiles[d.ownerId];
      const id = "p_owner"; d.profiles[id] = { id, label: o.ownerLabel, owner: true, created: o.now(), devices: {} }; d.ownerId = id; P.save(); return d.profiles[id];
    };
    P.isFirstEver = () => { const d = D(); return !d.sessions.length && !Object.keys(d.profiles).some(k => !d.profiles[k].owner); };
    P.newGuest = function () {
      const d = D(); d.guestCounter++; const id = "p_g" + d.guestCounter; d.profiles[id] = { id, label: "Guest " + d.guestCounter, owner: false, guest: true, created: o.now(), devices: {} };
      const guests = Object.values(d.profiles).filter(p => p.guest);
      if (guests.length > MAX_GUESTS) { const small = guests.filter(g => g.id !== id && P.cleanSecOf(g.id) < 300).sort((a, b) => a.created - b.created)[0]; if (small) P.remove(small.id); }
      P.save(); return d.profiles[id];
    };
    P.nextSessionId = () => { const d = D(); d.sessionCounter = (d.sessionCounter || 0) + 1; return "s_" + d.sessionCounter; };
    P.cleanSecOf = id => D().sessions.filter(s => s.profileId === id).reduce((a, s) => a + (s.cleanSec || 0), 0) + Object.values((D().profiles[id] || {}).devices || {}).reduce((a, dv) => a + (dv.baseCleanSec || 0), 0);
    P.listProfiles = () => Object.values(D().profiles).map(p => ({ id: p.id, label: p.label, owner: !!p.owner, guest: !!p.guest, sessions: D().sessions.filter(s => s.profileId === p.id).length }));
    P.getProfile = id => D().profiles[id] || null;
    P.rename = (id, label) => { const p = D().profiles[id]; if (!p) return false; p.label = String(label); P.save(); return true; };
    /* sessions that count for a profile's statistics, oldest first */
    P.sessionsOf = (id, device) => D().sessions.filter(s => s.profileId === id && s.device === device && s.merged).sort((a, b) => ((a.seq || 0) - (b.seq || 0)) || (a.start - b.start));
    /* lifetime statistics per feature key: { byKey: {key: [summaries]}, base: {key: summary}, sessions } */
    P.lifetime = function (id, device) {
      const p = D().profiles[id]; if (!p) return { byKey: {}, base: null, sessions: 0 };
      const ss = P.sessionsOf(id, device), byKey = {};
      for (const s of ss) for (const k in s.features || {}) (byKey[k] = byKey[k] || []).push(s.features[k]);
      const dv = p.devices[device] || {};
      return { byKey, base: dv.base || null, sessions: ss.length + (dv.baseSessions || 0) };
    };
    P.detFor = device => { const d = D(), p = d.ownerId && d.profiles[d.ownerId]; return p && p.devices[device] && p.devices[device].det || null; };
    P.asrFor = device => { const d = D(), p = d.ownerId && d.profiles[d.ownerId]; return p && p.devices[device] && p.devices[device].asr || null; };
    P.identityHistory = (id, device) => P.sessionsOf(id, device).map(s => s.identity).filter(Boolean).concat((((D().profiles[id] || {}).devices || {})[device] || {}).baseIdentity || []);
    /* commit (or update) a session summary; idempotent by session id */
    P.commitSession = function (sum) {
      const d = D(); if (!sum || !sum.id) return null;
      const i = d.sessions.findIndex(s => s.id === sum.id), rec = clone(sum);
      if (i >= 0) d.sessions[i] = rec; else d.sessions.push(rec);
      if (rec.profileId && d.profiles[rec.profileId] && rec.merged) {
        const dv = d.profiles[rec.profileId].devices[rec.device] = d.profiles[rec.profileId].devices[rec.device] || { montage: rec.montage, base: null, baseSessions: 0 };
        if (rec.det) dv.det = rec.det; if (rec.iaf && rec.iaf.valid) dv.iaf = { hz: rec.iaf.hz, valid: true }; if (rec.asr) dv.asr = rec.asr; dv.montage = rec.montage;
        capSessions(rec.profileId, rec.device);
      }
      P.save(); return rec;
    };
    /* 60-session cap: fold the oldest into base (statistics unchanged by the fold) */
    function capSessions(id, device) {
      const d = D(), ss = P.sessionsOf(id, device); if (ss.length <= MAX_SESS) return;
      const dv = d.profiles[id].devices[device], old = ss.slice(0, ss.length - MAX_SESS);
      const keys = new Set(); old.forEach(s => Object.keys(s.features || {}).forEach(k => keys.add(k)));
      dv.base = dv.base || {};
      for (const k of keys) { const sums = old.map(s => s.features[k]).filter(Boolean); if (!sums.length) continue; const pr = { mu: sums[0].hist.mu0, sd: sums[0].hist.sd0 };
        dv.base[k] = N.accSer(N.fold(sums, pr, dv.base[k] || null)); }
      dv.baseSessions = (dv.baseSessions || 0) + old.length; dv.baseCleanSec = (dv.baseCleanSec || 0) + old.reduce((a, s) => a + (s.cleanSec || 0), 0);
      dv.baseIdentity = (dv.baseIdentity || []).concat(old.map(s => s.identity).filter(Boolean)).slice(-MAX_SESS);
      const ids = new Set(old.map(s => s.id)); d.sessions = d.sessions.filter(s => !ids.has(s.id));
    }
    P.relabelSession = function (sid, pid) {
      const d = D(), s = d.sessions.find(x => x.id === sid); if (!s) return null;
      if (pid === "new") pid = P.newGuest().id;
      if (!d.profiles[pid]) return null;
      s.profileId = pid; s.idState = "corrected"; s.merged = true;
      const dv = d.profiles[pid].devices[s.device] = d.profiles[pid].devices[s.device] || { montage: s.montage, base: null, baseSessions: 0 };
      capSessions(pid, s.device); P.save(); return pid;
    };
    P.confirmSession = function (sid) { const s = D().sessions.find(x => x.id === sid); if (!s) return false; s.merged = true; if (s.idState === "tentative") s.idState = "confirmed"; P.save(); return true; };
    P.merge = function (fromId, intoId) {
      const d = D(), a = d.profiles[fromId], b = d.profiles[intoId]; if (!a || !b || fromId === intoId) return false;
      d.sessions.forEach(s => { if (s.profileId === fromId) s.profileId = intoId; });
      for (const dev in a.devices) { const da = a.devices[dev], db = b.devices[dev] = b.devices[dev] || { montage: da.montage, base: null, baseSessions: 0 };
        if (da.base) { db.base = db.base || {}; for (const k in da.base) { const pa = da.base[k], pr = { mu: pa.hist.mu0, sd: pa.hist.sd0 }; db.base[k] = db.base[k] ? N.accSer(N.merge(N.accDe(db.base[k], pr), N.accDe(pa, pr))) : pa; } }
        db.baseSessions = (db.baseSessions || 0) + (da.baseSessions || 0); db.baseCleanSec = (db.baseCleanSec || 0) + (da.baseCleanSec || 0); db.baseIdentity = (db.baseIdentity || []).concat(da.baseIdentity || []);
        if (!db.det && da.det) db.det = da.det; capSessions(intoId, dev); }
      delete d.profiles[fromId]; if (d.ownerId === fromId) d.ownerId = intoId; P.save(); return true;
    };
    P.remove = function (id) { const d = D(); if (!d.profiles[id]) return false; delete d.profiles[id]; d.sessions = d.sessions.filter(s => s.profileId !== id); if (d.ownerId === id) d.ownerId = null; P.save(); return true; };
    P.exportJSON = () => JSON.stringify(D());
    P.importJSON = function (text) {
      const j = JSON.parse(text); if (!j || j.schemaVersion !== 1 || typeof j.profiles !== "object" || !Array.isArray(j.sessions)) throw new Error("not a museengine profile export (schemaVersion 1)");
      const d = D(); for (const id in j.profiles) d.profiles[id] = j.profiles[id];
      for (const s of j.sessions) { const i = d.sessions.findIndex(x => x.id === s.id); if (i >= 0) d.sessions[i] = s; else d.sessions.push(s); }
      d.guestCounter = Math.max(d.guestCounter || 0, j.guestCounter || 0); d.sessionCounter = Math.max(d.sessionCounter || 0, j.sessionCounter || 0); if (!d.ownerId) d.ownerId = j.ownerId; P.save(); return true;
    };
    P.load();
    return P;
  }
  const API = { create, KEY, MAX_SESS, MAX_GUESTS };
  E.Profiles = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
