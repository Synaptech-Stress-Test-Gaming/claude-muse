/* Deterministic engine tests. Run: node game/mkds.test.js */
"use strict";
const M = require("./mkds.js");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const IDLE = { steer: 0, accel: false, brake: false, drift: false, item: false };

// Helper: put the player on a straight stretch, alone, at standstill
function straightRace(pct) {
  const g = M.createRace({ seed: 7 });
  g.setFocus(pct, true);
  g.state = "racing"; g.t = 0;
  const P = g.player, T = g.T;
  // other karts out of the way: park them finished far off
  g.karts.forEach(k => { if (!k.isPlayer) { k.finished = true; k.finishTime = 1; k.x = 99999; k.y = 99999; k.ghostT = 1e9; } });
  const i0 = T.start + 60, p = T.pts[i0];
  P.x = p.x; P.y = p.y; P.h = Math.atan2(p.ty, p.tx); P.v = 0; P.idx = i0; P.s = p.s; P.dist = 1000;
  return g;
}
// steady state top speed on a straight, following the center line, no items or boosts
function topSpeed(pct) {
  const g = straightRace(pct), P = g.player, T = g.T;
  let best = 0;
  for (let f = 0; f < 60 * 14; f++) {
    // steer along the centerline so we stay on the road
    const tp = T.pts[(P.idx + 6) % T.N];
    const diff = M.wrap(Math.atan2(tp.y - P.y, tp.x - P.x) - P.h);
    g.step({ steer: M.clamp(diff * 2.5, -1, 1), accel: true, brake: false, drift: false, item: false });
    P.coins = 0;
    if (f > 60 * 10) best = Math.max(best, P.v);
  }
  return best;
}
const v0 = topSpeed(0), v50 = topSpeed(50), v100 = topSpeed(100);
console.log("top speeds", v0.toFixed(1), v50.toFixed(1), v100.toFixed(1));
ok(near(v50 / v50, 1, 1e-9) && near(v0 / v50, 0.5, 0.03), "focus 0 gives 0.5x top speed (" + (v0 / v50).toFixed(3) + ")");
ok(near(v100 / v50, 1.5, 0.05), "focus 100 gives 1.5x top speed (" + (v100 / v50).toFixed(3) + ")");
ok(near(v50, M.MAXV, 8), "focus 50 gives base top speed " + v50.toFixed(1));

// acceleration scales with focus: speed after 1.0 s from rest
function speedAt(pct, secs) { const g = straightRace(pct), P = g.player; for (let f = 0; f < 60 * secs; f++) g.step({ steer: 0, accel: true, brake: false, drift: false, item: false }); return P.v; }
const a0 = speedAt(0, 1), a50 = speedAt(50, 1), a100 = speedAt(100, 1);
ok(near(a0 / a50, 0.5, 0.03) && near(a100 / a50, 1.5, 0.03), "acceleration scales 0.5x/1x/1.5x (" + a0.toFixed(0) + "," + a50.toFixed(0) + "," + a100.toFixed(0) + ")");

// smoothing: multiplier eases, does not jump; null focus holds the last value
{
  const g = M.createRace({ seed: 1 }); g.setFocus(50, true); g.setFocus(100);
  g.step(IDLE); ok(g.m < 1.05 && g.m > 1, "multiplier eases instead of jumping (" + g.m.toFixed(3) + ")");
  g.setFocus(null); ok(g.focusPct === 100, "null focus holds the last value");
}

// mushroom boost keeps its own size, independent of focus
function mushPeak(pct) { const g = straightRace(pct), P = g.player; for (let f = 0; f < 60 * 8; f++) g.step({ steer: M.clamp(M.wrap(Math.atan2(g.T.pts[(P.idx + 6) % g.T.N].y - P.y, g.T.pts[(P.idx + 6) % g.T.N].x - P.x) - P.h) * 2.5, -1, 1), accel: true, brake: false, drift: false, item: false });
  const base = P.v; P.item = { type: "mush" }; g.step({ steer: 0, accel: true, item: true }); g.step({ steer: 0, accel: true, item: false }); return { base, add: P.boostAdd }; }
const m1 = mushPeak(0), m2 = mushPeak(100);
ok(near(m1.add, m2.add, 1e-6) && m1.add > 0, "mushroom boost add is the same at focus 0 and 100 (" + m1.add + ")");

