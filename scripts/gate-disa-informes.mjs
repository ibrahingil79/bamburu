// GATE DEL PUNTO 10 — DISA abre y compone informes por chat, con los MISMOS permisos que la pantalla.
//   node scripts/gate-disa-informes.mjs
//
// EL PRINCIPIO QUE SE MIDE es el de las DOS PUERTAS (CANON §3-bis): toda información de negocio se
// alcanza por DISA **y** por la vía visual, ninguna sustituye a la otra, y **las dos respetan los
// mismos permisos**. Así que lo importante aquí no es que DISA sepa contestar: es que conteste
// EXACTAMENTE lo mismo que la pantalla, y que NO conteste lo que la pantalla tampoco enseñaría.
//
// Se prueban LAS FUNCIONES QUE CORRE DISA (modules/disa/informes.js), no una copia escrita para la
// prueba; y el enlace que devuelve se ABRE EN UN NAVEGADOR, porque un enlace que no lleva a ninguna
// parte es peor que no darlo.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { tenantDb, launchOpts } from './lib/gate-env.mjs';
import { herramientasDeInformes, TOOLS_INFORMES, NOMBRES_INFORMES } from '../modules/disa/informes.js';
import { cruzar, guardarPanel, borrarPanel } from '../modules/erp/constructor-analitica.js';

