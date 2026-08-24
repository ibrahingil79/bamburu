#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ASIENTOS HUÉRFANOS — el documento se borró y el apunte se quedó en el libro.
//
//   node scripts/reversar-asientos-huerfanos.mjs <slug>            → SIMULACRO (no escribe)
//   node scripts/reversar-asientos-huerfanos.mjs <slug> --hazlo    → escribe los asientos que anulan
//
// No borra NADA. Por cada huérfano escribe un asiento que lo anula, fechado HOY, con el motivo y la
// referencia del asiento que anula. Un libro contable se corrige dejando rastro.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { reversarHuerfanos, libroVentas, libroCompras } from '../modules/erp/contabilidad.js';
import { restringirBd } from '../core/db-file-perms.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2];
const HAZLO = process.argv.includes('--hazlo');
if (!slug) { console.error('Falta el negocio: node scripts/reversar-asientos-huerfanos.mjs <slug> [--hazlo]'); process.exit(2); }

const ruta = join(RAIZ, 'data', 'tenants', slug + '.db');
const db = new Database(ruta);
restringirBd(ruta);

// 24 ago 2026 · CON RANGO Y CON LA RUTA BUENA. Esto llevaba imprimiendo «null → null» desde que se
// escribió, o sea que la herramienta no enseñaba su propio efecto: (1) libroVentas/libroCompras con
// fechas nulas no devuelven nada, hay que darles un rango; (2) devuelven { rows, totals:{...} }, y
// `tot` buscaba `total` a pelo. Un instrumento que no mide es peor que no tenerlo: da por hecho que
// el trabajo salió bien porque no dice lo contrario.
const TODO = ['1900-01-01', '2999-12-31'];
const antesV = libroVentas(db, ...TODO), antesC = libroCompras(db, ...TODO);
const sim = reversarHuerfanos(db, { simulacro: true });

console.log('\n=== Asientos huérfanos en «' + slug + '» ===\n');
console.log('  encontrados: ' + sim.encontrados);
const porTipo = {};
for (const e of sim.detalle) porTipo[e.origin_type] = (porTipo[e.origin_type] || 0) + 1;
for (const [t, n] of Object.entries(porTipo)) console.log('    · ' + t + ': ' + n);

if (!HAZLO) {
  console.log('\n  (SIMULACRO — no se ha escrito nada. Añade --hazlo para corregir el libro.)');
  db.close();
  process.exit(0);
}

const r = reversarHuerfanos(db, {});
const despuesV = libroVentas(db, ...TODO), despuesC = libroCompras(db, ...TODO);
const tot = l => {
  const n = l?.totals?.total;
  if (typeof n !== 'number') throw new Error('reversar: no sé leer el total del libro — ' + JSON.stringify(Object.keys(l || {})));
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
};
console.log('\n  ANULADOS con asiento inverso: ' + r.anulados);
console.log('  libro de VENTAS:  ' + tot(antesV) + '  →  ' + tot(despuesV));
console.log('  libro de COMPRAS: ' + tot(antesC) + '  →  ' + tot(despuesC));
console.log('\n  Ningún asiento se ha borrado: cada uno lleva su inverso, fechado hoy, con el motivo escrito.');
db.close();
