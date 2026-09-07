// Gate del alta pública, PULSANDO en un navegador de verdad (regla de la casa: si el usuario
// pulsa un botón, la comprobación pulsa ESE botón). De principio a fin: formulario → crear →
// auto-login → panel del nuevo negocio, más lo que ya vivía aquí y sigue siendo válido: el
// vínculo asess→negocio, el login por /acceso tras el alta, y la contraprueba de contraseña mala.
//
// ⚙️ 7 SEP 2026 (`arreglar-alta-publica`) — REESCRITO. Este gate era una conversación completa con
// un modelo real (`init` → turnos de chat → `ready` → crear). El alta pública dejó de ser un chat:
// es un formulario de tres campos, sin sesión de conversación. Las secciones [4]-[6] de abajo
// (auto-login, vínculo por token, /find-tenant + /acceso/entrar, login con y sin contraseña
// correcta) no dependían del chat y se conservan tal cual, adaptadas solo en de dónde sale el
// email/contraseña (del formulario pulsado, no de un `session_id`).
//
// Crea un tenant de prueba y lo limpia al final.
import path from 'path';
import { unlinkSync } from 'fs';
import puppeteer from 'puppeteer';
import { controlDb, getTenantBySlug, getTenantByEmail } from '../core/control-db.js';
import BamburuDatabase from '../core/sqlite-bamburu/indice.cjs';

import { soltarAtaduras } from './lib/tirar-negocio.mjs';
const APEX = 'http://localhost:3000';
const RID = Math.random().toString(36).slice(2, 7);
const HJ = { 'Content-Type': 'application/json' };

