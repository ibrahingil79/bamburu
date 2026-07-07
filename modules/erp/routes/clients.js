import { Hono } from 'hono';
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
  const r = db.prepare('INSERT INTO clients (name,fiscal_id,email,phone,address,city,country,group_id,notes,accepts_newsletter,client_type,payment_term_days,payment_method,collections_profile,client_code) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(d.name, d.fiscal_id || '', d.email || '', d.phone || '', d.address || '', d.city || '', d.country || '', d.group_id || null, d.notes || '', d.accepts_newsletter ? 1 : 0, d.client_type || 'particular', d.payment_term_days || 0, d.payment_method || '', d.collections_profile || 'estandar', code);
  syncNewsletter(db, d.email, d.name, d.accepts_newsletter);
  return { id: r.lastInsertRowid, name: d.name, client_code: code };
}

export function updateClientSvc(db, id, input) {
  const exists = db.prepare('SELECT id FROM clients WHERE id=?').get(id);
  if (!exists) { const e = new Error('Cliente no encontrado'); e.status = 404; throw e; }
  const d = parseClient(input);
  if (fiscalIdConflict(db, d.fiscal_id, id)) { const e = new Error('Ya existe un cliente con ese NIF'); e.status = 409; throw e; }
  db.prepare('UPDATE clients SET name=?,fiscal_id=?,email=?,phone=?,address=?,city=?,country=?,group_id=?,notes=?,accepts_newsletter=?,client_type=?,payment_term_days=?,payment_method=?,collections_profile=? WHERE id=?')
    .run(d.name, d.fiscal_id || '', d.email || '', d.phone || '', d.address || '', d.city || '', d.country || '', d.group_id || null, d.notes || '', d.accepts_newsletter ? 1 : 0, d.client_type || 'particular', d.payment_term_days || 0, d.payment_method || '', d.collections_profile || 'estandar', id);
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
    } catch(e) { return c.json({error:e.message},500); }
  });

  // T5 — búsqueda de clientes (JSON). ANTES de '/:id' para que no la capture como id.
  api.get('/search', requirePerm('clients.read'), c => {
    try {
      return c.json(searchClients(db, { q: c.req.query('q') || '', city: c.req.query('city') || '', limit: c.req.query('limit') }));
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.get('/:id', requirePerm('clients.read'), c => {
    try {
      const client = db.prepare('SELECT c.*, g.name as group_name FROM clients c LEFT JOIN client_groups g ON c.group_id=g.id WHERE c.id=?').get(c.req.param('id'));
      if (!client) return c.json({error:'No encontrado'},404);
      // PIEZA C — el historial del cliente son sus FACTURAS (cadena nueva), no los sales_orders viejos.
      // Shape {order_number,total,status,created_at} para que la ficha siga pintando igual.
      client.orders = clientVentas(db, client.id);
      return c.json(client);
    } catch(e) { return c.json({error:e.message},500); }
  });

  // Las 4 escrituras pasan por el SERVICIO compartido (misma validación + guarda de NIF
  // que usa DISA). La ruta solo añade permisos, log con la sesión real y el código HTTP.
  api.post('/', requirePerm('clients.create'), validate(clientSchema), async c => {
    try {
      const r = createClientSvc(db, c.get('validated'));
      logActivity(db, c.get('session'), 'Creó cliente', 'client', r.id, r.name);
      return c.json({id:r.id, message:'Creado'});
    } catch(e) { return c.json({error:e.message}, e.status||500); }
  });

  api.put('/:id', requirePerm('clients.edit'), validate(clientSchema), async c => {
    try {
      const r = updateClientSvc(db, c.req.param('id'), c.get('validated'));
      logActivity(db, c.get('session'), 'Editó cliente', 'client', r.id, r.name);
      return c.json({message:'Actualizado'});
    } catch(e) { return c.json({error:e.message}, e.status||500); }
  });

  api.delete('/:id', requirePerm('clients.edit'), c => {
    try {
      const r = archiveClientSvc(db, c.req.param('id'));
      logActivity(db, c.get('session'), 'Archivó cliente', 'client', r.id, r.name||'');
      return c.json({message:'Archivado'});
    } catch(e) { return c.json({error:e.message}, e.status||500); }
  });

  api.get('/:id/orders', requirePerm('clients.read'), c => {
    try {
      return c.json(clientVentas(db, c.req.param('id')));   // PIEZA C — facturas del cliente (cadena nueva)
    } catch(e) { return c.json({error:e.message},500); }
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
    } catch(e) { return c.json({error:e.message},500); }
  });

  // ── T4 Paso 2.1 — gestión a nivel de CUENTA del cliente ─────────────────────
  // GET resumen de cuenta: deuda total + facturas vivas (priorizadas) + etapa y próxima
  // acción de cuenta (heredadas de la factura más grave). Lo lee el modal "Gestionar cuenta".
  api.get('/:id/account-summary', requirePerm('clients.read'), c => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      return c.json(resumenCuentaCliente(db, parseInt(c.req.param('id')), today));
    } catch(e) { return c.json({error:e.message},500); }
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
      const tpl = accountEmail(tono, { client, company, facturasVivas: resumen.facturasVivas, total: resumen.deudaTotal });
      return c.json({ subject: tpl.subject, text: tpl.text, tono, to: (client && client.email) || '', has_email: !!(client && client.email), total: resumen.deudaTotal, facturas: resumen.facturasVivas.length });
    } catch(e) { return c.json({error:e.message},400); }
  });

  // POST acción de CUENTA — recordatorio (UN email + acción por factura), promesa (todas)
  // o cobro a cuenta (reparto auto/manual → un invoice_payment por factura). Va por el mismo
  // servicio validado que usa DISA. Rechaza facturas no vivas (doble seguro de Paso 1).
  api.post('/:id/account-actions', requirePerm('cobros.manage'), validate(accountActionSchema), async c => {
    try {
      const input = c.get('validated');
      const res = await registerAccountAction(db, parseInt(c.req.param('id')), input, { sendEmail });
      const label = input.type === 'recordatorio_cuenta' ? 'Envió recordatorio de cuenta'
        : input.type === 'promesa_cuenta' ? 'Registró promesa de cuenta' : 'Registró cobro a cuenta';
      logActivity(db, c.get('session'), label, 'client', c.req.param('id'), `${res.facturas || (res.pagos && res.pagos.length) || 0} factura(s) · lote ${res.batch_id}`);
      return c.json(res, 201);
    } catch(e) { return c.json({error:e.message}, e.status || 400); }
  });

  // Restaurar un cliente archivado (inverso de archivar, T1). Guarda: archivar libera
  // el NIF, así que restaurar puede chocar con otro cliente activo que lo tenga — se
  // bloquea reutilizando el helper de NIF único (CANON §5, sin duplicados).
  api.post('/:id/restore', requirePerm('clients.edit'), c => {
    try {
      const r = restoreClientSvc(db, c.req.param('id'));
      logActivity(db, c.get('session'), 'Restauró cliente', 'client', r.id, r.name||'');
      return c.json({message:'Restaurado'});
    } catch(e) { return c.json({error:e.message}, e.status||500); }
  });

  // ── API: CLIENT GROUPS ─────────────────────────────────────────
  api.get('/groups/all', requirePerm('clients.read'), c => {
    try { return c.json(db.prepare('SELECT g.*, COUNT(c.id) as member_count FROM client_groups g LEFT JOIN clients c ON c.group_id=g.id GROUP BY g.id ORDER BY g.name').all()); }
    catch(e) { return c.json({error:e.message},500); }
  });

  api.post('/groups/create', requirePerm('clients.create'), validate(clientGroupSchema), async c => {
    try {
      const d = c.get('validated');
      const r = db.prepare('INSERT INTO client_groups (name,description,discount_pct) VALUES (?,?,?)').run(d.name, d.description||'', d.discount_pct||0);
      return c.json({id:r.lastInsertRowid});
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.put('/groups/:id', requirePerm('clients.edit'), validate(clientGroupSchema), async c => {
    try {
      const d = c.get('validated');
      db.prepare('UPDATE client_groups SET name=?,description=?,discount_pct=? WHERE id=?').run(d.name, d.description||'', d.discount_pct||0, c.req.param('id'));
      return c.json({message:'Actualizado'});
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.delete('/groups/:id', requirePerm('clients.edit'), c => {
    try { db.prepare('DELETE FROM client_groups WHERE id=?').run(c.req.param('id')); return c.json({message:'Eliminado'}); }
    catch(e) { return c.json({error:e.message},500); }
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
          <div class="modal-head"><h3 id="detailName">Detalle Cliente</h3><button class="modal-close" onclick="closeModal('detailModal')">✕</button></div>
          <div class="modal-body" id="detailBody"></div>
        </div>
      </div>

      ${cobroModalHtml()}
      <script>
      ${cobroModalScript(sym)}
      let currentDetailClientId=null;   // cliente abierto en la ficha (para refrescar tras un cobro)
      // Punto de extensión del modal compartido: tras un cobro, refresca la ficha del cliente
      // (su "Te debe X €", deuda más antigua y la tabla de facturas).
      window.cobroOnSaved = function(id){ if(currentDetailClientId) viewDetail(currentDetailClientId); };
      let currentClient=null;   // cliente en edición (conserva accepts_newsletter sin tocar la API)
      function openNewClient(){
        currentClient=null;
        document.getElementById('clientModalTitle').textContent='Nuevo Cliente';
        document.getElementById('clientId').value='';
        ['cName','cFiscal','cEmail','cPhone','cAddress','cCity','cCountry','cNotes'].forEach(id=>document.getElementById(id).value='');
        document.getElementById('cGroup').value='';
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
        document.getElementById('cGroup').value=c.group_id||'';
        document.getElementById('cNotes').value=c.notes||'';
        document.getElementById('cType').value=c.client_type||'particular';
        document.getElementById('cTermDays').value=Number(c.payment_term_days||0);
        document.getElementById('cPayMethod').value=c.payment_method||'';
        document.getElementById('cProfile').value=c.collections_profile||'estandar';
        openModal('clientModal');
      }
      async function saveClient(){
        const id=document.getElementById('clientId').value;
        const body={name:document.getElementById('cName').value,fiscal_id:document.getElementById('cFiscal').value,email:document.getElementById('cEmail').value,phone:document.getElementById('cPhone').value,address:document.getElementById('cAddress').value,city:document.getElementById('cCity').value,country:document.getElementById('cCountry').value,group_id:document.getElementById('cGroup').value||null,notes:document.getElementById('cNotes').value,accepts_newsletter: id ? !!(currentClient&&currentClient.accepts_newsletter) : false,client_type:document.getElementById('cType').value,payment_term_days:parseInt(document.getElementById('cTermDays').value)||0,payment_method:document.getElementById('cPayMethod').value,collections_profile:document.getElementById('cProfile').value};
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
          return '<tr><td><a href="/admin/invoices/'+f.id+'" target="_blank">'+f.invoice_number+'</a></td>'+
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
          (o?' · Deuda más antigua: <a href="/admin/invoices/'+o.invoice_id+'" target="_blank">'+o.invoice_number+'</a> (${sym}'+Number(o.pendiente||0).toFixed(2)+', vence '+(o.due_date||'-')+(o.dias_vencida>0?' · '+o.dias_vencida+' días vencida':'')+')':' · sin deuda pendiente')+
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
          (c.notes?'<div class="alert alert-ok" style="margin-bottom:1rem">'+c.notes+'</div>':'')+
          '<h4 style="margin-bottom:.75rem">Facturas y cobro</h4>'+
          debtBlock+
          '<div class="table-wrap" style="margin-bottom:1.25rem"><table><thead><tr><th>Factura</th><th>Vence</th><th>Total</th><th>Pendiente</th><th>Cobro</th><th>Próxima acción</th><th></th></tr></thead><tbody>'+invRows+'</tbody></table></div>'+
          '<h4 style="margin-bottom:.75rem">Historial de pedidos</h4>'+
          '<div class="table-wrap"><table><thead><tr><th>Orden</th><th>Total</th><th>Estado</th><th>Fecha</th></tr></thead><tbody>'+ordRows+'</tbody></table></div>';
        openModal('detailModal');
      }
      // U6 · Onboarding: al llegar con ?nuevo=1 (enlace "Vamos →" del checklist de Inicio) se abre
      // directo el alta de cliente. Limpia la query para que un refresco no lo reabra. Solo UI.
      if (new URLSearchParams(location.search).get('nuevo') === '1') {
        try { history.replaceState(null, '', '/admin/clients'); } catch(e){}
        openNewClient();
      }
      </script>`;
    return c.html(adminLayout('Clientes', content, 'clients', c.get('session')?.csrfToken || '', c));
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
        document.getElementById('groupBody').innerHTML=f.length?f.map(g=>'<tr><td><strong>'+g.name+'</strong></td><td style="color:var(--muted)">'+(g.description||'-')+'</td><td><span class="badge b-blue">'+g.member_count+'</span></td><td><button class="btn btn-secondary btn-sm" onclick="editGroup('+g.id+')">Editar</button> <button class="btn btn-danger btn-sm" onclick="delGroup('+g.id+')">Eliminar</button></td></tr>').join(''):(q?window.emptyRow(4,'No se encontraron grupos con ese filtro.',{icon:'ti-search'}):window.emptyRow(4,'Aún no has creado grupos. Agrupa clientes para tratarlos juntos.',{cta:'Nuevo grupo',onclick:"openModal('groupModal')"}));
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
