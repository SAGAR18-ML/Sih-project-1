# HealthPulse EHR - PowerShell Launcher
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "  Starting HealthPulse EHR Web Application..." -ForegroundColor Green
Write-Host "===================================================" -ForegroundColor Cyan

Set-Location $PSScriptRoot

if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
    Write-Host "Creating Python virtual environment..." -ForegroundColor Yellow
    python -m venv .venv
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    & ".\.venv\Scripts\pip.exe" install -r requirements.txt
}

Write-Host "`nLaunching server on http://127.0.0.1:5000 ...`n" -ForegroundColor Green
Start-Process "http://127.0.0.1:5000"
& ".\.venv\Scripts\python.exe" app.py
