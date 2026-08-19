// Gate — FICHA DE CLIENTE 360. Tarea TRANSVERSAL (el puntero de la escalera NO se mueve).
//
// LA REGLA QUE MANDA: cero cálculos paralelos. Cada cifra de la ficha tiene que CUADRAR AL CÉNTIMO
// con la pantalla de la que salió — si la ficha y Cobros dicen dos deudas distintas, una miente, y
// el dueño no sabe cuál. Por eso casi todo este gate es "esto = aquello", no "esto existe".
//
//   node scripts/gate-cliente-360.mjs
import puppeteer from 'puppeteer';
import path from 'path';
import { unlinkSync } from 'fs';
import { randomBytes } from 'crypto';
import Database from 'better-sqlite3';
import { launchOpts } from './lib/gate-env.mjs';
import { controlDb, getTenantBySlug } from '../core/control-db.js';
import { provisionTenant } from '../core/tenant-provisioning.js';
import { fijarOficio, sembrarCatalogo } from '../modules/erp/oficios.js';
import { createProductSvc } from '../modules/erp/routes/products.js';
import { ahoraLocal } from '../modules/erp/citas-engine.js';
import { clientDebt } from '../modules/erp/cobros.js';
import { ventasPorCliente } from '../modules/erp/ventas-metrics.js';
import { clientesFueraDeRitmo } from '../modules/erp/vigia-agenda.js';
import { ritmoDelCliente } from '../modules/erp/cliente-360.js';

