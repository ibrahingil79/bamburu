#!/usr/bin/env node
// verify-residuo-de-pruebas.mjs — el censo que vigila que el barrido no ensucie el entorno.
// Tarea `barrera-permisos-contamina-el-barrido` (9 sep 2026).
//
// DE DÓNDE SALE. Al correr `node scripts/run-gates.mjs --all` el 9 sep 2026 para cerrar
// `enviar-documentos-por-correo`, varios gates interrumpidos a medias (por la contaminación de
// `gate-barrera-permisos`, arreglada en esa misma tarea) dejaron residuo real: 26 negocios de
// prueba huérfanos en `control.db`, ficheros fantasma y facturas de prueba emitidas de verdad en
// el tenant compartido. Se localizó y limpió a mano, una vez. **Esto es para que la próxima vez
// se vea solo, sin que alguien tenga que ir a buscarlo.**
//
// QUÉ ES, Y QUÉ NO. No es un limpiador (eso ya existe: `limpiar-restos-de-gates.mjs`, y las
// mismas marcas viven ahora en `scripts/lib/marca-de-gate.mjs`, punto único). Es una
// COMPROBACIÓN DE ESTADO ABSOLUTA: "¿queda ahora mismo algún resto de gate vivo?" — igual que
// `verify-barrido-no-infla-ventas` pregunta "¿se emitió hoy alguna factura en el negocio
// compartido?". Correrla ANTES de un barrido prueba que se parte de un entorno limpio; correrla
// DESPUÉS prueba que el barrido no ensució nada. Dos pasadas de esto sin residuo nuevo entre
// medias es, por definición, "el barrido no acumula".
//
// QUÉ MIRA:
//   1. `control.db`: ¿hay algún negocio con slug de gate (`gate-…`, `__gate_…`)? Un
//      `EMPIEZAN_DE_CERO` que terminó bien se borra a sí mismo; uno vivo es un negocio de prueba
//      que alguien se dejó a medias.
//   2. `data/tenants/`: ¿hay algún fichero `.db`/`.db-shm`/`.db-wal` con nombre de gate, tenga o
//      no fila en `control.db`? (El huérfano de fichero-sin-fila es justo lo que se encontró.)
//   3. Dentro de CADA negocio real (no de gate): ¿queda algún cliente/producto/proveedor/
//      categoría/almacén/recurso/usuario VISIBLE con la marca de gate? (Misma marca que usa
//      `limpiar-restos-de-gates.mjs` — uno detecta, el otro limpia, comparten la definición.)
//   4. Dentro de cada negocio real: ¿queda algún presupuesto/factura/albarán/pedido/orden de
//      compra VIVO (no anulado/borrador) cuya foto congelada de cliente o proveedor lleve la
//      marca de gate? Es la forma concreta en la que se coló la última vez (facturas `GATE-D-…`,
//      `GG-…`, `GPP-…` con el cliente marcado, emitidas de verdad).
//
// USO:
//   node scripts/verify-residuo-de-pruebas.mjs             → informe; sale 1 si hay residuo
//   node scripts/verify-residuo-de-pruebas.mjs --json <f>   → además, escribe el detalle en JSON
//   node scripts/verify-residuo-de-pruebas.mjs --sembrar-rojo   → PRUEBA EN ROJO (ver más abajo):
//     siembra un resto marcado de verdad, comprueba que este censo lo caza, y lo borra él mismo.
//     Nunca dentro del barrido: solo a mano, para demostrar que el censo funciona.
import Database from 'better-sqlite3';
import { existsSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { MARCA_SQL, MARCA_USU, esSlugDeGate } from './lib/marca-de-gate.mjs';

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIR_TENANTS = path.join(RAIZ, 'data', 'tenants');
const CONTROL = path.join(RAIZ, 'data', 'control.db');

const hallazgos = [];
const anota = (categoria, detalle) => hallazgos.push({ categoria, detalle });

// ── 1 y 2. control.db + ficheros de data/tenants/ ───────────────────────────────────────────────
function censarTenants() {
  const registrados = new Map();   // slug -> id
  if (existsSync(CONTROL)) {
    const cdb = new Database(CONTROL, { readonly: true });
    try {
      for (const r of cdb.prepare('SELECT id, slug FROM tenants').all()) registrados.set(r.slug, r.id);
    } catch { /* sin tabla tenants: nada que censar */ }
    cdb.close();
    for (const [slug, id] of registrados) {
      if (esSlugDeGate(slug)) anota('negocio-huerfano-en-control-db', `${slug} (id ${id}) sigue registrado en control.db`);
    }
  }
  if (existsSync(DIR_TENANTS)) {
    for (const f of readdirSync(DIR_TENANTS)) {
      const m = f.match(/^(.+?)\.db(-shm|-wal)?$/);
      if (!m) continue;
      const slug = m[1];
      if (esSlugDeGate(slug)) anota('fichero-de-gate-en-disco', `data/tenants/${f}` + (registrados.has(slug) ? '' : ' (sin fila en control.db: huérfano de fichero)'));
    }
  }
  return [...registrados.entries()].filter(([slug]) => !esSlugDeGate(slug)).map(([slug]) => slug);
}

// ── 3. Filas de fixture visibles dentro de un negocio real ──────────────────────────────────────
// El CUARTO campo es la condición SQL de "sigue vivo/visible" — no un valor a comparar con "=":
// `active` cuenta hacia arriba (1 = visible) pero `status` de producto cuenta hacia abajo
// ('archived' = retirado), y un solo formato "col=valor" para los dos se equivoca en uno.
const TABLAS_MARCA = [
  ['clients', 'name', "active=1"],
  ['products', 'name', "status<>'archived'"],
  ['suppliers', 'name', "active=1"],
  ['categories', 'name', null],
  ['warehouses', 'name', null],
  ['recursos', 'nombre', null],
];

// ⚙️ 9 SEP 2026 — EXCEPCIONES ESCRITAS, no una lista que crece sola. `gate-rentabilidad-pantalla`,
// `gate-facturar-horas-pantalla` y `gate-coste-horas-pantalla` REUTILIZAN a propósito este cliente
// y este proveedor en cada pasada —«SE REUTILIZAN, NO SE CREAN CADA VEZ», comentario de esos tres
// gates— porque sus facturas quedan en la cadena de VERI*FACTU y no se pueden borrar; crear uno
// nuevo por pasada fue justo lo que en su día llegó a 79 «GATE Rent Proveedor». Esto NO es un
// resto: es el fondo de armario declarado de esos tres gates. Cualquier OTRO nombre de gate sigue
// cazándose igual — esta lista no es un comodín, son dos filas concretas y su motivo.
const EXCEPCIONES_PERMANENTES = new Set(['GATE Rent Cliente', 'GATE Rent Proveedor']);

function censarFilasDeFixture(db, slug) {
  const hay = n => { try { return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(n); } catch { return false; } };
  for (const [tabla, col, condVivo] of TABLAS_MARCA) {
    if (!hay(tabla)) continue;
    const filtroVivo = condVivo ? ` AND ${condVivo}` : '';
    let filas;
    try { filas = db.prepare(`SELECT id, ${col} AS n FROM ${tabla} WHERE ${MARCA_SQL(col)}${filtroVivo}`).all(); }
    catch { continue; }
    for (const f of filas) if (!EXCEPCIONES_PERMANENTES.has(f.n)) anota('fixture-visible', `${slug}: ${tabla}#${f.id} (${JSON.stringify(f.n)})`);
  }
  if (hay('admin_users')) {
    let usu;
    try { usu = db.prepare(`SELECT id, name FROM admin_users WHERE role<>'owner' AND active=1 AND ${MARCA_USU}`).all(); }
    catch { usu = []; }
    for (const u of usu) anota('fixture-visible', `${slug}: admin_users#${u.id} (${JSON.stringify(u.name)})`);
  }
}

// ── 4. Documentos VIVOS con la foto congelada marcada ───────────────────────────────────────────
const DOCUMENTOS = [
  ['quotes', 'quote_number', 'client_name', "status='emitido'"],
  ['invoices', 'invoice_number', 'client_name', "status<>'anulada'"],
  ['delivery_notes', 'delivery_number', 'client_name', "status='confirmado'"],
  ['customer_orders', 'order_number', 'client_name', "status IN ('confirmado','entregado')"],
  ['purchase_orders', 'order_number', 'supplier_name', "status='enviada'"],
];

function censarDocumentosVivos(db, slug) {
  const hay = n => { try { return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(n); } catch { return false; } };
  for (const [tabla, colNumero, colNombre, filtroVivo] of DOCUMENTOS) {
    if (!hay(tabla)) continue;
    let filas;
    try {
      filas = db.prepare(
        `SELECT id, ${colNumero} AS numero, ${colNombre} AS nombre FROM ${tabla}
          WHERE ${filtroVivo} AND ${colNombre} IS NOT NULL AND ${MARCA_SQL(colNombre)}`
      ).all();
    } catch { continue; }
    for (const f of filas) anota('documento-vivo-con-nombre-de-gate', `${slug}: ${tabla}#${f.id} ${f.numero || '(sin número)'} — ${JSON.stringify(f.nombre)}`);
  }
}

function censarTodo() {
  hallazgos.length = 0;
  const slugsReales = censarTenants();
  for (const slug of slugsReales) {
    const ruta = path.join(DIR_TENANTS, `${slug}.db`);
    if (!existsSync(ruta)) continue;
    const db = new Database(ruta, { readonly: true });
    try {
      censarFilasDeFixture(db, slug);
      censarDocumentosVivos(db, slug);
    } finally { db.close(); }
  }
  return hallazgos.slice();
}

// ── PRUEBA EN ROJO — siembra un resto de verdad y comprueba que este censo lo caza ──────────────
async function pruebaEnRojo() {
  const rid = randomBytes(3).toString('hex');
  const slug = `data/tenants`;
  const negocio = readdirSync(DIR_TENANTS).find(f => f === 'desarrollo-bamburu.db');
  if (!negocio) { console.error('  ✗ ROJO no se pudo sembrar: no existe desarrollo-bamburu.db'); process.exit(2); }
  const db = new Database(path.join(DIR_TENANTS, negocio));
  const nombre = `GATE Prueba de censo (gate ${rid})`;
  let id;
  try {
    const antes = censarTodo().length;
    id = db.prepare("INSERT INTO clients (name, active) VALUES (?, 1)").run(nombre).lastInsertRowid;
    const despues = censarTodo();
    const loCaza = despues.some(h => h.detalle.includes(String(id)) && h.detalle.includes('clients'));
    console.log(despues.length > antes && loCaza
      ? '  ✓ ROJO PROVOCADO: se sembró un cliente marcado y el censo lo cazó (' + despues.length + ' hallazgos, antes ' + antes + ')'
      : '  ✗ FALLO: el censo NO cazó el resto sembrado (antes ' + antes + ', después ' + despues.length + ')');
    process.exitCode = (despues.length > antes && loCaza) ? 0 : 1;
  } finally {
    if (id != null) db.prepare('DELETE FROM clients WHERE id=?').run(id);   // el propio rojo se borra: no deja su huella
    db.close();
  }
}

if (process.argv.includes('--sembrar-rojo')) {
  await pruebaEnRojo();
} else {
  const lista = censarTodo();
  console.log('RESIDUO DE PRUEBAS EN EL ENTORNO\n');
  if (!lista.length) {
    console.log('  ✓ nada — el entorno no tiene ningún resto de gate vivo.');
  } else {
    const porCategoria = {};
    for (const h of lista) (porCategoria[h.categoria] ??= []).push(h.detalle);
    for (const [cat, detalles] of Object.entries(porCategoria)) {
      console.log(`  ✗ ${cat} (${detalles.length}):`);
      for (const d of detalles.slice(0, 20)) console.log('      · ' + d);
      if (detalles.length > 20) console.log(`      … y ${detalles.length - 20} más`);
    }
  }
  const j = process.argv.indexOf('--json');
  if (j !== -1 && process.argv[j + 1]) {
    writeFileSync(process.argv[j + 1], JSON.stringify({ generado_en: new Date().toISOString(), total: lista.length, hallazgos: lista }, null, 2));
  }
  console.log('\n' + (lista.length ? '✗ ' + lista.length + ' resto(s) de gate encontrados' : '✓ 0 restos') + ' · verify-residuo-de-pruebas');
  process.exitCode = lista.length ? 1 : 0;
}