// off-road slows; wall holds the kart in
{
  const g = straightRace(50), P = g.player, T = g.T; const p = T.pts[P.idx];
  P.x = p.x + p.nx * 120; P.y = p.y + p.ny * 120; P.v = 200;
  for (let f = 0; f < 40; f++) g.step({ steer: 0, accel: true, brake: false, drift: false, item: false });
  ok(P.v < 200 * 0.9, "grass slows the kart (v=" + P.v.toFixed(0) + ")");
  for (let f = 0; f < 600; f++) g.step({ steer: 0, accel: true, brake: false, drift: false, item: false });
  const d = T.global(P.x, P.y).d; ok(d <= M.WALLD + 1, "wall keeps kart inside (d=" + d.toFixed(0) + ")");
}

// full race with the player on autopilot at focus 50: laps counted, finish, results, AI finish
{
  const g = M.createRace({ seed: 42 }); g.setFocus(50, true);
  const P = g.player, T = g.T; let frames = 0, lapsSeen = [];
  g.events.length = 0;
  while (g.state !== "results" && frames < 60 * 400) {
    frames++;
    const tp = T.pts[(P.idx + 7) % T.N], diff = M.wrap(Math.atan2(tp.y - P.y, tp.x - P.x) - P.h);
    g.step({ steer: M.clamp(diff * 2.5, -1, 1), accel: true, brake: false, drift: false, item: false });
  }
  const laps = g.events.filter(e => e.type === "lap" && e.id === "mario").map(e => e.lap);
  ok(laps.join() === "1,2,3", "player laps counted 1,2,3 (" + laps.join() + ")");
  ok(P.finished && g.state === "results", "race reaches results (t=" + g.t.toFixed(1) + "s)");
  const fin = g.karts.filter(k => k.finished).length;
  ok(fin >= 6, "AI racers finish (" + fin + "/8 finished)");
  const lapTimes = g.karts.filter(k => !k.isPlayer && k.finished).map(k => k.finishTime / 3);
  console.log("AI avg lap seconds", (lapTimes.reduce((a, b) => a + b, 0) / lapTimes.length).toFixed(1), "track length", T.L.toFixed(0));
  ok(g.results && g.results.length === 8, "results list has 8 racers");
  const off = g.karts.filter(k => T.global(k.x, k.y).d > M.WALLD + 2).length; ok(off === 0, "no kart outside the barrier");
}

// seeded determinism
{
  function run(seed) { const g = M.createRace({ seed }); g.setFocus(50, true); for (let f = 0; f < 60 * 30; f++) g.step({ steer: 0, accel: true, brake: false, drift: false, item: false }); return g.karts.map(k => k.x.toFixed(3) + "," + k.y.toFixed(3)).join("|"); }
  ok(run(5) === run(5), "same seed gives identical race");
}

// drift: charge and mini-turbo stages
function driftTest(secs) {
  const g = straightRace(50), P = g.player; P.v = 200; P.idx = g.T.start + 60;
  let f = 0; const ev0 = g.events.length;
  g.step({ steer: 1, accel: true, drift: true });
  for (; f < 60 * secs; f++) g.step({ steer: 1, accel: true, drift: true });
  const st = P.mt, was = P.drift; g.step({ steer: 1, accel: true, drift: false });
  return { was, st, boost: P.boostT > 0, add: P.boostAdd, ev: g.events.slice(ev0).filter(e => e.type === "miniturbo").map(e => e.stage) };
}
{
  const a = driftTest(0.3), b = driftTest(0.9), c = driftTest(1.6);
  ok(a.was === 1 && !a.boost, "short drift gives no mini-turbo");
  ok(b.st === 1 && b.boost && b.ev[0] === 1, "stage 1 mini-turbo after ~0.9 s");
  ok(c.st === 2 && c.boost && c.ev[0] === 2 && c.add > b.add, "stage 2 mini-turbo after ~1.6 s is stronger");
}

// rocket start / burnout
{
  const g = M.createRace({ seed: 3 }); g.setFocus(50, true);
  for (let f = 0; f < 60 * 3.7; f++) g.step({ accel: false });
  while (g.t < 0) g.step({ accel: true });
  ok(g.player.rocket && g.player.boostT > 0, "rocket start when accelerating just before GO");
  const h = M.createRace({ seed: 3 }); h.setFocus(50, true);
  while (h.t < 0) h.step({ accel: true });
  ok(h.player.stallT > 0 && !h.player.rocket, "burnout when accelerating far too early");
}

