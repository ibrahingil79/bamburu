// LOS SEIS PAPELES — Gate de NAVEGADOR (Tarea C-0, 21 ago 2026).
//   node scripts/gate-documentos.mjs
//
// CONTRA LA DIRECCIÓN PÚBLICA. Vigila lo que el Paso 0 de C encontró y esta tarea limpió: una sola
// regla de negocio, un solo dialecto de membrete y un logo que sale de verdad — sin que el servidor
// haga una sola petición fuera y sin que un negocio vea el logo de otro.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { join } from 'path';
import { unlinkSync, readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';
import { launchOpts, APP_DIR } from './lib/gate-env.mjs';
import { provisionTenant } from '../core/tenant-provisioning.js';
import { controlDb, getTenantBySlug } from '../core/control-db.js';
import { buildTicketPaper } from '../modules/erp/routes/invoices.js';
import { createRequire } from 'module';
import { soltarAtaduras } from './lib/tirar-negocio.mjs';
const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
const ok = (c, m, e = '') => { (c ? pass++ : fail++); console.log((c ? '  ✓ ' : '  ✗ FALLO: ') + m + (e ? ' — ' + e : '')); };
const TS = Date.now(), RID = String(TS).slice(-6);
const creados = [];
let b;
const dormir = ms => new Promise(r => setTimeout(r, ms));
const hoy = new Date().toISOString().slice(0, 10);

function borrarTenant(slug) {
  const t = getTenantBySlug(slug);
  // ⚙️ 3 SEP 2026 — SUELTA LAS ATADURAS ANTES DE BORRAR EL NEGOCIO. Desde el 2 de septiembre
  // `createTenant` siembra la prueba de 15 días, así que todo negocio nuevo tiene fila en
  // `tenant_suscripciones`: sin soltarla, el DELETE de abajo muere con FOREIGN KEY y el negocio de
  // prueba se queda dentro de control.db para siempre. `soltarAtaduras` le pregunta al esquema.
  soltarAtaduras(slug);
  controlDb.prepare('DELETE FROM tenants WHERE slug=?').run(slug);
  if (t) for (const s of ['', '-wal', '-shm']) { try { unlinkSync(join(APP_DIR, t.db_filename + s)); } catch {} }
}
async function negocio(etiqueta) {
  const r = await provisionTenant({
    businessName: 'GDOC ' + etiqueta + ' ' + TS, ownerName: 'Ana ' + etiqueta,
    email: 'gdoc-' + etiqueta + '-' + TS + '@t.local', password: 'contrasena-larga-123',
    country: 'ES', sector: 'taller', oficio: 'otro',
  });
  creados.push(r.slug);
  const db = new Database(join(APP_DIR, r.db_filename));
  const owner = db.prepare('SELECT id,name FROM admin_users WHERE active=1').get();
  const tok = randomBytes(24).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tok, owner.id, now, now + 7200, 'gdoc-csrf');
  db.prepare("UPDATE company_config SET company_name=?, fiscal_id='B00000000', address='Calle Falsa 1' WHERE id=1").run('GDOC ' + etiqueta);
  return { slug: r.slug, db, owner, tok, base: 'https://' + r.slug + '.bamburu.com', cab: { cookie: 'asess=' + tok } };
}

