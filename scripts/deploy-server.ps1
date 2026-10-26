param(
  [Parameter(Mandatory = $true)]
  [string]$HostName,
  [string]$User = "root",
  [string]$RemoteDir = "/opt/ads-transparency-monitor",
  [switch]$SkipVerify
)

$ErrorActionPreference = "Stop"

function Run($File, [string[]]$ArgsList) {
  Write-Host "→ $File $($ArgsList -join ' ')" -ForegroundColor Cyan
  & $File @ArgsList
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $File $($ArgsList -join ' ')"
  }
}

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

if (-not $SkipVerify) {
  Run "npm.cmd" @("run", "typecheck")
  Run "npm.cmd" @("--workspace", "apps/web", "run", "build")
  Run "npm.cmd" @("--workspace", "apps/worker", "run", "build")
}

$tmpDir = Join-Path $root ".tmp"
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$archive = Join-Path $tmpDir "ads-monitor-$stamp.tar.gz"
$remoteArchive = "/tmp/ads-monitor-$stamp.tar.gz"
$remote = "$User@$HostName"

if (Test-Path $archive) {
  Remove-Item -Force $archive
}

Run "tar.exe" @(
  "-czf", $archive,
  "--exclude=.git",
  "--exclude=node_modules",
  "--exclude=apps/web/.next",
  "--exclude=.next",
  "--exclude=.tmp",
  "--exclude=.env",
  "--exclude=.env.*",
  "--exclude=.env.local",
  "--exclude=.google-browser-profiles",
  "--exclude=.google-browser-profiles-visible",
  "--exclude=apps/worker/.google-browser-profiles-visible",
  "--exclude=backups",
  "--exclude=test-results",
  "--exclude=deploy.tar",
  "--exclude=*.tsbuildinfo",
  "--exclude=*.log",
  "."
)

Run "scp.exe" @($archive, "$remote`:$remoteArchive")

$remoteCommand = @"
set -e
mkdir -p '$RemoteDir'
backup='/opt/ads-transparency-monitor.backup-$stamp'
if [ -d '$RemoteDir' ]; then cp -a '$RemoteDir' "`$backup"; fi
cd '$RemoteDir'
tar -xzf '$remoteArchive'
rm -f tsconfig.tsbuildinfo apps/web/tsconfig.tsbuildinfo apps/worker/tsconfig.tsbuildinfo packages/*/tsconfig.tsbuildinfo
docker compose up -d --build web worker mcp
docker compose ps
rm -f '$remoteArchive'
echo "Backup: `$backup"
"@

Run "ssh.exe" @($remote, $remoteCommand)

Write-Host "Deploy complete: http://$HostName`:3100" -ForegroundColor Green
