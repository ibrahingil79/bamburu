// REPOSICIÓN DE STOCK (Pilar 3 · stock mínimo / punto de pedido). El "cuándo reponer" y el "cuánto",
// sin tocar el libro de stock ni el WAC: solo LEE el disponible por almacén y CONFIGURA niveles.
//
// Tres piezas encajadas:
//   1. NIVELES por (producto, almacén): mínimo y objetivo. Apagados por defecto (solo se vigila donde el
//      dueño pone número). Solo productos FÍSICOS. Se editan en la ficha del producto (servicio validado).
//   2. BAJO MÍNIMO: un (producto, almacén) está bajo mínimo cuando su DISPONIBLE (físico − reservado, por
//      almacén) cae por debajo de SU mínimo. Alimenta el aviso de la campana/correo (avisos.js).
//   3. PROPUESTA de DISA (6º tipo): AGRUPA los bajo-mínimo por PROVEEDOR HABITUAL del producto → una
//      propuesta = un borrador de orden de compra a ese proveedor. Aprobar CREA el borrador (no lo envía).
//      Un producto bajo mínimo SIN proveedor habitual AVISA pero NO se propone (no se inventa proveedor).
//
// DISA no escribe aquí directo: stock_levels y disa_proposals están FUERA de WRITABLE_TABLES; todo pasa
// por estos servicios validados, como el resto de las propuestas.
import { availableOfProduct } from './stock.js';
import { lastKnownCost, createPurchaseOrderSvc } from './routes/purchase-orders.js';

export const TIPO_REPOSICION = 'reposicion_stock';

// Los (producto, almacén) que están BAJO MÍNIMO ahora mismo. Uno por almacén: un producto puede estar
// bajo mínimo en un almacén y sobrado en otro — se mide por almacén, contra SU mínimo. Solo físicos y
// activos, solo almacenes activos, solo donde hay un mínimo puesto (min_qty>0 = vigilado).
export function productosBajoMinimo(db) {
  const rows = db.prepare(`
    SELECT sl.product_id, sl.warehouse_id, sl.min_qty, sl.target_qty,
           p.name AS product_name, p.supplier_id,
           w.name AS warehouse_name,
           s.name AS supplier_name
      FROM stock_levels sl
      JOIN products p    ON p.id = sl.product_id
      JOIN warehouses w  ON w.id = sl.warehouse_id
      LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.active = 1
     WHERE sl.min_qty > 0
       AND p.status = 'active' AND (p.type = 'physical' OR p.type IS NULL)
       AND w.active = 1
     ORDER BY p.name, w.name`).all();
  const out = [];
  for (const r of rows) {
    const disponible = availableOfProduct(db, r.product_id, r.warehouse_id);
    if (disponible >= r.min_qty) continue;                       // en ESE almacén no está bajo mínimo
    // Objetivo efectivo: el que puso el dueño si es >= mínimo; si no lo puso (0) o es incoherente, el mínimo.
    const target = (r.target_qty && r.target_qty >= r.min_qty) ? r.target_qty : r.min_qty;
    out.push({
      product_id: r.product_id, product_name: r.product_name,
      warehouse_id: r.warehouse_id, warehouse_name: r.warehouse_name,
      min_qty: r.min_qty, target_qty: target, disponible,
      faltan: Math.max(1, target - disponible),
      // supplier_name null = sin proveedor habitual O el habitual está archivado (LEFT JOIN active=1):
      // en ambos casos no se puede preparar la compra → avisa pero no propone.
      supplier_id: r.supplier_id || null,
      supplier_name: r.supplier_name || null,
    });
  }
  return out;
}

// Huella de la SITUACIÓN de un proveedor: qué (producto, almacén) están bajo mínimo, ordenado. NO incluye
// cantidades (una fluctuación de una unidad no debe re-proponer lo descartado); SÍ la composición (que un
// producto NUEVO caiga cambia la huella → sí se re-propone). Reproducible, sin depender del orden de query.
function firmaSituacion(entries) {
  return entries.map(e => 'p' + e.product_id + 'w' + e.warehouse_id).sort().join(',');
}

// Líneas del borrador de compra para un proveedor: una por PRODUCTO (la orden no tiene dimensión almacén).
// Cantidad = Σ (objetivo − disponible) de los almacenes donde ese producto está bajo mínimo, entera, ≥1.
// Coste = último coste conocido (0 si nunca se compró: el dueño lo edita antes de enviar).
function lineasDeProveedor(db, entries) {
  const byProduct = new Map();
  for (const e of entries) {
    const cur = byProduct.get(e.product_id)
      || { product_id: e.product_id, product_name: e.product_name, quantity: 0, warehouses: [] };
    cur.quantity += Math.max(1, e.target_qty - e.disponible);
    cur.warehouses.push({ warehouse_id: e.warehouse_id, warehouse_name: e.warehouse_name,
                          disponible: e.disponible, min_qty: e.min_qty, target_qty: e.target_qty });
    byProduct.set(e.product_id, cur);
  }
  const lineas = [];
  for (const p of byProduct.values()) {
    const cost = lastKnownCost(db, p.product_id);
    lineas.push({ ...p, quantity: Math.max(1, Math.round(p.quantity)), unit_cost: cost == null ? 0 : Number(cost) });
  }
  return lineas.sort((a, b) => String(a.product_name).localeCompare(String(b.product_name)));
}

