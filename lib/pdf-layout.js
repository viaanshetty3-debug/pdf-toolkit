// Tiny text layout engine for pdf-lib: handles word-wrapping, page breaks,
// basic headings, bold/italic runs, bullet lists. Not a full HTML renderer —
// just enough to produce readable PDFs from structured text sources.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE = { width: 612, height: 792 }; // Letter
const MARGIN = { top: 54, right: 54, bottom: 54, left: 54 };

export class Layout {
  constructor() {
    this.doc = null;
    this.fonts = null;
    this.page = null;
    this.cursorY = 0;
  }
  async init() {
    this.doc = await PDFDocument.create();
    this.fonts = {
      regular: await this.doc.embedFont(StandardFonts.Helvetica),
      bold: await this.doc.embedFont(StandardFonts.HelveticaBold),
      italic: await this.doc.embedFont(StandardFonts.HelveticaOblique),
      boldItalic: await this.doc.embedFont(StandardFonts.HelveticaBoldOblique),
      mono: await this.doc.embedFont(StandardFonts.Courier),
    };
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.cursorY = PAGE.height - MARGIN.top;
  }
  availWidth() { return PAGE.width - MARGIN.left - MARGIN.right; }
  ensure(spaceNeeded) {
    if (this.cursorY - spaceNeeded < MARGIN.bottom) this.newPage();
  }
  pickFont({ bold, italic, mono }) {
    if (mono) return this.fonts.mono;
    if (bold && italic) return this.fonts.boldItalic;
    if (bold) return this.fonts.bold;
    if (italic) return this.fonts.italic;
    return this.fonts.regular;
  }

  /**
   * Draw a line of styled runs with word-wrapping.
   * runs: [{ text, bold?, italic?, mono?, size?, color? }]
   * opts: { indent?, size? (default), lineGap? }
   */
  drawRuns(runs, { indent = 0, size = 11, lineGap = 4, align = 'left' } = {}) {
    const maxWidth = this.availWidth() - indent;
    // Flatten into tokens with associated style/font.
    const tokens = [];
    for (const run of runs) {
      const font = this.pickFont(run);
      const fontSize = run.size || size;
      const color = run.color || rgb(0, 0, 0);
      const words = String(run.text).split(/(\s+)/);
      for (const w of words) {
        if (w === '') continue;
        tokens.push({ text: w, font, size: fontSize, color });
      }
    }
    let line = [];
    let lineWidth = 0;
    const flush = () => {
      if (!line.length) return;
      this.ensure(size + lineGap);
      let x = MARGIN.left + indent;
      if (align === 'right') x = PAGE.width - MARGIN.right - lineWidth;
      else if (align === 'center') x = MARGIN.left + indent + (maxWidth - lineWidth) / 2;
      // Trim trailing whitespace tokens from the line.
      while (line.length && /^\s+$/.test(line[line.length - 1].text)) {
        const t = line.pop();
        lineWidth -= t.font.widthOfTextAtSize(t.text, t.size);
      }
      const topY = this.cursorY;
      for (const t of line) {
        this.page.drawText(t.text, { x, y: topY - t.size, size: t.size, font: t.font, color: t.color });
        x += t.font.widthOfTextAtSize(t.text, t.size);
      }
      this.cursorY -= size + lineGap;
      line = [];
      lineWidth = 0;
    };
    for (const t of tokens) {
      const w = t.font.widthOfTextAtSize(t.text, t.size);
      if (lineWidth + w > maxWidth && !/^\s+$/.test(t.text) && line.length) {
        flush();
      }
      if (/^\s+$/.test(t.text) && line.length === 0) continue;
      line.push(t);
      lineWidth += w;
    }
    flush();
  }

  gap(h = 8) { this.cursorY -= h; }

  heading(text, level = 1) {
    const sizes = { 1: 22, 2: 18, 3: 15, 4: 13, 5: 12, 6: 11 };
    const size = sizes[level] || 12;
    this.gap(level === 1 ? 12 : 8);
    this.drawRuns([{ text, bold: true, size }], { size, lineGap: 4 });
    this.gap(4);
  }

  paragraph(runs, opts = {}) {
    this.drawRuns(runs, opts);
    this.gap(6);
  }

