// ============================================================
//  GALAXIT – PDF-Reader mit Autosave
// ============================================================
import * as pdfjsLib from '../node_modules/pdfjs-dist/build/pdf.mjs';
import { hydrateIcons } from './icons.js';
import { startStars, setStarsEnabled, setStarsDim } from './stars.js';
import { extractGalaxit, buildPdf } from './pdfio.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = '../node_modules/pdfjs-dist/build/pdf.worker.mjs';

const api = window.galaxit;
const $ = (s) => document.querySelector(s);
const SVGNS = 'http://www.w3.org/2000/svg';

const COLORS = ['#ffe14d', '#3ef0ff', '#ff5fd2', '#7dff8a', '#9b7bff', '#ff3b5c', '#1d2b8f', '#111111'];
const COLORED_TOOLS = ['highlight', 'pen', 'text', 'note'];

const S = {
  settings: {
    autosave: true, delay: 1.5, backup: true, stars: true,
    recent: [], lastPage: {}, zoom: null, penWidth: 3,
    colors: { highlight: '#ffe14d', pen: '#ff3b5c', text: '#1d2b8f', note: '#9b7bff' },
  },
  path: null, name: '', baseBytes: null, pdf: null, readOnly: false, readOnlyReason: '',
  pages: [], zoom: 1, tool: 'select', current: 0,
  annots: [], undo: [], redo: [],
  dirty: false, dirtySince: 0, saving: false, saveAgain: false, saveTimer: 0, savingPromise: null,
  backupPromise: null, lastSaved: null, rescueWarned: false,
  textCache: new Map(),
  search: { term: '', hits: [], idx: -1 },
  sidebar: false,
};
window.__galaxit = S; // für Tests/Debug

// ------------------------------------------------------------ Hilfen
const uid = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtTime = (d) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, kind === 'err' ? 6000 : 2800);
}

function persistSettings() { api.saveSettings(S.settings).catch(() => {}); }

function modal({ title, text = '', input = false, password = false, ok = 'OK', cancel = 'Abbrechen' }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `<div class="modal glass">
      <div class="modal-head"><img src="../assets/logo.svg" class="modal-logo" alt=""><div><div class="modal-title"></div><div class="muted"></div></div></div>
      ${input ? `<div class="page-box" style="padding:4px 0 8px"><input class="mi" style="width:100%;height:38px;text-align:left;padding:0 12px" type="${password ? 'password' : 'text'}"></div>` : ''}
      <div class="modal-foot">${cancel ? `<button class="pill-btn ghost" data-r="0">${cancel}</button>` : '<span></span>'}<button class="pill-btn" data-r="1">${ok}</button></div></div>`;
    back.querySelector('.modal-title').textContent = title;
    back.querySelector('.muted').textContent = text;
    const inp = back.querySelector('.mi');
    const done = (v) => { back.remove(); resolve(v); };
    back.addEventListener('click', (e) => {
      const r = e.target.closest('[data-r]');
      if (r) done(r.dataset.r === '1' ? (input ? inp.value : true) : (input ? null : false));
    });
    back.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input ? inp.value : true);
      if (e.key === 'Escape') done(input ? null : false);
      e.stopPropagation();
    });
    document.body.append(back);
    (inp || back.querySelector('[data-r="1"]')).focus();
  });
}

// ------------------------------------------------------------ Autosave-Anzeige
function setSync(state, text) {
  const el = $('#sync');
  el.dataset.state = state;
  const t = {
    idle: 'Bereit',
    saved: S.lastSaved ? `Gespeichert · ${fmtTime(S.lastSaved)}` : 'Alles gespeichert',
    pending: 'Änderungen…',
    saving: 'Speichert…',
    error: 'Speichern fehlgeschlagen',
    off: S.dirty ? 'Nicht gespeichert · Autosave aus' : 'Autosave aus',
    readonly: S.readOnlyReason === 'encrypted' ? 'Geschützt · nur lesen' : 'Nur lesen',
  }[state];
  $('#syncText').textContent = text || t;
  el.title = state === 'readonly'
    ? 'Diese Datei kann nicht direkt beschrieben werden. „Speichern unter…“ legt eine bearbeitbare Kopie an.'
    : `Autosave ${S.settings.autosave ? 'an' : 'aus'} · Verzögerung ${S.settings.delay}s`;
}

function refreshSync() {
  if (!S.pdf) return setSync('idle');
  if (S.readOnly) return setSync('readonly');
  if (S.saving) return setSync('saving');
  if (!S.settings.autosave) return setSync('off');
  if (S.dirty) return setSync('pending');
  setSync('saved');
}

// ------------------------------------------------------------ Autosave
function markDirty() {
  if (!S.pdf) return;
  if (S.readOnly) { refreshSync(); return; }
  S.dirty = true;
  if (!S.dirtySince) S.dirtySince = Date.now();
  if (S.settings.backup && !S.backupPromise) {
    S.backupPromise = api.backupFile(S.path).catch(() => null);
  }
  clearTimeout(S.saveTimer);
  if (S.settings.autosave) S.saveTimer = setTimeout(() => save(), S.settings.delay * 1000);
  refreshSync();
}

// Sicherheitsnetz: bei Dauer-Bearbeitung spätestens alle 20 s speichern
setInterval(() => {
  if (S.dirty && S.settings.autosave && !S.saving && Date.now() - S.dirtySince > 20000) save();
}, 2000);

async function save({ manual = false } = {}) {
  clearTimeout(S.saveTimer);
  if (!S.pdf) return true;
  if (S.readOnly) {
    if (manual) toast('Diese PDF kann nicht überschrieben werden. Nutze „Speichern unter…“.', 'warn');
    return false;
  }
  if (!S.dirty && !manual) return true;
  if (S.saving) { S.saveAgain = true; return S.savingPromise; }

  S.saving = true;
  setSync('saving');
  const path = S.path, base = S.baseBytes;
  const snapshot = JSON.parse(JSON.stringify(S.annots));
  const since = S.dirtySince;
  S.dirty = false; S.dirtySince = 0;

  S.savingPromise = (async () => {
    let bytes, ok = false;
    try {
      if (S.backupPromise) await S.backupPromise;
      bytes = await buildPdf(base, snapshot);
      await api.writeFile(path, bytes);
      if (path === S.path) S.lastSaved = new Date();
      if (manual) toast('Gespeichert ✦');
      ok = true;
    } catch (err) {
      if (path === S.path) { S.dirty = true; S.dirtySince = since || Date.now(); }
      if (bytes && !S.rescueWarned) {
        try {
          const r = await api.rescueFile(path, bytes);
          S.rescueWarned = true;
          toast(`Datei gesperrt – Sicherheitskopie: ${r}`, 'warn');
        } catch { /* egal */ }
      }
      if (manual) toast(`Speichern fehlgeschlagen: ${err.message}`, 'err');
      console.error(err);
    }
    S.saving = false;
    const again = S.saveAgain;
    S.saveAgain = false;
    if (!ok && path === S.path) {
      setSync('error');
      if (S.settings.autosave) { clearTimeout(S.saveTimer); S.saveTimer = setTimeout(() => save(), 5000); }
    } else {
      refreshSync();
      if (again && S.dirty) save();
    }
    return ok;
  })();
  return S.savingPromise;
}

