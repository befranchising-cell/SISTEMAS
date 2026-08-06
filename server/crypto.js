import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from './config.js';

/**
 * Symmetric encryption for vault credentials (reversible, AES-256-GCM).
 *
 * The 32-byte content key is derived from the environment master key with a
 * per-application salt via scrypt, so the raw master key never touches disk in
 * usable form and the DB alone is useless to an attacker.
 */
const CONTENT_KEY = crypto.scryptSync(
  config.vaultMasterKey,
  'vault-content-key-v1',
  32,
);

/**
 * Encrypts a UTF-8 secret. Returns a compact string:
 *   v1:<iv_b64>:<authTag_b64>:<cipher_b64>
 * A fresh random IV per call means identical passwords never produce identical
 * ciphertext.
 */
export function encryptSecret(plaintext) {
  if (plaintext == null || plaintext === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', CONTENT_KEY, iv);
  const enc = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

/** Decrypts a value produced by {@link encryptSecret}. */
export function decryptSecret(payload) {
  if (!payload) return null;
  const [version, ivB64, tagB64, dataB64] = String(payload).split(':');
  if (version !== 'v1') throw new Error('Formato de segredo desconhecido');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', CONTENT_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/* --------------------------------------------------------------------- */
/* One-way hashing: login passwords and vault PINs are NEVER reversible.  */
/* --------------------------------------------------------------------- */

export function hashPassword(plain) {
  return bcrypt.hashSync(String(plain), config.bcryptRounds);
}

export function verifyPassword(plain, hash) {
  if (!hash) return false;
  try {
    return bcrypt.compareSync(String(plain), hash);
  } catch {
    return false;
  }
}

// PINs use the same one-way scheme as passwords. The old PIN can never be read.
export const hashPin = hashPassword;
export const verifyPin = verifyPassword;

/**
 * PIN strength policy (spec §19.1):
 *  - at least 6 digits, numeric only
 *  - no strictly sequential runs (123456 / 654321)
 *  - no single repeated digit (111111)
 *  - rejects a small set of well-known weak PINs
 */
export function validatePinStrength(pin) {
  const s = String(pin || '');
  if (!/^\d{6,}$/.test(s)) {
    return 'O PIN deve conter apenas números e ter no mínimo 6 dígitos.';
  }
  if (/^(\d)\1+$/.test(s)) {
    return 'O PIN não pode ser composto por um único dígito repetido.';
  }
  const digits = s.split('').map(Number);
  const ascending = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1);
  const descending = digits.every((d, i) => i === 0 || d === digits[i - 1] - 1);
  if (ascending || descending) {
    return 'O PIN não pode ser uma sequência (ex.: 123456).';
  }
  const weak = new Set(['123456', '000000', '654321', '121212', '112233', '123123']);
  if (weak.has(s)) {
    return 'O PIN é muito previsível. Escolha outro.';
  }
  return null; // valid
}

/** Random opaque token (vault session ids, 2FA fallback, etc.). */
export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * Partial masking for display of sensitive identifiers (CPF, CNPJ, account,
 * PIX key). Keeps only the last few characters visible.
 */
export function maskValue(value, visible = 4) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= visible) return '•'.repeat(s.length);
  return '•'.repeat(Math.max(4, s.length - visible)) + s.slice(-visible);
}
