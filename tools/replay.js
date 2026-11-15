/* tools/replay.js (skeleton; completed in step 11)
   node tools/replay.js --in <file or prefix> [--config cfg.json] [--out out.json] [--device muse|cyton] [--profile none|fresh] [--quiet] */
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
function args(argv) { const a = {}; for (let i = 0; i < argv.length; i++) { const k = argv[i]; if (k.startsWith("--")) { const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true; a[k.slice(2)] = v; } } return a; }
function findOldCsvs() {
  const dirs = [path.join(__dirname, "..", ".tmp"), path.join(process.env.USERPROFILE || os.homedir(), "Downloads")], out = [];
  for (const d of dirs) { let names = []; try { names = fs.readdirSync(d); } catch (e) { continue; }
    for (const n of names) if (n.toLowerCase().endsWith(".csv")) { try { const fd = fs.openSync(path.join(d, n), "r"), b = Buffer.alloc(64); fs.readSync(fd, b, 0, 64, 0); fs.closeSync(fd); if (b.toString("utf8").replace(/^﻿/, "").startsWith("time_s,TP9_uV")) out.push(path.join(d, n)); } catch (e) {} } }
  return out.slice(0, 3);
}
if (require.main === module) {
  const a = args(process.argv.slice(2));
  if (!a.in) { const f = findOldCsvs(); if (!f.length) { console.log("no recordings found (optional)"); process.exit(0); } console.log("found " + f.length + " recordings (replay not implemented yet)"); process.exit(0); }
  console.log("replay not implemented yet"); process.exit(0);
}
module.exports = { args, findOldCsvs };
