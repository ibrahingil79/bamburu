// Gate — A1 (Eje C): la cadena legal de Verifactu se encadena POR NIF del emisor, no por id global.
// Sobre COPIAS de BD real (los datos vivos NO se tocan). Afirma: (1) los registros existentes quedan
// INTACTOS; (2) el encadenado elige el previo DEL MISMO NIF y no el último global — la prueba que
// REPRODUCE el fallo (discrimina bug vs arreglo); (3) la GUARDA detiene la emisión si coexisten dos NIFs;
// (4) REGRESIÓN: con un solo NIF la cadena es idéntica (per-NIF == global); (5) el CANDADO de Ajustes
// rechaza el cambio de NIF con registros; (6) el CINTURÓN rellena id_emisor vacío sin tocar la cadena.
//
//   node scripts/verify-verifactu-cadena-nif.mjs
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { copyFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runMigrations } from '../modules/erp/models.js';
import { recordVerifactuAlta, lastHuella } from '../modules/erp/verifactu.js';
import { createSettingsRoutes } from '../modules/erp/routes/settings.js';
// 24 ago 2026 · La copia va por `copiarBase` (sqlite .backup), no por copyFileSync: los negocios
// corren en WAL y un `cp` deja fuera el -wal, o sea mide una foto vieja. Ver scripts/lib/copia-consistente.mjs.
import { copiarBase } from './lib/copia-consistente.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const throws = (fn, m, code = 409) => { let s = false; try { fn(); } catch (e) { s = e.status === code; } ok(s, m); };

// UN NOMBRE DE TEMPORAL POR LLAMADA, no por negocio. 24 ago 2026: en verify-trazabilidad-flujos esta
// misma forma hizo que la segunda copia pisara la base que la primera tenía abierta, y la comprobación
// perdió un lote a media prueba. Aquí no había explotado todavía; el contador la desactiva.
let nCopias = 0;
const copias = [];
function copia(slug, migrar = true) {
  const p = join(tmpdir(), 'vfnif-' + slug + '-' + copias.length + '-' + process.pid + '-' + (++nCopias) + '.db');
  copiarBase(`data/tenants/${slug}.db`, p); copias.push(p);
  const db = new Database(p); if (migrar) runMigrations(db);
  return db;
}
const invId = db => db.prepare('SELECT id FROM invoices LIMIT 1').get()?.id || 1;
// FK activado: los envíos referencian a los registros → se borran los envíos primero.
const limpiar = db => { db.prepare('DELETE FROM verifactu_envios').run(); db.prepare('DELETE FROM verifactu_registros').run(); };
let regSeq = 0;
// Siembra un registro DIRECTO (para montar estados de prueba), sin pasar por recordVerifactuAlta.
function seedReg(db, { id_emisor, huella, invoice_id, prev = '', primer = 'N' }) {
  regSeq++;
  return Number(db.prepare(`INSERT INTO verifactu_registros
    (invoice_id, record_type, id_emisor, num_serie, fecha_expedicion, tipo_factura, prev_huella, huella, fecha_hora_huso, primer_registro)
    VALUES (?, 'alta', ?, ?, '15-07-2026', 'F1', ?, ?, '2026-07-15T10:00:00+02:00', ?)`)
    .run(invoice_id, id_emisor, 'S2026-' + regSeq, prev, huella, primer).lastInsertRowid);
}
const invPara = (id, nif, num) => ({ id, company_fiscal_id: nif, invoice_number: num, issue_date: '2026-07-15', subtotal: 100, tax_amount: 21, tipo_factura: 'F1', record_type: 'alta' });

