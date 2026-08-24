// ════════════════════════════════════════════════════════════════════════════════════════════════
// LA ÚNICA PUERTA POR LA QUE SALE UN CORREO A ALGUIEN DEL EQUIPO
//
// LA REGLA, y no admite excepción: **un correo nunca puede contener un dato que su destinatario no
// podría ver entrando él mismo en la pantalla.** El correo se filtra por el permiso de QUIEN LO
// RECIBE, igual que la pantalla. Si al filtrarlo se queda vacío, ese correo no se manda.
//
// POR QUÉ ESTO ES UN MÓDULO Y NO UNA COSTUMBRE. Antes del 24 ago 2026 la regla se cumplía —el
// resumen diario filtraba por permisos y está medido que lo hace—, pero se cumplía POR CONVENIO:
// estaba escrita dentro del cron, y nada impedía que el siguiente correo que alguien escribiera
// saliera sin filtrar. Un invariante que depende de que el próximo se acuerde no es un invariante.
// Aquí se convierte en estructura: el que quiera mandarle algo a un compañero pasa por aquí, declara
// el permiso de CADA bloque de contenido, y esta función decide qué sobrevive y si hay correo.
//
// LO QUE ESTA PUERTA **NO** ES. No es para los correos a CLIENTES ni a PROVEEDORES (facturas,
// presupuestos, recordatorios de cita, órdenes de compra): esos no van a alguien del equipo, no
// tienen permisos que consultar, y su contenido lo decide el documento. Esta puerta es solo para
// cuando el destinatario es una fila de `admin_users`.
//
// FALLA CERRADO, EN LAS TRES:
//   · Un bloque SIN `perm` declarado no se manda — y además revienta, para que se vea al escribirlo
//     y no seis meses después en el buzón de un empleado.
//   · Un destinatario que no existe o está INACTIVO no recibe nada. Quitarle el acceso a alguien y
//     seguir mandándole el parte del negocio por correo sería la misma fuga con otro sobre.
//   · Los permisos se leen de la BASE, nunca de lo que diga quien llama. Si el que llama pudiera
//     traer su propia lista, esto sería un adorno.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// Rol y permisos EFECTIVOS de una persona, leídos de la base. Misma consulta que `core/auth.js` y que
// `avisos.js`: una sola forma de saber qué puede ver alguien. Usuario inexistente o inactivo → sin
// rol y sin permisos, que aquí significa "no recibe nada".
export function destinatarioDe(db, userId) {
  try {
    const u = db.prepare('SELECT id, name, email, role, active FROM admin_users WHERE id=?').get(userId);
    if (!u || !u.active) return { existe: !!u, activo: false, role: '', perms: [], email: '', name: '' };
    const perms = db.prepare(
      `SELECT p.module, p.action FROM user_permissions up
         JOIN permissions p ON up.permission_id = p.id
        WHERE up.admin_user_id = ?`).all(u.id).map(p => p.module + '.' + p.action);
    return { existe: true, activo: true, role: u.role || '', perms, email: (u.email || '').trim(), name: u.name || '' };
  } catch {
    return { existe: false, activo: false, role: '', perms: [], email: '', name: '' };
  }
}

// ¿Puede esta persona ver algo que exige `perm`? Dueño y admin ven todo; el resto, lo suyo.
export function puedeVer({ role, perms }) {
  const esJefe = role === 'owner' || role === 'admin';
  const lista = perms || [];
  return perm => esJefe || lista.includes(perm);
}

// Marca de un bloque sin permiso declarado. No se usa un string vacío a propósito: un vacío se cuela
// en un `if` distraído; esto no se cuela en ninguno.
export const SIN_PERMISO_DECLARADO = Symbol('bloque sin permiso declarado');

// Quita del correo lo que su destinatario no podría ver en pantalla.
//
// `bloques`: [{ perm, texto, html, id }]. `perm` es OBLIGATORIO y es el MISMO que exige la pantalla
// donde ese dato se ve (`invoices.read` para una cifra de ventas, `cobros.read` para la deuda…).
// Devuelve { quedan, fuera }, con `fuera` nombrando lo que se cayó y por qué: un correo recortado en
// silencio es indistinguible de un correo que nunca tuvo ese dato.
export function filtrarPorPermiso(bloques, puede) {
  const quedan = [], fuera = [];
  for (const b of (bloques || [])) {
    if (!b || typeof b.perm !== 'string' || !b.perm) {
      const e = new Error('Bloque de correo sin permiso declarado' + (b && b.id ? ' (' + b.id + ')' : '')
        + '. Todo lo que viaje en un correo al equipo declara qué permiso hace falta para verlo.');
      e.codigo = SIN_PERMISO_DECLARADO;
      throw e;
    }
    if (puede(b.perm)) quedan.push(b);
    else fuera.push({ id: b.id || b.perm, perm: b.perm });
  }
  return { quedan, fuera };
}

// ── LA PUERTA ───────────────────────────────────────────────────────────────────────────────────
//
// Manda —o decide no mandar— un correo a alguien del equipo. `componer(bloques)` recibe SOLO los
// bloques que han sobrevivido al filtro y devuelve { subject, html, text }: así el asunto tampoco
// puede contar algo que el cuerpo ya no lleva, que es por donde se escapan estas cosas.
//
// Devuelve siempre un parte de lo ocurrido, nunca lanza por un envío fallido:
//   { enviado, motivo, destino, bloques, fuera, id }
// Motivos: 'enviado' · 'sin_destinatario' · 'inactivo' · 'sin_email' · 'vacio_tras_filtrar' · 'error'
export async function enviarAlEquipo(db, { userId, bloques, componer, from, replyTo }, sendEmailImpl) {
  const d = destinatarioDe(db, userId);
  if (!d.existe) return { enviado: false, motivo: 'sin_destinatario', destino: '', bloques: 0, fuera: [] };
  if (!d.activo) return { enviado: false, motivo: 'inactivo', destino: d.email, bloques: 0, fuera: [] };

  const { quedan, fuera } = filtrarPorPermiso(bloques, puedeVer(d));

  // SI SE QUEDA VACÍO, NO SE MANDA. Un correo con el saludo y nada dentro es peor que ningún correo:
  // enseña que hay algo y que no te lo cuentan.
  if (!quedan.length) return { enviado: false, motivo: 'vacio_tras_filtrar', destino: d.email, bloques: 0, fuera };

  if (!d.email) return { enviado: false, motivo: 'sin_email', destino: '', bloques: quedan.length, fuera };

  const { subject, html, text } = componer(quedan, d);
  const payload = { from: from || 'Bamburu <noreply@bamburu.com>', to: d.email, subject, ...(html ? { html } : {}), text };
  if (replyTo) payload.replyTo = replyTo;

  try {
    const { data, error } = await sendEmailImpl(payload);
    if (error) return { enviado: false, motivo: 'error', destino: d.email, bloques: quedan.length, fuera, error };
    return { enviado: true, motivo: 'enviado', destino: d.email, bloques: quedan.length, fuera, id: data && data.id };
  } catch (e) {
    return { enviado: false, motivo: 'error', destino: d.email, bloques: quedan.length, fuera, error: e };
  }
}
