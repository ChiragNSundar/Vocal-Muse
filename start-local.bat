@echo off
title Vocal Muse (VoxScript) - Local Master Launcher
echo ========================================================
echo         Vocal Muse (VoxScript) Local Launcher           
echo ========================================================
echo.

:: 1. Check & start faster-whisper-server if available
where faster-whisper-server >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [1/3] Starting Local Voice Transcription (faster-whisper-server on port 9000)...
    start "Vocal Muse - Whisper STT Server (Port 9000)" cmd /k "faster-whisper-server --model Systran/faster-whisper-base.en --port 9000"
) else (
    echo [1/3] faster-whisper-server not found in PATH. Skipping local Whisper server.
    echo       (To enable voice punch-in, run: pip install faster-whisper-server)
)
echo.

:: 2. Open browser
echo [2/3] Opening Vocal Muse in browser (http://localhost:8080)...
start "" "http://localhost:8080"
echo.

:: 3. Start web dev server
echo [3/3] Starting Web Application Development Server...
echo.
npm run dev

pause
