import { Router } from 'express';
import db from '../db.js';
import { clientScopeFilter } from '../auth.js';
import { hasVaultAccess } from '../vault.service.js';

const router = Router();

/* GET /api/notifications — tenant-scoped. Vault-scope items only for authorised
 * vault users (§21.4, §24). Secrets are never included. */
router.get('/', (req, res) => {
  const f = clientScopeFilter(req.user, 'client_id');
  // client_id may be NULL for consultancy-wide notices; admins see those too.
  const rows = db.prepare(`
    SELECT * FROM notifications
     WHERE (${f.sql} OR client_id IS NULL)
     ORDER BY created_at DESC LIMIT 100`).all(...f.params);

  const vaultOk = hasVaultAccess(req.user).enabled;
  const visible = rows.filter((n) => n.scope !== 'cofre' || vaultOk);
  res.json(visible);
});

router.post('/:id/read', (req, res) => {
  const n = db.prepare('SELECT * FROM notifications WHERE id = ?').get(Number(req.params.id));
  if (!n) return res.status(404).json({ error: 'Notificação não encontrada.' });
  db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE id = ?").run(n.id);
  res.json({ ok: true });
});

router.post('/read-all', (req, res) => {
  const f = clientScopeFilter(req.user, 'client_id');
  db.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE read_at IS NULL AND (${f.sql} OR client_id IS NULL)`).run(...f.params);
  res.json({ ok: true });
});

export default router;
