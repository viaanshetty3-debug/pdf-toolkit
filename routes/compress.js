import { Router } from 'express';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { upload, loadPdf, sendPdf, httpError } from '../lib/pdf-utils.js';

const router = Router();

// Ghostscript PDFSETTINGS presets. Each maps to a tested set of image
// downsampling + JPEG recompression rules. From loosest to tightest:
//   /prepress  high quality (default)
//   /printer   high quality (300dpi), balanced
//   /ebook     medium quality (150dpi) — our "medium"
//   /screen    low quality (72dpi), aggressive — our "high"
const GS_PRESET = {
  low: '/printer',    // very light touch — preserves quality
  medium: '/ebook',
  high: '/screen',
};

/**
 * POST /api/compress — three-tier compression via Ghostscript.
 *
 * Falls back to a pdf-lib structural pass when Ghostscript is unavailable
 * so this tool keeps working on bare-bones installs.
 *
 *   file   the PDF
 *   level  low | medium | high  (default medium)
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    const level = (req.body.level || 'medium').toLowerCase();
    if (!(level in GS_PRESET)) throw httpError(400, `Invalid level: ${level}`);
    const originalSize = req.file.buffer.length;

    let bytes;
    let engine = 'ghostscript';
    try {
      bytes = await compressWithGs(req.file.buffer, GS_PRESET[level]);
    } catch (e) {
      // If gs is missing or crashes, degrade gracefully.
      if (e.code === 'ENOENT' || e.gs) {
        engine = 'pdf-lib';
        bytes = await compressWithPdfLib(req.file.buffer);
      } else { throw e; }
    }

    // Only serve the compressed file if it's actually smaller. If gs made
    // the file larger (can happen on already-tight PDFs), return the input.
    if (bytes.length >= originalSize) {
      bytes = req.file.buffer;
      engine += '+passthrough';
    }

    res.setHeader('x-original-size', String(originalSize));
    res.setHeader('x-compressed-size', String(bytes.length));
    res.setHeader('x-compress-engine', engine);
    res.setHeader('Access-Control-Expose-Headers', 'x-original-size, x-compressed-size, x-compress-engine');
    sendPdf(res, bytes, 'compressed.pdf');
  } catch (e) { next(e); }
});

async function compressWithGs(buffer, preset) {
  const dir = await mkdtemp(join(tmpdir(), 'pdftk-'));
  const inPath = join(dir, 'in.pdf');
  const outPath = join(dir, 'out.pdf');
  try {
    await writeFile(inPath, buffer);
    await new Promise((resolve, reject) => {
      const child = spawn('gs', [
        '-sDEVICE=pdfwrite',
        '-dBATCH', '-dNOPAUSE', '-dQUIET',
        '-dCompatibilityLevel=1.5',
        `-dPDFSETTINGS=${preset}`,
        '-dDetectDuplicateImages=true',
        '-dCompressFonts=true',
        '-dSubsetFonts=true',
        `-sOutputFile=${outPath}`,
        inPath,
      ]);
      const err = [];
      child.stderr.on('data', d => err.push(d));
      child.on('error', e => {
        if (e.code === 'ENOENT') { e.gs = true; reject(e); }
        else reject(e);
      });
      child.on('close', code => {
        if (code === 0) resolve();
        else {
          const msg = Buffer.concat(err).toString().trim() || `gs exited ${code}`;
          const e = new Error(msg); e.gs = true; reject(e);
        }
      });
    });
    return await readFile(outPath);
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function compressWithPdfLib(buffer) {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  return Buffer.from(await doc.save({ useObjectStreams: true, addDefaultPage: false }));
}

export default router;
