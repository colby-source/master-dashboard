@echo off
REM Launches Chrome with remote debugging enabled for LinkedIn automation
REM Run this INSTEAD of your normal Chrome shortcut

set CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
set DEBUG_PORT=9222

REM Check if Chrome is already running with debugging
curl -s http://127.0.0.1:%DEBUG_PORT%/json/version >nul 2>&1
if %errorlevel% equ 0 (
    echo Chrome is already running with debugging on port %DEBUG_PORT%.
    exit /b 0
)

echo Starting Chrome with remote debugging on port %DEBUG_PORT%...
start "" %CHROME_PATH% --remote-debugging-port=%DEBUG_PORT%
echo Chrome started. LinkedIn automation is ready.
