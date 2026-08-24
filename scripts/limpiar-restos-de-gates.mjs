#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// LIMPIEZA PUNTUAL — los restos que mis gates dejaron dentro de un negocio.
//
// DE DÓNDE SALE: el dueño abrió sus informes y en los ejes le salían «GATE Tardío 1787050812»,
// «ZZ Dormido (gate b3708e)» y un grupo con fecha del año 2000. Medido el 23 ago 2026 en
// `desarrollo-bamburu`: **200 de sus 239 clientes eran basura de gates** — el 84 %.
//
// LA REGLA QUE MANDA AQUÍ, y por qué esto no borra todo lo que parece basura:
//   · Lo que NO tiene nada colgando se BORRA.
//   · Lo que tiene algo colgando que no se puede tocar se ARCHIVA (active=0), nunca se destruye.
//     Es la regla permanente del proyecto, y aquí además hay un motivo duro: 154 de esas facturas
//     tienen registro en la cadena de VERI*FACTU. Borrar sus clientes exigiría borrarlas a ellas, y
//     eso rompería otra vez la cadena que se recompuso esta misma tarde.
//   · Lo que PARECE basura y no lo es, se deja y se dice. Los siete movimientos con fecha
//     2000-01-01 son el stock de APERTURA de siete productos reales (Vela Lavanda, Aceite
//     Bergamota…): borrarlos cambiaría el stock de un producto de verdad. El grupo «2000» deja de
//     estorbar en los informes por el filtro de periodo, no borrando el dato.
//
// USO:
//   node scripts/limpiar-restos-de-gates.mjs                    → SIMULACRO
//   node scripts/limpiar-restos-de-gates.mjs --hazlo            → ejecuta, con copia previa
//   … --tenant=desarrollo-bamburu                               → un negocio (por defecto, todos)
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const HAZLO = process.argv.includes('--hazlo');
const SOLO = (process.argv.find(a => a.startsWith('--tenant=')) || '').split('=')[1] || null;
const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
const DIR = path.join(RAIZ, 'data', 'tenants');

// Cómo se reconoce lo que dejó un gate. Son los prefijos y marcas que usan los gates de este repo.
// Deliberadamente NO incluye «prueba» a secas: hay datos sembrados legítimos que lo llevan.
const MARCA_SQL = (col) => `(${col} LIKE 'GATE%' OR ${col} LIKE '%(gate %' OR ${col} LIKE '%(gate)%'
  OR ${col} LIKE 'ZZ %' OR ${col} LIKE 'ZZ-%' OR ${col} LIKE 'GD2-%' OR ${col} LIKE '%gate %')`;

// De qué tablas puede colgar un cliente. Si tiene algo en alguna, NO se borra: se archiva.
const DE_UN_CLIENTE = [
  ['invoices', 'client_id'], ['citas', 'cliente_id'], ['quotes', 'client_id'],
  ['customer_orders', 'client_id'], ['opportunities', 'client_id'],
  ['collection_actions', 'client_id'], ['disa_proposals', 'client_id'],
  ['delivery_notes', 'client_id'], ['client_activities', 'client_id'],
];
// De un PROVEEDOR: si tiene cualquiera de estos, no se borra. El 24 ago 2026 había **74 «GATE Rent
// Proveedor»** en el negocio de desarrollo —uno por cada vez que corrió gate-rentabilidad-pantalla—,
// y 46 de ellos sin nada colgando: borrables desde el primer día y nadie los miraba, porque este
// limpiador no tenía proveedores en la lista.
const DE_UN_PROVEEDOR = [
  ['supplier_invoices', 'supplier_id'], ['purchases', 'supplier_id'], ['purchase_orders', 'supplier_id'],
  ['supplier_returns', 'supplier_id'], ['products', 'supplier_id'], ['supplier_payments', 'supplier_id'],
];

const DE_UN_PRODUCTO = [
  ['invoice_items', 'product_id'], ['stock_movements', 'product_id'], ['cita_servicios', 'product_id'],
  ['quote_items', 'product_id'], ['purchase_items', 'product_id'], ['customer_order_items', 'product_id'],
];

const cuenta = (db, tabla, col, id) => {
  try { return db.prepare(`SELECT COUNT(*) n FROM ${tabla} WHERE ${col}=?`).get(id).n; }
  catch { return 0; }   // tabla archivada o inexistente: no cuenta
};
const libre = (db, id, mapa) => mapa.every(([t, c]) => cuenta(db, t, c, id) === 0);

