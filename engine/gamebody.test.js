/* Tests for engine/gamebody.js. Run: node engine/gamebody.test.js */
"use strict";
const G = require("./gamebody.js");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }
const out = (fs, fv, ss, sv) => ({ focus: { value: fv, conf: 0.7, state: fs, reason: fs === "stale" ? "movement" : null }, stress: { value: sv, conf: 0.5, state: ss, reason: ss === "stale" ? "movement" : null },
  drowsiness: null, profile: { label: "Julian", confidence: 0.82, templateVector: [1, 2, 3] }, legacy: { focus: 55.1, stress: null }, quality: { perChannel: [] } });
const base = { device: "muse", mode: "focus", sensors: [96, 96, 97, 72], motion: "VALID", session: 1731490000000, seq: 812 };

// old fields unchanged in name, type and meaning, both modes
const bn = G.build(Object.assign({}, base, { engine: "new", out: out("live", 63.24, "stale", null) }));
ok(Object.keys(bn).slice(0, 5).join() === "focus,mode,sensors,motion,stale" && bn.focus === 63.2 && bn.mode === "focus" && bn.sensors.length === 4 && bn.motion === "VALID" && bn.stale === false, "New: the first five fields keep their names, types and meaning");
const bl = G.build(Object.assign({}, base, { engine: "legacy", legacyFocus: 41.26, legacyStale: true, out: out("live", 63, "live", 50) }));
ok(bl.focus === 41.3 && bl.stale === true && bl.engine === "legacy", "Legacy: focus is the Legacy value and stale the motion hold, as before");
// nulls stay null
const bs = G.build(Object.assign({}, base, { engine: "new", out: out("stale", null, "unavailable", null) }));
ok(bs.focus === null && bs.stale === true && bs.metrics.focus.value === null && bs.metrics.stress.value === null && bs.metrics.focus.reason === "movement", "nulls are sent as null (never 0), with the reason");
const bh = G.build(Object.assign({}, base, { engine: "new", out: out("held", 58.04, "live", 40) })); ok(bh.focus === 58 && bh.stale === true, "held: the held number is sent and marked stale");
ok(G.build(Object.assign({}, base, { engine: "new", out: null })).focus === null, "no engine output yet -> focus null");
ok(bn.v === 2 && bn.session === base.session && bn.seq === 812 && bn.device === "muse" && bn.engine === "new" && bn.profile.label === "Julian" && bn.profile.conf === 0.82 && bn.legacy.focus === 55.1, "new fields present");
// queue + ack
const Q = G.queue(); for (let i = 1; i <= 40; i++) Q.push({ id: i, type: i % 2 ? "double_blink" : "clench_tap", t: i, conf: 0.9 }); Q.push({ id: 41, type: "blink", t: 41 });
const big = G.build(Object.assign({}, base, { engine: "new", out: out("live", 50, "live", 50), events: Q.batch() }));
const size = Buffer.byteLength(JSON.stringify(big), "utf8");
ok(big.events.length === 32 && size < 8192, "32 events per post, body " + size + " bytes (< 8 KB); only button events are queued");
Q.reply({ ok: true, ack: 20 }); ok(Q.items.length === 20 && Q.items[0].id === 21, "ack drops only acknowledged events and keeps the rest for resending");
Q.batch(); Q.reply({ ok: true, ack: 15 }); ok(Q.items.length === 20, "an older ack drops nothing new");
Q.batch(); Q.reply(null); ok(Q.items.length === 20, "a failed post drops nothing");
Q.batch(); Q.reply({ ok: true }); ok(Q.items.length === 0, "a reply without ack (an old server) acknowledges everything that was sent");
// no key named like a template or a statistic leaks
const keys = []; (function walk(o) { if (o && typeof o === "object") for (const k in o) { keys.push(k); walk(o[k]); } })(big);
ok(!keys.some(k => /templ|hist|vector|summar|eeg|ecg|identity|^S$|^W$/i.test(k)), "no template / statistics keys in the body (" + [...new Set(keys)].join(",") + ")");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
