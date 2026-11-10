/* Mario Kart DS style renderer + overlay UI for the Muse panel. Browser only. All art is drawn in code (no ripped assets).
   Internal resolution 320x240 scaled up with crisp pixels, a Mode-7 style ground plane, billboard sprites. */
(function (root) {
"use strict";
const M = root.MKDS;
const TAU = Math.PI * 2;
const W = 320, H = 240, HOR = 84, F = 190, CAMH = 52, CAMD = 118;
const BX0 = -1700, BY0 = -850, BW = 3400, BH = 1700;

let ui = null; // live overlay state

/* ---------------- track texture ---------------- */
function buildTexture() {
  const T = M.TRACK, c = document.createElement("canvas"); c.width = BW; c.height = BH;
  const g = c.getContext("2d");
  g.translate(-BX0, -BY0);
  const path = () => { g.beginPath(); T.pts.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.closePath(); };
  g.lineJoin = "round"; g.lineCap = "butt";
  g.fillStyle = "#2f6f2a"; g.fillRect(BX0, BY0, BW, BH);                 // far grass
  // checker grass pattern
  const pc = document.createElement("canvas"); pc.width = pc.height = 96; const pg = pc.getContext("2d");
  pg.fillStyle = "#4fae3b"; pg.fillRect(0, 0, 96, 96); pg.fillStyle = "#58b944"; pg.fillRect(0, 0, 48, 48); pg.fillRect(48, 48, 48, 48);
  const pat = g.createPattern(pc, "repeat");
  path(); g.strokeStyle = "#e9e9e9"; g.lineWidth = (M.WALLD + 18) * 2; g.setLineDash([]); g.stroke();       // barrier
  path(); g.strokeStyle = "#c33"; g.lineWidth = (M.WALLD + 18) * 2; g.setLineDash([36, 36]); g.stroke(); g.setLineDash([]);
  path(); g.strokeStyle = pat; g.lineWidth = M.WALLD * 2; g.stroke();                                         // grass
  path(); g.strokeStyle = "#e6e6e6"; g.lineWidth = M.HALF * 2 + 18; g.stroke();                              // curb
  path(); g.strokeStyle = "#d8232a"; g.lineWidth = M.HALF * 2 + 18; g.setLineDash([26, 26]); g.stroke(); g.setLineDash([]);
  path(); g.strokeStyle = "#8d8f9a"; g.lineWidth = M.HALF * 2; g.stroke();                                    // road
  // road speckle
  g.globalAlpha = 0.18; g.fillStyle = "#6c6e78";
  for (let i = 0; i < T.N; i += 1) { const p = T.pts[i]; for (let q = 0; q < 3; q++) g.fillRect(p.x + p.nx * (Math.random() * 150 - 75) + (Math.random() - .5) * 14, p.y + p.ny * (Math.random() * 150 - 75) + (Math.random() - .5) * 14, 6, 6); }
  g.globalAlpha = 1;
  // dashed center line
  g.strokeStyle = "rgba(255,255,255,.55)"; g.lineWidth = 5; g.setLineDash([22, 30]); path(); g.stroke(); g.setLineDash([]);
  // start line (checker)
  const sp = T.pts[T.start]; g.save(); g.translate(sp.x, sp.y); g.rotate(Math.atan2(sp.ty, sp.tx));
  for (let r = 0; r < 2; r++) for (let q = -10; q < 10; q++) { g.fillStyle = (q + r) & 1 ? "#fff" : "#111"; g.fillRect(-14 + r * 14, q * 8.5, 14, 8.5); }
  g.restore();
  return c;
}
function mip(base) {
  const lv = [base];
  [2, 4].forEach(d => { const c = document.createElement("canvas"); c.width = BW / d; c.height = BH / d; const g = c.getContext("2d"); g.imageSmoothingEnabled = true; g.drawImage(base, 0, 0, c.width, c.height); lv.push(c); });
  return lv.map((c, i) => { const d = [1, 2, 4][i], id = c.getContext("2d").getImageData(0, 0, c.width, c.height); return { w: c.width, h: c.height, d, px: new Uint32Array(id.data.buffer) }; });
}

/* ---------------- audio (tiny synth beeps) ---------------- */
let ac = null;
function beep(f, dur, type, vol, f2) {
  try {
    ac = ac || new (root.AudioContext || root.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain(); o.type = type || "square"; o.frequency.value = f;
    if (f2) o.frequency.linearRampToValueAtTime(f2, ac.currentTime + dur);
    g.gain.value = vol || 0.04; g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + dur);
  } catch (e) { }
}

/* ---------------- sprites ---------------- */
function shade(hex, f) { const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255; r = Math.min(255, r * f) | 0; g = Math.min(255, g * f) | 0; b = Math.min(255, b * f) | 0; return "rgb(" + r + "," + g + "," + b + ")"; }

function drawKart(c, k, sx, sy, sc, camAng, t) {
  const a = M.wrap(k.h + k.bo + (k.spinT > 0 ? k.spinAng : 0) - camAng);
  const sa = Math.sin(a), ca = Math.cos(a), pf = CAMH / (F / sc) * 0.9;
  const scl = k.shrinkT > 0 ? 0.6 : 1;
  const P = (u, v, h) => [sx + (u * sa + v * ca) * sc * scl, sy - (u * ca - v * sa) * sc * pf * scl - h * sc * scl - (k.hop > 0 ? Math.sin(k.hop / 0.22 * Math.PI) * 6 * sc : 0)];
  c.save();
  if (k.ghostT > 0) c.globalAlpha = 0.45 + 0.15 * Math.sin(t * 8);
  if (k.starT > 0 && ((t * 12) | 0) % 2) c.filter = "brightness(1.8) saturate(1.5)";
  // shadow
  c.fillStyle = "rgba(0,0,0,.35)"; c.beginPath(); c.ellipse(sx, sy, 24 * sc * scl, 10 * sc * scl * pf * 2.2, 0, 0, TAU); c.fill();
  const col = k.c.kart, col2 = k.c.kart2;
  // wheels (back ones first by depth)
  const wheels = [[-15, -15], [-15, 15], [14, -15], [14, 15]].map(([u, v]) => ({ u, v, z: u * ca - v * sa })).sort((p, q) => q.z - p.z);
  const poly = (pts, fill) => { c.fillStyle = fill; c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); c.fill(); };
  const wheel = w => { const [x, y] = P(w.u, w.v, 6); c.fillStyle = "#15151a"; c.beginPath(); c.ellipse(x, y, 5.5 * sc * scl * (0.55 + 0.45 * Math.abs(ca)), 6.5 * sc * scl, 0, 0, TAU); c.fill(); c.fillStyle = "#6b6b75"; c.beginPath(); c.arc(x, y, 1.8 * sc * scl, 0, TAU); c.fill(); };
  const behind = wheels.filter(w => w.z > 0), front = wheels.filter(w => w.z <= 0);
  behind.forEach(wheel);
  // body box
  const u0 = -19, u1 = 23, v0 = -12, v1 = 12, h0 = 3, h1 = 11;
  const faces = [
    { n: [1, 0], q: [[u1, v0], [u1, v1]], c: shade(col2, 0.95) },  // front (nose)
    { n: [-1, 0], q: [[u0, v1], [u0, v0]], c: shade(col, 0.7) },   // back
    { n: [0, 1], q: [[u1, v1], [u0, v1]], c: shade(col, 0.85) },   // right side
    { n: [0, -1], q: [[u0, v0], [u1, v0]], c: shade(col, 0.8) }    // left side
  ];
  faces.forEach(f => { const nz = f.n[0] * ca - f.n[1] * sa; if (nz < 0.01) { const p = f.q; poly([P(p[0][0], p[0][1], h0), P(p[1][0], p[1][1], h0), P(p[1][0], p[1][1], h1), P(p[0][0], p[0][1], h1)], f.c); } });
  poly([P(u0, v0, h1), P(u1, v0, h1), P(u1, v1, h1), P(u0, v1, h1)], shade(col, 1.12));
  // nose stripe + exhaust
  poly([P(8, -5, h1 + .1), P(u1, -3, h1 + .1), P(u1, 3, h1 + .1), P(8, 5, h1 + .1)], shade(col2, 1));
  { const [ex, ey] = P(u0 - 2, 0, 6); c.fillStyle = "#555"; c.beginPath(); c.ellipse(ex, ey, 3 * sc * scl, 2.4 * sc * scl, 0, 0, TAU); c.fill(); }
  front.forEach(wheel);
  // driver
  drawDriver(c, k, P, sc * scl, ca, sa);
  // drift sparks
  if (k.drift && k.driftT > 0.15) {
    const col3 = k.mt === 3 ? "#d27bff" : k.mt === 2 ? "#ff9a2a" : k.mt === 1 ? "#6ad7ff" : "#fff3b0";
    for (let i = 0; i < 6; i++) { const [x, y] = P(-20 + Math.random() * 4, (k.drift > 0 ? 1 : -1) * (-10 - Math.random() * 6), 3 + Math.random() * 6); c.fillStyle = col3; c.fillRect(x, y, 1.6 * sc, 1.6 * sc); }
  }
  c.restore();
}
function drawDriver(c, k, P, sc, ca, sa) {
  const ch = k.c, id = ch.id, face = ca < -0.05;        // facing the camera
  const [bx, by] = P(-3, 0, 13), [hx, hy] = P(-2, 0, 27);
  const rad = 8.4 * sc;
  const dark = "#2b2b8a";
  // body / torso
  const torso = id === "peach" ? "#ff8fc7" : id === "toad" ? "#4f7be0" : id === "yoshi" ? "#7ed957" : id === "dk" ? ch.hair : id === "bowser" ? "#e8b43c" : id === "wario" ? "#f4d11f" : id === "luigi" ? "#2e9a2e" : "#e52521";
  c.fillStyle = torso; c.beginPath(); c.ellipse(bx, by - 2 * sc, 8 * sc, 8.5 * sc, 0, 0, TAU); c.fill();
  if (id === "mario" || id === "luigi" || id === "wario") { c.fillStyle = id === "wario" ? "#7a3ab5" : id === "luigi" ? "#1a3fb0" : "#1a3fb0"; c.fillRect(bx - 6 * sc, by - 1 * sc, 12 * sc, 6 * sc); }
  if (id === "yoshi") { c.fillStyle = "#ff6a3a"; c.fillRect(bx - 6 * sc, by + 0 * sc, 12 * sc, 3 * sc); }
  // character specific back elements (behind head)
  if (id === "peach" && !face) { c.fillStyle = ch.hair; c.beginPath(); c.ellipse(hx, hy + 6 * sc, 9.5 * sc, 11 * sc, 0, 0, TAU); c.fill(); }
  if (id === "bowser") { c.fillStyle = "#2f8f3a"; c.beginPath(); c.ellipse(bx, by - 1 * sc, 11 * sc, 8 * sc, 0, 0, TAU); c.fill(); c.fillStyle = "#f4f1d0"; for (let i = -1; i <= 1; i++) { c.beginPath(); c.moveTo(bx + i * 7 * sc - 2.5 * sc, by - 6 * sc); c.lineTo(bx + i * 7 * sc, by - 12 * sc); c.lineTo(bx + i * 7 * sc + 2.5 * sc, by - 6 * sc); c.fill(); } }
  // head
  const bigHead = id === "dk" || id === "bowser" || id === "wario" ? 1.12 : id === "toad" ? 0.9 : 1;
  c.fillStyle = ch.skin; c.beginPath(); c.arc(hx, hy, rad * bigHead, 0, TAU); c.fill();
  const side = Math.abs(sa) > 0.6;
  if (!face) {
    // back of head: cap / hair
    if (id === "toad") { c.fillStyle = "#f4f4f4"; c.beginPath(); c.arc(hx, hy - 1 * sc, rad * 1.25, Math.PI, TAU); c.fill(); c.fillStyle = "#e52521"; [[-5, -6], [4, -8], [0, -3]].forEach(([dx, dy]) => { c.beginPath(); c.arc(hx + dx * sc, hy + dy * sc, 2.4 * sc, 0, TAU); c.fill(); }); }
    else if (id === "yoshi") { c.fillStyle = "#46c14a"; c.beginPath(); c.arc(hx, hy, rad * 1.02, 0, TAU); c.fill(); c.fillStyle = "#e8483a"; c.beginPath(); c.moveTo(hx - 3 * sc, hy - 6 * sc); c.lineTo(hx, hy - 12 * sc); c.lineTo(hx + 3 * sc, hy - 6 * sc); c.fill(); }
    else if (id === "dk") { c.fillStyle = ch.hair; c.beginPath(); c.arc(hx, hy - 1 * sc, rad * 1.12, 0, TAU); c.fill(); }
    else if (id === "bowser") { c.fillStyle = ch.hair; c.beginPath(); c.arc(hx, hy - 1 * sc, rad * 1.12, 0, TAU); c.fill(); c.fillStyle = "#f4f1d0"; [-1, 1].forEach(s2 => { c.beginPath(); c.moveTo(hx + s2 * 6 * sc, hy - 8 * sc); c.lineTo(hx + s2 * 9 * sc, hy - 15 * sc); c.lineTo(hx + s2 * 2 * sc, hy - 9 * sc); c.fill(); }); }
    else if (id === "peach") { c.fillStyle = ch.hair; c.beginPath(); c.arc(hx, hy, rad * 1.02, 0, TAU); c.fill(); c.fillStyle = "#f2c14e"; c.fillRect(hx - 4 * sc, hy - 11 * sc, 8 * sc, 3 * sc); c.fillStyle = "#e6334a"; c.beginPath(); c.arc(hx, hy - 10 * sc, 1.3 * sc, 0, TAU); c.fill(); }
    else { c.fillStyle = ch.cap; c.beginPath(); c.arc(hx, hy, rad * 1.02, 0, TAU); c.fill(); c.fillStyle = ch.hair; c.fillRect(hx - rad * 0.9, hy + 2 * sc, rad * 1.8, 4 * sc); }
  } else {
    // front: face
    c.fillStyle = "#fff"; c.beginPath(); c.ellipse(hx - 3 * sc, hy - 1 * sc, 2.2 * sc, 3 * sc, 0, 0, TAU); c.ellipse(hx + 3 * sc, hy - 1 * sc, 2.2 * sc, 3 * sc, 0, 0, TAU); c.fill();
    c.fillStyle = "#1a1a8a"; c.beginPath(); c.arc(hx - 3 * sc, hy - 0.5 * sc, 1.1 * sc, 0, TAU); c.arc(hx + 3 * sc, hy - 0.5 * sc, 1.1 * sc, 0, TAU); c.fill();
    if (id === "mario" || id === "luigi" || id === "wario") { c.fillStyle = "#e0a070"; c.beginPath(); c.arc(hx, hy + 2 * sc, 2.6 * sc, 0, TAU); c.fill(); c.fillStyle = id === "wario" ? "#4b3a2a" : "#3a2410"; c.fillRect(hx - 5 * sc, hy + 4 * sc, 10 * sc, 2 * sc); }
    if (id === "peach") { c.fillStyle = ch.hair; c.beginPath(); c.arc(hx, hy - 3 * sc, rad, Math.PI, TAU); c.fill(); c.fillStyle = "#f2c14e"; c.fillRect(hx - 4 * sc, hy - 11 * sc, 8 * sc, 3 * sc); c.fillStyle = "#e66"; c.fillRect(hx - 1.5 * sc, hy + 3 * sc, 3 * sc, 1.4 * sc); }
    if (id === "yoshi") { c.fillStyle = "#f5fff0"; c.beginPath(); c.ellipse(hx, hy + 4 * sc, 7 * sc, 4.5 * sc, 0, 0, TAU); c.fill(); }
    if (id === "toad") { c.fillStyle = "#f4f4f4"; c.beginPath(); c.arc(hx, hy - 3 * sc, rad * 1.25, Math.PI, TAU); c.fill(); c.fillStyle = "#e52521"; [[-5, -8], [4, -9], [0, -6]].forEach(([dx, dy]) => { c.beginPath(); c.arc(hx + dx * sc, hy + dy * sc, 2.4 * sc, 0, TAU); c.fill(); }); }
    if (id === "dk") { c.fillStyle = "#c99a6a"; c.beginPath(); c.ellipse(hx, hy + 2 * sc, 6 * sc, 5 * sc, 0, 0, TAU); c.fill(); c.fillStyle = ch.hair; c.beginPath(); c.arc(hx, hy - 4 * sc, rad * 1.1, Math.PI, TAU); c.fill(); }
    if (id === "bowser") { c.fillStyle = "#e8b43c"; c.beginPath(); c.ellipse(hx, hy + 3 * sc, 6 * sc, 4 * sc, 0, 0, TAU); c.fill(); c.fillStyle = ch.hair; c.beginPath(); c.arc(hx, hy - 4 * sc, rad * 1.1, Math.PI, TAU); c.fill(); }
    // cap for mario / luigi / wario front
    if (id === "mario" || id === "luigi" || id === "wario") {
      c.fillStyle = ch.cap; c.beginPath(); c.arc(hx, hy - 2 * sc, rad * 1.04, Math.PI, TAU); c.fill(); c.fillRect(hx - rad * 1.04, hy - 2.6 * sc, rad * 2.08, 2.4 * sc);
      c.fillStyle = "#fff"; c.beginPath(); c.arc(hx, hy - 6.5 * sc, 2.6 * sc, 0, TAU); c.fill();
      c.fillStyle = ch.cap; c.font = "bold " + (4.2 * sc) + "px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(id === "mario" ? "M" : id === "luigi" ? "L" : "W", hx, hy - 6.3 * sc);
    }
  }
  // mario cap on back view gets its own emblem hint and the brim sticks out front
  if (!face && (id === "mario" || id === "luigi" || id === "wario")) { c.fillStyle = shade(ch.cap, 0.8); c.fillRect(hx - rad * 0.2, hy - rad * 1.0, rad * 0.4, 1.6 * sc); }
  if (side && (id === "mario" || id === "luigi" || id === "wario")) { c.fillStyle = ch.cap; c.fillRect(hx + (sa > 0 ? 1 : -1) * rad * 0.9 - 2 * sc, hy - 3 * sc, 4 * sc, 2.4 * sc); }
  // arms to the wheel
  c.fillStyle = torso; const [ax, ay] = P(8, 8, 17), [bx2, by2] = P(8, -8, 17); c.beginPath(); c.arc(ax, ay, 2.8 * sc, 0, TAU); c.arc(bx2, by2, 2.8 * sc, 0, TAU); c.fill();
  c.fillStyle = "#f5f5f5"; c.beginPath(); c.arc(ax, ay + 0.5 * sc, 1.8 * sc, 0, TAU); c.arc(bx2, by2 + 0.5 * sc, 1.8 * sc, 0, TAU); c.fill();
}

function icon(c, type, x, y, s) {
  c.save(); c.translate(x, y); c.lineWidth = Math.max(1, s * 0.07); c.strokeStyle = "#111";
  const circ = (px, py, r, f) => { c.fillStyle = f; c.beginPath(); c.arc(px, py, r, 0, TAU); c.fill(); c.stroke(); };
  const base = TRIPLE_BASE(type), tri = type !== base;
  const draw = (b, ox, oy, k) => {
    c.save(); c.translate(ox, oy); c.scale(k, k);
    switch (b) {
      case "green": circ(0, 0, s * .34, "#3cc83c"); c.fillStyle = "#fff"; c.fillRect(-s * .22, -s * .06, s * .44, s * .12); break;
      case "red": circ(0, 0, s * .34, "#e8332f"); c.fillStyle = "#fff"; c.fillRect(-s * .22, -s * .06, s * .44, s * .12); break;
      case "banana": c.fillStyle = "#ffe03a"; c.beginPath(); c.moveTo(-s * .3, -s * .1); c.quadraticCurveTo(0, s * .5, s * .3, -s * .25); c.quadraticCurveTo(s * .05, s * .12, -s * .3, -s * .1); c.fill(); c.stroke(); break;
      case "fake": c.fillStyle = "#ffb52b"; c.fillRect(-s * .3, -s * .3, s * .6, s * .6); c.strokeRect(-s * .3, -s * .3, s * .6, s * .6); c.fillStyle = "#fff"; c.font = "bold " + s * .5 + "px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("?", 0, 0); break;
      case "mush": circ(0, -s * .05, s * .34, "#e8332f"); c.fillStyle = "#fff"; c.beginPath(); c.arc(-s * .1, -s * .12, s * .07, 0, TAU); c.arc(s * .12, -s * .08, s * .08, 0, TAU); c.fill(); c.fillStyle = "#f5e8c8"; c.fillRect(-s * .14, s * .16, s * .28, s * .2); break;
      case "gold": circ(0, -s * .05, s * .34, "#f5c518"); c.fillStyle = "#fff6b0"; c.fillRect(-s * .14, s * .16, s * .28, s * .2); break;
      case "bomb": circ(0, 0, s * .3, "#222"); c.fillStyle = "#e8332f"; c.fillRect(-s * .1, -s * .42, s * .2, s * .14); circ(-s * .1, -s * .02, s * .06, "#fff"); circ(s * .1, -s * .02, s * .06, "#fff"); break;
      case "spiny": circ(0, 0, s * .34, "#2a63e0"); c.fillStyle = "#fff"; for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; c.beginPath(); c.moveTo(Math.cos(a) * s * .3, Math.sin(a) * s * .3); c.lineTo(Math.cos(a + .2) * s * .46, Math.sin(a + .2) * s * .46); c.lineTo(Math.cos(a + .4) * s * .3, Math.sin(a + .4) * s * .3); c.fill(); } break;
      case "thunder": c.fillStyle = "#ffe03a"; c.beginPath(); c.moveTo(s * .1, -s * .4); c.lineTo(-s * .25, s * .05); c.lineTo(0, s * .05); c.lineTo(-s * .1, s * .4); c.lineTo(s * .28, -s * .08); c.lineTo(s * .02, -s * .08); c.closePath(); c.fill(); c.stroke(); break;
      case "star": c.fillStyle = "#ffe03a"; c.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? s * .16 : s * .38, a = -Math.PI / 2 + i * Math.PI / 5; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); c.fill(); c.stroke(); break;
      case "bullet": c.fillStyle = "#222"; c.beginPath(); c.arc(s * .05, 0, s * .3, -Math.PI / 2, Math.PI / 2); c.lineTo(-s * .3, s * .3); c.lineTo(-s * .3, -s * .3); c.fill(); circ(s * .1, -s * .08, s * .07, "#fff"); break;
      case "blooper": c.fillStyle = "#f4f4f4"; c.beginPath(); c.ellipse(0, -s * .08, s * .24, s * .3, 0, 0, TAU); c.fill(); c.stroke(); c.fillStyle = "#222"; c.fillRect(-s * .12, -s * .1, s * .06, s * .08); c.fillRect(s * .06, -s * .1, s * .06, s * .08); break;
      case "boo": circ(0, 0, s * .32, "#f4f4ff"); c.fillStyle = "#222"; c.fillRect(-s * .12, -s * .08, s * .07, s * .12); c.fillRect(s * .05, -s * .08, s * .07, s * .12); c.fillRect(-s * .1, s * .12, s * .2, s * .05); break;
    }
    c.restore();
  };
  if (tri) { draw(base, -s * .22, s * .1, .7); draw(base, s * .22, s * .1, .7); draw(base, 0, -s * .12, .7); } else draw(base, 0, 0, 1);
  c.restore();
}
function TRIPLE_BASE(t) { return M.TRIPLE[t] ? M.TRIPLE[t][0] : t; }

