// Shared pdfjs-dist helper for server-side text extraction.

let pdfjsPromise = null;
function pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsPromise;
}

/**
 * Extract text per page from a PDF buffer. Returns an array of pages, each
 * page an array of lines, each line a string.
 */
export async function extractPagesLines(buffer) {
  const pdf = await openDoc(buffer);
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    pages.push(await extractLines(pdf, i));
  }
  return pages;
}

export async function openDoc(buffer) {
  const mod = await pdfjs();
  const data = new Uint8Array(buffer);
  return mod.getDocument({ data, useSystemFonts: false, disableFontFace: true }).promise;
}

export async function extractLines(pdf, pageNum) {
  const page = await pdf.getPage(pageNum);
  const content = await page.getTextContent();
  const items = content.items.map(it => ({
    str: it.str,
    x: it.transform[4],
    y: Math.round(it.transform[5]),
    width: it.width,
  }));
  items.sort((p, q) => (q.y - p.y) || (p.x - q.x));
  const lines = [];
  let currentY = null, currentLine = [];
  for (const it of items) {
    if (currentY === null || Math.abs(it.y - currentY) <= 2) {
      currentLine.push(it);
    } else {
      lines.push(formatLine(currentLine));
      currentLine = [it];
    }
    currentY = it.y;
  }
  if (currentLine.length) lines.push(formatLine(currentLine));
  return lines.filter(l => l.length);
}

function formatLine(items) {
  return items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Extract text with positional info: array of { page, lines: [{ y, items: [{str,x,width}] }] }.
 * Useful for table detection.
 */
export async function extractPositioned(buffer) {
  const pdf = await openDoc(buffer);
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    const items = content.items.map(it => ({
      str: it.str,
      x: it.transform[4],
      y: Math.round(it.transform[5]),
      width: it.width,
    }));
    items.sort((p, q) => (q.y - p.y) || (p.x - q.x));
    const lines = [];
    let currentY = null, currentLine = [];
    for (const it of items) {
      if (currentY === null || Math.abs(it.y - currentY) <= 2) {
        currentLine.push(it);
      } else {
        lines.push({ y: currentY, items: currentLine });
        currentLine = [it];
      }
      currentY = it.y;
    }
    if (currentLine.length) lines.push({ y: currentY, items: currentLine });
    out.push({ page: i - 1, width: viewport.width, height: viewport.height, lines });
  }
  return out;
}