// Agrupa los bajo-mínimo por proveedor USABLE (con proveedor habitual activo). Devuelve
// { porProveedor: Map<supplier_id,{supplier_id,supplier_name,entries[]}>, sinProveedor: nº de entradas }.
function agruparPorProveedor(bajo) {
  const porProveedor = new Map();
  let sinProveedor = 0;
  for (const e of bajo) {
    if (e.supplier_id && e.supplier_name) {
      const g = porProveedor.get(e.supplier_id)
        || { supplier_id: e.supplier_id, supplier_name: e.supplier_name, entries: [] };
      g.entries.push(e); porProveedor.set(e.supplier_id, g);
    } else sinProveedor++;
  }
  return { porProveedor, sinProveedor };
}

// Genera las propuestas de reposición que falten, UNA por proveedor con productos bajo mínimo. Devuelve
// { creadas, yaTenian, expiradas, candidatas, sinProveedor }. Reglas de NO DUPLICAR:
//   · una VIVA (pendiente) por proveedor — lo garantiza el índice único parcial y este chequeo;
//   · si hay un BORRADOR vivo creado por esta vía para el proveedor (aprobada + PO en 'borrador'), no se apila;
//   · una DESCARTADA con la MISMA huella no se re-propone (hasta que la situación cambie);
//   · RECUPERACIÓN: si un proveedor ya NO está bajo mínimo, sus propuestas vivas/descartadas → 'expirada'
//     (la pendiente moot se retira y la descartada deja de bloquear una futura re-caída, que traerá huella nueva).
export function generarPropuestasReposicion(db, opts = {}) {
  const bajo = productosBajoMinimo(db);
  const { porProveedor, sinProveedor } = agruparPorProveedor(bajo);
  const currentSuppliers = new Set(porProveedor.keys());

  // Recuperación: expira lo que ya no aplica.
  let expiradas = 0;
  const vivas = db.prepare("SELECT id, supplier_id FROM disa_proposals WHERE type=? AND status IN ('pendiente','descartada')").all(TIPO_REPOSICION);
  const exp = db.prepare("UPDATE disa_proposals SET status='expirada' WHERE id=?");
  for (const v of vivas) if (!currentSuppliers.has(v.supplier_id)) { exp.run(v.id); expiradas++; }

  const now = opts.now || new Date().toISOString();
  const ins = db.prepare(`INSERT INTO disa_proposals (type, supplier_id, status, subject, repo_signature, created_at)
                          VALUES (?, ?, 'pendiente', ?, ?, ?)`);
  const qPend  = db.prepare("SELECT id FROM disa_proposals WHERE type=? AND supplier_id=? AND status='pendiente'");
  const qDraft = db.prepare(`SELECT p.id FROM disa_proposals p JOIN purchase_orders po ON po.id=p.repo_po_id
                              WHERE p.type=? AND p.supplier_id=? AND p.status='aprobada' AND po.status='borrador'`);
  const qDesc  = db.prepare("SELECT id FROM disa_proposals WHERE type=? AND supplier_id=? AND status='descartada' AND repo_signature=?");

  let creadas = 0, yaTenian = 0;
  for (const g of porProveedor.values()) {
    if (qPend.get(TIPO_REPOSICION, g.supplier_id)) { yaTenian++; continue; }               // una viva por proveedor
    if (qDraft.get(TIPO_REPOSICION, g.supplier_id)) { yaTenian++; continue; }               // borrador vivo → no apilar
    const sig = firmaSituacion(g.entries);
    if (qDesc.get(TIPO_REPOSICION, g.supplier_id, sig)) { yaTenian++; continue; }           // descartada, misma situación
    ins.run(TIPO_REPOSICION, g.supplier_id, g.supplier_name, sig, now);
    creadas++;
  }
  return { creadas, yaTenian, expiradas, candidatas: currentSuppliers.size, sinProveedor };
}

