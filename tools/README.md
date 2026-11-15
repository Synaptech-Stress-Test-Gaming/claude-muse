# tools/

| File | What it does |
|---|---|
| `cyton_helper.py` | OpenBCI Cyton + Daisy (BrainFlow) → WebSocket `ws://127.0.0.1:8766` for the panel; `--simulate` needs no hardware and no BrainFlow |
| `test_cyton_helper.py` | helper tests H1-H10 (no BrainFlow needed); writes `testdata/frame_v1.hex` for the JS decoder test |
| `requirements.txt` | `brainflow>=5.12, websockets>=12, numpy, scipy, pyserial` (brainflow and pyserial are imported only on the real-board path) |
| `replay.js` | headless replay of a recording through the engine |
| `make_synth_recording.js` | writes a synthetic validation recording (for tests of replay and auto-tune) |
| `autotune.py`, `test_autotune.py` | analysis + tuning → `engine/tuned.json`, `engine/tuned.js`, `docs/validation-report.md` |
| `get_datasets.py` | optional public datasets → `.tmp/datasets/` (never run by the tests) |
| `build_priors.js` | `engine/priors.json` → `engine/priors.js` (the page is opened from `file://`, where JSON cannot be fetched) |
| `run_all_tests.js` | every old and new test; prints a table; exit 0 only if all pass |
| `browser_smoke.js` | optional headless Chrome/Edge screenshots (all looks, devices, engines, 1366x768 and 1536x864) and the in-page self-tests |

## The Cyton helper

Why a helper: a browser cannot receive the WiFi Shield's TCP push and BrainFlow is native code, so a local Python process bridges the board to the page.

Start it with **Open Cyton Helper.bat** in the project folder (first run: creates `.venv-cyton` and installs `tools/requirements.txt`; later runs start at once), or:

```
python tools/cyton_helper.py [--link auto|wifi|dongle] [--ip 192.168.4.1] [--ip-port 3000]
    [--serial-port COMx] [--rate auto|250|500|1000] [--ecg-channel 9] [--mains 60|50]
    [--ws-port 8766] [--simulate] [--sim-rate 125|250|500|1000] [--sim-seed 1]
    [--sim-script default|quiet|artifacts|validation] [--sim-loss 0.0] [--sim-no-accel] [--sim-no-ecg]
    [--sim-ecg-on 9] [--run-seconds N] [--log-level info]
```

| Flag | Default | Meaning |
|---|---|---|
| `--link` | `auto` | `auto` tries the WiFi Shield (10 s), then the USB dongle, and alternates forever while nothing works |
| `--ip`, `--ip-port` | unset, 3000 | WiFi Shield address. Unset in `auto`: 192.168.4.1 first (direct mode), then BrainFlow's SSDP discovery |
| `--serial-port` | auto-scan | dongle port; the scan tries FTDI ports (USB VID 0x0403) one after another until one gives data |
| `--rate` | `auto` | WiFi board rate. `auto` tests 1000, 500, 250 Hz (20 s each) and keeps the first with < 1% loss; the choice is remembered in `.tmp/cyton_helper_state.json` |
| `--ecg-channel` | 9 | 1-based board channel with the chest ECG lead (0 = no ECG, all 16 are EEG) |
| `--mains` | 60 | 60 or 50 Hz (notch and alias check) |
| `--ws-port` | 8766 | WebSocket port (8765 stays the game link) |
| `--simulate` and `--sim-*` | | simulated board: rate, seed, script, burst loss, no accelerometer, no ECG, ECG on another channel |
| `--run-seconds` | 0 | exit cleanly after N seconds (tests) |

**Board settings** sent once per connect (one command per channel, 0.3 s apart): EEG channels `x<c>060110X` (on, gain 24, normal input, bias on, SRB2 on, SRB1 off); the ECG channel `x<c>050000X` (gain 12, bias off, SRB2 off: its two pins measure the chest lead against each other). The ECG's microvolt scale is never corrected in software (it may be off by a constant factor of 2 depending on the BrainFlow version); all ECG processing is scale-invariant.

**Rates:** the dongle gives 125 Hz per channel with the Daisy. On WiFi the helper measures the real rate (`fs = (rows - 1) / (t_last - t_first)`, snapped to 125/250/500/1000 within 3%) and trusts the measurement over the `~4/~5/~6` commands. 500 and 1000 Hz are low-passed (8th-order Butterworth, 100 Hz, carried state) and decimated to **250 Hz** for the page.

