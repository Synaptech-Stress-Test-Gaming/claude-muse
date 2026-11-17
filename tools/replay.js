/* tools/replay.js: headless replay of a recording through the engine (one source of truth for the maths; tools/autotune.py calls it).
   node tools/replay.js --in <file or name prefix> [--config cfg.json] [--out out.json] [--device muse|cyton] [--profile none|fresh] [--quiet]
   Inputs: a v2 recording (the prefix of the 4 files: _eeg.csv, _aux.csv, _engine.csv, _meta.json), or an old panel CSV (header time_s,TP9_uV,...:
   TP9..TP10 at 256 Hz, time_s for gaps, the motion_* columns drive the motion gate from the recorded state, heart_rate_bpm as aux.ppgHr; no pulse
   waveform, so HRV is absent and stress runs on heart rate only).
   With no --in it replays up to 3 old-format CSVs found in .tmp/ and in Downloads, and exits 0 with "no recordings found (optional)" when there are none.
   --config deep-merges a JSON over MuseEngine.CONFIG (this is how the auto-tune tries settings).
   Output JSON: {meta, hops:[compact], events, summary:{validFrac, mean, sd per metric; events per type; maskFrac per reason}}. */
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
function args(argv) { const a = {}; for (let i = 0; i < argv.length; i++) { const k = argv[i]; if (k.startsWith("--")) { const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true; a[k.slice(2)] = v; } } return a; }
const readText = f => fs.readFileSync(f, "utf8").replace(/^﻿/, "");
function findOldCsvs() {
  const dirs = [path.join(__dirname, "..", ".tmp"), path.join(process.env.USERPROFILE || os.homedir(), "Downloads")], out = [];
  for (const d of dirs) { let names = []; try { names = fs.readdirSync(d); } catch (e) { continue; }
    for (const n of names) if (n.toLowerCase().endsWith(".csv")) { try { const fd = fs.openSync(path.join(d, n), "r"), b = Buffer.alloc(64); fs.readSync(fd, b, 0, 64, 0); fs.closeSync(fd); if (b.toString("utf8").replace(/^﻿/, "").startsWith("time_s,TP9_uV")) out.push(path.join(d, n)); } catch (e) {} } }
  return out.slice(0, 3);
}
function prefixOf(p) { return p.replace(/_(eeg|aux|engine)\.csv$|_meta\.json$/i, ""); }

