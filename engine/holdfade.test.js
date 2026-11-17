/* Tests for engine/holdfade.js. Run: node engine/holdfade.test.js */
"use strict";
const H = require("./holdfade.js");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }
const near = (a, b) => Math.abs(a - b) <= 1e-9;

const h = H.create({});
let o = h.step({ usable: true, value: 62, conf: 0.8 }); ok(o.state === "live" && o.value === 62 && o.conf === 0.8, "usable -> live with the value and conf");
const seq = []; for (let k = 0; k < 14; k++) seq.push(h.step({ usable: false, reason: "muscle" }));
const at = s => seq[Math.round(s / 0.25)];  // seq[i] is the output after (i) hops of masking: heldFor before that step = i * 0.25
ok(at(0).state === "held" && near(at(0).conf, 0.8) && at(0).value === 62 && at(0).reason === "muscle", "0 s of masking: held, conf 0.8, value kept, reason kept");
ok(at(0.25).state === "held" && near(at(0.25).conf, 0.8 * (1 - 0.25 / 3)), "0.25 s: held, conf faded");
ok(at(1.5).state === "held" && near(at(1.5).conf, 0.4), "1.5 s: conf is exactly half of the last conf (" + at(1.5).conf + ")");
ok(at(2.75).state === "held" && near(at(2.75).conf, 0.8 * (1 - 2.75 / 3)) && at(2.75).value === 62, "2.75 s: still held");
ok(at(3.0).state === "stale" && at(3.0).value === null && at(3.0).conf === 0 && at(3.0).reason === "muscle", "3.0 s: stale, value null, reason kept");
ok(at(3.25).state === "stale" && at(3.25).value === null, "3.25 s: stale, value null");
o = h.step({ usable: true, value: 55, conf: 0.7 }); ok(o.state === "live" && o.value === 55, "immediate recovery on the first usable window");
o = h.step({ usable: true, value: 55, conf: 0.7, learning: true }); ok(o.state === "learning" && o.value === 55, "learning carries a number");
const g = H.create({}); g.step({ usable: true, value: 40, conf: 1 }); for (let k = 0; k < 13; k++) o = g.idle(0.25);
ok(o.state === "stale" && o.reason === "signal lost", "idle() path: held then stale with reason 'signal lost'");
o = g.step({ available: false, usable: true, value: 50, conf: 1, reason: "no ECG" }); ok(o.state === "unavailable" && o.value === null && o.conf === 0 && o.reason === "no ECG", "unavailable wins over everything");
const n = H.create({}); o = n.step({ usable: false, reason: "blink" }); ok(o.state === "stale" && o.value === null, "no clean value yet and not usable -> stale");
const r = H.create({}); r.step({ usable: true, value: 1, conf: 1 }); for (let k = 0; k < 140; k++) r.step({ usable: false, reason: "movement" }); r.step({ usable: true, value: 2, conf: 1 });
ok(r.restart === true, "after more than 30 s stale the EMA restart flag is set");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
