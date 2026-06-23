// Verificación VERI*FACTU · Tarea 1 — registros oficiales + huella encadenada + QR/leyenda.
// Parte A (determinista, en proceso, sin servidor):
//   1) Las 3 huellas de los EJEMPLOS OFICIALES del doc AEAT v0.1.2, con las funciones REALES.
//   2) Codificación del QR de cotejo (host de PRODUCCIÓN + URL-encoding oficial; '/'→%2F).
//   3) FechaHoraHusoGenRegistro: formato ISO-8601 con huso de Europe/Madrid.
//   4) E2E sobre BD temporal recién migrada: emitir / anular / rectificar → registros oficiales,
//      cadena ÚNICA encadenada, primer_registro, y la cadena PROPIETARIA (verifactu_hash) intacta.
//
//   node scripts/verify-verifactu-t1.mjs
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { runMigrations } from '../modules/erp/models.js';
import { generateInvoice, createInvoice, anularInvoice, createRectificativa, calcHash } from '../modules/erp/routes/invoices.js';
import { altaHuella, anulacionHuella, altaHuellaString, anulacionHuellaString, cotejoUrl, genTimestampMadrid, COTEJO_BASE_URL } from '../modules/erp/verifactu.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

console.log('\n=== VERI*FACTU · Tarea 1 — VERIFICACIÓN ===\n');

// ── 1) Huella contra los 3 ejemplos oficiales (funciones REALES del código) ──────────────
console.log('(1) Huella SHA-256 encadenada vs. ejemplos OFICIALES (doc AEAT v0.1.2):');
{
  const a1 = altaHuella({ idEmisor: '89890001K', numSerie: '12345678/G33', fechaExpedicion: '01-01-2024', tipoFactura: 'F1', cuotaTotal: '12.35', importeTotal: '123.45', prevHuella: '', fechaHoraHuso: '2024-01-01T19:20:30+01:00' });
  ok(a1 === '3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60', 'alta #1 (primer registro, Huella=) → ' + a1);

  const a2 = altaHuella({ idEmisor: '89890001K', numSerie: '12345679/G34', fechaExpedicion: '01-01-2024', tipoFactura: 'F1', cuotaTotal: '12.35', importeTotal: '123.45', prevHuella: '3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60', fechaHoraHuso: '2024-01-01T19:20:35+01:00' });
  ok(a2 === 'F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97', 'alta #2 (encadenada) → ' + a2);

  const an = anulacionHuella({ idEmisor: '89890001K', numSerie: '12345679/G34', fechaExpedicion: '01-01-2024', prevHuella: 'F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97', fechaHoraHuso: '2024-01-01T19:20:40+01:00' });
  ok(an === '177547C0D57AC74748561D054A9CEC14B4C4EA23D1BEFD6F2E69E3A388F90C68', 'anulación → ' + an);

  // muestra de la cadena de entrada literal (alta #1), para cotejo visual con el doc
  console.log('    cadena alta#1: ' + altaHuellaString({ idEmisor: '89890001K', numSerie: '12345678/G33', fechaExpedicion: '01-01-2024', tipoFactura: 'F1', cuotaTotal: '12.35', importeTotal: '123.45', prevHuella: '', fechaHoraHuso: '2024-01-01T19:20:30+01:00' }));
}

// ── 2) QR de cotejo — codificación ───────────────────────────────────────────────────────
console.log('\n(2) QR de cotejo (servicio de PRODUCCIÓN, parámetros URL-encoded):');
{
  // El ejemplo oficial del doc QR usa numserie con '&' (→%26) en el entorno de PRUEBAS; aquí
  // reproducimos su CODIFICACIÓN con nuestro host de producción.
  const u = cotejoUrl({ nif: '89890001K', numSerie: '12345678&G33', fecha: '01-01-2024', importe: '241.4' });
  const expectedQuery = '?nif=89890001K&numserie=12345678%26G33&fecha=01-01-2024&importe=241.4';
  ok(u === COTEJO_BASE_URL + expectedQuery, 'codificación oficial (%26) reproducida → ' + u);
  ok(COTEJO_BASE_URL === 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR', 'endpoint = PRODUCCIÓN VERI*FACTU (no prewww2)');
  const slash = cotejoUrl({ nif: 'B12345678', numSerie: 'F2026-0001/2', fecha: '23-06-2026', importe: '121.00' });
  ok(slash.includes('numserie=F2026-0001%2F2'), "el '/' del numserie se codifica a %2F → " + slash);
}

// ── 3) FechaHoraHusoGenRegistro ──────────────────────────────────────────────────────────
console.log('\n(3) FechaHoraHusoGenRegistro (Europe/Madrid):');
{
  const ts = genTimestampMadrid();
  ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(ts), 'ISO-8601 con huso → ' + ts);
  ok(/[+-]0[12]:00$/.test(ts), 'huso de Madrid (+01:00 invierno / +02:00 verano)');
}

