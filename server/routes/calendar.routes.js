import { Router } from 'express';
import db from '../db.js';
import { canAccessClient, clientScopeFilter } from '../auth.js';

const router = Router();

/**
 * Builds a unified event list (§9, §10) from payments, routine occurrences and
 * document/contract due dates for a set of clients. Vault data is deliberately
 * excluded from the common calendar (§13).
 */
function buildEvents(clientFilter, args, { from, to, types }) {
  const events = [];
  const typeSet = types ? new Set(types.split(',')) : null;
  const want = (t) => !typeSet || typeSet.has(t);

  const dateClause = (col) => {
    let c = '';
    const a = [];
    if (from) { c += ` AND ${col} >= ?`; a.push(from); }
    if (to) { c += ` AND ${col} <= ?`; a.push(to); }
    return { c, a };
  };

  if (want('pagamento')) {
    const d = dateClause('p.due_date');
    const rows = db.prepare(`
      SELECT p.id, p.due_date AS date, p.status, p.amount_planned, p.client_id,
             c.full_name AS collaborator, cl.trade_name AS client_name
        FROM payments p
        LEFT JOIN collaborators c ON c.id = p.collaborator_id
        JOIN clients cl ON cl.id = p.client_id
       WHERE ${clientFilter.replace(/client_id/g, 'p.client_id')}${d.c}`).all(...args, ...d.a);
    for (const r of rows) {
      const kind = r.status === 'atrasado' ? 'pagamento_atrasado' : (r.status === 'pago' ? 'pagamento_pago' : 'pagamento');
      events.push({ type: 'pagamento', kind, id: `pay-${r.id}`, refId: r.id, date: r.date, title: `Pagamento: ${r.collaborator || 'Avulso'}`, status: r.status, amount: r.amount_planned, clientId: r.client_id, clientName: r.client_name });
    }
  }

  if (want('rotina')) {
    const d = dateClause('o.date');
    const rows = db.prepare(`
      SELECT o.id, o.date, o.status, o.client_id, r.title, cl.trade_name AS client_name
        FROM routine_occurrences o
        JOIN routines r ON r.id = o.routine_id
        JOIN clients cl ON cl.id = o.client_id
       WHERE ${clientFilter.replace(/client_id/g, 'o.client_id')}${d.c}`).all(...args, ...d.a);
    for (const r of rows) {
      events.push({ type: 'rotina', kind: r.status === 'atrasada' ? 'rotina_atrasada' : 'rotina', id: `rt-${r.id}`, refId: r.id, date: r.date, title: `Rotina: ${r.title}`, status: r.status, clientId: r.client_id, clientName: r.client_name });
    }
  }

  if (want('vencimento')) {
    const d = dateClause('end_date');
    const rows = db.prepare(`
      SELECT id, end_date AS date, trade_name FROM clients
       WHERE ${clientFilter.replace(/client_id/g, 'id')} AND end_date IS NOT NULL${d.c}`).all(...args, ...d.a);
    for (const r of rows) {
      events.push({ type: 'vencimento', kind: 'vencimento', id: `cli-${r.id}`, refId: r.id, date: r.date, title: `Encerramento consultoria: ${r.trade_name}`, clientId: r.id, clientName: r.trade_name });
    }
  }

  events.sort((a, b) => (a.date < b.date ? -1 : 1));
  return events;
}

/* GET /api/calendar/client/:clientId — individual calendar (§9). */
router.get('/client/:clientId', (req, res) => {
  const clientId = Number(req.params.clientId);
  if (!canAccessClient(req.user, clientId)) return res.status(403).json({ error: 'Sem acesso.' });
  const events = buildEvents('client_id = ?', [clientId], req.query);
  res.json(events);
});

/* GET /api/calendar/general — consultancy-wide calendar (§10). Tenant-scoped. */
router.get('/general', (req, res) => {
  const filter = clientScopeFilter(req.user, 'client_id');
  let clientFilter = filter.sql;
  const args = [...filter.params];
  if (req.query.client_id) {
    clientFilter += ' AND client_id = ?';
    args.push(Number(req.query.client_id));
  }
  const events = buildEvents(clientFilter, args, req.query);

  // Summary totals for the general panel (§10).
  const totals = { previsto: 0, pago: 0, atrasado: 0, pagamentosPendentes: 0, rotinasPendentes: 0, concluidas: 0 };
  for (const e of events) {
    if (e.type === 'pagamento') {
      if (e.status === 'pago') totals.pago += e.amount || 0;
      else if (e.status === 'atrasado') { totals.atrasado += e.amount || 0; totals.pagamentosPendentes += 1; }
      else { totals.previsto += e.amount || 0; totals.pagamentosPendentes += 1; }
    } else if (e.type === 'rotina') {
      if (e.status === 'concluida') totals.concluidas += 1;
      else totals.rotinasPendentes += 1;
    }
  }
  res.json({ events, totals });
});

export default router;
