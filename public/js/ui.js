// DOM + formatting helpers shared across views.

/** Hyperscript-ish element builder. */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') node.value = v;
    else if (k === 'checked') node.checked = !!v;
    else node.setAttribute(k, v);
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

/** Escapes text for safe innerHTML interpolation (XSS protection). */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const fmt = {
  money(v) {
    if (v == null || v === '') return '—';
    return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  },
  date(s) {
    if (!s) return '—';
    const d = String(s).slice(0, 10).split('-');
    if (d.length !== 3) return s;
    return `${d[2]}/${d[1]}/${d[0]}`;
  },
  datetime(s) {
    if (!s) return '—';
    const iso = s.includes('T') ? s : s.replace(' ', 'T') + 'Z';
    const d = new Date(iso);
    if (isNaN(d)) return s;
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  },
};

export function toast(message, type = 'info') {
  const root = document.getElementById('toast-root');
  const t = el('div', { class: `toast ${type}`, text: message });
  root.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 200); }, 3200);
}

/**
 * Opens a modal. `build(close)` returns { title, body, footer, size }.
 * Returns a close() function.
 */
export function modal(build) {
  const root = document.getElementById('modal-root');
  const backdrop = el('div', { class: 'modal-backdrop' });
  function close() { backdrop.remove(); document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key === 'Escape') close(); }
  const cfg = build(close);
  const box = el('div', { class: `modal ${cfg.size || ''}` }, [
    el('div', { class: 'modal-head' }, [
      el('h3', { text: cfg.title }),
      el('button', { class: 'close-x', text: '×', onClick: close }),
    ]),
    el('div', { class: 'modal-body' }, cfg.body),
    cfg.footer ? el('div', { class: 'modal-foot' }, cfg.footer) : null,
  ]);
  backdrop.appendChild(box);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop && cfg.dismissable !== false) close(); });
  document.addEventListener('keydown', onKey);
  root.appendChild(backdrop);
  return close;
}

export function confirmDialog(message, { danger = true, confirmLabel = 'Confirmar' } = {}) {
  return new Promise((resolve) => {
    modal((close) => ({
      title: 'Confirmação',
      size: 'narrow',
      body: [el('p', { text: message })],
      footer: [
        el('button', { class: 'btn', text: 'Cancelar', onClick: () => { close(); resolve(false); } }),
        el('button', { class: `btn ${danger ? 'danger' : 'primary'}`, text: confirmLabel, onClick: () => { close(); resolve(true); } }),
      ],
    }));
  });
}

/** Builds a labelled form field. Returns the wrapper; access value via input. */
export function field(label, input, { full = false, hint = null } = {}) {
  return el('div', { class: `field ${full ? 'full' : ''}` }, [
    label ? el('label', { text: label }) : null,
    input,
    hint ? el('div', { class: 'hint', text: hint }) : null,
  ]);
}

export function input(name, value = '', attrs = {}) {
  return el('input', { name, value: value ?? '', ...attrs });
}
export function select(name, options, value) {
  const s = el('select', { name });
  for (const o of options) {
    const opt = el('option', { value: o.value, text: o.label });
    if (String(o.value) === String(value)) opt.selected = true;
    s.appendChild(opt);
  }
  return s;
}
export function textarea(name, value = '', attrs = {}) {
  return el('textarea', { name, ...attrs }, value ?? '');
}

/** Reads all named inputs within a container into an object. */
export function readForm(container) {
  const out = {};
  container.querySelectorAll('[name]').forEach((n) => {
    if (n.type === 'checkbox') out[n.name] = n.checked;
    else out[n.name] = n.value === '' ? null : n.value;
  });
  return out;
}

export function badge(text, color = 'gray') { return el('span', { class: `badge ${color}`, text }); }
