// ════════════════════════════════════════════════════════════════════════════════════════════════
// GATE — EL INICIO ES EL CUADRO DE MANDO DEL DÍA. Tarea TRANSVERSAL (el puntero del 8 NO se mueve).
//
// CONTRA LA DIRECCIÓN PÚBLICA, CON NAVEGADOR DE VERDAD. Todo lo que se afirma aquí se comprueba
// pidiendo la pantalla por HTTPS a https://<negocio>.bamburu.com —el mismo camino que recorre un
// cliente— y mirando el DOM. Nada por localhost y nada por atajo de API: un endpoint que responde
// bien no demuestra que la pantalla lo pinte, y esa fue exactamente la trampa del 18 de agosto.
//
// LO QUE ESTE GATE EXISTE PARA IMPEDIR:
//   1. Que el chat de DISA vuelva al Inicio por la puerta de atrás (su HTML o su script).
//   2. Que una cifra del Inicio y la de su pantalla de origen se separen un céntimo.
//   3. Que «lo que menos vendes» lo decida un producto vendido una vez.
//   4. Que un porcentaje de margen se pinte sin decir sobre qué se divide.
//   5. Que las cifras de venta viajen al navegador de quien no puede verlas.
//   6. Que la migración asistida vuelva a depender de una sola puerta que se pliega.
//   7. Que a 390 px la pantalla desborde o pegue el texto al borde.
//
//   node scripts/gate-inicio-cuadro-mando.mjs
import puppeteer from 'puppeteer';
import path from 'path';
import { unlinkSync } from 'fs';
import { randomBytes } from 'crypto';
import Database from 'better-sqlite3';
import { launchOpts } from './lib/gate-env.mjs';
import { controlDb, getTenantBySlug } from '../core/control-db.js';
import { provisionTenant } from '../core/tenant-provisioning.js';
import { fijarOficio } from '../modules/erp/oficios.js';
import { createInvoice } from '../modules/erp/routes/invoices.js';
import { SUELO_UNIDADES } from '../modules/erp/cuadro-mando.js';

const RID = randomBytes(3).toString('hex');
const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dormir = ms => new Promise(r => setTimeout(r, ms));
const HOY = new Date().toISOString().slice(0, 10);
const MES = HOY.slice(0, 7);

let pass = 0, fail = 0;
const ok = (c, m, x = '') => { if (c) { pass++; console.log('  ✓ ' + m + (x ? ' — ' + x : '')); } else { fail++; console.error('  ✗ FALLO: ' + m + (x ? ' — ' + x : '')); } };
const tenants = [];
function limpiar() {
  for (const { slug, db } of tenants) {
    try { if (db) db.close(); } catch {}
    const t = getTenantBySlug(slug);
    if (t) controlDb.prepare('DELETE FROM tenant_sessions WHERE tenant_id=?').run(t.id);
    controlDb.prepare('DELETE FROM tenants WHERE slug=?').run(slug);
    if (t) { const abs = path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP, t.db_filename);
      for (const f of [abs, abs + '-wal', abs + '-shm']) { try { unlinkSync(f); } catch {} } }
  }
}
let browser = null;

// Un negocio nuevo, con sesión de dueño y su DIRECCIÓN PÚBLICA (no localhost).
async function nuevoNegocio(nombre, oficio) {
  const r = randomBytes(3).toString('hex');
  const alta = await provisionTenant({ businessName: nombre + ' ' + r, ownerName: 'Dueña ' + r,
    email: 'gcm-' + r + '@bamburu.test', password: 'Gate.Cm.' + r + '!', phone: '+34 600 000 000' });
  const t = getTenantBySlug(alta.slug);
  const db = new Database(path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP, t.db_filename));
  tenants.push({ slug: alta.slug, db });
  if (oficio) fijarOficio(db, oficio);
  const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner'").get();
  return { slug: alta.slug, db, owner, base: 'https://' + alta.slug + '.bamburu.com' };
}
function sesion(db, userId) {
  const now = Math.floor(Date.now() / 1000), tok = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tok, userId, now, now + 3600, randomBytes(32).toString('base64url'));
  return tok;
}
// Pestaña PROPIA, con su contexto: dos pestañas del mismo navegador comparten cookies y la segunda
// sesión pisaría a la primera, fingiendo un rojo del producto que no existe.
async function pestana(negocio, tok, ancho = 1440, alto = 1400) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));
  await page.setViewport({ width: ancho, height: alto });
  await page.setCookie({ name: 'asess', value: tok, domain: negocio.slug + '.bamburu.com', path: '/', secure: true });
  return { ctx, page, errs };
}
const irInicio = async (page, negocio) => {
  await page.goto(negocio.base + '/admin', { waitUntil: 'networkidle0' });
  await dormir(2500);
};