let ok = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✓ ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ FALLO: ${label}${extra ? ' — ' + extra : ''}`); }
};

function cleanup(slug) {
  if (!slug) return;
  const t = getTenantBySlug(slug);
  if (t) controlDb.prepare('DELETE FROM tenant_sessions WHERE tenant_id=?').run(t.id);   // FK antes que el negocio
  // ⚙️ 3 SEP 2026 — SUELTA LAS ATADURAS ANTES DE BORRAR EL NEGOCIO. Desde el 2 de septiembre
  // `createTenant` siembra la prueba de 15 días, así que todo negocio nuevo tiene fila en
  // `tenant_suscripciones`: sin soltarla, el DELETE de abajo muere con FOREIGN KEY.
  soltarAtaduras(slug);
  controlDb.prepare('DELETE FROM tenants WHERE slug=?').run(slug);
  if (t) {
    const abs = path.isAbsolute(t.db_filename) ? t.db_filename : path.join(process.cwd(), t.db_filename);
    for (const f of [abs, abs + '-wal', abs + '-shm']) { try { unlinkSync(f); } catch {} }
  }
}

const CAPTURA = path.join(process.env.HOME || '/home/ubuntu', 'informes-shots', 'alta-publica-panel-vacio.png');

let createdSlug = null;
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/snap/bin/chromium',
  args: ['--no-sandbox'],
});
try {
  const email = `gate.alta.${RID}.${Date.now()}@ejemplo.com`;
  const bizName = `Negocio Gate ${RID}`;
  const password = 'clave-gate-1234';

  console.log('\n[1] La pantalla del alta es un formulario normal, sin chat');
  const page = await browser.newPage();
  await page.setViewport({ width: 440, height: 700 });
  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.goto(APEX + '/registro', { waitUntil: 'networkidle0' });

  const campos = await page.evaluate(() => ({
    businessName: !!document.getElementById('businessName'),
    email: !!document.getElementById('email'),
    password: !!document.getElementById('password'),
    // Y NADA MÁS: ni chat, ni paso de oficio, ni burbuja.
    hayChat: !!document.querySelector('.bubble, #disaFab, .oficio-grid, .oficio-btn'),
    handlersEnAtributos: /onclick=/.test(document.documentElement.outerHTML),
  }));
  check('trae el campo del nombre del negocio', campos.businessName);
  check('trae el campo del correo', campos.email);
  check('trae el campo de la contraseña', campos.password);
  check('y NADA MÁS — ni chat, ni paso de oficio', !campos.hayChat);
  check('los botones se enganchan por addEventListener, no por atributos (CSP estricta)', !campos.handlersEnAtributos);

  console.log('\n[2] PULSANDO: rellenar los TRES campos y crear el negocio de verdad');
  await page.type('#businessName', bizName);
  await page.type('#email', email);
  await page.type('#password', password);
  // Se espera la RESPUESTA de la petición, no solo la navegación: si algo va mal (un 429 del
  // freno anti-avalancha, un 500), la página no navega y antes esto se veía como un opaco
  // "Navigation timeout" — dice lo mismo diga lo que diga la causa. Así, si pasa, se sabe por qué.
  const [respCrear] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/api/registro/crear') && r.request().method() === 'POST', { timeout: 20000 }),
    page.click('#submit-btn'),
  ]);
  check('la petición de creación responde 200 (no un freno, no un error)', respCrear.status() === 200, 'status ' + respCrear.status());
  if (respCrear.ok()) {
    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 });
  }
  check('tras pulsar «Crear mi negocio», aterriza en /admin (panel del nuevo negocio)',
    page.url().replace(/\/$/, '').endsWith('/admin'), page.url());
  check('cero errores de JS en todo el recorrido', consoleErrors.length === 0, consoleErrors.join(' | '));

  const t = getTenantByEmail(email.toLowerCase());
  createdSlug = t?.slug || null;
  check('el negocio quedó creado y localizable por email', !!t, createdSlug);

  const panelHtml = await page.content();
  check('es el panel de verdad, no el login', !/Introduce tu contrase/i.test(panelHtml) && panelHtml.length > 500);
  await page.screenshot({ path: CAPTURA });
  console.log('  📸 captura del panel vacío:', CAPTURA);

  console.log('\n[3] La base del negocio nace CIFRADA, como todas desde el 6 sep 2026');
  const absPath = path.join(process.cwd(), 'data', 'tenants', createdSlug + '.db');
  let cifrada = false;
  try {
    // `{ bamburuSinLlave: true }` es la puerta explícita del punto único para abrir SIN la
    // llave — el mismo mecanismo que usa gate-cifrado-en-reposo.mjs. Si esto NO lanza, la base
    // está en claro, que sería el defecto: `import ... from 'better-sqlite3'` a secas ya no vale
    // para esta prueba porque ese paquete ES el punto único (aplica la llave por defecto).
    new BamburuDatabase(absPath, { readonly: true, fileMustExist: true, bamburuSinLlave: true })
      .prepare('SELECT count(*) FROM sqlite_master').get();
  } catch { cifrada = true; }
  check('sin la llave no se lee (nace cifrada)', cifrada);
  const bdb = new BamburuDatabase(absPath, { readonly: true });
  check('y con la llave del punto único sí se abre, íntegra', bdb.pragma('integrity_check', { simple: true }) === 'ok');
  check('el owner quedó creado con el email del formulario',
    bdb.prepare('SELECT email, role FROM admin_users WHERE role=?').get('owner')?.email === email.toLowerCase());
  bdb.close();

  console.log('\n[4] El MISMO correo dos veces no crea dos negocios: error claro, en la propia página');
  await page.goto(APEX + '/registro', { waitUntil: 'networkidle0' });
  await page.type('#businessName', 'Otro Negocio ' + RID);
  await page.type('#email', email);
  await page.type('#password', password);
  await page.click('#submit-btn');
  await page.waitForFunction(() => {
    const e = document.getElementById('form-err');
    return e && e.style.display !== 'none' && e.textContent.trim().length > 0;
  }, { timeout: 5000 }).catch(() => {});
  const dupErr = await page.evaluate(() => document.getElementById('form-err')?.textContent || '');
  check('el duplicado se pinta EN LA PÁGINA (no una alerta del navegador)', /existe|ya tienes|uso/i.test(dupErr), dupErr);
  check('sigue en /registro — no navegó a ningún sitio', page.url().includes('/registro'));
  const segundoNegocio = getTenantBySlug('otro-negocio-' + RID.toLowerCase());
  check('el segundo intento NO creó un negocio nuevo', !segundoNegocio);
  check('el primero sigue siendo el único con ese email', getTenantByEmail(email.toLowerCase())?.slug === createdSlug);

  console.log('\n[5] Auto-login: el vínculo cookie→negocio queda registrado (sin subdominio inventado)');
  const asess = (await page.cookies()).find(c => c.name === 'asess')?.value;
  check('la cookie de sesión asess quedó fijada tras el alta', !!asess);
  const bind = controlDb.prepare('SELECT tenant_id FROM tenant_sessions WHERE session_token=?').get(asess);
  check('vínculo asess→negocio apunta al NUEVO negocio', !!t && bind?.tenant_id === t.id, JSON.stringify(bind));

  console.log('\n[6] Login por /acceso tras el alta: credenciales correctas → entra; incorrectas → no');
  const ft = await fetch(APEX + '/find-tenant', { method: 'POST', headers: HJ, body: JSON.stringify({ email }) });
  check('/find-tenant responde lo genérico (sin decir si el email existe)',
    ft.status === 200 && (await ft.text()) === '{"mode":"sent"}');
  await new Promise(r => setTimeout(r, 400));   // el enlace se crea fuera de la respuesta (setImmediate)
  const enlace = controlDb.prepare('SELECT token FROM tenant_access_links WHERE email=? AND used_at IS NULL ORDER BY rowid DESC LIMIT 1').get(email);
  check('se creó el enlace de acceso para ese email', !!enlace);
  const entrar = await fetch(`${APEX}/acceso/entrar?token=${enlace?.token}`, { redirect: 'manual' });
  const ftCookie = entrar.headers.get('set-cookie') || '';
  const destino = entrar.headers.get('location') || '';
  check('el enlace del correo lleva al login de SU negocio',
    entrar.status === 302 && /\/admin\/login/.test(destino) && (destino.includes(createdSlug) || new RegExp('btenant=' + createdSlug).test(ftCookie)),
    destino);
  controlDb.prepare('DELETE FROM tenant_access_links WHERE email=?').run(email);

  const btenant = (ftCookie.match(/btenant=([^;]+)/) || [])[1] || createdSlug;
  const loginRes = await fetch(APEX + '/admin/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: 'btenant=' + btenant },
    body: new URLSearchParams({ email, password }).toString(),
  });
  check('login con credenciales CORRECTAS → 302 /admin', loginRes.status === 302 && loginRes.headers.get('location') === '/admin');
  const bad = await fetch(APEX + '/admin/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: 'btenant=' + btenant },
    body: new URLSearchParams({ email, password: 'mal-mal-mal' }).toString(),
  });
  check('contraseña incorrecta → NO entra', bad.status === 302 && bad.headers.get('location') !== '/admin', bad.headers.get('location'));

  // ⚙️ 7 sep 2026 — la contraseña corta rechazada por el servidor (no solo por el navegador) ya
  // se prueba en test-registro-alta.mjs, directo contra createTenantSvc/parseSignup, sin pasar
  // por el servidor HTTP. No se repite aquí A PROPÓSITO: /api/registro/crear lleva un freno de
  // 3/hora por IP (el anti-avalancha que pide este mismo encargo), y una tercera llamada real
  // en este gate lo dejaría al límite exacto — bastaría con volver a lanzarlo dentro de la misma
  // hora para que un 429 se leyera como una avería que no es.
} catch (e) {
  fail++; console.log('  ✗ EXCEPCIÓN:', e.message);
} finally {
  await browser.close();
  console.log('\n[limpieza] eliminando el tenant de prueba:', createdSlug);
  try { cleanup(createdSlug); console.log('  ✓ tenant de prueba eliminado'); }
  catch (e) { console.log('  ✗ no se pudo limpiar:', e.message); }
}

console.log(`\n===== RESULTADO: ${ok} OK, ${fail} fallos =====`);
process.exit(fail ? 1 : 0);
