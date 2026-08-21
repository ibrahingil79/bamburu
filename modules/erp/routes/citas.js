// CITAS — Escalera · paso 7 (servicios profesionales) · PIEZA 5: SISTEMA DE CITAS (motor + agenda interna).
// UN solo motor para dos negocios (cita previa y servicios por horas). Espejo del patrón de proyectos:
// servicios validados compartidos, `requirePerm` en TODAS las rutas (incluidas las VISTAS), `citas` y
// compañía FUERA de WRITABLE_TABLES. La salida al dinero REUTILIZA createInvoice/emitTicketSvc y el
// registro de tiempo de la pieza 2 (createEntry): CERO camino nuevo de emisión, cero hash propio.
// El enlace público de la cita va por LLAVE (token), no por sesión (ver createCitasPublicRoutes).
import { Hono } from 'hono';
import { randomBytes } from 'crypto';
import { safeError } from '../../../core/errors.js';
import { adminLayout, can } from '../layout.js';
import { logActivity, requirePerm } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { escHtml, jsonForScript } from '../../../core/escape.js';
import { nextCode } from '../codes.js';
import { ENTITY } from '../../../core/activity-entities.js';
import { resolveVatRate } from '../../../core/vat-bands.js';
import {
  citaSchema, citaMoverSchema, citaEstadoSchema, citaAtenderSchema, bloqueoSchema,
  recursoSchema, serviceConfigSchema, serviceCreateSchema, horarioSchema, excepcionSchema, avisoMarcarSchema, citaAjustesSchema,
} from '../schemas.js';
import {
  geometriaCadena, comprobarSolape, huecos, ahoraLocal, hhmm, dowDeFecha, diasEntre,
  ESTADO_LABEL, puedeTransicionar, tramosPersona, tramosAmbito, ocupacionRecurso, overlaps,
  ocupacionPersona, resta, hayHorarioNegocio, DEFAULT_OPEN,
} from '../citas-engine.js';
import {
  contactoDeCita, serviciosDeCita, textoAviso, waLink, smsLink, citaBaseUrl, citaEnlace,
  enviarEmailCita, registrarAviso, avisoHecho, colaEnvios, normalizeMovil,
} from '../citas-avisos.js';
import { createInvoice, emitTicketSvc, anularInvoice } from './invoices.js';
import { createProductSvc } from './products.js';   // "Nuevo servicio" nace como producto de catálogo (fuente única)
import { createEntry } from './tiempo.js';
import { sendEmail } from '../../../core/mailer.js';
import { rateLimit } from '../../../core/rate-limit.js';
// PIEZA 6 — SOLO el módulo HOJA de la puerta pública (config + reglas de ventana + a quién se enseña).
// No se importa reserva-publica.js: ese sí depende de este fichero y cerraría el círculo.
import { reservaDeCita, ventanaCliente, personasPublicas, autoEncenderReservas } from '../reserva-publica-config.js';
// PASO 8 — PERFIL DE OFICIO. Otro módulo HOJA (solo `db`), por la misma razón que el de arriba: layout.js
// también lo importa para el menú, y si el diccionario viviera aquí se cerraría el círculo.
import { vocabulario } from '../oficios.js';
import { contactoDeCita as apuntarContactoDeCita } from '../contactos.js';   // D2: rastro en el registro
// (alias a propósito: `contactoDeCita` ya existe aquí y significa el teléfono/correo del cliente)

const genToken = () => randomBytes(32).toString('base64url');
const err = (msg, status) => { const e = new Error(msg); e.status = status; return e; };

// ── Ajustes de citas del negocio (company_config), con defaults seguros ────────────────────────────
export function ajustesCitas(db) {
  const cfg = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
  // Las PALABRAS no se resuelven aquí: salen de vocabulario(), el único sitio que las decide (lo llama
  // también layout.js para el menú). Antes esta función leía cita_puesto_* por su cuenta y layout.js
  // repetía la consulta; con un diccionario por oficio eso habría acabado diciendo dos cosas distintas.
  const voz = vocabulario(db);
  return {
    grid: cfg.cita_grid_min || 30,
    antelacion_min: cfg.cita_antelacion_min || 0,
    ventana_dias: cfg.cita_ventana_dias || 60,
    corte_mismo_dia_min: cfg.cita_corte_mismo_dia_min == null ? null : cfg.cita_corte_mismo_dia_min,
    margen_defecto_min: cfg.cita_margen_defecto_min || 0,
    canal_defecto: cfg.cita_canal_defecto || 'whatsapp',
    modo_recordatorio: cfg.cita_modo_recordatorio || 'manual',
    currency_symbol: cfg.currency_symbol || '€',
    company_name: cfg.company_name || 'tu negocio',
    country: (cfg.country || 'ES').toUpperCase(),
    address: cfg.address || '',
    email: cfg.email || '',
    puesto_sing: voz.puesto_sing,
    puesto_plural: voz.puesto_plural,
    // PASO 8 — el resto del diccionario del oficio, para las pantallas de la agenda.
    oficio: voz.oficio,
    oficio_label: voz.oficio_label,
    cliente_sing: voz.cliente_sing,
    cliente_plural: voz.cliente_plural,
    usa_proyectos: voz.usa_proyectos,
  };
}

// ── LA REJILLA: DE QUÉ HORA A QUÉ HORA SE PINTA ───────────────────────────────────────────────────
// Antes estaba CLAVADA de 08:00 a 21:00 en el dibujo del cliente. El motor sí sabía el horario real,
// así que un negocio que abre a las 7:00 tenía huecos reservables que la pantalla NO enseñaba: se
// podía reservar por la puerta pública a una hora que dentro no existía. Ahora se deriva del horario
// del negocio en el rango que se está mirando, redondeado a la hora, con un margen de cortesía; sin
// horario configurado sale DEFAULT_OPEN, que es exactamente lo que se veía antes.
export function rangoRejilla(db, fechas) {
  let ini = null, fin = null;
  for (const f of fechas) {
    for (const [a, b] of tramosAmbito(db, 'negocio', null, f)) {
      if (ini == null || a < ini) ini = a;
      if (fin == null || b > fin) fin = b;
    }
  }
  if (ini == null || fin == null) return { ini: DEFAULT_OPEN[0], fin: DEFAULT_OPEN[1] };
  ini = Math.max(0, Math.floor(ini / 60) * 60);
  fin = Math.min(24 * 60, Math.ceil(fin / 60) * 60);
  if (fin - ini < 120) fin = Math.min(24 * 60, ini + 120);   // nunca una rejilla de un palmo
  return { ini, fin };
}

// ── Servicios reservables: resuelve los service_config de una lista de ids (en orden) ──────────────
export function resolveServiceConfigs(db, ids, margenDefecto = 0) {
  const get = db.prepare(
    `SELECT p.id AS product_id, p.name, p.price, p.tax_band, p.tax_rate, p.type, p.status,
            sc.reservable, sc.duracion_min, sc.muerto_ini_min, sc.muerto_dur_min, sc.margen_min
       FROM products p LEFT JOIN service_config sc ON sc.product_id = p.id WHERE p.id=?`
  );
  const out = [];
  for (const id of ids) {
    const p = get.get(id);
    if (!p) throw err('Servicio no encontrado (id ' + id + ')', 400);
    if (p.type !== 'service') throw err('El producto «' + (p.name || id) + '» no es un servicio', 400);
    if (p.reservable == null || !p.reservable) throw err('El servicio «' + (p.name || id) + '» no está configurado como reservable', 400);
    out.push({
      product_id: p.product_id, nombre: p.name, price: p.price, tax_band: p.tax_band, tax_rate: p.tax_rate,
      duracion_min: p.duracion_min, muerto_ini_min: p.muerto_ini_min, muerto_dur_min: p.muerto_dur_min,
      margen_min: p.margen_min || margenDefecto,
    });
  }
  return out;
}

// Líneas de cobro a partir de los servicios de una cita. Para FACTURA (createInvoice): concepto +
// importe + IVA resuelto de la banda del catálogo (fuente única). Para TICKET (emitTicketSvc): basta
// el product_id (el motor lee precio e IVA del producto, como el TPV).
function lineasFactura(db, citaId, country) {
  const rows = db.prepare(
    `SELECT cs.product_id, p.name, p.price, p.tax_band, p.tax_rate FROM cita_servicios cs
       LEFT JOIN products p ON p.id = cs.product_id WHERE cs.cita_id=? ORDER BY cs.orden, cs.id`
  ).all(citaId);
  return rows.map(r => ({
    description: r.name || 'Servicio',
    quantity: 1,
    unit_price: Number(r.price) || 0,
    tax_rate: resolveVatRate(country, r.tax_band, Number(r.tax_rate) || 0).rate,
    product_id: r.product_id,
  }));
}
function lineasTicket(db, citaId) {
  return db.prepare('SELECT product_id FROM cita_servicios WHERE cita_id=? ORDER BY orden, id').all(citaId)
    .map(r => ({ product_id: r.product_id, quantity: 1 }));
}

// AGENDA SENCILLA — personas que TRABAJAN una fecha (su horario tiene algún tramo ese día). Con el
// "día abierto por defecto" (negocio sin horario configurado), todas trabajan hasta que se configuren
// horarios. Se usa para que la vista de entrada no muestre columnas de quien libra.
export function personasQueTrabajan(db, fecha) {
  return db.prepare("SELECT id, name FROM admin_users WHERE active=1 ORDER BY name").all()
    .filter(u => tramosPersona(db, u.id, fecha).length > 0);
}

// Puestos que EXIGEN los servicios elegidos (unión de service_resources). Vacío = no exigen ninguno.
function puestosRequeridos(db, ids) {
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  return db.prepare(`SELECT DISTINCT recurso_id FROM service_resources WHERE product_id IN (${ph})`).all(...ids).map(r => r.recurso_id);
}
// Primer puesto LIBRE de entre los requeridos, para esa franja. null si se exige puesto pero ninguno libre.
function puestoLibre(db, { fecha, inicio_min, dur_min, margen_min = 0, req_ids, excludeCitaId = null }) {
  const fin = inicio_min + dur_min + margen_min;
  for (const rid of req_ids) {
    const rc = db.prepare('SELECT id, nombre FROM recursos WHERE id=? AND active=1').get(rid);
    if (!rc) continue;
    const choca = ocupacionRecurso(db, rid, fecha, excludeCitaId).some(([oi, of]) => overlaps(inicio_min, fin, oi, of));
    if (!choca) return rc;
  }
  return null;
}
// Pocos huecos CERCANOS a una hora pedida (para proponer alternativas cuando algo choca).
function huecosCercanos(db, input, cuantos = 4) {
  try {
    const r = citaSchema.safeParse(input); if (!r.success) return [];
    const d = r.data; if (!d.service_ids.length || !d.user_id) return [];
    const aj = ajustesCitas(db);
    const geo = geometriaCadena(resolveServiceConfigs(db, d.service_ids, aj.margen_defecto_min));
    const hs = huecos(db, { fecha: d.fecha, user_id: d.user_id, recurso_id: d.recurso_id || null, dur_min: geo.dur_total, margen_min: geo.margen_min, grid: aj.grid, antelacion_min: aj.antelacion_min, ventana_dias: aj.ventana_dias, corte_mismo_dia_min: aj.corte_mismo_dia_min, ahora: ahoraLocal() });
    return hs.map(m => ({ min: m, hora: hhmm(m), dist: Math.abs(m - d.inicio_min) }))
      .sort((a, b) => a.dist - b.dist).slice(0, cuantos).sort((a, b) => a.min - b.min).map(({ min, hora }) => ({ min, hora }));
  } catch { return []; }
}

// ── SERVICIOS VALIDADOS COMPARTIDOS (única fuente de verdad de escritura) ──────────────────────────
export function createCitaSvc(db, input, ctx = {}) {
  const r = citaSchema.safeParse(input);
  if (!r.success) throw err(r.error.issues.map(i => i.path.join('.') + ': ' + i.message).join('; '), 400);
  const d = r.data;
  if (!d.cliente_id && !d.cliente_suelto_nombre) throw err('Indica un cliente de la ficha o un nombre de cliente suelto', 400);
  const usr = db.prepare('SELECT id FROM admin_users WHERE id=? AND active=1').get(d.user_id);
  if (!usr) throw err('La persona no existe o está inactiva', 400);
  if (d.recurso_id) { const rc = db.prepare('SELECT id FROM recursos WHERE id=? AND active=1').get(d.recurso_id); if (!rc) throw err('El recurso no existe', 400); }
  if (!d.service_ids.length) throw err('Una cita necesita al menos un servicio', 400);

  const aj = ajustesCitas(db);
  const configs = resolveServiceConfigs(db, d.service_ids, aj.margen_defecto_min);
  const geo = geometriaCadena(configs);
  // El puesto se asigna SOLO si el servicio lo exige y no se eligió uno: el primero libre (3.5).
  let recurso_id = d.recurso_id || null;
  if (!recurso_id) {
    const req = puestosRequeridos(db, d.service_ids);
    if (req.length) {
      const libre = puestoLibre(db, { fecha: d.fecha, inicio_min: d.inicio_min, dur_min: geo.dur_total, margen_min: geo.margen_min, req_ids: req });
      if (!libre) throw err('No hay ningún ' + aj.puesto_sing.toLowerCase() + ' libre a esa hora para este servicio', 409);
      recurso_id = libre.id;
    }
  }
  const sol = comprobarSolape(db, {
    user_id: d.user_id, recurso_id, fecha: d.fecha, inicio_min: d.inicio_min,
    dur_min: geo.dur_total, margen_min: geo.margen_min, servicios: geo.servicios,
  });
  if (!sol.ok) throw err(sol.motivo, 409);

  const token = genToken();
  const tokenExpira = Math.floor(Date.parse(d.fecha + 'T23:59:59Z') / 1000) + 86400;   // fin del día de la cita (aprox; la guarda real es por fecha)
  const codigo = nextCode(db, 'cita');
  const movil = d.cliente_suelto_movil ? normalizeMovil(d.cliente_suelto_movil).e164 : '';

  const run = db.transaction(() => {
    const res = db.prepare(
      `INSERT INTO citas (codigo,cliente_id,cliente_suelto_nombre,cliente_suelto_movil,user_id,recurso_id,fecha,inicio_min,dur_min,margen_min,estado,nota,project_id,token,token_expira,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(codigo, d.cliente_id || null, d.cliente_suelto_nombre || '', movil, d.user_id, recurso_id,
          d.fecha, d.inicio_min, geo.dur_total, geo.margen_min, d.estado || 'pedida', d.nota || '', d.project_id || null,
          token, tokenExpira, ctx.created_by || null);
    const citaId = res.lastInsertRowid;
    const ins = db.prepare('INSERT INTO cita_servicios (cita_id,product_id,orden,offset_min,dur_min,muerto_ini_min,muerto_dur_min) VALUES (?,?,?,?,?,?,?)');
    geo.servicios.forEach((s, i) => ins.run(citaId, s.product_id, i, s.offset_min, s.dur_min, s.muerto_ini_min, s.muerto_dur_min));
    return citaId;
  });
  const id = run();
  return { id: Number(id), codigo, token };
}

// Editar una cita: mismos datos que crear (puede cambiar servicios → recalcula geometría). Conserva
// código, token y estado. Revalida el solape excluyéndose a sí misma.
export function editCitaSvc(db, id, input) {
  const cita = db.prepare('SELECT * FROM citas WHERE id=?').get(id);
  if (!cita) throw err('Cita no encontrada', 404);
  if (cita.estado === 'anulada') throw err('Una cita anulada no se edita', 400);
  const r = citaSchema.safeParse(input);
  if (!r.success) throw err(r.error.issues.map(i => i.path.join('.') + ': ' + i.message).join('; '), 400);
  const d = r.data;
  if (!d.service_ids.length) throw err('Una cita necesita al menos un servicio', 400);
  const aj = ajustesCitas(db);
  const configs = resolveServiceConfigs(db, d.service_ids, aj.margen_defecto_min);
  const geo = geometriaCadena(configs);
  const sol = comprobarSolape(db, {
    user_id: d.user_id, recurso_id: d.recurso_id || null, fecha: d.fecha, inicio_min: d.inicio_min,
    dur_min: geo.dur_total, margen_min: geo.margen_min, servicios: geo.servicios, excludeCitaId: id,
  });
  if (!sol.ok) throw err(sol.motivo, 409);
  const movil = d.cliente_suelto_movil ? normalizeMovil(d.cliente_suelto_movil).e164 : '';
  db.transaction(() => {
    db.prepare(
      `UPDATE citas SET cliente_id=?,cliente_suelto_nombre=?,cliente_suelto_movil=?,user_id=?,recurso_id=?,fecha=?,inicio_min=?,dur_min=?,margen_min=?,nota=?,project_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).run(d.cliente_id || null, d.cliente_suelto_nombre || '', movil, d.user_id, d.recurso_id || null, d.fecha, d.inicio_min,
          geo.dur_total, geo.margen_min, d.nota || '', d.project_id || null, id);
    db.prepare('DELETE FROM cita_servicios WHERE cita_id=?').run(id);
    const ins = db.prepare('INSERT INTO cita_servicios (cita_id,product_id,orden,offset_min,dur_min,muerto_ini_min,muerto_dur_min) VALUES (?,?,?,?,?,?,?)');
    geo.servicios.forEach((s, i) => ins.run(id, s.product_id, i, s.offset_min, s.dur_min, s.muerto_ini_min, s.muerto_dur_min));
  })();
  return { id: Number(id) };
}

