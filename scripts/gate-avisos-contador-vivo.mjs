// Gate de NAVEGADOR del contador en vivo de la campana. Comprueba lo que ningún test de servidor
// puede comprobar: que el número sube y baja SOLO, en una pantalla que NO es la de avisos, sin
// recargar, y sin un solo error de JS.
//
// Se sitúa en /admin/inventory (una pantalla cualquiera del panel) y prueba las DOS vías:
//   · SUBE por el SONDEO: se crea una oportunidad vencida por debajo, sin tocar el navegador, y se
//     espera a que la campana lo descubra sola (el sondeo es de 60 s, así que se le dan 90).
//   · BAJA AL INSTANTE: la oportunidad se cierra desde la propia página, por el endpoint REAL del
//     CRM (`POST /api/erp/crm/:id/close`, con su permiso y su CSRF). Eso dispara el enganche de
//     api(), y el número debe caer en segundos, sin esperar al siguiente sondeo.
//
// Errores: `pageerror` (excepción de JS) es fallo. Un 404 de /favicon.ico NO lo es — el navegador
// lo pide siempre y no lo sirve nadie; se ignora explícitamente y se informa aparte.
//   node scripts/gate-avisos-contador-vivo.mjs [directorio-de-capturas]
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { mkdirSync } from 'fs';
import { join } from 'path';

const SLUG = 'desarrollo-bamburu';
const DB_PATH = `/home/ubuntu/bamburu/data/tenants/${SLUG}.db`;
const BASE = `http://${SLUG}.localhost:3000`;
const OUT = process.argv[2] || join(process.env.HOME, 'contador-shots');   // el chromium de snap no lee /tmp
const MARCA = 'zz-contador-vivo';
mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB_PATH);
const ownerId = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1").get().id;
const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(token, ownerId, now, now + 3600, csrf);

// El número vive en el title de la campana: "N avisos sin ver" / "N avisos pendientes (ya vistos)".
const leerCampana = page => page.$eval('#tbBell', b => ({
  title: b.getAttribute('title') || '',
  punto: !!b.querySelector('.dot'),
  rojo: !!b.querySelector('.dot:not(.visto)'),
}));
const numeroDe = t => { const m = /(\d+)\s+aviso/.exec(t || ''); return m ? Number(m[1]) : 0; };

async function esperarCampana(page, pred, ms) {
  const t0 = Date.now();
  for (;;) {
    const c = await leerCampana(page);
    if (pred(numeroDe(c.title), c)) return { ok: true, ...c, segundos: ((Date.now() - t0) / 1000).toFixed(1) };
    if (Date.now() - t0 >= ms) return { ok: false, ...c, segundos: ((Date.now() - t0) / 1000).toFixed(1) };
    await new Promise(r => setTimeout(r, 500));
  }
}

