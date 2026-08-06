import { Router } from 'express';
import db from '../db.js';
import { canAccessClient, clientScopeFilter } from '../auth.js';

const router = Router();

/* GET /api/dashboard/general — consultancy-wide KPIs (§13). Tenant-scoped. */
router.get('/general', (req, res) => {
  const f = clientScopeFilter(req.user, 'client_id');
  const cf = clientScopeFilter(req.user, 'id');
  const monthStart = new Date().toISOString().slice(0, 8) + '01';
  const monthEnd = new Date().toISOString().slice(0, 8) + '31';

  const one = (sql, ...a) => db.prepare(sql).get(...a);

  const totalClients = one(`SELECT COUNT(*) n FROM clients WHERE ${cf.sql}`, ...cf.params).n;
  const activeClients = one(`SELECT COUNT(*) n FROM clients WHERE ${cf.sql} AND status = 'ativo'`, ...cf.params).n;
  const totalCollab = one(`SELECT COUNT(*) n FROM collaborators WHERE ${f.sql} AND prof_status != 'encerrado'`, ...f.params).n;

  const byContract = db.prepare(`SELECT contract_type, COUNT(*) n FROM collaborators WHERE ${f.sql} AND prof_status != 'encerrado' GROUP BY contract_type`).all(...f.params);

  const payMonth = one(`SELECT COALESCE(SUM(amount_planned),0) v, COUNT(*) n FROM payments WHERE ${f.sql} AND due_date BETWEEN ? AND ?`, ...f.params, monthStart, monthEnd);
  const payPaid = one(`SELECT COALESCE(SUM(amount_paid),0) v, COUNT(*) n FROM payments WHERE ${f.sql} AND status = 'pago' AND due_date BETWEEN ? AND ?`, ...f.params, monthStart, monthEnd);
  const payLate = one(`SELECT COUNT(*) n, COALESCE(SUM(amount_planned),0) v FROM payments WHERE ${f.sql} AND status = 'atrasado'`, ...f.params);

  const routinesPending = one(`SELECT COUNT(*) n FROM routine_occurrences WHERE ${f.sql} AND status = 'pendente'`, ...f.params).n;
  const routinesDone = one(`SELECT COUNT(*) n FROM routine_occurrences WHERE ${f.sql} AND status = 'concluida'`, ...f.params).n;
  const routinesLate = one(`SELECT COUNT(*) n FROM routine_occurrences WHERE ${f.sql} AND status = 'atrasada'`, ...f.params).n;

  const bankIncomplete = one(`SELECT COUNT(*) n FROM collaborators c WHERE ${f.sql.replace(/client_id/g, 'c.client_id')} AND NOT EXISTS (SELECT 1 FROM bank_accounts b WHERE b.collaborator_id = c.id)`, ...f.params).n;

  const upcoming = db.prepare(`
    SELECT 'pagamento' AS type, p.due_date AS date, cl.trade_name AS client, c.full_name AS ref
      FROM payments p JOIN clients cl ON cl.id = p.client_id LEFT JOIN collaborators c ON c.id = p.collaborator_id
     WHERE ${f.sql.replace(/client_id/g, 'p.client_id')} AND p.status IN ('programado','aprovado') AND p.due_date >= date('now')
     ORDER BY p.due_date LIMIT 8`).all(...f.params);

  const clFilter = clientScopeFilter(req.user, 'cl.id');
  const pendingByClient = db.prepare(`
    SELECT cl.id, cl.trade_name AS name,
      (SELECT COUNT(*) FROM payments p WHERE p.client_id = cl.id AND p.status = 'atrasado') +
      (SELECT COUNT(*) FROM routine_occurrences o WHERE o.client_id = cl.id AND o.status = 'atrasada') AS pending
     FROM clients cl WHERE ${clFilter.sql} ORDER BY pending DESC LIMIT 8`).all(...clFilter.params);

  res.json({
    totalClients, activeClients, totalCollab, byContract,
    payMonth, payPaid, payLate,
    routinesPending, routinesDone, routinesLate,
    bankIncomplete, upcoming,
    pendingByClient: pendingByClient.filter((c) => c.pending > 0),
  });
});

/* GET /api/dashboard/client/:clientId — per-client KPIs (§13). */
router.get('/client/:clientId', (req, res) => {
  const clientId = Number(req.params.clientId);
  if (!canAccessClient(req.user, clientId)) return res.status(403).json({ error: 'Sem acesso.' });
  const one = (sql) => db.prepare(sql).get(clientId);
  const monthStart = new Date().toISOString().slice(0, 8) + '01';
  const monthEnd = new Date().toISOString().slice(0, 8) + '31';

  res.json({
    collaborators: db.prepare("SELECT COUNT(*) n FROM collaborators WHERE client_id = ? AND prof_status != 'encerrado'").get(clientId).n,
    units: one('SELECT COUNT(*) n FROM units WHERE client_id = ?').n,
    payMonth: db.prepare('SELECT COALESCE(SUM(amount_planned),0) v, COUNT(*) n FROM payments WHERE client_id = ? AND due_date BETWEEN ? AND ?').get(clientId, monthStart, monthEnd),
    payPaid: db.prepare("SELECT COALESCE(SUM(amount_paid),0) v FROM payments WHERE client_id = ? AND status = 'pago' AND due_date BETWEEN ? AND ?").get(clientId, monthStart, monthEnd).v,
    payLate: one("SELECT COUNT(*) n FROM payments WHERE client_id = ? AND status = 'atrasado'").n,
    routinesPending: one("SELECT COUNT(*) n FROM routine_occurrences WHERE client_id = ? AND status = 'pendente'").n,
    routinesLate: one("SELECT COUNT(*) n FROM routine_occurrences WHERE client_id = ? AND status = 'atrasada'").n,
    routinesDone: one("SELECT COUNT(*) n FROM routine_occurrences WHERE client_id = ? AND status = 'concluida'").n,
    credentials: one('SELECT COUNT(*) n FROM credentials WHERE client_id = ?').n,
    alerts: one("SELECT COUNT(*) n FROM notifications WHERE client_id = ? AND read_at IS NULL AND scope = 'geral'").n,
  });
});

export default router;
