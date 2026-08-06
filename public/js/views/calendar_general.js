import { api } from '../api.js';
import { el, fmt } from '../ui.js';
import { store } from '../store.js';
import { renderCalendar } from './calendar_component.js';

export async function renderGeneralCalendar(root) {
  // Load accessible clients for the filter.
  if (!store.clients.length) { try { store.clients = await api.get('/clients'); } catch { /* ignore */ } }

  const filters = { client_id: '', types: '' };
  const totalsWrap = el('div', { class: 'grid cols-4 mb' });

  const clientSel = el('select', {}, [el('option', { value: '', text: 'Todos os clientes' }),
    ...store.clients.map((c) => el('option', { value: c.id, text: c.trade_name }))]);
  clientSel.addEventListener('change', () => { filters.client_id = clientSel.value; cal.refresh(); });

  const typeSel = el('select', {}, [
    el('option', { value: '', text: 'Todos os tipos' }),
    el('option', { value: 'pagamento', text: 'Somente pagamentos' }),
    el('option', { value: 'rotina', text: 'Somente rotinas' }),
    el('option', { value: 'vencimento', text: 'Somente vencimentos' }),
  ]);
  typeSel.addEventListener('change', () => { filters.types = typeSel.value; cal.refresh(); });

  root.appendChild(el('div', { class: 'flex mb', style: 'gap:10px' }, [clientSel, typeSel]));
  root.appendChild(totalsWrap);
  const calWrap = el('div', {});
  root.appendChild(calWrap);

  const cal = renderCalendar(calWrap, async (from, to) => {
    const params = new URLSearchParams({ from, to });
    if (filters.client_id) params.set('client_id', filters.client_id);
    if (filters.types) params.set('types', filters.types);
    const res = await api.get('/calendar/general?' + params.toString());
    renderTotals(totalsWrap, res.totals);
    return res.events;
  }, { onEventAction: (ev) => { if (ev.clientId) location.hash = `#/client/${ev.clientId}`; } });
}

function renderTotals(wrap, t) {
  wrap.replaceChildren(
    kpi('Total previsto', fmt.money(t.previsto)),
    kpi('Total pago', fmt.money(t.pago), 'success'),
    kpi('Total em atraso', fmt.money(t.atrasado), 'danger'),
    kpi('Pendências', `${t.pagamentosPendentes + t.rotinasPendentes}`, 'warning'),
  );
}
function kpi(label, value, tone = '') {
  return el('div', { class: `kpi ${tone}` }, [el('div', { class: 'label', text: label }), el('div', { class: 'value small', text: value })]);
}
