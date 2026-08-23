// GATE DEL PUNTO 9 — «¿qué productos llevo tiempo sin vender?», la pregunta doce.
//   node scripts/gate-productos-parados.mjs
//
// LO QUE HACÍA IMPOSIBLE LA PREGUNTA, y por qué hay un área nueva. El área de Inventario tiene como
// fila un MOVIMIENTO de almacén: un producto que nunca se ha movido **no produce fila**, así que no
// puede salir en ningún gráfico — y justo esos son la respuesta. El área de Catálogo parte del
// PRODUCTO y le cuelga las ventas, así que un parado sale con cero, que es un dato y no un hueco.
//
// EL GATE SE TRAE SUS PROPIOS PRODUCTOS, uno por cada caso que la pregunta tiene que distinguir:
// vendido ahora, vendido hace mucho, y nunca vendido. Sin eso dependería de cómo esté el catálogo
// del negocio ese día, que es la precondición ajena que ya costó la TAREA 1 entera.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes, createHash } from 'crypto';
import path from 'path';
import { tenantDb, launchOpts } from './lib/gate-env.mjs';
import { cruzar, camposPara, AREAS } from '../modules/erp/constructor-analitica.js';

const SLUG = 'desarrollo-bamburu';
const HOST = SLUG + '.bamburu.com', BASE = 'https://' + HOST;
const RID = randomBytes(3).toString('hex');
const MARCA = 'GPP-' + RID;
const TOKEN_PREFIJO = 'gate-parados-';
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

