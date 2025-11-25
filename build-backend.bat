@echo off
REM Build script for Go backend (Windows)
REM This script builds the backend binary and places it in the Tauri binaries directory

setlocal

set SCRIPT_DIR=%~dp0
set BACKEND_DIR=%SCRIPT_DIR%backend
set BINARIES_DIR=%SCRIPT_DIR%app\src-tauri\binaries

echo Building backend for Windows...

REM Create binaries directory if it doesn't exist
if not exist "%BINARIES_DIR%" mkdir "%BINARIES_DIR%"

REM Build the binary
cd /d "%BACKEND_DIR%"
go build -o "%BINARIES_DIR%\backend.exe" .

echo Backend binary built successfully: %BINARIES_DIR%\backend.exe

endlocal

