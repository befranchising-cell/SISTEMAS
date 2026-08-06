import { Router } from 'express';
import db from '../db.js';
import { canAccessClient, hasPermission, requirePermission } from '../auth.js';
import { audit } from '../audit.js';
import { generateOccurrences } from '../recurrence.js';
import { parseJSON } from '../helpers.js';

const router = Router();

function ensureClient(req, res, clientId) {
  if (!canAccessClient(req.user, clientId)) { res.status(403).json({ error: 'Sem acesso a este cliente.' }); return false; }
  return true;
}

/* POST /api/routines/preview — occurrence preview before saving (§12). */
router.post('/preview', (req, res) => {
  const dates = generateOccurrences(req.body || {});
  res.json({ count: dates.length, dates });
});

/* GET /api/routines?client_id= */
router.get('/', (req, res) => {
  const clientId = Number(req.query.client_id);
  if (!ensureClient(req, res, clientId)) return;
  const rows = db.prepare('SELECT * FROM routines WHERE client_id = ? ORDER BY created_at DESC').all(clientId);
  const withCounts = rows.map((r) => {
    const pending = db.prepare("SELECT COUNT(*) n FROM routine_occurrences WHERE routine_id = ? AND status = 'pendente'").get(r.id).n;
    const late = db.prepare("SELECT COUNT(*) n FROM routine_occurrences WHERE routine_id = ? AND status = 'atrasada'").get(r.id).n;
    return { ...r, checklist: parseJSON(r.checklist, []), pending, late };
  });
  res.json(withCounts);
});

/* GET /api/routines/:id — routine + its occurrences. */
router.get('/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM routines WHERE id = ?').get(Number(req.params.id));
  if (!r) return res.status(404).json({ error: 'Rotina não encontrada.' });
  if (!ensureClient(req, res, r.client_id)) return;
  const occ = db.prepare('SELECT * FROM routine_occurrences WHERE routine_id = ? ORDER BY date').all(r.id);
  res.json({ ...r, checklist: parseJSON(r.checklist, []), config: parseJSON(r.config, {}), occurrences: occ });
});

const FIELDS = ['unit_id', 'title', 'description', 'sector', 'category', 'responsible', 'participants', 'frequency', 'start_date', 'end_date', 'time', 'estimated_minutes', 'priority', 'instructions', 'needs_proof', 'notes'];

/* POST /api/routines — create routine + generate occurrences. */
router.post('/', requirePermission('manage_routines'), (req, res) => {
  const clientId = Number(req.body.client_id);
  if (!ensureClient(req, res, clientId)) return;
  if (!req.body.title) return res.status(400).json({ error: 'Título é obrigatório.' });
  const config = req.body.config || {};
  const data = { client_id: clientId };
  for (const f of FIELDS) data[f] = req.body[f] ?? null;
  data.config = JSON.stringify(config);
  data.checklist = JSON.stringify(req.body.checklist || []);

  const cols = ['client_id', ...FIELDS, 'config', 'checklist'];
  const tx = db.transaction(() => {
    const rid = db.prepare(`INSERT INTO routines (${cols.join(',')}) VALUES (${cols.map((c) => `@${c}`).join(',')})`).run(data).lastInsertRowid;
    let dates = [];
    if (req.body.frequency && req.body.frequency !== 'pontual') {
      dates = generateOccurrences({ frequency: req.body.frequency, ...config });
    } else if (req.body.start_date) {
      dates = [req.body.start_date];
    }
    const ins = db.prepare("INSERT INTO routine_occurrences (routine_id, client_id, date, status) VALUES (?,?,?, 'pendente')");
    for (const d of dates) ins.run(rid, clientId, d);
    return { rid, count: dates.length };
  });
  const { rid, count } = tx();
  audit(req, { action: 'create', entityType: 'routine', entityId: rid, clientId, detail: { occurrences: count } });
  res.status(201).json({ id: rid, occurrences: count });
});

