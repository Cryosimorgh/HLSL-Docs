@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0HLSLWorkbench.exe" (
 echo HLSLWorkbench.exe is missing. Extract the entire ZIP into a folder.
 pause
 exit /b 1
)
start "Sunder HLSL Workbench" "%~dp0HLSLWorkbench.exe"
endlocal
