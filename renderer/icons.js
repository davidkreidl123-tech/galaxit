// Galaxit-Iconset (24er Raster, Konturen in currentColor)
const P = {
  open: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v1"/><path d="M3.6 18.2 5.8 12a2 2 0 0 1 1.9-1.4H21l-2.6 7.6a2 2 0 0 1-1.9 1.3H5.4a2 2 0 0 1-1.8-1.3Z"/>',
  save: '<path d="M5 3h11l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 1-2Z"/><path d="M8 3v5h7V3"/><circle cx="12" cy="15" r="2.5"/>',
  saveAs: '<path d="M12 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10l4 4v4"/><path d="M8 3v5h7V3"/><path d="m15.5 21 1.2-3.7 3.5-3.5a1.6 1.6 0 0 1 2.3 2.3l-3.5 3.5Z"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/><path d="M5.5 8h1.5M5.5 11h1.5M5.5 14h1.5"/>',
  prev: '<path d="m15 18-6-6 6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6"/>',
  select: '<path d="M5 3.5 18.5 10l-5.8 1.9L10.6 18Z"/><path d="m13 12 5 5"/>',
  highlight: '<path d="m9 11-5 5v3h6l5-5"/><path d="m22 6.5-8.5 8.5-5-5L17 1.5Z"/><path d="M3 22h8"/>',
  pen: '<path d="M16.8 3.2a2.4 2.4 0 0 1 3.4 3.4L8 18.8 3.5 20.5 5.2 16Z"/><path d="m14.5 5.5 4 4"/>',
  text: '<path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6"/>',
  note: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v9a2.5 2.5 0 0 1-2.5 2.5H10l-5 4v-4.2A2.5 2.5 0 0 1 4 14.5Z"/><path d="M8.5 8.5h7M8.5 12h4.5"/>',
  eraser: '<path d="m7 21-4.3-4.3a1.5 1.5 0 0 1 0-2.1L13.6 3.7a1.5 1.5 0 0 1 2.1 0l5.6 5.6a1.5 1.5 0 0 1 0 2.1L11 21Z"/><path d="M7 21h14M9.5 9.5l5.6 5.6"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  settings: '<path d="M12 2.5 14 5l3.2-.4.4 3.2L20 9.6l-1.2 3 1.2 3-2.4 1.8-.4 3.2L14 20.2 12 22.5l-2-2.3-3.2.4-.4-3.2L4 15.6l1.2-3L4 9.6l2.4-1.8.4-3.2L10 5Z"/><circle cx="12" cy="12" r="3.2"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
};

export function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
}

const MAP = {
  searchPrev: 'up', searchNext: 'down', searchClose: 'close', settingsClose: 'close', noteDelete: 'trash', updateDismiss: 'close',
};

export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-cmd], [data-tool], [data-icon]').forEach((el) => {
    if (el.classList.contains('cta') || el.classList.contains('pill-btn') || el.classList.contains('zoom-label')) return;
    const key = el.dataset.icon || el.dataset.tool || MAP[el.dataset.cmd] || el.dataset.cmd;
    if (P[key]) el.innerHTML = icon(key);
  });
}
