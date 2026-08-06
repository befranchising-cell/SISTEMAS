import db from './db.js';
import { hashPassword, hashPin, encryptSecret } from './crypto.js';
import { generateOccurrences } from './recurrence.js';

/**
 * Seeds the database with entirely fictional demonstration data (spec §26 —
 * never use real personal, banking or credential data). Idempotent-ish: it
 * wipes demo tables first so re-running gives a clean demo.
 */

const roleId = (key) => db.prepare('SELECT id FROM roles WHERE key = ?').get(key).id;
const catId = (name) => db.prepare('SELECT id FROM credential_categories WHERE name = ?').get(name)?.id;

function wipe() {
  const tables = [
    'vault_logs', 'vault_sessions', 'vault_access', 'vault_pins',
    'credential_history', 'credentials', 'documents', 'notifications',
    'audit_logs', 'routine_occurrences', 'routines', 'payments',
    'payment_schedules', 'bank_accounts', 'collaborators', 'units',
    'user_units', 'user_clients', 'user_permissions', 'users', 'clients',
  ];
  db.pragma('foreign_keys = OFF');
  for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();
  db.prepare(`DELETE FROM sqlite_sequence WHERE name IN (${tables.map(() => '?').join(',')})`).run(...tables);
  db.pragma('foreign_keys = ON');
}

