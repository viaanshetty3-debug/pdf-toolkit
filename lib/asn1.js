// Minimal ASN.1 DER encoder. Covers the tags we need for X.509 and CMS.

const TAG = {
  BOOLEAN: 0x01,
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OID: 0x06,
  UTF8_STRING: 0x0c,
  PRINTABLE_STRING: 0x13,
  IA5_STRING: 0x16,
  UTC_TIME: 0x17,
  GENERALIZED_TIME: 0x18,
  SEQUENCE: 0x30,
  SET: 0x31,
};

function encodeLength(len) {
  if (len < 0x80) return Buffer.from([len]);
  const bytes = [];
  while (len > 0) { bytes.unshift(len & 0xff); len >>>= 8; }
  return Buffer.concat([Buffer.from([0x80 | bytes.length]), Buffer.from(bytes)]);
}

function tlv(tag, content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.concat(content);
  return Buffer.concat([Buffer.from([tag]), encodeLength(buf.length), buf]);
}

export const SEQUENCE = (...items) => tlv(TAG.SEQUENCE, items);
export const SET      = (...items) => tlv(TAG.SET, items);
export const OCTET    = (buf)       => tlv(TAG.OCTET_STRING, buf);
export const BOOLEAN  = (v)         => tlv(TAG.BOOLEAN, Buffer.from([v ? 0xff : 0x00]));
export const NULL     = () => Buffer.from([TAG.NULL, 0x00]);

export function INTEGER(nOrBuf) {
  if (typeof nOrBuf === 'number' || typeof nOrBuf === 'bigint') {
    let n = BigInt(nOrBuf);
    if (n === 0n) return tlv(TAG.INTEGER, Buffer.from([0]));
    const bytes = [];
    while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
    if (bytes[0] & 0x80) bytes.unshift(0);  // force positive
    return tlv(TAG.INTEGER, Buffer.from(bytes));
  }
  // Assume Buffer — strip leading zeros but keep one if next byte has high bit set.
  let buf = Buffer.from(nOrBuf);
  while (buf.length > 1 && buf[0] === 0 && (buf[1] & 0x80) === 0) buf = buf.slice(1);
  if (buf[0] & 0x80) buf = Buffer.concat([Buffer.from([0]), buf]);
  return tlv(TAG.INTEGER, buf);
}

export function BIT_STRING(buf, unusedBits = 0) {
  return tlv(TAG.BIT_STRING, Buffer.concat([Buffer.from([unusedBits]), buf]));
}

export function OID(oidString) {
  const parts = oidString.split('.').map(Number);
  const encoded = [parts[0] * 40 + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i];
    if (v === 0) { encoded.push(0); continue; }
    const stack = [];
    while (v > 0) { stack.unshift(v & 0x7f); v >>>= 7; }
    for (let j = 0; j < stack.length - 1; j++) stack[j] |= 0x80;
    encoded.push(...stack);
  }
  return tlv(TAG.OID, Buffer.from(encoded));
}

export const UTF8     = (s) => tlv(TAG.UTF8_STRING, Buffer.from(s, 'utf8'));
export const PRINT    = (s) => tlv(TAG.PRINTABLE_STRING, Buffer.from(s, 'ascii'));
export const IA5      = (s) => tlv(TAG.IA5_STRING, Buffer.from(s, 'ascii'));

function pad2(n) { return String(n).padStart(2, '0'); }

export function UTCTime(date) {
  const d = date;
  const s = `${pad2(d.getUTCFullYear() % 100)}${pad2(d.getUTCMonth()+1)}${pad2(d.getUTCDate())}${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;
  return tlv(TAG.UTC_TIME, Buffer.from(s, 'ascii'));
}

export function GeneralizedTime(date) {
  const d = date;
  const s = `${d.getUTCFullYear()}${pad2(d.getUTCMonth()+1)}${pad2(d.getUTCDate())}${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;
  return tlv(TAG.GENERALIZED_TIME, Buffer.from(s, 'ascii'));
}

/** [n] EXPLICIT — context-specific, constructed. */
export function EXPLICIT(n, content) {
  return tlv(0xA0 | n, Buffer.isBuffer(content) ? content : Buffer.concat(content));
}

/** [n] IMPLICIT — context-specific tag replacing the inner tag. The caller
 *  passes the inner content bytes (not the wrapper). */
export function IMPLICIT(n, content, constructed = true) {
  const base = constructed ? 0xA0 : 0x80;
  return tlv(base | n, Buffer.isBuffer(content) ? content : Buffer.concat(content));
}
