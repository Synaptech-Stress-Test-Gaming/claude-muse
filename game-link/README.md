# Animal Stacker prototype

Run: `py stacker.py` (needs `py -m pip install pygame pymunk`).

Controls: SPACE / click drops the sprite, R resets, ESC quits, hold F for keyboard focus.

## Headband focus (Muse 2)

1. Start the game.
2. Open the Muse 2 control panel, connect the headband, and press Auto Set Baselines.
3. The panel's focus meter now drives the game's focus bar. The panel shows `GAME: LINKED`.

If no headband is linked, or the panel stops sending for 2 seconds, the F key works as before.
The link only listens on this computer (127.0.0.1, port 8765).
