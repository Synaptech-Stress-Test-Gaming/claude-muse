#!/bin/bash
# One double-click for the OpenBCI Cyton + Daisy on a Mac: sets up the helper's Python environment on the first run,
# starts the helper for the WiFi Shield, serves the panel on localhost and opens it set to CYTON (the USB dongle is read by the panel).
# Close this window to stop the helper and the server.
cd "$(dirname "$0")" || exit 1
if [ ! -x .venv-cyton/bin/python ]; then
  echo "First run: setting up the Cyton helper (takes a minute, only once)..."
  python3 -m venv .venv-cyton || { echo "Python 3.10+ is needed (python.org)."; exit 1; }
  .venv-cyton/bin/python -m pip install --upgrade pip
  .venv-cyton/bin/python -m pip install -r tools/requirements.txt || { echo "Could not install the helper's packages."; exit 1; }
fi
.venv-cyton/bin/python tools/cyton_helper.py --link wifi "$@" &
HELPER=$!
PORT=8077
if ! lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1 &
  sleep 1
fi
trap 'kill $HELPER 2>/dev/null' EXIT
open -a "Google Chrome" "http://localhost:$PORT/muse-panel.html?device=cyton"
echo "Cyton helper running; panel at http://localhost:$PORT/muse-panel.html?device=cyton  (close this window to stop)"
wait $HELPER
