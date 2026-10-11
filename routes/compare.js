import { Router } from 'express';
import multer from 'multer';
import { httpError } from '../lib/pdf-utils.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024, files: 2 },
});

/**
 * POST /api/compare — text-level diff between two PDFs.
 *   fileA, fileB   the two PDFs
 * Returns JSON:
 *   { pages: [{ page, added, removed, changed, diff: [...]}], summary: {...} }
 * diff entries use { op: '=' | '+' | '-', text }.
 */
router.post('/', upload.fields([{ name: 'fileA', maxCount: 1 }, { name: 'fileB', maxCount: 1 }]),
  async (req, res, next) => {
  try {
    const a = req.files?.fileA?.[0];
    const b = req.files?.fileB?.[0];
    if (!a || !b) throw httpError(400, 'Two files required: fileA and fileB');
    const [textA, textB] = await Promise.all([extractPages(a.buffer), extractPages(b.buffer)]);
    const maxPages = Math.max(textA.length, textB.length);
    const results = [];
    let totalAdded = 0, totalRemoved = 0, pagesChanged = 0;
    for (let i = 0; i < maxPages; i++) {
      const linesA = (textA[i] ?? '').split('\n');
      const linesB = (textB[i] ?? '').split('\n');
      const diff = lineDiff(linesA, linesB);
      const added = diff.filter(d => d.op === '+').length;
      const removed = diff.filter(d => d.op === '-').length;
      const changed = added > 0 || removed > 0;
      if (changed) pagesChanged++;
      totalAdded += added;
      totalRemoved += removed;
      results.push({ page: i, added, removed, changed, diff });
    }
    res.json({
      summary: {
        pagesA: textA.length, pagesB: textB.length,
        pagesChanged, totalAdded, totalRemoved,
      },
      pages: results,
    });
  } catch (e) { next(e); }
});

async function extractPages(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(buffer);
  const doc = await pdfjs.getDocument({ data, useSystemFonts: false, disableFontFace: true }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Group by approximate y to form lines.
    const items = content.items.map(it => ({
      str: it.str,
      x: it.transform[4],
      y: Math.round(it.transform[5]),
    }));
    items.sort((p, q) => (q.y - p.y) || (p.x - q.x));
    const lines = [];
    let currentY = null, currentLine = [];
    for (const it of items) {
      if (currentY === null || Math.abs(it.y - currentY) <= 2) {
        currentLine.push(it.str);
      } else {
        lines.push(currentLine.join(' ').trim());
        currentLine = [it.str];
      }
      currentY = it.y;
    }
    if (currentLine.length) lines.push(currentLine.join(' ').trim());
    out.push(lines.filter(l => l.length).join('\n'));
  }
  return out;
}

/** Classic LCS-based line diff. */
function lineDiff(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const out = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { out.push({ op: '=', text: a[i - 1] }); i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) { out.push({ op: '-', text: a[i - 1] }); i--; }
    else { out.push({ op: '+', text: b[j - 1] }); j--; }
  }
  while (i > 0) { out.push({ op: '-', text: a[--i] }); }
  while (j > 0) { out.push({ op: '+', text: b[--j] }); }
  return out.reverse();
}

export default router;
