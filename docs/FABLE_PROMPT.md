# PROMPT FOR FABLE 5.2: write the single implementation prompt

You are Fable 5.2. Your task is to write **one implementation prompt**. A separate coding agent will receive that prompt and build the system described below inside Julian's repository (`Muse 2 RAW`, a browser panel for Muse 2 EEG plus games, on Windows 11, Chrome/Edge).

This file contains everything prepared for you, in four parts:

- **Part 1:** the request set (Julian's final decisions plus 17 detailed requests). This is the specification.
- **Part 2:** the research appendix (evidence, numbers, sources).
- **Part 3:** a snapshot of the key source files as they exist now, so you can name real functions, globals, files and load orders.
- **Part 4:** the repository file list.

If you can open the repository yourself, the same material is in `docs/fable-requests-cyton-artifact-robust.md` and `docs/fable-research-appendix.md`, and the live code is in the repo. Where the snapshot and the repo differ, the repo wins.

## The rules you must follow (read twice)

1. **Write exactly one prompt.** It is the *only* thing the implementing agent will ever receive. There is no second message. Julian will never answer questions, say "continue", approve steps, test hardware on request, or help in any other way. You don't get to ask Julian anything either. Every question is already answered in Part 1.

2. **Make the prompt fully self-contained and extremely detailed.** The implementer has the repo, but not this conversation, this research or your reasoning. Put into the prompt everything it needs:
   - every decision
   - the module layout with file paths
   - function signatures and data structures
   - equations with units, and every constant with its value and justification
   - state machines and timings
   - message formats, byte by byte
   - UI states and wording
   - the order of work
   - test names with numeric pass/fail criteria
   - the completion checklist

   Short or vague items ("add artifact handling", "tune thresholds", "improve UI") are failures. Expect the prompt to be long. Length is fine; ambiguity is not.

3. **Never defer.** Never write "ask Julian", "confirm with the user", "TBD", "decide later", "if unsure, stop", or "optionally ask". If Part 1 leaves a detail open, decide it yourself, state the decision and give a one-line justification. If you change a number from Part 1, say why.

4. **Plan for no hardware.** The implementer will most likely not have the Muse 2 or the Cyton+Daisy connected. The prompt must make everything buildable and testable with:
   - simulated devices (the existing `?demo=1` Muse simulator and a new `--simulate` mode for the Cyton helper)
   - synthetic seeded fixtures
   - replay of recorded CSVs (optional)
   - optional public datasets (skipped when absent)

   Every hardware-only fact gets a runtime self-check plus a stated fallback (Part 1, section 5). Real-world tuning happens later through the validation page and the `tools/autotune.py` script, which Julian runs alone. No agent is involved.

5. **Tell the implementer, explicitly and early in the prompt:**
   - Do not ask questions. Do not stop early. Do not hand back partial work for review.
   - When something is ambiguous, choose the option most consistent with the prompt, log it in `docs/IMPLEMENTATION_NOTES.md`, and keep going.
   - When a test fails, fix the code (or the test, if the test is wrong, logging why) and rerun.
   - Finish only when every item in the completion checklist is done and every old and new test passes. Then write the final checklist report into `docs/IMPLEMENTATION_NOTES.md`.
   - Work on a new local branch `feat/robust-engine-cyton` created from the current branch. Commit after each work step with clear messages, ending with the attribution line the environment provides. Never push.
   - Preserve the project rules:
     - Never rename or reorder existing CSV columns; only append.
     - Missing data is never shown as 0.
     - Stale values are marked.
     - Legacy and parked code are kept.
     - Python tools go in `tools/`, the SOP in `workflows/`, scratch in `.tmp/`.
     - Plain Node and Python tests, with no new npm dependencies.
     - Python dependencies listed in `tools/requirements.txt`.

6. **Keep honesty in the product.** These are within-person relative indices, not validated measures. STRESS is labelled with a note that it measures arousal. Artifact windows are held and fade to `--`, not measured. Muse is weaker than the Cyton. OpenBCI deprecated the WiFi Shield for reliability reasons, so the dongle is the fallback.

7. **Structure your prompt** so the implementer can follow it top to bottom:
   - (a) mission and rules
   - (b) what exists (files and what each does)
   - (c) the target architecture
   - (d) a detailed spec per module, following Part 1's R1-R17
   - (e) runtime checks and fallbacks
   - (f) step-by-step order of work, with tests and a commit per step
   - (g) the full test list with pass criteria
   - (h) the docs to write
   - (i) the completion checklist

8. **Output:** produce only the implementation prompt, ready to paste, with no commentary before or after it. If you have write access to the repository, also save it as `docs/IMPLEMENTATION_PROMPT.md`.

Everything below this line is your source material.

---

# PART 1: REQUEST SET (the specification)

# Requests for Fable 5.2: artifact-robust focus/stress, Cyton+Daisy mode, self-learning scores

Prepared 2026-11-13 from a code review of this repo, 15 research agents, and 6 rounds of questions answered by Julian.
Branch at time of writing: `mario-kart-focus` (head `7e0af33`).

---

## 0. READ FIRST: how this document will be used (non-negotiable)

**Fable, your job is to turn this document into ONE implementation prompt.** That prompt is the *only* input the implementing agent will ever get.

- Julian will **never** answer a question, say "continue", approve a step, test hardware on request, or help in any other way. There is no second message. There is no human in the loop.
- So the prompt you write must be **complete and self-contained**. Assume the implementer has this repo and nothing else: no memory of this conversation and no access to this research except what you put in the prompt.
- **Be extremely in-depth on implementation details:** file names, module boundaries, function signatures, data structures, equations, constants and their units, update rules, state machines, message formats, UI states, test names with pass/fail numbers, and the order of work. Vague instructions ("add artifact handling") are failures. Every number below either goes into the prompt or is replaced by a better-justified number that you state.
- **Every decision is already made** (sections 2 and 4). Where something must be verified on hardware the implementer won't have, the prompt must give (a) a runtime auto-detection or self-test, and (b) a default/fallback used when the check cannot run or fails. Never write "ask Julian", "confirm with the user", "TBD", or "decide later".
- The implementer must be told explicitly: **do not stop early, do not ask questions, do not hand back partial work for review.** If a choice is ambiguous, pick the option that best matches this document, record it in `docs/IMPLEMENTATION_NOTES.md`, and continue. Finish everything, run every test, fix failures, and only then stop.
- The implementer will probably **not have the headsets connected**. Everything must be buildable and testable with simulated devices, recorded-file replay and public datasets. Hardware-only steps become (1) runtime self-checks that run automatically when the device is first used, and (2) a recording-plus-auto-tune tool Julian runs later on his own, which needs no agent.
- The prompt should end with a **completion checklist** the implementer must satisfy and report against: every test passing, every file listed, the docs updated.

Write the prompt so a strong model could execute it start to finish with zero clarification. If this document has a gap, fill it in the prompt with a stated, justified default. Don't leave it open.

---

## 1. What exists today (the implementer must read these files first)

Browser app (plain JS classic scripts sharing globals, Chrome/Edge, served from localhost by `Open Muse Panel.bat` / `.command`). Load order (`muse-panel.html` lines 107-125): `game/bomb-logic.js, game/bomb.js, game/menu.js, panel/core.js, panel/pulse.js, panel/motion.js, panel/ui.js, panel/dsp.js, panel/ble.js, panel/focus.js, focus/focus-switch.js, panel/recording.js, panel/gamelink.js, panel/main.js, arousal.js, stress.js, panel/stress-link.js`.

| Area | File | What it does now | Problem |
|---|---|---|---|
| Muse BLE | `panel/ble.js`, `panel/core.js` | 4 EEG ch (TP9 AF7 AF8 TP10) 256 Hz in µV, PPG IR 64 Hz, accel/gyro 52 Hz, preset p50 (fallback p21), demo mode `?demo=1` | fine; keep |
| Stream alignment | `panel/dsp.js` `handlePacket/emit` | sequence-number alignment, gaps never filled, 0.995 one-pole DC removal, 5 biquad band filters on the **average** of usable channels, `|y|>300 µV` sets `S.artUntil` for 1.2 s, contact % from 1 s RMS | band power from channel average mixes artifacts in; no per-channel spectra |
| Legacy focus | `panel/gamelink.js` 250 ms loop, `panel/focus.js` | `F = ln((β+1e-3)/(α+1e-3))` from biquad band energy, EMA 0.08 / fast 0.22, 10 s baseline → 10th/90th pct → 25/75, held while `S.mot.bad` | β 13-30 Hz is exactly where frontalis EMG peaks, so jaw clench and frown fake focus; 10 s baseline too short |
| Focus switch | `focus/focus-switch.js` | FOCUS/STRESS display, STRESS = 100 − focus, baselines in localStorage `muse2panel.baselines` | stress is not a separate measure |
| Motion gate | `panel/motion.js` | accel diff-RMS + gyro RMS, hysteresis (k=5 entry / 3 exit × MAD), 1.5 s still to resume, 30 s still-calibration, localStorage `muse2panel.motcal` | good pattern, reuse; can't see EMG |
| Stress (live) | `arousal.js` via `stress.js` `attach()` | `F = 100·clip(0.40H + 0.35V + 0.25E)`, H = HR rise, V = RMSSD drop, E = median β/α rise vs 2 min sit-still baseline; refs guessed: HR +40 bpm, RMSSD ×0.5, ratio ×1.75 | refs far too extreme (typical acute mental stress is HR +3-15 bpm, RMSSD −10-40%); Muse PPG RMSSD is unreliable (below); β/α is EMG; needs a 2 min instructed baseline |
| Old stress model | `stress.js` (`makeMeter`, two-phase calm + arithmetic task, effect size d) | kept but unused | instructed task is not allowed any more |
| Parked muscle correction | `focus/experimental/*` (not loaded) | β − gain·EMG-excess, ordered gate, 256-pt Hann PSD per channel | calibration unreliable; keep parked |
| Recording | `panel/recording.js`, `dsp.js recPush` | CSV 256 rows/s, columns 0-13 fixed + 3 motion columns appended; 10 min cap | the CSV column rule stands: **never rename or reorder existing columns, only append** |
| Game link | `panel/gamelink.js sendGame` → `game-py/link.py`, `game-link/stacker.py` | panel POSTs JSON `{focus, mode, sensors, motion, stale}` to `http://127.0.0.1:8765/` every ~230 ms; `link.py` caps body at 1024 bytes | must stay backward compatible; add fields |
| Game menu | `game/menu.js` `GameMenu.attach({ctx})` with `focus()`, `stress()` (0-1), `sensors()`, `status()` | Mario Kart (JS `game/mkds*.js` + Python `game-py/`), bomb game (`game/bomb*.js`) | must be fed by the new engine |
| Tests | `node arousal.test.js`, `node stress.test.js`, `node panel/motion.test.js`, `node game/bomb.test.js`, `node game/mkds.test.js`, `node focus/experimental/focus.test.js`, `python game-py/test_mkds.py` | plain Node scripts printing pass/fail | new code follows the same style: plain Node, no framework, no npm install needed |
| Docs | `README.md`, `docs/DETAILED_README.md`, `docs/focus-correction-plan.md`, `PLAN.md` | | update all of them at the end |

Project conventions (from `CLAUDE.md`, WAT framework): Python tools go in `tools/`, SOP markdown in `workflows/`, scratch in `.tmp/`, secrets in `.env`. Code comments and UI text are plain and short. Every displayed score is honest: missing/invalid data is never shown as 0, and stale values are marked.

---

## 2. Julian's decisions (all final; put them in the prompt as requirements)

1. **Devices:** keep Muse 2. Add **OpenBCI Cyton + Daisy (16 ch)** on an **Ultracortex Mark IV with dry comb electrodes**.
2. **Cyton link:** **WiFi Shield primary, USB dongle (RFduino) fallback**, both through the same local helper.
3. **A local Python helper is allowed** (BrainFlow). The browser can't receive the WiFi Shield's TCP push.
4. **Outputs:**
   - **Cyton mode has 4 outputs:** FOCUS, STRESS, DROWSINESS, and a BUTTONS event stream (**double blink** and **jaw-clench tap** only).
   - **Muse mode keeps 2 outputs:** FOCUS and STRESS. It gets the same artifact-robust engine, but no drowsiness and no buttons.
5. **New engine replaces the old one on both devices.** Keep the old formulas selectable as **"Legacy"** for comparison. Do not delete legacy or parked code.
6. **No calibration, ever.** Calibration may never require the user to do anything specific (no "clench", "blink 5 times", "do arithmetic", "close your eyes"). At most: the session starts, the user sits and waits under 30 s while contact/identity settle. Julian's chosen approach: **continual self-calibration**. Running statistics are updated with every new clean window, weighted by elapsed time (`new_mean = (T·mean + dt·x)/(T + dt)`), across sessions, so accuracy keeps improving with use. Section 4.6 specifies how to do this without the known failure modes.
7. **Person auto-detection:** the system recognizes who is wearing the headset (Julian vs returning demo guests vs new people) without name entry, and loads that person's learned statistics. One-tap correction allowed.
8. **Use conditions:** keyboard gaming, **moving around a lot**, head turns, talking, demos for new people, at home and at other places (unknown WiFi/noise).
9. **Artifact behaviour = "hold + fade confidence":** while contaminated, hold the last clean value and decay its confidence. After the max hold (3 s, the previously decided maximum), show `--` (never 0).
10. **Stress on screen is labelled `STRESS`** with a small note that it measures physiological arousal (excitement looks the same).
11. **Cyton heart signal:** **ECG sticky pads on a spare Cyton/Daisy channel** (torso placement).
12. **Games:** send all new outputs (4 values + confidence + button events + state) to **Mario Kart** and the **bomb game**. **No gameplay mapping yet**: games receive the new data, but nothing in gameplay changes except that the existing focus/stress inputs now come from the new engine.
13. **One-time developer validation recording:** Julian will do a single scripted ~20-30 min recording later, on his own. The system must provide the recording protocol tool and an automatic analysis/tuning script that needs no agent.
14. **Deliverables in the repo:** code, tests, docs. Work on a new local git branch `feat/robust-engine-cyton` (from the current branch), commit in logical steps, never push, and add the commit attribution line the environment requires.

---

## 3. Research findings the design rests on (summarise into the prompt where they justify a constant)

**Muscle (EMG) is the main enemy.**
- Whitham et al. 2007 (Clin Neurophysiol 118:1877): under paralysis, scalp power above 20 Hz fell 10-200×. Most scalp EEG above ~20 Hz is EMG.
- Goncharova et al. 2003 (Clin Neurophysiol 114:1580): frontalis EMG peaks around 20-30 Hz frontally and temporalis around 40-80 Hz temporally. Even weak contraction contaminates alpha/beta over the whole scalp.
- No filter separates EMG from beta. The robust strategy is: (1) prefer EMG-insensitive features (theta, alpha, low beta 13-20 Hz at central/parietal sites), (2) detect EMG and mask it, and (3) don't try to regress EMG out of 4 channels. Regressing on temporal channels also removes brain signal.

**Artifact removal methods.**
- ASR works at modest channel counts, down to about 4 (low-density ASR, IEEE Sensors J 2022). The Chang et al. 2020 cutoff is k=20-30, and stricter (7-14) for walking.
- rASR (Blum 2019) is faster and better on blinks.
- ORICA needs high density.
- iCanClean beat ASR in phantom tests (Downey & Ferris 2023), but it is MATLAB-only and needs noise references.
- Accelerometer NLMS helped in one dry-electrode workload study (Rosanne 2021, n=48, 500 taps). Motion artifact is mostly below 10 Hz.
- No JS ASR exists. `asrpy` / `meegkit` are the porting references.
- Deep-learning denoisers are not suitable (offline, trained on wet semi-synthetic data).

**Focus.**
- Theta/beta ratio is discredited (Arns 2013; eLife 2026 multiverse).
- Frontal-midline theta rises with load (Gevins 1997; Onton 2005, source-level). A 2022 Psychophysiology meta-analysis calls it the most consistent workload index.
- Parietal alpha falls with demand.
- Pope 1995 β/(α+θ) is beta-heavy.
- Cross-subject workload decoding is near chance (0.449 balanced accuracy, strict LOSO), so the output is a **within-person relative index**, not absolute focus.
- No peer-reviewed validation exists for Ultracortex dry combs. Frey 2016 found OpenBCI comparable to g.tec for workload with **wet** electrodes (AUROC 0.853 vs 0.860).

**Stress.**
- HR responds within seconds and is the most robust marker.
- RMSSD needs a window of at least about 30 s: a 10 s window gives r≈0.85 against 5 min, three 10 s windows average to r≈0.94 (Muñoz 2015, n=3387), and Esco & Flatt 2014 accept 60 s.
- Typical acute mental stress: HR +3-15 bpm, RMSSD −10-40% (memory-level evidence; treat as priors only).
- Frontal alpha asymmetry is weak as a state measure. EEG stress classifiers are inflated by EMG/eye artifacts and leakage (SAM40 critiques).
- **Muse 2 PPG** (2026 preprint vs Polar H10, n=28 seated): HR ICC ≥0.999, but RMSSD ICC 0.60 with a +19 ms bias (about 1.9× high).
- ECG HRV at 125 Hz is acceptable with R-peak sub-sample refinement (Task Force 1996; Ellis 2015: with cubic/parabolic refinement all HRV measures held even below 100 Hz).
- Elgendi 2013 and Pan-Tompkins (rescaled) suit low rates. Use Lipponen & Tarvainen 2019 beat correction. For signal quality, kSQI ≥ ~5 is clean and template correlation ≥0.8.

**Drowsiness.**
- (θ+α)/β rises most over a monotonous drive (Jap 2009, n=52).
- Blink duration and lid-reopening delay are the best sleepiness indicators (Schleicher 2008). Normal blink duration is about 190-270 ms; a blink over 500 ms is a drowsy prior.
- Alpha spindles with eyes open beat plain alpha power (Simon 2011).
- Eyes-closed relaxation must not count as drowsy on alpha alone.
- This is a trend meter with minutes of lag.

**Blink/clench buttons.**
- Voluntary blinks have larger EOG amplitude (Kaneko & Sakamoto 1999) and are longer (about 420-480 ms vs 300-350 ms, Abe 2014).
- EOG blink switches reach about 97% (Nakanishi 2014). Consumer EEG blink input is about 86-88%.
- Jaw clench shows as a bilateral 20-60+ Hz burst on temporal channels. EarEOG reports 94% for clench gestures with under 125 ms delay.
- Chewing is rhythmic at 1-2 Hz and talking is irregular.

**Self-calibration.**
- Unsupervised adaptation can replace calibration (Vidaurre 2011: 3-6 min). Adapting location (mean) is far safer than adapting the whole model. Riemannian re-centering (Zanini 2018) is location re-anchoring.
- **The trap:** a cumulative mean absorbs sustained states. After H minutes of history, a state held T minutes keeps only H/(H+T) of its displayed shift. For a new user with 10 min of history, a 20 min focused stretch shows only 33%. An EMA with τ=15 min keeps only 26% of a 20 min state.
- Commercial products (WHOOP 14-day, Oura daily, Fitbit first month, Emotiv "auto-scaled", Garmin fixed HRV bands) use rolling personal baselines. None publish validation.

**Person identification.**
- EEG alone is weak cross-session (consumer Muse channels: about 13-18% EER). ECG is strong (about 3-6% multi-session EER for single lead).
- Expected here:
  - Muse: about 60-80% closed-set ID.
  - Cyton EEG+ECG: about 90-97%.
- So use a soft posterior plus a one-tap correction, never update a profile before identity is confident, and use neutral population priors while uncertain.

**OpenBCI facts.**
- 33-byte packets: `0xA0`, sample counter wraps at 255, 8×24-bit, 6 aux bytes, footer `0xC0-0xC6`.
- Scale: 4.5 V / gain / (2^23−1) µV-per-count. Gain 24 gives about 0.02235 µV.
- Daisy interleaves odd/even packets. Each value is the average of the current and previous sample.
- Dongle: 250 packets/s, so 125 Hz per channel and Nyquist 62.5 Hz. FTDI latency timer must be 1 ms.
- Channel string `x<ch><pwr><gain><input><bias><srb2><srb1>X`. Daisy channels are `QWERTYUI`.
- Lead-off `z<ch><p><n>Z` at 31.5 Hz. Impedance ≈ (RMS_µV·1e-6·√2)/6e-9 A. Only one channel at a time, and it distorts data while it runs.
- Ultracortex Mark IV 16-ch default (verify at runtime from signal statistics; don't trust blindly):
  - Cyton 1-8 = Fp1 Fp2 C3 C4 P7 P8 O1 O2.
  - Daisy 9-16 = F7 F8 F3 F4 T7 T8 P3 P4.
  - No Fz/Cz/Pz.
- **WiFi Shield:**
  - OpenBCI lists it as deprecated, "no longer offered for sale due to reliability issues" (packet loss, cyclical noise spikes).
  - Daisy rates 250/500/1000 Hz and above. Default 1000 Hz, 10 ms latency.
  - Modes: Direct AP at 192.168.4.1, or station mode. No WPA2-Enterprise (eduroam fails).
  - BrainFlow `CYTON_DAISY_WIFI_BOARD` (id 6): `ip_port` required, `ip_address` optional.
  - One report of 50-60 contiguous packets lost about once a minute at 1000 Hz × 16 ch.
  - Accelerometer channel availability over WiFi in BrainFlow is unverified.
- BrainFlow `CYTON_DAISY_BOARD` serves the dongle.

**Datasets for offline tests:**
- COG-BCI (Zenodo 7413650): workload, multi-session, ECG.
- PhysioNet EEGMAT: rest vs arithmetic.
- SAM40 (raw folder): stress.
- EEGdenoiseNet: clean EEG + EMG/EOG segments.
- Klados semi-simulated EOG (Mendeley wb6yvr725d v4, CC BY).
- WESAD: ECG/EDA stress, no EEG.
- Mendeley Muse 2 focus/relax/distraction (g69dctrybk).
- Mendeley Ultracortex MI with deliberate blinks (rz2jhpvhp3 v2).
- These must be **optional** (download script with `--dataset` flags). Tests must pass without them, using synthetic fixtures. Dataset tests run only if the data exists in `.tmp/datasets/`.

---

## 4. The requests (each must become a fully specified part of the prompt)

### R1. Architecture: one engine, two device adapters

- Create `engine/` (classic-script and Node-`require` compatible, same UMD pattern as `arousal.js`). Pure maths, no DOM. Every module gets a `*.test.js`.
- **Device adapters** produce one common frame stream: `{device, fs, channels:[names], t0, samples: Float32Array[ch][n], sampleIndex, gaps:[...], accel:{fs, xyz}|null, gyro|null, ppg|null, ecg:{fs, data}|null, contact:[per-ch quality]}`.
  - `adapters/muse.js` wraps the existing `panel/ble.js` / `dsp.js` buffers. Don't rewrite BLE. Tap the per-channel offset-removed samples `ys` in `emit()`, plus PPG and motion.
  - `adapters/cyton.js` is a WebSocket client to the helper.
- **Engine pipeline** (fixed order; spell out each stage's inputs, outputs and state):
  1. ingest and gap bookkeeping
  2. per-channel preprocessing
  3. contact quality
  4. artifact event detector (R4)
  5. optional cleaning (R5)
  6. feature extraction per 250 ms hop on 2 s windows (Welch over 1 s Hann segments, 50% overlap, log power)
  7. metric models (R6-R9)
  8. self-calibrating normalization (R10)
  9. hold/fade and output (R11)
- The engine runs the **Legacy** computations in parallel so switching is instant.
- **Engine output object** (emitted every 250 ms):
  `{t, device, profile:{id, label, confidence}, focus:{value, conf, state}, stress:{value, conf, state, components}, drowsiness:{...}|null, events:[...], quality:{perChannel, ecg, motion, packetLoss}, legacy:{focus, stress}}`.
  - `state` is one of `live | held | stale | learning | unavailable`.
  - `value` is null whenever state is `stale` or `unavailable`.
- Wire it into the panel with a new `panel/engine-link.js`, loaded after `stress-link.js`. Existing UI elements show engine values when "New" is selected and legacy values when "Legacy" is selected. A device selector (Muse / Cyton) sits next to Connect.

### R2. Python helper for the Cyton (`tools/cyton_helper.py`)

- **BrainFlow boards:**
  - WiFi: `CYTON_DAISY_WIFI_BOARD`. Default `ip_address` 192.168.4.1 (Direct mode), CLI flag for station-mode IP; SSDP discovery if omitted.
  - Dongle fallback: `CYTON_DAISY_BOARD` with COM-port auto-scan (pick the FTDI port).
  - Selection: try WiFi, and if no data arrives within 10 s, try the dongle. CLI `--link wifi|dongle|auto` (default `auto`).
- **Transport:** `requirements.txt` in `tools/`. Serve a **WebSocket on 127.0.0.1:8766** (8765 stays the game link). Send binary frames every 40 ms with float32 µV per channel, the sample index, the board timestamp, accel when present, and loss counters. Send JSON control messages for status, channel map, rate, impedance results and errors. Document the exact frame layout byte by byte in the prompt and in `tools/README.md`.
- **Sample rate:** on WiFi, pick the highest of 1000 → 500 → 250 Hz board rate whose measured loss over the first 20 s is under 1%. Report the per-channel rate (derive it from timestamps; don't assume). On the dongle, rate is fixed at 250 board / 125 per channel. Everything downstream must work at any rate ≥125 Hz per channel and must use bands ≤ Nyquist−5 Hz. EMG bands adapt to the rate:
  - 25-55 Hz at 125 Hz
  - 25-100 Hz when the rate is ≥250 Hz
- **Self-checks on start, logged and sent to the panel:**
  - Daisy attached (16 channels present).
  - Per-channel railed / flat / line-noise.
  - Accelerometer present (if not, use the EEG-derived motion proxy from R4).
  - Measured rate and loss.
  - On dongle: FTDI latency (warn in the panel with the exact Device Manager fix if bursts are ≥ 10 ms apart in arrival).
  - Optional impedance sweep (`z` per channel, about 2 s each, only when the user clicks "Check contact", since it distorts data).
- **Channel settings sent at start:**
  - EEG channels: `x<ch>060110X` (gain 24, bias on, SRB2 on).
  - **ECG channel = Daisy channel 9 (F7 position).** Decided: F7 is the least valuable site (F8 and T7/T8 still monitor lateral EMG). The user moves the F7 lead to the ECG pads. Settings: `xQ050000X`, which is gain 12, bias **off**, SRB2 **off**, SRB1 off.
  - The ECG channel index is configurable (`--ecg-channel`). Auto-detect ECG by a periodic 0.7-3 Hz QRS-shaped high-kurtosis signal. If channel 9 doesn't look like ECG but another channel does, warn and use the detected channel. If none does, run stress without ECG.
  - Torso placement must be documented in the panel help and README: modified lead II, P under the right clavicle and N on the left lower ribs (or the reverse if the QRS is inverted, which the code auto-flips), gel pads, cables strain-relieved, no wrist leads.
- **Robustness:**
  - Reconnect loop.
  - Packet-loss accounting; gaps are passed as gaps and never interpolated.
  - Survive WiFi drops.
  - A clean shutdown that stops the stream.
  - `--simulate` mode that generates realistic synthetic 16-ch EEG + ECG + accel with scripted artifacts. This is how the implementer tests without hardware.
- **Launcher:** `Open Cyton Helper.bat` starts the helper. If dependencies are missing, it creates a venv and installs them first. The panel shows helper status and the exact command when the helper isn't running.

### R3. Preprocessing and contact quality

- Per channel:
  - DC/drift removal: the same 0.995 one-pole high-pass as today, or 0.5 Hz high-pass at any fs. Use a coefficient derived from fs; don't hard-code it.
  - 60 Hz notch (US; constant `MAINS_HZ` with a 50 Hz option).
  - 1-45 Hz analysis band (capped at Nyquist−5).
- **Aliasing check:** at 125 Hz per channel, the 120 Hz mains harmonic folds to 5 Hz (theta). The helper self-test must measure 5 Hz line-locked power on shorted/idle channels and warn if it is significant. The prompt must state this risk.
- **Contact quality per channel, 0-100:**
  - Muse: keep the existing RMS-based method.
  - Cyton: combine railed fraction, 1 s RMS window (good 3-80 µV for dry), 60 Hz ratio, and the last impedance result when available.
  - Channels under 40 are excluded from features. Their exclusion is reported.

### R4. Shared artifact event detector (`engine/events.js`)

A single detector module that both **masks** artifacts for focus/stress/drowsiness and **generates** the Cyton buttons.

- **Event output:** `{type, onset, offset, conf 0-1, channels, amp, durMs}`. Types:
  `blink | blink_voluntary | double_blink | eyes_closed | saccade | emg_burst (sub: clench | chew | talk | tension) | clench_tap | motion | electrode_pop | gap | bad_contact`.
- It runs every 50 ms on a 250 ms look-back.
- Spectral windows are masked **retroactively** (the score uses data older than the detection latency, so a 200-400 ms detection lag never leaks into a score).
- **Detectors** (specify each fully):
  - **Blink:**
    - Signal: frontal vertical EOG on Fp1/Fp2 (Cyton) or AF7/AF8 (Muse), low-passed under 10 Hz.
    - Detection: derivative threshold plus amplitude threshold, both from running robust stats (median + 4·MAD of the slow-band envelope). Population prior floor about 60 µV dry.
    - Record duration (50% amplitude width), amplitude and reopening time.
  - **eyes_closed:** sustained frontal step / flat-top over 500 ms plus a posterior alpha rise (Cyton O1/O2/P3/P4).
  - **saccade:** antisymmetric step in Fp1−Fp2 (AF7−AF8).
  - **emg_burst:**
    - Band-pass 25-55 Hz (or up to 100 Hz when fs ≥250), rectify, 75 ms smoothing.
    - Compare against a rolling robust baseline per channel group (temporal T7/T8 or TP9/TP10; frontal F7/F8/Fp; others).
    - Trigger at ≥3× the baseline envelope for ≥100 ms.
    - Sub-labels:
      - Bilateral single burst 0.2-0.6 s = clench.
      - ≥3 bursts at 0.7-2.5 Hz = chew.
      - Irregular bursts with frontal/temporal asymmetry = talk.
      - Sustained >1 s = tension.
  - **motion:**
    - Muse: reuse `panel/motion.js` logic, moved into the engine or wrapped.
    - Cyton: LIS3DH accel diff-RMS with the same hysteresis.
    - If accel is absent: an EEG-derived proxy (simultaneous low-frequency over 4 Hz amplitude jump on ≥50% of channels).
  - **electrode_pop:** step or gradient over 50 µV/sample on one channel.
  - **gap:** from adapter gap list.
- **Masking rules, applied to feature windows:**

  | Event | Mask from onset | Mask after offset |
  |---|---|---|
  | blink | −100 ms | +400 ms |
  | emg_burst | −100 ms | +300 ms (+1 s for chew/talk) |
  | motion | −200 ms | +500 ms, and resume only after 1.5 s still (existing rule) |
  | gap | | +window length |
  | electrode_pop | | +1 s on that channel |

  - Channel-level masks drop only the affected channels when ≥2 good channels remain for that feature. Otherwise the whole window is masked.
  - A window is usable only if ≥60% of its samples are unmasked. Its weight downstream = clean fraction.
- **Passive self-tuning:** every threshold adapts from running robust stats of **spontaneous** events (people blink about 15-20 times a minute) using the R10 machinery with population-prior floors. No instructed actions.

### R5. Optional cleaning stage (`engine/clean.js`)

- **ASR** for Cyton (16 ch), ported from `asrpy` (BSD-3; keep license attribution in the file header).
  - The calibration matrix is learned **automatically** from windows the event detector marks clean (no instructed rest). It starts after 60 s of clean data and is refined over the session and saved per profile.
  - Cutoff k=20 by default.
  - Eigendecomposition of a 16×16 matrix (Jacobi) every 500 ms.
  - Behind a flag. Default **on for Cyton, off for Muse.**
- **Accelerometer NLMS:** implement but default **off**. It's turned on only if the validation auto-tune (R14) shows it improves artifact-immunity metrics.
- Do not ship ICA/ORICA, deep denoisers, or EMG regression.

### R6. FOCUS (both devices; within-person relative index)

- **Cyton features** (log power, per 2 s window, clean channels only):
  - `thetaF` = mean θ (4-8 Hz) over F3, F4 (and F8 when clean). This is the frontal-midline proxy, since there is no Fz.
  - `alphaP` = mean α (8-12 Hz; use the individual alpha frequency ±2 Hz once IAF is learned from the eyes-closed-free posterior spectrum) over P3, P4, P7, P8, O1, O2.
  - `betaLoC` = low β (13-20 Hz) over C3, C4, P3, P4.
- **Focus raw** = `z(thetaF) − z(alphaP) + 0.5·z(betaLoC)`, using R10 personal z-scores. Weights are defaults that R14 auto-tune may overwrite, within bounds of 0-2 each.
- **Masking:**
  - Windows during `eyes_closed` are excluded (alpha meaning flips).
  - `emg_burst` masks `betaLoC` always, and `thetaF` when the burst is frontal.
- **Muse features:** `thetaF` from AF7/AF8, `alphaP` from TP9/TP10, `betaLoC` from TP9/TP10 low β. Same formula, lower confidence ceiling (max conf 0.7). State clearly in the UI note that Muse focus is weaker.
- **Never use** β above 20 Hz, gamma, or θ/β in the new focus.
- Smoothing: EMA with τ≈2 s, applied after normalization, only on usable windows.

### R7. STRESS (label `STRESS`, note "measures arousal")

- **Cyton** components, combined in z-space by weighted sum, then normalized by R10:
  - **HR from ECG** (fast, 8 s): weight 0.45.
  - **ln RMSSD from ECG**: 30-60 s sliding, step 5 s, sign inverted; weight 0.40.
  - **EEG arousal term**: weight 0.15. Posterior alpha suppression `−z(alphaP)` on eyes-open clean windows only. Optional, and dropped when masked.
- **ECG pipeline:**
  - Band-pass 5-15 Hz.
  - Elgendi two-moving-average detector (QRS window 97 ms, beat window 611 ms, scaled by fs). Pan-Tompkins rescaled as a fallback.
  - Parabolic R-peak refinement: offset = 0.5(y0−y2)/(y0−2y1+y2) samples.
  - Polarity auto-flip.
  - RR plausibility 300-2000 ms. Reject if more than 25% off the median of the last 5. Doubled interval = missed beat, halved = extra beat.
  - Lipponen-Tarvainen-style correction over the RMSSD window.
  - Window SQI: kSQI ≥ 5 and template correlation ≥ 0.8, else the window is invalid. If more than 20% of beats are rejected in a window, there is no HRV for that window.
- **Muse:**
  - HR from PPG (existing `pulse.js` path plus the `stress.js` beat finder): weight 0.65.
  - PPG ln RMSSD: weight 0.20, **relative change only**, since the absolute value is biased about 1.9× high.
  - EEG arousal term: weight 0.15 (TP9/TP10 alpha suppression).
  - Drop the β/α term from the new engine. It stays in Legacy only.
- **Exertion guard:** if motion events cover more than 30% of the last 20 s, or HR rises over 15 bpm within 20 s while RMSSD does not drop, mark HR as exertion. It is held, not counted, and `stress.state = held`, reason `movement`.
- **Missing components:** renormalize weights over valid components; never treat them as 0 (keep the `arousal.js` rule). `components` reports each part's z and validity.
- **Priors for scale:** population priors in log/relative space (resting HR 70±10 bpm; ln RMSSD 3.4±0.5; "high arousal" ≈ HR +12 bpm and RMSSD ×0.6). These seed R10 only. Personal data takes over as it accumulates.

### R8. DROWSINESS (Cyton only; slow trend meter)

- **Markers**, all personal-z via R10:
  - `ratio` = ln((θ+α)/β_low) over C3, C4, P3, P4 (β_low = 13-20 Hz).
  - Blink duration median and blink rate per 60 s, from the R4 `blink` events (spontaneous only, not voluntary/double).
  - PERCLOS proxy = (time in eyes_closed + long blinks over 500 ms) / 60 s.
  - Alpha-spindle rate (0.5-2 s alpha bursts at O1/O2/P3/P4 with eyes open; threshold at median + 3·MAD of the alpha envelope).
- **Score:** mean of available marker z's. It may exceed z = +1 only if **≥2 markers agree** (each over +0.5). Eyes-closed alpha alone never raises it.
- Windows: 20 s spectral windows updated every 2 s, EMA with τ = 60 s.
- **Normalization exception:** baseline is **frozen within a session**. Use the R10 lifetime tier only, with no within-session offset. Merge session data only at session end, so a slow rise isn't absorbed. Show `learning` until the profile has 10 min of clean history.

### R9. BUTTONS (Cyton only; events, not scores)

- **double_blink:**
  - Two `blink_voluntary` events with peak-to-peak spacing 150-600 ms and no third blink within 600 ms.
  - Voluntary = amplitude ≥ max(1.5 × running median spontaneous amplitude, median + 3·MAD), or duration ≥ 350 ms.
  - Suppressed during `motion` and `saccade`.
  - Refractory period 800 ms.
- **clench_tap:**
  - An `emg_burst` sub-labelled clench: bilateral T7 **and** T8 envelope ≥3× baseline, single burst 200-600 ms, not part of a chew/talk pattern within ±1.5 s.
  - Refractory period 500 ms.
  - During detected talking, raise the threshold ×1.5.
- **Latency target:** under 400 ms from event end.
- Each event carries `conf`.
- The engine also masks these windows for the scores (R4).
- **Auto-tune targets** (R14): double-blink TPR ≥ 90% and false positives ≤ 1 per 5 min of gameplay+talking; clench tap TPR ≥ 90% with the same false-positive bound.

### R10. Self-calibrating normalization (`engine/norm.js`); the "no calibration, keeps learning" core

Implement exactly this (or an equivalent stated with equations), per (profile, device, montage, feature):

- **Feature space:** log band powers, ln RMSSD, HR in bpm. Work in log space for powers.
- **Update weight:** w = dt, where dt is the **hop length of new clean time**, multiplied by the window clean fraction. Never use the window length. Use a **clean-time clock**: gaps and masked time add nothing and age nothing.
- **Robust update:**
  - Winsorize x to μ ± 3·σ_robust (σ from MAD·1.4826 of the profile histogram) before updating. During cold start (under 60 s of personal data), use the prior σ.
  - **Anti-stall:** if more than 60 s in a row is clipped, hand it to change detection instead of freezing.
- **Lifetime tier (scoring):** weighted Welford/West: `W' = W + w; δ = x − m; m' = m + (w/W')δ; S' = S + wδ(x − m')`. This is Julian's formula `m' = (T·m + dt·x)/(T + dt)` with variance added. **Cap W at T_cap = 10 h** of clean data; beyond that it acts as an EMA with τ = T_cap, so slow drift over weeks is tracked. Apply a mild per-session forgetting factor of 0.98 at session commit.
- **Population prior:** normal-inverse-gamma with pseudo-time T0 = 2 min:
  - κ0 = T0/τc with τc ≈ 10 s (the autocorrelation-honest unit), so personal data has 50% weight after 2 min and 90% after about 18 min.
  - Prior values ship in `engine/priors.json`, per device/montage. Initial values come from the literature-free defaults in R6-R8. They are rebuilt from Julian's validation recording by R14, since literature units don't transfer.
  - Use the posterior predictive (Student-t) for z.
- **Within-session offset:** a location offset tracked with τ = 90 min for focus, 45 min for stress, none for drowsiness, clamped to ±0.5σ. This handles day-to-day state without absorbing a sustained focused or stressed stretch.
- **Fast tier:** τ = 5 min, **used only for change detection**, never for scoring.
- **Contact epochs and re-seat handling:**
  - A new epoch starts on connect, on a gap over 5 s, or when ≥2 of these fire:
    - broadband log-RMS step over 3 MAD sustained for 5 s;
    - line-noise ratio jump;
    - spectral-shape distance above the epoch's 99th percentile;
    - (Cyton) Riemannian AIRM distance of the covariance above the 99th percentile;
    - CUSUM on 20 s block means (k = 0.5, h = 5 σ) firing on most channels.
  - On a new epoch: keep σ, re-anchor the location from the first 2 min of clean data (shrunk toward the old location), and don't merge into the lifetime tier until 5 clean minutes are in.
  - Down-weight w × 0.25 for the first 10 min of each epoch (dry-contact settling).
- **Score mapping:** `z = (x − μ − offset)/σ` (Student-t predictive), then `score = 100/(1 + exp(−1.7·z))`. So 50 = usual for you, about 88 = +2σ. Never use min-max. An optional percentile view comes from a decaying log-histogram (about 200 bins over 6 decades, mergeable, about 2 KB per feature).
- **Confidence badge**, from personal clean minutes on this device and montage:

  | Personal clean data | Badge |
  |---|---|
  | under 3 min | Population norms |
  | 3-15 min | Learning you (n min) |
  | 15-60 min | Personal, medium |
  | over 60 min or 3+ sessions | Personal, high |

  The confidence scales `conf` in the output.
- **Storage:** localStorage key `museengine.profiles.v1`, with schemaVersion, wrapped in try/catch, plus an Export/Import JSON button. Store per-session summaries, not raw data, so relabels and merges can rebuild exactly.
- **Required tests:** the 14-test suite in R15 (batch equality, gap invariance, overlap invariance, step absorption, slow drift, artifact injection, stall rule, prior blending, changepoint false alarms and detection delay, cross-session stability, serialization round-trip, score monotonicity, quantile accuracy).

### R11. Hold + fade output

- Each metric keeps its last clean value.
- While masked or held: `state = held`, and `conf` decays linearly to 0 over **3 s**. After 3 s: `state = stale`, `value = null`, UI shows `--` and the reason (`movement`, `muscle`, `blink`, `no contact`, `no ECG`, `signal lost`).
- The game link sends `null` plus state (never a fake number).
- The bomb game and Mario Kart keep their existing "hold last input" behaviour on null.

### R12. Person auto-detection (`engine/identity.js`)

- **Gathering:** buffer the first 45-60 s of clean, motion-free windows after contact is good. **Don't update any profile until identity is confident.** While uncertain, score with **population priors** (not Julian's stats).
- **Features:**
  - EEG: log-PSD 2-40 Hz on a 1 Hz grid per channel, IAF, aperiodic exponent/offset (simple log-log fit 3-40 Hz excluding 7-14 Hz). On Cyton, weight P7/P8/O1/O2; on Muse, weight TP9/TP10.
  - Cyton: rate-normalized averaged ECG beat template (resample each beat to 100 points, then average). This should dominate.
  - Weak tie-breakers: resting HR, per-channel contact pattern, accel resting orientation.
  - Per-device templates only.
- **Matching:** per profile, keep a running mean and shrinkage covariance of the feature vector. Use a Gaussian log-likelihood summed across modalities, then a posterior over {profiles…, new person} with an owner base-rate prior of 0.7 (configurable).
  - Accept if posterior ≥ 0.8 and the margin over the runner-up is ≥ 0.2, sustained over 2 consecutive 15 s windows.
  - If below for every profile: create `Guest N` from population priors.
  - Otherwise: `uncertain`, and keep buffering up to 3 min, then fall back to `Guest`.
- **UI:** a header badge "Looks like Julian (82%) ✓ ✗".
  - ✗ opens a list (profiles plus "new guest").
  - A correction relabels the whole session and rebuilds the affected profiles from stored session summaries.
  - Also: rename, merge, and delete ("forget me") per profile.
- The owner profile is created on first ever run, labelled "Julian" (editable).
- **Privacy:** templates and summaries are local only. They are never sent over the game link or anywhere else. Say this in the README.

### R13. UI changes (all three looks: cosmic, clean, neon)

- Device selector (Muse / Cyton).
- New/Legacy switch. It replaces the FOCUS/STRESS switch's role. Keep the FOCUS/STRESS display switch for Muse; for Cyton add DROWSY.
- Each meter shows: the value or `--`, the state chip (LIVE / HELD · reason / LEARNING / --), the confidence badge, and a short honest note.
  - STRESS note: "measures arousal".
  - Muse focus note: "4 sensors: weaker".
- **Cyton panel section:**
  - 16-channel contact grid using 10-20 names.
  - ECG status (bpm, SQI, "place pads" help).
  - Helper status, link type, rate and loss %.
  - "Check contact" button (impedance sweep).
  - Button-event flashes (double blink / clench).
- The stress card from `stress.js` is replaced by engine output when New is selected. Legacy shows the old card.
- The floating PiP meter shows the selected metric.
- The current 10 s "Auto Set Baselines" button stays only in Legacy mode. New mode has no calibration button: just the profile badge and confidence.
- Check layout at 14-inch laptop size in all looks. Use the existing CSS structure (`panel/ui.css`, `focus/focus-switch.css`).

### R14. Validation recording and automatic tuning (Julian runs it later, alone, with no agent)

- **`validation.html`:** a guided ~25 min protocol page with on-screen cues, an audio beep at each change, and automatic CSV + event-marker JSON saving. Blocks, each with markers:
  1. eyes-open rest 2 min
  2. eyes-closed rest 1 min
  3. 2-back task 3 min (built into the page)
  4. mental arithmetic with time pressure 2 min
  5. rest 1 min
  6. deliberate artifacts, each 20 times with countdown cues: single blink, double blink, jaw-clench tap, sustained clench 3 s, frown, talking (read text aloud 60 s), chewing 30 s, head turns L/R, nods, stand up and sit down ×3, typing nonsense on the keyboard 60 s without thinking hard
  7. 5 min of the actual Mario Kart game
  8. 5 min boring fixation (drowsiness trend)
- Works for both devices. Cyton also records ECG.
- **`tools/autotune.py`** (NumPy/SciPy only, plus optional `meegkit` to compare ASR): reads the recording and produces `engine/tuned.json`, which the engine loads automatically when present.
  - Contents: detector thresholds, focus weights (bounded), NLMS on/off, ASR k, and priors.
  - Also produces `docs/validation-report.md` with pass/fail per criterion.
- **Acceptance criteria** (state them in the report):
  - **Artifact immunity:** in each artifact block, the median absolute change of focus/stress vs the surrounding rest is under 5 points, and the score is masked/held for at least 80% of artifact time.
  - **Focus:** 2-back and arithmetic vs eyes-open rest, within-person effect size d ≥ 0.5.
  - **Stress:** arithmetic vs rest, HR rise detected and score difference d ≥ 0.5.
  - **Buttons:** TPR ≥ 90%; false positives ≤ 1 per 5 min in the talking, typing and game blocks.
  - **Drowsiness:** non-decreasing trend in the fixation block, and no rise in the eyes-closed block from alpha alone.
  - **Valid-time fraction** reported per block.
- **`workflows/validate_focus_stress.md`:** an SOP for Julian (how to wear, how to run, what to do with the report). Creating this workflow file is part of this request.

### R15. Tests (all plain Node or plain Python, all must pass before finishing)

- `engine/*.test.js` for every module:
  - **Synthetic fixtures** (seeded): EEG pink noise plus alpha/theta modulation, injected blinks/EMG/motion/pops/gaps, ECG at 125/250/500 Hz with known RR series.
  - **Detector tests:** the right event type, onset within 100 ms, no events on clean data over 10 min of synthetic signal.
  - **Masking tests:** an injected EMG burst does not move focus by more than 2 points.
  - **ECG tests:** RMSSD error under 3 ms at 125 Hz with refinement on synthetic RR; correct handling of missed and extra beats.
  - **Normalization:** the 14 tests listed in R10, with numeric pass criteria.
  - **Identity:** synthetic people separable; open-set guest creation; no profile update before confidence.
  - **Hold/fade:** a state machine timing test.
  - **Game-link:** JSON schema and backward compatibility. Old fields are unchanged; `link.py` accepts larger bodies (raise the cap to 8 KB).
- **Replay harness** `tools/replay.js`: feeds an existing panel CSV through the engine headless and prints summary stats. Any CSVs in `.tmp/` or the Downloads folder are optional inputs; the harness works without them.
- **Helper tests:** `python tools/test_cyton_helper.py` runs on `--simulate`. It covers frame encoding/decoding, rate selection logic, ECG channel auto-detect, and reconnect.
- **Existing tests still pass:** `arousal`, `stress`, `motion`, `bomb`, `mkds`, `focus/experimental`, and `game-py/test_mkds.py`.
- **Optional dataset tests** run only if `.tmp/datasets/<name>` exists. `tools/get_datasets.py` downloads the open ones (skip any needing registration; print instructions).

### R16. Game link and games

- **Panel → `127.0.0.1:8765`.** Add fields while keeping the old ones:
  `{focus, mode, sensors, motion, stale, v:2, device, profile:{label, conf}, metrics:{focus:{value, conf, state}, stress:{...}, drowsiness:{...}|null}, events:[{type, t, conf}] (since last post), legacy:{focus, stress}}`.
  - `focus` stays the focus number the games already use (the new engine when New is selected).
  - Events are never dropped between posts: queue them until acknowledged.
- **`game-py/link.py`:** parse and expose the new fields (`link.metrics`, `link.events` queue). Mario Kart (Python and JS) and the bomb game receive them through `GameMenu ctx` (add `metrics()`, `events()`). **No gameplay changes** beyond focus/stress now coming from the new engine. Test that the bomb game's stress source uses the engine value and handles null.

### R17. Docs and notes

- Update `README.md`, `docs/DETAILED_README.md`, `docs/focus-correction-plan.md` (mark superseded), and `focus/README.md`.
- New: `tools/README.md` (helper, frame format, autotune, replay, datasets) and `docs/IMPLEMENTATION_NOTES.md` (every judgement call made, every hardware assumption and its runtime check, known limits).
- **Honest-limits section**, in README and UI help:
  - Scores are within-person relative indices.
  - Focus and stress are not validated measures.
  - Muse focus is weak.
  - Stress = arousal.
  - Movement, talking and muscle windows are held, not measured.
  - Person detection on Muse is unreliable, so use ✗ to correct.
  - The WiFi Shield is deprecated by OpenBCI; use the dongle if data drops.

---

## 5. Things the implementer can't verify without hardware: required runtime handling (copy into the prompt)

| Unknown | Runtime check | Fallback |
|---|---|---|
| WiFi per-channel rate with Daisy | measure from timestamps | assume 125 Hz, adapt bands |
| BrainFlow accel channels on WiFi board | `get_accel_channels` try/except, data non-zero | EEG motion proxy (R4) |
| Ultracortex channel mapping | default map; sanity checks (Fp1/Fp2 show blinks; O1/O2 posterior alpha) logged | keep default, warn in panel |
| ECG channel / polarity | kurtosis + periodicity detect; auto-flip | stress without ECG, panel says "no ECG" |
| 120 Hz → 5 Hz alias | helper self-test | warn; theta features down-weighted (conf ×0.7) |
| FTDI latency on dongle | arrival burst spacing | warn with fix text |
| ASR benefit at 4 ch / dry | autotune report | defaults: ASR on for Cyton only |
| Real artifact amplitudes on dry combs | passive running stats with priors | population floors stated in R4 |

---

## 6. Order of work to put in the prompt (implementer follows it; each step ends with its tests green and a commit)

1. Branch; read listed files; write `docs/IMPLEMENTATION_NOTES.md` skeleton.
2. `engine/` skeleton, common frame format, Muse adapter tap, replay harness.
3. Python helper with `--simulate`, WebSocket frame format, Cyton adapter, device selector.
4. Preprocessing and contact quality.
5. Event detector plus masking.
6. Normalization (R10) with its full test suite.
7. Focus, stress (ECG + PPG), drowsiness, buttons.
8. Hold/fade output, engine-link, UI in three looks, Legacy switch.
9. Identity and profiles.
10. Game link v2, `link.py`, menu ctx, bomb and Mario Kart plumbing.
11. ASR and NLMS (flags), `validation.html`, `autotune.py`, `get_datasets.py`.
12. Full test run (new and old). Docs. Final checklist report in `docs/IMPLEMENTATION_NOTES.md`.

---

## 7. Fable: final reminders for the prompt you write

- One prompt and no follow-ups. In-depth implementation detail everywhere.
- All decisions above are made. Never defer to Julian. Where you improve a number, justify it in the prompt.
- Tell the implementer: no questions, no partial hand-backs, no stopping until the completion checklist is fully met. Log judgement calls in `docs/IMPLEMENTATION_NOTES.md` and keep going.
- Everything must run and be tested without the headsets connected.


---

# PART 2: RESEARCH APPENDIX

# Research appendix (evidence behind the requests)

Gathered 2026-11-13 by 15 parallel research agents (Sonnet and Haiku). Tags:
- **[V]** = seen in a fetched page, abstract or search excerpt.
- **[M]** = agent memory or derivation, unverified.

Most items come from abstracts or excerpts, not full texts. Use the numbers as justified defaults, not as facts to cite.

---

## A. Muscle, eye and motion artifacts

**Muscle (EMG)**
- **Whitham et al. 2007**, Clin Neurophysiol 118:1877 [V]: under neuromuscular paralysis, scalp power above 20 Hz fell 10-200×, so most scalp EEG above 20 Hz is EMG. https://pubmed.ncbi.nlm.nih.gov/17574912
- **Whitham 2008**, "Thinking activates EMG" [V]: gamma is maximal near cranial and cervical muscles. https://dx.doi.org/10.1016/j.clinph.2008.01.024
- **Goncharova et al. 2003**, Clin Neurophysiol 114:1580 [V]: frontalis EMG peaks around 20-30 Hz frontally and temporalis around 40-80 Hz temporally. Even weak contraction mimics alpha, mu and beta over the whole scalp. https://www.neurotechcenter.org/sites/default/files/misc/EMG%20contamination%20of%20EEG%20spectral%20and%20topographical%20characteristics.pdf
- **Muthukumaraswamy 2013**, Front Hum Neurosci 7:138 [V]: EMG spans about 20-300 Hz, even "clean" resting EEG is contaminated, and frontal-temporal sites are worst. https://www.frontiersin.org/articles/10.3389/fnhum.2013.00138
- **Fitzgibbon 2013** [V]: a Laplacian reduces EMG at central sites, but needs many electrodes.
- **Conclusion:** no filter separates EMG from beta. Prefer theta, alpha and low beta (13-20 Hz), detect EMG and gate it. Don't regress muscle out using temporal channels: they contain brain signal too. TP9/TP10 as an EMG reference is not validated.

**Artifact subspace reconstruction (ASR)**
- **Basics** (Mullen 2015; Chang et al. 2020, IEEE TBME 67(4):1114) [V]: works on 500 ms chunks. Optimal cutoff k=20-30 in driving data. A walking study (n=5, PMC7560919) matched manual cleaning at k=7-14. https://pmc.ncbi.nlm.nih.gov/articles/PMC7560919
- **Low-density ASR** (IEEE Sensors J 2022) [V]: ASR still beats other multichannel methods down to 4 channels. https://airus.unisalento.it/retrieve/631e692c-03e5-46b4-af8c-b79bf96e0729/A_Method_for_Optimizing_the_Artifact_Subspace_Reconstruction_Performance_in_Low-Density_EEG.pdf
- **Muse 2 with meegkit ASR defaults** (chess study) [V]: feasible, weakly validated. https://arxiv.org/pdf/2505.07592
- **Limit** [M]: ASR handles large transients well and sustained moderate EMG only partly.
- **rASR** (Blum et al. 2019, Front Hum Neurosci 13:141) [V]: Riemannian ASR, 24 channels × 27 subjects, better on blinks and faster. https://www.frontiersin.org/articles/10.3389/fnhum.2019.00141 . MATLAB: https://github.com/s4rify/rASRMatlab (MIT).

**Other cleaning methods**
- **ORICA** (Hsu et al. 2016, IEEE TNSRE 24:309) [V]: online ICA, needs high density. ICA is not usable with 4 channels. https://pmc.ncbi.nlm.nih.gov/articles/PMC4824543
- **iCanClean** (Downey & Ferris 2023, Sensors 23:8214) [V]: phantom data quality went from 15.7% to 55.9%, vs ASR 27.6%, Auto-CCA 27.2%, adaptive filtering 32.9%. Best walking setting: 4 s window, r²=0.65. MATLAB only. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10574843/ . Ledwidge 2025 (running): somewhat better than ASR. https://pmc.ncbi.nlm.nih.gov/articles/PMC12349273
- **Accelerometer NLMS** (Rosanne et al. 2021, Front Neurosci 15:611962) [V]: n=48, 8 dry channels, 500 taps, chest accelerometer at 50 Hz using the L2 norm. Workload accuracy went from 89.2% to 95.0% at low activity and from 88.9% to 91.2% at high activity. Hyperparameters were tuned on all subjects, so the result may be inflated. https://pmc.ncbi.nlm.nih.gov/articles/PMC8058356
- **Kilicarslan & Contreras-Vidal**: 2016 H-infinity filter for ocular artifacts; 2019 motion removal using infrared tracking, not an accelerometer [V].
- **Wavelet denoising**: BrainFlow `perform_wavelet_denoising` (bior3.9, level 3) [V]. Good for spikes and blinks, not broadband EMG. https://brainflow.readthedocs.io/en/stable/notebooks/denoising.html
- **Deep denoisers** (1D-ResCNN, EEGDNet, IC-U-Net): not verifiable, offline, trained on semi-synthetic EEGdenoiseNet data. Unsuitable.
- **Aperiodic slope / specparam** [V]: the 30-45 Hz slope is biased by EMG, ECG and the reference, and fits fail often with eyes open (eNeuro 2022). https://www.eneuro.org/content/9/5/ENEURO.0094-22.2022

**Motion**
- Walking artifacts sit mostly below 10 Hz, at step harmonics, spanning about 0.1-20 Hz, and exceed EEG on dry systems [V].
- Head turns, talking and frowning produce EMG plus electrode shifts. An accelerometer reference does not fix EMG, so gating is unavoidable.
- Dry electrodes show large motion artifacts during walking and running (Luu et al. 2024, IEEE TIM, n=8) [M].

**Blinks** [M]: 100-200 µV, mostly below 4 Hz, frontal. Saccades are steps with opposite polarity between AF7 and AF8. With 4 channels, rejecting or holding for 0.5-1 s is safer than regression.

**Tools**
- No JavaScript ASR exists. Port from asrpy (https://github.com/DiGyt/asrpy, BSD-3 per PyPI; check the LICENSE file) or meegkit (https://github.com/nbara/python-meegkit).
- Timeflux has an rASR plugin (https://github.com/timeflux/timeflux_rasr).

## B. Focus, attention and workload

**Theta/beta ratio**
- Arns, Conners & Kraemer 2013 meta-analysis (9 studies, 1253 ADHD vs 517 controls) [V]: not reliable.
- Strzelczyk et al. 2026, eLife multiverse analysis [V]: reported TBR effects are driven by aperiodic activity and individual alpha frequency (IAF). https://elifesciences.org/articles/111114

**Indices with better support**
- **Pope, Bogart & Bartolome 1995**, Biol Psychol 40:187 [V]: β/(α+θ) was the best of 4 indices for flight-deck engagement. It is beta-heavy. https://ntrs.nasa.gov/citations/20050000198
- **Gevins 1997**, Cereb Cortex 7:374 (n=8, 115 ch) [V]: frontal midline theta rises with load (anterior cingulate), and slow parietocentral alpha falls. https://pubmed.ncbi.nlm.nih.gov/9177767/
- **Onton, Delorme & Makeig 2005**, NeuroImage 27:341 (71 ch, ICA) [V]: the theta source is near dorsal anterior cingulate; the effect comes from a fraction of trials with large variance. This is a source-level finding. https://sccn.ucsd.edu/papers/OntonTheta05.pdf
- **Workload meta-analysis** (Psychophysiology 2022) [V]: frontal theta is the most consistent workload index, with heterogeneity. https://hal-cea.archives-ouvertes.fr/ACHIL/hal-03556815v1
- **2025 review** [V]: the theta/alpha ratio tracks load, but is not reliable across task types. https://public-pages-files-2025.frontiersin.org/journals/neuroergonomics/articles/10.3389/fnrgo.2025.1621309/pdf

**Cross-session and cross-subject decoding**
- **Passive BCI competition**, Roy et al. 2022 (MATB-II, 15 subjects, 3 sessions) [V]: best entries Riemannian, cross-session accuracy under 60% vs 38% chance. https://www.frontiersin.org/articles/10.3389/fnrgo.2022.838342
- **Strict leave-one-subject-out benchmark** (N-back + MATB): 0.449 balanced accuracy [V].
- **Domain adaptation**: about +3-7% [V].

**Re-centering and alignment**
- Zanini 2018, TBME 65:1107 (re-centering) [V]: https://hal.archives-ouvertes.fr/hal-01923278
- He & Wu 2019 (Euclidean alignment) [V]: https://arxiv.org/abs/1808.05464
- Bleuzé 2022 (18 databases, 349 subjects; +2.7% vs RPA) [V]: https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2022.1049985/pdf

**Foundation models** (CBraMod ICLR 2025, LaBraM, EEGPT) [V]: pretrained on clinical wet caps, need labeled fine-tuning, no browser deployment. Not for the live score.

**OpenBCI hardware validity**
- Frey 2016 (arXiv 1606.02438) [V]: OpenBCI 16 ch at 125 Hz with **wet** electrodes. Workload AUROC 0.853 vs g.USBamp 0.860 (not significant). P300 0.918 vs 0.961 (p<0.01). https://arxiv.org/html/1606.02438
- No peer-reviewed validation of Ultracortex dry combs exists [V: absent].

**Consumer focus scores** (none published as validated)
- OpenBCI GUI focus widget [V, partial]: high alpha (7.5-12.5 Hz) with low beta reads as focused, a threshold rule. https://openbci.com/community/using-openbci-guis-focus-widget-to-harness-alpha-and-beta-waves/
- Neurosity: beta/theta over frontal channels [V, marketing].
- BrainFlow MLModel built-in models: trained on the developers' own data [V].

**Minimum baseline** [M]: 10 s is marginal. Alpha is usable at 20-30 s. Use median/MAD, not mean/SD.

## C. Stress (arousal)

**Heart rate and HRV windows**
- HR is the most consistent acute-stress marker. RMSSD and HF fall under stress (Castaldo 2015 meta-analysis: 12 studies, 758 people) [V]. https://wrap.warwick.ac.uk/69425/
- **Muñoz 2015**, PLoS ONE (n=3387, ECG) [V]: a 10 s RMSSD gives r≈0.85 vs 5 min, three 10 s windows r≈0.94, and 120 s r=0.986. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4586373/
- **Esco & Flatt 2014** [V]: 60 s ICC 0.98, 10 s ICC 0.81. https://www.jssm.org/jssm-13-535.xml-abst
- **Baek 2015** [V]: RMSSD needs at least 30 s, and HF is unreliable under 1 min. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5998753/
- **Castaldo 2019** (exam vs rest, n=42) [V]: HR-based features held down to 1 min. https://wrap.warwick.ac.uk/112982/
- **Shaffer & Ginsberg 2017** [M]: 5 min is the standard; ultra-short HRV is exploratory.

**Typical sizes** [M]: mental arithmetic or Stroop gives HR +3-10 bpm and RMSSD −10-30%. TSST gives HR +10-20 bpm and RMSSD −20-40%. The current +40 bpm and ×0.5 references are too extreme.

**Gaming**
- A VR, FIFA and iRacing study [V]: all raised HR and lowered RMSSD/HF. https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2024.1380903/pdf
- Seated gaming is about +3-10 bpm; movement can add 10-30 bpm [M]. Gate on the accelerometer.

**EEG stress**
- Frontal alpha asymmetry is weak as a state marker (Smith 2017; van der Vinne 2017) [M].
- SAM40 (Ghosh 2022, 40 subjects, 32 ch Emotiv) [V]: claims of about 99% are inflated by within-subject splits; with subject-grouped splits, chance to about 85% (unreviewed preprint). https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8749216/
- Models may learn eye and muscle signatures (Front Hum Neurosci 2025 ear-EEG) [V]. https://www.frontiersin.org/articles/10.3389/fnhum.2025.1685087
- WESAD with chest physiology reaches about 93% binary [M].

**Muse 2 PPG** (2026 preprint vs Polar H10, n=28 seated) [V]: HR ICC ≥0.999 with bias around 0. RMSSD ICC 0.60, bias +19 ms (about 1.9×), higher in at least 27 of 28 sessions. https://sciety.org/articles/activity/10.64898/2026.10.05.26364782

**PPG in general**
- Pulse-rate variability is not HRV: about 3-4 ms RMSSD difference, n=931 [V]. https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2025.1630032/text
- Errors are 14-51% higher during activity (Rehman 2024, n=25) [V].

**Commercial stress scores**
- Garmin/Firstbeat: fixed HRV bands 0-25/26-50/51-75/76-100, from inactive periods only [V].
- WHOOP: 14-day personal baseline [V].
- Oura: daily recalibrated personal baseline [V].
- Fitbit: baseline built over the first month [V].
- None publish validation.

## D. OpenBCI Cyton, Daisy and WiFi Shield

**Data format and scaling** (https://docs.openbci.com/Cyton/CytonDataFormat/ and https://docs.openbci.com/Cyton/CytonSDK/)
- 250 packets/s over the radio [V]. With Daisy, odd packets are channels 1-8 and even packets are 9-16. Each value is the average of the current and previous sample, and the first sample is invalid.
- 33-byte packet: `0xA0`, sample counter (wraps at 255), 8×24-bit signed MSB-first, 6 aux bytes, footer `0xC0-0xC6` (C0 = accelerometer, C1 = raw aux, C3/C4 and C5/C6 time-stamped after `<`) [V].
- Scale: 4.5 V / gain / (2^23−1). Gain codes 0..6 = 1, 2, 4, 6, 8, 12, 24 (default 24) [V].
- LIS3DH accelerometer: about 25 Hz interlaced with time-stamping [V]. Which packets carry it in Daisy mode: [M].
- Board modes [V]: `/0` default accelerometer, `/2` analog A5-A7 (replaces the accelerometer), `/3` digital, `/4` marker.

**Dongle**
- FTDI virtual COM port at 115200 baud [M].
- Latency timer must be set to 1 ms (Device Manager → Port Settings → Advanced) [V]. https://docs.openbci.com/Troubleshooting/FTDI_Fix_Windows/
- The `~` sample-rate command is useless over the dongle radio (over 250 Hz isn't carried) [V].

**Commands** [V]
- Channel settings: `x CH PWR GAIN INPUT BIAS SRB2 SRB1 X`. Channels are 1-8 and QWERTYUI for 9-16. Default `060110`. `d` resets to defaults; `D` queries them.
- Lead-off: `z CH P N Z` at 31.5 Hz.
- Streaming: `b`/`s` start/stop, `v` soft reset, `?` registers.
- Daisy: `C`/`c` attach/detach.
- The board times out multi-byte commands after 1 s.

**Impedance**
- Z = (RMS_µV·1e-6·√2)/6e-9 A [V, openbci-stream notebook]. https://openbci-stream.readthedocs.io/en/latest/notebooks/A2-electrodes_impedance.html
- The GUI's exact formula is undocumented (brainflow #765) [V].
- The GUI impedance widget has a bug at ≤500 kΩ [V].

**ECG and EEG on one board** (https://docs.openbci.com/GettingStarted/Biosensing-Setups/ExGSetup and https://docs.openbci.com/GettingStarted/Biosensing-Setups/ECGSetup/)
- EEG on the Cyton, ECG on a Daisy channel. SRB2 ON for EEG, OFF for ECG ("cardiac signals reference themselves"). Gel snap electrodes. BIAS goes to LL, the sternum or RL [V].
- Torso Mason-Likar placement avoids limb muscle artifact; shifts of up to 6 cm had no significant effect [V, preprint].

**HRV sampling rate**
- Task Force 1996: 250-500 Hz is optimal; at least 100 Hz works only with parabolic interpolation [V].
- Ellis 2015: with cubic-spline R-peak refinement, all 24 HRV measures held below 100 Hz [V]. https://smcnus.comp.nus.edu.sg/archive/pdf/2014-2016/2015_HRV.pdf
- Kwon 2018: 100 Hz is acceptable for time-domain HRV; 50 Hz fails for RMSSD [V]. https://pmc.ncbi.nlm.nih.gov/articles/PMC6085204
- Derivation [M]: at 125 Hz without interpolation, RMSSD² gains about 32 ms² (+4% at 20 ms, +15% at 10 ms). With interpolation the error is negligible.

**R-peak detection and quality**
- Elgendi 2013 two moving averages (about 97 ms and 611 ms) [V]. https://pmc.ncbi.nlm.nih.gov/articles/PMC3774726
- Pan-Tompkins was designed for 200 Hz; rescale the 5-15 Hz band, use an integrator of about 150 ms, a 200 ms refractory and a 360 ms T-wave check [V/M].
- NeuroKit2 detectors are available [V].
- Lipponen & Tarvainen 2019 beat correction (96.96% sensitivity, 99.94% specificity for ectopics; Python reference in `systole`) [V]. https://legrandnico.github.io/systole/notebooks/3-DetectingAndCorrectingArtefacts.html
- Kubios median-filter thresholds (medium 0.25 s) [V].
- Quality: Orphanidou 2015 template correlation; Zhao & Zhang 2018 kSQI (about 5 or more = clean) [V].

**Ultracortex Mark IV 16-ch** [V] (https://docs.openbci.com/AddOns/Headwear/MarkIV/)
- Cyton 1-8 = Fp1 Fp2 C3 C4 P7 P8 O1 O2. Daisy 9-16 = F7 F8 F3 F4 T7 T8 P3 P4 (the Daisy order is inferred).
- 14 spiky and 2 flat electrodes. SRB earclip with a Y-splitter; BIAS on the other ear.
- No dry-comb impedance figures are published.
- Gel-free cap target: under 20 kΩ.

**WiFi Shield**
- Deprecated: "no longer offered for sale due to reliability issues", packet loss and "cyclical noise spikes", "proceed at your own risk" [V]. https://docs.openbci.com/Deprecated/WiFiShield/WiFiLanding/ and https://docs.openbci.com/Deprecated/WiFiShield/WiFiGS/
- Daisy rates 250 to 8000 Hz; default 1000 Hz with 10 ms latency [V].
- Direct AP mode at 192.168.4.1, or station mode. No WPA2-Enterprise [V].
- Pushes TCP (raw or JSON); UDP and UDPx3 also offered [V].
- Losses of 50-60 packets about once a minute at 1000 Hz × 16 ch [V]. https://github.com/OpenBCI/OpenBCI_WIFI/issues/82
- Latest firmware v2.0.5 [V].
- BrainFlow `CYTON_DAISY_WIFI_BOARD` (id 6): `ip_port` required, `ip_address` optional (SSDP otherwise), `timeout` 10 s [V]. https://brainflow.readthedocs.io/en/stable/SupportedBoards.html
- Accelerometer channels over WiFi in BrainFlow: unverified.
- `~4` = 1000 Hz mapping for Daisy: unverified.

**Browser access**
- Web Serial is stable since Chrome 89. Using it with the dongle is plausible but untested.
- `@openbci/cyton` is Node-only and `openbci-utilities` is deprecated [V].
- A browser can't receive a TCP push, so a local helper is required [M].
- BrainFlow WASM is unconfirmed [V].

**Aliasing** [M, derivation]: at 125 Hz per channel, a residual 120 Hz harmonic folds to 5 Hz. The ADS1299 sinc filter and pair averaging attenuate it, but this must be verified.

## E. Drowsiness

- **Jap et al. 2009**, Expert Syst Appl 36:2352 (n=52) [V]: all ratios rise over a monotonous drive; (θ+α)/β rises most. https://opus.cloud1.lib.uts.edu.au/handle/10453/8938
- **Lal & Craig 2001** review [V]: delta and theta rise with fatigue. https://opus.lib.uts.edu.au/handle/10453/5537
- **Simulated-driving review** [V]: occipital alpha up (51.7% of studies), frontal theta up, inconsistent overall. https://pmc.ncbi.nlm.nih.gov/articles/PMC8198610
- **Simon 2011**, Clin Neurophysiol 122:1168 [V]: alpha spindles beat alpha band power in real traffic.
- **Schleicher 2008**, Ergonomics 51:982 [V]: blink duration, blink interval, lid-reopening delay and closure speed are the best sleepiness indicators. Large individual differences. https://www.ingentaconnect.com/content/10.1080/00140130701817062
- **Blink-duration thresholds** [V]: normal blinks are about 190-270 ms; a blink over 500 ms is a drowsy marker in a wearable study.
- **EEG/EOG fusion** beats PERCLOS alone [V]. https://pmc.ncbi.nlm.nih.gov/articles/PMC4786962
- **Muse drowsiness** review [V, not opened]: temporal features beat frontal; best case 98.8%. https://pmc.ncbi.nlm.nih.gov/articles/PMC9164820
- **Normalization**: deviation from an "alert model" (EURASIP 2008) [V]. https://asp-eurasipjournals.springeropen.com/track/pdf/10.1155/2008/519480 . Caveat: someone already drowsy at the start hides it.

## F. Blink and clench buttons

**Blinks**
- **Kaneko & Sakamoto 1999** [V]: spontaneous blinks have smaller EOG amplitude than voluntary ones; EOG duration did not differ significantly. https://journals.sagepub.com/doi/ref/10.2466/pms.1999.88.3.1037
- **Abe 2014** (camera) [V]: voluntary blinks about 421-480 ms vs involuntary about 297-352 ms.
- **Nakanishi 2014** EOG voluntary-blink switch [V]: 97.28% with template correlation. https://www.jstage.jst.go.jp/article/ieejeiss/134/7/134_897/_article/-char/en
- **EEG headsets** [V]: 85.9% vs 99.3% for infrared oculography; about 88% from Fp1 with adaptive thresholds. https://isip.piconepress.com/conferences/ieee_spmb/2022/papers/l01_03.pdf
- No double-blink false-positive rates for a consumer headset exist.

**Jaw clench**
- Masseter EMG near 50-60 Hz, frontalis 30-40 Hz, temporal 40-80 Hz [V].
- EarEOG [V]: 94.1% (97.3% personalized) for clench and eye gestures, under 125 ms delay. https://www.yorku.ca/mack/etra2025.html
- Muse built-in blink and jaw_clench flags (Mind Monitor OSC `/muse/elements/blink`, `/muse/elements/jaw_clench`): no published method or accuracy [V].
- NeuroSkill (third-party) [V]: jaw clench on TP9/TP10, blinks on AF8. https://cdn.jsdelivr.net/npm/neuroloop@0.1.2/METRICS.md

**Design** [M]
- **Blink detector:** derivative plus amplitude on a 1-10 Hz frontal signal, with a 150-250 ms refractory.
- **Double blink:** 150-500 ms gap.
- **Passive tuning:** from spontaneous blinks, about 7-10 per 30 s, using median + 3·MAD with a 1.5×-median floor.
- **Clench detector:** 25-55 Hz envelope at ≥3× baseline for 100-200 ms, bilateral.
- **Rejections:** reject a chew (more than 2 bursts in 1.5 s) or a burst shorter than 100 ms. A deliberate clench is a single burst of 0.2-0.6 s.

## G. Self-calibrating normalization

**Literature**
- **Shenoy 2006** [V]: nonstationarity is real, and simple adaptive methods help. https://pure.korea.ac.kr/en/publications/towards-adaptive-classification-for-bci/
- **Vidaurre 2011** [V]: unsupervised adaptation, good performance after 3-6 min with no offline calibration. Adapting bias/mean is safer than adapting the full classifier [M]. https://scienceportal.tecnalia.com/en/publications/toward-unsupervised-adaptation-of-lda-for-brain-computer-interfac/
- **Schirrmeister 2017** [V]: exponential moving standardization (decay 0.999). https://arxiv.org/pdf/1703.05051
- **Adaptive neurofeedback thresholds** (about 60-80% reward) [V]: useful for engagement, a poor state measure, and sometimes "little better than sham".
- **Nam & Choi 2020** [V]: easier initial thresholds work better. https://neuroregulation.org/article/view/20383
- **Fazli 2009** [V]: subject-independent BCI with moderate loss. https://proceedings.neurips.cc/paper/2009/hash/8a1e808b55fde9455cb3d8857ed88389-Abstract.html
- **Hierarchical Bayesian priors** (EUSIPCO 2022) [V]. https://eurasip.org/Proceedings/Eusipco/Eusipco2022/pdfs/0001308.pdf

**Absorption maths** [M, derivation]
- Cumulative mean with H minutes of history: a state held T minutes keeps H/(H+T) of its shift.
  - H=10, T=20: 33%
  - H=60: 75%
  - H=600: 97%
- Exponential moving average (τ): a state keeps exp(−T/τ).
  - τ=15 min, T=20 min: 26%
  - τ=30 min: 51%
  - τ=2 h: 85%
- Time for a step change to be 50% absorbed:
  - cumulative: equal to the history length
  - exponential: 0.69τ
  - windowed (length W): W/2

**Estimators** [lit/M]
- **Weighted Welford/West 1979 with w = dt:** W'=W+w; m'=m+(w/W')δ; S'=S+wδ(x−m'). The mean update equals the user's formula.
- **Use the hop length, not the window length**, so overlapping windows aren't counted several times.
- **Clean-time clock:** gaps don't age the estimate.
- **Effective sample size:** n_eff = T/(2τ_int), measured by batch means on 20 s blocks.
- **Normal-inverse-gamma prior:**
  - κn=κ0+W; μn=(κ0μ0+Wx̄)/κn; αn=α0+W/2; βn=β0+S/2+κ0W(x̄−μ0)²/(2κn)
  - Predictive distribution: Student-t.
  - With κ0=T0/τc, personal data gets 50% weight at T0 and 90% at 9·T0.

**Streaming quantiles**
- A log-space histogram (about 200 bins, about 2 KB, mergeable, decays by scaling) beats t-digest (old npm package) and P² (unweighted, can't merge or decay) for this use.

**Robustness**
- Winsorize at ±3-3.5 robust σ, or use Huber weights.
- Anti-stall: if values are clipped for more than 60 s, treat it as a change, not as noise.
- Cold start: use the prior's σ for the first 60 s.

**Change detection**
- CUSUM on 20 s block means (k=0.5, h=4-5).
- Bayesian online changepoint detection (Adams & MacKay 2007) is optional.
- On detection: shrink W ×0.1-0.2 (re-seat) or reset to the prior (new person).

**Proposed per-metric policy** [M]
- Focus: offset τ 60-90 min.
- Stress: offset τ 30-60 min, optional time-of-day bins (HRV is circadian [V]).
- Drowsiness: baseline frozen within the session, merged at session end.
- Offsets clamped to ±0.5σ.
- Down-weight the first 10 min of each contact epoch to 0.25×. Dry-electrode settling is only indirectly evidenced: sweat lowers impedance by up to 25% [V].

**Mapping** [M]
- Logistic of z with slope 1.7 (≈Φ): 50 = usual, 88 = +2σ.
- Avoid min-max.
- Percentiles need at least about 200 independent windows.

**Confidence badges** [M]
- 0-3 min: population norms
- 3-15 min: learning
- 15-60 min: personal, medium
- over 60 min: personal, high

**Offline test suite proposal** [M]: 14 tests.
1. Batch equality to 1e-9.
2. Gap invariance (exact).
3. Overlap invariance (<2% σ).
4. Step absorption (cumulative 45-55% at t=T).
5. Slow drift (<0.3σ error).
6. Artifact injection (<0.05σ shift, and a visible shift without winsorizing).
7. Stall rule (>50% adoption).
8. Prior blending (45-55% personal share at T0; >85% at 9·T0).
9. Changepoint false alarms (<1 per 10 h).
10. Changepoint detection within 3 min for a 1.5σ step.
11. Cross-session order stability (<3 points).
12. Serialization round-trip.
13. Score monotonicity with no NaN.
14. Histogram quantiles within one bin.

## H. Person identification

**EEG**
- Campisi & La Rocca 2014 review [V]. https://iris.uniroma3.it/handle/11590/139954
- Maiorana 2016 (50 subjects, 3 sessions over 6 weeks, "reasonably reliable") [V].
- CEREBRE (100% with ERPs to 500 images; not resting EEG) [V].
- **Large multi-session study** (345 subjects, 6007 sessions) [V]: EER 10.3% at 1 s and 3.0% averaging 4 samples. 6.7% after 1 day, 14.3% after 1 year. Hand-crafted PSD/AR features had 19-29% EER. Parietal-occipital channels were best. https://arxiv.org/html/2501.17866v3
  - Muse-channel subset: 18.2% / 13.1% EER. Cross-device: 12.5-44%.
- **MusicID** (Muse, 20 users) [V]: over 97%, but a small own-lab study. https://arxiv.org/pdf/2006.01751
- **Aperiodic features** beat canonical bands for fingerprinting (Demuru & Fraschini 2020) [V]. https://arxiv.org/pdf/2001.09424
- **Alpha-peak fingerprint stable over months** (MEG) [V]. https://pmc.ncbi.nlm.nih.gov/articles/PMC8481307

**ECG**
- **Melzi et al. benchmark** [V]: PTB multi-session 96.5% identification; 1-lead EER 5.1% multi-session. https://ar5iv.labs.arxiv.org/html/2204.03992
- **Non-fiducial autocorrelation + DCT** (Agrafioti & Hatzinakos) [V]: 96.2%. https://doi.org/10.1155%2F2008%2F148658

**PPG**: reviews flag session-leakage inflation; cross-session EER is about 20% [V]. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12736706/

**Expected accuracy here** [M]

| Setup | Closed-set ID | Open-set EER |
|---|---|---|
| Muse EEG only | about 60-80% | about 20-30% |
| Cyton EEG only | about 70-85% | about 15-25% |
| Cyton EEG + ECG | about 90-97% | about 4-8% |

**Design** [M]
- Buffer 45-60 s of clean data.
- Mahalanobis or diagonal-Gaussian likelihood summed across modalities, then a posterior over the profiles plus "new person".
- Accept at ≥0.8 posterior with a margin over the runner-up.
- No update before identity is confident; use the neutral prior while uncertain.
- One-tap correction relabels the session from stored per-session summaries.
- Templates stay local only.

## I. Public datasets (optional offline tests)

- **COG-BCI** (Hinss 2023, Sci Data, DOI 10.1038/s41597-022-01898-y): 29 participants, 3 sessions, MATB, N-back, PVT and Flanker, with ECG. https://zenodo.org/records/7413650
- **STEW** (14 ch Emotiv, 128 Hz, 48 subjects): rest vs multitasking. https://ieee-dataport.org/open-access/stew-simultaneous-task-eeg-workload-dataset
- **PhysioNet EEGMAT** (36 subjects, rest vs serial subtraction, 500 Hz, ODC-By). https://physionet.org/content/eegmat/
- **SAM40** (40 subjects, 32 ch, 128 Hz; use the raw folder). https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8749216/
- **WESAD** (15 subjects, chest ECG/EDA/EMG/respiration plus wrist E4; TSST). https://archive.ics.uci.edu/dataset/465/wesad
- **EEGdenoiseNet** (4514 clean EEG, 3400 EOG, 5598 EMG segments). https://arxiv.org/pdf/2009.11662
- **Klados semi-simulated EOG** (CC BY). https://data.mendeley.com/datasets/wb6yvr725d/4
- **TUAR** artifact corpus (registration required). https://isip.piconepress.com/projects/tuh_eeg/html/downloads.shtml
- **Mendeley Muse 2** focus/relax/distraction (5 people). https://data.mendeley.com/datasets/g69dctrybk/1
- **Bird et al. Muse mental state** (Kaggle). https://www.kaggle.com/datasets/birdy654/eeg-brainwave-dataset-mental-state
- **Ultracortex MI** with deliberate blinks. https://data.mendeley.com/datasets/rz2jhpvhp3/2
- **Open MoBI** treadmill walking. https://figshare.com/collections/A_mobile_brain-body_imaging_dataset_recorded_during_treadmill_walking_with_a_brain-computer_interface/3894013

## J. Reusable software

| Tool | Notes |
|---|---|
| BrainFlow (MIT) | Board ids, DataFilter (wavelet, rolling filter, band powers), MLModel built-in. https://github.com/brainflow-dev/brainflow |
| NeuroKit2 (MIT) | ECG/PPG/HRV. https://neuropsychology.github.io/NeuroKit/ |
| HeartPy | MIT on the repo, but PyPI 1.1.x is GPL-3.0. |
| systole | Lipponen-Tarvainen beat correction. |
| pyRiemann (BSD-3) | Riemannian methods. |
| MNE-LSL (BSD-3) | Replaces MNE-Realtime. |
| meegkit | ASR, DSS, ZapLine. |
| asrpy | ASR port; not maintained. |
| Timeflux (MIT) + timeflux_rasr | Real-time framework with rASR. |
| JavaScript DSP | fili.js (IIR/FIR/FFT), neurosity/eeg-pipes, WebBCI. |
| Muse JavaScript | muse-js (stale), muse-jsx, web-muse. The panel already has its own BLE code; keep it. |
| OpenViBE (AGPL), BCI2000 (non-commercial), MetaBCI (GPL-2.0) | Reference only. |


---

# PART 3: SOURCE SNAPSHOT (branch mario-kart-focus, commit 7e0af33)

Key files, verbatim. The implementer will have the full repo; use these to name real functions, globals and load order.

## muse-panel.html (script tags only)

```html
7:<script>try{var l=new URLSearchParams(location.search).get("look")||localStorage.getItem("muse2panel.look");document.documentElement.dataset.look=l==="clean"||l==="neon"?l:"cosmic";}catch(e){document.documentElement.dataset.look="cosmic";}</script>
8:<script>try{if(new URLSearchParams(location.search).get("stress")==="1")document.documentElement.classList.add("show-stress");}catch(e){}</script>
107:<script src="game/bomb-logic.js"></script>
108:<script src="game/bomb.js"></script>
109:<script src="game/menu.js"></script>
112:<script src="panel/core.js"></script>
113:<script src="panel/pulse.js"></script>
114:<script src="panel/motion.js"></script>
115:<script src="panel/ui.js"></script>
116:<script src="panel/dsp.js"></script>
117:<script src="panel/ble.js"></script>
118:<script src="panel/focus.js"></script>
119:<script src="focus/focus-switch.js"></script>
120:<script src="panel/recording.js"></script>
121:<script src="panel/gamelink.js"></script>
122:<script src="panel/main.js"></script>
123:<script src="arousal.js"></script>
124:<script src="stress.js"></script>
125:<script src="panel/stress-link.js"></script>
```

## panel/core.js

```js
/* panel/core.js
   Constants, shared state (S), URL options (?demo=1), band filters (biquads). Every other panel file reads these.
   Classic script: shares the page's global scope with the other panel/*.js files (load order is set in muse-panel.html).
   Uses: (nothing: loaded first) */
"use strict";
/* ============ constants ============ */
const FS = 256, PKT = 12;
const SVC = "0000fe8d-0000-1000-8000-00805f9b34fb";
const U = n => "273e" + n + "-4c4d-454d-96be-f03bac821358";
const CTRL = U("0001"), TELE = U("000b");
const EEG = [U("0003"), U("0004"), U("0005"), U("0006")];
const PPG_IR = U("0010"); // pulse sensor, infrared channel (muse-js: 000f ambient, 0010 infrared, 0011 red)
const GYRO = U("0009"), ACC = U("000a"); // motion sensors (muse-js: 0009 gyroscope, 000a accelerometer), 52 Hz, 3 readings per packet
const PPG_FS = 64, PPG_PKT = 6;
const SENSORS = ["TP9","AF7","AF8","TP10"];
const SENSOR_SUB = ["Left ear","Left forehead","Right forehead","Right ear"];
// stage geometry follows the reference picture (1672 x 941)
const BANDS = [
  {key:"delta", name:"Delta", range:[1,4],   color:"#58b4ff", wave:[484,252,510,70], rmsY:312, L:304, mc:325},
  {key:"theta", name:"Theta", range:[4,8],   color:"#d06bff", wave:[484,336,510,69], rmsY:394, L:369, mc:398},
  {key:"alpha", name:"Alpha", range:[8,13],  color:"#35e6ff", wave:[484,421,510,66], rmsY:479, L:443, mc:473},
  {key:"beta",  name:"Beta",  range:[13,30], color:"#a58bff", wave:[484,505,510,65], rmsY:562, L:518, mc:546},
  {key:"gamma", name:"Gamma", range:[30,44], color:"#ff55e6", wave:[484,585,510,62], rmsY:643, L:592, mc:619}
];
const BUF_LEN = FS*4;
const RAW_SCALE = 200;
const params = new URLSearchParams(location.search);
const DEMO = params.get("demo") === "1", DROP = params.get("drop") === "1";
const $ = id => document.getElementById(id);

/* ============ state ============ */
const S = {
  device:null, connected:false, connecting:false, userDisconnected:false, fails:0, everConnected:false,
  maps:[new Map(),new Map(),new Map(),new Map()], seqLast:[null,null,null,null], seqAbs:[0,0,0,0],
  nextIdx:null, maxIdx:-1, alignMode:"seq", qArr:[[],[],[],[]], stall:0, lastEmitted:0,
  emitted:0, lostSamples:0, cnt:0, arrIdx:0,
  hp:[{x:0,y:0},{x:0,y:0},{x:0,y:0},{x:0,y:0}], rms:[null,null,null,null], rmsAcc:[{s:0,n:0},{s:0,n:0},{s:0,n:0},{s:0,n:0}],
  pct:[null,null,null,null], usable:4, artUntil:0,
  raw:[0,1,2,3].map(()=>new Float32Array(BUF_LEN)), rawPos:0,
  rec:null, view:"bands", pip:null, k:1, gapAt:-1e9, holdUntil:0
};
function biquad(f0,Q){return biquadFs(f0,Q,FS);}
function biquadFs(f0,Q,fs){
  const w=2*Math.PI*f0/fs, a=Math.sin(w)/(2*Q), c=Math.cos(w), a0=1+a;
  return {b0:a/a0,b2:-a/a0,a1:-2*c/a0,a2:(1-a)/a0,x1:0,x2:0,y1:0,y2:0,
    p(x){const y=this.b0*x+this.b2*this.x2-this.a1*this.y1-this.a2*this.y2;this.x2=this.x1;this.x1=x;this.y2=this.y1;this.y1=y;return y;}};
}
function makeFilters(b){const f0=Math.sqrt(b.range[0]*b.range[1]),Q=f0/(b.range[1]-b.range[0]);b.f1=biquad(f0,Q);b.f2=biquad(f0,Q);}
BANDS.forEach(b=>{b.buf=new Float32Array(BUF_LEN);b.pos=0;b.gain=1;b.muted=false;b.scale=null;b.energy=0;b.eN=0;b.power=0;b.e2=0;b.n2=0;makeFilters(b);});

```

## panel/dsp.js

```js
/* panel/dsp.js
   Signal path: packet alignment (no interpolation), offset removal, band filtering, sensor contact quality, 1 s status refresh. Julian: put the blink / head-movement filter here (see emit()).
   Classic script: shares the page's global scope with the other panel/*.js files (load order is set in muse-panel.html).
   Uses: core.js, pulse.js, ui.js */
"use strict";
/* ============ stream handling (no interpolation, nothing invented) ============ */
function resetStream(){
  S.maps.forEach(m=>m.clear());S.seqLast=[null,null,null,null];S.seqAbs=[0,0,0,0];S.nextIdx=null;S.maxIdx=-1;
  S.alignMode="seq";S.qArr=[[],[],[],[]];S.stall=0;S.lastEmitted=0;S.emitted=0;S.lostSamples=0;S.cnt=0;S.arrIdx=0;
  S.hp.forEach(h=>{h.x=0;h.y=0;});S.rms=[null,null,null,null];S.pct=[null,null,null,null];S.rmsAcc.forEach(a=>{a.s=0;a.n=0;});
  S.gapAt=-1e9;S.holdUntil=0;
  S.raw.forEach(a=>a.fill(0));S.rawPos=0;BANDS.forEach(b=>{b.buf.fill(0);b.pos=0;b.scale=null;makeFilters(b);});
  ppgFullReset();resetMotion();
}
function handlePacket(ch,seq,vals){
  S.cnt+=vals.length;
  if(S.alignMode==="arrival"){vals.forEach(v=>S.qArr[ch].push(v));while(S.qArr.every(a=>a.length))emit(S.qArr.map(a=>a.shift()),S.arrIdx++);return;}
  if(S.seqLast[ch]==null){S.seqAbs[ch]=seq;}
  else{const d=(seq-S.seqLast[ch])&0xffff;if(d===0)return;S.seqAbs[ch]+=d;}
  S.seqLast[ch]=seq;
  const base=S.seqAbs[ch]*PKT;
  for(let i=0;i<vals.length;i++)S.maps[ch].set(base+i,vals[i]);
  if(base+vals.length-1>S.maxIdx)S.maxIdx=base+vals.length-1;
  if(S.nextIdx==null){
    if(!S.maps.every(m=>m.size>0))return;
    S.nextIdx=Math.max(...S.maps.map(m=>Math.min(...m.keys())));
  }
  for(;;){
    const i=S.nextIdx;
    if(S.maps.every(m=>m.has(i))){const v=S.maps.map(m=>{const x=m.get(i);m.delete(i);return x;});S.nextIdx++;emit(v,i);continue;}
    if(S.maxIdx-i>60){S.maps.forEach(m=>m.delete(i));S.nextIdx++;S.lostSamples++;S.gapAt=S.emitted;continue;} // a packet never arrived: skip it, do not fill it in
    break;
  }
}
function emit(vals,idx){
  S.emitted++;
  const ys=[0,0,0,0];
  for(let c=0;c<4;c++){
    const h=S.hp[c],uv=vals[c],y=uv-h.x+0.995*h.y;h.x=uv;h.y=y;ys[c]=y; // only the constant offset is removed
    S.rmsAcc[c].s+=y*y;S.rmsAcc[c].n++;
    if(Math.abs(y)>300)S.artUntil=Date.now()+1200;
  }
  if(S.emitted<FS*2)return; // first 2 seconds: offset filter still settling, not shown
  for(let c=0;c<4;c++)S.raw[c][S.rawPos]=ys[c];
  S.rawPos=(S.rawPos+1)%BUF_LEN;
  let sum=0,n=0;
  for(let c=0;c<4;c++){const r=S.rms[c];if(r==null||(r>0.5&&r<400)){sum+=ys[c];n++;}}
  S.usable=n;
  const x=n?sum/n:0;
  const bv=[];
  for(const b of BANDS){
    const v=b.f2.p(b.f1.p(x));b.buf[b.pos]=v;b.pos=(b.pos+1)%BUF_LEN;
    b.energy+=v*v;b.eN++;b.e2+=v*v;b.n2++;bv.push(v);
  }
  if(S.emitted>=FS*3&&(S.emitted-FS*2)%64===0)motionStep();
  if(S.rec){S.rec.samples++;recPush(idx,ys,bv);}
}
/* every aligned reading is kept while recording: 4 sensors, 5 band signals, sensors in use, focus */
const REC_COLS=14+MOTION_REC_COLNAMES.length,REC_MAX_SEC=600; // columns 0-13 are the original ones, unchanged; the rest are the motion columns (panel/motion.js)
function recPush(idx,ys,bv){
  const r=S.rec;
  if(r.n>=r.cap){if(!r.full){r.full=true;setTimeout(()=>stopRec(true,"The 10 minute limit was reached."),0);}return;}
  if(r.startIdx==null)r.startIdx=idx;
  const i=r.n++,o=i*REC_COLS;r.t[i]=(idx-r.startIdx)/FS;
  for(let c=0;c<4;c++)r.d[o+c]=ys[c];
  for(let b=0;b<5;b++)r.d[o+4+b]=bv[b];
  r.d[o+9]=S.usable;r.d[o+10]=focus.ema==null?NaN:focus.ema;const p=pctOf(focus);r.d[o+11]=p==null?NaN:p; // always the LEGACY score, whichever is displayed
  r.d[o+12]=PL.bpm==null?NaN:PL.bpm;r.d[o+13]=PL.pct==null?NaN:PL.pct; // heart rate updates once per second
  motionRecFill(r.d,o+14);   // last 3 columns: accelerometer / gyroscope features and the motion gate state (panel/motion.js)
}
const fmt=s=>String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");
function sessMsg(t){const e=$("sessM");e.textContent=t;e.removeAttribute("data-idle");}
function setSess(running){
  if(running){const s=Math.floor((Date.now()-S.rec.t0)/1000);$("sessT").textContent=fmt(s);$("sessN").textContent=S.rec.samples.toLocaleString();sessMsg("Recording. File saves when you stop");}
}
setInterval(()=>{
  SENSORS.forEach((nm,i)=>{
    const a=S.rmsAcc[i],rms=a.n?Math.sqrt(a.s/a.n):0;if(a.n)S.rms[i]=rms;a.s=0;a.n=0;
    let raw;
    if(rms<0.5)raw=0;else if(rms<3)raw=(rms-0.5)/2.5*100;else if(rms<=40)raw=100;else if(rms<200)raw=(200-rms)/160*100;else raw=0;
    S.pct[i]=S.pct[i]==null?raw:S.pct[i]+0.5*(raw-S.pct[i]);
    const el=$("sen"+i),q=el.querySelector(".q");let cls="",txt="--";
    if(S.connected&&S.emitted>0){const p=Math.round(S.pct[i]);txt=p+"%";cls=p>=70?"good":p>=40?"fair":"poor";}
    el.className="sensor "+cls;q.textContent=txt;
    $("rq"+i).textContent=txt;
    $("rr"+i).textContent=S.connected&&S.rms[i]!=null?rms.toFixed(1)+" µV":"--";
  });
  const rate=S.cnt/4;S.cnt=0;
  const tot=S.emitted+S.lostSamples,dp=tot?S.lostSamples/tot*100:0;
  $("rate").textContent=S.connected?(rate>0?"Live data":"Connected, waiting for data"):"";
  $("stRate").textContent=S.connected&&rate>0?Math.round(rate)+" Hz":"-- Hz";
  $("stDrop").textContent=(S.connected&&tot?dp.toFixed(1):"--")+"% lost";
  $("stUse").textContent=(S.connected&&S.emitted>FS*2?S.usable:"-")+"/4 in use";
  if(S.connected&&rate>0){S.stall=S.emitted===S.lastEmitted?S.stall+1:0;S.lastEmitted=S.emitted;
    if(S.stall>=3&&S.alignMode==="seq"){S.alignMode="arrival";S.maps.forEach(m=>m.clear());}}
  BANDS.forEach((b,i)=>{
    b.power=b.eN?Math.sqrt(b.energy/b.eN):0;b.energy=0;b.eN=0;
    $("rd"+i).textContent=S.connected&&S.emitted>FS*2?b.power.toFixed(1)+" µV RMS"+(b.muted?" (muted)":""):"--";
  });
  ppgAnalyse();hrUi();motionUi();
  if(S.rec){
    S.rec.contactN++;for(let c=0;c<4;c++)S.rec.contactSum[c]+=S.pct[c]==null?0:S.pct[c];
    if(Date.now()<S.artUntil)S.rec.artSec++;
    if(S.mot&&S.mot.bad)S.rec.motSec++;
    setSess(true);
  }
},1000);

```

## panel/motion.js

```js
/* panel/motion.js
   Motion gate: reads the Muse 2 accelerometer and gyroscope and decides when head movement makes the EEG untrustworthy.
   This is MEASUREMENT GATING, not artifact removal: while movement is flagged the focus scores stop updating (the last valid value is held and
   marked as held), and they resume after the headband has been still for MOT.STABLE_S. The EEG filters, bands and formulas are not touched.
   The accelerometer cannot see jaw clenching or forehead tension without head movement; those still need the EEG-side checks in focus/.
   Classic script: shares the page's global scope with the other panel/*.js files. Loads before dsp.js (dsp.js calls motionStep()).
   Needs: S, FS, toast (optional), localStorage (optional). Tested by panel/motion.test.js. */
"use strict";
const MOT={
  K_ENTRY:5,K_EXIT:3,        // threshold = baseline median + k x MAD (starting values, tune from recordings)
  STABLE_S:1.5,              // still time required before measurement resumes
  WIN_S:1.0,MARGIN_S:0.25,   // motion window = the 1 s EEG window the focus step just used, plus a margin on each side of the timestamps
  STALE_S:0.5,MIN_SAMPLES:25,// no motion packet for this long, or fewer samples than this in the window = no usable motion data
  PKT_FS:52,                 // Muse accelerometer / gyroscope rate (3 samples per packet)
  CAL_SEC:30,CAL_MIN_KEEP:0.6,CAL_OUT_K:8,
  FLOOR:{acc:0.0015,gyro:0.3},                           // smallest MAD allowed, so a perfectly quiet calibration cannot give a hair-trigger
  DEFAULT:{acc:{entry:0.02,exit:0.01},gyro:{entry:10,exit:5},calibrated:false}, // provisional until the user runs the still calibration
  KEY:"muse2panel.motcal",
  th:null
};
MOT.th=JSON.parse(JSON.stringify(MOT.DEFAULT));
try{const j=JSON.parse(localStorage.getItem(MOT.KEY)||"null");if(j&&j.acc&&j.acc.entry>j.acc.exit&&j.acc.exit>0){MOT.th=j;MOT.th.calibrated=true;}}catch(e){}

function mkMot(){
  return {acc:{t:[],m:[]},gyro:{t:[],m:[]},seq:{acc:null,gyro:null},accSeen:false,gyroSeen:false,
    state:"VALID",stable:0,lastStep:0,status:"UNAVAILABLE",bad:false,
    accRms:NaN,gyroRms:NaN,quality:NaN,lastValidT:-1e9,badSec:0,cal:null,calMsg:""};
}
function resetMotion(){S.mot=mkMot();}
resetMotion();

/* one packet = 3 samples of x/y/z in physical units (g, deg/s). Timestamps are the arrival time spread back over the packet. */
function onMotion(kind,seq,v,now){
  const m=S.mot;if(!m)return;
  if(m.seq[kind]===seq)return;m.seq[kind]=seq;
  now=now==null?Date.now():now;
  const q=m[kind],keep=now-6000;
  for(let k=0;k<3&&3*k+2<v.length;k++){
    q.t.push(now-(2-k)*1000/MOT.PKT_FS);q.m.push(Math.hypot(v[3*k],v[3*k+1],v[3*k+2]));
  }
  while(q.t.length&&q.t[0]<keep){q.t.shift();q.m.shift();}
  if(kind==="acc")m.accSeen=true;else m.gyroSeen=true;
}

/* features over the motion samples that cover the EEG window (by timestamp). null = motion data missing or stale. */
function motionFeatures(now){
  const m=S.mot,lo=now-(MOT.WIN_S+MOT.MARGIN_S)*1000;
  const pick=(q,diff)=>{
    if(!q.t.length||now-q.t[q.t.length-1]>MOT.STALE_S*1000)return null;
    const a=[];for(let i=0;i<q.t.length;i++)if(q.t[i]>=lo)a.push(q.m[i]);
    if(a.length<MOT.MIN_SAMPLES)return null;
    let s=0,n=0;
    if(diff){for(let i=1;i<a.length;i++){const d=a[i]-a[i-1];s+=d*d;n++;}}      // gravity cancels in consecutive differences
    else{for(let i=0;i<a.length;i++){s+=a[i]*a[i];n++;}}
    return Math.sqrt(s/n);
  };
  const acc=pick(m.acc,true);if(acc==null)return null;
  let gyro=null;
  if(m.gyroSeen){gyro=pick(m.gyro,false);if(gyro==null)return null;}              // gyro was streaming and stopped: fail safe
  return {acc,gyro};
}

/* call once per 250 ms focus step, before the focus scores are computed. Sets S.mot.bad / S.mot.status. */
function motionStep(now){
  const m=S.mot;if(!m)return;
  now=now==null?Date.now():now;
  const dt=m.lastStep?Math.min(0.5,(now-m.lastStep)/1000):0.25;m.lastStep=now;
  if(!m.accSeen){m.status="UNAVAILABLE";m.bad=false;m.accRms=m.gyroRms=m.quality=NaN;return;} // this headband/firmware sends no motion: gate off, and the panel says so
  const f=motionFeatures(now);
  if(!f){ // missing or stale motion data is never read as "no movement"
    m.status="NO_MOTION_DATA";m.bad=true;m.state="MOVEMENT";m.stable=0;m.accRms=m.gyroRms=m.quality=NaN;m.badSec+=dt;return;
  }
  m.accRms=f.acc;m.gyroRms=f.gyro==null?NaN:f.gyro;
  const T=MOT.th,gy=f.gyro!=null;
  const over=f.acc>T.acc.entry||(gy&&f.gyro>T.gyro.entry);
  const under=f.acc<T.acc.exit&&(!gy||f.gyro<T.gyro.exit);
  if(m.state==="VALID"){if(over){m.state="MOVEMENT";m.stable=0;}}
  else if(under){m.stable+=dt;if(m.stable>=MOT.STABLE_S){m.state="VALID";m.stable=0;}}
  else m.stable=0;                                                              // hysteresis: only the lower (exit) threshold counts as still
  m.bad=m.state!=="VALID";m.status=m.bad?"MOVEMENT_DETECTED":"VALID";
  m.quality=Math.max(0,1-Math.max(f.acc/T.acc.entry,gy?f.gyro/T.gyro.entry:0));
  if(m.bad)m.badSec+=dt;else m.lastValidT=now;
  if(m.cal){
    m.cal.f.push({acc:f.acc,gyro:f.gyro});
    if(now-m.cal.t0>=MOT.CAL_SEC*1000)finishMotionCal();
  }
}

/* ============ still calibration: sit still ~30 s, thresholds = median + k x MAD of the windows ============ */
const med=a=>{const s=[...a].sort((x,y)=>x-y),n=s.length;return n?(n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2):NaN;};
const madOf=(a,m0)=>med(a.map(v=>Math.abs(v-m0)));
function motionCalibrate(feats){ // pure: returns {th} or {error}
  const N=feats.length;if(N<40)return {error:"Too little motion data ("+N+" windows). Check the headband is on and press again."};
  const hasG=feats.every(f=>f.gyro!=null);
  const base=(key)=>{const v=feats.map(f=>f[key]),m0=med(v);return {m0,mad:Math.max(madOf(v,m0),MOT.FLOOR[key])};};
  const ba=base("acc"),bg=hasG?base("gyro"):null;
  if(ba.m0>MOT.DEFAULT.acc.entry||(hasG&&bg.m0>MOT.DEFAULT.gyro.entry))return {error:"The headband was moving for most of the calibration. Sit still and press again."}; // the median itself is not "still"
  const kept=feats.filter(f=>f.acc<=ba.m0+MOT.CAL_OUT_K*ba.mad&&(!hasG||f.gyro<=bg.m0+MOT.CAL_OUT_K*bg.mad)); // windows where the user moved are discarded
  if(kept.length<MOT.CAL_MIN_KEEP*N)return {error:"You moved during calibration ("+(N-kept.length)+" of "+N+" windows were not still). Sit still and press again."};
  const one=(key)=>{const v=kept.map(f=>f[key]),m0=med(v),mad=Math.max(madOf(v,m0),MOT.FLOOR[key]);
    return {entry:m0+MOT.K_ENTRY*mad,exit:m0+MOT.K_EXIT*mad,median:m0,mad};};
  const th={acc:one("acc"),gyro:hasG?one("gyro"):MOT.th.gyro,calibrated:true,gyroUsed:hasG,t:Date.now()};
  return {th,kept:kept.length,total:N};
}
function startMotionCal(){
  const m=S.mot;
  if(!S.connected||!m)return;
  if(!m.accSeen){if(typeof toast==="function")toast("No motion data from this headband, so there is nothing to calibrate.","info");return;}
  m.cal={t0:Date.now(),f:[]};m.calMsg="";
}
function finishMotionCal(){
  const m=S.mot,r=motionCalibrate(m.cal.f);m.cal=null;
  if(r.error){m.calMsg=r.error;if(typeof toast==="function")toast(r.error,"error");return;}
  MOT.th=r.th;m.state="VALID";m.stable=0;
  try{localStorage.setItem(MOT.KEY,JSON.stringify(r.th));}catch(e){}
  m.calMsg="Motion calibrated ("+r.kept+" still windows)";
  if(typeof toast==="function")toast(m.calMsg,"info");
}

/* the line in the heart-rate card: click it to calibrate */
function motionUi(){
  const el=$("stMot");if(!el)return;const m=S.mot;let t="motion --",cls="";
  if(S.connected&&m){
    if(m.cal)t="motion CAL "+Math.max(0,Math.ceil(MOT.CAL_SEC-(Date.now()-m.cal.t0)/1000))+"s";
    else if(m.status==="UNAVAILABLE")t=S.emitted>FS*3?"no motion data from headband":"motion --";
    else if(m.status==="NO_MOTION_DATA")t="motion data missing";
    else if(m.bad)t="MOVING, measurement paused";
    else t="motion ok"+(MOT.th.calibrated?"":" (uncalibrated)");
    cls=m.bad&&!m.cal?"bad":"";
  }
  el.textContent=t;el.className="inl"+(cls?" "+cls:"");
  el.title="Click, then sit still for "+MOT.CAL_SEC+" s to calibrate the movement thresholds";
}

/* ============ recording columns (appended after the focus columns; nothing renamed) ============ */
const MOTION_REC_COLNAMES=["motion_acc_rms_g","motion_gyro_rms_dps","motion_state"];
const MOTION_STATE_NAMES=["unavailable","valid","movement_detected","no_motion_data"];
function motionRecFill(d,o){ // o = index of the first motion column in this row
  const m=S.mot;if(!m){d[o]=d[o+1]=d[o+2]=NaN;return;}
  d[o]=m.accRms;d[o+1]=m.gyroRms;d[o+2]=m.status==="VALID"?1:m.status==="MOVEMENT_DETECTED"?2:m.status==="NO_MOTION_DATA"?3:0;
}
function motionRecFormat(k,v){ // k = 0..2 within the motion columns
  if(k===2)return MOTION_STATE_NAMES[v]||"";
  return v!==v?"":v.toFixed(4);
}

```

## panel/pulse.js

```js
/* panel/pulse.js
   Pulse sensor: heart-rate estimate from the infrared pulse signal (PL, onPpg, ppgAnalyse, hrUi).
   Classic script: shares the page's global scope with the other panel/*.js files (load order is set in muse-panel.html).
   Uses: core.js (FS-independent biquad helpers) */
"use strict";
/* ============ pulse (heart rate) ============
   Infrared pulse sensor on the forehead, 64 readings per second. Offset removed, then a 0.7-3.5 Hz pass band.
   Rate = strongest repeat period in the last 8 s (normalised autocorrelation); shown only when the repeat is clear, otherwise "--". */
const PL={seqLast:null,lost:0,packets:0,lastAt:0,n:0,hp:{x:null,y:0},f1:null,f2:null,
  raw:new Float32Array(PPG_FS*4),rawPos:0,bp:new Float32Array(PPG_FS*8),mk:new Uint8Array(PPG_FS*8),skip:0,bpPos:0,filled:0,
  scaleRaw:null,scaleBp:null,hist:[],bpm:null,pct:null,r:0,bad:0,state:"--",since:0,warned:false,fallback:false};
function ppgFilters(){const f0=Math.sqrt(0.7*3.5),Q=f0/(3.5-0.7);PL.f1=biquadFs(f0,Q,PPG_FS);PL.f2=biquadFs(f0,Q,PPG_FS);}
function ppgSignalReset(){PL.hp.x=null;PL.hp.y=0;ppgFilters();PL.n=0;PL.raw.fill(0);PL.bp.fill(0);PL.mk.fill(0);PL.skip=0;PL.rawPos=0;PL.bpPos=0;PL.filled=0;PL.hist=[];PL.bpm=null;PL.pct=null;PL.bad=0;PL.scaleRaw=null;PL.scaleBp=null;}
function ppgFullReset(){PL.seqLast=null;PL.lost=0;PL.packets=0;PL.lastAt=0;PL.since=Date.now();PL.warned=false;PL.state="--";ppgSignalReset();}
ppgFullReset();
function onPpg(seq,vals){
  PL.lastAt=Date.now();PL.packets++;
  if(PL.seqLast!=null){const d=(seq-PL.seqLast)&0xffff;if(d===0)return;
    if(d>1){PL.lost+=d-1;
      if(d>2)ppgSignalReset();
      else if(PL.n>=PPG_FS*2){ // 1-2 packets missing: leave an empty stretch in the timeline, never fill it in
        for(let k=0;k<(d-1)*PPG_PKT;k++){PL.raw[PL.rawPos]=NaN;PL.rawPos=(PL.rawPos+1)%PL.raw.length;PL.bp[PL.bpPos]=NaN;PL.mk[PL.bpPos]=0;PL.bpPos=(PL.bpPos+1)%PL.bp.length;if(PL.filled<PL.bp.length)PL.filled++;}
        PL.skip=24; // the filter needs a moment to settle after a gap
      }}}
  PL.seqLast=seq;
  for(const x of vals){
    const h=PL.hp;if(h.x==null){h.x=x;h.y=0;}
    const y=x-h.x+0.995*h.y;h.x=x;h.y=y;PL.n++;
    const b=PL.f2.p(PL.f1.p(y));
    if(PL.n<PPG_FS*2)continue; // first 2 s: offset removal and filters still settling, not shown
    PL.raw[PL.rawPos]=y;PL.rawPos=(PL.rawPos+1)%PL.raw.length;
    PL.bp[PL.bpPos]=b;PL.mk[PL.bpPos]=PL.skip>0?0:1;if(PL.skip>0)PL.skip--;PL.bpPos=(PL.bpPos+1)%PL.bp.length;
    if(PL.filled<PL.bp.length)PL.filled++;
  }
}
function ppgAnalyse(){
  if(!S.connected){PL.state="--";PL.bpm=null;PL.pct=null;PL.hist=[];return;}
  const age=Date.now()-PL.lastAt;
  if(PL.packets===0||age>3000){PL.state=(Date.now()-PL.since>10000)?"NO DATA":"WAIT";PL.bpm=null;PL.pct=null;PL.hist=[];return;}
  if(PL.filled<PPG_FS*6){PL.state="WAIT";return;}
  const L=PL.bp.length,n=Math.min(PL.filled,L),x=new Float32Array(n),m=new Uint8Array(n);
  for(let i=0;i<n;i++){const k=(PL.bpPos-n+i+L*2)%L;x[i]=PL.bp[k];m[i]=PL.mk[k];}
  const lo=Math.round(PPG_FS*60/180),hi=Math.round(PPG_FS*60/40),r=new Float32Array(hi+3);
  let best=lo,bv=-1;
  for(let l=lo-1;l<=hi+1;l++){let s=0,e1=0,e2=0; // only pairs where both readings really arrived
    for(let i=0;i+l<n;i++){if(m[i]&m[i+l]){const a=x[i],b=x[i+l];s+=a*b;e1+=a*a;e2+=b*b;}}
    const d=Math.sqrt(e1*e2);r[l]=d>0?s/d:0;
    if(l>=lo&&l<=hi&&r[l]>bv){bv=r[l];best=l;}}
  const hh=Math.round(best/2);
  if(hh>=lo){let hb=hh,hv=-1;for(let l=hh-2;l<=hh+2;l++)if(l>=lo&&l<=hi&&r[l]>hv){hv=r[l];hb=l;}
    if(hv>=0.85*bv){best=hb;bv=hv;}} // a clear repeat at half the period means the true period is the shorter one
  let lag=best;
  if(best>lo&&best<hi){const a=r[best-1],b=r[best],c=r[best+1],den=a-2*b+c;if(den<0)lag=best+0.5*(a-c)/den;}
  const inst=PPG_FS*60/lag,pRaw=Math.max(0,Math.min(1,(bv-0.15)/0.65))*100;
  PL.pct=PL.pct==null?pRaw:PL.pct+0.5*(pRaw-PL.pct);PL.r=bv;
  if(bv>=0.3&&inst>=40&&inst<=180){
    PL.hist.push(inst);if(PL.hist.length>5)PL.hist.shift();PL.bad=0;
    const s=[...PL.hist].sort((p,q)=>p-q);PL.bpm=s[Math.floor(s.length/2)];PL.state=PL.pct>=40?"LIVE":"WEAK";
  }else{PL.bad++;PL.state="WEAK";if(PL.bad>=4){PL.hist=[];PL.bpm=null;}}
}
function hrUi(){
  const on=S.connected,have=on&&PL.bpm!=null;
  $("hrNum").textContent=have?String(Math.round(PL.bpm)):"--";
  $("hrState").textContent=on?PL.state:"--";
  $("hrFill").style.width=have?Math.max(2,Math.min(100,(PL.bpm-40)/140*100))+"%":"0";
  const el=$("sen4"),q=el.querySelector(".q");let cls="",txt="--";
  if(on&&PL.pct!=null&&PL.state!=="NO DATA"&&PL.state!=="WAIT"){const p=Math.round(PL.pct);txt=p+"%";cls=p>=70?"good":p>=40?"fair":"poor";}
  el.className="sensor hr "+cls;q.textContent=txt;
  $("rq4").textContent=txt;$("rr4").textContent=have?Math.round(PL.bpm)+" bpm":"--";
  if(on&&PL.state==="NO DATA"&&!PL.warned){PL.warned=true;toast("No pulse data is coming from the headband yet. Brain signals are fine. Make sure the headband sits snug on your forehead, then press Disconnect and Connect once.","info",9000);}
}

```

## panel/ble.js

```js
/* panel/ble.js
   Getting data in: Muse 2 Bluetooth (Web Bluetooth) connect/retry/disconnect, battery, and the simulated headband used by ?demo=1.
   Classic script: shares the page's global scope with the other panel/*.js files (load order is set in muse-panel.html).
   Uses: core.js, dsp.js, ui.js */
"use strict";
/* ============ Muse protocol ============ */
const enc=cmd=>{const b=new TextEncoder().encode("X"+cmd+"\n");b[0]=b.length-1;return b;};
function decodeEEG(dv){
  const out=[];
  for(let i=0;i<6;i++){const b=2+i*3,a=dv.getUint8(b),m=dv.getUint8(b+1),c=dv.getUint8(b+2);
    out.push((a<<4)|(m>>4),((m&15)<<8)|c);}
  return out.map(v=>(v-2048)*0.48828125); // microvolts, straight from the headband's 12-bit values
}
function decodePPG(dv){ // 6 readings of 24 bits each, after the 2-byte packet counter
  const out=[];for(let i=0;i<PPG_PKT;i++){const b=2+i*3;out.push((dv.getUint8(b)<<16)|(dv.getUint8(b+1)<<8)|dv.getUint8(b+2));}
  return out;
}
function decodeMotion(dv,kind){ // 3 readings of x,y,z (signed 16 bit, big-endian) after the 2-byte counter -> g (accelerometer) or deg/s (gyroscope)
  const sc=kind==="acc"?0.0000610352:0.0074768,out=[];
  for(let i=0;i<9;i++)out.push(dv.getInt16(2+i*2)*sc);
  return out;
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function linkOnce(dev){
  const server=await dev.gatt.connect();
  const svc=await server.getPrimaryService(SVC);
  const ctrl=await svc.getCharacteristic(CTRL);await ctrl.startNotifications();
  for(let i=0;i<4;i++){const c=await svc.getCharacteristic(EEG[i]);
    c.addEventListener("characteristicvaluechanged",e=>{const dv=e.target.value;handlePacket(i,dv.getUint16(0),decodeEEG(dv));});
    await c.startNotifications();}
  try{const t=await svc.getCharacteristic(TELE);t.addEventListener("characteristicvaluechanged",e=>{const dv=e.target.value;if(dv.byteLength>=4)setBattery(dv.getUint16(2)/512);});await t.startNotifications();}catch(e){}
  S.ctrl=ctrl;
  if(!PL.fallback){try{const p=await svc.getCharacteristic(PPG_IR);
    p.addEventListener("characteristicvaluechanged",e=>{const dv=e.target.value;if(dv.byteLength>=2+PPG_PKT*3)onPpg(dv.getUint16(0),decodePPG(dv));});
    await p.startNotifications();}catch(e){console.warn("pulse sensor not available",e);}}
  for(const [u,kind] of [[ACC,"acc"],[GYRO,"gyro"]]){try{const c=await svc.getCharacteristic(u);
    c.addEventListener("characteristicvaluechanged",e=>{const dv=e.target.value;if(dv.byteLength>=20)onMotion(kind,dv.getUint16(0),decodeMotion(dv,kind));});
    await c.startNotifications();}catch(e){console.warn("motion sensor "+kind+" not available",e);}}
  await ctrl.writeValueWithoutResponse(enc("h"));await ctrl.writeValueWithoutResponse(enc(PL.fallback?"p21":"p50"));
  await ctrl.writeValueWithoutResponse(enc("s"));await ctrl.writeValueWithoutResponse(enc("d"));
}
const HELP="Could not link with your Muse 2. Try this: 1) Close the Muse app on any phone or tablet. 2) In Windows Settings, Bluetooth & devices, remove 'Muse' if it is listed. 3) Turn the headband off, then on again. 4) Press Connect.";
async function connectMuse(userClicked){
  if(S.connecting||S.connected)return;
  S.connecting=true;S.userDisconnected=false;setButtons();
  try{
    if(DEMO)return startDemo();
    if(!navigator.bluetooth)throw Object.assign(new Error("Bluetooth is not available in this window. Use the Open Muse Panel launcher."),{name:"NoBT"});
    setStatus("search","Searching");
    let dev=S.device;
    if(!dev){try{const known=navigator.bluetooth.getDevices?await navigator.bluetooth.getDevices():[];dev=known.find(d=>/muse/i.test(d.name||""));}catch(e){}}
    if(!dev){
      if(!userClicked){S.connecting=false;setButtons();setStatus("search","Press Connect once");return;}
      dev=await navigator.bluetooth.requestDevice({filters:[{namePrefix:"Muse"}],optionalServices:[SVC]});
    }
    S.device=dev;dev.removeEventListener("gattserverdisconnected",onDrop);dev.addEventListener("gattserverdisconnected",onDrop);
    setStatus("search","Connecting");
    let lastErr=null;
    for(let a=1;a<=3;a++){
      try{resetStream();await linkOnce(dev);lastErr=null;break;}
      catch(e){lastErr=e;try{dev.gatt.disconnect();}catch(_){}await sleep(1200*a);}
    }
    if(lastErr)throw lastErr;
    S.fails=0;S.everConnected=true;S.connected=true;S.connecting=false;setStatus("on","Connected");setButtons();
    // safety net: if no brain data arrives with the pulse mode on, fall back to brain-only mode
    setTimeout(()=>{if(S.connected&&!DEMO&&S.emitted===0&&S.ctrl&&!PL.fallback){PL.fallback=true;const c=S.ctrl,w=m=>c.writeValueWithoutResponse(enc(m));
      w("h").then(()=>w("p21")).then(()=>w("s")).then(()=>w("d")).catch(()=>{});toast("Switched to brain-signals-only mode (no pulse).","info",6000);}},6000);
  }catch(err){
    S.connecting=false;S.connected=false;setButtons();console.error(err);
    if(err&&err.name==="NotFoundError"){setStatus("search","Press Connect");return;}
    S.fails++;setStatus("bad","Not connected");
    toast(err&&err.name==="NoBT"?err.message:HELP,"error",14000);
    if(S.fails<3&&S.everConnected)scheduleRetry();
  }
}
function onDrop(){
  S.connected=false;S.connecting=false;setButtons();setBattery(null);if(S.rec)stopRec(true);
  if(S.userDisconnected){setStatus("bad","Disconnected");return;}
  setStatus("search","Lost signal, retrying");scheduleRetry();
}
let retryT=null;
function scheduleRetry(){clearTimeout(retryT);if(S.userDisconnected)return;retryT=setTimeout(()=>connectMuse(false),2500);}
function disconnectMuse(){
  S.userDisconnected=true;clearTimeout(retryT);
  if(DEMO){stopDemo();return;}
  try{if(S.device&&S.device.gatt.connected)S.device.gatt.disconnect();}catch(e){}
  S.connected=false;S.connecting=false;setButtons();setStatus("bad","Disconnected");setBattery(null);if(S.rec)stopRec(true);
}
function setBattery(p){
  if(p==null){$("batFill").style.width="0";$("batText").textContent="--";return;}
  p=Math.max(0,Math.min(100,p));$("batFill").style.width=p+"%";$("batText").textContent=Math.round(p)+"%";
}

/* ============ simulated headband (testing only: add ?demo=1 to the address) ============ */
let demoT=null,demoN=0,demoP=0,demoMA=0,demoMS=0;window.demoAlpha=28;window.demoBeta=14;window.demoHr=72;window.demoGamma=6;
function startDemo(){
  resetStream();S.connected=true;S.connecting=false;setStatus("on","Simulated data");setBattery(87);setButtons();
  demoT=setInterval(()=>{
    const n=demoN++;
    for(let c=0;c<4;c++){
      if(DROP&&c===2&&Math.random()<0.08)continue;
      const arr=[];
      for(let k=0;k<PKT;k++){const t=(n*PKT+k)/FS;
        arr.push(40*Math.sin(2*Math.PI*2.1*t+c)*(1+.4*Math.sin(t*.7))+22*Math.sin(2*Math.PI*6*t+c)+window.demoAlpha*Math.sin(2*Math.PI*10*t)+window.demoBeta*Math.sin(2*Math.PI*21*t+c*2)+window.demoGamma*Math.sin(2*Math.PI*38*t+c)+(Math.random()-.5)*(c===3?260:6));}
      handlePacket(c,n&0xffff,arr);
    }
    if(n%2===0&&!(DROP&&Math.random()<0.05)){ // simulated pulse sensor: one 6-reading packet every ~94 ms
      const arr=[],f=window.demoHr/60;
      for(let k=0;k<PPG_PKT;k++){const t=(demoP*PPG_PKT+k)/PPG_FS;
        arr.push(Math.round(60000+700*Math.sin(2*Math.PI*0.25*t)+900*(Math.sin(2*Math.PI*f*t)+0.35*Math.sin(4*Math.PI*f*t+1))+(Math.random()-.5)*80));}
      onPpg(demoP&0xffff,arr);
    }
    demoMA+=47;if(demoMA>=1000*3/MOT.PKT_FS){demoMA-=1000*3/MOT.PKT_FS;demoMS++;  // simulated motion: still, with a 3 s head movement every 20 s (from 15 s to 18 s)
      const tt=n*PKT/FS,mv=window.demoMove!==false&&tt%20>15&&tt%20<18,acc=[],gy=[];
      for(let k=0;k<3;k++){const t=tt+k/MOT.PKT_FS,w=mv?0.15*Math.sin(2*Math.PI*2*t):0;
        acc.push((Math.random()-.5)*.004,(Math.random()-.5)*.004+w,1+(Math.random()-.5)*.004);
        gy.push(1+(Math.random()-.5),mv?60*Math.sin(2*Math.PI*2*t):0,(Math.random()-.5));}
      onMotion("acc",demoMS&0xffff,acc);onMotion("gyro",demoMS&0xffff,gy);}
    if(n%2===0)demoP++;
  },47);
}
function stopDemo(){clearInterval(demoT);S.connected=false;setButtons();setStatus("bad","Disconnected");setBattery(null);if(S.rec)stopRec(true);}

```

## panel/focus.js

```js
/* panel/focus.js
   The focus meter (ln beta/alpha, personal baselines) and the always-on-top floating meter.
   Classic script: shares the page's global scope with the other panel/*.js files (load order is set in muse-panel.html).
   Uses: core.js, dsp.js, ui.js */
"use strict";
/* ============ focus ============
   F = ln( beta power / alpha power ), smoothed ~3 s.  Meter = 25 + 50 x (F - low) / (high - low), held to 0..100 (low baseline = 25, high baseline = 75).
   Uses the true band signal; sliders and mutes only change what is drawn. */
const CAL_SEC=+(params.get("cal")||10),MIN_SPAN=0.4;
const focus={ema:null,fast:null,lo:null,hi:null,cal:null,result:"",raw:null}; // LEGACY score state: its computation below is untouched
function quantile(s,q){const p=(s.length-1)*q,i=Math.floor(p),f=p-i;return s[i]+(s[Math.min(i+1,s.length-1)]-s[i])*f;}
function pctOf(f){
  if(f.ema==null||f.lo==null||f.hi==null||f.hi-f.lo<0.05)return null;
  return Math.max(0,Math.min(100,25+(f.ema-f.lo)/(f.hi-f.lo)*50)); // low baseline = 25, high baseline = 75, the rest extends from there
}

function renderFocus(){
  const p=focusPct(),txt=p==null?"--":String(Math.round(p)),sh=shown(),em=effMode();
  $("fnum").textContent=txt;
  [...fbar.children].forEach((s,i)=>s.classList.toggle("lit",p!=null&&i<Math.round(p/100*FSEG)));
  renderFocusSwitch(); // switch buttons, label, status badge and note (focus/focus-switch.js)
  $("btnCal").disabled=!(S.connected&&!focus.cal);
  $("btnCal").classList.toggle("on",sh.lo!=null&&sh.hi!=null&&!focus.cal);
  if(S.pip){S.pip.num.textContent=txt;[...S.pip.bar.children].forEach((s,i)=>s.classList.toggle("lit",p!=null&&i<Math.round(p/100*FSEG)));S.pip.note.textContent=p==null?(S.connected?(sh.lo==null?"Set baselines in the panel":em.toUpperCase()+": no valid reading"):"Not connected"):em.toUpperCase();}
  sendGame(pctOf(focus)); // external games always get the focus score
  updateMarioBtn();
}
/* ============ floating focus meter (small always-on-top window) ============ */
const PIP_CSS=`
*{box-sizing:border-box;margin:0;padding:0}
body{background:radial-gradient(ellipse at 20% 0%,#2a1d6e,#050a26 65%);color:#eaf3ff;font-family:"Segoe UI",sans-serif;padding:10px 14px;height:100vh;overflow:hidden;border:1px solid #6a5cff}
.t{font-size:11px;letter-spacing:.34em;color:#8fa6ff}
.n{font-size:46px;font-weight:300;line-height:1.05;text-shadow:0 0 14px rgba(120,150,255,.9)}
.b{display:flex;align-items:flex-end;gap:3px;height:34px;margin-top:4px}
.b span{flex:1;background:rgba(60,50,190,.45);border:1px solid rgba(140,120,255,.55)}
.b span.lit{background:linear-gradient(0deg,#9a4bff,#3fd6ff 70%,#fff);border-color:#7fe6ff}
.s{font-size:11px;color:#9fb2e6;margin-top:3px;min-height:14px;letter-spacing:.04em}`;
async function toggleFloat(){
  if(S.pip){S.pip.w.close();return;}
  if(!("documentPictureInPicture" in window)){toast("The floating meter needs Microsoft Edge or Chrome, version 116 or newer.","error");return;}
  try{
    const w=await documentPictureInPicture.requestWindow({width:300,height:136});
    try{w.moveTo(screen.availLeft+screen.availWidth-320,screen.availTop+8);}catch(e){}
    const st=w.document.createElement("style");st.textContent=PIP_CSS;w.document.head.appendChild(st);
    w.document.body.innerHTML=`<div class="t">FOCUS</div><div class="n" id="n">--</div><div class="b" id="b"></div><div class="s" id="s"></div>`;
    const bar=w.document.getElementById("b");for(let i=0;i<FSEG;i++){const s=w.document.createElement("span");s.style.height=(22+i*(78/(FSEG-1)))+"%";bar.appendChild(s);}
    S.pip={w,num:w.document.getElementById("n"),bar,note:w.document.getElementById("s")};
    $("btnFloat").classList.add("on");$("btnFloat").lastChild.textContent="Close float";
    w.addEventListener("pagehide",()=>{S.pip=null;$("btnFloat").classList.remove("on");$("btnFloat").lastChild.textContent="Float focus";});
    renderFocus();
    toast("Floating meter is on. Minimize this panel (do not close it) and the meter stays on top. Drag it to the top right if you like.","info",9000);
  }catch(e){console.error(e);toast("Could not open the floating meter. Press the button again.","error");}
}
$("btnFloat").addEventListener("click",toggleFloat);

```

## panel/gamelink.js

```js
/* panel/gamelink.js
   Connects the panel to games: the game-menu hookup and the focus/sensor feed sent to external games on 127.0.0.1:8765.
   Classic script: shares the page's global scope with the other panel/*.js files (load order is set in muse-panel.html).
   Uses: core.js, focus.js, game/menu.js */
"use strict";
/* ============ Game menu (game/menu.js) ============
   Games register in game/menu.js. The panel only supplies the live signals; add a game there, not here. */
function focusReady(){const f=shown();return f.lo!=null&&f.hi!=null&&f.hi-f.lo>=0.05;}
function stressLive(){return !!(window.StressMeter&&S.connected&&StressMeter.ready());}
function marioReady(){return focusReady();}   // kept for older callers
function updateMarioBtn(){}                    // renderFocus() still calls this; the menu needs no per-frame update
addEventListener("load",()=>GameMenu.attach({button:$("btnMario"),note:null,
  ctx:()=>({stage:$("stage"),connected:S.connected,focusReady:focusReady(),stressLive:stressLive(),
    focus:()=>S.connected?pctOf(focus):null, // games always get the focus score, even when the panel shows stress
    stress:()=>{const v=window.StressMeter&&StressMeter.value();return v==null?0:v/100;},
    sensors:()=>SENSORS.map((nm,i)=>{const p=S.connected&&S.emitted>0&&S.pct[i]!=null?Math.round(S.pct[i]):null;return{txt:p==null?"--":p+"%",cls:p==null?"":p>=70?"good":p>=40?"fair":"poor"};}),
    status:()=>S.connected?(S.emitted>0?"Muse live":"Muse waiting"):"Muse not connected"})}));
/* ============ game link: the focus meter (0-100) is sent to the game running on this computer ============ */
const GAME_URL="http://127.0.0.1:8765/";
let gameBusy=false,gameLast=0,gameOk=false;
function sendGame(p){
  const now=Date.now();
  if(gameBusy||now-gameLast<(gameOk?230:2000))return;
  gameLast=now;gameBusy=true;
  const opt=S.connected?{method:"POST",mode:"cors",headers:{"Content-Type":"text/plain"},body:JSON.stringify({focus:p==null?null:Math.round(p*10)/10,mode:effMode(),sensors:S.pct.map(v=>v==null?null:Math.round(v)),motion:S.mot?S.mot.status:null,stale:motionHeld()})}:{method:"GET",mode:"cors"};
  fetch(GAME_URL,opt).then(r=>{gameOk=r.ok;}).catch(()=>{gameOk=false;}).finally(()=>{
    gameBusy=false;const e=$("gameLink");
    e.textContent=gameOk?"GAME: LINKED":"GAME: OFF";e.style.color=gameOk?"#35e6ff":"#6f82c4";e.dataset.state=gameOk?"on":"off";});
}
function startCal(){
  if(!S.connected||focus.cal)return;const t0=Date.now();focus.result="";
  focus.cal={t0,vals:[],all:[],msg(){const left=Math.max(0,CAL_SEC-(Date.now()-t0)/1000);return "RECORDING "+Math.ceil(left)+"s. Drift from relaxed to concentrating";}};
  renderFocus();
}
function finishCal(){
  const c=focus.cal;focus.cal=null;
  const src=c.vals.length>=20?c.vals:c.all;
  if(src.length<12){focus.result="No usable signal in the 10 seconds. Check the sensor percentages and press again.";renderFocus();return;}
  const s=[...src].sort((x,y)=>x-y),q1=quantile(s,.25),q3=quantile(s,.75),iqr=q3-q1;
  const inl=s.filter(v=>v>=q1-1.5*iqr&&v<=q3+1.5*iqr);
  let lo=quantile(inl,.10),hi=quantile(inl,.90),note="Baselines set. Focus is live.";
  if(hi-lo<MIN_SPAN){const mid=(lo+hi)/2;lo=mid-MIN_SPAN/2;hi=mid+MIN_SPAN/2;note="Baselines set (small change seen). Press again and shift your focus more for a wider range.";}
  focus.lo=lo;focus.hi=hi;focus.result=note;saveBaselines();
  renderFocus();
}
setInterval(()=>{
  const a=BANDS[2],b=BANDS[3],ok=a.n2>=20&&b.n2>=20;
  const am=ok?a.e2/a.n2:0,bm=ok?b.e2/b.n2:0;a.e2=a.n2=b.e2=b.n2=0;
  if(!S.connected){focus.ema=null;focus.fast=null;focus.cal=null;focus.raw=null;renderFocus();return;}
  if(ok&&S.usable>0&&!(S.mot&&S.mot.bad)){ // movement gate: no new legacy window is accepted while moving (the last value is held)
    const F=Math.log((bm+1e-3)/(am+1e-3));focus.raw=F;
    focus.ema=focus.ema==null?F:focus.ema+0.08*(F-focus.ema);
    focus.fast=focus.fast==null?F:focus.fast+0.22*(F-focus.fast);
    if(focus.cal){focus.cal.all.push(focus.fast);if(Date.now()>S.artUntil)focus.cal.vals.push(focus.fast);}
  }
  if(focus.cal&&(Date.now()-focus.cal.t0)/1000>=CAL_SEC)finishCal();
  renderFocus();
},250);
$("btnCal").addEventListener("click",startCal);
$("stMot").addEventListener("click",startMotionCal);
initFocusSwitch();loadBaselines();renderFocus();

```

## panel/stress-link.js

```js
/* panel/stress-link.js
   Hands the experimental stress meter (../stress.js) the panel's live signals. If the signal path changes (for example a new blink filter),
   update only the callbacks below. Loaded after stress.js. */
"use strict";
/* experimental stress meter: reads the panel's live buffers (see stress.js) */
window.StressMeter=Stress.attach({
  demo:DEMO,calSec:params.get("stcal")||30,
  connected:()=>S.connected,
  heartRate:()=>(PL.bpm!=null&&PL.state!=="NO DATA"&&PL.state!=="WAIT")?PL.bpm:null,
  motionBad:()=>!!(S.mot&&S.mot.bad),
  artifact:()=>Date.now()<S.artUntil||!!(S.mot&&S.mot.bad),
  frontalWindows:()=>{const w=[];w.af7=null;w.af8=null;if(S.emitted<FS*4)return w;
    for(const c of [1,2]){const r=S.rms[c];if(r!=null&&r>0.5&&r<400){const a=new Float32Array(512);for(let i=0;i<512;i++)a[i]=S.raw[c][(S.rawPos-512+i+BUF_LEN)%BUF_LEN];w.push(a);if(c===1)w.af7=a;else w.af8=a;}}
    return w;},
  ppgWindow:()=>{if(PL.filled<PPG_FS*6)return null;const L=PL.bp.length,n=Math.min(PL.filled,L),x=new Float32Array(n);
    for(let i=0;i<n;i++){const k=(PL.bpPos-n+i+L*2)%L;x[i]=PL.bp[k];}return {x,fs:PPG_FS,pos:PL.bpPos,len:L,filled:PL.filled};}
});
/* start the stress card collapsed so it does not cover the FOCUS switch at the bottom left; the arrow on its header opens it */
{const tg=document.getElementById("stTg");if(tg&&!document.getElementById("stressCard").classList.contains("min"))tg.click();}

```

## panel/recording.js

```js
/* panel/recording.js
   Recording: start/stop, session report, CSV and summary downloads.
   Classic script: shares the page's global scope with the other panel/*.js files (load order is set in muse-panel.html).
   Uses: core.js, dsp.js, focus.js */
"use strict";
/* ============ recording: full breakdown + file download ============ */
function startRec(){
  if(!S.connected||S.rec)return;
  $("report").classList.remove("show");
  S.rec={t0:Date.now(),startDate:new Date(),samples:0,n:0,cap:FS*REC_MAX_SEC,t:new Float64Array(FS*REC_MAX_SEC),d:new Float32Array(FS*REC_MAX_SEC*REC_COLS),
    startIdx:null,contactSum:[0,0,0,0],contactN:0,artSec:0,motSec:0,lost0:S.lostSamples,pLost0:PL.lost,fLo:focus.lo,fHi:focus.hi,full:false};
  setButtons();$("btnStart").classList.add("on");setSess(true);
}
const COLNAMES=["TP9_uV","AF7_uV","AF8_uV","TP10_uV","delta_uV","theta_uV","alpha_uV","beta_uV","gamma_uV","sensors_in_use","focus_index_ln_beta_over_alpha","focus_0_to_100","heart_rate_bpm","heart_signal_pct"].concat(MOTION_REC_COLNAMES);
function pad2(n){return String(n).padStart(2,"0");}
function stamp(d){return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate())+"_"+pad2(d.getHours())+"-"+pad2(d.getMinutes())+"-"+pad2(d.getSeconds());}
function colStats(r,c){let cnt=0,sum=0,sq=0,mn=Infinity,mx=-Infinity;
  for(let i=0;i<r.n;i++){const v=r.d[i*REC_COLS+c];if(v!==v)continue;cnt++;sum+=v;sq+=v*v;if(v<mn)mn=v;if(v>mx)mx=v;}
  return {cnt,mean:cnt?sum/cnt:NaN,rms:cnt?Math.sqrt(sq/cnt):NaN,min:mn,max:mx};}
function buildReport(r){
  const dur=r.n?r.t[r.n-1]:0,dropped=S.lostSamples-r.lost0,total=r.n+dropped;
  const rep={r,name:"Muse2_recording_"+stamp(r.startDate),started:r.startDate.toLocaleString(),dur,n:r.n,dropped,dropPct:total?dropped/total*100:0,
    rate:dur>0?(r.n-1)/dur:0,art:r.artSec,mot:r.motSec,
    sensors:SENSORS.map((n,i)=>{const st=colStats(r,i);return {n,sub:SENSOR_SUB[i],contact:r.contactN?r.contactSum[i]/r.contactN:0,rms:st.rms,min:st.min,max:st.max,pp:st.max-st.min};}),
    bands:BANDS.map((b,i)=>{const st=colStats(r,4+i);return {n:b.name,range:b.range,rms:st.rms,max:Math.max(Math.abs(st.min),Math.abs(st.max))};}),
    use:colStats(r,9),fidx:colStats(r,10),fpct:colStats(r,11),hr:colStats(r,12),hrq:colStats(r,13),hrLost:PL.lost-r.pLost0};
  rep.hrValid=r.n?rep.hr.cnt/r.n*100:0;
  const tot=rep.bands.reduce((a,b)=>a+(b.rms||0)**2,0);rep.bands.forEach(b=>b.share=tot?(b.rms||0)**2/tot*100:0);
  let a50=0,a75=0,nv=0;for(let i=0;i<r.n;i++){const v=r.d[i*REC_COLS+11];if(v!==v)continue;nv++;if(v>=50)a50++;if(v>=75)a75++;}
  rep.f50=nv?a50/nv*100:NaN;rep.f75=nv?a75/nv*100:NaN;
  rep.lo=focus.lo;rep.hi=focus.hi;rep.baseChanged=(r.fLo!==focus.lo||r.fHi!==focus.hi);
  return rep;
}
const f1=(v,d=1)=>(v==null||v!==v||!isFinite(v))?"n/a":v.toFixed(d);
function reportText(R){
  const L=[];L.push("MUSE 2 RECORDING SUMMARY");L.push("Started: "+R.started);L.push("Length: "+f1(R.dur,2)+" s");
  L.push("Readings kept per sensor: "+R.n+" (measured rate "+f1(R.rate,1)+" per second, headband rate 256)");
  L.push("Dropped readings: "+R.dropped+" ("+f1(R.dropPct,2)+"%). Gaps are left as gaps in the time column, nothing is filled in.");
  L.push("Seconds with a big noise burst (blink or jaw clench): "+R.art);L.push("Seconds the motion gate paused focus (head movement or missing motion data): "+R.mot);L.push("");
  L.push("SENSORS (offset removed, no other processing)");
  R.sensors.forEach(s=>L.push(s.n+" ("+s.sub+"): contact "+f1(s.contact,0)+"%, RMS "+f1(s.rms)+" uV, min "+f1(s.min)+" uV, max "+f1(s.max)+" uV, peak to peak "+f1(s.pp)+" uV"));
  L.push("Sensors in use on average: "+f1(R.use.mean,2)+" of 4");L.push("");
  L.push("WAVE TYPES (band filtered, average of the sensors in use)");
  R.bands.forEach(b=>L.push(b.n+" "+b.range[0]+"-"+b.range[1]+" Hz: RMS "+f1(b.rms)+" uV, largest swing "+f1(b.max)+" uV, share of band power "+f1(b.share,1)+"%"));L.push("");
  L.push("FOCUS  (index = ln(beta/alpha) smoothed 3 s; 0 to 100 uses your baselines)");
  if(R.lo!=null&&R.hi!=null){L.push("Baselines: low "+f1(R.lo,2)+", high "+f1(R.hi,2)+(R.baseChanged?" (changed during this recording)":""));
    L.push("Focus 0-100: min "+f1(R.fpct.min,0)+", average "+f1(R.fpct.mean,0)+", max "+f1(R.fpct.max,0));
    L.push("Time at 50 or above: "+f1(R.f50,0)+"%. Time at 75 or above: "+f1(R.f75,0)+"%.");}
  else L.push("No baselines were set, so only the raw focus index is in the data file. Index: min "+f1(R.fidx.min,2)+", average "+f1(R.fidx.mean,2)+", max "+f1(R.fidx.max,2));
  L.push("");L.push("HEART RATE  (forehead pulse sensor, 64 readings per second, updated once per second from the last 8 seconds)");
  if(R.hr.cnt)L.push("Average "+f1(R.hr.mean,0)+" bpm, lowest "+f1(R.hr.min,0)+", highest "+f1(R.hr.max,0)+". A rate is shown only when the pulse repeats clearly; "+f1(R.hrValid,0)+"% of the recording has one. Average pulse signal "+f1(R.hrq.mean,0)+"%. Lost pulse packets: "+R.hrLost+".");
  else L.push("No clear heart rate was read during this recording. Lost pulse packets: "+R.hrLost+".");
  L.push("");L.push("DATA FILE COLUMNS");L.push("time_s plus: "+COLNAMES.join(", "));
  return L.join("\r\n");
}
function csvOf(r){
  const rows=["time_s,"+COLNAMES.join(",")];
  for(let i=0;i<r.n;i++){const o=i*REC_COLS;let line=r.t[i].toFixed(4);
    for(let c=0;c<REC_COLS;c++){const v=r.d[o+c];line+=","+(c>=14?motionRecFormat(c-14,v):v!==v?"":(c===9?String(v):c===12?v.toFixed(1):c===13?v.toFixed(0):v.toFixed(3)));}
    rows.push(line);}
  return rows.join("\r\n");
}
function download(name,text,type){
  const blob=new Blob(["﻿"+text],{type:type+";charset=utf-8"}),a=document.createElement("a");
  a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},4000);
}
let LASTREP=null;
function showReport(R,saved,why){
  LASTREP=R;const rr=$("report");
  const lines=(a)=>a.map(x=>`<div class="ln"><span>${x[0]}</span><b>${x[1]}</b></div>`).join("");
  rr.innerHTML=`
   <div class="rh"><h2>SESSION REPORT</h2><div class="rs">${R.started}${why?" | "+why:""}</div></div>
   <div class="cols">
    <div class="box"><h3>RECORDING</h3>${lines([["Length",f1(R.dur,1)+" s"],["Readings per sensor",R.n.toLocaleString()],["Measured rate",f1(R.rate,0)+" per s"],["Dropped",R.dropped+" ("+f1(R.dropPct,1)+"%)"],["Noise-burst seconds",R.art],["Motion-paused seconds",R.mot],["Sensors in use (avg)",f1(R.use.mean,1)+" of 4"]])}
      <h3 style="margin-top:14px">FOCUS</h3>${R.lo!=null&&R.hi!=null?lines([["Baseline low / high",f1(R.lo,2)+" / "+f1(R.hi,2)],["Lowest",f1(R.fpct.min,0)],["Average",f1(R.fpct.mean,0)],["Highest",f1(R.fpct.max,0)],["Time at 50+",f1(R.f50,0)+"%"],["Time at 75+",f1(R.f75,0)+"%"]]):lines([["Baselines","not set"],["Raw index avg",f1(R.fidx.mean,2)],["Raw index range",f1(R.fidx.min,2)+" to "+f1(R.fidx.max,2)]])}</div>
    <div class="box"><h3>SENSORS (offset removed only)</h3>
      <table><tr><th>SENSOR</th><th>CONTACT</th><th>RMS &micro;V</th><th>MIN</th><th>MAX</th><th>P-P</th></tr>
      ${R.sensors.map(s=>`<tr><td>${s.n}</td><td>${f1(s.contact,0)}%</td><td>${f1(s.rms)}</td><td>${f1(s.min)}</td><td>${f1(s.max)}</td><td>${f1(s.pp)}</td></tr>`).join("")}</table>
      <h3 style="margin:14px 0 8px;color:#ff7088">HEART RATE (pulse sensor)</h3>${R.hr.cnt?lines([["Average",f1(R.hr.mean,0)+" bpm"],["Lowest / highest",f1(R.hr.min,0)+" / "+f1(R.hr.max,0)+" bpm"],["Time with a clear rate",f1(R.hrValid,0)+"%"],["Pulse signal (avg)",f1(R.hrq.mean,0)+"%"],["Lost pulse packets",R.hrLost]]):lines([["Heart rate","none read"],["Lost pulse packets",R.hrLost]])}</div>
    <div class="box"><h3>WAVE TYPES</h3>
      <table><tr><th>BAND</th><th>HZ</th><th>RMS &micro;V</th><th>PEAK</th><th>SHARE</th></tr>
      ${R.bands.map(b=>`<tr><td>${b.n}</td><td>${b.range[0]}-${b.range[1]}</td><td>${f1(b.rms)}</td><td>${f1(b.max)}</td><td>${f1(b.share,0)}%</td></tr>`).join("")}</table></div>
   </div>
   <div class="btns"><button class="oct" id="rpCsv">Download data (CSV)</button><button class="oct" id="rpTxt">Download summary (TXT)</button><button class="oct" id="rpClose">Close</button></div>
   <div class="note">${saved?"Saved to your Downloads folder as "+R.name+".csv. ":""}Every reading is in the CSV. Gaps from dropped readings stay as gaps in the time column.</div>`;
  rr.classList.add("show");
  $("rpCsv").onclick=()=>download(R.name+".csv",csvOf(R.r),"text/csv");
  $("rpTxt").onclick=()=>download(R.name+"_summary.txt",reportText(R),"text/plain");
  $("rpClose").onclick=()=>rr.classList.remove("show");
}
function stopRec(auto,why){
  if(!S.rec)return;const r=S.rec;S.rec=null;
  $("btnStart").classList.remove("on");setButtons();
  if(r.n<FS){$("sessT").textContent=fmt(Math.round((Date.now()-r.t0)/1000));$("sessN").textContent=String(r.n);sessMsg("Too short to save (under 1 second)");
    toast("That recording was under 1 second, so nothing was saved.","info",5000);return;}
  const R=buildReport(r);
  $("sessT").textContent=fmt(Math.round(R.dur));$("sessN").textContent=R.n.toLocaleString();
  let saved=false;
  try{download(R.name+".csv",csvOf(r),"text/csv");saved=true;}catch(e){console.error(e);}
  sessMsg(saved?"Saved to Downloads":"Press Download in the report");
  showReport(R,saved,auto?(why||"Ended: signal lost"):"");
}

```

## panel/main.js

```js
/* panel/main.js
   Wiring and start-up. Must load last.
   Classic script: shares the page's global scope with the other panel/*.js files (load order is set in muse-panel.html).
   Uses: all other panel/*.js */
"use strict";
/* ============ wiring ============ */
$("btnConnect").addEventListener("click",()=>connectMuse(true));
$("btnDisconnect").addEventListener("click",disconnectMuse);
$("btnStart").addEventListener("click",startRec);
$("btnStop").addEventListener("click",()=>stopRec(false));
if(params.get("view")==="raw")setView("raw");
setButtons();setStatus("search","Searching");renderFocus();
connectMuse(false);
addEventListener("beforeunload",()=>{try{if(S.device&&S.device.gatt.connected)S.device.gatt.disconnect();}catch(e){}});

```

## focus/focus-switch.js

```js
/* Focus / stress display switch and remembered baselines.
   FOCUS shows the focus meter (ln(beta/alpha), mapped to 0-100 with your baselines). STRESS shows 100 minus that number
   (focus 100 = stress 0, focus 0 = stress 100). Both use the same baselines. External games and the game menu always get the FOCUS number.
   Both are rough proxies, not validated measures. The muscle-corrected score is parked in focus/experimental/ and is not loaded.
   Needs from the panel: $, S, focus, pctOf, renderFocus. Optional: S.mot (panel/motion.js). */
"use strict";
const MKEY = "muse2panel.focusmode", BKEY = "muse2panel.baselines";
let MODE_PREF = "focus";
try { MODE_PREF = localStorage.getItem(MKEY) === "stress" ? "stress" : "focus"; } catch (e) {}
function effMode() { return MODE_PREF; }
function shown() { return focus; }
function focusPct() { const p = pctOf(focus); return p == null ? null : MODE_PREF === "stress" ? 100 - p : p; }
function motionHeld() { return !!(S.mot && S.mot.bad); }
function motionWhy() { return S.mot && S.mot.status === "NO_MOTION_DATA" ? "no motion data" : "movement"; }
function setMode(m) {
  MODE_PREF = m === "stress" ? "stress" : "focus";
  try { localStorage.setItem(MKEY, MODE_PREF); } catch (e) {}
  renderFocus();
}
/* baselines from the 10 second Auto Set Baselines are remembered for next time (browser storage, wrapped in try/catch) */
function saveBaselines() {
  try { localStorage.setItem(BKEY, JSON.stringify({ lo: focus.lo, hi: focus.hi, t: Date.now() })); } catch (e) {}
}
function loadBaselines() {
  try {
    const b = JSON.parse(localStorage.getItem(BKEY));
    if (b && isFinite(b.lo) && isFinite(b.hi) && b.hi - b.lo >= 0.05) {
      focus.lo = b.lo; focus.hi = b.hi;
      focus.result = "Using your baselines from last time (" + new Date(b.t).toLocaleDateString() + "). Press Auto Set Baselines to redo them.";
    }
  } catch (e) {}
}
/* buttons, title, movement badge and the note under the title. Called from renderFocus(). */
function renderFocusSwitch() {
  const st = MODE_PREF === "stress";
  $("fmF").classList.toggle("on", !st); $("fmS").classList.toggle("on", st);
  $("fmF").setAttribute("aria-checked", st ? "false" : "true"); $("fmS").setAttribute("aria-checked", st ? "true" : "false");
  $("fmF").title = "Show the focus meter (a rough proxy, not a validated measure)";
  $("fmS").title = "Show stress = 100 minus focus (a rough proxy, not a validated measure)";
  $("fname").textContent = st ? "STRESS" : "FOCUS";
  let note;
  if (focus.cal) note = focus.cal.msg();
  else if (!S.connected) note = "Connect to use " + (st ? "stress" : "focus");
  else if (S.usable === 0) note = "No sensor contact";
  else if (focus.lo == null || focus.hi == null) note = focus.result || "Press the button to set baselines";
  else note = focus.result || "Baselines set. " + (st ? "Stress" : "Focus") + " is live.";
  if (st && focus.lo != null && S.connected) note += " Stress = 100 minus focus.";
  const fn = $("fnote"); fn.textContent = "";
  if (motionHeld()) { const b = document.createElement("b"); b.id = "cstat"; b.className = "hold"; b.textContent = "HELD \u00b7 " + motionWhy(); fn.appendChild(b); }
  fn.appendChild(document.createTextNode(note));
}
function initFocusSwitch() {
  $("fmF").addEventListener("click", () => setMode("focus"));
  $("fmS").addEventListener("click", () => setMode("stress"));
}

```

## arousal.js

```js
/* Arousal / fear meter (experimental): the 0-100 score from the "Muse 2 Stress / Fear Meter" spec.
   F = 100 * clip(0.40 H + 0.35 V + 0.25 E, 0, 1)
     H = heart-rate rise        (HR - HRbase) / (HRhigh - HRbase)
     V = HRV (RMSSD) drop       (HRVbase - HRV) / (HRVbase - HRVlow)
     E = beta/alpha rise        (R - Rbase) / (Rhigh - Rbase)
   This estimates physiological physiological arousal, not fear. Excitement, surprise, movement and muscle tension look the same.
   Rules from the spec that are enforced here:
     - a missing or rejected measurement is never treated as zero; with fewer than three valid components the score is a PARTIAL score
       (weights renormalised, partial:true, confidence = share of weight used) and with none the score is withheld;
     - if nothing valid arrives for STALE_MS the last score is kept but marked stale:true;
     - the score is smoothed (EMA, alpha 0.25) only when a new valid measurement arrives.
   Pure maths, no DOM. Tested in arousal.test.js. Wired to the stress card by stress.js (attach). */
"use strict";
(function (root) {

const W = { hr: 0.40, hrv: 0.35, eeg: 0.25 };
const EPS = 1e-10, STALE_MS = 5000, ALPHA = 0.25;
const clip = (x, lo, hi) => Math.min(hi == null ? 1 : hi, Math.max(lo == null ? 0 : lo, x));
const ok = v => v != null && isFinite(v);

/* ---------- component equations (return null for an invalid input, never 0) ---------- */
function hrComponent(hr, base, high) { if (!ok(hr)) return null; if (!(high > base)) throw new Error("Invalid heart-rate calibration"); return clip((hr - base) / (high - base)); }
function hrvComponent(hrv, base, low) { if (!ok(hrv)) return null; if (!(base > low)) throw new Error("Invalid HRV calibration"); return clip((base - hrv) / (base - low)); }
function eegComponent(r, base, high) { if (!ok(r)) return null; if (!(high > base)) throw new Error("Invalid EEG calibration"); return clip((r - base) / (high - base)); }

/* RMSSD in ms of successive IBI differences (spec section 5: sqrt(mean(diff^2))). null with fewer than 2 intervals. */
function rmssd(ibisMs) {
  if (!ibisMs || ibisMs.length < 2) return null;
  let s = 0; for (let i = 1; i < ibisMs.length; i++) { const d = ibisMs[i] - ibisMs[i - 1]; s += d * d; }
  return Math.sqrt(s / (ibisMs.length - 1));
}
/* beta / (alpha + eps) from band powers. */
const betaAlpha = (alpha, beta) => beta / (alpha + EPS);
/* combine per-channel ratios by their median (spec section 6); channels that are null/NaN are left out. */
function medianRatio(ratios) {
  const a = ratios.filter(ok).sort((x, y) => x - y), n = a.length;
  return n ? (n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : null;
}
/* combined score from components. Missing ones (null) are dropped and the weights renormalised.
   Returns {score, partial, confidence, used} or null when no component is valid. */
function combine(c) {
  let ws = 0, acc = 0; const used = [];
  Object.keys(W).forEach(k => { if (ok(c[k])) { acc += W[k] * c[k]; ws += W[k]; used.push(k); } });
  if (!ws) return null;
  return { score: clip(acc / ws * 100, 0, 100), partial: used.length < 3, confidence: ws, used };
}
function label(s) { return s <= 20 ? "Low arousal" : s <= 40 ? "Mild arousal" : s <= 60 ? "Moderate arousal" : s <= 80 ? "High arousal" : "Very high arousal"; }
function smooth(next, prev, alpha) { alpha = alpha == null ? ALPHA : alpha; return prev == null ? next : alpha * next + (1 - alpha) * prev; }

/* Starting estimates for the personalised references, from the spec's example (65 -> 105 bpm, 42 -> 20 ms, 0.85 -> 1.5).
   NOT validated: replace them with values measured from real recordings. */
function defaultRefs(base) {
  const r = {};
  if (ok(base.hr)) r.hrHigh = base.hr + 40;
  if (ok(base.hrv)) r.hrvLow = base.hrv * 0.5;
  if (ok(base.ratio)) r.ratioHigh = base.ratio * 1.75;
  return r;
}
const median = a => medianRatio(a);

function makeArousalMeter(cfg) {
  cfg = cfg || {};
  const minN = cfg.minSamples || 30, alpha = cfg.alpha || ALPHA, staleMs = cfg.staleMs || STALE_MS;
  const M = { base: null, refs: null, rec: null, value: null, raw: null, comp: {}, used: [], partial: false, confidence: 0, lastValidAt: null, lastIn: {}, error: "" };
  M.startBaseline = () => { M.rec = { hr: [], hrv: [], ratio: [] }; M.error = ""; };
  M.recording = () => !!M.rec;
  /* f = {hr, hrv, ratio} already screened by the caller (null where the signal is invalid or movement-gated) */
  M.pushBaseline = f => { if (!M.rec) return; ["hr", "hrv", "ratio"].forEach(k => { if (ok(f[k])) M.rec[k].push(f[k]); }); };
  M.baselineCount = () => M.rec ? Math.max(M.rec.hr.length, M.rec.hrv.length, M.rec.ratio.length) : 0;
  /* needs `minSamples` clean readings per signal; the others are left out (no baseline means that component is skipped later) */
  M.finishBaseline = (refs) => {
    const r = M.rec; M.rec = null; if (!r) return false;
    const base = {}; ["hr", "hrv", "ratio"].forEach(k => { if (r[k].length >= minN) base[k] = median(r[k]); });
    if (!Object.keys(base).length) { M.error = "Not enough clean signal during the baseline."; return false; }
    M.base = base; M.refs = Object.assign(defaultRefs(base), refs || {}); M.value = null; M.raw = null; M.lastValidAt = null; M.error = "";
    return true;
  };
  M.setBaseline = (base, refs) => { M.base = base; M.refs = Object.assign(defaultRefs(base), refs || {}); M.value = null; M.raw = null; M.lastValidAt = null; };
  M.ready = () => !!M.base;
  M.components = f => {
    const b = M.base, r = M.refs, c = { hr: null, hrv: null, eeg: null };
    if (!b) return c;
    if (b.hr != null) c.hr = hrComponent(f.hr, b.hr, r.hrHigh);
    if (b.hrv != null) c.hrv = hrvComponent(f.hrv, b.hrv, r.hrvLow);
    if (b.ratio != null) c.eeg = eegComponent(f.ratio, b.ratio, r.ratioHigh);
    return c;
  };
  /* one update with the newest measurements. Returns the result object of spec section 13 (score null until a valid measurement). */
  M.update = (f, now) => {
    now = now == null ? Date.now() : now;
    const c = M.components(f), res = combine(c);
    M.comp = c; M.lastIn = f;
    if (res) { M.raw = res.score; M.value = smooth(res.score, M.value, alpha); M.used = res.used; M.partial = res.partial; M.confidence = res.confidence; M.lastValidAt = now; }
    else { M.used = []; M.partial = false; M.confidence = 0; }
    return M.result(now);
  };
  M.stale = now => M.lastValidAt == null || (now == null ? Date.now() : now) - M.lastValidAt > staleMs;
  M.result = now => {
    now = now == null ? Date.now() : now;
    const have = M.value != null, st = M.stale(now);
    return {
      stress_score: have ? Math.round(M.value * 100) / 100 : null,
      score_valid: have && !st,
      stale: have && st,
      partial: have && M.partial,
      confidence: M.confidence,
      label: have ? label(M.value) : "No score",
      heart_rate_bpm: ok(M.lastIn.hr) ? M.lastIn.hr : null,
      rmssd_ms: ok(M.lastIn.hrv) ? M.lastIn.hrv : null,
      beta_alpha_ratio: ok(M.lastIn.ratio) ? M.lastIn.ratio : null,
      components: { heart_rate: M.comp.hr == null ? null : M.comp.hr, hrv_decrease: M.comp.hrv == null ? null : M.comp.hrv, eeg: M.comp.eeg == null ? null : M.comp.eeg },
      signal_quality: { ppg_valid: ok(M.lastIn.hr), hrv_valid: ok(M.lastIn.hrv), eeg_valid: ok(M.lastIn.ratio), motion_valid: M.lastIn.motionOk !== false },
      timestamp: now / 1000
    };
  };
  return M;
}

const API = { W, EPS, STALE_MS, clip, hrComponent, hrvComponent, eegComponent, rmssd, betaAlpha, medianRatio, combine, label, smooth, defaultRefs, makeArousalMeter };
if (typeof module !== "undefined" && module.exports) module.exports = API;
root.Arousal = API;
})(typeof window !== "undefined" ? window : globalThis);

```

## stress.js

```js
/* Experimental stress meter for the Muse 2 panel.
   NOT a validated stress measure. EEG cannot read stress directly. This combines three signals that tend to move with
   arousal and learns, PER PERSON, which of them actually respond:
     - heart rate (pulse sensor)
     - frontal beta / alpha (AF7 + AF8)
     - facial muscle tension (30-44 Hz on the forehead sensors; clenching, frowning)
   Calibration has two phases: a calm baseline, then a short mental-arithmetic task that raises arousal. Each signal is
   scored by how far it moved between the two phases (effect size d). Signals that did not respond (d < 0.5) are ignored
   and the report says so. Score: 20 = your calm level, 80 = your level during the task, clamped to 0..100.
   If the task is skipped it falls back to "20 = calm, 100 = 3 SD above calm" using the calm phase only.
   Core maths has no DOM and is tested in stress.test.js. */
"use strict";
(function (root) {

const FS = 256, WIN = 512, MIN_D = 0.5;
/* dir = expected direction under stress (+1 up, -1 down, 0 unknown). twoSided signals may be used if they move either way
   for this person (literature on frontal asymmetry and beta/alpha is mixed). */
const COMPS = {
  hr: { w: 0.40, minSd: 3.0, label: "HEART RATE", dir: 1 },
  hrv: { w: 0.40, minSd: 8.0, label: "HRV (RMSSD)", dir: -1, twoSided: true },
  ratio: { w: 0.35, minSd: 0.15, label: "BETA/ALPHA", dir: 1, twoSided: true },
  tension: { w: 0.25, minSd: 0.15, label: "MUSCLE TENSION", dir: 1 },
  faa: { w: 0.20, minSd: 0.10, label: "FRONTAL ASYMMETRY", dir: 0, twoSided: true }
};
const KEYS = Object.keys(COMPS);

/* ---------- spectrum ---------- */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
/* x: 512 samples in uV. Returns power (uV^2) in alpha 8-13, beta 13-30, gamma 30-44 and total 1-44 Hz. */
function bandPowers(x) {
  const n = WIN, re = new Float64Array(n), im = new Float64Array(n);
  let mean = 0; for (let i = 0; i < n; i++) mean += x[i]; mean /= n;
  for (let i = 0; i < n; i++) re[i] = (x[i] - mean) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
  fft(re, im);
  const df = FS / n, band = (lo, hi) => { let s = 0; for (let k = Math.ceil(lo / df); k * df < hi && k < n / 2; k++) s += (re[k] * re[k] + im[k] * im[k]); return s; };
  return { alpha: band(8, 13), beta: band(13, 30), gamma: band(30, 44), total: band(1, 44) };
}
/* windows: array of 512-sample arrays (the usable frontal channels). Returns {ratio, tension} (ln values) or null parts. */
function eegFeatures(windows, rejectRatio) {
  if (!windows.length) return { ratio: null, tension: null };
  let a = 0, b = 0, g = 0, t = 0;
  windows.forEach(w => { const p = bandPowers(w); a += p.alpha; b += p.beta; g += p.gamma; t += p.total; });
  const eps = 1e-6;
  return { ratio: rejectRatio ? null : Math.log((b + eps) / (a + eps)), tension: Math.log((g + eps) / (t + eps)) };
}

/* Frontal alpha asymmetry: ln(alpha AF8) - ln(alpha AF7). Windows are 512-sample arrays. */
function faa(w7, w8) { const eps = 1e-6; return Math.log(bandPowers(w8).alpha + eps) - Math.log(bandPowers(w7).alpha + eps); }

/* ---------- heart rate variability from the pulse signal ---------- */
/* x: band-passed pulse samples (NaN = missing). Returns beat positions in samples (fractional), min spacing 0.35 s. */
function findBeats(x, fs) {
  const n = x.length, minDist = Math.round(0.35 * fs), beats = [];
  let sum = 0, cnt = 0; for (let i = 0; i < n; i++) if (x[i] === x[i]) { sum += x[i] * x[i]; cnt++; }
  if (cnt < fs * 3) return beats;
  const thr = 0.35 * Math.sqrt(sum / cnt);
  for (let i = 1; i < n - 1; i++) {
    const a = x[i - 1], b = x[i], c = x[i + 1];
    if (!(a === a && b === b && c === c) || b < thr || b < a || b <= c) continue;
    const den = a - 2 * b + c, off = den < 0 ? 0.5 * (a - c) / den : 0, pos = i + off;
    if (beats.length && pos - beats[beats.length - 1] < minDist) { if (b > x[Math.round(beats[beats.length - 1])]) beats[beats.length - 1] = pos; continue; }
    beats.push(pos);
  }
  return beats;
}
/* Inter-beat intervals (ms) from beat times in seconds; drops impossible intervals and jumps (missed or extra beats). */
function ibisFromBeats(times) {
  const out = [];
  for (let i = 1; i < times.length; i++) {
    const ms = (times[i] - times[i - 1]) * 1000;
    if (ms < 400 || ms > 1500) continue;
    const prev = out.length ? out[out.length - 1] : null;
    if (prev != null && Math.abs(ms - prev) > 0.3 * prev) continue;
    out.push(ms);
  }
  return out;
}
/* RMSSD in ms from successive differences (needs >= 15 intervals); null otherwise. */
function rmssd(ibis) {
  if (ibis.length < 15) return null;
  let s = 0; for (let i = 1; i < ibis.length; i++) { const d = ibis[i] - ibis[i - 1]; s += d * d; }
  return Math.sqrt(s / (ibis.length - 1));
}

/* ---------- the arithmetic task (pure, so it can be tested) ---------- */
/* Count backwards from `start` by `step`. A wrong answer sends you back to the start (the classic stressor). */
function makeTask(start, step) {
  start = start || 1022; step = step || 13;
  const T = { cur: start, start, step, correct: 0, wrong: 0 };
  T.prompt = () => `${T.cur} - ${T.step}`;
  T.answer = v => { if (+v === T.cur - T.step) { T.cur -= T.step; T.correct++; if (T.cur - T.step < 0) T.cur = T.start; return true; } T.wrong++; T.cur = T.start; return false; };
  return T;
}

/* ---------- baseline, model, score ---------- */
function stats(a) { const m = a.reduce((s, v) => s + v, 0) / a.length; const sd = Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length); return { m, sd }; }
function phaseStats(samples, min) {
  const out = {};
  KEYS.forEach(k => { if (samples[k].length >= min) { const st = stats(samples[k]); out[k] = { m: st.m, sd: Math.max(st.sd, COMPS[k].minSd), n: samples[k].length }; } });
  return out;
}
function makeMeter(cfg) {
  cfg = cfg || {};
  const minN = cfg.minSamples || 10, ema = cfg.ema || 0.25;
  const M = { phases: {}, cur: null, model: null, base: null, value: null, z: {}, used: [], report: [] };
  M.startPhase = name => { M.cur = { name, s: Object.fromEntries(KEYS.map(k => [k, []])) }; };
  M.startCal = () => { M.phases = {}; M.model = null; M.base = null; M.value = null; M.startPhase("calm"); };
  M.push = f => { if (!M.cur) return; KEYS.forEach(k => { if (f[k] != null && isFinite(f[k])) M.cur.s[k].push(f[k]); }); };
  M.endPhase = () => { const c = M.cur; M.cur = null; if (!c) return null; const st = phaseStats(c.s, minN); M.phases[c.name] = st; if (c.name === "calm") M.base = st; return st; };
  M.phaseCount = () => M.cur ? Math.max(...KEYS.map(k => M.cur.s[k].length)) : 0;
  /* build the scoring model from the calm phase (required) and the task phase (optional). Returns true if usable. */
  M.build = () => {
    const calm = M.phases.calm, task = M.phases.stress; M.report = []; M.model = null;
    if (!calm || !Object.keys(calm).length) return false;
    const two = {}, one = {};
    KEYS.forEach(k => {
      if (!calm[k]) { M.report.push({ key: k, status: "no data" }); return; }
      if (COMPS[k].dir) one[k] = { mc: calm[k].m, sd: calm[k].sd, w: COMPS[k].w, dir: COMPS[k].dir };
      const s = task && task[k];
      if (!s) { M.report.push({ key: k, status: task ? "no data in task" : "calm only" }); return; }
      const d = (s.m - calm[k].m) / Math.sqrt((calm[k].sd * calm[k].sd + s.sd * s.sd) / 2);
      if ((COMPS[k].twoSided ? Math.abs(d) : d) >= MIN_D) { two[k] = { mc: calm[k].m, ms: s.m, w: Math.min(Math.abs(d), 3) }; M.report.push({ key: k, status: "used", d, inverse: d < 0 && COMPS[k].dir > 0 || d > 0 && COMPS[k].dir < 0 }); }
      else M.report.push({ key: k, status: "ignored", d });
    });
    if (Object.keys(two).length) M.model = { mode: "two-point", comps: two };
    else M.model = { mode: "baseline-only", comps: one, weak: !!task };
    return true;
  };
  M.finishCal = () => { M.endPhase(); return M.build(); };       // calm-only convenience
  M.ready = () => !!M.model;
  M.score = f => {
    if (!M.model) return null;
    let wsum = 0, acc = 0; M.used = []; M.z = {};
    const two = M.model.mode === "two-point";
    Object.keys(M.model.comps).forEach(k => {
      const c = M.model.comps[k];
      if (f[k] == null || !isFinite(f[k])) return;
      const v = two ? Math.max(-0.5, Math.min(1.5, (f[k] - c.mc) / (c.ms - c.mc))) : Math.max(-4, Math.min(4, c.dir * (f[k] - c.mc) / c.sd));
      M.z[k] = v; acc += c.w * v; wsum += c.w; M.used.push(k);
    });
    if (!wsum) return M.value;
    const mean = acc / wsum;
    const raw = Math.max(0, Math.min(100, two ? 20 + 60 * mean : 20 + 80 * mean / 3));
    M.value = M.value == null ? raw : M.value + ema * (raw - M.value);
    return M.value;
  };
  return M;
}

/* Spec model (arousal.js): beta/alpha per usable channel, then the median across channels. null when no channel is usable. */
function medianBetaAlpha(windows) {
  const A = root.Arousal; if (!A || !windows.length) return null;
  return A.medianRatio(Array.from(windows, w => { const p = bandPowers(w); return A.betaAlpha(p.alpha, p.beta); }));
}

const API = { medianBetaAlpha, fft, bandPowers, eegFeatures, faa, findBeats, ibisFromBeats, rmssd, makeMeter, makeTask, COMPS, FS, WIN, MIN_D };

/* ---------- panel attachment (browser only) ---------- */
const TICK_MS = 250;                 // score updates 4 times per second
function attach(cfg) {
  const CAL_SEC = +(cfg.calSec || 30), TASK_SEC = +(cfg.taskSec || CAL_SEC), meter = makeMeter({ minSamples: Math.min(10, Math.floor(CAL_SEC / 2)), ema: 0.3 });
  const css = document.createElement("style");
  css.textContent = `#stressCard{position:fixed;left:12px;bottom:12px;width:300px;z-index:50;background:rgba(5,10,40,.92);border:1px solid rgba(110,150,255,.6);border-radius:10px;padding:10px 12px;color:#e9f1ff;font:12px "Segoe UI",system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.5)}
#stressCard .hd{display:flex;justify-content:space-between;align-items:center}#stressCard b.t{letter-spacing:.2em;font-size:10px;color:#9fb2e6}
#stressCard .st{display:flex;align-items:center;gap:6px;font-size:11px;letter-spacing:.14em;font-weight:700;margin:2px 0 6px}#stressCard .st i{width:9px;height:9px;border-radius:50%;background:#6a7391}
#stressCard .row{display:flex;align-items:flex-end;gap:10px}#stressCard .n{font-size:40px;font-weight:300;line-height:1;min-width:74px}
#stressCard canvas{flex:1;height:46px;background:#050a26;border-radius:4px;box-shadow:inset 0 0 0 1px #2d3c6a}
#stressCard .bar{height:12px;border-radius:3px;background:#050a26;box-shadow:inset 0 0 0 1px #2d3c6a;overflow:hidden;margin:5px 0 6px}
#stressCard .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#3fd6ff,#ffd166 60%,#ff453a);transition:width .2s}
#stressCard .sig{display:grid;grid-template-columns:10px 1fr 64px 42px;gap:6px;align-items:center;font-size:10px;letter-spacing:.06em;color:#9fb2e6;margin-top:3px}
#stressCard .sig i{width:8px;height:8px;border-radius:50%;background:#3a4166}#stressCard .sig i.on{background:#43f28a;box-shadow:0 0 6px #43f28a}#stressCard .sig .m{height:6px;background:#050a26;border-radius:3px;overflow:hidden;box-shadow:inset 0 0 0 1px #2d3c6a}
#stressCard .sig .m u{display:block;height:100%;width:0;background:#6fa8ff;text-decoration:none;transition:width .2s}#stressCard .sig b{font-weight:400;color:#dfe8ff;text-align:right}#stressCard .sig em{font-style:normal;text-align:right;color:#7f93c9}
#stressCard button{background:#16215a;border:1px solid #4a6adf;color:#e9f1ff;border-radius:5px;padding:5px 10px;font-size:11px;cursor:pointer;margin:6px 6px 0 0}#stressCard button:disabled{opacity:.45;cursor:default}
#stressCard small{display:block;color:#7f93c9;line-height:1.4;margin-top:6px;font-size:10px}#stressCard .demo{margin-top:6px;border-top:1px solid #2d3c6a;padding-top:6px}#stressCard .demo label{display:flex;justify-content:space-between;gap:8px;align-items:center;color:#9fb2e6}
#stressCard .task{display:none;margin-top:6px}#stressCard .task .q{font-size:22px;font-weight:300;margin:2px 0}#stressCard .task input{width:90px;background:#050a26;border:1px solid #4a6adf;color:#fff;border-radius:4px;padding:4px 6px;font-size:16px}
#stressCard .ok{color:#6fe7a8}#stressCard .no{color:#ff9db0}#stressCard .tg{background:none;border:0;color:#9fb2e6;cursor:pointer;font-size:12px;padding:0 2px;margin:0}#stressCard .ar{margin-top:8px;border-top:1px solid #2d3c6a;padding-top:6px}#stressCard .ar .arow{display:flex;gap:10px;align-items:baseline}#stressCard .ar .n2{font-size:28px;font-weight:300;min-width:56px}#stressCard .ar .stale{opacity:.5}#stressCard #stCal,#stressCard #stSkip,#stressCard #stMsg,#stressCard #stHint,#stressCard #stTask,#stressCard .sig[data-k],#stressCard .ar .arow,#stressCard .ar>.bar{display:none!important}#stressCard.min>*:not(.hd):not(.st):not(.row){display:none}`;
  document.head.appendChild(css);
  const card = document.createElement("div"); card.id = "stressCard";
  const sigRows = KEYS.map(k => `<div class="sig" data-k="${k}"><i></i><span>${COMPS[k].label}</span><span class="m"><u></u></span><em>--</em></div>`).join("");
  card.innerHTML = `<div class="hd"><b class="t">AROUSAL / STRESS (EXPERIMENTAL)</b><button class="tg" id="stTg" title="Collapse">&#9662;</button></div><div class="st"><i id="stDot"></i><span id="stState">NOT CALIBRATED</span></div>
   <div class="row"><div class="n" id="stN">--</div><canvas id="stCv" width="400" height="92"></canvas></div><div class="bar"><i id="stBar"></i></div>
   ${sigRows}
   <div class="task" id="stTask"><small id="stTaskMsg"></small><div class="q" id="stQ"></div><input id="stIn" inputmode="numeric" autocomplete="off"><span id="stFb" style="margin-left:6px"></span></div>
   <div class="ar" id="arBox"><b class="t">AROUSAL (SPEC MODEL)</b><div class="arow"><span class="n2" id="arN">--</span><span id="arLbl">no baseline</span></div><div id="arLbl2" style="font-size:11px;color:#9fb2e6"></div>
    <div class="bar"><i id="arBar"></i></div><div class="sig" style="grid-template-columns:70px 1fr 42px"><span>HEART</span><span class="m"><u id="arH"></u></span><em id="arHv">--</em></div>
    <div class="sig" style="grid-template-columns:70px 1fr 42px"><span>HRV DROP</span><span class="m"><u id="arV"></u></span><em id="arVv">--</em></div>
    <div class="sig" style="grid-template-columns:70px 1fr 42px"><span>EEG B/A</span><span class="m"><u id="arE"></u></span><em id="arEv">--</em></div>
    <button id="arCal">Arousal baseline (2 min, sit still)</button><small id="arMsg">F = 100 &middot; clip(0.40 H + 0.35 V + 0.25 E). Estimates arousal, not fear. Missing or movement-rejected signals are left out, never counted as zero.</small></div>
   <button id="stCal">Calibrate (calm, then a short task)</button><button id="stSkip" style="display:none">Skip task</button><div id="stMsg"></div>
   <small id="stHint">Quick check: clench your jaw (muscle tension jumps), hold a slow breath, then do mental arithmetic. Green dots = that signal is arriving; bars = how far each has moved from your calm level.</small>
   <small>Not a validated stress measure. EEG cannot read stress directly.</small>`;
  document.body.appendChild(card);
  const $ = id => card.querySelector("#" + id), msg = $("stMsg"), cv = $("stCv"), g = cv.getContext("2d");
  $("stTg").addEventListener("click", () => { card.classList.toggle("min"); $("stTg").innerHTML = card.classList.contains("min") ? "&#9656;" : "&#9662;"; });
  if (cfg.demo) {
    const d = document.createElement("div"); d.className = "demo";
    d.innerHTML = `<b class="t">DEMO SIGNAL (simulated headband)</b><label>Heart rate <input type="range" id="dHr" min="50" max="130" value="72"><b id="dHrV">72</b></label><label>Beta <input type="range" id="dBe" min="5" max="70" value="14"><b id="dBeV">14</b></label><label>Face tension <input type="range" id="dGa" min="2" max="60" value="6"><b id="dGaV">6</b></label>`;
    card.appendChild(d);
    [["dHr", "demoHr"], ["dBe", "demoBeta"], ["dGa", "demoGamma"]].forEach(([id, v]) => { const e = d.querySelector("#" + id); e.addEventListener("input", () => { window[v] = +e.value; d.querySelector("#" + id + "V").textContent = e.value; }); });
  }

  const DEFAULT_MSG = `<small>Step 1: sit still and relax with your eyes open for ${CAL_SEC} s. Step 2: a ${TASK_SEC} s arithmetic task. The meter learns which of your signals respond.</small>`;
  const AR = root.Arousal ? root.Arousal.makeArousalMeter({ minSamples: 30 }) : null, AR_SEC = +(cfg.arSec || 120); let arT0 = 0;
  let noSigMsg = false, phase = null, phaseT0 = 0, task = null, feat = {}, lastRatio = null, lastSigAt = Date.now(), lastPush = 0, tickN = 0;
  let beats = [], absPos = 0, lastPos = null, lastFilled = 0, hist = [], lastArt = 0;
  const say = html => { msg.innerHTML = html; noSigMsg = false; };
  say(DEFAULT_MSG);

  /* HRV and a fast heart rate from the pulse ring buffer. Beat times use the sample position (device clock), not arrival time, so packet jitter does not leak in. */
  function pulse() {
    const w = cfg.ppgWindow ? cfg.ppgWindow() : null;
    if (!w) { beats = []; lastPos = null; return { hr: null, hrv: null }; }
    if (lastPos == null || w.filled < lastFilled) { beats = []; absPos = 0; }
    else absPos += (w.pos - lastPos + w.len) % w.len;
    lastPos = w.pos; lastFilled = w.filled;
    const found = findBeats(w.x, w.fs), n = w.x.length;
    found.forEach(p => { const t = (absPos - (n - 1 - p)) / w.fs; if (!beats.length || t > beats[beats.length - 1] + 0.35) beats.push(t); });
    const tEnd = absPos / w.fs; beats = beats.filter(t => t > tEnd - 45);
    const recent = ibisFromBeats(beats.filter(t => t > tEnd - 8)), hrFast = recent.length >= 4 ? 60000 / (recent.slice(-6).reduce((a, b) => a + b, 0) / recent.slice(-6).length) : null;
    return { hr: hrFast, hrv: rmssd(ibisFromBeats(beats.filter(t => t > tEnd - 30))) };
  }

  /* spec model: heart rate and HRV are rejected while the headband moves, the EEG ratio on any artifact (movement or blink). One reading per second. */
  const ARKEY = "muse2panel.arousalbase";
  try { const j = JSON.parse(localStorage.getItem(ARKEY) || "null"); if (AR && j && j.base && j.refs) AR.setBaseline(j.base, j.refs); } catch (e) {}
  let arLast = 0;
  function arTick(pu, wins, art) {
    const now = Date.now(); if (now - arLast < 1000) return; arLast = now;
    const mv = cfg.motionBad ? cfg.motionBad() : art;
    const f = { hr: mv ? null : feat.hr, hrv: mv ? null : feat.hrv, ratio: art ? null : API.medianBetaAlpha(wins), motionOk: !mv };
    if (AR.recording()) {
      AR.pushBaseline(f); const left = Math.max(0, AR_SEC - (now - arT0) / 1000);
      $("arMsg").textContent = `Baseline: sit still and relax... ${Math.ceil(left)} s (${AR.baselineCount()} clean readings)`;
      if (left <= 0) { const okb = AR.finishBaseline(); if (okb) try { localStorage.setItem(ARKEY, JSON.stringify({ base: AR.base, refs: AR.refs })); } catch (e) {} $("arCal").disabled = false; $("arCal").textContent = "Arousal baseline (2 min, sit still)"; $("arMsg").textContent = okb ? `Baseline saved: ${Object.keys(AR.base).map(k => k + " " + AR.base[k].toFixed(2)).join(", ")}. References are starting estimates.` : AR.error; }
    } else if (AR.ready()) AR.update(f, now);
    arRender();
  }
  function arRender() {
    if (!AR) return; const r = AR.result(), c = r.components, has = r.stress_score != null;
    $("arN").textContent = has ? Math.round(r.stress_score) : "--"; $("arBar").style.width = (has ? r.stress_score : 0) + "%";
    $("arLbl2").textContent = $("arLbl").textContent = !AR.ready() ? (AR.recording() ? "recording baseline" : "no baseline") : !has ? "waiting for valid signal" : r.label + (r.stale ? " (stale)" : r.partial ? " (partial, " + Math.round(r.confidence * 100) + "% confidence)" : "");
    $("arN").className = "n2" + (r.stale ? " stale" : "");
    [["arH", "arHv", c.heart_rate], ["arV", "arVv", c.hrv_decrease], ["arE", "arEv", c.eeg]].forEach(([b, t, v]) => { $(b).style.width = (v == null ? 0 : v * 100) + "%"; $(t).textContent = v == null ? "--" : Math.round(v * 100) + "%"; });
  }
  function tick() {
    tickN++;
    if (!cfg.connected()) { feat = {}; beats = []; lastPos = null; if (phase) abort("Headband disconnected. Calibration cancelled."); render(); return; }
    const wins = cfg.frontalWindows(), art = cfg.artifact(); if (art) lastArt = Date.now();
    const e = eegFeatures(wins, art); if (e.ratio != null) lastRatio = e.ratio;
    const pu = pulse();
    feat = { hr: pu.hr != null ? pu.hr : cfg.heartRate(), hrv: pu.hrv, ratio: e.ratio != null ? e.ratio : lastRatio, tension: wins.length ? e.tension : null,
      faa: (!art && wins.af7 && wins.af8) ? faa(wins.af7, wins.af8) : null };
    if (AR) arTick(pu, wins, art);
    if (feat.hr != null || wins.length) lastSigAt = Date.now();
    const sec = Date.now(), oneHz = sec - lastPush >= 1000; if (oneHz) lastPush = sec;
    if (phase) {
      const len = phase === "calm" ? CAL_SEC : TASK_SEC, el = (sec - phaseT0) / 1000, left = Math.max(0, len - el);
      if (oneHz && el >= Math.min(8, 0.3 * len)) meter.push(feat);   // skip the first seconds: heart rate needs a few beats and arousal takes time to build
      if (phase === "calm") say(`<small>Step 1 of 2: stay relaxed and still... ${Math.ceil(left)} s</small>`);
      else say(`<small>Step 2 of 2: keep going, faster! ${Math.ceil(left)} s. Mistakes send you back to the start.</small>`);
      if (left <= 0) endPhase();
    } else { meter.score(feat); if (AR && AR.value != null && AR.ready()) { hist.push(AR.value); if (hist.length > 240) hist.shift(); } }
    render();
  }
  function startCal() { meter.startCal(); phase = "calm"; phaseT0 = Date.now(); hist = []; $("stCal").disabled = true; $("stSkip").style.display = "none"; $("stTask").style.display = "none"; }
  function endPhase() {
    meter.endPhase();
    if (phase === "calm") {
      const have = Object.keys(meter.phases.calm || {});
      if (!have.length) return abort("Not enough clean signal during the calm phase. Check the headband fit and try again.");
      phase = null; $("stSkip").style.display = "inline-block"; $("stCal").textContent = "Start the task"; $("stCal").disabled = false; $("stCal").dataset.mode = "task";
      say(`<small>Calm baseline recorded (${have.map(k => COMPS[k].label.toLowerCase()).join(", ")}). Step 2: count backwards from 1022 by 13 as fast as you can. Type each answer and press Enter. Press "Start the task" when ready, or skip.</small>`);
    } else { phase = null; finishModel(); }
  }
  function startTask() {
    task = makeTask(1022, 13); phase = "stress"; phaseT0 = Date.now(); meter.startPhase("stress");
    $("stCal").disabled = true; $("stSkip").style.display = "none"; $("stTask").style.display = "block"; $("stTaskMsg").textContent = "Count backwards by 13. Type the answer, press Enter.";
    $("stQ").textContent = task.prompt() + " = ?"; $("stIn").value = ""; $("stFb").textContent = ""; $("stIn").focus();
  }
  function finishModel() {
    $("stTask").style.display = "none"; $("stCal").textContent = "Calibrate again"; $("stCal").dataset.mode = ""; $("stCal").disabled = false; $("stSkip").style.display = "none";
    if (!meter.build()) return say(`<small class="no">Calibration failed: not enough clean signal.</small>`);
    const rows = meter.report.map(r => r.status === "used" ? `<span class="ok">used</span> ${COMPS[r.key].label.toLowerCase()} (d ${r.d.toFixed(1)}${r.inverse ? ", moves opposite to the usual direction" : ""})` : r.status === "ignored" ? `<span class="no">ignored</span> ${COMPS[r.key].label.toLowerCase()} (d ${r.d.toFixed(1)}: did not respond)` : `<span class="no">${r.status}</span> ${COMPS[r.key].label.toLowerCase()}`).join("<br>");
    const m = meter.model;
    say(`<small>${m.mode === "two-point" ? "Ready. 20 = your calm, 80 = your level during the task." : m.weak ? "<span class='no'>The task did not change any signal for you, so the meter uses calm-baseline-only scoring (less reliable).</span>" : "Calm-baseline-only scoring (task skipped): 20 = calm, 100 = about 3 SD above."}<br>${rows}</small>`);
  }
  function abort(why) { phase = null; meter.cur = null; $("stTask").style.display = "none"; $("stCal").textContent = "Calibrate (calm, then a short task)"; $("stCal").dataset.mode = ""; $("stCal").disabled = !cfg.connected(); $("stSkip").style.display = "none"; say(`<small class="no">${why}</small>`); }

  function status() {
    if (!cfg.connected()) return ["NO HEADBAND", "#6a7391"];
    if (Date.now() - lastSigAt > 5000) return ["NO SIGNAL", "#ff453a"];
    if (phase) return ["CALIBRATING", "#4da3ff"];
    if (!(AR ? AR.ready() : meter.ready())) return ["NOT CALIBRATED", "#ffd166"];
    return ["LIVE", "#43f28a"];
  }
  function drawSpark() {
    const W = cv.width, H = cv.height; g.clearRect(0, 0, W, H);
    g.strokeStyle = "rgba(110,150,255,.25)"; g.lineWidth = 1; g.beginPath(); [20, 50, 80].forEach(v => { const y = H - v / 100 * H; g.moveTo(0, y); g.lineTo(W, y); }); g.stroke();
    if (hist.length < 2) return;
    g.strokeStyle = "#ffd166"; g.lineWidth = 2; g.beginPath();
    hist.forEach((v, i) => { const x = W - (hist.length - 1 - i) / 240 * W, y = H - Math.max(0, Math.min(100, v)) / 100 * H; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
  }
  function render() {
    const [stateTxt, col] = status(), live = stateTxt === "LIVE";
    $("stState").textContent = stateTxt; $("stState").style.color = col; $("stDot").style.background = col; $("stDot").style.boxShadow = live && tickN % 2 ? `0 0 8px ${col}` : "none";
    const v = (cfg.connected() && live && AR && AR.ready()) ? AR.value : null;
    $("stN").textContent = v == null ? "--" : Math.round(v); $("stBar").style.width = (v == null ? 0 : v) + "%";
    const z = meter.z || {}, used = {}; (meter.report || []).forEach(r => used[r.key] = r);
    card.querySelectorAll(".sig[data-k]").forEach(row => {
      const k = row.dataset.k, have = feat[k] != null && isFinite(feat[k]) && cfg.connected(), pos = (meter.ready() && z[k] != null) ? z[k] : null;
      row.querySelector("i").className = have ? "on" : "";
      const two = meter.model && meter.model.mode === "two-point", u = row.querySelector("u");
      u.style.width = pos == null ? "0" : Math.max(0, Math.min(100, (two ? pos : (pos + 1) / 4) * (two ? 66 : 100))) + "%";
      const r = used[k], em = row.querySelector("em"); em.textContent = !meter.ready() ? (have ? "live" : "--") : !r ? "--" : r.status === "used" ? "used" : r.status === "ignored" ? "ignored" : "no data";
      em.style.color = r && r.status === "used" ? "#6fe7a8" : r && r.status === "ignored" ? "#ff9db0" : "#7f93c9";
    });
    drawSpark();
    if (!phase && !$("stCal").dataset.mode) $("stCal").disabled = !cfg.connected();
    if (cfg.connected() && stateTxt === "NO SIGNAL" && !phase) { say(`<small class="no">No usable signal for 5 s. Check the headband fit and sensor contact.</small>`); noSigMsg = true; }
    else if (noSigMsg) say(meter.ready() ? `<small>Signal is back.</small>` : DEFAULT_MSG);
  }
  $("stCal").addEventListener("click", () => { if ($("stCal").dataset.mode === "task") startTask(); else startCal(); });
  $("stSkip").addEventListener("click", () => { phase = null; $("stCal").dataset.mode = ""; finishModel(); });
  $("stIn").addEventListener("keydown", e => {
    if (e.key !== "Enter" || !task) return; e.stopPropagation();
    const ok = task.answer($("stIn").value); $("stFb").textContent = ok ? "correct" : "WRONG, back to " + task.start; $("stFb").style.color = ok ? "#6fe7a8" : "#ff6b6b";
    $("stQ").textContent = task.prompt() + " = ?"; $("stIn").value = "";
  });
  $("arCal").addEventListener("click", () => { if (!AR || !cfg.connected()) return; AR.startBaseline(); arT0 = Date.now(); $("arCal").disabled = true; $("arCal").textContent = "Recording baseline..."; });
  card.addEventListener("keydown", e => e.stopPropagation());
  setInterval(tick, TICK_MS);
  render();
  return { arousal: AR, value: () => (cfg.connected() && AR && AR.ready() && Date.now() - lastSigAt <= 5000) ? AR.value : null, ready: () => !!(AR && AR.ready()), meter, task: () => task, _tick: tick, _startCal: startCal, _startTask: startTask, _skip: () => $("stSkip").click(), _feat: () => feat };
}

API.attach = attach;
if (typeof module !== "undefined" && module.exports) module.exports = API;
root.Stress = API;
})(typeof window !== "undefined" ? window : globalThis);

```

## game/menu.js

```js
/* Game menu for the Muse panel. Games register themselves here; the panel only supplies live signals.

   Add a game with one call (before or after the panel loads):

     GameMenu.register({
       id: "my-game",                       // unique
       title: "My Game",
       blurb: "One line about it.",
       input: "stress",                     // what drives it: "stress" | "focus" | "none" (shown as a badge)
       kind: "inline",                      // "inline" runs in this page; "external" is a separate app (shows `howto`)
       scripts: ["game/my-game.js"],        // optional: loaded the first time the game is played
       needs: ctx => ({ ok: true, msg: "" }),   // optional: say why it cannot start yet
       launch: (ctx, done) => MyGame.open({ stress: ctx.stress, onClose: done }),
       howto: "Run game-x/Run.bat"          // for kind "external"
     });

   ctx (built by the panel on every call): stage, connected, focusReady, stressLive, focus(), stress() [0..1], sensors(), status() */
"use strict";
(function (root) {

const games = [];
let cfg = null, overlay = null;
const loaded = {};

function register(g) {
  const i = games.findIndex(x => x.id === g.id);
  if (i >= 0) games[i] = g; else games.push(g);
  if (overlay) render();
}
function load(src) {
  if (loaded[src]) return loaded[src];
  return loaded[src] = new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("could not load " + src)); document.head.appendChild(s); });
}

const CSS = `
#gmOverlay{position:fixed;inset:0;z-index:99990;background:rgba(2,4,24,.82);display:none;align-items:center;justify-content:center;font-family:"Segoe UI",system-ui,sans-serif;color:#e9f1ff}
#gmOverlay .box{width:min(880px,92vw);max-height:88vh;overflow:auto;background:linear-gradient(180deg,#0a1260,#050a34);border:1.5px solid rgba(90,174,255,.85);border-radius:12px;padding:22px 26px;box-shadow:0 0 40px rgba(60,120,255,.35)}
#gmOverlay h2{font-weight:300;letter-spacing:.4em;font-size:22px;margin:0 0 4px}#gmOverlay .sub{color:#9fb2e6;font-size:12px;letter-spacing:.06em;margin-bottom:16px}
#gmOverlay .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
#gmOverlay .card{background:rgba(8,16,80,.7);border:1px solid rgba(110,150,255,.45);border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:8px}
#gmOverlay .card .ic{width:52px;height:52px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:30px;background:rgba(80,120,255,.2)}
#gmOverlay .card h3{margin:0;font-size:16px;font-weight:600;letter-spacing:.06em}#gmOverlay .card p{margin:0;font-size:12px;color:#b9c8f5;line-height:1.45;flex:1}
#gmOverlay .badge{display:inline-block;font-size:10px;letter-spacing:.14em;padding:2px 8px;border-radius:10px;border:1px solid #6a8cff;color:#9fb2e6;align-self:flex-start}
#gmOverlay .badge.stress{border-color:#ff8a5c;color:#ffb08f}#gmOverlay .badge.focus{border-color:#35e6ff;color:#8ff0ff}
#gmOverlay .msg{font-size:11px;color:#ffd166;min-height:14px}#gmOverlay .msg.ok{color:#7fe3a9}
#gmOverlay button{background:#16215a;border:1px solid #4a6adf;color:#e9f1ff;border-radius:6px;padding:8px 14px;font-size:12px;letter-spacing:.14em;cursor:pointer}#gmOverlay button:hover:not(:disabled){border-color:#7fe0ff}#gmOverlay button:disabled{opacity:.4;cursor:not-allowed}
#gmOverlay button.play{background:#2a5bd6;font-weight:700}#gmOverlay .close{float:right}
#gmOverlay .how{font:11px/1.5 "SF Mono",Menlo,monospace;background:rgba(0,0,0,.35);border-radius:6px;padding:8px;color:#cfe0ff}`;

function ctx() { return cfg && cfg.ctx ? cfg.ctx() : {}; }

function render() {
  const c = ctx(), grid = overlay.querySelector(".grid"); grid.innerHTML = "";
  games.forEach(g => {
    const n = g.needs ? g.needs(c) : { ok: true, msg: "" }, ext = g.kind === "external";
    const card = document.createElement("div"); card.className = "card";
    card.innerHTML = `<div class="ic">${g.icon || "🎮"}</div><h3>${g.title}</h3><span class="badge ${g.input || ""}">${ext ? "EXTERNAL APP" : (g.input ? g.input.toUpperCase() + " DRIVEN" : "")}</span><p>${g.blurb || ""}</p>${ext ? `<div class="how">${g.howto || ""}</div>` : ""}<div class="msg ${n.ok ? "ok" : ""}">${n.msg || ""}</div>`;
    if (!ext) {
      const b = document.createElement("button"); b.className = "play"; b.textContent = "PLAY"; b.disabled = !n.ok;
      b.onclick = () => play(g); card.appendChild(b);
    }
    grid.appendChild(card);
  });
}
async function play(g) {
  try {
    close();
    if (g.scripts) for (const s of g.scripts) await load(s);
    await g.launch(ctx(), () => { /* back to the panel */ });
  } catch (e) { console.error(e); alert("Could not start " + g.title + ": " + e.message); }
}
function open() { if (!overlay) build(); render(); overlay.style.display = "flex"; }
function close() { if (overlay) overlay.style.display = "none"; }
function build() {
  if (!document.getElementById("gmCss")) { const s = document.createElement("style"); s.id = "gmCss"; s.textContent = CSS; document.head.appendChild(s); }
  overlay = document.createElement("div"); overlay.id = "gmOverlay";
  overlay.innerHTML = `<div class="box"><button class="close">CLOSE (Esc)</button><h2>GAMES</h2><div class="sub">Pick a game. Games driven by your body signals work best once the headband is connected and calibrated.</div><div class="grid"></div></div>`;
  overlay.addEventListener("pointerdown", e => { if (e.target === overlay) close(); });
  overlay.querySelector(".close").onclick = close;
  addEventListener("keydown", e => { if (e.key === "Escape" && overlay.style.display === "flex") { e.stopPropagation(); close(); } }, true);
  document.body.appendChild(overlay);
}
/* attach to the panel's game button */
function attach(c) {
  cfg = c;
  if (c.note) c.note.textContent = "GAME MENU";
  if (c.button) { c.button.disabled = false; c.button.style.opacity = "1"; c.button.style.cursor = "pointer"; c.button.title = "Open the game menu"; c.button.addEventListener("click", open); }
}

/* ---------- built-in games ---------- */
register({
  id: "defuse", title: "Defuse", icon: "💣", input: "stress", kind: "inline",
  blurb: "Defuse a bomb using its own service sheet. The more stressed you are, the more your hands shake and the more it sweats. Phone on the table to calm down. Pick the source in the game: stress meter, focus (more focus = less stress) or a manual slider.",
  needs: c => c.focusReady ? { ok: true, msg: "Focus mode is ready (more focus = less stress)." + (c.stressLive ? " Stress meter is live too." : "") } : c.stressLive ? { ok: true, msg: "Stress meter is live." } : { ok: true, msg: "Manual slider only. Connect the headband and press Auto Set Baselines for focus mode." },
  launch: c => root.BombUI.open({ source: c.focusReady ? "focus" : c.stressLive ? "stress" : "test", stress: c.stressLive ? c.stress : null, focus: c.focusReady ? c.focus : null, status: c.status })
});
register({
  id: "mariokart-js", title: "Mario Kart (browser)", icon: "🏎", input: "focus", kind: "inline", scripts: ["game/mkds.js", "game/mkds-render.js"],
  blurb: "Race on Figure-8 Circuit. Your focus score sets your kart's speed (0.5x to 1.5x).",
  needs: c => c.focusReady ? { ok: true, msg: "Focus baselines are set." } : { ok: false, msg: "Connect the headband and press Auto Set Baselines first." },
  launch: c => root.MKDSUI.open({ stage: c.stage, focus: c.focus, sensors: c.sensors, status: c.status, onClose: () => {} })
});
register({
  id: "mariokart-py", title: "Mario Kart (Python)", icon: "🐍", input: "focus", kind: "external",
  blurb: "The same race as a desktop pygame app. It reads the focus score the panel sends to this computer.",
  howto: "Windows: double-click game-py/Run Mario Kart.bat<br>Mac: python3 game-py/mario_kart.py (see game-py/README.md)"
});
register({
  id: "stacker", title: "Animal Stacker", icon: "🦒", input: "focus", kind: "external",
  blurb: "The earlier prototype. Press F for keyboard focus or let the panel drive the focus bar.",
  howto: "Windows: double-click game-link/Run Stacker.bat<br>(see game-link/README.md)"
});

root.GameMenu = { register, attach, open, close, games };
})(typeof window !== "undefined" ? window : globalThis);

```

## game-py/link.py

```python
"""Receives the Muse 2 panel's focus meter over a tiny local-only web server (127.0.0.1:8765).

The panel POSTs JSON such as {"focus": 63.2, "sensors": [96, 96, 97, 72]} about 4 times a second.
focus is null until the panel's baselines are set. Same protocol the Animal Stacker prototype uses."""
import json
import math
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LINK_HOST, LINK_PORT, LINK_TIMEOUT = "127.0.0.1", 8765, 2.0


class HeadbandLink:
    def __init__(self, host=LINK_HOST, port=LINK_PORT):
        self.lock = threading.Lock()
        self.focus = None        # 0-100 or None
        self.sensors = [None] * 4
        self.stamp = 0.0
        self.server = None
        link = self

        class Handler(BaseHTTPRequestHandler):
            def _reply(self, code=200, body=b'{"ok":true}'):
                self.send_response(code)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_OPTIONS(self):
                self._reply(204, b"")

            def do_GET(self):
                self._reply()

            def do_POST(self):
                try:
                    n = min(int(self.headers.get("Content-Length", "0")), 1024)
                    data = json.loads(self.rfile.read(n) or b"{}")
                    raw = data.get("focus")
                    focus = None
                    if isinstance(raw, (int, float)) and not isinstance(raw, bool) and math.isfinite(raw):
                        focus = max(0.0, min(100.0, float(raw)))
                    sens = data.get("sensors")
                    clean = [None] * 4
                    if isinstance(sens, list):
                        for i, v in enumerate(sens[:4]):
                            if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v):
                                clean[i] = max(0.0, min(100.0, float(v)))
                    link.push(focus, clean)
                    self._reply()
                except Exception:
                    self._reply(400, b'{"ok":false}')

            def log_message(self, *a):
                pass

        try:
            self.server = ThreadingHTTPServer((host, port), Handler)
            self.server.daemon_threads = True
            threading.Thread(target=self.server.serve_forever, daemon=True).start()
        except OSError:
            self.server = None   # port busy

    def push(self, focus, sensors):
        with self.lock:
            self.focus, self.sensors, self.stamp = focus, sensors, time.monotonic()

    def read(self):
        """(state, focus, sensors). state: 'off' (panel silent), 'waiting' (no baselines yet), 'live'."""
        with self.lock:
            focus, sensors, stamp = self.focus, list(self.sensors), self.stamp
        if stamp == 0.0 or time.monotonic() - stamp > LINK_TIMEOUT:
            return "off", None, [None] * 4
        if focus is None:
            return "waiting", None, sensors
        return "live", focus, sensors

