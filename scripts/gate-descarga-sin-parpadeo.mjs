#!/usr/bin/env node
//
// gate-descarga-sin-parpadeo.mjs — Que la espera de la copia NO recargue la pantalla.
//
// DE DÓNDE SALE (2 sep 2026, Ibrahin probándolo con sus ojos): mientras la copia se preparaba, la
// pantalla hacía `location.reload()` cada 15 segundos para ver si ya estaba. Once minutos de la
// página ENTERA parpadeando con el cliente delante: pierde el sitio donde estaba mirando y parece
// que algo va mal.
//
// CÓMO SE DEMUESTRA QUE NO RECARGA, y no de oídas: se deja una MARCA en `window` antes de empezar.
// Una recarga se lleva por delante todo lo que hay en `window`. Si al terminar la marca sigue ahí
// —y el texto ha cambiado a «Tu copia está lista»— es que la tarjeta se repintó sola y la página no
// se movió. Se cuentan además las navegaciones que ve el navegador: tienen que ser CERO.
//
// LO QUE CREA, LO BORRA: sesión, estado del negocio y el ZIP de prueba.

import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { existsSync, unlinkSync } from 'fs';
import { CHROMIUM, entornoDelNavegador } from './lib/gate-env.mjs';
import { getTenantById, setTenantStatus } from '../core/control-db.js';
import { sumarDias, hoyISO } from '../core/suscripcion.js';
import { DIAS_DE_DESCARGA } from '../core/suscripcion-datos.js';

const SLUG = 'helados-ibrahin';            // 1 factura: la copia tarda segundos, no minutos
const HOST = `https://${SLUG}.bamburu.com`;
let ok = 0, mal = 0;
const P = t => console.log(t);
const check = (n, c, d = '') => { if (c) { ok++; P(`  ✓ ${n}`); } else { mal++; P(`  ✗ ${n}${d ? '\n      ' + String(d).slice(0, 300) : ''}`); } };

