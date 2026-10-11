import { Router } from 'express';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upload, sendPdf, httpError } from '../lib/pdf-utils.js';

const router = Router();

/**
 * POST /api/pdf-to-pdfa — produce a PDF/A-2b archival PDF via Ghostscript.
 *   file
 *   level   "1b" | "2b" (default) | "3b"
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    const level = ['1b', '2b', '3b'].includes(String(req.body.level)) ? String(req.body.level) : '2b';
    const dir = await mkdtemp(join(tmpdir(), 'pdftk-'));
    const inPath = join(dir, 'in.pdf');
    const outPath = join(dir, 'out.pdf');
    try {
      await writeFile(inPath, req.file.buffer);
      await new Promise((resolve, reject) => {
        const args = [
          '-dPDFA=' + level[0],
          '-dBATCH',
          '-dNOPAUSE',
          '-sProcessColorModel=DeviceRGB',
          '-sDEVICE=pdfwrite',
          '-dPDFACompatibilityPolicy=1',
          `-sOutputFile=${outPath}`,
          inPath,
        ];
        const child = spawn('gs', args);
        const err = [];
        child.stderr.on('data', d => err.push(d));
        child.on('error', e => reject(e.code === 'ENOENT'
          ? httpError(500, 'Ghostscript (gs) is not installed on this server')
          : e));
        child.on('close', code => {
          if (code === 0) return resolve();
          const msg = Buffer.concat(err).toString().trim() || `gs exited ${code}`;
          reject(httpError(400, msg.split('\n').slice(-3).join(' ')));
        });
      });
      const bytes = await readFile(outPath);
      sendPdf(res, bytes, `pdfa_${level}.pdf`);
    } finally {
      rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  } catch (e) { next(e); }
});

export default router;
