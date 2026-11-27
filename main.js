// Galaxit – Hauptprozess (Fenster, Dateizugriff, Autosave-Backend)
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const USER = app.getPath('userData');
const BACKUP_DIR = path.join(USER, 'backups');
const SETTINGS = path.join(USER, 'settings.json');
const MAX_BACKUPS = 30;

let win = null;
let pendingFile = null;

function fileFromArgv(argv) {
  const f = argv.slice(1).find((a) => /\.pdf$/i.test(a) && fs.existsSync(a));
  return f ? path.resolve(f) : null;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const f = fileFromArgv(argv);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (f) win.webContents.send('open-path', f);
    }
  });
}

function createWindow() {
  nativeTheme.themeSource = 'dark';
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: '#05030f',
    title: 'Galaxit',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#cfc8ff', height: 44 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Schließen erst, wenn der Renderer ungespeicherte Änderungen gesichert hat
  let allowClose = false;
  win.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();
    win.webContents.send('before-close');
    setTimeout(() => { allowClose = true; win && win.close(); }, 4000); // Notbremse
  });
  ipcMain.removeAllListeners('close-ok');
  ipcMain.once('close-ok', () => { allowClose = true; win.close(); });

  // Test-Hook: GALAXIT_SCREENSHOT=pfad.png -> Screenshot & beenden
  if (process.env.GALAXIT_SCREENSHOT) {
    win.webContents.on('console-message', (_e, level, msg) => console.log(`[renderer:${level}] ${msg}`));
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        if (process.env.GALAXIT_EVAL) {
          try { await win.webContents.executeJavaScript(process.env.GALAXIT_EVAL); } catch (err) { console.error(err); }
          await new Promise((r) => setTimeout(r, Number(process.env.GALAXIT_WAIT || 3500)));
        }
        const img = await win.webContents.capturePage();
        fs.writeFileSync(process.env.GALAXIT_SCREENSHOT, img.toPNG());
        allowClose = true;
        app.quit();
      }, Number(process.env.GALAXIT_DELAY || 2500));
    });
  }
}

// ---------------------------------------------------------------- IPC
ipcMain.handle('get-pending-file', () => { const f = pendingFile; pendingFile = null; return f; });

ipcMain.handle('open-dialog', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'PDF öffnen',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    properties: ['openFile'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('save-dialog', async (_e, defaultPath) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Speichern unter',
    defaultPath,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  return r.canceled ? null : r.filePath;
});

ipcMain.handle('read-file', async (_e, p) => {
  const buf = await fsp.readFile(p);
  let writable = true;
  try { await fsp.access(p, fs.constants.W_OK); } catch { writable = false; }
  return { data: new Uint8Array(buf), writable, name: path.basename(p), size: buf.length };
});

// Atomares Schreiben: tmp-Datei -> fsync -> rename über Original
ipcMain.handle('write-file', async (_e, p, data) => {
  const tmp = p + '.galaxit-tmp';
  const fh = await fsp.open(tmp, 'w');
  try {
    await fh.writeFile(Buffer.from(data));
    await fh.sync();
  } finally {
    await fh.close();
  }
  for (let i = 0; ; i++) {
    try { await fsp.rename(tmp, p); break; } catch (err) {
      // Windows: Datei kurz von Virenscanner/Indexer gesperrt -> erneut versuchen
      if (i >= 8) { await fsp.unlink(tmp).catch(() => {}); throw err; }
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
  return { savedAt: Date.now() };
});

ipcMain.handle('backup-file', async (_e, p) => {
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
  const base = path.basename(p, path.extname(p));
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const dst = path.join(BACKUP_DIR, `${base}_${stamp}.pdf`);
  await fsp.copyFile(p, dst);
  const files = await Promise.all((await fsp.readdir(BACKUP_DIR)).map(async (f) => {
    const full = path.join(BACKUP_DIR, f);
    return { full, t: (await fsp.stat(full)).mtimeMs };
  }));
  files.sort((a, b) => a.t - b.t);
  for (const f of files.slice(0, Math.max(0, files.length - MAX_BACKUPS))) await fsp.unlink(f.full).catch(() => {});
  return dst;
});

ipcMain.handle('rescue-file', async (_e, p, data) => {
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
  const dst = path.join(BACKUP_DIR, `${path.basename(p, path.extname(p))}_WIEDERHERSTELLUNG.pdf`);
  await fsp.writeFile(dst, Buffer.from(data));
  return dst;
});

ipcMain.handle('load-settings', async () => {
  try { return JSON.parse(await fsp.readFile(SETTINGS, 'utf8')); } catch { return {}; }
});
ipcMain.handle('save-settings', async (_e, s) => {
  await fsp.mkdir(USER, { recursive: true });
  await fsp.writeFile(SETTINGS, JSON.stringify(s, null, 2));
});
ipcMain.handle('exists', (_e, p) => fs.existsSync(p));
ipcMain.handle('open-backups', async () => { await fsp.mkdir(BACKUP_DIR, { recursive: true }); shell.openPath(BACKUP_DIR); });
ipcMain.handle('set-title', (_e, t) => { if (win) win.setTitle(t); });

// ---------------------------------------------------------------- Updater
const updater = require('./updater');
let lastUpdate = null;
let downloaded = null;

async function checkForUpdates(manual = false) {
  try {
    const info = await updater.check();
    lastUpdate = info;
    if ((info.available || manual) && win) win.webContents.send('update-status', { type: 'checked', ...info, manual });
    return info;
  } catch (err) {
    if (manual && win) win.webContents.send('update-status', { type: 'error', message: err.message, manual });
    return { available: false, error: err.message };
  }
}

ipcMain.handle('app-info', () => ({
  version: app.getVersion(), repo: updater.REPO, packaged: app.isPackaged,
  justUpdated: process.argv.includes('--updated'),
}));
ipcMain.handle('update-check', () => checkForUpdates(true));
ipcMain.handle('update-download', async () => {
  const info = lastUpdate && lastUpdate.available ? lastUpdate : await updater.check();
  if (!info.available) throw new Error('Kein Update verfügbar');
  downloaded = await updater.download(info, (p) => win && win.webContents.send('update-status', { type: 'progress', progress: p }));
  return true;
});
ipcMain.handle('update-install', async () => {
  if (!downloaded) throw new Error('Update noch nicht heruntergeladen');
  await updater.installAndRestart(downloaded);
  // Renderer speichert offene Änderungen über den normalen Schließen-Weg
  setTimeout(() => win && win.close(), 200);
  return true;
});
ipcMain.handle('open-external', (_e, url) => updater.openReleasePage(url));

app.whenReady().then(() => {
  pendingFile = fileFromArgv(process.argv);
  createWindow();
  if (app.isPackaged && !process.env.GALAXIT_SCREENSHOT) {
    setTimeout(() => checkForUpdates(false), 6000);
    setInterval(() => checkForUpdates(false), 6 * 60 * 60 * 1000);
  }
});
app.on('window-all-closed', () => app.quit());