/* ---------------- the overlay ---------------- */
function css() {
  if (document.getElementById("mk-css")) return;
  const s = document.createElement("style"); s.id = "mk-css";
  s.textContent = `
#mk{position:absolute;left:0;top:0;width:1672px;height:941px;z-index:50;background:radial-gradient(ellipse at 50% 30%,#10163f,#02030f 70%);color:#e9f1ff;font-family:var(--font);display:none}
#mk *{position:absolute}
#mk .mkcv{image-rendering:pixelated;border:3px solid #4aa8ff;border-radius:6px;box-shadow:0 0 28px rgba(60,120,255,.45);background:#000}
#mk .hud{top:14px;height:76px;border:1px solid rgba(90,140,255,.5);background:linear-gradient(180deg,rgba(7,21,101,.9),rgba(2,11,69,.9));border-radius:8px}
#mk .lb{font-size:11px;letter-spacing:.24em;color:#b7a6ff;white-space:nowrap}
#mk .big{font-size:34px;font-weight:300;white-space:nowrap}
#mk .sen{width:62px;height:50px;text-align:center}
#mk .sen i{left:23px;top:3px;width:12px;height:12px;transform:rotate(45deg);border:2px solid #9fb2e6}
#mk .sen.good i{background:#37ffb6;border-color:#37ffb6;box-shadow:0 0 8px #37ffb6}
#mk .sen.fair i{background:#ffd166;border-color:#ffd166;box-shadow:0 0 8px #ffd166}
#mk .sen.poor i{background:#ff5c7a;border-color:#ff5c7a;box-shadow:0 0 8px #ff5c7a}
#mk .sen b{left:0;top:22px;width:62px;font-size:14px;font-weight:300}
#mk .sen u{left:0;top:36px;width:62px;font-size:9px;text-decoration:none;color:#9fb2e6;letter-spacing:.1em}
#mk button{cursor:pointer;border:2px solid #4aa8ff;background:rgba(4,24,106,.9);color:#e9f1ff;font:inherit;letter-spacing:.18em;font-size:14px;border-radius:8px}
#mk button:hover{background:rgba(20,60,170,.95)}
#mk .help{font-size:13px;line-height:1.7;color:#cfdcff;white-space:pre}
#mk .fbar{height:10px;border:1px solid rgba(90,140,255,.6);background:rgba(2,6,40,.8)}
#mk .fbar i{position:static;display:block;height:100%;background:linear-gradient(90deg,#8a5bff,#35e6ff)}
`;
  document.head.appendChild(s);
}

