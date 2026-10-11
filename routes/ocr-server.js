import { Router } from 'express';
import { PDFName, PDFRawStream, StandardFonts, rgb } from 'pdf-lib';
import { upload, loadPdf, sendPdf, httpError } from '../lib/pdf-utils.js';
import { recognize as tessRecognize, LANGS } from '../lib/tesseract-native.js';
import { recognize as geminiRecognize, isAvailable as geminiAvailable } from '../lib/gemini-ocr.js';
import { rasterizePages } from '../lib/pdf-rasterize.js';

const router = Router();

/**
 * POST /api/ocr-server
 *
 *   file     the PDF
 *   lang     Tesseract lang code(s) (eng+fra). Default eng. Only used by
 *            tesseract engine.
 *   engine   tesseract | gemini | auto  (default auto)
 *            - auto: Gemini when API key present + handwriting/non-latin
 *              hint set, else Tesseract
 *            - gemini: always Gemini (closes the handwriting + rare-script gap)
 *            - tesseract: always Tesseract (offline-only path)
 *   hint     handwriting | mixed_scripts | printed  (passed to Gemini)
 *   dpi      rasterization DPI for Gemini (default 200)
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    const requested = (req.body.engine || 'auto').toLowerCase();
    const hint = ['handwriting', 'mixed_scripts', 'printed'].includes(req.body.hint) ? req.body.hint : undefined;
    const lang = sanitiseLang(req.body.lang || 'eng');
    const dpi = Math.max(72, Math.min(400, parseInt(req.body.dpi || '200', 10)));

    const useGemini = requested === 'gemini'
      || (requested === 'auto' && geminiAvailable() && (hint === 'handwriting' || hint === 'mixed_scripts'));

    if (requested === 'gemini' && !geminiAvailable()) {
      throw httpError(503, 'Gemini OCR requires GEMINI_API_KEY to be set');
    }

    const doc = await loadPdf(req.file.buffer);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    let totalWords = 0;
    const perPage = [];
    const engineUsed = useGemini ? 'gemini' : 'tesseract';

    if (useGemini) {
      // Rasterize ALL pages at the chosen DPI, then OCR each via Gemini.
      const rasters = await rasterizePages(req.file.buffer, { dpi });
      for (const r of rasters) {
        const page = pages[r.page];
        if (!page) continue;
        try {
          const result = await geminiRecognize(r.bytes, 'image/jpeg', { width: r.width, height: r.height, hint });
          embedWordLayer(page, font, result);
          totalWords += result.words.length;
          perPage.push(result.words.length);
        } catch (e) {
          console.error('[ocr/gemini]', r.page, e.message);
          perPage.push(0);
        }
      }
    } else {
      // Tesseract path — pulls Image XObjects for scanned PDFs. For complex
      // page content, rasterize first then run tesseract on the raster.
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const images = extractImageXObjects(page, doc);
        let pageWords = 0;
        const sources = images.map(im => im.jpeg).filter(Boolean);
        if (!sources.length) {
          // Fall back to rasterizing just this page.
          try {
            const raster = await rasterizePages(req.file.buffer, { dpi, pages: [i + 1] });
            if (raster[0]) sources.push(raster[0].bytes);
          } catch { /* skip */ }
        }
        for (const src of sources) {
          try {
            const result = await tessRecognize(src, lang);
            embedWordLayer(page, font, result);
            pageWords += result.words.length;
          } catch (e) { /* skip single-image failures */ }
        }
        totalWords += pageWords;
        perPage.push(pageWords);
      }
    }

    res.setHeader('x-ocr-total-words', String(totalWords));
    res.setHeader('x-ocr-per-page', perPage.join(','));
    res.setHeader('x-ocr-engine', engineUsed);
    if (!useGemini) res.setHeader('x-ocr-lang', lang);
    res.setHeader('Access-Control-Expose-Headers', 'x-ocr-total-words, x-ocr-per-page, x-ocr-engine, x-ocr-lang');
    const bytes = await doc.save();
    sendPdf(res, bytes, 'ocr.pdf');
  } catch (e) { next(e); }
});

/**
 * Embed invisible text at the recognized word positions, scaled to the PDF
 * page's user-space coordinates.
 */
function embedWordLayer(page, font, { words, width, height }) {
  const { width: pw, height: ph } = page.getSize();
  const sx = pw / Math.max(1, width);
  const sy = ph / Math.max(1, height);
  for (const w of words) {
    if (!w.text?.trim()) continue;
    const size = Math.max(4, w.h * sy * 0.9);
    const x = w.x * sx;
    const y = ph - (w.y + w.h) * sy;
    page.drawText(w.text, { x, y, size, font, color: rgb(1, 1, 1), opacity: 0 });
  }
}

router.get('/langs', (req, res) => {
  res.json({ languages: LANGS, geminiAvailable: geminiAvailable() });
});

function sanitiseLang(raw) {
  const cleaned = String(raw).replace(/[^a-z_+]/gi, '').slice(0, 48);
  const parts = cleaned.split('+').filter(Boolean);
  for (const p of parts) if (!LANGS.includes(p)) throw httpError(400, `Unsupported language: ${p}`);
  return parts.join('+') || 'eng';
}

function extractImageXObjects(page, doc) {
  const resources = page.node.Resources?.();
  if (!resources) return [];
  const xObjectDict = resources.get(PDFName.of('XObject'));
  if (!xObjectDict) return [];
  const results = [];
  for (const key of xObjectDict.keys()) {
    const ref = xObjectDict.get(key);
    const obj = doc.context.lookup(ref);
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    const subtype = dict.get(PDFName.of('Subtype'));
    if (!subtype || subtype.toString() !== '/Image') continue;
    const filter = dict.get(PDFName.of('Filter'));
    const filterName = filter ? filter.toString() : '';
    const width = dict.get(PDFName.of('Width'))?.asNumber?.() ?? 0;
    const height = dict.get(PDFName.of('Height'))?.asNumber?.() ?? 0;
    const bytes = Buffer.from(obj.getContents());
    results.push({ width, height, jpeg: filterName.includes('DCTDecode') ? bytes : null });
  }
  return results;
}

export default router;
