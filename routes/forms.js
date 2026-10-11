import { Router } from 'express';
import { upload, loadPdf, sendPdf, httpError } from '../lib/pdf-utils.js';

const router = Router();

/**
 * POST /api/forms/inspect — list the form fields in a PDF (name, type, value, options).
 */
router.post('/inspect', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    const doc = await loadPdf(req.file.buffer);
    const form = doc.getForm();
    const fields = form.getFields().map(f => {
      const type = f.constructor.name;
      const base = { name: f.getName(), type };
      try {
        if (type === 'PDFTextField') return { ...base, value: f.getText() || '' };
        if (type === 'PDFCheckBox') return { ...base, value: f.isChecked() };
        if (type === 'PDFRadioGroup') return { ...base, value: f.getSelected() || null, options: f.getOptions() };
        if (type === 'PDFDropdown') return { ...base, value: f.getSelected()[0] || null, options: f.getOptions() };
        if (type === 'PDFOptionList') return { ...base, value: f.getSelected(), options: f.getOptions() };
      } catch { /* fall through */ }
      return base;
    });
    res.json({ pageCount: doc.getPageCount(), fields });
  } catch (e) { next(e); }
});

/**
 * POST /api/forms/fill
 *   file
 *   values   JSON object: { fieldName: value, ... }
 *   flatten  "true" | "false" (default true)
 */
router.post('/fill', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    let values;
    try { values = JSON.parse(req.body.values || '{}'); } catch { throw httpError(400, 'values must be JSON'); }
    const flatten = req.body.flatten !== 'false';
    const doc = await loadPdf(req.file.buffer);
    const form = doc.getForm();

    for (const [name, value] of Object.entries(values)) {
      try {
        const field = form.getField(name);
        const type = field.constructor.name;
        if (type === 'PDFTextField') field.setText(String(value ?? ''));
        else if (type === 'PDFCheckBox') value ? field.check() : field.uncheck();
        else if (type === 'PDFRadioGroup') field.select(String(value));
        else if (type === 'PDFDropdown') field.select(String(value));
        else if (type === 'PDFOptionList') {
          const arr = Array.isArray(value) ? value : [value];
          field.select(arr.map(String));
        }
      } catch (e) {
        // Skip unknown/invalid fields rather than failing the whole fill.
      }
    }

    if (flatten) form.flatten();
    const bytes = await doc.save();
    sendPdf(res, bytes, 'filled.pdf');
  } catch (e) { next(e); }
});

export default router;
