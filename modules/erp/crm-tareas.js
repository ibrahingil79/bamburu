// ════════════════════════════════════════════════════════════════════════════════════════════════
// AGENDA DEL CRM · TAREAS Y SEGUIMIENTOS — punto 13, 23 ago 2026
//
// «Las tareas y seguimientos comerciales con fecha, dueño y aviso, enganchados a la línea de tiempo
// del cliente que ya existe.» Las cuatro piezas, y cómo se cumple cada una:
//   · FECHA  → `fecha`, obligatoria. Una tarea sin día no es una tarea, es una intención.
//   · DUEÑO  → `user_id`. Sin dueño, una tarea es de todos y no la hace nadie.
//   · AVISO  → una fuente nueva en el motor de avisos que YA EXISTE (`avisos.js`), así que sale en
//              la campana, en /admin/avisos, en el Inicio y en el correo diario sin tocar nada más.
//   · LÍNEA DE TIEMPO → `tareasDeCliente` las devuelve con la forma que la ficha ya sabe pintar.
//
// LO QUE NO SE HACE, y es a propósito: NO se manda un email al dueño de la tarea. El canal que hay
// es el resumen diario de avisos, y meter un correo por tarea sería un sistema de mensajería nuevo
// que nadie ha pedido — y el que más rápido se acaba silenciando.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { hoyLocal } from './avisos.js';

const err = (m, s = 400) => { const e = new Error(m); e.status = s; return e; };
const diasEntre = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

