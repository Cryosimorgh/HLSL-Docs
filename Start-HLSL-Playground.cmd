@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-HLSL-Playground.ps1"
if errorlevel 1 (
    echo.
    echo The HLSL Playground could not start. Check the error above.
    echo This client uses Windows PowerShell/.NET, DXC and Naga; no custom Zig server is executed.
    pause
    exit /b 1
)
endlocal
