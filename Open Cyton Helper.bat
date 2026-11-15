@echo off
cd /d "%~dp0"
if not exist ".venv-cyton\Scripts\python.exe" (
  echo First run: creating the Python environment ^(takes a minute^)...
  python -m venv .venv-cyton || (echo Python 3.10+ is needed. Install it from python.org and run this again. & pause & exit /b 1)
  ".venv-cyton\Scripts\python.exe" -m pip install --upgrade pip
  ".venv-cyton\Scripts\python.exe" -m pip install -r tools\requirements.txt || (echo Could not install the helper's packages. Check the internet connection and run this again. & pause & exit /b 1)
)
".venv-cyton\Scripts\python.exe" tools\cyton_helper.py %*
pause
