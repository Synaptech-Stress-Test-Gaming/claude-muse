/* Tests for adapters/cyton-serial.js (the USB dongle read straight from the browser). Run: node adapters/cyton-serial.test.js
   Uses the module's fake dongle + board (fakePort), a manual clock and manual timers, so it runs in Node without hardware. */
"use strict";
const S = require("./cyton-serial.js");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* ---------- pure parts ---------- */
{
  const counts = [0, 1, -1, 8388607, -8388608, 123456, -654321, 42];
  const p = S.encodePacket(7, counts, [100, -50, 8000]);
  ok(p.length === 33 && p[0] === 0xA0 && p[1] === 7 && p[32] === 0xC0, "packet layout: 0xA0, sample number, ..., 0xC0");
  const P = S.Parser();
  const junk = Uint8Array.from([1, 2, 0xA0, 9]);                      // garbage before, including a false start byte
  const all = new Uint8Array(junk.length + 66); all.set(junk); all.set(p, 4); all.set(S.encodePacket(8, counts, null), 37);
  const a = P.push(all.slice(0, 20)), b = P.push(all.slice(20));       // split across reads
  ok(a.length === 0 && b.length === 2, "parser resyncs after garbage and joins packets split across reads");
  ok(Array.from(b[0].counts).join() === counts.join(), "24-bit signed counts round-trip (incl. +/- full scale)");
  ok(b[0].accel && b[0].accel.join() === "100,-50,8000" && b[1].accel === null, "accelerometer only when the aux bytes are non-zero");
  ok(near(S.uvPerCount(24), 0.02235, 0.00001), "scale: 4.5 V / 24 / (2^23-1) = 0.02235 uV per count");
  const fs = 125, x = Float32Array.from({ length: 188 }, (_, i) => 20 * Math.sin(2 * Math.PI * 31.25 * i / fs) + 5);
  ok(near(S.toneAmp(x, fs, 31.25), 20, 0.5), "31.25 Hz amplitude by one DFT bin");
  ok(near(S.kohmFromAmp(20 * Math.SQRT2 / Math.SQRT2), 3.33, 0.01), "lead-off: 20 uV peak / 6 nA = 3.3 kOhm");
}

/* ---------- a whole session against the fake board ---------- */
function harness(opts) {
  let now = 1000; const timers = [];
  const clock = { now: () => now, setTimeout: (f, ms) => { const t = { at: now + ms, f }; timers.push(t); return t; }, clearTimeout: t => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    setInterval: (f, ms) => { const t = { every: ms, at: now + ms, f }; timers.push(t); return t; }, clearInterval: t => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); } };
  const flushMicro = () => new Promise(r => setImmediate(r));
  async function advance(ms) {
    const end = now + ms;
    for (;;) {
      await flushMicro(); await flushMicro();
      const due = timers.filter(t => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      if (due.every) due.at += due.every; else timers.splice(timers.indexOf(due), 1);
      due.f();
    }
    now = end; await flushMicro(); await flushMicro();
  }
  const port = S.fakePort(Object.assign({ now: clock.now, auto: false }, opts));
  const frames = [], msgs = [], stat = [];
  const ad = S.create(Object.assign({ port, onFrame: f => frames.push(f), onMessage: m => msgs.push(m), onStatus: s => stat.push(s) }, clock));
  return { port, ad, frames, msgs, stat, advance, get now() { return now; } };
}
/* sample source: channel c carries a constant c*10 uV + 1 (ECG channel 1000 uV) so the order and the gains are checkable */
const level = c => c === 8 ? 1000 : c * 10 + 1;
const src = (i, leadOff) => { const v = new Float32Array(16); for (let c = 0; c < 16; c++) v[c] = level(c) + (leadOff[c] ? 30 * Math.sin(2 * Math.PI * 31.25 * i / 125) : 0); return v; };

