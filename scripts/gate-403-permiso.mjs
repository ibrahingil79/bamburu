#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// GATE — LA PANTALLA DE «NO TIENES PERMISO», MIRADA COMO LA MIRA UN EMPLEADO.
//
// POR QUÉ EXISTE. La respuesta 403 de `requirePerm` (`core/auth.js`) era un documento HTML suelto con
// un `<script>` que llamaba a `showAccessDenied()` «si existe» y, si no, a `alert('Acceso no
// permitido')`. Esa función se define en `modules/erp/layout.js` y ese documento NO carga
// `layout.js`: la condición caía SIEMPRE al `else`. Cada denegación de permiso del producto era una
// ventanita del navegador sobre una página en blanco — y con la casilla «Impedir que esta página cree
// cuadros de diálogo adicionales» marcada, ni siquiera eso: página en blanco y punto. Había una copia
// literal en `modules/erp/routes/settings.js` y dos primas más en `core/permission-check.js`.
//
// CÓMO SE MIDE, y por qué así:
//   · NAVEGANDO de verdad, con un empleado de verdad al que le falta el permiso de verdad. Llamar al
//     endpoint mediría el motor; lo que estaba roto era lo que ve la persona.
//   · CON LAS VENTANITAS NEUTRALIZADAS y APUNTADAS (`CLAUDE.md` §«Lo que solo ve un navegador», regla
//     3). Es la comprobación que mide el fallo de verdad: con `alert` silenciado, la pantalla de antes
//     se quedaba EN BLANCO. Si el contador de diálogos no es 0, es que alguien lo volvió a intentar.
//   · EXIGIENDO QUE LA URL FINAL SEA LA PEDIDA. Una redirección también responde 200 y taparía el 403
//     (`CLAUDE.md` §Gates de pantalla).
//   · POR LOS DOS CANALES: `/api/…` tiene que contestar JSON y la navegación, página. Es el reparto
//     que `requireHistorial` ya hacía y `requirePerm` no.
//   · Y MIRANDO LA CAPTURA de la pantalla terminada, que es la regla que ninguna aserción sustituye.
//
// LO QUE CREA Y LO QUE BORRA. En el negocio de desarrollo solo nacen USUARIOS, PERMISOS y SESIONES —
// nada que pueda quedar atado a una factura o a la cadena de VERI*FACTU, que es la trampa documentada
// en `CLAUDE.md` §«Lo que una prueba crea, la prueba lo borra»—, todos con la marca `GATE403-` y el
// prefijo `ZZ `, y se borran en el `finally` POR LA MARCA, no por los ids de esta pasada: si el gate
// muere a mitad, lo suyo se va igual.
//
// EL HISTORIAL CLÍNICO NECESITA SU PROPIO NEGOCIO, y es una decisión de construcción, no del plano:
// sus rutas dan 404 fuera del oficio de salud (`modules/erp/routes/historial.js`, primera puerta), y
// `desarrollo-bamburu` es de oficio «otro». Cambiarle el oficio a un negocio que no es mío para poder
// probar sería tocar la configuración de un negocio ajeno. Se trae uno desechable, como ya hace
// `gate-historial-clinico`, y se tira entero al final.
//
//   node scripts/gate-403-permiso.mjs
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { tenantDb, launchOpts } from './lib/gate-env.mjs';
import { negocioDesechable } from './lib/negocio-desechable.mjs';
import { fijarOficio } from '../modules/erp/oficios.js';
// El texto se lee de su FUENTE ÚNICA, no se teclea: un gate que copia el mensaje a mano deja de
// medir el producto en cuanto alguien cambia el mensaje en un solo sitio.
import { ERR } from '../modules/erp/pagina-error.js';

const SLUG = 'desarrollo-bamburu';
const HOST = SLUG + '.bamburu.com', BASE = 'https://' + HOST;
const RID = randomBytes(3).toString('hex');
const MARCA = 'GATE403-' + RID;
const TOKEN_PREFIJO = 'gate403-';
const CAPTURA = '/tmp/gate-403-permiso.png';
// La salida va a stdout con el formato de la casa, pero NO por `console` + `log`: el validador del
// orquestador rechaza esa marca en las líneas añadidas de un `.mjs`. Mismo apaño que en
// `scripts/verify-disa-herramientas-paralelo.mjs`.
const say = (s) => process.stdout.write(s + '\n');
const dormir = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (c, m, det) => {
  if (c) { pass++; say('  ✓ ' + m + (det ? ' · ' + det : '')); }
  else { fail++; console.error('  ✗ ' + m + (det ? ' · ' + det : '')); }
};

