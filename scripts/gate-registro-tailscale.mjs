// Gate en navegador real (Puppeteer) del alta completa POR LA DIRECCIÓN DE TAILSCALE.
// Conduce el chat real (modelo real) en la UI de /registro, pulsa el botón "Crear mi
// negocio", elige contraseña en el campo seguro y comprueba que el auto-login se deriva
// del host de Tailscale (no bamburu.com). El aterrizaje en el panel se verifica siguiendo
// el token por el host loopback resoluble (MagicDNS no tiene comodín para slugs nuevos).
//
// ⚠️ ESTE GATE NO SE PUEDE CORRER EN CUALQUIER MÁQUINA, y no es una excusa: es su naturaleza.
// Prueba el alta POR LA RED DE TAILSCALE, así que necesita esa red montada. En este servidor no lo
// está (el host no resuelve), y el gate moría con un ERR_NAME_NOT_RESOLVED que en el barrido parecía
// un producto roto. No lo es: es un entorno que falta.
//
// Apuntarlo al host local sería hacer trampa —dejaría de probar exactamente lo que se escribió para
// probar (que el auto-login se deriva del host de Tailscale y no de bamburu.com)—, así que se hace lo
// honesto: ABORTAR con código 2 y decir por qué. "No he podido probarlo" nunca se disfraza de
// aprobado, ni de suspenso.
import path from 'path';
import { unlinkSync } from 'fs';
import puppeteer from 'puppeteer';
import { launchOpts, requireHost } from './lib/gate-env.mjs';
import { controlDb, getTenantBySlug, getTenantByEmail } from '../core/control-db.js';

import { soltarAtaduras } from './lib/tirar-negocio.mjs';
const TS_BASE = 'https://desarrollo-bamburu.tailf66357.ts.net';

// Antes de nada: ¿existe siquiera esa red aquí?
await requireHost(new URL(TS_BASE).hostname,
  'Este gate SOLO tiene sentido sobre Tailscale (levántalo con `tailscale up`). Apuntarlo a localhost '
  + 'no probaría lo que debe probar: que el alta funciona por la dirección de Tailscale.');
const RID = Math.random().toString(36).slice(2, 7);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
  // `tenant_suscripciones`: sin soltarla, el DELETE de abajo muere con FOREIGN KEY y el negocio de
  // prueba se queda dentro de control.db para siempre. `soltarAtaduras` le pregunta al esquema.
  soltarAtaduras(slug);
  controlDb.prepare('DELETE FROM tenants WHERE slug=?').run(slug);
  if (t) {
    const abs = path.isAbsolute(t.db_filename) ? t.db_filename : path.join(process.cwd(), t.db_filename);
    for (const f of [abs, abs + '-wal', abs + '-shm']) { try { unlinkSync(f); } catch {} }
  }
}