  bullet(runs, { depth = 0, size = 11 } = {}) {
    const indent = depth * 18 + 14;
    this.ensure(size + 4);
    this.page.drawText('\u2022', {
      x: MARGIN.left + depth * 18, y: this.cursorY - size,
      size, font: this.fonts.regular, color: rgb(0, 0, 0),
    });
    this.drawRuns(runs, { indent, size });
  }

  numbered(runs, number, { depth = 0, size = 11 } = {}) {
    const indent = depth * 18 + 20;
    this.ensure(size + 4);
    this.page.drawText(`${number}.`, {
      x: MARGIN.left + depth * 18, y: this.cursorY - size,
      size, font: this.fonts.regular, color: rgb(0, 0, 0),
    });
    this.drawRuns(runs, { indent, size });
  }

  /**
   * Draw a simple table with columns of equal width.
   * rows: array of arrays of strings. header: optional array (first row bold).
   */
  table(rows, { header = null, size = 10 } = {}) {
    const allRows = header ? [header, ...rows] : rows;
    if (!allRows.length) return;
    const cols = Math.max(...allRows.map(r => r.length));
    const colW = this.availWidth() / cols;
    const rowH = size * 1.8;

    for (let r = 0; r < allRows.length; r++) {
      this.ensure(rowH);
      const row = allRows[r];
      const isHeader = header && r === 0;
      const yTop = this.cursorY;
      const yBottom = yTop - rowH;
      // Cells
      for (let c = 0; c < cols; c++) {
        const cell = String(row[c] ?? '');
        const font = isHeader ? this.fonts.bold : this.fonts.regular;
        // Truncate to one line (basic).
        let text = cell;
        while (text && font.widthOfTextAtSize(text, size) > colW - 6) {
          text = text.slice(0, -1);
        }
        if (text !== cell) text = text.slice(0, -1) + '…';
        this.page.drawText(text, { x: MARGIN.left + c * colW + 3, y: yBottom + 5, size, font });
        this.page.drawRectangle({
          x: MARGIN.left + c * colW, y: yBottom, width: colW, height: rowH,
          borderColor: rgb(0.75, 0.75, 0.75), borderWidth: 0.5,
        });
      }
      if (isHeader) {
        this.page.drawRectangle({
          x: MARGIN.left, y: yBottom, width: colW * cols, height: rowH,
          color: rgb(0.95, 0.95, 0.97),
          borderColor: rgb(0.75, 0.75, 0.75), borderWidth: 0.5,
        });
        // Re-render the header text on top of the fill.
        for (let c = 0; c < cols; c++) {
          const cell = String(row[c] ?? '');
          const font = this.fonts.bold;
          let text = cell;
          while (text && font.widthOfTextAtSize(text, size) > colW - 6) text = text.slice(0, -1);
          if (text !== cell) text = text.slice(0, -1) + '…';
          this.page.drawText(text, { x: MARGIN.left + c * colW + 3, y: yBottom + 5, size, font });
        }
      }
      this.cursorY = yBottom;
    }
    this.gap(10);
  }

  /**
   * Embed an image at the current cursor, centered in the content width,
   * scaled so neither dimension exceeds the available area. `imageBytes`
   * is a PNG or JPEG buffer; `kind` is 'png' | 'jpg'.
   */
  async image(imageBytes, kind, { maxWidthFraction = 1, caption } = {}) {
    const bytes = new Uint8Array(imageBytes);
    const img = kind === 'png'
      ? await this.doc.embedPng(bytes)
      : await this.doc.embedJpg(bytes);
    const maxW = this.availWidth() * maxWidthFraction;
    const scale = Math.min(1, maxW / img.width);
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    this.ensure(drawH + 10);
    const x = MARGIN.left + (this.availWidth() - drawW) / 2;
    const y = this.cursorY - drawH;
    this.page.drawImage(img, { x, y, width: drawW, height: drawH });
    this.cursorY -= drawH + 4;
    if (caption) {
      this.drawRuns([{ text: caption, italic: true, size: 9, color: undefined }], { size: 9, align: 'center' });
    }
    this.gap(6);
  }

  async save() { return await this.doc.save(); }
}
