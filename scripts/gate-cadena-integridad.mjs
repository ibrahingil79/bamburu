// GATE del encargo INTEGRIDAD — la cadena propietaria de `invoices`, recompuesta y VERDE.
//   node scripts/gate-cadena-integridad.mjs
//
// LO QUE ESTE GATE EXISTE PARA IMPEDIR, que son cuatro maneras distintas de dar un verde falso:
//
//  1. **Que el verde venga de haber callado la alarma.** El encargo prohíbe expresamente añadir
//     excepciones a `integridad.js`. Aquí no se comprueba «no parece que tenga excepciones»: se
//     compara el **SHA-256 del fichero** con el que tenía ANTES de la tarea (congelado en la línea
//     base). Si alguien le toca una coma —una lista blanca, un `if (slug === …)`, un `return true`—
//     el gate cae aunque el panel esté verde.
//
//  2. **Que el verde sea el de una fila rancia.** La pantalla del superadmin NO ejecuta el chequeo:
//     pinta lo último guardado en `integrity_checks`. Antes de esta tarea esa fila era del 20 de
//     JUNIO y decía «cadena íntegra · 20 facturas» con 833 facturas en la base — un verde que llevaba
//     dos meses mintiendo. Por eso aquí se **lanza el chequeo de verdad por su endpoint real**, con
//     sesión de superadmin y su CSRF, y solo después se lee lo que la pantalla enseña.
//
//  3. **Que se haya «arreglado» la cadena moviendo un dato de negocio.** Cambiar el `total` de una
//     factura también hace cuadrar un hash. Se compara la foto del negocio (ventas, cobros, libro) y
//     un SHA de TODOS los campos de las facturas MENOS los dos del sello: si eso cambia, se ha tocado
//     una factura, no un sello.
//
//  4. **Que el recálculo haya inventado en vez de reproducir.** La serie S nunca estuvo rota, así que
//     recomponerla tiene que devolver EXACTAMENTE los mismos 122 sellos. Es el control positivo: si
//     la S se mueve, el algoritmo no reproduce el original y el verde de la F no vale nada.
//
// Y la regla que este gate NO relaja: la cadena de VERI*FACTU se compara por **SHA-256 de todas sus
// filas**, no por recuento. 1050 filas alteradas siguen siendo 1050 filas.
import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { tenantDb, APP_DIR, exigeCodigoServido } from './lib/gate-env.mjs';
import { verifyTenantInvoices } from '../modules/superadmin/integridad.js';
import { ventasResumen } from '../modules/erp/ventas-metrics.js';

exigeCodigoServido();

const SLUG = 'desarrollo-bamburu';
const DB_PATH = tenantDb(SLUG);
const CONTROL = path.join(APP_DIR, 'data', 'control.db');
const BASE_JSON = path.join(APP_DIR, 'docs', 'encargo-cupones', 'linea-base-integridad.json');
const APEX = 'http://localhost:3000';          // el panel vive en el apex; `localhost` no tiene subdominio
const TOKEN_PREFIJO = 'gate-integridad-';

