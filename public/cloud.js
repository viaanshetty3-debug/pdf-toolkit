// Google Drive + Dropbox pickers. Both use the official hosted JS libraries
// (gapi + dropins), not npm packages. The user supplies OAuth app IDs via
// GET /api/cloud-config so this module stays config-free.

let config = null;
let gapiLoaded = false;

async function loadConfig() {
  if (config) return config;
  try {
    const r = await fetch('/api/cloud-config');
    config = await r.json();
  } catch {
    config = { google: null, dropbox: null };
  }
  return config;
}

export async function cloudConfigured() {
  const c = await loadConfig();
  return { google: !!c.google?.clientId, dropbox: !!c.dropbox?.appKey };
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

/* ============================================================
   Google Drive picker
   ============================================================ */

async function initGapi() {
  if (gapiLoaded) return;
  await loadScript('https://apis.google.com/js/api.js');
  await loadScript('https://accounts.google.com/gsi/client');
  await new Promise(r => window.gapi.load('picker', r));
  gapiLoaded = true;
}

/**
 * Open Google Drive picker, let user choose a PDF, download via Drive API,
 * resolve with a File object compatible with the tool's dropzone.
 */
export async function pickFromDrive() {
  const c = await loadConfig();
  if (!c.google?.clientId || !c.google?.apiKey) {
    throw new Error('Google Drive is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_API_KEY in the server env.');
  }
  await initGapi();
  const token = await new Promise((resolve, reject) => {
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: c.google.clientId,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      callback: (resp) => resp.access_token ? resolve(resp.access_token) : reject(new Error('Access denied')),
    });
    tc.requestAccessToken({ prompt: '' });
  });

  const picked = await new Promise((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setMimeTypes('application/pdf,image/png,image/jpeg')
      .setSelectFolderEnabled(false);
    const picker = new google.picker.PickerBuilder()
      .enableFeature(google.picker.Feature.NAV_HIDDEN)
      .setOAuthToken(token)
      .setDeveloperKey(c.google.apiKey)
      .addView(view)
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) resolve(data.docs[0]);
        else if (data.action === google.picker.Action.CANCEL) resolve(null);
      })
      .build();
    picker.setVisible(true);
  });
  if (!picked) return null;

  const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${picked.id}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`Drive download failed: ${resp.status}`);
  const blob = await resp.blob();
  return new File([blob], picked.name, { type: picked.mimeType || 'application/pdf' });
}

/* ============================================================
   Dropbox Chooser
   ============================================================ */

export async function pickFromDropbox() {
  const c = await loadConfig();
  if (!c.dropbox?.appKey) {
    throw new Error('Dropbox is not configured. Set DROPBOX_APP_KEY in the server env.');
  }
  // Chooser.js auto-injects when added. Set the data-app-key.
  if (!window.Dropbox) {
    const s = document.createElement('script');
    s.src = 'https://www.dropbox.com/static/api/2/dropins.js';
    s.id = 'dropboxjs';
    s.setAttribute('data-app-key', c.dropbox.appKey);
    document.head.appendChild(s);
    await new Promise(resolve => s.onload = resolve);
  }

  const picked = await new Promise((resolve) => {
    window.Dropbox.choose({
      linkType: 'direct',
      multiselect: false,
      extensions: ['.pdf', '.png', '.jpg', '.jpeg', '.docx', '.xlsx', '.pptx'],
      success: files => resolve(files[0]),
      cancel: () => resolve(null),
    });
  });
  if (!picked) return null;

  const resp = await fetch(picked.link);
  if (!resp.ok) throw new Error(`Dropbox download failed: ${resp.status}`);
  const blob = await resp.blob();
  return new File([blob], picked.name, { type: blob.type || 'application/pdf' });
}

/**
 * Attach cloud buttons to a tool's dropzone. Pass a callback that receives
 * the picked File and feeds it into the tool's existing upload flow.
 */
export async function attachCloudButtons(dropzoneEl, onFile) {
  const { google: hasG, dropbox: hasD } = await cloudConfigured();
  if (!hasG && !hasD) return;
  const row = document.createElement('div');
  row.className = 'row';
  row.style.cssText = 'justify-content: center; gap: 8px; margin-top: 12px;';
  row.innerHTML = `
    ${hasG ? `<button type="button" class="btn ghost" data-cloud="drive">📁 Google Drive</button>` : ''}
    ${hasD ? `<button type="button" class="btn ghost" data-cloud="dropbox">📦 Dropbox</button>` : ''}
  `;
  dropzoneEl.appendChild(row);
  row.querySelectorAll('[data-cloud]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();  // don't open file picker
      btn.disabled = true;
      try {
        const file = btn.dataset.cloud === 'drive' ? await pickFromDrive() : await pickFromDropbox();
        if (file) onFile(file);
      } catch (err) {
        (await import('/common.js')).toast(err.message, 'err');
      } finally { btn.disabled = false; }
    });
  });
}
