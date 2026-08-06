import { api } from '../api.js';
import { el, clear, toast } from '../ui.js';
import { isAdmin } from '../store.js';

const REPORTS = [
  { kind: 'collaborators_by_client', label: 'Colaboradores por cliente' },
  { kind: 'collaborators_by_contract', label: 'Colaboradores por forma de contratação' },
  { kind: 'payments_late', label: 'Pagamentos atrasados' },
  { kind: 'payments_planned_vs_paid', label: 'Previsto x Pago por cliente' },
  { kind: 'routines_late', label: 'Rotinas atrasadas' },
  { kind: 'bank_incomplete', label: 'Dados bancários incompletos' },
];
const VAULT_REPORTS = [
  { kind: 'by_client', label: 'Credenciais por cliente' },
  { kind: 'by_category', label: 'Credenciais por categoria' },
  { kind: 'pw_change_due', label: 'Credenciais próximas da troca' },
  { kind: 'no_responsible', label: 'Credenciais sem responsável' },
  { kind: 'critical', label: 'Credenciais críticas' },
];

export async function renderReports(root) {
  const out = el('div', { class: 'mt' });

  const buttons = el('div', { class: 'btn-row mb' }, REPORTS.map((r) =>
    el('button', { class: 'btn', text: r.label, onClick: () => run('/reports/' + r.kind, r.label) })));
  root.appendChild(el('div', { class: 'card' }, [el('div', { class: 'card-head' }, [el('h3', { text: 'Relatórios gerais' })]), el('div', { class: 'card-body' }, [buttons])]));

  // Vault reports (admins / authorised only — server enforces).
  const vaultButtons = el('div', { class: 'btn-row mb' }, VAULT_REPORTS.map((r) =>
    el('button', { class: 'btn', text: r.label, onClick: () => run('/reports/vault/' + r.kind, r.label) })));
  root.appendChild(el('div', { class: 'card mt' }, [
    el('div', { class: 'card-head' }, [el('h3', { text: 'Relatórios do Cofre (administrativos)' })]),
    el('div', { class: 'card-body' }, [el('p', { class: 'hint', text: 'Relatórios do Cofre nunca expõem senhas, PINs ou códigos secretos.' }), vaultButtons]),
  ]));

  root.appendChild(out);

  async function run(path, label) {
    clear(out); out.appendChild(el('div', { class: 'muted', text: 'Gerando…' }));
    let res;
    try { res = await api.get(path); } catch (e) { clear(out); out.appendChild(el('div', { class: 'empty', text: e.message })); return; }
    clear(out);
    if (!res.rows.length) { out.appendChild(el('div', { class: 'empty', text: 'Sem dados para este relatório.' })); return; }
    const cols = Object.keys(res.rows[0]);
    const table = el('table', { class: 'data' }, [
      el('thead', {}, el('tr', {}, cols.map((c) => el('th', { text: c.replace(/_/g, ' ') })))),
      el('tbody', {}, res.rows.map((r) => el('tr', {}, cols.map((c) => el('td', { text: r[c] == null ? '—' : String(r[c]) }))))),
    ]);
    out.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h3', { text: label }), el('div', { class: 'spacer' }), el('button', { class: 'btn sm', text: '⬇ Exportar CSV', onClick: () => exportCsv(cols, res.rows, label) })]),
      el('div', { class: 'card-body' }, [el('div', { class: 'table-wrap' }, [table])]),
    ]));
  }

  function exportCsv(cols, rows, label) {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `${label}.csv` });
    document.body.appendChild(a); a.click(); a.remove();
    toast('CSV exportado.', 'success');
  }
}
