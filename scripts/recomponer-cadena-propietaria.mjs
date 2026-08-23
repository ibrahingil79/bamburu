#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// RECOMPOSICIÓN PUNTUAL — la cadena PROPIETARIA de `invoices` en negocios de PRUEBAS.
//
// ⛔ ESTO NO ES, NI PUEDE LLEGAR A SER, UNA FUNCIÓN DEL PRODUCTO.
// Recalcular los sellos de una cadena de integridad es EXACTAMENTE lo que un sistema honesto no
// debe permitir: la cadena existe para delatar que alguien tocó una factura, y una función que la
// recalcula convierte la delación en un botón. Por eso esto es un script de un solo uso, sin
// pantalla, sin botón, sin endpoint, sin permiso y sin tarea programada. **Que no exista la puerta.**
// Lo único que lo justifica: los negocios afectados son de pruebas, sus datos son desechables, y la
// cadena se rompió al borrar 19 facturas de prueba en un encargo anterior — no por una alteración.
// Contra un negocio con un solo cliente real: NO. El script se niega si el negocio no está en la
// lista explícita de abajo.
//
// QUÉ ES LA CADENA PROPIETARIA, Y QUÉ NO ES.
//   Es `invoices.verifactu_hash` / `invoices.prev_hash`, la que recorre `superadmin/integridad.js`.
//   Se encadena por (serie, año) en orden de `sequence`, y la primera de cada grupo lleva
//   `prev_hash` vacío. Su sello sale de `calcHash` (routes/invoices.js), que usa SEIS campos:
//   invoice_number | issue_date | company_fiscal_id | client_fiscal_id | total | prev_hash.
//   **Ni uno de Verifactu.**
//
//   NO es la cadena de VERI*FACTU (`verifactu_registros.prev_huella`/`huella`), que es la legal, se
//   calcula con otros campos (idEmisor, numSerie, fecha, tipo, cuota, importe, prevHuella, huso) y
//   NUNCA lee `invoices.verifactu_hash`. **Este script no la escribe ni la usa para calcular nada.**
//   La lee en modo SOLO LECTURA por un único motivo: sacarle el SHA-256 antes y después para
//   DEMOSTRAR que queda idéntica, que es lo que pide el encargo.
//
// POR QUÉ TAMBIÉN ENTRAN LAS ANULACIONES, Y NO ES ALCANCE DE MÁS.
//   `invoice_anulaciones` guarda `prev_hash` = el sello de SU factura, y su propio `verifactu_hash`
//   sale de `calcAnulacionHash`, que el código describe como «familia del calcHash de facturas».
//   Es la MISMA cadena propietaria, no Verifactu. Hoy los 218 registros enlazan bien con su factura.
//   Si se recompusieran solo las facturas, 146 de ellos quedarían apuntando a sellos que ya no
//   existen. Recomponer «de principio a fin» incluye rehacer ese eslabón.
//
// LO QUE ESTE SCRIPT SE NIEGA A HACER, Y COMPRUEBA:
//   · escribir una sola fila de `verifactu_registros` o `verifactu_envios` (aborta si el SHA cambia);
//   · mover un solo céntimo de ventas, cobros o contabilidad (aborta si se mueven);
//   · cambiar un sello que YA cuadraba (la serie S es el control: debe quedar byte a byte igual);
//   · tocar un negocio que no esté en NEGOCIOS_DE_PRUEBAS.
//
// USO:
//   node scripts/recomponer-cadena-propietaria.mjs            → SIMULACRO (no escribe nada)
//   node scripts/recomponer-cadena-propietaria.mjs --hazlo    → ejecuta, con copia previa
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { calcHash } from '../modules/erp/routes/invoices.js';
import { verifyTenantInvoices } from '../modules/superadmin/integridad.js';
import { ventasResumen } from '../modules/erp/ventas-metrics.js';

const HAZLO = process.argv.includes('--hazlo');
const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
const DIR = path.join(RAIZ, 'data', 'tenants');