const browser = await puppeteer.launch({ ...launchOpts(), ignoreHTTPSErrors: true });
let createdSlug = null;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 480, height: 860 });

  let redirectUrl = null, serverHost = null;
  page.on('response', async (res) => {
    if (res.url().endsWith('/api/registro/crear')) {
      try { const j = await res.json(); redirectUrl = j.redirect || null; } catch {}
    }
  });

  console.log('\n[1] Cargar /registro por Tailscale y recibir la bienvenida del backend');
  await page.goto(TS_BASE + '/registro', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForFunction(
    () => [...document.querySelectorAll('.bubble.assistant')].some(b => /DISA/i.test(b.textContent)),
    { timeout: 15000 }
  );
  const welcome = await page.$eval('.bubble.assistant', b => b.textContent);
  check('la bienvenida aparece desde el backend', /soy disa/i.test(welcome), welcome.slice(0, 50));

  // Helper: escribe un mensaje y espera a que termine el turno.
  async function sendUI(msg) {
    await page.focus('#input');
    await page.type('#input', msg);
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => !document.getElementById('send').disabled && !document.getElementById('typing').classList.contains('visible'),
      { timeout: 45000 }
    );
    await sleep(300);
  }

  console.log('\n[2] Conversación real hasta que aparece el botón "Crear mi negocio"');
  const email = `gate.ts.${RID}.${Date.now()}@ejemplo.com`;
  const turns = [
    `Hola, tengo una peluquería que se llama "Peluquería TS ${RID}". Soy Lola Pérez y estoy en Madrid.`,
    `Mi email es ${email}`,
    `Sí, perfecto.`,
  ];
  let hasBtn = false;
  for (let i = 0; i < turns.length && !hasBtn; i++) {
    await sendUI(turns[i]);
    hasBtn = await page.$('#createBtn') !== null;
  }
  check('aparece el botón "Crear mi negocio" (ready vía UI)', hasBtn);
  check('el marcador [LISTO:...] no aparece en ninguna burbuja',
    !(await page.evaluate(() => /\[LISTO/i.test(document.body.innerText))));

  console.log('\n[3] Pulsar el botón, elegir contraseña y crear; redirect RELATIVO');
  await page.click('#createBtn');
  await page.waitForSelector('#pw-panel', { visible: true, timeout: 5000 });
  await page.type('#pw1', 'clave-ts-1234');
  await page.type('#pw2', 'clave-ts-1234');
  await page.click('#pw-submit');
  for (let i = 0; i < 60 && !redirectUrl; i++) await sleep(250);
  check('el alta devolvió un redirect', !!redirectUrl, redirectUrl);
  check('redirect RELATIVO al host actual (sin subdominio inventado)', (redirectUrl || '').startsWith('/admin/autologin?token='), redirectUrl);
  check('redirect NO contiene host/bamburu.com', !/https?:\/\//.test(redirectUrl || ''));

  console.log('\n[4] El navegador real sigue el redirect y ATERRIZA en /admin por Tailscale');
  await page.waitForFunction(() => location.pathname === '/admin', { timeout: 20000 });
  const landed = page.url();
  check('aterriza en /admin por la dirección de Tailscale (mismo host)', landed === TS_BASE + '/admin', landed);
  const bodyText = await page.evaluate(() => document.body.innerText);
  check('es el panel autenticado, no el login', !/Introduce tu contrase|Accede a tu panel/i.test(bodyText) && bodyText.length > 150);

  console.log('\n[5] La sesión es la del NEGOCIO RECIÉN CREADO (vínculo cookie→negocio)');
  const cookies = await page.cookies();
  const asess = (cookies.find(k => k.name === 'asess') || {}).value;
  check('cookie asess presente en el navegador', !!asess);
  const t = getTenantByEmail(email.toLowerCase());
  createdSlug = t?.slug || null;
  const bind = controlDb.prepare('SELECT tenant_id FROM tenant_sessions WHERE session_token=?').get(asess);
  check('el vínculo asess→negocio apunta al negocio recién creado', !!t && bind?.tenant_id === t.id, JSON.stringify(bind));

  console.log('\n[6] Login por /acceso SOBRE TAILSCALE (bug reportado): credenciales correctas → entra');
  const ft = await fetch(TS_BASE + '/find-tenant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  const ftBody = await ft.json();
  const btenant = (ft.headers.get('set-cookie') || '').match(/btenant=([^;]+)/)?.[1];
  check('/find-tenant encuentra el negocio por email y fija btenant', ft.status === 200 && ftBody.slug === createdSlug && !!btenant, JSON.stringify(ftBody));
  const loginRes = await fetch(TS_BASE + '/admin/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: 'btenant=' + btenant },
    body: new URLSearchParams({ email, password: 'clave-ts-1234' }).toString(),
  });
  check('login con credenciales CORRECTAS sobre Tailscale → 302 /admin (no "credenciales incorrectas")',
    loginRes.status === 302 && loginRes.headers.get('location') === '/admin', `${loginRes.status} ${loginRes.headers.get('location')}`);
  check('login fija sesión asess', /asess=/.test(loginRes.headers.get('set-cookie') || ''));
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
