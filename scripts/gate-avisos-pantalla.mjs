// Gate de navegador — la pantalla central /admin/avisos SE GESTIONA, no solo enlaza.
// Contra el servidor real (tenant desarrollo-bamburu). Lo que verifica, pulsando de verdad:
//   1. Cada aviso trae una ACCIÓN (botón que abre el modal compartido), no un enlace a otra pantalla.
//   2. Pulsar "Registrar cobro" abre el modal de cobro CON el importe pendiente precargado.
//   3. Registrar el cobro RESUELVE el aviso: la fila desaparece y el total baja EN VIVO.
//   4. "Visto" POR AVISO: cada fila se marca/desmarca por separado; "marcar todos" apaga la
//      campana al instante. Abrir la pantalla NO marca nada por su cuenta.
//   5. La campana ABRE un panel de notificaciones (con su "Visto" por aviso) y lleva a la pantalla.
// Deshace el cobro al terminar (borra el apunte que creó) y deja el tenant como estaba.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

const DB_PATH = '/home/ubuntu/bamburu/data/tenants/desarrollo-bamburu.db';
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const UID = 2;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB_PATH);
const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, UID, now, now + 1800, csrf);

// Punto de restauración: cualquier apunte de cobro creado por el gate se borra al final.
const maxPayId = db.prepare('SELECT COALESCE(MAX(id),0) n FROM invoice_payments').get().n;
const seenSnap = db.prepare('SELECT fingerprint FROM alert_seen_user WHERE user_id=?').get(UID);

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/snap/bin/chromium',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.setCookie({ name: 'asess', value: token, domain: 'desarrollo-bamburu.localhost', path: '/' });

const totalEnPantalla = () => page.$eval('#avTotal', e => Number(e.textContent.trim()));
// Señal única del chrome: el punto de la campana.
const campana = () => page.evaluate(() => {
  const dot = document.querySelector('#tbBell .dot');
  if (!dot) return { present: false };
  return { present: true, visto: dot.classList.contains('visto'), oculto: dot.style.display === 'none' };
});

