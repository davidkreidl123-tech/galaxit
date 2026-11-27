// Galaxit – PDF lesen/schreiben (pdf-lib)
// Anmerkungen werden als echte PDF-Annotationen mit Appearance-Streams geschrieben
// (sichtbar in Acrobat, Edge, Chrome …). Jede trägt zusätzlich /GalaxitData mit
// ihren Rohdaten, damit Galaxit sie beim nächsten Öffnen wieder bearbeiten kann.
const { PDFDocument, PDFName, PDFArray, PDFDict, PDFRef, PDFString, PDFHexString } = window.PDFLib;

const KEY = 'GalaxitData';
const n = (v) => +(+v).toFixed(3);

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => n(parseInt(h.slice(i, i + 2), 16) / 255));
}

/** Liest Galaxit-Anmerkungen aus und liefert ein PDF ohne sie (als Basis zum Rendern & Speichern). */
export async function extractGalaxit(bytes) {
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    const enc = /encrypt/i.test(e.message || '');
    return { baseBytes: bytes, annots: [], readOnly: true, reason: enc ? 'encrypted' : 'unsupported' };
  }
  const annots = [];
  let found = false;
  doc.getPages().forEach((page, pi) => {
    const arr = page.node.lookup(PDFName.of('Annots'));
    if (!(arr instanceof PDFArray)) return;
    const mine = [];
    for (let i = arr.size() - 1; i >= 0; i--) {
      const ref = arr.get(i);
      const dict = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
      if (!(dict instanceof PDFDict)) continue;
      const data = dict.get(PDFName.of(KEY));
      if (!data) continue;
      found = true;
      try {
        const a = JSON.parse(data.decodeText());
        a.page = pi;
        mine.unshift(a);
      } catch { /* defekte Daten ignorieren */ }
      arr.remove(i);
      const ap = dict.lookup(PDFName.of('AP'));
      const nref = ap instanceof PDFDict ? ap.get(PDFName.of('N')) : null;
      if (nref instanceof PDFRef) doc.context.delete(nref);
      if (ref instanceof PDFRef) doc.context.delete(ref);
    }
    annots.push(...mine);
  });
  const baseBytes = found ? await doc.save({ useObjectStreams: false, updateFieldAppearances: false }) : bytes;
  return { baseBytes, annots, readOnly: false };
}

/** Baut die fertige PDF: Basis + aktuelle Anmerkungen. */
export async function buildPdf(baseBytes, annots) {
  const doc = await PDFDocument.load(baseBytes, { updateMetadata: false });
  const pages = doc.getPages();
  const ctx = doc.context;
  for (const a of annots) {
    const page = pages[a.page];
    if (!page) continue;
    const dict = buildAnnot(ctx, a, page.ref);
    if (!dict) continue;
    const ref = ctx.register(dict);
    let arr = page.node.lookup(PDFName.of('Annots'));
    if (!(arr instanceof PDFArray)) {
      arr = ctx.obj([]);
      page.node.set(PDFName.of('Annots'), arr);
    }
    arr.push(ref);
  }
  doc.setModificationDate(new Date());
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}

// ------------------------------------------------------------------ Bausteine
function form(ctx, bbox, ops, resources = {}) {
  return ctx.register(ctx.stream(ops, {
    Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: bbox.map(n), Resources: resources,
  }));
}

function gstate(op, multiply = false) {
  const g = { Type: 'ExtGState', CA: n(op), ca: n(op) };
  if (multiply) g.BM = 'Multiply';
  return { ExtGState: { GS0: g } };
}

function common(a, pageRef) {
  const { page, ...data } = a;
  return {
    Type: 'Annot', F: 4, P: pageRef,
    NM: PDFString.of(a.id),
    T: PDFHexString.fromText('Galaxit'),
    M: PDFString.fromDate(new Date(a.modified || Date.now())),
    C: hexToRgb(a.color),
    [KEY]: PDFHexString.fromText(JSON.stringify(data)),
  };
}

function bounds(pts, pad) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad].map(n);
}

// Glatte Linie: quadratische Mittelpunkt-Kurven -> kubische Bézier-Operatoren
function smoothOps(pts) {
  if (pts.length === 1) return `${n(pts[0][0])} ${n(pts[0][1])} m ${n(pts[0][0])} ${n(pts[0][1])} l`;
  let o = `${n(pts[0][0])} ${n(pts[0][1])} m`;
  let px = pts[0][0], py = pts[0][1];
  for (let i = 1; i < pts.length - 1; i++) {
    const [cx, cy] = pts[i];
    const mx = (cx + pts[i + 1][0]) / 2, my = (cy + pts[i + 1][1]) / 2;
    const c1x = px + (2 / 3) * (cx - px), c1y = py + (2 / 3) * (cy - py);
    const c2x = mx + (2 / 3) * (cx - mx), c2y = my + (2 / 3) * (cy - my);
    o += ` ${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(mx)} ${n(my)} c`;
    px = mx; py = my;
  }
  const l = pts[pts.length - 1];
  return o + ` ${n(l[0])} ${n(l[1])} l`;
}

