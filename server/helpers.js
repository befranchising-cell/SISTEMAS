import { maskValue } from './crypto.js';
import { hasPermission, isAdmin } from './auth.js';

/** Parses a JSON column safely. */
export function parseJSON(str, fallback = null) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

/**
 * Returns a display-safe copy of a bank account. Full CPF/CNPJ, account and PIX
 * are masked unless the requesting user is allowed to see full bank data
 * (§6, §26). Full values require the `view_bank_full` permission.
 */
export function maskBank(bank, user) {
  if (!bank) return bank;
  const full = isAdmin(user) || hasPermission(user, 'view_bank_full');
  if (full) return { ...bank, _full: true };
  return {
    ...bank,
    holder_doc: maskValue(bank.holder_doc),
    account: maskValue(bank.account, 2),
    pix_key: maskValue(bank.pix_key, 3),
    _full: false,
  };
}

/** Masks CPF on a collaborator for list/detail views by non-privileged users. */
export function maskCollaborator(collab, user) {
  const full = isAdmin(user) || hasPermission(user, 'view_bank_full');
  if (full) return collab;
  return { ...collab, cpf: maskValue(collab.cpf) };
}

/** Small helper to coerce truthy checkbox-ish values to 0/1. */
export function bool(v) {
  return v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
}

/** Extracts a whitelisted subset of body fields. */
export function pick(body, fields) {
  const out = {};
  for (const f of fields) if (body[f] !== undefined) out[f] = body[f];
  return out;
}