async function flush() {
  if (S.saving) await S.savingPromise;
  if (S.dirty && !S.readOnly && S.settings.autosave) await save();
}

async function saveAs() {
  if (!S.pdf) return;
  if (S.readOnlyReason === 'encrypted') return toast('Passwortgeschützte PDFs können nicht neu gespeichert werden.', 'warn');
  const p = await api.saveDialog(S.path);
  if (!p) return;
  try {
    const bytes = await buildPdf(S.baseBytes, S.annots);
    await api.writeFile(p, bytes);
  } catch (e) { return toast(`Speichern fehlgeschlagen: ${e.message}`, 'err'); }
  S.path = p; S.name = p.split(/[\\/]/).pop();
  S.readOnly = false; S.readOnlyReason = ''; S.dirty = false; S.dirtySince = 0;
  S.backupPromise = Promise.resolve(); S.lastSaved = new Date();
  addRecent(p);
  updateTitle(); refreshSync();
  toast(`Gespeichert als ${S.name}`);
}

// ------------------------------------------------------------ Öffnen
async function openPath(p) {
  if (!p) return;
  await flush();
  let file;
  try { file = await api.readFile(p); } catch (e) { return toast(`Datei konnte nicht gelesen werden: ${e.message}`, 'err'); }
  const head = new TextDecoder('latin1').decode(file.data.slice(0, 1024));
  if (!head.includes('%PDF')) return toast('Das ist keine PDF-Datei.', 'err');

  const ext = await extractGalaxit(file.data);
  const task = pdfjsLib.getDocument({
    data: ext.baseBytes.slice(),
    cMapUrl: '../node_modules/pdfjs-dist/cmaps/', cMapPacked: true,
    standardFontDataUrl: '../node_modules/pdfjs-dist/standard_fonts/',
    isEvalSupported: false,
  });
  task.onPassword = async (update, reason) => {
    const pw = await modal({
      title: reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD ? 'Falsches Passwort' : 'Geschützte PDF',
      text: 'Bitte das Passwort eingeben.', input: true, password: true, ok: 'Entsperren',
    });
    if (pw == null) task.destroy(); else update(pw);
  };
  let pdf;
  try { pdf = await task.promise; } catch (e) {
    if (!/destroy/i.test(e.message)) toast(`PDF konnte nicht geöffnet werden: ${e.message}`, 'err');
    return;
  }

  closeDoc();
  Object.assign(S, {
    ready: false, current: 0,
    path: p, name: file.name, pdf, baseBytes: ext.baseBytes,
    readOnly: ext.readOnly || !file.writable,
    readOnlyReason: ext.reason || (file.writable ? '' : 'readonly'),
    annots: ext.annots, undo: [], redo: [], dirty: false, dirtySince: 0,
    backupPromise: null, lastSaved: null, rescueWarned: false, textCache: new Map(),
    search: { term: '', hits: [], idx: -1 },
  });
  document.body.classList.add('has-doc');
  setStarsDim(true);
  updateTitle();
  addRecent(p);
  await buildPages();

  const z = S.settings.zoom;
  if (z) setZoom(z, false); else fitWidth();
  const last = clamp(S.settings.lastPage[p] || 0, 0, S.pages.length - 1);
  $('#viewer').scrollTop = 0;
  requestAnimationFrame(() => {
    if (last > 0) gotoPage(last, false);
    setCurrent(last);
    S.ready = true; // erst ab jetzt Seitenwechsel merken
  });
  refreshSync();
  if (S.readOnly) toast(S.readOnlyReason === 'encrypted' ? 'Geschützte PDF – nur lesen. „Speichern unter…“ ist gesperrt.' : 'Datei ist schreibgeschützt – nutze „Speichern unter…“.', 'warn');
  else toast(`${file.name} geöffnet${ext.annots.length ? ` · ${ext.annots.length} Anmerkungen` : ''}`);
  $('#viewer').focus();
}

function closeDoc() {
  for (const p of S.pages) { try { p.task?.cancel(); } catch { /* */ } }
  S.pages = [];
  $('#pages').innerHTML = '';
  $('#thumbs').innerHTML = '';
  if (S.pdf) { S.pdf.destroy(); S.pdf = null; }
  hideNotePop();
}

function updateTitle() {
  $('#docPill').hidden = !S.pdf;
  $('#docName').textContent = S.name;
  api.setTitle(S.pdf ? `${S.name} – Galaxit` : 'Galaxit');
}

function addRecent(p) {
  const name = p.split(/[\\/]/).pop();
  S.settings.recent = [{ path: p, name, t: Date.now() }, ...S.settings.recent.filter((r) => r.path !== p)].slice(0, 8);
  persistSettings();
}

async function renderRecent() {
  const list = $('#recentList');
  list.innerHTML = '';
  const items = [];
  for (const r of S.settings.recent) if (await api.exists(r.path)) items.push(r);
  $('#recent').hidden = !items.length;
  for (const r of items) {
    const b = document.createElement('button');
    b.className = 'recent-item';
    b.innerHTML = '<div class="recent-icon">PDF</div><div class="recent-meta"><div class="recent-name"></div><div class="recent-path"></div></div><div class="recent-time"></div>';
    b.querySelector('.recent-name').textContent = r.name;
    b.querySelector('.recent-path').textContent = r.path.replace(/[\\/][^\\/]*$/, '');
    b.querySelector('.recent-time').textContent = relTime(r.t);
    b.onclick = () => openPath(r.path);
    list.append(b);
  }
}

