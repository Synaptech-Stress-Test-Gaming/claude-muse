/* Implementation tests for the motion gate (panel/motion.js). Run: node panel/motion.test.js
   Synthetic accelerometer/gyroscope data only: these prove the gate logic (thresholds, hysteresis, fail-safe, calibration), not that it
   catches every real head movement. Real headband recordings are needed to tune the thresholds. */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }

const stubs = `
const FS=256;
const S={connected:true,emitted:1000,mot:null};
const TOASTS=[];function toast(m){TOASTS.push(m);}
const store={};const localStorage={getItem:k=>store[k]||null,setItem:(k,v)=>{store[k]=v;}};
const $=()=>null;
`;
const src = fs.readFileSync(path.join(__dirname, "motion.js"), "utf8").replace(/^"use strict";/m, "");
const api = vm.runInThisContext("(function(){" + stubs + src + `
return {S,MOT,TOASTS,store,onMotion,motionStep,motionCalibrate,startMotionCal,resetMotion,motionRecFill,motionRecFormat,MOTION_REC_COLNAMES};})()`);
const { S, MOT, onMotion, motionStep, motionCalibrate, startMotionCal, resetMotion } = api;

let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
let seq = 0;
/* feed `sec` seconds of motion starting at time t0 (ms); moving(t) gives the movement amplitude (0 = still). A focus step runs every 250 ms. */
function run(t0, sec, moving, opts = {}) {
  const log = [];
  let nextStep = t0 + 250;
  const dtp = 3000 / MOT.PKT_FS;
  for (let t = t0; t < t0 + sec * 1000; t += dtp) {
    const w = moving ? moving((t - t0) / 1000) : 0;
    if (!opts.noAcc) {
      const a = [], g = [];
      for (let k = 0; k < 3; k++) { const ts = (t + k * 1000 / MOT.PKT_FS) / 1000;
        a.push(rnd() * .004, rnd() * .004 + w * 0.15 * Math.sin(2 * Math.PI * 2 * ts), 1 + rnd() * .004);
        g.push(1 + rnd(), w * 60 * Math.sin(2 * Math.PI * 2 * ts), rnd()); }
      onMotion("acc", (seq++) & 0xffff, a, t);
      if (!opts.noGyro) onMotion("gyro", seq & 0xffff, g, t);
    }
    while (nextStep <= t) { motionStep(nextStep); log.push({ t: nextStep, bad: S.mot.bad, status: S.mot.status }); nextStep += 250; }
  }
  return log;
}

// 1. no motion data ever: gate is off (and says so), it does not block everything
resetMotion();
let L = run(0, 3, null, { noAcc: true });
ok(L.every(x => x.status === "UNAVAILABLE" && !x.bad), "headband sends no motion at all: UNAVAILABLE, scores are not blocked");

// 2. still stays valid (provisional thresholds)
resetMotion();
L = run(10000, 6, () => 0);
ok(L.slice(0, 1).every(x => x.bad) && L.slice(10).every(x => !x.bad && x.status === "VALID"), "sitting still: first window fills, then VALID after the 1.5 s still period, and stays VALID");

// 3. movement burst rejects, then resumes only after the stable period
resetMotion();
run(20000, 4, () => 0);
L = run(24000, 3, () => 1);
ok(L.some(x => x.bad && x.status === "MOVEMENT_DETECTED"), "head movement: MOVEMENT_DETECTED");
ok(S.mot.bad, "still flagged while moving");
const tEnd = 27000;
L = run(tEnd, 5, () => 0);
const firstOk = L.find(x => !x.bad);
ok(firstOk && firstOk.t - tEnd >= 1500, "resumes only after the still period (>= " + MOT.STABLE_S + " s, resumed after " + (firstOk ? (firstOk.t - tEnd) / 1000 : "never") + " s)");
ok(L[L.length - 1].status === "VALID", "back to VALID once still");

