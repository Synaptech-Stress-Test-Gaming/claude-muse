/* Tests for adapters/cyton.js. Run: node adapters/cyton.test.js */
"use strict";
const fs = require("fs"), path = require("path");
const C = require("./cyton.js"), Fr = require("../engine/frame.js");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }

/* encoder (same layout as tools/cyton_helper.py encode_frame) used when the reference file is missing */
function encode(data, accel, si, ts, lost, fsv, flags) {
  const Cn = data.length, N = data[0].length, A = accel.length, buf = new ArrayBuffer(32 + 4 * Cn * N + 16 * A), dv = new DataView(buf);
  dv.setUint8(0, 0xCB); dv.setUint8(1, 1); dv.setUint8(2, 1); dv.setUint8(3, Cn); dv.setUint16(4, N, true); dv.setUint8(6, A); dv.setUint8(7, flags | (A ? 1 : 0));
  dv.setBigUint64(8, BigInt(si), true); dv.setFloat64(16, ts, true); dv.setUint32(24, lost, true); dv.setFloat32(28, fsv, true);
  for (let c = 0; c < Cn; c++) for (let i = 0; i < N; i++) dv.setFloat32(32 + 4 * (c * N + i), data[c][i], true);
  let o = 32 + 4 * Cn * N; for (const [off, x, y, z] of accel) { dv.setUint16(o, off, true); dv.setUint16(o + 2, 0, true); dv.setFloat32(o + 4, x, true); dv.setFloat32(o + 8, y, true); dv.setFloat32(o + 12, z, true); o += 16; }
  return buf;
}
const refData = Array.from({ length: 16 }, (_, c) => Array.from({ length: 4 }, (_, i) => c * 10 + i + 0.25));
let buf;
const hexPath = path.join(__dirname, "..", "tools", "testdata", "frame_v1.hex");
if (fs.existsSync(hexPath)) { const b = Buffer.from(fs.readFileSync(hexPath, "utf8").trim(), "hex"); buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); console.log("using tools/testdata/frame_v1.hex"); }
else { buf = encode(refData, [[0, 0.5, -0.25, 1.0], [3, 0.125, 0.0, -1.0]], 1000, 1731490000.5, 7, 125, 4 | 2); console.log("tools/testdata/frame_v1.hex missing: regenerated the same frame with the test's own encoder"); }

const cfg = { streamId: 3, channels: ["Fp1", "Fp2", "C3", "C4", "P7", "P8", "O1", "O2", "ECG", "F8", "F3", "F4", "T7", "T8", "P3", "P4"], ecgChannel: 8 };
const d = C.decodeFrame(buf, cfg);
ok(d.C === 16 && d.N === 4 && d.A === 2 && d.sampleIndex === 1000 && d.lostTotal === 7 && d.fs === 125 && d.boardTs === 1731490000.5, "header decodes to the known values");
let exact = true; for (let c = 0; c < 16; c++) for (let i = 0; i < 4; i++) if (d.frame.samples[c][i] !== c * 10 + i + 0.25) exact = false;
ok(exact, "all 64 samples decode exactly (c*10 + i + 0.25)");
ok(d.frame.accel && d.frame.accel.t[1] === 1003 / 125 && d.frame.accel.xyz[0] === 0.5 && d.frame.accel.xyz[1] === -0.25 && d.frame.accel.xyz[5] === -1, "accel block: t = (sampleIndex + offset)/fs, xyz exact");
ok(d.frame.ecg && d.frame.ecg.channel === 8 && d.frame.ecg.data[0] === 80.25, "ECG channel from config copied into frame.ecg");
ok(d.frame.aux.flags.simulated && d.frame.aux.flags.gapFlag && !d.frame.aux.flags.impedance, "flags decoded");
ok(Fr.validate(d.frame), "decoded frame passes engine validation");
const throws = fn => { try { fn(); return false; } catch (e) { return true; } };
ok(throws(() => C.decodeFrame(buf.slice(0, buf.byteLength - 1), cfg)), "truncated buffer rejected");
{ const b2 = buf.slice(0); new DataView(b2).setUint8(0, 0xCA); ok(throws(() => C.decodeFrame(b2, cfg)), "bad magic rejected"); }
{ const b2 = buf.slice(0); new DataView(b2).setUint8(1, 2); ok(throws(() => C.decodeFrame(b2, cfg)), "bad version rejected"); }
{ const imp = C.decodeFrame(encode(refData, [], 0, 0, 0, 125, 16), cfg); ok(imp.frame.aux.flags.impedance, "flag bit4 -> aux.flags.impedance"); }

// fake WebSocket: frames, sampleIndex jump -> gap, close -> retry + "helper is not running"
const timers = [], sockets = [];
class FakeWS { constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); } send(m) { this.sent.push(m); } close() { this.readyState = 3; if (this.onclose) this.onclose(); } }
const statuses = [], frames = [];
const A = C.create({ WebSocket: FakeWS, setTimeout: (f, ms) => timers.push({ f, ms }), onFrame: f => frames.push(f), onStatus: s => statuses.push(s) });
A.start();
const ws = sockets[0]; ws.readyState = 1; ws.onopen();
ws.onmessage({ data: JSON.stringify(Object.assign({ type: "config", fs: 125 }, cfg)) });
ws.onmessage({ data: encode(refData, [], 0, 0, 0, 125, 0) });
ws.onmessage({ data: encode(refData, [], 4, 0, 0, 125, 0) });
ws.onmessage({ data: encode(refData, [], 20, 0, 12, 125, 2) });
ok(frames.length === 3 && frames[1].gaps.length === 0 && frames[2].gaps.length === 1 && frames[2].gaps[0].at === 20 && frames[2].gaps[0].n === 12, "a sampleIndex jump becomes gaps:[{at:20, n:12}]");
ok(frames[2].streamId === 3 && statuses.some(s => s.state === "streaming"), "frames carry the config's streamId; state streaming");
ok(A.send("ping") && JSON.parse(ws.sent[0]).cmd === "ping", "send() writes a cmd message");
// new stream id resets the expected index
ws.onmessage({ data: JSON.stringify(Object.assign({}, cfg, { type: "config", streamId: 4 })) });
ws.onmessage({ data: encode(refData, [], 0, 0, 0, 125, 0) });
ok(frames[3].gaps.length === 0 && frames[3].streamId === 4, "a new config streamId resets the adapter (no false gap)");
ws.close();
ok(timers.length === 1 && timers[0].ms === 2000 && statuses[statuses.length - 1].text === "Lost signal, retrying", "close after streaming -> retry in 2 s, 'Lost signal, retrying'");
timers.shift().f(); const ws2 = sockets[1]; ws2.close();
ok(statuses[statuses.length - 1].text === C.NOT_RUNNING && timers.length === 1, "socket that never opens -> retry + the 'helper is not running' text");
ok(C.NOT_RUNNING === 'Cyton helper is not running. Double-click "Open Cyton Helper.bat" in the project folder, or run: python tools/cyton_helper.py', "exact helper-not-running wording");
A.stop(); ok(A.state.state === "idle", "stop() -> idle");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
