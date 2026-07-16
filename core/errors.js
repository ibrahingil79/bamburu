// C3/M4 (Eje C) — mensaje de error SEGURO para el CLIENTE.
//
// Muchos `catch` por-ruta devolvían el `e.message` CRUDO de better-sqlite3 al cliente
// (`UNIQUE constraint failed: admin_users.email`, `no such column: …`, `NOT NULL constraint failed: …`),
// filtrando la ESTRUCTURA de la base (tablas/columnas/constraints) y facilitando mapearla. Regla:
//   · Error de CLIENTE que NOSOTROS lanzamos a propósito (e.status 4xx, con un mensaje propio y legible):
//     se muestra tal cual — es información para el usuario, no filtración.
//   · Cualquier otro (error SQL, inesperado, sin `status`): se OCULTA el detalle técnico y se devuelve un
//     mensaje genérico. El detalle real (incl. el SQL) se queda en el LOG del servidor, nunca viaja al cliente.
//
// Sustituye a `error: e.message` en las respuestas: `c.json({ error: safeError(e) }, e.status || 500)`.
export function safeError(e) {
  const status = e && e.status;
  if (status && status >= 400 && status < 500) return (e && e.message) ? e.message : 'Solicitud no válida.';
  console.error('[error]', (e && e.stack) || e);   // el detalle técnico va SOLO al log del servidor
  return 'Ha ocurrido un error, inténtalo de nuevo.';
}
