# claude-muse: detailed README (status as of 2026-11-09)

Browser tools for the Muse 2 EEG headband and a stress-driven bomb defusal game. Everything runs in Chrome or Edge
(Web Bluetooth). This file describes what exists, how it works, what is tested, and what is still open.
Keep it updated when behaviour changes: "Tests and what was verified" and "Open work" matter most.

## 1. Run it
**Mac (Chrome):** double-click `Open Muse Panel (Mac).command`. It serves the folder on `http://localhost:8077` (Web Bluetooth
needs a secure page) and opens Chrome. Allow Chrome in System Settings > Privacy & Security > Bluetooth if nothing is found.
Add `?demo=1` to the address for simulated data. **Windows:** `Open Muse Panel.bat` (Edge).
Close the Muse phone app first. Safari and Firefox do not support Web Bluetooth.

| Page | What |
|---|---|
| `muse-panel.html` | The control panel: live bands, raw view, heart rate, focus meter, stress meter, recording, the **B** game button |
| `game/bomb.html` | The bomb game on its own (manual test mode by default) |
| `game/bomb-test.html`, `stress-test.html` | Browser test runners (they print "ALL PASSED") |

## 2. Muse panel (built by Julian with Claude; changed only where noted)
Connects over Web Bluetooth (service `fe8d`, EEG characteristics `273e0003..0006`, preset `p50`, falls back to `p21`).
Shows TP9/AF7/AF8/TP10, five band rows, heart rate from the pulse sensor, signal quality and battery, records a CSV
(256 rows/s, gaps for dropped packets), and has the original **focus meter** (`ln(beta/alpha)`, 10 s personal baseline).
Changes on branch `feat/experiment-protocols`: the game button opens the bomb game; demo mode got a `demoGamma`
variable; `stress.js` is loaded at the bottom of the page; the Mac launcher was added.

## 3. Stress meter (`stress.js`): EXPERIMENTAL, NOT A VALIDATED STRESS MEASURE
EEG cannot read stress directly. The meter blends three signals that tend to rise with arousal, each compared with
the player's own calm baseline:

| Signal | Source | Why |
|---|---|---|
| Heart rate | Muse pulse sensor (`PL.bpm`) | arousal raises heart rate |
| Frontal beta/alpha | AF7 + AF8, 2 s Hann FFT, `ln(beta 13-30 / alpha 8-13)` | common (unvalidated) arousal feature; skipped while a blink/jerk artifact is flagged |
| Muscle tension | AF7 + AF8, `ln(gamma 30-44 / total 1-44)` | forehead tension (frowning, clenching) shows up here; this is EMG, not brain activity |

**Calibrate calm** (30 s, `?stcal=N` to change): sit still, eyes open. Baseline = mean and SD per signal (SD floored at
3 bpm and 0.15 ln units). Each second: `z = (value - mean) / SD` (clamped to +-4), weighted average (0.40 / 0.35 / 0.25,
renormalised if a signal is missing, for example no pulse), then `score = clamp(20 + 80 * z / 3, 0, 100)`, smoothed
(EMA 0.25). **20 = your calm baseline, 100 = about 3 SD above it.** The card at the bottom-left shows the score and each
signal's z. In demo mode it has sliders for simulated heart rate, beta and face tension.
Limits: relative to one person on one day; caffeine, movement, a loose headband or concentration also move it
(solving a puzzle raises beta and heart rate without being "stress"). Treat it as a game input, not a measurement.
API: `StressMeter.value()` returns 0..100 or `null` (not connected or not calibrated); `StressMeter.ready()`.

## 4. Bomb game (`game/`)
One level, three modules, 3:00 clock, 3 strikes. All art is drawn in code.
- **Wires** (5): cut by colour counts and the serial number. **Button**: tap or hold, release on a clock digit.
  **Keypad**: press the four symbols in the order of the one column that contains them all.
- **The manual (M key or top-bar button):** rules are *only* in the manual, so the player has to open and read it. It has a
  section per module ("how to read it", the rules in order, hints). The clock keeps running while it is open.
- `bomb-logic.js` rules, seeded levels (`?seed=42` for a repeatable bomb), stress mapping, all `TUNING` numbers.
- `bomb.js` view, input and effects. `BombUI.open({mode, focus, stress, status, seed, tuning, onEvent, onClose})`.

**Two modes** (top-bar button): **Live (Muse)** uses the stress meter (`stress()` returns 0..1); **Manual test** shows a
slider (focus 0..100, 0 = very stressed) and a "no reading" box. The end screen labels test runs "not real data".
The panel starts live mode only when connected and the stress meter is calibrated.

**Stress effects** (stress smoothed over 1 s):
| Effect | Detail |
|---|---|
| Hand tremor | pointer jitters up to 16 px (spikes above 50% stress); clicks land at the jittered point |
| Sweat drops | none below 15% stress, up to 0.8/s; each leaves a water-lens patch that blurs what is under it; dries after 12 s |
| Slipping | a press on a wet patch slides about 28 px, mostly downward |
| Short circuit | 3 patches on one module: it sparks and ignores touch (the timer display scrambles) until you wipe |
| Soaked manual | while the manual is open, drops land on the paper. A wet blotch blurs the words under it; once dry it leaves a stain that is still hard to read (blurs 1.5 px). Stains are permanent for that bomb |
| Wipe dry | Space or the top-bar button clears bomb patches and dries the paper (stains stay), costs 3 s on the clock |
| Heartbeat | audible from 25% stress; a red vignette pulses (64 bpm calm, 134 stressed); slight blur above 60% |
| Clock | runs up to x1.6 faster at full stress, +x0.25 per strike |
| Display glitch | above 55% stress the timer flickers |

Events: `start, mode, strike, module_solved, slip, blocked, paper_wet, wipe, defused, explode, finish` (also `bomb:event` on
`window`). The `finish` summary has result, time played, strikes, average stress, seconds under high stress, sweat drops,
slips, shorted presses, paper blotches, wipes and the event log. This is the hook for logging and for Unity later.
Manual test mode uses `stress = clamp((50 - focus) / 50)`.

## 5. Tests and what was verified
- `game/bomb.test.js` (18 checks) and `stress.test.js` (15 checks): rules, 2,000 generated bombs all solvable, sweat and
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

## 6. Open work
1. Test everything with a real headband; tune the stress weights and `TUNING` from real data.
2. Recording metadata (participant ID, condition, notes, synthetic flag) and the experiment protocols (calm, normal puzzle,
   timed puzzle, 0-10 rating): not built.
3. A review/compare page for saved recordings.
4. Split `muse-panel.html` (about 870 lines) into modules so UI and logic work stop colliding.
5. Save the game `finish` summary and the stress score alongside recordings; send them to Unity.
6. The Mario Kart files are unused but still in `game/`.
