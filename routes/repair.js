import { Router } from 'express';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upload, loadPdf, sendPdf, httpError } from '../lib/pdf-utils.js';
import { PDFDocument } from 'pdf-lib';

const router = Router();

/**
 * POST /api/repair — attempt to repair a damaged PDF.
 *
 * Strategy:
 *   1. Try qpdf's cross-reference rebuild (`--replace-input` style, writing a
 *      new file). qpdf handles missing trailers, broken xref tables, etc.
 *   2. On failure, fall back to a pdf-lib round-trip, which recovers from
 *      many smaller inconsistencies but not from catastrophic corruption.
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    let bytes;
    const summary = { strategy: null, warnings: 0 };
    try {
      const r = await repairWithQpdf(req.file.buffer);
      bytes = r.bytes;
      summary.strategy = 'qpdf';
      summary.warnings = r.warnings;
    } catch (qpdfErr) {
      try {
        bytes = await repairWithPdfLib(req.file.buffer);
        summary.strategy = 'pdf-lib';
      } catch (plErr) {
        throw httpError(400, `Unable to repair: ${qpdfErr.message || plErr.message}`);
      }
    }
    res.setHeader('x-repair-strategy', summary.strategy);
    res.setHeader('x-repair-warnings', String(summary.warnings));
    res.setHeader('Access-Control-Expose-Headers', 'x-repair-strategy, x-repair-warnings');
    sendPdf(res, bytes, 'repaired.pdf');
  } catch (e) { next(e); }
});

async function repairWithQpdf(buffer) {
  const dir = await mkdtemp(join(tmpdir(), 'pdftk-'));
  const inPath = join(dir, 'in.pdf');
  const outPath = join(dir, 'out.pdf');
  try {
    await writeFile(inPath, buffer);
    const { warnings } = await new Promise((resolve, reject) => {
      // Deliberately ask qpdf to work hard: linearize + rebuild + object streams.
      const child = spawn('qpdf', ['--linearize', '--object-streams=generate', inPath, outPath]);
      const err = [];
      child.stderr.on('data', d => err.push(d));
      child.on('error', e => reject(e));
      child.on('close', code => {
        if (code === 0 || code === 3) {
          const text = Buffer.concat(err).toString();
          const warnings = (text.match(/WARNING/gi) || []).length;
          resolve({ warnings });
        } else {
          reject(new Error(Buffer.concat(err).toString().trim() || `qpdf exited ${code}`));
        }
      });
    });
    const bytes = await readFile(outPath);
    return { bytes, warnings };
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function repairWithPdfLib(buffer) {
  const doc = await PDFDocument.load(buffer, {
    ignoreEncryption: true,
    throwOnInvalidObject: false,
    updateMetadata: false,
  });
  return doc.save({ useObjectStreams: true });
}

export default router;
