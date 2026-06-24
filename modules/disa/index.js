import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { adminAuth, getCsrfToken, requirePerm } from '../../core/auth.js';
import { adminLayout } from '../erp/layout.js';
import { generateInvoice, anularInvoice, createRectificativa } from '../erp/routes/invoices.js';
import { createClientSvc, updateClientSvc, archiveClientSvc, restoreClientSvc, searchClients } from '../erp/routes/clients.js';
import { clientFieldOptions } from '../erp/schemas.js';
import { nextCode } from '../erp/codes.js';
// Voz de DISA sobre stock/compras (Fase 1): operar por servicio validado + valoración curada.
import { adjustStock, ADJUST_REASONS, reservedOfProduct } from '../erp/stock.js';
import { createStockTransferSvc } from '../erp/routes/stock-transfers.js';
import { activeWarehouses, inventoryValuation } from '../erp/routes/warehouses.js';
import { collectionsWorklist, registerCollectionAction, accountsSummary, registerAccountAction } from '../erp/cobros.js';
import { supplierAccountsSummary } from '../erp/pagos.js';                                  // Paso (d): índice de deuda con proveedores para la voz de DISA
import { registerSupplierAccountPayment } from '../erp/routes/supplier-invoices.js';       // Paso (d): pago a proveedor por voz (reparto a cuenta)
import { marcarVistoYResumir } from '../erp/avisos.js';                                     // Paso (d): resumen-primero del badge (motor de avisos)
import { sendEmail } from '../../core/mailer.js';
import { runCapture, captureFromExtraction } from '../erp/routes/purchases-capture.js';   // pipeline de captura C2 reutilizado (foto/PDF y voz)
import { createProductSvc } from '../erp/routes/products.js';   // alta validada (banda de IVA obligatoria, sin defecto silencioso)
import { getVatBands } from '../../core/vat-bands.js';   // [D5] lista cerrada de bandas legales (misma fuente que el formulario/API)
import { ALLOWED_MIME, MAX_UPLOAD_BYTES } from '../erp/attachments.js';
import { callClaude, hasAnthropicKey } from '../../core/llm.js';   // helper único de IA: clave + transporte centralizados
import { rateLimit } from '../../core/rate-limit.js';   // freno por IP del endpoint caro de DISA