// items: odds rows add up, pickup, use, hit
{
  const rows = Object.keys(M.ITEM_TABLE).map(k => M.ITEM_TABLE[k]);
  const sums = [0, 1, 2, 3, 4, 5, 6, 7].map(i => rows.reduce((a, r) => a + r[i], 0));
  console.log("odds sums by place (x2 coded, expect 200)", sums.join(","));
  ok(sums.every(s => s === 200), "item table columns each total 100 percent");
  const g = straightRace(50), P = g.player;
  // banana hits a kart
  const v = g.karts.find(k => k.id === "luigi"); v.finished = false; v.ghostT = 0; v.x = P.x + 200; v.y = P.y; v.v = 0;
  g.objs.push({ t: "banana", x: v.x, y: v.y, owner: "mario", born: -9, life: 9 });
  g.step(IDLE); ok(v.spinT > 0, "banana spins the kart that hits it");
  // green shell flies straight and hits
  const w = g.karts.find(k => k.id === "yoshi"); w.finished = false; w.ghostT = 0; w.x = P.x + Math.cos(P.h) * 200; w.y = P.y + Math.sin(P.h) * 200; w.v = 0;
  P.item = { type: "green" }; g.step({ item: true }); for (let f = 0; f < 60; f++) g.step(IDLE);
  ok(w.spinT > 0 || w.hits > 0, "green shell hits a kart ahead");
  // triple items count down
  P.item = { type: "tbanana" }; g.prevItem = false; g.step({ item: true }); g.step(IDLE); g.step({ item: true }); g.step(IDLE); g.step({ item: true });
  ok(P.item === null, "triple banana is used up after three presses");
  // star makes immune
  const s = straightRace(50), q = s.player; q.starT = 5; s.hitKart(q, "banana"); ok(q.spinT === 0, "star makes the kart immune");
  // item box starts roulette then grants an item
  const b = straightRace(50), r = b.player; b.boxes[0].x = r.x; b.boxes[0].y = r.y; b.boxes[0].respawn = 0; b.step(IDLE);
  ok(r.rouletteT > 0, "driving through an item box starts the roulette"); for (let f = 0; f < 120; f++) b.step(IDLE);
  ok(r.item && M.ITEM_NAMES[r.item.type], "roulette ends with an item (" + (r.item && r.item.type) + ")");
}


