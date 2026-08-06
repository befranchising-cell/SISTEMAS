import { Router } from 'express';
import db from '../db.js';
import { canAccessClient, clientScopeFilter, isAdmin, requireRole } from '../auth.js';
import { encryptSecret, decryptSecret, maskValue } from '../crypto.js';
import { vaultLog, notify } from '../audit.js';
import {
  hasVaultAccess, vaultCan, hasPin, setPin, verifyUserPin,
  createVaultSession, touchVaultSession, revokeVaultSession, revokeAllVaultSessions,
} from '../vault.service.js';

const router = Router();

/* Every vault request must come from an authorised vault user (§21.4). Users
 * without access must not even perceive the vault exists — a flat 403. */
router.use((req, res, next) => {
  const access = hasVaultAccess(req.user);
  if (!access.enabled) return res.status(403).json({ error: 'Sem acesso ao Cofre de Credenciais.' });
  req.vaultAccess = access;
  next();
});

/* GET /api/vault/status — does the user have a PIN, and is the vault unlocked? */
router.get('/status', (req, res) => {
  const sessionId = req.cookies?.vault_token;
  const unlocked = sessionId ? !!touchVaultSession(sessionId, req.user.id) : false;
  res.json({
    hasPin: hasPin(req.user.id),
    unlocked,
    permissions: req.vaultAccess.permissions,
    isAdmin: isAdmin(req.user),
  });
});

/* POST /api/vault/pin/setup — create the user's first PIN (§19). */
router.post('/pin/setup', (req, res) => {
  if (hasPin(req.user.id)) return res.status(409).json({ error: 'PIN já configurado. Use a redefinição.' });
  const result = setPin(req.user.id, String(req.body.pin || ''));
  if (result.error) return res.status(400).json({ error: result.error });
  vaultLog(req, { action: 'pin_reset', detail: 'PIN inicial configurado' });
  res.json({ ok: true });
});

/* POST /api/vault/pin/change — change own PIN (requires current PIN). */
router.post('/pin/change', (req, res) => {
  const check = verifyUserPin(req, String(req.body.currentPin || ''));
  if (check.error) return res.status(check.locked ? 423 : 401).json(check);
  const result = setPin(req.user.id, String(req.body.newPin || ''));
  if (result.error) return res.status(400).json({ error: result.error });
  revokeAllVaultSessions(req.user.id); // §19.1 — reset ends open sessions
  res.clearCookie('vault_token');
  vaultLog(req, { action: 'pin_reset', detail: 'PIN alterado pelo próprio usuário' });
  res.json({ ok: true });
});

/* POST /api/vault/unlock — exchange PIN for a short-lived vault session (§19). */
router.post('/unlock', (req, res) => {
  if (!hasPin(req.user.id)) return res.status(400).json({ error: 'Configure seu PIN antes de acessar o Cofre.' });
  const check = verifyUserPin(req, String(req.body.pin || ''));
  if (check.error) return res.status(check.locked ? 423 : 401).json(check);
  const sessionId = createVaultSession(req);
  res.cookie('vault_token', sessionId, {
    httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60 * 1000,
  });
  vaultLog(req, { action: 'unlock', detail: 'Cofre desbloqueado' });
  res.json({ ok: true });
});

/* POST /api/vault/lock — explicit lock (also happens on inactivity). */
router.post('/lock', (req, res) => {
  const sessionId = req.cookies?.vault_token;
  if (sessionId) revokeVaultSession(sessionId);
  res.clearCookie('vault_token');
  res.json({ ok: true });
});

/* --- Guard for all data endpoints: a live vault session is required. --- */
function requireVaultSession(req, res, next) {
  const sessionId = req.cookies?.vault_token;
  const session = sessionId ? touchVaultSession(sessionId, req.user.id) : null;
  if (!session) {
    res.clearCookie('vault_token');
    return res.status(440).json({ error: 'Sessão do Cofre expirada. Informe o PIN novamente.', vaultLocked: true });
  }
  req.vaultSession = session;
  next();
}

