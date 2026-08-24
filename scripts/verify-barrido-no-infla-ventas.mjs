#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// NINGUNA COMPROBACIÓN DEJA UNA FACTURA EMITIDA EN EL NEGOCIO DEL DUEÑO.
//
// DE DÓNDE SALE (24 ago 2026, y es el fallo de fondo, no las filas). Al colocar las 99 invisibles,
// las pasadas dejaron **19 facturas por 523.002,90 €** en el negocio de desarrollo: **el 55 % de todo
// lo que figuraba como vendido**. Dos comprobaciones de mostrador emitían tickets de 120.987,90 €
// porque pedían 9999 unidades para superar el stock.
//
// Se anularon las 17 emitidas —anular, no borrar: una factura emitida entra en la cadena de
// VERI*FACTU y no se borra jamás— y las ventas volvieron a 418.803,39 €. Pero anular es curar el
// síntoma: **lo que hay que impedir es que vuelvan a emitirse**.
//
// QUÉ MIDE, y en dos capas porque una sola no basta:
//   (1) EL DATO: cuántas facturas EMITIDAS quedan en el negocio compartido creadas hoy. Es lo único
//       que de verdad importa: una emitida cuenta como venta y sale en los informes del dueño.
//   (2) EL CÓDIGO: qué comprobaciones del barrido emiten facturas contra el negocio compartido en vez
//       de traerse el suyo. Van declaradas una a una; la lista solo puede MENGUAR.
//
// Las que se traen su propio negocio (`provisionTenant`) no cuentan: lo que emiten nace y muere ahí.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import Database from 'better-sqlite3';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { GRUPOS } from './lib/gates-mapa.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = 'desarrollo-bamburu';
let ok = 0, fail = 0;
const check = (c, m, det) => { if (c) { ok++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ FALLO: ' + m + (det ? ' · ' + det : '')); } };

console.log('\n=== Ninguna comprobación infla las ventas del dueño ===\n');

// ── (1) EL DATO ─────────────────────────────────────────────────────────────────────────────────
// Se mira lo emitido HOY: lo de antes ya está anulado y no puede volver a contarse.
const db = new Database(join(RAIZ, 'data', 'tenants', SLUG + '.db'), { readonly: true });
const hoy = new Date().toISOString().slice(0, 10);
const nuevas = db.prepare(
  "SELECT invoice_number, COALESCE(client_name,'(sin cliente)') c, total FROM invoices "
  + "WHERE status='emitida' AND date(created_at) = ? ORDER BY total DESC").all(hoy);
const suma = Math.round(nuevas.reduce((s, f) => s + f.total, 0) * 100) / 100;
check(nuevas.length === 0,
  'no hay ninguna factura EMITIDA creada hoy en el negocio compartido',
  nuevas.length ? nuevas.length + ' facturas por ' + suma.toFixed(2) + ' € · la mayor: '
    + nuevas[0].invoice_number + ' (' + nuevas[0].total.toFixed(2) + ')'
    : 'ninguna');

// ── (2) EL CÓDIGO ───────────────────────────────────────────────────────────────────────────────
// La lista de las que todavía emiten contra el negocio compartido. Cada una con su motivo. **Solo
// puede menguar**: si aparece una nueva, esto se pone rojo y hay que decidir, no dejarla pasar.
const TODAVIA_EMITEN = new Set([
  'test-neto-cero-reserva', 'test-dibujo', 'test-vigia', 'test-voz',
  'verify-propuestas-recurrentes', 'gate-propuestas-recurrentes',
  'verify-propuestas-dormidos', 'gate-propuestas-dormidos',
  'verify-invoice-over-stock', 'test-coste-horas-proyecto', 'test-rentabilidad-proyecto', 'gate-rentabilidad-pantalla',
  'verify-constructor', 'verify-margen', 'verify-responsable', 'verify-informes',
  'verify-plan-financiero', 'test-neto-cero-cita', 'test-prioridad',
  'verify-portal', 'verify-recurrentes',
  'test-contabilidad', 'test-contabilidad-modelos', 'test-contabilidad-pyg',
  'verify-conciliacion', 'verify-pieza-c', 'verify-sustitutiva',
  'verify-verifactu-anulaciones', 'verify-verifactu-cola', 'verify-verifactu-t1', 'verify-verifactu-t2',
]);
const EMITE = /createInvoice|createTicket|\/api\/erp\/invoices'|\/api\/erp\/mostrador|emitirOcurrencia/;
const dentro = [...new Set(Object.values(GRUPOS).flat())];
const emiten = [];
for (const g of dentro) {
  const p = ['.mjs', '.js'].map(e => join(RAIZ, 'scripts', g + e)).find(existsSync);
  if (!p) continue;
  const src = readFileSync(p, 'utf8');
  if (EMITE.test(src) && !/provisionTenant/.test(src)) emiten.push(g);
}
const nuevasQueEmiten = emiten.filter(g => !TODAVIA_EMITEN.has(g));
check(nuevasQueEmiten.length === 0,
  'ninguna comprobación NUEVA emite facturas contra el negocio compartido',
  nuevasQueEmiten.join(', ') || emiten.length + ' declaradas, ninguna nueva');

const yaCuradas = [...TODAVIA_EMITEN].filter(g => !emiten.includes(g));
check(true, '  de las declaradas, ya no emiten: ' + yaCuradas.length + '/' + TODAVIA_EMITEN.size,
  yaCuradas.slice(0, 6).join(', ') || 'ninguna todavía — la cura es que se traigan su propio negocio');

// ── (3) LAS CIFRAS DE PRUEBA, DE LA VIDA REAL ───────────────────────────────────────────────────
// Un ticket de mostrador de 120.987,90 € no es un ticket de mostrador. Si un día se escapa uno, que
// no se lleve por delante ningún informe.
const gordas = [];
for (const g of dentro) {
  const p = ['.mjs', '.js'].map(e => join(RAIZ, 'scripts', g + e)).find(existsSync);
  if (!p) continue;
  for (const l of readFileSync(p, 'utf8').split('\n')) {
    if (/^\s*(\/\/|\*)/.test(l)) continue;
    if (/\b(quantity|qty|cantidad)\s*[:=]\s*(\d{4,})/.test(l)) gordas.push(g + ': ' + l.trim().slice(0, 70));
  }
}
check(gordas.length === 0,
  'ninguna comprobación pide miles de unidades (un ticket de 120.987,90 € no es un ticket)',
  gordas.slice(0, 4).join(' · ') || 'todas con cifras de la vida real');

// ── (4) REVERSIÓN ───────────────────────────────────────────────────────────────────────────────
check(EMITE.test("await api('POST','/api/erp/invoices', body)"),
  'y la comprobación sabe reconocer una emisión cuando la ve (reversión)');

db.close();
console.log('\n' + '─'.repeat(70));
console.log('RESULTADO: ' + ok + ' ✓  ·  ' + fail + ' ✗');
process.exit(fail === 0 ? 0 : 1);
