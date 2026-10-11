// Thin wrapper around pdf.js (loaded from CDN by the host page).
// Expects `window.pdfjsLib` to exist.

export async function openPdf(file) {
  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
  return pdf;
}

export async function renderThumb(pdf, pageNum, canvas, scale = 0.4) {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
}
