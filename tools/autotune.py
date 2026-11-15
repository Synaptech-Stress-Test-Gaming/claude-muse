"""Auto-tune: analyse a validation recording and tune the engine's settings for this person and device.

    python tools/autotune.py --in <recording prefix> [--device auto] [--quick] [--out-dir engine] [--report docs/validation-report.md]

With no --in it picks the newest *_meta.json in Downloads or .tmp/. It never asks anything; on bad input it prints one clear line and exits 2.
The engine is JavaScript, so every candidate setting is evaluated by running `node tools/replay.js --config <candidate>` (one source of truth for
the maths) and analysing the outputs against the recording's markers with NumPy. At most 80 replay runs (--quick: 12).
Steps: 1 priors from the rest blocks; 2 detector thresholds (coordinate search); 3 ASR and NLMS; 4 focus weights; 5 write tuned.json and tuned.js
(values for the other device are kept); 6 write the validation report with PASS/FAIL for every acceptance criterion. A FAIL does not stop the script.
Undo: delete engine/tuned.json and engine/tuned.js. NumPy/SciPy only (meegkit is not needed).
"""
import argparse
import datetime
import glob
import json
import math
import os
import subprocess
import sys

import numpy as np
from scipy import stats

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEFAULT_FOCUS = {"wTheta": 1.0, "wAlpha": 1.0, "wBeta": 0.5}
ARTIFACT_BLOCKS = ["art_blink", "art_dblink", "art_clench", "art_clench_long", "art_frown", "art_talk", "art_chew", "art_turn", "art_nod", "art_stand", "art_type"]
FP_BLOCKS = ["art_talk", "art_type", "game"]


def die(msg):
    print(msg)
    sys.exit(2)


def find_input():
    cands = glob.glob(os.path.join(os.path.expanduser("~"), "Downloads", "*_meta.json")) + glob.glob(os.path.join(ROOT, ".tmp", "**", "*_meta.json"), recursive=True)
    cands = [c for c in cands if "autotune" not in c]
    return max(cands, key=os.path.getmtime)[: -len("_meta.json")] if cands else None


class Runner:
    def __init__(self, prefix, work, max_runs):
        self.prefix, self.work, self.max_runs, self.n, self.cache = prefix, work, max_runs, 0, {}

    def run(self, cfg):
        key = json.dumps(cfg, sort_keys=True)
        if key in self.cache:
            return self.cache[key]
        if self.n >= self.max_runs:
            return None
        self.n += 1
        cpath, opath = os.path.join(self.work, "cfg_%d.json" % self.n), os.path.join(self.work, "run_%d.json" % self.n)
        with open(cpath, "w") as f:
            json.dump(cfg, f)
        r = subprocess.run(["node", os.path.join(ROOT, "tools", "replay.js"), "--in", self.prefix, "--config", cpath, "--out", opath, "--quiet"], capture_output=True, text=True)
        if r.returncode != 0 or not os.path.exists(opath):
            print("replay failed: " + (r.stdout + r.stderr).strip()[-300:])
            self.cache[key] = None
            return None
        with open(opath) as f:
            out = json.load(f)
        self.cache[key] = out
        return out


