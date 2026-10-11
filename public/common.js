// Shared helpers + chrome used by every tool page.

import { initI18n, setLang, getLang, t, LANGUAGES } from '/i18n.js';
import { recordHistory } from '/history.js';
export { t, setLang, getLang } from '/i18n.js';
export { recordHistory, getHistory, clearHistory, deleteHistoryEntry } from '/history.js';

/* ============================================================
   Icon library (Lucide SVGs, inlined for zero-latency rendering)
   ============================================================ */

const ICONS = {
  merge: '<path d="M6 3v12"/><path d="m21 12-7-5v10l7-5Z"/><path d="M6 15a6 6 0 0 0 6 6h3"/><circle cx="6" cy="19" r="3"/><circle cx="6" cy="3" r="1"/>',
  split: '<path d="M14.5 17.5 4.5 6.5"/><path d="M6 18 20 4"/><path d="m22 2-1.5 1.5"/><path d="M3.5 14.5 2 16"/><circle cx="9" cy="15" r="3"/><circle cx="15" cy="9" r="3"/>',
  'file-minus': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/>',
  'file-output': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M2 15h10"/><path d="m5 12-3 3 3 3"/>',
  layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  'scan-line': '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
  'file-archive': '<path d="M10 12v-1"/><path d="M10 18v-2"/><path d="M10 7V6"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M15.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h2.5"/><circle cx="10" cy="20" r="2"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  'scan-eye': '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="1"/><path d="M18.944 12.33a1 1 0 0 0 0-.66 7.5 7.5 0 0 0-13.888 0 1 1 0 0 0 0 .66 7.5 7.5 0 0 0 13.888 0"/>',
  'image-plus': '<path d="M16 5h6"/><path d="M19 2v6"/><path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/><circle cx="9" cy="9" r="2"/>',
  'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  table: '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
  presentation: '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>',
  code: '<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  'rotate-cw': '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  hash: '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
  droplet: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  'form-input': '<rect width="20" height="12" x="2" y="6" rx="2"/><path d="M12 12h.01"/><path d="M17 12h.01"/><path d="M7 12h.01"/>',
  unlock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'pen-tool': '<path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z"/><path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18"/><path d="m2.3 2.3 7.286 7.286"/><circle cx="11" cy="11" r="2"/>',
  'eye-off': '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  'git-compare': '<circle cx="5" cy="6" r="3"/><path d="M12 6h5a2 2 0 0 1 2 2v7"/><path d="m15 9-3-3 3-3"/><circle cx="19" cy="18" r="3"/><path d="M12 18H7a2 2 0 0 1-2-2V9"/><path d="m9 15 3 3-3 3"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
  languages: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
  'file-code': '<path d="M10 12.5 8 15l2 2.5"/><path d="m14 12.5 2 2.5-2 2.5"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>',
  // Chrome icons
  'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  'arrow-up-right': '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  'upload-cloud': '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m16 16-4-4-4 4"/>',
};

