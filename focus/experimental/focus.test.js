/* Implementation tests for the focus engine, quick calibration and recording columns. Run: node focus/focus.test.js
   These prove the code implements the intended model on synthetic signals. They do NOT validate that the score measures focus. */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// The focus files are plain browser scripts that share the panel's globals. Load them into one context with stubbed panel globals.
const stubs = `
const FS=256,BUF_LEN=1024,MIN_SPAN=.4;
const S={raw:[0,1,2,3].map(()=>new Float32Array(1024)),rawPos:0,connected:true,emitted:0,gapAt:-1e9,holdUntil:0,pct:[null,100,100,null]};
const focus={cal:null,raw:null,ema:null,lo:null,hi:null};
const TOASTS=[];function toast(m){TOASTS.push(m);}function renderFocus(){}
const localStorage={setItem(){}};
const $=()=>({});
function quantile(s,q){const p=(s.length-1)*q,i=Math.floor(p),f=p-i;return s[i]+(s[Math.min(i+1,s.length-1)]-s[i])*f;}
function pctOf(f){if(f.ema==null||f.lo==null||f.hi==null||f.hi-f.lo<0.05)return null;return Math.max(0,Math.min(100,25+(f.ema-f.lo)/(f.hi-f.lo)*50));}
function effMode(){return "corrected";}
`;
const dir = __dirname;
const src = ["focus-engine.js", "focus-calibration.js", "focus-recording.js"].map(f => fs.readFileSync(path.join(dir, f), "utf8").replace(/^"use strict";/m, "")).join("\n");
const api = vm.runInThisContext("(function(){" + stubs + src + `
return {S,focus,fc,fg,PIPE_FP,CST_NAMES,TOASTS,calibCheck,setCal,corrStep,chanBands,startQuickCal,focusRecFill,focusRecFormat,FOCUS_REC_COLNAMES,
  getCAL:()=>CAL,getWHY:()=>CAL_WHY,getQC:()=>QC,setQC:v=>{QC=v;}};})()`);
const { S, fc, fg, PIPE_FP, CST_NAMES } = api;

let seed = 1;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
const sine = (f, a) => t => a * Math.sin(2 * Math.PI * f * t);
function feed(fn, ch1 = fn, ch2 = fn) { // one second of samples into AF7 (index 1) and AF8 (index 2)
  for (let k = 0; k < 256; k++) {
    const t = k / 256;
    S.raw[1][S.rawPos] = ch1(t); S.raw[2][S.rawPos] = ch2(t);
    S.rawPos = (S.rawPos + 1) % 1024; S.emitted++;
  }
}
const base = t => sine(10, 6)(t) + sine(20, 3)(t);

// ---- band power scaling: a 10 Hz sine of amplitude 10 has power 50 ----
S.emitted = 1000;
feed(sine(10, 10));
ok(near(api.chanBands(1).alpha, 50, 0.5), "PSD scaling: 10 uV sine at 10 Hz gives alpha power ~50");

// ---- calibration validation ----
const CAL0 = {
  version: 1, fingerprint: PIPE_FP, channels: ["AF7", "AF8"],
  rest: { AF7: { emg: 0.05, alpha: 20, beta: 8, margin: 0.02 }, AF8: { emg: 0.05, alpha: 20, beta: 8, margin: 0.02 } },
  gains: { AF7: 2, AF8: 2 }, T_heavy: 20, T_gate_only: 3, floor: 0.2, max_removed_frac: 0.6, max_hold_s: 3, p2p_limit_uV: 100
};
ok(api.calibCheck(CAL0) === "", "valid calibration is accepted");
ok(/does not match/.test(api.calibCheck({ ...CAL0, fingerprint: "x" })), "wrong pipeline fingerprint is refused");
ok(api.calibCheck({ ...CAL0, channels: [] }) !== "", "calibration with no channels is refused");
ok(api.calibCheck({ ...CAL0, gains: { AF7: -1, AF8: 2 } }) !== "", "negative gain is refused");
ok(api.setCal({ ...CAL0, version: 2 }) !== "" && api.getCAL() === null, "refused calibration leaves Corrected disabled");

