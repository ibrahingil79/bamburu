import { Hono } from 'hono';
import { consultaClientes } from '../listados.js';
import { botonesListado, JS_LISTADO_ENVIAR } from './listados.js';
import { safeError } from '../../../core/errors.js';
import { adminLayout, can, rowMenu, emptyRow, skeletonRows } from '../layout.js';
import { logActivity, requirePerm } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { escHtml } from '../../../core/escape.js';
import { clientSchema, clientGroupSchema, accountActionSchema } from '../schemas.js';
import { clientDebt, isCobrable, invoiceProximaAccion, invoiceActionHistory, PROFILE_LABELS,
  resumenCuentaCliente, registerAccountAction, accountEmail } from '../cobros.js';
import { cobroModalHtml, cobroModalScript } from '../views/cobro-modal.js';
import { sendEmail } from '../../../core/mailer.js';
import { nextCode } from '../codes.js';
import { clientVentas } from '../ventas-metrics.js';   // PIEZA C: historial = facturas del cliente, no sales_orders viejos
import { ENTITY } from '../../../core/activity-entities.js';
import { exigirCorreoActivo } from '../avisos-preferencias.js';   // interruptor de Ajustes → Avisos y correos
// FICHA 360 — todo lo nuevo LEE de motores que ya existían; aquí no se calcula ni una cifra.
import { cabecera360, contadoresDe, queCompra, avisosDisaDe, recomendacionesDisa,
  detalleTarjeta, CLAVES_TARJETA, periodoDeUsuario, guardarPeriodoDeUsuario, PERIODOS_FICHA,
  chipsForzados, encenderChip } from '../cliente-360.js';
import { tieneHistorial } from '../historial.js';
import { puedeHistorial } from '../../../core/auth.js';
import { fichaClienteCSS, fichaClienteJS, fichaVentanaJS,
  fichaCompletaJS, fichaCompletaCSS, mapaAssetsHTML } from '../ficha-cliente-ui.js';
// REGISTRO DE CONTACTOS (bloque D). Tabla propia, FUERA de WRITABLE_TABLES: la escribe una persona o
// la deriva un documento real. DISA no apunta conversaciones que no ha visto.
import { contactosDe, apuntarContacto, TIPOS as TIPOS_CONTACTO, DIRECCIONES } from '../contactos.js';
import { clientTimeline, clientCrmSummary } from '../crm.js';
// F — EL MAPA DE LA FICHA. La dirección se resuelve AL GUARDAR (una vez), no al abrir la ficha: lo
// que se ejecuta al mirar un cliente es `mapaDeCliente`, que solo lee de nuestra base.
import { programarGeo, mapaDeCliente, fijarPunto } from '../mapa-cliente.js';
import { detectar } from '../vigia.js';
import { fechaEs } from '../voz.js';   // la fecha, en cristiano (24/08/2026)

// Comprobación reutilizable de NIF duplicado (regla de integridad — sin duplicados).
// Devuelve el cliente ACTIVO en conflicto (otro id con el mismo fiscal_id normalizado)
// o null. fiscal_id vacío nunca bloquea (puede haber varios clientes sin NIF). En
// edición, excludeId excluye al propio cliente. La usan la API (POST/PUT) y DISA.
export function fiscalIdConflict(db, fiscalId, excludeId = null) {
  const norm = String(fiscalId || '').trim().toUpperCase();
  if (!norm) return null;
  const ex = Number(excludeId);
  return db.prepare(
    'SELECT id, name FROM clients WHERE active=1 AND UPPER(TRIM(fiscal_id))=? AND id<>?'
  ).get(norm, Number.isFinite(ex) ? ex : -1) || null;
}

// Sincroniza la suscripción a newsletter al crear/editar un cliente (parte de la
// semántica de "guardar cliente"; a nivel de módulo para que el servicio compartido
// y las rutas usen exactamente la misma lógica).
function syncNewsletter(db, email, name, accepts) {
  // D2 — newsletter DESMONTADO y newsletter_subscribers ARCHIVADA: la ficha de cliente YA NO escribe
  // a esa tabla (no-op). El campo accepts_newsletter del cliente se conserva tal cual. Cuerpo original
  // abajo, inalcanzable (no se borra); si la tienda/boletín vuelve, se reconecta.
  return;
  if (!email) return;
  if (accepts) {
    db.prepare('INSERT OR IGNORE INTO newsletter_subscribers (email,name) VALUES (?,?)').run(email, name || '');
  } else {
    db.prepare('DELETE FROM newsletter_subscribers WHERE email=?').run(email);
  }
}

// ── T5: SERVICIO VALIDADO COMPARTIDO DE CLIENTE — ÚNICA fuente de verdad de escritura ──
// La usan TANTO las rutas del formulario (POST/PUT/DELETE/restore) COMO DISA. Misma
// validación (clientSchema) y misma guarda de NIF único (fiscalIdConflict, T1). DISA NO
// escribe nunca directo en la base: pasa por aquí. Errores con .status (400/404/409).
function parseClient(input) {
  const res = clientSchema.safeParse(input);
  if (!res.success) {
    const msg = res.error.issues.map(i => (i.path?.length ? i.path.join('.') + ': ' : '') + i.message).join('; ');
    const e = new Error(msg || 'Datos de cliente inválidos'); e.status = 400; throw e;
  }
  return res.data;
}

// F — QUÉ SE HACE CON EL PUNTO AL GUARDAR. Una sola función para el alta y para la edición: si
// fueran dos, el día que una cambie la otra se queda vieja en silencio.
//   · Si el usuario ELIGIÓ una sugerencia, el sitio ya está decidido: se guarda ESE punto y no se le
//     pregunta a nadie. Es lo que hace que el mapa enseñe exactamente lo que se eligió.
//   · Si escribió la dirección a mano, se resuelve al guardar como siempre (en segundo plano).
// `fijarPunto` valida el rango y comprueba que el cliente tenga calle: unas coordenadas que lleguen
// sueltas, sin dirección detrás, no pintan nada.
function guardarPunto(db, id, d) {
  const lat = Number(d.geo_lat), lon = Number(d.geo_lon);
  if (d.address && Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) {
    if (fijarPunto(db, id, lat, lon, d.geo_etiqueta)) return;
  }
  programarGeo(db, id);
}

