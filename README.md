# claude-muse

Muse 2 control panel plus a Mario Kart DS style game driven by the focus meter.

- `muse-panel.html` : live Muse 2 panel (Web Bluetooth). Open with `Open Muse Panel.bat`. Keep `cosmic-bg.jpg` and `game/` next to it.
- `game/` : Mario Kart game (engine `mkds.js`, renderer `mkds-render.js`, tests `mkds.test.js`). Run tests: `node game/mkds.test.js`.
- `game-link/` : earlier Stacker game link and headband focus patch.
- `PLAN.md`, `muse2-panel-requirements.md`, `CLAUDE.md` : plans, requirements and agent instructions.

The red M button unlocks after focus baselines are set. Speed multiplier = 0.5 + focus/100.
Fan recreation for private, non-commercial use; art is drawn in code.
