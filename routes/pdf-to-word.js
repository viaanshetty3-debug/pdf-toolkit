import { Router } from 'express';
import { Document, Packer, Paragraph, TextRun, PageBreak, HeadingLevel, ImageRun, AlignmentType } from 'docx';
import { upload, httpError } from '../lib/pdf-utils.js';
import { extractRichStructure } from '../lib/pdf-structure.js';

const router = Router();

const HEADING_LEVELS = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

/**
 * POST /api/pdf-to-word — layout-aware extraction.
 *
 * Classifies each line as heading (by font-size ratio) or paragraph, merges
 * paragraph runs, and embeds any JPEG image XObjects from each page. Output
 * is a reasonably faithful .docx — not pixel-perfect, but preserves document
 * structure rather than being a wall of text.
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    const { pages } = await extractRichStructure(req.file.buffer);

    const children = [];
    pages.forEach((page, pi) => {
      if (pi > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
      for (const b of page.blocks) {
        if (b.kind === 'heading') {
          children.push(new Paragraph({
            heading: HEADING_LEVELS[b.level] || HEADING_LEVELS[3],
            children: [new TextRun({ text: b.text, bold: true, size: Math.round(b.fontSize * 2) })],
          }));
        } else {
          children.push(new Paragraph({
            children: [new TextRun({ text: b.text, size: Math.round(b.fontSize * 2) })],
            spacing: { after: 120 },
          }));
        }
      }
      // Embed images at the end of each page block.
      for (const im of page.images) {
        try {
          children.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new ImageRun({
              data: im.bytes,
              transformation: { width: Math.min(500, im.w), height: Math.min(500, im.w) * (im.h / Math.max(1, im.w)) },
            })],
            spacing: { before: 120, after: 120 },
          }));
        } catch { /* unsupported image format — skip */ }
      }
    });

    const doc = new Document({ sections: [{ children }] });
    const buf = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="converted.docx"');
    res.setHeader('Content-Length', buf.length);
    res.end(buf);
  } catch (e) { next(e); }
});

export default router;
