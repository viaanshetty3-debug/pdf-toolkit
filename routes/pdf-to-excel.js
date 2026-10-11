import { Router } from 'express';
import * as XLSX from 'xlsx';
import { upload, httpError } from '../lib/pdf-utils.js';
import { extractRichStructure } from '../lib/pdf-structure.js';

const router = Router();

/**
 * POST /api/pdf-to-excel — layout-aware table detection.
 *
 * Builds a global column grid from the x-positions of all text runs on a
 * page: tightly clustered start-x values become columns. Each line is then
 * dropped into the matching columns. For truly tabular PDFs this produces
 * clean grids; for prose, you get single-column paragraphs (which is fine).
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    const { pages } = await extractRichStructure(req.file.buffer);
    const wb = XLSX.utils.book_new();

    pages.forEach((page, i) => {
      const grid = buildGrid(page);
      const ws = XLSX.utils.aoa_to_sheet(grid);
      // Guess column widths from max cell length.
      if (grid.length) {
        const colCount = Math.max(...grid.map(r => r.length));
        const widths = Array(colCount).fill(0);
        for (const row of grid) {
          row.forEach((c, j) => widths[j] = Math.max(widths[j], String(c ?? '').length));
        }
        ws['!cols'] = widths.map(w => ({ wch: Math.min(60, Math.max(8, w + 2)) }));
      }
      XLSX.utils.book_append_sheet(wb, ws, `Page ${i + 1}`.slice(0, 31));
    });

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="converted.xlsx"');
    res.setHeader('Content-Length', buf.length);
    res.end(buf);
  } catch (e) { next(e); }
});

/**
 * Detect columns on this page by clustering the x-positions of every text
 * item. Values within `TOLERANCE` points of each other are the same column.
 */
function buildGrid(page) {
  const items = page.blocks.flatMap(b => (b.items || []));
  if (items.length === 0) return [];
  const TOLERANCE = 4;
  // Find column anchors (start-x values) sorted and clustered.
  const xs = items.map(it => it.x).sort((a, b) => a - b);
  const anchors = [];
  for (const x of xs) {
    if (!anchors.length || x - anchors[anchors.length - 1] > TOLERANCE) anchors.push(x);
  }
  // Assign each item to its nearest anchor column.
  const colIdx = (x) => {
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < anchors.length; i++) {
      const d = Math.abs(x - anchors[i]);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  };

  // Group items by line (y), then by column.
  const lineMap = new Map();
  for (const it of items) {
    const yKey = Math.round(it.y);
    const slot = Math.round(yKey / 2) * 2;  // bucket to even ints
    if (!lineMap.has(slot)) lineMap.set(slot, {});
    const row = lineMap.get(slot);
    const col = colIdx(it.x);
    row[col] = (row[col] ? row[col] + ' ' : '') + it.str;
  }
  // Return rows sorted by y descending (PDFs are bottom-up).
  const rows = [...lineMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([_y, row]) => {
      const arr = Array(anchors.length).fill('');
      for (const [col, text] of Object.entries(row)) arr[parseInt(col)] = text.replace(/\s+/g, ' ').trim();
      return arr;
    });
  // Trim empty trailing columns.
  let maxCol = 0;
  for (const r of rows) {
    for (let j = r.length - 1; j >= 0; j--) if (r[j]) { maxCol = Math.max(maxCol, j); break; }
  }
  return rows.map(r => r.slice(0, maxCol + 1));
}

export default router;
