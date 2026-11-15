# claude-muse: detailed README (status as of 2026-11-15)

Browser tools for the Muse 2 EEG headband and the OpenBCI Cyton + Daisy, a new artifact-robust signal engine, and games. Everything runs in
Chrome or Edge; the Cyton goes through a local Python helper. Part A describes the new engine (added on branch `feat/robust-engine-cyton`);
Part B is the earlier description of the panel and its Legacy maths, kept as it was (it still applies to Legacy mode).

# Part A: the new engine

## A1. Why the old maths is replaced (and kept as Legacy)

- Legacy focus uses beta 13-30 Hz, which is where forehead muscle (frontalis) peaks: a frown or jaw clench reads as "focus".
- Band power is taken from the channel average, which mixes artifacts from one sensor into all.
- The 10 s baseline is too short to describe a person.
- Legacy stress on screen is just 100 - focus.
- The arousal model's reference points (+40 bpm, RMSSD x 0.5) are far too extreme.
- Muse PPG RMSSD is biased about 1.9x high against ECG.
- beta/alpha is mostly EMG.

Research reasons behind the main choices: EMG dominates EEG power above about 20 Hz (so no beta above 20 Hz, no gamma); the theta/beta ratio is
discredited as an attention index; RMSSD needs at least about 30 s of beats; cross-person workload decoding is near chance, hence within-person
relative indices; ECG identifies people well, EEG weakly (Muse especially).

## A2. Architecture: nine stages in a fixed order (`engine/pipeline.js`)

| # | Stage | Cadence | Input -> output |
|---|---|---|---|
| 1 | ingest + gap bookkeeping (`frame.js`) | every frame | frame -> 30 s rings per channel, GapBook |
| 2 | preprocessing (`preproc.js`) | every sample | raw -> xd (DC-blocked 0.5 Hz), xb (+ mains notch Q 30), xa (+ 4th-order low-pass min(45, fs/2 - 5)) |
| 3 | contact (`contact.js`) | 1 s | Q 0-100 per channel; excluded set (Q < 40 out; >= 50 for 3 s back in) |
| 4 | events (`events.js`, `motion.js`) | 50 ms, 250 ms look-back | blink, blink_voluntary, eyes_closed, saccade, emg_burst (clench/chew/talk/tension/other), electrode_pop, motion, gap, bad_contact -> masks (`mask.js`) |
| 5 | cleaning (`clean.js`), optional | ASR every 500 ms, NLMS per sample | xa -> xc |
| 6 | features (`features.js`) | hop 0.25 s on the 2 s window ending D s ago | log band powers per channel set, IAF, aperiodic fit |
| 7 | metric models (`metrics.js`, `ecg.js`, `ppg.js`, `buttons.js`) | hop (buttons at once) | raw metric values |
| 8 | normalization (`norm.js`) | hop (updates wait 5 s in quarantine) | personal z -> 0-100 |
| 9 | hold/fade + output (`holdfade.js`) | hop | `{value, conf, state, reason}` |

**Stream time.** All engine timing is `sampleIndex / fs`, so runs are deterministic; wall time is only used by the panel glue.
**Analysis delay D** = 0.5 s (+0.5 s with ASR, so 1.0 s on the Cyton): event detection lags an artifact by 200-400 ms, so the scored window
ends D in the past and its mask always exists before it is used. Button events are not delayed.
**Rates.** Any per-channel rate >= 125 Hz: Muse 256, Cyton 125 (dongle) or 250 (WiFi; the helper decimates 500/1000 to 250). Every filter,
window and per-sample threshold is derived from fs; analysis bands end at or below fs/2 - 5 Hz; the EMG band is 25-55 Hz below 250 Hz and
25-100 Hz at 250 Hz and above.

## A3. The frame (adapter -> engine)

