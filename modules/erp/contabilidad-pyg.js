// CONTABILIDAD · Pieza 5 — CUENTA DE PÉRDIDAS Y GANANCIAS (estado formal, SOLO LECTURA).
//
// Vista DERIVADA del libro diario (ledger_entries + ledger_lines): no crea ni modifica datos.
// Agrega los saldos de las cuentas de resultado (grupos 6 y 7) del periodo y los ordena en la
// estructura oficial de la Cuenta de Pérdidas y Ganancias del PGC de PYMES (RD 1515/2007, Tercera
// Parte), verificada contra el BOE (BOE-A-2007-19966), NO de memoria — mismo criterio que las
// casillas de los modelos 303/130 (Pieza 4).
//
// Alcance (decisión del usuario, Opción A): SOLO la P&G. El Balance es pieza futura (requiere
// asientos de apertura + capital + capitalización de inmovilizado). La amortización del Libro de
// bienes de inversión (Pieza 3) NO se cruza aquí: no está asentada en el diario y hacerlo rompería
// el cuadre y duplicaría el coste (ya recogido en gastos). Se avisa cuando hay bienes registrados.
//
// Invariante de cuadre: la contribución de cada cuenta a su partida es (haber − debe), de modo que
// Resultado del ejercicio = Σ(haber − debe) de los grupos 6 y 7 = Σingresos − Σgastos del periodo.

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

// ── Partidas oficiales de la Cuenta de PyG (modelo PYMES), en orden ──────────────
// seccion: 'explotacion' (→ A.1), 'financiero' (→ A.2), 'impuesto' (→ tras A.3).
export const PARTIDAS = [
  { key: 'incn',                  etiqueta: '1',  seccion: 'explotacion', nombre: 'Importe neto de la cifra de negocios' },
  { key: 'var_existencias',       etiqueta: '2',  seccion: 'explotacion', nombre: 'Variación de existencias de productos terminados y en curso de fabricación' },
  { key: 'trabajos_activo',       etiqueta: '3',  seccion: 'explotacion', nombre: 'Trabajos realizados por la empresa para su activo' },
  { key: 'aprovisionamientos',    etiqueta: '4',  seccion: 'explotacion', nombre: 'Aprovisionamientos' },
  { key: 'otros_ingresos',        etiqueta: '5',  seccion: 'explotacion', nombre: 'Otros ingresos de explotación' },
  { key: 'personal',              etiqueta: '6',  seccion: 'explotacion', nombre: 'Gastos de personal' },
  { key: 'otros_gastos',          etiqueta: '7',  seccion: 'explotacion', nombre: 'Otros gastos de explotación' },
  { key: 'amortizacion',          etiqueta: '8',  seccion: 'explotacion', nombre: 'Amortización del inmovilizado' },
  { key: 'imp_subvenciones',      etiqueta: '9',  seccion: 'explotacion', nombre: 'Imputación de subvenciones de inmovilizado no financiero y otras' },
  { key: 'excesos_provisiones',   etiqueta: '10', seccion: 'explotacion', nombre: 'Excesos de provisiones' },
  { key: 'deterioro_inmovilizado',etiqueta: '11', seccion: 'explotacion', nombre: 'Deterioro y resultado por enajenaciones del inmovilizado' },
  { key: 'ing_financieros',       etiqueta: '12', seccion: 'financiero',  nombre: 'Ingresos financieros' },
  { key: 'gastos_financieros',    etiqueta: '13', seccion: 'financiero',  nombre: 'Gastos financieros' },
  { key: 'var_valor_razonable',   etiqueta: '14', seccion: 'financiero',  nombre: 'Variación de valor razonable en instrumentos financieros' },
  { key: 'dif_cambio',            etiqueta: '15', seccion: 'financiero',  nombre: 'Diferencias de cambio' },
  { key: 'deterioro_financiero',  etiqueta: '16', seccion: 'financiero',  nombre: 'Deterioro y resultado por enajenaciones de instrumentos financieros' },
  { key: 'impuestos',             etiqueta: '17', seccion: 'impuesto',    nombre: 'Impuestos sobre beneficios' },
];
const PARTIDA_BY_KEY = Object.fromEntries(PARTIDAS.map(p => [p.key, p]));

