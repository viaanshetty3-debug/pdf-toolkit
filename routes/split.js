import { Router } from 'express';
import archiver from 'archiver';
import { PDFDocument } from 'pdf-lib';
import { upload, loadPdf, parseRangeSpec, copyPages, httpError, sendPdf } from '../lib/pdf-utils.js';

const router = Router();

/**
 * POST /api/split — three modes:
 *   mode=ranges  ranges="1-3,5,7-9"     → one PDF per range token (ZIP)
 *   mode=every   size=N                 → one PDF per N pages (ZIP)
 *   mode=extract ranges="2-4"           → single PDF with just those pages
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    const src = await loadPdf(req.file.buffer);
    const pageCount = src.getPageCount();
    const mode = (req.body.mode || 'ranges').toLowerCase();

    if (mode === 'extract') {
      const indices = parseRangeSpec(req.body.ranges, pageCount);
      const out = await PDFDocument.create();
      await copyPages(src, out, indices);
      const bytes = await out.save();
      return sendPdf(res, bytes, 'extracted.pdf');
    }

    const parts = [];
    if (mode === 'ranges') {
      const tokens = (req.body.ranges || '').split(',').map(t => t.trim()).filter(Boolean);
      if (tokens.length === 0) throw httpError(400, 'ranges required');
      for (const token of tokens) {
        parts.push({ name: token.replace(/-/g, '_'), indices: parseRangeSpec(token, pageCount) });
      }
    } else if (mode === 'every') {
      const size = parseInt(req.body.size, 10);
      if (!size || size < 1) throw httpError(400, 'size must be a positive integer');
      for (let i = 0; i < pageCount; i += size) {
        const end = Math.min(i + size, pageCount);
        const indices = Array.from({ length: end - i }, (_, k) => i + k);
        parts.push({ name: `${i + 1}_${end}`, indices });
      }
    } else {
      throw httpError(400, `Unknown mode: ${mode}`);
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="split.zip"');
    const zip = archiver('zip', { zlib: { level: 6 } });
    zip.on('error', err => next(err));
    zip.pipe(res);
    for (const part of parts) {
      const out = await PDFDocument.create();
      await copyPages(src, out, part.indices);
      const bytes = await out.save();
      zip.append(Buffer.from(bytes), { name: `pages_${part.name}.pdf` });
    }
    await zip.finalize();
  } catch (e) { next(e); }
});

export default router;
