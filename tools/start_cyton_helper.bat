@echo off
rem Started by the panel's "Start helper" button (WiFi Shield) through the musecyton: link that Open Cyton Panel.bat and
rem Open Cyton Helper.bat register for this Windows user. Sets up the helper's Python environment on the first run, then starts
rem the helper for the WiFi Shield in a minimized "Cyton Helper" window (the USB dongle is read by the browser itself).
cd /d "%~dp0.."
if not exist ".venv-cyton\Scripts\python.exe" (
  echo First run: setting up the Cyton helper ^(takes a minute, only once^)...
  python -m venv .venv-cyton || (echo Python 3.10+ is needed. Install it from python.org, tick "Add python.exe to PATH", and try again. & pause & exit /b 1)
  ".venv-cyton\Scripts\python.exe" -m pip install --upgrade pip
  ".venv-cyton\Scripts\python.exe" -m pip install -r tools\requirements.txt || (echo Could not install the helper's packages. Check the internet connection and try again. & pause & exit /b 1)
)
start "Cyton Helper" /min cmd /k ""%~dp0..\.venv-cyton\Scripts\python.exe" "%~dp0cyton_helper.py" --link wifi"
