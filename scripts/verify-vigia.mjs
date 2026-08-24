// Verificación READ-ONLY del VIGÍA sobre datos REALES (una copia de un tenant).
//   node scripts/verify-vigia.mjs <ruta.db> [YYYY-MM-DD]
// Abre la BD en SOLO LECTURA (no migra, no escribe). Corre el barrido como el DUEÑO (todos los
// permisos) y como el EMPLEADO real (sus permisos de user_permissions), imprime los hallazgos y
// CRUZA cada cifra contra el motor de su área para demostrar el cuadre con números reales.
import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { detectar, DETECTORES } from '../modules/erp/vigia.js';
import { openDebts } from '../modules/erp/cobros.js';
import { openPayables } from '../modules/erp/pagos.js';
import { clientesDormidos } from '../modules/erp/ventas-metrics.js';
import { cruzar } from '../modules/erp/constructor-analitica.js';
import { planFinanciero } from '../modules/erp/plan-financiero.js';

// LA RUTA, CON VALOR POR DEFECTO (24 ago 2026). Esto exigía la ruta de la BD por parámetro y
// ABORTABA sin ella (código 2), así que el barrido no podía ejecutarla: era una de las 99 que
// no corría nadie, y ni siquiera por estar rota — por no poder arrancar. Se le da por defecto el
// negocio de desarrollo, que es contra el que corren todas las demás. Sigue aceptando una ruta
// distinta como primer argumento, que es para lo que se escribió.
const path = process.argv[2] || 'data/tenants/desarrollo-bamburu.db';
if (!existsSync(path)) { console.error('No existe la base «' + path + '».\nUso: node scripts/verify-vigia.mjs [ruta.db] [YYYY-MM-DD]'); process.exit(2); }
const hoy = /^\d{4}-\d{2}-\d{2}$/.test(process.argv[3] || '') ? process.argv[3] : null;
const db = new Database(path, { readonly: true, fileMustExist: true });
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const eq = (a, b) => Math.round(r2(a) * 100) === Math.round(r2(b) * 100);

// hasPerm de un usuario real, leído igual que adminAuth (owner/admin → todo).
function permDe(userId) {
  const u = db.prepare('SELECT role FROM admin_users WHERE id=?').get(userId);
  if (!u) throw new Error('usuario ' + userId + ' no existe');
  if (u.role === 'owner' || u.role === 'admin') return () => true;
  const set = new Set(db.prepare(`SELECT p.module||'.'||p.action AS perm FROM user_permissions up JOIN permissions p ON p.id=up.permission_id WHERE up.admin_user_id=?`).all(userId).map(r => r.perm));
  return (p) => set.has(p);
}
const fmt = h => (h.moneda ? '€' : '') + h.cifra;

console.log('\n════ VIGÍA sobre datos reales · ' + path.split('/').pop() + ' ════');

// ── Como el DUEÑO (todos los permisos) ──
const owner = db.prepare("SELECT id,name FROM admin_users WHERE role='owner' ORDER BY id LIMIT 1").get();
const res = detectar(db, { hasPerm: permDe(owner.id), hoy });
console.log('\nComo DUEÑO (' + owner.name + ') · al día ' + res.hoy + ' · ' + res.total + ' hallazgos');
console.log('  por detector: ' + JSON.stringify(res.porDetector));
for (const h of res.hallazgos) {
  console.log('  · [' + h.area + '] ' + h.titulo + '  →  ' + fmt(h) + '  (' + (h.fecha || '—') + ')');
  console.log('      motivo: ' + h.motivo);
}

