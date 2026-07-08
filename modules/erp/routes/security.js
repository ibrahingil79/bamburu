// /admin/security — RETIRADA como pantalla. Su contenido se consolidó en /admin/perfil.
//
// Historia, para que nadie la reconstruya por error:
//  · Tenía una pestaña "Contraseña" que duplicaba /admin/change-password con otra implementación
//    y sin registrar en Actividad. Retirada; la fuente única es core/auth.js → changeOwnPassword.
//  · Tenía el 2FA, que también existía (y sigue existiendo, huérfano) en /admin/setup-2fa.
//    Los dos escribían las MISMAS columnas (admin_users.totp_secret / totp_enabled): la
//    duplicación era de interfaz, no de estado, así que consolidar no requirió migrar nada.
//    Hoy el 2FA vive solo en /admin/perfil.
//
// La ruta se mantiene montada a propósito: redirige. Hay enlaces vivos hacia ella —
// modules/disa/index.js le dice al usuario "ve a /admin/security" para activar el 2FA, y
// existen sesiones/marcadores antiguos. Un 302 no rompe a nadie; un 404 sí.
//
// PENDIENTE (Eje C — Seguridad, NO tocar aquí): /admin/setup-2fa (modules/erp/routes/auth.js)
// queda huérfana y se monta fuera del middleware CSRF; sus formularios no llevan `_csrf`.
// El riesgo práctico está mitigado por la cookie `SameSite=Lax`, pero es un hueco de defensa
// en profundidad que hay que cerrar.

import { Hono } from 'hono';

export function createSecurityRoutes(_db) {
  const r = new Hono();

  r.get('/', c => c.redirect('/admin/perfil'));

  return r;
}