const WINANSI = { '€': 128, '‚': 130, '„': 132, '…': 133, '†': 134, '‰': 137, '‹': 139, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151, '™': 153, '›': 155 };
function pdfText(str) {
  let out = '';
  for (const ch of str) {
    const c = ch.codePointAt(0);
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else if (c >= 32 && c < 127) out += ch;
    else if (c >= 160 && c <= 255) out += '\\' + c.toString(8).padStart(3, '0');
    else if (WINANSI[ch]) out += '\\' + WINANSI[ch].toString(8).padStart(3, '0');
    else out += '?';
  }
  return `(${out})`;
}

function buildAnnot(ctx, a, pageRef) {
  const [r, g, b] = hexToRgb(a.color);
  const base = common(a, pageRef);

  if (a.type === 'highlight') {
    const rects = a.rects.map(([x0, y0, x1, y1]) => [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)]);
    if (!rects.length) return null;
    const bb = bounds(rects.flatMap(([x0, y0, x1, y1]) => [[x0, y0], [x1, y1]]), 1);
    const op = a.opacity ?? 0.45;
    const ops = `/GS0 gs ${r} ${g} ${b} rg ` + rects.map(([x0, y0, x1, y1]) => `${n(x0)} ${n(y0)} ${n(x1 - x0)} ${n(y1 - y0)} re`).join(' ') + ' f';
    return ctx.obj({
      ...base, Subtype: 'Highlight', Rect: bb, CA: n(op),
      QuadPoints: rects.flatMap(([x0, y0, x1, y1]) => [x0, y1, x1, y1, x0, y0, x1, y0].map(n)),
      AP: { N: form(ctx, bb, ops, gstate(op, true)) },
    });
  }

  if (a.type === 'ink') {
    const all = a.paths.flat();
    if (!all.length) return null;
    const bb = bounds(all, a.width);
    const op = a.opacity ?? 1;
    const ops = `/GS0 gs ${r} ${g} ${b} RG ${n(a.width)} w 1 J 1 j ` + a.paths.map((p) => smoothOps(p) + ' S').join(' ');
    return ctx.obj({
      ...base, Subtype: 'Ink', Rect: bb, CA: n(op),
      InkList: a.paths.map((p) => p.flatMap(([x, y]) => [n(x), n(y)])),
      BS: { Type: 'Border', W: n(a.width), S: 'S' },
      AP: { N: form(ctx, bb, ops, gstate(op)) },
    });
  }

  if (a.type === 'text') {
    const [x0, y0, x1, y1] = a.rect;
    const size = a.size, lh = size * 1.25;
    const lines = a.text.split('\n');
    let ops = `BT /Helv ${n(size)} Tf ${r} ${g} ${b} rg ${n(x0 + 2)} ${n(y1 - size)} Td`;
    lines.forEach((ln, i) => { ops += `${i ? ` 0 ${n(-lh)} Td` : ''} ${pdfText(ln)} Tj`; });
    ops += ' ET';
    const font = { Font: { Helv: { Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' } } };
    return ctx.obj({
      ...base, Subtype: 'FreeText', Rect: [x0, y0, x1, y1].map(n),
      Contents: PDFHexString.fromText(a.text),
      DA: PDFString.of(`/Helv ${n(size)} Tf ${r} ${g} ${b} rg`),
      BS: { W: 0 }, Border: [0, 0, 0],
      AP: { N: form(ctx, [x0, y0, x1, y1], ops, font) },
    });
  }

  if (a.type === 'note') {
    const rect = [a.x, a.y - 22, a.x + 22, a.y].map(n);
    const ops = `${r} ${g} ${b} rg 1 6 20 15 re f 5 6.5 m 5 1 l 10.5 6.5 l f 1 1 1 RG 1.6 w 1 J 5 16 m 17 16 l S 5 11.5 m 13 11.5 l S`;
    return ctx.obj({
      ...base, Subtype: 'Text', Rect: rect, Name: 'Comment', Open: false,
      Contents: PDFHexString.fromText(a.text || ''),
      AP: { N: form(ctx, [0, 0, 22, 22], ops) },
    });
  }
  return null;
}
