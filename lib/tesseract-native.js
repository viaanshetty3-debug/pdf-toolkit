// Shell out to native `tesseract` CLI (far faster than tesseract.js, with
// access to the "best" LSTM models). Lazy-downloads traineddata on demand.

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Jimp from 'jimp';
import https from 'node:https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESSDATA_DIR = join(__dirname, '..', 'data', 'tessdata');

// Supported languages the UI lets you pick. Values beyond 'eng' are
// downloaded on first use from the official tessdata_best repository.
export const LANGS = ['eng', 'fra', 'deu', 'spa', 'ita', 'por', 'nld', 'rus', 'ukr',
  'ara', 'hin', 'chi_sim', 'chi_tra', 'jpn', 'kor', 'tha', 'vie', 'tur', 'pol', 'ces',
  'ell', 'heb', 'fas'];

async function ensureTrainedData(lang) {
  await mkdir(TESSDATA_DIR, { recursive: true });
  // Tesseract needs its `configs/` + `tessconfigs/` dirs alongside the
  // traineddata. Symlink or copy from the system install on first run.
  const SYSTEM_TESSDATA = '/data/data/com.termux/files/usr/share/tessdata';
  for (const d of ['configs', 'tessconfigs']) {
    const dst = join(TESSDATA_DIR, d);
    if (!existsSync(dst) && existsSync(`${SYSTEM_TESSDATA}/${d}`)) {
      try {
        await import('node:fs').then(fs => fs.promises.cp(`${SYSTEM_TESSDATA}/${d}`, dst, { recursive: true }));
      } catch { /* best-effort */ }
    }
  }
  // Also seed osd.traineddata (needed for psm=1).
  const parts = ['osd', ...lang.split('+')];
  for (const p of parts) {
    const path = join(TESSDATA_DIR, `${p}.traineddata`);
    if (existsSync(path)) continue;
    if (p !== 'osd' && !LANGS.includes(p)) throw new Error(`Unsupported OCR language: ${p}`);
    await download(
      `https://github.com/tesseract-ocr/tessdata_best/raw/main/${p}.traineddata`,
      path,
    );
  }
}

function download(url, outPath, redirect = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'pdf-toolkit' } }, async res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirect > 0) {
        res.destroy();
        return resolve(download(res.headers.location, outPath, redirect - 1));
      }
      if (res.statusCode !== 200) {
        res.destroy();
        return reject(new Error(`Download failed ${res.statusCode}: ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', async () => {
        try { await writeFile(outPath, Buffer.concat(chunks)); resolve(); }
        catch (e) { reject(e); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Run OCR on an image buffer.
 * Returns { words: [{ text, x, y, w, h }], width, height } in image pixels.
 *
 * imageBuffer is a JPEG or PNG. Preprocessing: grayscale + contrast +
 * optional 2× upscale for small images, before tesseract.
 */
export async function recognize(imageBuffer, lang = 'eng') {
  await ensureTrainedData(lang);
  const dir = await mkdtemp(join(tmpdir(), 'pdftk-ocr-'));
  try {
    const inPath = join(dir, 'in.png');
    const outBase = join(dir, 'out');
    // Preprocess: grayscale + contrast + light upscale.
    const img = await Jimp.read(imageBuffer);
    const longEdge = Math.max(img.bitmap.width, img.bitmap.height);
    if (longEdge < 1800) img.scale(Math.min(2, 1800 / longEdge));
    img.greyscale().contrast(0.2);
    await img.writeAsync(inPath);

    await new Promise((resolve, reject) => {
      const child = spawn('tesseract', [
        inPath, outBase,
        '--tessdata-dir', TESSDATA_DIR,
        '-l', lang,
        '--psm', '3',  // Fully automatic page segmentation, no OSD (OSD often skips sparse images)
        '--oem', '1',  // Neural nets LSTM only
        'hocr',
      ], { env: { ...process.env, OMP_THREAD_LIMIT: '2' } });
      const err = [];
      child.stderr.on('data', d => err.push(d));
      child.on('error', e => reject(e.code === 'ENOENT' ? new Error('tesseract CLI not installed') : e));
      child.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(Buffer.concat(err).toString().trim() || `tesseract exited ${code}`));
      });
    });

    const hocr = await readFile(`${outBase}.hocr`, 'utf8');
    return parseHocr(hocr, img.bitmap.width, img.bitmap.height);
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Parse hOCR (HTML with embedded bbox info). We walk the `ocrx_word` spans:
 *   <span class="ocrx_word" title="bbox x1 y1 x2 y2; ...">text</span>
 */
function parseHocr(hocr, width, height) {
  const words = [];
  // Match either regular or <span> fragments. Attributes may be in any order.
  const re = /<span[^>]+class='ocrx_word'[^>]+title='([^']+)'[^>]*>([\s\S]*?)<\/span>/g;
  let m;
  while ((m = re.exec(hocr)) !== null) {
    const title = m[1];
    const text = decodeHtml(m[2]).replace(/<[^>]+>/g, '').trim();
    if (!text) continue;
    const bb = title.match(/bbox (\d+) (\d+) (\d+) (\d+)/);
    if (!bb) continue;
    const [, x1, y1, x2, y2] = bb.map(Number);
    words.push({ text, x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
  }
  return { words, width, height };
}

function decodeHtml(s) {
  return s.replace(/&(amp|lt|gt|quot|#39|#(\d+));/g, (_, e, d) =>
    d ? String.fromCharCode(parseInt(d, 10))
      : { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[e]);
}