**Gaps:** found from BrainFlow's package counter (it wraps at 256; the usual step is learned from the first rows). Lost samples are never filled in; a frame never spans a gap; the next frame carries the gap flag and a `sampleIndex` advanced by the lost count; the decimation filter restarts after a gap.

**Aliasing risk at 125 Hz:** the 120 Hz mains harmonic folds to exactly **5 Hz** (inside theta; with 50 Hz mains the 100 Hz harmonic folds to 25 Hz). The helper measures it (self-check 5) and the engine then lowers the confidence of theta-based scores (x 0.7) and the panel warns.

### WebSocket protocol (`ws://127.0.0.1:8766`, any origin: the page is `file://`)

Binary data frame, little-endian, one every 40 ms (or earlier when a gap closes it); length `32 + 4·C·N + 16·A`; the decoder rejects a wrong magic, version or length:

| Offset | Type | Field |
|---|---|---|
| 0 | u8 | magic `0xCB` |
| 1 | u8 | protocol version `1` |
| 2 | u8 | message type `1` (data) |
| 3 | u8 | `C` channels (16) |
| 4 | u16 | `N` samples per channel |
| 6 | u8 | `A` accelerometer samples |
| 7 | u8 | flags: bit0 accel channel exists, bit1 gap before this frame, bit2 simulated, bit3 decimated, bit4 impedance check running |
| 8 | u64 | `sampleIndex` of the first sample (output-rate samples since stream start, lost samples counted) |
| 16 | f64 | board timestamp of the first sample (Unix s) |
| 24 | u32 | `lostTotal` lost output samples since stream start |
| 28 | f32 | `fs` output rate per channel |
| 32 | f32 x C x N | µV, channel-major (raw, DC-coupled; only the decimation filter) |
| 32 + 4CN | A x 16 bytes | u16 sample offset, u16 pad, f32 x, f32 y, f32 z (g) |

JSON helper → page: `hello {proto, helper, version, simulated}` (then the latest status, config, selfcheck); `status {state: starting|connecting|rate_test|streaming|reconnecting|impedance|stopped|error, link, detail, t}`; `config {streamId, fs, boardFs, decim, channels[16], ecgChannel (0-based or -1), unusedChannels, accel, link, mains, gainEeg, gainEcg}` (a new `streamId` restarts `sampleIndex` at 0); `selfcheck {daisy, nCh, perChannel[{name, railed, flat, rmsUv, lineRatio}], accel{present, reason}, rate{requested, measured, lossPct}, alias{checked, freqHz, ratio, warn}, ftdi{checked, burstMs, warn, fix}, ecg{configured, detected, channel (1-based), kurtosis, acPeak, bpm, moved}, warnings[]}` (after about 3 s, at 20 s and when a value changes); `stats {fs, lossPct (last 10 s), lostTotal, link, uptimeS, clientDrops}` every second; `impedance {channel, name, kohm, rmsUv}` per channel then `impedance_done {results}`; `error {code, message, fix}`; `pong`.

Page → helper: `{"type":"cmd","cmd":"ping"|"impedance_sweep"|"stop_impedance"|"set_ecg_channel"|"restart"|"shutdown","channel":N}`. A client whose queue holds more than 2 s of frames loses its oldest frames (counted in `clientDrops`). Ctrl+C or `shutdown`: stop the stream, release the session, close the sockets, exit 0.

### Self-checks (automatic; logged and shown in the panel's Cyton card)

1. **Daisy attached**: 16 channels and the Daisy half not all zero; else error `no_daisy`, 8 channels.
2. **Per channel** (every 10 s): railed (> 2% of samples at ≥ 95% of ±187 500 µV), flat (1-45 Hz RMS < 1 µV), line ratio (mains power / 1-45 Hz power).
3. **Accelerometer present**: BrainFlow lists accel channels and a non-zero accel row appears within 10 s; else the engine uses the EEG motion proxy ("motion (from EEG)").
4. **Measured rate and loss.**
5. **Mains alias** (125 Hz only): Welch (4 s segments) density at 5 Hz (25 Hz) against its neighbours; warn when the ratio is > 4 on at least 25% of the channels.
6. **FTDI latency** (dongle only): median gap between bursts of rows; ≥ 10 ms → warning with the fix: *Windows Device Manager → Ports (COM & LPT) → USB Serial Port (COMx) → Properties → Port Settings → Advanced → Latency Timer (msec): set to 1 → OK. Then unplug and replug the dongle.*
7. **ECG auto-detect** (15 s, repeated every 60 s until found): per channel band-pass 5-15 Hz, kurtosis > 6 and autocorrelation peak of the squared signal at 0.33-1.43 s ≥ 0.5. The configured channel if it qualifies; else the best other one ("ECG found on channel N, not on channel 9"); else no ECG (stress is unavailable on the Cyton until it is fixed).
8. **Impedance sweep** (only when you press *Check contact*, because it distorts the data): 6 nA at 31.5 Hz per channel; `kΩ = RMS(28-35 Hz) · 1e-6 · √2 / 6e-9 / 1000` (approximate; one input of the contact score). Scores are held ("no contact") while it runs.

