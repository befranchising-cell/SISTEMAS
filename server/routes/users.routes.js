import { Router } from 'express';
import db from '../db.js';
import { requireRole } from '../auth.js';
import { hashPassword } from '../crypto.js';
import { audit } from '../audit.js';

const router = Router();

/* User & permission management is admin-only (§14.1). */
router.use(requireRole('admin_geral'));

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.full_name, u.email, u.phone, u.status, u.two_factor_enabled,
           u.last_login_at, r.key AS role, r.name AS role_name
      FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.full_name`).all();
  for (const u of rows) {
    u.clientIds = db.prepare('SELECT client_id FROM user_clients WHERE user_id = ?').all(u.id).map((r) => r.client_id);
    const p = db.prepare('SELECT permissions FROM user_permissions WHERE user_id = ?').get(u.id);
    u.permissions = p ? JSON.parse(p.permissions) : {};
  }
  res.json(rows);
});

router.get('/roles', (req, res) => {
  res.json(db.prepare('SELECT * FROM roles ORDER BY id').all());
});

router.post('/', (req, res) => {
  const { full_name, email, phone, password, role, clientIds = [], permissions = {}, two_factor_enabled } = req.body;
  if (!full_name || !email || !password || !role) return res.status(400).json({ error: 'Nome, e-mail, senha e perfil são obrigatórios.' });
  const roleRow = db.prepare('SELECT id FROM roles WHERE key = ?').get(role);
  if (!roleRow) return res.status(400).json({ error: 'Perfil inválido.' });
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(String(email).toLowerCase());
  if (exists) return res.status(409).json({ error: 'E-mail já cadastrado.' });

  const tx = db.transaction(() => {
    const uid = db.prepare('INSERT INTO users (full_name, email, phone, password_hash, role_id, two_factor_enabled) VALUES (?,?,?,?,?,?)')
      .run(full_name, String(email).toLowerCase(), phone ?? null, hashPassword(password), roleRow.id, two_factor_enabled ? 1 : 0).lastInsertRowid;
    db.prepare('INSERT INTO user_permissions (user_id, permissions) VALUES (?,?)').run(uid, JSON.stringify(permissions));
    for (const cid of clientIds) db.prepare('INSERT OR IGNORE INTO user_clients (user_id, client_id) VALUES (?,?)').run(uid, Number(cid));
    return uid;
  });
  const uid = tx();
  audit(req, { action: 'create', entityType: 'user', entityId: uid });
  res.status(201).json({ id: uid });
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const { full_name, phone, status, role, password, clientIds, permissions, two_factor_enabled } = req.body;
  const tx = db.transaction(() => {
    const sets = []; const args = { id };
    if (full_name !== undefined) { sets.push('full_name = @full_name'); args.full_name = full_name; }
    if (phone !== undefined) { sets.push('phone = @phone'); args.phone = phone; }
    if (status !== undefined) { sets.push('status = @status'); args.status = status; }
    if (two_factor_enabled !== undefined) { sets.push('two_factor_enabled = @tfa'); args.tfa = two_factor_enabled ? 1 : 0; }
    if (password) { sets.push('password_hash = @ph'); args.ph = hashPassword(password); }
    if (role) { const r = db.prepare('SELECT id FROM roles WHERE key = ?').get(role); if (r) { sets.push('role_id = @rid'); args.rid = r.id; } }
    if (sets.length) db.prepare(`UPDATE users SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = @id`).run(args);
    if (permissions !== undefined) db.prepare('INSERT INTO user_permissions (user_id, permissions) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET permissions = excluded.permissions').run(id, JSON.stringify(permissions));
    if (clientIds !== undefined) {
      db.prepare('DELETE FROM user_clients WHERE user_id = ?').run(id);
      for (const cid of clientIds) db.prepare('INSERT OR IGNORE INTO user_clients (user_id, client_id) VALUES (?,?)').run(id, Number(cid));
    }
  });
  tx();
  audit(req, { action: 'update', entityType: 'user', entityId: id });
  res.json({ ok: true });
});

/* Immediate revocation of a departing user (§30, §32). */
router.post('/:id/revoke', (req, res) => {
  const id = Number(req.params.id);
  db.prepare("UPDATE users SET status = 'bloqueado' WHERE id = ?").run(id);
  db.prepare('UPDATE vault_sessions SET revoked = 1 WHERE user_id = ?').run(id);
  db.prepare('UPDATE vault_access SET enabled = 0 WHERE user_id = ?').run(id);
  audit(req, { action: 'revoke', entityType: 'user', entityId: id });
  res.json({ ok: true });
});

export default router;