function relTime(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.round(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} Std.`;
  return new Date(t).toLocaleDateString('de-DE');
}

// ------------------------------------------------------------ Seiten
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const p = S.pages[+e.target.dataset.index];
    if (!p) continue;
    p.near = e.isIntersecting;
    if (p.near) queueRender(p); else unloadPage(p);
  }
}, { root: $('#viewer'), rootMargin: '500px 0px' });

async function buildPages() {
  const host = $('#pages');
  const proxies = await Promise.all(Array.from({ length: S.pdf.numPages }, (_, i) => S.pdf.getPage(i + 1)));
  S.pages = proxies.map((page, i) => {
    const el = document.createElement('div');
    el.className = 'page';
    el.dataset.index = i;
    el.style.animationDelay = `${Math.min(i, 6) * 60}ms`;
    el.innerHTML = '<div class="loading">✦</div><span class="num"></span>';
    el.querySelector('.num').textContent = `${i + 1}`;
    const hl = document.createElementNS(SVGNS, 'svg');
    hl.setAttribute('class', 'ink hl');
    hl.style.mixBlendMode = 'multiply';
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'ink');
    const catcher = document.createElement('div');
    catcher.className = 'catcher';
    el.append(hl, svg, catcher);
    host.append(el);
    const p = { index: i, page, vp1: page.getViewport({ scale: 1 }), el, hl, svg, catcher, canvas: null, textDiv: null, renderedZoom: 0, task: null, near: false };
    bindPageEvents(p);
    io.observe(el);
    return p;
  });
  $('#pageCount').textContent = `/ ${S.pages.length}`;
  if (S.sidebar) buildThumbs();
}

function layout() {
  for (const p of S.pages) {
    p.vp = p.page.getViewport({ scale: S.zoom });
    p.el.style.width = `${Math.floor(p.vp.width)}px`;
    p.el.style.height = `${Math.floor(p.vp.height)}px`;
    p.el.style.setProperty('--scale-factor', S.zoom);
    drawAnnots(p);
  }
  for (const p of S.pages) if (p.near) queueRender(p);
}

let renderQueue = [];
let rendering = 0;
function queueRender(p) {
  if (p.renderedZoom === S.zoom || renderQueue.includes(p)) return;
  renderQueue.push(p);
  pump();
}
function pump() {
  while (rendering < 2 && renderQueue.length) {
    // sichtbare Seiten zuerst
    renderQueue.sort((a, b) => Math.abs(a.index - S.current) - Math.abs(b.index - S.current));
    const p = renderQueue.shift();
    if (!p.near || p.renderedZoom === S.zoom || !S.pdf) continue;
    rendering++;
    renderPage(p).finally(() => { rendering--; pump(); });
  }
}

async function renderPage(p) {
  const zoom = S.zoom;
  const vp = p.page.getViewport({ scale: zoom });
  // Schärfe bis 2x, aber höchstens ~8 Mio. Pixel pro Seite (≈32 MB statt bis zu 100 MB bei hohem Zoom)
  const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8e6 / (vp.width * vp.height)));
  const canvas = document.createElement('canvas');
  canvas.className = 'render';
  canvas.width = Math.floor(vp.width * dpr);
  canvas.height = Math.floor(vp.height * dpr);
  try { p.task?.cancel(); } catch { /* */ }
  p.task = p.page.render({
    canvasContext: canvas.getContext('2d', { alpha: false }),
    viewport: vp,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
    annotationMode: pdfjsLib.AnnotationMode.ENABLE,
  });
  try { await p.task.promise; } catch { return; }
  if (zoom !== S.zoom || !p.near) { canvas.width = 0; canvas.height = 0; return; }
  if (p.canvas) { p.canvas.width = 0; p.canvas.height = 0; p.canvas.remove(); }
  p.el.querySelector('.loading')?.remove();
  p.el.prepend(canvas);
  p.canvas = canvas;

  const div = document.createElement('div');
  div.className = 'textLayer';
  try {
    const tl = new pdfjsLib.TextLayer({ textContentSource: await getText(p.index), container: div, viewport: vp });
    await tl.render();
    p.textDiv?.remove();
    p.el.insertBefore(div, p.hl);
    p.textDiv = div;
  } catch { /* Textlayer optional */ }
  p.renderedZoom = zoom;
}

function unloadPage(p) {
  try { p.task?.cancel(); } catch { /* */ }
  renderQueue = renderQueue.filter((q) => q !== p);
  if (!p.canvas) return;
  // Bitmap sofort freigeben statt auf die Garbage-Collection zu warten
  p.canvas.width = 0; p.canvas.height = 0;
  p.canvas.remove(); p.canvas = null;
  try { p.page.cleanup(); } catch { /* läuft gerade noch */ }
  p.textDiv?.remove(); p.textDiv = null;
  p.renderedZoom = 0;
  if (!p.el.querySelector('.loading')) {
    const l = document.createElement('div'); l.className = 'loading'; l.textContent = '✦'; p.el.prepend(l);
  }
}

function getText(i) {
  if (!S.textCache.has(i)) S.textCache.set(i, S.pdf.getPage(i + 1).then((pg) => pg.getTextContent()));
  return S.textCache.get(i);
}

// ------------------------------------------------------------ Zoom & Navigation
function setZoom(z, keep = true) {
  z = clamp(z, 0.25, 5);
  const v = $('#viewer');
  const ry = (v.scrollTop + v.clientHeight / 2) / Math.max(1, v.scrollHeight);
  const rx = (v.scrollLeft + v.clientWidth / 2) / Math.max(1, v.scrollWidth);
  S.zoom = z;
  layout();
  if (keep) {
    v.scrollTop = ry * v.scrollHeight - v.clientHeight / 2;
    v.scrollLeft = rx * v.scrollWidth - v.clientWidth / 2;
  }
  $('#zoomLabel').textContent = `${Math.round(z * 100)}%`;
  S.settings.zoom = z;
  persistSettings();
}

function fitWidth() {
  if (!S.pages.length) return;
  const w = Math.max(...S.pages.slice(0, 5).map((p) => p.vp1.width));
  setZoom(Math.min(1.6, ($('#viewer').clientWidth - 90) / w));
}

function gotoPage(i, smooth = true) {
  const p = S.pages[clamp(i, 0, S.pages.length - 1)];
  if (!p) return;
  $('#viewer').scrollTo({ top: p.el.offsetTop - 20, behavior: smooth ? 'smooth' : 'auto' });
}

let scrollRaf = 0;
$('#viewer').addEventListener('scroll', () => {
  if (scrollRaf || !S.ready) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    const v = $('#viewer');
    const line = v.scrollTop + v.clientHeight * 0.35;
    let cur = 0;
    for (const p of S.pages) { if (p.el.offsetTop <= line) cur = p.index; else break; }
    if (cur !== S.current) setCurrent(cur);
  });
});

function setCurrent(i) {
  S.current = i;
  $('#pageInput').value = i + 1;
  document.querySelectorAll('.thumb.active').forEach((t) => t.classList.remove('active'));
  const t = document.querySelector(`.thumb[data-index="${i}"]`);
  if (t) { t.classList.add('active'); t.scrollIntoView({ block: 'nearest' }); }
  if (S.path && S.ready) { S.settings.lastPage[S.path] = i; persistSettingsSoon(); }
}
let settingsTimer = 0;
function persistSettingsSoon() { clearTimeout(settingsTimer); settingsTimer = setTimeout(persistSettings, 1500); }

// ------------------------------------------------------------ Miniaturen
const thumbIo = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const el = e.target;
    thumbIo.unobserve(el);
    const p = S.pages[+el.dataset.index];
    if (!p) continue;
    const scale = 130 / p.vp1.width;
    const vp = p.page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width * 1.5); c.height = Math.floor(vp.height * 1.5);
    c.style.width = `${Math.floor(vp.width)}px`; c.style.height = `${Math.floor(vp.height)}px`;
    p.page.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp, transform: [1.5, 0, 0, 1.5, 0, 0] }).promise
      .then(() => el.querySelector('.ph')?.replaceWith(c)).catch(() => {});
  }
}, { root: $('#thumbs'), rootMargin: '400px 0px' });

function buildThumbs() {
  const host = $('#thumbs');
  host.innerHTML = '';
  for (const p of S.pages) {
    const t = document.createElement('div');
    t.className = 'thumb' + (p.index === S.current ? ' active' : '');
    t.dataset.index = p.index;
    const ph = document.createElement('div');
    ph.className = 'ph';
    ph.style.width = '130px';
    ph.style.height = `${Math.round((130 * p.vp1.height) / p.vp1.width)}px`;
    const label = document.createElement('span');
    label.textContent = p.index + 1;
    t.append(ph, label);
    t.onclick = () => gotoPage(p.index);
    host.append(t);
    thumbIo.observe(t);
  }
}

function toggleSidebar() {
  S.sidebar = !S.sidebar;
  $('#sidebar').hidden = !S.sidebar;
  if (S.sidebar && S.pdf) buildThumbs();
}

// ------------------------------------------------------------ Anmerkungen zeichnen
function vpPt(p, x, y) { return p.vp.convertToViewportPoint(x, y); }
function pdfPt(p, x, y) { return p.vp.convertToPdfPoint(x, y); }
function vpRect(p, [x0, y0, x1, y1]) {
  const [a, b] = vpPt(p, x0, y0), [c, d] = vpPt(p, x1, y1);
  return { x: Math.min(a, c), y: Math.min(b, d), w: Math.abs(c - a), h: Math.abs(d - b) };
}
function smoothD(pts) {
  const f = (v) => v.toFixed(1);
  if (pts.length === 1) return `M${f(pts[0][0])} ${f(pts[0][1])}L${f(pts[0][0])} ${f(pts[0][1])}`;
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += `Q${f(pts[i][0])} ${f(pts[i][1])} ${f(mx)} ${f(my)}`;
  }
  const l = pts[pts.length - 1];
  return d + `L${f(l[0])} ${f(l[1])}`;
}
function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  parent?.append(e);
  return e;
}

function drawAnnots(p) {
  if (!p.vp) return;
  const w = p.vp.width, h = p.vp.height;
  for (const s of [p.hl, p.svg]) { s.setAttribute('viewBox', `0 0 ${w} ${h}`); s.innerHTML = ''; }
  const z = S.zoom;
  for (const a of S.annots) {
    if (a.page !== p.index) continue;
    if (a.type === 'highlight') {
      const g = el('g', { class: 'ann', 'data-id': a.id, fill: a.color, 'fill-opacity': a.opacity ?? 0.45 }, p.hl);
      for (const r of a.rects) { const v = vpRect(p, r); el('rect', { x: v.x, y: v.y, width: v.w, height: v.h, rx: 1.5 }, g); }
      // Klickfläche für Radierer (die hl-Ebene ist multiply und liegt unter der Ink-Ebene)
      const hit = el('g', { class: 'ann', 'data-id': a.id, fill: 'transparent' }, p.svg);
      for (const r of a.rects) { const v = vpRect(p, r); el('rect', { x: v.x, y: v.y, width: v.w, height: v.h }, hit); }
    } else if (a.type === 'ink') {
      const g = el('g', { class: 'ann', 'data-id': a.id }, p.svg);
      for (const path of a.paths) {
        el('path', {
          d: smoothD(path.map(([x, y]) => vpPt(p, x, y))), fill: 'none', stroke: a.color, 'stroke-width': a.width * z,
          'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-opacity': a.opacity ?? 1,
        }, g);
      }
    } else if (a.type === 'text') {
      const v = vpRect(p, a.rect);
      const g = el('g', { class: 'ann text', 'data-id': a.id }, p.svg);
      el('rect', { x: v.x, y: v.y, width: v.w, height: v.h, fill: 'transparent' }, g);
      const t = el('text', { fill: a.color, 'font-size': a.size * z, 'font-family': 'Helvetica, Arial, sans-serif' }, g);
      a.text.split('\n').forEach((ln, i) => {
        const ts = el('tspan', { x: v.x + 2 * z, y: v.y + a.size * z * (0.93 + i * 1.25) }, t);
        ts.textContent = ln || ' ';
      });
    } else if (a.type === 'note') {
      const [x, y] = vpPt(p, a.x, a.y);
      const s = clamp(z, 0.8, 1.6);
      const g = el('g', { class: 'ann note', 'data-id': a.id, transform: `translate(${x} ${y}) scale(${s})`, style: `filter: drop-shadow(0 0 4px ${a.color})` }, p.svg);
      el('rect', { x: 1, y: 1, width: 20, height: 15, rx: 4, fill: a.color }, g);
      el('path', { d: 'M5 15.5 5 21 10.5 15.5Z', fill: a.color }, g);
      el('path', { d: 'M5 6h12M5 10.5h8', stroke: '#fff', 'stroke-width': 1.7, 'stroke-linecap': 'round' }, g);
    }
  }
  drawHits(p);
}

function drawHits(p) {
  p.svg.querySelectorAll('.hit').forEach((h) => h.remove());
  const { hits, idx } = S.search;
  hits.forEach((hit, i) => {
    if (hit.page !== p.index || !hit.rect) return;
    const v = vpRect(p, hit.rect);
    el('rect', { class: 'hit' + (i === idx ? ' current' : ''), x: v.x - 1, y: v.y - 1, width: v.w + 2, height: v.h + 2, rx: 2 }, p.svg);
  });
}

function redraw(pageIdx) {
  if (pageIdx == null) S.pages.forEach(drawAnnots);
  else if (S.pages[pageIdx]) drawAnnots(S.pages[pageIdx]);
}

// ------------------------------------------------------------ Änderungen + Undo
function mutate(fn, pageIdx) {
  S.undo.push(JSON.stringify(S.annots));
  if (S.undo.length > 300) S.undo.shift();
  S.redo.length = 0;
  fn();
  redraw(pageIdx);
  markDirty();
  updateUndoButtons();
}
function undo() {
  if (!S.undo.length) return;
  S.redo.push(JSON.stringify(S.annots));
  S.annots = JSON.parse(S.undo.pop());
  redraw(); markDirty(); updateUndoButtons();
}
function redo() {
  if (!S.redo.length) return;
  S.undo.push(JSON.stringify(S.annots));
  S.annots = JSON.parse(S.redo.pop());
  redraw(); markDirty(); updateUndoButtons();
}
function updateUndoButtons() {
  document.querySelector('[data-cmd="undo"]').disabled = !S.undo.length;
  document.querySelector('[data-cmd="redo"]').disabled = !S.redo.length;
}
function addAnnot(a) {
  a.id = a.id || uid();
  a.modified = Date.now();
  mutate(() => S.annots.push(a), a.page);
  return a;
}
function removeAnnot(id) {
  const a = S.annots.find((x) => x.id === id);
  if (!a) return;
  mutate(() => { S.annots = S.annots.filter((x) => x.id !== id); }, a.page);
}

// ------------------------------------------------------------ Werkzeuge
function setTool(t) {
  S.tool = t;
  document.body.dataset.tool = t;
  document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  $('#swatches').hidden = !COLORED_TOOLS.includes(t);
  $('#widths').hidden = t !== 'pen';
  renderSwatches();
  if (t !== 'select') window.getSelection()?.removeAllRanges();
}

function renderSwatches() {
  const host = $('#swatches');
  host.innerHTML = '';
  const cur = S.settings.colors[S.tool];
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.className = 'swatch' + (c === cur ? ' active' : '');
    b.style.setProperty('--c', c);
    b.dataset.tip = 'Farbe';
    b.onclick = () => { S.settings.colors[S.tool] = c; persistSettings(); renderSwatches(); };
    host.append(b);
  }
  document.querySelectorAll('.wbtn').forEach((b) => b.classList.toggle('active', +b.dataset.width === S.settings.penWidth));
}

function localXY(p, e) {
  const r = p.el.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

function bindPageEvents(p) {
  let drag = null;
  p.catcher.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const [x, y] = localXY(p, e);
    if (S.tool === 'highlight') {
      p.catcher.setPointerCapture(e.pointerId);
      drag = { x0: x, y0: y, rect: el('rect', { x, y, width: 0, height: 0, fill: S.settings.colors.highlight, 'fill-opacity': 0.25, stroke: S.settings.colors.highlight, 'stroke-dasharray': '4 3' }, p.svg) };
    } else if (S.tool === 'pen') {
      p.catcher.setPointerCapture(e.pointerId);
      const c = S.settings.colors.pen;
      drag = { pts: [[x, y]], path: el('path', { fill: 'none', stroke: c, 'stroke-width': S.settings.penWidth * S.zoom, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', style: `filter: drop-shadow(0 0 3px ${c})` }, p.svg) };
      drag.path.setAttribute('d', smoothD(drag.pts));
    } else if (S.tool === 'text') {
      e.preventDefault();
      openTextEditor(p, x, y);
    } else if (S.tool === 'note') {
      const [px, py] = pdfPt(p, x - 4, y - 4);
      const a = addAnnot({ type: 'note', page: p.index, x: px, y: py, text: '', color: S.settings.colors.note });
      showNotePop(a, true);
    }
  });
  p.catcher.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const [x, y] = localXY(p, e);
    if (drag.rect) {
      drag.rect.setAttribute('x', Math.min(x, drag.x0)); drag.rect.setAttribute('y', Math.min(y, drag.y0));
      drag.rect.setAttribute('width', Math.abs(x - drag.x0)); drag.rect.setAttribute('height', Math.abs(y - drag.y0));
    } else if (drag.pts) {
      const l = drag.pts[drag.pts.length - 1];
      if (Math.hypot(x - l[0], y - l[1]) < 1.5) return;
      drag.pts.push([x, y]);
      drag.path.setAttribute('d', smoothD(drag.pts));
    }
  });
  const end = async (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    const [x, y] = localXY(p, e);
    if (d.rect) {
      d.rect.remove();
      if (Math.abs(x - d.x0) < 3 && Math.abs(y - d.y0) < 3) return;
      await highlightArea(p, d.x0, d.y0, x, y);
    } else if (d.pts) {
      d.path.remove();
      addAnnot({
        type: 'ink', page: p.index, color: S.settings.colors.pen, width: S.settings.penWidth,
        paths: [d.pts.map(([vx, vy]) => pdfPt(p, vx, vy).map((v) => +v.toFixed(2)))],
      });
    }
  };
  p.catcher.addEventListener('pointerup', end);
  p.catcher.addEventListener('pointercancel', () => { drag?.rect?.remove(); drag?.path?.remove(); drag = null; });

  // Radierer / Notiz öffnen / Text bearbeiten
  let erasing = false;
  p.svg.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('.ann');
    if (!g) return;
    const a = S.annots.find((x) => x.id === g.dataset.id);
    if (!a) return;
    if (S.tool === 'eraser') { erasing = true; removeAnnot(a.id); }
    else if (S.tool === 'select' && a.type === 'note') showNotePop(a, false);
  });
  p.svg.addEventListener('dblclick', (e) => {
    const g = e.target.closest('.ann.text');
    if (!g || S.tool !== 'select') return;
    const a = S.annots.find((x) => x.id === g.dataset.id);
    if (a) editText(p, a);
  });
  p.svg.addEventListener('pointerover', (e) => {
    if (S.tool !== 'eraser' || !(e.buttons & 1) || !erasing) return;
    const g = e.target.closest('.ann');
    if (g) removeAnnot(g.dataset.id);
  });
  window.addEventListener('pointerup', () => { erasing = false; });
}

async function highlightArea(p, vx0, vy0, vx1, vy1) {
  const [ax, ay] = pdfPt(p, vx0, vy0), [bx, by] = pdfPt(p, vx1, vy1);
  const R = { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
  const tc = await getText(p.index);
  let rects = collectRects(tc, R, 0.35);
  if (!rects.length) rects = collectRects(tc, R, 0.01); // flacher Rahmen: Zeile trotzdem treffen
  // Rechtecke einer Zeile zusammenführen
  rects.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const merged = [];
  for (const r of rects) {
    const m = merged[merged.length - 1];
    if (m && Math.abs(m[1] - r[1]) < 1.5 && Math.abs(m[3] - r[3]) < 1.5 && r[0] <= m[2] + 3) m[2] = Math.max(m[2], r[2]);
    else merged.push([...r]);
  }
  rects = merged.length ? merged : [[R.x0, R.y0, R.x1, R.y1]];
  addAnnot({ type: 'highlight', page: p.index, color: S.settings.colors.highlight, opacity: 0.45, rects: rects.map((r) => r.map((v) => +v.toFixed(2))) });
}

function collectRects(tc, R, minOverlap) {
  const rects = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim() || !it.transform) continue;
    const [, , c, d, e, f] = it.transform;
    const h = it.height || Math.hypot(c, d);
    const x0 = e, x1 = e + it.width, y0 = f - h * 0.22, y1 = f + h * 0.9;
    if (x1 < R.x0 || x0 > R.x1 || y1 < R.y0 || y0 > R.y1) continue;
    const ov = Math.min(y1, R.y1) - Math.max(y0, R.y0);
    if (ov < minOverlap * (y1 - y0)) continue;
    // an Zeichengrenzen einrasten (proportionale Breiten)
    const n = it.str.length;
    let s = 0, t = n;
    while (s < n && x0 + charX(it, s + 1) <= R.x0 + 1) s++;
    while (t > s && x0 + charX(it, t - 1) >= R.x1 - 1) t--;
    if (t <= s) continue;
    rects.push([x0 + charX(it, s), y0, x0 + charX(it, t), y1]);
  }
  return rects;
}

// x-Versatz des k-ten Zeichens eines PDF.js-Textelements, proportional gemessen
function charX(it, k) {
  if (k <= 0) return 0;
  if (k >= it.str.length) return it.width;
  const full = measure(it.str, 100);
  return full > 0 ? (it.width * measure(it.str.slice(0, k), 100)) / full : (it.width * k) / it.str.length;
}

function measure(text, size) {
  const c = measure.c || (measure.c = document.createElement('canvas').getContext('2d'));
  c.font = `${size}px Helvetica, Arial, sans-serif`;
  return Math.max(...text.split('\n').map((l) => c.measureText(l).width));
}

function openTextEditor(p, vx, vy, existing) {
  document.querySelector('.text-editor')?.blur();
  const size = existing?.size || 14;
  const color = existing?.color || S.settings.colors.text;
  const ta = document.createElement('textarea');
  ta.className = 'text-editor';
  ta.style.left = `${vx}px`; ta.style.top = `${vy}px`;
  ta.style.fontSize = `${size * S.zoom}px`;
  ta.style.color = color;
  ta.value = existing?.text || '';
  ta.placeholder = 'Text…';
  const fit = () => {
    ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`;
    ta.style.width = `${Math.max(120, measure(ta.value || 'Text…', size * S.zoom) + 24)}px`;
  };
  ta.addEventListener('input', fit);
  let done = false;
  const commit = (keep) => {
    if (done) return; done = true;
    const text = ta.value.replace(/\s+$/, '');
    ta.remove();
    if (!keep) return;
    const [px, py] = pdfPt(p, vx, vy);
    const lines = text.split('\n').length;
    const w = measure(text, size) + 6, h = lines * size * 1.25 + size * 0.3;
    if (existing) {
      mutate(() => {
        S.annots = S.annots.filter((x) => x.id !== existing.id);
        if (text) S.annots.push({ ...existing, text, rect: [px, py - h, px + w, py].map((v) => +v.toFixed(2)), modified: Date.now() });
      }, p.index);
    } else if (text) {
      addAnnot({ type: 'text', page: p.index, text, size, color, rect: [px, py - h, px + w, py].map((v) => +v.toFixed(2)) });
    }
  };
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { commit(false); redraw(p.index); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit(true);
  });
  ta.addEventListener('blur', () => commit(true));
  p.el.append(ta);
  fit();
  setTimeout(() => ta.focus(), 0);
}