// ── SEMBRAR EL NEGOCIO RICO ─────────────────────────────────────────────────────────────────────
// Productos con coste (para que haya margen que juzgar), un producto POR DEBAJO DEL SUELO, dos
// clientes, facturas de este mes y del anterior (para la comparación), horario, dos citas y un
// evento de calendario. Todo por el camino real: las facturas por `createInvoice`, que es el mismo
// servicio que usa la API, y por tanto congela el coste igual que lo haría el dueño.
function producto(db, nombre, precio, coste) {
  const r = db.prepare(
    "INSERT INTO products (name, sku, price, average_cost, stock, status, type, created_at) VALUES (?,?,?,?,?, 'active','service', datetime('now'))"
  ).run(nombre, 'SKU-' + RID + '-' + nombre.slice(0, 4), precio, coste, 100);
  return r.lastInsertRowid;
}
function cliente(db, nombre) {
  return db.prepare("INSERT INTO clients (name, active, created_at) VALUES (?,1,datetime('now'))").run(nombre).lastInsertRowid;
}
const mesAnteriorDe = iso => {
  const [y, m] = iso.split('-').map(Number);
  const i = y * 12 + (m - 1) - 1;
  return Math.floor(i / 12) + '-' + String(i % 12 + 1).padStart(2, '0');
};

