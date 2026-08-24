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

const antesV = libroVentas(db, null, null), antesC = libroCompras(db, null, null);
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
const despuesV = libroVentas(db, null, null), despuesC = libroCompras(db, null, null);
const tot = l => (l && (l.total ?? l.resumen?.total)) ?? null;
console.log('\n  ANULADOS con asiento inverso: ' + r.anulados);
console.log('  libro de VENTAS:  ' + tot(antesV) + '  →  ' + tot(despuesV));
console.log('  libro de COMPRAS: ' + tot(antesC) + '  →  ' + tot(despuesC));
console.log('\n  Ningún asiento se ha borrado: cada uno lleva su inverso, fechado hoy, con el motivo escrito.');
db.close();
