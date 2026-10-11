import { Router } from 'express';
import multer from 'multer';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { Layout } from '../lib/pdf-layout.js';
import { sendPdf, httpError } from '../lib/pdf-utils.js';
import { convertToPdf as loConvert } from '../lib/libreoffice.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024, files: 1 },
});

/**
 * POST /api/excel-to-pdf — convert .xlsx/.xls/.csv to PDF.
 * One section per sheet; data rendered as a bordered table. Pictures found in
 * the workbook's xl/media/ folder are appended at the end as a plates section.
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    try {
      const ext = /\.xls$/i.test(req.file.originalname) ? 'xls'
                : /\.csv$/i.test(req.file.originalname) ? 'csv' : 'xlsx';
      const bytes = await loConvert(req.file.buffer, ext);
      res.setHeader('x-engine', 'libreoffice');
      res.setHeader('Access-Control-Expose-Headers', 'x-engine');
      return sendPdf(res, bytes, 'spreadsheet.pdf');
    } catch (e) {
      if (!e.noLo) throw e;
    }
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const layout = new Layout();
    await layout.init();
    let first = true;
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });
      if (!first) layout.newPage();
      first = false;
      layout.heading(name, 2);
      if (rows.length === 0) {
        layout.paragraph([{ text: '(empty sheet)', italic: true }]);
        continue;
      }
      const header = rows[0].map(v => String(v));
      const body = rows.slice(1).map(r => r.map(v => String(v)));
      layout.table(body, { header });
    }

    // Extract embedded images from the xlsx zip and append them.
    try {
      const zip = await JSZip.loadAsync(req.file.buffer);
      const mediaKeys = Object.keys(zip.files).filter(n => /^xl\/media\/.+\.(png|jpe?g)$/i.test(n));
      if (mediaKeys.length) {
        layout.newPage();
        layout.heading('Embedded Images', 2);
        for (const key of mediaKeys) {
          const bytes = await zip.file(key).async('nodebuffer');
          const kind = /\.png$/i.test(key) ? 'png' : 'jpg';
          try { await layout.image(bytes, kind, { maxWidthFraction: 0.9, caption: key.split('/').pop() }); }
          catch { /* ignore */ }
        }
      }
    } catch { /* not a zip (e.g. .csv) — skip */ }

    const bytes = await layout.save();
    sendPdf(res, bytes, 'spreadsheet.pdf');
  } catch (e) { next(e); }
});

export default router;
