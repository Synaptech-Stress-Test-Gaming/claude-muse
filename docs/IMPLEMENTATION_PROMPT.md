# IMPLEMENTATION PROMPT: artifact-robust engine, Cyton+Daisy mode, self-learning scores

You are the implementing agent. You are working in Julian's repository `Muse 2 RAW` (a browser panel for the Muse 2 EEG headband plus games; Windows 11; Edge/Chrome; Node 24 and Python 3.10 are installed). This prompt is the only input you will ever get. Read it fully once before you touch anything, then follow it top to bottom.

---

# A. MISSION AND RULES

## A1. Mission

Build a new signal engine that replaces the panel's current focus/stress maths on the Muse 2 and adds a second device, the OpenBCI Cyton + Daisy (16 channels, Ultracortex Mark IV, dry comb electrodes). The engine must:

- stay honest under blinks, jaw/forehead muscle, talking, head movement, electrode pops and data gaps (detect, mask, hold, fade to `--`; never show a contaminated number, never show 0 for missing data);
- need **no calibration of any kind** (it keeps learning each person's normal range from clean data, across sessions);
- recognise who is wearing the headset without name entry;
- output FOCUS and STRESS on the Muse; FOCUS, STRESS, DROWSINESS and a BUTTONS event stream (double blink, jaw-clench tap) on the Cyton;
- keep the old formulas selectable as **Legacy**;
- send everything to the games without changing gameplay;
- ship with tests, a validation-recording page, an automatic tuning script, and docs.

## A2. Rules of engagement (non-negotiable)

1. **Do not ask questions. Do not stop early. Do not hand back partial work for review.** Nobody will answer, approve, say "continue" or test hardware for you. There is no second message.
2. When something is ambiguous, choose the option most consistent with this prompt, write one line about it in `docs/IMPLEMENTATION_NOTES.md` (section "Judgement calls"), and keep going.
3. When a test fails, fix the code and rerun. Change a test only if the test itself is wrong, and log why. If a numeric pass criterion in this prompt proves mathematically unattainable with the specified algorithm, change the algorithm's constant (not the criterion) within the bounds given, and log it. Only if that is impossible too may you change the criterion, with a logged derivation.
4. You finish only when every item of the completion checklist (section I) is done and every old and new test passes. Then write the final checklist report into `docs/IMPLEMENTATION_NOTES.md`.
5. **Git:** create a new local branch `feat/robust-engine-cyton` from the current branch (`mario-kart-focus`). Commit after each work step in section F with a clear message. End every commit message with the co-author attribution line your environment tells you to use (if your environment gives none, add none). **Never push.** Do not touch `main`. The untracked files `docs/FABLE_PROMPT.md`, `docs/fable-requests-cyton-artifact-robust.md`, `docs/fable-research-appendix.md` and `docs/IMPLEMENTATION_PROMPT.md` may be committed in your first commit as they are; never edit them.
6. **You have no hardware.** Assume no Muse 2 and no Cyton are connected. Everything must be built and tested with the simulators, seeded synthetic fixtures and replay described here. Every hardware-only fact gets a runtime self-check and a fallback (section E). Do not try to connect to real devices.
7. **Project rules that must hold after your work:**
   - Never rename or reorder existing CSV columns; only append.
   - Missing or invalid data is never shown or sent as 0. It is `--` on screen and `null` in data.
   - Stale and held values are marked as such.
   - Legacy code and parked code (`focus/experimental/*`, `stress.js` `makeMeter`) stay in the repo and keep working. Do not delete them. Do not change the legacy formulas.
   - Python tools go in `tools/`, the SOP in `workflows/`, scratch files in `.tmp/` (git-ignored). Secrets (none needed) would go in `.env`.
   - Tests are plain Node scripts and plain Python scripts. **No npm install, no new npm dependencies, no test framework.** Python dependencies are listed in `tools/requirements.txt`.
   - Code comments and UI text are plain and short. No marketing words.
8. **Honesty in the product** (must appear in UI notes and docs): the scores are within-person relative indices, not validated measures; STRESS measures physiological arousal (excitement looks the same); artifact windows are held and fade to `--`, they are not measured; Muse focus is weaker than Cyton focus; person detection on the Muse is unreliable; OpenBCI retired the WiFi Shield for reliability problems, so the USB dongle is the fallback.
9. Forbidden in the new engine: beta above 20 Hz, gamma, or theta/beta ratio as a focus input; ICA/ORICA; deep-learning denoisers; regressing EMG out of the EEG; min-max score scaling; any instructed calibration step ("clench", "blink 5 times", "do arithmetic", "close your eyes", "sit still for N seconds and press").

## A3. Words used in this prompt

- **New** = the new engine. **Legacy** = the formulas that exist today.
- **Stream time** `t` = seconds since the current stream started, computed as `sampleIndex / fs`. All engine timing uses stream time, so tests are deterministic. Wall-clock time is used only by the panel glue.
- **Clean time** = stream time that is not masked and not in a gap. Learning uses a clean-time clock: masked time and gaps add nothing and age nothing.
- **Hop** = 0.25 s. **Window** = 2 s.
- `ln` = natural log. Band powers are in µV². "Log power" = `ln(power + 1e-12)`.
- MAD = median absolute deviation. Robust sigma `σr = 1.4826 · MAD`.

---

# B. WHAT EXISTS TODAY (read these files first, in this order)

The app is plain JavaScript loaded as classic scripts that share one global scope. **Important fact:** `Open Muse Panel.bat` opens `muse-panel.html` from `file:///` in an Edge app window (it is *not* served from localhost). So: `fetch()` of local JSON files does not work in the page; WebSocket to `ws://127.0.0.1` and `fetch` POST to `http://127.0.0.1:8765/` do work. Do not change the launchers' behaviour.

Script load order in `muse-panel.html` (bottom of the file): `game/bomb-logic.js, game/bomb.js, game/menu.js, panel/core.js, panel/pulse.js, panel/motion.js, panel/ui.js, panel/dsp.js, panel/ble.js, panel/focus.js, focus/focus-switch.js, panel/recording.js, panel/gamelink.js, panel/main.js, arousal.js, stress.js, panel/stress-link.js`.

| File | What it does now | What you do with it |
|---|---|---|
| `panel/core.js` | Constants (`FS=256`, `PKT=12`, `PPG_FS=64`, `SENSORS=["TP9","AF7","AF8","TP10"]`, `BANDS`, `BUF_LEN=FS*4`), shared state `S`, URL options `DEMO` (`?demo=1`), `DROP`, `$()`, `biquad`, `biquadFs`, `makeFilters`. | Keep. Add `S.dev`. |
| `panel/dsp.js` | `resetStream()`, `handlePacket(ch,seq,vals)` (sequence alignment, lost samples skipped, never filled; sets `S.gapAt`), `emit(vals,idx)` (per-channel one-pole DC removal `y=uv-h.x+0.995*h.y` giving `ys[0..3]`; `\|y\|>300` sets `S.artUntil` for 1.2 s; band biquads on the **average** of usable channels), `recPush`, the 1 s interval (contact % `S.pct[i]` from 1 s RMS `S.rms[i]`, rate, loss, `ppgAnalyse()`, `hrUi()`, `motionUi()`). | Keep all maths. Add one tap line in `emit()` (D2). Guard Muse-only UI updates when `S.dev==="cyton"`. |
| `panel/ble.js` | Web Bluetooth link (`connectMuse`, `disconnectMuse`, `onDrop`, retry), decoders, and the simulated headband `startDemo()/stopDemo()` (47 ms timer; 4 EEG channels: 2.1 Hz 40 µV, 6 Hz 22 µV, 10 Hz `window.demoAlpha`=28, 21 Hz `window.demoBeta`=14, 38 Hz `window.demoGamma`=6, noise; channel 3 has ±130 µV noise on purpose; PPG at `window.demoHr`=72; a 3 s head movement every 20 s unless `window.demoMove===false`). | Do not rewrite. |
| `panel/pulse.js` | `PL` state, `onPpg(seq,vals)` (offset removal, 0.7–3.5 Hz band-pass into ring `PL.bp`, validity marks `PL.mk`, gaps as NaN), `ppgAnalyse()` (autocorrelation heart rate `PL.bpm`, quality `PL.pct`, `PL.state`), `hrUi()`. | Keep. Add one tap line in `onPpg`. |
| `panel/motion.js` | `MOT` thresholds, `onMotion(kind,seq,v,now)`, `motionFeatures`, `motionStep` (hysteresis: entry `median+5·MAD`, exit `median+3·MAD`, 1.5 s still to resume), 30 s still-calibration, `S.mot.bad/status`, recording columns `MOTION_REC_COLNAMES`. | Keep (Legacy uses it). Add one tap line in `onMotion`. Port its logic into `engine/motion.js`. |
| `panel/focus.js` | Legacy focus state `focus={ema,fast,lo,hi,cal,result,raw}`, `pctOf(f)` (25 + 50·(ema−lo)/(hi−lo), clamped), `renderFocus()`, floating PiP meter `toggleFloat()`. | Keep maths. `renderFocus()` shows New or Legacy. |
| `focus/focus-switch.js` | `MODE_PREF` (`focus`/`stress`), `effMode()`, `shown()`, `focusPct()` (stress = 100 − focus), `motionHeld()`, `saveBaselines/loadBaselines` (`localStorage` `muse2panel.baselines`), `renderFocusSwitch()`. | Extend for New/Legacy and DROWSY. |
| `panel/gamelink.js` | `GameMenu.attach({ctx})` with `focus()`, `stress()`, `sensors()`, `status()`; `sendGame(p)` POSTs `{focus,mode,sensors,motion,stale}` to `http://127.0.0.1:8765/` every ≥230 ms; `startCal/finishCal` (10 s baseline); the 250 ms legacy loop: `F=ln((β+1e-3)/(α+1e-3))`, `ema += 0.08·(F−ema)`, held while `S.mot.bad`. | Keep the legacy loop untouched. Extend `sendGame` and `ctx`. |
| `arousal.js` | UMD module `Arousal` (`F = 100·clip(0.40H+0.35V+0.25E)`), with the rule "a missing component is never zero; renormalise weights". | Keep. It is Legacy stress. Its UMD pattern is the pattern for all new engine files. |
| `stress.js` | UMD `Stress`: `fft`, `bandPowers`, `findBeats(x,fs)`, `ibisFromBeats(times)`, `rmssd`, `makeMeter`, `attach(cfg)` (the `#stressCard`, hidden unless `?stress=1`). | Keep. Reuse `findBeats`/`ibisFromBeats` from the engine by reference. |
| `panel/stress-link.js` | Creates `window.StressMeter = Stress.attach({...})`. | Keep. |
| `panel/recording.js` | `startRec/stopRec`, CSV: `time_s` + `COLNAMES` (14 fixed columns) + 3 motion columns; 10 min cap (`REC_MAX_SEC=600` in dsp.js). | Keep columns. Append engine columns (D16). |
| `panel/ui.js`, `panel/ui.css`, `focus/focus-switch.css` | Absolute-positioned 1672×941 stage scaled to the window; three looks via `document.documentElement.dataset.look` = `cosmic` \| `clean` \| `neon`; `toast()`, `setStatus()`, `setButtons()`, `mk()`, `fit()`. | Extend. |
| `game/menu.js` | `GameMenu.register/attach/open`; built-in games `defuse` (bomb), `mariokart-js`, external `mariokart-py`, `stacker`. | Add `metrics()`, `events()` to what games receive; update wording. |
| `game/bomb.js`, `game/bomb-logic.js` | Bomb game. `BombUI.open({source, stress, focus, status})`. `stress()` returns 0..1 or null; `null` is handled as "no reading" (line ~710). | No gameplay change. |
| `game/mkds.js`, `game/mkds-render.js` | Browser Mario Kart, `MKDSUI.open({stage, focus, sensors, status, onClose})`. | No gameplay change. |
| `game-py/link.py` | `HeadbandLink`: HTTP server on 127.0.0.1:8765, reads at most **1024** bytes of body, parses `focus` and `sensors`, `read()` → `(state, focus, sensors)`. | Extend (D17). |
| `game-link/stacker.py` | Older game with its own `HeadbandLink` that reads at most **512** bytes. | Raise the cap only (D17), or it will break on the larger body. |
| Tests | `node arousal.test.js`, `node stress.test.js`, `node panel/motion.test.js`, `node game/bomb.test.js`, `node game/mkds.test.js`, `node focus/experimental/focus.test.js`, `python game-py/test_mkds.py`. Style: plain script, `ok(cond,msg)` helper that prints `PASS`/`FAIL` lines, non-zero exit code on any failure. | Must still pass. New tests copy this style. |
| Docs | `README.md`, `docs/DETAILED_README.md`, `docs/focus-correction-plan.md`, `PLAN.md`, `focus/README.md`, `panel/README.md`, `game/README.md`, `game-py/README.md`. | Update (section H). |

Run all seven existing tests before you change anything and record the result in `docs/IMPLEMENTATION_NOTES.md`. If one already fails before your changes, record it, fix it only if the fix is trivial and safe, and make sure it is not worse at the end.

Why the old maths is being replaced (keep these reasons in the docs): legacy focus uses beta 13–30 Hz, which is where forehead muscle (frontalis) peaks, so a frown or jaw clench reads as "focus"; band power is taken from the channel average, which mixes artifacts in; the 10 s baseline is too short; legacy stress on screen is just 100 − focus; the arousal model's reference points (+40 bpm, RMSSD ×0.5) are far too extreme; Muse PPG RMSSD is biased about 1.9× high; β/α is mostly EMG.

---

# C. TARGET ARCHITECTURE

## C1. Files to create

```
engine/                      pure maths, no DOM, each file UMD, each with a *.test.js
  util.js                    RNG, stats, ring buffers, biquads, FFT, Welch, Jacobi eigen, Cholesky
  frame.js                   common frame format, validation, gap bookkeeping
  fixtures.js                seeded synthetic EEG / ECG / PPG / accel generators and artifact injectors
  preproc.js                 per-channel filters
  contact.js                 contact quality 0-100 per channel
  motion.js                  motion gate (port of panel/motion.js) + EEG-derived proxy
  events.js                  artifact event detector (blink, eyes_closed, saccade, emg_burst, pop, gap, bad_contact)
  mask.js                    mask timeline and window usability
  clean.js                   ASR and accelerometer NLMS (flags)
  features.js                Welch band powers per channel set, IAF, aperiodic fit
  ecg.js                     R-peak detection, RR cleaning, HR, RMSSD, SQI
  ppg.js                     beats/HR/RMSSD from the Muse pulse signal
  norm.js                    self-calibrating normalization (the learning core)
  priors.json                population priors (canonical)
  priors.js                  generated from priors.json by tools/build_priors.js (for the file:// page)
  metrics.js                 focus, stress, drowsiness models
  buttons.js                 double_blink and clench_tap
  holdfade.js                hold + fade state machine
  identity.js                person auto-detection
  profiles.js                profile store, session summaries, rebuild, export/import
  legacy.js                  legacy focus formula for the Cyton (parallel output)
  gamebody.js                builds the v2 game-link JSON body
  pipeline.js                MuseEngine.create(): wires everything in the fixed order
  tuned.json / tuned.js      written later by tools/autotune.py (absent until then; engine works without)
adapters/
  muse.js                    turns the panel's Muse buffers into frames
  cyton.js                   WebSocket client to the helper, decodes frames
  cyton-sim.js               in-browser simulated Cyton (for ?demo=1&device=cyton, no helper needed)
panel/
  engine-link.js             glue: adapters -> engine -> UI/game link/recording. Loaded after stress-link.js
  engine-ui.js               DOM for the new controls, cards, badges
  engine-ui.css              styles for all three looks
  engine-rec.js              v2 recorder (multi-file) used in Cyton mode and by the validation protocol
  validation.js              the guided protocol overlay (active with ?validate=1)
validation.html              entry page for the validation recording
tools/
  cyton_helper.py            BrainFlow -> WebSocket helper, with --simulate
  test_cyton_helper.py
  requirements.txt
  replay.js                  headless replay of a recording through the engine
  make_synth_recording.js    writes a synthetic validation recording (for tests of autotune/replay)
  autotune.py                analysis + tuning -> engine/tuned.json, engine/tuned.js, docs/validation-report.md
  test_autotune.py
  get_datasets.py            optional public datasets -> .tmp/datasets/
  build_priors.js            priors.json -> priors.js
  run_all_tests.js           runs every old and new test, prints a table, exit code 0 only if all pass
  browser_smoke.js           optional headless Edge/Chrome smoke test + screenshots
  README.md
  testdata/frame_v1.hex      one reference binary frame (written by the helper test, read by the JS test)
Open Cyton Helper.bat
workflows/validate_focus_stress.md
docs/IMPLEMENTATION_NOTES.md
game-py/test_link.py
```

## C2. Module pattern (mandatory)

The page's classic scripts share one global scope and already define top-level names such as `FS`, `S`, `BANDS`, `focus`, `quantile`, `med`, `madOf`, `fmt`, `f1`, `mk`, `C`, `TH`, `MOT`, `PL`, `$`. A second top-level `const` with the same name is a page-breaking SyntaxError. Therefore every new JS file under `engine/` and `adapters/` is one IIFE with no top-level declarations outside it:

```js
"use strict";
(function (root) {
  const E = root.MuseEngine = root.MuseEngine || {};
  const U = E.Util || (typeof require !== "undefined" ? require("./util.js") : null);
  // ... module code ...
  const API = { /* exports */ };
  E.Events = API;                                   // one property per module on the shared namespace
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
```

Namespace properties: `Util, Frame, Fixtures, Preproc, Contact, Motion, Events, Mask, Clean, Features, Ecg, Ppg, Norm, PRIORS, TUNED, Metrics, Buttons, HoldFade, Identity, Profiles, Legacy, GameBody, create` (pipeline), and `MuseEngine.Adapters = {Muse, Cyton, CytonSim}`. In Node, modules `require` their dependencies; in the page they read them from `root.MuseEngine`. `panel/*.js` files you add may use top-level names but each must be prefixed `eng` / `Eng` (for example `engState`, `EngUI`) and you must grep the repo to confirm no clash.

Script tags to add to `muse-panel.html`, after `panel/stress-link.js`, in this order: `engine/util.js, frame.js, fixtures.js, preproc.js, contact.js, motion.js, events.js, mask.js, clean.js, features.js, ecg.js, ppg.js, norm.js, priors.js, metrics.js, buttons.js, holdfade.js, identity.js, profiles.js, legacy.js, gamebody.js, pipeline.js, adapters/muse.js, adapters/cyton.js, adapters/cyton-sim.js, panel/engine-rec.js, panel/engine-ui.js, panel/engine-link.js, panel/validation.js`. `engine/tuned.js` is loaded by `engine-link.js` with a dynamically created `<script>` whose `onerror` is ignored (the file is absent until Julian runs the auto-tune). Add `<link rel="stylesheet" href="panel/engine-ui.css">` after `focus/focus-switch.css`. The tap lines inside `dsp.js`, `pulse.js` and `motion.js` test `typeof` at call time, so load order is not a problem.

## C3. The common frame (adapter → engine)

```js
{
  device: "muse" | "cyton",
  streamId: 1,                       // increments when the stream restarts; engine resets stream state on change
  fs: 256,                           // per-channel EEG rate in Hz (Muse 256; Cyton 125 or 250)
  channels: ["TP9","AF7","AF8","TP10"],   // names of the rows in samples, 10-20 names
  sampleIndex: 123456,               // index of the first sample of this frame; stream time t0 = sampleIndex / fs
  t0: 482.25,                        // = sampleIndex / fs (seconds)
  samples: [Float32Array, ...],      // one array per channel, n samples each, µV. No NaN. Contiguous inside a frame.
  gaps: [{at: 123400, n: 24}],       // samples lost immediately before `at` (never interpolated). Usually empty or one entry before this frame.
  accel: {fs: 52, t: Float64Array, xyz: Float32Array} | null,   // g; t = stream time of each sample; xyz interleaved
  gyro:  {fs: 52, t: Float64Array, xyz: Float32Array} | null,   // deg/s (Muse only)
  ppg:   {fs: 64, t0: number, data: Float32Array} | null,       // Muse: 0.7-3.5 Hz band-passed pulse samples, NaN = missing
  ecg:   {fs: 125, data: Float32Array, channel: 8} | null,      // Cyton: raw µV of the ECG channel (same n as samples); that channel is also present in samples and is excluded from EEG use
  contact: [78, 100, 96, 41] | null, // Muse: the panel's S.pct per channel. Cyton: null (engine computes it)
  aux: { ppgHr: 72.1 | null, flags: {impedance: false, simulated: false} }
}
```

`engine/frame.js` exports `validate(frame)` (throws with a clear message on a malformed frame), `makeClock(fs)` and `GapBook` (records gaps as `{t0,t1}` in stream time; a gap of `n` samples before index `i` spans `[(i−n)/fs, i/fs]`).

## C4. Engine pipeline (fixed order) and timing

`MuseEngine.create(opts)` returns an engine object:

```js
const eng = MuseEngine.create({
  device, fs, channels, ecgChannel /* index or -1 */, mains: 60,
  flags: { asr: device==="cyton", nlms: false },
  priors: MuseEngine.PRIORS, tuned: MuseEngine.TUNED || null,
  store: profileStore | null,          // null = no persistence (tests)
  legacyProvider: () => ({focus, stress}) | null,   // Muse: values from the existing panel code
  ownerBaseRate: 0.7
});
eng.push(frame)        // feed data; returns the array of output objects produced by this push (0, 1 or more)
eng.idle(dtSec)        // no data arrived for dtSec of wall time: advances hold/fade ("signal lost")
eng.onEvent = fn       // called immediately for button events (not delayed)
eng.output()           // last output object
eng.endSession()       // commit the session summary to the store; returns the summary
eng.identity           // identity API (D14)
eng.debug()            // internal state snapshot for tests
```

Stages, run in this order every time enough new samples have arrived:

| # | Stage | Cadence | Input → output | State |
|---|---|---|---|---|
| 1 | Ingest + gap bookkeeping (`frame.js`) | every frame | frame → ring buffers per channel (keep 30 s), `GapBook` | sample counter, stream id |
| 2 | Preprocess (`preproc.js`) | every sample | raw → `xb` (DC-removed, notched), `xa` (also low-passed) per channel | filter states |
| 3 | Contact (`contact.js`) | every 1 s | `xb`, raw → quality 0–100 per channel, excluded set | smoothed quality |
| 4 | Events (`events.js`, `motion.js`) | every 50 ms, 250 ms look-back | `xb`, accel/gyro, gaps, contact → events, mask intervals | running robust stats |
| 5 | Cleaning (`clean.js`), optional | ASR every 500 ms; NLMS per sample | `xa` → `xc` | ASR calibration, NLMS weights |
| 6 | Features (`features.js`) | every hop (250 ms) on the 2 s window that ends `D` seconds in the past | `xc` (or `xa`), masks → log band powers per channel set, clean fraction | IAF accumulator |
| 7 | Metric models (`metrics.js`, `ecg.js`, `ppg.js`, `buttons.js`) | hop (buttons: immediately at stage 4) | features, beats, events → raw metric values | per-metric EMA |
| 8 | Normalization (`norm.js`) | hop | raw features → personal z → 0–100 | profile + session statistics |
| 9 | Hold/fade + output (`holdfade.js`) | hop | metric + usability → `{value, conf, state, reason}` | per-metric state machine |

**Analysis delay `D`.** Scores at stream time `t` are computed from the window `[t − D − 2, t − D]`. `D = 0.5 s` (plus 0.5 s more when ASR is on, so `D = 1.0 s` on the Cyton with ASR). Reason: event detection lags the artifact by 200–400 ms; delaying the scored window means a mask always exists before the window is used, so detection lag never leaks into a score. Button events are **not** delayed.

**Output object** (one per hop):

```js
{
  t: 482.25, device: "cyton",
  profile: { id: "p_ab12", label: "Julian", confidence: 0.82, state: "confirmed"|"tentative"|"uncertain"|"guest" , badge: "Learning you (7 min)" },
  focus:      { value: 63.2|null, conf: 0..1, state: "live"|"held"|"stale"|"learning"|"unavailable", reason: null|"movement"|"muscle"|"blink"|"no contact"|"no ECG"|"no pulse"|"signal lost"|"eyes closed"|"learning" },
  stress:     { value, conf, state, reason, components: { hr:{z, valid, bpm}, hrv:{z, valid, rmssdMs}, eeg:{z, valid} }, exertion: false },
  drowsiness: { value, conf, state, reason, markers: { ratio:{z,valid}, blinkDur:{z,valid}, blinkRate:{z,valid}, perclos:{z,valid}, spindles:{z,valid} } } | null,   // null on the Muse
  events: [ { id, type, t, onset, offset, conf, channels, amp, durMs, sub } ],   // events finalised since the previous output
  quality: { perChannel: [0..100], excluded: ["T7"], ecg: { bpm, sqi, state }|null, motion: "valid"|"movement"|"no_data"|"proxy", packetLoss: 0.4 /* % */, asr: {on, calibrated, removedFrac}|null, warnings: [] },
  legacy: { focus: 55.1|null, stress: null|number }
}
```

Rules: `value` is `null` whenever `state` is `stale` or `unavailable`. In `learning`, focus and stress carry a number (scored with population priors or a re-anchoring baseline) and drowsiness carries `null`. State priority when several apply: `unavailable > stale > held > learning > live`.

**Legacy in parallel.** On the Muse the existing panel code keeps running unchanged at all times; `legacyProvider` returns `{focus: pctOf(focus), stress: StressMeter.value()}`. On the Cyton, `engine/legacy.js` computes legacy focus (D15). Switching New/Legacy only changes which number is displayed and sent as `focus`; both are always computed, so the switch is instant.

## C5. Device rates the engine must handle

Any per-channel rate ≥ 125 Hz. In practice: Muse 256 Hz; Cyton 125 Hz (dongle, or WiFi delivering 125) or 250 Hz (WiFi; the helper decimates 500/1000 Hz board rates down to 250 Hz, see D3). No constant may be hard-coded for one rate: every filter coefficient, window length in samples and threshold "per sample" is derived from `fs`. All analysis bands end at or below `fs/2 − 5` Hz. The EMG band is 25–55 Hz when `fs < 250` and 25–100 Hz when `fs ≥ 250`.

---

# D. MODULE SPECIFICATIONS

Every constant below is a default. Constants marked **[tunable]** must be read from one config object (`MuseEngine.CONFIG`, defined in `pipeline.js`, deep-merged with `MuseEngine.TUNED.config` when present) so `tools/autotune.py` can overwrite them without code changes.

Where Julian's requests (R1–R17 in `docs/fable-requests-cyton-artifact-robust.md`) are specified here: R1 architecture → C, D1, D2, D4; R2 helper → D3; R3 preprocessing/contact → D6; R4 event detector → D7, D8; R5 cleaning → D15; R6 focus, R7 stress, R8 drowsiness → D9, D10, D12; R9 buttons → D13; R10 normalization → D11; R11 hold/fade → D13; R12 identity → D14; R13 UI → D16; R14 validation/auto-tune → D18, D19; R15 tests → each module and G; R16 game link → D17; R17 docs → H. This prompt is complete on its own; that document and `docs/fable-research-appendix.md` are background only, and where they differ from this prompt, this prompt wins.

## D1. `engine/util.js`

- `rng(seed)` → mulberry32 generator with `.next()` (0..1), `.normal()` (Box–Muller). All fixtures and tests are seeded.
- `median(a)`, `mad(a, med)`, `quantile(sortedArr, q)`, `clamp(x, lo, hi)`, `mean`, `variance`, `kurtosis(a)` (Pearson: Gaussian = 3), `skewness`, `pearson(a,b)`.
- `Ring(n)` (Float32 ring buffer with `push`, `get(iFromEnd)`, `copyLast(n, out)`), `RunningMedian(windowN)` (sorted insertion; used at ≤ 20 Hz update rates only).
- Biquads (RBJ cookbook, direct form I, with `reset()`): `hp(fc, fs, Q=0.7071)`, `lp(fc, fs, Q=0.7071)`, `bp(f0, fs, Q)`, `notch(f0, fs, Q=30)`; `dcBlock(fc, fs)` = one-pole `y[n] = x[n] − x[n−1] + r·y[n−1]` with `r = exp(−2π·fc/fs)`.
- `fft(re, im)` radix-2 in place; `nextPow2(n)`; `hann(n)`.
- `psd(x, fs)` for one segment: remove mean, Hann window, zero-pad to `nfft = nextPow2(n)`, one-sided density `P[k] = 2·|X[k]|² / (fs · Σw²)` in µV²/Hz, `df = fs/nfft`. `bandPower(P, df, lo, hi)` = `Σ P[k]·df` for bins with `lo ≤ k·df < hi`.
- `goertzelPower(x, f, fs)`.
- `jacobiEig(A, n)` for symmetric matrices (cyclic Jacobi, stop when off-diagonal norm < 1e-12·trace or 60 sweeps) → `{values, vectors}`; `cholesky(A, n)`; `matMul`, `transpose`, `pinvSym`.
- `linfit(x, y)` → `{slope, intercept}`.

Tests (`engine/util.test.js`): FFT of a 10 Hz sine at fs 256 peaks in the right bin; `psd` band power of a 20 µV-peak sine equals 200 µV² within 3% at fs 125, 250 and 256; Jacobi reconstructs a random symmetric 16×16 matrix to 1e-9; biquad notch attenuates 60 Hz by ≥ 30 dB and 10 Hz by ≤ 0.5 dB at fs 125 and 256; `rng(1)` is reproducible.

## D2. `adapters/muse.js` and the three tap lines

Add exactly these lines to legacy files (nothing else in their maths changes):

- `panel/dsp.js`, in `emit()`, right after the `for` loop that fills `ys` and before the `if(S.emitted<FS*2)return;` line: `if(typeof engTapEeg==="function")engTapEeg(ys,idx);`
- `panel/pulse.js`, at the end of `onPpg()`: `if(typeof engTapPpg==="function")engTapPpg();`
- `panel/motion.js`, at the end of `onMotion()`: `if(typeof engTapMotion==="function")engTapMotion(kind,v,now);`
- `panel/dsp.js`, at the end of `resetStream()`: `if(typeof engTapReset==="function")engTapReset();`

`panel/engine-link.js` defines `engTapEeg/engTapPpg/engTapMotion/engTapReset` as thin calls into `MuseEngine.Adapters.Muse`.

`MuseEngine.Adapters.Muse.create({onFrame})`:

- `eeg(ys, idx)`: `idx` is the panel's aligned sample index. Keep `idx0` = first index seen after a reset; `sampleIndex = idx − idx0`. If `idx` jumps by more than 1, record a gap of `(jump − 1)` samples (the panel already skipped them; nothing is filled). Skip the first `2·256` samples after a reset (the panel's offset filter is settling). Buffer 12 samples, then emit one frame (≈ 47 ms).
- `ppg()`: read the samples appended to `PL.bp` since the last call (track `PL.bpPos`; if `PL.filled` shrank, the pulse path was reset → drop the adapter's pulse buffer). Samples where `PL.mk` is 0 are passed as `NaN`. Attach them to the next frame as `ppg`, with `t0` = stream time of the first sample (derived from the wall-clock mapping below). `aux.ppgHr = PL.bpm` when `PL.state` is `LIVE` or `WEAK`, else null.
- `motion(kind, v, now)`: `v` holds 3 samples of x,y,z. Convert the wall time of each sample (`now − (2−k)·1000/52` ms, same as `onMotion`) to stream time with the mapping below and queue for the next frame as `accel` / `gyro`.
- Wall-clock mapping: on every emitted EEG frame store `wallOffset = Date.now()/1000 − (sampleIndex + n)/256`. Stream time of an auxiliary sample = `wall/1000 − wallOffset`. (Jitter of a few tens of ms is covered by the mask margins.)
- `contact` = `S.pct.map(v => v==null ? 0 : v)`.
- `reset()`: bump `streamId`, clear buffers.

Test (`adapters/muse.test.js`, Node, with a fake `S`/`PL`): 2 s of settling is skipped; a jump of 24 in `idx` produces `gaps:[{at, n:23}]`; frames have 12 samples; PPG NaN marks pass through; a reset bumps `streamId`.

## D3. `tools/cyton_helper.py` (Python helper) and `Open Cyton Helper.bat`

A browser cannot receive the WiFi Shield's TCP push and BrainFlow is native, so a local helper bridges the board to the page.

### D3.1 Command line

```
python tools/cyton_helper.py [--link auto|wifi|dongle] [--ip 192.168.4.1] [--ip-port 3000]
    [--serial-port COMx] [--rate auto|250|500|1000] [--ecg-channel 9] [--mains 60|50]
    [--ws-port 8766] [--simulate] [--sim-rate 125|250|500|1000] [--sim-seed 1]
    [--sim-script default|quiet|artifacts|validation] [--sim-loss 0.0] [--sim-no-accel] [--sim-no-ecg]
    [--sim-ecg-on 9] [--run-seconds N] [--log-level info]
```

Defaults: `--link auto`, `--ip` unset in `auto` (try `192.168.4.1` first, then BrainFlow SSDP discovery by leaving `ip_address` empty), `--ip-port 3000`, `--rate auto`, `--ecg-channel 9` (1-based board channel; `0` = no ECG, all 16 are EEG), `--mains 60`, `--ws-port 8766` (8765 stays the game link). `--run-seconds` makes the helper exit cleanly after N seconds (used by tests).

Dependencies in `tools/requirements.txt`: `brainflow>=5.12`, `websockets>=12`, `numpy`, `scipy`, `pyserial`. **Import `brainflow` and `serial` lazily, only on the real-board path**, so `--simulate` and the tests run without them. Use the modern `websockets.asyncio.server` API.

### D3.2 Board handling (real hardware path; you cannot run it, so write it carefully and cover its logic with the simulated board class)

Structure the code around a small interface `Board` with methods `start(rate) -> info`, `read() -> ndarray rows`, `config(cmd)`, `stop()`, and two implementations: `BrainFlowBoard(link, ...)` and `SimBoard(...)`. All logic above the board (rate selection, loss accounting, ECG detection, framing, self-checks, reconnect) is shared and therefore testable with `SimBoard`.

- WiFi: `BoardIds.CYTON_DAISY_WIFI_BOARD` (id 6), `params.ip_port = 3000`, `params.ip_address` = `--ip` or empty for SSDP, `params.timeout = 10`.
- Dongle: `BoardIds.CYTON_DAISY_BOARD`, `params.serial_port` = `--serial-port` or auto-scan with `serial.tools.list_ports`: pick ports whose USB VID is `0x0403` (FTDI); if several, try each in order until one yields data within 5 s.
- `--link auto`: try WiFi; if no data rows arrive within 10 s, release it and try the dongle; if that fails too, wait and alternate forever (reconnect loop below).
- Channel settings sent once after `prepare_session` and before streaming, one command per channel, 0.3 s apart, via `config_board`: EEG channels `x<c>060110X` (power on, gain 24, normal input, bias on, SRB2 on, SRB1 off) where `<c>` is `1`–`8` for channels 1–8 and `Q W E R T Y U I` for 9–16. The ECG channel (default 9 = `Q`) gets `x<c>050000X` (gain 12, bias **off**, SRB2 **off**, SRB1 off: the two pins of that channel measure the chest lead against each other). Never rescale the ECG channel in software: depending on the BrainFlow version its µV scale may be off by a constant factor of 2, so **all ECG processing must be scale-invariant** (it is, see D10).
- Sample rate on WiFi (`--rate auto`): candidate board rates `[1000, 500, 250]`, set with the Cyton command `~4` (1000), `~5` (500), `~6` (250) before `start_stream`. For each candidate: stream 20 s, compute loss = missing sample-counter steps / expected (the BrainFlow package-number channel wraps at 256), accept the first candidate with loss < 1%. Remember the accepted rate in `.tmp/cyton_helper_state.json` and try it first next time. Data flows to the page during the trial; if the rate changes, send a new `config` message with a new `streamId`. If the `~` mapping does not behave as documented, trust the **measured** rate: `fs_meas = (rows − 1)/(t_last − t_first)` over ≥ 5 s, snapped to the nearest of {125, 250, 500, 1000} when within 3%.
- Dongle: fixed (250 packets/s on the radio = 125 Hz per channel with the Daisy). Still measure.
- Output rate to the page: if the measured per-channel rate is 500 or 1000, low-pass with an 8th-order Butterworth at 100 Hz (`scipy.signal.sosfilt` with carried state) and decimate by 2 or 4 to **250 Hz**. If it is 250 or 125, pass through. Reason: nothing downstream uses content above 100 Hz, CPU and frame size stay bounded, and the higher board rate still buys a cleaner 25–100 Hz EMG band.
- Gaps: detect from the sample counter. Lost samples are never interpolated. A frame never spans a gap: close the current frame before the gap; the next frame carries the "gap before" flag and a `sampleIndex` advanced by the number of lost output samples. After a gap, reset the decimation filter state.
- Accelerometer: `try: BoardShim.get_accel_channels(board_id)`; rows where all three accel values are exactly 0 carry no accel sample (the board interleaves it at about 25 Hz). If the call raises, or no non-zero accel row appears in the first 10 s, report `accel.present=false`; the engine then uses the EEG motion proxy (D6).
- Reconnect: if no rows arrive for 3 s, send status `reconnecting`, release the session, retry with back-off 2, 4, 8, 10, 10… s forever (in `auto`, alternate WiFi and dongle). On Ctrl+C or WebSocket `cmd:"shutdown"`: `stop_stream`, `release_session`, close sockets, exit 0.

### D3.3 WebSocket transport

Bind `127.0.0.1:8766` only. Accept any `Origin` (the page is `file://`, origin `null`). Any number of clients; broadcast to all. If a client's send queue holds more than 2 s of frames, drop its oldest frames and count them in `stats.clientDrops`. Text messages are JSON; binary messages are data frames.

**Binary data frame, little-endian, one every 40 ms (or earlier when a gap closes the frame):**

| Offset | Type | Field |
|---|---|---|
| 0 | u8 | magic `0xCB` |
| 1 | u8 | protocol version `1` |
| 2 | u8 | message type `1` (data) |
| 3 | u8 | `C` = number of channels (16) |
| 4 | u16 | `N` = samples per channel in this frame (≥ 1) |
| 6 | u8 | `A` = number of accelerometer samples in this frame (0–255) |
| 7 | u8 | flags: bit0 accel channel exists, bit1 gap immediately before this frame, bit2 simulated, bit3 decimated, bit4 impedance check running (data distorted) |
| 8 | u64 | `sampleIndex` of the first sample (output-rate samples since stream start, lost samples counted) |
| 16 | f64 | board timestamp of the first sample (Unix seconds) |
| 24 | u32 | `lostTotal` = lost output samples since stream start |
| 28 | f32 | `fs` = per-channel output rate in Hz |
| 32 | f32 × C × N | EEG/ECG in µV, channel-major: all N samples of channel 0, then channel 1, … (raw: DC-coupled, unfiltered except the decimation filter) |
| 32 + 4CN | A × 16 bytes | accel samples: u16 sample offset within the frame, u16 zero padding, f32 x, f32 y, f32 z (g) |

Total length = `32 + 4·C·N + 16·A`. The decoder rejects frames with a wrong magic, version, or length.

**JSON messages helper → page** (all have `type`):

- `hello`: `{type, proto:1, helper:"cyton_helper", version, simulated}` on connect, followed by the latest `status`, `config` and `selfcheck`.
- `status`: `{type, state:"starting"|"connecting"|"rate_test"|"streaming"|"reconnecting"|"impedance"|"stopped"|"error", link:"wifi"|"dongle"|"sim", detail, t}`.
- `config`: `{type, streamId, fs, boardFs, decim, channels:[16 names], ecgChannel:<0-based index or -1>, unusedChannels:[indices], accel:bool, link, mains, gainEeg:24, gainEcg:12}`. Sent whenever a stream (re)starts; `sampleIndex` restarts at 0 with each new `streamId`.
- `selfcheck`: `{type, daisy:bool, nCh, perChannel:[{name, railed, flat, rmsUv, lineRatio}], accel:{present, reason}, rate:{requested, measured, lossPct}, alias:{checked, freqHz, ratio, warn}, ftdi:{checked, burstMs, warn, fix}, ecg:{configured, detected, channel, kurtosis, acPeak, bpm, moved}, warnings:[strings]}`. Sent about 20 s after streaming starts and again whenever a value changes.
- `stats` every 1 s: `{type, fs, lossPct /* last 10 s */, lostTotal, link, uptimeS, clientDrops}`.
- `impedance`: `{type, channel, name, kohm, rmsUv}` per channel, then `{type:"impedance_done", results:[...]}`.
- `error`: `{type, code, message, fix}`.
- `pong`.

**JSON messages page → helper:** `{type:"cmd", cmd:"ping"|"impedance_sweep"|"stop_impedance"|"set_ecg_channel"|"restart"|"shutdown", channel?}`.

Default channel names (Ultracortex Mark IV 16-channel default; the Daisy half is inferred, so it is checked at runtime, see E): `["Fp1","Fp2","C3","C4","P7","P8","O1","O2","F7","F8","F3","F4","T7","T8","P3","P4"]`. With the ECG on channel 9, index 8 (`F7`) is reported as name `ECG`.

### D3.4 Self-checks (run automatically; results go to the log and to the page)

1. **Daisy attached:** 16 EEG channels present in BrainFlow's channel list and the 8 Daisy channels are not all exactly zero. If not: `error` code `no_daisy`, continue with 8 channels marked usable and the rest `unused`.
2. **Per channel (first 10 s, then every 10 s):** railed = more than 2% of raw samples with |value| ≥ 0.95 × 187 500 µV; flat = 1–45 Hz RMS < 1 µV; `lineRatio` = power at the mains frequency (Goertzel) / 1–45 Hz power.
3. **Accelerometer present** (D3.2).
4. **Measured rate and loss** (D3.2).
5. **Mains alias (only when the output rate is 125 Hz):** the 120 Hz mains harmonic folds to exactly 5 Hz (inside theta); with 50 Hz mains the 100 Hz harmonic folds to 25 Hz. On 20 s of data per channel compute a Welch spectrum with 4 s segments; `ratio` = mean density in `[f−0.25, f+0.25]` / mean density in `[f−2, f−0.75] ∪ [f+0.75, f+2]` with `f` = 5 Hz (or 25 Hz). `warn = true` if the ratio exceeds 4 on at least 25% of the EEG channels. The engine then multiplies the confidence of theta-based features by 0.7 and the panel shows a warning (E).
6. **FTDI latency (dongle only):** BrainFlow timestamps rows at host arrival. Take the differences of consecutive row timestamps over 10 s; `burstMs` = median of the differences that are larger than 2 ms. If `burstMs ≥ 10`, `warn = true` with `fix` = "Windows Device Manager → Ports (COM & LPT) → USB Serial Port (COMx) → Properties → Port Settings → Advanced → Latency Timer (msec): set to 1 → OK. Then unplug and replug the dongle."
7. **ECG channel auto-detect (first 15 s, repeated every 60 s while not detected):** for every channel, band-pass 5–15 Hz, then `kurt` = Pearson kurtosis and `acPeak` = the highest normalised autocorrelation of the squared signal at lags 0.33–1.43 s (0.7–3 Hz). A channel "looks like ECG" when `kurt > 6` and `acPeak ≥ 0.5`. If the configured channel looks like ECG: use it. Else if another channel does: use the best one (`moved: true`, warning "ECG found on channel N, not on channel 9"). Else: `ecgChannel = −1` ("no ECG"; stress runs without it). A channel that was configured for ECG (gain 12, no SRB2) but carries no ECG is listed in `unusedChannels`.
8. **Impedance sweep (only on `cmd:"impedance_sweep"`, because it distorts the data):** status `impedance`, flag bit4 set on all data frames; for each EEG channel: `z<c>01Z` (lead-off on the N input), wait 0.5 s, collect 1.5 s, band-pass 28–35 Hz (the test current is 31.5 Hz, 6 nA), `kohm = (RMS_µV · 1e-6 · √2) / 6e-9 / 1000`, then `z<c>00Z`. One channel at a time. Then status `streaming`.

### D3.5 `--simulate`

`SimBoard` generates, at `--sim-rate` (default 125) and with a fixed seed: 16 channels of pink-ish noise (≈ 8 µV RMS) with 10 Hz alpha (stronger on P7, P8, O1, O2, P3, P4), 6 Hz theta on F3/F4, low beta on C3/C4, a ±20 mV DC offset per channel (so DC removal is exercised), a 60 Hz component of 5 µV; an ECG on board channel 9 (unless `--sim-no-ecg`; or on the channel given by `--sim-ecg-on`) at 68 bpm with respiratory RR variation (RMSSD ≈ 35 ms), R amplitude 1000 µV; accel at 25 Hz (unless `--sim-no-accel`); optional random loss `--sim-loss` (fraction) delivered as bursts of 50 samples. `SimBoard` accepts a per-rate loss table so the rate-selection ladder can be tested.

Scripts (`--sim-script`): `quiet` = no artifacts. `default` = a 30 s cycle: single blink at 5 s; a voluntary double blink at 8.00 s and 8.35 s; a jaw-clench tap (0.4 s bilateral T7/T8 burst) at 12 s; head movement 15–18 s (accel 0.15 g at 2 Hz plus 3 Hz, 80 µV drift on all channels); electrode pop on C3 at 22 s; chewing (3 bursts, 1.2 Hz) at 25–27.5 s. `artifacts` = one artifact every 4 s cycling through all types. `validation` = follows the block structure of the validation protocol (D18) at 10× speed. Reuse the same waveform definitions as `engine/fixtures.js` (D5) and document them in `tools/README.md`.

### D3.6 `Open Cyton Helper.bat`

```
@echo off
cd /d "%~dp0"
if not exist ".venv-cyton\Scripts\python.exe" (
  echo First run: creating the Python environment (takes a minute)...
  python -m venv .venv-cyton || (echo Python 3.10+ is needed. Install it from python.org and run this again. & pause & exit /b 1)
  ".venv-cyton\Scripts\python.exe" -m pip install --upgrade pip
  ".venv-cyton\Scripts\python.exe" -m pip install -r tools\requirements.txt || (echo Could not install the helper's packages. Check the internet connection and run this again. & pause & exit /b 1)
)
".venv-cyton\Scripts\python.exe" tools\cyton_helper.py %*
pause
```

Add `.venv-cyton/` to `.gitignore`.

### D3.7 `tools/test_cyton_helper.py` (plain Python, no pytest; prints PASS/FAIL; exit code 1 on failure; must pass without `brainflow` installed)

- H1 frame encode → decode round trip is bit-exact for random data (C=16, N=5 and N=10, A=0 and A=2); the header fields land at the documented offsets; writes `tools/testdata/frame_v1.hex` (a fixed-seed frame) for the JS decoder test.
- H2 rate ladder: loss table `{1000: 3%, 500: 0.4%, 250: 0}` → 500 chosen; `{1000: 0.2%}` → 1000; all ≥ 1% → 250 chosen and a warning issued.
- H3 decimation: 1000 Hz sim → output `fs` 250, a 10 Hz sine keeps its amplitude within 2%, a 180 Hz sine is attenuated ≥ 40 dB.
- H4 gap handling: with 2% burst loss no frame spans a gap, `sampleIndex` advances by exactly the lost count, `lostTotal` matches, no sample is interpolated (frame sample counts sum to received samples).
- H5 ECG auto-detect: ECG on channel 9 → detected on 9; `--sim-ecg-on 12` → detected on 12 with `moved: true`; `--sim-no-ecg` → `ecgChannel == −1`; a channel with blinks only (high kurtosis, not periodic) is not chosen.
- H6 alias check: 125 Hz sim with an injected 5.0 Hz line of 6 µV on all channels → `warn`; without it → no warn.
- H7 reconnect: `SimBoard` that stops delivering rows for 5 s → status goes `streaming → reconnecting → streaming`, a new `streamId` is announced.
- H8 end to end: start the helper in-process on an ephemeral port with `--simulate --run-seconds 4`, connect with a `websockets` client, receive `hello`, `config`, ≥ 50 data frames with continuous `sampleIndex`, and a `stats` message; `cmd:"ping"` → `pong`.
- H9 FTDI check: synthetic timestamps arriving in 16 ms bursts → `warn` with the fix text; 1 ms spacing → no warn.
- H10 impedance formula: 31.5 Hz sine of 100 µV RMS → `kohm` ≈ 23 570 (±1%).

## D4. `adapters/cyton.js` and `adapters/cyton-sim.js`

`MuseEngine.Adapters.Cyton.create({url:"ws://127.0.0.1:8766", onFrame, onStatus, onMessage})`:

- `decodeFrame(arrayBuffer)` → frame per C3 (pure function, exported; throws on bad magic/version/length). The accel block becomes `accel:{fs:25, t, xyz}` with `t = (sampleIndex + offset)/fs`. The ECG channel named in the latest `config` is copied into `frame.ecg`. Flag bit1 or a `sampleIndex` larger than expected becomes a `gaps` entry. Flag bit4 → `aux.flags.impedance = true`.
- Connection state machine: `idle → connecting → open → streaming`; on close or error retry every 2 s. `onStatus({state, text, fix})`. When the socket cannot open, the text is exactly: `Cyton helper is not running. Double-click "Open Cyton Helper.bat" in the project folder, or run: python tools/cyton_helper.py`.
- A new `config` with a different `streamId` resets the adapter and makes the next frame carry the new `streamId`/`fs`/`channels` (the engine is re-created by `engine-link.js` when `fs` or `channels` change).
- `send(cmd, extra)`.

`MuseEngine.Adapters.CytonSim.create({onFrame, fs:125, seed:1, script:"default"})` produces the same frames in the browser from `engine/fixtures.js` on a 40 ms timer. It is used for `?demo=1&device=cyton` so the UI can be tested without Python. (`?demo=1&device=cyton&helper=1` uses the real adapter against `cyton_helper.py --simulate`.)

Test (`adapters/cyton.test.js`): decodes `tools/testdata/frame_v1.hex` to the exact known values (the test embeds the expected numbers; if the hex file is missing the test regenerates the same frame with its own encoder and says so); rejects a truncated buffer; turns a `sampleIndex` jump into the right `gaps` entry; a fake WebSocket that closes triggers a retry and the "helper is not running" text.

## D5. `engine/fixtures.js` (synthetic data for tests, the in-browser simulator and the synthetic recording)

All generators take `{fs, seconds, seed}` and are deterministic.

- `eeg({device, channels, alphaUv, thetaUv, betaLoUv, ...})`: per channel pink noise (sum of 5 first-order low-passed white noises, scaled to 6 µV RMS in 1–45 Hz) plus sinusoid-with-random-phase-walk components sized so that, with the defaults, the D9 log band powers land on the D11 priors: frontal theta (4–8 Hz) ln-power ≈ prior `thetaF`, posterior alpha ≈ prior `alphaP`, central low beta ≈ prior `betaLoC`. Options scale each band by a factor (to simulate "focused" = theta ×1.6, alpha ×0.6).
- Injectors (each returns the list of injected events with exact onset/offset for scoring tests):
  - `blink(t, {ampUv=150, durMs=250})`: raised-cosine pulse; full amplitude on Fp1/Fp2 (Muse: AF7/AF8 at 60%), 40% on F3/F4/F7/F8, 5% elsewhere.
  - `voluntaryBlink(t)`: 280 µV, 420 ms. `doubleBlink(t, gapMs=350)`.
  - `emgBurst(t, {durMs, chans, ampUv=40})`: white noise band-limited to 20 Hz–min(110, fs/2−3) Hz; `clench(t, durMs=400)` = bilateral T7/T8 (Muse: TP9/TP10) at 60 µV RMS, 15 µV on frontal, 6 µV elsewhere; `chew(t, n=4, rateHz=1.2)`; `talk(t, seconds)` = irregular bursts (random gaps 0.15–0.9 s, random left/right ratio); `tension(t, seconds)`.
  - `motion(t, seconds)`: accel 0.15 g at 2 Hz (gyro 60 deg/s on the Muse) plus a common 3 Hz 80 µV wave on all channels.
  - `pop(t, ch, stepUv=200)`; `gap(t, seconds)` (samples removed, `gaps` entry created); `saccade(t)`: +60 µV step on Fp1, −60 µV on Fp2, decaying with 0.5 s time constant; `eyesClosed(t, seconds)`: blink-like closing pulse, posterior alpha ×3 for the duration, opening pulse.
- `ecg({fs, rrMs:[...]})`: for each beat a Gaussian R wave (σ 12 ms, 1000 µV), Q and S notches, a T wave (σ 60 ms, 250 µV, +250 ms), baseline wander 0.3 Hz 100 µV, noise 10 µV; R peaks placed at exact (non-integer) sample times. `rrSeries({n, meanMs, rmssdMs, seed})` builds an RR list whose RMSSD equals the target within 0.2 ms. Options: `dropBeat(k)`, `extraBeat(k)`, `invert`.
- `ppg({fs:64, rrMs})`: one smooth pulse per beat, band-limited like `PL.bp`.
- `accelStill({fs})`, `frames(streams, frameMs)` → an array of C3 frames ready for `eng.push`.
- `person(seed)`: a parameter set (IAF 8.5–11.5 Hz, aperiodic exponent 0.8–1.8, band amplitudes ±30%, ECG morphology variation: R/T ratio, QRS width, T delay; resting HR 55–85) so identity tests have separable synthetic people; `session(person, seedOfDay)` adds day-to-day jitter (band powers ±0.15 ln, electrode gain ±0.2 ln per channel).

## D6. `engine/preproc.js`, `engine/contact.js`, `engine/motion.js`

### Preprocessing (per channel, causal, state reset after every gap)

1. `dcBlock(0.5 Hz, fs)`. (On the Muse the panel has already applied its own 0.995 one-pole; applying this one too is fine.)
2. `notch(MAINS_HZ, fs, Q=30)`; `MAINS_HZ` = 60, option 50 (`opts.mains`). Skip if `MAINS_HZ > fs/2 − 2`.
   → this is **`xb`** (used by the event detectors and contact).
3. `lp(min(45, fs/2 − 5), fs)` applied twice (4th order) → **`xa`** (used by ASR, NLMS and time-domain helpers). Spectral features read 1–45 Hz bins from the Welch spectrum of `xc` (cleaned `xa`, or `xa` itself when cleaning is off).

State the aliasing risk in `tools/README.md` and the docs: at 125 Hz per channel the 120 Hz mains harmonic folds to 5 Hz, inside theta; the helper measures it (D3.4 item 5).

### Contact quality 0–100 per channel, once per second

- Muse: use `frame.contact` as is (the panel's RMS-based method).
- Cyton, from the last 1 s: `railedFrac` (raw |x| ≥ 178 125 µV); `rms` of `xa`; `lineRatio` = Goertzel power at mains on the DC-blocked, un-notched signal / 1–45 Hz power; last impedance result if one arrived in the last 30 min.
  - `sRail` = 0 if `railedFrac > 0.02` else 100.
  - `sRms`: 0 below 1 µV; linear 0→100 from 1 to 3 µV; 100 from 3 to 80 µV (dry-electrode good range); linear 100→0 from 80 to 200 µV; 0 above.
  - `sLine`: 100 if `lineRatio ≤ 2`; linear in `log10` from 100 at 2 to 30 at 20; 30 above.
  - `sImp`: 100 if unknown or ≤ 750 kΩ; linear 100→40 from 750 to 2500 kΩ; 20 above.
  - `q = min(sRail, sRms, sLine, sImp)`; smoothed `Q ← Q + 0.5·(q − Q)`.
- Exclusion with hysteresis: a channel is excluded when `Q < 40` and re-included after `Q ≥ 50` for 3 consecutive seconds. While excluded it emits a `bad_contact` event (per channel) and is listed in `quality.excluded`. Channels in `unusedChannels` and the ECG channel are never EEG channels.

### Motion gate (`engine/motion.js`)

Port of `panel/motion.js` as a pure class `MotionGate({kind})`:

- Feature window = last 1.25 s of samples. `acc` = RMS of consecutive differences of the accel magnitude (gravity cancels); `gyro` = RMS of the gyro magnitude (Muse only). Missing or stale motion data (no sample for 0.5 s, or fewer than `0.48·fs_acc` samples in the window) is **never** read as "no movement": state `no_data`, masked like movement.
- Hysteresis: enter MOVEMENT when `acc > entry` or `gyro > gEntry`; leave only after both are under the exit thresholds for 1.5 s continuously.
- Thresholds without any calibration action: start from `{acc:{entry:0.02, exit:0.01} g, gyro:{entry:10, exit:5} deg/s}` (on the Muse, use `MOT.th` if the user had run the old still-calibration: the adapter passes it in `opts.motionTh`). After 30 s of VALID features, self-tune from the running median/MAD of the VALID-state features over the last 5 min: `entry = max(0.5·default.entry, median + 5·max(MAD, floor))`, `exit = max(0.5·default.exit, median + 3·max(MAD, floor))`, floors `acc 0.0015 g`, `gyro 0.3 deg/s`; always keep `entry ≥ 1.5·exit`.
- Cyton: accel only (about 25 Hz).
- **No accelerometer** (`frame.accel` null for the first 10 s, or the helper said `accel:false`): EEG-derived proxy. Per good channel, low-pass `xb` at 4 Hz, take the RMS over each 250 ms; a channel "jumps" when that RMS ≥ 4 × its running median (60 s). MOVEMENT when ≥ 50% of the good EEG channels jump in the same 250 ms slot (Muse: ≥ 75%, because a blink alone moves 2 of 4 channels). VALID again after 1.5 s without such a slot. `quality.motion = "proxy"`.
- Output: `motion` events `{onset, offset}` and the current state.

Tests: `engine/preproc.test.js` (DC offset of 20 mV removed to < 1 µV after 5 s; 60 Hz 20 µV line reduced ≥ 30 dB at fs 125/250/256; 10 Hz amplitude changed < 5%; filter state resets after a gap). `engine/contact.test.js` (railed → 0; flat → 0; 10 µV clean → ≥ 90; 150 µV noisy → < 40 and excluded; hysteresis timing; Muse passthrough). `engine/motion.test.js` (the same scenarios as `panel/motion.test.js`: still → valid; 3 s movement → MOVEMENT within 0.5 s and VALID 1.5–2.0 s after it stops; stale data → `no_data`; proxy fires on a common 80 µV 3 Hz wave and not on a blink).

## D7. `engine/events.js` (one detector that both masks artifacts and feeds the buttons)

Runs every 50 ms of stream time on a 250 ms look-back (longer internal histories where stated). Event object: `{id, type, sub, onset, offset, conf, channels, amp, durMs, t /* stream time the event was finalised */}`. Types: `blink | blink_voluntary | double_blink | eyes_closed | saccade | emg_burst (sub: clench | chew | talk | tension | other) | clench_tap | motion | electrode_pop | gap | bad_contact`.

Channel groups:

| Group | Cyton | Muse |
|---|---|---|
| eye | Fp1, Fp2 | AF7, AF8 |
| frontal | Fp1, Fp2, F3, F4, F8 (and F7 when it is not the ECG channel) | AF7, AF8 |
| temporal | T7, T8 | TP9, TP10 |
| posterior | O1, O2, P3, P4 (alpha envelope) | TP9, TP10 |
| other | the rest | (none) |

Only non-excluded channels are used. If a group has no usable channel, its detectors are off and `quality.warnings` says which.

**Detector thresholds and their population floors** (all **[tunable]**; device priors live in `priors.json` → `det`):

| Constant | Cyton (dry combs) | Muse | Meaning |
|---|---|---|---|
| `blinkFloorUv` | 60 | 40 | smallest deflection accepted as a blink |
| `blinkDerivFloor` | 600 µV/s | 400 µV/s | smallest slope |
| `blinkAmpPrior` | median 120, MAD 30 µV | median 80, MAD 20 µV | spontaneous blink amplitude before 10 blinks are seen |
| `emgRatioIn / Out` | 3.0 / 2.0 | same | envelope ÷ baseline to start / end a burst |
| `emgBaseFloorUv` | 0.5 | 0.5 | smallest baseline envelope |
| `popSlope` | 12 500 µV/s | same | = 50 µV per 4 ms; per-sample threshold = `12 500 / fs` µV |
| `satUv` | 300 | 300 | absolute amplitude that marks a saturation/pop |

### Blink

- Signal `v` = mean over usable eye channels of `lp(10 Hz)` of `xb`. Reference level `m` = running median of `v` over the last 30 s, sampled every 50 ms, skipping samples inside events; `σv` = 1.4826·MAD of the same. Slope `d(t) = (v(t) − v(t − 20 ms)) / 0.02` in µV/s; `σd` likewise.
- Thresholds: `A = max(blinkFloorUv, 4·σv, 0.4·medAmp)` where `medAmp` is the running median amplitude of spontaneous blinks (prior until 10 have been seen, then the median of the last 200; persisted per profile and device). `Dthr = max(blinkDerivFloor, 4·σd)`.
- Candidate: `|d| ≥ Dthr`. Peak = the largest `|v − m|` within the next 400 ms; accept if peak ≥ `A`. Onset = last time before the peak with `|v − m| < 0.1·peak` (search back ≤ 300 ms). Offset = first time after the peak with `|v − m| < 0.1·peak` (search forward ≤ 1000 ms; if none, it is not a blink: hand it to `eyes_closed`). `durMs` = width at 50% of the peak; `reopenMs` = peak → offset. Accept only `80 ≤ durMs ≤ 800`.
- Polarity: accept either sign until 10 blinks are accepted; after that, if ≥ 80% share one sign, require that sign.
- Two eye channels usable: both must deflect with the same sign and an amplitude ratio between 1/3 and 3; opposite signs → `saccade`.
- `type = blink_voluntary` when `amp ≥ max(1.5·medAmp, medAmp + 3·madAmp)` or `durMs ≥ 350`; else `blink`. Only `blink` events update the spontaneous statistics (`medAmp`, `madAmp`, median `durMs`).
- The event is finalised at the offset (≤ 50 ms after the 10% return). `conf = clamp(amp/A − 1, 0.3, 1) × (two channels agree ? 1 : 0.7)`.

### eyes_closed

Alpha envelope `ea` = mean over posterior channels of: `bp` 8–13 Hz (two cascaded biquads, Q = 2), absolute value, 500 ms moving average. `ma` = running median of `ea` over the last 60 s outside eyes-closed periods.

- Onset: `ea ≥ 2.0·ma` continuously for ≥ 1.0 s **and** no blink finalised during that second **and** (Cyton only) a closing deflection on the eye channels (a blink, or a blink candidate that did not return within 1000 ms) within the 1.5 s before `ea` first crossed. Onset time = the closing deflection (or the first crossing on the Muse).
- Offset: a blink-like deflection on the eye channels, or `ea < 1.3·ma` for 500 ms.
- `conf` 0.8 on the Cyton, 0.5 on the Muse.
- Because this is detected up to ~1.5 s late, it is handled by (a) flagging feature windows as `eyesClosed` when they overlap it, and (b) the 5 s quarantine before any statistic is learned (D11), so eyes-closed data never enters the personal statistics. Scores already shown in that first second are smoothed by the 2 s EMA; this limit goes in the notes.

### saccade

`dd = lp10(eyeLeft) − lp10(eyeRight)`, `ss` = their sum. A saccade when `|dd(t) − dd(t − 100 ms)| ≥ max(40 µV, 5·σ_dd)` while `|ss(t) − ss(t − 100 ms)| < 0.5·|dd(t) − dd(t − 100 ms)|`. Fixed duration 200 ms. Needs both eye channels.

### emg_burst

- Per channel: `hp(25 Hz)` then `lp(f_hi)` with `f_hi = 55` if `fs < 250` else `min(100, fs/2 − 5)`, absolute value, 75 ms moving average → envelope `e`. Baseline `b` = running median of `e` over the last 60 s of non-burst samples (sampled every 50 ms; floor `emgBaseFloorUv`; before 10 s of data use the median so far). `r = e/b`.
- A channel is "in burst" from the moment `r ≥ emgRatioIn` has held for 100 ms (onset = the first crossing) until `r < emgRatioOut` has held for 50 ms. Overlapping channel bursts merge into one event (`channels` = union).
- Sub-label:
  - `tension`: duration > 1 s (labelled as soon as it passes 1 s; continues until the offset).
  - `clench`: both temporal channels in burst and duration 200–600 ms.
  - `chew`: ≥ 3 bursts whose successive onsets are 0.4–1.43 s apart (0.7–2.5 Hz) with a coefficient of variation of the intervals < 0.35, all within the last 4 s → those bursts are relabelled `chew`; "chewing" stays active until 1.5 s pass without a burst.
  - `talk`: ≥ 3 bursts within 3 s that fail the chew regularity test, or a burst with left/right asymmetry `|ln(r_left/r_right)| > 0.7` in the temporal pair, or frontal-dominant (`median r` of the frontal group > 1.5 × that of the temporal group); "talking" stays active until 1.5 s pass without a burst.
  - else `other`.
- Baseline anti-stall: if a channel stays in burst for more than 60 s, accept the level as the new baseline (reset its baseline buffer) and close the event.
- `conf = clamp((max r − emgRatioIn)/emgRatioIn + 0.5, 0.3, 1)`.

### electrode_pop

On `xb`, per channel: a sample-to-sample step larger than `popSlope / fs` µV, on **one** channel only (no other channel within ±50 ms), not during an `emg_burst` on that channel, and with at most 3 such steps within ±100 ms (strong EMG also has steep slopes; these conditions separate them). Also when `|xb| > satUv` on one channel. If the same happens on ≥ 50% of the channels at once it is not a pop: feed it to the motion proxy.

### gap, bad_contact, motion

`gap` events come from the `GapBook`; `bad_contact` from D6; `motion` from `MotionGate`. While `aux.flags.impedance` is set, emit one global `bad_contact` event (reason shown: "contact check running").

### Passive self-tuning

`medAmp`, `madAmp`, the median blink duration and blink polarity are learned only from spontaneous events (people blink about 15–20 times a minute), kept per profile and device in the profile store (`det` block), and never fall below the population floors. EMG baselines and `σv`/`σd` are per stream. No instructed action exists anywhere.

Tests (`engine/events.test.js`, fixtures at fs 125 and 256):

- E1 Clean synthetic EEG, 10 min, both devices: zero events of any type.
- E2 Each injector → exactly the right `type`/`sub`, onset within 100 ms of the truth: blink, voluntary blink, saccade, clench, chew (4 bursts), talk (6 s), tension (3 s), pop, gap, motion, eyes_closed (Cyton; onset within 300 ms because of its definition).
- E3 60 spontaneous blinks at random 2–5 s spacing with amplitudes 110–190 µV: ≥ 57 detected as `blink`, none as `blink_voluntary`.
- E4 Self-tuning: after 20 blinks of 90 µV median amplitude on the Cyton fixture, `medAmp` is within 15% of 90 and a 150 µV blink is classified `blink_voluntary`.
- E5 A clench during talking is still an `emg_burst`; chew bursts are not labelled `clench`.
- E6 A blink is not reported as a pop, and a 60 µV RMS EMG burst produces no `electrode_pop`.

## D8. `engine/mask.js`

`MaskTimeline` stores intervals `{t0, t1, reason, channels|null /* null = all */}` (pruned after 30 s).

| Event | Mask starts | Mask ends | Channels | Reason shown |
|---|---|---|---|---|
| blink, blink_voluntary | onset − 100 ms | offset + 400 ms | frontal group | `blink` |
| saccade | onset − 100 ms | offset + 300 ms | frontal group | `blink` |
| emg_burst `other` | onset − 100 ms | offset + 300 ms | the burst channels and their whole group; **all** channels if ≥ 4 channels (Muse ≥ 2) are in burst | `muscle` |
| emg_burst `clench`, `tension` | onset − 100 ms | offset + 300 ms | all | `muscle` |
| emg_burst `chew`, `talk` | onset − 100 ms | offset + 1000 ms | all | `muscle` |
| motion (incl. `no_data`) | onset − 200 ms | last over-threshold time + 500 ms, and in any case until the gate is VALID again (which needs 1.5 s still) | all | `movement` |
| gap | gap start | gap end + 2 s (one window length; filters resettle) | all | `signal lost` |
| electrode_pop | onset | onset + 1 s | that channel | `no contact` |
| bad_contact | while excluded | | that channel (or all for the impedance check) | `no contact` |

`eyes_closed` is not a sample mask; it is a flag on feature windows.

`windowInfo(t0, t1, channelSet, minChannels)` → `{usable, cleanFrac, channels: [usable channel names], segments: {ch: [[s0,s1],...]}, reason}`:

- Per channel, find the unmasked runs inside the window. From each run of at least 1 s take 1 s segments with 50% overlap starting at the run's start, plus one segment aligned to the run's end when ≥ 0.25 s is left over.
- A channel is usable for this window if it has ≥ 1 segment and ≥ 60% of its window samples are unmasked.
- Channel-level masking drops only the affected channels as long as at least `minChannels` usable channels remain in the set (`minChannels` = 2 on the Cyton, 1 on the Muse); otherwise the window is unusable for that set.
- `cleanFrac` = mean unmasked fraction over the usable channels. It is the window's weight downstream.
- `reason` when unusable = the reason covering the most samples, ties broken in the order `signal lost > no contact > movement > muscle > blink`.

Tests (`engine/mask.test.js`): the table's margins are exact to one sample; a blink in the middle of a 2 s window leaves the posterior set usable and makes the frontal set unusable; a 0.5 s mask at the window edge leaves one 1 s segment and `cleanFrac` 0.75; < 60% clean → unusable; reason priority.

## D9. `engine/features.js`

Per hop, for the window `[t − D − 2, t − D]`, per usable channel: average the `psd` of its segments (Welch), then band powers (µV²) and their `ln`:

| Band | Range |
|---|---|
| theta | 4–8 Hz |
| alpha | 8–12 Hz, or `[IAF − 2, IAF + 2]` once an individual alpha frequency is adopted |
| betaLo | 13–20 Hz |
| broad | 1–45 Hz |
| shape6 | 1–4, 4–8, 8–13, 13–20, 20–30, 30–45 Hz (for spectral-shape distance only, never for focus) |

Channel-set features (mean of the per-channel log powers over the usable channels of the set):

| Feature | Cyton channels | Muse channels |
|---|---|---|
| `thetaF` | F3, F4 (plus F8 when usable) | AF7, AF8 |
| `alphaP` | P3, P4, P7, P8, O1, O2 | TP9, TP10 |
| `betaLoC` | C3, C4, P3, P4 | TP9, TP10 |
| `ratioD` (drowsiness) | `ln((θ + α)/βLo)` with powers averaged over C3, C4, P3, P4 | not used |

Each feature carries `{x, valid, cleanFrac, nCh, nChSet, eyesClosed}`. `thetaF` gets `confMul = 0.7` when the helper's alias check warned.

**IAF:** accumulate the clean, eyes-open, time-weighted mean log-PSD of the posterior set (1 Hz grid, 2–40 Hz). Fit a line to `ln P` vs `ln f` over 3–40 Hz excluding 7–14 Hz (`aperiodic exponent` = −slope, `offset` = intercept). IAF = the frequency of the largest residual in 7–13 Hz with parabolic interpolation; valid when the peak residual ≥ 0.2 and ≥ 5 min of clean data went in. The IAF is stored in the profile and **adopted only at the start of a later session** (never mid-session, so the statistics of `alphaP` are not disturbed while running); the feature key becomes `alphaP@iaf` with its own statistics, seeded from the `alphaP` statistics.

Tests (`engine/features.test.js`): band powers of known sines within 5% at fs 125/250/256; a window with one masked channel still yields the set feature from the others; an IAF of 9.4 Hz in the fixture is recovered within 0.3 Hz; an aperiodic exponent of 1.3 within 0.15; masked segments never contribute (inject a 500 µV burst into a masked stretch: feature changes < 0.02 ln).

## D10. `engine/ecg.js` and `engine/ppg.js`

### ECG (Cyton; input: the ECG channel at `fs` = 125 or 250 Hz; everything is scale-invariant)

1. **Filter:** `hp(5 Hz)` then `lp(15 Hz)` (Butterworth biquads, causal) → `y`. A second path `hp(0.5)`+`lp(40)` → `w` (for quality and the identity template).
2. **Polarity auto-flip:** every 10 s compute the skewness of `y` over the last 10 s. Start with sign +1. Flip when the skewness is below −0.5 on two consecutive checks (and back the same way). Work on `sign·y`.
3. **Elgendi two-moving-average detector:** `s = y²`; `MAqrs` = centred moving average of `s` over `W1 = round(0.097·fs)` samples; `MAbeat` = centred moving average over `W2 = round(0.611·fs)` samples; threshold `THR = MAbeat + 0.08·mean(s over the last 8 s)`. Blocks where `MAqrs > THR` that are at least `W1` samples wide are QRS complexes; the R peak is the maximum of `sign·y` inside the block. Minimum distance between peaks 300 ms (keep the larger). The detector runs incrementally every hop and finalises a peak once its block has ended (latency ≈ 0.4 s).
4. **Sub-sample refinement (mandatory at 125 Hz):** with `y0, y1, y2` the samples around the peak, `offset = 0.5·(y0 − y2)/(y0 − 2·y1 + y2)` samples; peak time = `(i + offset)/fs`.
5. **Fallback detector:** if step 8 marks every window invalid for 10 s while the channel still looks like ECG (kurtosis of `w` > 5), run a rescaled Pan–Tompkins in parallel for the next 30 s (derivative, square, 150 ms moving integration, adaptive threshold from running signal/noise peak estimates, 200 ms refractory, 360 ms T-wave slope check) and keep whichever detector gives the higher share of valid windows.
6. **RR cleaning:** `RR_k` in ms between consecutive peaks. Reject outside 300–2000 ms. With `med5` = median of the last 5 accepted RR: reject if `|RR − med5| > 0.25·med5`. Classify: `1.75·med5 ≤ RR ≤ 2.25·med5` = missed beat (for heart rate count it as two beats of `RR/2`; for RMSSD drop it); `RR < 0.6·med5` and `RR + nextRR` within 25% of `med5` = extra beat (merge the two for heart rate; drop both for RMSSD).
7. **Lipponen–Tarvainen-style correction over the RMSSD window:** `dRR_k = RR_k − RR_{k−1}`; `Th1 = 5.2 ×` the quartile deviation of `|dRR|` over the last up-to-91 beats (needs ≥ 20); `mRR_k = RR_k −` median of the surrounding 11 RR; `Th2 = 5.2 ×` quartile deviation of `|mRR|`. A beat is ectopic when `|dRR_k| > Th1` and `dRR_{k+1}` has the opposite sign with `|dRR_{k+1}| > Th1`; long/short when `|mRR_k| > Th2`. Flagged beats are excluded; RMSSD uses only successive differences between two adjacent accepted intervals.
8. **Window quality (10 s windows, step 5 s):** `kSQI` = Pearson kurtosis of `w` ≥ 5 **and** mean Pearson correlation between each beat (−250 ms … +400 ms around R, from `w`) and the window's mean beat ≥ 0.8; otherwise the window is invalid. `sqi` = that mean correlation (0 when invalid).
9. **Outputs:** `hr8` = `60000 / mean(RR accepted in the last 8 s)`, needs ≥ 4 intervals and a valid window; `lnRmssd` = `ln(RMSSD)` over the last 60 s (use 30–60 s as data accumulates; needs ≥ 30 s of valid windows and ≥ 20 accepted successive differences; **if more than 20% of the beats in the window were rejected there is no HRV value**), recomputed every 5 s; `template` = running mean of beats resampled to 100 points (identity, D14); `state` = `ok | weak | none`.

### PPG (Muse)

`MuseEngine.Ppg` takes the `Stress` API by reference (`root.Stress` in the page, `require("../stress.js")` in Node) and uses `Stress.findBeats` and `Stress.ibisFromBeats` on the band-passed pulse samples from the frame, with beat times in stream time (sample positions, not arrival times). `hr8` from the last 8 s (≥ 4 intervals), falling back to `aux.ppgHr` (the panel's autocorrelation rate) when beats are too few; `lnRmssd` over 30–60 s with ≥ 15 intervals, step 5 s. The PPG RMSSD is biased about 1.9× high against ECG, so it is used **only as a relative change** (it is z-scored against the person's own Muse history, with its own prior, D11).

Tests (`engine/ecg.test.js`, `engine/ppg.test.js`):

- C1 Synthetic ECG with known RR (mean 850 ms; RMSSD 40 ms and 20 ms) at fs 125, 250, 500: every beat found (no misses, no extras over 120 s); RMSSD error < 3 ms at 125 Hz with refinement, and the error with refinement ≤ the error without it.
- C2 Inverted ECG → same result (auto-flip).
- C3 One dropped and one extra beat per 60 s → both classified; RMSSD error still < 3 ms; heart-rate error < 1 bpm.
- C4 Amplitude ×0.5 and ×2 → identical beat times within 0.5 ms (scale invariance).
- C5 White noise or EEG instead of ECG → all windows invalid, `hr8`/`lnRmssd` null, `state: "none"`.
- C6 A window with 25% of beats corrupted → no HRV value for it.
- P1 Synthetic PPG at 64 Hz with known RR → heart rate within 1 bpm; NaN gaps do not create beats; RMSSD within 6 ms.

## D11. `engine/norm.js`: self-calibrating normalization (the "no calibration, keeps learning" core)

Julian's rule is "update the running statistics with every clean window, weighted by elapsed time: `new_mean = (T·mean + dt·x)/(T + dt)`, across sessions". Implement exactly that, with variance, robustness and safeguards against its known failure (a cumulative mean absorbs sustained states: after `H` minutes of history a state held `T` minutes keeps only `H/(H+T)` of its displayed shift).

Statistics are kept per **(profile, device, montage key, feature)**. Montage key = device + the sorted EEG channel names + the ECG flag, e.g. `cyton|C3,C4,...|ecg`. Features: log band powers (`thetaF`, `alphaP` or `alphaP@iaf`, `betaLoC`, `ratioD`), `hr` (bpm), `lnRmssd`, the composites `focusRaw`, `stressRaw`, and the drowsiness markers `blinkDur` (ms), `blinkRate` (/min), `perclos` (fraction), `spindleRate` (/min).

### Weight and clock

Each hop delivers at most one update per feature with weight `w = hop · cleanFrac · epochFactor` seconds, where `hop` is the length of **new** clean time (0.25 s; for 5 s-step features 5 s), never the window length (overlapping windows must not be counted several times). Unusable windows and gaps deliver nothing and age nothing.

### Quarantine

Updates are queued for **5 s** of stream time before they are applied. If an event detected later (eyes closed, a chew/talk relabel, a new contact epoch) covers a queued update, it is dropped. Scoring is not delayed by this.

### Session tier and lifetime tier (weighted Welford/West)

Each feature has a session accumulator `(Ws, ms, Ss)` updated as: `W' = W + w; δ = x − m; m' = m + (w/W')·δ; S' = S + w·δ·(x − m')`. (The mean update is Julian's formula.)

The lifetime state `(WL, mL, SL)` of a profile is **frozen while a session runs** and is the fold, in chronological order, of the stored session summaries: for each summary first apply the per-session forgetting factor (`WL ← 0.98·WL`, `SL ← 0.98·SL`), then merge: `W = W1 + W2; m = (W1·m1 + W2·m2)/W; S = S1 + S2 + (W1·W2/W)·(m1 − m2)²`, then cap: if `W > T_cap = 36 000 s` (10 h of clean data) scale `W` to `T_cap` and `S` by the same factor. Beyond the cap the estimate behaves like an exponential average with a 10 h time constant, so slow drift over weeks is tracked.

The **scoring statistics** during a session are `combined = merge(forget(lifetime), session)` (same formulas, computed on the fly). Exception: drowsiness features use the lifetime tier only (frozen within the session, D12).

Storing summaries instead of a running total is what makes relabel, merge and "forget me" exact (D14).

### Population prior (normal-inverse-gamma)

Autocorrelation-honest sample size: `n = W/τc` with `τc = 10 s`. Prior pseudo-time `T0 = 120 s` → `κ0 = T0/τc = 12`, `α0 = κ0/2 = 6`, `β0 = α0·σ0²`, prior mean `μ0`, prior SD `σ0` from `engine/priors.json`. Posterior with the combined `(W, m, S)`:

```
n  = W/τc
κn = κ0 + n
μn = (κ0·μ0 + n·m)/κn
αn = α0 + n/2
βn = β0 + (S/τc)/2 + κ0·n·(m − μ0)² / (2·κn)
predictive: Student-t, ν = 2·αn, location μn, scale² = βn·(κn + 1)/(αn·κn)
```

Personal data has 50% of the weight after 2 clean minutes and 90% after 18. Because ν ≥ 12 always, use the t value as z directly: `z = (x − μn − eOff)/scale`.

Initial `engine/priors.json` (log powers are `ln µV²` of band power; these are stated starting values, not literature values, and `tools/autotune.py` rebuilds them from Julian's validation recording because literature units do not transfer between amplifiers):

```json
{
  "version": 1, "tauC": 10, "T0": 120,
  "cyton": {
    "features": {
      "thetaF": {"mu": 2.3, "sd": 0.7}, "alphaP": {"mu": 2.5, "sd": 0.7}, "betaLoC": {"mu": 1.2, "sd": 0.7},
      "ratioD": {"mu": 1.9, "sd": 0.5},
      "hr": {"mu": 70, "sd": 10}, "lnRmssd": {"mu": 3.4, "sd": 0.5},
      "blinkDur": {"mu": 180, "sd": 50}, "blinkRate": {"mu": 17, "sd": 8}, "perclos": {"mu": 0.02, "sd": 0.03}, "spindleRate": {"mu": 2, "sd": 2},
      "focusRaw": {"mu": 0, "sd": 1.5}, "stressRaw": {"mu": 0, "sd": 0.62}
    },
    "det": {"blinkFloorUv": 60, "blinkDerivFloor": 600, "blinkAmpMed": 120, "blinkAmpMad": 30, "emgBaseFloorUv": 0.5}
  },
  "muse": {
    "features": {
      "thetaF": {"mu": 2.8, "sd": 0.7}, "alphaP": {"mu": 2.3, "sd": 0.7}, "betaLoC": {"mu": 1.5, "sd": 0.7},
      "hr": {"mu": 70, "sd": 10}, "lnRmssd": {"mu": 4.04, "sd": 0.6},
      "focusRaw": {"mu": 0, "sd": 1.5}, "stressRaw": {"mu": 0, "sd": 0.70}
    },
    "det": {"blinkFloorUv": 40, "blinkDerivFloor": 400, "blinkAmpMed": 80, "blinkAmpMad": 20, "emgBaseFloorUv": 0.5}
  }
}
```

(Resting HR 70 ± 10 bpm and ln RMSSD 3.4 ± 0.5 are population priors; the Muse `lnRmssd` prior is shifted by `ln 1.9` for the PPG bias. With these, "high arousal" of about +12 bpm and RMSSD ×0.6 reads near the top of the scale for a new person and is then replaced by personal statistics.) `tools/build_priors.js` writes `engine/priors.js` (`MuseEngine.PRIORS = {...}`); a test checks the two files match.

### Robust update

- Each feature keeps a decaying histogram: 200 bins spanning `μ0 ± 10·σ0`, out-of-range values clamped to the edge bins, weights in seconds, mergeable, decays by scaling (the same 0.98 per session), serialised sparsely (about 2 KB). Robust sigma `σr = 1.4826 · MAD` from the histogram.
- Before an update, winsorize `x` to `c ± 3·σr`, `c = μn + eOff`. While the personal clean time is under 60 s use the prior `σ0` instead of `σr`; never let `σr` fall below `0.25·σ0`.
- **Anti-stall:** if a feature has been clipped on the same side for more than 60 s of consecutive clean time, stop treating it as noise: raise the "stall" flag for the change detector, which opens a new epoch (below).

### Contact epochs (re-seating the headset shifts EEG power; cardiac features are exempt)

A new epoch starts on connect, on a gap longer than 5 s, on a stall, or when **at least 2** of these fire within 30 s (evaluated once per second on clean seconds only):

1. Broadband step: the median over the last 5 s of per-channel `ln` RMS (1–45 Hz) differs from the epoch's median by more than 3 robust MADs (MAD floor 0.05) on ≥ 50% of the channels.
2. Line-noise jump: the mains ratio (dB) differs from the epoch median by more than 6 dB for 5 s on ≥ 25% of the channels.
3. Spectral shape: Euclidean distance between the current mean `shape6` vector (log powers minus their mean, averaged over channels) and the epoch's mean shape exceeds the epoch's 99th percentile (needs ≥ 120 values) for 5 consecutive seconds.
4. Cyton only: the affine-invariant Riemannian distance `δ = sqrt(Σ ln² λ_i)` (λ = generalised eigenvalues, via Cholesky whitening + Jacobi) between the 5 s covariance of `xa` over the good channels (regularised with `1e-3·trace/n` on the diagonal) and the epoch reference covariance exceeds the epoch's 99th percentile for 5 consecutive seconds.
5. CUSUM on 20 s block means of per-channel `ln` RMS, standardised by the feature's robust sigma, two-sided, `k = 0.5`, `h = 5`, firing on more than half of the channels.

On a new epoch, for **EEG power features only** (`thetaF`, `alphaP`, `betaLoC`, `ratioD`):

- keep σ (the lifetime spread);
- re-anchor the location: `eOff = λ·(m_epoch − μn)` with `λ = Te/(Te + 30 s)`, `Te` = clean seconds collected in this epoch, updated until `Te = 120 s` (λ = 0.8) and then frozen for the epoch. While `Te < 120 s` the metric state is `learning`.
- hold this epoch's updates out of the session accumulator until the epoch has 5 clean minutes, then add them (with their weights);
- `epochFactor = 0.25` for the first 10 clean minutes of every epoch (dry-contact settling), then 1.

`hr`, `lnRmssd` and the composites never re-anchor (`eOff = 0`): the heart does not change when a headset is re-seated.

Known limit to write in the notes: a state that is already present when an epoch starts is mostly absorbed into the re-anchor (someone who starts a session highly focused reads near 50).

### Within-session offset (composites only)

`focusRaw` and `stressRaw` each track a location offset `off ← off + (w/τ)·(resid − off)` with `resid` = the composite's current z, `τ = 90 min` (focus) or `45 min` (stress) of clean time, clamped to ±0.5 (z units), reset to 0 at session start. The final z is `z − off`. This follows day-to-day state without absorbing a focused or stressed stretch of normal length. Drowsiness has no offset.

### Fast tier

An exponential mean/variance with `τ = 5 min` per feature. Used only by change detection and the report; never for scoring.

### Score and badge

`score = 100 / (1 + exp(−1.7·z))` → 50 = usual for you, about 88 = +2σ, about 12 = −2σ. No min-max anywhere. `percentile(x)` from the histogram is available for the UI tooltip once the feature has ≥ 200·τc seconds.

Confidence badge from the personal clean time `P` (seconds, lifetime + session) on this device and montage for the metric's main feature:

| Personal clean data | Badge text | `badgeConf` |
|---|---|---|
| under 3 min | `Population norms` | 0.4 |
| 3–15 min | `Learning you (N min)` | 0.4 → 0.7 linearly |
| 15–60 min | `Personal, medium` | 0.85 |
| over 60 min, or 3 or more sessions | `Personal, high` | 1.0 |

### API

```js
const N = MuseEngine.Norm;
const f = N.feature(prior /* {mu, sd} */, opts);       // state for one feature
f.loadLifetime(summaries);  f.update(x, w, tClean);  f.z(x);  f.score(x);  f.summary();  f.serialize();  N.deserialize(obj)
N.merge(a, b), N.forget(a, 0.98), N.cap(a, 36000), N.Hist(...), N.Cusum({k:0.5, h:5}), N.EpochDetector(...)
```

### Required tests (`engine/norm.test.js`, the 14-test suite; synthetic feature streams are AR(1) with a 10 s correlation time, unit variance, sampled every 0.25 s, seeded)

- N1 Batch equality: streaming `(W, m, variance)` equals the batch weighted mean/variance to 1e-9.
- N2 Gap invariance: inserting arbitrary gaps (no updates) between the same updates gives a bit-identical state.
- N3 Overlap invariance: feeding 2 s windows with a 0.25 s hop (`w = 0.25`) versus non-overlapping windows (`w = 2`) over the same 30 min signal gives means and SDs that differ by less than 2% of σ.
- N4 Step absorption: lifetime tier alone, 3600 s of history then a 1σ step held 3600 s → the mean has moved 45–55% of the step.
- N5 Slow drift: 40 one-hour sessions with a drift of 0.025σ per clean hour, full scorer → from session 20 on, the location error at the end of each session is < 0.3σ.
- N6 Artifact injection: 1% of windows replaced by +20σ outliers → mean shift < 0.05σ with winsorizing, and > 0.15σ with winsorizing switched off (shows the guard works).
- N7 Stall rule: a +4σ step that persists → the stall flag is raised between 60 and 70 s, a new epoch opens, and within 3 min of the step the scoring location has adopted > 50% of it.
- N8 Prior blending: personal share `n/(κ0 + n)` is 45–55% at `W = T0` and > 85% at `W = 9·T0`; `μn` lies between prior and data accordingly.
- N9 Change-point false alarms: CUSUM over 10 h of stationary data, 20 seeds → mean < 1 alarm per 10 h.
- N10 Change-point delay: a 1.5σ step → detected within 180 s in ≥ 95% of 40 seeds.
- N11 Cross-session stability: folding 10 session summaries in two different orders changes the score of a fixed probe value by < 3 points.
- N12 Serialization round trip: `deserialize(serialize(state))` scores identically (1e-12) and JSON size per feature < 4 KB.
- N13 Monotonic and finite: the score is strictly increasing in `x` over ±8σ, no NaN/Infinity for any input including `W = 0`.
- N14 Histogram quantiles: the 10/50/90% quantiles of 50 000 weighted samples are within one bin width of the exact values; two merged histograms equal one built from all the data.

## D12. `engine/metrics.js`: FOCUS, STRESS, DROWSINESS

### FOCUS (both devices; a within-person relative index)

- `focusRaw = wθ·z(thetaF) − wα·z(alphaP) + wβ·z(betaLoC)`, defaults `wθ = 1, wα = 1, wβ = 0.5` **[tunable, each bounded to 0–2]**. Reason: frontal theta rises with mental load, posterior alpha falls, low beta (13–20 Hz, central/parietal) is the least muscle-contaminated beta. Never use beta above 20 Hz, gamma or theta/beta.
- A window counts for focus only if `thetaF` and `alphaP` are both valid; `betaLoC` is optional (when it is missing, drop its term). Windows flagged `eyesClosed` are excluded (alpha means something else with eyes closed). An `emg_burst` always masks `betaLoC`; it masks `thetaF` when the burst includes frontal channels (in practice most bursts mask everything, D8).
- `focusRaw` is itself a normalized feature (`focusRaw` prior, with the 90 min offset) → `z` → smoothed on usable windows only with `zs ← zs + (1 − exp(−0.25·cleanFrac/2 s))·(z − zs)` (EMA, τ ≈ 2 s) → `score`.
- `conf = clamp01(cleanFrac × channelShare × badgeConf × aliasFactor × ceiling)`, `channelShare` = mean over the three features of `nCh/nChSet`, `ceiling = 1.0` on the Cyton and **0.7 on the Muse**.

### STRESS (labelled `STRESS`, note "measures arousal")

Components, each a personal z:

| Component | Cyton weight | Muse weight | Definition |
|---|---|---|---|
| `hr` | 0.45 | 0.65 | `z(hr8)` (ECG on the Cyton, pulse on the Muse); fast, 8 s |
| `hrv` | 0.40 | 0.20 | `−z(lnRmssd)`; 30–60 s sliding, step 5 s |
| `eeg` | 0.15 | 0.15 | `−z(alphaP)` on clean, eyes-open windows only |

- `stressRaw = Σ wᵢ·cᵢ / Σ wᵢ` over the **valid** components. A missing component is dropped and the weights renormalised; it is never treated as 0 (the `arousal.js` rule). `components` reports each part's `z` and `valid`.
- At least one cardiac component must be valid. With none: `state: "unavailable"`, `reason: "no ECG"` (Cyton) or `"no pulse"` (Muse). Reason: alpha alone is too weak and too muscle-prone to be shown as stress.
- The β/α term of the old model is not used in New (it is mostly EMG). It stays in Legacy.
- **Exertion guard:** if motion events cover more than 30% of the last 20 s, or `hr8` rose by more than 15 bpm within 20 s while `lnRmssd` did not fall (change ≥ −0.05), the heart rate is exertion: `exertion: true`, the metric is held (`state: "held"`, `reason: "movement"`), nothing is learned.
- `stressRaw` → normalized (`stressRaw` prior, 45 min offset) → EMA τ = 4 s → `score`. `conf = clamp01(Σ valid wᵢ × sqiFactor × badgeConf × ceiling)`, `sqiFactor` = ECG `sqi` (or `PL`-style pulse quality /100 on the Muse), `ceiling` 1.0 Cyton, 0.8 Muse.

### DROWSINESS (Cyton only; a slow trend meter with minutes of lag; `null` on the Muse)

Markers, each a personal z from the **lifetime tier only**:

- `ratio` = `ratioD = ln((θ + α)/βLo)` over C3, C4, P3, P4, averaged over the usable hops of the last 20 s (needs ≥ 8 s usable), updated every 2 s; not updated during `eyes_closed`.
- `blinkDur` = median duration of spontaneous `blink` events in the last 60 s (needs ≥ 5); `blinkRate` = their count per minute (the z of the rate counts in the direction "fewer or many more than usual" as `|z|`·0.5; the duration counts fully).
- `perclos` = (time in `eyes_closed` + blinks longer than 500 ms) / 60 s.
- `spindles` = number per minute of alpha bursts lasting 0.5–2 s in the posterior alpha envelope `ea` above `median + 3·σr` of `ea` (5 min, eyes open), counted only with eyes open.
- `zD` = mean of the available marker z's. **It may exceed +1 only if at least 2 markers are each above +0.5**; otherwise it is capped at +1. Eyes-closed alpha alone can therefore never raise it (the spectral markers are not updated with eyes closed).
- EMA with τ = 60 s, then `score`.
- **Baseline frozen within the session:** no session-tier data and no offset are used for scoring; the session's marker data is merged at session end. So a slow rise during a session is not absorbed. Until the profile's lifetime tier holds 10 clean minutes for these markers: `state: "learning"`, `value: null`, reason `learning` (a first-time wearer never gets a drowsiness number in the first session; say so in the UI note: "needs 10 min of history").

Tests (`engine/metrics.test.js`):

- M1 Focus rises: fixture "focused" (theta ×1.6, alpha ×0.6) after 5 min of neutral history → focus > 65; "relaxed" (theta ×0.7, alpha ×1.6) → focus < 35; neutral → 40–60.
- M2 EMG immunity: 120 s with a 0.5 s clench-like burst (broadband 13–110 Hz, so unmasked it would raise `betaLoC`) every 10 s, versus the same seed without bursts: `|mean(focus_with) − mean(focus_without)| ≤ 2 points`, and the with-burst trace never leaves `[min − 2, max + 2]` of the clean trace. Control: with masking disabled the mean shifts by > 5 points.
- M3 Blink immunity: same test with a blink every 3 s → mean shift ≤ 2 points.
- M4 Eyes closed 20 s → focus held/stale during it (never a rise from the alpha change), and `alphaP` statistics unchanged by it (quarantine).
- M5 Stress: HR +12 bpm and RMSSD ×0.6 after 5 min of rest history → stress > 75; rest → 40–60; `components` valid flags correct.
- M6 Missing components: no HRV yet → weights renormalised, a number is still produced; no ECG at all → `unavailable`, `value null`, reason `no ECG`.
- M7 Exertion: HR +25 bpm in 15 s with motion covering 50% → `held`, reason `movement`, statistics unchanged.
- M8 Drowsiness: with 15 min lifetime history, a fixture with `ratioD` +1.5σ and blink duration +1.5σ over 10 min → score rises above 70; `ratioD` alone at +3σ → capped at the score for z = +1 (≈ 84.6); 60 s eyes closed with high alpha → no rise; a new profile → `learning`, `value null`; the Muse → `drowsiness === null`.

## D13. `engine/buttons.js` and `engine/holdfade.js`

### BUTTONS (Cyton only; events, not scores; emitted through `eng.onEvent` immediately and also listed in `output.events`)

**`double_blink`:** two `blink_voluntary` events whose peaks are 150–600 ms apart, with no third blink peak within **400 ms** after the second peak. (Julian's document said 600 ms; 400 ms is used so the event can be emitted within the 400 ms latency target: emit at `max(second blink offset, second peak + 400 ms)`. Logged change.) Suppressed while the motion gate is not VALID and within 300 ms of a `saccade`. Refractory 800 ms. `conf` = the smaller of the two blink confidences.

**`clench_tap`:** an `emg_burst` with sub-label `clench` (T7 **and** T8 at ≥ 3× baseline, one burst of 200–600 ms), with no other burst in the preceding 1.5 s and neither "chewing" nor "talking" active. (Julian's document asked for ±1.5 s; a look-ahead of 1.5 s would break the latency target, so only the look-back is enforced and a following burst simply switches chewing/talking on, which suppresses the next taps. Logged change.) While "talking" was active in the last 3 s the ratio threshold is ×1.5 (4.5). Refractory 500 ms. Emitted at the burst offset.

Latency target: < 400 ms from the end of the gesture (test it). Every button event carries `conf` and a unique increasing `id`. The same events mask the scores (D8). On the Muse the detector still runs for masking, but no `double_blink`/`clench_tap` events are emitted.

Auto-tune targets for these (D19): true-positive rate ≥ 90%; false positives ≤ 1 per 5 min of gameplay + talking.

Tests (`engine/buttons.test.js`): B1 20 double blinks → ≥ 18 detected, latency < 400 ms each. B2 20 clench taps → ≥ 18 detected, latency < 400 ms. B3 5 min of fixture "talking + typing + spontaneous blinks (17/min) + 4 chew episodes" → ≤ 1 false button event. B4 triple blink → no `double_blink`. B5 double blink during motion → suppressed. B6 refractory periods hold. B7 the Muse engine emits no button events.

### Hold + fade (`engine/holdfade.js`), one instance per metric

Input each hop: `{usable, value, conf, reason, learning, available}`. Time advances by hop length (or by `idle(dt)` when no data arrives; then the reason is `signal lost`).

```
available == false                          -> state "unavailable", value null, conf 0
usable                                      -> state "live" (or "learning" if learning), value = new value, conf = conf; heldFor = 0
not usable, heldFor < 3.0 s                 -> state "held", value = last clean value, conf = lastConf · (1 − heldFor/3.0), reason kept
not usable, heldFor ≥ 3.0 s                 -> state "stale", value null, conf 0, reason kept   (UI shows "--" and the reason)
no clean value yet and not usable           -> state "stale", value null
```

`HOLD_MAX_S = 3.0` (Julian's decided maximum). Returning to `live` is immediate on the first usable window. If the stale period lasted more than 30 s the metric's EMA restarts from the new value instead of the old one. Reasons shown: `movement`, `muscle`, `blink`, `no contact`, `no ECG`, `no pulse`, `signal lost`, `eyes closed`.

Test (`engine/holdfade.test.js`): exact state and `conf` at 0, 0.25, 1.5, 2.75, 3.0, 3.25 s of masking (conf at 1.5 s = half the last conf, within 1e-9); value is `null` at and after 3.0 s; immediate recovery; `idle()` path gives `signal lost`; `unavailable` wins over everything.

## D14. `engine/identity.js` and `engine/profiles.js`: person auto-detection

Expected accuracy (say this in the docs): Muse EEG only about 60–80% closed-set; Cyton EEG + ECG about 90–97%. So: a soft posterior, a one-tap correction, never update a profile before identity is confident, population priors while uncertain.

### Profile store (`profiles.js`)

`localStorage` key **`museengine.profiles.v1`**, every access in try/catch (a private window or full storage must not break the panel; then the engine runs with in-memory profiles and the badge says "not saved").

```js
{ schemaVersion: 1, ownerId: "p_owner", guestCounter: 3,
  profiles: { "p_owner": { id, label: "Julian", owner: true, created, devices: { "cyton": { montage, base: {feature summaries folded from pruned sessions}, det: {blinkAmpMed, blinkAmpMad, blinkDurMed, blinkSign, n}, iaf, asr: {M, T}|null } } } },
  sessions: [ { id, profileId, device, montage, start, end, cleanSec, idState: "confirmed"|"tentative"|"guest"|"corrected", merged: true|false,
                features: { thetaF: {W, m, S, hist}, ... }, identity: { eeg: [...], iaf, apExp, apOff, ecg: [...100]|null, hr, contact: [...], grav: [x,y,z]|null } } ] }
```

- Only per-session **summaries** are stored, never raw data. A profile's lifetime statistics and identity template are always rebuilt by folding its sessions in time order on top of `base` (D11). Keep at most 60 sessions per profile and device; older ones are folded into `base` (after which they can no longer be relabelled).
- The owner profile is created on the first ever run, labelled "Julian" (editable). The first session ever is assigned to the owner (`idState: "confirmed"`, badge "Julian (first session)").
- API: `load()`, `save()`, `listProfiles()`, `rename(id, label)`, `merge(fromId, intoId)`, `remove(id)` ("forget me": deletes the profile and all its sessions), `relabelSession(sessionId, profileId|"new")`, `commitSession(summary)` (idempotent by session id; the running session is auto-saved every 60 s and at disconnect / `beforeunload`), `exportJSON()`, `importJSON(text)` (validates `schemaVersion`, merges by id).
- At most 20 guest profiles; when exceeded, remove the oldest guest with under 5 min of data.
- **Privacy:** templates and summaries stay in this browser's local storage. They are never put in the game link, never sent anywhere. Only the profile `label` and a confidence number go to the game link. Say this in the README.

### Identity features (per device; templates are never compared across devices)

Collected from clean, motion-free, eyes-open windows after contact is good:

| Block | Content | Dims | Within-person SD prior | Population SD | Effective dims `Deff` |
|---|---|---|---|---|---|
| `eeg` | mean log-PSD on a 1 Hz grid 2–40 Hz, mean removed per group; groups Cyton: posterior (P7, P8, O1, O2), central-parietal (C3, C4, P3, P4), frontal (Fp1, Fp2, F3, F4, F8); Muse: temporal (TP9, TP10), frontal (AF7, AF8) | 117 / 78 | 0.20 | 0.50 | 8 (the posterior/temporal group gets 2× the weight of the others) |
| `iaf` | individual alpha frequency (D9), when valid | 1 | 0.4 Hz | 1.0 Hz | 1 |
| `ap` | aperiodic exponent and offset | 2 | 0.15, 0.3 | 0.4, 0.8 | 1 |
| `ecg` (Cyton) | mean beat resampled to 100 points spanning `−0.25·RRmed … +0.45·RRmed` around R, z-scored (rate- and scale-normalised), ≥ 30 beats | 100 | 0.15 | 0.70 | 10 (dominates) |
| `hr` | resting HR | 1 | 8 bpm | 12 bpm | 0.5 |
| `contact` | per-channel contact pattern | nCh | 15 | 25 | 0.5 |
| `grav` | resting accelerometer direction (unit vector) | 3 | 0.10 | 0.30 | 0.5 |

Per profile and block keep the running mean and a diagonal covariance with shrinkage: `var_d = (n·s_d² + 5·v0)/(n + 5)`, `v0` = (within-person SD prior)², `n` = number of sessions. Block log-likelihood of the observed vector `x` under profile `p`: `LL = (Deff/D)·Σ_d logN(x_d; mean_pd, var_pd + obsVar)`; the "new person" hypothesis uses the population mean (mean of all stored profiles' means, or the session's own group mean of a default 1/f template when there are fewer than 2 profiles) and the population variance. Blocks that are missing on either side are skipped. Sum the blocks. All SDs and `Deff` are **[tunable]**.

Prior: owner 0.7 (`ownerBaseRate`, configurable); other known profiles share 0.2 equally; new person 0.1 (with no other profiles: owner 0.7, new 0.3). Posterior = normalised `prior × exp(LL)`.

### Decision flow

1. `gathering`: buffer until 45 s of clean, motion-free data exist after contact is good. Score with **population priors** (not Julian's statistics); profile state `uncertain`, badge "Identifying…".
2. Evaluate every 15 s of additional clean data. **Accept** profile `p` when its posterior ≥ 0.8 and the margin over the runner-up ≥ 0.2 in 2 consecutive evaluations → `confirmed`. If "new person" meets the same rule → create `Guest N` (from population priors) → `guest`.
3. Otherwise stay `uncertain` and keep buffering up to 3 min of clean data. Then fall back: if the best hypothesis is a known profile with posterior ≥ 0.5 → `tentative`: score with that profile's statistics, show "Probably Julian (62%) ✓ ✗", but **do not merge this session into the profile unless the user taps ✓** (stored with `merged: false`). Otherwise create a `Guest N`. (Julian's document said "fall back to Guest"; the tentative state is added because Muse-only identification is expected to be inconclusive most of the time and would otherwise turn the owner into a guest on most Muse sessions, while the no-merge rule still guarantees that no profile learns from an unconfirmed wearer. Logged change.)
4. The session accumulator runs from the first clean window regardless; identity only decides which lifetime statistics it is combined with, and profiles change only at commit. So "no profile update before identity is confident" holds by construction.
5. A new contact epoch after a gap longer than 30 s restarts identification (somebody else may have put the headset on): the running session is committed and a new session starts.

### UI contract (rendered by `panel/engine-ui.js`)

Header badge: `Looks like Julian (82%) ✓ ✗` (`confirmed`), `Probably Julian (62%) ✓ ✗` (`tentative`), `Guest 2 ✓ ✗`, `Identifying…`. ✓ confirms (and sets `merged: true`). ✗ opens a list of all profiles plus "New guest"; choosing one relabels the **whole session** and rebuilds the affected profiles from the stored summaries. A small menu per profile: Rename, Merge into…, Forget me (delete, with a confirm). Export / Import buttons for the JSON.

Tests (`engine/identity.test.js`, `engine/profiles.test.js`):

- I1 Five synthetic people, 4 sessions each to enrol, then 20 new sessions (Cyton with ECG): ≥ 90% assigned to the right profile, none assigned to a wrong known profile with `confirmed`.
- I2 Muse (no ECG), same design: no wrong `confirmed`; undecided sessions end `tentative` or `guest`, never silently merged.
- I3 Open set: a sixth person → `Guest N` created (not merged into anyone).
- I4 No profile update before confidence: during `gathering`/`uncertain`, the stored profiles are byte-identical; scoring during that time uses the priors (assert the z of a probe equals the prior-only z).
- I5 Relabel: moving a session from profile A to B and back restores both profiles exactly (deep-equal within 1e-12).
- I6 Merge and "forget me" work and leave no orphan sessions; export → import round trip is lossless; storage that throws on `setItem` does not throw out of the engine.
- I7 The 60-session cap folds the oldest into `base` and the statistics are unchanged by the fold (1e-9).

## D15. `engine/clean.js` (optional cleaning) and `engine/legacy.js`

### ASR (artifact subspace reconstruction), default **on for the Cyton, off for the Muse**; flag `flags.asr`

Ported from `asrpy` (BSD-3-Clause). Put this header in the file: "Parts of this file are a JavaScript port of asrpy (https://github.com/DiGyt/asrpy), Copyright (c) 2021 Dirk Gütlin and contributors, BSD 3-Clause License", followed by the BSD-3 licence text. State the simplifications in the header too.

- Works on `xa` of the usable EEG channels (`C` channels; the ECG channel and excluded channels are left out; when the usable set changes, recalibrate).
- **Calibration is automatic:** from seconds the event detector marks clean (no mask on any channel). Start once 60 s of clean data exist; recompute after every further 60 s of clean data from the most recent 5 min of clean data; store `{M, T, channels}` per profile and device and use the stored one from the start of the next session until 60 s of new data exist.
  - Block covariances over 1 s blocks; drop the 10% of blocks with the largest trace; `Cov` = mean of the rest; `M = sqrtm(Cov)` (via Jacobi: `V·diag(√λ)·Vᵀ`); eigenvectors `V` of `M`.
  - Component RMS statistics: project the calibration data on `V`, RMS over non-overlapping 0.5 s windows per component, `μ_c` = median, `σ_c` = 1.4826·MAD (simplification of asrpy's truncated-Gaussian fit). Threshold matrix `T = diag(μ + k·σ)·Vᵀ`, cutoff **`k = 20`** [tunable 5–40].
- **Processing every 500 ms:** covariance `Cw` of the last 500 ms (`C×C`), `jacobiEig` → `Vw, Dw` (ascending). Component `i` is kept when `Dw[i] < Σ_j (T·Vw[:, i])_j²`, and the `C − maxDims` smallest components are always kept, `maxDims = floor(0.66·C)`. `R = M · pinv(keep ∘ (Vwᵀ·M)) · Vwᵀ`. Apply `R` to the 500 ms block, blending from the previous `R` with a raised-cosine ramp across the block. Output `xc`; `removedFrac` = 1 − var(out)/var(in).
- A block with `removedFrac > 0.5` is treated as masked (`muscle`). Event detection always runs on the uncleaned `xb`.
- Simplifications to log: no spectral-shaping (Yule–Walker) filter, median/MAD instead of the truncated-Gaussian fit, non-overlapping RMS windows.

### Accelerometer NLMS, implemented, default **off** (`flags.nlms`); turned on only by the auto-tune when it improves artifact immunity

Reference `r` = accelerometer magnitude minus its 2 s running mean, linearly interpolated to the EEG rate. Per channel an NLMS filter with `L = min(128, round(0.4·fs))` taps, step `μ = 0.1`, `ε = 1e-6`: `e = x − wᵀr; w ← w + μ·e·r/(rᵀr + ε)`; output `e`. Weights freeze while accel data is missing. Needs a real accelerometer (not the proxy).

Tests (`engine/clean.test.js`): A1 16-channel fixture with a 1 s burst of 20× amplitude on 2 channels → after ASR the burst-window RMS on those channels drops ≥ 70%, clean stretches change < 5% RMS; A2 ASR off → output identical to input; A3 calibration never uses masked seconds (inject artifacts during calibration time: thresholds within 10% of the clean-only calibration); A4 NLMS: artifact = reference through a 20-tap FIR added to EEG → artifact power reduced ≥ 10 dB after 20 s; flag off → identical output; A5 4-channel ASR (Muse fixture) runs without NaN.

### `engine/legacy.js` (Legacy focus for the Cyton)

`LegacyFocus({fs})`: every hop compute the Welch power of the **mean of the usable EEG channels** (time-domain average, like the panel) in alpha 8–13 Hz and beta 13–30 Hz over the last 1 s; `F = ln((β + 1e-3)/(α + 1e-3))`; `ema ← ema + 0.08·(F − ema)`, `fast ← fast + 0.22·(F − fast)`; no update while the motion gate is not VALID. `calibrate()` replicates `finishCal()` in `panel/gamelink.js` (10 s of `fast` values, inliers within 1.5 IQR, 10th/90th percentiles, minimum span 0.4) and `pct()` replicates `pctOf()`. Baselines are stored under `muse2panel.baselines.cyton`. `output.legacy = {focus: pct(), stress: null}` on the Cyton (the old arousal card is wired to Muse signals only; logged limit). On the Muse, `legacy` comes from `legacyProvider`. Test (`engine/legacy.test.js`): matches the panel formula on a fixture (a transcription of the three formulas in the test), `pct` = 25/75 at the baselines, held during motion.

## D16. Panel integration: `panel/engine-link.js`, `panel/engine-ui.js`, `panel/engine-ui.css`, `panel/engine-rec.js`

### State and URL options

- `S.dev` = `"muse"` | `"cyton"`. Source, in order: URL `?device=`, `localStorage` `muse2panel.device`, default `muse`. Can be changed only while disconnected.
- Engine mode `engMode` = `"new"` | `"legacy"`. Source: URL `?engine=`, `localStorage` `muse2panel.engine`, default **`new`**.
- `?demo=1` → Muse simulator (existing) or, with `device=cyton`, `CytonSim`. `?demo=1&device=cyton&helper=1` → the real adapter (against `cyton_helper.py --simulate`).
- `?selftest=1` → after 20 s of data `engine-link.js` writes a JSON summary into a hidden `<pre id="engSelfTest">`: `{device, hops, focus:{state, finite}, stress:{...}, drowsiness, events:[types seen], errors:[uncaught error messages]}`. Used by `tools/browser_smoke.js`.
- `?validate=1` → the validation protocol (D18).

### Connect / disconnect

`main.js` wires Connect to `connectMuse(true)`. Change the wiring to `engConnect(true)` / `engDisconnect()` defined in `engine-link.js`: Muse → the existing `connectMuse`/`disconnectMuse` unchanged; Cyton → open the Cyton adapter (or `CytonSim`), set `S.connected`, `S.connecting`, `setStatus(...)`, `setButtons()` the same way the Muse path does, and on helper loss set status "Lost signal, retrying". In Cyton mode:

- the 1 s interval in `dsp.js` must not paint Muse sensor values: guard its Muse-specific DOM updates with `if(S.dev==="cyton")` and let `engine-ui.js` fill them (`#sensors` strip shows `16 ch · N good`, `#stRate` the measured rate, `#stDrop` the loss %, `#stUse` `N/16 in use`, `#stMot` the motion state incl. "motion (from EEG)" for the proxy);
- heart-rate card: `#hrName` reads `HEART RATE (ECG)`, `#hrNum` shows the ECG `hr8`, `#hrState` the ECG state (`LIVE`/`WEAK`/`NO ECG`); battery shows `--`;
- band rows and raw view: rebuild the display filters for the Cyton rate with `biquadFs(f0, Q, fs)` and feed them the mean of the usable EEG channels sample by sample (no resampling; the 4-row raw view shows Fp1, C3, P3, O1 and the heart row shows the ECG; relabel the rows; the visible time span is `BUF_LEN/fs` seconds, say so in a tooltip). Restore the 256 Hz filters when switching back to the Muse;
- Start/Stop Recording use the v2 recorder (below).

`engine-link.js` creates the engine when the first frame of a stream arrives (it needs `fs` and `channels`), re-creates it when `streamId`, `fs` or `channels` change, calls `eng.idle(dt)` from a 250 ms timer when no frame arrived for 500 ms, calls `eng.endSession()` on disconnect and `beforeunload`, and keeps `window.EngineOut` = the last output for the UI, the game link, the recorder and the console.

### What the existing meter shows

- `focusPct()` in `focus/focus-switch.js` becomes: Legacy → today's value (FOCUS = `pctOf(focus)`, STRESS = 100 − that); New → `EngineOut[metric].value` for the selected metric (`focus`, `stress`, or `drowsiness` on the Cyton).
- The mode buttons `#fmF` FOCUS and `#fmS` STRESS stay; add `#fmD` DROWSY, visible only when `S.dev==="cyton"` and `engMode==="new"`. `MODE_PREF` accepts `drowsy`.
- New/Legacy switch: a two-button radio group `#engSw` (`NEW` | `LEGACY`).
- Device selector: a two-button radio group `#devSel` (`MUSE` | `CYTON`) directly next to the Connect button, disabled while connected or connecting.
- In New mode the `#btnCal` "AUTO SET BASELINES 10 SECONDS" button is hidden and its place shows the profile panel `#engProf`: line 1 the identity badge with ✓ ✗ (D14), line 2 the confidence badge (D11). In Legacy mode `#btnCal` is back (on the Cyton it calls `LegacyFocus.calibrate()`), and `#engProf` is hidden. New mode has no calibration button anywhere.
- `#fnote` in New mode: state chip + note. Chip texts: `LIVE`, `HELD · <reason>`, `LEARNING`, `--`. Notes (exact wording): FOCUS on the Cyton: `Relative to your usual. Not a validated measure.`; FOCUS on the Muse: `4 sensors: weaker. Relative to your usual.`; STRESS: `Measures arousal (excitement looks the same).`; DROWSY: `Slow trend, minutes of lag.` and while learning `Needs 10 min of history.`; stale: `-- <reason>` (for example `-- movement`). The big number shows `--` whenever the value is null. Never print 0 for a missing value.
- The floating PiP meter (`toggleFloat` in `panel/focus.js`) shows the selected metric: title = `FOCUS`/`STRESS`/`DROWSY`, number or `--`, note = chip text.
- `#stressCard` (old card): shown only in Legacy mode with `?stress=1` as today. In New mode it is hidden and the **engine card `#engCard`** (fixed, bottom left, collapsible like the old card, starts collapsed) shows: one row per metric (name, value or `--`, chip, confidence bar), the stress components (HR z, HRV z, EEG z with valid dots), the last events, and the honest-limits text.
- **Cyton card `#cyCard`** (fixed, bottom right, collapsible, only when `S.dev==="cyton"`): a 4×4 contact grid with 10–20 names laid out front-to-back (row 1 Fp1 Fp2 F7/ECG F8, row 2 F3 F4 T7 T8, row 3 C3 C4 P7 P8, row 4 P3 P4 O1 O2), each cell coloured good ≥ 70 / fair 40–69 / poor < 40 with the number, "ECG" cell showing bpm; ECG line (`72 bpm · signal 0.93` or `No ECG. Stick two gel pads on your chest: one under the right collarbone, one on the lower left ribs. Clip the two leads of channel 9 (the F7 pins on the Daisy board) to them. Tape the cables so they do not pull. Do not use wrist leads.`); helper line (`Helper: streaming · WiFi · 250 Hz · 0.3% lost`, or the "helper is not running" text from D4); warnings from the self-check (E); a `Check contact` button (sends `impedance_sweep`; while it runs the scores are held with reason `no contact` and the button reads `Checking… scores paused`); two indicators `DOUBLE BLINK` and `CLENCH` that flash for 600 ms on each button event.
- A "?" help button on `#engCard` opens the honest-limits text (section H) and, on the Cyton, the pad placement and the WiFi note.

### Layout

The stage is a fixed 1672×941 absolute layout with three looks (`[data-look="cosmic"|"clean"|"neon"]`); follow the existing CSS structure (`panel/ui.css`, `focus/focus-switch.css`): new rules go in `panel/engine-ui.css`, with a block per look. Suggested placement (adjust until nothing overlaps): `#devSel` as a slim row just above `#btnConnect` (left 296, top 768, width 232, height 20); `#engSw` in the focus card to the right of the `#fname` title where `#gameLink` sits now (move `#gameLink` down into the status line of the heart-rate card or next to `#fnote`); `#fmode` buttons shrink to three equal buttons when DROWSY is visible; `#engProf` in the `#btnCal` rectangle (left 1076, top 692, 312×52). You **must check the result visually**: run `node tools/browser_smoke.js` (below), open the PNGs it writes with your image-reading ability, and fix overlaps, clipped text and unreadable contrast in all three looks at 1366×768 and 1536×864 (14-inch laptop sizes), for Muse and Cyton, New and Legacy. If no Chromium browser can be found on the machine, review the CSS by reasoning about the coordinates, and log that screenshots could not be taken.

### Recording

- **Muse, existing CSV:** unchanged columns 0–16; append these columns after the motion columns (never reorder): `eng_focus`, `eng_focus_state`, `eng_stress`, `eng_stress_state`, `eng_profile_conf`, `eng_mask` (states as text; empty cell when null; `eng_mask` = the current mask reason or empty). `REC_COLS` grows accordingly; `focus_0_to_100` stays the Legacy score as today. Update `reportText` to list the new columns and to say which engine mode was displayed.
- **v2 recorder (`panel/engine-rec.js`)**, used for Cyton recordings and by the validation protocol on both devices; cap 40 min; on stop it downloads (Chrome/Edge may ask once to allow multiple downloads; say so in the UI message):
  - `<name>_eeg.csv`: `sample_index,time_s,<channel names with _uV>` (the ECG channel as `ECG_uV`), one row per sample, values with 2 decimals, gaps left as gaps in `sample_index`/`time_s` (nothing filled);
  - `<name>_aux.csv`: `stream,time_s,v1,v2,v3` rows for `acc`, `gyro`, `ppg` samples;
  - `<name>_engine.csv`: one row per hop: `time_s,focus,focus_state,focus_conf,stress,stress_state,stress_conf,drowsiness,drowsiness_state,hr_bpm,rmssd_ms,profile,profile_conf,mask_reason,events` (events as `type@time` separated by `;`), plus `legacy_focus`;
  - `<name>_meta.json`: `{device, fs, channels, ecgChannel, mains, start, engineMode, config: MuseEngine.CONFIG, selfcheck, markers: []}` (markers are filled by the validation protocol).
  - Names start with `Muse2_recording_` or `Cyton_recording_` + the existing `stamp()` format.

### `tools/browser_smoke.js` (optional helper; run it if a browser exists)

Finds Edge or Chrome (`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, `C:\Program Files\Google\Chrome\Application\chrome.exe`, or `where`), and for each of {muse, cyton} × {cosmic, clean, neon} × {new, legacy} × {1366×768, 1536×864} runs it headless (`--headless=new --disable-gpu --window-size=W,H --virtual-time-budget=30000 --screenshot=.tmp/shots/<case>.png "file:///<repo>/muse-panel.html?demo=1&device=..&look=..&engine=.."`), then once per device with `&selftest=1 --dump-dom` and checks the `engSelfTest` JSON: `errors` empty, focus state not `unavailable`, values finite or null, and on the Cyton at least one `double_blink` and one `clench_tap` seen (the default simulator script contains them). Prints PASS/FAIL per case; exit code 0 with a "SKIPPED: no browser found" line when none exists.

## D17. Game link v2 and games (no gameplay changes)

### Body (built by the pure function `MuseEngine.GameBody.build(state)`; `sendGame()` in `panel/gamelink.js` calls it)

```json
{
  "focus": 63.2, "mode": "focus", "sensors": [96, 96, 97, 72], "motion": "VALID", "stale": false,
  "v": 2, "session": 1731490000000, "seq": 812,
  "device": "cyton", "engine": "new",
  "profile": {"label": "Julian", "conf": 0.82},
  "metrics": {
    "focus": {"value": 63.2, "conf": 0.71, "state": "live"},
    "stress": {"value": null, "conf": 0, "state": "stale", "reason": "movement"},
    "drowsiness": null
  },
  "events": [{"id": 41, "type": "double_blink", "t": 482.25, "conf": 0.9}],
  "legacy": {"focus": 55.1, "stress": null}
}
```

- The first five fields keep their exact old meaning and types. `focus` is the number the games already use: the New focus value when New is selected (number while `live`/`held`/`learning`, `null` when `stale`/`unavailable`), the Legacy focus when Legacy is selected. `stale` = true when the focus is held or stale (Legacy: `motionHeld()` as today). `sensors` stays 4 numbers: on the Cyton the contact of Fp1, Fp2, O1, O2 (so old games show something sensible); `motion` keeps the legacy strings.
- `events` carries only button events (`double_blink`, `clench_tap`). **Events are never dropped between posts:** every event has an increasing `id`; the panel keeps a queue and resends every event until acknowledged; at most 32 events per post; the server replies `{"ok":true,"ack":<highest id received>}`; the panel drops events with `id ≤ ack`. A reply without `ack` (an old server) acknowledges everything that was sent. `session` (the panel's load time in ms) lets the server reset its "last id" when the panel reloads. The body must stay under 8 KB (assert in the test).
- Nulls are sent as `null`, never as 0. No profile templates or statistics are ever in the body.

### `game-py/link.py`

- Read up to **8192** bytes (was 1024).
- Keep `focus`/`sensors` parsing and `read()` → `(state, focus, sensors)` exactly as they are.
- New attributes, all behind the existing lock: `link.metrics` (dict or `None`), `link.device`, `link.engine`, `link.profile`, `link.legacy`, and an event queue (`collections.deque(maxlen=256)`) with `link.pop_events()` (returns and clears) and de-duplication by `(session, id)`; reply with `ack`.
- Malformed v2 fields are ignored field by field (a bad `metrics` must not lose `focus`).
- `game-link/stacker.py`: raise its body cap from 512 to 8192 bytes. Nothing else.
- `game-py/mario_kart.py`: after `self.link.read()`, also keep `self.metrics = self.link.metrics` and drain `self.link.pop_events()` into `self.last_events` (kept, unused). No gameplay change.

### Game menu and in-page games

- `ctx` in `panel/gamelink.js` gains `metrics: () => EngineOut ? {focus, stress, drowsiness} : null`, `events: () =>` (returns and clears the events since the last call; a separate queue from the HTTP one), `engine: engMode`, `device: S.dev`.
- `focus()` → New: the engine focus value (or null); Legacy: as today. `stress()` → New: engine stress value / 100, **or `null` when there is none** (today it turns null into 0; the bomb game already treats null as "no reading", line ~710 of `game/bomb.js`); Legacy: as today. `focusReady` → New: connected and focus state is `live`, `held` or `learning`; `stressLive` → New: stress state is not `unavailable`.
- `game/menu.js`: pass `metrics` and `events` through to `BombUI.open` and `MKDSUI.open` (stored, unused); when `ctx.engine === "new"` the `needs` messages do not mention "Auto Set Baselines" (use: "Focus is live." / "Connect the headband first."). The header comment documents the new ctx members.
- `game/bomb.js`: accept `opts.metrics`/`opts.events` (stored, unused). When the stress source is the meter and the engine is New, the note reads "STRESS MODE: driven by the engine (heart rate, heart-rate variability, alpha). Measures arousal, not a validated stress measure." No rule, timing or scoring change.
- `game/mkds-render.js` / `game/mkds.js`: accept and store `metrics`/`events`. Nothing else. If `MKDSUI` has no programmatic close, add `MKDSUI.close()` (the validation protocol needs it); it must do exactly what the existing close/Esc path does.

Tests: `engine/gamebody.test.js` (old five fields unchanged in name, type and meaning for both engine modes; nulls stay null; body < 8 KB with 32 events; ack logic drops only acknowledged events and resends the rest; no key named like a template leaks); `game-py/test_link.py` (plain Python: start `HeadbandLink` on an ephemeral port; a v1 body `{"focus":63.2,"sensors":[96,96,97,72]}` still gives `("live", 63.2, [...])`; a v2 body of 6 KB is accepted; `metrics` and events are exposed; duplicate event ids are delivered once; `ack` is returned; a 9 KB body does not crash the server; `focus: null` → `"waiting"`); `game/bomb.test.js` gets added cases: the stress source used with an engine-style provider returns the engine value, and a `null` reading produces "no reading" with no stress effects (use the logic-level functions; if the UI function is not reachable from Node, extract the two-line source-selection into `bomb-logic.js` as a pure function and test that, without changing behaviour); `game/mkds.test.js` and `game-py/test_mkds.py` unchanged and passing.

## D18. Validation recording: `validation.html` + `panel/validation.js`

Julian runs this once, alone, later (about 25 min per device). It needs the device code of the panel, so the protocol is an overlay inside the panel page:

- `validation.html`: a plain page with a short explanation, the honest note, what to prepare (headset on, for the Cyton: helper running and chest pads on), and four links: `muse-panel.html?validate=1&device=muse`, `...&device=cyton`, and the same two with `&demo=1` ("try it with simulated data"). It also links to `workflows/validate_focus_stress.md`.
- `panel/validation.js` (active with `?validate=1`): a full-stage overlay with a Start button (enabled once connected and data flows), a big cue line, a countdown, a progress bar over all blocks, and a beep at every change (Web Audio, 880 Hz, 150 ms; two beeps at block changes). It starts the v2 recorder (40 min cap), forces `engine=new`, and writes **markers** `{t /* stream time */, wall, block, label, kind:"start"|"end"|"cue", n}` into the recording's `meta.json`. If the stream drops, the protocol pauses, says so, and resumes at the start of the interrupted block.

Blocks, in order (`&fast=1` divides every duration by 10 for testing):

| # | Block id | Duration | On-screen instruction | Cues |
|---|---|---|---|---|
| 1 | `rest_open` | 2 min | "Sit still, eyes open, look at the dot." | start/end |
| 2 | `rest_closed` | 1 min | "Close your eyes. Open them at the double beep." | start/end |
| 3 | `nback` | 3 min | 2-back built into the page: a letter every 2.5 s (shown 500 ms), press Space when it matches the letter two back; 30% targets; score shown at the end | each stimulus + response |
| 4 | `arith` | 2 min | serial subtraction with time pressure: "1022 − 13", type the answer, 5 s per answer with a shrinking bar, a wrong or late answer restarts at 1022 (reuse `Stress.makeTask`) | each answer |
| 5 | `rest2` | 1 min | "Rest, eyes open." | start/end |
| 6 | `art_blink` | 20 × 3 s | "Blink once at each beep." | one cue per trial |
| 7 | `art_dblink` | 20 × 4 s | "Blink twice quickly at each beep." | per trial |
| 8 | `art_clench` | 20 × 4 s | "Clench your jaw briefly at each beep (a quick tap)." | per trial |
| 9 | `art_clench_long` | 20 × 6 s | "Clench and hold for 3 seconds at each beep." | per trial (cue marks the 3 s) |
| 10 | `art_frown` | 20 × 4 s | "Frown hard for a second at each beep." | per trial |
| 11 | `art_talk` | 60 s | "Read this text aloud." (a neutral paragraph on screen) | start/end |
| 12 | `art_chew` | 30 s | "Chew (gum or pretend) until the beep." | start/end |
| 13 | `art_turn` | 20 × 4 s | "Turn your head left / right at each beep." (alternating) | per trial |
| 14 | `art_nod` | 20 × 4 s | "Nod once at each beep." | per trial |
| 15 | `art_stand` | 3 × 15 s | "Stand up, then sit down." | per trial |
| 16 | `art_type` | 60 s | "Type random letters in the box. Do not think hard." | start/end |
| 17 | `game` | 5 min | launches the in-page Mario Kart (`MKDSUI.open`), closes it after 5 min | start/end |
| 18 | `fixation` | 5 min | "Look at the dot. Do nothing." (dim screen) | start/end |

At the end: stop the recorder (4 files download), show "Done. Next: run `python tools/autotune.py` (see workflows/validate_focus_stress.md)". This protocol is a developer validation, not a calibration: the engine never requires it.

Test: `node tools/browser_smoke.js` also runs `muse-panel.html?demo=1&validate=1&fast=1&autostart=1&device=cyton` for 200 s of virtual time and checks (through a `validationSelfTest` JSON in the DOM) that all 18 blocks produced start and end markers in order. Skipped with a logged line when no browser exists. In addition `panel/validation.js` exports its block table and marker builder through `module.exports` when run in Node, and `panel/validation.test.js` checks the block order, the total duration (25 min ± 2), and marker shapes.

## D19. `tools/replay.js`, `tools/make_synth_recording.js`, `tools/autotune.py`, `tools/get_datasets.py`

### `tools/replay.js` (Node, headless)

`node tools/replay.js --in <file or name prefix> [--config cfg.json] [--out out.json] [--device muse|cyton] [--profile none|fresh] [--quiet]`

- Inputs: a v2 recording (prefix of the 4 files), or an existing panel CSV (old Muse format: uses columns `TP9_uV…TP10_uV` at 256 Hz, `time_s` for gaps, `motion_*` columns to drive the motion gate from the recorded state, `heart_rate_bpm` as `aux.ppgHr`; no PPG waveform, so HRV is absent and stress runs on HR only).
- Feeds the engine frame by frame with an in-memory profile store and writes `{meta, hops:[output objects, compact], events:[...], summary:{validFrac per metric, mean/sd per metric, events per type, maskFrac per reason}}`. Prints the summary as a table.
- With no `--in`, it looks for `*.csv` in `.tmp/` and in the user's Downloads folder (`%USERPROFILE%\Downloads`) whose header starts with `time_s,TP9_uV`, replays up to 3 of them, and exits 0 with "no recordings found (optional)" when there are none.
- `--config` deep-merges a JSON over `MuseEngine.CONFIG` (this is how the auto-tune tries settings).

Test (`tools/replay.test.js`): replays a synthetic old-format CSV written by the test itself and a synthetic v2 recording from `make_synth_recording.js`; outputs are finite/null, the summary has the expected keys, and `--config` changes a threshold measurably.

### `tools/make_synth_recording.js`

`node tools/make_synth_recording.js --device cyton|muse --out .tmp/synth/<name> [--fast 10] [--seed 1]` writes a v2 recording with the full D18 block structure and markers from `engine/fixtures.js`: rest blocks neutral; `nback`/`arith` "focused" (theta ×1.6, alpha ×0.6) with HR +10 bpm and RMSSD ×0.7 in `arith`; artifact blocks with the matching injectors at the cue times (reaction delay 300–600 ms after each cue); `game` with random blinks, talk bursts and small movements; `fixation` with `ratioD` and blink duration rising linearly to +1.5σ.

### `tools/autotune.py` (NumPy/SciPy only; optional `meegkit` to compare ASR, skipped when absent)

`python tools/autotune.py --in <recording prefix> [--device auto] [--quick] [--out-dir engine] [--report docs/validation-report.md]`. With no `--in` it picks the newest `*_meta.json` in Downloads or `.tmp/`. It never asks anything; on bad input it prints one clear line and exits 2.

Method: the engine is JavaScript, so the script evaluates settings by running `node tools/replay.js --config <candidate> --out .tmp/autotune/run_k.json` (one source of truth for the maths) and analysing the outputs with NumPy against the markers. At most 80 replay runs (`--quick`: 12).

1. **Priors:** from `rest_open` + `rest2` (clean windows): per-feature mean and SD → `priors` for this device (`sd` floored at 0.3 for log powers, 5 bpm for HR, 0.25 for ln RMSSD).
2. **Detector thresholds** (coordinate search): `emgRatioIn` ∈ {2.5, 3, 3.5, 4}, blink `k` (the multiplier on σv/σd) ∈ {3, 4, 5}, `blinkFloorUv` ∈ {0.7, 1, 1.3} × default, voluntary factor ∈ {1.3, 1.5, 1.8}, third-blink window ∈ {400, 500, 600} ms. Objective: button TPR on `art_dblink`/`art_clench` (a hit = an event within 1.5 s after the cue) minus 10 × false positives per 5 min in `art_talk`, `art_type`, `game`, plus the single-blink detection rate on `art_blink`.
3. **ASR:** `k` ∈ {off, 10, 20, 30} (Cyton) and on/off (Muse); **NLMS** on/off. Choose by the artifact-immunity score; NLMS is switched on only if it improves that score by ≥ 10% relative; ASR on the Muse only if it improves it by ≥ 10%.
4. **Focus weights:** coordinate search over `wθ, wα, wβ ∈ {0, 0.5, 1, 1.5, 2}` maximising the effect size of (`nback` + `arith`) vs `rest_open`, subject to artifact immunity passing; never all zero.
5. Write `engine/tuned.json` = `{version, device, created, source: <recording name>, config: {...}, priors: {...}}` and `engine/tuned.js` (`MuseEngine.TUNED = {...};` inside the UMD pattern). Tuned values for the other device are preserved if the file exists. The engine loads `tuned` automatically when present (Node: `require` in try/catch; page: the dynamic script tag).
6. Write `docs/validation-report.md`: recording facts, the chosen values next to the defaults, and a PASS/FAIL table for the **acceptance criteria**:
   - **Artifact immunity:** for each artifact block, the median absolute change of focus and of stress against the surrounding rest is < 5 points, and the score is masked/held for ≥ 80% of the artifact time (cue-locked windows).
   - **Focus:** `nback` and `arith` vs `rest_open`: within-person effect size `d ≥ 0.5` (Cohen's d on hop values thinned to one per 10 s).
   - **Stress:** `arith` vs rest: mean HR rise detected (> 0 with a one-sided test at p < 0.05 on the thinned values) and score difference `d ≥ 0.5`.
   - **Buttons:** TPR ≥ 90% for double blink and for clench tap; false positives ≤ 1 per 5 min in each of `art_talk`, `art_type`, `game`.
   - **Drowsiness (Cyton):** non-decreasing trend over `fixation` (Spearman ρ of minute means ≥ 0) and no rise in `rest_closed` from alpha alone (mean in `rest_closed` ≤ mean in `rest_open` + 5 points).
   - **Valid-time fraction** per block and metric (reported, no threshold).
   - Plus: identity sanity (the recording's own identity vector vs the stored owner profile), measured rate/loss, alias warning.
   A FAIL does not stop the script; the report says what failed and what that means in plain words.

Test (`tools/test_autotune.py`, plain Python): generates a fast synthetic Cyton recording with `node tools/make_synth_recording.js --fast 10`, runs `autotune.py --quick --out-dir .tmp/autotune_test --report .tmp/autotune_test/report.md`, and checks: exit code 0; `tuned.json` parses, has `config` and `priors`, every tuned weight within its bounds; `tuned.js` is valid JS that sets `MuseEngine.TUNED` (run it with `node -e`); the report contains every criterion name with PASS or FAIL; on this synthetic recording the focus, stress and button criteria PASS. The repo's real `engine/tuned.json` is **not** created by you (it must come from Julian's real recording); the test writes only under `.tmp/`.

### `tools/get_datasets.py` (optional data; nothing depends on it)

`python tools/get_datasets.py --dataset eegmat|eegdenoisenet|klados|cogbci|muse_mendeley|ultracortex_mi|all [--dest .tmp/datasets]`. Downloads the openly downloadable ones with `urllib` (resume, size check, clear errors): PhysioNet EEGMAT (`https://physionet.org/content/eegmat/`), EEGdenoiseNet, Klados semi-simulated EOG (Mendeley `wb6yvr725d` v4), COG-BCI (Zenodo record 7413650; large: print the size and require `--yes-large`), Mendeley Muse 2 focus/relax (`g69dctrybk`), Mendeley Ultracortex MI with deliberate blinks (`rz2jhpvhp3` v2). For SAM40, WESAD, STEW and TUAR it only prints where to get them and that they need registration or a manual download. Never run it as part of the tests. `engine/datasets.test.js` runs a check per dataset **only if** `.tmp/datasets/<name>` exists (for example EEGdenoiseNet EMG segments added to clean EEG must be masked ≥ 80% of the time; EEGMAT arithmetic vs rest must show focus `d > 0`), and prints `SKIP <name> (not downloaded)` otherwise; with nothing downloaded it exits 0.

---

# E. RUNTIME CHECKS AND FALLBACKS (things that cannot be verified without hardware)

Implement every row: the check runs automatically when the device is first used, the result is logged by the helper/engine, shown in the panel (`#cyCard` warnings / `quality.warnings`), and written to `docs/IMPLEMENTATION_NOTES.md` as a hardware assumption.

| Unknown | Runtime check | Fallback / behaviour |
|---|---|---|
| WiFi per-channel rate with the Daisy | measured from sample count and timestamps (D3.2) | assume 125 Hz until measured; bands adapt to the reported `fs` |
| `~4/~5/~6` rate commands on the WiFi Shield | measured rate vs requested | trust the measured rate |
| BrainFlow accel channels on the WiFi board | `get_accel_channels` in try/except + non-zero rows in 10 s | EEG motion proxy (D6); panel: "motion (from EEG)" |
| Ultracortex channel mapping | default map; after 3 min the engine checks that blink amplitude at Fp1/Fp2 is > 2× that at O1/O2 and that the alpha-peak residual at O/P exceeds the frontal one | keep the default map; panel warning "Channel map may not match the default Ultracortex layout" |
| ECG channel and polarity | kurtosis + periodicity (D3.4), auto-flip (D10) | stress without ECG → `unavailable`, "no ECG"; pad-placement help shown |
| ECG µV scale with gain 12 | none needed | all ECG processing is scale-invariant |
| 120 Hz → 5 Hz alias at 125 Hz | helper self-test (D3.4 item 5) | panel warning; theta-feature confidence × 0.7 |
| FTDI latency on the dongle | timestamp burst spacing (D3.4 item 6) | panel warning with the exact Device Manager fix |
| WiFi reliability | loss % over the last 10 s | above 2% for 30 s: panel warning "Data is dropping on WiFi. OpenBCI retired the WiFi Shield for reliability problems. Plug in the USB dongle and restart the helper with --link dongle." |
| Does ASR help at 4 channels / on dry combs | auto-tune report (D19) | defaults: ASR on for the Cyton, off for the Muse |
| Real artifact amplitudes on dry combs | passive running statistics of spontaneous events (D7) | population floors of D7 |
| Daisy missing | channel count / all-zero Daisy half | run with 8 channels, features use what exists, panel error line |
| Impedance formula accuracy | none (documented as approximate) | shown as "about N kΩ"; used only as one input of contact quality |

---

# F. ORDER OF WORK (each step ends with its tests green and one commit)

1. **Branch and notes.** Create `feat/robust-engine-cyton`. Read the files in section B. Run the seven existing tests. Create `docs/IMPLEMENTATION_NOTES.md` with the headings: Baseline test results, Judgement calls, Changes to numbers in the prompt, Hardware assumptions and runtime checks, Known limits, Final checklist report. Create `tools/run_all_tests.js` (lists every test command; add to it as you go). Commit.
2. **Engine skeleton.** `engine/util.js`, `frame.js`, `fixtures.js`, `pipeline.js` (pass-through skeleton that emits the output object with `unavailable` metrics), `adapters/muse.js`, the tap lines, `tools/replay.js` (skeleton), script tags. Tests: util, frame, fixtures (determinism; the default fixture's band powers land within 0.3 ln of the priors), muse adapter. Commit.
3. **Helper and Cyton adapter.** `tools/cyton_helper.py` with `--simulate`, `requirements.txt`, `Open Cyton Helper.bat`, `test_cyton_helper.py`, `adapters/cyton.js`, `cyton-sim.js`, device selector + connect dispatch (`S.dev`), `.gitignore` entry. Commit.
4. **Preprocessing, contact, motion.** Commit.
5. **Event detector and masking.** Commit.
6. **Normalization** with all 14 tests, `priors.json`, `build_priors.js`, `priors.js`. Commit.
7. **Features, ECG, PPG, metrics (focus, stress, drowsiness), buttons.** Commit.
8. **Hold/fade, pipeline complete, `engine-link.js`, UI in three looks, New/Legacy switch, Legacy for the Cyton, recorder columns and v2 recorder, `browser_smoke.js`.** Commit.
9. **Identity and profiles** (store, badge, ✓ ✗, rename/merge/forget, export/import). Commit.
10. **Game link v2:** `gamebody.js`, `sendGame`, `link.py`, `stacker.py` cap, menu ctx, bomb and Mario Kart plumbing, tests. Commit.
11. **ASR and NLMS (flags), validation protocol, `make_synth_recording.js`, `autotune.py`, `get_datasets.py`, their tests.** Commit.
12. **Full run and docs.** `node tools/run_all_tests.js` → everything passes. `node tools/browser_smoke.js` → pass or logged skip; look at the screenshots. Write/refresh all docs (section H) and `workflows/validate_focus_stress.md`. Fill the final checklist report. Commit.

Performance budget to respect and check in `engine/pipeline.test.js`: processing 60 s of 16-channel 250 Hz data with ASR on takes < 6 s in Node on this machine (10× real time); 60 s of Muse data < 2 s.

---

# G. FULL TEST LIST

`node tools/run_all_tests.js` runs all of these, prints one line per file with PASS/FAIL and the time, and exits non-zero if any fails. Every test file is a plain script in the style of `game/bomb.test.js`.

| Command | Covers (criteria in the sections named) |
|---|---|
| `node arousal.test.js`, `node stress.test.js`, `node panel/motion.test.js`, `node game/bomb.test.js`, `node game/mkds.test.js`, `node focus/experimental/focus.test.js`, `python game-py/test_mkds.py` | existing tests, still passing (bomb with the added null/engine cases) |
| `node engine/util.test.js` | D1 |
| `node engine/frame.test.js` | frame validation, gap bookkeeping, stream-time arithmetic exact for 1 h of indices |
| `node engine/fixtures.test.js` | determinism, priors match, injector ground truth |
| `node adapters/muse.test.js`, `node adapters/cyton.test.js` | D2, D4 |
| `node engine/preproc.test.js`, `engine/contact.test.js`, `engine/motion.test.js` | D6 |
| `node engine/events.test.js` | D7: E1–E6 |
| `node engine/mask.test.js` | D8 |
| `node engine/features.test.js` | D9 |
| `node engine/ecg.test.js`, `engine/ppg.test.js` | D10: C1–C6, P1 |
| `node engine/norm.test.js` | D11: N1–N14 |
| `node engine/priors.test.js` | `priors.js` equals `priors.json`; every feature used by the code has a prior for its device |
| `node engine/metrics.test.js` | D12: M1–M8 |
| `node engine/buttons.test.js`, `engine/holdfade.test.js` | D13 |
| `node engine/identity.test.js`, `engine/profiles.test.js` | D14: I1–I7 |
| `node engine/clean.test.js`, `engine/legacy.test.js` | D15 |
| `node engine/gamebody.test.js` | D17 |
| `node engine/pipeline.test.js` | end to end on fixtures, both devices: output schema exact (every key, types, `value === null` iff state is stale/unavailable or drowsiness-learning); 10 min of clean data → no events, focus within 35–65 after the first 3 min, zero NaN; scripted artifact run → each artifact masks the right metrics and the hold/fade sequence `live → held → stale → live` appears with the right reason; a 6 s gap → `signal lost`, new epoch; Muse → `drowsiness === null` and no button events; Cyton default script → `double_blink` and `clench_tap` events with latency < 400 ms; New and Legacy values both present every hop; determinism (same seed → identical output JSON); the performance budget of section F; the engine works with `store: null`, with `tuned: null`, and with a `tuned` object that overrides a constant |
| `node engine/datasets.test.js` | optional datasets, SKIP lines when absent |
| `node panel/validation.test.js` | D18 block table and markers |
| `node tools/replay.test.js` | D19 |
| `python tools/test_cyton_helper.py` | D3.7: H1–H10 |
| `python tools/test_autotune.py` | D19 |
| `python game-py/test_link.py` | D17 |
| `node tools/browser_smoke.js` (not part of `run_all_tests.js`' exit code when no browser exists) | D16, D18 |

Also verify by hand-run commands and record the outcome in the notes: `python tools/cyton_helper.py --simulate --run-seconds 5` exits 0 and logs the self-check; `node tools/replay.js` with no input exits 0.

---

# H. DOCS TO WRITE

- **`README.md`**: what the panel now does (two devices, New engine and Legacy), how to start (Muse; Cyton: start `Open Cyton Helper.bat`, pick CYTON, Connect), the four outputs, what the chips and badges mean, the **Honest limits** section below, the privacy note, where the tests are (`node tools/run_all_tests.js`), and a pointer to the validation workflow.
- **Honest limits** (README and the "?" help in the UI, same wording):
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
- **`docs/DETAILED_README.md`**: architecture (the nine stages), every module with its equations and constants, the frame format, the output object, the normalization maths with the absorption trade-off explained in plain words, the masking table, state machine, storage schema, the research reasons for the main choices (EMG dominates above 20 Hz; theta/beta ratio is discredited; RMSSD needs ≥ 30 s; Muse PPG RMSSD bias; cross-person workload decoding is near chance, hence within-person indices; ECG identification is strong and EEG weak).
- **`docs/focus-correction-plan.md`**: add a first line "Superseded on <date> by the engine in `engine/` (see docs/DETAILED_README.md). Kept for history." Do not delete content.
- **`focus/README.md`**, **`panel/README.md`**, **`game/README.md`**, **`game-py/README.md`**, **`PLAN.md`**: update the parts that describe focus/stress, the switch, the game link fields and `ctx` members; mark the legacy path as Legacy.
- **`tools/README.md`**: helper usage and every flag, the launcher, the WebSocket protocol with the byte table and all JSON messages, the self-checks and their meaning, the aliasing risk, chest-pad placement (modified lead II: one pad under the right collarbone, one on the lower left ribs; the code flips the polarity itself; gel pads; cables taped; no wrist leads), WiFi direct mode (join the shield's network, 192.168.4.1; no eduroam/WPA2-Enterprise) and station mode (`--ip`), the dongle fallback and the FTDI fix, `replay.js`, `make_synth_recording.js`, `autotune.py`, `get_datasets.py`, the simulator scripts.
- **`workflows/validate_focus_stress.md`** (SOP for Julian, in the style of a WAT workflow: objective, inputs, tools, steps, outputs, edge cases): how to wear each headset; start the helper (Cyton); open `validation.html`; do the ~25 min protocol alone; the four files land in Downloads; run `python tools/autotune.py`; read `docs/validation-report.md` (what each PASS/FAIL means and what to do: re-seat and repeat, switch to the dongle, accept limits); how to undo (delete `engine/tuned.json` and `engine/tuned.js`); repeat per device.
- **`docs/IMPLEMENTATION_NOTES.md`**: every judgement call; every number you changed from this prompt and why; every hardware assumption with its runtime check; known limits (at least: eyes-closed detection lag, the state-at-epoch-start absorption, first-session drowsiness unavailable, Cyton legacy stress null, identity weakness on the Muse, clench look-back only, ASR simplifications, things that could not be verified without hardware); the final checklist report.

---

# I. COMPLETION CHECKLIST (report against every line in `docs/IMPLEMENTATION_NOTES.md`, with the evidence: test output lines, file paths, commit hashes)

1. Branch `feat/robust-engine-cyton` exists, created from `mario-kart-focus`; 12 or more logical commits; nothing pushed.
2. Every file in C1 exists (except `engine/tuned.json`/`tuned.js`, which only the auto-tune creates) and follows the C2 module pattern; the page loads with no console error in Muse demo and Cyton demo (browser smoke test, or logged skip).
3. `node tools/run_all_tests.js` exits 0: all seven old tests and every new test in section G pass. Paste the final table.
4. Muse: New engine shows FOCUS and STRESS with chips, confidence badge and notes; Legacy shows the old numbers and the 10 s button; switching is instant.
5. Cyton (simulated): FOCUS, STRESS, DROWSY, button flashes, contact grid, ECG status, helper status, Check contact; helper-not-running message shown when the helper is down.
6. Artifact behaviour: hold with fading confidence for 3 s, then `--` with a reason; no metric is ever 0 for missing data; nulls are `null` on the game link.
7. No calibration control exists in New mode; nothing in New mode asks the user to do anything.
8. Normalization: the 14 tests pass; profiles persist in `museengine.profiles.v1`; export/import works.
9. Identity: badge with ✓ ✗, relabel rebuilds profiles, rename/merge/forget work; no profile changes before identity is confident; nothing personal leaves the browser.
10. Game link v2: old fields unchanged; new fields present; events queued until acknowledged; `link.py` accepts 8 KB and exposes `metrics`/events; `stacker.py` cap raised; games receive `metrics()`/`events()`; no gameplay change.
11. Helper: `--simulate` works without BrainFlow; WiFi-first with dongle fallback; rate ladder; self-checks; reconnect; clean shutdown; `Open Cyton Helper.bat` creates its venv on first run.
12. Runtime checks of section E are implemented and listed in the notes.
13. Validation: `validation.html`, the 18-block protocol, v2 recording with markers; `tools/autotune.py` produces `tuned.json`, `tuned.js` and the report on the synthetic recording; `workflows/validate_focus_stress.md` exists.
14. CSV rule kept: old columns unchanged in name and order; new columns appended.
15. Legacy and parked code still present and working (`focus/experimental/*`, `stress.js`, `arousal.js`, the legacy loop).
16. Docs of section H written; honest limits in README and UI help.
17. `docs/IMPLEMENTATION_NOTES.md` complete: judgement calls, changed numbers, hardware assumptions, known limits, this report.
18. Working tree clean (`git status`), no stray files outside `.tmp/`.

Do not stop before all 18 lines are true. Do not ask anyone anything. Begin with step 1 of section F now.
