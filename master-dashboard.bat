@echo off
title Master Dashboard - Global Command Center
cd /d "c:\Users\colby\Master Dashboard"
echo Starting Global Command Center...
echo.
echo Dashboard will open at http://localhost:3001
echo Press Ctrl+C to stop.
echo.
start http://localhost:5173
npm run dev
