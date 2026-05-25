import { Hono } from 'hono';
import { adminAuth, getCsrfToken } from '../../core/auth.js';
import { adminLayout } from '../erp/layout.js';
import { disaDedicadoHtml } from './views/disa-dedicado.html.js';

export function register(app, db) {
  const router = new Hono();

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

  function getConversation(db) {
    let conv = db.prepare('SELECT * FROM disa_conversations ORDER BY id DESC LIMIT 1').get();
    if (!conv) {
      const r = db.prepare('INSERT INTO disa_conversations (messages) VALUES (?)').run('[]');
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

  const WRITABLE_TABLES = new Set([
    'categories', 'tags', 'product_tags',
    'products', 'product_variants', 'product_images',
    'clients', 'client_groups', 'suppliers',
    'sales_orders', 'sales_items',
    'invoices', 'invoice_items',
    'inventory_movements',
    'discount_codes', 'auto_discounts',
    'shipping_methods',
    'company_config', 'settings', 'store_settings', 'disa_profile',
    'purchases', 'purchase_items',
  ]);

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
          const cols = Object.keys(data).join(', ');
          const placeholders = Object.keys(data).map(() => '?').join(', ');
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
          const fields = Object.keys(data).map(k => k + '=?').join(', ');
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
                (order_number, status, subtotal, tax_amount, total, admin_notes)
              VALUES (?, 'completado', ?, ?, ?, ?)
            `).run(orderNumber, subtotal, taxAmount, total, p.notes || 'Creado por DISA');
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
          return { ok: true, message: 'Pedido ' + orderNumber + ' creado: ' +
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
          const p = action.params;
          const order = db.prepare('SELECT * FROM sales_orders WHERE id=?').get(p.order_id);
          if (!order) return { ok: false, message: 'Pedido #' + p.order_id + ' no encontrado.' };
          const existing = db.prepare('SELECT id FROM invoices WHERE order_id=?').get(p.order_id);
          if (existing) return { ok: false, message: 'El pedido #' + p.order_id + ' ya tiene una factura.' };

          const cfg = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
          const client = order.client_id
            ? db.prepare('SELECT * FROM clients WHERE id=?').get(order.client_id)
            : null;
          const items = db.prepare('SELECT * FROM sales_items WHERE order_id=?').all(p.order_id);

          const series = cfg.invoice_series || 'F';
          const year = new Date().getFullYear();

          const tx = db.transaction(() => {
            db.prepare(`
              INSERT INTO invoice_sequences (series, year, last_seq) VALUES (?, ?, 1)
              ON CONFLICT(series, year) DO UPDATE SET last_seq = last_seq + 1
            `).run(series, year);
            const seq = db.prepare(
              'SELECT last_seq FROM invoice_sequences WHERE series=? AND year=?'
            ).get(series, year).last_seq;
            const invoiceNumber = series + year + '-' + String(seq).padStart(4, '0');

            const r = db.prepare(`
              INSERT INTO invoices (
                invoice_number, order_id, client_id, series, year, sequence, issue_date,
                company_name, company_fiscal_id, company_address,
                client_name, client_fiscal_id, client_address, client_email,
                subtotal, tax_rate, tax_name, tax_amount, total,
                currency, currency_symbol, document_name
              ) VALUES (?, ?, ?, ?, ?, ?, date('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              invoiceNumber, p.order_id, order.client_id || null,
              series, year, seq,
              cfg.company_name || 'Mi Empresa', cfg.fiscal_id || '', cfg.address || '',
              client?.name || '', client?.fiscal_id || '', client?.address || '', client?.email || '',
              order.subtotal || 0, cfg.tax_rate || 21, cfg.tax_name || 'IVA',
              order.tax_amount || 0, order.total || 0,
              cfg.currency || 'EUR', cfg.currency_symbol || '€', cfg.document_name || 'Factura'
            );
            const invoiceId = r.lastInsertRowid;

            for (const item of items) {
              db.prepare(`
                INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total_price)
                VALUES (?, ?, ?, ?, ?)
              `).run(invoiceId, item.product_name, item.quantity, item.unit_price, item.total);
            }

            logActivity(db, 'create', 'invoices', invoiceId,
              'Factura ' + invoiceNumber + ' generada por DISA', session);
            return invoiceNumber;
          });

          const invoiceNumber = tx();
          return { ok: true, message: 'Factura ' + invoiceNumber + ' generada para el pedido #' + p.order_id + '.' };
        }

        // ── Productos ─────────────────────────────────────────

        case 'create_product': {
          const p = action.params;
          const r = db.prepare(`
            INSERT INTO products (name, price, stock, status, type)
            VALUES (?, ?, ?, 'active', 'physical')
          `).run(p.name || '', Number(p.price) || 0, Number(p.stock) || 0);
          logActivity(db, 'create', 'products', r.lastInsertRowid,
            'Producto "' + p.name + '" creado por DISA', session);
          return { ok: true, message: 'Producto "' + (p.name || 'nuevo') + '" creado.' };
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

        case 'adjust_stock': {
          const p = action.params;
          const prod = db.prepare('SELECT name FROM products WHERE id=?').get(p.product_id);
          if (!prod) return { ok: false, message: 'Producto no encontrado.' };
          db.prepare('UPDATE products SET stock = stock + ? WHERE id=?').run(p.quantity, p.product_id);
          db.prepare(`
            INSERT INTO inventory_movements (product_id, type, quantity, reason)
            VALUES (?, ?, ?, ?)
          `).run(p.product_id, p.quantity > 0 ? 'in' : 'out',
            Math.abs(p.quantity), p.reason || 'Ajuste por DISA');
          logActivity(db, 'edit', 'products', p.product_id,
            'Stock ajustado ' + (p.quantity > 0 ? '+' : '') + p.quantity + ' por DISA', session);
          return { ok: true, message: 'Stock de "' + prod.name + '" ajustado en ' + p.quantity + ' unidades.' };
        }

        case 'reset_stock': {
          const p = action.params;
          const product = db.prepare('SELECT name, stock FROM products WHERE id=?').get(p.product_id);
          if (!product) return { ok: false, message: 'Producto no encontrado.' };
          db.prepare('UPDATE products SET stock=0 WHERE id=?').run(p.product_id);
          if (product.stock !== 0) {
            db.prepare(`
              INSERT INTO inventory_movements (product_id, type, quantity, reason)
              VALUES (?, 'adjust', ?, ?)
            `).run(p.product_id, Math.abs(product.stock), p.reason || 'Reset por DISA');
          }
          logActivity(db, 'edit', 'products', p.product_id, 'Stock reseteado a 0 por DISA', session);
          return { ok: true, message: 'Stock de "' + product.name + '" puesto a 0.' };
        }

        // ── Clientes ──────────────────────────────────────────

        case 'create_client': {
          const p = action.params;
          const r = db.prepare(`
            INSERT INTO clients (name, email, phone, address, city, fiscal_id, notes, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)
          `).run(
            p.name || '', p.email || '', p.phone || '',
            p.address || '', p.city || '', p.fiscal_id || '', p.notes || ''
          );
          logActivity(db, 'create', 'clients', r.lastInsertRowid,
            'Cliente "' + p.name + '" creado por DISA', session);
          return { ok: true, message: 'Cliente "' + (p.name || 'nuevo') + '" creado.' };
        }

        case 'edit_client': {
          const p = action.params;
          const client = db.prepare('SELECT * FROM clients WHERE id=?').get(p.client_id);
          if (!client) return { ok: false, message: 'Cliente no encontrado.' };
          db.prepare(`
            UPDATE clients SET name=?, email=?, phone=?, address=?, city=?, fiscal_id=?, notes=?
            WHERE id=?
          `).run(
            p.name !== undefined ? p.name : client.name,
            p.email !== undefined ? p.email : client.email,
            p.phone !== undefined ? p.phone : client.phone,
            p.address !== undefined ? p.address : client.address,
            p.city !== undefined ? p.city : client.city,
            p.fiscal_id !== undefined ? p.fiscal_id : client.fiscal_id,
            p.notes !== undefined ? p.notes : client.notes,
            p.client_id
          );
          logActivity(db, 'edit', 'clients', p.client_id, 'Cliente editado por DISA', session);
          return { ok: true, message: 'Cliente #' + p.client_id + ' actualizado.' };
        }

        case 'deactivate_client': {
          const p = action.params;
          const r = db.prepare('UPDATE clients SET active=0 WHERE id=?').run(p.client_id);
          if (r.changes === 0) return { ok: false, message: 'Cliente no encontrado.' };
          return { ok: true, message: 'Cliente #' + p.client_id + ' desactivado.' };
        }

        case 'activate_client': {
          const p = action.params;
          const r = db.prepare('UPDATE clients SET active=1 WHERE id=?').run(p.client_id);
          if (r.changes === 0) return { ok: false, message: 'Cliente no encontrado.' };
          return { ok: true, message: 'Cliente #' + p.client_id + ' activado.' };
        }

        // ── Proveedores ───────────────────────────────────────

        case 'create_supplier': {
          const p = action.params;
          const r = db.prepare(`
            INSERT INTO suppliers (name, contact, email, phone, notes)
            VALUES (?, ?, ?, ?, ?)
          `).run(p.name || '', p.contact || '', p.email || '', p.phone || '', p.notes || '');
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
          const resumen = users.map(u =>
            `${u.name} (${u.email}) — rol: ${u.role} — 2FA: ${u.totp_enabled ? 'SI' : 'NO'} — activo: ${u.active ? 'SI' : 'NO'}`
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

  function buildBusinessContext(db, currentPage = '') {
    try {
      const _dbCheck = db.prepare("SELECT name FROM sqlite_master LIMIT 1").get();
      console.log('[DISA] Usando BD:', _dbCheck ? 'OK' : 'VACIA');
      const _products = db.prepare('SELECT COUNT(*) as c FROM products').get();
      console.log('[DISA] Productos encontrados:', _products?.c ?? 0);
      const _orders = db.prepare("SELECT COUNT(*) as c FROM sales_orders WHERE status='completado'").get();
      console.log('[DISA] Pedidos completados:', _orders?.c ?? 0);

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

      const pending = db.prepare(`
        SELECT COUNT(*) as count FROM sales_orders
        WHERE status IN ('en_preparacion','enviado')
      `).get() || {};

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
        profileContext,
        '',
        'Negocio: ' + (cfg.company_name || 'Sin nombre'),
        'Pais: ' + (cfg.country || 'ES'),
        'Moneda: ' + sym,
        '',
        'VENTAS ESTE MES (' + (sales.orders || 0) + ' pedidos):',
        '- Venta neta (sin IVA): ' + sym + Number(sales.revenue || 0).toFixed(2),
        '- IVA recaudado: ' + sym + Number(sales.iva || 0).toFixed(2),
        '- Total cobrado (con IVA): ' + sym + Number(sales.gross_revenue || 0).toFixed(2),
        '- Pedidos pendientes de entrega: ' + (pending.count || 0),
        '',
        'ATENCION:',
        '- Productos con stock bajo (<=5 unidades): ' +
          (lowStock.length > 0
            ? lowStock.map(p => p.name + ' (' + p.stock + ')').join(', ')
            : 'ninguno'),
        '- Clientes sin compra en >30 dias: ' + (inactiveClients.count || 0),
        '',
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

  // ── Vista dedicada por agente ─────────────────────────────

  router.get('/dedicated', adminAuth(db), c => {
    const agentIdParam = parseInt(c.req.query('agent')) || 0;
    if (!agentIdParam) return c.redirect('/admin/asistentes');

    let agent = null;
    try {
      agent = db.prepare(
        'SELECT id, name, icon, system_prompt, specialization FROM disa_agents WHERE id=? AND active=1'
      ).get(agentIdParam);
    } catch {}
    if (!agent) return c.redirect('/admin/asistentes');

    const conv = getConversation(db);
    const allMessages = JSON.parse(conv?.messages || '[]');
    const conversations = allMessages.slice(-50).map(m => ({ role: m.role, content: m.content }));

    const session = c.get('session');
    const csrf = getCsrfToken(c);
    return c.html(disaDedicadoHtml({ agent, conversations, session, csrf }));
  });

  // ── Vista principal ───────────────────────────────────────

  router.get('/', adminAuth(db), c => {
    const agentIdParam = parseInt(c.req.query('agent')) || 0;
    if (agentIdParam) {
      let agent = null;
      try {
        agent = db.prepare(
          'SELECT id, name, icon, system_prompt, specialization FROM disa_agents WHERE id=? AND active=1'
        ).get(agentIdParam);
      } catch {}
      if (!agent) return c.redirect('/admin/asistentes');

      const conv = getConversation(db);
      const allMessages = JSON.parse(conv?.messages || '[]');
      const conversations = allMessages.slice(-50).map(m => ({ role: m.role, content: m.content }));

      const session = c.get('session');
      const csrf = getCsrfToken(c);
      return c.html(disaDedicadoHtml({ agent, conversations, session, csrf }));
    }

    const session = c.get('session');
    const usage = getUsage(db);
    const limit = 50;
    const tenantSlugView = c.get('tenant')?.slug;
    const isDevView = process.env.NODE_ENV !== 'production' || tenantSlugView === 'dev';
    const conv = getConversation(db);
    const messages = JSON.parse(conv.messages || '[]');
    const csrf = getCsrfToken(c);

    let agents = [];
    try {
      agents = db.prepare('SELECT id, name, slug, icon, description FROM disa_agents WHERE active=1 ORDER BY id').all();
    } catch {}
    const currentAgentId = conv.agent_id || 1;

    const body = `
      <div style="display:flex;flex-direction:column;height:calc(100vh - 120px)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-shrink:0">
          <div>
            <h1 style="font-size:1.1rem;font-weight:700">DISA</h1>
            <p style="font-size:13px;color:#64748b;margin-top:2px">Tu asistente de inteligencia artificial</p>
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <span style="font-size:13px;color:#64748b">${usage}/${limit} mensajes este mes</span>
            <button class="btn btn-secondary btn-sm" onclick="clearChat()">Nueva conversación</button>
          </div>
        </div>

        ${agents.length > 1 ? `
        <div style="display:flex;gap:8px;padding:10px 0 14px;flex-wrap:wrap;align-items:center;flex-shrink:0">
          <span style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.08em;margin-right:4px">AGENTE:</span>
          ${agents.map(a => `
            <button class="agent-tab" data-agent-id="${a.id}"
              style="padding:7px 14px;border:2px solid ${a.id === currentAgentId ? '#0D9488' : '#e2e8f0'};
                     border-radius:8px;background:${a.id === currentAgentId ? '#0D9488' : '#fff'};
                     color:${a.id === currentAgentId ? '#fff' : '#475569'};cursor:pointer;
                     font-weight:600;font-size:13px;font-family:inherit;
                     display:inline-flex;align-items:center;gap:6px;transition:all 0.15s ease">
              <span>${a.icon}</span><span>${a.name}</span>
            </button>
          `).join('')}
        </div>
        ` : ''}

        <div style="height:3px;background:#e2e8f0;margin-bottom:16px;flex-shrink:0;border-radius:2px;overflow:hidden">
          <div style="height:100%;width:${Math.min(100, (usage / limit) * 100)}%;background:#0D9488;transition:width 0.3s"></div>
        </div>

        <div id="chatArea" style="flex:1;overflow-y:auto;padding:0 4px;display:flex;flex-direction:column;gap:12px">
          ${messages.length === 0 ? `
            <div style="text-align:center;padding:48px 24px;color:#94a3b8">
              <div style="font-size:48px;margin-bottom:16px">✦</div>
              <div style="font-size:18px;font-weight:600;color:#64748b;margin-bottom:8px">Hola, soy DISA</div>
              <div style="font-size:14px;max-width:360px;margin:0 auto">
                Estoy aqui para ayudarte a gestionar tu negocio.
                Preguntame lo que quieras o pideme que analice algo concreto.
              </div>
            </div>
          ` : messages.map(m => `
            <div style="display:flex;justify-content:${m.role === 'user' ? 'flex-end' : 'flex-start'}">
              <div style="max-width:75%;padding:12px 16px;border-radius:14px;font-size:14px;line-height:1.6;
                ${m.role === 'user'
    ? 'background:#0D9488;color:white;border-bottom-right-radius:4px'
    : 'background:#f1f5f9;color:#0f172a;border-bottom-left-radius:4px'}">
                ${m.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}
              </div>
            </div>
          `).join('')}
          <div id="typingIndicator" style="display:none">
            <div style="background:#f1f5f9;padding:12px 16px;border-radius:14px;border-bottom-left-radius:4px;
                        display:inline-flex;gap:4px;align-items:center">
              <span style="width:6px;height:6px;border-radius:50%;background:#94a3b8;animation:tdot 1.4s infinite"></span>
              <span style="width:6px;height:6px;border-radius:50%;background:#94a3b8;animation:tdot 1.4s infinite 0.2s"></span>
              <span style="width:6px;height:6px;border-radius:50%;background:#94a3b8;animation:tdot 1.4s infinite 0.4s"></span>
            </div>
          </div>
        </div>

        <div style="flex-shrink:0;padding-top:16px;border-top:1px solid #e2e8f0;margin-top:16px">
          ${!isDevView && usage >= limit ? `
            <div style="background:#fee2e2;color:#dc2626;padding:12px 16px;border-radius:10px;font-size:14px;text-align:center">
              Has alcanzado el limite de ${limit} mensajes este mes.
            </div>
          ` : `
            <div style="display:flex;gap:10px">
              <textarea id="msgInput" rows="2" placeholder="Escribe tu mensaje..."
                style="flex:1;padding:12px 16px;border:1px solid #e2e8f0;border-radius:12px;font-size:14px;
                       font-family:inherit;resize:none;outline:none;transition:border-color 150ms"
                onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();disaSend()}"
                onfocus="this.style.borderColor='#0D9488'"
                onblur="this.style.borderColor='#e2e8f0'"></textarea>
              <button onclick="disaSend()"
                style="background:#0D9488;color:white;border:none;border-radius:12px;padding:0 20px;
                       font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;
                       white-space:nowrap;align-self:stretch">
                Enviar
              </button>
            </div>
            <div style="font-size:11px;color:#94a3b8;margin-top:8px">
              Shift+Enter para nueva linea · Enter para enviar
            </div>
          `}
        </div>
      </div>

      <style>
        @keyframes tdot {
          0%,60%,100% { opacity:0.25;transform:scale(0.8) }
          30% { opacity:1;transform:scale(1.1) }
        }
      </style>

      <script>
        const csrf = ${JSON.stringify(csrf)};
        window.selectedAgentId = ${currentAgentId};

        document.querySelectorAll('.agent-tab').forEach(btn => {
          btn.addEventListener('click', async () => {
            const agentId = parseInt(btn.dataset.agentId);
            document.querySelectorAll('.agent-tab').forEach(b => {
              b.style.background = '#fff';
              b.style.color = '#475569';
              b.style.borderColor = '#e2e8f0';
            });
            btn.style.background = '#0D9488';
            btn.style.color = '#fff';
            btn.style.borderColor = '#0D9488';
            window.selectedAgentId = agentId;
            try {
              await fetch('/api/disa/select-agent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
                body: JSON.stringify({ agent_id: agentId })
              });
              const area = document.getElementById('chatArea');
              const notice = document.createElement('div');
              notice.style.cssText = 'padding:8px 14px;background:#f0fdf4;border-left:3px solid #0D9488;border-radius:4px;font-size:12px;color:#166534;margin:4px 0';
              notice.textContent = 'Agente: ' + btn.querySelector('span:last-child').textContent;
              area.insertBefore(notice, document.getElementById('typingIndicator'));
              area.scrollTop = area.scrollHeight;
            } catch {}
          });
        });

        window.disaSend = async function() {
          const input = document.getElementById('msgInput');
          const msg = input.value.trim();
          if (!msg) return;
          input.value = '';
          disaAddMsg('user', msg);
          disaShowTyping(true);
          try {
            const res = await fetch('/api/disa/message', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
              body: JSON.stringify({ message: msg, agent_id: window.selectedAgentId || 1 })
            });
            const data = await res.json();
            disaShowTyping(false);
            if (res.ok) {
              disaAddMsg('assistant', data.reply);
            } else {
              disaAddMsg('assistant', data.error || 'Lo siento, ha ocurrido un error.');
            }
          } catch {
            disaShowTyping(false);
            disaAddMsg('assistant', 'Error de conexion. Intentalo de nuevo.');
          }
        };

        function disaEscHtml(s) {
          return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
            .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        }

        function disaAddMsg(role, content) {
          const area = document.getElementById('chatArea');
          const empty = area.querySelector('[style*="text-align:center"]');
          if (empty) empty.remove();
          const div = document.createElement('div');
          div.style.cssText = 'display:flex;justify-content:' + (role === 'user' ? 'flex-end' : 'flex-start');
          div.innerHTML = '<div style="max-width:75%;padding:12px 16px;border-radius:14px;font-size:14px;line-height:1.6;'
            + (role === 'user'
              ? 'background:#0D9488;color:white;border-bottom-right-radius:4px'
              : 'background:#f1f5f9;color:#0f172a;border-bottom-left-radius:4px')
            + '">' + disaEscHtml(content).replace(/\\n/g, '<br>') + '</div>';
          area.insertBefore(div, document.getElementById('typingIndicator'));
          area.scrollTop = area.scrollHeight;
        }

        function disaShowTyping(show) {
          const t = document.getElementById('typingIndicator');
          t.style.display = show ? 'block' : 'none';
          if (show) document.getElementById('chatArea').scrollTop = 9999;
        }

        window.clearChat = async function() {
          if (!confirm('Empezar una nueva conversacion?')) return;
          await fetch('/api/disa/clear', { method: 'POST', headers: { 'x-csrf-token': csrf } });
          location.reload();
        };

        window.addEventListener('load', () => {
          const area = document.getElementById('chatArea');
          area.scrollTop = area.scrollHeight;
        });
      </script>
    `;

    return c.html(adminLayout('DISA', body, 'disa', session?.csrfToken || '', session?.role || ''));
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

  router.post('/message', adminAuth(db), async c => {
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
    const conv = getConversation(db);
    const history = JSON.parse(conv.messages || '[]');
    const context = buildBusinessContext(db, currentPage);
    const dbSchema = getDbSchema(db);

    const agentIntro = agent?.system_prompt
      ? agent.system_prompt
      : [
          'Eres DISA, la asistente de inteligencia artificial de Bamburu.',
          'Bamburu es un sistema de gestion para autonomos y pequenos negocios hispanohablantes.',
          'Tu mision es ayudar al usuario a gestionar y hacer crecer su negocio.',
          '',
          'Eres proactiva, directa y hablas en espanol. Vas al grano.',
          'No uses emojis en ninguna respuesta. Se profesional y directo.',
          'Cuando detectas algo importante en los datos, lo mencionas.',
          'SIEMPRE pides confirmacion antes de ejecutar cualquier accion.',
        ].join('\n');

    const systemPrompt = [
      agentIntro,
      '',
      'TERMINOLOGIA DE VENTAS (muy importante):',
      '- "Ventas" o "ingresos" = venta neta (subtotal, SIN IVA). Usa siempre este dato por defecto.',
      '- "IVA" = impuesto recaudado (tax_amount). Mencionalo separado si es relevante.',
      '- "Total cobrado" o "venta bruta" = subtotal + IVA (gross_revenue). Solo si el usuario lo pide.',
      '- Nunca mezcles neto y bruto. Si alguien pregunta "cuanto he vendido", responde con la venta neta.',
      '- Cuando respondas cualquier pregunta sobre ventas o dinero, da SIEMPRE el desglose completo:',
      '  venta neta + IVA recaudado + total cobrado. No esperes a que te lo pidan.',
      '',
      'COMUNICACION:',
      '- Si entiendes claramente lo que pregunta el usuario (aunque no use palabras exactas), responde directo.',
      '- No pidas aclaraciones a menos que sea genuinamente ambiguo.',
      '- Interpreta la intencion: "monto de IVA cobrado" = "IVA recaudado", "cuanto gane" = venta neta, etc.',
      '- Se conversacional, no literal. Responde como un asesor de negocio, no como una base de datos.',
      '',
      'DATOS ACTUALES DEL NEGOCIO:',
      context,
      '',
      'SCHEMA DE LA BASE DE DATOS (columnas disponibles por tabla, * = obligatorio):',
      dbSchema,
      '',
      'ACCIONES QUE PUEDES EJECUTAR:',
      'Cuando el usuario quiera realizar una accion, responde con un JSON especial al FINAL',
      'de tu mensaje con este formato exacto:',
      '',
      '[ACCION:{"type":"nombre_accion","params":{...},"confirm":"descripcion para el usuario"}]',
      '',
      '-- OPERACIONES GENERICAS (para CUALQUIER entidad del negocio) --',
      'Usa estas para crear, editar o eliminar cualquier registro en el sistema.',
      'Los nombres de tabla y campos deben coincidir exactamente con el schema de arriba.',
      '',
      '- insert_record: {"table":"nombre_tabla","data":{"campo1":"valor","campo2":"valor",...}}',
      '  Ejemplos de uso: crear categoria, etiqueta, proveedor, cliente, producto, descuento, etc.',
      '',
      '- update_record: {"table":"nombre_tabla","id":0,"data":{"campo":"nuevo_valor",...}}',
      '  Solo incluye en data los campos que cambian.',
      '',
      '- delete_record: {"table":"nombre_tabla","id":0}',
      '  Usa con cuidado. Verifica primero que el registro existe.',
      '',
      '-- OPERACIONES ESPECIALES (flujos complejos de varios pasos) --',
      '',
      '- create_order: {"product_id":0,"product_name":"","quantity":1,"price":null,"notes":""}',
      '  Crea un pedido completo con lineas de producto. usa product_id si lo conoces.',
      '- edit_order: {"order_id":0,"admin_notes":"","tracking_number":""}',
      '- update_order_status: {"order_id":0,"status":"en_preparacion|enviado|completado|cancelado"}',
      '- cancel_order: {"order_id":0,"reason":""}',
      '- create_invoice_from_order: {"order_id":0}',
      '  Genera factura oficial con numeracion automatica a partir de un pedido.',
      '',
      '- adjust_stock: {"product_id":0,"quantity":0,"reason":""}',
      '  Registra movimiento de inventario. quantity positivo=entrada, negativo=salida.',
      '- reset_stock: {"product_id":0,"reason":""}',
      '  Pone el stock a 0 con registro de movimiento.',
      '',
      '- update_company_config: {"campo":"valor",...}',
      '  Campos: company_name, fiscal_id, tax_rate, address, phone, email, website, country,',
      '  currency, currency_symbol, tax_name, invoice_series. Solo los que cambien.',
      '- update_profile: {"field":"business_type|sector|description|goals|preferences","value":""}',
      '',
      '-- SEGURIDAD DE USUARIOS --',
      '',
      '- check_2fa_status: {} o {"user_id":0}',
      '  Consulta si el usuario actual (o uno específico) tiene 2FA activado.',
      '',
      '- disable_2fa_user: {} o {"user_id":0}',
      '  Desactiva el doble factor de un usuario. Sin user_id = usuario actual.',
      '  Solo owner/admin pueden hacerlo para otros usuarios.',
      '',
      '- list_users_security: {}',
      '  Lista todos los usuarios con su estado de 2FA y rol. Solo owner/admin.',
      '',
      'NOTA SEGURIDAD: Para ACTIVAR 2FA (no desactivar), el usuario debe ir a',
      '/admin/security (tab 2FA) y escanear el QR con su móvil. No se puede',
      'activar por chat porque requiere escanear un código QR físicamente.',
      'Cuando alguien pida activar 2FA, indícale que vaya a Seguridad en el menú.',
      '',
      'REGLAS IMPORTANTES:',
      '- Solo incluye el bloque [ACCION:...] cuando vayas a ejecutar algo',
      '- Siempre explica al usuario que vas a hacer ANTES del bloque',
      '- El campo "confirm" es lo que le mostraras al usuario para que confirme',
      '- Si el usuario dice "si", "confirmo", "adelante", "ok" o similar despues de una',
      '  accion pendiente, ejecuta la accion anterior',
      '- Genera SOLO UN bloque [ACCION:...] por mensaje',
      '  Si necesitas hacer varias cosas, hazlas una a una esperando confirmacion',
      '- Responde siempre en espanol',
    ].join('\n');

    const recentHistory = history.slice(-10).map(m => ({ role: m.role, content: m.content }));

    try {
      let apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        try {
          const fs = await import('fs');
          const env = fs.default.readFileSync('/etc/bamburu.env', 'utf8');
          const match = env.match(/ANTHROPIC_API_KEY=(.+)/);
          if (match) apiKey = match[1].trim();
        } catch {}
      }
      if (!apiKey) return c.json({ error: 'DISA no esta configurada. Contacta con soporte.' }, 500);

      const PROTECTED_TABLES = new Set([
        'admin_users', 'admin_sessions', 'customer_accounts', 'customer_sessions',
        'disa_conversations', 'disa_usage', 'sqlite_sequence',
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
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 1024,
            system: systemPrompt,
            messages: apiMessages,
            tools
          })
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          console.error('[DISA] API error:', JSON.stringify(err));
          return c.json({ error: 'Error al contactar con DISA. Intentalo de nuevo.' }, 500);
        }

        const data = await response.json();

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
      const isConfirming = pendingAction &&
        /^(sí|si|confirmo|adelante|ok|dale|hazlo|procede|yes|correcto|exacto)/i
        .test(message.trim());

      let cleanReply = reply;
      let newPendingAction = null;
      let executionResult = null;

      if (isConfirming && pendingAction) {
        executionResult = await executeAction(db, pendingAction, c.get('session'));
        cleanReply = executionResult.message;
      } else {
        const actionMatch = reply.match(/\[ACCION:(\{[\s\S]*?\})\]/);
        if (actionMatch) {
          try {
            newPendingAction = JSON.parse(actionMatch[1]);
            cleanReply = reply.replace(/\[ACCION:[\s\S]*?\]/, '').trim();
            cleanReply += '\n\n¿Confirmas esta accion? Responde "si" para ejecutarla.';
          } catch {
            cleanReply = reply.replace(/\[ACCION:[\s\S]*?\]/, '').trim();
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

      incrementUsage(db);

      return c.json({
        reply: cleanReply,
        usage: getUsage(db),
        limit,
        action_executed: executionResult?.ok || false
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

  app.route('/admin/disa', router);
  app.route('/api/disa', router);
}
