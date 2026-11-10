# Mario Kart (Python version)

The same Mario Kart DS style race as the browser game in [../game](../game/README.md), ported to **Python + pygame**. Your **Muse 2 focus score** sets your kart's speed: `multiplier = 0.5 + focus / 100` (0 focus = 0.5x, 50 = 1x, 100 = 1.5x), applied to your top speed and acceleration only. Boosts keep their own strength.

Private, non-commercial fan recreation. All art is drawn in code; no Nintendo files are used. Mario, the other characters and the game belong to Nintendo.

## Run it

You need Python 3.10+ on Windows.

```
py -m pip install -r requirements.txt
py mario_kart.py
```

Or double-click **Run Mario Kart.bat** (it installs the packages first).

1. Start the game. It shows "Waiting for the Muse 2 panel...".
2. Open the Muse 2 panel (`Open Muse Panel.bat` in the main folder), press **Connect**, then **Auto Set Baselines** and go from relaxed to concentrating for 10 seconds.
3. The race starts by itself once your focus score is live. The panel shows `GAME: LINKED`.

The game listens on `127.0.0.1:8765` (this computer only), the same link the Animal Stacker prototype uses. Do not run both at once.

**No headband?** `py mario_kart.py --keyboard-focus` skips the headband. Press `[` and `]` to lower and raise your focus in steps of 10.

If the focus signal drops mid-race, the last multiplier is held and a warning shows.

## Controls

| Key | Action |
|---|---|
| Arrow keys / WASD | Steer and accelerate (down or S brakes) |
| Shift (or Z) | Hold to drift, release for a mini-turbo (blue, orange, purple) |
| Space (or X) | Use item (hold down and press Space to throw behind) |
| Enter | Play again from the results screen |
| Esc | Quit |

The top bar shows the four sensor lights (percentages from the panel), your focus score and the speed multiplier.

## What is in it

Mario plus Peach, Luigi, Yoshi, Toad, Donkey Kong, Wario and Bowser; 3 laps of Figure-8 Circuit; countdown, rocket start, drifting with 3 mini-turbo stages; 17 items using the real MKDS Grand Prix odds by place; coins; computer racers that drift, use items and rubber-band; results with Grand Prix points.

## Files

| File | What it is |
|---|---|
| `mario_kart.py` | pygame window, Mode-7 style floor (numpy), sprites, HUD, input |
| `mkds.py` | Race engine: track, physics, items, AI, scoring (no pygame, runs anywhere) |
| `link.py` | Receives focus and sensor percentages from the panel |
| `test_mkds.py` | 40 automatic checks, including that this engine matches the JavaScript engine exactly |
| `requirements.txt`, `Run Mario Kart.bat` | Setup and launcher |

Run the tests: `py test_mkds.py` (needs Node.js only for the match-the-JavaScript check, which is skipped without it).

## What is not exact

Built from public descriptions of Mario Kart DS, not its files. Characters, karts and track are my own drawings; physics numbers, mini-turbo timings and the AI are approximations; the real crossing is a bridge and here it is flat. The item odds are the real table.

## Testing status

Tested with simulated focus (keyboard mode and scripted link messages) and full automated races. **Not yet run against a real headband.** The panel was changed slightly to also send the four sensor percentages (older games ignore them).
