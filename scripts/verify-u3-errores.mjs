// U3 — smoke de mensajes de error (navegador real, tenant desarrollo).
// Fuerza UN caso de cada mecanismo y comprueba que sale el TEXTO NUEVO dentro de la maqueta,
// más 0 errores JS. No muta datos reales (crea/borra 1 categoría de prueba; el resto no muta).
//   node scripts/verify-u3-errores.mjs
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import puppeteer from 'puppeteer';

const DB = 'data/tenants/desarrollo-bamburu.db';
const ORIGIN = 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Captura robusta de toasts: envuelve window.toast y guarda los mensajes en window.__toasts.
const hookToasts = (page) => page.evaluate(() => { window.__toasts = []; const _t = window.toast; window.toast = function (m, ty) { window.__toasts.push(String(m)); return typeof _t === 'function' ? _t(m, ty) : undefined; }; });
const toastHas = (page, re, timeout = 6000) => page.waitForFunction(
  (src) => { const rx = new RegExp(src); return (window.__toasts || []).some(t => rx.test(t)); },
  { timeout }, re.source).then(() => true).catch(() => false);

const db = new Database(DB);
const token = randomBytes(24).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 3600, randomBytes(8).toString('hex'));
db.close();

const jsErrors = [];
// 24 ago 2026 · SIN `userDataDir` FIJO, A PROPOSITO. Un perfil fijo hace que dos comprobaciones a la vez
// se maten con «The browser is already running» — mensaje enganoso: puppeteer lo lanza en cuanto Chromium
// dice «Failed to create a ProcessSingleton», y el snap no puede poner su cerrojo ahi. Sin la opcion,
// puppeteer levanta un perfil temporal unico por arranque. Ver scripts/lib/copia-consistente.mjs (misma familia).
const browser = await puppeteer.launch({ headless: 'new', executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.setCookie({ name: 'asess', value: token, domain: '127.0.0.1', path: '/' }, { name: 'btenant', value: 'desarrollo-bamburu', domain: '127.0.0.1', path: '/' });
let sawAlert = false;
page.on('dialog', async d => { if (d.type() === 'alert') sawAlert = true; try { await d.accept(''); } catch (_e) {} });
// "Failed to load resource" = respuesta HTTP no-2xx (404/400/500/403) que provocamos a PROPÓSITO;
// no es un error de JS. Solo contamos errores de JS reales (pageerror + console.error de código).
const isRealJsError = (t) => !/Failed to load resource/.test(t);
page.on('pageerror', e => jsErrors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && isRealJsError(m.text())) jsErrors.push('console.error: ' + m.text()); });

