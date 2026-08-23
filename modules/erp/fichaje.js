// ════════════════════════════════════════════════════════════════════════════════════════════════
// CONTROL HORARIO · EL REGISTRO DE JORNADA — el motor · punto 12, 23 ago 2026
//
// LO QUE PIDE LA LEY (RD-ley 8/2019, art. 34.9 ET), y que es lo que este fichero tiene que
// garantizar, ni más ni menos:
//   · registro DIARIO por trabajador, con la hora de INICIO y la de FIN de su jornada;
//   · conservable CUATRO AÑOS;
//   · a disposición del TRABAJADOR, de sus representantes y de la Inspección.
// De ahí salen tres decisiones que no son de gusto:
//   1. NO SE BORRA NADA. Corregir apunta un fichaje nuevo que dice a cuál sustituye; el viejo queda
//      anulado con su motivo, y los dos siguen en la tabla.
//   2. LA JORNADA SE DERIVA de los fichajes, no se guarda. Un total guardado no se puede auditar.
//   3. EL TRABAJADOR VE LO SUYO SIEMPRE. Eso no es una opción de permisos: es el derecho que da la
//      ley, y por eso la pantalla no se lo puede negar a nadie que pueda entrar.
//
// LO QUE ESTE MOTOR **NO** HACE, y se dice para que nadie lo dé por hecho: no calcula nóminas, no
// sabe de horas extra ni de convenios, y no vigila descansos mínimos. Registra y suma.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { ahoraLocal, hhmm, parseHHMM } from './citas-engine.js';

const err = (m, s = 400) => { const e = new Error(m); e.status = s; return e; };
export const TIPOS = ['entrada', 'pausa', 'vuelta', 'salida'];
export const TIPO_LABEL = { entrada: 'Entrada', pausa: 'Pausa', vuelta: 'Vuelta de la pausa', salida: 'Salida' };

// Los fichajes VIVOS de un día (los anulados quedan, pero no cuentan).
export function fichajesDe(db, userId, fecha) {
  try {
    return db.prepare(
      `SELECT * FROM fichajes WHERE user_id=? AND fecha=? AND anulado=0 ORDER BY hora, id`
    ).all(userId, fecha);
  } catch { return []; }
}
// TODOS, incluidos los anulados y las correcciones: es lo que se le enseña a quien audita.
export function historialDe(db, userId, fecha) {
  try {
    return db.prepare(
      `SELECT f.*, u.name AS quien FROM fichajes f LEFT JOIN admin_users u ON u.id=f.hecho_por
        WHERE f.user_id=? AND f.fecha=? ORDER BY f.hora, f.id`).all(userId, fecha);
  } catch { return []; }
}

// ¿QUÉ TOCA AHORA? Se deriva del último fichaje del día: sin nada → entrada; trabajando → pausa o
// salida; en pausa → vuelta (o salida, que también vale: alguien se va sin volver de comer).
export function estadoDe(db, userId, fecha) {
  const fs = fichajesDe(db, userId, fecha);
  const ultimo = fs[fs.length - 1] || null;
  if (!ultimo) return { estado: 'fuera', puede: ['entrada'], desde: null, fichajes: fs };
  if (ultimo.tipo === 'salida') return { estado: 'cerrada', puede: ['entrada'], desde: ultimo.hora, fichajes: fs };
  if (ultimo.tipo === 'pausa') return { estado: 'pausa', puede: ['vuelta', 'salida'], desde: ultimo.hora, fichajes: fs };
  return { estado: 'trabajando', puede: ['pausa', 'salida'], desde: ultimo.hora, fichajes: fs };
}

// LA JORNADA DEL DÍA, derivada. Devuelve minutos trabajados, de pausa, y si quedó ABIERTA (que es un
// dato, no un fallo: alguien se olvidó de fichar la salida, y eso hay que poder verlo).
export function jornadaDe(db, userId, fecha) {
  const fs = fichajesDe(db, userId, fecha);
  let trabajo = 0, pausa = 0, abierta = false, entrada = null, salida = null;
  let desde = null, enPausa = null;
  for (const f of fs) {
    const m = parseHHMM(f.hora);
    if (f.tipo === 'entrada') { if (!entrada) entrada = f.hora; desde = m; }
    else if (f.tipo === 'pausa') { if (desde != null) { trabajo += Math.max(0, m - desde); desde = null; } enPausa = m; }
    else if (f.tipo === 'vuelta') { if (enPausa != null) { pausa += Math.max(0, m - enPausa); enPausa = null; } desde = m; }
    else if (f.tipo === 'salida') {
      if (desde != null) { trabajo += Math.max(0, m - desde); desde = null; }
      if (enPausa != null) { pausa += Math.max(0, m - enPausa); enPausa = null; }
      salida = f.hora;
    }
  }
  // Si el día sigue abierto, lo que lleva NO se inventa hasta «ahora» si el día ya pasó: solo se
  // cuenta el tiempo en curso cuando el día es HOY. Un día de la semana pasada que quedó abierto
  // suma lo que suma y se marca como abierto, que es la verdad.
  //
  // OJO AL RELOJ, Y ES UN FALLO QUE SE PAGÓ ESCRIBIENDO ESTO (23 ago 2026, 23:5x): «hoy» tiene que
  // salir de `ahoraLocal()`, el reloj DEL NEGOCIO, y no de `new Date().toISOString()`, que es UTC.
  // A las 23:50 en Madrid son ya las 01:50 del día siguiente en verano… al revés: en UTC son las
  // 21:50 del MISMO día. Mezclar los dos relojes hace que `fichar` apunte en un día y `jornadaDe`
  // mire otro, y el trabajador vea «todavía no has fichado» un minuto después de fichar. Un
  // registro de jornada que se descuadra a medianoche no vale para lo que existe.
  const hoy = ahoraLocal().fecha;
  if (desde != null || enPausa != null) {
    abierta = true;
    if (fecha === hoy) {
      const ahora = parseHHMM(hhmm(ahoraLocal().min));
      if (desde != null) trabajo += Math.max(0, ahora - desde);
      if (enPausa != null) pausa += Math.max(0, ahora - enPausa);
    }
  }
  return { fecha, entrada, salida, minutos: trabajo, pausa_min: pausa, abierta, fichajes: fs.length };
}

