import { api } from '../api.js';
import { el, clear, fmt, toast, modal, field, input, select, textarea, readForm, badge, confirmDialog } from '../ui.js';
import { store, isAdmin, LABELS, STATUS_COLOR } from '../store.js';

/* Entry points -------------------------------------------------------- */
export async function renderVaultGeneral(root) {
  root.appendChild(el('p', { class: 'muted', text: 'Visão geral do cofre — credenciais de todos os clientes autorizados, sem misturar informações entre empresas.' }));
  if (!store.clients.length) { try { store.clients = await api.get('/clients'); } catch { /* ignore */ } }
  vaultUI(root, { clientId: null, showClientFilter: true });
}

export function renderVaultPanel(container, { clientId, clientName }) {
  vaultUI(container, { clientId, clientName, showClientFilter: false });
}

/* Core vault UI with PIN gating -------------------------------------- */
async function vaultUI(container, opts) {
  const shell = el('div', {});
  container.appendChild(shell);

  let status;
  try { status = await api.get('/vault/status'); }
  catch { shell.appendChild(el('div', { class: 'empty', text: 'Você não possui acesso ao Cofre de Credenciais.' })); return; }

  if (!status.hasPin) return drawPinSetup(shell, opts);
  if (!status.unlocked) return drawUnlock(shell, opts);
  return drawVault(shell, status, opts);
}

function drawPinSetup(shell, opts) {
  clear(shell);
  const pin = input('pin', '', { type: 'password', inputmode: 'numeric', placeholder: 'Mínimo 6 dígitos' });
  const pin2 = input('pin2', '', { type: 'password', inputmode: 'numeric', placeholder: 'Repita o PIN' });
  const card = el('div', { class: 'card', style: 'max-width:440px;margin:40px auto' }, [
    el('div', { class: 'card-body' }, [
      el('h3', { text: '🔐 Configure seu PIN do Cofre' }),
      el('p', { class: 'hint', text: 'O PIN é individual e protege apenas o Cofre. Não use sequências (123456) nem dígitos repetidos (111111). Ele é diferente da sua senha de login.' }),
      field('Novo PIN', pin), field('Confirmar PIN', pin2),
      el('button', { class: 'btn primary', text: 'Salvar PIN', onClick: async () => {
        if (pin.value !== pin2.value) { toast('Os PINs não coincidem.', 'error'); return; }
        try { await api.post('/vault/pin/setup', { pin: pin.value }); toast('PIN configurado.', 'success'); vaultUI(shell.parentElement, opts); shell.remove(); }
        catch (e) { toast(e.message, 'error'); }
      } }),
    ]),
  ]);
  shell.appendChild(card);
}

function drawUnlock(shell, opts) {
  clear(shell);
  const pin = input('pin', '', { type: 'password', inputmode: 'numeric', placeholder: 'Seu PIN' });
  async function unlock() {
    try { await api.post('/vault/unlock', { pin: pin.value }); toast('Cofre desbloqueado.', 'success'); const st = await api.get('/vault/status'); drawVault(shell, st, opts); }
    catch (e) { toast(e.data?.remaining != null ? `${e.message} (${e.data.remaining} tentativas restantes)` : e.message, 'error'); }
  }
  const card = el('div', { class: 'card', style: 'max-width:440px;margin:40px auto' }, [
    el('div', { class: 'card-body' }, [
      el('h3', { text: '🔐 Cofre bloqueado' }),
      el('p', { class: 'hint', text: 'Informe seu PIN individual para acessar as credenciais. Após 5 tentativas incorretas o acesso é bloqueado temporariamente.' }),
      field('PIN', pin),
      el('button', { class: 'btn primary', text: 'Desbloquear', onClick: unlock }),
    ]),
  ]);
  pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });
  shell.appendChild(card);
}

