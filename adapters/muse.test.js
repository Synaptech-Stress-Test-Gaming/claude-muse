/* Tests for adapters/muse.js with a fake panel (S.pct, PL). Run: node adapters/muse.test.js */
"use strict";
const M = require("./muse.js"), Fr = require("../engine/frame.js");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }

let wall = 1e6;
const S = { pct: [80, 100, null, 41] };
const PL = { bp: new Float32Array(512), mk: new Uint8Array(512), bpPos: 0, filled: 0, state: "LIVE", bpm: 71 };
const frames = [];
const A = M.create({ onFrame: f => frames.push(f), now: () => wall, getContact: () => S.pct, getPL: () => PL });
const ys = [1, 2, 3, 4];
let idx = 1000;
for (let i = 0; i < 512; i++) { A.eeg(ys, idx++); wall += 1000 / 256; }
ok(frames.length === 0, "the first 2 s (512 samples) after a reset are skipped");
for (let i = 0; i < 120; i++) { A.eeg(ys, idx++); wall += 1000 / 256; }
ok(frames.length === 10 && frames.every(f => f.samples[0].length === 12), "frames have 12 samples (" + frames.length + " frames)");
ok(frames[0].sampleIndex === 512 && frames[1].sampleIndex === 524, "sampleIndex counts from the first index after reset");
frames.forEach(f => Fr.validate(f)); ok(true, "frames pass engine validation");
ok(JSON.stringify(frames[0].contact) === "[80,100,0,41]", "contact copies S.pct (null -> 0)");
ok(frames[0].aux.ppgHr === 71, "aux.ppgHr from PL.bpm while LIVE");
// gap: idx jumps by 24 -> 23 lost samples
const nBefore = frames.length; const last = idx - 1;
idx += 23; A.eeg(ys, idx++); for (let i = 0; i < 11; i++) A.eeg(ys, idx++);
const g = frames.slice(nBefore).find(f => f.gaps.length);
ok(g && g.gaps[0].n === 23 && g.gaps[0].at === g.sampleIndex && g.sampleIndex === last + 24 - 1000, "a jump of 24 in idx gives gaps:[{at, n:23}]");
// PPG: write 6 samples, two marked missing
PL.filled = 0; A.ppg();             // anchor
for (let k = 0; k < 6; k++) { PL.bp[PL.bpPos] = k + 1; PL.mk[PL.bpPos] = k === 2 || k === 3 ? 0 : 1; PL.bpPos = (PL.bpPos + 1) % 512; PL.filled++; }
A.ppg(); for (let i = 0; i < 12; i++) A.eeg(ys, idx++);
const pf = frames[frames.length - 1];
ok(pf.ppg && pf.ppg.data.length === 6 && isNaN(pf.ppg.data[2]) && isNaN(pf.ppg.data[3]) && pf.ppg.data[0] === 1 && pf.ppg.data[5] === 6, "PPG samples attach to the next frame, NaN marks pass through");
ok(pf.ppg.fs === 64 && isFinite(pf.ppg.t0), "PPG has fs 64 and a stream-time t0");
// motion
A.motion("acc", [0, 0, 1, 0, 0, 1, 0, 0, 1], wall); A.motion("gyro", [1, 2, 3, 1, 2, 3, 1, 2, 3], wall);
for (let i = 0; i < 12; i++) A.eeg(ys, idx++);
const mf = frames[frames.length - 1];
ok(mf.accel && mf.accel.t.length === 3 && mf.gyro && mf.gyro.xyz[1] === 2, "accelerometer and gyro samples attach to the next frame");
ok(Math.abs(mf.accel.t[2] - mf.accel.t[0] - 2 / 52) < 1e-9, "motion sample times spaced 1/52 s");
// PPG path reset: filled shrinks -> buffer dropped
PL.filled = 1; A.ppg(); ok(A.state.ppgQ.length === 0, "PPG reset (filled shrank) drops the pulse buffer");
// reset bumps streamId
const sid = A.streamId; A.reset(); ok(A.streamId === sid + 1, "reset bumps streamId");
frames.length = 0; for (let i = 0; i < 524; i++) A.eeg(ys, 5000 + i); ok(frames.length === 1 && frames[0].streamId === sid + 1 && frames[0].sampleIndex === 512, "after reset frames carry the new streamId");
// index going backwards = new stream
frames.length = 0; for (let i = 0; i < 524; i++) A.eeg(ys, 10 + i); ok(frames.length === 1 && frames[0].streamId === sid + 2, "an index that goes backwards starts a new stream");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
