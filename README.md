# claude-muse: Muse 2 Control Panel

A single-page control panel that shows the live brainwave data from a **Muse 2** headband, turns it into a 0 to 100 **focus score**, and lets other programs (games) use that score. It runs in the browser, talks to the headband over Bluetooth, and needs no installs and no accounts.

This README covers the panel and the project files. The games have their own READMEs:

- [game/README.md](game/README.md): Mario Kart DS style race whose speed follows your focus (opens from the panel)
- [game-py/README.md](game-py/README.md): the same Mario Kart game ported to Python (pygame), fed by the panel's focus score
- [game-link/README.md](game-link/README.md): the earlier Animal Stacker prototype that can read the focus score

## What you need

- A **Muse 2** headband, charged, with Bluetooth turned on in your computer
- **Windows** with **Microsoft Edge** or **Google Chrome** (the panel uses Web Bluetooth, which Firefox and Safari do not support)
- The Muse phone app **closed** while you use the panel, because the app can grab the headband first

## How to start it

1. Download or clone this repo and keep every file together (the panel needs `cosmic-bg.jpg` and the `game` folder next to it).
2. Double-click **Open Muse Panel.bat**. It opens the panel in its own Edge window with the Bluetooth features turned on.
3. Put the headband on, press **Connect**, and pick your Muse when the browser asks.

No headband? Open `muse-panel.html?demo=1` (add `?demo=1` to the address) and press Connect to get simulated data.

## What you see

- **Status lamp and battery** at the top, plus a signal-quality light and percentage for each of the four sensors (TP9 and TP10 behind the ears, AF7 and AF8 on the forehead).
- **Five wave rows**: delta, theta, alpha, beta, gamma. Each row has a live line, a **Strength** slider (turns the drawing down) and a **Mute** button. These only change what is drawn, never the numbers underneath.
- **Heart rate** from the headband's pulse sensor, when it is sending data.
- **Focus meter** (0 to 100) along the bottom.
- **Buttons**: Connect, Disconnect, Start Recording, Stop Recording, Band view, Raw view, Float focus, Fullscreen, and the red **M** game button.

## How the focus score works

1. The panel measures how strong **beta** waves (13 to 30 Hz) are compared with **alpha** waves (8 to 13 Hz) and takes the natural log of the ratio: `F = ln(beta / alpha)`. It smooths this over about 3 seconds.
2. Everyone's brain is different, so the panel needs your own range. Press **Auto Set Baselines** and spend 10 seconds drifting from relaxed to concentrating. It throws out blinks and jaw clenches, then uses the 10th and 90th percentile of what is left as your low and high baselines. You never type numbers in.
3. The score is `25 + 50 x (F - low) / (high - low)`, held between 0 and 100. Your relaxed baseline lands on 25 and your concentrating baseline on 75.

Baselines are kept only while the panel is open. Clenching your jaw or forehead muscles fakes a high reading, so stay relaxed in the face.

## Accuracy rules

- Every reading comes straight from the headband, converted to microvolts, with only the constant offset removed.
- Lost packets are not filled in or smoothed over. The panel shows a "% lost" figure instead.
- **Raw view** shows the four sensors unfiltered on a fixed scale of 200 microvolts either way, so it can never look exaggerated.
- The first 2 seconds after connecting are not shown while the offset removal settles.
- If no sensor has skin contact, the panel says so instead of drawing a line.

## Recording

**Start Recording** keeps every reading; **Stop Recording** shows a report and downloads a CSV to your Downloads folder. Recordings stop by themselves at 10 minutes.

CSV columns: `time_s, TP9, AF7, AF8, TP10` (microvolts), the five band signals, `sensors_in_use`, the raw focus index and the focus score 0 to 100, then heart-rate columns. There is one row per reading, 256 rows per second, and dropped readings stay as gaps in `time_s`. The report also lists signal levels per sensor and wave type and how long focus stayed above 50 and 75. Nothing is saved unless you press Stop.

## Other features

- **Float focus**: a small always-on-top window with only the focus meter. Minimize the panel (do not close it) and the meter stays on screen.
- **Auto reconnect**: if the link drops the panel retries three times by itself, then shows a plain step-by-step message.
- **Fullscreen**: the stage scales to any window and keeps its 16:9 shape.
- **Game link**: the panel sends the focus score to a program on your own computer (`127.0.0.1` port 8765). Nothing leaves your machine. The label near the focus meter shows `GAME: LINKED` when something is listening.

## If it will not connect

1. Close the Muse app on any phone or tablet.
2. In Windows Settings, Bluetooth and devices, remove "Muse" if it is listed.
3. Turn the headband off, then on again.
4. Press Connect.

## Files

| File | What it is |
|---|---|
| `muse-panel.html` | The whole panel (page, styling, Bluetooth, signal processing, focus meter) |
| `Open Muse Panel.bat` | Launches the panel in Edge with Web Bluetooth switched on |
| `cosmic-bg.jpg` | The artwork behind the panel. Keep it next to `muse-panel.html` |
| `game/` | The Mario Kart game (see its README) |
| `game-py/` | The Python version of the Mario Kart game (see its README) |
| `game-link/` | The Animal Stacker prototype (see its README) |
| `Claude outputs/` | An earlier copy of the panel kept for reference |
| `PLAN.md` | Running plan and change log for the panel and game |
| `muse2-panel-requirements.md` | The original requirements (a few have since changed, for example recording now saves a CSV) |
| `CLAUDE.md` | Working instructions for the AI assistant used on this project |

## About this project

Built with Claude Code as a student project. The panel reads the Muse 2's standard Bluetooth data and does all the maths in your browser.