// ── Clasificador cuenta PGC → partida de la P&G (mapeo verificado contra el BOE) ──
// Devuelve la clave de partida, o null si la cuenta (de grupo 6/7) no tiene partida estándar.
export function pygPartida(code) {
  const c = String(code);
  const d4 = c.slice(0, 4), d3 = c.slice(0, 3), d2 = c.slice(0, 2);
  // — Explotación —
  if (['700', '701', '702', '703', '704', '705', '706', '708', '709'].includes(d3)) return 'incn';   // INCN (706/708/709 minoran)
  if (d2 === '71' || d4 === '7930' || d4 === '6930') return 'var_existencias';
  if (d2 === '73') return 'trabajos_activo';
  if (['600', '601', '602', '606', '607', '608', '609'].includes(d3) || d2 === '61'
      || ['6931', '6932', '6933', '7931', '7932', '7933'].includes(d4)) return 'aprovisionamientos';
  if (d3 === '740' || d3 === '747' || d2 === '75') return 'otros_ingresos';
  if (d2 === '64') return 'personal';
  if (d2 === '62' || ['631', '634', '636', '639'].includes(d3) || d2 === '65'
      || ['694', '695', '794'].includes(d3) || d4 === '7954') return 'otros_gastos';   // 626 (banca) es 62 → explotación
  if (d2 === '68') return 'amortizacion';
  if (d3 === '746') return 'imp_subvenciones';
  if (['7951', '7952', '7955'].includes(d4)) return 'excesos_provisiones';
  if (['670', '671', '672', '690', '691', '692', '770', '771', '772', '790', '791', '792'].includes(d3)) return 'deterioro_inmovilizado';
  // — Financiero —
  if (['760', '761', '762', '769'].includes(d3)) return 'ing_financieros';
  if (['660', '661', '662', '664', '665', '669'].includes(d3)) return 'gastos_financieros';
  if (d3 === '663' || d3 === '763') return 'var_valor_razonable';
  if (d3 === '668' || d3 === '768') return 'dif_cambio';
  if (['666', '667', '673', '675', '696', '697', '698', '699', '766', '773', '775', '796', '797', '798', '799'].includes(d3)) return 'deterioro_financiero';
  // — Impuesto sobre beneficios —
  if (['6300', '6301'].includes(d4) || d3 === '633' || d3 === '638') return 'impuestos';
  return null;
}

// ── Cuenta de Pérdidas y Ganancias del periodo [from, to], derivada del diario ──
// PIEZA 4 (parte 1) — filas del diario (haber/debe por cuenta) del periodo. `opts.project` ACOTA sin
// cambiar el cálculo (solo el WHERE): undefined → todo (idéntico a siempre); <id> → asientos cuyo documento
// origen (factura de venta o recibida) es de ese proyecto; null/0/'estructura' → asientos NO atribuibles a
// ningún proyecto (estructura). La atribución resuelve el asiento → su documento por (origin_type,
// origin_id) → project_id, EN VIVO (no se guarda proyecto en el diario). invoices cubre venta+abono;
// supplier_invoices cubre compra+gasto+abono de proveedor. Partición limpia ⇒ Σ proyectos + estructura = total.
function pygRows(db, from, to, opts = {}) {
  const p = opts.project;
  if (p === undefined) {
    return db.prepare(
      `SELECT l.account_code code, ROUND(SUM(l.debit),2) debe, ROUND(SUM(l.credit),2) haber
         FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id
        WHERE e.entry_date BETWEEN ? AND ?
        GROUP BY l.account_code`).all(from, to);
  }
  const proj = 'COALESCE(iv.project_id, si.project_id)';
  const noAsignado = (p === null || p === 0 || p === 'estructura' || p === 'none');
  const where = noAsignado ? `${proj} IS NULL` : `${proj} = ?`;
  const args = noAsignado ? [from, to] : [from, to, Number(p)];
  return db.prepare(
    `SELECT l.account_code code, ROUND(SUM(l.debit),2) debe, ROUND(SUM(l.credit),2) haber
       FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id
       LEFT JOIN invoices iv ON e.origin_type='invoice' AND iv.id = e.origin_id
       LEFT JOIN supplier_invoices si ON e.origin_type='supplier_invoice' AND si.id = e.origin_id
      WHERE e.entry_date BETWEEN ? AND ? AND ${where}
      GROUP BY l.account_code`).all(...args);
}