```js
{ device: "muse"|"cyton", streamId, fs, channels: [names], sampleIndex, t0 /* = sampleIndex/fs */, samples: [Float32Array per channel, uV],
  gaps: [{at, n}] /* n samples lost just before index at; never filled */, accel: {fs, t, xyz} | null, gyro (Muse) | null,
  ppg: {fs: 64, t0, data /* NaN = missing */} | null, ecg: {fs, data, channel} | null, contact: [Muse S.pct] | null,
  aux: { ppgHr, flags: {impedance, simulated} } }
```
Adapters: `adapters/muse.js` (from one tap line each in `panel/dsp.js`, `pulse.js`, `motion.js`), `adapters/cyton.js` (WebSocket client to
`tools/cyton_helper.py`, binary protocol in `tools/README.md`), `adapters/cyton-sim.js` (in-browser simulator).

## A4. Output object (one per hop; `window.EngineOut` in the page)

```js
{ t, device, profile: {id, label, confidence, state: confirmed|tentative|uncertain|guest, badge},
  focus: {value|null, conf, state: live|held|stale|learning|unavailable, reason},
  stress: {..., components: {hr: {z, valid, bpm}, hrv: {z, valid, rmssdMs}, eeg: {z, valid}}, exertion},
  drowsiness: {..., markers: {ratio, blinkDur, blinkRate, perclos, spindles}} | null /* Muse */,
  events: [{id, type, sub, onset, offset, conf, channels, amp, durMs, t}],
  quality: {perChannel, excluded, ecg: {bpm, sqi, state} | null, motion: valid|movement|no_data|proxy, packetLoss, asr, warnings},
  legacy: {focus, stress} }
```
`value` is null whenever the state is stale or unavailable (and for drowsiness while learning). State priority: unavailable > stale > held > learning > live.

## A5. Modules and their constants

All tunable constants live in `MuseEngine.CONFIG` (pipeline.js), deep-merged with `MuseEngine.TUNED.config` (written by `tools/autotune.py`).