// ── 4) E2E sobre BD temporal: emitir / anular / rectificar ───────────────────────────────
console.log('\n(4) E2E (BD temporal recién migrada): emitir / anular / rectificar:');
const dbPath = join(tmpdir(), 'vf-t1-' + process.pid + '.db');
const db = new Database(dbPath);
try {
  runMigrations(db);
  db.prepare("INSERT OR IGNORE INTO company_config (id, company_name, fiscal_id, tax_rate) VALUES (1, 'Acme Test SL', '89890001K', 21)").run();
  db.prepare("UPDATE company_config SET fiscal_id='89890001K', country='ES' WHERE id=1").run();
  const cli = db.prepare("INSERT INTO clients (name, fiscal_id, address, email) VALUES ('Cliente Uno','12345678Z','Calle 1','c1@x.com')").run();
  const clientId = cli.lastInsertRowid;

  const regs = () => db.prepare('SELECT * FROM verifactu_registros ORDER BY id').all();

  // emitir factura 1
  const f1 = createInvoice(db, { client_id: clientId, lines: [{ description: 'Servicio A', quantity: 1, unit_price: 100, tax_rate: 21 }], issue_date: '2026-06-23' });
  // emitir factura 2
  const f2 = createInvoice(db, { client_id: clientId, lines: [{ description: 'Servicio B', quantity: 2, unit_price: 50, tax_rate: 10 }], issue_date: '2026-06-23' });
  // anular factura 2
  anularInvoice(db, f2.id, 'Prueba de anulación');
  // rectificar factura 1 (alta serie R, tipo R1)
  const r1 = createRectificativa(db, { original_id: f1.id, lines: [{ description: 'Corrección', quantity: 1, unit_price: 100, tax_rate: 21 }], rectification_type: 'R1', rectification_mode: 'I', issue_date: '2026-06-23' });

  const R = regs();
  ok(R.length === 4, 'se generaron 4 registros oficiales (2 altas + 1 anulación + 1 alta rectificativa). got=' + R.length);
  ok(R[0].record_type === 'alta' && R[0].primer_registro === 'S' && R[0].prev_huella === '', 'registro #1: ALTA, primer_registro=S, prev_huella vacío (arranque limpio)');
  ok(R[1].record_type === 'alta' && R[1].primer_registro === 'N', 'registro #2: ALTA, primer_registro=N');
  ok(R[2].record_type === 'anulacion', 'registro #3: ANULACIÓN (factura 2)');
  ok(R[3].record_type === 'alta' && R[3].tipo_factura === 'R1', 'registro #4: ALTA rectificativa con TipoFactura=R1');

  // encadenamiento: cada prev_huella = huella del registro anterior
  let chainOk = true, recomputeOk = true;
  for (let i = 0; i < R.length; i++) {
    const prevExpected = i === 0 ? '' : R[i - 1].huella;
    if (R[i].prev_huella !== prevExpected) chainOk = false;
    // recomputar la huella desde los campos PERSISTIDOS y comparar con la guardada
    const recompute = R[i].record_type === 'alta'
      ? altaHuella({ idEmisor: R[i].id_emisor, numSerie: R[i].num_serie, fechaExpedicion: R[i].fecha_expedicion, tipoFactura: R[i].tipo_factura, cuotaTotal: R[i].cuota_total, importeTotal: R[i].importe_total, prevHuella: R[i].prev_huella, fechaHoraHuso: R[i].fecha_hora_huso })
      : anulacionHuella({ idEmisor: R[i].id_emisor, numSerie: R[i].num_serie, fechaExpedicion: R[i].fecha_expedicion, prevHuella: R[i].prev_huella, fechaHoraHuso: R[i].fecha_hora_huso });
    if (recompute !== R[i].huella) recomputeOk = false;
  }
  ok(chainOk, 'encadenamiento alta→alta→anulación→alta correcto (prev_huella enlaza con la anterior)');
  ok(recomputeOk, 'cada huella recomputa EXACTO desde sus campos persistidos (reproducible para la Tarea 2)');

  // importes del registro de alta de f1: ImporteTotal=121.00, CuotaTotal=21.00
  ok(R[0].importe_total === '121.00' && R[0].cuota_total === '21.00' && R[0].fecha_expedicion === '23-06-2026',
     'campos de la huella de f1: ImporteTotal=121.00 CuotaTotal=21.00 Fecha=23-06-2026');

  // ── Regresión: la cadena PROPIETARIA (verifactu_hash) sigue íntegra ──
  const invs = db.prepare('SELECT * FROM invoices ORDER BY series, year, sequence').all();
  let propOk = true; const prevBy = {};
  for (const inv of invs) {
    if (calcHash(inv) !== inv.verifactu_hash) propOk = false;
    const key = inv.series + inv.year;
    if ((inv.prev_hash || '') !== (prevBy[key] || '')) propOk = false;
    prevBy[key] = inv.verifactu_hash;
  }
  ok(propOk, 'cadena propietaria intacta: verifactu_hash cuadra y enlaza por serie (superadmin/integridad no se rompe)');
  ok(db.prepare("SELECT COUNT(*) n FROM invoices").get().n === 3, 'emitir/anular/rectificar siguen creando facturas (3 en total)');
} finally {
  db.close();
  try { (await import('fs')).unlinkSync(dbPath); } catch {}
}

console.log('\n=== RESULTADO PARTE A: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