try {
  console.log('\n=== U3 — smoke de errores (navegador) ===\n');

  // 1) TEXTO PLANO → MAQUETA: ficha de documento inexistente
  await page.goto(ORIGIN + '/admin/invoices/9999999', { waitUntil: 'networkidle0' });
  let body = await page.evaluate(() => document.body.innerText);
  let hasCard = await page.evaluate(() => !!document.querySelector('.e-card'));
  ok(/No encontramos esta factura/.test(body) && hasCard, '[texto plano→maqueta] Factura inexistente → página maquetada (.e-card) "No encontramos esta factura"');
  await page.screenshot({ path: '/home/ubuntu/u3-ficha404.png' });

  // 2) TEXTO PLANO → MAQUETA: ruta admin inexistente (notFound propio)
  const r404 = await page.goto(ORIGIN + '/admin/zzz-ruta-inexistente-u3', { waitUntil: 'networkidle0' });
  body = await page.evaluate(() => document.body.innerText);
  ok(r404.status() === 404 && /Página no encontrada/.test(body), '[texto plano→maqueta] Ruta admin inexistente → 404 maquetado "Página no encontrada" (antes "404 Not Found")');

  // 3) API inexistente → JSON limpio (no HTML)
  const api404 = await page.evaluate(async () => { const r = await fetch('/api/erp/zzz-inexistente-u3'); return { s: r.status, b: await r.text() }; });
  ok(api404.s === 404 && /"error"\s*:\s*"No encontrado"/.test(api404.b), '[API] Ruta /api inexistente → JSON {error:"No encontrado"} 404 (no HTML)');

  // 4) BANNER DOM + limpieza de código de permiso
  await page.goto(ORIGIN + '/admin/portal?err=' + encodeURIComponent('No tienes permiso (cobros.manage)'), { waitUntil: 'networkidle0' });
  body = await page.evaluate(() => document.body.innerText);
  ok(/No tienes permiso/.test(body) && !/cobros\.manage/.test(body), '[banner DOM] Banner portal-admin: "No tienes permiso" SIN el código "(cobros.manage)"');
  await page.screenshot({ path: '/home/ubuntu/u3-banner.png' });

  // 5) ALERT → TOAST (mensaje de servidor, sin mutar): emitir un presupuesto ANULADO
  await page.goto(ORIGIN + '/admin/quotes/1', { waitUntil: 'networkidle0' });   // PRE-0001, estado anulado
  await sleep(400);
  await hookToasts(page);
  sawAlert = false;
  // ⚙️ 24 ago 2026 · `emitir()` ya no abre un confirm() del navegador: abre el panel de la casa y
  // AWAITA su respuesta. `page.evaluate` esperaba esa promesa y se quedaba colgado — 186 s hasta que
  // el corredor lo mataba. Se dispara sin esperar, y el panel lo acepta `autoAceptarPaneles`.
  page.evaluate(() => { emitir(); }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('.modal-overlay.open'), { timeout: 8000 }).catch(() => {});
  const t5 = await toastHas(page, /Solo se puede emitir un borrador/);
  const t5all = await page.evaluate(() => window.__toasts || []);
  ok(t5 && !sawAlert, '[alert→toast] Emitir un presupuesto anulado → TOAST "Solo se puede emitir un borrador" y NINGÚN alert() nativo · toasts=' + JSON.stringify(t5all));
  await page.screenshot({ path: '/home/ubuntu/u3-toast.png' });

  // 6) TOAST + limpieza SQLite: categoría duplicada (crea + duplica; se borra en finally)
  await page.goto(ORIGIN + '/admin/categories', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#catName', { timeout: 6000 });
  await hookToasts(page);
  await page.evaluate(() => { document.getElementById('catName').value = 'ZZZ-U3-TEST'; return saveCat(); });
  await sleep(900);
  await page.evaluate(() => { document.getElementById('catName').value = 'ZZZ-U3-TEST'; return saveCat(); });
  const t6 = await toastHas(page, /Ya existe una categoría con ese nombre/);
  const t6all = await page.evaluate(() => window.__toasts || []);
  const noUnique = !t6all.some(t => /UNIQUE/.test(t));
  ok(t6 && noUnique, '[toast] Categoría duplicada → TOAST "Ya existe una categoría con ese nombre" (sin "UNIQUE") · toasts=' + JSON.stringify(t6all));

  // 7) cleanErrMsg — reglas clave (unidad en el navegador)
  const clean = await page.evaluate(() => ({
    unique: window.cleanErrMsg('UNIQUE constraint failed: admin_users.email'),
    tokenExcess: window.cleanErrMsg('La factura supera el stock disponible — X. Confirma el exceso para convertir (confirm_excess).'),
    perm: window.cleanErrMsg('No tienes permiso (cobros.manage)'),
    sqlite: window.cleanErrMsg('SQLITE_ERROR: no such column: foo'),
    valid: window.cleanErrMsg('Datos inválidos'),
    plain: window.cleanErrMsg('Solo se puede anular una factura emitida'),
  }));
  console.log('    · cleanErrMsg →', JSON.stringify(clean));
  ok(clean.unique === 'Ya hay un usuario con ese email.', '[cleanErrMsg] UNIQUE admin_users.email → "Ya hay un usuario con ese email."');
  ok(!/confirm_excess/.test(clean.tokenExcess) && /exceso/.test(clean.tokenExcess), '[cleanErrMsg] quita "(confirm_excess)" conservando "exceso" (el regex del front sigue casando)');
  ok(!/cobros\.manage/.test(clean.perm) && /No tienes permiso/.test(clean.perm), '[cleanErrMsg] quita el código de permiso "(cobros.manage)"');
  ok(/No hemos podido completar/.test(clean.sqlite), '[cleanErrMsg] error SQLite crudo → genérico');
  ok(/Revisa el formulario/.test(clean.valid), '[cleanErrMsg] "Datos inválidos" → mensaje accionable');
  ok(clean.plain === 'Solo se puede anular una factura emitida', '[cleanErrMsg] mensaje de negocio llano → intacto');

  // 8) PORTAL PÚBLICO (voz NEUTRA, sin cookies): token inválido
  const page2 = await browser.newPage();
  page2.on('pageerror', e => jsErrors.push('pageerror(portal): ' + e.message));
  page2.on('console', m => { if (m.type() === 'error' && isRealJsError(m.text())) jsErrors.push('console.error(portal): ' + m.text()); });
  await page2.goto(ORIGIN + '/portal/token-invalido-u3', { waitUntil: 'networkidle0' });
  const pbody = await page2.evaluate(() => document.body.innerText);
  ok(/Enlace no válido o caducado/.test(pbody) && /Pide a tu proveedor uno nuevo/.test(pbody) && !/DISA/.test(pbody), '[portal neutro] Token inválido → voz neutra "Enlace no válido o caducado / Pide a tu proveedor" (sin DISA)');
  await page2.screenshot({ path: '/home/ubuntu/u3-portal.png' });
  await page2.close();

} catch (e) { console.error('ERROR', e.stack || e.message); fail++; }
finally {
  await browser.close();
  const d = new Database(DB);
  d.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  try { d.prepare("DELETE FROM categories WHERE name LIKE 'ZZZ-U3-TEST%'").run(); } catch (_e) {}
  d.close();
}
console.log('\n=== Errores JS (consola/página): ' + jsErrors.length + ' ===');
jsErrors.forEach(e => console.log('  ! ' + e));
console.log('=== RESULTADO U3: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail || jsErrors.length ? 1 : 0);
