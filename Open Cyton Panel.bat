@echo off
rem One double-click for the OpenBCI Cyton + Daisy: sets up the helper's Python environment on the first run,
rem starts the helper for the WiFi Shield in a minimized window, then opens the panel already set to CYTON, which connects
rem by itself (the USB dongle is read by the panel directly; Connect asks the browser for it once). Closing the "Cyton Helper" window stops the helper.
cd /d "%~dp0"
rem the panel's "Start helper" button (WiFi Shield) opens the link musecyton:wifi; register it for this Windows user (no admin)
reg add "HKCU\Software\Classes\musecyton" /ve /d "URL:Cyton helper (Muse panel)" /f >nul
reg add "HKCU\Software\Classes\musecyton" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\musecyton\shell\open\command" /ve /d "\"%~dp0tools\start_cyton_helper.bat\" \"%%1\"" /f >nul
if not exist ".venv-cyton\Scripts\python.exe" (
  echo First run: setting up the Cyton helper ^(takes a minute, only once^)...
  python -m venv .venv-cyton || (echo Python 3.10+ is needed. Install it from python.org, tick "Add python.exe to PATH", and run this again. & pause & exit /b 1)
  ".venv-cyton\Scripts\python.exe" -m pip install --upgrade pip
  ".venv-cyton\Scripts\python.exe" -m pip install -r tools\requirements.txt || (echo Could not install the helper's packages. Check the internet connection and run this again. & pause & exit /b 1)
)
start "Cyton Helper" /min cmd /k ""%~dp0.venv-cyton\Scripts\python.exe" "%~dp0tools\cyton_helper.py" --link wifi %*"
start "" msedge --user-data-dir="%LOCALAPPDATA%\MusePanelProfile" --enable-experimental-web-platform-features --enable-features=WebBluetoothNewPermissionsBackend --window-size=1600,930 --app="file:///%~dp0muse-panel.html?device=cyton"
