# Muse 2 Control Panel: Plan

Status: PLAN ONLY. Nothing has been built or installed.
Requirements live in `muse2-panel-requirements.md`.

## What you will get
One program you open with a double-click. It shows a navy and silver art deco control panel sized for your 14 inch screen, with large buttons that are easy to hit with a trackpad. It shows your Muse 2's raw brainwave data live, so you can test your game's input without any consumer app.

## What the screen looks like
- Top bar: a status lamp (searching, connected, lost), a battery gauge, and a signal quality light for each of the four sensors on the headband.
- Middle: five rows, one per wave type (delta, theta, alpha, beta, gamma). Each row has a live line, a large slider to turn it down, and a large mute button to switch it off.
- Bottom: four large buttons: Connect, Disconnect, Start Recording, Stop Recording.
- Style: navy background, silver linework, stepped and symmetrical art deco shapes, large readable lettering.

## How it behaves
- When you open it, it starts looking for your Muse 2 and connects on its own as soon as the headband is on. The panel needs to be open for this.
- If the connection drops, it reconnects without you touching anything.
- Disconnect stops the link until you press Connect again.
- Nothing is saved to your computer. Close the panel and the data is gone.
- Start Recording and Stop Recording (needs your OK, see Checkpoint): Start begins an on-screen session timer with a running count of the data received, and Stop ends it and shows a small summary. Nothing is stored.

## Steps, in order
1. Get your laptop and Muse 2 talking. There is one small setup step on your side, and I will give you exact click-by-click directions at that moment.
2. Prove the raw data is arriving: first live lines on screen, plain and unstyled.
3. Add signal quality and battery.
4. Add the five wave rows with sliders and mute buttons.
5. Apply the navy and silver art deco look and the large buttons.
6. Add auto-connect, auto-reconnect and the four bottom buttons.
7. Test with you wearing the headband, then fix what feels off.

## What I need from you along the way
- Muse 2 charged, and Bluetooth turned on on your laptop.
- The Muse phone app closed whenever you test, because it can grab the headband first.
- You wearing the headband for step 7. I cannot do that part.
- You pressing the one setup step in step 1. I cannot click things on your laptop for you, so I will make it as short as possible.

## Known risks
- Battery level and per-sensor signal quality need to be confirmed on your real headband before I promise them. If one is not available, I will tell you right away and replace it with the closest honest readout.
- Auto-connect only works while the panel is open.

## Checkpoint (your go-ahead needed before any building)
1. Are you OK with Start/Stop Recording being an on-screen session timer and summary only, since you do not want saving? If not, tell me what they should do or to remove them.
2. Say "go" and I will start at step 1.

## Added: Focus meter (0 to 100)
- Raw focus score: F = ln( beta power / alpha power ), smoothed over about 3 seconds.
- Meter: Focus = 100 x ( F - Low ) / ( High - Low ), held between 0 and 100.
- One button, Auto Set Baselines: records 10 seconds while you drift from relaxed to concentrating.
- Low and High are picked automatically: outliers are thrown out, then the 10th and 90th percentile of what is left become Low and High. You never pick them by hand.
- Big bursts of noise (blinks, jaw clenches) during the 10 seconds are ignored.
- Baselines are kept only while the panel is open. Nothing is saved.
- Strength sliders and mute buttons do not change the focus number.
- Watch out: clenching your jaw or forehead fakes a high reading.

## Added: Accuracy rules
- Every reading shown comes straight from the headband, converted to microvolts. Only the constant offset is removed.
- Nothing is filled in or smoothed over when a packet is lost. The panel skips it and shows a dropped percentage in the status line.
- Raw View shows the four sensors with no band filtering, on a fixed scale of 200 microvolts either way, so it can never look exaggerated.
- Band View shows each wave type with a labeled scale. The strength slider and mute change only what is drawn. The microvolt numbers and the focus meter always use the true signal.
- The first 2 seconds after connecting are not shown while the offset removal settles.
- If no sensor has skin contact, the panel says so instead of drawing a line.

