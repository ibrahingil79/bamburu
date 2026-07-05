// CONTABILIDAD · Pieza 4 — MODELOS AEAT (borradores LISTOS PARA VALIDAR): 303 (IVA) y 130 (IRPF).
//
// Vistas DERIVADAS de los libros (Piezas 1–3), SOLO LECTURA: no crean datos ni escriben en el
// cuaderno. Cada casilla se calcula a partir del libro de ventas/compras y del libro de bienes de
// inversión, con su número de casilla oficial para que la gestoría lo valide de un vistazo.
//
// Bamburu PREPARA, NUNCA presenta (CANON §0-ter). Casillas verificadas contra las instrucciones
// oficiales de la AEAT (modelo 303 instrucciones-2026; modelo 130 instrucciones), 2026-07-05.
//
// Alcance de esta pieza: régimen general de IVA sin prorrata especial ni recargo de equivalencia
// (303), y estimación directa de actividades económicas en general (130, apartado I). Lo que el
// motor no puede saber con certeza (compensaciones/pagos ya presentados, variación de existencias,
// minoración por rendimientos, deducción de vivienda) se calcula por defecto de forma transparente
// o se deja a 0 con AVISO, nunca inventado.
import { libroVentas, libroCompras } from './contabilidad.js';
import { libroBienes } from './contabilidad-bienes.js';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const pos = n => (n > 0 ? r2(n) : 0);

// ── Periodos ────────────────────────────────────────────────────────────────
const QRANGE = { 1: ['01-01', '03-31'], 2: ['04-01', '06-30'], 3: ['07-01', '09-30'], 4: ['10-01', '12-31'] };
export function quarterRange(year, q) { const [a, b] = QRANGE[q]; return { from: `${year}-${a}`, to: `${year}-${b}` }; }

// ════════════════════════════════════════════════════════════════════════════
// MODELO 303 — IVA (autoliquidación trimestral, régimen general)
// ════════════════════════════════════════════════════════════════════════════

// IVA devengado del periodo, agrupado por tipo → casillas base/cuota oficiales.
// 21% → [07][08] · 10% → [04][05] · 4% → [01][02] · 0% → [150][151].
const RATE_CASILLA = { 21: ['07', '08'], 10: ['04', '05'], 4: ['01', '02'], 0: ['150', '151'] };
function devengado303(ventas) {
  const byRate = {};
  for (const row of ventas.rows) for (const g of (row.desglose || [])) {
    const k = (g.rate === null || g.rate === undefined) ? 'sd' : String(g.rate);
    (byRate[k] ||= { rate: g.rate ?? null, base: 0, cuota: 0 });
    byRate[k].base = r2(byRate[k].base + g.base);
    byRate[k].cuota = r2(byRate[k].cuota + g.cuota);
  }
  const filas = [], warnings = [];
  let totalCuota = 0;
  // Orden fijo de tipos (mayor a menor) para una lectura estable.
  for (const rate of [21, 10, 4, 0]) {
    const g = byRate[String(rate)];
    if (!g) continue;
    const [cb, cc] = RATE_CASILLA[rate];
    filas.push({ tipo: rate, casillaBase: cb, base: r2(g.base), casillaCuota: cc, cuota: r2(g.cuota) });
    totalCuota = r2(totalCuota + g.cuota);
  }
  if (byRate.sd) {
    totalCuota = r2(totalCuota + byRate.sd.cuota);
    warnings.push(`Hay ${r2(byRate.sd.base)} € de base con IVA sin desglosar (cuota ${r2(byRate.sd.cuota)} €): no se puede asignar a una casilla de tipo; revísalo antes de presentar.`);
  }
  const otras = Object.keys(byRate).filter(k => k !== 'sd' && !RATE_CASILLA[Number(k)]);
  for (const k of otras) {
    totalCuota = r2(totalCuota + byRate[k].cuota);
    warnings.push(`Tipo de IVA ${k}% sin casilla estándar en el 303 (cuota ${r2(byRate[k].cuota)} €): revísalo.`);
  }
  return { filas, casilla27: r2(totalCuota), warnings };
}

// IVA deducible del periodo: separa operaciones interiores CORRIENTES ([28][29]) de las de
// BIENES DE INVERSIÓN ([30][31]). Un gasto/compra es "de inversión" si su documento de origen
// (una compra) está dado de alta como bien de inversión (investment_goods.purchase_id).
const GASTO_CODES = "'600','621','622','623','624','625','626','627','628','629'";
function deducible303(db, from, to) {
  const invIds = new Set(
    db.prepare('SELECT purchase_id FROM investment_goods WHERE purchase_id IS NOT NULL').all().map(r => r.purchase_id)
  );
  const rows = db.prepare(
    `SELECT si.entity_type et, si.entity_id eid,
            ROUND(SUM(CASE WHEN l.account_code='472' THEN l.debit - l.credit ELSE 0 END), 2) cuota,
            ROUND(SUM(CASE WHEN l.account_code IN (${GASTO_CODES}) THEN l.debit - l.credit ELSE 0 END), 2) base
       FROM ledger_entries e JOIN ledger_lines l ON l.entry_id = e.id
       JOIN supplier_invoices si ON si.id = e.origin_id
      WHERE e.origin_type='supplier_invoice' AND e.entry_type IN ('compra_gasto','abono_proveedor','reversion')
        AND e.entry_date BETWEEN ? AND ?
      GROUP BY si.id`
  ).all(from, to);
  const corriente = { base: 0, cuota: 0 }, inversion = { base: 0, cuota: 0 };
  for (const r of rows) {
    const t = (r.et === 'purchase' && invIds.has(r.eid)) ? inversion : corriente;
    t.base = r2(t.base + (r.base || 0));
    t.cuota = r2(t.cuota + (r.cuota || 0));
  }
  return { corriente, inversion };
}