def deep_merge(a, b):
    out = dict(a)
    for k, v in (b or {}).items():
        out[k] = deep_merge(out.get(k, {}), v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


class Recording:
    def __init__(self, meta):
        self.meta = meta
        self.fast = float(meta.get("fast") or 1)
        self.blocks, self.cues = {}, {}
        for m in meta.get("markers", []):
            b = m["block"]
            if m["kind"] == "start":
                self.blocks.setdefault(b, [None, None])[0] = m["t"]
            elif m["kind"] == "end" and m.get("n") != -1:
                self.blocks.setdefault(b, [None, None])[1] = m["t"]
            elif m["kind"] == "cue" and "release" not in m["label"] and not m["label"].startswith(("nback", "arith")):
                self.cues.setdefault(b, []).append(m["t"])
        self.blocks = {k: v for k, v in self.blocks.items() if v[0] is not None and v[1] is not None}


def series(run, key, idx=0):
    t = np.array([h["t"] for h in run["hops"]])
    v = np.array([np.nan if h.get(key) is None or h[key][idx] is None else h[key][idx] for h in run["hops"]], float)
    st = [h[key][1] if h.get(key) else None for h in run["hops"]]
    return t, v, st


def in_block(t, rec, b, pad0=0.0):
    if b not in rec.blocks:
        return np.zeros(len(t), bool)
    a, z = rec.blocks[b]
    return (t >= a + pad0) & (t < z)


def thin(t, v, mask, step):
    out, last = [], -1e9
    for ti, vi, m in zip(t, v, mask):
        if m and not np.isnan(vi) and ti - last >= step:
            out.append(vi)
            last = ti
    return np.array(out)


def cohen_d(a, b):
    if len(a) < 2 or len(b) < 2:
        return float("nan")
    sp = math.sqrt(((len(a) - 1) * np.var(a, ddof=1) + (len(b) - 1) * np.var(b, ddof=1)) / (len(a) + len(b) - 2))
    return float((np.mean(a) - np.mean(b)) / sp) if sp > 0 else float("inf") * np.sign(np.mean(a) - np.mean(b))


def evaluate(run, rec):
    """All acceptance measurements for one replay output."""
    R = {}
    step = 10.0 / rec.fast
    t, fv, fst = series(run, "f")
    _, sv, sst = series(run, "s")
    hr = np.array([np.nan if h.get("hr") is None else h["hr"] for h in run["hops"]], float)
    btn = run.get("buttons", [])
    evs = run.get("events", [])
    # buttons: a hit = an event whose gesture starts within 1.5 s after the cue
    def tpr(block, typ):
        cues = rec.cues.get(block, [])
        if not cues:
            return float("nan")
        hits = sum(1 for c in cues if any(b["type"] == typ and c <= (b.get("onset") if b.get("onset") is not None else b["t"]) <= c + 1.5 for b in btn))
        return hits / len(cues)
    R["tpr_dblink"], R["tpr_clench"] = tpr("art_dblink", "double_blink"), tpr("art_clench", "clench_tap")
    fp = {}
    for b in FP_BLOCKS:
        if b in rec.blocks:
            a, z = rec.blocks[b]
            n = sum(1 for x in btn if a <= x["t"] < z)
            fp[b] = n / ((z - a) / 300.0)
    R["fp_per5min"] = fp
    cues = rec.cues.get("art_blink", [])
    R["blink_rate"] = sum(1 for c in cues if any(e["type"] in ("blink", "blink_voluntary") and c <= e["onset"] <= c + 1.5 for e in evs)) / len(cues) if cues else float("nan")
    # artifact immunity: masked/held share of the artifact time, and the median absolute change against the time just before
    imm = {}
    for b in ARTIFACT_BLOCKS:
        if b not in rec.blocks:
            continue
        a, z = rec.blocks[b]
        cl = rec.cues.get(b)
        wins = [(c + 1.0, c + 2.5, c - 2.0) for c in cl] if cl else [(a + 1.0, z, a - 5.0)]
        # "masked": the artifact was detected and its samples excluded. Trial blocks: share of cues with an artifact event starting
        # within 2 s; continuous blocks: share of the block covered by artifact events and their mask margins.
        art = [e for e in evs if e["type"] in ("blink", "blink_voluntary", "saccade", "emg_burst", "motion", "electrode_pop", "gap")]
        if cl:
            masked = [any(c <= e["onset"] <= c + 2.0 for e in art) for c in cl]
        else:
            grid_t = np.arange(a + 1.0, z, 0.05)
            cov = np.zeros(len(grid_t), bool)
            for e in art:
                cov |= (grid_t >= e["onset"] - 0.1) & (grid_t <= (e["offset"] if e.get("offset") is not None else e["onset"]) + (1.0 if e.get("sub") in ("talk", "chew") else 0.5))
            masked = list(cov)
        chf, chs = [], []
        for w0, w1, pre in wins:
            m = (t >= w0) & (t < w1)
            if not m.any():
                continue
            base_m = (t >= pre) & (t < (w0 - 1.0 if cl else a))
            for v, ch, sts in ((fv, chf, None), (sv, chs, None)):
                bv = v[base_m & ~np.isnan(v)]
                if len(bv):
                    ch += list(np.abs(v[m & ~np.isnan(v)] - bv.mean()))
        imm[b] = {"masked": float(np.mean(masked)) if masked else float("nan"), "focus_change": float(np.median(chf)) if chf else 0.0, "stress_change": float(np.median(chs)) if chs else 0.0}
    R["immunity"] = imm
    R["immunity_score"] = float(np.mean([v["focus_change"] for v in imm.values()])) if imm else float("nan")
    # focus effect size: (nback + arith) vs rest_open
    task = in_block(t, rec, "nback", 1.0 / rec.fast * 5) | in_block(t, rec, "arith", 1.0 / rec.fast * 5)
    rest = in_block(t, rec, "rest_open", 2.0)
    a, b = thin(t, fv, task, step), thin(t, fv, rest, step)
    R["focus_d"] = cohen_d(a, b)
    # stress: arith vs rest (rest_open + rest2)
    ar = in_block(t, rec, "arith", 2.0)
    rs = in_block(t, rec, "rest_open", 2.0) | in_block(t, rec, "rest2", 2.0)
    ha, hb = thin(t, hr, ar, step / 2), thin(t, hr, rs, step / 2)
    R["hr_rise"] = float(np.mean(ha) - np.mean(hb)) if len(ha) and len(hb) else float("nan")
    R["hr_p"] = float(stats.ttest_ind(ha, hb, equal_var=False, alternative="greater").pvalue) if len(ha) > 1 and len(hb) > 1 else float("nan")
    R["stress_d"] = cohen_d(thin(t, sv, ar, step), thin(t, sv, rs, step))
    # drowsiness
    if run["meta"]["device"] == "cyton":
        _, dv, _ = series(run, "d")
        fx = in_block(t, rec, "fixation")
        if fx.any() and np.isfinite(dv[fx]).sum() >= 3:
            a0 = rec.blocks["fixation"][0]
            mins = {}
            for ti, vi in zip(t[fx], dv[fx]):
                if np.isfinite(vi):
                    mins.setdefault(int((ti - a0) // (60.0 / rec.fast)), []).append(vi)
            mm = [np.mean(mins[k]) for k in sorted(mins)]
            R["drowsy_rho"] = float(stats.spearmanr(range(len(mm)), mm)[0]) if len(mm) > 2 else float("nan")
        else:
            R["drowsy_rho"] = float("nan")
        rc, ro = dv[in_block(t, rec, "rest_closed")], dv[in_block(t, rec, "rest_open")]
        R["drowsy_closed_vs_open"] = float(np.nanmean(rc) - np.nanmean(ro)) if np.isfinite(rc).any() and np.isfinite(ro).any() else float("nan")
    # valid-time fraction per block and metric
    R["valid"] = {}
    for b in rec.blocks:
        m = in_block(t, rec, b)
        if m.any():
            R["valid"][b] = {"focus": float(np.isfinite(fv[m]).mean()), "stress": float(np.isfinite(sv[m]).mean())}
    R["profile_conf"] = float(np.nanmean([h["pc"] if h.get("pc") is not None else np.nan for h in run["hops"]])) if run["hops"] else float("nan")
    return R


def detector_objective(R):
    tp = np.nanmean([R["tpr_dblink"], R["tpr_clench"]])
    fp = np.mean(list(R["fp_per5min"].values())) if R["fp_per5min"] else 0.0
    br = R["blink_rate"] if np.isfinite(R["blink_rate"]) else 0.0
    return float((tp if np.isfinite(tp) else 0) - 10 * fp + br)


def immunity_pass(R):
    # typing moves no head muscle: only its score change is checked
    return all(v["focus_change"] < 5 and v["stress_change"] < 5 and (b == "art_type" or not np.isfinite(v["masked"]) or v["masked"] >= 0.8) for b, v in R["immunity"].items())


def collect_priors(run, rec, device):
    t = np.array([h["t"] for h in run["hops"]])
    m = in_block(t, rec, "rest_open", 2.0) | in_block(t, rec, "rest2", 2.0)
    feats = ["thetaF", "alphaP", "betaLoC", "hr", "lnRmssd"] + (["ratioD"] if device == "cyton" else [])
    floors = {"hr": 5.0, "lnRmssd": 0.25}
    out = {}
    for f in feats:
        v = np.array([h["raw"][f] for h, mm in zip(run["hops"], m) if mm and h.get("raw") and h["raw"].get(f) is not None], float)
        if len(v) >= 8:
            out[f] = {"mu": round(float(np.mean(v)), 4), "sd": round(max(float(np.std(v, ddof=1)), floors.get(f, 0.3)), 4)}
    return out


def fmt(x, d=2):
    return "n/a" if x is None or (isinstance(x, float) and not np.isfinite(x)) else ("%." + str(d) + "f") % x


def main(argv=None):
    ap = argparse.ArgumentParser(description="Analyse a validation recording and tune the engine (writes engine/tuned.json, engine/tuned.js, docs/validation-report.md)")
    ap.add_argument("--in", dest="inp")
    ap.add_argument("--device", default="auto")
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--out-dir", default=os.path.join(ROOT, "engine"))
    ap.add_argument("--report", default=os.path.join(ROOT, "docs", "validation-report.md"))
    a = ap.parse_args(argv)
    prefix = a.inp or find_input()
    if not prefix:
        die("No recording found: pass --in <recording prefix> (the part before _meta.json), or put the 4 files in Downloads.")
    prefix = prefix[: -len("_meta.json")] if prefix.endswith("_meta.json") else prefix
    for suf in ("_meta.json", "_eeg.csv"):
        if not os.path.exists(prefix + suf):
            die("Missing file: " + prefix + suf + " (a validation recording has _eeg.csv, _aux.csv, _engine.csv and _meta.json).")
    try:
        with open(prefix + "_meta.json", encoding="utf-8-sig") as f:
            meta = json.load(f)
    except Exception as e:
        die("Could not read " + prefix + "_meta.json: " + str(e))
    device = meta.get("device") if a.device == "auto" else a.device
    if device not in ("muse", "cyton"):
        die("Unknown device in the recording: " + str(device))
    rec = Recording(meta)
    if len(rec.blocks) < 5:
        die("The recording has no validation markers (was it made with validation.html?).")
    work = os.path.join(ROOT, ".tmp", "autotune")
    os.makedirs(work, exist_ok=True)
    runner = Runner(prefix, work, 12 if a.quick else 80)

    base_cfg = {}
    base = runner.run(base_cfg)
    if base is None:
        die("The engine replay failed on this recording.")
    R0 = evaluate(base, rec)
    # 1 priors
    priors = collect_priors(base, rec, device)
    # 2 detector thresholds (coordinate search)
    grid = [("events.emgRatioIn", [2.5, 3.0, 3.5, 4.0]), ("events.blinkK", [3, 4, 5]),
            ("events.%s.blinkFloorUv" % device, [round(f * (60 if device == "cyton" else 40), 1) for f in (0.7, 1.0, 1.3)]),
            ("events.volFactor", [1.3, 1.5, 1.8]), ("buttons.thirdMs", [400, 500, 600])]
    if a.quick:
        grid = [("events.emgRatioIn", [2.5, 3.5]), ("events.blinkK", [3, 5])]
    def setp(cfg, dotted, v):
        cfg = json.loads(json.dumps(cfg))
        d = cfg
        ks = dotted.split(".")
        for k in ks[:-1]:
            d = d.setdefault(k, {})
        d[ks[-1]] = v
        return cfg
    best_cfg, best_obj = {}, detector_objective(R0)
    for dotted, vals in grid:
        for v in vals:
            c = setp(best_cfg, dotted, v)
            r = runner.run(c)
            if r is None:
                continue
            o = detector_objective(evaluate(r, rec))
            if o > best_obj + 1e-9:
                best_obj, best_cfg = o, c
    # 3 ASR and NLMS
    det_run = runner.run(best_cfg)
    imm0 = evaluate(det_run, rec)["immunity_score"] if det_run else R0["immunity_score"]
    asr_opts = [("off", setp(best_cfg, "flags.asr", False))] + ([(str(k), setp(setp(best_cfg, "flags.asr", True), "asr.k", k)) for k in (10, 20, 30)] if device == "cyton" else [("on", setp(best_cfg, "flags.asr", True))])
    if a.quick:
        asr_opts = asr_opts[:2]
    asr_scores = {}
    for name, c in asr_opts:
        r = runner.run(c)
        if r is not None:
            asr_scores[name] = evaluate(r, rec)["immunity_score"]
    default_asr = "20" if device == "cyton" else "off"
    chosen_asr = default_asr
    if asr_scores:
        best_name = min(asr_scores, key=lambda k: asr_scores[k] if np.isfinite(asr_scores[k]) else 1e9)
        ref = asr_scores.get(default_asr, imm0)
        if device == "muse" and best_name == "on" and not (asr_scores["on"] <= 0.9 * ref):
            best_name = "off"
        chosen_asr = best_name
    cfg = dict(best_cfg)
    if chosen_asr == "off":
        cfg = setp(cfg, "flags.asr", False)
    else:
        cfg = setp(cfg, "flags.asr", True)
        if chosen_asr not in ("on",):
            cfg = setp(cfg, "asr.k", int(chosen_asr))
    nl = runner.run(setp(cfg, "flags.nlms", True))
    nl_score = evaluate(nl, rec)["immunity_score"] if nl else float("nan")
    cur = runner.run(cfg)
    cur_score = evaluate(cur, rec)["immunity_score"] if cur else imm0
    nlms_on = bool(np.isfinite(nl_score) and np.isfinite(cur_score) and nl_score <= 0.9 * cur_score)
    cfg = setp(cfg, "flags.nlms", nlms_on)
    # 4 focus weights (coordinate search; never all zero; artifact immunity must still pass)
    w = dict(DEFAULT_FOCUS)
    cur = runner.run(setp(cfg, "focus", w))
    best_d = evaluate(cur, rec)["focus_d"] if cur else float("nan")
    for key in (["wTheta", "wAlpha", "wBeta"] if not a.quick else ["wBeta"]):
        for v in ([0, 0.5, 1, 1.5, 2] if not a.quick else [0, 1]):
            cand = dict(w, **{key: v})
            if all(x == 0 for x in cand.values()):
                continue
            r = runner.run(setp(cfg, "focus", cand))
            if r is None:
                continue
            Rc = evaluate(r, rec)
            if np.isfinite(Rc["focus_d"]) and (not np.isfinite(best_d) or Rc["focus_d"] > best_d + 1e-9) and immunity_pass(Rc):
                best_d, w = Rc["focus_d"], cand
    cfg = setp(cfg, "focus", w)
    final_run = runner.run(cfg) or base
    RF = evaluate(final_run, rec)
    # 5 write tuned.json / tuned.js (the other device's values are kept)
    os.makedirs(a.out_dir, exist_ok=True)
    tj = os.path.join(a.out_dir, "tuned.json")
    old = {}
    if os.path.exists(tj):
        try:
            with open(tj) as f:
                old = json.load(f)
        except Exception:
            old = {}
    tuned = {"version": 1, "device": device, "created": datetime.datetime.now().isoformat(timespec="seconds"), "source": os.path.basename(prefix),
             "config": dict(old.get("config") or {}), "priors": dict(old.get("priors") or {})}
    tuned["config"][device] = cfg
    tuned["priors"][device] = {"features": priors}
    with open(tj, "w") as f:
        json.dump(tuned, f, indent=1)
    with open(os.path.join(a.out_dir, "tuned.js"), "w") as f:
        f.write("/* engine/tuned.js: GENERATED by tools/autotune.py from " + os.path.basename(prefix) + ". Delete this file and tuned.json to undo. */\n\"use strict\";\n(function (root) {\n"
                "  const E = root.MuseEngine = root.MuseEngine || {};\n  E.TUNED = " + json.dumps(tuned) + ";\n  if (typeof module !== \"undefined\" && module.exports) module.exports = E.TUNED;\n})(typeof window !== \"undefined\" ? window : globalThis);\n")
    # 6 the report
    rows = []
    def crit(name, ok, detail, meaning):
        rows.append((name, "PASS" if ok else "FAIL", detail, "" if ok else meaning))
    imm = RF["immunity"]
    imm_ok = immunity_pass(RF)
    worst = max(imm.items(), key=lambda kv: kv[1]["focus_change"]) if imm else ("-", {"focus_change": 0})
    crit("Artifact immunity", imm_ok, "worst block %s: focus change %s, masked %s" % (worst[0], fmt(worst[1]["focus_change"], 1), fmt(worst[1].get("masked"), 2)),
         "An artifact moved a score or was not held. Re-seat the headset (dry combs: part the hair) and repeat; if it stays, the masking margins need tuning.")
    crit("Focus", np.isfinite(RF["focus_d"]) and RF["focus_d"] >= 0.5, "Cohen's d (n-back + arithmetic vs rest) = %s" % fmt(RF["focus_d"]),
         "The focus score did not separate the tasks from rest. Within-person focus is weak, above all on the Muse; accept the limit or repeat rested.")
    crit("Stress", np.isfinite(RF["hr_p"]) and RF["hr_p"] < 0.05 and RF["hr_rise"] > 0 and np.isfinite(RF["stress_d"]) and RF["stress_d"] >= 0.5,
         "heart-rate rise %s bpm (p %s), d %s" % (fmt(RF["hr_rise"], 1), fmt(RF["hr_p"], 3), fmt(RF["stress_d"])),
         "The arithmetic task did not raise heart rate and stress clearly. Check the ECG pads (Cyton) or the pulse contact (Muse).")
    tp_ok = all(np.isfinite(RF[k]) and RF[k] >= 0.9 for k in ("tpr_dblink", "tpr_clench")) if device == "cyton" else True
    fp_ok = all(v <= 1 for v in RF["fp_per5min"].values()) if device == "cyton" else True
    crit("Buttons", tp_ok and fp_ok, ("double blink %s, clench %s, false per 5 min %s" % (fmt(RF["tpr_dblink"]), fmt(RF["tpr_clench"]), ", ".join("%s %s" % (k, fmt(v, 1)) for k, v in RF["fp_per5min"].items()))) if device == "cyton" else "Muse: no buttons",
         "Buttons were missed or fired by accident. Practise the gestures (a firm double blink, a short jaw tap) or accept the limit.")
    if device == "cyton":
        dr_ok = np.isfinite(RF.get("drowsy_rho", float("nan"))) and RF["drowsy_rho"] >= 0 and np.isfinite(RF.get("drowsy_closed_vs_open", float("nan"))) and RF["drowsy_closed_vs_open"] <= 5
        crit("Drowsiness", dr_ok, "fixation trend rho %s; rest_closed - rest_open %s" % (fmt(RF.get("drowsy_rho")), fmt(RF.get("drowsy_closed_vs_open"), 1)),
             "Not measurable or not rising: drowsiness needs 10 min of profile history first (a first recording has none), or eyes-closed alpha leaked in.")
    L = ["# Validation report", "", "Recording: `%s` (%s, %s Hz, %d markers%s). Created %s by tools/autotune.py; %d engine replays." % (os.path.basename(prefix), device, meta.get("fs"), len(meta.get("markers", [])),
         ", synthetic" if meta.get("synthetic") else "", tuned["created"], runner.n), "",
         "These are within-person relative scores, not validated measures. STRESS measures arousal. Held moments are not measured.", "",
         "## Acceptance criteria", "", "| Criterion | Result | Measured | What a FAIL means |", "|---|---|---|---|"]
    for r in rows:
        L.append("| %s | %s | %s | %s |" % r)
    L += ["", "## Chosen values", "", "| Setting | Default | Chosen |", "|---|---|---|"]
    chosen_flat = {}
    def flat(d, p=""):
        for k, v in d.items():
            if isinstance(v, dict):
                flat(v, p + k + ".")
            else:
                chosen_flat[p + k] = v
    flat(cfg)
    defaults = {"events.emgRatioIn": 3.0, "events.blinkK": 4, "events.volFactor": 1.5, "buttons.thirdMs": 400, "flags.asr": device == "cyton", "asr.k": 20, "flags.nlms": False,
                "focus.wTheta": 1, "focus.wAlpha": 1, "focus.wBeta": 0.5, "events.cyton.blinkFloorUv": 60, "events.muse.blinkFloorUv": 40}
    for k, v in sorted(chosen_flat.items()):
        L.append("| %s | %s | %s |" % (k, defaults.get(k, "-"), v))
    L += ["", "Priors from rest_open and rest2: " + ", ".join("%s %s +/- %s" % (k, v["mu"], v["sd"]) for k, v in priors.items()), "",
          "## Artifact blocks", "", "| Block | masked/held | focus change | stress change |", "|---|---|---|---|"]
    for b, v in imm.items():
        L.append("| %s | %s | %s | %s |" % (b, fmt(v["masked"]), fmt(v["focus_change"], 1), fmt(v["stress_change"], 1)))
    L += ["", "## Valid-time fraction per block", "", "| Block | focus | stress |", "|---|---|---|"]
    for b, v in RF["valid"].items():
        L.append("| %s | %s | %s |" % (b, fmt(v["focus"]), fmt(v["stress"])))
    sc = meta.get("selfcheck") or {}
    L += ["", "## Other checks", "", "- Identity sanity: mean profile confidence during the recording %s." % fmt(RF["profile_conf"]),
          "- Measured rate / loss: %s Hz, %s%% lost." % (((sc.get("rate") or {}).get("measured")) or meta.get("fs"), ((sc.get("rate") or {}).get("lossPct")) if sc else "n/a"),
          "- Mains alias warning (125 Hz): %s." % ("yes" if (sc.get("alias") or {}).get("warn") else "no"), "",
          "Undo: delete `engine/tuned.json` and `engine/tuned.js`."]
    os.makedirs(os.path.dirname(os.path.abspath(a.report)), exist_ok=True)
    with open(a.report, "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")
    print("autotune: %d replays; wrote %s, %s and %s" % (runner.n, tj, os.path.join(a.out_dir, "tuned.js"), a.report))
    for r in rows:
        print("  %-18s %s  %s" % (r[0], r[1], r[2]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
