@echo off
rem Starts only the Cyton helper, in this window (Ctrl+C stops it). Arguments are passed on, e.g. --link dongle, --simulate.
rem Also sets up the musecyton: link the panel's Connect page uses for the WiFi Shield.
cd /d "%~dp0"
if not exist ".venv-cyton\Scripts\pythonw.exe" (
  echo First run: setting up the Cyton WiFi link ^(takes a minute, only once^)...
  python -m venv .venv-cyton || (echo Python 3.10+ is needed. Install it from python.org, tick "Add python.exe to PATH", and run this again. & pause & exit /b 1)
  ".venv-cyton\Scripts\python.exe" -m pip install --upgrade pip
  ".venv-cyton\Scripts\python.exe" -m pip install -r tools\requirements.txt || (echo Could not install the packages. Check the internet connection and run this again. & pause & exit /b 1)
)
rem the panel's Connect page (WiFi Shield) opens the link musecyton:wifi; register it for this Windows user (no admin).
rem It starts the helper with no window; the helper exits when the panel disconnects or has been gone for 2 minutes.
reg add "HKCU\Software\Classes\musecyton" /ve /d "URL:Cyton WiFi link" /f >nul
reg add "HKCU\Software\Classes\musecyton" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\musecyton\shell\open\command" /ve /d "\"%~dp0.venv-cyton\Scripts\pythonw.exe\" \"%~dp0tools\cyton_helper.py\" --from-url \"%%1\" --exit-when-idle 120 --log-file \"%~dp0.tmp\cyton_helper.log\"" /f >nul
".venv-cyton\Scripts\python.exe" tools\cyton_helper.py %*
pause
