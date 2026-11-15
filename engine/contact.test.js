/* Tests for engine/contact.js. Run: node engine/contact.test.js */
"use strict";
const U = require("./util.js"), Ct = require("./contact.js"), P = require("./preproc.js");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }
const fs = 250, r = U.rng(4);
function win(gen) { // 1 s of a channel through the preprocessing
  const p = P.create({ fs, nCh: 1 }), raw = [], xd = [], xa = [];
  for (let i = 0; i < fs * 3; i++) { const v = gen(i); p.run(0, v); if (i >= fs * 2) { raw.push(v); xd.push(p.xd); xa.push(p.xa); } }
  return { raw, xd, xa };
}
const chans = ["A", "B", "C", "D", "E"];
const W = [
  win(() => 190000),                                          // railed
  win(() => 0.05 * r.normal()),                               // flat
  win(i => 10 * Math.sin(2 * Math.PI * 10 * i / fs) + 3 * r.normal()), // clean ~10 uV
  win(() => 277 * r.normal()),                                // noisy: about 150 uV RMS after the 45 Hz low-pass (unit white noise -> 0.54)
  win(i => 8 * Math.sin(2 * Math.PI * 10 * i / fs) + 60 * Math.sin(2 * Math.PI * 60 * i / fs)) // strong mains
];
const c = Ct.create({ fs, channels: chans });
for (let t = 1; t <= 6; t++) c.update(t, k => W[k]);
const Q = c.state.Q;
ok(Q[0] === 0, "railed channel -> 0");
ok(Q[1] === 0, "flat channel -> 0");
ok(Q[2] >= 90, "10 uV clean channel -> " + Q[2].toFixed(0) + " (>= 90)");
ok(Q[3] < 40 && c.isExcluded(3), "150 uV noisy channel (xa RMS " + c.state.detail[3].rms.toFixed(0) + ") -> " + Q[3].toFixed(0) + " (< 40) and excluded");
ok(Q[4] < 100 && Q[4] >= 30, "strong mains lowers the score (" + Q[4].toFixed(0) + ")");
ok(JSON.stringify(c.excludedNames()) === JSON.stringify(["A", "B", "D", "E"]), "excluded list " + c.excludedNames() + " (strong mains alone scores 30, below 40)");
const ev = c.drain(); ok(ev.filter(e => e.phase === "start").length === 4 && ev.every(e => e.type === "bad_contact"), "bad_contact start events");
// hysteresis timing: channel D recovers -> back in after Q >= 50 for 3 consecutive seconds
const good = W[2]; let backAt = null;
for (let t = 7; t <= 20; t++) { c.update(t, k => k === 3 ? good : W[k]); if (backAt == null && !c.isExcluded(3)) backAt = t; }
// Q goes 0.5 -> 0.75 -> ... toward 100: needs Q >= 50 (first good second gives about 61) then 3 seconds of it
ok(backAt === 9, "re-included after 3 consecutive seconds with Q >= 50 (at t=" + backAt + ")");
const ev2 = c.drain(); ok(ev2.some(e => e.phase === "end" && e.channels[0] === "D" && e.offset === 9), "bad_contact end event when re-included");
{ const c2 = Ct.create({ fs, channels: chans }); for (let t = 1; t <= 2; t++) c2.update(t, k => W[k]); c2.update(3, k => k === 3 ? good : W[k]); c2.update(4, k => W[k]); c2.update(5, k => k === 3 ? good : W[k]);
  ok(c2.isExcluded(3), "a bad second in between restarts the 3 s count"); }
// impedance input
ok(Ct.scoreImp(null, Ct.DEF) === 100 && Ct.scoreImp(750, Ct.DEF) === 100 && Math.abs(Ct.scoreImp(1625, Ct.DEF) - 70) < 1e-9 && Ct.scoreImp(3000, Ct.DEF) === 20, "impedance score");
ok(Ct.scoreRms(2, Ct.DEF) === 50 && Math.abs(Ct.scoreRms(135, Ct.DEF) - 50) < 1e-9 && Ct.scoreLine(20, Ct.DEF) === 30, "RMS and line scores");
// Muse passthrough
const m = Ct.create({ fs: 256, device: "muse", channels: ["TP9", "AF7", "AF8", "TP10"] });
m.passthrough(1, [78, 100, 96, 30]);
ok(m.state.Q[0] === 78 && m.state.Q[3] === 30 && m.isExcluded(3) && !m.isExcluded(0), "Muse: frame.contact used as is, same exclusion rule");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
