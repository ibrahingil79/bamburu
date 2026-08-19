// RENTABILIDAD POR PROYECTO — Escalera · paso 7 · PIEZA 4 (parte 1). SOLO LECTURA.
//
// Deriva la rentabilidad de cada proyecto de la MISMA cuenta de Pérdidas y Ganancias (cuentaPyG), filtrada
// por proyecto. NO recalcula por otra vía: ingresos/gastos/resultado salen del P&G del diario, acotado al
// proyecto resolviendo asiento → documento (factura de venta o recibida) → project_id, EN VIVO. Como la
// atribución particiona los MISMOS asientos, se cumple al céntimo: Σ(P&G de cada proyecto) + P&G de lo NO
// asignado (estructura) = P&G total. El "cobrado" es un dato de CAJA aparte (no cambia el resultado).
import { cuentaPyG } from './contabilidad-pyg.js';
import { margen } from './margen.js';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
// Rango "todo" para la rentabilidad total de un proyecto (el filtro real es el proyecto, no la fecha).
export const RANGO_TODO = ['0001-01-01', '9999-12-31'];

// Descompone un P&G ya calculado en ingresos (partidas +), gastos (partidas −, en positivo) y resultado.
// Por construcción ingresos − gastos = Σ partidas = resultado del ejercicio (cuadra con la P&G).
function desglosar(pyg) {
  let ingresos = 0, gastos = 0;
  for (const p of pyg.partidas) {
    if (p.importe > 0) ingresos = r2(ingresos + p.importe);
    else if (p.importe < 0) gastos = r2(gastos - p.importe);   // −importe → gasto en positivo
  }
  const resultado = r2(pyg.resultadoEjercicio);
  // El % pasa por el MOTOR ÚNICO igual que el resto de la plataforma. Aquí la "venta" son los
  // ingresos del P&G y el "coste" los gastos, y por construcción ingresos − gastos = resultado, así
  // que `m.euros` es el resultado contable y `m.pctVenta` es EXACTAMENTE el margenPct de siempre:
  // ni un número de rentabilidad por proyecto cambia de valor.
  //
  // R1 — ESTA SUPERFICIE NO OBEDECE AL AJUSTE DEL DUEÑO. Es P&G: aquí manda «sobre la venta», elija
  // lo que elija. El titular se pide con `{contable:true}` y la pantalla dice por qué.
  const m = margen({ venta: ingresos, coste: gastos, fuera: 0 });
  return { ingresos, gastos, resultado, margenPct: m.pctVenta, margen: m, contable: true };
}

// PIEZA 4 (parte 2) — COSTE DE LAS HORAS de un proyecto (capa de GESTIÓN, NO contable: no toca el diario ni
// cuentaPyG). Σ(horas × coste-hora CONGELADO) de las entradas de tiempo del proyecto que SÍ tienen coste. Las
// entradas sin coste-hora (coste_hora_congelado NULL o 0) NO son coste 0: se APARTAN y se informa cuántas horas
// quedan fuera (mismo aviso que el "sin tarifa" de la pieza 2). Solo entradas vivas y FINALIZADAS (con duración).
export function costeHorasProyecto(db, projectId, from = RANGO_TODO[0], to = RANGO_TODO[1]) {
  const rows = db.prepare(
    `SELECT coste_hora_congelado AS c, duracion_seg AS seg
       FROM time_entries
      WHERE proyecto_id = ? AND active = 1 AND duracion_seg IS NOT NULL AND fecha BETWEEN ? AND ?`)
    .all(Number(projectId), from, to);
  let coste = 0, segCon = 0, segSin = 0, nCon = 0, nSin = 0;
  for (const r of rows) {
    const seg = Number(r.seg) || 0;
    if (r.c != null && Number(r.c) > 0) { coste = r2(coste + seg / 3600 * Number(r.c)); segCon += seg; nCon++; }
    else { segSin += seg; nSin++; }
  }
  return {
    coste, seg_con_coste: segCon, horas_con_coste: r2(segCon / 3600), n_con_coste: nCon,
    seg_sin_coste: segSin, horas_sin_coste: r2(segSin / 3600), n_sin_coste: nSin,
    hay_horas_sin_coste: segSin > 0,
  };
}

