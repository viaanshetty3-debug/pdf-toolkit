// Integration smoke test — hits every route end-to-end on a live server.
// Usage:  node test/smoke.js [base-url]      (default http://localhost:5174)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const BASE = process.argv[2] || 'http://localhost:5174';
const results = [];
let pass = 0, fail = 0;

function record(name, ok, info = '') {
  const line = `${ok ? '\u2713' : '\u2717'} ${name}${info ? ' — ' + info : ''}`;
  console.log(line);
  if (ok) pass++; else fail++;
  results.push({ name, ok, info });
}

async function assertStatus(name, url, opts = {}, expected = 200) {
  try {
    const r = await fetch(url, opts);
    const ok = r.status === expected;
    record(name, ok, `${r.status} ${r.headers.get('x-engine') || ''}`.trim());
    return r;
  } catch (e) {
    record(name, false, e.message);
    return null;
  }
}

async function makeTestPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([400, 500]);
  p.drawText('Hello from smoke test', { x: 50, y: 400, size: 16, font });
  p.drawText('Line two', { x: 50, y: 370, size: 12, font });
  return Buffer.from(await doc.save());
}

function pdfFile(bytes, name = 'test.pdf') {
  return new File([bytes], name, { type: 'application/pdf' });
}

async function run() {
  console.log(`\nTesting ${BASE}\n`);
  const pdf = await makeTestPdf();
  mkdirSync('tmp', { recursive: true });

  // Health
  await assertStatus('health', `${BASE}/api/health`);

  // Core organize/edit tools (one representative per family).
  const form = (fields) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return fd;
  };

  await assertStatus('rotate', `${BASE}/api/rotate`,
    { method: 'POST', body: form({ file: pdfFile(pdf), angle: '90' }) });
  await assertStatus('crop', `${BASE}/api/crop`,
    { method: 'POST', body: form({ file: pdfFile(pdf), top: '10', right: '10', bottom: '10', left: '10' }) });
  await assertStatus('watermark', `${BASE}/api/watermark`,
    { method: 'POST', body: form({ file: pdfFile(pdf), text: 'DRAFT' }) });
  await assertStatus('pagenum', `${BASE}/api/pagenum`,
    { method: 'POST', body: form({ file: pdfFile(pdf), position: 'bottom-center' }) });
  await assertStatus('compress-low', `${BASE}/api/compress`,
    { method: 'POST', body: form({ file: pdfFile(pdf), level: 'low' }) });
  await assertStatus('repair', `${BASE}/api/repair`,
    { method: 'POST', body: form({ file: pdfFile(pdf) }) });
  await assertStatus('resize', `${BASE}/api/resize`,
    { method: 'POST', body: form({ file: pdfFile(pdf), preset: 'a4' }) });
  await assertStatus('pdf-to-word', `${BASE}/api/pdf-to-word`,
    { method: 'POST', body: form({ file: pdfFile(pdf) }) });
  await assertStatus('pdf-to-excel', `${BASE}/api/pdf-to-excel`,
    { method: 'POST', body: form({ file: pdfFile(pdf) }) });
  await assertStatus('pdf-to-ppt', `${BASE}/api/pdf-to-ppt`,
    { method: 'POST', body: form({ file: pdfFile(pdf) }) });

  // Security
  const protectResp = await assertStatus('protect', `${BASE}/api/protect`,
    { method: 'POST', body: form({ file: pdfFile(pdf), userPassword: 'p' }) });
  if (protectResp && protectResp.ok) {
    const protBuf = Buffer.from(await protectResp.arrayBuffer());
    await assertStatus('unlock', `${BASE}/api/unlock`,
      { method: 'POST', body: form({ file: pdfFile(protBuf), password: 'p' }) });
  }
  await assertStatus('sign-pki', `${BASE}/api/sign-pki`,
    { method: 'POST', body: form({ file: pdfFile(pdf), name: 'test' }) });
  await assertStatus('redact', `${BASE}/api/redact`,
    { method: 'POST', body: form({ file: pdfFile(pdf), boxes: '[{"page":0,"x":50,"y":50,"w":80,"h":20}]', mode: 'true' }) });

  // Text editing
  await assertStatus('text-edit/find', `${BASE}/api/text-edit/find`,
    { method: 'POST', body: form({ file: pdfFile(pdf), query: 'Hello' }) });
  await assertStatus('text-edit/replace', `${BASE}/api/text-edit/replace`,
    { method: 'POST', body: form({ file: pdfFile(pdf), query: 'Hello', replacement: 'Hi' }) });

  // AI status
  await assertStatus('ai/status', `${BASE}/api/ai/status`);

  // Auth round trip
  const email = `smoke-${Date.now()}@test.local`;
  const regResp = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password-very-long' }),
  });
  record('auth/register', regResp.ok, regResp.status);
  const cookie = regResp.headers.get('set-cookie')?.split(';')[0] || '';
  const meResp = await fetch(`${BASE}/api/auth/me`, { headers: { cookie } });
  record('auth/me', meResp.ok, (await meResp.json()).email);

  // History
  const histForm = new FormData();
  histForm.append('blob', pdfFile(pdf));
  histForm.append('tool', 'smoke-test');
  histForm.append('filename', 'smoke.pdf');
  await assertStatus('history add', `${BASE}/api/history`, { method: 'POST', headers: { cookie }, body: histForm });
  await assertStatus('history list', `${BASE}/api/history`, { headers: { cookie } });

  // Share
  const shareForm = new FormData();
  shareForm.append('file', pdfFile(pdf));
  const shareResp = await fetch(`${BASE}/api/share/create`, { method: 'POST', headers: { cookie }, body: shareForm });
  if (shareResp.ok) {
    const { token } = await shareResp.json();
    record('share/create', true, token.slice(0, 10) + '...');
    await assertStatus('share/download', `${BASE}/api/share/${token}`);
  } else record('share/create', false, shareResp.status);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

run();
