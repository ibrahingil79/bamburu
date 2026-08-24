// ─────────────────────────────────────────────────────────────────────────────────────────────────
// HISTORIAL CLÍNICO · PELDAÑO 8 — el motor. Sin pantallas: solo las reglas.
//
// Decisión del dueño (24 ago 2026): se guarda dentro de Bamburu, con acceso restringido,
// consentimiento del paciente y registro de quién lo abre. **Bamburu nunca borra un historial por su
// cuenta.**
//
// LAS CUATRO REGLAS QUE VIVEN AQUÍ Y NO EN LA PANTALLA — porque una regla que solo vive en la
// pantalla se salta escribiendo la dirección:
//   1. SIN CONSENTIMIENTO NO SE ESCRIBE. Lo impide el motor.
//   2. UNA NOTA FIRMADA NO SE PISA: se corrige añadiendo otra, y la anterior sigue visible.
//   3. LA ANOTACIÓN PRIVADA NUNCA SALE en la copia del paciente. Va en su propia columna para que no
//      pueda colarse por descuido al componer el PDF.
//   4. NADA SE BORRA SOLO. No hay caducidad, ni cron, ni limpieza. Borrar es un acto manual.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import { oficioDe } from './oficios.js';

const ahora = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const hoy = () => new Date().toISOString().slice(0, 10);

// ── ¿ESTE NEGOCIO TIENE HISTORIAL? ──────────────────────────────────────────────────────────────
// Solo el oficio de salud. Es la primera puerta y la más barata: si esto dice que no, no hay pestaña,
// ni menú, ni ruta que responda.
export function tieneHistorial(db) {
  try { return oficioDe(db) === 'salud'; } catch { return false; }
}

// ── EL TEXTO DEL CONSENTIMIENTO ─────────────────────────────────────────────────────────────────
// Se guarda ENTERO junto a la firma, no un enlace: dentro de cinco años el enlace apunta a otra cosa,
// y lo que hay que poder demostrar es qué aceptó, no dónde estaba escrito.
export const CONSENTIMIENTO_VERSION = '2026-08-1';
export const CONSENTIMIENTO_TEXTO =
  'Autorizo a este centro a guardar en su sistema los datos de salud necesarios para mi atención: '
  + 'el motivo de consulta, mis antecedentes, alergias y medicación, y la evolución de cada sesión.\n\n'
  + 'Sé que estos datos son de categoría especial y que solo accederán a ellos las personas que me '
  + 'atienden, que cada acceso queda registrado, y que puedo pedir una copia de mi historial cuando '
  + 'quiera.\n\n'
  + 'Puedo retirar esta autorización en cualquier momento. Retirarla impedirá seguir escribiendo en '
  + 'mi historial, pero no lo borra: la ley obliga al centro a conservarlo durante al menos cinco '
  + 'años desde la última atención.';

// ── CONSENTIMIENTO ──────────────────────────────────────────────────────────────────────────────
export function consentimientoDe(db, clientId) {
  return db.prepare('SELECT * FROM hc_consentimientos WHERE client_id=? ORDER BY id DESC LIMIT 1').get(clientId) || null;
}
export function tieneConsentimientoVivo(db, clientId) {
  const c = consentimientoDe(db, clientId);
  return !!(c && !c.revocado_at);
}
export function otorgarConsentimiento(db, clientId, { userId, userNombre }) {
  const r = db.prepare(`INSERT INTO hc_consentimientos
      (client_id, otorgado_at, otorgado_por_user_id, otorgado_por_nombre, version, texto)
      VALUES (?,?,?,?,?,?)`)
    .run(clientId, ahora(), userId || null, userNombre || '', CONSENTIMIENTO_VERSION, CONSENTIMIENTO_TEXTO);
  registrarAcceso(db, clientId, { userId, userNombre, accion: 'consentimiento',
    detalle: 'Consentimiento otorgado (versión ' + CONSENTIMIENTO_VERSION + ')' });
  return r.lastInsertRowid;
}
export function revocarConsentimiento(db, clientId, { userId, userNombre, motivo = '' }) {
  const c = consentimientoDe(db, clientId);
  if (!c || c.revocado_at) { const e = new Error('No hay un consentimiento vivo que retirar.'); e.status = 400; throw e; }
  db.prepare('UPDATE hc_consentimientos SET revocado_at=?, revocado_por_user_id=?, revocado_por_nombre=?, revocado_motivo=? WHERE id=?')
    .run(ahora(), userId || null, userNombre || '', String(motivo || '').trim(), c.id);
  registrarAcceso(db, clientId, { userId, userNombre, accion: 'consentimiento',
    detalle: 'Consentimiento RETIRADO. El historial se conserva: la ley obliga.' });
}