function editText(p, a) {
  const [vx, vy] = vpPt(p, a.rect[0], a.rect[3]);
  // Original ausblenden, solange bearbeitet wird
  p.svg.querySelector(`[data-id="${a.id}"]`)?.setAttribute('opacity', '0');
  openTextEditor(p, vx, vy, a);
}

// ------------------------------------------------------------ Notiz-Popover
let noteCtx = null;
function showNotePop(a, isNew) {
  const p = S.pages[a.page];
  const [x, y] = vpPt(p, a.x, a.y);
  const r = p.el.getBoundingClientRect();
  const pop = $('#notePop');
  pop.hidden = false;
  const left = clamp(r.left + x + 34, 10, window.innerWidth - 300);
  const top = clamp(r.top + y - 10, 60, window.innerHeight - 240);
  pop.style.left = `${left}px`; pop.style.top = `${top}px`;
  const ta = $('#noteText');
  ta.value = a.text || '';
  noteCtx = { id: a.id, isNew, orig: a.text || '' };
  setTimeout(() => ta.focus(), 0);
}
function hideNotePop(commit = true) {
  const pop = $('#notePop');
  if (pop.hidden || !noteCtx) { pop.hidden = true; return; }
  const ctx = noteCtx; noteCtx = null;
  pop.hidden = true;
  const text = $('#noteText').value.trim();
  const a = S.annots.find((x) => x.id === ctx.id);
  if (!a || !commit) return;
  if (!text && ctx.isNew) {
    // leere neue Notiz: komplett zurücknehmen (inkl. Undo-Eintrag)
    S.annots = S.annots.filter((x) => x.id !== a.id);
    S.undo.pop(); redraw(a.page); updateUndoButtons(); markDirty();
    return;
  }
  if (text !== ctx.orig) {
    if (ctx.isNew) { a.text = text; a.modified = Date.now(); markDirty(); }
    else mutate(() => { const b = S.annots.find((x) => x.id === a.id); b.text = text; b.modified = Date.now(); }, a.page);
  }
}

