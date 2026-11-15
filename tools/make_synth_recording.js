/* tools/make_synth_recording.js
   Writes a synthetic v2 validation recording (the 4 files of panel/engine-rec.js) with the full block structure of the validation protocol
   (panel/validation.js) and its markers, from engine/fixtures.js:
     rest blocks neutral; nback and arith "focused" (theta x1.6, alpha x0.6), arith with HR +10 bpm and RMSSD x0.7; rest_closed eyes closed;
     artifact blocks with the matching injector at each cue (reaction delay 300-600 ms); game with random blinks, talk bursts and small movements;
     fixation with ratioD and blink duration rising linearly to about +1.5 sigma; spontaneous blinks (about 15/min) elsewhere.
   node tools/make_synth_recording.js --device cyton|muse --out .tmp/synth/<name> [--fast 10] [--seed 1] [--no-engine] */
"use strict";
const fs = require("fs"), path = require("path");
const F = require("../engine/fixtures.js"), U = require("../engine/util.js"), V = require("../panel/validation.js");

function args(argv) { const a = {}; for (let i = 0; i < argv.length; i++) { const k = argv[i]; if (k.startsWith("--")) { const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true; a[k.slice(2)] = v; } } return a; }
function schedule(fast) { let t = 2; return V.BLOCKS.map(b => { const d = V.durOf(b, fast), s = { b, t0: t, t1: t + d, cues: V.cues(b, fast).map(c => t + c) }; t += d; return s; }); }