- **Contact (Cyton):** q = min(sRail, sRms, sLine, sImp); sRail 0 when > 2% of samples are at |x| >= 178 125 uV; sRms 0 below 1 uV, rising to 100 at 3 uV, 100 up to 80 uV, falling to 0 at 190 uV; sLine 100 up to a line ratio of 2, falling (log10) to 30 at 20; sImp 100 up to 750 kOhm, 40 at 2500, 20 above; Q <- Q + 0.5 (q - Q). Muse: the panel's value.
- **Motion gate:** accel = RMS of successive differences of |a| over 1.25 s (gravity cancels), gyro = RMS |g| (Muse); MOVEMENT when above entry (0.02 g / 10 deg/s), VALID after 1.5 s under exit (0.01 / 5); missing data is never "still" (NO_DATA, masked). Thresholds self-tune after 30 s of VALID data from median + 5 / + 3 MAD (floors 0.0015 g, 0.3 deg/s). No accelerometer: EEG proxy (4 Hz low-pass RMS per 250 ms slot >= 4x its 60 s median on >= 50% of channels, Muse 75%).
- **Blinks:** eye signal = mean lp10 of the eye channels; candidate when the 20 ms slope >= max(600 uV/s Cyton / 400 Muse, 4 sigma); peak >= max(60 / 40 uV, 4 sigma, 0.4 medAmp); onset/offset at 10% of the peak; width at 50% between 80 and 800 ms; voluntary when amp >= max(1.5 medAmp, medAmp + 3 MAD) or width >= 350 ms. medAmp, MAD, duration and polarity are learned from spontaneous blinks only (passive; stored per profile). Amplitude is read on a DC-restored copy of the eye signal (see IMPLEMENTATION_NOTES).
- **EMG bursts:** envelope = 75 ms mean of |hp25 + lp(55 or 100) of the DC-blocked signal through a low-Q mains notch|; baseline = 60 s running median of non-burst envelope; in burst from ratio >= 3 held 100 ms to < max(2, 10% of the peak ratio) held 50 ms; merged across channels; tension > 1 s; frontal-dominant -> talk; >= 3 regular bursts (0.4-1.43 s apart, CV < 0.35) -> chew; asymmetric or many irregular -> talk; both temporal channels 200-600 ms -> clench; else other.
- **Masks** (`mask.js`): blink/saccade frontal -100 ms .. +400/300 ms; EMG other: burst channels and their group (all channels when >= 4, Muse >= 2) -100 .. +300 ms; clench/tension all -100 .. +300; chew/talk all -100 .. +1000; motion all -200 .. max(last over + 500 ms, VALID); gap .. +2 s ("signal lost"); pop that channel 1 s; bad contact while excluded. A window channel is usable with >= 1 one-second segment of clean data (50% overlap) and >= 60% clean; the set needs >= 2 channels (Cyton) or 1 (Muse).
- **Features:** thetaF 4-8 Hz (Cyton F3, F4, F8; Muse AF7, AF8), alphaP 8-12 Hz or IAF +/- 2 (Cyton P3, P4, P7, P8, O1, O2; Muse TP9, TP10), betaLoC 13-20 Hz (Cyton C3, C4, P3, P4; Muse TP9, TP10), ratioD ln((theta + alpha)/betaLo) over C3, C4, P3, P4. IAF and aperiodic exponent from the accumulated posterior spectrum (adopted only at the start of a later session).
- **ECG** (Cyton): 5-15 Hz detection path, Elgendi two moving averages, parabolic refinement, polarity auto-flip, RR cleaning, Lipponen-Tarvainen flags, window quality (kurtosis >= 5 and beat correlation >= 0.8), hr8, ln RMSSD over 30-60 s (none if > 20% of beats were rejected); scale-invariant throughout. **PPG** (Muse): `Stress.findBeats`/`ibisFromBeats` on the pulse samples; only as a relative change.
- **FOCUS:** focusRaw = wTheta z(thetaF) - wAlpha z(alphaP) + wBeta z(betaLoC) (1, 1, 0.5); eyes-closed windows excluded; EMA tau about 2 s; conf ceiling 1.0 Cyton, 0.7 Muse.
- **STRESS:** weights hr/hrv/eeg 0.45/0.40/0.15 (Cyton), 0.65/0.20/0.15 (Muse); missing parts dropped and weights renormalised (never 0); needs a cardiac part; exertion guard; EMA tau 4 s.
- **DROWSINESS** (Cyton): lifetime-tier z of ratioD, blink duration, blink rate (|z| x 0.5), PERCLOS, alpha bursts; mean z capped at +1 unless two markers are above +0.5; EMA tau 60 s; learning (null) until 10 clean minutes of history.
- **BUTTONS** (Cyton): double_blink (two voluntary blinks 150-600 ms apart, no third within 400 ms, not while moving or near a saccade, refractory 800 ms) and clench_tap (a clench burst, 1.5 s of quiet before, not chewing/talking, 4.5x ratio after talking, refractory 500 ms); < 400 ms latency.
- **Hold/fade:** held for 3.0 s with confidence fading linearly, then stale (`--`, reason kept); back to live at once; the EMA restarts after > 30 s stale.

## A6. Normalization: how it learns without a calibration (`norm.js`)

Julian's rule is used exactly: every clean window updates running statistics weighted by its new clean time, new_mean = (T mean + dt x)/(T + dt),
across sessions (weighted Welford/West: W, m, S). Its known weakness: a cumulative mean absorbs sustained states. After H minutes of history a state
held for T minutes keeps only H/(H + T) of its shift (1 h of history, 1 h of a new state: half of it is gone). The safeguards:

- **Two tiers.** A session accumulator, and a lifetime state that is frozen during a session and rebuilt by folding stored session summaries in time
  order (each fold forgets 2% and caps the weight at 10 h of clean data, so slow drift over weeks is tracked). Storing summaries (not a running
  total) makes relabel, merge and "forget me" exact.
