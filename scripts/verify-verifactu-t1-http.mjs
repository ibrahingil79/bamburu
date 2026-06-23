// VERI*FACTU · Tarea 1 — Parte B (servidor real, tenant desarrollo): el DOCUMENTO lleva el QR
// de cotejo + la leyenda, y el registro oficial se crea al emitir por la API real.
//   node scripts/verify-verifactu-t1-http.mjs
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { altaHuella, cotejoUrl } from '../modules/erp/verifactu.js';

const DB_PATH = 'data/tenants/desarrollo-bamburu.db';
const ORIGIN = 'http://127.0.0.1:3000';
const COOKIES = t => 'asess=' + t + '; btenant=desarrollo-bamburu';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB_PATH);
// NIF de empresa para el tenant de DESARROLLO (estaba vacío). Valor de PRUEBA, divulgado:
// el registro/QR necesitan el NIF del emisor. En un tenant real se pone el NIF propio en Ajustes.
db.prepare("UPDATE company_config SET fiscal_id='89890001K' WHERE id=1").run();
const now = Math.floor(Date.now() / 1000);
const token = randomBytes(32).toString('base64url');
const csrf = randomBytes(32).toString('base64url');
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 3600, csrf);

console.log('\n=== VERI*FACTU T1 · Parte B (servidor real) ===\n');

const res = await fetch(ORIGIN + '/api/erp/invoices', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf, 'Cookie': COOKIES(token) },
  body: JSON.stringify({ client_id: 1, lines: [{ description: 'Demo Veri*Factu', quantity: 1, unit_price: 100, tax_rate: 21 }] }),
});
const created = await res.json();
ok(res.status === 201 && created.id, 'factura emitida por la API real → ' + JSON.stringify(created));

const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(created.id);
const reg = db.prepare("SELECT * FROM verifactu_registros WHERE invoice_id=? AND record_type='alta'").get(created.id);
ok(!!reg, 'se creó el registro oficial de ALTA enganchado a la emisión');
if (reg) {
  const recompute = altaHuella({ idEmisor: reg.id_emisor, numSerie: reg.num_serie, fechaExpedicion: reg.fecha_expedicion, tipoFactura: reg.tipo_factura, cuotaTotal: reg.cuota_total, importeTotal: reg.importe_total, prevHuella: reg.prev_huella, fechaHoraHuso: reg.fecha_hora_huso });
  ok(recompute === reg.huella, 'huella persistida = recomputada desde sus campos (congelada y reproducible)');
  console.log('    registro: numserie=' + reg.num_serie + ' fecha=' + reg.fecha_expedicion + ' importe=' + reg.importe_total + ' huso=' + reg.fecha_hora_huso + ' primer=' + reg.primer_registro);
  console.log('    huella  : ' + reg.huella);
}

// El documento imprimible debe traer el QR + la leyenda.
const docRes = await fetch(ORIGIN + '/admin/invoices/' + created.id, { headers: { 'Cookie': COOKIES(token) } });
const html = await docRes.text();
ok(html.includes('VERI*FACTU'), 'el documento muestra la leyenda "VERI*FACTU"');
ok(html.includes('Factura verificable en la sede electrónica de la AEAT'), 'el documento muestra "Factura verificable en la sede electrónica de la AEAT"');
ok(/<img[^>]+src="data:image\/png;base64,/.test(html), 'el documento incluye el <img> del QR (al inicio)');

// URL EXACTA a la que apunta el QR (para que el dueño la coteje al escanear).
if (reg) {
  const url = cotejoUrl({ nif: reg.id_emisor, numSerie: reg.num_serie, fecha: reg.fecha_expedicion, importe: reg.importe_total });
  console.log('\n  >>> El QR de esta factura codifica EXACTAMENTE esta URL:');
  console.log('  ' + url);
  ok(html.includes('data:image/png'), 'QR renderizado como imagen escaneable en el navegador');
}

db.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
db.close();
console.log('\n=== RESULTADO PARTE B: ' + pass + ' OK / ' + fail + ' FALLOS ===');
console.log('(factura demo #' + (created.id || '?') + ' creada en el tenant de desarrollo; NIF de empresa puesto a 89890001K para la demo)');
process.exit(fail ? 1 : 0);
