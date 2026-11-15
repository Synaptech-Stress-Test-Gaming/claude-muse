# claude-muse: Muse 2 / OpenBCI Cyton Control Panel

A single-page control panel for two EEG headsets: the **Muse 2** headband (Bluetooth, straight from the browser) and the **OpenBCI Cyton + Daisy** (16 channels, Ultracortex Mark IV, through a small local Python helper). It shows the live signals, turns them into **FOCUS**, **STRESS** and (Cyton) **DROWSY** scores plus two hands-free **buttons** (double blink, jaw-clench tap), and sends them to games on the same computer. No accounts; nothing leaves your computer.

Two engines run side by side and a switch picks which one is shown:

- **NEW** (default): the artifact-robust engine in `engine/`. It detects blinks, eye movements, jaw and forehead muscle, talking, chewing, head movement, electrode pops and data gaps, masks them, holds the last clean value for up to 3 seconds and then shows `--` with the reason. It needs **no calibration of any kind**: it keeps learning your usual level from clean data across sessions, and it recognises who is wearing the headset.
- **LEGACY**: the original formulas, unchanged (focus = `ln(beta/alpha)` with your 10 second baselines; stress = 100 minus focus).

Other READMEs: [focus/README.md](focus/README.md) (the display switch), [panel/README.md](panel/README.md) (panel code), [tools/README.md](tools/README.md) (Cyton helper, replay, auto-tune), [game/README.md](game/README.md), [game/BOMB.md](game/BOMB.md), [game-py/README.md](game-py/README.md), [game-link/README.md](game-link/README.md), [docs/DETAILED_README.md](docs/DETAILED_README.md) (how everything works).

## What you need

- **Muse 2**: charged, Bluetooth on, the Muse phone app closed.
- **Cyton + Daisy** (optional): the board with its WiFi Shield or USB dongle, Python 3.10 or newer, and for STRESS two gel ECG pads.
- **Windows** with **Microsoft Edge** or **Google Chrome**.

## How to start it

**Muse 2:** double-click **Open Muse Panel.bat**, leave **MUSE** selected (the small switch above Connect), press **Connect** and pick your Muse.

**Cyton + Daisy:** turn the board on and double-click **Open Cyton Panel.bat**. That is all: it starts the helper in a minimized "Cyton Helper" window (the first run sets up its own Python environment, about a minute, once; it finds the WiFi Shield or the USB dongle by itself, WiFi first) and opens the panel already set to **CYTON**, which connects on its own. Close the "Cyton Helper" window to stop it. (Mac: **Open Cyton Panel (Mac).command**. `Open Cyton Helper.bat` alone still starts just the helper.)

**Switching:** click **MUSE** or **CYTON** above Connect at any time; the panel disconnects the current device first, then connects the other one (the Muse reconnects by itself if this browser has paired it before, otherwise press Connect once).

No headset? Add `?demo=1` to the address (`muse-panel.html?demo=1`, or `muse-panel.html?demo=1&device=cyton` for a simulated Cyton) and press Connect.

## The four outputs

| Output | Devices | From | Meaning |
|---|---|---|---|
| **FOCUS** | both | frontal theta up, posterior alpha down, central low beta (13-20 Hz) up | relative to your usual (50 = usual for you) |
| **STRESS** | both | heart rate (ECG on the Cyton, pulse on the Muse), heart-rate variability, alpha | physiological arousal |
| **DROWSY** | Cyton | theta+alpha / low-beta ratio, blink duration and rate, eyes-closed time, alpha bursts | a slow trend with minutes of lag |
| **BUTTONS** | Cyton | a quick double blink; a short jaw-clench tap | events for games |

**Chips:** `LIVE` = measured now; `HELD · reason` = the last clean value while an artifact passes (confidence fades over 3 s); `LEARNING` = still learning your usual level (about the first 2 minutes after the headset is put on); `--` = not measured, with the reason (movement, muscle, blink, no contact, no ECG, no pulse, signal lost, eyes closed). A missing value is never shown as 0.

