#!/usr/bin/env node
//
// gate-portal-sin-llave-en-url.mjs — AUD-009: que la llave del portal no vuelva a la dirección.
//
// QUÉ MIDE. Monta las rutas REALES del portal (`modules/portal/index.js`) sobre una base de datos
// de usar y tirar y las conduce por HTTP de verdad con el cliente de pruebas de Hono. No comprueba
// «que el código diga», comprueba **lo que contesta el servidor**: los códigos, las cabeceras y el
// HTML que le llegaría al cliente.
//
// LOS CUATRO CRITERIOS DE LA FICHA, uno a uno:
//   1. La llave deja de viajar en la dirección → el enlace responde 302 a `/portal`, sin token, y
//      la llave se va en una cookie `HttpOnly`.
//   2. El enlace sigue siendo de un solo uso y fácil de abrir → un clic entra; y el MISMO enlace,
//      usado por segunda vez, ya no abre nada.
//   3. La llave caduca y se dice cuándo → la sesión hereda la caducidad del enlace y la página lo
//      escribe con su fecha.
//   4. Un enlace viejo copiado de un historial no abre nada → es el caso 2, dicho desde el otro
//      lado: se guarda la dirección, se usa después, y no entra.
//
//   node scripts/gate-portal-sin-llave-en-url.mjs
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runMigrations } from '../modules/erp/models.js';
import { register } from '../modules/portal/index.js';
import { createToken, revokeTokensDeCliente } from '../modules/portal/portal.js';

let pass = 0, fail = 0;
const ok = (c, m, det) => {
  if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); }
  else { fail++; console.error('  ✗ FALLO: ' + m + (det ? ' · ' + det : '')); }
};

const BANCO = mkdtempSync(path.join(tmpdir(), 'gate-portal-'));
const db = new Database(path.join(BANCO, 'zz.db'));

