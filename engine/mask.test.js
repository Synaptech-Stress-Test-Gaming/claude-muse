/* Tests for engine/mask.js. Run: node engine/mask.test.js */
"use strict";
const Mk = require("./mask.js"), Ev = require("./events.js");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const fs = 250, CH = ["Fp1", "Fp2", "C3", "C4", "P7", "P8", "O1", "O2", "F7", "F8", "F3", "F4", "T7", "T8", "P3", "P4"];
const eeg = CH.map((_, i) => i).filter(i => i !== 8);           // F7 = ECG
const G = Ev.groupsFor("cyton", CH, eeg);
const mk = () => Mk.create({ fs, device: "cyton", channels: CH, groups: G, eegIdx: eeg });
const ix = n => CH.indexOf(n), one = 1 / fs;

// margins of the table, exact to one sample
{ const m = mk();
  const cases = [
    [{ type: "blink", onset: 10, offset: 10.3 }, 9.9, 10.7, "blink", ix("Fp1"), true, ix("O1"), false],
    [{ type: "saccade", onset: 20, offset: 20.2 }, 19.9, 20.5, "blink", ix("F3"), true, ix("P3"), false],
    [{ type: "emg_burst", sub: "clench", onset: 30, offset: 30.4 }, 29.9, 30.7, "muscle", ix("O2"), true, -1],
    [{ type: "emg_burst", sub: "chew", onset: 40, offset: 41 }, 39.9, 42, "muscle", ix("P4"), true, -1],
    [{ type: "emg_burst", sub: "other", onset: 50, offset: 50.3, chanIdx: [ix("T7")] }, 49.9, 50.6, "muscle", ix("T8"), true, ix("O1"), false],
    [{ type: "motion", onset: 60, offset: 63.5, lastOver: 62, validAt: 63.5 }, 59.8, 63.5, "movement", ix("O1"), true, -1],
    [{ type: "gap", onset: 70, offset: 70.5 }, 70, 72.5, "signal lost", ix("C3"), true, -1],
    [{ type: "electrode_pop", onset: 80, offset: 80.05, chanIdx: [ix("C3")] }, 80, 81, "no contact", ix("C3"), true, ix("C4"), false]
  ];
  for (const [ev, a, b, reason, cin, yes, cout, no] of cases) {
    const it = m.add(ev); ok(it && near(it.t0, a, 1e-9) && near(it.t1, b, 1e-9) && it.reason === reason, ev.type + (ev.sub ? "/" + ev.sub : "") + " mask [" + a + ", " + b + "] reason " + reason);
    ok(m.maskedAt(cin, a + one / 2) === yes && m.maskedAt(cin, a - one) === false && m.maskedAt(cin, b - one / 2) && !m.maskedAt(cin, b + one), ev.type + ": edges exact to one sample on " + CH[cin]);
    if (cout >= 0) ok(m.maskedAt(cout, (a + b) / 2) === no, ev.type + ": not applied to " + CH[cout]);
  }
  const big = m.add({ type: "emg_burst", sub: "other", onset: 90, offset: 90.3, chanIdx: [ix("T7"), ix("T8"), ix("O1"), ix("C3")] });
  ok(big.chans === null, "emg_burst other on >= 4 channels masks all channels");
  const mm = Mk.create({ fs: 256, device: "muse", channels: ["TP9", "AF7", "AF8", "TP10"], groups: Ev.groupsFor("muse", ["TP9", "AF7", "AF8", "TP10"], [0, 1, 2, 3]) });
  ok(mm.add({ type: "emg_burst", sub: "other", onset: 1, offset: 2, chanIdx: [0, 3] }).chans === null, "Muse: >= 2 channels in burst masks all");
}
// blink in the middle of a 2 s window: posterior usable, frontal not
{ const m = mk(); m.add({ type: "blink", onset: 101, offset: 101.3 });
  const post = m.windowInfo(100, 102, [ix("P3"), ix("P4"), ix("O1"), ix("O2")], 2), front = m.windowInfo(100, 102, [ix("F3"), ix("F4"), ix("F8")], 2);
  ok(post.usable && post.cleanFrac === 1, "a blink mid-window leaves the posterior set usable (cleanFrac 1)");
  ok(!front.usable && front.reason === "blink", "and makes the frontal set unusable (reason blink)"); }
// 0.5 s mask at the window edge -> cleanFrac 0.75, segments only on clean data
{ const m = mk(); m.addInt(201.5, 202.5, "movement", null);
  const w = m.windowInfo(200, 202, [ix("C3")], 1), segs = w.segments[ix("C3")];
  ok(w.usable && near(w.cleanFrac, 0.75, 1e-9), "0.5 s mask at the window edge -> cleanFrac 0.75");
  ok(segs.length === 2 && segs.every(s => s[1] <= Math.round(201.5 * fs)) && segs[0][0] === 200 * fs, "segments: 1 s, 50% overlap from the run start, none touches the mask (" + segs.length + " segments)"); }
{ const m = mk(); m.addInt(200, 200.7, "blink", null); const w = m.windowInfo(200, 202, [ix("C3")], 1), s = w.segments[ix("C3")];
  ok(s.length === 2 && s[1][1] === 202 * fs && s[1][0] === 201 * fs, "a run with >= 0.25 s left over gets one segment aligned to the run end"); }
// < 60% clean -> unusable
{ const m = mk(); m.addInt(200, 200.85, "muscle", null); const w = m.windowInfo(200, 202, [ix("C3"), ix("C4")], 1);
  ok(!w.usable && w.reason === "muscle", "< 60% clean -> unusable (57.5% clean)"); }
// reason priority
{ const m = mk(); m.addInt(300, 300.9, "blink", null); m.addInt(300.9, 301.8, "movement", null);
  ok(m.windowInfo(300, 302, [ix("C3")], 1).reason === "movement", "tie broken by priority: movement over blink");
  const m2 = mk(); m2.addInt(300, 301.2, "blink", null); m2.addInt(301.2, 302, "signal lost", null); ok(m2.windowInfo(300, 302, [ix("C3")], 1).reason === "blink", "the reason covering the most samples wins");
  const m3 = mk(); m3.addInt(300, 301, "muscle", null); m3.addInt(301, 302, "signal lost", null); ok(m3.windowInfo(300, 302, [ix("C3")], 1).reason === "signal lost", "equal coverage: signal lost > muscle"); }
// channel-level masking drops only that channel while minChannels remain
{ const m = mk(); m.add({ type: "electrode_pop", onset: 400.5, chanIdx: [ix("P3")] });
  const w = m.windowInfo(400, 402, [ix("P3"), ix("P4"), ix("O1")], 2); ok(w.usable && !w.channels.includes("P3") && w.channels.length === 2, "a pop drops only that channel");
  const w2 = m.windowInfo(400, 402, [ix("P3"), ix("P4")], 2); ok(!w2.usable && w2.reason === "no contact", "too few channels left -> unusable"); }
// open masks and flags, pruning
{ const m = mk(); m.setOpen([{ t0: 500.5, reason: "muscle", chans: null }]); ok(!m.windowInfo(500, 502, [ix("C3")], 1).usable, "an open mask extends to now");
  m.add({ type: "eyes_closed", onset: 500, offset: 520 }); ok(m.windowInfo(510, 512, [ix("O1")], 1).eyesClosed, "eyes_closed flags windows, not samples");
  m.prune(600); ok(m.state.list.length === 0 && m.state.flags.length === 0, "intervals pruned after 30 s"); }
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