let pass = 0, fail = 0;
const ok = (c, m, det) => { if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ ' + m + (det ? ' · ' + det : '')); } };

if (!fs.existsSync(BASE_JSON)) { console.error('✗ GATE ABORTADO: falta la línea base ' + BASE_JSON); process.exit(2); }
const linea = JSON.parse(fs.readFileSync(BASE_JSON, 'utf8'));

const db = new Database(DB_PATH, { readonly: true });
const ctrl = new Database(CONTROL);
ctrl.pragma('busy_timeout = 10000');

try {
  // ═══ [1] EL VERIFICADOR REAL DEL SUPERADMIN, SOBRE TODOS LOS NEGOCIOS ════════════════════════
  console.log('\n[1] La cadena propietaria cuadra — y no solo en el negocio que se arregló');
  const dir = path.join(APP_DIR, 'data', 'tenants');
  const rotos = [];
  let conFacturas = 0;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.db'))) {
    const r = verifyTenantInvoices(path.join(dir, f));
    if (r.total > 0) conFacturas++;
    if (!r.ok) rotos.push(f.replace(/\.db$/, '') + ' → ' + (r.alarm ? r.alarm.invoice_number : '?'));
  }
  ok(conFacturas >= 8, 'hay negocios con facturas que verificar (si no, esto no probaría nada)', conFacturas + ' negocios');
  ok(rotos.length === 0, 'ningún negocio tiene la cadena rota', rotos.length ? rotos.join(' · ') : 'los ' + conFacturas + ' cuadran');
  const mio = verifyTenantInvoices(DB_PATH);
  ok(mio.ok && mio.total === linea.facturas,
     `${SLUG}: pasa de ALARMA a CUADRA con las mismas ${linea.facturas} facturas`,
     `ok=${mio.ok} · ${mio.total} facturas`);
  ok(linea.integridad_antes.ok === false, 'y la línea base confirma que ANTES estaba en ALARMA (no es un verde de siempre)',
     linea.integridad_antes.alarm ? linea.integridad_antes.alarm.invoice_number : '—');

  // ═══ [2] SIN EXCEPCIONES: EL VERIFICADOR NO SE HA TOCADO ═════════════════════════════════════
  console.log('\n[2] `integridad.js` está intacto — el verde no viene de haber callado la alarma');
  const rutaInteg = path.join(APP_DIR, 'modules', 'superadmin', 'integridad.js');
  const shaInteg = createHash('sha256').update(fs.readFileSync(rutaInteg)).digest('hex');
  ok(shaInteg === linea.integridad_js_sha, 'el fichero es byte a byte el de antes de la tarea',
     shaInteg.slice(0, 16) + '… vs ' + String(linea.integridad_js_sha).slice(0, 16) + '…');
  const fuente = fs.readFileSync(rutaInteg, 'utf8');
  for (const aguja of [SLUG, 'desarrollo', 'skip', 'ignorar', 'whitelist', 'lista blanca', 'excepcion', 'excepción'])
    ok(!fuente.includes(aguja), `no aparece "${aguja}" en el verificador`);

  // ═══ [3] LA CADENA DE VERIFACTU, INTACTA ═════════════════════════════════════════════════════
  console.log('\n[3] La cadena de VERI*FACTU no se ha rozado');
  const regs = db.prepare(
    'SELECT id,invoice_id,record_type,id_emisor,num_serie,fecha_expedicion,tipo_factura,cuota_total,' +
    'importe_total,prev_huella,huella,fecha_hora_huso,primer_registro FROM verifactu_registros ORDER BY id').all();
  const env = db.prepare('SELECT id,registro_id,estado FROM verifactu_envios ORDER BY id').all();
  const shaVf = createHash('sha256').update(JSON.stringify({ regs, env })).digest('hex');
  ok(regs.length === linea.verifactu.registros, 'mismo número de registros', `${regs.length} vs ${linea.verifactu.registros}`);
  ok(env.length === linea.verifactu.envios, 'mismo número de envíos', `${env.length} vs ${linea.verifactu.envios}`);
  ok(shaVf === linea.verifactu.sha, 'SHA-256 de la cadena ENTERA idéntico (no un recuento: byte a byte)',
     shaVf.slice(0, 16) + '… vs ' + linea.verifactu.sha.slice(0, 16) + '…');

  // ═══ [4] EL NEGOCIO NO SE MOVIÓ NI UN CÉNTIMO ════════════════════════════════════════════════
  console.log('\n[4] Ni ventas, ni cobros, ni contabilidad, ni un dato de factura');
  const dbRo = new Database(DB_PATH, { readonly: true });
  const v = ventasResumen(dbRo); dbRo.close();
  ok(v.count === linea.ventas.count && v.total === linea.ventas.total && v.base === linea.ventas.base && v.iva === linea.ventas.iva,
     'ventas idénticas', `${v.count} doc · ${v.total} € (base: ${linea.ventas.count} doc · ${linea.ventas.total} €)`);
  const cob = db.prepare('SELECT COUNT(*) c, ROUND(COALESCE(SUM(amount),0),2) imp FROM invoice_payments').get();
  ok(cob.c === linea.cobros.c && cob.imp === linea.cobros.imp, 'cobros idénticos', `${cob.c} · ${cob.imp} €`);
  const lib = db.prepare('SELECT COUNT(*) n, ROUND(SUM(debit),2) debe, ROUND(SUM(credit),2) haber FROM ledger_lines').get();
  ok(lib.n === linea.libro.n && lib.debe === linea.libro.debe && lib.haber === linea.libro.haber,
     'contabilidad idéntica y cuadrada', `${lib.n} líneas · debe ${lib.debe} = haber ${lib.haber}`);
  ok(db.prepare('SELECT COUNT(*) c FROM ledger_entries').get().c === linea.asientos, 'mismos asientos', linea.asientos + '');
  // El cinturón fino: TODOS los campos de la factura MENOS los dos del sello. Cambiar un `total`
  // también hace cuadrar un hash — y sería «arreglar» la cadena falsificando el negocio.
  const shaDatos = createHash('sha256').update(JSON.stringify(db.prepare(
    'SELECT id,invoice_number,series,year,sequence,issue_date,company_fiscal_id,client_fiscal_id,' +
    'total,subtotal,tax_amount,status FROM invoices ORDER BY id').all())).digest('hex');
  ok(shaDatos === linea.datos_factura_sha, 'ni un campo de ninguna factura ha cambiado (todo menos los 2 del sello)',
     shaDatos.slice(0, 16) + '… vs ' + String(linea.datos_factura_sha).slice(0, 16) + '…');

  // ═══ [5] LO QUE CUELGA DE LA CADENA, Y EL CONTROL POSITIVO ═══════════════════════════════════
  console.log('\n[5] Las anulaciones vuelven a enlazar, y la serie sana NO se tocó');
  const totalAnu = db.prepare('SELECT COUNT(*) c FROM invoice_anulaciones').get().c;
  const enlazan = db.prepare('SELECT COUNT(*) c FROM invoice_anulaciones a JOIN invoices i ON i.id=a.invoice_id WHERE a.prev_hash = i.verifactu_hash').get().c;
  ok(totalAnu === linea.anulaciones, 'no se ha perdido ni creado ninguna anulación', `${totalAnu} vs ${linea.anulaciones}`);
  ok(enlazan === totalAnu && totalAnu > 0, 'cada anulación enlaza con el sello de SU factura', `${enlazan}/${totalAnu}`);
  const shaS = createHash('sha256').update(JSON.stringify(
    db.prepare("SELECT id,verifactu_hash,prev_hash FROM invoices WHERE series='S' ORDER BY sequence").all())).digest('hex');
  ok(db.prepare("SELECT COUNT(*) c FROM invoices WHERE series='S'").get().c === linea.serie_S_n,
     'la serie S sigue teniendo sus facturas', linea.serie_S_n + '');
  ok(shaS === linea.sello_serie_S,
     'CONTROL: la serie S nunca estuvo rota y sus 122 sellos son los MISMOS — el cálculo reproduce, no inventa',
     shaS.slice(0, 16) + '… vs ' + String(linea.sello_serie_S).slice(0, 16) + '…');

  // ═══ [6] EL PANEL DEL SUPERADMIN, DE PUNTA A PUNTA ═══════════════════════════════════════════
  console.log('\n[6] El panel real: se lanza el chequeo por su endpoint y la pantalla dice «cuadra»');
  const sa = ctrl.prepare('SELECT id FROM superadmins ORDER BY id LIMIT 1').get();
  if (!sa) { console.error('✗ GATE ABORTADO: no hay superadmin en control.db'); process.exit(2); }
  const tok = TOKEN_PREFIJO + randomBytes(24).toString('hex');
  const csrf = randomBytes(24).toString('hex');
  const now = Math.floor(Date.now() / 1000);
  ctrl.prepare('INSERT INTO superadmin_sessions (token,superadmin_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tok, sa.id, now, now + 900, csrf);
  const H = { cookie: 'sadm=' + tok };

  const rRun = await fetch(APEX + '/superadmin/integridad/run', {
    method: 'POST', headers: { ...H, 'x-csrf-token': csrf, 'Content-Type': 'application/json' }, body: '{}' });
  ok(rRun.status === 200, 'el endpoint real /superadmin/integridad/run responde 200', 'got ' + rRun.status);

  // Y ahora lo que la pantalla ENSEÑA, leído del HTML que sirve el servidor.
  const rPag = await fetch(APEX + '/superadmin/integridad', { headers: H, redirect: 'manual' });
  const html = await rPag.text();
  ok(rPag.status === 200 && html.includes('Integridad de facturas'), 'la pantalla responde y es la suya (no un login)', 'got ' + rPag.status);
  ok(html.includes('Todo cuadra en el último chequeo'), 'la pantalla dice «Todo cuadra en el último chequeo»');
  ok(!html.includes('Hay alarmas'), 'y NO dice «Hay alarmas»');
  ok(!html.includes('ALARMA'), 'no queda ni una insignia de ALARMA en la tabla');

  // La fila guardada, que es de donde bebe la pantalla: fresca y verdadera.
  const fila = ctrl.prepare('SELECT * FROM integrity_checks WHERE tenant_slug=?').get(SLUG);
  ok(!!fila && fila.ok === 1, 'la fila guardada de ' + SLUG + ' dice ok', fila ? 'ok=' + fila.ok + ' · ' + fila.detail : 'no hay fila');
  ok(!!fila && fila.total === linea.facturas, 'y con el número de facturas de HOY, no el de junio',
     fila ? fila.total + ' vs ' + linea.facturas : '—');
  ok(!!fila && (now - fila.ts) < 300, 'y es de hace un momento (la pantalla ya no pinta una fila rancia)',
     fila ? Math.round(now - fila.ts) + ' s' : '—');
  const malas = ctrl.prepare('SELECT tenant_slug FROM integrity_checks WHERE ok=0').all();
  ok(malas.length === 0, 'ningún negocio queda con la fila en rojo', malas.map(m => m.tenant_slug).join(', ') || 'ninguno');

} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN: ' + e.message + '\n' + e.stack);
} finally {
  // Por PREFIJO, no por la variable de esta pasada: si el gate muere a mitad, no deja sesiones vivas.
  try { ctrl.prepare("DELETE FROM superadmin_sessions WHERE token LIKE '" + TOKEN_PREFIJO + "%'").run(); } catch {}
  try { db.close(); } catch {}
  try { ctrl.close(); } catch {}
}

console.log(`\n${'─'.repeat(70)}\nRESULTADO: ${pass} ✓  ·  ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