// Núcleo del 303 para UN trimestre (sin compensaciones): devengado − deducible.
function base303(db, year, q) {
  const { from, to } = quarterRange(year, q);
  const dev = devengado303(libroVentas(db, from, to));
  const ded = deducible303(db, from, to);
  const casilla45 = r2(ded.corriente.cuota + ded.inversion.cuota);
  const casilla46 = r2(dev.casilla27 - casilla45);
  return { from, to, dev, ded, casilla45, casilla46, warnings: dev.warnings };
}

// 303 del trimestre `q`, encadenando la COMPENSACIÓN de cuotas negativas de trimestres previos
// del MISMO año (casilla [78]). Un trimestre con resultado negativo genera saldo a compensar que
// se aplica en los siguientes (hasta agotar el resultado positivo). La gestoría valida.
export function modelo303(db, year, q) {
  let pendiente = 0;   // saldo a compensar arrastrado
  let out = null;
  const acumWarn = [];
  for (let qq = 1; qq <= q; qq++) {
    const b = base303(db, year, qq);
    const casilla65 = 100;                        // % atribuible al Estado (territorio común)
    const casilla66 = r2(b.casilla46 * casilla65 / 100);
    let casilla78 = 0, casilla71;
    if (casilla66 >= 0) {
      casilla78 = Math.min(casilla66, pendiente);  // se compensa hasta donde llegue el resultado
      casilla71 = r2(casilla66 - casilla78);
      pendiente = r2(pendiente - casilla78);
    } else {
      casilla71 = casilla66;                       // negativo: a compensar en el siguiente
      pendiente = r2(pendiente + (-casilla66));
    }
    if (qq === q) {
      out = { ...b, casilla27: b.dev.casilla27, casilla65, casilla66, casilla78, casilla71,
              pendienteSiguiente: pendiente, warnings: [...b.warnings, ...acumWarn] };
    }
  }
  return { year, q, ...out };
}

// ════════════════════════════════════════════════════════════════════════════
// MODELO 130 — IRPF pago fraccionado (estimación directa, actividades en general)
// ════════════════════════════════════════════════════════════════════════════

// Minoración por rendimientos (art. 110.3.c del Reglamento del IRPF) según el rendimiento neto del
// ejercicio ANTERIOR. Tabla vigente (instrucciones AEAT del 130).
function minoracion110(rendPrevio) {
  if (rendPrevio == null) return 0;
  if (rendPrevio <= 9000) return 100;
  if (rendPrevio <= 10000) return 75;
  if (rendPrevio <= 11000) return 50;
  if (rendPrevio <= 12000) return 25;
  return 0;
}

// Núcleo del 130 ACUMULADO desde el 1 de enero hasta el fin del trimestre `q`.
// Ingresos = base de ventas; gastos = base de compras/gastos + amortización del libro de bienes.
// (Variación de existencias NO incluida en esta pieza — ver CANON; la gestoría ajusta.)
function base130(db, year, q) {
  const to = quarterRange(year, q).to;
  const from = `${year}-01-01`;
  const ventas = libroVentas(db, from, to);
  const compras = libroCompras(db, from, to);
  const amort = libroBienes(db, from, to).totals.cuota;   // amortización acumulada del periodo
  const c01 = r2(ventas.totals.base);
  const c02 = r2(compras.totals.base + amort);
  const c03 = r2(c01 - c02);
  const c04 = c03 > 0 ? r2(c03 * 0.20) : 0;
  const c06 = r2(ventas.totals.irpf);                     // retenciones soportadas acumuladas
  return { from, to, c01, c02, c03, c04, c06, amort: r2(amort) };
}

// ¿Hay actividad contable en el ejercicio dado? (para decidir si podemos estimar el rendimiento
// previo de la minoración, o dejarla a 0 con aviso).
function hayEjercicio(db, year) {
  return !!db.prepare("SELECT 1 FROM ledger_entries WHERE entry_date BETWEEN ? AND ? LIMIT 1")
    .get(`${year}-01-01`, `${year}-12-31`);
}
function rendimientoAnual(db, year) {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const ing = libroVentas(db, from, to).totals.base;
  const gas = libroCompras(db, from, to).totals.base + libroBienes(db, from, to).totals.cuota;
  return r2(ing - gas);
}