export function icon(name, size = 20) {
  const path = ICONS[name];
  if (!path) return '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

/* ============================================================
   Tools catalog
   ============================================================ */

export const TOOLS = [
  { slug: 'merge',        name: 'Merge PDF',        icon: 'merge',          cat: 'Organize', desc: 'Combine multiple PDFs into a single document in your preferred order.' },
  { slug: 'split',        name: 'Split PDF',        icon: 'split',          cat: 'Organize', desc: 'Split by page range, every N pages, or extract a slice.' },
  { slug: 'remove',       name: 'Remove Pages',     icon: 'file-minus',     cat: 'Organize', desc: 'Delete specific pages from a PDF while keeping the rest intact.' },
  { slug: 'extract',      name: 'Extract Pages',    icon: 'file-output',    cat: 'Organize', desc: 'Pull selected pages into a brand new PDF, preserving order.' },
  { slug: 'organize',     name: 'Organize PDF',     icon: 'layers',         cat: 'Organize', desc: 'Reorder, rotate, and delete pages visually with drag-and-drop.' },
  { slug: 'scan',         name: 'Scan to PDF',      icon: 'scan-line',      cat: 'Organize', desc: 'Capture pages with your camera and assemble them into a PDF.' },

  { slug: 'compress',     name: 'Compress PDF',     icon: 'file-archive',   cat: 'Optimize', desc: 'Shrink file size with three quality presets.' },
  { slug: 'repair',       name: 'Repair PDF',       icon: 'wrench',         cat: 'Optimize', desc: 'Rebuild broken cross-reference tables and recover damaged PDFs.' },
  { slug: 'ocr',          name: 'OCR PDF',          icon: 'scan-eye',       cat: 'Optimize', desc: 'Run OCR in your browser and embed a searchable text layer.' },

  { slug: 'jpg-to-pdf',   name: 'JPG to PDF',       icon: 'image-plus',     cat: 'Convert to PDF', desc: 'Combine JPG and PNG images into a single PDF document.' },
  { slug: 'word-to-pdf',  name: 'Word to PDF',      icon: 'file-text',      cat: 'Convert to PDF', desc: 'Convert .docx files to PDF with headings, lists, and tables.' },
  { slug: 'excel-to-pdf', name: 'Excel to PDF',     icon: 'table',          cat: 'Convert to PDF', desc: 'Convert spreadsheets to PDF, one page per sheet.' },
  { slug: 'ppt-to-pdf',   name: 'PowerPoint to PDF',icon: 'presentation',   cat: 'Convert to PDF', desc: 'Convert .pptx slide decks to PDF, one page per slide.' },
  { slug: 'html-to-pdf',  name: 'HTML to PDF',      icon: 'code',           cat: 'Convert to PDF', desc: 'Render HTML into a clean, text-based PDF document.' },

  { slug: 'pdf-to-jpg',   name: 'PDF to JPG',       icon: 'image',          cat: 'Convert from PDF', desc: 'Export every page as a JPEG image, packaged into a ZIP.' },
  { slug: 'pdf-to-word',  name: 'PDF to Word',      icon: 'file-text',      cat: 'Convert from PDF', desc: 'Create an editable .docx with the extracted PDF text.' },
  { slug: 'pdf-to-ppt',   name: 'PDF to PowerPoint',icon: 'presentation',   cat: 'Convert from PDF', desc: 'One slide per PDF page with the extracted text, ready to edit.' },
  { slug: 'pdf-to-excel', name: 'PDF to Excel',     icon: 'table',          cat: 'Convert from PDF', desc: 'Detect columns in each PDF page and build a spreadsheet.' },
  { slug: 'pdf-to-pdfa',  name: 'PDF to PDF/A',     icon: 'archive',        cat: 'Convert from PDF', desc: 'Produce an archival PDF/A-2b (via Ghostscript).' },

  { slug: 'rotate',       name: 'Rotate PDF',       icon: 'rotate-cw',      cat: 'Edit', desc: 'Rotate all or specific pages by 90°, 180°, or 270°.' },
  { slug: 'pagenum',      name: 'Page Numbers',     icon: 'hash',           cat: 'Edit', desc: 'Add page numbers with custom position, format, and starting number.' },
  { slug: 'watermark',    name: 'Watermark',        icon: 'droplet',        cat: 'Edit', desc: 'Overlay text or image watermark across every page.' },
  { slug: 'crop',         name: 'Crop PDF',         icon: 'crop',           cat: 'Edit', desc: 'Trim page margins uniformly across the document.' },
  { slug: 'edit',         name: 'Edit PDF',         icon: 'pencil',         cat: 'Edit', desc: 'Add text, images, and shapes anywhere on your pages.' },
  { slug: 'forms',        name: 'PDF Forms',        icon: 'form-input',     cat: 'Edit', desc: 'Fill PDF form fields and flatten them for sharing.' },

  { slug: 'unlock',       name: 'Unlock PDF',       icon: 'unlock',         cat: 'Security', desc: 'Remove a password from an encrypted PDF (requires the password).' },
  { slug: 'protect',      name: 'Protect PDF',      icon: 'lock',           cat: 'Security', desc: 'Add password protection with AES-256 encryption.' },
  { slug: 'sign',         name: 'Sign PDF',         icon: 'pen-tool',       cat: 'Security', desc: 'Stamp a signature image onto any page.' },
  { slug: 'redact',       name: 'Redact PDF',       icon: 'eye-off',        cat: 'Security', desc: 'Cover sensitive regions with opaque rectangles.' },
  { slug: 'compare',      name: 'Compare PDF',      icon: 'git-compare',    cat: 'Security', desc: 'Highlight text differences between two PDFs.' },

  { slug: 'summarize',    name: 'AI Summarizer',    icon: 'sparkles',       cat: 'PDF Intelligence', desc: 'Get a concise, faithful summary of any PDF.' },
  { slug: 'translate',    name: 'Translate PDF',    icon: 'languages',      cat: 'PDF Intelligence', desc: 'Translate a PDF into any language.' },
  { slug: 'markdown',     name: 'PDF to Markdown',  icon: 'file-code',      cat: 'PDF Intelligence', desc: 'Reconstruct Markdown structure (headings, lists) from a PDF.' },

  { slug: 'resize',       name: 'Resize PDF',       icon: 'crop',           cat: 'Edit',             desc: 'Change the page dimensions (A4, Letter, custom) with no distortion.' },
  { slug: 'create-forms', name: 'Create PDF Forms', icon: 'form-input',     cat: 'Edit',             desc: 'Draw fillable form fields onto any PDF.' },
  { slug: 'viewer',       name: 'PDF Viewer',       icon: 'search',         cat: 'Organize',         desc: 'Open and read PDFs with zoom, search, and text selection.' },
  { slug: 'batch',        name: 'Batch Processing', icon: 'layers',         cat: 'Organize',         desc: 'Apply one tool to many files at once. Download results as a ZIP.' },
  { slug: 'workflow',     name: 'Workflow',         icon: 'git-compare',    cat: 'Organize',         desc: 'Chain tools: compress \u2192 watermark \u2192 protect in a single pass.' },
  { slug: 'text-edit',    name: 'Edit Existing Text', icon: 'pencil',       cat: 'Edit',             desc: 'Find & replace text already in your PDF \u2014 fix typos, update terms, redact phrases.' },
];

export const CATEGORIES = [
  { name: 'Organize',          colorVar: '--cat-organize' },
  { name: 'Optimize',          colorVar: '--cat-optimize' },
  { name: 'Convert to PDF',    colorVar: '--cat-to-pdf' },
  { name: 'Convert from PDF',  colorVar: '--cat-from-pdf' },
  { name: 'Edit',              colorVar: '--cat-edit' },
  { name: 'Security',          colorVar: '--cat-security' },
  { name: 'PDF Intelligence',  colorVar: '--cat-ai' },
];

export function toolsByCategory() {
  const map = new Map(CATEGORIES.map(c => [c.name, []]));
  for (const t of TOOLS) map.get(t.cat).push(t);
  return map;
}

function catColorVar(name) {
  return CATEGORIES.find(c => c.name === name)?.colorVar || '--accent';
}

function currentSlug() {
  const path = location.pathname.replace(/^\/|\.html$/g, '');
  return path || 'index';
}

/* ============================================================
   Theme toggle
   ============================================================ */

export function initTheme() {
  const stored = localStorage.getItem('theme');
  if (stored) document.documentElement.setAttribute('data-theme', stored);
}

function toggleTheme() {
  const curr = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = curr === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  // Update toggle icon.
  const btn = document.querySelector('[data-theme-toggle]');
  if (btn) btn.innerHTML = icon(next === 'dark' ? 'moon' : 'sun', 16);
}

/* ============================================================
   Nav + chrome
   ============================================================ */

export function renderNav() {
  initI18n();
  initTheme();
  registerSW();
  injectPwaMeta();
  const slug = currentSlug();
  const header = document.querySelector('header.topnav');
  if (!header) return;
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  header.innerHTML = `
    <a href="/" class="brand">
      <span class="logo">P</span>
      <span>PDF Toolkit <small>· ${t('brand.tagline')}</small></span>
    </a>
    <div class="navbar-right">
      <button type="button" data-palette-trigger title="${t('nav.findTool')}">
        ${icon('search', 14)} ${t('nav.findTool')} <span class="kbd">⌘K</span>
      </button>
      <button type="button" data-lang title="${t('nav.language')}">
        ${LANGUAGES.find(l => l.code === getLang())?.flag || '🌐'} ${getLang().toUpperCase()}
      </button>
      <button type="button" data-theme-toggle title="${t('nav.theme')}">
        ${icon(current === 'dark' ? 'moon' : 'sun', 16)}
      </button>
      <a href="/">${t('nav.allTools')}</a>
    </div>
  `;
  header.querySelector('[data-theme-toggle]').addEventListener('click', toggleTheme);
  header.querySelector('[data-palette-trigger]').addEventListener('click', openPalette);
  header.querySelector('[data-lang]').addEventListener('click', openLangPicker);

  // Global shortcuts
  if (!window.__pdftkShortcuts) {
    window.__pdftkShortcuts = true;
    window.addEventListener('keydown', e => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        openPalette();
      }
      if (e.key === 'Escape') closePalette();
    });
  }

  // On tool pages, inject chrome (breadcrumb + tool header + related footer).
  if (slug !== 'index') injectToolChrome(slug);

  // Site footer on every page.
  if (!document.querySelector('footer.site-footer')) {
    const footer = document.createElement('footer');
    footer.className = 'site-footer';
    footer.innerHTML = `
      <div class="footer-row">
        <span>PDF Toolkit · ${t('footer.local')}</span>
        <span>
          <a href="/">${t('nav.allTools')}</a>
        </span>
      </div>
    `;
    document.body.appendChild(footer);
  }
}

