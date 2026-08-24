#!/usr/bin/env node
//
// gate-migracion-al-equipo.mjs — UNA PETICIÓN DE MIGRACIÓN, SEGUIDA HASTA EL FINAL.
//
// DE DÓNDE SALE. El 24 ago 2026 el dueño avisó: «el cliente pide su migración, recibe su acuse, y al
// equipo de Bamburu no le llega nada». Medido: la petición SÍ se registraba y el correo SÍ se
// mandaba —Resend lo aceptaba, por eso `email_ok` decía 1—, pero iba a `hola@bamburu.com`, que
// **REBOTA**: el dominio está verificado para ENVIAR con la recepción DESACTIVADA. Una sonda al
// mismo buzón dio estado `bounced`. O sea: salía, nadie la recibía, y el registro decía que bien.
//
// LO QUE SE EXIGE AHORA:
//   · La petición se registra Y **el fichero se guarda** (antes solo se anotaba su nombre: el
//     binario viajaba únicamente dentro del correo, así que un correo perdido se lo llevaba).
//   · El correo al equipo sale a una dirección que RECIBE, con el fichero y con quién lo pide.
//   · Y si el correo falla, la petición **sigue estando** y se ve en el panel de control, que no
//     depende de ningún buzón. Un buzón caído no puede hacer desaparecer a un cliente que entra.
//
//   node scripts/gate-migracion-al-equipo.mjs
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import puppeteer from 'puppeteer-core';
import { tenantDb, launchOpts, APP_DIR, autoAceptarPaneles } from './lib/gate-env.mjs';

