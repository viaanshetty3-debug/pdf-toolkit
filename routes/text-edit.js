import { Router } from 'express';
import { PDFName } from 'pdf-lib';
import { upload, loadPdf, sendPdf, httpError } from '../lib/pdf-utils.js';
import { tokenize, readPageContent } from '../lib/content-stream.js';

const router = Router();

/**
 * POST /api/text-edit/find — find all occurrences of a string across the PDF.
 * Returns match counts per page so the UI can preview before replacing.
 *
 *   file
 *   query  the string to search for (literal, case-sensitive by default)
 *   caseInsensitive  "1" to ignore case
 */
router.post('/find', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    const query = String(req.body.query || '');
    if (!query) throw httpError(400, 'query required');
    const ci = req.body.caseInsensitive === '1';
    const doc = await loadPdf(req.file.buffer);
    const matches = [];
    for (let i = 0; i < doc.getPageCount(); i++) {
      const page = doc.getPage(i);
      const content = readPageContent(page, doc.context);
      const strings = extractLiteralStrings(content);
      const count = countOccurrences(strings, query, ci);
      matches.push({ page: i, matches: count });
    }
    res.json({
      query,
      total: matches.reduce((s, m) => s + m.matches, 0),
      pages: matches,
    });
  } catch (e) { next(e); }
});

/**
 * POST /api/text-edit/replace — perform find & replace across content streams.
 *
 *   file
 *   query, replacement
 *   caseInsensitive  "1" to ignore case
 *   pages            "all" | range spec, default "all"
 *
 * Only handles literal strings `(abc) Tj` and literal strings inside TJ
 * arrays `[(abc) ... ] TJ`. Hex strings are left alone (they often use
 * subsetted font encodings and can't be safely rewritten without the font
 * map). The UI makes this trade-off explicit.
 */
router.post('/replace', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    const query = String(req.body.query || '');
    const replacement = String(req.body.replacement ?? '');
    if (!query) throw httpError(400, 'query required');
    const ci = req.body.caseInsensitive === '1';
    const scope = (req.body.pages || 'all').trim();

    const doc = await loadPdf(req.file.buffer);
    const pageCount = doc.getPageCount();
    const indices = scope === 'all'
      ? doc.getPageIndices()
      : parsePageRange(scope, pageCount);

    let totalReplaced = 0;
    for (const i of indices) {
      const page = doc.getPage(i);
      const content = readPageContent(page, doc.context);
      const { bytes: edited, replaced } = replaceInContent(content, query, replacement, ci);
      if (replaced > 0) {
        totalReplaced += replaced;
        const newStream = doc.context.flateStream(edited);
        const newRef = doc.context.register(newStream);
        page.node.set(PDFName.of('Contents'), newRef);
      }
    }

    res.setHeader('x-replacements', String(totalReplaced));
    res.setHeader('Access-Control-Expose-Headers', 'x-replacements');
    const bytes = await doc.save();
    sendPdf(res, bytes, 'edited.pdf');
  } catch (e) { next(e); }
});

/* ============================================================
   Content stream string editing
   ============================================================ */

function extractLiteralStrings(bytes) {
  const tokens = tokenize(bytes);
  const out = [];
  for (const t of tokens) {
    if (t.type === 'string') {
      if (t.kind === 'lit') out.push(decodeLiteral(t.raw));
      else out.push(decodeHex(t.raw));
    } else if (t.type === 'array') {
      // Parse the array string for inner literals + hex strings.
      const litRe = /\(((?:\\.|[^\\)])*)\)/g;
      let m;
      while ((m = litRe.exec(t.raw)) !== null) out.push(decodeLiteralInner(m[1]));
      const hexRe = /<([0-9a-fA-F\s]*)>/g;
      while ((m = hexRe.exec(t.raw)) !== null) out.push(decodeHexInner(m[1]));
    }
  }
  return out;
}

function countOccurrences(strings, query, ci) {
  let total = 0;
  const q = ci ? query.toLowerCase() : query;
  for (const s of strings) {
    const hay = ci ? s.toLowerCase() : s;
    let idx = 0;
    while ((idx = hay.indexOf(q, idx)) !== -1) { total++; idx += q.length; }
  }
  return total;
}

