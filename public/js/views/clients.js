import { api } from '../api.js';
import { el, clear, fmt, toast, modal, field, input, select, textarea, readForm, badge } from '../ui.js';
import { store, isAdmin, LABELS, STATUS_COLOR } from '../store.js';

export async function renderClients(root) {
  const state = { q: '', status: '' };
  const listWrap = el('div', {});

  const search = el('input', { class: 'search', placeholder: 'Pesquisar por nome, razão social ou CNPJ…', oninput: (e) => { state.q = e.target.value; debouncedLoad(); } });
  const statusSel = select('status', [
    { value: '', label: 'Todos os status' },
    ...Object.entries(LABELS.clientStatus).map(([value, label]) => ({ value, label })),
  ], '');
  statusSel.addEventListener('change', () => { state.status = statusSel.value; load(); });

  const header = el('div', { class: 'flex between mb' }, [
    el('div', { class: 'flex', style: 'flex:1;gap:10px' }, [search, statusSel]),
    isAdmin() ? el('button', { class: 'btn primary', text: '+ Novo cliente', onClick: () => openClientForm(null, load) }) : null,
  ]);
  root.appendChild(header);
  root.appendChild(listWrap);

  let timer;
  function debouncedLoad() { clearTimeout(timer); timer = setTimeout(load, 250); }

  async function load() {
    clear(listWrap);
    listWrap.appendChild(el('div', { class: 'muted', text: 'Carregando…' }));
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.status) params.set('status', state.status);
    const clients = await api.get('/clients?' + params.toString());
    store.clients = clients;
    clear(listWrap);
    if (!clients.length) { listWrap.appendChild(el('div', { class: 'empty', text: 'Nenhum cliente encontrado.' })); return; }

    const grid = el('div', { class: 'grid cols-3' });
    for (const c of clients) {
      const s = c.summary;
      grid.appendChild(el('div', { class: 'card', style: 'cursor:pointer', onClick: () => { location.hash = `#/client/${c.id}`; } }, [
        el('div', { class: 'card-body' }, [
          el('div', { class: 'flex between' }, [
            el('div', {}, [
              el('strong', { text: c.trade_name, style: 'font-size:15px' }),
              el('div', { class: 'hint', text: c.segment || c.legal_name || '' }),
            ]),
            badge(LABELS.clientStatus[c.status] || c.status, STATUS_COLOR[c.status]),
          ]),
          el('div', { class: 'flex', style: 'gap:18px;margin-top:14px;flex-wrap:wrap' }, [
            miniStat('👥 Colaboradores', s.collaborators),
            miniStat('💰 Próx. pagamento', s.nextPayment ? fmt.date(s.nextPayment) : '—'),
            miniStat('📋 Próx. rotina', s.nextRoutine ? fmt.date(s.nextRoutine) : '—'),
          ]),
          (s.pending || s.alerts) ? el('div', { class: 'flex', style: 'gap:8px;margin-top:12px' }, [
            s.pending ? badge(`${s.pending} pendências`, 'red') : null,
            s.alerts ? badge(`${s.alerts} alertas`, 'amber') : null,
          ]) : null,
        ]),
      ]));
    }
    listWrap.appendChild(grid);
  }

  await load();
}

function miniStat(label, value) {
  return el('div', {}, [
    el('div', { class: 'hint', text: label }),
    el('strong', { text: String(value) }),
  ]);
}

const CLIENT_FIELDS = [
  ['trade_name', 'Nome fantasia *'], ['legal_name', 'Razão social'], ['cnpj', 'CNPJ'],
  ['state_reg', 'Inscrição estadual'], ['municipal_reg', 'Inscrição municipal'], ['segment', 'Segmento'],
  ['phone', 'Telefone'], ['whatsapp', 'WhatsApp'], ['email', 'E-mail'], ['website', 'Site'],
  ['zip', 'CEP'], ['street', 'Logradouro'], ['number', 'Número'], ['complement', 'Complemento'],
  ['district', 'Bairro'], ['city', 'Cidade'], ['state', 'Estado'],
  ['resp_name', 'Responsável'], ['resp_cpf', 'CPF do responsável'], ['resp_role', 'Cargo do responsável'],
  ['resp_phone', 'Telefone do responsável'], ['resp_email', 'E-mail do responsável'],
  ['start_date', 'Início da consultoria', 'date'], ['end_date', 'Encerramento', 'date'],
];

export function openClientForm(client, onSaved) {
  modal((close) => {
    const form = el('div', { class: 'form-grid' });
    for (const [name, label, type] of CLIENT_FIELDS) {
      form.appendChild(field(label, input(name, client?.[name] ?? '', { type: type || 'text' })));
    }
    form.appendChild(field('Status', select('status', Object.entries(LABELS.clientStatus).map(([value, label]) => ({ value, label })), client?.status || 'ativo')));
    form.appendChild(field('Observações', textarea('notes', client?.notes ?? ''), { full: true }));

    async function save() {
      const data = readForm(form);
      if (!data.trade_name) { toast('Nome fantasia é obrigatório.', 'error'); return; }
      try {
        if (client) await api.put(`/clients/${client.id}`, data);
        else await api.post('/clients', data);
        toast('Cliente salvo.', 'success');
        close(); onSaved && onSaved();
      } catch (e) { toast(e.message, 'error'); }
    }

    return {
      title: client ? 'Editar cliente' : 'Novo cliente',
      size: 'wide',
      body: [form],
      footer: [
        el('button', { class: 'btn', text: 'Cancelar', onClick: close }),
        el('button', { class: 'btn primary', text: 'Salvar', onClick: save }),
      ],
    };
  });
}
