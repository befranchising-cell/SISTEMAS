import { Router } from 'express';
import db from '../db.js';
import { isAdmin, canAccessClient, clientScopeFilter, requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { bool } from '../helpers.js';

const router = Router();

const CLIENT_FIELDS = [
  'trade_name', 'legal_name', 'cnpj', 'state_reg', 'municipal_reg', 'segment',
  'phone', 'whatsapp', 'email', 'website', 'zip', 'street', 'number', 'complement',
  'district', 'city', 'state', 'resp_name', 'resp_cpf', 'resp_role', 'resp_phone',
  'resp_email', 'start_date', 'end_date', 'status', 'notes',
];

/* GET /api/clients — list with per-client summary (§2). Tenant-scoped. */
router.get('/', (req, res) => {
  const { sql, params } = clientScopeFilter(req.user, 'id');
  const { q, status } = req.query;
  let where = sql;
  const args = [...params];
  if (status) { where += ' AND status = ?'; args.push(status); }
  if (q) { where += ' AND (trade_name LIKE ? OR legal_name LIKE ? OR cnpj LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`); }

  const clients = db.prepare(`SELECT * FROM clients WHERE ${where} ORDER BY trade_name`).all(...args);
  const today = new Date().toISOString().slice(0, 10);

  const enriched = clients.map((c) => {
    const collaborators = db.prepare("SELECT COUNT(*) n FROM collaborators WHERE client_id = ? AND prof_status != 'encerrado'").get(c.id).n;
    const nextPayment = db.prepare("SELECT MIN(due_date) d FROM payments WHERE client_id = ? AND status IN ('programado','aprovado','aguardando_aprovacao') AND due_date >= ?").get(c.id, today).d;
    const nextRoutine = db.prepare("SELECT MIN(date) d FROM routine_occurrences WHERE client_id = ? AND status = 'pendente' AND date >= ?").get(c.id, today).d;
    const latePayments = db.prepare("SELECT COUNT(*) n FROM payments WHERE client_id = ? AND status = 'atrasado'").get(c.id).n;
    const lateRoutines = db.prepare("SELECT COUNT(*) n FROM routine_occurrences WHERE client_id = ? AND status = 'atrasada'").get(c.id).n;
    const alerts = db.prepare("SELECT COUNT(*) n FROM notifications WHERE client_id = ? AND read_at IS NULL AND scope = 'geral'").get(c.id).n;
    return {
      ...c,
      summary: {
        collaborators,
        nextPayment,
        nextRoutine,
        pending: latePayments + lateRoutines,
        latePayments,
        lateRoutines,
        alerts,
      },
    };
  });
  res.json(enriched);
});

/* GET /api/clients/:clientId */
router.get('/:clientId', (req, res) => {
  const id = Number(req.params.clientId);
  if (!canAccessClient(req.user, id)) return res.status(403).json({ error: 'Sem acesso a este cliente.' });
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  if (!client) return res.status(404).json({ error: 'Cliente não encontrado.' });
  const units = db.prepare('SELECT * FROM units WHERE client_id = ? ORDER BY name').all(id);
  res.json({ ...client, units });
});

/* POST /api/clients — only admins create/remove clients (§14.1). */
router.post('/', requireRole('admin_geral'), (req, res) => {
  const data = {};
  for (const f of CLIENT_FIELDS) data[f] = req.body[f] ?? null;
  if (!data.trade_name) return res.status(400).json({ error: 'Nome fantasia é obrigatório.' });
  const cols = CLIENT_FIELDS.join(',');
  const placeholders = CLIENT_FIELDS.map((f) => `@${f}`).join(',');
  const info = db.prepare(`INSERT INTO clients (${cols}) VALUES (${placeholders})`).run(data);
  audit(req, { action: 'create', entityType: 'client', entityId: info.lastInsertRowid, clientId: info.lastInsertRowid });
  res.status(201).json({ id: info.lastInsertRowid });
});

/* PUT /api/clients/:clientId */
router.put('/:clientId', (req, res) => {
  const id = Number(req.params.clientId);
  if (!isAdmin(req.user) && !canAccessClient(req.user, id)) return res.status(403).json({ error: 'Sem acesso.' });
  const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(id);
  if (!client) return res.status(404).json({ error: 'Cliente não encontrado.' });
  const sets = [];
  const args = {};
  for (const f of CLIENT_FIELDS) {
    if (req.body[f] !== undefined) { sets.push(`${f} = @${f}`); args[f] = req.body[f]; }
  }
  if (sets.length === 0) return res.json({ ok: true });
  args.id = id;
  db.prepare(`UPDATE clients SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = @id`).run(args);
  audit(req, { action: 'update', entityType: 'client', entityId: id, clientId: id });
  res.json({ ok: true });
});

/* DELETE /api/clients/:clientId — admin only. */
router.delete('/:clientId', requireRole('admin_geral'), (req, res) => {
  const id = Number(req.params.clientId);
  db.prepare('DELETE FROM clients WHERE id = ?').run(id);
  audit(req, { action: 'delete', entityType: 'client', entityId: id, clientId: id });
  res.json({ ok: true });
});

/* ------------------------------- Units -------------------------------- */
const UNIT_FIELDS = ['name', 'internal_code', 'cnpj', 'zip', 'street', 'number', 'complement', 'district', 'city', 'state', 'phone', 'email', 'responsible', 'hours', 'status', 'notes'];

router.get('/:clientId/units', (req, res) => {
  const id = Number(req.params.clientId);
  if (!canAccessClient(req.user, id)) return res.status(403).json({ error: 'Sem acesso.' });
  res.json(db.prepare('SELECT * FROM units WHERE client_id = ? ORDER BY name').all(id));
});

router.post('/:clientId/units', (req, res) => {
  const id = Number(req.params.clientId);
  if (!canAccessClient(req.user, id)) return res.status(403).json({ error: 'Sem acesso.' });
  if (!req.body.name) return res.status(400).json({ error: 'Nome da unidade é obrigatório.' });
  const data = { client_id: id };
  for (const f of UNIT_FIELDS) data[f] = req.body[f] ?? null;
  const cols = ['client_id', ...UNIT_FIELDS].join(',');
  const ph = ['client_id', ...UNIT_FIELDS].map((f) => `@${f}`).join(',');
  const info = db.prepare(`INSERT INTO units (${cols}) VALUES (${ph})`).run(data);
  audit(req, { action: 'create', entityType: 'unit', entityId: info.lastInsertRowid, clientId: id });
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/:clientId/units/:unitId', (req, res) => {
  const id = Number(req.params.clientId);
  const unitId = Number(req.params.unitId);
  if (!canAccessClient(req.user, id)) return res.status(403).json({ error: 'Sem acesso.' });
  const unit = db.prepare('SELECT id FROM units WHERE id = ? AND client_id = ?').get(unitId, id);
  if (!unit) return res.status(404).json({ error: 'Unidade não encontrada.' });
  const sets = []; const args = {};
  for (const f of UNIT_FIELDS) if (req.body[f] !== undefined) { sets.push(`${f} = @${f}`); args[f] = req.body[f]; }
  if (!sets.length) return res.json({ ok: true });
  args.id = unitId;
  db.prepare(`UPDATE units SET ${sets.join(', ')} WHERE id = @id`).run(args);
  audit(req, { action: 'update', entityType: 'unit', entityId: unitId, clientId: id });
  res.json({ ok: true });
});

router.delete('/:clientId/units/:unitId', (req, res) => {
  const id = Number(req.params.clientId);
  const unitId = Number(req.params.unitId);
  if (!canAccessClient(req.user, id)) return res.status(403).json({ error: 'Sem acesso.' });
  db.prepare('DELETE FROM units WHERE id = ? AND client_id = ?').run(unitId, id);
  audit(req, { action: 'delete', entityType: 'unit', entityId: unitId, clientId: id });
  res.json({ ok: true });
});

export default router;
