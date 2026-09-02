#!/usr/bin/env node
//
// gate-suscripcion-datos-pantallas.mjs — La descarga, mirada con ojos de cliente.
//
// LO QUE VIENE A CAZAR. En las TRES tareas anteriores apareció el mismo tipo de fallo, y solo se vio
// abriendo la pantalla: frases correctas por separado que juntas se contradicen. Aquí se buscan a
// propósito, y además se comprueba lo que de verdad importa:
//   · Que **desde una cuenta cortada se pueda descargar**, igual que se puede pagar. Pidiendo la
//     ruta, no leyendo el código: es la lección del 2 de septiembre, aplicada al segundo botón.
//   · Que el paquete que baja el navegador **se abra de verdad** — se descarga por HTTP y se
//     verifica el ZIP entero.
//   · Que en la bóveda la pantalla **no ofrezca un botón que no lleva a ninguna parte**.
//
// LO QUE CREA, LO BORRA: sesión, estado de la suscripción y el ZIP de prueba.

import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { existsSync, unlinkSync, readFileSync, writeFileSync } from 'fs';
import { CHROMIUM, entornoDelNavegador } from './lib/gate-env.mjs';
import { getTenantById, setTenantStatus } from '../core/control-db.js';
import { sumarDias, hoyISO } from '../core/suscripcion.js';
import { verificarZip, leerDelZip } from '../core/zip.js';
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
const tok = 'zzdat' + randomBytes(24).toString('hex');
let navegador, zipDescargado = null;

const ponerCortado = (haceDias) => {
  const corte = sumarDias(hoyISO(), -haceDias);
  cd.prepare(`UPDATE tenant_suscripciones SET estado='pago_pendiente', cortado_en=?, cortado_por_impago=1,
    impago_desde=?, corte_previsto=?, descarga_hasta=?, en_boveda_desde=NULL,
    descarga_estado=NULL, descarga_fichero=NULL, descarga_resumen=NULL, tarjeta_ultimos4='0341',
    tarjeta_marca='visa' WHERE tenant_id=?`)
    .run(corte, sumarDias(corte, -30), corte, sumarDias(corte, DIAS_DE_DESCARGA), tenant.id);
  setTenantStatus(tenant.id, 'suspended_admin', 'Sin pago. Ve a «Mi suscripción» y pon una tarjeta: se reactiva sola.');
};

