@echo off
setlocal
cd /d "%~dp0"
where go >nul 2>nul
if errorlevel 1 (
  echo Go must be installed to build from source. The portable release already includes HLSLWorkbench.exe.
  exit /b 1
)
if not exist "go-server\icon_windows_amd64.syso" if exist "go-server\icon_windows_amd64.syso.b64" (
  echo Restoring the embedded Windows icon...
  certutil -f -decode "go-server\icon_windows_amd64.syso.b64" "go-server\icon_windows_amd64.syso" >nul
  if errorlevel 1 exit /b 1
)
pushd "go-server"
set GOOS=windows
set GOARCH=amd64
set CGO_ENABLED=0
go test ./...
if errorlevel 1 (popd & exit /b 1)
go build -trimpath -ldflags="-s -w -H windowsgui" -o "..\HLSLWorkbench.exe" .
set "RESULT=%ERRORLEVEL%"
popd
if not "%RESULT%"=="0" exit /b %RESULT%
echo Built HLSLWorkbench.exe
endlocal