// ------------------------------------------------------------ Suche
let searchToken = 0;
async function runSearch(term) {
  const token = ++searchToken;
  term = term.trim();
  S.search = { term, hits: [], idx: -1 };
  if (!term || !S.pdf) { redraw(); $('#searchCount').textContent = ''; return; }
  const q = term.toLocaleLowerCase('de');
  const hits = [];
  for (let i = 0; i < S.pages.length && hits.length < 5000; i++) {
    const tc = await getText(i);
    if (token !== searchToken) return;
    for (const it of tc.items) {
      if (!it.str) continue;
      const s = it.str.toLocaleLowerCase('de');
      let k = s.indexOf(q);
      while (k !== -1) {
        const [, , c, d, e, f] = it.transform;
        const h = it.height || Math.hypot(c, d);
        hits.push({ page: i, rect: [e + charX(it, k), f - h * 0.22, e + charX(it, k + q.length), f + h * 0.9] });
        k = s.indexOf(q, k + q.length);
      }
    }
  }
  S.search.hits = hits;
  const start = hits.findIndex((h) => h.page >= S.current);
  showHit(hits.length ? Math.max(0, start) : -1);
}
function showHit(i) {
  const { hits } = S.search;
  if (!hits.length) { $('#searchCount').textContent = S.search.term ? '0 Treffer' : ''; redraw(); return; }
  i = (i + hits.length) % hits.length;
  S.search.idx = i;
  $('#searchCount').textContent = `${i + 1} / ${hits.length}`;
  redraw();
  const h = hits[i], p = S.pages[h.page];
  const v = vpRect(p, h.rect);
  const viewer = $('#viewer');
  viewer.scrollTo({ top: p.el.offsetTop + v.y - viewer.clientHeight / 3, left: Math.max(0, p.el.offsetLeft + v.x - viewer.clientWidth / 2), behavior: 'smooth' });
}
function openSearch() {
  if (!S.pdf) return;
  $('#searchbar').hidden = false;
  const i = $('#searchInput');
  const sel = window.getSelection()?.toString().trim();
  if (sel && sel.length < 80) i.value = sel;
  i.focus(); i.select();
}
function closeSearch() {
  $('#searchbar').hidden = true;
  S.search = { term: '', hits: [], idx: -1 };
  redraw();
  $('#viewer').focus();
}
let searchDebounce = 0;
$('#searchInput').addEventListener('input', (e) => { clearTimeout(searchDebounce); searchDebounce = setTimeout(() => runSearch(e.target.value), 220); });
$('#searchInput').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    if (S.search.term !== e.target.value.trim()) runSearch(e.target.value);
    else showHit(S.search.idx + (e.shiftKey ? -1 : 1));
  }
  if (e.key === 'Escape') closeSearch();
});

