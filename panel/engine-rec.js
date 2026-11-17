/* panel/engine-rec.js
   1) The new engine's columns appended to the existing Muse CSV (eng_focus, eng_focus_state, eng_stress, eng_stress_state, eng_profile_conf, eng_mask).
   2) The v2 recorder, used for Cyton recordings and by the validation protocol on both devices (cap 40 min). On stop it downloads 4 files:
      <name>_eeg.csv     sample_index,time_s,<channel>_uV ... (gaps stay gaps; nothing filled)
      <name>_aux.csv     stream,time_s,v1,v2,v3 for acc, gyro, ppg samples
      <name>_engine.csv  one row per hop (focus, stress, drowsiness, states, confidences, heart, profile, mask reason, events, legacy_focus)
      <name>_meta.json   device, fs, channels, ecgChannel, mains, start, engineMode, config, selfcheck, markers
   Chrome/Edge may ask once to allow multiple downloads. Classic script: top-level names start with eng / Eng. */
"use strict";
const ENG_STATES = ["", "live", "held", "stale", "learning", "unavailable"], ENG_MASKS = ["", "movement", "muscle", "blink", "no contact", "no ECG", "no pulse", "signal lost", "eyes closed", "learning"];
const ENG_REC_MAX_S = 40 * 60;
/* Muse CSV: fill the 6 appended columns of one row (values are numbers; states/reasons as codes, written as text by engRecFormat) */
function engRecFill(d, o) {
  const e = window.EngineOut, f = e && e.focus, s = e && e.stress;
  d[o] = f && f.value != null ? f.value : NaN; d[o + 1] = f ? ENG_STATES.indexOf(f.state) : 0;
  d[o + 2] = s && s.value != null ? s.value : NaN; d[o + 3] = s ? ENG_STATES.indexOf(s.state) : 0;
  d[o + 4] = e && e.profile ? e.profile.confidence : NaN;
  d[o + 5] = f && (f.state === "held" || f.state === "stale") ? Math.max(0, ENG_MASKS.indexOf(f.reason)) : 0;
}
function engRecFormat(k, v) {
  if (k === 1 || k === 3) return ENG_STATES[v] || "";
  if (k === 5) return ENG_MASKS[v] || "";
  return v !== v ? "" : k === 4 ? v.toFixed(2) : v.toFixed(1);
}
/* ---------- v2 recorder ---------- */
let engRec = null;
function engRecActive() { return !!engRec; }
function engRecStart(o) {
  o = o || {};
  if (engRec || !S.connected) return false;
  const d = new Date();
  engRec = { name: (S.dev === "cyton" ? "Cyton_recording_" : "Muse2_recording_") + stamp(d), start: d.toISOString(), t0: Date.now(), frames: [], aux: [], hops: [], markers: [], n: 0,
    device: S.dev, fs: null, channels: null, ecgChannel: -1, firstT: null, full: false, onStop: o.onStop || null };
  if (S.dev === "cyton") { S.rec = { v2: true, t0: Date.now(), samples: 0, contactSum: [0, 0, 0, 0], contactN: 0, artSec: 0, motSec: 0 }; setButtons(); $("btnStart").classList.add("on"); setSess(true); }
  return true;
}
function engRecFrame(f) {
  const r = engRec; if (!r || r.full) return;
  if (r.fs == null) { r.fs = f.fs; r.channels = f.channels.slice(); r.ecgChannel = f.ecg ? f.ecg.channel : -1; r.firstT = f.t0; }
  if (f.fs !== r.fs || f.channels.length !== r.channels.length) return;   // a new stream with other settings: the recording keeps the first one
  if (f.t0 - r.firstT > ENG_REC_MAX_S) { r.full = true; setTimeout(() => engRecStop(true, "The 40 minute limit was reached."), 0); return; }
  r.frames.push({ si: f.sampleIndex, streamId: f.streamId, s: f.samples.map(a => Float32Array.from(a)) }); r.n += f.samples[0].length;
  if (S.rec && S.rec.v2) S.rec.samples = r.n;
  for (const [k, m] of [["acc", f.accel], ["gyro", f.gyro]]) if (m) for (let i = 0; i < m.t.length; i++) r.aux.push(k + "," + m.t[i].toFixed(4) + "," + m.xyz[3 * i].toFixed(4) + "," + m.xyz[3 * i + 1].toFixed(4) + "," + m.xyz[3 * i + 2].toFixed(4));
  if (f.ppg) for (let i = 0; i < f.ppg.data.length; i++) { const v = f.ppg.data[i]; r.aux.push("ppg," + (f.ppg.t0 + i / f.ppg.fs).toFixed(4) + "," + (v === v ? v.toFixed(3) : "") + ",,"); }
}
function engRecHop(o) {
  const r = engRec; if (!r || r.full) return;
  const v = x => x == null ? "" : x.toFixed(2), f = o.focus, s = o.stress, dr = o.drowsiness;
  const mask = f.state === "held" || f.state === "stale" ? f.reason || "" : "";
  const ev = (o.events || []).map(e => e.type + "@" + (e.onset != null ? e.onset : e.t).toFixed(2)).join(";");
  r.hops.push([o.t.toFixed(2), v(f.value), f.state, f.conf.toFixed(2), v(s.value), s.state, s.conf.toFixed(2), dr ? v(dr.value) : "", dr ? dr.state : "",
    v(s.components.hr.bpm), v(s.components.hrv.rmssdMs), o.profile && o.profile.label ? '"' + String(o.profile.label).replace(/"/g, "'") + '"' : "", o.profile ? o.profile.confidence.toFixed(2) : "", mask, ev, v(o.legacy ? o.legacy.focus : null)].join(","));
}
function engRecMarker(m) { if (engRec) engRec.markers.push(m); }
function engRecBuild(r) {
  const fs = r.fs, names = (r.channels || []).map((n, c) => (c === r.ecgChannel ? "ECG" : n) + "_uV");
  const eeg = ["sample_index,time_s," + names.join(",")];
  let lastStream = null, base = 0, lastEnd = 0;
  for (const fr of r.frames) {
    if (fr.streamId !== lastStream) { if (lastStream != null) base = lastEnd + Math.round(2 * fs); lastStream = fr.streamId; }   // a restarted stream continues after a 2 s hole
    const n = fr.s[0].length;
    for (let k = 0; k < n; k++) { const si = base + fr.si + k; let line = si + "," + (si / fs).toFixed(4); for (let c = 0; c < fr.s.length; c++) line += "," + fr.s[c][k].toFixed(2); eeg.push(line); }
    lastEnd = base + fr.si + n;
  }
  const meta = { device: r.device, fs, channels: r.channels, ecgChannel: r.ecgChannel, mains: engState.cfg && engState.cfg.mains || 60, start: r.start, engineMode: typeof engMode !== "undefined" ? engMode : "new",
    config: window.MuseEngine && MuseEngine.CONFIG, selfcheck: engState.selfcheck || null, markers: r.markers, samples: r.n, version: 2 };
  return { eeg: eeg.join("\r\n"), aux: ["stream,time_s,v1,v2,v3"].concat(r.aux).join("\r\n"),
    engine: ["time_s,focus,focus_state,focus_conf,stress,stress_state,stress_conf,drowsiness,drowsiness_state,hr_bpm,rmssd_ms,profile,profile_conf,mask_reason,events,legacy_focus"].concat(r.hops).join("\r\n"),
    meta: JSON.stringify(meta, null, 1) };
}
function engRecStop(auto, why) {
  const r = engRec; if (!r) return null; engRec = null;
  if (S.rec && S.rec.v2) { S.rec = null; $("btnStart").classList.remove("on"); setButtons(); }
  if (r.n < (r.fs || 1)) { toast("That recording was under 1 second, so nothing was saved.", "info", 5000); if (r.onStop) r.onStop(null); return null; }
  const b = engRecBuild(r);
  try { download(r.name + "_eeg.csv", b.eeg, "text/csv"); setTimeout(() => download(r.name + "_aux.csv", b.aux, "text/csv"), 400);
    setTimeout(() => download(r.name + "_engine.csv", b.engine, "text/csv"), 800); setTimeout(() => download(r.name + "_meta.json", b.meta, "application/json"), 1200); } catch (e) { console.error(e); }
  sessMsg("Saved 4 files to Downloads");
  toast((auto ? (why || "Recording ended.") + " " : "") + "Saving 4 files (" + r.name + "_eeg.csv, _aux.csv, _engine.csv, _meta.json) to Downloads. Chrome/Edge may ask once to allow multiple downloads.", "info", 9000);
  if (r.onStop) r.onStop(r.name);
  return r.name;
}
