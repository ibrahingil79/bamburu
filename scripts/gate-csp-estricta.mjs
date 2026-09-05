// Gate de navegador — C4b-1: las superficies ENDURECIDAS sirven script-src SIN 'unsafe-inline' y
// siguen funcionando. Contra el servidor real.
//
// QUÉ MIDE Y POR QUÉ. Endurecer la CSP no es "cambiar una cabecera": en cuanto una respuesta lleva un
// nonce, el navegador IGNORA 'unsafe-inline' en ESA respuesta y **cualquier `onclick=` de atributo que
// se haya escapado deja de funcionar — en silencio, sin error visible en la página**. Ese es el riesgo
// real de C4b, no el número de líneas. Por eso aquí no basta con mirar la cabecera: se PULSAN los
// botones y se escucha al navegador (`securitypolicyviolation`), que es el único que dice la verdad.
//
// Las superficies endurecidas, y por qué cada una:
//   · /registro   — pública y ANÓNIMA (2 handlers).
//   · /superadmin — la cuenta que ve TODOS los negocios (11 handlers). C4a encontró aquí el peor
//                   agujero del proyecto: un nombre de negocio malicioso ejecutándose en esta sesión.
//   · /reservar   — pública y anónima, endurecida desde el primer día (PIEZA 6).
//   ⚙️ 4 SEP 2026 (csp-unsafe-inline), tres más, cada una migrada ANTES de endurecerla:
//   · /portal     — por donde entran los CLIENTES del negocio. No hizo falta migrar nada: cero
//                   handlers y cero código en línea, medido sobre el HTML servido.
//   · /acceso     — 2 handlers y 1 bloque en línea, migrados a addEventListener + nonce.
//   · /           — la landing. 1 handler y 2 bloques en línea, migrados igual.
// El ERP (546 handlers hoy, medidos) se queda con 'unsafe-inline' a propósito: meterlo aquí sin
// migrar sería exactamente el fallo que este gate existe para impedir.
//
//   node scripts/gate-csp-estricta.mjs
import puppeteer from 'puppeteer';
import { launchOpts, APP_DIR } from './lib/gate-env.mjs';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { join } from 'path';

const BASE = 'http://localhost:3000';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const cdb = new Database(join(APP_DIR, 'data', 'control.db'));
const saToken = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
cdb.prepare('INSERT INTO superadmin_sessions (token,superadmin_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(saToken, 1, now, now + 900, randomBytes(32).toString('base64url'));

// ── El portal necesita un cliente y un enlace de verdad ──────────────────────────────────────────
// Se siembra en el negocio de desarrollo, con MARCA reconocible, y se borra en el `finally` POR LA
// MARCA y no por los ids de esta pasada: si el gate muere a mitad, lo suyo se va igual.
const PORTAL_BASE = 'http://desarrollo-bamburu.localhost:3000';
const RID = randomBytes(3).toString('hex');
const MARCA = 'ZZ CSP ' + RID;
const MARCA_MSG = 'ZZ mensaje de comprobacion CSP ' + RID;
const pdb = new Database(join(APP_DIR, 'data', 'tenants', 'desarrollo-bamburu.db'));
const { createToken } = await import('../modules/portal/portal.js');
const portalClienteId = pdb.prepare(
  'INSERT INTO clients (name,email,active) VALUES (?,?,1)').run(MARCA, 'delivered@resend.dev').lastInsertRowid;
const portalToken = createToken(pdb, portalClienteId, 1);

// ⚙️ 4 SEP 2026 — UNA OPORTUNIDAD DE VERDAD PARA EL TABLERO. El negocio de desarrollo tiene tres,
// pero dos están archivadas y la otra perdida: el tablero sale VACÍO y no habría nada que pulsar.
// Un gate que no puede pulsar no verifica nada, así que se siembra la suya, con la misma MARCA que
// el resto, y se retira en el `finally` por la marca (no por el id de esta pasada).
const oppId = pdb.prepare(`INSERT INTO opportunities
    (client_id, title, amount, stage, probability, status, stage_changed_at, active, created_at)
  VALUES (?, ?, 1000, 'nuevo', 50, 'activa', datetime('now'), 1, datetime('now'))`)
  .run(portalClienteId, MARCA + ' oportunidad').lastInsertRowid;

// ⚙️ 4 SEP 2026 — la primera pantalla del PANEL ya endurecida. Necesita sesión de dueño.
const ERP_BASE = 'http://desarrollo-bamburu.localhost:3000';
const erpTok = 'gate-csp-erp-' + randomBytes(12).toString('hex');
const erpOwner = pdb.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
pdb.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(erpTok, erpOwner.id, now, now + 1800, randomBytes(12).toString('hex'));

const browser = await puppeteer.launch({ ...launchOpts() });

// Apunta TODA violación de CSP que declare el navegador. Es la red que caza un handler olvidado.
async function nuevaPagina() {
  const p = await browser.newPage();
  p.__csp = [];
  await p.evaluateOnNewDocument(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => {
      window.__csp.push(e.violatedDirective + ' ← ' + (e.sourceFile || '') + ':' + e.lineNumber);
    });
  });
  return p;
}
const violaciones = p => p.evaluate(() => window.__csp || []);
const cabecera = r => (r.headers()['content-security-policy'] || '');

