/* Tests for engine/profiles.js (I5-I7). Run: node engine/profiles.test.js */
"use strict";
const U = require("./util.js"), N = require("./norm.js"), Pr = require("./profiles.js"), K = require("./testkit.js"), F = K.F;
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }
const PRI = { mu: 2.3, sd: 0.7 };
function fakeSession(store, pid, seed, n) {
  const g = U.rng(seed), f = N.feature(PRI, { isEeg: true }), h = N.feature({ mu: 70, sd: 10 }); for (let i = 0; i < (n || 400); i++) { f.update(2.3 + 0.3 * g.normal() + 0.2 * Math.sin(seed), 0.25); h.update(70 + 5 * g.normal(), 0.25); }
  const id = store.nextSessionId();
  return store.commitSession({ id, seq: +id.slice(2), profileId: pid, device: "cyton", montage: "m", start: 1000 + seed, end: 2000 + seed, cleanSec: 100, idState: "confirmed", merged: true, features: { thetaF: f.summary(), hr: h.summary() }, identity: { eeg: [seed % 3, 1], hr: [70] } });
}
const deep = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b) => { const ja = JSON.stringify(a), jb = JSON.stringify(b); if (ja === jb) return true; const x = JSON.parse(ja), y = JSON.parse(jb); let ok2 = true;
  (function walk(p, q) { if (typeof p === "number") { if (Math.abs(p - q) > 1e-12 * (1 + Math.abs(p))) ok2 = false; return; } if (p && typeof p === "object") { for (const k2 in p) walk(p[k2], q ? q[k2] : undefined); } else if (p !== q) ok2 = false; })(x, y); return ok2; };

// I5 relabel A -> B -> A restores both profiles exactly
{ const s = Pr.create({ storage: null }); const A = s.ensureOwner().id, B = s.newGuest().id;
  for (let i = 0; i < 4; i++) fakeSession(s, A, i); for (let i = 10; i < 13; i++) fakeSession(s, B, i);
  const la = s.lifetime(A, "cyton"), lb = s.lifetime(B, "cyton"), sid = s.data.sessions[1].id;
  s.relabelSession(sid, B); const mid = s.lifetime(B, "cyton"); s.relabelSession(sid, A);
  ok(mid.sessions === 4 && near(s.lifetime(A, "cyton"), la) && near(s.lifetime(B, "cyton"), lb), "I5 moving a session from A to B and back restores both profiles exactly");
  const fa = N.feature(PRI, { isEeg: true }); fa.loadLifetime(la.byKey.thetaF); const fb = N.feature(PRI, { isEeg: true }); fb.loadLifetime(s.lifetime(A, "cyton").byKey.thetaF);
  ok(Math.abs(fa.z(2.9) - fb.z(2.9)) < 1e-12, "I5 rebuilt lifetime statistics score a probe identically (1e-12)"); }
// I6 merge, forget me, export/import, throwing storage
{ const mem = {}, storage = { getItem: k => mem[k] || null, setItem: (k, v) => { mem[k] = v; } };
  const s = Pr.create({ storage }); const A = s.ensureOwner().id, B = s.newGuest().id, C = s.newGuest().id;
  fakeSession(s, A, 1); fakeSession(s, B, 2); fakeSession(s, B, 3); fakeSession(s, C, 4);
  s.merge(B, A); ok(!s.getProfile(B) && s.data.sessions.every(x => s.getProfile(x.profileId)) && s.lifetime(A, "cyton").sessions === 3, "I6 merge moves the sessions and leaves no orphan");
  s.remove(C); ok(!s.getProfile(C) && !s.data.sessions.some(x => x.profileId === C), "I6 forget me deletes the profile and all its sessions");
  const js = s.exportJSON(), s2 = Pr.create({ storage: null }); s2.importJSON(js); ok(deep(JSON.parse(s2.exportJSON()), JSON.parse(js)), "I6 export -> import round trip is lossless");
  const s3 = Pr.create({ storage }); ok(deep(s3.data, s.data), "I6 the store reloads from localStorage key " + Pr.KEY);
  let threw = false; try { s2.importJSON('{"schemaVersion":2}'); } catch (e) { threw = true; } ok(threw, "I6 import validates schemaVersion");
  const bad = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } }, sb = Pr.create({ storage: bad });
  let noThrow = true; try { const r = K.rec("cyton", 70, 9); K.run(r, { engine: { store: sb, flags: { asr: false } } }).eng.endSession(); } catch (e) { noThrow = false; }
  ok(noThrow && sb.notSaved === true && sb.data.sessions.length === 1, "I6 storage that throws on setItem does not throw out of the engine (runs in memory, notSaved)"); }
// I7 the 60-session cap folds the oldest into base; statistics unchanged by the fold
{ const s = Pr.create({ storage: null }), A = s.ensureOwner().id; let before = null;
  for (let i = 0; i < 61; i++) { if (i === 60) { const lt = s.lifetime(A, "cyton"), f = N.feature(PRI, { isEeg: true }); f.loadLifetime(lt.byKey.thetaF, lt.base && lt.base.thetaF); before = f; }
    fakeSession(s, A, 100 + i, 40); }
  const lt = s.lifetime(A, "cyton"), dv = s.getProfile(A).devices.cyton;
  ok(s.sessionsOf(A, "cyton").length === 60 && dv.baseSessions === 1 && dv.base && dv.base.thetaF, "I7 61 sessions -> 60 kept, the oldest folded into base");
  // the same 61 summaries folded directly (no cap) must give the same lifetime statistics as base + 60
  const all = []; const s2 = Pr.create({ storage: null }), A2 = s2.ensureOwner().id; for (let i = 0; i < 61; i++) all.push(fakeSession(s2, A2, 100 + i, 40));
  const direct = N.fold(all.map(x => x.features.thetaF), PRI), viaBase = N.fold(lt.byKey.thetaF, PRI, lt.base.thetaF);
  ok(Math.abs(direct.W - viaBase.W) < 1e-9 && Math.abs(direct.m - viaBase.m) < 1e-9 && Math.abs(direct.S - viaBase.S) < 1e-9 * (1 + direct.S), "I7 statistics unchanged by the fold (W, m, S within 1e-9)"); void before; }
// guests: at most 20
{ const s = Pr.create({ storage: null }); s.ensureOwner(); for (let i = 0; i < 25; i++) s.newGuest(); ok(s.listProfiles().filter(p => p.guest).length === 20, "at most 20 guest profiles (the oldest small guest is removed)"); }
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