// Cobrado (caja) de un proyecto: suma de cobros de sus facturas de venta en el periodo. Dato aparte.
function cobradoDe(db, projectId, from, to) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(ip.amount),0) c
       FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
      WHERE i.project_id = ? AND ip.paid_date BETWEEN ? AND ?`).get(projectId, from, to);
  return r2(row?.c || 0);
}

// Rentabilidad de UN proyecto en [from,to] (por defecto, toda su vida).
// CASCADA:  ingresos − gastos = RESULTADO CONTABLE (parte 1, fuente única cuentaPyG, INTACTO)
//                             − coste de las horas = RESULTADO DE GESTIÓN (parte 2, capa de gestión).
// `resultado` (contable) NO se toca; el coste de horas y el resultado de gestión se AÑADEN aparte.
export function rentabilidadProyecto(db, projectId, from = RANGO_TODO[0], to = RANGO_TODO[1]) {
  const pyg = cuentaPyG(db, from, to, { project: Number(projectId) });
  const d = desglosar(pyg);   // { ingresos, gastos, resultado (CONTABLE), margenPct }
  const ch = costeHorasProyecto(db, projectId, from, to);
  const resultadoGestion = r2(d.resultado - ch.coste);
  const margenGestionPct = d.ingresos > 0 ? r2(resultadoGestion / d.ingresos * 100) : null;
  return {
    project_id: Number(projectId), from, to, ...d, cobrado: cobradoDe(db, projectId, from, to),
    costeHoras: ch, resultadoGestion, margenGestionPct, pyg,
  };
}

// P&G de lo NO asignado a ningún proyecto (la "estructura": alquiler, gestoría, banca… sin proyecto).
export function rentabilidadEstructura(db, from = RANGO_TODO[0], to = RANGO_TODO[1]) {
  const pyg = cuentaPyG(db, from, to, { project: null });
  return { ...desglosar(pyg), pyg };
}

// Proyectos con actividad (aparecen en alguna factura de venta o recibida etiquetada).
function proyectosConActividad(db) {
  const ids = db.prepare(
    `SELECT project_id FROM invoices WHERE project_id IS NOT NULL
      UNION
     SELECT project_id FROM supplier_invoices WHERE project_id IS NOT NULL`).all().map(r => r.project_id);
  return [...new Set(ids)];
}

// Comparativa de proyectos: resultado + margen por proyecto, marcando en rojo los que pierden. Incluye la
// estructura y el total, y comprueba el cuadre (Σ proyectos + estructura = total) al céntimo.
export function comparativaProyectos(db, from = RANGO_TODO[0], to = RANGO_TODO[1]) {
  const activos = db.prepare('SELECT id, codigo, nombre, active FROM proyectos').all();
  const nombreDe = Object.fromEntries(activos.map(p => [p.id, p]));
  const idsActividad = new Set(proyectosConActividad(db));
  // A MOSTRAR: proyectos activos ∪ proyectos con actividad (un archivado con gasto no puede desaparecer).
  const idsMostrar = [...new Set([...activos.filter(p => p.active).map(p => p.id), ...idsActividad])];

  const filas = idsMostrar.map(id => {
    const r = rentabilidadProyecto(db, id, from, to);
    const meta = nombreDe[id] || {};
    return {
      project_id: id, codigo: meta.codigo || '', nombre: meta.nombre || ('#' + id), activo: !!meta.active,
      ingresos: r.ingresos, gastos: r.gastos, resultado: r.resultado, margenPct: r.margenPct,
      cobrado: r.cobrado, pierde: r.resultado < 0,
      // PIEZA 4 (parte 2) — coste de horas (gestión) + resultado de gestión. `pierde_gestion` = pierde tras horas.
      coste_horas: r.costeHoras.coste, resultado_gestion: r.resultadoGestion, margen_gestion_pct: r.margenGestionPct,
      horas_sin_coste: r.costeHoras.horas_sin_coste, pierde_gestion: r.resultadoGestion < 0,
    };
  }).sort((a, b) => a.resultado - b.resultado);   // los que más pierden, primero
  // Aviso agregado: horas que quedan FUERA del coste (sin coste-hora registrado) en todos los proyectos mostrados.
  const horasSinCoste = r2(filas.reduce((s, f) => s + (f.horas_sin_coste || 0), 0));
  const costeHorasTotal = r2(filas.reduce((s, f) => s + (f.coste_horas || 0), 0));

  const estructura = rentabilidadEstructura(db, from, to);
  const total = desglosar(cuentaPyG(db, from, to));   // sin filtro = P&G total (la única verdad)

  // Cuadre: Σ(resultado de proyectos CON actividad) + estructura = total. (Los activos sin actividad suman 0.)
  const sumaProyectos = r2([...idsActividad].reduce((s, id) => s + rentabilidadProyecto(db, id, from, to).resultado, 0));
  const cuadre = r2(sumaProyectos + estructura.resultado);
  const cuadra = Math.abs(cuadre - total.resultado) < 0.005;

  return {
    from, to, filas, estructura, total, cuadra, descuadre: r2(cuadre - total.resultado),
    // Capa de gestión (NO contable): agregados del coste de horas. El cuadre de arriba es SOLO del contable.
    coste_horas_total: costeHorasTotal, horas_sin_coste: horasSinCoste, hay_horas_sin_coste: horasSinCoste > 0,
  };
}
