@echo off
REM Run QA Assistant backend + frontend (accessible from this PC and other machines on the network)
REM Double-click or: run.bat
cd /d "%~dp0"

echo Starting backend (port 8000)...
start "QA Assistant Backend" cmd /k "cd /d "%~dp0backend" && (if exist venv\Scripts\python.exe (venv\Scripts\python.exe) else (python)) -m uvicorn main:app --reload --host 0.0.0.0 --port 8000"

echo Waiting 5 seconds for backend to start...
timeout /t 5 /nobreak >nul
echo Starting frontend (port 4200)...
start "QA Assistant Frontend" cmd /k "cd /d "%~dp0frontend" && npm run start:network"
echo.
echo Two windows opened: "QA Assistant Backend" and "QA Assistant Frontend".
echo Wait until the BACKEND window shows "Uvicorn running on http://0.0.0.0:8000" before using the app.
echo Keep both windows open. Close them to stop the app.
pause