const cd = new Database('/home/ubuntu/bamburu/data/control.db');
const tenant = cd.prepare('SELECT id FROM tenants WHERE slug=?').get(SLUG);
const antes = cd.prepare('SELECT * FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id);
const estadoAntes = getTenantById(tenant.id).status;
const notaAntes = getTenantById(tenant.id).suspend_note ?? null;
const tok = 'zzpar' + randomBytes(24).toString('hex');
let navegador;

try {
  const corte = sumarDias(hoyISO(), -5);
  cd.prepare(`UPDATE tenant_suscripciones SET estado='pago_pendiente', cortado_en=?, cortado_por_impago=1,
    impago_desde=?, corte_previsto=?, descarga_hasta=?, en_boveda_desde=NULL, descarga_estado=NULL,
    descarga_fichero=NULL, descarga_resumen=NULL, descarga_error=NULL WHERE tenant_id=?`)
    .run(corte, sumarDias(corte, -30), corte, sumarDias(corte, DIAS_DE_DESCARGA), tenant.id);
  setTenantStatus(tenant.id, 'suspended_admin', 'Sin pago. Ve a «Mi suscripción» y pon una tarjeta: se reactiva sola.');

  const td = new Database(`/home/ubuntu/bamburu/data/tenants/${SLUG}.db`);
  const u = td.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
  const ahora = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const exp = new Date(Date.now() + 900000).toISOString().slice(0, 19).replace('T', ' ');
  td.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tok, u.id, ahora, exp, randomBytes(16).toString('hex'));
  cd.prepare('INSERT INTO tenant_sessions (tenant_id,session_token,user_id,user_email,user_role,expires_at) VALUES (?,?,?,?,?,?)')
    .run(tenant.id, tok, u.id, 'zz@prueba.test', 'owner', exp);

  navegador = await puppeteer.launch({ executablePath: CHROMIUM, env: entornoDelNavegador(),
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const pg = await navegador.newPage();
  await pg.setViewport({ width: 1280, height: 1000 });
  await pg.evaluateOnNewDocument(() => { window.prompt = () => null; window.confirm = () => false; window.alert = () => {}; });
  await pg.setCookie({ name: 'asess', value: tok, domain: `${SLUG}.bamburu.com`, path: '/', httpOnly: true, secure: true });

  // Cada navegación del documento principal se cuenta. Tienen que ser CERO después de pulsar.
  let navegaciones = 0;
  pg.on('framenavigated', f => { if (f === pg.mainFrame()) navegaciones += 1; });

  await pg.goto(`${HOST}/admin/suscripcion`, { waitUntil: 'networkidle2', timeout: 45000 });
  check('la tarjeta de la descarga está', await pg.evaluate(() => !!document.getElementById('susDescarga')));
  check('y ofrece prepararla', await pg.evaluate(() => !!document.getElementById('susPreparar')));

  // LA MARCA. Una recarga se lleva por delante todo lo que hay en `window`.
  await pg.evaluate(() => { window.__marcaDeIbrahin = 'sigo-aqui-' + Date.now(); });
  const marca = await pg.evaluate(() => window.__marcaDeIbrahin);
  // Y una segunda prueba, independiente: el sitio donde el cliente estaba mirando.
  await pg.evaluate(() => { document.getElementById('susDescarga').scrollIntoView({ block: 'center' }); });
  const scrollAntes = await pg.evaluate(() => Math.round(window.scrollY));

  navegaciones = 0;
  P('\n[la espera] Se pulsa «Preparar mi descarga» y se mira la pantalla mientras espera');
  await pg.click('#susPreparar');
  await new Promise(r => setTimeout(r, 1200));
  let t = await pg.evaluate(() => document.getElementById('susDescarga')?.innerText || '');
  check('en el acto dice que está preparando', /estamos preparando tu copia/i.test(t), t.slice(0, 200));
  check('y avisa de que puede cerrar la pantalla', /puedes cerrar esta pantalla/i.test(t));

  // Se espera a que cambie SOLO, sin tocar nada.
  let lista = false;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    t = await pg.evaluate(() => document.getElementById('susDescarga')?.innerText || '');
    if (/tu copia está lista/i.test(t)) { lista = true; break; }
    if (/no salió bien/i.test(t)) break;
  }
  check('la tarjeta cambia SOLA a «Tu copia está lista»', lista, t.slice(0, 300));
  check('y aparece el botón de descargar, sin recargar',
    await pg.evaluate(() => !!document.querySelector('a[href="/admin/suscripcion/descargar"]')));

  // ── LA PRUEBA DE QUE NO HUBO PARPADEO ─────────────────────────────────────────────────────────
  P('\n[sin parpadeo] Ni una recarga de la página');
  check('CERO navegaciones del documento mientras esperaba', navegaciones === 0, `hubo ${navegaciones}`);
  check('la marca dejada en la página SIGUE AHÍ (una recarga se la habría llevado)',
    (await pg.evaluate(() => window.__marcaDeIbrahin)) === marca,
    'la página se recargó: la marca desapareció');
  check('y el cliente no ha perdido el sitio donde estaba mirando',
    Math.abs((await pg.evaluate(() => Math.round(window.scrollY))) - scrollAntes) < 60,
    `estaba en ${scrollAntes} y ahora en ${await pg.evaluate(() => Math.round(window.scrollY))}`);
  // Sobre el CÓDIGO servido, no sobre los comentarios: la primera versión daba rojo porque casaba
  // con el comentario que EXPLICA que el reload se quitó. Ya van tres veces hoy con el mismo error.
  const jsServido = (await pg.content())
    .match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)?.join('\n') || '';
  const sinComentarios = jsServido.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  check('el CÓDIGO servido ya no tiene ningún location.reload',
    !/location\.reload/.test(sinComentarios),
    (sinComentarios.match(/.*location\.reload.*/) || [''])[0]);
  check('y sí tiene la vigilancia que repinta solo la tarjeta',
    /suscripcion\/situacion/.test(sinComentarios) && /caja\.innerHTML/.test(sinComentarios));

  await pg.screenshot({ path: '/home/ubuntu/descarga-lista.png' });
  P('\n  captura: /home/ubuntu/descarga-lista.png');
  P('\n──────────────────────────────────────────────────────────');
  P(`  ${ok} OK · ${mal} fallos`);
  P('──────────────────────────────────────────────────────────\n');
} finally {
  if (navegador) await navegador.close().catch(() => {});
  const f = cd.prepare('SELECT descarga_fichero FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id)?.descarga_fichero;
  if (f && existsSync(f) && f !== antes.descarga_fichero) { try { unlinkSync(f); } catch {} }
  const td2 = new Database(`/home/ubuntu/bamburu/data/tenants/${SLUG}.db`);
  td2.prepare("DELETE FROM admin_sessions WHERE token LIKE 'zzpar%'").run();
  cd.prepare("DELETE FROM tenant_sessions WHERE session_token LIKE 'zzpar%'").run();
  setTenantStatus(tenant.id, estadoAntes, estadoAntes === 'active' ? null : notaAntes);
  cd.prepare(`UPDATE tenant_suscripciones SET estado=?, cortado_en=?, cortado_por_impago=?, impago_desde=?,
    corte_previsto=?, descarga_hasta=?, en_boveda_desde=?, descarga_estado=?, descarga_fichero=?,
    descarga_lista_en=?, descarga_error=?, descarga_resumen=? WHERE tenant_id=?`)
    .run(antes.estado, antes.cortado_en ?? null, antes.cortado_por_impago ?? 0, antes.impago_desde ?? null,
         antes.corte_previsto ?? null, antes.descarga_hasta ?? null, antes.en_boveda_desde ?? null,
         antes.descarga_estado ?? null, antes.descarga_fichero ?? null, antes.descarga_lista_en ?? null,
         antes.descarga_error ?? null, antes.descarga_resumen ?? null, tenant.id);
  P(`  sesión borrada · negocio devuelto a «${estadoAntes}» · ZIP de prueba borrado`);
}
process.exit(mal ? 1 : 0);