function open(host) {
  if (ui) return;
  css();
  const stage = host.stage || document.getElementById("stage");
  const el = document.createElement("div"); el.id = "mk";
  el.innerHTML = `
  <div class="hud" style="left:40px;width:1592px"></div>
  <div class="lb" style="left:62px;top:22px">MARIO KART &middot; FIGURE-8 CIRCUIT</div>
  <div id="mkSens" style="left:62px;top:40px;width:300px;height:50px"></div>
  <div class="lb" style="left:520px;top:22px">LINK</div><div id="mkLink" style="left:520px;top:42px;font-size:14px;white-space:nowrap">--</div>
  <div class="lb" style="left:700px;top:22px">FOCUS</div><div id="mkFocus" class="big" style="left:700px;top:38px">--</div>
  <div class="fbar" style="left:790px;top:56px;width:220px"><i id="mkFbar" style="width:0"></i></div>
  <div class="lb" style="left:1060px;top:22px">SPEED MULTIPLIER</div><div id="mkMult" class="big" style="left:1060px;top:38px">&times;1.00</div>
  <div id="mkMultNote" style="left:1230px;top:54px;font-size:12px;color:#9fb2e6;white-space:nowrap">0 focus = 0.5x &middot; 50 = 1x &middot; 100 = 1.5x</div>
  <button id="mkExit" style="left:1496px;top:30px;width:120px;height:48px">EXIT</button>
  <canvas id="mkView" class="mkcv" width="${W}" height="${H}" style="left:40px;top:112px;width:960px;height:720px"></canvas>
  <canvas id="mkMap" class="mkcv" width="320" height="240" style="left:1030px;top:112px;width:602px;height:451px"></canvas>
  <div id="mkHelp" class="help" style="left:1030px;top:590px">ARROWS / WASD   steer and accelerate (down or S brakes)
SHIFT            hold to drift, release for mini-turbo
SPACE            use item (hold down + SPACE throws it behind)
ESC              exit to the panel</div>
  <div id="mkNote" style="left:40px;top:848px;width:1590px;font-size:14px;color:#9fb2e6">Your kart's top speed and acceleration follow your focus. Boosts keep their own strength.</div>
  <div id="mkWarn" style="left:40px;top:880px;width:1590px;font-size:15px;color:#ff9db0"></div>`;
  stage.appendChild(el);
  el.style.display = "block";

  const view = el.querySelector("#mkView"), vg = view.getContext("2d");
  const mapc = el.querySelector("#mkMap"), mg = mapc.getContext("2d");
  vg.imageSmoothingEnabled = false;
  const tex = ui_tex || (ui_tex = mip(buildTexture()));
  const img = vg.createImageData(W, H - HOR), out = new Uint32Array(img.data.buffer);
  const sensEl = el.querySelector("#mkSens");
  const names = ["TP9", "AF7", "AF8", "TP10"];
  sensEl.innerHTML = names.map((n, i) => `<div class="sen" id="mkS${i}" style="left:${i * 70}px;top:0"><i></i><b>--</b><u>${n}</u></div>`).join("");

  const game = M.createRace({ seed: (Date.now() & 0xffff) });
  const st = {
    el, view, vg, mapc, mg, img, out, tex, game, keys: {}, steer: 0, raf: 0, last: 0, acc: 0, camAng: game.player.h, camX: 0, camY: 0,
    tap: {}, t: 0, host, msg: "", msgT: 0, lastCount: 99, mapCache: null, closed: false, itemPrev: false
  };
  ui = st;
  const f0 = host.focus(); game.setFocus(f0 == null ? 50 : f0, true);

  st.onKey = e => {
    const k = e.key.toLowerCase();
    if (e.type === "keydown") {
      if (k === "escape") { close(); e.preventDefault(); return; }
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "shift"].includes(k) || "wasdz".includes(k) && k.length === 1) e.preventDefault();
      if (!st.keys[k]) st.tap[k] = true;
      st.keys[k] = true;
    } else { st.keys[k] = false; if (k === "shift") st.keys.shift = false; }
  };
  st.onBlur = () => { st.keys = {}; };
  addEventListener("keydown", st.onKey, true); addEventListener("keyup", st.onKey, true); addEventListener("blur", st.onBlur);
  el.querySelector("#mkExit").addEventListener("click", close);
  // keep the panel from reacting to clicks underneath
  el.addEventListener("mousedown", e => e.stopPropagation());
  st.hudT = setInterval(updateHud, 120);
  st.raf = requestAnimationFrame(loop);
  beep(440, .08, "square", .03);
}
let ui_tex = null;