- **A population prior** (normal-inverse-gamma; 120 s of pseudo-data; n = W/10 s): personal data has half the weight after 2 clean minutes and 90%
  after 18. z is the Student-t value; score = 100 / (1 + exp(-1.7 z)) (50 = usual, about 88 at +2 sigma, about 12 at -2 sigma). No min-max anywhere.
- **Robust updates:** winsorized at +/- 3 robust sigma (MAD from a 200-bin histogram); 5 s quarantine (an event found later, such as eyes closed,
  a chew relabel or a new contact epoch, drops the queued update); anti-stall: 60 s pushing one side opens a new epoch.
- **Contact epochs** (re-seating shifts EEG power; the heart does not): new on connect, a gap > 5 s, a stall, or 2 of 5 change detectors within
  30 s (broadband step, line jump, spectral shape, Riemannian covariance distance, CUSUM). EEG power features re-anchor their location
  (lambda = Te/(Te + 30 s), frozen at 120 s; "learning" until then), keep their spread, and weigh the first 10 minutes x 0.25.
- **Within-session offsets** for the composites (focus 90 min, stress 45 min, clamped to 0.5 z) follow day-to-day state without absorbing a normal-length focused or stressed stretch.
- Known limit: a state already present when an epoch starts is mostly absorbed into the re-anchor (someone who starts highly focused reads near 50).

## A7. Identity and profiles

See `engine/identity.js`: a session identity vector (EEG spectral shape per channel group, IAF, aperiodic fit, ECG beat template, resting HR,
contact pattern) is compared with each stored profile's per-session vectors (diagonal Gaussian with shrinkage, effective-dimension weighting,
priors owner 0.7 / others 0.2 / new 0.1). Accept at posterior >= 0.8, margin >= 0.2, likelihood ratio >= 3, twice in a row; after 3 min:
tentative (scored with that profile, not merged unless the user taps the tick) or a new guest. Profiles change only at commit. Store schema
(`museengine.profiles.v1`) and API in `engine/profiles.js`. Expected accuracy: Muse 60-80% closed-set, Cyton with ECG 90-97%.

## A8. Panel integration

`panel/engine-link.js` (connect dispatch, frames -> engine, Cyton display and Legacy), `panel/engine-ui.js` + `engine-ui.css` (NEW/LEGACY switch,
device switch, DROWSY button, profile panel, engine card, the Cyton contact strip and 16-channel raw view, help), `panel/engine-rec.js` (CSV columns + v2 recorder), `panel/validation.js`
(the validation protocol), `engine/gamebody.js` (game link v2). URL options: `?device=muse|cyton`, `?engine=new|legacy`, `?demo=1` (`&helper=1`),
`?selftest=1`, `?validate=1` (`&fast=1&autostart=1`).

## A9. Tests

`node tools/run_all_tests.js` (37 test files, Node and Python, all plain scripts). `node tools/browser_smoke.js` takes the screenshots and runs the
page's self-tests. Details and the final checklist: `docs/IMPLEMENTATION_NOTES.md`.

# Part B: the panel and its Legacy maths (earlier description, unchanged)


Browser tools for the Muse 2 EEG headband and a stress-driven bomb defusal game. Everything runs in Chrome or Edge
(Web Bluetooth). This file describes what exists, how it works, what is tested, and what is still open.
Keep it updated when behaviour changes: "Tests and what was verified" and "Open work" matter most.

### 1. Run it
**Mac (Chrome):** double-click `Open Muse Panel (Mac).command`. It serves the folder on `http://localhost:8077` (Web Bluetooth
needs a secure page) and opens Chrome. Allow Chrome in System Settings > Privacy & Security > Bluetooth if nothing is found.
Add `?demo=1` to the address for simulated data. **Windows:** `Open Muse Panel.bat` (Edge).
Close the Muse phone app first. Safari and Firefox do not support Web Bluetooth.

