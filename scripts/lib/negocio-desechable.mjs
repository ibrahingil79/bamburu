// ─────────────────────────────────────────────────────────────────────────────────────────────────
// UN NEGOCIO DESECHABLE PARA UNA COMPROBACIÓN.
//
// POR QUÉ EXISTE (24 ago 2026). Trece comprobaciones fallaban porque esperaban datos sembrados en el
// negocio de desarrollo que ya no estaban. Arreglarlas sembrando ahí tenía un problema sin salida:
// varias necesitan EMITIR una factura, y una factura emitida entra en la cadena de VERI*FACTU y **ya
// no se puede borrar** — así que cada pasada dejaba residuo imborrable. En un día, 19 facturas por
// 523.002,90 €: el 55 % de lo que figuraba como vendido.
//
// La cura disuelve el problema en vez de pelearlo: **si la comprobación se trae su propio negocio, la
// factura que emite nace y muere ahí dentro**. No se borra ninguna factura ni se toca ninguna
// cadena — se tira el negocio entero, que nunca fue real.
//
//   const neg = await negocioDesechable('Gate Albaranes');
//   ...  neg.slug · neg.db · neg.base · neg.sesion(userId)
//   neg.tirar();     // en el `finally`, SIEMPRE
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { unlinkSync } from 'fs';
import path from 'path';
import { provisionTenant } from '../../core/tenant-provisioning.js';
import { controlDb, getTenantBySlug } from '../../core/control-db.js';
import { APP_DIR } from './gate-env.mjs';

export async function negocioDesechable(nombre, { oficio = null } = {}) {
  const rid = randomBytes(3).toString('hex');
  const alta = await provisionTenant({
    businessName: nombre + ' ' + rid,
    ownerName: 'Dueña de prueba',
    email: nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + rid + '@bamburu.test',
    password: 'Gate.' + rid + '.Desechable!',
    phone: '+34 600 000 000',
  });
  const slug = alta.slug;
  const t = getTenantBySlug(slug);
  const abs = path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP_DIR, t.db_filename);
  const db = new Database(abs);
  if (oficio) {
    const { fijarOficio, sembrarCatalogo } = await import('../../modules/erp/oficios.js');
    fijarOficio(db, oficio); sembrarCatalogo(db, oficio);
  }
  const dueño = db.prepare("SELECT id FROM admin_users WHERE role='owner' ORDER BY id LIMIT 1").get();

  return {
    rid, slug, db, abs,
    // La dirección por la que se le habla, igual que a cualquier negocio.
    base: 'https://' + slug + '.bamburu.com',
    dueñoId: dueño ? dueño.id : null,
    // Una sesión de navegador para ese negocio. Se limpia sola: el negocio entero se tira al final.
    sesion(userId = dueño && dueño.id) {
      const tok = 'zz-' + rid + '-' + randomBytes(12).toString('hex');
      const ahora = Math.floor(Date.now() / 1000);
      db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
        .run(tok, userId, ahora, ahora + 3600, randomBytes(10).toString('hex'));
      return tok;
    },
    // TIRAR EL NEGOCIO ENTERO. Es lo que hace que esto no deje nada: no se borran facturas —no se
    // puede— se borra el negocio en el que nacieron, que nunca existió fuera de esta comprobación.
    tirar() {
      try { db.close(); } catch (_) {}
      try {
        const t2 = getTenantBySlug(slug);
        if (t2) controlDb.prepare('DELETE FROM tenant_sessions WHERE tenant_id=?').run(t2.id);
        controlDb.prepare('DELETE FROM tenants WHERE slug=?').run(slug);
        for (const f of [abs, abs + '-wal', abs + '-shm']) { try { unlinkSync(f); } catch (_) {} }
      } catch (e) {
        console.error('  ⚠️ NO SE PUDO TIRAR EL NEGOCIO «' + slug + '»: ' + e.message + '. Revísalo a mano.');
      }
    },
  };
}

// ── SEMBRAR LO MÍNIMO PARA PROBAR UN FLUJO DE DOCUMENTOS ─────────────────────────────────────────
// Cliente, almacén con stock y un producto físico. Es lo que necesitan todas las comprobaciones de
// pedidos, albaranes, presupuestos, mostrador y factura sustitutiva, así que se escribe UNA vez.
//
// LAS CIFRAS SON DE LA VIDA REAL a propósito (12 unidades, 30 €), no 9999: si un día algo se escapa
// de aquí, no distorsiona ningún informe. Es la norma que costó 523.002,90 € de ventas falsas.
export function sembrarFlujoDocumentos(db, { stock = 20, precio = 30 } = {}) {
  const almacen = db.prepare("SELECT id FROM warehouses WHERE active=1 ORDER BY id LIMIT 1").get()
    || { id: db.prepare("INSERT INTO warehouses (name, active) VALUES ('Almacén', 1)").run().lastInsertRowid };
  const cliente = db.prepare(
    "INSERT INTO clients (name, email, fiscal_id, active) VALUES ('Cliente de prueba', 'cliente@bamburu.test', 'B00000000', 1)"
  ).run().lastInsertRowid;
  const producto = db.prepare(
    "INSERT INTO products (name, sku, price, tax_rate, tax_band, type, status, stock) "
    + "VALUES ('Producto de prueba', 'PRB-001', ?, 21, 'general', 'physical', 'active', 0)"
  ).run(precio).lastInsertRowid;
  db.prepare(
    "INSERT INTO stock_movements (product_id, warehouse_id, type, quantity, origin_type, origin_id, created_at) "
    + "VALUES (?,?,'apertura',?, 'opening', 0, datetime('now'))"
  ).run(producto, almacen.id, stock);
  db.prepare('UPDATE products SET stock=? WHERE id=?').run(stock, producto);
  return { almacenId: almacen.id, clienteId: cliente, productoId: producto, precio, stock };
}
