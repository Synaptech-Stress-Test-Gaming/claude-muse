/* engine/testkit.js: Node-only helpers for the engine tests (runs fixture records through MuseEngine.create). Not loaded by the page. */
"use strict";
const F = require("./fixtures.js"), P = require("./pipeline.js");
function run(rec, opts) {
  opts = opts || {};
  const eng = P.create(Object.assign({ device: rec.device, fs: rec.fs, channels: rec.channels, ecgChannel: rec.ecgChannel, flags: { asr: false } }, opts.engine || {}));
  const outs = [], buttons = [];
  eng.onEvent = e => buttons.push(Object.assign({}, e));
  const frames = F.frames(rec, opts.frameMs, opts.frameOpts);
  for (const f of frames) { if (opts.before) opts.before(f, eng); for (const o of eng.push(f)) { outs.push(o); if (opts.each) opts.each(o, eng); } }
  return { eng, outs, buttons, events: outs.flatMap(o => o.events) };
}
function rec(dev, seconds, seed, o) {
  o = o || {}; const fs = o.fs || (dev === "muse" ? 256 : 125);
  const r = F.eeg(Object.assign({ device: dev, fs, seconds, seed }, o.eeg || {}));
  if (dev === "cyton" && o.ecg !== false) F.addEcg(r, o.ecgOpts || {});
  if (dev === "muse" && o.ppg !== false) F.addPpg(r, o.ppgOpts || {});
  return r;
}
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
module.exports = { run, rec, mean, F, P };
