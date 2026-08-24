#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// NINGÚN ASIENTO SE QUEDA SIN SU DOCUMENTO.
//
// DE DÓNDE SALE (24 ago 2026). Los libros del negocio de desarrollo sumaban MÁS que sus documentos
// vivos: ventas 419.843,99 € de libro contra 418.803,39 € de documentos, y compras 121.883,06 contra
// 119.618,26. La causa: **65 asientos cuyo documento ya no existía**, de limpiezas que borraron
// facturas sin deshacer su apunte. Llevaba meses así porque la comprobación que lo medía era una de
// las 99 que nadie ejecutaba.
//
// Se corrigió como corrige un contable —asiento inverso, fechado hoy, con el motivo escrito; cero
// DELETE— pero **el arreglo no vale de nada si mañana otra limpieza abre el mismo agujero**. Esto es
// lo que lo impide: si se borra un documento y no se deshace su asiento, esto se pone rojo.
//
// SE MIRAN TODOS LOS NEGOCIOS, no solo el de desarrollo: el agujero lo abre una limpieza, y una
// limpieza puede correr sobre cualquiera.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import Database from 'better-sqlite3';
import { readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { huerfanosVivos } from '../modules/erp/contabilidad.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(RAIZ, 'data', 'tenants');
let ok = 0, fail = 0;
const check = (c, m, det) => { if (c) { ok++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ FALLO: ' + m + (det ? ' · ' + det : '')); } };

console.log('\n=== Ningún asiento se queda sin su documento ===\n');

const negocios = readdirSync(DIR).filter(f => f.endsWith('.db'));
const sucios = [];
let mirados = 0;
for (const n of negocios) {
  let db;
  try { db = new Database(join(DIR, n), { readonly: true }); } catch { continue; }
  try {
    db.prepare('SELECT 1 FROM ledger_entries LIMIT 1').get();   // sin libro, nada que mirar
    const h = huerfanosVivos(db);
    mirados++;
    if (h.length) sucios.push(n.replace('.db', '') + ': ' + h.length);
  } catch { /* ese negocio no tiene contabilidad montada */ }
  db.close();
}
check(sucios.length === 0, 'ningún negocio tiene asientos sin documento y sin anular',
  sucios.join(' · ') || mirados + ' negocios con libro, todos limpios');

// Y LA REVERSIÓN: esta comprobación tiene que saber CAER. Se le da una base de mentira, en memoria,
// con un asiento cuyo documento no existe, y se exige que lo encuentre. Sin esto, un verde aquí no
// diría nada: podría estar mirando cero negocios y dando por bueno el silencio.
{
  const m = new Database(':memory:');
  m.exec(`CREATE TABLE ledger_entries (id INTEGER PRIMARY KEY, entry_date TEXT, entry_type TEXT,
            origin_type TEXT, origin_id INTEGER, reverses_entry_id INTEGER, memo TEXT, created_at TEXT);
          CREATE TABLE ledger_lines (id INTEGER PRIMARY KEY, entry_id INTEGER, account_code TEXT,
            debit REAL, credit REAL, tax_rate REAL, line_kind TEXT);
          CREATE TABLE invoices (id INTEGER PRIMARY KEY);
          CREATE TABLE supplier_invoices (id INTEGER PRIMARY KEY);
          CREATE TABLE invoice_payments (id INTEGER PRIMARY KEY);
          CREATE TABLE supplier_payments (id INTEGER PRIMARY KEY);
          INSERT INTO invoices (id) VALUES (1);
          INSERT INTO ledger_entries (id, entry_date, entry_type, origin_type, origin_id) VALUES (10,'2026-01-01','venta','invoice',1);
          INSERT INTO ledger_entries (id, entry_date, entry_type, origin_type, origin_id) VALUES (11,'2026-01-02','venta','invoice',999);`);
  const h = huerfanosVivos(m);
  check(h.length === 1 && h[0].id === 11,
    'y sabe encontrarlo: en una base de mentira con un asiento huérfano, lo señala', 'asiento #' + (h[0] && h[0].id));
  // Y que NO señale el que sí tiene documento: un falso positivo aquí mandaría a corregir un libro sano.
  check(!h.some(x => x.id === 10), '  y no señala al que sí tiene su documento (nada de falsos positivos)');
  m.close();
}

console.log('\n' + '─'.repeat(70));
console.log('RESULTADO: ' + ok + ' ✓  ·  ' + fail + ' ✗   (' + mirados + ' negocios con libro)');
process.exit(fail === 0 ? 0 : 1);
