import { api } from '../api.js';
import { el, clear, fmt, toast, modal, field, input, select, readForm, badge, confirmDialog } from '../ui.js';
import { store, LABELS } from '../store.js';

const PERMS = [
  ['manage_collaborators', 'Gerir colaboradores'], ['manage_payments', 'Gerir pagamentos'],
  ['manage_routines', 'Gerir rotinas'], ['view_reports', 'Ver relatórios'],
  ['view_bank_full', 'Ver dados bancários completos'], ['approve_payments', 'Aprovar pagamentos'],
  ['complete_routines', 'Concluir tarefas'],
];

export async function renderUsers(root) {
  if (!store.clients.length) { try { store.clients = await api.get('/clients'); } catch { /* ignore */ } }
  const wrap = el('div', {});
  root.appendChild(el('div', { class: 'flex between mb' }, [
    el('h3', { text: 'Usuários do sistema', style: 'margin:0' }),
    el('button', { class: 'btn primary', text: '+ Novo usuário', onClick: () => openForm() }),
  ]));
  root.appendChild(wrap);

  async function load() {
    clear(wrap);
    const users = await api.get('/users');
    const table = el('table', { class: 'data' }, [
      el('thead', {}, el('tr', {}, ['Nome', 'E-mail', 'Perfil', '2FA', 'Último acesso', 'Status', ''].map((h) => el('th', { text: h })))),
      el('tbody', {}, users.map((u) => el('tr', {}, [
        el('td', { text: u.full_name }), el('td', { text: u.email }),
        el('td', {}, [badge(LABELS.roles[u.role] || u.role, 'blue')]),
        el('td', { text: u.two_factor_enabled ? 'Sim' : 'Não' }),
        el('td', { text: fmt.datetime(u.last_login_at) }),
        el('td', {}, [badge(u.status, u.status === 'ativo' ? 'green' : 'red')]),
        el('td', { class: 'right' }, [
          el('button', { class: 'btn sm', text: 'Editar', onClick: () => openForm(u) }),
          u.status === 'ativo' ? el('button', { class: 'btn sm danger', text: 'Revogar', onClick: async () => { if (await confirmDialog('Revogar acesso e encerrar sessões deste usuário?')) { await api.post(`/users/${u.id}/revoke`); toast('Acesso revogado.', 'success'); load(); } } }) : null,
        ]),
      ]))),
    ]);
    wrap.appendChild(el('div', { class: 'table-wrap card' }, [table]));
  }

  function openForm(user) {
    modal((close) => {
      const roleSel = select('role', Object.entries(LABELS.roles).map(([value, label]) => ({ value, label })), user?.role || 'consultor');
      const form = el('div', { class: 'form-grid' }, [
        field('Nome completo *', input('full_name', user?.full_name)),
        field('E-mail *', input('email', user?.email, { type: 'email', disabled: !!user })),
        field('Telefone', input('phone', user?.phone)),
        field(user ? 'Nova senha (em branco = manter)' : 'Senha *', input('password', '', { type: 'password' })),
        field('Perfil de acesso', roleSel),
        field('Status', select('status', [['ativo', 'Ativo'], ['inativo', 'Inativo'], ['bloqueado', 'Bloqueado']].map(([value, label]) => ({ value, label })), user?.status || 'ativo')),
        field('Autenticação em dois fatores', el('input', { name: 'two_factor_enabled', type: 'checkbox', checked: user?.two_factor_enabled })),
      ]);

      // Client scope
      const clientChecks = {};
      const clientBox = el('div', { class: 'form-grid' }, store.clients.map((c) => {
        const cb = el('input', { type: 'checkbox', checked: user?.clientIds?.includes(c.id) }); clientChecks[c.id] = cb;
        return el('label', { class: 'flex', style: 'gap:8px' }, [cb, c.trade_name]);
      }));

      // Permission overrides
      const permChecks = {};
      const permBox = el('div', { class: 'form-grid' }, PERMS.map(([k, label]) => {
        const cb = el('input', { type: 'checkbox', checked: !!user?.permissions?.[k] }); permChecks[k] = cb;
        return el('label', { class: 'flex', style: 'gap:8px' }, [cb, label]);
      }));

      async function save() {
        const data = readForm(form);
        data.clientIds = store.clients.filter((c) => clientChecks[c.id].checked).map((c) => c.id);
        data.permissions = {}; for (const [k] of PERMS) data.permissions[k] = permChecks[k].checked;
        if (!data.full_name) { toast('Nome é obrigatório.', 'error'); return; }
        try {
          if (user) await api.put('/users/' + user.id, data);
          else { if (!data.email || !data.password) { toast('E-mail e senha obrigatórios.', 'error'); return; } await api.post('/users', data); }
          toast('Usuário salvo.', 'success'); close(); load();
        } catch (e) { toast(e.message, 'error'); }
      }
      return { title: user ? 'Editar usuário' : 'Novo usuário', size: 'wide',
        body: [form, el('h4', { text: 'Clientes autorizados' }), el('p', { class: 'hint', text: 'Administradores acessam todos os clientes automaticamente.' }), clientBox, el('h4', { text: 'Permissões' }), permBox],
        footer: [el('button', { class: 'btn', text: 'Cancelar', onClick: close }), el('button', { class: 'btn primary', text: 'Salvar', onClick: save })] };
    });
  }

  load();
}