function appAjustes(db) {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('db', db); c.set('session', { userId: 1, userName: 'gate', role: 'owner', csrfToken: 'x' }); await next(); });
  app.route('/', createSettingsRoutes(db).api);
  return app;
}
const PUT = (app, path, body) => app.request(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

try {
  // ── 1. Datos existentes INTACTOS ────────────────────────────────────────────
  console.log('\n[1] Los registros existentes quedan intactos');
  {
    const db = copia('desarrollo-bamburu');
    const n = db.prepare('SELECT COUNT(*) c FROM verifactu_registros').get().c;
    const distintos = db.prepare('SELECT COUNT(DISTINCT id_emisor) c FROM verifactu_registros').get().c;
    const vacios = db.prepare("SELECT COUNT(*) c FROM verifactu_registros WHERE id_emisor IS NULL OR id_emisor=''").get().c;
    const nif = db.prepare('SELECT fiscal_id FROM company_config WHERE id=1').get().fiscal_id;
    ok(n >= 80 && distintos === 1 && vacios === 0, 'tras migrar: ' + n + ' registros, 1 solo NIF, 0 vacíos (nada que rellenar)');
    const global = db.prepare('SELECT huella FROM verifactu_registros ORDER BY id DESC LIMIT 1').get().huella;
    ok(lastHuella(db, nif) === global, 'con un solo NIF, el previo por-NIF == el último global (cadena idéntica; las facturas enviadas a la AEAT, intactas)');
    db.close();
  }

  // ── 2. Encadenado POR NIF — la prueba que REPRODUCE el fallo ─────────────────
  console.log('\n[2] El encadenado elige el previo del MISMO NIF, no el último global');
  {
    const db = copia('desarrollo-bamburu');
    limpiar(db);
    const iv = invId(db);
    seedReg(db, { id_emisor: 'B11111111', huella: 'HUELLA_B', invoice_id: iv, primer: 'S' });   // id menor
    seedReg(db, { id_emisor: 'A99999999', huella: 'HUELLA_A', invoice_id: iv, primer: 'S' });   // id MAYOR → último global
    const global = db.prepare('SELECT huella FROM verifactu_registros ORDER BY id DESC LIMIT 1').get().huella;
    const perNifB = lastHuella(db, 'B11111111');
    ok(global === 'HUELLA_A', 'el último GLOBAL (lo que elegiría el BUG) es el de NIF-A');
    ok(global !== perNifB, 'la prueba DISCRIMINA: global (bug) y per-NIF (arreglo) son distintos → fallaría antes del arreglo');
    ok(perNifB === 'HUELLA_B', 'el ARREGLO encadena con el último de NIF-B (HUELLA_B), no con el global (HUELLA_A)');
    ok(lastHuella(db, 'C00000000') === '', 'un NIF sin registros arranca cadena nueva (previo vacío)');
    db.close();
  }

  // ── 3. GUARDA defensiva: la emisión se detiene si coexisten dos NIFs ─────────
  console.log('\n[3] La guarda detiene la emisión con dos NIFs en la base');
  {
    const db = copia('desarrollo-bamburu');
    limpiar(db);
    const iv = invId(db);
    seedReg(db, { id_emisor: 'A99999999', huella: 'HA', invoice_id: iv, primer: 'S' });
    // Emitir para OTRO NIF con la base ya conteniendo NIF-A → estado imposible → 409.
    throws(() => recordVerifactuAlta(db, invPara(iv, 'B11111111', 'F2026-0001')), 'emitir NIF-B con registros de NIF-A presentes → 409 (no cruza la cadena)');
    // Emitir para el MISMO NIF-A → OK (no salta la guarda).
    let okAlta = false;
    try { const r = recordVerifactuAlta(db, invPara(iv, 'A99999999', 'F2026-0002')); okAlta = !!r.huella && r.prev_huella === 'HA'; } catch { okAlta = false; }
    ok(okAlta, 'emitir NIF-A (el mismo de la base) sí funciona y encadena con su huella (HA)');
    db.close();
  }

  // ── 4. REGRESIÓN: un solo NIF → cadena bien formada e idéntica al comportamiento previo ──
  console.log('\n[4] Regresión: con un solo NIF la cadena no cambia');
  {
    const db = copia('desarrollo-bamburu');
    limpiar(db);
    const iv = invId(db);
    const r1 = recordVerifactuAlta(db, invPara(iv, 'A99999999', 'F2026-0001'));
    const r2 = recordVerifactuAlta(db, invPara(iv, 'A99999999', 'F2026-0002'));
    const r3 = recordVerifactuAlta(db, invPara(iv, 'A99999999', 'F2026-0003'));
    ok(r1.primer_registro === 'S' && r1.prev_huella === '', 'el 1º arranca la cadena (primer=S, prev vacío)');
    ok(r2.prev_huella === r1.huella && r3.prev_huella === r2.huella, 'cada registro encadena con la huella del anterior (cadena única)');
    ok(r2.primer_registro === 'N' && r3.primer_registro === 'N', 'los siguientes no son primer registro');
    const global = db.prepare('SELECT huella FROM verifactu_registros ORDER BY id DESC LIMIT 1').get().huella;
    ok(lastHuella(db, 'A99999999') === global, 'per-NIF == global en todo momento (un solo NIF): comportamiento sin cambios');
    db.close();
  }

  // ── 5. CANDADO de Ajustes: cambio de NIF rechazado si hay registros ─────────
  console.log('\n[5] Candado: no se cambia el NIF con registros Verifactu');
  {
    const db = copia('desarrollo-bamburu');   // tiene registros (NIF real 89890001K)
    const app = appAjustes(db);
    const nif = db.prepare('SELECT fiscal_id FROM company_config WHERE id=1').get().fiscal_id;
    const rCambio = await PUT(app, '/company', { company_name: 'X', fiscal_id: 'OTRO12345' });
    ok(rCambio.status === 409, 'cambiar el NIF con registros existentes → 409');
    ok(db.prepare('SELECT fiscal_id FROM company_config WHERE id=1').get().fiscal_id === nif, 'y el NIF NO se cambió en la base');
    const rMismo = await PUT(app, '/company', { company_name: 'X', fiscal_id: nif });
    ok(rMismo.status === 200, 'guardar Ajustes SIN cambiar el NIF sigue funcionando (200)');
    // Sin registros, el cambio de NIF sí se permite (negocio que aún no ha emitido).
    limpiar(db);
    const rLibre = await PUT(app, '/company', { company_name: 'X', fiscal_id: 'NUEVO9999' });
    ok(rLibre.status === 200 && db.prepare('SELECT fiscal_id FROM company_config WHERE id=1').get().fiscal_id === 'NUEVO9999',
       'sin registros aún, cambiar el NIF sí se permite');
    db.close();
  }

  // ── 6. CINTURÓN idempotente: rellena id_emisor vacío sin tocar la cadena ─────
  console.log('\n[6] Cinturón: relleno de id_emisor vacío (sin tocar la huella)');
  {
    const db = copia('desarrollo-bamburu');
    limpiar(db);
    const iv = invId(db);
    const rid = seedReg(db, { id_emisor: '', huella: 'HUELLA_HIST', prev: 'PREV_HIST', invoice_id: iv, primer: 'N' });   // registro histórico SIN NIF
    // Re-disparar la migración (borrando su bandera) → debe rellenar el vacío con el NIF de la empresa.
    db.prepare("DELETE FROM settings WHERE key='migration_verifactu_id_emisor_backfill_2026_v1'").run();
    runMigrations(db);
    const reg = db.prepare('SELECT * FROM verifactu_registros WHERE id=?').get(rid);
    const nif = db.prepare('SELECT fiscal_id FROM company_config WHERE id=1').get().fiscal_id;
    ok(reg.id_emisor === nif, 'el id_emisor vacío se rellena con el NIF de la empresa (' + nif + ')');
    ok(reg.huella === 'HUELLA_HIST' && reg.prev_huella === 'PREV_HIST', 'la HUELLA y la huella anterior NO se tocan (solo el dato de identificación)');
    db.close();
  }

} finally {
  for (const p of copias) { for (const f of [p, p + '-wal', p + '-shm']) { try { unlinkSync(f); } catch {} } }
  console.log('\n  (copias desechables borradas; el negocio vivo NO se ha tocado)');
}
console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Verifactu · cadena por NIF (A1): ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
