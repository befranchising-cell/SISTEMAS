import Database from 'better-sqlite3';
import path from 'node:path';
import { DATA_DIR } from './config.js';

export const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Relational schema (spec §31). Data is normalised across dedicated tables with
 * explicit relationships; every tenant-scoped row carries a client_id so the
 * server can enforce isolation. Encryption keys are NOT stored here — the vault
 * master key lives in the environment (see config.js).
 */
db.exec(`
/* ---------------------- Identity, roles & permissions ------------------- */
CREATE TABLE IF NOT EXISTS roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT UNIQUE NOT NULL,          -- admin_geral | consultor | cliente | operacional
  name        TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name      TEXT NOT NULL,
  email          TEXT UNIQUE NOT NULL,
  phone          TEXT,
  password_hash  TEXT NOT NULL,
  role_id        INTEGER NOT NULL REFERENCES roles(id),
  status         TEXT NOT NULL DEFAULT 'ativo',  -- ativo | inativo | bloqueado
  two_factor_enabled INTEGER NOT NULL DEFAULT 0,
  last_login_at  TEXT,
  failed_logins  INTEGER NOT NULL DEFAULT 0,
  locked_until   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

/* Feature-level permission overrides per user (server-validated). JSON map. */
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  permissions TEXT NOT NULL DEFAULT '{}'
);

/* Which clients / units a non-admin user may access. */
CREATE TABLE IF NOT EXISTS user_clients (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, client_id)
);
CREATE TABLE IF NOT EXISTS user_units (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, unit_id)
);

/* ------------------------------- Clients -------------------------------- */
CREATE TABLE IF NOT EXISTS clients (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_name        TEXT NOT NULL,          -- nome fantasia
  legal_name        TEXT,                   -- razão social
  cnpj              TEXT,
  state_reg         TEXT,                   -- inscrição estadual
  municipal_reg     TEXT,
  segment           TEXT,
  phone             TEXT,
  whatsapp          TEXT,
  email             TEXT,
  website           TEXT,
  zip               TEXT,
  street            TEXT,
  number            TEXT,
  complement        TEXT,
  district          TEXT,
  city              TEXT,
  state             TEXT,
  resp_name         TEXT,
  resp_cpf          TEXT,
  resp_role         TEXT,
  resp_phone        TEXT,
  resp_email        TEXT,
  start_date        TEXT,
  end_date          TEXT,
  status            TEXT NOT NULL DEFAULT 'ativo', -- ativo|inativo|suspenso|encerrado
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS units (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id    INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  internal_code TEXT,
  cnpj         TEXT,
  zip          TEXT,
  street       TEXT,
  number       TEXT,
  complement   TEXT,
  district     TEXT,
  city         TEXT,
  state        TEXT,
  phone        TEXT,
  email        TEXT,
  responsible  TEXT,
  hours        TEXT,
  status       TEXT NOT NULL DEFAULT 'ativo',
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

/* ----------------------------- Collaborators ---------------------------- */
CREATE TABLE IF NOT EXISTS collaborators (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  unit_id        INTEGER REFERENCES units(id) ON DELETE SET NULL,
  -- personal
  full_name      TEXT NOT NULL,
  social_name    TEXT,
  cpf            TEXT,
  rg             TEXT,
  rg_issuer      TEXT,
  birth_date     TEXT,
  phone          TEXT,
  whatsapp       TEXT,
  email          TEXT,
  zip            TEXT,
  street         TEXT,
  number         TEXT,
  complement     TEXT,
  district       TEXT,
  city           TEXT,
  state          TEXT,
  marital_status TEXT,
  emergency_name TEXT,
  emergency_phone TEXT,
  photo_url      TEXT,
  notes          TEXT,
  -- professional
  role_title     TEXT,                       -- cargo/função
  sector         TEXT,
  manager        TEXT,
  prof_start     TEXT,
  prof_end       TEXT,
  prof_status    TEXT NOT NULL DEFAULT 'ativo', -- ativo|afastado|ferias|inativo|encerrado
  schedule       TEXT,
  pay_amount     REAL,
  pay_model      TEXT,                        -- fixa|hora|diaria|comissao|misto
  contract_type  TEXT,                        -- clt|mei_parceiro|freelancer|mei_colab|prestador_ind|empresa_prestadora
  contract_data  TEXT,                        -- JSON with type-specific fields (§5)
  prof_notes     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

/* Bank / payment data (§6). Account & PIX values stored, masked on read.     */
CREATE TABLE IF NOT EXISTS bank_accounts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  collaborator_id INTEGER NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  holder_name    TEXT,
  holder_doc     TEXT,                        -- CPF/CNPJ
  bank_name      TEXT,
  bank_code      TEXT,
  agency         TEXT,
  account        TEXT,
  account_digit  TEXT,
  account_type   TEXT,                        -- corrente|poupanca|pagamento|juridica
  pix_key        TEXT,
  pix_type       TEXT,                        -- cpf|cnpj|telefone|email|aleatoria
  preferred_method TEXT,                      -- pix|transferencia|boleto|dinheiro|outro
  notes          TEXT,
  last_validated_at TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

/* ---------------------- Payment scheduling & control -------------------- */
CREATE TABLE IF NOT EXISTS payment_schedules (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  collaborator_id INTEGER NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  frequency      TEXT NOT NULL,               -- weekly|biweekly|monthly|specific|custom
  config         TEXT NOT NULL DEFAULT '{}',  -- JSON recurrence config
  amount         REAL,
  weekend_strategy TEXT DEFAULT 'keep',
  approver       TEXT,
  payer          TEXT,
  needs_invoice  INTEGER NOT NULL DEFAULT 0,
  invoice_days   INTEGER,
  competence     TEXT,
  notes          TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  unit_id        INTEGER REFERENCES units(id) ON DELETE SET NULL,
  collaborator_id INTEGER REFERENCES collaborators(id) ON DELETE SET NULL,
  schedule_id    INTEGER REFERENCES payment_schedules(id) ON DELETE SET NULL,
  contract_type  TEXT,
  competence     TEXT,
  due_date       TEXT NOT NULL,
  paid_date      TEXT,
  amount_planned REAL,
  amount_paid    REAL,
  discounts      REAL,
  additions      REAL,
  method         TEXT,
  pay_account    TEXT,
  status         TEXT NOT NULL DEFAULT 'programado',
  -- programado|aguardando_documento|aguardando_nota|aguardando_aprovacao|
  -- aprovado|pago|pago_parcial|atrasado|cancelado
  needs_invoice  INTEGER NOT NULL DEFAULT 0,
  approver       TEXT,
  paid_by        TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

/* ------------------------------- Routines ------------------------------- */
CREATE TABLE IF NOT EXISTS routines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  unit_id       INTEGER REFERENCES units(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  sector        TEXT,
  category      TEXT,
  responsible   TEXT,
  participants  TEXT,
  frequency     TEXT NOT NULL DEFAULT 'pontual', -- daily|weekly|biweekly|monthly|specific|custom|pontual
  config        TEXT NOT NULL DEFAULT '{}',
  start_date    TEXT,
  end_date      TEXT,
  time          TEXT,
  estimated_minutes INTEGER,
  priority      TEXT DEFAULT 'media',           -- baixa|media|alta
  instructions  TEXT,
  checklist     TEXT,                            -- JSON array
  needs_proof   INTEGER NOT NULL DEFAULT 0,
  notes         TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

/* Concrete generated occurrences for both routines and (optionally) tasks.  */
CREATE TABLE IF NOT EXISTS routine_occurrences (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id   INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  client_id    INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pendente', -- pendente|concluida|atrasada|cancelada
  completed_at TEXT,
  completed_by TEXT,
  proof_url    TEXT,
  notes        TEXT
);

/* ------------------------------ Documents ------------------------------- */
CREATE TABLE IF NOT EXISTS documents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id    INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  entity_type  TEXT NOT NULL,   -- client|unit|collaborator|payment|routine|credential
  entity_id    INTEGER,
  name         TEXT NOT NULL,
  file_url     TEXT,
  uploaded_by  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

/* ----------------------------- Notifications ---------------------------- */
CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id   INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,        -- payment_due|payment_late|routine_late|...|vault_*
  scope       TEXT NOT NULL DEFAULT 'geral', -- geral | cofre
  severity    TEXT NOT NULL DEFAULT 'info',  -- info|warning|critical
  title       TEXT NOT NULL,
  message     TEXT,
  read_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

/* --------------------------- Audit & history ---------------------------- */
CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id),
  user_name   TEXT,
  client_id   INTEGER,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   INTEGER,
  detail      TEXT,
  ip          TEXT,
  device      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

/* ------------------------- Credential Vault (§15+) ---------------------- */
CREATE TABLE IF NOT EXISTS credential_categories (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name   TEXT UNIQUE NOT NULL,
  system INTEGER NOT NULL DEFAULT 0   -- 1 = built-in, cannot delete
);

CREATE TABLE IF NOT EXISTS credentials (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  unit_id        INTEGER REFERENCES units(id) ON DELETE SET NULL,
  category_id    INTEGER REFERENCES credential_categories(id),
  system_name    TEXT NOT NULL,       -- nome do sistema/plataforma
  url            TEXT,
  app            TEXT,
  login          TEXT,
  email          TEXT,
  password_enc   TEXT,                -- AES-256-GCM ciphertext (never plaintext)
  pin_enc        TEXT,                -- service PIN, also encrypted
  company_code   TEXT,
  establishment_code TEXT,
  unit_number    TEXT,
  recovery_info  TEXT,
  recovery_phone TEXT,
  recovery_email TEXT,
  responsible    TEXT,
  sector         TEXT,
  importance     TEXT NOT NULL DEFAULT 'normal', -- normal|importante|critico
  created_date   TEXT,
  last_pw_change TEXT,
  next_pw_change TEXT,
  change_freq_days INTEGER,
  status         TEXT NOT NULL DEFAULT 'ativo',  -- ativo|inativo|bloqueado|em_revisao
  requires_2fa   INTEGER NOT NULL DEFAULT 0,
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

/* History of credential changes — NEVER stores plaintext passwords. */
CREATE TABLE IF NOT EXISTS credential_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  user_id       INTEGER,
  user_name     TEXT,
  action        TEXT NOT NULL,   -- created|updated|password_changed|deleted
  changed_fields TEXT,           -- field names only, no values
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

/* Per-user vault PIN (hashed, one-way) + lockout state (§19). */
CREATE TABLE IF NOT EXISTS vault_pins (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pin_hash      TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until  TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

/* Independent vault permissions per user (§21). JSON map + client scope. */
CREATE TABLE IF NOT EXISTS vault_access (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled       INTEGER NOT NULL DEFAULT 0,
  permissions   TEXT NOT NULL DEFAULT '{}',
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

/* Active vault sessions (short-lived, inactivity-bound). */
CREATE TABLE IF NOT EXISTS vault_sessions (
  id           TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip           TEXT,
  device       TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_active  TEXT NOT NULL DEFAULT (datetime('now')),
  revoked      INTEGER NOT NULL DEFAULT 0
);

/* Vault-specific audit log (§23). Never stores password/PIN content. */
CREATE TABLE IF NOT EXISTS vault_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER,
  user_name     TEXT,
  client_id     INTEGER,
  credential_id INTEGER,
  action        TEXT NOT NULL,  -- unlock|view|reveal|copy|create|update|delete|pin_reset|denied|locked
  result        TEXT NOT NULL DEFAULT 'ok', -- ok|denied
  ip            TEXT,
  device        TEXT,
  detail        TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

/* --------------------------- System settings ---------------------------- */
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_units_client        ON units(client_id);
CREATE INDEX IF NOT EXISTS idx_collab_client       ON collaborators(client_id);
CREATE INDEX IF NOT EXISTS idx_bank_collab         ON bank_accounts(collaborator_id);
CREATE INDEX IF NOT EXISTS idx_pay_client          ON payments(client_id);
CREATE INDEX IF NOT EXISTS idx_pay_due             ON payments(due_date);
CREATE INDEX IF NOT EXISTS idx_routines_client     ON routines(client_id);
CREATE INDEX IF NOT EXISTS idx_occ_client_date     ON routine_occurrences(client_id, date);
CREATE INDEX IF NOT EXISTS idx_cred_client         ON credentials(client_id);
CREATE INDEX IF NOT EXISTS idx_vlog_client         ON vault_logs(client_id);
CREATE INDEX IF NOT EXISTS idx_audit_client        ON audit_logs(client_id);
`);