/* ---------- v2 recording -> frames ---------- */
function loadV2(prefix) {
  const meta = JSON.parse(readText(prefix + "_meta.json")), lines = readText(prefix + "_eeg.csv").split(/\r?\n/), head = lines[0].split(",");
  const names = head.slice(2).map(h => h.replace(/_uV$/, "")), C = names.length, fs0 = meta.fs, rows = [];
  for (let i = 1; i < lines.length; i++) { if (!lines[i]) continue; const p = lines[i].split(","); rows.push({ si: +p[0], v: p.slice(2).map(Number) }); }
  const aux = { acc: [], gyro: [], ppg: [] };
  if (fs.existsSync(prefix + "_aux.csv")) for (const l of readText(prefix + "_aux.csv").split(/\r?\n/).slice(1)) { if (!l) continue; const p = l.split(","); if (aux[p[0]]) aux[p[0]].push([+p[1], p[2] === "" ? NaN : +p[2], +p[3], +p[4]]); }
  return { meta, names, C, fs: fs0, rows, aux, ecgChannel: meta.ecgChannel != null ? meta.ecgChannel : names.indexOf("ECG") };
}
function framesV2(d) {
  const N = Math.max(1, Math.round((d.meta.device === "muse" ? 0.046875 : 0.04) * d.fs)), out = [], A = { acc: 0, gyro: 0, ppg: 0 }, dev = d.meta.device;
  let i = 0;
  while (i < d.rows.length) {
    let j = i + 1; while (j < d.rows.length && j - i < N && d.rows[j].si === d.rows[j - 1].si + 1) j++;
    const si = d.rows[i].si, n = j - i, tEnd = (si + n) / d.fs, samples = [];
    for (let c = 0; c < d.C; c++) { const a = new Float32Array(n); for (let k = 0; k < n; k++) a[k] = d.rows[i + k].v[c]; samples.push(a); }
    const f = { device: dev, streamId: 1, fs: d.fs, channels: d.names.slice(), sampleIndex: si, t0: si / d.fs, samples, gaps: [], accel: null, gyro: null, ppg: null,
      ecg: d.ecgChannel >= 0 ? { fs: d.fs, data: samples[d.ecgChannel], channel: d.ecgChannel } : null, contact: dev === "muse" ? d.names.map(() => 95) : null, aux: { ppgHr: null, flags: {} } };
    if (out.length) { const prev = out[out.length - 1], exp = prev.sampleIndex + prev.samples[0].length; if (si > exp) f.gaps.push({ at: si, n: si - exp }); }
    for (const k of ["acc", "gyro"]) { const q = d.aux[k], t = [], xyz = []; while (A[k] < q.length && q[A[k]][0] < tEnd) { const r = q[A[k]++]; t.push(r[0]); xyz.push(r[1], r[2], r[3]); }
      if (t.length) f[k === "acc" ? "accel" : "gyro"] = { fs: dev === "muse" ? 52 : 25, t: Float64Array.from(t), xyz: Float32Array.from(xyz) }; }
    { const q = d.aux.ppg, v = []; let t0 = null; while (A.ppg < q.length && q[A.ppg][0] < tEnd) { const r = q[A.ppg++]; if (t0 == null) t0 = r[0]; v.push(r[1]); } if (v.length) f.ppg = { fs: 64, t0, data: Float32Array.from(v) }; }
    out.push(f); i = j;
  }
  return out;
}
/* ---------- old panel CSV -> frames ---------- */
function framesOld(file) {
  const lines = readText(file).split(/\r?\n/), head = lines[0].split(","), col = n => head.indexOf(n), ch = ["TP9_uV", "AF7_uV", "AF8_uV", "TP10_uV"].map(col);
  const iT = col("time_s"), iHr = col("heart_rate_bpm"), iMs = col("motion_state"), fs0 = 256, N = 12, out = [];
  let buf = null, lastSi = null, gyroT = 0;
  const flush = () => { if (!buf || !buf.s[0].length) return; const f = { device: "muse", streamId: 1, fs: fs0, channels: ["TP9", "AF7", "AF8", "TP10"], sampleIndex: buf.si, t0: buf.si / fs0, samples: buf.s.map(a => Float32Array.from(a)),
      gaps: buf.gap ? [{ at: buf.si, n: buf.gap }] : [], accel: null, gyro: null, ppg: null, ecg: null, contact: [95, 95, 95, 95], aux: { ppgHr: buf.hr, flags: {} } };
    // the recorded motion state drives the motion gate: still -> quiet accelerometer, movement -> a 2 Hz shake, missing -> no samples
    if (buf.ms !== "no_motion_data" && buf.ms !== "unavailable" && buf.ms !== "") { const t = [], xyz = []; const t1 = (buf.si + buf.s[0].length) / fs0; for (; gyroT < t1; gyroT += 1 / 52) { if (gyroT < buf.si / fs0) continue; const mv = buf.ms === "movement_detected" ? 0.15 * Math.sin(2 * Math.PI * 2 * gyroT) : 0; t.push(gyroT); xyz.push(mv, mv, 1 + mv); }
      if (t.length) f.accel = { fs: 52, t: Float64Array.from(t), xyz: Float32Array.from(xyz) }; } else gyroT = (buf.si + buf.s[0].length) / fs0;
    out.push(f); buf = null; };
  for (let i = 1; i < lines.length; i++) { if (!lines[i]) continue; const p = lines[i].split(","), si = Math.round(+p[iT] * fs0); if (!isFinite(si)) continue;
    const vals = ch.map(c => +p[c]); if (vals.some(v => !isFinite(v))) continue;
    if (lastSi != null && si !== lastSi + 1) { flush(); buf = { si, s: [[], [], [], []], gap: si - lastSi - 1 > 0 ? si - lastSi - 1 : 0, hr: null, ms: "" }; }
    if (!buf) buf = { si, s: [[], [], [], []], gap: 0, hr: null, ms: "" };
    vals.forEach((v, c) => buf.s[c].push(v)); const hr = iHr >= 0 && p[iHr] !== "" ? +p[iHr] : null; if (hr != null) buf.hr = hr; if (iMs >= 0) buf.ms = p[iMs] || "";
    lastSi = si; if (buf.s[0].length >= N) flush(); }
  flush();
  return { frames: out, meta: { device: "muse", fs: fs0, channels: ["TP9", "AF7", "AF8", "TP10"], ecgChannel: -1, source: path.basename(file), format: "panel-csv" } };
}
/* ---------- run ---------- */
function replay(a) {
  const P = require("../engine/pipeline.js"), Pr = require("../engine/profiles.js");
  let frames, meta;
  const inp = a.in;
  if (/\.csv$/i.test(inp) && !/_(eeg|aux|engine)\.csv$/i.test(inp)) ({ frames, meta } = framesOld(inp));
  else { const d = loadV2(prefixOf(inp)); frames = framesV2(d); meta = Object.assign({}, d.meta, { config: undefined, truth: undefined }); }
  const device = a.device || meta.device, cfg = a.config ? (typeof a.config === "string" ? JSON.parse(readText(a.config)) : a.config) : null;
  const eng = P.create({ device, fs: meta.fs, channels: frames[0].channels, ecgChannel: meta.ecgChannel, mains: meta.mains || 60, cfg, flags: cfg && cfg.flags ? cfg.flags : null,
    store: a.profile === "none" ? null : Pr.create({ storage: null }), accel: frames.some(f => f.accel) ? null : false });
  const hops = [], events = [], btn = [];
  eng.onEvent = e => btn.push({ id: e.id, type: e.type, t: e.t, onset: e.onset });
  const m3 = m => m ? [m.value == null ? null : Math.round(m.value * 10) / 10, m.state, Math.round(m.conf * 100) / 100, m.reason || null] : null;
  for (const f of frames) for (const o of eng.push(f)) {
    const raw = eng.lastRaw();
    hops.push({ t: o.t, f: m3(o.focus), s: m3(o.stress), d: m3(o.drowsiness), hr: o.stress.components.hr.bpm == null ? null : Math.round(o.stress.components.hr.bpm * 10) / 10,
      rm: o.stress.components.hrv.rmssdMs == null ? null : Math.round(o.stress.components.hrv.rmssdMs * 10) / 10, pc: o.profile ? Math.round(o.profile.confidence * 100) / 100 : null, mq: o.quality.motion,
      lg: o.legacy.focus == null ? null : Math.round(o.legacy.focus * 10) / 10, ev: o.events.map(e => e.type), raw });
    for (const e of o.events) events.push({ id: e.id, type: e.type, sub: e.sub || null, onset: e.onset, offset: e.offset == null ? null : e.offset, t: e.t });
  }
  eng.endSession();
  const summary = { validFrac: {}, mean: {}, sd: {}, events: {}, maskFrac: {}, hops: hops.length };
  for (const [k, key] of [["focus", "f"], ["stress", "s"], ["drowsiness", "d"]]) { const v = hops.filter(h => h[key] && h[key][0] != null).map(h => h[key][0]); summary.validFrac[k] = hops.length ? v.length / hops.length : 0;
    const m = v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; summary.mean[k] = m == null ? null : Math.round(m * 100) / 100; summary.sd[k] = v.length > 1 ? Math.round(100 * Math.sqrt(v.reduce((x, y) => x + (y - m) * (y - m), 0) / (v.length - 1))) / 100 : null; }
  for (const e of events) summary.events[e.type] = (summary.events[e.type] || 0) + 1;
  for (const h of hops) if (h.f && (h.f[1] === "held" || h.f[1] === "stale") && h.f[3]) summary.maskFrac[h.f[3]] = (summary.maskFrac[h.f[3]] || 0) + 1 / hops.length;
  return { meta, hops, events, buttons: btn, summary, config: eng.cfg };
}
function printSummary(name, r) {
  const s = r.summary; console.log("\n" + name + " (" + r.meta.device + ", " + s.hops + " hops)");
  console.log("metric      valid%   mean     sd"); for (const k of ["focus", "stress", "drowsiness"]) console.log(k.padEnd(11) + (100 * s.validFrac[k]).toFixed(1).padStart(6) + "  " + String(s.mean[k]).padStart(6) + "  " + String(s.sd[k]).padStart(6));
  console.log("events: " + (Object.entries(s.events).map(([k, v]) => k + " " + v).join(", ") || "none")); console.log("masked/held time: " + (Object.entries(s.maskFrac).map(([k, v]) => k + " " + (100 * v).toFixed(1) + "%").join(", ") || "none"));
}
if (require.main === module) {
  const a = args(process.argv.slice(2));
  const inputs = a.in ? [a.in] : findOldCsvs();
  if (!inputs.length) { console.log("no recordings found (optional)"); process.exit(0); }
  let last = null;
  for (const f of inputs) { try { last = replay(Object.assign({}, a, { in: f })); if (!a.quiet) printSummary(path.basename(f), last); } catch (e) { console.log("could not replay " + f + ": " + e.message); if (a.in) process.exit(2); } }
  if (a.out && last) { fs.mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true }); fs.writeFileSync(a.out, JSON.stringify(last)); }
  process.exit(0);
}
module.exports = { args, findOldCsvs, replay, loadV2, framesV2, framesOld, prefixOf };
