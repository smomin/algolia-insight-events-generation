/**
 * AES-256-GCM encryption for sensitive credential storage.
 *
 * The encryption key is derived from ENCRYPTION_SECRET (env var) using
 * scryptSync. The ciphertext format is: "<iv_hex>:<authTag_hex>:<data_hex>"
 *
 * If ENCRYPTION_SECRET is not set a built-in default is used (data is still
 * encrypted — just not with a custom secret).
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const SALT = 'algolia-insight-cfg-v1';

function deriveKey(): Buffer {
  const secret =
    process.env.ENCRYPTION_SECRET ??
    'algolia-insight-default-secret-change-me-32!';
  return scryptSync(secret, SALT, 32);
}

/** Encrypt a plain-text string. Returns a compact hex string. */
export function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/** Decrypt a ciphertext produced by {@link encrypt}. */
export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('Invalid ciphertext format');
  const [ivHex, authTagHex, dataHex] = parts;
  const key = deriveKey();
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

/** Returns true if the string looks like an encrypted payload. */
export function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  return (
    parts.length === 3 &&
    parts[0].length === IV_BYTES * 2 &&
    /^[0-9a-f]+$/i.test(parts[0])
  );
}
