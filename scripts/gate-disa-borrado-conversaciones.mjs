#!/usr/bin/env node
//
// gate-disa-borrado-conversaciones.mjs — QUE BORRAR SEA BORRAR, Y SOLO LO TUYO.
//
// DE DÓNDE SALE (AUD-002, comprobado vivo el 2 sep 2026). `POST /api/disa/clear` hacía
// `DELETE FROM disa_conversations` SIN WHERE: una llamada de cualquiera con sesión —también un
// empleado sin permisos— vaciaba el historial de conversación del NEGOCIO ENTERO.
//
// Y LA OTRA MITAD, que salió al mirar y no estaba en la ficha: la papelera de cada conversación NO
// BORRABA NADA. Hacía `is_active=0` sobre el hilo y dejaba los mensajes enteros. Medido en
// `desarrollo-bamburu` el 3 sep 2026: **62 de las 105** filas colgaban de hilos ya «borrados».
//
// QUÉ EXIGE ESTE GATE, y se mide CONTANDO EN LA BASE, no leyendo el código:
//   [1] Borrar todas las mías se lleva las MÍAS y ninguna más — ni las de mi compañero, ni las de
//       otro negocio. Y el negocio acaba en CERO cuando borran los dos, que es la otra mitad.
//   [2] Se lleva también lo que ya estaba oculto (`is_active=0`), o «borrado real» sería mentira.
//   [3] Lo que NO es conversación sigue ahí: la cuota del mes, el registro de actividad, los adjuntos.
//   [4] No queda ninguna puerta para tocar lo ajeno: el hilo de otro da 404 y no borra nada.
//   [5] Sin la prueba anti-CSRF, la petición se rechaza y no borra nada.
//   [6] Y EN UN NAVEGADOR DE VERDAD: se pulsa el botón, se lee el aviso, se dice que NO (y no se
//       borra nada), se dice que SÍ (y se borra), y todo con las ventanitas del navegador
//       SILENCIADAS, que es donde este producto ya se dejó un botón muerto dos veces.
//
// SE TRAE SUS PROPIOS NEGOCIOS (`EMPIEZAN_DE_CERO`) y los borra al terminar, pase lo que pase. No
// podía ser de otra forma: un gate que DESTRUYE conversaciones no se ejecuta sobre las de nadie.
//
//   node scripts/gate-disa-borrado-conversaciones.mjs
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import path from 'path';
import { unlinkSync, mkdirSync } from 'fs';
import puppeteer from 'puppeteer-core';
import { launchOpts, APP_DIR } from './lib/gate-env.mjs';
import { provisionTenant } from '../core/tenant-provisioning.js';
import { getTenantBySlug, controlDb } from '../core/control-db.js';

const RID = randomBytes(3).toString('hex');
const SHOTS = path.join(process.env.HOME || '/home/ubuntu', 'borrado-shots');
const dormir = ms => new Promise(r => setTimeout(r, ms));
try { mkdirSync(SHOTS, { recursive: true }); } catch {}

let pass = 0, fail = 0;
const ok = (c, m, det) => {
  if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); }
  else { fail++; console.error('  ✗ ' + m + (det ? ' · ' + det : '')); }
};

// Los dos negocios de usar y tirar. `slugs` manda en la limpieza: si el gate revienta a mitad, se
// van igual — la regla de la casa es que lo que una prueba crea, la prueba lo borra.
const slugs = [];
const bases = {};
let browser = null;
function limpiar() {
  for (const s of Object.keys(bases)) { try { bases[s].close(); } catch {} }
  for (const s of slugs) {
    const t = getTenantBySlug(s);
    // LA LIMPIEZA SIGUE EL GRAFO DE CLAVES AJENAS, no una lista escrita a mano. La primera versión
    // soltaba solo `tenant_sessions` y el `DELETE FROM tenants` moría con FOREIGN KEY: los negocios
    // de prueba se quedaban en `control.db` para siempre, con sus ficheros ya borrados — o sea, un
    // negocio fantasma por pasada. La causa era `tenant_suscripciones`, una tabla que ni existía
    // cuando se escribieron los gates de este estilo. Una lista a mano siempre se queda corta:
    // se pregunta al esquema, que es quien sabe.
    if (t) {
      for (const tabla of controlDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name)) {
        try {
          for (const k of controlDb.prepare('PRAGMA foreign_key_list("' + tabla + '")').all().filter(k => k.table === 'tenants')) {
            controlDb.prepare('DELETE FROM "' + tabla + '" WHERE "' + k.from + '"=?').run(t.id);
          }
        } catch {}
      }
    }
    try { controlDb.prepare('DELETE FROM tenants WHERE slug=?').run(s); } catch (e) { console.error('  ⚠️ no se pudo borrar el negocio ' + s + ': ' + e.message); }
    if (t) {
      const abs = path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP_DIR, t.db_filename);
      for (const f of [abs, abs + '-wal', abs + '-shm']) { try { unlinkSync(f); } catch {} }
    }
  }
}

