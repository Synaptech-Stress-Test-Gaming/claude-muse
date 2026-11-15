/* End-to-end tests of engine/pipeline.js on fixtures, both devices. Run: node engine/pipeline.test.js */
"use strict";
const K = require("./testkit.js"), F = K.F, P = K.P, CS = require("../adapters/cyton-sim.js");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }
const isNumOrNull = v => v === null || (typeof v === "number" && isFinite(v));
const STATES = ["live", "held", "stale", "learning", "unavailable"];

function schemaErrors(o, dev) {
  const e = [], need = (cond, m) => { if (!cond) e.push(m); };
  need(typeof o.t === "number" && o.device === dev, "t/device");
  need(o.profile && "id" in o.profile && "label" in o.profile && typeof o.profile.confidence === "number" && typeof o.profile.state === "string" && typeof o.profile.badge === "string", "profile");
  for (const k of ["focus", "stress", "drowsiness"]) {
    const m = o[k]; if (k === "drowsiness" && dev === "muse") { need(m === null, "drowsiness null on the Muse"); continue; }
    need(m && isNumOrNull(m.value) && typeof m.conf === "number" && m.conf >= 0 && m.conf <= 1 && STATES.includes(m.state) && (m.reason === null || typeof m.reason === "string"), k + " fields");
    const nullish = m.state === "stale" || m.state === "unavailable" || (k === "drowsiness" && m.state === "learning");
    need((m.value === null) === nullish, k + ": value null iff stale/unavailable (or drowsiness learning) [" + m.state + " " + m.value + "]");
  }
  const c = o.stress.components; need(c && ["hr", "hrv", "eeg"].every(x => c[x] && typeof c[x].valid === "boolean" && isNumOrNull(c[x].z)) && "bpm" in c.hr && "rmssdMs" in c.hrv && typeof o.stress.exertion === "boolean", "stress components");
  if (dev === "cyton") need(["ratio", "blinkDur", "blinkRate", "perclos", "spindles"].every(x => o.drowsiness.markers[x] && typeof o.drowsiness.markers[x].valid === "boolean"), "drowsiness markers");
  need(Array.isArray(o.events) && o.events.every(v => Number.isInteger(v.id) && typeof v.type === "string" && typeof v.t === "number" && "onset" in v), "events");
  const q = o.quality; need(q && Array.isArray(q.perChannel) && Array.isArray(q.excluded) && ["valid", "movement", "no_data", "proxy"].includes(q.motion) && typeof q.packetLoss === "number" && Array.isArray(q.warnings), "quality");
  need(dev === "cyton" ? q.ecg && "bpm" in q.ecg && "sqi" in q.ecg && "state" in q.ecg : q.ecg === null, "quality.ecg");
  need(o.legacy && "focus" in o.legacy && "stress" in o.legacy && isNumOrNull(o.legacy.focus), "legacy");
  return e;
}
const nanFree = outs => !JSON.stringify(outs).match(/NaN|Infinity/) && outs.every(o => [o.focus.value, o.stress.value, o.drowsiness && o.drowsiness.value].every(v => v == null || isFinite(v)));

// 10 min of clean data, both devices: schema, no events, focus 35-65 after 3 min, no NaN
for (const dev of ["cyton", "muse"]) {
  const r = K.rec(dev, 600, 71), { outs, events, buttons } = K.run(r, { engine: { legacyProvider: dev === "muse" ? () => ({ focus: 50, stress: null }) : null } });
  const errs = [].concat(...outs.map(o => schemaErrors(o, dev)));
  ok(errs.length === 0, dev + ": output schema exact on every hop" + (errs.length ? " (" + [...new Set(errs)].slice(0, 4).join("; ") + ")" : ""));
  ok(events.length === 0 && buttons.length === 0, dev + ": 10 min of clean data -> no events (" + events.map(e => e.type).slice(0, 5).join(",") + ")");
  const means = []; for (let a = 180; a < 600; a += 30) means.push(K.mean(outs.filter(o => o.t >= a && o.t < a + 30 && o.focus.value != null).map(o => o.focus.value)));
  ok(means.every(m => m >= 35 && m <= 65), dev + ": focus within 35-65 after the first 3 min (30 s means " + Math.min(...means).toFixed(1) + " to " + Math.max(...means).toFixed(1) + ")");
  ok(nanFree(outs), dev + ": zero NaN");
  ok(outs.every(o => o.legacy && "focus" in o.legacy) && (dev === "cyton" || outs.every(o => o.legacy.focus === 50)), dev + ": New and Legacy values present every hop");
}
// scripted artifacts: masking per metric and the live -> held -> stale -> live sequence with the right reason
{ const r = K.rec("cyton", 150, 72); F.tension(r, 60, 6); F.motion(r, 90, 6); F.gap(r, 120, 6);
  const { outs, eng, events } = K.run(r);
  const seq = (a, b, key) => { const s = []; for (const o of outs.filter(x => x.t >= a && x.t < b)) { const v = o[key].state + (o[key].reason ? "/" + o[key].reason : ""); if (s[s.length - 1] !== v) s.push(v); } return s; };
  const ten = seq(59, 72, "focus"), mov = seq(89, 102, "focus");
  const order = (s, reason) => { const iH = s.findIndex(x => x === "held/" + reason), iS = s.findIndex(x => x === "stale/" + reason), iL = s.findIndex((x, i) => i > iS && (x.startsWith("live") || x.startsWith("learning"))); return iH > 0 && iS > iH && iL > iS; };
  ok(order(ten, "muscle"), "6 s of muscle tension: focus live -> held -> stale -> live, reason muscle (" + ten.join(" > ") + ")");
  ok(order(mov, "movement"), "6 s of head movement: focus live -> held -> stale -> live, reason movement (" + mov.join(" > ") + ")");
  const stressDuringTension = outs.filter(o => o.t > 62 && o.t < 66).map(o => o.stress.state);
  ok(stressDuringTension.every(s => s === "live" || s === "learning"), "muscle tension does not mask the ECG-driven stress (" + [...new Set(stressDuringTension)].join(",") + ")");
  const gp = seq(119, 132, "focus"); ok(gp.some(x => x === "stale/signal lost") && events.some(e => e.type === "gap"), "a 6 s gap -> 'signal lost' (" + gp.join(" > ") + ")");
  ok(eng.debug().epochs >= 1, "a gap longer than 5 s opens a new contact epoch (" + eng.debug().epochs + ")"); }