try {
  runMigrations(db);
  const app = new Hono();
  register(app, db);

  const cliente = db.prepare("INSERT INTO clients (name,email,active) VALUES ('ZZ Cliente Portal','delivered@resend.dev',1)").run().lastInsertRowid;
  db.prepare("INSERT INTO company_config (id, company_name) VALUES (1,'ZZ Negocio') ON CONFLICT(id) DO UPDATE SET company_name='ZZ Negocio'").run();
  // Una factura DE VERDAD: sin ella la tabla sale vacía y la comprobación del enlace del PDF no
  // mediría nada. Que un enlace no exista no demuestra que sea limpio.
  db.prepare(`INSERT INTO invoices
      (client_id, invoice_number, year, sequence, issue_date, due_date, company_name, company_fiscal_id,
       subtotal, tax_rate, tax_name, tax_amount, total, irpf_rate, irpf_amount, record_type, status, currency_symbol)
    VALUES (?, 'ZZ-0001', 2026, 1, date('now'), date('now','+30 day'), 'ZZ Negocio', 'B00000000',
       100, 21, 'IVA', 21, 121, 0, 0, 'F1', 'emitida', '€')`).run(cliente);

  const cookieDe = (r) => (r.headers.get('set-cookie') || '');
  const valorCookie = (sc) => (/(?:^|;\s*)psesion=([A-Za-z0-9_-]+)/.exec(sc) || [])[1] || '';

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] LA LLAVE SALE DE LA DIRECCIÓN');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const enlace = createToken(db, cliente, 14);
  const r1 = await app.request('/portal/' + enlace);
  ok(r1.status === 302, 'el enlace del correo NO pinta la página: redirige', 'HTTP ' + r1.status);
  ok(r1.headers.get('location') === '/portal', '  y manda a una dirección SIN llave', r1.headers.get('location'));
  const sc = cookieDe(r1);
  const sesion = valorCookie(sc);
  ok(!!sesion, '  dejando la llave en una cookie');
  ok(sesion !== enlace, '  y la cookie NO es el token del enlace: es otra llave distinta');
  ok(/HttpOnly/i.test(sc), '  la cookie es HttpOnly: ningún JavaScript la lee');
  ok(/Secure/i.test(sc), '  y Secure: no viaja por http en claro');
  ok(/SameSite=Lax/i.test(sc), '  y SameSite=Lax');
  ok(/Path=\/portal/i.test(sc), '  y limitada a /portal: nunca se manda a /admin', (sc.match(/Path=[^;]*/) || [''])[0]);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] CON LA COOKIE SE ENTRA, Y LA PÁGINA NO LLEVA LA LLAVE DENTRO');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const conCookie = (ruta, init = {}) => app.request(ruta, { ...init, headers: { ...(init.headers || {}), cookie: 'psesion=' + sesion } });
  const r2 = await conCookie('/portal');
  ok(r2.status === 200, 'con la cookie, el portal abre', 'HTTP ' + r2.status);
  const html = await r2.text();
  ok(html.includes('ZZ Cliente Portal'), '  y es SU portal, con su nombre');
  ok(!html.includes(enlace), '  el token del enlace NO aparece en el HTML', 'buscado literal');
  ok(!html.includes(sesion), '  ni la llave de la sesión');
  ok(!/href="\/portal\/[A-Za-z0-9_-]{20,}/.test(html), '  y ningún enlace de la página lleva llave en la dirección');
  ok(/href="\/portal\/factura\/\d+\/pdf"/.test(html) || !/factura/.test(html), '  los PDF cuelgan de una dirección limpia');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] UN SOLO USO: el enlace viejo ya no abre nada');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const r3 = await app.request('/portal/' + enlace);
  ok(r3.status === 403, 'el MISMO enlace, usado por segunda vez, NO entra', 'HTTP ' + r3.status);
  const htmlDenegado = await r3.text();
  ok(/una sola vez/i.test(htmlDenegado), '  y le explica al cliente por qué, y qué hacer');
  ok(!cookieDe(r3), '  y no reparte ninguna cookie nueva');

  // Es el criterio 4 dicho desde el otro lado: la dirección guardada en un historial.
  const delHistorial = '/portal/' + enlace;
  ok((await app.request(delHistorial)).status === 403,
     'una dirección copiada del historial del navegador no abre nada', delHistorial.slice(0, 24) + '…');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] SIN LLAVE NO SE ENTRA POR NINGUNA PUERTA');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  ok((await app.request('/portal')).status === 403, 'sin cookie, el portal no abre');
  ok((await app.request('/portal/factura/1/pdf')).status === 403, 'sin cookie, tampoco un PDF');
  ok((await app.request('/portal/mensaje', { method: 'POST', body: new URLSearchParams({ texto: 'zz' }) })).status === 403,
     'sin cookie, tampoco se escribe un mensaje');
  ok((await app.request('/portal', { headers: { cookie: 'psesion=inventada-a-mano' } })).status === 403,
     'una cookie inventada no vale');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] LA LLAVE CADUCA, Y SE DICE CUÁNDO');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  ok(/Este acceso caduca el/.test(html), 'la página dice cuándo caduca el acceso');
  ok(/caduca el\s*<b>\d{2}\/\d{2}\/\d{4}<\/b>/.test(html.replace(/\s+/g, ' ')),
     '  con una fecha concreta y en cristiano, no «en 14 días»');

  const sesionRow = db.prepare('SELECT expires_at FROM portal_sesiones WHERE token=?').get(sesion);
  const enlaceRow = db.prepare('SELECT expires_at FROM portal_tokens WHERE token=?').get(enlace);
  ok(sesionRow && enlaceRow && sesionRow.expires_at === enlaceRow.expires_at,
     'la sesión caduca CUANDO CADUCABA EL ENLACE, no más tarde por haber entrado tarde');

  // Y de verdad caduca: se la envejece en la base y deja de abrir.
  db.prepare('UPDATE portal_sesiones SET expires_at=? WHERE token=?').run(Math.floor(Date.now() / 1000) - 10, sesion);
  ok((await conCookie('/portal')).status === 403, 'una sesión caducada deja de abrir el portal');
  db.prepare('UPDATE portal_sesiones SET expires_at=? WHERE token=?').run(Math.floor(Date.now() / 1000) + 3600, sesion);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[6] REVOCAR CIERRA LAS DOS PUERTAS');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // Antes de AUD-009 solo existía una puerta. Ahora hay dos, y revocar tiene que cerrarlas ambas:
  // dejar viva la sesión de alguien a quien acabas de revocar el acceso sería revocar de mentira.
  ok((await conCookie('/portal')).status === 200, 'la sesión vuelve a abrir tras devolverle la fecha');
  revokeTokensDeCliente(db, cliente);
  ok((await conCookie('/portal')).status === 403, 'tras revocar al cliente, su sesión YA NO abre');
  const nuevo = createToken(db, cliente, 14);
  revokeTokensDeCliente(db, cliente);
  ok((await app.request('/portal/' + nuevo)).status === 403, '  y su enlace nuevo tampoco');

} catch (e) {
  fail++;
  console.error('  ✗ EXCEPCIÓN: ' + (e?.stack || e?.message || e));
} finally {
  try { db.close(); } catch { /* ya estaba cerrada */ }
  rmSync(BANCO, { recursive: true, force: true });
}

console.log('\n═════════ RESULTADO: ' + pass + ' ✓ · ' + fail + ' ✗ ═════════');
process.exit(fail ? 1 : 0);