// ── CUADRE con los motores (un ejemplo por detector presente) ──
console.log('\n── Cuadre contra el motor de cada área (cifra del vigía == cifra de la pantalla) ──');
let cuadres = 0, descuadres = 0;
const chk = (cond, label) => { if (cond) { cuadres++; console.log('  ✓ ' + label); } else { descuadres++; console.log('  ✗ ' + label); } };
for (const h of res.hallazgos) {
  if (h.detector === 'deuda_vencida') {
    const m = openDebts(db, res.hoy).rows.find(r => r.invoice_id === h.ref.invoice_id);
    chk(m && eq(m.pendiente, h.cifra), 'deuda_vencida ' + (h.ref.invoice_number || h.ref.invoice_id) + ': vigía ' + h.cifra + ' == openDebts ' + (m && m.pendiente)); break;
  }
}
for (const h of res.hallazgos) {
  if (h.detector === 'pago_vence_pronto') {
    const m = openPayables(db, res.hoy).rows.find(r => r.supplier_invoice_id === h.ref.supplier_invoice_id);
    chk(m && eq(m.pendiente, h.cifra), 'pago_vence_pronto ' + (h.ref.internal_code || h.ref.supplier_invoice_id) + ': vigía ' + h.cifra + ' == openPayables ' + (m && m.pendiente)); break;
  }
}
for (const h of res.hallazgos) {
  if (h.detector === 'cliente_dormido') {
    const m = clientesDormidos(db, res.hoy).find(d => d.client_id === h.ref.client_id);
    chk(m && m.dias_sin_comprar === h.cifra, 'cliente_dormido ' + h.ref.client_id + ': vigía ' + h.cifra + ' == clientesDormidos ' + (m && m.dias_sin_comprar)); break;
  }
}
for (const h of res.hallazgos) {
  if (h.detector === 'caida_facturacion') {
    const m = cruzar(db, { area: 'ventas', dimension: 'fecha', medidas: ['base'], periodo: 'mes', limit: 100000, hasPerm: () => true }).filas.find(f => f.clave === h.fecha);
    chk(m && eq(m.base, h.cifra), 'caida_facturacion ' + h.fecha + ': vigía ' + h.cifra + ' == cruzar.base ' + (m && m.base)); break;
  }
}
for (const h of res.hallazgos) {
  if (h.detector === 'caida_margen') {
    const m = cruzar(db, { area: 'ventas', dimension: 'fecha', medidas: ['beneficio'], periodo: 'mes', limit: 100000, hasPerm: () => true }).filas.find(f => f.clave === h.fecha);
    chk(m && eq(m.beneficio, h.cifra), 'caida_margen ' + h.fecha + ': vigía ' + h.cifra + ' == cruzar.beneficio ' + (m && m.beneficio)); break;
  }
}
for (const h of res.hallazgos) {
  if (h.detector === 'desvio_plan') {
    const m = planFinanciero(db, {}).find(f => f.id === h.ref.objetivo_id);
    chk(m && eq(m.real, h.cifra), 'desvio_plan objetivo#' + h.ref.objetivo_id + ': vigía ' + h.cifra + ' == planFinanciero.real ' + (m && m.real)); break;
  }
}
if (!cuadres && !descuadres) console.log('  (no hay hallazgos con dato real que cruzar en este tenant a esta fecha)');

// ── PERMISOS con un empleado REAL ──
const emp = db.prepare("SELECT id,name FROM admin_users WHERE role='employee' AND active=1 ORDER BY id LIMIT 1").get();
if (emp) {
  const resEmp = detectar(db, { hasPerm: permDe(emp.id), hoy });
  const corren = Object.keys(resEmp.porDetector);
  const falta = resEmp.sinPermiso.map(s => s.key);
  console.log('\nComo EMPLEADO real (' + emp.name + ', id ' + emp.id + '):');
  console.log('  detectores que corren:  ' + (corren.join(', ') || '(ninguno)'));
  console.log('  sinPermiso (no ve):     ' + (falta.join(', ') || '(ninguno)'));
  // 403 al forzar un detector sin permiso (el primero de sinPermiso).
  if (falta.length) {
    let e = null;
    try { detectar(db, { hasPerm: permDe(emp.id), hoy, soloDetector: falta[0] }); } catch (x) { e = x; }
    console.log('  forzar "' + falta[0] + '" → ' + (e && e.status === 403 ? '403 ✓' : 'NO dio 403 ✗'));
  }
} else console.log('\n(No hay empleado activo en este tenant para probar permisos con datos reales.)');

// ── SIMULACIÓN restringida sobre DATOS REALES: denegar un área y ver que sus hallazgos
//    desaparecen (van a sinPermiso) y que forzarla da 403. Útil cuando el tenant no tiene un
//    empleado con permisos parciales: el permiso se restringe, los DATOS siguen siendo los reales.
console.log('\n── Gating sobre datos reales: denegar cobros.read y purchases.read ──');
const restringido = (p) => p !== 'cobros.read' && p !== 'purchases.read';
const resR = detectar(db, { hasPerm: restringido, hoy });
const cobrosBase = res.porDetector.deuda_vencida || 0;
const comprasBase = res.porDetector.pago_vence_pronto || 0;
console.log('  deuda_vencida: dueño ' + cobrosBase + ' → restringido ' + (resR.porDetector.deuda_vencida ?? '(no corre)'));
console.log('  pago_vence_pronto: dueño ' + comprasBase + ' → restringido ' + (resR.porDetector.pago_vence_pronto ?? '(no corre)'));
const faltaR = resR.sinPermiso.map(s => s.key);
const okGating = resR.porDetector.deuda_vencida === undefined && resR.porDetector.pago_vence_pronto === undefined
  && faltaR.includes('deuda_vencida') && faltaR.includes('pago_vence_pronto')
  && !resR.hallazgos.some(h => h.detector === 'deuda_vencida' || h.detector === 'pago_vence_pronto');
console.log('  ' + (okGating ? '✓' : '✗') + ' sin permiso NO salen y figuran en sinPermiso: [' + faltaR.join(', ') + ']');
let eR = null;
try { detectar(db, { hasPerm: restringido, hoy, soloDetector: 'deuda_vencida' }); } catch (x) { eR = x; }
console.log('  ' + (eR && eR.status === 403 ? '✓' : '✗') + ' forzar deuda_vencida sin cobros.read → ' + (eR && eR.status === 403 ? '403' : 'NO 403'));
if (!okGating || !(eR && eR.status === 403)) descuadres++;

db.close();
console.log('\n=== ' + (cuadres) + ' OK / ' + descuadres + ' descuadres (cuadre real) ===');
process.exit(descuadres ? 1 : 0);
