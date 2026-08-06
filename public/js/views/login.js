import { api } from '../api.js';
import { el, toast } from '../ui.js';

export function renderLogin(root, onSuccess) {
  let show2fa = false;

  const emailInput = el('input', { type: 'email', placeholder: 'seu@email.com', value: 'admin@demo.local' });
  const passInput = el('input', { type: 'password', placeholder: '••••••••', value: '' });
  const codeInput = el('input', { type: 'text', placeholder: '000000', inputmode: 'numeric', maxlength: '6' });
  const codeField = el('div', { class: 'field', style: 'display:none' }, [
    el('label', { text: 'Código de verificação (2FA)' }), codeInput,
  ]);
  const msg = el('div', { class: 'hint', style: 'color:var(--danger);min-height:18px' });
  const btn = el('button', { class: 'btn primary', text: 'Entrar', style: 'width:100%', type: 'submit' });

  async function submit(e) {
    e.preventDefault();
    msg.textContent = '';
    btn.disabled = true; btn.textContent = 'Entrando…';
    try {
      const body = { email: emailInput.value.trim(), password: passInput.value };
      if (show2fa) body.twoFactorCode = codeInput.value.trim();
      const res = await api.post('/auth/login', body);
      toast('Bem-vindo, ' + res.user.full_name, 'success');
      onSuccess(res.user);
    } catch (err) {
      if (err.data?.require2fa) {
        show2fa = true;
        codeField.style.display = 'block';
        msg.textContent = 'Informe o código de verificação. (demo: 000000)';
        codeInput.focus();
      } else {
        msg.textContent = err.message;
      }
    } finally {
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  }

  const form = el('form', { onSubmit: submit }, [
    el('div', { class: 'field' }, [el('label', { text: 'E-mail' }), emailInput]),
    el('div', { class: 'field' }, [el('label', { text: 'Senha' }), passInput]),
    codeField,
    msg,
    btn,
    el('div', { style: 'text-align:center;margin-top:12px' }, [
      el('a', { href: '#', text: 'Esqueci minha senha', onClick: (e) => { e.preventDefault(); recover(emailInput.value); } }),
    ]),
  ]);

  const card = el('div', { class: 'auth-card' }, [
    el('div', { class: 'logo-big', text: '🗂️' }),
    el('h2', { text: 'Acesso ao Sistema' }),
    el('p', { class: 'muted', text: 'Gestão de clientes, colaboradores, pagamentos e cofre de credenciais.' }),
    form,
    el('div', { class: 'demo-hint', html:
      '<strong>Usuários de demonstração</strong><br>'
      + 'Admin: admin@demo.local / admin123 (2FA: 000000)<br>'
      + 'Consultor: consultor@demo.local / consultor123<br>'
      + 'Cliente: cliente@demo.local / cliente123<br>'
      + 'Operacional: operacional@demo.local / operacional123' }),
  ]);
  root.appendChild(el('div', { class: 'auth-wrap' }, [card]));
}

async function recover(email) {
  try {
    const r = await api.post('/auth/recover', { email });
    toast(r.message || 'Instruções enviadas.', 'success');
  } catch { toast('Não foi possível processar.', 'error'); }
}
