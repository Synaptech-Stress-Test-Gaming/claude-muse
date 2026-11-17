# focus/experimental/: parked, not loaded

Muscle-corrected focus (Corrected and Gate-only scores), its quick calibration and the extra recording columns. Taken out of the panel's interface because the calibration was not reliable. Nothing in `muse-panel.html` loads these files.

- `focus-engine.js`: scoring, window decision order, calibration check
- `focus-calibration.js`: the 20 second guided calibration
- `focus-recording.js`: the extra CSV columns
- `focus.test.js`: `node focus/experimental/focus.test.js`

To bring it back it would need its buttons, script tags and recording hooks wired in again (see git history before the "simplify" commit) and a calibration that works on real headband data.