async function nacerNegocio(nombre) {
  const alta = await provisionTenant({
    businessName: nombre + ' ' + RID, ownerName: 'Dueña Gate',
    email: 'delivered@resend.dev', password: 'Gate.Borrado.' + RID + '!', phone: '+34 600 000 000',
  });
  slugs.push(alta.slug);
  const t = getTenantBySlug(alta.slug);
  const abs = path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP_DIR, t.db_filename);
  const db = new Database(abs);
  db.pragma('busy_timeout = 10000');
  bases[alta.slug] = db;
  return { slug: alta.slug, db };
}

const ahora = () => Math.floor(Date.now() / 1000);
function sesion(db, userId) {
  const token = 'zz-borrado-' + randomBytes(20).toString('hex');
  const csrf = randomBytes(20).toString('hex');
  const t = ahora();
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(token, userId, t, t + 3600, csrf);
  return { token, csrf };
}
function empleado(db, nombre) {
  return db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES (?,?,?,'employee',1)")
    .run('ZZ ' + nombre + ' ' + RID, 'zz-' + nombre.toLowerCase() + '-' + RID + '@bamburu.test', 'x').lastInsertRowid;
}
// Siembra `n` conversaciones de `userId`. `oculto` reproduce lo que dejaba la papelera vieja: el
// hilo marcado como no activo y sus mensajes intactos en la base.
function sembrar(db, userId, n, { oculto = false } = {}) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const th = db.prepare('INSERT INTO disa_conversation_threads (title,user_id,is_active) VALUES (?,?,?)')
      .run('ZZ hilo ' + RID + ' #' + i, userId, oculto ? 0 : 1).lastInsertRowid;
    db.prepare('INSERT INTO disa_conversations (messages,thread_id) VALUES (?,?)')
      .run(JSON.stringify([{ role: 'user', content: 'ZZ mensaje ' + RID + ' #' + i }]), th);
    ids.push(th);
  }
  return ids;
}
const nConv = (db, userId) => db.prepare(
  'SELECT COUNT(*) n FROM disa_conversations c JOIN disa_conversation_threads t ON t.id=c.thread_id WHERE t.user_id=?').get(userId).n;
const nHilos = (db, userId) => db.prepare('SELECT COUNT(*) n FROM disa_conversation_threads WHERE user_id=?').get(userId).n;
const totalConv = db => db.prepare('SELECT COUNT(*) n FROM disa_conversations').get().n;
const cuenta = (db, tabla) => { try { return db.prepare('SELECT COUNT(*) n FROM ' + tabla).get().n; } catch { return -1; } };

async function pedir(slug, ruta, { metodo = 'POST', token, csrf } = {}) {
  const cab = { cookie: 'asess=' + token };
  if (csrf) cab['x-csrf-token'] = csrf;
  const r = await fetch('http://' + slug + '.localhost:3000' + ruta, { method: metodo, headers: cab });
  let cuerpo = null;
  try { cuerpo = await r.json(); } catch {}
  return { status: r.status, cuerpo };
}

