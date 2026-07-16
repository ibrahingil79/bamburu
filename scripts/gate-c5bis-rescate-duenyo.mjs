// Gate de navegador — C5-bis: el dueño activa el 2FA, ve sus 10 códigos UNA vez, cierra sesión,
// entra con un código de rescate, y ese código ya no vuelve a valer. Contra el servidor real.
//
// QUÉ MIDE Y POR QUÉ. Los tests de rutas prueban la lógica; esto prueba que una PERSONA puede
// hacerlo. El camino entero depende de JavaScript (la casilla "he guardado" que desbloquea
// Terminar, copiar, descargar) y de que los códigos se pinten legibles. Un rescate que no se puede
// completar con el ratón no rescata a nadie — y no se notaría hasta el día del apuro, que es
// justo el peor momento para descubrirlo.
//
// SOBRE LA CUENTA. NO se toca ninguna cuenta real ni el 2FA de nadie: se crea un TENANT DESECHABLE
// con su propio dueño, y se borra al final pase lo que pase (finally). Activar el 2FA de una cuenta
// de verdad desde un script sería exactamente el bloqueo que esta tarea existe para cerrar.
//
//   node scripts/gate-c5bis-rescate-duenyo.mjs
import puppeteer from 'puppeteer';
import { launchOpts, APP_DIR } from './lib/gate-env.mjs';
import { join } from 'path';
import { unlinkSync } from 'fs';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { TOTP, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';
import { controlDb } from '../core/control-db.js';
import { provisionTenant } from '../core/tenant-provisioning.js';

// BASE se fija al crear el tenant: http://<slug>.localhost:3000. Mismo patrón que el resto de gates
// del panel — *.localhost resuelve a loopback sin tocar /etc/hosts, y el middleware saca el negocio
// de la primera etiqueta del host, igual que en producción con el subdominio real.
let BASE = null;
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { if (c) { pass++; console.log('  ✓ ' + m + (extra ? ' — ' + extra : '')); } else { fail++; console.error('  ✗ ' + m + (extra ? ' — ' + extra : '')); } };

const totp = new TOTP({ crypto: new NobleCryptoPlugin(), base32: new ScureBase32Plugin() });
const codigoDe = async (secret) => {
  const r = await totp.generate({ secret });
  return typeof r === 'string' ? r : (r.otp ?? r.token);
};

const RID = randomBytes(3).toString('hex');
const EMAIL = `duenyo-c5bis-${RID}@bamburu.local`;
const PW = 'contrasenya-del-gate-1';
let creado = null, browser = null;

try {
  // Tenant desechable, por el flujo real de alta.
  const r = await provisionTenant({
    businessName: `Gate C5bis ${RID}`, ownerName: 'Dueño Gate',
    email: EMAIL, password: PW, phone: '+34 000 000 000',
  });
  creado = r;
  BASE = `http://${r.slug}.localhost:3000`;
  console.log(`\n  (tenant desechable: ${r.slug} → ${BASE})`);

  browser = await puppeteer.launch({ ...launchOpts() });
  const p = await browser.newPage();
  p.__errores = [];
  p.on('pageerror', e => p.__errores.push(String(e)));

  // El gate hace MÁS logins que una persona (prueba también el reuso), y el freno de login son 5 por
  // IP cada 15 min entre /admin/login y /admin/verify-2fa (C6/B4). Sin repartir, el 6º se comería un
  // 429 y el gate culparía al 2FA de un fallo que es del freno haciendo bien su trabajo. Se cambia la
  // IP declarada por paso: la conexión llega por loopback, así que getClientIp se fía de X-Real-IP —
  // exactamente el camino de producción, donde la pone Caddy.
  let nIp = 0;
  const otraIp = async () => p.setExtraHTTPHeaders({ 'X-Real-IP': `10.90.0.${++nIp}` });
  await otraIp();

  console.log('\n[1] El dueño entra con su contraseña (aún sin 2FA)');
  await p.goto(BASE + '/admin/login', { waitUntil: 'networkidle0' });
  await p.type('input[name=email]', EMAIL);
  await p.type('input[name=password]', PW);
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle0' }), p.click('button[type=submit]')]);
  ok(p.url().endsWith('/admin'), 'entra al panel', p.url());

  console.log('\n[2] Activa el 2FA desde su Perfil');
  await p.goto(BASE + '/admin/perfil', { waitUntil: 'networkidle0' });
  const secreto = await p.evaluate(() => document.querySelector('.pf-secret')?.textContent.trim() || '');
  ok(/^[A-Z2-7]{32}$/.test(secreto), 'el Perfil enseña el secreto para la app', secreto.slice(0, 8) + '…');
  ok((await p.$('.pf-qr img')) !== null, 'y su QR');

  // El Perfil tiene VARIOS formularios (datos, contraseña, 2FA): hay que apuntar al del 2FA por su
  // action, o se pulsa el primero que haya y esto se queda esperando una navegación que no llega.
  const F2FA = 'form[action="/admin/perfil/confirm-2fa"]';
  await p.type(`${F2FA} input[name=code]`, await codigoDe(secreto));
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle0' }), p.click(`${F2FA} button[type=submit]`)]);

  console.log('\n[3] EL CRITERIO — ve sus 10 códigos, y "Terminar" está bloqueado hasta confirmar');
  const codigos = await p.evaluate(() => [...document.querySelectorAll('.rc-code')].map(e => e.textContent.trim()));
  ok(codigos.length === 10, 'aparecen 10 códigos de rescate', String(codigos.length));
  ok(codigos.every(c => /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(c)), 'con formato legible XXXXX-XXXXX', codigos[0]);
  const bloqueado = await p.evaluate(() => getComputedStyle(document.getElementById('rcFin')).pointerEvents);
  ok(bloqueado === 'none', 'EL CRITERIO · "Terminar" NACE bloqueado');
  await p.click('#rcOk');
  const libre = await p.evaluate(() => getComputedStyle(document.getElementById('rcFin')).pointerEvents);
  ok(libre === 'auto', 'al marcar "he guardado", se desbloquea — el JS corre');
  ok(p.__errores.length === 0, 'ningún error de JavaScript', p.__errores.join(' · '));

  const tdb = new Database(join(APP_DIR, creado.db_filename));
  ok(tdb.prepare('SELECT COUNT(*) n FROM admin_recovery_codes WHERE used_at IS NULL').get().n === 10,
    'y quedan guardados (hasheados) en su negocio');

  console.log('\n[4] Cierra sesión y ahora el login le pide el código');
  await otraIp();
  await p.goto(BASE + '/admin/logout', { waitUntil: 'networkidle0' });
  await p.goto(BASE + '/admin/login', { waitUntil: 'networkidle0' });
  await p.type('input[name=email]', EMAIL);
  await p.type('input[name=password]', PW);
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle0' }), p.click('button[type=submit]')]);
  ok((await p.$('input[name=pending]')) !== null, 'la contraseña sola ya no entra: pide el código');
  const cookies1 = await p.cookies();
  ok(!cookies1.some(c => c.name === 'asess' && c.value), 'y no hay sesión todavía');

  console.log('\n[5] EL CRITERIO — entra con un CÓDIGO DE RESCATE (móvil perdido)');
  await otraIp();
  await p.type('input[name=code]', codigos[0]);
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle0' }), p.click('button[type=submit]')]);
  ok(p.url().endsWith('/admin'), 'EL CRITERIO · entra al panel con el papel', p.url());
  ok(tdb.prepare('SELECT COUNT(*) n FROM admin_recovery_codes WHERE used_at IS NULL').get().n === 9,
    'el código queda gastado: quedan 9');

  console.log('\n[6] EL CRITERIO — ese mismo código ya NO vale');
  await otraIp();
  await p.goto(BASE + '/admin/logout', { waitUntil: 'networkidle0' });
  await p.goto(BASE + '/admin/login', { waitUntil: 'networkidle0' });
  await p.type('input[name=email]', EMAIL);
  await p.type('input[name=password]', PW);
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle0' }), p.click('button[type=submit]')]);
  await p.type('input[name=code]', codigos[0]);
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}), p.click('button[type=submit]')]);
  ok(!p.url().endsWith('/admin'), 'EL CRITERIO · reutilizarlo NO entra', p.url());
  const cookies2 = await p.cookies();
  ok(!cookies2.some(c => c.name === 'asess' && c.value), 'y sigue sin sesión');
  ok(tdb.prepare('SELECT COUNT(*) n FROM admin_recovery_codes WHERE used_at IS NULL').get().n === 9,
    'no descuenta de más: siguen 9');

  console.log('\n[7] Y otro código distinto sí le deja entrar');
  await otraIp();
  await p.evaluate(() => { const i = document.querySelector('input[name=code]'); if (i) i.value = ''; });
  await p.type('input[name=code]', codigos[1]);
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle0' }), p.click('button[type=submit]')]);
  ok(p.url().endsWith('/admin'), 'entra con el segundo código', p.url());

  console.log('\n[8] El Perfil le dice cuántos le quedan');
  await p.goto(BASE + '/admin/perfil', { waitUntil: 'networkidle0' });
  const texto = await p.evaluate(() => document.body.innerText);
  ok(/Códigos de rescate:\s*8\s*sin usar/.test(texto), 'muestra "8 sin usar"');
  ok(texto.includes('Generar códigos nuevos'), 'y ofrece regenerarlos');
  tdb.close();

  console.log(`\n${pass} OK, ${fail} fallos\n`);
} finally {
  if (browser) await browser.close();
  // El tenant desechable y su .db, fuera, pase lo que pase.
  if (creado) {
    try {
      controlDb.prepare('DELETE FROM tenant_sessions WHERE tenant_id=(SELECT id FROM tenants WHERE slug=?)').run(creado.slug);
      controlDb.prepare('DELETE FROM tenants WHERE slug=?').run(creado.slug);
      const abs = join(APP_DIR, creado.db_filename);
      for (const f of [abs, abs + '-wal', abs + '-shm']) { try { unlinkSync(f); } catch {} }
      console.log(`🧹 tenant desechable ${creado.slug} eliminado`);
    } catch (e) { console.error('⚠️  limpieza incompleta:', e.message); }
  }
}

process.exit(fail === 0 ? 0 : 1);
