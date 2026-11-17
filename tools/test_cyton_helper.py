"""Tests for tools/cyton_helper.py (H1-H10). Plain Python, no pytest, no BrainFlow needed.
Run: python tools/test_cyton_helper.py"""
import asyncio
import json
import math
import os
import sys
import tempfile
import threading
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cyton_helper as H  # noqa: E402

fails = 0


def ok(cond, msg):
    global fails
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        fails += 1


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def args(**kw):
    a = H.parse_args([])
    for k, v in kw.items():
        setattr(a, k, v)
    return a


# ---------------- H1 frame round trip + reference hex
rng = np.random.default_rng(1)
for N in (5, 10):
    for A in (0, 2):
        data = rng.standard_normal((16, N)).astype(np.float32) * 100
        acc = [(k, 0.01 * k, -0.5, 1.0) for k in range(A)]
        buf = H.encode_frame(data, acc, 123456789, 1731490000.25, 77, 250.0, H.FLAG_SIM)
        d = H.decode_frame(buf)
        same = np.array_equal(d["data"], data) and d["N"] == N and d["A"] == A and d["sampleIndex"] == 123456789 and d["lostTotal"] == 77 and d["fs"] == 250.0
        same = same and all(abs(a[1] - b[1]) < 1e-7 and a[0] == b[0] for a, b in zip(d["accel"], acc))
        ok(same and len(buf) == 32 + 4 * 16 * N + 16 * A, "H1 round trip bit-exact C=16 N=%d A=%d" % (N, A))
buf = H.encode_frame(np.zeros((16, 3), np.float32), [(1, 0.5, 0.25, 1.0)], 42, 12.5, 3, 125.0, 0)
ok(buf[0] == 0xCB and buf[1] == 1 and buf[2] == 1 and buf[3] == 16 and int.from_bytes(buf[4:6], "little") == 3 and buf[6] == 1 and buf[7] == H.FLAG_ACCEL
   and int.from_bytes(buf[8:16], "little") == 42 and np.frombuffer(buf[16:24], "<f8")[0] == 12.5 and int.from_bytes(buf[24:28], "little") == 3
   and np.frombuffer(buf[28:32], "<f4")[0] == 125.0, "H1 header fields at the documented offsets")
try:
    H.decode_frame(buf[:-1])
    ok(False, "H1 truncated frame rejected")
except ValueError:
    ok(True, "H1 truncated frame rejected")
# reference frame for adapters/cyton.test.js: C=16, N=4, A=2, value = c*10 + i + 0.25 (exact in float32)
ref = np.array([[c * 10 + i + 0.25 for i in range(4)] for c in range(16)], dtype=np.float32)
ref_buf = H.encode_frame(ref, [(0, 0.5, -0.25, 1.0), (3, 0.125, 0.0, -1.0)], 1000, 1731490000.5, 7, 125.0, H.FLAG_SIM | H.FLAG_GAP)
os.makedirs(os.path.join(HERE, "testdata"), exist_ok=True)
with open(os.path.join(HERE, "testdata", "frame_v1.hex"), "w") as f:
    f.write(ref_buf.hex() + "\n")
ok(os.path.getsize(os.path.join(HERE, "testdata", "frame_v1.hex")) > 100, "H1 wrote tools/testdata/frame_v1.hex")

# ---------------- H2 rate ladder
ok(H.choose_rate(lambda r: {1000: 0.03, 500: 0.004, 250: 0}[r])[0] == 500, "H2 loss {1000:3%,500:0.4%,250:0} -> 500")
ok(H.choose_rate(lambda r: {1000: 0.002}.get(r, 0))[0] == 1000, "H2 loss {1000:0.2%} -> 1000")
r, w, _ = H.choose_rate(lambda r: 0.05)
ok(r == 250 and w and "250" in w, "H2 all >= 1% -> 250 with a warning")
# the same ladder through the helper loop with the simulated board on the WiFi path
clk = Clock()
tmp = tempfile.mkdtemp()
sent = []
hp = H.Helper(args(link="wifi", rate="auto", simulate=False, state_file=os.path.join(tmp, "s.json")),
              lambda link: H.SimBoard(rate=125, script="quiet", loss_table={1000: 0.03, 500: 0.004, 250: 0.0}, clock=clk, accel=False, ecg_on=0, seed=3),
              clock=clk, send=lambda k, p: sent.append((k, p)))
for _ in range(int(50 / 0.1)):
    hp.step()
    clk.t += 0.1
cfgs = [p for k, p in sent if k == "json" and p.get("type") == "config"]
ok(hp.framer.board_fs == 500 and hp.state == "streaming" and cfgs[-1]["fs"] == 250 and cfgs[-1]["streamId"] == 2,
   "H2 helper loop: 1000 Hz rejected, 500 Hz accepted, new streamId announced (board %s, out %s)" % (hp.framer.board_fs, cfgs[-1]["fs"]))
