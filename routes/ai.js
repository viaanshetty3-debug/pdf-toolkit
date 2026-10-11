import { Router } from 'express';
import { GoogleGenAI } from '@google/genai';
import { upload, sendPdf, httpError } from '../lib/pdf-utils.js';
import { extractPagesLines } from '../lib/pdf-text.js';
import { Layout } from '../lib/pdf-layout.js';

const router = Router();

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

function client() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw httpError(500, 'GEMINI_API_KEY is not set on the server');
  return new GoogleGenAI({ apiKey });
}

async function askGemini({ system, user, maxTokens = 4000 }) {
  const ai = client();
  // Google's 503 "experiencing high demand" errors on 2.5/3.x Flash come
  // and go. Retry up to 4 times with widening backoff (15s, 30s, 45s, 60s).
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const resp = await ai.models.generateContent({
        model: MODEL,
        contents: user,
        config: {
          systemInstruction: system,
          maxOutputTokens: maxTokens,
        },
      });
      return resp.text || '';
    } catch (e) {
      lastErr = e;
      const msg = String(e.message || '');
      const transient = /503|UNAVAILABLE|RESOURCE_EXHAUSTED|429|overloaded|high demand/i.test(msg);
      if (transient && attempt < 3) {
        await new Promise(r => setTimeout(r, 15000 * (attempt + 1)));
        continue;
      }
      // Give the user a cleaner message than Google's wall-of-JSON.
      if (transient) {
        throw httpError(503, 'Gemini is overloaded. Please try again in a minute.');
      }
      throw e;
    }
  }
  throw lastErr;
}

/**
 * POST /api/ai/summarize
 *   file
 *   length   short | medium | long  (default medium)
 *   style    bullets | paragraph    (default paragraph)
 */
router.post('/summarize', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    const length = ['short', 'medium', 'long'].includes(req.body.length) ? req.body.length : 'medium';
    const style = ['bullets', 'paragraph'].includes(req.body.style) ? req.body.style : 'paragraph';
    const pages = await extractPagesLines(req.file.buffer);
    const text = pages.map((lines, i) => `# Page ${i + 1}\n${lines.join('\n')}`).join('\n\n');
    if (!text.trim()) throw httpError(400, 'PDF has no extractable text');

    const target = { short: '2–3 sentences', medium: '1 paragraph (~150 words)', long: '3–4 paragraphs (~400 words)' }[length];
    const format = style === 'bullets' ? 'bullet points' : 'flowing prose';

    const summary = await askGemini({
      system: 'You produce faithful, concise summaries of documents. No preamble, no apologies, no mention that this is a summary — just the output.',
      user: `Summarize the following document in ${target}, as ${format}. Capture the key argument and conclusions.\n\nDocument:\n${text}`,
      maxTokens: length === 'long' ? 2000 : length === 'medium' ? 800 : 300,
    });

    res.json({ summary, pageCount: pages.length });
  } catch (e) { next(e); }
});

/**
 * POST /api/ai/translate
 *   file
 *   targetLanguage   e.g. "Spanish", "Japanese", "Arabic"
 *   output           "pdf" (default) | "text"
 *
 * Translates one page at a time to stay within context budgets.
 */
router.post('/translate', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    const target = String(req.body.targetLanguage || '').trim();
    if (!target) throw httpError(400, 'targetLanguage required');
    const output = req.body.output === 'text' ? 'text' : 'pdf';
    const pages = await extractPagesLines(req.file.buffer);

    const translated = [];
    for (let i = 0; i < pages.length; i++) {
      const pageText = pages[i].join('\n');
      if (!pageText.trim()) { translated.push(''); continue; }
      const t = await askGemini({
        system: `You translate text into ${target}. Preserve paragraph structure. Output only the translation — no explanations, no original text.`,
        user: pageText,
        maxTokens: 4000,
      });
      translated.push(t);
    }

    if (output === 'text') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="translated.txt"');
      res.end(translated.map((t, i) => `--- Page ${i + 1} ---\n${t}`).join('\n\n'));
      return;
    }

    const layout = new Layout();
    await layout.init();
    translated.forEach((t, i) => {
      if (i > 0) layout.newPage();
      layout.heading(`Page ${i + 1}`, 4);
      // Layout engine uses Helvetica (WinAnsi only). Non-Latin targets will
      // lose characters; the UI steers users to the .txt output for those.
      const safe = toLatin1(t);
      for (const para of safe.split(/\n\s*\n/)) {
        if (para.trim()) layout.paragraph([{ text: para.trim() }]);
      }
    });
    const bytes = await layout.save();
    sendPdf(res, bytes, 'translated.pdf');
  } catch (e) { next(e); }
});

/**
 * POST /api/ai/markdown
 *   file
 * Returns reconstructed Markdown with headings, lists, tables inferred.
 */
router.post('/markdown', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    const pages = await extractPagesLines(req.file.buffer);
    const text = pages.map((lines, i) => `# Page ${i + 1}\n\n${lines.join('\n')}`).join('\n\n');

    const md = await askGemini({
      system: `You reconstruct Markdown documents from raw PDF text extractions. Infer headings (# ## ###), paragraphs, bullet/numbered lists, bold/italic, tables, and code blocks from the raw text. Preserve the author's wording exactly — only re-structure. Output nothing but the Markdown.`,
      user: text,
      maxTokens: 8000,
    });

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="converted.md"');
    res.end(md);
  } catch (e) { next(e); }
});

/**
 * GET /api/ai/status — reports whether an API key is configured, so the UI
 * can show a helpful banner without exposing the key itself.
 */
router.get('/status', (req, res) => {
  const configured = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  res.json({ configured, model: MODEL, provider: 'gemini' });
});

function toLatin1(s) {
  return s.replace(/[^\u0000-\u00ff\u2010-\u2019\u201c-\u201d\u2022\u2026]/g, '?');
}

export default router;