try {
  console.log('\n═══ SEMBRANDO ═══');
  const P = await nuevoNegocio('Peluquería Cuadro', 'peluqueria');
  P.db.prepare("UPDATE company_config SET fiscal_id='B12345678', company_name='Peluquería Cuadro' WHERE id=1").run();

  const pr = {
    barba:  producto(P.db, 'Arreglo de barba', 15, 12),
    corte:  producto(P.db, 'Corte de pelo', 30, 10),
    mechas: producto(P.db, 'Mechas', 80, 20),
    tinte:  producto(P.db, 'Tinte', 60, 45),
    peinado: producto(P.db, 'Peinado', 20, 5),
    ext:    producto(P.db, 'Extensiones', 200, 190),   // ← solo 1 unidad: POR DEBAJO DEL SUELO
  };
  const cAna = cliente(P.db, 'Ana Ríos'), cLuis = cliente(P.db, 'Luis Paz');
  const L = (pid, desc, qty, precio) => ({ product_id: pid, description: desc, quantity: qty, unit_price: precio, tax_rate: 21 });

  createInvoice(P.db, { client_id: cAna, issue_date: HOY, lines: [
    L(pr.corte, 'Corte de pelo', 4, 30), L(pr.mechas, 'Mechas', 5, 80), L(pr.barba, 'Arreglo de barba', 8, 15) ] });
  createInvoice(P.db, { client_id: cAna, issue_date: HOY, lines: [
    L(pr.tinte, 'Tinte', 4, 60), L(pr.peinado, 'Peinado', 3, 20) ] });
  createInvoice(P.db, { client_id: cLuis, issue_date: HOY, lines: [
    L(pr.corte, 'Corte de pelo', 2, 30), L(pr.ext, 'Extensiones', 1, 200),
    // Una línea LIBRE, sin producto: no tiene coste conocido y por eso queda FUERA del margen.
    { product_id: null, description: 'Trato especial', quantity: 1, unit_price: 100, tax_rate: 21 } ] });
  // Mes anterior, para que la comparación tenga con qué comparar.
  createInvoice(P.db, { client_id: cAna, issue_date: mesAnteriorDe(MES) + '-05',
    lines: [L(pr.corte, 'Corte de pelo', 3, 30)] });

  // Horario del negocio: todos los días de 9 a 18. Sin esto el motor abre de 8 a 21 «por defecto» y
  // las horas libres no significarían nada — y el bloque lo diría, que es otra prueba.
  for (let dow = 0; dow < 7; dow++)
    P.db.prepare("INSERT INTO horario_tramos (scope,user_id,dow,inicio_min,fin_min) VALUES ('negocio',NULL,?,?,?)").run(dow, 9 * 60, 18 * 60);
  const insCita = P.db.prepare(
    "INSERT INTO citas (codigo, cliente_id, user_id, fecha, inicio_min, dur_min, margen_min, estado, archived, created_at) VALUES (?,?,?,?,?,?,0,?,0,datetime('now'))");
  insCita.run('C1-' + RID, cAna, P.owner.id, HOY, 10 * 60, 60, 'confirmada');
  insCita.run('C2-' + RID, cLuis, P.owner.id, HOY, 16 * 60, 45, 'confirmada');
  P.db.prepare("INSERT INTO agenda_bloqueos (user_id, fecha, inicio_min, fin_min, motivo) VALUES (?,?,?,?,?)")
    .run(P.owner.id, HOY, 13 * 60, 14 * 60, 'Comida');
  // Una oportunidad abierta, por su servicio real.
  const { createOpportunitySvc } = await import('../modules/erp/crm.js');
  createOpportunitySvc(P.db, { client_id: cAna, title: 'Bono de mechas', amount: 450, stage: 'propuesta' });

  const tokP = sesion(P.db, P.owner.id);
  browser = await puppeteer.launch(launchOpts());
  const { ctx: ctxP, page, errs } = await pestana(P, tokP);
  console.log('  · negocio de prueba: ' + P.base);
  await irInicio(page, P);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] EL CHAT DE DISA YA NO ESTÁ EN EL INICIO — NI SU HTML NI SU SCRIPT');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const chat = await page.evaluate(() => {
    const html = document.documentElement.innerHTML;
    const scripts = [...document.querySelectorAll('script')].map(s => s.src || s.textContent || '').join('\n');
    return {
      compositor: !!document.getElementById('dh-input'),
      mensajes: !!document.querySelector('.disa-messages'),
      chips: !!document.getElementById('dh-chips'),
      tarjetas: !!document.querySelector('.disa-cards'),
      fab: !!document.getElementById('disaFab'),
      enviar: !!document.getElementById('dh-send'),
      abrir: typeof window.disaOpen === 'function',
      enviarFn: typeof window.disaSubmitHome === 'function',
      // El SCRIPT: ninguna llamada al chat puede quedar en la página.
      endpointsChat: ['/api/disa/message', '/api/disa/threads', '/api/disa/chips', '/api/disa/attach', '/api/disa/alerts/open']
        .filter(u => scripts.includes(u)),
      // Y el cuadro de mando SÍ está.
      cuadro: !!document.getElementById('cmNumeros'),
      inicioEnHtml: html.length,
    };
  });
  ok(!chat.compositor && !chat.enviar, 'el compositor de DISA no existe en el Inicio');
  ok(!chat.mensajes && !chat.chips && !chat.tarjetas, 'ni sus mensajes, ni sus accesos rápidos, ni sus tarjetas');
  ok(!chat.fab && !chat.abrir, 'ni el botón flotante de DISA');
  ok(!chat.enviarFn, 'ni la función que enviaba desde la home');
  ok(chat.endpointsChat.length === 0, 'y NINGÚN script de la página llama a un endpoint del chat',
     chat.endpointsChat.length ? 'quedan: ' + chat.endpointsChat.join(', ') : 'cero llamadas');
  ok(chat.cuadro, 'en su sitio está el cuadro de mando');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] LAS CUATRO CIFRAS CUADRAN AL CÉNTIMO CON SU PANTALLA DE ORIGEN');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Se leen de la PANTALLA (el texto pintado) y se contrastan con lo que devuelve la pantalla de
  // origen POR OTRO CAMINO: el informe de ventas, la torre de Cobros, el informe de margen y el
  // informe de clientes. Si alguien cambia un motor y no el otro, esto cae.
  const pintado = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#cmNumeros .cm-num')];
    const out = {};
    for (const c of cards) {
      const l = c.querySelector('.cm-num-l').textContent.trim();
      out[l] = { valor: c.querySelector('.cm-num-v').textContent.trim(),
                 base: (c.querySelector('.cm-num-b') || {}).textContent || '',
                 todo: c.textContent };
    }
    return out;
  });
  const origen = await page.evaluate(async (mes, hoy) => {
    const j = async u => (await fetch(u, { cache: 'no-store' })).json();
    const inf = await j('/api/erp/analytics/informes?from=' + mes + '-01&to=' + hoy);
    const cob = await j('/api/erp/cobros');
    const mar = await j('/api/erp/analytics/margen?from=' + mes + '-01&to=' + hoy);
    return {
      ventasBase: (inf.ventas.porPeriodo || []).filter(f => f.periodo === mes).reduce((s, f) => s + f.base, 0),
      pendiente: cob.total,
      margenPct: mar.resumen.margen.pctVenta,
      margenBase: mar.resumen.margen.venta,
      margenFuera: mar.resumen.margen.fuera,
      nuevos: (inf.clientes.nuevosPorMes || []).filter(f => f.periodo === mes).reduce((s, f) => s + f.clientes, 0),
    };
  }, MES, HOY);
  const eurEs = n => Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }) + ' €';
  const pctEs = n => Number(n).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %';

  const cV = pintado['Ventas del mes'], cC = pintado['Pendiente de cobro'],
        cM = pintado['Margen del mes'], cN = pintado['Clientes nuevos'];
  ok(!!cV && cV.valor === eurEs(origen.ventasBase),
     'VENTAS: la cifra del Inicio es la del informe de ventas, al céntimo',
     (cV ? cV.valor : '(no está)') + ' vs ' + eurEs(origen.ventasBase));
  ok(!!cC && cC.valor === eurEs(origen.pendiente),
     'PENDIENTE: la cifra del Inicio es la de la torre de Cobros, al céntimo',
     (cC ? cC.valor : '(no está)') + ' vs ' + eurEs(origen.pendiente));
  ok(!!cM && cM.valor.startsWith(pctEs(origen.margenPct)),
     'MARGEN: el porcentaje del Inicio es el del motor único, al décimo',
     (cM ? cM.valor : '(no está)') + ' vs ' + pctEs(origen.margenPct));
  ok(!!cN && cN.valor === String(origen.nuevos),
     'CLIENTES NUEVOS: la cifra del Inicio es la del informe de clientes',
     (cN ? cN.valor : '(no está)') + ' vs ' + origen.nuevos);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] LOS RANKINGS COINCIDEN CON LO QUE DEVUELVE LA ANALÍTICA POR OTRO CAMINO');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // «Otro camino» de verdad: el CONSTRUCTOR cruza por producto con la medida `unidades` sobre otra
  // consulta (`filasVenta`, que agrupa por el nombre del catálogo) y el informe de margen agrupa por
  // product_id. Si los tres no dijeran lo mismo, el Inicio estaría contando por su cuenta.
  const rank = await page.evaluate(() => {
    const lista = t => {
      const h = [...document.querySelectorAll('#cmCifras .cm-lista')].find(x => x.querySelector('h4').textContent.trim() === t);
      if (!h) return null;
      return [...h.querySelectorAll('.cm-fila')].map(f => ({
        nombre: f.querySelector('.n').textContent.trim(),
        valor: f.querySelector('.v').textContent.trim(),
        ultimo: f.classList.contains('ultimo'),
      }));
    };
    return { vendidos: lista('Lo que más vendes'), rentables: lista('Lo que más te deja'),
             clientes: lista('Tus mejores clientes'), pie: (document.querySelector('#cmCifras .cm-pie') || {}).textContent || '' };
  });
  const otroCamino = await page.evaluate(async (mes, hoy) => {
    const post = async (u, b) => (await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF_TOKEN }, body: JSON.stringify(b) })).json();
    const j = async u => (await fetch(u, { cache: 'no-store' })).json();
    const cruce = await post('/api/erp/analytics/constructor/cruzar',
      { area: 'ventas', dimension: 'producto', medidas: ['unidades'], from: mes + '-01', to: hoy, limit: 1000 });
    const mar = await j('/api/erp/analytics/margen?from=' + mes + '-01&to=' + hoy);
    const inf = await j('/api/erp/analytics/informes?from=' + mes + '-01&to=' + hoy);
    return { cruce: cruce.filas.map(f => ({ nombre: f.clave, uds: f.unidades })),
             productos: mar.productos.map(p => ({ nombre: p.product_name, qty: p.qty, pct: p.margen.pctVenta })),
             clientes: (inf.clientes.ranking || []).map(c => ({ nombre: c.cliente, base: c.base })) };
  }, MES, HOY);

  const conSuelo = otroCamino.cruce.filter(x => x.uds >= SUELO_UNIDADES).sort((a, b) => b.uds - a.uds);
  const esperadosVend = conSuelo.slice(0, 3).map(x => x.nombre).concat([conSuelo[conSuelo.length - 1].nombre]);
  ok(!!rank.vendidos && rank.vendidos.length === 4, 'LO QUE MÁS VENDES: tres primeros y el último',
     rank.vendidos ? rank.vendidos.map(f => f.nombre).join(' · ') : '(no está)');
  ok(!!rank.vendidos && JSON.stringify(rank.vendidos.map(f => f.nombre)) === JSON.stringify(esperadosVend),
     'y el orden es EXACTAMENTE el que da el constructor por otro camino',
     (rank.vendidos || []).map(f => f.nombre).join(' · ') + ' vs ' + esperadosVend.join(' · '));
  ok(!!rank.vendidos && rank.vendidos[3].ultimo, 'el cuarto va marcado como «el último», no como un cuarto puesto');
  const udsPrimero = conSuelo[0].uds;
  ok(!!rank.vendidos && rank.vendidos[0].valor === udsPrimero + ' uds',
     'y las unidades del primero son las del constructor', (rank.vendidos || [{}])[0].valor + ' vs ' + udsPrimero + ' uds');

  const rentEsp = otroCamino.productos.filter(p => p.qty >= SUELO_UNIDADES && p.pct != null).sort((a, b) => b.pct - a.pct);
  const espRent = rentEsp.slice(0, 3).map(x => x.nombre).concat([rentEsp[rentEsp.length - 1].nombre]);
  ok(!!rank.rentables && JSON.stringify(rank.rentables.map(f => f.nombre)) === JSON.stringify(espRent),
     'LO QUE MÁS TE DEJA: el orden es el del informe de margen', (rank.rentables || []).map(f => f.nombre).join(' · '));
  ok(!!rank.clientes && rank.clientes.length <= 3 && rank.clientes[0].nombre === otroCamino.clientes[0].nombre
     && rank.clientes[0].valor === eurEs(otroCamino.clientes[0].base),
     'TUS MEJORES CLIENTES: el primero y su gasto son los del informe de clientes',
     (rank.clientes || [{}])[0].nombre + ' ' + (rank.clientes || [{}])[0].valor);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] UN PRODUCTO POR DEBAJO DEL MÍNIMO NO ES «LO QUE MENOS VENDES»');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const bajoSuelo = otroCamino.cruce.filter(x => x.uds < SUELO_UNIDADES).map(x => x.nombre);
  ok(bajoSuelo.includes('Extensiones'), 'el escenario tiene un producto por debajo del suelo',
     'Extensiones: ' + (otroCamino.cruce.find(x => x.nombre === 'Extensiones') || {}).uds + ' ud');
  const textoCifras = await page.evaluate(() => document.getElementById('cmCifras').textContent);
  ok(!textoCifras.includes('Extensiones'), 'y NO aparece en ninguna de las dos listas de productos');
  ok(new RegExp('al menos ' + SUELO_UNIDADES + ' unidades vendidas').test(rank.pie),
     'la pantalla DICE cuál es el mínimo, con su número', rank.pie.trim().slice(0, 110));
  ok(/Se quedan fuera por eso/.test(rank.pie) || /quedan fuera/i.test(rank.pie),
     'y dice cuántos se han quedado fuera por él');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] NINGÚN PORCENTAJE DE MARGEN SE PINTA SIN SU BASE');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  ok(/sobre lo que (cobras|te costó)/.test(cM.todo), 'la tarjeta de margen dice SOBRE QUÉ se divide (el sufijo)');
  ok(/sobre .*€ con coste conocido/.test(cM.todo), 'y SOBRE CUÁNTO: la base en euros', cM.base.trim().slice(0, 120));
  ok(new RegExp(eurEs(origen.margenBase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(cM.todo),
     'y esa base es EXACTAMENTE la del motor único', eurEs(origen.margenBase));
  ok(origen.margenFuera > 0 && /quedan fuera/.test(cM.todo),
     'y lo que queda fuera por no tener coste se dice, no se esconde', eurEs(origen.margenFuera));
  // Barrido: TODO porcentaje de la lista de rentabilidad tiene que llevar su base al lado.
  const pctsHuerfanos = await page.evaluate(() => {
    const h = [...document.querySelectorAll('#cmCifras .cm-lista')].find(x => x.querySelector('h4').textContent.trim() === 'Lo que más te deja');
    if (!h) return ['(no está la lista)'];
    return [...h.querySelectorAll('.cm-fila')]
      .map(f => f.querySelector('.v').textContent.trim())
      .filter(t => t.includes('%') && !(/sobre lo que/.test(t) && /sobre .*€/.test(t)));
  });
  ok(pctsHuerfanos.length === 0, 'y en el ranking NINGÚN porcentaje va desnudo',
     pctsHuerfanos.length ? 'desnudos: ' + pctsHuerfanos.join(' | ') : 'todos con su base');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[7] NEGOCIO CON UNA FACTURA: EL PANEL NACE PLEGADO Y LA REJILLA SE VE ENTERA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const conActividad = await page.evaluate(() => ({
    plegado: !!document.querySelector('.onb-plegado'),
    abierto: !!document.querySelector('.onb-card'),
    rejilla: !!document.getElementById('inicioGrid'),
    bloques: document.querySelectorAll('#inicioGrid .ig-block').length,
    recortada: (() => {
      const g = document.getElementById('inicioGrid');
      if (!g) return 'no hay rejilla';
      const r = g.getBoundingClientRect();
      return (g.scrollHeight > Math.ceil(r.height) + 2) ? 'recortada' : 'entera';
    })(),
  }));
  ok(conActividad.plegado && !conActividad.abierto,
     'con facturas y citas, el panel de arranque NACE PLEGADO (aunque falten pasos)');
  ok(conActividad.rejilla && conActividad.bloques > 0, 'la rejilla sigue ahí, con sus bloques',
     conActividad.bloques + ' bloques');
  ok(conActividad.recortada === 'entera', 'y se ve ENTERA, sin recortes', conActividad.recortada);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[bis] EL BLOQUE «HOY» PINTA EL DÍA, Y SUS CIFRAS SON LAS DE LA AGENDA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const hoyUI = await page.evaluate(async (hoy) => {
    const c = document.getElementById('cmHoy');
    const ag = await (await fetch('/api/erp/citas/agenda?desde=' + hoy + '&hasta=' + hoy, { cache: 'no-store' })).json();
    return {
      existe: !!c.querySelector('.cm-card'),
      texto: c.textContent,
      segmentos: c.querySelectorAll('.cm-fr-cita').length,
      eventos: c.querySelectorAll('.cm-fr-blq').length,
      proxima: (c.querySelector('.cm-prox .tx b') || {}).textContent || '',
      citasAgenda: (ag.citas || []).length,
      bloqueosAgenda: (ag.bloqueos || []).length,
    };
  }, HOY);
  ok(hoyUI.existe, 'el bloque HOY existe en un negocio con agenda');
  ok(hoyUI.segmentos === hoyUI.citasAgenda && hoyUI.citasAgenda > 0,
     'la franja pinta UNA barra por cita, las mismas que sirve la agenda',
     hoyUI.segmentos + ' barras / ' + hoyUI.citasAgenda + ' citas');
  ok(hoyUI.eventos === hoyUI.bloqueosAgenda && hoyUI.bloqueosAgenda > 0,
     'y los eventos del calendario del día, los mismos', hoyUI.eventos + ' / ' + hoyUI.bloqueosAgenda);
  ok(/2 citas/.test(hoyUI.texto), 'el resumen dice cuántas citas hay', hoyUI.texto.trim().slice(0, 60));
  ok(hoyUI.proxima.length > 0, 'y la próxima cita va destacada con su cliente', hoyUI.proxima);
  ok(!/no has puesto tu horario/.test(hoyUI.texto), 'con horario puesto, no sale el aviso de horario');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[bis] OPORTUNIDADES Y DISA DECIDE');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const opDec = await page.evaluate(async () => {
    const crm = await (await fetch('/api/erp/crm', { cache: 'no-store' })).json();
    const o = document.querySelector('#cmOport .cm-oport');
    const d = [...document.querySelectorAll('#cmDecide .cm-dec')];
    return {
      linea: o ? o.textContent : '', href: o ? o.getAttribute('href') : '',
      abiertas: crm.abiertas, importe: crm.totalAbierto,
      decs: d.length,
      conBoton: d.filter(x => x.querySelector('a.btn')).length,
      conCifra: d.filter(x => (x.querySelector('.cifra') || {}).textContent.trim().length > 0).length,
      textoDec: d.map(x => x.textContent).join(' | '),
    };
  });
  ok(/1 oportunidad abierta/.test(opDec.linea) && opDec.abiertas === 1,
     'OPORTUNIDADES: una línea con cuántas hay, la que dice el CRM', opDec.linea.trim().slice(0, 60));
  ok(opDec.linea.includes(eurEs(opDec.importe)), 'y por cuánto, al céntimo', eurEs(opDec.importe));
  ok(opDec.href === '/admin/crm', 'con enlace a su pantalla', opDec.href);
  ok(opDec.decs > 0 && opDec.decs <= 3, 'DISA DECIDE: como mucho tres líneas', opDec.decs + ' líneas');
  ok(opDec.conBoton === opDec.decs && opDec.conCifra === opDec.decs,
     'cada una con su cifra delante y su botón', opDec.conCifra + ' cifras · ' + opDec.conBoton + ' botones');
  // DINERO Y FECHAS EN ESPAÑOL, también aquí: ni una fecha ISO ni un «€123.45» pueden colarse.
  ok(!/\d{4}-\d{2}-\d{2}/.test(opDec.textoDec), 'sin ninguna fecha en formato ISO', opDec.textoDec.slice(0, 120));
  ok(!/€\s?\d/.test(opDec.textoDec), 'y sin ningún importe con el símbolo delante (formato inglés)');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[10] LA MIGRACIÓN SE ALCANZA POR DOS PUERTAS, Y NINGUNA DEPENDE DE LA OTRA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Puerta 1: la configuración del negocio. Se NAVEGA de verdad y se pulsa el enlace.
  await page.goto(P.base + '/admin/settings', { waitUntil: 'networkidle0' });
  await dormir(800);
  const enAjustes = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href="/admin/migracion"]')];
    return { hay: a.length, texto: a.length ? a[0].textContent.trim() : '',
             titulo: a.length ? (a[0].closest('.card-body') || {}).textContent || '' : '' };
  });
  ok(enAjustes.hay > 0, 'PUERTA 1: la configuración del negocio tiene su entrada a la migración', enAjustes.texto);
  ok(/equipo de Bamburu/.test(enAjustes.titulo),
     'y dice que la hace el equipo, sin insinuar un importador que no existe');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }),
                     page.evaluate(() => document.querySelector('a[href="/admin/migracion"]').click())]);
  ok(new URL(page.url()).pathname === '/admin/migracion', 'y pulsándola se llega', page.url());

  // Puerta 2: el paso del panel de arranque. Se despliega el panel y se pulsa su enlace.
  await irInicio(page, P);
  await page.evaluate(() => document.querySelector('[data-onb-toggle]').click());
  await dormir(900);
  const enPanel = await page.evaluate(() => {
    const a = [...document.querySelectorAll('#onbPanel a[href="/admin/migracion"]')];
    return a.length;
  });
  ok(enPanel > 0, 'PUERTA 2: el panel de arranque conserva su paso «trae tus datos»', enPanel + ' enlace(s)');
  // Y las dos llevan a una pantalla que responde, no a un 404.
  const respMig = await page.evaluate(async () => (await fetch('/admin/migracion')).status);
  ok(respMig === 200, 'la pantalla de migración responde 200 por la dirección pública', 'HTTP ' + respMig);
  // Se vuelve a dejar plegado, para no ensuciar el resto de comprobaciones.
  await page.evaluate(() => document.querySelector('[data-onb-toggle]').click());
  await dormir(700);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[11] A 390 PX: SIN SCROLL HORIZONTAL Y SIN TEXTO PEGADO AL BORDE');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  await page.setViewport({ width: 390, height: 900 });
  await irInicio(page, P);
  const movil = await page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const desborde = document.documentElement.scrollWidth > W + 1;
    // TODO elemento con texto propio dentro del área de contenido, no solo los del cuadro de mando.
    const malos = [];
    const raiz = document.querySelector('.content') || document.body;
    for (const el of raiz.querySelectorAll('*')) {
      const propio = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
      if (!propio) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.position === 'fixed') continue;
      if (r.left < 6 || r.right > W - 6) {
        malos.push((el.id || el.className || el.tagName) + ' [' + Math.round(r.left) + '…' + Math.round(r.right) + '] "' + propio.slice(0, 28) + '"');
      }
    }
    return { W, desborde, malos: malos.slice(0, 8), total: malos.length };
  });
  ok(!movil.desborde, 'a 390 px la página NO desborda a lo ancho', 'ancho ' + movil.W);
  ok(movil.total === 0, 'y ni un solo elemento con texto toca el borde',
     movil.total ? movil.total + ' pegados: ' + movil.malos.join(' · ') : 'ninguno de todo el contenido');
  await page.setViewport({ width: 1440, height: 1400 });
  ok(errs.length === 0, 'CERO errores de JavaScript en todo el recorrido', errs.join(' | '));
  await ctxP.close();

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[6+8] NEGOCIO SIN ACTIVIDAD: PANEL DESPLEGADO. SIN AGENDA: EL BLOQUE «HOY» NO EXISTE');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Asesoría recién creada: ni una factura, ni una cita, ni horario puesto.
  const A = await nuevoNegocio('Asesoría Cuadro', 'asesoria');
  const tokA = sesion(A.db, A.owner.id);
  const { ctx: ctxA, page: pa } = await pestana(A, tokA);
  await irInicio(pa, A);
  const vacio = await pa.evaluate(async () => {
    const cuadro = await (await fetch('/api/erp/inicio/cuadro', { cache: 'no-store' })).json();
    const paleta = await (await fetch('/api/erp/inicio/bloques', { cache: 'no-store' })).json();
    return {
      abierto: !!document.querySelector('.onb-card'),
      plegado: !!document.querySelector('.onb-plegado'),
      hoyEnPantalla: !!document.querySelector('#cmHoy .cm-card'),
      hoyEnDatos: cuadro.secciones.hoy,
      hoyEnRespuesta: Object.prototype.hasOwnProperty.call(cuadro.secciones, 'hoy'),
      noAplica: cuadro.noAplica,
      paleta: paleta.nativos.map(n => n.tipo),
      forzarHoy: (await fetch('/api/erp/inicio/cuadro/hoy', { cache: 'no-store' })).status,
    };
  });
  ok(vacio.abierto && !vacio.plegado,
     'un negocio SIN actividad real abre su Inicio con el panel de arranque DESPLEGADO');
  ok(!vacio.hoyEnPantalla, 'y sin agenda el bloque HOY no se pinta');
  ok(!vacio.hoyEnRespuesta && vacio.noAplica.includes('hoy'),
     'ni siquiera viaja en la respuesta: la sección NO APLICA a este negocio', JSON.stringify(vacio.noAplica));
  ok(!vacio.paleta.includes('hoy'), 'NI EN LA PALETA: no se le ofrece siquiera', vacio.paleta.join(', '));
  ok(vacio.forzarHoy === 200, 'y forzar su ruta no revienta: contesta que aquí no aplica', 'HTTP ' + vacio.forzarHoy);
  await ctxA.close();

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[9] SIN PERMISO DE VENTAS, LA CIFRA NO VIAJA — Y FORZAR LA RUTA DA 403');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Un empleado de verdad, con `clients.read` y nada más, contra el servidor público.
  const uid = P.db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active,must_change_password,created_at) VALUES ('Sin Ventas',?,'x','employee',1,0,datetime('now'))")
    .run('sv-' + RID + '@bamburu.test').lastInsertRowid;
  const perm = P.db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get('clients', 'read');
  if (perm) P.db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id,permission_id) VALUES (?,?)').run(uid, perm.id);
  const tokE = sesion(P.db, uid);
  const { ctx: ctxE, page: pe } = await pestana(P, tokE);
  await irInicio(pe, P);
  const emp = await pe.evaluate(async () => {
    const cuadro = await (await fetch('/api/erp/inicio/cuadro', { cache: 'no-store' })).json();
    const status = async u => (await fetch(u, { cache: 'no-store' })).status;
    return {
      secciones: Object.keys(cuadro.secciones),
      sinPermiso: cuadro.sinPermiso.map(s => s.seccion),
      // El CUERPO ENTERO de la respuesta: si una cifra de venta se colara, aparecería aquí.
      cuerpo: JSON.stringify(cuadro),
      // Y el HTML de la pantalla: lo que no viaja no se puede pintar.
      html: document.getElementById('cmNumeros').innerHTML + document.getElementById('cmGrafico').innerHTML
            + document.getElementById('cmCifras').innerHTML,
      forzarVentas: await status('/api/erp/inicio/cuadro/ventas'),
      forzarGrafico: await status('/api/erp/inicio/cuadro/grafico'),
      forzarMargen: await status('/api/erp/inicio/cuadro/margen'),
      forzarProductos: await status('/api/erp/inicio/cuadro/productos'),
      forzarInventada: await status('/api/erp/inicio/cuadro/loquesea'),
      forzarClientes: await status('/api/erp/inicio/cuadro/clientes'),
    };
  });
  ok(!emp.secciones.includes('ventas') && !emp.secciones.includes('grafico'),
     'las secciones de venta NO se calculan para quien no puede verlas', emp.secciones.join(', '));
  ok(emp.sinPermiso.includes('ventas') && emp.sinPermiso.includes('margen') && emp.sinPermiso.includes('productos'),
     'y se DICE qué le falta, en vez de devolver un hueco mudo', emp.sinPermiso.join(', '));
  // La cifra exacta que no debe viajar: el total de ventas del mes del negocio.
  const ventasReales = P.db.prepare("SELECT ROUND(SUM(subtotal),2) s FROM invoices WHERE issue_date >= ?").get(MES + '-01').s;
  ok(!emp.cuerpo.includes(String(ventasReales)) && !emp.html.includes(String(ventasReales)),
     'la cifra de ventas NO aparece ni en la respuesta ni en el HTML de su navegador',
     'buscada: ' + ventasReales);
  ok(emp.forzarVentas === 403 && emp.forzarGrafico === 403 && emp.forzarMargen === 403 && emp.forzarProductos === 403,
     'y forzar sus rutas a mano da 403 en las cuatro',
     [emp.forzarVentas, emp.forzarGrafico, emp.forzarMargen, emp.forzarProductos].join('/'));
  ok(emp.forzarClientes === 200, 'lo que SÍ puede ver sigue funcionando (no es un candado a lo bruto)', 'HTTP ' + emp.forzarClientes);
  ok(emp.forzarInventada === 404, 'y una sección inventada da 404, no un cuerpo a medias', 'HTTP ' + emp.forzarInventada);
  await ctxE.close();

} catch (e) {
  fail++;
  console.error('\n✗ EXCEPCIÓN: ' + (e && e.stack || e));
} finally {
  try { if (browser) await browser.close(); } catch {}
  console.log('\n[limpieza] borrando los negocios de prueba');
  limpiar();
  console.log('  ✓ negocios de prueba eliminados');
}
console.log('\n═════════ RESULTADO: ' + pass + ' OK · ' + fail + ' fallos ═════════');
process.exit(fail ? 1 : 0);
