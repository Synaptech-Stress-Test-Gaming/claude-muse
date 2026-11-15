/* tools/browser_smoke.js: optional headless Edge/Chrome smoke test + screenshots of the panel.
   For {muse, cyton} x {cosmic, clean, neon} x {new, legacy} x {1366x768, 1536x864}: a screenshot in .tmp/shots/<case>.png (?demo=1 data).
   Then per device a ?selftest=1 run with --dump-dom: the #engSelfTest JSON must show no errors, focus not "unavailable", values finite or null,
   and on the Cyton at least one double_blink and one clench_tap (the default simulator script has them).
   Then the validation protocol at &fast=1&autostart=1 on the simulated Cyton: all 18 blocks start and end, in order.
   Prints PASS/FAIL per case; exits 0 with "SKIPPED: no browser found" when there is no Edge/Chrome. Run: node tools/browser_smoke.js [--quick] */
"use strict";
const fs = require("fs"), path = require("path"), { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, ".."), OUT = path.join(ROOT, ".tmp", "shots");
function findBrowser() {
  // Chrome first: a headless msedge.exe hands over to an Edge that is already running and exits at once with no output
  const c = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  for (const p of c) if (fs.existsSync(p)) return p;
  for (const n of ["chrome", "google-chrome", "chromium", "msedge"]) { const r = spawnSync(process.platform === "win32" ? "where" : "which", [n], { encoding: "utf8" }); if (r.status === 0 && r.stdout.trim()) return r.stdout.trim().split(/\r?\n/)[0]; }
  return null;
}
const fileUrl = q => "file:///" + path.join(ROOT, "muse-panel.html").replace(/\\/g, "/") + "?" + q;
function run(browser, extra, url, budget) {
  const prof = path.join(ROOT, ".tmp", "smoke-profile");
  return spawnSync(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--user-data-dir=" + prof, "--allow-file-access-from-files", "--autoplay-policy=no-user-gesture-required", "--mute-audio",   // silent: the validation protocol beeps
    "--virtual-time-budget=" + (budget || 30000)].concat(extra, [url]), { encoding: "utf8", timeout: 240000, maxBuffer: 64 * 1024 * 1024 });
}
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }
function main() {
  const browser = findBrowser();
  if (!browser) { console.log("SKIPPED: no browser found"); return 0; }
  fs.mkdirSync(OUT, { recursive: true });
  const quick = process.argv.includes("--quick");
  const devs = ["muse", "cyton"], looks = quick ? ["cosmic"] : ["cosmic", "clean", "neon"], engs = ["new", "legacy"], sizes = quick ? [[1366, 768]] : [[1366, 768], [1536, 864]];
  for (const d of devs) for (const l of looks) for (const e of engs) for (const [w, h] of sizes) {
    const name = d + "_" + l + "_" + e + "_" + w + "x" + h, file = path.join(OUT, name + ".png");
    try { fs.unlinkSync(file); } catch (x) {}
    run(browser, ["--window-size=" + w + "," + h, "--screenshot=" + file], fileUrl("demo=1&device=" + d + "&look=" + l + "&engine=" + e), 12000);
    ok(fs.existsSync(file) && fs.statSync(file).size > 20000, "screenshot " + name);
  }
  for (const d of devs) {
    const r = run(browser, ["--window-size=1366,768", "--dump-dom"], fileUrl("demo=1&device=" + d + "&selftest=1&engine=new"), 32000);
    const m = /<pre id="engSelfTest"[^>]*>([^<]*)<\/pre>/.exec(r.stdout || ""); let j = null; try { j = JSON.parse(m[1].replace(/&quot;/g, '"')); } catch (x) {}
    ok(!!j, d + ": selftest JSON present after 20 s" + (j ? " (" + j.hops + " hops)" : ""));
    if (!j) continue;
    ok(j.errors.length === 0, d + ": no page errors" + (j.errors.length ? " (" + j.errors.slice(0, 3).join("; ") + ")" : ""));
    ok(j.focus && j.focus.state !== "unavailable" && j.focus.finite && j.stress.finite && (!j.drowsiness || j.drowsiness.finite), d + ": focus " + (j.focus && j.focus.state) + ", values finite or null");
    if (d === "cyton") ok(j.events.includes("double_blink") && j.events.includes("clench_tap"), "cyton: double_blink and clench_tap seen (" + j.events.join(",") + ")");
  }
  const v = run(browser, ["--window-size=1366,768", "--dump-dom"], fileUrl("demo=1&validate=1&fast=1&autostart=1&device=cyton"), 260000);   // the fast protocol lasts about 200 s plus connecting
  const vm = /<pre id="validationSelfTest"[^>]*>([^<]*)<\/pre>/.exec(v.stdout || ""); let vj = null; try { vj = JSON.parse(vm[1].replace(/&quot;/g, '"')); } catch (x) {}
  const order = require("../panel/validation.js").BLOCKS.map(b => b.id), want = [].concat(...order.map(id => [id + ":start", id + ":end"]));
  ok(vj && JSON.stringify(vj.blocks) === JSON.stringify(want), "validation protocol (fast): all 18 blocks have start and end markers in order" + (vj ? " (" + vj.blocks.length + " markers)" : " (no selftest JSON)"));
  console.log(fails ? fails + " FAILED" : "all passed (screenshots in .tmp/shots)");
  return fails ? 1 : 0;
}
process.exit(main());
