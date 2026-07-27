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
import { escHtml } from '../../../core/escape.js';
import { nextCode } from '../codes.js';
import { ENTITY } from '../../../core/activity-entities.js';
import { resolveVatRate } from '../../../core/vat-bands.js';
import {
  citaSchema, citaMoverSchema, citaEstadoSchema, citaAtenderSchema, bloqueoSchema,
  recursoSchema, serviceConfigSchema, serviceCreateSchema, horarioSchema, excepcionSchema, avisoMarcarSchema, citaAjustesSchema,
} from '../schemas.js';
import {
  geometriaCadena, comprobarSolape, huecos, ahoraLocal, hhmm, dowDeFecha, diasEntre,
  ESTADO_LABEL, puedeTransicionar, tramosPersona, tramosAmbito,
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

const genToken = () => randomBytes(32).toString('base64url');
const err = (msg, status) => { const e = new Error(msg); e.status = status; return e; };

// ── Ajustes de citas del negocio (company_config), con defaults seguros ────────────────────────────
export function ajustesCitas(db) {
  const cfg = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
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
  };
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
  const sol = comprobarSolape(db, {
    user_id: d.user_id, recurso_id: d.recurso_id || null, fecha: d.fecha, inicio_min: d.inicio_min,
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
    ).run(codigo, d.cliente_id || null, d.cliente_suelto_nombre || '', movil, d.user_id, d.recurso_id || null,
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
  const sol = comprobarSolape(db, {
    user_id, recurso_id, fecha: d.fecha, inicio_min: d.inicio_min,
    dur_min: cita.dur_min, margen_min: cita.margen_min, servicios, excludeCitaId: id,
  });
  if (!sol.ok) throw err(sol.motivo, 409);
  db.prepare('UPDATE citas SET fecha=?,inicio_min=?,user_id=?,recurso_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(d.fecha, d.inicio_min, user_id, recurso_id, id);
  return { id: Number(id) };
}

export function cambiarEstadoSvc(db, id, estado) {
  const cita = db.prepare('SELECT * FROM citas WHERE id=?').get(id);
  if (!cita) throw err('Cita no encontrada', 404);
  if (!puedeTransicionar(cita.estado, estado)) throw err('No se puede pasar de «' + cita.estado + '» a «' + estado + '»', 400);
  const stamp = estado === 'confirmada' ? 'confirmada_at' : (estado === 'atendida' ? 'atendida_at' : (estado === 'anulada' ? 'anulada_at' : null));
  db.prepare(`UPDATE citas SET estado=?, ${stamp ? stamp + '=CURRENT_TIMESTAMP,' : ''} updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(estado, id);
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
export function anularCitaSvc(db, id, motivo = 'Cita anulada') {
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
    db.prepare("UPDATE citas SET estado='anulada', anulada_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
  })();
  return { id: Number(id), estado: 'anulada' };
}

// ── Datos de la agenda (para la vista día/semana, por persona o por recurso) ───────────────────────
export function agendaData(db, { desde, hasta }) {
  const citas = db.prepare(
    `SELECT c.*, u.name AS persona, r.nombre AS recurso, cl.name AS cliente_nombre
       FROM citas c LEFT JOIN admin_users u ON u.id=c.user_id LEFT JOIN recursos r ON r.id=c.recurso_id
       LEFT JOIN clients cl ON cl.id=c.cliente_id
      WHERE c.fecha>=? AND c.fecha<=? AND c.archived=0 AND c.estado<>'anulada' ORDER BY c.fecha, c.inicio_min`
  ).all(desde, hasta).map(c => ({
    id: c.id, codigo: c.codigo, fecha: c.fecha, inicio_min: c.inicio_min, dur_min: c.dur_min, margen_min: c.margen_min,
    estado: c.estado, user_id: c.user_id, recurso_id: c.recurso_id, persona: c.persona || '—',
    recurso: c.recurso || null, cliente: c.cliente_nombre || c.cliente_suelto_nombre || 'Cliente',
    servicios: serviciosDeCita(db, c.id).join(' + '),
  }));
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
      return c.json(agendaData(db, { desde, hasta }));
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  api.get('/:id', requirePerm('citas.read'), c => {
    try {
      const cita = db.prepare(
        `SELECT c.*, u.name AS persona, r.nombre AS recurso, cl.name AS cliente_nombre, pr.codigo AS proyecto_codigo
           FROM citas c LEFT JOIN admin_users u ON u.id=c.user_id LEFT JOIN recursos r ON r.id=c.recurso_id
           LEFT JOIN clients cl ON cl.id=c.cliente_id LEFT JOIN proyectos pr ON pr.id=c.project_id WHERE c.id=?`
      ).get(c.req.param('id'));
      if (!cita) return c.json({ error: 'No encontrada' }, 404);
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
      return c.json(agendaData(db, { desde, hasta }).citas);
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // ── Escrituras de citas ───────────────────────────────────────────────────
  api.post('/', requirePerm('citas.edit'), validate(citaSchema), c => {
    try {
      const r = createCitaSvc(db, c.get('validated'), { created_by: c.get('session')?.userId });
      logActivity(db, c.get('session'), 'Creó cita', ENTITY.CITA, r.id, r.codigo);
      return c.json({ id: r.id, codigo: r.codigo, message: 'Cita creada' });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  api.put('/:id', requirePerm('citas.edit'), validate(citaSchema), c => {
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
      if (estado === 'anulada') { anularCitaSvc(db, parseInt(c.req.param('id'))); return c.json({ message: 'Cita anulada' }); }
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

  api.delete('/:id', requirePerm('citas.edit'), c => {
    try {
      const r = anularCitaSvc(db, parseInt(c.req.param('id')));
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
        `SELECT p.id, p.name, p.price, p.tax_band, sc.reservable, sc.duracion_min, sc.muerto_ini_min, sc.muerto_dur_min, sc.margen_min
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
      db.prepare(
        `UPDATE company_config SET cita_grid_min=?, cita_antelacion_min=?, cita_ventana_dias=?, cita_corte_mismo_dia_min=?,
           cita_margen_defecto_min=?, cita_canal_defecto=?, cita_modo_recordatorio=? WHERE id=1`
      ).run(d.cita_grid_min, d.cita_antelacion_min, d.cita_ventana_dias, corte, d.cita_margen_defecto_min, d.cita_canal_defecto, d.cita_modo_recordatorio);
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

  return { api, views };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1.9 RUTAS PÚBLICAS DEL ENLACE DE LA CITA (sin sesión, por LLAVE). Solo esa cita; confirmar o avisar.
// Se montan en app.route('/cita', …) — FUERA de /admin y /api (sin auth ni CSRF; el token ES la defensa).
// ════════════════════════════════════════════════════════════════════════════════════════════════
export function createCitasPublicRoutes(db) {
  const app = new Hono();

  // 1.9 LÍMITE DE PETICIONES para evitar barridos de tokens. Por IP+negocio, ventana de 1 min. Un
  // cliente legítimo abre su enlace unas pocas veces; 40/min corta un ataque de fuerza bruta sin
  // molestar a nadie. (En producción el tenant lo resuelve el subdominio, antes de este handler.)
  app.use('*', rateLimit({ windowMs: 60_000, max: 40, keyPrefix: 'cita-link', message: 'Demasiadas peticiones. Espera un momento e inténtalo de nuevo.' }));

  // Resuelve una cita por su token, vigente (no anulada, no archivada, no pasada). Nada más se expone.
  const resolver = (token) => {
    if (!token || token.length < 20) return null;
    const cita = db.prepare('SELECT * FROM citas WHERE token=?').get(token);
    if (!cita) return null;
    if (cita.estado === 'anulada' || cita.archived) return null;
    if (cita.fecha < ahoraLocal().fecha) return null;   // caduca pasada la cita (a nivel de día)
    return cita;
  };

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
    anularCitaSvc(db, cita.id, 'El cliente avisó de que no puede asistir');
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
  const persona = db.prepare('SELECT name FROM admin_users WHERE id=?').get(cita.user_id)?.name || '';
  const contacto = contactoDeCita(db, cita);
  const yaConfirmada = cita.estado === 'confirmada' || cita.estado === 'atendida';
  const E = escHtml;
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
    </style></head>
    <body><div class="wrap">
      <h1>Tu cita en ${E(aj.company_name)}</h1>
      <div class="muted">Hola${contacto.nombre ? ' ' + E(contacto.nombre) : ''}, esta es tu cita. Puedes confirmarla o avisarnos si no puedes venir.</div>
      <div class="card">
        <div class="row"><span class="muted">Servicio</span><b>${E(servicios)}</b></div>
        <div class="row"><span class="muted">Día</span><b>${E(cita.fecha)}</b></div>
        <div class="row"><span class="muted">Hora</span><b>${E(hhmm(cita.inicio_min))}</b></div>
        ${persona ? `<div class="row"><span class="muted">Te atiende</span><b>${E(persona)}</b></div>` : ''}
        ${aj.address ? `<div class="row"><span class="muted">Dónde</span><b>${E(aj.address)}</b></div>` : ''}
        <div class="row"><span class="muted">Estado</span><span class="estado" id="estado">${E(ESTADO_LABEL[cita.estado] || cita.estado)}</span></div>
      </div>
      <div id="acciones">
        <button class="btn ok" id="btnOk" onclick="accion('confirmar')"${yaConfirmada ? ' style="display:none"' : ''}>Confirmar mi cita</button>
        <button class="btn no" onclick="accion('avisar')">No puedo ir</button>
      </div>
      <div id="msg"></div>
      <script>
        var TOKEN = ${JSON.stringify(token)};
        async function accion(a){
          if(a==='avisar' && !confirm('¿Seguro que no puedes venir? Se liberará tu hueco.')) return;
          try{
            var res = await fetch('/cita/'+TOKEN+'/'+a,{method:'POST'});
            var d = await res.json();
            if(!res.ok) throw new Error(d.error||'Error');
            var msg = document.getElementById('msg');
            document.getElementById('acciones').style.display='none';
            if(a==='confirmar'){ msg.style.background='#dcfce7'; msg.style.color='#166534'; msg.textContent='¡Gracias! Tu cita está confirmada.'; document.getElementById('estado').textContent='Confirmada'; }
            else { msg.style.background='#fee2e2'; msg.style.color='#991b1b'; msg.textContent='Gracias por avisar. Hemos anulado tu cita.'; document.getElementById('estado').textContent='Anulada'; }
            msg.style.display='block';
          }catch(e){ alert(e.message); }
        }
      </script>
    </div></body></html>`;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// VISTAS DEL PANEL (server-rendered). Se apoyan en adminLayout + el helper api()/toast() del layout.
// ════════════════════════════════════════════════════════════════════════════════════════════════
function vistaAgenda(c, db) {
  const editable = can(c, 'citas.edit');
  const content = `
    <div class="ph"><h2>Agenda</h2>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
        <input class="form-control" type="date" id="agFecha" style="width:auto" onchange="agCargar()">
        <select class="form-control" id="agVista" style="width:auto" onchange="agCargar()"><option value="dia">Día</option><option value="semana">Semana</option></select>
        <select class="form-control" id="agEje" style="width:auto" onchange="agCargar()"><option value="persona">Por persona</option><option value="recurso">Por recurso</option></select>
        <a class="btn btn-secondary" href="/admin/citas/cola">Cola de envíos</a>
        ${editable ? '<button class="btn btn-secondary" onclick="openBloqueo()">Bloquear un rato</button><button class="btn btn-primary" onclick="openNuevaCita()">Nueva cita</button>' : ''}
      </div>
    </div>
    <div class="card"><div id="agenda" style="overflow-x:auto">Cargando…</div></div>
    ${modalNuevaCita()}
    ${modalDetalle()}
    ${modalBloqueo()}
    ${modalAvisos()}
    <script>window.CITAS_EDIT=${editable ? 'true' : 'false'};${JS_AGENDA}</script>`;
  return adminLayout('Agenda', content, 'citas', c.get('session')?.csrfToken || '', c);
}

function vistaCola(c, db) {
  const content = `
    <div class="ph"><h2>Cola de envíos</h2><a class="btn btn-secondary" href="/admin/citas">← Agenda</a></div>
    <div class="alert" style="margin-bottom:1rem">Doce citas se despachan en doce clics desde aquí, sin abrir doce fichas. Al pulsar el botón de WhatsApp/SMS se abre el mensaje ya escrito con el enlace; el email puede salir solo. <strong>El estado dice "marcado como enviado"</strong> — sabemos que se pulsó el botón, no que el mensaje llegó (nunca "entregado").</div>
    <div class="card"><h3 style="margin-top:0">Mañana — pendientes de recordatorio</h3><div id="colaRec">Cargando…</div></div>
    <div class="card"><h3 style="margin-top:0">Hoy — pendientes de confirmación</h3><div id="colaConf">Cargando…</div></div>
    <script>${JS_COLA}</script>`;
  return adminLayout('Cola de envíos', content, 'citas', c.get('session')?.csrfToken || '', c);
}

function vistaServicios(c, db) {
  const editable = can(c, 'citas.edit');
  const content = `
    <div class="ph"><h2>Servicios reservables</h2><div style="display:flex;gap:.5rem"><a class="btn btn-secondary" href="/admin/citas">← Agenda</a>${editable ? '<button class="btn btn-primary" onclick="openNuevoServicio()">Nuevo servicio</button>' : ''}</div></div>
    <div class="alert" style="margin-bottom:1rem">Son los productos de tipo <strong>servicio</strong> de tu catálogo. Aquí defines lo que la cita necesita: duración, tiempo muerto interior (la persona queda libre ese rato) y margen posterior. <strong>El precio y el IVA siguen viniendo del catálogo.</strong> Un servicio no aparece al pedir cita hasta que tenga <strong>duración</strong> (pulsa «Configurar»). ¿No está en el catálogo? Créalo aquí con «Nuevo servicio».</div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Servicio</th><th>Reservable</th><th>Duración</th><th>Tiempo muerto</th><th>Margen</th><th></th></tr></thead><tbody id="svcBody"><tr><td colspan="6">Cargando…</td></tr></tbody></table></div></div>
    ${modalServicio()}
    ${modalNuevoServicio()}
    <script>window.CITAS_EDIT=${editable ? 'true' : 'false'};${JS_SERVICIOS}</script>`;
  return adminLayout('Servicios reservables', content, 'citas', c.get('session')?.csrfToken || '', c);
}

function vistaRecursos(c, db) {
  const editable = can(c, 'citas.edit');
  const content = `
    <div class="ph"><h2>Recursos</h2><div style="display:flex;gap:.5rem"><a class="btn btn-secondary" href="/admin/citas">← Agenda</a>${editable ? '<button class="btn btn-primary" onclick="openRecurso()">Nuevo recurso</button>' : ''}</div></div>
    <div class="alert" style="margin-bottom:1rem">Sillas, cabinas, salas, boxes o equipos. Una cita puede exigir persona <strong>y</strong> recurso; el motor comprueba los dos.</div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Tipo</th><th>Notas</th><th></th></tr></thead><tbody id="recBody"><tr><td colspan="4">Cargando…</td></tr></tbody></table></div></div>
    ${modalRecurso()}
    <script>window.CITAS_EDIT=${editable ? 'true' : 'false'};${JS_RECURSOS}</script>`;
  return adminLayout('Recursos', content, 'citas', c.get('session')?.csrfToken || '', c);
}

function vistaHorarios(c, db) {
  const editable = can(c, 'citas.edit');
  const personas = db.prepare("SELECT id, name FROM admin_users WHERE active=1 ORDER BY name").all();
  const opts = personas.map(p => '<option value="' + p.id + '">' + escHtml(p.name) + '</option>').join('');
  const content = `
    <div class="ph"><h2>Horarios</h2><a class="btn btn-secondary" href="/admin/citas">← Agenda</a></div>
    <div class="alert" style="margin-bottom:1rem">El horario del negocio y el de cada persona. Los descansos son el hueco entre dos tramos del mismo día. Una persona sin horario propio hereda el del negocio. Las excepciones (vacaciones, festivos, cierres) mandan sobre la regla semanal.</div>
    <div class="card">
      <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin-bottom:1rem">
        <select class="form-control" id="hScope" style="width:auto" onchange="hToggle();hCargar()"><option value="negocio">Negocio</option><option value="user">Una persona</option></select>
        <select class="form-control" id="hUser" style="width:auto;display:none" onchange="hCargar()">${opts}</select>
      </div>
      <div id="hGrid"></div>
      ${editable ? '<button class="btn btn-primary" style="margin-top:1rem" onclick="hGuardar()">Guardar horario</button>' : ''}
    </div>
    <div class="card"><h3 style="margin-top:0">Excepciones (vacaciones, festivos, cierres)</h3>
      ${editable ? `<div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:end;margin-bottom:1rem">
        <div><label class="form-label">Fecha</label><input class="form-control" type="date" id="eFecha"></div>
        <div><label class="form-label">Tipo</label><select class="form-control" id="eTipo" onchange="eToggle()"><option value="cerrado">Cerrado</option><option value="horario">Horario especial</option></select></div>
        <div id="eHoras" style="display:none"><label class="form-label">De–a</label><div style="display:flex;gap:.3rem"><input class="form-control" type="time" id="eIni"><input class="form-control" type="time" id="eFin"></div></div>
        <div><label class="form-label">Motivo</label><input class="form-control" id="eMotivo" placeholder="Festivo…"></div>
        <button class="btn btn-secondary" onclick="eAdd()">Añadir</button>
      </div>` : ''}
      <div id="excList"></div>
    </div>
    <script>window.CITAS_EDIT=${editable ? 'true' : 'false'};${JS_HORARIOS}</script>`;
  return adminLayout('Horarios', content, 'citas', c.get('session')?.csrfToken || '', c);
}

function vistaAjustes(c, db) {
  const aj = ajustesCitas(db);
  const sel = (v, opt) => v === opt ? ' selected' : '';
  const content = `
    <div class="ph"><h2>Ajustes de citas</h2><a class="btn btn-secondary" href="/admin/citas">← Agenda</a></div>
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
      <div class="alert" style="font-size:.85rem">Los avisos por WhatsApp y SMS <strong>siempre van a mano</strong> (se abre el mensaje ya escrito). Solo el <strong>email</strong> puede salir solo, por el envío diario. Nunca decimos "entregado": solo "marcado como enviado".</div>
      <button class="btn btn-primary" onclick="ajGuardar()">Guardar ajustes</button>
    </div>
    <script>${JS_AJUSTES}</script>`;
  return adminLayout('Ajustes de citas', content, 'citas', c.get('session')?.csrfToken || '', c);
}

// ── Modales (HTML) ────────────────────────────────────────────────────────────────────────────────
const modalNuevaCita = () => `
  <div class="modal-overlay" id="mCita"><div class="modal" style="max-width:640px">
    <div class="modal-head"><h3 id="mCitaTitle">Nueva cita</h3><button class="modal-close" onclick="closeModal('mCita')">✕</button></div>
    <div class="modal-body">
      <input type="hidden" id="cId">
      <div class="form-group"><label class="form-label">Cliente</label>
        <select class="form-control" id="cCliente" onchange="cToggleSuelto()"><option value="">— Cliente suelto —</option></select></div>
      <div class="form-row" id="cSueltoWrap">
        <div class="form-group"><label class="form-label">Nombre (cliente suelto)</label><input class="form-control" id="cSueltoNombre"></div>
        <div class="form-group"><label class="form-label">Móvil (+34…)</label><input class="form-control" id="cSueltoMovil" placeholder="+34600000000"></div>
      </div>
      <div class="form-group"><label class="form-label">Servicios *</label><div id="cServicios" style="display:flex;flex-direction:column;gap:.25rem;max-height:160px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:.5rem"></div></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Persona *</label><select class="form-control" id="cPersona" onchange="cRecalc()"></select></div>
        <div class="form-group"><label class="form-label">Recurso</label><select class="form-control" id="cRecurso" onchange="cRecalc()"><option value="">— Ninguno —</option></select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Fecha *</label><input class="form-control" type="date" id="cFecha" onchange="cRecalc()"></div>
        <div class="form-group"><label class="form-label">Hueco *</label><select class="form-control" id="cHueco"><option value="">Elige servicios, persona y fecha…</option></select></div>
      </div>
      <div class="form-group"><label class="form-label">Proyecto (opcional)</label><select class="form-control" id="cProyecto"><option value="">— Ninguno —</option></select></div>
      <div class="form-group"><label class="form-label">Nota</label><textarea class="form-control" id="cNota" rows="2"></textarea></div>
    </div>
    <div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal('mCita')">Cancelar</button><button class="btn btn-primary" onclick="cGuardar()">Guardar cita</button></div>
  </div></div>`;

const modalDetalle = () => `
  <div class="modal-overlay" id="mDet"><div class="modal" style="max-width:560px">
    <div class="modal-head"><h3 id="mDetTitle">Cita</h3><button class="modal-close" onclick="closeModal('mDet')">✕</button></div>
    <div class="modal-body" id="mDetBody"></div>
  </div></div>`;

const modalBloqueo = () => `
  <div class="modal-overlay" id="mBloq"><div class="modal" style="max-width:520px">
    <div class="modal-head"><h3>Bloquear un rato</h3><button class="modal-close" onclick="closeModal('mBloq')">✕</button></div>
    <div class="modal-body">
      <div class="form-row">
        <div class="form-group"><label class="form-label">Persona</label><select class="form-control" id="bPersona"><option value="">— Ninguna —</option></select></div>
        <div class="form-group"><label class="form-label">Recurso</label><select class="form-control" id="bRecurso"><option value="">— Ninguno —</option></select></div>
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

const modalServicio = () => `
  <div class="modal-overlay" id="mSvc"><div class="modal" style="max-width:560px">
    <div class="modal-head"><h3 id="mSvcTitle">Servicio reservable</h3><button class="modal-close" onclick="closeModal('mSvc')">✕</button></div>
    <div class="modal-body">
      <input type="hidden" id="svcId">
      <div class="form-group"><label><input type="checkbox" id="svcReservable" checked> Reservable (aparece al pedir cita)</label></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Duración (min) *</label><input class="form-control" type="number" min="1" id="svcDur" value="30"></div>
        <div class="form-group"><label class="form-label">Margen posterior (min)</label><input class="form-control" type="number" min="0" id="svcMargen" value="0"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Tiempo muerto: empieza al minuto</label><input class="form-control" type="number" min="0" id="svcMuertoIni" value="0"></div>
        <div class="form-group"><label class="form-label">…y dura (min)</label><input class="form-control" type="number" min="0" id="svcMuertoDur" value="0"><div style="font-size:.7rem;color:var(--muted)">Rato en que la persona queda libre (el tinte). 0 = sin tiempo muerto.</div></div>
      </div>
      <div class="form-group"><label class="form-label">Quién puede prestarlo</label><div id="svcProviders" style="display:flex;flex-wrap:wrap;gap:.5rem"></div></div>
      <div class="form-group"><label class="form-label">Recurso necesario</label><div id="svcResources" style="display:flex;flex-wrap:wrap;gap:.5rem"></div></div>
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
        <div class="form-group"><label class="form-label">Duración (min) *</label><input class="form-control" type="number" min="1" id="nsDur" value="30"></div>
        <div class="form-group"><label class="form-label">Margen posterior (min)</label><input class="form-control" type="number" min="0" id="nsMargen" value="0"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Tiempo muerto: empieza al min</label><input class="form-control" type="number" min="0" id="nsMuertoIni" value="0"></div>
        <div class="form-group"><label class="form-label">…y dura (min)</label><input class="form-control" type="number" min="0" id="nsMuertoDur" value="0"><div style="font-size:.7rem;color:var(--muted)">Rato en que la persona queda libre (el tinte). 0 = ninguno.</div></div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal('mNuevoSvc')">Cancelar</button><button class="btn btn-primary" onclick="svcCrear()">Crear servicio</button></div>
  </div></div>`;

const modalRecurso = () => `
  <div class="modal-overlay" id="mRec"><div class="modal" style="max-width:480px">
    <div class="modal-head"><h3 id="mRecTitle">Nuevo recurso</h3><button class="modal-close" onclick="closeModal('mRec')">✕</button></div>
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
function initDate(){ var el=document.getElementById('agFecha'); if(!el.value) el.value=ymd(new Date()); }
async function agCargar(){
  initDate(); await ensureMeta();
  var vista=document.getElementById('agVista').value, eje=document.getElementById('agEje').value;
  var f0=document.getElementById('agFecha').value; var desde=f0, hasta=f0;
  if(vista==='semana'){ var d=new Date(f0+'T00:00:00Z'); var dow=d.getUTCDay(); var mon=new Date(d.getTime()-((dow+6)%7)*86400000); desde=ymd(mon); hasta=ymd(new Date(mon.getTime()+6*86400000)); }
  var data=await api('GET','/api/erp/citas/agenda?desde='+desde+'&hasta='+hasta);
  render(data, desde, hasta, vista, eje);
}
function colDefs(eje){ if(eje==='recurso'){ return [{id:null,nombre:'Sin recurso'}].concat(META.recursos.map(r=>({id:r.id,nombre:r.nombre}))); } return META.personas.map(p=>({id:p.id,nombre:p.name})); }
function render(data, desde, hasta, vista, eje){
  var box=document.getElementById('agenda');
  var dates=[]; var d0=new Date(desde+'T00:00:00Z'); var dN=new Date(hasta+'T00:00:00Z');
  for(var d=new Date(d0); d<=dN; d=new Date(d.getTime()+86400000)) dates.push(ymd(d));
  var START=8*60, END=21*60, STEP=30, PXMIN=0.9;
  var cols = vista==='semana' ? dates.map(dt=>({key:dt,label:DIAS[new Date(dt+'T00:00:00Z').getUTCDay()]+' '+dt.slice(8)})) : colDefs(eje).map(c=>({key:c.id===null?'null':String(c.id),label:c.nombre,colId:c.id}));
  var html='<table style="border-collapse:collapse;min-width:'+(80+cols.length*150)+'px"><thead><tr><th style="width:60px"></th>'+cols.map(c=>'<th style="padding:.4rem;font-size:.85rem;border-bottom:1px solid var(--border)">'+esc(c.label)+'</th>').join('')+'</tr></thead><tbody>';
  for(var t=START;t<END;t+=STEP){
    html+='<tr><td style="font-size:.7rem;color:var(--muted);vertical-align:top;height:'+(STEP*PXMIN)+'px">'+fhhmm(t)+'</td>';
    for(var ci=0;ci<cols.length;ci++){ var col=cols[ci];
      var attrs = vista==='semana' ? 'data-fecha="'+col.key+'"' : ('data-fecha="'+desde+'" data-col="'+(col.colId==null?'':col.colId)+'"');
      html+='<td class="agcell" '+attrs+' data-min="'+t+'" style="border:1px solid var(--border);height:'+(STEP*PXMIN)+'px;vertical-align:top;position:relative" ondragover="event.preventDefault()" ondrop="onDrop(event)"></td>';
    }
    html+='</tr>';
  }
  html+='</tbody></table>';
  box.innerHTML=html;
  (data.citas||[]).forEach(function(ci){
    var colKey = vista==='semana' ? ci.fecha : (eje==='recurso' ? (ci.recurso_id==null?'null':String(ci.recurso_id)) : String(ci.user_id));
    var cell = box.querySelector('.agcell[data-min="'+(Math.floor(ci.inicio_min/STEP)*STEP)+'"]'+(vista==='semana'?'[data-fecha="'+ci.fecha+'"]':'[data-col="'+(eje==='recurso'?(ci.recurso_id==null?'':ci.recurso_id):ci.user_id)+'"]'));
    if(!cell) return;
    var top=(ci.inicio_min-Math.floor(ci.inicio_min/STEP)*STEP)*PXMIN;
    var h=Math.max(18,(ci.dur_min)*PXMIN);
    var color = ci.estado==='confirmada'?'#16a34a':(ci.estado==='atendida'?'#2563eb':(ci.estado==='no_show'?'#b91c1c':'#64748b'));
    var el=document.createElement('div');
    el.className='citaBlock'; el.dataset.id=ci.id;
    if(window.CITAS_EDIT){ el.draggable=true; el.ondragstart=function(ev){ev.dataTransfer.setData('text/plain',ci.id);}; }
    el.style.cssText='position:absolute;left:2px;right:2px;top:'+top+'px;height:'+h+'px;background:'+color+';color:#fff;border-radius:6px;padding:2px 5px;font-size:.72rem;overflow:hidden;cursor:pointer;z-index:2';
    el.innerHTML='<b>'+fhhmm(ci.inicio_min)+'</b> '+esc(ci.cliente)+'<br>'+esc(ci.servicios)+(eje==='persona'&&ci.recurso?'<br>· '+esc(ci.recurso):'');
    el.onclick=function(){verCita(ci.id);};
    cell.appendChild(el);
  });
}
function esc(s){return String(s==null?'':s).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));}
async function onDrop(ev){
  ev.preventDefault(); if(!window.CITAS_EDIT) return;
  var id=ev.dataTransfer.getData('text/plain'); if(!id) return;
  var cell=ev.currentTarget; var fecha=cell.dataset.fecha; var min=parseInt(cell.dataset.min);
  var body={fecha:fecha,inicio_min:min};
  if(cell.dataset.col!==undefined){ var eje=document.getElementById('agEje').value; if(document.getElementById('agVista').value!=='semana'){ if(eje==='recurso') body.recurso_id=cell.dataset.col||null; else body.user_id=cell.dataset.col||null; } }
  try{ await api('POST','/api/erp/citas/'+id+'/mover',body); toast('Cita movida'); agCargar(); }catch(e){ toast(e.message,'err'); }
}
// Nueva cita
function fillSelect(el,rows,val,label,placeholder){ el.innerHTML=(placeholder!=null?'<option value="">'+placeholder+'</option>':'')+rows.map(r=>'<option value="'+r[val]+'">'+esc(r[label])+'</option>').join(''); }
async function openNuevaCita(){
  await ensureMeta();
  document.getElementById('cId').value=''; document.getElementById('mCitaTitle').textContent='Nueva cita';
  fillSelect(document.getElementById('cCliente'),META.clientes,'id','name','— Cliente suelto —');
  fillSelect(document.getElementById('cPersona'),META.personas.map(p=>({id:p.id,name:p.name})),'id','name',null);
  fillSelect(document.getElementById('cRecurso'),META.recursos.map(r=>({id:r.id,name:r.nombre})),'id','name','— Ninguno —');
  fillSelect(document.getElementById('cProyecto'),META.proyectos.map(p=>({id:p.id,name:(p.codigo||'')+' '+p.nombre})),'id','name','— Ninguno —');
  document.getElementById('cServicios').innerHTML=META.servicios.map(s=>'<label style="font-size:.85rem"><input type="checkbox" class="csvc" value="'+s.id+'" onchange="cRecalc()"> '+esc(s.name)+' ('+s.duracion_min+' min)</label>').join('')||'<div style="color:var(--muted);font-size:.85rem;line-height:1.5">Aún no tienes servicios reservables.<br><a href="/admin/citas/servicios" style="color:var(--accent);font-weight:600">＋ Crear o configurar tus servicios →</a></div>';
  document.getElementById('cSueltoNombre').value=''; document.getElementById('cSueltoMovil').value='';
  document.getElementById('cFecha').value=document.getElementById('agFecha').value||ymd(new Date());
  document.getElementById('cNota').value='';
  document.getElementById('cHueco').innerHTML='<option value="">Elige servicios, persona y fecha…</option>';
  cToggleSuelto(); openModal('mCita');
}
function cToggleSuelto(){ document.getElementById('cSueltoWrap').style.display=document.getElementById('cCliente').value?'none':'flex'; }
function cSelServicios(){ return [...document.querySelectorAll('.csvc:checked')].map(x=>parseInt(x.value)); }
async function cRecalc(){
  var ids=cSelServicios(), user=document.getElementById('cPersona').value, fecha=document.getElementById('cFecha').value, rec=document.getElementById('cRecurso').value;
  var sel=document.getElementById('cHueco');
  if(!ids.length||!user||!fecha){ sel.innerHTML='<option value="">Elige servicios, persona y fecha…</option>'; return; }
  try{
    var q='/api/erp/citas/huecos?fecha='+fecha+'&user_id='+user+'&service_ids='+ids.join(',')+(rec?'&recurso_id='+rec:'');
    var d=await api('GET',q);
    sel.innerHTML=(d.huecos.length?d.huecos.map(h=>'<option value="'+h.min+'">'+h.hora+'</option>').join(''):'<option value="">Sin huecos ese día</option>');
  }catch(e){ sel.innerHTML='<option value="">'+esc(e.message)+'</option>'; }
}
async function cGuardar(){
  var body={ cliente_id:document.getElementById('cCliente').value||null, cliente_suelto_nombre:document.getElementById('cSueltoNombre').value, cliente_suelto_movil:document.getElementById('cSueltoMovil').value,
    user_id:document.getElementById('cPersona').value, recurso_id:document.getElementById('cRecurso').value||null, fecha:document.getElementById('cFecha').value,
    inicio_min:parseInt(document.getElementById('cHueco').value), service_ids:cSelServicios(), project_id:document.getElementById('cProyecto').value||null, nota:document.getElementById('cNota').value };
  if(!body.inicio_min && body.inicio_min!==0){ toast('Elige un hueco','err'); return; }
  var id=document.getElementById('cId').value;
  try{ if(id) await api('PUT','/api/erp/citas/'+id,body); else await api('POST','/api/erp/citas',body); closeModal('mCita'); toast('Cita guardada'); agCargar(); }
  catch(e){ toast(e.message,'err'); }
}
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
    +'<div><div class="form-label">Cliente</div>'+e(c.cliente_nombre||c.cliente_suelto_nombre||'—')+'</div>'
    +'<div><div class="form-label">Móvil</div>'+e(c.contacto&&c.contacto.movil_e164||'—')+(c.contacto&&c.contacto.movil_e164&&!c.contacto.movil_valido?' <span style="color:var(--danger)">(sin móvil válido)</span>':'')+'</div>'
    +'<div><div class="form-label">Persona</div>'+e(c.persona||'—')+'</div>'
    +'<div><div class="form-label">Recurso</div>'+e(c.recurso||'—')+'</div>'
    +'<div><div class="form-label">Fecha</div>'+e(c.fecha)+'</div>'
    +'<div><div class="form-label">Hora</div>'+e(c.hora)+' ('+c.dur_min+' min)</div>'
    +(c.proyecto_codigo?'<div><div class="form-label">Proyecto</div>'+e(c.proyecto_codigo)+'</div>':'')
    +(c.invoice_id?'<div><div class="form-label">Cobro</div><a href="/admin/invoices/'+c.invoice_id+'" target="_blank">Ver factura</a></div>':'')
    +'</div>'
    +'<div class="form-label">Servicios</div><div style="margin-bottom:1rem">'+e((c.servicios||[]).map(s=>s.nombre).join(' + '))+'</div>'
    +(c.nota?'<div class="alert" style="margin-bottom:1rem">'+e(c.nota)+'</div>':'')
    +((c.avisos&&c.avisos.length)?'<div class="form-label">Avisos</div><div style="font-size:.8rem;color:var(--muted);margin-bottom:1rem">'+c.avisos.map(a=>e(a.tipo)+' · '+e(a.canal)+' · <strong>'+(a.estado==='email_enviado'?'email enviado':(a.estado==='email_fallo'?'fallo email':'marcado como enviado'))+'</strong> · '+e((a.enviado_at||'').slice(0,16))).join('<br>')+'</div>':'')
    +'<div style="display:flex;gap:.4rem;flex-wrap:wrap">'+acc+'</div>';
  openModal('mDet');
}
var ESTLBL={pedida:'Pedida',confirmada:'Confirmada',atendida:'Atendida',no_show:'No se presentó',anulada:'Anulada'};
async function estado(id,e){ try{ await api('POST','/api/erp/citas/'+id+'/estado',{estado:e}); closeModal('mDet'); toast('Actualizado'); agCargar(); }catch(x){ toast(x.message,'err'); } }
async function anular(id){ if(!confirm('¿Anular esta cita? Si estaba cobrada, se anulará también su factura.')) return; try{ await api('DELETE','/api/erp/citas/'+id); closeModal('mDet'); toast('Cita anulada'); agCargar(); }catch(x){ toast(x.message,'err'); } }
async function atender(id){
  var cobrar=confirm('¿Cobrar ahora? (Aceptar = cobrar con un ticket en efectivo; Cancelar = marcar atendida sin cobrar)');
  var body={cobrar:cobrar, via:'ticket', payment_method:'efectivo', registrar_tiempo:false};
  try{ var r=await api('POST','/api/erp/citas/'+id+'/atender',body); closeModal('mDet'); toast(r.invoice_id?'Atendida y cobrada':'Atendida'); agCargar(); }catch(x){ toast(x.message,'err'); }
}
async function editCita(id){
  await ensureMeta(); var c=await api('GET','/api/erp/citas/'+id);
  openNuevaCita();
  document.getElementById('cId').value=id; document.getElementById('mCitaTitle').textContent='Editar cita';
  document.getElementById('cCliente').value=c.cliente_id||''; cToggleSuelto();
  document.getElementById('cSueltoNombre').value=c.cliente_suelto_nombre||''; document.getElementById('cSueltoMovil').value=c.cliente_suelto_movil||'';
  document.getElementById('cPersona').value=c.user_id; document.getElementById('cRecurso').value=c.recurso_id||'';
  document.getElementById('cProyecto').value=c.project_id||''; document.getElementById('cFecha').value=c.fecha; document.getElementById('cNota').value=c.nota||'';
  (c.service_ids||[]).forEach(function(sid){ var el=document.querySelector('.csvc[value="'+sid+'"]'); if(el) el.checked=true; });
  await cRecalc(); document.getElementById('cHueco').value=c.inicio_min;
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
agCargar();
`;

const JS_COLA = String.raw`
function esc(s){return String(s==null?'':s).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));}
var DATA=null;
async function cargar(){ DATA=await api('GET','/api/erp/citas/cola/data'); render('colaRec',DATA.recordatorios,'recordatorio'); render('colaConf',DATA.confirmaciones,'confirmacion'); }
function render(elId,rows,tipo){
  var box=document.getElementById(elId);
  if(!rows.length){ box.innerHTML='<div style="color:var(--muted);padding:.5rem">No hay nada pendiente.</div>'; return; }
  box.innerHTML='<div class="table-wrap"><table><thead><tr><th>Hora</th><th>Cliente</th><th>Servicio</th><th>Persona</th><th>Estado aviso</th><th></th></tr></thead><tbody>'
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
async function cargar(){ META=await api('GET','/api/erp/citas/meta'); LIST=await api('GET','/api/erp/citas/servicios/list'); render(); }
function render(){
  var b=document.getElementById('svcBody');
  if(!LIST.length){ b.innerHTML='<tr><td colspan="6" style="color:var(--muted)">No hay productos de tipo servicio en el catálogo. Créalos en Catálogo.</td></tr>'; return; }
  b.innerHTML=LIST.map(function(s){
    return '<tr><td>'+esc(s.name)+'</td><td>'+(s.reservable?'Sí':(s.configurado?'No':'—'))+'</td><td>'+(s.duracion_min!=null?s.duracion_min+' min':'<span style="color:var(--muted)">sin configurar</span>')+'</td><td>'+(s.muerto_dur_min?('+'+s.muerto_dur_min+' min libre'):'—')+'</td><td>'+(s.margen_min||0)+' min</td><td>'+(window.CITAS_EDIT?'<button class="btn btn-secondary btn-sm" onclick="edit('+s.id+')">Configurar</button>':'')+'</td></tr>';
  }).join('');
}
function edit(id){
  var s=LIST.find(x=>x.id===id);
  document.getElementById('svcId').value=id; document.getElementById('mSvcTitle').textContent=s.name;
  document.getElementById('svcReservable').checked=s.reservable!==0;
  document.getElementById('svcDur').value=s.duracion_min||30; document.getElementById('svcMargen').value=s.margen_min||0;
  document.getElementById('svcMuertoIni').value=s.muerto_ini_min||0; document.getElementById('svcMuertoDur').value=s.muerto_dur_min||0;
  document.getElementById('svcProviders').innerHTML=META.personas.map(p=>'<label style="font-size:.85rem"><input type="checkbox" class="svcprov" value="'+p.id+'" '+((s.providers||[]).includes(p.id)?'checked':'')+'> '+esc(p.name)+'</label>').join('')||'<span style="color:var(--muted)">Sin personas</span>';
  document.getElementById('svcResources').innerHTML=META.recursos.map(r=>'<label style="font-size:.85rem"><input type="checkbox" class="svcres" value="'+r.id+'" '+((s.resources||[]).includes(r.id)?'checked':'')+'> '+esc(r.nombre)+'</label>').join('')||'<span style="color:var(--muted)">Sin recursos</span>';
  openModal('mSvc');
}
async function svcGuardar(){
  var id=document.getElementById('svcId').value;
  var body={ reservable:document.getElementById('svcReservable').checked, duracion_min:parseInt(document.getElementById('svcDur').value), margen_min:parseInt(document.getElementById('svcMargen').value)||0,
    muerto_ini_min:parseInt(document.getElementById('svcMuertoIni').value)||0, muerto_dur_min:parseInt(document.getElementById('svcMuertoDur').value)||0,
    provider_ids:[...document.querySelectorAll('.svcprov:checked')].map(x=>parseInt(x.value)), resource_ids:[...document.querySelectorAll('.svcres:checked')].map(x=>parseInt(x.value)) };
  try{ await api('PUT','/api/erp/citas/servicios/'+id,body); closeModal('mSvc'); toast('Guardado'); cargar(); }catch(e){ toast(e.message,'err'); }
}
function openNuevoServicio(){
  ['nsNombre'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('nsPrecio').value='0'; document.getElementById('nsIva').value='general';
  document.getElementById('nsDur').value='30'; document.getElementById('nsMargen').value='0';
  document.getElementById('nsMuertoIni').value='0'; document.getElementById('nsMuertoDur').value='0';
  openModal('mNuevoSvc');
}
async function svcCrear(){
  var body={ nombre:document.getElementById('nsNombre').value, precio:document.getElementById('nsPrecio').value||0, tax_band:document.getElementById('nsIva').value,
    duracion_min:parseInt(document.getElementById('nsDur').value), margen_min:parseInt(document.getElementById('nsMargen').value)||0,
    muerto_ini_min:parseInt(document.getElementById('nsMuertoIni').value)||0, muerto_dur_min:parseInt(document.getElementById('nsMuertoDur').value)||0 };
  if(!body.nombre.trim()){ toast('Ponle un nombre','err'); return; }
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
  b.innerHTML=LIST.length?LIST.map(r=>'<tr><td>'+esc(r.nombre)+'</td><td>'+esc(r.tipo)+'</td><td style="color:var(--muted)">'+esc(r.notas||'—')+'</td><td>'+(window.CITAS_EDIT?'<button class="btn btn-secondary btn-sm" onclick="edit('+r.id+')">Editar</button> <button class="btn btn-danger btn-sm" onclick="del('+r.id+')">Archivar</button>':'')+'</td></tr>').join(''):'<tr><td colspan="4" style="color:var(--muted)">Aún no hay recursos.</td></tr>';
}
function openRecurso(){ document.getElementById('recId').value=''; document.getElementById('mRecTitle').textContent='Nuevo recurso'; document.getElementById('recNombre').value=''; document.getElementById('recTipo').value='silla'; document.getElementById('recNotas').value=''; openModal('mRec'); }
function edit(id){ var r=LIST.find(x=>x.id===id); document.getElementById('recId').value=id; document.getElementById('mRecTitle').textContent='Editar recurso'; document.getElementById('recNombre').value=r.nombre; document.getElementById('recTipo').value=r.tipo; document.getElementById('recNotas').value=r.notas||''; openModal('mRec'); }
async function recGuardar(){ var id=document.getElementById('recId').value; var body={nombre:document.getElementById('recNombre').value,tipo:document.getElementById('recTipo').value,notas:document.getElementById('recNotas').value};
  try{ if(id) await api('PUT','/api/erp/citas/recursos/'+id,body); else await api('POST','/api/erp/citas/recursos',body); closeModal('mRec'); toast('Guardado'); cargar(); }catch(e){ toast(e.message,'err'); } }
async function del(id){ if(!confirm('¿Archivar este recurso?'))return; try{ await api('DELETE','/api/erp/citas/recursos/'+id); toast('Archivado'); cargar(); }catch(e){ toast(e.message,'err'); } }
cargar();
`;

const JS_HORARIOS = String.raw`
function esc(s){return String(s==null?'':s).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));}
var DIAS=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
function fhhmm(m){if(m==null)return '';var h=Math.floor(m/60),mm=m%60;return (h<10?'0':'')+h+':'+(mm<10?'0':'')+mm;}
function toMin(t){ if(!t)return null; var p=t.split(':'); return parseInt(p[0])*60+parseInt(p[1]); }
function hToggle(){ document.getElementById('hUser').style.display=document.getElementById('hScope').value==='user'?'':'none'; }
function scopeArgs(){ var s=document.getElementById('hScope').value; var u=document.getElementById('hUser').value; return {scope:s,user_id:s==='user'?u:null}; }
async function hCargar(){
  var a=scopeArgs(); var q='/api/erp/citas/horario?scope='+a.scope+(a.user_id?'&user_id='+a.user_id:'');
  var d=await api('GET',q); renderGrid(d.tramos); renderExc(d.excepciones);
}
var GRID={};
function renderGrid(tramos){
  GRID={}; for(var i=0;i<7;i++) GRID[i]=[];
  (tramos||[]).forEach(t=>GRID[t.dow].push([t.inicio_min,t.fin_min]));
  var order=[1,2,3,4,5,6,0]; var h='';
  order.forEach(function(dow){
    h+='<div style="border-bottom:1px solid var(--border);padding:.5rem 0"><div style="display:flex;justify-content:space-between;align-items:center"><strong>'+DIAS[dow]+'</strong>'+(window.CITAS_EDIT?'<button class="btn btn-secondary btn-sm" onclick="addTramo('+dow+')">+ tramo</button>':'')+'</div><div id="dow'+dow+'" style="margin-top:.3rem"></div></div>';
  });
  document.getElementById('hGrid').innerHTML=h;
  order.forEach(function(dow){ GRID[dow].forEach(function(t,i){ pintaTramo(dow,i,t[0],t[1]); }); });
}
function pintaTramo(dow,i,ini,fin){
  var c=document.getElementById('dow'+dow); var div=document.createElement('div'); div.style.cssText='display:flex;gap:.3rem;align-items:center;margin:.2rem 0';
  div.innerHTML='<input type="time" class="form-control" style="width:auto" value="'+fhhmm(ini)+'" '+(window.CITAS_EDIT?'':'disabled')+' onchange="GRID['+dow+']['+i+'][0]=toMin(this.value)"> – <input type="time" class="form-control" style="width:auto" value="'+fhhmm(fin)+'" '+(window.CITAS_EDIT?'':'disabled')+' onchange="GRID['+dow+']['+i+'][1]=toMin(this.value)">'+(window.CITAS_EDIT?' <button class="btn btn-danger btn-sm" onclick="delTramo('+dow+','+i+')">✕</button>':'');
  c.appendChild(div);
}
function addTramo(dow){ GRID[dow].push([9*60,14*60]); renderGridKeep(); }
function delTramo(dow,i){ GRID[dow].splice(i,1); renderGridKeep(); }
function renderGridKeep(){ var flat=[]; for(var d=0;d<7;d++) GRID[d].forEach(t=>flat.push({dow:d,inicio_min:t[0],fin_min:t[1]})); renderGrid(flat); }
async function hGuardar(){
  var a=scopeArgs(); var tramos=[];
  for(var d=0;d<7;d++) GRID[d].forEach(function(t){ if(t[0]!=null&&t[1]!=null) tramos.push({dow:d,inicio_min:t[0],fin_min:t[1]}); });
  try{ await api('POST','/api/erp/citas/horario',{scope:a.scope,user_id:a.user_id,tramos:tramos}); toast('Horario guardado'); }catch(e){ toast(e.message,'err'); }
}
function eToggle(){ document.getElementById('eHoras').style.display=document.getElementById('eTipo').value==='horario'?'':'none'; }
async function eAdd(){
  var a=scopeArgs();
  var body={scope:a.scope,user_id:a.user_id,fecha:document.getElementById('eFecha').value,tipo:document.getElementById('eTipo').value,motivo:document.getElementById('eMotivo').value};
  if(body.tipo==='horario'){ body.inicio_min=toMin(document.getElementById('eIni').value); body.fin_min=toMin(document.getElementById('eFin').value); }
  try{ await api('POST','/api/erp/citas/excepcion',body); toast('Excepción añadida'); document.getElementById('eMotivo').value=''; hCargar(); }catch(e){ toast(e.message,'err'); }
}
function renderExc(exc){
  var box=document.getElementById('excList');
  if(!exc||!exc.length){ box.innerHTML='<div style="color:var(--muted)">Sin excepciones próximas.</div>'; return; }
  box.innerHTML='<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Horario</th><th>Motivo</th><th></th></tr></thead><tbody>'
    +exc.map(e=>'<tr><td>'+esc(e.fecha)+'</td><td>'+(e.tipo==='cerrado'?'Cerrado':'Horario especial')+'</td><td>'+(e.tipo==='horario'?fhhmm(e.inicio_min)+'–'+fhhmm(e.fin_min):'—')+'</td><td>'+esc(e.motivo||'')+'</td><td>'+(window.CITAS_EDIT?'<button class="btn btn-danger btn-sm" onclick="eDel('+e.id+')">✕</button>':'')+'</td></tr>').join('')+'</tbody></table></div>';
}
async function eDel(id){ try{ await api('DELETE','/api/erp/citas/excepcion/'+id); toast('Eliminada'); hCargar(); }catch(e){ toast(e.message,'err'); } }
hToggle(); hCargar();
`;

const JS_AJUSTES = String.raw`
function toMin(t){ if(!t)return ''; var p=t.split(':'); return parseInt(p[0])*60+parseInt(p[1]); }
async function ajGuardar(){
  var body={ cita_grid_min:parseInt(document.getElementById('ajGrid').value), cita_antelacion_min:parseInt(document.getElementById('ajAntel').value)||0,
    cita_ventana_dias:parseInt(document.getElementById('ajVentana').value)||60, cita_corte_mismo_dia_min:toMin(document.getElementById('ajCorte').value),
    cita_margen_defecto_min:parseInt(document.getElementById('ajMargen').value)||0, cita_canal_defecto:document.getElementById('ajCanal').value, cita_modo_recordatorio:document.getElementById('ajModo').value };
  try{ await api('POST','/api/erp/citas/ajustes',body); toast('Ajustes guardados'); }catch(e){ toast(e.message,'err'); }
}
`;
