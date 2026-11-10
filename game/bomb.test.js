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

// rule evaluation on explicit rule sets
const S_ODD = "A1B2C3", S_EVEN = "A1B2C4";
const WR = [{ type: "lastParity", color: "black", parity: "odd", cut: 3 }, { type: "oneAndMore", a: "red", b: "yellow", cut: 0 }, { type: "atLeast", color: "blue", n: 2 }, { type: "otherwise", cut: 4 }];
ok(B.evalWireRules(WR, ["red", "blue", "white", "white", "black"], S_ODD).cut === 3, "wire rule: last black + odd serial");
ok(B.evalWireRules(WR, ["red", "blue", "white", "white", "black"], S_EVEN).rule === 3, "the same wires with an even serial fall through to the last rule");
ok(B.evalWireRules(WR, ["red", "yellow", "yellow", "white", "white"], S_EVEN).cut === 0, "wire rule: one red and two yellow");
ok(B.evalWireRules(WR, ["white", "blue", "white", "blue", "white"], S_EVEN).cut === 3, "wire rule: 'last blue wire' is computed from the wires");
ok(B.wireRuleText(WR[0], true).startsWith("If the last wire is black") && B.wireRuleText(WR[3], false) === "Otherwise, cut the 5th wire.", "rule text reads naturally");
const BR = [{ type: "colorLabel", color: "blue", label: "ABORT", action: "hold" }, { type: "color", color: "yellow", action: "tap" }, { type: "otherwise", action: "hold" }];
ok(B.evalButtonRules(BR, "ABORT", "blue").action === "hold" && B.evalButtonRules(BR, "PRESS", "yellow").action === "tap" && B.evalButtonRules(BR, "PRESS", "red").rule === 2, "button rule evaluation, first match wins");

// every bomb has its own rule set, and every one is solvable
let bad = 0, wiresCovered = new Set(), actions = new Set(), distinctSheets = new Set(), condWire = 0, condBtn = 0;
for (let seed = 1; seed <= 2000; seed++) {
  const lv = B.makeLevel(seed), lv2 = B.makeLevel(seed);
  if (JSON.stringify(lv) !== JSON.stringify(lv2)) bad++;
  if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(lv.serial)) bad++;
  distinctSheets.add(JSON.stringify([lv.wires.rules, lv.button.rules, lv.button.stripDigits, lv.keypad.columns]));
  wiresCovered.add(lv.wires.cut); actions.add(lv.button.action);
  // wires: the answer is exactly what the printed rules say, and a conditional rule (not the fallback) decides
  const w = B.evalWireRules(lv.wires.rules, lv.wires.colors, lv.serial);
  if (w.cut !== lv.wires.cut || w.rule < 0 || w.rule >= 3 || lv.wires.ruleUsed !== w.rule) bad++; else condWire++;
  if (B.judgeWire(lv, lv.wires.cut) !== "solved" || B.judgeWire(lv, (lv.wires.cut + 1) % 5) !== "strike") bad++;
  // button: answer follows the printed rules; both actions are in the rule set; strip digits are distinct 1-9
  const b = B.evalButtonRules(lv.button.rules, lv.button.label, lv.button.color);
  if (b.action !== lv.button.action || b.rule >= 3 || new Set(lv.button.rules.map(x => x.action)).size !== 2) bad++; else condBtn++;
  const dg = Object.values(lv.button.stripDigits); if (new Set(dg).size !== 4 || dg.some(d => d < 1 || d > 9) || lv.button.digit !== lv.button.stripDigits[lv.button.strip]) bad++;
  const d = String(lv.button.digit);
  const good = lv.button.action === "tap" ? B.judgeButton(lv, 0.2, "0000") : B.judgeButton(lv, 1.5, "0" + d + "00");
  const wrongTap = lv.button.action === "tap" ? B.judgeButton(lv, 1.5, "0" + d + "00") : B.judgeButton(lv, 0.2, "0" + d + "00");
  if (good !== "solved" || wrongTap !== "strike") bad++;
  // keypad: the four symbols fit exactly one printed column, and the answer is that column's order
  const cols = lv.keypad.columns, col = cols[lv.keypad.column];
  if (cols.length !== 3 || cols.some(c => c.length !== 6 || new Set(c).size !== 6)) bad++;
  if (lv.keypad.order.length !== 4 || new Set(lv.keypad.shown).size !== 4 || !lv.keypad.shown.every(x => lv.keypad.order.includes(x))) bad++;
  if (cols.filter(c => lv.keypad.order.every(x => c.includes(x))).length !== 1) bad++;
  if (!lv.keypad.order.every((x, i, a) => i === 0 || col.indexOf(a[i - 1]) < col.indexOf(x))) bad++;
  if (!lv.keypad.order.every((x, i) => B.judgeKey(lv, i, x) === "ok") || B.judgeKey(lv, 0, lv.keypad.order[1]) !== "strike") bad++;
}
ok(bad === 0, "2000 generated levels are deterministic, solvable, and follow their own printed rules (" + bad + " problems)");
ok(distinctSheets.size > 1990, "almost every bomb has a different rule sheet (" + distinctSheets.size + " of 2000)");
ok(wiresCovered.size === 5 && actions.size === 2, "all five wires and both button actions occur across bombs");
ok(condWire === 2000 && condBtn === 2000, "a conditional rule (not the fallback) always decides the wires and the button");

if (typeof document !== "undefined") { document.body.style.cssText = "font:14px monospace;white-space:pre;padding:16px;background:#111;color:#ddd"; document.body.textContent = out.join("\n") + "\n\n" + (fails ? fails + " FAILED" : "ALL PASSED"); }
else { console.log(out.join("\n")); console.log(fails ? fails + " FAILED" : "ALL PASSED"); process.exit(fails ? 1 : 0); }