function ensureClient(req, res, clientId) {
  if (!canAccessClient(req.user, clientId)) { res.status(403).json({ error: 'Sem acesso a este cliente.' }); return false; }
  return true;
}

/** Shapes a credential for listing — NEVER includes the password (§20). */
function publicCredential(c) {
  return {
    id: c.id, client_id: c.client_id, unit_id: c.unit_id, category_id: c.category_id,
    category_name: c.category_name, system_name: c.system_name, url: c.url, app: c.app,
    login: c.login, email: c.email, has_password: !!c.password_enc,
    login_masked: c.login ? maskValue(c.login, 3) : '', importance: c.importance,
    responsible: c.responsible, sector: c.sector, status: c.status, requires_2fa: !!c.requires_2fa,
    last_pw_change: c.last_pw_change, next_pw_change: c.next_pw_change, change_freq_days: c.change_freq_days,
    company_code: c.company_code, establishment_code: c.establishment_code, unit_number: c.unit_number,
    recovery_email: c.recovery_email, recovery_phone: c.recovery_phone, notes: c.notes,
    client_name: c.client_name, unit_name: c.unit_name,
  };
}

/* GET /api/vault/credentials — list (tenant-scoped, no passwords). */
router.get('/credentials', requireVaultSession, (req, res) => {
  if (!vaultCan(req.user, 'view')) { vaultLog(req, { action: 'denied', result: 'denied', detail: 'listar' }); return res.status(403).json({ error: 'Sem permissão para visualizar credenciais.' }); }
  const f = clientScopeFilter(req.user, 'cr.client_id');
  const { client_id, q, category_id, importance, status } = req.query;
  let where = f.sql;
  const args = [...f.params];
  if (client_id) { where += ' AND cr.client_id = ?'; args.push(Number(client_id)); }
  if (category_id) { where += ' AND cr.category_id = ?'; args.push(Number(category_id)); }
  if (importance) { where += ' AND cr.importance = ?'; args.push(importance); }
  if (status) { where += ' AND cr.status = ?'; args.push(status); }
  if (q) { where += ' AND (cr.system_name LIKE ? OR cr.login LIKE ? OR cr.responsible LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const rows = db.prepare(`
    SELECT cr.*, cat.name AS category_name, cl.trade_name AS client_name, u.name AS unit_name
      FROM credentials cr
      LEFT JOIN credential_categories cat ON cat.id = cr.category_id
      JOIN clients cl ON cl.id = cr.client_id
      LEFT JOIN units u ON u.id = cr.unit_id
     WHERE ${where} ORDER BY cl.trade_name, cr.system_name`).all(...args);
  res.json(rows.map(publicCredential));
});

/* GET /api/vault/categories */
router.get('/categories', requireVaultSession, (req, res) => {
  res.json(db.prepare('SELECT * FROM credential_categories ORDER BY name').all());
});

router.post('/categories', requireVaultSession, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Apenas administradores.' });
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nome obrigatório.' });
  try {
    const info = db.prepare('INSERT INTO credential_categories (name, system) VALUES (?, 0)').run(name);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch { res.status(409).json({ error: 'Categoria já existe.' }); }
});

/* GET /api/vault/credentials/:id — detail (still no password). */
router.get('/credentials/:id', requireVaultSession, (req, res) => {
  if (!vaultCan(req.user, 'view')) return res.status(403).json({ error: 'Sem permissão.' });
  const c = db.prepare(`SELECT cr.*, cat.name AS category_name, cl.trade_name AS client_name, u.name AS unit_name
      FROM credentials cr LEFT JOIN credential_categories cat ON cat.id = cr.category_id
      JOIN clients cl ON cl.id = cr.client_id LEFT JOIN units u ON u.id = cr.unit_id WHERE cr.id = ?`).get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Credencial não encontrada.' });
  if (!ensureClient(req, res, c.client_id)) return;
  vaultLog(req, { action: 'view', clientId: c.client_id, credentialId: c.id });
  res.json(publicCredential(c));
});

/**
 * POST /api/vault/credentials/:id/reveal — the guarded reveal/copy flow (§20).
 * Requires: live session + reveal permission + PIN re-confirmation.
 * Critical credentials additionally require the user's 2FA to be enabled.
 * Returns the plaintext transiently plus a short TTL for auto-hide on the client.
 */
router.post('/credentials/:id/reveal', requireVaultSession, (req, res) => {
  const mode = req.body.mode === 'copy' ? 'copy' : 'reveal';
  if (!vaultCan(req.user, mode === 'copy' ? 'copy' : 'reveal')) {
    vaultLog(req, { action: 'denied', result: 'denied', detail: mode });
    return res.status(403).json({ error: 'Sem permissão para revelar/copiar senha.' });
  }
  const c = db.prepare('SELECT * FROM credentials WHERE id = ?').get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Credencial não encontrada.' });
  if (!ensureClient(req, res, c.client_id)) return;

  // Re-confirm PIN for every reveal (§20 step 1).
  const check = verifyUserPin(req, String(req.body.pin || ''));
  if (check.error) { vaultLog(req, { action: 'denied', result: 'denied', clientId: c.client_id, credentialId: c.id, detail: 'PIN inválido no reveal' }); return res.status(check.locked ? 423 : 401).json(check); }

  // Critical credentials require reinforced auth (§30).
  if (c.importance === 'critico' && !req.user.two_factor_enabled) {
    return res.status(403).json({ error: 'Credencial crítica exige autenticação em dois fatores habilitada.' });
  }

  let password;
  try { password = decryptSecret(c.password_enc); } catch { return res.status(500).json({ error: 'Falha ao decifrar.' }); }

  vaultLog(req, { action: mode, clientId: c.client_id, credentialId: c.id, detail: c.system_name });

  // New-device heuristic alert (§24).
  const priorDevice = db.prepare("SELECT 1 FROM vault_logs WHERE user_id = ? AND device = ? AND id < (SELECT MAX(id) FROM vault_logs) LIMIT 1").get(req.user.id, req.get('user-agent')?.slice(0, 255) || '');
  if (!priorDevice) {
    notify({ clientId: c.client_id, type: 'vault_new_device', scope: 'cofre', severity: 'warning', title: 'Acesso de novo dispositivo', message: `Credencial acessada por novo dispositivo (usuário ${req.user.full_name}).` });
  }

  res.json({ password, pin: c.pin_enc ? decryptSecret(c.pin_enc) : null, ttlSeconds: 20 });
});

const FIELDS = ['unit_id', 'category_id', 'system_name', 'url', 'app', 'login', 'email', 'company_code', 'establishment_code', 'unit_number', 'recovery_info', 'recovery_phone', 'recovery_email', 'responsible', 'sector', 'importance', 'created_date', 'last_pw_change', 'next_pw_change', 'change_freq_days', 'status', 'requires_2fa', 'notes'];

/* POST /api/vault/credentials — create (requires PIN confirmation). */
router.post('/credentials', requireVaultSession, (req, res) => {
  if (!vaultCan(req.user, 'create')) return res.status(403).json({ error: 'Sem permissão para cadastrar.' });
  const clientId = Number(req.body.client_id);
  if (!ensureClient(req, res, clientId)) return;
  if (!req.body.system_name) return res.status(400).json({ error: 'Nome do sistema é obrigatório.' });
  const check = verifyUserPin(req, String(req.body.pin || ''));
  if (check.error) return res.status(check.locked ? 423 : 401).json(check);

  const data = { client_id: clientId };
  for (const f of FIELDS) data[f] = req.body[f] ?? null;
  data.requires_2fa = req.body.requires_2fa ? 1 : 0;
  data.password_enc = req.body.password ? encryptSecret(req.body.password) : null;
  data.pin_enc = req.body.service_pin ? encryptSecret(req.body.service_pin) : null;
  const cols = ['client_id', ...FIELDS, 'password_enc', 'pin_enc'];
  const info = db.prepare(`INSERT INTO credentials (${cols.join(',')}) VALUES (${cols.map((c) => `@${c}`).join(',')})`).run(data);
  db.prepare('INSERT INTO credential_history (credential_id, user_id, user_name, action, changed_fields) VALUES (?,?,?,?,?)')
    .run(info.lastInsertRowid, req.user.id, req.user.full_name, 'created', JSON.stringify(['system_name', 'login']));
  vaultLog(req, { action: 'create', clientId, credentialId: info.lastInsertRowid, detail: req.body.system_name });
  res.status(201).json({ id: info.lastInsertRowid });
});

/* PUT /api/vault/credentials/:id — update (requires PIN confirmation §19.1). */
router.put('/credentials/:id', requireVaultSession, (req, res) => {
  if (!vaultCan(req.user, 'edit')) return res.status(403).json({ error: 'Sem permissão para editar.' });
  const c = db.prepare('SELECT * FROM credentials WHERE id = ?').get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Credencial não encontrada.' });
  if (!ensureClient(req, res, c.client_id)) return;
  const check = verifyUserPin(req, String(req.body.pin || ''));
  if (check.error) return res.status(check.locked ? 423 : 401).json(check);

  const sets = []; const args = { id: c.id }; const changed = [];
  for (const f of FIELDS) if (req.body[f] !== undefined) { sets.push(`${f} = @${f}`); args[f] = f === 'requires_2fa' ? (req.body[f] ? 1 : 0) : req.body[f]; changed.push(f); }
  let passwordChanged = false;
  if (req.body.password !== undefined && req.body.password !== '') {
    sets.push('password_enc = @password_enc'); args.password_enc = encryptSecret(req.body.password);
    sets.push("last_pw_change = date('now')"); passwordChanged = true;
  }
  if (req.body.service_pin !== undefined) { sets.push('pin_enc = @pin_enc'); args.pin_enc = req.body.service_pin ? encryptSecret(req.body.service_pin) : null; }
  if (!sets.length) return res.json({ ok: true });
  db.prepare(`UPDATE credentials SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = @id`).run(args);
  // History records only WHICH fields changed — never the values (§23).
  db.prepare('INSERT INTO credential_history (credential_id, user_id, user_name, action, changed_fields) VALUES (?,?,?,?,?)')
    .run(c.id, req.user.id, req.user.full_name, passwordChanged ? 'password_changed' : 'updated', JSON.stringify(passwordChanged ? [...changed, 'password'] : changed));
  vaultLog(req, { action: 'update', clientId: c.client_id, credentialId: c.id, detail: passwordChanged ? 'senha alterada' : 'dados alterados' });
  if (passwordChanged) notify({ clientId: c.client_id, type: 'vault_pw_changed', scope: 'cofre', severity: 'info', title: 'Senha alterada', message: `Senha da credencial "${c.system_name}" foi alterada.` });
  res.json({ ok: true });
});

/* DELETE /api/vault/credentials/:id — requires PIN confirmation (§19.1, §30). */
router.delete('/credentials/:id', requireVaultSession, (req, res) => {
  if (!vaultCan(req.user, 'delete')) return res.status(403).json({ error: 'Sem permissão para excluir.' });
  const c = db.prepare('SELECT * FROM credentials WHERE id = ?').get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Credencial não encontrada.' });
  if (!ensureClient(req, res, c.client_id)) return;
  const check = verifyUserPin(req, String(req.body?.pin || req.query.pin || ''));
  if (check.error) return res.status(check.locked ? 423 : 401).json(check);
  db.prepare('INSERT INTO credential_history (credential_id, user_id, user_name, action, changed_fields) VALUES (?,?,?,?,?)')
    .run(c.id, req.user.id, req.user.full_name, 'deleted', '[]');
  db.prepare('DELETE FROM credentials WHERE id = ?').run(c.id);
  vaultLog(req, { action: 'delete', clientId: c.client_id, credentialId: c.id, detail: c.system_name });
  res.json({ ok: true });
});

/* GET /api/vault/credentials/:id/history — change history (no secret values). */
router.get('/credentials/:id/history', requireVaultSession, (req, res) => {
  if (!vaultCan(req.user, 'history')) return res.status(403).json({ error: 'Sem permissão.' });
  const c = db.prepare('SELECT client_id FROM credentials WHERE id = ?').get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Credencial não encontrada.' });
  if (!ensureClient(req, res, c.client_id)) return;
  res.json(db.prepare('SELECT * FROM credential_history WHERE credential_id = ? ORDER BY created_at DESC').all(Number(req.params.id)));
});

/* GET /api/vault/logs — vault access logs (§23). Requires the logs permission. */
router.get('/logs', requireVaultSession, (req, res) => {
  if (!vaultCan(req.user, 'logs')) return res.status(403).json({ error: 'Sem permissão.' });
  const f = clientScopeFilter(req.user, 'client_id');
  const rows = db.prepare(`SELECT * FROM vault_logs WHERE (${f.sql} OR client_id IS NULL) ORDER BY created_at DESC LIMIT 300`).all(...f.params);
  res.json(rows);
});

/* -------- Vault user administration & PIN reset (admin, §21.1) -------- */
router.get('/access', requireVaultSession, requireRole('admin_geral'), (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.full_name, u.email, va.enabled, va.permissions,
           (SELECT 1 FROM vault_pins vp WHERE vp.user_id = u.id) AS has_pin,
           (SELECT locked_until FROM vault_pins vp WHERE vp.user_id = u.id) AS locked_until
      FROM users u LEFT JOIN vault_access va ON va.user_id = u.id ORDER BY u.full_name`).all();
  res.json(rows.map((r) => ({ ...r, enabled: !!r.enabled, has_pin: !!r.has_pin, permissions: JSON.parse(r.permissions || '{}') })));
});

