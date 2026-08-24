// Gate del RASTRO AUDITABLE del traslado entre almacenes, y de sus dos invariantes de siempre.
//
// El traslado se registra desde DOS sitios —la ruta del panel y la acción `transfer_stock` de
// DISA— y cada uno escribía el nombre de la entidad a mano. Divergieron: 'stock_transfer' contra
// 'stock_transfers'. Auditar por `entity='stock_transfer'` NO devolvía los traslados de DISA.
// Este gate fija el criterio: una sola constante, importada por los dos.
//
// Lo que muta se hace sobre una COPIA de una BD real; los datos vivos no se tocan.
//   node scripts/verify-traslado-auditoria.mjs
import Database from 'better-sqlite3';
import { readFileSync, copyFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createStockTransferSvc, TRANSFER_ENTITY, transferLogDetails } from '../modules/erp/routes/stock-transfers.js';
import { productStockInWarehouse } from '../modules/erp/stock.js';
import { activeWarehouses } from '../modules/erp/routes/warehouses.js';
import { logActivity } from '../core/auth.js';
// 24 ago 2026 · La copia va por `copiarBase` (sqlite .backup), no por copyFileSync: los negocios
// corren en WAL y un `cp` deja fuera el -wal, o sea mide una foto vieja. Ver scripts/lib/copia-consistente.mjs.
import { copiarBase } from './lib/copia-consistente.mjs';

const ORIGEN = 'data/tenants/desarrollo-bamburu.db';
const COPIA = join(tmpdir(), 'bamburu-verify-traslado-' + process.pid + '.db');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

copiarBase(ORIGEN, COPIA);
const db = new Database(COPIA);