let browser = null;
try {
  const hoy = new Date();
  const iso = d => d.toISOString().slice(0, 10);
  const haceDias = n => iso(new Date(hoy.getTime() - n * 86400000));

  // Tres productos: uno vendido esta semana, uno vendido hace 200 días, y uno nunca vendido.
  const prod = (nombre, stock, coste) => db.prepare(
    "INSERT INTO products (name, slug, price, stock, status, type, tax_rate, tax_band, average_cost) VALUES (?,?,?,?, 'active','physical',21,'general',?)"
  ).run(MARCA + ' ' + nombre, (MARCA + '-' + nombre).toLowerCase(), 10, stock, coste).lastInsertRowid;
  const pReciente = prod('Reciente', 5, 2);
  const pViejo    = prod('Viejo', 10, 3);
  const pNunca    = prod('Nunca', 7, 4);

  // Y sus facturas, encadenadas en la cadena propietaria como cualquier otra (misma lección del
  // punto 3: una factura con el sello en blanco deja la pantalla de Integridad en ALARMA).
  const CIF = '89890001K';
  const hashDe = (num, fecha, total, prev) =>
    createHash('sha256').update([num, fecha, CIF, '', total.toFixed(2), prev].join('|')).digest('hex');
  const seqBase = db.prepare("SELECT COALESCE(MAX(sequence),0) s FROM invoices WHERE series='GPPP'").get().s;
  let prev = '', n = 0;
  const factura = (fecha, productId, uds) => {
    n++;
    const num = MARCA + '-' + n, base = 10 * uds, total = Math.round(base * 1.21 * 100) / 100;
    const h = hashDe(num, fecha, total, prev);
    const id = db.prepare(
      `INSERT INTO invoices (invoice_number,series,year,sequence,issue_date,company_name,company_fiscal_id,
         client_name,subtotal,tax_amount,total,status,record_type,verifactu_hash,prev_hash,currency_symbol)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'emitida','alta',?,?,'€')`
    ).run(num, 'GPPP', Number(fecha.slice(0, 4)), seqBase + n, fecha, MARCA + ' SL', CIF, MARCA + ' Cliente',
          base, Math.round(base * 0.21 * 100) / 100, total, h, prev).lastInsertRowid;
    prev = h;
    db.prepare("INSERT INTO invoice_items (invoice_id,description,quantity,unit_price,total_price,product_id) VALUES (?,?,?,?,?,?)")
      .run(id, MARCA + ' línea', uds, 10, base, productId);
    return id;
  };
  factura(haceDias(3), pReciente, 4);
  factura(haceDias(200), pViejo, 2);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] EL ÁREA PARTE DEL PRODUCTO, no del movimiento');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  ok(!!AREAS.catalogo, 'existe el área de Catálogo');
  const filas = AREAS.catalogo.filas(db, { from: haceDias(365), to: iso(hoy) });
  const mio = nombre => filas.find(f => f.producto === MARCA + ' ' + nombre);
  ok(!!mio('Nunca'), 'UN PRODUCTO SIN NINGÚN MOVIMIENTO PRODUCE FILA — que es todo el cambio');
  ok(mio('Nunca').dias_sin_vender === null && mio('Nunca').uds_periodo === 0,
     '  con cero unidades y sin fecha de última venta (no se le inventa una)');
  ok(mio('Reciente').uds_periodo === 4, 'el vendido hace tres días trae sus unidades del periodo', mio('Reciente').uds_periodo);
  ok(mio('Viejo').dias_sin_vender >= 195 && mio('Viejo').dias_sin_vender <= 205,
     'y el vendido hace 200 días trae sus días sin venderse', mio('Viejo').dias_sin_vender + ' días');

  console.log('\n[2] LOS TRAMOS SEPARAN LO QUE HAY QUE SEPARAR');
  const r = cruzar(db, { area: 'catalogo', dimension: 'parado', medidas: ['productos', 'valor_stock'],
                         rango: '12m', hasPerm: () => true, limit: 50 });
  const g = Object.fromEntries(r.filas.map(f => [f.clave, f]));
  ok(!!g['Vendido en el periodo'], 'hay grupo «vendido en el periodo»');
  ok(!!g['No se ha vendido nunca'], 'y grupo «no se ha vendido NUNCA», aparte de los demás');
  ok(g['No se ha vendido nunca'].productos > 0, '  con productos dentro', g['No se ha vendido nunca'].productos + '');
  // «Nunca» y «más de un año» son cosas distintas y no se mezclan: juntarlas escondería la peor.
  const clavesConVenta = Object.keys(g).filter(k => /^Sin vender/.test(k));
  ok(!Object.keys(g).some(k => /nunca/i.test(k) && /año/i.test(k)),
     'y «nunca» no se disfraza de «más de un año»', clavesConVenta.join(' · ') || '(sin tramos intermedios hoy)');
  ok(g['No se ha vendido nunca'].valor_stock > 0,
     'la pregunta que sigue tiene respuesta: cuánto dinero hay quieto ahí', g['No se ha vendido nunca'].valor_stock + ' €');

  console.log('\n[3] LO QUE NO SE INVENTA');
  // La media de días NO puede incluir a los que nunca se vendieron: no tienen días que promediar.
  // Se piden DOS medidas a propósito: con `dias_medios` sola, el grupo «nunca» no tiene ningún valor
  // que pintar y el constructor lo filtra como grupo vacío (norma de la D-ter). Con una medida que
  // sí tiene valor, el grupo sale y se puede comprobar lo que importa: que su media es «—».
  const conDias = cruzar(db, { area: 'catalogo', dimension: 'parado', medidas: ['productos', 'dias_medios'],
                               rango: '12m', hasPerm: () => true });
  const fNunca = conDias.filas.find(f => f.clave === 'No se ha vendido nunca');
  ok(fNunca && fNunca.dias_medios === null,
     'la media de días de los que NUNCA se vendieron es «—», no un cero fingido', String(fNunca && fNunca.dias_medios));
  ok(fNunca && fNunca.productos > 0, '  y aun así el grupo se pinta, porque tiene otra cifra que sí dice algo');
  const soloDias = cruzar(db, { area: 'catalogo', dimension: 'parado', medidas: ['dias_medios'],
                                rango: '12m', hasPerm: () => true });
  ok(!soloDias.filas.some(f => f.clave === 'No se ha vendido nunca') && soloDias.gruposVacios >= 1,
     '  y pidiendo SOLO la media, el grupo sin nada que pintar se retira y se CUENTA',
     soloDias.gruposVacios + ' grupo(s) vacío(s)');
  // Y repartir «nº de productos» por «Producto» daría un 1 en cada grupo: se explica, no se contesta.
  let msg = '';
  try { cruzar(db, { area: 'catalogo', dimension: 'producto', medidas: ['productos'], rango: '12m', hasPerm: () => true }); }
  catch (e) { msg = e.message; }
  ok(/un 1 en cada grupo/.test(msg), 'y «nº de productos» por «Producto» se explica en vez de contestarse', msg.slice(0, 70));
  // El candado: quien no ve facturas no ve lo facturado.
  const campos = camposPara(p => p !== 'invoices.read', 'catalogo');
  ok(!campos.medidas.importe && !campos.medidas.uds_vendidas,
     'sin permiso de facturas no se ofrecen las medidas de venta', Object.keys(campos.medidas).join(','));
  ok(!!campos.medidas.productos, '  pero sí las que solo miran el catálogo');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] EN LA PANTALLA — la pregunta 12 vuelve al catálogo, y se PULSA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  browser = await puppeteer.launch(launchOpts());
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
  await page.setCookie({ name: 'asess', value: tok, domain: HOST, path: '/', secure: true });
  const errores = [];
  page.on('pageerror', e => errores.push(String(e && e.message || e)));
  page.on('dialog', async d => { errores.push('VENTANITA: ' + d.type()); await d.dismiss(); });
  await page.goto(BASE + '/admin/analytics', { waitUntil: 'networkidle0' });
  await dormir(1500);
  const texto = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  ok(/llevo tiempo sin vender/i.test(texto), 'la pregunta 12 está en la lista de preguntas frecuentes');
  ok(/dinero tengo parado/i.test(texto), '  y la que la sigue: cuánto dinero hay quieto ahí');
  // Se PULSA la pregunta, que es como la usa el dueño.
  // El botón real es el que lleva `data-preg`: es el que tiene el manejador. Buscar «el elemento que
  // contiene el texto» pulsaba un contenedor y no pasaba nada — el gate medía su propio despiste.
  const pulsada = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-preg]')].find(e => /llevo tiempo sin vender/i.test(e.textContent || ''));
    if (!el) return false; el.click(); return true;
  });
  ok(pulsada, 'y se puede pulsar');
  await dormir(2500);
  const tras = await page.evaluate(() => ({
    area: (document.getElementById('cArea') || {}).value,
    dim: (document.getElementById('cDim') || {}).value,
    texto: document.body.innerText.replace(/\s+/g, ' '),
  }));
  ok(tras.area === 'catalogo' && tras.dim === 'parado',
     '  y deja el constructor puesto en la receta de la pregunta', tras.area + '/' + tras.dim);
  // EL QUESITO PINTA SU LEYENDA DENTRO DEL LIENZO, así que el texto de la página no la lleva: se
  // comprueba que el lienzo tiene PÍXELES pintados (no un cuadro en blanco) y, además, se cambia a
  // tabla para leer los grupos. Buscar el texto en el HTML habría dado un rojo sobre un gráfico
  // correcto — el gate midiendo donde no está la respuesta.
  const lienzo = await page.evaluate(() => {
    const c = document.querySelector('#cChartWrap canvas'); if (!c) return null;
    const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height).data;
    let pintados = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 10) pintados++;
    return { w: c.width, h: c.height, pintados };
  });
  ok(lienzo && lienzo.pintados > 5000, '  y el quesito se pinta de verdad (píxeles, no la etiqueta)',
     lienzo ? lienzo.pintados + ' píxeles de ' + (lienzo.w * lienzo.h) : 'sin lienzo');
  await page.select('#cTipo', 'tabla'); await dormir(1800);
  const tabla = await page.evaluate(() => ((document.getElementById('cTablaWrap') || {}).innerText || '').replace(/\s+/g, ' '));
  ok(/No se ha vendido nunca/.test(tabla), '  y en tabla salen los grupos, con los parados dentro',
     tabla.slice(0, 100));
  ok(errores.length === 0, 'sin errores de JavaScript ni ventanitas', errores.join(' | ') || 'ninguno');
  await page.screenshot({ path: path.join(process.env.HOME || '/home/ubuntu', 'informes-shots', 'punto9-parados.png') });

} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN: ' + e.message + '\n' + e.stack);
} finally {
  try { if (browser) await browser.close(); } catch {}
  try {
    db.prepare("DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE series='GPPP')").run();
    db.prepare("DELETE FROM invoices WHERE series='GPPP'").run();
    db.prepare("DELETE FROM products WHERE name LIKE 'GPP-%'").run();
    db.prepare("DELETE FROM admin_sessions WHERE token LIKE '" + TOKEN_PREFIJO + "%'").run();
  } catch (e) { console.error('  (limpieza incompleta: ' + e.message + ')'); }
  try { db.close(); } catch {}
}

console.log(`\n${'─'.repeat(70)}\nRESULTADO: ${pass} ✓  ·  ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
