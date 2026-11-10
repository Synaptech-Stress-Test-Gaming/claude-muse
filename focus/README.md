# focus/: muscle-corrected focus scores

The code behind the **LEGACY / CORRECTED / GATE-ONLY** buttons in `muse-panel.html`. The panel itself only wires these files in, the same way it loads the `game/` folder. Keep the `focus` folder next to `muse-panel.html`. The scripts are plain browser scripts that share the panel's globals; the load order is set in `muse-panel.html` (see `panel/README.md`): `focus-recording.js` before `panel/dsp.js`, the other three after `panel/focus.js`.

Corrected and Gate-only are **proxies, not validated focus measures**. Beta over alpha is itself only a rough stand-in for attention.

## Files

| File | What it does |
|---|---|
| `focus-engine.js` | The scoring. Takes the last 256 readings (1 second) of each forehead sensor every 250 ms, makes one Hann-windowed spectrum per sensor, and reads alpha (8-13 Hz), beta (13-30 Hz) and muscle noise (30-40 Hz) power. Runs the window decision order and computes the Corrected and Gate-only scores, each with its own smoothing. Also checks `calibration.json` data and its settings fingerprint. |
| `focus-calibration.js` | The **CALIBRATE** button: a 20 second guided calibration (8 s relaxed, then twice 4 s of clenching the jaw and scrunching the forehead). Per forehead sensor with skin contact it measures resting levels and fits how much muscle noise raises beta (Theil-Sen), refuses a poor fit with a reason, and stores the result in the browser. Shift-click CALIBRATE loads a `calibration.json` file instead. |
| `focus-switch.js` | Which score is shown: remembers your choice, disables Corrected and Gate-only (and says why) until a valid calibration exists, draws the status badge, and sets the score that feeds the number, the bar, the floating meter and the game. |
| `focus-switch.css` | Styles for the switch and the status badge (cosmic and clean looks). |
| `focus-recording.js` | The extra recording columns, appended after the panel's original ones. |
| `focus.test.js` | Run with `node focus/focus.test.js`. Implementation tests on synthetic signals (they show the code does what it is meant to, not that the score measures focus). |

## The three scores

- **Legacy**: the original `ln(beta / alpha)`. Its code is untouched and stays in `muse-panel.html`.
- **Corrected**: per forehead sensor, `excess = max(muscle - resting muscle - margin, 0)` and `beta_neural = beta - gain * excess`. Then `ln(mean beta_neural) - ln(mean alpha)` over the sensors in use. With no excess muscle it equals Gate-only exactly.
- **Gate-only**: same measurements and same throw-away rules, no subtraction, and a simple 3x limit on muscle noise.

All three run all the time, so switching is instant. The switch changes only what is displayed; the recording always holds all three.

## Window status

The first matching rule wins. Rejected windows are drawn as gaps (`--`), never as a held value.

1. `no_contact`: no forehead sensor has skin contact (sensor percentage under 40)
2. `rejected_gap`: a data packet was lost inside the window
3. `rejected_blink`: peak-to-peak swing above the calibrated limit; starts a 0.5 s hold-off
4. `holdoff`: still inside that 0.5 s
5. `rejected_emg_heavy`: too much muscle noise to correct
6. `corrected_emg`: muscle noise found and subtracted (valid; Corrected only)
7. `ok`: nothing to fix (valid)

After 3 seconds without a valid window the recorded smoothed value goes blank.

## Recording columns (appended after the original 14, nothing renamed)

`focus_corrected_raw_ln`, `focus_corrected_ema_ln`, `focus_corrected_0_to_100`, `corrected_status`, `corrected_valid`, `corrected_emg_ratio`, `corrected_beta_removed_frac`, `focus_displayed`, `focus_legacy_raw_ln`, `focus_gateonly_raw_ln`, `focus_gateonly_ema_ln`, `focus_gateonly_0_to_100`, `gateonly_status`, `gateonly_valid`.

The original `focus_index_ln_beta_over_alpha` and `focus_0_to_100` columns always hold the Legacy score, whichever score is displayed.

## Calibration data format and fingerprint

Version 1 JSON: `channels`, per-channel `rest` (`emg`, `alpha`, `beta`, `margin`) and `gains`, plus `T_heavy`, `T_gate_only`, `floor`, `max_removed_frac`, `max_hold_s`, `p2p_limit_uV` and `fingerprint`. The fingerprint (`PIPE_FP` in `focus-engine.js`) spells out window length, hop, taper, spectrum scaling, offset filter, sensors, averaging, log base and band edges. A calibration made with different settings is refused, never applied with a warning.

## Known limits

- The quick calibration is simpler than the full plan in `docs/focus-correction-plan.md`: no cross-validation, no frown or blink segments, one session.
- No gyro or accelerometer gate yet; the blink gate is a peak-to-peak limit set from your clenches.
- Neural beta can change during real motor activity, so subtraction can remove some genuine signal.
- Gating removes the moments when people frown or clench while concentrating, so surviving scores lean toward relaxed states.
- Recalibrate when the headband position changes.
- Blink and head-movement correction (the plan's addendum) is not built.