export function createClientSvc(db, input) {
  const d = parseClient(input);
  if (fiscalIdConflict(db, d.fiscal_id)) { const e = new Error('Ya existe un cliente con ese NIF'); e.status = 409; throw e; }
  const code = nextCode(db, 'client');   // código interno CLI-NNNN, tras la guarda de NIF (no editable)
  const r = db.prepare('INSERT INTO clients (name,fiscal_id,email,phone,address,city,country,postal_code,province,group_id,notes,accepts_newsletter,client_type,payment_term_days,payment_method,collections_profile,client_code,responsable_user_id,descuento_pct,fecha_nacimiento) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(d.name, d.fiscal_id || '', d.email || '', d.phone || '', d.address || '', d.city || '', d.country || '', d.postal_code || '', d.province || '', d.group_id || null, d.notes || '', d.accepts_newsletter ? 1 : 0, d.client_type || 'particular', d.payment_term_days || 0, d.payment_method || '', d.collections_profile || 'estandar', code, d.responsable_user_id || null, Number(d.descuento_pct) || 0, d.fecha_nacimiento || '');
  syncNewsletter(db, d.email, d.name, d.accepts_newsletter);
  // F — el mapa se decide AQUÍ, en el servicio compartido, y no en la ruta: así sale igual si el
  // cliente lo da de alta una persona o lo dicta DISA. Nunca puede tumbar el alta (ver mapa-cliente.js).
  guardarPunto(db, r.lastInsertRowid, d);
  return { id: r.lastInsertRowid, name: d.name, client_code: code };
}

export function updateClientSvc(db, id, input) {
  const exists = db.prepare('SELECT id FROM clients WHERE id=?').get(id);
  if (!exists) { const e = new Error('Cliente no encontrado'); e.status = 404; throw e; }
  const d = parseClient(input);
  if (fiscalIdConflict(db, d.fiscal_id, id)) { const e = new Error('Ya existe un cliente con ese NIF'); e.status = 409; throw e; }
  db.prepare('UPDATE clients SET name=?,fiscal_id=?,email=?,phone=?,address=?,city=?,country=?,postal_code=?,province=?,group_id=?,notes=?,accepts_newsletter=?,client_type=?,payment_term_days=?,payment_method=?,collections_profile=?,responsable_user_id=?,descuento_pct=?,fecha_nacimiento=? WHERE id=?')
    .run(d.name, d.fiscal_id || '', d.email || '', d.phone || '', d.address || '', d.city || '', d.country || '', d.postal_code || '', d.province || '', d.group_id || null, d.notes || '', d.accepts_newsletter ? 1 : 0, d.client_type || 'particular', d.payment_term_days || 0, d.payment_method || '', d.collections_profile || 'estandar', d.responsable_user_id || null, Number(d.descuento_pct) || 0, d.fecha_nacimiento || '', id);
  syncNewsletter(db, d.email, d.name, d.accepts_newsletter);
  guardarPunto(db, id, d);   // F — misma regla que en el alta, y por la misma puerta
  return { id: Number(id), name: d.name };
}

export function archiveClientSvc(db, id) {
  const cl = db.prepare('SELECT id, name FROM clients WHERE id=?').get(id);
  if (!cl) { const e = new Error('Cliente no encontrado'); e.status = 404; throw e; }
  // Archivar, no borrar (regla permanente). Archivar libera el NIF (no choca con nadie).
  db.prepare('UPDATE clients SET active=0 WHERE id=?').run(id);
  return { id: Number(id), name: cl.name };
}

export function restoreClientSvc(db, id) {
  const cl = db.prepare('SELECT id, name, fiscal_id FROM clients WHERE id=?').get(id);
  if (!cl) { const e = new Error('Cliente no encontrado'); e.status = 404; throw e; }
  // Restaurar puede chocar con un activo que tenga el mismo NIF (archivar lo liberó).
  if (fiscalIdConflict(db, cl.fiscal_id, id)) { const e = new Error('Ya existe un cliente activo con este NIF'); e.status = 409; throw e; }
  db.prepare('UPDATE clients SET active=1 WHERE id=?').run(id);
  return { id: Number(id), name: cl.name };
}

// ── T5: lectura/búsqueda compartida de clientes (la usan el endpoint JSON y DISA) ──
// Solo clientes activos. Coincidencia parcial sobre nombre o NIF, filtro opcional por
// ciudad. Es la ÚNICA vía de lectura para identificar y para responder consultas.
export function searchClients(db, { q = '', city = '', limit = 20 } = {}) {
  const where = ['active=1'];
  const params = [];
  if (q)    { where.push('(name LIKE ? OR fiscal_id LIKE ?)'); params.push('%' + q + '%', '%' + q + '%'); }
  if (city) { where.push('city LIKE ?'); params.push('%' + city + '%'); }
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
  return db.prepare(
    'SELECT id, name, fiscal_id, email, city, active FROM clients WHERE ' + where.join(' AND ') + ' ORDER BY name LIMIT ?'
  ).all(...params, lim);
}

export function createClientRoutes(db, cfg = {}) {
  const sym = cfg.sym || '€';
  const api = new Hono();
  const views = new Hono();

  // ── API: CLIENTS ───────────────────────────────────────────────
  api.get('/', requirePerm('clients.read'), c => {
    try {
      return c.json(db.prepare('SELECT c.*, g.name as group_name FROM clients c LEFT JOIN client_groups g ON c.group_id=g.id WHERE c.active=1 ORDER BY c.total_spent DESC').all());
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  // T5 — búsqueda de clientes (JSON). ANTES de '/:id' para que no la capture como id.
  api.get('/search', requirePerm('clients.read'), c => {
    try {
      return c.json(searchClients(db, { q: c.req.query('q') || '', city: c.req.query('city') || '', limit: c.req.query('limit') }));
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  // ══ FICHA 360 ═══════════════════════════════════════════════════════════════════════════════
  // Rutas de 3 segmentos: van ANTES de '/:id' para que no las capture como si fueran un id.
  //
  // PERMISOS: `clients.read` abre la ficha, y nada más. Cada bloque se calcula solo si su permiso
  // está, EN EL SERVIDOR: lo que este usuario no puede ver no viaja al navegador. No se pinta en
  // gris ni se esconde con CSS — no llega. Y pedir el endpoint a mano tampoco lo saca.
  const puedeDe = c => (p) => can(c, p);
  const clienteOr404 = c => db.prepare('SELECT * FROM clients WHERE id=?').get(c.req.param('id'));

  // La cabecera de cifras: cada una de su motor, y `null` donde no hay dato (la pantalla pinta «—»).
  api.get('/:id/360', requirePerm('clients.read'), c => {
    try {
      const cli = clienteOr404(c);
      if (!cli) return c.json({ error: 'No encontrado' }, 404);
      const puede = puedeDe(c);
      // C4 — el periodo de la tarjeta configurable es del USUARIO, no del negocio: dos personas
      // pueden mirar el mismo cliente con ventanas de tiempo distintas sin pisarse.
      const periodo = periodoDeUsuario(db, c.get('session')?.userId || null);
      const cab = cabecera360(db, cli, puede, { periodo });
      let delVigia = null;
      if (puede('analytics.read')) {
        // `soloCliente` corre solo los detectores que pueden señalar a un cliente. El resultado para
        // ESTE cliente es idéntico —los demás nunca ponen `ref.client_id`— y ahorra el análisis del
        // negocio entero, que es lo más caro de esta pantalla con diferencia.
        try { delVigia = detectar(db, { hoy: new Date().toISOString().slice(0, 10), soloCliente: true }); }
        catch { delVigia = null; }
      }
      return c.json({
        cliente: { id: cli.id, name: cli.name, client_code: cli.client_code, created_at: cli.created_at, notes: cli.notes || '' },
        // B1.1 — la cabecera compacta de la ventana: quién es, en una línea.
        fijos: { fiscal_id: cli.fiscal_id || '', phone: cli.phone || '', email: cli.email || '',
                 city: cli.city || '', client_type: cli.client_type || '' },
        // F — DÓNDE ESTÁ. `null` cuando no hay dirección, cuando no se pudo resolver o cuando el
        // punto guardado es de una dirección anterior: la pantalla entonces NO pinta el bloque.
        // Esto NO sale a la red — lee el punto que se guardó el día que se guardó el cliente.
        mapa: mapaDeCliente(db, cli),
        cabecera: cab,
        contadores: contadoresDe(db, cli.id, puede, cab.deuda),
        compra: queCompra(db, cli.id, puede),
        // Los avisos en crudo siguen viajando (los usa quien ya los pintaba); `recomienda` es lo que
        // se ENSEÑA: una línea por familia con la decisión, no una por documento (C1/C4).
        // EL VIGÍA SE CORRE UNA SOLA VEZ y se reparte: es lo más caro de esta pantalla (~300 ms) y
        // se estaba ejecutando dos veces seguidas para sacar exactamente el mismo resultado.
        disa: avisosDisaDe(db, cli.id, puede, detectar, delVigia),
        recomienda: recomendacionesDisa(db, cli.id, puede, detectar, delVigia),
        crm: can(c, 'crm.read') ? clientCrmSummary(db, cli.id, new Date().toISOString().slice(0, 10)) : null,
        periodo, periodos: PERIODOS_FICHA, chips_extra: chipsForzados(db),
      });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // ── EL DETALLE DE UNA TARJETA (D2) ───────────────────────────────────────────────────────────
  // Por qué esa cifra vale eso. Una clave desconocida es 404, no una lista vacía; y una clave de
  // dinero sin `invoices.read` es 403 — `clients.read` NO es la llave maestra que abre las facturas
  // por una puerta lateral. Es la misma regla que ya rige la cabecera y el timeline.
  api.get('/:id/360/tarjeta/:clave', requirePerm('clients.read'), c => {
    try {
      const cli = clienteOr404(c);
      if (!cli) return c.json({ error: 'No encontrado' }, 404);
      const clave = String(c.req.param('clave') || '');
      if (!CLAVES_TARJETA.includes(clave)) return c.json({ error: 'Esa tarjeta no existe' }, 404);
      const d = detalleTarjeta(db, cli, clave, puedeDe(c),
        { periodo: periodoDeUsuario(db, c.get('session')?.userId || null) });
      if (!d) return c.json({ error: 'Sin permiso' }, 403);
      return c.json(d);
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // La línea de tiempo, PAGINADA y con filtro por tipo. Un solo endpoint: se pide una vez y se
  // devuelve una página, no una consulta por fila.
  api.get('/:id/360/timeline', requirePerm('clients.read'), c => {
    try {
      const cli = clienteOr404(c);
      if (!cli) return c.json({ error: 'No encontrado' }, 404);
      // El mismo contrato de troceo que ya usaba el timeline del CRM: cada fuente, su permiso.
      // `clients.read` NO puede ser la llave maestra que revele facturas, cobros o citas.
      const include = {
        oportunidades: can(c, 'crm.read'), actividad: can(c, 'crm.read'),
        quotes: can(c, 'quotes.read'), orders: can(c, 'pedidos.read'), albaranes: can(c, 'albaranes.read'),
        invoices: can(c, 'invoices.read'), cobros: can(c, 'cobros.read'),
        citas: can(c, 'citas.read'), proyectos: can(c, 'proyectos.read'), tiempo: can(c, 'tiempo.read'),
        notas: true,                                    // las notas son del cliente: van con clients.read
        tareas: can(c, 'crm.read'),                     // punto 13 · mismo permiso que su pantalla
      };
      const todos = clientTimeline(db, cli.id, new Date().toISOString().slice(0, 10), { include });
      const tipo = String(c.req.query('tipo') || '').trim();
      const filtrados = tipo ? todos.filter(e => e.kind === tipo) : todos;
      const desde = Math.max(0, parseInt(c.req.query('desde') || '0', 10) || 0);
      const cuantos = Math.min(100, Math.max(5, parseInt(c.req.query('cuantos') || '25', 10) || 25));
      return c.json({
        total: filtrados.length,
        tipos: [...new Set(todos.map(e => e.kind))].sort(),
        eventos: filtrados.slice(desde, desde + cuantos),
        hay_mas: desde + cuantos < filtrados.length,
      });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // ── C4 · EL PERIODO DE LA TARJETA CONFIGURABLE ───────────────────────────────────────────────
  // Se guarda POR USUARIO en `dashboard_layouts`, la tabla que ya guarda preferencias personales.
  // No nace una tabla nueva para recordar un desplegable.
  api.put('/periodo-ficha', requirePerm('clients.read'), async c => {
    try {
      const d = await c.req.json();
      const uid = c.get('session')?.userId || null;
      if (!uid) return c.json({ error: 'Sin sesión' }, 401);
      return c.json(guardarPeriodoDeUsuario(db, uid, { clave: d.clave, desde: d.desde, hasta: d.hasta }));
    } catch (e) { return c.json({ error: safeError(e) }, e?.status || 500); }
  });

  // ── F2 · ENCENDER UN CHIP QUE EL OFICIO NO TRAE ──────────────────────────────────────────────
  // NADA SE ELIMINA (R6): lo que el oficio no usa se OCULTA, y desde «Más opciones» se enciende de
  // un clic. Es una decisión sobre cómo trabaja el negocio, así que se guarda por negocio.
  api.put('/chips-ficha', requirePerm('clients.edit'), async c => {
    try {
      const d = await c.req.json();
      if (!['citas', 'proyectos'].includes(d.key)) return c.json({ error: 'Ese no se puede encender' }, 400);
      return c.json({ ok: true, extra: encenderChip(db, d.key, d.encender !== false) });
    } catch (e) { return c.json({ error: safeError(e) }, e?.status || 500); }
  });

  // ── EL REGISTRO DE CONTACTOS (D5) ────────────────────────────────────────────────────────────
  // Leer va con `clients.read`; apuntar, con `clients.edit` (D6). El catálogo de tipos viaja con la
  // lista para que la pantalla no lo tenga escrito a mano — incluida la coletilla honesta de
  // WhatsApp, que NO está conectado a Bamburu y así se dice.
  api.get('/:id{[0-9]+}/contactos', requirePerm('clients.read'), c => {
    try {
      const cli = clienteOr404(c);
      if (!cli) return c.json({ error: 'No encontrado' }, 404);
      const soloVisitas = c.req.query('visitas') === '1';
      const r = contactosDe(db, cli.id, {
        tipo: String(c.req.query('tipo') || ''),
        soloVisitas,
        desde: Math.max(0, parseInt(c.req.query('desde') || '0', 10) || 0),
        cuantos: Math.min(200, Math.max(5, parseInt(c.req.query('cuantos') || '50', 10) || 50)),
      });
      return c.json({ ...r, catalogo: TIPOS_CONTACTO, direcciones: DIRECCIONES,
                      puede_apuntar: can(c, 'clients.edit') });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  api.post('/:id{[0-9]+}/contactos', requirePerm('clients.edit'), async c => {
    try {
      const cli = clienteOr404(c);
      if (!cli) return c.json({ error: 'No encontrado' }, 404);
      const d = await c.req.json();
      const s = c.get('session') || {};
      // `automatico` NO se acepta de fuera: lo automático solo lo marca Bamburu al mandarlo él. Si
      // una pantalla pudiera declararlo, un contacto apuntado a mano podría esconderse del dueño.
      const r = apuntarContacto(db, {
        client_id: cli.id, tipo: d.tipo, fecha: d.fecha || null,
        direccion: d.direccion || 'saliente', resultado: d.resultado || '',
        user_id: s.userId || null, user_name: s.userName || '',
        automatico: false, origen: 'manual',
      });
      return c.json({ ok: true, ...r });
    } catch (e) { return c.json({ error: safeError(e) }, e?.status || 500); }
  });

  // ── NOTAS A MANO — lo único que esta tarea escribe ──────────────────────────────────────────
  // Permiso: el mismo que editar el cliente. Cada uno edita las SUYAS (el dueño y el administrador,
  // cualquiera: son ellos quienes responden del negocio). Se archiva, no se borra.
  api.get('/:id/notas', requirePerm('clients.read'), c => {
    try {
      return c.json(db.prepare(
        'SELECT id, texto, user_id, user_name, created_at, updated_at FROM client_notes WHERE client_id=? AND active=1 ORDER BY created_at DESC'
      ).all(c.req.param('id')));
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });
  api.post('/:id/notas', requirePerm('clients.edit'), async c => {
    try {
      const cli = clienteOr404(c);
      if (!cli) return c.json({ error: 'No encontrado' }, 404);
      const texto = String((await c.req.json().catch(() => ({}))).texto || '').trim();
      if (!texto) return c.json({ error: 'Escribe algo en la nota' }, 400);
      if (texto.length > 4000) return c.json({ error: 'La nota es demasiado larga (máximo 4000 caracteres)' }, 400);
      const s = c.get('session') || {};
      const r = db.prepare('INSERT INTO client_notes (client_id, texto, user_id, user_name) VALUES (?,?,?,?)')
        .run(cli.id, texto, s.userId || null, s.userName || '');
      return c.json({ ok: true, id: r.lastInsertRowid }, 201);
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });
  api.put('/:id/notas/:nid', requirePerm('clients.edit'), async c => {
    try {
      const n = db.prepare('SELECT * FROM client_notes WHERE id=? AND client_id=? AND active=1').get(c.req.param('nid'), c.req.param('id'));
      if (!n) return c.json({ error: 'No encontrada' }, 404);
      const s = c.get('session') || {};
      // Cada uno edita las suyas. Owner y admin pueden con todas: responden del negocio entero.
      if (n.user_id && s.userId && n.user_id !== s.userId && !c.get('isAdmin')) {
        return c.json({ error: 'Esa nota la escribió otra persona' }, 403);
      }
      const texto = String((await c.req.json().catch(() => ({}))).texto || '').trim();
      if (!texto) return c.json({ error: 'Escribe algo en la nota' }, 400);
      db.prepare("UPDATE client_notes SET texto=?, updated_at=datetime('now') WHERE id=?").run(texto, n.id);
      return c.json({ ok: true });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });
  api.delete('/:id/notas/:nid', requirePerm('clients.edit'), c => {
    try {
      const n = db.prepare('SELECT * FROM client_notes WHERE id=? AND client_id=? AND active=1').get(c.req.param('nid'), c.req.param('id'));
      if (!n) return c.json({ error: 'No encontrada' }, 404);
      const s = c.get('session') || {};
      if (n.user_id && s.userId && n.user_id !== s.userId && !c.get('isAdmin')) {
        return c.json({ error: 'Esa nota la escribió otra persona' }, 403);
      }
      // Archivar, no destruir (regla permanente del proyecto).
      db.prepare("UPDATE client_notes SET active=0, updated_at=datetime('now') WHERE id=?").run(n.id);
      return c.json({ ok: true });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  api.get('/:id', requirePerm('clients.read'), c => {
    try {
      const client = db.prepare('SELECT c.*, g.name as group_name FROM clients c LEFT JOIN client_groups g ON c.group_id=g.id WHERE c.id=?').get(c.req.param('id'));
      if (!client) return c.json({error:'No encontrado'},404);
      // PIEZA C — el historial del cliente son sus FACTURAS (cadena nueva), no los sales_orders viejos.
      // Shape {order_number,total,status,created_at} para que la ficha siga pintando igual.
      client.orders = clientVentas(db, client.id);
      return c.json(client);
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  // Las 4 escrituras pasan por el SERVICIO compartido (misma validación + guarda de NIF
  // que usa DISA). La ruta solo añade permisos, log con la sesión real y el código HTTP.
  api.post('/', requirePerm('clients.create'), validate(clientSchema), async c => {
    try {
      const r = createClientSvc(db, c.get('validated'));
      logActivity(db, c.get('session'), 'Creó cliente', ENTITY.CLIENT, r.id, r.name);
      return c.json({id:r.id, message:'Creado'});
    } catch(e) { return c.json({error:safeError(e)}, e.status||500); }
  });

  api.put('/:id', requirePerm('clients.edit'), validate(clientSchema), async c => {
    try {
      const r = updateClientSvc(db, c.req.param('id'), c.get('validated'));
      logActivity(db, c.get('session'), 'Editó cliente', ENTITY.CLIENT, r.id, r.name);
      return c.json({message:'Actualizado'});
    } catch(e) { return c.json({error:safeError(e)}, e.status||500); }
  });

  api.delete('/:id', requirePerm('clients.edit'), c => {
    try {
      const r = archiveClientSvc(db, c.req.param('id'));
      logActivity(db, c.get('session'), 'Archivó cliente', ENTITY.CLIENT, r.id, r.name||'');
      return c.json({message:'Archivado'});
    } catch(e) { return c.json({error:safeError(e)}, e.status||500); }
  });

  api.get('/:id/orders', requirePerm('clients.read'), c => {
    try {
      return c.json(clientVentas(db, c.req.param('id')));   // PIEZA C — facturas del cliente (cadena nueva)
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  // T4 Paso 1 — facturas del cliente con su estado de cobro en vivo + total que debe
  // y deuda más antigua. La regla de qué cuenta como deuda (anuladas/rectificativas)
  // vive en cobros.js (clientDebt). Es el dato nuclear de la ficha del cliente.
  api.get('/:id/invoices', requirePerm('clients.read'), c => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const debt = clientDebt(db, c.req.param('id'), today);
      // Marca cada factura con el MISMO flag que usa el guard del backend (isCobrable),
      // para que el botón "Registrar cobro" de la ficha no pueda divergir de la regla.
      // Paso 2: misma próxima acción + historial de acciones que las otras superficies.
      debt.invoices = debt.invoices.map(inv => ({
        ...inv,
        cobrable: isCobrable(db, inv),
        proxima: invoiceProximaAccion(db, inv, today),
        actionHistory: invoiceActionHistory(db, inv.id),
      }));
      const cl = db.prepare('SELECT collections_profile FROM clients WHERE id=?').get(c.req.param('id'));
      debt.collections_profile = (cl && cl.collections_profile) || 'estandar';
      return c.json(debt);
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  // ── T4 Paso 2.1 — gestión a nivel de CUENTA del cliente ─────────────────────
  // GET resumen de cuenta: deuda total + facturas vivas (priorizadas) + etapa y próxima
  // acción de cuenta (heredadas de la factura más grave). Lo lee el modal "Gestionar cuenta".
  api.get('/:id/account-summary', requirePerm('clients.read'), c => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      return c.json(resumenCuentaCliente(db, parseInt(c.req.param('id')), today));
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  // GET plantilla de email de CUENTA precargada (editable antes de enviar).
  api.get('/:id/account-email-preview', requirePerm('clients.read'), c => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const id = parseInt(c.req.param('id'));
      const resumen = resumenCuentaCliente(db, id, today);
      const client = db.prepare('SELECT * FROM clients WHERE id=?').get(id);
      const company = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
      const tono = (resumen.proximaAccionCuenta && resumen.proximaAccionCuenta.tono) || 'amable';
      const tpl = accountEmail(tono, { client, company, facturasVivas: resumen.facturasVivas, total: resumen.deudaTotal, db });
      return c.json({ subject: tpl.subject, text: tpl.text, tono, to: (client && client.email) || '', has_email: !!(client && client.email), total: resumen.deudaTotal, facturas: resumen.facturasVivas.length });
    } catch(e) { return c.json({error:safeError(e)},400); }
  });

  // POST acción de CUENTA — recordatorio (UN email + acción por factura), promesa (todas)
  // o cobro a cuenta (reparto auto/manual → un invoice_payment por factura). Va por el mismo
  // servicio validado que usa DISA. Rechaza facturas no vivas (doble seguro de Paso 1).
  api.post('/:id/account-actions', requirePerm('cobros.manage'), validate(accountActionSchema), async c => {
    try {
      const input = c.get('validated');
      // Interruptor de Ajustes → Avisos y correos (ver el gemelo en invoices.js).
      if (input.type === 'recordatorio_cuenta') exigirCorreoActivo(db, 'cobro_cuenta');
      const res = await registerAccountAction(db, parseInt(c.req.param('id')), input, { sendEmail });
      const label = input.type === 'recordatorio_cuenta' ? 'Envió recordatorio de cuenta'
        : input.type === 'promesa_cuenta' ? 'Registró promesa de cuenta' : 'Registró cobro a cuenta';
      logActivity(db, c.get('session'), label, ENTITY.CLIENT, c.req.param('id'), `${res.facturas || (res.pagos && res.pagos.length) || 0} factura(s) · lote ${res.batch_id}`);
      return c.json(res, 201);
    } catch(e) { return c.json({error:safeError(e)}, e.status || 400); }
  });

  // Restaurar un cliente archivado (inverso de archivar, T1). Guarda: archivar libera
  // el NIF, así que restaurar puede chocar con otro cliente activo que lo tenga — se
  // bloquea reutilizando el helper de NIF único (CANON §5, sin duplicados).
  api.post('/:id/restore', requirePerm('clients.edit'), c => {
    try {
      const r = restoreClientSvc(db, c.req.param('id'));
      logActivity(db, c.get('session'), 'Restauró cliente', ENTITY.CLIENT, r.id, r.name||'');
      return c.json({message:'Restaurado'});
    } catch(e) { return c.json({error:safeError(e)}, e.status||500); }
  });

  // ── API: CLIENT GROUPS ─────────────────────────────────────────
  api.get('/groups/all', requirePerm('clients.read'), c => {
    try { return c.json(db.prepare('SELECT g.*, COUNT(c.id) as member_count FROM client_groups g LEFT JOIN clients c ON c.group_id=g.id GROUP BY g.id ORDER BY g.name').all()); }
    catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.post('/groups/create', requirePerm('clients.create'), validate(clientGroupSchema), async c => {
    try {
      const d = c.get('validated');
      const r = db.prepare('INSERT INTO client_groups (name,description,discount_pct) VALUES (?,?,?)').run(d.name, d.description||'', d.discount_pct||0);
      return c.json({id:r.lastInsertRowid});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.put('/groups/:id', requirePerm('clients.edit'), validate(clientGroupSchema), async c => {
    try {
      const d = c.get('validated');
      db.prepare('UPDATE client_groups SET name=?,description=?,discount_pct=? WHERE id=?').run(d.name, d.description||'', d.discount_pct||0, c.req.param('id'));
      return c.json({message:'Actualizado'});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.delete('/groups/:id', requirePerm('clients.edit'), c => {
    try { db.prepare('DELETE FROM client_groups WHERE id=?').run(c.req.param('id')); return c.json({message:'Eliminado'}); }
    catch(e) { return c.json({error:safeError(e)},500); }
  });

  // ── VIEWS ──────────────────────────────────────────────────────
  views.get('/', requirePerm('clients.read'), c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';

    // T2: búsqueda (nombre/NIF), filtro por estado (activos/archivados) y paginación, todo por URL (GET).
    const q = (c.req.query('q') || '').trim();
    const verArchivados = c.req.query('archivados') === '1';
    const activeVal = verArchivados ? 0 : 1;
    const perPage = 25;
    let page = parseInt(c.req.query('page') || '1', 10);
    if (!Number.isFinite(page) || page < 1) page = 1;

    // ── LA MISMA CONSULTA QUE EL PDF (tarea C, tanda 1) ────────────────────────────────────────
    // El WHERE, el COUNT y el SELECT vivían aquí dentro. Ahora viven en `listados.js` y esta
    // pantalla los PIDE, igual que los piden las rutas de imprimir / descargar / enviar. La única
    // diferencia entre lo que se ve y lo que se imprime es `limit`: la pantalla pide una página, el
    // papel pide todo. Si cada uno tuviera su consulta, el día que alguien tocara un filtro
    // empezarían a decir cosas distintas y nadie sabría cuál miente.
    const totalPrev = consultaClientes(db, { q, archivados: verArchivados, limit: 1 }).total;
    const totalPages = Math.max(1, Math.ceil(totalPrev / perPage));
    if (page > totalPages) page = totalPages;
    const offset = (page - 1) * perPage;
    const { filas: clientsList, total } = consultaClientes(db, { q, archivados: verArchivados, limit: perPage, offset });

    // Opciones de grupo para el modal (server-render, sin fetch en cliente).
    const groupOptions = db.prepare('SELECT id, name FROM client_groups ORDER BY name').all()
      .map(g => '<option value="' + g.id + '">' + escHtml(g.name) + '</option>').join('');
    // CRM — usuarios ACTIVOS del negocio para el desplegable de responsable. Solo los activos: no
    // tiene sentido asignarle una cartera a alguien que ya no entra. Un cliente ya asignado a un
    // usuario que luego se desactiva conserva su id (nada se pierde) y la analítica lo resolverá
    // como "sin asignar" hasta que el dueño lo reasigne. Escapado: el nombre lo teclea una persona.
    const userOptions = db.prepare("SELECT id, name FROM admin_users WHERE active=1 ORDER BY name").all()
      .map(u => '<option value="' + u.id + '">' + escHtml(u.name) + '</option>').join('');

    // Los filtros VIGENTES, para que los tres verbos impriman lo que se está viendo.
    const qsListado = (() => {
      const u = new URLSearchParams();
      if (q) u.set('q', q);
      if (verArchivados) u.set('archivados', '1');
      return u.toString();
    })();

    // Conserva q y archivados al cambiar de página.
    const buildQs = (p) => {
      const u = new URLSearchParams();
      if (q) u.set('q', q);
      if (verArchivados) u.set('archivados', '1');
      u.set('page', String(p));
      return u.toString();
    };

    const rowsHtml = clientsList.map(cl => '<tr>'+
      '<td style="color:var(--muted);font-family:monospace;font-size:.8rem">'+escHtml(cl.client_code||'-')+'</td>'+
      '<td><strong>'+escHtml(cl.name)+'</strong>'+(cl.fiscal_id?'<br><span style="color:var(--muted);font-size:.75rem">'+escHtml(cl.fiscal_id)+'</span>':'')+'</td>'+
      '<td style="color:var(--muted)">'+escHtml(cl.email||'-')+'</td>'+
      '<td style="color:var(--muted)">'+escHtml(cl.phone||'-')+'</td>'+
      '<td>'+(cl.group_name?'<span class="badge b-purple">'+escHtml(cl.group_name)+'</span>':'-')+'</td>'+
      // ESTO SE EJECUTA EN EL SERVIDOR, así que `window` no existe: `fechaEs` va importado, no por
      // el objeto global. Metí `window.fechaEs` aquí y dejé /admin/clients dando 500 («window is
      // not defined»). La regla: dentro de una plantilla es código del navegador y vale `window`;
      // fuera de ella es código del servidor y hay que importar.
      '<td style="color:var(--muted);font-size:.8rem">'+(fechaEs((cl.created_at||'').split(' ')[0])||'-')+'</td>'+
      '<td style="white-space:nowrap">'+
        // Patrón §6: UNA acción clara ("Ver") + el resto en un menú "···".
        '<button class="btn btn-secondary btn-sm" data-cl="ver" data-id="'+cl.id+'">Ver</button> '+
        (verArchivados
          ? (can(c,'clients.edit')?'<button class="btn btn-secondary btn-sm" data-cl="restaurar" data-id="'+cl.id+'">Restaurar</button>':'')
          : ((can(c,'clients.edit')||can(c,'clients.delete'))
              ? rowMenu([
                  can(c,'clients.edit') ? {label:'Editar', act:'cli-editar', arg:cl.id} : null,
                  can(c,'clients.delete') ? {label:'Archivar', danger:true, act:'cli-archivar', arg:cl.id} : null,
                ].filter(Boolean))
              : ''))+
      '</td>'+
      '</tr>').join('');

    const content = `
      <div class="ph">
        <h2>Clientes</h2>
        <form method="get" style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
          <input class="search" type="text" name="q" value="${escHtml(q)}" placeholder="Buscar por nombre o NIF...">
          <select class="form-control" name="archivados" style="width:auto;min-width:150px" data-cl="filtro">
            <option value=""${verArchivados ? '' : ' selected'}>Activos</option>
            <option value="1"${verArchivados ? ' selected' : ''}>Archivados</option>
          </select>
          <button class="btn btn-secondary" type="submit">Buscar</button>
          ${can(c, 'clients.create') ? '<button type="button" class="btn btn-primary" data-cl="nuevo">Nuevo cliente</button>' : ''}
        </form>
      </div>
      <!-- C9 · LOS TRES VERBOS. Salen del mismo sitio y LLEVAN LOS FILTROS QUE HAY PUESTOS AHORA
           MISMO: lo que se imprime es lo que se está viendo, no «todos los clientes». -->
      <div style="margin:-.5rem 0 1rem">${botonesListado('clientes', qsListado)}</div>

      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr><th>Código</th><th>Nombre</th><th>Email</th><th>Teléfono</th><th>Grupo</th><th>Registrado</th><th></th></tr></thead>
          <tbody>${total === 0 ? ((q || verArchivados) ? emptyRow(7, 'No se encontraron clientes con ese filtro.', { icon: 'ti-search' }) : emptyRow(7, 'Todavía no tienes clientes. Vamos a dar de alta el primero.', can(c, 'clients.create') ? { cta: 'Nuevo cliente', onclick: 'openNewClient()' } : {})) : rowsHtml}</tbody>
        </table></div>
      </div>

      ${total > 0 ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;flex-wrap:wrap;gap:.5rem">
        <span style="color:var(--muted);font-size:.85rem">Página ${page} de ${totalPages} · ${total} cliente${total === 1 ? '' : 's'}</span>
        <div style="display:flex;gap:.5rem">
          ${page > 1 ? `<a class="btn btn-secondary btn-sm" href="?${buildQs(page - 1)}">← Anterior</a>` : '<span class="btn btn-secondary btn-sm" style="opacity:.4;pointer-events:none">← Anterior</span>'}
          ${page < totalPages ? `<a class="btn btn-secondary btn-sm" href="?${buildQs(page + 1)}">Siguiente →</a>` : '<span class="btn btn-secondary btn-sm" style="opacity:.4;pointer-events:none">Siguiente →</span>'}
        </div>
      </div>` : ''}

      <div class="modal-overlay" id="clientModal">
        <div class="modal" style="max-width:640px">
          <div class="modal-head"><h3 id="clientModalTitle">Nuevo Cliente</h3><button class="modal-close" data-cl="cerrar">✕</button></div>
          <div class="modal-body">
            <input type="hidden" id="clientId">
            <div class="form-row">
              <div class="form-group"><label class="form-label">Nombre *</label><input class="form-control" id="cName"></div>
              <div class="form-group"><label class="form-label">ID Fiscal</label><input class="form-control" id="cFiscal"></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">Email</label><input class="form-control" id="cEmail" type="email"></div>
              <div class="form-group"><label class="form-label">Teléfono</label><input class="form-control" id="cPhone"></div>
            </div>
            <!-- F · SUGERENCIAS DE DIRECCIÓN. autocomplete=off para que el desplegable del navegador
                 no se ponga encima del nuestro; role/aria para que se pueda usar con el teclado. -->
            <div class="form-group" style="position:relative">
              <label class="form-label">Dirección</label>
              <input class="form-control" id="cAddress" autocomplete="off" role="combobox"
                     aria-autocomplete="list" aria-expanded="false" aria-controls="cAddressSug"
                     placeholder="Escribe la calle y elige la dirección de la lista">
              <div id="cAddressSug" class="dir-sug" role="listbox" style="display:none"></div>
              <div id="cAddressPista" class="dir-pista"></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">Ciudad</label><input class="form-control" id="cCity"></div>
              <div class="form-group"><label class="form-label">País</label><input class="form-control" id="cCountry"></div>
              <div class="form-group"><label class="form-label">Grupo</label><select class="form-control" id="cGroup"><option value="">Sin grupo</option>${groupOptions}</select></div>
            </div>
            <div class="form-group"><label class="form-label">Responsable</label>
              <select class="form-control" id="cResp"><option value="">Sin asignar</option>${userOptions}</select>
              <div style="font-size:.7rem;color:var(--muted);margin-top:.25rem">Quién lleva a este cliente. Sus ventas se atribuyen aquí — si lo reasignas, su histórico se reatribuye solo.</div>
            </div>

            <!-- Dirección fiscal completa: OPCIONAL y PLEGADA. Solo hace falta para exportar la
                 factura a Facturae (FACe). Quien nunca factura a la Administración no la ve. -->
            <div style="margin:.25rem 0 .75rem">
              <button type="button" class="btn btn-secondary btn-sm" id="btnFiscal">
                + Añadir dirección fiscal completa
              </button>
              <div style="font-size:11px;color:var(--text2);margin-top:.35rem">
                Necesaria solo para generar la factura electrónica <strong>Facturae</strong> (facturas a la Administración).
              </div>
            </div>
            <div id="fiscalBlock" style="display:none">
              <div class="form-row">
                <div class="form-group"><label class="form-label">Código postal</label><input class="form-control" id="cPostal" maxlength="10" placeholder="28001"></div>
                <div class="form-group"><label class="form-label">Provincia</label><input class="form-control" id="cProvince" maxlength="100" placeholder="Madrid"></div>
              </div>
              <div style="font-size:11px;color:var(--text2);margin:-.35rem 0 .75rem">
                Facturae exige además <strong>NIF</strong>, <strong>dirección</strong>, <strong>ciudad</strong> y <strong>país</strong>, arriba.
              </div>
            </div>
            <hr style="margin:1rem 0;border:none;border-top:1px solid var(--border)">
            <h4 style="font-size:.85rem;font-weight:600;margin:.25rem 0 .75rem">Gestión / Datos fiscales</h4>
            <div class="form-row">
              <div class="form-group"><label class="form-label">Tipo de cliente</label>
                <select class="form-control" id="cType">
                  <option value="particular">Particular</option>
                  <option value="empresa">Empresa o profesional</option>
                </select>
              </div>
              <div class="form-group"><label class="form-label">Plazo de pago (días)</label>
                <input class="form-control" id="cTermDays" type="number" min="0" step="1" value="0">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">Forma de pago preferida</label>
                <select class="form-control" id="cPayMethod">
                  <option value="">— Sin especificar —</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="efectivo">Efectivo</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="domiciliacion">Domiciliación</option>
                </select>
              </div>
              <div class="form-group"><label class="form-label">Perfil de cobro</label>
                <select class="form-control" id="cProfile">
                  <option value="suave">Suave (recordatorios espaciados)</option>
                  <option value="estandar">Estándar</option>
                  <option value="firme">Firme (reclama pronto)</option>
                  <option value="manual">Manual (lo gestionas tú)</option>
                </select>
              </div>
            </div>
            <!-- PUNTO 11 · el descuento que este cliente lleva SIEMPRE. No se aplica solo: al hacer
                 una factura sale propuesto en «Descuentos…» y se confirma ahí. -->
            <!-- PELDAÑO 8 · solo se pinta en el oficio de SALUD, que es quien la necesita. La columna
                 la tienen todos; el campo, no: la ficha de un taller no se llena de huecos ajenos. -->
            <div class="form-group" id="cNacWrap" style="display:none"><label class="form-label">Fecha de nacimiento</label>
              <input type="date" class="form-control" id="cNac" style="max-width:200px">
              <div style="font-size:.72rem;color:var(--muted);margin-top:.2rem">La edad cambia la pauta de un tratamiento.</div></div>
            <div class="form-group"><label class="form-label">Descuento fijo (%)</label>
              <input type="number" class="form-control" id="cDto" min="0" max="100" step="0.5" value="0" style="max-width:140px">
              <div style="font-size:.72rem;color:var(--muted);margin-top:.2rem">El que lleva siempre. Se te propone al facturarle; nunca se aplica solo.</div></div>
            <div class="form-group"><label class="form-label">Notas internas</label><textarea class="form-control" id="cNotes" rows="2"></textarea></div>
          </div>
          <div class="modal-foot"><button class="btn btn-secondary" data-cl="cerrar">Cancelar</button><button class="btn btn-primary" data-cl="guardar">Guardar</button></div>
        </div>
      </div>

      <!-- A1 — La VENTANA FLOTANTE no se escribe aquí: la construye fichaVentanaJS en el propio
           navegador, para que la lista de clientes y la ficha completa usen exactamente el mismo
           armazon y no puedan divergir. Aqui solo queda el hueco que necesita la maquinaria de
           cobro compartida. -->
      ${cobroModalHtml()}
      ${mapaAssetsHTML()}
      <style>${fichaClienteCSS()}${fichaCompletaCSS()}
        /* F · La lista de sugerencias de dirección. Flota sobre el formulario (por eso el padre
           lleva position:relative) y se limita en alto: el modal ya tiene su propio scroll y una
           lista larga lo empujaría entero. */
        .dir-sug{position:absolute;left:0;right:0;top:100%;z-index:5;margin-top:.25rem;
          background:var(--bg2);border:1px solid var(--border2);border-radius:12px;
          box-shadow:0 12px 28px rgba(0,0,0,.28);max-height:230px;overflow-y:auto}
        .dir-sug button{display:block;width:100%;text-align:left;background:none;border:none;
          font-family:inherit;font-size:.84rem;color:var(--text);padding:.55rem .75rem;cursor:pointer;
          border-bottom:1px solid var(--border)}
        .dir-sug button:last-child{border-bottom:none}
        .dir-sug button:hover,.dir-sug button[aria-selected="true"]{background:var(--bg3)}
        .dir-sug .no{padding:.55rem .75rem;font-size:.8rem;color:var(--text3)}
        .dir-pista{font-size:11px;color:var(--text2);margin-top:.3rem;min-height:1em}
        .dir-pista.ok{color:var(--ok)}
      </style>
      <script nonce="${c.get('cspNonce')}">
      ${JS_LISTADO_ENVIAR}
      ${fichaClienteJS({ sym })}
      ${fichaVentanaJS({ montaje: 'ventana' })}
      ${fichaCompletaJS()}
      ${cobroModalScript(sym)}
      const PUEDE_CRM = ${can(c, 'crm.read') ? 'true' : 'false'};   // la sección CRM de la ficha solo si tiene la llave
      let currentDetailClientId=null;   // cliente abierto en la ficha (para refrescar tras un cobro)
      // Punto de extensión del modal compartido: tras un cobro, se vuelve a pedir la ficha entera.
      // Si el usuario estaba en la capa de gestión de cobro, se queda en ella con el dato nuevo:
      // registrar un cobro y que te eche al resumen sería perder el sitio.
      window.cobroOnSaved = function(){
        if (!currentDetailClientId) return;
        fetch('/api/erp/clients/'+currentDetailClientId+'/360').then(function(r){ return r.json(); })
          .then(function(d){ window.BFWin.setDatos(d); window.BFWin.abrirTarjeta('deuda'); })
          .catch(function(){ window.BFWin.abrir(currentDetailClientId); });
      };
      let currentClient=null;   // cliente en edición (conserva accepts_newsletter sin tocar la API)
      // ── F · SUGERENCIAS DE DIRECCIÓN ──────────────────────────────────────────────────────────
      // POR QUÉ EXISTE ESTO (23 ago 2026): se guardó «Cuesta de San Francisco 8, Getafe» y no salió
      // mapa. La calle existe, pero en LAS ROZAS, no en Getafe — y escribiendo a ciegas no hay forma
      // de enterarse. Ahora se escribe, se elige de la lista, y el punto que se guarda es EL ELEGIDO:
      // no se vuelve a buscar nada, así que el mapa no puede acabar en otro sitio.
      //
      // Tres cosas que no son adorno:
      //  · El retardo (350 ms) y el mínimo de 4 letras. Sin ellos se dispara una consulta por tecla
      //    contra un servicio ajeno y gratuito, que es justo como te ganas que te bloqueen.
      //  · La petición lleva un número de orden: una respuesta lenta de hace tres letras NO puede
      //    pisar la lista de lo que se está escribiendo ahora.
      //  · Si el servicio no contesta, no pasa NADA: el campo se comporta como el de siempre y se
      //    puede escribir a mano. Una dirección no puede depender de que un tercero esté vivo.
      let dirElegida = null;      // el punto que se picó en la lista (null = escrito a mano)
      let dirReloj = null, dirTurno = 0, dirLista = [], dirFoco = -1;

      function dirPista(txt, ok){
        const e = document.getElementById('cAddressPista');
        e.textContent = txt || ''; e.className = 'dir-pista' + (ok ? ' ok' : '');
      }
      function dirCerrar(){
        const c = document.getElementById('cAddressSug');
        c.style.display='none'; c.innerHTML=''; dirLista=[]; dirFoco=-1;
        document.getElementById('cAddress').setAttribute('aria-expanded','false');
      }
      // Se llama al abrir el modal y al empezar a teclear: el punto de una dirección anterior no
      // puede sobrevivir a que alguien cambie la dirección.
      function dirReset(){ dirElegida=null; dirPista(''); dirCerrar(); }

      function dirPintar(){
        const c = document.getElementById('cAddressSug');
        if (!dirLista.length){ dirCerrar(); return; }
        c.innerHTML = dirLista.map(function(s,i){
          return '<button type="button" role="option" data-sug="'+i+'" aria-selected="false">'
               + escHtml(s.etiqueta) + '</button>';
        }).join('');
        c.style.display='block';
        document.getElementById('cAddress').setAttribute('aria-expanded','true');
      }
      function dirMarcar(n){
        const bs = document.getElementById('cAddressSug').querySelectorAll('button[data-sug]');
        if (!bs.length) return;
        dirFoco = (n + bs.length) % bs.length;
        bs.forEach(function(b,i){ b.setAttribute('aria-selected', i===dirFoco ? 'true' : 'false'); });
        bs[dirFoco].scrollIntoView({block:'nearest'});
      }
      function dirElegir(i){
        const s = dirLista[i]; if (!s) return;
        document.getElementById('cAddress').value = s.calle;
        if (s.ciudad) document.getElementById('cCity').value = s.ciudad;
        if (s.pais)   document.getElementById('cCountry').value = s.pais;
        // El CP vive en el bloque fiscal, que nace plegado: si se rellena y no se abre, aparece un
        // dato donde nadie lo ve. La PROVINCIA no se toca — el buscador devuelve la comunidad
        // autónoma («Comunidad de Madrid»), no la provincia («Madrid»), y rellenarla mal rompe Facturae.
        if (s.cp){
          document.getElementById('cPostal').value = s.cp;
          if (document.getElementById('fiscalBlock').style.display==='none') setFiscal(true);
        }
        dirElegida = s;
        dirCerrar();
        dirPista('Dirección confirmada en el mapa: ' + s.etiqueta, true);
      }

      function dirBuscar(){
        const q = document.getElementById('cAddress').value.trim();
        if (q.length < 4){ dirCerrar(); return; }
        const mio = ++dirTurno;
        fetch('/api/erp/mapa/sugerencias?q=' + encodeURIComponent(q))
          .then(function(r){ return r.json(); })
          .then(function(j){
            if (mio !== dirTurno) return;         // llegó tarde: ya se está escribiendo otra cosa
            dirLista = (j && j.sugerencias) || [];
            if (!dirLista.length){
              const c = document.getElementById('cAddressSug');
              c.innerHTML = '<div class="no">Ninguna dirección coincide. Puedes escribirla a mano: se guardará igual, pero sin mapa.</div>';
              c.style.display='block';
              return;
            }
            dirPintar();
          })
          .catch(function(){ dirCerrar(); });     // el buscador no contesta: ni ruido ni estorbo
      }

      // SEGUIR ESCRIBIENDO DETRÁS DE LO ELEGIDO NO TIRA EL PUNTO. Hace falta porque el mapa NO tiene
      // todos los portales de España: cuando el número no está, el buscador ofrece LA CALLE, y quien
      // la elige tiene que poder añadirle el número sin perder el sitio. Añadir «, 2ºB» o « 3» a la
      // calle elegida no mueve la chincheta de sitio, así que el punto sigue valiendo.
      // La comprobación del dígito NO sobra: sin ella, cambiar «Guadalupe 3» por «Guadalupe 300»
      // seguiría empezando igual y se quedaría con el punto del número 3, que es otro portal.
      function dirSigueValiendo(valor){
        if (!dirElegida) return false;
        if (valor.indexOf(dirElegida.calle) !== 0) return false;
        var resto = valor.slice(dirElegida.calle.length);
        return resto === '' || !/^[0-9]/.test(resto);
      }
      document.getElementById('cAddress').addEventListener('input', function(){
        if (!dirSigueValiendo(this.value)) { dirElegida = null; dirPista(''); }
        clearTimeout(dirReloj); dirReloj = setTimeout(dirBuscar, 350);
      });
      document.getElementById('cAddress').addEventListener('keydown', function(ev){
        if (ev.key === 'ArrowDown'){ ev.preventDefault(); dirMarcar(dirFoco + 1); }
        else if (ev.key === 'ArrowUp'){ ev.preventDefault(); dirMarcar(dirFoco - 1); }
        else if (ev.key === 'Enter' && dirFoco >= 0){ ev.preventDefault(); dirElegir(dirFoco); }
        else if (ev.key === 'Escape'){ dirCerrar(); }
      });
      document.getElementById('cAddressSug').addEventListener('mousedown', function(ev){
        // mousedown y no click: el blur del campo cierra la lista antes de que llegue el click.
        const b = ev.target.closest('button[data-sug]'); if (!b) return;
        ev.preventDefault(); dirElegir(parseInt(b.getAttribute('data-sug'), 10));
      });
      document.getElementById('cAddress').addEventListener('blur', function(){ setTimeout(dirCerrar, 120); });

      // Bloque de dirección fiscal (Facturae): plegado por defecto; se despliega solo si el cliente
      // ya tiene alguno de esos datos, para que al editar no queden escondidos.
      function setFiscal(abierto){
        document.getElementById('fiscalBlock').style.display = abierto ? 'block' : 'none';
        document.getElementById('btnFiscal').textContent = abierto
          ? '— Ocultar dirección fiscal completa' : '+ Añadir dirección fiscal completa';
      }
      function toggleFiscal(){ setFiscal(document.getElementById('fiscalBlock').style.display==='none'); }

      function openNewClient(){
        currentClient=null;
        document.getElementById('clientModalTitle').textContent='Nuevo Cliente';
        document.getElementById('clientId').value='';
        ['cName','cFiscal','cEmail','cPhone','cAddress','cCity','cCountry','cNotes','cPostal','cProvince'].forEach(id=>document.getElementById(id).value='');
        document.getElementById('cDto').value='0';
        document.getElementById('cNac').value='';
        document.getElementById('cNacWrap').style.display =
          (window.OFICIO_CAMPOS && window.OFICIO_CAMPOS.indexOf('fecha_nacimiento')>=0) ? '' : 'none';
        setFiscal(false);
        dirReset();   // F — ni sugerencias abiertas ni el punto del cliente anterior
        document.getElementById('cGroup').value='';
        document.getElementById('cResp').value='';
        document.getElementById('cType').value='particular';
        document.getElementById('cTermDays').value=0;
        document.getElementById('cPayMethod').value='';
        document.getElementById('cProfile').value='estandar';
        openModal('clientModal');
      }
      async function editClient(id){
        const c=await api('GET','/api/erp/clients/'+id);
        currentClient=c;
        document.getElementById('clientModalTitle').textContent='Editar Cliente';
        document.getElementById('clientId').value=id;
        document.getElementById('cName').value=c.name;
        document.getElementById('cFiscal').value=c.fiscal_id||'';
        document.getElementById('cEmail').value=c.email||'';
        document.getElementById('cPhone').value=c.phone||'';
        document.getElementById('cAddress').value=c.address||'';
        dirReset();   // F — se edita partiendo de lo guardado, sin punto elegido en esta sesión
        document.getElementById('cCity').value=c.city||'';
        document.getElementById('cCountry').value=c.country||'';
        document.getElementById('cPostal').value=c.postal_code||'';
        document.getElementById('cProvince').value=c.province||'';
        setFiscal(!!(c.postal_code||c.province));
        document.getElementById('cGroup').value=c.group_id||'';
        document.getElementById('cResp').value=c.responsable_user_id||'';
        document.getElementById('cNotes').value=c.notes||'';
        document.getElementById('cDto').value=Number(c.descuento_pct||0);
        document.getElementById('cNac').value=c.fecha_nacimiento||'';
        // El campo solo existe para el oficio que lo pide (peldaño 8). Se decide con lo que el
        // servidor ya manda en window.OFICIO: no se adivina desde el navegador.
        if (window.OFICIO_CAMPOS && window.OFICIO_CAMPOS.indexOf('fecha_nacimiento')>=0)
          document.getElementById('cNacWrap').style.display='';
        document.getElementById('cType').value=c.client_type||'particular';
        document.getElementById('cTermDays').value=Number(c.payment_term_days||0);
        document.getElementById('cPayMethod').value=c.payment_method||'';
        document.getElementById('cProfile').value=c.collections_profile||'estandar';
        openModal('clientModal');
      }
      async function saveClient(){
        const id=document.getElementById('clientId').value;
        const body={name:document.getElementById('cName').value,fiscal_id:document.getElementById('cFiscal').value,email:document.getElementById('cEmail').value,phone:document.getElementById('cPhone').value,address:document.getElementById('cAddress').value,city:document.getElementById('cCity').value,country:document.getElementById('cCountry').value,postal_code:document.getElementById('cPostal').value,province:document.getElementById('cProvince').value,group_id:document.getElementById('cGroup').value||null,notes:document.getElementById('cNotes').value,descuento_pct:Number(document.getElementById('cDto').value)||0,fecha_nacimiento:document.getElementById('cNac').value||'',accepts_newsletter: id ? !!(currentClient&&currentClient.accepts_newsletter) : false,client_type:document.getElementById('cType').value,payment_term_days:parseInt(document.getElementById('cTermDays').value)||0,payment_method:document.getElementById('cPayMethod').value,collections_profile:document.getElementById('cProfile').value,responsable_user_id:document.getElementById('cResp').value||null,
          // F — si se eligió una dirección de la lista, viaja SU punto: el servidor lo guarda tal cual
          // y no vuelve a buscar nada. Si se escribió a mano, no van y se resuelve al guardar.
          geo_lat: dirElegida ? dirElegida.lat : null,
          geo_lon: dirElegida ? dirElegida.lon : null,
          geo_etiqueta: dirElegida ? dirElegida.etiqueta : ''};
        try{if(id)await api('PUT','/api/erp/clients/'+id,body);else await api('POST','/api/erp/clients',body);closeModal('clientModal');toast(id?'Actualizado':'Creado');location.reload();}catch(e){toast(e.message,'err')}
      }
      async function delClient(id){if(!await window.confirmarEnPagina({titulo:'Archivar el cliente',texto:'Dejará de aparecer en la lista y en los selectores. No se borra: sus facturas y su historial siguen enteros.',aceptar:'Sí, archivarlo'}))return;try{await api('DELETE','/api/erp/clients/'+id);toast('Archivado');location.reload();}catch(e){toast(e.message,'err')}}
      async function restoreClient(id){try{await api('POST','/api/erp/clients/'+id+'/restore');toast('Restaurado');location.reload();}catch(e){toast(e.message,'err')}}
      // ── A1 · ABRIR UN CLIENTE ABRE LA VENTANA FLOTANTE ──────────────────────────────────────
      // Mismo nombre de función que antes a propósito: la llaman la fila de la lista y el modal de
      // cobro compartido. Lo que cambia es qué abre.
      function viewDetail(id){ currentDetailClientId = id; window.BFWin.abrir(id); }
      window.viewDetail = viewDetail;

      // A2 · Entrar directamente por /admin/clients?ficha=<id> (o volver hacia delante en el
      // historial) abre la ventana sin pasar por la lista. La direccion propia de la ventana es
      // /admin/clients/<id>, que es una PAGINA de verdad: recargar da la ficha completa.
      (function(){
        var f = new URLSearchParams(location.search).get('ficha');
        if (f && /^[0-9]+$/.test(f)) viewDetail(parseInt(f, 10));
      })();

      // U6 · Onboarding: al llegar con ?nuevo=1 (enlace "Vamos →" del checklist de Inicio) se abre
      // directo el alta de cliente. Limpia la query para que un refresco no lo reabra. Solo UI.
      if (new URLSearchParams(location.search).get('nuevo') === '1') {
        try { history.replaceState(null, '', '/admin/clients'); } catch(e){}
        openNewClient();
      }
      // Facturae: el aviso "Facturae no disponible" de la ficha de factura enlaza aquí con
      // ?editar=<id> para abrir directo la ficha del cliente que hay que completar.
      var _ed = new URLSearchParams(location.search).get('editar');
      if (_ed && /^[0-9]+$/.test(_ed)) {
        try { history.replaceState(null, '', '/admin/clients'); } catch(e){}
        editClient(parseInt(_ed));
      }
      
      // ── 5 SEP 2026 (csp-erp-migrar-handlers) — ENGANCHE DE CLIENTES ──────────────────────────
      // La tabla la pinta el servidor, pero el menu «···» pinta SUS botones al abrirlo: Editar y
      // Archivar usan la clave act del armazon y llegan por 'rowmenu:act'.
      document.addEventListener('click', function(e){
        var t = e.target.closest('[data-cl]'); if (!t) return;
        var a = t.getAttribute('data-cl'), id = Number(t.getAttribute('data-id'));
        if (a === 'ver') viewDetail(id);
        else if (a === 'restaurar') restoreClient(id);
        else if (a === 'nuevo') openNewClient();
        else if (a === 'cerrar') closeModal('clientModal');
        else if (a === 'guardar') saveClient();
      });
      document.addEventListener('change', function(e){
        var t = e.target.closest('[data-cl="filtro"]'); if (t) t.form.submit();
      });
      document.getElementById('btnFiscal')?.addEventListener('click', function(){ toggleFiscal(); });
      document.addEventListener('rowmenu:act', function(e){
        var id = Number(e.detail.arg);
        if (e.detail.act === 'cli-editar') editClient(id);
        else if (e.detail.act === 'cli-archivar') delClient(id);
      });
</script>`;
    return c.html(adminLayout('Clientes', content, 'clients', c.get('session')?.csrfToken || '', c));
  });

  // ══ LA FICHA COMPLETA — página con su propia dirección ══════════════════════════════════════
  // POR QUÉ UNA PÁGINA Y NO SOLO EL MODAL: una ficha sin dirección no se puede enlazar, ni pasar a
  // un empleado, ni volver a ella con el botón atrás, ni recibir los enlaces de los avisos de DISA.
  // EL MODAL SE QUEDA EXACTAMENTE COMO ESTÁ —con su deuda, sus facturas y su «Registrar cobro» a los
  // mismos clics— y gana UNA sola cosa: el enlace para venir aquí. Todo lo del 360 vive SOLO aquí:
  // dos sitios pintando lo mismo acaban discrepando.
  views.get('/:id{[0-9]+}', requirePerm('clients.read'), c => {
    // PELDAÑO 8 · LA PESTAÑA DEL HISTORIAL. Dos condiciones, y las dos tienen que cumplirse:
    // el negocio es de oficio SALUD, y esta persona tiene el permiso —que no perdona el rol admin—.
    // Quien no cumpla las dos NO VE EL BOTÓN: nada de enseñar la puerta y dar error al empujarla.
    const verHistorial = tieneHistorial(db) && puedeHistorial(db, c.get('session'));
    const cli = db.prepare('SELECT c.*, g.name AS group_name FROM clients c LEFT JOIN client_groups g ON c.group_id=g.id WHERE c.id=?').get(c.req.param('id'));
    if (!cli) return c.html(adminLayout('Cliente', '<div class="card"><p>Ese cliente no existe o se archivó. <a href="/admin/clients">Volver a Clientes</a></p></div>', 'clients', c.get('session')?.csrfToken || '', c), 404);
    const content = `
    ${mapaAssetsHTML()}
    <style>
      ${fichaClienteCSS()}
      ${fichaCompletaCSS()}
    </style>
    <div class="ph">
      <div>
        <div style="font-size:.75rem;color:var(--text3)"><a href="/admin/clients" style="color:inherit">Clientes</a> ›</div>
        <h2 style="margin:0">${escHtml(cli.name)}</h2>
      </div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
        ${verHistorial ? `<a class="btn btn-sm" href="/admin/historial/${cli.id}"><i class="ti ti-stethoscope"></i> Historial clínico</a>` : ''}
        <a class="btn btn-secondary btn-sm" href="/admin/clients">← Volver</a>
      </div>
    </div>

    <!-- A3 · La capa de detalle. Es la MISMA que la de la ventana flotante: las tarjetas de aquí y
         las de allí abren el mismo contenido, servido por el mismo endpoint. Empieza oculta. -->
    <div id="f360capa" class="card bf-caja" style="display:none"></div>

    <div id="f360resumen">
      <div class="card bf-caja" style="margin-bottom:1rem">
        <div id="f360datos"></div>
        <div id="f360cifras"><div class="skel skel-block" style="height:5rem"></div></div>
        <div id="f360cont"></div>
      </div>
      <div id="f360disa"></div>
      <div id="f360full"></div>
    </div>
    ${cobroModalHtml()}
    <script nonce="${c.get('cspNonce')}">
    ${fichaClienteJS({ sym })}
    ${fichaVentanaJS({ montaje: 'pagina' })}
    ${fichaCompletaJS()}
    ${cobroModalScript(sym)}
    var CID=${cli.id}, SYM=${JSON.stringify(sym)}, D=null;
    window.BF_CLIENTE_ID = CID;
    window.BF_CLIENTE_NOMBRE = ${JSON.stringify(cli.name)};

    // Las tarjetas, los datos y los chips los pinta el componente compartido: los mismos que en la
    // ventana flotante, con las mismas reglas de recorte, de aire y de altura. Aquí no se pinta ni
    // una caja a mano — es lo que impide que las dos pantallas vuelvan a divergir.
    function pintaCabecera(){
      document.getElementById('f360datos').innerHTML  = BF.datosHTML(D);
      document.getElementById('f360cifras').innerHTML = BF.tarjetasHTML(D);
      document.getElementById('f360cont').innerHTML   = BF.chipsHTML(D.contadores, D.chips_extra);
      // C1 — Muere el listado de seis avisos iguales. Una recomendación por familia, con su decisión.
      var recs = D.recomienda || [];
      document.getElementById('f360disa').innerHTML = recs.length
        ? '<div class="card bf-caja" style="margin-bottom:1rem"><h4>Lo que te recomiendo</h4>'
          + BF.recomiendaHTML(recs)
          + '<a href="/admin/vigia" style="font-size:.8rem">Ver todo en el vigía →</a></div>'
        : '';
    }
    async function recargar(){
      try {
        const r = await fetch('/api/erp/clients/'+CID+'/360');
        D = await r.json();
        if (D.error) throw new Error(D.error);
        window.BFWin.setDatos(D); pintaCabecera();
      } catch(e){
        document.getElementById('f360cifras').innerHTML='<div class="alert alert-err">'+escHtml(e.message)+'</div>';
      }
    }
    // Tras registrar un cobro se vuelve a pedir la ficha entera: si el «Te debe» de arriba y la
    // tabla de abajo dijeran cifras distintas, una de las dos estaría mintiendo.
    window.cobroOnSaved = function(){ recargar(); BFFull.pintar(document.getElementById('f360full'), CID, D); };
    // El punto por el que el componente compartido repinta esta página (periodo, contacto, chip).
    window.BFPintaPagina = function(d){ D = d; pintaCabecera(); };
    (async function(){
      await recargar();
      // A3 · La ficha completa de la PÁGINA la pinta el MISMO código que la capa de la ventana.
      BFFull.pintar(document.getElementById('f360full'), CID, D);
      if (location.hash === '#historia') {
        var h=document.getElementById('bff'+CID+'_hist'); if(h) h.scrollIntoView({block:'start'});
      }
    })();
    </script>`;
    return c.html(adminLayout(cli.name, content, 'clients', c.get('session')?.csrfToken || '', c));
  });

  views.get('/groups', requirePerm('clients.read'), c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const content = `
      <div class="ph"><h2>Grupos de Clientes</h2><button class="btn btn-primary" data-gr="nuevo">Nuevo grupo</button></div>
      <div class="card">
        <div class="card-head"><h3>Lista de grupos</h3><input class="search" id="searchBox" placeholder="Buscar..."></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Nombre</th><th>Descripción</th><th>Miembros</th><th></th></tr></thead>
          <tbody id="groupBody">${skeletonRows(4)}</tbody>
        </table></div>
      </div>
      <div class="modal-overlay" id="groupModal">
        <div class="modal">
          <div class="modal-head"><h3 id="groupModalTitle">Nuevo Grupo</h3><button class="modal-close" data-gr="cerrar">✕</button></div>
          <div class="modal-body">
            <input type="hidden" id="groupId">
            <div class="form-group"><label class="form-label">Nombre *</label><input class="form-control" id="gName"></div>
            <div class="form-group"><label class="form-label">Descripción</label><input class="form-control" id="gDesc"></div>
          </div>
          <div class="modal-foot"><button class="btn btn-secondary" data-gr="cerrar">Cancelar</button><button class="btn btn-primary" data-gr="guardar">Guardar</button></div>
        </div>
      </div>
      <script nonce="${c.get('cspNonce')}">
      let groups=[];
      async function load(){
        groups=await api('GET','/api/erp/clients/groups/all').catch(()=>[]);
        renderGroups();
      }
      function renderGroups(){
        const q=(document.getElementById('searchBox').value||'').toLowerCase();
        const f=q?groups.filter(g=>(g.name||'').toLowerCase().includes(q)||(g.description||'').toLowerCase().includes(q)):groups;
        document.getElementById('groupBody').innerHTML=f.length?f.map(g=>'<tr><td><strong>'+escHtml(g.name)+'</strong></td><td style="color:var(--muted)">'+escHtml(g.description||'-')+'</td><td><span class="badge b-blue">'+g.member_count+'</span></td><td><button class="btn btn-secondary btn-sm" data-gr="editar" data-id="'+g.id+'">Editar</button> <button class="btn btn-danger btn-sm" data-gr="borrar" data-id="'+g.id+'">Eliminar</button></td></tr>').join(''):(q?window.emptyRow(4,'No se encontraron grupos con ese filtro.',{icon:'ti-search'}):window.emptyRow(4,'Aún no has creado grupos. Agrupa clientes para tratarlos juntos.',{cta:'Nuevo grupo',act:'grupo-nuevo'}));
      }
      function editGroup(id){const g=groups.find(x=>x.id===id);if(!g)return;document.getElementById('groupModalTitle').textContent='Editar Grupo';document.getElementById('groupId').value=id;document.getElementById('gName').value=g.name;document.getElementById('gDesc').value=g.description||'';openModal('groupModal');}
      async function saveGroup(){
        const id=document.getElementById('groupId').value;
        const body={name:document.getElementById('gName').value,description:document.getElementById('gDesc').value,discount_pct: id ? ((groups.find(x=>x.id===+id)||{}).discount_pct||0) : 0};
        try{if(id)await api('PUT','/api/erp/clients/groups/'+id,body);else await api('POST','/api/erp/clients/groups/create',body);closeModal('groupModal');document.getElementById('groupId').value='';toast('Guardado');load();}catch(e){toast(e.message,'err')}
      }
      async function delGroup(id){if(!await window.confirmarEnPagina({titulo:'Eliminar el grupo',texto:'Los clientes que estén en él se quedan sin grupo. No se borra ningún cliente.',aceptar:'Sí, eliminarlo'}))return;await api('DELETE','/api/erp/clients/groups/'+id);toast('Eliminado');load();}
      load();
      
      // 5 SEP 2026 — la tabla de grupos se pinta despues de pedirla: delegacion.
      document.getElementById('searchBox')?.addEventListener('input', function(){ renderGroups(); });
      document.addEventListener('click', function(e){
        var t = e.target.closest('[data-gr]'); if (!t) return;
        var a = t.getAttribute('data-gr'), id = Number(t.getAttribute('data-id'));
        if (a === 'nuevo') openModal('groupModal');
      });
      document.addEventListener('rowmenu:act', function(e){
        // El boton del estado vacio, que solo sale cuando no hay ni un grupo.
        if (e.detail.act === 'grupo-nuevo') openModal('groupModal');
        else if (a === 'cerrar') closeModal('groupModal');
        else if (a === 'guardar') saveGroup();
        else if (a === 'editar') editGroup(id);
        else if (a === 'borrar') delGroup(id);
      });
</script>`;
    return c.html(adminLayout('Grupos de Clientes', content, 'client-groups', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
