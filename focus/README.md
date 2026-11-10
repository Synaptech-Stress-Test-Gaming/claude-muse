# focus/: focus or stress display

Loaded by `muse-panel.html`; keep this folder next to it.

| File | What it does |
|---|---|
| `focus-switch.js` | The **FOCUS / STRESS** buttons. FOCUS shows the focus meter, STRESS shows `100 - focus` (focus 100 = stress 0, focus 0 = stress 100), using the same baselines. Remembers your choice, and remembers the low/high baselines from the 10 second **Auto Set Baselines** so they are there next time. Also draws the "HELD" badge when the movement gate (`panel/motion.js`) is holding the value. |
| `focus-switch.css` | Styles for the buttons and badge (cosmic, clean and neon looks), and hides the stress card unless the address has `?stress=1`. |

External games and the game menu always receive the focus number; only the panel display changes. Both numbers are rough proxies, not validated measures.

## experimental/ (not loaded)

The muscle-corrected focus score (Corrected and Gate-only modes, a 20 second muscle calibration, extra recording columns) lives in [experimental/](experimental/). It was removed from the interface because its calibration was not reliable. It is not loaded by the panel. `node focus/experimental/focus.test.js` still runs its tests. See `docs/focus-correction-plan.md` for the plan behind it.
