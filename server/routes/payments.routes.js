import { Router } from 'express';
import db from '../db.js';
import { canAccessClient, hasPermission, requirePermission } from '../auth.js';
import { audit } from '../audit.js';
import { generateOccurrences } from '../recurrence.js';

const router = Router();

const VALID_STATUS = new Set([
  'programado', 'aguardando_documento', 'aguardando_nota', 'aguardando_aprovacao',
  'aprovado', 'pago', 'pago_parcial', 'atrasado', 'cancelado',
]);

function ensureClient(req, res, clientId) {
  if (!canAccessClient(req.user, clientId)) { res.status(403).json({ error: 'Sem acesso a este cliente.' }); return false; }
  return true;
}

/* POST /api/payments/preview — dry-run recurrence preview before saving (§7). */
router.post('/preview', (req, res) => {
  const dates = generateOccurrences(req.body || {});
  res.json({ count: dates.length, dates });
});

/* GET /api/payments?client_id=&status=&from=&to=&collaborator_id= */
router.get('/', (req, res) => {
  const clientId = Number(req.query.client_id);
  if (!ensureClient(req, res, clientId)) return;
  const { status, from, to, collaborator_id } = req.query;
  let where = 'p.client_id = ?';
  const args = [clientId];
  if (status) { where += ' AND p.status = ?'; args.push(status); }
  if (collaborator_id) { where += ' AND p.collaborator_id = ?'; args.push(Number(collaborator_id)); }
  if (from) { where += ' AND p.due_date >= ?'; args.push(from); }
  if (to) { where += ' AND p.due_date <= ?'; args.push(to); }
  const rows = db.prepare(`
    SELECT p.*, c.full_name AS collaborator_name, u.name AS unit_name
      FROM payments p
      LEFT JOIN collaborators c ON c.id = p.collaborator_id
      LEFT JOIN units u ON u.id = p.unit_id
     WHERE ${where} ORDER BY p.due_date`).all(...args);
  res.json(rows);
});

/* GET /api/payments/:id */
router.get('/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Pagamento não encontrado.' });
  if (!ensureClient(req, res, p.client_id)) return;
  res.json(p);
});

