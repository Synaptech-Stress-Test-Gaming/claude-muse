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
| `dsp.js` | **signal path** | packet alignment, offset removal, band filtering, contact quality (**blink / head-movement filter goes here**) | signal |
| `ble.js` | **data in** | Muse Bluetooth connect/retry, battery, simulated headband (`?demo=1`) | hardware |
| `focus.js` | **focus meter** | focus score, baselines, floating meter | focus |
| `recording.js` | **recording** | record, report, CSV | recording |
| `gamelink.js` | **games** | hands live signals to the game menu; feeds external games | games |
| `main.js` | start-up | wiring, must load last | rarely |
| `motion.js` | signal | head movement from the accelerometer (`motionLevel()`) | signal |
| `arousal-link.js` | **arousal meter** | reads heart rate, forehead tension and movement for `../arousal.js`; draws the AROUSAL box and its details window | arousal |
| `guide.js` | **UI** | the setup guide overlay | UI |
| `stress-link.js` | legacy | old stress-meter glue, no longer loaded | - |

Not in this folder (already separate): `../stress.js` (stress meter), `../game/*` (games and the game menu).

Load order: `game/bomb-logic.js`, `game/bomb.js`, `game/menu.js`, then `core, pulse, ui, dsp, ble, focus, recording, gamelink, main`, then `arousal.js`, `arousal-link.js`, `guide.js` (`motion.js` loads right after `pulse.js`).

## Where the old `muse-panel.html` sections went
constants + state -> `core.js` · pulse (heart rate) -> `pulse.js` · build UI on the stage + drawing -> `ui.js` · stream handling -> `dsp.js` ·
Muse protocol + simulated headband -> `ble.js` · recording -> `recording.js` · focus + floating focus meter -> `focus.js` ·
game menu + game link -> `gamelink.js` · wiring -> `main.js` · the stress-meter script at the bottom -> `stress-link.js` · `<style>` -> `ui.css`.
The code itself was moved, not rewritten (no behaviour change). If you have unmerged changes to the old single file, move each changed block into the file above.

## Rules of thumb
- One category per change: if a change needs edits in two files, check it is really needed.
- Do not add new top-level names that clash with another file's (all files share one scope).
- New game: register it in `../game/menu.js`, not here. New stress signal: `../stress.js` and `stress-link.js`.
