/* adapters/cyton.js
   WebSocket client to tools/cyton_helper.py (ws://127.0.0.1:8766): decodes the binary data frames into engine frames and passes the
   helper's JSON messages (hello, status, config, selfcheck, stats, impedance, error, pong) to the panel.
   Binary frame (little-endian): u8 magic 0xCB, u8 version 1, u8 type 1, u8 C, u16 N, u8 A, u8 flags, u64 sampleIndex, f64 board time,
   u32 lostTotal, f32 fs, then f32 x C x N (channel-major), then A x {u16 offset, u16 pad, f32 x, f32 y, f32 z}. See tools/README.md.
   Connection: idle -> connecting -> open -> streaming; on close or error it retries every 2 s.
   UMD: MuseEngine.Adapters.Cyton. Tested by adapters/cyton.test.js. */
"use strict";
(function (root) {
  const E = root.MuseEngine = root.MuseEngine || {};
  E.Adapters = E.Adapters || {};
  const NOT_RUNNING = 'Cyton helper is not running. Double-click "Open Cyton Helper.bat" in the project folder, or run: python tools/cyton_helper.py';
  const FLAGS = { accel: 1, gap: 2, sim: 4, decim: 8, impedance: 16 };
  const DEFAULT_NAMES = ["Fp1", "Fp2", "C3", "C4", "P7", "P8", "O1", "O2", "F7", "F8", "F3", "F4", "T7", "T8", "P3", "P4"];

  /* pure: ArrayBuffer -> {header..., frame} ; cfg = latest helper config (channels, ecgChannel, streamId) */
  function decodeFrame(buf, cfg) {
    const ab = buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    if (ab.byteLength < 32) throw new Error("Cyton frame too short (" + ab.byteLength + " bytes)");
    const dv = new DataView(ab);
    if (dv.getUint8(0) !== 0xCB) throw new Error("Cyton frame: bad magic");
    if (dv.getUint8(1) !== 1) throw new Error("Cyton frame: unsupported protocol version " + dv.getUint8(1));
    if (dv.getUint8(2) !== 1) throw new Error("Cyton frame: not a data frame");
    const C = dv.getUint8(3), N = dv.getUint16(4, true), A = dv.getUint8(6), flags = dv.getUint8(7);
    if (ab.byteLength !== 32 + 4 * C * N + 16 * A) throw new Error("Cyton frame: length " + ab.byteLength + " does not match the header (" + (32 + 4 * C * N + 16 * A) + ")");
    const sampleIndex = Number(dv.getBigUint64(8, true)), boardTs = dv.getFloat64(16, true), lostTotal = dv.getUint32(24, true), fs = dv.getFloat32(28, true);
    const samples = []; for (let c = 0; c < C; c++) { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = dv.getFloat32(32 + 4 * (c * N + i), true); samples.push(a); }
    let accel = null;
    if (A > 0) { const t = new Float64Array(A), xyz = new Float32Array(3 * A); let o = 32 + 4 * C * N;
      for (let k = 0; k < A; k++, o += 16) { t[k] = (sampleIndex + dv.getUint16(o, true)) / fs; xyz[3 * k] = dv.getFloat32(o + 4, true); xyz[3 * k + 1] = dv.getFloat32(o + 8, true); xyz[3 * k + 2] = dv.getFloat32(o + 12, true); }
      accel = { fs: 25, t, xyz }; }
    cfg = cfg || {};
    const names = cfg.channels && cfg.channels.length === C ? cfg.channels.slice() : DEFAULT_NAMES.slice(0, C);
    const ecgCh = cfg.ecgChannel != null ? cfg.ecgChannel : -1;
    const frame = { device: "cyton", streamId: cfg.streamId || 1, fs, channels: names, sampleIndex, t0: sampleIndex / fs, samples, gaps: [], accel, gyro: null, ppg: null,
      ecg: ecgCh >= 0 && ecgCh < C ? { fs, data: samples[ecgCh], channel: ecgCh } : null, contact: null,
      aux: { ppgHr: null, flags: { impedance: !!(flags & FLAGS.impedance), simulated: !!(flags & FLAGS.sim), decimated: !!(flags & FLAGS.decim), gapFlag: !!(flags & FLAGS.gap), boardTs, lostTotal } } };
    return { C, N, A, flags, sampleIndex, boardTs, lostTotal, fs, frame };
  }

  function create(o) {
    o = Object.assign({ url: "ws://127.0.0.1:8766", onFrame: null, onStatus: null, onMessage: null, WebSocket: root.WebSocket, setTimeout: (f, ms) => setTimeout(f, ms), retryMs: 2000 }, o);
    const A = { state: "idle", ws: null, cfg: null, expect: null, stopped: false, selfcheck: null, stats: null, hello: null, errors: [], frames: 0, retries: 0 };
    const status = (state, text, fix) => { A.state = state; if (o.onStatus) o.onStatus({ state, text: text || "", fix: fix || null }); };
    function connect() {
      if (A.stopped) return;
      status("connecting", "Connecting to the Cyton helper…");
      let ws, opened = false;
      try { ws = new o.WebSocket(o.url); } catch (e) { retry(false); return; }
      A.ws = ws; ws.binaryType = "arraybuffer";
      ws.onopen = () => { opened = true; status("open", "Connected to the helper"); };
      ws.onmessage = ev => {
        if (typeof ev.data === "string") { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } handleJson(m); return; }
        let d; try { d = decodeFrame(ev.data, A.cfg); } catch (e) { A.errors.push(String(e.message || e)); return; }
        const f = d.frame;
        if (A.expect != null && (d.sampleIndex > A.expect)) f.gaps.push({ at: d.sampleIndex, n: d.sampleIndex - A.expect });
        A.expect = d.sampleIndex + d.N; A.frames++;
        if (A.state !== "streaming") status("streaming", "Streaming");
        if (o.onFrame) o.onFrame(f);
      };
      ws.onerror = () => {};
      ws.onclose = () => { A.ws = null; retry(opened); };
    }
    function retry(wasOpen) {
      if (A.stopped) return;
      A.retries++;
      status(wasOpen ? "lost" : "down", wasOpen ? "Lost signal, retrying" : NOT_RUNNING, wasOpen ? null : "Start the helper, then the panel connects by itself.");
      o.setTimeout(connect, o.retryMs);
    }
    function handleJson(m) {
      if (m.type === "config") {
        const changed = !A.cfg || A.cfg.streamId !== m.streamId;
        A.cfg = m; if (changed) A.expect = null;                         // a new stream: sampleIndex restarts at 0
      } else if (m.type === "selfcheck") A.selfcheck = m;
      else if (m.type === "stats") A.stats = m;
      else if (m.type === "hello") A.hello = m;
      else if (m.type === "status" && m.state === "reconnecting") status("open", "Helper: board reconnecting");
      if (o.onMessage) o.onMessage(m);
    }
    function send(cmd, extra) { if (!A.ws || A.ws.readyState !== 1) return false; A.ws.send(JSON.stringify(Object.assign({ type: "cmd", cmd }, extra || {}))); return true; }
    function stop() { A.stopped = true; if (A.ws) { try { A.ws.close(); } catch (e) {} } A.ws = null; status("idle", "Disconnected"); }
    return { start() { A.stopped = false; connect(); }, stop, send, state: A, get config() { return A.cfg; }, _handleJson: handleJson };
  }
  const API = { create, decodeFrame, NOT_RUNNING, DEFAULT_NAMES, FLAGS };
  E.Adapters.Cyton = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
