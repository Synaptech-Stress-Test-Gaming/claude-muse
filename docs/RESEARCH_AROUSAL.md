# Can we measure stress? What the project measures instead

**Short answer:** no headband can read "stress" directly. Stress is a psychological state. What can be measured is the body's
**arousal** (activation) that usually comes with it, and that is what the game needs: a player who gets worked up should see it in the game.
So the project now has two honest meters:

| Meter | Signal | What it means | Where |
|---|---|---|---|
| **Focus** | brain (EEG): `ln(beta / alpha)` vs personal baselines | task engagement / concentration | `panel/focus.js` (unchanged) |
| **Arousal** | body: heart rate, muscle tension, head movement vs your own rest | how activated your body is | `arousal.js` |

## Why not "stress from EEG"
- Reviews of stress detection from biosignals (Giannakakis et al., *Review on Psychological Stress Detection Using Biosignals*, IEEE Trans. Affective
  Computing, 2019/2022) list heart activity, skin conductance and muscle activity as the dependable measures. EEG findings for stress are
  inconsistent between studies and people, and they come from lab systems with many wet electrodes, not four dry ones.
- Beta/alpha style EEG ratios are better described as **engagement** indices (Pope, Bogart & Bartolome, *Biocybernetic system evaluates indices of
  operator engagement in automated task*, Biological Psychology, 1995). That is exactly what the focus meter is, so EEG stays there.
- A forehead "beta" increase is often jaw or frown muscle activity. Instead of pretending that is brain activity, the arousal meter uses it openly
  as **muscle tension**.

## Why these three signals
- **Heart rate** rises reliably under mental stress (Kim et al., *Stress and Heart Rate Variability: A Meta-Analysis and Review of the Literature*,
  Psychiatry Investigation, 2018: heart rate significantly increased during mental stress across studies). The Muse 2 has a pulse sensor.
  Heart-rate *variability* is also informative but needs windows of a minute or more, too slow for a game, so it is not used in the score.
- **Muscle tension** (30-44 Hz power on the forehead sensors): clenching, frowning and tensing up are part of the stress response and are directly
  visible on these electrodes (EMG is one of the reliable measures in the review above).
- **Movement** (accelerometer): fidgeting and tremor. Directly measured, no interpretation needed.
The Muse 2 has no skin-conductance sensor, which would be the best single arousal measure.

## What the score is and is not
- 0 = your own resting level, 100 = strongly activated. Each signal is compared with a resting value measured automatically in the first
  15 seconds (sit still), and the resting value follows you down if you relax further.
- It cannot tell stress from excitement, effort, caffeine or a laugh. It is only meaningful for one person within one session.
- It is a **game input and a teaching tool, not a measurement of stress or anxiety**. Do not present it as one.

## What still needs real data
Thresholds (`TUNING` in `arousal.js`: +25 bpm, 1.6 ln units of tension, 8x resting movement) are reasoned starting points, not fitted values.
With real recordings of calm vs timed-puzzle sessions (the CSV now has an `arousal_0_to_100` column plus heart rate), check whether the score
separates the two conditions for each person and adjust.
