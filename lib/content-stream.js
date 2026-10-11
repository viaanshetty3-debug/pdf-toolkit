// Minimal PDF content stream parser/tokenizer sufficient for redaction:
// walk operators, track the current text matrix, and selectively drop text-
// showing operators (Tj, TJ, ') whose rendered position falls inside a box.

import { PDFArray, PDFName, PDFRawStream, PDFRef } from 'pdf-lib';
import zlib from 'node:zlib';

const WHITESPACE = /[\x00\t\n\f\r ]/;

export function tokenize(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('latin1') : String(bytes);
  const tokens = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (!c) break;
    if (WHITESPACE.test(c)) { i++; continue; }
    if (c === '%') {  // comment to EOL
      while (i < n && text[i] !== '\n' && text[i] !== '\r') i++;
      continue;
    }
    if (c === '(') {  // literal string
      const start = i;
      let depth = 0;
      do {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') depth--;
        else if (text[i] === '\\') i++;  // skip escape
        i++;
      } while (i < n && depth > 0);
      tokens.push({ type: 'string', raw: text.slice(start, i), kind: 'lit' });
      continue;
    }
    if (c === '<' && text[i + 1] !== '<') {  // hex string
      const start = i;
      i++;
      while (i < n && text[i] !== '>') i++;
      i++;
      tokens.push({ type: 'string', raw: text.slice(start, i), kind: 'hex' });
      continue;
    }
    if (c === '<' && text[i + 1] === '<') {  // dict
      const start = i;
      let depth = 0;
      do {
        if (text[i] === '<' && text[i + 1] === '<') { depth++; i += 2; }
        else if (text[i] === '>' && text[i + 1] === '>') { depth--; i += 2; }
        else i++;
      } while (i < n && depth > 0);
      tokens.push({ type: 'dict', raw: text.slice(start, i) });
      continue;
    }
    if (c === '[') {  // array
      const start = i;
      let depth = 1;
      i++;
      while (i < n && depth > 0) {
        if (text[i] === '[') depth++;
        else if (text[i] === ']') depth--;
        else if (text[i] === '(') {
          let d2 = 1; i++;
          while (i < n && d2 > 0) {
            if (text[i] === '\\') i++;
            else if (text[i] === '(') d2++;
            else if (text[i] === ')') d2--;
            i++;
          }
          continue;
        }
        i++;
      }
      tokens.push({ type: 'array', raw: text.slice(start, i) });
      continue;
    }
    // Name (/Foo), number, or operator keyword.
    const start = i;
    if (c === '/') {
      i++;  // skip the leading '/'
      while (i < n && !WHITESPACE.test(text[i]) && !'()<>[]{}/%'.includes(text[i])) i++;
      tokens.push({ type: 'name', raw: text.slice(start, i) });
      continue;
    }
    // Read a run of non-delimiter chars for number/operator.
    while (i < n && !WHITESPACE.test(text[i]) && !'()<>[]{}/%'.includes(text[i])) i++;
    const raw = text.slice(start, i);
    if (raw.length === 0) { i++; continue; }
    if (/^-?[\d.]+$/.test(raw)) {
      tokens.push({ type: 'number', value: parseFloat(raw), raw });
    } else {
      tokens.push({ type: 'op', name: raw, raw });
    }
  }
  return tokens;
}

/**
 * Walk a content stream, track the text position (CTM × text matrix × Tm),
 * and return a redacted content stream with any text-showing operators whose
 * rendered origin falls inside one of the `boxes` dropped.
 *
 * boxes: array of { x, y, w, h } in PDF user space (bottom-left origin).
 *
 * This is a conservative approach: we only remove the text-showing operator
 * (Tj/TJ/'/" at the matched position), replacing it with nothing. The
 * accompanying text positioning is left alone so subsequent text keeps its
 * x-y offsets. For most PDFs this is sufficient — the text under redaction
 * boxes is gone from the content stream, so copy-paste and text extraction
 * cannot recover it.
 */
