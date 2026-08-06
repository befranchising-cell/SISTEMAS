import { api } from '../api.js';
import { el, clear, fmt, badge } from '../ui.js';

export async function renderAudit(root) {
  const wrap = el('div', {});
  const filters = { action: '', from: '', to: '' };
  const actionInput = el('input', { placeholder: 'Filtrar por ação (ex.: login, update_bank)', oninput: (e) => { filters.action = e.target.value; debounced(); } });
  const fromInput = el('input', { type: 'date', onchange: (e) => { filters.from = e.target.value; load(); } });
  const toInput = el('input', { type: 'date', onchange: (e) => { filters.to = e.target.value; load(); } });

  root.appendChild(el('div', { class: 'flex mb', style: 'gap:10px;flex-wrap:wrap' }, [
    actionInput,
    el('div', { class: 'flex', style: 'gap:6px' }, [el('span', { class: 'hint', text: 'De' }), fromInput, el('span', { class: 'hint', text: 'Até' }), toInput]),
  ]));
  root.appendChild(el('p', { class: 'hint', text: 'Os logs de auditoria são imutáveis e não podem ser apagados por usuários comuns.' }));
  root.appendChild(wrap);

  let timer; function debounced() { clearTimeout(timer); timer = setTimeout(load, 300); }

  async function load() {
    clear(wrap); wrap.appendChild(el('div', { class: 'muted', text: 'Carregando…' }));
    const params = new URLSearchParams();
    if (filters.action) params.set('action', filters.action);
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    const rows = await api.get('/audit?' + params.toString());
    clear(wrap);
    if (!rows.length) { wrap.appendChild(el('div', { class: 'empty', text: 'Nenhum registro.' })); return; }
    const table = el('table', { class: 'data' }, [
      el('thead', {}, el('tr', {}, ['Data/Hora', 'Usuário', 'Ação', 'Entidade', 'IP'].map((h) => el('th', { text: h })))),
      el('tbody', {}, rows.map((r) => el('tr', {}, [
        el('td', { text: fmt.datetime(r.created_at) }),
        el('td', { text: r.user_name || '—' }),
        el('td', {}, [badge(r.action, actionColor(r.action))]),
        el('td', { text: `${r.entity_type || ''} ${r.entity_id || ''}`.trim() || '—' }),
        el('td', { text: r.ip || '—' }),
      ]))),
    ]);
    wrap.appendChild(el('div', { class: 'table-wrap card' }, [table]));
  }

  function actionColor(a) {
    if (a.includes('delete') || a.includes('revoke')) return 'red';
    if (a.includes('create')) return 'green';
    if (a.includes('bank') || a.includes('update')) return 'amber';
    return 'gray';
  }

  load();
}