// ---- every item, one by one ----
function place(g, id, idxAhead, lat) {
  const k = g.karts.find(q => q.id === id), T = g.T, P = g.player, i = (P.idx + idxAhead) % T.N, p = T.pts[i];
  k.x = p.x + p.nx * (lat || 0); k.y = p.y + p.ny * (lat || 0); k.h = Math.atan2(p.ty, p.tx); k.v = 0; k.idx = i; k.s = p.s;
  k.dist = P.dist + idxAhead * 15; k.finished = false; k.finishTime = null; k.ghostT = 0; k.stallT = 99; k.spinT = 0; k.hits = 0; k.item = null;
  return k;
}
const run = (g, sec, inp) => { for (let f = 0; f < 60 * sec; f++) g.step(inp || { steer: 0, accel: false }); };
{
  // red shell homes on the kart ahead along the road
  const g = straightRace(50), P = g.player, t = place(g, "luigi", 22, 0);
  P.item = { type: "red" }; g.step({ item: true }); run(g, 3);
  ok(t.hits > 0, "red shell hits the kart ahead");
  // red shell follows a curve: target far enough ahead that the road bends
  const h = straightRace(50), P2 = h.player, t2 = place(h, "yoshi", 70, 0);
  P2.item = { type: "red" }; h.step({ item: true }); run(h, 6);
  ok(t2.hits > 0, "red shell follows the road to a kart around a bend");
}
{
  // Bob-omb thrown ahead explodes and tumbles a kart in the blast
  const g = straightRace(50), P = g.player, t = place(g, "toad", 12, 0);
  P.item = { type: "bomb" }; g.step({ item: true }); run(g, 4);
  ok(t.hits > 0 && g.events.some(e => e.type === "explode"), "Bob-omb explodes and hits a nearby kart");
}
{
  // Spiny Shell flies to the leader
  const g = straightRace(50), P = g.player, t = place(g, "wario", 60, 0);
  g.karts.forEach(k => { if (!k.isPlayer && k !== t) { k.finished = false; k.dist = -9999; } });
  P.item = { type: "spiny" }; g.step({ item: true }); run(g, 5);
  ok(t.hits > 0, "Spiny Shell reaches and hits the leader");
}
{
  // Thunderbolt shrinks and slows everyone else, not the user
  const g = straightRace(50), P = g.player, a = place(g, "peach", 20, 0), b = place(g, "dk", 30, 0);
  a.stallT = 0; b.stallT = 0; a.ghostT = 0; b.ghostT = 0;
  P.item = { type: "thunder" }; g.step({ item: true });
  ok(a.shrinkT > 5 && b.shrinkT > 5 && P.shrinkT === 0 && a.spinT > 0, "Thunderbolt shrinks the others but not the user");
}
{
  // Blooper inks the others
  const g = straightRace(50), P = g.player, a = place(g, "peach", 20, 0);
  P.item = { type: "blooper" }; g.step({ item: true });
  ok(a.inkT > 5 && P.inkT === 0, "Blooper inks the other racers");
}
{
  // Boo turns you ghostly, makes you immune, and steals an item
  const g = straightRace(50), P = g.player, a = place(g, "peach", 8, 0);
  a.item = { type: "star" }; a.ai.itemWait = 99; P.item = { type: "boo" }; g.step({ item: true });
  ok(P.ghostT > 5 && P.item && P.item.type === "star" && a.item === null, "Boo makes you a ghost and steals an item");
  ok(g.hitKart(P, "banana") === false && P.spinT === 0, "ghost is immune to hits");
}
{
  // Bullet Bill flies the line at the same speed regardless of focus
  const sp = f => { const g = straightRace(f), P = g.player; P.item = { type: "bullet" }; g.step({ item: true }); run(g, 3, { steer: 0, accel: false }); return P.v; };
  const b0 = sp(0), b100 = sp(100);
  ok(near(b0, b100, 1) && b0 > M.MAXV * 1.3, "Bullet Bill speed is " + b0.toFixed(0) + " at focus 0 and " + b100.toFixed(0) + " at focus 100 (not scaled)");
}
{
  // Golden Mushroom: repeated boosts for 7 s, then gone
  const g = straightRace(50), P = g.player;
  P.item = { type: "gold" }; g.step({ item: true }); g.step({ item: false }); run(g, 0.3); g.step({ item: true }); g.step({ item: false });
  ok(P.boostT > 0 && P.item && P.item.type === "gold", "Golden Mushroom boosts again and again");
  run(g, 7.5); ok(P.item === null, "Golden Mushroom runs out after about 7 seconds");
}
{
  // Star knocks karts over on contact; coins give a little top speed
  const g = straightRace(50), P = g.player, a = place(g, "bowser", 1, 0); a.stallT = 99;
  P.starT = 5; a.x = P.x + Math.cos(P.h) * 20; a.y = P.y + Math.sin(P.h) * 20; g.step({ steer: 0, accel: true });
  ok(a.spinT > 0, "star kart spins a kart it touches");
  const c0 = topSpeedCoins(0), c10 = topSpeedCoins(10);
  ok(c10 > c0 * 1.04, "ten coins raise top speed (" + c0.toFixed(0) + " -> " + c10.toFixed(0) + ")");
}
function topSpeedCoins(n) { const g = straightRace(50), P = g.player, T = g.T; let best = 0;
  for (let f = 0; f < 60 * 12; f++) { const tp = T.pts[(P.idx + 6) % T.N], d = M.wrap(Math.atan2(tp.y - P.y, tp.x - P.x) - P.h); P.coins = n; g.step({ steer: M.clamp(d * 2.5, -1, 1), accel: true }); if (f > 60 * 10) best = Math.max(best, P.v); } return best; }
{
  // wall bounce reflects speed, never lets the kart out
  const g = straightRace(50), P = g.player, T = g.T, p = T.pts[P.idx];
  P.x = p.x + p.nx * 174; P.y = p.y + p.ny * 174; P.h = Math.atan2(p.ny, p.nx); P.v = 220; g.step({ steer: 0, accel: true });
  ok(T.global(P.x, P.y).d <= M.WALLD + 0.5 && P.v < 200, "driving straight into the barrier slows and keeps the kart in (v=" + P.v.toFixed(0) + ")");
}
{
  // mini-turbo stage 3
  const d = driftTest(2.5), c = driftTest(1.6);
  ok(d.st === 3 && d.ev[0] === 3 && d.add > c.add, "stage 3 mini-turbo (purple) after ~2.5 s is the strongest (add " + d.add.toFixed(0) + " vs " + c.add.toFixed(0) + ")");
}
{
  // rubberbanding: AI ahead of the player gets slowed, AI far behind gets sped up
  const g = M.createRace({ seed: 9 }); const ai = g.karts[0];
  ai.dist = g.player.dist + 3000; const slow = g.rubber(ai); ai.dist = g.player.dist - 3000; const fast = g.rubber(ai);
  ok(slow < 1 && fast > 1, "AI rubberbanding slows leaders (" + slow.toFixed(2) + ") and helps stragglers (" + fast.toFixed(2) + ")");
}
{
  // grid and characters: 8 distinct racers, you are Mario
  const g = M.createRace({ seed: 1 }); const ids = g.karts.map(k => k.id);
  ok(new Set(ids).size === 8 && g.player.id === "mario" && ["peach", "luigi", "yoshi", "toad", "dk", "wario", "bowser"].every(i => ids.includes(i)), "8 default racers, player is Mario");
}

console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
process.exit(fails ? 1 : 0);
