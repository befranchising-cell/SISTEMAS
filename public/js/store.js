// Shared client-side state + reference label maps.
export const store = {
  user: null,
  settings: {},
  clients: [],       // cache of accessible clients (for selects)
};

export function isAdmin() { return store.user?.role === 'admin_geral'; }
export function can(perm) {
  if (isAdmin()) return true;
  const p = store.user?.permissions || {};
  if (p[perm] != null) return !!p[perm];
  const defaults = {
    consultor: { manage_collaborators: true, manage_payments: true, manage_routines: true, view_reports: true },
    cliente: { approve_payments: true, complete_routines: true },
    operacional: { complete_routines: true },
  };
  return !!defaults[store.user?.role]?.[perm];
}

export function applyBranding(s) {
  store.settings = s || {};
  if (s?.color_primary) document.documentElement.style.setProperty('--primary', s.color_primary);
  if (s?.color_accent) document.documentElement.style.setProperty('--accent', s.color_accent);
  document.title = (s?.system_name && s.system_name !== '[NOME DO SISTEMA]') ? s.system_name : 'Sistema de Gestão de Consultoria';
}

export const LABELS = {
  clientStatus: { ativo: 'Ativo', inativo: 'Inativo', suspenso: 'Suspenso', encerrado: 'Encerrado' },
  profStatus: { ativo: 'Ativo', afastado: 'Afastado', ferias: 'Férias', inativo: 'Inativo', encerrado: 'Encerrado' },
  payStatus: {
    programado: 'Programado', aguardando_documento: 'Aguardando documento', aguardando_nota: 'Aguardando nota fiscal',
    aguardando_aprovacao: 'Aguardando aprovação', aprovado: 'Aprovado', pago: 'Pago', pago_parcial: 'Pago parcialmente',
    atrasado: 'Atrasado', cancelado: 'Cancelado',
  },
  contract: {
    clt: 'CLT', mei_parceiro: 'MEI — Parceiro de Salão', freelancer: 'Freelancer',
    mei_colab: 'MEI — Colaborador', prestador_ind: 'Prestador de Serviço Individual', empresa_prestadora: 'Empresa Prestadora',
  },
  payModel: { fixa: 'Fixa', hora: 'Por hora', diaria: 'Por diária', comissao: 'Comissão', misto: 'Misto' },
  frequency: { weekly: 'Semanal', biweekly: 'Quinzenal', monthly: 'Mensal', specific: 'Datas específicas', custom: 'Personalizada', daily: 'Diária', pontual: 'Pontual' },
  importance: { normal: 'Normal', importante: 'Importante', critico: 'Crítico' },
  credStatus: { ativo: 'Ativo', inativo: 'Inativo', bloqueado: 'Bloqueado', em_revisao: 'Em revisão' },
  occStatus: { pendente: 'Pendente', concluida: 'Concluída', atrasada: 'Atrasada', cancelada: 'Cancelada' },
  roles: { admin_geral: 'Administrador Geral', consultor: 'Consultor', cliente: 'Cliente', operacional: 'Operacional' },
};

export const STATUS_COLOR = {
  ativo: 'green', pago: 'green', concluida: 'green', aprovado: 'blue', programado: 'blue', pendente: 'blue',
  atrasado: 'red', atrasada: 'red', bloqueado: 'red', cancelado: 'gray', cancelada: 'gray', encerrado: 'gray',
  inativo: 'gray', suspenso: 'amber', afastado: 'amber', ferias: 'amber', em_revisao: 'amber', pago_parcial: 'amber',
  aguardando_aprovacao: 'amber', aguardando_documento: 'amber', aguardando_nota: 'amber',
  critico: 'red', importante: 'amber', normal: 'gray',
};
