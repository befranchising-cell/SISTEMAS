import { api } from '../api.js';
import { el, clear, fmt, toast, badge } from '../ui.js';

export async function renderNotifications(root) {
  const wrap = el('div', {});
  root.appendChild(el('div', { class: 'flex between mb' }, [
    el('h3', { text: 'Central de notificações', style: 'margin:0' }),
    el('button', { class: 'btn', text: 'Marcar todas como lidas', onClick: async () => { await api.post('/notifications/read-all', {}); toast('Tudo lido.', 'success'); load(); } }),
  ]));
  root.appendChild(el('p', { class: 'hint', text: 'As notificações nunca incluem senhas, PINs ou códigos secretos.' }));
  root.appendChild(wrap);

  async function load() {
    clear(wrap);
    const rows = await api.get('/notifications');
    if (!rows.length) { wrap.appendChild(el('div', { class: 'empty', text: 'Nenhuma notificação.' })); return; }
    const card = el('div', { class: 'card' });
    for (const n of rows) {
      card.appendChild(el('div', { class: `notif-item ${n.read_at ? '' : 'unread'}`, onClick: async () => { if (!n.read_at) { await api.post(`/notifications/${n.id}/read`, {}); load(); } } }, [
        el('div', {}, [el('span', { class: 'dot', style: `background:${sev(n.severity)};margin-top:6px` })]),
        el('div', { style: 'flex:1' }, [
          el('div', { class: 'flex', style: 'gap:8px' }, [el('strong', { text: n.title }), n.scope === 'cofre' ? badge('Cofre', 'purple') : null]),
          el('div', { class: 'hint', text: n.message || '' }),
        ]),
        el('div', { class: 'hint', text: fmt.datetime(n.created_at) }),
      ]));
    }
    wrap.appendChild(card);
  }
  function sev(s) { return s === 'critical' ? 'var(--danger)' : s === 'warning' ? 'var(--warning)' : 'var(--primary)'; }
  load();
}