| Page | What |
|---|---|
| `muse-panel.html` | The control panel: live bands, raw view, heart rate, focus meter, stress meter, recording, the **B** game button |
| `game/bomb.html` | The bomb game on its own (manual test mode by default) |
| `game/bomb-test.html`, `stress-test.html` | Browser test runners (they print "ALL PASSED") |

### 2. Muse panel (built by Julian with Claude; changed only where noted)
Connects over Web Bluetooth (service `fe8d`, EEG characteristics `273e0003..0006`, preset `p50`, falls back to `p21`).
Shows TP9/AF7/AF8/TP10, five band rows, heart rate from the pulse sensor, signal quality and battery, records a CSV
(256 rows/s, gaps for dropped packets), and has the original **focus meter** (`ln(beta/alpha)`, 10 s personal baseline).
Changes on branch `feat/experiment-protocols`: the game button opens the bomb game; demo mode got a `demoGamma`
variable; `stress.js` is loaded at the bottom of the page; the Mac launcher was added.

### 3. Stress meter (`stress.js`): EXPERIMENTAL, NOT A VALIDATED STRESS MEASURE

> **Update:** the score now comes from `arousal.js`: F = 100·clip(0.40 H + 0.35 V + 0.25 E), H = heart-rate rise, V = HRV (RMSSD) drop, E = median beta/alpha rise, each against a personal 2-minute sit-still baseline (saved in the browser). Heart rate/HRV are rejected while the accelerometer flags movement; missing signals give a partial score with renormalised weights, never zero; stale scores are marked. High/low references are starting estimates (HR +40 bpm, HRV x0.5, ratio x1.75). `StressMeter.value()` and `.ready()` now return this score. The older description below (effect-size, two-phase calibration) is the previous model, kept in the code but unused.
EEG cannot read stress directly. The meter blends three signals that tend to rise with arousal, each compared with
the player's own calm baseline:

| Signal | Source | Why |
|---|---|---|
| Heart rate | Muse pulse sensor (`PL.bpm`) | arousal raises heart rate |
| Frontal beta/alpha | AF7 + AF8, 2 s Hann FFT, `ln(beta 13-30 / alpha 8-13)` | common (unvalidated) arousal feature; skipped while a blink/jerk artifact is flagged |
| Muscle tension | AF7 + AF8, `ln(gamma 30-44 / total 1-44)` | forehead tension (frowning, clenching) shows up here; this is EMG, not brain activity |

**Calibration (two phases, `?stcal=N` sets the length of each, default 30 s):**
1. **Calm:** sit still, eyes open. 2. **Task:** count backwards from 1022 by 13 as fast as you can, typing each answer (a wrong
answer restarts the count). The first 30% (max 8 s) of each phase is skipped because heart rate uses an 8 s window and arousal
takes time to build. For each signal the meter measures how far it moved between the phases (effect size d). Signals with
d < 0.5 are **ignored and the card says so**; the rest are weighted by d (max 3). Score = `20 + 60 * (position between your calm
level and your task level)`, clamped 0..100, smoothed. So **20 = your calm, 80 = your level during the task.**
Fallbacks: if you skip the task, it uses calm only (`20 + 80*z/3`, 100 = about 3 SD above calm, less reliable); if the task
changed no signal, it falls back to calm-only and flags the model "weak". With no usable signal for 5 s it shows `--`.
The card at the bottom-left shows the score and each signal's position. In demo mode it has sliders for simulated heart rate,
beta and face tension.
Limits: relative to one person on one day; caffeine, movement, a loose headband or concentration also move it
(solving a puzzle raises beta and heart rate without being "stress"). Treat it as a game input, not a measurement.
API: `StressMeter.value()` returns 0..100 or `null` (not connected or not calibrated); `StressMeter.ready()`.