try {
  // ── 1. La etiqueta de la entidad es una sola, y los dos caminos la importan ──────────
  console.log('\n[1] Rastro auditable: una sola entidad para los dos caminos');
  ok(TRANSFER_ENTITY === 'stock_transfer', `la constante existe y es singular ('${TRANSFER_ENTITY}')`);

  // Se miran las líneas de CÓDIGO, no los comentarios: esta misma explicación menciona la etiqueta
  // vieja, y un grep ingenuo se casaría con ella.
  const codigo = txt => txt.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const disaSrc = codigo(readFileSync('modules/disa/index.js', 'utf8'));
  const rutaSrc = codigo(readFileSync('modules/erp/routes/stock-transfers.js', 'utf8'));
  const i = disaSrc.indexOf("case 'transfer_stock'");
  const casoDisa = disaSrc.slice(i, i + 1600);
  ok(casoDisa.includes('TRANSFER_ENTITY'), 'la acción transfer_stock de DISA usa la constante');
  ok(!/'stock_transfers'/.test(casoDisa), "la acción de DISA ya NO teclea 'stock_transfers' a mano");
  // Por línea: `logActivity(db, c.get('session'), …)` lleva paréntesis dentro, así que [^)]* no vale.
  const llamadasConConstante = rutaSrc.split('\n').filter(l => /logActivity\(/.test(l) && /TRANSFER_ENTITY/.test(l));
  ok(llamadasConConstante.length === 2, `las dos rutas del panel (crear y anular) usan la constante (${llamadasConConstante.length})`);
  ok(!rutaSrc.split('\n').some(l => /logActivity\(/.test(l) && /'stock_transfers?'/.test(l)),
    'ninguna ruta teclea el literal a mano');

  // ── 2. Y de verdad se encuentra con UNA sola consulta ────────────────────────────────
  console.log('\n[2] Una consulta por entidad encuentra el traslado, venga de donde venga');
  const whs = activeWarehouses(db);
  const prod = db.prepare(`SELECT p.id, p.name FROM products p WHERE p.status='active' AND p.stock > 4
                             AND COALESCE(p.average_cost,0) > 0 ORDER BY p.stock DESC LIMIT 1`).get();
  const origen = whs.find(w => productStockInWarehouse(db, prod.id, w.id) > 4);
  const destino = whs.find(w => w.id !== origen.id);

  const valorTotal = () => db.prepare("SELECT ROUND(SUM(stock*COALESCE(average_cost,0)),6) v FROM products WHERE status='active'").get().v;
  const vAntes = valorTotal();
  const oAntes = productStockInWarehouse(db, prod.id, origen.id);
  const dAntes = productStockInWarehouse(db, prod.id, destino.id);

  // Camino "panel": servicio + logActivity de core/auth.js (firma db, session, action, entity, id, details).
  const rPanel = createStockTransferSvc(db, {
    from_warehouse_id: origen.id, to_warehouse_id: destino.id, date: '2026-07-10',
    notes: 'gate auditoría · panel', items: [{ product_id: prod.id, quantity: 2 }],
  });
  logActivity(db, { userId: 1, userName: 'Gate Panel' }, 'Registró traslado entre almacenes', TRANSFER_ENTITY, rPanel.id, transferLogDetails(rPanel));

  // Camino "DISA": mismo servicio, y el logger LOCAL de DISA (firma db, action, entity, id, details, session).
  const rDisa = createStockTransferSvc(db, {
    from_warehouse_id: origen.id, to_warehouse_id: destino.id, date: '2026-07-10',
    notes: 'gate auditoría · disa', items: [{ product_id: prod.id, quantity: 1 }],
  });
  const logActivityDisa = (dbx, action, entity, entityId, details, session) =>
    dbx.prepare('INSERT INTO activity_logs (user_id,user_name,action,entity,entity_id,details) VALUES (?,?,?,?,?,?)')
      .run(session?.userId || null, session?.userName || 'DISA', action, entity, entityId, details);
  logActivityDisa(db, 'Registró traslado entre almacenes (DISA)', TRANSFER_ENTITY, rDisa.id, transferLogDetails(rDisa), null);

  const encontrados = db.prepare('SELECT user_name, action, entity, entity_id, details FROM activity_logs WHERE entity=? AND entity_id IN (?,?)')
    .all(TRANSFER_ENTITY, rPanel.id, rDisa.id);
  ok(encontrados.length === 2, `una consulta WHERE entity='${TRANSFER_ENTITY}' devuelve LOS DOS traslados (${encontrados.length})`);
  encontrados.forEach(r => console.log(`      · ${r.user_name} — ${r.action} — ${r.details}`));
  ok(encontrados.some(r => r.user_name === 'DISA'), 'el hecho por DISA también sale, y con su autor');
  ok(encontrados.every(r => /TR-\d+ \(\d+ línea/.test(r.details)), 'los dos llevan el mismo detalle legible');

  // ── 3. Los invariantes de siempre siguen en pie ──────────────────────────────────────
  console.log('\n[3] Invariantes del traslado (no debe cambiar nada de esto)');
  const vDespues = valorTotal();
  ok(productStockInWarehouse(db, prod.id, origen.id) === oAntes - 3, `baja exacta en origen (${oAntes} → ${oAntes - 3})`);
  ok(productStockInWarehouse(db, prod.id, destino.id) === dAntes + 3, `sube exacta en destino (${dAntes} → ${dAntes + 3})`);
  ok(vDespues === vAntes, `valor total del inventario intacto (${vAntes})`);

  let bloqueado = '';
  try {
    createStockTransferSvc(db, { from_warehouse_id: origen.id, to_warehouse_id: destino.id, date: '2026-07-10', notes: 'x',
      // PASARSE DEL STOCK, con una cifra de la vida real: lo que hay en origen MÁS UNO. Antes ponía
      // 999.999, que distorsiona cualquier informe si un día se escapa. Se calcula sobre el stock de
      // verdad para que siga pasándose aunque el almacén cambie: una cifra fija se queda corta o larga.
      items: [{ product_id: prod.id, quantity: productStockInWarehouse(db, prod.id, origen.id) + 1 }] });
  } catch (e) { bloqueado = e.message; }
  ok(/disponible en/.test(bloqueado), `sacar más de lo que hay se impide: "${bloqueado.slice(0, 70)}…"`);

  // ── 4. Las filas VIEJAS no se reescriben ────────────────────────────────────────────
  console.log('\n[4] El histórico no se toca (un registro de actividad no se reescribe hacia atrás)');
  const viejas = db.prepare("SELECT COUNT(*) n FROM activity_logs WHERE entity='stock_transfers'").get().n;
  ok(viejas >= 0, `filas antiguas con la etiqueta vieja: ${viejas} (se conservan tal cual, a propósito)`);
} finally {
  db.close();
  try { unlinkSync(COPIA); } catch {}
  console.log('\n' + (fail ? '✗ ' + fail + ' fallos, ' : '') + pass + ' OK  (sobre una COPIA; los datos vivos no se tocaron)');
  process.exit(fail ? 1 : 0);
}