// Muse: drowsiness null, no button events
{ const r = K.rec("muse", 60, 73); F.doubleBlink(r, 20, 350); F.clench(r, 30); const { outs, buttons } = K.run(r);
  ok(outs.every(o => o.drowsiness === null) && buttons.length === 0 && !outs.some(o => o.events.some(e => e.type === "double_blink" || e.type === "clench_tap")), "Muse: drowsiness null and no button events"); }
// Cyton default simulator script (the browser simulator's frames): double_blink and clench_tap with latency < 400 ms
{ let wall = 0; const frames = [], msgs = []; const sim = CS.create({ fs: 125, seed: 1, script: "default", now: () => wall, setInterval: () => 1, clearInterval: () => 0, onFrame: f => frames.push(f), onMessage: m => msgs.push(m) });
  sim.start(); for (wall = 0; wall <= 31000; wall += 40) sim.tick();
  const cfg = msgs.find(m => m.type === "config"), eng = P.create({ device: "cyton", fs: 125, channels: cfg.channels, ecgChannel: cfg.ecgChannel }), btn = [];
  eng.onEvent = e => btn.push(e); for (const f of frames) eng.push(f);
  const db = btn.find(b => b.type === "double_blink"), ct = btn.find(b => b.type === "clench_tap");
  ok(db && db.t - (8.35 + 0.42) < 0.4 && db.t > 8.5, "default script: double_blink (8.00 + 8.35 s) emitted at " + (db ? db.t.toFixed(2) : "never") + " s (latency < 400 ms)");
  ok(ct && ct.t - 12.4 < 0.4 && ct.t > 12.2, "default script: clench_tap (12 s) emitted at " + (ct ? ct.t.toFixed(2) : "never") + " s (latency < 400 ms)");
  ok(btn.length === 2, "default script: no other button events in 30 s (" + btn.map(b => b.type + "@" + b.t.toFixed(1)).join(",") + ")"); }
// determinism
{ const a = K.run(K.rec("cyton", 40, 74)), b = K.run(K.rec("cyton", 40, 74)); ok(JSON.stringify(a.outs) === JSON.stringify(b.outs), "same seed -> identical output JSON"); }
// performance budget
{ const r = K.rec("cyton", 60, 75, { fs: 250 }), fr = F.frames(r), eng = P.create({ device: "cyton", fs: 250, channels: r.channels, ecgChannel: r.ecgChannel, flags: { asr: true } });
  const t0 = Date.now(); for (const f of fr) eng.push(f); const dt = (Date.now() - t0) / 1000;
  ok(dt < 6, "60 s of 16-channel 250 Hz data with ASR on: " + dt.toFixed(2) + " s (< 6 s)");
  const m = K.rec("muse", 60, 76), fm = F.frames(m), em = P.create({ device: "muse", fs: 256, channels: m.channels }); const t1 = Date.now(); for (const f of fm) em.push(f); const dm = (Date.now() - t1) / 1000;
  ok(dm < 2, "60 s of Muse data: " + dm.toFixed(2) + " s (< 2 s)"); }
// store null, tuned null, tuned override
{ const r = K.rec("cyton", 40, 77);
  const a = K.run(r, { engine: { store: null, tuned: null } }), b = K.run(r, { engine: { tuned: { config: { focus: { wBeta: 0 }, events: { emgRatioIn: 4 } } } } });
  ok(a.outs.length > 100 && nanFree(a.outs), "works with store: null and tuned: null");
  ok(b.eng.cfg.focus.wBeta === 0 && b.eng.cfg.events.emgRatioIn === 4 && b.eng.cfg.focus.wTheta === 1 && JSON.stringify(a.outs.map(o => o.focus.value)) !== JSON.stringify(b.outs.map(o => o.focus.value)), "a tuned object overrides a constant (wBeta 0, emgRatioIn 4) and the rest stays default"); }
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
