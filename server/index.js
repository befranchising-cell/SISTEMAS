import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { config, ROOT } from './config.js';
import { requireAuth } from './auth.js';

import authRoutes from './routes/auth.routes.js';
import clientsRoutes from './routes/clients.routes.js';
import collaboratorsRoutes from './routes/collaborators.routes.js';
import paymentsRoutes from './routes/payments.routes.js';
import routinesRoutes from './routes/routines.routes.js';
import calendarRoutes from './routes/calendar.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import notificationsRoutes from './routes/notifications.routes.js';
import usersRoutes from './routes/users.routes.js';
import auditRoutes from './routes/audit.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import reportsRoutes from './routes/reports.routes.js';
import vaultRoutes from './routes/vault.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);

/* Security headers (§32). CSP kept simple for the self-contained SPA. */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

/* Global rate limit (§22, §32 — brute-force / automated-access protection). */
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em instantes.' },
}));

/* Public auth endpoints. */
app.use('/api/auth', authRoutes);

/* Everything below requires an authenticated session. */
app.use('/api/clients', requireAuth, clientsRoutes);
app.use('/api/collaborators', requireAuth, collaboratorsRoutes);
app.use('/api/payments', requireAuth, paymentsRoutes);
app.use('/api/routines', requireAuth, routinesRoutes);
app.use('/api/calendar', requireAuth, calendarRoutes);
app.use('/api/dashboard', requireAuth, dashboardRoutes);
app.use('/api/notifications', requireAuth, notificationsRoutes);
app.use('/api/users', requireAuth, usersRoutes);
app.use('/api/audit', requireAuth, auditRoutes);
app.use('/api/settings', requireAuth, settingsRoutes);
app.use('/api/reports', requireAuth, reportsRoutes);
app.use('/api/vault', requireAuth, vaultRoutes);

/* Static SPA. */
const publicDir = path.join(ROOT, 'public');
app.use(express.static(publicDir));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

/* JSON error handler — never leak internals (§20: no secrets in errors). */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[erro]', err.message);
  res.status(err.status || 500).json({ error: err.publicMessage || 'Erro interno.' });
});

app.listen(config.port, () => {
  const dbFile = path.join(ROOT, 'data', 'app.db');
  if (!fs.existsSync(dbFile)) console.warn('Aviso: banco não encontrado. Rode `npm run seed`.');
  console.log(`Servidor em http://localhost:${config.port}`);
});
