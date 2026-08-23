#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// LIMPIEZA PUNTUAL — las facturas de PRUEBA anteriores a la Tarea 1 de Verifactu (ficha B).
//
// ESTO NO ES UNA FUNCIÓN DEL PRODUCTO. Es un script de un solo uso, y a propósito no tiene pantalla,
// ni botón, ni endpoint, ni permiso: **una factura emitida no se borra, se anula**. Lo único que
// justifica que aquí SÍ se borre es que son datos desechables de un negocio de pruebas, y el dueño
// lo pidió expresamente. Si algún día alguien quiere reutilizar esto contra un negocio real: no.
//
// QUÉ BORRA — y por qué se puede describir sin una lista de ids a mano:
//   Facturas ANULADAS que no tienen NINGUNA fila en `verifactu_registros` (ni alta ni anulación).
//   Son las anteriores a la implantación del registro de facturación: la AEAT no las conoce, no
//   están en la cadena de huellas de Verifactu y nada posterior se apoya en ellas.
//
// QUÉ NO BORRA, Y HAY QUE SABERLO:
//   `F2026-0012` (id 12) también es de ese lote y también está sin registro Verifactu, pero está
//   `rectificada`, no `anulada`, y **sí cuenta como venta real** (53,01 €). Borrarla movería los
//   totales del negocio, que no es lo que se pidió. Se queda, y con ella se queda que su
//   rectificativa (`R2026-0001`, que sí está en el lote) desaparece: F2026-0012 quedará marcada
//   `rectificada` sin rectificativa detrás. Está anotado en el TABLERO para decidirlo aparte.
//
// LO QUE ESTE SCRIPT SE NIEGA A HACER:
//   · tocar `verifactu_registros` o `verifactu_envios` — ni una fila, y lo comprueba;
//   · tocar el `verifactu_hash`/`prev_hash` de ninguna factura superviviente;
//   · borrar si alguna candidata tuviera registro Verifactu (aborta).
//
// AVISO QUE NO SE PUEDE EVITAR: la cadena PROPIETARIA de `invoices` (verifactu_hash/prev_hash, la
// que recorre superadmin/integridad.js) SÍ queda rota, porque estas facturas son la cabecera de la
// serie F. No hay forma de borrarlas sin eso, y recomponerla exigiría reescribir hashes de 700+
// facturas — justo lo que "la cadena no se toca" prohíbe. El script lo dice antes y después.
//
// USO:
//   node scripts/limpiar-facturas-prueba-sin-verifactu.mjs                  → SIMULACRO (no escribe)
//   node scripts/limpiar-facturas-prueba-sin-verifactu.mjs --hazlo          → ejecuta, con copia previa
//   … --tenant=desarrollo-bamburu                                          → limita a un negocio
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

const HAZLO = process.argv.includes('--hazlo');
const SOLO = (process.argv.find(a => a.startsWith('--tenant=')) || '').split('=')[1] || null;
const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
const DIR = path.join(RAIZ, 'data', 'tenants');

// Huella de la cadena Verifactu ENTERA: si cambia un solo byte de un solo registro, cambia esto.
// Es lo que demuestra el criterio 3 del encargo ("idéntica antes y después") comparando, no afirmando.
function huellaVerifactu(db) {
  const regs = db.prepare(
    'SELECT id,invoice_id,record_type,id_emisor,num_serie,fecha_expedicion,tipo_factura,cuota_total,' +
    'importe_total,prev_huella,huella,fecha_hora_huso,primer_registro FROM verifactu_registros ORDER BY id'
  ).all();
  const env = db.prepare('SELECT id,registro_id,estado FROM verifactu_envios ORDER BY id').all();
  return {
    registros: regs.length,
    envios: env.length,
    sha: createHash('sha256').update(JSON.stringify({ regs, env })).digest('hex'),
  };
}