function openLangPicker() {
  if (document.querySelector('.palette-mask')) return;
  const mask = document.createElement('div');
  mask.className = 'palette-mask';
  mask.innerHTML = `
    <div class="palette" role="dialog" aria-label="${t('nav.language')}">
      <div class="palette-list" style="max-height: 60vh; padding: 10px;">
        ${LANGUAGES.map(l => `
          <div class="palette-item" data-code="${l.code}" ${l.code === getLang() ? 'aria-selected="true"' : ''}>
            <span style="font-size: 20px;">${l.flag}</span>
            <div class="text"><div class="name">${l.name}</div><div class="cat">${l.code.toUpperCase()}</div></div>
            ${l.code === getLang() ? `<span class="enter">${icon('check', 14)}</span>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `;
  mask.addEventListener('click', e => { if (e.target === mask) mask.remove(); });
  document.body.appendChild(mask);
  mask.querySelectorAll('[data-code]').forEach(el => el.addEventListener('click', () => {
    setLang(el.dataset.code);
    location.reload();
  }));
}

function injectToolChrome(slug) {
  const tool = TOOLS.find(t => t.slug === slug);
  if (!tool) return;
  const main = document.querySelector('main');
  if (!main) return;
  // Set category color scope on main.
  main.style.setProperty('--cat', `var(${catColorVar(tool.cat)})`);

  // Breadcrumb + tool header replace the existing <h1>/<p class="subtitle"> block
  // if present. Otherwise, prepend.
  const existingH1 = main.querySelector(':scope > h1');
  const existingSubtitle = existingH1?.nextElementSibling?.classList.contains('subtitle')
    ? existingH1.nextElementSibling : null;
  const title = tool.name;
  const description = existingSubtitle ? existingSubtitle.textContent : tool.desc;

  const chrome = document.createElement('div');
  chrome.innerHTML = `
    <nav class="breadcrumb">
      <a href="/">PDF Toolkit</a>
      <span class="sep">${icon('arrow-right', 12)}</span>
      <a href="/#${slug}">${escapeHtml(tool.cat)}</a>
      <span class="sep">${icon('arrow-right', 12)}</span>
      <span class="current">${escapeHtml(title)}</span>
    </nav>
    <header class="tool-header">
      <div class="icon">${icon(tool.icon, 24)}</div>
      <div class="title">
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(description)}</p>
      </div>
    </header>
  `;

  if (existingH1) {
    main.insertBefore(chrome, existingH1);
    existingH1.remove();
    existingSubtitle?.remove();
  } else {
    main.insertBefore(chrome, main.firstChild);
  }

  // Related tools footer: pick up to 5 others in the same category.
  const related = TOOLS.filter(t => t.cat === tool.cat && t.slug !== slug).slice(0, 5);
  if (related.length) {
    const section = document.createElement('section');
    section.className = 'related';
    section.innerHTML = `
      <h3>More ${escapeHtml(tool.cat.toLowerCase())} tools</h3>
      <div class="related-row">
        ${related.map(t => `
          <a class="related-item" href="/${t.slug}.html" style="--cat: var(${catColorVar(t.cat)})">
            <div class="icon">${icon(t.icon, 15)}</div>
            <div class="text">
              <div class="name">${escapeHtml(t.name)}</div>
              <div class="cat">${escapeHtml(t.cat)}</div>
            </div>
          </a>
        `).join('')}
      </div>
    `;
    main.appendChild(section);
  }
}

/* ============================================================
   Command palette (⌘K)
   ============================================================ */

let paletteSelectedIndex = 0;
let paletteFiltered = [];

function openPalette() {
  if (document.querySelector('.palette-mask')) return;
  const mask = document.createElement('div');
  mask.className = 'palette-mask';
  mask.innerHTML = `
    <div class="palette" role="dialog" aria-label="Find a tool">
      <input type="text" class="palette-input" placeholder="Search 33 tools..." autofocus />
      <div class="palette-list" id="palette-list"></div>
      <div class="palette-footer">
        <span class="hint"><span class="kbd">↑</span><span class="kbd">↓</span> Navigate</span>
        <span class="hint"><span class="kbd">↵</span> Open · <span class="kbd">esc</span> Close</span>
      </div>
    </div>
  `;
  mask.addEventListener('click', e => { if (e.target === mask) closePalette(); });
  document.body.appendChild(mask);
  const input = mask.querySelector('.palette-input');
  input.addEventListener('input', () => renderPalette(input.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); paletteSelectedIndex = Math.min(paletteFiltered.length - 1, paletteSelectedIndex + 1); updatePaletteSelection(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); paletteSelectedIndex = Math.max(0, paletteSelectedIndex - 1); updatePaletteSelection(); }
    else if (e.key === 'Enter') { e.preventDefault(); const t = paletteFiltered[paletteSelectedIndex]; if (t) location.href = `/${t.slug}.html`; }
  });
  renderPalette('');
  setTimeout(() => input.focus(), 10);
}

