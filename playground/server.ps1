# HLSL compiler bridge, using Windows PowerShell 5.1 and built-in .NET only.
# No unsigned custom server executable, no Node, no Rust or Zig runtime.
# Compiles user HLSL with Microsoft DXC and precompiled Naga.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][int]$Port,
  [Parameter(Mandatory=$true)][string]$DxcPath,
  [Parameter(Mandatory=$true)][string]$NagaPath,
  [string]$SiteRoot = $PSScriptRoot,
  [string]$ReadyFile = '',
  [int]$StartupGraceMs = 90000,
  [int]$LeaseTimeoutMs = 45000,
  [int]$ExitDelayMs = 1500
)
$ErrorActionPreference = 'Stop'
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Invalid port' }
foreach ($toolPath in @($DxcPath, $NagaPath)) {
  if (-not [IO.File]::Exists($toolPath)) { throw "Missing compiler tool: $toolPath" }
}
$SiteRoot = (Resolve-Path -LiteralPath $SiteRoot).Path
$hostname = "127.0.0.1:$Port"
$origin = "http://$hostname"
$utf8 = New-Object System.Text.UTF8Encoding($false)
$crlf = [string][char]13 + [char]10
$sessions = @{}
$everOpened = $false
$startedMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$lastEmpty = $startedMs
$maxBody = 131072
$static = @{
  '/' = @('index.html', 'text/html; charset=utf-8')
  '/index.html' = @('index.html', 'text/html; charset=utf-8')
  '/live-runner.js' = @('live-runner.js', 'application/javascript; charset=utf-8')
  '/browser-gpu.js' = @('browser-gpu.js', 'application/javascript; charset=utf-8')
  '/particle-step.hlsl' = @('particle-step.hlsl', 'text/plain; charset=utf-8')
  '/README.md' = @('README.md', 'text/plain; charset=utf-8')
}
function NowMs { return [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
function Send-Bytes {
  param($Stream, [int]$Status, [byte[]]$Bytes, [string]$Type = 'application/json; charset=utf-8')
  $reason = switch ($Status) {
    200 {'OK'} 400 {'Bad Request'} 403 {'Forbidden'} 404 {'Not Found'}
    405 {'Method Not Allowed'} 413 {'Payload Too Large'}
    415 {'Unsupported Media Type'} 429 {'Too Many Requests'}
    default {'Internal Server Error'}
  }
  $header = ('HTTP/1.1 ' + $Status + ' ' + $reason + $crlf +
    'Content-Type: ' + $Type + $crlf +
    'Content-Length: ' + $Bytes.Length + $crlf +
    'Connection: close' + $crlf +
    'Cache-Control: no-store' + $crlf +
    'X-Content-Type-Options: nosniff' + $crlf + $crlf)
  $h = [Text.Encoding]::ASCII.GetBytes($header)
  $Stream.Write($h,0,$h.Length)
  if($Bytes.Length) { $Stream.Write($Bytes,0,$Bytes.Length) }
  $Stream.Flush()
}
function Send-Json {
  param($Stream, [int]$Status, $Value)
  $json = ConvertTo-Json -InputObject $Value -Compress -Depth 12
  Send-Bytes $Stream $Status $utf8.GetBytes($json)
}
function Send-Error {
  param($Stream, [int]$Status, [string]$Description)
  Send-Json $Stream $Status @{error=$Description}
}
function Read-Http {
  param($Stream)
  $buf = New-Object System.IO.MemoryStream
  $a=0; $b=0; $c=0; $d=0
  $found = $false
  while ($buf.Length -lt 16384) {
    $n = $Stream.ReadByte()
    if ($n -lt 0) { throw 'Unexpected end of request headers' }
    $buf.WriteByte([byte]$n)
    $a=$b; $b=$c; $c=$d; $d=$n
    if ($a -eq 13 -and $b -eq 10 -and $c -eq 13 -and $d -eq 10) {
      $found=$true; break
    }
  }
  if(-not $found) { throw 'Headers exceed 16 KiB' }
  $text=[Text.Encoding]::ASCII.GetString($buf.ToArray())
  $lines=$text.Split([string[]]@($crlf),[StringSplitOptions]::None)
  if($lines[0] -notmatch '^(GET|POST) (/[^\s]*) HTTP/1\.[01]$') { throw 'Invalid request' }
  $method=$Matches[1]
  $path=$Matches[2].Split('?')[0]
  $headers=@{}
  foreach($line in $lines) {
    if($line -notmatch '^([A-Za-z0-9-]+):[ ]*(.*)$') { continue }
    $key=$Matches[1].ToLowerInvariant()
    if($headers.ContainsKey($key)) { throw 'Duplicate HTTP header' }
    $headers[$key]=$Matches[2].Trim()
  }
  if($headers['host'] -cne $hostname) { throw 'Invalid Host' }
  if($headers.ContainsKey('origin') -and $headers['origin'] -cne $origin) { throw 'Invalid Origin' }
  $length=0
  if($headers.ContainsKey('content-length') -and
     -not [int]::TryParse($headers['content-length'],[ref]$length)) { throw 'Bad content length' }
  if($length -lt 0 -or $length -gt $maxBody) { throw 'Request too large' }
  if($method -eq 'POST' -and
     ($null -eq $headers['content-type'] -or
      -not $headers['content-type'].StartsWith('application/json',[StringComparison]::OrdinalIgnoreCase))) {
    throw 'Content-Type must be application/json'
  }
  $body=New-Object byte[] $length
  $offset=0
  while($offset -lt $length) {
    $count=$Stream.Read($body,$offset,$length-$offset)
    if($count -le 0) { throw 'Truncated HTTP request body' }
    $offset+=$count
  }
  return @{Method=$method;Path=$path;Body=$utf8.GetString($body)}
}
function Run-Tool {
  param([string]$Executable,[string[]]$Arguments,[string]$WorkingDirectory)
  $p=New-Object System.Diagnostics.Process
  $p.StartInfo.FileName=$Executable
  $p.StartInfo.Arguments=($Arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
  $p.StartInfo.WorkingDirectory=$WorkingDirectory
  $p.StartInfo.UseShellExecute=$false
  $p.StartInfo.CreateNoWindow=$true
  $p.StartInfo.RedirectStandardOutput=$true
  $p.StartInfo.RedirectStandardError=$true
  try {
    if(-not $p.Start()) { throw 'Unable to start compiler' }
    $out=$p.StandardOutput.ReadToEndAsync()
    $err=$p.StandardError.ReadToEndAsync()
    if(-not $p.WaitForExit(15000)) {
      try {$p.Kill()} catch {}
      $p.WaitForExit()
      throw 'Compiler timed out after 15 seconds'
    }
    $log=($err.Result + [string][char]10 + $out.Result)
    if($log.Length -gt 8192) {$log=$log.Substring(0,8192)}
    return @{Code=$p.ExitCode;Log=$log.Trim()}
  } finally {$p.Dispose()}
}
function Compile-Hlsl {
  param($Payload)
  if ($null -eq $Payload -or $null -eq $Payload.source -or $null -eq $Payload.entry) {
    throw 'Expected source and entry'
  }
  $source=[string]$Payload.source
  $entry=[string]$Payload.entry
  if($source.Length -lt 1 -or $source.Length -gt 65536 -or
     $source.Contains([char]0) -or
     $entry -cnotmatch '^[A-Za-z_][A-Za-z0-9_]{0,63}$') {
    throw 'Invalid source or entry'
  }
  if($source -match '(?m)^\s*#\s*(include|include_next|import)\b') {
    throw 'Includes are disabled; paste dependencies into the editor'
  }
  $tmp=Join-Path $env:TEMP ('hlsl-playground-'+[guid]::NewGuid().ToString('N'))
  [IO.Directory]::CreateDirectory($tmp) | Out-Null
  try {
    $input=Join-Path $tmp 'input.hlsl'
    $spirv=Join-Path $tmp 'shader.spv'
    $wgsl=Join-Path $tmp 'shader.wgsl'
    [IO.File]::WriteAllText($input,$source,$utf8)
    $dxc=Run-Tool $DxcPath @(
      '-spirv','-fspv-target-env=vulkan1.1','-T','cs_6_0','-E',$entry,'-Fo',$spirv,
      '-fvk-t-shift','0','0','-fvk-u-shift','16','0','-fvk-b-shift','32','0',
      '-fvk-s-shift','48','0',$input
    ) $tmp
    if($dxc.Code -ne 0) { throw ('DXC: '+$dxc.Log) }
    if(-not [IO.File]::Exists($spirv)) { throw 'DXC produced no SPIR-V' }
    $naga=Run-Tool $NagaPath @($spirv,$wgsl) $tmp
    if($naga.Code -ne 0) { throw ('Naga: '+$naga.Log) }
    if(-not [IO.File]::Exists($wgsl)) { throw 'Naga produced no WGSL' }
    $file=[System.IO.FileInfo]::new($wgsl)
    if($file.Length -lt 1 -or $file.Length -gt 524288) { throw 'WGSL output exceeded limit' }
    return @{
      wgsl=[IO.File]::ReadAllText($wgsl,$utf8)
      log=($dxc.Log + [string][char]10 + $naga.Log).Trim()
      toolchain='Windows PowerShell / Microsoft DXC / Naga / WebGPU'
      mapping=@{t0=0;u0=16;b0=32;s0=48}
    }
  } finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
function Handle-Connection {
  param($Client)
  $stream=$null
  try {
    $Client.ReceiveTimeout=8000
    $Client.SendTimeout=8000
    $stream=$Client.GetStream()
    try {$request=Read-Http $stream}
    catch {
      $msg=$_.Exception.Message
      $code=if($msg -match 'Host|Origin'){403}elseif($msg -match 'large'){413}else{400}
      Send-Error $stream $code $msg
      return
    }
    $route=$request.Path
    if($request.Method -eq 'POST' -and $route.StartsWith('/api/session/')) {
      try {$data=ConvertFrom-Json -InputObject $request.Body -ErrorAction Stop}
      catch {Send-Error $stream 400 'Invalid JSON';return}
      $action=$route.Substring('/api/session/'.Length)
      if($action -eq 'open') {
        $token=[guid]::NewGuid().ToString('N')
        $sessions[$token]=NowMs
        $script:everOpened=$true
        $script:lastEmpty=NowMs
        Send-Json $stream 200 @{token=$token;heartbeatMs=5000;fallbackTimeoutMs=$LeaseTimeoutMs}
        return
      }
      if($action -ne 'ping' -and $action -ne 'close'){Send-Error $stream 404 'Unknown session';return}
      $token=[string]$data.token
      if(-not $sessions.ContainsKey($token)){Send-Error $stream 404 'Session expired';return}
      if($action -eq 'close') {
        $sessions.Remove($token)
        if($sessions.Count -eq 0){$script:lastEmpty=NowMs}
      } else {$sessions[$token]=NowMs}
      Send-Json $stream 200 @{ok=$true;activeTabs=$sessions.Count}
      return
    }
    if($request.Method -eq 'POST' -and $route -eq '/api/compile') {
      try {
        $payload=ConvertFrom-Json -InputObject $request.Body -ErrorAction Stop
        $result=Compile-Hlsl $payload
        Send-Json $stream 200 $result
      } catch {Send-Error $stream 400 ('Compile error: '+$_.Exception.Message)}
      return
    }
    if($request.Method -ne 'GET'){Send-Error $stream 405 'Method not allowed';return}
    if($route -eq '/api/health') {
      Send-Json $stream 200 @{ready=$true;activeTabs=$sessions.Count;backend='powershell-dotnet'}
      return
    }
    if(-not $static.ContainsKey($route)){Send-Error $stream 404 'Not found';return}
    $info=$static[$route]
    $path=Join-Path $SiteRoot $info[0]
    if(-not [IO.File]::Exists($path)){Send-Error $stream 404 'File not found';return}
    $bytes=[IO.File]::ReadAllBytes($path)
    if($bytes.Length -gt 524288){Send-Error $stream 413 'File too large';return}
    Send-Bytes $stream 200 $bytes $info[1]
  } catch {
    Write-Warning $_.Exception.Message
    if($null -ne $stream){try {Send-Error $stream 500 'Internal error'} catch {}}
  } finally {
    if($null -ne $stream){try {$stream.Dispose()}catch{}}
    try {$Client.Close()}catch{}
  }
}
$listener=[System.Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$Port)
try {
  $listener.Start()
  if($ReadyFile){
    [IO.File]::WriteAllText($ReadyFile,(
      ConvertTo-Json -InputObject @{pid=$PID;url=$origin;backend='powershell-dotnet'} -Compress),$utf8)
  }
  Write-Host "HLSL compiler bridge ready: $origin"
  while($true){
    $now=NowMs
    foreach($token in @($sessions.Keys)){
      if($now - $sessions[$token] -gt $LeaseTimeoutMs){$sessions.Remove($token)}
    }
    if($sessions.Count -gt 0){$lastEmpty=$now}
    elseif(($everOpened -and $now-$lastEmpty -ge $ExitDelayMs) -or
           (-not $everOpened -and $now-$startedMs -ge $StartupGraceMs)){break}
    if($listener.Pending()){
      $client=$listener.AcceptTcpClient()
      Handle-Connection $client
    } else {Start-Sleep -Milliseconds 100}
  }
} finally {
  $listener.Stop()
  if($ReadyFile){Remove-Item -LiteralPath $ReadyFile -Force -ErrorAction SilentlyContinue}
}
