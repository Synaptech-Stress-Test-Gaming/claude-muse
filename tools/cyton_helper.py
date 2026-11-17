"""Cyton + Daisy helper: OpenBCI board (BrainFlow) -> WebSocket on ws://127.0.0.1:8766 for the panel.

A browser cannot receive the WiFi Shield's TCP push and BrainFlow is native code, so this local helper bridges the board to the page.
Usage (see tools/README.md for every flag and the byte layout):
    python tools/cyton_helper.py                      real board: WiFi first, USB dongle as the fallback
    python tools/cyton_helper.py --simulate           simulated board, no hardware and no BrainFlow needed
    pythonw tools/cyton_helper.py --from-url "musecyton:wifi?ip=192.168.4.1" --exit-when-idle 120 --log-file .tmp/cyton_helper.log
                                                      how the panel's Connect page starts it (the musecyton: link, no console window)

Structure: a small Board interface (start/read/config/stop) with two implementations, BrainFlowBoard (real hardware) and SimBoard
(simulator). Everything above the board (rate selection, loss accounting, ECG detection, framing, self-checks, reconnect) is shared,
so it is tested with SimBoard by tools/test_cyton_helper.py. brainflow and serial are imported lazily, only on the real-board path.
"""
import argparse
import asyncio
import json
import logging
import math
import os
import struct
import sys
import threading
import time
from collections import deque

import numpy as np
from scipy import signal

VERSION = "1.0.0"
PROTO = 1
MAGIC = 0xCB
HEADER = struct.Struct("<BBBBHBBQdIf")      # 32 bytes
ACC_REC = struct.Struct("<HHfff")           # 16 bytes
assert HEADER.size == 32 and ACC_REC.size == 16
FLAG_ACCEL, FLAG_GAP, FLAG_SIM, FLAG_DECIM, FLAG_IMP = 1, 2, 4, 8, 16
DEFAULT_NAMES = ["Fp1", "Fp2", "C3", "C4", "P7", "P8", "O1", "O2", "F7", "F8", "F3", "F4", "T7", "T8", "P3", "P4"]
CH_CODES = "12345678QWERTYUI"               # Cyton channel letters for channels 1-16
RAIL_UV = 187500.0
FTDI_FIX = ("Windows Device Manager → Ports (COM & LPT) → USB Serial Port (COMx) → Properties → Port Settings → "
            "Advanced → Latency Timer (msec): set to 1 → OK. Then unplug and replug the dongle.")
STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".tmp", "cyton_helper_state.json")
log = logging.getLogger("cyton_helper")


# ---------------------------------------------------------------- binary frame
def encode_frame(data, accel, sample_index, board_ts, lost_total, fs, flags):
    """data: float32 array (C, N) in uV; accel: list of (offset, x, y, z)."""
    data = np.asarray(data, dtype="<f4")
    C, N = data.shape
    if accel:
        flags |= FLAG_ACCEL
    head = HEADER.pack(MAGIC, PROTO, 1, C, N, len(accel), flags, int(sample_index), float(board_ts), int(lost_total) & 0xFFFFFFFF, float(fs))
    body = data.tobytes(order="C")
    acc = b"".join(ACC_REC.pack(int(o), 0, float(x), float(y), float(z)) for (o, x, y, z) in accel)
    return head + body + acc


def decode_frame(buf):
    if len(buf) < 32:
        raise ValueError("frame too short")
    magic, ver, typ, C, N, A, flags, si, ts, lost, fs = HEADER.unpack_from(buf, 0)
    if magic != MAGIC or ver != PROTO or typ != 1:
        raise ValueError("bad magic/version/type")
    if len(buf) != 32 + 4 * C * N + 16 * A:
        raise ValueError("bad frame length")
    data = np.frombuffer(buf, dtype="<f4", count=C * N, offset=32).reshape(C, N)
    acc = [ACC_REC.unpack_from(buf, 32 + 4 * C * N + 16 * k) for k in range(A)]
    return {"C": C, "N": N, "A": A, "flags": flags, "sampleIndex": si, "ts": ts, "lostTotal": lost, "fs": fs, "data": data,
            "accel": [(a[0], a[2], a[3], a[4]) for a in acc]}


def impedance_kohm(rms_uv):
    """OpenBCI lead-off test: 6 nA at 31.5 Hz. R = V_peak / I with V_peak = RMS * sqrt(2). Returns kOhm (approximate)."""
    return (rms_uv * 1e-6 * math.sqrt(2)) / 6e-9 / 1000.0


# ---------------------------------------------------------------- pure checks
def choose_rate(trial, candidates=(1000, 500, 250), max_loss=0.01):
    """trial(rate) -> loss fraction over 20 s. Accept the first candidate with loss < 1%. Returns (rate, warning|None, tried)."""
    tried = []
    for r in candidates:
        loss = trial(r)
        tried.append((r, loss))
        if loss < max_loss:
            return r, None, tried
    return candidates[-1], "Data loss was 1%% or more at every rate (%s). Using 250 Hz." % ", ".join("%d Hz %.1f%%" % (r, 100 * l) for r, l in tried), tried


def measured_rate(ts):
    ts = np.asarray(ts, dtype=float)
    if len(ts) < 2 or ts[-1] - ts[0] < 1e-6:
        return None
    fs = (len(ts) - 1) / (ts[-1] - ts[0])
    for c in (125, 250, 500, 1000):
        if abs(fs - c) / c < 0.03:
            return float(c)
    return float(fs)


def ftdi_check(ts):
    """Row arrival timestamps (s) over about 10 s. burstMs = median of the differences larger than 2 ms."""
    d = np.diff(np.asarray(ts, dtype=float)) * 1000.0
    big = d[d > 2.0]
    burst = float(np.median(big)) if len(big) else 0.0
    warn = burst >= 10.0
    return {"checked": True, "burstMs": round(burst, 2), "warn": bool(warn), "fix": FTDI_FIX if warn else None}


def band(x, lo, hi, fs, order=2):
    sos = signal.butter(order, [lo, hi], btype="band", fs=fs, output="sos")
    return signal.sosfiltfilt(sos, x)


def pearson_kurtosis(x):
    x = np.asarray(x, dtype=float) - np.mean(x)
    v = np.mean(x * x)
    return float(np.mean(x ** 4) / (v * v)) if v > 0 else 0.0


def ecg_metrics(x, fs):
    y = band(np.asarray(x, dtype=float), 5.0, 15.0, fs)
    k = pearson_kurtosis(y)
    s = y * y
    s = s - s.mean()
    den = float(np.dot(s, s))
    best, lag_best = 0.0, 0
    if den > 0:
        for lag in range(int(round(0.33 * fs)), int(round(1.43 * fs)) + 1):
            if lag >= len(s):
                break
            r = float(np.dot(s[:-lag], s[lag:])) / den
            if r > best:
                best, lag_best = r, lag
    bpm = 60.0 * fs / lag_best if lag_best else None
    return k, best, bpm


