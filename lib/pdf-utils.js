import multer from 'multer';
import { PDFDocument, degrees } from 'pdf-lib';

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024, files: 50 },
});

export async function loadPdf(buffer) {
  return PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
}

/**
 * Parse "1-3,5,7-9" → [0,1,2,4,6,7,8] (0-indexed, bounded by pageCount).
 * Throws if any token is malformed or out of range.
 */
export function parseRangeSpec(spec, pageCount) {
  if (!spec || typeof spec !== 'string') throw httpError(400, 'Range spec required');
  const result = new Set();
  const tokens = spec.split(',').map(t => t.trim()).filter(Boolean);
  if (tokens.length === 0) throw httpError(400, 'Range spec is empty');
  for (const token of tokens) {
    const m = token.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw httpError(400, `Invalid range token: "${token}"`);
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    if (start < 1 || end < start || end > pageCount) {
      throw httpError(400, `Range ${token} is out of bounds (1..${pageCount})`);
    }
    for (let i = start; i <= end; i++) result.add(i - 1);
  }
  return [...result].sort((a, b) => a - b);
}

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function sendPdf(res, bytes, filename) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', bytes.length);
  res.end(Buffer.from(bytes));
}

export async function copyPages(sourceDoc, targetDoc, pageIndices) {
  const copied = await targetDoc.copyPages(sourceDoc, pageIndices);
  for (const p of copied) targetDoc.addPage(p);
}

export { degrees };
