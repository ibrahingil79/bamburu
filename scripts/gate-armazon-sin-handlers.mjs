#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// EL ARMAZÓN DEL PANEL, SIN CÓDIGO EN LOS ATRIBUTOS — y comprobado PULSANDO.
//
// DE DÓNDE SALE (csp-erp-migrar-handlers, 4 sep 2026). El censo sobre el HTML SERVIDO destapó que
// las 363 pantallas del panel tenían casi los mismos ~64 handlers de atributo: **no eran suyos, eran
// del armazón compartido** (`modules/erp/layout.js`), que los emite desde 21 sitios y aparece en
// todas. Migrar ese fichero UNA vez quitó ~46 handlers de CADA pantalla.
//
// POR QUÉ ESTE GATE, Y POR QUÉ PULSA. Cambiar el armazón toca las 363 pantallas a la vez. Si un
// oyente quedara mal enganchado, el menú, la campana o el menú de fila dejarían de responder **sin
// dar ningún error**: la página carga perfecta y el botón no hace nada. Eso no lo ve nadie que solo
// mire el HTML. Así que aquí se pulsa cada control y se exige un EFECTO OBSERVABLE en el DOM.
//
// Ojo con lo que NO afirma: el panel TODAVÍA NO está endurecido —sigue con la política de siempre—
// porque le quedan handlers propios de cada pantalla. Esto vigila el paso previo: que el armazón ya
// no ponga ninguno y que todo siga funcionando.
//
//   node scripts/gate-armazon-sin-handlers.mjs
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { launchOpts, tenantDb } from './lib/gate-env.mjs';

const SLUG = 'desarrollo-bamburu';
const BASE = 'http://' + SLUG + '.localhost:3000';
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ✓ ' + m + (d ? ' · ' + d : '')); }
                          else { fail++; console.error('  ✗ FALLO: ' + m + (d ? ' · ' + d : '')); } };

const db = new Database(tenantDb(SLUG));
const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
const tok = 'gate-armazon-' + randomBytes(12).toString('hex');
const ahora = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(tok, owner.id, ahora, ahora + 1800, randomBytes(12).toString('hex'));

const browser = await puppeteer.launch({ ...launchOpts() });
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 1400, height: 900 });
  await p.setCookie({ name: 'asess', value: tok, domain: SLUG + '.localhost', path: '/' });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] EL ARMAZÓN YA NO ESCRIBE CÓDIGO EN LOS ATRIBUTOS');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  await p.goto(BASE + '/admin', { waitUntil: 'networkidle0' });
  // Se cuentan FUERA de los bloques de código: dentro de un script, `onclick=` es una asignación.
  const cuenta = await p.evaluate(() => {
    const h = document.documentElement.outerHTML.replace(/<script[\s\S]*?<\/script>/gi, '');
    return (h.match(/\son[a-z]+\s*=\s*["']/gi) || []).length;
  });
  ok(cuenta <= 12, 'la pantalla de inicio del panel baja de 57 handlers a unos pocos', 'quedan ' + cuenta);
  ok(await p.evaluate(() => document.querySelectorAll('[data-navg]').length > 0),
     'los grupos del menú se marcan con data-navg, sin código en el atributo');
  ok(await p.evaluate(() => !/onmouseenter=/i.test(document.documentElement.outerHTML)),
     'ni un solo onmouseenter en toda la pantalla');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] EL MENÚ RESPONDE AL RATÓN (era onmouseenter, ahora es un oyente)');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const abrioFly = await p.evaluate(async () => {
    const g = document.querySelector('[data-navg]'); if (!g) return 'sin grupos';
    g.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    await new Promise(r => setTimeout(r, 250));
    const f = g.querySelector('.flyout');
    return (f && f.classList.contains('open')) ? 'ok' : 'el desplegable NO se abrió';
  });
  ok(abrioFly === 'ok', 'pasar el ratón por un grupo ABRE su desplegable', abrioFly);
  ok(await p.evaluate(() => document.querySelector('.sidebar')?.classList.contains('flyopen')),
     '  y el menú lateral se ensancha, como antes');
  const cerroFly = await p.evaluate(async () => {
    const g = document.querySelector('[data-navg]');
    g.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
    await new Promise(r => setTimeout(r, 900));
    return !g.querySelector('.flyout')?.classList.contains('open');
  });
  ok(cerroFly, 'y al salir el ratón, se cierra solo');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] LOS BOTONES FIJOS DEL ARMAZÓN RESPONDEN AL CLIC');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  for (const [act, m] of [['bell', 'la campana de avisos'], ['acct', 'el menú de la cuenta']]) {
    const r = await p.evaluate(async (a) => {
      const b = document.querySelector('[data-act="' + a + '"]'); if (!b) return 'no existe el botón';
      const antes = document.documentElement.outerHTML.length;
      const expAntes = b.getAttribute('aria-expanded');
      b.click();
      await new Promise(r => setTimeout(r, 250));
      const expDespues = b.getAttribute('aria-expanded');
      if (expAntes !== expDespues) return 'ok';
      return (document.documentElement.outerHTML.length !== antes) ? 'ok' : 'no cambió nada al pulsarlo';
    }, act);
    ok(r === 'ok', 'pulsar ' + m + ' hace algo', r);
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] EL MENÚ DE FILA (⋯) — el que hay en casi todas las listas');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  await p.goto(BASE + '/admin/clients', { waitUntil: 'networkidle0' });
  const hayRow = await p.evaluate(() => !!document.querySelector('[data-act="rowmenu"]'));
  ok(hayRow, 'hay menús de fila en la lista de clientes, y ya sin código en el atributo');
  const abrioRow = hayRow && await p.evaluate(async () => {
    const b = document.querySelector('[data-act="rowmenu"]');
    b.click();
    await new Promise(r => setTimeout(r, 250));
    return !!b.nextElementSibling?.classList.contains('open');
  });
  ok(abrioRow, 'pulsar el ⋯ ABRE su menú (la delegación funciona)');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] Y NADA DE ESTO ROMPIÓ EL JAVASCRIPT DE LA PÁGINA');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const errores = [];
  p.on('pageerror', e => errores.push(String(e.message).slice(0, 90)));
  await p.goto(BASE + '/admin/albaranes', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 600));
  ok(errores.length === 0, 'cero errores de JavaScript al cargar una pantalla cualquiera',
     errores[0] || '');
} catch (e) {
  fail++; console.error('  ✗ EXCEPCIÓN: ' + (e?.stack || e?.message || e));
} finally {
  await browser.close();
  db.prepare("DELETE FROM admin_sessions WHERE token LIKE 'gate-armazon-%'").run();
  db.close();
}

console.log('\n═════════ RESULTADO: ' + pass + ' ✓ · ' + fail + ' ✗ ═════════');
process.exit(fail ? 1 : 0);
