import { api } from '../api.js';
import { el, toast, field, input, readForm } from '../ui.js';
import { applyBranding } from '../store.js';

export async function renderSettings(root) {
  const s = await api.get('/settings');
  const form = el('div', { class: 'form-grid' }, [
    field('Nome do sistema', input('system_name', s.system_name), { hint: 'Substitui o nome provisório [NOME DO SISTEMA] em todo o sistema.' }),
    field('URL do logotipo', input('logo_url', s.logo_url), { hint: 'Deixe em branco para usar a inicial do nome.' }),
    field('Cor primária', input('color_primary', s.color_primary, { type: 'color' })),
    field('Cor de destaque', input('color_accent', s.color_accent, { type: 'color' })),
    field('Fuso horário', input('timezone', s.timezone)),
  ]);

  const preview = el('div', { class: 'card mt', style: 'padding:20px;display:flex;align-items:center;gap:12px' });
  function drawPreview() {
    const data = readForm(form);
    preview.style.borderLeft = `6px solid ${data.color_primary}`;
    preview.replaceChildren(
      el('div', { style: `width:40px;height:40px;border-radius:10px;background:${data.color_primary};color:#fff;display:grid;place-items:center;font-weight:700`, text: (data.system_name || 'S').slice(0, 1).toUpperCase() }),
      el('strong', { text: data.system_name || 'Sistema' }),
    );
  }
  form.addEventListener('input', drawPreview);

  root.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [el('h3', { text: 'Identidade visual e configurações gerais' })]),
    el('div', { class: 'card-body' }, [
      form, preview,
      el('button', { class: 'btn primary mt', text: 'Salvar configurações', onClick: async () => {
        try { const updated = await api.put('/settings', readForm(form)); applyBranding(updated); toast('Configurações salvas.', 'success'); }
        catch (e) { toast(e.message, 'error'); }
      } }),
    ]),
  ]));
  drawPreview();
}
