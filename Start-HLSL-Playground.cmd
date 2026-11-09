@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-HLSL-Playground.ps1"
if errorlevel 1 (
    echo.
    echo The HLSL Playground could not start. See the error above.
    echo Use the Windows portable release containing Node, DXC and Naga.
    pause
    exit /b 1
)
endlocal
