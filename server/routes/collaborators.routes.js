import { Router } from 'express';
import db from '../db.js';
import { canAccessClient, hasPermission, isAdmin, requirePermission } from '../auth.js';
import { audit } from '../audit.js';
import { maskBank, maskCollaborator, parseJSON } from '../helpers.js';

const router = Router();

const FIELDS = [
  'unit_id', 'full_name', 'social_name', 'cpf', 'rg', 'rg_issuer', 'birth_date',
  'phone', 'whatsapp', 'email', 'zip', 'street', 'number', 'complement', 'district',
  'city', 'state', 'marital_status', 'emergency_name', 'emergency_phone', 'photo_url',
  'notes', 'role_title', 'sector', 'manager', 'prof_start', 'prof_end', 'prof_status',
  'schedule', 'pay_amount', 'pay_model', 'contract_type', 'prof_notes',
];

function ensureClient(req, res, clientId) {
  if (!canAccessClient(req.user, clientId)) {
    res.status(403).json({ error: 'Sem acesso a este cliente.' });
    return false;
  }
  return true;
}

/* GET /api/collaborators?client_id= — list, tenant-scoped, CPF masked. */
router.get('/', (req, res) => {
  const clientId = Number(req.query.client_id);
  if (!ensureClient(req, res, clientId)) return;
  const { q, status, unit_id } = req.query;
  let where = 'client_id = ?';
  const args = [clientId];
  if (status) { where += ' AND prof_status = ?'; args.push(status); }
  if (unit_id) { where += ' AND unit_id = ?'; args.push(Number(unit_id)); }
  if (q) { where += ' AND (full_name LIKE ? OR role_title LIKE ?)'; args.push(`%${q}%`, `%${q}%`); }
  const rows = db.prepare(`SELECT * FROM collaborators WHERE ${where} ORDER BY full_name`).all(...args);
  res.json(rows.map((r) => maskCollaborator(r, req.user)));
});

/* GET /api/collaborators/:id — detail with (masked) bank + contract data. */
router.get('/:id', (req, res) => {
  const collab = db.prepare('SELECT * FROM collaborators WHERE id = ?').get(Number(req.params.id));
  if (!collab) return res.status(404).json({ error: 'Colaborador não encontrado.' });
  if (!ensureClient(req, res, collab.client_id)) return;
  const bank = db.prepare('SELECT * FROM bank_accounts WHERE collaborator_id = ?').get(collab.id);
  res.json({
    ...maskCollaborator(collab, req.user),
    contract_data: parseJSON(collab.contract_data, {}),
    bank: bank ? maskBank(bank, req.user) : null,
  });
});

/* POST /api/collaborators */
router.post('/', requirePermission('manage_collaborators'), (req, res) => {
  const clientId = Number(req.body.client_id);
  if (!ensureClient(req, res, clientId)) return;
  if (!req.body.full_name) return res.status(400).json({ error: 'Nome completo é obrigatório.' });
  const data = { client_id: clientId };
  for (const f of FIELDS) data[f] = req.body[f] ?? null;
  data.contract_data = req.body.contract_data ? JSON.stringify(req.body.contract_data) : '{}';
  const cols = ['client_id', ...FIELDS, 'contract_data'];
  const info = db.prepare(
    `INSERT INTO collaborators (${cols.join(',')}) VALUES (${cols.map((c) => `@${c}`).join(',')})`,
  ).run(data);
  audit(req, { action: 'create', entityType: 'collaborator', entityId: info.lastInsertRowid, clientId });
  res.status(201).json({ id: info.lastInsertRowid });
});

/* PUT /api/collaborators/:id */
router.put('/:id', requirePermission('manage_collaborators'), (req, res) => {
  const collab = db.prepare('SELECT * FROM collaborators WHERE id = ?').get(Number(req.params.id));
  if (!collab) return res.status(404).json({ error: 'Colaborador não encontrado.' });
  if (!ensureClient(req, res, collab.client_id)) return;
  const sets = []; const args = { id: collab.id };
  for (const f of FIELDS) if (req.body[f] !== undefined) { sets.push(`${f} = @${f}`); args[f] = req.body[f]; }
  if (req.body.contract_data !== undefined) { sets.push('contract_data = @contract_data'); args.contract_data = JSON.stringify(req.body.contract_data); }
  if (!sets.length) return res.json({ ok: true });
  db.prepare(`UPDATE collaborators SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = @id`).run(args);
  audit(req, { action: 'update', entityType: 'collaborator', entityId: collab.id, clientId: collab.client_id });
  res.json({ ok: true });
});

router.delete('/:id', requirePermission('manage_collaborators'), (req, res) => {
  const collab = db.prepare('SELECT * FROM collaborators WHERE id = ?').get(Number(req.params.id));
  if (!collab) return res.status(404).json({ error: 'Colaborador não encontrado.' });
  if (!ensureClient(req, res, collab.client_id)) return;
  db.prepare('DELETE FROM collaborators WHERE id = ?').run(collab.id);
  audit(req, { action: 'delete', entityType: 'collaborator', entityId: collab.id, clientId: collab.client_id });
  res.json({ ok: true });
});

/* --------------------------- Bank accounts ---------------------------- */
const BANK_FIELDS = ['holder_name', 'holder_doc', 'bank_name', 'bank_code', 'agency', 'account', 'account_digit', 'account_type', 'pix_key', 'pix_type', 'preferred_method', 'notes'];

/* GET full bank data — requires view_bank_full, and is audited (§6). */
router.get('/:id/bank/full', requirePermission('view_bank_full'), (req, res) => {
  const collab = db.prepare('SELECT * FROM collaborators WHERE id = ?').get(Number(req.params.id));
  if (!collab) return res.status(404).json({ error: 'Colaborador não encontrado.' });
  if (!ensureClient(req, res, collab.client_id)) return;
  const bank = db.prepare('SELECT * FROM bank_accounts WHERE collaborator_id = ?').get(collab.id);
  audit(req, { action: 'view_bank_full', entityType: 'bank_account', entityId: bank?.id, clientId: collab.client_id });
  res.json(bank ? { ...bank, _full: true } : null);
});

/* PUT bank data — audited; requires manage_collaborators. */
router.put('/:id/bank', requirePermission('manage_collaborators'), (req, res) => {
  const collab = db.prepare('SELECT * FROM collaborators WHERE id = ?').get(Number(req.params.id));
  if (!collab) return res.status(404).json({ error: 'Colaborador não encontrado.' });
  if (!ensureClient(req, res, collab.client_id)) return;
  const existing = db.prepare('SELECT id FROM bank_accounts WHERE collaborator_id = ?').get(collab.id);
  const data = { collaborator_id: collab.id, client_id: collab.client_id };
  for (const f of BANK_FIELDS) data[f] = req.body[f] ?? null;
  if (existing) {
    const sets = BANK_FIELDS.map((f) => `${f} = @${f}`).join(', ');
    db.prepare(`UPDATE bank_accounts SET ${sets}, last_validated_at = datetime('now'), updated_at = datetime('now') WHERE collaborator_id = @collaborator_id`).run(data);
  } else {
    const cols = ['collaborator_id', 'client_id', ...BANK_FIELDS];
    db.prepare(`INSERT INTO bank_accounts (${cols.join(',')}, last_validated_at) VALUES (${cols.map((c) => `@${c}`).join(',')}, datetime('now'))`).run(data);
  }
  audit(req, { action: 'update_bank', entityType: 'bank_account', entityId: collab.id, clientId: collab.client_id });
  res.json({ ok: true });
});

export default router;