**Badges** (in the slot where Legacy's Auto Set Baselines button sits): who the panel thinks is wearing the headset (`Looks like Julian (82%) ✓ ✗`, `Probably …`, `Guest 2`, `Identifying…`) and how much of that person's data it has (`Population norms`, `Learning you (N min)`, `Personal, medium`, `Personal, high`). Tick confirms; cross lets you pick the right person or a new guest (the whole session is moved), plus Rename, Merge into…, Forget me, Export and Import.

## Honest limits

- The scores are relative to your own usual level (50 = usual for you). They are not absolute and cannot be compared between people.
- Focus and stress are not validated measures.
- Muse focus is weak: 4 sensors, none over the top of the head.
- STRESS measures physiological arousal. Excitement, effort and caffeine look the same.
- While you move, talk, chew or tense your face, the score is held and then shown as `--`. Those moments are not measured.
- Drowsiness is a slow trend with minutes of lag and needs 10 minutes of history.
- Person detection is a guess, and on the Muse it is unreliable. Use ✗ to correct it.
- The Cyton's dry electrodes on this headset have no published validation.
- OpenBCI retired the WiFi Shield for reliability problems. If data drops, use the USB dongle.
- Nothing here is a medical device.

## Privacy

Profiles (per-session summaries and identity templates, never raw signals) stay in this browser's local storage (`museengine.profiles.v1`). They are never sent anywhere; only a profile label and a confidence number go to the game link on `127.0.0.1`. If the browser blocks storage the panel still works and says "Not saved". Forget me deletes a person and all their sessions.

## Legacy mode

Press **LEGACY** to get the original behaviour: FOCUS = `ln(beta/alpha)` smoothed about 3 s and mapped with **Auto Set Baselines 10 seconds** (relaxed → 25, concentrating → 75); STRESS = 100 minus focus; the old arousal card with `?stress=1`. Legacy beta (13-30 Hz) includes forehead and jaw muscle, so a frown reads as "focus"; that is one reason the new engine exists. On the Cyton, Legacy focus runs on the mean of the good channels with its own baselines.

## Recording

**Start/Stop Recording.** On the Muse the CSV keeps its old columns in the same order (`time_s`, the 4 sensors, 5 bands, `sensors_in_use`, `focus_index_ln_beta_over_alpha`, `focus_0_to_100` = always Legacy, heart rate, the 3 motion columns) and appends `eng_focus, eng_focus_state, eng_stress, eng_stress_state, eng_profile_conf, eng_mask`. On the Cyton the v2 recorder saves 4 files (`_eeg.csv`, `_aux.csv`, `_engine.csv`, `_meta.json`; up to 40 minutes; the browser may ask once to allow multiple downloads). Gaps stay gaps; nothing is filled in.

## Validation and auto-tune (optional, once per device)

Open **validation.html** and follow it: about 32 minutes of guided rest, tasks and deliberate artifacts, recorded with markers. Then run `python tools/autotune.py` and read `docs/validation-report.md`. The SOP is [workflows/validate_focus_stress.md](workflows/validate_focus_stress.md). This checks and tunes the engine; it is not a calibration and the panel never needs it. Undo by deleting `engine/tuned.json` and `engine/tuned.js`.

## Games

The game menu (Games button) and external games on `127.0.0.1:8765` receive the focus number exactly as before (New or Legacy, whichever is selected; `null` when there is no reading), plus the v2 fields: metrics, button events (resent until acknowledged), device, engine, profile label. Gameplay is unchanged.

## Tests

`node tools/run_all_tests.js` runs every test (old and new, Node and Python) and prints a table; exit code 0 means all passed. `node tools/browser_smoke.js` (optional) takes screenshots of every look and device with headless Chrome or Edge and runs the in-page self-test.

## If it will not connect

Muse: close the Muse app on any phone, remove "Muse" in Windows Bluetooth settings, restart the headband, press Connect. Cyton: see [tools/README.md](tools/README.md) (WiFi direct mode, dongle, the FTDI latency fix).

## Files

| Path | What it is |
|---|---|
| `muse-panel.html`, `Open Muse Panel.bat`, `Open Muse Panel (Mac).command` | the panel and its launchers |
| `panel/` | the panel's code (UI, signal path, Bluetooth, Legacy focus, recording, games, and `engine-*.js`: the glue, UI and recorder of the new engine, `validation.js`) |
| `engine/` | the new engine: pure maths, one file per stage, each with a `*.test.js` |
| `adapters/` | Muse frames, the Cyton WebSocket client and the in-browser Cyton simulator |
| `tools/` | `cyton_helper.py`, `replay.js`, `make_synth_recording.js`, `autotune.py`, `get_datasets.py`, `browser_smoke.js`, `run_all_tests.js` |
| `Open Cyton Panel.bat`, `Open Cyton Panel (Mac).command` | one double-click for the Cyton: starts the helper (creates `.venv-cyton` on first run) and opens the panel set to CYTON |
| `Open Cyton Helper.bat` | starts only the Cyton helper |
| `validation.html`, `workflows/validate_focus_stress.md` | the validation recording and its SOP |
| `focus/`, `arousal.js`, `stress.js` | Legacy display switch, the Legacy arousal model and stress card; `focus/experimental/` is parked (not loaded) |
| `game/`, `game-py/`, `game-link/` | the games |
| `docs/` | `DETAILED_README.md`, `IMPLEMENTATION_NOTES.md`, the spec and research documents |

## About this project

Built with Claude Code as a student project. All maths runs locally (in the browser, and in the Cyton helper for the board link).
