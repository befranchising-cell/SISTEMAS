import { Router } from 'express';
import { allSettings, setSetting } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';

const router = Router();

/* Branding & general settings (§ intro — configurable name/logo/colors). */
router.get('/', (req, res) => {
  res.json(allSettings());
});

const ALLOWED = ['system_name', 'logo_url', 'color_primary', 'color_accent', 'timezone'];

router.put('/', requireRole('admin_geral'), (req, res) => {
  for (const key of ALLOWED) {
    if (req.body[key] !== undefined) setSetting(key, req.body[key]);
  }
  audit(req, { action: 'update', entityType: 'settings' });
  res.json(allSettings());
});

export default router;