let oppId = null, clientId = null, browser = null;
try {
  browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/snap/bin/chromium',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setCookie({ name: 'asess', value: token, domain: `${SLUG}.localhost`, path: '/' });

  const erroresJs = [];          // excepciones de JS: cero tolerancia
  const fallosRecurso = [];      // 4xx/5xx de red, para informar
  page.on('pageerror', e => erroresJs.push(String(e)));
  page.on('response', r => { if (r.status() >= 400) fallosRecurso.push(r.status() + ' ' + new URL(r.url()).pathname); });
  const pedidosAvisos = [];
  page.on('request', r => { const u = r.url(); if (u.includes('/api/erp/avisos')) pedidosAvisos.push(new URL(u).pathname); });

  await page.goto(`${BASE}/admin/inventory`, { waitUntil: 'networkidle0' });
  ok(!page.url().includes('/admin/login'), 'sesión válida: estamos dentro del panel');
  ok(!page.url().includes('/admin/avisos'), `la pantalla NO es la de avisos (${new URL(page.url()).pathname})`);
  ok(await page.$('#tbBell') !== null, 'la campana existe en el chrome de esta pantalla');

  const nAntes = numeroDe((await leerCampana(page)).title);
  console.log(`  · campana al cargar: ${nAntes} avisos`);
  await page.screenshot({ path: join(OUT, '1-antes.png') });

  // ── SUBE por el sondeo, sin tocar el navegador ──────────────────────────────
  let cli = db.prepare('SELECT id FROM clients WHERE name=?').get(MARCA);
  if (!cli) cli = { id: db.prepare('INSERT INTO clients (name,active) VALUES (?,1)').run(MARCA).lastInsertRowid };
  clientId = cli.id;
  const hace9 = new Date(Date.now() - 9 * 86400000).toISOString().slice(0, 10);
  oppId = Number(db.prepare(
    `INSERT INTO opportunities (client_id,title,amount,stage,probability,expected_close_date,status,active,created_at,stage_changed_at)
     VALUES (?,?,?,?,?,?,'activa',1,?,?)`
  ).run(clientId, MARCA, 999, 'propuesta', 50, hace9, hace9, hace9).lastInsertRowid);
  console.log(`  · creada oportunidad #${oppId}, cierre vencido el ${hace9} (sin tocar el navegador)`);

  const sube = await esperarCampana(page, n => n === nAntes + 1, 90000);
  ok(sube.ok, `el contador SUBE solo, sin recargar: ${nAntes} → ${numeroDe(sube.title)} (${sube.segundos}s, sondeo de 60s)`);
  ok(sube.rojo, 'el punto queda rojo: hay algo sin ver');
  await page.screenshot({ path: join(OUT, '2-sube.png') });
  ok(pedidosAvisos.includes('/api/erp/avisos/contador'), `el sondeo pide el endpoint LIGERO (${[...new Set(pedidosAvisos)].join(', ')})`);
  ok(!pedidosAvisos.includes('/api/erp/avisos'), 'el sondeo NO pide la lista entera de avisos');

  // ── BAJA AL INSTANTE, resolviéndola desde esta misma pantalla ───────────────
  // Endpoint real del CRM, con su permiso (crm.manage) y su CSRF. Pasa por api(), así que dispara
  // el enganche que refresca la campana. No se espera al sondeo: se mide que baja en segundos.
  const t0 = Date.now();
  const cerrada = await page.evaluate(async id => {
    try { await window.api('POST', '/api/erp/crm/' + id + '/close', { status: 'ganada' }); return 'ok'; }
    catch (e) { return String(e.message || e); }
  }, oppId);
  ok(cerrada === 'ok', `la oportunidad se cierra desde la página, por el endpoint real (${cerrada})`);

  const baja = await esperarCampana(page, n => n === nAntes, 10000);
  const seg = ((Date.now() - t0) / 1000);
  ok(baja.ok, `el contador BAJA al resolverla: → ${numeroDe(baja.title)} (${baja.segundos}s)`);
  ok(baja.ok && seg < 8, `baja AL INSTANTE, sin esperar al sondeo de 60s (${seg.toFixed(1)}s)`);
  await page.screenshot({ path: join(OUT, '3-baja.png') });

  // ── Nada de esto fue una recarga ───────────────────────────────────────────
  const navegaciones = await page.evaluate(() => performance.getEntriesByType('navigation').length);
  ok(navegaciones === 1, `una sola navegación en toda la prueba (${navegaciones}): el número cambió en vivo`);

  // ── Errores ────────────────────────────────────────────────────────────────
  const propios = fallosRecurso.filter(f => !f.endsWith('/favicon.ico'));
  ok(erroresJs.length === 0, `0 errores de JS${erroresJs.length ? ': ' + erroresJs.slice(0, 3).join(' | ') : ''}`);
  ok(propios.length === 0, `0 peticiones fallidas propias${propios.length ? ': ' + propios.join(', ') : ''}`);
  console.log(`  · (ignorado: ${fallosRecurso.filter(f => f.endsWith('/favicon.ico')).length} × 404 /favicon.ico — el navegador lo pide siempre, no lo sirve nadie)`);
  console.log(`  · capturas en ${OUT}`);
} finally {
  if (browser) await browser.close();
  if (oppId) { db.prepare('DELETE FROM client_activities WHERE opportunity_id=?').run(oppId); db.prepare('DELETE FROM opportunities WHERE id=?').run(oppId); }
  if (clientId) db.prepare('DELETE FROM clients WHERE id=? AND name=?').run(clientId, MARCA);
  db.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  db.close();
  console.log('\n' + (fail ? '✗ ' + fail + ' fallos, ' : '') + pass + ' OK');
  process.exit(fail ? 1 : 0);
}
