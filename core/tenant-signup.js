// core/tenant-signup.js — servicio de alta validado (patrón createClientSvc).
//
// Única vía de alta usada por la ruta de registro: valida el esquema, comprueba la
// unicidad del email entre TODOS los negocios y delega en provisionTenant. provisionTenant
// vuelve a validar (defensa en profundidad). Resuelve los defectos C, D, E, H del audit.

import { getTenantByEmail } from './control-db.js';
import { provisionTenant } from './tenant-provisioning.js';
import { parseSignup } from './signup-schema.js';

// ¿El email ya pertenece a algún negocio existente (cualquier tenant activo)? (defecto D)
// Reutiliza getTenantByEmail, que recorre los tenants y mira sus admin_users activos.
export function emailTaken(email) {
  if (!email) return false;
  return !!getTenantByEmail(String(email).trim().toLowerCase());
}

// Valida el BORRADOR (sin contraseña) + unicidad de email. Lo usa la conversación para
// decidir si ya puede ofrecer el botón de crear. Lanza Error { status, field }.
export function validateSignupDraft(input) {
  const d = parseSignup(input, { draft: true });
  if (emailTaken(d.email)) {
    const e = new Error('Ya existe una cuenta con ese email. ¿Quieres usar otro?');
    e.status = 409; e.field = 'email'; throw e;
  }
  return d;
}

// Servicio de alta: valida TODO (incl. contraseña ≥ 8), revalida la unicidad del email
// (no se confía en lo que quedó pendiente) y crea el negocio. Devuelve { tenant, slug }.
export async function createTenantSvc(input) {
  const d = parseSignup(input, { draft: false });
  if (emailTaken(d.email)) {
    const e = new Error('Ya existe una cuenta con ese email. ¿Quieres usar otro?');
    e.status = 409; e.field = 'email'; throw e;
  }
  return await provisionTenant(d);
}
