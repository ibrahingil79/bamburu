// ════════════════════════════════════════════════════════════════════════════════════════════════
// GATE — LA PUERTA DE LA MIGRACIÓN ASISTIDA (ficha B: B1 · B2 · B3).
//
// LO QUE ESTE GATE EXISTE PARA IMPEDIR:
//   1. Que una función construida se quede SIN PUERTA. La migración asistida existía desde el 19 ago
//      y solo se alcanzaba por dos sitios que se pliegan o están enterrados: el panel «Pon en marcha
//      tu negocio» (desaparece con la primera factura) y una tarjeta dentro de Datos del negocio.
//      Un dueño nuevo no llegaba sin que alguien le pasara la dirección a mano.
//   2. Que la puerta se pinte pero NO SE PUEDA PULSAR. Aquí no se comprueba que el enlace exista en
//      el HTML: se PULSA, y se exige que la URL final sea la pedida. Media docena de pantallas de
//      este producto responden 200 y redirigen a otra parte.
//   3. Que el rail se coma la segunda entrada del pie. Hasta hoy `railHTML` cogía la del pie con un
//      `find`: con dos, la segunda no se habría pintado NUNCA, y sin error ninguno.
//   4. Que una puerta nueva ABRA lo que estaba cerrado. Las entradas fijas del rail no pasaban por
//      el filtro de permisos —el propio código lo avisaba— y la migración tiene candado. Se
//      comprueba con un empleado real: ni la ve, ni la busca, ni entra.
//
//   node scripts/gate-migracion-puerta.mjs
import puppeteer from 'puppeteer';
import path from 'path';
import { readFileSync, unlinkSync } from 'fs';
import { randomBytes } from 'crypto';
import Database from 'better-sqlite3';
import { launchOpts } from './lib/gate-env.mjs';
import { controlDb, getTenantBySlug } from '../core/control-db.js';
import { provisionTenant } from '../core/tenant-provisioning.js';

const RID = randomBytes(3).toString('hex');
const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dormir = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (c, m, x = '') => { if (c) { pass++; console.log('  ✓ ' + m + (x ? ' — ' + x : '')); } else { fail++; console.error('  ✗ FALLO: ' + m + (x ? ' — ' + x : '')); } };

const tenants = [];
function limpiar() {
  for (const { slug, db } of tenants) {
    try { if (db) db.close(); } catch {}
    const t = getTenantBySlug(slug);
    if (t) controlDb.prepare('DELETE FROM tenant_sessions WHERE tenant_id=?').run(t.id);
    controlDb.prepare('DELETE FROM tenants WHERE slug=?').run(slug);
    if (t) {
      const abs = path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP, t.db_filename);
      for (const f of [abs, abs + '-wal', abs + '-shm']) { try { unlinkSync(f); } catch {} }
    }
  }
}

// UN NEGOCIO DE CERO, que es la condición del encargo: «creas un negocio de cero y llegas a la
// migración solo desde el menú». No vale el negocio de desarrollo, que ya tiene de todo.
async function nuevoNegocio(nombre) {
  const r = randomBytes(3).toString('hex');
  const alta = await provisionTenant({ businessName: nombre + ' ' + r, ownerName: 'Dueña ' + r,
    email: 'gmp-' + r + '@bamburu.test', password: 'Gate.Mig.' + r + '!', phone: '+34 600 000 000' });
  const t = getTenantBySlug(alta.slug);
  const db = new Database(path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP, t.db_filename));
  tenants.push({ slug: alta.slug, db });
  const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner'").get();
  return { slug: alta.slug, db, owner, tok: sesion(db, owner.id), base: 'http://' + alta.slug + '.localhost:3000' };
}
function sesion(db, userId) {
  const now = Math.floor(Date.now() / 1000), tok = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tok, userId, now, now + 3600, randomBytes(32).toString('base64url'));
  return tok;
}
// Pestaña con contexto PROPIO: dos pestañas del mismo browser comparten cookies y la segunda sesión
// pisa a la primera, fingiendo rojos que no existen.
async function pestana(browser, N, tok) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
  await page.setCookie({ name: 'asess', value: tok, domain: N.slug + '.localhost', path: '/' });
  return { ctx, page };
}