function replaceInContent(bytes, query, replacement, ci) {
  const tokens = tokenize(bytes);
  const out = [];
  let replaced = 0;
  for (const t of tokens) {
    if (t.type === 'string' && t.kind === 'lit') {
      const decoded = decodeLiteral(t.raw);
      const { text: updated, count } = replaceInString(decoded, query, replacement, ci);
      if (count > 0) {
        replaced += count;
        out.push(encodeLiteral(updated));
        out.push(' ');
        continue;
      }
    } else if (t.type === 'string' && t.kind === 'hex') {
      const decoded = decodeHex(t.raw);
      const { text: updated, count } = replaceInString(decoded, query, replacement, ci);
      if (count > 0) {
        replaced += count;
        out.push(encodeHex(updated));
        out.push(' ');
        continue;
      }
    } else if (t.type === 'array') {
      let localCount = 0;
      let rebuilt = t.raw.replace(/\(((?:\\.|[^\\)])*)\)/g, (_full, inner) => {
        const decoded = decodeLiteralInner(inner);
        const { text: updated, count } = replaceInString(decoded, query, replacement, ci);
        if (count > 0) { localCount += count; return `(${encodeLiteralInner(updated)})`; }
        return `(${inner})`;
      });
      rebuilt = rebuilt.replace(/<([0-9a-fA-F\s]*)>/g, (_full, inner) => {
        const decoded = decodeHexInner(inner);
        const { text: updated, count } = replaceInString(decoded, query, replacement, ci);
        if (count > 0) { localCount += count; return `<${encodeHexInner(updated)}>`; }
        return `<${inner}>`;
      });
      replaced += localCount;
      out.push(rebuilt);
      out.push(' ');
      continue;
    }
    out.push(t.raw);
    out.push(' ');
  }
  return { bytes: Buffer.from(out.join(''), 'latin1'), replaced };
}

function replaceInString(s, query, replacement, ci) {
  if (!ci) {
    const parts = s.split(query);
    return { text: parts.join(replacement), count: parts.length - 1 };
  }
  const re = new RegExp(escapeRegex(query), 'gi');
  let count = 0;
  const out = s.replace(re, () => { count++; return replacement; });
  return { text: out, count };
}

/* Literal string encode/decode — honour PDF escape rules. */

function decodeLiteral(raw) {
  // raw includes the surrounding parens.
  return decodeLiteralInner(raw.slice(1, -1));
}

function decodeLiteralInner(inner) {
  return inner.replace(/\\([0-7]{1,3}|.)/g, (_, m) => {
    if (/^[0-7]+$/.test(m)) return String.fromCharCode(parseInt(m, 8));
    return { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[m] ?? m;
  });
}

function encodeLiteral(s) { return `(${encodeLiteralInner(s)})`; }

function encodeLiteralInner(s) {
  return s.replace(/[\\()]/g, c => '\\' + c);
}

function decodeHex(raw) {
  // raw includes <>.
  return decodeHexInner(raw.slice(1, -1));
}

function decodeHexInner(inner) {
  const clean = inner.replace(/\s+/g, '');
  const padded = clean.length % 2 ? clean + '0' : clean;
  let out = '';
  for (let i = 0; i < padded.length; i += 2) {
    out += String.fromCharCode(parseInt(padded.slice(i, i + 2), 16));
  }
  return out;
}

function encodeHex(s) { return `<${encodeHexInner(s)}>`; }

function encodeHexInner(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    out += s.charCodeAt(i).toString(16).padStart(2, '0').toUpperCase();
  }
  return out;
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function parsePageRange(spec, count) {
  const out = new Set();
  for (const token of spec.split(',').map(t => t.trim()).filter(Boolean)) {
    const m = token.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw httpError(400, `Invalid range: ${token}`);
    const a = parseInt(m[1], 10), b = m[2] ? parseInt(m[2], 10) : a;
    for (let i = a; i <= b; i++) {
      if (i >= 1 && i <= count) out.add(i - 1);
    }
  }
  return [...out].sort((a, b) => a - b);
}

export default router;
