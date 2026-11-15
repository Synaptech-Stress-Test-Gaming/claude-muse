# Workflow: validate and tune focus / stress / buttons for one headset

## Objective

Record one guided session per device (Muse 2, Cyton + Daisy) and let `tools/autotune.py` check the engine against it and tune its settings for this person and this headset. The engine works without this (it never needs a calibration); the validation shows how well it works and adapts thresholds, focus weights and population priors. About 35 minutes per device, alone.

## Inputs

- The headset, charged; for the Cyton the helper (`Open Cyton Helper.bat`) and two gel ECG pads.
- A quiet room, sound on (the protocol beeps), Chrome or Edge.
- Python 3.10+ with `numpy` and `scipy` (`pip install -r tools/requirements.txt`).

## Tools

- `validation.html` → `muse-panel.html?validate=1&device=…` (the protocol overlay, `panel/validation.js`) and the v2 recorder (`panel/engine-rec.js`).
- `tools/autotune.py` (uses `tools/replay.js`, which runs the real engine).
- Optional check without hardware: `node tools/make_synth_recording.js --device cyton --fast 10 --out .tmp/synth/test` then `python tools/autotune.py --in .tmp/synth/test --quick --out-dir .tmp/at --report .tmp/at/report.md`.

## Steps

1. **Wear the headset.**
   - Muse 2: snug, forehead sensors on skin, ear sensors behind the ears; hair out of the way.
   - Cyton / Ultracortex: comb electrodes through the hair to the scalp (wiggle each until the contact grid shows it green); chest pads: one under the right collarbone, one on the lower left ribs, the two leads of channel 9 (F7 pins on the Daisy) clipped on, cables taped. No wrist leads.
2. **Cyton only:** double-click `Open Cyton Helper.bat`. Wait until it says `streaming`. If the panel later reports data dropping on WiFi, stop, plug in the USB dongle, start the helper with `--link dongle` and start again.
3. Open `validation.html` and click your device. In the panel check that the contact is good (Muse: sensors green; Cyton: grid mostly green, ECG bpm shown), then press **Start**.
4. Follow the screen for the 18 parts (about 32 minutes): rest with eyes open and closed, a 2-back letter task, serial subtraction, short deliberate artifacts at each beep (blinks, double blinks, jaw taps, a 3 s clench, frowns, reading aloud, chewing, head turns, nods, standing up, typing), 5 minutes of the browser race, and 5 minutes looking at a dot. If the signal drops the protocol pauses and restarts the interrupted part by itself.
5. At the end the 4 files (`…_eeg.csv`, `…_aux.csv`, `…_engine.csv`, `…_meta.json`) land in **Downloads** (allow multiple downloads if the browser asks).
6. Run `python tools/autotune.py` in the project folder (it takes the newest recording in Downloads; or pass `--in <path without _meta.json>`).
7. Read `docs/validation-report.md`.
8. Repeat for the other device. Each device keeps its own tuned values.

## Outputs

- `engine/tuned.json` and `engine/tuned.js` (loaded by the panel automatically when present).
- `docs/validation-report.md`: chosen values next to the defaults, and PASS/FAIL for each acceptance criterion.

## What PASS / FAIL means and what to do

| Criterion | PASS means | On FAIL |
|---|---|---|
| Artifact immunity | each deliberate artifact was detected and masked, and the scores moved < 5 points | re-seat the headset (part the hair under the combs, clean the Muse sensors) and repeat; if one artifact type keeps failing, accept that limit |
| Focus | n-back + arithmetic differ from rest by an effect size d ≥ 0.5 | within-person focus is weak (above all on the Muse); repeat rested, or accept the limit |
| Stress | heart rate rose in the arithmetic part (p < 0.05) and the score moved (d ≥ 0.5) | Cyton: check the ECG pads and the helper's ECG channel; Muse: tighten the band (pulse sensor) |
| Buttons (Cyton) | ≥ 90% of double blinks and jaw taps found; ≤ 1 false button per 5 min while talking, typing or racing | practise the gestures (firm, quick); if false buttons come from talking, accept or repeat |
| Drowsiness (Cyton) | no rise from eyes-closed alpha and a non-decreasing trend while staring at the dot | expected to FAIL on a first recording: drowsiness needs 10 min of profile history; repeat after a few sessions |

## Edge cases

- **No Downloads files:** the browser blocked multiple downloads; allow it in the address bar and rerun the protocol.
- **"No recording found" / exit code 2:** the tool prints one line saying what is missing; pass `--in` explicitly.
- **WiFi drops:** use the dongle (`--link dongle`) and apply the FTDI latency fix described in `tools/README.md`.
- **Mains alias warning (Cyton at 125 Hz):** theta is less trustworthy; prefer the WiFi Shield at a higher rate.
- **Undo the tuning:** delete `engine/tuned.json` and `engine/tuned.js`; the engine falls back to its defaults.
