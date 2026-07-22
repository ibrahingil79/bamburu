// COSTE DE LAS HORAS · Escalera paso 7 · PIEZA 4 (parte 2) — Gate de NAVEGADOR contra el servidor real.
//
// QUÉ MIDE (la lógica ya la prueba test-coste-horas-proyecto 28/0). Aquí, contra el servidor real:
//   [1] CASCADA en la ficha del proyecto: Resultado CONTABLE − Coste de las horas = Resultado de GESTIÓN,
//       con el aviso honesto ("NO es el resultado contable; tu P&G no cambia") y el aviso de horas SIN coste.
//   [2] COMPARATIVA /admin/rentabilidad: columnas nuevas "Coste horas" y "Resultado gestión" + aviso agregado
//       de horas sin coste. 0 errores JS.
//   [3] PERMISOS: editar el coste-hora exige admin.manage_users (sin él, API de Usuarios 403 y no se ve el
//       coste por persona); el coste-hora congelado NO se filtra por la API de tiempo (tiempo.read).
//
// NETO-CERO: crea una venta real (etiquetada al proyecto) y entradas de tiempo; comprueba; y luego ANULA la
// venta y BORRA las entradas de prueba (time_entries NO es cadena legal). El coste-hora se pone en empleados
// de PRUEBA que se borran: ningún usuario real se toca. Ventas y P&G total quedan EXACTAMENTE igual.
//   node scripts/gate-coste-horas-pantalla.mjs
import puppeteer from 'puppeteer';
import { launchOpts, APP_DIR } from './lib/gate-env.mjs';
import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync } from 'fs';
import bcrypt from 'bcrypt';
import { createInvoice, anularInvoice } from '../modules/erp/routes/invoices.js';
import { createEntry } from '../modules/erp/routes/tiempo.js';
import { cuentaPyG } from '../modules/erp/contabilidad-pyg.js';
import { cruzar } from '../modules/erp/constructor-analitica.js';

const BASE = 'http://desarrollo-bamburu.localhost:3000';
const HOST = 'desarrollo-bamburu.localhost';
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { if (c) { pass++; console.log('  ✓ ' + m + (extra ? ' — ' + extra : '')); } else { fail++; console.error('  ✗ FALLO: ' + m + (extra ? ' — ' + extra : '')); } };

