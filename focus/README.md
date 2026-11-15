# focus/: the display switch (FOCUS / STRESS / DROWSY, NEW / LEGACY)

Loaded by `muse-panel.html`; keep this folder next to it.

| File | What it does |
|---|---|
| `focus-switch.js` | The **FOCUS / STRESS / DROWSY** buttons (DROWSY only with the Cyton in New mode) and the **NEW / LEGACY** engine switch (`engMode`, remembered in `muse2panel.engine`; `?engine=` overrides). **New** shows `EngineOut[metric].value` from the new engine (`engine/`), with a state chip (LIVE, HELD · reason, LEARNING, `--`) and a short note; no calibration exists in New mode. **Legacy** keeps today's behaviour unchanged: FOCUS = `pctOf(focus)` with the 10 second **Auto Set Baselines** (remembered in `muse2panel.baselines`; on the Cyton `muse2panel.baselines.cyton`), STRESS = 100 - focus, and the movement HELD badge from `panel/motion.js`. |
| `focus-switch.css` | Styles for the buttons and badge in the cosmic, clean and neon looks; hides the Legacy stress card unless the address has `?stress=1`. |

External games and the game menu receive the focus number of the selected engine (New: the engine focus or `null`; Legacy: as before). None of these numbers is a validated measure; New scores are relative to your own usual level (50 = usual for you).

## experimental/ (not loaded)

The parked muscle-corrected focus score (Corrected and Gate-only modes, a 20 second muscle calibration) lives in [experimental/](experimental/). It is not loaded by the panel; `node focus/experimental/focus.test.js` still runs its tests. It was superseded by the new engine (`engine/`, see `docs/DETAILED_README.md`); `docs/focus-correction-plan.md` keeps its history.
