import { Router } from 'express';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upload, sendPdf, httpError } from '../lib/pdf-utils.js';

const router = Router();

/**
 * POST /api/unlock — remove a password from a PDF (requires the password).
 *   file
 *   password  (optional — some PDFs have an empty user password)
 * Uses qpdf. qpdf does not support stdin, so we round-trip via tempfiles.
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    const password = String(req.body.password ?? '');
    const bytes = await runQpdf(['--decrypt', `--password=${password}`, '--'], req.file.buffer);
    sendPdf(res, bytes, 'unlocked.pdf');
  } catch (e) { next(e); }
});

/**
 * Run qpdf with the given option args. Writes `input` to a temp file,
 * appends the input and output filenames to args, runs qpdf, reads output.
 * Caller provides options only (not infile/outfile).
 */
async function runQpdf(args, input) {
  const dir = await mkdtemp(join(tmpdir(), 'pdftk-'));
  const inPath = join(dir, 'in.pdf');
  const outPath = join(dir, 'out.pdf');
  try {
    await writeFile(inPath, input);
    const finalArgs = [...args, inPath, outPath];
    await new Promise((resolve, reject) => {
      const child = spawn('qpdf', finalArgs);
      const err = [];
      child.stderr.on('data', d => err.push(d));
      child.on('error', e => reject(e.code === 'ENOENT' ? httpError(500, 'qpdf is not installed on this server') : e));
      child.on('close', code => {
        if (code === 0 || code === 3) return resolve();
        let msg = Buffer.concat(err).toString().trim() || `qpdf exited ${code}`;
        // Scrub temp paths out of user-visible error messages.
        msg = msg.replace(/^qpdf: /, '').replace(/\/[^\s:]*\/pdftk-[^\/]+\/in\.pdf: ?/g, '');
        reject(httpError(400, msg));
      });
    });
    return await readFile(outPath);
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export default router;
export { runQpdf };
