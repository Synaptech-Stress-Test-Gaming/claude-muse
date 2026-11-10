"""Receives the Muse 2 panel's focus meter over a tiny local-only web server (127.0.0.1:8765).

The panel POSTs JSON such as {"focus": 63.2, "sensors": [96, 96, 97, 72]} about 4 times a second.
focus is null until the panel's baselines are set. Same protocol the Animal Stacker prototype uses."""
import json
import math
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LINK_HOST, LINK_PORT, LINK_TIMEOUT = "127.0.0.1", 8765, 2.0


class HeadbandLink:
    def __init__(self, host=LINK_HOST, port=LINK_PORT):
        self.lock = threading.Lock()
        self.focus = None        # 0-100 or None
        self.sensors = [None] * 4
        self.stamp = 0.0
        self.server = None
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
                    n = min(int(self.headers.get("Content-Length", "0")), 1024)
                    data = json.loads(self.rfile.read(n) or b"{}")
                    raw = data.get("focus")
                    focus = None
                    if isinstance(raw, (int, float)) and not isinstance(raw, bool) and math.isfinite(raw):
                        focus = max(0.0, min(100.0, float(raw)))
                    sens = data.get("sensors")
                    clean = [None] * 4
                    if isinstance(sens, list):
                        for i, v in enumerate(sens[:4]):
                            if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v):
                                clean[i] = max(0.0, min(100.0, float(v)))
                    link.push(focus, clean)
                    self._reply()
                except Exception:
                    self._reply(400, b'{"ok":false}')

            def log_message(self, *a):
                pass

        try:
            self.server = ThreadingHTTPServer((host, port), Handler)
            self.server.daemon_threads = True
            threading.Thread(target=self.server.serve_forever, daemon=True).start()
        except OSError:
            self.server = None   # port busy

    def push(self, focus, sensors):
        with self.lock:
            self.focus, self.sensors, self.stamp = focus, sensors, time.monotonic()

    def read(self):
        """(state, focus, sensors). state: 'off' (panel silent), 'waiting' (no baselines yet), 'live'."""
        with self.lock:
            focus, sensors, stamp = self.focus, list(self.sensors), self.stamp
        if stamp == 0.0 or time.monotonic() - stamp > LINK_TIMEOUT:
            return "off", None, [None] * 4
        if focus is None:
            return "waiting", None, sensors
        return "live", focus, sensors
