@echo off
setlocal
cd /d "%~dp0"
"%~dp0HLSLWorkbench.exe" --stop
if errorlevel 1 (
 echo The server might already be stopped. If not, see the log under %%LOCALAPPDATA%%\Sunder\HLSLWorkbench.
 pause
) else (
 echo Stop request sent to the HLSL Workbench server.
)
endlocal
