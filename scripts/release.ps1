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

$raw = Get-Content package.json -Raw
$raw = $raw -replace '"version":\s*"[^"]+"', ('"version": "' + $Version + '"')
[IO.File]::WriteAllText("$root\package.json", $raw)

& "$PSScriptRoot\build.ps1"

git add -A
git commit -m "Galaxit $Version" | Out-Null
git tag "v$Version"
git push origin HEAD --tags

$zip = "dist\Galaxit-win-x64-v$Version.zip"
if (-not $Notes) { $Notes = "Galaxit $Version" }
gh release create "v$Version" $zip --title "Galaxit $Version" --notes $Notes
Write-Host "Release v$Version veroeffentlicht."
