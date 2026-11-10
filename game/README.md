# Mario Kart game (focus-controlled)

A Mario Kart DS style race on **Figure-8 Circuit** that you play from inside the Muse 2 panel. Your **focus score** controls how fast your kart goes: stay focused and you speed up, lose focus and you slow down.

It is a private, non-commercial fan recreation made for a student project. All art (karts, characters, track) is drawn in code; no Nintendo files are used. It is a look-alike, not the real game.

## How to play

1. Open the panel (see the main [README](../README.md)), connect your Muse 2 (or use `muse-panel.html?demo=1` for simulated data).
2. Press **Auto Set Baselines** and spend 10 seconds going from relaxed to concentrating.
3. The red **M** button at the bottom right unlocks. Press it.
4. Race 3 laps against 7 computer racers. You are Mario and you start in 8th.

Exit with **Esc** or the EXIT button. Leaving the game does not disconnect the headband or erase your baselines.

### Controls

| Key | Action |
|---|---|
| Arrow keys or WASD | Steer and accelerate (down or S brakes, then reverses) |
| Shift (or Z) | Hold to drift, release for a mini-turbo |
| Space (or X) | Use item (hold down and press Space to throw it behind) |
| Esc | Exit to the panel |
| Enter | Leave the results screen |

## How focus changes your speed

```
speed multiplier = 0.5 + focus / 100
```

| Focus | Multiplier |
|---|---|
| 0 | 0.5x |
| 50 | 1.0x |
| 100 | 1.5x |

- It applies to your kart's **top speed and acceleration**. The computer racers are not affected, so at 50 focus the race is even.
- The multiplier eases toward the new value over about a second, so a noisy reading does not make the kart jerk around.
- **Boosts keep their own strength.** Mushrooms, mini-turbos, stars, the rocket start and Bullet Bill add the same amount at any focus.
- If the focus signal drops, the game holds the last multiplier and shows a warning until the signal comes back.
- The top bar shows the four sensor lights, your focus score and the current multiplier.

## What is in the game

- **Racers**: Mario (you), Peach, Luigi, Yoshi, Toad, Donkey Kong, Wario, Bowser.
- **Race flow**: 3-2-1 countdown, **rocket start** (tap accelerate just before GO; holding it much too early gives a burnout), 3 laps, results screen with Grand Prix points (10, 8, 6, 4, 3, 2, 1, 0).
- **Drifting**: hold Shift while steering. Charging shows blue, then orange, then purple sparks. Letting go gives a mini-turbo of that stage.
- **Items**: 17 items from the DS game: Green, Red and Triple shells, Banana and Triple Bananas, Fake Item Box, Mushroom, Triple Mushrooms, Golden Mushroom, Bob-omb, Spiny Shell, Thunderbolt, Blooper, Boo, Star, Bullet Bill. Which item you get depends on your place, using the real MKDS Grand Prix odds table (from the Super Mario Wiki).
- **Coins**: each one (up to 10) nudges your top speed up a little.
- **Computer racers** follow the racing line, drift, use items, and are slowed or helped slightly depending on how far ahead or behind you they are (rubber banding).
- **Display**: Mode-7 style ground plane at 320x240, scaled up with crisp pixels, DS-style HUD and a minimap. Small synthesized sound effects, no audio files.

## Files

| File | What it is |
|---|---|
| `mkds.js` | The race engine: track, physics, drifting, items, AI, scoring. No browser code, so it also runs in Node |
| `mkds-render.js` | Drawing, HUD, keyboard input, sound and the overlay inside the panel |
| `mkds.test.js` | 44 automatic checks for the engine |

The panel loads both scripts from `muse-panel.html`. Keep the `game` folder next to that file.

### Run the tests

You need Node.js. From the repo folder:

```
node game/mkds.test.js
```

The tests use a fixed time step and a seeded random generator, so results repeat exactly. They check, among other things, top speed and acceleration at focus 0, 50 and 100, that boosts are not scaled by focus, wall and grass behavior, lap counting, drift stages, the rocket start and every item.

### Using the engine yourself

```js
const M = require("./game/mkds.js");
const race = M.createRace({ seed: 1 });
race.setFocus(75);                       // 0 to 100, null is ignored (holds last value)
race.step({ steer: 0, accel: true });    // one 1/60 s step; also drift, brake, item, back
race.player.v                            // the player's speed
```

## What is not exact

This is built from public descriptions of Mario Kart DS, not from the game's files.

- Characters, karts and the track are my own drawings, so they only resemble the originals.
- Physics numbers, mini-turbo timings (3 stages here) and the computer racers' behavior are approximations.
- The real Figure-8 Circuit crosses itself on a bridge. Here the crossing is flat.
- The item odds are the real table; everything else is a best guess.

## Testing status

Checked with the panel's **simulated** Muse data (`?demo=1`), driving whole races in the browser, plus the automatic tests. It has **not** yet been run against a real headband by anyone. If the speed does not feel like it follows your focus, check the panel's focus meter first and redo the baselines.

## Legal

Mario Kart, Mario and the other characters belong to Nintendo. This is an unofficial fan project for private, non-commercial use. Do not sell it or distribute it widely without checking the rules first.
