# panel/: the control panel, split by category

`muse-panel.html` is now only the page markup (the stage and its elements) and the list of script tags. Everything else lives here, one file per
category, so people can change their category without touching the others. All files are classic scripts that share one global scope; the load
order is set in `muse-panel.html` and matters.

| File | Category | What is in it | Who typically edits |
|---|---|---|---|
| `ui.css` | **UI look** | all styling | UI |
| `ui.js` | **UI** | builds the stage, toasts, status lamp, buttons, view switch, canvas drawing | UI |
| `core.js` | shared | constants, `S` (shared state), `?demo=1`, band filters | rarely |
| `pulse.js` | signal | heart-rate estimate from the pulse sensor | signal |
| `motion.js` | signal | accelerometer/gyro motion gate: pauses focus while the head moves (test: `node panel/motion.test.js`) | signal |
| `dsp.js` | **signal path** | packet alignment, offset removal, band filtering, contact quality (**blink / head-movement filter goes here**) | signal |
| `ble.js` | **data in** | Muse Bluetooth connect/retry, battery, simulated headband (`?demo=1`) | hardware |
| `focus.js` | **focus meter** | focus score, baselines, floating meter | focus |
| `recording.js` | **recording** | record, report, CSV | recording |
| `gamelink.js` | **games** | hands live signals to the game menu; feeds external games | games |
| `main.js` | start-up | wiring, must load last | rarely |
| `stress-link.js` | **stress meter** (Legacy arousal model, see `../arousal.js`) | hands `../stress.js` the panel's signals | stress |
| `engine-link.js` | **new engine glue** | Muse / Cyton connect dispatch (`engConnect`), the tap functions called from `dsp.js`/`pulse.js`/`motion.js`, frames -> `MuseEngine.create`, `window.EngineOut`, the Cyton display and Legacy focus on the Cyton, identity tick/cross | engine |
| `engine-ui.js`, `engine-ui.css` | **new engine UI** | MUSE/CYTON switch, NEW/LEGACY switch, profile panel, engine card, Cyton card, help with the honest limits, button flashes, three looks | UI |
| `engine-rec.js` | **recording** | the 6 `eng_*` CSV columns (appended) and the v2 recorder (4 files) for the Cyton and the validation protocol | recording |
| `validation.js` | **validation** | the guided validation protocol (`?validate=1`) | engine |

Not in this folder (already separate): `../stress.js` (stress meter), `../game/*` (games and the game menu), `../focus/*` (Legacy / Corrected / Gate-only focus scores, the CAL calibration and the extra recording columns; see `../focus/README.md`).

Load order: `game/bomb-logic.js`, `game/bomb.js`, `game/menu.js`, then `core, pulse, motion, ui, dsp, ble, focus`, `focus/focus-switch.js`, `recording, gamelink, main`, `arousal.js`, `stress.js`, `stress-link.js`, then the new engine (`engine/*.js` in pipeline order, `adapters/*.js`) and `engine-rec, engine-ui, engine-link, validation`. The four tap lines in `dsp.js`, `pulse.js` and `motion.js` test `typeof` at call time, so the engine loading last is fine.

Legacy and New run side by side: the Legacy maths here is unchanged (focus loop in `gamelink.js`, `pctOf` in `focus.js`); the NEW/LEGACY switch only picks which number is shown and sent. In Cyton mode the 1 s interval in `dsp.js` does not paint the Muse-only places (sensor tiles, rates, heart rate, motion line); `engine-ui.js` fills them.

## Where the old `muse-panel.html` sections went
constants + state -> `core.js` · pulse (heart rate) -> `pulse.js` · build UI on the stage + drawing -> `ui.js` · stream handling -> `dsp.js` ·
Muse protocol + simulated headband -> `ble.js` · recording -> `recording.js` · focus + floating focus meter -> `focus.js` ·
game menu + game link -> `gamelink.js` · wiring -> `main.js` · the stress-meter script at the bottom -> `stress-link.js` · `<style>` -> `ui.css`.
The code itself was moved, not rewritten (no behaviour change). If you have unmerged changes to the old single file, move each changed block into the file above.

## Rules of thumb
- One category per change: if a change needs edits in two files, check it is really needed.
- Do not add new top-level names that clash with another file's (all files share one scope).
- New game: register it in `../game/menu.js`, not here. New stress signal: `../stress.js` and `stress-link.js`.
