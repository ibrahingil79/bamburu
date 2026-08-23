// Gate de navegación — Inicio + DISA en el riel (sigue a D5). Contra el servidor real
// (tenant desarrollo-bamburu). Determinista, sin modelo. Verifica SOLO navegación/vista:
//
//   1. ORDEN: Inicio es el 1er icono (→ /admin) y DISA el 2º, ANTES de Ventas y el resto.
//   2. Submenú de DISA (mismo patrón flyout que las áreas): "Propuestas" (→ /admin/propuestas)
//      y "Hablar con DISA".
//   3. BADGE de pendientes SOBRE el icono de DISA, con el número que ya calcula D5
//      (contarPropuestasPendientes), y RETIRADO del topbar (ya no existe #tbProps/.tb-props).
//   4. "Hablar con DISA" abre el MISMO chat flotante existente (disaOpen → #disaModal.open),
//      sin duplicar el widget ni crear un hilo nuevo.
//   5. El resto del riel (Ventas, Compras y gastos, Contabilidad, Inventario, Catálogo, Ayuda)
//      y el topbar (campana, cuenta) siguen ahí. Cero errores JS (pageerror) al cargar.
//   6. Un usuario SIN permiso (ni invoices.read ni cobros.read) ve el icono de DISA y "Hablar
//      con DISA", pero NO ve el badge ni la entrada "Propuestas".
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { contarPropuestasPendientes } from '../modules/erp/propuestas.js';

const DB_PATH = '/home/ubuntu/bamburu/data/tenants/desarrollo-bamburu.db';
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const DOMAIN = 'desarrollo-bamburu.localhost';
const OWNER = 2;   // owner → bypass de permisos: ve todo (badge + Propuestas)

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB_PATH);
const now = Math.floor(Date.now() / 1000);
const mkSession = uid => {
  const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, uid, now, now + 1800, csrf);
  return token;
};

// Usuario SIN permiso: empleado activo, sin user_permissions → userPerms vacío. Creado y borrado aquí.
const noPermEmail = 'zz-nav-noperm-' + randomBytes(3).toString('hex') + '@bamburu.test';
const noPermId = db.prepare(
  "INSERT INTO admin_users (name,email,password_hash,role,active,must_change_password,created_at) VALUES ('ZZ Nav NoPerm',?,'x','employee',1,0,datetime('now'))"
).run(noPermEmail).lastInsertRowid;

const tokOwner = mkSession(OWNER);
const tokNoPerm = mkSession(noPermId);

// ── EL GATE SE TRAE SU PROPIA PROPUESTA (23 ago 2026) ───────────────────────────────────────────
// POR QUÉ. Este gate afirma que el badge de DISA enseña el número de propuestas PENDIENTES, y para
// afirmarlo exigía que el negocio tuviera alguna… sin crearla él. El 20 de agosto se resolvieron a
// mano las 39 que quedaban, el generador diario es idempotente por documento (una factura cuya
// propuesta ya se descartó no vuelve a generar otra) y el gate se quedó EN ROJO por una precondición
// que no era suya. Estuvo declarado en ROJOS_CONOCIDOS hasta que volvió a pasar de casualidad.
// Ahora se trae la suya, con marca y sufijo de pasada, y la borra en el finally. El BADGE sigue
// comparándose con el TOTAL del negocio: el gate no cambia lo que mide, solo deja de depender de
// que otro le haya dejado el escenario puesto.
const MARCA_PROP = 'ZZ nav-disa ' + randomBytes(3).toString('hex');
db.prepare(
  "INSERT INTO disa_proposals (type, status, subject, body, created_at) VALUES ('recordatorio_impago','pendiente',?,?,datetime('now'))"
).run(MARCA_PROP, MARCA_PROP + ' — propuesta de prueba del gate, se borra al terminar');

// El Chrome de puppeteer está roto en este arm64: se usa el Chromium del sistema (snap).
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/snap/bin/chromium',
  args: ['--no-sandbox'],
});

async function pageFor(token) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000 });   // escritorio: disaOpen abre la ventanita, no navega
  const errs = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));
  await page.setCookie({ name: 'asess', value: token, domain: DOMAIN, path: '/' });
  return { page, errs };
}

// Lee el riel: pin de Inicio + los grupos del sb-nav en orden.
const leerRiel = page => page.evaluate(() => {
  const sb = document.querySelector('.sidebar');
  if (!sb) return { sidebar: false };
  const pin = sb.querySelector('.disa-pin');
  const nav = sb.querySelector('.sb-nav');
  const groups = [...nav.querySelectorAll(':scope > .navg')].map(g => {
    const btn = g.querySelector(':scope > .nav-item');
    return { label: btn?.querySelector('.nav-label')?.textContent.trim(), id: btn?.id || null };
  });
  const ayuda = !!nav.querySelector('a[href="/docs"]');
  return {
    sidebar: true,
    pinHref: pin?.getAttribute('href'),
    pinLabel: pin?.querySelector('.nav-label')?.textContent.trim(),
    pinIcon: pin?.querySelector('i.ti')?.className || '',
    groups, ayuda,
  };
});

