import { Hono } from 'hono';
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
import { cabecera360, contadoresDe, queCompra, avisosDisaDe } from '../cliente-360.js';
import { clientTimeline, clientCrmSummary } from '../crm.js';
import { detectar } from '../vigia.js';

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

export function createClientSvc(db, input) {
  const d = parseClient(input);
  if (fiscalIdConflict(db, d.fiscal_id)) { const e = new Error('Ya existe un cliente con ese NIF'); e.status = 409; throw e; }
  const code = nextCode(db, 'client');   // código interno CLI-NNNN, tras la guarda de NIF (no editable)
  const r = db.prepare('INSERT INTO clients (name,fiscal_id,email,phone,address,city,country,postal_code,province,group_id,notes,accepts_newsletter,client_type,payment_term_days,payment_method,collections_profile,client_code,responsable_user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(d.name, d.fiscal_id || '', d.email || '', d.phone || '', d.address || '', d.city || '', d.country || '', d.postal_code || '', d.province || '', d.group_id || null, d.notes || '', d.accepts_newsletter ? 1 : 0, d.client_type || 'particular', d.payment_term_days || 0, d.payment_method || '', d.collections_profile || 'estandar', code, d.responsable_user_id || null);
  syncNewsletter(db, d.email, d.name, d.accepts_newsletter);
  return { id: r.lastInsertRowid, name: d.name, client_code: code };
}

export function updateClientSvc(db, id, input) {
  const exists = db.prepare('SELECT id FROM clients WHERE id=?').get(id);
  if (!exists) { const e = new Error('Cliente no encontrado'); e.status = 404; throw e; }
  const d = parseClient(input);
  if (fiscalIdConflict(db, d.fiscal_id, id)) { const e = new Error('Ya existe un cliente con ese NIF'); e.status = 409; throw e; }
  db.prepare('UPDATE clients SET name=?,fiscal_id=?,email=?,phone=?,address=?,city=?,country=?,postal_code=?,province=?,group_id=?,notes=?,accepts_newsletter=?,client_type=?,payment_term_days=?,payment_method=?,collections_profile=?,responsable_user_id=? WHERE id=?')
    .run(d.name, d.fiscal_id || '', d.email || '', d.phone || '', d.address || '', d.city || '', d.country || '', d.postal_code || '', d.province || '', d.group_id || null, d.notes || '', d.accepts_newsletter ? 1 : 0, d.client_type || 'particular', d.payment_term_days || 0, d.payment_method || '', d.collections_profile || 'estandar', d.responsable_user_id || null, id);
  syncNewsletter(db, d.email, d.name, d.accepts_newsletter);
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
      const cab = cabecera360(db, cli, puede);
      return c.json({
        cliente: { id: cli.id, name: cli.name, client_code: cli.client_code, created_at: cli.created_at, notes: cli.notes || '' },
        cabecera: cab,
        contadores: contadoresDe(db, cli.id, puede, cab.deuda),
        compra: queCompra(db, cli.id, puede),
        disa: avisosDisaDe(db, cli.id, puede, detectar),
        crm: can(c, 'crm.read') ? clientCrmSummary(db, cli.id, new Date().toISOString().slice(0, 10)) : null,
      });
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

    // WHERE: estado + búsqueda parcial (LIKE %q% sobre nombre y NIF, insensible a mayúsculas en ASCII).
    const where = ['c.active = ?'];
    const params = [activeVal];
    if (q) { where.push('(c.name LIKE ? OR c.fiscal_id LIKE ?)'); params.push('%' + q + '%', '%' + q + '%'); }
    const whereSql = 'WHERE ' + where.join(' AND ');

    // COUNT aparte para el total de páginas; SELECT con LIMIT/OFFSET para la página actual.
    const total = db.prepare('SELECT COUNT(*) AS n FROM clients c ' + whereSql).get(...params).n;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    if (page > totalPages) page = totalPages;
    const offset = (page - 1) * perPage;
    const clientsList = db.prepare(
      'SELECT c.*, g.name as group_name FROM clients c LEFT JOIN client_groups g ON c.group_id=g.id '
      + whereSql + ' ORDER BY c.name LIMIT ? OFFSET ?'
    ).all(...params, perPage, offset);

    // Opciones de grupo para el modal (server-render, sin fetch en cliente).
    const groupOptions = db.prepare('SELECT id, name FROM client_groups ORDER BY name').all()
      .map(g => '<option value="' + g.id + '">' + escHtml(g.name) + '</option>').join('');
    // CRM — usuarios ACTIVOS del negocio para el desplegable de responsable. Solo los activos: no
    // tiene sentido asignarle una cartera a alguien que ya no entra. Un cliente ya asignado a un
    // usuario que luego se desactiva conserva su id (nada se pierde) y la analítica lo resolverá
    // como "sin asignar" hasta que el dueño lo reasigne. Escapado: el nombre lo teclea una persona.
    const userOptions = db.prepare("SELECT id, name FROM admin_users WHERE active=1 ORDER BY name").all()
      .map(u => '<option value="' + u.id + '">' + escHtml(u.name) + '</option>').join('');

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
      '<td style="color:var(--muted);font-size:.8rem">'+((cl.created_at||'').split(' ')[0]||'-')+'</td>'+
      '<td style="white-space:nowrap">'+
        // Patrón §6: UNA acción clara ("Ver") + el resto en un menú "···".
        '<button class="btn btn-secondary btn-sm" onclick="viewDetail('+cl.id+')">Ver</button> '+
        (verArchivados
          ? (can(c,'clients.edit')?'<button class="btn btn-secondary btn-sm" onclick="restoreClient('+cl.id+')">Restaurar</button>':'')
          : ((can(c,'clients.edit')||can(c,'clients.delete'))
              ? rowMenu([
                  can(c,'clients.edit') ? {label:'Editar', onclick:'editClient('+cl.id+')'} : null,
                  can(c,'clients.delete') ? {label:'Archivar', danger:true, onclick:'delClient('+cl.id+')'} : null,
                ].filter(Boolean))
              : ''))+
      '</td>'+
      '</tr>').join('');

    const content = `
      <div class="ph">
        <h2>Clientes</h2>
        <form method="get" style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
          <input class="search" type="text" name="q" value="${escHtml(q)}" placeholder="Buscar por nombre o NIF...">
          <select class="form-control" name="archivados" style="width:auto;min-width:150px" onchange="this.form.submit()">
            <option value=""${verArchivados ? '' : ' selected'}>Activos</option>
            <option value="1"${verArchivados ? ' selected' : ''}>Archivados</option>
          </select>
          <button class="btn btn-secondary" type="submit">Buscar</button>
          ${can(c, 'clients.create') ? '<button type="button" class="btn btn-primary" onclick="openNewClient()">Nuevo cliente</button>' : ''}
        </form>
      </div>

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
          <div class="modal-head"><h3 id="clientModalTitle">Nuevo Cliente</h3><button class="modal-close" onclick="closeModal('clientModal')">✕</button></div>
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
            <div class="form-group"><label class="form-label">Dirección</label><input class="form-control" id="cAddress"></div>
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
              <button type="button" class="btn btn-secondary btn-sm" id="btnFiscal" onclick="toggleFiscal()">
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
            <div class="form-group"><label class="form-label">Notas internas</label><textarea class="form-control" id="cNotes" rows="2"></textarea></div>
          </div>
          <div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal('clientModal')">Cancelar</button><button class="btn btn-primary" onclick="saveClient()">Guardar</button></div>
        </div>
      </div>

      <!-- Detail Modal -->
      <div class="modal-overlay" id="detailModal">
        <div class="modal" style="max-width:700px">
          <!-- El modal es la VISTA RÁPIDA y se queda exactamente como estaba: misma deuda, mismas
               facturas, mismo «Registrar cobro» a los mismos clics. Gana UNA cosa y solo una: el
               enlace a la ficha completa. Todo lo del 360 vive allí, no aquí — dos sitios pintando
               lo mismo acaban discrepando. -->
          <div class="modal-head"><h3 id="detailName">Detalle Cliente</h3>
            <a class="btn btn-secondary btn-sm" id="detailFicha" href="/admin/clients" style="margin-left:auto;margin-right:.5rem">Ver ficha completa →</a>
            <button class="modal-close" onclick="closeModal('detailModal')">✕</button></div>
          <div class="modal-body" id="detailBody"></div>
        </div>
      </div>

      ${cobroModalHtml()}
      <script>
      ${cobroModalScript(sym)}
      const PUEDE_CRM = ${can(c, 'crm.read') ? 'true' : 'false'};   // la sección CRM de la ficha solo si tiene la llave
      let currentDetailClientId=null;   // cliente abierto en la ficha (para refrescar tras un cobro)
      // Punto de extensión del modal compartido: tras un cobro, refresca la ficha del cliente
      // (su "Te debe X €", deuda más antigua y la tabla de facturas).
      window.cobroOnSaved = function(id){ if(currentDetailClientId) viewDetail(currentDetailClientId); };
      let currentClient=null;   // cliente en edición (conserva accepts_newsletter sin tocar la API)
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
        setFiscal(false);
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
        document.getElementById('cCity').value=c.city||'';
        document.getElementById('cCountry').value=c.country||'';
        document.getElementById('cPostal').value=c.postal_code||'';
        document.getElementById('cProvince').value=c.province||'';
        setFiscal(!!(c.postal_code||c.province));
        document.getElementById('cGroup').value=c.group_id||'';
        document.getElementById('cResp').value=c.responsable_user_id||'';
        document.getElementById('cNotes').value=c.notes||'';
        document.getElementById('cType').value=c.client_type||'particular';
        document.getElementById('cTermDays').value=Number(c.payment_term_days||0);
        document.getElementById('cPayMethod').value=c.payment_method||'';
        document.getElementById('cProfile').value=c.collections_profile||'estandar';
        openModal('clientModal');
      }
      async function saveClient(){
        const id=document.getElementById('clientId').value;
        const body={name:document.getElementById('cName').value,fiscal_id:document.getElementById('cFiscal').value,email:document.getElementById('cEmail').value,phone:document.getElementById('cPhone').value,address:document.getElementById('cAddress').value,city:document.getElementById('cCity').value,country:document.getElementById('cCountry').value,postal_code:document.getElementById('cPostal').value,province:document.getElementById('cProvince').value,group_id:document.getElementById('cGroup').value||null,notes:document.getElementById('cNotes').value,accepts_newsletter: id ? !!(currentClient&&currentClient.accepts_newsletter) : false,client_type:document.getElementById('cType').value,payment_term_days:parseInt(document.getElementById('cTermDays').value)||0,payment_method:document.getElementById('cPayMethod').value,collections_profile:document.getElementById('cProfile').value,responsable_user_id:document.getElementById('cResp').value||null};
        try{if(id)await api('PUT','/api/erp/clients/'+id,body);else await api('POST','/api/erp/clients',body);closeModal('clientModal');toast(id?'Actualizado':'Creado');location.reload();}catch(e){toast(e.message,'err')}
      }
      async function delClient(id){if(!confirm('¿Archivar este cliente? Dejará de aparecer en la lista, pero no se borra.'))return;try{await api('DELETE','/api/erp/clients/'+id);toast('Archivado');location.reload();}catch(e){toast(e.message,'err')}}
      async function restoreClient(id){try{await api('POST','/api/erp/clients/'+id+'/restore');toast('Restaurado');location.reload();}catch(e){toast(e.message,'err')}}
      async function viewDetail(id){
        currentDetailClientId=id;   // para que cobroOnSaved refresque esta misma ficha
        const c=await api('GET','/api/erp/clients/'+id);
        const deb=await api('GET','/api/erp/clients/'+id+'/invoices').catch(()=>({total:0,oldest:null,invoices:[]}));
        document.getElementById('detailName').textContent=c.name;
        const ordRows=c.orders?.length?c.orders.map(o=>'<tr><td>'+o.order_number+'</td><td>${sym}'+Number(o.total||0).toFixed(2)+'</td><td><span class="badge b-gray">'+o.status+'</span></td><td style="color:var(--muted);font-size:.8rem">'+(o.created_at?.split(' ')[0]||'-')+'</td></tr>').join(''):window.emptyRow(4,'Este cliente aún no tiene pedidos.');
        // Facturas del cliente con estado de cobro en vivo (T4).
        const cobroBadge={pendiente:'b-yellow',parcial:'b-blue',cobrada:'b-green',vencida:'b-red',abono:'b-gray'};
        const cobroLabel={pendiente:'Pendiente',parcial:'Cobrada en parte',cobrada:'Cobrada',vencida:'Vencida',abono:'Abono'};
        const invRows=deb.invoices?.length?deb.invoices.map(f=>{
          const estadoCell=!f.counts
            ?'<span class="badge b-gray" title="No computa como deuda (anulada o rectificada por sustitución)">no computa</span>'
            :'<span class="badge '+(cobroBadge[f.estado]||'')+'">'+(cobroLabel[f.estado]||f.estado)+(f.estado==='vencida'&&f.dias_vencida?' '+f.dias_vencida+'d':'')+'</span>';
          // U4: acción directa "Registrar cobro" (abre el formulario ya precargado) + "Gestionar"
          // (centro compartido: próxima acción + recordatorios) a un clic. Mismo flag del motor
          // (f.cobrable) y solo si queda pendiente. Antes solo estaba "Gestionar" (un clic más).
          const cobrarCell = (f.cobrable && Number(f.pendiente)>0.0049)
            ? '<button class="btn btn-primary btn-sm" onclick="openCobros('+f.id+')">Registrar cobro</button> <button class="btn btn-secondary btn-sm" onclick="openGestion('+f.id+')">Gestionar</button>'
            : '';
          // Próxima acción (misma que en Cobros y listado de facturas).
          const p=f.proxima;
          const proxCell = p
            ? (window.proximaBadgeHtml?window.proximaBadgeHtml(p):'')+' <span style="font-size:.8rem">'+(p.accion==='recordatorio_email'?'recordatorio':((window.STAGE_LABEL&&window.STAGE_LABEL[p.etapa])||p.etapa))+'</span>'+(p.fechaObjetivo?'<br><span style="color:var(--muted);font-size:.75rem">'+p.fechaObjetivo+'</span>':'')
            : '<span style="color:var(--muted)">—</span>';
          return '<tr><td><a href="/admin/invoices/'+f.id+'" target="_blank">'+escHtml(f.invoice_number)+'</a></td>'+
            '<td style="color:var(--muted);font-size:.8rem">'+(f.due_date||f.issue_date||'-')+'</td>'+
            '<td>${sym}'+Number(f.total||0).toFixed(2)+'</td>'+
            '<td>'+(f.counts?'${sym}'+Number(f.pendiente||0).toFixed(2):'—')+'</td>'+
            '<td>'+estadoCell+'</td>'+
            '<td>'+proxCell+'</td>'+
            '<td style="text-align:right">'+cobrarCell+'</td></tr>';
        }).join(''):window.emptyRow(7,'Este cliente aún no tiene facturas.');
        const o=deb.oldest;
        // Paso 2.1 — "Gestionar cuenta" (toda la deuda viva a la vez), junto al "Te debe X".
        const gestionarCuentaBtn = Number(deb.total||0)>0.0049
          ? ' <button class="btn btn-primary btn-sm" style="margin-left:.5rem" onclick="openGestionCuenta('+id+')">Gestionar cuenta</button>'
          : '';
        const debtBlock='<div class="alert '+(Number(deb.total||0)>0?'alert-warn':'alert-ok')+'" style="margin-bottom:1rem">'+
          'Te debe <strong>${sym}'+Number(deb.total||0).toFixed(2)+'</strong>'+
          (o?' · Deuda más antigua: <a href="/admin/invoices/'+o.invoice_id+'" target="_blank">'+escHtml(o.invoice_number)+'</a> (${sym}'+Number(o.pendiente||0).toFixed(2)+', vence '+(o.due_date||'-')+(o.dias_vencida>0?' · '+o.dias_vencida+' días vencida':'')+')':' · sin deuda pendiente')+
          gestionarCuentaBtn+
          '</div>';
        document.getElementById('detailBody').innerHTML=
          '<div class="grid g2" style="margin-bottom:1rem">'+
          '<div><div class="form-label">Código</div><div style="font-family:monospace">'+escHtml(c.client_code||'-')+'</div></div>'+
          '<div><div class="form-label">Email</div><div>'+escHtml(c.email||'-')+'</div></div>'+
          '<div><div class="form-label">Teléfono</div><div>'+escHtml(c.phone||'-')+'</div></div>'+
          '<div><div class="form-label">Dirección</div><div>'+escHtml(c.address||'-')+(c.city?' · '+escHtml(c.city):'')+'</div></div>'+
          '<div><div class="form-label">NIF</div><div>'+escHtml(c.fiscal_id||'-')+'</div></div>'+
          '<div><div class="form-label">Tipo de cliente</div><div>'+(c.client_type==='empresa'?'Empresa o profesional':'Particular')+'</div></div>'+
          '<div><div class="form-label">Plazo de pago</div><div>'+(Number(c.payment_term_days||0)>0?Number(c.payment_term_days)+' días':'Contado')+'</div></div>'+
          '<div><div class="form-label">Forma de pago</div><div>'+({transferencia:"Transferencia",efectivo:"Efectivo",tarjeta:"Tarjeta",domiciliacion:"Domiciliación"}[c.payment_method]||'—')+'</div></div>'+
          '<div><div class="form-label">Perfil de cobro</div><div>'+({suave:"Suave",estandar:"Estándar",firme:"Firme",manual:"Manual"}[c.collections_profile||'estandar'])+'</div></div>'+
          '</div>'+
          (c.notes?'<div class="alert alert-ok" style="margin-bottom:1rem">'+escHtml(c.notes)+'</div>':'')+
          '<h4 style="margin-bottom:.75rem">Facturas y cobro</h4>'+
          debtBlock+
          '<div class="table-wrap" style="margin-bottom:1.25rem"><table><thead><tr><th>Factura</th><th>Vence</th><th>Total</th><th>Pendiente</th><th>Cobro</th><th>Próxima acción</th><th></th></tr></thead><tbody>'+invRows+'</tbody></table></div>'+
          '<h4 style="margin-bottom:.75rem">Historial de pedidos</h4>'+
          '<div class="table-wrap"><table><thead><tr><th>Orden</th><th>Total</th><th>Estado</th><th>Fecha</th></tr></thead><tbody>'+ordRows+'</tbody></table></div>'+
          (PUEDE_CRM?'<div id="crmSection" style="margin-top:1.5rem"><div class="skel" style="display:block;height:1.1rem;width:45%"></div></div>':'');
        var _vf=document.getElementById('detailFicha'); if(_vf) _vf.href='/admin/clients/'+id;
        openModal('detailModal');
        if(PUEDE_CRM) loadCrm(id);
      }
      // ── CRM en la ficha: oportunidades abiertas (con próxima acción) + línea de tiempo unificada.
      // Da superficie a los dos endpoints que ya existían sin ella (summary + timeline). El timeline
      // llega YA troceado por permisos desde el servidor (crm.read no revela facturas/cobros sin su
      // llave): aquí solo se pinta lo que vino. Fallo silencioso: si no hay permiso, la ficha no cambia.
      async function loadCrm(id){
        const box=document.getElementById('crmSection'); if(!box) return;
        let sum, tl=[];
        try{ sum=await api('GET','/api/erp/crm/clients/'+id+'/summary'); }
        catch(e){ box.innerHTML=''; return; }
        try{ tl=await api('GET','/api/erp/crm/clients/'+id+'/timeline'); }catch(e){ tl=[]; }
        const eur=n=>'${sym}'+Number(n||0).toFixed(2);
        const head='<div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.75rem">'
          +'<h4 style="margin:0">Actividad y oportunidades</h4>'
          +'<a class="btn btn-secondary btn-sm" href="/admin/crm">Ver embudo</a></div>';
        const resumen='<div class="alert '+(sum.abiertas.length?'alert-warn':'alert-ok')+'" style="margin-bottom:1rem">'
          +'<strong>'+sum.abiertas.length+'</strong> abierta'+(sum.abiertas.length===1?'':'s')+' · '+eur(sum.valorAbierto)+' en juego'
          +' · Ganadas <strong>'+sum.ganadas.count+'</strong> ('+eur(sum.ganadas.total)+')'
          +' · Perdidas '+sum.perdidas.count+' ('+eur(sum.perdidas.total)+')</div>';
        const opps=sum.abiertas.map(function(o){
          const p=o.proximaAccion; const due=!!(p&&p.accion);
          return '<a href="/admin/crm" style="display:block;text-decoration:none;color:inherit;border:1px solid var(--border2);border-radius:10px;padding:.6rem .75rem;margin-bottom:.5rem">'
            +'<div style="display:flex;justify-content:space-between;gap:.5rem">'
            +'<strong style="color:var(--text)">'+escHtml(o.title)+'</strong>'
            +'<span style="white-space:nowrap"><strong>'+eur(o.amount)+'</strong> <span style="color:var(--muted);font-size:.75rem">'+o.probability+'%</span></span></div>'
            +'<div style="display:flex;align-items:center;gap:.4rem;margin-top:.3rem">'
            +'<span class="badge b-blue">'+escHtml(o.stage_label||o.stage)+'</span>'
            +'<span style="font-size:.8rem;color:'+(due?'var(--accent)':'var(--muted)')+'">'
            +(due?'<i class="ti ti-bell"></i> ':'<i class="ti ti-clock"></i> ')+escHtml((p&&p.motivo)||'Al día')+'</span></div></a>';
        }).join('');
        const evs=(tl||[]).slice(0,15).map(function(e){
          const date=String(e.ts||'').slice(0,10);
          const t=e.href?'<a href="'+e.href+'" target="_blank" style="color:inherit">'+escHtml(e.title)+'</a>':escHtml(e.title);
          return '<div style="display:flex;gap:.6rem;padding:.5rem 0;border-bottom:1px solid var(--border)">'
            +'<i class="ti '+(e.icon||'ti-point')+'" style="color:var(--muted);margin-top:.15rem"></i>'
            +'<div style="flex:1"><div style="font-size:.85rem">'+t+'</div>'
            +(e.detail?'<div style="color:var(--muted);font-size:.78rem">'+escHtml(e.detail)+'</div>':'')+'</div>'
            +'<span style="color:var(--muted);font-size:.75rem;white-space:nowrap">'+date+'</span></div>';
        }).join('');
        const timeline=evs
          ? ('<h5 style="margin:1rem 0 .25rem;font-size:.82rem;color:var(--muted)">Línea de tiempo</h5>'+evs
             +(tl.length>15?'<div style="text-align:center;padding:.5rem"><a href="/admin/crm" style="font-size:.8rem">Ver todo en Oportunidades</a></div>':''))
          : (sum.abiertas.length?'':'<div style="color:var(--muted);font-size:.85rem">Aún no hay actividad comercial con este cliente. Ábrele una oportunidad cuando te pida precio.</div>');
        box.innerHTML=head+resumen+opps+timeline;
      }
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
    const cli = db.prepare('SELECT c.*, g.name AS group_name FROM clients c LEFT JOIN client_groups g ON c.group_id=g.id WHERE c.id=?').get(c.req.param('id'));
    if (!cli) return c.html(adminLayout('Cliente', '<div class="card"><p>Ese cliente no existe o se archivó. <a href="/admin/clients">Volver a Clientes</a></p></div>', 'clients', c.get('session')?.csrfToken || '', c), 404);
    const content = `
    <style>
      .f360-cifras{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.75rem;margin-bottom:1rem}
      .f360-c{background:var(--bg2);border:1px solid var(--border2);border-radius:12px;padding:.7rem .85rem}
      .f360-c .k{font-size:.7rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text3);margin-bottom:.25rem}
      .f360-c .v{font-size:1.15rem;font-weight:700;letter-spacing:-.01em;color:var(--text)}
      .f360-c .v.na{color:var(--text3);font-weight:600}
      .f360-c .s{font-size:.72rem;color:var(--text2);margin-top:.15rem}
      .f360-cont{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1.25rem}
      .f360-cont a{display:flex;align-items:center;gap:.45rem;border:1px solid var(--border2);border-radius:10px;padding:.45rem .7rem;text-decoration:none;color:var(--text2);background:var(--bg2);font-size:.83rem}
      .f360-cont a:hover{border-color:var(--accent);color:var(--accent)}
      .f360-cont a .n{font-weight:700;color:var(--text)}
      .f360-cont a.cero{color:var(--text3)}
      .f360-cont a.cero .n{color:var(--text3)}
      .f360-tabs{display:flex;gap:.3rem;flex-wrap:wrap;margin-bottom:.75rem}
      .f360-tabs button{appearance:none;border:1px solid var(--border2);background:var(--bg2);color:var(--text2);font-family:inherit;font-size:.78rem;padding:.25rem .6rem;border-radius:999px;cursor:pointer}
      .f360-tabs button[aria-pressed="true"]{background:var(--accent-soft);border-color:var(--accent);color:var(--accent);font-weight:600}
      .f360-ev{display:flex;gap:.65rem;padding:.6rem 0;border-bottom:1px solid var(--border)}
      .f360-ev i.ti{color:var(--text3);margin-top:.15rem;flex-shrink:0}
      .f360-ev .t{font-size:.87rem;color:var(--text)}
      .f360-ev .d{font-size:.78rem;color:var(--text2);margin-top:.1rem}
      .f360-ev .f{font-size:.74rem;color:var(--text3);white-space:nowrap;margin-left:auto}
      .f360-nota{border:1px solid var(--border2);border-radius:10px;padding:.6rem .75rem;margin-bottom:.5rem;background:var(--bg2)}
      .f360-nota .meta{font-size:.72rem;color:var(--text3);margin-top:.3rem}
      .f360-disa{border-left:3px solid var(--accent);background:var(--accent-soft);border-radius:0 8px 8px 0;padding:.55rem .75rem;margin-bottom:.5rem}
      @media(max-width:480px){ .f360-cifras{grid-template-columns:repeat(2,1fr)} }
    </style>
    <div class="ph">
      <div>
        <div style="font-size:.75rem;color:var(--text3)"><a href="/admin/clients" style="color:inherit">Clientes</a> ›</div>
        <h2 style="margin:0">${escHtml(cli.name)}</h2>
      </div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
        <a class="btn btn-secondary btn-sm" href="/admin/clients">← Volver</a>
      </div>
    </div>
    <div id="f360cifras" class="f360-cifras"><div class="skel skel-block"></div></div>
    <div id="f360cont" class="f360-cont"></div>
    <div id="f360disa"></div>
    <div class="grid g2" style="align-items:start;gap:1rem">
      <div class="card">
        <h4 style="margin-top:0">Su historia</h4>
        <div id="f360tabs" class="f360-tabs"></div>
        <div id="f360tl">Cargando…</div>
        <div style="text-align:center;padding:.6rem"><button class="btn btn-secondary btn-sm" id="f360mas" style="display:none" onclick="tlMas()">Ver más</button></div>
      </div>
      <div>
        <div class="card">
          <h4 style="margin-top:0">Qué te compra</h4>
          <div id="f360compra">Cargando…</div>
        </div>
        <div class="card">
          <h4 style="margin-top:0">Notas</h4>
          <div id="f360notaFija"></div>
          <textarea class="form-control" id="f360nueva" rows="2" maxlength="4000" placeholder="Escribe una nota…"></textarea>
          <button class="btn btn-primary btn-sm" style="margin-top:.4rem" onclick="notaGuardar()">Añadir nota</button>
          <div id="f360notas" style="margin-top:.75rem"></div>
        </div>
      </div>
    </div>
    <script>
    var CID=${cli.id}, SYM=${JSON.stringify(sym)}, D=null, TIPO='', DESDE=0;
    var TIPO_LBL={documento:'Documentos',cobro:'Cobros',cita:'Citas',oportunidad:'Oportunidades',actividad:'Actividad',proyecto:'Proyectos',tiempo:'Horas',aviso:'Avisos',nota:'Notas'};
    var eur=function(n){ return SYM+Number(n||0).toFixed(2); };
    // «—» y NUNCA 0: un cero inventado en una ficha se cree; un hueco se pregunta.
    function celda(k,v,s,na){ return '<div class="f360-c"><div class="k">'+escHtml(k)+'</div><div class="v'+(na?' na':'')+'">'+v+'</div>'+(s?'<div class="s">'+s+'</div>':'')+'</div>'; }
    function pintaCifras(){
      var c=D.cabecera, h=[];
      if(c.desde.fecha) h.push(celda('Cliente desde', c.desde.fecha, c.desde.alta?'de alta desde '+c.desde.alta:''));
      else h.push(celda('Cliente desde','Aún no te ha comprado', c.desde.alta?'de alta desde '+c.desde.alta:'',true));
      h.push(c.ultima ? celda('Última vez que vino', c.ultima.fecha, c.ultima.dias===0?'hoy':'hace '+c.ultima.dias+' días')
                      : celda('Última vez que vino','—','todavía no ha venido',true));
      if(c.ritmo) h.push(c.ritmo.ritmo_dias!=null
        ? celda('Cada cuánto viene','cada '+c.ritmo.ritmo_dias+' días', c.ritmo.visitas+' visitas')
        : celda('Cada cuánto viene','—', c.ritmo.motivo||'', true));
      if(c.gasto){
        h.push(celda('Gasto total', eur(c.gasto.total), c.gasto.facturas+' factura'+(c.gasto.facturas===1?'':'s')+' · sin IVA'));
        h.push(celda('En los últimos 12 meses', eur(c.gasto.doce_meses), 'sin IVA'));
        h.push(c.ticket_medio!=null ? celda('Ticket medio', eur(c.ticket_medio),'') : celda('Ticket medio','—','aún no hay facturas',true));
        h.push(celda('Te debe', eur(c.deuda.total), c.deuda.oldest?'la más antigua: '+c.deuda.oldest.invoice_number:'sin deuda pendiente'));
        h.push(!c.margen ? celda('Margen que deja','—','no se puede calcular',true)
          : c.margen.sinCoste ? celda('Margen que deja','—','sus líneas no tienen coste conocido',true)
          : celda('Margen que deja', eur(c.margen.beneficio), c.margen.pct!=null?Number(c.margen.pct).toFixed(1)+'%':''));
      }
      document.getElementById('f360cifras').innerHTML=h.join('');
      // Contadores: con 0 se enseñan igual, en gris. Un 0 es información.
      document.getElementById('f360cont').innerHTML=(D.contadores||[]).map(function(x){
        var v = x.key==='deuda' ? eur(x.eur) : x.n;
        var cero = x.key==='deuda' ? !(x.eur>0) : !x.n;
        return '<a class="'+(cero?'cero':'')+'" href="'+x.href+'"><i class="ti '+x.icon+'"></i>'+escHtml(x.etiqueta)+' <span class="n">'+v+'</span></a>';
      }).join('');
      // Lo que DISA ve de él: los MISMOS avisos que en el vigía, con su decisión propuesta.
      var d=D.disa;
      document.getElementById('f360disa').innerHTML = (d&&d.length)
        ? '<div class="card" style="margin-bottom:1rem"><h4 style="margin-top:0">Lo que DISA ve de este cliente</h4>'
          + d.map(function(a){ return '<div class="f360-disa"><strong>'+escHtml(a.etiqueta)+'</strong><div style="font-size:.85rem">'+escHtml(a.titulo||'')+'</div>'
            +(a.detalle?'<div style="font-size:.8rem;color:var(--text2)">'+escHtml(a.detalle)+'</div>':'')
            +'</div>'; }).join('')
          + '<a href="/admin/vigia" style="font-size:.8rem">Ver todo en el vigía →</a></div>'
        : '';
      var q=D.compra;
      document.getElementById('f360compra').innerHTML = q==null
        ? '<div style="color:var(--text3);font-size:.85rem">—</div>'
        : (q.length ? '<table style="width:100%;font-size:.84rem"><tbody>'+q.map(function(x){
              return '<tr><td>'+escHtml(x.nombre)+'</td><td style="text-align:right;color:var(--text2)">'+x.veces+'×</td><td style="text-align:right;font-weight:600">'+eur(x.base)+'</td></tr>'; }).join('')+'</tbody></table>'
            : '<div style="color:var(--text3);font-size:.85rem">Todavía no te ha comprado nada en los últimos 12 meses.</div>');
      document.getElementById('f360notaFija').innerHTML = D.cliente.notes
        ? '<div class="alert alert-ok" style="margin-bottom:.6rem">'+escHtml(D.cliente.notes)+'</div>' : '';
    }
    // Sin onclick inline con comillas anidadas: se marca el botón con data-tipo y se escucha una vez.
    // (Las comillas escapadas dentro de un template literal del servidor llegan ya desescapadas al
    //  navegador y parten la cadena — pasa en silencio y se lleva el script entero por delante.)
    function pintaTabs(tipos){
      var h='<button data-tipo="" aria-pressed="'+(TIPO===''?'true':'false')+'">Todo</button>';
      h+=(tipos||[]).map(function(t){ return '<button data-tipo="'+escHtml(t)+'" aria-pressed="'+(TIPO===t?'true':'false')+'">'+escHtml(TIPO_LBL[t]||t)+'</button>'; }).join('');
      document.getElementById('f360tabs').innerHTML=h;
    }
    document.getElementById('f360tabs').addEventListener('click', function(ev){
      var b=ev.target.closest('button[data-tipo]'); if(!b) return;
      tlFiltro(b.getAttribute('data-tipo'));
    });
    function tlFiltro(t){ TIPO=t; DESDE=0; document.getElementById('f360tl').innerHTML=''; tlCargar(); }
    function tlMas(){ tlCargar(); }
    async function tlCargar(){
      var r=await api('GET','/api/erp/clients/'+CID+'/360/timeline?tipo='+encodeURIComponent(TIPO)+'&desde='+DESDE+'&cuantos=25');
      pintaTabs(r.tipos);
      var box=document.getElementById('f360tl');
      if(DESDE===0) box.innerHTML='';                 // la primera página sustituye; las siguientes añaden
      if(DESDE===0 && !r.eventos.length){
        box.innerHTML='<div style="color:var(--text3);font-size:.87rem;padding:.5rem 0">Aquí no hay nada todavía'+(TIPO?' de ese tipo':'')+'. En cuanto le factures, le des cita o le escribas una nota, aparecerá aquí.</div>';
      } else {
        box.innerHTML += r.eventos.map(function(e){
          var f=String(e.ts||'').slice(0,10);
          var t=e.href?'<a href="'+e.href+'" style="color:inherit">'+escHtml(e.title)+'</a>':escHtml(e.title);
          return '<div class="f360-ev"><i class="ti '+(e.icon||'ti-point')+'"></i><div style="flex:1"><div class="t">'+t+'</div>'
            +(e.detail?'<div class="d">'+escHtml(e.detail)+'</div>':'')+'</div><span class="f">'+f+'</span></div>';
        }).join('');
      }
      DESDE+=r.eventos.length;
      document.getElementById('f360mas').style.display=r.hay_mas?'':'none';
    }
    async function notaGuardar(){
      var t=document.getElementById('f360nueva').value.trim(); if(!t){ toast('Escribe algo','err'); return; }
      try{ await api('POST','/api/erp/clients/'+CID+'/notas',{texto:t}); document.getElementById('f360nueva').value=''; toast('Nota guardada'); notasCargar(); tlFiltro(TIPO); }
      catch(e){ toast(e.message,'err'); }
    }
    async function notaEditar(id, actual){
      var t=prompt('Editar la nota:', actual); if(t==null) return;
      try{ await api('PUT','/api/erp/clients/'+CID+'/notas/'+id,{texto:t}); toast('Nota actualizada'); notasCargar(); tlFiltro(TIPO); }
      catch(e){ toast(e.message,'err'); }
    }
    async function notaBorrar(id){
      if(!confirm('¿Quitar esta nota?')) return;
      try{ await api('DELETE','/api/erp/clients/'+CID+'/notas/'+id); toast('Nota quitada'); notasCargar(); tlFiltro(TIPO); }
      catch(e){ toast(e.message,'err'); }
    }
    async function notasCargar(){
      var ns=await api('GET','/api/erp/clients/'+CID+'/notas');
      document.getElementById('f360notas').innerHTML = ns.length ? ns.map(function(n){
        return '<div class="f360-nota"><div style="white-space:pre-wrap;font-size:.86rem">'+escHtml(n.texto)+'</div>'
          +'<div class="meta">'+escHtml(n.user_name||'—')+' · '+String(n.created_at||'').slice(0,16).replace('T',' ')
          +(n.updated_at?' · editada':'')
          +' <a href="#" data-nedit="'+n.id+'">editar</a>'
          +' · <a href="#" data-ndel="'+n.id+'">quitar</a></div></div>'; }).join('')
        : '<div style="color:var(--text3);font-size:.83rem">Sin notas todavía.</div>';
    }
    document.getElementById('f360notas').addEventListener('click', function(ev){
      var e=ev.target.closest('a[data-nedit]'), d=ev.target.closest('a[data-ndel]');
      if(e){ ev.preventDefault(); var caja=e.closest('.f360-nota'); notaEditar(e.getAttribute('data-nedit'), caja.firstChild.textContent); }
      else if(d){ ev.preventDefault(); notaBorrar(d.getAttribute('data-ndel')); }
    });
    (async function(){
      try{ D=await api('GET','/api/erp/clients/'+CID+'/360'); pintaCifras(); }
      catch(e){ document.getElementById('f360cifras').innerHTML='<div class="alert alert-err">'+escHtml(e.message)+'</div>'; }
      tlCargar(); notasCargar();
    })();
    </script>`;
    return c.html(adminLayout(cli.name, content, 'clients', c.get('session')?.csrfToken || '', c));
  });

  views.get('/groups', requirePerm('clients.read'), c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const content = `
      <div class="ph"><h2>Grupos de Clientes</h2><button class="btn btn-primary" onclick="openModal('groupModal')">Nuevo grupo</button></div>
      <div class="card">
        <div class="card-head"><h3>Lista de grupos</h3><input class="search" id="searchBox" placeholder="Buscar..." oninput="renderGroups()"></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Nombre</th><th>Descripción</th><th>Miembros</th><th></th></tr></thead>
          <tbody id="groupBody">${skeletonRows(4)}</tbody>
        </table></div>
      </div>
      <div class="modal-overlay" id="groupModal">
        <div class="modal">
          <div class="modal-head"><h3 id="groupModalTitle">Nuevo Grupo</h3><button class="modal-close" onclick="closeModal('groupModal')">✕</button></div>
          <div class="modal-body">
            <input type="hidden" id="groupId">
            <div class="form-group"><label class="form-label">Nombre *</label><input class="form-control" id="gName"></div>
            <div class="form-group"><label class="form-label">Descripción</label><input class="form-control" id="gDesc"></div>
          </div>
          <div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal('groupModal')">Cancelar</button><button class="btn btn-primary" onclick="saveGroup()">Guardar</button></div>
        </div>
      </div>
      <script>
      let groups=[];
      async function load(){
        groups=await api('GET','/api/erp/clients/groups/all').catch(()=>[]);
        renderGroups();
      }
      function renderGroups(){
        const q=(document.getElementById('searchBox').value||'').toLowerCase();
        const f=q?groups.filter(g=>(g.name||'').toLowerCase().includes(q)||(g.description||'').toLowerCase().includes(q)):groups;
        document.getElementById('groupBody').innerHTML=f.length?f.map(g=>'<tr><td><strong>'+escHtml(g.name)+'</strong></td><td style="color:var(--muted)">'+escHtml(g.description||'-')+'</td><td><span class="badge b-blue">'+g.member_count+'</span></td><td><button class="btn btn-secondary btn-sm" onclick="editGroup('+g.id+')">Editar</button> <button class="btn btn-danger btn-sm" onclick="delGroup('+g.id+')">Eliminar</button></td></tr>').join(''):(q?window.emptyRow(4,'No se encontraron grupos con ese filtro.',{icon:'ti-search'}):window.emptyRow(4,'Aún no has creado grupos. Agrupa clientes para tratarlos juntos.',{cta:'Nuevo grupo',onclick:"openModal('groupModal')"}));
      }
      function editGroup(id){const g=groups.find(x=>x.id===id);if(!g)return;document.getElementById('groupModalTitle').textContent='Editar Grupo';document.getElementById('groupId').value=id;document.getElementById('gName').value=g.name;document.getElementById('gDesc').value=g.description||'';openModal('groupModal');}
      async function saveGroup(){
        const id=document.getElementById('groupId').value;
        const body={name:document.getElementById('gName').value,description:document.getElementById('gDesc').value,discount_pct: id ? ((groups.find(x=>x.id===+id)||{}).discount_pct||0) : 0};
        try{if(id)await api('PUT','/api/erp/clients/groups/'+id,body);else await api('POST','/api/erp/clients/groups/create',body);closeModal('groupModal');document.getElementById('groupId').value='';toast('Guardado');load();}catch(e){toast(e.message,'err')}
      }
      async function delGroup(id){if(!confirm('¿Eliminar?'))return;await api('DELETE','/api/erp/clients/groups/'+id);toast('Eliminado');load();}
      load();
      </script>`;
    return c.html(adminLayout('Grupos de Clientes', content, 'client-groups', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
