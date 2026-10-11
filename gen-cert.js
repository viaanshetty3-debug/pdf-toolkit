import selfsigned from 'selfsigned';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const attrs = [{ name: 'commonName', value: 'localhost' }];
const pem = await selfsigned.generate(attrs, { days: 365 });

fs.writeFileSync(path.join(__dirname, 'key.pem'), pem.private);
fs.writeFileSync(path.join(__dirname, 'cert.pem'), pem.cert);

console.log('HTTPS certificate generated: cert.pem and key.pem');