try {
  const td = new Database(`/home/ubuntu/bamburu/data/tenants/${SLUG}.db`);
  const usuario = td.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
  const ahora = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const exp = new Date(Date.now() + 1800000).toISOString().slice(0, 19).replace('T', ' ');
  td.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tok, usuario.id, ahora, exp, randomBytes(16).toString('hex'));
  cd.prepare('INSERT INTO tenant_sessions (tenant_id,session_token,user_id,user_email,user_role,expires_at) VALUES (?,?,?,?,?,?)')
    .run(tenant.id, tok, usuario.id, 'zz@prueba.test', 'owner', exp);

  navegador = await puppeteer.launch({ executablePath: CHROMIUM, env: entornoDelNavegador(),
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const pg = await navegador.newPage();
  await pg.setViewport({ width: 1280, height: 1000 });
  await pg.evaluateOnNewDocument(() => { window.prompt = () => null; window.confirm = () => false; window.alert = () => {}; });
  await pg.setCookie({ name: 'asess', value: tok, domain: `${SLUG}.bamburu.com`, path: '/', httpOnly: true, secure: true });

  // ── 1 · Cortado hace 10 días: la ventana está abierta y se ve ──────────────────────────────────
  P('\n[1] Cuenta cortada — el cliente ve cuánto le queda y puede prepararse la copia');
  ponerCortado(10);
  await pg.goto(`${HOST}/admin/suscripcion`, { waitUntil: 'networkidle2', timeout: 45000 });
  check('la pantalla abre estando cortado', pg.url().includes('/admin/suscripcion'), pg.url());
  let t = await pg.evaluate(() => document.body.innerText);
  check(`dice cuántos días quedan (${DIAS_DE_DESCARGA - 10})`, t.includes(`${DIAS_DE_DESCARGA - 10} días`), t.slice(0, 600));
  check('y qué pasará después: la bóveda, sin borrar nada',
    /bóveda/i.test(t) && /NO se borran/i.test(t), t.slice(0, 900));
  check('ofrece preparar la descarga', /preparar mi descarga/i.test(t), t.slice(0, 900));
  check('y NO dice a la vez que la ventana esté cerrada',
    !/ventana de descarga se cerró/i.test(t), 'dos mensajes contrarios a la vez');

  // ── 2 · Se PULSA el botón, y se espera a que la copia esté lista ───────────────────────────────
  P('\n[2] Se pulsa «Preparar mi descarga» y se espera de verdad');
  await pg.click('#susPreparar');
  let lista = false;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const e = cd.prepare('SELECT descarga_estado, descarga_error FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id);
    if (e.descarga_estado === 'lista') { lista = true; break; }
    if (e.descarga_estado === 'error') { check('la preparación no falla', false, e.descarga_error); break; }
  }
  check('la copia llega a estar lista', lista, JSON.stringify(cd.prepare('SELECT descarga_estado, descarga_error FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id)));

  await pg.goto(`${HOST}/admin/suscripcion`, { waitUntil: 'networkidle2', timeout: 45000 });
  t = await pg.evaluate(() => document.body.innerText);
  check('la pantalla dice que está lista, con lo que lleva dentro', /tu copia está lista/i.test(t), t.slice(0, 900));
  check('y ofrece descargarla', /descargar mis datos/i.test(t));
  // LA CONTRADICCIÓN QUE SOLO SE VIO MIRANDO (2 sep 2026): la tarjeta de datos decía «1 facturas en
  // PDF» y la de justo debajo «todavía no hay ninguna factura». Hablaban de cosas distintas —las del
  // negocio y las de Bamburu— pero juntas se leen como un error. Y «1 facturas», de paso.
  check('las facturas del NEGOCIO y las de BAMBURU no se confunden',
    !(/facturas en PDF/.test(t) && /no hay ninguna factura\./.test(t)),
    'dos tarjetas seguidas diciendo lo contrario sobre «facturas»');
  check('y el singular está bien escrito', !/\b1 facturas\b/.test(t), (t.match(/.*1 facturas.*/) || [''])[0]);

  // ── 3 · EL CORAZÓN: se descarga DESDE LA CUENTA CORTADA, y el fichero se abre ──────────────────
  P('\n[3] Se descarga desde la cuenta cortada, y el ZIP se abre');
  const bajado = await pg.evaluate(async () => {
    const r = await fetch('/admin/suscripcion/descargar');
    if (!r.ok) return { status: r.status, bytes: 0, tipo: null };
    const b = await r.arrayBuffer();
    return { status: r.status, bytes: b.byteLength, tipo: r.headers.get('content-type'),
             datos: Array.from(new Uint8Array(b)) };
  });
  check('el modo SOLO LECTURA no bloquea la descarga', bajado.status === 200, `HTTP ${bajado.status}`);
  check('y llega un ZIP de verdad', bajado.tipo === 'application/zip' && bajado.bytes > 1000,
    `${bajado.tipo} · ${bajado.bytes} bytes`);
  if (bajado.datos) {
    const buf = Buffer.from(bajado.datos);
    zipDescargado = '/tmp/claude-1001/-home-ubuntu/cd5b61aa-c79e-4f70-99d3-c36feab6fb65/scratchpad/bajado.zip';
    writeFileSync(zipDescargado, buf);
    const v = verificarZip(buf);
    check('el fichero que baja el navegador SE ABRE (CRC de cada uno)', v.ok, v.error);
    check('trae el LEEME que explica qué hay dentro', !!leerDelZip(buf, 'LEEME.txt'));
    check('trae el manifiesto con el recuento', !!leerDelZip(buf, 'manifiesto.csv'));
    check('y trae las facturas en PDF', leerDelZip(buf, null, /^Facturas en PDF\/.*\.pdf$/)?.slice(0, 4).toString('latin1') === '%PDF');
  }
  // La tarjeta de los datos está más abajo: se baja a ella para poder MIRARLA.
  await pg.evaluate(() => document.getElementById('susDescarga')?.scrollIntoView({ block: 'center' }));
  await new Promise(r => setTimeout(r, 400));
  await pg.screenshot({ path: '/home/ubuntu/datos-ventana.png' });

  // ── 4 · En la bóveda: no se ofrece lo que ya no se puede hacer ─────────────────────────────────
  P('\n[4] Pasados los 90 días — la bóveda');
  cd.prepare('UPDATE tenant_suscripciones SET en_boveda_desde=?, descarga_hasta=? WHERE tenant_id=?')
    .run(hoyISO(), sumarDias(hoyISO(), -1), tenant.id);
  await pg.goto(`${HOST}/admin/suscripcion`, { waitUntil: 'networkidle2', timeout: 45000 });
  t = await pg.evaluate(() => document.body.innerText);
  check('dice que están en la bóveda', /bóveda/i.test(t), t.slice(0, 600));
  check('y que NO se ha borrado nada', /no se ha borrado nada/i.test(t), t.slice(0, 800));
  check('NO ofrece un botón de descargar que ya no funciona',
    !/descargar mis datos/i.test(t) && !/preparar mi descarga/i.test(t), t.slice(0, 800));
  check('y NO sigue diciendo que le quedan días', !/días para descargar/i.test(t), t.slice(0, 800));
  const cerrada = await pg.evaluate(async () => (await fetch('/admin/suscripcion/descargar', { redirect: 'manual' })).status);
  check('y la ruta de descarga ya no entrega el fichero', cerrada !== 200, `HTTP ${cerrada}`);
  await pg.screenshot({ path: '/home/ubuntu/datos-boveda.png' });

  P('\n  capturas: /home/ubuntu/datos-ventana.png · /home/ubuntu/datos-boveda.png');
  P('\n──────────────────────────────────────────────────────────');
  P(`  ${ok} OK · ${mal} fallos`);
  P('──────────────────────────────────────────────────────────\n');
} finally {
  if (navegador) await navegador.close().catch(() => {});
  const f = cd.prepare('SELECT descarga_fichero FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id)?.descarga_fichero;
  if (f && existsSync(f) && f !== antes.descarga_fichero) { try { unlinkSync(f); } catch {} }
  if (zipDescargado && existsSync(zipDescargado)) { try { unlinkSync(zipDescargado); } catch {} }
  const td = new Database(`/home/ubuntu/bamburu/data/tenants/${SLUG}.db`);
  td.prepare("DELETE FROM admin_sessions WHERE token LIKE 'zzdat%'").run();
  cd.prepare("DELETE FROM tenant_sessions WHERE session_token LIKE 'zzdat%'").run();
  setTenantStatus(tenant.id, estadoAntes, estadoAntes === 'active' ? null : notaAntes);
  cd.prepare(`UPDATE tenant_suscripciones SET estado=?, cortado_en=?, cortado_por_impago=?, impago_desde=?,
    corte_previsto=?, descarga_hasta=?, en_boveda_desde=?, descarga_estado=?, descarga_fichero=?,
    descarga_lista_en=?, descarga_error=?, descarga_resumen=?, tarjeta_marca=?, tarjeta_ultimos4=? WHERE tenant_id=?`)
    .run(antes.estado, antes.cortado_en ?? null, antes.cortado_por_impago ?? 0, antes.impago_desde ?? null,
         antes.corte_previsto ?? null, antes.descarga_hasta ?? null, antes.en_boveda_desde ?? null,
         antes.descarga_estado ?? null, antes.descarga_fichero ?? null, antes.descarga_lista_en ?? null,
         antes.descarga_error ?? null, antes.descarga_resumen ?? null, antes.tarjeta_marca ?? null,
         antes.tarjeta_ultimos4 ?? null, tenant.id);
  P(`  sesión borrada · negocio devuelto a «${estadoAntes}» y sin corte`);
}
process.exit(mal ? 1 : 0);
