# Focus correction: plan and status

Goal: make the focus score ignore muscle noise (jaw clench, frown) and, later, blinks and head movement, while still tracking attention. Beta over alpha is a proxy for focus, not a validated measure, and nothing here claims otherwise.

This file summarizes Plan v2 (muscle) and its blink/head-movement addendum, and records what is built. The full plan texts are kept outside the repo.

## Decisions already made
- The live score runs in `muse-panel.html` (JavaScript). The plan's Python `muse_focus.py` never existed. Calibration and analysis tools will be Python (NumPy and SciPy) reading the panel's recording CSVs.
- Raw 256 Hz data is available, so the plan's "band powers only" stop condition does not apply.
- One calibration session for now. Headband-repositioning transfer is "not evaluated".
- Maximum hold: 3 seconds.
- New CSV columns were added; no existing column or status name was renamed.
- Third switch option (Gate-only) approved.

## Muscle correction (Plan v2)
Per forehead channel, in linear power: `excess = max(emg - emg_rest - margin, 0)` and `beta_neural = beta - gain * excess`, with `emg` taken from 30 to 40 Hz. When there is no excess, Corrected equals the uncorrected score.

| Item | Status |
|---|---|
| Single-PSD feature extractor (256-point Hann periodogram, 1 Hz bins) | Done (in the panel) |
| Ordered gate: gap, blink, hold-off, heavy muscle, corrected, ok; `valid`; 3 s max hold | Done |
| Pipeline fingerprint check; panel refuses a mismatched `calibration.json` | Done |
| Legacy / Corrected / Gate-only switch, all computed continuously, both scores recorded | Done |
| Logic tested on synthetic signals in Node (not validation) | Done |
| Golden legacy test against a real recording | Waiting on a recording |
| Quick in-panel muscle calibration (CAL button: 20 s rest + 3 clenches, Theil-Sen gain, refuses poor fits) | Done (tested on synthetic data only) |
| Cue prompter, `CALIBRATION.md`, `calibrate.py` (leave-one-repetition-out fit, fingerprint, `calibration.json`) | Not started |
| Baseline leakage report, three-arm comparison, validation report (criteria 1-9) | Waiting on a recording |

Stop rule: if Gate-only already meets the leakage target with acceptable gaps, recommend not shipping the subtraction.

## Blink and head-movement correction (addendum)
Optional and separately tested. Adds `corrected_blink`, a `corrections` list, `low_excess_ratio` and `alpha_removed_frac`. It subtracts alpha and beta power in proportion to the coinciding delta+theta excess, only for sudden blink-shaped events; slow rises (drowsiness) and eyes-closed alpha must not be touched; blink with muscle is rejected as ambiguous.

**Status: not started.** It is gated on data: it ships only if the Gate-only arm keeps fewer than about 80% of task windows valid, the fitted gains survive cross-validation, and criteria 10-15 pass. The peak-to-peak and low-power limits must be set from the recorded blink segments, not from the old 100 microvolt / 3x defaults. Still to ask you (Phase 0): how much extra valid data would make it worthwhile (suggested: at least 10 percentage points).

The panel switch stays the same; there are no separate blink or muscle toggles (code flags only).

## Known gaps in the panel today
- No gyro or accelerometer gate (the panel does not read them yet).
- The blink gate is a simple peak-to-peak limit taken from the calibration file, not a delta/theta detector.
- Clean-look layout of the new switch was not checked visually.