// Detalle EN VIVO de una propuesta de reposición para el panel: recalcula la situación del proveedor
// (nunca de una copia guardada), arma las líneas del borrador que se crearía, y marca `viva` = el
// proveedor sigue con productos bajo mínimo. Si se repuso todo, viva=false y el panel lo avisa.
export function detallePropuestaReposicion(db, proposal) {
  const entries = productosBajoMinimo(db).filter(e => e.supplier_id === proposal.supplier_id && e.supplier_name);
  const lineas = lineasDeProveedor(db, entries);
  const sup = db.prepare('SELECT name FROM suppliers WHERE id=?').get(proposal.supplier_id);
  const total = lineas.reduce((s, l) => s + l.quantity * l.unit_cost, 0);
  return {
    id: proposal.id, type: proposal.type, supplier_id: proposal.supplier_id,
    supplier_name: (sup && sup.name) || proposal.subject || 'Proveedor',
    created_at: proposal.created_at,
    lineas, n_productos: lineas.length, total_estimado: total,
    algun_coste_desconocido: lineas.some(l => !l.unit_cost),
    viva: lineas.length > 0,
  };
}

// APROBAR = crear el BORRADOR de orden de compra (createPurchaseOrderSvc) con la situación ACTUAL, y dejar
// la propuesta 'aprobada' con el id del borrador. NO envía nada al proveedor: enviar es el 2º clic del dueño
// desde la orden. Bloquea el doble uso (solo desde 'pendiente') y el vacío (si ya se repuso todo).
export function aprobarReposicionSvc(db, proposalId, quien, opts = {}) {
  const p = db.prepare('SELECT * FROM disa_proposals WHERE id=?').get(proposalId);
  if (!p) { const e = new Error('Propuesta no encontrada'); e.status = 404; throw e; }
  if (p.type !== TIPO_REPOSICION) { const e = new Error('Esta propuesta no es de reposición de stock.'); e.status = 400; throw e; }
  if (p.status !== 'pendiente') { const e = new Error('Esta propuesta ya se resolvió (' + p.status + ').'); e.status = 409; throw e; }
  const entries = productosBajoMinimo(db).filter(e => e.supplier_id === p.supplier_id && e.supplier_name);
  const lineas = lineasDeProveedor(db, entries);
  if (!lineas.length) { const e = new Error('Ya no hay productos bajo mínimo de este proveedor: nada que reponer.'); e.status = 409; throw e; }
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const poId = Number(createPurchaseOrderSvc(db, {
    supplier_id: p.supplier_id, date: today,
    notes: 'Borrador preparado por DISA (reposición de stock bajo mínimo). Revísalo y envíalo tú.',
    items: lineas.map(l => ({ product_id: l.product_id, quantity: l.quantity, unit_cost: l.unit_cost })),
  }));
  db.prepare("UPDATE disa_proposals SET status='aprobada', resolved_at=?, resolved_by=?, repo_po_id=? WHERE id=?")
    .run(new Date().toISOString(), String(quien || ''), poId, proposalId);
  return { po_id: poId, lineas: lineas.length };
}

// ── Configuración de niveles (ficha del producto) ───────────────────────────────────────────────
// Por almacén activo: min/target guardados (o 0 = no vigilado) + el disponible actual, para que el dueño
// vea contra qué compara. Solo tiene sentido para productos físicos (lo filtra la ruta).
export function nivelesDeProducto(db, productId) {
  const whs = db.prepare('SELECT id, name, is_default FROM warehouses WHERE active=1 ORDER BY is_default DESC, id').all();
  const guardados = new Map(db.prepare('SELECT warehouse_id, min_qty, target_qty FROM stock_levels WHERE product_id=?')
    .all(productId).map(l => [l.warehouse_id, l]));
  return whs.map(w => {
    const l = guardados.get(w.id) || { min_qty: 0, target_qty: 0 };
    return { warehouse_id: w.id, warehouse_name: w.name, is_default: !!w.is_default,
             min_qty: l.min_qty || 0, target_qty: l.target_qty || 0,
             disponible: availableOfProduct(db, productId, w.id) };
  });
}

// Guarda los niveles de un producto (upsert por almacén). min<=0 = apagar ese almacén = borrar la fila
// (no vigilado). Transaccional. `quien` para auditoría.
export function setNivelesProducto(db, productId, levels, quien) {
  const now = new Date().toISOString();
  const up = db.prepare(`INSERT INTO stock_levels (product_id, warehouse_id, min_qty, target_qty, updated_at, updated_by)
                         VALUES (?,?,?,?,?,?)
                         ON CONFLICT(product_id, warehouse_id) DO UPDATE SET
                           min_qty=excluded.min_qty, target_qty=excluded.target_qty,
                           updated_at=excluded.updated_at, updated_by=excluded.updated_by`);
  const del = db.prepare('DELETE FROM stock_levels WHERE product_id=? AND warehouse_id=?');
  db.transaction(() => {
    for (const l of levels || []) {
      const min = Math.max(0, Math.floor(Number(l.min_qty) || 0));
      const target = Math.max(0, Math.floor(Number(l.target_qty) || 0));
      if (min <= 0) { del.run(productId, l.warehouse_id); continue; }   // apagar = borrar
      up.run(productId, l.warehouse_id, min, target, now, String(quien || ''));
    }
  })();
}