// ---- gate order and statuses ----
api.setCal(CAL0);
S.emitted = 1000; S.holdUntil = 0;
const run = (fn, pre) => { feed(fn); if (pre) pre(); api.corrStep(); };
run(base);
ok(CST_NAMES[fc.st] === "ok" && fc.valid && CST_NAMES[fg.st] === "ok", "clean window: ok and valid in both modes");
ok(fc.raw === fg.raw, "rest invariance: Corrected equals Gate-only exactly when there is no excess muscle power");
run(t => base(t) + sine(35, 0.4)(t));
ok(CST_NAMES[fc.st] === "corrected_emg" && fc.valid && fc.rem > 0 && CST_NAMES[fg.st] === "ok", "light muscle: Corrected subtracts, Gate-only keeps the window");
run(t => base(t) + sine(35, 0.9)(t));
ok(CST_NAMES[fc.st] === "corrected_emg" && CST_NAMES[fg.st] === "rejected_emg_heavy", "medium muscle: Corrected still corrects, Gate-only rejects (3x gate)");
run(t => base(t) + sine(35, 8)(t));
ok(CST_NAMES[fc.st] === "rejected_emg_heavy" && !fc.valid && Number.isNaN(fc.raw), "heavy muscle: rejected, no value");
run(t => base(t) + (t > 0.4 && t < 0.6 ? 150 : 0));
ok(CST_NAMES[fc.st] === "rejected_blink" && !fc.valid, "big swing: rejected_blink");
run(base, () => { S.holdUntil = S.emitted / 256 + 0.3; });
ok(CST_NAMES[fc.st] === "holdoff" && !fc.valid, "inside the 0.5 s hold-off: holdoff, invalid");
run(base, () => { S.holdUntil = 0; S.gapAt = S.emitted - 100; });
ok(CST_NAMES[fc.st] === "rejected_gap" && !fc.valid, "packet gap inside the window: rejected_gap");
S.gapAt = -1e9;
S.pct = [null, 0, 0, null]; run(base);
ok(CST_NAMES[fc.st] === "no_contact" && !fc.valid, "no forehead contact: no_contact");
S.pct = [null, 100, 0, null]; run(base);
ok(fc.valid, "one forehead sensor with contact is enough");
S.pct = [null, 100, 100, null];

// ---- quick calibration on a synthetic recording (AF7 dead, AF8 good) ----
api.setCal(null);
S.emitted = 0; S.rawPos = 0; S.gapAt = -1e9; S.holdUntil = 0; S.pct = [null, 0, 100, null];
api.startQuickCal();
let n = 0;
while (api.getQC() && n < 2000) {
  for (let k = 0; k < 64; k++) {
    const t = (n * 64 + k) / 256, tt = t - 8, u = tt >= 0 ? tt % 6 : 99, cl = tt >= 0 && u < 4, ramp = cl ? Math.min(1, u / 2) : 0;
    S.raw[1][S.rawPos] = rnd() * 0.02; // AF7: flat, no contact
    S.raw[2][S.rawPos] = 6 * Math.sin(2 * Math.PI * 10 * t) + (3 + 6 * ramp) * Math.sin(2 * Math.PI * 20 * t) + (0.2 + 3 * ramp) * Math.sin(2 * Math.PI * 35 * t) + rnd() * 1.2;
    S.rawPos = (S.rawPos + 1) % 1024; S.emitted++;
  }
  n++;
  if (S.emitted >= 256 * 3 && (S.emitted - 512) % 64 === 0) api.corrStep();
}
const C = api.getCAL();
ok(C !== null, "quick calibration succeeds on a synthetic clench recording");
ok(C && S.emitted / 256 <= 20.5, "calibration takes about 20 s of signal");
ok(C && C.channels.length === 1 && C.channels[0] === "AF8", "a sensor without contact is skipped, the other is used");
ok(C && C.gains.AF8 > 0 && C.r2.AF8 > 0.8, "fitted gain is positive and the fit is good");

// ---- calibration refuses when there is no muscle response ----
api.setCal(null); S.emitted = 0; S.rawPos = 0; S.pct = [null, 100, 100, null]; api.TOASTS.length = 0;
api.startQuickCal();
n = 0;
while (api.getQC() && n < 2000) {
  for (let k = 0; k < 64; k++) {
    const t = (n * 64 + k) / 256, v = 6 * Math.sin(2 * Math.PI * 10 * t) + 3 * Math.sin(2 * Math.PI * 20 * t) + rnd() * 0.5;
    S.raw[1][S.rawPos] = v; S.raw[2][S.rawPos] = v; S.rawPos = (S.rawPos + 1) % 1024; S.emitted++;
  }
  n++;
  if (S.emitted >= 256 * 3 && (S.emitted - 512) % 64 === 0) api.corrStep();
}
ok(api.getCAL() === null && api.TOASTS.some(m => /Calibration failed/.test(m)), "no muscle response: calibration fails with a reason");

// ---- recording columns ----
api.setCal(CAL0); S.emitted = 1000; S.holdUntil = 0; S.gapAt = -1e9;
run(t => base(t) + sine(35, 0.4)(t));
const d = new Float32Array(14 + api.FOCUS_REC_COLNAMES.length), o = 0;
api.focusRecFill(d, o);
ok(api.FOCUS_REC_COLNAMES.length === 14 && !api.FOCUS_REC_COLNAMES.includes("focus_0_to_100"), "recording adds 14 new columns and does not reuse an existing name");
ok(api.focusRecFormat(17, d[17]) === "corrected_emg" && api.focusRecFormat(18, d[18]) === "1", "corrected status and valid flag are written");
ok(api.focusRecFormat(21, d[21]) === "corrected", "the displayed mode is written");
ok(api.focusRecFormat(26, d[26]) === "ok", "gate-only status is written");
run(t => base(t) + (t > 0.4 && t < 0.6 ? 150 : 0));
api.focusRecFill(d, o);
ok(api.focusRecFormat(14, d[14]) === "" && api.focusRecFormat(18, d[18]) === "0", "an invalid window leaves the score blank and marks valid = 0");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