const SLUG = 'desarrollo-bamburu';
const HOST = SLUG + '.bamburu.com', BASE = 'https://' + HOST;
const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
const RID = randomBytes(3).toString('hex');
const MARCA = 'GDI-' + RID;
const TOKEN_PREFIJO = 'gate-disainf-';
const dormir = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m, det) => { if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ ' + m + (det ? ' · ' + det : '')); } };

const db = new Database(tenantDb(SLUG));
db.pragma('busy_timeout = 10000');
const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
const otro = db.prepare("SELECT id FROM admin_users WHERE active=1 AND id<>? ORDER BY id LIMIT 1").get(owner.id);
const tok = TOKEN_PREFIJO + randomBytes(20).toString('hex');
const ahora = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(tok, owner.id, ahora, ahora + 3600, randomBytes(20).toString('hex'));

let browser = null, panelMio = null, panelCompartido = null;
try {
  // El gate se trae SUS informes: uno propio de Ventas y uno COMPARTIDO de Compras. Sin esto
  // dependería de que el negocio tenga informes guardados, que hoy tiene CERO.
  panelMio = guardarPanel(db, owner.id, { nombre: MARCA + ' mio', compartido: false,
    config: { area: 'ventas', dimension: 'fecha', periodo: 'mes', medidas: ['base'], rango: '12m', grafico: 'lineas' } });
  panelCompartido = guardarPanel(db, otro ? otro.id : owner.id, { nombre: MARCA + ' compartido', compartido: true,
    config: { area: 'compras', dimension: 'proveedor', periodo: 'mes', medidas: ['base'], rango: '12m', grafico: 'barras' } }, true);

  const TODO = () => true;
  const dueno = herramientasDeInformes(db, { userId: owner.id, hasPerm: TODO });

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] LA PUERTA EXISTE — y está declarada para el modelo');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  ok(TOOLS_INFORMES.length === 4, 'DISA tiene cuatro herramientas de informes',
     TOOLS_INFORMES.map(t => t.name).join(', '));
  const src = fs.readFileSync(path.join(RAIZ, 'modules/disa/index.js'), 'utf8');
  ok(/const tools = \[\.\.\.INFORMES_TOOL\.TOOLS/.test(src), '  y van de verdad en la lista que se le manda al modelo');
  ok(/NOMBRES_INFORMES\.has\(toolUse\.name\)/.test(src), '  y el bucle sabe despacharlas');
  ok(/listar_informes|componer_informe/.test(src.split('## CAPACIDADES Y LIMITES')[1] || ''),
     '  y el prompt le dice que existen (una herramienta que no sabe que tiene, no la usa)');

  console.log('\n[2] LEER: listar y abrir');
  const lista = dueno.listar();
  ok(lista.informes.some(i => i.id === panelMio.id), 'lista el informe propio', lista.informes.length + ' informes');
  ok(lista.informes.some(i => i.id === panelCompartido.id), '  y el compartido de otra persona');
  const abierto = dueno.abrir(panelMio.id);
  ok(!abierto.error && Array.isArray(abierto.filas), 'abre uno y devuelve sus filas', (abierto.filas || []).length + ' filas');
  ok(/^\/admin\/analytics\?panel=/.test(abierto.enlace || ''), '  con el enlace para verlo en pantalla', abierto.enlace);
  ok(/error/i.test(JSON.stringify(dueno.abrir(9999999))), 'y un id que no existe se dice, no se inventa');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] LAS DOS PUERTAS DAN EL MISMO NÚMERO — o no son dos puertas, son dos verdades');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const porPantalla = cruzar(db, { area: 'ventas', dimension: 'fecha', periodo: 'mes',
                                   medidas: ['base'], rango: '12m', hasPerm: TODO, limit: 30 });
  const porChat = dueno.componer({ area: 'ventas', quiero_saber: 'base', repartido_por: 'fecha', periodo: '12m', paso: 'mes' });
  ok(JSON.stringify(porChat.filas) === JSON.stringify(porPantalla.filas),
     'componer por chat da EXACTAMENTE las mismas filas que el cruce de la pantalla',
     (porChat.filas || []).length + ' filas idénticas');
  ok(porChat.periodo === porPantalla.rangoEtiqueta, '  y el mismo periodo', String(porChat.periodo));
  ok(/^\/admin\/analytics\?area=ventas/.test(porChat.enlace || ''), '  y un enlace con la receta dentro', porChat.enlace);
  ok(/no se guarda/i.test(porChat.nota || ''), '  y dice que guardar se hace en la pantalla, no aquí');

  console.log('\n[4] LOS MISMOS PERMISOS QUE LA PANTALLA — falla cerrado');
  const sinCompras = herramientasDeInformes(db, { userId: owner.id, hasPerm: p => p !== 'purchases.read' });
  const l2 = sinCompras.listar();
  ok(!l2.informes.some(i => i.id === panelCompartido.id),
     'un informe COMPARTIDO de un área que no puedes ver NO se lista');
  ok(l2.ocultos_por_permiso >= 1, '  y se DICE cuántos se esconden (no es lo mismo que no existan)',
     l2.ocultos_por_permiso + ' oculto(s)');
  const abrirProhibido = sinCompras.abrir(panelCompartido.id);
  ok(!!abrirProhibido.error, 'y abrirlo a la fuerza tampoco: falla cerrado', (abrirProhibido.error || '').slice(0, 70));
  const componerProhibido = sinCompras.componer({ area: 'compras', quiero_saber: 'base', repartido_por: 'proveedor' });
  ok(!!componerProhibido.error && componerProhibido.status === 403,
     'y componer uno de un área sin permiso da 403, no un cero', (componerProhibido.error || '').slice(0, 60));
  const cat = sinCompras.catalogo();
  ok(!cat.areas.compras && !!cat.areas.ventas, 'el catálogo que se le enseña al modelo ya viene filtrado',
     Object.keys(cat.areas).join(','));
  // Y el que no ve facturas tampoco ve las medidas de dinero del catálogo (candado por medida).
  const sinFacturas = herramientasDeInformes(db, { userId: owner.id, hasPerm: p => p !== 'invoices.read' });
  const catSF = sinFacturas.catalogo();
  ok(catSF.areas.catalogo && !catSF.areas.catalogo.quiero_saber.importe,
     '  hasta el nivel de MEDIDA: sin permiso de facturas no se le ofrece «Facturado»');

  console.log('\n[5] NO ESCRIBE NADA');
  const antes = db.prepare('SELECT COUNT(*) n FROM analytics_panels').get().n;
  dueno.componer({ area: 'ventas', quiero_saber: 'base', repartido_por: 'cliente' });
  dueno.abrir(panelMio.id); dueno.listar(); dueno.catalogo();
  ok(db.prepare('SELECT COUNT(*) n FROM analytics_panels').get().n === antes,
     'después de listar, abrir y componer, no ha nacido ni un informe', antes + ' antes y después');
  const srcInf = fs.readFileSync(path.join(RAIZ, 'modules/disa/informes.js'), 'utf8');
  ok(!/INSERT|UPDATE|DELETE|guardarPanel|borrarPanel/.test(srcInf),
     'y el módulo no tiene una sola línea que escriba');
  ok(!/analytics_panels/.test((src.match(/const WRITABLE_TABLES = new Set\(\[[\s\S]*?\]\)/) || [''])[0]),
     'analytics_panels sigue FUERA de WRITABLE_TABLES');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[6] EL ENLACE LLEVA A ALGUNA PARTE — se abre en un navegador de verdad');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  browser = await puppeteer.launch(launchOpts());
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
  await page.setCookie({ name: 'asess', value: tok, domain: HOST, path: '/', secure: true });
  const errores = [];
  page.on('pageerror', e => errores.push(String(e && e.message || e)));
  page.on('dialog', async d => { errores.push('VENTANITA: ' + d.type()); await d.dismiss(); });

  await page.goto(BASE + porChat.enlace, { waitUntil: 'networkidle0' });
  await dormir(2600);
  const conReceta = await page.evaluate(() => ({
    area: (document.getElementById('cArea') || {}).value,
    dim: (document.getElementById('cDim') || {}).value,
    med: (document.getElementById('cMed') || {}).value,
    visible: document.getElementById('cardConstructor') ? getComputedStyle(document.getElementById('cardConstructor')).display : 'none',
  }));
  ok(conReceta.area === 'ventas' && conReceta.dim === 'fecha' && conReceta.med === 'base',
     'el enlace de una receta deja el constructor puesto en ella',
     conReceta.area + '/' + conReceta.dim + '/' + conReceta.med);
  ok(conReceta.visible !== 'none', '  y el constructor abierto, no escondido');

  await page.goto(BASE + abierto.enlace, { waitUntil: 'networkidle0' });
  await dormir(2600);
  const conPanel = await page.evaluate(() => ({
    area: (document.getElementById('cArea') || {}).value,
    texto: document.body.innerText.replace(/\s+/g, ' '),
  }));
  ok(conPanel.area === 'ventas', 'y el enlace de un informe guardado lo abre', conPanel.area);
  ok(conPanel.texto.includes(String(MARCA)), '  con su nombre a la vista');
  // Un enlace a un informe que no es tuyo NO puede abrirlo: lo dice y no pinta nada ajeno.
  await page.goto(BASE + '/admin/analytics?panel=9999999', { waitUntil: 'networkidle0' });
  await dormir(2000);
  const inexistente = await page.evaluate(() => (document.getElementById('cardConstructor') || {}).style?.display);
  ok(inexistente === 'none' || inexistente === '', 'y un enlace a un informe que no existe no revienta la pantalla');
  ok(errores.length === 0, 'sin errores de JavaScript ni ventanitas', errores.join(' | ') || 'ninguno');
  await page.screenshot({ path: path.join(process.env.HOME || '/home/ubuntu', 'informes-shots', 'punto10-disa.png') });

} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN: ' + e.message + '\n' + e.stack);
} finally {
  try { if (browser) await browser.close(); } catch {}
  try {
    db.prepare("DELETE FROM analytics_panels WHERE nombre LIKE 'GDI-%'").run();
    db.prepare("DELETE FROM admin_sessions WHERE token LIKE '" + TOKEN_PREFIJO + "%'").run();
  } catch (e) { console.error('  (limpieza incompleta: ' + e.message + ')'); }
  try { db.close(); } catch {}
}

console.log(`\n${'─'.repeat(70)}\nRESULTADO: ${pass} ✓  ·  ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