/* POST /api/payments/schedule — create schedule + generate payments (§7). */
router.post('/schedule', requirePermission('manage_payments'), (req, res) => {
  const clientId = Number(req.body.client_id);
  if (!ensureClient(req, res, clientId)) return;
  const { collaborator_id, unit_id, frequency, amount, needs_invoice, competence, config = {} } = req.body;
  if (!collaborator_id || !frequency) return res.status(400).json({ error: 'Colaborador e periodicidade são obrigatórios.' });

  const collab = db.prepare('SELECT id, contract_type FROM collaborators WHERE id = ? AND client_id = ?').get(Number(collaborator_id), clientId);
  if (!collab) return res.status(400).json({ error: 'Colaborador inválido para este cliente.' });

  const dates = generateOccurrences({ frequency, ...config });
  if (dates.length === 0) return res.status(400).json({ error: 'A configuração não gera nenhuma data.' });

  const tx = db.transaction(() => {
    const sid = db.prepare(`INSERT INTO payment_schedules
      (client_id, collaborator_id, frequency, config, amount, weekend_strategy, needs_invoice, competence)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      clientId, collab.id, frequency, JSON.stringify(config), amount ?? null,
      config.weekendStrategy || 'keep', needs_invoice ? 1 : 0, competence ?? null,
    ).lastInsertRowid;
    const ins = db.prepare(`INSERT INTO payments
      (client_id, unit_id, collaborator_id, schedule_id, contract_type, competence, due_date, amount_planned, status, needs_invoice)
      VALUES (?,?,?,?,?,?,?,?, 'programado', ?)`);
    for (const d of dates) {
      ins.run(clientId, unit_id ?? null, collab.id, sid, collab.contract_type, competence ?? null, d, amount ?? null, needs_invoice ? 1 : 0);
    }
    return sid;
  });
  const sid = tx();
  audit(req, { action: 'create', entityType: 'payment_schedule', entityId: sid, clientId, detail: { generated: dates.length } });
  res.status(201).json({ schedule_id: sid, generated: dates.length });
});

/* POST /api/payments — single manual payment. */
router.post('/', requirePermission('manage_payments'), (req, res) => {
  const clientId = Number(req.body.client_id);
  if (!ensureClient(req, res, clientId)) return;
  const { collaborator_id, unit_id, competence, due_date, amount_planned, needs_invoice, notes } = req.body;
  if (!due_date) return res.status(400).json({ error: 'Data de vencimento é obrigatória.' });
  const info = db.prepare(`INSERT INTO payments
    (client_id, unit_id, collaborator_id, competence, due_date, amount_planned, status, needs_invoice, notes)
    VALUES (?,?,?,?,?,?, 'programado', ?, ?)`).run(
    clientId, unit_id ?? null, collaborator_id ?? null, competence ?? null, due_date, amount_planned ?? null, needs_invoice ? 1 : 0, notes ?? null,
  );
  audit(req, { action: 'create', entityType: 'payment', entityId: info.lastInsertRowid, clientId });
  res.status(201).json({ id: info.lastInsertRowid });
});

/* PUT /api/payments/:id — update / change status / reschedule / partial. */
router.put('/:id', requirePermission('manage_payments'), (req, res) => {
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Pagamento não encontrado.' });
  if (!ensureClient(req, res, p.client_id)) return;
  const editable = ['due_date', 'paid_date', 'amount_planned', 'amount_paid', 'discounts', 'additions', 'method', 'pay_account', 'status', 'approver', 'paid_by', 'notes', 'competence'];
  const sets = []; const args = { id: p.id };
  for (const f of editable) {
    if (req.body[f] !== undefined) {
      if (f === 'status' && !VALID_STATUS.has(req.body[f])) return res.status(400).json({ error: 'Status inválido.' });
      sets.push(`${f} = @${f}`); args[f] = req.body[f];
    }
  }
  if (!sets.length) return res.json({ ok: true });
  db.prepare(`UPDATE payments SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = @id`).run(args);
  audit(req, { action: 'update', entityType: 'payment', entityId: p.id, clientId: p.client_id, detail: { status: req.body.status } });
  res.json({ ok: true });
});

/* POST /api/payments/bulk-pay — mark several as paid at once (§8). */
router.post('/bulk-pay', requirePermission('manage_payments'), (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : [];
  const paidDate = req.body.paid_date || new Date().toISOString().slice(0, 10);
  if (!ids.length) return res.status(400).json({ error: 'Nenhum pagamento selecionado.' });
  let updated = 0;
  const tx = db.transaction(() => {
    for (const id of ids) {
      const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
      if (!p || !canAccessClient(req.user, p.client_id)) continue;
      db.prepare("UPDATE payments SET status = 'pago', paid_date = ?, amount_paid = COALESCE(amount_paid, amount_planned), paid_by = ?, updated_at = datetime('now') WHERE id = ?")
        .run(paidDate, req.user.full_name, id);
      updated += 1;
    }
  });
  tx();
  audit(req, { action: 'bulk_pay', entityType: 'payment', detail: { count: updated } });
  res.json({ updated });
});

/* Approval action (clients may approve — §14.3). */
router.post('/:id/approve', (req, res) => {
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Pagamento não encontrado.' });
  if (!ensureClient(req, res, p.client_id)) return;
  if (!hasPermission(req.user, 'approve_payments') && !hasPermission(req.user, 'manage_payments')) {
    return res.status(403).json({ error: 'Sem permissão para aprovar.' });
  }
  db.prepare("UPDATE payments SET status = 'aprovado', approver = ?, updated_at = datetime('now') WHERE id = ?").run(req.user.full_name, p.id);
  audit(req, { action: 'approve', entityType: 'payment', entityId: p.id, clientId: p.client_id });
  res.json({ ok: true });
});

export default router;