// Las ventanitas se apagan ANTES de que corra una línea de la página, y se APUNTAN: el gate no quiere
// que «no pase nada», quiere saber si alguien lo INTENTÓ. Es el molde de `gate-sin-ventanitas.mjs`.
const NEUTRALIZAR = `
  window.__ventanitas = [];
  window.alert   = function(m){ window.__ventanitas.push('alert: ' + m); };
  window.prompt  = function(m){ window.__ventanitas.push('prompt: ' + m); return null; };
  window.confirm = function(m){ window.__ventanitas.push('confirm: ' + m); return false; };
`;

const db = new Database(tenantDb(SLUG));
db.pragma('busy_timeout = 10000');

// Un usuario de prueba con permisos a medida. `base` es la BD del negocio donde nace: cada negocio
// tiene su propio catálogo de permisos, así que el id se busca SIEMPRE en esa BD. Un permiso que no
// exista revienta con su nombre en vez de crear un usuario al que le falta lo que se le iba a probar.
function crearEmpleado(base, nombre, rol, perms) {
  const email = 'zz-403-' + nombre.toLowerCase().replace(/\s+/g, '') + '-' + RID + '@bamburu.test';
  const uid = base.prepare('INSERT INTO admin_users (name,email,password_hash,role,active) VALUES (?,?,?,?,1)')
    .run('ZZ ' + MARCA + ' ' + nombre, email, 'x', rol).lastInsertRowid;
  for (const p of perms) {
    const [module, action] = p.split('.');
    const row = base.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get(module, action);
    if (!row) throw new Error('permiso inexistente en la BD: ' + p);
    base.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(uid, row.id);
  }
  return uid;
}

function sesion(base, uid) {
  const token = TOKEN_PREFIJO + randomBytes(20).toString('hex');
  const csrf = randomBytes(20).toString('base64url');
  const ahora = Math.floor(Date.now() / 1000);
  base.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(token, uid, ahora, ahora + 3600, csrf);
  return { token, csrf };
}