// Lee el submenú de DISA (los items existen en el DOM aunque el flyout esté oculto).
const leerFlyDisa = page => page.evaluate(() => {
  const btn = document.getElementById('disaRailBtn');
  if (!btn) return { present: false };
  const g = btn.closest('.navg');
  const items = [...g.querySelectorAll('.flyout .fly-item')].map(el => ({
    tag: el.tagName.toLowerCase(),
    label: el.textContent.trim(),
    href: el.getAttribute('href'),
  }));
  const badge = btn.querySelector('#propCount');
  const badgeVisible = badge ? getComputedStyle(badge).display !== 'none' : false;
  return {
    present: true,
    header: g.querySelector('.flyout .flyout-h')?.textContent.trim(),
    items,
    badgeText: badge ? badge.textContent.trim() : null,
    badgeVisible,
  };
});

try {
  // EL ORDEN DE FÁBRICA SE COMPRUEBA SOBRE EL ORDEN DE FÁBRICA. Desde que el menú se puede reordenar
  // por usuario, una preferencia guardada —de una prueba a mano o del propio dueño— dejaba este gate
  // en rojo con el producto perfectamente sano. Se retira la del usuario que se va a mirar, y así el
  // gate mide lo que dice medir en vez de heredar lo que hubiera en la base.
  db.prepare('DELETE FROM dashboard_layouts WHERE scope=?').run('menu:usuario:' + OWNER);

  // ── OWNER: orden del riel, submenú, badge, topbar limpio ─────────────────────
  const { page, errs } = await pageFor(tokOwner);
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle0' });

  const riel = await leerRiel(page);
  ok(riel.sidebar, 'el riel se renderiza');
  ok(riel.pinHref === '/admin' && riel.pinLabel === 'Inicio', 'Inicio es el 1er icono (arriba), enlaza al dashboard /admin (label "' + riel.pinLabel + '")');
  ok(/ti-home/.test(riel.pinIcon), 'Inicio usa icono de casa (ya no las ✨, que pasan a DISA)');
  ok(riel.groups[0]?.label === 'DISA' && riel.groups[0]?.id === 'disaRailBtn', 'DISA es el 2º icono del riel (1er grupo del sb-nav), antes que Ventas');
  ok(riel.groups[1]?.label === 'Ventas', 'Ventas viene JUSTO después de DISA (got "' + riel.groups[1]?.label + '")');
  const labels = riel.groups.map(g => g.label);
  for (const area of ['Ventas', 'Compras y gastos', 'Contabilidad', 'Inventario', 'Catálogo'])
    ok(labels.includes(area), 'sigue estando el área "' + area + '" en el riel');
  ok(riel.ayuda, 'sigue el enlace de Ayuda al pie del riel');

  const fly = await leerFlyDisa(page);
  ok(fly.present, 'el icono de DISA existe (#disaRailBtn)');
  ok(fly.header === 'DISA', 'el submenú se titula "DISA"');
  const prop = fly.items.find(i => i.label === 'Propuestas');
  const habla = fly.items.find(i => i.label === 'Hablar con DISA');
  ok(fly.items.length === 2, 'el submenú tiene exactamente 2 entradas (got ' + fly.items.length + ': ' + fly.items.map(i => i.label).join(', ') + ')');
  ok(prop && prop.tag === 'a' && prop.href === '/admin/propuestas', '"Propuestas" enlaza a /admin/propuestas');
  ok(habla && habla.tag === 'button', '"Hablar con DISA" es una acción (botón), no un enlace a pantalla nueva');

  // Badge = mismo número que el motor de D5, SOBRE el icono de DISA.
  const esperado = contarPropuestasPendientes(db);
  ok(esperado > 0, 'hay propuestas pendientes para probar el badge, y una es del gate (' + esperado + ')');
  ok(fly.badgeVisible && fly.badgeText === String(esperado), 'el badge sobre DISA muestra el nº pendiente ' + esperado + ' (got "' + fly.badgeText + '")');

  // El badge YA NO está en el topbar, pero campana y cuenta siguen.
  const topbar = await page.evaluate(() => ({
    tbProps: !!document.querySelector('#tbProps, .tb-props'),
    propCountEnTopbar: !!document.querySelector('.topbar #propCount'),
    bell: !!document.querySelector('#tbBell'),
    acct: !!document.querySelector('.acct'),
  }));
  ok(!topbar.tbProps && !topbar.propCountEnTopbar, 'el badge suelto del topbar (#tbProps) ya NO existe');
  ok(topbar.bell, 'la campana de avisos sigue en el topbar');
  ok(topbar.acct, 'el menú de cuenta sigue en el topbar');
  ok(errs.length === 0, 'cero errores JS al cargar /admin (got ' + errs.length + (errs.length ? ': ' + errs.join(' | ') : '') + ')');
  await page.close();

  // ── OWNER: "Hablar con DISA" abre el chat existente sin duplicar ni crear hilo ─
  const { page: p2, errs: errs2 } = await pageFor(tokOwner);
  await p2.goto(BASE + '/admin/clients', { waitUntil: 'networkidle0' });   // pantalla CON la burbuja flotante
  const hilosAntes = db.prepare('SELECT COUNT(*) n FROM disa_conversation_threads WHERE user_id=?').get(OWNER).n;
  const pre = await p2.evaluate(() => ({
    widgets: document.querySelectorAll('#disaFab').length,
    abierto: !!document.querySelector('#disaModal.open'),
    tieneOpen: typeof window.disaOpen === 'function',
  }));
  ok(pre.widgets === 1, 'en una pantalla normal hay UN widget flotante de DISA');
  ok(!pre.abierto, 'el widget arranca cerrado');
  ok(pre.tieneOpen, 'existe la función disaOpen del widget de siempre (se reutiliza, no se recrea)');
  // Abrir el flyout y pulsar "Hablar con DISA" como un usuario.
  await p2.evaluate(() => {
    const g = document.getElementById('disaRailBtn').closest('.navg');
    window.openFly(g);
    [...g.querySelectorAll('.flyout .fly-item')].find(el => el.textContent.trim() === 'Hablar con DISA').click();
  });
  await p2.waitForFunction(() => !!document.querySelector('#disaModal.open'), { timeout: 5000 }).catch(() => {});
  const post = await p2.evaluate(() => ({
    widgets: document.querySelectorAll('#disaFab').length,
    abierto: !!document.querySelector('#disaModal.open'),
  }));
  const hilosDespues = db.prepare('SELECT COUNT(*) n FROM disa_conversation_threads WHERE user_id=?').get(OWNER).n;
  ok(post.abierto, '"Hablar con DISA" abre la ventanita flotante existente (#disaModal.open)');
  ok(post.widgets === 1, 'sigue habiendo UN solo widget: no se duplicó nada');
  ok(hilosDespues === hilosAntes, 'no se creó ningún hilo nuevo (' + hilosAntes + ' antes = ' + hilosDespues + ' después)');
  ok(errs2.length === 0, 'cero errores JS en la pantalla del widget (got ' + errs2.length + (errs2.length ? ': ' + errs2.join(' | ') : '') + ')');
  await p2.close();

  // ── SIN PERMISO: ve DISA y "Hablar", pero ni badge ni "Propuestas" ───────────
  const { page: p3, errs: errs3 } = await pageFor(tokNoPerm);
  await p3.goto(BASE + '/admin/perfil', { waitUntil: 'networkidle0' });   // el perfil lo ve cualquiera logueado
  const rielNP = await leerRiel(p3);
  ok(rielNP.sidebar && rielNP.groups.some(g => g.id === 'disaRailBtn'), 'el usuario sin permiso también ve el icono de DISA');
  const flyNP = await leerFlyDisa(p3);
  ok(flyNP.present && flyNP.items.some(i => i.label === 'Hablar con DISA'), 'sin permiso: sigue viendo "Hablar con DISA" (el chat es de todos)');
  ok(!flyNP.items.some(i => i.label === 'Propuestas'), 'sin permiso: NO ve la entrada "Propuestas"');
  ok(flyNP.badgeText === null, 'sin permiso: NO hay badge de pendientes (#propCount ausente)');
  ok(errs3.length === 0, 'cero errores JS para el usuario sin permiso (got ' + errs3.length + (errs3.length ? ': ' + errs3.join(' | ') : '') + ')');
  await p3.close();

} catch (e) {
  fail++; console.error('  ✗ EXCEPCIÓN: ' + e.message + '\n' + e.stack);
} finally {
  try {
    db.prepare('DELETE FROM admin_sessions WHERE token IN (?,?)').run(tokOwner, tokNoPerm);
    db.prepare('DELETE FROM admin_users WHERE id=?').run(noPermId);
    // Por la MARCA, no por el id de esta pasada: si el gate muere a mitad, lo suyo se va igual.
    db.prepare("DELETE FROM disa_proposals WHERE subject LIKE 'ZZ nav-disa %'").run();
  } catch (e) { console.error('  (limpieza) ' + e.message); }
  await browser.close();
  db.close();
  console.log('\n' + (fail ? '✗ ' + fail + ' fallos, ' : '') + pass + ' OK');
  process.exit(fail ? 1 : 0);
}