```

## How the bomb game reads stress (grep)

```
2:   Open it with BombUI.open({ focus, stress, status, seed, onEvent, onClose }).
3:   - source: "stress" (the stress meter), "focus" (the focus meter) or "test" (manual slider). Pick it in the top bar; the default is the first one available.
4:   - focus():  0..100 from the panel's focus meter, or null when there is no reading. FOCUS source: stress = 1 - focus/100 (focus 100 = no stress, focus 0 = full stress)
5:   - stress(): 0..1 from the stress meter, or null
292:  const tools = el("div", "bz-tools", `<b style="letter-spacing:.2em;color:#e6c46a">MANUAL TEST MODE</b><label>Stress <input type="range" id="bzSl" min="0" max="100" value="0"><b id="bzSv">0</b></label><small>0 = calm, 100 = maximum stress</small><label><input type="checkbox" id="bzNo"> simulate "no reading"</label>`, root);
307:  /* where the stress level comes from: the stress meter, the focus meter (stress = 1 - focus/100) or the manual slider */
308:  const SRC = [["stress", "STRESS METER", !!opts.stress, "Stress meter not available. Connect the headband and calibrate it in the panel."],
309:    ["focus", "FOCUS", !!opts.focus, "Focus needs the headband connected and Auto Set Baselines pressed in the panel."],
311:  let source = opts.source || (opts.mode === "test" ? "test" : opts.stress ? "stress" : opts.focus ? "focus" : "test");
323:    if (S && S.state === "running" && S.t > 1 && !confirm("Changing the stress source mid-game mixes sources in this run's results. Change anyway?")) return;
383:      pressAt: null, pressItem: null, progress: 0, stressSm: 0, stressSum: 0, stressHi: 0, calm: 0, calmPeak: 0, phoneSec: 0, feedDone: false, atEnd: false, calmUntil: null, calmAt: null, phone: false, cloth: false, t: 0, nextGlitch: 6, glitchUntil: 0, lastSec: -1, events: [], slips: 0, drops: 0, wipes: 0, blocked: 0, blots: 0, nextSpike: 4, spikeUntil: 0, beat: 0, lastBeat: 0 };
652:      modulesSolved: nSolved(), sweatDrops: S.drops, slips: S.slips, wipes: S.wipes, blockedPresses: S.blocked, paperBlots: S.blots, avgStress: +(S.stressSum / dur).toFixed(3), secondsHighStress: +S.stressHi.toFixed(1),
659:      <div><span>Modules solved</span><b>${sm.modulesSolved} / 3</b></div><div><span>Average stress (0-1)</span><b>${sm.avgStress}</b></div><div><span>Seconds under high stress</span><b>${sm.secondsHighStress}</b></div>
710:    else if (source === "stress" && opts.stress) { const v = opts.stress(); noRead = v == null || !isFinite(v); target = noRead ? 0 : v; }
711:    else if (source === "focus" && opts.focus) { const f = opts.focus(); noRead = f == null || !isFinite(f); target = noRead ? 0 : L.stressFromFocusLinear(f); }
713:    S.stressSm += (target - S.stressSm) * (1 - Math.exp(-dt / T.smoothingSec));
716:    const forced = L.calmModeFactor(S.t, S.calmUntil, T), calmNow = forced === 0, s = L.effectiveStress(S.stressSm, S.calm, forced), rate = L.clockRate(s, S.strikes, T), shake = L.handShake(s, T);
718:      S.t += dt; S.remaining -= dt * rate; S.stressSum += S.stressSm * dt; if (S.stressSm > 0.5) S.stressHi += dt; if (S.phone) { S.phoneSec += dt; if (S.atEnd && !S.feedDone) tryCalmMode(); }
760:    rowS.querySelector("b").textContent = noRead ? "--" : Math.round(S.stressSm * 100) + "%"; rowS.querySelector(".bar i").style.width = (S.stressSm * 100) + "%";
766:    vNote.textContent = source === "test" ? "MANUAL TEST MODE: stress is set by the slider. Results are not real data."
767:      : source === "focus" ? (noRead ? "FOCUS MODE: no focus reading yet. Connect the headband and press Auto Set Baselines in the panel. Until then there are no stress effects." : "FOCUS MODE: stress = 100 minus your focus. Focus 100 means no stress, focus 0 means full stress. Focus is a rough proxy, not a validated measure.")
768:      : noRead ? "STRESS MODE: no stress reading yet. Connect the headband and calibrate the stress meter in the panel. Until then there are no stress effects." : "STRESS MODE: driven by the experimental stress meter (heart rate, frontal beta/alpha, face tension). Not a validated stress measure.";
769:    rowS.querySelector("span").textContent = source === "test" ? "STRESS (MANUAL)" : source === "focus" ? "STRESS (100 - FOCUS)" : "STRESS (METER)";
770:    stEl.textContent = (source === "test" ? "MANUAL TEST" : source === "focus" ? "FOCUS" : "STRESS METER") + (opts.status ? "  |  " + opts.status() : "");
```


---

# PART 4: REPOSITORY FILE LIST

```
.gitignore
CLAUDE.md
Claude outputs/muse-panel.html
Open Muse Panel (Mac).command
Open Muse Panel.bat
PLAN.md
README.md
arousal.js
arousal.test.js
cosmic-bg.jpg
docs/DETAILED_README.md
docs/focus-correction-plan.md
focus/README.md
focus/experimental/README.md
focus/experimental/focus-calibration.js
focus/experimental/focus-engine.js
focus/experimental/focus-recording.js
focus/experimental/focus.test.js
focus/focus-switch.css
focus/focus-switch.js
game-link/README.md
game-link/Run Stacker.bat
game-link/headband-focus.patch
game-link/stacker.py
game-py/README.md
game-py/Run Mario Kart.bat
game-py/link.py
game-py/mario_kart.py
game-py/mkds.py
game-py/requirements.txt
game-py/test_mkds.py
game/BOMB.md
game/README.md
game/bomb-logic.js
game/bomb-test.html
game/bomb.html
game/bomb.js
game/bomb.test.js
game/menu.js
game/mkds-render.js
game/mkds.js
game/mkds.test.js
muse-panel.html
muse2-panel-requirements.md
neon-bg.png
panel/README.md
panel/ble.js
panel/core.js
panel/dsp.js
panel/focus.js
panel/gamelink.js
panel/main.js
panel/motion.js
panel/motion.test.js
panel/pulse.js
panel/recording.js
panel/stress-link.js
panel/ui.css
panel/ui.js
stress-test.html
stress.js
stress.test.js
```
