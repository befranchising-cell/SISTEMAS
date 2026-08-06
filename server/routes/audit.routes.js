import { Router } from 'express';
import db from '../db.js';
import { requireRole, clientScopeFilter, isAdmin } from '../auth.js';

const router = Router();

/* General audit log (§23, §26). Admins see all; consultants see their clients.
 * Logs are read-only — no mutation endpoints exist (§23 immutability). */
router.get('/', (req, res) => {
  if (!isAdmin(req.user) && req.user.role_key !== 'consultor') {
    return res.status(403).json({ error: 'Permissão insuficiente.' });
  }
  const f = clientScopeFilter(req.user, 'client_id');
  const { action, from, to } = req.query;
  let where = `(${f.sql} OR client_id IS NULL)`;
  const args = [...f.params];
  if (action) { where += ' AND action = ?'; args.push(action); }
  if (from) { where += ' AND created_at >= ?'; args.push(from); }
  if (to) { where += ' AND created_at <= ?'; args.push(to + ' 23:59:59'); }
  const rows = db.prepare(`SELECT * FROM audit_logs WHERE ${where} ORDER BY created_at DESC LIMIT 300`).all(...args);
  res.json(rows);
});

export default router;
