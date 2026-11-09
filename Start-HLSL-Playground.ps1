# HLSL Playground — Windows PowerShell/.NET compiler host launcher.
# No custom Zig server executable or Rust/Node toolchain is required.
[CmdletBinding()]
param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$SiteRoot = Join-Path $Root 'playground'
$ServerScript = Join-Path $SiteRoot 'server.ps1'
if (-not (Test-Path -LiteralPath $ServerScript -PathType Leaf)) {
    throw 'Missing playground/server.ps1. Extract the full ZIP.'
}
function Has-Tools {
    param([string]$base)
    foreach ($path in @('tools\dxc\dxc.exe','tools\dxc\dxcompiler.dll','tools\naga\naga.exe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $base $path) -PathType Leaf)) { return $false }
    }
    return $true
}
$ToolRoot = $Root
if (-not (Has-Tools $ToolRoot)) {
    $version = 'v1.5.0'
    $expectedHash = 'a8fb97a0b22d4b323f171c06787b36fed43342f8890482f3e03a478241d252e1'
    $file = 'HLSL-CompilerTools-v1.5.0.zip'
    $url = "https://github.com/Cryosimorgh/HLSL-Docs/releases/download/$version/$file"
    $cache = if ($env:HLSL_BOOTSTRAP_CACHE) { $env:HLSL_BOOTSTRAP_CACHE } else {
        Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'HLSL-Docs\CompilerTools'
    }
    $ToolRoot = Join-Path $cache $version
    if (-not (Has-Tools $ToolRoot)) {
        New-Item -ItemType Directory -Path $cache -Force | Out-Null
        $download = Join-Path $cache ([guid]::NewGuid().ToString('N') + '.zip')
        $extract = Join-Path $cache ('extract-' + [guid]::NewGuid().ToString('N'))
        try {
            Write-Host 'Obtaining the DXC and prebuilt Naga compiler tools (once)…'
            [Net.ServicePointManager]::SecurityProtocol = (
              [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12)
            Invoke-WebRequest -Uri $url -OutFile $download -UseBasicParsing
            $actual = (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($actual -ne $expectedHash) { throw "Compiler archive SHA256 mismatch: $actual" }
            New-Item -ItemType Directory -Path $extract -Force | Out-Null
            Expand-Archive -LiteralPath $download -DestinationPath $extract -Force
            if (-not (Has-Tools $extract)) { throw 'Compiler tool archive is incomplete' }
            if (Test-Path -LiteralPath $ToolRoot) { Remove-Item -LiteralPath $ToolRoot -Recurse -Force }
            Move-Item -LiteralPath $extract -Destination $ToolRoot
        } finally {
            Remove-Item -LiteralPath $download -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
$Dxc = Join-Path $ToolRoot 'tools\dxc\dxc.exe'
$Naga = Join-Path $ToolRoot 'tools\naga\naga.exe'
$RunDir = Join-Path $env:TEMP ('hlsl-playground-run-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($RunDir) | Out-Null
$Ready = Join-Path $RunDir 'ready.json'
$OutLog = Join-Path $RunDir 'server.stdout.log'
$ErrLog = Join-Path $RunDir 'server.stderr.log'
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
try {
    $listener.Start()
    $Port = $listener.LocalEndpoint.Port
} finally { $listener.Stop() }
$PowerShellExe = Join-Path $PSHOME 'powershell.exe'
if (-not (Test-Path -LiteralPath $PowerShellExe)) { $PowerShellExe = 'powershell.exe' }
$launchArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $ServerScript +
    '" -Port ' + $Port +
    ' -DxcPath "' + $Dxc +
    '" -NagaPath "' + $Naga +
    '" -SiteRoot "' + $SiteRoot +
    '" -ReadyFile "' + $Ready + '"'
$server = $null
try {
    $startInfo = @{
        FilePath = $PowerShellExe
        ArgumentList = $launchArgs
        WorkingDirectory = $Root
        WindowStyle = 'Hidden'
        PassThru = $true
        RedirectStandardOutput = $OutLog
        RedirectStandardError = $ErrLog
    }
    $server = Start-Process @startInfo
    $healthy = $false
    for ($i = 0; $i -lt 100; $i++) {
        Start-Sleep -Milliseconds 200
        if (Test-Path -LiteralPath $Ready -PathType Leaf) {
            try {
                $info = Get-Content -LiteralPath $Ready -Raw | ConvertFrom-Json
                if ([int]$info.pid -eq $server.Id -and $info.url -eq "http://127.0.0.1:$Port") {
                    $healthy = $true
                    break
                }
            } catch { }
        }
        $server.Refresh()
        if ($server.HasExited) { break }
    }
    if (-not $healthy) {
        $stderr = if (Test-Path -LiteralPath $ErrLog) {
            (Get-Content -LiteralPath $ErrLog -Tail 35 | Out-String)
        } else { '' }
        throw "PowerShell compiler bridge did not start. $ErrLog : $stderr"
    }
    Write-Host "HLSL editor ready: $($info.url)" -ForegroundColor Cyan
    Write-Host 'The local PowerShell server exits after the final tab closes.'
    if (-not $NoBrowser) { Start-Process -FilePath $info.url }
} catch {
    if ($server -and -not $server.HasExited) {
        Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    }
    throw
}
