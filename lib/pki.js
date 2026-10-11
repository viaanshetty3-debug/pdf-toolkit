// Self-signed X.509 + PKCS#7 CMS SignedData for PDF signing.
// Pure Node — only uses the built-in `crypto` module.

import crypto from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as A from './asn1.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const KEY_PATH = join(DATA_DIR, 'signer-key.pem');
const CERT_PATH = join(DATA_DIR, 'signer-cert.der');

/* ============================================================
   OIDs used throughout
   ============================================================ */

const OIDS = {
  rsaEncryption:         '1.2.840.113549.1.1.1',
  sha256WithRSA:         '1.2.840.113549.1.1.11',
  sha256:                '2.16.840.1.101.3.4.2.1',
  cn:                    '2.5.4.3',
  o:                     '2.5.4.10',
  c:                     '2.5.4.6',
  data:                  '1.2.840.113549.1.7.1',
  signedData:            '1.2.840.113549.1.7.2',
  contentType:           '1.2.840.113549.1.9.3',
  messageDigest:         '1.2.840.113549.1.9.4',
  signingTime:           '1.2.840.113549.1.9.5',
};

/* ============================================================
   Key + certificate (self-signed, lazy-created on first use)
   ============================================================ */

let signerCache = null;

export async function getSigner() {
  if (signerCache) return signerCache;
  await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(KEY_PATH) || !existsSync(CERT_PATH)) {
    await createSelfSignedCert();
  }
  const keyPem = await readFile(KEY_PATH, 'utf8');
  const certDer = await readFile(CERT_PATH);
  signerCache = {
    privateKey: crypto.createPrivateKey(keyPem),
    certDer,
    certInfo: parseCertSubject(certDer),
  };
  return signerCache;
}

/**
 * Build a signer identity from user-provided PEM key + PEM/DER cert bytes.
 * The returned object has the same shape as `getSigner()` so the same CMS
 * code path works for both self-signed and user-provided certs.
 */
export function signerFromUserMaterial({ keyPem, keyPassphrase, certBytes }) {
  if (!keyPem || !certBytes) throw new Error('Both key and certificate are required');
  const privateKey = crypto.createPrivateKey({
    key: keyPem,
    passphrase: keyPassphrase || undefined,
  });
  // Normalise cert to DER.
  let certDer;
  const asStr = Buffer.isBuffer(certBytes) ? certBytes.toString('utf8') : certBytes;
  if (/-----BEGIN CERTIFICATE-----/.test(asStr)) {
    const b64 = asStr.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
    certDer = Buffer.from(b64, 'base64');
  } else {
    certDer = Buffer.isBuffer(certBytes) ? certBytes : Buffer.from(certBytes);
  }
  return { privateKey, certDer, certInfo: parseCertSubject(certDer) };
}

async function createSelfSignedCert() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  // SPKI-encoded public key is already a SubjectPublicKeyInfo SEQUENCE.
  const spki = publicKey;

  const now = new Date();
  const notBefore = new Date(now.getTime() - 60_000);
  const notAfter = new Date(now.getTime() + 10 * 365 * 86400 * 1000);
  const serial = crypto.randomBytes(16);
  serial[0] &= 0x7f;  // positive

  const subject = buildName({ CN: 'PDF Toolkit Local Signer', O: 'PDF Toolkit', C: 'US' });

  // AlgorithmIdentifier for sha256WithRSAEncryption.
  const sigAlg = A.SEQUENCE(A.OID(OIDS.sha256WithRSA), A.NULL());

  // TBSCertificate.
  const tbs = A.SEQUENCE(
    A.EXPLICIT(0, A.INTEGER(2)),  // version v3
    A.INTEGER(serial),
    sigAlg,
    subject,  // issuer (self-signed)
    A.SEQUENCE(A.UTCTime(notBefore), A.UTCTime(notAfter)),
    subject,  // subject
    spki,
  );

  // Sign TBS with the private key.
  const signature = crypto.createSign('sha256').update(tbs).sign(crypto.createPrivateKey(privateKey));

  const cert = A.SEQUENCE(tbs, sigAlg, A.BIT_STRING(signature));

  await writeFile(KEY_PATH, privateKey, { mode: 0o600 });
  await writeFile(CERT_PATH, cert);
}

