import { Router } from 'express';
import multer from 'multer';
import mammoth from 'mammoth';
import { Layout } from '../lib/pdf-layout.js';
import { sendPdf, httpError } from '../lib/pdf-utils.js';
import { convertToPdf as loConvert, hasLibreOffice } from '../lib/libreoffice.js';

const router = Router();
// mammoth encodes inline images as data: URIs; decode + stash by index so we
// can embed them in order during the HTML walk.
const DATA_URL_RE = /^data:image\/(png|jpeg|jpg);base64,/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024, files: 1 },
});

/**
 * POST /api/word-to-pdf — convert .docx to PDF.
 * Uses mammoth to extract structured HTML, then renders via our Layout
 * engine. Text styling (bold/italic), headings, lists, and basic tables
 * carry through. Complex layouts (columns, floats, SmartArt) do not.
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    // Prefer LibreOffice when available — gets the "last 15%" (SmartArt,
    // equations, headers/footers, custom fonts).
    try {
      const bytes = await loConvert(req.file.buffer, 'docx');
      res.setHeader('x-engine', 'libreoffice');
      res.setHeader('Access-Control-Expose-Headers', 'x-engine');
      return sendPdf(res, bytes, 'converted.pdf');
    } catch (e) {
      if (!e.noLo) throw e;
      // Fallback: pure-JS pipeline.
    }
    const { value: html } = await mammoth.convertToHtml({ buffer: req.file.buffer });
    const layout = new Layout();
    await layout.init();
    await renderHtml(html, layout);
    const bytes = await layout.save();
    res.setHeader('x-engine', 'pdf-lib');
    res.setHeader('Access-Control-Expose-Headers', 'x-engine');
    sendPdf(res, bytes, 'converted.pdf');
  } catch (e) { next(e); }
});

/**
 * Parse mammoth's clean HTML (always well-formed with a limited tag set)
 * into layout calls. We use a tiny tokenizer rather than cheerio to keep
 * dependencies minimal.
 */
async function renderHtml(html, layout) {
  const dom = parseHtml(html);
  for (const node of dom) await emitBlock(node, layout);
}

async function emitBlock(node, layout, ctx = {}) {
  if (node.type === 'text') {
    // Loose text at block level — treat as a paragraph.
    const trimmed = node.text.trim();
    if (trimmed) layout.paragraph([{ text: trimmed }]);
    return;
  }
  const tag = node.tag;
  if (/^h[1-6]$/.test(tag)) {
    layout.heading(nodeText(node), parseInt(tag[1], 10));
    return;
  }
  if (tag === 'img') {
    const src = node.attrs?.src;
    if (src) await emitImage(src, layout);
    return;
  }
  if (tag === 'p') {
    const runs = collectRuns(node);
    const imgs = findAll(node, 'img');
    if (runs.length) layout.paragraph(runs);
    for (const im of imgs) {
      if (im.attrs?.src) await emitImage(im.attrs.src, layout);
    }
    return;
  }
  if (tag === 'ul' || tag === 'ol') {
    let n = 0;
    for (const li of node.children) {
      if (li.type !== 'element' || li.tag !== 'li') continue;
      const runs = collectRuns(li);
      if (tag === 'ol') { n += 1; layout.numbered(runs, n, { depth: ctx.depth || 0 }); }
      else layout.bullet(runs, { depth: ctx.depth || 0 });
      // Nested lists:
      for (const c of li.children) {
        if (c.type === 'element' && (c.tag === 'ul' || c.tag === 'ol')) {
          emitBlock(c, layout, { depth: (ctx.depth || 0) + 1 });
        }
      }
    }
    layout.gap(4);
    return;
  }
  if (tag === 'table') {
    const rows = [];
    let header = null;
    for (const tr of findAll(node, 'tr')) {
      const cells = findAll(tr, 'td').concat(findAll(tr, 'th'));
      const texts = cells.map(c => nodeText(c));
      if (!header && findAll(tr, 'th').length === cells.length) header = texts;
      else rows.push(texts);
    }
    if (rows.length || header) layout.table(rows, { header });
    return;
  }
  if (tag === 'br') { layout.gap(4); return; }
  // Default: recurse into children.
  for (const c of node.children || []) await emitBlock(c, layout, ctx);
}

async function emitImage(dataUrl, layout) {
  const m = String(dataUrl).match(DATA_URL_RE);
  if (!m) return;
  const kind = m[1].toLowerCase() === 'png' ? 'png' : 'jpg';
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  try {
    const buf = Buffer.from(b64, 'base64');
    await layout.image(buf, kind, { maxWidthFraction: 0.9 });
  } catch {
    // Silently skip bad images rather than blow up the whole conversion.
  }
}

function collectRuns(node, inherited = {}) {
  const runs = [];
  for (const c of node.children || []) {
    if (c.type === 'text') {
      if (c.text) runs.push({ text: c.text, ...inherited });
    } else if (c.type === 'element') {
      const style = { ...inherited };
      if (c.tag === 'strong' || c.tag === 'b') style.bold = true;
      if (c.tag === 'em' || c.tag === 'i') style.italic = true;
      if (c.tag === 'code' || c.tag === 'tt') style.mono = true;
      if (c.tag === 'br') { runs.push({ text: '\n', ...style }); continue; }
      runs.push(...collectRuns(c, style));
    }
  }
  return runs;
}

function nodeText(node) {
  if (node.type === 'text') return node.text;
  return (node.children || []).map(nodeText).join('');
}

function findAll(node, tag) {
  const out = [];
  (function walk(n) {
    for (const c of n.children || []) {
      if (c.type === 'element') {
        if (c.tag === tag) out.push(c);
        walk(c);
      }
    }
  })(node);
  return out;
}

/** Minimal HTML-to-DOM parser for mammoth's output. Keeps attrs for <img>. */
function parseHtml(html) {
  const tokens = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[4] !== undefined) {
      const text = decode(m[4]);
      if (text) tokens.push({ type: 'text', text });
    } else {
      const tag = m[2].toLowerCase();
      if (m[1]) tokens.push({ type: 'close', tag });
      else tokens.push({ type: 'open', tag, attrs: parseAttrs(m[3] || '') });
    }
  }
  const root = { children: [] };
  const stack = [root];
  const voidTags = new Set(['br', 'hr', 'img', 'meta', 'link']);
  for (const t of tokens) {
    const top = stack[stack.length - 1];
    if (t.type === 'text') top.children.push({ type: 'text', text: t.text });
    else if (t.type === 'open') {
      const el = { type: 'element', tag: t.tag, attrs: t.attrs, children: [] };
      top.children.push(el);
      if (!voidTags.has(t.tag)) stack.push(el);
    } else {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === t.tag) { stack.length = i; break; }
      }
    }
  }
  return root.children;
}

function parseAttrs(s) {
  const attrs = {};
  const re = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m;
  while ((m = re.exec(s)) !== null) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4];
  return attrs;
}

function decode(s) {
  return s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => (
    { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' }[e]
  ));
}

export default router;
