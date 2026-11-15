/* Tests for tools/replay.js. Run: node tools/replay.test.js */
"use strict";
const fs = require("fs"), path = require("path"), R = require("./replay.js"), M = require("./make_synth_recording.js"), F = require("../engine/fixtures.js");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }
const dir = path.join(__dirname, "..", ".tmp", "replay_test"); fs.mkdirSync(dir, { recursive: true });
const finiteOrNull = v => v === null || (typeof v === "number" && isFinite(v));
const keysOk = s => ["validFrac", "mean", "sd", "events", "maskFrac", "hops"].every(k => k in s) && ["focus", "stress", "drowsiness"].every(k => k in s.validFrac);

// an old-format panel CSV written here
{ const rec = F.eeg({ device: "muse", fs: 256, seconds: 60, seed: 4 }); F.blink(rec, 20); F.clench(rec, 30);
  const head = "time_s,TP9_uV,AF7_uV,AF8_uV,TP10_uV,delta_uV,theta_uV,alpha_uV,beta_uV,gamma_uV,sensors_in_use,focus_index_ln_beta_over_alpha,focus_0_to_100,heart_rate_bpm,heart_signal_pct,motion_acc_rms_g,motion_gyro_rms_dps,motion_state,eng_focus,eng_focus_state,eng_stress,eng_stress_state,eng_profile_conf,eng_mask";
  const L = [head]; for (let i = 0; i < rec.n; i++) { if (i >= 40 * 256 && i < 40.5 * 256) continue; const t = i / 256; L.push([t.toFixed(4)].concat(rec.data.map(x => x[i].toFixed(3)), ["", "", "", "", "", "4", "", "", i % 256 === 0 ? "71.0" : "", "", "0.002", "0.5", t > 45 && t < 48 ? "movement_detected" : "valid", "", "", "", "", "", ""]).join(",")); }
  const f = path.join(dir, "Muse2_recording_test.csv"); fs.writeFileSync(f, "﻿" + L.join("\r\n"));
  const r = R.replay({ in: f, quiet: true });
  ok(r.meta.format === "panel-csv" && r.hops.length > 200 && keysOk(r.summary), "old-format CSV replays (" + r.hops.length + " hops) and the summary has the expected keys");
  ok(r.hops.every(h => [h.f[0], h.s[0]].every(finiteOrNull)), "outputs finite or null");
  ok(r.events.some(e => e.type === "gap") && r.hops.some(h => h.f[3] === "movement"), "time_s gaps become gaps and the recorded motion state drives the gate");
  ok(r.hops.some(h => h.s[0] != null) && r.hops.every(h => h.rm == null), "heart_rate_bpm drives stress on heart rate only (no HRV)"); }
// a synthetic v2 recording
{ const out = path.join(dir, "Cyton_synth"); M.write(out, M.make({ device: "cyton", fast: 10, seed: 2 }), { fast: 10, seed: 2, noEngine: true });
  const r = R.replay({ in: out + "_meta.json", quiet: true });
  ok(r.meta.device === "cyton" && keysOk(r.summary) && r.hops.every(h => [h.f[0], h.s[0], h.d && h.d[0]].every(v => v === undefined || finiteOrNull(v))), "v2 recording replays; outputs finite/null; summary keys present");
  ok(r.buttons.some(b => b.type === "double_blink") && r.buttons.some(b => b.type === "clench_tap"), "buttons reach the replay output");
  const cfgFile = path.join(dir, "cfg.json"); fs.writeFileSync(cfgFile, JSON.stringify({ events: { cyton: { blinkFloorUv: 400 } } }));
  const r2 = R.replay({ in: out, config: cfgFile, quiet: true });
  ok(r2.config.events.cyton.blinkFloorUv === 400 && (r2.summary.events.blink || 0) < (r.summary.events.blink || 0), "--config changes a threshold measurably (blink floor 400 uV: blinks " + r.summary.events.blink + " -> " + (r2.summary.events.blink || 0) + ")"); }
// no --in: exits 0
{ const { spawnSync } = require("child_process"), s = spawnSync("node", [path.join(__dirname, "replay.js")], { encoding: "utf8" }); ok(s.status === 0, "no --in: exit 0 (" + s.stdout.trim().split(/\r?\n/)[0] + ")"); }
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