ok(json.load(open(os.path.join(tmp, "s.json")))["rate"] == 500, "H2 accepted rate remembered for next time")

# ---------------- H3 decimation
fsb = 1000
t = np.arange(fsb * 4) / fsb
for f0, want in ((10.0, "keep"), (180.0, "kill")):
    fr = H.Framer(fsb, 16)
    x = np.tile(100 * np.sin(2 * np.pi * f0 * t), (16, 1))
    out = []
    for fb in fr.push(np.arange(len(t)) % 256, x, None, t):
        out.append(H.decode_frame(fb)["data"])
    for fb in fr.flush():
        out.append(H.decode_frame(fb)["data"])
    y = np.concatenate(out, axis=1)[0]
    ok(fr.fs == 250 and fr.decim == 4, "H3 1000 Hz board -> 250 Hz output") if f0 == 10 else None
    amp = math.sqrt(2) * np.std(y[250:])
    if want == "keep":
        ok(abs(amp - 100) / 100 < 0.02, "H3 10 Hz amplitude kept within 2%% (%.2f)" % amp)
    else:
        ok(20 * math.log10(amp / 100) <= -40, "H3 180 Hz attenuated %.1f dB (>= 40)" % (20 * math.log10(amp / 100)))

# ---------------- H4 gaps
clk = Clock()
sb = H.SimBoard(rate=125, script="quiet", loss=0.02, clock=clk, seed=5)
sb.start(125)
fr = H.Framer(125, 16)
recv, frames = 0, []
for _ in range(600):
    clk.t += 0.1
    rows = sb.read()
    if rows is None:
        continue
    recv += len(rows[0])
    frames += [H.decode_frame(b) for b in fr.push(*rows)]
frames += [H.decode_frame(b) for b in fr.flush()]
cont, span_ok = True, True
expect = frames[0]["sampleIndex"]
lost_seen = 0
for d in frames:
    if d["sampleIndex"] != expect:
        if not (d["flags"] & H.FLAG_GAP):
            cont = False
        lost_seen += d["sampleIndex"] - expect
    expect = d["sampleIndex"] + d["N"]
ok(fr.lost_out > 0 and cont, "H4 every jump in sampleIndex is flagged as a gap (frames never span a gap)")
ok(lost_seen == fr.lost_out == frames[-1]["lostTotal"], "H4 sampleIndex advances by exactly the lost count (%d), lostTotal matches" % lost_seen)
ok(sum(d["N"] for d in frames) == recv, "H4 no interpolation: frame samples (%d) = received rows (%d)" % (sum(d["N"] for d in frames), recv))
ok(0.005 < fr.lost_out / (recv + fr.lost_out) < 0.05, "H4 loss about 2%% (%.2f%%)" % (100 * fr.lost_out / (recv + fr.lost_out)))


# ---------------- H5 ECG auto-detect

# ---- the panel's musecyton: link
a = H.parse_args(["--from-url", "musecyton:wifi?ip=192.168.4.1"])
ok(a.link == "wifi" and a.ip == "192.168.4.1", "musecyton:wifi?ip=... -> --link wifi --ip 192.168.4.1")
a = H.parse_args(["--from-url", "musecyton:wifi?ip=1.2.3.4;calc.exe"])
ok(a.link == "wifi" and a.ip is None, "a bad ip in the link is ignored")
a = H.parse_args(["--from-url", "https://example.com/wifi"])
ok(a.link == "auto", "other schemes are ignored")
a = H.parse_args(["--exit-when-idle", "5"])
ok(a.exit_when_idle == 5.0, "--exit-when-idle parsed")

def sim_data(seconds=20, **kw):
    clk = Clock()
    b = H.SimBoard(clock=clk, accel=False, **kw)
    b.start(125)
    clk.t += seconds
    c, x, a, ts = b.read()
    return x


d = sim_data(script="quiet", ecg_on=9)
e = H.ecg_detect(d, 125, 8)
ok(e["detected"] and e["channel"] == 8 and not e["moved"], "H5 ECG on channel 9 detected on 9 (kurt %s, ac %s)" % (e["kurtosis"], e["acPeak"]))
d = sim_data(script="quiet", ecg_on=12)
e = H.ecg_detect(d, 125, 8)
ok(e["detected"] and e["channel"] == 11 and e["moved"], "H5 --sim-ecg-on 12 -> detected on 12 with moved:true")
d = sim_data(script="quiet", ecg_on=0)
ok(H.ecg_detect(d, 125, 8)["channel"] == -1, "H5 --sim-no-ecg -> ecgChannel -1")
# a blink-only channel (high kurtosis, not periodic) is not chosen
rg = np.random.default_rng(9)
d = sim_data(seconds=30, script="quiet", ecg_on=0)
tt = np.arange(d.shape[1]) / 125
tb = np.cumsum(rg.uniform(2, 5, 12))
for t0 in tb:
    d[0] += 300 * np.where((tt > t0) & (tt < t0 + 0.3), 0.5 - 0.5 * np.cos(2 * np.pi * (tt - t0) / 0.3), 0)
