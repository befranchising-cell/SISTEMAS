import jwt from 'jsonwebtoken';
import db from './db.js';
import { config } from './config.js';

/**
 * Authentication & authorization layer.
 *
 * Roles (spec §14): admin_geral, consultor, cliente, operacional.
 * Tenant isolation (spec §2, §32): every non-admin user carries an explicit
 * allow-list of client ids. All scoping is enforced HERE, on the server — the
 * UI is never trusted.
 */

export function issueToken(user) {
  return jwt.sign(
    { uid: user.id, role: user.role_key },
    config.jwtSecret,
    { expiresIn: `${config.sessionTtlMinutes}m` },
  );
}

/** Loads the full user context (role, permissions, allowed clients). */
export function loadUserContext(userId) {
  const user = db
    .prepare(
      `SELECT u.*, r.key AS role_key, r.name AS role_name
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.id = ?`,
    )
    .get(userId);
  if (!user) return null;

  const permsRow = db.prepare('SELECT permissions FROM user_permissions WHERE user_id = ?').get(userId);
  user.permissions = permsRow ? JSON.parse(permsRow.permissions) : {};

  const clientRows = db.prepare('SELECT client_id FROM user_clients WHERE user_id = ?').all(userId);
  user.clientIds = clientRows.map((r) => r.client_id);

  const unitRows = db.prepare('SELECT unit_id FROM user_units WHERE user_id = ?').all(userId);
  user.unitIds = unitRows.map((r) => r.unit_id);
  return user;
}

/** Express middleware: verifies the JWT cookie and attaches req.user. */
export function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = loadUserContext(payload.uid);
    if (!user || user.status !== 'ativo') {
      return res.status(401).json({ error: 'Sessão inválida.' });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Sessão expirada.' });
  }
}

export function isAdmin(user) {
  return user?.role_key === 'admin_geral';
}

/** True if the user may access the given client (admins may access all). */
export function canAccessClient(user, clientId) {
  if (isAdmin(user)) return true;
  return user.clientIds.includes(Number(clientId));
}

/** Middleware factory: require a role from the allowed set. */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role_key)) {
      return res.status(403).json({ error: 'Permissão insuficiente.' });
    }
    next();
  };
}

/**
 * Middleware: ensures req.params.clientId (or req.body.client_id) is within the
 * user's tenant scope. Attaches req.clientId.
 */
export function scopeClient(req, res, next) {
  const clientId = Number(
    req.params.clientId ?? req.body.client_id ?? req.query.client_id,
  );
  if (!clientId) return res.status(400).json({ error: 'Cliente não informado.' });
  if (!canAccessClient(req.user, clientId)) {
    return res.status(403).json({ error: 'Sem acesso a este cliente.' });
  }
  req.clientId = clientId;
  next();
}

/**
 * Returns a SQL fragment + params limiting a query to the user's clients.
 * Admins get an always-true clause.
 */
export function clientScopeFilter(user, column = 'client_id') {
  if (isAdmin(user)) return { sql: '1=1', params: [] };
  if (user.clientIds.length === 0) return { sql: '1=0', params: [] };
  const placeholders = user.clientIds.map(() => '?').join(',');
  return { sql: `${column} IN (${placeholders})`, params: [...user.clientIds] };
}

/** Feature permission check with role defaults (§14, server-validated). */
export function hasPermission(user, permission) {
  if (isAdmin(user)) return true;
  if (user.permissions && user.permissions[permission] != null) {
    return !!user.permissions[permission];
  }
  // Sensible role defaults.
  const defaults = {
    consultor: {
      manage_collaborators: true,
      manage_payments: true,
      manage_routines: true,
      view_reports: true,
      view_bank_full: false,
    },
    cliente: {
      approve_payments: true,
      complete_routines: true,
      view_bank_full: false,
    },
    operacional: {
      complete_routines: true,
      view_bank_full: false,
    },
  };
  return !!defaults[user.role_key]?.[permission];
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!hasPermission(req.user, permission)) {
      return res.status(403).json({ error: 'Permissão insuficiente para esta ação.' });
    }
    next();
  };
}
