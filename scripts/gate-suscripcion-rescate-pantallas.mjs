#!/usr/bin/env node
//
// gate-suscripcion-rescate-pantallas.mjs — El rescate, mirado con ojos de cliente.
//
// TRES COSAS:
//   1. Que la pantalla diga **qué compra**, con el importe y la fecha exacta del próximo cobro
//      DELANTE, antes de pagar. Nunca se cobra por sorpresa, tampoco aquí.
//   2. El caso esperable: **la tarjeta vieja ya no vale** —si le cortaron, lo normal es eso—. La
//      pantalla lo dice, ofrece cambiarla, y el rescate sale con la nueva.
//   3. La caza a propósito de frases que juntas se contradicen. Quinta tarea seguida con el mismo
//      patrón: en las cuatro anteriores apareció una.
//
// LO QUE CREA, LO BORRA: sesión, reloj, estado del negocio.

import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { CHROMIUM, entornoDelNavegador } from './lib/gate-env.mjs';
import * as stripe from '../core/stripe.js';
import { getTenantById, setTenantStatus } from '../core/control-db.js';
import { sumarDias, hoyISO, siguienteDiaDeCobro, fechaEnPalabras } from '../core/suscripcion.js';
import { DIAS_DE_DESCARGA } from '../core/suscripcion-datos.js';

const SLUG = 'helados-ibrahin';
const HOST = `https://${SLUG}.bamburu.com`;
let ok = 0, mal = 0;
const P = t => console.log(t);
const check = (n, c, d = '') => { if (c) { ok++; P(`  ✓ ${n}`); } else { mal++; P(`  ✗ ${n}${d ? '\n      ' + String(d).slice(0, 400) : ''}`); } };