const seed = db.transaction(() => {
  wipe();

  /* ------------------------------ Clients ------------------------------- */
  const insClient = db.prepare(`INSERT INTO clients
    (trade_name, legal_name, cnpj, segment, phone, whatsapp, email, city, state,
     resp_name, resp_cpf, resp_role, start_date, status, notes)
    VALUES (@trade_name,@legal_name,@cnpj,@segment,@phone,@whatsapp,@email,@city,@state,
     @resp_name,@resp_cpf,@resp_role,@start_date,@status,@notes)`);

  const clientA = insClient.run({
    trade_name: 'Salão Estrela', legal_name: 'Estrela Beleza Ltda',
    cnpj: '12.345.678/0001-90', segment: 'Beleza e Estética',
    phone: '(11) 4002-8922', whatsapp: '(11) 98888-0001', email: 'contato@salaoestrela.demo',
    city: 'São Paulo', state: 'SP', resp_name: 'Marina Fictícia', resp_cpf: '111.222.333-44',
    resp_role: 'Proprietária', start_date: '2025-01-15', status: 'ativo',
    notes: 'Cliente de demonstração (dados fictícios).',
  }).lastInsertRowid;

  const clientB = insClient.run({
    trade_name: 'Padaria Aurora', legal_name: 'Aurora Alimentos ME',
    cnpj: '98.765.432/0001-10', segment: 'Alimentação',
    phone: '(21) 3003-1000', whatsapp: '(21) 97777-0002', email: 'contato@padariaaurora.demo',
    city: 'Rio de Janeiro', state: 'RJ', resp_name: 'Carlos Exemplo', resp_cpf: '555.666.777-88',
    resp_role: 'Sócio', start_date: '2025-03-01', status: 'ativo',
    notes: 'Cliente de demonstração (dados fictícios).',
  }).lastInsertRowid;

  const clientC = insClient.run({
    trade_name: 'Studio Corpore', legal_name: 'Corpore Fitness Ltda',
    cnpj: '33.444.555/0001-22', segment: 'Academia',
    phone: '(31) 3555-2020', whatsapp: '(31) 96666-0003', email: 'contato@studiocorpore.demo',
    city: 'Belo Horizonte', state: 'MG', resp_name: 'Bruna Modelo', resp_cpf: '999.000.111-22',
    resp_role: 'Diretora', start_date: '2024-11-10', status: 'suspenso',
    notes: 'Cliente de demonstração (dados fictícios).',
  }).lastInsertRowid;

  /* ------------------------------- Units -------------------------------- */
  const insUnit = db.prepare(`INSERT INTO units
    (client_id, name, internal_code, cnpj, city, state, phone, responsible, hours, status)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const unitA1 = insUnit.run(clientA, 'Unidade Centro', 'EST-01', '12.345.678/0001-90', 'São Paulo', 'SP', '(11) 4002-8922', 'Marina Fictícia', 'Seg-Sáb 9h-19h', 'ativo').lastInsertRowid;
  const unitA2 = insUnit.run(clientA, 'Unidade Shopping', 'EST-02', '12.345.678/0002-71', 'São Paulo', 'SP', '(11) 4002-8923', 'Paula Teste', 'Seg-Dom 10h-22h', 'ativo').lastInsertRowid;
  const unitB1 = insUnit.run(clientB, 'Matriz', 'AUR-01', '98.765.432/0001-10', 'Rio de Janeiro', 'RJ', '(21) 3003-1000', 'Carlos Exemplo', 'Ter-Dom 6h-20h', 'ativo').lastInsertRowid;
  insUnit.run(clientC, 'Unidade Savassi', 'COR-01', '33.444.555/0001-22', 'Belo Horizonte', 'MG', '(31) 3555-2020', 'Bruna Modelo', 'Seg-Sex 6h-23h', 'ativo');

  /* --------------------------- Collaborators ---------------------------- */
  const insCollab = db.prepare(`INSERT INTO collaborators
    (client_id, unit_id, full_name, cpf, birth_date, phone, email, city, state,
     role_title, sector, prof_start, prof_status, pay_amount, pay_model,
     contract_type, contract_data)
    VALUES (@client_id,@unit_id,@full_name,@cpf,@birth_date,@phone,@email,@city,@state,
     @role_title,@sector,@prof_start,@prof_status,@pay_amount,@pay_model,@contract_type,@contract_data)`);

  const collabs = [
    { client_id: clientA, unit_id: unitA1, full_name: 'Ana Cabelereira Demo', cpf: '123.456.789-01', birth_date: '1992-05-10', phone: '(11) 90000-1111', email: 'ana@demo.local', city: 'São Paulo', state: 'SP', role_title: 'Cabelereira', sector: 'Atendimento', prof_start: '2025-02-01', prof_status: 'ativo', pay_amount: 2500, pay_model: 'comissao', contract_type: 'mei_parceiro', contract_data: JSON.stringify({ nome_empresarial: 'Ana Beauty MEI', cnpj: '10.000.000/0001-00', emite_nf: true, dia_limite_nf: 5 }) },
    { client_id: clientA, unit_id: unitA2, full_name: 'João Manicure Demo', cpf: '234.567.890-12', birth_date: '1988-09-22', phone: '(11) 90000-2222', email: 'joao@demo.local', city: 'São Paulo', state: 'SP', role_title: 'Manicure', sector: 'Atendimento', prof_start: '2025-03-15', prof_status: 'ativo', pay_amount: 1800, pay_model: 'fixa', contract_type: 'clt', contract_data: JSON.stringify({ admissao: '2025-03-15', cargo: 'Manicure', salario: 1800, pis: '000.00000.00-0', tipo_contrato: 'indeterminado' }) },
    { client_id: clientA, unit_id: unitA1, full_name: 'Rita Recepção Demo', cpf: '345.678.901-23', birth_date: '1995-01-30', phone: '(11) 90000-3333', email: 'rita@demo.local', city: 'São Paulo', state: 'SP', role_title: 'Recepcionista', sector: 'Administrativo', prof_start: '2025-02-10', prof_status: 'ferias', pay_amount: 2100, pay_model: 'fixa', contract_type: 'clt', contract_data: JSON.stringify({ admissao: '2025-02-10', cargo: 'Recepcionista', salario: 2100, tipo_contrato: 'experiencia' }) },
    { client_id: clientB, unit_id: unitB1, full_name: 'Pedro Padeiro Demo', cpf: '456.789.012-34', birth_date: '1980-07-14', phone: '(21) 90000-4444', email: 'pedro@demo.local', city: 'Rio de Janeiro', state: 'RJ', role_title: 'Padeiro', sector: 'Produção', prof_start: '2025-03-05', prof_status: 'ativo', pay_amount: 2600, pay_model: 'fixa', contract_type: 'clt', contract_data: JSON.stringify({ admissao: '2025-03-05', cargo: 'Padeiro', salario: 2600, tipo_contrato: 'indeterminado' }) },
    { client_id: clientB, unit_id: unitB1, full_name: 'Lúcia Atendente Demo', cpf: '567.890.123-45', birth_date: '1998-11-02', phone: '(21) 90000-5555', email: 'lucia@demo.local', city: 'Rio de Janeiro', state: 'RJ', role_title: 'Atendente', sector: 'Atendimento', prof_start: '2025-04-01', prof_status: 'ativo', pay_amount: 90, pay_model: 'diaria', contract_type: 'freelancer', contract_data: JSON.stringify({ valor_contratado: 90, tipo_remuneracao: 'diaria' }) },
  ];
  const collabIds = collabs.map((c) => insCollab.run(c).lastInsertRowid);

  /* --------------------------- Bank accounts ---------------------------- */
  const insBank = db.prepare(`INSERT INTO bank_accounts
    (collaborator_id, client_id, holder_name, holder_doc, bank_name, bank_code,
     agency, account, account_digit, account_type, pix_key, pix_type,
     preferred_method, last_validated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const banks = [
    [collabIds[0], clientA, 'Ana Beauty MEI', '10.000.000/0001-00', 'Banco Demo', '001', '1234', '567890', '1', 'juridica', 'ana@demo.local', 'email', 'pix', '2026-07-01'],
    [collabIds[1], clientA, 'João Manicure Demo', '234.567.890-12', 'Banco Teste', '237', '4321', '098765', '2', 'corrente', '234.567.890-12', 'cpf', 'pix', '2026-06-15'],
    [collabIds[2], clientA, 'Rita Recepção Demo', '345.678.901-23', 'Banco Fictício', '104', '0001', '112233', '4', 'poupanca', '(11) 90000-3333', 'telefone', 'transferencia', null],
    [collabIds[3], clientB, 'Pedro Padeiro Demo', '456.789.012-34', 'Banco Demo', '001', '2222', '445566', '0', 'corrente', 'chave-aleatoria-demo-0001', 'aleatoria', 'pix', '2026-07-20'],
    [collabIds[4], clientB, 'Lúcia Atendente Demo', '567.890.123-45', 'Banco Teste', '260', '0001', '778899', '5', 'pagamento', '567.890.123-45', 'cpf', 'pix', null],
  ];
  banks.forEach((b) => insBank.run(...b));

  /* -------------------- Payment schedules & payments -------------------- */
  const insSchedule = db.prepare(`INSERT INTO payment_schedules
    (client_id, collaborator_id, frequency, config, amount, weekend_strategy, needs_invoice, competence)
    VALUES (?,?,?,?,?,?,?,?)`);
  const insPayment = db.prepare(`INSERT INTO payments
    (client_id, unit_id, collaborator_id, schedule_id, contract_type, competence,
     due_date, amount_planned, status, needs_invoice)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);

  function scheduleFor(collab, unitId, freq, cfg, amount, needsInvoice) {
    const sid = insSchedule.run(collab.cid, collab.id, freq, JSON.stringify(cfg), amount, cfg.weekendStrategy || 'keep', needsInvoice ? 1 : 0, '2026-08').lastInsertRowid;
    const dates = generateOccurrences({ frequency: freq, ...cfg });
    const today = '2026-08-06';
    dates.forEach((d, i) => {
      let status = 'programado';
      if (d < today) status = i % 3 === 0 ? 'atrasado' : 'pago';
      insPayment.run(collab.cid, unitId, collab.id, sid, collab.ct, '2026-08', d, amount, status, needsInvoice ? 1 : 0);
    });
    return sid;
  }

  scheduleFor({ id: collabIds[0], cid: clientA, ct: 'mei_parceiro' }, unitA1, 'weekly', { startDate: '2026-07-01', endDate: '2026-09-30', weekdays: [5], weekendStrategy: 'anticipate' }, 650, true);
  scheduleFor({ id: collabIds[1], cid: clientA, ct: 'clt' }, unitA2, 'monthly', { startDate: '2026-07-05', endDate: '2026-12-05', monthDays: [5] }, 1800, false);
  scheduleFor({ id: collabIds[3], cid: clientB, ct: 'clt' }, unitB1, 'monthly', { startDate: '2026-07-05', endDate: '2026-12-05', monthDays: [5] }, 2600, false);
  scheduleFor({ id: collabIds[4], cid: clientB, ct: 'freelancer' }, unitB1, 'biweekly', { startDate: '2026-07-01', endDate: '2026-09-30', weekdays: [1] }, 450, false);

  /* ------------------------------ Routines ------------------------------ */
  const insRoutine = db.prepare(`INSERT INTO routines
    (client_id, unit_id, title, description, sector, category, responsible,
     frequency, config, start_date, end_date, time, priority, needs_proof, checklist)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insOcc = db.prepare(`INSERT INTO routine_occurrences
    (routine_id, client_id, date, status) VALUES (?,?,?,?)`);

  function routineFor(clientId, unitId, title, desc, freq, cfg, opts = {}) {
    const rid = insRoutine.run(
      clientId, unitId, title, desc, opts.sector || 'Operações', opts.category || 'Rotina',
      opts.responsible || 'Equipe', freq, JSON.stringify(cfg), cfg.startDate, cfg.endDate || null,
      opts.time || '09:00', opts.priority || 'media', opts.needsProof ? 1 : 0,
      JSON.stringify(opts.checklist || []),
    ).lastInsertRowid;
    const dates = generateOccurrences({ frequency: freq, ...cfg });
    const today = '2026-08-06';
    dates.forEach((d, i) => {
      let status = 'pendente';
      if (d < today) status = i % 4 === 0 ? 'atrasada' : 'concluida';
      insOcc.run(rid, clientId, d, status);
    });
  }

  routineFor(clientA, unitA1, 'Conferência de caixa', 'Fechamento e conferência do caixa diário.', 'daily', { startDate: '2026-08-01', endDate: '2026-08-31', weekendStrategy: 'keep' }, { category: 'Financeiro', time: '19:00', needsProof: true, checklist: ['Contar dinheiro', 'Registrar no sistema', 'Guardar comprovante'] });
  routineFor(clientA, unitA2, 'Reposição de estoque', 'Verificar e repor produtos de atendimento.', 'weekly', { startDate: '2026-08-04', endDate: '2026-10-31', weekdays: [1, 4] }, { category: 'Estoque', time: '10:00' });
  routineFor(clientB, unitB1, 'Limpeza de fornos', 'Higienização completa dos fornos.', 'weekly', { startDate: '2026-08-03', endDate: '2026-10-31', weekdays: [0] }, { category: 'Manutenção', time: '20:00', priority: 'alta', needsProof: true });
  routineFor(clientB, unitB1, 'Pagamento de fornecedores', 'Rotina quinzenal de pagamentos a fornecedores.', 'biweekly', { startDate: '2026-08-05', endDate: '2026-11-30', weekdays: [3] }, { category: 'Financeiro', time: '14:00' });

  /* ------------------------------- Users -------------------------------- */
  const insUser = db.prepare(`INSERT INTO users
    (full_name, email, phone, password_hash, role_id, status, two_factor_enabled)
    VALUES (?,?,?,?,?,?,?)`);
  const insUserPerm = db.prepare('INSERT INTO user_permissions (user_id, permissions) VALUES (?,?)');
  const insUserClient = db.prepare('INSERT INTO user_clients (user_id, client_id) VALUES (?,?)');

  const adminId = insUser.run('Administrador Demo', 'admin@demo.local', '(11) 90000-0000', hashPassword('admin123'), roleId('admin_geral'), 'ativo', 1).lastInsertRowid;
  const consultorId = insUser.run('Consultor Demo', 'consultor@demo.local', '(11) 90000-0010', hashPassword('consultor123'), roleId('consultor'), 'ativo', 0).lastInsertRowid;
  const clienteId = insUser.run('Cliente Estrela Demo', 'cliente@demo.local', '(11) 90000-0020', hashPassword('cliente123'), roleId('cliente'), 'ativo', 0).lastInsertRowid;
  const operId = insUser.run('Operacional Demo', 'operacional@demo.local', '(11) 90000-0030', hashPassword('operacional123'), roleId('operacional'), 'ativo', 0).lastInsertRowid;

  // Consultor sees clients A and B.
  insUserClient.run(consultorId, clientA);
  insUserClient.run(consultorId, clientB);
  // Cliente sees only client A.
  insUserClient.run(clienteId, clientA);
  // Operacional sees only client B.
  insUserClient.run(operId, clientB);

  insUserPerm.run(consultorId, JSON.stringify({ manage_collaborators: true, manage_payments: true, manage_routines: true, view_reports: true, view_bank_full: true }));
  insUserPerm.run(clienteId, JSON.stringify({ approve_payments: true, complete_routines: true }));
  insUserPerm.run(operId, JSON.stringify({ complete_routines: true }));

  /* ------------------------- Vault: PINs & access ----------------------- */
  const insVaultPin = db.prepare('INSERT INTO vault_pins (user_id, pin_hash) VALUES (?,?)');
  const insVaultAccess = db.prepare('INSERT INTO vault_access (user_id, enabled, permissions) VALUES (?,?,?)');
  // Individual PINs (spec §33: never a shared PIN).
  insVaultPin.run(adminId, hashPin('902471'));
  insVaultPin.run(consultorId, hashPin('573920'));
  const fullVaultPerms = JSON.stringify({ view: true, reveal: true, copy: true, create: true, edit: true, delete: true, export: true, history: true, logs: true, manage_users: true, reset_pin: true });
  const consultorVaultPerms = JSON.stringify({ view: true, reveal: true, copy: true, create: true, edit: true, delete: false, history: true });
  insVaultAccess.run(adminId, 1, fullVaultPerms);
  insVaultAccess.run(consultorId, 1, consultorVaultPerms);

  /* ---------------------------- Credentials ----------------------------- */
  const insCred = db.prepare(`INSERT INTO credentials
    (client_id, unit_id, category_id, system_name, url, login, email,
     password_enc, importance, last_pw_change, next_pw_change, change_freq_days,
     responsible, status, requires_2fa)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insCredHist = db.prepare(`INSERT INTO credential_history
    (credential_id, user_id, user_name, action, changed_fields) VALUES (?,?,?,?,?)`);

  const creds = [
    [clientA, unitA1, catId('Bancos'), 'Banco Demo Empresarial', 'https://banco.demo', 'salaoestrela', 'financeiro@salaoestrela.demo', encryptSecret('SenhaFicticia#2026!'), 'critico', '2026-06-01', '2026-09-01', 90, 'Marina Fictícia', 'ativo', 1],
    [clientA, null, catId('Redes sociais'), 'Instagram', 'https://instagram.com', '@salaoestrela', 'mkt@salaoestrela.demo', encryptSecret('InstaDemo!2026'), 'importante', '2026-05-10', '2026-11-10', 180, 'Paula Teste', 'ativo', 0],
    [clientA, null, catId('Sistemas do governo'), 'Portal e-CAC', 'https://cav.receita.fazenda.gov.br', '12.345.678/0001-90', 'contabil@salaoestrela.demo', encryptSecret('GovDemo@2026'), 'critico', '2026-07-01', '2026-08-15', 45, 'Contador Demo', 'em_revisao', 1],
    [clientB, unitB1, catId('Delivery'), 'Plataforma Delivery Demo', 'https://delivery.demo', 'padariaaurora', 'pedidos@padariaaurora.demo', encryptSecret('DeliveryDemo#01'), 'normal', '2026-04-20', '2026-10-20', 180, 'Carlos Exemplo', 'ativo', 0],
    [clientB, unitB1, catId('Bancos'), 'Banco Teste PJ', 'https://bancoteste.demo', 'aurora-pj', 'financeiro@padariaaurora.demo', encryptSecret('BancoTeste$2026'), 'critico', '2026-06-15', '2026-09-15', 90, 'Carlos Exemplo', 'ativo', 1],
  ];
  creds.forEach((c) => {
    const cid = insCred.run(...c).lastInsertRowid;
    insCredHist.run(cid, adminId, 'Administrador Demo', 'created', JSON.stringify(['system_name', 'login', 'password']));
  });

  /* --------------------------- Notifications ---------------------------- */
  const insNotif = db.prepare(`INSERT INTO notifications
    (client_id, type, scope, severity, title, message) VALUES (?,?,?,?,?,?)`);
  insNotif.run(clientA, 'payment_late', 'geral', 'warning', 'Pagamento em atraso', 'Há pagamentos vencidos no Salão Estrela.');
  insNotif.run(clientA, 'invoice_pending', 'geral', 'info', 'Nota fiscal pendente', 'Colaborador MEI ainda não enviou a NF do período.');
  insNotif.run(clientB, 'routine_late', 'geral', 'warning', 'Rotina atrasada', 'A limpeza de fornos está atrasada.');
  insNotif.run(clientA, 'vault_pw_change', 'cofre', 'warning', 'Senha próxima da troca', 'Uma credencial crítica está próxima da data de troca.');
  insNotif.run(null, 'contract_expiring', 'geral', 'info', 'Contrato próximo do vencimento', 'Contrato de experiência encerra em breve.');

  console.log('Seed concluído: 3 clientes, 4 unidades, 5 colaboradores, 4 usuários, 5 credenciais.');
});

seed();
db.close();
