import { Router } from 'express';
import { upload, loadPdf, sendPdf, httpError } from '../lib/pdf-utils.js';

const router = Router();

/**
 * POST /api/forms/create — add form fields to an existing PDF.
 *
 *   file     the PDF
 *   fields   JSON array of:
 *            { kind: 'text',     page, x, y, w, h, name, defaultValue? }
 *            { kind: 'checkbox', page, x, y, w, h, name, checked? }
 *            { kind: 'radio',    page, x, y, w, h, name, options: [...], selected? }
 *            { kind: 'dropdown', page, x, y, w, h, name, options: [...], selected? }
 *
 * Coordinates: top-left origin from the browser, we convert to pdf-lib.
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    let fields;
    try { fields = JSON.parse(req.body.fields || '[]'); } catch { throw httpError(400, 'fields must be JSON'); }
    if (!Array.isArray(fields) || fields.length === 0) throw httpError(400, 'fields array required');

    const doc = await loadPdf(req.file.buffer);
    const form = doc.getForm();
    const pages = doc.getPages();

    // Track unique names + append suffix if colliding.
    const used = new Set();

    for (const f of fields) {
      const page = pages[f.page];
      if (!page) throw httpError(400, `Invalid page: ${f.page}`);
      const { height } = page.getSize();
      const rect = { x: f.x, y: height - f.y - f.h, width: f.w, height: f.h };
      let name = String(f.name || `field_${used.size + 1}`).replace(/[^\w.-]/g, '_');
      while (used.has(name)) name = `${name}_`;
      used.add(name);

      try {
        if (f.kind === 'text') {
          const field = form.createTextField(name);
          if (f.defaultValue) field.setText(String(f.defaultValue));
          field.addToPage(page, rect);
        } else if (f.kind === 'checkbox') {
          const field = form.createCheckBox(name);
          field.addToPage(page, rect);
          if (f.checked) field.check();
        } else if (f.kind === 'radio') {
          const opts = (f.options || []).map(String);
          if (opts.length === 0) continue;
          const field = form.createRadioGroup(name);
          // Vertical stack of options within the rect.
          const perH = rect.height / opts.length;
          opts.forEach((opt, i) => {
            field.addOptionToPage(opt, page, {
              x: rect.x,
              y: rect.y + rect.height - (i + 1) * perH,
              width: perH * 0.7,
              height: perH * 0.7,
            });
          });
          if (f.selected && opts.includes(String(f.selected))) field.select(String(f.selected));
        } else if (f.kind === 'dropdown') {
          const opts = (f.options || []).map(String);
          const field = form.createDropdown(name);
          field.setOptions(opts);
          field.addToPage(page, rect);
          if (f.selected && opts.includes(String(f.selected))) field.select(String(f.selected));
        }
      } catch (e) {
        // Skip malformed single fields rather than failing the whole request.
      }
    }

    const bytes = await doc.save();
    sendPdf(res, bytes, 'with-fields.pdf');
  } catch (e) { next(e); }
});

export default router;
