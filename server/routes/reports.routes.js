import { Router } from 'express';
import db from '../db.js';
import { clientScopeFilter, requirePermission } from '../auth.js';
import { hasVaultAccess } from '../vault.service.js';

const router = Router();

/**
 * Reports (§25). Returned as JSON rows the client renders and can export to
 * CSV/print. Bank secrets and vault passwords are NEVER included.
 */
router.get('/:kind', requirePermission('view_reports'), (req, res) => {
  const f = clientScopeFilter(req.user, 'client_id');
  const cf = clientScopeFilter(req.user, 'cl.id');
  const kind = req.params.kind;

  const map = {
    collaborators_by_client: () => db.prepare(`
      SELECT cl.trade_name AS cliente, COUNT(c.id) AS colaboradores
        FROM clients cl LEFT JOIN collaborators c ON c.client_id = cl.id AND c.prof_status != 'encerrado'
       WHERE ${cf.sql} GROUP BY cl.id ORDER BY colaboradores DESC`).all(...cf.params),

    collaborators_by_contract: () => db.prepare(`
      SELECT contract_type AS tipo_contratacao, COUNT(*) AS total
        FROM collaborators WHERE ${f.sql} AND prof_status != 'encerrado'
       GROUP BY contract_type`).all(...f.params),

    payments_late: () => db.prepare(`
      SELECT cl.trade_name AS cliente, c.full_name AS colaborador, p.due_date AS vencimento, p.amount_planned AS valor
        FROM payments p JOIN clients cl ON cl.id = p.client_id LEFT JOIN collaborators c ON c.id = p.collaborator_id
       WHERE ${f.sql.replace(/client_id/g, 'p.client_id')} AND p.status = 'atrasado' ORDER BY p.due_date`).all(...f.params),

    payments_planned_vs_paid: () => db.prepare(`
      SELECT cl.trade_name AS cliente,
             COALESCE(SUM(p.amount_planned),0) AS previsto,
             COALESCE(SUM(CASE WHEN p.status='pago' THEN p.amount_paid END),0) AS pago
        FROM clients cl LEFT JOIN payments p ON p.client_id = cl.id
       WHERE ${cf.sql} GROUP BY cl.id`).all(...cf.params),

    routines_late: () => db.prepare(`
      SELECT cl.trade_name AS cliente, r.title AS rotina, o.date AS data
        FROM routine_occurrences o JOIN routines r ON r.id = o.routine_id JOIN clients cl ON cl.id = o.client_id
       WHERE ${f.sql.replace(/client_id/g, 'o.client_id')} AND o.status = 'atrasada' ORDER BY o.date`).all(...f.params),

    bank_incomplete: () => db.prepare(`
      SELECT cl.trade_name AS cliente, c.full_name AS colaborador
        FROM collaborators c JOIN clients cl ON cl.id = c.client_id
       WHERE ${f.sql.replace(/client_id/g, 'c.client_id')} AND NOT EXISTS (SELECT 1 FROM bank_accounts b WHERE b.collaborator_id = c.id)`).all(...f.params),
  };

  if (!map[kind]) return res.status(404).json({ error: 'Relatório não encontrado.' });
  res.json({ kind, rows: map[kind]() });
});

/* Vault administrative reports (§25) — never expose passwords/PINs. */
router.get('/vault/:kind', (req, res) => {
  const access = hasVaultAccess(req.user);
  if (!access.enabled || !access.permissions.logs) {
    return res.status(403).json({ error: 'Sem permissão para relatórios do Cofre.' });
  }
  const f = clientScopeFilter(req.user, 'client_id');
  const kind = req.params.kind;
  const map = {
    by_client: () => db.prepare(`SELECT cl.trade_name AS cliente, COUNT(cr.id) AS credenciais FROM clients cl LEFT JOIN credentials cr ON cr.client_id = cl.id WHERE ${clientScopeFilter(req.user, 'cl.id').sql} GROUP BY cl.id`).all(...clientScopeFilter(req.user, 'cl.id').params),
    by_category: () => db.prepare(`SELECT cat.name AS categoria, COUNT(cr.id) AS total FROM credential_categories cat LEFT JOIN credentials cr ON cr.category_id = cat.id AND ${f.sql.replace(/client_id/g, 'cr.client_id')} GROUP BY cat.id HAVING total > 0`).all(...f.params),
    pw_change_due: () => db.prepare(`SELECT cl.trade_name AS cliente, cr.system_name AS sistema, cr.next_pw_change AS troca_prevista FROM credentials cr JOIN clients cl ON cl.id = cr.client_id WHERE ${f.sql.replace(/client_id/g, 'cr.client_id')} AND cr.next_pw_change IS NOT NULL AND cr.next_pw_change <= date('now','+30 day') ORDER BY cr.next_pw_change`).all(...f.params),
    no_responsible: () => db.prepare(`SELECT cl.trade_name AS cliente, cr.system_name AS sistema FROM credentials cr JOIN clients cl ON cl.id = cr.client_id WHERE ${f.sql.replace(/client_id/g, 'cr.client_id')} AND (cr.responsible IS NULL OR cr.responsible = '')`).all(...f.params),
    critical: () => db.prepare(`SELECT cl.trade_name AS cliente, cr.system_name AS sistema, cr.status FROM credentials cr JOIN clients cl ON cl.id = cr.client_id WHERE ${f.sql.replace(/client_id/g, 'cr.client_id')} AND cr.importance = 'critico'`).all(...f.params),
  };
  if (!map[kind]) return res.status(404).json({ error: 'Relatório não encontrado.' });
  res.json({ kind, rows: map[kind]() });
});

export default router;
