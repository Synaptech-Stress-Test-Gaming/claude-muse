/* Tests for panel/validation.js (block table and markers). Run: node panel/validation.test.js */
"use strict";
const V = require("./validation.js");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }
const order = ["rest_open", "rest_closed", "nback", "arith", "rest2", "art_blink", "art_dblink", "art_clench", "art_clench_long", "art_frown", "art_talk", "art_chew", "art_turn", "art_nod", "art_stand", "art_type", "game", "fixation"];
ok(V.BLOCKS.length === 18 && V.BLOCKS.every((b, i) => b.id === order[i]), "18 blocks in the documented order");
const tot = V.totalS(1) / 60;
// the block table adds up to 31.9 min (the prompt's "25 min +/- 2" does not match its own table; see IMPLEMENTATION_NOTES)
ok(Math.abs(tot - 32) <= 2, "total duration " + tot.toFixed(1) + " min (the table's sum, 32 +/- 2)");
ok(V.BLOCKS.filter(b => b.dur != null).every(b => V.durOf(b, 10) === b.dur / 10) && V.durOf(V.BLOCKS[6], 10) === V.durOf(V.BLOCKS[6]) / 10 && V.cues(V.BLOCKS[6], 10).join() === "0,4", "&fast=1: continuous blocks / 10; trial blocks keep the 4 s spacing with 1/10 of the trials (2 double blinks, 8 s)");
ok(V.durOf(V.BLOCKS[5]) === 60 && V.cues(V.BLOCKS[5]).length === 20 && V.cues(V.BLOCKS[8])[1] === 6 && V.cues(V.BLOCKS[14]).join() === "0,15,30", "trial blocks: 20 x 3 s, cues every trial, 3 x 15 s stand");
const m = V.marker(12.3456, 1700000000000, 2, "nback K target", "cue", 7);
ok(m.t === 12.346 && m.wall === 1700000000000 && m.block === "nback" && m.label === "nback K target" && m.kind === "cue" && m.n === 7 && Object.keys(m).join() === "t,wall,block,label,kind,n", "marker shape {t, wall, block, label, kind, n}");
ok(V.marker(1, 2, "fixation", null, "end").block === "fixation" && V.marker(1, 2, "fixation", null, "end").label === "end", "markers by block id");
let threw = 0; try { V.marker(1, 2, 99, "x", "start"); } catch (e) { threw++; } try { V.marker(1, 2, 0, "x", "middle"); } catch (e) { threw++; } ok(threw === 2, "bad block or kind rejected");
ok(V.READ.length > 300, "a neutral paragraph to read aloud");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
