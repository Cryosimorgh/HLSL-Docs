@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-HLSL-Playground.ps1"
if errorlevel 1 (
    echo.
    echo The HLSL Playground could not start. Check the error above.
    echo The launcher will obtain the verified Zig, DXC and Naga portable runtime automatically.
    pause
    exit /b 1
)
endlocal