function closePalette() {
  const mask = document.querySelector('.palette-mask');
  if (mask) mask.remove();
}

function renderPalette(query) {
  const q = query.trim().toLowerCase();
  const matches = q
    ? TOOLS.filter(t =>
        t.name.toLowerCase().includes(q) ||
        t.desc.toLowerCase().includes(q) ||
        t.cat.toLowerCase().includes(q) ||
        t.slug.includes(q))
    : TOOLS;
  paletteFiltered = matches;
  paletteSelectedIndex = 0;
  const list = document.getElementById('palette-list');
  if (!list) return;
  if (matches.length === 0) {
    list.innerHTML = `<div class="palette-empty">No tools matching "${escapeHtml(query)}"</div>`;
    return;
  }
  list.innerHTML = matches.map((t, i) => `
    <div class="palette-item" data-slug="${t.slug}" style="--cat: var(${catColorVar(t.cat)})" ${i === 0 ? 'aria-selected="true"' : ''}>
      <div class="icon">${icon(t.icon, 14)}</div>
      <div class="text">
        <div class="name">${escapeHtml(t.name)}</div>
        <div class="cat">${escapeHtml(t.cat)}</div>
      </div>
      ${i === 0 ? '<span class="enter">↵</span>' : ''}
    </div>
  `).join('');
  list.querySelectorAll('.palette-item').forEach(el => {
    el.addEventListener('click', () => location.href = `/${el.dataset.slug}.html`);
    el.addEventListener('mouseenter', () => {
      paletteSelectedIndex = [...list.children].indexOf(el);
      updatePaletteSelection();
    });
  });
}

