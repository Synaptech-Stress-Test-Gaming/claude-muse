/* Bomb defusal prototype: pure rules and level generation (no DOM). Tested by game/bomb.test.js.
   An original look-alike inspired by cooperative bomb-defusal games; all art is drawn in code. */
"use strict";
(function (root) {

const TUNING = {
  timeLimit: 180,        // seconds on the clock
  maxStrikes: 3,
  neutralFocus: 50,      // focus at or above this = calm. Below it, stress rises toward 1 at focus 0
  shakePx: 16,           // hand tremor at full stress (pixels on the 960x620 bomb)
  clockMax: 1.6,         // clock speed at full stress (1 = normal)
  strikeSpeedup: 0.25,   // each strike adds this much to the clock speed
  glitchStress: 0.55,    // above this stress the display can glitch
  smoothingSec: 1.0,     // low-pass time constant for the stress signal
  sweatStart: 0.15,      // sweat begins above this stress
  sweatMax: 0.8,         // sweat drops per second at full stress
  maxSmudges: 16,        // wet patches on the bomb at once
  smudgeLife: 12,        // seconds before a wet patch dries
  slipPx: 28,            // a press on a wet patch slides this far (bomb pixels, mostly downward)
  calmMax: 0.7,          // the phone can remove at most this share of your stress effects
  calmPerPx: 5000,       // each pixel scrolled adds 1/calmPerPx of mind-clear (up to calmMax)
  calmDecay: 0.012,      // mind-clear fades by this much per second after you put the phone down
  shortAt: 3             // this many wet patches on one module short it out until you wipe
};

/* ---------- random numbers (seedable, so a level can be replayed) ---------- */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];
const clamp01 = v => Math.max(0, Math.min(1, v));

/* ---------- stress signal: one place that turns the headband reading into game effects ---------- */
/* focus: 0..100 from the panel's focus meter, or null when there is no reading. Returns stress 0..1. */
function stressFromFocus(focus, T) {
  T = T || TUNING;
  if (focus == null || !isFinite(focus)) return 0;
  return clamp01((T.neutralFocus - focus) / T.neutralFocus);
}
function clockRate(stress, strikes, T) {
  T = T || TUNING;
  return 1 + stress * (T.clockMax - 1) + strikes * T.strikeSpeedup;
}
function handShake(stress, T) { return stress * (T || TUNING).shakePx; }
/* sweat drops per second: none while calm, rising steeply toward full stress */
function sweatRate(stress, T) {
  T = T || TUNING;
  if (stress <= T.sweatStart) return 0;
  return T.sweatMax * Math.pow((stress - T.sweatStart) / (1 - T.sweatStart), 1.2);
}
/* a module is shorted (dead to touch) when it carries enough wet patches */
function isShorted(wetCount, T) { return wetCount >= (T || TUNING).shortAt; }
/* the phone clears your head: the game's stress effects shrink by `calm` (0..calmMax) */
function effectiveStress(stress, calm) { return clamp01(stress) * (1 - Math.max(0, Math.min(1, calm || 0))); }
function heartBpm(stress) { return 64 + 70 * clamp01(stress); }

/* ---------- wires module ---------- */
const WIRE_COLORS = ["red", "blue", "yellow", "white", "black"];
const WIRE_RULES = [
  "If the last wire is black and the last digit of the serial number is odd, cut the 4th wire.",
  "Otherwise, if there is exactly one red wire and more than one yellow wire, cut the 1st wire.",
  "Otherwise, if there are no blue wires, cut the 2nd wire.",
  "Otherwise, cut the 5th wire."
];
function wireSolution(wires, serial) {
  const n = c => wires.filter(w => w === c).length;
  const lastOdd = (+serial[serial.length - 1]) % 2 === 1;
  if (wires[4] === "black" && lastOdd) return 3;
  if (n("red") === 1 && n("yellow") > 1) return 0;
  if (n("blue") === 0) return 1;
  return 4;
}

/* ---------- button module ---------- */
const BUTTON_COLORS = ["red", "blue", "white", "yellow"];
const BUTTON_LABELS = ["HOLD", "PRESS", "ABORT"];
const STRIP_COLORS = ["blue", "white", "yellow", "green"];
const STRIP_DIGIT = { blue: 4, white: 1, yellow: 5, green: 1 };
const BUTTON_RULES = [
  "If the button is blue and says ABORT, hold it.",
  "Otherwise, if the button is red and says HOLD, press and immediately release it (a tap).",
  "Otherwise, if the button is yellow, hold it.",
  "Otherwise, tap it."
];
const STRIP_RULES = "When you hold the button a coloured strip lights up. Release when the countdown shows the matching digit anywhere: blue 4, white 1, yellow 5, green 1.";
function buttonSolution(label, color) {
  if (color === "blue" && label === "ABORT") return "hold";
  if (color === "red" && label === "HOLD") return "tap";
  if (color === "yellow") return "hold";
  return "tap";
}
const TAP_MAX = 0.5; // seconds: a press shorter than this is a tap

/* ---------- keypad module ---------- */
const KEY_COLUMNS = [
  ["★", "☾", "♠", "✚", "⚑", "♦"],
  ["☀", "♣", "★", "♥", "☂", "✚"],
  ["♦", "☂", "☾", "☀", "♠", "♥"]
];

/* ---------- serial number ---------- */
function makeSerial(r) {
  const L = "ABCDEFGHJKLMNPQRSTUVWXZ", D = "0123456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += i % 2 === 0 ? pick(r, L.split("")) : pick(r, D.split(""));
  return s;
}

/* ---------- level ---------- */
function makeLevel(seed) {
  seed = seed == null ? Math.floor(Math.random() * 1e9) : seed >>> 0;
  const r = rng(seed);
  const serial = makeSerial(r);
  const wires = []; for (let i = 0; i < 5; i++) wires.push(pick(r, WIRE_COLORS));
  const label = pick(r, BUTTON_LABELS), color = pick(r, BUTTON_COLORS), strip = pick(r, STRIP_COLORS);
  let col, syms;
  for (let guard = 0; guard < 200; guard++) {
    col = Math.floor(r() * KEY_COLUMNS.length);
    const pool = KEY_COLUMNS[col].slice(), chosen = [];
    while (chosen.length < 4) chosen.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    const owners = KEY_COLUMNS.filter(c => chosen.every(s => c.includes(s))).length;
    if (owners === 1) { syms = chosen; break; }
  }
  const order = syms.slice().sort((a, b) => KEY_COLUMNS[col].indexOf(a) - KEY_COLUMNS[col].indexOf(b));
  const shown = syms.slice();
  for (let i = shown.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [shown[i], shown[j]] = [shown[j], shown[i]]; }
  return {
    seed, serial, timeLimit: TUNING.timeLimit, maxStrikes: TUNING.maxStrikes,
    wires: { colors: wires, cut: wireSolution(wires, serial) },
    button: { label, color, strip, action: buttonSolution(label, color), digit: STRIP_DIGIT[strip] },
    keypad: { column: col, shown, order }
  };
}

/* ---------- judging player actions ---------- */
function judgeWire(level, idx) { return idx === level.wires.cut ? "solved" : "strike"; }
/* heldSec: how long the button was held; clock: displayed digits such as "0231" */
function judgeButton(level, heldSec, clock) {
  const b = level.button, tap = heldSec < TAP_MAX;
  if (b.action === "tap") return tap ? "solved" : "strike";
  if (tap) return "strike";
  return clock.indexOf(String(b.digit)) >= 0 ? "solved" : "strike";
}
function judgeKey(level, progress, sym) { return sym === level.keypad.order[progress] ? "ok" : "strike"; }

const API = { TUNING, rng, stressFromFocus, clockRate, handShake, sweatRate, heartBpm, isShorted, effectiveStress, WIRE_COLORS, WIRE_RULES, wireSolution,
  BUTTON_COLORS, BUTTON_LABELS, STRIP_COLORS, STRIP_DIGIT, BUTTON_RULES, STRIP_RULES, buttonSolution, TAP_MAX,
  KEY_COLUMNS, makeSerial, makeLevel, judgeWire, judgeButton, judgeKey };
if (typeof module !== "undefined" && module.exports) module.exports = API;
root.BombLogic = API;
})(typeof window !== "undefined" ? window : globalThis);
