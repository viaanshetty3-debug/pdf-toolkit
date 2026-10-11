// Rasterize PDF pages to JPEG via Ghostscript.
// Used by the Gemini OCR path (needs page images, not just embedded XObjects).

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Render every page of `pdfBytes` to JPEG at `dpi` DPI.
 * Returns an array of { page, bytes, width, height } entries, 0-indexed.
 *
 * `pages` optionally limits to specific 1-indexed page numbers.
 */
export async function rasterizePages(pdfBytes, { dpi = 200, pages } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'pdftk-raster-'));
  try {
    const inPath = join(dir, 'in.pdf');
    const outPattern = join(dir, 'page-%d.jpg');
    await writeFile(inPath, pdfBytes);

    const args = [
      '-sDEVICE=jpeg',
      '-dJPEGQ=85',
      `-r${dpi}`,
      '-dBATCH', '-dNOPAUSE', '-dQUIET',
      '-dTextAlphaBits=4',
      '-dGraphicsAlphaBits=4',
      `-sOutputFile=${outPattern}`,
    ];
    if (pages?.length) {
      args.push(`-dFirstPage=${pages[0]}`);
      args.push(`-dLastPage=${pages[pages.length - 1]}`);
    }
    args.push(inPath);

    await new Promise((resolve, reject) => {
      const child = spawn('gs', args);
      const err = [];
      child.stderr.on('data', d => err.push(d));
      child.on('error', e => reject(e.code === 'ENOENT' ? new Error('Ghostscript (gs) not installed') : e));
      child.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(Buffer.concat(err).toString().trim() || `gs exited ${code}`));
      });
    });

    const entries = await readdir(dir);
    const jpegs = entries
      .filter(n => /^page-\d+\.jpg$/.test(n))
      .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));

    const out = [];
    for (const name of jpegs) {
      const bytes = await readFile(join(dir, name));
      const idx = parseInt(name.match(/\d+/)[0], 10) - 1;
      // Decode width/height from JPEG header (SOF markers).
      const dims = decodeJpegDims(bytes);
      out.push({ page: idx, bytes, width: dims.width, height: dims.height });
    }
    return out;
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Pull width/height out of a JPEG's SOFn marker without decoding the pixels. */
function decodeJpegDims(buf) {
  let i = 2;  // skip SOI (FF D8)
  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    i += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;  // SOI/EOI, no length
    const len = buf.readUInt16BE(i);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      // SOFn — [i+2] is precision, next 2 bytes are height, next 2 are width
      const height = buf.readUInt16BE(i + 3);
      const width  = buf.readUInt16BE(i + 5);
      return { width, height };
    }
    i += len;
  }
  return { width: 0, height: 0 };
}