k, ac, _ = H.ecg_metrics(d[0], 125)
ok(H.ecg_detect(d, 125, 8)["channel"] == -1, "H5 blink-only channel not chosen (kurt %.1f, ac %.2f)" % (k, ac))

# ---------------- H6 alias check
d = sim_data(script="quiet", ecg_on=0, extra_line=(5.0, 6.0))
a = H.alias_check(d, 125, 60)
ok(a["warn"] and a["freqHz"] == 5.0, "H6 5 Hz line of 6 uV at 125 Hz -> warn (ratio %s)" % a["ratio"])
d = sim_data(script="quiet", ecg_on=0)
a = H.alias_check(d, 125, 60)
ok(not a["warn"], "H6 no line -> no warn (ratio %s)" % a["ratio"])
ok(not H.alias_check(d, 250, 60)["checked"], "H6 alias check only at 125 Hz")

# ---------------- H7 reconnect
clk = Clock()
sent = []
hp = H.Helper(args(simulate=True, sim_script="quiet"), lambda link: H.SimBoard(rate=125, script="quiet", clock=clk, stall=(clk.t + 10, 5.0)), clock=clk, send=lambda k, p: sent.append((k, p)))
for _ in range(400):
    hp.step()
    clk.t += 0.05
states = [p["state"] for k, p in sent if k == "json" and p.get("type") == "status"]
seq = [s for i, s in enumerate(states) if i == 0 or s != states[i - 1]]
sids = [p["streamId"] for k, p in sent if k == "json" and p.get("type") == "config"]
ok("reconnecting" in seq and seq.index("reconnecting") > seq.index("streaming") and seq[-1] == "streaming", "H7 streaming -> reconnecting -> streaming (%s)" % " > ".join(seq))
ok(sids[-1] == sids[0] + 1, "H7 a new streamId is announced after the reconnect (%s)" % sids)


# ---------------- H8 end to end over WebSocket
async def e2e():
    from websockets.asyncio.client import connect
    a = args(simulate=True, run_seconds=4, ws_port=0, sim_script="default")
    port_box = {}
    ready = asyncio.Event()

    def on_ready(p):
        port_box["p"] = p
        ready.set()

    srv = asyncio.ensure_future(H.serve(a, ready=on_ready))
    await asyncio.wait_for(ready.wait(), 5)
    got = {"hello": 0, "config": 0, "stats": 0, "pong": 0, "frames": []}
    async with connect("ws://127.0.0.1:%d" % port_box["p"]) as ws:
        await ws.send(json.dumps({"type": "cmd", "cmd": "ping"}))
        t_end = time.monotonic() + 3.3
        while time.monotonic() < t_end:
            try:
                m = await asyncio.wait_for(ws.recv(), 0.5)
            except asyncio.TimeoutError:
                continue
            except Exception:
                break
            if isinstance(m, bytes):
                got["frames"].append(H.decode_frame(m))
            else:
                j = json.loads(m)
                if j["type"] in got:
                    got[j["type"]] += 1
    rc = await srv
    return got, rc


got, rc = asyncio.run(e2e())
fr = got["frames"]
cont = all(fr[i]["sampleIndex"] == fr[i - 1]["sampleIndex"] + fr[i - 1]["N"] for i in range(1, len(fr)))
ok(got["hello"] == 1 and got["config"] >= 1, "H8 hello and config received")
ok(len(fr) >= 50 and cont, "H8 %d data frames with continuous sampleIndex" % len(fr))
ok(got["stats"] >= 1 and got["pong"] == 1 and rc == 0, "H8 stats received, ping -> pong, clean exit")

# ---------------- H9 FTDI latency
ts = []
t0 = 0.0
for k in range(625):           # rows arriving in bursts every 16 ms
    ts.append(t0 + (k // 2) * 0.016)
f = H.ftdi_check(ts)
ok(f["warn"] and "Latency Timer" in f["fix"], "H9 16 ms bursts -> warn with the fix text (burst %s ms)" % f["burstMs"])
ok(not H.ftdi_check([k * 0.001 for k in range(10000)])["warn"], "H9 1 ms spacing -> no warn")

# ---------------- H10 impedance formula
fs = 250
t = np.arange(int(fs * 1.5)) / fs
x = 100 * math.sqrt(2) * np.sin(2 * np.pi * 31.5 * t)
y = H.band(x, 28, 35, fs)
k = H.impedance_kohm(float(np.sqrt(np.mean(y[50:-50] ** 2))))
ok(abs(k - 23.570) / 23.570 < 0.01, "H10 31.5 Hz sine of 100 uV RMS -> %.3f kOhm (23 570 Ohm, +/- 1%%)" % k)

print("all passed" if not fails else "%d FAILED" % fails)
sys.exit(1 if fails else 0)