function updatePaletteSelection() {
  const list = document.getElementById('palette-list');
  if (!list) return;
  [...list.children].forEach((el, i) => {
    el.setAttribute('aria-selected', String(i === paletteSelectedIndex));
    if (i === paletteSelectedIndex) el.scrollIntoView({ block: 'nearest' });
  });
}

/* ============================================================
   Toasts
   ============================================================ */

export function toast(message, kind = '') {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = message;
  wrap.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .3s, transform .3s';
    t.style.opacity = '0';
    t.style.transform = 'translateX(20px)';
    setTimeout(() => t.remove(), 300);
  }, 3500);
}

/* ============================================================
   Dropzone
   ============================================================ */

export function makeDropzone(el, { multiple = false, accept = 'application/pdf' } = {}) {
  const input = el.querySelector('input[type=file]');
  input.multiple = multiple;
  input.accept = accept;
  let handler = () => {};
  const emit = files => {
    const arr = Array.from(files);
    const list = accept ? arr.filter(f => accept.split(',').some(a => f.type === a.trim())) : arr;
    handler(list.length ? list : arr);
  };
  el.addEventListener('click', () => input.click());
  input.addEventListener('change', () => emit(input.files));
  ['dragover', 'dragenter'].forEach(ev => el.addEventListener(ev, e => {
    e.preventDefault(); el.classList.add('hover');
  }));
  ['dragleave', 'drop'].forEach(ev => el.addEventListener(ev, e => {
    e.preventDefault(); el.classList.remove('hover');
  }));
  el.addEventListener('drop', e => emit(e.dataTransfer.files));
  return { setOnFiles(cb) { handler = cb; } };
}

