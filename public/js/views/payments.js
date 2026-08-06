import { api } from '../api.js';
import { el, clear, fmt, toast, modal, field, input, select, textarea, readForm, badge, confirmDialog } from '../ui.js';
import { can, LABELS, STATUS_COLOR } from '../store.js';
import { recurrenceForm } from './recurrence_form.js';

export function renderPayments(container, clientId, collaborators, units) {
  const state = { status: '' };
  const selected = new Set();
  const wrap = el('div', {});

  const statusSel = select('status', [{ value: '', label: 'Todos os status' }, ...Object.entries(LABELS.payStatus).map(([value, label]) => ({ value, label }))], '');
  statusSel.addEventListener('change', () => { state.status = statusSel.value; load(); });

  const bulkBtn = el('button', { class: 'btn', text: 'Marcar selecionados como pagos', disabled: true, onClick: bulkPay });

  const header = el('div', { class: 'flex between mb' }, [
    el('div', { class: 'flex', style: 'gap:10px' }, [el('h3', { text: 'Pagamentos', style: 'margin:0' }), statusSel]),
    el('div', { class: 'flex', style: 'gap:8px' }, [
      bulkBtn,
      can('manage_payments') ? el('button', { class: 'btn', text: 'Pagamento avulso', onClick: () => openSingle() }) : null,
      can('manage_payments') ? el('button', { class: 'btn primary', text: '+ Programar pagamentos', onClick: () => openSchedule() }) : null,
    ]),
  ]);
  container.appendChild(header);
  container.appendChild(wrap);

  function updateBulk() { bulkBtn.disabled = selected.size === 0; bulkBtn.textContent = `Marcar ${selected.size || ''} como pagos`.trim(); }

  async function load() {
    clear(wrap); selected.clear(); updateBulk();
    const params = new URLSearchParams({ client_id: clientId });
    if (state.status) params.set('status', state.status);
    const rows = await api.get('/payments?' + params.toString());
    if (!rows.length) { wrap.appendChild(el('div', { class: 'empty', text: 'Nenhum pagamento.' })); return; }
    const table = el('table', { class: 'data' }, [
      el('thead', {}, el('tr', {}, [el('th', { text: '' }), ...['Vencimento', 'Colaborador', 'Competência', 'Valor', 'Status', ''].map((h) => el('th', { text: h }))])),
      el('tbody', {}, rows.map((p) => {
        const cb = el('input', { type: 'checkbox', onChange: (e) => { e.target.checked ? selected.add(p.id) : selected.delete(p.id); updateBulk(); } });
        return el('tr', {}, [
          el('td', {}, [p.status !== 'pago' && p.status !== 'cancelado' ? cb : '']),
          el('td', { text: fmt.date(p.due_date) }),
          el('td', { text: p.collaborator_name || '—' }),
          el('td', { text: p.competence || '—' }),
          el('td', { text: fmt.money(p.amount_planned) }),
          el('td', {}, [badge(LABELS.payStatus[p.status] || p.status, STATUS_COLOR[p.status])]),
          el('td', { class: 'right' }, [el('button', { class: 'btn sm', text: 'Detalhes', onClick: () => openDetail(p) })]),
        ]);
      })),
    ]);
    wrap.appendChild(el('div', { class: 'table-wrap card' }, [table]));
  }

  async function bulkPay() {
    if (!selected.size) return;
    if (!await confirmDialog(`Marcar ${selected.size} pagamento(s) como pagos?`, { danger: false, confirmLabel: 'Confirmar' })) return;
    try { const r = await api.post('/payments/bulk-pay', { ids: [...selected] }); toast(`${r.updated} pagamento(s) atualizados.`, 'success'); load(); }
    catch (e) { toast(e.message, 'error'); }
  }

  const collabOptions = [{ value: '', label: '— Selecione —' }, ...collaborators.map((c) => ({ value: c.id, label: c.full_name }))];
  const unitOptions = [{ value: '', label: '— Sem unidade —' }, ...units.map((u) => ({ value: u.id, label: u.name }))];

  function openSchedule() {
    modal((close) => {
      const collabSel = select('collaborator_id', collabOptions);
      const unitSel = select('unit_id', unitOptions);
      const amount = input('amount', '', { type: 'number', step: '0.01', placeholder: '0,00' });
      const needsInvoice = el('input', { name: 'needs_invoice', type: 'checkbox' });
      const rec = recurrenceForm();
      const previewBox = el('div', { class: 'card', style: 'margin-top:12px' });

      async function preview() {
        clear(previewBox);
        const cfg = rec.getConfig();
        try {
          const r = await api.post('/payments/preview', cfg);
          previewBox.appendChild(el('div', { class: 'card-body' }, [
            el('strong', { text: `Prévia: ${r.count} pagamento(s) serão gerados` }),
            el('div', { class: 'hint', style: 'margin-top:6px', text: r.dates.slice(0, 24).map(fmt.date).join(' · ') + (r.dates.length > 24 ? ' …' : '') }),
          ]));
        } catch (e) { previewBox.appendChild(el('div', { class: 'card-body', text: 'Erro na prévia: ' + e.message })); }
      }

      async function save() {
        const cfg = rec.getConfig();
        const body = { client_id: clientId, collaborator_id: collabSel.value, unit_id: unitSel.value || null, amount: amount.value || null, needs_invoice: needsInvoice.checked, frequency: cfg.frequency, config: cfg, competence: cfg.startDate?.slice(0, 7) };
        if (!collabSel.value) { toast('Selecione o colaborador.', 'error'); return; }
        try { const r = await api.post('/payments/schedule', body); toast(`${r.generated} pagamentos programados.`, 'success'); close(); load(); }
        catch (e) { toast(e.message, 'error'); }
      }

      return {
        title: 'Programar pagamentos', size: 'wide',
        body: [
          el('div', { class: 'form-grid' }, [field('Colaborador *', collabSel), field('Unidade', unitSel), field('Valor previsto', amount), field('Necessita nota fiscal', needsInvoice)]),
          el('h4', { text: 'Periodicidade' }), rec.node, previewBox,
        ],
        footer: [el('button', { class: 'btn', text: 'Cancelar', onClick: close }), el('button', { class: 'btn', text: 'Pré-visualizar', onClick: preview }), el('button', { class: 'btn primary', text: 'Gerar pagamentos', onClick: save })],
      };
    });
  }

  function openSingle() {
    modal((close) => {
      const form = el('div', { class: 'form-grid' }, [
        field('Colaborador', select('collaborator_id', collabOptions)),
        field('Vencimento *', input('due_date', '', { type: 'date' })),
        field('Competência', input('competence', '', { placeholder: 'AAAA-MM' })),
        field('Valor previsto', input('amount_planned', '', { type: 'number', step: '0.01' })),
      ]);
      async function save() {
        const data = { ...readForm(form), client_id: clientId };
        if (!data.due_date) { toast('Vencimento é obrigatório.', 'error'); return; }
        try { await api.post('/payments', data); toast('Pagamento criado.', 'success'); close(); load(); } catch (e) { toast(e.message, 'error'); }
      }
      return { title: 'Pagamento avulso', body: [form], footer: [el('button', { class: 'btn', text: 'Cancelar', onClick: close }), el('button', { class: 'btn primary', text: 'Salvar', onClick: save })] };
    });
  }

  function openDetail(p) {
    modal((close) => {
      const statusSel2 = select('status', Object.entries(LABELS.payStatus).map(([value, label]) => ({ value, label })), p.status);
      const form = el('div', { class: 'form-grid' }, [
        field('Status', statusSel2),
        field('Data efetiva', input('paid_date', p.paid_date, { type: 'date' })),
        field('Valor pago', input('amount_paid', p.amount_paid, { type: 'number', step: '0.01' })),
        field('Descontos', input('discounts', p.discounts, { type: 'number', step: '0.01' })),
        field('Acréscimos', input('additions', p.additions, { type: 'number', step: '0.01' })),
        field('Forma de pagamento', input('method', p.method)),
        field('Novo vencimento (reagendar)', input('due_date', p.due_date, { type: 'date' })),
        field('Observações', textarea('notes', p.notes), { full: true }),
      ]);
      async function save() {
        try { await api.put('/payments/' + p.id, readForm(form)); toast('Pagamento atualizado.', 'success'); close(); load(); } catch (e) { toast(e.message, 'error'); }
      }
      const footer = [];
      if (can('approve_payments') && !can('manage_payments')) footer.push(el('button', { class: 'btn primary', text: 'Aprovar', onClick: async () => { await api.post(`/payments/${p.id}/approve`); toast('Aprovado.', 'success'); close(); load(); } }));
      footer.push(el('button', { class: 'btn', text: 'Fechar', onClick: close }));
      if (can('manage_payments')) footer.push(el('button', { class: 'btn primary', text: 'Salvar', onClick: save }));
      return { title: `Pagamento — ${p.collaborator_name || 'Avulso'}`, size: 'wide', body: [form], footer };
    });
  }

  load();
}