### 4. Bomb game (`game/`)
One level, three modules, 3:00 clock, 3 strikes. All art is drawn in code.
- **Wires** (5), **Button** (tap or hold, release on a clock digit) and **Keypad** (four symbols, pressed in the order of the one column that holds them all).
  **The rules are different on every bomb.** Each bomb's seed generates its own rule set (which wire to cut, hold-or-tap table, strip digits,
  keypad columns) and it is printed only on that bomb's **service sheet** (the handbook, headed with the bomb's serial number). Nothing on the bomb
  or in the game tells you what to press, so the player must read the sheet and match it against the bomb. A conditional rule (never the fallback)
  always decides the answer, 2,000 seeds are tested as solvable, and almost every bomb gets a different sheet.
- **Table objects** (the bomb sits on a table; click/drag with the in-game "hand"): the **service sheet** on the right (click to read; this bomb's rules
  are *only* there, with a section per module: how to read it, this bomb's rules in order, hints), the **cloth** below-left (hold and drag it
  over wet patches to wipe them; click it while the handbook is open to dab the page dry) and the **phone** on the left (see below).
  The clock keeps running while you read or scroll. Esc closes the handbook or phone, then the game.
- `bomb-logic.js` rules, seeded levels (`?seed=42` for a repeatable bomb), stress mapping, all `TUNING` numbers.
- `bomb.js` view, input and effects. `BombUI.open({mode, focus, stress, status, seed, tuning, onEvent, onClose})`.

**Two modes** (top-bar button): **Live (Muse)** uses the stress meter (`stress()` returns 0..1); **Manual test** shows a
**stress** slider (0 = calm, 100 = maximum) and a "no reading" box. The in-game monitor shows only the stress bar (and mind clear);
focus and stress are shown independently on the main panel (the original focus meter plus the stress card). The end screen labels test runs "not real data".
The panel starts live mode only when connected and the stress meter is calibrated.

**Stress effects** (stress smoothed over 1 s):
| Effect | Detail |
|---|---|
| Hand tremor | pointer jitters up to 16 px (spikes above 50% stress); clicks land at the jittered point |
| Sweat drops | none below 15% stress, up to 0.8/s; each leaves a water-lens patch that blurs what is under it; dries after 12 s |
| Slipping | a press on a wet patch slides about 28 px, mostly downward |
| Short circuit | 3 patches on one module: it sparks and ignores touch (the timer display scrambles) until you wipe |
| Soaked manual | while the manual is open, drops land on the paper. A wet blotch blurs the words under it; once dry it leaves a stain that is still hard to read (blurs 1.5 px). Stains are permanent for that bomb |
| Wipe | no hotkey: drag the cloth over each wet patch (hand tremor makes this harder); clicking the cloth while reading dries the page (stains stay). The cost is the time it takes |
| Phone (doom scroll) | scrolling the feed fills **mind clear** (up to 70%); the game's stress effects shrink by that share and it fades 1.2%/s after you put the phone down. This is a game mechanic: it does not change the measured stress, and the clock keeps running while you scroll |
| Heartbeat | audible from 25% stress; a red vignette pulses (64 bpm calm, 134 stressed); slight blur above 60% |
| Clock | runs up to x1.6 faster at full stress, +x0.25 per strike |
| Display glitch | above 55% stress the timer flickers |

Events: `start, mode, strike, module_solved, slip, blocked, paper_wet, wipe, defused, explode, finish` (also `bomb:event` on
`window`). The `finish` summary has result, time played, strikes, average stress, seconds under high stress, sweat drops,
slips, shorted presses, paper blotches, wipes and the event log. This is the hook for logging and for Unity later.
Events also include `dab`, `phone_up`, `phone_down`. (A `focus()` option still exists for old callers: `stress = clamp((50 - focus) / 50)`.)

