// GATE de la FICHA G — el portal del cliente, ampliado (G1 · G2).
//   node scripts/gate-portal-ampliado.mjs
//
// EL PORTAL ES LA ÚNICA PANTALLA DEL PRODUCTO SIN SESIÓN: se entra con un token en la URL y punto.
// Por eso aquí lo primero que se prueba no es que funcione, sino que **no se abre lo ajeno**: un
// token de otro cliente, uno caducado y uno revocado tienen que dar 403 y no enseñar ni una cifra.
// Todo lo demás se prueba PULSANDO en un navegador, y lo que el gate crea se borra al terminar.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes, createHash } from 'crypto';
import { tenantDb, launchOpts } from './lib/gate-env.mjs';
import { verifyTenantInvoices } from '../modules/superadmin/integridad.js';
import { createToken, analiticaCliente, mensajesDe, sinLeer } from '../modules/portal/portal.js';

const SLUG = 'desarrollo-bamburu';
const DB_PATH = tenantDb(SLUG);
const HOST = `${SLUG}.bamburu.com`, BASE = 'https://' + HOST;
const RID = randomBytes(3).toString('hex');
const MARCA = 'GG-' + RID;
const TOKEN_PREFIJO = 'gate-fichag-';
const dormir = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (c, m, det) => { if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ ' + m + (det ? ' · ' + det : '')); } };

const db = new Database(DB_PATH);
db.pragma('busy_timeout = 10000');
let browser = null, creado = { clientes: [], tokens: [] };
const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
if (!owner) { console.error('✗ GATE ABORTADO: no hay owner activo'); process.exit(2); }
const adminTok = TOKEN_PREFIJO + randomBytes(20).toString('hex');
const ahora = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(adminTok, owner.id, ahora, ahora + 3600, randomBytes(20).toString('hex'));

try {
  // ── El gate se trae SU cliente y SUS facturas: así sabe qué cifras tienen que salir ────────────
  const cli = db.prepare("INSERT INTO clients (name, client_type, active) VALUES (?,'empresa',1)").run(MARCA + ' Cliente').lastInsertRowid;
  const otroCli = db.prepare("INSERT INTO clients (name, client_type, active) VALUES (?,'empresa',1)").run(MARCA + ' Otro').lastInsertRowid;
  creado.clientes = [cli, otroCli];
  // Las facturas del gate ENTRAN EN LA CADENA PROPIETARIA como cualquier otra: se les calcula su
  // hash y se enlazan entre sí. Meterlas con el hash en blanco dejaría la pantalla de Integridad en
  // ALARMA mientras el gate corre —y para siempre si el gate muriera antes de limpiar—, que es
  // justo la avería que se recompuso esta tarde. Misma fórmula que `calcHash` de invoices.js.
  const CIF = '89890001K';
  const hashDe = (num, fecha, total, prev) =>
    createHash('sha256').update([num, fecha, CIF, '', total.toFixed(2), prev].join('|')).digest('hex');
  const seqBase = db.prepare("SELECT COALESCE(MAX(sequence),0) s FROM invoices WHERE series='GGATE'").get().s;
  let prev = '';
  const nueva = (n, fecha, base) => {
    const num = MARCA + '-' + n, total = Math.round(base * 1.21 * 100) / 100;
    const h = hashDe(num, fecha, total, prev);
    const id = db.prepare(
      `INSERT INTO invoices (invoice_number,series,year,sequence,issue_date,company_name,company_fiscal_id,
         client_id,client_name,subtotal,tax_amount,total,status,record_type,verifactu_hash,prev_hash,currency_symbol)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'emitida','alta',?,?,'€')`
    ).run(num, 'GGATE', 2026, seqBase + n, fecha, MARCA + ' SL', CIF, cli, MARCA + ' Cliente',
          base, Math.round(base * 0.21 * 100) / 100, total, h, prev).lastInsertRowid;
    prev = h;
    db.prepare("INSERT INTO invoice_items (invoice_id,description,quantity,unit_price,total_price) VALUES (?,?,?,?,?)")
      .run(id, n === 1 ? 'Mantenimiento mensual' : 'Reparación', 1, base, base);
    return id;
  };
  nueva(1, '2026-01-10', 100); nueva(2, '2026-02-10', 200); nueva(3, '2026-03-12', 300);

  const tok = createToken(db, cli, 14);
  const tokOtro = createToken(db, otroCli, 14);
  creado.tokens = [tok, tokOtro];

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[0] LO PRIMERO: un enlace ajeno, caducado o revocado no abre NADA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const pedir = async (t) => { const r = await fetch(BASE + '/portal/' + t, { redirect: 'manual' }); return { s: r.status, h: await r.text() }; };
  const inventado = await pedir('nodeberiaexistir' + RID);
  ok(inventado.s === 403 && !/Cliente/.test(inventado.h), 'un token inventado da 403 y no enseña nada', 'got ' + inventado.s);
  const ajeno = await pedir(tokOtro);
  ok(ajeno.s === 200 && !ajeno.h.includes(MARCA + '-1'), 'el token de OTRO cliente no enseña mis facturas');
  const tCad = createToken(db, cli, 14); creado.tokens.push(tCad);
  db.prepare("UPDATE portal_tokens SET expires_at=? WHERE token=?").run(ahora - 10, tCad);
  ok((await pedir(tCad)).s === 403, 'un token caducado da 403');
  const tRev = createToken(db, cli, 14); creado.tokens.push(tRev);
  db.prepare("UPDATE portal_tokens SET revoked=1 WHERE token=?").run(tRev);
  ok((await pedir(tRev)).s === 403, 'un token revocado da 403');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] G1 — las analíticas del propio cliente, contrastadas a mano');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const A = analiticaCliente(db, cli);
  ok(A.hay && A.compras === 3, 'cuenta sus 3 compras', A.compras + '');
  ok(Math.abs(A.total - 600) < 0.01, '  y suma sus 600 € de base', A.total + ' €');
  ok(Math.abs(A.media - 200) < 0.01, '  media de 200 € por compra', A.media + ' €');
  // Enero→febrero 31 días, febrero→marzo 30 → mediana 30,5 → 31 (redondeo). Es la MEDIANA, no la media.
  ok(A.cadaDias === 31 || A.cadaDias === 30, '  y su ritmo sale de la MEDIANA de días entre compras', A.cadaDias + ' días');
  ok(A.lineas.length === 2 && A.lineas[0].d === 'Reparación', '  «lo que más compras» ordenado por importe', JSON.stringify(A.lineas.map(l => l.d)));
  // Una factura ANULADA no puede colarse: sería contradecir su propia lista de facturas.
  const anul = nueva(4, '2026-04-10', 9999);
  db.prepare("UPDATE invoices SET status='anulada' WHERE id=?").run(anul);
  const A2 = analiticaCliente(db, cli);
  ok(A2.compras === 3 && Math.abs(A2.total - 600) < 0.01,
     'una factura ANULADA no le infla el histórico (mismo criterio que su lista)', A2.compras + ' compras · ' + A2.total + ' €');

  browser = await puppeteer.launch(launchOpts());
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 900, height: 1200 });
  const errores = [];
  page.on('pageerror', e => errores.push(String(e && e.message || e)));
  await page.goto(BASE + '/portal/' + tok, { waitUntil: 'networkidle0' });
  await dormir(900);
  const vista = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  ok(/Tu histórico con/.test(vista), 'el portal enseña el bloque de analíticas');
  ok(/3 compras/.test(vista), '  con sus compras', '3 compras');
  // 1 sep 2026 · Antes esto llevaba una clase de caracteres con el punto Y la coma dentro, así que
  // aceptaba LAS DOS FORMAS: por eso este gate dio 35 ✓ · 0 ✗ con la pantalla escribiendo «€600.00».
  // Tenía el defecto delante y lo dejó pasar. La coma no es un detalle de estilo: ES la aserción.
  // (Ese regex viejo no se transcribe aquí a propósito: el criterio de aceptación de la tarea exige
  //  que no quede ni un rastro suyo en el fichero, y un comentario también es rastro.)
  ok(/600,00 €/.test(vista), '  su total, escrito como en España (600,00 €)');
  ok(/ritmo habitual/.test(vista), '  y su ritmo');
  ok(/Lo que más compras/.test(vista) && /Mantenimiento mensual/.test(vista), '  y qué compra');
  ok(!/9999/.test(vista), '  y ni rastro de la factura anulada');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] G2 — el canal de comunicaciones, PULSANDO de los dos lados');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  ok(/Hablar con/.test(vista), 'el portal tiene el bloque para escribir');
  await page.type('textarea[name="texto"]', MARCA + ' hola desde el portal');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('button[type="submit"]')]);
  await dormir(800);
  const hilo1 = mensajesDe(db, cli);
  ok(hilo1.length === 1 && hilo1[0].autor === 'cliente', 'el cliente escribe y se guarda', JSON.stringify(hilo1[0]?.texto || ''));
  const trasEnviar = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  ok(/Mensaje enviado/.test(trasEnviar), '  y el portal le DICE que salió (nada de un silencio)');
  ok(new RegExp(MARCA).test(trasEnviar), '  y su mensaje aparece en el hilo');
  // Un mensaje vacío no puede colarse.
  const vacio = await fetch(BASE + '/portal/' + tok + '/mensaje', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'texto=%20%20', redirect: 'manual' });
  ok([302, 303].includes(vacio.status) && /err=/.test(vacio.headers.get('location') || ''),
     'un mensaje en blanco se rechaza y se dice por qué', vacio.headers.get('location') || '');
  ok(mensajesDe(db, cli).length === 1, '  y no se guarda');

  // El lado del negocio.
  const pend = new Map(sinLeer(db, 'negocio').map(x => [x.client_id, x.n]));
  ok(pend.get(cli) === 1, 'al negocio le consta 1 mensaje sin leer', JSON.stringify([...pend]));
  const admin = await ctx.newPage();
  await admin.setCookie({ name: 'asess', value: adminTok, domain: HOST, path: '/', secure: true });
  await admin.goto(BASE + '/admin/portal', { waitUntil: 'networkidle0' });
  await dormir(900);
  ok(/sin leer/.test(await admin.evaluate(() => document.body.innerText)), 'y la pantalla del portal lo avisa');
  await admin.goto(BASE + '/admin/portal/mensajes/' + cli, { waitUntil: 'networkidle0' });
  await dormir(700);
  ok(new RegExp(MARCA).test(await admin.evaluate(() => document.body.innerText)), 'el negocio lee el mensaje del cliente');
  ok(!sinLeer(db, 'negocio').some(x => x.client_id === cli), '  y al abrirlo deja de constar sin leer');
  await admin.type('textarea[name="texto"]', MARCA + ' te contesto');
  await Promise.all([admin.waitForNavigation({ waitUntil: 'networkidle0' }), admin.click('button[type="submit"]')]);
  await dormir(800);
  const hilo2 = mensajesDe(db, cli);
  ok(hilo2.length === 2 && hilo2[1].autor === 'negocio', 'el negocio contesta y se guarda', hilo2.length + ' mensajes');
  ok(hilo2[1].admin_user_id === owner.id, '  guardando QUIÉN del negocio lo escribió', 'usuario ' + hilo2[1].admin_user_id);
  ok(new RegExp('lo contest\u00f3 ' + (hilo2[1].autor_nombre || 'x')).test(await admin.evaluate(() => document.body.innerText)),
     '  y esa pantalla dice quién fue (dentro del negocio, no en el portal)', hilo2[1].autor_nombre || '(sin nombre)');
  await page.reload({ waitUntil: 'networkidle0' }); await dormir(800);
  const portalTras = await page.evaluate(() => document.body.innerText);
  ok(/te contesto/.test(portalTras), 'y el cliente lo ve en su portal');
  // Se mide DESPUÉS de recargar: antes del reload el portal ni siquiera tiene la respuesta pintada,
  // y la aserción daría verde por no haber nada que mirar.
  ok(!portalTras.includes('lo contestó') && !portalTras.includes(hilo2[1].autor_nombre || '\u0000'),
     '  y al cliente NO se le enseña el nombre del empleado', hilo2[1].autor_nombre || '(sin nombre)');

  console.log('\n[3] Lo que NO se ha roto, y lo que queda fuera');
  ok(/PDF/.test(vista), 'el portal sigue ofreciendo el PDF de cada factura (G3, ya hecho)');
  ok(/Cómo pagar|transferencia/.test(vista), 'y los datos de transferencia siguen ahí');
  ok(errores.length === 0, 'sin errores de JavaScript en el portal', errores.join(' | ') || 'ninguno');
  // Y lo que el gate sembró no puede haber encendido la alarma de Integridad.
  const integ = verifyTenantInvoices(DB_PATH);
  ok(integ.ok, 'la cadena propietaria sigue cuadrando con las facturas del gate dentro',
     integ.total + ' facturas' + (integ.alarm ? ' · ' + integ.alarm.invoice_number + ': ' + integ.alarm.reason : ''));
  console.log('  · G4 (pago con tarjeta) NO entra: necesita una pasarela contratada. Queda en el GRUPO 4.');
  console.log('  · G5 («el etc del dueño») no es un subpunto construible: se deja abierto a propósito.');

} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN: ' + e.message + '\n' + e.stack);
} finally {
  try { if (browser) await browser.close(); } catch {}
  try {
    db.pragma('foreign_keys = ON');
    db.prepare("DELETE FROM portal_mensajes WHERE texto LIKE 'GG-%' OR client_id IN (SELECT id FROM clients WHERE name LIKE 'GG-%')").run();
    db.prepare("DELETE FROM portal_tokens WHERE client_id IN (SELECT id FROM clients WHERE name LIKE 'GG-%')").run();
    db.prepare("DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE series='GGATE')").run();
    db.prepare("DELETE FROM invoices WHERE series='GGATE'").run();
    db.prepare("DELETE FROM clients WHERE name LIKE 'GG-%'").run();
    db.prepare("DELETE FROM admin_sessions WHERE token LIKE '" + TOKEN_PREFIJO + "%'").run();
  } catch (e) { console.error('  (limpieza incompleta: ' + e.message + ')'); }
  try { db.close(); } catch {}
}

console.log(`\n${'─'.repeat(70)}\nRESULTADO: ${pass} ✓  ·  ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