// ------------------------------------------------------------ Einstellungen
function openSettings() {
  const s = S.settings;
  $('#optAutosave').checked = s.autosave;
  $('#optDelay').value = s.delay;
  $('#optDelayLabel').textContent = `${s.delay}s`;
  $('#optBackup').checked = s.backup;
  $('#optStars').checked = s.stars;
  $('#settings').hidden = false;
}
$('#optAutosave').onchange = (e) => { S.settings.autosave = e.target.checked; persistSettings(); if (S.settings.autosave && S.dirty) save(); refreshSync(); };
$('#optDelay').oninput = (e) => { S.settings.delay = +e.target.value; $('#optDelayLabel').textContent = `${S.settings.delay}s`; persistSettings(); };
$('#optBackup').onchange = (e) => { S.settings.backup = e.target.checked; persistSettings(); };
$('#optStars').onchange = (e) => { S.settings.stars = e.target.checked; setStarsEnabled(S.settings.stars); persistSettings(); };
$('#settings').addEventListener('click', (e) => { if (e.target.id === 'settings') $('#settings').hidden = true; });

// ------------------------------------------------------------ Updates
const U = { info: null, phase: 'idle', skipped: null }; // idle | available | downloading | ready
function showUpdate(info) {
  U.info = info;
  if (U.phase === 'downloading' || U.phase === 'ready') return;
  U.phase = 'available';
  $('#updateTitle').textContent = `Galaxit ${info.latest} ist da ✦`;
  $('#updateSub').textContent = `Du hast ${info.current}${info.size ? ` · ${(info.size / 1048576).toFixed(0)} MB` : ''}`;
  $('#updateNotes').textContent = (info.notes || '').trim().slice(0, 600);
  $('#updateBar').hidden = true;
  $('#updateBtn').textContent = 'Jetzt aktualisieren';
  $('#updateBtn').disabled = false;
  $('#updateCard').hidden = false;
  $('#updateState').textContent = `Version ${info.latest} verfügbar`;
}
async function startUpdate() {
  if (U.phase === 'ready') {
    $('#updateBtn').disabled = true;
    $('#updateBtn').textContent = 'Startet neu…';
    document.querySelector('.text-editor')?.blur();
    hideNotePop(true);
    await flush();
    try { await api.installUpdate(); } catch (e) { toast(e.message, 'err'); $('#updateBtn').disabled = false; }
    return;
  }
  if (U.phase !== 'available') return;
  U.phase = 'downloading';
  $('#updateBar').hidden = false;
  $('#updateFill').style.width = '0%';
  $('#updateBtn').disabled = true;
  $('#updateBtn').textContent = 'Lädt…';
  try {
    await api.downloadUpdate();
    U.phase = 'ready';
    $('#updateFill').style.width = '100%';
    $('#updateBtn').disabled = false;
    $('#updateBtn').textContent = 'Neu starten & installieren';
    $('#updateSub').textContent = 'Bereit – deine Arbeit wird vorher gespeichert';
  } catch (e) {
    U.phase = 'available';
    $('#updateBtn').disabled = false;
    $('#updateBtn').textContent = 'Erneut versuchen';
    toast(`Update-Download fehlgeschlagen: ${e.message}`, 'err');
  }
}
api.onUpdateStatus((s) => {
  if (s.type === 'progress') {
    $('#updateFill').style.width = `${Math.round(s.progress * 100)}%`;
    $('#updateBtn').textContent = `Lädt… ${Math.round(s.progress * 100)}%`;
  } else if (s.type === 'checked') {
    $('#updateCheckBtn').disabled = false;
    if (s.available) showUpdate(s);
    else {
      $('#updateState').textContent = s.error ? s.error : `Du hast die neueste Version (${s.current})`;
      if (s.manual) toast(s.error ? s.error : 'Galaxit ist auf dem neuesten Stand ✦');
    }
  } else if (s.type === 'error') {
    $('#updateCheckBtn').disabled = false;
    $('#updateState').textContent = 'Prüfung fehlgeschlagen';
    if (s.manual) toast(`Update-Prüfung fehlgeschlagen: ${s.message}`, 'err');
  }
});