## Added: Floating focus meter
- Float Focus opens a small always-on-top window with only the focus meter.
- Minimize the panel (do not close it) and the meter stays on screen. Closing the panel closes the meter too.

## Added: Visual update
- Alien spacecraft look from the ChatGPT picture: deep-space backdrop with planet and stars, glass panels with cyan corner trim, electric-blue waves, icons on the four main buttons, red warning banner for connection errors.

## Added: Connection help
- The panel now retries the link three times by itself and shows a plain step-by-step message if it still fails.

## Updated: Visual (UW Cosmic Console)
- The scene (moon, howling husky, UW W, crystals, orbital structures, platform, console frame) is the artwork from your reference picture, saved as `cosmic-bg.jpg` next to the panel. Keep it in the same folder as `muse-panel.html`.
- Everything that moves or changes is live on top of that artwork: status, battery, the four sensor percentages, the five wave windows, strength sliders, mute buttons, focus meter, baseline button and the four main buttons.
- The picture's made-up telemetry (temperature, latency, 48 kHz) and its decorative mode list were replaced with real readouts (sample rate, dropped %, sensors in use) and four working buttons: Band view, Raw view, Float focus, Fullscreen.
- Fullscreen on a 16:9 screen gives the closest match to the reference. The panel scales to any window size and keeps the 16:9 shape.

## Changed: Recording now saves (replaces "nothing is saved" above)
- Start Recording keeps every reading. Stop Recording shows a full report and downloads a CSV to your Downloads folder.
- CSV columns: time_s, TP9, AF7, AF8, TP10 (microvolts, offset removed), delta, theta, alpha, beta, gamma (band signals), sensors_in_use, focus index, focus 0 to 100. One row per reading, 256 rows per second.
- Dropped readings stay as gaps in time_s. Nothing is filled in.
- The report shows length, readings kept, dropped %, per-sensor contact and signal levels, per-wave-type levels and share, and focus lowest/average/highest and time above 50 and 75.
- A summary TXT can be downloaded from the report. Recordings stop automatically at 10 minutes.
- Baselines still reset when the panel is closed.

## Changed: Focus meter range
- Meter = 25 + 50 x ( F - Low ) / ( High - Low ), held between 0 and 100.
- Your 10 second baselines now land on 25 (low) and 75 (high). Anything calmer than your low baseline goes under 25 and anything sharper than your high baseline goes over 75. The meter reaches 0 and 100 at half a baseline-range beyond each baseline.

## Added: Mario Kart game (M button)
- A red M button at the bottom right of the panel opens a Mario Kart DS style race on Figure-8 Circuit. It unlocks only after focus baselines are set.
- You are Mario, starting 8th with the other 7 default racers (Peach, Luigi, Yoshi, Toad, Donkey Kong, Wario, Bowser), 3 laps, results screen with DS Grand Prix points.
- Speed multiplier = 0.5 + focus / 100 (0 focus 0.5x, 50 focus 1x, 100 focus 1.5x), smoothed over about 1 second. It scales your kart's top speed and acceleration only; mushroom, mini-turbo, star and rocket start boosts keep their own size. If the focus signal drops, the last multiplier is held.
- The game screen shows the four sensor connectivity lights, focus score and speed multiplier. Exit (Esc or EXIT) leaves the headband connected and the baselines untouched.
- Controls: arrows or WASD, Shift to drift (release for mini-turbo), Space for item (hold down to throw behind).
- Files: game/mkds.js (engine), game/mkds-render.js (view, HUD, overlay), game/mkds.test.js (run: node game/mkds.test.js). Keep the game folder next to muse-panel.html.
- Approximations (not extracted game data): physics numbers, mini-turbo timings (3 stages: blue, orange, purple), AI behavior, track shape (the real crossing is a bridge; here it is flat). Item odds are the real MKDS Grand Prix table from the Super Mario Wiki. All art is drawn in code.