def ecg_detect(data, fs, configured, eeg_idx=None):
    """data: (C, n). configured: 0-based index or -1. Returns dict with channel (0-based or -1), moved, per-channel metrics."""
    C = data.shape[0]
    idx = list(range(C)) if eeg_idx is None else list(eeg_idx)
    res = {}
    for c in idx:
        res[c] = ecg_metrics(data[c], fs)
    looks = {c: (k > 6 and ac >= 0.5) for c, (k, ac, _) in res.items()}
    out = {"configured": configured, "detected": False, "channel": -1, "kurtosis": None, "acPeak": None, "bpm": None, "moved": False}
    pick = None
    if configured >= 0 and looks.get(configured):
        pick = configured
    else:
        cands = [c for c in idx if looks[c]]
        if cands:
            pick = max(cands, key=lambda c: res[c][1])
            out["moved"] = configured >= 0 and pick != configured
    if pick is not None:
        k, ac, bpm = res[pick]
        out.update(detected=True, channel=pick, kurtosis=round(k, 2), acPeak=round(ac, 3), bpm=round(bpm, 1) if bpm else None)
    elif configured >= 0 and configured in res:
        out.update(kurtosis=round(res[configured][0], 2), acPeak=round(res[configured][1], 3))
    return out


def alias_check(data, fs, mains=60, eeg_idx=None):
    """Only at 125 Hz: the mains harmonic (120 Hz at 60 Hz mains, 100 Hz at 50 Hz) folds to 5 Hz or 25 Hz."""
    if abs(fs - 125) > 1:
        return {"checked": False, "freqHz": None, "ratio": None, "warn": False}
    f = 5.0 if mains == 60 else 25.0
    idx = range(data.shape[0]) if eeg_idx is None else eeg_idx
    ratios = []
    for c in idx:
        fr, P = signal.welch(data[c], fs=fs, nperseg=int(4 * fs))
        inn = (fr >= f - 0.25) & (fr <= f + 0.25)
        out = ((fr >= f - 2) & (fr <= f - 0.75)) | ((fr >= f + 0.75) & (fr <= f + 2))
        ratios.append(float(P[inn].mean() / max(P[out].mean(), 1e-12)))
    warn = bool(np.mean(np.array(ratios) > 4) >= 0.25) if ratios else False
    return {"checked": True, "freqHz": f, "ratio": round(float(np.median(ratios)), 2) if ratios else None, "warn": warn}


def channel_check(raw, fs, mains):
    railed = float(np.mean(np.abs(raw) >= 0.95 * RAIL_UV)) > 0.02
    x = raw - np.mean(raw)
    y = band(x, 1.0, min(45.0, fs / 2 - 2), fs)
    rms = float(np.sqrt(np.mean(y * y)))
    line = 0.0
    if mains < fs / 2:
        n = len(x)
        w = 2 * math.pi * mains / fs
        k = np.arange(n)
        re, im = float(np.dot(x, np.cos(w * k))), float(np.dot(x, np.sin(w * k)))
        line = 2 * (re * re + im * im) / (n * n)
    return {"railed": railed, "flat": rms < 1.0, "rmsUv": round(rms, 2), "lineRatio": round(line / max(rms * rms, 1e-12), 3)}