(async () => {
  {
    const H = harness({ source: src });
    const started = H.ad.start();
    await H.advance(5000);
    ok(await started === true, "start(): opens the port, wakes the board (v), sets the channels, starts the stream");
    const w = H.port.writes;
    ok(w[0] === "s" && w[1] === "v" && w.includes("b") && w.indexOf("b") > w.indexOf("v"), "command order: s, v, channel settings, b");
    const xs = w.filter(s => s[0] === "x");
    ok(xs.length === 16 && xs[8] === "xQ050000X" && xs.filter((s, c) => c !== 8 && s === "x" + S.CODES[c] + "060110X").length === 15, "16 channel settings: EEG gain 24 + bias + SRB2; channel 9 (ECG) gain 12, no bias, no SRB2");
    const cfg = H.msgs.find(m => m.type === "config");
    ok(cfg && cfg.fs === 125 && cfg.ecgChannel === 8 && cfg.channels[8] === "ECG" && cfg.link === "dongle" && cfg.unusedChannels.length === 0, "config message: 125 Hz, 16 channels, ECG on index 8, link dongle");
    H.port.pump(50); await H.advance(10);
    ok(H.frames.length === 10 && H.frames.every(f => f.samples[0].length === 5), "50 samples -> 10 frames of 5 samples (40 ms)");
    const f = H.frames[3];
    ok(f.sampleIndex === 15 && f.channels.length === 16 && f.fs === 125 && f.device === "cyton", "frame fields: sampleIndex, 16 channels, fs");
    ok([0, 1, 7, 9, 15].every(c => near(f.samples[c][2], level(c), 0.05)), "Daisy pairing: channels 1-8 from odd packets, 9-16 from even packets, in order");
    ok(near(f.samples[8][0], 1000, 0.05) && f.ecg && f.ecg.channel === 8 && f.ecg.data === f.samples[8], "ECG channel scaled with gain 12 and passed as frame.ecg");
    ok(H.frames.some(x => x.accel && near(x.accel.xyz[2], 8000 * 0.002 / 16, 1e-6)), "accelerometer in g (0.002/16 g per count)");
    ok(H.stat.some(s => s.state === "streaming"), "status streaming once frames flow");
    // impedance sweep
    ok(H.ad.send("impedance_sweep") === true, "impedance_sweep accepted while streaming");
    for (let k = 0; k < 200; k++) { H.port.pump(Math.round(125 * 0.25)); await H.advance(250); }
    const imp = H.msgs.filter(m => m.type === "impedance"), done = H.msgs.find(m => m.type === "impedance_done");
    ok(imp.length === 15 && done && done.results.length === 15, "contact check: one result per EEG channel (15), then impedance_done");
    ok(imp.every(r => near(r.kohm, 5, 0.6)), "30 uV lead-off tone -> about 5 kOhm on every channel (" + imp.slice(0, 3).map(r => r.kohm).join(", ") + ")");
    ok(H.port.writes.filter(s => /^z.01Z$/.test(s)).length === 15 && H.port.writes.filter(s => /^z.00Z$/.test(s)).length === 15 && !H.port.writes.includes("zQ01Z"), "lead-off switched on and off per channel, never on the ECG channel");
    ok(H.frames.some(x => x.aux.flags.impedance) && !H.frames[H.frames.length - 1].aux.flags.impedance, "frames flagged during the sweep only");
    const sc = H.msgs.filter(m => m.type === "selfcheck").pop();
    ok(sc && sc.daisy === true && sc.nCh === 16 && sc.perChannel.length === 16 && sc.accel.present === true, "self-check message: Daisy, 16 channels, accelerometer present");
    const st = H.msgs.filter(m => m.type === "stats").pop();
    ok(st && st.lossPct === 0 && st.link === "dongle", "stats: 0% loss");
    await H.ad.stop(); await H.advance(10);
    ok(H.port.writes[H.port.writes.length - 1] === "s" && H.stat[H.stat.length - 1].state === "idle", "stop(): sends s and closes");
  }
  {
    const H = harness({ source: src, dropEvery: 10 });
    const started = H.ad.start(); await H.advance(5000); await started;
    H.port.pump(100); await H.advance(10);
    const gaps = H.frames.flatMap(f => f.gaps), lastF = H.frames[H.frames.length - 1];
    ok(gaps.length === 9 && gaps.every(g => g.n === 1), "a dropped packet pair leaves a 1-sample gap (9 gaps in 100 samples), never filled");
    ok(lastF.sampleIndex + lastF.samples[0].length === 96 && lastF.aux.flags.lostTotal === 9, "sample index keeps counting the lost samples (lostTotal 9; samples 96-99 wait for the next frame)");
    await H.advance(1000);
    const st = H.msgs.filter(m => m.type === "stats").pop();
    ok(st && near(st.lossPct, 9, 0.5), "lossPct about 9%");
    await H.ad.stop();
  }
  {
    const H = harness({ source: src, daisy: false });
    const started = H.ad.start(); await H.advance(5000); await started;
    const cfg = H.msgs.find(m => m.type === "config");
    ok(cfg && cfg.fs === 250 && cfg.ecgChannel === -1 && cfg.unusedChannels.length === 8 && H.port.writes.filter(s => s[0] === "x").length === 8, "no Daisy: 8 channels at 250 Hz, channels 9-16 unused, no ECG");
    ok(H.msgs.some(m => m.type === "error" && m.code === "no_daisy"), "no Daisy: says so");
    await H.ad.stop();
  }
  {
    const H = harness({ source: src, board: false });
    const started = H.ad.start(); await H.advance(6000);
    ok(await started === false && H.stat[H.stat.length - 1].state === "down" && /Switch the Cyton on/.test(H.stat[H.stat.length - 1].text), "dongle without a board: stops with 'Switch the Cyton on' after 4 s");
  }
  {
    const H = harness({ source: src });
    await H.port.open();                                                   // another program holds the port
    H.port.open = async () => { throw Object.assign(new Error("busy"), { name: "NetworkError" }); };
    const r = await H.ad.start();
    ok(r === false && /busy/.test(H.stat[H.stat.length - 1].text), "port in use: tells to close the OpenBCI GUI / helper");
  }
  {
    const H = harness({ source: src });
    const started = H.ad.start(); await H.advance(5000); await started;
    H.port.pump(20); await H.advance(3600);
    ok(H.stat.some(s => s.state === "lost"), "no packets for 3 s: status lost (and b is sent again)");
    H.port.pump(20); await H.advance(10);
    ok(H.stat[H.stat.length - 1].state === "streaming", "data again: streaming");
    await H.ad.stop();
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})();
