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

/* ---------- level-specific rules ----------
   Every bomb gets its OWN rule set, generated from its seed and printed only in that bomb's service sheet (the in-game manual).
   Without reading the sheet there is no way to know what to press. A new bomb means a new sheet. */
const shuffle = (r, a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const int = (r, n) => Math.floor(r() * n);

/* wires */
const WIRE_COLORS = ["red", "blue", "yellow", "white", "black"];
const ORD = ["1st", "2nd", "3rd", "4th", "5th"];
const countOf = (wires, c) => wires.filter(w => w === c).length;
/* returns the wire index to cut if the rule applies, else -1 */
function wireRuleMatch(rule, wires, serial) {
  const odd = (+serial[serial.length - 1]) % 2 === 1;
  switch (rule.type) {
    case "lastParity": return wires[4] === rule.color && (rule.parity === "odd") === odd ? rule.cut : -1;
    case "oneAndMore": return countOf(wires, rule.a) === 1 && countOf(wires, rule.b) > 1 ? rule.cut : -1;
    case "none": return countOf(wires, rule.color) === 0 ? rule.cut : -1;
    case "atLeast": return countOf(wires, rule.color) >= rule.n ? wires.lastIndexOf(rule.color) : -1;
    case "firstIs": return wires[0] === rule.color ? rule.cut : -1;
    case "otherwise": return rule.cut;
  }
  return -1;
}
function wireRuleText(rule, first) {
  const pre = first ? "If " : "Otherwise, if ";
  switch (rule.type) {
    case "lastParity": return `${pre}the last wire is ${rule.color} and the last digit of the serial number is ${rule.parity}, cut the ${ORD[rule.cut]} wire.`;
    case "oneAndMore": return `${pre}there is exactly one ${rule.a} wire and more than one ${rule.b} wire, cut the ${ORD[rule.cut]} wire.`;
    case "none": return `${pre}there are no ${rule.color} wires, cut the ${ORD[rule.cut]} wire.`;
    case "atLeast": return `${pre}there are ${rule.n} or more ${rule.color} wires, cut the last ${rule.color} wire.`;
    case "firstIs": return `${pre}the first wire is ${rule.color}, cut the ${ORD[rule.cut]} wire.`;
    default: return `Otherwise, cut the ${ORD[rule.cut]} wire.`;
  }
}
function evalWireRules(rules, wires, serial) {
  for (let i = 0; i < rules.length; i++) { const c = wireRuleMatch(rules[i], wires, serial); if (c >= 0) return { cut: c, rule: i }; }
  return { cut: -1, rule: -1 };
}
function makeWireRules(r) {
  const col = () => pick(r, WIRE_COLORS);
  const rules = shuffle(r, ["lastParity", "oneAndMore", "none", "atLeast", "firstIs"]).slice(0, 3).map(type => {
    const c = col();
    switch (type) {
      case "lastParity": return { type, color: c, parity: pick(r, ["odd", "even"]), cut: int(r, 5) };
      case "oneAndMore": { let b = col(); while (b === c) b = col(); return { type, a: c, b, cut: int(r, 5) }; }
      case "none": return { type, color: c, cut: int(r, 5) };
      case "atLeast": return { type, color: c, n: 2 + int(r, 2) };
      default: return { type: "firstIs", color: c, cut: int(r, 5) };
    }
  });
  rules.push({ type: "otherwise", cut: int(r, 5) });
  return rules;
}

/* button */
const BUTTON_COLORS = ["red", "blue", "white", "yellow"];
const BUTTON_LABELS = ["HOLD", "PRESS", "ABORT"];
const STRIP_COLORS = ["blue", "white", "yellow", "green"];
const TAP_MAX = 0.5; // seconds: a press shorter than this is a tap
const actText = a => a === "hold" ? "hold it" : "tap it (press and release at once)";
function buttonRuleMatch(rule, label, color) {
  switch (rule.type) {
    case "colorLabel": return rule.color === color && rule.label === label ? rule.action : null;
    case "color": return rule.color === color ? rule.action : null;
    case "label": return rule.label === label ? rule.action : null;
    default: return rule.action;
  }
}
function buttonRuleText(rule, first) {
  const pre = first ? "If " : "Otherwise, if ";
  switch (rule.type) {
    case "colorLabel": return `${pre}the button is ${rule.color} and says ${rule.label}, ${actText(rule.action)}.`;
    case "color": return `${pre}the button is ${rule.color}, ${actText(rule.action)}.`;
    case "label": return `${pre}the button says ${rule.label}, ${actText(rule.action)}.`;
    default: return `Otherwise, ${actText(rule.action)}.`;
  }
}
function evalButtonRules(rules, label, color) {
  for (let i = 0; i < rules.length; i++) { const a = buttonRuleMatch(rules[i], label, color); if (a) return { action: a, rule: i }; }
  return { action: null, rule: -1 };
}
function makeButtonRules(r) {
  const rules = shuffle(r, ["colorLabel", "color", "label"]).map(type => {
    const act = pick(r, ["hold", "tap"]);
    if (type === "colorLabel") return { type, color: pick(r, BUTTON_COLORS), label: pick(r, BUTTON_LABELS), action: act };
    if (type === "color") return { type, color: pick(r, BUTTON_COLORS), action: act };
    return { type, label: pick(r, BUTTON_LABELS), action: act };
  });
  rules.push({ type: "otherwise", action: pick(r, ["hold", "tap"]) });
  return rules;
}
const stripRuleText = map => "When you hold the button a coloured strip lights up. Release when the countdown shows the matching digit anywhere: " + STRIP_COLORS.map(c => `${c} ${map[c]}`).join(", ") + ".";

/* keypad */
const SYMBOLS = ["★", "☾", "♠", "✚", "⚑", "♦", "☀", "♣", "♥", "☂"];

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
  /* wires: keep drawing until a CONDITIONAL rule decides the answer (so the fallback rule is not always the one that applies) */
  let wires, wrules, wres;
  for (let g = 0; g < 500; g++) {
    wires = []; for (let i = 0; i < 5; i++) wires.push(pick(r, WIRE_COLORS));
    wrules = makeWireRules(r); wres = evalWireRules(wrules, wires, serial);
    if (wres.rule >= 0 && wres.rule < 3) break;
  }
  /* button: the rule set uses both hold and tap, and a conditional rule decides */
  let label, color, brules, bres;
  for (let g = 0; g < 500; g++) {
    label = pick(r, BUTTON_LABELS); color = pick(r, BUTTON_COLORS); brules = makeButtonRules(r); bres = evalButtonRules(brules, label, color);
    if (bres.rule >= 0 && bres.rule < 3 && new Set(brules.map(x => x.action)).size === 2) break;
  }
  const strip = pick(r, STRIP_COLORS), digits = shuffle(r, [1, 2, 3, 4, 5, 6, 7, 8, 9]), stripDigits = {};
  STRIP_COLORS.forEach((c, i) => stripDigits[c] = digits[i]);
  /* keypad: three random columns; the four symbols on the pad fit exactly one of them */
  let columns, col, syms;
  for (let g = 0; g < 500; g++) {
    columns = [0, 1, 2].map(() => shuffle(r, SYMBOLS).slice(0, 6));
    col = int(r, 3);
    const chosen = shuffle(r, columns[col]).slice(0, 4);
    if (columns.filter(c => chosen.every(x => c.includes(x))).length === 1) { syms = chosen; break; }
  }
  const order = syms.slice().sort((a, b) => columns[col].indexOf(a) - columns[col].indexOf(b));
  const shown = shuffle(r, syms);
  return {
    seed, serial, timeLimit: TUNING.timeLimit, maxStrikes: TUNING.maxStrikes,
    wires: { colors: wires, cut: wres.cut, rules: wrules, ruleUsed: wres.rule },
    button: { label, color, strip, action: bres.action, digit: stripDigits[strip], rules: brules, stripDigits, ruleUsed: bres.rule },
    keypad: { columns, column: col, shown, order }
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

const API = { TUNING, rng, stressFromFocus, clockRate, handShake, sweatRate, heartBpm, isShorted, effectiveStress,
  WIRE_COLORS, BUTTON_COLORS, BUTTON_LABELS, STRIP_COLORS, SYMBOLS, ORD, TAP_MAX,
  wireRuleMatch, wireRuleText, evalWireRules, buttonRuleMatch, buttonRuleText, evalButtonRules, stripRuleText,
  makeSerial, makeLevel, judgeWire, judgeButton, judgeKey };
if (typeof module !== "undefined" && module.exports) module.exports = API;
root.BombLogic = API;
})(typeof window !== "undefined" ? window : globalThis);