function buildName({ CN, O, C }) {
  const parts = [];
  if (CN) parts.push(A.SET(A.SEQUENCE(A.OID(OIDS.cn), A.UTF8(CN))));
  if (O)  parts.push(A.SET(A.SEQUENCE(A.OID(OIDS.o),  A.UTF8(O))));
  if (C)  parts.push(A.SET(A.SEQUENCE(A.OID(OIDS.c),  A.PRINT(C))));
  return A.SEQUENCE(...parts);
}

function parseCertSubject(certDer) {
  // Shallow DER walker to extract issuer + serial. Not security-critical;
  // only used to populate the SignerInfo's IssuerAndSerialNumber field, which
  // must byte-match the issuer we emit elsewhere. Easiest path: re-use the
  // raw bytes from the cert.
  //
  // Certificate ::= SEQUENCE { TBSCertificate, sigAlg, sig }
  // TBSCertificate ::= SEQUENCE { [0] version, serial, sigAlg, issuer, ... }
  const walk = new Walker(certDer);
  walk.enterSequence();                 // Certificate
  walk.enterSequence();                 // TBSCertificate
  const vTag = walk.peek();
  if (vTag === 0xa0) walk.skip();       // [0] version
  const serial = walk.readRaw();        // INTEGER
  walk.skip();                          // signature AlgorithmIdentifier
  const issuer = walk.readRaw();        // Name
  return { issuer, serial };
}

class Walker {
  constructor(buf) { this.buf = buf; this.pos = 0; }
  peek() { return this.buf[this.pos]; }
  readTLV() {
    const start = this.pos;
    const tag = this.buf[this.pos++];
    let len = this.buf[this.pos++];
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let i = 0; i < n; i++) len = (len << 8) | this.buf[this.pos++];
    }
    const contentStart = this.pos;
    this.pos += len;
    return { tag, start, contentStart, contentEnd: this.pos };
  }
  readRaw() {
    const { start } = this.readTLV();
    return this.buf.slice(start, this.pos);
  }
  skip() { this.readTLV(); }
  enterSequence() {
    const { tag, contentStart } = this.readTLV();
    if (tag !== 0x30) throw new Error('expected SEQUENCE');
    this.pos = contentStart;
  }
}

/* ============================================================
   CMS SignedData (detached, with signed attributes)
   ============================================================ */

/**
 * Build a PKCS#7 CMS SignedData DER structure that signs `messageDigest`
 * (sha256 hash of the PDF's ByteRange).
 */
export async function buildCmsSignature(messageDigest, overrideSigner) {
  const signer = overrideSigner || await getSigner();
  const now = new Date();

  // Signed attributes — the field we actually feed into the signer.
  const signedAttrs = [
    A.SEQUENCE(A.OID(OIDS.contentType),   A.SET(A.OID(OIDS.data))),
    A.SEQUENCE(A.OID(OIDS.signingTime),   A.SET(A.UTCTime(now))),
    A.SEQUENCE(A.OID(OIDS.messageDigest), A.SET(A.OCTET(messageDigest))),
  ];

  // Sign the DER of (SET OF signedAttrs), per RFC 5652 §5.4.
  const signedAttrsForSigning = A.SET(...signedAttrs);
  const signatureBytes = crypto.createSign('sha256').update(signedAttrsForSigning).sign(signer.privateKey);

  const sha256Alg = A.SEQUENCE(A.OID(OIDS.sha256), A.NULL());
  const rsaAlg    = A.SEQUENCE(A.OID(OIDS.rsaEncryption), A.NULL());

  const signerInfo = A.SEQUENCE(
    A.INTEGER(1),                                       // version
    A.SEQUENCE(signer.certInfo.issuer, signer.certInfo.serial),  // issuerAndSerialNumber
    sha256Alg,                                          // digestAlgorithm
    A.IMPLICIT(0, Buffer.concat(signedAttrs)),          // [0] IMPLICIT SET OF Attribute
    rsaAlg,                                             // signatureAlgorithm
    A.OCTET(signatureBytes),                            // signature
  );

  const signedData = A.SEQUENCE(
    A.INTEGER(1),                                       // version
    A.SET(sha256Alg),                                   // digestAlgorithms
    A.SEQUENCE(A.OID(OIDS.data)),                       // encapContentInfo (detached: no content)
    A.EXPLICIT(0, signer.certDer),                      // [0] certificates
    A.SET(signerInfo),                                  // signerInfos
  );

  const contentInfo = A.SEQUENCE(
    A.OID(OIDS.signedData),
    A.EXPLICIT(0, signedData),
  );

  return contentInfo;
}