function close() {
  if (!ui) return; const st = ui; ui = null; st.closed = true;
  cancelAnimationFrame(st.raf); clearInterval(st.hudT);
  removeEventListener("keydown", st.onKey, true); removeEventListener("keyup", st.onKey, true); removeEventListener("blur", st.onBlur);
  st.el.remove();
  if (st.host.onClose) st.host.onClose();
}

function readInput(st) {
  const K = st.keys;
  const left = K.arrowleft || K.a, right = K.arrowright || K.d;
  const target = (right ? 1 : 0) - (left ? 1 : 0);
  const rate = target === 0 ? 9 : 6.5, dt = 1 / 60;
  if (Math.abs(target - st.steer) < rate * dt) st.steer = target; else st.steer += Math.sign(target - st.steer) * rate * dt;
  return { steer: st.steer, accel: !!(K.arrowup || K.w), brake: !!(K.arrowdown || K.s), drift: !!(K.shift || K.z), item: !!(K[" "] || K.x || st.tap[" "] || st.tap.x), back: !!(K.arrowdown || K.s) };
}

function loop(ts) {
  const st = ui; if (!st || st.closed) return;
  st.raf = requestAnimationFrame(loop);
  const g = st.game;
  if (!st.last) st.last = ts;
  st.acc += Math.min(0.1, (ts - st.last) / 1000); st.last = ts;
  const f = st.host.focus();
  if (f != null) g.setFocus(f);
  let n = 0;
  while (st.acc >= M.DT && n < 6) {
    const inp = readInput(st);
    if (g.state === "results") { if (st.tap.enter || st.tap[" "]) { close(); return; } }
    else g.step(inp);
    st.tap = {}; handleEvents(st); st.acc -= M.DT; n++; st.t += M.DT;
  }
  if (st.acc > 0.2) st.acc = 0;
  render(st);
}

