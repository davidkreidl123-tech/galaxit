# Installiert den zuletzt gebauten Galaxit-Ordner nach %LOCALAPPDATA%\Programs\Galaxit
# und legt Verknuepfungen auf dem Desktop und im Startmenue an.
$ErrorActionPreference = 'Stop'
$src = Join-Path $env:TEMP 'galaxit-build\Galaxit'
if (-not (Test-Path "$src\Galaxit.exe")) { throw "Kein Build gefunden - erst scripts\build.ps1 ausfuehren" }
$dst = Join-Path $env:LOCALAPPDATA 'Programs\Galaxit'

Get-Process Galaxit -ErrorAction SilentlyContinue | Stop-Process -Force
New-Item -ItemType Directory -Force $dst | Out-Null
robocopy $src $dst /MIR /R:3 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Kopieren fehlgeschlagen ($LASTEXITCODE)" }

$sh = New-Object -ComObject WScript.Shell
$links = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Galaxit.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Galaxit.lnk')
)
foreach ($l in $links) {
  $s = $sh.CreateShortcut($l)
  $s.TargetPath = "$dst\Galaxit.exe"
  $s.WorkingDirectory = $dst
  $s.IconLocation = "$dst\Galaxit.exe,0"
  $s.Description = 'Galaxit PDF Reader'
  $s.Save()
}
Write-Host "Installiert: $dst"
Write-Host "Verknuepfungen: $($links -join ', ')"