// LISTA EXPLÍCITA. Un negocio que no esté aquí no se toca, por mucho que su cadena esté rota. Es la
// diferencia entre «arreglar los datos de pruebas de Ibrahin» y «reescribir la contabilidad de
// alguien». Ampliarla es una decisión del dueño, no del script.
const NEGOCIOS_DE_PRUEBAS = new Set(['desarrollo-bamburu']);

// El mismo hash de anulación que `anularInvoice` (routes/invoices.js). Se reproduce aquí, con su
// prefijo, porque allí no está exportado; si algún día lo exportan, esto debe importarse en vez de
// copiarse. Va con su propia comprobación: el script verifica que reproduce los 218 valores actuales
// ANTES de escribir ninguno, así que una copia desincronizada se caza sola.
const calcAnulacionHash = (an) =>
  createHash('sha256')
    .update(['ANULACION', an.invoice_number, an.issue_date, an.company_fiscal_id, an.motivo, an.prev_hash].join('|'))
    .digest('hex');

const shaVerifactu = (db) => {
  const regs = db.prepare(
    'SELECT id,invoice_id,record_type,id_emisor,num_serie,fecha_expedicion,tipo_factura,cuota_total,' +
    'importe_total,prev_huella,huella,fecha_hora_huso,primer_registro FROM verifactu_registros ORDER BY id'
  ).all();
  const env = db.prepare('SELECT id,registro_id,estado FROM verifactu_envios ORDER BY id').all();
  return { n: regs.length, e: env.length, sha: createHash('sha256').update(JSON.stringify({ regs, env })).digest('hex') };
};

const negocioFoto = (db) => ({
  ventas: ventasResumen(db),
  cobros: db.prepare('SELECT COUNT(*) c, ROUND(COALESCE(SUM(amount),0),2) imp FROM invoice_payments').get(),
  libro: db.prepare('SELECT COUNT(*) n, ROUND(SUM(debit),2) debe, ROUND(SUM(credit),2) haber FROM ledger_lines').get(),
  facturas: db.prepare('SELECT COUNT(*) c FROM invoices').get().c,
  // Todo lo de la factura MENOS los dos campos del sello: si esto cambia, se ha tocado un dato real.
  datos: createHash('sha256').update(JSON.stringify(db.prepare(
    'SELECT id,invoice_number,series,year,sequence,issue_date,company_fiscal_id,client_fiscal_id,' +
    'total,subtotal,tax_amount,status FROM invoices ORDER BY id').all())).digest('hex'),
});

// EL CÁLCULO. Puro: recibe las filas y devuelve qué sello tendría cada una. No toca la BD.
function recomponer(invoices, anulacionesPorFactura) {
  const grupos = {};
  for (const inv of invoices) (grupos[inv.series + '|' + inv.year] ||= []).push(inv);
  const plan = [];
  for (const clave of Object.keys(grupos)) {
    // Mismo orden que integridad.js: por `sequence` dentro de cada (serie, año).
    const lista = grupos[clave].slice().sort((a, b) => a.sequence - b.sequence);
    let prev = '';                                   // la primera de cada serie arranca limpia
    for (const inv of lista) {
      const nuevoPrev = prev;
      const nuevoHash = calcHash({ ...inv, prev_hash: nuevoPrev });
      const cambia = nuevoHash !== inv.verifactu_hash || (inv.prev_hash || '') !== nuevoPrev;
      plan.push({ id: inv.id, numero: inv.invoice_number, serie: clave, prev: nuevoPrev, hash: nuevoHash, cambia });
      for (const an of (anulacionesPorFactura.get(inv.id) || [])) {
        const anHash = calcAnulacionHash({ ...an, prev_hash: nuevoHash });
        plan.push({ anulacion: true, id: an.id, numero: an.invoice_number, serie: clave,
                    prev: nuevoHash, hash: anHash,
                    cambia: anHash !== an.verifactu_hash || (an.prev_hash || '') !== nuevoHash });
      }
      prev = nuevoHash;
    }
  }
  return plan;
}