try {
  // ── 1 · La cabecera: nonce sí, unsafe-inline no ──
  console.log('\n[1] La política que se sirve en cada superficie');
  const p1 = await nuevaPagina();
  const r1 = await p1.goto(BASE + '/registro', { waitUntil: 'networkidle0' });
  const csp1 = cabecera(r1);
  ok(/script-src[^;]*'nonce-/.test(csp1), '/registro — script-src lleva nonce');
  ok(!/script-src[^;]*'unsafe-inline'/.test(csp1), "/registro — script-src YA NO lleva 'unsafe-inline'");
  ok(/style-src[^;]*'unsafe-inline'/.test(csp1), "/registro — style-src SÍ lo conserva (decidido: 2027 style=, valor menor)");

  // El nonce de la cabecera y el de la etiqueta tienen que ser el MISMO en la MISMA respuesta,
  // y cambiar en cada petición: un nonce fijo no protege de nada.
  const nonceCab = (csp1.match(/'nonce-([^']+)'/) || [])[1];
  const nonceTag = await p1.evaluate(() => (document.querySelector('script[nonce]') || {}).nonce
    || (document.querySelector('script[nonce]') || {}).getAttribute?.('nonce'));
  ok(!!nonceCab && !!nonceTag, '/registro — hay nonce en la cabecera y en la etiqueta');
  const r1b = await p1.goto(BASE + '/registro', { waitUntil: 'networkidle0' });
  const nonce2 = (cabecera(r1b).match(/'nonce-([^']+)'/) || [])[1];
  ok(nonceCab !== nonce2, 'el nonce CAMBIA en cada petición (no es fijo)');

  // ── 2 · El ERP sigue con la política de siempre: no se ha endurecido de rebote ──
  console.log('\n[2] El ERP NO se ha endurecido (sus 546 handlers siguen vivos, a propósito)');
  const r2 = await p1.goto('http://desarrollo-bamburu.localhost:3000/admin/login', { waitUntil: 'networkidle0' });
  ok(/script-src[^;]*'unsafe-inline'/.test(cabecera(r2)), "/admin — conserva 'unsafe-inline' (C4b-4 sin decidir)");
  ok(!/script-src[^;]*'nonce-/.test(cabecera(r2)), '/admin — sin nonce: no se ha endurecido a medias');

  // ── 3 · /registro FUNCIONA con la CSP estricta ──
  console.log('\n[3] /registro — la pantalla vive y sus botones responden');
  const p3 = await nuevaPagina();
  await p3.goto(BASE + '/registro', { waitUntil: 'networkidle0' });
  ok((await violaciones(p3)).length === 0, 'ninguna violación de CSP al cargar');
  const jsVivo = await p3.evaluate(() => typeof window.togglePw === 'function' && typeof window.crear === 'function');
  ok(jsVivo, 'el <script> con nonce SÍ se ejecutó (togglePw y crear existen)');
  // El botón de mostrar/ocultar contraseña: se pulsa y tiene que CAMBIAR algo.
  const antes = await p3.evaluate(() => document.getElementById('pw-toggle')?.textContent);
  await p3.evaluate(() => document.getElementById('pw-toggle').click());
  const despues = await p3.evaluate(() => document.getElementById('pw-toggle')?.textContent);
  ok(antes && despues && antes !== despues, 'el botón "Mostrar" responde al clic (' + antes + ' → ' + despues + ')');
  ok((await violaciones(p3)).length === 0, 'y tras pulsarlo sigue sin violaciones');

  // ── 4 · /superadmin FUNCIONA con la CSP estricta ──
  console.log('\n[4] /superadmin — el panel vive y los botones de cada fila responden');
  const p4 = await nuevaPagina();
  await p4.setCookie({ name: 'sadm', value: saToken, domain: 'localhost', path: '/' });
  const r4 = await p4.goto(BASE + '/superadmin/negocios', { waitUntil: 'networkidle0' });
  ok(/script-src[^;]*'nonce-/.test(cabecera(r4)) && !/script-src[^;]*'unsafe-inline'/.test(cabecera(r4)),
     '/superadmin/negocios — nonce sí, unsafe-inline no');
  ok((await violaciones(p4)).length === 0, 'ninguna violación de CSP al cargar');
  ok(await p4.evaluate(() => typeof window.saCap === 'function' && typeof window.saApi === 'function'),
     'los <script> con nonce se ejecutaron (saCap del contenido y saApi del layout)');

  // El clic REAL sobre el botón de una fila: es lo que dispara saCap por delegación.
  // Todo va con guarda: contra un código sin migrar estos elementos NO existen, y un gate que
  // revienta con un TypeError no distingue "he encontrado el fallo" de "estoy roto".
  const hayFilas = await p4.evaluate(() => !!document.querySelector('tbody tr[data-id] button[data-act="cap"]'));
  ok(hayFilas, 'hay al menos un negocio con su botón "Tope IA" (data-act, sin onclick)');
  const abrio = hayFilas && await p4.evaluate(() => document.querySelector('tbody tr[data-id] button[data-act="cap"]').click())
    .then(() => p4.waitForFunction(() => document.getElementById('modalBox').innerHTML.includes('Tope de IA'), { timeout: 8000 }))
    .then(() => true).catch(() => false);
  ok(abrio, 'pulsar "Tope IA" abre su modal → la DELEGACIÓN funciona sin onclick de atributo');
  ok((await violaciones(p4)).length === 0, 'y el modal no genera violaciones');
  // Los botones DENTRO del modal también se enganchan por JS: si no, quedarían muertos.
  ok(await p4.evaluate(() => { const b = document.getElementById('capCancel'); if (!b) return false; b.click(); return document.getElementById('modalBg').style.display === 'none'; }),
     'el "Cancelar" del modal cierra → los botones del innerHTML también están enganchados');

  // ── 5 · La LANDING: el botón del menú responde con la CSP estricta ──
  console.log('\n[5] / (landing) — carga limpia y el botón del menú lleva a donde debe');
  const p5 = await nuevaPagina();
  const r5 = await p5.goto(BASE + '/', { waitUntil: 'networkidle0' });
  ok(/script-src[^;]*'nonce-/.test(cabecera(r5)) && !/script-src[^;]*'unsafe-inline'/.test(cabecera(r5)),
     '/ — nonce sí, unsafe-inline no');
  ok((await violaciones(p5)).length === 0, 'ninguna violación de CSP al cargar la landing');
  ok(await p5.evaluate(() => !!document.getElementById('btnBurger')),
     'el botón del menú existe y ya NO lleva el salto en un atributo');
  // SE PULSA DE VERDAD. Antes esto era un handler de atributo: con la cabecera estricta habría
  // quedado mudo sin decir nada, y una comprobación que solo cargue la página lo daría por bueno.
  const fueARegistro = await p5.evaluate(() => document.getElementById('btnBurger').click())
    .then(() => p5.waitForFunction(() => location.pathname === '/registro', { timeout: 8000 }))
    .then(() => true).catch(() => false);
  ok(fueARegistro, 'pulsar el botón del menú NAVEGA a /registro (el enganche por JS funciona)');

  // ── 6 · /acceso: los dos botones migrados responden ──
  console.log('\n[6] /acceso — los dos botones migrados responden al clic');
  const p6 = await nuevaPagina();
  const r6 = await p6.goto(BASE + '/acceso', { waitUntil: 'networkidle0' });
  ok(/script-src[^;]*'nonce-/.test(cabecera(r6)) && !/script-src[^;]*'unsafe-inline'/.test(cabecera(r6)),
     '/acceso — nonce sí, unsafe-inline no');
  ok((await violaciones(p6)).length === 0, 'ninguna violación de CSP al cargar');
  ok(await p6.evaluate(() => typeof window.findTenant === 'function' && typeof window.goBack === 'function'),
     'el bloque con nonce se ejecutó (findTenant y goBack existen)');
  // El email es de un dominio que NO PUEDE recibir correo (.invalid) y que no existe como negocio:
  // la norma de esta casa es que ninguna comprobación escriba a una bandeja de verdad.
  await p6.evaluate(() => { document.getElementById('emailIn').value = 'zz-csp-' + Date.now() + '@example.invalid'; });
  const pasoAPaso2 = await p6.evaluate(() => document.getElementById('btnContinue').click())
    .then(() => p6.waitForFunction(() => document.getElementById('step2').style.display === 'block', { timeout: 8000 }))
    .then(() => true).catch(() => false);
  ok(pasoAPaso2, 'pulsar "Continuar" avanza al paso 2 (el botón NO está muerto)');
  const volvio = await p6.evaluate(() => document.getElementById('btnBack').click())
    .then(() => p6.waitForFunction(() => document.getElementById('step1').style.display !== 'none', { timeout: 8000 }))
    .then(() => true).catch(() => false);
  ok(volvio, 'pulsar "Usar otro email" vuelve al paso 1');
  ok((await violaciones(p6)).length === 0, 'y tras pulsar los dos, sigue sin violaciones');

  // ── 7 · /portal: el formulario del cliente se envía de verdad ──
  console.log('\n[7] /portal — el cliente entra y su formulario ENVÍA');
  const p7 = await nuevaPagina();
  const r7 = await p7.goto(PORTAL_BASE + '/portal/' + portalToken, { waitUntil: 'networkidle0' });
  ok(/script-src[^;]*'nonce-/.test(cabecera(r7)) && !/script-src[^;]*'unsafe-inline'/.test(cabecera(r7)),
     '/portal — nonce sí, unsafe-inline no');
  ok(p7.url().endsWith('/portal'), 'el enlace de un solo uso deja al cliente en /portal');
  ok((await violaciones(p7)).length === 0, 'ninguna violación de CSP al cargar el portal');
  const hayForm = await p7.evaluate(() => !!document.querySelector('form[action="/portal/mensaje"] textarea'));
  ok(hayForm, 'el formulario de mensaje está en la página');
  // SE ENVÍA DE VERDAD: un formulario que no llega es lo mismo que un botón muerto.
  const envio = hayForm && await p7.evaluate((t) => {
    document.querySelector('form[action="/portal/mensaje"] textarea').value = t;
    document.querySelector('form[action="/portal/mensaje"] button[type="submit"]').click();
    return true;
  }, MARCA_MSG).then(() => p7.waitForNavigation({ timeout: 10000 })).then(() => true).catch(() => false);
  ok(envio, 'pulsar "Enviar" manda el formulario y el servidor contesta');
  const llego = pdb.prepare('SELECT COUNT(*) c FROM portal_mensajes WHERE texto=?').get(MARCA_MSG)?.c > 0;
  ok(llego, 'y el mensaje LLEGÓ a la base: no se perdió por el camino');
  ok((await violaciones(p7)).length === 0, 'y el envío no genera violaciones');

  // ── 8 · /admin: la PRIMERA pantalla del panel con la cabecera estricta ──
  console.log('\n[8] /admin — la primera del panel, y sus controles del armazón responden');
  const p8 = await nuevaPagina();
  await p8.setCookie({ name: 'asess', value: erpTok, domain: 'desarrollo-bamburu.localhost', path: '/' });
  const r8 = await p8.goto(ERP_BASE + '/admin', { waitUntil: 'networkidle0' });
  ok(/script-src[^;]*'nonce-/.test(cabecera(r8)) && !/script-src[^;]*'unsafe-inline'/.test(cabecera(r8)),
     '/admin — nonce sí, unsafe-inline no');
  // Y LA REGLA NO ARRASTRA A LAS DEMÁS: eso es la mitad del valor de esta ficha.
  const r8b = await p8.goto(ERP_BASE + '/admin/clients', { waitUntil: 'networkidle0' });
  ok(/script-src[^;]*'unsafe-inline'/.test(cabecera(r8b)),
     '  y /admin/clients SIGUE con la política de siempre: la regla es exacta, no un prefijo');
  await p8.goto(ERP_BASE + '/admin', { waitUntil: 'networkidle0' });
  ok((await violaciones(p8)).length === 0, 'ninguna violación de CSP al cargar /admin');
  // SE PULSA EL ARMAZÓN: es lo que se quedó mudo si la migración fallara.
  const fly8 = await p8.evaluate(async () => {
    const g = document.querySelector('[data-navg]'); if (!g) return 'sin grupos';
    g.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    await new Promise(r => setTimeout(r, 250));
    return g.querySelector('.flyout')?.classList.contains('open') ? 'ok' : 'el desplegable no abrió';
  });
  ok(fly8 === 'ok', 'el menú lateral abre su desplegable con la cabecera estricta puesta', fly8);
  const bell8 = await p8.evaluate(async () => {
    const b = document.querySelector('[data-act="bell"]'); if (!b) return 'sin campana';
    const antes = b.getAttribute('aria-expanded'); b.click();
    await new Promise(r => setTimeout(r, 250));
    return b.getAttribute('aria-expanded') !== antes ? 'ok' : 'no reacciona';
  });
  ok(bell8 === 'ok', 'la campana responde al clic', bell8);
  // EL BOTÓN DE UN GRUPO DEL MENÚ, PULSADO. Se añadió el 4 sep 2026 porque el rojo provocado de esa
  // tanda SE QUEDÓ VERDE: se le devolvió el handler de atributo a ESTE botón y el gate no se enteró,
  // porque probaba el desplegable por el ratón y la campana, pero nunca pulsaba un grupo. Una
  // reversión que no pone rojo no prueba nada.
  const grupo8 = await p8.evaluate(async () => {
    const b = document.querySelector('[data-navg] .nav-item'); if (!b) return 'sin botón de grupo';
    const g = b.closest('[data-navg]');
    document.querySelectorAll('.flyout.open').forEach(f => f.classList.remove('open'));
    b.click();
    await new Promise(r => setTimeout(r, 300));
    return g.querySelector('.flyout')?.classList.contains('open') ? 'ok' : 'el grupo no abrió al pulsarlo';
  });
  ok(grupo8 === 'ok', 'PULSAR un grupo del menú abre su desplegable', grupo8);
  // Y LA RED DE SEGURIDAD, barata y directa: en una pantalla ENDURECIDA no puede quedar ni un
  // handler de atributo. Cualquiera que vuelva, aunque este gate no lo pulse, cae aquí.
  const sueltos8 = await p8.evaluate(() => {
    const h = document.documentElement.outerHTML.replace(/<script[\s\S]*?<\/script>/gi, '');
    return (h.match(/\son[a-z]+\s*=\s*["']/gi) || []).length;
  });
  ok(sueltos8 === 0, 'y NO queda ni un handler de atributo en la pantalla endurecida',
     sueltos8 ? 'quedan ' + sueltos8 : '0');
  ok((await violaciones(p8)).length === 0, 'y tras pulsar, sigue sin violaciones');

  // ── 9 · LAS 222 PANTALLAS DEL PANEL Y EL WIDGET DE DISA, PULSADO ──
  console.log('\n[9] El panel: 222 pantallas endurecidas, y el widget de DISA responde al pulsarlo');
  const p9 = await nuevaPagina();
  await p9.setCookie({ name: 'asess', value: erpTok, domain: 'desarrollo-bamburu.localhost', path: '/' });
  // La conversación con DISA se INTERCEPTA: pulsar el botón tiene que soltar la petición, que es lo
  // que prueba que el control está vivo. Llamar al modelo de verdad costaría dinero y dependería de
  // la cuota del mes — y lo que se mide aquí es el botón, no el modelo.
  let pidioDisa = false;
  await p9.setRequestInterception(true);
  p9.on('request', (req) => {
    if (req.url().includes('/api/disa/message')) {
      pidioDisa = true;
      return req.respond({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ reply: 'ZZ respuesta de comprobacion', thread_id: null }) });
    }
    req.continue();
  });

  const r9 = await p9.goto(ERP_BASE + '/admin/albaranes', { waitUntil: 'networkidle0' });
  ok(/script-src[^;]*'nonce-/.test(cabecera(r9)) && !/script-src[^;]*'unsafe-inline'/.test(cabecera(r9)),
     '/admin/albaranes — endurecida: nonce sí, unsafe-inline no');
  // LA REGLA ANCLADA, comprobada por su parte peligrosa.
  // ⚙️ 5 SEP 2026 — ESTA COMPROBACIÓN SE HA CADUCADO DOS VECES, y por el mismo motivo: se apoyaba en
  // una pantalla vecina que «aún no estaba migrada» (primero `/admin/quotes/9`, luego
  // `/admin/purchases`), y en cuanto le llegó su turno el anclaje dejó de probar nada. Ahora se
  // apoya en algo que NO puede cambiar de bando: `/admin/contabilidad/ventas.pdf` es un papel que
  // se descarga, no una pantalla, así que nunca se endurecerá — y su ruta empieza exactamente igual
  // que la regla `/^\/admin\/contabilidad\/ventas$/`. Si alguien le quitara el `$`, esto cae.
  const r9b = await p9.goto(ERP_BASE + '/admin/contabilidad/ventas', { waitUntil: 'networkidle0' });
  ok(/script-src[^;]*'nonce-/.test(cabecera(r9b)), '/admin/contabilidad/ventas — endurecida');
  const r9c = await fetch(ERP_BASE + '/admin/contabilidad/ventas.pdf', { headers: { cookie: 'asess=' + erpTok } });
  ok(/script-src[^;]*'unsafe-inline'/.test(r9c.headers.get('content-security-policy') || ''),
     '  y ventas.pdf NO: el ancla $ impide que la regla arrastre al papel', 'HTTP ' + r9c.status);

  await p9.goto(ERP_BASE + '/admin/albaranes', { waitUntil: 'networkidle0' });
  ok((await violaciones(p9)).length === 0, 'ninguna violación de CSP al cargar');
  ok(await p9.evaluate(() => !/\son[a-z]+\s*=\s*["']/i.test(
       document.documentElement.outerHTML.replace(/<script[\s\S]*?<\/script>/gi, ''))),
     'y no queda NI UN handler de atributo en la pantalla endurecida');

  // SE PULSA EL WIDGET: abrir, escribir, enviar y cerrar. Eran siete handlers de atributo.
  const abrioDisa = await p9.evaluate(async () => {
    const f = document.getElementById('disaFab'); if (!f) return 'sin botón de DISA';
    f.click(); await new Promise(r => setTimeout(r, 400));
    return document.getElementById('disaModal')?.classList.contains('open') ? 'ok' : 'no abrió';
  });
  ok(abrioDisa === 'ok', 'pulsar el botón de DISA ABRE la ventana', abrioDisa);
  const escribio = await p9.evaluate(async () => {
    const i = document.getElementById('dpInput'), b = document.getElementById('dpSendBtn');
    if (!i || !b) return 'faltan controles';
    i.value = 'ZZ pregunta de comprobacion CSP';
    b.click(); await new Promise(r => setTimeout(r, 900));
    return document.getElementById('dpMsgs')?.textContent.includes('ZZ respuesta de comprobacion')
      ? 'ok' : 'no apareció la respuesta';
  });
  ok(escribio === 'ok', 'escribirle y pulsar Enviar: sale la pregunta y entra la respuesta', escribio);
  ok(pidioDisa, '  y la petición SALIÓ de verdad (el botón no está muerto)');
  const cerroDisa = await p9.evaluate(async () => {
    document.getElementById('dpCloseBtn').click(); await new Promise(r => setTimeout(r, 300));
    return !document.getElementById('disaModal').classList.contains('open');
  });
  ok(cerroDisa, 'y el aspa CIERRA la ventana');
  ok((await violaciones(p9)).length === 0, 'todo el recorrido, sin una sola violación de CSP');
  await p9.setRequestInterception(false);

  // ── 10 · LAS ONCE PANTALLAS DEL 2º LOTE: su bloque de arranque CORRE con el nonce ──
  console.log('\n[10] El lote de las baratas: su bloque con nonce se ejecuta de verdad');
  // COMO SE PRUEBA QUE UN BLOQUE CORRIO CUANDO LA PANTALLA NO TIENE BOTONES.
  // ⚠️ LA SEÑAL QUE MANDA ES LA DE VIOLACIONES, y conviene decir por qué. Un bloque sin nonce en una
  // pantalla endurecida se BLOQUEA, y el navegador lo DECLARA: esa es la prueba, y es la que cazó el
  // rojo provocado de esta tanda. La comparación del DOM con el HTML crudo se queda como señal
  // secundaria, pero NO aísla el bloque de la pantalla: los del armazón corren igual y también
  // cambian el DOM, así que por sí sola daría verde con el bloque de la pantalla bloqueado.
  // Se comprueba además que la pantalla TRAE un bloque con nonce: sin eso, «cero violaciones» sería
  // cierto y vacío.
  // ⚠️ 5 SEP 2026 — SALEN `/admin/purchases/8` y las dos de `supplier-returns`. Estaban aquí porque
  // se endurecieron por FORMA, y esa forma se retiró el mismo día: sus plantillas tienen botones
  // CONDICIONALES que solo se pintan en cierto estado, así que otras fichas de la misma forma
  // quedaban endurecidas con un handler vivo y el botón muerto. Vuelven cuando la plantilla esté
  // migrada entera. Entra `/admin/descuentos`, que sí se cerró.
  const LOTE2 = ['/admin/analytics', '/admin/crm/tareas', '/admin/descuentos', '/admin/fichaje',
                 '/admin/migracion', '/admin/migracion/importar', '/admin/settings/avisos',
                 '/admin/suscripcion', '/admin/vigia'];
  const p10 = await nuevaPagina();
  const erroresJs = [];
  p10.on('pageerror', e => erroresJs.push(String(e.message).slice(0, 80)));
  await p10.setCookie({ name: 'asess', value: erpTok, domain: 'desarrollo-bamburu.localhost', path: '/' });
  let estrictas = 0, corrieron = 0, conViolaciones = [];
  for (const ruta of LOTE2) {
    const crudo = await (await fetch(ERP_BASE + ruta, { headers: { cookie: 'asess=' + erpTok } })).text();
    const r = await p10.goto(ERP_BASE + ruta, { waitUntil: 'networkidle0' });
    if (/script-src[^;]*'nonce-/.test(cabecera(r)) && !/script-src[^;]*'unsafe-inline'/.test(cabecera(r))) estrictas++;
    await new Promise(x => setTimeout(x, 500));
    const vivo = await p10.evaluate(() => document.body.innerHTML.length);
    const crudoBody = (crudo.match(/<body[\s\S]*<\/body>/i) || [''])[0].length;
    const traeNonce = /<script[^>]*\bnonce=/i.test(crudo);
    if (vivo !== crudoBody && traeNonce) corrieron++;
    const v = await p10.evaluate(() => { const x = window.__csp || []; window.__csp = []; return x; });
    if (v.length) conViolaciones.push(ruta + ' (' + v[0] + ')');
  }
  ok(estrictas === LOTE2.length, 'las nueve sirven la política estricta', estrictas + '/' + LOTE2.length);
  ok(corrieron === LOTE2.length, 'las nueve TRAEN su bloque con nonce y la pantalla se monta',
     corrieron + '/' + LOTE2.length);
  // ESTA es la que prueba que el bloque de cada pantalla corrió: si le faltara el nonce, la CSP lo
  // bloquearía y el navegador lo declararía aquí. Es la que cae en el rojo provocado.
  ok(conViolaciones.length === 0, 'y ninguna registra una violación: su bloque NO fue bloqueado',
     conViolaciones[0] || '');
  ok(erroresJs.length === 0, 'y ninguna suelta un error de JavaScript', erroresJs[0] || '');

  // Y UNA INTERACCION DE VERDAD en la que tiene controles: el importador.
  await p10.goto(ERP_BASE + '/admin/migracion/importar', { waitUntil: 'networkidle0' });
  const pulsable = await p10.evaluate(async () => {
    const b = document.querySelector('button, input[type=file], select'); if (!b) return 'sin controles';
    const antes = document.body.innerHTML.length;
    b.click(); await new Promise(r => setTimeout(r, 400));
    return document.body.innerHTML.length !== antes || document.activeElement !== document.body ? 'ok' : 'no reacciona';
  });
  ok(pulsable === 'ok', 'y en el importador, pulsar su control hace algo', pulsable);

  // ── 11 · LAS FICHAS DE DOCUMENTO: sus botones CONDICIONALES responden ──
  console.log('\n[11] Fichas de albarán y devolución: el botón condicional de Anular responde');
  // SE PULSA EL BOTON QUE ESTUVO MUERTO. El 5 sep, endurecer por forma dejó mudo justo este botón en
  // varias fichas, y no se notó porque nadie lo pulsaba. Pulsarlo NO destruye nada: `anular()` abre
  // antes una confirmación en la propia página, así que la prueba llega hasta el diálogo y lo cierra.
  const p11 = await nuevaPagina();
  await p11.setCookie({ name: 'asess', value: erpTok, domain: 'desarrollo-bamburu.localhost', path: '/' });
  const confirmado = await (async () => {
    for (const id of [1, 3, 4, 6]) {
      const r = await p11.goto(ERP_BASE + '/admin/albaranes/' + id, { waitUntil: 'networkidle0' });
      if (r.status() !== 200) continue;
      if (await p11.evaluate(() => !!document.querySelector('[data-act="anular"]'))) return id;
    }
    return null;
  })();
  ok(confirmado !== null, 'hay un albarán en estado que SÍ muestra el botón de Anular', 'id ' + confirmado);
  if (confirmado !== null) {
    const r11 = await p11.goto(ERP_BASE + '/admin/albaranes/' + confirmado, { waitUntil: 'networkidle0' });
    ok(/script-src[^;]*'nonce-/.test(cabecera(r11)) && !/script-src[^;]*'unsafe-inline'/.test(cabecera(r11)),
       '  y esa ficha va con la política estricta');
    const abrio = await p11.evaluate(async () => {
      document.querySelector('[data-act="anular"]').click();
      await new Promise(r => setTimeout(r, 500));
      const ov = document.querySelector('.modal-overlay.open');
      if (ov) ov.remove();                       // se cierra: no se anula nada
      return !!ov;
    });
    ok(abrio, '  PULSAR Anular abre su confirmación → el botón condicional está vivo');
    ok((await violaciones(p11)).length === 0, '  y sin una sola violación de CSP');
  }
  // Y una ficha de pedido, que es la forma con más pantallas (16).
  const r11b = await p11.goto(ERP_BASE + '/admin/pedidos/1', { waitUntil: 'networkidle0' });
  ok(/script-src[^;]*'nonce-/.test(cabecera(r11b)), 'la ficha de un pedido va con la política estricta');
  ok(await p11.evaluate(() => !/\son[a-z]+\s*=\s*["']/i.test(
       document.documentElement.outerHTML.replace(/<script[\s\S]*?<\/script>/gi, ''))),
     '  y no trae ni un handler de atributo');


  // ── 12 · PRESUPUESTO, ORDEN DE COMPRA Y COMPRA: condicional pulsado en cada forma ──
  console.log('\n[12] Las tres formas nuevas: un botón CONDICIONAL pulsado en cada una');
  // POR QUE UN CONDICIONAL Y NO UNO CUALQUIERA. Un boton fijo lo pinta cualquier documento y prueba
  // poco: el que se queda mudo al endurecer es el que solo aparece en cierto estado, porque nadie
  // navega hasta el estado que lo pinta. Los tres que se pulsan aqui abren ANTES una confirmacion
  // en la propia pagina, asi que la prueba llega al dialogo y lo cierra: no emite, no anula, no
  // cancela nada.
  const p12 = await nuevaPagina();
  await p12.setCookie({ name: 'asess', value: erpTok, domain: 'desarrollo-bamburu.localhost', path: '/' });
  const FORMAS = [
    { forma: 'presupuesto',      base: '/admin/quotes/',          ids: [31, 3, 1, 2],  act: 'emitir',   mote: 'Emitir' },
    { forma: 'presupuesto',      base: '/admin/quotes/',          ids: [3, 1, 2, 31],  act: 'anular',   mote: 'Anular' },
    { forma: 'orden de compra',  base: '/admin/purchase-orders/', ids: [5, 3, 1, 6],   act: 'enviar',   mote: 'Enviar' },
    { forma: 'compra directa',   base: '/admin/purchases/',       ids: [4, 1, 5, 8],   act: 'cancelar', mote: 'Cancelar' },
  ];
  for (const f of FORMAS) {
    const halla = await (async () => {
      for (const id of f.ids) {
        const r = await p12.goto(ERP_BASE + f.base + id, { waitUntil: 'networkidle0' });
        if (r.status() !== 200) continue;
        if (await p12.evaluate(a => !!document.querySelector('[data-act="' + a + '"]'), f.act)) return { id, r };
      }
      return null;
    })();
    ok(halla !== null, 'hay un/a ' + f.forma + ' en estado que SÍ pinta ' + f.mote, halla ? 'id ' + halla.id : 'ninguno');
    if (!halla) continue;
    ok(/script-src[^;]*'nonce-/.test(cabecera(halla.r)), '  y esa ficha va con la política estricta');
    const abrio = await p12.evaluate(async (a) => {
      document.querySelector('[data-act="' + a + '"]').click();
      await new Promise(r => setTimeout(r, 600));
      const ov = document.querySelector('.modal-overlay.open');
      if (ov) ov.remove();                       // se cierra: no se ejecuta la acción
      return !!ov;
    }, f.act);
    ok(abrio, '  PULSAR ' + f.mote + ' abre su confirmación → el condicional está vivo');
    ok((await violaciones(p12)).length === 0, '  y sin una sola violación de CSP');
  }

  // ── 12b · EL BUSCADOR DE LÍNEA: el que se pintaba DESDE JavaScript y quedó mudo ──
  console.log('\n[12b] El buscador de catálogo de las pantallas de alta responde al teclear');
  // ESTE ES EL GUARDIA DEL FALLO DE HOY. `views/line-search.js` pinta su campo DESDE JavaScript, asi
  // que sus handlers de atributo NO salen en el HTML servido y el censo daba las pantallas por
  // limpias. `/admin/pedidos/new` y `/admin/albaranes/new` se endurecieron el 5 sep con esa medida y
  // su buscador llevaba mudo desde entonces, sin error a la vista. Aqui se TECLEA y se exige que
  // aparezcan sugerencias: cargar la pagina no habria dicho nada.
  const ALTAS = ['/admin/quotes/new', '/admin/purchase-orders/new', '/admin/pedidos/new'];
  for (const ruta of ALTAS) {
    const r = await p12.goto(ERP_BASE + ruta, { waitUntil: 'networkidle0' });
    ok(/script-src[^;]*'nonce-/.test(cabecera(r)), ruta + ' va con la política estricta');
    const vivo = await p12.evaluate(async () => {
      const inp = document.querySelector('.line-desc'); if (!inp) return 'sin buscador';
      inp.focus(); inp.value = 'a'; inp.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 400));
      const box = inp.parentElement.querySelector('.line-suggest');
      return (box && box.style.display !== 'none' && box.innerHTML) ? 'ok' : 'MUDO';
    });
    ok(vivo === 'ok', '  y teclear en el buscador de línea SACA sugerencias', vivo);
    ok(await p12.evaluate(() => !/\son[a-z]+\s*=\s*"/i.test(
         document.documentElement.outerHTML.replace(/<script[\s\S]*?<\/script>/gi, '')
           .replace(/&lt;[^&]*&gt;/g, ''))),           // lo escapado es texto, no un handler
       '  y el DOM ya montado no trae ni un handler de atributo');
  }
  // La compra directa tiene buscador PROPIO (no comparte el de linea): se prueba el suyo.
  await p12.goto(ERP_BASE + '/admin/purchases/new', { waitUntil: 'networkidle0' });
  const vivoCompra = await p12.evaluate(async () => {
    document.querySelector('[data-act="add-line"]').click();
    await new Promise(r => setTimeout(r, 200));
    const inp = document.querySelector('[data-rol="buscar"]'); if (!inp) return 'sin buscador';
    inp.focus(); inp.value = 'a'; inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    const box = inp.parentElement.querySelector('div[id^="suggest-"]');
    return (box && box.style.display !== 'none' && box.innerHTML) ? 'ok' : 'MUDO';
  });
  ok(vivoCompra === 'ok', 'en la compra directa, Añadir línea pinta la fila y su buscador responde', vivoCompra);
  ok((await violaciones(p12)).length === 0, '  y todo el recorrido, sin una violación de CSP');


  // ── 13 · LA COLA POR TAMAÑO: cada pantalla, pulsada donde duele ──
  console.log('\n[13] Pantallas de la cola: se pulsan sus controles, no se cargan');
  const p13 = await nuevaPagina();
  await p13.setCookie({ name: 'asess', value: erpTok, domain: 'desarrollo-bamburu.localhost', path: '/' });

  // /admin/citas/servicios — la tabla se pinta DESPUES de pedir la lista, asi que Configurar va por
  // delegacion; el modal y su enlace plegado estaban en el HTML y van con oyente directo. Se pulsan
  // los dos caminos, que son los dos que se rompen de forma distinta.
  const r13 = await p13.goto(ERP_BASE + '/admin/citas/servicios', { waitUntil: 'networkidle0' });
  ok(/script-src[^;]*'nonce-/.test(cabecera(r13)), '/admin/citas/servicios — endurecida');
  await new Promise(x => setTimeout(x, 800));           // la tabla llega por API
  const svc = await p13.evaluate(async () => {
    const res = {};
    const cfg = document.querySelector('[data-act="svc-edit"]');
    res.hayFila = !!cfg;
    if (cfg) {
      cfg.click(); await new Promise(r => setTimeout(r, 400));
      const m = document.getElementById('mSvc');
      res.abreConfigurar = !!(m && m.classList.contains('open'));
      res.tituloRelleno = (document.getElementById('mSvcTitle')?.textContent || '').trim().length > 0;
      const a = document.getElementById('svcEsperaAdd');
      if (a) { a.click(); await new Promise(r => setTimeout(r, 200));
               res.despliegaEspera = document.getElementById('svcEsperaWrap')?.style.display !== 'none'; }
      document.querySelector('[data-act="svc-cerrar"]')?.click();
      await new Promise(r => setTimeout(r, 300));
      res.cierra = !document.getElementById('mSvc')?.classList.contains('open');
    }
    document.querySelector('[data-act="ns-abrir"]')?.click();
    await new Promise(r => setTimeout(r, 400));
    res.abreNuevo = !!document.getElementById('mNuevoSvc')?.classList.contains('open');
    document.querySelector('[data-act="ns-cerrar"]')?.click();
    return res;
  });
  ok(svc.hayFila, '  hay al menos un servicio en la tabla que pintó el JavaScript');
  ok(svc.abreConfigurar, '  PULSAR Configurar (fila pintada después) abre su ventana');
  ok(svc.tituloRelleno, '  y la ventana viene RELLENA: el id llegó como número, no como texto');
  ok(svc.despliegaEspera, '  el enlace plegado del tiempo de espera despliega su campo');
  ok(svc.cierra, '  y el botón de cerrar la cierra');
  ok(svc.abreNuevo, '  PULSAR «Nuevo servicio» abre su ventana');
  ok((await violaciones(p13)).length === 0, '  todo el recorrido, sin una violación de CSP');


  // /admin/mostrador — el TPV. Se pulsa un producto de la rejilla (que se pinta después), se cambia
  // la cantidad, se quita la línea y se abre la ventana de cobro. NO se confirma la venta: eso
  // emitiría un ticket de verdad. El carrito vive en el navegador, así que nada de esto deja rastro.
  const r13b = await p13.goto(ERP_BASE + '/admin/mostrador', { waitUntil: 'networkidle0' });
  ok(/script-src[^;]*'nonce-/.test(cabecera(r13b)), '/admin/mostrador — endurecida');
  await new Promise(x => setTimeout(x, 600));
  const tpv = await p13.evaluate(async () => {
    const res = {};
    const tile = document.querySelector('[data-act="add-prod"]');
    res.hayRejilla = !!tile;
    if (!tile) return res;
    // ⚠️ TODO va con `?.`. El rojo provocado del 4 sep hizo que el producto NO entrara en el
    // ticket, y el paso siguiente reventó el gate entero: salió una traza y NI UN veredicto. Un
    // gate que muere no dice «ha fallado», dice «no he podido probarlo», y eso se lee como verde.
    tile.click(); await new Promise(r => setTimeout(r, 300));
    res.entraAlTicket = document.querySelectorAll('[data-act="quitar-linea"]').length === 1;
    res.cobrarSeActiva = document.getElementById('btn-cobrar')?.disabled === false;
    const n = document.querySelector('[data-act="set-qty"]');
    if (n) { n.value = '3'; n.dispatchEvent(new Event('change', { bubbles: true }));
             await new Promise(r => setTimeout(r, 250));
             res.cambiaCantidad = document.querySelector('[data-act="set-qty"]')?.value === '3'; }
    document.getElementById('btn-cobrar')?.click(); await new Promise(r => setTimeout(r, 400));
    res.abreCobro = !!document.getElementById('cobroModal')?.classList.contains('open');
    document.querySelector('[data-act="cobro-cerrar"]')?.click(); await new Promise(r => setTimeout(r, 300));
    res.cierraCobro = !document.getElementById('cobroModal')?.classList.contains('open');
    document.querySelector('[data-act="quitar-linea"]')?.click(); await new Promise(r => setTimeout(r, 250));
    res.quitaLinea = document.querySelectorAll('[data-act="quitar-linea"]').length === 0;
    return res;
  });
  ok(tpv.hayRejilla, '  la rejilla de productos se pintó');
  ok(tpv.entraAlTicket, '  PULSAR un producto lo mete en el ticket (el id llegó como número)');
  ok(tpv.cobrarSeActiva, '  y el botón de Cobrar se activa');
  ok(tpv.cambiaCantidad, '  cambiar la cantidad de la línea responde');
  ok(tpv.abreCobro, '  PULSAR Cobrar abre la ventana de cobro');
  ok(tpv.cierraCobro, '  y Cancelar la cierra');
  ok(tpv.quitaLinea, '  quitar la línea la quita: el ticket queda vacío otra vez');
  ok((await violaciones(p13)).length === 0, '  y el mostrador entero, sin una violación de CSP');


  // /admin/avisos — la pantalla arrastra TRES ventanas compartidas (cobro, pago, stock) que viven
  // en `views/` y las usan otras diez pantallas. Se abren y se cierran desde aquí; NO se pulsa nada
  // que registre un cobro, un pago o un ajuste: eso movería dinero y existencias de verdad.
  const r13c = await p13.goto(ERP_BASE + '/admin/avisos', { waitUntil: 'networkidle0' });
  ok(/script-src[^;]*'nonce-/.test(cabecera(r13c)), '/admin/avisos — endurecida');
  await new Promise(x => setTimeout(x, 1000));
  const avi = await p13.evaluate(async () => {
    const res = { abiertas: [], sinBoton: [] };
    const pares = [['cm-abrir-cobros', 'cobroModal'], ['av-gestion', 'gestionModal'],
                   ['av-pagos', 'pagoModal'], ['av-pago-cuenta', 'pagoCuentaModal']];
    for (const [act, modal] of pares) {
      const b = document.querySelector('[data-act="' + act + '"]');
      if (!b) { res.sinBoton.push(act); continue; }
      b.click(); await new Promise(r => setTimeout(r, 900));
      const m = document.getElementById(modal);
      if (m?.classList.contains('open')) {
        res.abiertas.push(modal);
        m.querySelector('.modal-close')?.click();
        await new Promise(r => setTimeout(r, 300));
        if (m.classList.contains('open')) res.noCierra = modal;
      } else {
        // ⚠️ 4 SEP 2026 — ESTA LISTA ES LA QUE HACE QUE EL ROJO CAIGA. Antes solo se contaba
        // cuántas ventanas abrían («al menos dos»), y el rojo provocado —quitarle al despachador
        // compartido la clave de cobros— siguió VERDE porque las otras tres seguían abriendo. Un
        // botón que está en la pantalla y no responde es un fallo, aunque sus vecinos funcionen.
        res.mudos = (res.mudos || []).concat(act);
      }
    }
    res.filas = document.querySelectorAll('#avisosBody tr, .aviso-row').length;
    return res;
  });
  ok(avi.abiertas.length >= 2, '  PULSAR sus botones abre las ventanas compartidas',
     avi.abiertas.join(', ') + (avi.sinBoton.length ? ' · sin aviso de ese tipo hoy: ' + avi.sinBoton.join(', ') : ''));
  ok(!avi.mudos, '  y NINGUNO de los que están en la pantalla se queda mudo', (avi.mudos || []).join(', '));
  ok(!avi.noCierra, '  y el aspa de cada una la cierra', avi.noCierra || '');
  ok((await violaciones(p13)).length === 0, '  y sin una sola violación de CSP');

  // Y EL GUARDIA DE LAS OTRAS DIEZ. Las ventanas de `views/` las comparten pantallas que siguen en
  // legado (inventario, productos, cobros, pagos, facturas…). Migrarlas allí no rompe nada solo si
  // lo de DENTRO sigue respondiendo: se abre el kardex en una pantalla NO endurecida y se pulsa el
  // botón migrado que vive dentro de él.
  const rInv = await p13.goto(ERP_BASE + '/admin/inventory', { waitUntil: 'networkidle0' });
  ok(/script-src[^;]*'unsafe-inline'/.test(cabecera(rInv)), '/admin/inventory sigue en legado (no es de esta cola)');
  await new Promise(x => setTimeout(x, 900));
  const kx = await p13.evaluate(async () => {
    const res = {};
    if (typeof openStockKardex !== 'function') return { sinKardex: true };
    openStockKardex(1, 'ZZ'); await new Promise(r => setTimeout(r, 1400));
    res.kardexAbre = !!document.getElementById('stockKardexModal')?.classList.contains('open');
    const aj = document.querySelector('[data-act="sm-ajustar"]');
    res.hayAjustar = !!aj;
    if (aj) {
      aj.click(); await new Promise(r => setTimeout(r, 800));
      res.ajusteAbre = !!document.getElementById('stockAdjModal')?.classList.contains('open');
      document.querySelector('[data-act="sm-cerrar-ajuste"]')?.click();
    }
    document.querySelector('[data-act="sm-cerrar-kardex"]')?.click();
    return res;
  });
  ok(kx.kardexAbre, '  la ventana de stock abre en una pantalla en legado');
  ok(kx.hayAjustar, '  y trae dentro el botón migrado de Ajustar stock');
  ok(kx.ajusteAbre, '  PULSARLO abre el ajuste: la delegación compartida funciona en legado también');


  // /admin/crm — el tablero. Aquí vivía el tercer sitio donde el ARMAZÓN pintaba código en un
  // atributo: el menú «···» de la tarjeta y el botón del estado vacío. Los dos tienen ahora una
  // forma sin atributo (data-rm + el evento rowmenu:act), y esto la prueba pulsándola.
  const r13d = await p13.goto(ERP_BASE + '/admin/crm', { waitUntil: 'networkidle0' });
  ok(/script-src[^;]*'nonce-/.test(cabecera(r13d)), '/admin/crm — endurecida');
  await new Promise(x => setTimeout(x, 1200));
  const crm = await p13.evaluate(async () => {
    const res = {};
    res.hayTarjetas = document.querySelectorAll('.kb-card').length;
    const trig = document.querySelector('.kb-card [data-act="rowmenu"]');
    res.hayMenu = !!trig;
    if (trig) {
      trig.click(); await new Promise(r => setTimeout(r, 300));
      const items = document.querySelectorAll('.kb-card .rmenu-item');
      res.items = items.length;
      res.conAtributo = [...items].filter(i => i.getAttribute('onclick')).length;
      const editar = [...items].find(i => i.getAttribute('data-rm') === 'editar');
      if (editar) { editar.click(); await new Promise(r => setTimeout(r, 700));
                    res.abreEditar = !!document.getElementById('oppModal')?.classList.contains('open');
                    document.querySelector('[data-crm="opp-cerrar"]')?.click();
                    await new Promise(r => setTimeout(r, 300)); }
    }
    const card = document.querySelector('[data-crm-card]');
    if (card) {
      card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await new Promise(r => setTimeout(r, 700));
      res.dobleClic = !!document.getElementById('actModal')?.classList.contains('open');
      document.querySelector('[data-crm="act-cerrar"]')?.click();
      await new Promise(r => setTimeout(r, 300));
      // El arrastre: se dispara dragstart y se mira que la tarjeta se marque como arrastrándose.
      const dt = new DataTransfer();
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      await new Promise(r => setTimeout(r, 200));
      res.arrastra = card.classList.contains('dragging');
      card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      await new Promise(r => setTimeout(r, 200));
      res.sueltaBien = !card.classList.contains('dragging');
    }
    return res;
  });
  ok(crm.hayTarjetas > 0, '  el tablero pintó sus tarjetas', String(crm.hayTarjetas));
  ok(crm.hayMenu, '  y la tarjeta trae su menú «···»');
  ok(crm.conAtributo === 0, '  cuyos items NO llevan código en un atributo', 'con atributo: ' + crm.conAtributo);
  ok(crm.abreEditar, '  PULSAR «Editar» en el menú abre la ventana de la oportunidad');
  ok(crm.dobleClic, '  DOBLE CLIC en la tarjeta abre el seguimiento');
  ok(crm.arrastra, '  ARRASTRAR la tarjeta la marca: el drag&drop del tablero sigue vivo');
  ok(crm.sueltaBien, '  y soltarla la desmarca');
  ok((await violaciones(p13)).length === 0, '  y el tablero entero, sin una violación de CSP');

  const r13e = await p13.goto(ERP_BASE + '/admin/crm/cola', { waitUntil: 'networkidle0' });
  ok(/script-src[^;]*'nonce-/.test(cabecera(r13e)), '/admin/crm/cola — endurecida');
  await new Promise(x => setTimeout(x, 1200));
  const cola = await p13.evaluate(async () => {
    const res = {};
    const b = document.querySelector('[data-crm="seguimiento"]');
    res.hayBoton = !!b;
    if (b) { b.click(); await new Promise(r => setTimeout(r, 700));
             res.abreSeguimiento = !!document.getElementById('actModal')?.classList.contains('open');
             document.querySelector('[data-crm="act-cerrar"]')?.click(); }
    const s = document.getElementById('searchBox');
    if (s) { const antes = document.querySelectorAll('.frow:not([style*="none"])').length;
             s.value = 'zzzz-no-existe'; s.dispatchEvent(new Event('input', { bubbles: true }));
             await new Promise(r => setTimeout(r, 300));
             res.filtra = document.querySelectorAll('.frow:not([style*="none"])').length < antes;
             s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); }
    return res;
  });
  ok(cola.hayBoton, '  la cola pintó sus filas con el botón de Seguimiento');
  ok(cola.abreSeguimiento, '  PULSARLO abre la ventana de seguimiento');
  ok(cola.filtra, '  y escribir en el buscador filtra las filas');
  ok((await violaciones(p13)).length === 0, '  y la cola, sin una violación de CSP');


  // /admin/citas — la agenda, la pantalla más cargada de la cola (35 handlers servidos, ~330 en el
  // DOM porque la rejilla son cientos de celdas). Se prueban los tres caminos que se rompen de
  // forma distinta: un control fijo de la cabecera, una CELDA de la rejilla (repintada en cada
  // carga) y una ventana. No se guarda ninguna cita: se abre el hueco y se cierra.
  const r13f = await p13.goto(ERP_BASE + '/admin/citas', { waitUntil: 'networkidle0' });
  ok(/script-src[^;]*'nonce-/.test(cabecera(r13f)), '/admin/citas — endurecida');
  await new Promise(x => setTimeout(x, 1500));
  const ag = await p13.evaluate(async () => {
    const res = {};
    res.celdas = document.querySelectorAll('.agcell').length;
    // 1 · un control fijo: el zoom cambia la altura de la rejilla
    const antes = document.querySelector('.agcell')?.getBoundingClientRect().height || 0;
    document.querySelector('[data-ag="zoom"][data-z="96"]')?.click();
    await new Promise(r => setTimeout(r, 500));
    res.zoom = (document.querySelector('.agcell')?.getBoundingClientRect().height || 0) !== antes;
    // 2 · la vista: pasar a mes repinta la agenda
    document.querySelector('[data-ag="vista"][data-v="mes"]')?.click();
    await new Promise(r => setTimeout(r, 900));
    res.vistaMes = !!document.querySelector('.agmes, .ag-mes, [class*="mes"]');
    document.querySelector('[data-ag="vista"][data-v="dia"]')?.click();
    await new Promise(r => setTimeout(r, 900));
    // 3 · UNA CELDA de la rejilla, que es lo que se repinta: abre la ventana de cita nueva
    const libre = document.querySelector('.agcell.libre');
    res.hayCeldaLibre = !!libre;
    if (libre) {
      libre.click(); await new Promise(r => setTimeout(r, 700));
      res.abreCita = !!document.getElementById('mCita')?.classList.contains('open');
      document.querySelector('[data-ag="cerrar-cita"]')?.click();
      await new Promise(r => setTimeout(r, 300));
      res.cierraCita = !document.getElementById('mCita')?.classList.contains('open');
    }
    // 4 · la ventana de la leyenda, que es markup fijo
    document.querySelector('[data-ag="leyenda"]')?.click();
    await new Promise(r => setTimeout(r, 400));
    res.abreLeyenda = !!document.getElementById('mLeyenda')?.classList.contains('open');
    document.querySelector('[data-ag="cerrar-leyenda"]')?.click();
    return res;
  });
  ok(ag.celdas > 50, '  la rejilla pintó sus celdas', String(ag.celdas));
  ok(ag.zoom, '  PULSAR el zoom cambia la altura de la rejilla');
  ok(ag.vistaMes, '  y cambiar a vista de mes la repinta');
  ok(ag.hayCeldaLibre, '  hay una celda libre en la rejilla');
  ok(ag.abreCita, '  PULSAR una celda (repintada en cada carga) abre la ventana de cita nueva');
  ok(ag.cierraCita, '  y se cierra');
  ok(ag.abreLeyenda, '  la ventana de la leyenda, que es markup fijo, también abre');
  ok((await violaciones(p13)).length === 0, '  y la agenda entera, sin una violación de CSP');


  // ── 14 · EL COMPONENTE COMPARTIDO DE LISTADOS, y el botón del estado vacío ──
  console.log('\n[14] Los tres verbos de listado, y el botón que solo sale cuando no hay nada');
  // POR QUE IMPORTA: `routes/listados.js` pinta estos botones en OCHO pantallas. Si su despachador
  // se rompe, se caen las ocho a la vez y ninguna lo dice. Se pulsa «Enviar por correo», que abre
  // una ventana ANTES de mandar nada: la prueba llega al diálogo y lo cancela.
  const p14 = await nuevaPagina();
  await p14.setCookie({ name: 'asess', value: erpTok, domain: 'desarrollo-bamburu.localhost', path: '/' });
  for (const ruta of ['/admin/purchases', '/admin/contabilidad/ventas']) {
    const r = await p14.goto(ERP_BASE + ruta, { waitUntil: 'networkidle0' });
    ok(/script-src[^;]*'nonce-/.test(cabecera(r)), ruta + ' — endurecida');
    await new Promise(x => setTimeout(x, 500));
    const res = await p14.evaluate(async () => {
      const b = document.querySelector('[data-lst="enviar"]');
      if (!b) return 'sin botón de enviar';
      b.click(); await new Promise(r => setTimeout(r, 700));
      const ov = document.querySelector('.modal-overlay.open');
      if (ov) ov.remove();                       // se cancela: no se manda ningún correo
      return ov ? 'ok' : 'MUDO';
    });
    ok(res === 'ok', '  PULSAR «Enviar por correo» abre su ventana', res);
  }
  // El botón del estado vacío: `emptyState` con la clave `act`, que es la forma nueva del armazón.
  const r14 = await p14.goto(ERP_BASE + '/admin/contabilidad/bienes', { waitUntil: 'networkidle0' });
  ok(/script-src[^;]*'nonce-/.test(cabecera(r14)), '/admin/contabilidad/bienes — endurecida');
  await new Promise(x => setTimeout(x, 500));
  const bienes = await p14.evaluate(async () => {
    const b = document.querySelector('[data-rm="abrir-alta-bien"]');
    if (!b) return 'sin botón (¿ya hay bienes registrados?)';
    b.click(); await new Promise(r => setTimeout(r, 400));
    return document.getElementById('altaBien')?.open ? 'ok' : 'MUDO';
  });
  ok(bienes === 'ok', '  PULSAR el botón del estado vacío despliega el alta de bien', bienes);
  ok((await violaciones(p14)).length === 0, '  y las tres pantallas, sin una violación de CSP');


  // ── 15 · LA TANDA DE LAS PEQUEÑAS: un control de cada una, pulsado ──
  console.log('\n[15] Las pantallas pequeñas: se pulsa el control que tienen');
  const p15 = await nuevaPagina();
  await p15.setCookie({ name: 'asess', value: erpTok, domain: 'desarrollo-bamburu.localhost', path: '/' });
  await p15.evaluateOnNewDocument(m => { window.__marcaCSP = m; }, MARCA);
  // Cada entrada: [ruta, qué se pulsa o cambia, qué tiene que pasar]. Ninguna guarda nada: son
  // filtros que repintan, un botón que despliega un formulario y un aspa que cierra una ventana.
  const PEQUENAS = [
    ['/admin/facturar-horas', async () => {
      const sel = document.getElementById('fhProyecto'); if (!sel) return 'sin filtro';
      const antes = document.body.innerHTML.length;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 700));
      return document.body.innerHTML.length !== antes || document.querySelector('#fhBody, #fhTabla') ? 'ok' : 'no reacciona';
    }],
    ['/admin/activity', async () => {
      const q = document.getElementById('actQ'); if (!q) return 'sin buscador';
      q.value = 'zzzz'; q.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 900));
      return document.getElementById('actBody')?.innerHTML.length >= 0 ? 'ok' : 'no reacciona';
    }],
    ['/admin/perfil', async () => {
      const b = document.getElementById('pfCambiarFoto'); if (!b) return 'sin botón de foto';
      let abrio = false;
      const inp = document.getElementById('pfFoto');
      if (inp) inp.addEventListener('click', e => { abrio = true; e.preventDefault(); }, { once: true });
      b.click(); await new Promise(r => setTimeout(r, 300));
      return abrio ? 'ok' : 'no abre el selector de fichero';
    }],
    // ⚠️ ESTE CREA UNA ETIQUETA DE VERDAD, y es a propósito: comprobar que `addTag` EXISTE no
    // prueba que el botón esté enganchado — es justo la trampa de «la aserción promete más de lo
    // que mide». Se crea con la MARCA y se borra en el `finally`, por la marca.
    ['/admin/tags', async () => {
      const b = document.querySelector('[data-tag="crear"]'); if (!b) return 'sin botón de crear';
      const inp = document.getElementById('tagName'); if (!inp) return 'sin campo';
      inp.value = window.__marcaCSP;
      b.click(); await new Promise(r => setTimeout(r, 1200));
      if (inp.value !== '') return 'el botón no hizo nada';
      return document.getElementById('tagBody')?.textContent.includes(window.__marcaCSP) ? 'ok' : 'creada pero no aparece';
    }],
    // ⚠️ Si algún día el negocio de desarrollo tiene plantillas, el estado vacío deja de pintarse y
    // esto se pone ROJO diciéndolo, en vez de pasar en silencio sin haber probado nada.
    ['/admin/recurrentes', async () => {
      const b = document.querySelector('[data-rm="abrir-nueva-plantilla"]');
      if (!b) return 'no hay estado vacío que pulsar (¿ya hay plantillas?)';
      b.click(); await new Promise(r => setTimeout(r, 300));
      return document.getElementById('nuevaPlantilla')?.open ? 'ok' : 'MUDO';
    }],
    ['/admin/stock-transfers/new', async () => {
      const b = document.querySelector('[data-act="add-row"]'); if (!b) return 'sin botón';
      const antes = document.querySelectorAll('[data-act="quitar-fila"]').length;
      b.click(); await new Promise(r => setTimeout(r, 400));
      const despues = document.querySelectorAll('[data-act="quitar-fila"]').length;
      if (despues <= antes) return 'no añade línea';
      document.querySelector('[data-act="quitar-fila"]').click();
      await new Promise(r => setTimeout(r, 200));
      return document.querySelectorAll('[data-act="quitar-fila"]').length < despues ? 'ok' : 'el aspa no quita';
    }],
  ];
  for (const [ruta, prueba] of PEQUENAS) {
    const r = await p15.goto(ERP_BASE + ruta, { waitUntil: 'networkidle0' });
    ok(/script-src[^;]*'nonce-/.test(cabecera(r)), ruta + ' — endurecida');
    await new Promise(x => setTimeout(x, 600));
    const res = await p15.evaluate(prueba);
    ok(res === 'ok', '  y su control responde al pulsarlo', res);
  }
  // Y las fichas, que entran POR FORMA: se comprueba que la plantilla no pinta ni un handler en
  // NINGUNO de los documentos que hay, no solo en el primero.
  for (const ruta of ['/admin/clients/1', '/admin/purchase-order-receipts/1', '/admin/stock-transfers/1',
                      '/admin/stock-transfers/2', '/admin/stock-transfers/3']) {
    const r = await p15.goto(ERP_BASE + ruta, { waitUntil: 'networkidle0' });
    ok(/script-src[^;]*'nonce-/.test(cabecera(r)), ruta + ' — endurecida');
    ok(await p15.evaluate(() => ![...document.querySelectorAll('*')].some(el =>
         [...el.attributes].some(a => /^on[a-z]+$/i.test(a.name)))),
       '  y su DOM montado no trae ni un handler de atributo');
  }
  ok((await violaciones(p15)).length === 0, 'la tanda de las pequeñas, sin una violación de CSP');

  const todas = [...(await violaciones(p3)), ...(await violaciones(p4)),
                 ...(await violaciones(p11)), ...(await violaciones(p12)), ...(await violaciones(p13)), ...(await violaciones(p14)), ...(await violaciones(p15)),
                 ...(await violaciones(p9)),
                 ...(await violaciones(p8)),
                 ...(await violaciones(p5)), ...(await violaciones(p6)), ...(await violaciones(p7))];
  ok(todas.length === 0, 'CERO violaciones de CSP en toda la pasada' + (todas.length ? ': ' + todas[0] : ''));
} finally {
  await browser.close();
  cdb.prepare('DELETE FROM superadmin_sessions WHERE token=?').run(saToken);
  cdb.close();
  // Lo que la prueba crea, la prueba lo borra — y por la MARCA, no por los ids de esta pasada.
  try {
    pdb.prepare('DELETE FROM portal_mensajes WHERE texto LIKE ?').run('ZZ mensaje de comprobacion CSP %');
    pdb.prepare('DELETE FROM portal_sesiones WHERE client_id IN (SELECT id FROM clients WHERE name LIKE ?)').run('ZZ CSP %');
    pdb.prepare('DELETE FROM portal_tokens   WHERE client_id IN (SELECT id FROM clients WHERE name LIKE ?)').run('ZZ CSP %');
    pdb.prepare('DELETE FROM product_tags WHERE tag_id IN (SELECT id FROM tags WHERE name LIKE ?)').run('ZZ CSP %');
    pdb.prepare('DELETE FROM tags WHERE name LIKE ?').run('ZZ CSP %');
    pdb.prepare('DELETE FROM opportunities WHERE title LIKE ?').run('ZZ CSP %');
    pdb.prepare('DELETE FROM clients WHERE name LIKE ?').run('ZZ CSP %');
    pdb.prepare("DELETE FROM admin_sessions WHERE token LIKE 'gate-csp-erp-%'").run();
  } catch (e) { console.error('  ⚠️  limpieza incompleta: ' + (e?.message || e)); }
  pdb.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' CSP estricta (C4b-1): ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
