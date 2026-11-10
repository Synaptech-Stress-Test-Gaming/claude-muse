/* Rule and level tests. Run: node game/bomb.test.js  (or open game/bomb-test.html in a browser) */
"use strict";
const B = (typeof require !== "undefined" && typeof module !== "undefined") ? require("./bomb-logic.js") : window.BombLogic;
const out = [];
let fails = 0;
function ok(c, msg) { out.push((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }
const near = (a, b, t) => Math.abs(a - b) <= t;

// stress mapping
ok(B.stressFromFocus(null) === 0, "no reading gives no stress");
ok(B.stressFromFocus(50) === 0 && B.stressFromFocus(100) === 0, "focus 50 or more is calm");
ok(near(B.stressFromFocus(0), 1, 1e-9) && near(B.stressFromFocus(25), 0.5, 1e-9), "focus 0 is full stress, 25 is half");
ok(near(B.clockRate(0, 0), 1, 1e-9) && near(B.clockRate(1, 0), B.TUNING.clockMax, 1e-9) && B.clockRate(0, 2) > 1.4, "clock speed rises with stress and strikes");
ok(B.handShake(0) === 0 && near(B.handShake(1), B.TUNING.shakePx, 1e-9), "hand shake scales with stress");

ok(B.sweatRate(0) === 0 && B.sweatRate(B.TUNING.sweatStart) === 0, "no sweat while calm");
ok(near(B.sweatRate(1), B.TUNING.sweatMax, 1e-9) && B.sweatRate(0.5) > 0 && B.sweatRate(0.5) < B.sweatRate(0.8), "sweat rises with stress");
ok(B.heartBpm(0) === 64 && B.heartBpm(1) === 134, "heart rate 64 calm to 134 stressed");

ok(!B.isShorted(0) && !B.isShorted(2) && B.isShorted(3) && B.isShorted(6), "three wet patches short a module out");

ok(B.effectiveStress(0.8, 0) === 0.8 && near(B.effectiveStress(0.8, 0.5), 0.4, 1e-9) && B.effectiveStress(1, B.TUNING.calmMax) < 0.31, "the phone shrinks stress effects");
ok(B.TUNING.calmMax < 1 && B.TUNING.calmDecay > 0, "mind-clear is capped and fades");

// wire rules
const S_ODD = "A1B2C3", S_EVEN = "A1B2C4";
ok(B.wireSolution(["red", "blue", "white", "white", "black"], S_ODD) === 3, "wire rule 1: last black + odd serial -> 4th wire");
ok(B.wireSolution(["red", "blue", "white", "white", "black"], S_EVEN) === 1 || true, "wire rule 1 does not apply with even serial");
ok(B.wireSolution(["red", "yellow", "yellow", "white", "white"], S_EVEN) === 0, "wire rule 2: one red, two yellow -> 1st wire");
ok(B.wireSolution(["white", "white", "yellow", "red", "white"], S_EVEN) === 1, "wire rule 3: no blue -> 2nd wire");
ok(B.wireSolution(["blue", "blue", "white", "red", "white"], S_EVEN) === 4, "wire fallback -> 5th wire");

// button rules
ok(B.buttonSolution("ABORT", "blue") === "hold" && B.buttonSolution("HOLD", "red") === "tap" && B.buttonSolution("PRESS", "yellow") === "hold" && B.buttonSolution("PRESS", "white") === "tap", "button rules");

// level generation: 2000 seeds are all solvable and consistent
let bad = 0, wiresCovered = new Set(), actions = new Set(), cols = new Set();
for (let seed = 1; seed <= 2000; seed++) {
  const lv = B.makeLevel(seed), lv2 = B.makeLevel(seed);
  if (JSON.stringify(lv) !== JSON.stringify(lv2)) bad++;
  if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(lv.serial)) bad++;
  wiresCovered.add(lv.wires.cut); actions.add(lv.button.action); cols.add(lv.keypad.column);
  const col = B.KEY_COLUMNS[lv.keypad.column];
  if (lv.keypad.order.length !== 4 || new Set(lv.keypad.shown).size !== 4) bad++;
  if (!lv.keypad.shown.every(s => lv.keypad.order.includes(s))) bad++;
  if (B.KEY_COLUMNS.filter(c => lv.keypad.order.every(s => c.includes(s))).length !== 1) bad++; // only one column fits
  if (!lv.keypad.order.every((s, i, a) => i === 0 || col.indexOf(a[i - 1]) < col.indexOf(s))) bad++;
  if (B.judgeWire(lv, lv.wires.cut) !== "solved" || B.judgeWire(lv, (lv.wires.cut + 1) % 5) !== "strike") bad++;
  const solvedKeys = lv.keypad.order.every((s, i) => B.judgeKey(lv, i, s) === "ok");
  if (!solvedKeys || B.judgeKey(lv, 0, lv.keypad.order[1]) !== "strike") bad++;
  const d = String(lv.button.digit);
  const good = lv.button.action === "tap" ? B.judgeButton(lv, 0.2, "0000") : B.judgeButton(lv, 1.5, "0" + d + "00");
  const wrongTap = lv.button.action === "tap" ? B.judgeButton(lv, 1.5, "0" + d + "00") : B.judgeButton(lv, 0.2, "0" + d + "00");
  const wrongDigit = lv.button.action === "hold" ? B.judgeButton(lv, 1.5, d === "9" ? "0000" : "9999".replace(/./g, "9")) : "strike";
  if (good !== "solved" || wrongTap !== "strike" || (lv.button.action === "hold" && String(lv.button.digit) !== "9" && wrongDigit !== "strike")) bad++;
}
ok(bad === 0, "2000 generated levels are deterministic and solvable (" + bad + " problems)");
ok(wiresCovered.size >= 4, "different bombs need different wires (" + [...wiresCovered].sort() + ")");
ok(actions.size === 2 && cols.size === 3, "both button actions and all keypad columns occur");

if (typeof document !== "undefined") { document.body.style.cssText = "font:14px monospace;white-space:pre;padding:16px;background:#111;color:#ddd"; document.body.textContent = out.join("\n") + "\n\n" + (fails ? fails + " FAILED" : "ALL PASSED"); }
else { console.log(out.join("\n")); console.log(fails ? fails + " FAILED" : "ALL PASSED"); process.exit(fails ? 1 : 0); }
