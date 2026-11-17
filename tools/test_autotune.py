"""Test of tools/autotune.py on a fast synthetic Cyton recording. Plain Python. Run: python tools/test_autotune.py
Writes only under .tmp/ (the repo's engine/tuned.json must come from Julian's real recording)."""
import json
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TMP = os.path.join(ROOT, ".tmp", "autotune_test")
fails = 0


def ok(c, msg):
    global fails
    print(("PASS " if c else "FAIL ") + msg)
    if not c:
        fails += 1


os.makedirs(TMP, exist_ok=True)
prefix = os.path.join(TMP, "Cyton_synth_fast10")
r = subprocess.run(["node", os.path.join(ROOT, "tools", "make_synth_recording.js"), "--device", "cyton", "--fast", "10", "--seed", "3", "--out", prefix], capture_output=True, text=True, cwd=ROOT)
ok(r.returncode == 0 and os.path.exists(prefix + "_meta.json"), "synthetic fast recording written (" + r.stdout.strip()[-90:] + ")")
rep = os.path.join(TMP, "report.md")
r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "autotune.py"), "--in", prefix, "--quick", "--out-dir", TMP, "--report", rep], capture_output=True, text=True, cwd=ROOT)
print(r.stdout.strip())
ok(r.returncode == 0, "autotune exit code 0")
tj = json.load(open(os.path.join(TMP, "tuned.json")))
ok("config" in tj and "priors" in tj and "cyton" in tj["config"] and "cyton" in tj["priors"], "tuned.json parses and has config and priors")
fw = tj["config"]["cyton"].get("focus", {})
ok(all(0 <= fw.get(k, 1) <= 2 for k in ("wTheta", "wAlpha", "wBeta")) and any(fw.get(k, 1) > 0 for k in ("wTheta", "wAlpha", "wBeta")), "every tuned weight within 0-2, not all zero (%s)" % fw)
js = os.path.join(TMP, "tuned.js").replace("\\", "/")
n = subprocess.run(["node", "-e", "const T=require('%s');if(!globalThis.MuseEngine||!globalThis.MuseEngine.TUNED||!T.config)process.exit(1);console.log('ok')" % js], capture_output=True, text=True)
ok(n.returncode == 0, "tuned.js is valid JS that sets MuseEngine.TUNED")
text = open(rep, encoding="utf-8").read()
names = ["Artifact immunity", "Focus", "Stress", "Buttons", "Drowsiness"]
ok(all(("| %s | PASS" % c in text) or ("| %s | FAIL" % c in text) for c in names), "the report lists every criterion with PASS or FAIL")
for c in ("Focus", "Stress", "Buttons"):
    ok("| %s | PASS" % c in text, "on the synthetic recording the %s criterion passes" % c)
ok(not os.path.exists(os.path.join(ROOT, "engine", "tuned.json")), "the repo's engine/tuned.json was not created")
r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "autotune.py"), "--in", os.path.join(TMP, "does_not_exist")], capture_output=True, text=True)
ok(r.returncode == 2 and len(r.stdout.strip().splitlines()) == 1, "bad input: one clear line and exit code 2 (%s)" % r.stdout.strip())
print("all passed" if not fails else "%d FAILED" % fails)
sys.exit(1 if fails else 0)
