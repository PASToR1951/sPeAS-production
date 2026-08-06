@echo off
:: INSTALL-BOOT-AUTOSTART.bat
:: Right-click this file and select "Run as administrator" to enable automatic startup at Windows boot (before user login).

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo.
    echo ====================================================================
    echo [ERROR] Administrator privileges are required to register boot tasks.
    echo Please right-click this file and select "Run as administrator".
    echo ====================================================================
    echo.
    pause
    exit /b 1
)

echo [PeAS] Registering System Boot AutoStart Task...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-autostart-boot.ps1"

echo.
echo ====================================================================
echo SUCCESS: PeAS System Boot AutoStart Task has been registered!
echo The system will now start automatically whenever this PC turns on,
echo regardless of whether any user logs in or not.
echo ====================================================================
echo.
pause
