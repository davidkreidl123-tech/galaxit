# Baut Galaxit.exe (portable Ordner) und dist\Galaxit-win-x64-v<version>.zip
# Aufruf:  powershell -ExecutionPolicy Bypass -File scripts\build.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$pkg = Get-Content "$root\package.json" -Raw | ConvertFrom-Json
$ver = $pkg.version

# Kurzer Build-Pfad: tief verschachtelte PDF.js-Dateien sprengen sonst die 260-Zeichen-Grenze
$B = Join-Path $env:TEMP 'galaxit-build'
if (Test-Path $B) { Remove-Item $B -Recurse -Force }
$out = "$B\Galaxit"
New-Item -ItemType Directory -Force $out | Out-Null

$electronDist = "$root\node_modules\electron\dist"
if (-not (Test-Path "$electronDist\electron.exe")) { throw "Electron fehlt - erst 'npm install' ausfuehren" }
Copy-Item "$electronDist\*" $out -Recurse -Force
Remove-Item "$out\resources\default_app.asar" -ErrorAction SilentlyContinue
Rename-Item "$out\electron.exe" 'Galaxit.exe'

$app = "$out\resources\app"
New-Item -ItemType Directory -Force "$app\node_modules\pdfjs-dist", "$app\node_modules\pdf-lib" | Out-Null
[ordered]@{ name = 'galaxit'; productName = 'Galaxit'; version = $ver; main = 'main.js'; galaxit = $pkg.galaxit } |
  ConvertTo-Json -Depth 5 | Set-Content -Encoding ascii "$app\package.json"
Copy-Item "$root\main.js", "$root\preload.js", "$root\updater.js" $app
Copy-Item "$root\renderer", "$root\assets" $app -Recurse
foreach ($d in 'build', 'cmaps', 'standard_fonts') { Copy-Item "$root\node_modules\pdfjs-dist\$d" "$app\node_modules\pdfjs-dist" -Recurse }
Copy-Item "$root\node_modules\pdf-lib\dist" "$app\node_modules\pdf-lib" -Recurse

# Icon + Versionsinfo in die EXE
Push-Location $root
node -e "require('rcedit')(process.argv[1],{icon:'assets/icon.ico','version-string':{ProductName:'Galaxit',FileDescription:'Galaxit PDF Reader',CompanyName:'Galaxit',OriginalFilename:'Galaxit.exe',InternalName:'Galaxit'},'file-version':process.argv[2],'product-version':process.argv[2]}).catch(e=>{console.error(e);process.exit(1)})" "$out\Galaxit.exe" $ver
Pop-Location

New-Item -ItemType Directory -Force "$root\dist" | Out-Null
$zip = "$root\dist\Galaxit-win-x64-v$ver.zip"
if (Test-Path $zip) { Remove-Item $zip }
tar.exe -a -c -f $zip -C $B Galaxit
if ($LASTEXITCODE) { throw 'ZIP erstellen fehlgeschlagen' }
Write-Host "OK  $out"
Write-Host "OK  $zip  ($([math]::Round((Get-Item $zip).Length / 1MB)) MB)"
