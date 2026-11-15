@echo off
rem One double-click for the OpenBCI Cyton + Daisy: sets up the helper's Python environment on the first run,
rem starts the helper in a minimized window (it finds the WiFi Shield or the USB dongle by itself), then opens the panel
rem already set to CYTON; the panel connects to the helper on its own. Closing the "Cyton Helper" window stops the helper.
cd /d "%~dp0"
if not exist ".venv-cyton\Scripts\python.exe" (
  echo First run: setting up the Cyton helper ^(takes a minute, only once^)...
  python -m venv .venv-cyton || (echo Python 3.10+ is needed. Install it from python.org, tick "Add python.exe to PATH", and run this again. & pause & exit /b 1)
  ".venv-cyton\Scripts\python.exe" -m pip install --upgrade pip
  ".venv-cyton\Scripts\python.exe" -m pip install -r tools\requirements.txt || (echo Could not install the helper's packages. Check the internet connection and run this again. & pause & exit /b 1)
)
start "Cyton Helper" /min cmd /k ""%~dp0.venv-cyton\Scripts\python.exe" "%~dp0tools\cyton_helper.py" %*"
start "" msedge --user-data-dir="%LOCALAPPDATA%\MusePanelProfile" --enable-experimental-web-platform-features --enable-features=WebBluetoothNewPermissionsBackend --window-size=1600,930 --app="file:///%~dp0muse-panel.html?device=cyton"
