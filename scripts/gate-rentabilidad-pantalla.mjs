// RENTABILIDAD POR PROYECTO · Escalera paso 7 · PIEZA 4 (parte 1) — Gate de NAVEGADOR contra el servidor real.
//
// QUÉ MIDE (la lógica ya la prueba test-rentabilidad-proyecto 22/0). Aquí, contra el servidor real:
//   [1] ASIGNAR proyecto DESDE PANTALLA: en el detalle de una factura de venta y de una factura recibida,
//       el selector "Proyecto" guarda (endpoint real). El PANEL de la ficha del proyecto muestra ingresos −
//       gastos = resultado. La COMPARATIVA marca en ROJO un proyecto con gastos > ingresos. 0 errores JS.
//   [2] PERMISOS (candado AND proyectos.read + P&G): sin uno de los dos, ni menú ni URL (403), API 403.
//
// NETO-CERO: crea una venta y un gasto reales, hace las comprobaciones, y luego los ANULA (la venta sale
// de Ventas; el gasto se reversa en el P&G). Comprueba que Ventas y el P&G total quedan EXACTAMENTE igual.
// Los documentos anulados permanecen en la cadena inmutable A PROPÓSITO (residuo neto-cero, como pieza 3).
//   node scripts/gate-rentabilidad-pantalla.mjs
import puppeteer from 'puppeteer';
import { launchOpts, APP_DIR } from './lib/gate-env.mjs';
import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync } from 'fs';
import bcrypt from 'bcrypt';
import { createInvoice, anularInvoice } from '../modules/erp/routes/invoices.js';
import { anularSupplierInvoiceSvc } from '../modules/erp/routes/supplier-invoices.js';
import { postSupplierInvoice } from '../modules/erp/contabilidad.js';
import { cuentaPyG } from '../modules/erp/contabilidad-pyg.js';
import { cruzar } from '../modules/erp/constructor-analitica.js';
import { randomBytes as __rb } from 'crypto';
// Identificador de ESTA pasada: los códigos de los proyectos de prueba lo llevan, porque
// `proyectos.codigo` es UNIQUE y un código fijo deja el gate muerto en cuanto una pasada cae
// a medias sin limpiar (pasó el 24 ago 2026).
const RID = __rb(3).toString('hex');
// Los códigos de los dos proyectos de prueba, en el ámbito del módulo: se usan al sembrar y al leer.
let COD_PG = '', COD_PP = '';

const BASE = 'http://desarrollo-bamburu.localhost:3000';
const HOST = 'desarrollo-bamburu.localhost';
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { if (c) { pass++; console.log('  ✓ ' + m + (extra ? ' — ' + extra : '')); } else { fail++; console.error('  ✗ FALLO: ' + m + (extra ? ' — ' + extra : '')); } };

const db = new Database(join(APP_DIR, 'data/tenants/desarrollo-bamburu.db'));
const SHOTS = join(process.env.HOME || '/home/ubuntu', 'rent-shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch {}
const tokens = [], emps = [];
let cliId = null, provId = null, PG = null, PP = null, fPG = null, gPP = null;
const HOY = new Date().toISOString().slice(0, 10);
const TODO = () => true;
const ventasBase = () => { const r = cruzar(db, { dimension: 'fecha', medidas: ['base'], hasPerm: TODO }); return Math.round(r.filas.reduce((a, f) => a + (Number(f.base) || 0), 0) * 100) / 100; };
const pygTotal = () => Math.round(cuentaPyG(db, '0001-01-01', '9999-12-31').resultadoEjercicio * 100) / 100;

function sesion(userId) {
  const tok = 'gate-rent-' + userId + '-' + Date.now() + '-' + Math.floor(performance.now());
  const ahora = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token, user_id, created_at, expires_at, csrf_token) VALUES (?,?,?,?,?)').run(tok, userId, ahora, ahora + 3600, 'csrf-' + tok);
  tokens.push(tok); return tok;
}
const darPerm = (uid, mod, act) => { const p = db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get(mod, act); if (p) db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(uid, p.id); };
function nuevoEmpleado(nombre, permisos) {
  const id = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES (?,?,?,'employee',1)")
    .run(nombre, 'gate-rent-' + Date.now() + '-' + emps.length + '@t.local', bcrypt.hashSync('Test1234!', 10)).lastInsertRowid;
  db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(id);
  for (const [m, a] of permisos) darPerm(id, m, a);
  emps.push(id); return id;
}
const call = (page, method, url) => page.evaluate(async (m, u) => {
  const r = await fetch(u, { method: m, cache: 'no-store', headers: { 'x-csrf-token': window.CSRF_TOKEN || '' } });
  return { status: r.status };
}, method, url);

let browser;
async function paginaDe(userId) {
  const ctx = await (browser.createBrowserContext ? browser.createBrowserContext() : browser.createIncognitoBrowserContext());
  const page = await ctx.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  page.on('dialog', d => d.accept().catch(() => {}));
  await page.setCookie({ name: 'asess', value: sesion(userId), domain: HOST, path: '/' });
  return page;
}