// ── PNG de verdad, del tamaño que se pida. Se genera aquí para no depender de ningún fichero del
//    repo: un gate que necesita un adjunto que alguien puede borrar es un gate frágil.
function pngDe(ancho, alto) {
  const zlib = require('zlib');
  const crc = buf => { let c = ~0; for (const b of buf) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (tipo, datos) => {
    const t = Buffer.from(tipo, 'ascii'); const len = Buffer.alloc(4); len.writeUInt32BE(datos.length);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(Buffer.concat([t, datos])));
    return Buffer.concat([len, t, datos, cr]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0); ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8 bits, RGB
  const fila = Buffer.concat([Buffer.from([0]), Buffer.alloc(ancho * 3, 0x33)]);
  const raw = Buffer.concat(Array.from({ length: alto }, () => fila));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function subirLogo(n, buffer, nombre, tipo) {
  const fd = new FormData();
  fd.append('logo', new Blob([buffer], { type: tipo }), nombre);
  const r = await fetch(n.base + '/api/erp/settings/logo', {
    method: 'POST', headers: { ...n.cab, 'x-csrf-token': 'gdoc-csrf' }, body: fd,
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}

// Siembra los SEIS papeles en un negocio y devuelve sus ids.
function sembrar(n) {
  const db = n.db;
  const cli = db.prepare("INSERT INTO clients (name,fiscal_id,address,email,active,created_at) VALUES ('Cliente Gate','X1234567L','Calle Cliente 2','cli@t.local',1,datetime('now'))").run().lastInsertRowid;
  const prov = db.prepare("INSERT INTO suppliers (name,fiscal_id,address,city,email,phone,active) VALUES ('Prov Gate','B99999999','Calle Prov 3','Madrid','prov@t.local','600000000',1)").run().lastInsertRowid;
  const prod = db.prepare("INSERT INTO products (name,price,type,tax_band,tax_rate,status) VALUES ('Servicio Gate',100,'service','general',21,'active')").run().lastInsertRowid;
  return { cli, prov, prod };
}

try {
  b = await puppeteer.launch(launchOpts());
  const n = await negocio('uno');
  const s = sembrar(n);
  const p = await b.newPage();
  await p.setViewport({ width: 1400, height: 950 });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.setCookie({ name: 'asess', value: n.tok, domain: n.slug + '.bamburu.com', path: '/', secure: true });

  // ── [1] UNA SOLA DEFINICIÓN DE LA REGLA ─────────────────────────────────────────────────────
  console.log('\n[1][19] la regla «congelado o vivo», definida UNA vez');
  const defs = execSync(
    "grep -rn \"function partesDe\\|function docParties\" --include=*.js " + APP_DIR + "/modules | wc -l",
    { encoding: 'utf8' }).trim();
  ok(defs === '1', 'la regla está definida EXACTAMENTE una vez en todo el producto', defs + ' definición(es)');
  const src = readFileSync(join(APP_DIR, 'modules/erp/documentos.js'), 'utf8');
  ok(/company_name != null/.test(src), 'y la regla que vive ahí es la de siempre: si hay foto congelada, manda la foto');

  // ── [20] LA FACTURA Y EL TICKET DEJAN DE LEER POR SU CUENTA ─────────────────────────────────
  console.log('\n[20] la factura y el ticket ya no leen los campos congelados por su cuenta');
  const inv = readFileSync(join(APP_DIR, 'modules/erp/routes/invoices.js'), 'utf8');
  const cuerpoFactura = inv.slice(inv.indexOf('export async function buildInvoicePaper'), inv.indexOf('export async function buildTicketPaper'));
  const cuerpoTicket = inv.slice(inv.indexOf('export async function buildTicketPaper'));
  ok(!/escHtml\(inv\.company_name\)/.test(cuerpoFactura), 'buildInvoicePaper no pinta inv.company_name a pelo');
  ok(!/escHtml\(inv\.company_name\)/.test(cuerpoTicket), 'buildTicketPaper tampoco');
  ok(/partesDe\(db, inv\)/.test(cuerpoFactura) && /partesDe\(db, inv\)/.test(cuerpoTicket), 'los dos piden las partes a la única regla');

  // ── [3][4] UN SOLO DIALECTO ─────────────────────────────────────────────────────────────────
  console.log('\n[3][4] un solo dialecto de membrete');
  const aMano = 'font-size:11px;text-transform:uppercase;color:var(--text2);font-weight:600;margin-bottom:4px';
  const conAMano = [];
  for (const f of ['quotes', 'pedidos', 'albaranes', 'purchase-orders']) {
    if (readFileSync(join(APP_DIR, 'modules/erp/routes/' + f + '.js'), 'utf8').includes(aMano)) conAMano.push(f);
  }
  ok(conAMano.length === 0, 'el estilo de rótulo escrito a mano ya no está en ningún papel', conAMano.join(', ') || 'ninguno');

  // ── LOS SEIS PAPELES, EN PANTALLA ───────────────────────────────────────────────────────────
  const R = {};
  const abre = async (url) => { const r = await fetch(n.base + url, { headers: n.cab }); return { status: r.status, html: await r.text() }; };

  // Presupuesto y pedido y albarán y orden de compra, creados por su propia API.
  const post = async (url, body) => {
    const r = await fetch(n.base + url, { method: 'POST', headers: { ...n.cab, 'content-type': 'application/json', 'x-csrf-token': 'gdoc-csrf' }, body: JSON.stringify(body) });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, body: j };
  };
  const linea = [{ product_id: s.prod, description: 'Servicio Gate', quantity: 1, unit_price: 100, tax_rate: 21 }];
  const cuerpoVenta = (extra = {}) => ({ client_id: s.cli, date: hoy, lines: linea, ...extra });
  const q = await post('/api/erp/quotes', cuerpoVenta());
  const o = await post('/api/erp/pedidos', cuerpoVenta());
  const lineaPo = [{ product_id: s.prod, description: 'Servicio Gate', quantity: 1, unit_cost: 50 }];
  const po = await post('/api/erp/purchase-orders', { supplier_id: s.prov, date: hoy, lines: lineaPo, items: lineaPo });
  R.quote = q.body?.id; R.order = o.body?.id; R.po = po.body?.id;
  ok(!!R.quote && !!R.order, 'los papeles de prueba se crean por su API real',
     'presupuesto ' + R.quote + ' · pedido ' + R.order + ' · OC ' + R.po
     + (q.body?.error ? ' · error: ' + q.body.error : ''));

  const pantallas = [
    ['presupuesto', '/admin/quotes/' + R.quote],
    ['pedido', '/admin/pedidos/' + R.order],
  ];
  if (R.po) pantallas.push(['orden de compra', '/admin/purchase-orders/' + R.po]);
  let usanClases = 0;
  for (const [nom, url] of pantallas) {
    const r = await abre(url);
    if (r.status === 200 && r.html.includes('doc-cols') && r.html.includes('doc-label')) usanClases++;
    else ok(false, nom + ' usa las clases .doc-*', 'HTTP ' + r.status);
  }
  ok(usanClases === pantallas.length, 'los papeles de venta y la orden de compra usan las clases .doc-* del sistema', usanClases + '/' + pantallas.length);

  // ── [14][15][16] EL LOGO: SE SUBE, Y SE VALIDA ──────────────────────────────────────────────
  console.log('\n[14][15][16] el logo se sube; el campo de URL ya no existe');
  const ajustes = await abre('/admin/settings');
  ok(!/URL Logo empresa/.test(ajustes.html) && !/id="cLogo"[^F]/.test(ajustes.html),
     'el campo de texto «URL Logo empresa» ya no existe en Ajustes');
  ok(/id="cLogoFile"/.test(ajustes.html) && /type="file"/.test(ajustes.html), 'y en su sitio hay una SUBIDA de fichero');
  // Un ejecutable renombrado a .png, con el tipo que el navegador quiera decir.
  const falso = Buffer.concat([Buffer.from('MZ\x90\x00'), Buffer.alloc(400, 0x41)]);
  const rFalso = await subirLogo(n, falso, 'logo.png', 'image/png');
  ok(rFalso.status === 400, 'un fichero que NO es imagen, renombrado a .png, se rechaza', 'HTTP ' + rFalso.status);
  ok(/no es una imagen/i.test(rFalso.body?.error || ''), 'y lo dice con sus palabras, sin tecnicismos', (rFalso.body?.error || '').slice(0, 60));
  const gordo = Buffer.concat([pngDe(40, 40), Buffer.alloc(2.2 * 1024 * 1024, 0x00)]);
  const rGordo = await subirLogo(n, gordo, 'gordo.png', 'image/png');
  ok(rGordo.status === 413, 'un fichero de más de 2 MB se rechaza', 'HTTP ' + rGordo.status);
  ok(/2 MB/.test(rGordo.body?.error || ''), 'diciendo cuánto ocupa y cuál es el máximo', (rGordo.body?.error || '').slice(0, 70));

  // ── [9] LA FACTURA DE ANTES CONSERVA LO SUYO ────────────────────────────────────────────────
  console.log('\n[9] una factura emitida ANTES del logo no lo gana después');
  const fAntes = await post('/api/erp/invoices', { client_id: s.cli, issue_date: hoy, lines: linea });
  const idAntes = fAntes.body?.id || n.db.prepare('SELECT id FROM invoices ORDER BY id DESC LIMIT 1').get()?.id;
  ok(!!idAntes, 'se emite una factura antes de subir el logo', 'factura ' + idAntes);
  const logoAntes = n.db.prepare('SELECT company_logo_id FROM invoices WHERE id=?').get(idAntes)?.company_logo_id;
  ok(logoAntes == null, 'y nace sin logo, porque el negocio aún no tenía');

  // Ahora sí: un logo de verdad.
  const rOk = await subirLogo(n, pngDe(300, 120), 'logo.png', 'image/png');
  ok(rOk.status === 200 && !!rOk.body?.company_logo_id, 'un PNG de verdad SÍ entra', 'id ' + rOk.body?.company_logo_id);
  const LOGO_ID = rOk.body?.company_logo_id;

  const htmlAntes = (await abre('/admin/invoices/' + idAntes)).html;
  // OJO: se busca la MARCA DEL LOGO, no «un data URI». El QR de Veri*Factu también es un data URI y
  // en la primera pasada hizo pasar por «tiene logo» a una factura que no lo tenía.
  ok(!htmlAntes.includes('data-membrete="logo"'), 'la factura de antes SIGUE sin logo: cambiarlo hoy no reescribe lo emitido');

  // ── [5] EL LOGO SALE, EN PANTALLA ───────────────────────────────────────────────────────────
  console.log('\n[5] con logo puesto, sale en los papeles nuevos');
  const q2 = await post('/api/erp/quotes', cuerpoVenta());
  const o2 = await post('/api/erp/pedidos', cuerpoVenta());
  const f2 = await post('/api/erp/invoices', { client_id: s.cli, issue_date: hoy, lines: linea });
  const po2 = await post('/api/erp/purchase-orders', { supplier_id: s.prov, date: hoy, lines: lineaPo, items: lineaPo });
  // LOS SEIS, NO CUATRO. La primera versión de este gate medía el logo en presupuesto, pedido,
  // factura y orden de compra, y se dejaba fuera el ALBARÁN y el TICKET DE MOSTRADOR — o sea que la
  // entrega afirmaba «sale en los seis» con cuatro comprobados. El producto estaba bien; la
  // verificación iba por detrás de la afirmación, que es peor.
  const alb2 = await post('/api/erp/albaranes', { client_id: s.cli, date: hoy, lines: [{ product_id: s.prod, description: 'Servicio Gate', quantity: 1, unit_price: 100, tax_rate: 21 }] });
  const tk2 = await post('/api/erp/mostrador/sale', { lines: [{ product_id: s.prod, description: 'Servicio Gate', quantity: 1, unit_price: 100, tax_rate: 21 }], payment_method: 'efectivo' });
  const nuevos = [
    ['presupuesto', '/admin/quotes/' + q2.body?.id],
    ['pedido', '/admin/pedidos/' + o2.body?.id],
    ['factura', '/admin/invoices/' + f2.body?.id],
  ];
  if (po2.body?.id) nuevos.push(['orden de compra', '/admin/purchase-orders/' + po2.body.id]);
  if (alb2.body?.id) nuevos.push(['albarán', '/admin/albaranes/' + alb2.body.id]);
  ok(!!alb2.body?.id, 'el albarán de prueba se crea', 'albarán ' + alb2.body?.id);
  ok(!!tk2.body?.id, 'y el ticket de mostrador también', 'ticket ' + tk2.body?.id + ' · ' + (tk2.body?.invoice_number || ''));
  let conLogo = 0;
  const sinLogo = [];
  for (const [nom, url] of nuevos) {
    const r = await abre(url);
    if (r.html.includes('data-membrete="logo"')) conLogo++; else sinLogo.push(nom + '(' + r.status + ')');
  }
  ok(conLogo === nuevos.length && nuevos.length === 5,
     'el logo sale en pantalla en los CINCO papeles que tienen pantalla', conLogo + '/' + nuevos.length + (sinLogo.length ? ' · sin logo: ' + sinLogo.join(', ') : ''));
  // EL TICKET NO TIENE PANTALLA — solo PDF (`/admin/mostrador/:id/pdf`). Así que su papel se mide
  // llamando al MISMO constructor que usa esa ruta, y su congelado, en la base. Es la única
  // superficie que tiene; medirlo por el PDF binario diría «hay una imagen», no «es el logo».
  const invTicket = tk2.body?.id ? n.db.prepare('SELECT * FROM invoices WHERE id=?').get(tk2.body.id) : null;
  const papelTicket = invTicket ? await buildTicketPaper(n.db, invTicket) : '';
  ok(papelTicket.includes('data-membrete="logo"'), 'y en el TICKET de mostrador, que es el sexto papel con membrete');
  ok(invTicket && invTicket.company_logo_id != null, 'que además lo CONGELA al emitirse, como el resto del membrete', 'company_logo_id=' + invTicket?.company_logo_id);

  // ── [17] EL PDF NO SALE A INTERNET ──────────────────────────────────────────────────────────
  console.log('\n[17] generar el PDF con logo no produce ni una petición saliente');
  ok(/data:/.test(readFileSync(join(APP_DIR, 'modules/erp/documentos.js'), 'utf8').match(/logoDataUri[\s\S]{0,900}/)[0]),
     'el logo se INCRUSTA (data:), no se enlaza: Chromium no tiene a dónde ir');
  const htmlPdf = (await abre('/admin/invoices/' + f2.body?.id)).html;
  const externas = (htmlPdf.match(/<img[^>]+src="https?:\/\//g) || []).length;
  ok(externas === 0, 'y el papel no lleva NI UNA imagen apuntando fuera', externas + ' imágenes externas');

  // ── [6] EL LOGO EN EL PDF ───────────────────────────────────────────────────────────────────
  console.log('\n[6][8] el logo en el PDF, y acotado');
  const pdfDe = async (url) => { const r = await fetch(n.base + url, { headers: n.cab }); return Buffer.from(await r.arrayBuffer()); };
  const pdfFactura = await pdfDe('/admin/invoices/' + f2.body?.id + '/pdf');
  ok(pdfFactura.slice(0, 4).toString() === '%PDF', 'la factura con logo genera un PDF de verdad', (pdfFactura.length / 1024).toFixed(0) + ' KB');
  const paginas = (pdfFactura.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  ok(paginas === 1, 'y cabe en UNA página', paginas + ' página(s)');
  // EN EL PDF, Y NO SOLO EN LA PANTALLA. Se cuentan las imágenes incrustadas: un papel con logo trae
  // una imagen y uno sin logo, ninguna (medido: 1 vs 0). En la factura hay además el QR, así que se
  // exige que traiga MÁS de una.
  const imgs = pdf => (pdf.toString('latin1').match(/\/Subtype\s*\/Image/g) || []).length;
  const conPdf = [
    ['presupuesto', '/admin/quotes/' + q2.body?.id + '/pdf', 1],
    ['pedido', '/admin/pedidos/' + o2.body?.id + '/pdf', 1],
    ['factura', '/admin/invoices/' + f2.body?.id + '/pdf', 2],
    ['albarán', alb2.body?.id ? '/admin/albaranes/' + alb2.body.id + '/pdf' : null, 1],
    ['orden de compra', po2.body?.id ? '/admin/purchase-orders/' + po2.body.id + '/pdf' : null, 1],
    ['ticket', tk2.body?.id ? '/admin/mostrador/' + tk2.body.id + '/pdf' : null, 2],
  ];
  let pdfConLogo = 0, faltan = [];
  for (const [nom, url, minimo] of conPdf) {
    if (!url) { faltan.push(nom + '(no creado)'); continue; }
    const buf = await pdfDe(url);
    const ni = imgs(buf);
    if (buf.slice(0, 4).toString() === '%PDF' && ni >= minimo) pdfConLogo++;
    else faltan.push(nom + '(' + ni + ' img)');
  }
  ok(pdfConLogo === 6, 'y el logo viaja también DENTRO del PDF, en los SEIS papeles', pdfConLogo + '/6' + (faltan.length ? ' · ' + faltan.join(', ') : ''));
  // Un logo enorme no puede empujar el documento a una segunda página.
  await subirLogo(n, pngDe(4000, 1200), 'enorme.png', 'image/png');
  const f3 = await post('/api/erp/invoices', { client_id: s.cli, issue_date: hoy, lines: linea });
  const pdfEnorme = await pdfDe('/admin/invoices/' + f3.body?.id + '/pdf');
  const pagEnorme = (pdfEnorme.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  ok(pdfEnorme.slice(0, 4).toString() === '%PDF' && pagEnorme === 1,
     'un logo de 4000 px se acota y el documento NO gana una página', pagEnorme + ' página(s)');

  // ── [7] SIN LOGO, TODO SIGUE BIEN ───────────────────────────────────────────────────────────
  console.log('\n[7] sin logo, los papeles se pintan igual de bien');
  const limpio = await negocio('sinlogo');
  const s2 = sembrar(limpio);
  const post2 = async (url, body) => {
    const r = await fetch(limpio.base + url, { method: 'POST', headers: { ...limpio.cab, 'content-type': 'application/json', 'x-csrf-token': 'gdoc-csrf' }, body: JSON.stringify(body) });
    let j = null; try { j = await r.json(); } catch {}
    return j;
  };
  const l2 = [{ product_id: s2.prod, description: 'Servicio Gate', quantity: 1, unit_price: 100, tax_rate: 21 }];
  const fSin = await post2('/api/erp/invoices', { client_id: s2.cli, issue_date: hoy, lines: l2 });
  const htmlSin = await (await fetch(limpio.base + '/admin/invoices/' + fSin?.id, { headers: limpio.cab })).text();
  ok(!htmlSin.includes('data-membrete="logo"'), 'sin logo no se pinta ninguna imagen de membrete');
  ok(!/<img[^>]*src=""/.test(htmlSin), 'y no queda un <img> vacío que el navegador pintaría roto');
  ok(htmlSin.includes('doc-cols') && htmlSin.includes('Emisor'), 'el membrete se pinta igual de bien, con su emisor');

  // ── [18][13] UN NEGOCIO NUNCA VE EL LOGO DE OTRO ────────────────────────────────────────────
  console.log('\n[13][18] el logo del negocio A no aparece en el negocio B');
  const rAjeno = await fetch(limpio.base + '/api/erp/settings/logo/' + LOGO_ID, { headers: limpio.cab });
  ok(rAjeno.status === 404, 'pedir el id del logo del otro negocio da 404: las BD están separadas', 'HTTP ' + rAjeno.status);
  const htmlB = await (await fetch(limpio.base + '/admin/invoices/' + fSin?.id, { headers: limpio.cab })).text();
  ok(!htmlB.includes('data-membrete="logo"'), 'y en sus documentos no asoma ningún logo ajeno');

  // ── [10] LOS IMPORTES NO CAMBIAN ────────────────────────────────────────────────────────────
  console.log('\n[10] ni un importe se ha movido');
  const tot = n.db.prepare('SELECT subtotal, tax_amount, total FROM invoices WHERE id=?').get(f2.body?.id);
  ok(Number(tot.subtotal) === 100 && Number(tot.tax_amount) === 21 && Number(tot.total) === 121,
     'la factura de 100 + 21 % sigue siendo 121: el membrete no toca el cálculo', JSON.stringify(tot));
  const totQ = n.db.prepare('SELECT total FROM quotes WHERE id=?').get(q2.body?.id);
  ok(Number(totQ.total) === 121, 'y el presupuesto, igual', String(totQ.total));

  // ── [11] VERIFACTU, INTACTO ─────────────────────────────────────────────────────────────────
  console.log('\n[11] la huella y el QR de Veri*Factu siguen donde estaban');
  const vf = n.db.prepare('SELECT verifactu_hash, prev_hash FROM invoices WHERE id=?').get(f2.body?.id);
  ok(!!vf.verifactu_hash && vf.verifactu_hash.length >= 32, 'la factura sigue teniendo su huella', (vf.verifactu_hash || '').slice(0, 16) + '…');
  const enc = n.db.prepare("SELECT COUNT(*) n FROM invoices WHERE verifactu_hash IS NULL OR verifactu_hash=''").get().n;
  ok(enc === 0, 'y no hay ninguna factura sin huella: la cadena no se ha roto', enc + ' sin huella');

  // ── [22] CADA PAPEL SIGUE PINTANDO LO SUYO ──────────────────────────────────────────────────
  console.log('\n[22] unificar el estilo NO uniforma el contenido');
  const alb = await post('/api/erp/albaranes', { client_id: s.cli, date: hoy, lines: [{ product_id: s.prod, description: 'Servicio Gate', quantity: 1, unit_price: 100, tax_rate: 21 }] });
  if (!alb.body?.id) console.log('    (albarán: HTTP ' + alb.status + ' · ' + JSON.stringify(alb.body).slice(0, 140) + ')');
  const htmlAlb = alb.body?.id ? (await abre('/admin/albaranes/' + alb.body.id)).html : '';
  const htmlPed = (await abre('/admin/pedidos/' + o2.body?.id)).html;
  const htmlPo = po2.body?.id ? (await abre('/admin/purchase-orders/' + po2.body.id)).html : '';
  ok(htmlPed.includes('cli@t.local'), 'el PEDIDO sigue enseñando el email del cliente');
  ok(htmlAlb ? !htmlAlb.includes('cli@t.local') : false, 'y el ALBARÁN sigue SIN enseñarlo, como antes', htmlAlb ? 'sin email' : 'no se pudo crear el albarán');
  ok(htmlPo ? htmlPo.includes('600000000') : false, 'la ORDEN DE COMPRA sigue enseñando los teléfonos', htmlPo ? 'con teléfono' : 'no se pudo crear');
  ok(htmlAlb ? htmlAlb.includes('Entregar a') : false, 'y el albarán conserva su rótulo propio, «Entregar a»');

  // ── [21] LA ORDEN DE COMPRA DESCARGA PDF ────────────────────────────────────────────────────
  console.log('\n[21] la orden de compra descarga PDF por el mismo camino');
  if (po2.body?.id) {
    const pdfPo = await pdfDe('/admin/purchase-orders/' + po2.body.id + '/pdf');
    ok(pdfPo.slice(0, 4).toString() === '%PDF', 'la orden de compra genera PDF, que era el único papel sin descarga', (pdfPo.length / 1024).toFixed(0) + ' KB');
    const htmlPo2 = (await abre('/admin/purchase-orders/' + po2.body.id)).html;
    ok(htmlPo2.includes('/pdf'), 'y su pantalla ofrece el botón de descarga');
  } else { ok(false, 'la orden de compra genera PDF', 'no se pudo crear la orden'); }

  // ── [12] IMPRESIÓN: CABEN EN SU CAJA ────────────────────────────────────────────────────────
  console.log('\n[12] en pantalla, el papel no se sale de su caja');
  for (const [nom, url] of nuevos) {
    await p.goto(n.base + url, { waitUntil: 'networkidle2' });
    await dormir(400);
    const m = await p.evaluate(() => {
      const d = document.querySelector('.docpaper');
      if (!d) return null;
      return { desborda: d.scrollWidth > d.clientWidth + 1,
               logoAncho: (() => { const i = d.querySelector('img[data-membrete="logo"]'); return i ? Math.round(i.getBoundingClientRect().width) : 0; })() };
    });
    ok(m && !m.desborda, nom + ': el contenido no se sale del papel');
    if (m && m.logoAncho) ok(m.logoAncho <= 200, nom + ': el logo va acotado', m.logoAncho + 'px');
  }
  ok(errs.length === 0, 'cero errores de consola', errs.slice(0, 2).join(' | '));

} catch (e) {
  fail++;
  console.error('\n✗ EXCEPCIÓN: ' + (e && e.stack || e));
} finally {
  try { if (b) await b.close(); } catch {}
  for (const sl of creados) { try { borrarTenant(sl); } catch {} }
  console.log('\n──────────────────────────────────────────────');
  console.log((fail === 0 ? '✓ GATE VERDE' : '✗ GATE ROJO') + ' — ' + pass + ' pasan · ' + fail + ' fallan');
  // Y EL MISMO VEREDICTO EN EL IDIOMA DEL RUNNER. `run-gates.mjs` decide PASA/SOSPECHOSO buscando un
  // resumen reconocible ("N OK", "PASS: n", "N comprobaciones"): un gate que sale 0 pero no dice
  // cuántas aserciones corrió lo marca SOSPECHOSO y **cuenta como no-pasa**. La línea de arriba, que
  // me inventé, no casaba con ninguno — así que este gate iba verde por su cuenta y el barrido lo
  // daba por no-pasado. Lo destapó el barrido del 21 ago: los CUATRO gates nuevos, los cuatro míos,
  // salían SOSPECHOSOS por esto. Es la hermana del fallo de estar fuera de GRUPOS: allí no lo
  // ejecutaba nadie, aquí sí lo ejecuta pero no sabe leer lo que contesta.
  console.log(pass + ' OK · ' + fail + ' fallos');
  process.exit(fail === 0 ? 0 : 1);
}
