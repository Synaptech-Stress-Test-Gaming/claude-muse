"""Receives the Muse 2 panel's game feed over a tiny local-only web server (127.0.0.1:8765).

The panel POSTs JSON about 4 times a second. The first fields keep their old meaning:
    {"focus": 63.2, "mode": "focus", "sensors": [96, 96, 97, 72], "motion": "VALID", "stale": false, ...}
focus is null when there is no valid reading (never 0 for a missing value).
Game link v2 adds: v, session, seq, device ("muse"|"cyton"), engine ("new"|"legacy"), profile {label, conf},
metrics {focus, stress, drowsiness} (each {value, conf, state, reason}), events (button events: double_blink, clench_tap, each with an id)
and legacy {focus, stress}. Events are resent by the panel until acknowledged: the reply is {"ok": true, "ack": <highest id received>}.
read() is unchanged: (state, focus, sensors). Same protocol the Animal Stacker prototype uses."""
import collections
import json
import math
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LINK_HOST, LINK_PORT, LINK_TIMEOUT = "127.0.0.1", 8765, 2.0
MAX_BODY = 8192


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


class HeadbandLink:
    def __init__(self, host=LINK_HOST, port=LINK_PORT):
        self.lock = threading.Lock()
        self.focus = None        # 0-100 or None
        self.sensors = [None] * 4
        self.stamp = 0.0
        self.metrics = None      # v2: {"focus": {...}, "stress": {...}, "drowsiness": {...}|None} or None
        self.device = None
        self.engine = None
        self.profile = None
        self.legacy = None
        self.events = collections.deque(maxlen=256)
        self.seen = {}           # session -> highest event id delivered
        self.server = None
        self.port = None
        link = self

        class Handler(BaseHTTPRequestHandler):
            def _reply(self, code=200, body=b'{"ok":true}'):
                self.send_response(code)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_OPTIONS(self):
                self._reply(204, b"")

            def do_GET(self):
                self._reply()

            def do_POST(self):
                try:
                    n = min(int(self.headers.get("Content-Length", "0")), MAX_BODY)
                    data = json.loads(self.rfile.read(n) or b"{}")
                    raw = data.get("focus")
                    focus = None
                    if _num(raw):
                        focus = max(0.0, min(100.0, float(raw)))
                    sens = data.get("sensors")
                    clean = [None] * 4
                    if isinstance(sens, list):
                        for i, v in enumerate(sens[:4]):
                            if _num(v):
                                clean[i] = max(0.0, min(100.0, float(v)))
                    link.push(focus, clean)
                    ack = link.push_v2(data)          # malformed v2 fields are ignored one by one
                    self._reply(200, json.dumps({"ok": True, "ack": ack} if ack is not None else {"ok": True}).encode())
                except Exception:
                    self._reply(400, b'{"ok":false}')

            def log_message(self, *a):
                pass

        try:
            self.server = ThreadingHTTPServer((host, port), Handler)
            self.server.daemon_threads = True
            self.port = self.server.server_address[1]
            threading.Thread(target=self.server.serve_forever, daemon=True).start()
        except OSError:
            self.server = None   # port busy

    def push(self, focus, sensors):
        with self.lock:
            self.focus, self.sensors, self.stamp = focus, sensors, time.monotonic()

    def push_v2(self, data):
        """Store the v2 fields (each one checked on its own) and queue new events. Returns the highest event id received, or None."""
        if not isinstance(data, dict) or data.get("v") != 2:
            return None
        with self.lock:
            try:
                m = data.get("metrics")
                if m is None or isinstance(m, dict):
                    self.metrics = m
            except Exception:
                pass
            for key in ("device", "engine"):
                v = data.get(key)
                if isinstance(v, str):
                    setattr(self, key, v)
            p = data.get("profile")
            if p is None or (isinstance(p, dict) and isinstance(p.get("label", ""), str)):
                self.profile = p
            lg = data.get("legacy")
            if isinstance(lg, dict):
                self.legacy = lg
            session = data.get("session")
            ack = None
            ev = data.get("events")
            if isinstance(ev, list):
                last = self.seen.get(session, 0)
                for e in ev:
                    if not isinstance(e, dict) or not isinstance(e.get("id"), int) or isinstance(e.get("id"), bool):
                        continue
                    ack = e["id"] if ack is None else max(ack, e["id"])
                    if e["id"] > last and isinstance(e.get("type"), str):
                        self.events.append(dict(e, session=session))
                        last = e["id"]
                self.seen[session] = last
                if ack is None:
                    ack = last
            return ack

    def pop_events(self):
        """The button events received since the last call (each delivered once), oldest first."""
        with self.lock:
            out = list(self.events)
            self.events.clear()
        return out

    def read(self):
        """(state, focus, sensors). state: 'off' (panel silent), 'waiting' (no valid reading yet), 'live'."""
        with self.lock:
            focus, sensors, stamp = self.focus, list(self.sensors), self.stamp
        if stamp == 0.0 or time.monotonic() - stamp > LINK_TIMEOUT:
            return "off", None, [None] * 4
        if focus is None:
            return "waiting", None, sensors
        return "live", focus, sensors
