import { Router } from 'express';
import multer from 'multer';
import { Layout } from '../lib/pdf-layout.js';
import { sendPdf, httpError } from '../lib/pdf-utils.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024, files: 1 },
});

/**
 * POST /api/html-to-pdf — convert an HTML fragment or full document to PDF.
 *
 * Form fields:
 *   file   optional .html file upload
 *   html   or inline HTML string
 *
 * Supports: h1-h6, p, strong/b, em/i, code, br, ul/ol/li, table (simple),
 * blockquote. CSS is NOT parsed — this renders semantic structure only.
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    let html = req.file ? req.file.buffer.toString('utf8') : (req.body.html || '');
    if (!html.trim()) throw httpError(400, 'Provide an HTML file or html field');

    // Strip anything in <head> / <style> / <script>.
    html = html.replace(/<head[\s\S]*?<\/head>/gi, '')
               .replace(/<style[\s\S]*?<\/style>/gi, '')
               .replace(/<script[\s\S]*?<\/script>/gi, '');
    // Extract body if present.
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch) html = bodyMatch[1];

    const layout = new Layout();
    await layout.init();
    const dom = parseHtml(html);
    for (const node of dom) emitBlock(node, layout);
    const bytes = await layout.save();
    sendPdf(res, bytes, 'webpage.pdf');
  } catch (e) { next(e); }
});

// Shared with word-to-pdf. Kept inline so the module is self-contained.
function emitBlock(node, layout, ctx = {}) {
  if (node.type === 'text') {
    const t = node.text.replace(/\s+/g, ' ').trim();
    if (t) layout.paragraph([{ text: t }]);
    return;
  }
  const tag = node.tag;
  if (/^h[1-6]$/.test(tag)) { layout.heading(nodeText(node), parseInt(tag[1], 10)); return; }
  if (tag === 'p' || tag === 'div') {
    const runs = collectRuns(node);
    if (runs.length) layout.paragraph(runs);
    return;
  }
  if (tag === 'blockquote') {
    layout.drawRuns(collectRuns(node), { indent: 20, size: 11 });
    layout.gap(6);
    return;
  }
  if (tag === 'pre') {
    const text = nodeText(node);
    layout.paragraph([{ text, mono: true, size: 10 }]);
    return;
  }
  if (tag === 'ul' || tag === 'ol') {
    let n = 0;
    for (const li of node.children) {
      if (li.type !== 'element' || li.tag !== 'li') continue;
      const runs = collectRuns(li);
      if (tag === 'ol') { n += 1; layout.numbered(runs, n, { depth: ctx.depth || 0 }); }
      else layout.bullet(runs, { depth: ctx.depth || 0 });
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
  if (tag === 'br' || tag === 'hr') { layout.gap(6); return; }
  for (const c of node.children || []) emitBlock(c, layout, ctx);
}

function collectRuns(node, inherited = {}) {
  const runs = [];
  for (const c of node.children || []) {
    if (c.type === 'text') {
      const t = c.text.replace(/\s+/g, ' ');
      if (t) runs.push({ text: t, ...inherited });
    } else if (c.type === 'element') {
      const style = { ...inherited };
      if (['strong', 'b'].includes(c.tag)) style.bold = true;
      if (['em', 'i'].includes(c.tag)) style.italic = true;
      if (['code', 'tt', 'kbd'].includes(c.tag)) style.mono = true;
      if (c.tag === 'br') { runs.push({ text: ' ', ...style }); continue; }
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

function parseHtml(html) {
  const tokens = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>|([^<]+)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[3] !== undefined) {
      const text = decode(m[3]);
      if (text) tokens.push({ type: 'text', text });
    } else {
      tokens.push({ type: m[1] ? 'close' : 'open', tag: m[2].toLowerCase() });
    }
  }
  const root = { children: [] };
  const stack = [root];
  const voidTags = new Set(['br', 'hr', 'img', 'meta', 'link', 'input']);
  for (const t of tokens) {
    const top = stack[stack.length - 1];
    if (t.type === 'text') top.children.push({ type: 'text', text: t.text });
    else if (t.type === 'open') {
      const el = { type: 'element', tag: t.tag, children: [] };
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

function decode(s) {
  return s.replace(/&(amp|lt|gt|quot|#39|nbsp|mdash|ndash|hellip);/g, (_, e) => (
    { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…' }[e]
  )).replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
}

export default router;
