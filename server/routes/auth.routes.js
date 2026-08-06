import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import db from '../db.js';
import { config } from '../config.js';
import { verifyPassword } from '../crypto.js';
import { issueToken, loadUserContext, requireAuth } from '../auth.js';
import { audit } from '../audit.js';
import { allSettings } from '../db.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: config.loginLockoutMinutes * 60 * 1000,
  max: 30,
  message: { error: 'Muitas tentativas de login. Aguarde alguns minutos.' },
});

function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.nodeEnv === 'production',
    maxAge: config.sessionTtlMinutes * 60 * 1000,
  };
}

/* POST /api/auth/login — password auth with brute-force lockout (§26, §32). */
router.post('/login', loginLimiter, (req, res) => {
  const { email, password, twoFactorCode } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Informe e-mail e senha.' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase());
  const genericError = { error: 'Credenciais inválidas.' };

  if (!user) return res.status(401).json(genericError);

  if (user.locked_until && user.locked_until > new Date().toISOString()) {
    return res.status(423).json({ error: 'Conta temporariamente bloqueada. Tente mais tarde.' });
  }
  if (user.status !== 'ativo') return res.status(403).json({ error: 'Usuário inativo ou bloqueado.' });

  if (!verifyPassword(password, user.password_hash)) {
    const failed = user.failed_logins + 1;
    let lockedUntil = null;
    if (failed >= config.loginMaxAttempts) {
      lockedUntil = new Date(Date.now() + config.loginLockoutMinutes * 60 * 1000).toISOString();
    }
    db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?')
      .run(failed, lockedUntil, user.id);
    return res.status(401).json(genericError);
  }

  // 2FA (demonstration): when enabled, require a code. Accepts the demo code
  // 000000 to keep the flow illustrative without external providers.
  if (user.two_factor_enabled) {
    if (!twoFactorCode) return res.status(401).json({ error: 'Código de verificação obrigatório.', require2fa: true });
    if (String(twoFactorCode) !== '000000') {
      return res.status(401).json({ error: 'Código de verificação inválido.', require2fa: true });
    }
  }

  db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = datetime(\'now\') WHERE id = ?')
    .run(user.id);

  const ctx = loadUserContext(user.id);
  const token = issueToken({ id: ctx.id, role_key: ctx.role_key });
  res.cookie('token', token, cookieOpts());
  audit({ user: ctx, ip: req.ip, get: (h) => req.get(h) }, { action: 'login', entityType: 'user', entityId: ctx.id });
  res.json({ user: publicUser(ctx) });
});

router.post('/logout', requireAuth, (req, res) => {
  audit(req, { action: 'logout', entityType: 'user', entityId: req.user.id });
  res.clearCookie('token');
  res.json({ ok: true });
});

/* GET /api/auth/me — current session + system branding. */
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user), settings: brandingSettings() });
});

/* Password recovery (demonstration stub — no email delivery configured). */
router.post('/recover', loginLimiter, (req, res) => {
  // Always respond success to avoid leaking which e-mails exist (§26).
  res.json({ ok: true, message: 'Se o e-mail existir, enviaremos instruções de recuperação.' });
});

function brandingSettings() {
  const s = allSettings();
  return {
    system_name: s.system_name,
    logo_url: s.logo_url,
    color_primary: s.color_primary,
    color_accent: s.color_accent,
    timezone: s.timezone,
  };
}

function publicUser(u) {
  return {
    id: u.id,
    full_name: u.full_name,
    email: u.email,
    role: u.role_key,
    role_name: u.role_name,
    permissions: u.permissions,
    clientIds: u.clientIds,
    two_factor_enabled: !!u.two_factor_enabled,
  };
}

export default router;
