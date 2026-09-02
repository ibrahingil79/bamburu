#!/usr/bin/env node
//
// gate-suscripcion-alta-real.mjs — El alta de tarjeta, DE PUNTA A PUNTA y con navegador de verdad.
//
// POR QUÉ ESTE GATE EXISTE APARTE DEL OTRO. `test-suscripcion.mjs` mide lo que DECIDE el producto
// (precio, IVA, prorrateo, estados) sin tocar la red, y por eso va en el barrido. Este mide lo que
// solo se ve pulsando: que Stripe acepte la sesión, que el Checkout se rellene y que al volver la
// tarjeta quede guardada. Los tres fallos que destapó el 2 sep 2026 —Managed Payments, el
// readOnlyGuard y la llave de idempotencia— NO los habría visto ninguna aserción de las otras.
//
// ESTÁ DECLARADO FUERA DEL BARRIDO (`FUERA_A_PROPOSITO`, gates-mapa.mjs) y no es dejadez: necesita
// claves de Stripe vivas, un navegador y un negocio real. En cualquier servidor sin claves sería un
// rojo permanente, y un rojo permanente se acaba ignorando.
//
// Se lanza a mano:  node scripts/gate-suscripcion-alta-real.mjs
//
// LO QUE CREA, LO BORRA: la sesión temporal y la fila de suscripción se devuelven a su estado
// anterior en el `finally`, pase, falle o reviente.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { CHROMIUM, entornoDelNavegador } from './lib/gate-env.mjs';

const SLUG = 'peluqueria-gil';
const HOST = `https://${SLUG}.bamburu.com`;
let ok = 0, mal = 0;
const P = t => console.log(t);
const check = (n, c, d = '') => { if (c) { ok++; P(`  ✓ ${n}`); } else { mal++; P(`  ✗ ${n}${d ? '\n      ' + String(d).slice(0,300) : ''}`); } };