// Mover (arrastrar): nueva fecha/hora y opcionalmente persona/recurso. Conserva servicios y geometría.
export function moverCitaSvc(db, id, input) {
  const cita = db.prepare('SELECT * FROM citas WHERE id=?').get(id);
  if (!cita) throw err('Cita no encontrada', 404);
  if (['anulada', 'atendida'].includes(cita.estado)) throw err('Esta cita ya no se puede mover', 400);
  const r = citaMoverSchema.safeParse(input);
  if (!r.success) throw err(r.error.issues.map(i => i.path.join('.') + ': ' + i.message).join('; '), 400);
  const d = r.data;
  const user_id = d.user_id || cita.user_id;
  const recurso_id = d.recurso_id === undefined ? cita.recurso_id : (d.recurso_id || null);
  const servicios = db.prepare('SELECT offset_min,dur_min,muerto_ini_min,muerto_dur_min FROM cita_servicios WHERE cita_id=? ORDER BY orden,id').all(id);

  // ── ESTIRAR POR EL BORDE (Tarea 2 · cabo 2) ───────────────────────────────────────────────────
  // Mismo gesto y mismo camino de guardado que arrastrar: es el dueño moviendo su cita en el lienzo,
  // solo que por abajo. Por eso vive aquí y no en un endpoint nuevo.
  //
  // Y AQUÍ NO SE COMPRUEBA EL SOLAPE, A PROPÓSITO. Mover una cita ENCIMA de otra sigue dando 409:
  // eso es un error del que arrastra. Pero alargar la suya hasta pisar la siguiente es una decisión
  // legítima del dueño —«hoy este corte me va a llevar más»— y bloquearla sería que el programa le
  // discuta su propia agenda. El lienzo las pinta lado a lado (cabo 1), así que la cita pisada no
  // desaparece: se ve. Decisión de producto del encargo, escrita aquí para que no se «arregle» sola.
  //
  // La duración se ajusta a la MISMA rejilla que ya usa la agenda (ajustesCitas().grid) y no baja
  // de un paso de esa rejilla: no hay número nuevo que inventar, y una cita de cero minutos no es
  // una cita.
  if (d.dur_min !== undefined) {
    const grid = Math.max(5, ajustesCitas(db).grid || 30);
    const dur = Math.max(grid, Math.round(d.dur_min / grid) * grid);
    db.prepare('UPDATE citas SET dur_min=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(dur, id);
    return { id: Number(id), dur_min: dur };
  }
  const sol = comprobarSolape(db, {
    user_id, recurso_id, fecha: d.fecha, inicio_min: d.inicio_min,
    dur_min: cita.dur_min, margen_min: cita.margen_min, servicios, excludeCitaId: id,
  });
  if (!sol.ok) throw err(sol.motivo, 409);
  db.prepare('UPDATE citas SET fecha=?,inicio_min=?,user_id=?,recurso_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(d.fecha, d.inicio_min, user_id, recurso_id, id);
  return { id: Number(id) };
}

// ── QUIÉN ANULA ─────────────────────────────────────────────────────────────────────────────────
// Tres valores y ni uno más. Cada camino de anulación dice el suyo; el que no puede saberlo (una
// caducidad automática) dice 'automatico', que es la verdad y no un hueco. Lo que NUNCA se hace es
// dejar que el dato se rellene solo con un valor por defecto: una anulación sin autor conocido se
// queda en NULL y la pantalla dice «sin registrar».
export const ANULADA_POR = ['cliente', 'negocio', 'automatico'];
const quienValido = q => (ANULADA_POR.includes(q) ? q : null);

export function cambiarEstadoSvc(db, id, estado, quien = null) {
  const cita = db.prepare('SELECT * FROM citas WHERE id=?').get(id);
  if (!cita) throw err('Cita no encontrada', 404);
  if (!puedeTransicionar(cita.estado, estado)) throw err('No se puede pasar de «' + cita.estado + '» a «' + estado + '»', 400);
  const stamp = estado === 'confirmada' ? 'confirmada_at' : (estado === 'atendida' ? 'atendida_at' : (estado === 'anulada' ? 'anulada_at' : null));
  // El QUIÉN solo se escribe al anular: en cualquier otro cambio de estado no significa nada.
  const porSql = estado === 'anulada' ? 'anulada_por=?,' : '';
  const args = estado === 'anulada' ? [estado, quienValido(quien), id] : [estado, id];
  db.prepare(`UPDATE citas SET estado=?, ${porSql}${stamp ? stamp + '=CURRENT_TIMESTAMP,' : ''} updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...args);
  // D2 — atendida, anulada o plantón dejan rastro en el registro de contactos. Solo la ATENDIDA es
  // visita (D4): un plantón es que NO vino, y contarlo como visita mentiría al detector. En su propio
  // try y sin lanzar: el registro no puede impedir que una cita cambie de estado.
  if (['atendida', 'anulada', 'no_show'].includes(estado)) {
    try { apuntarContactoDeCita(db, { ...cita, estado }); } catch {}
  }
  return { id: Number(id), estado };
}

// Atender: marca la cita como atendida y, si se pide, COBRA reutilizando los motores existentes y/o
// genera la entrada de tiempo de la pieza 2 (si la cita cuelga de un proyecto). NO nace emisión nueva.
export function atenderCitaSvc(db, id, opts, ctx = {}) {
  const cita = db.prepare('SELECT * FROM citas WHERE id=?').get(id);
  if (!cita) throw err('Cita no encontrada', 404);
  if (!puedeTransicionar(cita.estado, 'atendida')) throw err('Esta cita no se puede marcar como atendida', 400);
  const o = citaAtenderSchema.parse(opts || {});
  const aj = ajustesCitas(db);
  let invoice_id = null, time_entry_id = null;

  const run = db.transaction(() => {
    cambiarEstadoSvc(db, id, 'atendida');
    if (o.cobrar) {
      let via = o.via;
      if (o.payment_method === 'transferencia') via = 'factura';   // el ticket solo es efectivo/tarjeta
      if (via === 'factura') {
        if (!cita.cliente_id) throw err('Para emitir una factura completa la cita necesita un cliente de la ficha (para un cliente suelto usa el ticket)', 400);
        const inv = createInvoice(db, { client_id: cita.cliente_id, lines: lineasFactura(db, id, aj.country), tipo_factura: 'F1', notes: 'Cita ' + cita.codigo });
        invoice_id = inv.id;
        if (cita.project_id) db.prepare('UPDATE invoices SET project_id=? WHERE id=?').run(cita.project_id, invoice_id);
      } else {
        const pm = o.payment_method === 'tarjeta' ? 'tarjeta' : 'efectivo';
        const t = emitTicketSvc(db, { lines: lineasTicket(db, id), payment_method: pm, emitted_by: ctx.emitted_by || null });
        invoice_id = t.id;
      }
      db.prepare('UPDATE citas SET invoice_id=? WHERE id=?').run(invoice_id, id);
    }
    if (o.registrar_tiempo && cita.project_id) {
      // Si además se cobró, la entrada NO es facturable (ya se cobró): evita doble facturación.
      const e = createEntry(db, cita.user_id, {
        proyecto_id: cita.project_id, fecha: cita.fecha, horas: Math.floor(cita.dur_min / 60), minutos: cita.dur_min % 60,
        facturable: !o.cobrar, descripcion: 'Cita ' + cita.codigo,
      });
      time_entry_id = e.id;
      db.prepare('UPDATE citas SET time_entry_id=? WHERE id=?').run(time_entry_id, id);
    }
    return true;
  });
  run();
  return { id: Number(id), invoice_id, time_entry_id };
}

// Anular: revierte el cobro por SU motor (anularInvoice → NETO-CERO) y suelta la entrada de tiempo.
// Archivar-no-borrar: la fila queda como 'anulada'. Idempotente.
export function anularCitaSvc(db, id, motivo = 'Cita anulada', quien = null) {
  const cita = db.prepare('SELECT * FROM citas WHERE id=?').get(id);
  if (!cita) throw err('Cita no encontrada', 404);
  if (cita.estado === 'anulada') return { id: Number(id), estado: 'anulada' };
  db.transaction(() => {
    if (cita.invoice_id) {
      const inv = db.prepare('SELECT id FROM invoices WHERE id=?').get(cita.invoice_id);
      const yaAnulada = db.prepare('SELECT 1 FROM invoice_anulaciones WHERE invoice_id=?').get(cita.invoice_id);
      if (inv && !yaAnulada) anularInvoice(db, cita.invoice_id, motivo);
    }
    if (cita.time_entry_id) db.prepare('UPDATE time_entries SET active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(cita.time_entry_id);
    db.prepare("UPDATE citas SET estado='anulada', anulada_at=CURRENT_TIMESTAMP, anulada_por=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(quienValido(quien), id);
  })();
  return { id: Number(id), estado: 'anulada', anulada_por: quienValido(quien) };
}

// ── Datos de la agenda (para la vista día/semana, por persona o por recurso) ───────────────────────
// `cliente_id` OPCIONAL (Tarea 2 · cabo 5): sin él, todo sigue exactamente igual — lo que importa,
// porque de esta función come también el bloque «Hoy» del Inicio. Con él, la agenda enseña solo las
// citas de esa persona, que es lo que se pide desde su ficha.
export function agendaData(db, { desde, hasta, cliente_id = null, soloUsuario = null }) {
  // `soloUsuario` = el candado de «cada uno ve lo suyo» (permiso citas.ver_todas, 21 ago 2026).
  // Se filtra EN EL SQL, no al pintar: lo que no se puede ver no sale de la base, así que no puede
  // colarse ni en una respuesta ni en un correo ni en un artifact de DISA. Por defecto es null —no
  // filtra— para que ninguna llamada de las que ya existían cambie sola: quien llama decide, y esa
  // decisión se ve en el diff.
  const filtro = (cliente_id ? ' AND c.cliente_id=?' : '') + (soloUsuario ? ' AND c.user_id=?' : '');
  const args = [desde, hasta];
  if (cliente_id) args.push(cliente_id);
  if (soloUsuario) args.push(soloUsuario);
  const citas = db.prepare(
    `SELECT c.*, u.name AS persona, r.nombre AS recurso, cl.name AS cliente_nombre
       FROM citas c LEFT JOIN admin_users u ON u.id=c.user_id LEFT JOIN recursos r ON r.id=c.recurso_id
       LEFT JOIN clients cl ON cl.id=c.cliente_id
      WHERE c.fecha>=? AND c.fecha<=? AND c.archived=0 AND c.estado<>'anulada'${filtro} ORDER BY c.fecha, c.inicio_min`
  ).all(...args).map(c => {
    // Ventanas de ESPERA (la persona libre) relativas al inicio de la cita, para pintarlas en otro tono.
    const svcs = db.prepare('SELECT offset_min, muerto_ini_min, muerto_dur_min FROM cita_servicios WHERE cita_id=?').all(c.id);
    const espera = [];
    for (const s of svcs) if (s.muerto_dur_min > 0) { const ini = s.offset_min + s.muerto_ini_min; espera.push({ ini, fin: ini + s.muerto_dur_min }); }
    return {
      id: c.id, codigo: c.codigo, fecha: c.fecha, inicio_min: c.inicio_min, dur_min: c.dur_min, margen_min: c.margen_min,
      estado: c.estado, user_id: c.user_id, recurso_id: c.recurso_id, persona: c.persona || '—',
      recurso: c.recurso || null, cliente: c.cliente_nombre || c.cliente_suelto_nombre || 'Cliente',
      servicios: serviciosDeCita(db, c.id).join(' + '), espera,
    };
  });
  const bloqueos = db.prepare(
    `SELECT * FROM agenda_bloqueos WHERE fecha>=? AND fecha<=? ORDER BY fecha, inicio_min`
  ).all(desde, hasta);
  return { citas, bloqueos };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// RUTAS DEL PANEL (API + VISTAS), todo con candado citas.read / citas.edit
// ════════════════════════════════════════════════════════════════════════════════════════════════
export function createCitasRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  // ── Catálogos auxiliares para los <select> ────────────────────────────────
  api.get('/meta', requirePerm('citas.read'), c => {
    try {
      const personas = db.prepare("SELECT id, name FROM admin_users WHERE active=1 ORDER BY name").all();
      const recursos = db.prepare("SELECT id, nombre, tipo FROM recursos WHERE active=1 ORDER BY nombre").all();
      const servicios = db.prepare(
        `SELECT p.id, p.name, sc.duracion_min, sc.margen_min FROM products p
           JOIN service_config sc ON sc.product_id=p.id
          WHERE p.type='service' AND sc.reservable=1 AND (p.status IS NULL OR p.status<>'archived') ORDER BY p.name`
      ).all();
      const proyectos = db.prepare("SELECT id, codigo, nombre FROM proyectos WHERE active=1 AND estado='abierto' ORDER BY id DESC").all();
      const clientes = db.prepare("SELECT id, name FROM clients WHERE active=1 ORDER BY name LIMIT 1000").all();
      return c.json({ personas, recursos, servicios, proyectos, clientes, ajustes: ajustesCitas(db) });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // ── Huecos EN VIVO ────────────────────────────────────────────────────────
  api.get('/huecos', requirePerm('citas.read'), c => {
    try {
      const fecha = c.req.query('fecha');
      const user_id = parseInt(c.req.query('user_id'));
      const recurso_id = c.req.query('recurso_id') ? parseInt(c.req.query('recurso_id')) : null;
      const ids = (c.req.query('service_ids') || '').split(',').map(x => parseInt(x)).filter(Boolean);
      if (!fecha || !user_id || !ids.length) return c.json({ huecos: [] });
      const aj = ajustesCitas(db);
      const configs = resolveServiceConfigs(db, ids, aj.margen_defecto_min);
      const geo = geometriaCadena(configs);
      const hs = huecos(db, {
        fecha, user_id, recurso_id, dur_min: geo.dur_total, margen_min: geo.margen_min, grid: aj.grid,
        antelacion_min: aj.antelacion_min, ventana_dias: aj.ventana_dias, corte_mismo_dia_min: aj.corte_mismo_dia_min,
        ahora: ahoraLocal(),
      });
      return c.json({ huecos: hs.map(m => ({ min: m, hora: hhmm(m) })), dur_total: geo.dur_total, margen: geo.margen_min });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // ── Agenda (día/semana) ───────────────────────────────────────────────────
  api.get('/agenda', requirePerm('citas.read'), c => {
    try {
      const desde = c.req.query('desde') || ahoraLocal().fecha;
      const hasta = c.req.query('hasta') || desde;
      // CABO 5 · filtro por cliente. Viaja el NOMBRE además del id para que la pantalla pueda pintar
      // el chip sin una segunda llamada; si el id no existe, no se filtra y se dice (cliente: null).
      const cliId = parseInt(c.req.query('cliente'), 10) || null;
      const cliente = cliId ? (db.prepare('SELECT id, name FROM clients WHERE id=?').get(cliId) || null) : null;
      // personasDia = quién trabaja el día `desde` (para la vista de entrada; el frente decide si filtra).
      // MISMO CANDADO QUE EL MES: sin `citas.ver_todas`, solo lo suyo. Y las COLUMNAS también: una
      // columna con el nombre de un compañero, aunque saliera vacía, ya dice quién trabaja hoy.
      const verTodasAg = can(c, 'citas.ver_todas');
      const yoAg = c.get('session')?.userId;
      const personasDia = personasQueTrabajan(db, desde)
        .filter(p => verTodasAg || String(p.id) === String(yoAg))
        .map(p => ({ id: p.id, name: p.name }));
      // `rango` = de qué hora a qué hora tiene sentido dibujar (ver rangoRejilla).
      // `sin_horario` = el negocio no ha configurado ninguno y está con el día abierto por defecto.
      // NO es un error ni un bloqueo: puede crear citas ya. La pantalla lo dice, no lo esconde.
      const fechas = [];
      for (let f = desde; f <= hasta; f = new Date(Date.parse(f + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)) {
        fechas.push(f);
        if (fechas.length > 40) break;
      }
      // `tramos` = a qué horas se trabaja de verdad cada día, para ATENUAR lo de fuera. Sale de las
      // mismas funciones del motor que ya usa todo lo demás (tramosAmbito / tramosPersona): no hay
      // cálculo paralelo ni horario inventado. Es solo lectura y solo sirve para pintar: las franjas
      // atenuadas siguen siendo clicables, se puede citar fuera de horario igual que hasta ahora.
      const tramos = {};
      for (const f of fechas) {
        const personas = {};
        for (const p of personasDia) personas[p.id] = tramosPersona(db, p.id, f);
        tramos[f] = { negocio: tramosAmbito(db, 'negocio', null, f), personas };
      }
      return c.json({
        ...agendaData(db, { desde, hasta, cliente_id: cliente ? cliente.id : null, soloUsuario: verTodasAg ? null : yoAg }), cliente, personasDia, tramos,
        rango: rangoRejilla(db, fechas),
        sin_horario: !hayHorarioNegocio(db),
      });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // ── VISTA DE MES ──────────────────────────────────────────────────────────
  // Un mes NO cabe en la rejilla por columnas de persona: son 30 días × N personas. Así que el mes es
  // un calendario normal y cada día responde a dos preguntas — CUÁNTAS citas hay y CUÁNTO hueco queda.
  //
  // POR QUÉ EL HUECO NO SALE DE huecos(): esa función necesita una DURACIÓN (calcula dónde cabe un
  // servicio concreto), y en un resumen mensual no hay servicio elegido. Preguntarle con una duración
  // inventada daría un número que no significa nada. Se usan las MISMAS piezas del motor un escalón más
  // abajo —`tramosPersona` (el horario real de cada quien) y `ocupacionPersona` (lo que ya está pillado,
  // con su tiempo muerto y sus márgenes)— y se restan. Sigue siendo el motor: no hay cálculo paralelo.
  api.get('/mes', requirePerm('citas.read'), c => {
    try {
      const ym = String(c.req.query('ym') || '').match(/^(\d{4})-(\d{2})$/);
      if (!ym) return c.json({ error: 'Mes inválido (formato YYYY-MM)' }, 400);
      const anio = +ym[1], mes = +ym[2];
      const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
      // ── QUIÉN PUEDE VER LA AGENDA DE QUIÉN (21 ago 2026) ────────────────────────────────────
      // Sin `citas.ver_todas` este mes es SOLO EL SUYO: ni sus citas ni sus horas salen de aquí.
      // Las DOS cosas, y no solo las citas: decirle «168 h libres entre 14 personas» a quien no
      // puede ver la agenda de esas 14 sería la misma fuga contada de otra manera. El dueño y los
      // administradores pasan por el bypass de rol de `can()`, así que a ellos no les cambia nada.
      const verTodas = can(c, 'citas.ver_todas');
      const yo = c.get('session')?.userId;
      const personas = verTodas
        ? db.prepare('SELECT id FROM admin_users WHERE active=1').all().map(r => r.id)
        : (yo ? [yo] : []);
      const hoy = ahoraLocal().fecha;
      // ── LO QUE PASA CADA DÍA, sin tener que pasar el ratón ────────────────────────────────────
      // El mes ya no dice solo "3 citas": enseña las primeras. Acotado a propósito:
      //   · como mucho CUATRO por día (se pintan 3 + «+N más»), ordenadas por hora. Traer el mes
      //     entero sería peso que nadie mira.
      //   · CUATRO campos por cita —hora, cliente, SERVICIO y estado—. Nada más viaja al navegador.
      //   · los MISMOS filtros que la vista Día. Si en Día no ves una cita porque su columna no está,
      //     en Mes tampoco. El candado sigue siendo el de la ruta (`citas.read`), intacto.
      const eje = c.req.query('eje') === 'recurso' ? 'recurso' : 'persona';
      const verTodo = c.req.query('verTodo') === '1';
      const primeras = db.prepare(
        `SELECT c.id, c.inicio_min, c.estado, c.user_id, c.recurso_id,
                COALESCE(cl.name, c.cliente_suelto_nombre, 'Cliente') AS cliente
           FROM citas c LEFT JOIN clients cl ON cl.id = c.cliente_id
          WHERE c.fecha = ? AND c.estado <> 'anulada' AND c.archived = 0
          ORDER BY c.inicio_min`
      );
      const dias = [];
      for (let d = 1; d <= ultimo; d++) {
        const fecha = anio + '-' + String(mes).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        // ── A1 · EL NÚMERO NO CAMBIA; LO QUE VIAJA AHORA ES SU BASE ────────────────────────────
        // `libres_min` se calcula EXACTAMENTE igual que antes y no se toca: es la suma de los huecos
        // de TODAS las personas abiertas ese día. El problema nunca fue el número, era que llegaba
        // desnudo: 168 h en un negocio de 14 personas se lee como «el día tiene 168 horas».
        // Así que se mandan también las dos cifras que lo explican —cuántas personas lo componen y
        // cuánta capacidad había en total— para que la pantalla pueda DECLARAR SU BASE (la misma
        // regla que CANON impone a los márgenes: ningún porcentaje sin su base).
        // Cero cálculo nuevo: `capacidad` sale de los MISMOS `tramosPersona` de los que ya salía
        // `libres`, en el mismo bucle. No hay una segunda fuente que pueda desviarse.
        let libres = 0, capacidad = 0, personasAbiertas = 0, abierto = false;
        for (const uid of personas) {
          const base = tramosPersona(db, uid, fecha);
          if (!base.length) continue;
          abierto = true;
          personasAbiertas++;
          for (const [a, b] of base) capacidad += (b - a);
          for (const [a, b] of resta(base, ocupacionPersona(db, uid, fecha))) libres += (b - a);
        }
        // Mismo criterio de columnas que la vista Día: por persona, si no se pide "ver todo el
        // equipo", solo quien TRABAJA ese día (`personasQueTrabajan`, la misma función). Por puesto
        // no hay filtro de columnas en Día —se listan todos los puestos y el «sin puesto»—, así que
        // aquí tampoco se filtra: se hereda el comportamiento, no se mejora.
        // UN DÍA CERRADO YA NO ESCONDE LAS CITAS QUE SÍ TIENE (21 ago 2026). Antes, en un día en que
        // no trabaja NADIE, este filtro se quedaba vacío y se comía TODAS las citas: la casilla decía
        // «Cerrado» encima de dos citas reales. Medido en el negocio de desarrollo el 26 de agosto:
        // con el filtro normal 0 citas, con «ver todo el equipo» 2. Y las dos vistas no coincidían,
        // porque la de Día ya hacía justo esto: cuando no hay nadie trabajando, `colDefs` cae a
        // TODAS las personas («nunca dejar la agenda sin columnas»). Ahora Mes hace lo mismo.
        // LA REGLA: esconder una cita real es siempre peor que enseñar un día raro. El filtro sigue
        // igual de estricto cuando hay alguien trabajando — que es cuando significa algo.
        const trabajan = (eje === 'persona' && !verTodo) ? personasQueTrabajan(db, fecha) : null;
        const visibles = (trabajan && trabajan.length) ? new Set(trabajan.map(p => p.id)) : null;
        const delDia = primeras.all(fecha)
          // El candado va PRIMERO y no lo levanta ningún filtro de pantalla: «ver todo el equipo»
          // enseña todo el equipo QUE SE PUEDE VER, no todo el equipo.
          .filter(x => verTodas || String(x.user_id) === String(yo))
          .filter(x => !visibles || visibles.has(x.user_id));
        dias.push({
          fecha, dia: d, citas: delDia.length, libres_min: libres, abierto, pasado: fecha < hoy,
          capacidad_min: capacidad, personas_abiertas: personasAbiertas,
          // A7 · EL SERVICIO, de la MISMA función que lo escribe en la vista Día (`serviciosDeCita`,
          // unido con « + »). No hay un segundo texto del servicio que pueda decir otra cosa. Solo
          // se resuelve para las CUATRO que viajan, no para el mes entero.
          // `id` viaja para poder ARRASTRAR la cita de un día a otro desde el propio mes.
          primeras: delDia.slice(0, 4).map(x => ({
            id: x.id, min: x.inicio_min, cliente: x.cliente, estado: x.estado,
            servicio: serviciosDeCita(db, x.id).join(' + '),
          })),
        });
      }
      return c.json({ ym: ym[0], dias, sin_horario: !hayHorarioNegocio(db) });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // Sugerencia para el panel rápido: totales del servicio + puesto que se autoasignaría + si cabe.
  api.get('/sugerir', requirePerm('citas.read'), c => {
    try {
      const fecha = c.req.query('fecha');
      const user_id = parseInt(c.req.query('user_id'));
      const inicio_min = parseInt(c.req.query('inicio_min'));
      const ids = (c.req.query('service_ids') || '').split(',').map(x => parseInt(x)).filter(Boolean);
      if (!fecha || !user_id || !ids.length || !(inicio_min >= 0)) return c.json({ ok: false });
      const aj = ajustesCitas(db);
      const configs = resolveServiceConfigs(db, ids, aj.margen_defecto_min);
      const geo = geometriaCadena(configs);
      const precio_total = configs.reduce((s, x) => s + (Number(x.price) || 0), 0);
      const req = puestosRequeridos(db, ids);
      let puesto = null, requiere_puesto = req.length > 0;
      if (requiere_puesto) puesto = puestoLibre(db, { fecha, inicio_min, dur_min: geo.dur_total, margen_min: geo.margen_min, req_ids: req });
      const sol = comprobarSolape(db, { user_id, recurso_id: puesto ? puesto.id : null, fecha, inicio_min, dur_min: geo.dur_total, margen_min: geo.margen_min, servicios: geo.servicios });
      const cabe = sol.ok && (!requiere_puesto || !!puesto);
      return c.json({ ok: true, cabe, dur_total: geo.dur_total, margen: geo.margen_min, precio_total, requiere_puesto, puesto, motivo: cabe ? '' : (requiere_puesto && !puesto ? ('No hay ' + aj.puesto_sing.toLowerCase() + ' libre a esa hora') : sol.motivo) });
    } catch (e) { return c.json({ ok: false, error: safeError(e) }, e.status || 500); }
  });

  api.get('/:id{[0-9]+}', requirePerm('citas.read'), c => {
    try {
      const cita = db.prepare(
        `SELECT c.*, u.name AS persona, r.nombre AS recurso, cl.name AS cliente_nombre, pr.codigo AS proyecto_codigo
           FROM citas c LEFT JOIN admin_users u ON u.id=c.user_id LEFT JOIN recursos r ON r.id=c.recurso_id
           LEFT JOIN clients cl ON cl.id=c.cliente_id LEFT JOIN proyectos pr ON pr.id=c.project_id WHERE c.id=?`
      ).get(c.req.param('id'));
      if (!cita) return c.json({ error: 'No encontrada' }, 404);
      // LA PUERTA DE ATRÁS DE LA FICHA. Esconder una cita del calendario no sirve de nada si se
      // llega a ella tecleando su número, así que el candado de «cada uno ve lo suyo» se aplica
      // TAMBIÉN aquí. Se responde 404, no 403: un 403 confirmaría que esa cita existe.
      if (!can(c, 'citas.ver_todas') && String(cita.user_id) !== String(c.get('session')?.userId)) {
        return c.json({ error: 'No encontrada' }, 404);
      }
      cita.servicios = db.prepare('SELECT cs.*, p.name AS nombre FROM cita_servicios cs LEFT JOIN products p ON p.id=cs.product_id WHERE cs.cita_id=? ORDER BY cs.orden,cs.id').all(cita.id);
      cita.service_ids = cita.servicios.map(s => s.product_id);
      cita.avisos = db.prepare('SELECT tipo,canal,estado,enviado_at FROM cita_avisos WHERE cita_id=? ORDER BY id').all(cita.id);
      cita.hora = hhmm(cita.inicio_min);
      cita.contacto = contactoDeCita(db, cita);
      return c.json(cita);
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  api.get('/', requirePerm('citas.read'), c => {
    try {
      const desde = c.req.query('desde') || ahoraLocal().fecha;
      const hasta = c.req.query('hasta') || desde;
      // CABO 5 · filtro por cliente. Viaja el NOMBRE además del id para que la pantalla pueda pintar
      // el chip sin una segunda llamada; si el id no existe, no se filtra y se dice (cliente: null).
      const cliId = parseInt(c.req.query('cliente'), 10) || null;
      const cliente = cliId ? (db.prepare('SELECT id, name FROM clients WHERE id=?').get(cliId) || null) : null;
      return c.json(agendaData(db, { desde, hasta, soloUsuario: can(c, 'citas.ver_todas') ? null : c.get('session')?.userId }).citas);
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // ── Escrituras de citas ───────────────────────────────────────────────────
  api.post('/', requirePerm('citas.edit'), validate(citaSchema), c => {
    const input = c.get('validated');
    try {
      const r = createCitaSvc(db, input, { created_by: c.get('session')?.userId });
      logActivity(db, c.get('session'), 'Creó cita', ENTITY.CITA, r.id, r.codigo);
      return c.json({ id: r.id, codigo: r.codigo, message: 'Cita creada' });
    } catch (e) {
      // Si choca (solape / sin puesto), proponemos huecos cercanos en vez de un error seco (3.6).
      if (e.status === 409) return c.json({ error: safeError(e), huecos: huecosCercanos(db, input) }, 409);
      return c.json({ error: safeError(e) }, e.status || 500);
    }
  });

  api.put('/:id{[0-9]+}', requirePerm('citas.edit'), validate(citaSchema), c => {
    try {
      const r = editCitaSvc(db, parseInt(c.req.param('id')), c.get('validated'));
      logActivity(db, c.get('session'), 'Editó cita', ENTITY.CITA, r.id, '');
      return c.json({ message: 'Cita actualizada' });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  api.post('/:id/mover', requirePerm('citas.edit'), validate(citaMoverSchema), c => {
    try {
      const r = moverCitaSvc(db, parseInt(c.req.param('id')), c.get('validated'));
      logActivity(db, c.get('session'), 'Movió cita', ENTITY.CITA, r.id, '');
      return c.json({ message: 'Cita movida' });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  api.post('/:id/estado', requirePerm('citas.edit'), validate(citaEstadoSchema), c => {
    try {
      const estado = c.get('validated').estado;
      // CAMINO 1 · la pantalla del negocio cambia el estado a «anulada». Elegir quién es OBLIGATORIO
      // (la pantalla no preselecciona nada); si no llega, se rechaza en vez de inventar un autor.
      if (estado === 'anulada') {
        const quien = (c.get('validated') || {}).anulada_por;
        if (!ANULADA_POR.includes(quien)) return c.json({ error: 'Di quién anula la cita: el cliente o el negocio.' }, 400);
        anularCitaSvc(db, parseInt(c.req.param('id')), 'Cita anulada', quien);
        return c.json({ message: 'Cita anulada' });
      }
      const r = cambiarEstadoSvc(db, parseInt(c.req.param('id')), estado);
      logActivity(db, c.get('session'), 'Cambió estado de cita a ' + estado, ENTITY.CITA, r.id, '');
      return c.json({ message: 'Estado actualizado', estado });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  api.post('/:id/atender', requirePerm('citas.edit'), validate(citaAtenderSchema), c => {
    try {
      const r = atenderCitaSvc(db, parseInt(c.req.param('id')), c.get('validated'), { emitted_by: c.get('session')?.userId });
      logActivity(db, c.get('session'), 'Atendió cita' + (r.invoice_id ? ' (cobrada)' : ''), ENTITY.CITA, r.id, '');
      return c.json({ message: 'Cita atendida', ...r });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  api.delete('/:id{[0-9]+}', requirePerm('citas.edit'), async c => {
    try {
      // CAMINO 2 · el botón «Anular» de la pantalla del negocio. Mismo candado: sin quién, no se anula.
      const quien2 = (await c.req.json().catch(() => ({}))).anulada_por;
      if (!ANULADA_POR.includes(quien2)) return c.json({ error: 'Di quién anula la cita: el cliente o el negocio.' }, 400);
      const r = anularCitaSvc(db, parseInt(c.req.param('id')), 'Cita anulada', quien2);
      logActivity(db, c.get('session'), 'Anuló cita', ENTITY.CITA, r.id, '');
      return c.json({ message: 'Cita anulada' });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // ── Avisos: enlaces (wa/sms), marcar enviado a mano, o enviar email ────────
  api.get('/:id/aviso-links', requirePerm('citas.read'), c => {
    try {
      const cita = db.prepare('SELECT * FROM citas WHERE id=?').get(c.req.param('id'));
      if (!cita) return c.json({ error: 'No encontrada' }, 404);
      const aj = ajustesCitas(db);
      const contacto = contactoDeCita(db, cita);
      const baseUrl = citaBaseUrl(c.get('tenant')?.slug);
      const enlace = citaEnlace(baseUrl, cita.token);
      const vars = { empresa: aj.company_name, servicio: serviciosDeCita(db, cita.id).join(' + '), fecha: cita.fecha, hora: hhmm(cita.inicio_min), direccion: aj.address, enlace };
      const tipoDefault = cita.estado === 'confirmada' || cita.estado === 'pedida' ? 'confirmacion' : 'recordatorio';
      const texto = t => textoAviso(t, vars);
      return c.json({
        canal_defecto: aj.canal_defecto,
        contacto,
        confirmacion: { texto: texto('confirmacion'), wa: contacto.movil_valido ? waLink(contacto.movil_e164, texto('confirmacion')) : null, sms: contacto.movil_valido ? smsLink(contacto.movil_e164, texto('confirmacion')) : null },
        recordatorio: { texto: texto('recordatorio'), wa: contacto.movil_valido ? waLink(contacto.movil_e164, texto('recordatorio')) : null, sms: contacto.movil_valido ? smsLink(contacto.movil_e164, texto('recordatorio')) : null },
        enlace, tipo_default: tipoDefault,
      });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  api.post('/:id/aviso', requirePerm('citas.edit'), validate(avisoMarcarSchema), async c => {
    try {
      const cita = db.prepare('SELECT * FROM citas WHERE id=?').get(c.req.param('id'));
      if (!cita) return c.json({ error: 'No encontrada' }, 404);
      const { tipo, canal } = c.get('validated');
      const uid = c.get('session')?.userId || null;
      if (canal === 'email') {
        // EMAIL: se envía DE VERDAD por Resend (la vía que ya existe). Estado honesto: 'email_enviado'.
        const aj = ajustesCitas(db);
        const contacto = contactoDeCita(db, cita);
        if (!contacto.email) return c.json({ error: 'El cliente no tiene email' }, 400);
        const enlace = citaEnlace(citaBaseUrl(c.get('tenant')?.slug), cita.token);
        try {
          await enviarEmailCita(db, {
            tipo, destinatario: contacto.email, empresa: aj.company_name, replyTo: aj.email, cliente: contacto.nombre,
            servicio: serviciosDeCita(db, cita.id).join(' + '), fecha: cita.fecha, hora: hhmm(cita.inicio_min), direccion: aj.address, enlace,
          }, sendEmail);
          registrarAviso(db, { cita_id: cita.id, tipo, canal, estado: 'email_enviado', por_user_id: uid });
          return c.json({ message: 'Email enviado y marcado', estado: 'email_enviado' });
        } catch (e) {
          registrarAviso(db, { cita_id: cita.id, tipo, canal, estado: 'email_fallo', por_user_id: uid, nota: safeError(e) });
          return c.json({ error: safeError(e) }, e.status || 502);
        }
      }
      // WhatsApp / SMS: vía MANUAL. Solo sabemos que se pulsó el botón → 'marcado' (nunca 'entregado').
      registrarAviso(db, { cita_id: cita.id, tipo, canal, estado: 'marcado', por_user_id: uid });
      return c.json({ message: 'Marcado como enviado', estado: 'marcado' });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // ── Cola de envíos ────────────────────────────────────────────────────────
  api.get('/cola/data', requirePerm('citas.read'), c => {
    try {
      const hoy = ahoraLocal().fecha;
      const manana = new Date(Date.parse(hoy + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
      const aj = ajustesCitas(db);
      const baseUrl = citaBaseUrl(c.get('tenant')?.slug);
      return c.json({ ...colaEnvios(db, { hoy, manana, baseUrl, empresa: aj.company_name, direccion: aj.address }), ajustes: aj, hoy, manana, baseUrl });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // ── Recursos (CRUD) ───────────────────────────────────────────────────────
  api.get('/recursos/list', requirePerm('citas.read'), c => {
    try { return c.json(db.prepare('SELECT * FROM recursos WHERE active=1 ORDER BY nombre').all()); }
    catch (e) { return c.json({ error: safeError(e) }, 500); }
  });
  api.post('/recursos', requirePerm('citas.edit'), validate(recursoSchema), c => {
    try {
      const d = c.get('validated');
      const r = db.prepare('INSERT INTO recursos (nombre,tipo,notas) VALUES (?,?,?)').run(d.nombre, d.tipo, d.notas || '');
      logActivity(db, c.get('session'), 'Creó recurso', ENTITY.RECURSO, r.lastInsertRowid, d.nombre);
      return c.json({ id: r.lastInsertRowid, message: 'Recurso creado' });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });
  api.put('/recursos/:id', requirePerm('citas.edit'), validate(recursoSchema), c => {
    try {
      const d = c.get('validated');
      db.prepare('UPDATE recursos SET nombre=?,tipo=?,notas=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(d.nombre, d.tipo, d.notas || '', c.req.param('id'));
      return c.json({ message: 'Recurso actualizado' });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });
  api.delete('/recursos/:id', requirePerm('citas.edit'), c => {
    try { db.prepare('UPDATE recursos SET active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(c.req.param('id')); return c.json({ message: 'Recurso archivado' }); }
    catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // ── Servicios reservables (config sobre el catálogo) ──────────────────────
  api.get('/servicios/list', requirePerm('citas.read'), c => {
    try {
      const rows = db.prepare(
        `SELECT p.id, p.name, p.price, p.tax_band, sc.reservable, sc.duracion_min, sc.muerto_ini_min, sc.muerto_dur_min, sc.margen_min,
                COALESCE(sc.publico,0) AS publico
           FROM products p LEFT JOIN service_config sc ON sc.product_id=p.id
          WHERE p.type='service' AND (p.status IS NULL OR p.status<>'archived') ORDER BY p.name`
      ).all();
      for (const r of rows) {
        r.configurado = r.duracion_min != null;
        r.providers = db.prepare('SELECT user_id FROM service_providers WHERE product_id=?').all(r.id).map(x => x.user_id);
        r.resources = db.prepare('SELECT recurso_id FROM service_resources WHERE product_id=?').all(r.id).map(x => x.recurso_id);
      }
      return c.json(rows);
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });
  // Crear un servicio reservable DE CERO: nace como producto de catálogo (type=service, fuente única) +
  // su configuración de reserva, en un paso. Así no hay que ir antes a Catálogo. Precio e IVA del catálogo.
  api.post('/servicios', requirePerm('citas.edit'), validate(serviceCreateSchema), c => {
    try {
      const d = c.get('validated');
      const sku = (d.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)) || 'servicio';
      const prod = createProductSvc(db, { name: d.nombre, sku, price: d.precio, tax_band: d.tax_band, type: 'service', status: 'active', stock: 0, tags: [] });
      db.transaction(() => {
        db.prepare(`INSERT INTO service_config (product_id,reservable,duracion_min,muerto_ini_min,muerto_dur_min,margen_min,updated_at) VALUES (?,1,?,?,?,?,CURRENT_TIMESTAMP)`)
          .run(prod.id, d.duracion_min, d.muerto_ini_min, d.muerto_dur_min, d.margen_min);
        const insP = db.prepare('INSERT OR IGNORE INTO service_providers (product_id,user_id) VALUES (?,?)');
        for (const u of d.provider_ids) insP.run(prod.id, u);
        const insR = db.prepare('INSERT OR IGNORE INTO service_resources (product_id,recurso_id) VALUES (?,?)');
        for (const rr of d.resource_ids) insR.run(prod.id, rr);
      })();
      logActivity(db, c.get('session'), 'Creó servicio reservable', ENTITY.PRODUCT, prod.id, d.nombre);
      autoEncenderReservas(db);   // §4 — un servicio con precio y duración es la otra condición
      return c.json({ id: prod.id, message: 'Servicio creado' });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  api.put('/servicios/:id', requirePerm('citas.edit'), validate(serviceConfigSchema), c => {
    try {
      const pid = parseInt(c.req.param('id'));
      const p = db.prepare("SELECT id, type FROM products WHERE id=?").get(pid);
      if (!p || p.type !== 'service') return c.json({ error: 'El producto no es un servicio' }, 400);
      const d = c.get('validated');
      db.transaction(() => {
        db.prepare(
          `INSERT INTO service_config (product_id,reservable,duracion_min,muerto_ini_min,muerto_dur_min,margen_min,updated_at)
           VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)
           ON CONFLICT(product_id) DO UPDATE SET reservable=excluded.reservable,duracion_min=excluded.duracion_min,
             muerto_ini_min=excluded.muerto_ini_min,muerto_dur_min=excluded.muerto_dur_min,margen_min=excluded.margen_min,updated_at=CURRENT_TIMESTAMP`
        ).run(pid, d.reservable ? 1 : 0, d.duracion_min, d.muerto_ini_min, d.muerto_dur_min, d.margen_min);
        db.prepare('DELETE FROM service_providers WHERE product_id=?').run(pid);
        const insP = db.prepare('INSERT OR IGNORE INTO service_providers (product_id,user_id) VALUES (?,?)');
        for (const u of d.provider_ids) insP.run(pid, u);
        db.prepare('DELETE FROM service_resources WHERE product_id=?').run(pid);
        const insR = db.prepare('INSERT OR IGNORE INTO service_resources (product_id,recurso_id) VALUES (?,?)');
        for (const rr of d.resource_ids) insR.run(pid, rr);
      })();
      autoEncenderReservas(db);   // §4 — ponerle duración a un servicio que ya tenía precio cumple (b)
      return c.json({ message: 'Servicio reservable guardado' });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // ── Horarios (negocio y por persona) ──────────────────────────────────────
  api.get('/horario', requirePerm('citas.read'), c => {
    try {
      const scope = c.req.query('scope') === 'user' ? 'user' : 'negocio';
      const user_id = scope === 'user' ? parseInt(c.req.query('user_id')) : null;
      const tramos = db.prepare(
        `SELECT dow,inicio_min,fin_min FROM horario_tramos WHERE scope=? AND ${user_id ? 'user_id=?' : 'user_id IS NULL'} ORDER BY dow,inicio_min`
      ).all(...(user_id ? [scope, user_id] : [scope]));
      const excepciones = db.prepare(
        `SELECT id,fecha,tipo,inicio_min,fin_min,motivo FROM horario_excepciones WHERE scope=? AND ${user_id ? 'user_id=?' : 'user_id IS NULL'} AND fecha>=? ORDER BY fecha`
      ).all(...(user_id ? [scope, user_id, ahoraLocal().fecha] : [scope, ahoraLocal().fecha]));
      return c.json({ tramos, excepciones });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });
  api.post('/horario', requirePerm('citas.edit'), validate(horarioSchema), c => {
    try {
      const d = c.get('validated');
      const user_id = d.scope === 'user' ? (d.user_id || null) : null;
      if (d.scope === 'user' && !user_id) return c.json({ error: 'Falta la persona' }, 400);
      for (const t of d.tramos) if (t.fin_min <= t.inicio_min) return c.json({ error: 'Un tramo termina antes de empezar (' + hhmm(t.inicio_min) + '-' + hhmm(t.fin_min) + ')' }, 400);
      db.transaction(() => {
        db.prepare(`DELETE FROM horario_tramos WHERE scope=? AND ${user_id ? 'user_id=?' : 'user_id IS NULL'}`).run(...(user_id ? [d.scope, user_id] : [d.scope]));
        const ins = db.prepare('INSERT INTO horario_tramos (scope,user_id,dow,inicio_min,fin_min) VALUES (?,?,?,?,?)');
        for (const t of d.tramos) ins.run(d.scope, user_id, t.dow, t.inicio_min, t.fin_min);
      })();
      // §4 — guardar el horario del NEGOCIO es una de las dos condiciones para que la página de
      // reservas se encienda sola. Se pregunta aquí, en el camino de guardar, y no en un cron: el
      // dueño se entera en el momento, no doce horas después. Nunca lanza (ver la función).
      if (d.scope !== 'user') autoEncenderReservas(db);
      return c.json({ message: 'Horario guardado' });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });
  api.post('/excepcion', requirePerm('citas.edit'), validate(excepcionSchema), c => {
    try {
      const d = c.get('validated');
      const user_id = d.scope === 'user' ? (d.user_id || null) : null;
      const ini = d.tipo === 'horario' ? (d.inicio_min === '' ? null : d.inicio_min) : null;
      const fin = d.tipo === 'horario' ? (d.fin_min === '' ? null : d.fin_min) : null;
      if (d.tipo === 'horario' && (ini == null || fin == null || fin <= ini)) return c.json({ error: 'Un horario especial necesita inicio y fin válidos' }, 400);
      const r = db.prepare('INSERT INTO horario_excepciones (scope,user_id,fecha,tipo,inicio_min,fin_min,motivo) VALUES (?,?,?,?,?,?,?)')
        .run(d.scope, user_id, d.fecha, d.tipo, ini, fin, d.motivo || '');
      return c.json({ id: r.lastInsertRowid, message: 'Excepción guardada' });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });
  api.delete('/excepcion/:id', requirePerm('citas.edit'), c => {
    try { db.prepare('DELETE FROM horario_excepciones WHERE id=?').run(c.req.param('id')); return c.json({ message: 'Excepción eliminada' }); }
    catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // ── Bloqueos ──────────────────────────────────────────────────────────────
  api.post('/bloqueo', requirePerm('citas.edit'), validate(bloqueoSchema), c => {
    try {
      const d = c.get('validated');
      if (d.fin_min <= d.inicio_min) return c.json({ error: 'El bloqueo termina antes de empezar' }, 400);
      if (!d.user_id && !d.recurso_id) return c.json({ error: 'Un bloqueo necesita una persona o un recurso' }, 400);
      const r = db.prepare('INSERT INTO agenda_bloqueos (user_id,recurso_id,fecha,inicio_min,fin_min,motivo) VALUES (?,?,?,?,?,?)')
        .run(d.user_id || null, d.recurso_id || null, d.fecha, d.inicio_min, d.fin_min, d.motivo || '');
      return c.json({ id: r.lastInsertRowid, message: 'Bloqueo creado' });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });
  api.delete('/bloqueo/:id', requirePerm('citas.edit'), c => {
    try { db.prepare('DELETE FROM agenda_bloqueos WHERE id=?').run(c.req.param('id')); return c.json({ message: 'Bloqueo eliminado' }); }
    catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // ── Ajustes de citas ──────────────────────────────────────────────────────
  api.post('/ajustes', requirePerm('citas.edit'), validate(citaAjustesSchema), c => {
    try {
      const d = c.get('validated');
      const corte = d.cita_corte_mismo_dia_min === '' || d.cita_corte_mismo_dia_min == null ? null : d.cita_corte_mismo_dia_min;
      const sing = (d.cita_puesto_sing || '').trim() || 'Puesto';
      const plural = (d.cita_puesto_plural || '').trim() || 'Puestos';
      db.prepare(
        `UPDATE company_config SET cita_grid_min=?, cita_antelacion_min=?, cita_ventana_dias=?, cita_corte_mismo_dia_min=?,
           cita_margen_defecto_min=?, cita_canal_defecto=?, cita_modo_recordatorio=?, cita_puesto_sing=?, cita_puesto_plural=? WHERE id=1`
      ).run(d.cita_grid_min, d.cita_antelacion_min, d.cita_ventana_dias, corte, d.cita_margen_defecto_min, d.cita_canal_defecto, d.cita_modo_recordatorio, sing, plural);
      return c.json({ message: 'Ajustes guardados' });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // ── VISTAS (server-rendered, con candado) ─────────────────────────────────
  views.get('/', requirePerm('citas.read'), c => c.html(vistaAgenda(c, db)));
  views.get('/cola', requirePerm('citas.read'), c => c.html(vistaCola(c, db)));
  views.get('/servicios', requirePerm('citas.read'), c => c.html(vistaServicios(c, db)));
  views.get('/recursos', requirePerm('citas.read'), c => c.html(vistaRecursos(c, db)));
  views.get('/horarios', requirePerm('citas.read'), c => c.html(vistaHorarios(c, db)));
  views.get('/ajustes', requirePerm('citas.edit'), c => c.html(vistaAjustes(c, db)));
  // PIEZA 6 — los mandos de la puerta pública, dentro del área de Agenda que ya existe.
  views.get('/publica', requirePerm('citas.edit'), c => c.html(vistaPublica(c, db)));

  return { api, views };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1.9 RUTAS PÚBLICAS DEL ENLACE DE LA CITA (sin sesión, por LLAVE). Solo esa cita; confirmar o avisar.
// Se montan en app.route('/cita', …) — FUERA de /admin y /api (sin auth ni CSRF; el token ES la defensa).
// ════════════════════════════════════════════════════════════════════════════════════════════════
// Resuelve una cita por su token, vigente (no anulada, no archivada, no pasada). Nada más se expone.
// PIEZA 6: se saca de la clausura a función exportada para que las acciones nuevas del enlace
// (cambiar / anular con ventana) usen EXACTAMENTE esta regla y no una copia que pueda desviarse.
// El comportamiento es idéntico al de la pieza 5, letra por letra.
export function resolverCitaPorToken(db, token) {
  if (!token || token.length < 20) return null;
  const cita = db.prepare('SELECT * FROM citas WHERE token=?').get(token);
  if (!cita) return null;
  if (cita.estado === 'anulada' || cita.archived) return null;
  if (cita.fecha < ahoraLocal().fecha) return null;   // caduca pasada la cita (a nivel de día)
  return cita;
}

export function createCitasPublicRoutes(db) {
  const app = new Hono();

  // 1.9 LÍMITE DE PETICIONES para evitar barridos de tokens. Por IP+negocio, ventana de 1 min. Un
  // cliente legítimo abre su enlace unas pocas veces; 40/min corta un ataque de fuerza bruta sin
  // molestar a nadie. (En producción el tenant lo resuelve el subdominio, antes de este handler.)
  app.use('*', rateLimit({ windowMs: 60_000, max: 40, keyPrefix: 'cita-link', message: 'Demasiadas peticiones. Espera un momento e inténtalo de nuevo.' }));

  const resolver = (token) => resolverCitaPorToken(db, token);

  app.get('/:token', c => {
    const cita = resolver(c.req.param('token'));
    if (!cita) return c.html(paginaCitaError(), 403);
    return c.html(paginaCita(db, cita, c.req.param('token')));
  });

  app.post('/:token/confirmar', async c => {
    const cita = resolver(c.req.param('token'));
    if (!cita) return c.json({ error: 'Enlace no válido' }, 403);
    if (cita.estado === 'pedida') cambiarEstadoSvc(db, cita.id, 'confirmada');
    return c.json({ ok: true, message: 'Cita confirmada' });
  });

  app.post('/:token/avisar', async c => {
    const cita = resolver(c.req.param('token'));
    if (!cita) return c.json({ error: 'Enlace no válido' }, 403);
    // El cliente avisa de que NO puede ir → la cita se anula (libera el hueco). Registra el aviso.
    // CAMINO 6 · el cliente avisa por el enlace de su cita. Lo anula ÉL: no se le pregunta nada.
    anularCitaSvc(db, cita.id, 'El cliente avisó de que no puede asistir', 'cliente');
    db.prepare("INSERT INTO cita_avisos (cita_id,tipo,canal,estado,nota) VALUES (?,?,?,?,?)").run(cita.id, 'recordatorio', 'email', 'cliente_no_puede', 'Avisó desde el enlace');
    return c.json({ ok: true, message: 'Aviso recibido' });
  });

  return app;
}

// ── Página pública de la cita (confirmar / no puedo ir) ────────────────────────────────────────────
function paginaCitaError() {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Enlace no válido</title>
    <style>body{font-family:-apple-system,Segoe UI,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
    .box{max-width:420px;padding:32px;text-align:center}h1{font-size:20px}p{color:#94a3b8;line-height:1.6}</style></head>
    <body><div class="box"><h1>Enlace no válido o caducado</h1><p>Este enlace ya no funciona. Ponte en contacto con el negocio si necesitas gestionar tu cita.</p></div></body></html>`;
}

function paginaCita(db, cita, token) {
  const aj = ajustesCitas(db);
  const servicios = serviciosDeCita(db, cita.id).join(' + ');
  const contacto = contactoDeCita(db, cita);
  const yaConfirmada = cita.estado === 'confirmada' || cita.estado === 'atendida';
  const E = escHtml;

  // ── PIEZA 6 · rama ADITIVA para las citas NACIDAS FUERA ──────────────────────────────────────
  // `res` sólo existe si la cita entró por la puerta pública. Si no existe, TODO lo de abajo queda a
  // cero y la página es exactamente la de la pieza 5, botón por botón (decisión del dueño: la ventana
  // de cambio/anulación rige sólo para las nacidas fuera).
  const res = reservaDeCita(db, cita.id);
  const esPub = res != null;
  const v = ventanaCliente(db, cita);
  const pendiente = esPub && res.aprobacion === 'pendiente';
  // El nombre visible del profesional: dentro, el del sistema; para una cita de la puerta pública, el
  // que puso el DUEÑO — nunca admin_users.name (F: el usuario del sistema no se filtra jamás).
  const persona = esPub
    ? (personasPublicas(db, []).find(p => p.id === cita.user_id)?.nombre || '')
    : (db.prepare('SELECT name FROM admin_users WHERE id=?').get(cita.user_id)?.name || '');

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Tu cita — ${E(aj.company_name)}</title>
    <style>
      :root{color-scheme:light dark}
      body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f1f5f9;color:#0f172a;margin:0;padding:1.5rem 1rem}
      @media (prefers-color-scheme:dark){body{background:#0f172a;color:#e2e8f0}.card{background:#1e293b !important;border-color:#334155 !important}}
      .wrap{max-width:520px;margin:0 auto}
      .card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:1.5rem;margin:1rem 0;box-shadow:0 1px 3px rgba(0,0,0,.06)}
      h1{font-size:1.3rem;margin:.2rem 0}.muted{color:#64748b;font-size:.9rem}
      .row{display:flex;justify-content:space-between;padding:.5rem 0;border-bottom:1px solid #e2e8f0}
      .row:last-child{border-bottom:0}.row b{font-weight:600}
      .btn{display:block;width:100%;box-sizing:border-box;text-align:center;padding:.9rem;border-radius:12px;border:0;font-size:1rem;font-weight:600;cursor:pointer;margin-top:.75rem}
      .ok{background:#16a34a;color:#fff}.no{background:transparent;color:#dc2626;border:1px solid #dc2626}
      .estado{display:inline-block;padding:.15rem .6rem;border-radius:20px;font-size:.8rem;font-weight:600;background:#dbeafe;color:#1d4ed8}
      #msg{display:none;padding:.8rem;border-radius:10px;margin-top:1rem;text-align:center;font-weight:600}
      .sec{background:transparent;color:#1d4ed8;border:1px solid #1d4ed8}
      .nota{font-size:.85rem;color:#64748b;background:rgba(100,116,139,.1);padding:.7rem .8rem;border-radius:10px;margin-top:.75rem;line-height:1.5}
      .pol{font-size:.85rem;line-height:1.55;white-space:pre-wrap}
      .pol b{display:block;margin-bottom:.3rem;font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;color:#64748b}
      select,input[type=date]{width:100%;box-sizing:border-box;padding:.75rem;border-radius:10px;border:1px solid #cbd5e1;font-size:1rem;background:#fff;color:#0f172a;margin-top:.5rem}
      @media (prefers-color-scheme:dark){select,input[type=date]{background:#0f172a;color:#e2e8f0;border-color:#334155}}
    </style></head>
    <body><div class="wrap">
      <h1>Tu cita en ${E(aj.company_name)}</h1>
      <div class="muted">Hola${contacto.nombre ? ' ' + E(contacto.nombre) : ''}, esta es tu cita.${pendiente
        ? ' Está pendiente de que el negocio la confirme; te avisaremos.'
        : ' Puedes confirmarla o avisarnos si no puedes venir.'}</div>
      <div class="card">
        <div class="row"><span class="muted">Servicio</span><b>${E(servicios)}</b></div>
        <div class="row"><span class="muted">Día</span><b id="vFecha">${E(cita.fecha)}</b></div>
        <div class="row"><span class="muted">Hora</span><b id="vHora">${E(hhmm(cita.inicio_min))}</b></div>
        ${persona ? `<div class="row"><span class="muted">Te atiende</span><b>${E(persona)}</b></div>` : ''}
        ${aj.address ? `<div class="row"><span class="muted">Dónde</span><b>${E(aj.address)}</b></div>` : ''}
        <div class="row"><span class="muted">Estado</span><span class="estado" id="estado">${E(pendiente ? 'Pendiente de confirmar' : (ESTADO_LABEL[cita.estado] || cita.estado))}</span></div>
      </div>
      ${esPub && res.politica_texto ? `<div class="card pol"><b>Política de cancelación</b>${E(res.politica_texto)}</div>` : ''}
      <div id="acciones">
        ${esPub ? '' : `<button class="btn ok" id="btnOk" onclick="accion('confirmar')"${yaConfirmada ? ' style="display:none"' : ''}>Confirmar mi cita</button>
        <button class="btn no" onclick="accion('avisar')">No puedo ir</button>`}
        ${esPub && v.puede ? `<button class="btn sec" id="btnCambiar" onclick="abrirCambio()">Cambiar el día o la hora</button>
        <button class="btn no" onclick="anular()">Anular mi cita</button>` : ''}
        ${esPub && !v.puede ? `<div class="nota">${E(v.motivo)}</div>` : ''}
      </div>
      ${esPub && v.puede ? `<div class="card" id="cajaCambio" style="display:none">
        <b style="font-size:.9rem">Elige otro día y otra hora</b>
        <input type="date" id="nvFecha" onchange="cargarHuecos()">
        <select id="nvHora"><option value="">Elige el día primero</option></select>
        <button class="btn ok" onclick="guardarCambio()">Guardar el cambio</button>
      </div>` : ''}
      <div id="msg"></div>
      <script>
        var TOKEN = ${JSON.stringify(token)};
        function pinta(color, fondo, texto, estado){
          var msg = document.getElementById('msg');
          msg.style.background=fondo; msg.style.color=color; msg.textContent=texto; msg.style.display='block';
          if(estado) document.getElementById('estado').textContent=estado;
        }
        async function accion(a){
          if(a==='avisar' && !confirm('¿Seguro que no puedes venir? Se liberará tu hueco.')) return;
          try{
            var res = await fetch('/cita/'+TOKEN+'/'+a,{method:'POST'});
            var d = await res.json();
            if(!res.ok) throw new Error(d.error||'Error');
            document.getElementById('acciones').style.display='none';
            if(a==='confirmar') pinta('#166534','#dcfce7','¡Gracias! Tu cita está confirmada.','Confirmada');
            else pinta('#991b1b','#fee2e2','Gracias por avisar. Hemos anulado tu cita.','Anulada');
          }catch(e){ alert(e.message); }
        }
        // ── PIEZA 6: cambiar / anular con ventana (solo citas nacidas en la puerta pública) ──
        function abrirCambio(){
          var caja = document.getElementById('cajaCambio');
          caja.style.display = caja.style.display==='none' ? '' : 'none';
        }
        async function cargarHuecos(){
          var sel = document.getElementById('nvHora'), f = document.getElementById('nvFecha').value;
          sel.innerHTML='<option value="">Buscando…</option>';
          if(!f){ sel.innerHTML='<option value="">Elige el día primero</option>'; return; }
          try{
            var r = await fetch('/cita/'+TOKEN+'/huecos?fecha='+encodeURIComponent(f));
            var d = await r.json();
            if(!r.ok) throw new Error(d.error||'Error');
            if(!d.huecos || !d.huecos.length){ sel.innerHTML='<option value="">Ese día no queda hueco</option>'; return; }
            sel.innerHTML = d.huecos.map(function(h){ return '<option value="'+h.min+'">'+h.hora+'</option>'; }).join('');
          }catch(e){ sel.innerHTML='<option value="">No hemos podido cargar las horas</option>'; }
        }
        async function guardarCambio(){
          var f = document.getElementById('nvFecha').value, m = document.getElementById('nvHora').value;
          if(!f || !m){ alert('Elige un día y una hora.'); return; }
          try{
            var r = await fetch('/cita/'+TOKEN+'/cambiar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fecha:f,inicio_min:parseInt(m)})});
            var d = await r.json();
            if(!r.ok) throw new Error((d.error||'Error')+(d.huecos&&d.huecos.length?' Huecos cerca: '+d.huecos.map(function(h){return h.hora}).join(', '):''));
            document.getElementById('vFecha').textContent=d.fecha;
            document.getElementById('vHora').textContent=d.hora;
            document.getElementById('cajaCambio').style.display='none';
            pinta('#166534','#dcfce7','Hecho. Tu cita queda el '+d.fecha+' a las '+d.hora+'.');
          }catch(e){ alert(e.message); }
        }
        async function anular(){
          if(!confirm('¿Seguro que quieres anular tu cita?')) return;
          try{
            var r = await fetch('/cita/'+TOKEN+'/anular',{method:'POST'});
            var d = await r.json();
            if(!r.ok) throw new Error(d.error||'Error');
            document.getElementById('acciones').style.display='none';
            var caja = document.getElementById('cajaCambio'); if(caja) caja.style.display='none';
            pinta('#991b1b','#fee2e2','Tu cita queda anulada. Gracias por avisar.','Anulada');
          }catch(e){ alert(e.message); }
        }
      </script>
    </div></body></html>`;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// VISTAS DEL PANEL (server-rendered). Se apoyan en adminLayout + el helper api()/toast() del layout.
// ════════════════════════════════════════════════════════════════════════════════════════════════
// PASO 8 — el diccionario del oficio, servido al JS de cliente. Un solo sitio lo emite para que ninguna
// pantalla se quede con la palabra vieja; los defaults del lado cliente (|| 'Cliente') son solo cinturón.
const jsVoz = (aj) =>
  `window.PUESTO_SING=${JSON.stringify(aj.puesto_sing)};window.PUESTO_PLURAL=${JSON.stringify(aj.puesto_plural)};`
  + `window.CLIENTE_SING=${JSON.stringify(aj.cliente_sing)};window.CLIENTE_PLURAL=${JSON.stringify(aj.cliente_plural)};`
  + `window.USA_PROYECTOS=${aj.usa_proyectos ? 'true' : 'false'};`;

// EL HUECO TIENE QUE PARECER PULSABLE. Antes solo llevaba `cursor:pointer`, que únicamente se ve si ya
// estás encima — y nadie pone el ratón encima de lo que parece una hoja de cálculo en blanco. El clic
// llevaba funcionando desde la pieza 5; lo que no existía era la MANERA DE DESCUBRIRLO. Con teclado
// también: `:focus-visible`, porque un hueco al que se llega tabulando debe verse igual de vivo.
const CSS_AGENDA = `
  /* CONTROL SEGMENTADO — un solo control con la selección dentro, en vez de tres botones sueltos.
     Tokens de DISEÑO §2: superficie --bg3 de canal, --bg2 para el segmento activo, radio 9px en
     controles (§2.7), tipografía del sistema (heredada). Sin azul: el único azul de la pantalla es
     el botón primario "Nueva cita" (§6). */
  .segmented{display:inline-flex;background:var(--bg3);border:1px solid var(--border2);border-radius:9px;padding:2px;gap:2px}
  .segmented button{appearance:none;border:0;background:transparent;color:var(--text2);font-family:inherit;font-size:.82rem;font-weight:500;padding:.32rem .8rem;border-radius:7px;cursor:pointer;transition:background .15s,color .15s,box-shadow .15s;line-height:1.4}
  .segmented button:hover{color:var(--text)}
  .segmented button[aria-selected="true"]{background:var(--bg2);color:var(--text);font-weight:600;box-shadow:0 1px 2px rgba(20,22,27,.10)}
  .segmented button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}

  /* ══ CABECERA (BLOQUE 3) ═══════════════════════════════════════════════════════════════════════
     El mes y el año en grande mandan; el 18/08/2026 deja de ser el elemento principal (sigue estando:
     el título ABRE el selector). "Hoy" en rojo junto a las flechas. Un solo primario: "Nueva cita". */
  .ag-chip{display:inline-flex;align-items:center;gap:.5rem;background:var(--accent-soft);color:var(--accent-d);border:1px solid #cfe0ff;border-radius:999px;padding:.35rem .5rem .35rem .85rem;font-size:.85rem}
  .ag-chip b{font-weight:700}
  .ag-chip button{appearance:none;border:0;background:transparent;color:var(--accent-d);cursor:pointer;font-size:1rem;line-height:1;padding:.1rem .3rem;border-radius:50%}
  .ag-chip button:hover{background:#cfe0ff}
  .ag-tit{appearance:none;border:0;background:transparent;font-family:inherit;padding:0;cursor:pointer;font-size:1.5rem;font-weight:700;letter-spacing:-.02em;color:var(--text);line-height:1.15;text-align:left}
  .ag-tit .anio{color:var(--text3);font-weight:600;margin-left:.28em}
  .ag-tit:hover .mes{text-decoration:underline;text-underline-offset:3px}
  .ag-tit:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:6px}
  /* EL SALTO DE FECHA: doce meses o doce años, en una hoja que cuelga del título. */
  .ag-salto{position:absolute;z-index:60;margin-top:.4rem;width:264px;background:var(--bg2);
            border:1px solid var(--border2);border-radius:var(--radius-lg,12px);
            box-shadow:0 16px 44px rgba(16,24,40,.18);padding:.6rem}
  .ag-salto[hidden]{display:none}
  .ag-salto-cab{display:flex;align-items:center;gap:.25rem;margin-bottom:.5rem}
  .ag-salto-tit{flex:1;appearance:none;border:0;background:transparent;font-family:inherit;
                font-size:.95rem;font-weight:700;color:var(--text);cursor:pointer;padding:.3rem;border-radius:8px}
  .ag-salto-tit:hover{background:var(--bg3)}
  .ag-salto-rej{display:grid;grid-template-columns:repeat(3,1fr);gap:.3rem}
  .ag-salto-rej button{appearance:none;border:0;background:transparent;font-family:inherit;font-size:.82rem;
                       color:var(--text);cursor:pointer;padding:.5rem .2rem;border-radius:8px}
  .ag-salto-rej button:hover{background:var(--bg3)}
  .ag-salto-rej button.hoy{color:#D2452F;font-weight:700}
  .ag-salto-rej button.sel{background:var(--text);color:#fff;font-weight:600}
  .ag-salto-rej button.hoy.sel{background:#D2452F;color:#fff}
  .ag-hoy{appearance:none;background:transparent;border:0;font-family:inherit;font-size:.82rem;font-weight:600;color:#D2452F;cursor:pointer;padding:.32rem .55rem;border-radius:7px}
  .ag-hoy:hover{background:rgba(210,69,47,.08)}
  .ag-nav{appearance:none;background:transparent;border:0;font-family:inherit;font-size:1.05rem;color:var(--text2);cursor:pointer;padding:.15rem .5rem;border-radius:7px;line-height:1}
  .ag-nav:hover{background:var(--bg3);color:var(--text)}
  /* Filtros / Bloquear un rato / la (i) de la leyenda: del mismo peso que las flechas, no botones. */
  .ag-disc{appearance:none;background:transparent;border:0;font-family:inherit;font-size:.82rem;color:var(--text2);cursor:pointer;padding:.32rem .55rem;border-radius:7px}
  .ag-disc:hover{background:var(--bg3);color:var(--text)}
  /* El rótulo del alto de hora. Se lee «Alto  S M L» en vez de tres letras sueltas que no decían
     nada. En pantalla estrecha cede el rótulo, nunca los botones. */
  .ag-zoomwrap{display:flex;align-items:center;gap:.35rem}
  .ag-zoomlbl{font-size:.72rem;font-weight:600;color:var(--text3);letter-spacing:.02em}
  @media (max-width:900px){ .ag-zoomlbl{display:none} }
  /* La ventana de «qué significa cada color». */
  .ley-lista{display:flex;flex-direction:column;gap:.7rem}
  .ley-fila{display:flex;gap:.6rem;align-items:flex-start}
  .ley-fila p{margin:.1rem 0 0;font-size:.82rem;color:var(--text2);line-height:1.45}
  .ley-pt{flex:0 0 auto;width:14px;height:14px;border-radius:4px;margin-top:.15rem}
  .ley-trama{flex:0 0 auto;width:14px;height:14px;border-radius:4px;margin-top:.15rem;border:1px solid var(--border2);
             background-image:repeating-linear-gradient(135deg,transparent 0 3px,rgba(20,22,27,.30) 3px 4px)}
  /* TIRA DE 7 DÍAS (solo en vista Día) — saltar de día sin abrir el selector. */
  .ag-tira{display:flex;gap:.15rem;margin:.15rem 0 .8rem}
  .ag-tira button{appearance:none;border:0;background:transparent;font-family:inherit;cursor:pointer;flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:.2rem;padding:.35rem 0;border-radius:9px}
  .ag-tira button:hover{background:var(--bg3)}
  .ag-tira .dow{font-size:.62rem;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--text3)}
  .ag-tira .n{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.9rem;color:var(--text)}
  .ag-tira .findes .dow,.ag-tira .findes .n{color:var(--text3)}
  .ag-tira .hoy .n{color:#D2452F;font-weight:700}
  .ag-tira .sel .n{background:var(--text);color:#fff;font-weight:600}
  .ag-tira .sel.hoy .n{background:#D2452F;color:#fff}
  .ag-tira button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}

  /* ══ EL LIENZO (BLOQUE 1) ══════════════════════════════════════════════════════════════════════
     Se acabó la tabla de filas de media hora: una cita a las 9:10 se dibuja a las 9:10. El alto de
     una hora es --alto-hora (zoom en 3 pasos, recordado por usuario) y TODO se deriva de ahí.
     Las rasantes son fondo, no bordes: dos líneas de 0.5px, la de la hora en punto con el doble de
     contraste que la de la media. Fuera el fondo alterno y fuera los bordes verticales marcados. */
  .ag-wrap{--alto-hora:72px;position:relative;overflow:auto;max-height:70vh;background:var(--bg2)}
  .ag-head{position:sticky;top:0;z-index:6;display:flex;background:var(--bg2);border-bottom:1px solid var(--border2)}
  .ag-head .esq{position:sticky;left:0;z-index:7;flex:0 0 44px;background:var(--bg2)}
  .agcol-head{flex:1 1 0;min-width:110px;padding:.5rem .4rem;font-size:.8rem;font-weight:600;color:var(--text2);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ag-body{position:relative;display:flex;min-height:1px;padding:8px 0}
  /* El aire de arriba y abajo es para las etiquetas de hora: van a caballo de su línea (-6px), así que
     la primera se saldría por arriba y la última por abajo. Lo llevan las DOS columnas (horas y datos),
     que son hermanas flex, así que no se descuadra ni un píxel. */
  .ag-horas{position:sticky;left:0;z-index:5;flex:0 0 44px;background:var(--bg2)}
  /* Las etiquetas van absolute DENTRO de la columna de horas, así que necesita ser su propio marco de
     posición. Sin esto se cuelgan de .ag-body y se van al otro extremo del lienzo: no se ve ni una hora. */
  .ag-horas>.ag-hrel{position:relative;height:100%}
  .ag-hora{position:absolute;right:6px;transform:translateY(-6px);font-size:11px;color:var(--text3);white-space:nowrap}
  .ag-cols{flex:1 1 auto;display:flex;position:relative}
  .ag-col{flex:1 1 0;min-width:110px;position:relative;border-left:.5px solid var(--border)}
  .ag-col:first-child{border-left:0}
  /* Rasantes: hora en punto y media hora, las dos de 0.5px, la media a la mitad de contraste. */
  .ag-col,.ag-horas{background-image:
      repeating-linear-gradient(to bottom, var(--linea-hora) 0 .5px, transparent .5px var(--alto-hora)),
      repeating-linear-gradient(to bottom, transparent 0 calc(var(--alto-hora)/2), var(--linea-media) calc(var(--alto-hora)/2) calc(var(--alto-hora)/2 + .5px), transparent calc(var(--alto-hora)/2 + .5px) var(--alto-hora))}
  .ag-wrap{--linea-hora:#E4E6EA;--linea-media:#F1F3F5}
  /* FUERA DE HORARIO: se atenúa, NO se bloquea. Se sigue pudiendo citar ahí, como hasta ahora. */
  .ag-fuera{position:absolute;left:0;right:0;background:rgba(20,22,27,.028);pointer-events:none;z-index:0}
  /* ZONAS DE CLIC de 30 min. Van POR DEBAJO de las citas (z-index 1 < 3): si quedaran encima,
     pulsar una cita abriría el alta de una cita NUEVA y arrastrar para mover dejaría de funcionar. */
  .agcell{position:absolute;left:0;right:0;z-index:1}
  .agcell.libre{transition:background .12s}
  .agcell.libre:hover{background:color-mix(in srgb, var(--accent) 12%, transparent);box-shadow:inset 0 0 0 1px var(--accent);cursor:pointer}
  .agcell.libre:hover::after{content:'+ Nueva cita';position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:700;color:var(--accent);pointer-events:none}
  .agcell.libre:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
  /* LÍNEA DE AHORA — solo si el rango visible contiene hoy; se recoloca sola cada minuto. */
  .ag-ahora{position:absolute;left:0;right:0;height:1.5px;background:#D2452F;z-index:4;pointer-events:none}
  .ag-ahora::before{content:'';position:absolute;left:-4px;top:-3.75px;width:9px;height:9px;border-radius:50%;background:#D2452F}
  .ag-ahora-h{position:absolute;left:2px;transform:translateY(-50%);z-index:8;background:#D2452F;color:#fff;font-size:10px;font-weight:700;line-height:1;padding:2px 4px;border-radius:4px;pointer-events:none}

  /* ══ LA CITA COMO BLOQUE (BLOQUE 2) ════════════════════════════════════════════════════════════
     Fondo suave de su estado + barra de 3px en el tono fuerte + texto en el tono oscuro (nunca
     negro). Esquinas: 0 a la izquierda —donde está la barra— y 6px a la derecha. */
  .citaBlock{position:absolute;left:4px;right:4px;z-index:3;border-radius:0 6px 6px 0;border-left:3px solid var(--c-fuerte);background:var(--c-suave);color:var(--c-oscuro);padding:5px 8px;overflow:hidden;cursor:pointer;line-height:1.25}
  .citaBlock:hover{filter:brightness(.97)}
  .citaBlock .cli{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .citaBlock .svc,.citaBlock .hra{font-size:11px;opacity:.82;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  /* El tramo de ESPERA es el mismo bloque, gris neutro y SIN barra: a un metro se ve que no es cita. */
  .citaBlock.espera{border-left:0;border-radius:6px;background:var(--bg3);color:var(--text2);--c-fuerte:transparent}
  /* Cuando una cita comparte hora con otra, un filo claro a la derecha para que se vean DOS bloques
     y no uno partido. Solo aparece si de verdad hay choque. */
  .citaBlock[data-choque]{box-shadow:1px 0 0 var(--bg2)}
  /* ── EL ASA DE ESTIRAR (cabo 2) ──────────────────────────────────────────────────────────────
     14 px de alto: es la medida a partir de la cual un dedo acierta sin pelearse (los 4-6 px que
     bastan con un ratón son inservibles en táctil). Sobresale 3 px por debajo del bloque para que en
     una cita corta siga habiendo dónde agarrar. touch-action:none es lo que impide que el navegador
     se quede el gesto para hacer scroll. */
  .cita-asa{position:absolute;left:0;right:0;bottom:-3px;height:14px;cursor:ns-resize;touch-action:none;z-index:5}
  .cita-asa::after{content:'';position:absolute;left:50%;transform:translateX(-50%);bottom:4px;width:26px;height:3px;border-radius:2px;background:var(--c-fuerte);opacity:0}
  .citaBlock:hover .cita-asa::after,.cita-asa.tirando::after{opacity:.55}
  /* La etiqueta con la hora de fin mientras se estira: se ve SIEMPRE lo que va a quedar guardado. */
  .cita-fin{position:absolute;right:4px;bottom:2px;z-index:6;background:var(--c-fuerte);color:#fff;font-size:10px;font-weight:700;line-height:1;padding:2px 5px;border-radius:4px;pointer-events:none}
  .ag-espera{position:absolute;left:0;right:0;background:var(--bg3);opacity:.85;pointer-events:none;border-radius:3px}

  /* ══ MES (BLOQUE 4) ════════════════════════════════════════════════════════════════════════════
     El mes dice qué pasa cada día SIN pasar el ratón: hasta 3 citas escritas y «+N más». Si el día
     no tiene nada, la celda calla — el silencio es información. Fuera el title nativo y fuera el pie
     que seguía al ratón: el pie es del día SELECCIONADO. */
  /* CABO 3 · el deslizamiento horizontal es NUESTRO, no del navegador. Sin esto, arrastrar el dedo
     de lado sobre el mes hace que Chromium se lo quede como gesto de «atrás» y la pantalla se va a
     otra página (se vio en la prueba: la pantalla acababa en about:blank). El valor contain corta la cadena
     de overscroll AQUÍ, sin tocar el gesto de atrás en el resto de la aplicación, que sigue igual. */
  .mes{max-width:none;overscroll-behavior-x:contain}
  .mes-cab,.mes-rej{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}
  /* LAS INICIALES DE LOS DÍAS. Estaban a 0,66 rem y pegadas al borde de arriba de la tarjeta: se
     leían con esfuerzo y parecían un pie de página, no una cabecera. Más cuerpo, más aire arriba y
     abajo, y una línea que las separa de la rejilla. */
  .mes-cab span{text-align:center;font-size:.8rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text2);padding:.85rem 0 .6rem}
  /* P3 — REJILLA DE VERDAD. Las separaciones se pintan con los bordes de cada casilla (0.5px muy
     claros) y la línea ENTRE SEMANAS algo más marcada, que es lo que deja leer el mes por filas.
     Antes no había ni una línea: 42 números flotando. */
  /* A5 · LAS FILAS REPARTEN EL ALTO. Antes cada casilla tenía 'min-height:84px' y las filas eran
     implícitas: un mes de 5 semanas dejaba el mismo hueco muerto que uno de 6 llenaba, y un mes casi
     vacío era una pared en blanco. Ahora la rejilla tiene un ALTO TOTAL y 'grid-template-rows' se
     escribe al pintar con TANTAS filas como semanas REALES tenga el mes ('repeat(N,1fr)'): 5 semanas
     → 5 filas más altas, 6 semanas → 6 filas. Nunca una fila de más ni un hueco al final. */
  .mes-rej{border-top:1px solid var(--border2);height:var(--mes-alto,540px)}
  /* La casilla pasa a ser DOS elementos: el envoltorio '.mescel' (que es el hijo de la rejilla y da el
     marco de posición) y el botón '.mesdia' de siempre dentro. Hace falta porque «+ Nueva cita» (A8)
     tiene que ser un BOTÓN DE VERDAD —para que se llegue con el teclado— y un botón no puede vivir
     dentro de otro botón. El día sigue siendo 'button.mesdia', con su 'disabled' y sus bordes. */
  .mescel{position:relative;display:flex;min-width:0;min-height:0}
  .mesdia{appearance:none;background:transparent;font-family:inherit;cursor:pointer;text-align:left;
          display:flex;flex-direction:column;gap:2px;flex:1;width:100%;min-width:0;min-height:0;
          overflow:hidden;padding:4px 5px 6px;
          border:0;border-right:.5px solid var(--border);border-bottom:1px solid var(--border2)}
  .mescel:nth-child(7n) .mesdia{border-right:0}
  /* El NÚMERO arriba a la izquierda de su casilla, 12px. No centrado: así la casilla es un espacio
     donde caben cosas, no un contenedor de un número. */
  .mesdia .num{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;
               font-size:12px;color:var(--text);align-self:flex-start;flex:0 0 auto;transition:background .15s,color .15s}
  .mesdia:hover{background:var(--bg3)}
  .mesdia:focus-visible{outline:none}
  .mesdia:focus-visible .num{outline:2px solid var(--accent);outline-offset:2px}
  .mesdia.hoy .num{color:#D2452F;font-weight:700}
  .mesdia.sel .num{background:var(--text);color:#fff;font-weight:600}
  .mesdia.hoy.sel .num{background:#D2452F;color:#fff}
  /* ── A4 · EL GRIS DEJABA DE SIGNIFICAR TRES COSAS ───────────────────────────────────────────────
     ANTES: el MISMO gris ('rgba(20,22,27,.018)' de fondo + número 'var(--text3)') marcaba día de otro
     mes, fin de semana y día cerrado. Tres cosas distintas con la misma cara, y la peor de las tres
     era una MENTIRA: una peluquería que abre el sábado veía su mejor día pintado como apagado.
     AHORA son tres estados con marca propia, y la diferencia NO se apoya solo en el color —se lee
     igual en blanco y negro— porque cada uno usa un RECURSO distinto:
       · fuera del mes → tinta plana, la más apagada de las tres. No acepta citas.
       · CERRADO       → TRAMA diagonal. Una trama no se confunde con una tinta plana ni en escala de
                         grises ni con daltonismo, y dice «aquí no se trabaja» sin decir «esto no es
                         de este mes».
       · fin de semana ABIERTO → NADA. Se lee como cualquier día laborable, que es lo que es.
     El 'finde' desaparece como estado visual: lo que decide la cara de un día es si está ABIERTO. */
  .mesdia.otro{background:rgba(20,22,27,.022)}
  .mesdia.otro .num{color:var(--text3);opacity:.55}
  .mesdia.otro .lin,.mesdia.otro .mas{opacity:.5}
  .mesdia.cerrado{background-image:repeating-linear-gradient(135deg,transparent 0 5px,rgba(20,22,27,.085) 5px 6px)}
  .mesdia.cerrado .num{color:var(--text2)}
  .mesdia:disabled{cursor:default}
  /* A7 · HORA + CLIENTE + SERVICIO. Y CUANDO NO CABE, SE RECORTA EL SERVICIO, NO EL CLIENTE: el
     cliente es quien viene ('flex:0 1 auto', se queda con lo que necesita) y el servicio es el que
     cede ('flex:1 1 0' — arranca en cero y solo crece con lo que sobra, así que es el primero en
     quedarse con puntos suspensivos). Los dos con 'min-width:0', porque sin eso un nombre largo
     desborda la casilla en vez de recortarse. */
  .mesdia .lin{display:flex;align-items:baseline;gap:4px;font-size:10.5px;color:var(--text2);white-space:nowrap;overflow:hidden;line-height:1.35}
  .mesdia .lin .cli{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
  .mesdia .lin .svc{flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--text3)}
  .mesdia .pt{flex:0 0 auto;width:5px;height:5px;border-radius:50%;align-self:center}
  /* «+N más» ABRE EL DÍA (A7). Sigue siendo un 'span' DENTRO del botón del día —moverlo fuera
     rompería lo que ya mide el gate visual— y su pulsación la recoge el propio botón, que mira si el
     clic salió de aquí. Se pinta como lo que hace: un enlace, no una etiqueta muerta. */
  .mesdia .mas{font-size:10px;color:var(--accent);line-height:1.3;font-weight:600;text-decoration:underline;text-underline-offset:2px;cursor:pointer}
  /* A8 · CREAR DESDE EL MES. Botón real (teclado) tapado hasta que hace falta (ratón): aparece al
     pasar por encima de la casilla y también al llegar con el tabulador. Solo existe en el DOM para
     los días del mes que están ABIERTOS y con permiso de edición — en los cerrados y en los de otro
     mes no se ofrece, así que no hay nada que esconder.

     VA ARRIBA A LA DERECHA, Y NO ES ESTÉTICA. La primera versión tapaba la casilla ENTERA
     ('inset:0') y su propio gate la tumbó: con el ratón encima, el panel se tragaba TODOS los clics
     de la casilla — ya no se podía pulsar «+N más», ni seleccionar el día, ni abrirlo con dos clics.
     Un botón nuevo no puede comerse los que ya había. Ahora es una pastilla en la única esquina que
     siempre está libre (el número vive a la izquierda), como en Google Calendar. */
  .mes-add{position:absolute;top:2px;right:3px;display:inline-flex;align-items:center;gap:2px;
           appearance:none;border:0;border-radius:6px;padding:2px 6px;font-family:inherit;
           font-size:.62rem;font-weight:700;line-height:1.4;cursor:pointer;white-space:nowrap;
           color:var(--accent);background:color-mix(in srgb, var(--accent) 14%, var(--bg2));
           box-shadow:inset 0 0 0 1px var(--accent);opacity:0;pointer-events:none;transition:opacity .12s}
  .mes-add .corta{display:none}
  /* ── ARRASTRAR CITAS ────────────────────────────────────────────────────────────────────────────
     La línea de cita del mes se coge y se suelta en otro día. Se avisa de que se puede antes de
     intentarlo (el cursor) y de dónde va a caer mientras se arrastra (la diana). */
  .mesdia .lin.movible{cursor:grab}
  .mesdia .lin.arrastrando{opacity:.4}
  .mesdia.diana,.agcell.diana{background:color-mix(in srgb, var(--accent) 18%, transparent);
                              box-shadow:inset 0 0 0 2px var(--accent)}
  .citaBlock.arrastrando{opacity:.4}
  /* El fantasma que sigue al dedo. Va pegado al puntero y NO recibe eventos: si los recibiera,
     'elementFromPoint' se encontraría a sí mismo y no habría forma de saber sobre qué se suelta. */
  .ag-fantasma{position:fixed;z-index:9998;pointer-events:none;transform:translate(-50%,-140%);
               background:var(--text);color:#fff;font-size:.72rem;font-weight:600;padding:.3rem .55rem;
               border-radius:8px;box-shadow:0 8px 24px rgba(16,24,40,.28);max-width:180px;
               white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mescel:hover .mes-add{opacity:1;pointer-events:auto}
  .mes-add:focus-visible{opacity:1;pointer-events:auto;outline:2px solid var(--accent);outline-offset:1px}
  /* En una casilla de móvil no caben dos palabras: se queda el «+», con su nombre entero en la
     etiqueta para quien use lector de pantalla. */
  @media (max-width:700px){ .mes-add .larga{display:none} .mes-add .corta{display:inline} .mes-add{padding:1px 5px;font-size:.7rem} }
  /* EL PIE, CON AIRE. Iba pegado al borde de abajo de la tarjeta: el porcentaje y «Abrir el día»
     quedaban rozando el filo y la pantalla parecía cortada. Ahora respira por los cuatro lados y se
     apoya en un fondo propio, que es lo que lo separa de la rejilla sin necesidad de una raya. */
  .mes-pie{margin-top:0;padding:.85rem 1rem .95rem;border-top:1px solid var(--border);background:var(--bg3,rgba(20,22,27,.02));
           display:flex;align-items:baseline;gap:.6rem;flex-wrap:wrap;min-height:1.6rem}
  .mes-pie .d{font-weight:600}
  .mes-pie .s{color:var(--text2);font-size:.85rem}
  .mes-pie .a{margin-left:auto;font-size:.85rem;font-weight:600;color:var(--accent);cursor:pointer;background:none;border:0;font-family:inherit}
  @media (max-width:480px){ .mes{--mes-alto:414px} .mesdia{padding:3px} .mesdia .lin{font-size:9px} }`;

function vistaAgenda(c, db) {
  const editable = can(c, 'citas.edit');
  const aj = ajustesCitas(db);
  const content = `
    <style>${CSS_AGENDA}</style>
    <!-- CABECERA (BLOQUE 3). El elemento principal es el MES EN GRANDE, no el 18/08/2026: el campo de
         fecha sigue existiendo y lo abre el propio título. "Hoy" en rojo junto a las flechas. Un solo
         primario azul —"Nueva cita"—; Filtros y Bloquear un rato quedan del peso de las flechas. -->
    <div class="ph" style="align-items:flex-start">
      <div style="position:relative">
        <!-- P2: las flechas y «Hoy» van PEGADAS al título, no al otro extremo de la barra. Respondían
             —pulsar ‹ pasaba de agosto a julio—, pero estaban a 624 px de lo que mueven, así que no
             había forma de saber que servían para cambiar de mes. -->
        <div style="display:flex;align-items:center;gap:.15rem;flex-wrap:wrap">
          <button type="button" class="ag-tit" id="agTitulo" onclick="abrirFecha()" aria-expanded="false" aria-label="Cambiar de mes o de año">
            <span class="mes">Agenda</span>
          </button>
          <button type="button" class="ag-nav" onclick="agMover(-1)" aria-label="Mes o día anterior">&lsaquo;</button>
          <button type="button" class="ag-nav" onclick="agMover(1)" aria-label="Mes o día siguiente">&rsaquo;</button>
          <button type="button" class="ag-hoy" onclick="agHoy()">Hoy</button>
        </div>
        <input type="hidden" id="agFecha">
        <!-- EL SALTO DE FECHA — MESES Y AÑOS, no una casilla para teclear una fecha (21 ago 2026).
             Pulsar «Agosto 2026» abría un campo de fecha del navegador: para ver septiembre había
             que escribir un día concreto de septiembre, que es justo lo que no se está buscando.
             Ahora es lo que hace cualquier calendario: pulsas y salen los DOCE MESES; pulsas el año
             de esa hoja y salen los AÑOS; eliges y bajas de nuevo a meses. Se navega, no se teclea. -->
        <div id="agSalto" class="ag-salto" hidden>
          <div class="ag-salto-cab">
            <button type="button" class="ag-nav" onclick="saltoMueve(-1)" aria-label="Anterior">&lsaquo;</button>
            <button type="button" class="ag-salto-tit" id="agSaltoTit" onclick="saltoSube()"></button>
            <button type="button" class="ag-nav" onclick="saltoMueve(1)" aria-label="Siguiente">&rsaquo;</button>
          </div>
          <div class="ag-salto-rej" id="agSaltoRej"></div>
        </div>
      </div>
      <div style="display:flex;gap:.35rem;flex-wrap:wrap;align-items:center">
        <div class="segmented" role="tablist" aria-label="Vista">
          <button type="button" role="tab" id="vbDia" onclick="setVista('dia')">Día</button>
          <button type="button" role="tab" id="vbSemana" onclick="setVista('semana')">Semana</button>
          <button type="button" role="tab" id="vbMes" onclick="setVista('mes')">Mes</button>
        </div>
        <!-- ZOOM: compacto / normal / amplio. El paso se recuerda por usuario, en agPrefs, con la
             vista y los filtros — el mismo sitio, no un segundo sistema de preferencias.
             LLEVA SU NOMBRE DELANTE (21 ago 2026). Eran tres letras sueltas —S, M, L— al lado del
             selector de vista, y no había forma de saber qué hacían: parecían otro selector más.
             La función NO se toca ni se esconde (regla del menú: no se quita nada); lo que se
             arregla es que nadie sabía qué era. Ahora se lee «Alto  S M L», y en pantalla estrecha
             el rótulo cede el sitio antes que los botones. -->
        <div class="ag-zoomwrap">
          <span class="ag-zoomlbl" aria-hidden="true">Alto</span>
          <div class="segmented" role="group" id="agZoom" aria-label="Alto de la hora en la rejilla">
            <button type="button" id="zb48" onclick="setZoom(48)" title="Horas compactas" aria-label="Horas compactas">S</button>
            <button type="button" id="zb72" onclick="setZoom(72)" title="Alto normal" aria-label="Alto normal">M</button>
            <button type="button" id="zb96" onclick="setZoom(96)" title="Horas amplias" aria-label="Horas amplias">L</button>
          </div>
        </div>
        <button type="button" class="ag-disc" id="agLeyBtn" onclick="openModal('mLeyenda')" title="Qué significa cada color" aria-label="Qué significa cada color"><i class="ti ti-info-circle"></i></button>
        <button type="button" class="ag-disc" onclick="toggleControles()">Filtros</button>
        ${editable ? '<button type="button" class="ag-disc" onclick="openBloqueo()">Bloquear un rato</button><button class="btn btn-primary" onclick="openNuevaCita()">Nueva cita</button>' : ''}
      </div>
    </div>
    <!-- CABO 5 · el filtro por cliente, VISIBLE y quitable. Fuera de la caja de los filtros de eje:
         son dos cosas distintas y confundirlas haría que quitar uno pareciera quitar el otro. -->
    <div id="agChipCliente" style="display:none;gap:.5rem;align-items:center;margin-bottom:.75rem"></div>
    <div id="agControles" style="display:none;gap:.75rem;flex-wrap:wrap;align-items:center;margin-bottom:.75rem;padding:.6rem .8rem;background:var(--bg2,rgba(0,0,0,.02));border-radius:8px">
      <!-- A2 · AQUÍ VIVÍA UN SEGUNDO SELECTOR DE VISTA (Día/Semana/Mes) que hacía exactamente lo
           mismo que el grupo de botones de arriba. Dos mandos para una decisión: el de arriba es el
           patrón de Google Calendar, Outlook y Fresha, así que se queda ese y este se va. La vista
           deja de guardarse en un '<select>' del DOM y pasa a una variable ('AG_VISTA'), que es lo
           que era en realidad: estado, no un control. «Por puesto» y «Ver todo el equipo» SE QUEDAN
           —no son duplicados de nada— y por eso esta caja de filtros sigue existiendo. -->
      <select class="form-control" id="agEje" style="width:auto" onchange="agCargar()"><option value="persona">Por persona</option><option value="recurso">Por ${escHtml(aj.puesto_sing.toLowerCase())}</option></select>
      <label style="font-size:.85rem;display:flex;align-items:center;gap:.35rem"><input type="checkbox" id="agVerTodo" onchange="agCargar()"> Ver todo el equipo</label>
    </div>
    <!-- AGENDA SIN HORARIO: se dice lo que PASA, no lo que "falta". El negocio NO está bloqueado —
         el motor le abre el día por defecto (8:00–21:00) para que pueda reservar sin configurar nada
         (citas-engine.js, DEFAULT_OPEN). Así que el aviso enseña a usarla YA y ofrece el horario al lado. -->
    <div id="agSinHorario" class="alert" style="display:none;margin-bottom:.6rem;position:relative;padding-right:2rem">
      <strong>Tu agenda ya funciona.</strong> Estás con el horario por defecto, de <strong>8:00 a 21:00</strong>:
      <strong>pulsa cualquier hueco libre</strong> y creas la cita ahí mismo.
      ¿Abres a otras horas? <a href="/admin/citas/horarios" style="font-weight:700">Define tu horario →</a>
      <!-- Se puede cerrar, y se recuerda. Sigue apareciendo solo mientras NO haya horario propio: el
           día que el negocio defina el suyo, el aviso deja de tener sentido y desaparece por sí. -->
      <button type="button" class="ag-disc" onclick="cerrarSinHorario()" aria-label="Cerrar este aviso"
              style="position:absolute;top:.3rem;right:.35rem;font-size:1rem;line-height:1;padding:.15rem .35rem">&times;</button>
    </div>
    <div id="agTira" class="ag-tira" hidden></div>
    <div class="card" style="padding:0;overflow:hidden"><div id="agenda">Cargando…</div></div>
    ${modalNuevaCita(aj.puesto_sing, aj.cliente_sing)}
    ${modalDetalle()}
    ${modalBloqueo(aj.puesto_sing)}
    ${modalAvisos()}
    <!-- QUÉ SIGNIFICA CADA COLOR — VENTANA, no una tira que se despliega (21 ago 2026).
         Antes la (i) abría una fila de puntos encima del lienzo: empujaba la agenda hacia abajo, se
         leía de refilón y no cabía una sola palabra de explicación. Una ayuda que estorba a lo que
         viene a explicar no es ayuda. Ahora es la MISMA ventana que usa el resto del panel, con
         sitio para decir qué es cada estado, no solo cómo se llama. Los colores salen de
         ESTADOS_COLOR, la fuente única: no hay una segunda tabla que pueda desincronizarse. -->
    <div class="modal-overlay" id="mLeyenda"><div class="modal" style="max-width:460px">
      <div class="modal-head"><h3>Qué significa cada color</h3><button class="modal-close" onclick="closeModal('mLeyenda')">✕</button></div>
      <div class="modal-body">
        <div class="ley-lista">
          ${[['pedida', 'La ha pedido el ' + aj.cliente_sing.toLowerCase() + ' o la has apuntado tú, y todavía nadie la ha confirmado.'],
             ['confirmada', 'Confirmada: cuentas con ella.'],
             ['atendida', 'Ya se ha atendido. Es la que puedes cobrar.'],
             ['no_show', 'El ' + aj.cliente_sing.toLowerCase() + ' no vino y no avisó. Se apunta para poder verlo luego en su ficha.']]
            .map(([k, txt]) => `<div class="ley-fila">
                 <span class="ley-pt" style="background:${ESTADOS_COLOR[k].fuerte}"></span>
                 <div><b style="color:${ESTADOS_COLOR[k].oscuro}">${escHtml(ESTADOS_COLOR[k].label)}</b><p>${escHtml(txt)}</p></div>
               </div>`).join('')}
        </div>
        <div class="ley-fila" style="margin-top:.9rem;border-top:1px solid var(--border);padding-top:.9rem">
          <span class="ley-trama"></span>
          <div><b>Día cerrado</b><p>En la vista de Mes, los días que no abres van rayados. Los días de otro mes salen apagados y lisos.</p></div>
        </div>
        <p style="color:var(--text2);font-size:.8rem;margin:.9rem 0 0">Las citas <b>anuladas</b> no se pintan en la agenda.</p>
      </div>
    </div></div>
    <script>window.CITAS_EDIT=${editable ? 'true' : 'false'};window.CITA_ESTADOS=${jsonForScript(ESTADOS_COLOR)};window.AG_GRID=${Number(aj.grid) || 30};${jsVoz(aj)}${JS_AGENDA}</script>`;
  return adminLayout('Agenda', content, 'citas', c.get('session')?.csrfToken || '', c);
}
// ── COLOR DE ESTADO — FUENTE ÚNICA ───────────────────────────────────────────────────────────────
// Antes esto vivía DOS veces: `COLORS` aquí (para la leyenda) y `var COLOR` dentro de JS_AGENDA (para
// los bloques), con los mismos cuatro valores copiados. Dos tablas de lo mismo se separan en cuanto
// alguien toca una: la leyenda diría un color y la cita otro. Ahora hay UNA, y el cliente la recibe
// serializada (window.CITA_ESTADOS) en vez de tener la suya.
//
// Cada estado tiene TRES tonos de la MISMA familia, que es lo que la cita necesita para dejar de ser
// un rectángulo de color plano con texto blanco:
//   · fuerte — la barra de 3px de la izquierda y el punto de la leyenda. Son los valores DE SIEMPRE:
//              el significado del color no cambia, solo cómo se expresa.
//   · suave  — el fondo del bloque.
//   · oscuro — el texto, para que se lea sobre el fondo suave. Nunca negro: de la misma familia.
export const ESTADOS_COLOR = {
  pedida:     { fuerte: '#64748b', suave: '#EEF1F5', oscuro: '#3F4A5A', label: 'Pedida' },
  confirmada: { fuerte: '#16a34a', suave: '#E4F6EA', oscuro: '#146C34', label: 'Confirmada' },
  atendida:   { fuerte: '#2563eb', suave: '#E4EDFF', oscuro: '#1E439E', label: 'Atendida' },
  no_show:    { fuerte: '#b91c1c', suave: '#FBE3E3', oscuro: '#8C1616', label: 'No se presentó' },
};

function vistaCola(c, db) {
  const aj = ajustesCitas(db);
  // ── RECORDATORIOS A CLIENTES, VESTIDA (21 ago 2026) ─────────────────────────────────────────────
  // LO QUE EL PASO 0 CORRIGIÓ DEL ENCARGO, y queda dicho aquí para que no se vuelva a suponer: esta
  // pantalla YA traía el armazón del panel (sale de `adminLayout`, como todas) y YA tenía entrada de
  // menú, clave en NAV_PERMS, alias para el buscador y contador de pendientes. Lo que la hacía
  // parecer desnuda era el INTERIOR: tarjetas de borde a borde (1814 px de 1920), pegadas entre sí,
  // un título de 16,8 px y un párrafo de tres líneas a ancho completo que no lee nadie.
  //
  // EL TÍTULO PASA A SER «Recordatorios a clientes», que es como se llama en el menú y en la pestaña
  // del navegador desde el 18 de agosto. No es un cambio de nombre: es TERMINAR aquel, que dejó este
  // `h2` sin tocar — el menú te llevaba a «Recordatorios a clientes» y la pantalla se presentaba como
  // «Cola de envíos». El nombre viejo sigue encontrándose en el buscador, que es donde hace falta.
  const content = `
    ${COLA_CSS}
    <div class="cola-wrap">
      <div class="ph cola-ph">
        <div class="cola-cab">
          <h2 class="cola-tit">Recordatorios a clientes</h2>
          <p class="cola-sub">Despacha de una vez los avisos de tus citas, sin abrir ficha por ficha.
            <button type="button" class="cola-i" onclick="openModal('mColaInfo')" aria-label="Cómo funciona esta pantalla" title="Cómo funciona esta pantalla"><i class="ti ti-info-circle"></i></button>
          </p>
        </div>
        <a class="btn btn-secondary" href="/admin/citas"><i class="ti ti-arrow-left"></i> Agenda</a>
      </div>

      <!-- HOY VA PRIMERO. Lo de hoy se acaba hoy; lo de mañana puede esperar a mañana. El orden de
           antes (mañana arriba) no era una decisión: era el orden en que se escribieron los bloques. -->
      <div class="card cola-card">
        <div class="card-head"><h3 id="colaConfTit">Hoy — pendientes de confirmación</h3></div>
        <div class="card-body" id="colaConf">Cargando…</div>
      </div>
      <div class="card cola-card">
        <div class="card-head"><h3 id="colaRecTit">Mañana — pendientes de recordatorio</h3></div>
        <div class="card-body" id="colaRec">Cargando…</div>
      </div>
    </div>

    <!-- EL MURO DE TEXTO, DETRÁS DE LA (i). Eran tres líneas en gris a 1814 px de ancho, con negritas
         dentro, encima de lo único que se viene a hacer aquí. Se queda UNA frase arriba y el resto
         vive en la ventana del panel — incluida, ENTERA, la advertencia de que «marcado como
         enviado» no es «entregado». Esa no se toca ni se suaviza: es honestidad, no adorno. -->
    <div class="modal-overlay" id="mColaInfo"><div class="modal" style="max-width:480px">
      <div class="modal-head"><h3>Cómo funciona esta pantalla</h3><button class="modal-close" onclick="closeModal('mColaInfo')">✕</button></div>
      <div class="modal-body">
        <p class="cola-p">Doce citas se despachan en doce clics desde aquí, sin abrir doce fichas.</p>
        <p class="cola-p">Al pulsar el botón de <b>WhatsApp</b> o <b>SMS</b> se abre el mensaje ya escrito, con el enlace de esa cita. El <b>email</b> puede salir solo.</p>
        <div class="cola-aviso">
          <b>«Marcado como enviado» no quiere decir «entregado».</b>
          <p class="cola-p">Sabemos que se pulsó el botón, <b>no que el mensaje llegó</b>. Por eso aquí nunca vas a leer «entregado»: sería decirte algo que no sabemos.</p>
        </div>
      </div>
    </div></div>
    <script>${jsVoz(aj)}${JS_COLA}</script>`;
  return adminLayout('Recordatorios a clientes', content, 'citas-cola', c.get('session')?.csrfToken || '', c);
}

function vistaServicios(c, db) {
  const editable = can(c, 'citas.edit');
  const aj = ajustesCitas(db);
  const content = `
    <div class="ph"><h2>Cuánto dura cada servicio</h2><div style="display:flex;gap:.5rem"><a class="btn btn-secondary" href="/admin/settings#cfg-agenda">← Configuración</a>${editable ? '<button class="btn btn-primary" onclick="openNuevoServicio()">Nuevo servicio</button>' : ''}</div></div>
    <div class="alert" style="margin-bottom:1rem">Son los productos de tipo <strong>servicio</strong> de tu catálogo. Aquí defines lo que la cita necesita: el <strong>tiempo contigo</strong>, el <strong>tiempo de espera</strong> (los minutos en que el ${escHtml(aj.cliente_sing.toLowerCase())} espera y tú quedas libre, como el tinte) y el <strong>margen después</strong>. <strong>El precio y el IVA siguen viniendo del catálogo.</strong> Un servicio no se puede pedir hasta que tenga tiempo (pulsa «Configurar»). ¿No está en el catálogo? Créalo aquí con «Nuevo servicio». <strong>«Se pide por Internet»</strong> es otra cosa: es lo que ven tus ${escHtml(aj.cliente_plural.toLowerCase())} en tu <a href="/admin/citas/publica">página de reservas</a>, y viene <strong>apagado</strong> hasta que tú lo enciendas servicio a servicio.</div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Servicio</th><th>Se pide cita</th><th>Se pide por Internet</th><th>Tiempo contigo</th><th>Tiempo de espera</th><th>Margen</th><th></th></tr></thead><tbody id="svcBody"><tr><td colspan="7">Cargando…</td></tr></tbody></table></div></div>
    ${modalServicio(aj.puesto_sing)}
    ${modalNuevoServicio()}
    <script>window.CITAS_EDIT=${editable ? 'true' : 'false'};${jsVoz(aj)}${JS_SERVICIOS}</script>`;
  return adminLayout('Cuánto dura cada servicio', content, 'citas-servicios', c.get('session')?.csrfToken || '', c);
}

function vistaRecursos(c, db) {
  const editable = can(c, 'citas.edit');
  const aj = ajustesCitas(db);
  const content = `
    <div class="ph"><h2>${escHtml(aj.puesto_plural)}</h2><div style="display:flex;gap:.5rem"><a class="btn btn-secondary" href="/admin/settings#cfg-agenda">← Configuración</a>${editable ? '<button class="btn btn-primary" onclick="openRecurso()">Nuevo ' + escHtml(aj.puesto_sing.toLowerCase()) + '</button>' : ''}</div></div>
    <div class="alert" style="margin-bottom:1rem">Sillas, cabinas, salas, boxes o equipos. Una cita puede exigir persona <strong>y</strong> ${escHtml(aj.puesto_sing.toLowerCase())}; se comprueban los dos. Puedes cambiar cómo los llamas en <a href="/admin/citas/ajustes">Cómo se piden las citas</a>.</div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Tipo</th><th>Notas</th><th></th></tr></thead><tbody id="recBody"><tr><td colspan="4">Cargando…</td></tr></tbody></table></div></div>
    ${modalRecurso(aj.puesto_sing)}
    <script>window.CITAS_EDIT=${editable ? 'true' : 'false'};${jsVoz(aj)}${JS_RECURSOS}</script>`;
  return adminLayout(aj.puesto_plural, content, 'citas-recursos', c.get('session')?.csrfToken || '', c);
}

function vistaHorarios(c, db) {
  const editable = can(c, 'citas.edit');
  const personas = db.prepare("SELECT id, name FROM admin_users WHERE active=1 ORDER BY name").all();
  const opts = personas.map(p => '<option value="' + p.id + '">' + escHtml(p.name) + '</option>').join('');
  // ── «CUÁNDO ABRO», REHECHA (21 ago 2026) ────────────────────────────────────────────────────────
  // LO QUE HABÍA: siete bloques iguales con un par de campos de hora sueltos y un «+ tramo». Para
  // decir «abro de lunes a viernes de 9 a 2» había que repetir la misma operación CINCO veces, y no
  // había forma de ver de un vistazo qué días abría el negocio ni de cerrar uno sin borrarle los
  // campos a mano. Nada de eso era un fallo: era una pantalla sin terminar.
  //
  // LO QUE HACE AHORA, y de dónde sale: el patrón de WhatsApp Business y el de cualquier ficha de
  // negocio (Google, Fresha) — se elige un GRUPO de días, se dice si la jornada es corrida o
  // partida, se ponen las horas UNA vez y se aplica a todos. Y cada día conserva su interruptor,
  // para el que abre distinto los jueves.
  //
  // APLICAR NO ES GUARDAR. Los atajos rellenan el formulario y ya está; lo que escribe en la base
  // sigue siendo el botón de guardar, y la pantalla avisa mientras haya cambios sin guardar. Un
  // atajo que escribiera solo convertiría un clic de más en un horario cambiado sin querer.
  const content = `
    <div class="ph"><h2>Cuándo abro</h2><a class="btn btn-secondary" href="/admin/settings#cfg-agenda">← Configuración</a></div>
    ${HOR_CSS}
    <div class="hor-intro">
      Tu horario semanal manda sobre todo lo demás: de él salen los huecos que se pueden reservar y
      las horas libres que ves en la agenda. Una persona sin horario propio <b>hereda el del negocio</b>,
      y las <b>excepciones</b> (vacaciones, festivos, un cierre suelto) mandan sobre la regla semanal.
    </div>

    <div class="card hor-card">
      <div class="card-body">
        <div class="hor-quien">
          <label class="form-label" style="margin:0">Horario de</label>
          <select class="form-control" id="hScope" style="width:auto" onchange="hToggle();hCargar()"><option value="negocio">Todo el negocio</option><option value="user">Una persona en concreto</option></select>
          <select class="form-control" id="hUser" style="width:auto;display:none" onchange="hCargar()">${opts}</select>
        </div>
        <div class="hor-resumen" id="horResumen">Cargando…</div>
      </div>
    </div>

    ${editable ? `
    <div class="card hor-card">
      <div class="card-head"><h3>Ponlo de una vez</h3></div>
      <div class="card-body">
        <p class="hor-ayuda">Elige los días, di a qué hora abres y aplícalo a todos de golpe. Luego puedes retocar cualquier día por separado abajo.</p>
        <div class="hor-atajos">
          <button type="button" class="hor-chip-atajo" data-atajo="1,2,3,4,5">Lunes a viernes</button>
          <button type="button" class="hor-chip-atajo" data-atajo="1,2,3,4,5,6">Lunes a sábado</button>
          <button type="button" class="hor-chip-atajo" data-atajo="1,2,3,4,5,6,0">Todos los días</button>
          <button type="button" class="hor-chip-atajo" data-atajo="6,0">Sábado y domingo</button>
        </div>
        <div class="hor-dias-sel" id="horDiasSel"></div>
        <div class="hor-jornada">
          <div class="segmented" role="group" aria-label="Tipo de jornada">
            <button type="button" id="hjCorrido" onclick="horJornada('corrido')" aria-selected="true">Horario corrido</button>
            <button type="button" id="hjPartido" onclick="horJornada('partido')" aria-selected="false">Mañana y tarde</button>
          </div>
        </div>
        <div class="hor-horas">
          <div class="hor-par"><span class="hor-par-lbl" id="hpLbl1">Abro</span>
            <input type="time" class="form-control" id="hpA1" value="09:00"> <span class="hor-guion">–</span>
            <input type="time" class="form-control" id="hpB1" value="14:00"></div>
          <div class="hor-par" id="hpPar2" hidden><span class="hor-par-lbl">Y por la tarde</span>
            <input type="time" class="form-control" id="hpA2" value="17:00"> <span class="hor-guion">–</span>
            <input type="time" class="form-control" id="hpB2" value="20:00"></div>
        </div>
        <div class="hor-aplicar">
          <button type="button" class="btn btn-primary" onclick="horAplica()">Aplicar a los días elegidos</button>
          <span class="hor-vista-previa" id="horPrevia"></span>
        </div>
      </div>
    </div>` : ''}

    <div class="card hor-card">
      <div class="card-head"><h3>Día a día</h3>${editable ? '<span class="hor-ayuda" style="margin:0">Apaga un día para cerrarlo. Sus horas se recuerdan.</span>' : ''}</div>
      <div id="hGrid"></div>
      ${editable ? `<div class="hor-pie">
        <button class="btn btn-primary" id="horGuardar" onclick="hGuardar()">Guardar horario</button>
        <span class="hor-sucio" id="horSucio" hidden>Tienes cambios sin guardar</span>
      </div>` : ''}
    </div>

    <div class="card hor-card"><div class="card-head"><h3>Días sueltos: vacaciones, festivos y cierres</h3></div>
      <div class="card-body">
        <p class="hor-ayuda">Un día concreto que se sale de la regla semanal. Manda sobre ella.</p>
        ${editable ? `<div class="hor-exc-alta">
          <div><label class="form-label">Qué día</label><input class="form-control" type="date" id="eFecha"></div>
          <div><label class="form-label">Qué pasa</label><select class="form-control" id="eTipo" onchange="eToggle()"><option value="cerrado">Cierro todo el día</option><option value="horario">Abro a otras horas</option></select></div>
          <div id="eHoras" style="display:none"><label class="form-label">De — a</label><div style="display:flex;gap:.3rem;align-items:center"><input class="form-control" type="time" id="eIni"><span class="hor-guion">–</span><input class="form-control" type="time" id="eFin"></div></div>
          <div style="flex:1;min-width:160px"><label class="form-label">Motivo (opcional)</label><input class="form-control" id="eMotivo" placeholder="Festivo, vacaciones…"></div>
          <button class="btn btn-secondary" onclick="eAdd()">Añadir</button>
        </div>` : ''}
        <div id="excList"></div>
      </div>
    </div>
    <script>window.CITAS_EDIT=${editable ? 'true' : 'false'};${JS_HORARIOS}</script>`;
  return adminLayout('Cuándo abro', content, 'citas-horarios', c.get('session')?.csrfToken || '', c);
}

function vistaAjustes(c, db) {
  const aj = ajustesCitas(db);
  const sel = (v, opt) => v === opt ? ' selected' : '';
  // §1.1 — cómo llama el negocio a sus puestos. Presets + el actual (por si es a medida).
  const presets = [['Puesto', 'Puestos'], ['Silla', 'Sillas'], ['Cabina', 'Cabinas'], ['Sala', 'Salas'], ['Box', 'Boxes']];
  const cur = aj.puesto_sing + '|' + aj.puesto_plural;
  let found = false;
  let puestoOpts = presets.map(([s, pl]) => { const v = s + '|' + pl; const on = v === cur; if (on) found = true; return `<option value="${escHtml(v)}"${on ? ' selected' : ''}>${escHtml(pl)}</option>`; }).join('');
  if (!found) puestoOpts = `<option value="${escHtml(cur)}" selected>${escHtml(aj.puesto_plural)}</option>` + puestoOpts;
  const content = `
    <div class="ph"><h2>Cómo se piden las citas</h2><div style="display:flex;gap:.5rem"><a class="btn btn-secondary" href="/admin/settings#cfg-agenda">← Configuración</a><a class="btn btn-secondary" href="/admin/citas/publica">Mi página de reservas</a></div></div>
    <div class="card" style="max-width:640px">
      <div class="form-row">
        <div class="form-group"><label class="form-label">Rejilla (minutos)</label><select class="form-control" id="ajGrid"><option value="15"${sel(aj.grid,15)}>15</option><option value="30"${sel(aj.grid,30)}>30</option><option value="60"${sel(aj.grid,60)}>60</option></select></div>
        <div class="form-group"><label class="form-label">Antelación mínima (min)</label><input class="form-control" type="number" min="0" id="ajAntel" value="${aj.antelacion_min}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Ventana máxima (días)</label><input class="form-control" type="number" min="1" id="ajVentana" value="${aj.ventana_dias}"></div>
        <div class="form-group"><label class="form-label">Corte del mismo día (hora)</label><input class="form-control" type="time" id="ajCorte" value="${aj.corte_mismo_dia_min == null ? '' : hhmm(aj.corte_mismo_dia_min)}"><div style="font-size:.7rem;color:var(--muted)">Vacío = sin corte. Tras esa hora, no se reserva para hoy.</div></div>
        <div class="form-group"><label class="form-label">Margen posterior por defecto (min)</label><input class="form-control" type="number" min="0" id="ajMargen" value="${aj.margen_defecto_min}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Canal por defecto de avisos</label><select class="form-control" id="ajCanal"><option value="whatsapp"${sel(aj.canal_defecto,'whatsapp')}>WhatsApp</option><option value="sms"${sel(aj.canal_defecto,'sms')}>SMS</option><option value="email"${sel(aj.canal_defecto,'email')}>Email</option></select></div>
        <div class="form-group"><label class="form-label">Modo del recordatorio</label><select class="form-control" id="ajModo"><option value="manual"${sel(aj.modo_recordatorio,'manual')}>Los envío yo a mano</option><option value="auto_email"${sel(aj.modo_recordatorio,'auto_email')}>Que el recordatorio salga solo por email</option></select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">¿Cómo llamas a tus puestos?</label>
          <select class="form-control" id="ajPuesto">${puestoOpts}</select>
          <div style="font-size:.7rem;color:var(--muted)">Así los llamarás en tus pantallas (silla, cabina, sala…). No cambia nada por dentro.</div></div>
      </div>
      <div class="alert" style="font-size:.85rem">Los avisos por WhatsApp y SMS <strong>siempre van a mano</strong> (se abre el mensaje ya escrito). Solo el <strong>email</strong> puede salir solo, por el envío diario. Nunca decimos "entregado": solo "marcado como enviado".</div>
      <button class="btn btn-primary" onclick="ajGuardar()">Guardar ajustes</button>
    </div>
    <script>${JS_AJUSTES}</script>`;
  return adminLayout('Cómo se piden las citas', content, 'citas-ajustes', c.get('session')?.csrfToken || '', c);
}

// ── PIEZA 6 · MANDOS DE LA PUERTA PÚBLICA ─────────────────────────────────────────────────────────
// Vive dentro del área de Agenda (no es una sección nueva del menú). Todo lo de aquí nace APAGADO o
// en "no": el dueño enciende, no apaga. Y la dirección se enseña ENTERA y copiable, porque una puerta
// pública cuyo dueño no sabe repartir su URL no sirve de nada.
function vistaPublica(c, db) {
  const content = `
    <div class="ph"><h2>Mi página de reservas</h2>
      <div style="display:flex;gap:.5rem"><a class="btn btn-secondary" href="/admin/settings#cfg-agenda">← Configuración</a><a class="btn btn-secondary" href="/admin/citas/servicios">Cuánto dura cada servicio</a></div>
    </div>
    <div class="alert" style="margin-bottom:1rem">Tu página de reservas: el cliente elige servicio, con quién, día y hora, y la cita entra <strong>en tu agenda</strong> con las mismas reglas de dentro (mismos huecos, mismos solapes). <strong>Está apagada hasta que la enciendas</strong>, y solo se ve lo que marques: los servicios en <a href="/admin/citas/servicios">Cuánto dura cada servicio</a> («Se pide por Internet») y las personas aquí abajo. Reservar <strong>no cobra ni emite factura</strong>: eso sigue siendo tu «Atender».</div>

    <div class="card">
      <label style="display:flex;gap:.6rem;align-items:flex-start;font-weight:600">
        <input type="checkbox" id="pbActiva" style="margin-top:.25rem">
        <span>Mi página de reservas está abierta<div style="font-weight:400;font-size:.8rem;color:var(--muted)">Mientras esté apagada, la dirección responde «no encontrado» a cualquiera.</div></span>
      </label>
      <div class="form-group" style="margin-top:1rem"><label class="form-label">Tu dirección</label>
        <div style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap">
          <span style="font-size:.85rem;color:var(--muted)" id="pbBase"></span>
          <input class="form-control" id="pbHandle" style="width:auto;min-width:180px" placeholder="mi-negocio">
        </div>
        <div style="font-size:.75rem;color:var(--muted);margin-top:.3rem">Corta y fácil de decir por teléfono. Si la dejas vacía, se genera del nombre de tu negocio.</div>
        <div style="margin-top:.5rem;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
          <code id="pbUrl" style="font-size:.85rem;word-break:break-all"></code>
          <button class="btn btn-secondary btn-sm" onclick="pbCopiar()">Copiar</button>
          <a class="btn btn-secondary btn-sm" id="pbAbrir" href="#" target="_blank" rel="noopener">Abrir</a>
        </div>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Con cuánto tiempo se puede pedir</h3>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Antelación mínima (horas)</label><input class="form-control" type="number" min="0" step="1" id="pbAntel">
          <div style="font-size:.7rem;color:var(--muted)">Nadie puede pedir cita para dentro de menos.</div></div>
        <div class="form-group"><label class="form-label">Con cuánta antelación como máximo (días)</label><input class="form-control" type="number" min="1" id="pbVentana">
          <div style="font-size:.7rem;color:var(--muted)">Más allá, el calendario no deja elegir.</div></div>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">¿Se confirma sola o la apruebas tú?</h3>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Modo</label>
          <select class="form-control" id="pbModo" onchange="pbModoToggle()">
            <option value="auto">Se confirma sola</option>
            <option value="aprobar">La apruebo yo</option>
          </select></div>
        <div class="form-group" id="pbRetWrap"><label class="form-label">Caduca sola a las (horas)</label><input class="form-control" type="number" min="1" max="168" id="pbRet">
          <div style="font-size:.7rem;color:var(--muted)">La solicitud <strong>te guarda el hueco</strong> mientras esperas; si no respondes, se cae sola y el hueco vuelve.</div></div>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">¿Puede el cliente cambiar o anular?</h3>
      <label style="display:flex;gap:.6rem;align-items:center;font-size:.9rem"><input type="checkbox" id="pbCancAct" onchange="pbCancToggle()"> Sí, desde su enlace</label>
      <div class="form-group" id="pbCancWrap" style="margin-top:.75rem"><label class="form-label">Hasta cuántas horas antes</label><input class="form-control" type="number" min="0" id="pbCancH" style="max-width:160px">
        <div style="font-size:.7rem;color:var(--muted)">Pasado ese plazo, su enlace le dice que te llame. <strong>Las citas que creas tú en la agenda no cambian</strong>: su enlace sigue igual que siempre.</div></div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Tu política de cancelación</h3>
      <div style="font-size:.8rem;color:var(--muted);margin-bottom:.5rem">Se le <strong>muestra antes de confirmar</strong> y se repite en el correo. Si lo dejas vacío, no se muestra nada.</div>
      <textarea class="form-control" id="pbPolitica" rows="4" maxlength="2000" placeholder="Si no puedes venir, avísanos con 24 h de antelación…"></textarea>
      <div class="form-group" style="margin-top:.75rem"><label class="form-label">Enlace a tu política de privacidad</label><input class="form-control" id="pbPriv" placeholder="https://…"></div>
      <div class="alert" style="font-size:.8rem;margin-top:.75rem">Casilla que el cliente <strong>tiene que marcar</strong> (se guarda con fecha y hora el texto exacto que aceptó):<br><em id="pbConsent"></em></div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Quién aparece en la página</h3>
      <div style="font-size:.8rem;color:var(--muted);margin-bottom:.75rem">Por defecto <strong>no aparece nadie</strong>. El nombre que pongas aquí es el que ve el cliente — nunca el usuario del sistema.</div>
      <div id="pbPersonas"></div>
    </div>

    <button class="btn btn-primary" onclick="pbGuardar()">Guardar</button>

    <div class="card" id="pbSolWrap" style="display:none;margin-top:1.5rem">
      <h3 style="margin-top:0">Solicitudes pendientes de aprobar</h3>
      <div id="pbSolicitudes">Cargando…</div>
    </div>
    <script>${JS_PUBLICA}</script>`;
  return adminLayout('Mi página de reservas', content, 'citas-publica', c.get('session')?.csrfToken || '', c);
}

const JS_PUBLICA = String.raw`
function esc(s){return String(s==null?'':s).replace(/[<>&"]/g,function(c){return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c];});}
var PB=null;
function pbUrlActual(){
  var h=(document.getElementById('pbHandle').value||'').trim();
  var slug=h?h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40):'';
  return (PB.base_url||location.origin)+'/reservar/'+(slug||PB.handle_efectivo);
}
function pbPintaUrl(){ var u=pbUrlActual(); document.getElementById('pbUrl').textContent=u; document.getElementById('pbAbrir').href=u; }
function pbModoToggle(){ document.getElementById('pbRetWrap').style.display = document.getElementById('pbModo').value==='aprobar' ? '' : 'none'; }
function pbCancToggle(){ document.getElementById('pbCancWrap').style.display = document.getElementById('pbCancAct').checked ? '' : 'none'; }
async function pbCopiar(){
  try{ await navigator.clipboard.writeText(pbUrlActual()); toast('Dirección copiada'); }
  catch(e){ toast('Copia la dirección a mano: '+pbUrlActual(),'err'); }
}
async function pbCargar(){
  PB = await api('GET','/api/erp/reserva-publica/ajustes');
  var a = PB.ajustes;
  document.getElementById('pbActiva').checked = !!a.activa;
  document.getElementById('pbHandle').value = a.handle||'';
  document.getElementById('pbBase').textContent = (PB.base_url||location.origin)+'/reservar/';
  // La antelación se guarda en MINUTOS (lo que come el motor) y se enseña en HORAS (lo que piensa el
  // dueño). El defecto del encargo son 2 h = 120 min.
  document.getElementById('pbAntel').value = Math.round((a.antelacion_min||0)/60);
  document.getElementById('pbVentana').value = a.ventana_dias;
  document.getElementById('pbModo').value = a.modo;
  document.getElementById('pbRet').value = a.retencion_horas;
  document.getElementById('pbCancAct').checked = !!a.cancelar_activo;
  document.getElementById('pbCancH').value = a.cancelar_horas;
  document.getElementById('pbPolitica').value = a.politica||'';
  document.getElementById('pbPriv').value = a.privacidad_url||'';
  document.getElementById('pbConsent').textContent = PB.consentimiento;
  document.getElementById('pbPersonas').innerHTML = (PB.personas||[]).map(function(p){
    return '<div style="display:flex;gap:.6rem;align-items:center;margin-bottom:.5rem;flex-wrap:wrap">'
      +'<label style="display:flex;gap:.4rem;align-items:center;font-size:.9rem;min-width:170px"><input type="checkbox" class="pbP" data-id="'+p.id+'" '+(p.visible?'checked':'')+'> '+esc(p.name)+'</label>'
      +'<input class="form-control pbN" data-id="'+p.id+'" style="max-width:220px" maxlength="120" placeholder="Nombre que ve el cliente" value="'+esc(p.nombre_publico)+'">'
      +'</div>';
  }).join('') || '<span style="color:var(--muted)">No hay personas activas.</span>';
  pbModoToggle(); pbCancToggle(); pbPintaUrl();
  document.getElementById('pbHandle').addEventListener('input', pbPintaUrl);
  document.getElementById('pbSolWrap').style.display = a.modo==='aprobar' ? '' : 'none';
  if(a.modo==='aprobar') pbSolicitudes();
}
async function pbGuardar(){
  var personas=[].map.call(document.querySelectorAll('.pbP'), function(cb){
    var id=cb.getAttribute('data-id');
    var n=document.querySelector('.pbN[data-id="'+id+'"]');
    return { user_id:parseInt(id), visible:cb.checked, nombre_publico:(n?n.value:'').trim() };
  });
  var body={
    cita_pub_activa:document.getElementById('pbActiva').checked,
    cita_pub_handle:document.getElementById('pbHandle').value,
    cita_pub_antelacion_min:(parseInt(document.getElementById('pbAntel').value)||0)*60,
    cita_pub_ventana_dias:parseInt(document.getElementById('pbVentana').value)||60,
    cita_pub_modo:document.getElementById('pbModo').value,
    cita_pub_retencion_horas:parseInt(document.getElementById('pbRet').value)||24,
    cita_pub_cancelar_horas:parseInt(document.getElementById('pbCancH').value)||0,
    cita_pub_cancelar_activo:document.getElementById('pbCancAct').checked,
    cita_pub_politica:document.getElementById('pbPolitica').value,
    cita_pub_privacidad_url:document.getElementById('pbPriv').value,
    personas:personas,
  };
  try{ await api('POST','/api/erp/reserva-publica/ajustes',body); toast('Guardado'); pbCargar(); }
  catch(e){ toast(e.message,'err'); }
}
async function pbSolicitudes(){
  var box=document.getElementById('pbSolicitudes');
  try{
    var list=await api('GET','/api/erp/reserva-publica/solicitudes');
    if(!list.length){ box.innerHTML='<span style="color:var(--muted)">Nada pendiente.</span>'; return; }
    box.innerHTML='<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Cuándo</th><th>Servicio</th><th>Caduca en</th><th></th></tr></thead><tbody>'
      +list.map(function(r){ return '<tr><td>'+esc(r.cliente)+'<div style="font-size:.75rem;color:var(--muted)">'+esc(r.email||r.cliente_suelto_movil||'')+'</div></td>'
        +'<td>'+esc(r.fecha)+' '+esc(r.hora)+'</td><td>'+esc(r.servicios)+'</td>'
        +'<td>'+(r.horas_restantes==null?'—':(r.horas_restantes+' h'))+'</td>'
        +'<td style="white-space:nowrap"><button class="btn btn-primary btn-sm" onclick="pbAprobar('+r.id+')">Aprobar</button> '
        +'<button class="btn btn-secondary btn-sm" onclick="pbRechazar('+r.id+')">Rechazar</button></td></tr>'; }).join('')
      +'</tbody></table></div>';
  }catch(e){ box.textContent='No hemos podido cargar las solicitudes.'; }
}
async function pbAprobar(id){
  try{ var r=await api('POST','/api/erp/reserva-publica/solicitudes/'+id+'/aprobar'); toast(r.message); pbSolicitudes(); }catch(e){ toast(e.message,'err'); }
}
async function pbRechazar(id){
  if(!confirm('¿Rechazar la solicitud? Se libera el hueco y la cita queda anulada.')) return;
  try{ var r=await api('POST','/api/erp/reserva-publica/solicitudes/'+id+'/rechazar'); toast(r.message); pbSolicitudes(); }catch(e){ toast(e.message,'err'); }
}
pbCargar();
`;

// ── Modales (HTML) ────────────────────────────────────────────────────────────────────────────────
const modalNuevaCita = (puestoSing = 'Puesto', clienteSing = 'Cliente') => `
  <div class="modal-overlay" id="mCita"><div class="modal" style="max-width:520px">
    <div class="modal-head"><h3 id="mCitaTitle">Nueva cita</h3><button class="modal-close" onclick="closeModal('mCita')">✕</button></div>
    <div class="modal-body">
      <input type="hidden" id="cId"><input type="hidden" id="cCliente"><input type="hidden" id="cSueltoNombre"><input type="hidden" id="cSueltoMovilVal">
      <div id="cContexto" style="font-size:.9rem;font-weight:600;margin-bottom:.75rem"></div>
      <div class="form-group"><label class="form-label">${escHtml(clienteSing)} *</label>
        <input class="form-control" id="cBusca" placeholder="Escribe el nombre…" autocomplete="off" oninput="cFiltra()">
        <div id="cResultados"></div>
        <div id="cNuevo" style="display:none;margin-top:.4rem">
          <input class="form-control" id="cSueltoMovil" placeholder="Móvil (+34…, opcional)" style="margin-bottom:.35rem">
          <button type="button" class="btn btn-secondary btn-sm" onclick="cUsarNuevo()">＋ Usar «<span id="cNuevoNombre"></span>» como ${escHtml(clienteSing.toLowerCase())} nuevo</button>
        </div>
        <div id="cElegido" style="display:none;font-size:.85rem;margin-top:.35rem;color:var(--ok)"></div>
      </div>
      <div class="form-group"><label class="form-label">Servicio *</label>
        <div id="cServicios" style="display:flex;flex-direction:column;gap:.25rem;max-height:150px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:.5rem"></div>
        <div id="cResumen" style="font-size:.85rem;margin-top:.35rem"></div>
      </div>
      <!-- PASO 8 — CUÁNDO y CON QUIÉN viven FUERA de "Más opciones" (encargo C). Se enseñan u ocultan
           por JS según de dónde se abra el panel; el select de persona NUNCA se saca del DOM aunque no
           se pinte, para que cGuardar/cRecalc/cSugerir sigan leyendo user_id sin un solo caso especial
           ("se asigna solo" sale de que el select ya trae preseleccionada a la única persona). -->
      <div class="form-row" id="cCuando">
        <div class="form-group"><label class="form-label">Día</label><input class="form-control" type="date" id="cFecha" onchange="cRecalc()"></div>
        <div class="form-group"><label class="form-label">Hora</label><select class="form-control" id="cHueco" onchange="cSugerir()"></select></div>
      </div>
      <div class="form-group" id="cQuien"><label class="form-label">Con quién</label><select class="form-control" id="cPersona" onchange="cRecalc()"></select></div>
      <details id="cMas"><summary style="cursor:pointer;font-weight:600;font-size:.85rem;color:var(--accent)">Más opciones</summary>
        <div class="form-row" style="margin-top:.6rem">
          <div class="form-group" id="cRecursoWrap"><label class="form-label" id="cPuestoLbl">${escHtml(puestoSing)}</label><select class="form-control" id="cRecurso" onchange="cSugerir()"><option value="">— Automático —</option></select></div>
          <!-- PROYECTO — solo se PINTA si el oficio lo usa (asesoría; y "otro", que son los negocios de
               antes y no pueden perder lo que ya veían). NUNCA se saca del DOM: editCitaSvc escribe
               project_id=? con lo que llegue, así que un campo ausente le borraría el proyecto a la
               cita al editarla. Un peluquero no tiene proyectos; su dato tampoco se toca. -->
          <div class="form-group" id="cProyectoWrap"><label class="form-label">Proyecto</label><select class="form-control" id="cProyecto"><option value="">— Ninguno —</option></select></div>
        </div>
        <div class="form-group"><label class="form-label">Nota</label><textarea class="form-control" id="cNota" rows="2"></textarea></div>
        <div class="form-group"><label style="font-size:.85rem"><input type="checkbox" id="cAvisar"> Avisar al cliente al guardar</label></div>
      </details>
    </div>
    <div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal('mCita')">Cancelar</button><button class="btn btn-primary" onclick="cGuardar()">Guardar</button></div>
  </div></div>`;

const modalDetalle = () => `
  <div class="modal-overlay" id="mDet"><div class="modal" style="max-width:560px">
    <div class="modal-head"><h3 id="mDetTitle">Cita</h3><button class="modal-close" onclick="closeModal('mDet')">✕</button></div>
    <div class="modal-body" id="mDetBody"></div>
  </div></div>
  <!-- CABO 4 · QUIÉN ANULA. Dos botones, ninguno preseleccionado: sin elegir no se anula. Si hubiera
       una opción marcada de fábrica, en dos semanas todas las anulaciones dirían lo mismo y el dato
       no serviría para separar el plantón del cierre del negocio, que es para lo que existe. -->
  <div class="modal-overlay" id="mQuien" style="display:none"><div class="modal" style="max-width:460px">
    <div class="modal-head"><h3>¿Quién anula esta cita?</h3></div>
    <div class="modal-body">
      <p style="color:var(--text2);font-size:.9rem;margin:0 0 .9rem">Hace falta saberlo para poder distinguir después un plantón de un cierre tuyo. Si estaba cobrada, se anulará también su factura.</p>
      <div id="mQuienBody" style="display:grid;gap:.6rem">
        <button type="button" class="btn btn-secondary" data-quien="cliente" style="text-align:left;padding:.8rem 1rem">
          <strong>La anula el cliente</strong><br><span style="color:var(--text2);font-size:.85rem">Ha avisado de que no puede venir.</span></button>
        <button type="button" class="btn btn-secondary" data-quien="negocio" style="text-align:left;padding:.8rem 1rem">
          <strong>La anulo yo</strong><br><span style="color:var(--text2);font-size:.85rem">Cierro, cambio de planes o la muevo por mi cuenta.</span></button>
      </div>
      <p style="color:var(--text3);font-size:.82rem;margin:.9rem 0 0">¿No vino y no avisó? Eso no es anular: ciérrala con <strong>«No se presentó»</strong>.</p>
      <div style="margin-top:1rem;text-align:right"><button type="button" class="btn btn-secondary" id="mQuienNo">Dejarlo</button></div>
    </div>
  </div></div>`;

const modalBloqueo = (puestoSing = 'Puesto') => `
  <div class="modal-overlay" id="mBloq"><div class="modal" style="max-width:520px">
    <div class="modal-head"><h3>Bloquear un rato</h3><button class="modal-close" onclick="closeModal('mBloq')">✕</button></div>
    <div class="modal-body">
      <div class="form-row">
        <div class="form-group"><label class="form-label">Persona</label><select class="form-control" id="bPersona"><option value="">— Ninguna —</option></select></div>
        <div class="form-group"><label class="form-label">${escHtml(puestoSing)}</label><select class="form-control" id="bRecurso"><option value="">— Ninguno —</option></select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Fecha</label><input class="form-control" type="date" id="bFecha"></div>
        <div class="form-group"><label class="form-label">De</label><input class="form-control" type="time" id="bIni"></div>
        <div class="form-group"><label class="form-label">A</label><input class="form-control" type="time" id="bFin"></div>
      </div>
      <div class="form-group"><label class="form-label">Motivo</label><input class="form-control" id="bMotivo" placeholder="Comida, recado…"></div>
    </div>
    <div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal('mBloq')">Cancelar</button><button class="btn btn-primary" onclick="bGuardar()">Bloquear</button></div>
  </div></div>`;

const modalAvisos = () => `
  <div class="modal-overlay" id="mAviso"><div class="modal" style="max-width:520px">
    <div class="modal-head"><h3>Avisar al cliente</h3><button class="modal-close" onclick="closeModal('mAviso')">✕</button></div>
    <div class="modal-body" id="mAvisoBody"></div>
  </div></div>`;

const campoEspera = (pref) => `
  <div class="form-group">
    <a href="#" id="${pref}EsperaAdd" onclick="esperaShow('${pref}');return false" style="font-size:.85rem;color:var(--accent);font-weight:600">＋ Añadir tiempo de espera (el tinte)</a>
    <div id="${pref}EsperaWrap" style="display:none">
      <label class="form-label">Tiempo de espera (min)</label>
      <input class="form-control" type="number" min="0" id="${pref}Espera" value="0">
      <div style="font-size:.72rem;color:var(--muted)">Estos minutos aparecerán como hueco libre para atender a otra persona.</div>
    </div>
  </div>`;

const modalServicio = (puestoSing = 'Puesto') => `
  <div class="modal-overlay" id="mSvc"><div class="modal" style="max-width:560px">
    <div class="modal-head"><h3 id="mSvcTitle">Servicio</h3><button class="modal-close" onclick="closeModal('mSvc')">✕</button></div>
    <div class="modal-body">
      <input type="hidden" id="svcId">
      <div class="form-group"><label><input type="checkbox" id="svcReservable" checked> Se puede pedir cita para este servicio</label></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Tiempo contigo (min) *</label><input class="form-control" type="number" min="1" id="svcContigo" value="30"><div style="font-size:.72rem;color:var(--muted)">Los minutos que estás trabajando con el cliente.</div></div>
        <div class="form-group"><label class="form-label">Margen después (min)</label><input class="form-control" type="number" min="0" id="svcMargen" value="0"><div style="font-size:.72rem;color:var(--muted)">Para recoger y cobrar.</div></div>
      </div>
      ${campoEspera('svc')}
      <div class="form-group"><label class="form-label">Quién puede prestarlo</label><div id="svcProviders" style="display:flex;flex-wrap:wrap;gap:.5rem"></div></div>
      <!-- ── LA PUERTA DE ENTRADA A LOS PUESTOS ─────────────────────────────────────────────────
           «Sillas y aparatos» nace OCULTA en la configuración del negocio y aparece sola cuando hay
           al menos uno de alta. Para el negocio que lo necesita y aún no lo sabe (el taller con dos
           elevadores), la puerta está AQUÍ: al decir que un servicio necesita un sitio o un aparato,
           se da de alta en el sitio, sin salir del modal y sin recargar. Es la única forma de que
           esconder la entrada no sea esconder la función. -->
      <div class="form-group"><label class="form-label">${escHtml(puestoSing)} necesario</label>
        <div id="svcResources" style="display:flex;flex-wrap:wrap;gap:.5rem"></div>
        <div id="svcAltaWrap" style="display:none;margin-top:.6rem;gap:.4rem;flex-wrap:wrap;align-items:flex-end">
          <div style="flex:1;min-width:150px"><label class="form-label" style="font-size:.72rem">Nombre</label><input class="form-control" id="svcAltaNombre" placeholder="${escHtml(puestoSing)} 1"></div>
          <div><label class="form-label" style="font-size:.72rem">Tipo</label><select class="form-control" id="svcAltaTipo"><option value="silla">Silla</option><option value="cabina">Cabina</option><option value="sala">Sala</option><option value="box">Box</option><option value="equipo">Equipo</option><option value="otro">Otro</option></select></div>
          <button type="button" class="btn btn-secondary btn-sm" id="svcAltaOk" onclick="svcAltaPuesto()">Dar de alta</button>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="svcAltaBtn" style="margin-top:.5rem" onclick="svcAltaAbrir()">＋ Dar de alta ${escHtml(puestoSing.toLowerCase())}</button>
        <div id="svcAltaAviso" style="display:none;margin-top:.5rem;font-size:.75rem;color:var(--muted)"></div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal('mSvc')">Cancelar</button><button class="btn btn-primary" onclick="svcGuardar()">Guardar</button></div>
  </div></div>`;

const modalNuevoServicio = () => `
  <div class="modal-overlay" id="mNuevoSvc"><div class="modal" style="max-width:560px">
    <div class="modal-head"><h3>Nuevo servicio</h3><button class="modal-close" onclick="closeModal('mNuevoSvc')">✕</button></div>
    <div class="modal-body">
      <div class="alert" style="font-size:.8rem">Se crea como producto de tu catálogo (tipo servicio). El precio y el IVA que pongas aquí son los del catálogo — luego puedes editarlos en Productos.</div>
      <div class="form-group"><label class="form-label">Nombre *</label><input class="form-control" id="nsNombre" placeholder="Corte de pelo, Manicura…"></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Precio *</label><input class="form-control" type="number" min="0" step="0.01" id="nsPrecio" value="0"></div>
        <div class="form-group"><label class="form-label">IVA</label><select class="form-control" id="nsIva"><option value="general">General (21%)</option><option value="reducido">Reducido (10%)</option><option value="superreducido">Superreducido (4%)</option><option value="exento">Exento (0%)</option></select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Tiempo contigo (min) *</label><input class="form-control" type="number" min="1" id="nsContigo" value="30"><div style="font-size:.72rem;color:var(--muted)">Los minutos que estás con el cliente.</div></div>
        <div class="form-group"><label class="form-label">Margen después (min)</label><input class="form-control" type="number" min="0" id="nsMargen" value="0"><div style="font-size:.72rem;color:var(--muted)">Para recoger y cobrar.</div></div>
      </div>
      ${campoEspera('ns')}
    </div>
    <div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal('mNuevoSvc')">Cancelar</button><button class="btn btn-primary" onclick="svcCrear()">Crear servicio</button></div>
  </div></div>`;

const modalRecurso = (puestoSing = 'Puesto') => `
  <div class="modal-overlay" id="mRec"><div class="modal" style="max-width:480px">
    <div class="modal-head"><h3 id="mRecTitle">Nuevo ${escHtml(puestoSing.toLowerCase())}</h3><button class="modal-close" onclick="closeModal('mRec')">✕</button></div>
    <div class="modal-body">
      <input type="hidden" id="recId">
      <div class="form-group"><label class="form-label">Nombre *</label><input class="form-control" id="recNombre"></div>
      <div class="form-group"><label class="form-label">Tipo</label><select class="form-control" id="recTipo"><option value="silla">Silla</option><option value="cabina">Cabina</option><option value="sala">Sala</option><option value="box">Box</option><option value="equipo">Equipo</option><option value="otro">Otro</option></select></div>
      <div class="form-group"><label class="form-label">Notas</label><input class="form-control" id="recNotas"></div>
    </div>
    <div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal('mRec')">Cancelar</button><button class="btn btn-primary" onclick="recGuardar()">Guardar</button></div>
  </div></div>`;

// ── JS de las vistas (cliente). Usa los helpers api()/toast()/openModal()/closeModal() del layout. ──
const JS_AGENDA = String.raw`
let META=null, DIAS=['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
function ymd(d){return d.toISOString().slice(0,10);}
function fhhmm(m){var h=Math.floor(m/60),mm=m%60;return (h<10?'0':'')+h+':'+(mm<10?'0':'')+mm;}
async function ensureMeta(){ if(!META) META=await api('GET','/api/erp/citas/meta'); return META; }
// P1 · segunda mitad: META se pedía UNA vez y se guardaba para siempre, así que el buscador NO
// encontraba a un cliente dado de alta después de cargar la pantalla —desde otra pestaña, o por la
// cita anterior—. Desde fuera eso se lee como «ese cliente no está registrado». Al abrir el panel de
// cita se refresca; si la red falla, se sigue con lo que había (el panel nunca se queda sin abrir).
async function refrescaMeta(){ try{ META=await api('GET','/api/erp/citas/meta'); }catch(e){} return META; }
function initDate(){ var el=document.getElementById('agFecha'); if(!el.value) el.value=ymd(new Date()); }
var COLOR={pedida:'#64748b',confirmada:'#16a34a',atendida:'#2563eb',no_show:'#b91c1c'};
function loadPrefs(){ try{ return JSON.parse(localStorage.getItem('agPrefs')||'{}'); }catch(e){ return {}; } }
// Las preferencias de la agenda viven TODAS en el mismo sitio (agPrefs): vista, eje, ver-todo, el
// paso de ZOOM y si se cerró el aviso de "sin horario". Un solo sitio, no un segundo sistema.
function savePrefs(extra){ try{ var p=loadPrefs(); var n=Object.assign({}, p, {vista:AG_VISTA, eje:document.getElementById('agEje').value, verTodo:document.getElementById('agVerTodo').checked}, extra||{}); localStorage.setItem('agPrefs', JSON.stringify(n)); }catch(e){} }
function agHoy(){ document.getElementById('agFecha').value=ymd(new Date()); agCargar(); }
function toggleControles(){ var c=document.getElementById('agControles'); c.style.display=(c.style.display==='none'||!c.style.display)?'flex':'none'; }
// ── A2 · LA VISTA ES ESTADO, NO UN CONTROL ────────────────────────────────────────────────────────
// Hasta hoy la vista vivía en el 'value' de un '<select>' escondido en «Filtros», y el grupo de
// botones de arriba solo lo escribía. Eran DOS mandos para una decisión, y el de abajo sobra.
// Retirado el '<select>', el estado vive aquí. 'AG_VISTA' es la única fuente: los botones la escriben
// con 'setVista', todo lo demás la lee con 'vistaActual()', y 'agPrefs' la guarda igual que antes
// (misma clave 'vista', así que a nadie se le pierde la preferencia que ya tenía).
var AG_VISTA='dia';
function vistaActual(){ return AG_VISTA; }
function setVista(v){ AG_VISTA=v; pintaBotonesVista(v); agCargar(); }
function pintaBotonesVista(v){
  ['dia','semana','mes'].forEach(function(x){
    var b=document.getElementById('vb'+x.charAt(0).toUpperCase()+x.slice(1)); if(!b) return;
    b.setAttribute('aria-selected', x===v ? 'true' : 'false');
  });
  // EL ZOOM S/M/L ES DE LA REJILLA: gradúa el alto de la HORA, y en el mes no hay horas que estirar.
  // Se quedaba a la vista sin hacer nada — que es justo lo que Ibrahin preguntó al ver la barra
  // («otros S,M,L que eso porque no entiendo»). Un control que no responde enseña a desconfiar de
  // toda la barra, así que en el mes no se enseña.
  var z=document.getElementById('agZoom'); if(z) z.style.display = (v==='mes') ? 'none' : '';
}
// Anterior/siguiente en la unidad que se está mirando: un día, una semana o un mes.
function agMover(n){
  var f=document.getElementById('agFecha'); var d=new Date((f.value||ymd(new Date()))+'T00:00:00Z');
  var v=vistaActual();
  if(v==='mes') d.setUTCMonth(d.getUTCMonth()+n);
  else d.setUTCDate(d.getUTCDate()+n*(v==='semana'?7:1));
  f.value=ymd(d); agCargar();
}
// Aviso de "sin horario": se enseña cuando el negocio no ha configurado ninguno. No bloquea nada.
function pintaSinHorario(sin){
  var el=document.getElementById('agSinHorario'); if(!el) return;
  // Solo mientras NO haya horario propio, Y si el usuario no lo ha cerrado.
  el.style.display = (sin && loadPrefs().avisoHorario!=='off') ? '' : 'none';
}
// ── CABECERA (BLOQUE 3) ─────────────────────────────────────────────────────
// El título grande manda: "Agosto 2026", mes en negro y año en gris. El selector de fecha sigue
// existiendo — lo abre el propio título.
// ── EL SALTO DE FECHA, EN DOS ALTURAS ────────────────────────────────────────────────────────────
// 'SALTO.nivel' dice qué se está enseñando: 'mes' (los doce meses de un año) o 'anio' (doce años).
// Pulsar el título de la hoja SUBE un nivel; elegir una casilla BAJA. Es exactamente lo que hace el
// calendario de un teléfono, y por eso no hay que explicarlo.
var SALTO = { abierto:false, nivel:'mes', anio:0 };
var MESES_CORTOS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function abrirFecha(){
  var caja=document.getElementById('agSalto');
  if(SALTO.abierto){ cierraSalto(); return; }
  var f=document.getElementById('agFecha').value||ymd(new Date());
  SALTO.abierto=true; SALTO.nivel='mes'; SALTO.anio=+f.slice(0,4);
  caja.removeAttribute('hidden'); pintaSalto();
  document.getElementById('agTitulo').setAttribute('aria-expanded','true');
  setTimeout(function(){ document.addEventListener('click', cierraSaltoFuera); }, 0);
}
function cierraSalto(){
  SALTO.abierto=false;
  var caja=document.getElementById('agSalto'); if(caja) caja.setAttribute('hidden','');
  var t=document.getElementById('agTitulo'); if(t) t.setAttribute('aria-expanded','false');
  document.removeEventListener('click', cierraSaltoFuera);
}
function cierraSaltoFuera(ev){
  if(ev.target.closest && (ev.target.closest('#agSalto') || ev.target.closest('#agTitulo'))) return;
  cierraSalto();
}
// Subir de nivel: de los meses a los años. Desde los años no hay más arriba.
function saltoSube(){ if(SALTO.nivel==='mes'){ SALTO.nivel='anio'; pintaSalto(); } }
// Las flechas mueven UN año en la hoja de meses y DOCE en la de años, que es lo que enseña cada una.
function saltoMueve(n){ SALTO.anio += (SALTO.nivel==='mes' ? n : n*12); pintaSalto(); }
function saltoPrimerAnio(){ return SALTO.anio - ((SALTO.anio % 12) + 12) % 12; }

function pintaSalto(){
  var tit=document.getElementById('agSaltoTit'), rej=document.getElementById('agSaltoRej');
  var hoy=new Date(), aHoy=hoy.getUTCFullYear(), mHoy=hoy.getMonth();
  var act=(document.getElementById('agFecha').value||ymd(hoy));
  var aAct=+act.slice(0,4), mAct=+act.slice(5,7)-1;
  if(SALTO.nivel==='mes'){
    tit.textContent=SALTO.anio;
    tit.title='Ver los años';
    rej.className='ag-salto-rej';
    rej.innerHTML=MESES_CORTOS.map(function(m,i){
      var cls=(i===mAct&&SALTO.anio===aAct?'sel ':'')+(i===mHoy&&SALTO.anio===aHoy?'hoy':'');
      return '<button type="button" class="'+cls+'" data-mes="'+i+'">'+m+'</button>';
    }).join('');
  } else {
    var a0=saltoPrimerAnio();
    tit.textContent=a0+' – '+(a0+11);
    tit.title='';
    rej.className='ag-salto-rej';
    rej.innerHTML=Array.from({length:12},function(_,i){
      var a=a0+i, cls=(a===aAct?'sel ':'')+(a===aHoy?'hoy':'');
      return '<button type="button" class="'+cls+'" data-anio="'+a+'">'+a+'</button>';
    }).join('');
  }
}
document.addEventListener('click', function(ev){
  var b=ev.target.closest && ev.target.closest('#agSaltoRej button');
  if(!b) return;
  ev.preventDefault(); ev.stopPropagation();
  if(b.hasAttribute('data-anio')){ SALTO.anio=+b.getAttribute('data-anio'); SALTO.nivel='mes'; pintaSalto(); return; }
  // Elegido el mes: se va al DÍA 1 salvo que el mes elegido sea el de la fecha en curso, en cuyo
  // caso no tiene sentido perder el día que se estaba mirando.
  var m=+b.getAttribute('data-mes');
  var act=document.getElementById('agFecha').value||ymd(new Date());
  var dia=(+act.slice(0,4)===SALTO.anio && +act.slice(5,7)-1===m) ? act.slice(8) : '01';
  // Un 31 en un mes de 30 no existe: se recorta al último día real de ese mes.
  var ultimo=new Date(Date.UTC(SALTO.anio, m+1, 0)).getUTCDate();
  if(+dia>ultimo) dia=String(ultimo);
  document.getElementById('agFecha').value=SALTO.anio+'-'+String(m+1).padStart(2,'0')+'-'+String(dia).padStart(2,'0');
  cierraSalto(); agCargar();
});
function pintaTitulo(){
  var f=document.getElementById('agFecha').value || ymd(new Date());
  var d=new Date(f+'T00:00:00Z');
  var t=document.getElementById('agTitulo'); if(!t) return;
  // El espacio entre mes y año es REAL, no solo un margen del CSS: así el título se lee «Agosto 2026»
  // también para un lector de pantalla y para quien lo compruebe por textContent.
  t.innerHTML='<span class="mes">'+esc(cap(d.toLocaleDateString('es-ES',{month:'long',timeZone:'UTC'})))+'</span> '
    +'<span class="anio">'+d.getUTCFullYear()+'</span>';
}
// ZOOM en tres pasos. Se recuerda con el resto de preferencias y repinta.
function setZoom(px){ savePrefs({zoom:px}); pintaZoom(); agCargar(); }
function pintaZoom(){
  var z=altoHora();
  [48,72,96].forEach(function(x){ var b=document.getElementById('zb'+x); if(b) b.setAttribute('aria-selected', x===z?'true':'false'); });
}
// El aviso de "sin horario" se puede cerrar, y se recuerda. Sigue apareciendo solo mientras el
// negocio NO tenga horario propio: el día que lo defina, desaparece por sí solo.
function cerrarSinHorario(){ savePrefs({avisoHorario:'off'}); document.getElementById('agSinHorario').style.display='none'; }
// TIRA DE 7 DÍAS (solo en vista Día): saltar de día sin abrir el selector.
function pintaTira(vista){
  var t=document.getElementById('agTira'); if(!t) return;
  if(vista!=='dia'){ t.setAttribute('hidden',''); t.innerHTML=''; return; }
  t.removeAttribute('hidden');
  var sel=document.getElementById('agFecha').value||ymd(new Date()), hoy=ymd(new Date());
  var d=new Date(sel+'T00:00:00Z'); var lun=new Date(d.getTime()-((d.getUTCDay()+6)%7)*86400000);
  var lab=['L','M','X','J','V','S','D'];
  var noLab=(window.AG_TRAMOS_DOW||null);
  var h='';
  for(var i=0;i<7;i++){
    var f=ymd(new Date(lun.getTime()+i*86400000));
    var findes=(noLab&&noLab.indexOf((i+1)%7)<0) || (!noLab && i>=5);
    h+='<button type="button" class="'+(f===hoy?'hoy ':'')+(f===sel?'sel ':'')+(findes?'findes':'')+'" data-fecha="'+f+'" onclick="irA(\''+f+'\')" aria-label="'+esc(fLargoDia(f))+'">'
      +'<span class="dow">'+lab[i]+'</span><span class="n">'+f.slice(8).replace(/^0/,'')+'</span></button>';
  }
  t.innerHTML=h;
}
function irA(f){ document.getElementById('agFecha').value=f; agCargar(); }
// P2 — RUEDA / GESTO VERTICAL sobre la rejilla del mes: un mes por gesto, con freno. Solo en Mes: en
// Día y Semana la rueda tiene que seguir desplazando el lienzo, que es lo que se espera de ella.
var _ruedaFreno=0;
var _toque=null;
// ── CABO 5 · LAS CITAS DE UN CLIENTE ─────────────────────────────────────────────────────────────
// Se llega desde su ficha con ?cliente=<id>. El filtro se VE (un chip encima del lienzo) y se QUITA
// de un clic. A propósito NO se mete entre los filtros de eje («por persona / por puesto» y «ver todo
// el equipo»): aquellos son cómo se reparte la rejilla y este es qué citas entran — mezclarlos haría
// que quitar uno pareciera quitar el otro. Y no toca la URL con history.replaceState para no
// romperle el «atrás» a quien viene de la ficha: se recarga limpia.
var AG_CLIENTE=(function(){ try{ return parseInt(new URLSearchParams(location.search).get('cliente'),10)||0; }catch(e){ return 0; } })();
function pintaChipCliente(cli){
  var box=document.getElementById('agChipCliente'); if(!box) return;
  if(!AG_CLIENTE || !cli){ box.style.display='none'; box.innerHTML=''; return; }
  box.style.display='flex';
  box.innerHTML='<span class="ag-chip">Solo las citas de <b>'+esc(cli.name)+'</b>'
    +'<button type="button" title="Quitar el filtro" onclick="quitaChipCliente()">✕</button></span>';
}
function quitaChipCliente(){ location.href='/admin/citas'; }
function mesToqueIni(ev){
  _toque=null;
  if(vistaActual()!=='mes') return;
  if(!ev.target.closest || !ev.target.closest('.mes')) return;
  if(ev.touches.length!==1) return;                       // dos dedos son un zoom, no un deslizamiento
  var t=ev.touches[0];
  if(t.clientX < 24 || t.clientX > window.innerWidth-24) return;   // borde: es del navegador, no nuestro
  _toque={ x:t.clientX, y:t.clientY, t:Date.now() };
}
function mesToqueMueve(ev){
  if(!_toque || vistaActual()!=='mes') return;
  var t=ev.touches && ev.touches[0]; if(!t) return;
  var dx=Math.abs(t.clientX-_toque.x), dy=Math.abs(t.clientY-_toque.y);
  if(dx > 24 && dx > dy*1.5 && ev.cancelable) ev.preventDefault();
}
function mesToqueFin(ev){
  var ini=_toque; _toque=null;
  if(!ini || vistaActual()!=='mes') return;
  var t=(ev.changedTouches&&ev.changedTouches[0]); if(!t) return;
  var dx=t.clientX-ini.x, dy=t.clientY-ini.y;
  if(Math.abs(dx) < 60) return;                            // recorrido corto: no es un gesto
  if(Math.abs(dx) < Math.abs(dy)*1.5) return;              // más vertical que horizontal: es scroll
  if(Date.now()-ini.t > 800) return;                       // arrastre lento: tampoco es un gesto
  agMover(dx < 0 ? 1 : -1);                                // hacia la izquierda = mes siguiente
}
function ruedaMes(ev){
  if(vistaActual()!=='mes') return;
  if(!ev.target.closest || !ev.target.closest('.mes')) return;
  if(Math.abs(ev.deltaY) < 12) return;
  ev.preventDefault();
  var ahora=Date.now();
  if(ahora-_ruedaFreno < 450) return;      // el freno: un trackpad manda decenas de eventos por gesto
  _ruedaFreno=ahora;
  agMover(ev.deltaY>0 ? 1 : -1);
}
async function agCargar(){
  initDate(); await ensureMeta(); savePrefs();
  var vista=vistaActual(), eje=document.getElementById('agEje').value;
  pintaBotonesVista(vista); pintaZoom(); pintaTitulo(); pintaTira(vista);
  var f0=document.getElementById('agFecha').value;
  // La leyenda es de la rejilla; en el mes no pinta nada. Y ya no ocupa línea fija: se despliega
  // con la (i), así que aquí solo se esconde su botón cuando no aplica.
  var lb=document.getElementById('agLeyBtn'); if(lb) lb.style.display = vista==='mes' ? 'none' : '';
  // P3 — el zoom es del LIENZO: en Mes no pinta nada, así que no se enseña.
  var zc=document.querySelector('.ag-zoomwrap'); if(zc) zc.style.display = vista==='mes' ? 'none' : 'flex';
  if(vista==='mes'){
    // El mes hereda los MISMOS filtros que Día: si aquí no ves una cita, en Mes tampoco.
    var q='?ym='+f0.slice(0,7)+'&eje='+encodeURIComponent(eje)+'&verTodo='+(document.getElementById('agVerTodo').checked?'1':'0');
    var data=await api('GET','/api/erp/citas/mes'+q);
    pintaSinHorario(!!data.sin_horario);
    renderMes(data, f0);
    return;
  }
  var desde=f0, hasta=f0;
  if(vista==='semana'){ var d=new Date(f0+'T00:00:00Z'); var dow=d.getUTCDay(); var mon=new Date(d.getTime()-((dow+6)%7)*86400000); desde=ymd(mon); hasta=ymd(new Date(mon.getTime()+6*86400000)); }
  var data=await api('GET','/api/erp/citas/agenda?desde='+desde+'&hasta='+hasta+(AG_CLIENTE?('&cliente='+AG_CLIENTE):''));
  pintaChipCliente(data.cliente);
  pintaSinHorario(!!data.sin_horario);
  render(data, desde, hasta, vista, eje);
}
// ── VISTA DE MES ────────────────────────────────────────────────────────────
// Un calendario normal: cuántas citas tiene cada día y cuánto hueco queda. Pulsar un día abre ESE día
// en la vista de Día — que es donde se crea la cita pulsando el hueco. El mes orienta; el día opera.
var DIAS_CAB=['L','M','X','J','V','S','D'];
function horas(min){
  if(!min) return 'sin hueco libre';
  var h=Math.floor(min/60), m=min%60;
  var t=(h?h+' h':'') + (h&&m?' ':'') + (m?m+' min':'');
  // «9 h libres», «1 h libre», «45 min libres». El singular se reserva para cuando de verdad hay UNA.
  var uno=(h===1&&m===0)||(h===0&&m===1);
  return t + (uno?' libre':' libres');
}
function citasTxt(n){ return n ? (n===1?'1 cita':n+' citas') : 'sin citas'; }
// ── A1 · NINGUNA CIFRA DESNUDA: EL PIE DICE SU BASE ───────────────────────────────────────────────
// El número NO cambia y el cálculo NO se toca: 168 h eran correctas —720 min de apertura × 14
// personas—. Lo que fallaba es que nadie podía saber que estaba leyendo CAPACIDAD DE EQUIPO y no las
// horas del día, y «168 h libres» en una casilla de un martes se lee como un error del programa.
// Es la misma regla que CANON ya impone a los márgenes: toda cifra declara sobre qué está calculada.
//   · una sola persona → no hay base que declarar: son las horas del día. «12 h libres».
//   · con equipo       → manda la OCUPACIÓN (que sí es comparable entre días) y la capacidad va
//                        detrás, explícita: «0 % ocupado (168 h libres entre 14 personas)».
//   · cerrado          → «Cerrado». Nunca «0 h libre»: un negocio cerrado no tiene cero huecos, no
//                        tiene día.
function libreTxt(d){
  if(!d.abierto) return 'Cerrado';
  var libre=horas(d.libres_min);
  var n=d.personas_abiertas||1;
  if(n<=1) return libre;
  var cap=d.capacidad_min||0;
  var pct=cap?Math.round(((cap-d.libres_min)/cap)*100):0;
  return pct+' % ocupado ('+libre+' entre '+n+' personas)';
}
// Lo que dice la casilla entera: cuántas citas y cómo está el día. En un día cerrado sin citas el
// «sin citas» sobra —lo dice ya el «Cerrado»— y quitarlo deja la frase más corta y más clara.
function resumenDia(d){
  if(!d.abierto) return d.citas ? citasTxt(d.citas)+' · Cerrado' : 'Cerrado';
  return citasTxt(d.citas)+' · '+libreTxt(d);
}
// Solo la PRIMERA letra. El text-transform capitalize de CSS ponía «Agosto De 2026» y «Sábado, 15 De Agosto».
function cap(s){ return s ? s.charAt(0).toUpperCase()+s.slice(1) : s; }
function fLargoDia(f){
  try{ return cap(new Date(f+'T00:00:00Z').toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'})); }
  catch(e){ return f; }
}
// ══ MES (BLOQUE 4) ════════════════════════════════════════════════════════════════════════════════
// El mes tiene que decir QUÉ PASA cada día sin pasar el ratón por encima: hasta 3 citas escritas
// («9:00 · Ana Ruiz» con el punto de su estado) y «+N más» si hay cuarta. Si el día no tiene citas la
// celda no dice nada — el silencio es información.
// FUERA el title nativo del navegador (era el "globo" que había que esperar) y FUERA el pie que
// seguía al ratón: el pie es del día SELECCIONADO. Un clic selecciona; dos (o «Abrir el día») abren.
function renderMes(data, fechaSel){
  var box=document.getElementById('agenda');
  var dias=data.dias||[]; if(!dias.length){ box.textContent='No hay nada que mostrar.'; return; }
  var hoy=ymd(new Date());
  var primero=new Date(dias[0].fecha+'T00:00:00Z');
  var hueco=(primero.getUTCDay()+6)%7;   // el lunes va primero (locale ES)
  // P3 — FUERA el segundo «Agosto 2026» dentro de la tarjeta: el título grande de la cabecera ya lo
  // dice, y repetirlo a 20 px era decir dos veces lo mismo.
  // A5 · las filas son las semanas REALES del mes, y se reparten el alto entre ellas.
  var sobran=(7-((hueco+dias.length)%7))%7;
  var semanas=(hueco+dias.length+sobran)/7;
  var html='<div class="mes">'
    +'<div class="mes-cab">'+DIAS_CAB.map(function(d){ return '<span>'+d+'</span>'; }).join('')+'</div>'
    +'<div class="mes-rej" style="grid-template-rows:repeat('+semanas+',1fr)">';
  // Una casilla del mes = envoltorio '.mescel' + botón '.mesdia' dentro (+ el botón de crear, si toca).
  // El envoltorio existe por A8: «+ Nueva cita» tiene que ser un botón de verdad para llegar con el
  // teclado, y no puede ir dentro del botón del día.
  function celda(cls, fecha, res, num, lineas, cerrado, ofreceAlta){
    return '<div class="mescel">'
      + '<button type="button" class="'+cls+'" data-fecha="'+fecha+'" data-res="'+esc(res)+'"'
      +   (cerrado?' disabled':'')+' aria-label="'+esc(fLargoDia(fecha)+(res?', '+res:''))+'">'
      +   '<span class="num">'+num+'</span>'+(lineas||'')
      + '</button>'
      + (ofreceAlta ? '<button type="button" class="mes-add" data-nueva="'+fecha+'" tabindex="0"'
          + ' aria-label="Nueva cita el '+esc(fLargoDia(fecha))+'">'
          + '<span class="larga">+ Nueva cita</span><span class="corta" aria-hidden="true">+</span></button>' : '')
      + '</div>';
  }
  // Los días del mes ANTERIOR que completan la primera semana: los más apagados, y sin ofrecer alta.
  for(var i=hueco;i>0;i--){
    var pf=ymd(new Date(primero.getTime()-i*86400000));
    html+=celda('mesdia otro', pf, 'Otro mes', +pf.slice(8), '', false, false);
  }
  dias.forEach(function(d){
    // A4 · la cara del día la decide si está ABIERTO, no si cae en fin de semana. Un sábado abierto
    // se pinta como cualquier laborable; un día cerrado lleva su trama, sea martes o domingo.
    var cls='mesdia'+(d.fecha===hoy?' hoy':'')+(d.fecha===fechaSel?' sel':'')+(d.abierto?'':' cerrado');
    var resumen=resumenDia(d);
    // Hasta TRES escritas; la cuarta se resume. El total exacto sigue en el aria-label y en el pie.
    var lineas='';
    (d.primeras||[]).slice(0,3).forEach(function(x){
      var col=(window.CITA_ESTADOS||{})[x.estado]||{fuerte:'#64748b'};
      // ARRASTRABLE (21 ago 2026). Una cita se coge de aquí y se suelta en otro día: cambia de día
      // y CONSERVA SU HORA. Las anuladas y las atendidas no se mueven — el motor las rechaza, así
      // que ni se ofrecen (una anulada no llega hasta aquí, pero una atendida sí).
      var movible = window.CITAS_EDIT && x.estado!=='atendida' && x.estado!=='anulada';
      lineas+='<span class="lin'+(movible?' movible':'')+'"'
        +(movible?' draggable="true" data-cita="'+x.id+'" data-min="'+x.min+'" data-quien="'+esc(x.cliente)+'"':'')
        +'><span class="pt" style="background:'+col.fuerte+'"></span>'
        +'<b style="font-weight:600">'+hcorta(x.min)+'</b> '
        +'<span class="cli">'+esc(x.cliente)+'</span>'
        +(x.servicio?'<span class="svc">'+esc(x.servicio)+'</span>':'')+'</span>';
    });
    if(d.citas>3) lineas+='<span class="mas" data-abre="'+d.fecha+'">+'+(d.citas-3)+' más</span>';
    // UN DÍA CERRADO CON CITAS SÍ SE PUEDE ABRIR. Lo dejó a la vista la pantalla, no una aserción:
    // el 26 pasó a enseñar sus dos citas y seguía siendo una casilla muerta — se veían y no había
    // forma de llegar a ellas. Cerrado y sin citas sigue apagado; cerrado CON citas se selecciona y
    // se abre como cualquier otro. Lo que NO se ofrece es crear: para eso el día tiene que abrir.
    var muerto = !d.abierto && !d.citas;
    html+=celda(cls, d.fecha, resumen, d.dia, lineas, muerto, !!(d.abierto && window.CITAS_EDIT));
  });
  // Y los del mes SIGUIENTE hasta cerrar la última semana.
  var ultimo=new Date(dias[dias.length-1].fecha+'T00:00:00Z');
  for(var j=1;j<=sobran;j++){
    var nf=ymd(new Date(ultimo.getTime()+j*86400000));
    html+=celda('mesdia otro', nf, 'Otro mes', +nf.slice(8), '', false, false);
  }
  html+='</div><div class="mes-pie" id="mesPie"></div></div>';
  box.innerHTML=html;

  // EL PIE — del día SELECCIONADO, no del que señala el ratón. Los números exactos viven aquí.
  var pie=document.getElementById('mesPie');
  function pintaPie(f){
    var b=box.querySelector('.mesdia[data-fecha="'+f+'"]');
    if(!b){ pie.innerHTML=''; return; }
    pie.innerHTML='<span class="d">'+esc(fLargoDia(f))+'</span>'
      +'<span class="s">'+esc(b.getAttribute('data-res'))+'</span>'
      +(b.disabled?'':'<button type="button" class="a" onclick="abrirDia(\''+f+'\')">Abrir el día &rarr;</button>');
  }
  pintaPie(fechaSel);
  [].forEach.call(box.querySelectorAll('.mesdia'), function(b){
    var f=b.getAttribute('data-fecha');
    b.addEventListener('focus', function(){ selDia(f); });
    if(b.disabled) return;
    // UN clic selecciona (y actualiza el pie). DOS abren el día.
    // A7 · SALVO si el clic salió del «+N más»: eso abre el día directamente, que es lo que promete.
    // Se resuelve aquí y no con un botón propio porque «+N más» vive DENTRO del botón del día, y un
    // botón dentro de otro botón no es HTML válido.
    b.addEventListener('click', function(ev){
      var mas=ev.target.closest && ev.target.closest('.mas');
      if(mas && b.contains(mas)){ ev.preventDefault(); ev.stopPropagation(); abrirDia(f); return; }
      selDia(f);
    });
    b.addEventListener('dblclick', function(){ abrirDia(f); });
  });
  // A8 · CREAR DESDE EL MES. El día se hereda de la casilla, igual que la vista Día hereda hora y
  // persona del hueco que se pulsa. Solo existe en las casillas abiertas del mes (ver 'celda'), así
  // que aquí no hay que volver a comprobar si el día admite citas.
  [].forEach.call(box.querySelectorAll('.mes-add'), function(b){
    b.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); mesNueva(b.getAttribute('data-nueva')); });
  });

  // ── MOVER UNA CITA DE UN DÍA A OTRO, ARRASTRÁNDOLA ────────────────────────────────────────────
  // Faltaba entera: en Mes no había ni una cita arrastrable ni una zona donde soltarla. Se cambia
  // el DÍA y se conserva la HORA (una casilla de mes no tiene hora que heredar), y se guarda por el
  // MISMO endpoint que usan arrastrar y estirar en el lienzo. No hay un segundo camino de guardado.
  [].forEach.call(box.querySelectorAll('.lin.movible'), function(l){
    l.addEventListener('dragstart', function(ev){
      ev.stopPropagation();
      ev.dataTransfer.setData('text/plain', l.getAttribute('data-cita')+':'+l.getAttribute('data-min'));
      ev.dataTransfer.effectAllowed='move';
      l.classList.add('arrastrando');
    });
    l.addEventListener('dragend', function(){ l.classList.remove('arrastrando'); limpiaDiana(box); });
    // Y con el DEDO, que el arrastre de HTML5 no cubre (ver 'arrastreDedo').
    l.addEventListener('pointerdown', function(ev){
      arrastreDedo(ev, l, l.getAttribute('data-cita'), parseInt(l.getAttribute('data-min'),10), 'mes');
    });
  });
  [].forEach.call(box.querySelectorAll('.mesdia'), function(cel){
    if(cel.disabled || cel.classList.contains('otro')) return;      // ni cerrado ni de otro mes
    cel.addEventListener('dragover', function(ev){ ev.preventDefault(); ev.dataTransfer.dropEffect='move'; cel.classList.add('diana'); });
    cel.addEventListener('dragleave', function(){ cel.classList.remove('diana'); });
    cel.addEventListener('drop', function(ev){
      ev.preventDefault(); ev.stopPropagation(); cel.classList.remove('diana');
      var dato=(ev.dataTransfer.getData('text/plain')||'').split(':');
      if(dato.length!==2) return;
      moverCitaADia(dato[0], cel.getAttribute('data-fecha'), parseInt(dato[1],10));
    });
  });
  function selDia(f){
    [].forEach.call(box.querySelectorAll('.mesdia'), function(x){ x.classList.toggle('sel', x.getAttribute('data-fecha')===f); });
    pintaPie(f);
  }
  window.__mesSel=selDia;
}
// ════════════════════════════════════════════════════════════════════════════════════════════════
// ARRASTRAR UNA CITA CON EL DEDO — el agujero que dejaba la agenda inservible en tableta y móvil
// ════════════════════════════════════════════════════════════════════════════════════════════════
// EL PROBLEMA, Y POR QUÉ NO SE VEÍA DESDE UN ESCRITORIO: mover una cita se hacía con el arrastre de
// HTML5 ('draggable' + 'drop'), que es UN INVENTO DE RATÓN. Con el dedo no dispara NADA: ni un
// evento, ni un error, ni un aviso. Así que en una tableta la agenda parecía no dejar mover nada, y
// desde un ordenador funcionaba perfectamente. El arrastre nativo se QUEDA (es el que ya estaba
// probado para ratón); esto es el camino del dedo, en paralelo, y sirve para las tres vistas.
//
// EMPIEZA CON UNA PULSACIÓN MANTENIDA, y no al primer roce. Es el patrón de Google Calendar en
// móvil, y no es capricho: si el arrastre arrancara al primer movimiento habría que bloquear el
// scroll de la pantalla sobre cada cita, y entonces una agenda llena de citas sería una agenda por
// la que no se puede bajar con el dedo. Manteniendo pulsado 350 ms el navegador aún no ha empezado
// a desplazar nada, así que se le puede quitar el gesto sin pelearse con él.
//
// EL ASA DE ESTIRAR NO SE TOCA: su 'pointerdown' hace stopPropagation, así que cuando el dedo cae en
// el asa esto ni se entera. Y un toque corto tampoco dispara nada: sigue abriendo la cita.
var ARR = null;                                  // el arrastre en curso (solo puede haber uno)
var ARR_MS = 350;                                // lo que hay que mantener pulsado para empezar

function limpiaDiana(box){
  [].forEach.call((box||document).querySelectorAll('.diana'), function(x){ x.classList.remove('diana'); });
}
// Qué hay debajo del dedo. El fantasma se aparta un instante: si no, se encuentra a sí mismo.
function bajoElDedo(x, y, sel){
  var f = ARR && ARR.fantasma;
  if(f) f.style.display='none';
  var el = document.elementFromPoint(x, y);
  if(f) f.style.display='';
  return el && el.closest ? el.closest(sel) : null;
}

function arrastreDedo(ev, el, id, min, modo){
  if(!window.CITAS_EDIT) return;
  if(ev.pointerType === 'mouse') return;         // con ratón manda el arrastre nativo, que ya existía
  if(ARR) return;
  var x0=ev.clientX, y0=ev.clientY;
  var sel = modo==='mes' ? '.mesdia:not(.otro):not(:disabled)' : '.agcell';
  ARR = { id:id, min:min, modo:modo, el:el, sel:sel, vivo:false, fantasma:null, destino:null };

  // Si el dedo se va antes de tiempo, esto NO era un arrastre: era un toque o un scroll.
  var espera = setTimeout(function(){
    if(!ARR) return;
    ARR.vivo = true;
    el.classList.add('arrastrando');
    var f = document.createElement('div');
    f.className='ag-fantasma';
    f.textContent = el.getAttribute('data-quien') || (el.querySelector && el.querySelector('.cli') ? el.querySelector('.cli').textContent : 'Cita');
    document.body.appendChild(f);
    f.style.left=x0+'px'; f.style.top=y0+'px';
    ARR.fantasma = f;
    if(navigator.vibrate) { try { navigator.vibrate(12); } catch(e){} }
  }, ARR_MS);

  var mover=function(e){
    if(!ARR) return;
    if(!ARR.vivo){
      // Se movió antes de tiempo: no hay arrastre, y el navegador se queda con su gesto.
      if(Math.abs(e.clientX-x0)>8 || Math.abs(e.clientY-y0)>8) { clearTimeout(espera); fin(); }
      return;
    }
    if(e.cancelable) e.preventDefault();          // ya es nuestro: nada de scroll
    ARR.fantasma.style.left=e.clientX+'px';
    ARR.fantasma.style.top=e.clientY+'px';
    var d = bajoElDedo(e.clientX, e.clientY, ARR.sel);
    if(d !== ARR.destino){
      limpiaDiana();
      ARR.destino = d;
      if(d) d.classList.add('diana');
    }
  };
  var soltar=function(e){
    clearTimeout(espera);
    if(!ARR){ return; }
    var vivo=ARR.vivo, destino=ARR.destino, id=ARR.id, min=ARR.min, modo=ARR.modo;
    fin();
    if(!vivo || !destino) return;                 // un toque, o soltó fuera: no pasa nada
    if(modo==='mes') moverCitaADia(id, destino.getAttribute('data-fecha'), min);
    else moverCitaAHueco(id, destino);
  };
  function fin(){
    document.removeEventListener('pointermove', mover);
    document.removeEventListener('pointerup', soltar);
    document.removeEventListener('pointercancel', soltar);
    if(ARR){
      if(ARR.fantasma && ARR.fantasma.parentNode) ARR.fantasma.parentNode.removeChild(ARR.fantasma);
      ARR.el.classList.remove('arrastrando');
    }
    limpiaDiana();
    ARR=null;
  }
  document.addEventListener('pointermove', mover, { passive:false });
  document.addEventListener('pointerup', soltar);
  document.addEventListener('pointercancel', soltar);
}

// GUARDAR — un solo camino para las tres vistas y para los dos gestos (ratón y dedo). Si el servidor
// dice que no (choca con otra cita, el puesto está pillado), se dice y NO se repinta como si hubiera
// ido bien: la agenda nunca enseña algo que no está en la base.
async function moverCitaADia(id, fecha, min){
  if(!fecha || !id) return;
  try{ await api('POST','/api/erp/citas/'+id+'/mover',{ fecha:fecha, inicio_min:min }); toast('Cita movida al '+fecha.slice(8).replace(/^0/,'')); agCargar(); }
  catch(e){ toast(e.message,'err'); }
}
async function moverCitaAHueco(id, cel){
  var body={ fecha:cel.dataset.fecha, inicio_min:parseInt(cel.dataset.min,10) };
  if(cel.dataset.col!==undefined && vistaActual()!=='semana'){
    var eje=document.getElementById('agEje').value;
    if(eje==='recurso') body.recurso_id=cel.dataset.col||null; else body.user_id=cel.dataset.col||null;
  }
  try{ await api('POST','/api/erp/citas/'+id+'/mover',body); toast('Cita movida'); agCargar(); }
  catch(e){ toast(e.message,'err'); }
}
function abrirDia(f){ document.getElementById('agFecha').value=f; setVista('dia'); }
// A8 · «+ Nueva cita» desde una casilla del mes: se pone ESE día como fecha de trabajo y se abre el
// alta de siempre. No hay un segundo formulario de cita: es 'openNuevaCita', que ya lee '#agFecha'.
// La hora NO se hereda (una casilla de mes no tiene hora) y por eso el alta la sigue preguntando —
// al revés que desde un hueco de la vista Día, donde sí se sabe y no se vuelve a preguntar.
function mesNueva(f){
  if(!window.CITAS_EDIT) return;
  document.getElementById('agFecha').value=f;
  if(window.__mesSel) window.__mesSel(f);
  openNuevaCita();
}
function colDefs(eje, data){
  if(eje==='recurso'){ return [{id:null,nombre:'Sin '+(window.PUESTO_SING||'puesto').toLowerCase()}].concat(META.recursos.map(r=>({id:r.id,nombre:r.nombre}))); }
  var verTodo=document.getElementById('agVerTodo').checked;
  var base = (!verTodo && data && data.personasDia) ? data.personasDia : META.personas;
  var list = base.map(p=>({id:p.id,nombre:p.name}));
  return list.length ? list : META.personas.map(p=>({id:p.id,nombre:p.name}));   // nunca dejar la agenda sin columnas
}
// ══ EL LIENZO (BLOQUE 1 + 2) ══════════════════════════════════════════════════════════════════════
// Ya no es una tabla de filas de media hora: es un lienzo continuo donde cada cita se coloca por sus
// MINUTOS REALES. Una cita a las 9:10 se dibuja a las 9:10.
//
// LO QUE SIGUE SIENDO DE 30 MINUTOS, A PROPÓSITO: las zonas de clic (.agcell.libre). Al pulsar un
// hueco la cita se crea en punto o y media, que es lo que la gente espera. Lo que pasó a minutos
// reales es el DIBUJO, no el alta.
//
// EL APILADO IMPORTA Y NO ES COSMÉTICO: las zonas de clic van en z-index 1 y las citas en z-index 3.
// Si las zonas quedaran encima, pulsar una cita abriría el alta de una cita NUEVA en vez de esa cita,
// y arrastrar para mover dejaría de funcionar. El gate lo comprueba.
function altoHora(){ var z=parseInt(loadPrefs().zoom); return (z===48||z===72||z===96)?z:72; }
function render(data, desde, hasta, vista, eje){
  var box=document.getElementById('agenda');
  var dates=[]; var d0=new Date(desde+'T00:00:00Z'); var dN=new Date(hasta+'T00:00:00Z');
  for(var d=new Date(d0); d<=dN; d=new Date(d.getTime()+86400000)) dates.push(ymd(d));
  // La rejilla la manda el horario del negocio (data.rango), que calcula el servidor con el mismo
  // motor. Sin horario configurado viene con el 8–21 por defecto.
  var R=(data&&data.rango)||{ini:8*60,fin:21*60};
  var START=R.ini, END=R.fin, H=altoHora(), PXMIN=H/60, STEP=30;
  var clickable = vista==='dia' && eje==='persona' && window.CITAS_EDIT;
  var cols = vista==='semana'
    ? dates.map(dt=>({key:dt,label:DIAS[new Date(dt+'T00:00:00Z').getUTCDay()]+' '+dt.slice(8),fecha:dt,colId:undefined}))
    : colDefs(eje,data).map(c=>({key:c.id===null?'null':String(c.id),label:c.nombre,colId:c.id,fecha:desde}));
  var alto=(END-START)*PXMIN;

  // Cabeceras: clase ESTABLE .agcol-head con su data-col. Y se quedan fijas al hacer scroll, junto
  // con la columna de horas — lo que la <table> daba gratis y en un lienzo hay que pedir a mano: a
  // las 18:00 tienes que seguir sabiendo de quién es cada columna.
  var html='<div class="ag-wrap" id="agWrap" style="--alto-hora:'+H+'px">'
    +'<div class="ag-head"><div class="esq"></div>'
    + cols.map(function(c){ return '<div class="agcol-head" data-col="'+esc(c.colId==null?(vista==='semana'?c.key:''):c.colId)+'" title="'+esc(c.label)+'">'+esc(c.label)+'</div>'; }).join('')
    +'</div><div class="ag-body" style="height:'+alto+'px">';

  // Columna de horas: SOLO la hora en punto lleva texto, formato 9:00 (no 09:00), a caballo de su
  // línea (-6px) y no dentro de una celda con borde.
  var horasHtml='';
  for(var t=Math.ceil(START/60)*60; t<=END; t+=60) horasHtml+='<div class="ag-hora" style="top:'+((t-START)*PXMIN)+'px">'+hcorta(t)+'</div>';
  html+='<div class="ag-horas" style="height:'+alto+'px"><div class="ag-hrel">'+horasHtml+'</div></div><div class="ag-cols">';

  for(var ci=0;ci<cols.length;ci++){
    var col=cols[ci];
    var fecha = vista==='semana' ? col.key : desde;
    var celdas='';
    // Fuera de horario: se atenúa, no se bloquea. Se sigue pudiendo citar ahí.
    (fueraDe(data, fecha, col, eje, vista, START, END)||[]).forEach(function(f){
      celdas+='<div class="ag-fuera" style="top:'+((f[0]-START)*PXMIN)+'px;height:'+((f[1]-f[0])*PXMIN)+'px"></div>';
    });
    for(var t2=START;t2<END;t2+=STEP){
      var attrs = vista==='semana' ? 'data-fecha="'+col.key+'"' : ('data-fecha="'+desde+'" data-col="'+(col.colId==null?'':col.colId)+'"');
      celdas+='<div class="agcell'+(clickable?' libre':'')+'" '+attrs+' data-min="'+t2+'"'
        +(clickable?' onclick="cellNueva(this)" tabindex="0" role="button" aria-label="Crear cita a las '+fhhmm(t2)+'"':'')
        +' style="top:'+((t2-START)*PXMIN)+'px;height:'+(STEP*PXMIN)+'px" ondragover="event.preventDefault()" ondrop="onDrop(event)"></div>';
    }
    html+='<div class="ag-col" data-colkey="'+esc(col.key)+'" data-fecha="'+esc(fecha)+'">'+celdas+'</div>';
  }
  html+='</div></div></div>';
  box.innerHTML=html;

  // Con teclado también se crea: el hueco lleva role=button y responde a Enter y a Espacio.
  [].forEach.call(box.querySelectorAll('.agcell.libre'), function(td){
    td.addEventListener('keydown', function(ev){
      if(ev.key!=='Enter' && ev.key!==' ') return;
      ev.preventDefault(); cellNueva(td);
    });
  });

  // ── EL REPARTO DE LAS QUE CHOCAN (cabo 1) ──────────────────────────────────
  // ANTES: toda cita se pintaba a left:4px + right:4px, o sea el ancho entero de su columna. Dos a
  // la misma hora quedaban UNA ENCIMA DE OTRA y la de abajo desaparecía. Medido antes de tocar nada:
  // mismas coordenadas, 36 px tapados.
  //
  // AHORA, el algoritmo de siempre (el de Google Calendar y Outlook; no se inventa otro):
  //   1. Se agrupan las que chocan ENTRE SÍ. Un grupo se cierra cuando una empieza en o después del
  //      final más lejano visto hasta ahora — por eso «empieza justo cuando la otra acaba» NO es
  //      choque: la comparación es estricta.
  //   2. Dentro del grupo, cada cita cae en la primera sub-columna libre a su hora.
  //   3. TODAS las del grupo salen con el MISMO ancho: 1/n del ancho de la columna, con n = cuántas
  //      sub-columnas hicieron falta. Es el mayor ancho posible sin que ninguna se pise.
  // Encadenadas (A choca con B, B con C, A no con C) caen solas: A y C comparten sub-columna porque
  // no se pisan, y el grupo entero mide 2. Una larga que cruza varias cortas, igual.
  //
  // ESTO NO TOCA EL REPARTO POR PERSONA/PUESTO: se aplica DENTRO de cada columna, sea la columna una
  // persona, un puesto o —en la vista SEMANA— un día. En semana eso significa, de regalo, que dos
  // citas de PERSONAS DISTINTAS a la misma hora dejan de taparse y se ven las dos.
  function repartirChoques(lista){
    var xs = lista.slice().sort(function(a,b){
      return (a.inicio_min-b.inicio_min) || ((b.dur_min||0)-(a.dur_min||0)) || (a.id-b.id);
    });
    var grupos=[], actual=[], finMax=-1;
    xs.forEach(function(c){
      var fin = c.inicio_min + Math.max(1, c.dur_min||0);
      if(actual.length && c.inicio_min >= finMax){ grupos.push(actual); actual=[]; finMax=-1; }
      actual.push(c); finMax = Math.max(finMax, fin);
    });
    if(actual.length) grupos.push(actual);
    grupos.forEach(function(g){
      var libres=[];                                  // libres[k] = fin de la última puesta en la sub-columna k
      g.forEach(function(c){
        var fin = c.inicio_min + Math.max(1, c.dur_min||0);
        var k=0; while(k<libres.length && libres[k] > c.inicio_min) k++;
        libres[k]=fin; c.__col=k;
      });
      g.forEach(function(c){ c.__cols = libres.length; });
    });
  }
  var porColumna={};
  (data.citas||[]).forEach(function(ci){
    var key = vista==='semana' ? ci.fecha : (eje==='recurso'?(ci.recurso_id==null?'null':ci.recurso_id):ci.user_id);
    (porColumna[key]=porColumna[key]||[]).push(ci);
  });
  Object.keys(porColumna).forEach(function(k){ repartirChoques(porColumna[k]); });

  // ── ESTIRAR UNA CITA POR EL BORDE (cabo 2) ─────────────────────────────────
  // Con pointerdown/move/up en vez de mouse y touch por separado: un solo camino para dedo, ratón y lápiz.
  // Mientras se arrastra NO se guarda nada: se pinta el alto y la hora de fin que quedaría. Al
  // soltar se guarda por el MISMO endpoint que mover (POST /:id/mover), y si el guardado falla la
  // cita vuelve a su alto de antes — nunca se queda enseñando algo que no está en la base.
  function estirarInicio(ev, el, ci){
    if(ev.button!==undefined && ev.button!==0) return;          // solo el botón principal
    ev.preventDefault(); ev.stopPropagation();
    var asa=ev.currentTarget; asa.classList.add('tirando');
    var y0=ev.clientY, altoIni=el.offsetHeight, durIni=ci.dur_min;
    var grid=(window.AG_GRID||30), pasoPx=grid*PXMIN, minPx=Math.max(22,pasoPx);
    var etiqueta=document.createElement('div'); etiqueta.className='cita-fin'; el.appendChild(etiqueta);
    var durNueva=durIni;
    var pinta=function(dur){
      durNueva=dur;
      el.style.height=Math.max(22, dur*PXMIN)+'px';
      etiqueta.textContent=hcorta(ci.inicio_min+dur);
    };
    pinta(durIni);
    var mover=function(e){
      var alto=Math.max(minPx, altoIni+(e.clientY-y0));
      // Se ajusta a la MISMA rejilla de la agenda, y nunca por debajo de un paso: no hay cita de cero.
      pinta(Math.max(grid, Math.round((alto/PXMIN)/grid)*grid));
    };
    var soltar=function(e){
      document.removeEventListener('pointermove',mover);
      document.removeEventListener('pointerup',soltar);
      document.removeEventListener('pointercancel',soltar);
      asa.classList.remove('tirando');
      if(etiqueta.parentNode) etiqueta.parentNode.removeChild(etiqueta);
      if(durNueva===durIni) return;                              // ni se movió: no se molesta al servidor
      var alturaPrevia=Math.max(22, durIni*PXMIN)+'px';
      api('POST','/api/erp/citas/'+ci.id+'/mover',
          { fecha: ci.fecha, inicio_min: ci.inicio_min, dur_min: durNueva })
        .then(function(){ ci.dur_min=durNueva; agCargar(); })
        .catch(function(err){
          // SE DESHACE LO QUE SE VE. Una cita pintada con una duración que no se guardó es peor que
          // el propio fallo: el dueño creería que su agenda dice algo que no dice.
          el.style.height=alturaPrevia;
          toast((err&&err.message)||'No se ha podido cambiar la duración','err');
        });
    };
    document.addEventListener('pointermove',mover);
    document.addEventListener('pointerup',soltar);
    document.addEventListener('pointercancel',soltar);
  }

  // ── LAS CITAS, por minutos reales ──────────────────────────────────────────
  (data.citas||[]).forEach(function(ci){
    var sel = vista==='semana' ? '.ag-col[data-colkey="'+ci.fecha+'"]'
                               : '.ag-col[data-colkey="'+(eje==='recurso'?(ci.recurso_id==null?'null':ci.recurso_id):ci.user_id)+'"]';
    var colEl = box.querySelector(sel);
    if(!colEl) return;
    var top=(ci.inicio_min-START)*PXMIN;
    var h=Math.max(22,(ci.dur_min)*PXMIN);        // 22px mínimo: una cita de 10 min sigue siendo clicable
    var el=document.createElement('div');
    el.className='citaBlock'; el.dataset.id=ci.id; el.dataset.estado=ci.estado;
    var col=(window.CITA_ESTADOS||{})[ci.estado]||{fuerte:'#64748b',suave:'#EEF1F5',oscuro:'#3F4A5A'};
    el.style.setProperty('--c-fuerte',col.fuerte);
    el.style.setProperty('--c-suave',col.suave);
    el.style.setProperty('--c-oscuro',col.oscuro);
    el.style.top=top+'px'; el.style.height=h+'px';
    // El ancho sale del reparto. Con una sola sub-columna queda exactamente como antes (4 px a cada
    // lado): las citas que no chocan con nadie no cambian ni un píxel.
    var nCols=ci.__cols||1, iCol=ci.__col||0;
    el.style.left='calc('+(iCol*100/nCols)+'% + 4px)';
    el.style.width='calc('+(100/nCols)+'% - 8px)';
    el.style.right='auto';
    if(nCols>1) el.dataset.choque=nCols;
    if(window.CITAS_EDIT){
      el.draggable=true; el.ondragstart=function(ev){ev.dataTransfer.setData('text/plain',ci.id);};
      // Y el camino del DEDO, que el arrastre de HTML5 no cubre. Mismo motor que en la vista Mes;
      // aquí el destino es un hueco de la rejilla (día y hora) en vez de una casilla (solo día).
      el.dataset.quien=ci.cliente;
      el.addEventListener('pointerdown', function(ev){ arrastreDedo(ev, el, ci.id, ci.inicio_min, 'lienzo'); });
    }
    // JERARQUÍA POR ALTURA, sin cortar palabras a media letra: se quitan LÍNEAS enteras.
    var linCli='<div class="cli">'+esc(ci.cliente)+'</div>';
    var linSvc='<div class="svc">'+esc(ci.servicios)+'</div>';
    var linHra='<div class="hra">'+hcorta(ci.inicio_min)+'–'+hcorta(ci.inicio_min+ci.dur_min)+'</div>';
    if(h>=60){ el.innerHTML=linCli+linSvc+linHra; }
    else if(h>=40){ el.innerHTML=linCli+linSvc; }
    else { el.innerHTML=linCli; el.title=ci.cliente+' · '+ci.servicios+' · '+hcorta(ci.inicio_min); }
    // Tramo(s) de ESPERA: el mismo bloque, gris neutro y SIN barra de color, para que a un metro se
    // vea que ahí no hay cita.
    (ci.espera||[]).forEach(function(w){
      var b=document.createElement('div');
      b.className='ag-espera'; b.title='Aquí estás libre';
      b.style.top=(w.ini*PXMIN)+'px'; b.style.height=((w.fin-w.ini)*PXMIN)+'px';
      el.appendChild(b);
    });
    // ── EL ASA DE ESTIRAR (cabo 2) ──────────────────────────────────────────
    // VA AQUÍ, DESPUÉS del innerHTML, y no antes: el innerHTML de arriba reescribe el bloque entero y
    // se llevaría por delante cualquier hijo añadido antes (pasó en la primera pasada, y el asa no
    // aparecía sin dar ningún error). Los tramos de espera se añaden aquí por lo mismo.
    // No se pinta en las que ya no se tocan (anulada / atendida) ni sin permiso de edición.
    if(window.CITAS_EDIT && ci.estado!=='anulada' && ci.estado!=='atendida'){
      var asa=document.createElement('div');
      asa.className='cita-asa'; asa.title='Arrastra para cambiar la duración';
      asa.addEventListener('pointerdown', function(ev){ estirarInicio(ev, el, ci); });
      el.appendChild(asa);
    }
    el.onclick=function(){verCita(ci.id);};
    colEl.appendChild(el);
  });

  pintaAhora(START, END, PXMIN, dates);
  colocaScroll(START, PXMIN, dates);
}
// De qué a qué minuto NO se trabaja, para atenuarlo. Sale del mismo rango del servidor y de los
// tramos que ya viajan con la agenda; si no hay dato, no se atenúa nada (nunca se inventa horario).
function fueraDe(data, fecha, col, eje, vista, START, END){
  var tr = data && data.tramos && data.tramos[fecha];
  if(!tr) return [];
  var abiertos = (eje==='persona' && vista!=='semana' && col.colId!=null && tr.personas && tr.personas[col.colId]) ? tr.personas[col.colId] : tr.negocio;
  if(!abiertos || !abiertos.length) return [];
  var out=[], cur=START;
  abiertos.slice().sort(function(a,b){return a[0]-b[0];}).forEach(function(t){
    if(t[0]>cur) out.push([cur, Math.min(t[0],END)]);
    cur=Math.max(cur, t[1]);
  });
  if(cur<END) out.push([cur, END]);
  return out.filter(function(f){ return f[1]>f[0]; });
}
// «9:00», no «09:00».
function hcorta(m){ var h=Math.floor(m/60)%24, mm=m%60; return h+':'+(mm<10?'0':'')+mm; }
// LÍNEA DE AHORA — solo si el rango visible contiene HOY. Se recoloca sola cada 60 s, sin recargar.
var _ahoraTimer=null;
function pintaAhora(START, END, PXMIN, dates){
  if(_ahoraTimer){ clearInterval(_ahoraTimer); _ahoraTimer=null; }
  var wrap=document.getElementById('agWrap'); if(!wrap) return;
  var hoy=ymd(new Date());
  if(dates.indexOf(hoy)<0) return;                       // el día visible no es hoy: no se pinta
  var cols=wrap.querySelector('.ag-cols'), horas=wrap.querySelector('.ag-horas');
  var linea=document.createElement('div'); linea.className='ag-ahora'; linea.id='agAhora';
  var pill=document.createElement('div'); pill.className='ag-ahora-h'; pill.id='agAhoraH';
  cols.appendChild(linea); (horas.querySelector('.ag-hrel')||horas).appendChild(pill);
  function coloca(){
    var n=new Date(), min=n.getHours()*60+n.getMinutes();
    var dentro = min>=START && min<=END;
    linea.style.display = dentro ? '' : 'none';
    pill.style.display  = dentro ? '' : 'none';
    if(!dentro) return;
    var y=(min-START)*PXMIN;
    linea.style.top=y+'px'; pill.style.top=y+'px'; pill.textContent=hcorta(min);
  }
  coloca();
  _ahoraTimer=setInterval(coloca, 60000);
}
// AL ABRIR: la hora actual a un tercio de lo que se ve. Si el día mostrado no es hoy, al inicio del
// horario del negocio (que es scroll 0).
function colocaScroll(START, PXMIN, dates){
  var wrap=document.getElementById('agWrap'); if(!wrap) return;
  if(dates.indexOf(ymd(new Date()))<0){ wrap.scrollTop=0; return; }
  var n=new Date(), min=n.getHours()*60+n.getMinutes();
  if(min<START){ wrap.scrollTop=0; return; }
  wrap.scrollTop=Math.max(0, (min-START)*PXMIN - wrap.clientHeight/3);
}
function cellNueva(cell){ if(!window.CITAS_EDIT) return; var uid=cell.dataset.col; if(!uid) return; openQuickCita(uid, cell.dataset.fecha, parseInt(cell.dataset.min)); }
function esc(s){return String(s==null?'':s).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));}
async function onDrop(ev){
  ev.preventDefault(); if(!window.CITAS_EDIT) return;
  var id=ev.dataTransfer.getData('text/plain'); if(!id) return;
  // Un SOLO camino de guardado para el ratón y para el dedo (ver moverCitaAHueco). Antes esta
  // función tenía su propia copia del cuerpo de la petición; dos copias de lo mismo se separan en
  // cuanto alguien toca una, y entonces mover con el dedo y con el ratón dejarían de hacer lo mismo.
  await moverCitaAHueco(id, ev.currentTarget);
}
// ── NUEVA CITA — panel rápido (3 toques desde un hueco de la rejilla) ─────────
function fillSelect(el,rows,val,label,placeholder){ el.innerHTML=(placeholder!=null?'<option value="">'+placeholder+'</option>':'')+rows.map(r=>'<option value="'+r[val]+'">'+esc(r[label])+'</option>').join(''); }
function SYM(){ return (META&&META.ajustes&&META.ajustes.currency_symbol)||'€'; }
function svcMin(s){ return s.muerto_dur_min ? (s.muerto_ini_min||s.duracion_min) : s.duracion_min; }   // "tiempo contigo" para el listado
var QUICK_MIN=null;   // hora FIJA cuando se abre pulsando un hueco de la rejilla (no se vuelve a preguntar)
function cRellenaComunes(){
  fillSelect(document.getElementById('cPersona'),META.personas.map(p=>({id:p.id,name:p.name})),'id','name',null);
  fillSelect(document.getElementById('cRecurso'),META.recursos.map(r=>({id:r.id,name:r.nombre})),'id','name','— Automático —');
  fillSelect(document.getElementById('cProyecto'),META.proyectos.map(p=>({id:p.id,name:(p.codigo||'')+' '+p.nombre})),'id','name','— Ninguno —');
  // Se OCULTA, no se quita (ver el comentario del modal). El select sigue vivo y guardando su valor.
  var pw=document.getElementById('cProyectoWrap'); if(pw) pw.style.display = window.USA_PROYECTOS ? '' : 'none';
  // EL PUESTO, IGUAL QUE LA PERSONA: solo se pinta si HAY de eso. Un negocio sin sillas/cabinas/boxes
  // veía un desplegable «Silla» con un único «— Automático —» dentro, y encima era lo ÚNICO que
  // quedaba en «Más opciones» al ocultarse persona y proyecto: parecía que ahí se elegía QUIÉN atiende.
  // Si no hay puestos, el motor ya no exige ninguno y no hay nada que elegir.
  var rw=document.getElementById('cRecursoWrap');
  if(rw) rw.style.display = (META.recursos && META.recursos.length) ? '' : 'none';
  document.getElementById('cServicios').innerHTML=META.servicios.map(s=>'<label style="font-size:.85rem"><input type="checkbox" class="csvc" value="'+s.id+'" onchange="cServChange()"> '+esc(s.name)+' ('+svcMin(s)+' min)</label>').join('')||'<div style="color:var(--muted);font-size:.85rem;line-height:1.5">Aún no tienes servicios.<br><a href="/admin/citas/servicios" style="color:var(--accent);font-weight:600">＋ Crear o configurar tus servicios →</a></div>';
}
function cReset(){
  document.getElementById('cId').value=''; document.getElementById('cCliente').value=''; document.getElementById('cSueltoNombre').value=''; document.getElementById('cSueltoMovilVal').value='';
  document.getElementById('cBusca').value=''; document.getElementById('cResultados').innerHTML=''; document.getElementById('cNuevo').style.display='none'; document.getElementById('cElegido').style.display='none';
  document.getElementById('cSueltoMovil').value=''; document.getElementById('cNota').value=''; document.getElementById('cAvisar').checked=false;
  document.getElementById('cResumen').textContent=''; document.getElementById('cHueco').innerHTML=''; document.getElementById('cRecurso').value='';
  cRellenaComunes();
}
function fLargo(f){ try{ return new Date(f+'T00:00:00Z').toLocaleDateString('es-ES',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'}); }catch(e){ return f; } }
// PASO 8 — QUÉ SE VE DE ENTRADA. "cuando" = día y hora. "quien" = la persona que atiende, y solo se
// pinta si el negocio tiene MÁS DE UNA: con una sola, el select sigue en el DOM con ella
// preseleccionada, así que la cita se le asigna sola y ni cGuardar ni cRecalc necesitan un caso aparte.
function cCampos(cuando, quien){
  document.getElementById('cCuando').style.display = cuando ? '' : 'none';
  var varias = !!(META && META.personas && META.personas.length > 1);
  document.getElementById('cQuien').style.display = (quien && varias) ? '' : 'none';
}
async function openNuevaCita(){ await ensureMeta(); await refrescaMeta(); cReset(); QUICK_MIN=null; document.getElementById('mCitaTitle').textContent='Nueva cita';
  document.getElementById('cFecha').value=document.getElementById('agFecha').value||ymd(new Date()); document.getElementById('cContexto').textContent='';
  // Delante: cliente, servicio y día/hora (+ persona si hay varias). Detrás: puesto, proyecto, nota y avisar.
  cCampos(true,true); document.getElementById('cMas').open=false; openModal('mCita'); document.getElementById('cBusca').focus(); }
async function openQuickCita(user_id, fecha, min){ await ensureMeta(); await refrescaMeta(); cReset(); QUICK_MIN=min; document.getElementById('mCitaTitle').textContent='Nueva cita';
  document.getElementById('cPersona').value=String(user_id); document.getElementById('cFecha').value=fecha; document.getElementById('cMas').open=false;
  // AGENDA SENCILLA, INTACTA: desde el hueco, persona y hora se HEREDAN de la celda y no se re-preguntan.
  cCampos(false,false);
  var per=(META.personas.find(p=>String(p.id)===String(user_id))||{}).name||''; document.getElementById('cContexto').textContent=per+' · '+fLargo(fecha)+' · '+fhhmm(min);
  openModal('mCita'); document.getElementById('cBusca').focus(); }
// Cliente: buscador que filtra según escribes; si no existe, se usa ahí mismo con nombre y móvil.
// P1 (18 ago 2026) — EL ALTA SE PERDÍA POR AQUÍ, y llevaba así desde antes de esta semana.
// cFiltra corre en CADA tecla y borraba la elección de cliente. Bastaba con elegir a alguien y
// después corregir el texto —añadir el apellido, arreglar una letra— para quedarse sin cliente
// elegido sin que nada lo dijera: al guardar salía «Elige o crea un cliente» y la cita NO se creaba.
// Ahora la elección solo se suelta cuando el texto DEJA de ser el nombre elegido, y aun así el
// nombre escrito no se pierde: cResuelveCliente() lo recoge al guardar.
function cFiltra(){
  var q=document.getElementById('cBusca').value.trim().toLowerCase();
  var eleg=document.getElementById('cElegido');
  var yaElegido=(eleg.textContent||'').replace(/^✓\s*/,'').replace(/\s*\([^)]*\)\s*$/,'').trim().toLowerCase();
  if(!yaElegido || yaElegido!==q){
    document.getElementById('cCliente').value=''; document.getElementById('cSueltoNombre').value=''; eleg.style.display='none';
  }
  var box=document.getElementById('cResultados'), nuevo=document.getElementById('cNuevo');
  if(!q){ box.innerHTML=''; nuevo.style.display='none'; return; }
  var m=META.clientes.filter(c=>(c.name||'').toLowerCase().includes(q)).slice(0,6);
  box.innerHTML=m.map(c=>'<div class="cliOpt" style="padding:.35rem .5rem;cursor:pointer;border-bottom:1px solid var(--border);font-size:.9rem" onclick="cPick('+c.id+',this)">'+esc(c.name)+'</div>').join('');
  document.getElementById('cNuevoNombre').textContent=document.getElementById('cBusca').value.trim();
  nuevo.style.display='';
}
function cPick(id, el){
  document.getElementById('cCliente').value=id; document.getElementById('cSueltoNombre').value='';
  document.getElementById('cBusca').value=el.textContent; document.getElementById('cResultados').innerHTML=''; document.getElementById('cNuevo').style.display='none';
  var e=document.getElementById('cElegido'); e.textContent='✓ '+el.textContent; e.style.display='';
}
function cUsarNuevo(){
  var nombre=document.getElementById('cBusca').value.trim(); if(!nombre){ toast('Escribe un nombre','err'); return; }
  document.getElementById('cCliente').value=''; document.getElementById('cSueltoNombre').value=nombre; document.getElementById('cSueltoMovilVal').value=document.getElementById('cSueltoMovil').value;
  document.getElementById('cResultados').innerHTML=''; document.getElementById('cNuevo').style.display='none';
  var e=document.getElementById('cElegido'); e.textContent='✓ '+nombre+' ('+(window.CLIENTE_SING||'Cliente').toLowerCase()+' nuevo)'; e.style.display='';
}
// El nombre escrito en el buscador vale como cliente aunque no se haya pulsado nada. Clavado con uno
// de la ficha → ese cliente; si no → cliente nuevo, igual que el botón «usar como nuevo».
function cResuelveCliente(){
  if(document.getElementById('cCliente').value || document.getElementById('cSueltoNombre').value) return;
  var nombre=document.getElementById('cBusca').value.trim(); if(!nombre) return;
  var ex=(META&&META.clientes||[]).find(function(c){ return (c.name||'').trim().toLowerCase()===nombre.toLowerCase(); });
  if(ex){ document.getElementById('cCliente').value=ex.id; }
  else { document.getElementById('cSueltoNombre').value=nombre; document.getElementById('cSueltoMovilVal').value=document.getElementById('cSueltoMovil').value||''; }
}
function cSelServicios(){ return [...document.querySelectorAll('.csvc:checked')].map(x=>parseInt(x.value)); }
function cServChange(){ if(QUICK_MIN!=null && document.getElementById('cHueco').value==='') cSugerir(); else cRecalc(); }
async function cRecalc(){
  var ids=cSelServicios(), user=document.getElementById('cPersona').value, fecha=document.getElementById('cFecha').value, rec=document.getElementById('cRecurso').value;
  var sel=document.getElementById('cHueco');
  if(!ids.length||!user||!fecha){ sel.innerHTML='<option value="">Elige servicio y persona…</option>'; document.getElementById('cResumen').textContent=''; return; }
  try{
    var q='/api/erp/citas/huecos?fecha='+fecha+'&user_id='+user+'&service_ids='+ids.join(',')+(rec?'&recurso_id='+rec:'');
    var d=await api('GET',q);
    var head=QUICK_MIN!=null?'<option value="">Hora: '+fhhmm(QUICK_MIN)+'</option>':'<option value="">Elige hora…</option>';
    sel.innerHTML=head+(d.huecos.length?d.huecos.map(h=>'<option value="'+h.min+'">'+h.hora+'</option>').join(''):'');
  }catch(e){ sel.innerHTML='<option value="">'+esc(e.message)+'</option>'; }
  cSugerir();
}
function cHora(){ var v=document.getElementById('cHueco').value; return v!==''?parseInt(v):QUICK_MIN; }
async function cSugerir(){
  var ids=cSelServicios(), user=document.getElementById('cPersona').value, fecha=document.getElementById('cFecha').value, min=cHora();
  var box=document.getElementById('cResumen'); if(!ids.length||!user||fecha===''||min==null){ box.textContent=''; return; }
  try{
    var d=await api('GET','/api/erp/citas/sugerir?fecha='+fecha+'&user_id='+user+'&inicio_min='+min+'&service_ids='+ids.join(','));
    if(!d.ok){ box.textContent=''; return; }
    var s=(d.dur_total||0)+' min · '+SYM()+Number(d.precio_total||0).toFixed(2);
    if(d.requiere_puesto) s+= d.puesto? (' · '+(window.PUESTO_SING||'Puesto')+': '+esc(d.puesto.nombre)) : (' · ⚠️ sin '+(window.PUESTO_SING||'Puesto').toLowerCase()+' libre');
    box.innerHTML='<span style="color:'+(d.cabe?'var(--muted)':'var(--danger)')+'">'+s+(d.cabe?'':' · '+esc(d.motivo))+'</span>';
  }catch(e){ box.textContent=''; }
}
async function cGuardar(){
  var min=cHora();
  // PASO 8 — se avisa en el ORDEN en que se lee el panel: quién, qué y cuándo. La hora ya no vive
  // detrás de "Más opciones", así que el mensaje ya no manda abrirlas (y desde el hueco nunca falta:
  // la trae la celda pulsada).
  // Si hay un nombre ESCRITO y no se pulsó nada, no se rechaza: se resuelve. Es lo que la persona ve
  // en la pantalla —el nombre está ahí escrito—, así que la cita tiene que salir. Si el nombre es
  // clavado el de un cliente de la ficha, se usa ESE; si no, entra como cliente nuevo.
  cResuelveCliente();
  if(!document.getElementById('cCliente').value && !document.getElementById('cSueltoNombre').value){ toast('Escribe el nombre del '+(window.CLIENTE_SING||'cliente').toLowerCase(),'err'); return; }
  if(!cSelServicios().length){ toast('Elige un servicio','err'); return; }
  if(min==null){ toast('Elige una hora','err'); return; }
  var body={ cliente_id:document.getElementById('cCliente').value||null, cliente_suelto_nombre:document.getElementById('cSueltoNombre').value, cliente_suelto_movil:document.getElementById('cSueltoMovilVal').value,
    user_id:document.getElementById('cPersona').value, recurso_id:document.getElementById('cRecurso').value||null, fecha:document.getElementById('cFecha').value,
    inicio_min:min, service_ids:cSelServicios(), project_id:document.getElementById('cProyecto').value||null, nota:document.getElementById('cNota').value };
  var id=document.getElementById('cId').value;
  // fetch directo para poder LEER los huecos cercanos que trae el 409 (el helper api() no los expone).
  try{
    var res=await fetch('/api/erp/citas'+(id?'/'+id:''),{method:id?'PUT':'POST',headers:{'Content-Type':'application/json','x-csrf-token':window.CSRF_TOKEN},body:JSON.stringify(body)});
    var d=await res.json().catch(()=>({}));
    if(!res.ok){ if(res.status===409){ cErrorChoque(d); } else { toast(d.error||'No se pudo guardar','err'); } return; }
    var avisar=document.getElementById('cAvisar').checked;
    closeModal('mCita'); toast('Cita guardada'); agCargar();
    if(avisar && d.id) abrirAvisos(d.id);
  }catch(e){ toast('Error de red','err'); }
}
// Choque de horas → mensaje claro + huecos cercanos que propone el servidor (no un error seco).
function cErrorChoque(d){
  var alt=d.huecos||[];
  var box=document.getElementById('cResumen');
  box.innerHTML='<span style="color:var(--danger)">'+esc(d.error||'No cabe a esa hora')+'</span>'+(alt.length?'<br><span style="font-size:.85rem">Huecos cerca: '+alt.map(h=>'<a href="#" onclick="cElegirHora('+h.min+');return false" style="color:var(--accent);font-weight:600;margin-right:.5rem">'+h.hora+'</a>').join('')+'</span>':'');
  document.getElementById('cMas').open=true;
}
function cElegirHora(min){ QUICK_MIN=min; var sel=document.getElementById('cHueco'); var opt=[...sel.options].find(o=>o.value==String(min)); if(!opt){ opt=document.createElement('option'); opt.value=String(min); opt.textContent=fhhmm(min); sel.appendChild(opt); } sel.value=String(min); document.getElementById('cContexto').textContent=document.getElementById('cContexto').textContent.replace(/·[^·]*$/, '· '+fhhmm(min)); cSugerir(); }
async function verCita(id){
  var c=await api('GET','/api/erp/citas/'+id);
  document.getElementById('mDetTitle').textContent=c.codigo+' · '+(ESTLBL[c.estado]||c.estado);
  var e=esc; var puede=window.CITAS_EDIT;
  var acc='';
  if(puede){
    if(c.estado==='pedida') acc+='<button class="btn btn-secondary btn-sm" onclick="estado('+id+',\'confirmada\')">Confirmar</button> ';
    if(c.estado==='pedida'||c.estado==='confirmada'){ acc+='<button class="btn btn-primary btn-sm" onclick="atender('+id+')">Atender / cobrar</button> '; acc+='<button class="btn btn-secondary btn-sm" onclick="estado('+id+',\'no_show\')">No se presentó</button> '; }
    if(c.estado!=='anulada'&&c.estado!=='atendida') acc+='<button class="btn btn-secondary btn-sm" onclick="editCita('+id+')">Editar</button> ';
    acc+='<button class="btn btn-secondary btn-sm" onclick="abrirAvisos('+id+')">Avisar</button> ';
    if(c.estado!=='anulada') acc+='<button class="btn btn-danger btn-sm" onclick="anular('+id+')">Anular</button>';
  }
  document.getElementById('mDetBody').innerHTML=
    '<div class="row" style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:1rem">'
    +'<div><div class="form-label">'+e(window.CLIENTE_SING||'Cliente')+'</div>'+e(c.cliente_nombre||c.cliente_suelto_nombre||'—')+'</div>'
    +'<div><div class="form-label">Móvil</div>'+e(c.contacto&&c.contacto.movil_e164||'—')+(c.contacto&&c.contacto.movil_e164&&!c.contacto.movil_valido?' <span style="color:var(--danger)">(sin móvil válido)</span>':'')+'</div>'
    +'<div><div class="form-label">Persona</div>'+e(c.persona||'—')+'</div>'
    +'<div><div class="form-label">'+(window.PUESTO_SING||'Puesto')+'</div>'+e(c.recurso||'—')+'</div>'
    +'<div><div class="form-label">Fecha</div>'+e(c.fecha)+'</div>'
    +'<div><div class="form-label">Hora</div>'+e(c.hora)+' ('+c.dur_min+' min)</div>'
    +(c.proyecto_codigo?'<div><div class="form-label">Proyecto</div>'+e(c.proyecto_codigo)+'</div>':'')
    +(c.invoice_id?'<div><div class="form-label">Cobro</div><a href="/admin/invoices/'+c.invoice_id+'" target="_blank">Ver factura</a></div>':'')
    // CABO 4 · quién la anuló. «Sin registrar» para las anuladas ANTES de que se guardara el dato:
    // no se les adivina un autor, se dice que no consta. Inventarlo sería peor que el hueco.
    +(c.estado==='anulada'?'<div><div class="form-label">Anulada por</div>'+e(QUIEN_ANULA[c.anulada_por]||'Sin registrar')+'</div>':'')
    +'</div>'
    +'<div class="form-label">Servicios</div><div style="margin-bottom:1rem">'+e((c.servicios||[]).map(s=>s.nombre).join(' + '))+'</div>'
    +(c.nota?'<div class="alert" style="margin-bottom:1rem">'+e(c.nota)+'</div>':'')
    +((c.avisos&&c.avisos.length)?'<div class="form-label">Avisos</div><div style="font-size:.8rem;color:var(--muted);margin-bottom:1rem">'+c.avisos.map(a=>e(a.tipo)+' · '+e(a.canal)+' · <strong>'+(a.estado==='email_enviado'?'email enviado':(a.estado==='email_fallo'?'fallo email':'marcado como enviado'))+'</strong> · '+e((a.enviado_at||'').slice(0,16))).join('<br>')+'</div>':'')
    +'<div style="display:flex;gap:.4rem;flex-wrap:wrap">'+acc+'</div>';
  openModal('mDet');
}
var ESTLBL={pedida:'Pedida',confirmada:'Confirmada',atendida:'Atendida',no_show:'No se presentó',anulada:'Anulada'};
// Los tres valores del cabo 4, en cristiano. Lo que no esté aquí (incluido null) se lee «Sin registrar».
var QUIEN_ANULA={cliente:'El cliente',negocio:'El negocio',automatico:'Caducó sola, sin respuesta'};
async function estado(id,e){
  var extra={};
  if(e==='anulada'){ var q=await quienAnula(); if(!q) return; extra.anulada_por=q; }
  try{ await api('POST','/api/erp/citas/'+id+'/estado',Object.assign({estado:e},extra)); closeModal('mDet'); toast('Actualizado'); agCargar(); }catch(x){ toast(x.message,'err'); }
}
// ── CABO 4 · AL ANULAR, ELEGIR QUIÉN. SIN OPCIÓN POR DEFECTO ─────────────────────────────────────
// Dos botones y ninguno preseleccionado: si hubiera uno marcado de fábrica, en dos semanas TODAS las
// anulaciones dirían lo mismo y el dato no valdría para nada — que es justo lo contrario de para lo
// que se guarda. Cerrar el diálogo sin elegir NO anula.
// «No se presentó» NO está aquí: es un ESTADO de la cita y tiene su propio botón. Nadie anuló nada.
function quienAnula(){
  return new Promise(function(res){
    var f=document.getElementById('mQuien');
    document.getElementById('mQuienBody').onclick=function(ev){
      var b=ev.target.closest('[data-quien]'); if(!b) return;
      f.classList.remove('open'); f.style.display='none'; res(b.getAttribute('data-quien'));
    };
    document.getElementById('mQuienNo').onclick=function(){ f.classList.remove('open'); f.style.display='none'; res(null); };
    f.style.display='flex'; f.classList.add('open');
  });
}
async function anular(id){
  var quien = await quienAnula();
  if(!quien) return;                                   // cerró sin elegir: no se anula nada
  try{ await api('DELETE','/api/erp/citas/'+id,{anulada_por:quien}); closeModal('mDet'); toast('Cita anulada'); agCargar(); }
  catch(x){ toast(x.message,'err'); }
}
async function atender(id){
  var cobrar=confirm('¿Cobrar ahora? (Aceptar = cobrar con un ticket en efectivo; Cancelar = marcar atendida sin cobrar)');
  var body={cobrar:cobrar, via:'ticket', payment_method:'efectivo', registrar_tiempo:false};
  try{ var r=await api('POST','/api/erp/citas/'+id+'/atender',body); closeModal('mDet'); toast(r.invoice_id?'Atendida y cobrada':'Atendida'); agCargar(); }catch(x){ toast(x.message,'err'); }
}
async function editCita(id){
  await ensureMeta(); var c=await api('GET','/api/erp/citas/'+id);
  cReset(); QUICK_MIN=null; document.getElementById('cId').value=id; document.getElementById('mCitaTitle').textContent='Editar cita';
  // Editando se enseña todo lo que se puede cambiar (incluidas las opciones), con la misma regla de la
  // persona: si solo hay una, no hay nada que elegir.
  cCampos(true,true); document.getElementById('cMas').open=true; document.getElementById('cContexto').textContent='';
  if(c.cliente_id){ document.getElementById('cCliente').value=c.cliente_id; document.getElementById('cBusca').value=c.cliente_nombre||''; var e=document.getElementById('cElegido'); e.textContent='✓ '+(c.cliente_nombre||''); e.style.display=''; }
  else if(c.cliente_suelto_nombre){ document.getElementById('cSueltoNombre').value=c.cliente_suelto_nombre; document.getElementById('cSueltoMovilVal').value=c.cliente_suelto_movil||''; document.getElementById('cBusca').value=c.cliente_suelto_nombre; var e2=document.getElementById('cElegido'); e2.textContent='✓ '+c.cliente_suelto_nombre+' (cliente nuevo)'; e2.style.display=''; }
  document.getElementById('cPersona').value=c.user_id; document.getElementById('cRecurso').value=c.recurso_id||'';
  document.getElementById('cProyecto').value=c.project_id||''; document.getElementById('cFecha').value=c.fecha; document.getElementById('cNota').value=c.nota||'';
  (c.service_ids||[]).forEach(function(sid){ var el=document.querySelector('.csvc[value="'+sid+'"]'); if(el) el.checked=true; });
  await cRecalc();
  var sel=document.getElementById('cHueco'); var opt=[...sel.options].find(o=>o.value==String(c.inicio_min)); if(!opt){ opt=document.createElement('option'); opt.value=String(c.inicio_min); opt.textContent=fhhmm(c.inicio_min); sel.appendChild(opt);} sel.value=String(c.inicio_min);
  cSugerir(); openModal('mCita');
}
async function abrirAvisos(id){
  var d=await api('GET','/api/erp/citas/'+id+'/aviso-links');
  var canal=d.canal_defecto;
  var block=function(tipo,data){
    var wa=data.wa?'<a class="btn btn-primary btn-sm" href="'+data.wa+'" target="_blank" onclick="marcar('+id+',\''+tipo+'\',\'whatsapp\')">WhatsApp</a>':'<span class="btn btn-secondary btn-sm" style="opacity:.4">WhatsApp (sin móvil)</span>';
    var sms=data.sms?'<a class="btn btn-secondary btn-sm" href="'+data.sms+'" onclick="marcar('+id+',\''+tipo+'\',\'sms\')">SMS</a>':'';
    var em=d.contacto.email?'<button class="btn btn-secondary btn-sm" onclick="marcar('+id+',\''+tipo+'\',\'email\',true)">Enviar email</button>':'<span class="btn btn-secondary btn-sm" style="opacity:.4">Email (sin correo)</span>';
    return '<div style="margin-bottom:1rem"><div class="form-label" style="text-transform:capitalize">'+tipo+'</div><div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.3rem">'+wa+' '+sms+' '+em+'</div><textarea class="form-control" rows="3" readonly style="font-size:.8rem">'+esc(data.texto)+'</textarea></div>';
  };
  document.getElementById('mAvisoBody').innerHTML=
    '<div class="alert" style="font-size:.8rem">Se abre el mensaje ya escrito con el enlace de la cita. Al pulsar, queda <strong>marcado como enviado</strong> (sabemos que se pulsó el botón, no que llegó). El SMS funciona sobre todo desde el móvil.</div>'
    +block('confirmacion',d.confirmacion)+block('recordatorio',d.recordatorio);
  openModal('mAviso');
}
async function marcar(id,tipo,canal,esEmail){
  try{ var r=await api('POST','/api/erp/citas/'+id+'/aviso',{tipo:tipo,canal:canal}); toast(esEmail?'Email enviado':'Marcado como enviado'); }
  catch(e){ toast(e.message,'err'); }
}
// Bloqueo
async function openBloqueo(){ await ensureMeta(); fillSelect(document.getElementById('bPersona'),META.personas.map(p=>({id:p.id,name:p.name})),'id','name','— Ninguna —'); fillSelect(document.getElementById('bRecurso'),META.recursos.map(r=>({id:r.id,name:r.nombre})),'id','name','— Ninguno —'); document.getElementById('bFecha').value=document.getElementById('agFecha').value||ymd(new Date()); openModal('mBloq'); }
async function bGuardar(){
  var toMin=function(t){ if(!t)return null; var p=t.split(':'); return parseInt(p[0])*60+parseInt(p[1]); };
  var body={ user_id:document.getElementById('bPersona').value||null, recurso_id:document.getElementById('bRecurso').value||null, fecha:document.getElementById('bFecha').value, inicio_min:toMin(document.getElementById('bIni').value), fin_min:toMin(document.getElementById('bFin').value), motivo:document.getElementById('bMotivo').value };
  try{ await api('POST','/api/erp/citas/bloqueo',body); closeModal('mBloq'); toast('Bloqueado'); agCargar(); }catch(e){ toast(e.message,'err'); }
}
// De entrada: HOY, por persona, solo quien trabaja hoy (2.1). Se recuerda lo último que se eligió (2.2).
(function initAgenda(){ var p=loadPrefs(); if(p.vista)AG_VISTA=p.vista; if(p.eje)document.getElementById('agEje').value=p.eje; var vt=document.getElementById('agVerTodo'); if(vt)vt.checked=!!p.verTodo;
  // pintaBotonesVista TAMBIÉN en el arranque: la vista se recuerda entre visitas, así que al
  // entrar directamente en «mes» hay que dejar la barra como corresponde. Sin esta llamada el
  // zoom aparecía igualmente hasta que tocabas un botón de vista.
  initDate(); pintaTitulo(); pintaZoom(); pintaBotonesVista(AG_VISTA);
  // Los FILTROS se despliegan solos si venían tocados. La vista ya no: ahora son botones a la vista.
  if((p.eje&&p.eje!=='persona')||p.verTodo){ document.getElementById('agControles').style.display='flex'; }
  document.addEventListener('wheel', ruedaMes, { passive:false });
  // ── CABO 3 · DESLIZAR EN HORIZONTAL PARA CAMBIAR DE MES (móvil) ─────────────────────────────
  // LO QUE HABÍA: solo el evento wheel, que un DEDO NO DISPARA. O sea que en un móvil no había ningún gesto
  // — ni vertical ni horizontal. La rueda sigue igual para escritorio y no se toca.
  //
  // EL VERTICAL SE QUEDA COMO ESTÁ, a propósito: en móvil hace scroll de la página. Convertirlo en
  // cambio de mes sería robarle al dueño el gesto con el que se mueve por su propia pantalla.
  //
  // EL UMBRAL, y por qué es así: hace falta recorrer 60 px en horizontal Y que el movimiento sea
  // claramente más horizontal que vertical (1,5 veces) para que un scroll con la muñeca torcida no
  // cambie de mes sin querer. Y se ignora todo lo que empiece cerca del borde izquierdo (24 px),
  // que es donde el navegador tiene su gesto de volver atras: ahí no se compite, se cede.
  document.addEventListener('touchstart', mesToqueIni, { passive:true });
  // NO PASIVO A PROPÓSITO: hace falta poder llamar a preventDefault(). Sin eso, Chromium se queda el
  // arrastre horizontal como su gesto de «atrás» y la pantalla se va de la aplicación — comprobado en
  // la prueba, que acababa en about:blank. La propiedad overscroll-behavior no basta porque quien desborda aquí
  // es el documento, no la rejilla. Solo se corta cuando el gesto YA es claramente horizontal y ha
  // empezado sobre el mes: el resto de deslizamientos de la aplicación no se tocan.
  document.addEventListener('touchmove', mesToqueMueve, { passive:false });
  document.addEventListener('touchend', mesToqueFin, { passive:true });
  pintaBotonesVista(vistaActual()); agCargar(); })();
`;

// ── LA CARA DE «RECORDATORIOS A CLIENTES» ────────────────────────────────────────────────────────
// El armazón ya lo pone `adminLayout`; lo que faltaba era el interior. Todo con tokens del panel.
const COLA_CSS = `<style>
  /* ANCHO MÁXIMO. Las tarjetas iban de borde a borde: en un monitor de 1920 px la tabla se estiraba
     1814 px y la vista quedaba con seis columnas separadas por medio metro de vacío. Con tope, el ojo
     no tiene que cruzar la pantalla entera para ir de la hora al botón. */
  .cola-wrap{max-width:1080px}
  .cola-ph{align-items:flex-start;gap:1rem}
  .cola-cab{min-width:0}
  /* TÍTULO DE PÁGINA DE VERDAD, con la misma jerarquía que el «Agosto 2026» de la agenda (1,5rem/700).
     Antes era el h2 de 16,8 px del sistema, que sirve para un listado pero no para la portada de una
     pantalla que se abre a diario. */
  /* Con '.ph h2' delante hace falta el mismo peso de selector: la regla del sistema (1,05rem/500) es
     de dos partes y una clase suelta pierde. Se escribe '.ph .cola-tit', no '!important'. */
  .cola-ph .cola-tit{font-size:1.5rem;font-weight:700;letter-spacing:-.02em;color:var(--text);line-height:1.15;margin:0}
  .cola-sub{margin:.35rem 0 0;font-size:.88rem;color:var(--text2);line-height:1.5}
  .cola-i{appearance:none;border:0;background:transparent;color:var(--text3);cursor:pointer;padding:0 .15rem;
          font-size:1rem;line-height:1;vertical-align:-.1em;border-radius:6px}
  .cola-i:hover{color:var(--accent)}
  .cola-i:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  /* TARJETAS SEPARADAS. Iban pegadas una a otra, sin margen, así que los dos bloques se leían como
     uno solo partido por una raya. */
  .cola-card{margin-bottom:1rem}
  .cola-card .card-body{padding:0}
  .cola-card .card-body .empty{padding:2rem 1rem}
  .cola-card .table-wrap{border-radius:0}
  .cola-p{margin:0 0 .7rem;font-size:.87rem;color:var(--text2);line-height:1.55}
  .cola-p:last-child{margin-bottom:0}
  .cola-aviso{margin-top:.9rem;padding:.8rem .9rem;border-radius:10px;background:#FBEED0;border:1px solid #EBDDB7;color:#8A5B00}
  .cola-aviso b{color:#8A5B00}
  .cola-aviso .cola-p{color:#8A5B00;margin-top:.35rem}
</style>`;

const JS_COLA = String.raw`
function esc(s){return String(s==null?'':s).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));}
var DATA=null;
// HOY PRIMERO también al pedir los datos, no solo en el HTML: si el servidor tarda, lo primero que
// se pinta es lo de hoy.
async function cargar(){ DATA=await api('GET','/api/erp/citas/cola/data'); render('colaConf',DATA.confirmaciones,'confirmacion'); render('colaRec',DATA.recordatorios,'recordatorio'); }

// ── LA CABECERA DICE CUÁNTAS SON ─────────────────────────────────────────────────────────────────
// Y dice las PENDIENTES, no las filas. El motor trae todas las citas del día —las ya avisadas
// también, con su estado— así que contar filas daría un número que no es el que se busca: lo que se
// mira al entrar aquí es cuánto queda por despachar. El motor no se toca; solo se cuenta bien.
var TITULOS={
  confirmacion:{ el:'colaConfTit', dia:'Hoy',    que:'confirmación' },
  recordatorio:{ el:'colaRec'+'Tit', dia:'Mañana', que:'recordatorio' },
};
function pintaTitulo(tipo,rows){
  var t=TITULOS[tipo]; var el=document.getElementById(t.el); if(!el) return;
  var n=rows.filter(function(r){ return !r.aviso_hecho; }).length;
  if(!rows.length) el.textContent=t.dia+' — pendientes de '+t.que;
  else if(n===0)   el.textContent=t.dia+' — sin pendientes de '+t.que;
  else             el.textContent=t.dia+' — '+n+(n===1?' pendiente de ':' pendientes de ')+t.que;
}
// ── EL VACÍO ENSEÑA ──────────────────────────────────────────────────────────────────────────────
// Decía «No hay nada pendiente.» y punto. Un negocio nuevo abre esto el primer día y ve una pantalla
// que no explica nada: parece rota. Ahora dice QUÉ va a aparecer ahí y CUÁNDO, con el mismo bloque
// de vacío que usa el resto del panel ('window.emptyState', U2) — icono incluido, no uno inventado.
var VACIOS={
  confirmacion:{ txt:'Aquí aparecerán las citas de <b>hoy</b> a las que aún no has pedido confirmación.', icon:'ti-phone-check' },
  recordatorio:{ txt:'Aquí aparecerán las citas de <b>mañana</b> a las que aún no has mandado recordatorio.', icon:'ti-send' },
};
function render(elId,rows,tipo){
  var box=document.getElementById(elId);
  pintaTitulo(tipo,rows);
  if(!rows.length){ var v=VACIOS[tipo]; box.innerHTML=window.emptyState(v.txt,{icon:v.icon}); return; }
  box.innerHTML='<div class="table-wrap"><table><thead><tr><th>Hora</th><th>'+esc(window.CLIENTE_SING||'Cliente')+'</th><th>Servicio</th><th>Persona</th><th>Estado aviso</th><th></th></tr></thead><tbody>'
    +rows.map(function(r){
      var estado = r.aviso_hecho ? ('<span class="badge b-green">'+(r.aviso_estado==='email_enviado'?'email enviado':(r.aviso_estado==='email_fallo'?'fallo email':'marcado ('+esc(r.aviso_canal||'')+')'))+'</span>') : '<span class="badge b-gray">pendiente</span>';
      return '<tr><td>'+esc(r.hora)+'</td><td>'+esc(r.cliente)+(r.movil_e164&&!r.movil_valido?' <span style="color:var(--danger);font-size:.75rem">(móvil no válido)</span>':'')+'</td><td>'+esc(r.servicios)+'</td><td>'+esc(r.persona)+'</td><td>'+estado+'</td><td style="white-space:nowrap">'+botones(r,tipo)+'</td></tr>';
    }).join('')+'</tbody></table></div>';
}
function botones(r,tipo){
  // wa/sms YA vienen del servidor con el texto y el ENLACE real de la cita (con su token). No se recompone aquí.
  var out='';
  if(r.movil_valido && r.wa){
    out+='<a class="btn btn-primary btn-sm" target="_blank" href="'+r.wa+'" onclick="marcar('+r.id+',\''+tipo+'\',\'whatsapp\')">WhatsApp</a> ';
    out+='<a class="btn btn-secondary btn-sm" href="'+r.sms+'" onclick="marcar('+r.id+',\''+tipo+'\',\'sms\')">SMS</a> ';
  }
  if(r.email){ out+='<button class="btn btn-secondary btn-sm" onclick="marcar('+r.id+',\''+tipo+'\',\'email\',true)">Email</button>'; }
  if(!r.movil_valido&&!r.email){ out='<span style="color:var(--danger);font-size:.8rem">Sin móvil ni email</span>'; }
  return out;
}
async function marcar(id,tipo,canal,esEmail){
  try{ await api('POST','/api/erp/citas/'+id+'/aviso',{tipo:tipo,canal:canal}); toast(esEmail?'Email enviado':'Marcado como enviado'); cargar(); }
  catch(e){ toast(e.message,'err'); }
}
cargar();
`;

const JS_SERVICIOS = String.raw`
function esc(s){return String(s==null?'':s).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));}
var LIST=[],META=null;
// El "tiempo de espera" va PLEGADO: aparece un enlace y solo se despliega si hace falta.
function esperaShow(pref){ document.getElementById(pref+'EsperaAdd').style.display='none'; document.getElementById(pref+'EsperaWrap').style.display=''; document.getElementById(pref+'Espera').focus(); }
function esperaReset(pref,val){ var w=document.getElementById(pref+'EsperaWrap'),a=document.getElementById(pref+'EsperaAdd'); document.getElementById(pref+'Espera').value=val||0; if(val>0){ w.style.display=''; a.style.display='none'; } else { w.style.display='none'; a.style.display=''; } }
function esperaVal(pref){ return document.getElementById(pref+'EsperaWrap').style.display==='none'?0:(parseInt(document.getElementById(pref+'Espera').value)||0); }
async function cargar(){ META=await api('GET','/api/erp/citas/meta'); LIST=await api('GET','/api/erp/citas/servicios/list'); render(); }
function render(){
  var b=document.getElementById('svcBody');
  if(!LIST.length){ b.innerHTML='<tr><td colspan="7" style="color:var(--muted)">No hay productos de tipo servicio en el catálogo. Créalos con «Nuevo servicio».</td></tr>'; return; }
  b.innerHTML=LIST.map(function(s){
    var contigo = s.muerto_dur_min ? s.muerto_ini_min : s.duracion_min;
    var pub = window.CITAS_EDIT
      ? '<label style="font-size:.85rem;display:inline-flex;gap:.35rem;align-items:center"><input type="checkbox" '+(s.publico?'checked':'')+' onchange="svcPublico('+s.id+',this)"> '+(s.publico?'Sí':'No')+'</label>'
      : (s.publico?'Sí':'No');
    return '<tr><td>'+esc(s.name)+'</td><td>'+(s.reservable?'Sí':(s.configurado?'No':'—'))+'</td><td>'+pub+'</td><td>'+(s.duracion_min!=null?(contigo+' min'):'<span style="color:var(--muted)">sin configurar</span>')+'</td><td>'+(s.muerto_dur_min?(s.muerto_dur_min+' min libre'):'—')+'</td><td>'+(s.margen_min||0)+' min</td><td>'+(window.CITAS_EDIT?'<button class="btn btn-secondary btn-sm" onclick="edit('+s.id+')">Configurar</button>':'')+'</td></tr>';
  }).join('');
}
function edit(id){
  var s=LIST.find(x=>x.id===id);
  document.getElementById('svcId').value=id; document.getElementById('mSvcTitle').textContent=s.name;
  document.getElementById('svcReservable').checked=s.reservable!==0;
  var espera = s.muerto_dur_min||0;
  var contigo = espera>0 ? (s.muerto_ini_min||0) : (s.duracion_min||30);
  document.getElementById('svcContigo').value=contigo||30; document.getElementById('svcMargen').value=s.margen_min||0;
  esperaReset('svc', espera);
  document.getElementById('svcProviders').innerHTML=META.personas.map(p=>'<label style="font-size:.85rem"><input type="checkbox" class="svcprov" value="'+p.id+'" '+((s.providers||[]).includes(p.id)?'checked':'')+'> '+esc(p.name)+'</label>').join('')||'<span style="color:var(--muted)">Sin personas</span>';
  pintaPuestos(s.resources||[]);
  // El alta vuelve a su estado plegado cada vez que se abre el modal.
  document.getElementById('svcAltaWrap').style.display='none';
  document.getElementById('svcAltaBtn').style.display=window.CITAS_EDIT?'':'none';
  document.getElementById('svcAltaAviso').style.display='none';
  openModal('mSvc');
}
// ── DAR DE ALTA UN PUESTO SIN SALIR DE AQUÍ ───────────────────────────────────────────────────
// Al terminar NO se recarga la pantalla: se vuelve a pedir META, se repintan las casillas con la
// nueva ya marcada, y se dice en voz alta que la entrada ya está en la configuración del negocio.
// Recargar habría perdido lo que el dueño llevaba escrito en el modal.
function svcAltaAbrir(){
  document.getElementById('svcAltaBtn').style.display='none';
  var w=document.getElementById('svcAltaWrap'); w.style.display='flex';
  document.getElementById('svcAltaNombre').focus();
}
function pintaPuestos(marcados){
  var sel=new Set(marcados||[]);
  document.getElementById('svcResources').innerHTML=META.recursos.map(function(r){
    return '<label style="font-size:.85rem"><input type="checkbox" class="svcres" value="'+r.id+'" '+(sel.has(r.id)?'checked':'')+'> '+esc(r.nombre)+'</label>';
  }).join('')||'<span style="color:var(--muted)">Aún no tienes '+(window.PUESTO_PLURAL||'puestos').toLowerCase()+'</span>';
}
async function svcAltaPuesto(){
  var nombre=(document.getElementById('svcAltaNombre').value||'').trim();
  if(!nombre){ toast('Ponle un nombre','err'); return; }
  var b=document.getElementById('svcAltaOk'); b.disabled=true;
  try{
    var marcados=[...document.querySelectorAll('.svcres:checked')].map(x=>parseInt(x.value));
    var r=await api('POST','/api/erp/citas/recursos',{nombre:nombre,tipo:document.getElementById('svcAltaTipo').value,notas:''});
    META=await api('GET','/api/erp/citas/meta');
    var nuevo=(META.recursos.find(function(x){return x.nombre===nombre;})||{}).id;
    if(nuevo) marcados.push(nuevo);
    pintaPuestos(marcados);
    document.getElementById('svcAltaNombre').value='';
    var av=document.getElementById('svcAltaAviso');
    av.style.display='';
    av.innerHTML='Ya tienes «'+esc(window.PUESTO_PLURAL||'Puestos')+'» en la configuración de tu negocio. <a href="/admin/settings#cfg-agenda">Verlos →</a>';
    toast(esc(window.PUESTO_SING||'Puesto')+' dado de alta');
  }catch(e){ toast(e.message,'err'); }
  finally{ b.disabled=false; }
}
async function svcPublico(id, cb){
  var quiere = cb.checked;
  try{ var r = await api('POST','/api/erp/reserva-publica/servicio/'+id+'?publico='+(quiere?'1':'0')); toast(r.message); cargar(); }
  catch(e){ cb.checked = !quiere; toast(e.message,'err'); }
}
async function svcGuardar(){
  var id=document.getElementById('svcId').value;
  var contigo=parseInt(document.getElementById('svcContigo').value)||0, espera=esperaVal('svc');
  if(contigo<1){ toast('El «tiempo contigo» debe ser al menos 1 minuto','err'); return; }
  var body={ reservable:document.getElementById('svcReservable').checked, duracion_min:contigo+espera, muerto_ini_min:contigo, muerto_dur_min:espera, margen_min:parseInt(document.getElementById('svcMargen').value)||0,
    provider_ids:[...document.querySelectorAll('.svcprov:checked')].map(x=>parseInt(x.value)), resource_ids:[...document.querySelectorAll('.svcres:checked')].map(x=>parseInt(x.value)) };
  try{ await api('PUT','/api/erp/citas/servicios/'+id,body); closeModal('mSvc'); toast('Guardado'); cargar(); }catch(e){ toast(e.message,'err'); }
}
function openNuevoServicio(){
  document.getElementById('nsNombre').value=''; document.getElementById('nsPrecio').value='0'; document.getElementById('nsIva').value='general';
  document.getElementById('nsContigo').value='30'; document.getElementById('nsMargen').value='0'; esperaReset('ns',0);
  openModal('mNuevoSvc');
}
async function svcCrear(){
  var contigo=parseInt(document.getElementById('nsContigo').value)||0, espera=esperaVal('ns');
  if(!document.getElementById('nsNombre').value.trim()){ toast('Ponle un nombre','err'); return; }
  if(contigo<1){ toast('El «tiempo contigo» debe ser al menos 1 minuto','err'); return; }
  var body={ nombre:document.getElementById('nsNombre').value, precio:document.getElementById('nsPrecio').value||0, tax_band:document.getElementById('nsIva').value,
    duracion_min:contigo+espera, muerto_ini_min:contigo, muerto_dur_min:espera, margen_min:parseInt(document.getElementById('nsMargen').value)||0 };
  try{ await api('POST','/api/erp/citas/servicios',body); closeModal('mNuevoSvc'); toast('Servicio creado'); cargar(); }catch(e){ toast(e.message,'err'); }
}
cargar();
`;

const JS_RECURSOS = String.raw`
function esc(s){return String(s==null?'':s).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));}
var LIST=[];
async function cargar(){ LIST=await api('GET','/api/erp/citas/recursos/list'); render(); }
function render(){
  var b=document.getElementById('recBody');
  b.innerHTML=LIST.length?LIST.map(r=>'<tr><td>'+esc(r.nombre)+'</td><td>'+esc(r.tipo)+'</td><td style="color:var(--muted)">'+esc(r.notas||'—')+'</td><td>'+(window.CITAS_EDIT?'<button class="btn btn-secondary btn-sm" onclick="edit('+r.id+')">Editar</button> <button class="btn btn-danger btn-sm" onclick="del('+r.id+')">Archivar</button>':'')+'</td></tr>').join(''):'<tr><td colspan="4" style="color:var(--muted)">Aún no hay '+(window.PUESTO_PLURAL||'puestos').toLowerCase()+'.</td></tr>';
}
function openRecurso(){ document.getElementById('recId').value=''; document.getElementById('mRecTitle').textContent='Nuevo '+(window.PUESTO_SING||'Puesto').toLowerCase(); document.getElementById('recNombre').value=''; document.getElementById('recTipo').value='silla'; document.getElementById('recNotas').value=''; openModal('mRec'); }
function edit(id){ var r=LIST.find(x=>x.id===id); document.getElementById('recId').value=id; document.getElementById('mRecTitle').textContent='Editar '+(window.PUESTO_SING||'Puesto').toLowerCase(); document.getElementById('recNombre').value=r.nombre; document.getElementById('recTipo').value=r.tipo; document.getElementById('recNotas').value=r.notas||''; openModal('mRec'); }
async function recGuardar(){ var id=document.getElementById('recId').value; var body={nombre:document.getElementById('recNombre').value,tipo:document.getElementById('recTipo').value,notas:document.getElementById('recNotas').value};
  try{ if(id) await api('PUT','/api/erp/citas/recursos/'+id,body); else await api('POST','/api/erp/citas/recursos',body); closeModal('mRec'); toast('Guardado'); cargar(); }catch(e){ toast(e.message,'err'); } }
async function del(id){ if(!confirm('¿Archivar?'))return; try{ await api('DELETE','/api/erp/citas/recursos/'+id); toast('Archivado'); cargar(); }catch(e){ toast(e.message,'err'); } }
cargar();
`;

// ── LA CARA DE «CUÁNDO ABRO» ─────────────────────────────────────────────────────────────────────
// Vive aquí y no en el CSS de la agenda porque es de ESTA pantalla y de ninguna otra. Se apoya en los
// tokens del panel (DISEÑO §2): ni un color a mano que no salga de una variable.
const HOR_CSS = `<style>
  .hor-intro{background:var(--bg2);border:1px solid var(--border2);border-radius:var(--radius-lg,12px);
             padding:.9rem 1.1rem;margin-bottom:1rem;font-size:.86rem;color:var(--text2);line-height:1.55;max-width:920px}
  .hor-card{margin-bottom:1rem;max-width:920px}
  .hor-ayuda{color:var(--text2);font-size:.82rem;margin:0 0 .9rem;line-height:1.5}
  .hor-quien{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
  /* EL RESUMEN EN CRISTIANO. Es lo primero que se lee y lo que faltaba: la pantalla enseñaba catorce
     campos de hora y en ninguna parte decía, en una frase, qué horario tiene el negocio. */
  .hor-resumen{margin-top:.9rem;padding:.75rem .95rem;border-radius:10px;background:var(--bg3,rgba(20,22,27,.03));
               font-size:.9rem;color:var(--text);line-height:1.6}
  .hor-resumen b{font-weight:600}
  .hor-resumen .cerrados{color:var(--text2)}
  /* Los atajos: «lunes a viernes» de un clic, que es lo que se pidió. */
  .hor-atajos{display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.9rem}
  .hor-chip-atajo{appearance:none;font-family:inherit;font-size:.8rem;font-weight:600;cursor:pointer;
                  padding:.42rem .8rem;border-radius:999px;border:1px solid var(--border2);
                  background:var(--bg2);color:var(--text)}
  .hor-chip-atajo:hover{border-color:var(--accent);color:var(--accent)}
  /* Los siete días, como interruptores redondos. Se ve de un vistazo cuáles están elegidos. */
  .hor-dias-sel{display:flex;gap:.35rem;flex-wrap:wrap;margin-bottom:1rem}
  .hor-dia-chip{appearance:none;font-family:inherit;font-size:.82rem;font-weight:600;cursor:pointer;
                width:40px;height:40px;border-radius:50%;border:1px solid var(--border2);
                background:var(--bg2);color:var(--text2)}
  .hor-dia-chip[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff}
  /* EL CONTROL SEGMENTADO. Existe en la agenda, pero su CSS vive en la hoja de ESA pantalla, que
     aquí no se carga: sin esto los dos botones salían como texto suelto con un borde raro. Se copian
     las mismas reglas, con el mismo aspecto, para que un segmentado se vea igual en todo el panel. */
  .hor-jornada{margin-bottom:.9rem}
  .hor-jornada .segmented{display:inline-flex;background:var(--bg3);border:1px solid var(--border2);border-radius:9px;padding:2px;gap:2px}
  .hor-jornada .segmented button{appearance:none;border:0;background:transparent;color:var(--text2);font-family:inherit;font-size:.82rem;font-weight:500;padding:.4rem .9rem;border-radius:7px;cursor:pointer;transition:background .15s,color .15s,box-shadow .15s;line-height:1.4}
  .hor-jornada .segmented button:hover{color:var(--text)}
  .hor-jornada .segmented button[aria-selected="true"]{background:var(--bg2);color:var(--text);font-weight:600;box-shadow:0 1px 2px rgba(20,22,27,.10)}
  .hor-jornada .segmented button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
  .hor-horas{display:flex;gap:1.2rem;flex-wrap:wrap;margin-bottom:1rem}
  .hor-par{display:flex;align-items:center;gap:.4rem}
  /* 'display:flex' GANA a '[hidden]', que solo trae 'display:none' del navegador y con menos peso.
     Sin esta línea el tramo de tarde se seguía viendo en «horario corrido»: escondido en el DOM y a
     la vista en la pantalla. Lo cazó una captura, no una aserción — la mía miraba el ATRIBUTO. */
  .hor-par[hidden]{display:none}
  .hor-par input{width:auto}
  .hor-par-lbl{font-size:.82rem;font-weight:600;color:var(--text2);min-width:78px}
  .hor-guion{color:var(--text3)}
  .hor-aplicar{display:flex;align-items:center;gap:.8rem;flex-wrap:wrap}
  .hor-vista-previa{font-size:.82rem;color:var(--text2)}
  /* LA LISTA DE DÍAS. Una fila por día, con su interruptor a la izquierda: cerrar un martes deja de
     ser «bórrale los campos» y pasa a ser un clic, y las horas se recuerdan por si se vuelve a abrir. */
  .hor-dia{display:flex;align-items:flex-start;gap:.9rem;padding:.85rem 1.25rem;border-top:1px solid var(--border)}
  .hor-dia:first-child{border-top:0}
  .hor-dia.cerrado{background:var(--bg3,rgba(20,22,27,.02))}
  .hor-dia-nombre{width:104px;flex:0 0 auto;font-weight:600;font-size:.9rem;padding-top:.35rem}
  .hor-dia.cerrado .hor-dia-nombre{color:var(--text2)}
  .hor-dia-cuerpo{flex:1;min-width:0;display:flex;flex-direction:column;gap:.4rem}
  .hor-dia-acc{display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;padding-top:.2rem}
  .hor-cerrado-txt{font-size:.85rem;color:var(--text3);padding-top:.4rem}
  .hor-tramo{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap}
  .hor-tramo input{width:auto}
  .hor-mini{appearance:none;font-family:inherit;font-size:.76rem;font-weight:600;cursor:pointer;
            padding:.3rem .6rem;border-radius:8px;border:1px solid var(--border2);background:var(--bg2);color:var(--text2)}
  .hor-mini:hover{border-color:var(--accent);color:var(--accent)}
  .hor-quitar{appearance:none;border:0;background:transparent;color:var(--text3);cursor:pointer;font-size:1rem;line-height:1;padding:.25rem .35rem;border-radius:6px}
  .hor-quitar:hover{background:var(--danger-soft,#FBE3E3);color:var(--danger,#C0392B)}
  /* El interruptor. No hay ninguno en el panel todavía, así que nace aquí, pequeño y con foco visible. */
  .sw{position:relative;display:inline-block;width:38px;height:22px;flex:0 0 auto;margin-top:.3rem}
  .sw input{position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer}
  .sw span{position:absolute;inset:0;border-radius:999px;background:var(--border2);transition:background .15s}
  .sw span::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;
                  background:#fff;box-shadow:0 1px 3px rgba(16,24,40,.25);transition:transform .15s}
  .sw input:checked + span{background:var(--accent)}
  .sw input:checked + span::after{transform:translateX(16px)}
  .sw input:focus-visible + span{outline:2px solid var(--accent);outline-offset:2px}
  .sw input:disabled{cursor:default}
  .hor-pie{display:flex;align-items:center;gap:.9rem;padding:1rem 1.25rem;border-top:1px solid var(--border);flex-wrap:wrap}
  .hor-sucio{font-size:.82rem;font-weight:600;color:#8A5B00}
  .hor-exc-alta{display:flex;gap:.6rem;flex-wrap:wrap;align-items:flex-end;margin-bottom:1rem}
  @media (max-width:640px){
    .hor-dia{flex-wrap:wrap}
    .hor-dia-nombre{width:auto}
    .hor-par-lbl{min-width:0}
  }
</style>`;

const JS_HORARIOS = String.raw`
function esc(s){return String(s==null?'':s).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));}
var DIAS=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
var DIAS_CORTO=['D','L','M','X','J','V','S'];
var ORDEN=[1,2,3,4,5,6,0];                       // la semana empieza en lunes, como en España
function fhhmm(m){if(m==null)return '';var h=Math.floor(m/60),mm=m%60;return (h<10?'0':'')+h+':'+(mm<10?'0':'')+mm;}
function hcorta(m){ if(m==null)return ''; var h=Math.floor(m/60),mm=m%60; return h+':'+(mm<10?'0':'')+mm; }
function toMin(t){ if(!t)return null; var p=t.split(':'); return parseInt(p[0])*60+parseInt(p[1]); }
function hToggle(){ document.getElementById('hUser').style.display=document.getElementById('hScope').value==='user'?'':'none'; }
function scopeArgs(){ var s=document.getElementById('hScope').value; var u=document.getElementById('hUser').value; return {scope:s,user_id:s==='user'?u:null}; }

var GRID={};          // dow -> [[ini,fin], …]  los tramos ABIERTOS
var MEMORIA={};       // dow -> lo último que tuvo ese día antes de cerrarlo (para poder devolvérselo)
var SUCIO=false;      // ¿hay cambios sin guardar?
var SEL=new Set();    // los días elegidos en «Ponlo de una vez»
var JORNADA='corrido';

function marcaSucio(v){
  SUCIO=v;
  var el=document.getElementById('horSucio'); if(el){ if(v) el.removeAttribute('hidden'); else el.setAttribute('hidden',''); }
}
// Aviso al salir con cambios sin guardar. Un horario a medio poner que se pierde al cambiar de
// pestaña es de las cosas que más rabia dan, y no cuesta nada evitarlo.
window.addEventListener('beforeunload', function(e){ if(SUCIO){ e.preventDefault(); e.returnValue=''; } });

async function hCargar(){
  var a=scopeArgs(); var q='/api/erp/citas/horario?scope='+a.scope+(a.user_id?'&user_id='+a.user_id:'');
  var d=await api('GET',q);
  GRID={}; MEMORIA={}; for(var i=0;i<7;i++) GRID[i]=[];
  (d.tramos||[]).forEach(function(t){ GRID[t.dow].push([t.inicio_min,t.fin_min]); });
  for(var k=0;k<7;k++) GRID[k].sort(function(x,y){ return x[0]-y[0]; });
  marcaSucio(false); pintaDias(); pintaResumen(); renderExc(d.excepciones);
}

// ── EL RESUMEN, EN UNA FRASE ─────────────────────────────────────────────────────────────────────
// Agrupa los días que tienen EXACTAMENTE el mismo horario y los nombra por su rango cuando son
// seguidos («lunes a jueves»), que es como lo diría una persona. Sin esto la pantalla obligaba a
// leer catorce campos de hora para saber algo que cabe en un renglón.
function textoTramos(ts){ return ts.map(function(t){ return hcorta(t[0])+' a '+hcorta(t[1]); }).join(' y de '); }
function nombraGrupo(dows){
  var idx=dows.map(function(d){ return ORDEN.indexOf(d); }).sort(function(a,b){ return a-b; });
  var seguidos = idx.every(function(v,i){ return i===0 || v===idx[i-1]+1; });
  if(idx.length>=3 && seguidos) return DIAS[ORDEN[idx[0]]].toLowerCase()+' a '+DIAS[ORDEN[idx[idx.length-1]]].toLowerCase();
  var n=idx.map(function(i){ return DIAS[ORDEN[i]].toLowerCase(); });
  return n.length>1 ? n.slice(0,-1).join(', ')+' y '+n[n.length-1] : n[0];
}
function pintaResumen(){
  var box=document.getElementById('horResumen'); if(!box) return;
  var abiertos=ORDEN.filter(function(d){ return GRID[d] && GRID[d].length; });
  if(!abiertos.length){
    box.innerHTML='<b>Ahora mismo no abres ningún día.</b> <span class="cerrados">Mientras no pongas horario, la agenda da el día por abierto de 8:00 a 21:00 para que puedas trabajar igual.</span>';
    return;
  }
  var grupos=[], visto={};
  abiertos.forEach(function(d){
    var clave=textoTramos(GRID[d]);
    if(visto[clave]===undefined){ visto[clave]=grupos.length; grupos.push({clave:clave,dows:[d]}); }
    else grupos[visto[clave]].dows.push(d);
  });
  var frases=grupos.map(function(g){ return '<b>'+esc(nombraGrupo(g.dows))+'</b> de '+esc(g.clave); });
  var cerrados=ORDEN.filter(function(d){ return !GRID[d] || !GRID[d].length; });
  var cola = cerrados.length ? ' <span class="cerrados">Cierras '+esc(nombraGrupo(cerrados))+'.</span>' : '';
  box.innerHTML='Abres '+frases.join('; ')+'.'+cola;
}

// ── LA LISTA DE DÍAS ─────────────────────────────────────────────────────────────────────────────
function pintaDias(){
  var h='';
  ORDEN.forEach(function(dow){
    var ts=GRID[dow]||[], abierto=ts.length>0;
    h+='<div class="hor-dia'+(abierto?'':' cerrado')+'" data-dow="'+dow+'">'
      + (window.CITAS_EDIT
          ? '<label class="sw"><input type="checkbox" '+(abierto?'checked':'')+' data-abre="'+dow+'" aria-label="Abrir el '+DIAS[dow]+'"><span></span></label>'
          : '')
      + '<div class="hor-dia-nombre">'+DIAS[dow]+'</div>'
      + '<div class="hor-dia-cuerpo">'
      + (abierto
          ? ts.map(function(t,i){
              return '<div class="hor-tramo">'
                + '<input type="time" class="form-control" value="'+fhhmm(t[0])+'" '+(window.CITAS_EDIT?'':'disabled')+' data-h="'+dow+':'+i+':0">'
                + '<span class="hor-guion">–</span>'
                + '<input type="time" class="form-control" value="'+fhhmm(t[1])+'" '+(window.CITAS_EDIT?'':'disabled')+' data-h="'+dow+':'+i+':1">'
                + (window.CITAS_EDIT && ts.length>1 ? '<button type="button" class="hor-quitar" data-quita="'+dow+':'+i+'" title="Quitar este tramo" aria-label="Quitar este tramo">✕</button>' : '')
                + '</div>';
            }).join('')
          : '<div class="hor-cerrado-txt">Cerrado</div>')
      + '</div>'
      + (window.CITAS_EDIT && abierto
          ? '<div class="hor-dia-acc">'
            + '<button type="button" class="hor-mini" data-mas="'+dow+'">+ tramo</button>'
            + '<button type="button" class="hor-mini" data-copia="'+dow+'">Copiar al resto</button>'
            + '</div>'
          : '')
      + '</div>';
  });
  document.getElementById('hGrid').innerHTML=h;
}

// Un solo oyente para toda la lista: los botones nacen y mueren con cada repintado, y colgarles un
// manejador a cada uno es la forma de que uno se quede sin él sin que nadie se entere.
document.addEventListener('click', function(ev){
  var t=ev.target.closest ? ev.target : null; if(!t) return;
  var b;
  if((b=t.closest('[data-mas]'))){ var d=+b.getAttribute('data-mas'); GRID[d].push([15*60,20*60]); tocado(); }
  else if((b=t.closest('[data-quita]'))){ var q=b.getAttribute('data-quita').split(':'); GRID[+q[0]].splice(+q[1],1); tocado(); }
  else if((b=t.closest('[data-copia]'))){ horCopiar(+b.getAttribute('data-copia')); }
  else if((b=t.closest('[data-atajo]'))){ horAtajo(b.getAttribute('data-atajo')); }
  else if((b=t.closest('[data-dia-sel]'))){ horPicaDia(+b.getAttribute('data-dia-sel')); }
});
document.addEventListener('change', function(ev){
  var el=ev.target;
  if(el.hasAttribute && el.hasAttribute('data-abre')) horAbreDia(+el.getAttribute('data-abre'), el.checked);
  else if(el.hasAttribute && el.hasAttribute('data-h')){
    var q=el.getAttribute('data-h').split(':');
    GRID[+q[0]][+q[1]][+q[2]]=toMin(el.value);
    marcaSucio(true); pintaResumen();
  }
});
function tocado(){ marcaSucio(true); pintaDias(); pintaResumen(); }

// Cerrar un día NO le borra las horas: se guardan y se le devuelven si lo vuelve a abrir. Un
// interruptor que además borra lo que había castiga por probar.
function horAbreDia(dow, abre){
  if(abre) GRID[dow]=(MEMORIA[dow] && MEMORIA[dow].length) ? MEMORIA[dow].map(function(t){ return t.slice(); }) : [[9*60,14*60]];
  else { if(GRID[dow].length) MEMORIA[dow]=GRID[dow].map(function(t){ return t.slice(); }); GRID[dow]=[]; }
  tocado();
}
function horCopiar(dow){
  var ts=GRID[dow]; if(!ts.length) return;
  ORDEN.forEach(function(d){ if(d!==dow && GRID[d].length) GRID[d]=ts.map(function(t){ return t.slice(); }); });
  tocado(); toast('Copiado a los demás días que abres');
}

// ── «PONLO DE UNA VEZ» ───────────────────────────────────────────────────────────────────────────
function pintaDiasSel(){
  var box=document.getElementById('horDiasSel'); if(!box) return;
  box.innerHTML=ORDEN.map(function(d){
    return '<button type="button" class="hor-dia-chip" data-dia-sel="'+d+'" aria-pressed="'+(SEL.has(d)?'true':'false')+'" aria-label="'+DIAS[d]+'">'+DIAS_CORTO[d]+'</button>';
  }).join('');
  pintaPrevia();
}
function horPicaDia(d){ if(SEL.has(d)) SEL.delete(d); else SEL.add(d); pintaDiasSel(); }
function horAtajo(lista){ SEL=new Set(lista.split(',').map(Number)); pintaDiasSel(); }
function horJornada(j){
  JORNADA=j;
  document.getElementById('hjCorrido').setAttribute('aria-selected', j==='corrido'?'true':'false');
  document.getElementById('hjPartido').setAttribute('aria-selected', j==='partido'?'true':'false');
  var p2=document.getElementById('hpPar2'); if(j==='partido') p2.removeAttribute('hidden'); else p2.setAttribute('hidden','');
  document.getElementById('hpLbl1').textContent = j==='partido' ? 'Por la mañana' : 'Abro';
  pintaPrevia();
}
function tramosDelFormulario(){
  var a1=toMin(document.getElementById('hpA1').value), b1=toMin(document.getElementById('hpB1').value);
  var out=[]; if(a1!=null&&b1!=null) out.push([a1,b1]);
  if(JORNADA==='partido'){
    var a2=toMin(document.getElementById('hpA2').value), b2=toMin(document.getElementById('hpB2').value);
    if(a2!=null&&b2!=null) out.push([a2,b2]);
  }
  return out;
}
function pintaPrevia(){
  var el=document.getElementById('horPrevia'); if(!el) return;
  var ts=tramosDelFormulario();
  if(!SEL.size){ el.textContent='Elige al menos un día.'; return; }
  if(!ts.length){ el.textContent='Pon las horas.'; return; }
  el.textContent='Quedará: '+nombraGrupo([...SEL])+' de '+textoTramos(ts)+'.';
}
function horAplica(){
  var ts=tramosDelFormulario();
  if(!SEL.size){ toast('Elige primero a qué días se lo aplicas','warn'); return; }
  if(!ts.length){ toast('Faltan las horas','warn'); return; }
  for(var i=0;i<ts.length;i++) if(ts[i][1]<=ts[i][0]){ toast('Un tramo termina antes de empezar','err'); return; }
  if(ts.length===2 && ts[1][0]<ts[0][1]){ toast('La tarde empieza antes de que acabe la mañana','err'); return; }
  SEL.forEach(function(d){ GRID[d]=ts.map(function(t){ return t.slice(); }); });
  tocado();
  toast('Aplicado a '+SEL.size+(SEL.size===1?' día':' días')+'. Repásalo y pulsa «Guardar horario».');
}

async function hGuardar(){
  var a=scopeArgs(), tramos=[];
  for(var d=0;d<7;d++) (GRID[d]||[]).forEach(function(t){ if(t[0]!=null&&t[1]!=null) tramos.push({dow:d,inicio_min:t[0],fin_min:t[1]}); });
  var malo=tramos.find(function(t){ return t.fin_min<=t.inicio_min; });
  if(malo){ toast('El '+DIAS[malo.dow].toLowerCase()+' termina antes de empezar ('+hcorta(malo.inicio_min)+'–'+hcorta(malo.fin_min)+')','err'); return; }
  try{ await api('POST','/api/erp/citas/horario',{scope:a.scope,user_id:a.user_id,tramos:tramos}); marcaSucio(false); toast('Horario guardado'); }
  catch(e){ toast(e.message,'err'); }
}
function eToggle(){ document.getElementById('eHoras').style.display=document.getElementById('eTipo').value==='horario'?'':'none'; }
async function eAdd(){
  var a=scopeArgs();
  var body={scope:a.scope,user_id:a.user_id,fecha:document.getElementById('eFecha').value,tipo:document.getElementById('eTipo').value,motivo:document.getElementById('eMotivo').value};
  if(!body.fecha){ toast('Elige el día','warn'); return; }
  if(body.tipo==='horario'){ body.inicio_min=toMin(document.getElementById('eIni').value); body.fin_min=toMin(document.getElementById('eFin').value); }
  try{ await api('POST','/api/erp/citas/excepcion',body); toast('Añadido'); document.getElementById('eMotivo').value=''; hCargar(); }catch(e){ toast(e.message,'err'); }
}
function renderExc(exc){
  var box=document.getElementById('excList');
  if(!exc||!exc.length){ box.innerHTML='<div style="color:var(--text3);font-size:.85rem">No tienes ningún día suelto apuntado.</div>'; return; }
  box.innerHTML='<div class="table-wrap"><table><thead><tr><th>Día</th><th>Qué pasa</th><th>Horario</th><th>Motivo</th><th></th></tr></thead><tbody>'
    +exc.map(e=>'<tr><td>'+esc(e.fecha)+'</td><td>'+(e.tipo==='cerrado'?'Cerrado todo el día':'Abre a otras horas')+'</td><td>'+(e.tipo==='horario'?hcorta(e.inicio_min)+'–'+hcorta(e.fin_min):'—')+'</td><td>'+esc(e.motivo||'')+'</td><td>'+(window.CITAS_EDIT?'<button class="hor-quitar" onclick="eDel('+e.id+')" title="Quitar" aria-label="Quitar">✕</button>':'')+'</td></tr>').join('')+'</tbody></table></div>';
}
async function eDel(id){ try{ await api('DELETE','/api/erp/citas/excepcion/'+id); toast('Quitado'); hCargar(); }catch(e){ toast(e.message,'err'); } }
['hpA1','hpB1','hpA2','hpB2'].forEach(function(id){ var el=document.getElementById(id); if(el) el.addEventListener('change', pintaPrevia); });
hToggle(); pintaDiasSel(); hCargar();
`;

const JS_AJUSTES = String.raw`
function toMin(t){ if(!t)return ''; var p=t.split(':'); return parseInt(p[0])*60+parseInt(p[1]); }
async function ajGuardar(){
  var pu=(document.getElementById('ajPuesto').value||'Puesto|Puestos').split('|');
  var body={ cita_grid_min:parseInt(document.getElementById('ajGrid').value), cita_antelacion_min:parseInt(document.getElementById('ajAntel').value)||0,
    cita_ventana_dias:parseInt(document.getElementById('ajVentana').value)||60, cita_corte_mismo_dia_min:toMin(document.getElementById('ajCorte').value),
    cita_margen_defecto_min:parseInt(document.getElementById('ajMargen').value)||0, cita_canal_defecto:document.getElementById('ajCanal').value, cita_modo_recordatorio:document.getElementById('ajModo').value,
    cita_puesto_sing:pu[0], cita_puesto_plural:pu[1]||pu[0] };
  try{ await api('POST','/api/erp/citas/ajustes',body); toast('Ajustes guardados'); setTimeout(function(){location.reload();},400); }catch(e){ toast(e.message,'err'); }
}
`;
