/* adapters/cyton-serial.js
   OpenBCI Cyton (+ Daisy) straight from the USB dongle in the browser (Web Serial, Chrome / Edge): no helper, no Python.
   The panel's Connect button asks the browser for the dongle (navigator.serial.requestPort, FTDI vendor 0x0403); later visits reuse
   the port the browser already allowed (navigator.serial.getPorts), like the Muse's Bluetooth reconnect.
   Board protocol (OpenBCI Cyton serial, 115200 baud, as in BrainFlow's cyton_daisy.cpp):
     "v" soft reset, the board answers with text ending in "$$$" (it names "Daisy" when the Daisy is seated);
     "x<ch><power><gain><input><bias><srb2><srb1>X" channel settings (answer "...$$$"); "b" start, "s" stop;
     "z<ch><p><n>Z" lead-off current for the contact check.
     Packet: 33 bytes = 0xA0, sample number (u8), 8 x 24-bit signed big-endian counts, 6 aux bytes, end byte 0xC0-0xC6.
     End byte 0xC0: the aux bytes are 3 x 16-bit accelerometer counts (x 0.002/16 g; all zero on most packets, about 25 Hz).
     Daisy: packets alternate; an even sample number carries channels 9-16 (Daisy), the next odd one channels 1-8 (Cyton);
     one even + odd pair is one 16-channel sample at 125 Hz. Without the Daisy every packet is one 8-channel sample at 250 Hz.
   Scaling: uV = counts x 4.5 V / gain / (2^23 - 1) x 1e6. EEG channels: gain 24, bias and SRB2 on ("x?060110X").
   Channel 9 (index 8, the Daisy's F7 pins) is the ECG: gain 12, bias and SRB2 off ("xQ050000X"), like tools/cyton_helper.py.
   Output: the same frames (40 ms) and helper-style messages (hello, status, config, selfcheck, stats, impedance, impedance_done, error)
   as adapters/cyton.js, so the rest of the panel does not care where the data came from. Lost samples are never filled: they leave
   a gap (frame.gaps) and count in lossPct.
   UMD: MuseEngine.Adapters.CytonSerial. Tested by adapters/cyton-serial.test.js with a fake port. */