// ------------------------------------------------------------ Befehle
const CMD = {
  updateGo: startUpdate,
  updateDismiss: () => { $('#updateCard').hidden = true; },
  updateNotesLink: () => U.info?.page && api.openExternal(U.info.page),
  updateCheck: () => { $('#updateCheckBtn').disabled = true; $('#updateState').textContent = 'Suche…'; api.checkUpdate(); },
  open: async () => openPath(await api.openDialog()),
  save: () => save({ manual: true }),
  saveAs,
  sidebar: toggleSidebar,
  prev: () => gotoPage(S.current - 1),
  next: () => gotoPage(S.current + 1),
  zoomIn: () => setZoom(S.zoom * 1.15),
  zoomOut: () => setZoom(S.zoom / 1.15),
  fitWidth,
  undo, redo,
  search: () => ($('#searchbar').hidden ? openSearch() : closeSearch()),
  searchNext: () => showHit(S.search.idx + 1),
  searchPrev: () => showHit(S.search.idx - 1),
  searchClose: closeSearch,
  settings: openSettings,
  settingsClose: () => { $('#settings').hidden = true; },
  openBackups: () => api.openBackups(),
  noteDone: () => hideNotePop(true),
  noteDelete: () => { const id = noteCtx?.id; noteCtx = null; $('#notePop').hidden = true; if (id) removeAnnot(id); },
};

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (b && CMD[b.dataset.cmd]) { CMD[b.dataset.cmd](); return; }
  const t = e.target.closest('[data-tool]');
  if (t) setTool(t.dataset.tool);
  const w = e.target.closest('[data-width]');
  if (w) { S.settings.penWidth = +w.dataset.width; persistSettings(); renderSwatches(); }
  if (!$('#notePop').hidden && !e.target.closest('#notePop') && !e.target.closest('.ann.note') && !e.target.closest('.catcher')) hideNotePop(true);
});

