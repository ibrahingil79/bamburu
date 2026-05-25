import { createHmac, randomBytes } from 'crypto';

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateSecret() {
  const bytes = randomBytes(20);
  let result = '';
  let bits = 0, value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { bits -= 5; result += CHARS[(value >> bits) & 31]; }
  }
  if (bits > 0) result += CHARS[(value << (5 - bits)) & 31];
  return result;
}

function decode(str) {
  const upper = str.toUpperCase();
  let bits = 0, value = 0;
  const out = [];
  for (const ch of upper) {
    const idx = CHARS.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { bits -= 8; out.push((value >> bits) & 0xFF); }
  }
  return Buffer.from(out);
}

function generate(secret, offset = 0) {
  const counter = Math.floor(Date.now() / 30000) + offset;
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', decode(secret)).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0x0F;
  const code = ((hmac[off] & 0x7F) << 24) | ((hmac[off+1] & 0xFF) << 16) |
               ((hmac[off+2] & 0xFF) << 8) | (hmac[off+3] & 0xFF);
  return String(code % 1_000_000).padStart(6, '0');
}

export function verify(token, secret) {
  const t = (token || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(t)) return false;
  for (let w = -1; w <= 1; w++) {
    if (generate(secret, w) === t) return true;
  }
  return false;
}

export function keyuri(accountName, issuer, secret) {
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?${params}`;
}
