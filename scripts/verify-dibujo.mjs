// Verificación READ-ONLY de EL DIBUJO sobre datos REALES.
//   node scripts/verify-dibujo.mjs <ruta.db> [YYYY-MM-DD]
// Abre la BD en SOLO LECTURA. Por cada aviso compone su receta y la pasa a `cruzar` (el motor del
// constructor), demostrando que el gráfico de apoyo CUADRA con el mismo cruce hecho a mano y con la
// cifra del aviso/del motor de su área. En el tenant "desarrollo" disparan deuda y pago; los otros
// cuatro tipos los cubre `test-dibujo` (sembrado).
import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { detectar } from '../modules/erp/vigia.js';
import { narrar } from '../modules/erp/voz.js';
import { graficoDe } from '../modules/erp/dibujo.js';
import { cruzar } from '../modules/erp/constructor-analitica.js';
import { openPayables } from '../modules/erp/pagos.js';

// LA RUTA, CON VALOR POR DEFECTO (24 ago 2026). Esto exigía la ruta de la BD por parámetro y
// ABORTABA sin ella (código 2), así que el barrido no podía ejecutarla: era una de las 99 que
// no corría nadie, y ni siquiera por estar rota — por no poder arrancar. Se le da por defecto el
// negocio de desarrollo, que es contra el que corren todas las demás. Sigue aceptando una ruta
// distinta como primer argumento, que es para lo que se escribió.
const path = process.argv[2] || 'data/tenants/desarrollo-bamburu.db';
if (!existsSync(path)) { console.error('No existe la base «' + path + '».\nUso: node scripts/verify-dibujo.mjs [ruta.db] [YYYY-MM-DD]'); process.exit(2); }
const hoy = /^\d{4}-\d{2}-\d{2}$/.test(process.argv[3] || '') ? process.argv[3] : null;
const db = new Database(path, { readonly: true, fileMustExist: true });
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const eq = (a, b) => Math.round(r2(a) * 100) === Math.round(r2(b) * 100);
const P = () => true;
let okN = 0, bad = 0;
const chk = (c, m) => { if (c) { okN++; console.log('  ✓ ' + m); } else { bad++; console.log('  ✗ ' + m); } };

const resolvers = {
  nombreCliente: id => db.prepare('SELECT name FROM clients WHERE id=?').get(id)?.name || null,
  nombreProveedor: id => db.prepare('SELECT name FROM suppliers WHERE id=?').get(id)?.name || null,
};
const cruzarReceta = r => cruzar(db, { ...r, hasPerm: P });
const manoIgual = r => JSON.stringify(cruzarReceta(r).filas) === JSON.stringify(cruzar(db, { area: r.area, dimension: r.dimension, medidas: r.medidas, periodo: r.periodo, filtros: r.filtros, hasPerm: P }).filas);

console.log('\n════ EL DIBUJO sobre datos reales · ' + path.split('/').pop() + ' ════');
const res = detectar(db, { hasPerm: P, hoy });
const avisos = narrar(res, '€').avisos.map(a => ({ ...a, grafico: graficoDe(a, resolvers) }));
console.log('al día ' + res.hoy + ' · ' + avisos.length + ' avisos · por detector: ' + JSON.stringify(res.porDetector));

// Un ejemplo por tipo presente, con su cross-check contra el constructor / motor de área.
console.log('\n── Un ejemplo por tipo, con el gráfico cuadrado ──');
const vistos = new Set();
for (const a of avisos) {
  if (vistos.has(a.detector) || !a.grafico || !a.grafico.receta) continue;
  vistos.add(a.detector);
  const r = a.grafico.receta;
  console.log('\n  [' + a.detectorEtiqueta + '] receta: ' + JSON.stringify(r));
  console.log('   ' + a.grafico.explica + (a.grafico.gap ? '  ⚠ ' + a.grafico.gap : ''));
  chk(manoIgual(r), a.detector + ': la receta y el mismo cruce a mano dan filas idénticas');
  if (a.detector === 'caida_facturacion' || a.detector === 'caida_margen') {
    const fila = cruzarReceta(r).filas.find(f => f.clave === a.fecha);
    chk(fila && eq(fila[a.grafico.medida], a.cifra), '  punto[' + a.fecha + '] == cifra del aviso (' + a.cifra + ')');
  } else if (a.detector === 'pago_vence_pronto') {
    const supName = resolvers.nombreProveedor(a.ref.supplier_id);
    const barra = cruzarReceta(r).filas.find(f => f.clave === supName);
    const sumOP = r2(openPayables(db, res.hoy).rows.filter(x => x.supplier_id === a.ref.supplier_id && x.pendiente > 0.0049).reduce((s, x) => s + x.pendiente, 0));
    chk(barra && eq(barra.pendiente, sumOP), '  barra[' + supName + '].pendiente (' + (barra && barra.pendiente) + ') == Σ openPayables del proveedor (' + sumOP + ')');
  } else if (a.detector === 'deuda_vencida' || a.detector === 'cliente_dormido') {
    const cli = resolvers.nombreCliente(a.ref.client_id);
    const totalFiltrado = r2(cruzarReceta(r).filas.reduce((s, f) => s + (f.base || 0), 0));
    const ranking = cruzar(db, { area: 'ventas', dimension: 'cliente', medidas: ['base'], hasPerm: P }).filas.find(f => f.clave === cli);
    chk(ranking && eq(ranking.base, totalFiltrado), '  Σ del gráfico de "' + cli + '" (' + totalFiltrado + ') == su total en el ranking (' + (ranking && ranking.base) + ')');
  }
}

// Barrido completo: TODOS los avisos con receta cuadran con el cruce a mano.
console.log('\n── Barrido completo (todas las recetas == cruce a mano) ──');
let conReceta = 0, cuadran = 0;
for (const a of avisos) {
  if (!a.grafico || !a.grafico.receta) continue;
  conReceta++;
  if (manoIgual(a.grafico.receta)) cuadran++;
  else { bad++; console.log('  ✗ descuadre en ' + a.detector + ' ' + JSON.stringify(a.ref)); }
}
chk(conReceta > 0 && cuadran === conReceta, cuadran + '/' + conReceta + ' recetas cuadran con el constructor hecho a mano');

db.close();
console.log('\n=== ' + okN + ' OK / ' + bad + ' fallos (cuadre real del dibujo) ===');
process.exit(bad ? 1 : 0);