let browser = null;
try {
  browser = await puppeteer.launch(launchOpts());

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] UN NEGOCIO DE CERO: LA PUERTA ESTÁ EN EL RAIL Y SE PULSA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const N = await nuevoNegocio('Puerta Migracion');
  const { page } = await pestana(browser, N, N.tok);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));
  await page.goto(N.base + '/admin', { waitUntil: 'networkidle0' });
  await dormir(1200);

  // Medido el 23 ago 2026 en un negocio recién creado: el pie del rail son `a.nav-item` dentro de
  // `.sb-nav`, y solo hay DOS (las áreas se pintan con otra clase). Por eso la cuenta es exacta.
  const pie = await page.evaluate(() => [...document.querySelectorAll('.sb-nav a.nav-item')].map(a => ({
    label: ((a.querySelector('.nav-label') || {}).textContent || a.title || '').trim(),
    href: a.getAttribute('href'),
    visible: !!(a.offsetWidth || a.offsetHeight),
  })));
  const trae = pie.find(i => i.href === '/admin/migracion');
  ok(!!trae, 'en un negocio RECIÉN CREADO el rail trae la entrada a la migración', JSON.stringify(pie.map(p => p.label)));
  ok(!!trae && trae.visible, 'y está VISIBLE, no escondida detrás de nada');
  ok(!!trae && trae.label === 'Trae tus datos', 'con el nombre que entiende un dueño, no «migración asistida»', trae ? trae.label : '—');
  // LA AYUDA NO SE PIERDE: es la que estaba antes en el pie, y el cambio de `find` a `filter` es
  // justo lo que podría habérsela comido.
  ok(pie.some(i => i.href === '/docs'), 'y «Ayuda y soporte» SIGUE en el pie: la segunda entrada no pisa a la primera');

  // SE PULSA. No se comprueba que el href exista: se hace clic y se exige la URL final.
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('.sb-nav a.nav-item[href="/admin/migracion"]'),
  ]);
  await dormir(800);
  const tras = await page.evaluate(() => ({ url: location.pathname, h1: (document.querySelector('h1,h2') || {}).textContent || '' }));
  ok(tras.url === '/admin/migracion', 'AL PULSARLA SE LLEGA, sin teclear una sola dirección', tras.url);
  ok(/trae tus datos/i.test(tras.h1), 'y la pantalla que aparece es la de la migración', tras.h1.trim().slice(0, 40));

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] EL BUSCADOR RÁPIDO LA ENCUENTRA POR LAS PALABRAS DE UN DUEÑO');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  await page.goto(N.base + '/admin', { waitUntil: 'networkidle0' });
  await dormir(900);
  const buscar = async termino => {
    await page.evaluate(() => { const i = document.getElementById('tbq'); i.value = ''; i.focus(); });
    await page.type('#tbq', termino);
    await dormir(500);
    return page.evaluate(() => [...document.querySelectorAll('#tbres .tb-res-i')].map(a => ({
      t: ((a.querySelector('.tb-res-tx') || {}).textContent || '').trim(), h: a.getAttribute('href') })));
  };
  // «Holded» es un ALIAS, no el nombre. Es la prueba de que los alias de las entradas fijas viajan al
  // buscador: hasta hoy `destinosBuscador` las mandaba con `alias: []` fijo.
  const rHolded = await buscar('Holded');
  ok(rHolded.some(r => r.h === '/admin/migracion'), 'buscar «Holded» la encuentra (es un alias, no su nombre)', JSON.stringify(rHolded));
  const rImportar = await buscar('importar');
  ok(rImportar.some(r => r.h === '/admin/migracion'), 'y «importar» también', JSON.stringify(rImportar.map(r => r.t)));
  const rTrae = await buscar('trae');
  ok(rTrae.some(r => r.h === '/admin/migracion'), 'y su nombre propio, claro');

  // Y se llega PULSANDO el resultado, que es lo que hace un dueño.
  await page.evaluate(() => { const i = document.getElementById('tbq'); i.value = ''; i.focus(); });
  await page.type('#tbq', 'Quipu');
  await dormir(500);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('#tbres .tb-res-i[href="/admin/migracion"]'),
  ]);
  ok(await page.evaluate(() => location.pathname) === '/admin/migracion',
     'y pulsando el resultado del buscador se llega a la pantalla');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] B2 — ETIQUETAS, LA OTRA PANTALLA QUE ESTABA SIN PUERTA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  await page.goto(N.base + '/admin', { waitUntil: 'networkidle0' });
  await dormir(900);
  const dest = await page.evaluate(() => (window.MENU_DESTINOS || []).map(d => ({ l: d.label, h: d.href, a: d.area })));
  const tag = dest.find(d => d.h === '/admin/tags');
  ok(!!tag, 'Etiquetas ya es un destino del menú (llevaba sin enlace desde U7, 8 jul)', tag ? tag.l + ' · ' + tag.a : '—');
  ok(!!tag && tag.a === 'Catálogo', 'y vive en Catálogo, junto a Categorías', tag ? tag.a : '—');
  const rTags = await buscar('etiquetas');
  ok(rTags.some(r => r.h === '/admin/tags'), 'el buscador la encuentra');
  await page.goto(N.base + '/admin/tags', { waitUntil: 'networkidle0' });
  await dormir(600);
  const vTags = await page.evaluate(() => ({ url: location.pathname, h2: (document.querySelector('.ph h2') || {}).textContent || '' }));
  ok(vTags.url === '/admin/tags' && /etiquetas/i.test(vTags.h2),
     'y la pantalla RESPONDE y es la suya (no una redirección con 200)', vTags.url + ' · ' + vTags.h2.trim());

  // DESCUENTOS NO SE ENLAZA, y eso es una decisión, no un olvido: sus tablas solo las leen la tienda
  // (Capa 2, congelada) y el POS viejo, desmontado. Si alguien la mete en el menú sin quitar antes
  // ese motivo, este gate lo dice.
  ok(!dest.some(d => d.h === '/admin/discounts'),
     'Descuentos sigue FUERA del menú a propósito (Capa 2 congelada + POS desmontado; apuntada para desmontar)');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] LA PUERTA NUEVA NO ABRE NADA: EL CANDADO ES EL DE LA PANTALLA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Un empleado de verdad, con `clients.read` y nada más. Sin `company.read` no puede ver la
  // migración: no debe verla en el rail, ni encontrarla en el buscador, ni entrar forzando la ruta.
  const uid = N.db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active,must_change_password,created_at) VALUES ('Sin Empresa',?,'x','employee',1,0,datetime('now'))")
    .run('se-' + RID + '@bamburu.test').lastInsertRowid;
  const permCl = N.db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get('clients', 'read');
  if (permCl) N.db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id,permission_id) VALUES (?,?)').run(uid, permCl.id);
  const { page: pe } = await pestana(browser, N, sesion(N.db, uid));
  await pe.goto(N.base + '/admin', { waitUntil: 'networkidle0' });
  await dormir(1000);
  const emp = await pe.evaluate(async () => ({
    pie: [...document.querySelectorAll('.sb-nav a.nav-item')].map(a => a.getAttribute('href')),
    destinos: (window.MENU_DESTINOS || []).map(d => d.href),
    status: (await fetch('/admin/migracion', { cache: 'no-store' })).status,
  }));
  ok(!emp.pie.includes('/admin/migracion'), 'un empleado sin company.read NO ve la entrada en el rail', JSON.stringify(emp.pie));
  ok(!emp.destinos.includes('/admin/migracion'), 'ni la encuentra en el buscador');
  ok(emp.status === 403, 'y forzando la dirección recibe 403, como antes de este encargo', String(emp.status));
  // Y lo que NO puede pasar: que al filtrar las fijas se le haya cerrado la ayuda o el inicio a nadie.
  ok(emp.pie.includes('/docs'), 'pero la ayuda le sigue estando: filtrar las fijas no le quitó lo que ya tenía');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] B3 — DISA PUEDE ENLAZARLA, Y HACEN FALTA LAS DOS MITADES');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // La lista blanca PERMITE la URL; el prompt es lo que le dice a DISA que existe. Con solo una de
  // las dos, DISA nunca la enlaza (o la enlaza y el sanitizador se la borra). Se exigen las dos.
  const disa = readFileSync(path.join(APP, 'modules/disa/index.js'), 'utf8');
  const enBlanca = /DISA_ALLOWED_URLS[\s\S]{0,1600}?'\/admin\/migracion'/.test(disa);
  const enPrompt = /URLs PERMITIDAS EN ARTIFACTS[\s\S]{0,900}?'\/admin\/migracion'/.test(disa);
  ok(enBlanca, 'la URL está en la lista blanca del sanitizador (si no, DISA la propone y se le borra)');
  ok(enPrompt, 'y en la lista del prompt (si no, DISA no sabe que existe y nunca la propone)');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[6] LAS OTRAS DOS PUERTAS SIGUEN, Y LA MIGRACIÓN POR DENTRO NO SE HA TOCADO');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // El encargo dice «solo la puerta». Si esta entrega hubiera movido algo de dentro, o hubiera
  // sustituido las puertas que ya había en vez de sumarse a ellas, esto lo dice.
  await page.goto(N.base + '/admin', { waitUntil: 'networkidle0' });
  await dormir(1200);
  const onb = await page.evaluate(() => [...document.querySelectorAll('.onb-step')]
    .some(a => (a.getAttribute('href') || '') === '/admin/migracion'));
  ok(onb, 'el paso del panel «Pon en marcha tu negocio» sigue llevando a la migración');
  const set = await page.evaluate(async () => (await (await fetch('/admin/settings', { cache: 'no-store' })).text())
    .includes('href="/admin/migracion"'));
  ok(set, 'y la tarjeta de «Datos del negocio» también: son tres puertas, no una que sustituye a dos');

  // La pantalla de la migración, entera y sana. Se compila el HTML tal y como sale del SERVIDOR: un
  // error de sintaxis en un script en línea no emite ningún evento, y el navegador RECORTA el trozo
  // roto, así que ni la consola ni el DOM lo delatan.
  const crudo = await page.evaluate(async () => await (await fetch('/admin/migracion', { cache: 'no-store' })).text());
  const scripts = [...crudo.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  const rotos = [];
  for (const s of scripts) { try { new Function(s); } catch (e) { rotos.push(String(e.message || e)); } }
  ok(scripts.length > 0 && rotos.length === 0,
     'la pantalla de migración compila entera desde el HTML crudo', scripts.length + ' scripts, ' + rotos.length + ' rotos' + (rotos[0] ? ' :: ' + rotos[0] : ''));
  ok(errs.length === 0, 'y en todo el recorrido no hubo un solo error de JavaScript', errs.join(' | ') || 'ninguno');

} catch (e) {
  fail++;
  console.error('\n✗ EXCEPCIÓN: ' + (e && e.stack || e));
} finally {
  if (browser) { try { await browser.close(); } catch {} }
  limpiar();
}

console.log('\n══ RESUMEN ══');
console.log(`${pass} OK · ${fail} fallos`);
process.exit(fail ? 1 : 0);
