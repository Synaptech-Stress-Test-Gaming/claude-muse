"""Tests for game-py/link.py (game link v2). Plain Python. Run: python game-py/test_link.py"""
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from link import HeadbandLink  # noqa: E402

fails = 0


def ok(c, msg):
    global fails
    print(("PASS " if c else "FAIL ") + msg)
    if not c:
        fails += 1


link = HeadbandLink(port=0)
URL = "http://127.0.0.1:%d/" % link.port


def post(body, raw=None):
    data = raw if raw is not None else json.dumps(body).encode()
    req = urllib.request.Request(URL, data=data, method="POST", headers={"Content-Type": "text/plain"})
    try:
        with urllib.request.urlopen(req, timeout=3) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, None


s, r = post({"focus": 63.2, "sensors": [96, 96, 97, 72]})
st = link.read()
ok(s == 200 and st[0] == "live" and st[1] == 63.2 and st[2] == [96, 96, 97, 72], "a v1 body still gives ('live', 63.2, [96, 96, 97, 72])")
ok(link.metrics is None and link.pop_events() == [], "v1 body: no metrics, no events")
big = {"focus": 55.0, "mode": "focus", "sensors": [90, 91, 92, 93], "motion": "VALID", "stale": False, "v": 2, "session": 1, "seq": 1, "device": "cyton", "engine": "new",
       "profile": {"label": "Julian", "conf": 0.8}, "metrics": {"focus": {"value": 55.0, "conf": 0.7, "state": "live"}, "stress": {"value": None, "conf": 0, "state": "stale", "reason": "movement"}, "drowsiness": None},
       "events": [{"id": i, "type": "double_blink", "t": i * 1.0, "conf": 0.9} for i in range(1, 33)], "legacy": {"focus": 50.1, "stress": None}, "pad": "x" * 3700}
body = json.dumps(big).encode()
s, r = post(None, raw=body)
ok(s == 200 and 5500 < len(body) < 8192 and link.read()[1] == 55.0, "a v2 body of %d bytes is accepted" % len(body))
ok(link.metrics["focus"]["state"] == "live" and link.device == "cyton" and link.engine == "new" and link.profile["label"] == "Julian" and link.legacy["focus"] == 50.1, "metrics, device, engine, profile and legacy are exposed")
ev = link.pop_events()
ok(len(ev) == 32 and ev[0]["id"] == 1 and r.get("ack") == 32, "events exposed, ack returned (%s)" % r.get("ack"))
big2 = dict(big, events=[{"id": i, "type": "clench_tap", "t": 1.0, "conf": 0.8} for i in range(30, 36)], seq=2)
del big2["pad"]
s, r = post(big2)
ev = link.pop_events()
ok([e["id"] for e in ev] == [33, 34, 35] and r["ack"] == 35, "duplicate event ids are delivered once (resent ids 30-32 dropped)")
s, r = post(dict(big2, session=2, events=[{"id": 1, "type": "double_blink", "t": 0.5, "conf": 0.9}]))
ok([e["id"] for e in link.pop_events()] == [1], "a new panel session resets the last id")
s, r = post({"focus": 40.0, "sensors": [1, 2, 3, 4], "v": 2, "metrics": "garbage", "events": "nope", "profile": 5})
ok(s == 200 and link.read()[1] == 40.0, "a malformed metrics field does not lose focus")
s, _ = post(None, raw=json.dumps({"focus": 30.0, "pad": "y" * 9000}).encode())
s2, _ = post({"focus": 31.0, "sensors": [1, 1, 1, 1]})
ok(s2 == 200 and link.read()[1] == 31.0, "a 9 KB body does not crash the server (status %s, then the next post works)" % s)
post({"focus": None, "sensors": [1, 1, 1, 1]})
ok(link.read()[0] == "waiting", "focus: null -> 'waiting'")
print("all passed" if not fails else "%d FAILED" % fails)
link.server.shutdown()
sys.exit(1 if fails else 0)
