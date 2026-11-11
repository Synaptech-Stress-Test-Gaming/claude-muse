#!/usr/bin/env python3
"""Serve this folder on http://localhost:8077 with caching turned off, so a browser reload always shows the newest files.
Usage: python3 tools/serve.py [port]"""
import http.server, os, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()
    def log_message(self, *a):  # keep the terminal quiet
        pass

if __name__ == "__main__":
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8077
    http.server.ThreadingHTTPServer(("127.0.0.1", port), NoCache).serve_forever()