function handleEvents(st) {
  const g = st.game;
  for (const e of g.events) {
    const me = e.id === "mario";
    if (e.type === "go") { st.msg = "GO!"; st.msgT = 1.0; beep(880, .5, "square", .05); }
    else if (e.type === "lap" && me) { st.msg = e.lap >= g.laps ? "FINAL" : "LAP " + (e.lap + 1); st.msgT = 1.6; beep(660, .2, "triangle", .05); }
    else if (e.type === "finish" && me) { st.msg = "FINISH!"; st.msgT = 3; beep(520, .6, "triangle", .06, 780); }
    else if (e.type === "miniturbo" && me) beep(300, .25, "sawtooth", .03, 700);
    else if (e.type === "hit" && me) beep(260, .4, "sawtooth", .05, 80);
    else if (e.type === "gotitem" && me) beep(900, .12, "square", .04, 1300);
    else if (e.type === "coin" && me) beep(1200, .07, "square", .03);
    else if (e.type === "rocket" && me) { st.msg = "ROCKET START!"; st.msgT = 1.4; beep(300, .5, "sawtooth", .05, 900); }
    else if (e.type === "burnout" && me) { st.msg = "TOO EARLY"; st.msgT = 1.2; }
    else if (e.type === "explode") beep(120, .35, "sawtooth", .06, 40);
    else if (e.type === "thunder") beep(1500, .4, "sawtooth", .05, 200);
  }
  g.events.length = 0;
  // countdown beeps
  if (g.state === "countdown") { const c = Math.ceil(-g.t); if (c < st.lastCount && c >= 1 && c <= 3) { st.lastCount = c; beep(440, .15, "square", .05); } }
}