router.put('/access/:userId', requireVaultSession, requireRole('admin_geral'), (req, res) => {
  const userId = Number(req.params.userId);
  const enabled = req.body.enabled ? 1 : 0;
  const permissions = JSON.stringify(req.body.permissions || {});
  db.prepare(`INSERT INTO vault_access (user_id, enabled, permissions, updated_at) VALUES (?,?,?,datetime('now'))
              ON CONFLICT(user_id) DO UPDATE SET enabled = excluded.enabled, permissions = excluded.permissions, updated_at = datetime('now')`)
    .run(userId, enabled, permissions);
  if (!enabled) revokeAllVaultSessions(userId);
  vaultLog(req, { action: 'update', detail: `Permissões de cofre do usuário ${userId} atualizadas` });
  res.json({ ok: true });
});

/* Admin-initiated PIN reset (§19.1): ends all the target's vault sessions and
 * clears their PIN. Requires the admin to confirm their OWN PIN as the extra
 * identity check. The new PIN is set by the user on next access. */
router.post('/access/:userId/reset-pin', requireVaultSession, requireRole('admin_geral'), (req, res) => {
  const confirm = verifyUserPin(req, String(req.body.adminPin || ''));
  if (confirm.error) return res.status(confirm.locked ? 423 : 401).json(confirm);
  const userId = Number(req.params.userId);
  db.prepare('DELETE FROM vault_pins WHERE user_id = ?').run(userId);
  revokeAllVaultSessions(userId);
  notify({ type: 'vault_pin_reset', scope: 'cofre', severity: 'warning', title: 'PIN redefinido', message: `O PIN do usuário ${userId} foi redefinido pelo administrador.` });
  vaultLog(req, { action: 'pin_reset', detail: `Reset de PIN do usuário ${userId} pelo administrador` });
  res.json({ ok: true });
});

export default router;
