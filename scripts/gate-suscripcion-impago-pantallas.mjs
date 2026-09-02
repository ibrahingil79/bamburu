#!/usr/bin/env node
//
// gate-suscripcion-impago-pantallas.mjs — Las pantallas del impago, MIRADAS.
//
// Las dos tareas anteriores dejaron fallos que ninguna aserción vio y que solo aparecieron al abrir
// la pantalla: una ventanita vacía, y dos cajas correctas por separado que juntas se contradecían.
// Este gate va a por esos: pinta los dos estados —impago sin cortar, y cortado— y comprueba que lo
// que el cliente LEE es coherente y accionable.
//
// Y comprueba lo que es el corazón de la tarea: **desde una cuenta CORTADA se puede pagar.** No
// mirando el código: pidiendo la ruta que abre el pago y exigiendo que conteste.
//
// LO QUE CREA, LO BORRA: sesión, estado del negocio y episodio de impago, en el `finally`.

import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { CHROMIUM, entornoDelNavegador } from './lib/gate-env.mjs';
import { getTenantById, setTenantStatus } from '../core/control-db.js';
import { sumarDias, hoyISO } from '../core/suscripcion.js';

const SLUG = 'peluqueria-gil';
const HOST = `https://${SLUG}.bamburu.com`;
let ok = 0, mal = 0;
const P = t => console.log(t);
const check = (n, c, d = '') => { if (c) { ok++; P(`  ✓ ${n}`); } else { mal++; P(`  ✗ ${n}${d ? '\n      ' + String(d).slice(0, 350) : ''}`); } };

