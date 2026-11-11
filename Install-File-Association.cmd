@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0HLSLWorkbench.exe" (
 echo Missing HLSLWorkbench.exe; extract the complete ZIP first.
 pause
 exit /b 1
)
echo Registering Sunder HLSL Workbench in Windows Open With (current user only)...
"%~dp0HLSLWorkbench.exe" --register
if errorlevel 1 (
 echo File association registration failed.
 pause
 exit /b 1
)
echo.
echo Registered for .hlsl and .hlsli. Windows does not allow apps to silently override your default.
echo To set the default: right-click a .hlsl file, choose Open with, Choose another app,
echo select Sunder HLSL Workbench, and choose Always.
echo Or go to Settings / Apps / Default apps and search for .hlsl.
echo.
pause
endlocal
