@echo off
cd /d "%~dp0"
py -m pip install --quiet pygame pymunk
py stacker.py
pause
