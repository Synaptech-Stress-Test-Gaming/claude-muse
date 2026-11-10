# Bomb defusal game (prototype)

One-level bomb defusal game in the browser, with a hand-drawn look inspired by cooperative bomb-defusal games.
All art is drawn in code. Open it from the panel with the red **B** button, or on its own: `game/bomb.html`.

## Play
Solve three modules before the 3:00 clock ends or you get 3 strikes. Everything you need is in the in-game
**Manual (M)**: wires (cut by the serial number and colours), the big button (tap or hold, release on a clock digit),
and the symbol keypad (press the symbols in column order). Esc exits.

## Two modes (top bar button)
| Mode | Focus comes from | Use it for |
|---|---|---|
| **Live (Muse)** | the panel's focus meter | real play with the headband (needs baselines set) |
| **Manual test** | an on-screen slider (0 = very stressed, 50+ = calm) and a "no reading" checkbox | testing without a headband |

The end screen says which mode a run used. Manual-test runs are not real data.

## What stress does
`stress = clamp((50 - focus) / 50)`: calm at focus 50 or more, full stress at 0. Stress is smoothed over 1 s, then:
- **Hand tremor**: your pointer jitters up to 16 px, so small targets are harder to hit.
- **Clock speed**: up to x1.6 (plus x0.25 per strike).
- **Display glitches** above 55% stress (the clock flickers, no state changes).
With no focus reading the game runs calm. All numbers are in `TUNING` in `bomb-logic.js`.
The focus score is an experimental beta/alpha index, not a validated stress measure.

## Connecting your own signal
```js
BombUI.open({
  mode: "live",                 // or "test"
  focus: () => 0..100 | null,   // required for live mode
  stress: () => 0..1 | null,    // optional: overrides the focus mapping (for a future stress algorithm)
  status: () => "text for the top bar",
  seed: 42,                     // optional: repeatable bomb
  onEvent: (type, data) => {},  // start, mode, strike, module_solved, defused, explode, finish
  onClose: () => {}
});
```
Events are also fired on `window` as `bomb:event` (`detail = {type, data}`). The `finish` event carries a summary
(result, time played, strikes, average stress, seconds under high stress, average focus, event log).

## Files
`bomb-logic.js` rules, level generation, stress mapping (no DOM) · `bomb.js` view and input ·
`bomb.html` standalone page · `bomb.test.js` rule tests (`node game/bomb.test.js`, or open `game/bomb-test.html`).
The Mario Kart files are still in the repo but the panel no longer loads them.
