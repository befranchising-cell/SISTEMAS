import db from './db.js';

/** Records a general audit entry (§23, §26). Immutable by design — no update/delete path exposed. */
export function audit(req, { action, entityType = null, entityId = null, clientId = null, detail = null }) {
  db.prepare(
    `INSERT INTO audit_logs (user_id, user_name, client_id, action, entity_type, entity_id, detail, ip, device)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    req.user?.id ?? null,
    req.user?.full_name ?? null,
    clientId,
    action,
    entityType,
    entityId,
    detail ? JSON.stringify(detail).slice(0, 2000) : null,
    req.ip || null,
    req.get?.('user-agent')?.slice(0, 255) || null,
  );
}

/** Records a vault-specific audit entry (§23). Password/PIN content never passes through here. */
export function vaultLog(req, { action, result = 'ok', clientId = null, credentialId = null, detail = null }) {
  db.prepare(
    `INSERT INTO vault_logs (user_id, user_name, client_id, credential_id, action, result, ip, device, detail)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    req.user?.id ?? null,
    req.user?.full_name ?? null,
    clientId,
    credentialId,
    action,
    result,
    req.ip || null,
    req.get?.('user-agent')?.slice(0, 255) || null,
    detail ? String(detail).slice(0, 500) : null,
  );
}

/** Creates a notification (never carries secret content — §24). */
export function notify({ clientId = null, type, scope = 'geral', severity = 'info', title, message = null }) {
  db.prepare(
    `INSERT INTO notifications (client_id, type, scope, severity, title, message)
     VALUES (?,?,?,?,?,?)`,
  ).run(clientId, type, scope, severity, title, message);
}
