@echo off
title HealthPulse EHR - Personal Health Record System
echo ===================================================
echo   Starting HealthPulse EHR Web Application...
echo ===================================================

cd /d "%~dp0"

IF NOT EXIST ".venv\Scripts\python.exe" (
    echo Creating virtual environment...
    python -m venv .venv
    echo Installing dependencies...
    .venv\Scripts\pip install -r requirements.txt
)

echo.
echo Opening http://127.0.0.1:5000 in your browser...
start http://127.0.0.1:5000
echo.
.venv\Scripts\python app.py
pause
