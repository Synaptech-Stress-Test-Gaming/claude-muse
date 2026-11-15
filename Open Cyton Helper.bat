@echo off
cd /d "%~dp0"
rem the panel's "Start helper" button (WiFi Shield) opens the link musecyton:wifi; register it for this Windows user (no admin)
reg add "HKCU\Software\Classes\musecyton" /ve /d "URL:Cyton helper (Muse panel)" /f >nul
reg add "HKCU\Software\Classes\musecyton" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\musecyton\shell\open\command" /ve /d "\"%~dp0tools\start_cyton_helper.bat\" \"%%1\"" /f >nul
if not exist ".venv-cyton\Scripts\python.exe" (
  echo First run: creating the Python environment ^(takes a minute^)...
  python -m venv .venv-cyton || (echo Python 3.10+ is needed. Install it from python.org and run this again. & pause & exit /b 1)
  ".venv-cyton\Scripts\python.exe" -m pip install --upgrade pip
  ".venv-cyton\Scripts\python.exe" -m pip install -r tools\requirements.txt || (echo Could not install the helper's packages. Check the internet connection and run this again. & pause & exit /b 1)
)
".venv-cyton\Scripts\python.exe" tools\cyton_helper.py %*
pause
