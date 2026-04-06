@echo off
REM Start ONLY the backend (so you can see any errors in this window).
REM Use this if run.bat leaves you with ECONNREFUSED - run this first, wait for "Uvicorn running", then start the frontend.
cd /d "%~dp0backend"
echo Backend starting in %CD%
echo.
if exist venv\Scripts\python.exe (
    venv\Scripts\python.exe -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
) else (
    python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
)
pause
