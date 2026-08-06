import { api } from '../api.js';
import { el, fmt } from '../ui.js';
import { LABELS } from '../store.js';

function kpi(label, value, { sub, tone } = {}) {
  return el('div', { class: `kpi ${tone || ''}` }, [
    el('div', { class: 'label', text: label }),
    el('div', { class: 'value', text: value }),
    sub ? el('div', { class: 'sub', text: sub }) : null,
  ]);
}

export async function renderDashboard(root) {
  const d = await api.get('/dashboard/general');

  root.appendChild(el('div', { class: 'grid cols-4 mb' }, [
    kpi('Clientes', d.totalClients, { sub: `${d.activeClients} ativos` }),
    kpi('Colaboradores', d.totalCollab),
    kpi('Previsto no mês', fmt.money(d.payMonth.v), { sub: `${d.payMonth.n} pagamentos`, tone: '' }),
    kpi('Pago no mês', fmt.money(d.payPaid.v), { tone: 'success' }),
  ]));

  root.appendChild(el('div', { class: 'grid cols-4 mb' }, [
    kpi('Pagamentos atrasados', d.payLate.n, { sub: fmt.money(d.payLate.v), tone: 'danger' }),
    kpi('Rotinas pendentes', d.routinesPending, { tone: '' }),
    kpi('Rotinas atrasadas', d.routinesLate, { tone: 'warning' }),
    kpi('Dados bancários incompletos', d.bankIncomplete, { tone: d.bankIncomplete ? 'warning' : '' }),
  ]));

  const byContract = el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [el('h3', { text: 'Colaboradores por forma de contratação' })]),
    el('div', { class: 'card-body' }, [
      d.byContract.length ? el('ul', { class: 'list-clean' }, d.byContract.map((c) =>
        el('li', {}, [el('span', { text: LABELS.contract[c.contract_type] || c.contract_type || '—' }), el('strong', { text: String(c.n) })]),
      )) : el('div', { class: 'empty', text: 'Sem dados.' }),
    ]),
  ]);

  const upcoming = el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [el('h3', { text: 'Próximos compromissos' })]),
    el('div', { class: 'card-body' }, [
      d.upcoming.length ? el('ul', { class: 'list-clean' }, d.upcoming.map((u) =>
        el('li', {}, [
          el('span', {}, [el('strong', { text: fmt.date(u.date) }), ' — ', u.ref || 'Avulso', el('span', { class: 'muted', text: ' · ' + u.client })]),
        ]),
      )) : el('div', { class: 'empty', text: 'Nada agendado.' }),
    ]),
  ]);

  const pending = el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [el('h3', { text: 'Clientes com pendências' })]),
    el('div', { class: 'card-body' }, [
      d.pendingByClient.length ? el('ul', { class: 'list-clean' }, d.pendingByClient.map((c) =>
        el('li', {}, [el('a', { href: `#/client/${c.id}`, text: c.name }), el('span', { class: 'badge red', text: `${c.pending} pendências` })]),
      )) : el('div', { class: 'empty', text: 'Nenhuma pendência. 🎉' }),
    ]),
  ]);

  root.appendChild(el('div', { class: 'grid cols-3' }, [byContract, upcoming, pending]));
}
