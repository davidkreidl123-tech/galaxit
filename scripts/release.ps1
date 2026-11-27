# Neue Version veroeffentlichen:
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 1.1.0 -Notes "Was ist neu"
# Setzt die Version, baut, committet, taggt, pusht und legt ein GitHub-Release mit dem ZIP an.
# Installierte Galaxit-Apps finden das Update dann automatisch.
param(
  [Parameter(Mandatory)][string]$Version,
  [string]$Notes = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Version im Format 1.2.3 angeben' }
$gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $gh) { $gh = 'C:\Program Files\GitHub CLI\gh.exe' }
if (-not (Test-Path $gh)) { throw 'GitHub CLI (gh) nicht gefunden' }

$raw = Get-Content package.json -Raw
$raw = $raw -replace '"version":\s*"[^"]+"', ('"version": "' + $Version + '"')
[IO.File]::WriteAllText("$root\package.json", $raw)

& "$PSScriptRoot\build.ps1"

git add -A
git commit -m "Galaxit $Version" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" | Out-Null
git tag "v$Version"
git push origin HEAD --tags

$zip = "dist\Galaxit-win-x64-v$Version.zip"
if (-not $Notes) { $Notes = "Galaxit $Version" }
& $gh release create "v$Version" --title "Galaxit $Version" --notes $Notes
if ($LASTEXITCODE) { throw 'Release anlegen fehlgeschlagen' }
# Grosse ZIPs laufen bei GitHub gelegentlich in Timeouts -> bis zu 3 Versuche
for ($i = 1; $i -le 3; $i++) {
  & $gh release upload "v$Version" $zip --clobber
  if (-not $LASTEXITCODE) { break }
  if ($i -eq 3) { throw "Upload fehlgeschlagen - erneut: gh release upload v$Version $zip --clobber" }
  Write-Host "Upload-Versuch $i fehlgeschlagen, neuer Versuch..."
}
Write-Host "Release v$Version veroeffentlicht."