function make(o) {
  o = Object.assign({ device: "cyton", fast: 1, seed: 1 }, o);
  const dev = o.device, fs = dev === "muse" ? 256 : 125, sch = schedule(o.fast), T = sch[sch.length - 1].t1 + 3, r = U.rng(o.seed * 7 + 1);
  const blockAt = t => sch.find(s => t >= s.t0 && t < s.t1) || null;
  const ramp = (t, s) => Math.max(0, Math.min(1, (t - s.t0) / (s.t1 - s.t0)));
  const mod = t => { const s = blockAt(t); if (!s) return null; const id = s.b.id;
    if (id === "nback" || id === "arith") return { theta: 1.6, alpha: 0.6 };
    if (id === "fixation") { const f = ramp(t, s); return { theta: 1 + 1.1 * f, alpha: 1 + 1.1 * f, betaLo: 1 / (1 + 0.6 * f) }; }
    return null; };
  const rec = F.eeg({ device: dev, fs, seconds: T, seed: o.seed, mod, mainsUv: 0 });
  const truth = [];
  // heart: 70 bpm, RMSSD 40 ms; arith: 80 bpm, RMSSD x0.7
  const ar = sch.find(s => s.b.id === "arith"), rr = []; { let t = 0.6; const g = U.rng(o.seed + 5); while (t < T + 2) { const inA = t >= ar.t0 - (o.fast > 1 ? 8 : 0) && t < ar.t1;   // fast mode: the 8 s heart-rate window would otherwise eat most of a 12 s block
      const mean = 60000 / (inA ? 80 : 70), sd = (inA ? 28 : 40) / Math.SQRT2; const v = mean + sd * g.normal() * 0.7 + 0.5 * sd * Math.sin(t / 0.9); rr.push(v); t += v / 1000; } }
  if (dev === "cyton") F.addEcg(rec, { rrMs: rr, ch: 8 }); else F.addPpg(rec, { rrMs: rr });
  const react = () => r.range(0.3, 0.6);
  for (const s of sch) {
    const id = s.b.id;
    if (id === "rest_closed") truth.push(...F.eyesClosed(rec, s.t0 + 0.5, Math.max(2, s.t1 - s.t0 - 1)));
    for (const c of s.cues) { const t = c + react();
      if (id === "art_blink") truth.push(...F.blink(rec, t, { ampUv: r.range(110, 170) }));
      else if (id === "art_dblink") truth.push(...F.doubleBlink(rec, t, 350));
      else if (id === "art_clench") truth.push(...F.clench(rec, t));
      else if (id === "art_clench_long") truth.push(...F.tension(rec, t, 3));
      else if (id === "art_frown") { const amps = {}; rec.channels.forEach(n => { amps[n] = F.GROUPS[dev].frontal.includes(n) ? 50 : F.GROUPS[dev].temporal.includes(n) ? 8 : 4; }); truth.push(...F.emgBurst(rec, t, { durMs: 1000, amps, sub: "other" })); }
      else if (id === "art_turn" || id === "art_nod") truth.push(...F.motion(rec, t, 1.2));
      else if (id === "art_stand") truth.push(...F.motion(rec, t, 4, { g: 0.25 })); }
    if (id === "art_talk") truth.push(...F.talk(rec, s.t0 + 0.5, s.t1 - s.t0 - 1));
    if (id === "art_chew") for (let t = s.t0 + 0.3; t === s.t0 + 0.3 || t < s.t1 - 3; t += 4) truth.push(...F.chew(rec, t, 3, 1.2));
    if (id === "art_type" && rec.accel) { const a = rec.accel; for (let i = Math.floor(s.t0 * a.fs); i < Math.min(a.x.length, s.t1 * a.fs); i++) { a.x[i] += 0.003 * r.normal(); a.y[i] += 0.003 * r.normal(); } }
    if (id === "game") { for (let t = s.t0 + 3; t < s.t1 - 3; t += r.range(8, 20)) { const k = r.next(); if (k < 0.4) truth.push(...F.talk(rec, t, 2)); else if (k < 0.7) truth.push(...F.motion(rec, t, 1)); } }
    // spontaneous blinks (not with eyes closed, not during the dedicated blink blocks); longer and slower during fixation
    if (!["rest_closed", "art_blink", "art_dblink"].includes(id)) for (let t = s.t0 + r.range(1, 4); t < s.t1 - 1; t += r.range(3, 5)) {
      const f = id === "fixation" ? ramp(t, s) : 0; truth.push(...F.blink(rec, t, { ampUv: r.range(110, 160), durMs: 250 + 200 * f })); }
  }
  // markers (stream time = sample time)
  const markers = [], wall0 = Date.UTC(2026, 10, 14, 12, 0, 0);
  sch.forEach((s, bi) => { markers.push(V.marker(s.t0, wall0 + s.t0 * 1000, bi, s.b.id, "start")); s.cues.forEach((c, k) => markers.push(V.marker(c, wall0 + c * 1000, bi, s.b.id + (s.b.alt ? " " + s.b.alt[k % 2] : ""), "cue", k))); markers.push(V.marker(s.t1, wall0 + s.t1 * 1000, bi, s.b.id, "end")); });
  return { rec, markers, truth, sch, fs, T };
}
function write(out, m, o) {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const rec = m.rec, names = rec.channels.map((n, c) => (c === rec.ecgChannel ? "ECG" : n) + "_uV"), lines = ["sample_index,time_s," + names.join(",")];
  for (let i = 0; i < rec.n; i++) { let l = i + "," + (i / rec.fs).toFixed(4); for (let c = 0; c < rec.data.length; c++) l += "," + rec.data[c][i].toFixed(2); lines.push(l); }
  fs.writeFileSync(out + "_eeg.csv", lines.join("\r\n"));
  const aux = ["stream,time_s,v1,v2,v3"];
  for (const [k, a] of [["acc", rec.accel], ["gyro", rec.gyro]]) if (a) for (let i = 0; i < a.x.length; i++) aux.push(k + "," + (i / a.fs).toFixed(4) + "," + a.x[i].toFixed(4) + "," + a.y[i].toFixed(4) + "," + a.z[i].toFixed(4));
  if (rec.ppg) for (let i = 0; i < rec.ppg.data.length; i++) aux.push("ppg," + (i / rec.ppg.fs).toFixed(4) + "," + rec.ppg.data[i].toFixed(3) + ",,");
  fs.writeFileSync(out + "_aux.csv", aux.join("\r\n"));
  const meta = { device: rec.device, fs: rec.fs, channels: rec.channels.map((n, c) => c === rec.ecgChannel ? "ECG" : n), ecgChannel: rec.ecgChannel, mains: 60, start: new Date(Date.UTC(2026, 10, 14, 12)).toISOString(),
    engineMode: "new", config: require("../engine/pipeline.js").CONFIG, selfcheck: null, markers: m.markers, samples: rec.n, version: 2, synthetic: true, fast: o.fast, seed: o.seed, truth: m.truth.map(e => ({ type: e.type, sub: e.sub || null, onset: e.onset, offset: e.offset })) };
  fs.writeFileSync(out + "_meta.json", JSON.stringify(meta, null, 1));
  let engine = "time_s,focus,focus_state,focus_conf,stress,stress_state,stress_conf,drowsiness,drowsiness_state,hr_bpm,rmssd_ms,profile,profile_conf,mask_reason,events,legacy_focus";
  if (!o.noEngine) { const R = require("./replay.js"), res = R.replay({ in: out, quiet: true }); engine += "\r\n" + res.hops.map(h => [h.t, h.f[0], h.f[1], h.f[2], h.s[0], h.s[1], h.s[2], h.d ? h.d[0] : "", h.d ? h.d[1] : "", h.hr == null ? "" : h.hr, h.rm == null ? "" : h.rm, "", h.pc, h.f[3] || "", (h.ev || []).join(";"), h.lg == null ? "" : h.lg].map(v => v == null ? "" : v).join(",")).join("\r\n"); }
  fs.writeFileSync(out + "_engine.csv", engine);
  return out;
}
if (require.main === module) {
  const a = args(process.argv.slice(2));
  const o = { device: a.device === "muse" ? "muse" : "cyton", fast: +(a.fast || 1), seed: +(a.seed || 1), noEngine: !!a["no-engine"] };
  const out = a.out || path.join(".tmp", "synth", (o.device === "muse" ? "Muse2" : "Cyton") + "_synth_fast" + o.fast);
  const t0 = Date.now(), m = make(o); write(out, m, o);
  console.log("wrote " + out + "_{eeg,aux,engine}.csv and _meta.json (" + o.device + ", " + (m.T / 60).toFixed(1) + " min, " + m.markers.length + " markers) in " + ((Date.now() - t0) / 1000).toFixed(1) + " s");
}
module.exports = { make, write, schedule };
