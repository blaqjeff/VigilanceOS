param(
  [ValidateSet('dev', 'start', 'stop')]
  [string]$Mode = 'dev'
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ports = @(3001, 4001, 4000)

function Get-PortPids([int]$Port) {
  $lines = cmd /c "netstat -ano | findstr `":$Port `""
  if (-not $lines) { return @() }

  return $lines |
    ForEach-Object { ($_ -split '\s+')[-1] } |
    Where-Object { $_ -match '^\d+$' } |
    Sort-Object -Unique
}

function Stop-PortProcesses([int[]]$PortList) {
  $pids = $PortList |
    ForEach-Object { Get-PortPids $_ } |
    Sort-Object -Unique

  foreach ($procId in $pids) {
    try {
      Stop-Process -Id ([int]$procId) -Force -ErrorAction Stop
    } catch {}
  }

  return @($pids)
}

function Test-Url([string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
    return [pscustomobject]@{
      ok = $true
      status = [int]$response.StatusCode
      body = $response.Content
    }
  } catch {
    return [pscustomobject]@{
      ok = $false
      status = $null
      body = $_.Exception.Message
    }
  }
}

if ($Mode -eq 'stop') {
  $stopped = Stop-PortProcesses $ports
  if ($stopped.Count -gt 0) {
    Write-Host "Stopped listeners on 3001/4001/4000 (PIDs: $($stopped -join ', '))."
  } else {
    Write-Host 'No listeners were using 3001, 4001, or 4000.'
  }
  exit 0
}

Stop-PortProcesses $ports | Out-Null
Start-Sleep -Seconds 2

if ($Mode -eq 'start') {
  Write-Host 'Building backend and UI before production start...'
  npm run build:all
  if ($LASTEXITCODE -ne 0) {
    Write-Error 'Build failed before stack startup.'
    exit 1
  }
}

$backendLog = "backend-$Mode.log"
$uiLog = "ui-$Mode.log"

foreach ($logName in @($backendLog, $uiLog)) {
  $logPath = Join-Path $root $logName
  if (Test-Path $logPath) {
    Remove-Item -LiteralPath $logPath -Force
  }
}

$backendCommand = if ($Mode -eq 'start') {
  "npm run start:eliza *> $backendLog"
} else {
  "npm run dev:eliza *> $backendLog"
}

$uiCommand = if ($Mode -eq 'start') {
  "npm --prefix ui run start *> $uiLog"
} else {
  "npm --prefix ui run dev *> $uiLog"
}

$backendProc = Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoLogo', '-NoProfile', '-Command', $backendCommand -WorkingDirectory $root -PassThru
$uiProc = Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoLogo', '-NoProfile', '-Command', $uiCommand -WorkingDirectory $root -PassThru

$ui = $null
$agents = $null
$feed = $null

for ($attempt = 0; $attempt -lt 25; $attempt++) {
  Start-Sleep -Seconds 3

  $ui = Test-Url 'http://127.0.0.1:4001'
  $agents = Test-Url 'http://127.0.0.1:3001/api/agents'
  $feed = Test-Url 'http://127.0.0.1:4001/api/vigilance/feed?status=pending%2Capproved'

  if ($ui.ok -and $agents.ok -and $feed.ok) {
    break
  }
}

Write-Host "Backend log: $backendLog"
Write-Host "UI log: $uiLog"
Write-Host 'Backend URL: http://127.0.0.1:3001'
Write-Host 'UI URL: http://127.0.0.1:4001'

if (-not ($ui.ok -and $agents.ok -and $feed.ok)) {
  Write-Error 'Stack launch timed out before both services reported healthy.'
  exit 1
}

Write-Host 'Backend API: OK'
Write-Host 'UI: OK'
Write-Host 'Feed route: OK'
