/* Optional checks on public datasets (tools/get_datasets.py). Each runs only if .tmp/datasets/<name> exists; otherwise "SKIP <name> (not downloaded)".
   With nothing downloaded it exits 0. Run: node engine/datasets.test.js */
"use strict";
const fs = require("fs"), path = require("path"), K = require("./testkit.js"), P = require("./pipeline.js");
const DIR = path.join(__dirname, "..", ".tmp", "datasets");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }
const has = n => fs.existsSync(path.join(DIR, n)) && fs.readdirSync(path.join(DIR, n)).length > 0;

/* minimal .npy reader (v1/v2, little-endian float32/float64, C order, 2-D) */
function readNpy(file) {
  const b = fs.readFileSync(file), major = b[6], hl = major === 1 ? b.readUInt16LE(8) : b.readUInt32LE(8), off = major === 1 ? 10 + hl : 12 + hl;
  const h = b.slice(major === 1 ? 10 : 12, off).toString("latin1"), dt = /'descr':\s*'([^']+)'/.exec(h)[1], shape = /'shape':\s*\(([^)]*)\)/.exec(h)[1].split(",").map(s => s.trim()).filter(Boolean).map(Number);
  const ab = b.buffer.slice(b.byteOffset + off, b.byteOffset + b.length), arr = dt === "<f4" ? new Float32Array(ab) : new Float64Array(ab);
  return { shape, data: arr, row: i => arr.subarray(i * shape[1], (i + 1) * shape[1]) };
}
/* minimal EDF reader: returns {labels, fs[], signals[]} */
function readEdf(file) {
  const b = fs.readFileSync(file), s = (o, n) => b.toString("latin1", o, o + n).trim(), ns = +s(252, 4), nrec = +s(236, 8), dur = +s(244, 8), H = 256 + ns * 256;
  const physMin = Array.from({ length: ns }, (_, i) => +s(256 + 104 * ns + i * 8, 8)), physMax = Array.from({ length: ns }, (_, i) => +s(256 + 112 * ns + i * 8, 8)), digMin = Array.from({ length: ns }, (_, i) => +s(256 + 120 * ns + i * 8, 8)), digMax = Array.from({ length: ns }, (_, i) => +s(256 + 128 * ns + i * 8, 8)), nS = Array.from({ length: ns }, (_, i) => +s(256 + 216 * ns + i * 8, 8));
  const sig = nS.map(n => new Float32Array(n * nrec)); let o = H;
  for (let r = 0; r < nrec; r++) for (let i = 0; i < ns; i++) { const g = (physMax[i] - physMin[i]) / (digMax[i] - digMin[i]); for (let k = 0; k < nS[i]; k++) { sig[i][r * nS[i] + k] = physMin[i] + (b.readInt16LE(o) - digMin[i]) * g; o += 2; } }
  return { labels: Array.from({ length: ns }, (_, i) => s(256 + i * 16, 16)), fs: nS.map(n => n / dur), signals: sig };
}

// EEGdenoiseNet: EMG segments added to clean EEG must be masked >= 80% of the time
if (has("eegdenoisenet")) {
  const eeg = readNpy(path.join(DIR, "eegdenoisenet", "EEG_all_epochs.npy")), emg = readNpy(path.join(DIR, "eegdenoisenet", "EMG_all_epochs.npy")), fs0 = 256;
  const n = 60 * fs0, rec = K.rec("muse", 60, 1, { ppg: false }); // 4 channels; each gets clean EEG epochs, EMG epochs added in the middle 20 s
  let e = 0; for (let c = 0; c < 4; c++) for (let i = 0; i < n; i += 512) { const row = eeg.row(e++ % eeg.shape[0]); for (let k = 0; k < 512 && i + k < n; k++) rec.data[c][i + k] = row[k] * 10; }
  let m = 0; for (let c = 0; c < 4; c++) for (let i = 20 * fs0; i < 40 * fs0; i += 512) { const row = emg.row(m++ % emg.shape[0]); for (let k = 0; k < 512; k++) rec.data[c][i + k] += row[k] * 10; }
  const { outs } = K.run(rec), seg = outs.filter(o => o.t > 21 && o.t < 40), masked = seg.filter(o => o.focus.state === "held" || o.focus.state === "stale").length / seg.length;
  ok(masked >= 0.8, "eegdenoisenet: EMG added to clean EEG is masked " + (100 * masked).toFixed(0) + "% of the time (>= 80%)");
} else console.log("SKIP eegdenoisenet (not downloaded)");
// EEGMAT: arithmetic vs rest must show focus d > 0 (on 4 frontal/temporal channels mapped onto the Muse layout)
if (has("eegmat")) {
  const dir = path.join(DIR, "eegmat"), files = []; (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/_1\.edf$/i.test(f)) files.push(p); } })(dir);
  const ds = [];
  for (const f1 of files.slice(0, 10)) { const f2 = f1.replace(/_1\.edf$/i, "_2.edf"); if (!fs.existsSync(f2)) continue;
    const runOne = file => { const e = readEdf(file), idx = ["T3", "F7", "F8", "T4"].map(l => e.labels.findIndex(x => x.toUpperCase().includes(l))); if (idx.some(i => i < 0)) return null;
      const fs0 = Math.round(e.fs[idx[0]]), n = e.signals[idx[0]].length, rec = { device: "muse", fs: fs0, channels: ["TP9", "AF7", "AF8", "TP10"], n, data: idx.map(i => e.signals[i]), events: [], gapMask: null, accel: null, gyro: null, ppg: null, ecgChannel: -1, truth: {}, opts: { seed: 1 } };
      if (fs0 < 125) return null; const eng = P.create({ device: "muse", fs: fs0, channels: rec.channels, accel: false }); const v = [];
      for (const fr of K.F.frames(rec)) for (const o of eng.push(fr)) if (o.focus.value != null) v.push(o.focus.value); return v; };
    const rest = runOne(f1), task = runOne(f2); if (!rest || !task || rest.length < 10 || task.length < 10) continue;
    const m = a => a.reduce((x, y) => x + y, 0) / a.length, sd = a => Math.sqrt(a.reduce((x, y) => x + (y - m(a)) ** 2, 0) / (a.length - 1));
    ds.push((m(task) - m(rest)) / Math.sqrt((sd(task) ** 2 + sd(rest) ** 2) / 2)); }
  if (ds.length) ok(ds.reduce((a, b) => a + b, 0) / ds.length > 0, "eegmat: arithmetic vs rest focus d = " + (ds.reduce((a, b) => a + b, 0) / ds.length).toFixed(2) + " over " + ds.length + " people (> 0)");
  else console.log("SKIP eegmat (files present but no usable pair)");
} else console.log("SKIP eegmat (not downloaded)");
for (const n of ["klados", "cogbci", "muse_mendeley", "ultracortex_mi"]) { if (has(n)) ok(fs.readdirSync(path.join(DIR, n)).length > 0, n + ": files present (no automatic check defined)"); else console.log("SKIP " + n + " (not downloaded)"); }
console.log(fails ? fails + " FAILED" : "all passed (optional checks)");
process.exit(fails ? 1 : 0);
