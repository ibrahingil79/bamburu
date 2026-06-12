// core/signup-schema.js — esquema de validación del alta de un negocio (onboarding).
//
// Fuente única de validación del alta, en el mismo espíritu que clientSchema (T1/T5):
// nadie crea un tenant con datos sin validar. Lo usan el servicio de alta
// (core/tenant-signup.js), la conversación de onboarding y provisionTenant
// (defensa en profundidad). Sin dependencias de BD para evitar ciclos de import.

import { z } from 'zod';
import { str, strOpt, email as emailField } from './validate.js';

export const COUNTRY_DEFAULT = 'ES';

// Datos del alta SIN contraseña: lo que recoge la conversación de DISA.
export const signupDraftSchema = z.object({
  businessName: str(120),
  sector: strOpt(80),                                  // opcional; materia prima de DISA (defecto F)
  ownerName: str(120),
  email: emailField,                                   // formato válido obligatorio (defecto D)
  country: z.enum(['ES', 'MX', 'CO']).catch(COUNTRY_DEFAULT),  // valor desconocido → ES (España por defecto)
  phone: strOpt(40),
});

// Alta COMPLETA: borrador + contraseña (mínimo 8). Se valida al crear (defecto E).
export const signupSchema = signupDraftSchema.extend({
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.').max(200),
});

// Mensajes claros y orientados a re-preguntar el dato exacto (defecto H).
function friendly(field, fallback) {
  const map = {
    businessName: 'Necesito el nombre del negocio.',
    ownerName: 'Necesito saber tu nombre (el del propietario).',
    email: 'Ese email no parece válido. ¿Me das uno correcto?',
    password: 'La contraseña debe tener al menos 8 caracteres.',
  };
  return map[field] || fallback || 'Hay un dato del alta que no es válido.';
}

// Parsea y normaliza. Lanza Error con { status:400, field, issues } y un mensaje claro
// si algún dato no es válido. `draft:true` valida sin contraseña.
export function parseSignup(input, { draft = false } = {}) {
  const schema = draft ? signupDraftSchema : signupSchema;
  const res = schema.safeParse(input || {});
  if (!res.success) {
    const issue = res.error.issues[0];
    const field = issue?.path?.[0] ?? null;
    const e = new Error(friendly(field, issue?.message));
    e.status = 400; e.field = field; e.issues = res.error.issues;
    throw e;
  }
  const d = res.data;
  d.email = d.email.toLowerCase();
  if (d.sector === undefined) d.sector = '';
  if (d.phone === undefined) d.phone = '';
  return d;
}

// Valida SOLO el formato de un email (sin tocar BD). Devuelve el email normalizado en
// minúsculas, o null si el formato no es válido. Lo usa la conversación para comprobar
// el email en cuanto el usuario lo da, antes de resumir.
export function checkEmailFormat(addr) {
  const r = emailField.safeParse(String(addr ?? '').trim());
  return r.success ? r.data.toLowerCase() : null;
}
