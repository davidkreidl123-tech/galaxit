// Galaxit-Updater: prüft GitHub-Releases, lädt das Windows-ZIP und tauscht die App-Dateien aus.
const { app, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { spawn } = require('child_process');

const pkg = require('./package.json');
const REPO = pkg.galaxit && pkg.galaxit.repo; // "owner/galaxit"
const ASSET = /^Galaxit-win-x64.*\.zip$/i;

function cmpVersion(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

async function fetchJson(url) {
  const res = await net.fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Galaxit-Updater' } });
  if (!res.ok) throw new Error(`GitHub antwortet mit ${res.status}`);
  return res.json();
}

/** Liefert {available, current, latest, notes, url, size, page} */
async function check() {
  const current = app.getVersion();
  if (!REPO) return { available: false, current, error: 'Kein Repository konfiguriert' };
  const rel = await fetchJson(`https://api.github.com/repos/${REPO}/releases/latest`);
  const latest = String(rel.tag_name || '').replace(/^v/, '');
  const asset = (rel.assets || []).find((a) => ASSET.test(a.name));
  return {
    available: !!asset && cmpVersion(latest, current) > 0,
    current, latest,
    notes: rel.body || '',
    url: asset && asset.browser_download_url,
    size: asset && asset.size,
    page: rel.html_url,
  };
}

/** Lädt das ZIP herunter, meldet Fortschritt (0..1) */
async function download(info, onProgress) {
  const dir = path.join(app.getPath('temp'), 'galaxit-update');
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
  const zip = path.join(dir, 'update.zip');
  const res = await net.fetch(info.url, { headers: { 'User-Agent': 'Galaxit-Updater' } });
  if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (${res.status})`);
  const total = Number(res.headers.get('content-length')) || info.size || 0;
  const out = fs.createWriteStream(zip);
  const reader = res.body.getReader();
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
    if (total) onProgress(got / total);
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  if (info.size && got !== info.size) throw new Error('Download unvollständig');
  return { dir, zip };
}

/** Schreibt ein Hilfsskript, das nach dem Beenden die Dateien ersetzt und Galaxit neu startet. */
async function installAndRestart({ dir, zip }) {
  if (!app.isPackaged) throw new Error('Updates werden nur in der installierten App eingespielt.');
  const target = path.dirname(process.execPath);
  const exe = process.execPath;
  const log = path.join(dir, 'update.log');
  const ps1 = path.join(dir, 'apply-update.ps1');
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const script = `
$ErrorActionPreference = 'Stop'
Start-Transcript -Path ${q(log)} -Force | Out-Null
try {
  # warten, bis Galaxit beendet ist
  for ($i = 0; $i -lt 60; $i++) { if (-not (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue)) { break }; Start-Sleep -Milliseconds 500 }
  Start-Sleep -Milliseconds 500
  $x = Join-Path ${q(dir)} 'x'
  if (Test-Path $x) { Remove-Item $x -Recurse -Force }
  Expand-Archive -LiteralPath ${q(zip)} -DestinationPath $x -Force
  $src = Get-ChildItem $x -Recurse -Filter 'Galaxit.exe' | Select-Object -First 1
  if (-not $src) { throw 'Galaxit.exe nicht im Update gefunden' }
  $from = $src.DirectoryName
  # alte App-Dateien sichern, dann ersetzen (Rollback bei Fehler)
  $bak = ${q(target)} + '.old'
  if (Test-Path $bak) { Remove-Item $bak -Recurse -Force }
  robocopy ${q(target)} $bak /E /NFL /NDL /NJH /NJS /NP | Out-Null
  robocopy $from ${q(target)} /MIR /R:5 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) {
    robocopy $bak ${q(target)} /MIR /R:5 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    throw "Kopieren fehlgeschlagen (robocopy $LASTEXITCODE) - alte Version wiederhergestellt"
  }
  Remove-Item $bak -Recurse -Force -ErrorAction SilentlyContinue
  Write-Output 'Update erfolgreich'
} catch {
  Write-Output "FEHLER: $_"
} finally {
  Stop-Transcript | Out-Null
  Start-Process -FilePath ${q(exe)} -ArgumentList '--updated'
}
`;
  await fsp.writeFile(ps1, String.fromCharCode(0xFEFF) + script, 'utf8');
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ps1], {
    detached: true, stdio: 'ignore', windowsHide: true,
  });
  child.unref();
  return true;
}

function openReleasePage(url) { if (url) shell.openExternal(url); }

module.exports = { check, download, installAndRestart, openReleasePage, cmpVersion, REPO };
