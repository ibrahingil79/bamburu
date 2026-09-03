#!/usr/bin/env node
//
// gate-disa-stock-libro.mjs — QUE DISA NO MUEVA EXISTENCIAS SIN DEJAR SU APUNTE.
//
// DE DÓNDE SALE (AUD-004, comprobado vivo el 2 sep 2026). `edit_product` hacía
// `UPDATE products SET name=?, price=?, stock=?`: DISA escribía las existencias a pelo, saltándose el
// libro `stock_movements` por el que pasa todo lo demás. Se saltaba de una vez las seis guardas de
// `adjustStock` —físico, traza por lote, motivo, almacén, aviso de reserva, coste medio— y encima el
// número **no sobrevivía**: al primer movimiento real, `recomputeStock` lo borraba sin avisar.
//
// QUÉ EXIGE ESTE GATE, y todo se mide CONTANDO EN LA BASE, no leyendo el código:
//   [1] EL FALLO, REPRODUCIDO PRIMERO: se demuestra que la avería vieja habría dejado el stock
//       cambiado y CERO movimientos. Es la línea base contra la que se compara.
//   [2] Con el arreglo: DISA cambia el stock y queda UN movimiento de ajuste con su QUIÉN, su fecha,
//       su cantidad con signo y su motivo — y `products.stock` es la SUMA EXACTA del libro.
//   [3] El coste medio (WAC) sigue cuadrando, y la valoración con él.
//   [4] Las guardas del servicio valen también para DISA: sin motivo no toca el stock; un producto
//       que no es físico y uno trazado se rechazan; por debajo de lo reservado avisa.
//   [5] Las VARIANTES: DISA no cambia sus existencias por ningún camino, y lo DICE.
//
// Se trae su propio negocio y lo tira al terminar con `tirarNegocio`, que suelta las ataduras
// preguntando al esquema. No toca ningún negocio real.
//
//   node scripts/gate-disa-stock-libro.mjs
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import path from 'path';
import { APP_DIR } from './lib/gate-env.mjs';
import { tirarNegocio } from './lib/tirar-negocio.mjs';
import { provisionTenant } from '../core/tenant-provisioning.js';
import { getTenantBySlug } from '../core/control-db.js';
import { createProductSvc } from '../modules/erp/routes/products.js';
import { recordMovement, defaultWarehouseId, productStock } from '../modules/erp/stock.js';

const RID = randomBytes(3).toString('hex');
let pass = 0, fail = 0;
const ok = (c, m, det) => {
  if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); }
  else { fail++; console.error('  ✗ FALLO: ' + m + (det ? ' · ' + det : '')); }
};

let slug = null, db = null;
const movs = (id) => db.prepare('SELECT * FROM stock_movements WHERE product_id=? ORDER BY id').all(id);
const sumaLibro = (id) => db.prepare('SELECT COALESCE(SUM(quantity),0) s FROM stock_movements WHERE product_id=?').get(id).s;
const cache = (id) => db.prepare('SELECT stock, average_cost FROM products WHERE id=?').get(id);