// FICHAR. `tipo` tiene que ser el que toca: no se puede salir sin haber entrado, ni volver de una
// pausa que no existe. La secuencia imposible se rechaza CON SU MOTIVO — no se «arregla» sola,
// porque un registro que se autocorrige deja de ser un registro.
export function fichar(db, { userId, tipo, fecha = null, hora = null, hechoPor = null, nota = '', origen = 'pantalla' }) {
  if (!TIPOS.includes(tipo)) throw err('Ese tipo de fichaje no existe.');
  if (!db.prepare('SELECT 1 FROM admin_users WHERE id=? AND active=1').get(userId)) throw err('Esa persona no existe o está desactivada.', 404);
  const ahora = ahoraLocal();
  const f = fecha || ahora.fecha;
  const h = hora || hhmm(ahora.min);
  if (!/^\d{2}:\d{2}$/.test(h)) throw err('La hora tiene que ir en formato HH:MM.');
  const st = estadoDe(db, userId, f);
  if (!st.puede.includes(tipo)) {
    const que = st.puede.map(t => TIPO_LABEL[t].toLowerCase()).join(' o ');
    throw err('Ahora mismo no toca «' + TIPO_LABEL[tipo].toLowerCase() + '»: toca ' + que + '.');
  }
  // Un fichaje no puede ir ANTES del anterior: el reloj no anda hacia atrás.
  const ultimo = st.fichajes[st.fichajes.length - 1];
  if (ultimo && h < ultimo.hora) throw err('Esa hora (' + h + ') es anterior al último fichaje del día (' + ultimo.hora + ').');
  const r = db.prepare(
    `INSERT INTO fichajes (user_id, fecha, hora, tipo, origen, nota, hecho_por) VALUES (?,?,?,?,?,?,?)`
  ).run(userId, f, h, tipo, origen, String(nota || ''), hechoPor || userId);
  return { id: Number(r.lastInsertRowid), tipo, fecha: f, hora: h, ...estadoDe(db, userId, f) };
}

// CORREGIR: no se edita, se sustituye. El original queda anulado con su motivo y apuntando quién.
export function corregir(db, { fichajeId, hora, motivo, hechoPor }) {
  const o = db.prepare('SELECT * FROM fichajes WHERE id=?').get(fichajeId);
  if (!o) throw err('Ese fichaje no existe.', 404);
  if (o.anulado) throw err('Ese fichaje ya está corregido.');
  const m = String(motivo || '').trim();
  if (m.length < 3) throw err('Di por qué se corrige: es lo que hace que el registro valga.');
  if (!/^\d{2}:\d{2}$/.test(String(hora || ''))) throw err('La hora tiene que ir en formato HH:MM.');
  const tx = db.transaction(() => {
    db.prepare('UPDATE fichajes SET anulado=1, motivo=? WHERE id=?').run(m, fichajeId);
    const r = db.prepare(
      `INSERT INTO fichajes (user_id, fecha, hora, tipo, origen, nota, corregido_de, hecho_por, motivo)
       VALUES (?,?,?,?,'correccion',?,?,?,?)`
    ).run(o.user_id, o.fecha, hora, o.tipo, o.nota || '', fichajeId, hechoPor || null, m);
    return Number(r.lastInsertRowid);
  });
  return { id: tx(), corrige: fichajeId };
}

// El resumen de un periodo para una persona: un día por fila. Es lo que se enseña, se imprime y se
// le entrega a quien lo pida.
export function resumen(db, userId, desde, hasta) {
  const dias = [];
  const d0 = Date.parse(desde + 'T00:00:00Z'), d1 = Date.parse(hasta + 'T00:00:00Z');
  for (let t = d0; t <= d1; t += 86400000) {
    const f = new Date(t).toISOString().slice(0, 10);
    const j = jornadaDe(db, userId, f);
    if (j.fichajes) dias.push(j);
  }
  const total = dias.reduce((s, d) => s + d.minutos, 0);
  const pausa = dias.reduce((s, d) => s + d.pausa_min, 0);
  return { desde, hasta, dias, total_min: total, pausa_min: pausa, abiertas: dias.filter(d => d.abierta).length };
}

// Quién tiene la jornada abierta AHORA — lo que el dueño mira de un vistazo.
export function quienEstaDentro(db, fecha = null) {
  const f = fecha || ahoraLocal().fecha;
  const users = db.prepare('SELECT id, name FROM admin_users WHERE active=1 ORDER BY name').all();
  return users.map(u => ({ ...u, ...estadoDe(db, u.id, f), jornada: jornadaDe(db, u.id, f) }))
    .filter(u => u.estado !== 'fuera');
}

export const horasTexto = min => {
  const m = Math.max(0, Math.round(min || 0));
  return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min';
};
