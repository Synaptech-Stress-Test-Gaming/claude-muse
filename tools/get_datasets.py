"""Optional public datasets for offline checks (nothing in the panel or the tests depends on them).

    python tools/get_datasets.py --dataset eegmat|eegdenoisenet|klados|cogbci|muse_mendeley|ultracortex_mi|all [--dest .tmp/datasets] [--yes-large]

Downloads the openly downloadable ones with urllib (resumes partial files, checks sizes, clear errors). SAM40, WESAD, STEW and TUAR need
registration or a manual download: for those it only prints where to get them. engine/datasets.test.js runs a check per dataset only when
.tmp/datasets/<name> exists. Never run as part of the tests.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
UA = {"User-Agent": "museengine-get-datasets/1.0"}
DATASETS = {
    "eegmat": {"what": "PhysioNet EEGMAT: EEG during mental arithmetic (rest vs serial subtraction), 36 people, EDF",
               "files": [("https://physionet.org/static/published-projects/eegmat/eeg-during-mental-arithmetic-tasks-1.0.0.zip", "eegmat.zip")]},
    "eegdenoisenet": {"what": "EEGdenoiseNet: clean EEG, EMG and EOG epochs (NumPy .npy)",
                      "files": [("https://github.com/ncclabsustech/EEGdenoiseNet/raw/master/data/%s_all_epochs.npy" % k, "%s_all_epochs.npy" % k) for k in ("EEG", "EMG", "EOG")]},
    "klados": {"what": "Klados semi-simulated EOG dataset (Mendeley wb6yvr725d v4)", "mendeley": ("wb6yvr725d", 4)},
    "cogbci": {"what": "COG-BCI (Zenodo record 7413650): mental workload; LARGE", "zenodo": "7413650", "large": True},
    "muse_mendeley": {"what": "Muse 2 focus/relax recordings (Mendeley g69dctrybk)", "mendeley": ("g69dctrybk", None)},
    "ultracortex_mi": {"what": "Ultracortex motor imagery with deliberate blinks (Mendeley rz2jhpvhp3 v2)", "mendeley": ("rz2jhpvhp3", 2)},
}
MANUAL = {
    "sam40": "SAM40 (stress, 40 people): figshare, https://doi.org/10.6084/m9.figshare.14562090 (download by hand).",
    "wesad": "WESAD (wearable stress): https://ubicomp.eti.uni-siegen.de/home/datasets/icmi18/ (accept the licence, download by hand).",
    "stew": "STEW (workload): IEEE DataPort, https://ieee-dataport.org/open-access/stew-simultaneous-task-eeg-workload-dataset (account needed).",
    "tuar": "TUAR (Temple artifact corpus): https://isip.piconepress.com/projects/nedc/html/tuh_eeg/ (registration needed).",
}


def fetch_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.loads(r.read().decode())


def download(url, dest, expect=None):
    """Download with resume (Range) and a size check."""
    have = os.path.getsize(dest) if os.path.exists(dest) else 0
    if expect and have == expect:
        print("  already here: " + os.path.basename(dest))
        return True
    req = urllib.request.Request(url, headers=dict(UA, **({"Range": "bytes=%d-" % have} if have else {})))
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            mode = "ab" if have and r.status == 206 else "wb"
            total = int(r.headers.get("Content-Length") or 0) + (have if mode == "ab" else 0)
            with open(dest, mode) as f:
                done = have if mode == "ab" else 0
                while True:
                    b = r.read(1 << 20)
                    if not b:
                        break
                    f.write(b)
                    done += len(b)
                    if total:
                        print("\r  %s: %.1f / %.1f MB" % (os.path.basename(dest), done / 1e6, total / 1e6), end="")
            print()
    except urllib.error.HTTPError as e:
        if e.code == 416:
            return True
        print("  could not download %s: HTTP %s" % (url, e.code))
        return False
    except Exception as e:
        print("  could not download %s: %s" % (url, e))
        return False
    size = os.path.getsize(dest)
    if expect and size != expect:
        print("  size check failed for %s (%d bytes, expected %d); run again to resume" % (dest, size, expect))
        return False
    return True


def get(name, dest, yes_large):
    d = DATASETS[name]
    out = os.path.join(dest, name)
    os.makedirs(out, exist_ok=True)
    print("%s: %s" % (name, d["what"]))
    files = list(d.get("files", []))
    try:
        if "zenodo" in d:
            rec = fetch_json("https://zenodo.org/api/records/%s" % d["zenodo"])
            fl = [(f["links"]["self"], f["key"], f.get("size")) for f in rec.get("files", [])]
            total = sum(x[2] or 0 for x in fl)
            if d.get("large") and not yes_large:
                print("  this dataset is %.1f GB; run again with --yes-large to download it" % (total / 1e9))
                return False
            files = fl
        if "mendeley" in d:
            ds, ver = d["mendeley"]
            url = "https://data.mendeley.com/public-api/datasets/%s/files?folder_id=root%s" % (ds, "&version=%d" % ver if ver else "")
            fl = fetch_json(url)
            files = [(f["content_details"]["download_url"], f["filename"], f["content_details"].get("size")) for f in fl if f.get("content_details")]
    except Exception as e:
        print("  could not list the files (%s); download by hand from the dataset page" % e)
        return False
    ok = True
    for item in files:
        url, fname = item[0], item[1]
        size = item[2] if len(item) > 2 else None
        ok = download(url, os.path.join(out, fname), size) and ok
    return ok


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dataset", required=True, choices=list(DATASETS) + list(MANUAL) + ["all"])
    ap.add_argument("--dest", default=os.path.join(ROOT, ".tmp", "datasets"))
    ap.add_argument("--yes-large", action="store_true")
    a = ap.parse_args(argv)
    names = list(DATASETS) if a.dataset == "all" else [a.dataset]
    if a.dataset == "all":
        for k, v in MANUAL.items():
            print("%s: manual download. %s" % (k, v))
    good = True
    for n in names:
        if n in MANUAL:
            print("%s: manual download. %s" % (n, MANUAL[n]))
            continue
        good = get(n, a.dest, a.yes_large) and good
    return 0 if good else 1


if __name__ == "__main__":
    sys.exit(main())