// LA FRASE QUE SE ENSEÑA CUANDO NO SE PUEDE ESCRIBIR. Sin jerga legal, y dice qué hacer.
export const SIN_CONSENTIMIENTO =
  'Este paciente no ha autorizado que guardes sus datos de salud, así que no se puede escribir en su '
  + 'historial. Pídeselo y recoge su autorización en su ficha; se guarda con la fecha y quién la recogió.';

function exigeConsentimiento(db, clientId) {
  if (!tieneConsentimientoVivo(db, clientId)) { const e = new Error(SIN_CONSENTIMIENTO); e.status = 400; throw e; }
}

// ── ANTECEDENTES (versionados: editar NO pisa) ──────────────────────────────────────────────────
export function antecedentesVigentes(db, clientId) {
  return db.prepare('SELECT * FROM hc_antecedentes WHERE client_id=? ORDER BY version DESC LIMIT 1').get(clientId) || null;
}
export function antecedentesHistorico(db, clientId) {
  return db.prepare('SELECT * FROM hc_antecedentes WHERE client_id=? ORDER BY version DESC').all(clientId);
}
export function guardarAntecedentes(db, clientId, datos, { userId, userNombre }) {
  exigeConsentimiento(db, clientId);
  const prev = antecedentesVigentes(db, clientId);
  const version = (prev ? prev.version : 0) + 1;
  db.prepare(`INSERT INTO hc_antecedentes
      (client_id, version, motivo_consulta, antecedentes, alergias, medicacion, observaciones,
       autor_user_id, autor_nombre, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(clientId, version, datos.motivo_consulta || '', datos.antecedentes || '', datos.alergias || '',
         datos.medicacion || '', datos.observaciones || '', userId || null, userNombre || '', ahora());
  registrarAcceso(db, clientId, { userId, userNombre, accion: 'escribir',
    detalle: 'Antecedentes guardados (versión ' + version + '; la ' + (version - 1) + ' sigue visible)' });
  return version;
}

// ── EVOLUCIÓN POR SESIÓN ────────────────────────────────────────────────────────────────────────
export function notasDe(db, clientId) {
  return db.prepare('SELECT * FROM hc_notas WHERE client_id=? ORDER BY fecha DESC, id DESC').all(clientId);
}
export function crearNota(db, clientId, datos, { userId, userNombre }) {
  exigeConsentimiento(db, clientId);
  const r = db.prepare(`INSERT INTO hc_notas
      (client_id, cita_id, fecha, profesional_user_id, profesional_nombre,
       valoracion, tratamiento, siguiente_paso, privado, corrige_nota_id, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(clientId, datos.cita_id || null, datos.fecha || hoy(), userId || null, userNombre || '',
         datos.valoracion || '', datos.tratamiento || '', datos.siguiente_paso || '',
         datos.privado || '', datos.corrige_nota_id || null, ahora());
  registrarAcceso(db, clientId, { userId, userNombre,
    accion: datos.corrige_nota_id ? 'corregir' : 'escribir',
    detalle: datos.corrige_nota_id
      ? 'Corrección de la nota #' + datos.corrige_nota_id + ' (la anterior sigue visible)'
      : 'Nota de sesión del ' + (datos.fecha || hoy()) });
  return r.lastInsertRowid;
}

// ── EL REGISTRO DE ACCESOS — SOLO SE AÑADE ──────────────────────────────────────────────────────
// No hay en toda la aplicación un UPDATE ni un DELETE contra `hc_accesos`, y `verify-historial-clinico`
// se pone rojo si aparece uno. El `detalle` dice QUÉ se hizo, nunca el contenido clínico.
export function registrarAcceso(db, clientId, { userId, userNombre, accion, detalle = '' }) {
  try {
    db.prepare('INSERT INTO hc_accesos (client_id, user_id, user_nombre, accion, detalle, created_at) VALUES (?,?,?,?,?,?)')
      .run(clientId, userId || null, userNombre || '', accion, detalle, ahora());
  } catch (_) { /* el registro no puede tumbar la pantalla, pero se intenta siempre */ }
}
export function accesosDe(db, { clientId = null, userId = null, limite = 500 } = {}) {
  const w = [], p = [];
  if (clientId) { w.push('a.client_id=?'); p.push(clientId); }
  if (userId) { w.push('a.user_id=?'); p.push(userId); }
  return db.prepare('SELECT a.*, c.name AS client_name FROM hc_accesos a LEFT JOIN clients c ON c.id=a.client_id'
    + (w.length ? ' WHERE ' + w.join(' AND ') : '') + ' ORDER BY a.id DESC LIMIT ?').all(...p, limite);
}

// ── CONSERVACIÓN — NADA SE BORRA SOLO ───────────────────────────────────────────────────────────
// Se calcula y se ENSEÑA, no se aplica: la ley estatal manda cinco años desde la última atención, y
// varias comunidades alargan ese plazo (Cataluña y Navarra llegan a veinte en ciertos documentos).
// Un borrado automático adelantaría el plazo de la comunidad del cliente y le costaría una multa.
export function conservacionDe(db, clientId) {
  const ult = db.prepare('SELECT MAX(fecha) f FROM hc_notas WHERE client_id=?').get(clientId)?.f || null;
  if (!ult) return { ultimaAtencion: null, minimoHasta: null, texto: 'Sin sesiones registradas todavía.' };
  const d = new Date(ult + 'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() + 5);
  const hasta = d.toISOString().slice(0, 10);
  return { ultimaAtencion: ult, minimoHasta: hasta,
    texto: 'Última atención: ' + ult + '. La ley obliga a conservar este historial al menos hasta '
         + hasta + ' (cinco años). Tu comunidad autónoma puede exigir más.' };
}

// ── LA COPIA PARA EL PACIENTE — SIN LAS ANOTACIONES PRIVADAS ────────────────────────────────────
// Es un derecho del paciente y hay que poder cumplirlo en un minuto.
//
// LA ANOTACIÓN PRIVADA NO SE FILTRA AQUÍ: **no se lee**. La consulta ni siquiera nombra la columna
// `privado`, así que no hay forma de que se cuele por un descuido al componer el HTML. Filtrar
// después lo que ya has cargado es cómo se escapan estas cosas.
export function copiaParaPaciente(db, clientId) {
  const cliente = db.prepare('SELECT name, fiscal_id, email, phone, fecha_nacimiento FROM clients WHERE id=?').get(clientId);
  const cons = consentimientoDe(db, clientId);
  const ant = db.prepare(`SELECT version, motivo_consulta, antecedentes, alergias, medicacion, observaciones,
                                 autor_nombre, created_at
                            FROM hc_antecedentes WHERE client_id=? ORDER BY version DESC LIMIT 1`).get(clientId) || null;
  const notas = db.prepare(`SELECT id, fecha, profesional_nombre, valoracion, tratamiento, siguiente_paso,
                                   corrige_nota_id, created_at
                              FROM hc_notas WHERE client_id=? ORDER BY fecha ASC, id ASC`).all(clientId);
  return { cliente, consentimiento: cons, antecedentes: ant, notas, generado: ahora() };
}

// ── BORRAR — SIEMPRE A MANO, NUNCA SOLO ─────────────────────────────────────────────────────────
// No hay cron, ni caducidad, ni limpieza automática en ninguna parte del producto que toque estas
// tablas: hay una comprobación que se pone roja si aparece una.
//
// Borrar un historial es un acto del dueño, y antes de dejarle pulsar se le dice la obligación legal
// que puede estar incumpliendo. Al borrar **queda constancia de quién, cuándo y de qué paciente, sin
// conservar el contenido**: el registro de accesos es lo único que sobrevive, y es lo correcto —
// probar que algo se borró no exige guardar lo borrado.
export const AVISO_BORRADO =
  'La ley obliga a conservar un historial clínico al menos CINCO AÑOS desde la última atención, y '
  + 'varias comunidades autónomas exigen más (en Cataluña y Navarra ciertos documentos llegan a veinte). '
  + 'Si borras antes de ese plazo, el incumplimiento es del centro. Bamburu no borra ningún historial '
  + 'por su cuenta: esto solo pasa si lo pides tú.';

export function borrarHistorial(db, clientId, { userId, userNombre }) {
  const cli = db.prepare('SELECT name FROM clients WHERE id=?').get(clientId);
  const cuantas = db.prepare('SELECT COUNT(*) n FROM hc_notas WHERE client_id=?').get(clientId).n;
  const cons = conservacionDe(db, clientId);
  const hacer = () => {
    db.prepare('DELETE FROM hc_notas WHERE client_id=?').run(clientId);
    db.prepare('DELETE FROM hc_antecedentes WHERE client_id=?').run(clientId);
    // El consentimiento NO se borra: es la prueba de que hubo permiso para tratar esos datos.
    // Y el registro de accesos tampoco: es lo que demuestra qué pasó, incluido este borrado.
    registrarAcceso(db, clientId, { userId, userNombre, accion: 'borrar',
      detalle: 'Borró el historial de ' + (cli ? cli.name : '#' + clientId) + ' (' + cuantas
             + ' sesiones y sus antecedentes). Última atención: ' + (cons.ultimaAtencion || 'ninguna')
             + '. No se conserva el contenido borrado.' });
  };
  db.inTransaction ? hacer() : db.transaction(hacer)();
  return { sesionesBorradas: cuantas };
}
