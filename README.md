# PDF Toolkit

Premium PDF tools, running locally. No file size caps, no watermarks.

## Tools (33)

**Organize** — Merge · Split · Remove Pages · Extract Pages · Organize · Scan to PDF
**Optimize** — Compress · Repair · OCR (browser) · OCR (server)
**Convert to PDF** — JPG · Word · Excel · PowerPoint · HTML
**Convert from PDF** — PDF to JPG · Word · PowerPoint · Excel · PDF/A
**Edit** — Rotate · Page Numbers · Watermark · Crop · Edit · Forms
**Security** — Unlock · Protect · Sign (image stamp) · Sign (PKI) · Redact · Compare
**PDF Intelligence** — AI Summarizer · Translate · PDF to Markdown

## Run

```sh
cd ~/pdf-toolkit
npm start
# open http://localhost:5174
```

For the AI tools, set your Gemini API key before starting:

```sh
export GEMINI_API_KEY=...
npm start
```

## Installable as a PWA

Open the site on your phone and tap "Add to Home Screen" (Safari share menu on
iOS, three-dot menu on Chrome/Android). Launches as a standalone app, works
offline for the browser-side tools.

## Internationalisation

UI ships in **en, es, fr, de, it, pt, ja, zh, ar, hi**. The language picker
is in the top nav (flag + code button). Arabic flips the layout to RTL.

## Cloud storage integrations (optional)

Google Drive picker + Dropbox Chooser are wired in but need you to register
your own OAuth app (free) with each provider. Only public IDs are kept
server-side; no secrets. If the env vars are unset the buttons simply don't
render.

```sh
# Google Drive — register at https://console.cloud.google.com/
export GOOGLE_CLIENT_ID=...apps.googleusercontent.com
export GOOGLE_API_KEY=AIza...

# Dropbox — register at https://www.dropbox.com/developers/apps
export DROPBOX_APP_KEY=...
```

Files download through the browser; nothing ever hits anyone else's server.

## Expose it publicly

Three ways to make `localhost:5174` reachable from the internet:

**1. Cloudflare Tunnel** (zero-config, free, no account server needed):

```sh
# https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/
cloudflared tunnel --url http://localhost:5174
```

Prints a `*.trycloudflare.com` URL that proxies to your local server. For a
stable domain, run `cloudflared tunnel login` and bind a hostname.

**2. Docker** (for self-hosting on a VPS):

```sh
docker build -t pdf-toolkit .
docker run -d --name pdf-toolkit -p 5174:5174 \
  -e GEMINI_API_KEY=... \
  -v $(pwd)/data:/app/data \
  pdf-toolkit
```

The `-v data:/app/data` volume persists the self-signed signing certificate.

**3. Reverse proxy** (Caddy / nginx) in front of the Docker container for TLS.

## Stack

- Node.js + Express
- `pdf-lib` for PDF operations (pure JS, Termux-friendly)
- `pdfjs-dist` for server-side text extraction (Compare, PDF-to-Word/Excel/PPT, AI)
- `pdf.js` (browser CDN) for in-browser rendering + OCR
- `tesseract.js` for OCR (both browser WASM and server-side Node)
- `jimp` for JPEG recompression
- `archiver` for ZIP output (Split, PDF-to-JPG)
- `mammoth` / `xlsx` / `pptxgenjs` / `docx` for Office format round-trips
- `qpdf` (external) for password encryption and PDF repair
- `ghostscript` (external) for PDF/A conformance
- Built-in Node `crypto` for self-signed X.509 and PKCS#7 CMS signatures
- `@google/genai` for AI tools (requires `GEMINI_API_KEY`)

## System dependencies

- Node 20+
- `qpdf` — `pkg install qpdf`
- `ghostscript` — `pkg install ghostscript`

## Quality notes (closed gaps with iLovePDF)

- **Compress** now uses Ghostscript (`-dPDFSETTINGS=/screen|/ebook|/printer`),
  not Jimp. Smoke test: 28 KB test PDF with a 1600×1200 JPEG → **4.6 KB** on
  high (**84 % reduction**).
- **Word / Excel / HTML → PDF** have a browser engine mode: `mammoth` /
  SheetJS → styled iframe → html2canvas → jsPDF. The browser does the actual
  CSS layout, so output preserves fonts, colors, images, tables, borders —
  anything a browser renders. The server pipeline remains as fallback.
- **Scan to PDF** uses jscanify + OpenCV.js for live edge detection,
  perspective correction, and B&W enhance.
- **Crop PDF** has visual draggable handles with a live PDF preview.
- **OCR (server)** pre-processes images in Jimp (grayscale + contrast + 2×
  upscale on small images) before Tesseract, boosting accuracy on noisy scans.
- **Compare PDF** has a new visual-diff mode (pixel XOR with changed regions
  highlighted red) alongside the text-level LCS diff.
- **Sign (PKI)** accepts a user-supplied cert + key (PEM) instead of our
  self-signed one, so chain validation works in Adobe out of the box.
- **UI translated into 25 languages** (added ru, pl, nl, tr, ko, vi, th, id,
  fa, uk, ro, sv, cs, el, he). Arabic, Hebrew, and Persian get RTL layout.

## Known trade-offs

- **Office conversions** preserve text, headings, lists, tables, and
  embedded images; complex layouts and custom fonts don't carry over.
- **Translate PDF** renders output in Helvetica — characters outside WinAnsi
  (CJK, Devanagari, Arabic script) get stripped. Use the `.txt` output for
  non-Latin targets.
- **PKI signing** uses a self-signed certificate generated on first run.
  Adobe Reader shows the signature as cryptographically valid but with an
  untrusted chain. Download the cert at `/api/sign-pki/cert` and import it
  into Adobe's trust store to see signatures as fully trusted.
- **OCR (server)** currently only reads DCT (JPEG)-encoded image XObjects
  directly. Flate/PNG-encoded scans fall through to the browser OCR tool.
