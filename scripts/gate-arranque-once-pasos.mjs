#!/usr/bin/env node
//
// gate-arranque-once-pasos.mjs — «PON EN MARCHA TU NEGOCIO»: LOS ONCE PASOS, UNO A UNO.
//
// DE DÓNDE SALE. El 24 ago 2026 el dueño avisó: «subes el logo, el logo se guarda, y el panel sigue
// diciendo que falta». Medido paso a paso en un negocio recién creado: **diez de los once se marcaban
// y solo fallaba el del logo**. La causa era que el panel miraba `company_config.logo_url` —la
// columna VIEJA, una dirección escrita a mano— mientras que subir el fichero guarda
// `company_config.company_logo_id`, que apunta al adjunto. Dos sitios para lo mismo.
//
// QUÉ SE EXIGE AQUÍ:
//   · Los ONCE pasos, hechos DE VERDAD y uno a uno, marcan su casilla. Ninguno se da por hecho.
//   · El del logo se prueba SUBIENDO el fichero por la pantalla, no escribiendo en la base.
//   · Y el panel se marca EN EL MOMENTO: al volver a la pestaña, sin recargar a mano.
//
//   node scripts/gate-arranque-once-pasos.mjs
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import puppeteer from 'puppeteer-core';
import { launchOpts, APP_DIR, autoAceptarPaneles } from './lib/gate-env.mjs';
import { provisionTenant } from '../core/tenant-provisioning.js';
import { estadoArranque, pasosDe } from '../modules/erp/arranque.js';

