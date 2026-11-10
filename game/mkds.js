/* Mario Kart DS style race engine (Figure-8 Circuit). Pure logic, no DOM: runs in the browser and in node tests.
   Fixed timestep, seeded randomness. A private, non-commercial fan recreation: all art is drawn in code.
   Values marked (approx) are best guesses from public descriptions of MKDS, not extracted game data.
   Item odds are the real MKDS Grand Prix (player) table, copied as listed on the Super Mario Wiki (percent x 2). */
(function (root) {
"use strict";
const DT = 1 / 60;
const TAU = Math.PI * 2;
const MAXV = 250;            // base top speed in world units per second at focus multiplier 1.0 (approx 150cc feel)
const ACC = MAXV / 2.4;      // base acceleration, units/s^2 (approx)
const HALF = 85;             // road half width
const WALLD = 175;           // distance from centerline where the barrier stands
const KR = 17;               // kart radius
const LAPS = 3;
const MT1 = 0.55, MT2 = 1.3, MT3 = 2.1; // drift charge seconds for mini-turbo stage 1 (blue), 2 (orange), 3 (purple) (approx)
const SUB = 24;              // samples per control segment

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const wrap = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

function rng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0; let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- the 8 default MKDS racers ---------------- */
const CHARS = [
  { id: "mario", name: "Mario", skill: 1, w: 1.0, cap: "#e52521", skin: "#f5c9a0", hair: "#5a2d0c", kart: "#e52521", kart2: "#f5d63d" },
  { id: "peach", name: "Peach", skill: .975, w: .8, cap: "#ff8fc7", skin: "#f8d7b8", hair: "#f2c14e", kart: "#ff7fbd", kart2: "#fff1f8" },
  { id: "luigi", name: "Luigi", skill: .985, w: 1.0, cap: "#2e9a2e", skin: "#f5c9a0", hair: "#5a2d0c", kart: "#2fae3f", kart2: "#1a5aa8" },
  { id: "yoshi", name: "Yoshi", skill: .97, w: .8, cap: "#46c14a", skin: "#7ed957", hair: "#46c14a", kart: "#46c14a", kart2: "#ffffff" },
  { id: "toad", name: "Toad", skill: .965, w: .75, cap: "#f4f4f4", skin: "#f5d9bb", hair: "#e52521", kart: "#3a73d6", kart2: "#f4f4f4" },
  { id: "dk", name: "Donkey Kong", skill: .98, w: 1.3, cap: "#7a4a1d", skin: "#c18a5a", hair: "#5b3414", kart: "#8a5a2b", kart2: "#e52521" },
  { id: "wario", name: "Wario", skill: .99, w: 1.25, cap: "#f4d11f", skin: "#f1bf93", hair: "#4b3a2a", kart: "#d9b81a", kart2: "#7a3ab5" },
  { id: "bowser", name: "Bowser", skill: 1.0, w: 1.5, cap: "#e8761c", skin: "#e8b43c", hair: "#d8591a", kart: "#2f8f3a", kart2: "#e8761c" }
];

/* ---------------- items: MKDS Grand Prix (player) odds by place 1..8, values are percent x 2 ---------------- */
const ITEM_TABLE = {
  green:   [45, 25, 15, 5, 0, 0, 0, 0],
  red:     [0, 55, 40, 25, 20, 10, 0, 0],
  banana:  [90, 30, 15, 5, 0, 0, 0, 0],
  fake:    [35, 20, 10, 0, 0, 0, 0, 0],
  mush:    [0, 30, 40, 45, 40, 35, 10, 0],
  tmush:   [0, 0, 10, 30, 55, 60, 70, 30],
  bomb:    [0, 10, 20, 20, 10, 0, 0, 0],
  spiny:   [0, 0, 0, 10, 20, 15, 0, 0],
  thunder: [0, 0, 0, 0, 0, 10, 20, 45],
  tgreen:  [0, 15, 25, 20, 10, 0, 0, 0],
  tbanana: [30, 15, 5, 0, 0, 0, 0, 0],
  tred:    [0, 0, 5, 15, 15, 5, 0, 0],
  star:    [0, 0, 0, 0, 10, 25, 40, 25],
  gold:    [0, 0, 0, 0, 0, 15, 35, 55],
  bullet:  [0, 0, 0, 0, 0, 10, 20, 45],
  blooper: [0, 0, 10, 15, 10, 5, 0, 0],
  boo:     [0, 0, 5, 10, 10, 10, 5, 0]
};
const ITEM_NAMES = {
  green: "Green Shell", red: "Red Shell", banana: "Banana", fake: "Fake Item Box", mush: "Mushroom", tmush: "Triple Mushrooms",
  bomb: "Bob-omb", spiny: "Spiny Shell", thunder: "Thunderbolt", tgreen: "Triple Green Shells", tbanana: "Triple Bananas",
  tred: "Triple Red Shells", star: "Star", gold: "Golden Mushroom", bullet: "Bullet Bill", blooper: "Blooper", boo: "Boo"
};
const TRIPLE = { tmush: ["mush", 3], tgreen: ["green", 3], tred: ["red", 3], tbanana: ["banana", 3] };

/* ---------------- Figure-8 Circuit ---------------- */
// Two loops joined by a crossing at the origin. The real course crosses on a bridge; here the crossing is flat (approx).
const CTRL = [
  [0, 0], [400, -280], [780, -440], [1100, -360], [1280, -120], [1280, 160], [1100, 380], [780, 450], [400, 290],
  [0, 0], [-400, -280], [-780, -440], [-1100, -360], [-1280, -120], [-1280, 160], [-1100, 380], [-780, 450], [-400, 290]
];
function buildTrack() {
  const n = CTRL.length, pts = [];
  for (let i = 0; i < n; i++) {
    const p0 = CTRL[(i + n - 1) % n], p1 = CTRL[i], p2 = CTRL[(i + 1) % n], p3 = CTRL[(i + 2) % n];
    for (let j = 0; j < SUB; j++) {
      const t = j / SUB, t2 = t * t, t3 = t2 * t;
      const f = k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      pts.push({ x: f(0), y: f(1) });
    }
  }
  const N = pts.length; let s = 0;
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[(i + 1) % N], c = pts[(i + N - 1) % N];
    let tx = b.x - c.x, ty = b.y - c.y; const l = Math.hypot(tx, ty); tx /= l; ty /= l;
    a.tx = tx; a.ty = ty; a.nx = -ty; a.ny = tx; a.s = s; s += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const L = s;
  for (let i = 0; i < N; i++) { const b = pts[(i + 1) % N]; pts[i].len = Math.hypot(b.x - pts[i].x, b.y - pts[i].y); }
  const start = SUB * 1; // start line at control point 1
  const T = { pts, N, L, start, sStart: pts[start].s, half: HALF, wall: WALLD };
  T.segDist = function (x, y, i) {
    const a = pts[i], b = pts[(i + 1) % N], dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy; let t = l2 ? ((x - a.x) * dx + (y - a.y) * dy) / l2 : 0; t = clamp(t, 0, 1);
    const px = a.x + dx * t, py = a.y + dy * t;
    return { d: Math.hypot(x - px, y - py), t, px, py };
  };
  T.global = function (x, y) {
    let best = null, bi = 0;
    for (let i = 0; i < N; i++) { const r = T.segDist(x, y, i); if (!best || r.d < best.d) { best = r; bi = i; } }
    best.i = bi; return best;
  };
  T.window = function (x, y, i0, back, fwd) {
    let best = null, bi = i0;
    for (let k = -back; k <= fwd; k++) { const i = (i0 + k + N * 4) % N, r = T.segDist(x, y, i); if (!best || r.d < best.d) { best = r; bi = i; } }
    best.i = bi; return best;
  };
  T.at = function (sf) { // point at sample position sf (float)
    const i = ((Math.floor(sf) % N) + N) % N, t = sf - Math.floor(sf), a = pts[i], b = pts[(i + 1) % N];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, tx: a.tx + (b.tx - a.tx) * t, ty: a.ty + (b.ty - a.ty) * t, nx: a.nx + (b.nx - a.nx) * t, ny: a.ny + (b.ny - a.ny) * t };
  };
  return T;
}
const TRACK = buildTrack();

/* ---------------- race ---------------- */
function createRace(opts) {
  opts = opts || {};
  const rand = rng(opts.seed == null ? 1234 : opts.seed);
  const T = TRACK, laps = opts.laps || LAPS;
  const g = {
    T, laps, rand, t: -4, state: "countdown", karts: [], objs: [], boxes: [], coins: [], events: [], frame: 0,
    m: 1, mTarget: 1, focusPct: 50, resultsT: 0, results: null, over: false
  };

  g.setFocus = function (pct, instant) {
    if (pct == null || isNaN(pct)) return; // hold the last value when the signal drops
    g.focusPct = clamp(pct, 0, 100);
    g.mTarget = 0.5 + g.focusPct / 100;  // 0 -> 0.5x, 50 -> 1.0x, 100 -> 1.5x
    if (instant) g.m = g.mTarget;
  };

  // grid: player starts last, as in a first Grand Prix race
  const order = ["peach", "luigi", "yoshi", "toad", "dk", "wario", "bowser", "mario"];
  order.forEach((id, gi) => {
    const c = CHARS.find(q => q.id === id), sp = T.pts[T.start];
    const row = gi >> 1, side = (gi & 1) ? 1 : -1;
    const back = 60 + row * 62 + (gi & 1) * 24;
    const x = sp.x - sp.tx * back + sp.nx * side * 38, y = sp.y - sp.ty * back + sp.ny * side * 38;
    const k = {
      id: c.id, c, isPlayer: id === "mario", x, y, h: Math.atan2(sp.ty, sp.tx), v: 0,
      drift: 0, driftT: 0, hop: 0, boostT: 0, boostAdd: 0, spinT: 0, spinAng: 0, starT: 0, shrinkT: 0, ghostT: 0, bulletT: 0, goldT: 0, goldCd: 0, inkT: 0,
      item: null, rouletteT: 0, coins: 0, idx: T.start - 2 - row * 4, s: 0, dist: -back, lap: 0, finished: false, finishTime: null, place: gi + 1,
      stallT: 0, accelHeldSince: null, rocket: false, bo: 0, hits: 0,
      ai: { lane: (rand() - .5) * 90, skill: c.skill * (0.99 + rand() * 0.02), itemWait: 0, driftOn: false, mtT: 0, pause: 0 }
    };
    k.idx = ((T.start - Math.round(back / 15)) + T.N) % T.N;
    k.s = T.pts[k.idx].s;
    g.karts.push(k);
  });
  g.player = g.karts.find(k => k.isPlayer);

  // item boxes (4 across) and coins
  [0.09, 0.27, 0.47, 0.60, 0.78, 0.92].forEach(f => {
    const sf = (T.start + f * T.N) % T.N, p = T.at(sf);
    [-66, -22, 22, 66].forEach(o => g.boxes.push({ x: p.x + p.nx * o, y: p.y + p.ny * o, respawn: 0 }));
  });
  [0.04, 0.17, 0.33, 0.55, 0.70, 0.86].forEach(f => {
    for (let q = 0; q < 6; q++) { const p = T.at((T.start + f * T.N + q * 2.5) % T.N); g.coins.push({ x: p.x + p.nx * ((q % 2) ? 20 : -20), y: p.y + p.ny * ((q % 2) ? 20 : -20), got: false }); }
  });

  const ev = (type, k, extra) => g.events.push(Object.assign({ type, t: g.t, id: k && k.id }, extra || {}));

  function hitKart(k, kind) {
    if (k.starT > 0 || k.bulletT > 0 || k.ghostT > 0 || k.spinT > 0.3) return false;
    k.spinT = kind === "bomb" ? 1.5 : 1.1; k.spinAng = 0; k.drift = 0; k.driftT = 0; k.boostT = 0; k.goldT = 0;
    k.v *= 0.25; if (k.coins > 0) k.coins--; k.hits++;
    ev("hit", k, { kind });
    return true;
  }
  g.hitKart = hitKart;

  function giveBoost(k, add, secs) { k.boostAdd = Math.max(k.boostT > 0 ? k.boostAdd : 0, add); k.boostT = Math.max(k.boostT, secs); }

  function placeOf(k) { return g.karts.filter(o => rank(o) > rank(k)).length + 1; }
  function rank(k) { return k.finished ? 1e9 - k.finishTime : k.dist; }

  function pickItem(k) {
    const pl = Math.min(8, Math.max(1, k.place)) - 1; let tot = 0;
    const keys = Object.keys(ITEM_TABLE);
    keys.forEach(q => tot += ITEM_TABLE[q][pl]);
    let r = rand() * tot;
    for (const q of keys) { r -= ITEM_TABLE[q][pl]; if (r < 0) return q; }
    return "mush";
  }

  function fwd(k) { return { x: Math.cos(k.h), y: Math.sin(k.h) }; }

  function useItem(k, back) {
    const it = k.item; if (!it || k.rouletteT > 0) return false;
    let type = it.type;
    const f = fwd(k), sgn = back ? -1 : 1;
    const spawn = (o) => g.objs.push(Object.assign({ owner: k.id, born: g.t, life: 20, vx: 0, vy: 0 }, o));
    let consumed = true;
    if (TRIPLE[type]) { const [base, n] = TRIPLE[type]; it.n = it.n == null ? n : it.n; type = base; it.n--; consumed = it.n <= 0; }
    switch (type) {
      case "mush": giveBoost(k, MAXV * 0.40, 1.6); k.v = Math.max(k.v, MAXV * 0.9); break;
      case "green": spawn({ t: "green", x: k.x + f.x * 30 * sgn, y: k.y + f.y * 30 * sgn, vx: f.x * 470 * sgn, vy: f.y * 470 * sgn, bounces: 0, life: 12 }); break;
      case "red": {
        const tgt = g.karts.filter(o => o !== k && o.dist > k.dist && !o.finished).sort((a, b) => a.dist - b.dist)[0];
        spawn({ t: "red", x: k.x + f.x * 30, y: k.y + f.y * 30, h: k.h, tgt: tgt ? tgt.id : null, life: 14 }); break; }
      case "banana": spawn({ t: "banana", x: k.x - f.x * 30 * sgn, y: k.y - f.y * 30 * sgn, life: 90 }); break;
      case "fake": spawn({ t: "fake", x: k.x - f.x * 30 * sgn, y: k.y - f.y * 30 * sgn, life: 90 }); break;
      case "bomb": spawn({ t: "bomb", x: k.x + f.x * 26 * sgn, y: k.y + f.y * 26 * sgn, vx: f.x * (k.v + 190) * sgn, vy: f.y * (k.v + 190) * sgn, fuse: 2.4, life: 6 }); break;
      case "spiny": {
        const lead = g.karts.filter(o => o !== k).sort((a, b) => rank(b) - rank(a))[0];
        spawn({ t: "spiny", sf: k.idx + 6, tgt: lead.id, x: k.x, y: k.y, life: 30 }); break; }
      case "thunder": g.karts.forEach(o => { if (o !== k && o.starT <= 0 && o.bulletT <= 0 && o.ghostT <= 0) { o.shrinkT = 6; o.spinT = Math.max(o.spinT, 0.6); o.v *= 0.5; o.drift = 0; } }); ev("thunder", k); break;
      case "blooper": g.karts.forEach(o => { if (o !== k) o.inkT = 6; }); break;
      case "boo": {
        k.ghostT = 6;
        const vic = g.karts.filter(o => o !== k && o.item && o.dist > k.dist - 400).sort((a, b) => Math.abs(a.dist - k.dist) - Math.abs(b.dist - k.dist))[0];
        if (vic) { k.item = vic.item; vic.item = null; ev("steal", k, { from: vic.id }); consumed = false; k.item.fresh = true; }
        break; }
      case "star": k.starT = 7; break;
      case "gold":
        if (k.goldT <= 0 && !it.started) { it.started = true; k.goldT = 7; }
        if (k.goldCd > 0) return false;
        giveBoost(k, MAXV * 0.40, 0.9); k.goldCd = 0.25; k.v = Math.max(k.v, MAXV * 0.9); consumed = false; break;
      case "bullet": k.bulletT = 5; k.v = Math.max(k.v, MAXV); break;
    }
    if (consumed) k.item = null;
    ev("use", k, { item: it.type });
    return true;
  }
  g.useItem = useItem;

  /* ---------- per kart controller ---------- */
  function aiInput(k) {
    const a = k.ai, N = T.N;
    const la = Math.round(5 + Math.min(6, k.v / 60));
    const tp = T.pts[(k.idx + la) % N], lane = a.lane;
    const tx = tp.x + tp.nx * lane, ty = tp.y + tp.ny * lane;
    const diff = wrap(Math.atan2(ty - k.y, tx - k.x) - k.h);
    let steer = clamp(diff * 2.4, -1, 1);
    const ahead = T.pts[(k.idx + 14) % N], cur = T.pts[k.idx];
    const curve = Math.abs(wrap(Math.atan2(ahead.ty, ahead.tx) - Math.atan2(cur.ty, cur.tx)));
    let want = a.driftOn ? Math.abs(diff) > 0.1 : Math.abs(diff) > 0.4 && k.v > 140;
    if (curve < 0.15) want = false;
    a.driftOn = want && k.spinT <= 0;
    if (a.driftOn && !k.drift) steer = diff > 0 ? 1 : -1;
    return { steer, accel: true, brake: curve > 0.8 && k.v > 190, drift: a.driftOn };
  }

  function aiUseItem(k) {
    const it = k.item; if (!it || k.rouletteT > 0 || k.isPlayer) return;
    const ai = k.ai; if (ai.itemWait > 0) { ai.itemWait -= DT; return; }
    const base = TRIPLE[it.type] ? TRIPLE[it.type][0] : it.type;
    const ahead = g.karts.filter(o => o !== k && o.dist > k.dist && o.dist - k.dist < 500);
    const behind = g.karts.filter(o => o !== k && o.dist < k.dist && k.dist - o.dist < 300);
    const inFront = ahead.some(o => Math.abs(wrap(Math.atan2(o.y - k.y, o.x - k.x) - k.h)) < 0.3 && Math.hypot(o.x - k.x, o.y - k.y) < 420);
    let use = false;
    switch (base) {
      case "mush": use = Math.abs(wrap(Math.atan2(T.pts[(k.idx + 10) % T.N].y - k.y, T.pts[(k.idx + 10) % T.N].x - k.x) - k.h)) < 0.25; break;
      case "green": use = inFront; break;
      case "red": use = ahead.length > 0; break;
      case "banana": case "fake": use = behind.length > 0; break;
      case "bomb": use = ahead.length > 0; break;
      case "spiny": use = k.place > 1; break;
      case "gold": use = k.goldT <= 0 || k.goldCd <= 0; break;
      default: use = true;
    }
    if (!use) { ai.hold = (ai.hold || 0) + DT; if (ai.hold < 9) return; }
    ai.hold = 0; ai.itemWait = 0.5 + rand() * 1.5;
    useItem(k, false);
  }

  /* ---------- kart physics ---------- */
  function stepKart(k, inp, dt) {
    const isP = k.isPlayer;
    const gl = T.global(k.x, k.y);
    const off = gl.d > HALF;
    // timers
    if (k.boostT > 0) { k.boostT -= dt; if (k.boostT <= 0) k.boostAdd = 0; }
    if (k.starT > 0) k.starT -= dt;
    if (k.shrinkT > 0) k.shrinkT -= dt;
    if (k.ghostT > 0) k.ghostT -= dt;
    if (k.inkT > 0) k.inkT -= dt;
    if (k.goldT > 0) { k.goldT -= dt; if (k.goldT <= 0 && k.item && k.item.type === "gold") k.item = null; }
    if (k.goldCd > 0) k.goldCd -= dt;
    if (k.hop > 0) k.hop -= dt;
    if (k.stallT > 0) k.stallT -= dt;

    let steer = clamp(+inp.steer || 0, -1, 1), acc = !!inp.accel, brk = !!inp.brake, drift = !!inp.drift;
    if (k.bulletT > 0) { // Bullet Bill flies the racing line
      k.bulletT -= dt;
      const tp = T.pts[(k.idx + 8) % T.N], diff = wrap(Math.atan2(tp.y - k.y, tp.x - k.x) - k.h);
      steer = clamp(diff * 3, -1, 1); acc = true; brk = false; drift = false; k.drift = 0;
    }
    if (k.spinT > 0) { k.spinT -= dt; steer = 0; acc = false; brk = false; drift = false; k.drift = 0; k.spinAng += dt * 9; if (k.spinT <= 0) k.spinAng = 0; }
    if (g.state !== "racing" && !k.finished) { acc = false; steer = 0; drift = false; }

    // speed cap. Only the base cap and the base acceleration use the focus multiplier; boosts keep their own absolute values.
    const m = isP ? g.m : 1;
    let cap = MAXV * m * (1 + 0.006 * k.coins);
    if (!isP) cap = MAXV * k.ai.skill * (g.rubber ? g.rubber(k) : 1);
    if (k.shrinkT > 0) cap *= 0.7;
    if (off && k.starT <= 0 && k.bulletT <= 0 && k.boostT <= 0) cap *= 0.45;
    let add = k.boostT > 0 ? k.boostAdd : 0;
    if (k.starT > 0) add = Math.max(add, MAXV * 0.12);
    if (k.bulletT > 0) { cap = MAXV; add = MAXV * 0.5; }
    const top = cap + add;
    const accel = Math.max(ACC * (isP ? g.m : 1), k.boostT > 0 || k.bulletT > 0 ? ACC * 2.5 : 0);

    if (k.stallT > 0) acc = false; // burnout after an early start
    if (acc && !brk) {
      if (k.v < top) k.v = Math.min(top, k.v + accel * dt);
      else k.v += (top - k.v) * Math.min(1, dt * 2.2);
    } else if (brk) {
      if (k.v > 0) k.v = Math.max(0, k.v - 460 * dt); else k.v = Math.max(-0.25 * MAXV * m, k.v - ACC * 0.5 * dt);
    } else {
      k.v -= Math.sign(k.v) * Math.min(Math.abs(k.v), 75 * dt);
    }
    if (k.v > top && !acc) k.v += (top - k.v) * Math.min(1, dt * 1.2);

    // drift start / end
    if (drift && !k.drift && Math.abs(steer) > 0.25 && k.v > 105 && !off) { k.drift = steer > 0 ? 1 : -1; k.driftT = 0; k.hop = 0.22; k.v *= 1.0; ev("driftstart", k); }
    if (k.drift) {
      if (!drift || k.v < 85 || k.spinT > 0) {
        let st = 0;
        if (k.driftT >= MT3) st = 3; else if (k.driftT >= MT2) st = 2; else if (k.driftT >= MT1) st = 1;
        if (st === 1) { giveBoost(k, MAXV * 0.22, 0.65); ev("miniturbo", k, { stage: 1 }); }
        if (st === 2) { giveBoost(k, MAXV * 0.30, 1.1); ev("miniturbo", k, { stage: 2 }); }
        if (st === 3) { giveBoost(k, MAXV * 0.36, 1.5); ev("miniturbo", k, { stage: 3 }); }
        k.drift = 0; k.driftT = 0;
      } else if (!off || true) {
        k.driftT += dt;
      }
    }
    k.mt = k.drift ? (k.driftT >= MT3 ? 3 : k.driftT >= MT2 ? 2 : k.driftT >= MT1 ? 1 : 0) : 0;

    // steering
    const spdF = clamp(Math.abs(k.v) / (0.25 * MAXV), 0, 1) * (k.v < 0 ? -1 : 1);
    const hiF = 1 - 0.22 * clamp(Math.abs(k.v) / (MAXV * 1.2), 0, 1);
    let w;
    if (k.drift) w = 2.5 * (k.drift * 0.8 + steer * 0.6) * hiF;
    else w = 2.5 * steer * spdF * hiF;
    k.h += w * dt;
    k.bo += ((k.drift ? k.drift * 0.5 : steer * 0.12 * Math.abs(spdF)) - k.bo) * Math.min(1, dt * 10);

    // move
    k.x += Math.cos(k.h) * k.v * dt;
    k.y += Math.sin(k.h) * k.v * dt;

    // walls
    const g2 = T.global(k.x, k.y);
    if (g2.d > WALLD) {
      const nx = (k.x - g2.px) / g2.d, ny = (k.y - g2.py) / g2.d;
      k.x = g2.px + nx * WALLD; k.y = g2.py + ny * WALLD;
      const fx = Math.cos(k.h), fy = Math.sin(k.h), dn = fx * nx + fy * ny;
      if (dn > 0) {
        let tx = fx - nx * dn, ty = fy - ny * dn; const tl = Math.hypot(tx, ty) || 1;
        k.h = Math.atan2(ty / tl, tx / tl); k.v *= 1 - 0.45 * dn; k.drift = 0; k.driftT = 0;
        if (dn > 0.35) ev("wall", k);
      }
    }
    // progress
    const w2 = T.window(k.x, k.y, k.idx, 8, 18);
    const sNew = T.pts[w2.i].s + w2.t * T.pts[w2.i].len;
    let ds = sNew - k.s; if (ds > T.L / 2) ds -= T.L; else if (ds < -T.L / 2) ds += T.L;
    k.s = sNew; k.idx = w2.i; k.dist += ds;
    k.lat = ((k.x - w2.px) * T.pts[w2.i].nx + (k.y - w2.py) * T.pts[w2.i].ny);
    while (k.dist >= (k.lap + 1) * T.L && !k.finished) {
      k.lap++; ev("lap", k, { lap: k.lap });
      if (k.lap >= laps) { k.finished = true; k.finishTime = g.t; k.place = placeOf(k); ev("finish", k, { place: k.place, time: g.t }); }
    }
  }

  g.rubber = function (k) {
    const p = g.player; const gap = k.dist - p.dist; // positive: this AI is ahead of the player
    return clamp(1 - gap / 6000, 0.92, 1.07);
  };

  /* ---------- items in the world ---------- */
  function updateObjs(dt) {
    const T_ = T;
    for (const o of g.objs) {
      o.life -= dt; if (o.life <= 0) { o.dead = true; continue; }
      const grace = g.t - o.born < 0.35;
      if (o.t === "green") {
        o.x += o.vx * dt; o.y += o.vy * dt;
        const q = T_.global(o.x, o.y);
        if (q.d > WALLD - 6) {
          const nx = (o.x - q.px) / q.d, ny = (o.y - q.py) / q.d, dn = o.vx * nx + o.vy * ny;
          if (dn > 0) { o.vx -= 2 * dn * nx; o.vy -= 2 * dn * ny; o.bounces++; o.x = q.px + nx * (WALLD - 8); o.y = q.py + ny * (WALLD - 8); if (o.bounces > 4) o.dead = true; }
        }
      } else if (o.t === "red") {
        const tk = o.tgt ? g.karts.find(q => q.id === o.tgt) : null;
        let ax, ay;
        const cur = T_.window(o.x, o.y, o.i || g.karts.find(q => q.id === o.owner).idx, 6, 14); o.i = cur.i;
        if (tk && Math.hypot(tk.x - o.x, tk.y - o.y) < 200) { ax = tk.x; ay = tk.y; }
        else { const tp = T_.pts[(cur.i + 5) % T_.N]; const lat = tk ? tk.lat || 0 : 0; ax = tp.x + tp.nx * lat; ay = tp.y + tp.ny * lat; }
        const want = Math.atan2(ay - o.y, ax - o.x); o.h += clamp(wrap(want - o.h), -7 * dt, 7 * dt);
        o.x += Math.cos(o.h) * 460 * dt; o.y += Math.sin(o.h) * 460 * dt;
        const q = T_.global(o.x, o.y); if (q.d > WALLD) { o.dead = true; }
      } else if (o.t === "bomb") {
        o.x += o.vx * dt; o.y += o.vy * dt; const dr = Math.pow(0.35, dt); o.vx *= dr; o.vy *= dr;
        const q = T_.global(o.x, o.y); if (q.d > WALLD) { o.vx *= -0.3; o.vy *= -0.3; o.x = q.px + (o.x - q.px) / q.d * (WALLD - 4); o.y = q.py + (o.y - q.py) / q.d * (WALLD - 4); }
        o.fuse -= dt;
        if (o.fuse <= 0) { explode(o, 125); }
      } else if (o.t === "spiny") {
        o.sf += (680 / 15) * dt; const p = T_.at(o.sf); o.x = p.x; o.y = p.y;
        const tk = g.karts.find(q => q.id === o.tgt);
        if (tk && Math.hypot(tk.x - o.x, tk.y - o.y) < 60) { explode(o, 150, true); }
        if (tk && o.sf > tk.idx + T_.N * 0.0 && Math.hypot(tk.x - o.x, tk.y - o.y) < 400) { // lock on once close
          const d = Math.hypot(tk.x - o.x, tk.y - o.y) || 1; o.x += (tk.x - o.x) / d * 680 * dt * 0.4; o.y += (tk.y - o.y) / d * 680 * dt * 0.4;
        }
      }
      if (o.dead) continue;
      // contact with karts
      if (o.t === "green" || o.t === "red") {
        for (const k of g.karts) {
          if (k.id === o.owner && grace) continue;
          if (Math.hypot(k.x - o.x, k.y - o.y) < KR + 7) { hitKart(k, o.t); o.dead = true; break; }
        }
      } else if (o.t === "banana" || o.t === "fake") {
        for (const k of g.karts) {
          if (k.id === o.owner && grace) continue;
          if (Math.hypot(k.x - o.x, k.y - o.y) < KR + 8) { if (k.ghostT > 0) continue; if (k.starT > 0 || k.bulletT > 0) { o.dead = true; break; } hitKart(k, o.t); o.dead = true; break; }
        }
      } else if (o.t === "bomb") {
        for (const k of g.karts) { if (k.id === o.owner && grace) continue; if (Math.hypot(k.x - o.x, k.y - o.y) < KR + 10) { explode(o, 125); break; } }
      }
    }
    g.objs = g.objs.filter(o => !o.dead);
  }
  function explode(o, r, only) {
    o.dead = true; ev("explode", null, { x: o.x, y: o.y, kind: o.t, r });
    g.fx = g.fx || []; g.fx.push({ x: o.x, y: o.y, r, t: 0 });
    for (const k of g.karts) if (Math.hypot(k.x - o.x, k.y - o.y) < r) hitKart(k, "bomb");
  }

  /* ---------- main step ---------- */
  g.step = function (input) {
    const dt = DT;
    g.frame++; g.t += dt;
    g.m += (g.mTarget - g.m) * (1 - Math.exp(-dt / 1.0));
    const P = g.player;
    // start sequence
    if (g.state === "countdown") {
      if (input.accel && P.accelHeldSince == null) P.accelHeldSince = g.t;
      if (!input.accel) P.accelHeldSince = null;
      if (g.t >= 0) {
        g.state = "racing"; ev("go", null);
        if (P.accelHeldSince != null) {
          const early = -P.accelHeldSince;
          if (early <= 0.5) { P.rocket = true; giveBoost(P, MAXV * 0.30, 1.0); P.v = MAXV * 0.4; ev("rocket", P); }
          else if (early >= 1.0) { P.stallT = 0.9; ev("burnout", P); }
        }
        g.karts.forEach(k => { if (!k.isPlayer && k.ai.skill > 0.98 && rand() < 0.6) giveBoost(k, MAXV * 0.25, 0.8); });
      }
    }
    // karts
    g.karts.forEach(k => { k.place = placeOf(k); });
    for (const k of g.karts) {
      let inp;
      if (k.isPlayer && !k.finished) inp = input; else inp = aiInput(k);
      if (k.isPlayer && k.finished) inp = aiInput(k); // cruise in after finishing
      if (k.goldT > 0 && k.isPlayer && input.item && !input.itemPrev) { /* handled below */ }
      if (g.state === "countdown") { inp = { steer: 0, accel: false, brake: false, drift: false }; }
      stepKart(k, inp, dt);
      if (!k.isPlayer) aiUseItem(k);
      // roulette
      if (k.rouletteT > 0) { k.rouletteT -= dt; if (k.rouletteT <= 0) { k.item = { type: pickItem(k) }; ev("gotitem", k, { item: k.item.type }); } }
    }
    // player item use (edge triggered by caller, or held for gold)
    const edge = !!input.item && !g.prevItem; g.prevItem = !!input.item;
    if (edge && g.state === "racing" && !P.finished) useItem(P, !!input.back);
    // kart vs kart
    for (let i = 0; i < g.karts.length; i++) for (let j = i + 1; j < g.karts.length; j++) {
      const a = g.karts[i], b = g.karts[j];
      if (a.ghostT > 0 || b.ghostT > 0) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = KR * 2 * (a.shrinkT > 0 || b.shrinkT > 0 ? 0.7 : 1);
      if (d < min && d > 0.001) {
        const nx = dx / d, ny = dy / d, over = min - d, wa = a.c.w, wb = b.c.w, tw = wa + wb;
        a.x -= nx * over * wb / tw; a.y -= ny * over * wb / tw; b.x += nx * over * wa / tw; b.y += ny * over * wa / tw;
        const sa = a.starT > 0 || a.bulletT > 0, sb = b.starT > 0 || b.bulletT > 0;
        if (sa && !sb) hitKart(b, "star"); else if (sb && !sa) hitKart(a, "star");
        else { const rel = Math.abs(a.v - b.v); a.v *= 0.97 + (wa > wb ? 0.02 : -0.03); b.v *= 0.97 + (wb > wa ? 0.02 : -0.03); if (rel > 60) ev("bump", a); }
      }
    }
    // item boxes
    for (const bx of g.boxes) {
      if (bx.respawn > 0) { bx.respawn -= dt; continue; }
      for (const k of g.karts) {
        if (k.item || k.rouletteT > 0 || k.ghostT > 0 && false) continue;
        if (Math.hypot(k.x - bx.x, k.y - bx.y) < KR + 14) { bx.respawn = 3.5; k.rouletteT = k.isPlayer ? 1.5 : 0.9; ev("box", k); break; }
      }
    }
    // coins
    for (const c of g.coins) {
      if (c.got) { if (c.respawn != null && (c.respawn -= dt) <= 0) { c.got = false; c.respawn = null; } continue; }
      for (const k of g.karts) if (k.coins < 10 && Math.hypot(k.x - c.x, k.y - c.y) < KR + 10) { c.got = true; c.respawn = 12; k.coins++; if (k.isPlayer) ev("coin", k); break; }
    }
    updateObjs(dt);
    if (g.fx) { g.fx.forEach(f => f.t += dt); g.fx = g.fx.filter(f => f.t < 0.6); }
    // finish / results
    if (g.state === "racing") {
      if (P.finished) {
        g.resultsT += dt;
        if (g.resultsT > 4 || g.karts.every(k => k.finished)) { g.state = "results"; g.results = computeResults(); }
      }
      if (g.t > 600) { g.state = "results"; g.results = computeResults(); }
    }
    return g;
  };

  function computeResults() {
    const pts = [10, 8, 6, 4, 3, 2, 1, 0];
    const list = g.karts.slice().sort((a, b) => rank(b) - rank(a));
    return list.map((k, i) => ({ place: i + 1, id: k.id, name: k.c.name, time: k.finished ? k.finishTime : null, points: pts[i], player: k.isPlayer }));
  }

  g.speedMult = () => g.m;
  return g;
}

const API = { DT, MAXV, ACC, HALF, WALLD, KR, LAPS, MT1, MT2, MT3, CHARS, ITEM_TABLE, ITEM_NAMES, TRIPLE, TRACK, createRace, rng, wrap, clamp };
if (typeof module !== "undefined" && module.exports) module.exports = API;
root.MKDS = API;
})(typeof window !== "undefined" ? window : globalThis);