const RID = randomBytes(3).toString('hex');
const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const HOY = ahoraLocal().fecha;
const dormir = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { if (c) { pass++; console.log('  ✓ ' + m + (x ? ' — ' + x : '')); } else { fail++; console.error('  ✗ FALLO: ' + m + (x ? ' — ' + x : '')); } };
let slug = null, db = null, browser = null;
function limpiar() {
  try { if (db) db.close(); } catch {}
  if (!slug) return;
  const t = getTenantBySlug(slug);
  if (t) controlDb.prepare('DELETE FROM tenant_sessions WHERE tenant_id=?').run(t.id);
  controlDb.prepare('DELETE FROM tenants WHERE slug=?').run(slug);
  if (t) { const abs = path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP, t.db_filename);
    for (const f of [abs, abs + '-wal', abs + '-shm']) { try { unlinkSync(f); } catch {} } }
}
const dias = n => new Date(Date.parse(HOY + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

try {
  console.log('\n[0] DE CERO — negocio, oficio, cliente y su historia');
  const alta = await provisionTenant({ businessName: 'Gate 360 ' + RID, ownerName: 'Dueña Gate',
    email: 'gate360-' + RID + '@bamburu.test', password: 'Gate.360.' + RID + '!', phone: '+34 600 000 000' });
  slug = alta.slug;
  const t = getTenantBySlug(slug);
  ok(!!t, 'negocio creado desde cero', slug);
  db = new Database(path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP, t.db_filename));
  const BASE = 'http://' + slug + '.localhost:3000';
  fijarOficio(db, 'peluqueria');
  sembrarCatalogo(db, 'peluqueria', (d, i) => createProductSvc(d, i));
  const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner'").get();
  const insT = db.prepare("INSERT INTO horario_tramos (scope,user_id,dow,inicio_min,fin_min) VALUES ('negocio',NULL,?,?,?)");
  for (let d = 0; d <= 6; d++) insT.run(d, 9 * 60, 20 * 60);
  const CLI = db.prepare("INSERT INTO clients (name,email,active,created_at) VALUES ('Marta Larga',?,1,datetime('now'))")
    .run('marta-' + RID + '@bamburu.test').lastInsertRowid;
  const OTRO = db.prepare("INSERT INTO clients (name,active,created_at) VALUES ('Nadie Nuevo',1,datetime('now'))").run().lastInsertRowid;
  const svc = db.prepare("SELECT p.id FROM products p JOIN service_config sc ON sc.product_id=p.id WHERE sc.reservable=1 LIMIT 1").get();

  const now = Math.floor(Date.now() / 1000);
  const sesion = uid => { const tok = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
      .run(tok, uid, now, now + 3600, randomBytes(32).toString('base64url')); return tok; };

  browser = await puppeteer.launch(launchOpts());
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));
  await page.setViewport({ width: 1400, height: 1000 });
  await page.setCookie({ name: 'asess', value: sesion(owner.id), domain: slug + '.localhost', path: '/' });
  const api = (m, u, b) => page.evaluate(async (m, u, b) => {
    try { return await window.api(m, u, b); } catch (e) { return { __err: e.message }; }
  }, m, u, b);
  const irFicha = async (id) => { await page.goto(BASE + '/admin/clients/' + id, { waitUntil: 'networkidle0' }); await dormir(900); };

  // ── HISTORIA DEL CLIENTE: facturas, cobro, citas ─────────────────────────────────────────────
  await irFicha(CLI);
  const fac = async (n, importe, fecha) => api('POST', '/api/erp/invoices', {
    client_id: CLI, issue_date: fecha, lines: [{ description: 'Corte y color', quantity: 1, unit_price: importe, tax_rate: 21 }] });
  const f1 = await fac(1, 100, dias(-120));
  const f2 = await fac(2, 200, dias(-40));
  const f3 = await fac(3, 50, dias(-10));
  const ids = db.prepare('SELECT id, invoice_number, total FROM invoices WHERE client_id=? ORDER BY id').all(CLI);
  ok(ids.length === 3, 'tres facturas creadas para el cliente', ids.map(i => i.invoice_number).join(' '));
  // Citas: cuatro atendidas espaciadas para que HAYA ritmo, más una anulada y un plantón.
  const insC = db.prepare("INSERT INTO citas (codigo,cliente_id,user_id,fecha,inicio_min,dur_min,margen_min,estado,created_at,updated_at) VALUES (?,?,?,?,?,30,0,?,datetime('now'),datetime('now'))");
  // Espaciadas 30 días y la última hace 60: ritmo 30, umbral 45 → el detector de enfriamiento SALTA.
  // Si no saltara, el criterio 11 compararía "0 avisos = 0 avisos", que no prueba nada.
  [[-150, 'atendida'], [-120, 'atendida'], [-90, 'atendida'], [-60, 'atendida'], [-20, 'anulada'], [-15, 'no_show']]
    .forEach(([d, e], i) => insC.run('CITA-G' + RID + i, CLI, owner.id, dias(d), 600 + i * 30, e));
  ok(db.prepare('SELECT COUNT(*) n FROM citas WHERE cliente_id=?').get(CLI).n === 6, 'seis citas: cuatro atendidas, una anulada y un plantón');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] CADA CIFRA CUADRA CON SU PANTALLA DE ORIGEN');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  await api('POST', '/api/erp/invoices/' + ids[0].id + '/payments', { amount: 40, payment_method: 'efectivo' });
  await irFicha(CLI);
  let D = await api('GET', '/api/erp/clients/' + CLI + '/360');
  const deudaMotor = clientDebt(db, CLI, HOY);
  ok(Math.abs(D.cabecera.deuda.total - deudaMotor.total) < 0.005,
     'la deuda de la ficha es AL CÉNTIMO la del motor de cobros', D.cabecera.deuda.total + ' = ' + deudaMotor.total);
  const vpc = ventasPorCliente(db, {}).find(v => v.client_id === CLI);
  ok(vpc && Math.abs(D.cabecera.gasto.total - vpc.base) < 0.005,
     'el gasto total es AL CÉNTIMO el del informe de ventas por cliente', D.cabecera.gasto.total + ' = ' + (vpc && vpc.base));
  ok(Math.abs(D.cabecera.ticket_medio - (vpc.base / vpc.facturas)) < 0.02,
     'y el ticket medio es ese gasto entre sus facturas', D.cabecera.ticket_medio + '');

  // ── [2] El ritmo es EXACTAMENTE el del detector de enfriamiento ───────────────────────────────
  const rf = ritmoDelCliente(db, CLI);
  ok(D.cabecera.ritmo.ritmo_dias === rf.ritmo_dias && rf.ritmo_dias != null,
     'el ritmo de la ficha sale del mismo cálculo que el detector de enfriamiento', 'cada ' + rf.ritmo_dias + ' días');
  // Y se contrasta con el detector de verdad, que es OTRO camino de código para el mismo número.
  const delVigia = clientesFueraDeRitmo(db, dias(200)).find(x => x.client_id === CLI);
  ok(!delVigia || delVigia.ritmo_dias === D.cabecera.ritmo.ritmo_dias,
     'y coincide con el ritmo que el propio vigía usa para avisar', delVigia ? delVigia.ritmo_dias + '' : '(el vigía aún no avisa)');

  // ── [3] Sin coste → margen «—», nunca 0 ni 100% ───────────────────────────────────────────────
  const sinCoste = db.prepare('SELECT COUNT(*) n FROM invoice_items it JOIN invoices i ON i.id=it.invoice_id WHERE i.client_id=? AND (it.unit_cost IS NULL OR it.unit_cost=0)').get(CLI).n;
  ok(sinCoste > 0, 'sus líneas no tienen coste conocido', sinCoste + ' líneas');
  // `hay:false` es la forma que tiene el motor único de decir "ninguna línea con coste conocido":
  // los dos porcentajes a null y el beneficio a null. Nunca 0, nunca 100 %.
  ok(D.cabecera.margen && D.cabecera.margen.hay === false
     && D.cabecera.margen.euros === null && D.cabecera.margen.pctVenta === null && D.cabecera.margen.pctCoste === null,
     'el margen sale «—» y NO 0 ni 100%', JSON.stringify(D.cabecera.margen));
  const pintado = await page.evaluate(() => [...document.querySelectorAll('.bf-card')]
    .filter(c => /margen/i.test(c.querySelector('.bf-k').textContent)).map(c => c.querySelector('.bf-v').textContent)[0]);
  ok(pintado === '—', 'y en pantalla se ve «—»', pintado);

  // ── [4] Factura, cobro, cita y nota: los cuatro en la línea de tiempo ─────────────────────────
  await api('POST', '/api/erp/clients/' + CLI + '/notas', { texto: 'Prefiere media melena, viene los viernes' });
  const tl = await api('GET', '/api/erp/clients/' + CLI + '/360/timeline?cuantos=100');
  const kinds = new Set((tl.eventos || []).map(e => e.kind));
  ok(kinds.has('documento') && kinds.has('cobro') && kinds.has('cita') && kinds.has('nota'),
     'factura, cobro, cita y nota aparecen los cuatro en la línea de tiempo', [...kinds].join(', '));
  const fechas = (tl.eventos || []).map(e => String(e.ts || '').replace(' ', 'T'));
  ok(fechas.every((f, i) => i === 0 || fechas[i - 1] >= f), 'y en orden, lo más reciente arriba');

  // ── [5] Factura anulada: SALE marcada y NO suma ───────────────────────────────────────────────
  const antesGasto = D.cabecera.gasto.total;
  await api('POST', '/api/erp/invoices/' + ids[2].id + '/anular', { motivo: 'prueba del gate' });
  await irFicha(CLI);
  D = await api('GET', '/api/erp/clients/' + CLI + '/360');
  const tl2 = await api('GET', '/api/erp/clients/' + CLI + '/360/timeline?cuantos=100');
  const anulada = (tl2.eventos || []).find(e => (e.title || '').includes(ids[2].invoice_number));
  ok(!!anulada && /anulada/i.test(anulada.detail || ''), 'la factura anulada SIGUE en la línea de tiempo, marcada', anulada && anulada.detail);
  ok(D.cabecera.gasto.total < antesGasto, 'y ya NO suma en el gasto', antesGasto + ' → ' + D.cabecera.gasto.total);
  const vpc2 = ventasPorCliente(db, {}).find(v => v.client_id === CLI);
  ok(Math.abs(D.cabecera.gasto.total - vpc2.base) < 0.005, 'y sigue cuadrando con el informe de ventas', D.cabecera.gasto.total + ' = ' + vpc2.base);

  // ── [6] Venta de mostrador sin cliente: en la ficha de nadie ──────────────────────────────────
  // La venta de MOSTRADOR va por su propia puerta (la factura exige cliente): es el ticket del TPV,
  // que nace sin cliente. Es justo el caso que no puede colarse en la ficha de nadie.
  const svcProd = db.prepare("SELECT id FROM products WHERE type='service' LIMIT 1").get();
  await api('POST', '/api/erp/mostrador/sale', { payment_method: 'efectivo',
    lines: [{ product_id: svcProd.id, quantity: 1, unit_price: 30 }] });
  const sinCli = db.prepare('SELECT COUNT(*) n FROM invoices WHERE client_id IS NULL').get().n;
  const D2 = await api('GET', '/api/erp/clients/' + OTRO + '/360');
  ok(sinCli > 0, 'hay una venta de mostrador SIN cliente', sinCli + '');
  ok(D2.cabecera.gasto.total === 0 && D2.cabecera.desde.fecha === null,
     'y no aparece en la ficha de nadie', JSON.stringify(D2.cabecera.gasto));

  // ── [12] Cliente recién creado y vacío: la pantalla NO se queda en blanco ─────────────────────
  await irFicha(OTRO);
  const vacio = await page.evaluate(() => ({
    cifras: [...document.querySelectorAll('.bf-card')].map(c => c.querySelector('.bf-v').textContent
      + ' / ' + (c.querySelector('.bf-s') ? c.querySelector('.bf-s').textContent : '')),
    tl: document.getElementById('f360tl').textContent.trim(),
  }));
  ok(vacio.cifras.some(v => /Aún no te ha comprado/i.test(v)), 'un cliente sin nada dice «Aún no te ha comprado», no un 0', vacio.cifras[0]);
  ok(vacio.tl.length > 20 && !/^\s*$/.test(vacio.tl), 'y la línea de tiempo explica qué falta, no queda en blanco', vacio.tl.slice(0, 60));

  // ── [9] Cada contador coincide con las filas de su lista ──────────────────────────────────────
  await irFicha(CLI);
  D = await api('GET', '/api/erp/clients/' + CLI + '/360');
  const cnt = Object.fromEntries(D.contadores.map(x => [x.key, x.n]));
  ok(cnt.citas === db.prepare('SELECT COUNT(*) n FROM citas WHERE cliente_id=? AND archived=0').get(CLI).n, 'el contador de citas coincide', cnt.citas + '');
  ok(cnt.facturas === db.prepare('SELECT COUNT(*) n FROM invoices WHERE client_id=?').get(CLI).n, 'el de facturas coincide', cnt.facturas + '');
  ok(cnt.proyectos === db.prepare('SELECT COUNT(*) n FROM proyectos WHERE cliente_id=? AND active=1').get(CLI).n, 'el de proyectos coincide', cnt.proyectos + '');
  ok(D.contadores.some(x => x.key === 'oportunidades' && x.n === 0), 'y los que están a 0 se enseñan igual, no se esconden');

  // ── [10] Notas: crear, editar, borrar · fuera de WRITABLE_TABLES ──────────────────────────────
  const n1 = await api('POST', '/api/erp/clients/' + CLI + '/notas', { texto: 'Segunda nota' });
  await api('PUT', '/api/erp/clients/' + CLI + '/notas/' + n1.id, { texto: 'Segunda nota, corregida' });
  let notas = await api('GET', '/api/erp/clients/' + CLI + '/notas');
  ok(notas.some(n => n.texto === 'Segunda nota, corregida' && n.updated_at), 'una nota se crea y se edita, con autor y fecha', notas[0].user_name || '(sin autor)');
  await api('DELETE', '/api/erp/clients/' + CLI + '/notas/' + n1.id);
  notas = await api('GET', '/api/erp/clients/' + CLI + '/notas');
  ok(!notas.some(n => n.id === n1.id), 'y se quita de la vista');
  ok(db.prepare('SELECT active FROM client_notes WHERE id=?').get(n1.id).active === 0, 'pero se ARCHIVA, no se destruye (regla permanente)');
  const disaSrc = (await import('fs')).readFileSync(path.join(APP, 'modules/disa/index.js'), 'utf8');
  const bloque = disaSrc.slice(disaSrc.indexOf('WRITABLE_TABLES = new Set('), disaSrc.indexOf('WRITABLE_TABLES = new Set(') + 2000);
  ok(!/'client_notes'/.test(bloque), 'client_notes NO está en las tablas que DISA puede escribir');
  // La nota de siempre (el campo del cliente) sigue intacta.
  db.prepare("UPDATE clients SET notes='Nota de toda la vida' WHERE id=?").run(CLI);
  await irFicha(CLI);
  ok(await page.evaluate(() => /Nota de toda la vida/.test(document.getElementById('f360notaFija').textContent)),
     'y la nota de texto libre que ya existía sigue en su sitio, sin migrar ni pisar');

  // ── [11] Los avisos de DISA de la ficha son los del vigía ─────────────────────────────────────
  const { detectar } = await import('../modules/erp/vigia.js');
  const delMotor = (detectar(db, { hoy: HOY }).hallazgos || []).filter(h => Number(h?.ref?.client_id) === Number(CLI));
  D = await api('GET', '/api/erp/clients/' + CLI + '/360');
  const enFicha = D.disa || [];
  ok(delMotor.length > 0, 'el vigía tiene algo que decir de este cliente (si no, la prueba no probaría nada)',
     delMotor.map(h => h.detector).join(', '));
  ok(enFicha.length === delMotor.length, 'la ficha enseña los MISMOS avisos que el vigía para este cliente',
     enFicha.length + ' = ' + delMotor.length);
  ok(delMotor.every(h => enFicha.some(x => x.detector === h.detector && x.titulo === (h.titulo || ''))),
     'con el mismo detector y el mismo texto, sin recalcular nada',
     delMotor.map(h => h.detector).join(', ') || '(ninguno hoy)');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] PERMISOS — el filtro es del SERVIDOR, no del navegador');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const empleado = (nombre, permisos) => {
    const uid = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active,must_change_password,created_at) VALUES (?,?,'x','employee',1,0,datetime('now'))")
      .run(nombre, nombre.replace(/\W/g, '') + RID + '@bamburu.test').lastInsertRowid;
    for (const [mod, acc] of permisos) {
      const p = db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get(mod, acc);
      if (p) db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id,permission_id) VALUES (?,?)').run(uid, p.id);
    }
    return uid;
  };
  // [7] Ve clientes, NO ve facturas.
  const ctx1 = await browser.createBrowserContext();
  const p1 = await ctx1.newPage();
  const errs1 = []; p1.on('pageerror', e => errs1.push(String(e.message || e)));
  await p1.setViewport({ width: 1400, height: 1000 });
  const sinFacturas = empleado('Sin Facturas', [['clients', 'read'], ['citas', 'read']]);
  await p1.setCookie({ name: 'asess', value: sesion(sinFacturas), domain: slug + '.localhost', path: '/' });
  await p1.goto(BASE + '/admin/clients/' + CLI, { waitUntil: 'networkidle0' });
  await dormir(900);
  const v1 = await p1.evaluate(() => ({
    entra: !!document.getElementById('f360resumen'),
    textos: [...document.querySelectorAll('.bf-card .bf-k')].map(k => k.textContent),
    conts: [...document.querySelectorAll('.bf-chips a')].map(a => a.textContent.trim()),
    cuerpo: document.body.textContent,
  }));
  ok(v1.entra, 'quien ve clientes pero no facturas ENTRA en la ficha');
  ok(!v1.textos.some(t => /gasto|te debe|margen|ticket/i.test(t)), 'y NO ve ni una cifra de dinero', v1.textos.join(' · '));
  ok(!v1.conts.some(x => /factura|deuda/i.test(x)), 'ni el contador de facturas ni el de deuda', v1.conts.join(' · '));
  const rAmano = await p1.evaluate(async (id) => {
    const r = await fetch('/api/erp/invoices?cliente=' + id); return r.status;
  }, CLI);
  ok(rAmano === 403, 'y pedir facturas a mano da 403, no una lista', 'HTTP ' + rAmano);
  const tl1 = await p1.evaluate(async id => (await (await fetch('/api/erp/clients/' + id + '/360/timeline?cuantos=100')).json()), CLI);
  ok(!(tl1.eventos || []).some(e => e.kind === 'documento' || e.kind === 'cobro'),
     'y su línea de tiempo no trae facturas ni cobros: no llegan, no es que se escondan',
     [...new Set((tl1.eventos || []).map(e => e.kind))].join(', '));
  // [8] Lo mismo sin permiso de citas.
  const sinCitas = empleado('Sin Citas', [['clients', 'read'], ['invoices', 'read']]);
  const p2 = await ctx1.newPage();
  await p2.setViewport({ width: 1400, height: 1000 });
  await p2.setCookie({ name: 'asess', value: sesion(sinCitas), domain: slug + '.localhost', path: '/' });
  await p2.goto(BASE + '/admin/clients/' + CLI, { waitUntil: 'networkidle0' });
  await dormir(900);
  const v2 = await p2.evaluate(async id => {
    const tl = await (await fetch('/api/erp/clients/' + id + '/360/timeline?cuantos=100')).json();
    return { conts: [...document.querySelectorAll('.bf-chips a')].map(a => a.textContent.trim()),
             kinds: [...new Set((tl.eventos || []).map(e => e.kind))],
             ritmo: [...document.querySelectorAll('.bf-card .bf-k')].map(k => k.textContent) };
  }, CLI);
  ok(!v2.conts.some(x => /cita/i.test(x)), 'sin permiso de citas no hay contador de citas', v2.conts.join(' · '));
  ok(!v2.kinds.includes('cita'), 'ni citas en su línea de tiempo', v2.kinds.join(', '));
  ok(!v2.ritmo.some(k => /cada cuánto/i.test(k)), 'ni el «cada cuánto viene», que sale de la agenda');
  await ctx1.close();

  // ── [13] NETO-CERO ────────────────────────────────────────────────────────────────────────────
  console.log('\n[3] NETO-CERO Y PANTALLA');
  const foto = () => JSON.stringify({
    ventas: db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) t FROM invoices WHERE status<>'anulada'").get(),
    hashes: db.prepare('SELECT COUNT(*) n, COALESCE(GROUP_CONCAT(verifactu_hash),\'\') h FROM invoices WHERE verifactu_hash IS NOT NULL').get(),
    items: db.prepare('SELECT COUNT(*) n FROM invoice_items').get(),
  });
  const antes = foto();
  await irFicha(CLI);
  await api('GET', '/api/erp/clients/' + CLI + '/360');
  await api('GET', '/api/erp/clients/' + CLI + '/360/timeline?cuantos=100');
  ok(foto() === antes, 'abrir la ficha y su línea de tiempo NO cambia ni una factura, ni un hash, ni una línea');

  // ── [14] Navegador real: 0 errores JS, y a 390 px sin scroll horizontal ───────────────────────
  ok(errs.length === 0 && errs1.length === 0, 'CERO errores de JavaScript', errs.concat(errs1).join(' | '));
  const movil = await browser.newPage();
  const errsM = []; movil.on('pageerror', e => errsM.push(String(e.message || e)));
  await movil.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true });
  await movil.setCookie({ name: 'asess', value: sesion(owner.id), domain: slug + '.localhost', path: '/' });
  await movil.goto(BASE + '/admin/clients/' + CLI, { waitUntil: 'networkidle0' });
  await dormir(1200);
  const m = await movil.evaluate(() => ({
    ancho: document.documentElement.scrollWidth, viewport: window.innerWidth,
    cifras: document.querySelectorAll('.bf-card').length,
  }));
  ok(m.ancho <= m.viewport + 1, 'a 390 px NO hay scroll horizontal', m.ancho + ' ≤ ' + m.viewport);
  ok(m.cifras > 0, 'y la cabecera de cifras se pinta igual', m.cifras + ' celdas');
  ok(errsM.length === 0, 'sin errores de JS en móvil', errsM.join(' | '));
  await movil.close();

  // ── Abrir desde la lista sigue funcionando, y nada se ha perdido por el camino ────────────────
  // El modal de detalle pasó a ser la VENTANA FLOTANTE del componente compartido (bloque A). Lo que
  // este gate defiende no es el armazón sino lo que había dentro: que abrir un cliente desde la
  // lista siga dando su deuda a un clic y siga habiendo camino a la ficha completa. Las dos cosas
  // siguen, así que la comprobación sigue — con el selector nuevo.
  await page.goto(BASE + '/admin/clients', { waitUntil: 'networkidle0' });
  await page.evaluate(id => viewDetail(id), CLI);
  await dormir(1400);
  const md = await page.evaluate(() => ({
    abierto: !!document.querySelector('.bf-win-overlay.open'),
    deuda: /Te debe/.test(document.getElementById('bfBody').textContent),
    cobrar: !!document.querySelector('#bfBody button, #bfBody a'),
    ficha: (document.getElementById('bfFull') || {}).href || '',
  }));
  ok(md.abierto && md.deuda, 'abrir un cliente desde la lista sigue dando su deuda a un clic');
  ok(/\/admin\/clients\/\d+$/.test(md.ficha), 'y sigue habiendo enlace a la ficha completa', md.ficha.replace(/^https?:\/\/[^/]+/, ''));
} catch (e) { fail++; console.error('\n✗ EXCEPCIÓN: ' + (e && e.stack || e)); }
finally {
  try { if (browser) await browser.close(); } catch {}
  console.log('\n[limpieza] borrando el negocio de prueba: ' + slug);
  limpiar();
  console.log('  ✓ negocio de prueba eliminado');
}
console.log('\n═════════ RESULTADO: ' + pass + ' OK · ' + fail + ' fallos ═════════');
process.exit(fail ? 1 : 0);
