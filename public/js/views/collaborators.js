import { api } from '../api.js';
import { el, clear, fmt, toast, modal, field, input, select, textarea, readForm, badge, confirmDialog } from '../ui.js';
import { can, isAdmin, LABELS, STATUS_COLOR } from '../store.js';

export function renderCollaborators(container, clientId, units) {
  const wrap = el('div', {});
  const header = el('div', { class: 'flex between mb' }, [
    el('h3', { text: 'Colaboradores', style: 'margin:0' }),
    can('manage_collaborators') ? el('button', { class: 'btn primary', text: '+ Novo colaborador', onClick: () => openForm(null) }) : null,
  ]);
  container.appendChild(header);
  container.appendChild(wrap);

  async function load() {
    clear(wrap);
    const rows = await api.get('/collaborators?client_id=' + clientId);
    if (!rows.length) { wrap.appendChild(el('div', { class: 'empty', text: 'Nenhum colaborador cadastrado.' })); return; }
    const table = el('table', { class: 'data' }, [
      el('thead', {}, el('tr', {}, ['Nome', 'Cargo', 'Contratação', 'Remuneração', 'Status', ''].map((h) => el('th', { text: h })))),
      el('tbody', {}, rows.map((c) => el('tr', {}, [
        el('td', {}, [el('strong', { text: c.full_name }), el('div', { class: 'hint', text: c.cpf || '' })]),
        el('td', { text: c.role_title || '—' }),
        el('td', { text: LABELS.contract[c.contract_type] || '—' }),
        el('td', { text: c.pay_amount != null ? fmt.money(c.pay_amount) : '—' }),
        el('td', {}, [badge(LABELS.profStatus[c.prof_status] || c.prof_status, STATUS_COLOR[c.prof_status])]),
        el('td', { class: 'right' }, [el('button', { class: 'btn sm', text: 'Ver', onClick: () => openDetail(c.id) })]),
      ]))),
    ]);
    wrap.appendChild(el('div', { class: 'table-wrap card' }, [table]));
  }

  const unitOptions = [{ value: '', label: '— Sem unidade —' }, ...units.map((u) => ({ value: u.id, label: u.name }))];

  function openForm(collab) {
    modal((close) => {
      const personal = el('div', { class: 'form-grid' }, [
        field('Nome completo *', input('full_name', collab?.full_name)),
        field('Nome social', input('social_name', collab?.social_name)),
        field('CPF', input('cpf', collab?.cpf)),
        field('RG', input('rg', collab?.rg)),
        field('Data de nascimento', input('birth_date', collab?.birth_date, { type: 'date' })),
        field('Telefone', input('phone', collab?.phone)),
        field('WhatsApp', input('whatsapp', collab?.whatsapp)),
        field('E-mail', input('email', collab?.email, { type: 'email' })),
        field('Cidade', input('city', collab?.city)),
        field('Estado', input('state', collab?.state)),
        field('Contato de emergência', input('emergency_name', collab?.emergency_name)),
        field('Telefone de emergência', input('emergency_phone', collab?.emergency_phone)),
      ]);
      const professional = el('div', { class: 'form-grid' }, [
        field('Unidade', select('unit_id', unitOptions, collab?.unit_id)),
        field('Cargo / função', input('role_title', collab?.role_title)),
        field('Setor', input('sector', collab?.sector)),
        field('Gestor responsável', input('manager', collab?.manager)),
        field('Início', input('prof_start', collab?.prof_start, { type: 'date' })),
        field('Encerramento', input('prof_end', collab?.prof_end, { type: 'date' })),
        field('Status', select('prof_status', Object.entries(LABELS.profStatus).map(([value, label]) => ({ value, label })), collab?.prof_status || 'ativo')),
        field('Jornada / horário', input('schedule', collab?.schedule)),
        field('Valor da remuneração', input('pay_amount', collab?.pay_amount, { type: 'number', step: '0.01' })),
        field('Forma de remuneração', select('pay_model', Object.entries(LABELS.payModel).map(([value, label]) => ({ value, label })), collab?.pay_model)),
        field('Forma de contratação', select('contract_type', Object.entries(LABELS.contract).map(([value, label]) => ({ value, label })), collab?.contract_type)),
      ]);
      const container2 = el('div', {}, [
        el('h4', { text: 'Dados pessoais' }), personal,
        el('h4', { text: 'Dados profissionais' }), professional,
      ]);

      async function save() {
        const data = { ...readForm(personal), ...readForm(professional), client_id: clientId };
        if (!data.full_name) { toast('Nome é obrigatório.', 'error'); return; }
        try {
          if (collab) await api.put(`/collaborators/${collab.id}`, data);
          else await api.post('/collaborators', data);
          toast('Colaborador salvo.', 'success'); close(); load();
        } catch (e) { toast(e.message, 'error'); }
      }
      return {
        title: collab ? 'Editar colaborador' : 'Novo colaborador', size: 'wide',
        body: [container2],
        footer: [el('button', { class: 'btn', text: 'Cancelar', onClick: close }), el('button', { class: 'btn primary', text: 'Salvar', onClick: save })],
      };
    });
  }

  async function openDetail(id) {
    const c = await api.get('/collaborators/' + id);
    modal((close) => {
      const info = el('div', {});
      const tabs = ['Dados', 'Contratação', 'Dados bancários'];
      let active = 0;
      const tabBar = el('div', { class: 'tabs' });
      const body = el('div', {});
      function drawTab() {
        clear(body);
        if (active === 0) {
          body.appendChild(kvGrid([
            ['Nome', c.full_name], ['CPF', c.cpf], ['Nascimento', fmt.date(c.birth_date)],
            ['Telefone', c.phone], ['E-mail', c.email], ['Cidade', `${c.city || ''}/${c.state || ''}`],
            ['Cargo', c.role_title], ['Setor', c.sector], ['Status', LABELS.profStatus[c.prof_status]],
            ['Emergência', `${c.emergency_name || '—'} ${c.emergency_phone || ''}`],
          ]));
        } else if (active === 1) {
          const cd = c.contract_data || {};
          const rows = [['Forma', LABELS.contract[c.contract_type] || '—'], ['Remuneração', c.pay_amount != null ? fmt.money(c.pay_amount) : '—'], ['Modelo', LABELS.payModel[c.pay_model] || '—']];
          for (const [k, v] of Object.entries(cd)) rows.push([k, typeof v === 'boolean' ? (v ? 'Sim' : 'Não') : v]);
          body.appendChild(kvGrid(rows));
        } else {
          drawBank(body, c, close);
        }
      }
      tabs.forEach((t, i) => tabBar.appendChild(el('button', { class: i === 0 ? 'active' : '', text: t, onClick: (e) => { active = i; tabBar.querySelectorAll('button').forEach((b) => b.classList.remove('active')); e.target.classList.add('active'); drawTab(); } })));
      info.appendChild(tabBar); info.appendChild(body); drawTab();

      return {
        title: c.full_name, size: 'wide', body: [info],
        footer: [
          can('manage_collaborators') ? el('button', { class: 'btn danger', text: 'Excluir', onClick: async () => { if (await confirmDialog('Excluir este colaborador?')) { await api.del('/collaborators/' + id); toast('Excluído.', 'success'); close(); load(); } } }) : null,
          can('manage_collaborators') ? el('button', { class: 'btn', text: 'Editar', onClick: () => { close(); openForm(c); } }) : null,
          el('button', { class: 'btn primary', text: 'Fechar', onClick: close }),
        ],
      };
    });
  }

  function drawBank(body, c, closeParent) {
    const bank = c.bank;
    if (!bank) { body.appendChild(el('div', { class: 'empty', text: 'Sem dados bancários. ' })); }
    else {
      const grid = kvGrid([
        ['Titular', bank.holder_name], ['CPF/CNPJ', bank.holder_doc], ['Banco', `${bank.bank_name || ''} ${bank.bank_code ? '(' + bank.bank_code + ')' : ''}`],
        ['Agência', bank.agency], ['Conta', `${bank.account || ''}${bank.account_digit ? '-' + bank.account_digit : ''}`],
        ['Tipo', bank.account_type], ['Chave PIX', bank.pix_key], ['Tipo PIX', bank.pix_type],
        ['Forma preferencial', bank.preferred_method], ['Última validação', fmt.date(bank.last_validated_at)],
      ]);
      body.appendChild(grid);
      if (!bank._full) {
        body.appendChild(el('div', { class: 'hint mt', text: 'Dados sensíveis mascarados. ' }));
        if (can('view_bank_full') || isAdmin()) {
          body.appendChild(el('button', { class: 'btn sm mt', text: '👁 Ver dados completos', onClick: async () => {
            try { const full = await api.get(`/collaborators/${c.id}/bank/full`); c.bank = full; clear(body); drawBank(body, c, closeParent); toast('Acesso registrado no log de auditoria.', 'info'); }
            catch (e) { toast(e.message, 'error'); }
          } }));
        }
      }
    }
    if (can('manage_collaborators')) {
      body.appendChild(el('button', { class: 'btn primary mt', text: bank ? 'Editar dados bancários' : 'Cadastrar dados bancários', onClick: () => openBankForm(c, closeParent) }));
    }
  }

  function openBankForm(c, closeParent) {
    closeParent();
    const b = c.bank || {};
    modal((close) => {
      const form = el('div', { class: 'form-grid' }, [
        field('Nome do titular', input('holder_name', b.holder_name)),
        field('CPF/CNPJ do titular', input('holder_doc', b._full ? b.holder_doc : '')),
        field('Banco', input('bank_name', b.bank_name)),
        field('Código do banco', input('bank_code', b.bank_code)),
        field('Agência', input('agency', b.agency)),
        field('Conta', input('account', b._full ? b.account : '')),
        field('Dígito', input('account_digit', b.account_digit)),
        field('Tipo de conta', select('account_type', [['corrente', 'Corrente'], ['poupanca', 'Poupança'], ['pagamento', 'Pagamento'], ['juridica', 'Jurídica']].map(([value, label]) => ({ value, label })), b.account_type)),
        field('Chave PIX', input('pix_key', b._full ? b.pix_key : '')),
        field('Tipo de chave PIX', select('pix_type', [['', '—'], ['cpf', 'CPF'], ['cnpj', 'CNPJ'], ['telefone', 'Telefone'], ['email', 'E-mail'], ['aleatoria', 'Aleatória']].map(([value, label]) => ({ value, label })), b.pix_type)),
        field('Forma preferencial', select('preferred_method', [['pix', 'PIX'], ['transferencia', 'Transferência'], ['boleto', 'Boleto'], ['dinheiro', 'Dinheiro'], ['outro', 'Outro']].map(([value, label]) => ({ value, label })), b.preferred_method)),
      ]);
      async function save() {
        try { await api.put(`/collaborators/${c.id}/bank`, readForm(form)); toast('Dados bancários salvos (ação auditada).', 'success'); close(); load(); }
        catch (e) { toast(e.message, 'error'); }
      }
      return {
        title: 'Dados bancários', size: 'wide',
        body: [b.holder_doc && !b._full ? el('div', { class: 'hint mb', text: 'Deixe campos mascarados em branco para mantê-los.' }) : null, form],
        footer: [el('button', { class: 'btn', text: 'Cancelar', onClick: close }), el('button', { class: 'btn primary', text: 'Salvar', onClick: save })],
      };
    });
  }

  load();
}

function kvGrid(rows) {
  return el('div', { class: 'form-grid' }, rows.filter((r) => r[1] != null && r[1] !== '').map(([k, v]) =>
    el('div', { class: 'field' }, [el('label', { text: k }), el('div', { text: String(v) })])));
}
