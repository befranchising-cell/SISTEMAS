import { el, clear, fmt, modal, badge } from '../ui.js';

const TYPE_COLOR = {
  pagamento: '#2563eb', pagamento_atrasado: '#dc2626', pagamento_pago: '#16a34a',
  rotina: '#7c3aed', rotina_atrasada: '#d97706', vencimento: '#0891b2',
  pendencia: '#dc2626', evento: '#475569', alerta: '#d97706',
};
const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/**
 * Reusable month calendar (§9, §10). `fetchEvents(fromISO, toISO)` returns an
 * array of { date, title, type, kind, status, amount, clientName, ... }.
 * `onEventAction` (optional) receives (event) when an event is clicked.
 */
export function renderCalendar(container, fetchEvents, { onEventAction } = {}) {
  let cursor = new Date();
  cursor.setDate(1);

  const legend = el('div', { class: 'legend' }, [
    legendItem('#2563eb', 'Pagamento'),
    legendItem('#dc2626', 'Atrasado'),
    legendItem('#16a34a', 'Pago'),
    legendItem('#7c3aed', 'Rotina'),
    legendItem('#0891b2', 'Vencimento'),
  ]);

  const monthLabel = el('strong', { style: 'font-size:16px;min-width:170px;text-align:center' });
  const grid = el('div', {});

  const controls = el('div', { class: 'flex between mb' }, [
    el('div', { class: 'flex', style: 'gap:6px' }, [
      el('button', { class: 'btn sm', text: '‹ Anterior', onClick: () => { cursor.setMonth(cursor.getMonth() - 1); draw(); } }),
      monthLabel,
      el('button', { class: 'btn sm', text: 'Próximo ›', onClick: () => { cursor.setMonth(cursor.getMonth() + 1); draw(); } }),
      el('button', { class: 'btn sm', text: 'Hoje', onClick: () => { cursor = new Date(); cursor.setDate(1); draw(); } }),
    ]),
  ]);

  container.appendChild(controls);
  container.appendChild(legend);
  container.appendChild(grid);

  async function draw() {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    monthLabel.textContent = cursor.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

    const first = new Date(year, month, 1);
    const startOffset = first.getDay();
    const gridStart = new Date(year, month, 1 - startOffset);
    const from = iso(gridStart);
    const to = iso(new Date(year, month, 42 - startOffset));

    clear(grid);
    grid.appendChild(el('div', { class: 'muted', text: 'Carregando…' }));
    let events = [];
    try { events = await fetchEvents(from, to); } catch (e) { clear(grid); grid.appendChild(el('div', { class: 'empty', text: 'Erro: ' + e.message })); return; }

    const byDate = {};
    for (const ev of events) { (byDate[ev.date] = byDate[ev.date] || []).push(ev); }

    clear(grid);
    const head = el('div', { class: 'cal-grid' }, WD.map((d) => el('div', { class: 'cal-head', text: d })));
    grid.appendChild(head);
    const cells = el('div', { class: 'cal-grid' });
    const todayIso = iso(new Date());
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      const dIso = iso(d);
      const inMonth = d.getMonth() === month;
      const cell = el('div', { class: `cal-cell ${inMonth ? '' : 'other'} ${dIso === todayIso ? 'today' : ''}` }, [
        el('div', { class: 'daynum', text: String(d.getDate()) }),
      ]);
      const evs = (byDate[dIso] || []).slice(0, 4);
      for (const ev of evs) {
        cell.appendChild(el('span', {
          class: 'cal-ev', title: ev.title,
          style: `background:${TYPE_COLOR[ev.kind] || TYPE_COLOR[ev.type] || '#475569'}`,
          text: ev.title,
          onClick: (e) => { e.stopPropagation(); showEvent(ev, onEventAction); },
        }));
      }
      if ((byDate[dIso] || []).length > 4) cell.appendChild(el('span', { class: 'hint', text: `+${byDate[dIso].length - 4} mais` }));
      cells.appendChild(cell);
    }
    grid.appendChild(cells);
  }

  draw();
  return { refresh: draw };
}

function showEvent(ev, onEventAction) {
  modal((close) => ({
    title: ev.title,
    size: 'narrow',
    body: [
      row('Data', fmt.date(ev.date)),
      ev.clientName ? row('Cliente', ev.clientName) : null,
      ev.status ? row('Status', ev.status) : null,
      ev.amount != null ? row('Valor', fmt.money(ev.amount)) : null,
    ],
    footer: [
      onEventAction ? el('button', { class: 'btn primary', text: 'Abrir', onClick: () => { close(); onEventAction(ev); } }) : null,
      el('button', { class: 'btn', text: 'Fechar', onClick: close }),
    ],
  }));
}

function row(label, value) {
  return el('div', { class: 'flex between', style: 'padding:6px 0;border-bottom:1px solid var(--border)' }, [
    el('span', { class: 'muted', text: label }), el('strong', { text: String(value) }),
  ]);
}
function legendItem(color, label) {
  return el('div', { class: 'item' }, [el('span', { class: 'dot', style: `background:${color}` }), label]);
}
function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
