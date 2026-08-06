import { api } from '../api.js';
import { el, clear, fmt, toast, modal, field, input, select, readForm, badge, confirmDialog } from '../ui.js';
import { isAdmin, can, LABELS, STATUS_COLOR } from '../store.js';
import { renderCollaborators } from './collaborators.js';
import { renderPayments } from './payments.js';
import { renderRoutines } from './routines.js';
import { renderCalendar } from './calendar_component.js';
import { renderVaultPanel } from './vault.js';
import { openClientForm } from './clients.js';

export async function renderClientPanel(root, clientIdStr) {
  const clientId = Number(clientIdStr);
  let client;
  try { client = await api.get('/clients/' + clientId); }
  catch (e) { root.appendChild(el('div', { class: 'empty', text: e.status === 403 ? 'Sem acesso a este cliente.' : 'Cliente não encontrado.' })); return; }

  // Header
  root.appendChild(el('div', { class: 'flex between mb' }, [
    el('div', {}, [
      el('div', { class: 'flex', style: 'gap:10px' }, [
        el('a', { href: '#/clients', class: 'muted', text: '← Clientes' }),
      ]),
      el('h2', { text: client.trade_name, style: 'margin:4px 0' }),
      el('div', { class: 'flex', style: 'gap:8px' }, [
        badge(LABELS.clientStatus[client.status] || client.status, STATUS_COLOR[client.status]),
        el('span', { class: 'hint', text: `${client.segment || ''} · ${client.cnpj || ''}` }),
      ]),
    ]),
    isAdmin() ? el('button', { class: 'btn', text: 'Editar cliente', onClick: () => openClientForm(client, () => location.reload()) }) : null,
  ]));

  // Tabs
  const TABS = [
    { key: 'overview', label: 'Visão geral' },
    { key: 'collaborators', label: 'Colaboradores' },
    { key: 'payments', label: 'Pagamentos' },
    { key: 'routines', label: 'Rotinas' },
    { key: 'calendar', label: 'Calendário' },
    { key: 'units', label: 'Unidades' },
    { key: 'vault', label: '🔐 Cofre' },
  ];
  const tabBar = el('div', { class: 'tabs' });
  const panel = el('div', {});
  let active = 'overview';

  function selectTab(key) {
    active = key;
    tabBar.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.key === key));
    clear(panel);
    draw(key);
  }
  TABS.forEach((t) => tabBar.appendChild(el('button', { 'data-key': t.key, class: t.key === active ? 'active' : '', text: t.label, onClick: () => selectTab(t.key) })));
  root.appendChild(tabBar);
  root.appendChild(panel);

  async function draw(key) {
    if (key === 'overview') return drawOverview(panel, clientId);
    if (key === 'collaborators') return renderCollaborators(panel, clientId, client.units);
    if (key === 'payments') {
      const collabs = await api.get('/collaborators?client_id=' + clientId);
      return renderPayments(panel, clientId, collabs, client.units);
    }
    if (key === 'routines') return renderRoutines(panel, clientId, client.units);
    if (key === 'calendar') {
      return renderCalendar(panel, async (from, to) => api.get(`/calendar/client/${clientId}?from=${from}&to=${to}`));
    }
    if (key === 'units') return drawUnits(panel, clientId, client);
    if (key === 'vault') return renderVaultPanel(panel, { clientId, clientName: client.trade_name });
  }

  selectTab('overview');
}

async function drawOverview(panel, clientId) {
  const d = await api.get('/dashboard/client/' + clientId);
  panel.appendChild(el('div', { class: 'grid cols-4 mb' }, [
    kpi('Colaboradores', d.collaborators), kpi('Unidades', d.units),
    kpi('Previsto no mês', fmt.money(d.payMonth.v)), kpi('Pago no mês', fmt.money(d.payPaid), 'success'),
  ]));
  panel.appendChild(el('div', { class: 'grid cols-4' }, [
    kpi('Pagamentos atrasados', d.payLate, d.payLate ? 'danger' : ''),
    kpi('Rotinas pendentes', d.routinesPending),
    kpi('Rotinas atrasadas', d.routinesLate, d.routinesLate ? 'warning' : ''),
    kpi('Credenciais no cofre', d.credentials),
  ]));
}

async function drawUnits(panel, clientId, client) {
  const wrap = el('div', {});
  panel.appendChild(el('div', { class: 'flex between mb' }, [
    el('h3', { text: 'Unidades', style: 'margin:0' }),
    el('button', { class: 'btn primary', text: '+ Nova unidade', onClick: () => openUnitForm() }),
  ]));
  panel.appendChild(wrap);

  async function load() {
    clear(wrap);
    const units = await api.get(`/clients/${clientId}/units`);
    client.units = units;
    if (!units.length) { wrap.appendChild(el('div', { class: 'empty', text: 'Nenhuma unidade.' })); return; }
    const grid = el('div', { class: 'grid cols-3' });
    for (const u of units) {
      grid.appendChild(el('div', { class: 'card' }, [el('div', { class: 'card-body' }, [
        el('div', { class: 'flex between' }, [el('strong', { text: u.name }), badge(u.status, STATUS_COLOR[u.status])]),
        el('div', { class: 'hint', text: `${u.internal_code || ''} · ${u.city || ''}/${u.state || ''}` }),
        el('div', { class: 'hint', text: u.hours || '' }),
        el('button', { class: 'btn sm mt', text: 'Editar', onClick: () => openUnitForm(u) }),
      ])]));
    }
    wrap.appendChild(grid);
  }

  function openUnitForm(unit) {
    modal((close) => {
      const form = el('div', { class: 'form-grid' }, [
        field('Nome *', input('name', unit?.name)), field('Código interno', input('internal_code', unit?.internal_code)),
        field('CNPJ', input('cnpj', unit?.cnpj)), field('Telefone', input('phone', unit?.phone)),
        field('E-mail', input('email', unit?.email)), field('Responsável', input('responsible', unit?.responsible)),
        field('Cidade', input('city', unit?.city)), field('Estado', input('state', unit?.state)),
        field('Horário de funcionamento', input('hours', unit?.hours)),
        field('Status', select('status', Object.entries(LABELS.clientStatus).map(([value, label]) => ({ value, label })), unit?.status || 'ativo')),
      ]);
      async function save() {
        const data = readForm(form);
        if (!data.name) { toast('Nome é obrigatório.', 'error'); return; }
        try { if (unit) await api.put(`/clients/${clientId}/units/${unit.id}`, data); else await api.post(`/clients/${clientId}/units`, data); toast('Unidade salva.', 'success'); close(); load(); }
        catch (e) { toast(e.message, 'error'); }
      }
      return { title: unit ? 'Editar unidade' : 'Nova unidade', size: 'wide', body: [form], footer: [el('button', { class: 'btn', text: 'Cancelar', onClick: close }), el('button', { class: 'btn primary', text: 'Salvar', onClick: save })] };
    });
  }

  load();
}

function kpi(label, value, tone = '') {
  return el('div', { class: `kpi ${tone}` }, [el('div', { class: 'label', text: label }), el('div', { class: 'value', text: String(value) })]);
}
