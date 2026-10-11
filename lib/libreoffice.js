// Shell out to LibreOffice headless for highest-fidelity Office → PDF.
// Returns the converted PDF bytes, or throws if soffice isn't installed.

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SOFFICE_CMDS = ['soffice', 'libreoffice'];

export async function hasLibreOffice() {
  for (const cmd of SOFFICE_CMDS) {
    const ok = await new Promise(resolve => {
      const c = spawn(cmd, ['--version']);
      c.on('error', () => resolve(false));
      c.on('close', code => resolve(code === 0));
    });
    if (ok) return cmd;
  }
  return null;
}

/**
 * Convert `inputBytes` (an .docx/.xlsx/.pptx) to PDF via LibreOffice.
 * `extension` is the source file extension (without dot).
 */
export async function convertToPdf(inputBytes, extension) {
  const cmd = await hasLibreOffice();
  if (!cmd) {
    const err = new Error('LibreOffice is not installed on this server');
    err.noLo = true;
    throw err;
  }
  const dir = await mkdtemp(join(tmpdir(), 'pdftk-lo-'));
  const inPath = join(dir, `in.${extension}`);
  const profile = join(dir, 'profile');
  try {
    await writeFile(inPath, inputBytes);
    await new Promise((resolve, reject) => {
      // --headless: no UI. -env:UserInstallation: isolated profile so each
      // request can run in parallel without soffice clobbering the lock.
      const args = [
        '--headless',
        `-env:UserInstallation=file://${profile}`,
        '--nologo', '--nodefault', '--nolockcheck', '--norestore',
        '--convert-to', 'pdf',
        '--outdir', dir,
        inPath,
      ];
      const child = spawn(cmd, args);
      const err = [];
      child.stderr.on('data', d => err.push(d));
      child.on('error', reject);
      child.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(Buffer.concat(err).toString().trim() || `soffice exited ${code}`));
      });
    });
    // LibreOffice writes `in.pdf`.
    const outPath = join(dir, 'in.pdf');
    return await readFile(outPath);
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