export function cuentaPyG(db, from, to, opts = {}) {
  const rows = pygRows(db, from, to, opts);

  const imp = {};
  for (const p of PARTIDAS) imp[p.key] = 0;
  const huerfanas = [];
  let hayFinanciero = false;
  for (const r of rows) {
    const c = String(r.code);
    if (c[0] !== '6' && c[0] !== '7') continue;   // solo cuentas de resultado (grupos 6 y 7)
    const contrib = r2(r.haber - r.debe);         // haber − debe: ingresos +, gastos −
    let key = pygPartida(c);
    if (!key) { key = c[0] === '7' ? 'otros_ingresos' : 'otros_gastos'; huerfanas.push(c); }   // red de seguridad
    imp[key] = r2(imp[key] + contrib);
    if (PARTIDA_BY_KEY[key].seccion === 'financiero') hayFinanciero = true;
  }

  const sumSec = sec => r2(PARTIDAS.filter(p => p.seccion === sec).reduce((s, p) => s + imp[p.key], 0));
  const resultadoExplotacion = sumSec('explotacion');
  const resultadoFinanciero = sumSec('financiero');
  const resultadoAntesImpuestos = r2(resultadoExplotacion + resultadoFinanciero);
  const impuestos = sumSec('impuesto');
  const resultadoEjercicio = r2(resultadoAntesImpuestos + impuestos);

  const warnings = [];
  if (!hayFinanciero) warnings.push('Sin operaciones financieras en el periodo (cuentas 66x/76x): el resultado financiero queda a 0.');
  if (huerfanas.length) warnings.push(`Cuentas de resultado sin partida estándar del PGC (${[...new Set(huerfanas)].sort().join(', ')}): se han agregado a "Otros gastos/ingresos de explotación"; revísalas antes de dar el resultado por bueno.`);
  try {
    const nb = db.prepare('SELECT COUNT(*) c FROM investment_goods').get()?.c || 0;
    if (nb > 0) warnings.push('La amortización del Libro de bienes de inversión (Pieza 3) NO está incluida en esta cuenta de resultado: aún no se vuelca al diario. Se incorporará cuando se asienten la capitalización y la dotación (pieza futura).');
  } catch { /* investment_goods puede no existir en BD antiguas */ }

  const partidas = PARTIDAS.map(p => ({ key: p.key, etiqueta: p.etiqueta, nombre: p.nombre, seccion: p.seccion, importe: r2(imp[p.key]) }));
  return { from, to, partidas, resultadoExplotacion, resultadoFinanciero, resultadoAntesImpuestos, impuestos, resultadoEjercicio, warnings };
}

// ── Filas para render/export: estructura formal completa (partidas + subtotales A.1–A.4) ──
// Cada fila: [etiqueta, nombre, importe, tipo] con tipo ∈ {'partida','subtotal'}.
export function filasPyG(pyg) {
  const f = [];
  const push = p => f.push([p.etiqueta, p.nombre, p.importe, 'partida']);
  const sub = (etq, nombre, val) => f.push([etq, nombre, r2(val), 'subtotal']);
  for (const p of pyg.partidas) if (p.seccion === 'explotacion') push(p);
  sub('A.1)', 'RESULTADO DE EXPLOTACIÓN', pyg.resultadoExplotacion);
  for (const p of pyg.partidas) if (p.seccion === 'financiero') push(p);
  sub('A.2)', 'RESULTADO FINANCIERO', pyg.resultadoFinanciero);
  sub('A.3)', 'RESULTADO ANTES DE IMPUESTOS', pyg.resultadoAntesImpuestos);
  for (const p of pyg.partidas) if (p.seccion === 'impuesto') push(p);
  sub('A.4)', 'RESULTADO DEL EJERCICIO', pyg.resultadoEjercicio);
  return f;
}