/* ---------------- drawing the 3D view ---------------- */
function render(st) {
  const g = st.game, P = g.player, c = st.vg, T = g.T;
  // camera
  const dtc = 1 / 60;
  const goal = P.h + P.drift * 0.16 + (P.spinT > 0 ? 0 : 0);
  st.camAng += M.wrap(goal - st.camAng) * Math.min(1, dtc * 7);
  const ca = st.camAng, fx = Math.cos(ca), fy = Math.sin(ca), rx = -fy, ry = fx;
  const camx = P.x - fx * CAMD, camy = P.y - fy * CAMD;
  // sky
  const sky = c.createLinearGradient(0, 0, 0, HOR);
  sky.addColorStop(0, "#4aa0f0"); sky.addColorStop(1, "#bfe3ff");
  c.fillStyle = sky; c.fillRect(0, 0, W, HOR);
  drawHorizon(c, ca, st.t);
  // ground (Mode 7)
  const out = st.out, tx = st.tex;
  const hz = [198, 226, 180]; // haze rgb at the horizon
  for (let y = HOR; y < H; y++) {
    const dy = y - HOR + 0.5, dist = CAMH * F / dy;
    const lv = dist > 1200 ? 2 : dist > 520 ? 1 : 0, L = tx[lv], d = L.d;
    const hazeF = Math.min(0.85, Math.max(0, (dist - 500) / 2600));
    const wx0 = camx + fx * dist - rx * (W / 2) * dist / F, wy0 = camy + fy * dist - ry * (W / 2) * dist / F;
    const sxs = rx * dist / F, sys = ry * dist / F;
    let wx = wx0, wy = wy0; const row = (y - HOR) * W, px = L.px, tw = L.w, th = L.h;
    for (let x = 0; x < W; x++, wx += sxs, wy += sys) {
      const ux = ((wx - BX0) / d) | 0, uy = ((wy - BY0) / d) | 0;
      let v;
      if (ux < 0 || uy < 0 || ux >= tw || uy >= th) v = 0xff2a6f2f; else v = px[uy * tw + ux];
      if (hazeF > 0.02) {
        const r = (v & 255), gg = (v >> 8) & 255, b = (v >> 16) & 255;
        v = 0xff000000 | (((b + (hz[2] - b) * hazeF) | 0) << 16) | (((gg + (hz[1] - gg) * hazeF) | 0) << 8) | ((r + (hz[0] - r) * hazeF) | 0);
      }
      out[row + x] = v;
    }
  }
  c.putImageData(st.img, 0, HOR);
  // sprites
  const list = [];
  const proj = (x, y) => { const dx = x - camx, dy = y - camy, cz = dx * fx + dy * fy, cx = dx * rx + dy * ry; return cz > 6 ? { z: cz, sx: W / 2 + F * cx / cz, sy: HOR + F * CAMH / cz, sc: F / cz } : null; };
  g.boxes.forEach(b => { if (b.respawn > 0) return; const p = proj(b.x, b.y); if (p) list.push({ z: p.z, f: () => drawBox(c, p, st.t) }); });
  g.coins.forEach(co => { if (co.got) return; const p = proj(co.x, co.y); if (p) list.push({ z: p.z, f: () => drawCoin(c, p, st.t) }); });
  g.objs.forEach(o => { const p = proj(o.x, o.y); if (p) list.push({ z: p.z, f: () => drawObj(c, o, p, st.t) }); });
  g.karts.forEach(k => { const p = proj(k.x, k.y); if (p) list.push({ z: p.z, f: () => { drawKart(c, k, p.sx, p.sy, p.sc, ca, st.t); drawHeld(c, k, p, ca); } }); });
  (g.fx || []).forEach(e => { const p = proj(e.x, e.y); if (p) list.push({ z: p.z - 1, f: () => { const r = Math.max(2, e.r * p.sc * (0.35 + e.t * 1.6)), cy = p.sy - r * 0.35, a = Math.max(0, 1 - e.t / 0.6); const gr = c.createRadialGradient(p.sx, cy, r * 0.1, p.sx, cy, r); gr.addColorStop(0, "rgba(255,250,200," + a + ")"); gr.addColorStop(0.45, "rgba(255,170,40," + a * 0.9 + ")"); gr.addColorStop(1, "rgba(200,40,10,0)"); c.fillStyle = gr; c.beginPath(); c.ellipse(p.sx, cy, r, r * 0.85, 0, 0, TAU); c.fill(); } }); });
  list.sort((a, b) => b.z - a.z).forEach(s => s.f());
  drawHud(st);
  drawMap(st);
}