async function drawVault(shell, status, opts) {
  clear(shell);
  const perms = status.permissions || {};
  const state = { q: '', client_id: opts.clientId || '', category_id: '', importance: '' };

  // Toolbar
  const toolbar = el('div', { class: 'flex between mb', style: 'flex-wrap:wrap;gap:10px' });
  const leftControls = el('div', { class: 'flex', style: 'gap:8px;flex-wrap:wrap' });
  const searchInput = el('input', { class: 'search', placeholder: 'Pesquisar sistema, login, responsável…', oninput: (e) => { state.q = e.target.value; debounced(); } });
  leftControls.appendChild(searchInput);

  if (opts.showClientFilter) {
    const cs = el('select', {}, [el('option', { value: '', text: 'Todos os clientes' }), ...store.clients.map((c) => el('option', { value: c.id, text: c.trade_name }))]);
    cs.addEventListener('change', () => { state.client_id = cs.value; load(); });
    leftControls.appendChild(cs);
  }
  const impSel = el('select', {}, [el('option', { value: '', text: 'Toda importância' }), ...Object.entries(LABELS.importance).map(([v, l]) => el('option', { value: v, text: l }))]);
  impSel.addEventListener('change', () => { state.importance = impSel.value; load(); });
  leftControls.appendChild(impSel);

  const rightControls = el('div', { class: 'flex', style: 'gap:8px' }, [
    perms.create ? el('button', { class: 'btn primary', text: '+ Nova credencial', onClick: () => openForm(null) }) : null,
    perms.logs ? el('button', { class: 'btn', text: 'Logs do Cofre', onClick: openLogs }) : null,
    (isAdmin() || status.isAdmin) ? el('button', { class: 'btn', text: 'Usuários & PIN', onClick: openAccessAdmin }) : null,
    el('button', { class: 'btn', text: '🔒 Bloquear', onClick: async () => { await api.post('/vault/lock', {}); toast('Cofre bloqueado.', 'info'); vaultUI(shell.parentElement, opts); shell.remove(); } }),
  ]);
  toolbar.appendChild(leftControls); toolbar.appendChild(rightControls);
  shell.appendChild(toolbar);

  const listWrap = el('div', {});
  shell.appendChild(listWrap);

  let timer; function debounced() { clearTimeout(timer); timer = setTimeout(load, 250); }

  async function load() {
    clear(listWrap); listWrap.appendChild(el('div', { class: 'muted', text: 'Carregando…' }));
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.client_id) params.set('client_id', state.client_id);
    if (state.importance) params.set('importance', state.importance);
    let rows;
    try { rows = await api.get('/vault/credentials?' + params.toString()); }
    catch (e) { if (e.status === 440) { vaultUI(shell.parentElement, opts); shell.remove(); return; } clear(listWrap); listWrap.appendChild(el('div', { class: 'empty', text: e.message })); return; }
    clear(listWrap);
    if (!rows.length) { listWrap.appendChild(el('div', { class: 'empty', text: 'Nenhuma credencial encontrada.' })); return; }
    const table = el('table', { class: 'data' }, [
      el('thead', {}, el('tr', {}, [...(opts.showClientFilter ? ['Cliente'] : []), 'Sistema', 'Categoria', 'Login', 'Importância', 'Status', 'Senha', ''].map((h) => el('th', { text: h })))),
      el('tbody', {}, rows.map((c) => el('tr', {}, [
        ...(opts.showClientFilter ? [el('td', { text: c.client_name })] : []),
        el('td', {}, [el('strong', { text: c.system_name }), c.url ? el('div', { class: 'hint', text: c.url }) : null]),
        el('td', { text: c.category_name || '—' }),
        el('td', { class: 'secret', text: c.login || '—' }),
        el('td', {}, [badge(LABELS.importance[c.importance], STATUS_COLOR[c.importance])]),
        el('td', {}, [badge(LABELS.credStatus[c.status], STATUS_COLOR[c.status])]),
        el('td', {}, [passwordCell(c, perms)]),
        el('td', { class: 'right' }, [el('button', { class: 'btn sm', text: 'Ver', onClick: () => openDetail(c.id) })]),
      ]))),
    ]);
    listWrap.appendChild(el('div', { class: 'table-wrap card' }, [table]));
  }

  /* Reveal / copy cell — the guarded flow (§20). */
  function passwordCell(c, perms) {
    if (!c.has_password) return el('span', { class: 'hint', text: '—' });
    const display = el('span', { class: 'secret', text: '••••••••' });
    const cell = el('div', { class: 'flex', style: 'gap:6px' }, [display]);
    if (perms.reveal) cell.appendChild(el('button', { class: 'btn sm', text: '👁', title: 'Revelar', onClick: () => reveal(c, 'reveal', display) }));
    if (perms.copy) cell.appendChild(el('button', { class: 'btn sm', text: '📋', title: 'Copiar', onClick: () => reveal(c, 'copy', display) }));
    return cell;
  }

  function reveal(c, mode, display) {
    // Ask for the PIN every time (§20 step 1).
    modal((close) => {
      const pin = input('pin', '', { type: 'password', inputmode: 'numeric', placeholder: 'PIN' });
      async function go() {
        try {
          const r = await api.post(`/vault/credentials/${c.id}/reveal`, { pin: pin.value, mode });
          close();
          if (mode === 'copy') {
            try { await navigator.clipboard.writeText(r.password); toast('Senha copiada. Será limpa em ' + r.ttlSeconds + 's.', 'success');
              setTimeout(() => { navigator.clipboard.writeText('').catch(() => {}); }, r.ttlSeconds * 1000);
            } catch { toast('Não foi possível copiar automaticamente.', 'error'); }
          } else {
            display.textContent = r.password;
            let left = r.ttlSeconds;
            const tick = setInterval(() => { left -= 1; if (left <= 0) { clearInterval(tick); display.textContent = '••••••••'; } }, 1000);
            toast('Senha revelada por ' + r.ttlSeconds + 's (ação auditada).', 'info');
          }
        } catch (e) {
          if (e.status === 440) { close(); toast('Sessão expirada. Informe o PIN novamente.', 'error'); vaultUI(shell.parentElement, opts); shell.remove(); return; }
          toast(e.message, 'error');
        }
      }
      pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      return { title: mode === 'copy' ? 'Copiar senha' : 'Revelar senha', size: 'narrow',
        body: [el('p', { class: 'hint', text: `Confirme seu PIN para ${mode === 'copy' ? 'copiar' : 'revelar'} a senha de "${c.system_name}". Esta ação é registrada no log.` }), field('PIN', pin)],
        footer: [el('button', { class: 'btn', text: 'Cancelar', onClick: close }), el('button', { class: 'btn primary', text: 'Confirmar', onClick: go })] };
    });
  }

  async function openDetail(id) {
    let c;
    try { c = await api.get('/vault/credentials/' + id); } catch (e) { toast(e.message, 'error'); return; }
    modal((close) => ({
      title: c.system_name, size: 'wide',
      body: [
        el('div', { class: 'form-grid' }, [
          kv('Cliente', c.client_name), kv('Unidade', c.unit_name), kv('Categoria', c.category_name),
          kv('URL', c.url), kv('Login', c.login), kv('E-mail', c.email),
          kv('Importância', LABELS.importance[c.importance]), kv('Status', LABELS.credStatus[c.status]),
          kv('Responsável', c.responsible), kv('Setor', c.sector),
          kv('Última troca', fmt.date(c.last_pw_change)), kv('Próxima troca', fmt.date(c.next_pw_change)),
          kv('Exige 2FA', c.requires_2fa ? 'Sim' : 'Não'), kv('E-mail recuperação', c.recovery_email),
        ]),
        c.notes ? el('p', { class: 'hint', text: c.notes }) : null,
        el('div', { class: 'hint mt', text: '🔒 A senha nunca é exibida em telas de consulta, listas, relatórios ou logs.' }),
      ],
      footer: [
        perms.history ? el('button', { class: 'btn', text: 'Histórico', onClick: () => { close(); openHistory(id); } }) : null,
        perms.delete ? el('button', { class: 'btn danger', text: 'Excluir', onClick: () => { close(); confirmDelete(c); } }) : null,
        perms.edit ? el('button', { class: 'btn', text: 'Editar', onClick: () => { close(); openForm(c); } }) : null,
        el('button', { class: 'btn primary', text: 'Fechar', onClick: close }),
      ],
    }));
  }

  function openForm(cred) {
    modal((close) => {
      const clientOptions = opts.clientId
        ? [{ value: opts.clientId, label: opts.clientName || 'Este cliente' }]
        : store.clients.map((c) => ({ value: c.id, label: c.trade_name }));
      const catSelPromise = api.get('/vault/categories');
      const form = el('div', { class: 'form-grid' }, [
        field('Cliente *', select('client_id', clientOptions, cred?.client_id || opts.clientId)),
        field('Sistema / plataforma *', input('system_name', cred?.system_name)),
        field('Categoria', select('category_id', [{ value: '', label: '—' }], cred?.category_id)),
        field('URL de acesso', input('url', cred?.url)),
        field('Login / usuário', input('login', cred?.login)),
        field('E-mail do cadastro', input('email', cred?.email)),
        field(cred ? 'Nova senha (em branco = manter)' : 'Senha', input('password', '', { type: 'password' })),
        field('PIN do serviço', input('service_pin', '')),
        field('Responsável', input('responsible', cred?.responsible)),
        field('Setor', input('sector', cred?.sector)),
        field('Importância', select('importance', Object.entries(LABELS.importance).map(([value, label]) => ({ value, label })), cred?.importance || 'normal')),
        field('Status', select('status', Object.entries(LABELS.credStatus).map(([value, label]) => ({ value, label })), cred?.status || 'ativo')),
        field('Próxima troca de senha', input('next_pw_change', cred?.next_pw_change, { type: 'date' })),
        field('Exige 2FA', el('input', { name: 'requires_2fa', type: 'checkbox', checked: cred?.requires_2fa })),
        field('E-mail de recuperação', input('recovery_email', cred?.recovery_email)),
        field('Telefone de recuperação', input('recovery_phone', cred?.recovery_phone)),
      ]);
      const catSel = form.querySelector('select[name=category_id]');
      catSelPromise.then((cats) => { for (const cat of cats) { const o = el('option', { value: cat.id, text: cat.name }); if (cred && cred.category_id === cat.id) o.selected = true; catSel.appendChild(o); } });

      const pinField = field('Confirme seu PIN *', input('pin', '', { type: 'password', inputmode: 'numeric' }), { full: true });

      async function save() {
        const data = readForm(form);
        const pin = pinField.querySelector('input').value;
        if (!data.system_name || !data.client_id) { toast('Cliente e sistema são obrigatórios.', 'error'); return; }
        if (!pin) { toast('Confirme seu PIN.', 'error'); return; }
        data.pin = pin;
        try {
          if (cred) await api.put('/vault/credentials/' + cred.id, data);
          else await api.post('/vault/credentials', data);
          toast('Credencial salva (ação auditada).', 'success'); close(); load();
        } catch (e) {
          if (e.status === 440) { close(); vaultUI(shell.parentElement, opts); shell.remove(); return; }
          toast(e.message, 'error');
        }
      }
      return { title: cred ? 'Editar credencial' : 'Nova credencial', size: 'wide', body: [form, el('hr'), pinField], footer: [el('button', { class: 'btn', text: 'Cancelar', onClick: close }), el('button', { class: 'btn primary', text: 'Salvar', onClick: save })] };
    });
  }

  function confirmDelete(c) {
    modal((close) => {
      const pin = input('pin', '', { type: 'password', inputmode: 'numeric', placeholder: 'PIN' });
      async function go() {
        try { await api.del('/vault/credentials/' + c.id, { pin: pin.value }); toast('Credencial excluída (auditada).', 'success'); close(); load(); }
        catch (e) { toast(e.message, 'error'); }
      }
      return { title: 'Excluir credencial', size: 'narrow',
        body: [el('p', { text: `Excluir "${c.system_name}"? Confirme seu PIN.` }), field('PIN', pin)],
        footer: [el('button', { class: 'btn', text: 'Cancelar', onClick: close }), el('button', { class: 'btn danger', text: 'Excluir', onClick: go })] };
    });
  }

  async function openHistory(id) {
    const rows = await api.get(`/vault/credentials/${id}/history`);
    modal((close) => ({
      title: 'Histórico da credencial', size: 'wide',
      body: [rows.length ? el('table', { class: 'data' }, [
        el('thead', {}, el('tr', {}, ['Data', 'Usuário', 'Ação', 'Campos'].map((h) => el('th', { text: h })))),
        el('tbody', {}, rows.map((h) => el('tr', {}, [el('td', { text: fmt.datetime(h.created_at) }), el('td', { text: h.user_name || '—' }), el('td', { text: h.action }), el('td', { text: (JSON.parse(h.changed_fields || '[]')).join(', ') })]))),
      ]) : el('div', { class: 'empty', text: 'Sem histórico.' }), el('div', { class: 'hint mt', text: 'O histórico nunca armazena o conteúdo da senha.' })],
      footer: [el('button', { class: 'btn primary', text: 'Fechar', onClick: close })],
    }));
  }

  async function openLogs() {
    const rows = await api.get('/vault/logs');
    modal((close) => ({
      title: 'Logs de acesso ao Cofre', size: 'wide',
      body: [el('div', { class: 'table-wrap', style: 'max-height:60vh;overflow:auto' }, [el('table', { class: 'data' }, [
        el('thead', {}, el('tr', {}, ['Data', 'Usuário', 'Ação', 'Resultado', 'IP'].map((h) => el('th', { text: h })))),
        el('tbody', {}, rows.map((l) => el('tr', {}, [el('td', { text: fmt.datetime(l.created_at) }), el('td', { text: l.user_name || '—' }), el('td', {}, [badge(l.action, l.result === 'denied' ? 'red' : 'gray')]), el('td', { text: l.result }), el('td', { text: l.ip || '—' })]))),
      ])])],
      footer: [el('button', { class: 'btn primary', text: 'Fechar', onClick: close })],
    }));
  }

  async function openAccessAdmin() {
    let users;
    try { users = await api.get('/vault/access'); } catch (e) { toast(e.message, 'error'); return; }
    modal((close) => {
      const body = el('div', {});
      const table = el('table', { class: 'data' }, [
        el('thead', {}, el('tr', {}, ['Usuário', 'Acesso', 'PIN', 'Permissões', 'Ações'].map((h) => el('th', { text: h })))),
        el('tbody', {}, users.map((u) => el('tr', {}, [
          el('td', {}, [el('strong', { text: u.full_name }), el('div', { class: 'hint', text: u.email })]),
          el('td', {}, [badge(u.enabled ? 'Autorizado' : 'Sem acesso', u.enabled ? 'green' : 'gray')]),
          el('td', {}, [u.has_pin ? badge('Configurado', 'blue') : badge('Sem PIN', 'gray')]),
          el('td', { class: 'hint', text: Object.entries(u.permissions).filter(([, v]) => v).map(([k]) => k).join(', ') || '—' }),
          el('td', { class: 'right' }, [
            el('button', { class: 'btn sm', text: 'Editar', onClick: () => editAccess(u, close) }),
            u.has_pin ? el('button', { class: 'btn sm danger', text: 'Reset PIN', onClick: () => resetPin(u, close) }) : null,
          ]),
        ]))),
      ]);
      body.appendChild(table);
      return { title: 'Usuários autorizados no Cofre', size: 'wide', body: [body, el('div', { class: 'hint mt', text: 'Cada usuário possui um PIN individual — o sistema identifica exatamente quem acessou cada credencial.' })], footer: [el('button', { class: 'btn primary', text: 'Fechar', onClick: close })] };
    });
  }

  function editAccess(u, closeParent) {
    closeParent();
    const VPERMS = [['view', 'Visualizar'], ['reveal', 'Revelar senha'], ['copy', 'Copiar senha'], ['create', 'Cadastrar'], ['edit', 'Editar'], ['delete', 'Excluir'], ['history', 'Histórico'], ['logs', 'Logs']];
    modal((close) => {
      const enabled = el('input', { type: 'checkbox', checked: u.enabled });
      const checks = {};
      const permBox = el('div', { class: 'form-grid' }, VPERMS.map(([k, label]) => {
        const cb = el('input', { type: 'checkbox', checked: !!u.permissions[k] }); checks[k] = cb;
        return el('label', { class: 'flex', style: 'gap:8px' }, [cb, label]);
      }));
      async function save() {
        const permissions = {}; for (const [k] of VPERMS) permissions[k] = checks[k].checked;
        try { await api.put('/vault/access/' + u.id, { enabled: enabled.checked, permissions }); toast('Permissões atualizadas.', 'success'); close(); openAccessAdmin(); }
        catch (e) { toast(e.message, 'error'); }
      }
      return { title: 'Acesso ao Cofre — ' + u.full_name, body: [field('Acesso ao Cofre habilitado', enabled), el('h4', { text: 'Permissões' }), permBox], footer: [el('button', { class: 'btn', text: 'Cancelar', onClick: close }), el('button', { class: 'btn primary', text: 'Salvar', onClick: save })] };
    });
  }

  function resetPin(u, closeParent) {
    closeParent();
    modal((close) => {
      const adminPin = input('adminPin', '', { type: 'password', inputmode: 'numeric', placeholder: 'Seu PIN de administrador' });
      async function go() {
        try { await api.post(`/vault/access/${u.id}/reset-pin`, { adminPin: adminPin.value }); toast('PIN redefinido. Sessões do usuário encerradas.', 'success'); close(); openAccessAdmin(); }
        catch (e) { toast(e.message, 'error'); }
      }
      return { title: 'Redefinir PIN de ' + u.full_name, size: 'narrow',
        body: [el('p', { class: 'hint', text: 'A redefinição encerra todas as sessões do Cofre do usuário. Confirme sua identidade com seu próprio PIN.' }), field('Seu PIN', adminPin)],
        footer: [el('button', { class: 'btn', text: 'Cancelar', onClick: close }), el('button', { class: 'btn danger', text: 'Redefinir', onClick: go })] };
    });
  }

  load();
}

function kv(k, v) { return (v == null || v === '') ? null : el('div', { class: 'field' }, [el('label', { text: k }), el('div', { text: String(v) })]); }
