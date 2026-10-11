// OCR via Gemini's multimodal vision. Handles handwriting and rare scripts
// (Myanmar, Khmer, Devanagari variants, mixed-script documents) better than
// Tesseract. Returns the same shape as our native tesseract wrapper so the
// route can swap engines without caring which was used.

import { GoogleGenAI, Type } from '@google/genai';

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

function client() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    const e = new Error('Gemini is not configured (set GEMINI_API_KEY)');
    e.noKey = true;
    throw e;
  }
  return new GoogleGenAI({ apiKey });
}

/**
 * Recognize text in a page image.
 *
 *   imageBytes  JPEG or PNG buffer
 *   mime        'image/jpeg' or 'image/png'
 *   width/height  pixel dimensions of the image (so we can validate bboxes)
 *   hint        optional "handwriting" | "mixed_scripts" | undefined — passed
 *               to the model as a styling nudge
 *
 * Returns:  { words: [{ text, x, y, w, h }], width, height }
 */
export async function recognize(imageBytes, mime, { width, height, hint } = {}) {
  const ai = client();
  const base64 = imageBytes.toString('base64');

  const system = `You are an OCR engine. Given an image, extract every visible word (printed OR handwritten) and return its text + bounding box in pixel coordinates (top-left origin). Preserve the original script and casing. Do NOT translate or normalize. Each entry is one word (not a line or paragraph).`;

  const user = [
    `Transcribe all visible text in this image. The image is ${width}×${height} pixels.`,
    hint ? `Hint: the content includes ${hint}.` : '',
    `Return a flat array of {text, x, y, w, h} where (x,y) is the top-left of the word's bounding box in image pixels.`,
  ].filter(Boolean).join(' ');

  const schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        text: { type: Type.STRING },
        x: { type: Type.NUMBER },
        y: { type: Type.NUMBER },
        w: { type: Type.NUMBER },
        h: { type: Type.NUMBER },
      },
      required: ['text', 'x', 'y', 'w', 'h'],
    },
  };

  // Google's "high demand" errors on 2.5/3.x Flash come and go. Retry up to
  // 3 times with 10s backoff before giving up.
  let resp;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      resp = await ai.models.generateContent({
        model: DEFAULT_MODEL,
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: mime || 'image/jpeg', data: base64 } },
            { text: user },
          ],
        }],
        config: {
          systemInstruction: system,
          responseMimeType: 'application/json',
          responseSchema: schema,
          maxOutputTokens: 16000,
        },
      });
      break;
    } catch (e) {
      lastErr = e;
      const msg = String(e.message || '');
      if (/503|UNAVAILABLE|RESOURCE_EXHAUSTED|429/i.test(msg) && attempt < 2) {
        // Google's 503 "high demand" clears in ~15-30s; back off hard.
        await new Promise(r => setTimeout(r, 15000 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  if (!resp) throw lastErr;

  let text = resp.text || '';
  if (!text && resp.candidates?.[0]?.content?.parts) {
    text = resp.candidates[0].content.parts.map(p => p.text || '').join('');
  }
  let words;
  try { words = JSON.parse(text); }
  catch (e) {
    throw new Error(`Gemini returned non-JSON (${text.slice(0, 100)}...)`);
  }
  if (!Array.isArray(words)) words = [];

  // Clamp coordinates into image bounds; drop empty strings.
  const cleaned = words
    .filter(w => w && typeof w.text === 'string' && w.text.trim())
    .map(w => ({
      text: String(w.text),
      x: Math.max(0, Math.min(width,  Number(w.x) || 0)),
      y: Math.max(0, Math.min(height, Number(w.y) || 0)),
      w: Math.max(1, Math.min(width,  Number(w.w) || 1)),
      h: Math.max(1, Math.min(height, Number(w.h) || 1)),
    }));
  return { words: cleaned, width, height };
}

export function isAvailable() {
  return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
}
