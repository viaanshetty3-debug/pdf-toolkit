// Service worker — provides offline support for the app shell. Strategy is
// NETWORK-FIRST for same-origin GETs so freshly-shipped code reaches users
// immediately; cache is only used as a fallback when the network is down.

const VERSION = 'pdftk-v3';
const SHELL = [
  '/',
  '/styles.css',
  '/common.js',
  '/_single-file.js',
  '/pdf-thumbs.js',
  '/i18n.js',
  '/history.js',
  '/manifest.webmanifest',
  '/icon-192.svg',
  '/icon-512.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
    // Nudge all open tabs to reload so they pick up fresh assets immediately.
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const c of clients) {
      c.postMessage({ kind: 'pdftk-sw-updated' });
    }
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Never intercept API calls.
  if (url.pathname.startsWith('/api/')) return;
  // Web Share Target: POSTs land here as multipart.
  if (url.pathname === '/share-target.html' && e.request.method === 'POST') {
    e.respondWith(handleShareTarget(e.request));
    return;
  }
  if (e.request.method !== 'GET') return;

  const isSameOrigin = url.origin === self.location.origin;
  const isShellAsset = isSameOrigin && (/\.(html|js|css|svg|webmanifest|json)$/.test(url.pathname) || url.pathname === '/');

  if (isShellAsset) {
    // Network-first: always try fresh code, fall back to cache on failure.
    e.respondWith((async () => {
      try {
        const resp = await fetch(e.request, { cache: 'no-cache' });
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(VERSION).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return resp;
      } catch (err) {
        const cached = await caches.match(e.request);
        if (cached) return cached;
        throw err;
      }
    })());
    return;
  }

  // Non-shell GETs (external CDN, images): cache-first, async refresh.
  e.respondWith((async () => {
    const cached = await caches.match(e.request);
    if (cached) return cached;
    try { return await fetch(e.request); } catch (err) { return cached || Response.error(); }
  })());
});

async function handleShareTarget(request) {
  try {
    const form = await request.formData();
    const file = form.getAll('files')[0] || form.get('file');
    if (file && file instanceof File) {
      const base64 = await blobToBase64(file);
      const payload = { name: file.name, type: file.type || 'application/pdf', base64 };
      const clients = await self.clients.matchAll({ type: 'window' });
      const client = clients[0];
      const url = '/share-target.html';
      if (client) {
        client.postMessage({ kind: 'pdftk-share', payload });
        return Response.redirect(url, 303);
      }
      await caches.open('pdftk-share').then(c => c.put('/__share-payload', new Response(JSON.stringify(payload))));
      return Response.redirect(url, 303);
    }
  } catch {}
  return Response.redirect('/', 303);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
