// RECORDATORIOS A CLIENTES (la «cola de envíos») — Gate de NAVEGADOR (Tarea L, 21 ago 2026).
//   node scripts/gate-cola-envios.mjs
//
// CONTRA LA DIRECCIÓN PÚBLICA, NO CONTRA LOCAL: https://<slug>.bamburu.com, que es lo que ve el dueño.
//
// LO QUE EL PASO 0 CORRIGIÓ DEL ENCARGO, y por eso este gate lo AFIRMA en vez de darlo por supuesto:
// la pantalla YA traía el armazón del panel y YA tenía entrada de menú, clave de permisos y alias en
// el buscador. Lo que faltaba era el interior. Las comprobaciones 1–4 se quedan igualmente: lo que
// hoy está bien y nadie vigila es lo que mañana se rompe sin que se entere nadie.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { join } from 'path';
import { unlinkSync } from 'fs';
import { randomBytes } from 'crypto';
import { launchOpts, APP_DIR } from './lib/gate-env.mjs';
import { provisionTenant } from '../core/tenant-provisioning.js';
import { controlDb, getTenantBySlug } from '../core/control-db.js';

import { soltarAtaduras } from './lib/tirar-negocio.mjs';
let pass = 0, fail = 0;
const ok = (c, m, e = '') => { (c ? pass++ : fail++); console.log((c ? '  ✓ ' : '  ✗ FALLO: ') + m + (e ? ' — ' + e : '')); };
const TS = Date.now(), RID = String(TS).slice(-6);
const creados = [];
let b;
const dormir = ms => new Promise(r => setTimeout(r, ms));
const ymd = d => d.toISOString().slice(0, 10);
// Pulsar sin morir: si el botón no existe (que es lo que pasa al revertir una pieza), el gate da rojo
// y SIGUE. Un gate que muere en la primera ausencia deja sin medir todo lo que venía detrás.
const clic = async (page, sel) => { try { await page.click(sel); return true; } catch { return false; } };

function borrarTenant(slug) {
  const t = getTenantBySlug(slug);
  // ⚙️ 3 SEP 2026 — SUELTA LAS ATADURAS ANTES DE BORRAR EL NEGOCIO. Desde el 2 de septiembre
  // `createTenant` siembra la prueba de 15 días, así que todo negocio nuevo tiene fila en
  // `tenant_suscripciones`: sin soltarla, el DELETE de abajo muere con FOREIGN KEY y el negocio de
  // prueba se queda dentro de control.db para siempre. `soltarAtaduras` le pregunta al esquema.
  soltarAtaduras(slug);
  controlDb.prepare('DELETE FROM tenants WHERE slug=?').run(slug);
  if (t) for (const s of ['', '-wal', '-shm']) { try { unlinkSync(join(APP_DIR, t.db_filename + s)); } catch {} }
}
async function negocio(etiqueta) {
  const r = await provisionTenant({
    businessName: 'GCOLA ' + etiqueta + ' ' + TS, ownerName: 'Ana ' + etiqueta,
    email: 'gcola-' + etiqueta + '-' + TS + '@t.local', password: 'contrasena-larga-123',
    country: 'ES', sector: 'peluquería', oficio: 'peluqueria',
  });
  creados.push(r.slug);
  const db = new Database(join(APP_DIR, r.db_filename));
  const owner = db.prepare('SELECT id,name FROM admin_users WHERE active=1').get();
  const tok = randomBytes(24).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tok, owner.id, now, now + 7200, randomBytes(16).toString('base64url'));
  return { slug: r.slug, db, owner, tok, base: 'https://' + r.slug + '.bamburu.com' };
}
const abrirCola = async (p, n) => {
  await p.goto(n.base + '/admin/citas/cola', { waitUntil: 'networkidle2' });
  await p.waitForFunction(() => !!document.querySelector('.cola-wrap') || !!document.querySelector('#colaConf'), { timeout: 20000 });
  await dormir(700);
};