try {
  const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
  const ventasAntes = ventasBase(), pygAntes = pygTotal();

  cliId = db.prepare("INSERT INTO clients (name,fiscal_id,country,active) VALUES (?,?, 'ES',1)").run('GATE Rent Cliente', 'X7654321X').lastInsertRowid;
  provId = db.prepare("INSERT INTO suppliers (name,active) VALUES (?,1)").run('GATE Rent Proveedor').lastInsertRowid;
  // EL CÓDIGO DEL PROYECTO, ÚNICO POR PASADA. Era fijo ('GATE-PG'/'GATE-PP') y `proyectos.codigo`
  // tiene UNIQUE: en cuanto una pasada moría a medias sin limpiar, la siguiente NO PODÍA NI ARRANCAR
  // —«UNIQUE constraint failed»— y salía 0 OK · 1 fallo en un segundo. Pasó el 24 ago 2026 con este
  // gate y con gate-tiempo-pantalla. Un identificador fijo convierte cualquier caída en una avería
  // permanente.
  COD_PG = 'GATE-PG-' + RID; COD_PP = 'GATE-PP-' + RID;
  PG = db.prepare("INSERT INTO proyectos (codigo,nombre,cliente_id,modo_cobro,active) VALUES (?,?,?,'horas',1)").run(COD_PG, 'GATE Rent GANA ' + Date.now(), cliId).lastInsertRowid;
  PP = db.prepare("INSERT INTO proyectos (codigo,nombre,cliente_id,modo_cobro,active) VALUES (?,?,?,'horas',1)").run(COD_PP, 'GATE Rent PIERDE ' + Date.now(), cliId).lastInsertRowid;
  // Venta real 1000 (sin proyecto aún) y gasto real 500 (mercadería → 600, sin proyecto aún).
  fPG = createInvoice(db, { client_id: cliId, lines: [{ description: 'Servicio gate', quantity: 1, unit_price: 1000, tax_rate: 21 }], issue_date: HOY }).id;
  gPP = db.prepare("INSERT INTO supplier_invoices (supplier_id,invoice_date,base,tax,total,status) VALUES (?,?,?,?,?, 'vigente')").run(provId, HOY, 500, 105, 605).lastInsertRowid;
  postSupplierInvoice(db, gPP);

  browser = await puppeteer.launch(launchOpts());

  // ── [1] ASIGNAR DESDE PANTALLA + PANEL + COMPARATIVA ─────────────────────────
  console.log('\n[1] DUEÑO: asignar proyecto, panel y comparativa');
  const po = await paginaDe(owner.id);
  const errs = []; po.on('pageerror', e => errs.push(e.message));

  // (a) factura de VENTA → selector de proyecto en su detalle.
  await po.goto(BASE + '/admin/invoices/' + fPG, { waitUntil: 'networkidle2' });
  const haySelVenta = await po.$('#invProyecto').then(x => !!x).catch(() => false);
  ok(haySelVenta, 'el detalle de la factura de venta muestra el selector "Proyecto"');
  await po.select('#invProyecto', String(PG));
  await new Promise(r => setTimeout(r, 700));
  ok(db.prepare('SELECT project_id FROM invoices WHERE id=?').get(fPG).project_id === PG, 'asignar la venta a PG desde pantalla la etiqueta en BD');

  // (b) factura RECIBIDA → selector en su detalle.
  await po.goto(BASE + '/admin/supplier-invoices/' + gPP, { waitUntil: 'networkidle2' });
  const haySelGasto = await po.$('#siProyecto').then(x => !!x).catch(() => false);
  ok(haySelGasto, 'el detalle de la factura recibida muestra el selector "Proyecto"');
  await po.select('#siProyecto', String(PP));
  await new Promise(r => setTimeout(r, 700));
  ok(db.prepare('SELECT project_id FROM supplier_invoices WHERE id=?').get(gPP).project_id === PP, 'asignar el gasto a PP desde pantalla lo etiqueta en BD');

  // (c) PANEL en la ficha del proyecto PG (ingresos 1000, resultado 1000).
  await po.goto(BASE + '/admin/proyectos', { waitUntil: 'networkidle2' });
  await po.evaluate((id) => viewDetail(id), PG);
  await po.waitForFunction(() => { const b = document.getElementById('proyRent'); return b && /Resultado/.test(b.textContent); }, { timeout: 8000 }).catch(() => {});
  const panelTxt = await po.evaluate(() => document.getElementById('proyRent')?.textContent || '');
  ok(/Rentabilidad/.test(panelTxt) && /1000\.00/.test(panelTxt), 'la ficha de PG muestra el panel de rentabilidad con 1000,00', panelTxt.replace(/\s+/g, ' ').slice(0, 90));
  await po.screenshot({ path: join(SHOTS, 'rent-panel.png') }).catch(() => {});

  // (d) COMPARATIVA: PP en rojo (pierde), PG no.
  await po.goto(BASE + '/admin/rentabilidad', { waitUntil: 'networkidle2' });
  // Los códigos VIAJAN como parámetros: dentro de `evaluate` se ejecuta en el navegador, y allí no
  // existe ninguna variable de este fichero. (Antes iban como literales `'GATE-PP'`, que sí funcionaba
  // pero era un identificador FIJO y bloqueaba la pasada siguiente si esta moría a medias.)
  const cmp = await po.evaluate((codPG, codPP) => {
    const rows = [...document.querySelectorAll('table tbody tr')];
    const find = code => rows.find(r => r.textContent.includes(code));
    const rPP = find(codPP), rPG = find(codPG);
    return {
      ppPierde: !!(rPP && /pierde/i.test(rPP.textContent)),
      pgPierde: !!(rPG && /pierde/i.test(rPG.textContent)),
      hayTotal: rows.some(r => /TOTAL/.test(r.textContent)),
    };
  }, COD_PG, COD_PP);
  ok(cmp.ppPierde, 'la comparativa marca PP como que PIERDE (gastos > ingresos)');
  ok(!cmp.pgPierde, 'PG no aparece marcado como que pierde');
  ok(cmp.hayTotal, 'la comparativa muestra la fila TOTAL (= P&G de la empresa)');
  await po.screenshot({ path: join(SHOTS, 'rent-comparativa.png') }).catch(() => {});
  ok(errs.length === 0, 'las pantallas no lanzan errores de JS/CSP', errs.join(' | ') || 'limpio');

  // ── [2] PERMISOS (AND proyectos.read + invoices.read) ────────────────────────
  console.log('\n[2] PERMISOS (candado AND: proyectos.read + P&G/invoices.read)');
  const soloProy = nuevoEmpleado('Gate Rent SoloProy', [['proyectos', 'read']]);   // le falta invoices.read
  const pp1 = await paginaDe(soloProy);
  await pp1.goto(BASE + '/admin', { waitUntil: 'networkidle2' });
  const veNav1 = await pp1.$('a[href="/admin/rentabilidad"]').then(x => !!x).catch(() => false);
  ok(!veNav1, 'con solo proyectos.read: NO ve la entrada "Rentabilidad"');
  const r1 = await pp1.goto(BASE + '/admin/rentabilidad', { waitUntil: 'networkidle2' });
  ok(r1.status() === 403, 'con solo proyectos.read: /admin/rentabilidad → 403', String(r1.status()));
  await pp1.goto(BASE + '/admin', { waitUntil: 'networkidle2' });
  const api1 = await call(pp1, 'GET', '/api/erp/rentabilidad/comparativa');
  ok(api1.status === 403, 'con solo proyectos.read: API comparativa → 403', String(api1.status));

  const soloInv = nuevoEmpleado('Gate Rent SoloInv', [['invoices', 'read']]);   // le falta proyectos.read
  const pp2 = await paginaDe(soloInv);
  const r2 = await pp2.goto(BASE + '/admin/rentabilidad', { waitUntil: 'networkidle2' });
  ok(r2.status() === 403, 'con solo invoices.read (sin proyectos.read): /admin/rentabilidad → 403', String(r2.status()));

  await browser.close();

  // ── [3] NETO-CERO: anular y comprobar Ventas + P&G intactos ──────────────────
  console.log('\n[3] NETO-CERO');
  anularInvoice(db, fPG, 'Gate rentabilidad — limpieza');
  anularSupplierInvoiceSvc(db, gPP, 'Gate rentabilidad — limpieza');
  const ventasDespues = ventasBase(), pygDespues = pygTotal();
  ok(Math.abs(ventasDespues - ventasAntes) < 0.005, 'Ventas queda EXACTAMENTE igual (neto-cero)', ventasAntes + ' → ' + ventasDespues);
  ok(Math.abs(pygDespues - pygAntes) < 0.005, 'el P&G total queda EXACTAMENTE igual (neto-cero)', pygAntes + ' → ' + pygDespues);
} catch (e) {
  console.error('ERROR', e.stack || e.message); fail++;
  try { await browser.close(); } catch {}
} finally {
  for (const t of tokens) { try { db.prepare('DELETE FROM admin_sessions WHERE token=?').run(t); } catch {} }
  for (const id of emps) { try { db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(id); } catch {} try { db.prepare('DELETE FROM admin_users WHERE id=?').run(id); } catch {} }
  // Los proyectos de prueba se borran; las facturas anuladas (venta + gasto) y el cliente/proveedor
  // PERMANECEN a propósito (cadena inmutable, neto-cero en Ventas y P&G) — residuo esperado.
  try { if (PG) db.prepare('DELETE FROM proyectos WHERE id=?').run(PG); } catch {}
  try { if (PP) db.prepare('DELETE FROM proyectos WHERE id=?').run(PP); } catch {}
  db.close();
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===  (capturas en ' + SHOTS + ')');
process.exit(fail ? 1 : 0);
