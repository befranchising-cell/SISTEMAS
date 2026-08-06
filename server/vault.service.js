import db from './db.js';
import { config } from './config.js';
import { verifyPin, hashPin, validatePinStrength, randomToken } from './crypto.js';
import { vaultLog, notify } from './audit.js';

/**
 * Credential-vault domain logic (spec §15–§23, §29, §30).
 *
 * Security invariants enforced here:
 *  - Vault access is INDEPENDENT from ordinary system permissions (§21).
 *  - Each authorised user has their OWN PIN, hashed one-way (§19, §33).
 *  - A valid PIN alone is never enough: the user must also be authenticated and
 *    authorised (§30). Sensitive actions re-confirm the PIN.
 *  - Passwords are decrypted only transiently and every access is logged (§20).
 */

/** Returns { enabled, permissions } describing the user's vault authorisation. */
export function hasVaultAccess(user) {
  const row = db.prepare('SELECT enabled, permissions FROM vault_access WHERE user_id = ?').get(user.id);
  if (!row || !row.enabled) return { enabled: false, permissions: {} };
  return { enabled: true, permissions: JSON.parse(row.permissions || '{}') };
}

export function vaultCan(user, permission) {
  const a = hasVaultAccess(user);
  if (!a.enabled) return false;
  // Admins with vault enabled implicitly hold every vault permission.
  if (user.role_key === 'admin_geral') return true;
  return !!a.permissions[permission];
}

export function hasPin(userId) {
  return !!db.prepare('SELECT 1 FROM vault_pins WHERE user_id = ?').get(userId);
}

/** Sets or replaces a user's PIN (enforces strength policy §19.1). */
export function setPin(userId, pin) {
  const err = validatePinStrength(pin);
  if (err) return { error: err };
  db.prepare(`INSERT INTO vault_pins (user_id, pin_hash, failed_attempts, locked_until, updated_at)
              VALUES (?,?,0,NULL,datetime('now'))
              ON CONFLICT(user_id) DO UPDATE SET pin_hash = excluded.pin_hash,
                failed_attempts = 0, locked_until = NULL, updated_at = datetime('now')`)
    .run(userId, hashPin(pin));
  return { ok: true };
}

/**
 * Verifies a PIN, applying the 5-attempt lockout (§19.1). Returns
 * { ok } | { error, locked?, remaining? }. Every attempt is auditable by the
 * caller via the returned outcome.
 */
export function verifyUserPin(req, pin) {
  const row = db.prepare('SELECT * FROM vault_pins WHERE user_id = ?').get(req.user.id);
  if (!row) return { error: 'PIN não configurado.' };

  const now = new Date().toISOString();
  if (row.locked_until && row.locked_until > now) {
    return { error: 'Cofre bloqueado por tentativas incorretas. Aguarde.', locked: true };
  }

  if (!verifyPin(pin, row.pin_hash)) {
    const attempts = row.failed_attempts + 1;
    let lockedUntil = null;
    if (attempts >= config.vaultMaxPinAttempts) {
      lockedUntil = new Date(Date.now() + config.vaultLockoutMinutes * 60 * 1000).toISOString();
    }
    db.prepare('UPDATE vault_pins SET failed_attempts = ?, locked_until = ? WHERE user_id = ?')
      .run(attempts, lockedUntil, req.user.id);
    vaultLog(req, { action: lockedUntil ? 'locked' : 'denied', result: 'denied', detail: `PIN incorreto (${attempts})` });
    if (lockedUntil) {
      notify({ type: 'vault_pin_lock', scope: 'cofre', severity: 'critical', title: 'Cofre bloqueado', message: `Múltiplas tentativas incorretas de PIN do usuário ${req.user.full_name}.` });
      return { error: 'Cofre bloqueado após 5 tentativas incorretas.', locked: true };
    }
    return { error: 'PIN incorreto.', remaining: config.vaultMaxPinAttempts - attempts };
  }

  // Success — reset counter.
  db.prepare('UPDATE vault_pins SET failed_attempts = 0, locked_until = NULL WHERE user_id = ?').run(req.user.id);
  return { ok: true };
}

/* -------------------------- Vault sessions --------------------------- */

export function createVaultSession(req) {
  const id = randomToken(24);
  db.prepare('INSERT INTO vault_sessions (id, user_id, ip, device) VALUES (?,?,?,?)')
    .run(id, req.user.id, req.ip || null, req.get('user-agent')?.slice(0, 255) || null);
  return id;
}

/** Validates and refreshes a vault session; enforces inactivity timeout (§19). */
export function touchVaultSession(sessionId, userId) {
  const s = db.prepare('SELECT * FROM vault_sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);
  if (!s || s.revoked) return null;
  const ageMs = Date.now() - new Date(s.last_active + 'Z').getTime();
  if (ageMs > config.vaultSessionMinutes * 60 * 1000) {
    db.prepare('UPDATE vault_sessions SET revoked = 1 WHERE id = ?').run(sessionId);
    return null;
  }
  db.prepare("UPDATE vault_sessions SET last_active = datetime('now') WHERE id = ?").run(sessionId);
  return s;
}

export function revokeVaultSession(sessionId) {
  db.prepare('UPDATE vault_sessions SET revoked = 1 WHERE id = ?').run(sessionId);
}

/** Ends ALL of a user's vault sessions (used on PIN reset — §19.1, §30). */
export function revokeAllVaultSessions(userId) {
  db.prepare('UPDATE vault_sessions SET revoked = 1 WHERE user_id = ?').run(userId);
}
