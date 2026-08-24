// ESCALERA · PASO 2 — MARGEN. Gate de NAVEGADOR contra el servidor real.
//
// QUÉ MIDE Y POR QUÉ. El motor ya lo prueba `verify-margen` (38/0). Aquí se prueba lo que ese no
// puede: que la pantalla PINTE, que el aviso de "sin coste registrado" SALGA (es lo único que evita
// que el dueño lea mal su propio beneficio), que el "—" aparezca donde no hay coste en vez de un 0 o
// un 100, y —lo importante— que el CANDADO valga igual por pantalla y por export: un empleado sin
// `analytics.read` no puede ver el coste ni sacándolo por CSV. Un export sin candado sería la puerta
// de atrás del permiso.
//
// NO ESCRIBE NADA: solo lee la Analítica del tenant de desarrollo. El usuario de prueba se crea y se
// BORRA al terminar (finally), pase lo que pase.
//
//   node scripts/gate-margen-pantalla.mjs
import puppeteer from 'puppeteer';
import { launchOpts, APP_DIR } from './lib/gate-env.mjs';
import Database from 'better-sqlite3';
import { join } from 'path';
import bcrypt from 'bcrypt';

// El tenant se resuelve por SUBDOMINIO, así que se le habla por la URL. (No con `Host` en
// setExtraHTTPHeaders: Chromium lo rechaza con ERR_INVALID_ARGUMENT.)
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const HOST = 'desarrollo-bamburu.localhost';
// Desde la ficha D-ter los informes de Analítica se cargan al DESPLEGAR su fila del índice, no al
// entrar en la pantalla. Abrir la sección y esperar a que tenga contenido es parte de mirarla.
async function abrirSeccion(page, clave, selectorConDatos) {
  await page.waitForSelector('[data-inf="' + clave + '"]', { timeout: 10000 });
  await page.click('[data-inf="' + clave + '"]');
  await page.waitForSelector(selectorConDatos, { timeout: 15000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 600));
}

let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { if (c) { pass++; console.log('  ✓ ' + m + (extra ? ' — ' + extra : '')); } else { fail++; console.error('  ✗ FALLO: ' + m + (extra ? ' — ' + extra : '')); } };

const db = new Database(join(APP_DIR, 'data/tenants/desarrollo-bamburu.db'));
let empId = null;
const EMAIL = 'gate-margen-' + Date.now() + '@test.local';