let hills = null;
function drawHorizon(c, ang, t) {
  // parallax hills, warp pipes and clouds
  const off = -ang * 260;
  const wrapX = (x, per) => ((x % per) + per) % per;
  c.fillStyle = "#e8f4ff";
  for (let i = 0; i < 4; i++) { const x = wrapX(off * 0.25 + i * 170, 680) - 120; c.beginPath(); c.ellipse(x, 22 + (i % 2) * 14, 34, 9, 0, 0, TAU); c.ellipse(x + 20, 17 + (i % 2) * 14, 22, 8, 0, 0, TAU); c.fill(); }
  c.fillStyle = "#6aa86a";
  for (let i = 0; i < 6; i++) { const x = wrapX(off * 0.5 + i * 120, 720) - 120; c.beginPath(); c.ellipse(x, HOR + 2, 64, 26 + (i % 3) * 5, 0, Math.PI, TAU); c.fill(); }
  c.fillStyle = "#3f9a3f";
  for (let i = 0; i < 8; i++) { const x = wrapX(off * 0.8 + i * 90, 720) - 100; c.beginPath(); c.ellipse(x, HOR + 2, 46, 15 + (i % 3) * 3, 0, Math.PI, TAU); c.fill(); }
  // warp pipes + blocks
  for (let i = 0; i < 5; i++) { const x = wrapX(off * 1.0 + i * 175, 880) - 150; c.fillStyle = "#2fae3f"; c.fillRect(x, HOR - 15, 12, 15); c.fillStyle = "#1f8a31"; c.fillRect(x - 2, HOR - 18, 16, 5); c.fillStyle = "#79e08a"; c.fillRect(x + 2, HOR - 14, 2, 12); }
  for (let i = 0; i < 4; i++) { const x = wrapX(off * 1.0 + 70 + i * 210, 840) - 150; c.fillStyle = "#e8a03a"; c.fillRect(x, HOR - 12, 14, 12); c.fillStyle = "#c87a20"; c.fillRect(x + 2, HOR - 10, 10, 2); }
  // bleachers + crowd band along the horizon
  c.fillStyle = "#9a7a5a"; c.fillRect(0, HOR - 3, W, 3);
}
function drawBox(c, p, t) {
  const s = 17 * p.sc, y = p.sy - 10 * p.sc - Math.sin(t * 3) * 1.5 * p.sc;
  const hue = (t * 120) % 360;
  c.save(); c.translate(p.sx, y); c.fillStyle = "hsl(" + hue + ",90%,60%)"; c.fillRect(-s / 2, -s / 2, s, s);
  c.strokeStyle = "hsl(" + (hue + 120) % 360 + ",90%,70%)"; c.lineWidth = Math.max(1, s * .12); c.strokeRect(-s / 2, -s / 2, s, s);
  c.fillStyle = "#fff"; c.font = "bold " + s * .75 + "px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("?", 0, 1);
  c.restore();
}
function drawCoin(c, p, t) {
  const s = 8 * p.sc, y = p.sy - 6 * p.sc, w = Math.abs(Math.cos(t * 4)) * s;
  c.fillStyle = "#ffd21f"; c.beginPath(); c.ellipse(p.sx, y, Math.max(1, w * .6), s * .6, 0, 0, TAU); c.fill();
  c.strokeStyle = "#b8860b"; c.lineWidth = Math.max(.5, s * .1); c.stroke();
}
function drawObj(c, o, p, t) {
  const s = 26 * p.sc;
  c.fillStyle = "rgba(0,0,0,.3)"; c.beginPath(); c.ellipse(p.sx, p.sy, s * .35, s * .12, 0, 0, TAU); c.fill();
  c.save(); c.translate(0, -s * .3);
  if (o.t === "fake") { icon(c, "fake", p.sx, p.sy, s); }
  else if (o.t === "bomb") { icon(c, "bomb", p.sx, p.sy, s * (1 + (o.fuse < 0.8 && ((t * 12) | 0) % 2 ? .2 : 0))); }
  else icon(c, o.t, p.sx, p.sy, s);
  c.restore();
}
function drawHeld(c, k, p, ca) {
  if (!k.item || k.rouletteT > 0) return;
  const b = TRIPLE_BASE(k.item.type); if (!["green", "red", "banana", "fake", "bomb"].includes(b)) return;
  const n = k.item.n == null ? (M.TRIPLE[k.item.type] ? 3 : 1) : k.item.n;
  const a = M.wrap(k.h - ca), sa = Math.sin(a), cosa = Math.cos(a), pf = CAMH / (F / p.sc) * 0.9;
  for (let i = 0; i < n; i++) { const u = -28 - i * 9; icon(c, b, p.sx + (u * sa) * p.sc, p.sy - (u * cosa) * p.sc * pf - 6 * p.sc, 14 * p.sc); }
}
function nameTag(c, k, p) { c.fillStyle = "rgba(0,0,0,.55)"; c.font = "bold 6px sans-serif"; c.textAlign = "center"; c.textBaseline = "alphabetic"; const w = c.measureText(k.c.name).width + 4; c.fillRect(p.sx - w / 2, p.sy - 50 * p.sc - 6, w, 8); c.fillStyle = "#fff"; c.fillText(k.c.name, p.sx, p.sy - 50 * p.sc); }