### Chest pads for the ECG (modified lead II)

One gel pad under the **right collarbone**, one on the **lower left ribs**. Clip the two leads of channel 9 (the F7 pins on the Daisy board) to them. Tape the cables so they do not pull. Do not use wrist leads. The polarity does not matter: the engine flips it itself.

### WiFi and the dongle

- **Direct mode:** join the WiFi Shield's own network (OpenBCI-xxxx) and use 192.168.4.1 (the default in `auto`). Campus networks such as eduroam (WPA2-Enterprise) do not work with the shield.
- **Station mode:** after joining the shield to your home network, pass its address with `--ip`.
- **Dongle fallback:** `--link dongle`. OpenBCI retired the WiFi Shield for reliability problems; when the panel says data is dropping on WiFi (over 2% for 30 s), plug in the dongle and restart the helper with `--link dongle`. Apply the FTDI latency fix above once.

### Simulator scripts (`--sim-script`; same waveform definitions as `engine/fixtures.js`)

Pink-ish noise (about 8 µV RMS) per channel, 10 Hz alpha (strongest on P7, P8, O1, O2, P3, P4), 6 Hz theta on F3/F4, low beta on C3/C4, a ±20 mV DC offset per channel, 60 Hz hum of 5 µV, an ECG on board channel 9 at 68 bpm (RMSSD about 35 ms, R 1000 µV), accelerometer at 25 Hz, optional burst loss (`--sim-loss`, 50-sample bursts).
- `quiet`: no artifacts.
- `default` (30 s cycle): single blink at 5 s; double blink at 8.00 + 8.35 s; jaw-clench tap (0.4 s, T7/T8) at 12 s; head movement 15-18 s (0.15 g at 2 Hz plus an 80 µV 3 Hz wave); electrode pop on C3 at 22 s; chewing (3 bursts, 1.2 Hz) at 25-27.5 s.
- `artifacts`: one artifact every 4 s through all types.
- `validation`: the validation protocol's block structure at 10x speed.

The browser has its own simulator (`adapters/cyton-sim.js`, `?demo=1&device=cyton`); `?demo=1&device=cyton&helper=1` uses the real adapter against `cyton_helper.py --simulate`.

## Replay, synthetic recordings, auto-tune, datasets

- `node tools/replay.js --in <prefix or panel CSV> [--config cfg.json] [--out out.json] [--device muse|cyton] [--profile none|fresh] [--quiet]`: feeds a v2 recording (or an old panel CSV: TP9..TP10 at 256 Hz, `time_s` for gaps, `motion_state` drives the motion gate, `heart_rate_bpm` as the pulse rate; no HRV) through the engine and prints valid time, mean and SD per metric, events per type and masked time per reason. `--config` deep-merges over `MuseEngine.CONFIG`. With no `--in` it replays up to 3 old CSVs from `.tmp/` and Downloads ("no recordings found (optional)" otherwise).
- `node tools/make_synth_recording.js --device cyton|muse --out .tmp/synth/<name> [--fast 10] [--seed 1]`: a synthetic validation recording with markers (`--fast`: continuous blocks 10x shorter, trial blocks keep their trial spacing with a tenth of the trials).
- `python tools/autotune.py [--in <prefix>] [--quick] [--out-dir engine] [--report docs/validation-report.md]`: priors from the rest blocks, detector thresholds, ASR/NLMS and focus weights by replaying candidates (at most 80 runs, 12 with `--quick`); writes `engine/tuned.json`, `engine/tuned.js` (the other device's values are kept) and the report. Bad input: one line, exit 2. Undo: delete the two tuned files.
- `python tools/get_datasets.py --dataset eegmat|eegdenoisenet|klados|cogbci|muse_mendeley|ultracortex_mi|all [--dest .tmp/datasets] [--yes-large]`: optional data (SAM40, WESAD, STEW, TUAR: where to get them by hand). `node engine/datasets.test.js` checks what is there and skips the rest.