// 130 del trimestre `q`, encadenando pagos y resultados de trimestres previos del MISMO año:
//  [05] = Σ [07] positivas de trimestres anteriores − Σ [16] de esos trimestres.
//  [15] = resultados negativos [19] de trimestres anteriores (a deducir si [14] es positiva).
export function modelo130(db, year, q) {
  const prevRend = hayEjercicio(db, year - 1) ? rendimientoAnual(db, year - 1) : null;
  const c13 = minoracion110(prevRend);
  const warnings = [];
  if (prevRend == null) warnings.push('Sin datos del ejercicio anterior: la minoración por rendimientos (casilla 13) queda a 0; ajústala si el rendimiento neto del año anterior fue ≤ 12.000 €.');
  warnings.push('La deducción por vivienda habitual (casilla 16) queda a 0: márcala manualmente si tienes derecho.');
  warnings.push('Los gastos no incluyen variación de existencias (coste de ventas): la gestoría lo ajusta en el cierre.');

  let sum07pos = 0, sum16 = 0, sum19neg = 0;   // acumulados de trimestres anteriores
  let out = null;
  for (let qq = 1; qq <= q; qq++) {
    const b = base130(db, year, qq);
    const c05 = r2(sum07pos - sum16);
    const c07 = r2(b.c04 - c05 - b.c06);
    const c12 = c07;                            // sin apartado II (agrícola/ganadero/forestal)
    const c14 = r2(c12 - c13);
    const c15 = c14 > 0 ? Math.min(c14, sum19neg) : 0;   // compensa resultados negativos previos
    const c16 = 0;                             // vivienda habitual (manual)
    const c17 = r2(c14 - c15 - c16);
    const c18 = 0;                             // solo autoliquidación complementaria
    const c19 = r2(c17 - c18);
    if (qq === q) {
      out = { ...b, c05, c07, c12, c13, c14, c15, c16, c17, c18, c19, prevRend, warnings };
    }
    // Actualiza acumulados para el siguiente trimestre.
    sum07pos = r2(sum07pos + pos(c07));
    sum16 = r2(sum16 + c16);
    if (c19 < 0) sum19neg = r2(sum19neg + (-c19));
  }
  return { year, q, ...out };
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORT (borrador para la gestoría): filas casilla·descripción·importe
// ════════════════════════════════════════════════════════════════════════════
export function filas303(m) {
  const f = [];
  f.push(['—', 'IVA DEVENGADO', '']);
  for (const r of m.dev.filas) {
    f.push([r.casillaBase, `Base imponible al ${r.tipo}%`, r.base]);
    f.push([r.casillaCuota, `Cuota IVA al ${r.tipo}%`, r.cuota]);
  }
  f.push(['27', 'Total cuota devengada', m.casilla27]);
  f.push(['—', 'IVA DEDUCIBLE', '']);
  f.push(['28', 'Base op. interiores corrientes', m.ded.corriente.base]);
  f.push(['29', 'Cuota op. interiores corrientes', m.ded.corriente.cuota]);
  f.push(['30', 'Base op. interiores con bienes de inversión', m.ded.inversion.base]);
  f.push(['31', 'Cuota op. interiores con bienes de inversión', m.ded.inversion.cuota]);
  f.push(['45', 'Total a deducir', m.casilla45]);
  f.push(['—', 'RESULTADO', '']);
  f.push(['46', 'Resultado régimen general (27 − 45)', m.casilla46]);
  f.push(['65', '% atribuible a la Administración del Estado', m.casilla65]);
  f.push(['66', 'Atribuible a la Administración del Estado', m.casilla66]);
  f.push(['78', 'Cuotas a compensar de periodos anteriores', m.casilla78]);
  f.push(['71', 'Resultado de la liquidación (66 − 78)', m.casilla71]);
  return f;
}
export function filas130(m) {
  return [
    ['01', 'Ingresos computables (acumulado del año)', m.c01],
    ['02', 'Gastos deducibles + amortizaciones (acumulado)', m.c02],
    ['03', 'Rendimiento neto (01 − 02)', m.c03],
    ['04', 'Pago fraccionado previo (20% de 03)', m.c04],
    ['05', 'Pagos fraccionados de trimestres anteriores', m.c05],
    ['06', 'Retenciones e ingresos a cuenta soportados', m.c06],
    ['07', 'Resultado (04 − 05 − 06)', m.c07],
    ['13', 'Minoración por rendimientos (art. 110.3.c)', m.c13],
    ['14', 'Resultado (12 − 13)', m.c14],
    ['15', 'A deducir: resultados negativos de trimestres anteriores', m.c15],
    ['16', 'Deducción por vivienda habitual', m.c16],
    ['17', 'Resultado (14 − 15 − 16)', m.c17],
    ['19', 'Resultado a ingresar (17 − 18)', m.c19],
  ];
}
