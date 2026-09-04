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
  // LA REGLA ANCLADA, comprobada por su parte peligrosa: la ficha de un presupuesto NO entra.
  const r9b = await p9.goto(ERP_BASE + '/admin/quotes', { waitUntil: 'networkidle0' });
  ok(/script-src[^;]*'nonce-/.test(cabecera(r9b)), '/admin/quotes (la lista) — endurecida');
  const r9c = await p9.goto(ERP_BASE + '/admin/quotes/9', { waitUntil: 'networkidle0' });
  ok(/script-src[^;]*'unsafe-inline'/.test(cabecera(r9c)),
     '  y /admin/quotes/9 (la ficha) NO: el ancla $ impide que la regla la arrastre');

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
  console.log('\n[10] Once pantallas más: el bloque con nonce se ejecuta de verdad');
  // COMO SE PRUEBA QUE UN BLOQUE CORRIO CUANDO LA PANTALLA NO TIENE BOTONES.
  // ⚠️ LA SEÑAL QUE MANDA ES LA DE VIOLACIONES, y conviene decir por qué. Un bloque sin nonce en una
  // pantalla endurecida se BLOQUEA, y el navegador lo DECLARA: esa es la prueba, y es la que cazó el
  // rojo provocado de esta tanda. La comparación del DOM con el HTML crudo se queda como señal
  // secundaria, pero NO aísla el bloque de la pantalla: los del armazón corren igual y también
  // cambian el DOM, así que por sí sola daría verde con el bloque de la pantalla bloqueado.
  // Se comprueba además que la pantalla TRAE un bloque con nonce: sin eso, «cero violaciones» sería
  // cierto y vacío.
  const LOTE2 = ['/admin/analytics', '/admin/crm/tareas', '/admin/fichaje', '/admin/migracion',
                 '/admin/migracion/importar', '/admin/purchases/8', '/admin/settings/avisos',
                 '/admin/supplier-returns/1', '/admin/supplier-returns/2', '/admin/suscripcion',
                 '/admin/vigia'];
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
  ok(estrictas === LOTE2.length, 'las once sirven la política estricta', estrictas + '/' + LOTE2.length);
  ok(corrieron === LOTE2.length, 'las once TRAEN su bloque con nonce y la pantalla se monta',
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

  const todas = [...(await violaciones(p3)), ...(await violaciones(p4)),
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
    pdb.prepare('DELETE FROM clients WHERE name LIKE ?').run('ZZ CSP %');
    pdb.prepare("DELETE FROM admin_sessions WHERE token LIKE 'gate-csp-erp-%'").run();
  } catch (e) { console.error('  ⚠️  limpieza incompleta: ' + (e?.message || e)); }
  pdb.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' CSP estricta (C4b-1): ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
