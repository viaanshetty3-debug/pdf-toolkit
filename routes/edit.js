import { Router } from 'express';
import multer from 'multer';
import { StandardFonts, rgb } from 'pdf-lib';
import { loadPdf, sendPdf, httpError } from '../lib/pdf-utils.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024, files: 50 },
});

/**
 * POST /api/edit — flatten a list of overlay annotations onto the PDF.
 * Form:
 *   file
 *   ops       JSON array of operations:
 *             { kind: "text", page, x, y, text, size?, color? }
 *             { kind: "rect", page, x, y, w, h, color?, opacity?, fill?: true, borderWidth? }
 *             { kind: "image", page, x, y, w, h, imageIndex }   // uses images[imageIndex]
 *   images    0..N image files; indexed by `imageIndex` in ops
 *
 * Coordinates: top-left origin in the browser, we convert to pdf-lib's bottom-left.
 * Page is 0-indexed.
 */
router.post('/', upload.fields([{ name: 'file', maxCount: 1 }, { name: 'images', maxCount: 50 }]),
  async (req, res, next) => {
  try {
    const pdfFile = req.files?.file?.[0];
    if (!pdfFile) throw httpError(400, 'No PDF file uploaded');
    let ops;
    try { ops = JSON.parse(req.body.ops || '[]'); } catch { throw httpError(400, 'ops must be JSON'); }
    if (!Array.isArray(ops)) throw httpError(400, 'ops must be an array');

    const doc = await loadPdf(pdfFile.buffer);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    const imageFiles = req.files?.images || [];
    const embeddedImages = await Promise.all(imageFiles.map(async f => {
      const bytes = new Uint8Array(f.buffer);
      return f.mimetype === 'image/png'
        ? await doc.embedPng(bytes)
        : await doc.embedJpg(bytes);
    }));

    for (const op of ops) {
      const page = pages[op.page];
      if (!page) throw httpError(400, `Invalid page: ${op.page}`);
      const { height } = page.getSize();
      const color = parseColor(op.color);

      if (op.kind === 'text') {
        const size = Number.isFinite(op.size) ? op.size : 14;
        page.drawText(String(op.text ?? ''), {
          x: op.x,
          y: height - op.y - size,
          size,
          font,
          color,
        });
      } else if (op.kind === 'rect') {
        const w = op.w, h = op.h;
        page.drawRectangle({
          x: op.x,
          y: height - op.y - h,
          width: w,
          height: h,
          color: op.fill ? color : undefined,
          borderColor: op.fill ? undefined : color,
          borderWidth: op.borderWidth ?? 1,
          opacity: op.opacity ?? 1,
        });
      } else if (op.kind === 'image') {
        const img = embeddedImages[op.imageIndex];
        if (!img) throw httpError(400, `Missing image at index ${op.imageIndex}`);
        page.drawImage(img, {
          x: op.x,
          y: height - op.y - op.h,
          width: op.w,
          height: op.h,
        });
      } else {
        throw httpError(400, `Unknown op kind: ${op.kind}`);
      }
    }
    const bytes = await doc.save();
    sendPdf(res, bytes, 'edited.pdf');
  } catch (e) { next(e); }
});

function parseColor(c) {
  if (!c) return rgb(0, 0, 0);
  const m = typeof c === 'string' ? c.match(/^#?([0-9a-f]{6})$/i) : null;
  if (m) {
    const n = parseInt(m[1], 16);
    return rgb(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255);
  }
  return rgb(0, 0, 0);
}

export default router;