export function register(app, db) {
  const router = new Hono();

  // ── Schema migrations ─────────────────────────────────────
  try { db.prepare('ALTER TABLE disa_conversation_threads ADD COLUMN pinned INTEGER DEFAULT 0').run(); } catch {}

  // ── Helpers ──────────────────────────────────────────────

  function getUsage(db) {
    const month = new Date().toISOString().slice(0, 7);
    const row = db.prepare('SELECT count FROM disa_usage WHERE month=?').get(month);
    return row?.count || 0;
  }

  function incrementUsage(db) {
    const month = new Date().toISOString().slice(0, 7);
    db.prepare(`
      INSERT INTO disa_usage (month, count) VALUES (?, 1)
      ON CONFLICT(month) DO UPDATE SET count = count + 1
    `).run(month);
  }

  function generateThreadTitle(firstMessage) {
    const words = firstMessage.trim().split(/\s+/).slice(0, 7);
    let title = words.join(' ');
    if (title.length > 50) title = title.substring(0, 47) + '...';
    if (firstMessage.split(/\s+/).length > 7) title += '...';
    return title || 'Nueva conversación';
  }

  function getOrCreateActiveThread(db, userId) {
    let thread = db.prepare(
      'SELECT * FROM disa_conversation_threads WHERE is_active=1 AND user_id=? ORDER BY updated_at DESC LIMIT 1'
    ).get(userId || null);
    if (!thread) {
      const r = db.prepare('INSERT INTO disa_conversation_threads (user_id) VALUES (?)').run(userId || null);
      thread = db.prepare('SELECT * FROM disa_conversation_threads WHERE id=?').get(r.lastInsertRowid);
    }
    return thread;
  }

  function getConversationForThread(db, threadId) {
    let conv = db.prepare(
      'SELECT * FROM disa_conversations WHERE thread_id=? ORDER BY id DESC LIMIT 1'
    ).get(threadId);
    if (!conv) {
      const r = db.prepare('INSERT INTO disa_conversations (messages, thread_id) VALUES (?, ?)').run('[]', threadId);
      conv = db.prepare('SELECT * FROM disa_conversations WHERE id=?').get(r.lastInsertRowid);
    }
    return conv;
  }

  function getProfile(db) {
    return db.prepare('SELECT * FROM disa_profile WHERE id=1').get() || {};
  }

  function updateProfile(db, updates) {
    const fields = Object.keys(updates).map(k => k + '=?').join(',');
    db.prepare(
      'UPDATE disa_profile SET ' + fields + ', updated_at=CURRENT_TIMESTAMP WHERE id=1'
    ).run(...Object.values(updates));
  }

  function logActivity(db, action, entity, entityId, details, session) {
    try {
      db.prepare(`
        INSERT INTO activity_logs (user_id, user_name, action, entity, entity_id, details)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(session?.userId || null, session?.userName || 'DISA', action, entity, entityId, details);
    } catch {}
  }

  // T5 — 'clients' SALE de aquí a propósito: DISA no puede escribir clientes con el
  // genérico insert_record/update_record (eludiría validación y guarda de NIF). Los
  // clientes SOLO por create_client/edit_client/deactivate_client/activate_client,
  // que pasan por el servicio validado compartido.
  // C2 — 'purchases'/'purchase_items' SALEN igual: una compra mueve stock y fija coste
  // por el libro (recordMovement → WAC). Escribirlas con el genérico insert_record
  // dejaría stock/coste sin tocar (incoherencia). El camino de DISA para compras será
  // la captura de factura (C2, pantalla + servicios validados), no el INSERT genérico.
  // Devoluciones — 'supplier_returns'/'supplier_return_items' tampoco están en el
  // whitelist (= NO escribibles por el genérico): una devolución mueve stock por el
  // libro y es documento inmutable con numeración. La voz de DISA sobre stock/compras
  // es tarea futura; por ahora DISA no crea devoluciones.
  // Ventas/Pilar 4 — 'quotes'/'quote_items'/'document_links' + 'customer_orders'/
  // 'customer_order_items' (PIEZA 2a, pedido + reserva) + 'delivery_notes'/'delivery_note_items'
  // (PIEZA 2b, albarán/entrega: saca stock real del libro) FUERA del whitelist (igual que
  // compras/sales_orders): son documentos con ciclo, numeración, reserva y movimiento de stock
  // por servicio validado. DISA es SOLO LECTURA sobre pedidos Y albaranes (responde "cuánto
  // tengo"/"qué falta por entregar"); crear/confirmar/anular por voz es capa posterior.
  const WRITABLE_TABLES = new Set([
    'categories', 'tags', 'product_tags',
    'products', 'product_variants', 'product_images',
    'client_groups', 'suppliers',
    'sales_orders', 'sales_items',
    // [A3] 'invoices', 'invoice_items' EXCLUIDAS del genérico: son documentos LEGALES INMUTABLES
    // (cadena de hash Verifactu). Reescribir o borrar una factura emitida por insert/update/delete_record
    // rompería la cadena en silencio (la firma solo se calcula al emitir, nunca se revalida al escribir).
    // DISA CREA facturas por create_invoice_from_order (con hash correcto) y ANULA/RECTIFICA por las
    // acciones legales anular_invoice / create_rectificativa (servicios validados de invoices.js).
    // 'inventory_movements',  // [Voz DISA stock] ENTRADA MUERTA: la tabla se archivó a
    // inventory_movements_legacy en Pilar 3 (stock unificado); el stock se mueve por el
    // libro stock_movements vía servicios validados (adjust_stock/transfer_stock), nunca por
    // el genérico. Se comenta (no se borra) para no permitir escrituras a una tabla inexistente.
    'discount_codes', 'auto_discounts',
    'shipping_methods',
    'company_config', 'settings', 'store_settings', 'disa_profile',
  ]);

  const SECURITY_ACTIONS = new Set(['disable_2fa_user']);

  // Acciones de HANDOFF: no se confirman de palabra en el chat (no mueven nada por sí solas),
  // solo preparan un payload y enrutan a una pantalla donde está el control visual y el confirm
  // REAL. Se ejecutan en cuanto se detecta la acción (sin el "¿confirmas?" del chat).
  const HANDOFF_ACTIONS = new Set(['dictar_compra']);

  const ADMIN_ONLY_ACTIONS = new Set([
    'insert_record', 'update_record', 'delete_record',
    'create_order', 'edit_order', 'update_order_status', 'cancel_order',
    'create_invoice_from_order', 'anular_invoice', 'create_rectificativa', 'adjust_stock', 'reset_stock', 'transfer_stock',
    'update_company_config', 'disable_2fa_user', 'list_users_security',
    'register_collection_action', 'register_account_action',
    'register_supplier_payment',
    'create_client', 'edit_client', 'deactivate_client', 'activate_client',
    'create_product', 'edit_product', 'delete_product', 'deactivate_product', 'activate_product',
    'dictar_compra',
  ]);

  function isAdminUser(session) {
    return session?.role === 'owner' || session?.role === 'admin';
  }

  function isValidColumnName(col) {
    if (typeof col !== 'string') return false;
    if (col.length === 0 || col.length > 64) return false;
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col);
  }

  function getDbSchema(db) {
    const excluded = new Set([
      'admin_users', 'admin_sessions', 'sqlite_sequence',
      'disa_conversations', 'disa_usage', 'activity_logs',
      'customer_accounts', 'customer_sessions', 'invoice_sequences',
      'feedback', 'wishlist', 'product_reviews', 'newsletter_subscribers',
    ]);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    return tables
      .filter(t => !excluded.has(t.name))
      .map(t => {
        const cols = db.prepare('PRAGMA table_info(' + t.name + ')').all();
        return t.name + ': ' + cols.map(c => c.name + (c.notnull && !c.dflt_value ? '*' : '')).join(', ');
      })
      .join('\n');
  }

  // [Voz DISA stock] Extrae el bloque [ACCION:{...}] EQUILIBRANDO LLAVES. El regex no-greedy
  // anterior (\{[\s\S]*?\}) partía un JSON anidado en el primer "}]" interno → rompía acciones
  // con arrays como transfer_stock {"items":[{...}]} (las planas no lo notaban). Devuelve el
  // objeto y el texto completo del bloque (para retirarlo). Si el JSON viene truncado, null.
  function extractActionBlock(reply) {
    const tag = reply.indexOf('[ACCION:');
    if (tag === -1) return null;
    const open = reply.indexOf('{', tag);
    if (open === -1) return null;
    let depth = 0, inStr = false, esc = false, close = -1;
    for (let i = open; i < reply.length; i++) {
      const ch = reply[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') { if (--depth === 0) { close = i; break; } }
    }
    if (close === -1) return null;
    let end = close + 1;
    while (end < reply.length && /\s/.test(reply[end])) end++;
    if (reply[end] !== ']') return null;
    let action;
    try { action = JSON.parse(reply.slice(open, close + 1)); } catch { return null; }
    return { action, raw: reply.slice(tag, end + 1) };
  }

  async function executeAction(db, action, session) {
    try {
      switch (action.type) {

        // ── Operaciones genéricas (cualquier tabla) ──────────

        case 'insert_record': {
          const { table, data } = action.params || {};
          if (!table || !WRITABLE_TABLES.has(table))
            return { ok: false, message: 'Tabla no permitida: ' + table };
          if (!data || typeof data !== 'object' || Object.keys(data).length === 0)
            return { ok: false, message: 'Se requiere data con al menos un campo.' };
          // [Banda de IVA — D5] Un producto NO puede nacer por el INSERT genérico: caería en el
          // DEFAULT 'general'/21 de la columna SIN banda elegida (o con banda↔% incoherente). Se
          // enruta al MISMO servicio validado que la pantalla y la acción create_product
          // (createProductSvc: banda obligatoria de la lista cerrada del país; el % lo deriva el
          // servidor). Mismo principio que 'clients' (T5) y 'purchases' (C2): la tabla fiscal no
          // se escribe a pelo por el genérico. SKU autogenerado si falta (igual que create_product).
          if (table === 'products') {
            const band = data.tax_band || data.banda_iva || data.iva_banda;
            if (!band) return { ok: false, message: 'Para crear el producto necesito su banda de IVA explícita: general (21%), reducido (10%), superreducido (4%) o exento (0%). ¿Cuál le corresponde?' };
            const pSku = data.sku || ('DISA-' + String(data.name || 'prod').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '-' + Date.now());
            try {
              const r = createProductSvc(db, { ...data, sku: pSku, tax_band: band });
              logActivity(db, 'create', 'products', r.id, 'Producto "' + r.name + '" creado por DISA', session);
              return { ok: true, message: 'Producto "' + (r.name || 'nuevo') + '" creado (banda ' + r.tax_band + ').' };
            } catch (e) {
              return { ok: false, message: 'No se pudo crear el producto: ' + (e.message || 'datos inválidos') + '.' };
            }
          }
          const colNames = Object.keys(data);
          const invalidCols = colNames.filter(c => !isValidColumnName(c));
          if (invalidCols.length > 0)
            return { ok: false, message: 'Nombre de columna inválido: ' + invalidCols.join(', ') };
          const cols = colNames.join(', ');
          const placeholders = colNames.map(() => '?').join(', ');
          const res = db.prepare('INSERT INTO ' + table + ' (' + cols + ') VALUES (' + placeholders + ')')
            .run(...Object.values(data));
          logActivity(db, 'create', table, res.lastInsertRowid, 'Creado por DISA', session);
          return { ok: true, message: 'Registro creado en ' + table + ' (id: ' + res.lastInsertRowid + ').' };
        }

        case 'update_record': {
          const { table, id, data } = action.params || {};
          if (!table || !WRITABLE_TABLES.has(table))
            return { ok: false, message: 'Tabla no permitida: ' + table };
          if (!id) return { ok: false, message: 'Se requiere id.' };
          if (!data || Object.keys(data).length === 0)
            return { ok: false, message: 'Se requiere data con al menos un campo.' };
          const colNames = Object.keys(data);
          const invalidCols = colNames.filter(c => !isValidColumnName(c));
          if (invalidCols.length > 0)
            return { ok: false, message: 'Nombre de columna inválido: ' + invalidCols.join(', ') };
          const fields = colNames.map(k => k + '=?').join(', ');
          const info = db.prepare('UPDATE ' + table + ' SET ' + fields + ' WHERE id=?')
            .run(...Object.values(data), id);
          if (info.changes === 0) return { ok: false, message: 'No se encontró el registro con id ' + id + ' en ' + table + '.' };
          logActivity(db, 'edit', table, id, 'Editado por DISA', session);
          return { ok: true, message: 'Registro ' + id + ' en ' + table + ' actualizado.' };
        }

        case 'delete_record': {
          const { table, id } = action.params || {};
          if (!table || !WRITABLE_TABLES.has(table))
            return { ok: false, message: 'Tabla no permitida: ' + table };
          if (!id) return { ok: false, message: 'Se requiere id.' };
          const info = db.prepare('DELETE FROM ' + table + ' WHERE id=?').run(id);
          if (info.changes === 0) return { ok: false, message: 'No se encontró el registro con id ' + id + ' en ' + table + '.' };
          logActivity(db, 'delete', table, id, 'Eliminado por DISA', session);
          return { ok: true, message: 'Registro ' + id + ' eliminado de ' + table + '.' };
        }

        // ── Descuentos ──────────────────────────────────────

        case 'create_discount': {
          const p = action.params;
          const r = db.prepare(`
            INSERT INTO discount_codes (code, type, value, min_order, active)
            VALUES (?, ?, ?, ?, 1)
          `).run(
            p.name || 'DISA-' + Date.now(),
            p.type || 'percentage',
            Number(p.value) || 10,
            Number(p.min_order) || 0
          );
          logActivity(db, 'create', 'discount_codes', r.lastInsertRowid,
            'Descuento creado por DISA: ' + p.name, session);
          return { ok: true, message: 'Descuento "' + (p.name || 'DISA-' + r.lastInsertRowid) + '" creado.' };
        }

        case 'delete_discount': {
          const p = action.params;
          const r = db.prepare('UPDATE discount_codes SET active=0 WHERE code=?').run(p.code);
          if (r.changes === 0) return { ok: false, message: 'Descuento "' + p.code + '" no encontrado.' };
          logActivity(db, 'delete', 'discount_codes', 0, 'Descuento desactivado por DISA: ' + p.code, session);
          return { ok: true, message: 'Descuento "' + p.code + '" desactivado.' };
        }

        case 'edit_discount': {
          const p = action.params;
          const disc = db.prepare('SELECT * FROM discount_codes WHERE code=?').get(p.code);
          if (!disc) return { ok: false, message: 'Descuento "' + p.code + '" no encontrado.' };
          db.prepare(`
            UPDATE discount_codes SET
              value=?, type=?, min_order=?, active=?
            WHERE code=?
          `).run(
            p.value !== undefined ? Number(p.value) : disc.value,
            p.type !== undefined ? p.type : disc.type,
            p.min_order !== undefined ? Number(p.min_order) : disc.min_order,
            p.active !== undefined ? (p.active ? 1 : 0) : disc.active,
            p.code
          );
          logActivity(db, 'edit', 'discount_codes', disc.id, 'Descuento editado por DISA: ' + p.code, session);
          return { ok: true, message: 'Descuento "' + p.code + '" actualizado.' };
        }

        // ── Pedidos ──────────────────────────────────────────

        case 'create_order': {
          const p = action.params;
          // T5 — sin cliente identificado NO se crea el pedido (cero pedidos huérfanos).
          const client = p.client_id ? db.prepare('SELECT id, name FROM clients WHERE id=? AND active=1').get(p.client_id) : null;
          if (!client) return { ok: false, message: 'Identifica primero al cliente (client_id de un cliente activo) antes de crear el pedido.' };
          const product = p.product_id
            ? db.prepare('SELECT * FROM products WHERE id=?').get(p.product_id)
            : db.prepare("SELECT * FROM products WHERE LOWER(name) LIKE ? AND status='active' LIMIT 1")
                .get('%' + (p.product_name || '').toLowerCase() + '%');
          if (!product) return { ok: false, message: 'Producto no encontrado.' };

          const qty = Number(p.quantity) || 1;
          const price = p.price != null ? Number(p.price) : product.price;
          const cfg = db.prepare('SELECT tax_rate, currency_symbol FROM company_config WHERE id=1').get() || {};
          const taxRate = cfg.tax_rate || 21;
          const subtotal = price * qty;
          const taxAmount = subtotal * (taxRate / 100);
          const total = subtotal + taxAmount;

          const tx = db.transaction(() => {
            const orderNumber = 'DISA-' + Math.random().toString(36).substr(2, 9).toUpperCase();
            const r = db.prepare(`
              INSERT INTO sales_orders
                (order_number, client_id, status, subtotal, tax_amount, total, admin_notes)
              VALUES (?, ?, 'completado', ?, ?, ?, ?)
            `).run(orderNumber, client.id, subtotal, taxAmount, total, p.notes || 'Creado por DISA');
            const orderId = r.lastInsertRowid;
            db.prepare(`
              INSERT INTO sales_items (order_id, product_id, product_name, quantity, unit_price, total)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(orderId, product.id, product.name, qty, price, price * qty);
            db.prepare('UPDATE products SET stock = stock - ? WHERE id=?').run(qty, product.id);
            logActivity(db, 'create', 'sales_orders', orderId,
              'Pedido ' + orderNumber + ' creado por DISA', session);
            return { orderId, orderNumber };
          });

          const { orderNumber } = tx();
          const sym = cfg.currency_symbol || '€';
          return { ok: true, message: 'Pedido ' + orderNumber + ' creado para ' + client.name + ': ' +
            qty + 'x ' + product.name + ' por ' + sym + total.toFixed(2) + '.' };
        }

        case 'update_order_status': {
          const p = action.params;
          const order = db.prepare('SELECT status FROM sales_orders WHERE id=?').get(p.order_id);
          if (!order) return { ok: false, message: 'Pedido no encontrado.' };
          db.prepare('UPDATE sales_orders SET status=? WHERE id=?').run(p.status, p.order_id);
          db.prepare(`
            INSERT INTO order_status_history (order_id, status, comment, user_name)
            VALUES (?, ?, ?, ?)
          `).run(p.order_id, p.status, 'Actualizado por DISA', session?.userName || 'DISA');
          logActivity(db, 'edit', 'sales_orders', p.order_id,
            'Estado cambiado a ' + p.status + ' por DISA', session);
          return { ok: true, message: 'Pedido #' + p.order_id + ' actualizado a "' + p.status + '".' };
        }

        case 'cancel_order': {
          const p = action.params;
          const order = db.prepare('SELECT status FROM sales_orders WHERE id=?').get(p.order_id);
          if (!order) return { ok: false, message: 'Pedido no encontrado.' };
          if (order.status === 'cancelado') return { ok: false, message: 'El pedido ya estaba cancelado.' };
          db.prepare('UPDATE sales_orders SET status=? WHERE id=?').run('cancelado', p.order_id);
          db.prepare(`
            INSERT INTO order_status_history (order_id, status, comment, user_name)
            VALUES (?, ?, ?, ?)
          `).run(p.order_id, 'cancelado', p.reason || 'Cancelado por DISA', session?.userName || 'DISA');
          logActivity(db, 'delete', 'sales_orders', p.order_id, 'Pedido cancelado por DISA', session);
          return { ok: true, message: 'Pedido #' + p.order_id + ' cancelado.' };
        }

        case 'edit_order': {
          const p = action.params;
          const order = db.prepare('SELECT * FROM sales_orders WHERE id=?').get(p.order_id);
          if (!order) return { ok: false, message: 'Pedido no encontrado.' };
          db.prepare(`
            UPDATE sales_orders SET
              admin_notes=?, tracking_number=?
            WHERE id=?
          `).run(
            p.admin_notes !== undefined ? p.admin_notes : order.admin_notes,
            p.tracking_number !== undefined ? p.tracking_number : order.tracking_number,
            p.order_id
          );
          logActivity(db, 'edit', 'sales_orders', p.order_id, 'Pedido editado por DISA', session);
          return { ok: true, message: 'Pedido #' + p.order_id + ' actualizado.' };
        }

        case 'create_invoice_from_order': {
          // A2: delega en generateInvoice de invoices.js para que la factura quede
          // con verifactu_hash y prev_hash correctos (antes DISA escribía sin hash).
          const p = action.params;
          try {
            const res = generateInvoice(db, p.order_id);
            if (res.already) {
              return { ok: false, message: 'El pedido #' + p.order_id + ' ya tiene la factura ' + res.invoice_number + '.' };
            }
            logActivity(db, 'create', 'invoices', res.id,
              'Factura ' + res.invoice_number + ' generada por DISA', session);
            return { ok: true, message: 'Factura ' + res.invoice_number + ' generada para el pedido #' + p.order_id + '.' };
          } catch (e) {
            if (e.message === 'Pedido no encontrado') return { ok: false, message: 'Pedido #' + p.order_id + ' no encontrado.' };
            if (e.message === 'Solo se pueden facturar pedidos completados') return { ok: false, message: 'Solo se pueden facturar pedidos completados.' };
            return { ok: false, message: 'Error al generar la factura: ' + e.message };
          }
        }

        // ── Ciclo de vida legal de la factura (vía VALIDADA, NO el genérico) ──
        // Conectan con los servicios existentes de invoices.js; no reimplementan lógica fiscal.

        case 'anular_invoice': {
          const p = action.params || {};
          const num = String(p.invoice_number || '').trim();
          if (!num) return { ok: false, message: 'Falta el número de la factura a anular.' };
          const inv = db.prepare('SELECT id FROM invoices WHERE invoice_number=?').get(num);
          if (!inv) return { ok: false, message: 'No existe ninguna factura con el número ' + num + '.' };
          try {
            const r = anularInvoice(db, inv.id, p.motivo);
            logActivity(db, 'edit', 'invoices', inv.id, 'Factura ' + r.invoice_number + ' anulada por DISA', session);
            return { ok: true, message: 'Factura ' + r.invoice_number + ' anulada: se creó el asiento de anulación y la original queda intacta (solo cambia su estado a "anulada").' };
          } catch (e) {
            return { ok: false, message: 'No se pudo anular: ' + e.message };
          }
        }

        case 'create_rectificativa': {
          const p = action.params || {};
          const num = String(p.invoice_number || '').trim();
          if (!num) return { ok: false, message: 'Falta el número de la factura original a rectificar.' };
          if (!Array.isArray(p.lines) || p.lines.length === 0)
            return { ok: false, message: 'Faltan las líneas de la rectificativa.' };
          const inv = db.prepare('SELECT id FROM invoices WHERE invoice_number=?').get(num);
          if (!inv) return { ok: false, message: 'No existe ninguna factura con el número ' + num + '.' };
          try {
            const r = createRectificativa(db, {
              original_id: inv.id,
              lines: p.lines,
              rectification_type: p.rectification_type,
              rectification_mode: p.rectification_mode,
              irpf_rate: p.irpf_rate || 0,
              notes: p.notes || '',
              issue_date: p.issue_date,
            });
            logActivity(db, 'create', 'invoices', r.id, 'Rectificativa ' + r.invoice_number + ' de ' + num + ' por DISA', session);
            return { ok: true, message: 'Rectificativa ' + r.invoice_number + ' creada en serie propia, rectifica a ' + num + ' (la original queda marcada como "rectificada").' };
          } catch (e) {
            return { ok: false, message: 'No se pudo crear la rectificativa: ' + e.message };
          }
        }

        // ── Productos ─────────────────────────────────────────

        case 'create_product': {
          const p = action.params;
          // [Banda de IVA — arreglo] Un producto creado por DISA debe nacer con BANDA DE IVA
          // EXPLÍCITA, nunca caer en General/21 por defecto en silencio. Antes hacía un INSERT
          // crudo sin tax_band → caía en el DEFAULT 'general'. Ahora pasa por el MISMO servicio
          // validado que la pantalla (createProductSvc), que exige banda válida del país (400 si no).
          // OLD (defecto silencioso a General/21):
          // const r = db.prepare(`
          //   INSERT INTO products (name, price, stock, status, type, product_code)
          //   VALUES (?, ?, ?, 'active', 'physical', ?)
          // `).run(p.name || '', Number(p.price) || 0, Number(p.stock) || 0, nextCode(db, 'product'));
          // logActivity(db, 'create', 'products', r.lastInsertRowid, 'Producto "' + p.name + '" creado por DISA', session);
          // return { ok: true, message: 'Producto "' + (p.name || 'nuevo') + '" creado.' };
          const band = p.tax_band || p.banda_iva || p.iva_banda;
          if (!band) return { ok: false, message: 'Para crear el producto necesito su banda de IVA explícita: general (21%), reducido (10%), superreducido (4%) o exento (0%). ¿Cuál le corresponde?' };
          // SKU obligatorio en el alta validada: si DISA no lo da, lo generamos (mismo patrón que la captura).
          const pSku = p.sku || ('DISA-' + String(p.name || 'prod').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '-' + Date.now());
          try {
            const r = createProductSvc(db, {
              name: p.name, sku: pSku, price: Number(p.price) || 0,
              stock: Number(p.stock) || 0, type: 'physical', tax_band: band,
            });
            logActivity(db, 'create', 'products', r.id, 'Producto "' + r.name + '" creado por DISA', session);
            return { ok: true, message: 'Producto "' + (r.name || 'nuevo') + '" creado (banda ' + band + ').' };
          } catch (e) {
            return { ok: false, message: 'No se pudo crear el producto: ' + (e.message || 'datos inválidos') + '.' };
          }
        }

        case 'edit_product': {
          const p = action.params;
          const existing = db.prepare('SELECT * FROM products WHERE id=?').get(p.product_id);
          if (!existing) return { ok: false, message: 'Producto no encontrado.' };
          db.prepare(`
            UPDATE products SET name=?, price=?, stock=? WHERE id=?
          `).run(
            p.name !== undefined ? p.name : existing.name,
            p.price !== undefined ? Number(p.price) : existing.price,
            p.stock !== undefined ? Number(p.stock) : existing.stock,
            p.product_id
          );
          logActivity(db, 'edit', 'products', p.product_id, 'Producto editado por DISA', session);
          return { ok: true, message: 'Producto "' + (p.name || existing.name) + '" actualizado.' };
        }

        case 'delete_product': {
          const p = action.params;
          const r = db.prepare("UPDATE products SET status='inactive' WHERE id=?").run(p.product_id);
          if (r.changes === 0) return { ok: false, message: 'Producto no encontrado.' };
          logActivity(db, 'delete', 'products', p.product_id, 'Producto eliminado por DISA', session);
          return { ok: true, message: 'Producto #' + p.product_id + ' eliminado (desactivado).' };
        }

        case 'deactivate_product': {
          const p = action.params;
          const r = db.prepare("UPDATE products SET status='inactive' WHERE id=?").run(p.product_id);
          if (r.changes === 0) return { ok: false, message: 'Producto no encontrado.' };
          return { ok: true, message: 'Producto #' + p.product_id + ' desactivado.' };
        }

        case 'activate_product': {
          const p = action.params;
          const r = db.prepare("UPDATE products SET status='active' WHERE id=?").run(p.product_id);
          if (r.changes === 0) return { ok: false, message: 'Producto no encontrado.' };
          return { ok: true, message: 'Producto #' + p.product_id + ' activado.' };
        }

        case 'create_variant': {
          const p = action.params;
          const product = db.prepare('SELECT id, name FROM products WHERE id=?').get(p.product_id);
          if (!product) return { ok: false, message: 'Producto no encontrado.' };
          const r = db.prepare(`
            INSERT INTO product_variants
              (product_id, name, option1_name, option1_value, sku, price, stock)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            p.product_id,
            p.name || '',
            p.option1_name || '',
            p.option1_value || '',
            p.sku || '',
            p.price != null ? Number(p.price) : null,
            Number(p.stock) || 0
          );
          logActivity(db, 'create', 'product_variants', r.lastInsertRowid,
            'Variante creada por DISA en ' + product.name, session);
          return { ok: true, message: 'Variante "' + (p.name || 'nueva') + '" creada en ' + product.name + '.' };
        }

        case 'edit_variant': {
          const p = action.params;
          const variant = db.prepare('SELECT * FROM product_variants WHERE id=?').get(p.variant_id);
          if (!variant) return { ok: false, message: 'Variante no encontrada.' };
          db.prepare(`
            UPDATE product_variants SET name=?, price=?, stock=?, sku=? WHERE id=?
          `).run(
            p.name !== undefined ? p.name : variant.name,
            p.price !== undefined ? Number(p.price) : variant.price,
            p.stock !== undefined ? Number(p.stock) : variant.stock,
            p.sku !== undefined ? p.sku : variant.sku,
            p.variant_id
          );
          logActivity(db, 'edit', 'product_variants', p.variant_id, 'Variante editada por DISA', session);
          return { ok: true, message: 'Variante #' + p.variant_id + ' actualizada.' };
        }

        case 'delete_variant': {
          const p = action.params;
          const r = db.prepare('DELETE FROM product_variants WHERE id=?').run(p.variant_id);
          if (r.changes === 0) return { ok: false, message: 'Variante no encontrada.' };
          logActivity(db, 'delete', 'product_variants', p.variant_id, 'Variante eliminada por DISA', session);
          return { ok: true, message: 'Variante #' + p.variant_id + ' eliminada.' };
        }

        // ── Inventario ────────────────────────────────────────

        // [Voz DISA stock — reescrito] Ajuste por el SERVICIO VALIDADO adjustStock (mismo que
        // /admin/inventory): opera por almacén, motivo de lista cerrada (ADJUST_REASONS), escribe
        // al libro stock_movements (WAC y caché coherentes). modes: set=poner a X / add=sumar /
        // sub=restar. El servicio impone físico/modo/motivo válidos (400). DISA traduce el error.
        case 'adjust_stock': {
          const p = action.params || {};
          const prod = db.prepare('SELECT name FROM products WHERE id=?').get(p.product_id);
          if (!prod) return { ok: false, message: 'Producto no encontrado.' };
          try {
            const r = adjustStock(db, parseInt(p.product_id), {
              mode: p.mode || 'set',
              value: p.value,
              reason: p.reason,
              note: p.note || 'Ajuste por DISA',
              warehouse_id: p.warehouse_id,
            });
            const wh = db.prepare('SELECT name FROM warehouses WHERE id=?').get(r.warehouse_id);
            logActivity(db, 'edit', 'products', p.product_id,
              'Stock ajustado por DISA (' + (p.mode || 'set') + ' ' + p.value + ', ' + p.reason + ')', session);
            return { ok: true, message: 'Stock de "' + prod.name + '" ajustado en ' + (wh?.name || 'el almacén')
              + '. Nuevo saldo: ' + r.stock + ' uds.' };
          } catch (e) {
            return { ok: false, message: 'No se pudo ajustar el stock: ' + e.message };
          }
        }

        // [Voz DISA stock — reescrito] Traslado entre almacenes por el SERVICIO VALIDADO
        // createStockTransferSvc (Capa 3): multi-línea, congela el WAC, escribe TR-NNNN inmutable.
        // El servicio impone origen≠destino, almacenes activos, solo físicos, qty≤disponible en
        // origen. DISA identifica producto y almacenes por nombre y resume antes (confirm-first).
        case 'transfer_stock': {
          const p = action.params || {};
          try {
            const items = (Array.isArray(p.items) && p.items.length
              ? p.items
              : [{ product_id: p.product_id, quantity: p.quantity }])
              .map(it => ({ product_id: parseInt(it.product_id), quantity: Number(it.quantity) }));
            const today = new Date().toISOString().split('T')[0];
            const r = createStockTransferSvc(db, {
              from_warehouse_id: parseInt(p.from_warehouse_id),
              to_warehouse_id: parseInt(p.to_warehouse_id),
              date: p.date || today,
              notes: p.notes || 'Traslado por DISA',
              items,
            });
            logActivity(db, 'create', 'stock_transfers', r.id,
              'Traslado ' + r.transfer_number + ' por DISA (' + r.lines + ' líneas)', session);
            return { ok: true, message: 'Traslado ' + r.transfer_number + ' confirmado (' + r.lines + ' línea(s)).' };
          } catch (e) {
            return { ok: false, message: 'No se pudo hacer el traslado: ' + e.message };
          }
        }

        // ── Compras por voz (handoff a la pantalla de captura) ────────────────
        // [Voz DISA compras] DISA recoge una compra HABLANDO y deja al usuario en la MISMA
        // pantalla de revisión que la captura por foto/PDF (/admin/purchases/capture),
        // precargada. A diferencia de adjust_stock/transfer_stock, NO confirma la compra de
        // palabra (varias líneas, costes y bandas de IVA se revisan en pantalla): produce el
        // MISMO payload normalizado que el extractor de visión (captureFromExtraction) y
        // devuelve capture_url. CERO escritura de stock/compras aquí (eso lo hace el confirm
        // de la pantalla por createReceiptSvc/createDirectPurchaseSvc). El proveedor y los
        // productos los IDENTIFICA DISA por conversación (listas en contexto); el cuadre por
        // NIF/nombre/descripción lo rehace matchExtraction al precargar.
        case 'dictar_compra': {
          const p = action.params || {};
          const sup = p.supplier || p.proveedor || {};
          const lineasRaw = Array.isArray(p.lines) ? p.lines : (Array.isArray(p.lineas) ? p.lineas : []);
          if (!lineasRaw.length) return { ok: false, message: 'No he entendido ninguna línea de compra. Dime, por cada producto: nombre, cantidad y coste unitario.' };
          // Mismo shape que extractInvoice: { supplier:{name,fiscal_id}, date, lines:[{description,quantity,unit_cost,vat_rate}] }
          const extracted = {
            supplier: { name: sup.name || sup.nombre || '', fiscal_id: sup.fiscal_id || sup.nif || '' },
            date: p.date || p.fecha || '',
            invoice_number: p.invoice_number || p.referencia || '',
            lines: lineasRaw.map(l => ({
              description: l.description || l.producto || l.nombre || '',
              quantity:  (l.quantity != null ? Number(l.quantity) : (l.cantidad != null ? Number(l.cantidad) : 1)),
              unit_cost: (l.unit_cost != null ? Number(l.unit_cost) : (l.coste != null ? Number(l.coste) : 0)),
              vat_rate:  (l.vat_rate != null ? Number(l.vat_rate) : (l.iva != null ? Number(l.iva) : null)),
            })),
            totals: { base: null, tax: null, total: null },
          };
          try {
            const r = captureFromExtraction(db, session, extracted);
            const n = r.extracted.lines.length;
            return {
              ok: true,
              message: 'He preparado la compra' + (extracted.supplier.name ? ' a ' + extracted.supplier.name : '')
                + ' con ' + n + ' línea(s). Te llevo a la pantalla de revisión para que la confirmes ahí.',
              capture_url: '/admin/purchases/capture?attachment=' + r.attachment_id,
            };
          } catch (e) {
            return { ok: false, message: 'No he podido preparar la compra: ' + (e.message || 'datos insuficientes') + '.' };
          }
        }

        // [Voz DISA stock — OBSOLETO, comentado no borrado] El reset_stock viejo hacía UPDATE
        // directo a products.stock + INSERT en inventory_movements (tabla archivada en Pilar 3):
        // saltaba el libro y el WAC, y hoy lanzaría "no such table". "Poner a 0/vaciar" se hace
        // ahora con adjust_stock mode:set value:0 (servicio validado). Se deja como registro.
        // case 'reset_stock': {
        //   const p = action.params;
        //   const product = db.prepare('SELECT name, stock FROM products WHERE id=?').get(p.product_id);
        //   if (!product) return { ok: false, message: 'Producto no encontrado.' };
        //   db.prepare('UPDATE products SET stock=0 WHERE id=?').run(p.product_id);
        //   if (product.stock !== 0) {
        //     db.prepare(`
        //       INSERT INTO inventory_movements (product_id, type, quantity, reason)
        //       VALUES (?, 'adjust', ?, ?)
        //     `).run(p.product_id, Math.abs(product.stock), p.reason || 'Reset por DISA');
        //   }
        //   logActivity(db, 'edit', 'products', p.product_id, 'Stock reseteado a 0 por DISA', session);
        //   return { ok: true, message: 'Stock de "' + product.name + '" puesto a 0.' };
        // }

        // ── Clientes ──────────────────────────────────────────

        // T5 — DISA escribe clientes SOLO por el servicio validado compartido (mismo que
        // usa el formulario): misma validación de esquema + misma guarda de NIF único.
        // Nada de INSERT/UPDATE directo. Los errores del servicio (400/404/409) se reportan.
        case 'create_client': {
          const p = action.params || {};
          try {
            const r = createClientSvc(db, {
              name: p.name, fiscal_id: p.fiscal_id, email: p.email, phone: p.phone,
              address: p.address, city: p.city, country: p.country, notes: p.notes,
              client_type: p.client_type, payment_term_days: p.payment_term_days, payment_method: p.payment_method,
            });
            logActivity(db, 'create', 'clients', r.id, 'Cliente "' + (r.name || '') + '" creado por DISA', session);
            return { ok: true, message: 'Cliente "' + (r.name || 'nuevo') + '" creado (#' + r.id + ').' };
          } catch (e) {
            return { ok: false, message: 'No se pudo crear el cliente: ' + e.message };
          }
        }

        case 'edit_client': {
          const p = action.params || {};
          const client = db.prepare('SELECT * FROM clients WHERE id=?').get(p.client_id);
          if (!client) return { ok: false, message: 'Cliente no encontrado.' };
          // DISA puede mandar campos parciales: se fusionan con los actuales y se manda el
          // objeto COMPLETO al servicio (que hace replace validado). Strings nunca null.
          const keep = (v, cur) => (v !== undefined ? v : cur);
          try {
            const r = updateClientSvc(db, p.client_id, {
              name:               keep(p.name, client.name) || '',
              fiscal_id:          keep(p.fiscal_id, client.fiscal_id) || '',
              email:              keep(p.email, client.email) || '',
              phone:              keep(p.phone, client.phone) || '',
              address:            keep(p.address, client.address) || '',
              city:               keep(p.city, client.city) || '',
              country:            keep(p.country, client.country) || '',
              group_id:           keep(p.group_id, client.group_id) || null,
              notes:              keep(p.notes, client.notes) || '',
              accepts_newsletter: !!client.accepts_newsletter,
              client_type:        keep(p.client_type, client.client_type) || 'particular',
              payment_term_days:  Number(keep(p.payment_term_days, client.payment_term_days)) || 0,
              payment_method:     keep(p.payment_method, client.payment_method) || '',
              collections_profile: keep(p.collections_profile, client.collections_profile) || 'estandar',
            });
            logActivity(db, 'edit', 'clients', r.id, 'Cliente editado por DISA', session);
            return { ok: true, message: 'Cliente #' + r.id + ' actualizado.' };
          } catch (e) {
            return { ok: false, message: 'No se pudo editar el cliente: ' + e.message };
          }
        }

        case 'deactivate_client': {
          const p = action.params || {};
          try {
            const r = archiveClientSvc(db, p.client_id);
            logActivity(db, 'archive', 'clients', r.id, 'Cliente archivado por DISA', session);
            return { ok: true, message: 'Cliente #' + r.id + ' archivado.' };
          } catch (e) {
            return { ok: false, message: 'No se pudo archivar el cliente: ' + e.message };
          }
        }

        // T4 Paso 2 — DISA registra una acción de cobro SIEMPRE por el servicio validado
        // (mismo que el endpoint POST .../collection-actions): NO hace INSERT directo y
        // reutiliza el doble seguro (rechaza factura no viva). La confirmación previa la
        // garantiza el protocolo [ACCION] (DISA propone → el usuario dice "si").
        case 'register_collection_action': {
          const p = action.params || {};
          try {
            const res = await registerCollectionAction(db, parseInt(p.invoice_id), {
              type: p.type, channel: p.channel, note: p.note, promised_date: p.promised_date,
            }, { sendEmail });
            logActivity(db, 'collection_action', 'invoices', res.id,
              'DISA registró ' + res.type + ' en factura ' + res.invoice_number, session);
            const msg = res.type === 'recordatorio_email'
              ? 'Recordatorio enviado para la factura ' + res.invoice_number + '.'
              : res.type === 'promesa_pago'
                ? 'Promesa de pago registrada para la factura ' + res.invoice_number + '.'
                : 'Contacto registrado para la factura ' + res.invoice_number + '.';
            return { ok: true, message: msg };
          } catch (e) {
            return { ok: false, message: 'No se pudo registrar la acción de cobro: ' + e.message };
          }
        }

        // T4 Paso 2.1 — acción a nivel de CUENTA (toda la deuda viva del cliente), SIEMPRE
        // por el mismo servicio validado (no INSERT directo). Confirmación previa vía [ACCION].
        case 'register_account_action': {
          const p = action.params || {};
          try {
            const res = await registerAccountAction(db, parseInt(p.client_id), {
              type: p.type, note: p.note, promised_date: p.promised_date,
              importe: p.importe, modo: p.modo || 'auto', asignacion: p.asignacion, payment_method: p.payment_method,
            }, { sendEmail });
            logActivity(db, 'account_action', 'clients', p.client_id,
              'DISA ejecutó ' + res.type + ' (lote ' + res.batch_id + ')', session);
            const msg = res.type === 'recordatorio_cuenta'
              ? 'Recordatorio de cuenta enviado (' + res.facturas + ' factura(s)).'
              : res.type === 'promesa_cuenta'
                ? 'Promesa de cuenta registrada en ' + res.facturas + ' factura(s).'
                : 'Cobro a cuenta registrado en ' + (res.pagos ? res.pagos.length : 0) + ' factura(s)'
                  + (res.sinAsignar > 0.0049 ? ' (sobran ' + res.sinAsignar.toFixed(2) + ').' : '.');
            return { ok: true, message: msg };
          } catch (e) {
            return { ok: false, message: 'No se pudo ejecutar la acción de cuenta: ' + e.message };
          }
        }

        // Paso (d) — PAGO A PROVEEDOR por voz ("pagué 200€ a Esencias"). Espejo de
        // cobro_cuenta: reparte el importe entre las facturas vivas del proveedor (más
        // antigua primero) por el servicio validado registerSupplierAccountPayment (no
        // INSERT directo; reusa isPayable + no-sobrepago por factura). Resuelve el proveedor
        // por id (del índice COMPRAS POR PAGAR) o, si DISA pasa nombre, uno/varios/ninguno.
        case 'register_supplier_payment': {
          const p = action.params || {};
          try {
            let supplierId = parseInt(p.supplier_id) || null;
            if (!supplierId && p.supplier) {
              const q = String(p.supplier).trim().toLowerCase();
              const matches = db.prepare('SELECT id, name FROM suppliers WHERE LOWER(name) LIKE ?').all('%' + q + '%');
              if (matches.length === 0) return { ok: false, message: 'No encuentro ningún proveedor que se llame "' + p.supplier + '". ¿Lo creo o lo dices de otra forma?' };
              if (matches.length > 1) return { ok: false, message: 'Hay varios proveedores que encajan con "' + p.supplier + '": ' + matches.map(m => m.name).join(', ') + '. ¿Cuál de ellos?' };
              supplierId = matches[0].id;
            }
            if (!supplierId) return { ok: false, message: 'Falta el proveedor del pago.' };
            const res = registerSupplierAccountPayment(db, supplierId, {
              amount: p.amount, modo: p.modo || 'auto', asignacion: p.asignacion,
              payment_method: p.payment_method, note: p.note,
            });
            logActivity(db, 'supplier_payment', 'suppliers', supplierId,
              'DISA registró pago a cuenta de ' + res.repartido + ' a ' + res.supplier_name + ' (' + res.pagos.length + ' factura/s)', session);
            const msg = 'Pagados ' + res.repartido.toFixed(2) + ' a ' + res.supplier_name
              + ' en ' + res.pagos.length + ' factura' + (res.pagos.length === 1 ? '' : 's')
              + (res.sinAsignar > 0.0049 ? ' (sobran ' + res.sinAsignar.toFixed(2) + ': el proveedor no debía tanto).' : '.');
            return { ok: true, message: msg };
          } catch (e) {
            return { ok: false, message: 'No se pudo registrar el pago al proveedor: ' + e.message };
          }
        }

        case 'activate_client': {
          const p = action.params || {};
          try {
            const r = restoreClientSvc(db, p.client_id);   // reusa la guarda de NIF al restaurar
            logActivity(db, 'restore', 'clients', r.id, 'Cliente restaurado por DISA', session);
            return { ok: true, message: 'Cliente #' + r.id + ' restaurado.' };
          } catch (e) {
            return { ok: false, message: 'No se pudo restaurar el cliente: ' + e.message };
          }
        }

        // ── Proveedores ───────────────────────────────────────

        case 'create_supplier': {
          const p = action.params;
          const r = db.prepare(`
            INSERT INTO suppliers (name, contact, email, phone, notes, supplier_code)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(p.name || '', p.contact || '', p.email || '', p.phone || '', p.notes || '', nextCode(db, 'supplier'));
          logActivity(db, 'create', 'suppliers', r.lastInsertRowid,
            'Proveedor "' + p.name + '" creado por DISA', session);
          return { ok: true, message: 'Proveedor "' + (p.name || 'nuevo') + '" creado.' };
        }

        case 'edit_supplier': {
          const p = action.params;
          const supplier = db.prepare('SELECT * FROM suppliers WHERE id=?').get(p.supplier_id);
          if (!supplier) return { ok: false, message: 'Proveedor no encontrado.' };
          db.prepare(`
            UPDATE suppliers SET name=?, contact=?, email=?, phone=?, notes=? WHERE id=?
          `).run(
            p.name !== undefined ? p.name : supplier.name,
            p.contact !== undefined ? p.contact : supplier.contact,
            p.email !== undefined ? p.email : supplier.email,
            p.phone !== undefined ? p.phone : supplier.phone,
            p.notes !== undefined ? p.notes : supplier.notes,
            p.supplier_id
          );
          logActivity(db, 'edit', 'suppliers', p.supplier_id, 'Proveedor editado por DISA', session);
          return { ok: true, message: 'Proveedor #' + p.supplier_id + ' actualizado.' };
        }

        case 'delete_supplier': {
          const p = action.params;
          const purchases = db.prepare(
            'SELECT COUNT(*) as c FROM purchases WHERE supplier_id=?'
          ).get(p.supplier_id);
          if (purchases?.c > 0) return {
            ok: false,
            message: 'No se puede eliminar: el proveedor tiene ' + purchases.c + ' compras asociadas.'
          };
          const r = db.prepare('DELETE FROM suppliers WHERE id=?').run(p.supplier_id);
          if (r.changes === 0) return { ok: false, message: 'Proveedor no encontrado.' };
          logActivity(db, 'delete', 'suppliers', p.supplier_id, 'Proveedor eliminado por DISA', session);
          return { ok: true, message: 'Proveedor #' + p.supplier_id + ' eliminado.' };
        }

        // ── Perfil DISA ───────────────────────────────────────

        case 'update_profile': {
          const p = action.params;
          updateProfile(db, { [p.field]: p.value });
          return { ok: true, message: 'He actualizado mi conocimiento sobre tu negocio.' };
        }

        // ── Configuración ─────────────────────────────────────

        case 'update_company_config': {
          const p = action.params;
          const allowed = [
            'company_name', 'fiscal_id', 'tax_rate', 'address', 'phone',
            'email', 'website', 'country', 'currency', 'currency_symbol',
            'tax_name', 'invoice_series'
          ];
          const updates = {};
          for (const key of allowed) {
            if (p[key] !== undefined) updates[key] = p[key];
          }
          if (Object.keys(updates).length === 0) {
            return { ok: false, message: 'No se especificó ningún campo a actualizar.' };
          }
          const fields = Object.keys(updates).map(k => k + '=?').join(', ');
          db.prepare('UPDATE company_config SET ' + fields + ' WHERE id=1')
            .run(...Object.values(updates));
          logActivity(db, 'edit', 'company_config', 1,
            'Config actualizada por DISA: ' + Object.keys(updates).join(', '), session);
          return { ok: true, message: 'Configuración actualizada: ' + Object.keys(updates).join(', ') + '.' };
        }

        case 'create_category': {
          const p = action.params;
          if (!p?.name) return { ok: false, message: 'Se requiere el nombre de la categoría.' };
          const existing = db.prepare('SELECT id FROM categories WHERE name=?').get(p.name);
          if (existing) return { ok: false, message: 'Ya existe una categoría con ese nombre.' };
          const res = db.prepare(
            'INSERT INTO categories (name, description) VALUES (?,?)'
          ).run(p.name, p.description || '');
          logActivity(db, 'create', 'category', res.lastInsertRowid,
            'Categoría creada por DISA: ' + p.name, session);
          return { ok: true, message: 'Categoría "' + p.name + '" creada correctamente (id: ' + res.lastInsertRowid + ').' };
        }

        case 'edit_category': {
          const p = action.params;
          if (!p?.id) return { ok: false, message: 'Se requiere el id de la categoría.' };
          const updates = {};
          if (p.name !== undefined) updates.name = p.name;
          if (p.description !== undefined) updates.description = p.description;
          if (Object.keys(updates).length === 0) return { ok: false, message: 'No se especificó ningún campo a actualizar.' };
          const fields = Object.keys(updates).map(k => k + '=?').join(', ');
          db.prepare('UPDATE categories SET ' + fields + ' WHERE id=?')
            .run(...Object.values(updates), p.id);
          logActivity(db, 'edit', 'category', p.id,
            'Categoría editada por DISA', session);
          return { ok: true, message: 'Categoría actualizada.' };
        }

        case 'delete_category': {
          const p = action.params;
          if (!p?.id) return { ok: false, message: 'Se requiere el id de la categoría.' };
          const cat = db.prepare('SELECT name FROM categories WHERE id=?').get(p.id);
          if (!cat) return { ok: false, message: 'Categoría no encontrada.' };
          const inUse = db.prepare('SELECT COUNT(*) as c FROM products WHERE category_id=?').get(p.id);
          if (inUse.c > 0) return { ok: false, message: 'No se puede eliminar "' + cat.name + '" porque tiene ' + inUse.c + ' productos asignados.' };
          db.prepare('DELETE FROM categories WHERE id=?').run(p.id);
          logActivity(db, 'delete', 'category', p.id,
            'Categoría eliminada por DISA: ' + cat.name, session);
          return { ok: true, message: 'Categoría "' + cat.name + '" eliminada.' };
        }

        // ── Seguridad ───────────────────────────────────────────

        case 'check_2fa_status': {
          const p = action.params || {};
          let targetUser;
          if (p.user_id) {
            if (session.role !== 'owner' && session.role !== 'admin')
              return { ok: false, message: 'Solo administradores pueden consultar otros usuarios.' };
            targetUser = db.prepare('SELECT name, email, totp_enabled FROM admin_users WHERE id=?').get(p.user_id);
            if (!targetUser) return { ok: false, message: 'Usuario no encontrado.' };
          } else {
            targetUser = db.prepare('SELECT name, email, totp_enabled FROM admin_users WHERE id=?').get(session.userId);
          }
          const estado = targetUser.totp_enabled ? 'ACTIVADA' : 'DESACTIVADA';
          const msg = p.user_id
            ? `El usuario "${targetUser.name}" (${targetUser.email}) tiene 2FA ${estado}.`
            : `Tu cuenta tiene 2FA ${estado}.`;
          return { ok: true, message: msg };
        }

        case 'disable_2fa_user': {
          const p = action.params || {};
          let targetId = session.userId;
          let targetName = session.userName;
          if (p.user_id && p.user_id !== session.userId) {
            if (session.role !== 'owner' && session.role !== 'admin')
              return { ok: false, message: 'Solo administradores pueden modificar otros usuarios.' };
            const u = db.prepare('SELECT name FROM admin_users WHERE id=?').get(p.user_id);
            if (!u) return { ok: false, message: 'Usuario no encontrado.' };
            targetId = p.user_id;
            targetName = u.name;
          }
          const current = db.prepare('SELECT totp_enabled FROM admin_users WHERE id=?').get(targetId);
          if (!current?.totp_enabled)
            return { ok: false, message: `El usuario "${targetName}" no tiene 2FA activo.` };
          db.prepare('UPDATE admin_users SET totp_secret=NULL, totp_enabled=0 WHERE id=?').run(targetId);
          logActivity(db, 'security', 'admin_users', targetId, `2FA desactivado por DISA`, session);
          return { ok: true, message: `2FA desactivado para "${targetName}". Ya puede acceder solo con contraseña.` };
        }

        case 'list_users_security': {
          if (session.role !== 'owner' && session.role !== 'admin')
            return { ok: false, message: 'Solo administradores pueden ver esta información.' };
          const users = db.prepare(
            'SELECT id, name, email, role, totp_enabled, active FROM admin_users ORDER BY name'
          ).all();
          const maskEmail = e => {
            if (!e || !e.includes('@')) return '***';
            const [local, domain] = e.split('@');
            return local.slice(0, 3).padEnd(local.length, '*') + '@' + domain;
          };
          const resumen = users.map(u =>
            `${u.name} (${maskEmail(u.email)}) — rol: ${u.role} — 2FA: ${u.totp_enabled ? 'SI' : 'NO'} — activo: ${u.active ? 'SI' : 'NO'}`
          ).join('\n');
          return { ok: true, message: `Usuarios del sistema:\n${resumen}` };
        }

        default:
          return { ok: false, message: 'Accion no reconocida: ' + action.type };
      }
    } catch (err) {
      console.error('[DISA] executeAction error:', err);
      return { ok: false, message: 'Error al ejecutar la accion: ' + err.message };
    }
  }

  function buildBusinessContext(db, currentPage = '', session = null) {
    try {
      const _dbCheck = db.prepare("SELECT name FROM sqlite_master LIMIT 1").get();
      console.log('[DISA] Usando BD:', _dbCheck ? 'OK' : 'VACIA');
      const _products = db.prepare('SELECT COUNT(*) as c FROM products').get();
      console.log('[DISA] Productos encontrados:', _products?.c ?? 0);
      const _orders = db.prepare("SELECT COUNT(*) as c FROM sales_orders WHERE status='completado'").get();
      console.log('[DISA] Pedidos completados:', _orders?.c ?? 0);

      const _userPerms = session ? (() => {
        try {
          return db.prepare(`SELECT p.module, p.action FROM user_permissions up JOIN permissions p ON up.permission_id=p.id WHERE up.admin_user_id=?`).all(session.userId).map(p => p.module+'.'+p.action);
        } catch { return []; }
      })() : [];
      const userContext = session
        ? [
            'USUARIO ACTUAL:',
            '- Nombre: ' + (session.userName || 'desconocido'),
            '- Rol: ' + (session.role || 'sin rol'),
            '- Puede modificar datos: ' + (isAdminUser(session) ? 'SI' : 'NO'),
            '- Permisos: ' + (_userPerms.length ? _userPerms.join(', ') : 'ninguno especifico (usa rol base)'),
          ].join('\n')
        : 'USUARIO ACTUAL:\n- Rol: desconocido\n- Puede modificar datos: NO';

      const profile = getProfile(db);
      const profileContext = profile.business_type ? [
        'PERFIL DEL NEGOCIO:',
        '- Tipo: ' + profile.business_type,
        '- Sector: ' + profile.sector,
        '- Descripcion: ' + profile.description,
        '- Objetivos: ' + profile.goals,
        '- Preferencias: ' + profile.preferences,
        '- Decisiones tomadas: ' + profile.decisions,
      ].join('\n') : 'PERFIL: Sin configurar todavia.';

      const cfg = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
      const sym = cfg.currency_symbol || '€';

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

      const sales = db.prepare(`
        SELECT COUNT(*) as orders,
               COALESCE(SUM(subtotal),0) as revenue,
               COALESCE(SUM(tax_amount),0) as iva,
               COALESCE(SUM(total),0) as gross_revenue
        FROM sales_orders
        WHERE status NOT IN ('cancelado','reembolsado','borrador')
        AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
      `).get() || {};

      // PIEZA 2a — "pedido pendiente de entrega": DEFINICION UNICA = documento Pedido
      // (customer_orders) en estado 'confirmado' (anulados y borradores NO cuentan; en la 2a nada
      // esta entregado). El resumen inyectado y cualquier consulta usan ESTA misma definicion para
      // que el numero no cambie segun a quien se pregunte. NO es el clúster viejo sales_orders
      // (TPV/e-commerce), que cuenta como "ventas".
      const pending = db.prepare(`
        SELECT COUNT(*) as count FROM customer_orders WHERE status='confirmado'
      `).get() || {};
      // Listas curadas (cliente REAL y consistente): confirmados usan su foto congelada
      // (client_name); borradores leen el cliente vivo por client_id, o "sin cliente" si no tienen.
      const pedidosConfirmados = db.prepare(`
        SELECT o.order_number, o.total, COALESCE(NULLIF(o.client_name,''), c.name, 'sin cliente') AS cliente
          FROM customer_orders o LEFT JOIN clients c ON c.id=o.client_id
         WHERE o.status='confirmado' ORDER BY o.id DESC LIMIT 10
      `).all() || [];
      const pedidosBorradores = db.prepare(`
        SELECT o.id, o.total, CASE WHEN o.client_id IS NULL THEN 'sin cliente' ELSE COALESCE(c.name,'sin cliente') END AS cliente
          FROM customer_orders o LEFT JOIN clients c ON c.id=o.client_id
         WHERE o.status='borrador' ORDER BY o.id DESC LIMIT 10
      `).all() || [];

      const lowStock = db.prepare(`
        SELECT name, stock FROM products
        WHERE status='active' AND stock <= 5 ORDER BY stock ASC LIMIT 5
      `).all() || [];

      let inactiveClients = { count: 0 };
      try {
        inactiveClients = db.prepare(`
          SELECT COUNT(*) as count FROM clients c
          WHERE c.active = 1
          AND NOT EXISTS (
            SELECT 1 FROM sales_orders so
            WHERE so.client_id = c.id
            AND so.created_at >= date('now', '-30 days')
            AND so.status = 'completado'
          )
        `).get() || {};
      } catch {}

      const topProducts = db.prepare(`
        SELECT p.name, SUM(si.quantity) as sold
        FROM sales_items si
        JOIN products p ON p.id = si.product_id
        JOIN sales_orders so ON so.id = si.order_id
        WHERE so.status NOT IN ('cancelado','reembolsado','borrador')
        AND so.created_at >= ?
        GROUP BY p.id ORDER BY sold DESC LIMIT 5
      `).all(monthStart) || [];

      const topProductsAllTime = db.prepare(`
        SELECT p.name, SUM(si.quantity) as sold, ROUND(SUM(si.total),2) as revenue
        FROM sales_items si
        JOIN products p ON p.id = si.product_id
        JOIN sales_orders so ON so.id = si.order_id
        WHERE so.status NOT IN ('cancelado','reembolsado','borrador')
        GROUP BY p.id ORDER BY sold DESC LIMIT 5
      `).all() || [];

      const lines = [
        userContext,
        '',
        profileContext,
        '',
        'Negocio: ' + (cfg.company_name || 'Sin nombre'),
        'Pais: ' + (cfg.country || 'ES'),
        'Moneda: ' + sym,
        '',
        'VENTAS ESTE MES (' + (sales.orders || 0) + ' ventas/tickets de TPV):',
        '- Venta neta (sin IVA): ' + sym + Number(sales.revenue || 0).toFixed(2),
        '- IVA recaudado: ' + sym + Number(sales.iva || 0).toFixed(2),
        '- Total cobrado (con IVA): ' + sym + Number(sales.gross_revenue || 0).toFixed(2),
        '',
        // PIEZA 2a — PEDIDOS de venta (documento "Pedido", customer_orders). Numero y clientes
        // CURADOS: DISA los usa tal cual, no recalcula con otra definicion ni inventa el cliente.
        'PEDIDOS DE VENTA (documento "Pedido" del Pilar 4 · tabla customer_orders; NO es el TPV/sales_orders viejo):',
        '- Pendientes de entrega = CONFIRMADOS (definicion UNICA; anulados y borradores NO cuentan): ' + (pending.count || 0),
        ...(pedidosConfirmados.length ? ['  ' + pedidosConfirmados.map(p => (p.order_number || '?') + ' · ' + p.cliente + ' · ' + sym + Number(p.total || 0).toFixed(2)).join(' | ')] : []),
        '- Borradores (sin confirmar; NO reservan, sin numero): ' + pedidosBorradores.length,
        ...(pedidosBorradores.length ? ['  ' + pedidosBorradores.map(p => '#' + p.id + ' · ' + p.cliente + ' · ' + sym + Number(p.total || 0).toFixed(2)).join(' | ')] : []),
        'Usa SIEMPRE estos numeros y estos clientes (no recalcules "pendientes" con otra definicion ni inventes/cambies el cliente de un borrador).',
        'GESTION DE PEDIDOS POR CHAT: NO disponible en esta version. NO crees, confirmes, anules ni elimines pedidos por chat (ni con insert/update/delete_record sobre customer_orders/customer_order_items). Ante esa peticion, DECLINA con un mensaje claro y redirige a la pantalla de Pedidos (/admin/pedidos), SIN pedir confirmacion. LEER pedidos SI esta permitido.',
        '',
        'ATENCION:',
        '- Productos con stock bajo (<=5 unidades): ' +
          (lowStock.length > 0
            ? lowStock.map(p => p.name + ' (' + p.stock + ')').join(', ')
            : 'ninguno'),
        '- Clientes sin compra en >30 dias: ' + (inactiveClients.count || 0),
        '',
        // get_collections_summary (lectura): worklist priorizado + próxima acción por deuda.
        ...(() => {
          try {
            const wl = collectionsWorklist(db, new Date().toISOString().slice(0, 10));
            const top = wl.rows.slice(0, 8).map((r, i) => {
              const p = r.proximaAccion;
              const accion = !p ? 'sin accion'
                : p.accion === 'recordatorio_email' ? ('recordatorio (' + p.etapa + ', tono ' + p.tono + ')')
                : p.etapa === 'promesa' ? ('promesa hasta ' + (p.fechaObjetivo || '?'))
                : p.etapa === 'manual' ? 'gestion manual'
                : p.etapa === 'por_vencer' ? 'aun no vence' : 'sin accion';
              return (i + 1) + '. ' + (r.client_name || '-') + ' · factura ' + r.invoice_number
                + ' · ' + sym + Number(r.pendiente || 0).toFixed(2)
                + (r.dias_vencida > 0 ? ' · vencida ' + r.dias_vencida + 'd' : '')
                + ' · perfil ' + (r.collections_profile || 'estandar')
                + ' · PROXIMA: ' + accion + ' (invoice_id=' + r.invoice_id + ')';
            });
            return [
              'COBROS POR FACTURA — TE DEBEN ' + sym + Number(wl.total || 0).toFixed(2) + ' (' + wl.rows.length + ' factura(s)):',
              wl.rows.length ? top.join('\n') : 'sin deudas vivas',
              '',
            ];
          } catch { return []; }
        })(),
        // get_collections_summary a nivel de CUENTA: deuda total + próxima acción de cuenta por cliente.
        ...(() => {
          try {
            const acc = accountsSummary(db, new Date().toISOString().slice(0, 10));
            if (!acc.rows.length) return [];
            const lines = acc.rows.slice(0, 8).map((r, i) => {
              const p = r.proximaAccionCuenta;
              const accion = !p ? 'sin accion'
                : p.accion === 'recordatorio_email' ? ('recordatorio de cuenta (' + p.etapa + ', tono ' + p.tono + ')')
                : p.etapa === 'promesa' ? 'promesa en curso'
                : p.etapa === 'manual' ? 'gestion manual' : 'sin accion ahora';
              return (i + 1) + '. ' + (r.client_name || '-') + ' (client_id=' + r.client_id + ') · '
                + sym + Number(r.deudaTotal).toFixed(2) + ' en ' + r.facturas + ' factura(s)'
                + ' · perfil ' + (r.perfilCuenta || 'estandar') + ' · CUENTA: ' + accion;
            });
            return ['COBROS POR CUENTA (cliente entero):', lines.join('\n'), ''];
          } catch { return []; }
        })(),
        // Paso (d) — COMPRAS POR PAGAR: deuda VIVA con cada proveedor + sus facturas recibidas
        // pendientes (lo que DEBES). Sin esto DISA no puede identificar al proveedor para un pago
        // por voz ni avisar de vencimientos. Espejo de COBROS POR CUENTA, lado proveedor. Los
        // ABONOS (crédito a tu favor) quedan fuera (no son deuda). due_date/estado → DISA puede
        // responder "qué vence" desde aquí.
        ...(() => {
          try {
            const pa = supplierAccountsSummary(db, new Date().toISOString().slice(0, 10));
            if (!pa.rows.length) return [];
            const lines = pa.rows.slice(0, 8).map((r, i) => {
              const facts = r.vivas.slice(0, 5).map(f => (f.internal_code || ('#' + f.supplier_invoice_id))
                + ' ' + sym + Number(f.pendiente).toFixed(2)
                + ' vence ' + (f.due_date || '-')
                + (f.dias_vencida > 0 ? ' (vencida ' + f.dias_vencida + 'd)' : '')).join('; ');
              return (i + 1) + '. ' + (r.supplier_name || '-') + ' (supplier_id=' + r.supplier_id + ') · '
                + 'DEBES ' + sym + Number(r.deudaTotal).toFixed(2) + ' en ' + r.facturas + ' factura(s)'
                + (r.maxVencida > 0 ? ' · más vencida ' + r.maxVencida + 'd' : '') + ' · ' + facts;
            });
            return [
              'COMPRAS POR PAGAR (lo que DEBES a proveedores) — DEBES ' + sym + Number(pa.total || 0).toFixed(2) + ' en total:',
              lines.join('\n'),
              'Para un pago por voz, resuelve el proveedor a supplier_id aqui. Vence en <=7 dias o vencida = avisalo.',
              '',
            ];
          } catch { return []; }
        })(),
        // T5 — índice de clientes activos: la vía de lectura para IDENTIFICAR un cliente
        // por nombre (resolver a su id antes de actuar) y para responder consultas.
        ...(() => {
          try {
            const totalCl = db.prepare('SELECT COUNT(*) n FROM clients WHERE active=1').get().n;
            if (!totalCl) return [];
            const cls = searchClients(db, { limit: 40 });
            const list = cls.map(cl => '#' + cl.id + ' ' + cl.name
              + (cl.fiscal_id ? ' [' + cl.fiscal_id + ']' : '')
              + (cl.city ? ' · ' + cl.city : '')).join('\n');
            return [
              'CLIENTES ACTIVOS (' + totalCl + (totalCl > cls.length ? '; muestro los ' + cls.length + ' primeros por nombre' : '') + ') — id, nombre, [NIF], ciudad:',
              list,
              'Usa esta lista para resolver un nombre a su client_id antes de cualquier accion. Varios que encajen → pregunta cual. Ninguno → propon crearlo (create_client, con confirmacion).',
              '',
            ];
          } catch { return []; }
        })(),
        // [Voz DISA stock] Índice de PRODUCTOS físicos activos — resolver nombre→id antes de
        // consultar u operar (mismo protocolo de identificación que clientes). Incluye stock
        // GLOBAL, RESERVADO (pedidos de venta confirmados) y DISPONIBLE (= stock − reservado) +
        // coste medio (WAC) curados; el stock por almacén NO va aquí (se consulta).
        ...(() => {
          try {
            const total = db.prepare("SELECT COUNT(*) n FROM products WHERE status='active' AND COALESCE(type,'physical')='physical'").get().n;
            if (!total) return [];
            const prods = db.prepare("SELECT id, name, sku, stock, average_cost FROM products WHERE status='active' AND COALESCE(type,'physical')='physical' ORDER BY name LIMIT 40").all();
            const list = prods.map(p => {
              const reserved = reservedOfProduct(db, p.id);   // PIEZA 2a: reservado GLOBAL
              const available = (p.stock || 0) - reserved;
              return '#' + p.id + ' ' + p.name + (p.sku ? ' [' + p.sku + ']' : '')
                + ' · stock ' + p.stock + (reserved > 0 ? ' · reservado ' + reserved : '') + ' · disponible ' + available
                + ' · coste medio ' + sym + Number(p.average_cost || 0).toFixed(2);
            }).join('\n');
            return [
              'PRODUCTOS FISICOS ACTIVOS (' + total + (total > prods.length ? '; muestro los ' + prods.length + ' primeros por nombre' : '') + ') — id, nombre, [SKU], stock GLOBAL, reservado, disponible (= stock − reservado), coste medio (WAC):',
              list,
              'Cuando te pregunten "cuanto tengo de X", responde el DISPONIBLE y, si hay reservas, desglosa lo reservado (apartado por pedidos de venta confirmados; sigue en el almacen, no facturable libremente). Resuelve un nombre a su id con esta lista antes de consultar. Varios → pregunta cual. Ninguno → dilo (no inventes). El stock/disponible POR ALMACEN no esta aqui: consultalo. En esta pieza NO creas ni confirmas pedidos (solo lectura).',
              '',
            ];
          } catch { return []; }
        })(),
        // [Voz DISA stock] Almacenes activos (lista cerrada) — para identificar origen/destino
        // de un traslado o el almacén de un ajuste por nombre.
        ...(() => {
          try {
            const whs = activeWarehouses(db);
            if (!whs.length) return [];
            return [
              'ALMACENES ACTIVOS — id, nombre:',
              whs.map(w => '#' + w.id + ' ' + w.name + (w.is_default ? ' (principal)' : '')).join('\n'),
              'Para trasladar o ajustar por almacen, resuelve el nombre a su id aqui. En un traslado, origen y destino deben ser distintos.',
              '',
            ];
          } catch { return []; }
        })(),
        // [Voz DISA stock] Índice de proveedores — resolver nombre→id para consultas de compras.
        ...(() => {
          try {
            const total = db.prepare('SELECT COUNT(*) n FROM suppliers').get().n;
            if (!total) return [];
            const sups = db.prepare('SELECT id, name, fiscal_id FROM suppliers ORDER BY name LIMIT 40').all();
            return [
              'PROVEEDORES (' + total + (total > sups.length ? '; ' + sups.length + ' primeros' : '') + ') — id, nombre, [NIF]:',
              sups.map(s => '#' + s.id + ' ' + s.name + (s.fiscal_id ? ' [' + s.fiscal_id + ']' : '')).join('\n'),
              '',
            ];
          } catch { return []; }
        })(),
        // [Voz DISA stock] Valoración a coste (WAC) CURADA — no recalcular a ojo. Total global +
        // por almacén. Y aviso explícito: el stock mínimo no se gestiona (no inventar "bajo minimos").
        ...(() => {
          try {
            const v = inventoryValuation(db);
            const out = [
              'INVENTARIO — valoracion a coste (WAC global) [dato curado, usalo tal cual]:',
              'Valor total: ' + sym + v.total_value.toFixed(2) + ' (' + v.total_units + ' uds)',
            ];
            if (v.warehouses.length > 1) {
              out.push('Por almacen: ' + v.warehouses.map(w => w.name + ' ' + sym + w.value.toFixed(2) + ' (' + w.units + ' uds)').join(' · '));
            }
            out.push('El stock minimo / punto de pedido NO se gestiona aun: si preguntan que hay "bajo minimos", dilo claramente; no uses un umbral inventado.');
            out.push('');
            return out;
          } catch { return []; }
        })(),
        'PRODUCTOS MAS VENDIDOS ESTE MES:',
        topProducts.length > 0
          ? topProducts.map((p, i) => (i + 1) + '. ' + p.name + ' (' + p.sold + ' uds)').join('\n')
          : 'Sin ventas completadas este mes todavia',
        '',
        'PRODUCTOS MAS VENDIDOS (historico total):',
        topProductsAllTime.length > 0
          ? topProductsAllTime.map((p, i) => (i + 1) + '. ' + p.name + ' (' + p.sold + ' uds, ' + sym + p.revenue + ')').join('\n')
          : 'Sin datos',
      ];

      if (currentPage === 'products') {
        const recent = db.prepare(
          "SELECT id, name, price, stock FROM products WHERE status='active' ORDER BY id DESC LIMIT 5"
        ).all();
        lines.push('', 'PAGINA ACTUAL: Productos');
        lines.push('Productos recientes (id, nombre, precio, stock):');
        lines.push(recent.map(p => '#' + p.id + ' ' + p.name + ' ' + sym + p.price + ' stock:' + p.stock).join(', ') || 'ninguno');
      } else if (currentPage === 'orders') {
        const recentOrders = db.prepare(
          "SELECT id, order_number, total, status FROM sales_orders ORDER BY id DESC LIMIT 5"
        ).all();
        lines.push('', 'PAGINA ACTUAL: Pedidos');
        lines.push('Pedidos recientes: ' + recentOrders.map(
          o => '#' + o.id + ' ' + o.order_number + ' ' + sym + o.total + ' [' + o.status + ']'
        ).join(', '));
      } else if (currentPage === 'inventory') {
        const lowStockAll = db.prepare(
          "SELECT id, name, stock FROM products WHERE stock <= 10 AND status='active' ORDER BY stock ASC LIMIT 10"
        ).all();
        lines.push('', 'PAGINA ACTUAL: Inventario');
        lines.push('Productos stock bajo (id, nombre, stock):');
        lines.push(lowStockAll.map(p => '#' + p.id + ' ' + p.name + ' (' + p.stock + ')').join(', ') || 'ninguno');
      } else if (currentPage === 'clients') {
        const totalClients = db.prepare('SELECT COUNT(*) as c FROM clients WHERE active=1').get();
        const recentClients = db.prepare(
          'SELECT id, name, email FROM clients WHERE active=1 ORDER BY id DESC LIMIT 5'
        ).all();
        lines.push('', 'PAGINA ACTUAL: Clientes');
        lines.push('Total clientes activos: ' + (totalClients?.c || 0));
        lines.push('Clientes recientes: ' + recentClients.map(
          c => '#' + c.id + ' ' + c.name + (c.email ? ' <' + c.email + '>' : '')
        ).join(', '));
      } else if (currentPage === 'suppliers') {
        const suppliers = db.prepare(
          'SELECT id, name, email, phone FROM suppliers ORDER BY id DESC LIMIT 8'
        ).all();
        lines.push('', 'PAGINA ACTUAL: Proveedores');
        lines.push('Proveedores (id, nombre):');
        lines.push(suppliers.map(s => '#' + s.id + ' ' + s.name).join(', ') || 'ninguno');
      } else if (currentPage === 'analytics') {
        const last3months = db.prepare(`
          SELECT strftime('%Y-%m', created_at) as month, COALESCE(SUM(total),0) as revenue, COUNT(*) as orders
          FROM sales_orders WHERE status='completado'
          AND created_at >= date('now', '-90 days')
          GROUP BY month ORDER BY month DESC
        `).all();
        lines.push('', 'PAGINA ACTUAL: Analitica');
        lines.push('Ventas ultimos 3 meses: ' + (last3months.map(
          m => m.month + ': ' + sym + Number(m.revenue).toFixed(2) + ' (' + m.orders + ' ped.)'
        ).join(' | ') || 'sin datos'));
      } else if (currentPage === 'dashboard' || currentPage === 'admin') {
        lines.push('', 'PAGINA ACTUAL: Dashboard principal');
      } else if (currentPage === 'discounts') {
        const activeDisco = db.prepare(
          "SELECT code, type, value, uses_count FROM discount_codes WHERE active=1 ORDER BY id DESC LIMIT 5"
        ).all();
        lines.push('', 'PAGINA ACTUAL: Descuentos');
        lines.push('Descuentos activos: ' + (activeDisco.map(
          d => d.code + ' (' + d.type + ':' + d.value + ', usos:' + d.uses_count + ')'
        ).join(', ') || 'ninguno'));
      } else if (currentPage === 'invoices') {
        const recentInv = db.prepare(
          "SELECT invoice_number, total, status FROM invoices ORDER BY id DESC LIMIT 5"
        ).all();
        lines.push('', 'PAGINA ACTUAL: Facturas');
        lines.push('Facturas recientes: ' + (recentInv.map(
          i => i.invoice_number + ' ' + sym + i.total + ' [' + i.status + ']'
        ).join(', ') || 'ninguna'));
      }

      return lines.join('\n');
    } catch (err) {
      console.error('[DISA] buildBusinessContext ERROR:', err.message, err.stack?.split('\n')[1]);
      return 'No hay datos disponibles aun.';
    }
  }

  // ── Summary (métricas + alertas sin llamada a Claude) ─────

  router.get('/summary', adminAuth(db), c => {
    try {
      const cfg = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get() || {};
      const sym = cfg.currency_symbol || '€';

      const sales = db.prepare(`
        SELECT COUNT(*) as orders,
               COALESCE(SUM(subtotal),0) as revenue
        FROM sales_orders
        WHERE status NOT IN ('cancelado','reembolsado','borrador')
        AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
      `).get() || {};

      // PIEZA 2a — misma DEFINICION UNICA de "pedido pendiente de entrega" que el resumen:
      // documento Pedido (customer_orders) confirmado. Coherente en todas las superficies.
      const pending = db.prepare(`
        SELECT COUNT(*) as count FROM customer_orders WHERE status='confirmado'
      `).get() || {};

      const alerts = [];

      const lowStock = db.prepare(`
        SELECT name, stock FROM products
        WHERE status='active' AND stock <= 5
        ORDER BY stock ASC LIMIT 5
      `).all();
      if (lowStock.length > 0) {
        const critical = lowStock.filter(p => p.stock === 0).length;
        alerts.push({
          type: critical > 0 ? 'danger' : 'warn',
          title: 'Stock bajo',
          body: lowStock.map(p => p.name + ' (' + p.stock + ' uds)').join(', '),
          href: '/admin/inventory',
          action: 'Ver inventario'
        });
      }

      const stale = db.prepare(`
        SELECT COUNT(*) as count FROM sales_orders
        WHERE status='en_preparacion'
        AND created_at < date('now', '-3 days')
      `).get() || {};
      if ((stale.count || 0) > 0) {
        alerts.push({
          type: 'warn',
          title: 'Pedidos bloqueados',
          body: stale.count + ' pedido' + (stale.count > 1 ? 's llevan' : ' lleva') + ' más de 3 días sin enviar',
          href: '/admin/orders',
          action: 'Ver pedidos'
        });
      }

      let inactiveCount = 0;
      try {
        const row = db.prepare(`
          SELECT COUNT(*) as count FROM clients
          WHERE active=1
          AND NOT EXISTS (
            SELECT 1 FROM sales_orders so
            WHERE so.client_id = clients.id
            AND so.created_at >= date('now', '-30 days')
            AND so.status = 'completado'
          )
        `).get();
        inactiveCount = row?.count || 0;
      } catch {}
      if (inactiveCount > 0) {
        alerts.push({
          type: 'info',
          title: 'Clientes inactivos',
          body: inactiveCount + ' cliente' + (inactiveCount > 1 ? 's' : '') + ' sin compra en 30 días',
          href: '/admin/clients',
          action: 'Ver clientes'
        });
      }

      const noDesc = db.prepare(`
        SELECT COUNT(*) as count FROM products
        WHERE status='active' AND (description IS NULL OR description='')
      `).get() || {};
      if ((noDesc.count || 0) > 0) {
        alerts.push({
          type: 'info',
          title: 'Sin descripción',
          body: noDesc.count + ' producto' + (noDesc.count > 1 ? 's' : '') + ' sin descripción',
          href: '/admin/products',
          action: 'Ver productos'
        });
      }

      return c.json({
        metrics: {
          revenue: Number(sales.revenue || 0),
          orders: sales.orders || 0,
          pending: pending.count || 0,
          currency: sym
        },
        alerts
      });
    } catch (err) {
      console.error('[DISA] summary error:', err);
      return c.json({ metrics: { revenue: 0, orders: 0, pending: 0, currency: '€' }, alerts: [] });
    }
  });

  // ── Vista ─────────────────────────────────────────────────

  router.get('/', adminAuth(db), c => {
    const session = c.get('session');
    const prefill = c.req.query('q') || '';
    const usage = getUsage(db);
    const limit = 50;
    const tenantSlugView = c.get('tenant')?.slug;
    const isDevView = process.env.NODE_ENV !== 'production' || tenantSlugView === 'dev';
    const thread = db.prepare('SELECT * FROM disa_conversation_threads WHERE is_active=1 AND user_id=? ORDER BY updated_at DESC LIMIT 1').get(session?.userId || null) || null;
    const conv = thread ? getConversationForThread(db, thread.id) : null;
    const messages = conv ? JSON.parse(conv.messages || '[]') : [];
    const csrf = getCsrfToken(c);

    const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const renderMsgHtml = m => {
      const isUser = m.role === 'user';
      return '<div style="display:flex;justify-content:' + (isUser ? 'flex-end' : 'flex-start') + '">'
        + '<div style="max-width:80%;padding:10px 14px;border-radius:12px;font-size:13px;line-height:1.6;'
        + (isUser
          ? 'background:var(--accent);color:#fff;border-bottom-right-radius:3px'
          : 'background:#FFFFFF;border:1px solid var(--border);color:var(--text);border-bottom-left-radius:3px')
        + '">' + esc(m.content).replace(/\\n/g, '<br>') + '</div></div>';
    };

    const usagePct = Math.min(100, (usage / limit) * 100).toFixed(1);
    const threadTitle = thread ? esc(thread.title || 'Nueva conversación') : '';
    const csrfJson = JSON.stringify(csrf);
    const prefillCode = prefill
      ? 'var inp=document.getElementById("msgInput");if(inp){inp.value=' + JSON.stringify(prefill) + ';inp.focus();}'
      : '';

    const emptyState = '<div id="emptyState" style="text-align:center;padding:40px 24px;color:var(--text2)">'
      + '<div style="font-size:30px;margin-bottom:10px;color:var(--accent);opacity:.5">✦</div>'
      + '<div style="font-size:15px;font-weight:500;color:var(--text2);margin-bottom:6px">Hola, soy DISA</div>'
      + '<div style="font-size:13px">Pregúntame lo que necesites sobre tu negocio</div>'
      + '</div>';

    const inputHTML = '<div style="display:flex;gap:8px">'
      + '<textarea id="msgInput" rows="2" placeholder="Escribe tu mensaje..." '
      + 'style="flex:1;padding:10px 14px;border:1px solid var(--border2);border-radius:10px;'
      + 'font-size:13px;font-family:inherit;resize:none;outline:none;background:#FFFFFF;'
      + 'color:var(--text);transition:border-color .15s;scrollbar-width:thin" '
      + 'onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();disaSend()}" '
      + 'onfocus="this.style.borderColor=\'var(--accent)\'" onblur="this.style.borderColor=\'var(--border2)\'"></textarea>'
      + '<input type="file" id="disaFilePage" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" style="display:none" onchange="disaAttach()">'
      + '<button onclick="document.getElementById(\'disaFilePage\').click()" title="Adjuntar factura (foto o PDF)" '
      + 'style="background:#FFFFFF;color:var(--text2);border:1px solid var(--border2);border-radius:10px;'
      + 'padding:0 14px;font-size:16px;cursor:pointer;font-family:inherit;align-self:stretch">📎</button>'
      + '<button onclick="disaSend()" style="background:var(--accent);color:#fff;border:none;border-radius:10px;'
      + 'padding:0 18px;font-size:13px;font-weight:500;cursor:pointer;font-family:inherit;align-self:stretch;'
      + 'white-space:nowrap">Enviar</button>'
      + '</div>'
      + '<div style="font-size:11px;color:var(--text2);margin-top:6px">Shift+Enter para nueva línea</div>';

    const limitHTML = '<div style="background:var(--danger-s);color:var(--danger);padding:10px 14px;'
      + 'border-radius:8px;font-size:13px;text-align:center;border:1px solid var(--border)">'
      + 'Límite de ' + limit + ' mensajes alcanzado este mes.</div>';

    const body = `
<style>
  .dt-panel{width:240px;background:#F9FAFB;border-right:1px solid var(--border);
    display:flex;flex-direction:column;flex-shrink:0;transition:transform .22s}
  .dt-item{position:relative;padding:8px 10px;border-radius:7px;cursor:pointer;margin:0 4px;
    border:1px solid transparent;transition:background .12s}
  .dt-item:hover{background:#F3F4F6}
  .dt-item.dt-active{background:rgba(58,65,80,0.12);border-color:rgba(58,65,80,0.25)}
  .dt-title{font-size:12px;font-weight:500;color:var(--text2);white-space:nowrap;overflow:hidden;
    text-overflow:ellipsis;padding-right:44px}
  .dt-item.dt-active .dt-title{color:var(--accent)}
  .dt-title-input{font-size:12px;font-weight:500;color:var(--text2);background:#F3F4F6;
    border:1px solid var(--accent);border-radius:4px;padding:1px 5px;width:calc(100% - 48px);
    outline:none;font-family:inherit}
  .dt-meta{font-size:10px;color:var(--text3);margin-top:1px}
  .dt-actions{position:absolute;top:50%;right:6px;transform:translateY(-50%);display:flex;
    align-items:center;gap:1px;opacity:0;transition:opacity .12s}
  .dt-item:hover .dt-actions{opacity:1}
  .dt-pin,.dt-del{background:none;border:none;cursor:pointer;color:var(--text3);
    padding:3px;border-radius:4px;line-height:1;display:flex;align-items:center;justify-content:center}
  .dt-pin:hover{color:var(--accent);background:rgba(58,65,80,0.12)}
  .dt-pin.pinned{color:var(--accent);opacity:1!important}
  .dt-del:hover{color:#ef4444;background:rgba(239,68,68,0.1)}
  .dt-actions.has-pinned{opacity:1}
  .dt-sep{font-size:9px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;
    color:var(--text3);padding:8px 12px 3px;flex-shrink:0}
  @keyframes tdot{0%,60%,100%{opacity:.25;transform:scale(.8)}30%{opacity:1;transform:scale(1.1)}}
  @media(max-width:900px){
    .dt-panel{position:fixed;top:0;left:240px;height:100vh;z-index:95;
      transform:translateX(-101%);box-shadow:4px 0 20px rgba(0,0,0,0.4)}
    .dt-panel.dt-open{transform:translateX(0)}
    #dtMobileBtn{display:flex!important}
  }
</style>

<div style="display:flex;height:calc(100vh - 52px);margin:-1.5rem;overflow:hidden">

  <div class="dt-panel" id="dtPanel">
    <div style="padding:12px 10px;border-bottom:1px solid var(--border);flex-shrink:0">
      <button onclick="dtNewThread()"
        style="width:100%;background:var(--accent);color:#fff;border:none;border-radius:8px;padding:8px;
               font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;display:flex;
               align-items:center;justify-content:center;gap:5px;transition:opacity .15s">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Nueva conversación
      </button>
    </div>
    <div id="dtList" style="flex:1;overflow-y:auto;padding:6px 4px;display:flex;flex-direction:column;
      gap:1px;scrollbar-width:thin;scrollbar-color:rgba(58,65,80,0.18) transparent"></div>
  </div>

  <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;padding:1rem 1.5rem">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-shrink:0">
      <button id="dtMobileBtn" onclick="dtTogglePanel()"
        style="display:none;background:#F3F4F6;border:1px solid var(--border);
               border-radius:7px;padding:5px 8px;cursor:pointer;color:var(--text2);align-items:center;
               gap:5px;font-size:12px;font-family:inherit">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="3" y1="12" x2="21" y2="12"/>
          <line x1="3" y1="6" x2="21" y2="6"/>
          <line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </button>
      <div style="flex:1;min-width:0">
        <div id="dtCurrentTitle" style="font-size:13px;font-weight:500;color:var(--text);
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${threadTitle}</div>
      </div>
      <span style="font-size:11px;color:var(--text2);flex-shrink:0">${usage}/${limit}</span>
    </div>

    <div style="height:2px;background:#F3F4F6;margin-bottom:12px;flex-shrink:0;
      border-radius:2px;overflow:hidden">
      <div style="height:100%;width:${usagePct}%;background:var(--accent);transition:width .3s"></div>
    </div>

    <div id="chatArea" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:10px;
      padding:0 2px;scrollbar-width:thin;scrollbar-color:rgba(58,65,80,0.18) transparent">
      ${messages.length === 0 ? emptyState : messages.map(renderMsgHtml).join('')}
      <div id="typingIndicator" style="display:none">
        <div style="background:#FFFFFF;border:1px solid var(--border);
          padding:10px 14px;border-radius:12px;border-bottom-left-radius:3px;
          display:inline-flex;gap:4px;align-items:center">
          <span style="width:5px;height:5px;border-radius:50%;background:var(--text2);animation:tdot 1.4s infinite"></span>
          <span style="width:5px;height:5px;border-radius:50%;background:var(--text2);animation:tdot 1.4s infinite .2s"></span>
          <span style="width:5px;height:5px;border-radius:50%;background:var(--text2);animation:tdot 1.4s infinite .4s"></span>
        </div>
      </div>
    </div>

    <div style="flex-shrink:0;padding-top:12px;border-top:1px solid var(--border);margin-top:10px">
      ${(!isDevView && usage >= limit) ? limitHTML : inputHTML}
    </div>
  </div>
</div>

<script>
(function(){
  var csrf = ${csrfJson};
  window.disaActiveThreadId = ${thread ? thread.id : 'null'};

  function relTime(s) {
    if (!s) return '';
    var d = new Date(s.indexOf('T') !== -1 ? s : s + 'Z');
    var diff = Date.now() - d.getTime();
    if (diff < 60000) return 'ahora';
    if (diff < 3600000) return 'hace ' + Math.floor(diff/60000) + 'm';
    if (diff < 86400000) return 'hace ' + Math.floor(diff/3600000) + 'h';
    return 'hace ' + Math.floor(diff/86400000) + 'd';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function clearChatArea() {
    var area = document.getElementById('chatArea');
    var typing = document.getElementById('typingIndicator');
    var kids = Array.from(area.childNodes).filter(function(n){ return n !== typing; });
    kids.forEach(function(n){ n.remove(); });
  }

  function showEmpty(line1, line2) {
    var area = document.getElementById('chatArea');
    var typing = document.getElementById('typingIndicator');
    clearChatArea();
    var el = document.createElement('div');
    el.id = 'emptyState';
    el.style.cssText = 'text-align:center;padding:40px 24px;color:var(--text2)';
    el.innerHTML = '<div style="font-size:30px;margin-bottom:10px;color:var(--accent);opacity:.5">✦</div>'
      + '<div style="font-size:15px;font-weight:500;color:var(--text2);margin-bottom:6px">' + esc(line1) + '</div>'
      + '<div style="font-size:13px;color:var(--text2)">' + esc(line2) + '</div>';
    area.insertBefore(el, typing);
  }

  function addMsgDOM(role, content) {
    var area = document.getElementById('chatArea');
    var typing = document.getElementById('typingIndicator');
    var div = document.createElement('div');
    div.style.cssText = 'display:flex;justify-content:' + (role === 'user' ? 'flex-end' : 'flex-start');
    div.innerHTML = '<div style="max-width:80%;padding:10px 14px;border-radius:12px;font-size:13px;line-height:1.6;'
      + (role === 'user'
        ? 'background:var(--accent);color:#fff;border-bottom-right-radius:3px'
        : 'background:#FFFFFF;border:1px solid var(--border);color:var(--text);border-bottom-left-radius:3px')
      + '">' + esc(content).replace(/\\n/g,'<br>') + '</div>';
    area.insertBefore(div, typing);
    area.scrollTop = area.scrollHeight;
  }

  function showTyping(show) {
    var t = document.getElementById('typingIndicator');
    if (t) t.style.display = show ? 'block' : 'none';
    if (show) document.getElementById('chatArea').scrollTop = 9999;
  }

  function dtItemHTML(t) {
    var cls = t.id === window.disaActiveThreadId ? ' dt-active' : '';
    var pinCls = t.pinned ? ' pinned' : '';
    var actionsCls = t.pinned ? ' has-pinned' : '';
    var title = esc(t.title || 'Nueva conversación');
    return '<div class="dt-item' + cls + '" id="dti-' + t.id + '" onclick="dtLoad(' + t.id + ')" ondblclick="event.stopPropagation();dtStartRename(' + t.id + ')">'
      + '<div class="dt-title" id="dtt-' + t.id + '">' + title + '</div>'
      + '<div class="dt-meta">' + esc(relTime(t.updated_at)) + '</div>'
      + '<div class="dt-actions' + actionsCls + '">'
      + '<button class="dt-pin' + pinCls + '" onclick="event.stopPropagation();dtPin(' + t.id + ')" title="' + (t.pinned ? 'Desfijar' : 'Fijar') + '">'
      + '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>'
      + '</button>'
      + '<button class="dt-del" onclick="event.stopPropagation();dtDelete(' + t.id + ')" title="Eliminar">'
      + '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">'
      + '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>'
      + '</svg></button></div></div>';
  }

  async function loadThreads() {
    try {
      var res = await fetch('/api/disa/threads', { headers: { 'x-csrf-token': csrf } });
      if (!res.ok) return;
      var threads = await res.json();
      var list = document.getElementById('dtList');
      if (!list) return;
      if (!threads.length) {
        list.innerHTML = '<div style="padding:14px 10px;font-size:11px;color:var(--text3);text-align:center">Sin conversaciones</div>';
        return;
      }
      var pinned = threads.filter(function(t){ return t.pinned; });
      var recent = threads.filter(function(t){ return !t.pinned; });
      var html = '';
      if (pinned.length) {
        html += '<div class="dt-sep">Fijadas</div>' + pinned.map(dtItemHTML).join('');
        if (recent.length) html += '<div class="dt-sep">Recientes</div>';
      }
      html += recent.map(dtItemHTML).join('');
      list.innerHTML = html;
    } catch(e) { console.error('[DISA] loadThreads', e); }
  }

  window.dtLoad = async function(id) {
    if (window.disaActiveThreadId === id) { dtClosePanel(); return; }
    window.disaActiveThreadId = id;
    try {
      var res = await fetch('/api/disa/threads/' + id, { headers: { 'x-csrf-token': csrf } });
      var data = await res.json();
      clearChatArea();
      if (!data.messages || !data.messages.length) {
        showEmpty('Nueva conversación', 'Haz tu primera pregunta');
      } else {
        data.messages.forEach(function(m){ addMsgDOM(m.role, m.content); });
      }
      var titleEl = document.getElementById('dtCurrentTitle');
      if (titleEl) titleEl.textContent = data.title || 'Nueva conversación';
      document.getElementById('chatArea').scrollTop = 9999;
      loadThreads();
      dtClosePanel();
    } catch(e) { console.error('[DISA] dtLoad', e); }
  };

  window.dtNewThread = async function() {
    try {
      var res = await fetch('/api/disa/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf }
      });
      var t = await res.json();
      window.disaActiveThreadId = t.id;
      showEmpty('Nueva conversación', 'Haz tu primera pregunta');
      var titleEl = document.getElementById('dtCurrentTitle');
      if (titleEl) titleEl.textContent = 'Nueva conversación';
      await loadThreads();
      dtClosePanel();
      var inp = document.getElementById('msgInput');
      if (inp) inp.focus();
    } catch(e) { console.error('[DISA] dtNewThread', e); }
  };

  window.dtDelete = async function(id) {
    try {
      await fetch('/api/disa/threads/' + id, { method: 'DELETE', headers: { 'x-csrf-token': csrf } });
      if (window.disaActiveThreadId === id) {
        window.disaActiveThreadId = null;
        clearChatArea();
        showEmpty('DISA', 'Selecciona o crea una conversación');
        var titleEl = document.getElementById('dtCurrentTitle');
        if (titleEl) titleEl.textContent = '';
      }
      await loadThreads();
    } catch(e) { console.error('[DISA] dtDelete', e); }
  };

  window.dtPin = async function(id) {
    try {
      await fetch('/api/disa/threads/' + id + '/pin', { method: 'POST', headers: { 'x-csrf-token': csrf } });
      await loadThreads();
    } catch(e) { console.error('[DISA] dtPin', e); }
  };

  window.dtStartRename = function(id) {
    var titleEl = document.getElementById('dtt-' + id);
    if (!titleEl || titleEl.querySelector('input')) return;
    var current = titleEl.textContent.trim();
    var input = document.createElement('input');
    input.className = 'dt-title-input';
    input.value = current;
    titleEl.innerHTML = '';
    titleEl.appendChild(input);
    input.focus();
    input.select();
    var done = false;
    async function commit() {
      if (done) return; done = true;
      var val = input.value.trim();
      if (val && val !== current) {
        try {
          await fetch('/api/disa/threads/' + id + '/title', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
            body: JSON.stringify({ title: val })
          });
          if (window.disaActiveThreadId === id) {
            var hdr = document.getElementById('dtCurrentTitle');
            if (hdr) hdr.textContent = val;
          }
        } catch(e) { console.error('[DISA] rename', e); }
      }
      await loadThreads();
    }
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { done = true; loadThreads(); }
    });
    input.addEventListener('blur', commit);
    input.addEventListener('click', function(e){ e.stopPropagation(); });
  };

  function dtClosePanel() {
    var p = document.getElementById('dtPanel');
    if (p) p.classList.remove('dt-open');
  }

  window.dtTogglePanel = function() {
    var p = document.getElementById('dtPanel');
    if (p) p.classList.toggle('dt-open');
  };

  // Adjuntar factura de proveedor desde la página de asistente IA: mismo endpoint que el
  // widget y el dashboard. DISA la lee con el extractor de C2 y lleva a la pantalla de
  // revisión EDITABLE precargada. Nada se guarda hasta confirmar allí (confirm-first).
  window.disaAttach = async function() {
    var inp = document.getElementById('disaFilePage');
    if (!inp) return;
    var f = inp.files[0];
    if (!f) return;
    inp.value = '';
    var empty = document.getElementById('emptyState'); if (empty) empty.remove();
    addMsgDOM('user', '📄 ' + f.name);
    showTyping(true);
    try {
      var fd = new FormData(); fd.append('file', f);
      var res = await fetch('/api/disa/attach', { method: 'POST', headers: { 'x-csrf-token': csrf }, body: fd });
      var data = await res.json();
      showTyping(false);
      if (!res.ok || data.error) { addMsgDOM('assistant', data.error || 'No pude procesar el archivo.'); return; }
      addMsgDOM('assistant', data.reply || 'Listo.');
      if (data.capture_url) setTimeout(function(){ window.location.href = data.capture_url; }, 900);
    } catch {
      showTyping(false);
      addMsgDOM('assistant', 'Error al subir la factura.');
    }
  };

  window.disaSend = async function() {
    var input = document.getElementById('msgInput');
    if (!input) return;
    var msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    var empty = document.getElementById('emptyState');
    if (empty) empty.remove();
    addMsgDOM('user', msg);
    showTyping(true);
    try {
      var res = await fetch('/api/disa/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ message: msg, agent_id: 1, thread_id: window.disaActiveThreadId })
      });
      var data = await res.json();
      showTyping(false);
      addMsgDOM('assistant', res.ok ? (data.reply || 'Sin respuesta.') : (data.error || 'Error.'));
      if (data.thread_id) window.disaActiveThreadId = data.thread_id;
      loadThreads();
      // Handoff a pantalla (p.ej. dictar una compra por voz): navega al enlace de la accion
      // (mismo mecanismo que el adjunto de factura).
      if (data.capture_url) setTimeout(function(){ window.location.href = data.capture_url; }, 900);
    } catch {
      showTyping(false);
      addMsgDOM('assistant', 'Error de conexión. Inténtalo de nuevo.');
    }
  };

  window.addEventListener('load', function() {
    loadThreads();
    document.getElementById('chatArea').scrollTop = 9999;
    ${prefillCode}
  });
})();
</script>`;

    return c.html(adminLayout('DISA', body, 'disa', session?.csrfToken || '', c, true));
  });

  // ── API ──────────────────────────────────────────────────

  router.post('/select-agent', adminAuth(db), async c => {
    let b;
    try { b = await c.req.json(); } catch { return c.json({ ok: false }, 400); }
    const agentId = parseInt(b?.agent_id) || 1;
    try {
      db.prepare('UPDATE disa_conversations SET agent_id=? WHERE id=(SELECT MIN(id) FROM disa_conversations)')
        .run(agentId);
    } catch {}
    return c.json({ ok: true });
  });

  router.get('/agents', adminAuth(db), c => {
    let agents = [];
    try {
      agents = db.prepare('SELECT id, name, icon, slug FROM disa_agents WHERE active=1 ORDER BY id').all();
    } catch {}
    let currentAgentId = 1;
    try {
      const conv = db.prepare('SELECT agent_id FROM disa_conversations ORDER BY id ASC LIMIT 1').get();
      if (conv?.agent_id) currentAgentId = conv.agent_id;
    } catch {}
    return c.json({ agents, current_agent_id: currentAgentId });
  });

  // ── Thread endpoints ─────────────────────────────────────

  router.get('/threads', adminAuth(db), c => {
    const session = c.get('session');
    console.log('[DISA THREADS] userId:', session?.userId, 'role:', session?.role);
    const threads = db.prepare(`
      SELECT t.id, t.title, t.pinned, t.created_at, t.updated_at
      FROM disa_conversation_threads t
      WHERE t.is_active = 1 AND t.user_id = ?
      ORDER BY t.pinned DESC, t.updated_at DESC
    `).all(session?.userId || null);
    return c.json(threads);
  });

  router.get('/threads/:id', adminAuth(db), c => {
    const threadId = parseInt(c.req.param('id'));
    const session = c.get('session');
    const thread = db.prepare('SELECT * FROM disa_conversation_threads WHERE id=? AND is_active=1 AND user_id=?').get(threadId, session?.userId || null);
    if (!thread) return c.json({ error: 'Thread no encontrado' }, 404);
    const convRows = db.prepare(
      'SELECT messages FROM disa_conversations WHERE thread_id=? ORDER BY id ASC'
    ).all(threadId);
    const messages = convRows.flatMap(row => {
      try { return JSON.parse(row.messages || '[]'); } catch { return []; }
    });
    return c.json({ id: thread.id, title: thread.title, created_at: thread.created_at, updated_at: thread.updated_at, messages });
  });

  router.post('/threads', adminAuth(db), c => {
    const session = c.get('session');
    const r = db.prepare('INSERT INTO disa_conversation_threads (user_id) VALUES (?)').run(session?.userId || null);
    const thread = db.prepare('SELECT * FROM disa_conversation_threads WHERE id=?').get(r.lastInsertRowid);
    return c.json({ id: thread.id, title: thread.title });
  });

  router.delete('/threads/:id', adminAuth(db), c => {
    const threadId = parseInt(c.req.param('id'));
    const session = c.get('session');
    db.prepare('UPDATE disa_conversation_threads SET is_active=0, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?').run(threadId, session?.userId || null);
    return c.json({ ok: true });
  });

  router.post('/threads/:id/title', adminAuth(db), async c => {
    const threadId = parseInt(c.req.param('id'));
    const session = c.get('session');
    let body;
    try { body = await c.req.json(); } catch { return c.json({ ok: false }, 400); }
    const title = (body?.title || '').trim().substring(0, 100);
    if (!title) return c.json({ ok: false, error: 'Título vacío' }, 400);
    db.prepare('UPDATE disa_conversation_threads SET title=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?').run(title, threadId, session?.userId || null);
    return c.json({ ok: true });
  });

  router.post('/threads/:id/pin', adminAuth(db), c => {
    const threadId = parseInt(c.req.param('id'));
    const session = c.get('session');
    const row = db.prepare('SELECT pinned FROM disa_conversation_threads WHERE id=? AND is_active=1 AND user_id=?').get(threadId, session?.userId || null);
    if (!row) return c.json({ ok: false }, 404);
    const newPinned = row.pinned ? 0 : 1;
    db.prepare('UPDATE disa_conversation_threads SET pinned=? WHERE id=?').run(newPinned, threadId);
    return c.json({ ok: true, pinned: newPinned });
  });

  // ── Store Builder chat ────────────────────────────────────
  router.post('/store-message', adminAuth(db), async c => {
    let body;
    try { body = await c.req.json(); } catch { return c.json({ ok: false }, 400); }
    const message = (body?.message || '').trim().substring(0, 2000);
    if (!message) return c.json({ reply: 'Mensaje vacío.', action: null });
    const history = Array.isArray(body?.history) ? body.history.slice(-8) : [];
    const ss = body?.store_state || {};

    if (!hasAnthropicKey()) return c.json({ reply: 'DISA no está configurada (sin API key).', action: null });

    const systemPrompt = [
      'Eres el constructor web de Bamburu. Ayudas a crear y personalizar tiendas online para pequeñas empresas hispanohablantes.',
      '',
      'Temas disponibles: minimal_light, minimal_dark, nordic_forest, bold_tech, vintage_warm.',
      'Secciones disponibles: hero, featured_products, features, testimonials, newsletter.',
      '',
      'Estado actual de la tienda:',
      '- Nombre: ' + (ss.store_name || 'Sin nombre'),
      '- Tema: ' + (ss.theme || 'minimal_light'),
      '- Color: ' + (ss.primary_color || '#10b981'),
      '- Secciones: ' + ((ss.sections || []).map(s => s.type).join(', ') || 'ninguna'),
      '',
      'Reglas:',
      '1. Responde en español, de forma concisa y amigable.',
      '2. Cuando el usuario pide un cambio, incluye [ACCION:{...}] AL FINAL de tu respuesta.',
      '3. Solo UN bloque [ACCION:...] por respuesta.',
      '4. Si el usuario está empezando, guíale paso a paso preguntando qué vende, nombre, y estilo.',
      '',
      'Acciones disponibles:',
      '[ACCION:{"type":"update_store_theme","params":{"theme":"nordic_forest"}}]',
      '[ACCION:{"type":"update_store_color","params":{"primary_color":"#1a365d"}}]',
      '[ACCION:{"type":"update_store_text","params":{"field":"store_name","value":"Mi Tienda"}}]',
      '[ACCION:{"type":"add_section","params":{"type":"testimonials"}}]',
      '[ACCION:{"type":"remove_section","params":{"type":"newsletter"}}]',
      '[ACCION:{"type":"update_section","params":{"type":"hero","settings":{"title":"Nuevo título","subtitle":"Subtítulo"}}}]',
      '[ACCION:{"type":"apply_template","params":{"template":"nordic_forest"}}]',
      '[ACCION:{"type":"reorder_sections","params":{"order":[1,0,2,3]}}]',
    ].join('\n');

    const messages = [
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message }
    ];

    try {
      // Vía core/llm.js (callClaude): clave + transporte centralizados. Mismo modelo
      // (haiku), max_tokens, prompt y mensajes. Si falla la red/API, callClaude lanza →
      // lo captura el catch de abajo, que devuelve el MISMO { reply, action } (200).
      const data = await callClaude({
        model: 'claude-haiku-4-5-20251001', max_tokens: 800, system: systemPrompt, messages, billDb: db,
      });
      const raw = data.content?.[0]?.text || 'Sin respuesta.';
      let action = null;
      let reply = raw;
      const match = raw.match(/\[ACCION:(\{[\s\S]*?\})\]/);
      if (match) {
        try { action = JSON.parse(match[1]); reply = raw.replace(/\[ACCION:[\s\S]*?\]/, '').trim(); } catch {}
      }
      return c.json({ reply, action });
    } catch(e) {
      return c.json({ reply: 'Error al conectar con DISA.', action: null });
    }
  });

  router.get('/chips', adminAuth(db), c => {
    const session = c.get('session');
    const row = db.prepare('SELECT chips FROM disa_quick_chips WHERE user_id=?').get(session?.userId);
    const defaults = ['Resumen del día', 'Top productos', 'Clientes inactivos'];
    if (!row) return c.json(defaults);
    try { const chips = JSON.parse(row.chips); return c.json(Array.isArray(chips) && chips.length ? chips : defaults); }
    catch { return c.json(defaults); }
  });

  router.post('/chips', adminAuth(db), async c => {
    let body;
    try { body = await c.req.json(); } catch { return c.json({ ok: false }, 400); }
    const chips = Array.isArray(body?.chips)
      ? body.chips.slice(0, 3).map(s => String(s).trim().substring(0, 60)).filter(Boolean)
      : [];
    if (!chips.length) return c.json({ ok: false, error: 'Chips vacíos' }, 400);
    const session = c.get('session');
    db.prepare('INSERT OR REPLACE INTO disa_quick_chips (user_id, chips, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(session?.userId, JSON.stringify(chips));
    return c.json({ ok: true });
  });

  router.post('/message',
    rateLimit({ windowMs: 60000, max: 15, keyPrefix: 'disa-message', message: 'Vas demasiado rápido con DISA. Espera un momento.' }),
    adminAuth(db), async c => {
    const usage = getUsage(db);
    const limit = 50;
    const tenantSlug = c.get('tenant')?.slug;
    const isDev = process.env.NODE_ENV !== 'production' || tenantSlug === 'dev';
    if (!isDev && usage >= limit)
      return c.json({ error: 'Has alcanzado el limite de mensajes este mes.' }, 429);

    let body;
    try { body = await c.req.json(); } catch {
      return c.json({ error: 'Cuerpo de la peticion invalido.' }, 400);
    }

    const message = body?.message?.trim();
    if (!message) return c.json({ error: 'Mensaje vacio.' }, 400);

    const agentId = parseInt(body?.agent_id) || 1;
    let agent = null;
    try {
      agent = db.prepare('SELECT * FROM disa_agents WHERE id=? AND active=1').get(agentId);
    } catch {}

    const currentPage = (c.req.header('x-current-page') || '').replace(/[^a-z0-9_-]/gi, '');
    const session = c.get('session');
    const threadIdParam = parseInt(body?.thread_id) || null;
    let thread;
    if (threadIdParam) {
      thread = db.prepare('SELECT * FROM disa_conversation_threads WHERE id=? AND is_active=1 AND user_id=?').get(threadIdParam, session?.userId || null);
      if (!thread) return c.json({ error: 'Thread no encontrado.' }, 404);
    } else {
      thread = getOrCreateActiveThread(db, session?.userId);
    }
    const conv = getConversationForThread(db, thread.id);
    const isFirstMessage = JSON.parse(conv.messages || '[]').length === 0;
    const history = JSON.parse(conv.messages || '[]');
    const context = buildBusinessContext(db, currentPage, session);
    const dbSchema = getDbSchema(db);

    const agentIdentity = agent?.system_prompt || [
      'Eres DISA, asistente de inteligencia artificial del ERP Bamburu.',
      'Bamburu es un sistema de gestion para autonomos y pequenos negocios hispanohablantes.',
      'Hablas en espanol, eres directa, profesional y honesta. Sin emojis. Vas al grano.',
    ].join('\n');

    // T5 — valores EXACTOS de los campos de lista cerrada del cliente, desde el esquema real
    // (no escritos a mano → no se desincronizan). DISA debe usar solo estos, nunca inventar.
    const ctVals = (clientFieldOptions.client_type || []).join(' | ');
    const pmVals = (clientFieldOptions.payment_method || []).map(v => v === '' ? '"" (en blanco)' : v).join(' | ');
    // [Voz DISA stock] Motivos de ajuste de lista cerrada, desde el esquema real (no a mano).
    const arVals = (ADJUST_REASONS || []).join(' | ');
    // [D5] Bandas de IVA legales del país, desde la fuente única (core/vat-bands.js) — la MISMA
    // lista cerrada que valida el formulario/API. DISA elige el CODE; el % lo deriva el servidor.
    const cfgVat = (() => { try { return db.prepare('SELECT country, tax_rate FROM company_config WHERE id=1').get() || {}; } catch { return {}; } })();
    const vatVals = getVatBands((cfgVat.country || 'ES').toUpperCase(), cfgVat.tax_rate != null ? cfgVat.tax_rate : 21)
      .map(b => b.code + ' (' + b.rate + '%)').join(' | ');

    const systemPrompt = [
      agentIdentity,
      '',
      '## CAPACIDADES Y LIMITES',
      '',
      'PUEDES HACER:',
      '- Leer cualquier dato del negocio (productos, pedidos, clientes, inventario, ventas, facturas, compras).',
      '- Buscar y consultar clientes, e identificarlos por nombre antes de actuar (ver CLIENTES ACTIVOS).',
      '- Gestionar clientes (crear, editar, archivar, restaurar) por la via validada, con confirmacion.',
      '- Consultar inventario y compras: stock global y por almacen, valoracion a coste (WAC), ultimo coste de',
      '  compra, historico de compras, pedidos/recepciones pendientes, traslados y devoluciones (ver INVENTARIO).',
      '- Operar el stock por la via validada, con confirmacion: trasladar entre almacenes (transfer_stock) y',
      '  ajustar stock (adjust_stock). Identifica producto y almacen por nombre antes; las guardas las pone el servicio.',
      '- Registrar una compra de proveedor DICTANDOLA (dictar_compra): la preparas y llevas al usuario a la',
      '  pantalla de revision para que confirme ahi (no se confirma de palabra).',
      '- Mostrar respuestas visuales con artifacts (KPIs, listas, numeros).',
      '- Si el usuario es admin/owner: ejecutar cambios (crear, editar, eliminar registros,',
      '  ajustar stock, generar facturas) SIEMPRE pidiendo confirmacion previa.',
      '',
      'NO PUEDES HACER:',
      '- GESTIONAR PEDIDOS de venta NI ALBARANES/entregas (los documentos "Pedido" y "Albaran": crear, confirmar, entregar, anular o eliminar) POR CHAT en esta version. LEERLOS si puedes (cuantos pendientes, borradores, que falta por entregar, ver uno). Ante una peticion de gestionarlos, DECLINA con un mensaje claro y redirige a la pantalla (/admin/pedidos o /admin/albaranes); NO pidas confirmacion ni intentes insert/update/delete sobre customer_orders/customer_order_items/delivery_notes/delivery_note_items.',
      '- Acceder a datos de otros negocios.',
      '- Modificar usuarios admin, sesiones ni la BD central del sistema.',
      '- Enviar SMS ni hacer llamadas. El UNICO email que puedes enviar es el recordatorio de',
      '  cobro (register_collection_action, type=recordatorio_email), y SOLO con confirmacion previa.',
      '- Inventar datos, URLs o capacidades. Si no sabes algo, dilo.',
      '',
      'REGLA DE ORO:',
      'Si tienes dudas si algo es real o inventado, NO lo digas.',
      '"No tengo ese dato" y "no puedo hacer eso aun" son respuestas validas y honestas.',
      '',
      '## TERMINOLOGIA DE VENTAS',
      '',
      '- "Ventas" o "ingresos" = venta neta (subtotal, SIN IVA).',
      '- "IVA" = impuesto recaudado (tax_amount).',
      '- "Total cobrado" = subtotal + IVA (gross_revenue).',
      '- Al responder sobre ventas o dinero, da SIEMPRE el desglose: neta + IVA + total cobrado.',
      '- Nunca mezcles neto y bruto.',
      '- Interpreta la intencion: "cuanto gane" = venta neta, "monto IVA cobrado" = tax_amount, etc.',
      '- Si entiendes lo que pregunta el usuario, responde directo. Solo pide aclaracion si es genuinamente ambiguo.',
      '',
      '## FORMATO DE RESPUESTA — REGLA CRITICA',
      '',
      'Tienes DOS modos. Usa UNO solo por mensaje. NUNCA los mezcles.',
      '',
      'MODO 1 — TEXTO PLANO',
      'Usalo para: saludos, conversacion, preguntas ambiguas, o cuando vas a ejecutar una accion.',
      'Formato: texto normal en espanol. Si ejecutas algo, incluye [ACCION:...] solo al final.',
      '',
      'MODO 2 — JSON CON ARTIFACT',
      'Usalo para: mostrar metricas (kpi_dashboard), listas de items (action_list), una cifra (big_number).',
      'Formato: empieza con { y termina con }. JSON puro, sin preambulo ni markdown.',
      '{"text":"frase breve de contexto","artifact":{"type":"...","data":{...}}}',
      '',
      'REGLA: datos visuales → MODO 2 | ejecutar accion → MODO 1 | conversacion → MODO 1',
      'NUNCA combines [ACCION:...] dentro de un JSON de artifact.',
      '',
      '## ARTIFACTS — TIPOS Y EJEMPLOS',
      '',
      'kpi_dashboard — resumenes con varias metricas:',
      '{"text":"Las ventas del mes van bien","artifact":{"type":"kpi_dashboard","data":{"title":"Ventas del mes","kpis":[{"label":"Ventas","value":"€320","delta":"+12%","tone":"positive"},{"label":"Pedidos","value":"8","delta":null,"tone":"neutral"}],"chart":{"type":"bars","data":[{"label":"Lun","value":320},{"label":"Mar","value":450}]},"link":{"label":"Ver Analitica","url":"/admin/analytics"}}}}',
      '',
      'action_list — listas de items. SIN campo "actions" (read-only):',
      '{"text":"2 clientes sin compras recientes","artifact":{"type":"action_list","data":{"title":"Clientes inactivos","items":[{"title":"Maria Garcia","subtitle":"45 dias sin comprar","meta":"LTV €0","tone":"warn"}],"link":{"label":"Ver clientes","url":"/admin/clients"}}}}',
      '',
      'big_number — una cifra destacada:',
      '{"text":"Ayer vendiste bien","artifact":{"type":"big_number","data":{"value":"€450","label":"Ventas de ayer","context":"6 pedidos","tone":"positive","link":{"label":"Ver pedidos","url":"/admin/orders"}}}}',
      '',
      '## URLs PERMITIDAS EN ARTIFACTS',
      '',
      'Solo estas rutas exactas (sin variaciones):',
      '/admin/products /admin/categories /admin/tags /admin/orders',
      '/admin/orders/pos /admin/orders/refunds /admin/orders/draft/new /admin/discounts',
      '/admin/inventory /admin/suppliers /admin/purchases /admin/purchases/new',
      '/admin/invoices /admin/clients /admin/clients/groups /admin/analytics',
      '/admin/store-settings /admin/settings /admin/users /admin/activity',
      '/admin/security /admin/disa /admin/newsletter /admin/reviews /admin/feedback',
      '',
      'Detalle solo con ID numerico real existente:',
      '/admin/orders/:id  /admin/orders/:id/invoice  /admin/purchases/:id  /admin/invoices/:id',
      '',
      'NO existen rutas de detalle para productos, clientes, categorias, stock ni proveedores.',
      'Para esos, enlaza siempre a la lista. Si dudas de una URL, NO la incluyas.',
      '',
      '## ACCIONES DISPONIBLES',
      '',
      'IMPORTANTE: Solo si "Puede modificar datos: SI" en USUARIO ACTUAL (ver contexto).',
      'Si el usuario NO puede modificar datos, no ofrezcas ni ejecutes acciones de cambio.',
      '',
      'Formato (siempre al FINAL del mensaje, nunca dentro de JSON):',
      '[ACCION:{"type":"nombre_accion","params":{...},"confirm":"descripcion para confirmar"}]',
      '',
      'Operaciones genericas:',
      '- insert_record: {"table":"tabla","data":{"campo":"valor",...}}',
      '- update_record: {"table":"tabla","id":0,"data":{"campo":"nuevo_valor"}}',
      '- delete_record: {"table":"tabla","id":0}',
      '  Los nombres de tabla y campo deben coincidir con el schema.',
      '',
      'Clientes (ver seccion CLIENTES ACTIVOS del contexto para el id):',
      '- create_client: {"name":"","fiscal_id":"","email":"","phone":"","address":"","city":"","client_type":"...","payment_term_days":0,"payment_method":"..."}',
      '- edit_client: {"client_id":0, ...campos a cambiar...}',
      '- deactivate_client: {"client_id":0}   (archiva; no borra)',
      '- activate_client: {"client_id":0}     (restaura un archivado)',
      '  CAMPOS DE LISTA CERRADA — usa EXACTAMENTE uno de estos valores, nunca inventes otro:',
      '    client_type: ' + ctVals,
      '    payment_method: ' + pmVals,
      '  Si lo que dice el usuario no encaja claramente con uno de la lista, deja el campo en BLANCO',
      '  (es opcional) y sigue, mencionandolo: p.ej. "no he reconocido la forma de pago, la dejo sin marcar".',
      '  Ojo: "contado"/"al contado" es un PLAZO de pago (payment_term_days=0), NO una forma de pago:',
      '  deja payment_method en blanco; no lo metas como metodo.',
      '  IDENTIFICACION OBLIGATORIA antes de cualquier accion de cliente o pedido: resuelve el',
      '  nombre a un client_id concreto con la lista CLIENTES ACTIVOS. Si hay UNO, sigue. Si hay',
      '  VARIOS que encajan, muestralos y pregunta cual. Si NO existe ninguno, ofrece crearlo con',
      '  create_client (confirmacion) y, una vez creado, continua con la accion original.',
      '  Para responder consultas de clientes ("cuales tengo en Madrid", "ficha de X") usa esa lista.',
      '',
      'Pedidos y facturacion:',
      'IMPORTANTE — hay DOS conceptos distintos de "pedido"; no los confundas:',
      '  · El DOCUMENTO "Pedido" del Pilar 4 (numeros PED-NNNN, pantalla /admin/pedidos, RESERVA stock) y su',
      '    ALBARAN de entrega (DEL-NNNN, /admin/albaranes, saca stock): en esta version NO se gestionan por chat.',
      '    Crear/confirmar/entregar/anular uno → DECLINA y redirige a /admin/pedidos o /admin/albaranes. NO uses',
      '    create_order/cancel_order/edit_order/update_order_status para esto, NI insert/update/delete sobre',
      '    customer_orders/customer_order_items/delivery_notes/delivery_note_items. Leerlos (pendientes, borradores,',
      '    que falta por entregar, su cliente) SI puedes.',
      '  · Las acciones de abajo son del modulo de pedidos de TPV/tienda heredado (sales_orders), NO del documento',
      '    Pedido PED-NNNN. Usalas solo si el usuario habla claramente de ese flujo antiguo.',
      '- create_order: {"client_id":0,"product_id":0,"product_name":"","quantity":1,"price":null,"notes":""}',
      '  client_id es OBLIGATORIO (identifica al cliente primero). Sin cliente, NO se crea el pedido.',
      '- edit_order: {"order_id":0,"admin_notes":"","tracking_number":""}',
      '- update_order_status: {"order_id":0,"status":"en_preparacion|enviado|completado|cancelado"}',
      '- cancel_order: {"order_id":0,"reason":""}',
      '- create_invoice_from_order: {"order_id":0}',
      '- anular_invoice: {"invoice_number":"","motivo":""}',
      '  Vía LEGAL para dejar sin efecto una factura YA EMITIDA (crea su asiento de anulacion; la original NO se borra ni se reescribe).',
      '  Identifica la factura por su numero EXACTO (p. ej. "A2026-0007"). motivo OBLIGATORIO. Solo se puede anular una factura en estado "emitida".',
      '  NO existe forma de "editar" o "borrar" una factura emitida: si el cliente lo pide, se anula o se rectifica. No lo inventes.',
      '- create_rectificativa: {"invoice_number":"","rectification_type":"R1","rectification_mode":"I","lines":[{"description":"","quantity":1,"unit_price":0,"tax_rate":21}],"irpf_rate":0,"notes":""}',
      '  Vía LEGAL para CORREGIR una factura emitida emitiendo un documento nuevo en serie propia (la original queda "rectificada").',
      '  invoice_number = numero EXACTO de la factura original. rectification_type uno de R1–R5; rectification_mode "S" (sustitucion) o "I" (diferencias).',
      '  lines son las lineas del documento rectificativo (en modo abono pueden ser negativas). Si dudas del tipo/modalidad o de las lineas, pregunta; no lo inventes.',
      '',
      'Catalogo de productos:',
      '- create_product: {"name":"","price":0,"type":"physical|digital|service","tax_band":"...","stock":0}',
      '  La BANDA DE IVA (tax_band) es OBLIGATORIA y es un dato FISCAL: usa EXACTAMENTE uno de estos',
      '  codigos de la lista cerrada, nunca inventes otro ni un numero libre:',
      '    tax_band: ' + vatVals,
      '  Mapea lo que diga el usuario a su banda SOLO si es inequivoco (1:1): "21" o "IVA general" -> general,',
      '  "10" -> reducido, "4" -> superreducido, "0"/"exento"/"sin IVA" -> exento. Si el usuario NO dice el IVA,',
      '  o lo que dice es ambiguo/no encaja claro con una banda, NO lo adivines: PREGUNTA cual es la banda antes',
      '  de crear. Sin banda no se crea el producto (el servidor lo rechaza). El SKU se genera solo si no lo das.',
      '',
      'Inventario (ver PRODUCTOS FISICOS ACTIVOS y ALMACENES ACTIVOS del contexto para los id):',
      '- adjust_stock: {"product_id":0,"mode":"set|add|sub","value":0,"reason":"...","warehouse_id":0}',
      '  mode: set = poner a X | add = sumar X | sub = restar X. value >= 0. "poner a 0"/"vaciar" = mode:set, value:0.',
      '  warehouse_id OPCIONAL (vacio = almacen principal). "set" es relativo al saldo de ESE almacen.',
      '  reason OBLIGATORIO, EXACTAMENTE uno de: ' + arVals,
      '  Identifica el producto (y el almacen si lo dicen) por nombre antes. Si el motivo no encaja, pregunta; no lo inventes.',
      '- transfer_stock: {"from_warehouse_id":0,"to_warehouse_id":0,"items":[{"product_id":0,"quantity":0}]}',
      '  Mueve stock de un almacen a otro. Multi-linea (varios productos entre los DOS mismos almacenes).',
      '  Para una sola linea vale {"from_warehouse_id":0,"to_warehouse_id":0,"product_id":0,"quantity":0}.',
      '  Origen != destino, solo productos fisicos, cantidad <= disponible en el ORIGEN (lo valida el servicio).',
      '  NO cambia el stock total ni el coste medio del producto: solo lo redistribuye entre almacenes.',
      '  Resume SIEMPRE antes: "Voy a trasladar N de X de [origen] a [destino], confirmo?" y ejecuta solo tras "si".',
      'NO consultes el stock antes de ajustar o trasladar: el servicio valida la disponibilidad y rechaza si no',
      'llega (traducelo si falla). Propon la accion directamente con el bloque [ACCION:...] al final, sin query previa.',
      '',
      'Compras por voz (registrar una factura/compra de proveedor HABLANDO):',
      '- dictar_compra: {"supplier":{"name":"","fiscal_id":""},"date":"AAAA-MM-DD","lines":[{"description":"","quantity":0,"unit_cost":0,"vat_rate":21}]}',
      '  Cuando el usuario DICTA una compra ("compre 10 cajas de X a Proveedor Y a 3 EUR cada una"), recoge el',
      '  proveedor y las lineas (producto, cantidad, coste UNITARIO NETO sin IVA). A DIFERENCIA de adjust_stock/',
      '  transfer_stock, NO se confirma de palabra: esta accion NO mueve stock; prepara la compra y te lleva a la',
      '  PANTALLA de revision (la misma de la captura por foto), donde el usuario revisa y CONFIRMA. Por eso va',
      '  directa, sin "confirmas?" en el chat.',
      '  IDENTIFICACION antes: resuelve el proveedor por nombre/NIF con la lista PROVEEDORES (uno -> usalo en',
      '  "supplier"; varios -> pregunta cual; ninguno -> ponlo igual con su nombre/NIF, la pantalla ofrecera crearlo).',
      '  Resuelve cada producto por nombre con PRODUCTOS FISICOS ACTIVOS para escribir bien la "description".',
      '  vat_rate = % de IVA de la linea (21, 10, 4 o 0). IMPORTANTISIMO para productos NUEVOS (que no esten en el',
      '  catalogo): pregunta y pon su vat_rate para que la pantalla prerellene su banda de IVA; si no lo sabes, dejalo',
      '  null y la pantalla lo exigira. Para productos ya existentes el vat_rate es orientativo (manda la banda del catalogo).',
      '  No hace falta saber el total: la pantalla cuadra base/IVA/total. Una sola accion; una compra por mensaje.',
      '',
      'Consultas de inventario (solo lectura, sin accion):',
      '- Stock GLOBAL y coste medio (WAC) de cada producto: en PRODUCTOS FISICOS ACTIVOS. Valoracion total y por almacen: en INVENTARIO (dato curado, no recalcular).',
      '- Stock POR ALMACEN o historico (compras/recepciones/traslados/devoluciones): consulta con query_database.',
      '  Stock de un producto en un almacen = SUMA(quantity) de stock_movements filtrando product_id y warehouse_id.',
      '  Valor a coste = cantidad x products.average_cost (WAC global). Ultimo coste de compra = unit_cost de la compra/recepcion mas reciente del producto.',
      '- El stock minimo / punto de pedido NO se gestiona: si preguntan "bajo minimos", dilo; no uses un umbral inventado.',
      '',
      'Cobros (ver seccion COBROS del contexto para invoice_id, perfil y proxima accion):',
      '- register_collection_action: {"invoice_id":0,"type":"recordatorio_email|contacto_manual|promesa_pago","channel":"telefono|whatsapp|otro","note":"","promised_date":"AAAA-MM-DD"}',
      '  type=recordatorio_email ENVIA un email al cliente (confirmacion OBLIGATORIA antes de enviar).',
      '  type=promesa_pago exige promised_date. type=contacto_manual usa channel (telefono/whatsapp/otro).',
      '  Propon TU la accion segun la PROXIMA del contexto y el tono del perfil; ejecuta solo tras "si".',
      '  Ejemplo: "Hoy toca Maria (300 EUR, 20 dias vencida, perfil Estandar): 2º recordatorio. Lo mando?"',
      '',
      'Cobros a nivel de CUENTA (cliente entero; ver seccion COBROS POR CUENTA del contexto):',
      '- register_account_action: {"client_id":0,"type":"recordatorio_cuenta|promesa_cuenta|cobro_cuenta","promised_date":"AAAA-MM-DD","importe":0,"modo":"auto|manual","asignacion":[{"invoice_id":0,"importe":0}]}',
      '  recordatorio_cuenta = UN email con el total y el desglose. promesa_cuenta exige promised_date.',
      '  cobro_cuenta reparte el importe (modo auto = mas antigua primero) entre las facturas vivas.',
      '  Propon la cuenta entera, p.ej.: "Te debe 450 EUR en 3 facturas, mando un recordatorio de la cuenta?"',
      '',
      'Pagos a PROVEEDORES (lo que TU pagas; ver seccion COMPRAS POR PAGAR del contexto):',
      '- register_supplier_payment: {"supplier_id":0,"amount":0,"modo":"auto|manual","asignacion":[{"supplier_invoice_id":0,"importe":0}],"payment_method":"","note":""}',
      '  Cuando el dueno diga "pague X a <proveedor>": resuelve el proveedor a supplier_id con COMPRAS POR PAGAR.',
      '  modo=auto (por defecto) reparte amount entre sus facturas vivas, MAS ANTIGUA primero. modo=manual usa asignacion.',
      '  Si el proveedor debe MENOS que amount, el sobrante NO se aplica (se avisa). Confirma ANTES (espejo de cobro_cuenta).',
      '  Varios proveedores con ese nombre → pregunta cual. Ninguno → dilo. Ejemplo: "Pagas 200 EUR a Esencias (2 facturas, la mas antigua primero)?"',
      '',
      'Configuracion:',
      '- update_company_config: {"campo":"valor",...}',
      '  (company_name, fiscal_id, tax_rate, address, phone, email, website, country,',
      '  currency, currency_symbol, tax_name, invoice_series)',
      '- update_profile: {"field":"business_type|sector|description|goals|preferences","value":""}',
      '',
      'Seguridad (confirmacion con frase literal exacta):',
      '- check_2fa_status: {} o {"user_id":0}',
      '- disable_2fa_user: {} o {"user_id":0}  (solo admin/owner para otros usuarios)',
      '- list_users_security: {}  (solo admin/owner)',
      '',
      'Para ACTIVAR 2FA el usuario debe ir a /admin/security y escanear el QR. No es posible por chat.',
      '',
      'Reglas:',
      '- Una sola accion por mensaje. Si necesitas varias, hazlas una a una esperando confirmacion.',
      '- Explica siempre que vas a hacer ANTES del bloque [ACCION:...].',
      '- Para acciones de seguridad, el campo "confirm" debe ser una frase unica que el usuario',
      '  tiene que escribir literalmente (ej: "DESACTIVAR 2FA DE usuario@dominio.com").',
      '',
      '## CONTEXTO DEL NEGOCIO',
      '',
      context,
      '',
      '## SCHEMA DE LA BASE DE DATOS',
      '(columnas disponibles por tabla, * = obligatorio)',
      '',
      dbSchema,
    ].join('\n');

    // ── URL whitelist + artifact sanitizer ───────────────────────────
    const DISA_ALLOWED_URLS = new Set([
      '/admin/products','/admin/categories','/admin/tags','/admin/orders',
      '/admin/orders/pos','/admin/orders/refunds','/admin/orders/draft/new',
      '/admin/discounts','/admin/inventory','/admin/suppliers','/admin/purchases',
      '/admin/purchases/new','/admin/invoices','/admin/clients','/admin/clients/groups',
      '/admin/analytics','/admin/store-settings','/admin/settings','/admin/users',
      '/admin/activity','/admin/security','/admin/disa','/admin/newsletter',
      '/admin/reviews','/admin/feedback',
    ]);
    const DISA_DETAIL_PATTERNS = [
      /^\/admin\/orders\/\d+$/,
      /^\/admin\/orders\/\d+\/invoice$/,
      /^\/admin\/purchases\/\d+$/,
      /^\/admin\/invoices\/\d+$/,
    ];
    function isValidDisaUrl(url) {
      if (!url || typeof url !== 'string') return false;
      if (DISA_ALLOWED_URLS.has(url)) return true;
      return DISA_DETAIL_PATTERNS.some(re => re.test(url));
    }
    function sanitizeArtifact(art) {
      if (!art || typeof art !== 'object') return null;
      const d = art.data;
      if (d) {
        if (d.link && !isValidDisaUrl(d.link.url)) {
          console.log('[DISA] URL bloqueada:', d.link.url);
          delete d.link;
        }
        if (Array.isArray(d.items)) {
          d.items.forEach(item => { if (item.actions) item.actions = []; });
        }
      }
      return art;
    }
    // ─────────────────────────────────────────────────────────────────

    const recentHistory = history.slice(-10).map(m => ({ role: m.role, content: m.content }));

    try {
      if (!hasAnthropicKey()) return c.json({ error: 'DISA no esta configurada. Contacta con soporte.' }, 500);

      const PROTECTED_TABLES = new Set([
        'admin_users', 'admin_sessions', 'customer_accounts', 'customer_sessions',
        'disa_conversations', 'disa_usage', 'sqlite_sequence',
        'activity_logs', 'password_reset_tokens',
      ]);

      function runQueryTool(sql) {
        if (!/^\s*SELECT\b/i.test(sql.trim()))
          return { error: 'Solo se permiten consultas SELECT.' };
        const forbidden = [...PROTECTED_TABLES].find(t =>
          new RegExp('\\b' + t + '\\b', 'i').test(sql)
        );
        if (forbidden)
          return { error: 'Tabla protegida: ' + forbidden };
        try {
          const rows = db.prepare(sql).all();
          return { rows, count: rows.length };
        } catch (e) {
          return { error: e.message };
        }
      }

      const tools = [{
        name: 'query_database',
        description: 'Ejecuta una consulta SQL SELECT para obtener datos especificos del negocio. Usala cuando necesites datos que no estan en el contexto inicial: clientes por gasto, productos por ventas, pedidos por periodo, etc. Solo lectura. Usa LIMIT 20 como maximo.',
        input_schema: {
          type: 'object',
          properties: {
            sql: { type: 'string', description: 'Query SELECT valido. Referencia las tablas por su nombre exacto del schema.' }
          },
          required: ['sql']
        }
      }];

      let apiMessages = [...recentHistory, { role: 'user', content: message }];
      let reply = '';
      let toolCalls = 0;

      while (toolCalls <= 4) {
        // Vía core/llm.js (callClaude): clave + transporte centralizados. Mismo modelo,
        // max_tokens, prompt, mensajes y tools; el bucle de tool-use queda intacto. Si
        // falla la red/API, callClaude lanza → mismo 500 "Error al contactar con DISA.".
        let data;
        try {
          data = await callClaude({
            model: 'claude-sonnet-4-6', max_tokens: 1024, system: systemPrompt, messages: apiMessages, tools, billDb: db,
          });
        } catch (e) {
          console.error('[DISA] API error:', e.message);
          // Tope de gasto alcanzado → mensaje claro al usuario (no el genérico de error de red).
          if (e.code === 'llm_tenant_cap' || e.code === 'llm_global_cap') return c.json({ error: e.message }, 429);
          return c.json({ error: 'Error al contactar con DISA. Intentalo de nuevo.' }, 500);
        }

        if (data.stop_reason === 'tool_use') {
          const toolUse = data.content.find(b => b.type === 'tool_use');
          if (!toolUse) break;
          const result = runQueryTool(toolUse.input?.sql || '');
          console.log('[DISA] query_database:', toolUse.input?.sql, '→', result.count ?? result.error);
          apiMessages.push({ role: 'assistant', content: data.content });
          apiMessages.push({
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) }]
          });
          toolCalls++;
        } else {
          reply = data.content?.find(b => b.type === 'text')?.text || '';
          break;
        }
      }

      const lastAssistantMsg = history.slice().reverse().find(m => m.role === 'assistant');
      const pendingAction = lastAssistantMsg?.pending_action || null;
      let isConfirming = false;
      if (pendingAction) {
        if (SECURITY_ACTIONS.has(pendingAction.type)) {
          const secPhrase = pendingAction._securityPhrase || '';
          isConfirming = secPhrase.length > 0 && message.trim() === secPhrase;
        } else {
          isConfirming = /^(sí|si|confirmo|adelante|ok|dale|hazlo|procede|yes|correcto|exacto)/i
            .test(message.trim());
        }
      }

      let cleanReply = reply;
      let newPendingAction = null;
      let executionResult = null;
      let artifact = null;

      if (isConfirming && pendingAction) {
        const session = c.get('session');
        if (ADMIN_ONLY_ACTIONS.has(pendingAction.type) && !isAdminUser(session)) {
          cleanReply = 'No tienes permisos para ejecutar esta accion. Solo administradores pueden hacer cambios. Contacta al admin de tu cuenta.';
        } else {
          executionResult = await executeAction(db, pendingAction, session);
          cleanReply = executionResult.message;
        }
      } else {
        // Try artifact JSON response — robust extractor
        let parsedAsArtifact = false;
        try {
          let stripped = reply
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/```\s*$/i, '')
            .trim();

          // Find the JSON object even if there's preamble text before it
          const firstBrace = stripped.indexOf('{');
          const lastBrace = stripped.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace > firstBrace) {
            const jsonOnly = stripped.substring(firstBrace, lastBrace + 1);
            const parsed = JSON.parse(jsonOnly);
            if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
              cleanReply = parsed.text;
              artifact = parsed.artifact || null;
              parsedAsArtifact = true;
              if (firstBrace > 0) {
                console.log('[DISA] artifact: stripped preamble of', firstBrace, 'chars');
              }
            }
          }
        } catch (e) {
          console.log('[DISA] artifact parse failed:', e.message.substring(0, 80));
        }

        // Fall back to action block parsing only if not an artifact response.
        // Extractor con balanceo de llaves (soporta JSON anidado como transfer_stock.items).
        if (!parsedAsArtifact) {
          const parsedAction = extractActionBlock(reply);
          if (parsedAction && HANDOFF_ACTIONS.has(parsedAction.action.type)) {
            // Handoff: ejecuta YA (no mueve nada; prepara el payload y devuelve capture_url para
            // enrutar a la pantalla de revisión, donde está el confirm real). Sin "¿confirmas?".
            const session = c.get('session');
            cleanReply = reply.replace(parsedAction.raw, '').trim();
            if (ADMIN_ONLY_ACTIONS.has(parsedAction.action.type) && !isAdminUser(session)) {
              cleanReply = 'No tienes permisos para esta accion. Solo administradores pueden registrar compras.';
            } else {
              executionResult = await executeAction(db, parsedAction.action, session);
              const tail = executionResult?.message || '';
              cleanReply = cleanReply ? (tail ? cleanReply + '\n\n' + tail : cleanReply) : tail;
            }
          } else if (parsedAction) {
            newPendingAction = parsedAction.action;
            cleanReply = reply.replace(parsedAction.raw, '').trim();
            if (SECURITY_ACTIONS.has(newPendingAction.type)) {
              const confirmPhrase = (newPendingAction.confirm || newPendingAction.type).toUpperCase();
              newPendingAction._securityPhrase = confirmPhrase;
              cleanReply += '\n\n⚠️ Accion de seguridad. Para confirmar, escribe exactamente:\n' + confirmPhrase;
            } else {
              cleanReply += '\n\n¿Confirmas esta accion? Responde "si" para ejecutarla.';
            }
          } else if (/\[ACCION:/.test(reply)) {
            // Había intención de acción pero el bloque vino mal formado/truncado: retira el
            // resto y pide reformular (no ejecuta nada a medias).
            cleanReply = reply.replace(/\[ACCION:[\s\S]*$/, '').trim()
              + '\n\n(No pude leer la accion completa. ¿Puedes repetir la instruccion?)';
          }
        }
      }

      history.push({ role: 'user', content: message });
      history.push({
        role: 'assistant',
        content: cleanReply,
        ...(newPendingAction ? { pending_action: newPendingAction } : {})
      });

      db.prepare(
        'UPDATE disa_conversations SET messages=?, agent_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
      ).run(JSON.stringify(history), agentId, conv.id);

      if (isFirstMessage) {
        const title = generateThreadTitle(message);
        db.prepare('UPDATE disa_conversation_threads SET title=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(title, thread.id);
      } else {
        db.prepare('UPDATE disa_conversation_threads SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(thread.id);
      }

      incrementUsage(db);

      return c.json({
        reply: cleanReply,
        artifact: sanitizeArtifact(artifact),
        thread_id: thread.id,
        usage: getUsage(db),
        limit,
        action_executed: executionResult?.ok || false,
        // Handoff a pantalla (p.ej. dictar_compra → revisión de captura precargada). El front
        // navega a esta URL (mismo mecanismo que el adjunto de factura por chat).
        ...(executionResult?.capture_url ? { capture_url: executionResult.capture_url } : {}),
      });

    } catch (err) {
      console.error('[DISA] Error:', err);
      return c.json({ error: 'Error interno. Intentalo de nuevo.' }, 500);
    }
  });

  router.post('/clear', adminAuth(db), c => {
    db.prepare('DELETE FROM disa_conversations').run();
    return c.json({ ok: true });
  });

  // Paso (d) · RESUMEN-PRIMERO del badge. Al pulsar el badge, en vez de lanzar una pregunta
  // abierta al modelo (que mezclaba temas y ofrecía acciones no pedidas), se devuelve un RESUMEN
  // DE CONTEOS determinista de las MISMAS fuentes del motor (vencimientos de proveedor + stock
  // bajo) — sin detalle y sin ofrecer acciones — y se marca todo como VISTO (el badge pasa a gris;
  // el rojo solo vuelve si aparece algo nuevo). El detalle lo pide el dueño escribiendo después.
  router.post('/alerts/open', adminAuth(db), c => {
    try {
      const r = marcarVistoYResumir(db, new Date().toISOString().slice(0, 10));
      return c.json(r);
    } catch (e) {
      return c.json({ reply: 'No pude cargar tus avisos ahora mismo.' }, 500);
    }
  });

  // ── Captura de factura de proveedor DENTRO del chat (Pilar 3 · reutiliza C2) ──
  // El usuario adjunta una foto/PDF de una factura en el chat. DISA la reconoce, la lee
  // con el MISMO extractor de C2 (runCapture) y devuelve un enlace a la pantalla de
  // revisión EDITABLE ya precargada (/admin/purchases/capture?attachment=ID). NO escribe
  // stock ni compras: nada se guarda hasta que el usuario confirma en esa pantalla por el
  // servicio validado (confirm-first). No cuenta contra el límite mensual (no es un mensaje
  // de chat). Permiso de compras como en la propia pantalla de captura.
  router.post('/attach', adminAuth(db), requirePerm('purchases.create'),
    bodyLimit({ maxSize: MAX_UPLOAD_BYTES, onError: c => c.json({ error: 'El archivo supera el máximo de 12 MB. Sube una foto o PDF más ligero.' }, 413) }),
    async c => {
      try {
        const body = await c.req.parseBody();
        const file = body.file;
        if (!file || typeof file === 'string') return c.json({ error: 'Adjunta una foto o PDF de la factura.' }, 400);
        const mime = file.type || '';
        if (!ALLOWED_MIME[mime]) return c.json({ error: 'Formato no admitido. Sube una imagen (JPG, PNG, WebP) o un PDF.' }, 400);
        const buffer = Buffer.from(await file.arrayBuffer());
        if (!buffer.length) return c.json({ error: 'El archivo está vacío.' }, 400);
        if (buffer.length > MAX_UPLOAD_BYTES) return c.json({ error: 'El archivo supera el máximo de 12 MB.' }, 413);

        if (!hasAnthropicKey()) return c.json({ error: 'DISA no esta configurada. Contacta con soporte.' }, 500);

        let result;
        try {
          result = await runCapture(db, c.get('tenant'), c.get('session'), { buffer, mime, originalName: file.name || '' });
        } catch (e) {
          // 422 = el modelo no devolvió una factura legible. Se responde en el chat sin romper.
          return c.json({ reply: 'He recibido el archivo pero no he podido leerlo como una factura. ' + (e.message || 'Prueba con una foto más nítida o un PDF.') });
        }

        // Reconocer factura: el extractor debe haber sacado proveedor o líneas.
        const ex = result.extracted || {};
        const hasSupplier = ex.supplier && (ex.supplier.name || ex.supplier.fiscal_id);
        const lines = Array.isArray(ex.lines) ? ex.lines : [];
        if (!hasSupplier && !lines.length) {
          return c.json({ reply: 'He recibido el archivo, pero no parece una factura de proveedor. Si lo es, prueba con una foto más nítida o un PDF.' });
        }

        const supName = hasSupplier && ex.supplier.name ? ex.supplier.name : 'un proveedor sin identificar';
        const n = lines.length;
        const totalTxt = (ex.totals && ex.totals.total != null) ? (' por ' + ex.totals.total + ' ' + (db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€')) : '';
        const reply = 'He leído la factura de ' + supName + ': ' + n + (n === 1 ? ' línea' : ' líneas') + totalTxt +
          '. Te llevo a la pantalla de revisión para que la compruebes y la confirmes — no he guardado nada todavía.';
        return c.json({ reply, capture_url: '/admin/purchases/capture?attachment=' + result.attachment_id });
      } catch (e) {
        console.error('[DISA] attach error:', e);
        return c.json({ error: e.message || 'No se pudo procesar el archivo.' }, e.status || 500);
      }
    });

  app.route('/admin/disa', router);
  app.route('/api/disa', router);
}
