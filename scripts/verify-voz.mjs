// Verificación READ-ONLY de LA VOZ sobre datos REALES (un tenant).
//   node scripts/verify-voz.mjs <ruta.db> [YYYY-MM-DD]
// Abre la BD en SOLO LECTURA. Corre el barrido como el DUEÑO, VISTE los hallazgos (narrar) y, por
// cada aviso, CRUZA su cifra contra el motor de su área (openDebts, openPayables, clientesDormidos,
// cruzar, planFinanciero) — demostrando que el número del aviso == el de la pantalla del área. Además
// comprueba, aviso a aviso, que en (a)/(b) no hay ni un dígito que no sea la cifra, la fecha o un
// código de ref: CERO CIFRAS INVENTADAS sobre datos reales.
import Database from 'better-sqlite3';
import { detectar } from '../modules/erp/vigia.js';
import { narrar } from '../modules/erp/voz.js';
import { openDebts } from '../modules/erp/cobros.js';
import { openPayables } from '../modules/erp/pagos.js';
import { clientesDormidos } from '../modules/erp/ventas-metrics.js';
import { cruzar } from '../modules/erp/constructor-analitica.js';
import { planFinanciero } from '../modules/erp/plan-financiero.js';

const path = process.argv[2];
if (!path) { console.error('Uso: node scripts/verify-voz.mjs <ruta.db> [YYYY-MM-DD]'); process.exit(2); }
const hoy = /^\d{4}-\d{2}-\d{2}$/.test(process.argv[3] || '') ? process.argv[3] : null;
const db = new Database(path, { readonly: true, fileMustExist: true });
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const eq = (a, b) => Math.round(r2(a) * 100) === Math.round(r2(b) * 100);
const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
const dinero = n => sym + Number(n || 0).toFixed(2);
let okN = 0, bad = 0;
const chk = (c, m) => { if (c) { okN++; console.log('  ✓ ' + m); } else { bad++; console.log('  ✗ ' + m); } };

function sinDigitosInventados(texto, a) {
  let t = ' ' + texto + ' ';
  // Campos limpios permitidos, los MÁS LARGOS PRIMERO (que la cifra "20" no borre el "20" de "2026-…").
  const quitar = [dinero(a.cifra), String(a.cifra ?? ''), a.fecha, a.ref && a.ref.invoice_number, a.ref && a.ref.internal_code]
    .filter(x => x != null && x !== '').map(String).sort((x, y) => y.length - x.length);
  for (const q of quitar) t = t.split(q).join(' ');
  return !/\d/.test(t);
}

// El valor del motor de área que le corresponde a un hallazgo (para cruzar la cifra del aviso).
function valorMotor(h) {
  if (h.detector === 'deuda_vencida') return openDebts(db, res.hoy).rows.find(r => r.invoice_id === h.ref.invoice_id)?.pendiente;
  if (h.detector === 'pago_vence_pronto') return openPayables(db, res.hoy).rows.find(r => r.supplier_invoice_id === h.ref.supplier_invoice_id)?.pendiente;
  if (h.detector === 'cliente_dormido') return clientesDormidos(db, res.hoy).find(d => d.client_id === h.ref.client_id)?.dias_sin_comprar;
  if (h.detector === 'caida_facturacion') return cruzar(db, { area: 'ventas', dimension: 'fecha', medidas: ['base'], periodo: 'mes', limit: 100000, hasPerm: () => true }).filas.find(f => f.clave === h.fecha)?.base;
  if (h.detector === 'caida_margen') return cruzar(db, { area: 'ventas', dimension: 'fecha', medidas: ['beneficio'], periodo: 'mes', limit: 100000, hasPerm: () => true }).filas.find(f => f.clave === h.fecha)?.beneficio;
  if (h.detector === 'desvio_plan') return planFinanciero(db, {}).find(f => f.id === h.ref.objetivo_id)?.real;
  return undefined;
}

console.log('\n════ LA VOZ sobre datos reales · ' + path.split('/').pop() + ' ════');
const owner = db.prepare("SELECT id,name FROM admin_users WHERE role='owner' ORDER BY id LIMIT 1").get();
const res = detectar(db, { hasPerm: () => true, hoy });
const narrado = narrar(res, sym);
console.log('\nComo DUEÑO (' + (owner ? owner.name : '—') + ') · al día ' + res.hoy + ' · ' + narrado.avisos.length + ' avisos');
console.log('  por detector: ' + JSON.stringify(res.porDetector));

// Un ejemplo legible por cada tipo presente + su cuadre y su comprobación de no-inventa.
console.log('\n── Un ejemplo por tipo, con la cifra cruzada contra el motor ──');
const vistos = new Set();
for (const a of narrado.avisos) {
  if (vistos.has(a.detector)) continue;
  vistos.add(a.detector);
  const h = res.hallazgos.find(x => x.detector === a.detector && JSON.stringify(x.ref) === JSON.stringify(a.ref));
  console.log('\n  [' + a.detectorEtiqueta + ' · ' + a.areaEtiqueta + ']');
  console.log('   ' + a.encabezado);
  console.log('   (a) ' + a.quePasa);
  console.log('   (b) ' + a.decision);
  console.log('   ·   ' + a.porque);
  const motor = valorMotor(h);
  if (motor !== undefined) chk(eq(motor, a.cifra), 'cuadre: aviso ' + (a.moneda ? dinero(a.cifra) : a.cifra) + ' == motor ' + (a.moneda ? dinero(motor) : motor));
}

// Barrido completo: TODOS los avisos, cuadre + no-inventa (no solo el ejemplo).
console.log('\n── Barrido completo (todos los avisos) ──');
let cuadre = 0, noinv = 0;
for (const a of narrado.avisos) {
  const h = res.hallazgos.find(x => x.detector === a.detector && JSON.stringify(x.ref) === JSON.stringify(a.ref));
  const motor = valorMotor(h);
  if (motor !== undefined && eq(motor, a.cifra)) cuadre++;
  else if (motor !== undefined) { bad++; console.log('  ✗ descuadre en ' + a.detector + ' ' + JSON.stringify(a.ref)); }
  if (sinDigitosInventados(a.quePasa, a) && sinDigitosInventados(a.decision, a)) noinv++;
  else { bad++; console.log('  ✗ dígito inventado en ' + a.detector + ' ' + JSON.stringify(a.ref)); }
}
chk(cuadre === narrado.avisos.filter(a => valorMotor(res.hallazgos.find(x => x.detector === a.detector && JSON.stringify(x.ref) === JSON.stringify(a.ref))) !== undefined).length,
    cuadre + ' avisos con dato real: todos cuadran con su motor');
chk(noinv === narrado.avisos.length, noinv + '/' + narrado.avisos.length + ' avisos: sin ni un dígito inventado');

db.close();
console.log('\n=== ' + okN + ' OK / ' + bad + ' fallos (cuadre real de la voz) ===');
process.exit(bad ? 1 : 0);
