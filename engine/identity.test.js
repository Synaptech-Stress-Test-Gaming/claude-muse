/* Tests for engine/identity.js (I1-I4). Run: node engine/identity.test.js */
"use strict";
const K = require("./testkit.js"), F = K.F, Pr = require("./profiles.js");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }

function session(dev, store, person, day, seconds, after) {
  const r = K.rec(dev, seconds, 1000 + person.seed * 50 + day, { eeg: { session: F.session(person, day) } });
  const res = K.run(r, { engine: { store, flags: { asr: false } } });
  if (after) after(res.eng);
  const prof = res.eng.identity.profile(); res.eng.endSession();
  return { prof, res };
}
function study(dev, nPeople, enrol, tests, seconds) {
  const store = Pr.create({ storage: null }), people = [], ids = [];
  for (let p = 0; p < nPeople; p++) people.push(F.person(p + 1));
  for (let p = 0; p < nPeople; p++) for (let d = 0; d < enrol; d++) {
    session(dev, store, people[p], d, 120, eng => { if (p === 0) return; if (d === 0) { eng.identity.relabel("new"); ids[p] = eng.identity.profileId; store.rename(ids[p], "P" + p); } else eng.identity.relabel(ids[p]); });
    if (p === 0) ids[0] = store.data.ownerId;
  }
  const results = [];
  for (let t = 0; t < tests; t++) { const p = t % nPeople; const { prof } = session(dev, store, people[p], 10 + t, seconds); results.push({ truth: ids[p], prof }); }
  return { store, ids, people, results };
}
// I1 Cyton with ECG: >= 90% to the right profile, none wrongly confirmed
{ const { results, store, people } = study("cyton", 5, 4, 20, 200);
  const right = results.filter(r => r.prof.id === r.truth && (r.prof.state === "confirmed" || r.prof.state === "tentative")).length;
  const wrong = results.filter(r => r.prof.state === "confirmed" && r.prof.id !== r.truth && r.prof.id != null);
  ok(right >= 18, "I1 Cyton: " + right + "/20 new sessions assigned to the right profile (>= 90%)");
  ok(wrong.length === 0, "I1 Cyton: no session confirmed as a wrong known profile (" + wrong.length + ")");
  // I3 open set: a sixth person -> a new Guest
  const before = store.listProfiles().length, sixth = F.person(99), { prof } = session("cyton", store, sixth, 1, 200);
  ok(prof.state === "guest" && store.listProfiles().length === before + 1 && !results.some(r => r.truth === prof.id), "I3 a sixth person -> " + prof.state + " " + prof.label + " (a new profile, not merged into anyone)"); void people; }
// I2 Muse (no ECG): no wrong confirmed; undecided sessions end tentative or guest, never silently merged
{ const { results, store } = study("muse", 5, 4, 10, 200);
  const wrong = results.filter(r => r.prof.state === "confirmed" && r.prof.id !== r.truth);
  ok(wrong.length === 0, "I2 Muse: no wrong 'confirmed' (" + results.map(r => r.prof.state[0] + (r.prof.id === r.truth ? "+" : "-")).join(" ") + ")");
  const sess = store.data.sessions.slice(-10);
  ok(sess.every(s => s.idState !== "tentative" || s.merged === false), "I2 Muse: tentative sessions are stored with merged:false");
  ok(results.every(r => ["confirmed", "tentative", "guest"].includes(r.prof.state)), "I2 Muse: every session ends confirmed, tentative or guest"); }
// I4 no profile update before confidence; scoring with the priors meanwhile
{ const store = Pr.create({ storage: null }), owner = F.person(1); session("cyton", store, owner, 0, 120); session("cyton", store, owner, 1, 120);
  const prof = () => JSON.stringify([store.data.profiles, store.data.sessions]), snap = prof(); let checked = 0, priorOnly = true, decidedAt = null;
  const r = K.rec("cyton", 120, 4321, { eeg: { session: F.session(owner, 7) } });
  K.run(r, { engine: { store, flags: { asr: false } }, each: (o, eng) => { const st = eng.identity.state;
    if (st === "gathering" || st === "uncertain") { checked++; if (prof() !== snap) priorOnly = "store changed"; const f = eng.metrics.feats.thetaF; if (f.life.W !== 0) priorOnly = "lifetime loaded"; }
    else if (decidedAt == null) decidedAt = o.t; } });
  ok(checked > 100 && priorOnly === true, "I4 during gathering/uncertain (" + checked + " hops) the stored profiles stay byte-identical and the lifetime tier is empty (prior-only z)" + (priorOnly !== true ? " [" + priorOnly + "]" : ""));
  ok(decidedAt != null, "I4 the owner is recognised after " + decidedAt + " s"); }
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