function procesar(slug, ruta) {
  const db = new Database(ruta);
  db.pragma('busy_timeout = 10000');
  db.pragma('foreign_keys = ON');
  const R = { slug, borrado: {}, archivado: {}, intocable: {} };
  try {
    const hay = n => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(n);
    if (!hay('clients')) { db.close(); return null; }

    // ── CLIENTES ────────────────────────────────────────────────────────────────────────────────
    const cli = db.prepare(`SELECT id, name, active FROM clients WHERE ${MARCA_SQL('name')}`).all();
    const cliBorrar = cli.filter(c => libre(db, c.id, DE_UN_CLIENTE));
    const cliArchivar = cli.filter(c => !libre(db, c.id, DE_UN_CLIENTE) && c.active);

    // ── PRODUCTOS ───────────────────────────────────────────────────────────────────────────────
    const pro = db.prepare(`SELECT id, name, status FROM products WHERE ${MARCA_SQL('name')}`).all();
    const proBorrar = pro.filter(p => libre(db, p.id, DE_UN_PRODUCTO));
    const proArchivar = pro.filter(p => !libre(db, p.id, DE_UN_PRODUCTO) && p.status !== 'archived');

    // ── PROVEEDORES ─────────────────────────────────────────────────────────────────────────────
    const prv = hay('suppliers') ? db.prepare(`SELECT id, name, active FROM suppliers WHERE ${MARCA_SQL('name')}`).all() : [];
    const prvBorrar = prv.filter(x => libre(db, x.id, DE_UN_PROVEEDOR));
    const prvArchivar = prv.filter(x => !libre(db, x.id, DE_UN_PROVEEDOR) && x.active !== 0);

    // ── ALMACENES, RECURSOS Y CITAS ─────────────────────────────────────────────────────────────
    const alm = hay('warehouses') ? db.prepare(`SELECT id, name FROM warehouses WHERE ${MARCA_SQL('name')} AND is_default=0`).all() : [];
    const almBorrar = alm.filter(w => cuenta(db, 'stock_movements', 'warehouse_id', w.id) === 0);
    const rec = hay('recursos') ? db.prepare(`SELECT id, nombre FROM recursos WHERE ${MARCA_SQL('nombre')}`).all() : [];
    const recBorrar = rec.filter(r => cuenta(db, 'citas', 'recurso_id', r.id) === 0);
    const citas = hay('citas') ? db.prepare(`SELECT id FROM citas WHERE ${MARCA_SQL('codigo')}`).all() : [];
    const paneles = hay('analytics_panels') ? db.prepare(`SELECT id FROM analytics_panels WHERE ${MARCA_SQL('nombre')}`).all() : [];

    // ── LO QUE NO SE TOCA, Y SE DICE ────────────────────────────────────────────────────────────
    const enCadena = db.prepare(
      `SELECT COUNT(DISTINCT i.id) n FROM invoices i
        WHERE i.client_id IN (SELECT id FROM clients WHERE ${MARCA_SQL('name')})
          AND EXISTS (SELECT 1 FROM verifactu_registros r WHERE r.invoice_id = i.id)`).get().n;
    const apertura = db.prepare("SELECT COUNT(*) n FROM stock_movements WHERE created_at < '2020-01-01'").get().n;
    R.intocable = { facturas_en_la_cadena: enCadena, movimientos_de_apertura: apertura };

    if (!cli.length && !pro.length && !alm.length && !rec.length && !citas.length) { db.close(); return null; }

    console.log(`\n${'═'.repeat(90)}\nNEGOCIO: ${slug}\n${'═'.repeat(90)}`);
    const total = db.prepare('SELECT COUNT(*) c FROM clients').get().c;
    console.log(`  clientes con marca de gate: ${cli.length} de ${total} (${Math.round(cli.length / total * 100)} %)`);
    console.log(`    · se BORRAN (no cuelga nada de ellos): ${cliBorrar.length}`);
    console.log(`    · se ARCHIVAN (tienen facturas u otros): ${cliArchivar.length}`);
    console.log(`  productos con marca: ${pro.length} → borrar ${proBorrar.length} · archivar ${proArchivar.length}`);
    console.log(`  proveedores con marca: ${prv.length} → borrar ${prvBorrar.length} · archivar ${prvArchivar.length}`);
    console.log(`  almacenes vacíos con marca: ${almBorrar.length} de ${alm.length}`);
    console.log(`  recursos con marca sin citas: ${recBorrar.length} de ${rec.length}`);
    console.log(`  citas con código de gate: ${citas.length}`);
    console.log(`  informes guardados con marca: ${paneles.length}`);
    console.log(`  ── NO SE TOCAN ──`);
    console.log(`    ${enCadena} facturas de esos clientes están en la cadena de VERI*FACTU: intocables.`);
    console.log(`    ${apertura} movimientos con fecha 2000-01-01 son el stock de APERTURA de productos REALES.`);
    console.log(`      Borrarlos cambiaría el stock. El grupo «2000» se quita de los informes con el`);
    console.log(`      filtro de periodo, no destruyendo el dato.`);

    if (!HAZLO) { console.log('\n  SIMULACRO: no se ha escrito nada. Añade --hazlo para ejecutar.'); db.close(); return R; }

    const dirCopias = path.join(RAIZ, 'data', 'copias-limpieza');
    fs.mkdirSync(dirCopias, { recursive: true });
    const copia = path.join(dirCopias, `${slug}-antes-limpiar-gates.db`);
    fs.rmSync(copia, { force: true });
    db.exec(`VACUUM INTO '${copia.replace(/'/g, "''")}'`);
    console.log(`\n  ✓ copia de seguridad: ${copia}`);

    const enLista = a => '(' + (a.length ? a.map(x => x.id).join(',') : '-1') + ')';
    db.transaction(() => {
      // Primero lo que cuelga de lo que se va a borrar, para no dejar huérfanos.
      R.borrado.citas = citas.length ? db.prepare(`DELETE FROM citas WHERE id IN ${enLista(citas)}`).run().changes : 0;
      R.borrado.paneles = paneles.length ? db.prepare(`DELETE FROM analytics_panels WHERE id IN ${enLista(paneles)}`).run().changes : 0;
      R.borrado.clientes = cliBorrar.length ? db.prepare(`DELETE FROM clients WHERE id IN ${enLista(cliBorrar)}`).run().changes : 0;
      R.borrado.productos = proBorrar.length ? db.prepare(`DELETE FROM products WHERE id IN ${enLista(proBorrar)}`).run().changes : 0;
      R.borrado.almacenes = almBorrar.length ? db.prepare(`DELETE FROM warehouses WHERE id IN ${enLista(almBorrar)}`).run().changes : 0;
      R.borrado.recursos = recBorrar.length ? db.prepare(`DELETE FROM recursos WHERE id IN ${enLista(recBorrar)}`).run().changes : 0;
      R.borrado.proveedores = prvBorrar.length ? db.prepare(`DELETE FROM suppliers WHERE id IN ${enLista(prvBorrar)}`).run().changes : 0;
      R.archivado.clientes = cliArchivar.length ? db.prepare(`UPDATE clients SET active=0 WHERE id IN ${enLista(cliArchivar)}`).run().changes : 0;
      R.archivado.productos = proArchivar.length ? db.prepare(`UPDATE products SET status='archived' WHERE id IN ${enLista(proArchivar)}`).run().changes : 0;
      R.archivado.proveedores = prvArchivar.length ? db.prepare(`UPDATE suppliers SET active=0 WHERE id IN ${enLista(prvArchivar)}`).run().changes : 0;
    })();

    console.log('\n  BORRADO :', JSON.stringify(R.borrado));
    console.log('  ARCHIVADO:', JSON.stringify(R.archivado));
    const fk = db.pragma('foreign_key_check');
    console.log(`  ${fk.length === 0 ? '✓' : '✗'} foreign_key_check: ${fk.length === 0 ? 'limpio' : JSON.stringify(fk.slice(0, 3))}`);
    R.fk = fk.length;
    const quedan = db.prepare(`SELECT COUNT(*) c FROM clients WHERE active=1 AND ${MARCA_SQL('name')}`).get().c;
    console.log(`  ${quedan === 0 ? '✓' : '✗'} clientes de gate VISIBLES que quedan: ${quedan}`);
    R.quedan = quedan;
    db.close();
    return R;
  } catch (e) {
    try { db.close(); } catch {}
    console.error('  ✗ ERROR: ' + e.message);
    return { slug, error: e.message };
  }
}

console.log(HAZLO ? '⚠ MODO REAL — se borra y se archiva (con copia previa)' : '🔍 SIMULACRO — no se escribe nada');
let malo = 0;
for (const f of fs.readdirSync(DIR).filter(f => f.endsWith('.db'))) {
  const slug = f.replace(/\.db$/, '');
  if (SOLO && slug !== SOLO) continue;
  const r = procesar(slug, path.join(DIR, f));
  if (r && (r.error || r.fk || r.quedan)) malo = 1;
}
console.log(malo ? '\n✗ REVISAR' : (HAZLO ? '\n✓ HECHO.' : '\n(fin del simulacro)'));
process.exit(malo);
