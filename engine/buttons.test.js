/* Tests for engine/buttons.js (B1-B7), through the pipeline on fixtures. Run: node engine/buttons.test.js */
"use strict";
const K = require("./testkit.js"), F = K.F, U = require("./util.js"), B = require("./buttons.js");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }

// B1 20 double blinks -> >= 18 detected, latency < 400 ms each
{ const r = K.rec("cyton", 140, 3), truth = []; for (let k = 0; k < 20; k++) truth.push(F.doubleBlink(r, 15 + 6 * k, 350)[2]);
  const { buttons } = K.run(r), db = buttons.filter(b => b.type === "double_blink");
  const hits = truth.map(tr => db.find(b => b.t >= tr.offset - 0.2 && b.t <= tr.offset + 1)).filter(Boolean), lat = hits.map((b, i) => b.t - truth.find(tr => b.t >= tr.offset - 0.2 && b.t <= tr.offset + 1).offset);
  ok(hits.length >= 18 && lat.every(x => x < 0.4) && db.length === hits.length, "B1 " + hits.length + "/20 double blinks, latency max " + (1000 * Math.max(...lat)).toFixed(0) + " ms (< 400), " + (db.length - hits.length) + " extra"); }
// B2 20 clench taps -> >= 18 detected, latency < 400 ms
{ const r = K.rec("cyton", 140, 4), truth = []; for (let k = 0; k < 20; k++) truth.push(F.clench(r, 15 + 6 * k)[0]);
  const { buttons } = K.run(r), ct = buttons.filter(b => b.type === "clench_tap");
  const pairs = truth.map(tr => [tr, ct.find(b => b.t >= tr.offset - 0.2 && b.t <= tr.offset + 1)]).filter(p => p[1]), lat = pairs.map(([tr, b]) => b.t - tr.offset);
  ok(pairs.length >= 18 && lat.every(x => x < 0.4) && ct.length === pairs.length, "B2 " + pairs.length + "/20 clench taps, latency max " + (1000 * Math.max(...lat)).toFixed(0) + " ms (< 400)"); }
// B3 5 min of talking + typing + spontaneous blinks (17/min) + 4 chew episodes -> <= 1 false button event
{ const r = K.rec("cyton", 320, 5), rg = U.rng(55);
  for (const t0 of [20, 95, 170, 245]) F.talk(r, t0, 25);                              // talking
  for (const t0 of [55, 130, 205, 285]) F.chew(r, t0, 6, 1.2);                          // chewing
  for (let t = 12; t < 315; t += rg.range(2.2, 4.8)) F.blink(r, t, { ampUv: rg.range(100, 170) });   // about 17 blinks per minute
  const a = r.accel; for (let i = 0; i < a.x.length; i++) { a.x[i] += 0.002 * rg.normal(); a.y[i] += 0.002 * rg.normal(); }   // typing: small head jiggle
  const { buttons } = K.run(r);
  ok(buttons.length <= 1, "B3 5 min of talking, typing, 17 blinks/min and 4 chew episodes -> " + buttons.length + " false button events (<= 1)" + (buttons.length ? " (" + buttons.map(b => b.type + "@" + b.t.toFixed(1)).join(", ") + ")" : "")); }
// B4 triple blink -> no double_blink
{ const r = K.rec("cyton", 60, 6); for (const t0 of [20, 35]) { F.voluntaryBlink(r, t0); F.voluntaryBlink(r, t0 + 0.35); F.voluntaryBlink(r, t0 + 0.7); }
  const { buttons } = K.run(r); ok(!buttons.some(b => b.type === "double_blink"), "B4 triple blinks give no double_blink (" + buttons.map(b => b.type).join(",") + ")"); }
// B5 double blink during motion -> suppressed
{ const r = K.rec("cyton", 60, 7); F.motion(r, 29, 4); F.doubleBlink(r, 30.5, 350); F.doubleBlink(r, 45, 350);
  const { buttons } = K.run(r), db = buttons.filter(b => b.type === "double_blink");
  ok(db.length === 1 && db[0].t > 45, "B5 a double blink during head movement is suppressed; the one after is kept"); }
// B6 refractory periods (unit level: events fed straight to the button logic)
{ const b = B.create({ device: "cyton" }); const ev = [];
  const vb = (pk) => ({ type: "blink_voluntary", onset: pk - 0.2, offset: pk + 0.2, peak: pk, conf: 0.9 });
  b.onEvents([vb(10.0), vb(10.35)], { gateValid: true, t: 10.6 }); ev.push(...b.tick(10.8, { gateValid: true }));
  b.onEvents([vb(10.8), vb(11.1)], { gateValid: true, t: 11.3 }); ev.push(...b.tick(11.6, { gateValid: true }));
  b.onEvents([vb(12.2), vb(12.55)], { gateValid: true, t: 12.8 }); ev.push(...b.tick(13.0, { gateValid: true }));
  ok(ev.filter(e => e.type === "double_blink").length === 2, "B6 double_blink refractory 800 ms: a pair whose second peak is 0.75 s after the last emitted one is dropped, the next one kept");
  const c = B.create({ device: "cyton" }), cl = (on) => ({ type: "emg_burst", sub: "clench", onset: on, offset: on + 0.4, amp: 10, conf: 0.9, chewing: false, talking: false, talkRecent: false });
  c.onEvents([cl(20)], { gateValid: true, t: 20.45 }); c.onEvents([cl(22.0)], { gateValid: true, t: 22.45 }); c.onEvents([cl(25)], { gateValid: true, t: 25.45 });
  const taps = c.tick(26, { gateValid: true }).filter(e => e.type === "clench_tap");
  ok(taps.length === 3, "B6 clench taps with 1.6 s of quiet before each pass the 500 ms refractory and the 1.5 s quiet rule (" + taps.length + ")");
  const d = B.create({ device: "cyton" }); d.onEvents([cl(20)], { gateValid: true, t: 20.45 }); d.onEvents([cl(20.75)], { gateValid: true, t: 21.2 });
  ok(d.tick(22, { gateValid: true }).filter(e => e.type === "clench_tap").length === 1, "B6 a second clench 0.35 s after the first is not a tap"); }
// B7 the Muse emits no button events
{ const r = K.rec("muse", 60, 8); F.doubleBlink(r, 20, 350); F.clench(r, 30); F.doubleBlink(r, 40, 350);
  const { buttons, events } = K.run(r);
  ok(buttons.length === 0 && !events.some(e => e.type === "double_blink" || e.type === "clench_tap") && events.some(e => e.type === "blink_voluntary"), "B7 the Muse engine detects (for masking) but emits no button events"); }
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