const cd = new Database('/home/ubuntu/bamburu/data/control.db');
const td = new Database(`/home/ubuntu/bamburu/data/tenants/${SLUG}.db`);
const tenant = cd.prepare('SELECT id FROM tenants WHERE slug=?').get(SLUG);
const antes = cd.prepare('SELECT * FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id);

const tok = 'zze2e' + randomBytes(24).toString('hex');
let navegador;
try {
  const ahora = new Date().toISOString().slice(0,19).replace('T',' ');
  const exp = new Date(Date.now()+900000).toISOString().slice(0,19).replace('T',' ');
  td.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tok, 2, ahora, exp, randomBytes(16).toString('hex'));
  cd.prepare('INSERT INTO tenant_sessions (tenant_id,session_token,user_id,user_email,user_role,expires_at) VALUES (?,?,?,?,?,?)')
    .run(tenant.id, tok, 2, 'ibrahingil+prueba@gmail.com', 'owner', exp);

  // Un negocio NUEVO no tiene cliente en Stripe. Se limpia para ejercitar ese camino —que es el que
  // ahora manda el correo del dueño— y se devuelve en el `finally`.
  cd.prepare('UPDATE tenant_suscripciones SET stripe_cliente_id=NULL WHERE tenant_id=?').run(tenant.id);

  navegador = await puppeteer.launch({
    executablePath: CHROMIUM, env: entornoDelNavegador(),
    args: ['--no-sandbox','--disable-dev-shm-usage'],
  });
  const pg = await navegador.newPage();
  await pg.setViewport({ width: 1280, height: 900 });

  // Las ventanitas del navegador, NEUTRALIZADAS: la regla del repo dice que el producto tiene que
  // seguir funcionando con ellas silenciadas, no disculparse.
  await pg.evaluateOnNewDocument(() => { window.prompt = () => null; window.confirm = () => false; window.alert = () => {}; });

  await pg.setCookie({ name:'asess', value:tok, domain:`${SLUG}.bamburu.com`, path:'/', httpOnly:true, secure:true });
  await pg.goto(`${HOST}/admin/suscripcion`, { waitUntil:'networkidle2', timeout:45000 });
  check('la pantalla abre y la URL final es la pedida', pg.url().includes('/admin/suscripcion'), pg.url());

  const antesTexto = await pg.evaluate(() => document.body.innerText);
  check('anuncia «9,90 €/mes + IVA»', antesTexto.includes('9,90 €/mes + IVA'));
  check('dice que no se le ha pedido tarjeta', /No hay ninguna tarjeta guardada/i.test(antesTexto));

  // ── Se PULSA el botón, no se llama a la API ──────────────────────────────────
  await pg.click('#susAlta');
  await new Promise(r => setTimeout(r, 900));
  const panel = await pg.evaluate(() => document.body.innerText);
  check('sale la ventanita EN PÁGINA (no un confirm del navegador)', /Vas a dejar una tarjeta/.test(panel), panel.slice(0,200));
  // 2 SEP 2026 — el panel salía con título y botones y EL CUERPO EN BLANCO (se pasaba `mensaje:` y
  // `confirmarEnPagina` reenvía `o.texto`; un nombre desconocido se descarta en silencio). Ninguna
  // aserción falló: el panel abría y el alta se completaba. Por eso ahora se exige el CUERPO.
  check('y la ventanita EXPLICA a dónde se le lleva (no sale vacía)',
    /página segura de Stripe/i.test(panel), panel.slice(0, 400));
  check('y dice cuánto se le cobrará y cuándo', /Se te cobrará/.test(panel) && /€/.test(panel));

  // El botón de aceptar del panel compartido.
  const aceptado = await pg.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /Continuar a Stripe/i.test(x.textContent));
    if (!b) return false; b.click(); return true;
  });
  check('el panel ofrece «Continuar a Stripe»', aceptado);

  await pg.waitForFunction(() => location.hostname.includes('stripe.com'), { timeout: 45000 });
  check('llegamos al Checkout de Stripe (mode: setup ACEPTADO)', pg.url().includes('stripe.com'), pg.url());

  // ── La tarjeta de prueba ─────────────────────────────────────────────────────
  await new Promise(r => setTimeout(r, 3500));
  const escribir = async (sel, txt) => {
    const el = await pg.waitForSelector(sel, { timeout: 20000 });
    await el.click({ clickCount: 3 }); await el.type(txt, { delay: 40 });
  };
  // Ojo con la aserción: si el cliente YA trae correo, Stripe ni siquiera pinta el campo. Leer
  // `?.value || ''` de un elemento ausente devuelve '' y se lee como «vacío», que es justo lo
  // contrario de lo que pasa. Vale cualquiera de las dos: campo ausente, o campo relleno.
  const correo = await pg.evaluate(() => {
    const e = document.querySelector('#email');
    return e ? { hay: true, valor: e.value } : { hay: false, valor: null };
  });
  check('Stripe NO le pide el correo al dueño (Bamburu ya se lo dio)',
    !correo.hay || String(correo.valor).includes('@'), JSON.stringify(correo));
  if (correo.hay && !String(correo.valor).includes('@')) await escribir('#email', 'ibrahingil+prueba@gmail.com');

  await escribir('#cardNumber', '4242424242424242');
  await escribir('#cardExpiry', '12' + String(new Date().getFullYear() + 2).slice(2));
  await escribir('#cardCvc', '123');
  try { await escribir('#billingName', 'Peluqueria Gil Prueba'); } catch {}

  await new Promise(r => setTimeout(r, 800));
  await pg.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /^guardar/i.test(x.textContent.trim()))
           || document.querySelector('button[type="submit"]');
    b?.click();
  });

  await pg.waitForFunction(() => location.hostname.includes('bamburu.com'), { timeout: 90000 });
  await new Promise(r => setTimeout(r, 1500));
  check('Stripe nos devuelve a Bamburu', pg.url().includes('bamburu.com'), pg.url());
  check('y aterriza en /admin/suscripcion', pg.url().includes('/admin/suscripcion'), pg.url());

  const despues = await pg.evaluate(() => document.body.innerText);
  P('\n  ── lo que ve el dueño al volver ──');
  despues.split('\n').filter(l => /tarjeta|cobr|prueba|visa|····/i.test(l)).slice(0,6).forEach(l => P('    ' + l.trim()));

  const fila = cd.prepare('SELECT * FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id);
  check('la tarjeta queda guardada', !!fila.stripe_metodo_pago_id, JSON.stringify(fila));
  check('se guardan los CUATRO últimos dígitos y nada más', fila.tarjeta_ultimos4 === '4242', fila.tarjeta_ultimos4);
  check('la marca es visa', fila.tarjeta_marca === 'visa', fila.tarjeta_marca);
  check('NO se guarda ningún número completo', !JSON.stringify(fila).includes('4242424242424242'));
  check('con la prueba VIVA no se ha cobrado nada', fila.estado === 'prueba' && !fila.ultimo_cobro_en,
    `estado=${fila.estado} ultimo_cobro=${fila.ultimo_cobro_en}`);
  check('y la pantalla lo dice', /no se te ha cobrado nada/i.test(despues), despues.slice(0,300));
  check('la pantalla enseña la tarjeta por sus 4 últimos', /4242/.test(despues));

  await pg.screenshot({ path: '/home/ubuntu/susc-e2e.png', fullPage: false });
  P('\n  captura: /home/ubuntu/susc-e2e.png');
} finally {
  if (navegador) await navegador.close().catch(()=>{});
  td.prepare("DELETE FROM admin_sessions WHERE token LIKE 'zze2e%'").run();
  cd.prepare("DELETE FROM tenant_sessions WHERE session_token LIKE 'zze2e%'").run();
  // La fila se devuelve a como estaba, para que Ibrahin pueda repetirlo desde cero en la pantalla.
  cd.prepare(`UPDATE tenant_suscripciones SET estado=?, stripe_cliente_id=?, stripe_metodo_pago_id=?,
              tarjeta_marca=?, tarjeta_ultimos4=?, tarjeta_caduca=?, ultimo_error=? WHERE tenant_id=?`)
    .run(antes.estado, antes.stripe_cliente_id, antes.stripe_metodo_pago_id, antes.tarjeta_marca,
         antes.tarjeta_ultimos4, antes.tarjeta_caduca, antes.ultimo_error, tenant.id);
  P(`\n  ${ok} OK · ${mal} fallos  ·  sesión borrada y suscripción devuelta a su estado anterior`);
}
process.exit(mal ? 1 : 0);