export function redactContentStream(bytes, boxes) {
  const tokens = tokenize(bytes);
  // Text state.
  let inText = false;
  // Text line matrix and text matrix. Represented as [a b c d e f].
  let Tm = [1, 0, 0, 1, 0, 0];
  let Tlm = [1, 0, 0, 1, 0, 0];
  // Current transformation matrix stack.
  let CTM = [1, 0, 0, 1, 0, 0];
  const stack = [];
  // Font size (approx for bounding box).
  let fontSize = 10;

  const out = [];
  // We walk tokens, maintaining an "operand buffer" that we flush before each operator.
  let operands = [];

  const multiply = (a, b) => [
    a[0]*b[0] + a[1]*b[2],
    a[0]*b[1] + a[1]*b[3],
    a[2]*b[0] + a[3]*b[2],
    a[2]*b[1] + a[3]*b[3],
    a[4]*b[0] + a[5]*b[2] + b[4],
    a[4]*b[1] + a[5]*b[3] + b[5],
  ];
  const translate = (m, tx, ty) => multiply([1,0,0,1,tx,ty], m);
  const currentPoint = () => {
    // Text rendering origin in user space = Tm × CTM evaluated at (0,0).
    const t = multiply(Tm, CTM);
    return { x: t[4], y: t[5] };
  };
  const inRedact = () => {
    const p = currentPoint();
    for (const b of boxes) {
      if (p.x >= b.x && p.x <= b.x + b.w &&
          p.y >= b.y - fontSize && p.y <= b.y + b.h) {
        return true;
      }
    }
    return false;
  };

  const emitOperand = (tok) => { out.push(tok.raw); out.push(' '); };
  const emitOp = (name) => { out.push(name); out.push('\n'); };

  for (const tok of tokens) {
    if (tok.type !== 'op') {
      operands.push(tok);
      continue;
    }
    const op = tok.name;

    // Capture structural operators we need to simulate.
    const nums = operands.map(o => (o.type === 'number' ? o.value : null));

    switch (op) {
      case 'q': stack.push(CTM.slice()); break;
      case 'Q': CTM = stack.pop() || [1,0,0,1,0,0]; break;
      case 'cm': {
        if (nums.length === 6 && nums.every(n => n !== null)) {
          const m = nums;
          CTM = multiply(m, CTM);
        }
        break;
      }
      case 'BT':
        inText = true;
        Tm = [1,0,0,1,0,0];
        Tlm = [1,0,0,1,0,0];
        break;
      case 'ET':
        inText = false;
        break;
      case 'Tf':
        // operands: /FontName size
        if (nums.length >= 2 && nums[nums.length - 1] !== null) {
          fontSize = nums[nums.length - 1];
        }
        break;
      case 'Tm':
        if (nums.length === 6) {
          Tm = nums;
          Tlm = nums.slice();
        }
        break;
      case 'Td':
      case 'TD':
        if (nums.length === 2) {
          Tlm = translate(Tlm, nums[0], nums[1]);
          Tm = Tlm.slice();
        }
        break;
      case 'T*':
        Tlm = translate(Tlm, 0, -fontSize);
        Tm = Tlm.slice();
        break;
    }

    // Text-showing operators: drop them if the current position is inside a box.
    const showing = (op === 'Tj' || op === 'TJ' || op === "'" || op === '"');
    if (inText && showing && inRedact()) {
      // Skip: don't emit this operator or its operands.
      operands = [];
      continue;
    }

    // Default: emit operands then operator.
    for (const o of operands) emitOperand(o);
    operands = [];
    emitOp(op);
  }
  // Any trailing operands (shouldn't be, in a valid stream): emit them.
  for (const o of operands) emitOperand(o);
  return Buffer.from(out.join(''), 'latin1');
}

/**
 * Decode a page's content stream(s), handling PDFArray + PDFRef + Filter.
 * Returns a Buffer of the concatenated decoded operators.
 */
export function readPageContent(page, context) {
  const contentsObj = page.node.Contents();
  if (!contentsObj) return Buffer.alloc(0);
  const items = contentsObj instanceof PDFArray ? contentsObj.asArray() : [contentsObj];
  const chunks = [];
  for (const item of items) {
    const stream = item instanceof PDFRef ? context.lookup(item) : item;
    if (!stream || !(stream instanceof PDFRawStream)) continue;
    const raw = Buffer.from(stream.getContents());
    const filter = stream.dict.get(PDFName.of('Filter'));
    const filterName = filter ? filter.toString() : '';
    if (filterName.includes('FlateDecode')) {
      try { chunks.push(zlib.inflateSync(raw)); }
      catch { try { chunks.push(zlib.inflateRawSync(raw)); } catch { chunks.push(raw); } }
    } else {
      chunks.push(raw);
    }
  }
  return Buffer.concat(chunks);
}
