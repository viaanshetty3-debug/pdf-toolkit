// Shared helper for tool pages that take a single file and submit it to an
// endpoint with no further configuration. Used by the simple convert tools.

import { renderNav, makeDropzone, postForm, downloadBlob, humanSize, toast } from '/common.js';

export function mountSingleFileTool({
  endpoint,
  outName,
  accept = 'application/pdf',
  acceptLabel = 'PDF',
  extraFields = () => ({}),
  responseType = 'blob',  // 'blob' | 'json' | 'text'
  onResponse = null,
  icon = '→',
}) {
  renderNav();
  const page = `
    <div class="dropzone" id="drop">
      <input type="file" />
      <div class="big">${icon}</div>
      <div><strong>Drop a ${acceptLabel}</strong> or click to browse</div>
    </div>
    <div id="loaded" class="hidden">
      <div class="card" style="margin-top: 20px;">
        <div class="row">
          <strong id="loadedname"></strong>
          <span class="pill" id="loadedsize"></span>
          <div class="spacer"></div>
          <button class="btn secondary" id="changefile">Change file</button>
        </div>
        <div id="formSlot"></div>
        <div class="progress hidden" id="progwrap"><div class="bar" id="bar"></div></div>
        <div class="row right" style="margin-top: 20px;">
          <button class="btn" id="go">Convert & Download</button>
        </div>
        <div id="resultSlot"></div>
      </div>
    </div>
  `;
  document.getElementById('tool').innerHTML = page;
  const dropEl = document.getElementById('drop');
  const loadedEl = document.getElementById('loaded');
  const bar = document.getElementById('bar');
  const progwrap = document.getElementById('progwrap');
  let file = null;

  const dz = makeDropzone(dropEl, { multiple: false, accept });
  dz.setOnFiles(arr => {
    if (!arr.length) return;
    file = arr[0];
    document.getElementById('loadedname').textContent = file.name;
    document.getElementById('loadedsize').textContent = humanSize(file.size);
    dropEl.classList.add('hidden');
    loadedEl.classList.remove('hidden');
  });
  document.getElementById('changefile').addEventListener('click', () => {
    file = null;
    dropEl.classList.remove('hidden');
    loadedEl.classList.add('hidden');
    document.getElementById('resultSlot').innerHTML = '';
  });

  document.getElementById('go').addEventListener('click', async () => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    const extra = extraFields();
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    progwrap.classList.remove('hidden'); bar.style.width = '0%';
    try {
      if (responseType === 'json') {
        const r = await fetch(endpoint, { method: 'POST', body: fd });
        bar.style.width = '100%';
        if (!r.ok) throw new Error((await r.json()).error);
        const data = await r.json();
        onResponse?.(data);
        toast('Done', 'ok');
      } else {
        const { blob, headers } = await postForm(endpoint, fd, bar);
        if (responseType === 'text') {
          const text = await blob.text();
          onResponse?.(text, headers);
        } else {
          downloadBlob(blob, outName);
          onResponse?.(blob, headers);
        }
        toast('Done', 'ok');
      }
    } catch (e) { toast(e.message, 'err'); }
    finally { setTimeout(() => progwrap.classList.add('hidden'), 800); }
  });

  return {
    getFormSlot: () => document.getElementById('formSlot'),
    getResultSlot: () => document.getElementById('resultSlot'),
  };
}
