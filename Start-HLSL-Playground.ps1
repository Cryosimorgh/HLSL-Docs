# One-click Windows launcher for the HLSL Compute Playground.
# The portable release bundles node.exe, dxc.exe and naga.exe; no installation
# or global PATH changes are needed. Server binds to 127.0.0.1 only.
# The browser tab owns a heartbeat lease and the server exits after it closes.
[CmdletBinding()]
param([switch]$NoBrowser)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServerScript = Join-Path $Root "playground\server.mjs"
if (-not (Test-Path -LiteralPath $ServerScript -PathType Leaf)) {
    throw "Missing playground\server.mjs. Extract the FULL release ZIP, then run the launcher."
}
function Find-Executable {
    param([string]$Bundled, [string]$Executable)
    if (Test-Path -LiteralPath $Bundled -PathType Leaf) {
        return (Resolve-Path -LiteralPath $Bundled).Path
    }
    $found = Get-Command $Executable -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandType -eq "Application" } |
        Select-Object -First 1
    if ($found) { return $found.Source }
    throw "Missing $Executable. Use the HLSL-Playground-Windows portable release with tools included."
}
$Node = Find-Executable (Join-Path $Root "tools\node\node.exe") "node.exe"
$Dxc = Find-Executable (Join-Path $Root "tools\dxc\dxc.exe") "dxc.exe"
$Naga = Find-Executable (Join-Path $Root "tools\naga\naga.exe") "naga.exe"
$logs = Join-Path $Root ".playground-runtime"
New-Item -ItemType Directory -Path $logs -Force | Out-Null
# Random run directory avoids overwriting previous diagnostics.
$run = Join-Path $logs ([guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $run -Force | Out-Null
$ready = Join-Path $run "ready.json"
$outLog = Join-Path $run "server.stdout.log"
$errLog = Join-Path $run "server.stderr.log"
# Avoid an already occupied port. The OS holds this port only briefly while
# selecting it; Node is authoritative if another process wins the race.
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
try {
    $listener.Start()
    $port = $listener.LocalEndpoint.Port
} finally {
    $listener.Stop()
}
$env:HLSL_PORT = [string]$port
$env:HLSL_READY_FILE = $ready
$env:DXC_PATH = $Dxc
$env:NAGA_PATH = $Naga
$Server = $null
try {
    $argsForNode = @{
        FilePath = $Node
        WorkingDirectory = $Root
        ArgumentList = ('"' + $ServerScript + '"')
        WindowStyle = "Hidden"
        PassThru = $true
        RedirectStandardOutput = $outLog
        RedirectStandardError = $errLog
    }
    $Server = Start-Process @argsForNode
    $opened = $false
    for ($i = 0; $i -lt 100; $i++) {
        Start-Sleep -Milliseconds 200
        if (Test-Path -LiteralPath $ready) {
            try {
                $info = Get-Content -LiteralPath $ready -Raw | ConvertFrom-Json
                if (($info.pid -eq $Server.Id) -and
                    ($info.url -eq "http://127.0.0.1:$port")) {
                    $opened = $true
                    break
                }
            } catch { }
        }
        $Server.Refresh()
        if ($Server.HasExited) { break }
    }
    if (-not $opened) {
        $errors = if (Test-Path -LiteralPath $errLog) {
            Get-Content -LiteralPath $errLog -Tail 25 | Out-String
        } else { "" }
        throw "Compiler service failed to start. $errors"
    }
    Write-Host "Starting HLSL Playground: $($info.url)" -ForegroundColor Cyan
    Write-Host "Compiler closes when the last tab closes or you press Close Playground."
    if (-not $NoBrowser) {
        Start-Process -FilePath $info.url
    }
} catch {
    if ($Server -and -not $Server.HasExited) {
        Stop-Process -Id $Server.Id -Force -ErrorAction SilentlyContinue
    }
    Write-Host "Launcher error: $_" -ForegroundColor Red
    throw
}
# Do not wait for the service here: its heartbeat lease owns its lifetime.
# The browser is never force-killed; only this app's Node compiler process ends.