"use strict";
(function (root) {
  const E = root.MuseEngine = root.MuseEngine || {};
  E.Adapters = E.Adapters || {};
  const CODES = "12345678QWERTYUI";
  const NAMES = ["Fp1", "Fp2", "C3", "C4", "P7", "P8", "O1", "O2", "ECG", "F8", "F3", "F4", "T7", "T8", "P3", "P4"];
  const NAMES_8 = ["Fp1", "Fp2", "C3", "C4", "P7", "P8", "O1", "O2", "F7", "F8", "F3", "F4", "T7", "T8", "P3", "P4"];
  const ECG = 8, GAIN_EEG = 24, GAIN_ECG = 12, RAIL_UV = 187500;
  const ACC_G = 0.002 / 16;
  const FTDI_VID = 0x0403;
  const uvPerCount = gain => 4.5 / gain / 8388607 * 1e6;
  const TEXT = {
    inUse: "The USB dongle is busy. Close the OpenBCI GUI (and any Cyton helper window), then press Connect again.",
    noBoard: "The dongle answers but the board does not. Switch the Cyton on (switch to PC) and press Connect again.",
    lost: "No data from the board for 3 seconds. Is it still switched on and within a few metres of the dongle?",
    unplugged: "The USB dongle was unplugged.",
    noDaisy: "Daisy board not found: running with 8 channels (no ECG).",
    ftdiFix: "Windows Device Manager → Ports (COM & LPT) → USB Serial Port (COMx) → Properties → Port Settings → Advanced → Latency Timer (msec): set to 1 → OK. Then unplug and replug the dongle."
  };

  function int24(b, o) { let v = (b[o] << 16) | (b[o + 1] << 8) | b[o + 2]; if (v & 0x800000) v -= 0x1000000; return v; }
  function int16(b, o) { let v = (b[o] << 8) | b[o + 1]; if (v & 0x8000) v -= 0x10000; return v; }

  /* pure: the byte stream -> packets {sample, counts: Int32Array(8), accel: [x,y,z] counts | null, end}. Resyncs on 0xA0 ... 0xC? */
  function Parser() {
    let buf = new Uint8Array(0);
    return {
      push(chunk) {
        const b = new Uint8Array(buf.length + chunk.length); b.set(buf, 0); b.set(chunk, buf.length);
        const out = []; let i = 0;
        while (i + 33 <= b.length) {
          if (b[i] !== 0xA0 || b[i + 32] < 0xC0 || b[i + 32] > 0xC6) { i++; continue; }
          const counts = new Int32Array(8); for (let c = 0; c < 8; c++) counts[c] = int24(b, i + 2 + 3 * c);
          let accel = null;
          if (b[i + 32] === 0xC0) { const a = [int16(b, i + 26), int16(b, i + 28), int16(b, i + 30)]; if (a[0] || a[1] || a[2]) accel = a; }
          out.push({ sample: b[i + 1], counts, accel, end: b[i + 32] }); i += 33;
        }
        buf = b.slice(i);
        return out;
      },
      reset() { buf = new Uint8Array(0); }
    };
  }

  /* pure (tests and the in-browser fake board): one packet as bytes */
  function encodePacket(sample, counts, accel) {
    const b = new Uint8Array(33); b[0] = 0xA0; b[1] = sample & 255;
    for (let c = 0; c < 8; c++) { const v = Math.max(-8388608, Math.min(8388607, Math.round(counts[c] || 0))) & 0xFFFFFF; b[2 + 3 * c] = v >> 16; b[3 + 3 * c] = (v >> 8) & 255; b[4 + 3 * c] = v & 255; }
    if (accel) for (let k = 0; k < 3; k++) { const v = accel[k] & 0xFFFF; b[26 + 2 * k] = v >> 8; b[27 + 2 * k] = v & 255; }
    b[32] = 0xC0; return b;
  }

  /* 31.25 Hz amplitude by a single DFT bin (the lead-off current frequency) */
  function toneAmp(x, fs, f) {
    let re = 0, im = 0, m = 0; for (let i = 0; i < x.length; i++) m += x[i]; m /= x.length || 1;
    const w = 2 * Math.PI * f / fs; for (let i = 0; i < x.length; i++) { re += (x[i] - m) * Math.cos(w * i); im += (x[i] - m) * Math.sin(w * i); }
    return 2 * Math.sqrt(re * re + im * im) / (x.length || 1);
  }
  /* OpenBCI lead-off: 6 nA at 31.25 Hz; R = V_peak / I (kOhm) */
  const kohmFromAmp = ampUv => ampUv * 1e-6 / 6e-9 / 1000;

  function create(o) {
    o = Object.assign({ port: null, onFrame: null, onMessage: null, onStatus: null, now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: id => clearTimeout(id),
      setInterval: (f, ms) => setInterval(f, ms), clearInterval: id => clearInterval(id), frameMs: 40, replyMs: { v: 4000, x: 1500 }, settleMs: 60, mains: 60 }, o);
    const S = { state: "idle", stopped: true, port: o.port, reader: null, writer: null, text: "", textWait: null, parser: Parser(), daisy: true, fs: 125, chans: 16,
      streamId: 0, idx: 0, last: null, step: 2, pend: null, cur: null, gap: null, lostTotal: 0, frames: 0, hist: [], lastPacket: 0, chunkTs: [], timer: null,
      ring: null, ringPos: 0, ringN: 0, accelSeen: false, imp: null, scAt: 0, selfcheck: null, cfg: null, warnings: [], errors: [] };
    const status = (state, text, fix) => { S.state = state; if (o.onStatus) o.onStatus({ state, text: text || "", fix: fix || null }); };
    const msg = m => { if (o.onMessage) o.onMessage(m); };
    const sleep = ms => new Promise(r => o.setTimeout(r, ms));
    const enc = s => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; };
    async function write(s) { if (!S.writer) return false; try { await S.writer.write(enc(s)); return true; } catch (e) { return false; } }
    /* send a text command and wait for the board's "$$$" (or the time limit); returns the reply text ("" when none came) */
    function command(s, ms) {
      S.text = "";
      return new Promise(res => {
        const done = () => { if (!S.textWait) return; o.clearTimeout(S.textWait.t); S.textWait = null; res(S.text); };
        S.textWait = { done, t: o.setTimeout(done, ms) };
        write(s).then(ok => { if (!ok) done(); });
      });
    }
    function onBytes(chunk) {
      if (S.mode === "text") {
        for (let i = 0; i < chunk.length; i++) S.text += String.fromCharCode(chunk[i]);
        if (S.textWait && S.text.indexOf("$$$") >= 0) S.textWait.done();
        return;
      }
      const pk = S.parser.push(chunk); if (!pk.length) return;
      const now = o.now(); S.lastPacket = now; S.chunkTs.push(now); if (S.chunkTs.length > 400) S.chunkTs.shift();
      for (const p of pk) packet(p);
    }
    async function readLoop() {
      const port = S.port;
      while (!S.stopped && port.readable) {
        let reader; try { reader = port.readable.getReader(); } catch (e) { break; }
        S.reader = reader;
        try { for (;;) { const { value, done } = await reader.read(); if (done) break; if (value && value.length) onBytes(value); } }
        catch (e) { if (!S.stopped) { S.errors.push(String(e && e.message || e)); fail("down", TEXT.unplugged, "Plug the dongle back in and press Connect."); } }
        finally { try { reader.releaseLock(); } catch (e) {} S.reader = null; }
        if (S.stopped) break;
      }
    }
    function fail(state, text, fix) {
      if (S.stopped) return; S.stopped = true; clearTimers();
      msg({ type: "error", code: "serial", message: text, fix: fix || null });
      status(state, text, fix);
      closePort();
    }

    /* ---------- packets -> samples -> frames ---------- */
    const scale = c => uvPerCount(c === ECG && S.daisy ? GAIN_ECG : GAIN_EEG);
    function packet(p) {
      if (!S.daisy) return sample(p.sample, 1, p.counts, null, p.accel);
      if (p.sample % 2 === 0) { S.pend = p; return; }
      const dz = S.pend && ((S.pend.sample + 1) & 255) === p.sample ? S.pend : null; S.pend = null;
      let acc = p.accel; if (dz && dz.accel) acc = acc ? acc.map((v, k) => (v + dz.accel[k]) / 2) : dz.accel;
      if (!dz) return lose(p.sample, 2);                                  // the Daisy half is missing: the sample is lost, not filled
      sample(p.sample, 2, p.counts, dz.counts, acc);
    }
    function advance(seq, step) {
      if (S.last == null) { S.last = seq; return 0; }
      const d = (seq - S.last + 256) % 256; S.last = seq;
      if (d === 0) return -1;                                             // repeated packet
      const lost = Math.max(0, Math.round(d / step) - 1);
      if (lost) { flush(); S.gap = { at: S.idx, n: lost }; S.idx += lost; S.lostTotal += lost; S.hist.push({ t: o.now(), r: 0, l: lost }); }
      return lost;
    }
    function lose(seq, step) { if (advance(seq, step) < 0) return; flush(); S.gap = S.gap || { at: S.idx, n: 0 }; S.gap.n++; S.idx++; S.lostTotal++; S.hist.push({ t: o.now(), r: 0, l: 1 }); }
    function sample(seq, step, cy, dz, acc) {
      if (advance(seq, step) < 0) return;
      if (!S.cur) S.cur = { si: S.idx, x: [], acc: [] };
      const v = new Float32Array(16);
      for (let c = 0; c < 8; c++) v[c] = cy[c] * scale(c);
      if (dz) for (let c = 0; c < 8; c++) v[8 + c] = dz[c] * scale(8 + c);
      S.cur.x.push(v);
      if (acc) { S.accelSeen = true; S.cur.acc.push([S.idx, acc[0] * ACC_G, acc[1] * ACC_G, acc[2] * ACC_G]); }
      for (let c = 0; c < 16; c++) S.ring[c][S.ringPos] = v[c];
      S.ringPos = (S.ringPos + 1) % S.ring[0].length; S.ringN++;
      S.idx++; S.hist.push({ t: o.now(), r: 1, l: 0 });
      if (S.cur.x.length >= S.frameN) flush();
    }
    function flush() {
      const cur = S.cur; S.cur = null; if (!cur || !cur.x.length) return;
      const N = cur.x.length, fs = S.fs, samples = [];
      for (let c = 0; c < 16; c++) { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = cur.x[i][c]; samples.push(a); }
      let accel = null;
      if (cur.acc.length) { const t = new Float64Array(cur.acc.length), xyz = new Float32Array(3 * cur.acc.length);
        cur.acc.forEach((a, k) => { t[k] = a[0] / fs; xyz[3 * k] = a[1]; xyz[3 * k + 1] = a[2]; xyz[3 * k + 2] = a[3]; }); accel = { fs: 25, t, xyz }; }
      const ecgCh = S.cfg ? S.cfg.ecgChannel : -1, gap = S.gap; S.gap = null;
      const f = { device: "cyton", streamId: S.streamId, fs, channels: S.cfg.channels.slice(), sampleIndex: cur.si, t0: cur.si / fs, samples, gaps: gap ? [{ at: gap.at, n: gap.n }] : [], accel, gyro: null, ppg: null,
        ecg: ecgCh >= 0 ? { fs, data: samples[ecgCh], channel: ecgCh } : null, contact: null,
        aux: { ppgHr: null, flags: { impedance: !!S.imp, simulated: false, decimated: false, gapFlag: !!gap, boardTs: o.now() / 1000, lostTotal: S.lostTotal } } };
      S.frames++;
      if (S.state !== "streaming" && !S.stopped) status("streaming", "Streaming from the USB dongle");
      if (o.onFrame) o.onFrame(f);
    }

    /* ---------- checks (the helper's self-check, the parts the panel uses) ---------- */
    function recent(c, n) { const R = S.ring[c], L = R.length; n = Math.min(n, S.ringN, L); const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = R[(S.ringPos - n + i + L) % L]; return x; }
    function stats() {
      const now = o.now(); while (S.hist.length && now - S.hist[0].t > 10000) S.hist.shift();
      let r = 0, l = 0; for (const h of S.hist) { r += h.r; l += h.l; }
      return { type: "stats", fs: S.fs, lossPct: Math.round(100000 * l / Math.max(1, r + l)) / 1000, lostTotal: S.lostTotal, link: "dongle", uptimeS: Math.round((now - S.t0) / 100) / 10, clientDrops: 0 };
    }
    function selfcheck() {
      const fs = S.fs, n = Math.round(fs * 8), per = [], warns = S.warnings.slice();
      const eeg = []; for (let c = 0; c < S.chans; c++) if (!(S.daisy && c === ECG)) eeg.push(c);
      for (let c = 0; c < 16; c++) {
        const x = recent(c, n); let rail = 0, m = 0; for (const v of x) { if (Math.abs(v) >= 0.95 * RAIL_UV) rail++; m += v; } m /= x.length || 1;
        let d2 = 0; for (let i = 1; i < x.length; i++) { const d = x[i] - x[i - 1]; d2 += d * d; }
        const rms = Math.sqrt(d2 / Math.max(1, x.length - 1) / 2);
        per.push({ name: S.cfg.channels[c], railed: rail / Math.max(1, x.length) > 0.02, flat: c < S.chans && rms < 0.5, rmsUv: Math.round(rms * 100) / 100, lineRatio: 0 });
      }
      // at 125 Hz the 120 Hz mains harmonic folds to 5 Hz (25 Hz at 50 Hz mains)
      let alias = { checked: false, freqHz: null, ratio: null, warn: false };
      if (Math.abs(fs - 125) < 1 && S.ringN >= n) {
        const f = o.mains === 60 ? 5 : 25, ratios = eeg.map(c => { const x = recent(c, n), p = toneAmp(x, fs, f) ** 2;
          const side = [-1.75, -1.25, -1, 1, 1.25, 1.75].map(df => toneAmp(x, fs, f + df) ** 2); return p / Math.max(1e-12, side.reduce((a, b) => a + b, 0) / side.length); }).sort((a, b) => a - b);
        alias = { checked: true, freqHz: f, ratio: Math.round(ratios[ratios.length >> 1] * 100) / 100, warn: ratios.filter(r => r > 4).length / Math.max(1, ratios.length) >= 0.25 };
        if (alias.warn) warns.push("Mains hum folds into theta at 125 Hz (" + f + " Hz). Theta-based scores get lower confidence.");
      }
      // FTDI latency: data arriving in bursts 10 ms or more apart
      const d = []; for (let i = 1; i < S.chunkTs.length; i++) { const v = S.chunkTs[i] - S.chunkTs[i - 1]; if (v > 2) d.push(v); } d.sort((a, b) => a - b);
      // measured only: the browser hands serial data over in batches whatever the FTDI latency timer is, so no warning from it here
      const burst = d.length ? d[d.length >> 1] : 0, ftdi = { checked: S.chunkTs.length > 20, burstMs: Math.round(burst * 100) / 100, warn: false, fix: null };
      const railed = per.filter((p, c) => c < S.chans && p.railed && !(S.daisy && c === ECG)).map(p => p.name);
      if (railed.length && railed.length < eeg.length) warns.push("No signal on " + railed.join(", ") + ": the electrode is not touching the scalp.");
      const st = stats();
      const sc = { type: "selfcheck", daisy: S.daisy, nCh: S.chans, perChannel: per, accel: { present: S.accelSeen, reason: S.accelSeen ? null : "no accelerometer data yet" },
        rate: { requested: S.daisy ? 125 : 250, measured: fs, lossPct: st.lossPct }, alias, ftdi,
        ecg: { configured: S.daisy ? 9 : 0, detected: S.daisy, channel: S.daisy ? 9 : 0, kurtosis: null, acPeak: null, bpm: null, moved: false }, warnings: [...new Set(warns)] };
      S.selfcheck = sc; msg(sc);
    }
    function tick() {
      if (S.stopped || S.mode !== "stream") return;
      const now = o.now();
      msg(stats());
      if (now - S.lastPacket > 3000) { if (S.state !== "lost") { status("lost", TEXT.lost); write("b"); } }
      if (now >= S.scAt && S.ringN >= S.fs * 3) { selfcheck(); S.scAt = now + (now - S.t0 < 20000 ? 5000 : 10000); }
      if (S.imp) impStep(now);
    }

    /* ---------- contact check: lead-off current on one channel at a time, 31.25 Hz amplitude -> kOhm ---------- */
    function impStep(now) {
      const im = S.imp; if (im.busy) return;
      const eeg = []; for (let c = 0; c < S.chans; c++) if (!(S.daisy && c === ECG)) eeg.push(c);
      if (im.k >= eeg.length) { S.imp = null; msg({ type: "impedance_done", results: im.results }); status("streaming", "Streaming from the USB dongle"); return; }
      const c = eeg[im.k];
      if (im.phase === "on") { im.busy = true; write("z" + CODES[c] + "01Z").then(() => { im.busy = false; im.phase = "wait"; im.t = o.now(); }); }
      else if (im.phase === "wait" && now - im.t >= 500) { im.phase = "collect"; im.t = now; im.n0 = S.ringN; }
      else if (im.phase === "collect" && now - im.t >= 1500) {
        const n = Math.min(S.ringN - im.n0, Math.round(S.fs * 1.5)), x = recent(c, n), amp = n > 16 ? toneAmp(x, S.fs, 31.25) : 0;
        const r = { type: "impedance", channel: c, name: S.cfg.channels[c], kohm: Math.round(kohmFromAmp(amp) * 10) / 10, rmsUv: Math.round(amp / Math.SQRT2 * 100) / 100 };
        im.results.push(r); msg(r);
        im.busy = true; write("z" + CODES[c] + "00Z").then(() => { im.busy = false; im.k++; im.phase = "on"; });
      }
    }

    /* ---------- lifecycle ---------- */
    function clearTimers() { if (S.timer != null) o.clearInterval(S.timer); S.timer = null; }
    async function closePort() {
      try { if (S.reader) await S.reader.cancel(); } catch (e) {}
      try { if (S.writer) { S.writer.releaseLock(); } } catch (e) {} S.writer = null;
      try { if (S.port) await S.port.close(); } catch (e) {}
    }
    async function start() {
      if (!S.port) { status("down", "No USB dongle chosen."); return false; }
      S.stopped = false; S.streamId++; S.idx = 0; S.last = null; S.pend = null; S.cur = null; S.gap = null; S.lostTotal = 0; S.hist = []; S.chunkTs = []; S.warnings = []; S.accelSeen = false; S.imp = null;
      S.parser.reset(); S.mode = "text";
      status("connecting", "Opening the USB dongle…");
      try { await S.port.open({ baudRate: 115200, bufferSize: 65536 }); }
      catch (e) { if (!(e && e.name === "InvalidStateError")) { fail("down", TEXT.inUse, null); return false; } }   // InvalidStateError: already open
      try { S.writer = S.port.writable.getWriter(); } catch (e) { fail("down", TEXT.inUse, null); return false; }
      readLoop();
      await write("s"); await sleep(o.settleMs); S.text = "";
      msg({ type: "hello", proto: 1, helper: "browser (Web Serial)", version: "1.0", simulated: false });
      status("connecting", "Waking the board…");
      const v = await command("v", o.replyMs.v);
      if (S.stopped) return false;
      if (!v || /failed to poll host/i.test(v) || !/\$\$\$/.test(v)) { fail("down", TEXT.noBoard, null); return false; }
      S.daisy = /daisy/i.test(v); S.chans = S.daisy ? 16 : 8; S.fs = S.daisy ? 125 : 250; S.step = S.daisy ? 2 : 1;
      S.frameN = Math.max(1, Math.round(S.fs * o.frameMs / 1000));
      S.ring = Array.from({ length: 16 }, () => new Float32Array(Math.round(S.fs * 10))); S.ringPos = 0; S.ringN = 0;
      if (!S.daisy) S.warnings.push(TEXT.noDaisy);
      status("connecting", "Setting up " + S.chans + " channels…");
      for (let c = 0; c < S.chans && !S.stopped; c++) await command("x" + CODES[c] + (S.daisy && c === ECG ? "050000" : "060110") + "X", o.replyMs.x);
      if (S.stopped) return false;
      S.cfg = { type: "config", streamId: S.streamId, fs: S.fs, boardFs: 250, decim: 1, channels: (S.daisy ? NAMES : NAMES_8).slice(), ecgChannel: S.daisy ? ECG : -1,
        unusedChannels: S.daisy ? [] : [8, 9, 10, 11, 12, 13, 14, 15], accel: true, link: "dongle", mains: o.mains, gainEeg: GAIN_EEG, gainEcg: GAIN_ECG };
      if (!S.daisy) msg({ type: "error", code: "no_daisy", message: "The Daisy board was not found. Running with 8 channels.", fix: "Check that the Daisy board is seated on the Cyton." });
      msg(S.cfg);
      S.mode = "stream"; S.t0 = o.now(); S.lastPacket = S.t0; S.scAt = S.t0 + 3000;
      await write("b");
      msg({ type: "status", state: "streaming", link: "dongle", detail: "USB dongle " + S.fs + " Hz", t: S.t0 / 1000 });
      S.timer = o.setInterval(tick, 250);
      return true;
    }
    async function stop() {
      if (S.stopped && S.state === "idle") return;
      const wasStreaming = S.mode === "stream";
      S.stopped = true; clearTimers(); S.mode = "text";
      if (wasStreaming) { await write("s"); }
      await closePort();
      status("idle", "Disconnected");
    }
    function send(cmd) {
      if (cmd === "impedance_sweep") { if (S.mode !== "stream" || S.imp) return false; S.imp = { k: 0, phase: "on", t: o.now(), results: [], busy: false }; status("streaming", "Checking contact"); msg({ type: "status", state: "impedance", link: "dongle", detail: "contact check running", t: o.now() / 1000 }); return true; }
      if (cmd === "stop_impedance") { if (!S.imp) return false; const c = S.imp; S.imp = null; msg({ type: "impedance_done", results: c.results }); return true; }
      if (cmd === "ping") { msg({ type: "pong" }); return true; }
      return false;
    }
    return { start, stop, send, tick, state: S, get config() { return S.cfg; } };
  }

  /* the browser side: ask for a dongle (needs a click) or reuse one this browser already allowed */
  async function knownPort(serial) {
    serial = serial || (root.navigator && root.navigator.serial); if (!serial) return null;
    try { const ps = await serial.getPorts(); return ps.find(p => { const i = p.getInfo ? p.getInfo() : {}; return !i.usbVendorId || i.usbVendorId === FTDI_VID; }) || null; } catch (e) { return null; }
  }
  async function choosePort(serial) {
    serial = serial || (root.navigator && root.navigator.serial); if (!serial) return null;
    try { return await serial.requestPort({ filters: [{ usbVendorId: FTDI_VID }] }); } catch (e) { return null; }      // cancelled: null
  }
  const supported = () => !!(root.navigator && root.navigator.serial);

  /* a fake dongle + board for ?demo=1&link=dongle and the tests: answers v / x / z / b / s and streams packets from a sample source */
  function fakePort(o) {
    o = Object.assign({ daisy: true, board: true, source: null, setInterval: (f, ms) => setInterval(f, ms), clearInterval: id => clearInterval(id), now: () => Date.now(), dropEvery: 0 }, o);
    const q = [], waiters = []; let timer = null, seq = 0, n = 0, opened = false, t0 = 0, sent = 0;
    const push = b => { if (waiters.length) waiters.shift()({ value: b, done: false }); else q.push(b); };
    const txt = s => push(Uint8Array.from(s, ch => ch.charCodeAt(0) & 255));
    const P = { writes: [], leadOff: {},
      async open() { if (opened) { const e = new Error("open"); e.name = "InvalidStateError"; throw e; } opened = true; },
      async close() { opened = false; if (timer != null) o.clearInterval(timer); timer = null; while (waiters.length) waiters.shift()({ value: undefined, done: true }); },
      getInfo() { return { usbVendorId: FTDI_VID, usbProductId: 0x6015 }; },
      get readable() { return opened ? { getReader() { return { read: () => q.length ? Promise.resolve({ value: q.shift(), done: false }) : new Promise(r => waiters.push(r)), releaseLock() {}, async cancel() { while (waiters.length) waiters.shift()({ value: undefined, done: true }); } }; } } : null; },
      get writable() { return opened ? { getWriter() { return { async write(b) { const s = String.fromCharCode(...b); P.writes.push(s); onCmd(s); }, releaseLock() {} }; } } : null; },
      pump
    };
    function onCmd(s) {
      if (!o.board) return;
      if (s === "v") txt("OpenBCI V3 8-16 channel\nOn Board ADS1299 Device ID: 0x3E\n" + (o.daisy ? "On Daisy ADS1299 Device ID: 0x3E\n" : "") + "LIS3DH Device ID: 0x33\nFirmware: v3.1.2\n$$$");
      else if (/^x.{7}X$/.test(s)) txt("Success: Channel set for " + (CODES.indexOf(s[1]) + 1) + "$$$");
      else if (/^z.{3}Z$/.test(s)) P.leadOff[CODES.indexOf(s[1])] = s[2] === "1" || s[3] === "1";
      else if (s === "b") { t0 = o.now(); sent = 0; if (o.setInterval && o.auto !== false) timer = o.setInterval(() => pump(), 20); }
      else if (s === "s") { if (timer != null) o.clearInterval(timer); timer = null; }
    }
    /* send due samples (or k samples when given): source(i) -> Float32Array(16) uV */
    function pump(k) {
      const fs = o.daisy ? 125 : 250, due = k != null ? sent + k : Math.floor((o.now() - t0) / 1000 * fs);
      const parts = [];
      while (sent < due) {
        const i = sent++, v = o.source ? o.source(i, P.leadOff) : new Float32Array(16), acc = i % 5 === 0 ? [100, -50, 8000] : null;
        const cnt = c => v[c] / uvPerCount(o.daisy && c === ECG ? GAIN_ECG : GAIN_EEG);
        const drop = o.dropEvery && i > 0 && i % o.dropEvery === 0;
        if (o.daisy) { const sD = (2 * n) & 255, sC = (2 * n + 1) & 255; n++; if (drop) continue;
          parts.push(encodePacket(sD, Array.from({ length: 8 }, (_, c) => cnt(8 + c)), null), encodePacket(sC, Array.from({ length: 8 }, (_, c) => cnt(c)), acc)); }
        else { const s = seq++ & 255; if (drop) continue; parts.push(encodePacket(s, Array.from({ length: 8 }, (_, c) => cnt(c)), acc)); }
      }
      if (!parts.length) return;
      const all = new Uint8Array(parts.length * 33); parts.forEach((p, j) => all.set(p, 33 * j)); push(all);
    }
    return P;
  }

  const API = { create, Parser, encodePacket, int24, toneAmp, kohmFromAmp, uvPerCount, knownPort, choosePort, supported, fakePort, NAMES, CODES, TEXT, FTDI_VID };
  E.Adapters.CytonSerial = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