/* ============================================================
   HTTP + download helpers
   ============================================================ */

export function postForm(url, formData, barEl) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.responseType = 'blob';
    if (barEl) {
      xhr.upload.onprogress = e => {
        if (e.lengthComputable) barEl.style.width = `${(e.loaded / e.total) * 60}%`;
      };
      xhr.onprogress = e => {
        barEl.style.width = `${60 + (e.loaded / Math.max(e.total, 1)) * 40}%`;
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (barEl) barEl.style.width = '100%';
        resolve({ blob: xhr.response, headers: xhr });
      } else {
        xhr.response.text().then(text => {
          try { reject(new Error(JSON.parse(text).error || text)); }
          catch { reject(new Error(text || `HTTP ${xhr.status}`)); }
        });
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(formData);
  });
}

export function downloadBlob(blob, filename) {
  // Record in history (non-blocking).
  try { recordHistory({ tool: currentSlug(), filename, blob }); } catch {}
  const skipPreview = localStorage.getItem('pdftk-skip-preview') === '1';
  const isPdf = blob.type === 'application/pdf' || /\.pdf$/i.test(filename);
  if (isPdf && !skipPreview) {
    // Fire-and-forget. If anything in the preview flow fails, fall back to
    // direct download so the user always gets their file.
    Promise.resolve()
      .then(() => showPreview(blob, filename))
      .catch(err => {
        console.warn('Preview failed, downloading directly:', err);
        doDownload(blob, filename);
      });
  } else {
    doDownload(blob, filename);
  }
}

function doDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ============================================================
   Preview modal (shown automatically for PDF outputs)
   ============================================================ */

function ensurePdfJs() {
  if (window.pdfjsLib) return Promise.resolve();
  return import('/pdfjs/pdf.min.mjs')
    .then(pdfModule => {
      window.pdfjsLib = pdfModule;
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
    });
}

