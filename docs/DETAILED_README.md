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

## 4. Bomb game (`game/`)
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

## 5. Tests and what was verified
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

## 6. Open work
1. Test everything with a real headband; tune the stress weights and `TUNING` from real data.
2. Recording metadata (participant ID, condition, notes, synthetic flag) and the experiment protocols (calm, normal puzzle,
   timed puzzle, 0-10 rating): not built.
3. A review/compare page for saved recordings.
4. Split `muse-panel.html` (about 870 lines) into modules so UI and logic work stop colliding.
5. Save the game `finish` summary and the stress score alongside recordings; send them to Unity.
6. The Mario Kart files are unused but still in `game/`.

## 7. Stress meter v2: what changed and why (research notes)
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

## 8. Merging with Julian's branch (plan)
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

## 9. Merge log
- 2026-11-09: merged `origin/main` (Julian's commits 4fdd4b3 and 714effa: Python/pygame port of the Mario Kart game in `game-py/`, the panel now also
  sends the four sensor percentages to the game link, `.gitignore` for Python caches) into `feat/experiment-protocols`. No conflicts. The panel still
  posts the focus score to `127.0.0.1:8765`, so `game-py` keeps working; our **B** button replaced the Mario Kart launcher inside the panel only.
  No blink/head-movement filter was in that update yet; when it lands, see section 8 for the four callbacks to re-check.

## 10. Game menu (adding games)
The panel's round button opens a menu (`game/menu.js`). Games register there with one call (see the comment at the top of that file):
`GameMenu.register({id, title, blurb, input, kind, scripts, needs, launch, howto})`. Built in: **Defuse** (stress), **Mario Kart (browser)** (focus, lazy-loaded,
needs focus baselines), **Mario Kart (Python)** and **Animal Stacker** (external apps, shown with how to run them). A game gets a `ctx` with `stage`,
`connected`, `focusReady`, `stressLive`, `focus()`, `stress()` (0..1), `sensors()` and `status()`.

## 11. Panel split (2026-11-09)
`muse-panel.html` was split into `panel/*.js` + `panel/ui.css` by category (UI, signal path, Bluetooth, focus meter, recording, games, stress link): see `panel/README.md`
for the table and the mapping from the old single file. Code was moved, not rewritten. The "edits to `muse-panel.html`" in section 8 now live in
`panel/gamelink.js` (game menu hookup), `panel/ble.js` (`demoGamma`) and `panel/stress-link.js` (stress glue). The game button is now a small "Games" button
in the right-hand button column (same style as Band view / Raw view / Float focus / Fullscreen).

## 12. v3 (2026-11-10/11): arousal meter, panel usability, new game manual
Branch `improve/arousal-ui-manual`. **Why:** the stress card covered a third of the panel and showed nothing until a two-step calibration, and
teammates' research (confirmed, see `docs/RESEARCH_AROUSAL.md`) says a headband cannot measure stress itself.
- **Arousal replaces "stress"** (`arousal.js`, `panel/arousal-link.js`, `panel/motion.js`): heart rate + forehead/jaw muscle tension + head movement,
  each compared with a resting value measured automatically in the first 15 s (`?rest=N`). No manual calibration. Score updates 4x/s:
  `0.6 * weighted mean + 0.4 * strongest signal` (weights 0.5 / 0.3 / 0.2), with a noise floor from the rest period. Works with whatever signals exist.
  It sits in the panel under the heart rate (click it for details, a 60 s graph, per-signal bars and "measure my rest again").
  `ArousalMeter.value()` (0-100 or null); `StressMeter` is kept as an alias. `stress.js` is kept in the repo as legacy and is no longer loaded.
- **Accelerometer** (`273e000a`) is subscribed in `panel/ble.js` inside a try/catch. **Never run on real hardware yet.**
- **Recording** has a new last column `arousal_0_to_100`. The game link also sends `arousal`.
- **Setup guide** (`panel/guide.js`, Guide button, opens on first visit): connect, fit, baselines, play, each with a live check. `?guide=0` hides it.
- **Mac help text** on connection failure; **`tools/serve.py`** serves without caching (the Mac launcher uses it) so a reload always shows new code.
- **Game manual redone:** a clipboard that always lies on the table to the right of the bomb (never covers it, no scrolling), three tabs
  (WIRES / BUTTON / KEYPAD, keys 1-3), numbered "first line that fits" rules with pictures and short labels, a tick on solved tabs. Sweat still lands on
  it; drag the cloth over a wet blot to remove it, a blot left to dry becomes a stain. The sheet trembles only slightly so it stays readable.
- **Briefing screen** before the clock starts (Enter to start). Wording in the game is "arousal" throughout.
- Tests: `arousal.test.js` (23 checks) plus the existing `game/bomb.test.js` (24). `stress.test.js` (34) still passes for the legacy file. (Earlier sections over-counted each file by one.)
- **Not verified:** everything on a real Muse 2, especially the accelerometer packets, real heart-rate quality, and whether the thresholds feel right.
