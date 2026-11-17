/* Runs every old and new test, prints one line per test with PASS/FAIL and the time, exits 0 only if all pass.
   Run: node tools/run_all_tests.js   (add --verbose to print each test's output) */
"use strict";
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const ROOT = path.join(__dirname, "..");
const PY = process.platform === "win32" ? "python" : "python3";

const TESTS = [
  // existing tests
  ["node", "arousal.test.js"], ["node", "stress.test.js"], ["node", "panel/motion.test.js"], ["node", "game/bomb.test.js"],
  ["node", "game/mkds.test.js"], ["node", "focus/experimental/focus.test.js"], [PY, "game-py/test_mkds.py"],
  // new tests
  ["node", "engine/util.test.js"], ["node", "engine/frame.test.js"], ["node", "engine/fixtures.test.js"],
  ["node", "adapters/muse.test.js"], ["node", "adapters/cyton.test.js"], ["node", "adapters/cyton-serial.test.js"],
  ["node", "engine/preproc.test.js"], ["node", "engine/contact.test.js"], ["node", "engine/motion.test.js"],
  ["node", "engine/events.test.js"], ["node", "engine/mask.test.js"], ["node", "engine/features.test.js"],
  ["node", "engine/ecg.test.js"], ["node", "engine/ppg.test.js"], ["node", "engine/norm.test.js"], ["node", "engine/priors.test.js"],
  ["node", "engine/metrics.test.js"], ["node", "engine/buttons.test.js"], ["node", "engine/holdfade.test.js"],
  ["node", "engine/identity.test.js"], ["node", "engine/profiles.test.js"], ["node", "engine/clean.test.js"], ["node", "engine/legacy.test.js"],
  ["node", "engine/gamebody.test.js"], ["node", "engine/pipeline.test.js"], ["node", "engine/datasets.test.js"],
  ["node", "panel/validation.test.js"], ["node", "tools/replay.test.js"],
  [PY, "tools/test_cyton_helper.py"], [PY, "tools/test_autotune.py"], [PY, "game-py/test_link.py"]
];

const verbose = process.argv.includes("--verbose");
const only = process.argv.filter(a => !a.startsWith("--")).slice(2);
let fails = 0;
const rows = [];
for (const [cmd, file] of TESTS) {
  if (only.length && !only.some(o => file.includes(o))) continue;
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) { rows.push(["MISSING", file, 0]); fails++; continue; }
  const t0 = Date.now();
  const r = spawnSync(cmd, [file], { cwd: ROOT, encoding: "utf8", timeout: 900000, maxBuffer: 64 * 1024 * 1024 });
  const dt = (Date.now() - t0) / 1000;
  const ok = r.status === 0;
  if (!ok) fails++;
  rows.push([ok ? "PASS" : "FAIL", file, dt]);
  if (verbose || !ok) {
    const txt = ((r.stdout || "") + (r.stderr || "") + (r.error ? String(r.error) : "")).trim().split(/\r?\n/);
    const show = ok ? txt : txt.filter(l => !l.startsWith("PASS")).slice(-40);
    console.log("---- " + file + (ok ? "" : " (exit " + r.status + ")"));
    show.forEach(l => console.log("   " + l));
  }
}
console.log("\nRESULT  TIME(s)  TEST");
rows.forEach(([s, f, dt]) => console.log(s.padEnd(7) + " " + dt.toFixed(1).padStart(7) + "  " + f));
console.log("\n" + (fails ? fails + " of " + rows.length + " test files FAILED" : "all " + rows.length + " test files passed"));
process.exit(fails ? 1 : 0);
