// AVISOS Y CORREOS — las preferencias. Dos cosas distintas que la pantalla enseña juntas y que aquí
// se guardan separadas, porque no son la misma decisión:
//
//   BLOQUE 1 · lo que Bamburu te cuenta A TI      → preferencia POR PERSONA  (avisos_pref_usuario)
//   BLOQUE 2 · lo que Bamburu manda A TUS CLIENTES → preferencia DEL NEGOCIO (email_tipo_pref)
//
// LA AUSENCIA DE FILA ES EL DEFECTO, en los dos bloques. Nadie deja de recibir ni de enviar nada por
// esta migración: quien no ha entrado en la pantalla se comporta hoy igual que ayer. Lo que gana es
// poder apagarlo. Por eso no se siembra una fila por usuario ni por tipo de correo: sembrar sería
// congelar el defecto de hoy, y el día que cambie habría que migrar a todo el mundo otra vez.

import { ZONA_NEGOCIO } from './avisos.js';
import { LINEA_IDS } from './parte-diario.js';

// ── BLOQUE 1 · la preferencia de cada persona ───────────────────────────────────────────────────

export const PREF_DEFECTO = Object.freeze({
  activo: 1, frecuencia: 'diaria', dia_semana: 1, hora: 8, fuentes: [],   // fuentes:[] = todas las suyas
});

export const FRECUENCIAS = ['diaria', 'semanal'];
export const DIAS = [
  { n: 1, label: 'lunes' }, { n: 2, label: 'martes' }, { n: 3, label: 'miércoles' },
  { n: 4, label: 'jueves' }, { n: 5, label: 'viernes' }, { n: 6, label: 'sábado' }, { n: 7, label: 'domingo' },
];

const entero = (v, min, max, porDefecto) => {
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : porDefecto;
};

// Lee la preferencia de una persona. Sin fila → el defecto. Nunca devuelve null: quien pregunta
// quiere saber qué le toca a este usuario, y "no ha tocado nada" es una respuesta completa.
export function getPref(db, userId) {
  let row = null;
  try { row = db.prepare('SELECT * FROM avisos_pref_usuario WHERE admin_user_id=?').get(userId); } catch { /* sin tabla aún */ }
  if (!row) return { ...PREF_DEFECTO, esDefecto: true };
  return {
    activo: row.activo ? 1 : 0,
    frecuencia: FRECUENCIAS.includes(row.frecuencia) ? row.frecuencia : PREF_DEFECTO.frecuencia,
    dia_semana: entero(row.dia_semana, 1, 7, PREF_DEFECTO.dia_semana),
    hora: entero(row.hora, 0, 23, PREF_DEFECTO.hora),
    fuentes: String(row.fuentes || '').split(',').map(s => s.trim()).filter(s => LINEA_IDS.includes(s)),
    esDefecto: false,
  };
}

// Guarda la preferencia. SANEA en el servidor: una hora de 99, una frecuencia inventada o una fuente
// que no existe no llegan a la BD. Las fuentes se guardan tal cual las marca el usuario; el permiso
// se aplica AL ENVIAR (parte-diario.lineasDe hace la intersección), que es donde puede haber
// cambiado desde que se guardó.
export function setPref(db, userId, input = {}) {
  const frecuencia = FRECUENCIAS.includes(input.frecuencia) ? input.frecuencia : PREF_DEFECTO.frecuencia;
  const pref = {
    activo: (input.activo === false || input.activo === 0 || input.activo === '0') ? 0 : 1,
    frecuencia,
    dia_semana: entero(input.dia_semana, 1, 7, PREF_DEFECTO.dia_semana),
    hora: entero(input.hora, 0, 23, PREF_DEFECTO.hora),
    fuentes: Array.isArray(input.fuentes) ? input.fuentes.filter(f => LINEA_IDS.includes(f)) : [],
  };
  // Marcarlas TODAS es lo mismo que no recortar ninguna: se guarda '' para que el día que se añada
  // una fuente nueva al motor, a quien no había recortado le entre sola (y a quien recortó, no).
  const todas = pref.fuentes.length === LINEA_IDS.length;
  db.prepare(`INSERT INTO avisos_pref_usuario (admin_user_id, activo, frecuencia, dia_semana, hora, fuentes, updated_at)
              VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)
              ON CONFLICT(admin_user_id) DO UPDATE SET
                activo=excluded.activo, frecuencia=excluded.frecuencia, dia_semana=excluded.dia_semana,
                hora=excluded.hora, fuentes=excluded.fuentes, updated_at=CURRENT_TIMESTAMP`)
    .run(userId, pref.activo, pref.frecuencia, pref.dia_semana, pref.hora, todas ? '' : pref.fuentes.join(','));
  return getPref(db, userId);
}

// ── ¿LE TOCA AHORA? ─────────────────────────────────────────────────────────────────────────────