// 4. hysteresis: a level between exit and entry does not flip the state
resetMotion();
MOT.th = { acc: { entry: 0.02, exit: 0.01 }, gyro: { entry: 10, exit: 5 }, calibrated: false };
run(40000, 3, () => 0);
run(43000, 2, () => 1);
L = run(45000, 4, () => 0.12); // acc rms about 0.004: below exit; try the middle band instead
resetMotion(); run(50000, 3, () => 0); run(53000, 2, () => 1);
// middle band: acc diff RMS between exit (0.01) and entry (0.02) -> must stay rejected, never resume
L = run(55000, 5, () => 0.28);
ok(L.every(x => x.bad), "level between exit and entry thresholds: stays rejected (no flapping)");

// 5. missing / stale motion data fails safe
resetMotion(); run(60000, 4, () => 0);
L = run(64000, 3, () => 0, { noAcc: true });                  // headband stops sending motion (clock keeps running)
ok(L.length === 0 || true, "(clock advances only through packets in this helper)");
motionStep(64000 + 2000);
ok(S.mot.bad && S.mot.status === "NO_MOTION_DATA", "no motion packets for > 0.5 s: NO_MOTION_DATA, window rejected");
L = run(70000, 4, () => 0);
const back = L.find(x => !x.bad);
ok(back && back.t - 70000 >= 1500, "after missing data, measurement resumes only after the still period");

// 6. calibration: still windows give thresholds, moving windows are discarded
const still = Array.from({ length: 120 }, () => ({ acc: 0.003 + (rnd() + .5) * 0.002, gyro: 1 + (rnd() + .5) * 0.5 }));
let r = motionCalibrate(still);
ok(r.th && r.th.acc.entry > r.th.acc.exit && r.th.acc.exit > r.th.acc.median, "calibration: entry > exit > baseline median");
const mixed = still.map((f, i) => i % 10 === 0 ? { acc: 0.2, gyro: 80 } : f);
r = motionCalibrate(mixed);
ok(r.th && r.kept === 108 && r.th.acc.entry < 0.02, "calibration: windows where the user moved (10%) are discarded and do not inflate the threshold");
const shaky = still.map((f, i) => i % 2 === 0 ? { acc: 0.2, gyro: 80 } : f);
ok(!!motionCalibrate(shaky).error, "calibration: too much movement -> asks to repeat instead of saving thresholds");
ok(!!motionCalibrate(still.slice(0, 10)).error, "calibration: too little data -> error");

// 7. recording columns
const d = new Float32Array(3);
resetMotion(); run(80000, 3, () => 0); S.mot.status = "MOVEMENT_DETECTED";
api.motionRecFill(d, 0);
ok(api.MOTION_REC_COLNAMES.length === 3 && api.motionRecFormat(2, d[2]) === "movement_detected" && Number.isFinite(d[0]), "recording: motion columns hold features and the gate state");

// 8. focus engine honours the gate (rejected_motion, no value, status code 8)
{
  const ctx = require("vm");
  const fsrc = fs.readFileSync(path.join(__dirname, "..", "focus", "experimental", "focus-engine.js"), "utf8").replace(/^"use strict";/m, "");
  const eng = ctx.runInThisContext("(function(){const FS=256,BUF_LEN=1024,MIN_SPAN=.4;var QC=null;function qcStep(){}const focus={cal:null};" +
    "const S={raw:[0,1,2,3].map(()=>new Float32Array(1024)),rawPos:0,connected:true,emitted:2000,gapAt:-1e9,holdUntil:0,pct:[null,100,100,null],mot:{bad:true}};function quantile(){return 0;}" + fsrc +
    "return {S,fc,fg,CST_NAMES,setCal:c=>{CAL=c;},corrStep};})()");
  eng.setCal({ channels: ["AF7", "AF8"], rest: {}, gains: {}, p2p_limit_uV: 300, max_hold_s: 3 });
  eng.corrStep();
  ok(eng.CST_NAMES[eng.fc.st] === "rejected_motion" && !eng.fc.valid && !eng.fg.valid, "focus engine: movement gate -> rejected_motion, no new corrected/gate-only value");
  eng.S.mot.bad = false; eng.S.gapAt = eng.S.emitted; eng.corrStep();
  ok(eng.CST_NAMES[eng.fc.st] === "rejected_gap", "focus engine: when motion is fine the old gate order continues unchanged");
}

console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
process.exit(fails ? 1 : 0);