# ---------------------------------------------------------------- framing
class Framer:
    """Board rows -> 40 ms binary frames at the output rate. Lost samples are never filled; a frame never spans a gap.
    Board rates 500/1000 are low-passed (8th-order Butterworth, 100 Hz, carried state) and decimated to 250."""

    def __init__(self, board_fs, n_ch, frame_ms=40, simulated=False, counter_mod=256):
        self.board_fs = board_fs
        self.decim = 4 if board_fs >= 1000 else 2 if board_fs >= 500 else 1
        self.fs = board_fs / self.decim
        self.n_ch = n_ch
        self.frame_n = max(1, int(round(self.fs * frame_ms / 1000.0)))
        self.sim = simulated
        self.mod = counter_mod
        self.sos = signal.butter(8, 100.0, fs=board_fs, output="sos") if self.decim > 1 else None
        self.zi = None
        self.b = 0                      # board-sample index (lost samples counted)
        self.last_counter = None
        self.step = None                # counter increment per row, learned from the data
        self.step_hist = []
        self.lost_board = 0
        self.lost_out = 0
        self.received_out = 0
        self.buf = []                   # list of (out_index, column array, ts)
        self.buf_acc = []
        self.gap_pending = False
        self.impedance = False
        self.out_index_next = 0

    def _flush(self, frames):
        if not self.buf:
            return
        si = self.buf[0][0]
        data = np.stack([c for (_, c, _) in self.buf], axis=1).astype(np.float32)
        acc = [(min(o - si, len(self.buf) - 1), x, y, z) for (o, x, y, z) in self.buf_acc]
        flags = (FLAG_GAP if self.gap_pending else 0) | (FLAG_SIM if self.sim else 0) | (FLAG_DECIM if self.decim > 1 else 0) | (FLAG_IMP if self.impedance else 0)
        frames.append(encode_frame(data, acc, si, self.buf[0][2], self.lost_out, self.fs, flags))
        self.buf, self.buf_acc, self.gap_pending = [], [], False

    def push(self, counter, eeg, accel, ts):
        """counter: (n,) ints; eeg: (C, n) uV; accel: (3, n) or None (all-zero rows carry no sample); ts: (n,)."""
        frames = []
        n = eeg.shape[1]
        for i in range(n):
            c = int(counter[i])
            if self.last_counter is not None:
                d = (c - self.last_counter) % self.mod
                if self.step is None:
                    if d:
                        self.step_hist.append(d)
                    if len(self.step_hist) >= 20:
                        vals, cnt = np.unique(self.step_hist, return_counts=True)
                        self.step = int(vals[np.argmax(cnt)])
                    d_lost = 0
                else:
                    d_lost = max(0, int(round(d / self.step)) - 1) if d else 0
                if d_lost:
                    self._flush(frames)
                    lost_before = self.b
                    self.b += d_lost
                    self.lost_board += d_lost
                    nxt = -(-self.b // self.decim)
                    self.lost_out += max(0, nxt - self.out_index_next)
                    self.out_index_next = max(self.out_index_next, nxt)
                    self.gap_pending = True
                    self.zi = None                 # filters re-settle after a gap
                    del lost_before
            self.last_counter = c
            col = eeg[:, i].astype(float)
            if self.sos is not None:
                if self.zi is None:
                    self.zi = np.stack([signal.sosfilt_zi(self.sos) * v for v in col], axis=2)  # steady state at the current value: no start-up step
                y, self.zi = signal.sosfilt(self.sos, col[None, :], axis=0, zi=self.zi)
                col = y[0]
            keep = (self.b % self.decim) == 0
            out_idx = self.b // self.decim if keep else -(-self.b // self.decim)
            if accel is not None and np.any(accel[:, i] != 0):
                self.buf_acc.append((out_idx, float(accel[0, i]), float(accel[1, i]), float(accel[2, i])))
            if keep:
                self.buf.append((out_idx, col.astype(np.float32), float(ts[i])))
                self.out_index_next = out_idx + 1
                self.received_out += 1
                if len(self.buf) >= self.frame_n:
                    self._flush(frames)
            self.b += 1
        return frames

    def flush(self):
        frames = []
        self._flush(frames)
        return frames


# ---------------------------------------------------------------- boards
class SimBoard:
    """Simulated Cyton + Daisy. Same waveform definitions as engine/fixtures.js (documented in tools/README.md).
    clock: function returning seconds (monotonic); tests pass a fake clock."""

    def __init__(self, rate=125, seed=1, script="default", loss=0.0, accel=True, ecg_on=9, loss_table=None, stall=None,
                 extra_line=None, clock=time.monotonic, n_ch=16, start_fail=0):
        self.req_rate = rate
        self.seed = seed
        self.script = script
        self.loss = loss
        self.loss_table = loss_table or {}
        self.has_accel = accel
        self.ecg_on = ecg_on            # 1-based board channel or 0/None
        self.stall = stall              # (t0, dur) in clock seconds: no rows at all
        self.extra_line = extra_line    # (freq, uV) added to every channel
        self.clock = clock
        self.n_ch = n_ch
        self.start_fail = start_fail
        self.commands = []
        self.instant = True
        self.running = False
        self.impedance_ch = None
        self.imp_kohm = {c: 200.0 + 40.0 * c for c in range(n_ch)}

    def start(self, rate=None):
        if self.start_fail > 0:
            self.start_fail -= 1
            raise RuntimeError("simulated start failure")
        self.fs = float(rate or self.req_rate)
        self.rng = np.random.default_rng(self.seed)
        self.t0 = self.clock()
        self.produced = 0
        self.counter = 0
        self.dc = self.rng.uniform(-20000, 20000, self.n_ch)
        self.pink_zi = None
        self.phase = self.rng.uniform(0, 2 * np.pi, 4)
        self.loss_left = 0
        self.running = True
        hr = 68.0
        rr = 60.0 / hr + 0.025 * np.sin(2 * np.pi * np.arange(4000) / 4.3) + 0.004 * self.rng.standard_normal(4000)
        self.r_times = 0.6 + np.concatenate([[0], np.cumsum(rr)])
        return {"board_fs": self.fs, "n_ch": self.n_ch, "accel": self.has_accel, "link": "sim", "daisy": self.n_ch == 16}

    def config(self, cmd):
        self.commands.append(cmd)
        if cmd.startswith("z") and cmd.endswith("Z") and len(cmd) == 5:
            ch = CH_CODES.index(cmd[1])
            self.impedance_ch = ch if cmd[2:4] == "01" else None
        return ""

    def stop(self):
        self.running = False

    def _pink(self, n):
        # sum of 5 one-pole low-passed white noises (about 1/f), scaled to about 8 uV RMS
        fcs = [1.0, 3.0, 9.0, 27.0, 60.0]
        if self.pink_zi is None:
            self.pink_zi = np.zeros((len(fcs), self.n_ch))
        out = np.zeros((self.n_ch, n))
        for k, fc in enumerate(fcs):
            a = math.exp(-2 * math.pi * min(fc, self.fs / 2.5) / self.fs)
            w = self.rng.standard_normal((self.n_ch, n))
            for c in range(self.n_ch):
                y, zf = signal.lfilter([1 - a], [1, -a], w[c], zi=[self.pink_zi[k, c]])
                self.pink_zi[k, c] = zf[0]
                out[c] += y * (fc ** -0.5) * 9.0
        return out

    def _artifacts(self, t, x, acc):
        names = DEFAULT_NAMES
        ix = {n: i for i, n in enumerate(names)}
        fs = self.fs

        def rc(u):
            return np.where((u > 0) & (u < 1), 0.5 - 0.5 * np.cos(2 * np.pi * u), 0.0)

        def blink(t0, amp, dur):
            p = rc((t - t0) / dur) * amp
            for n, w in (("Fp1", 1), ("Fp2", 1), ("F3", .4), ("F4", .4), ("F7", .4), ("F8", .4)):
                if not (self.ecg_on and ix[n] == self.ecg_on - 1):
                    x[ix[n]] += w * p

        def emg(t0, dur, amps):
            m = (t >= t0) & (t < t0 + dur)
            if not m.any():
                return
            fhi = min(110, fs / 2 - 3)
            sos = signal.butter(4, [20, fhi], btype="band", fs=fs, output="sos")
            for n, a in amps.items():
                if self.ecg_on and ix[n] == self.ecg_on - 1:
                    continue
                w = signal.sosfilt(sos, self.rng.standard_normal(len(t)))
                w /= max(np.std(w), 1e-9)
                x[ix[n]] += a * w * m

        def clench_amps(temp, front, other):
            return {n: (temp if n in ("T7", "T8") else front if n in ("Fp1", "Fp2", "F3", "F4", "F7", "F8") else other) for n in names}

        if self.script == "quiet":
            return
        if self.script in ("default", "artifacts"):
            cyc = 30.0 if self.script == "default" else 32.0
            tc = np.mod(t, cyc)
            k = np.floor(t / cyc)
            base = k * cyc
            if self.script == "default":
                for b in np.unique(base):
                    blink(b + 5.0, 150, 0.25)
                    blink(b + 8.0, 280, 0.42)
                    blink(b + 8.35, 280, 0.42)
                    emg(b + 12.0, 0.4, clench_amps(60, 15, 6))
                    for j in range(3):
                        emg(b + 25.0 + j / 1.2, 0.28, clench_amps(45, 12, 4))
                mv = (tc >= 15) & (tc < 18)
                x += 80 * np.sin(2 * np.pi * 3 * t) * mv
                if acc is not None:
                    acc[0] += 0.15 * np.sin(2 * np.pi * 2 * t) * mv
                    acc[2] += 0.15 * np.sin(2 * np.pi * 2 * t + 1) * mv
                for b in np.unique(base):
                    u = t - (b + 22.0)
                    x[ix["C3"]] += np.where(u >= 0, 200 * np.exp(-np.clip(u, 0, None) / 1.0), 0)
            else:
                for b in np.unique(base):
                    blink(b + 2, 150, 0.25)
                    blink(b + 6, 280, 0.42); blink(b + 6.35, 280, 0.42)
                    emg(b + 10, 0.4, clench_amps(60, 15, 6))
                    emg(b + 14, 3.0, clench_amps(20, 25, 5))
                    for j in range(4):
                        emg(b + 18 + j / 1.2, 0.28, clench_amps(45, 12, 4))
                    u = t - (b + 26)
                    x[ix["C3"]] += np.where(u >= 0, 200 * np.exp(-np.clip(u, 0, None)), 0)
                mv = (tc >= 29) & (tc < 31)
                x += 80 * np.sin(2 * np.pi * 3 * t) * mv
        elif self.script == "validation":
            # D18 block structure at 10x speed: (duration s, kind)
            blocks = [(12, "rest"), (6, "closed"), (18, "focus"), (12, "focus"), (6, "rest"), (6, "blink"), (8, "dblink"), (8, "clench"),
                      (12, "long"), (8, "frown"), (6, "talk"), (3, "chew"), (8, "move"), (8, "move"), (4.5, "move"), (6, "talk"), (30, "rest"), (30, "rest")]
            tot = sum(d for d, _ in blocks)
            tc = np.mod(t, tot)
            t0 = 0.0
            for d, kind in blocks:
                m = (tc >= t0) & (tc < t0 + d)
                if m.any():
                    b0 = t[m][0] - (tc[m][0] - t0)
                    if kind == "closed":
                        for n in ("O1", "O2", "P3", "P4", "P7", "P8"):
                            x[ix[n]] += 20 * np.sin(2 * np.pi * 10 * t) * m
                    elif kind == "blink":
                        for j in range(20):
                            blink(b0 + 0.3 * j, 150, 0.25)
                    elif kind == "dblink":
                        for j in range(20):
                            blink(b0 + 0.4 * j, 280, 0.42); blink(b0 + 0.4 * j + 0.35, 280, 0.42)
                    elif kind in ("clench", "long", "frown"):
                        for j in range(20):
                            emg(b0 + d / 20 * j, 0.4 if kind != "long" else 3.0, clench_amps(60, 15, 6) if kind != "frown" else clench_amps(10, 50, 5))
                    elif kind in ("talk", "chew"):
                        emg(b0, d, clench_amps(25, 25, 4))
                    elif kind == "move":
                        x += 80 * np.sin(2 * np.pi * 3 * t) * m
                        if acc is not None:
                            acc[0] += 0.15 * np.sin(2 * np.pi * 2 * t) * m
                t0 += d

    def read(self):
        """-> (counter, eeg (C, n) uV, accel (3, n) or None, ts) for the rows since the last call (real time by the clock)."""
        if not self.running:
            return None
        now = self.clock()
        due = int((now - self.t0) * self.fs) - self.produced
        if due <= 0:
            return None
        n = due
        idx = self.produced + np.arange(n)
        self.produced += n
        t = idx / self.fs
        if self.stall and self.stall[0] <= now - 0 < self.stall[0] + self.stall[1]:
            self.counter = (self.counter + n) % 256
            return None
        x = self._pink(n)
        names = DEFAULT_NAMES
        alpha_w = {"P7": 1, "P8": 1, "O1": 1.2, "O2": 1.2, "P3": 1, "P4": 1}
        for c, nm in enumerate(names):
            x[c] += 12 * alpha_w.get(nm, 0.3) * np.sin(2 * np.pi * 10 * t + self.phase[0])
            if nm in ("F3", "F4"):
                x[c] += 6 * np.sin(2 * np.pi * 6 * t + self.phase[1])
            if nm in ("C3", "C4"):
                x[c] += 3 * np.sin(2 * np.pi * 16 * t + self.phase[2])
            if self.fs > 120:
                x[c] += 5 * np.sin(2 * np.pi * 60 * t + self.phase[3])
            if self.extra_line:
                x[c] += self.extra_line[1] * math.sqrt(2) * np.sin(2 * np.pi * self.extra_line[0] * t)
        acc = None
        if self.has_accel:
            acc = np.zeros((3, n))
            acc[2] += 1.0
            acc += 0.002 * self.rng.standard_normal((3, n))
        self._artifacts(t, x, acc)
        if self.ecg_on:
            e = np.zeros(n)
            near = self.r_times[(self.r_times > t[0] - 1) & (self.r_times < t[-1] + 1)]
            for rt in near:
                u = t - rt
                e += 1000 * np.exp(-0.5 * (u / 0.012) ** 2) - 150 * np.exp(-0.5 * ((u + 0.028) / 0.008) ** 2) \
                    - 250 * np.exp(-0.5 * ((u - 0.03) / 0.01) ** 2) + 250 * np.exp(-0.5 * ((u - 0.25) / 0.06) ** 2)
            x[self.ecg_on - 1] = e + 10 * self.rng.standard_normal(n)
        if self.impedance_ch is not None:
            c = self.impedance_ch
            amp = self.imp_kohm[c] * 1000 * 6e-9 / math.sqrt(2) * 1e6 * math.sqrt(2)
            x[c] += amp * np.sin(2 * np.pi * 31.5 * t)
        x += self.dc[:, None]
        if acc is not None:
            keep = (idx % max(1, int(round(self.fs / 25)))) == 0       # the board interleaves accel at about 25 Hz
            acc[:, ~keep] = 0.0
        counter = (self.counter + np.arange(n)) % 256
        self.counter = (self.counter + n) % 256
        ts = time.time() + (t - t[-1])
        loss = self.loss_table.get(int(self.fs), self.loss)
        if loss > 0:
            keep = np.ones(n, bool)
            for i in range(n):
                if self.loss_left > 0:
                    keep[i] = False
                    self.loss_left -= 1
                elif self.rng.random() < loss / 50.0:
                    self.loss_left = 49
                    keep[i] = False
            counter, x, ts = counter[keep], x[:, keep], ts[keep]
            acc = acc[:, keep] if acc is not None else None
            if len(counter) == 0:
                return None
        return counter, x, acc, ts


class BrainFlowBoard:
    """Real hardware through BrainFlow. Imported lazily so --simulate works without BrainFlow."""

    def __init__(self, link, ip=None, ip_port=3000, serial_port=None):
        self.link = link
        self.ip = ip
        self.ip_port = ip_port
        self.serial_port = serial_port
        self.shim = None

    def _ports(self):
        if self.serial_port:
            return [self.serial_port]
        import serial.tools.list_ports  # lazy
        return [p.device for p in serial.tools.list_ports.comports() if p.vid == 0x0403]

    def start(self, rate=None):
        from brainflow.board_shim import BoardShim, BrainFlowInputParams, BoardIds  # lazy
        BoardShim.disable_board_logger()
        if self.link == "wifi":
            params = BrainFlowInputParams()
            params.ip_port = self.ip_port
            params.ip_address = self.ip or ""
            params.timeout = 10
            bid = BoardIds.CYTON_DAISY_WIFI_BOARD.value
            self.shim = BoardShim(bid, params)
            self.shim.prepare_session()
        else:
            bid = BoardIds.CYTON_DAISY_BOARD.value
            last = None
            for port in self._ports():
                params = BrainFlowInputParams()
                params.serial_port = port
                try:
                    self.shim = BoardShim(bid, params)
                    self.shim.prepare_session()
                    break
                except Exception as e:  # try the next FTDI port
                    last = e
                    self.shim = None
            if self.shim is None:
                raise RuntimeError("no OpenBCI dongle found (%s)" % last)
        self.bid = bid
        self.eeg_ch = BoardShim.get_eeg_channels(bid)
        self.pkg_ch = BoardShim.get_package_num_channel(bid)
        self.ts_ch = BoardShim.get_timestamp_channel(bid)
        try:
            self.acc_ch = BoardShim.get_accel_channels(bid)
        except Exception:
            self.acc_ch = None
        if rate and self.link == "wifi":
            self.shim.config_board({1000: "~4", 500: "~5", 250: "~6"}.get(int(rate), "~6"))
        self.board_fs = float(BoardShim.get_sampling_rate(bid)) if not rate else float(rate)
        return {"board_fs": self.board_fs, "n_ch": len(self.eeg_ch), "accel": self.acc_ch is not None, "link": self.link, "daisy": len(self.eeg_ch) >= 16}

    def begin(self):
        self.shim.start_stream(45000)

    def config(self, cmd):
        return self.shim.config_board(cmd)

    def read(self):
        d = self.shim.get_board_data()
        if d is None or d.shape[1] == 0:
            return None
        acc = d[self.acc_ch, :] if self.acc_ch else None
        return d[self.pkg_ch, :].astype(int), d[self.eeg_ch, :], acc, d[self.ts_ch, :]

    def stop(self):
        try:
            self.shim.stop_stream()
        except Exception:
            pass
        try:
            self.shim.release_session()
        except Exception:
            pass


# ---------------------------------------------------------------- helper core
class Helper:
    """Shared logic above the board. step() is called every ~20 ms; it reads rows, frames them and runs the checks."""

    def __init__(self, args, board_factory, clock=time.monotonic, send=None):
        self.args = args
        self.factory = board_factory
        self.clock = clock
        self.send = send or (lambda kind, payload: None)      # kind: "json" | "bin"
        self.stream_id = 0
        self.board = None
        self.framer = None
        self.state = "starting"
        self.link = "sim" if args.simulate else None
        self.status_detail = ""
        self.last_rows = None
        self.retry_at = None
        self.backoff = 0
        self.links = ["sim"] if args.simulate else (["wifi", "dongle"] if args.link == "auto" else [args.link])
        self.link_i = 0
        self.rate_plan = None
        self.rate_trial = None
        self.cfg = None
        self.selfcheck = None
        self.stream_t0 = None
        self.hist = deque()            # (t, received, lost) per step for the 10 s loss window
        self.raw_buf = None
        self.ts_buf = deque(maxlen=20000)
        self.ecg_channel = (args.ecg_channel - 1) if args.ecg_channel > 0 else -1
        self.ecg_configured = self.ecg_channel
        self.ecg_info = None
        self.next_ecg_check = None
        self.next_sc = None
        self.accel_seen = False
        self.client_drops = 0
        self.imp = None
        self.warnings = []
        self.started = clock()
        self.stats_at = clock()
        self.rate_warning = None
        self.measured = None
        self.state_file = getattr(args, "state_file", None) or STATE_FILE

    # ---- messages
    def status(self, state, detail=""):
        self.state = state
        self.status_detail = detail
        self.send("json", {"type": "status", "state": state, "link": self.link, "detail": detail, "t": time.time()})
        log.info("status: %s %s %s", state, self.link or "", detail)

    def config_msg(self):
        return self.cfg

    # ---- board lifecycle
    def _open(self):
        link = self.links[self.link_i % len(self.links)]
        self.link = link
        self.status("connecting", "trying " + link)
        self.board = self.factory(link)
        rate = None
        if link == "wifi" and self.args.rate != "auto":
            rate = int(self.args.rate)
        elif link == "wifi":
            if self.rate_plan is None:
                cand = [1000, 500, 250]
                try:
                    with open(self.state_file) as f:
                        prev = json.load(f).get("rate")
                    if prev in cand:
                        cand.remove(prev)
                        cand.insert(0, prev)
                except Exception:
                    pass
                self.rate_plan = cand
            rate = self.rate_plan[0]
        elif link == "sim":
            rate = self.args.sim_rate
        info = self.board.start(rate)
        if hasattr(self.board, "begin"):
            self.board.begin()
        self._configure_channels(info)
        self._new_stream(info)
        if link == "wifi" and self.args.rate == "auto":
            self.rate_trial = {"rate": rate, "t0": self.clock(), "recv": 0, "lost": 0}
            self.status("rate_test", "testing %d Hz" % rate)
        else:
            self.status("streaming", "%s %g Hz" % (link, self.framer.fs))

    def _configure_channels(self, info):
        for c in range(min(16, info["n_ch"])):
            code = CH_CODES[c]
            cmd = ("x%s050000X" if c == self.ecg_configured else "x%s060110X") % code
            try:
                self.board.config(cmd)
            except Exception as e:
                log.warning("channel setting %s failed: %s", cmd, e)
            if not self.args.simulate and not getattr(self.board, "instant", False):
                time.sleep(0.3)

    def _new_stream(self, info):
        self.stream_id += 1
        self.info = info
        self.framer = Framer(info["board_fs"], 16, simulated=self.args.simulate)
        fs = self.framer.fs
        self.raw_buf = deque(maxlen=int(fs * 20))
        self.ts_buf.clear()
        self.hist.clear()
        self.stream_t0 = self.clock()
        self.last_rows = self.clock()
        self.accel_seen = False
        self.next_sc = self.clock() + min(3.0, self.args.run_seconds * 0.4 if self.args.run_seconds else 3.0)
        self.next_ecg_check = self.clock() + 15.0
        self.backoff = 0
        names = list(DEFAULT_NAMES)
        unused = list(range(info["n_ch"], 16)) if info["n_ch"] < 16 else []
        if self.ecg_channel >= 0:
            names[self.ecg_channel] = "ECG"
        if self.ecg_configured >= 0 and self.ecg_channel < 0 and self.ecg_configured not in unused:
            unused.append(self.ecg_configured)
        self.cfg = {"type": "config", "streamId": self.stream_id, "fs": fs, "boardFs": info["board_fs"], "decim": self.framer.decim, "channels": names,
                    "ecgChannel": self.ecg_channel, "unusedChannels": sorted(unused), "accel": bool(info["accel"]), "link": self.link,
                    "mains": self.args.mains, "gainEeg": 24, "gainEcg": 12}
        if not info.get("daisy", True):
            self.send("json", {"type": "error", "code": "no_daisy", "message": "The Daisy board was not found. Running with 8 channels.", "fix": "Check that the Daisy board is seated on the Cyton."})
        self.send("json", self.cfg)

    def _close(self):
        if self.board is not None:
            try:
                self.board.stop()
            except Exception:
                pass
        self.board = None

    def shutdown(self):
        self._close()
        self.status("stopped", "")

    # ---- loop
    def opening_due(self, now=None):
        """True when the next step() will try to open the board (BrainFlow discovery and the channel settings can take seconds)."""
        now = self.clock() if now is None else now
        return self.board is None and (self.retry_at is None or now >= self.retry_at)

    def step(self):
        now = self.clock()
        if self.board is None:
            if self.retry_at is None or now >= self.retry_at:
                try:
                    self._open()
                    self.retry_at = None
                except Exception as e:
                    log.warning("could not open %s: %s", self.link, e)
                    self._close()
                    self.backoff = min(10, 2 if self.backoff == 0 else self.backoff * 2)
                    self.retry_at = now + self.backoff
                    self.link_i += 1
                    self.status("reconnecting", "retry in %d s" % self.backoff)
            return
        rows = self.board.read()
        if rows is not None and len(rows[0]):
            self.last_rows = now
            self._ingest(*rows)
        elif now - self.last_rows > 3.0:
            self._close()
            self.status("reconnecting", "no data for 3 s")
            self.backoff = 2
            self.retry_at = now + self.backoff
            self.link_i += 1 if len(self.links) > 1 else 0
            return
        if self.rate_trial and now - self.rate_trial["t0"] >= 20.0:
            self._rate_decide()
        if now >= self.next_sc:
            self._selfcheck()
            self.next_sc = max(now + 1.0, self.stream_t0 + 20.0) if now - self.stream_t0 < 19.0 else now + 10.0
        if self.ecg_info is None or not self.ecg_info.get("detected"):
            if now >= self.next_ecg_check and now - self.stream_t0 >= 15.0:
                self._ecg_check()
                self.next_ecg_check = now + 60.0
        if now - self.stats_at >= 1.0:
            self.stats_at = now
            self.send("json", self.stats())
        if self.imp:
            self._imp_step(now)

    def _ingest(self, counter, eeg, acc, ts):
        eeg = np.asarray(eeg, dtype=float)
        if eeg.shape[0] < 16:
            eeg = np.vstack([eeg, np.zeros((16 - eeg.shape[0], eeg.shape[1]))])
        lost0 = self.framer.lost_out
        recv0 = self.framer.received_out
        frames = self.framer.push(counter, eeg, acc, ts)
        recv = self.framer.received_out - recv0
        lost = self.framer.lost_out - lost0
        self.hist.append((self.clock(), recv, lost))
        if self.rate_trial:
            self.rate_trial["recv"] += recv
            self.rate_trial["lost"] += lost
        if acc is not None and np.any(acc != 0):
            self.accel_seen = True
        for fr in frames:
            self.send("bin", fr)
            d = decode_frame(fr)
            for k in range(d["N"]):
                self.raw_buf.append(d["data"][:, k].copy())
        for t in ts:
            self.ts_buf.append(float(t))

    def stats(self):
        now = self.clock()
        while self.hist and now - self.hist[0][0] > 10.0:
            self.hist.popleft()
        r = sum(h[1] for h in self.hist)
        lo = sum(h[2] for h in self.hist)
        return {"type": "stats", "fs": self.framer.fs if self.framer else None, "lossPct": round(100.0 * lo / max(1, r + lo), 3),
                "lostTotal": self.framer.lost_out if self.framer else 0, "link": self.link, "uptimeS": round(now - self.started, 1), "clientDrops": self.client_drops}

    def _rate_decide(self):
        tr = self.rate_trial
        self.rate_trial = None
        loss = tr["lost"] / max(1, tr["recv"] + tr["lost"])
        rate = tr["rate"]
        if loss < 0.01 or len(self.rate_plan) <= 1:
            if loss >= 0.01:
                self.rate_warning = "Data loss was 1% or more at every rate. Using %d Hz." % rate
                self.warnings.append(self.rate_warning)
            try:
                os.makedirs(os.path.dirname(self.state_file), exist_ok=True)
                with open(self.state_file, "w") as f:
                    json.dump({"rate": rate}, f)
            except Exception:
                pass
            self.status("streaming", "wifi %g Hz (loss %.2f%%)" % (self.framer.fs, 100 * loss))
            return
        log.info("rate %d Hz lost %.2f%%, trying the next rate", rate, 100 * loss)
        self.rate_plan = [r for r in self.rate_plan if r != rate] or [250]
        self.rate_plan = sorted(self.rate_plan, reverse=True)
        self._close()
        self._open()

    def _data(self):
        if not self.raw_buf:
            return None
        return np.array(self.raw_buf).T

    def _ecg_check(self):
        d = self._data()
        if d is None or d.shape[1] < self.framer.fs * 10:
            return
        info = ecg_detect(d, self.framer.fs, self.ecg_configured, eeg_idx=[c for c in range(16) if c < self.info["n_ch"]])
        prev = self.ecg_channel
        self.ecg_info = info
        if info["detected"]:
            self.ecg_channel = info["channel"]
            if info["moved"]:
                self.warnings.append("ECG found on channel %d, not on channel %d" % (info["channel"] + 1, self.ecg_configured + 1))
        else:
            self.ecg_channel = -1
        if self.ecg_channel != prev:
            names = list(DEFAULT_NAMES)
            if self.ecg_channel >= 0:
                names[self.ecg_channel] = "ECG"
            unused = [c for c in self.cfg["unusedChannels"] if c != self.ecg_channel]
            if self.ecg_configured >= 0 and self.ecg_channel != self.ecg_configured and self.ecg_configured not in unused:
                unused.append(self.ecg_configured)
            self.cfg.update(channels=names, ecgChannel=self.ecg_channel, unusedChannels=sorted(unused))
            self.send("json", self.cfg)
        self._selfcheck()

    def _selfcheck(self):
        d = self._data()
        fs = self.framer.fs
        n_ch = self.info["n_ch"]
        per = []
        if d is not None and d.shape[1] >= fs * 2:
            for c in range(16):
                r = channel_check(d[c], fs, self.args.mains)
                r["name"] = self.cfg["channels"][c]
                per.append(r)
        daisy = n_ch >= 16 and (d is None or bool(np.any(d[8:16] != 0)))
        acc = {"present": bool(self.accel_seen), "reason": None if self.accel_seen else ("no accelerometer channel" if not self.info["accel"] else "no non-zero accelerometer rows yet")}
        if not self.accel_seen and self.clock() - self.stream_t0 < 10:
            acc["reason"] = "checking"
        meas = measured_rate(list(self.ts_buf)[-int(fs * 20):]) if len(self.ts_buf) > fs * 5 else None
        self.measured = meas
        st = self.stats()
        alias = alias_check(d, fs, self.args.mains, eeg_idx=[c for c in range(16) if c != self.ecg_channel and c < n_ch]) if d is not None and d.shape[1] >= fs * 8 else {"checked": False, "freqHz": None, "ratio": None, "warn": False}
        ftdi = ftdi_check(list(self.ts_buf)[-int(fs * 10):]) if self.link == "dongle" and len(self.ts_buf) > fs * 5 else {"checked": False, "burstMs": None, "warn": False, "fix": None}
        ecg = {"configured": self.ecg_configured + 1 if self.ecg_configured >= 0 else 0, "detected": bool(self.ecg_info and self.ecg_info["detected"]),
               "channel": self.ecg_channel + 1 if self.ecg_channel >= 0 else 0, "kurtosis": self.ecg_info and self.ecg_info["kurtosis"],
               "acPeak": self.ecg_info and self.ecg_info["acPeak"], "bpm": self.ecg_info and self.ecg_info["bpm"], "moved": bool(self.ecg_info and self.ecg_info["moved"])}
        warns = list(dict.fromkeys(self.warnings))
        if alias["warn"]:
            warns.append("Mains hum folds into theta at 125 Hz (%g Hz). Theta-based scores get lower confidence." % alias["freqHz"])
        if ftdi["warn"]:
            warns.append("USB dongle latency is high. " + FTDI_FIX)
        if not daisy:
            warns.append("Daisy board not found: running with 8 channels.")
        sc = {"type": "selfcheck", "daisy": daisy, "nCh": n_ch, "perChannel": per, "accel": acc,
              "rate": {"requested": self.args.rate if self.link == "wifi" else (self.args.sim_rate if self.link == "sim" else 125), "measured": meas, "lossPct": st["lossPct"]},
              "alias": alias, "ftdi": ftdi, "ecg": ecg, "warnings": warns}
        key = json.dumps({k: v for k, v in sc.items() if k != "perChannel"}, sort_keys=True, default=str)
        self.sc_count = getattr(self, "sc_count", 0) + 1
        if self.selfcheck is None or key != getattr(self, "_sc_key", None) or self.sc_count <= 2:
            self._sc_key = key
            self.selfcheck = sc
            self.send("json", sc)
            log.info("selfcheck: daisy=%s accel=%s rate=%s loss=%.2f%% alias=%s ftdi=%s ecg=%s warnings=%s", daisy, acc["present"], meas, st["lossPct"],
                     alias.get("warn"), ftdi.get("warn"), ecg["channel"] or "none", warns)

    # ---- impedance sweep
    def start_impedance(self):
        if self.board is None or self.imp:
            return
        self.imp = {"ch": 0, "phase": "on", "t": self.clock(), "results": [], "n0": None}
        self.framer.impedance = True
        self.status("impedance", "contact check running")

    def stop_impedance(self):
        if not self.imp:
            return
        ch = self.imp["ch"]
        if ch < 16:
            try:
                self.board.config("z%s00Z" % CH_CODES[ch])
            except Exception:
                pass
        res = self.imp["results"]
        self.imp = None
        self.framer.impedance = False
        self.send("json", {"type": "impedance_done", "results": res})
        self.status("streaming", "%s %g Hz" % (self.link, self.framer.fs))

    def _imp_step(self, now):
        im = self.imp
        eeg = [c for c in range(self.info["n_ch"]) if c != self.ecg_channel]
        if im["ch"] not in eeg:
            im["ch"] += 1
            if im["ch"] >= 16:
                self.stop_impedance()
            return
        c = im["ch"]
        if im["phase"] == "on":
            self.board.config("z%s01Z" % CH_CODES[c])
            im["phase"] = "wait"
            im["t"] = now
        elif im["phase"] == "wait" and now - im["t"] >= 0.5:
            im["phase"] = "collect"
            im["t"] = now
            im["n0"] = len(self.raw_buf)
        elif im["phase"] == "collect" and now - im["t"] >= 1.5:
            d = self._data()
            n = min(len(self.raw_buf) - 0, int(self.framer.fs * 1.5))
            x = d[c, -n:] if d is not None and n > 16 else np.zeros(16)
            y = band(x - x.mean(), 28.0, 35.0, self.framer.fs) if len(x) > 30 else x
            rms = float(np.sqrt(np.mean(y * y)))
            r = {"type": "impedance", "channel": c, "name": self.cfg["channels"][c], "kohm": round(impedance_kohm(rms), 1), "rmsUv": round(rms, 2)}
            im["results"].append(r)
            self.send("json", r)
            self.board.config("z%s00Z" % CH_CODES[c])
            im["ch"] += 1
            im["phase"] = "on"
            if im["ch"] >= 16:
                self.stop_impedance()

    def command(self, msg):
        cmd = msg.get("cmd")
        if cmd == "ping":
            return {"type": "pong"}
        if cmd == "impedance_sweep":
            self.start_impedance()
        elif cmd == "stop_impedance":
            self.stop_impedance()
        elif cmd == "set_ecg_channel":
            ch = int(msg.get("channel", 0))
            self.ecg_configured = ch - 1 if ch > 0 else -1
            self.ecg_channel = self.ecg_configured
            self.ecg_info = None
            self._close()
            self.retry_at = None
        elif cmd == "restart":
            self._close()
            self.retry_at = None
        elif cmd == "shutdown":
            return "shutdown"
        return None


# ---------------------------------------------------------------- WebSocket server
async def serve(args, ready=None, board_factory=None):
    from websockets.asyncio.server import serve as ws_serve  # modern API
    clients = {}
    max_q = 50   # 2 s of 40 ms frames
    stop = asyncio.Event()
    helper = None

    loop = asyncio.get_running_loop()
    loop_thread = threading.get_ident()

    def send(kind, payload):
        if threading.get_ident() != loop_thread:          # called from the board-opening thread: hand it to the event loop
            loop.call_soon_threadsafe(send, kind, payload)
            return
        msg = payload if kind == "bin" else json.dumps(payload)
        for ws, q in list(clients.items()):
            if kind == "bin" and q.qsize() >= max_q:
                try:
                    q.get_nowait()
                    helper.client_drops += 1
                except asyncio.QueueEmpty:
                    pass
            q.put_nowait(msg)

    def factory(link):
        if args.simulate or link == "sim":
            return SimBoard(rate=args.sim_rate, seed=args.sim_seed, script=args.sim_script, loss=args.sim_loss, accel=not args.sim_no_accel,
                            ecg_on=0 if args.sim_no_ecg else (args.sim_ecg_on or 9))
        return BrainFlowBoard(link, ip=args.ip, ip_port=args.ip_port, serial_port=args.serial_port)

    helper = Helper(args, board_factory or factory, send=send)

    async def writer(ws, q):
        try:
            while True:
                m = await q.get()
                await ws.send(m)
        except Exception:
            pass

    async def handler(ws):
        q = asyncio.Queue()
        clients[ws] = q
        q.put_nowait(json.dumps({"type": "hello", "proto": PROTO, "helper": "cyton_helper", "version": VERSION, "simulated": bool(args.simulate)}))
        q.put_nowait(json.dumps({"type": "status", "state": helper.state, "link": helper.link, "detail": helper.status_detail, "t": time.time()}))
        if helper.cfg:
            q.put_nowait(json.dumps(helper.cfg))
        if helper.selfcheck:
            q.put_nowait(json.dumps(helper.selfcheck))
        wt = asyncio.ensure_future(writer(ws, q))
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except Exception:
                    continue
                if msg.get("type") != "cmd":
                    continue
                r = helper.command(msg)
                if r == "shutdown":
                    stop.set()
                elif r:
                    q.put_nowait(json.dumps(r))
        except Exception:
            pass
        finally:
            wt.cancel()
            clients.pop(ws, None)

    async with ws_serve(handler, "127.0.0.1", args.ws_port, max_size=2 ** 20) as server:
        port = list(server.sockets)[0].getsockname()[1]
        log.info("helper listening on ws://127.0.0.1:%d (%s)", port, "simulated board" if args.simulate else "link " + args.link)
        if ready:
            ready(port)
        t_end = time.monotonic() + args.run_seconds if args.run_seconds else None
        seen = time.monotonic()                  # last time a panel was connected (for --exit-when-idle)
        opening = None                           # the board-opening thread (daemon: a shutdown never waits for a slow WiFi search)

        def open_step():
            try:
                helper.step()
            except Exception as e:
                log.exception("opening the board failed: %s", e)
                helper._close()
                helper.retry_at = time.monotonic() + 2
        try:
            while not stop.is_set():
                if clients:
                    seen = time.monotonic()
                elif args.exit_when_idle and time.monotonic() - seen > args.exit_when_idle:
                    log.info("no panel connected for %d s: exiting", args.exit_when_idle)
                    break
                try:
                    if opening is not None and opening.is_alive():
                        pass                             # still opening: the loop keeps serving the panel and watching for shutdown
                    elif helper.opening_due() and not args.simulate:
                        # opening a real board blocks for seconds (WiFi discovery up to 20 s, 16 channel settings): run it in a thread
                        # so the WebSocket keeps answering the panel ("is the helper running?") and Disconnect stops the helper at once
                        opening = threading.Thread(target=open_step, name="open-board", daemon=True)
                        opening.start()
                    else:
                        opening = None
                        helper.step()
                except Exception as e:
                    log.exception("helper step failed: %s", e)
                    helper._close()
                    helper.retry_at = time.monotonic() + 2
                if t_end and time.monotonic() >= t_end:
                    break
                try:
                    await asyncio.wait_for(stop.wait(), timeout=0.02)
                except asyncio.TimeoutError:
                    pass
        finally:
            helper.shutdown()            # stop_stream + release_session on exit, Ctrl+C or cmd shutdown
        await asyncio.sleep(0.05)
    return 0


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="OpenBCI Cyton + Daisy -> WebSocket helper for the Muse 2 panel")
    p.add_argument("--link", choices=["auto", "wifi", "dongle"], default="auto")
    p.add_argument("--ip", default=None)
    p.add_argument("--ip-port", type=int, default=3000)
    p.add_argument("--serial-port", default=None)
    p.add_argument("--rate", choices=["auto", "250", "500", "1000"], default="auto")
    p.add_argument("--ecg-channel", type=int, default=9)
    p.add_argument("--mains", type=int, choices=[50, 60], default=60)
    p.add_argument("--ws-port", type=int, default=8766)
    p.add_argument("--simulate", action="store_true")
    p.add_argument("--sim-rate", type=int, choices=[125, 250, 500, 1000], default=125)
    p.add_argument("--sim-seed", type=int, default=1)
    p.add_argument("--sim-script", choices=["default", "quiet", "artifacts", "validation"], default="default")
    p.add_argument("--sim-loss", type=float, default=0.0)
    p.add_argument("--sim-no-accel", action="store_true")
    p.add_argument("--sim-no-ecg", action="store_true")
    p.add_argument("--sim-ecg-on", type=int, default=0)
    p.add_argument("--run-seconds", type=float, default=0)
    p.add_argument("--log-level", default="info")
    p.add_argument("--from-url", default=None, help="started from the panel's musecyton: link, e.g. musecyton:wifi?ip=192.168.4.1")
    p.add_argument("--exit-when-idle", type=float, default=0, help="exit when no panel has been connected for this many seconds")
    p.add_argument("--log-file", default=None)
    a = p.parse_args(argv)
    if a.from_url:
        apply_url(a, a.from_url)
    return a