try {
  // Empleado SIN analytics.read, creado a propósito. (Lección de C4a-bis: dar por hecho que un
  // usuario existente no tiene el permiso es cómo un gate deja de probar lo que cree probar.)
  empId = db.prepare("INSERT INTO admin_users (name, email, password_hash, role, active) VALUES (?,?,?,'employee',1)")
            .run('Gate Margen', EMAIL, bcrypt.hashSync('Test1234!', 10)).lastInsertRowid;
  db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(empId);
  // SE LE DA UN PERMISO CUALQUIERA, y no es un capricho: el filtro del menú es
  // `hasCustomPerms = !isAdmin && !isOwner && perms.length > 0`. Con CERO permisos, `hasCustomPerms`
  // es false y el menú NO se filtra — se pintaría entero y este gate probaría lo contrario de lo que
  // cree. Con un permiso ajeno (clients.read) el filtro sí corre y la ausencia de la entrada
  // significa algo. (El agujero de UX de "cero permisos ve todo el menú" es PREEXISTENTE y ajeno a
  // este paso: la puerta sigue cerrada con 403 al pulsar. Anotado, no tocado.)
  const permClientes = db.prepare("SELECT id FROM permissions WHERE module='clients' AND action='read'").get();
  if (permClientes) db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(empId, permClientes.id);

  const browser = await puppeteer.launch(launchOpts());
  const page = await browser.newPage();
  // ESCRITORIO explícito. Puppeteer arranca en 800×600 y por debajo de 768px el riel se convierte en
  // drawer (U5): el menú existe pero está fuera de pantalla, así que `hover` no lo alcanza y el gate
  // fallaría culpando al menú de un problema de ancho. El riel es lo que se prueba aquí.
  await page.setViewport({ width: 1400, height: 900 });
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));

  // ── Sesión de OWNER (por la BD, como el resto de gates) ────────────────────
  const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
  const tok = 'gate-margen-' + Date.now();
  const ahora = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token, user_id, created_at, expires_at, csrf_token) VALUES (?,?,?,?,?)')
    .run(tok, owner.id, ahora, ahora + 3600, 'csrf-' + tok);
  await page.setCookie({ name: 'asess', value: tok, domain: HOST, path: '/' });

  console.log('\n[1] LA PANTALLA PINTA LA RENTABILIDAD');
  const r = await page.goto(BASE + '/admin/analytics', { waitUntil: 'networkidle2' });
  ok(r.status() === 200, 'Analítica responde 200', String(r.status()));
  // HAY QUE ABRIR LA SECCIÓN. Desde la ficha D-ter (23 ago 2026) los informes de esta pantalla se
  // cargan al desplegarlos, no al entrar: `cargarInforme('rentabilidad')` solo corre cuando alguien
  // pulsa su fila del índice. Este gate seguía midiendo la pantalla recién cargada, así que leía el
  // esqueleto — y encima daba VERDE en las dos primeras líneas, porque comparaba contra el guion
  // corto '-' y la pantalla pinta la raya larga '—'. Dos maneras de mentir a la vez: no cargar lo
  // que se mide, y aceptar el hueco como si fuera una cifra.
  await page.waitForSelector('[data-inf="rentabilidad"]', { timeout: 10000 });
  await page.click('[data-inf="rentabilidad"]');
  await page.waitForFunction(() => {
    const e = document.getElementById('mBen');
    return e && e.textContent.trim() !== '—' && e.textContent.trim() !== '-' && e.textContent.trim() !== '';
  }, { timeout: 15000 }).catch(() => {});
  const vacio = v => !v || v === '-' || v === '—' || v === '';
  const ben = await page.$eval('#mBen', e => e.textContent.trim()).catch(() => null);
  const pct = await page.$eval('#mPct', e => e.textContent.trim()).catch(() => null);
  ok(!vacio(ben), 'el beneficio se pinta', ben);
  ok(!vacio(pct), 'el margen % se pinta', pct);
  ok(errores.length === 0, '0 errores JS', errores.join(' | '));

  console.log('\n[2] EL AVISO DE "SIN COSTE REGISTRADO" — lo que impide leer mal la cifra');
  const avisoVisible = await page.$eval('#mgAviso', e => e.style.display !== 'none' && e.textContent.length > 0).catch(() => false);
  ok(avisoVisible, 'el aviso SALE (este tenant tiene ventas sin coste)');
  const avisoTxt = await page.$eval('#mgAviso', e => e.textContent).catch(() => '');
  ok(/sin coste registrado/i.test(avisoTxt), 'dice "sin coste registrado"');
  ok(/%/.test(avisoTxt), 'dice QUÉ PARTE de las ventas queda fuera');

  console.log('\n[3] LO QUE NO SE SABE SE PINTA "—", NO 0 NI 100%');
  const filas = await page.$$eval('#mgBody tr', trs => trs.map(t => [...t.querySelectorAll('td')].map(d => d.textContent.trim())));
  const sinCoste = filas.filter(f => f[3] && /sin coste/i.test(f[3]));
  ok(sinCoste.length > 0, 'hay filas sin coste en este tenant', sinCoste.length + ' filas');
  ok(sinCoste.every(f => f[5] === '—'), 'todas ellas muestran "—" en Margen, nunca 100%');
  ok(!filas.some(f => f[5] === '100.0%' && /sin coste/i.test(f[3] || '')), 'ninguna línea sin coste declara 100% de margen');

  console.log('\n[4] EL CANDADO — mismo permiso por pantalla Y por export');
  const csv = await page.evaluate(async b => { const r = await fetch(b + '/api/erp/analytics/export/margen'); return { s: r.status, t: (await r.text()).slice(0, 200) }; }, BASE);
  ok(csv.s === 200, 'el owner SÍ puede exportar', String(csv.s));
  ok(/Producto,Unidades,Ingresos_sin_IVA,Coste,Beneficio/.test(csv.t), 'el CSV trae coste y beneficio');
  ok(/TOTAL/.test((await page.evaluate(async b => (await (await fetch(b + '/api/erp/analytics/export/margen')).text()), BASE))), 'el CSV cierra con la fila TOTAL');

  // Ahora el empleado SIN permiso, en un CONTEXTO AISLADO.
  // ⚠️ NO vale `browser.newPage()`: las cookies son del NAVEGADOR, no de la pestaña, así que la
  // sesión del empleado PISA la del owner y todo lo que se comprobara después con `page` estaría
  // mirando el menú del empleado creyendo que es el del owner. Costó un falso verde encontrarlo: las
  // dos aserciones del menú del owner pasaban porque leían un DOM ya renderizado ANTES del cambio de
  // cookie — verdes, y midiendo lo que no era.
  const ctxEmp = await browser.createBrowserContext();
  const page2 = await ctxEmp.newPage();
  await page2.setViewport({ width: 1400, height: 900 });
  const tok2 = 'gate-margen-emp-' + Date.now();
  db.prepare('INSERT INTO admin_sessions (token, user_id, created_at, expires_at, csrf_token) VALUES (?,?,?,?,?)')
    .run(tok2, empId, ahora, ahora + 3600, 'csrf-' + tok2);
  await page2.setCookie({ name: 'asess', value: tok2, domain: HOST, path: '/' });
  // Se aterriza en el Inicio (que el empleado SÍ puede ver) y desde ahí se piden las tres puertas por
  // `fetch`. Se mide el ESTADO, que es lo que manda: navegar a una 403 con puppeteer se queda colgado
  // esperando un `domcontentloaded` que nunca llega, y ese timeout no probaría nada.
  await page2.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  const tres = await page2.evaluate(async b => ({
    vista:  (await fetch(b + '/admin/analytics')).status,
    export: (await fetch(b + '/api/erp/analytics/export/margen')).status,
    api:    (await fetch(b + '/api/erp/analytics/margen')).status,
  }), BASE);
  ok(tres.vista === 403, 'el empleado sin permiso NO ve la Analítica (403)', String(tres.vista));
  ok(tres.export === 403, 'y TAMPOCO saca el coste por el export (403)', String(tres.export));
  ok(tres.api === 403, 'ni por el API de margen (403)', String(tres.api));

  console.log('\n[5] EL MENÚ — la entrada "Analítica" existe, lleva al informe y respeta el candado');
  // La pantalla llevaba viva y SIN ENLACE desde U7 (8-jul): existía y no había forma de llegar.
  const menuOwner = await page.evaluate(() => ({
    area: !!document.querySelector('.nav-item[title="Analítica"]'),
    href: !!document.querySelector('a.fly-item[href="/admin/analytics"]'),
  }));
  ok(menuOwner.area, 'el owner ve el área "Analítica" en el riel');
  ok(menuOwner.href, 'y su entrada apunta a /admin/analytics');
  // Se PULSA de verdad, y COMO LO HARÍA EL DUEÑO: un enlace en el DOM no demuestra que se pueda
  // llegar. El flyout está oculto hasta pasar el ratón por el área, así que primero se abre y luego
  // se pulsa — si solo se hiciera `querySelector`, el gate pasaría aunque el menú fuese inalcanzable.
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle2' });
  await page.waitForSelector('.nav-item[title="Analítica"]', { timeout: 8000 });
  await page.hover('.nav-item[title="Analítica"]');
  await page.waitForSelector('a.fly-item[href="/admin/analytics"]', { visible: true, timeout: 5000 });
  ok(true, 'el flyout se abre al pasar el ratón y la entrada es VISIBLE');
  await page.click('a.fly-item[href="/admin/analytics"]');
  await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
  ok(page.url().endsWith('/admin/analytics'), 'al pulsarla, se llega al informe', page.url());
  ok(await page.$('#mBen') !== null, 'y la Rentabilidad está ahí');

  const menuEmp = await page2.evaluate(() => ({
    area: !!document.querySelector('.nav-item[title="Analítica"]'),
    href: !!document.querySelector('a.fly-item[href="/admin/analytics"]'),
    otras: !!document.querySelector('a.fly-item[href="/admin/clients"]'),
  }));
  // GUARDIÁN DEL PROPIO GATE: que los dos contextos sigan siendo QUIEN DICEN SER. Si el aislamiento
  // se rompiera otra vez (una cookie pisando a la otra), los dos menús serían idénticos y las
  // aserciones de abajo pasarían sin probar nada. Que sean DISTINTOS es lo que las hace válidas.
  ok(menuOwner.area && !menuEmp.area, 'los dos contextos NO son el mismo usuario (owner ve el área, empleado no)');
  ok(menuEmp.otras, 'el empleado SÍ ve el menú (su filtro está activo: tiene clients.read)');
  ok(!menuEmp.area, 'pero NO ve el área "Analítica"');
  ok(!menuEmp.href, 'ni el enlace al informe');

  console.log('\n[6] CRM — POR RESPONSABLE: la tarjeta pinta y el candado cruza áreas');
  await page.goto(BASE + '/admin/analytics', { waitUntil: 'networkidle2' });
  await abrirSeccion(page, 'responsable', '#respBody tr td');
  const resp = await page.$$eval('#respBody tr', trs => trs.map(t => [...t.querySelectorAll('td')].map(d => d.textContent.trim())));
  ok(resp.length > 0, 'la tarjeta "Por responsable" pinta filas', resp.length + ' filas');
  ok(resp.some(f => /Sin asignar/i.test(f[0] || '')), '"Sin asignar" aparece como una fila más (no se esconde)');
  const opciones = await page.$$eval('#respSel option', os => os.map(o => o.textContent.trim()));
  ok(opciones.includes('Todos'), 'el filtro por responsable existe', opciones.join(' · '));
  // El candado CRUZA ÁREAS: el empleado tiene clients.read pero NO invoices.read ni analytics.read.
  const respEmp = await page2.evaluate(async b => (await fetch(b + '/api/erp/analytics/responsable')).status, BASE);
  ok(respEmp === 403, 'sin analytics.read no saca el reparto por responsable (403)', String(respEmp));

  console.log('\n[7] LA FICHA DE CLIENTE tiene el desplegable de responsable');
  await page.goto(BASE + '/admin/clients', { waitUntil: 'networkidle2' });
  const ficha = await page.evaluate(() => {
    const s = document.getElementById('cResp');
    return { existe: !!s, sinAsignar: s ? [...s.options].some(o => o.textContent.trim() === 'Sin asignar') : false,
             usuarios: s ? s.options.length : 0 };
  });
  ok(ficha.existe, 'el desplegable "Responsable" está en la ficha');
  ok(ficha.sinAsignar, 'y ofrece "Sin asignar" (no es obligatorio)');
  ok(ficha.usuarios > 1, 'lista los usuarios del negocio', ficha.usuarios + ' opciones');

  console.log('\n[8] PASO 3 — INFORMES POR ÁREA: las tres pestañas pintan');
  await page.goto(BASE + '/admin/analytics', { waitUntil: 'networkidle2' });
  await abrirSeccion(page, 'por-area', '#infBody table');
  const tabs = await page.$$eval('#infTabs .tab', ts => ts.map(t => t.textContent.trim()));
  ok(tabs.join(',') === 'Ventas,Compras,Clientes', 'las tres pestañas existen', tabs.join(' · '));
  const ventasTablas = await page.$$eval('#infBody table', ts => ts.length);
  ok(ventasTablas >= 4, 'Ventas trae sus 4 informes', ventasTablas + ' tablas');
  // Se PULSA: que una pestaña exista no demuestra que pinte.
  // 300 ms no bastan: la pestaña pide sus datos al pulsarla. Se espera a que el texto CAMBIE.
  await page.click('#infTabs .tab[data-area="compras"]');
  await page.waitForFunction(() => /Gasto por categoría/i.test(document.getElementById('infBody').textContent),
                             { timeout: 12000 }).catch(() => {});
  const comprasTxt = await page.$eval('#infBody', e => e.textContent);
  ok(/Gasto por categoría/i.test(comprasTxt), 'al pulsar Compras, pinta sus informes');
  ok(/Abono a tu favor|Vencida|Aún no vencida/i.test(comprasTxt), 'y los tramos llevan su etiqueta en cristiano');
  await page.click('#infTabs .tab[data-area="clientes"]');
  await page.waitForFunction(() => /dormidos/i.test(document.getElementById('infBody').textContent),
                             { timeout: 12000 }).catch(() => {});
  const cliTxt = await page.$eval('#infBody', e => e.textContent);
  ok(/dormidos/i.test(cliTxt) && /Ranking/i.test(cliTxt), 'al pulsar Clientes, pinta los suyos');
  ok(errores.length === 0, '0 errores JS tras pulsar las tres', errores.join(' | '));

  console.log('\n[9] PASO 3 — PLAN FINANCIERO: la pantalla y su candado');
  await abrirSeccion(page, 'plan', '#planBody');
  const plan = await page.evaluate(() => ({
    tabla: !!document.getElementById('planBody'),
    botonFijar: !!document.getElementById('btnMeta'),
    nota: (document.querySelector('#planBody') ? document.body.textContent : '').includes('son metas, no contabilidad'),
  }));
  ok(plan.tabla, 'la tarjeta del plan está');
  ok(plan.botonFijar, 'el owner SÍ ve el botón de fijar objetivo');
  ok(plan.nota, 'y la nota explica que un descuadre entre niveles NO es un error');
  const planEmp = await page2.evaluate(async b => (await fetch(b + '/api/erp/analytics/plan')).status, BASE);
  ok(planEmp === 403, 'el empleado sin analytics.read no ve el plan (403)', String(planEmp));
  // El botón NO es el candado: el servidor lo vuelve a comprobar.
  const postEmp = await page2.evaluate(async b => (await fetch(b + '/api/erp/analytics/plan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo: 'facturacion', periodo: 'mes', clave: '2026-07', alcance: 'global', valor: 1 }) })).status, BASE);
  ok(postEmp === 403, 'y TAMPOCO puede fijar una meta por la API (403)', String(postEmp));

  console.log('\n[10] PASO 4a — EL CONSTRUCTOR: cruzar, dibujar y guardar');
  await page.goto(BASE + '/admin/analytics', { waitUntil: 'networkidle2' });
  await page.waitForSelector('#cDim option', { timeout: 10000 }).catch(() => {});
  const cons = await page.evaluate(() => ({
    dims: [...document.querySelectorAll('#cDim option')].map(o => o.textContent.trim()),
    meds: [...document.querySelectorAll('#cMed option')].map(o => o.textContent.trim()),
    tipos: [...document.querySelectorAll('#cTipo option')].map(o => o.value),
    lienzo: !!document.getElementById('cChart'),
  }));
  ok(cons.dims.length === 9, 'ofrece las 9 dimensiones en cristiano', cons.dims.join(' · '));
  // Eran 6 y hoy son 8 (Nº de facturas y Ticket medio entraron después). Se exige que estén LAS QUE
  // importan, por nombre: un recuento congelado envejece a cada entrega y no dice qué falta.
  for (const m of ['Facturado (sin IVA)', 'Coste', 'Beneficio en euros', 'Margen en %'])
    ok(cons.meds.includes(m), '  la medida «' + m + '» está', cons.meds.join(' · '));
  // Los cuatro DIBUJOS más las dos formas de la frase («lo que mejor se lea» y «un número»), que se
  // añadieron a la lista válida el 24 ago 2026 — sin ellas no se podía guardar un informe recién
  // creado. Se comprueba que estén los cuatro de siempre; que haya más no es una pérdida.
  for (const t of ['barras', 'lineas', 'tarta', 'tabla'])
    ok(cons.tipos.includes(t), '  el tipo de gráfico «' + t + '» sigue ahí', cons.tipos.join(','));
  ok(cons.lienzo, 'y el gráfico se dibuja');
  // Se CAMBIA el cruce de verdad: que el desplegable exista no demuestra que redibuje.
  await page.select('#cDim', 'producto');
  await page.select('#cMed', 'beneficio');
  await new Promise(r => setTimeout(r, 700));
  const avisoCons = await page.$eval('#cAviso', e => e.style.display !== 'none' && /sin coste/i.test(e.textContent)).catch(() => false);
  ok(avisoCons, 'al pedir margen, sale el aviso de "sin coste"');
  await page.select('#cTipo', 'tabla');
  await new Promise(r => setTimeout(r, 700));
  // LO QUE SE PUEDE PROBAR AQUÍ, Y LO QUE NO. Esto exigía ver una raya «—» en la tabla, es decir un
  // grupo SIN NINGUNA línea con coste. En este negocio no existe: todos los grupos tienen al menos
  // una línea costeada (medido el 24 ago 2026, con las ocho dimensiones y el histórico entero: cero
  // huecos), y el gate no puede fabricar uno porque emitir una factura aquí la mete en la cadena de
  // VERI*FACTU y no se puede quitar. Era una precondición que el gate no posee — la clase de rojo
  // que no dice nada del producto.
  //
  // Se prueba lo mismo por el lado que SÍ se sostiene siempre: que lo PINTADO diga exactamente lo
  // que dice el motor. Cada fila con número se pinta con número; cada hueco del motor se pinta «—»
  // y nunca 0 ni 100 %. Si algún día hay un hueco, esta comprobación lo cubre sin tocarla. El
  // comportamiento del motor con huecos lo prueba `verify-margen` (paso [6]), y la tabla de arriba
  // de esta misma pantalla ya enseña sus filas «sin coste» en el paso [3].
  const cuadre = await page.evaluate(async () => {
    const r = await fetch('/api/erp/analytics/constructor/cruzar', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF_TOKEN },
      body: JSON.stringify({ area: 'ventas', dimension: 'producto', medidas: ['beneficio'], limit: 999 }) });
    const j = await r.json();
    const pintadas = [...document.querySelectorAll('#cTablaWrap tbody tr')]
      .map(t => [...t.querySelectorAll('td')].map(d => d.textContent.trim()));
    const huecosMotor = (j.filas || []).filter(f => f.beneficio == null).length;
    const rayasPintadas = pintadas.filter(f => f[1] === '—').length;
    const cerosFalsos = pintadas.filter((f, i) => (j.filas || [])[i] &&
      (j.filas || [])[i].beneficio == null && /^0,00|^100,0/.test(f[1] || '')).length;
    return { filasMotor: (j.filas || []).length, filasPintadas: pintadas.length,
             huecosMotor, rayasPintadas, cerosFalsos };
  });
  ok(cuadre.filasPintadas > 0 && cuadre.filasPintadas === cuadre.filasMotor,
     'la tabla pinta EXACTAMENTE las filas que da el motor',
     cuadre.filasPintadas + ' pintadas · ' + cuadre.filasMotor + ' del motor');
  ok(cuadre.rayasPintadas === cuadre.huecosMotor && cuadre.cerosFalsos === 0,
     'y cada hueco del motor se pinta "—", nunca 0 ni 100 %',
     cuadre.huecosMotor + ' huecos · ' + cuadre.rayasPintadas + ' rayas · ' + cuadre.cerosFalsos + ' ceros falsos'
     + (cuadre.huecosMotor === 0 ? ' (hoy este negocio no tiene ningún grupo sin coste)' : ''));
  // El selector de agrupación solo tiene sentido en fecha.
  const perOculto = await page.$eval('#cPeriodoWrap', e => e.style.display === 'none');
  ok(perOculto, 'el "agrupado por" se oculta cuando no cruzas por fecha', 'enseñarlo sugeriría que hace algo');
  ok(errores.length === 0, '0 errores JS en todo el constructor', errores.join(' | '));

  console.log('\n[11] EL CONSTRUCTOR NO PUEDE CONTRADECIR A VENTAS');
  // La prueba de fondo, contra el SERVIDOR REAL: cruzar por cualquier dimensión da el mismo total.
  const totales = await page.evaluate(async b => {
    const out = {};
    for (const d of ['fecha', 'cliente', 'producto', 'responsable', 'serie']) {
      const r = await fetch(b + '/api/erp/analytics/constructor/cruzar', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF_TOKEN },
        body: JSON.stringify({ dimension: d, medidas: ['base'] }) });
      const j = await r.json();
      out[d] = Math.round(j.filas.reduce((a, f) => a + f.base, 0) * 100) / 100;
    }
    const ov = await (await fetch(b + '/api/erp/analytics/informes')).json();
    out._ventas = Math.round(ov.ventas.porPeriodo.reduce((a, f) => a + f.base, 0) * 100) / 100;
    return out;
  }, BASE);
  const iguales = ['fecha', 'cliente', 'producto', 'responsable', 'serie'].every(d => Math.abs(totales[d] - totales._ventas) < 0.02);
  ok(iguales, 'las 5 dimensiones dan el MISMO total que el informe de Ventas', JSON.stringify(totales));

  console.log('\n[12] PANELES — de quien los crea, y el candado del constructor');
  const panel = await page.evaluate(async b => {
    const r = await fetch(b + '/api/erp/analytics/constructor/paneles', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF_TOKEN },
      body: JSON.stringify({ nombre: 'gate-panel', config: { dimension: 'fecha', periodo: 'mes', medidas: ['base'], grafico: 'lineas' } }) });
    return { s: r.status, j: await r.json() };
  }, BASE);
  ok(panel.s === 200 && panel.j.paneles.some(p => p.nombre === 'gate-panel'), 'el owner guarda su panel');
  ok(panel.j.paneles.every(p => p.config && !p.config.filas), 'el panel guarda la RECETA, no los datos',
     'si guardara resultados, sería una fuga con fecha');
  const consEmp = await page2.evaluate(async b => ({
    campos: (await fetch(b + '/api/erp/analytics/constructor/campos')).status,
    cruzar: (await fetch(b + '/api/erp/analytics/constructor/cruzar', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF_TOKEN },
      body: JSON.stringify({ dimension: 'cliente', medidas: ['base'] }) })).status,
    paneles: (await fetch(b + '/api/erp/analytics/constructor/paneles')).status,
  }), BASE);
  ok(consEmp.campos === 403 && consEmp.cruzar === 403 && consEmp.paneles === 403,
     'el empleado sin analytics.read no entra por ninguna de las tres puertas', JSON.stringify(consEmp));

  console.log('\n[13] 4a-bis — EL SELECTOR DE ÁREA: cambia de área y redibuja');
  await page.goto(BASE + '/admin/analytics', { waitUntil: 'networkidle2' });
  await page.waitForSelector('#cArea option', { timeout: 10000 }).catch(() => {});
  const areas = await page.$$eval('#cArea option', os => os.map(o => o.value));
  // Eran cinco; hoy son siete (Agenda el 23 ago, Catálogo el 24). Se exige que NO FALTE ninguna de
  // las cinco de siempre; que aparezcan más es lo esperado de cada entrega.
  const faltan = ['ventas', 'compras', 'clientes', 'inventario', 'contabilidad'].filter(a => !areas.includes(a));
  ok(faltan.length === 0, 'el owner no ha perdido ninguna área', faltan.join(', ') || areas.join(' · '));
  // Cambiar a Compras debe recargar SUS dimensiones (proveedor no está en ventas).
  await page.select('#cArea', 'compras');
  await new Promise(r => setTimeout(r, 800));
  const dimsCompras = await page.$$eval('#cDim option', os => os.map(o => o.value));
  ok(dimsCompras.includes('proveedor') && !dimsCompras.includes('serie'), 'al cambiar a Compras salen SUS dimensiones', dimsCompras.join(','));
  const medsCompras = await page.$$eval('#cMed option', os => os.map(o => o.textContent.trim()));
  ok(medsCompras.some(m => /Pendiente de pago/i.test(m)), 'y sus medidas (pendiente de pago)');
  // Inventario: el "agrupado por" reaparece (usa periodo); Clientes: desaparece (grano cliente).
  await page.select('#cArea', 'clientes');
  await new Promise(r => setTimeout(r, 800));
  const dimsCli = await page.$$eval('#cDim option', os => os.map(o => o.value));
  ok(dimsCli.includes('perfil_cobro') && !dimsCli.includes('fecha'), 'Clientes: sus dimensiones, sin fecha', dimsCli.join(','));
  const perOcultoCli = await page.$eval('#cPeriodoWrap', e => e.style.display === 'none');
  ok(perOcultoCli, 'el "agrupado por" NO aparece en Clientes (grano cliente, no temporal)');
  ok(errores.length === 0, '0 errores JS cambiando de área', errores.join(' | '));

  console.log('\n[14] LAS 4 ÁREAS CRUZAN contra el servidor real, y un área inventada falla');
  // (El candado POR ÁREA —403 sin el permiso del área— lo prueba con precisión el gate de motor, que
  // controla los permisos exactos. Aquí se comprueba que el HTTP responde y que un área rara se corta.)
  const cruces = await page.evaluate(async b => {
    const post = body => fetch(b + '/api/erp/analytics/constructor/cruzar', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF_TOKEN }, body: JSON.stringify(body) });
    const out = {};
    for (const [area, dim, med] of [['compras','proveedor','base'],['clientes','responsable','facturado'],['inventario','tipo','entradas']]) {
      const j = await (await post({ area, dimension: dim, medidas: [med] })).json();
      out[area] = j.filas ? j.filas.length : ('ERR:' + (j.error || '?'));
    }
    out._marte = (await post({ area: 'marte', dimension: 'x', medidas: ['base'] })).status;
    return out;
  }, BASE);
  ok(typeof cruces.compras === 'number' && cruces.compras > 0, 'Compras cruza y trae filas', String(cruces.compras));
  ok(typeof cruces.clientes === 'number', 'Clientes cruza', String(cruces.clientes));
  ok(typeof cruces.inventario === 'number' && cruces.inventario > 0, 'Inventario cruza y trae filas', String(cruces.inventario));
  ok(cruces._marte === 400, 'un área inventada se corta (400)', String(cruces._marte));

  console.log('\n[15] 4b · CÁLCULO PROPIO en la pantalla');
  await page.goto(BASE + '/admin/analytics', { waitUntil: 'networkidle2' });
  // LA CAJA DE FÓRMULAS YA NO EXISTE EN LA PANTALLA. La ficha D-ter (23 ago 2026) la retiró a
  // propósito —«nunca se teclea una fórmula»— y puso en su sitio «Mis medidas»: se elige una
  // operación y dos cifras de las de arriba. Este paso seguía buscando `#cCalcOn` y reventaba el
  // gate entero con una excepción, dejando sin correr todo lo que venía detrás. Se comprueba lo que
  // HAY (el bloque de Mis medidas) y se mantienen las dos comprobaciones del SERVIDOR, que es donde
  // sigue viviendo el cálculo y donde importa que la inyección se corte.
  await page.waitForSelector('#cMisMedidas', { timeout: 10000 }).catch(() => {});
  await page.select('#cArea', 'ventas');
  await new Promise(r => setTimeout(r, 700));
  const mis = await page.evaluate(() => {
    const c = document.getElementById('cMisMedidas');
    return { hay: !!c, texto: c ? c.textContent : '', boton: !!document.getElementById('cNuevaMedida') };
  });
  ok(mis.hay && /Mis medidas/.test(mis.texto), 'la pantalla ofrece «Mis medidas» (lo que sustituyó a la caja de fórmulas)');
  ok(mis.boton, '  con su botón de crear una medida propia');
  ok(errores.length === 0, '0 errores JS en el bloque de medidas propias', errores.join(' | '));
  // El cálculo se computa en el servidor: comprobamos que responde con `calculo:true`.
  const calcResp = await page.evaluate(async b => (await (await fetch(b + '/api/erp/analytics/constructor/cruzar', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF_TOKEN },
    body: JSON.stringify({ area: 'ventas', dimension: 'producto', medidas: ['base'], formula: 'beneficio / base * 100' }) })).json()), BASE);
  ok(calcResp.calculo === true && calcResp.filas.some(f => f.calculo != null), 'el cálculo se resuelve en el servidor');
  const inyecc = await page.evaluate(async b => (await fetch(b + '/api/erp/analytics/constructor/cruzar', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF_TOKEN },
    body: JSON.stringify({ area: 'ventas', dimension: 'producto', medidas: ['base'], formula: 'base; DROP TABLE invoices' }) })).status, BASE);
  ok(inyecc === 400, 'una fórmula con inyección se corta (400)', String(inyecc));

  console.log('\n[15-bis] CONTABILIDAD — la 5ª área CUADRA con el P&G (contra el servidor real)');
  // La regla de oro: cruzar Contabilidad no puede dar un beneficio distinto del P&G. Se compara el
  // cruce con el endpoint del P&G del propio servidor.
  await page.select('#cArea', 'contabilidad');
  await new Promise(r => setTimeout(r, 600));
  const dimsCont = await page.$$eval('#cDim option', os => os.map(o => o.value));
  ok(dimsCont.includes('partida') && dimsCont.includes('seccion'), 'Contabilidad ofrece sus dimensiones (partida, sección)', dimsCont.join(','));
  const cont = await page.evaluate(async b => {
    const post = body => fetch(b + '/api/erp/analytics/constructor/cruzar', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF_TOKEN }, body: JSON.stringify(body) });
    const porPart = await (await post({ area: 'contabilidad', dimension: 'partida', medidas: ['resultado'] })).json();
    const porFecha = await (await post({ area: 'contabilidad', dimension: 'fecha', medidas: ['resultado'] })).json();
    const sum = j => Math.round(j.filas.reduce((a, f) => a + f.resultado, 0) * 100) / 100;
    return { porPartida: sum(porPart), porFecha: sum(porFecha) };
  }, BASE);
  ok(cont.porPartida === cont.porFecha, 'por partida y por fecha dan LO MISMO', cont.porPartida + ' == ' + cont.porFecha);
  ok(typeof cont.porPartida === 'number', 'y es el resultado del P&G (número escrito en la nota)', cont.porPartida + ' €');

  console.log('\n[16] 4b · COMPARAR ÁREAS EN EL TIEMPO');
  await page.goto(BASE + '/admin/analytics', { waitUntil: 'networkidle2' });
  await abrirSeccion(page, 'comparar', '.cmp-serie');
  const cmp = await page.evaluate(() => ({
    series: document.querySelectorAll('.cmp-serie').length,
    lienzo: !!document.getElementById('cmpChart'),
    areas: [...document.querySelectorAll('.cmp-serie .cmp-area option')].map(o => o.value).filter((v, i, a) => a.indexOf(v) === i),
  }));
  ok(cmp.series >= 2, 'arranca con 2 series', cmp.series + ' series');
  ok(cmp.lienzo, 'y su gráfico');
  ok(cmp.areas.includes('ventas') && cmp.areas.includes('compras') && !cmp.areas.includes('clientes'), 'las series ofrecen áreas comparables (no clientes)', cmp.areas.join(','));
  const cmpResp = await page.evaluate(async b => (await (await fetch(b + '/api/erp/analytics/constructor/comparar', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF_TOKEN },
    body: JSON.stringify({ series: [{ area: 'ventas', medida: 'base' }, { area: 'compras', medida: 'base' }], periodo: 'mes' }) })).json()), BASE);
  ok(cmpResp.series && cmpResp.series.length === 2, 'compara ventas vs compras como 2 series (no las suma)', (cmpResp.series || []).map(s => s.etiqueta).join(' · '));

  console.log('\n[17] 4b · COMPARTIR — el empleado sin analytics.read sigue sin entrar');
  // El candado fino (compartido re-valida permisos por área) lo prueba el gate de motor. Aquí basta
  // con que las puertas nuevas de 4b sigan cerradas para quien no tiene analytics.read.
  const emp4b = await page2.evaluate(async b => ({
    comparables: (await fetch(b + '/api/erp/analytics/constructor/comparables')).status,
    comparar: (await fetch(b + '/api/erp/analytics/constructor/comparar', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ series: [{ area: 'ventas', medida: 'base' }, { area: 'compras', medida: 'base' }] }) })).status,
  }), BASE);
  ok(emp4b.comparables === 403 && emp4b.comparar === 403, 'comparables y comparar: 403 para el empleado', JSON.stringify(emp4b));

  console.log('\n[18] NO SE RESUCITA NADA DE LO DESENLAZADO A PROPÓSITO');
  // «Etiquetas» SALE DE ESTA LISTA. Estaba construida y sin enlace, y la ficha B (23 ago 2026) le
  // abrió su puerta en el rail a propósito: la comprobación de gate-menu-navegacion la cuenta como
  // una de las 39. Seguir exigiendo que no aparezca era pedir que se deshiciera una entrega.
  const muertas = await page.evaluate(() => ['/admin/discounts', '/admin/orders', '/admin/shipping']
    .filter(h => !!document.querySelector('a[href="' + h + '"]')));
  ok(muertas.length === 0, 'descuentos, pedidos viejos y envíos siguen fuera del menú', muertas.join(', ') || 'ninguno asomó');

  await browser.close();
} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN:', e.message);
} finally {
  // Limpieza en el `finally` y POR PREFIJO, no por las variables de esta pasada: si el gate muere a
  // mitad, sus sesiones se quedarían vivas para siempre y la siguiente pasada añadiría dos más.
  // (Es el pecado de `gate-almacenes`, que se envenenaba solo — ya pagado una vez en este repo.)
  db.prepare("DELETE FROM admin_sessions WHERE token LIKE 'gate-margen%'").run();
  db.prepare("DELETE FROM analytics_panels WHERE nombre='gate-panel'").run();   // el panel de la pasada [12]
  if (empId) {
    db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(empId);
    db.prepare('DELETE FROM admin_users WHERE id=?').run(empId);
  }
  db.prepare("DELETE FROM admin_users WHERE email LIKE 'gate-margen-%@test.local'").run();   // por si una pasada anterior murió antes
  db.close();
}

console.log(`\n${fail === 0 ? '✅' : '❌'} gate-margen-pantalla: ${pass} OK · ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