$('#noteText').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) hideNotePop(true);
  if (e.key === 'Escape') hideNotePop(true);
});

$('#pageInput').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') { gotoPage((parseInt(e.target.value, 10) || 1) - 1); $('#viewer').focus(); }
});

document.addEventListener('keydown', (e) => {
  const typing = e.target.matches('input, textarea');
  const k = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (k === 'o') { e.preventDefault(); CMD.open(); }
    else if (k === 's' && e.shiftKey) { e.preventDefault(); saveAs(); }
    else if (k === 's') { e.preventDefault(); save({ manual: true }); }
    else if (k === 'f') { e.preventDefault(); openSearch(); }
    else if (typing) return;
    else if (k === 'z' && e.shiftKey) { e.preventDefault(); redo(); }
    else if (k === 'z') { e.preventDefault(); undo(); }
    else if (k === 'y') { e.preventDefault(); redo(); }
    else if (k === '+' || k === '=') { e.preventDefault(); CMD.zoomIn(); }
    else if (k === '-') { e.preventDefault(); CMD.zoomOut(); }
    else if (k === '0') { e.preventDefault(); fitWidth(); }
    return;
  }
  if (typing || !S.pdf) return;
  const tools = { v: 'select', h: 'highlight', p: 'pen', t: 'text', n: 'note', e: 'eraser' };
  if (tools[k]) setTool(tools[k]);
  else if (e.key === 'Escape') { setTool('select'); hideNotePop(true); }
  else if (e.key === 'PageDown' || (e.key === 'ArrowRight' && !e.shiftKey)) { e.preventDefault(); CMD.next(); }
  else if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && !e.shiftKey)) { e.preventDefault(); CMD.prev(); }
  else if (e.key === 'Home') { e.preventDefault(); gotoPage(0); }
  else if (e.key === 'End') { e.preventDefault(); gotoPage(S.pages.length - 1); }
  else if (e.key === 'F3') { e.preventDefault(); showHit(S.search.idx + (e.shiftKey ? -1 : 1)); }
});

// Strg + Mausrad = Zoom um den Cursor
let wheelZoom = 1, wheelRaf = 0;
$('#viewer').addEventListener('wheel', (e) => {
  if (!e.ctrlKey || !S.pdf) return;
  e.preventDefault();
  wheelZoom *= e.deltaY < 0 ? 1.1 : 1 / 1.1;
  if (wheelRaf) return;
  wheelRaf = requestAnimationFrame(() => { wheelRaf = 0; const f = wheelZoom; wheelZoom = 1; setZoom(S.zoom * f); });
}, { passive: false });

window.addEventListener('resize', () => { if (S.pdf) layout(); });

// Tooltips
const tip = $('#tooltip');
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest('[data-tip]');
  if (!t) { tip.hidden = true; return; }
  tip.textContent = t.dataset.tip;
  tip.hidden = false;
  const r = t.getBoundingClientRect();
  const w = tip.offsetWidth;
  tip.style.left = `${clamp(r.left + r.width / 2 - w / 2, 8, window.innerWidth - w - 8)}px`;
  tip.style.top = `${r.bottom + 8}px`;
});
document.addEventListener('mousedown', () => { tip.hidden = true; });

// Drag & Drop
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if ([...e.dataTransfer.types].includes('Files')) { dragDepth++; $('#drop').hidden = false; } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop').hidden = true; } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0; $('#drop').hidden = true;
  const f = [...e.dataTransfer.files].find((x) => /\.pdf$/i.test(x.name));
  if (f) openPath(api.pathForFile(f)); else toast('Bitte eine PDF-Datei ablegen.', 'warn');
});

// Schließen: offene Änderungen sichern
api.onBeforeClose(async () => {
  try {
    document.querySelector('.text-editor')?.blur();
    hideNotePop(true);
    if (S.saving) await S.savingPromise;
    if (S.dirty && !S.readOnly) {
      if (S.settings.autosave) await save();
      else if (await modal({ title: 'Änderungen speichern?', text: `${S.name} hat ungespeicherte Änderungen.`, ok: 'Speichern', cancel: 'Verwerfen' })) await save({ manual: true });
    }
    clearTimeout(settingsTimer);
    await api.saveSettings(S.settings);
  } finally { api.closeOk(); }
});
api.onOpenPath((p) => openPath(p));

// ------------------------------------------------------------ Start
(async () => {
  hydrateIcons();
  const saved = await api.loadSettings();
  S.settings = { ...S.settings, ...saved, colors: { ...S.settings.colors, ...(saved.colors || {}) } };
  startStars(S.settings.stars);
  setTool('select');
  updateUndoButtons();
  refreshSync();
  renderRecent();
  const info = await api.appInfo();
  $('#versionLabel').textContent = `Galaxit ${info.version}${info.repo ? ` · github.com/${info.repo}` : ''}`;
  if (info.justUpdated) toast(`Galaxit wurde auf ${info.version} aktualisiert ✦`);
  const pending = await api.getPendingFile();
  if (pending) openPath(pending);
})();

export { openPath, addAnnot, save, setTool, setZoom, runSearch };
window.__galaxitApi = { openPath, addAnnot, save, setTool, setZoom, runSearch, highlightArea, undo, toggleSidebar };
