import { Router } from 'express';
import PptxGenJS from 'pptxgenjs';
import { upload, httpError } from '../lib/pdf-utils.js';
import { extractRichStructure } from '../lib/pdf-structure.js';

const router = Router();

/**
 * POST /api/pdf-to-ppt — positioned text + images per slide.
 *
 * Maps each PDF page to a 16:9 slide. Text blocks are placed proportionally
 * from the source coordinates; the largest text on the page becomes the slide
 * title. JPEG XObjects are embedded centred below the text.
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    const { pages } = await extractRichStructure(req.file.buffer);

    // pptxgenjs uses inches; standard LAYOUT_WIDE = 13.333 × 7.5 in.
    const SLIDE_W = 13.333, SLIDE_H = 7.5;
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';

    pages.forEach((page) => {
      const slide = pptx.addSlide();
      // Find the biggest heading-like block for the title.
      const headings = page.blocks.filter(b => b.kind === 'heading');
      const title = headings[0]?.text || page.blocks[0]?.text || '';
      const bodyBlocks = page.blocks.filter(b => b !== headings[0]);

      // Place title at top.
      if (title) {
        slide.addText(title, {
          x: 0.5, y: 0.3, w: SLIDE_W - 1, h: 0.9,
          fontSize: 24, bold: true, fontFace: 'Calibri', color: '2e74b5',
        });
      }

      // Place body blocks proportionally.
      let cursorY = 1.3;
      for (const b of bodyBlocks) {
        const yFrac = (page.height - b.y) / page.height;
        const target = Math.max(cursorY, 1.3 + yFrac * (SLIDE_H - 2));
        const fontPt = Math.min(20, Math.max(10, b.fontSize));
        slide.addText(b.text, {
          x: 0.6, y: target, w: SLIDE_W - 1.2, h: 0.5,
          fontSize: fontPt,
          bold: b.kind === 'heading',
          fontFace: 'Calibri',
          valign: 'top',
        });
        cursorY = target + 0.5;
      }

      // Place images below the text or at bottom-right.
      let imgX = SLIDE_W / 2, imgY = Math.min(SLIDE_H - 2, cursorY + 0.2);
      for (const im of page.images) {
        const aspect = im.h / Math.max(1, im.w);
        const w = Math.min(5, SLIDE_W - imgX - 0.3);
        if (w < 1) break;
        const h = w * aspect;
        try {
          slide.addImage({
            data: `data:image/jpeg;base64,${im.bytes.toString('base64')}`,
            x: imgX, y: imgY, w, h,
          });
          imgY += h + 0.2;
          if (imgY > SLIDE_H - 0.5) break;
        } catch { /* skip bad images */ }
      }
    });

    const buf = await pptx.write({ outputType: 'nodebuffer' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', 'attachment; filename="converted.pptx"');
    res.setHeader('Content-Length', buf.length);
    res.end(buf);
  } catch (e) { next(e); }
});

export default router;
