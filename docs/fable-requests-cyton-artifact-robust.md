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
