// LOS LISTADOS IMPRESOS — Gate de NAVEGADOR (Tarea C · tanda 1, 21 ago 2026).
//   node scripts/gate-impresion.mjs
//
// CONTRA LA DIRECCIÓN PÚBLICA. Vigila los CUATRO listados de esta tanda —clientes, productos,
// facturas y lista de precios— y el motor que los sirve. Los otros cuatro NO tienen aserciones
// todavía, a propósito: una aserción que no puede fallar es ruido.
//
// LOS CORREOS SE MANDAN DE VERDAD, al BUZÓN SUMIDERO de Resend (delivered@resend.dev): se ejerce el
// camino entero sin escribirle a una persona. Mismo criterio que `gate-avisos-correos`.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { join } from 'path';
import { unlinkSync, readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import { launchOpts, APP_DIR } from './lib/gate-env.mjs';
import { provisionTenant } from '../core/tenant-provisioning.js';
import { controlDb, getTenantBySlug } from '../core/control-db.js';
import { consultaClientes, consultaFacturas, consultaProductos } from '../modules/erp/listados.js';
const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
const ok = (c, m, e = '') => { (c ? pass++ : fail++); console.log((c ? '  ✓ ' : '  ✗ FALLO: ') + m + (e ? ' — ' + e : '')); };
const TS = Date.now(), RID = String(TS).slice(-6);
const SINK = 'delivered@resend.dev';
const creados = [];
let b;
const dormir = ms => new Promise(r => setTimeout(r, ms));
const hoy = new Date().toISOString().slice(0, 10);
const CLAVES = ['clientes', 'productos', 'facturas', 'precios'];

function borrarTenant(slug) {
  const t = getTenantBySlug(slug);
  controlDb.prepare('DELETE FROM tenants WHERE slug=?').run(slug);
  if (t) for (const s of ['', '-wal', '-shm']) { try { unlinkSync(join(APP_DIR, t.db_filename + s)); } catch {} }
}
function png(w, h) {
  const z = require('zlib');
  const crc = x => { let c = ~0; for (const v of x) { c ^= v; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
  const ch = (t, d) => { const T = Buffer.from(t, 'ascii'), L = Buffer.alloc(4); L.writeUInt32BE(d.length); const C = Buffer.alloc(4); C.writeUInt32BE(crc(Buffer.concat([T, d]))); return Buffer.concat([L, T, d, C]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  const f = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x22)]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', z.deflateSync(Buffer.concat(Array.from({ length: h }, () => f)))), ch('IEND', Buffer.alloc(0))]);
}
async function negocio(etiqueta, nombre) {
  const r = await provisionTenant({
    businessName: nombre || ('GIMP ' + etiqueta + ' ' + TS), ownerName: 'Ana ' + etiqueta,
    email: 'gimp-' + etiqueta + '-' + TS + '@t.local', password: 'contrasena-larga-123',
    country: 'ES', sector: 'taller', oficio: 'otro',
  });
  creados.push(r.slug);
  const db = new Database(join(APP_DIR, r.db_filename));
  const owner = db.prepare('SELECT id,name FROM admin_users WHERE active=1').get();
  const tok = randomBytes(24).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tok, owner.id, now, now + 7200, 'gimp-csrf');
  return { slug: r.slug, db, owner, tok, base: 'https://' + r.slug + '.bamburu.com', cab: { cookie: 'asess=' + tok } };
}
const imgs = pdf => (pdf.toString('latin1').match(/\/Subtype\s*\/Image/g) || []).length;
const pags = pdf => (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

try {
  b = await puppeteer.launch(launchOpts());
  const n = await negocio('uno', 'Talleres Ñandú «Gil» ' + TS);
  n.db.prepare("UPDATE company_config SET company_name=?, fiscal_id='B12345678', address='C/ Mayor 14' WHERE id=1")
    .run('Talleres Ñandú «Gil»');
  const post = async (u, body) => {
    const r = await fetch(n.base + u, { method: 'POST', headers: { ...n.cab, 'content-type': 'application/json', 'x-csrf-token': 'gimp-csrf' }, body: JSON.stringify(body) });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, body: j };
  };
  const pdfDe = async (u) => { const r = await fetch(n.base + u, { headers: n.cab }); return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) }; };
  const txtDe = async (u) => { const r = await fetch(n.base + u, { headers: n.cab }); return { status: r.status, t: await r.text() }; };

  // ── DATOS: nombres con acentos, ñ y comillas, e importes gordos para el formato ──────────────
  const CLI_RARO = 'Óscar Muñoz «El Ñato» & Cía.';
  const insCli = n.db.prepare("INSERT INTO clients (name,fiscal_id,address,email,active,created_at) VALUES (?,?,?,?,1,datetime('now'))");
  const cli = insCli.run(CLI_RARO, 'X1234567L', 'C/ Añil 3', 'o@t.local').lastInsertRowid;
  for (let i = 0; i < 40; i++) insCli.run('Cliente ' + i + ' ' + RID, 'X' + i, 'C/' + i, 'c' + i + '@t.local');
  const prod = n.db.prepare("INSERT INTO products (name,sku,price,type,tax_band,tax_rate,status) VALUES ('Revisión completa','REV-1',1234.56,'service','general',21,'active')").run().lastInsertRowid;
  const linea = [{ product_id: prod, description: 'Revisión completa', quantity: 1, unit_price: 1234.56, tax_rate: 21 }];
  const facturas = [];
  for (let i = 0; i < 3; i++) facturas.push((await post('/api/erp/invoices', { client_id: cli, issue_date: hoy, lines: linea })).body?.id);

  // ── [1][2] LOS CUATRO GENERAN PDF Y OFRECEN LOS TRES VERBOS ─────────────────────────────────
  console.log('\n[1][2] los cuatro listados: PDF y los tres verbos');
  let conPdf = 0, malos = [];
  for (const k of CLAVES) {
    const { status, buf } = await pdfDe('/admin/listados/' + k + '/pdf');
    if (status === 200 && buf.slice(0, 4).toString() === '%PDF') conPdf++; else malos.push(k + '(' + status + ')');
  }
  ok(conPdf === 4, 'los cuatro generan PDF sin error', conPdf + '/4' + (malos.length ? ' · ' + malos.join(', ') : ''));
  const pantallas = { clientes: '/admin/clients', productos: '/admin/products', precios: '/admin/products', facturas: '/admin/invoices' };
  let conVerbos = 0;
  for (const k of CLAVES) {
    const { t } = await txtDe(pantallas[k]);
    const tres = t.includes('/admin/listados/' + k + '/imprimir') || (k === 'facturas' && t.includes("'/admin/listados/facturas/imprimir'"));
    const pdf = t.includes('/admin/listados/' + k + '/pdf') || (k === 'facturas' && t.includes("facturas/pdf"));
    const env = t.includes('enviarListado');
    if ((tres || t.includes(k + '/imprimir')) && (pdf || t.includes(k + '/pdf')) && env) conVerbos++;
    else malos.push('verbos:' + k);
  }
  ok(conVerbos === 4, 'y los cuatro ofrecen imprimir, descargar y enviar en su pantalla', conVerbos + '/4');
  let imprime = 0;
  for (const k of CLAVES) { const { status, t } = await txtDe('/admin/listados/' + k + '/imprimir'); if (status === 200 && /window\.print/.test(t)) imprime++; }
  ok(imprime === 4, 'y la vista de imprimir se manda sola a la impresora', imprime + '/4');

  // ── [3] EL MEMBRETE SALE DE membreteHtml, NO DE UNA COPIA ───────────────────────────────────
  console.log('\n[3] el membrete es el de los documentos, no una copia');
  const defs = execSync("grep -rn 'export function membreteHtml' --include=*.js " + APP_DIR + "/modules | wc -l", { encoding: 'utf8' }).trim();
  ok(defs === '1', 'membreteHtml sigue definido UNA sola vez en todo el producto', defs + ' definición(es)');
  const src = readFileSync(join(APP_DIR, 'modules/erp/impresion.js'), 'utf8');
  ok(/membreteHtml\(\{\s*emisor/.test(src) && /from '\.\/documentos\.js'/.test(src),
     'y el motor de listados lo LLAMA en vez de pintar el suyo');
  let conMembrete = 0;
  for (const k of CLAVES) { const { t } = await txtDe('/admin/listados/' + k + '/imprimir'); if (t.includes('doc-cols') && t.includes('Emisor')) conMembrete++; }
  ok(conMembrete === 4, 'los cuatro papeles llevan el membrete', conMembrete + '/4');

  // ── [4] EL LOGO ─────────────────────────────────────────────────────────────────────────────
  console.log('\n[4] el logo, medido contando imágenes incrustadas');
  let sinLogo = 0;
  for (const k of CLAVES) { const { buf } = await pdfDe('/admin/listados/' + k + '/pdf'); if (imgs(buf) === 0) sinLogo++; }
  ok(sinLogo === 4, 'sin logo puesto, los cuatro PDF traen CERO imágenes', sinLogo + '/4');
  const fd = new FormData();
  fd.append('logo', new Blob([png(240, 80)], { type: 'image/png' }), 'l.png');
  const up = await (await fetch(n.base + '/api/erp/settings/logo', { method: 'POST', headers: { ...n.cab, 'x-csrf-token': 'gimp-csrf' }, body: fd })).json();
  ok(!!up.company_logo_id, 'se sube un logo', 'id ' + up.company_logo_id);
  let conLogo = 0;
  for (const k of CLAVES) { const { buf } = await pdfDe('/admin/listados/' + k + '/pdf'); if (imgs(buf) >= 1) conLogo++; }
  ok(conLogo === 4, 'y con logo, los cuatro traen al menos una', conLogo + '/4');

  // ── [5] LA PRUEBA DEL MOTOR ÚNICO ───────────────────────────────────────────────────────────
  console.log('\n[5] cambiar el nombre fiscal cambia los cuatro listados Y los documentos');
  const NUEVO = 'Renombrada ' + RID + ' SL';
  n.db.prepare('UPDATE company_config SET company_name=? WHERE id=1').run(NUEVO);
  let cambiaron = 0;
  for (const k of CLAVES) { const { t } = await txtDe('/admin/listados/' + k + '/imprimir'); if (t.includes(NUEVO)) cambiaron++; }
  ok(cambiaron === 4, 'los cuatro listados enseñan el nombre nuevo', cambiaron + '/4');
  const q = await post('/api/erp/quotes', { client_id: cli, date: hoy, lines: linea });
  const docNuevo = (await txtDe('/admin/quotes/' + q.body?.id)).t;
  ok(docNuevo.includes(NUEVO), 'y un documento nuevo también: es el MISMO membrete, no dos');

  // ── [6][7] PAGINACIÓN ───────────────────────────────────────────────────────────────────────
  console.log('\n[6][7] 200 filas: paginan, la cabecera se repite y el contador cuadra');
  for (let i = 0; i < 200; i++) insCli.run('Relleno ' + String(i).padStart(3, '0') + ' ' + RID, 'Z' + i, 'C/' + i, 'z' + i + '@t.local');
  const { buf: gordo } = await pdfDe('/admin/listados/clientes/pdf');
  const nPags = pags(gordo);
  ok(nPags >= 4, 'un listado de 240 clientes ocupa varias páginas', nPags + ' páginas');
  // El texto del PDF, para ver la cabecera repetida y el contador. Se extrae con pdftotext.
  const tmp = '/tmp/gimp-' + RID + '.pdf';
  require('fs').writeFileSync(tmp, gordo);
  let texto = '';
  // HACE FALTA `-layout`: sin él pdftotext trocea la tabla por bloques de columnas y la fila de
  // cabecera sale partida («CÓDIGO CLIENTE NIF» por un lado y el resto por otro). Medido.
  try { execSync('pdftotext -layout ' + tmp + ' ' + tmp + '.txt'); texto = readFileSync(tmp + '.txt', 'utf8'); } catch {}
  // LA CABECERA DE VERDAD, NO UNA PALABRA SUELTA. Esto buscaba /CLIENTE/i, que aparece en el título
  // del papel Y dentro de los propios datos: no podía fallar nunca. Lo destapó la prueba de
  // reversión —quité `table-header-group` y el gate siguió VERDE—, o sea que estaba verde por el
  // motivo equivocado. Ahora se busca la SECUENCIA de los seis rótulos, que solo existe en la fila
  // de cabecera de columnas.
  const CAB = /CÓDIGO\s+CLIENTE\s+NIF\s+EMAIL\s+TELÉFONO\s+GRUPO/;
  const paginasTxt = texto.split('\f').filter(p => p.trim());
  // Se exige en las hojas QUE LLEVAN FILAS: la última puede llevar solo el pie, y ahí no hay
  // ninguna cabecera que repetir. Exigirla también allí sería un rojo del gate, no del producto.
  const conDatos = paginasTxt.filter(p => p.includes('Relleno'));
  const conCabecera = conDatos.filter(p => CAB.test(p)).length;
  ok(conDatos.length >= 3, 'las filas se reparten en varias hojas', conDatos.length + ' hojas con filas');
  ok(conCabecera === conDatos.length, 'y la cabecera de columnas se repite en TODAS', conCabecera + ' de ' + conDatos.length);
  const norm = texto.replace(/\s+/g, ' ');
  ok(norm.includes('Página 1 de ' + nPags), 'el contador es correcto en la PRIMERA', 'Página 1 de ' + nPags);
  ok(norm.includes('Página 2 de ' + nPags), 'y en una intermedia');
  ok(norm.includes('Página ' + nPags + ' de ' + nPags), 'y en la ÚLTIMA');
  try { unlinkSync(tmp); unlinkSync(tmp + '.txt'); } catch {}

  // ── [8][9] LA BASE DECLARADA ────────────────────────────────────────────────────────────────
  console.log('\n[8][9] todo impreso declara su base');
  const filtrado = (await txtDe('/admin/listados/facturas/imprimir?estado=emitida&desde=2026-01-01&hasta=2026-12-31')).t;
  ok(/Estado:<\/span> <span class="v">Emitidas/.test(filtrado) || /Emitidas/.test(filtrado), 'un listado filtrado dice qué filtro tiene', 'Estado: Emitidas');
  ok(/Periodo:/.test(filtrado) && /01\/01\/2026/.test(filtrado) && /31\/12\/2026/.test(filtrado), 'y su periodo, en formato español', '01/01/2026 – 31/12/2026');
  // SE PRUEBA CON PRODUCTOS, no con clientes: el de clientes SIEMPRE declara su estado
  // (activos/archivados), así que nunca puede quedarse sin filtros y ahí «Todos» no saldría jamás.
  // La aserción estaba mal elegida, no el producto.
  const sinFiltro = (await txtDe('/admin/listados/productos/imprimir')).t;
  ok(/Filtros:<\/span> <span class="v">Todos<\/span>/.test(sinFiltro), 'y uno sin filtro dice «Todos»: la cabecera nunca va vacía');
  ok(/class="lst-filtros"/.test(sinFiltro), 'y la caja de la base se pinta siempre, aunque no haya filtros');

  // ── [10] EL TOTAL IMPRESO CUADRA CON LA PANTALLA ────────────────────────────────────────────
  console.log('\n[10] el total impreso, al céntimo');
  const apiFac = await (await fetch(n.base + '/api/erp/invoices', { headers: n.cab })).json();
  const totalPantalla = apiFac.filter(f => f.status !== 'anulada').reduce((a, f) => a + (Number(f.total) || 0), 0);
  const papelFac = (await txtDe('/admin/listados/facturas/imprimir')).t;
  // SE COMPARA EL CÉNTIMO, NO LA TIPOGRAFÍA. Reescribir aquí el formato sería tenerlo en DOS sitios,
  // que es de lo que huye todo este encargo — y se notó: esta aserción se puso roja al añadir el
  // separador de miles al papel, con el producto correcto. Se saca el NÚMERO del papel y se compara
  // con la suma cruda de la pantalla. Cómo se escribe ese número tiene su propia aserción, aparte.
  const aNum = (t) => Number(String(t).replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.'));
  const mGrand = papelFac.match(/<tr class="grand"><td>[^<]*<\/td><td>([^<]*)<\/td>/);
  const impreso = mGrand ? aNum(mGrand[1]) : NaN;
  ok(Math.abs(impreso - totalPantalla) < 0.005, 'el total del papel es el MISMO que el de la pantalla, al céntimo',
     'papel ' + impreso + ' · pantalla ' + totalPantalla.toFixed(2));
  ok(consultaFacturas(n.db, {}).filas.length >= apiFac.length, 'y sale de la MISMA consulta, sin el tope de la pantalla',
     consultaFacturas(n.db, {}).filas.length + ' vs ' + apiFac.length + ' (la pantalla topa en 200)');

  // ── [11] VACÍO ──────────────────────────────────────────────────────────────────────────────
  console.log('\n[11] un listado vacío dice que está vacío');
  const vacio = await pdfDe('/admin/listados/facturas/pdf?desde=1990-01-01&hasta=1990-01-02');
  ok(vacio.status === 200 && vacio.buf.slice(0, 4).toString() === '%PDF', 'genera PDF, no un error', (vacio.buf.length / 1024).toFixed(0) + ' KB');
  const vacioTxt = (await txtDe('/admin/listados/facturas/imprimir?desde=1990-01-01&hasta=1990-01-02')).t;
  ok(/No hay facturas que cumplan estos filtros/.test(vacioTxt), 'y DICE que no hay datos, en vez de salir en blanco');

  // ── [17][18] ACENTOS Y FORMATO ESPAÑOL ──────────────────────────────────────────────────────
  console.log('\n[17][18] acentos, ñ, comillas y formato español');
  const cliTxt = (await txtDe('/admin/listados/clientes/imprimir')).t;
  ok(cliTxt.includes('Óscar Muñoz') && cliTxt.includes('&laquo;El Ñato&raquo;') || cliTxt.includes('Ñato'),
     'los nombres con acentos, ñ y comillas salen enteros', 'Óscar Muñoz «El Ñato»');
  ok(!/Ã³|Ã±|&amp;laquo;/.test(cliTxt), 'y sin que se rompa la codificación');
  const precios = (await txtDe('/admin/listados/precios/imprimir')).t;
  ok(precios.includes('1.234,56 €'), 'los importes van en formato español: 1.234,56 €');
  ok(precios.includes('1.493,82 €'), 'y la lista de precios suma el IVA: 1.234,56 + 21 % = 1.493,82 €');

  // ── [19] NI UNA PETICIÓN SALIENTE ───────────────────────────────────────────────────────────
  console.log('\n[19] generar un listado no llama a ningún sitio de fuera');
  let externas = 0;
  for (const k of CLAVES) { const { t } = await txtDe('/admin/listados/' + k + '/imprimir'); externas += (t.match(/<img[^>]+src="https?:\/\//g) || []).length; }
  ok(externas === 0, 'ninguno de los cuatro papeles apunta a una imagen de fuera', externas + ' imágenes externas');

  // ── [15] PERMISOS ───────────────────────────────────────────────────────────────────────────
  console.log('\n[15] quien no puede ver un listado tampoco puede imprimirlo');
  const emp = n.db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active,must_change_password,created_at) VALUES ('Sin Facturas',?,'x','employee',1,0,datetime('now'))")
    .run('sinfac-' + TS + '@t.local').lastInsertRowid;
  const pClientes = n.db.prepare("SELECT id FROM permissions WHERE module='clients' AND action='read'").get();
  n.db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(emp, pClientes.id);
  const tokEmp = randomBytes(24).toString('base64url');
  n.db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tokEmp, emp, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000) + 3600, 'x');
  const rFac = await fetch(n.base + '/admin/listados/facturas/pdf', { headers: { cookie: 'asess=' + tokEmp } });
  ok(rFac.status === 403, 'sin invoices.read, el servidor responde 403 al PDF de facturas', 'HTTP ' + rFac.status);
  const cuerpo403 = await rFac.text();
  ok(!cuerpo403.includes(CLI_RARO), 'y en esa respuesta no viaja ni un dato del listado');
  const rCli = await fetch(n.base + '/admin/listados/clientes/pdf', { headers: { cookie: 'asess=' + tokEmp } });
  ok(rCli.status === 200, 'y el listado que SÍ puede ver, lo puede imprimir: el candado abre, no solo cierra', 'HTTP ' + rCli.status);

  // ── [16] DOS NEGOCIOS A LA VEZ ──────────────────────────────────────────────────────────────
  console.log('\n[16] el PDF de un negocio nunca trae datos de otro');
  const otro = await negocio('dos', 'Negocio Vecino ' + TS);
  otro.db.prepare("INSERT INTO clients (name,active,created_at) VALUES (?,1,datetime('now'))").run('Cliente Del Vecino ' + RID);
  const suyo = await (await fetch(otro.base + '/admin/listados/clientes/imprimir', { headers: otro.cab })).text();
  ok(suyo.includes('Cliente Del Vecino ' + RID), 'el vecino ve lo suyo');
  ok(!suyo.includes(CLI_RARO) && !suyo.includes(NUEVO), 'y NADA del otro negocio: ni un cliente ni el nombre de la empresa');
  const mio = (await txtDe('/admin/listados/clientes/imprimir')).t;
  ok(!mio.includes('Cliente Del Vecino ' + RID), 'y al revés, tampoco');

  // ── [13][14] ENVIAR POR CORREO ──────────────────────────────────────────────────────────────
  console.log('\n[13][14] enviar por correo: al sumidero de Resend, sin escribirle a nadie');
  const envio = await post('/api/erp/listados/clientes/enviar', { to: SINK });
  ok(envio.status === 200 && envio.body?.ok, 'el envío sale', 'HTTP ' + envio.status + ' · ' + JSON.stringify(envio.body).slice(0, 60));
  ok(envio.body?.lineas === consultaClientes(n.db, {}).total, 'y manda el listado ENTERO, no la página que se ve', envio.body?.lineas + ' líneas');
  const act = n.db.prepare("SELECT * FROM activity_logs WHERE action LIKE '%correo%' ORDER BY id DESC LIMIT 1").get();
  ok(!!act, 'y queda registrado quién lo mandó y a quién', act ? act.action + ' → ' + (act.details || '') : 'sin registro');
  const malo = await post('/api/erp/listados/clientes/enviar', { to: 'esto-no-es-un-correo' });
  ok(malo.status === 400, 'un correo mal escrito se rechaza antes de generar nada', 'HTTP ' + malo.status);
  const antes = n.db.prepare("SELECT COUNT(*) n FROM activity_logs WHERE action LIKE '%correo%'").get().n;
  // POR QUÉ 'x@a.b' Y NO UN DOMINIO INEXISTENTE. Se sondeó la API antes de escribir esto: a un
  // dominio que no existe Resend le dice que SÍ y el rebote llega después —el envío «sale»—, así que
  // con ese destinatario esta aserción no provocaba ningún fallo. Daba verde igualmente… porque
  // fallaba por otra cosa: a la ruta le faltaba el remitente. Verde por el motivo equivocado.
  // 'x@a.b' pasa nuestra validación de formato y Resend lo rechaza DE VERDAD en la propia llamada.
  const falla = await post('/api/erp/listados/clientes/enviar', { to: 'x@a.b' });
  const despues = n.db.prepare("SELECT COUNT(*) n FROM activity_logs WHERE action LIKE '%correo%'").get().n;
  ok(falla.status === 502 && despues === antes,
     'y si el envío NO sale, no se registra como enviado: pulsar no es llegar', 'HTTP ' + falla.status + ' · registros ' + antes + '→' + despues);
  ok(/no hemos podido|no se ha marcado/i.test(JSON.stringify(falla.body || {})),
     'y se dice en cristiano, sin tragárselo en silencio', String(falla.body?.error || '').slice(0, 64));

  // ── [20] UN NEGOCIO RECIÉN CREADO ───────────────────────────────────────────────────────────
  console.log('\n[20] un negocio recién creado, desde cero, puede generar los cuatro');
  let nuevos = 0;
  for (const k of CLAVES) {
    const r = await fetch(otro.base + '/admin/listados/' + k + '/pdf', { headers: otro.cab });
    const buf = Buffer.from(await r.arrayBuffer());
    if (r.status === 200 && buf.slice(0, 4).toString() === '%PDF') nuevos++;
  }
  ok(nuevos === 4, 'los cuatro, en un negocio que acaba de nacer', nuevos + '/4');

} catch (e) {
  fail++;
  console.error('\n✗ EXCEPCIÓN: ' + (e && e.stack || e));
} finally {
  try { if (b) await b.close(); } catch {}
  for (const s of creados) { try { borrarTenant(s); } catch {} }
  console.log('\n──────────────────────────────────────────────');
  console.log((fail === 0 ? '✓ GATE VERDE' : '✗ GATE ROJO') + ' — ' + pass + ' pasan · ' + fail + ' fallan');
  process.exit(fail === 0 ? 0 : 1);
}