/* PUT /api/routines/:id */
router.put('/:id', requirePermission('manage_routines'), (req, res) => {
  const r = db.prepare('SELECT * FROM routines WHERE id = ?').get(Number(req.params.id));
  if (!r) return res.status(404).json({ error: 'Rotina não encontrada.' });
  if (!ensureClient(req, res, r.client_id)) return;
  const sets = []; const args = { id: r.id };
  for (const f of FIELDS) if (req.body[f] !== undefined) { sets.push(`${f} = @${f}`); args[f] = req.body[f]; }
  if (req.body.checklist !== undefined) { sets.push('checklist = @checklist'); args.checklist = JSON.stringify(req.body.checklist); }
  if (!sets.length) return res.json({ ok: true });
  db.prepare(`UPDATE routines SET ${sets.join(', ')} WHERE id = @id`).run(args);
  audit(req, { action: 'update', entityType: 'routine', entityId: r.id, clientId: r.client_id });
  res.json({ ok: true });
});

router.delete('/:id', requirePermission('manage_routines'), (req, res) => {
  const r = db.prepare('SELECT * FROM routines WHERE id = ?').get(Number(req.params.id));
  if (!r) return res.status(404).json({ error: 'Rotina não encontrada.' });
  if (!ensureClient(req, res, r.client_id)) return;
  db.prepare('DELETE FROM routines WHERE id = ?').run(r.id);
  audit(req, { action: 'delete', entityType: 'routine', entityId: r.id, clientId: r.client_id });
  res.json({ ok: true });
});

/* --------- Occurrence actions: complete / reschedule / cancel --------- */
function loadOcc(req) {
  const occ = db.prepare('SELECT * FROM routine_occurrences WHERE id = ?').get(Number(req.params.occId));
  return occ;
}

router.post('/occurrences/:occId/complete', (req, res) => {
  const occ = loadOcc(req);
  if (!occ) return res.status(404).json({ error: 'Ocorrência não encontrada.' });
  if (!ensureClient(req, res, occ.client_id)) return;
  if (!hasPermission(req.user, 'complete_routines') && !hasPermission(req.user, 'manage_routines')) {
    return res.status(403).json({ error: 'Sem permissão para concluir.' });
  }
  db.prepare("UPDATE routine_occurrences SET status = 'concluida', completed_at = datetime('now'), completed_by = ?, proof_url = ?, notes = ? WHERE id = ?")
    .run(req.user.full_name, req.body.proof_url ?? null, req.body.notes ?? occ.notes, occ.id);
  audit(req, { action: 'complete', entityType: 'routine_occurrence', entityId: occ.id, clientId: occ.client_id });
  res.json({ ok: true });
});

router.put('/occurrences/:occId', requirePermission('manage_routines'), (req, res) => {
  const occ = loadOcc(req);
  if (!occ) return res.status(404).json({ error: 'Ocorrência não encontrada.' });
  if (!ensureClient(req, res, occ.client_id)) return;
  const status = req.body.status;
  const validOcc = new Set(['pendente', 'concluida', 'atrasada', 'cancelada']);
  const sets = []; const args = { id: occ.id };
  if (status !== undefined) { if (!validOcc.has(status)) return res.status(400).json({ error: 'Status inválido.' }); sets.push('status = @status'); args.status = status; }
  if (req.body.date !== undefined) { sets.push('date = @date'); args.date = req.body.date; }
  if (req.body.notes !== undefined) { sets.push('notes = @notes'); args.notes = req.body.notes; }
  if (!sets.length) return res.json({ ok: true });
  db.prepare(`UPDATE routine_occurrences SET ${sets.join(', ')} WHERE id = @id`).run(args);
  audit(req, { action: 'update', entityType: 'routine_occurrence', entityId: occ.id, clientId: occ.client_id });
  res.json({ ok: true });
});

export default router;