try {
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[0] DOS NEGOCIOS DE CERO, con dos personas en el primero');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const A = await nacerNegocio('Gate Borrado A');
  const B = await nacerNegocio('Gate Borrado B');
  ok(!!A.slug && !!B.slug, 'dos negocios nuevos, cada uno con su fichero de base de datos', A.slug + ' · ' + B.slug);

  const duenyoA = A.db.prepare("SELECT id FROM admin_users WHERE role='owner' ORDER BY id LIMIT 1").get().id;
  const compaA = empleado(A.db, 'Companyera');
  const duenyoB = B.db.prepare("SELECT id FROM admin_users WHERE role='owner' ORDER BY id LIMIT 1").get().id;

  // 4 a la vista + 3 ya ocultas: las ocultas son las que la papelera vieja dejaba vivas para siempre.
  sembrar(A.db, duenyoA, 4);
  sembrar(A.db, duenyoA, 3, { oculto: true });
  sembrar(A.db, compaA, 5);
  sembrar(B.db, duenyoB, 6);

  const antes = { duenyoA: nConv(A.db, duenyoA), compaA: nConv(A.db, compaA), B: totalConv(B.db) };
  ok(antes.duenyoA === 7 && antes.compaA === 5 && antes.B === 6,
     'sembrado: 7 conversaciones del dueño de A (3 de ellas ya ocultas), 5 de su compañera, 6 en el negocio B',
     JSON.stringify(antes));

  // Lo que NO debe moverse. Se apunta ANTES para poder contrastar al final.
  A.db.prepare("INSERT INTO disa_usage (month,count) VALUES (?,?) ON CONFLICT(month) DO UPDATE SET count=?")
    .run('2026-09', 41, 41);
  A.db.prepare("INSERT INTO activity_logs (user_id,user_name,action,entity,details) VALUES (?,?,?,?,?)")
    .run(duenyoA, 'ZZ Gate', 'zz_gate_borrado', 'gate', RID);
  A.db.prepare("INSERT INTO attachments (kind,original_name,path,mime,size) VALUES ('supplier_invoice',?,?,'application/pdf',10)")
    .run('ZZ ' + RID + '.pdf', 'data/uploads/zz-' + RID + '.pdf');
  const intocables = { usage: A.db.prepare("SELECT count FROM disa_usage WHERE month='2026-09'").get().count,
                       logs: cuenta(A.db, 'activity_logs'), adjuntos: cuenta(A.db, 'attachments') };

  const sesDuenyoA = sesion(A.db, duenyoA);
  const sesCompaA = sesion(A.db, compaA);
  const sesDuenyoB = sesion(B.db, duenyoB);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] SIN LA PRUEBA ANTI-CSRF NO SE BORRA NADA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const sinCsrf = await pedir(A.slug, '/api/disa/clear', { token: sesDuenyoA.token });
  ok(sinCsrf.status === 403, 'una petición sin la prueba anti-CSRF se rechaza', 'HTTP ' + sinCsrf.status);
  ok(nConv(A.db, duenyoA) === 7, 'y no se ha borrado ni una conversación', nConv(A.db, duenyoA) + ' siguen ahí');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] LA RUTA QUE VACIABA EL NEGOCIO ENTERO SOLO SE LLEVA LAS DE QUIEN LA PIDE');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const r1 = await pedir(A.slug, '/api/disa/clear', { token: sesDuenyoA.token, csrf: sesDuenyoA.csrf });
  ok(r1.status === 200, 'el dueño de A borra todas las suyas', 'HTTP ' + r1.status);
  ok(nConv(A.db, duenyoA) === 0, 'cero conversaciones suyas en la base', 'antes 7, ahora ' + nConv(A.db, duenyoA));
  ok(nHilos(A.db, duenyoA) === 0, 'y cero hilos suyos: no quedan conversaciones vacías en la lista');
  ok(r1.cuerpo?.hilos === 7 && r1.cuerpo?.mensajes === 7,
     'incluidas las 3 QUE YA ESTABAN OCULTAS — «borrado real» también para las que creía borradas',
     JSON.stringify(r1.cuerpo));
  ok(nConv(A.db, compaA) === 5, 'las 5 de su COMPAÑERA siguen intactas, al número exacto', nConv(A.db, compaA) + ' de 5');
  ok(totalConv(B.db) === 6, 'y el negocio B no se ha enterado: 6 de 6', totalConv(B.db) + ' de 6');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] LO QUE NO ES CONVERSACIÓN NO SE TOCA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const despues = { usage: A.db.prepare("SELECT count FROM disa_usage WHERE month='2026-09'").get()?.count,
                    logs: cuenta(A.db, 'activity_logs'), adjuntos: cuenta(A.db, 'attachments') };
  ok(despues.usage === intocables.usage,
     'la CUOTA de IA del mes sigue igual: borrar el chat no es la forma de saltarse el tope',
     intocables.usage + ' → ' + despues.usage);
  ok(despues.logs === intocables.logs, 'el registro de actividad del negocio, intacto', intocables.logs + ' → ' + despues.logs);
  ok(despues.adjuntos === intocables.adjuntos, 'los adjuntos (facturas subidas por el chat), intactos', intocables.adjuntos + ' → ' + despues.adjuntos);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] NADIE PUEDE BORRAR EL HILO DE OTRO');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const hiloAjeno = A.db.prepare('SELECT id FROM disa_conversation_threads WHERE user_id=? ORDER BY id LIMIT 1').get(compaA).id;
  const r2 = await pedir(A.slug, '/api/disa/threads/' + hiloAjeno,
                         { metodo: 'DELETE', token: sesDuenyoA.token, csrf: sesDuenyoA.csrf });
  ok(r2.status === 404, 'el dueño pide el hilo de su compañera por su número y recibe 404', 'HTTP ' + r2.status);
  ok(nConv(A.db, compaA) === 5, 'y las 5 de ella siguen ahí', nConv(A.db, compaA) + ' de 5');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] EL NEGOCIO LLEGA A CERO CUANDO BORRAN LOS DOS — y el otro sigue entero');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const r3 = await pedir(A.slug, '/api/disa/clear', { token: sesCompaA.token, csrf: sesCompaA.csrf });
  ok(r3.status === 200, 'ahora borra la compañera las suyas', 'HTTP ' + r3.status);
  ok(totalConv(A.db) === 0, 'CERO conversaciones en el negocio A, contadas en la base', totalConv(A.db));
  ok(cuenta(A.db, 'disa_conversation_threads') === 0, 'y cero hilos');
  ok(totalConv(B.db) === 6, 'EL NEGOCIO B, INTACTO: 6 de 6 · jamás se cruzó la frontera', totalConv(B.db) + ' de 6');
  const rB = await pedir(B.slug, '/api/disa/clear', { token: sesDuenyoB.token, csrf: sesDuenyoB.csrf });
  ok(rB.status === 200 && totalConv(B.db) === 0, 'y B borra las suyas por su cuenta cuando quiere', 'HTTP ' + rB.status);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[6] EL NAVEGADOR — pulsando el botón, leyendo el aviso, y diciendo primero que NO');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Se vuelve a sembrar: la parte de arriba dejó el negocio a cero a propósito.
  sembrar(A.db, duenyoA, 3);
  sembrar(A.db, compaA, 2);
  ok(nConv(A.db, duenyoA) === 3 && nConv(A.db, compaA) === 2, 'resembrado para la prueba en navegador: 3 del dueño, 2 de ella');

  browser = await puppeteer.launch(launchOpts());
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 950 });
  const errores = [];
  page.on('pageerror', e => errores.push(String(e?.message || e)));

  // LAS VENTANITAS DEL NAVEGADOR, SILENCIADAS. Es la tercera regla de CLAUDE.md y no es teórica:
  // este producto se dejó un botón muerto EN SILENCIO dos veces por depender de ellas. Si algo de
  // este flujo se apoyara en `confirm()`, aquí se caería — y tiene que seguir funcionando entero.
  await page.evaluateOnNewDocument(() => {
    window.prompt = () => null;
    window.confirm = () => false;
    window.alert = () => {};
  });
  await page.setCookie({ name: 'asess', value: sesDuenyoA.token, domain: A.slug + '.localhost', path: '/' });
  await page.goto('http://' + A.slug + '.localhost:3000/admin/disa', { waitUntil: 'networkidle0' });

  // ── LO QUE ESTE GATE DESTAPÓ DE PASO, Y NO ESTABA EN LA FICHA ─────────────────────────────────
  // La columna `pinned` se añadía dentro de `register(app, db)` de `modules/disa/index.js`, que
  // corre UNA vez al arrancar y con el proxy por tenant de `core/db.js` — que fuera de una petición
  // LANZA. Un `catch {}` vacío se lo comía: el ALTER no corrió NUNCA. Medido el 3 sep 2026:
  // **86 de 87 bases sin la columna**, y `/api/disa/threads` pide `t.pinned` → HTTP 500 y lista
  // vacía en todos los negocios menos el de desarrollo, donde se había añadido a mano. Se movió a
  // `runMigrations` (modules/erp/models.js), que sí corre por negocio. Se afirma AQUÍ, sobre un
  // negocio recién nacido, que es el único sitio donde el fallo se ve.
  const colPinned = A.db.prepare("PRAGMA table_info(disa_conversation_threads)").all().map(c => c.name).includes('pinned');
  ok(colPinned, 'un negocio RECIÉN CREADO ya trae la columna `pinned` (la migración corre por negocio)');
  const rHilos = await fetch('http://' + A.slug + '.localhost:3000/api/disa/threads',
                             { headers: { cookie: 'asess=' + sesDuenyoA.token } });
  ok(rHilos.status === 200, 'y `/api/disa/threads` responde 200 en vez de 500', 'HTTP ' + rHilos.status);

  const enLista = () => page.evaluate(() => document.querySelectorAll('#dtList .dt-item').length);
  ok(await enLista() === 3, 'la lista enseña las 3 conversaciones del dueño', String(await enLista()));

  const hayBoton = await page.evaluate(() => !!document.getElementById('dtBorrarTodasBtn'));
  ok(hayBoton, 'el botón «Borrar todas mis conversaciones» está en la pantalla');

  // ── El aviso: qué dice ANTES de que se borre nada ─────────────────────────────────────────────
  await page.click('#dtBorrarTodasBtn');
  await page.waitForSelector('.modal-overlay.open', { timeout: 5000 });
  const aviso = await page.evaluate(() => {
    const ov = document.querySelector('.modal-overlay.open');
    return { titulo: ov.querySelector('.modal-head h3')?.textContent.trim() || '',
             texto: ov.querySelector('.modal-body p')?.textContent.trim() || '',
             aceptar: ov.querySelector('[data-pd="ok"]')?.textContent.trim() || '',
             cancelar: ov.querySelector('.modal-foot [data-pd="x"]')?.textContent.trim() || '' };
  });
  ok(/borrar todas/i.test(aviso.titulo), 'sale un aviso DENTRO de la página, no una ventanita del navegador', aviso.titulo);
  ok(/no se puede deshacer/i.test(aviso.texto), 'y dice con todas las letras que NO se puede deshacer');
  ok(/nadie más|nadie mas/i.test(aviso.texto), 'y dice también lo que NO se lleva: las de nadie más del negocio');
  await page.screenshot({ path: path.join(SHOTS, 'aviso-borrar-todas.png') });

  // ── DICIENDO QUE NO ───────────────────────────────────────────────────────────────────────────
  await page.click('.modal-foot [data-pd="x"]');
  await dormir(400);
  ok(nConv(A.db, duenyoA) === 3, 'diciendo que NO no se borra NADA', nConv(A.db, duenyoA) + ' de 3');
  ok(await enLista() === 3, 'y la lista sigue con sus 3');

  // ── UNA SOLA, con su propia confirmación ──────────────────────────────────────────────────────
  await page.hover('#dtList .dt-item');
  await page.click('#dtList .dt-item .dt-del');
  await page.waitForSelector('.modal-overlay.open', { timeout: 5000 });
  const aviso1 = await page.evaluate(() => document.querySelector('.modal-overlay.open .modal-body p')?.textContent.trim() || '');
  ok(/no se puede deshacer/i.test(aviso1), 'la papelera de UNA conversación también avisa de que es definitivo');
  await page.click('.modal-overlay.open [data-pd="ok"]');
  await dormir(700);
  ok(nConv(A.db, duenyoA) === 2, 'y al aceptar la borra DE VERDAD de la base (antes solo la ocultaba)', nConv(A.db, duenyoA) + ' de 3');

  // ── DICIENDO QUE SÍ ───────────────────────────────────────────────────────────────────────────
  await page.click('#dtBorrarTodasBtn');
  await page.waitForSelector('.modal-overlay.open', { timeout: 5000 });
  await page.click('.modal-overlay.open [data-pd="ok"]');
  await dormir(900);
  ok(nConv(A.db, duenyoA) === 0, 'diciendo que SÍ se borran todas las suyas', nConv(A.db, duenyoA) + ' de 2');
  ok(nConv(A.db, compaA) === 2, 'y las 2 de su compañera siguen intactas', nConv(A.db, compaA) + ' de 2');
  const vacia = await page.evaluate(() => document.getElementById('dtList')?.innerText.trim() || '');
  ok(/sin conversaciones/i.test(vacia), 'la pantalla lo refleja: «Sin conversaciones»', vacia.slice(0, 40));
  await page.screenshot({ path: path.join(SHOTS, 'despues-de-borrar.png') });

  ok(errores.length === 0, 'cero errores de JavaScript en toda la pasada', errores.join(' | ').slice(0, 120));
  console.log('  📷 capturas en ' + SHOTS);

} catch (e) {
  fail++;
  console.error('  ✗ EXCEPCIÓN: ' + (e?.stack || e?.message || e));
} finally {
  try { if (browser) await browser.close(); } catch {}
  console.log('\n[limpieza] borrando los negocios de prueba: ' + slugs.join(', '));
  limpiar();
  console.log('  ✓ negocios de prueba eliminados');
}

console.log('\n═════════ RESULTADO: ' + pass + ' ✓ · ' + fail + ' ✗ ═════════');
process.exit(fail ? 1 : 0);