const cd = new Database('/home/ubuntu/bamburu/data/control.db');
const tenant = cd.prepare('SELECT id FROM tenants WHERE slug=?').get(SLUG);
const antes = cd.prepare('SELECT * FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id);
const estadoAntes = getTenantById(tenant.id).status;
// El MOTIVO también se guarda: el `finally` lo restauraba leyéndolo DESPUÉS de haberlo pisado, así
// que dejaba el texto de la prueba escrito en un negocio real. Un gate que deja su propia prosa en
// la pantalla de alguien es basura, aunque no rompa nada.
const notaAntes = getTenantById(tenant.id).suspend_note ?? null;
const tok = 'zzimp' + randomBytes(24).toString('hex');
let navegador;

const ponerImpago = (cortado) => {
  const desde = sumarDias(hoyISO(), -(cortado ? 30 : 12));
  cd.prepare(`UPDATE tenant_suscripciones SET estado='pago_pendiente', impago_desde=?, corte_previsto=?,
    cortado_por_impago=?, tarjeta_marca='visa', tarjeta_ultimos4='0341',
    stripe_cliente_id=COALESCE(stripe_cliente_id,'cus_prueba') WHERE tenant_id=?`)
    .run(desde, sumarDias(desde, 30), cortado ? 1 : 0, tenant.id);
  setTenantStatus(tenant.id, cortado ? 'suspended_admin' : 'active',
    cortado ? 'Sin pago desde hace 30 días. Ve a «Mi suscripción» y pon una tarjeta: se reactiva sola.' : null);
  return sumarDias(desde, 30);
};

try {
  const td = new Database(`/home/ubuntu/bamburu/data/tenants/${SLUG}.db`);
  const ahora = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const exp = new Date(Date.now() + 900000).toISOString().slice(0, 19).replace('T', ' ');
  td.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tok, 2, ahora, exp, randomBytes(16).toString('hex'));
  cd.prepare('INSERT INTO tenant_sessions (tenant_id,session_token,user_id,user_email,user_role,expires_at) VALUES (?,?,?,?,?,?)')
    .run(tenant.id, tok, 2, 'ibrahingil+prueba@gmail.com', 'owner', exp);

  navegador = await puppeteer.launch({ executablePath: CHROMIUM, env: entornoDelNavegador(),
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const pg = await navegador.newPage();
  await pg.setViewport({ width: 1280, height: 900 });
  await pg.evaluateOnNewDocument(() => { window.prompt = () => null; window.confirm = () => false; window.alert = () => {}; });
  await pg.setCookie({ name: 'asess', value: tok, domain: `${SLUG}.bamburu.com`, path: '/', httpOnly: true, secure: true });

  // El recuento de TODAS las tablas del negocio, antes de tocar nada. Es la única forma honesta de
  // afirmar que el corte no borra: comparar el antes con el después, tabla por tabla.
  const conteoDeTodo = () => {
    const bd = new Database(`/home/ubuntu/bamburu/data/tenants/${SLUG}.db`, { readonly: true });
    const out = {};
    for (const { name } of bd.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
      try { out[name] = bd.prepare(`SELECT COUNT(*) n FROM "${name}"`).get().n; } catch { out[name] = -1; }
    }
    bd.close();
    return out;
  };
  const conteosPrevios = conteoDeTodo();
  const conteosTras = () => conteoDeTodo();

  // ── 1 · IMPAGO SIN CORTAR: la cuenta funciona, pero se ve ──────────────────────────────────────
  P('\n[1] Impago sin cortar — el cliente que entra a trabajar lo ve');
  const corteEl = ponerImpago(false);
  await pg.goto(`${HOST}/admin`, { waitUntil: 'networkidle2', timeout: 45000 });
  const t1 = await pg.evaluate(() => document.body.innerText);
  check('sale la franja de problema con el pago', /hay un problema con tu pago/i.test(t1), t1.slice(0, 250));
  check('y dice la fecha en que pasaría a solo lectura',
    t1.includes(corteEl.split('-').reverse().join('/')), `esperaba ${corteEl.split('-').reverse().join('/')}`);
  check('con un botón para arreglarlo', /arreglar mi pago/i.test(t1));
  check('el botón lleva a «Mi suscripción»',
    await pg.evaluate(() => !![...document.querySelectorAll('a')].find(a => /arreglar mi pago/i.test(a.textContent) && a.getAttribute('href') === '/admin/suscripcion')));
  check('NO dice que esté en solo lectura, porque todavía no lo está', !/SOLO LECTURA/.test(t1), t1.slice(0, 250));
  await pg.screenshot({ path: '/home/ubuntu/impago-franja.png' });

  // ── 2 · CORTADO: qué lee, y si puede volver ────────────────────────────────────────────────────
  P('\n[2] Cortado — la pantalla dice exactamente qué hacer para volver');
  ponerImpago(true);
  await pg.goto(`${HOST}/admin`, { waitUntil: 'networkidle2', timeout: 45000 });
  const t2 = await pg.evaluate(() => document.body.innerText);
  check('sale la franja de SOLO LECTURA', /SOLO LECTURA/.test(t2), t2.slice(0, 250));
  check('dice que no se ha borrado nada', /no se ha borrado nada/i.test(t2), t2.slice(0, 300));
  // ⚙️ 2 SEP 2026 (cierre 3): «se reactiva sola» dejó de ser cierto al construirse el rescate.
  check('y dice CÓMO volver, no solo que hay que volver',
    /pon una tarjeta que funcione/i.test(t2) && /Recuperar mi cuenta/i.test(t2), t2.slice(0, 400));
  check('con su botón', /arreglar mi pago/i.test(t2));
  check('y NO sale además la franja de «hay un problema», que diría dos cosas a la vez',
    !/hay un problema con tu pago/i.test(t2), 'las dos franjas juntas se contradicen');

  // ── 3 · EL CORAZÓN: desde cortado, ¿se puede pagar de verdad? ──────────────────────────────────
  P('\n[3] Desde CORTADO se puede pagar — pidiéndolo, no leyendo el código');
  await pg.goto(`${HOST}/admin/suscripcion`, { waitUntil: 'networkidle2', timeout: 45000 });
  check('la pantalla de suscripción ABRE estando cortado', pg.url().includes('/admin/suscripcion'), pg.url());
  const t3 = await pg.evaluate(() => document.body.innerText);
  check('y enseña el botón de poner tarjeta', /dejar una tarjeta|cambiar de tarjeta/i.test(t3), t3.slice(0, 300));
  // LAS DOS CONTRADICCIONES QUE SOLO SE VIERON MIRANDO LA CAPTURA (2 sep 2026), y que ninguna
  // aserción de arriba cazó porque cada frase era correcta por separado:
  check('la tarjeta de estado dice que está CORTADO, no «vuelve a intentarlo»',
    /SOLO LECTURA/i.test(t3) && !/vuelve a intentarlo/i.test(t3), t3.slice(0, 500));
  // ⚙️ 2 SEP 2026 (cierre 3): la caja «Qué hay que pagar» ya NO sale en una cuenta cortada —decía
  // que se reactivaría sola, y en una cuenta cortada no sale ningún cobro solo—. Quien enseña el
  // importe ahora es la tarjeta del rescate. Lo que se mide sigue siendo lo mismo: que no se le
  // enseñe un prorrateo, y que la cifra que ve quien va a pagar sea la cuota entera.
  check('y NO enseña un prorrateo de 1,16 € cuando lo que se debe es la cuota entera',
    !/lo que se te cobrar[áa] ahora/i.test(t3) && /Recuperar mi negocio/i.test(t3), t3.slice(0, 600));
  check('la cifra que ve quien va a pagar es la cuota mensual', /11,98 €/.test(t3), t3.slice(0, 600));
  const alta = await pg.evaluate(async () => {
    const r = await fetch('/api/erp/suscripcion/alta', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.CSRF_TOKEN || '' }, body: '{}' });
    let c; try { c = await r.json(); } catch { c = {}; }
    return { status: r.status, tieneUrl: !!c.url, error: c.error || null };
  });
  check('y la petición que abre el pago NO la bloquea el modo solo lectura',
    alta.status === 200 && alta.tieneUrl, `HTTP ${alta.status} · ${alta.error}`);
  await pg.screenshot({ path: '/home/ubuntu/impago-cortado.png' });

  // ── 4 · Que el corte NO haya tocado ni un dato ─────────────────────────────────────────────────
  // SE COMPARA ANTES Y DESPUÉS, no se exige que haya datos. La primera versión afirmaba «los
  // clientes siguen ahí» exigiendo `> 0`, y dio rojo porque este negocio de pruebas tiene la tabla
  // de clientes VACÍA desde antes — la aserción medía el contenido del negocio, no el efecto del
  // corte. Lo que prueba «no borra nada» es que el recuento sea EL MISMO, valga lo que valga.
  P('\n[4] El corte no ha borrado nada');
  check('ni una fila cambió de sitio al cortar',
    JSON.stringify(conteosTras()) === JSON.stringify(conteosPrevios),
    `antes ${JSON.stringify(conteosPrevios)} · después ${JSON.stringify(conteosTras())}`);
  check('y se pueden seguir viendo estando cortado',
    (await (async () => { await pg.goto(`${HOST}/admin/clients`, { waitUntil: 'networkidle2', timeout: 45000 });
      return pg.url().includes('/admin/clients'); })()), pg.url());

  P('\n  capturas: /home/ubuntu/impago-franja.png · /home/ubuntu/impago-cortado.png');
  P('\n──────────────────────────────────────────────────────────');
  P(`  ${ok} OK · ${mal} fallos`);
  P('──────────────────────────────────────────────────────────\n');
} finally {
  if (navegador) await navegador.close().catch(() => {});
  const td = new Database(`/home/ubuntu/bamburu/data/tenants/${SLUG}.db`);
  td.prepare("DELETE FROM admin_sessions WHERE token LIKE 'zzimp%'").run();
  cd.prepare("DELETE FROM tenant_sessions WHERE session_token LIKE 'zzimp%'").run();
  setTenantStatus(tenant.id, estadoAntes, estadoAntes === 'active' ? null : notaAntes);
  cd.prepare(`UPDATE tenant_suscripciones SET estado=?, impago_desde=?, corte_previsto=?, avisos_impago=?,
    cortado_en=?, cortado_por_impago=?, tarjeta_marca=?, tarjeta_ultimos4=?, stripe_cliente_id=? WHERE tenant_id=?`)
    .run(antes.estado, antes.impago_desde ?? null, antes.corte_previsto ?? null, antes.avisos_impago ?? null,
         antes.cortado_en ?? null, antes.cortado_por_impago ?? 0, antes.tarjeta_marca, antes.tarjeta_ultimos4,
         antes.stripe_cliente_id, tenant.id);
  P(`  sesión borrada · negocio devuelto a «${estadoAntes}» y sin impago`);
}
process.exit(mal ? 1 : 0);