/* Default reference data --------------------------------------------------*/
const roleCount = db.prepare('SELECT COUNT(*) c FROM roles').get().c;
if (roleCount === 0) {
  const insert = db.prepare('INSERT INTO roles (key, name, description) VALUES (?,?,?)');
  insert.run('admin_geral', 'Administrador Geral', 'Acesso total a todos os clientes e configurações.');
  insert.run('consultor', 'Consultor', 'Acesso apenas aos clientes autorizados.');
  insert.run('cliente', 'Cliente', 'Acesso somente à própria empresa.');
  insert.run('operacional', 'Usuário Operacional', 'Acesso às atividades atribuídas.');
}

const catCount = db.prepare('SELECT COUNT(*) c FROM credential_categories').get().c;
if (catCount === 0) {
  const cats = [
    'Bancos', 'Sistemas financeiros', 'Contabilidade', 'Folha de pagamento',
    'Sistemas de ponto', 'Sistemas de gestão', 'ERP', 'Frente de caixa',
    'Delivery', 'Redes sociais', 'E-mails', 'Sites', 'Domínios', 'Hospedagens',
    'Marketplaces', 'Fornecedores', 'Plataformas de vendas', 'Sistemas do governo',
    'Certificados digitais', 'Ferramentas de marketing', 'Ferramentas de atendimento',
    'Plataformas de anúncios', 'Outros',
  ];
  const insert = db.prepare('INSERT INTO credential_categories (name, system) VALUES (?, 1)');
  const tx = db.transaction(() => cats.forEach((c) => insert.run(c)));
  tx();
}

const defaultSettings = {
  system_name: '[NOME DO SISTEMA]',
  logo_url: '',
  color_primary: '#2563eb',
  color_accent: '#0ea5e9',
  timezone: 'America/Sao_Paulo',
};
const upsertSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING',
);
for (const [k, v] of Object.entries(defaultSettings)) upsertSetting.run(k, v);

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}
export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, String(value ?? ''));
}
export function allSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export default db;
