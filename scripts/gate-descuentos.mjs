// GATE DEL PUNTO 11 — descuentos, promociones y bonos, rehechos enteros.
//   node scripts/gate-descuentos.mjs
//
// LO QUE HAY QUE PROBAR AQUÍ, y por qué es delicado: un descuento cambia lo que se FACTURA. Así que
// no basta con que la pantalla enseñe un número bonito: hay que comprobar que el IVA baja en la
// proporción correcta, que un descuento de importe fijo no deja la base en negativo, que una
// promoción con código NO se aplica sola, y que nada de esto toca el sello de la factura.
//
// LA DECISIÓN QUE SE MIDE UNA Y OTRA VEZ: **el motor propone, el usuario confirma**. Ningún
// descuento entra solo en un documento.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import path from 'path';
import fs from 'fs';
import { tenantDb, launchOpts } from './lib/gate-env.mjs';
import { proponer, guardarPromocion, archivarPromocion, listarPromociones, promocionVigente,
         crearBono, consumirBono, deshacerConsumo, bonosDe, consumosDe } from '../modules/erp/descuentos.js';
import { herramientasDeDescuentos } from '../modules/disa/informes.js';
import { computeTotals } from '../modules/erp/routes/invoices.js';

const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
const SLUG = 'desarrollo-bamburu';
const HOST = SLUG + '.bamburu.com', BASE = 'https://' + HOST;
const RID = randomBytes(3).toString('hex');
const MARCA = 'GDT-' + RID;
const TOKEN_PREFIJO = 'gate-dto-';
const dormir = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m, det) => { if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ ' + m + (det ? ' · ' + det : '')); } };

const db = new Database(tenantDb(SLUG));
db.pragma('busy_timeout = 10000');
const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
const tok = TOKEN_PREFIJO + randomBytes(20).toString('hex');
const ahora = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(tok, owner.id, ahora, ahora + 3600, randomBytes(20).toString('hex'));

let browser = null, tenantPrueba = null;
try {
  const hoy = new Date().toISOString().slice(0, 10);
  const cli = db.prepare("INSERT INTO clients (name, client_type, active, descuento_pct) VALUES (?,'empresa',1,10)")
    .run(MARCA + ' Cliente').lastInsertRowid;
  const cat = db.prepare("INSERT INTO categories (name) VALUES (?)").run(MARCA + " Cat").lastInsertRowid;
  const prodEnCat = db.prepare("INSERT INTO products (name, slug, price, stock, status, type, tax_rate, tax_band, category_id) VALUES (?,?,50,10,'active','service',21,'general',?)")
    .run(MARCA + ' Servicio', MARCA.toLowerCase() + '-s', cat).lastInsertRowid;

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] LOS TRES CUPONES ARCHIVADOS VUELVEN — y vuelven APAGADOS');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const recuperados = listarPromociones(db).filter(p => ['BIENVENIDA10', 'VERANO2026', 'FIJO5'].includes(p.nombre));
  ok(recuperados.length === 3, 'los tres cupones de la tienda vieja están como promociones',
     recuperados.map(p => p.nombre).join(', '));
  ok(recuperados.every(p => !p.activa), '  y NACEN APAGADOS: recuperar no es encender');
  ok(recuperados.find(p => p.nombre === 'FIJO5').tipo === 'importe', '  con su tipo bien traducido (fixed → importe)');
  ok(recuperados.every(p => p.codigo), '  y conservan su código, que es lo que eran');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] EL MOTOR — y lo que más importa: que el IVA baje en la proporción correcta');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const lineas = [
    { description: 'Al 21', quantity: 1, unit_price: 100, tax_rate: 21 },
    { description: 'Al 10', quantity: 1, unit_price: 50, tax_rate: 10 },
  ];
  const r1 = proponer(db, { clientId: cli, lineas });
  ok(r1.propuestas.length === 1 && r1.propuestas[0].origen === 'cliente',
     'el descuento fijo del cliente se propone', r1.propuestas[0]?.motivo);
  ok(r1.lineas.length === 2, '  y se parte en DOS líneas, una por tipo de IVA', r1.lineas.map(l => l.tax_rate + '%').join(' + '));
  const suma = Math.round(r1.lineas.reduce((s, l) => s + l.unit_price, 0) * 100) / 100;
  ok(suma === -15, '  que suman exactamente el 10 % de 150', suma + ' €');
  const l21 = r1.lineas.find(l => l.tax_rate === 21), l10 = r1.lineas.find(l => l.tax_rate === 10);
  ok(l21.unit_price === -10 && l10.unit_price === -5,
     '  y cada una en su tipo, en proporción a su base (no todo al tipo más alto, que rebajaría de más)',
     l21.unit_price + ' al 21 % · ' + l10.unit_price + ' al 10 %');
  // EL CONTROL DE VERDAD: el motor fiscal que ya existía suma bien esas líneas.
  const sinDto = computeTotals(lineas, 0);
  const conDto = computeTotals([...lineas, ...r1.lineas], 0);
  ok(conDto.subtotal === 135, 'CONTROL · el motor fiscal de siempre da la base rebajada', conDto.subtotal + ' €');
  ok(Math.abs(conDto.taxAmount - (sinDto.taxAmount * 0.9)) < 0.01,
     '  y el IVA baja EXACTAMENTE un 10 %, que es de lo que iba el descuento',
     sinDto.taxAmount + ' → ' + conDto.taxAmount);
  ok(conDto.total < sinDto.total, '  y el total, claro', sinDto.total + ' → ' + conDto.total);

  console.log('\n[3] LAS PROMOCIONES — fechas, códigos, alcance y mínimos');
  const pVigente = guardarPromocion(db, { nombre: MARCA + ' vigente', tipo: 'porcentaje', valor: 5, activa: 1 });
  const pCaducada = guardarPromocion(db, { nombre: MARCA + ' caducada', tipo: 'porcentaje', valor: 50, activa: 1, hasta: '2020-01-01' });
  const pConCodigo = guardarPromocion(db, { nombre: MARCA + ' con codigo', codigo: MARCA, tipo: 'porcentaje', valor: 20, activa: 1 });
  const pApagada = guardarPromocion(db, { nombre: MARCA + ' apagada', tipo: 'porcentaje', valor: 30, activa: 0 });
  const pMinimo = guardarPromocion(db, { nombre: MARCA + ' minimo', tipo: 'porcentaje', valor: 25, activa: 1, minimo: 1000 });
  const nombres = r => r.propuestas.map(p => p.nombre);
  const r2 = proponer(db, { clientId: null, lineas });
  ok(nombres(r2).includes(MARCA + ' vigente'), 'una promoción vigente se propone');
  ok(!nombres(r2).includes(MARCA + ' caducada'), '  y una caducada NO');
  ok(!nombres(r2).includes(MARCA + ' apagada'), '  ni una apagada');
  ok(!nombres(r2).includes(MARCA + ' minimo'), '  ni una que pide un mínimo que el documento no llega');
  ok(!nombres(r2).includes(MARCA + ' con codigo'),
     'y una promoción CON CÓDIGO no se aplica sola — si lo hiciera, no sería un código, sería una rebaja');
  const r3 = proponer(db, { clientId: null, lineas, codigo: MARCA });
  ok(nombres(r3).includes(MARCA + ' con codigo'), '  pero escribiendo el código, sí');
  ok(!nombres(r3).includes(MARCA.toLowerCase() + 'X'), '  y un código que no existe no cuela nada');
  ok(proponer(db, { clientId: null, lineas, codigo: 'noexiste' }).propuestas.every(p => !p.nombre.includes('codigo')),
     '  ni uno equivocado');

  // ALCANCE: una promoción de categoría solo toca las líneas de esa categoría.
  const pCat = guardarPromocion(db, { nombre: MARCA + ' cat', tipo: 'porcentaje', valor: 50, activa: 1,
                                      alcance: 'categoria', categoria_id: cat });
  const conProducto = [{ description: 'Suyo', quantity: 1, unit_price: 100, tax_rate: 21, product_id: prodEnCat },
                       { description: 'Ajeno', quantity: 1, unit_price: 100, tax_rate: 21, product_id: null }];
  const r4 = proponer(db, { clientId: null, lineas: conProducto });
  const dtoCat = r4.propuestas.find(p => p.nombre === MARCA + ' cat');
  ok(dtoCat && dtoCat.importe === 50, 'una promoción de CATEGORÍA solo descuenta sobre lo de esa categoría',
     'sobre 100 de 200 → ' + (dtoCat && dtoCat.importe));

  // IMPORTE FIJO: nunca puede dejar la base en negativo.
  const pGorda = guardarPromocion(db, { nombre: MARCA + ' gorda', tipo: 'importe', valor: 99999, activa: 1 });
  const r5 = proponer(db, { clientId: null, lineas: [{ description: 'X', quantity: 1, unit_price: 30, tax_rate: 21 }] });
  const gorda = r5.propuestas.find(p => p.nombre === MARCA + ' gorda');
  ok(gorda && gorda.importe === 30, 'un descuento fijo enorme se recorta a la base: nunca deja el total en negativo',
     'pedía 99999, resta ' + (gorda && gorda.importe));
  archivarPromocion(db, pGorda.id);
  // Y un porcentaje mayor que 100 no se puede ni guardar.
  let msgPct = '';
  try { guardarPromocion(db, { nombre: MARCA + ' imposible', tipo: 'porcentaje', valor: 150 }); }
  catch (e) { msgPct = e.message; }
  ok(/100/.test(msgPct), 'y un porcentaje mayor que 100 se rechaza al guardarlo', msgPct);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] LOS BONOS — un talonario que baja, y que deja rastro');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const facturasAntes = db.prepare('SELECT COUNT(*) n FROM invoices').get().n;
  const bono = crearBono(db, { client_id: cli, nombre: MARCA + ' bono 3', sesiones: 3, importe: 90 });
  ok(bonosDe(db, cli).some(b => b.id === bono.id), 'se crea el bono');
  consumirBono(db, bono.id, { nota: 'primera' });
  const b1 = bonosDe(db, cli).find(b => b.id === bono.id);
  ok(b1.usadas === 1 && b1.quedan === 2, 'consumir baja el contador', b1.usadas + ' usadas · ' + b1.quedan + ' quedan');
  ok(consumosDe(db, bono.id).length === 1, '  y queda apuntado: un contador que baja sin rastro no se lo cree nadie');
  ok(db.prepare('SELECT COUNT(*) n FROM invoices').get().n === facturasAntes,
     'CONSUMIR NO EMITE FACTURA — el ingreso se declaró al vender el bono', facturasAntes + ' facturas antes y después');
  consumirBono(db, bono.id, { sesiones: 2 });
  let msgAgotado = '';
  try { consumirBono(db, bono.id); } catch (e) { msgAgotado = e.message; }
  ok(/queda|quedan/.test(msgAgotado), 'agotado, no se puede usar más, y se dice cuántas quedaban', msgAgotado);
  // Deshacer devuelve la sesión.
  const cs = consumosDe(db, bono.id);
  deshacerConsumo(db, cs[0].id);
  const b2 = bonosDe(db, cli).find(b => b.id === bono.id);
  ok(b2.quedan === 2, 'deshacer un consumo le devuelve al cliente lo que pagó', b2.quedan + ' quedan');
  // Caducado.
  const bCad = crearBono(db, { client_id: cli, nombre: MARCA + ' caducado', sesiones: 5, caduca: '2020-01-01' });
  let msgCad = '';
  try { consumirBono(db, bCad.id); } catch (e) { msgCad = e.message; }
  ok(/caduc/i.test(msgCad), 'y un bono caducado no se puede usar', msgCad);
  ok(!bonosDe(db, cli, { soloVivos: true }).some(b => b.id === bCad.id), '  ni se ofrece como vivo');

  console.log('\n[5] DISA LEE Y PROPONE, PERO NO APLICA');
  const dtoDisa = herramientasDeDescuentos(db, { hasPerm: () => true });
  const vistaDisa = dtoDisa.ver({ client_id: cli });
  ok(vistaDisa.cliente && vistaDisa.cliente.descuento_fijo_pct === 10, 'DISA sabe el descuento fijo del cliente');
  ok((vistaDisa.bonos || []).length >= 1, '  y sus bonos vivos', (vistaDisa.bonos || []).length + '');
  ok(/no se descuenta de la factura/i.test(vistaDisa.nota_bonos || ''),
     '  y avisa de que un bono no rebaja la factura, que es el malentendido fácil');
  const calc = dtoDisa.calcular({ client_id: cli, importe: 200 });
  ok(calc.descuento_total > 0 && /Descuentos…|factura/i.test(calc.nota || ''),
     'calcula, y dice que aplicarlo se hace en la pantalla', calc.descuento_total + ' € · ' + (calc.enlace || ''));
  const promsAntes = db.prepare('SELECT COUNT(*) n FROM promociones').get().n;
  const bonosAntes = db.prepare('SELECT COUNT(*) n FROM bonos').get().n;
  dtoDisa.ver({ client_id: cli }); dtoDisa.calcular({ client_id: cli, importe: 500 });
  ok(db.prepare('SELECT COUNT(*) n FROM promociones').get().n === promsAntes
     && db.prepare('SELECT COUNT(*) n FROM bonos').get().n === bonosAntes, '  y no ha escrito nada');
  ok(!!herramientasDeDescuentos(db, { hasPerm: () => false }).ver().error,
     'y sin permiso de facturas, no ve nada');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[6] EN LA PANTALLA, PULSANDO — el descuento entra en la factura y el total baja');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  browser = await puppeteer.launch(launchOpts());
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 1200 });
  await page.setCookie({ name: 'asess', value: tok, domain: HOST, path: '/', secure: true });
  const errores = [];
  page.on('pageerror', e => errores.push(String(e && e.message || e)));
  page.on('dialog', async d => { errores.push('VENTANITA: ' + d.type()); await d.dismiss(); });

  await page.goto(BASE + '/admin/descuentos', { waitUntil: 'networkidle0' });
  await dormir(1400);
  const pantalla = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  ok(/Descuentos, promociones y bonos/.test(pantalla), 'la pantalla existe y se abre');
  ok(/BIENVENIDA10/.test(pantalla), '  con los cupones recuperados a la vista');
  ok(new RegExp(MARCA + ' bono 3').test(pantalla), '  y los bonos');

  await page.goto(BASE + '/admin/invoices/new', { waitUntil: 'networkidle0' });
  await dormir(1800);
  await page.evaluate(id => { const s = document.getElementById('f-client');
    const o = [...s.options].find(x => Number(x.value) === id); if (o) { s.value = o.value; s.dispatchEvent(new Event('change')); } }, cli);
  await dormir(600);
  await page.evaluate(() => { const r = document.querySelector('#lines-body tr');
    r.querySelector('.line-desc').value = 'Trabajo';
    r.querySelector('.line-qty').value = '1';
    r.querySelector('.line-price').value = '100';
    r.querySelector('.line-price').dispatchEvent(new Event('input'));
  });
  await dormir(1000);
  const antesTotal = await page.evaluate(() => (document.getElementById('t-total') || document.querySelector('[id*="total"]') || {}).textContent || '');
  await page.click('#btnDto');
  await dormir(1600);
  const panel = await page.evaluate(() => { const o = document.querySelector('.modal-overlay.open');
    return o ? { titulo: (o.querySelector('h3') || {}).textContent, casillas: o.querySelectorAll('input[type=checkbox]').length,
                 texto: o.innerText.replace(/\s+/g, ' ') } : null; });
  ok(!!panel && /Descuentos que puedo aplicar/.test(panel.titulo || ''),
     'al pulsar «Descuentos…» sale un panel con lo que toca', panel && panel.titulo);
  ok(panel && panel.casillas >= 1, '  con una casilla por descuento, SIN marcar (nada entra solo)', panel && panel.casillas + '');
  ok(panel && /10 %/.test(panel.texto), '  y el descuento del cliente entre ellos');
  const lineasAntes = await page.evaluate(() => document.querySelectorAll('#lines-body tr').length);
  // EL USUARIO DICE QUE NO: cancelar no puede añadir nada.
  await page.evaluate(() => { const b = [...document.querySelectorAll('.modal-overlay.open .modal-foot button')].find(x => /Cancelar/i.test(x.textContent)); if (b) b.click(); });
  await dormir(700);
  ok(await page.evaluate(() => document.querySelectorAll('#lines-body tr').length) === lineasAntes,
     'y si se cancela, no se añade NADA', lineasAntes + ' líneas');
  // Y ahora que sí.
  await page.click('#btnDto'); await dormir(1500);
  await page.evaluate(() => { const c = document.querySelector('.modal-overlay.open input[type=checkbox]'); if (c) { c.checked = true; c.dispatchEvent(new Event('change')); } });
  await page.evaluate(() => { const b = [...document.querySelectorAll('.modal-overlay.open .modal-foot button')].find(x => /Añadir/i.test(x.textContent)); if (b) b.click(); });
  await dormir(1500);
  const tras = await page.evaluate(() => ({
    lineas: [...document.querySelectorAll('#lines-body tr')].map(r => ({
      d: r.querySelector('.line-desc')?.value || '', p: Number(r.querySelector('.line-price')?.value || 0) })),
    texto: document.body.innerText.replace(/\s+/g, ' '),
  }));
  ok(tras.lineas.length === lineasAntes + 1, 'marcándolo, la línea de descuento entra', tras.lineas.length + ' líneas');
  const lineaDto = tras.lineas.find(l => l.p < 0);
  ok(!!lineaDto && lineaDto.p === -10, '  con importe NEGATIVO y por su valor', JSON.stringify(lineaDto));
  ok(/Descuento de cliente/.test(lineaDto?.d || ''), '  y con su nombre, para que el cliente lo lea en el papel', lineaDto?.d);
  // LO QUE LA CAPTURA DESTAPÓ, y por eso ahora es una aserción: la línea estaba puesta y el TOTAL no
  // se movía. El esquema rechazaba el precio negativo y el preview fallaba EN SILENCIO. Un total que
  // no cuadra con sus propias líneas es peor que un error.
  await dormir(1400);
  // LAS CIFRAS SE LEEN Y SE COMPARAN COMO NÚMEROS, no como texto. Desde el 24 ago 2026 la pantalla
  // escribe el dinero como en España («90,00 €», no «€90.00»), y estas dos aserciones comparaban
  // contra la cadena literal: se pusieron rojas por un cambio que era justo el que se pedía. Lo que
  // importa es el NÚMERO, así que se normaliza (quitar los puntos de millar, la coma decimal a punto)
  // y se compara con tolerancia de céntimo. Así vale escriba el producto como escriba.
  const tot = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, ' ');
    const num = s => {
      if (!s) return null;
      const n = Number(String(s).replace(/\./g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    };
    const base = num((t.match(/Base imponible\s*€?\s*([\d.,]+)/) || [])[1]);
    const total = num((t.match(/Total\s*€?\s*([\d.,]+)/) || [])[1]);
    return { base, total, aviso: !!document.getElementById('totales-aviso') };
  });
  ok(tot.base !== null && Math.abs(tot.base - 90) < 0.005, 'y el TOTAL se entera: la base baja de 100 a 90', 'base ' + tot.base);
  ok(tot.total !== null && Math.abs(tot.total - 108.90) < 0.005, '  y el total con IVA, de 121,00 a 108,90 (el IVA baja en proporción)', 'total ' + tot.total);
  ok(!tot.aviso, '  y sin ningún aviso de que no se pudo calcular');
  ok(errores.length === 0, 'sin errores de JavaScript ni ventanitas', errores.join(' | ') || 'ninguno');
  await page.screenshot({ path: path.join(process.env.HOME || '/home/ubuntu', 'informes-shots', 'punto11-descuentos.png') });

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[7] LA PRUEBA QUE IMPORTA: emitir una factura DE VERDAD con descuento');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // EN UN NEGOCIO PROPIO, Y SE DICE POR QUÉ: una factura emitida entra en la cadena de VERI*FACTU y
  // ya NO SE PUEDE BORRAR. Emitirla en el negocio de desarrollo sería dejar basura imborrable, que
  // es la lección que costó 130 clientes archivados el 23 de agosto. Así que este trozo se trae su
  // propio negocio y lo borra entero al terminar.
  {
    const { provisionTenant } = await import('../core/tenant-provisioning.js');
    const ts = Date.now().toString(36);
    const t = await provisionTenant({ businessName: MARCA + ' SL', ownerName: 'Dueño',
      email: 'gdt-' + ts + '@t.local', password: 'contrasena-larga-123', country: 'ES', sector: 'otros' });
    tenantPrueba = t;
    const d2 = new Database(path.join(RAIZ, t.db_filename));
    try {
      const c2 = d2.prepare("INSERT INTO clients (name, client_type, active, descuento_pct) VALUES ('Cliente','empresa',1,10)").run().lastInsertRowid;
      const { createInvoice } = await import('../modules/erp/routes/invoices.js');
      const base = [{ description: 'Trabajo', quantity: 1, unit_price: 100, tax_rate: 21 }];
      const dto = proponer(d2, { clientId: c2, lineas: base });
      const inv = createInvoice(d2, { client_id: c2, lines: [...base, ...dto.lineas], issue_date: hoy });
      const guardada = d2.prepare('SELECT * FROM invoices WHERE id=?').get(inv.id);
      ok(!!guardada, 'una factura CON descuento se emite de verdad', guardada && guardada.invoice_number);
      ok(Math.abs(guardada.subtotal - 90) < 0.01, '  con la base ya rebajada', guardada.subtotal + ' €');
      ok(Math.abs(guardada.total - 108.9) < 0.01, '  y el total con el IVA proporcional', guardada.total + ' €');
      ok(d2.prepare('SELECT COUNT(*) n FROM invoice_items WHERE invoice_id=?').get(inv.id).n === 2,
         '  y la línea de descuento QUEDA GUARDADA: el cliente la lee en el papel');
      // Y la cadena propietaria del negocio nuevo sigue cuadrando con ella dentro.
      const { verifyTenantInvoices } = await import('../modules/superadmin/integridad.js');
      const integ = verifyTenantInvoices(path.join(RAIZ, t.db_filename));
      ok(integ.ok, '  y la cadena de huellas cuadra con la factura descontada dentro',
         integ.total + ' factura(s)' + (integ.alarm ? ' · ' + integ.alarm.reason : ''));
      // Un documento que se iría a negativo NO se emite.
      let msgNeg = '';
      try { createInvoice(d2, { client_id: c2, lines: [{ description: 'X', quantity: 1, unit_price: 10, tax_rate: 21 },
                                                        { description: 'Dto', quantity: 1, unit_price: -50, tax_rate: 21 }], issue_date: hoy }); }
      catch (e) { msgNeg = e.message; }
      ok(/negativo|rectificativa/i.test(msgNeg), 'y una factura que saldría en negativo se para, con su motivo', msgNeg.slice(0, 80));
    } finally { try { d2.close(); } catch {} }
  }

  console.log('\n[8] LO QUE NO SE HA ROTO');
  const sinNada = proponer(db, { clientId: null, lineas: [{ description: 'X', quantity: 1, unit_price: 10, tax_rate: 21 }], codigo: '' });
  ok(Array.isArray(sinNada.lineas), 'proponer sin cliente y sin promociones no revienta');
  for (const ruta of ['/admin/invoices', '/admin/clients', '/admin/quotes']) {
    const r = await fetch(BASE + ruta, { headers: { cookie: 'asess=' + tok } });
    ok(r.status === 200, '  ' + ruta + ' sigue respondiendo', 'got ' + r.status);
  }

} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN: ' + e.message + '\n' + e.stack);
} finally {
  try { if (browser) await browser.close(); } catch {}
  try {
    db.prepare("DELETE FROM bono_consumos WHERE bono_id IN (SELECT id FROM bonos WHERE nombre LIKE 'GDT-%')").run();
    db.prepare("DELETE FROM bonos WHERE nombre LIKE 'GDT-%'").run();
    db.prepare("DELETE FROM promociones WHERE nombre LIKE 'GDT-%'").run();
    db.prepare("DELETE FROM products WHERE name LIKE 'GDT-%'").run();
    db.prepare("DELETE FROM categories WHERE name LIKE 'GDT-%'").run();
    db.prepare("DELETE FROM clients WHERE name LIKE 'GDT-%'").run();
    db.prepare("DELETE FROM admin_sessions WHERE token LIKE '" + TOKEN_PREFIJO + "%'").run();
  } catch (e) { console.error('  (limpieza incompleta: ' + e.message + ')'); }
  // El negocio de prueba se va ENTERO: fichero, WAL y su fila en la base de control. Una factura
  // emitida no se puede borrar, así que lo que se borra es el negocio que la contenía.
  try {
    if (tenantPrueba) {
      const { controlDb } = await import('../core/control-db.js');
      const fila = controlDb.prepare('SELECT id FROM tenants WHERE slug=?').get(tenantPrueba.slug);
      if (fila) { controlDb.prepare('DELETE FROM tenant_sessions WHERE tenant_id=?').run(fila.id);
                  controlDb.prepare('DELETE FROM tenants WHERE id=?').run(fila.id); }
      for (const suf of ['', '-wal', '-shm']) { try { fs.rmSync(path.join(RAIZ, tenantPrueba.db_filename) + suf, { force: true }); } catch {} }
      console.log('  · negocio de prueba borrado entero: ' + tenantPrueba.slug);
    }
  } catch (e) { console.error('  (no se pudo borrar el negocio de prueba: ' + e.message + ')'); }
  try { db.close(); } catch {}
}

console.log(`\n${'─'.repeat(70)}\nRESULTADO: ${pass} ✓  ·  ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
