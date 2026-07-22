@echo off
setlocal enabledelayedexpansion
title Vocal Muse (VoxScript) - Smart Pre-Flight Launcher

echo ======================================================================
echo           VOCAL MUSE (VOXSCRIPT) - SMART LOCAL LAUNCHER              
echo ======================================================================
echo.

:: ----------------------------------------------------------------------
:: 1. CHECK NODE.JS
:: ----------------------------------------------------------------------
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is NOT installed on your computer!
    echo.
    echo FIX: Please download and install Node.js (LTS version) from:
    echo      https://nodejs.org/
    echo.
    echo Once installed, double-click start-local.bat again.
    echo ======================================================================
    pause
    exit /b 1
)

:: ----------------------------------------------------------------------
:: 2. CHECK NODE_MODULES / DEPENDENCIES
:: ----------------------------------------------------------------------
if not exist "node_modules\" (
    echo [INFO] First-time setup detected. Installing project dependencies...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Dependency installation failed! Please check your internet connection.
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed successfully.
    echo.
)

:: ----------------------------------------------------------------------
:: 3. CHECK LOCAL LLM SERVER (PORT 1234 - LM Studio / PORT 11434 - Ollama)
:: ----------------------------------------------------------------------
powershell -NoProfile -Command "(New-Object Net.Sockets.TcpClient).Connect('127.0.0.1', 1234)" >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [OK] Local LLM Server detected ^& active on port 1234 (LM Studio)!
) else (
    powershell -NoProfile -Command "(New-Object Net.Sockets.TcpClient).Connect('127.0.0.1', 11434)" >nul 2>nul
    if %ERRORLEVEL% EQU 0 (
        echo [OK] Local LLM Server detected ^& active on port 11434 (Ollama)!
    ) else (
        echo [NOTICE] Local LLM server (LM Studio / Ollama) is not running yet.
        echo          * The app will work offline, but for local AI lyric generation:
        echo            Open LM Studio -> Go to Local Server -> Click 'Start Server' (Port 1234).
    )
)
echo.

:: ----------------------------------------------------------------------
:: 4. CHECK & START FASTER-WHISPER-SERVER (PORT 9000)
:: ----------------------------------------------------------------------
powershell -NoProfile -Command "(New-Object Net.Sockets.TcpClient).Connect('127.0.0.1', 9000)" >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [OK] Local Whisper Transcription Server detected ^& active on port 9000!
) else (
    where faster-whisper-server >nul 2>nul
    if %ERRORLEVEL% EQU 0 (
        echo [INFO] Starting faster-whisper-server in background on port 9000...
        start "Vocal Muse - Whisper STT Server (Port 9000)" cmd /k "faster-whisper-server --model Systran/faster-whisper-base.en --port 9000"
    ) else (
        echo [NOTICE] Voice transcription server (faster-whisper-server) is not installed.
        echo          * For live voice recording transcription, run:
        echo            pip install faster-whisper-server
    )
)
echo.

:: ----------------------------------------------------------------------
:: 5. LAUNCH BROWSER & DEV SERVER
:: ----------------------------------------------------------------------
echo ======================================================================
echo [LAUNCHING] Opening Vocal Muse in your browser: http://localhost:8080/
echo ======================================================================
echo.

start "" "http://localhost:8080/"
npm run dev

pause
