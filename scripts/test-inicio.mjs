// Test de LÓGICA — INICIO PERSONALIZABLE (Escalera · paso 6), sobre BD temporal.
//   node scripts/test-inicio.mjs
//
// Demuestra: cascada de resolución (usuario > empresa > fábrica), los dos niveles de edición, reset en
// los dos niveles, y el filtrado por permiso (un bloque de un área que no ves NO se resuelve ni aparece
// en la paleta; ni el del default del dueño se cuela). Solo COLOCACIÓN: no toca cifras.
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { unlinkSync } from 'fs';
import { runMigrations } from '../modules/erp/models.js';
import * as IL from '../modules/erp/inicio-layout.js';
import { listarPaneles } from '../modules/erp/constructor-analitica.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FALLO: ' + m); } };
const dbs = [];
function nuevaBD() {
  const f = join(tmpdir(), 'inicio-' + randomBytes(4).toString('hex') + '.db');
  const db = new Database(f); dbs.push([db, f]); runMigrations(db);
  db.prepare("INSERT OR IGNORE INTO company_config (id, company_name, fiscal_id, country, invoice_series, rectificative_series, tax_name, currency_symbol) VALUES (1,'Test SL','B00000000','ES','F','R','IVA','€')").run();
  return db;
}
const TODO = () => true;                          // ve todo (dueño)
const SIN_COMPRAS = p => p !== 'purchases.read';  // empleado sin Compras
const tipos = blocks => blocks.map(b => b.tipo + (b.refId ? ':' + b.refId : ''));