// Hora local del negocio (0..23). El servidor corre en UTC: preguntar por `getHours()` mandaría el
// resumen de las 8:00 a las 10:00 de España en verano — el mismo error que ya obligó a poner la zona
// explícita en el timer.
export function horaLocal(tz = ZONA_NEGOCIO, ahora = new Date()) {
  return Number.parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(ahora), 10);
}

// Día de la semana ISO (1=lunes … 7=domingo) de una fecha AAAA-MM-DD.
export function diaSemanaDe(fecha) {
  const d = new Date(fecha + 'T12:00:00Z').getUTCDay();   // 0=domingo
  return d === 0 ? 7 : d;
}

// ¿A esta persona le toca su resumen en esta pasada? Tres condiciones, y las tres tienen que darse:
//   · lo quiere (interruptor maestro),
//   · es su día (siempre, si es diaria; el que eligió, si es semanal),
//   · y su hora YA HA LLEGADO.
//
// Ojo a lo último: NO es `hora === pref.hora`, es `>=`. El temporizador es horario y `Persistent`,
// así que si el servidor estuvo apagado de las 07:00 a las 14:00, systemd hace UNA pasada de
// recuperación, no siete. Con la igualdad, todo el que tuviera puesta una hora intermedia se
// quedaba sin resumen ese día y nadie se enteraba. Con `>=` más el registro de `resumen_envios`
// (que impide el duplicado), la pasada tardía recoge a los que se quedaron por el camino y a nadie
// le llega dos veces. Sin planificador nuevo: la idempotencia hace el trabajo.
export function leToca(pref, { hora, fecha }) {
  if (!pref.activo) return { toca: false, motivo: 'apagado' };
  if (pref.frecuencia === 'semanal' && diaSemanaDe(fecha) !== pref.dia_semana) return { toca: false, motivo: 'no_toca' };
  if (hora < pref.hora) return { toca: false, motivo: 'no_toca' };
  return { toca: true, motivo: '' };
}

// ── IDEMPOTENCIA Y CONSTANCIA ───────────────────────────────────────────────────────────────────
// Dos pasadas del temporizador a la misma hora tienen que dar UN correo. Y un día en que no había
// nada que contar tiene que quedar registrado como "evaluado, no había nada" — no como silencio,
// que es indistinguible de que el cron no corrió.

export const yaRegistrado = (db, fecha, userId) => {
  try { return !!db.prepare('SELECT 1 FROM resumen_envios WHERE fecha=? AND admin_user_id=?').get(fecha, userId); }
  catch { return false; }
};

export function registrar(db, { fecha, userId, enviado, motivo, lineas = 0 }) {
  db.prepare(`INSERT INTO resumen_envios (fecha, admin_user_id, enviado, motivo, lineas, sent_at)
              VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)
              ON CONFLICT(fecha, admin_user_id) DO UPDATE SET
                enviado=excluded.enviado, motivo=excluded.motivo, lineas=excluded.lineas, sent_at=CURRENT_TIMESTAMP`)
    .run(fecha, userId, enviado ? 1 : 0, motivo || '', lineas);
}

// ── BLOQUE 2 · los correos que el negocio manda a sus clientes ──────────────────────────────────
//
// QUÉ LLEVA INTERRUPTOR Y QUÉ NO, y por qué. No es una lista de gustos: sale de quién dispara cada
// correo, que es lo que determina si "apagarlo" significa algo.
//
//   · AUTOMÁTICOS — los manda el sistema sin que nadie pulse nada. Aquí un interruptor es justo lo
//     que faltaba: hoy no se pueden apagar y salen igual.
//   · DE BOTÓN — los manda una persona al pulsar "enviar". Apagarlo significa que ese botón deja de
//     funcionar y avisa de por qué (decisión del dueño, 17 ago 2026).
//   · TRANSACCIONALES — los pide el propio destinatario ("he olvidado mi contraseña", "entra a tu
//     portal"). NO llevan interruptor: apagar el de la contraseña deja a una persona fuera de su
//     cuenta y nadie se entera hasta que pasa. Es el mismo argumento por el que email-templates.js
//     ya BLOQUEA que se le borre el enlace de acción; sería incoherente permitir por el interruptor
//     lo que está prohibido por el editor.
//   · `resumen_avisos` NO está aquí: es el correo del BLOQUE 1, y su mando es el de arriba. Dos
//     interruptores para un solo correo es una forma segura de que uno de los dos mienta.
export const CORREOS = [
  { tipo: 'recordatorio_cita', clase: 'automatico', quien: 'A tu cliente, el día antes de su cita, sin que tú hagas nada.',
    espejo: 'cita_modo_recordatorio' },
  { tipo: 'confirmacion_cita', clase: 'automatico', quien: 'A tu cliente en cuanto reserva por Internet.' },
  { tipo: 'cobro_factura',     clase: 'boton', quien: 'A tu cliente cuando le reclamas una factura vencida.' },
  { tipo: 'cobro_cuenta',      clase: 'boton', quien: 'A tu cliente cuando le reclamas todo su saldo de una vez.' },
  { tipo: 'comercial',         clase: 'boton', quien: 'A un cliente con una oportunidad abierta en el CRM.' },
  { tipo: 'presupuesto',       clase: 'boton', quien: 'A tu cliente cuando le mandas un presupuesto.' },
  { tipo: 'orden_compra',      clase: 'boton', quien: 'A tu proveedor cuando le mandas una orden de compra.' },
];

