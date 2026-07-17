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
  await page.waitForSelector('#mgBody tr', { timeout: 10000 }).catch(() => {});
  const ben = await page.$eval('#mBen', e => e.textContent.trim()).catch(() => null);
  const pct = await page.$eval('#mPct', e => e.textContent.trim()).catch(() => null);
  ok(ben && ben !== '-', 'el beneficio se pinta', ben);
  ok(pct && pct !== '-', 'el margen % se pinta', pct);
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
  await page.waitForSelector('#respBody tr', { timeout: 10000 }).catch(() => {});
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
  await page.waitForSelector('#infBody table', { timeout: 10000 }).catch(() => {});
  const tabs = await page.$$eval('#infTabs .tab', ts => ts.map(t => t.textContent.trim()));
  ok(tabs.join(',') === 'Ventas,Compras,Clientes', 'las tres pestañas existen', tabs.join(' · '));
  const ventasTablas = await page.$$eval('#infBody table', ts => ts.length);
  ok(ventasTablas >= 4, 'Ventas trae sus 4 informes', ventasTablas + ' tablas');
  // Se PULSA: que una pestaña exista no demuestra que pinte.
  await page.click('#infTabs .tab[data-area="compras"]');
  await new Promise(r => setTimeout(r, 300));
  const comprasTxt = await page.$eval('#infBody', e => e.textContent);
  ok(/Gasto por categoría/i.test(comprasTxt), 'al pulsar Compras, pinta sus informes');
  ok(/Abono a tu favor|Vencida|Aún no vencida/i.test(comprasTxt), 'y los tramos llevan su etiqueta en cristiano');
  await page.click('#infTabs .tab[data-area="clientes"]');
  await new Promise(r => setTimeout(r, 300));
  const cliTxt = await page.$eval('#infBody', e => e.textContent);
  ok(/dormidos/i.test(cliTxt) && /Ranking/i.test(cliTxt), 'al pulsar Clientes, pinta los suyos');
  ok(errores.length === 0, '0 errores JS tras pulsar las tres', errores.join(' | '));

  console.log('\n[9] PASO 3 — PLAN FINANCIERO: la pantalla y su candado');
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

  console.log('\n[10] NO SE RESUCITA NADA DE LO DESENLAZADO A PROPÓSITO');
  const muertas = await page.evaluate(() => ['/admin/discounts', '/admin/tags', '/admin/orders', '/admin/shipping']
    .filter(h => !!document.querySelector('a[href="' + h + '"]')));
  ok(muertas.length === 0, 'descuentos, etiquetas, pedidos viejos y envíos siguen fuera del menú', muertas.join(', ') || 'ninguno asomó');

  await browser.close();
} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN:', e.message);
} finally {
  // Limpieza en el `finally` y POR PREFIJO, no por las variables de esta pasada: si el gate muere a
  // mitad, sus sesiones se quedarían vivas para siempre y la siguiente pasada añadiría dos más.
  // (Es el pecado de `gate-almacenes`, que se envenenaba solo — ya pagado una vez en este repo.)
  db.prepare("DELETE FROM admin_sessions WHERE token LIKE 'gate-margen%'").run();
  if (empId) {
    db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(empId);
    db.prepare('DELETE FROM admin_users WHERE id=?').run(empId);
  }
  db.prepare("DELETE FROM admin_users WHERE email LIKE 'gate-margen-%@test.local'").run();   // por si una pasada anterior murió antes
  db.close();
}

console.log(`\n${fail === 0 ? '✅' : '❌'} gate-margen-pantalla: ${pass} OK · ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
