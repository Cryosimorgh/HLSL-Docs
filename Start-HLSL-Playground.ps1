# One-click Windows launcher for the HLSL Compute Playground.
# The portable release bundles hlsl-server.exe (Zig), dxc.exe and naga.exe; no installation
# or global PATH changes are needed. Server binds to 127.0.0.1 only; source checkouts self-bootstrap verified tools.
# The browser tab owns a heartbeat lease and the server exits after it closes.
[CmdletBinding()]
param([switch]$NoBrowser)
$ErrorActionPreference = "Stop"
# SECURITY HOLD: Existing unsigned Windows server binaries were quarantined
# as a severe Trojan and one also crashed with 0xC0000005. Until the exact
# Defender classification and binary provenance are reviewed, block the
# native runner even if the files exist locally. Do not bypass Defender.
throw "Native HLSL server launch is temporarily disabled pending a Defender security review (issue #1). Do not restore or allowlist quarantined hlsl-server.exe. Use playground/index.html for the offline JavaScript tutorial: https://github.com/Cryosimorgh/HLSL-Docs/issues/1"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Test-CompleteRuntime {
    param([string]$Folder)
    foreach ($relative in @(
        'playground\hlsl-server.exe', 'playground\index.html',
        'playground\live-runner.js', 'playground\particle-step.hlsl',
        'tools\dxc\dxc.exe', 'tools\dxc\dxcompiler.dll',
        'tools\naga\naga.exe'
    )) {
        if (-not (Test-Path -LiteralPath (Join-Path $Folder $relative) -PathType Leaf)) {
            return $false
        }
    }
    return $true
}

function Get-PortableRuntime {
    # Pinned archive, with SHA256 taken from the published GitHub release.
    # This is a one-time user-local download, never a system-wide installation.
    $version = 'v1.3.1'
    $expectedSha256 = '862189c5524d7d98c92b97d789f103b92b4edb10466a07deade6667c1035090b'
    $folderName = "HLSL-Playground-Windows-$version"
    $archiveName = "$folderName.zip"
    $url = "https://github.com/Cryosimorgh/HLSL-Docs/releases/download/$version/$archiveName"
    $cacheBase = if ($env:HLSL_BOOTSTRAP_CACHE) {
        $env:HLSL_BOOTSTRAP_CACHE
    } else {
        $localData = [Environment]::GetFolderPath('LocalApplicationData')
        if (-not $localData) { $localData = $env:TEMP }
        Join-Path $localData 'HLSL-Playground\PortableCache'
    }
    New-Item -ItemType Directory -Path $cacheBase -Force | Out-Null
    $runtimeRoot = Join-Path $cacheBase $folderName
    if (Test-CompleteRuntime $runtimeRoot) {
        Write-Host "Using cached Zig runtime: $runtimeRoot"
        return $runtimeRoot
    }
    Write-Host "Portable tools are missing from this checkout. Downloading verified $version runtime (15 MB)..." -ForegroundColor Yellow
    $zipPath = Join-Path $cacheBase ($folderName + '.' + [guid]::NewGuid().ToString('N') + '.zip')
    $staging = Join-Path $cacheBase ('extract-' + [guid]::NewGuid().ToString('N'))
    try {
        [Net.ServicePointManager]::SecurityProtocol = (
            [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        )
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            try {
                Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing -ErrorAction Stop
                break
            } catch {
                if ($attempt -eq 3) { throw "Download failed: $($_.Exception.Message). Manual ZIP: $url" }
                Start-Sleep -Seconds (2 * $attempt)
            }
        }
        $sha256 = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
        if ($sha256 -ine $expectedSha256) {
            throw "Archive checksum mismatch. Expected $expectedSha256, got $sha256. Refusing to execute."
        }
        New-Item -ItemType Directory -Path $staging -Force | Out-Null
        Expand-Archive -LiteralPath $zipPath -DestinationPath $staging -Force
        $extracted = Join-Path $staging $folderName
        if (-not (Test-CompleteRuntime $extracted)) {
            throw "The verified archive does not contain the expected portable compiler binaries."
        }
        if (Test-Path -LiteralPath $runtimeRoot) {
            Remove-Item -LiteralPath $runtimeRoot -Recurse -Force
        }
        Move-Item -LiteralPath $extracted -Destination $runtimeRoot
        Write-Host "Runtime cached: $runtimeRoot" -ForegroundColor Green
        return $runtimeRoot
    } finally {
        Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Full release ZIP: use bundled tools. Source checkout: fetch the portable
# runtime once, including the compiled Zig server and matching DXC/Naga.
if (-not (Test-CompleteRuntime $Root)) {
    throw "Automatic download of prior native runtimes is paused because Windows Security has flagged hlsl-server.exe. Do not disable antivirus or add an exclusion. Use playground/index.html for the offline JavaScript tutorial; see https://github.com/Cryosimorgh/HLSL-Docs/issues/1 for investigation status."
}
$ServerScript = Join-Path $Root 'playground\hlsl-server.exe'
$Dxc = Join-Path $Root 'tools\dxc\dxc.exe'
$Naga = Join-Path $Root 'tools\naga\naga.exe'
$logs = Join-Path $Root ".playground-runtime"
New-Item -ItemType Directory -Path $logs -Force | Out-Null
# Random run directory avoids overwriting previous diagnostics.
$run = Join-Path $logs ([guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $run -Force | Out-Null
$ready = Join-Path $run "ready.json"
$outLog = Join-Path $run "server.stdout.log"
$errLog = Join-Path $run "server.stderr.log"
# Avoid an already occupied port. The OS holds this port only briefly while
# selecting it; Zig is authoritative if another process wins the race.
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
    $argsForZig = @{
        FilePath = $ServerScript
        WorkingDirectory = $Root
        WindowStyle = "Hidden"
        PassThru = $true
        RedirectStandardOutput = $outLog
        RedirectStandardError = $errLog
    }
    $Server = Start-Process @argsForZig
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
    Write-Host "HLSL Playground ready: $($info.url)" -ForegroundColor Cyan
    Write-Host "Open the newly launched localhost tab, not an old file:// page."
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
# The browser is never force-killed; only this app's Zig compiler service ends.
