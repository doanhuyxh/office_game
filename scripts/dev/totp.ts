// TOTP (RFC 6238: HMAC-SHA1, bước 30 giây, 6 chữ số) cho script e2e — khớp AuthenticatorTokenProvider của ASP.NET Identity.
// Dùng: totp(sharedKey) với sharedKey = khoá base32 từ POST /api/auth/2fa/setup (có hay không khoảng trắng đều được).
import { createHmac } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Buffer {
  const s = input.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error(`Ký tự base32 không hợp lệ: ${ch}`);
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

/** Mã của bước thời gian `step` (= floor(unix giây / 30)). */
export function hotp(key: Buffer, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', key).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / 30);

export const totp = (sharedKey: string, now = Date.now()) => hotp(base32Decode(sharedKey), currentStep(now));

/** Mã 6 số chắc chắn SAI: khác mọi mã trong cửa sổ ±3 bước (server chấp nhận ±2). */
export function wrongTotp(sharedKey: string): string {
  const key = base32Decode(sharedKey), step = currentStep();
  const near = new Set(Array.from({ length: 7 }, (_, i) => hotp(key, step - 3 + i)));
  for (let n = 0; ; n++) { const c = String((123_457 + n * 7919) % 1_000_000).padStart(6, '0'); if (!near.has(c)) return c; }
}
