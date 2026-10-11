import { Router } from 'express';
import { rgb, PDFRawStream, PDFName } from 'pdf-lib';
import { upload, loadPdf, sendPdf, httpError } from '../lib/pdf-utils.js';
import { tokenize, redactContentStream, readPageContent } from '../lib/content-stream.js';

const router = Router();

/**
 * POST /api/redact — true redaction.
 *   file
 *   boxes   JSON array: [{ page, x, y, w, h }]   (top-left origin, points)
 *   color   "#000000" default black
 *   mode    "true" (default) | "visual"
 *
 * In "true" mode we parse each affected page's content stream, drop any
 * text-showing operators whose rendered origin falls inside a redaction box,
 * and then paint an opaque rectangle on top. The underlying text is gone
 * from the content stream, so copy-paste and text extraction cannot recover
 * it.
 *
 * In "visual" mode (the previous behaviour) we only paint the rectangle.
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    let boxes;
    try { boxes = JSON.parse(req.body.boxes || '[]'); } catch { throw httpError(400, 'boxes must be JSON'); }
    if (!Array.isArray(boxes) || boxes.length === 0) throw httpError(400, 'boxes required');
    const color = parseColor(req.body.color);
    const mode = req.body.mode === 'visual' ? 'visual' : 'true';

    const doc = await loadPdf(req.file.buffer);
    const pages = doc.getPages();

    // Group boxes by page for efficient content-stream editing.
    const byPage = new Map();
    for (const b of boxes) {
      if (!pages[b.page]) throw httpError(400, `Invalid page: ${b.page}`);
      const { height } = pages[b.page].getSize();
      const pdfBox = { x: b.x, y: height - b.y - b.h, w: b.w, h: b.h };  // bottom-left origin
      (byPage.get(b.page) || byPage.set(b.page, []).get(b.page)).push(pdfBox);
    }

    if (mode === 'true') {
      let scrubbed = 0;
      for (const [pageIdx, pageBoxes] of byPage) {
        const page = pages[pageIdx];
        const original = readPageContent(page, doc.context);
        if (!original.length) continue;
        const redacted = redactContentStream(original, pageBoxes);
        if (redacted.length < original.length) scrubbed += (original.length - redacted.length);
        const newStream = doc.context.flateStream(redacted);
        const newRef = doc.context.register(newStream);
        page.node.set(PDFName.of('Contents'), newRef);
      }
      res.setHeader('x-redact-bytes-scrubbed', String(scrubbed));
      res.setHeader('Access-Control-Expose-Headers', 'x-redact-bytes-scrubbed');
    }

    // Finally, draw opaque rectangles on top.
    for (const [pageIdx, pageBoxes] of byPage) {
      const page = pages[pageIdx];
      for (const b of pageBoxes) {
        page.drawRectangle({ x: b.x, y: b.y, width: b.w, height: b.h, color });
      }
    }

    const bytes = await doc.save();
    sendPdf(res, bytes, 'redacted.pdf');
  } catch (e) { next(e); }
});

function parseColor(c) {
  const m = typeof c === 'string' ? c.match(/^#?([0-9a-f]{6})$/i) : null;
  if (!m) return rgb(0, 0, 0);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255);
}

export default router;