export function crearTarea(db, { client_id = null, opportunity_id = null, titulo, detalle = '',
                                 fecha, user_id = null, created_by = null }) {
  const t = String(titulo || '').trim();
  if (!t) throw err('La tarea necesita un título: qué hay que hacer.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) throw err('Dile para cuándo es (una fecha).');
  if (client_id && !db.prepare('SELECT 1 FROM clients WHERE id=?').get(client_id)) throw err('Ese cliente no existe.', 404);
  if (opportunity_id) {
    const o = db.prepare('SELECT client_id FROM opportunities WHERE id=?').get(opportunity_id);
    if (!o) throw err('Esa oportunidad no existe.', 404);
    // Si la tarea es de una oportunidad, su cliente es el de la oportunidad. No se deja discrepar:
    // una tarea colgada de dos sitios distintos acaba saliendo en la ficha equivocada.
    client_id = o.client_id;
  }
  if (!client_id) throw err('Una tarea comercial es de alguien: dime de qué cliente.');
  if (user_id && !db.prepare('SELECT 1 FROM admin_users WHERE id=? AND active=1').get(user_id))
    throw err('Esa persona no existe o está desactivada.', 404);
  const r = db.prepare(
    `INSERT INTO crm_tareas (client_id, opportunity_id, titulo, detalle, fecha, user_id, created_by)
     VALUES (?,?,?,?,?,?,?)`
  ).run(client_id, opportunity_id || null, t, String(detalle || ''), fecha, user_id || null, created_by || null);
  return { id: Number(r.lastInsertRowid), client_id, fecha, titulo: t };
}

export function getTarea(db, id) {
  try {
    return db.prepare(
      `SELECT t.*, c.name AS cliente, u.name AS responsable, o.title AS oportunidad
         FROM crm_tareas t LEFT JOIN clients c ON c.id=t.client_id
              LEFT JOIN admin_users u ON u.id=t.user_id
              LEFT JOIN opportunities o ON o.id=t.opportunity_id
        WHERE t.id=?`).get(id) || null;
  } catch { return null; }
}

// HECHA: se apunta el resultado. Un seguimiento sin resultado no sirve para el siguiente.
export function marcarHecha(db, id, { resultado = '', por = null } = {}) {
  const t = getTarea(db, id);
  if (!t) throw err('Esa tarea no existe.', 404);
  if (t.estado !== 'pendiente') throw err('Esa tarea ya está ' + t.estado + '.');
  db.prepare(`UPDATE crm_tareas SET estado='hecha', hecha_at=datetime('now'), hecha_por=?, resultado=? WHERE id=?`)
    .run(por || null, String(resultado || ''), id);
  return { id: Number(id), estado: 'hecha' };
}
// ANULAR NO ES BORRAR: la tarea se queda, con su motivo. Saber qué se decidió NO hacer también vale.
export function anularTarea(db, id, motivo) {
  const t = getTarea(db, id);
  if (!t) throw err('Esa tarea no existe.', 404);
  const m = String(motivo || '').trim();
  if (m.length < 3) throw err('Di por qué se anula.');
  db.prepare(`UPDATE crm_tareas SET estado='anulada', motivo=? WHERE id=?`).run(m, id);
  return { id: Number(id), estado: 'anulada' };
}
// Reprogramar: cambiar la fecha es normal en un seguimiento, y no es una anulación.
export function reprogramar(db, id, fecha) {
  const t = getTarea(db, id);
  if (!t) throw err('Esa tarea no existe.', 404);
  if (t.estado !== 'pendiente') throw err('Solo se reprograma una tarea pendiente.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) throw err('Dame una fecha válida.');
  db.prepare('UPDATE crm_tareas SET fecha=? WHERE id=?').run(fecha, id);
  return { id: Number(id), fecha };
}

// LA LISTA. `de` filtra por dueño; `hasta` trae también las de más adelante. Vencidas primero, que
// es el orden en que hay que mirarlas.
export function listarTareas(db, { estado = 'pendiente', userId = null, clientId = null,
                                   hasta = null, hoy = null } = {}) {
  const t = hoy || hoyLocal();
  const w = [], p = [];
  if (estado) { w.push('t.estado=?'); p.push(estado); }
  if (userId) { w.push('t.user_id=?'); p.push(userId); }
  if (clientId) { w.push('t.client_id=?'); p.push(clientId); }
  if (hasta) { w.push('t.fecha<=?'); p.push(hasta); }
  let filas = [];
  try {
    filas = db.prepare(
      `SELECT t.*, c.name AS cliente, u.name AS responsable, o.title AS oportunidad
         FROM crm_tareas t LEFT JOIN clients c ON c.id=t.client_id
              LEFT JOIN admin_users u ON u.id=t.user_id
              LEFT JOIN opportunities o ON o.id=t.opportunity_id
        ${w.length ? 'WHERE ' + w.join(' AND ') : ''}
        ORDER BY t.fecha, t.id`).all(...p);
  } catch { return []; }
  return filas.map(f => ({ ...f, retraso: Math.max(0, diasEntre(f.fecha, t)), vencida: f.fecha < t, hoy: f.fecha === t }));
}

// PARA LA LÍNEA DE TIEMPO DEL CLIENTE. Devuelve la forma que la ficha ya sabe pintar (tipo, fecha,
// texto), para no inventar un segundo formato de evento.
export function tareasDeCliente(db, clientId, { incluirHechas = true } = {}) {
  const ts = listarTareas(db, { estado: null, clientId });
  return ts.filter(t => incluirHechas || t.estado === 'pendiente').map(t => ({
    tipo: 'tarea',
    fecha: t.estado === 'hecha' && t.hecha_at ? String(t.hecha_at).slice(0, 10) : t.fecha,
    estado: t.estado,
    titulo: t.titulo,
    texto: t.titulo + (t.responsable ? ' · ' + t.responsable : '')
      + (t.estado === 'pendiente' ? (t.vencida ? ' · VENCIDA hace ' + t.retraso + ' día(s)' : ' · para el ' + t.fecha)
         : (t.estado === 'hecha' ? ' · hecha' + (t.resultado ? ': ' + t.resultado : '') : ' · anulada: ' + (t.motivo || ''))),
    ref: { tarea_id: t.id, opportunity_id: t.opportunity_id || null },
  }));
}

// ── LA FUENTE DE AVISOS ─────────────────────────────────────────────────────────────────────────
// Se registra en `avisos.js` y con eso sale en la campana, en /admin/avisos, en el Inicio y en el
// correo diario. CERO mensajería nueva: es exactamente lo que pedía el encargo con «y aviso».
export function tareasCrmVencidas(db, today) {
  const t = today || hoyLocal();
  const ts = listarTareas(db, { estado: 'pendiente', hasta: t, hoy: t });
  return ts.map(x => ({
    tipo: 'tarea_crm',
    // Por debajo del dinero vencido (1000+) y a la altura del cliente en riesgo (300): una tarea
    // comercial importa, pero no puede tapar una factura sin cobrar. El retraso ordena DENTRO.
    urgencia: 300 + Math.min(x.retraso, 99),
    titulo: (x.cliente || 'Cliente') + ' · ' + x.titulo,
    detalle: x.vencida ? ('Se te pasó hace ' + x.retraso + ' día(s)' + (x.responsable ? ' · es de ' + x.responsable : ''))
                       : ('Es para hoy' + (x.responsable ? ' · es de ' + x.responsable : '')),
    ref: { source: 'tareas_crm', tarea_id: x.id, client_id: x.client_id, client_name: x.cliente,
           opportunity_id: x.opportunity_id || null, fecha: x.fecha, retraso: x.retraso,
           responsable: x.responsable || null },
  }));
}
