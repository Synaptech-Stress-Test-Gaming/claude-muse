/* engine/priors.js equals engine/priors.json; every feature the engine uses has a prior for its device. Run: node engine/priors.test.js */
"use strict";
const fs = require("fs"), path = require("path");
const J = JSON.parse(fs.readFileSync(path.join(__dirname, "priors.json"), "utf8")), P = require("./priors.js");
let fails = 0;
function ok(c, msg) { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; }
ok(JSON.stringify(J) === JSON.stringify(P), "priors.js equals priors.json (rebuild with node tools/build_priors.js)");
ok(fs.readFileSync(path.join(__dirname, "priors.js"), "utf8") === require("../tools/build_priors.js").build(J), "priors.js is exactly what tools/build_priors.js writes");
let used = { cyton: ["thetaF", "alphaP", "betaLoC", "ratioD", "hr", "lnRmssd", "blinkDur", "blinkRate", "perclos", "spindleRate", "focusRaw", "stressRaw"], muse: ["thetaF", "alphaP", "betaLoC", "hr", "lnRmssd", "focusRaw", "stressRaw"] };
try { const M = require("./metrics.js"); if (M.FEATURES) used = M.FEATURES; } catch (e) {}
for (const dev of ["cyton", "muse"]) for (const f of used[dev]) ok(J[dev].features[f] && J[dev].features[f].sd > 0 && isFinite(J[dev].features[f].mu), dev + " has a prior for " + f);
for (const dev of ["cyton", "muse"]) ok(["blinkFloorUv", "blinkDerivFloor", "blinkAmpMed", "blinkAmpMad", "emgBaseFloorUv"].every(k => isFinite(J[dev].det[k])), dev + " detector priors present");
ok(J.tauC === 10 && J.T0 === 120, "tauC 10 s, T0 120 s");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