export const CORREOS_SIN_INTERRUPTOR = [
  { tipo: 'recuperar_password', porque: 'Sin él, quien olvide su contraseña se queda fuera de su cuenta y nadie se entera.' },
  { tipo: 'portal_cliente',     porque: 'Es el enlace que tu cliente ha pedido para entrar a su portal: lo dispara él, no tú.' },
];

const TIPOS_CONMUTABLES = new Set(CORREOS.map(c => c.tipo));

// El recordatorio de cita YA tenía interruptor antes de este encargo: `company_config
// .cita_modo_recordatorio`, 'manual' | 'auto_email', y nace en 'manual' (o sea, APAGADO). Este mando
// LO REFLEJA en vez de crear otro al lado. Si hubiera nacido uno nuevo "encendido por defecto",
// habríamos empezado a mandar recordatorios que hoy no se mandan — cambiar el comportamiento de
// todos los negocios sin que nadie lo pidiera.
const leerEspejoRecordatorio = db => {
  try { return (db.prepare('SELECT cita_modo_recordatorio m FROM company_config WHERE id=1').get()?.m || 'manual') === 'auto_email'; }
  catch { return false; }
};
const escribirEspejoRecordatorio = (db, activo) => {
  db.prepare("UPDATE company_config SET cita_modo_recordatorio=? WHERE id=1").run(activo ? 'auto_email' : 'manual');
};

// ¿Está encendida la puerta pública? Mientras lo esté, la confirmación de reserva NO se puede
// apagar: en la pieza 6 se prometió que la política de cancelación se enseña antes de confirmar y se
// REPITE en el correo. Sin correo, esa promesa se rompe en silencio y el cliente se queda sin el
// único papel que le dice hasta cuándo puede anular.
export const puertaPublicaEncendida = db => {
  try { return !!db.prepare('SELECT cita_pub_activa a FROM company_config WHERE id=1').get()?.a; }
  catch { return false; }
};

export function correoBloqueado(db, tipo) {
  if (tipo === 'confirmacion_cita' && puertaPublicaEncendida(db)) {
    return 'Para dejar de enviarlo, apaga antes las reservas por Internet.';
  }
  return '';
}

// ¿Está encendido este correo? Sin fila → SÍ (el defecto es lo que se hacía ayer).
export function correoActivo(db, tipo) {
  if (!TIPOS_CONMUTABLES.has(tipo)) return true;                 // los transaccionales no se apagan
  if (tipo === 'recordatorio_cita') return leerEspejoRecordatorio(db);
  if (correoBloqueado(db, tipo)) return true;                    // bloqueado = encendido a la fuerza
  try {
    const row = db.prepare('SELECT activo FROM email_tipo_pref WHERE tipo=?').get(tipo);
    return row ? !!row.activo : true;
  } catch { return true; }
}

export function setCorreoActivo(db, tipo, activo, userId = null) {
  if (!TIPOS_CONMUTABLES.has(tipo)) { const e = new Error('Ese correo no se puede apagar'); e.status = 400; throw e; }
  const bloqueo = correoBloqueado(db, tipo);
  if (bloqueo && !activo) { const e = new Error(bloqueo); e.status = 409; throw e; }
  if (tipo === 'recordatorio_cita') { escribirEspejoRecordatorio(db, activo); return correoActivo(db, tipo); }
  db.prepare(`INSERT INTO email_tipo_pref (tipo, activo, updated_at, updated_by) VALUES (?,?,CURRENT_TIMESTAMP,?)
              ON CONFLICT(tipo) DO UPDATE SET activo=excluded.activo, updated_at=CURRENT_TIMESTAMP, updated_by=excluded.updated_by`)
    .run(tipo, activo ? 1 : 0, userId);
  return correoActivo(db, tipo);
}

// EL GUARDIÁN. Se llama justo antes de enviar, en el sitio donde se envía. Un interruptor que la
// pantalla enseña pero que el envío no consulta es peor que no tener interruptor: el dueño cree que
// lo apagó y sigue saliendo.
export function exigirCorreoActivo(db, tipo) {
  if (correoActivo(db, tipo)) return;
  const e = new Error('Este correo está apagado en Ajustes → Avisos y correos. Enciéndelo para poder enviarlo.');
  e.status = 409;
  throw e;
}