const db = new Database(join(APP_DIR, 'data/tenants/desarrollo-bamburu.db'));
const SHOTS = join(process.env.HOME || '/home/ubuntu', 'coste-shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch {}
const tokens = [], emps = [];
let cliId = null, PC = null, fVenta = null;
const HOY = new Date().toISOString().slice(0, 10);
const TODO = () => true;
const ventasBase = () => { const r = cruzar(db, { dimension: 'fecha', medidas: ['base'], hasPerm: TODO }); return Math.round(r.filas.reduce((a, f) => a + (Number(f.base) || 0), 0) * 100) / 100; };
const pygTotal = () => Math.round(cuentaPyG(db, '0001-01-01', '9999-12-31').resultadoEjercicio * 100) / 100;

function sesion(userId) {
  const tok = 'gate-ch-' + userId + '-' + Date.now() + '-' + Math.floor(performance.now());
  const ahora = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token, user_id, created_at, expires_at, csrf_token) VALUES (?,?,?,?,?)').run(tok, userId, ahora, ahora + 3600, 'csrf-' + tok);
  tokens.push(tok); return tok;
}
const darPerm = (uid, mod, act) => { const p = db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get(mod, act); if (p) db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(uid, p.id); };
function nuevoEmpleado(nombre, permisos, coste = null) {
  const id = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active,coste_hora) VALUES (?,?,?,'employee',1,?)")
    .run(nombre, 'gate-ch-' + Date.now() + '-' + emps.length + '@t.local', bcrypt.hashSync('Test1234!', 10), coste).lastInsertRowid;
  db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(id);
  for (const [m, a] of permisos) darPerm(id, m, a);
  emps.push(id); return id;
}
const call = (page, method, url, body) => page.evaluate(async (m, u, b) => {
  const opt = { method: m, cache: 'no-store', headers: { 'x-csrf-token': window.CSRF_TOKEN || '' } };
  if (b) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(b); }
  const r = await fetch(u, opt);
  let txt = ''; try { txt = await r.text(); } catch {}
  return { status: r.status, txt };
}, method, url, body || null);

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

  cliId = db.prepare("INSERT INTO clients (name,fiscal_id,country,active) VALUES (?,?, 'ES',1)").run('GATE Coste Cliente', 'X1122334X').lastInsertRowid;
  PC = db.prepare("INSERT INTO proyectos (codigo,nombre,cliente_id,modo_cobro,tarifa_hora,active) VALUES ('GATE-CH',?,?,'horas',60,1)").run('GATE Coste Horas ' + Date.now(), cliId).lastInsertRowid;
  // Venta real 1000 etiquetada al proyecto → resultado CONTABLE = 1000 (sin gastos).
  fVenta = createInvoice(db, { client_id: cliId, lines: [{ description: 'Servicio gate coste', quantity: 1, unit_price: 1000, tax_rate: 21 }], issue_date: HOY }).id;
  db.prepare('UPDATE invoices SET project_id=? WHERE id=?').run(PC, fVenta);
  // Empleados de PRUEBA: E1 con coste 30/h, E2 SIN coste. Sus horas se congelan al crearse.
  const E1 = nuevoEmpleado('Gate Coste ConCoste', [], 30);
  const E2 = nuevoEmpleado('Gate Coste SinCoste', [], null);
  createEntry(db, E1, { proyecto_id: PC, descripcion: 'con coste', fecha: HOY, horas: 10, minutos: 0, facturable: true });   // 10 × 30 = 300
  createEntry(db, E2, { proyecto_id: PC, descripcion: 'sin coste', fecha: HOY, horas: 4, minutos: 0, facturable: true });    // 4 h fuera

  browser = await puppeteer.launch(launchOpts());

  // ── [1] CASCADA en la ficha del proyecto ─────────────────────────────────────
  console.log('\n[1] DUEÑO: cascada contable → coste horas → gestión en la ficha');
  const po = await paginaDe(owner.id);
  const errs = []; po.on('pageerror', e => errs.push(e.message));
  await po.goto(BASE + '/admin/proyectos', { waitUntil: 'networkidle2' });
  await po.evaluate((id) => viewDetail(id), PC);
  await po.waitForFunction(() => { const b = document.getElementById('proyRent'); return b && /Resultado de gesti/i.test(b.textContent); }, { timeout: 8000 }).catch(() => {});
  const panel = await po.evaluate(() => (document.getElementById('proyRent')?.textContent || '').replace(/\s+/g, ' '));
  ok(/Resultado contable/i.test(panel) && /1000\.00/.test(panel), 'la ficha muestra Resultado CONTABLE = 1000,00');
  ok(/Coste de las horas/i.test(panel) && /300\.00/.test(panel), 'la ficha muestra Coste de las horas = 300,00 (10 h × 30)');
  ok(/Resultado de gesti/i.test(panel) && /700\.00/.test(panel), 'la ficha muestra Resultado de GESTIÓN = 700,00 (1000 − 300)');
  ok(/sin coste-hora registrado/i.test(panel) && /4\.00 h/.test(panel), 'la ficha AVISA de 4,00 h sin coste-hora (fuera del coste, no es 0)');
  ok(/no es el resultado contable/i.test(panel) && /P&G no cambia/i.test(panel), 'la ficha lleva el aviso honesto (gestión ≠ contable; el P&G no cambia)');
  await po.screenshot({ path: join(SHOTS, 'coste-panel.png') }).catch(() => {});

  // ── [2] COMPARATIVA con columnas nuevas ──────────────────────────────────────
  console.log('\n[2] COMPARATIVA /admin/rentabilidad');
  await po.goto(BASE + '/admin/rentabilidad', { waitUntil: 'networkidle2' });
  const cmp = await po.evaluate(() => {
    const heads = [...document.querySelectorAll('table thead th')].map(t => t.textContent.trim());
    const rows = [...document.querySelectorAll('table tbody tr')];
    const rPC = rows.find(r => r.textContent.includes('GATE-CH'));
    return {
      heads,
      pcTxt: rPC ? rPC.textContent.replace(/\s+/g, ' ') : '',
      avisoHoras: /sin coste-hora registrado/i.test(document.body.textContent),
      gestionExplicada: /resultado de gesti/i.test(document.body.textContent) && /no entra en el P&G/i.test(document.body.textContent),
    };
  });
  ok(cmp.heads.some(h => /Coste horas/i.test(h)), 'la comparativa tiene la columna "Coste horas"', cmp.heads.join(' | '));
  ok(cmp.heads.some(h => /Resultado gesti/i.test(h)), 'la comparativa tiene la columna "Resultado gestión"');
  ok(/300\.00/.test(cmp.pcTxt) && /700\.00/.test(cmp.pcTxt), 'la fila del proyecto muestra coste 300,00 y gestión 700,00', cmp.pcTxt.slice(0, 120));
  ok(cmp.avisoHoras, 'la comparativa avisa (agregado) de horas sin coste-hora');
  ok(cmp.gestionExplicada, 'la comparativa explica que el coste de horas NO entra en el P&G (capa de gestión)');
  await po.screenshot({ path: join(SHOTS, 'coste-comparativa.png') }).catch(() => {});
  ok(errs.length === 0, 'las pantallas no lanzan errores de JS/CSP', errs.join(' | ') || 'limpio');

  // ── [3] PERMISOS: editar coste-hora exige admin.manage_users ─────────────────
  console.log('\n[3] PERMISOS del coste-hora');
  // E3 ve el panel (proyectos+invoices+tiempo) pero NO gestiona usuarios: no edita ni ve el coste por persona.
  const E3 = nuevoEmpleado('Gate Coste SinUsuarios', [['proyectos', 'read'], ['invoices', 'read'], ['tiempo', 'read']]);
  const pe = await paginaDe(E3);
  await pe.goto(BASE + '/admin', { waitUntil: 'networkidle2' });
  const gUsers = await call(pe, 'GET', '/api/erp/users');
  ok(gUsers.status === 403, 'sin admin.manage_users: la API de Usuarios (coste por persona) → 403', String(gUsers.status));
  const putCoste = await call(pe, 'PUT', '/api/erp/users/' + emps[0], { name: 'x', email: 'x@t.local', role: 'employee', active: true, coste_hora: 999 });
  ok(putCoste.status === 403, 'sin admin.manage_users: editar el coste-hora → 403', String(putCoste.status));
  ok(db.prepare('SELECT coste_hora FROM admin_users WHERE id=?').get(emps[0]).coste_hora === 30, 'el coste-hora NO se modificó (sigue 30)');
  // El coste-hora congelado NO se filtra por la API de tiempo (que solo pide tiempo.read).
  const gTiempo = await call(pe, 'GET', '/api/erp/tiempo/proyecto/' + PC);
  ok(gTiempo.status === 200 && !/coste_hora_congelado|coste_hora/.test(gTiempo.txt), 'la API de tiempo NO expone el coste-hora congelado', String(gTiempo.status));

  await browser.close();

  // ── [4] NETO-CERO ────────────────────────────────────────────────────────────
  console.log('\n[4] NETO-CERO');
  db.prepare('DELETE FROM time_entries WHERE proyecto_id=?').run(PC);   // entradas de prueba (no es cadena legal)
  anularInvoice(db, fVenta, 'Gate coste horas — limpieza');
  const ventasDespues = ventasBase(), pygDespues = pygTotal();
  ok(Math.abs(ventasDespues - ventasAntes) < 0.005, 'Ventas queda EXACTAMENTE igual (neto-cero)', ventasAntes + ' → ' + ventasDespues);
  ok(Math.abs(pygDespues - pygAntes) < 0.005, 'el P&G total queda EXACTAMENTE igual (neto-cero)', pygAntes + ' → ' + pygDespues);
} catch (e) {
  console.error('ERROR', e.stack || e.message); fail++;
  try { await browser.close(); } catch {}
} finally {
  for (const t of tokens) { try { db.prepare('DELETE FROM admin_sessions WHERE token=?').run(t); } catch {} }
  for (const id of emps) { try { db.prepare('DELETE FROM time_entries WHERE user_id=?').run(id); } catch {} try { db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(id); } catch {} try { db.prepare('DELETE FROM admin_users WHERE id=?').run(id); } catch {} }
  // La factura anulada y el cliente PERMANECEN a propósito (cadena inmutable, neto-cero). El proyecto de prueba se borra.
  try { if (PC) db.prepare('DELETE FROM time_entries WHERE proyecto_id=?').run(PC); } catch {}
  try { if (PC) db.prepare('DELETE FROM proyectos WHERE id=?').run(PC); } catch {}
  db.close();
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===  (capturas en ' + SHOTS + ')');
process.exit(fail ? 1 : 0);