let salida = 0;
console.log(HAZLO ? '⚠ MODO REAL — se reescriben sellos (con copia previa)' : '🔍 SIMULACRO — no se escribe nada');

for (const fichero of fs.readdirSync(DIR).filter(f => f.endsWith('.db'))) {
  const slug = fichero.replace(/\.db$/, '');
  const ruta = path.join(DIR, fichero);

  // ── ¿Está rota? Se pregunta con el MISMO verificador del superadmin, no con una copia. ──────────
  let antes;
  try { antes = verifyTenantInvoices(ruta); } catch { continue; }
  if (antes.ok) continue;                                    // sana o sin facturas: no se toca

  console.log(`\n${'═'.repeat(94)}\nNEGOCIO: ${slug}\n${'═'.repeat(94)}`);
  console.log(`  integridad ANTES: ALARMA → ${antes.alarm.invoice_number}: ${antes.alarm.reason}`);

  if (!NEGOCIOS_DE_PRUEBAS.has(slug)) {
    console.log('  ✗ NO SE TOCA: no está en NEGOCIOS_DE_PRUEBAS. Un negocio real no se recompone por script.');
    salida = 1;
    continue;
  }

  const db = new Database(ruta);
  db.pragma('busy_timeout = 10000');
  try {
    const vfAntes = shaVerifactu(db);
    const negAntes = negocioFoto(db);
    console.log(`  Verifactu ANTES: ${vfAntes.n} registros · ${vfAntes.e} envíos · sha ${vfAntes.sha.slice(0, 16)}…`);

    const invoices = db.prepare(
      'SELECT id, invoice_number, series, year, sequence, issue_date, company_fiscal_id, client_fiscal_id, ' +
      'total, verifactu_hash, prev_hash FROM invoices').all();
    const anulaciones = db.prepare(
      'SELECT id, invoice_id, invoice_number, motivo, issue_date, company_fiscal_id, prev_hash, verifactu_hash ' +
      'FROM invoice_anulaciones').all();
    const porFactura = new Map();
    for (const a of anulaciones) {
      if (!porFactura.has(a.invoice_id)) porFactura.set(a.invoice_id, []);
      porFactura.get(a.invoice_id).push(a);
    }

    // ── CINTURÓN 0: ¿reproduce mi copia de calcAnulacionHash los valores de HOY? ───────────────────
    // Si no los reproduce, la copia está desincronizada del original y todo lo demás sobra.
    const malas = anulaciones.filter(a => calcAnulacionHash(a) !== a.verifactu_hash);
    if (malas.length) {
      console.log(`  ✗ ABORTADO: mi calcAnulacionHash NO reproduce ${malas.length} de ${anulaciones.length} sellos de anulación actuales.`);
      salida = 1; db.close(); continue;
    }
    console.log(`  ✓ el hash de anulación reproduce los ${anulaciones.length} sellos actuales (la copia está al día)`);

    const plan = recomponer(invoices, porFactura);
    const cambian = plan.filter(p => p.cambia);
    const porSerie = {};
    for (const p of cambian) {
      const k = p.serie + (p.anulacion ? ' (anulaciones)' : ' (facturas)');
      porSerie[k] = (porSerie[k] || 0) + 1;
    }
    console.log(`\n  A RECOMPONER: ${cambian.length} sellos de ${plan.length}`);
    for (const [k, v] of Object.entries(porSerie).sort()) console.log(`    ${k.padEnd(26)} ${v}`);
    const intactas = plan.length - cambian.length;
    console.log(`    ${'(quedan igual)'.padEnd(26)} ${intactas}  ← series ya sanas: el control de que el cálculo reproduce`);

    if (!HAZLO) { console.log('\n  SIMULACRO: no se ha escrito nada. Añade --hazlo para ejecutar.'); db.close(); continue; }

    // ── Copia de seguridad ANTES de tocar nada ────────────────────────────────────────────────────
    const dirCopias = path.join(RAIZ, 'data', 'copias-limpieza');
    fs.mkdirSync(dirCopias, { recursive: true });
    const copia = path.join(dirCopias, `${slug}-antes-recomponer-cadena.db`);
    // `VACUUM INTO` no sobreescribe: sin esto, la SEGUNDA pasada muere con «output file already
    // exists» — y muere después de haber dicho lo que iba a hacer. La copia que importa es la de
    // AHORA, no la de la vez anterior.
    fs.rmSync(copia, { force: true });
    db.exec(`VACUUM INTO '${copia.replace(/'/g, "''")}'`);
    console.log(`\n  ✓ copia de seguridad: ${copia}`);

    // ── LA ESCRITURA, en una sola transacción. Solo dos tablas, solo los dos campos del sello. ────
    const updInv = db.prepare('UPDATE invoices           SET verifactu_hash=?, prev_hash=? WHERE id=?');
    const updAnu = db.prepare('UPDATE invoice_anulaciones SET verifactu_hash=?, prev_hash=? WHERE id=?');
    let nInv = 0, nAnu = 0;
    db.transaction(() => {
      for (const p of cambian) {
        if (p.anulacion) { updAnu.run(p.hash, p.prev, p.id); nAnu++; }
        else             { updInv.run(p.hash, p.prev, p.id); nInv++; }
      }
    })();
    console.log(`  reescritos: ${nInv} sellos de factura · ${nAnu} de anulación`);

    // ── CINTURÓN 1: el verificador REAL del superadmin ────────────────────────────────────────────
    const despues = verifyTenantInvoices(ruta);
    console.log(`\n  ${despues.ok ? '✓' : '✗'} integridad DESPUÉS: ${despues.ok ? 'CUADRA' : 'ALARMA → ' + despues.alarm.invoice_number + ': ' + despues.alarm.reason} (${despues.total} facturas)`);
    if (!despues.ok) salida = 1;

    // ── CINTURÓN 2: Verifactu, byte a byte ────────────────────────────────────────────────────────
    const vfDespues = shaVerifactu(db);
    const vfIgual = vfDespues.sha === vfAntes.sha;
    console.log(`  ${vfIgual ? '✓' : '✗'} Verifactu ${vfIgual ? 'IDÉNTICA' : '¡CAMBIÓ!'} — ${vfDespues.n} registros · sha ${vfDespues.sha.slice(0, 16)}…`);
    if (!vfIgual) salida = 1;

    // ── CINTURÓN 3: el negocio no se mueve ni un céntimo ──────────────────────────────────────────
    const negDespues = negocioFoto(db);
    const mismo = JSON.stringify(negAntes) === JSON.stringify(negDespues);
    console.log(`  ${mismo ? '✓' : '✗'} el negocio no se movió: ventas ${negDespues.ventas.total} € · cobros ${negDespues.cobros.imp} € · libro ${negDespues.libro.debe} €`);
    if (!mismo) { salida = 1; console.log('    ANTES:  ' + JSON.stringify(negAntes) + '\n    DESPUÉS:' + JSON.stringify(negDespues)); }

    // ── CINTURÓN 4: cada anulación vuelve a enlazar con SU factura ────────────────────────────────
    const enlazan = db.prepare('SELECT COUNT(*) c FROM invoice_anulaciones a JOIN invoices i ON i.id=a.invoice_id WHERE a.prev_hash = i.verifactu_hash').get().c;
    const totalAnu = db.prepare('SELECT COUNT(*) c FROM invoice_anulaciones').get().c;
    console.log(`  ${enlazan === totalAnu ? '✓' : '✗'} anulaciones que enlazan con el sello de su factura: ${enlazan}/${totalAnu}`);
    if (enlazan !== totalAnu) salida = 1;

    db.close();
  } catch (e) {
    salida = 1; console.error('  ✗ ERROR: ' + e.message);
    try { db.close(); } catch {}
  }
}

if (!salida) console.log(HAZLO ? '\n✓ HECHO.' : '\n(fin del simulacro)');
process.exit(salida);
