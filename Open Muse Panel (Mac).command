#!/bin/bash
# Serves the panel on localhost (a secure context, which Web Bluetooth needs) and opens it in Chrome.
cd "$(dirname "$0")" || exit 1
PORT=8077
if ! lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1 &
  sleep 1
fi
open -a "Google Chrome" "http://localhost:$PORT/muse-panel.html${1:+?$1}"
echo "Panel running at http://localhost:$PORT/muse-panel.html  (close this window to stop the server)"
wait