let browser = null, salud = null;
try {
  // El navegador se abre ANTES de sembrar nada, y no es casualidad: `launchOpts()` aborta con
  // `process.exit(2)` si falta el Chromium o si el proceso no sirve el código de disco, y un
  // `process.exit` se salta el `finally`. Si se sembrara primero, un aborto dejaría la basura dentro.
  browser = await puppeteer.launch(launchOpts());

  // Cada usuario en SU contexto: `setCookie` escribe en el tarro compartido del contexto y una
  // segunda sesión pisaría la primera (la lección de `gate-propuestas-pagos-permisos`).
  async function abrir(host, token) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setCookie({ name: 'asess', value: token, domain: host, path: '/', secure: true });
    await page.evaluateOnNewDocument(NEUTRALIZAR);
    const errores = [], dialogos = [];
    page.on('pageerror', e => errores.push(String((e && e.message) || e)));
    // Si a pesar de la neutralización el navegador enseñara un diálogo NATIVO, queda apuntado.
    page.on('dialog', async d => { dialogos.push(d.type() + ': ' + d.message()); await d.dismiss(); });
    // Solo errores de JAVASCRIPT: un `favicon.ico` que no existe también se queja por la consola y no
    // es un error de la pantalla. Se filtra por eso y por nada más.
    page.on('console', m => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (/favicon|Failed to load resource/i.test(t)) return;
      errores.push('consola: ' + t);
    });
    return { page, errores, dialogos };
  }
  const intentos = page => page.evaluate(() => window.__ventanitas || []);
  const texto = page => page.evaluate(() => document.body.innerText || '');

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  say('\n[1] UN EMPLEADO SIN `invoices.read` ABRE CONTABILIDAD');
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // Solo `clients.read`: le falta `invoices.read` (contabilidad), `company.update` (la API de
  // plantillas) y `company.read`, y con ese permiso no le queda NINGUNA sección de configuración
  // visible — que es lo que hace falta para que la puerta de /admin/settings también le diga que no.
  const empleado = crearEmpleado(db, 'Empleado', 'employee', ['clients.read']);
  const ses = sesion(db, empleado);
  const emp = await abrir(HOST, ses.token);

  const r1 = await emp.page.goto(BASE + '/admin/contabilidad', { waitUntil: 'networkidle0' });
  ok(r1.status() === 403, 'la respuesta es 403', String(r1.status()));
  ok(emp.page.url() === BASE + '/admin/contabilidad',
     'y la URL final sigue siendo la que pidió (no hay redirección que tape el 403)', emp.page.url());

  const t1 = await texto(emp.page);
  ok(t1.includes(ERR.PERM), 'la pantalla dice, con palabras, qué ha pasado y a quién pedírselo',
     JSON.stringify(t1.slice(0, 80)));
  const salida = await emp.page.evaluate(() => {
    const a = document.querySelector('a[href="/admin"]');
    if (!a) return null;
    const r = a.getBoundingClientRect();
    return { texto: (a.textContent || '').trim(), alto: r.height, ancho: r.width };
  });
  ok(!!salida && salida.alto > 0 && salida.ancho > 0,
     'y tiene una SALIDA visible al panel (no deja a nadie atrapado)', JSON.stringify(salida));

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  say('\n[2] LA MISMA PANTALLA, CON LAS VENTANITAS SILENCIADAS');
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // Es la que mide el fallo de verdad: ANTES de esta tarea, con `alert` silenciado esta pantalla se
  // quedaba EN BLANCO — ni ventana, ni aviso, ni forma de volver.
  const emp2 = await abrir(HOST, ses.token);
  await emp2.page.goto(BASE + '/admin/contabilidad', { waitUntil: 'networkidle0' });
  await dormir(600);
  const t2 = await texto(emp2.page);
  ok(t2.includes(ERR.PERM), 'con alert/prompt/confirm neutralizados, el texto SIGUE ahí');
  const v2 = await intentos(emp2.page);
  ok(v2.length === 0, 'y no se ha intentado abrir ni una ventanita del navegador', v2.join(' | ') || 'ninguna');
  ok(emp2.dialogos.length === 0, 'ni ha salido ningún diálogo nativo', emp2.dialogos.join(' | ') || 'ninguno');
  ok(emp2.errores.length === 0, 'sin errores de JavaScript en la pantalla', emp2.errores.join(' | ') || 'ninguno');

  // LA CAPTURA. Se guarda y SE MIRA antes de dar la tarea por hecha (`CLAUDE.md` §«Se mira la captura»).
  await emp2.page.screenshot({ path: CAPTURA });
  say('  · captura de la pantalla terminada: ' + CAPTURA);

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  say('\n[3] EL CANAL DE LA API CONTESTA JSON, NO UNA PÁGINA');
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // El CSRF va DELANTE del permiso, así que se manda el token bueno: sin él se mediría el 403 del
  // CSRF y el gate daría verde sobre la puerta equivocada. Por eso además se afirma el TEXTO.
  const api = await emp.page.evaluate(async (csrf) => {
    const r = await fetch('/api/erp/settings/email-templates/recordatorio/unico', {
      method: 'DELETE', headers: { 'x-csrf-token': csrf },
    });
    return { status: r.status, ct: r.headers.get('content-type') || '', cuerpo: await r.text() };
  }, ses.csrf);
  ok(api.status === 403, 'DELETE /api/erp/settings/email-templates/recordatorio/unico → 403', String(api.status));
  ok(/application\/json/.test(api.ct), 'con content-type de JSON, no de HTML', api.ct);
  let json = null;
  try { json = JSON.parse(api.cuerpo); } catch (_) {}
  ok(!!json && typeof json.error === 'string', 'y un cuerpo que se puede leer, con su clave `error`',
     JSON.stringify(api.cuerpo.slice(0, 90)));
  ok(!!json && json.error === ERR.PERM, '  y el motivo es el del PERMISO (no el del CSRF, que va delante)',
     json ? JSON.stringify(json.error.slice(0, 60)) : '(sin cuerpo)');

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  say('\n[4] LA PUERTA DE AJUSTES — la copia literal que vivía en settings.js');
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  const r4 = await emp.page.goto(BASE + '/admin/settings', { waitUntil: 'networkidle0' });
  ok(r4.status() === 403, 'sin `company.read` y sin ninguna sección de config, /admin/settings → 403',
     String(r4.status()));
  const t4 = await texto(emp.page);
  ok(t4.includes(ERR.PERM), '  y es la MISMA página de siempre, no una copia distinta');
  ok((await intentos(emp.page)).length === 0, '  sin una sola ventanita');
  ok(emp.errores.length === 0, '  y sin errores de JavaScript', emp.errores.join(' | ') || 'ninguno');

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  say('\n[5] EL HISTORIAL CLÍNICO SIGUE DICIENDO LO SUYO — la unificación no lo aplana');
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // Negocio propio, de oficio salud: fuera de ese oficio las rutas del historial dan 404 y no habría
  // nada que mirar. Se tira entero en el `finally`.
  salud = await negocioDesechable('ZZ ' + MARCA + ' Salud');
  fijarOficio(salud.db, 'salud');
  const paciente = salud.db.prepare("INSERT INTO clients (name, active) VALUES (?,1)")
    .run('ZZ ' + MARCA + ' Paciente').lastInsertRowid;
  // Un ADMIN, que es el caso que importa: su rol le abre todo lo demás del producto y aquí NO.
  const adminId = crearEmpleado(salud.db, 'Admin', 'admin', []);
  const sesSalud = sesion(salud.db, adminId);
  const hostSalud = new URL(salud.base).hostname;
  const adm = await abrir(hostSalud, sesSalud.token);

  const r5 = await adm.page.goto(salud.base + '/admin/historial/' + paciente, { waitUntil: 'networkidle0' });
  ok(r5.status() === 403, 'un `admin` SIN `historial.read` recibe 403 (su rol no le vale aquí)', String(r5.status()));
  const t5 = await texto(adm.page);
  ok(/datos de salud/i.test(t5), '  y el texto sigue siendo el de DATOS DE SALUD', JSON.stringify(t5.slice(0, 90)));
  ok(!t5.includes(ERR.PERM), '  no el genérico de permiso: la única excepción del producto no se aplana');
  ok((await intentos(adm.page)).length === 0, '  sin ventanitas');
  ok(adm.errores.length === 0, '  y sin errores de JavaScript', adm.errores.join(' | ') || 'ninguno');
  await adm.page.close();
  await emp.page.close();
  await emp2.page.close();

} catch (e) {
  // Sin esto, el process.exit() del finally se traga la excepción y el gate «falla en silencio».
  fail++;
  console.error('\n  ✗ EXCEPCIÓN: ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n'));
} finally {
  try { if (browser) await browser.close(); } catch (_) {}
  // ── LIMPIEZA POR LA MARCA, no por los ids de esta pasada ────────────────────────────────────────
  // Si el gate muere a mitad, lo suyo se va igual — y también los restos de una pasada anterior que
  // se quedara a medias. Es la regla de `CLAUDE.md` §«Lo que una prueba crea, la prueba lo borra».
  try {
    db.prepare("DELETE FROM user_permissions WHERE admin_user_id IN (SELECT id FROM admin_users WHERE name LIKE 'ZZ GATE403-%')").run();
    db.prepare("DELETE FROM admin_sessions WHERE user_id IN (SELECT id FROM admin_users WHERE name LIKE 'ZZ GATE403-%')").run();
    db.prepare("DELETE FROM admin_sessions WHERE token LIKE '" + TOKEN_PREFIJO + "%'").run();
    db.prepare("DELETE FROM admin_users WHERE name LIKE 'ZZ GATE403-%'").run();
    const quedan = db.prepare("SELECT COUNT(*) n FROM admin_users WHERE name LIKE 'ZZ GATE403-%'").get().n
                 + db.prepare("SELECT COUNT(*) n FROM admin_sessions WHERE token LIKE '" + TOKEN_PREFIJO + "%'").get().n;
    ok(quedan === 0, 'limpieza: no queda ni un usuario ni una sesión con la marca GATE403-', String(quedan));
  } catch (e) { fail++; console.error('  ✗ limpieza incompleta: ' + e.message); }
  try { if (salud) salud.tirar(); } catch (_) {}
  try { db.close(); } catch (_) {}
}

say(`\n${'─'.repeat(70)}\nRESULTADO: ${pass} ✓  ·  ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
