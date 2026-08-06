import { api } from './api.js';
import { el, clear, toast } from './ui.js';
import { store, applyBranding, isAdmin, can, LABELS } from './store.js';
import { renderLogin } from './views/login.js';
import { renderDashboard } from './views/dashboard.js';
import { renderClients } from './views/clients.js';
import { renderClientPanel } from './views/client.js';
import { renderGeneralCalendar } from './views/calendar_general.js';
import { renderReports } from './views/reports.js';
import { renderUsers } from './views/users.js';
import { renderAudit } from './views/audit.js';
import { renderSettings } from './views/settings.js';
import { renderNotifications } from './views/notifications.js';
import { renderVaultGeneral } from './views/vault.js';

const appRoot = document.getElementById('app');

const ROUTES = [
  { path: /^\/dashboard$/, view: renderDashboard, title: 'Painel de Controle', icon: '📊' },
  { path: /^\/clients$/, view: renderClients, title: 'Clientes', icon: '🏢' },
  { path: /^\/client\/(\d+)$/, view: renderClientPanel, title: 'Painel do Cliente' },
  { path: /^\/calendar$/, view: renderGeneralCalendar, title: 'Calendário Geral', icon: '📅' },
  { path: /^\/vault$/, view: renderVaultGeneral, title: 'Cofre de Credenciais', icon: '🔐' },
  { path: /^\/reports$/, view: renderReports, title: 'Relatórios', icon: '📈' },
  { path: /^\/notifications$/, view: renderNotifications, title: 'Notificações', icon: '🔔' },
  { path: /^\/users$/, view: renderUsers, title: 'Usuários e Permissões', icon: '👥' },
  { path: /^\/audit$/, view: renderAudit, title: 'Logs de Auditoria', icon: '🛡️' },
  { path: /^\/settings$/, view: renderSettings, title: 'Configurações', icon: '⚙️' },
];

const NAV = [
  { group: 'Geral', items: [
    { path: '/dashboard', label: 'Painel de Controle', icon: '📊' },
    { path: '/clients', label: 'Clientes', icon: '🏢' },
    { path: '/calendar', label: 'Calendário Geral', icon: '📅' },
    { path: '/vault', label: 'Cofre de Credenciais', icon: '🔐', vault: true },
    { path: '/reports', label: 'Relatórios', icon: '📈', perm: 'view_reports' },
    { path: '/notifications', label: 'Notificações', icon: '🔔' },
  ] },
  { group: 'Administração', adminOnly: true, items: [
    { path: '/users', label: 'Usuários e Permissões', icon: '👥' },
    { path: '/audit', label: 'Logs de Auditoria', icon: '🛡️' },
    { path: '/settings', label: 'Configurações', icon: '⚙️' },
  ] },
];

let vaultVisible = false;

async function boot() {
  try {
    const me = await api.get('/auth/me');
    store.user = me.user;
    applyBranding(me.settings);
    // Does this user have any vault access? (controls nav visibility — §21.4)
    try { const v = await api.get('/vault/status'); vaultVisible = true; void v; }
    catch { vaultVisible = false; }
    startRouter();
  } catch {
    renderLoginScreen();
  }
}

function renderLoginScreen() {
  clear(appRoot);
  renderLogin(appRoot, onLoginSuccess);
}

async function onLoginSuccess(user) {
  store.user = user;
  const me = await api.get('/auth/me');
  applyBranding(me.settings);
  try { await api.get('/vault/status'); vaultVisible = true; } catch { vaultVisible = false; }
  location.hash = '#/dashboard';
  startRouter();
}

function currentPath() {
  const h = location.hash.replace(/^#/, '');
  return h || '/dashboard';
}

function startRouter() {
  window.removeEventListener('hashchange', route);
  window.addEventListener('hashchange', route);
  if (!location.hash) location.hash = '#/dashboard';
  route();
}

function route() {
  const path = currentPath();
  const match = ROUTES.map((r) => ({ r, m: r.path.exec(path) })).find((x) => x.m);
  clear(appRoot);
  const layout = buildLayout();
  appRoot.appendChild(layout.root);

  if (!match) { layout.title.textContent = 'Não encontrado'; layout.content.appendChild(el('div', { class: 'empty', text: 'Página não encontrada.' })); return; }
  layout.title.textContent = match.r.title;
  setActiveNav(layout.nav, path);
  const params = match.m.slice(1);
  Promise.resolve(match.r.view(layout.content, ...params)).catch((e) => {
    if (e.status === 401) return renderLoginScreen();
    layout.content.appendChild(el('div', { class: 'empty', text: 'Erro ao carregar: ' + e.message }));
  });
}

function buildLayout() {
  const s = store.settings;
  const logoContent = s.logo_url
    ? el('img', { src: s.logo_url, alt: 'logo' })
    : (s.system_name && s.system_name !== '[NOME DO SISTEMA]' ? s.system_name.slice(0, 1).toUpperCase() : '🗂️');

  const navEl = el('nav', { class: 'nav' });
  for (const group of NAV) {
    if (group.adminOnly && !isAdmin()) continue;
    navEl.appendChild(el('div', { class: 'group-label', text: group.group }));
    for (const item of group.items) {
      if (item.vault && !vaultVisible) continue;
      if (item.perm && !isAdmin() && !can(item.perm)) continue;
      navEl.appendChild(el('a', { href: '#' + item.path, 'data-path': item.path }, [
        el('span', { class: 'ico', text: item.icon }), item.label,
      ]));
    }
  }

  const sidebar = el('aside', { class: 'sidebar', id: 'sidebar' }, [
    el('div', { class: 'brand' }, [
      el('div', { class: 'logo' }, [logoContent]),
      el('div', {}, [
        el('strong', { text: (s.system_name && s.system_name !== '[NOME DO SISTEMA]') ? s.system_name : 'Sistema de Gestão' }),
        el('div', { class: 'hint', style: 'color:#64748b', text: 'Consultoria' }),
      ]),
    ]),
    navEl,
    el('div', { class: 'user-box' }, [
      el('div', { class: 'name', text: store.user.full_name }),
      el('div', { text: LABELS.roles[store.user.role] || store.user.role }),
      el('button', { class: 'btn sm', text: 'Sair', onClick: logout }),
    ]),
  ]);

  const title = el('h1', { text: '' });
  const content = el('div', { class: 'content' });
  const menuToggle = el('button', { class: 'btn menu-toggle', text: '☰', onClick: () => sidebar.classList.toggle('open') });

  const root = el('div', { class: 'layout' }, [
    sidebar,
    el('div', { class: 'main' }, [
      el('div', { class: 'topbar' }, [menuToggle, title]),
      content,
    ]),
  ]);
  return { root, title, content, nav: navEl };
}

function setActiveNav(navEl, path) {
  navEl.querySelectorAll('a').forEach((a) => {
    const p = a.getAttribute('data-path');
    a.classList.toggle('active', path === p || (p !== '/dashboard' && path.startsWith(p)));
  });
}

async function logout() {
  try { await api.post('/auth/logout', {}); } catch { /* ignore */ }
  store.user = null;
  location.hash = '';
  renderLoginScreen();
}

boot();
