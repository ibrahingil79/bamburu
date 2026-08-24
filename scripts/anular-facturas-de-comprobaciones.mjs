#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ANULAR LAS FACTURAS QUE DEJARON LAS COMPROBACIONES.
//
//   node scripts/anular-facturas-de-comprobaciones.mjs <slug> --desde "2026-08-24 12:00"        (simulacro)
//   node scripts/anular-facturas-de-comprobaciones.mjs <slug> --desde "2026-08-24 12:00" --hazlo
//
// POR QUÉ ANULAR Y NO BORRAR. Una factura emitida entra en la cadena de VERI*FACTU y **no se borra
// jamás**: borrarla sería romper la cadena legal. Lo que sí se puede —y es lo que hace cualquier
// negocio con una factura equivocada— es ANULARLA: sale de los libros y de «Ventas», y su huella se
// queda intacta con su registro de anulación encima. Cero DROP, cero DELETE.
//
// DE DÓNDE SALE (24 ago 2026): las pasadas de clasificación dejaron 19 facturas en el negocio de
// desarrollo por 523.002,90 € — el 55 % de todo lo que figuraba como vendido. Dos comprobaciones de
// mostrador emitían tickets de 120.987,90 €.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { anularInvoice } from '../modules/erp/routes/invoices.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2];
const HAZLO = process.argv.includes('--hazlo');
const i = process.argv.indexOf('--desde');
const DESDE = i > 0 ? process.argv[i + 1] : null;
if (!slug || !DESDE) {
  console.error('Uso: node scripts/anular-facturas-de-comprobaciones.mjs <slug> --desde "YYYY-MM-DD HH:MM" [--hazlo]');
  process.exit(2);
}

const db = new Database(join(RAIZ, 'data', 'tenants', slug + '.db'));
const MOTIVO = 'Factura creada por una comprobación automática, no por el negocio. Se anula para que no cuente como venta.';

const candidatas = db.prepare(
  "SELECT id, invoice_number, COALESCE(client_name,'(sin cliente)') cliente, total, status "
  + 'FROM invoices WHERE created_at >= ? ORDER BY id').all(DESDE);
const emitidas = candidatas.filter(f => f.status === 'emitida');
const suma = Math.round(emitidas.reduce((s, f) => s + f.total, 0) * 100) / 100;

console.log('\n=== Facturas de comprobaciones en «' + slug + '» desde ' + DESDE + ' ===\n');
console.log('  encontradas: ' + candidatas.length + '  ·  emitidas (a anular): ' + emitidas.length
            + '  ·  ya anuladas: ' + (candidatas.length - emitidas.length));
console.log('  suma de las emitidas: ' + suma.toFixed(2) + ' €');
for (const f of emitidas) console.log('    · ' + f.invoice_number + '  ' + f.cliente + '  ' + f.total.toFixed(2));

if (!HAZLO) { console.log('\n  (SIMULACRO — no se ha tocado nada. Añade --hazlo.)'); db.close(); process.exit(0); }

let n = 0, mal = 0;
for (const f of emitidas) {
  try { anularInvoice(db, f.id, MOTIVO); n++; }
  catch (e) { mal++; console.error('    ✗ ' + f.invoice_number + ': ' + e.message); }
}
const ventasAhora = db.prepare("SELECT ROUND(SUM(total),2) t FROM invoices WHERE status='emitida'").get().t;
console.log('\n  ANULADAS: ' + n + (mal ? '  ·  con problema: ' + mal : ''));
console.log('  Ventas del negocio tras la anulación: ' + ventasAhora + ' €');
console.log('  Ninguna factura se ha borrado: cada una conserva su huella y su registro de anulación.');
db.close();
process.exit(mal ? 1 : 0);