function showPreview(blob, filename) {
  // Create the modal + download button SYNCHRONOUSLY, before loading pdf.js.
  // If pdf.js fails to load (offline, blocked CDN, etc.) the user still has
  // a working Download button — the preview is best-effort.
  const url = URL.createObjectURL(blob);
  const mask = document.createElement('div');
  mask.className = 'palette-mask preview-mask';
  mask.innerHTML = `
    <div class="preview-shell">
      <header class="preview-head">
        <input type="text" id="filename-input" value="${escapeHtml(filename)}" style="flex:1; padding:8px 12px; border:1px solid var(--border); border-radius:4px; font-weight:600; margin-right:10px;">
        <span class="pill">${humanSize(blob.size)}</span>
        <div class="spacer"></div>
        <label class="muted-check"><input type="checkbox" id="skip-pref"> Skip preview next time</label>
        <button class="btn secondary" data-close>Close</button>
        <button class="btn" data-download>Download</button>
      </header>
      <div class="preview-body" id="preview-body">
        <p style="padding:20px;color:var(--muted);text-align:center">Loading preview\u2026</p>
      </div>
    </div>
  `;
  document.body.appendChild(mask);
  const body = mask.querySelector('#preview-body');
  const downloadBtn = mask.querySelector('[data-download]');
  const filenameInput = mask.querySelector('#filename-input');

  const close = () => { try { URL.revokeObjectURL(url); } catch {} mask.remove(); window.removeEventListener('keydown', onKey); };
  const triggerDownload = () => {
    if (mask.querySelector('#skip-pref').checked) localStorage.setItem('pdftk-skip-preview', '1');
    doDownload(blob, filenameInput.value || filename);
    close();
  };
  function onKey(e) {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && document.body.contains(mask)) triggerDownload();
  }
  mask.querySelector('[data-close]').addEventListener('click', close);
  downloadBtn.addEventListener('click', triggerDownload);
  mask.addEventListener('click', e => { if (e.target === mask) close(); });
  window.addEventListener('keydown', onKey);

  // Load pdf.js lazily. If it fails, the Download button is still there and
  // the body shows an error message rather than breaking the flow.
  ensurePdfJs()
    .then(async () => {
      body.innerHTML = '';
      const pdf = await window.pdfjsLib.getDocument({ url }).promise;
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.4 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.className = 'preview-page';
        body.appendChild(canvas);
        page.render({ canvasContext: canvas.getContext('2d'), viewport });
      }
    })
    .catch(err => {
      body.innerHTML = `<p style="padding:20px;color:var(--muted);text-align:center">Preview unavailable (${escapeHtml(err.message || 'load failed')}). Hit <strong>Download</strong> to save the file.</p>`;
    });

  return Promise.resolve();  // caller never awaits; this is just a marker
}

export function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/* ============================================================
   Reorderable list
   ============================================================ */

export function makeReorderable(containerEl, onReorder) {
  let dragged = null;
  containerEl.addEventListener('dragstart', e => {
    const row = e.target.closest('[data-idx]');
    if (!row) return;
    dragged = row;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  containerEl.addEventListener('dragend', () => {
    if (dragged) dragged.classList.remove('dragging');
    dragged = null;
    onReorder([...containerEl.querySelectorAll('[data-idx]')].map(el => parseInt(el.dataset.idx, 10)));
  });
  containerEl.addEventListener('dragover', e => {
    e.preventDefault();
    const target = e.target.closest('[data-idx]');
    if (!target || target === dragged || !dragged) return;
    const rect = target.getBoundingClientRect();
    const after = (e.clientY - rect.top) / rect.height > 0.5;
    containerEl.insertBefore(dragged, after ? target.nextSibling : target);
  });
}

/* ============================================================
   Utils
   ============================================================ */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ============================================================
   PWA — service worker + manifest + mobile meta tags
   ============================================================ */

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').then(reg => {
    // When a new SW takes over, reload the page so the user gets fresh code.
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'activated' && navigator.serviceWorker.controller) {
          // A new worker claimed control — reload once to pick up fresh assets.
          if (!window.__pdftkReloadedForSW) {
            window.__pdftkReloadedForSW = true;
            location.reload();
          }
        }
      });
    });
    // Also listen for the broadcast we send from the SW on activation.
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.kind === 'pdftk-sw-updated' && !window.__pdftkReloadedForSW) {
        window.__pdftkReloadedForSW = true;
        location.reload();
      }
    });
  }).catch(() => {});
}

function injectPwaMeta() {
  const head = document.head;
  if (head.querySelector('link[rel="manifest"]')) return;  // already injected
  const add = (tag, attrs) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    head.appendChild(el);
  };
  add('link', { rel: 'manifest', href: '/manifest.webmanifest' });
  add('meta', { name: 'theme-color', content: '#09090c', media: '(prefers-color-scheme: dark)' });
  add('meta', { name: 'theme-color', content: '#fafafb', media: '(prefers-color-scheme: light)' });
  add('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
  add('meta', { name: 'apple-mobile-web-app-title', content: 'PDF Toolkit' });
  add('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' });
  add('link', { rel: 'apple-touch-icon', href: '/icon-192.svg' });
}