try {
  const db = nuevaBD();
  // Dos usuarios y dos paneles guardados: uno de Ventas (id 1) y uno de Compras (id 2), del usuario 10.
  const panelVentas = db.prepare("INSERT INTO analytics_panels (user_id, nombre, config, compartido) VALUES (10,'Ventas por mes',?,1)")
    .run(JSON.stringify({ area: 'ventas', dimension: 'fecha', medidas: ['base'], periodo: 'mes', grafico: 'lineas' })).lastInsertRowid;
  const panelCompras = db.prepare("INSERT INTO analytics_panels (user_id, nombre, config, compartido) VALUES (10,'Pendiente proveedor',?,1)")
    .run(JSON.stringify({ area: 'compras', dimension: 'proveedor', medidas: ['pendiente'], grafico: 'barras' })).lastInsertRowid;
  const panelesById = new Map(listarPaneles(db, 10).map(p => [p.id, p]));

  console.log('\n=== 1. Cascada: fábrica → empresa → usuario ===\n');
  ok(IL.resolver(db, 10).origen === 'fabrica', 'usuario nuevo sin nada → ve el Inicio de FÁBRICA (no en blanco)');
  ok(IL.resolver(db, 10).blocks.length > 0, 'el de fábrica viene ya montado (' + IL.resolver(db, 10).blocks.length + ' bloques)');

  IL.setLayout(db, 'empresa', [{ tipo: 'kpis', w: 4, h: 1 }, { tipo: 'vigia', w: 4, h: 2 }], 2);
  ok(IL.resolver(db, 11).origen === 'empresa', 'el dueño fija el default de EMPRESA → un usuario sin capa lo ve');
  ok(tipos(IL.resolver(db, 11).blocks).join(',') === 'kpis,vigia', 'ese usuario ve exactamente el default de empresa');

  IL.setLayout(db, 'usuario:11', [{ tipo: 'avisos', w: 2, h: 1 }], 11);
  ok(IL.resolver(db, 11).origen === 'usuario', 'el usuario retoca su Inicio → ve SU versión, no la del dueño');
  ok(tipos(IL.resolver(db, 11).blocks).join(',') === 'avisos', 've su propia capa (avisos)');
  ok(IL.resolver(db, 12).origen === 'empresa', 'OTRO usuario del mismo ámbito NO se ve afectado (sigue en empresa)');

  console.log('\n=== 2. Reset en los dos niveles ===\n');
  IL.delLayout(db, 'usuario:11');
  ok(IL.resolver(db, 11).origen === 'empresa', 'reset del usuario → vuelve al default de empresa');
  IL.delLayout(db, 'empresa');
  ok(IL.resolver(db, 11).origen === 'fabrica', 'reset del dueño → vuelve al de fábrica');

  console.log('\n=== 3. PERMISOS: un bloque de un área que no ves se OMITE (no se cuela) ===\n');
  // Un layout con: kpis (todos), vigía (analytics.read), panel de ventas (invoices.read), panel de compras (purchases.read).
  const layout = [
    { tipo: 'kpis', w: 4, h: 1 },
    { tipo: 'vigia', w: 2, h: 2 },
    { tipo: 'panel', refId: panelVentas, w: 2, h: 2 },
    { tipo: 'panel', refId: panelCompras, w: 2, h: 2 },
  ];
  const duenyo = IL.sanear(layout, { puede: TODO, panelesById });
  ok(tipos(duenyo).join(',') === 'kpis,vigia,panel:' + panelVentas + ',panel:' + panelCompras, 'el dueño (ve todo) conserva los 4 bloques');

  const empleado = IL.sanear(layout, { puede: SIN_COMPRAS, panelesById });
  ok(!tipos(empleado).some(t => t === 'panel:' + panelCompras), 'sin purchases.read: el panel de Compras NO se le pinta (se omite en silencio)');
  ok(tipos(empleado).some(t => t === 'panel:' + panelVentas), 'pero SÍ conserva el panel de Ventas (que sí puede ver)');

  const sinAnalitica = IL.sanear(layout, { puede: p => p !== 'analytics.read', panelesById });
  ok(!tipos(sinAnalitica).some(t => t === 'vigia'), 'sin analytics.read: el bloque del vigía se omite');

  console.log('\n=== 4. PALETA: solo ofrece bloques/paneles que el usuario puede ver ===\n');
  const palDuenyo = IL.bloquesDisponibles(db, 10, TODO);
  ok(palDuenyo.paneles.length === 2 && palDuenyo.nativos.some(n => n.tipo === 'vigia'), 'el dueño ve los 2 paneles + el nativo vigía en la paleta');
  const palEmpleado = IL.bloquesDisponibles(db, 10, SIN_COMPRAS);
  ok(!palEmpleado.paneles.some(p => p.refId === panelCompras), 'sin purchases.read: el panel de Compras NO está en la paleta');
  ok(palEmpleado.paneles.some(p => p.refId === panelVentas), 'pero el de Ventas SÍ está en la paleta');
  ok(palEmpleado.paneles.every(p => p.config && p.meta), 'los paneles de la paleta traen su receta y meta (para pintarse al colocarlos)');

  console.log('\n=== 5. normalizar: sanea forma (tamaños a la rejilla, tipos válidos) ===\n');
  const norm = IL.normalizar([
    { tipo: 'kpis', w: 99, h: -3 },              // se recorta a 4 / 1
    { tipo: 'panel', refId: '7', w: 2, h: 2 },   // refId string → número
    { tipo: 'inventado', w: 2, h: 2 },           // tipo desconocido → fuera
    { tipo: 'panel', w: 2, h: 2 },               // panel sin refId → fuera
  ]);
  ok(norm.length === 2, 'quedan solo los 2 bloques válidos (kpis + panel)');
  ok(norm[0].w === 4 && norm[0].h === 1, 'los tamaños se recortan a la rejilla (w≤4, h≥1)');
  ok(norm[1].refId === 7, 'el refId string "7" se normaliza a número 7');

  console.log('\n=== 6. NO ESCRIBE datos de negocio: solo la tabla de layouts ===\n');
  const antes = db.prepare('SELECT COUNT(*) n FROM analytics_panels').get().n;
  IL.setLayout(db, 'usuario:99', [{ tipo: 'kpis', w: 4, h: 1 }], 99);
  const despues = db.prepare('SELECT COUNT(*) n FROM analytics_panels').get().n;
  ok(antes === despues, 'guardar un layout no toca analytics_panels ni ninguna tabla de negocio');
  ok(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='dashboard_layouts'").get().n === 1, 'la colocación vive en dashboard_layouts (fuera de las tablas de DISA/negocio)');

} catch (e) { console.error('ERROR', e.stack || e.message); fail++; } finally {
  for (const [db, f] of dbs) { try { db.close(); } catch {} try { unlinkSync(f); } catch {} }
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
