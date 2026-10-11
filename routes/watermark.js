import { Router } from 'express';
import multer from 'multer';
import { StandardFonts, rgb, degrees } from 'pdf-lib';
import { loadPdf, sendPdf, httpError } from '../lib/pdf-utils.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024, files: 2 },
});

/**
 * POST /api/watermark
 *   file         the PDF
 *   image        optional image file (PNG or JPEG) — if present, image watermark
 *   text         optional text — used when image not provided
 *   opacity      0..1 (default 0.3)
 *   rotation     degrees (default -45 for text, 0 for image)
 *   position     center | tile  (default center)
 *   scale        for image: 0..1 of page width (default 0.5)
 *   fontSize     for text (default 72)
 */
router.post('/', upload.fields([{ name: 'file', maxCount: 1 }, { name: 'image', maxCount: 1 }]),
  async (req, res, next) => {
  try {
    const pdfFile = req.files?.file?.[0];
    const imgFile = req.files?.image?.[0];
    if (!pdfFile) throw httpError(400, 'No PDF file uploaded');
    const text = (req.body.text || '').trim();
    if (!imgFile && !text) throw httpError(400, 'Provide either text or an image');
    const opacity = clamp01(parseFloat(req.body.opacity || '0.3'));
    const rotation = parseFloat(req.body.rotation || (imgFile ? '0' : '-45'));
    const position = req.body.position || 'center';
    const scale = clamp01(parseFloat(req.body.scale || '0.5')) || 0.5;
    const fontSize = parseFloat(req.body.fontSize || '72');

    const doc = await loadPdf(pdfFile.buffer);
    let embeddedImage = null;
    if (imgFile) {
      const bytes = new Uint8Array(imgFile.buffer);
      embeddedImage = imgFile.mimetype === 'image/png'
        ? await doc.embedPng(bytes)
        : await doc.embedJpg(bytes);
    }
    const font = text ? await doc.embedFont(StandardFonts.HelveticaBold) : null;

    for (const page of doc.getPages()) {
      const { width, height } = page.getSize();
      if (embeddedImage) {
        const w = width * scale;
        const h = w * (embeddedImage.height / embeddedImage.width);
        placeMark(page, position, width, height, w, h, (cx, cy) => {
          page.drawImage(embeddedImage, {
            x: cx - w / 2, y: cy - h / 2, width: w, height: h,
            opacity, rotate: degrees(rotation),
          });
        });
      } else {
        const textW = font.widthOfTextAtSize(text, fontSize);
        placeMark(page, position, width, height, textW, fontSize, (cx, cy) => {
          page.drawText(text, {
            x: cx - textW / 2, y: cy - fontSize / 2, size: fontSize, font,
            color: rgb(0.4, 0.4, 0.4), opacity, rotate: degrees(rotation),
          });
        });
      }
    }
    const bytes = await doc.save();
    sendPdf(res, bytes, 'watermarked.pdf');
  } catch (e) { next(e); }
});

function clamp01(n) { return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0.3)); }

function placeMark(page, position, width, height, w, h, draw) {
  if (position === 'tile') {
    const stepX = w * 1.6, stepY = h * 2.5;
    for (let y = stepY / 2; y < height; y += stepY) {
      for (let x = stepX / 2; x < width; x += stepX) draw(x, y);
    }
  } else {
    draw(width / 2, height / 2);
  }
}

export default router;