try {
  // Estado de partida determinista: huella vacía → todos SIN VER, campana roja.
  db.prepare("INSERT INTO alert_seen_user (user_id, fingerprint) VALUES (?,'[]') ON CONFLICT(user_id) DO UPDATE SET fingerprint='[]'").run(UID);

  await page.goto(BASE + '/admin/avisos', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#avBody tr.frow', { timeout: 8000 });

  // ── 1. Cada aviso trae una ACCIÓN, no solo un enlace ────────────────────────
  const acciones = await page.evaluate(() => {
    const filas = [...document.querySelectorAll('#avBody tr.frow')];
    return {
      total: filas.length,
      conBoton: filas.filter(tr => tr.querySelector('td:last-child button')).length,
      soloEnlace: filas.filter(tr => !tr.querySelector('td:last-child button')).length,
      etiquetas: [...new Set(filas.map(tr => tr.querySelector('.badge')?.textContent.trim()))],
    };
  });
  ok(acciones.conBoton > 0, 'las filas traen BOTÓN de acción, no solo enlaces (' + acciones.conBoton + '/' + acciones.total + ')');
  // Las únicas filas sin botón deben ser las de recurrente (emitir = documento legal → se revisa).
  const sinBotonEsperado = await page.evaluate(() =>
    [...document.querySelectorAll('#avBody tr.frow')]
      .filter(tr => !tr.querySelector('td:last-child button'))
      .every(tr => tr.querySelector('.badge')?.textContent.trim() === 'Recurrente'));
  ok(sinBotonEsperado, 'las únicas filas sin botón son las de Recurrente (emitir factura = confirm-first)');

  // ── 2. Pulsar "Registrar cobro" abre el modal con el importe precargado ─────
  const N0 = await totalEnPantalla();
  const campana0 = await campana();
  // La factura más pequeña vencida es la del cliente con nombre XSS: pulsar SU botón prueba
  // además que el escapado del nombre no rompe el onclick.
  const objetivo = 'F2026-0017';
  const clicado = await page.evaluate((num) => {
    const tr = [...document.querySelectorAll('#avBody tr.frow')].find(t => t.textContent.includes(num));
    if (!tr) return false;
    const btn = [...tr.querySelectorAll('button')].find(b => b.textContent.includes('Registrar cobro'));
    if (!btn) return false;
    btn.click();
    return true;
  }, objetivo);
  ok(clicado, 'encuentro y pulso "Registrar cobro" en la fila de ' + objetivo + ' (cliente con nombre XSS)');

  await page.waitForSelector('#cobroModal.open #pay-amount', { timeout: 8000 });
  const importe = await page.$eval('#pay-amount', e => e.value);
  ok(Number(importe) === 15.61, 'el modal abre con el importe pendiente precargado (' + importe + ')');

  // ── 3. Registrar el cobro RESUELVE el aviso, en vivo ────────────────────────
  await page.evaluate(() => {
    [...document.querySelectorAll('#cobroModal button')].find(b => b.textContent.trim() === 'Registrar cobro').click();
  });
  await page.waitForFunction((num) => {
    const t = document.getElementById('avBody').textContent;
    return !t.includes(num);
  }, { timeout: 8000 }, objetivo);
  ok(true, 'tras registrar el cobro, el aviso DESAPARECE de la lista sin recargar');

  const N1 = await totalEnPantalla();
  ok(N1 === N0 - 1, 'el total baja en vivo: ' + N0 + ' → ' + N1);

  const campana1 = await campana();
  ok(campana0.present && !campana0.visto, 'la campana estaba ROJA al entrar (nada marcado como visto)');
  ok(campana1.present && !campana1.visto,
    'abrir la pantalla NO marca nada: la campana sigue ROJA (el "visto" lo decide el usuario)');

  // ── 3bis. "Visto" POR AVISO, y "marcar todos" ───────────────────────────────
  // El modal sigue abierto (se refresca para enseñar el cobro recién hecho): su overlay tapa la
  // tabla, así que hay que cerrarlo antes de pulsar nada de la lista.
  await page.evaluate(() => closeModal('cobroModal'));
  await page.waitForFunction(() => !document.querySelector('#cobroModal.open'), { timeout: 5000 });

  const sinVer0 = await page.$eval('#avSinVer', e => e.textContent.trim());
  ok(/\d+ sin ver/.test(sinVer0), 'la cabecera dice cuántos quedan sin ver ("' + sinVer0 + '")');
  const filasSinVer0 = await page.$$eval('#avBody tr.sinver', els => els.length);
  ok(filasSinVer0 === N1, 'todas las filas salen marcadas SIN VER (' + filasSinVer0 + ')');

  // Marcar UN aviso: baja el contador de "sin ver", pero la campana sigue roja (quedan más).
  await page.click('#avBody tr.frow .av-visto');
  await page.waitForFunction(n => document.querySelectorAll('#avBody tr.sinver').length === n - 1, { timeout: 8000 }, N1);
  ok(true, 'marcar UN aviso como visto apaga SOLO esa fila');
  const campanaTrasUno = await campana();
  ok(campanaTrasUno.present && !campanaTrasUno.visto, 'la campana sigue ROJA: aún quedan avisos sin ver');

  // Desmarcarlo: vuelve a estar sin ver.
  await page.click('#avBody tr.frow .av-visto.on');
  await page.waitForFunction(n => document.querySelectorAll('#avBody tr.sinver').length === n, { timeout: 8000 }, N1);
  ok(true, 'se puede volver a marcar como NO visto ("esto todavía lo tengo que mirar")');

  // Marcar todos → la campana pasa a gris sin recargar.
  await page.click('#avVerTodos');
  await page.waitForFunction(() => document.querySelectorAll('#avBody tr.sinver').length === 0, { timeout: 8000 });
  const campanaTrasTodos = await campana();
  ok(campanaTrasTodos.present && campanaTrasTodos.visto,
    '"Marcar todos como vistos" pone la campana GRIS al instante, sin recargar');
  const sinVerFinal = await page.$eval('#avSinVer', e => e.style.display);
  ok(sinVerFinal === 'none', 'desaparece el contador de "sin ver" cuando no queda ninguno');

  // El cobro se guardó de verdad, por el endpoint validado (no un truco de la UI).
  const pagos = db.prepare('SELECT COUNT(*) n FROM invoice_payments WHERE invoice_id=? AND id>?').get(18, maxPayId).n;
  ok(pagos === 1, 'el cobro quedó registrado en invoice_payments por el endpoint validado');

  // ── 4. Campana y badge de Inicio enlazan a la pantalla ──────────────────────
  // La campana ABRE un panel (no es un simple enlace): se comprueba pulsándola.
  await page.click('#tbBell');
  await page.waitForSelector('#bellPanel.open .bell-item', { timeout: 8000 });
  const panel = await page.evaluate(() => ({
    items: document.querySelectorAll('#bellList .bell-item').length,
    conBotonVisto: document.querySelectorAll('#bellList .bell-ver[data-key]').length,
    marcarTodos: !!document.getElementById('bellAll'),
    pie: document.querySelector('.bell-foot')?.getAttribute('href'),
    dot: !!document.querySelector('#tbBell .dot'),
  }));
  ok(panel.items > 0, 'pulsar la campana ABRE un panel con los avisos (' + panel.items + ')');
  ok(panel.conBotonVisto === panel.items, 'cada aviso del panel trae su botón "Visto" (' + panel.conBotonVisto + ')');
  ok(panel.marcarTodos, 'el panel tiene "Marcar todos como vistos"');
  ok(panel.pie === '/admin/avisos', 'el panel lleva a /admin/avisos para resolverlos');
  ok(panel.dot, 'la campana muestra el punto porque quedan avisos');
  await page.keyboard.press('Escape');

  await page.goto(BASE + '/admin', { waitUntil: 'networkidle0' });
  const inicio = await page.evaluate(() => {
    const t = document.querySelector('a.disa-fig-link');
    const filas = [...document.querySelectorAll('.disa-row')];
    return {
      tarjetaTag: t ? t.tagName : null,
      tarjetaHref: t ? t.getAttribute('href') : null,
      filas: filas.length,
      filasConEnlace: filas.filter(f => f.tagName === 'A' && f.getAttribute('href') === '/admin/avisos').length,
    };
  });
  ok(inicio.tarjetaTag === 'A' && inicio.tarjetaHref === '/admin/avisos', 'la tarjeta "Avisos" del Inicio enlaza a /admin/avisos (era un div muerto)');
  ok(inicio.filas === 1 && inicio.filasConEnlace === 1, 'queda UNA sola fila de avisos y es accionable (' + inicio.filas + ')');

} catch (e) {
  fail++; console.error('  ✗ EXCEPCIÓN: ' + e.message);
} finally {
  try {
    // Deshace el cobro que creó el gate (borra solo SUS apuntes) y restaura la huella de visto.
    const borrados = db.prepare('DELETE FROM invoice_payments WHERE id>?').run(maxPayId).changes;
    console.log('  (limpieza) apuntes de cobro borrados: ' + borrados);
    if (seenSnap) db.prepare("INSERT INTO alert_seen_user (user_id, fingerprint) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET fingerprint=excluded.fingerprint").run(UID, seenSnap.fingerprint);
    else db.prepare('DELETE FROM alert_seen_user WHERE user_id=?').run(UID);
    db.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  } catch (e) { console.error('  (limpieza) ' + e.message); }
  await browser.close();
  db.close();
  console.log('\n' + (fail ? '✗ ' + fail + ' fallos, ' : '') + pass + ' OK');
  process.exit(fail ? 1 : 0);
}