const cd = new Database('/home/ubuntu/bamburu/data/control.db');
const tenant = cd.prepare('SELECT id FROM tenants WHERE slug=?').get(SLUG);
const antes = cd.prepare('SELECT * FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id);
const estadoAntes = getTenantById(tenant.id).status;
const notaAntes = getTenantById(tenant.id).suspend_note ?? null;
const tok = 'zzres' + randomBytes(24).toString('hex');
let navegador, cliente = null;

try {
  // Un cliente con una tarjeta que SE GUARDA bien y FALLA al cobrar: el caso esperable de alguien
  // a quien cortaron.
  const cli = await stripe.stripeApi('POST', '/customers', { name: 'ZZ rescate pantallas', email: 'zz@ejemplo.test' });
  cliente = cli.datos.id;
  const mala = await stripe.stripeApi('POST', '/payment_methods', { type: 'card', card: { token: 'tok_chargeCustomerFail' } });
  await stripe.stripeApi('POST', `/payment_methods/${mala.datos.id}/attach`, { customer: cliente });
  await stripe.fijarMetodoPorDefecto(cliente, mala.datos.id);

  const corte = sumarDias(hoyISO(), -40);
  cd.prepare(`UPDATE tenant_suscripciones SET estado='pago_pendiente', cortado_en=?, cortado_por_impago=1,
    impago_desde=?, corte_previsto=?, descarga_hasta=?, en_boveda_desde=NULL, stripe_cliente_id=?,
    stripe_metodo_pago_id=?, tarjeta_marca='visa', tarjeta_ultimos4=?, stripe_suscripcion_id=NULL,
    rescate_en=NULL, rescate_eleccion=NULL WHERE tenant_id=?`)
    .run(corte, sumarDias(corte, -30), corte, sumarDias(corte, DIAS_DE_DESCARGA), cliente,
         mala.datos.id, mala.datos.card?.last4 || '0341', tenant.id);
  setTenantStatus(tenant.id, 'suspended_admin', 'Sin pago. Ve a «Mi suscripción» y pon una tarjeta: se reactiva sola.');

  const td = new Database(`/home/ubuntu/bamburu/data/tenants/${SLUG}.db`);
  const u = td.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
  const ahora = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const exp = new Date(Date.now() + 1800000).toISOString().slice(0, 19).replace('T', ' ');
  td.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tok, u.id, ahora, exp, randomBytes(16).toString('hex'));
  cd.prepare('INSERT INTO tenant_sessions (tenant_id,session_token,user_id,user_email,user_role,expires_at) VALUES (?,?,?,?,?,?)')
    .run(tenant.id, tok, u.id, 'zz@prueba.test', 'owner', exp);

  navegador = await puppeteer.launch({ executablePath: CHROMIUM, env: entornoDelNavegador(),
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const pg = await navegador.newPage();
  await pg.setViewport({ width: 1280, height: 1100 });
  await pg.evaluateOnNewDocument(() => { window.prompt = () => null; window.confirm = () => false; window.alert = () => {}; });
  await pg.setCookie({ name: 'asess', value: tok, domain: `${SLUG}.bamburu.com`, path: '/', httpOnly: true, secure: true });

  // ── 1 · La pantalla dice qué compra ────────────────────────────────────────────────────────────
  P('\n[1] La pantalla dice qué compra, con el importe y la fecha delante');
  await pg.goto(`${HOST}/admin/suscripcion`, { waitUntil: 'networkidle2', timeout: 45000 });
  let t = await pg.evaluate(() => document.body.innerText);
  const proximo = fechaEnPalabras(siguienteDiaDeCobro(hoyISO()));
  check('la pantalla abre estando cortado', pg.url().includes('/admin/suscripcion'), pg.url());
  check('ofrece recuperar el negocio', /recuperar mi negocio/i.test(t), t.slice(0, 400));
  check('dice que el negocio está entero y no se ha borrado nada', /no se ha borrado nada/i.test(t));
  check('dice el IMPORTE que se paga hoy: 11,98 €', /11,98 €/.test(t));
  check('y lo desglosa en base + IVA', /9,90 €/.test(t) && /2,08 €/.test(t));
  check('dice la FECHA EXACTA del próximo cobro, antes de pagar', t.includes(proximo), proximo);
  check('y que es el día 5 como siempre, con su aviso una semana antes',
    /d[íi]a 5 como siempre/i.test(t) && /una semana antes/i.test(t));
  check('deja claro que NO se cobran los meses que estuvo fuera',
    /no se te cobran/i.test(t) && /por adelantado/i.test(t), t.slice(0, 900));
  check('ofrece LAS DOS opciones, que es el criterio del dueño',
    /recuperar mi cuenta en marcha/i.test(t) && /solo quiero mis datos/i.test(t));
  check('y dice que las dos cuestan lo mismo', /las dos cuestan lo mismo/i.test(t));
  check('avisa de que se cobrará en la tarjeta guardada', /terminada en/i.test(t));
  // LA CONTRADICCIÓN QUE SOLO SE VIO MIRANDO (quinta tarea seguida): encima del rescate salía
  // «en cuanto el cobro salga bien, tu cuenta se reactiva sola». En una cuenta CORTADA no va a salir
  // ningún cobro solo — el único camino es rescatar. Alguien podía quedarse esperando.
  check('NO dice que la cuenta se reactive sola: cortada, el único camino es rescatar',
    !/se reactiva sola/i.test(t), (t.match(/.*se reactiva sola.*/) || [''])[0]);
  check('y no hay dos cajas diciendo cómo volver', !/Qué hay que pagar/.test(t), t.slice(0, 700));
  await pg.evaluate(() => document.getElementById('susRescateCuenta')?.scrollIntoView({ block: 'center' }));
  await new Promise(r => setTimeout(r, 400));
  await pg.screenshot({ path: '/home/ubuntu/rescate.png' });

  // ── 2 · La tarjeta vieja no vale: se dice y se puede cambiar ───────────────────────────────────
  P('\n[2] La tarjeta vieja no vale — el caso esperable de quien fue cortado');
  await pg.click('#susRescateCuenta');
  await new Promise(r => setTimeout(r, 900));
  const panel = await pg.evaluate(() => document.body.innerText);
  check('confirma DENTRO de la página, con el importe y la fecha',
    /vas a recuperar tu cuenta/i.test(panel) && /11,98/.test(panel) && panel.includes(proximo), panel.slice(0, 500));
  await pg.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /recuperar mi cuenta$/i.test(x.textContent.trim())
      || /S[íi], recuperar mi cuenta/i.test(x.textContent));
    b?.click();
  });
  await pg.waitForFunction(() => /no se pudo|rechaz|tarjeta/i.test(document.getElementById('susRescateAviso')?.textContent || ''),
    { timeout: 60000 }).catch(() => {});
  const aviso = await pg.evaluate(() => document.getElementById('susRescateAviso')?.textContent || '');
  check('el rescate NO sale con la tarjeta que falla', /./.test(aviso), aviso);
  check('y la cuenta sigue cortada: no se abre sin haber cobrado',
    getTenantById(tenant.id).status === 'suspended_admin', getTenantById(tenant.id).status);
  check('el negocio NO queda marcado como rescatado',
    !cd.prepare('SELECT rescate_en FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id).rescate_en);

  // Se cambia la tarjeta por una buena — el flujo ya construido — y se rescata.
  P('\n[3] Se cambia la tarjeta y el rescate sale');
  const buena = await stripe.stripeApi('POST', '/payment_methods', { type: 'card', card: { token: 'tok_visa' } });
  await stripe.stripeApi('POST', `/payment_methods/${buena.datos.id}/attach`, { customer: cliente });
  await stripe.fijarMetodoPorDefecto(cliente, buena.datos.id);
  cd.prepare('UPDATE tenant_suscripciones SET stripe_metodo_pago_id=?, tarjeta_ultimos4=? WHERE tenant_id=?')
    .run(buena.datos.id, buena.datos.card?.last4 || '4242', tenant.id);

  await pg.goto(`${HOST}/admin/suscripcion`, { waitUntil: 'networkidle2', timeout: 45000 });
  await pg.click('#susRescateCuenta');
  await new Promise(r => setTimeout(r, 900));
  await pg.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /S[íi], recuperar mi cuenta/i.test(x.textContent));
    b?.click();
  });
  await pg.waitForFunction(() => location.search.includes('msg='), { timeout: 90000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  P('    [diagnóstico] url=' + pg.url());
  P('    [diagnóstico] aviso=' + JSON.stringify(await pg.evaluate(() => document.getElementById('susRescateAviso')?.textContent || '(no hay caja)')));
  P('    [diagnóstico] botones del panel=' + JSON.stringify(await pg.evaluate(() =>
      [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(x => x).slice(0, 12))));
  t = await pg.evaluate(() => document.body.innerText);
  check('la cuenta vuelve a estar ACTIVA', getTenantById(tenant.id).status === 'active', getTenantById(tenant.id).status);
  check('la pantalla dice que el pago se recibió y el negocio vuelve',
    /pago recibido/i.test(t) && /vuelve a estar en marcha/i.test(t), t.slice(0, 500));
  check('y dice cuándo será el próximo cobro', t.includes(proximo), proximo);

  // ── 4 · La caza de contradicciones ─────────────────────────────────────────────────────────────
  P('\n[4] Frases que juntas se contradicen (quinta tarea buscándolas)');
  check('ya NO se ofrece rescatar una cuenta que está activa', !/recuperar mi negocio/i.test(t), t.slice(0, 600));
  check('ya NO sale la franja de SOLO LECTURA', !/SOLO LECTURA/.test(t));
  check('ni la de «hay un problema con tu pago»', !/hay un problema con tu pago/i.test(t));
  check('ni se le siguen ofreciendo los 90 días de descarga',
    !/d[íi]as para descargar tus datos/i.test(t), t.slice(0, 800));
  check('la situación que se enseña es «al corriente»', /al corriente/i.test(t), t.slice(0, 400));
  check('y la factura del rescate aparece en sus facturas de Bamburu',
    /Tus facturas de Bamburu/.test(t) && /11,98 €/.test(t));
  await pg.screenshot({ path: '/home/ubuntu/rescate-hecho.png' });

  P('\n  capturas: /home/ubuntu/rescate.png · /home/ubuntu/rescate-hecho.png');
  P('\n──────────────────────────────────────────────────────────');
  P(`  ${ok} OK · ${mal} fallos`);
  P('──────────────────────────────────────────────────────────\n');
} finally {
  if (navegador) await navegador.close().catch(() => {});
  const sub = cd.prepare('SELECT stripe_suscripcion_id FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id)?.stripe_suscripcion_id;
  if (sub && sub !== antes.stripe_suscripcion_id) await stripe.cancelarSuscripcion(sub).catch(() => {});
  const td = new Database(`/home/ubuntu/bamburu/data/tenants/${SLUG}.db`);
  td.prepare("DELETE FROM admin_sessions WHERE token LIKE 'zzres%'").run();
  cd.prepare("DELETE FROM tenant_sessions WHERE session_token LIKE 'zzres%'").run();
  setTenantStatus(tenant.id, estadoAntes, estadoAntes === 'active' ? null : notaAntes);
  const cols = Object.keys(antes).filter(k => k !== 'tenant_id');
  cd.prepare('UPDATE tenant_suscripciones SET ' + cols.map(c => c + '=?').join(', ') + ' WHERE tenant_id=?')
    .run(...cols.map(c => antes[c]), tenant.id);
  P(`  sesión borrada · negocio devuelto a «${estadoAntes}»`);
}
process.exit(mal ? 1 : 0);