def apply_url(a, url):
    """musecyton:wifi[?ip=A.B.C.D] -> --link wifi [--ip A.B.C.D]. Anything else in the link is ignored (it comes from a web page)."""
    from urllib.parse import urlsplit, parse_qs
    import ipaddress
    u = urlsplit(url.strip().strip('"'))
    if u.scheme.lower() != "musecyton":
        return a
    what = (u.path or u.netloc or "").strip("/").lower()
    if what in ("wifi", "dongle"):
        a.link = what
    ip = (parse_qs(u.query).get("ip") or [None])[0]
    if ip:
        try:
            a.ip = str(ipaddress.ip_address(ip))
        except ValueError:
            pass
    return a


def main(argv=None):
    args = parse_args(argv)
    level = getattr(logging, args.log_level.upper(), logging.INFO)
    if args.log_file or sys.stderr is None:      # started without a console (pythonw from the musecyton: link): log to a file
        path = args.log_file or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".tmp", "cyton_helper.log")
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(message)s", filename=path, filemode="w")
    else:
        logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(message)s")
    try:
        return asyncio.run(serve(args))
    except KeyboardInterrupt:
        return 0
    except OSError as e:
        log.error("Could not start the helper: %s (is another helper already running on port %d?)", e, args.ws_port)
        return 1


if __name__ == "__main__":
    sys.exit(main())
