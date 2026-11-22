import crypto from 'node:crypto';
import { config } from '../config.ts';

const SCRYPT_KEYLEN = 64;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function getAesKey(): Buffer {
  const hex = config.encryptionKeyHex;
  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    return Buffer.from(hex, 'hex');
  }
  return crypto.createHash('sha256').update(hex).digest();
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, { N: 16384, r: 8, p: 1 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hexKey] = parts;
  if (!salt || !hexKey) return false;
  const expected = Buffer.from(hexKey, 'hex');
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, { N: 16384, r: 8, p: 1 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
  if (expected.length !== derived.length) return false;
  return crypto.timingSafeEqual(expected, derived);
}

export function validatePasswordStrength(password: string): string | null {
  if (typeof password !== 'string' || password.length < 12) {
    return 'Password must be at least 12 characters long.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must include at least one uppercase letter.';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must include at least one lowercase letter.';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must include at least one number.';
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return 'Password must include at least one symbol.';
  }
  return null;
}

export function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function hashIp(ip: string): string {
  return crypto
    .createHmac('sha256', config.sessionSecret)
    .update(ip || 'unknown')
    .digest('hex')
    .slice(0, 16);
}

export function safeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function encryptText(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getAesKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptText(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(':');
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error('Invalid encrypted payload format');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getAesKey(),
    Buffer.from(ivHex, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

// RFC 6238 TOTP (Base32 secret, SHA-1, 6 digits, 30s window)
export function generateTotpSecret(byteLength = 20): string {
  const bytes = crypto.randomBytes(byteLength);
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function decodeBase32(base32: string): Buffer {
  const cleaned = base32.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function computeTotpCode(secretBase32: string, stepCounter: number): string {
  const key = decodeBase32(secretBase32);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(stepCounter), 0);
  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const codeInt =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(codeInt % 1_000_000).padStart(6, '0');
}

export function verifyTotpCode(
  secretBase32: string,
  submittedCode: string,
  lastUsedStep: number | null,
): { valid: boolean; matchedStep: number | null } {
  const cleaned = submittedCode.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleaned)) {
    return { valid: false, matchedStep: null };
  }
  const currentStep = Math.floor(Date.now() / 1000 / 30);
  for (const offset of [-1, 0, 1]) {
    const step = currentStep + offset;
    if (lastUsedStep !== null && step <= lastUsedStep) {
      continue;
    }
    const expected = computeTotpCode(secretBase32, step);
    if (safeEqualStrings(expected, cleaned)) {
      return { valid: true, matchedStep: step };
    }
  }
  return { valid: false, matchedStep: null };
}

export function buildOtpAuthUri(email: string, secret: string, issuer = 'NPP Issue Portal'): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function generateBackupCodes(count = 8): { plain: string[]; hashes: string[] } {
  const plain: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    const formatted = `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
    plain.push(formatted);
    hashes.push(sha256(formatted));
  }
  return { plain, hashes };
}
