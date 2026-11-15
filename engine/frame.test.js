/* Tests for engine/frame.js. Run: node engine/frame.test.js */
"use strict";
const F = require("./frame.js");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }
const throws = fn => { try { fn(); return false; } catch (e) { return true; } };
const good = () => ({ device: "muse", streamId: 1, fs: 256, channels: ["TP9", "AF7", "AF8", "TP10"], sampleIndex: 512, t0: 2, samples: [0, 1, 2, 3].map(() => new Float32Array(12)), gaps: [], accel: null, gyro: null, ppg: null, ecg: null, contact: [90, 90, 90, 90], aux: { ppgHr: null, flags: {} } });

ok(F.validate(good()), "a well-formed frame passes");
ok(throws(() => F.validate(Object.assign(good(), { device: "x" }))), "unknown device rejected");
ok(throws(() => { const f = good(); f.samples[2] = new Float32Array(11); F.validate(f); }), "ragged channels rejected");
ok(throws(() => { const f = good(); f.samples[1][3] = NaN; F.validate(f); }), "NaN sample rejected");
ok(throws(() => F.validate(Object.assign(good(), { t0: 3 }))), "t0 not matching sampleIndex/fs rejected");
ok(throws(() => F.validate(Object.assign(good(), { sampleIndex: 1.5 }))), "fractional sampleIndex rejected");
ok(throws(() => F.validate(Object.assign(good(), { accel: { fs: 52, t: new Float64Array(2), xyz: new Float32Array(5) } }))), "bad accel shape rejected");
ok(throws(() => F.validate(Object.assign(good(), { gaps: [{ at: 3, n: 0 }] }))), "bad gap rejected");

const gb = F.GapBook(); const g = gb.add(1024, 24, 256);
ok(g.t0 === 1000 / 256 && g.t1 === 4, "gap of 24 before index 1024 spans [1000/256, 4]");
ok(gb.overlaps(3.95, 4.1) && !gb.overlaps(4.0, 5), "gap overlap test");
// stream time exact for 1 h of indices at every rate
for (const fs of [125, 250, 256]) {
  const c = F.makeClock(fs); let exact = true;
  for (let i = 0; i <= 3600 * fs; i += 997) if (c.idx(c.t(i)) !== i || c.t(i) !== i / fs) exact = false;
  ok(exact && c.t(3600 * fs) === 3600, "stream time exact over 1 h of indices at fs " + fs);
}
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
