@echo off
setlocal
cd /d "%~dp0"
"%~dp0HLSLWorkbench.exe" --unregister
if errorlevel 1 (echo Unable to remove all file association registrations.) else (echo HLSL Workbench Open With registration removed.)
pause
endlocal
