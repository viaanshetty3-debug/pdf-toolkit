// Deeper PDF structure extraction using pdf.js: text with font+position,
// embedded images with page refs, and heuristic layout analysis.
//
// Everything here reads a PDF Buffer and returns a serialisable structure
// that the various PDF→Office routes consume.

let pdfjsPromise = null;
function pdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

/**
 * Extract rich per-page content.
 *
 * Returns:
 *   {
 *     pages: [{
 *       width, height,
 *       blocks: [{
 *         kind: 'heading' | 'paragraph' | 'line',
 *         level?,                          // 1..6 for headings
 *         text,
 *         fontSize,
 *         bold,
 *         x, y, w, h,                      // bottom-left origin, points
 *       }],
 *       images: [{ x, y, w, h, kind: 'png'|'jpg', bytes }],
 *     }],
 *     docFontSize: median body size across the doc,
 *   }
 */
export async function extractRichStructure(buffer) {
  const mod = await pdfjs();
  const data = new Uint8Array(buffer);
  const doc = await mod.getDocument({ data, useSystemFonts: false, disableFontFace: true }).promise;

  // First pass: collect all font sizes to infer the body size.
  const allSizes = [];
  const perPage = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items.map(it => {
      const [a, b, c, d, e, f] = it.transform;
      const fontSize = Math.hypot(a, b);
      allSizes.push(fontSize);
      return {
        str: it.str,
        x: e,
        y: f,                                // pdf.js already uses PDF (bottom-left) coords
        width: it.width,
        fontSize,
        fontName: it.fontName || '',
      };
    });
    perPage.push({ width: viewport.width, height: viewport.height, items });
  }

  const docFontSize = median(allSizes) || 11;

  // Second pass: group into lines, classify, extract images.
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const { width, height, items } = perPage[i - 1];
    const lines = groupIntoLines(items);
    const blocks = classifyBlocks(lines, docFontSize);
    const images = await extractPageImages(doc, i);
    pages.push({ width, height, blocks, images });
  }

  return { pages, docFontSize };
}

/** Group items with similar y into logical lines, sort left-to-right. */
function groupIntoLines(items) {
  const sorted = [...items].sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const lines = [];
  let current = null;
  for (const it of sorted) {
    const yThresh = Math.max(1, it.fontSize * 0.5);
    if (!current || Math.abs(current.y - it.y) > yThresh) {
      current = { y: it.y, items: [it] };
      lines.push(current);
    } else {
      current.items.push(it);
      current.y = (current.y + it.y) / 2;
    }
  }
  // Join items within a line, keeping position info.
  return lines.map(l => {
    const its = l.items.sort((a, b) => a.x - b.x);
    const text = its.map(it => it.str).join('').replace(/\s+/g, ' ').trim();
    const fontSize = median(its.map(it => it.fontSize));
    const bold = its.some(it => /bold|black|heavy/i.test(it.fontName));
    const x = its.length ? its[0].x : 0;
    const w = its.length ? its[its.length - 1].x + its[its.length - 1].width - x : 0;
    return { text, fontSize, bold, x, y: l.y, w, h: fontSize, items: its };
  }).filter(l => l.text);
}

/** Classify each line as heading / paragraph. Merge adjacent lines of similar
 *  size + spacing into one paragraph block. */
function classifyBlocks(lines, body) {
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const ratio = l.fontSize / body;
    let kind = 'line';
    let level;
    if (ratio >= 1.6) { kind = 'heading'; level = 1; }
    else if (ratio >= 1.35) { kind = 'heading'; level = 2; }
    else if (ratio >= 1.18) { kind = 'heading'; level = 3; }
    else if (ratio >= 1.08 && l.bold) { kind = 'heading'; level = 4; }
    else { kind = 'paragraph'; }
    blocks.push({ kind, level, text: l.text, fontSize: l.fontSize, bold: l.bold, x: l.x, y: l.y, w: l.w, h: l.h, items: l.items });
  }
  // Merge consecutive paragraph lines into single block if close vertically.
  const merged = [];
  for (const b of blocks) {
    const prev = merged[merged.length - 1];
    if (prev && prev.kind === 'paragraph' && b.kind === 'paragraph') {
      const gap = prev.y - b.y;
      if (gap < b.fontSize * 1.6) {
        prev.text = `${prev.text} ${b.text}`;
        prev.h = prev.y + prev.h - b.y;
        prev.y = b.y;
        continue;
      }
    }
    merged.push({ ...b });
  }
  return merged;
}

/** Extract image XObjects from a page via pdf-lib. */
async function extractPageImages(doc, pageIndex) {
  // Shortcut: pdf.js doesn't expose XObjects directly. We re-load the PDF
  // with pdf-lib to pull image data.
  try {
    const { PDFDocument, PDFName, PDFRawStream } = await import('pdf-lib');
    const buf = await doc.getData();
    const plDoc = await PDFDocument.load(buf, { ignoreEncryption: true });
    const page = plDoc.getPage(pageIndex - 1);
    const resources = page.node.Resources?.();
    if (!resources) return [];
    const xObjectDict = resources.get(PDFName.of('XObject'));
    if (!xObjectDict) return [];
    const results = [];
    for (const key of xObjectDict.keys()) {
      const ref = xObjectDict.get(key);
      const obj = plDoc.context.lookup(ref);
      if (!(obj instanceof PDFRawStream)) continue;
      const dict = obj.dict;
      const subtype = dict.get(PDFName.of('Subtype'));
      if (!subtype || subtype.toString() !== '/Image') continue;
      const filter = dict.get(PDFName.of('Filter'));
      const filterName = filter ? filter.toString() : '';
      const w = dict.get(PDFName.of('Width'))?.asNumber?.() ?? 0;
      const h = dict.get(PDFName.of('Height'))?.asNumber?.() ?? 0;
      const bytes = Buffer.from(obj.getContents());
      if (filterName.includes('DCTDecode')) {
        results.push({ x: 0, y: 0, w, h, kind: 'jpg', bytes });
      }
      // PNG XObjects use FlateDecode with raw pixels — not easily re-embeddable
      // without decoding ourselves. Skip for now.
    }
    return results;
  } catch { return []; }
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