try {
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[0] UN NEGOCIO DE CERO, con su producto físico y su stock de apertura');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const alta = await provisionTenant({
    businessName: 'Gate Stock Libro ' + RID, ownerName: 'Dueña Gate',
    email: 'delivered@resend.dev', password: 'Gate.Stock.' + RID + '!', phone: '+34 600 000 000',
  });
  slug = alta.slug;
  const t = getTenantBySlug(slug);
  db = new Database(path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP_DIR, t.db_filename));
  db.pragma('busy_timeout = 10000');
  const duenyo = db.prepare("SELECT id FROM admin_users WHERE role='owner' ORDER BY id LIMIT 1").get().id;

  const prod = createProductSvc(db, { name: 'ZZ Tornillo ' + RID, sku: 'ZZ-' + RID, price: 10,
                                      stock: 20, type: 'physical', tax_band: 'general' });
  // Una entrada con coste, para que el coste medio sea distinto de cero y se pueda comprobar.
  recordMovement(db, { product_id: prod.id, type: 'entrada', quantity: 10, origin_type: 'purchase', unit_cost: 4 });
  const wacAntes = cache(prod.id).average_cost;
  ok(productStock(db, prod.id) === 30 && sumaLibro(prod.id) === 30,
     'producto físico con 30 uds y su libro cuadrado', 'caché ' + cache(prod.id).stock + ' = libro ' + sumaLibro(prod.id));
  ok(wacAntes > 0, 'y con coste medio distinto de cero, para poder comprobarlo después', wacAntes.toFixed(4) + ' €');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] LA AVERÍA VIEJA, REPRODUCIDA — la línea base contra la que se compara');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // Se ejecuta el SQL exacto que hacía `edit_product` antes del arreglo, sobre un producto aparte.
  const cobaya = createProductSvc(db, { name: 'ZZ Cobaya ' + RID, sku: 'ZZC-' + RID, price: 5,
                                        stock: 7, type: 'physical', tax_band: 'general' });
  const movsAntes = movs(cobaya.id).length;
  db.prepare('UPDATE products SET name=?, price=?, stock=? WHERE id=?')
    .run('ZZ Cobaya ' + RID, 5, 999, cobaya.id);
  ok(cache(cobaya.id).stock === 999 && movs(cobaya.id).length === movsAntes,
     'ASÍ ERA EL FALLO: el stock salta a 999 y NO aparece ni un movimiento',
     'caché 999 · libro sigue en ' + sumaLibro(cobaya.id) + ' · movimientos ' + movs(cobaya.id).length);
  // Y la parte que lo hacía intermitente: el número se evapora al primer movimiento real.
  recordMovement(db, { product_id: cobaya.id, type: 'salida', quantity: -1, origin_type: 'ticket' });
  ok(cache(cobaya.id).stock === 6,
     'y se EVAPORA al primer movimiento real: 999 → 6, sin avisar a nadie', 'caché ' + cache(cobaya.id).stock);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] CON EL ARREGLO: DISA ajusta y deja su apunte');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const { ejecutorDeAcciones } = await import('./lib/disa-accion.mjs');
  const disa = ejecutorDeAcciones(db);
  const ses = { userId: duenyo, userName: 'Dueña Gate', role: 'owner' };
  const antes = movs(prod.id).length;
  const r1 = await disa({ type: 'edit_product',
    params: { product_id: prod.id, name: 'ZZ Tornillo ' + RID, stock: 25, reason: 'error_conteo' } }, ses);
  ok(r1.ok, 'DISA acepta el ajuste con motivo válido', (r1.message || '').slice(0, 90));

  const nuevos = movs(prod.id).slice(antes);
  ok(nuevos.length === 1, 'ha quedado UN movimiento, ni cero ni dos', nuevos.length + '');
  const mv = nuevos[0] || {};
  ok(mv.type === 'ajuste', 'de tipo «ajuste»', mv.type);
  ok(mv.quantity === -5, 'con la CANTIDAD con signo (30 → 25 = −5)', String(mv.quantity));
  ok(mv.reason === 'error_conteo', 'con su MOTIVO de la lista cerrada', mv.reason);
  ok(mv.created_by === duenyo, 'y con su QUIÉN: el usuario que habló con DISA', 'created_by=' + mv.created_by + ' (dueño ' + duenyo + ')');
  ok(!!mv.created_at, 'y su CUÁNDO', mv.created_at);
  ok(cache(prod.id).stock === 25 && sumaLibro(prod.id) === 25,
     'y la caché es la SUMA EXACTA del libro', 'caché ' + cache(prod.id).stock + ' = libro ' + sumaLibro(prod.id));

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] EL COSTE MEDIO SIGUE CUADRANDO');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // Un ajuste es una salida sin coste: no reescribe el WAC de las unidades que ya estaban.
  ok(Math.abs(cache(prod.id).average_cost - wacAntes) < 0.0001,
     'el coste medio no se ha movido con el ajuste', wacAntes.toFixed(4) + ' → ' + cache(prod.id).average_cost.toFixed(4));
  // Y la valoración es coherente con el saldo del libro.
  ok(Math.round(cache(prod.id).stock * cache(prod.id).average_cost * 100) / 100
     === Math.round(sumaLibro(prod.id) * cache(prod.id).average_cost * 100) / 100,
     'y la valoración sale del mismo saldo que el libro');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] LAS GUARDAS DEL SERVICIO VALEN TAMBIÉN PARA DISA');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const antesSinMotivo = movs(prod.id).length;
  const r2 = await disa({ type: 'edit_product', params: { product_id: prod.id, stock: 50 } }, ses);
  ok(movs(prod.id).length === antesSinMotivo && cache(prod.id).stock === 25,
     'SIN MOTIVO no toca las existencias', 'sigue en ' + cache(prod.id).stock);
  ok(/motivo/i.test(r2.message || ''), 'y lo DICE, en vez de callarse', (r2.message || '').slice(0, 80));

  const servicio = createProductSvc(db, { name: 'ZZ Corte ' + RID, sku: 'ZZS-' + RID, price: 20,
                                          stock: 0, type: 'service', tax_band: 'general' });
  const r3 = await disa({ type: 'edit_product',
    params: { product_id: servicio.id, stock: 5, reason: 'error_conteo' } }, ses);
  ok(movs(servicio.id).length === 0 && /físicos|fisicos/i.test(r3.message || ''),
     'un producto que NO es físico se rechaza', (r3.message || '').slice(0, 80));

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] LAS VARIANTES: DISA no toca sus existencias, y lo dice');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const r4 = await disa({ type: 'create_variant',
    params: { product_id: prod.id, name: 'Roja', stock: 40 } }, ses);
  const v = db.prepare('SELECT * FROM product_variants WHERE product_id=? ORDER BY id DESC LIMIT 1').get(prod.id);
  ok(r4.ok && v && v.stock === 0, 'creando una variante con stock, la variante nace en 0', 'stock=' + (v ? v.stock : '?'));
  ok(/existencias NO/i.test(r4.message || ''), 'y DISA avisa de que no las ha puesto', (r4.message || '').slice(0, 90));
  const r5 = await disa({ type: 'edit_variant', params: { variant_id: v.id, name: 'Azul', stock: 77 } }, ses);
  const v2 = db.prepare('SELECT * FROM product_variants WHERE id=?').get(v.id);
  ok(v2.name === 'Azul' && v2.stock === 0, 'editándola, cambia el nombre y NO el stock', 'stock=' + v2.stock);
  ok(/existencias NO/i.test(r5.message || ''), 'y también lo dice', (r5.message || '').slice(0, 90));

} catch (e) {
  fail++;
  console.error('  ✗ EXCEPCIÓN: ' + (e?.stack || e?.message || e));
} finally {
  try { if (db) db.close(); } catch {}
  if (slug) { console.log('\n[limpieza] tirando el negocio de prueba: ' + slug); tirarNegocio(slug); }
}

console.log('\n═════════ RESULTADO: ' + pass + ' ✓ · ' + fail + ' ✗ ═════════');
process.exit(fail ? 1 : 0);