// Estas son LAS 19: anuladas y sin ningún registro de facturación.
const SQL_CANDIDATAS = `
  SELECT id, invoice_number, series, sequence, issue_date, status, subtotal, total
    FROM invoices i
   WHERE i.status = 'anulada'
     AND NOT EXISTS (SELECT 1 FROM verifactu_registros r WHERE r.invoice_id = i.id)
   ORDER BY i.id`;

// La 20ª: mismo lote, sin registro, pero NO anulada. Solo se informa.
const SQL_VECINAS = `
  SELECT id, invoice_number, status, total
    FROM invoices i
   WHERE i.status <> 'anulada'
     AND NOT EXISTS (SELECT 1 FROM verifactu_registros r WHERE r.invoice_id = i.id)
   ORDER BY i.id`;

function procesar(slug, ruta) {
  const db = new Database(ruta);
  db.pragma('busy_timeout = 10000');
  db.pragma('foreign_keys = ON');
  try {
    const tablas = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
    if (!tablas.has('invoices') || !tablas.has('verifactu_registros')) return null;

    const cand = db.prepare(SQL_CANDIDATAS).all();
    if (!cand.length) return null;

    const ids = cand.map(r => r.id);
    const lista = '(' + ids.join(',') + ')';

    console.log(`\n${'═'.repeat(94)}\nNEGOCIO: ${slug}\n${'═'.repeat(94)}`);

    // ── CINTURÓN 1: ninguna candidata puede estar en la cadena de Verifactu ──────────────────────
    const enCadena = db.prepare(`SELECT COUNT(*) c FROM verifactu_registros WHERE invoice_id IN ${lista}`).get().c;
    if (enCadena > 0) {
      console.log(`✗ ABORTADO: ${enCadena} de las candidatas tienen registro Verifactu. La cadena no se toca.`);
      return { slug, abortado: true };
    }
    console.log(`✓ ninguna de las ${cand.length} tiene registro en verifactu_registros`);

    const antesVF = huellaVerifactu(db);
    console.log(`  cadena Verifactu ANTES: ${antesVF.registros} registros · ${antesVF.envios} envíos · sha ${antesVF.sha.slice(0, 16)}…`);

    // ── Censo de lo que cuelga ───────────────────────────────────────────────────────────────────
    const pagosIds = db.prepare(`SELECT id FROM invoice_payments WHERE invoice_id IN ${lista}`).all().map(r => r.id);
    const asientos = db.prepare(
      `SELECT id FROM ledger_entries
        WHERE (origin_type='invoice' AND origin_id IN ${lista})
           OR (origin_type='invoice_payment' AND origin_id IN (${pagosIds.join(',') || '-1'}))`
    ).all().map(r => r.id);
    const lineasAs = asientos.length
      ? db.prepare(`SELECT COUNT(*) c FROM ledger_lines WHERE entry_id IN (${asientos.join(',')})`).get().c : 0;

    const cuenta = (sql) => db.prepare(sql).get().c;
    const censo = {
      facturas:       cand.length,
      lineas:         cuenta(`SELECT COUNT(*) c FROM invoice_items WHERE invoice_id IN ${lista}`),
      cobros:         pagosIds.length,
      anulaciones:    cuenta(`SELECT COUNT(*) c FROM invoice_anulaciones WHERE invoice_id IN ${lista}`),
      acc_cobro:      cuenta(`SELECT COUNT(*) c FROM collection_actions WHERE invoice_id IN ${lista}`),
      propuestas:     cuenta(`SELECT COUNT(*) c FROM disa_proposals WHERE invoice_id IN ${lista}`),
      recurrencias:   cuenta(`SELECT COUNT(*) c FROM recurring_occurrences WHERE invoice_id IN ${lista}`),
      actividad:      cuenta(`SELECT COUNT(*) c FROM activity_logs WHERE entity='invoice' AND entity_id IN ${lista}`),
      asientos:       asientos.length,
      lineas_asiento: lineasAs,
    };
    const imp = db.prepare(`SELECT ROUND(SUM(subtotal),2) base, ROUND(SUM(total),2) total FROM invoices WHERE id IN ${lista}`).get();

    console.log(`\n  LAS ${cand.length} FACTURAS (${imp.base} € base · ${imp.total} € total):`);
    for (const f of cand) console.log(`    id=${String(f.id).padStart(3)}  ${f.invoice_number.padEnd(12)} ${f.issue_date}  ${String(f.total).padStart(9)} €`);
    console.log('\n  CUELGA DE ELLAS:');
    for (const [k, v] of Object.entries(censo)) if (k !== 'facturas') console.log(`    ${k.padEnd(16)} ${v}`);

    const vecinas = db.prepare(SQL_VECINAS).all();
    if (vecinas.length) {
      console.log('\n  ⚠ NO SE BORRAN (sin registro Verifactu pero NO anuladas — cuentan en el negocio):');
      for (const v of vecinas) console.log(`    id=${v.id} ${v.invoice_number} (${v.status}, ${v.total} €)`);
    }

    if (!HAZLO) {
      console.log('\n  SIMULACRO: no se ha escrito nada. Añade --hazlo para ejecutar.');
      db.close();
      return { slug, simulacro: true, censo };
    }

    // ── Copia de seguridad ANTES de tocar nada ───────────────────────────────────────────────────
    const dirCopias = path.join(RAIZ, 'data', 'copias-limpieza');
    fs.mkdirSync(dirCopias, { recursive: true });
    const copia = path.join(dirCopias, `${slug}-antes-limpieza-facturas.db`);
    db.exec(`VACUUM INTO '${copia.replace(/'/g, "''")}'`);
    console.log(`\n  ✓ copia de seguridad: ${copia}`);

    // ── EL BORRADO, en una sola transacción, de hijo a padre ─────────────────────────────────────
    const borrado = {};
    db.transaction(() => {
      if (asientos.length) {
        borrado.lineas_asiento = db.prepare(`DELETE FROM ledger_lines   WHERE entry_id IN (${asientos.join(',')})`).run().changes;
        borrado.asientos       = db.prepare(`DELETE FROM ledger_entries WHERE id       IN (${asientos.join(',')})`).run().changes;
      } else { borrado.lineas_asiento = 0; borrado.asientos = 0; }
      borrado.actividad    = db.prepare(`DELETE FROM activity_logs        WHERE entity='invoice' AND entity_id IN ${lista}`).run().changes;
      borrado.propuestas   = db.prepare(`DELETE FROM disa_proposals       WHERE invoice_id IN ${lista}`).run().changes;
      borrado.recurrencias = db.prepare(`UPDATE recurring_occurrences SET invoice_id=NULL WHERE invoice_id IN ${lista}`).run().changes;
      borrado.acc_cobro    = db.prepare(`DELETE FROM collection_actions   WHERE invoice_id IN ${lista}`).run().changes;
      borrado.anulaciones  = db.prepare(`DELETE FROM invoice_anulaciones  WHERE invoice_id IN ${lista}`).run().changes;
      borrado.cobros       = db.prepare(`DELETE FROM invoice_payments     WHERE invoice_id IN ${lista}`).run().changes;
      borrado.lineas       = db.prepare(`DELETE FROM invoice_items        WHERE invoice_id IN ${lista}`).run().changes;
      borrado.facturas     = db.prepare(`DELETE FROM invoices             WHERE id         IN ${lista}`).run().changes;
    })();

    console.log('\n  BORRADO:');
    for (const [k, v] of Object.entries(borrado)) console.log(`    ${k.padEnd(16)} ${v}`);

    // ── CINTURÓN 2: la cadena de Verifactu, byte a byte ──────────────────────────────────────────
    const despuesVF = huellaVerifactu(db);
    const igual = despuesVF.sha === antesVF.sha;
    console.log(`\n  cadena Verifactu DESPUÉS: ${despuesVF.registros} registros · ${despuesVF.envios} envíos · sha ${despuesVF.sha.slice(0, 16)}…`);
    console.log(`  ${igual ? '✓' : '✗'} la cadena de Verifactu es ${igual ? 'IDÉNTICA' : '¡DISTINTA!'} antes y después`);

    // ── CINTURÓN 3: ni un huérfano ───────────────────────────────────────────────────────────────
    const huerfanos = {
      invoice_items:       cuenta('SELECT COUNT(*) c FROM invoice_items       WHERE invoice_id      NOT IN (SELECT id FROM invoices)'),
      invoice_payments:    cuenta('SELECT COUNT(*) c FROM invoice_payments    WHERE invoice_id      NOT IN (SELECT id FROM invoices)'),
      invoice_anulaciones: cuenta('SELECT COUNT(*) c FROM invoice_anulaciones WHERE invoice_id      NOT IN (SELECT id FROM invoices)'),
      collection_actions:  cuenta('SELECT COUNT(*) c FROM collection_actions  WHERE invoice_id      NOT IN (SELECT id FROM invoices)'),
      verifactu_registros: cuenta('SELECT COUNT(*) c FROM verifactu_registros WHERE invoice_id      NOT IN (SELECT id FROM invoices)'),
      disa_proposals:      cuenta('SELECT COUNT(*) c FROM disa_proposals      WHERE invoice_id IS NOT NULL AND invoice_id NOT IN (SELECT id FROM invoices)'),
      ledger_lines:        cuenta('SELECT COUNT(*) c FROM ledger_lines        WHERE entry_id        NOT IN (SELECT id FROM ledger_entries)'),
      ledger_entries:      cuenta("SELECT COUNT(*) c FROM ledger_entries      WHERE origin_type='invoice' AND origin_id NOT IN (SELECT id FROM invoices)"),
    };
    const totalHuerfanos = Object.values(huerfanos).reduce((a, b) => a + b, 0);
    console.log(`\n  ${totalHuerfanos === 0 ? '✓' : '✗'} huérfanos: ${totalHuerfanos}` +
      (totalHuerfanos ? ' → ' + JSON.stringify(huerfanos) : ' (ninguna referencia rota)'));

    // ── CINTURÓN 4: el libro sigue cuadrando ─────────────────────────────────────────────────────
    const l = db.prepare('SELECT ROUND(SUM(debit),2) debe, ROUND(SUM(credit),2) haber FROM ledger_lines').get();
    console.log(`  ${l.debe === l.haber ? '✓' : '✗'} contabilidad: debe ${l.debe} € = haber ${l.haber} €`);

    // Integridad de FK a nivel de motor: la palabra final.
    const fk = db.pragma('foreign_key_check');
    console.log(`  ${fk.length === 0 ? '✓' : '✗'} foreign_key_check: ${fk.length === 0 ? 'limpio' : JSON.stringify(fk.slice(0, 5))}`);

    db.close();
    return { slug, borrado, igual, totalHuerfanos, cuadra: l.debe === l.haber, fk: fk.length };
  } catch (e) {
    try { db.close(); } catch {}
    throw e;
  }
}

// ── Recorrido ──────────────────────────────────────────────────────────────────────────────────
console.log(HAZLO ? '⚠ MODO REAL — se borrará de verdad (con copia previa)' : '🔍 SIMULACRO — no se escribe nada');
const ficheros = fs.readdirSync(DIR).filter(f => f.endsWith('.db'));
const resultados = [];
for (const f of ficheros) {
  const slug = f.replace(/\.db$/, '');
  if (SOLO && slug !== SOLO) continue;
  let r = null;
  try { r = procesar(slug, path.join(DIR, f)); } catch (e) { console.log(`\n${slug}: ERROR — ${e.message}`); }
  if (r) resultados.push(r);
}
if (!resultados.length) console.log('\nNo hay ninguna factura de prueba sin registro Verifactu. Nada que hacer.');
else if (HAZLO) {
  const malo = resultados.find(r => r.abortado || !r.igual || r.totalHuerfanos || !r.cuadra || r.fk);
  console.log(`\n${malo ? '✗ REVISAR: algún negocio no pasó sus comprobaciones.' : '✓ HECHO: todos los negocios pasaron las cuatro comprobaciones.'}`);
  process.exit(malo ? 1 : 0);
}
