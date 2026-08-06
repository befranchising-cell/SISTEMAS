import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/**
 * Secrets management.
 *
 * In production the keys below MUST come from environment variables (or a KMS
 * / secret manager). The vault master key that encrypts external credentials is
 * deliberately kept OUT of the database: it lives only in the environment.
 *
 * For local demonstration we fall back to a key persisted in a file with
 * restrictive permissions, OUTSIDE the application source tree logically (it is
 * git-ignored). This keeps the demo runnable without leaking secrets to source
 * control, while making the production requirement explicit.
 */
function loadOrCreateSecret(envName, fileName) {
  const fromEnv = process.env[envName];
  if (fromEnv && fromEnv.length >= 32) return fromEnv;

  const secretFile = path.join(DATA_DIR, fileName);
  if (fs.existsSync(secretFile)) {
    return fs.readFileSync(secretFile, 'utf8').trim();
  }
  const generated = crypto.randomBytes(48).toString('base64');
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  return generated;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Session / auth signing key (JWT).
  jwtSecret: loadOrCreateSecret('APP_JWT_SECRET', '.jwt.secret'),
  sessionTtlMinutes: Number(process.env.SESSION_TTL_MINUTES || 60),

  // Master key used to derive the AES-256-GCM key that encrypts vault
  // credentials. Reversible encryption is required because authorised users
  // must recover the external passwords. Stored separately from the DB.
  vaultMasterKey: loadOrCreateSecret('VAULT_MASTER_KEY', '.vault.key'),

  // Cost factor for bcrypt hashing (login passwords AND vault PINs).
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 12),

  // Vault session: after unlocking with the PIN the vault stays open only for
  // this long of inactivity, then re-prompts.
  vaultSessionMinutes: Number(process.env.VAULT_SESSION_MINUTES || 10),
  vaultMaxPinAttempts: 5,
  vaultLockoutMinutes: 15,

  // Login brute-force lockout.
  loginMaxAttempts: 10,
  loginLockoutMinutes: 15,
};

export default config;