try {
  b = await puppeteer.launch(launchOpts());
  const n = await negocio('uno');
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 950 });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errs.push('console: ' + m.text()); });
  await p.setCookie({ name: 'asess', value: n.tok, domain: n.slug + '.bamburu.com', path: '/', secure: true });

  // ── [1] EL ARMAZÓN DEL PANEL ────────────────────────────────────────────────────────────────
  console.log('\n[1] la pantalla es una pantalla del panel, no una hoja suelta');
  await abrirCola(p, n);
  const marco = await p.evaluate(() => ({
    rail: !!document.querySelector('.sidebar'),
    barra: !!document.querySelector('.topbar'),
    buscador: !!document.querySelector('.topbar input, .topbar [data-buscar], #navBuscador, .topbar .nav-buscar'),
    volver: !!document.querySelector('a[href="/admin/citas"]'),
  }));
  ok(marco.rail, 'trae el menú lateral');
  ok(marco.barra, 'trae la barra superior');
  ok(marco.buscador, 'y el buscador de la barra');
  ok(marco.volver, 'y «← Agenda» sigue estando: volver a donde venías es útil, pero ya no es la única salida');

  // ── [2][3] SE LLEGA SIN TECLEAR LA DIRECCIÓN ────────────────────────────────────────────────
  console.log('\n[2][3] se llega por el menú y por Ctrl+K');
  await p.goto(n.base + '/admin', { waitUntil: 'networkidle2' });
  await dormir(900);
  const porMenu = await p.evaluate(async () => {
    const enlaces = [...document.querySelectorAll('a[href="/admin/citas/cola"]')];
    return { n: enlaces.length, texto: enlaces.map(a => a.textContent.replace(/\s+/g, ' ').trim()).join(' | ') };
  });
  ok(porMenu.n > 0, 'hay una entrada de menú que apunta aquí (sin desplegar nada a mano)', porMenu.n + ' enlace(s): ' + porMenu.texto.slice(0, 60));
  // El buscador del topbar: se abre con Ctrl+K y se busca por el nombre NUEVO y por el VIEJO.
  await p.keyboard.down('Control'); await p.keyboard.press('KeyK'); await p.keyboard.up('Control');
  await dormir(500);
  const busca = async q => p.evaluate(async (q) => {
    const i = document.querySelector('.nav-buscar input, #navBuscadorInput, .topbar input[type="text"], .topbar input');
    if (!i) return { ok: false, res: [] };
    i.value = q; i.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 350));
    const res = [...document.querySelectorAll('a,[data-href],[role="option"]')]
      .filter(e => /recordatorios|cola de env/i.test(e.textContent || ''))
      .map(e => e.getAttribute('href') || e.getAttribute('data-href') || '');
    return { ok: true, res: res.filter(Boolean) };
  }, q);
  const bNuevo = await busca('Recordatorios');
  const bViejo = await busca('Cola de env');
  ok(bNuevo.ok && bNuevo.res.some(h => h.endsWith('/admin/citas/cola')), 'Ctrl+K la encuentra por su nombre', JSON.stringify(bNuevo.res.slice(0, 2)));
  ok(bViejo.res.some(h => h.endsWith('/admin/citas/cola')), 'y por el nombre viejo, «Cola de envíos», que quedó como alias', JSON.stringify(bViejo.res.slice(0, 2)));

  // ── [4] PERMISOS ────────────────────────────────────────────────────────────────────────────
  console.log('\n[4] quien no tiene el permiso ni la ve ni entra');
  const sin = n.db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active,must_change_password,created_at) VALUES ('Sin Citas',?,'x','employee',1,0,datetime('now'))")
    .run('sincitas-' + TS + '@t.local').lastInsertRowid;
  const tokSin = randomBytes(24).toString('base64url');
  n.db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tokSin, sin, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000) + 3600, 'x');
  const r403 = await fetch(n.base + '/admin/citas/cola', { headers: { cookie: 'asess=' + tokSin } });
  ok(r403.status === 403 || r403.status === 401, 'el servidor le responde 403 al entrar por la dirección', 'HTTP ' + r403.status);
  // ⚠️ AL EMPLEADO SE LE DA UN PERMISO CUALQUIERA A PROPÓSITO, y no es para que la prueba pase: es
  // que con CERO permisos propios el menú NO SE FILTRA — `hasCustomPerms` exige `perms.length > 0`.
  // Es un fallo PREEXISTENTE y GENERAL (vale para todas las entradas, no para ésta), anotado en el
  // TABLERO desde el 17-jul-2026, y el PASO 2 de este encargo deja los permisos fuera de alcance.
  // Con un permiso propio —que es el caso de cualquier empleado real— el filtro sí actúa, y eso es
  // lo que aquí se puede exigir y se exige.
  const permOtro = n.db.prepare("SELECT id FROM permissions WHERE module='clients' AND action='read'").get();
  n.db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(sin, permOtro.id);
  const suPanel = await (await fetch(n.base + '/admin', { headers: { cookie: 'asess=' + tokSin } })).text();
  ok(!suPanel.includes('/admin/citas/cola'), 'y en su menú no aparece la entrada (empleado con permisos propios)');
  ok(suPanel.includes('/admin/clients'), 'y sí las que sí puede: el menú se está filtrando de verdad, no está vacío');

  // ── [5][6] CONTENEDOR CON AIRE Y ANCHO MÁXIMO ───────────────────────────────────────────────
  console.log('\n[5][6] las tarjetas ya no van de borde a borde');
  await abrirCola(p, n);
  const caja = await p.evaluate(() => {
    const c = [...document.querySelectorAll('.card')];
    const r = c[0].getBoundingClientRect();
    return { izq: Math.round(r.left), der: Math.round(window.innerWidth - r.right),
             ancho: Math.round(r.width), ventana: window.innerWidth,
             hueco: c.length > 1 ? Math.round(c[1].getBoundingClientRect().top - c[0].getBoundingClientRect().bottom) : 0 };
  });
  ok(caja.izq >= 16 && caja.der >= 16, 'hay margen a los dos lados: la tarjeta no toca el borde de la ventana', caja.izq + 'px / ' + caja.der + 'px');
  ok(caja.hueco >= 8, 'y las dos tarjetas están separadas entre sí, no pegadas', caja.hueco + 'px');
  await p.setViewport({ width: 1920, height: 950 });
  await abrirCola(p, n);
  const ancho = await p.evaluate(() => {
    const r = document.querySelector('.card').getBoundingClientRect();
    return { ancho: Math.round(r.width), ventana: window.innerWidth };
  });
  ok(ancho.ancho <= 1200, 'a 1920 px el contenido tiene tope: no se estira de lado a lado', ancho.ancho + 'px de ' + ancho.ventana);
  await p.setViewport({ width: 1440, height: 950 });

  // ── [L4][L7] TÍTULO DE PÁGINA Y CABECERA DE TARJETA ─────────────────────────────────────────
  // No estaban en la lista de comprobaciones del encargo, pero L4 y L7 sí son puntos suyos: un punto
  // sin aserción no está verificado, por muy a la vista que quede en una captura.
  console.log('\n[L4][L7] el título pesa lo que pesa un título, y las cabeceras son las del sistema');
  const jerarquia = await p.evaluate(() => {
    const t = document.querySelector('.cola-tit');
    const cs = t ? getComputedStyle(t) : null;
    const heads = [...document.querySelectorAll('.cola-card .card-head')];
    return {
      texto: t ? t.textContent.trim() : null,
      tam: cs ? parseFloat(cs.fontSize) : 0,
      peso: cs ? Number(cs.fontWeight) : 0,
      cabeceras: heads.length,
      conBorde: heads.filter(h => getComputedStyle(h).borderBottomWidth !== '0px').length,
    };
  });
  ok(jerarquia.tam >= 22 && jerarquia.peso >= 700,
     'el título de la pantalla tiene jerarquía de título, no de rótulo de listado', jerarquia.tam + 'px / peso ' + jerarquia.peso);
  ok(jerarquia.texto === 'Recordatorios a clientes',
     'y se llama como en el menú y en la pestaña: el renombrado de agosto queda terminado', String(jerarquia.texto));
  ok(jerarquia.cabeceras === 2 && jerarquia.conBorde === 2,
     'los dos bloques llevan la CABECERA DE TARJETA del sistema, no una negrita suelta', jerarquia.cabeceras + ' cabeceras');

  // ── [7] HOY ANTES QUE MAÑANA ────────────────────────────────────────────────────────────────
  console.log('\n[7] lo urgente primero');
  await abrirCola(p, n);
  const orden = await p.evaluate(() => [...document.querySelectorAll('.card .card-head h3')].map(h => h.textContent.trim()));
  ok(/^Hoy/.test(orden[0] || '') && /^Mañana/.test(orden[1] || ''), 'el bloque de HOY va antes que el de MAÑANA en el DOM', orden.join('  →  '));

  // ── [8] EL VACÍO ENSEÑA ─────────────────────────────────────────────────────────────────────
  console.log('\n[8] con 0 pendientes, el vacío dice QUÉ aparecerá y CUÁNDO');
  const vacio = await p.evaluate(() => {
    const conf = document.getElementById('colaConf'), rec = document.getElementById('colaRec');
    return {
      hoy: (conf.querySelector('.empty-tx') || {}).textContent || conf.textContent.trim(),
      manana: (rec.querySelector('.empty-tx') || {}).textContent || rec.textContent.trim(),
      iconoHoy: !!conf.querySelector('.empty-ic i'),
      iconoManana: !!rec.querySelector('.empty-ic i'),
    };
  });
  ok(/Aquí aparecerán/i.test(vacio.hoy) && /hoy/i.test(vacio.hoy) && /confirmaci/i.test(vacio.hoy),
     'el de hoy nombra qué aparecerá y cuándo', vacio.hoy.slice(0, 72));
  ok(/Aquí aparecerán/i.test(vacio.manana) && /mañana/i.test(vacio.manana) && /recordatorio/i.test(vacio.manana),
     'y el de mañana también', vacio.manana.slice(0, 72));
  ok(vacio.iconoHoy && vacio.iconoManana, 'los dos con su icono, del bloque de vacío del sistema');
  ok(!/^No hay nada pendiente\.$/.test(vacio.hoy.trim()), 'y ya no es el «No hay nada pendiente.» que no explicaba nada');

  // ── [9] LA CABECERA DICE CUÁNTAS SON ────────────────────────────────────────────────────────
  console.log('\n[9] el número, en la cabecera del bloque');
  // TRES citas HOY (confirmaciones) y UNA mañana. A una de hoy se le marca el aviso: el número tiene
  // que contar las PENDIENTES, no las filas — si contara filas, diría 3 con 2 por despachar.
  const HOY = ymd(new Date());
  const MANANA = ymd(new Date(Date.now() + 86400000));
  const insCli = n.db.prepare("INSERT INTO clients (name,active,created_at) VALUES (?,1,datetime('now'))");
  const insCita = n.db.prepare("INSERT INTO citas (codigo,cliente_id,user_id,fecha,inicio_min,dur_min,margen_min,estado,created_at,updated_at) VALUES (?,?,?,?,?,30,0,'confirmada',datetime('now'),datetime('now'))");
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push(insCita.run('GC' + RID + i, insCli.run('Cliente Hoy ' + i + ' ' + RID).lastInsertRowid, n.owner.id, HOY, 9 * 60 + i * 60).lastInsertRowid);
  insCita.run('GCM' + RID, insCli.run('Cliente Mañana ' + RID).lastInsertRowid, n.owner.id, MANANA, 10 * 60);
  n.db.prepare("INSERT INTO cita_avisos (cita_id,tipo,canal,estado,enviado_at) VALUES (?,'confirmacion','whatsapp','marcado',datetime('now'))").run(ids[0]);
  await abrirCola(p, n);
  const conNumero = await p.evaluate(() => ({
    hoy: document.getElementById('colaConfTit').textContent.trim(),
    manana: document.getElementById('colaRecTit').textContent.trim(),
    filasHoy: document.querySelectorAll('#colaConf tbody tr').length,
  }));
  ok(conNumero.filasHoy === 3, 'las tres citas de hoy siguen listándose, la ya marcada incluida', conNumero.filasHoy + ' filas');
  ok(/Hoy — 2 pendientes de confirmación/.test(conNumero.hoy),
     'y la cabecera cuenta las PENDIENTES (2), no las filas (3)', conNumero.hoy);
  ok(/Mañana — 1 pendiente de recordatorio/.test(conNumero.manana), 'con singular cuando es una sola', conNumero.manana);

  // ── [10] LA (i) Y LA FRASE QUE NO SE PUEDE PERDER ───────────────────────────────────────────
  console.log('\n[10] el muro de texto, detrás de la (i) — pero la advertencia no se pierde');
  const muro = await p.evaluate(() => ({
    hayAlertArriba: !!document.querySelector('.cola-wrap .alert'),
    abierta: document.getElementById('mColaInfo') ? document.getElementById('mColaInfo').classList.contains('open') : null,
    fraseVisible: (document.querySelector('.cola-sub') || {}).textContent || '',
  }));
  ok(!muro.hayAlertArriba, 'el párrafo de tres líneas a ancho completo ya no está encima de la agenda');
  ok(muro.abierta === false, 'la ventana nace cerrada');
  ok(muro.fraseVisible.trim().length > 0 && muro.fraseVisible.length < 160, 'y arriba se queda UNA frase, no un párrafo', muro.fraseVisible.replace(/\s+/g, ' ').trim().slice(0, 70));
  const abrio = await clic(p, '.cola-i');
  await dormir(400);
  const info = await p.evaluate(() => {
    const m = document.getElementById('mColaInfo');
    return { abierta: !!m && m.classList.contains('open'), txt: m ? m.textContent.replace(/\s+/g, ' ') : '' };
  });
  ok(abrio && info.abierta, 'la (i) abre la ventana del panel');
  ok(/marcado como enviado/i.test(info.txt), 'y dentro está la frase de «marcado como enviado», por texto', 'sí');
  ok(/no que el mensaje llegó/i.test(info.txt) && /nunca vas a leer «entregado»|entregado/i.test(info.txt),
     'con lo que significa: que se pulsó el botón, NO que el mensaje llegó', 'sí');
  await p.evaluate(() => closeModal('mColaInfo'));

  // ── [11] VOLVER A LA AGENDA ─────────────────────────────────────────────────────────────────
  console.log('\n[11] «← Agenda» sigue funcionando');
  // Se espera por la DIRECCIÓN, no por que exista una función de la agenda: lo que se comprueba aquí
  // es que el botón lleva donde dice, no cuánto tarda la agenda en arrancar su JavaScript.
  const volvio = await clic(p, '.cola-ph a[href="/admin/citas"]');
  let ruta = '(no se pulsó)';
  if (volvio) {
    try { await p.waitForFunction(() => location.pathname === '/admin/citas', { timeout: 12000 }); } catch {}
    ruta = await p.evaluate(() => location.pathname);
  }
  ok(ruta === '/admin/citas', 'lleva a la agenda', ruta);

  // ── [12] MÓVIL ──────────────────────────────────────────────────────────────────────────────
  console.log('\n[12] móvil · 360, 390 y 414 px');
  for (const w of [360, 390, 414]) {
    await p.setViewport({ width: w, height: 780 });
    await abrirCola(p, n);
    const m = await p.evaluate(() => ({
      desborda: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      cards: document.querySelectorAll('.cola-card').length,
    }));
    ok(!m.desborda, 'a ' + w + ' px no hay scroll horizontal');
    ok(m.cards === 2, 'a ' + w + ' px los dos bloques siguen ahí', m.cards + ' tarjetas');
  }
  ok(errs.length === 0, 'cero errores de consola', errs.slice(0, 2).join(' | '));

} catch (e) {
  fail++;
  console.error('\n✗ EXCEPCIÓN: ' + (e && e.stack || e));
} finally {
  try { if (b) await b.close(); } catch {}
  for (const s of creados) { try { borrarTenant(s); } catch {} }
  console.log('\n──────────────────────────────────────────────');
  console.log((fail === 0 ? '✓ GATE VERDE' : '✗ GATE ROJO') + ' — ' + pass + ' pasan · ' + fail + ' fallan');
  // Y EL MISMO VEREDICTO EN EL IDIOMA DEL RUNNER. `run-gates.mjs` decide PASA/SOSPECHOSO buscando un
  // resumen reconocible ("N OK", "PASS: n", "N comprobaciones"): un gate que sale 0 pero no dice
  // cuántas aserciones corrió lo marca SOSPECHOSO y **cuenta como no-pasa**. La línea de arriba, que
  // me inventé, no casaba con ninguno — así que este gate iba verde por su cuenta y el barrido lo
  // daba por no-pasado. Lo destapó el barrido del 21 ago: los CUATRO gates nuevos, los cuatro míos,
  // salían SOSPECHOSOS por esto. Es la hermana del fallo de estar fuera de GRUPOS: allí no lo
  // ejecutaba nadie, aquí sí lo ejecuta pero no sabe leer lo que contesta.
  console.log(pass + ' OK · ' + fail + ' fallos');
  process.exit(fail === 0 ? 0 : 1);
}