### 5. Tests and what was verified
- `game/bomb.test.js` (25 checks) and `stress.test.js` (35 checks): rules, 2,000 generated bombs all solvable, sweat and
  short-circuit numbers, FFT band placement, baseline and scoring maths. Run with Node (`node game/bomb.test.js`) or open
  the `*-test.html` pages. **Node is not installed on the Mac this was built on, so they were run in the browser.**
- Played in a browser: wrong wire = strike; defused with the correct actions; sweat blurs and slips; a shorted module
  ignores presses with no strike; Space clears shorts and costs 3 s; sweat blotches appear on the open manual, Space dries
  them and the stains remain.
- Demo mode: the stress meter calibrated, and its score rose from about 20-30 to 99.6 when simulated heart rate, beta and
  face tension were raised; the game then opened in Live mode driven by it.
- **Not verified:** anything with a real Muse 2 (connection from Mac Chrome, real heart-rate quality, whether the score
  tracks a person's stress at all), audio, long sessions, Windows/Edge after these changes, whether the effect strength
  feels fair to real players (tune `TUNING`).

### 6. Open work
1. Test everything with a real headband; tune the stress weights and `TUNING` from real data.
2. Recording metadata (participant ID, condition, notes, synthetic flag) and the experiment protocols (calm, normal puzzle,
   timed puzzle, 0-10 rating): not built.
3. A review/compare page for saved recordings.
4. Split `muse-panel.html` (about 870 lines) into modules so UI and logic work stop colliding.
5. Save the game `finish` summary and the stress score alongside recordings; send them to Unity.
6. The Mario Kart files are unused but still in `game/`.

### 7. Stress meter v2: what changed and why (research notes)
Search of the literature (2026-11-09) shaped these choices. None of it makes the score a validated measure.
- **Muse for frontal alpha asymmetry (FAA):** a bioRxiv validation (Muse vs research-grade EEG, spectral measures and FAA) supports using
  the Muse for alpha power and AF7/AF8 asymmetry, so FAA was added as a signal. The direction of FAA with stress is mixed in the
  literature, so it is **two-sided**: it is used only if it moves for this person during the task, in either direction.
- **Heart rate variability:** reviews and a wrist-PPG study report that PPG-derived HRV can recognise mental stress about as well as ECG.
  RMSSD (falls under stress) was added from the Muse pulse signal: beats found by peak detection with parabolic interpolation, timed by
  sample position (not arrival time), 30 s window, impossible/jumpy intervals dropped, needs 15 intervals. Heart rate now also comes from
  the last 6 beats (about 5 s lag instead of the panel's 8 s autocorrelation window).
- **Stressor:** mental arithmetic (and the Montreal Imaging Stress Task, which is arithmetic under time pressure and negative feedback)
  is a standard way to raise arousal, which is why calibration uses counting backwards with restarts on mistakes.
- **Muse stress studies:** classification of perceived stress from a Muse headband has been published (Arsalan et al. 2019) but with
  per-study labels and models; a universal formula is not established. That is why the meter learns per person which signals respond.
- Ratios like beta/alpha are mixed in the literature and easily contaminated by muscle activity (that is why the tension signal and the
  artifact pause exist). Treat every signal as a game input.
Sources: Validating the wearable MUSE headset for EEG spectral analysis and Frontal Alpha Asymmetry (bioRxiv 2021.11.02.466989);
Arsalan et al., Classification of Perceived Mental Stress Using A Commercially Available EEG Headband (IEEE JBHI 2019); Evaluation of
Mental Stress and Heart Rate Variability Derived from Wrist-Based Photoplethysmography (2019); Human Stress Assessment: A Comprehensive
Review of Methods Using Wearable Sensors and Non-wearable Techniques (arXiv 2202.03033).

**Responsiveness and "is it working?"**: the score updates 4 times per second (about 0.7 s smoothing); calibration samples are taken
once per second. The card shows a status (NO HEADBAND / NOT CALIBRATED / CALIBRATING / LIVE / NO SIGNAL), a pulsing LIVE dot, a
60 s scrolling graph with lines at 20/50/80, and one row per signal with a green dot when it is arriving, a bar for how far it has moved,
and `used` / `ignored` after calibration. Collapse it with the arrow.

### 8. Merging with Julian's branch (plan)
Julian is changing the panel (reportedly a head-movement/blink filter), so this work is kept in separate files. Everything of ours that
touches `muse-panel.html` is listed here so a merge is mechanical:
1. In the demo generator: `6*Math.sin(2*Math.PI*38*t+c)` became `window.demoGamma*Math.sin(...)`, and `window.demoGamma=6` was added next to `window.demoAlpha=...`.
2. Script tags `game/mkds.js` + `game/mkds-render.js` in the head were replaced by `game/bomb-logic.js`, `game/bomb.js` and `game/menu.js` (the Mario Kart scripts are now loaded lazily by the menu).
3. The round game button (`#btnMario`) now shows a gamepad icon and opens the **game menu**; the block from `/* ===== Game menu` to just before
   `/* ===== game link:` (`focusReady`, `stressLive`, `marioReady`, no-op `updateMarioBtn`, and one `GameMenu.attach({...})` call that hands the menu the live signals).
4. At the very bottom, after the main `</script>`: `<script src="stress.js">` and a small script that calls `Stress.attach({...})`.
**If Julian's filter changes `S.raw`, `S.artUntil`, `S.rms`, `PL.bp`/`PL.bpPos` or `PL.bpm`, update only the callbacks in that last script:**
`frontalWindows()` reads `S.raw` (should be the offset-removed signal; a cleaner filtered signal is better), `artifact()` reads
`S.artUntil` (blink/jaw flag), `heartRate()` reads `PL.bpm`, `ppgWindow()` reads `PL.bp`. Our files (`stress.js`, `game/bomb*.js`, tests,
docs, the Mac launcher) are new, so they cannot conflict. If his filter removes blinks upstream, the stress meter's own artifact pause
becomes less important but is harmless.

### 9. Merge log
- 2026-11-09: merged `origin/main` (Julian's commits 4fdd4b3 and 714effa: Python/pygame port of the Mario Kart game in `game-py/`, the panel now also
  sends the four sensor percentages to the game link, `.gitignore` for Python caches) into `feat/experiment-protocols`. No conflicts. The panel still
  posts the focus score to `127.0.0.1:8765`, so `game-py` keeps working; our **B** button replaced the Mario Kart launcher inside the panel only.
  No blink/head-movement filter was in that update yet; when it lands, see section 8 for the four callbacks to re-check.

### 10. Game menu (adding games)
The panel's round button opens a menu (`game/menu.js`). Games register there with one call (see the comment at the top of that file):
`GameMenu.register({id, title, blurb, input, kind, scripts, needs, launch, howto})`. Built in: **Defuse** (stress), **Mario Kart (browser)** (focus, lazy-loaded,
needs focus baselines), **Mario Kart (Python)** and **Animal Stacker** (external apps, shown with how to run them). A game gets a `ctx` with `stage`,
`connected`, `focusReady`, `stressLive`, `focus()`, `stress()` (0..1), `sensors()` and `status()`.

### 11. Panel split (2026-11-09)
`muse-panel.html` was split into `panel/*.js` + `panel/ui.css` by category (UI, signal path, Bluetooth, focus meter, recording, games, stress link): see `panel/README.md`
for the table and the mapping from the old single file. Code was moved, not rewritten. The "edits to `muse-panel.html`" in section 8 now live in
`panel/gamelink.js` (game menu hookup), `panel/ble.js` (`demoGamma`) and `panel/stress-link.js` (stress glue). The game button is now a small "Games" button
in the right-hand button column (same style as Band view / Raw view / Float focus / Fullscreen).