const ORD = n => n + (n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th");
const fmtT = s => { if (s == null) return "--"; const m = Math.floor(s / 60), r = s - m * 60; return m + "'" + (r < 10 ? "0" : "") + r.toFixed(2) + '"'; };

function drawHud(st) {
  const c = st.vg, g = st.game, P = g.player;
  c.save(); c.textBaseline = "top";
  const txt = (s, x, y, sz, col, al) => { c.font = "bold " + sz + "px sans-serif"; c.textAlign = al || "left"; c.lineWidth = 3; c.strokeStyle = "#000"; c.strokeText(s, x, y); c.fillStyle = col || "#fff"; c.fillText(s, x, y); };
  // item slot (top left)
  c.fillStyle = "rgba(20,20,40,.7)"; c.strokeStyle = "#fff"; c.lineWidth = 1.5; c.beginPath(); c.roundRect(5, 5, 34, 34, 6); c.fill(); c.stroke();
  if (P.rouletteT > 0) { const keys = Object.keys(M.ITEM_TABLE); icon(c, keys[((st.t * 14) | 0) % keys.length], 22, 22, 26); }
  else if (P.item) { icon(c, P.item.type, 22, 22, 28); if (P.item.n != null && P.item.n > 0 && M.TRIPLE[P.item.type]) txt("x" + P.item.n, 30, 28, 9); }
  // position and lap
  const place = P.finished ? P.place : P.place;
  txt(ORD(place), W - 8, 4, 26, place === 1 ? "#ffe03a" : "#fff", "right");
  txt("LAP " + Math.min(g.laps, Math.max(1, P.lap + 1)) + "/" + g.laps, 46, 6, 11);
  txt(fmtT(Math.max(0, g.t)), 46, 19, 10, "#cfe3ff");
  // coins
  c.fillStyle = "#ffd21f"; c.beginPath(); c.arc(54, 40, 4.5, 0, TAU); c.fill(); txt("x" + P.coins, 62, 34, 10);
  // speed multiplier + focus mini readout bottom left
  txt("SPEED x" + g.m.toFixed(2), 6, H - 16, 10, g.m >= 1 ? "#7dffb8" : "#ffb3b3");
  // status icons
  let sy = 56;
  const tag = (s, col) => { txt(s, 6, sy, 9, col); sy += 11; };
  if (P.starT > 0) tag("STAR " + P.starT.toFixed(1), "#ffe03a");
  if (P.boostT > 0) tag("BOOST", "#ffb040");
  if (P.shrinkT > 0) tag("SHRUNK", "#9ad");
  if (P.ghostT > 0) tag("BOO", "#ddf");
  if (P.bulletT > 0) tag("BULLET BILL", "#fff");
  if (P.drift) tag(P.mt ? "MINI-TURBO " + P.mt : "DRIFT", P.mt === 3 ? "#d27bff" : P.mt === 2 ? "#ff9a2a" : P.mt === 1 ? "#6ad7ff" : "#fff");
  // ink
  if (P.inkT > 0) { c.fillStyle = "rgba(250,250,250," + Math.min(.9, P.inkT) + ")"; for (let i = 0; i < 9; i++) { c.beginPath(); c.ellipse(40 + i * 30, 80 + ((i * 53) % 90), 26, 20, 0, 0, TAU); c.fill(); } }
  // countdown / messages
  if (g.state === "countdown") { const n = Math.ceil(-g.t); if (n >= 1 && n <= 3) txt(String(n), W / 2, 60, 60, "#ffe03a", "center"); }
  if (st.msgT > 0) { st.msgT -= 1 / 60; txt(st.msg, W / 2, 70, 28, "#ffe03a", "center"); }
  // results
  if (g.state === "results" && g.results) {
    c.fillStyle = "rgba(0,10,50,.88)"; c.fillRect(30, 18, W - 60, H - 36);
    txt("RESULTS", W / 2, 22, 18, "#ffe03a", "center");
    g.results.forEach((r, i) => {
      const y = 48 + i * 18; if (r.player) { c.fillStyle = "rgba(255,224,58,.25)"; c.fillRect(40, y - 2, W - 80, 17); }
      txt(String(r.place), 50, y, 11); txt(r.name, 70, y, 11, r.player ? "#ffe03a" : "#fff"); txt(fmtT(r.time), 200, y, 11); txt(r.points + " pts", 275, y, 11, "#9fdcff", "right");
    });
    txt("ENTER: back to panel", W / 2, H - 34, 10, "#cfe3ff", "center");
  }
  c.restore();
}

function drawMap(st) {
  const g = st.game, T = g.T, c = st.mg;
  if (!st.mapCache) {
    const m = document.createElement("canvas"); m.width = 320; m.height = 240; const q = m.getContext("2d");
    q.fillStyle = "#12206a"; q.fillRect(0, 0, 320, 240);
    const sx = 300 / 2700, ox = 160, oy = 120;
    st.mapT = { sx, ox, oy };
    q.lineJoin = "round"; q.lineCap = "round";
    const path = () => { q.beginPath(); T.pts.forEach((p, i) => i ? q.lineTo(ox + p.x * sx, oy + p.y * sx) : q.moveTo(ox + p.x * sx, oy + p.y * sx)); q.closePath(); };
    path(); q.strokeStyle = "#e9e9e9"; q.lineWidth = M.HALF * 2 * sx + 4; q.stroke(); path(); q.strokeStyle = "#8d8f9a"; q.lineWidth = M.HALF * 2 * sx; q.stroke();
    const sp = T.pts[T.start]; q.fillStyle = "#fff"; q.fillRect(ox + sp.x * sx - 1, oy + sp.y * sx - 7, 3, 14);
    st.mapCache = m;
  }
  c.drawImage(st.mapCache, 0, 0);
  const { sx, ox, oy } = st.mapT;
  g.boxes.forEach(b => { if (b.respawn <= 0) { c.fillStyle = "#ffb52b"; c.fillRect(ox + b.x * sx - 1, oy + b.y * sx - 1, 2, 2); } });
  const ks = g.karts.slice().sort((a, b) => (a.isPlayer ? 1 : 0) - (b.isPlayer ? 1 : 0));
  ks.forEach(k => {
    const x = ox + k.x * sx, y = oy + k.y * sx;
    c.fillStyle = "#000"; c.beginPath(); c.arc(x, y, k.isPlayer ? 6 : 5, 0, TAU); c.fill();
    c.fillStyle = k.c.cap === "#f4f4f4" ? "#4f7be0" : k.c.cap; c.beginPath(); c.arc(x, y, k.isPlayer ? 5 : 4, 0, TAU); c.fill();
    if (k.isPlayer) { c.strokeStyle = "#fff"; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(k.h) * 9, y + Math.sin(k.h) * 9); c.stroke(); }
  });
  // leaderboard strip
  c.font = "bold 9px sans-serif"; c.textBaseline = "top"; c.textAlign = "left";
  const order = g.karts.slice().sort((a, b) => a.place - b.place);
  order.forEach((k, i) => { c.fillStyle = k.isPlayer ? "#ffe03a" : "#cfe3ff"; c.fillText((i + 1) + " " + k.c.name, 6 + (i >> 2) * 84, 4 + (i & 3) * 10); });
}

function updateHud() {
  const st = ui; if (!st) return; const h = st.host, g = st.game, el = st.el;
  const sens = h.sensors();
  sens.forEach((s, i) => { const e = el.querySelector("#mkS" + i); if (!e) return; e.className = "sen " + (s.cls || ""); e.querySelector("b").textContent = s.txt; });
  const f = h.focus();
  el.querySelector("#mkFocus").textContent = f == null ? "--" : String(Math.round(f));
  el.querySelector("#mkFbar").style.width = (f == null ? 0 : f) + "%";
  el.querySelector("#mkMult").innerHTML = "&times;" + g.m.toFixed(2);
  el.querySelector("#mkLink").textContent = h.status();
  el.querySelector("#mkWarn").textContent = f == null ? "No live focus reading right now: holding the last speed multiplier until the signal returns." : "";
}

root.MKDSUI = { open, close, isOpen: () => !!ui, _state: () => ui };
})(window);