const SLUG = 'desarrollo-bamburu';
const HOST = SLUG + '.bamburu.com';
const BASE = 'https://' + HOST;
const RID = randomBytes(3).toString('hex');
const dormir = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (c, m, det) => { if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ ' + m + (det ? ' · ' + det : '')); } };

const db = new Database(tenantDb(SLUG));
db.pragma('busy_timeout = 10000');
const owner = db.prepare("SELECT id, name FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
if (!owner) { console.error('✗ GATE ABORTADO: no hay dueño activo'); process.exit(2); }
const ahora = Math.floor(Date.now() / 1000);
const token = 'zz-migra-' + randomBytes(20).toString('hex');
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(token, owner.id, ahora, ahora + 3600, randomBytes(20).toString('hex'));

const antes = db.prepare('SELECT COUNT(*) n FROM migracion_peticiones').get().n;
let creada = null, adjuntoRuta = null, browser;

try {
  // ── LA DIRECCIÓN A LA QUE SE MANDA, dicha en voz alta ────────────────────────────────────────
  const fuente = readFileSync(join(APP_DIR, 'modules', 'erp', 'routes', 'migracion.js'), 'utf8');
  const mBuzon = /BUZON_POR_DEFECTO\s*=\s*process\.env\.BAMBURU_MIGRACIONES_EMAIL\s*\|\|\s*'([^']+)'/.exec(fuente);
  const buzon = mBuzon ? mBuzon[1] : '(no encontrado)';
  console.log('\n[0] A QUÉ DIRECCIÓN SE MANDA');
  ok(buzon.includes('@'), 'el buzón del equipo está declarado', buzon);
  ok(buzon !== 'hola@bamburu.com',
     'y NO es el que rebota (bamburu.com tiene la recepción desactivada en Resend)', buzon);

  browser = await puppeteer.launch(launchOpts());
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await autoAceptarPaneles(page);
  await page.setCookie({ name: 'asess', value: token, domain: HOST, path: '/', secure: true });
  const errores = [];
  page.on('pageerror', e => errores.push(String(e && e.message || e)));

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] SE PIDE LA MIGRACIÓN, COMO LA PIDE UN CLIENTE');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  await page.goto(BASE + '/admin/migracion', { waitUntil: 'networkidle2' });
  await page.waitForSelector('#mgEnviar', { timeout: 15000 });
  ok(true, 'la pantalla de «Trae tus datos» abre');

  // Un fichero de verdad, con contenido reconocible. NO empieza por punto (un fichero oculto lo ve
  // el navegador pero al leerlo da NotReadableError — lección ya pagada en este repo).
  const CONTENIDO = 'nombre;email\nCliente Migrado ' + RID + ';migrado-' + RID + '@ejemplo.test\n';
  await page.evaluate((txt, rid) => {
    const dt = new DataTransfer();
    dt.items.add(new File([txt], 'clientes-' + rid + '.csv', { type: 'text/csv' }));
    const inp = document.getElementById('mgFichero');
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }, CONTENIDO, RID);
  await dormir(500);

  // De dónde vienes y qué quieres traer NO son un desplegable ni casillas: son BOTONES con
  // `data-origen` / `data-quiere`. Se pulsan, que es lo que hace el cliente.
  await page.click('[data-origen="holded"]');
  await dormir(250);
  await page.click('[data-quiere="clientes"]');
  await dormir(250);
  await page.evaluate((rid) => { document.getElementById('mgComentario').value = 'Petición de prueba ' + rid; }, RID);
  const listo = await page.evaluate(() => ({
    origen: !!document.querySelector('[data-origen][aria-pressed="true"]'),
    quiere: !!document.querySelector('[data-quiere][aria-pressed="true"]'),
  }));
  ok(listo.origen && listo.quiere, 'se elige de dónde viene y qué quiere traer, pulsando', JSON.stringify(listo));
  await dormir(300);

  await page.click('#mgEnviar');
  await page.waitForFunction(() => {
    const h = document.getElementById('mgHecho');
    return h && h.offsetParent !== null;
  }, { timeout: 20000 }).catch(() => {});
  await dormir(1200);

  const acuse = await page.evaluate(() => {
    const h = document.getElementById('mgHecho');
    return h ? h.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  ok(/recibid|gracias|revisa/i.test(acuse), 'el cliente ve su acuse en pantalla', acuse.slice(0, 90));

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] LA PETICIÓN QUEDA REGISTRADA, Y EL FICHERO GUARDADO');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const despues = db.prepare('SELECT COUNT(*) n FROM migracion_peticiones').get().n;
  ok(despues === antes + 1, 'la petición se registra en la base', antes + ' → ' + despues);

  // LA MÍA, NO «LA ÚLTIMA». Coger la última y borrarla al salir es cómo se destruye el trabajo de
  // otro: en la primera pasada de este gate me llevé por delante una petición que ya estaba (resulta
  // que la había dejado `gate-inicio-arranque`, pero podría haber sido de un cliente de verdad).
  creada = db.prepare('SELECT * FROM migracion_peticiones WHERE comentario LIKE ? ORDER BY id DESC LIMIT 1')
    .get('%' + RID + '%');
  ok(!!creada && /Petición de prueba/.test(creada.comentario || ''), '  con su comentario', (creada.comentario || '').slice(0, 40));
  ok(!!creada && creada.user_name, '  y con quién la pide', creada && creada.user_name);
  ok(!!creada && creada.fichero, '  y el nombre del fichero', creada && creada.fichero);

  // EL FICHERO, DE VERDAD, EN DISCO. Es lo que antes se perdía con el correo.
  ok(!!creada && !!creada.attachment_id, 'EL FICHERO SE GUARDA (no solo su nombre)',
     creada && creada.attachment_id ? 'adjunto #' + creada.attachment_id : 'NO se guardó');
  if (creada && creada.attachment_id) {
    const a = db.prepare('SELECT * FROM attachments WHERE id=?').get(creada.attachment_id);
    adjuntoRuta = a && a.path ? join(APP_DIR, a.path) : null;
    ok(!!adjuntoRuta && existsSync(adjuntoRuta), '  y está en disco', a && a.path);
    if (adjuntoRuta && existsSync(adjuntoRuta)) {
      const leido = readFileSync(adjuntoRuta, 'utf8');
      ok(leido === CONTENIDO, '  con el contenido EXACTO que subió el cliente', leido.trim().slice(0, 50));
    }
    ok(a && a.entity_type === 'migracion_peticion' && a.entity_id === creada.id,
       '  y colgado de SU petición, no suelto', a ? (a.entity_type + '#' + a.entity_id) : '—');
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] Y SI EL CORREO FALLA, LA PETICIÓN NO SE PIERDE');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // No se simula: se comprueba que lo que el equipo mira NO depende del correo. La pantalla del
  // panel de control lee las peticiones de TODOS los negocios directamente de sus bases.
  const { peticionesDeTodos } = await import('../modules/superadmin/migraciones.js');
  const todas = peticionesDeTodos();
  const mia = todas.find(p => p.slug === SLUG && p.id === creada.id);
  ok(!!mia, 'la petición se ve en el panel de control, sin pasar por ningún buzón',
     mia ? (mia.empresa + ' · ' + mia.created_at) : 'NO aparece');
  ok(!!mia && !!mia.adjunto_path, '  con su fichero descargable desde ahí', mia && mia.adjunto_nombre);
  ok(!!mia && !!mia.user_name, '  y con quién la pide', mia && mia.user_name);

  // Una petición cuyo correo NO salió tiene que verse igual de bien: es justo la que hay que atender.
  const marcado = db.prepare('SELECT email_ok FROM migracion_peticiones WHERE id=?').get(creada.id);
  ok(marcado && (marcado.email_ok === 0 || marcado.email_ok === 1),
     '  y queda anotado si el correo salió o no', 'email_ok=' + (marcado && marcado.email_ok));

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] Y EL EQUIPO LA VE EN SU PANTALLA, con sesión de verdad');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // No basta con que la función devuelva la fila: hay que ABRIR la pantalla del panel de control y
  // leerla ahí, que es donde la mira una persona.
  const cdb = new Database(join(APP_DIR, 'data', 'control.db'));
  const emailSA = 'zz-migra-' + RID + '@bamburu.local';
  let saId = null, tokSA = null;
  try {
    saId = cdb.prepare('INSERT INTO superadmins (email,password_hash,must_change_password) VALUES (?,?,0)')
      .run(emailSA, 'x').lastInsertRowid;
    tokSA = randomBytes(32).toString('base64url');
    cdb.prepare('INSERT INTO superadmin_sessions (token,superadmin_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
      .run(tokSA, saId, ahora, ahora + 900, randomBytes(32).toString('base64url'));

    const pSA = await browser.newPage();
    await pSA.setViewport({ width: 1440, height: 1000 });
    await pSA.setCookie({ name: 'sadm', value: tokSA, domain: 'localhost', path: '/' });
    const rSA = await pSA.goto('http://localhost:3000/superadmin/migraciones', { waitUntil: 'networkidle2' });
    ok(rSA.status() === 200, 'la pantalla «Migraciones» del panel de control abre', 'HTTP ' + rSA.status());
    const visto = await pSA.evaluate((rid) => {
      const t = document.body.textContent || '';
      const enlace = [...document.querySelectorAll('a')].find(a => /\.csv/.test(a.textContent || ''));
      return { tieneComentario: t.includes(rid), enlace: enlace ? enlace.getAttribute('href') : null,
               textoEnlace: enlace ? enlace.textContent.trim() : '' };
    }, RID);
    ok(visto.tieneComentario, '  y la petición aparece en ella', 'buscado «' + RID + '»');
    ok(!!visto.enlace, '  con su fichero enlazado', visto.textoEnlace + ' → ' + visto.enlace);

    if (visto.enlace) {
      const bajado = await pSA.evaluate(async (href) => {
        const r = await fetch(href);
        return { status: r.status, texto: (await r.text()).slice(0, 200) };
      }, visto.enlace);
      ok(bajado.status === 200 && bajado.texto.includes(RID),
         '  y se DESCARGA con el contenido que subió el cliente', 'HTTP ' + bajado.status + ' · ' + bajado.texto.split('\n')[1]);
    }
    await pSA.close();
  } finally {
    try { if (tokSA) cdb.prepare('DELETE FROM superadmin_sessions WHERE token=?').run(tokSA); } catch {}
    try { if (saId) cdb.prepare('DELETE FROM superadmins WHERE id=?').run(saId); } catch {}
    try { cdb.close(); } catch {}
  }

  ok(errores.length === 0, 'cero errores de JavaScript en todo el recorrido', errores.join(' | ') || 'ninguno');

} finally {
  // LO QUE LA PRUEBA CREA, LA PRUEBA LO BORRA.
  try {
    if (creada) {
      if (creada.attachment_id) {
        try { const fs2 = await import('fs'); if (adjuntoRuta && existsSync(adjuntoRuta)) fs2.unlinkSync(adjuntoRuta); } catch {}
        db.prepare('DELETE FROM attachments WHERE id=?').run(creada.attachment_id);
      }
      db.prepare('DELETE FROM migracion_peticiones WHERE id=?').run(creada.id);
    }
  } catch {}
  try { db.prepare('DELETE FROM admin_sessions WHERE token=?').run(token); } catch {}
  const quedan = db.prepare('SELECT COUNT(*) n FROM migracion_peticiones').get().n;
  console.log('  · limpieza: peticiones ' + antes + ' antes, ' + quedan + ' ahora');
  try { if (browser) await browser.close(); } catch {}
  db.close();
}

console.log('\n' + '─'.repeat(70));
console.log('RESULTADO: ' + pass + ' ✓  ·  ' + fail + ' ✗');
process.exit(fail === 0 ? 0 : 1);