const RID = randomBytes(3).toString('hex');
const SHOTS = join(process.env.HOME || '/home/ubuntu', 'arranque-shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch {}
const dormir = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (c, m, det) => { if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ ' + m + (det ? ' · ' + det : '')); } };

// UN NEGOCIO PROPIO, recién nacido: los once pasos solo se pueden probar desde cero, y hacerlo en el
// negocio compartido lo dejaría con un logo y un horario que no son suyos.
const alta = await provisionTenant({
  businessName: 'ZZ Arranque ' + RID, ownerName: 'Dueña ' + RID,
  email: 'zz-arr-' + RID + '@bamburu.test', password: 'Prueba1234!', oficio: 'peluqueria',
});
const DB_PATH = join(APP_DIR, 'data', 'tenants', alta.slug + '.db');
const db = new Database(DB_PATH);
const HOST = alta.slug + '.bamburu.com';
const BASE = 'https://' + HOST;
const est = () => estadoArranque(db);

const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' ORDER BY id LIMIT 1").get();
const ahora = Math.floor(Date.now() / 1000);
const token = 'zz-arr-' + randomBytes(20).toString('hex');
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(token, owner.id, ahora, ahora + 3600, randomBytes(20).toString('hex'));

let browser;
try {
  browser = await puppeteer.launch(launchOpts());
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
  await autoAceptarPaneles(page);
  await page.setCookie({ name: 'asess', value: token, domain: HOST, path: '/', secure: true });
  const errores = [];
  page.on('pageerror', e => errores.push(String(e && e.message || e)));

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] EL PANEL ARRANCA CON LOS ONCE SIN HACER');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const inicial = est();
  const CLAVES = ['fiscal', 'aspecto', 'migracion', 'cliente', 'servicios', 'horario', 'equipo',
                  'margen', 'reservas', 'recordatorios', 'factura'];
  ok(Object.keys(inicial).length === 11, 'el panel tiene ONCE pasos', Object.keys(inicial).join(', '));
  ok(CLAVES.every(k => k in inicial), '  y son los once de siempre (ninguno se ha perdido)');
  ok(CLAVES.every(k => inicial[k] === false), '  y en un negocio nuevo ninguno está hecho',
     CLAVES.filter(k => inicial[k]).join(', ') || 'ninguno marcado');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] EL DEL LOGO, SUBIÉNDOLO POR LA PANTALLA (el que fallaba)');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Un PNG de un píxel, de verdad. El nombre NO empieza por punto: un fichero oculto lo ve el
  // navegador y al leerlo da NotReadableError — lección ya pagada en este repo.
  const PNG_1PX = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');
  await page.goto(BASE + '/admin/settings', { waitUntil: 'networkidle2' });
  await dormir(1200);
  const subida = await page.evaluate(async (b64) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const fd = new FormData();
    fd.append('logo', new File([arr], 'logo-prueba.png', { type: 'image/png' }));
    const r = await fetch('/api/erp/settings/logo', { method: 'POST', headers: { 'x-csrf-token': window.CSRF_TOKEN || '' }, body: fd });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, json: j };
  }, PNG_1PX.toString('base64'));
  ok(subida.status === 200, 'el logo se sube por la pantalla', 'HTTP ' + subida.status);

  const cfg = db.prepare('SELECT company_logo_id, logo_url FROM company_config WHERE id=1').get();
  ok(!!cfg.company_logo_id, '  y se GUARDA (en company_logo_id, que es donde vive hoy)',
     'company_logo_id=' + cfg.company_logo_id + ' · logo_url=' + JSON.stringify(cfg.logo_url || ''));
  ok(est().aspecto === true, 'Y EL PASO SE MARCA — era el único de los once que no lo hacía',
     'aspecto=' + est().aspecto);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] LOS OTROS DIEZ, UNO A UNO Y HACIÉNDOLOS DE VERDAD');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const HACER = {
    fiscal: () => db.prepare("UPDATE company_config SET fiscal_id='B12345678' WHERE id=1").run(),
    migracion: () => db.prepare("INSERT INTO migracion_peticiones (origen,quiere,comentario,user_name,active) VALUES ('holded','clientes','ZZ','D',1)").run(),
    cliente: () => db.prepare("INSERT INTO clients (name,fiscal_id,country,active) VALUES ('ZZ Cli','X1234567X','ES',1)").run(),
    servicios: () => {
      const p = db.prepare("INSERT INTO products (name,price,type,status) VALUES ('ZZ Corte',20,'service','active')").run().lastInsertRowid;
      db.prepare("INSERT INTO service_config (product_id,duracion_min,reservable) VALUES (?,30,1)").run(p);
    },
    horario: () => { for (let d = 1; d <= 5; d++) db.prepare("INSERT INTO horario_tramos (scope,user_id,dow,inicio_min,fin_min) VALUES ('negocio',NULL,?,540,1080)").run(d); },
    equipo: () => db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES (?,?,'x','employee',1)").run('ZZ Emp ' + RID, 'zz-emp-' + RID + '@bamburu.test'),
    margen: () => db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('margen_modo_elegido','venta')").run(),
    reservas: () => db.prepare('UPDATE company_config SET cita_pub_activa=1 WHERE id=1').run(),
    recordatorios: () => db.prepare("UPDATE company_config SET cita_modo_recordatorio='auto_email' WHERE id=1").run(),
    factura: () => db.prepare(`INSERT INTO invoices (invoice_number,year,sequence,issue_date,company_name,company_fiscal_id,subtotal,tax_amount,total,status)
                               VALUES ('F2026-0001',2026,1,'2026-08-24','ZZ Arranque','B12345678',100,21,121,'emitida')`).run(),
  };
  for (const k of CLAVES) {
    if (k === 'aspecto') continue;                       // ya probado arriba, y por la pantalla
    ok(est()[k] === false, 'antes de hacerlo, «' + k + '» está sin marcar');
    HACER[k]();
    ok(est()[k] === true, '  y al hacerlo, SE MARCA');
  }
  const todo = est();
  ok(CLAVES.every(k => todo[k] === true), 'LOS ONCE, MARCADOS',
     CLAVES.filter(k => !todo[k]).join(', ') || 'los once');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] EL PANEL SE MARCA EN EL MOMENTO, NO AL RECARGAR');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Se abre el Inicio con un paso SIN hacer, se completa por fuera, y se vuelve a la pestaña. Sin
  // recargar: el panel tiene que ponerse al día solo.
  db.prepare('UPDATE company_config SET cita_pub_activa=0 WHERE id=1').run();
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelector('#onbPanel') && document.querySelector('#onbPanel').textContent.trim().length > 0,
                             { timeout: 20000 }).catch(() => {});
  await dormir(900);
  // Se mide POR EL NÚMERO, no por el texto: el panel puede estar plegado en una línea (se recuerda
  // por usuario) y entonces no nombra los pasos, aunque los cuente bien.
  const antesDeCompletar = await page.evaluate(async () => {
    const d = await (await fetch('/api/erp/inicio/arranque')).json();
    return { hechos: d.hechos, total: d.total, completo: !!d.completo };
  });
  ok(antesDeCompletar.completo === false && antesDeCompletar.hechos === antesDeCompletar.total - 1,
     'el panel cuenta el paso que falta', antesDeCompletar.hechos + '/' + antesDeCompletar.total);

  db.prepare('UPDATE company_config SET cita_pub_activa=1 WHERE id=1').run();
  // La pestaña "vuelve a la vista": es lo que pasa al volver de otra pantalla o de otra pestaña.
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  await dormir(1800);
  const completo = await page.evaluate(async () => {
    const r = await fetch('/api/erp/inicio/arranque');
    const d = await r.json();
    return { completo: !!d.completo, hechos: d.hechos, total: d.total };
  });
  ok(completo.completo === true, 'y al volver a la pestaña el panel se pone al día SOLO',
     completo.hechos + '/' + completo.total);

  // ── LA CAPTURA QUE PIDIÓ EL DUEÑO: el panel con el logo ya subido y su paso marcado ──────────
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle2' });
  await dormir(1600);
  // EL PANEL, ABIERTO. Cuando está todo hecho se pliega en una línea («11 de 11 · todo hecho»), y una
  // captura así no enseña lo que se pedía ver: el paso del logo MARCADO. Se despliega antes.
  await page.evaluate(() => {
    const t = document.querySelector('#onbPanel [data-onb-toggle]');
    if (t) t.click();
  });
  await dormir(1200);
  await page.evaluate(() => { const p = document.querySelector('#onbPanel'); if (p) p.scrollIntoView({ block: 'center' }); });
  await dormir(600);
  const panelAbierto = await page.evaluate(() => {
    const p = document.querySelector('#onbPanel');
    const txt = p ? p.textContent : '';
    const aspecto = [...(p ? p.querySelectorAll('*') : [])]
      .find(e => !e.children.length && /El aspecto de tus facturas/.test(e.textContent || ''));
    return { texto: txt.replace(/\s+/g, ' ').slice(0, 160), veElAspecto: !!aspecto };
  });
  ok(panelAbierto.veElAspecto, 'el panel, ABIERTO, enseña el paso del aspecto', panelAbierto.texto.slice(0, 90));
  await page.screenshot({ path: join(SHOTS, 'pon-en-marcha.png') }).catch(() => {});
  const textoPanel = await page.evaluate(() => (document.querySelector('#onbPanel') || {}).textContent || '');
  ok(!/El aspecto de tus facturas/.test(textoPanel) || /hecho|completo|✓/i.test(textoPanel),
     'en la captura, el paso del aspecto ya no aparece como pendiente',
     textoPanel.replace(/\s+/g, ' ').slice(0, 100));

  ok(errores.length === 0, 'cero errores de JavaScript en todo el recorrido', errores.join(' | ') || 'ninguno');

} finally {
  // EL NEGOCIO DE PRUEBA SE BORRA ENTERO.
  try { db.close(); } catch {}
  try { if (browser) await browser.close(); } catch {}
  try { execSync('rm -f ' + JSON.stringify(DB_PATH) + '*'); } catch {}
  try {
    const cdb = new Database(join(APP_DIR, 'data', 'control.db'));
    cdb.prepare('DELETE FROM tenants WHERE slug=?').run(alta.slug);
    cdb.close();
  } catch {}
  try { execSync('rm -rf ' + JSON.stringify(join(APP_DIR, 'data', 'uploads', alta.slug))); } catch {}
  console.log('  · negocio de prueba borrado entero: ' + alta.slug);
}

console.log('\n' + '─'.repeat(70));
console.log('RESULTADO: ' + pass + ' ✓  ·  ' + fail + ' ✗   (captura en ' + SHOTS + '/pon-en-marcha.png)');
process.exit(fail === 0 ? 0 : 1);
