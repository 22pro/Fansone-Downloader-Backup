@echo off
setlocal

cd /d "%~dp0"

set CSC_IDENTITY_AUTO_DISCOVERY=false
set WIN_CSC_LINK=
set WIN_CSC_KEY_PASSWORD=

echo ========================================
echo FansOne Downloader - Windows Build
echo ========================================
echo.

where node >NUL 2>NUL
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo Please install Node.js LTS first: https://nodejs.org/
  pause
  exit /b 1
)

where npm >NUL 2>NUL
if errorlevel 1 (
  echo [ERROR] npm was not found.
  echo Please reinstall Node.js LTS and make sure npm is included.
  pause
  exit /b 1
)

echo [1/4] Installing dependencies...
call npm install
if errorlevel 1 goto failed

echo.
echo [2/4] Checking JavaScript syntax...
call npm test
if errorlevel 1 goto failed

echo.
echo [3/4] Cleaning old build output...
if exist dist rmdir /s /q dist

echo.
echo [4/4] Building Windows installer and portable exe...
call npm run dist:win
if errorlevel 1 goto failed

echo.
echo ========================================
echo Build completed!
echo Output folder: %cd%\dist
echo.
echo Expected files:
echo - FansOneDownloader-1.0.0-x64-installer.exe      installer
echo - FansOneDownloader-1.0.0-x64-portable.exe  portable app
echo.
echo The built exe includes Electron and ffmpeg.
echo Users do NOT need to install Python, ffmpeg, Node.js, or npm.
echo ========================================
pause
exit /b 0

:failed
echo.
echo ========================================
echo Build failed. Please send me the error above.
echo ========================================
pause
exit /b 1
