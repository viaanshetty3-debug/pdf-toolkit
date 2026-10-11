import { Router } from 'express';
import multer from 'multer';
import JSZip from 'jszip';
import { Layout } from '../lib/pdf-layout.js';
import { sendPdf, httpError } from '../lib/pdf-utils.js';
import { convertToPdf as loConvert } from '../lib/libreoffice.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024, files: 1 },
});

/**
 * POST /api/ppt-to-pdf — convert .pptx to PDF.
 *
 * .pptx is a zip of XML files; slides live at ppt/slides/slideN.xml. We
 * extract the text runs from each slide and render one PDF page per slide.
 * Images and complex layouts are not reproduced.
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    try {
      const bytes = await loConvert(req.file.buffer, 'pptx');
      res.setHeader('x-engine', 'libreoffice');
      res.setHeader('Access-Control-Expose-Headers', 'x-engine');
      return sendPdf(res, bytes, 'slides.pdf');
    } catch (e) {
      if (!e.noLo) throw e;
    }
    const zip = await JSZip.loadAsync(req.file.buffer);
    const slideFiles = Object.keys(zip.files)
      .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => parseInt(a.match(/slide(\d+)/)[1]) - parseInt(b.match(/slide(\d+)/)[1]));

    if (slideFiles.length === 0) throw httpError(400, 'No slides found in presentation');

    const layout = new Layout();
    await layout.init();
    let first = true;
    for (let i = 0; i < slideFiles.length; i++) {
      const slidePath = slideFiles[i];
      const xml = await zip.file(slidePath).async('text');
      const paragraphs = extractParagraphs(xml);
      if (!first) layout.newPage();
      first = false;
      layout.heading(`Slide ${i + 1}`, 3);
      for (const para of paragraphs) {
        if (para.text.trim()) {
          layout.paragraph([{ text: para.text, size: para.size, bold: para.bold }]);
        }
      }
      // Images referenced by the slide (via its .rels file).
      const images = await slideImages(zip, slidePath);
      for (const im of images) {
        try { await layout.image(im.bytes, im.kind, { maxWidthFraction: 0.8 }); }
        catch { /* skip unsupported image formats */ }
      }
    }
    const bytes = await layout.save();
    sendPdf(res, bytes, 'slides.pdf');
  } catch (e) { next(e); }
});

/**
 * Pull <a:p>...</a:p> paragraphs out of a slide XML. Within each paragraph
 * concatenate every <a:t>...</a:t> text run. Honour the first <a:rPr sz="..">
 * attribute as a hint for font size (OOXML sizes are in hundredths of a point).
 */
function extractParagraphs(xml) {
  const paras = [];
  const paraRe = /<a:p[\s>][\s\S]*?<\/a:p>/g;
  let m;
  while ((m = paraRe.exec(xml)) !== null) {
    const chunk = m[0];
    const textRe = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
    const parts = [];
    let t;
    while ((t = textRe.exec(chunk)) !== null) parts.push(decodeXml(t[1]));
    const sizeMatch = chunk.match(/<a:rPr\b[^>]*\bsz="(\d+)"/);
    const boldMatch = chunk.match(/<a:rPr\b[^>]*\bb="1"/);
    paras.push({
      text: parts.join(''),
      size: sizeMatch ? Math.max(10, Math.min(28, parseInt(sizeMatch[1], 10) / 100)) : 12,
      bold: !!boldMatch,
    });
  }
  return paras;
}

function decodeXml(s) {
  return s.replace(/&(amp|lt|gt|quot|apos|#(\d+));/g, (_, e, d) => {
    if (d) return String.fromCharCode(parseInt(d, 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e];
  });
}

/**
 * Return the image buffers referenced by this slide, via its .rels file.
 * .rels paths look like "../media/image1.png" (relative to ppt/slides/_rels/).
 */
async function slideImages(zip, slidePath) {
  const relsPath = slidePath.replace(/^ppt\/slides\//, 'ppt/slides/_rels/') + '.rels';
  const relsFile = zip.file(relsPath);
  if (!relsFile) return [];
  const relsXml = await relsFile.async('text');
  // Grab each <Relationship .../> whose Type ends in "image". The attribute
  // order isn't fixed, and attribute VALUES contain '/' (URL schemes), so we
  // consume anything up to the terminating '>'.
  const relRe = /<Relationship\b([^>]*)>/g;
  const out = [];
  let rm;
  while ((rm = relRe.exec(relsXml)) !== null) {
    const attrs = rm[1];
    if (!/Type="[^"]*\/image"/i.test(attrs)) continue;
    const t = attrs.match(/Target="([^"]+)"/);
    if (!t) continue;
    let target = t[1];
    if (target.startsWith('../')) target = 'ppt/' + target.slice(3);
    else if (!target.startsWith('ppt/')) target = 'ppt/slides/' + target;
    const file = zip.file(target);
    if (!file) continue;
    const kind = /\.png$/i.test(target) ? 'png' : /\.(jpe?g)$/i.test(target) ? 'jpg' : null;
    if (!kind) continue;  // skip wmf, emf, gif
    out.push({ bytes: await file.async('nodebuffer'), kind });
  }
  // Fallback: if no rels referenced images (some generators omit it) just
  // use anything in ppt/media/ for the first slide.
  return out;
}

export default router;
