import { api } from '../api.js';
import { el, clear, fmt, toast, modal, field, input, select, textarea, readForm, badge, confirmDialog } from '../ui.js';
import { can, LABELS, STATUS_COLOR } from '../store.js';
import { recurrenceForm } from './recurrence_form.js';

export function renderRoutines(container, clientId, units) {
  const wrap = el('div', {});
  container.appendChild(el('div', { class: 'flex between mb' }, [
    el('h3', { text: 'Rotinas operacionais', style: 'margin:0' }),
    can('manage_routines') ? el('button', { class: 'btn primary', text: '+ Nova rotina', onClick: () => openForm() }) : null,
  ]));
  container.appendChild(wrap);

  const unitOptions = [{ value: '', label: '— Sem unidade —' }, ...units.map((u) => ({ value: u.id, label: u.name }))];

  async function load() {
    clear(wrap);
    const rows = await api.get('/routines?client_id=' + clientId);
    if (!rows.length) { wrap.appendChild(el('div', { class: 'empty', text: 'Nenhuma rotina cadastrada.' })); return; }
    const grid = el('div', { class: 'grid cols-2' });
    for (const r of rows) {
      grid.appendChild(el('div', { class: 'card', style: 'cursor:pointer', onClick: () => openDetail(r.id) }, [
        el('div', { class: 'card-body' }, [
          el('div', { class: 'flex between' }, [
            el('strong', { text: r.title }),
            badge(LABELS.frequency[r.frequency] || r.frequency, 'purple'),
          ]),
          el('div', { class: 'hint', text: r.description || '' }),
          el('div', { class: 'flex', style: 'gap:8px;margin-top:10px' }, [
            r.pending ? badge(`${r.pending} pendentes`, 'blue') : null,
            r.late ? badge(`${r.late} atrasadas`, 'red') : null,
            el('span', { class: 'hint', text: `${r.time || ''} · ${r.responsible || ''}` }),
          ]),
        ]),
      ]));
    }
    wrap.appendChild(grid);
  }

  function openForm() {
    modal((close) => {
      const rec = recurrenceForm({ frequency: 'weekly' });
      const meta = el('div', { class: 'form-grid' }, [
        field('Título *', input('title', '')),
        field('Unidade', select('unit_id', unitOptions)),
        field('Categoria', input('category', '')),
        field('Setor', input('sector', '')),
        field('Responsável', input('responsible', '')),
        field('Horário', input('time', '09:00', { type: 'time' })),
        field('Prioridade', select('priority', [['baixa', 'Baixa'], ['media', 'Média'], ['alta', 'Alta']].map(([value, label]) => ({ value, label })), 'media')),
        field('Exige comprovação', el('input', { name: 'needs_proof', type: 'checkbox' })),
      ]);
      const desc = textarea('description', '');
      const previewBox = el('div', { class: 'card', style: 'margin-top:12px' });

      async function preview() {
        clear(previewBox);
        try { const r = await api.post('/routines/preview', rec.getConfig());
          previewBox.appendChild(el('div', { class: 'card-body' }, [el('strong', { text: `Prévia: ${r.count} ocorrência(s)` }), el('div', { class: 'hint', style: 'margin-top:6px', text: r.dates.slice(0, 24).map(fmt.date).join(' · ') + (r.dates.length > 24 ? ' …' : '') })]));
        } catch (e) { previewBox.appendChild(el('div', { class: 'card-body', text: 'Erro: ' + e.message })); }
      }
      async function save() {
        const cfg = rec.getConfig();
        const data = { ...readForm(meta), description: desc.value, client_id: clientId, frequency: cfg.frequency, config: cfg, start_date: cfg.startDate, end_date: cfg.endDate };
        if (!data.title) { toast('Título é obrigatório.', 'error'); return; }
        try { const r = await api.post('/routines', data); toast(`Rotina criada com ${r.occurrences} ocorrência(s).`, 'success'); close(); load(); }
        catch (e) { toast(e.message, 'error'); }
      }
      return {
        title: 'Nova rotina', size: 'wide',
        body: [meta, field('Descrição', desc, { full: true }), el('h4', { text: 'Recorrência' }), rec.node, previewBox],
        footer: [el('button', { class: 'btn', text: 'Cancelar', onClick: close }), el('button', { class: 'btn', text: 'Pré-visualizar', onClick: preview }), el('button', { class: 'btn primary', text: 'Criar', onClick: save })],
      };
    });
  }

  async function openDetail(id) {
    const r = await api.get('/routines/' + id);
    modal((close) => {
      const occList = el('div', { class: 'table-wrap', style: 'max-height:320px;overflow-y:auto' }, [
        el('table', { class: 'data' }, [
          el('thead', {}, el('tr', {}, ['Data', 'Status', ''].map((h) => el('th', { text: h })))),
          el('tbody', {}, r.occurrences.map((o) => el('tr', {}, [
            el('td', { text: fmt.date(o.date) }),
            el('td', {}, [badge(LABELS.occStatus[o.status] || o.status, STATUS_COLOR[o.status])]),
            el('td', { class: 'right' }, [
              (o.status === 'pendente' || o.status === 'atrasada') && can('complete_routines') ?
                el('button', { class: 'btn sm', text: 'Concluir', onClick: async () => { await api.post(`/routines/occurrences/${o.id}/complete`, {}); toast('Concluída.', 'success'); close(); openDetail(id); } }) : el('span', { class: 'hint', text: o.completed_by || '' }),
            ]),
          ]))),
        ]),
      ]);
      return {
        title: r.title, size: 'wide',
        body: [
          el('div', { class: 'form-grid' }, [
            kv('Frequência', LABELS.frequency[r.frequency]), kv('Responsável', r.responsible), kv('Categoria', r.category),
            kv('Horário', r.time), kv('Período', `${fmt.date(r.start_date)} → ${fmt.date(r.end_date)}`), kv('Prioridade', r.priority),
          ]),
          r.description ? el('p', { text: r.description }) : null,
          el('h4', { text: 'Ocorrências' }), occList,
        ],
        footer: [
          can('manage_routines') ? el('button', { class: 'btn danger', text: 'Excluir rotina', onClick: async () => { if (await confirmDialog('Excluir a rotina e todas as ocorrências?')) { await api.del('/routines/' + id); toast('Excluída.', 'success'); close(); load(); } } }) : null,
          el('button', { class: 'btn primary', text: 'Fechar', onClick: close }),
        ],
      };
    });
  }

  load();
}

function kv(k, v) { return el('div', { class: 'field' }, [el('label', { text: k }), el('div', { text: v || '—' })]); }
