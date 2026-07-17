// ════════════════════════════════════════════════════════════════════════════
// PLAN FINANCIERO — objetivos vs. real. Escalera · paso 3 · bloque 2.
//
// El dueño fija metas de FACTURACIÓN y de BENEFICIO, por MES / TRIMESTRE / AÑO, para el negocio
// entero o para cada responsable. Esto compara cada meta contra lo real y da la desviación.
//
// LAS TRES DECISIONES QUE LO SOSTIENEN (dueño, 17 jul 2026):
//
// 1. **BENEFICIO = MARGEN**, no el resultado del P&G. Son dos números distintos y elegir mal habría
//    hecho mentir al plan entero: `cuentaPyG` resta TODOS los gastos (alquiler, software, sueldos) y
//    el margen solo el coste de lo vendido. Se elige el margen porque (a) **cuadra en los tres
//    alcances** —global = Σ responsables + sin asignar—, y el P&G NO puede hacerlo (el libro contable
//    no sabe de responsables: un asiento de alquiler no es de nadie); y (b) es lo que un comercial
//    **puede mover**. El P&G sigue siendo la única verdad del resultado del negocio, en Contabilidad.
//    *Contrapartida, y por eso el aviso:* el margen solo juzga las ventas que tienen coste conocido.
//
// 2. **Todo sin IVA.** El IVA no es del negocio.
//
// 3. **Los niveles NO se fuerzan a cuadrar.** El dueño fija el nivel que quiera; si sus tres meses no
//    suman su trimestre, no es un error: son metas, no contabilidad. Forzarlo obligaría a inventar
//    metas que nadie puso.
//
// NO recalcula nada: el real sale de `ventasPorPeriodo` (facturación) y `margenResumen` (beneficio),
// que son la fuente única y ya están verificados. Aquí solo se compara.
import { ventasPorPeriodo, margenResumen, clavePeriodo, PERIODOS, SIN_ASIGNAR,
         countingSalesInvoices, SQL_RESPONSABLE, SQL_RESPONSABLE_JOIN } from './ventas-metrics.js';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

export const TIPOS = ['facturacion', 'beneficio'];
export const ALCANCES = ['global', 'responsable'];

// Rango de fechas de una clave de periodo. Es la inversa de `clavePeriodo()`: '2026-T3' → 1-jul a
// 30-sep. Se deriva de la propia clave, sin tabla de calendario que se quede vieja.
export function rangoDePeriodo(periodo, clave) {
  const s = String(clave || '');
  if (periodo === 'anio') return { from: s + '-01-01', to: s + '-12-31' };
  if (periodo === 'trimestre') {
    const y = s.slice(0, 4), t = Number(s.slice(6)) || 1;
    const m0 = (t - 1) * 3 + 1;
    const finMes = m0 + 2;
    const ultimo = new Date(Number(y), finMes, 0).getDate();   // día 0 del mes siguiente = último del mes
    return { from: `${y}-${String(m0).padStart(2, '0')}-01`, to: `${y}-${String(finMes).padStart(2, '0')}-${ultimo}` };
  }
  const y = s.slice(0, 4), m = s.slice(5, 7);
  const ultimo = new Date(Number(y), Number(m), 0).getDate();
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${ultimo}` };
}

// ── OBJETIVOS: guardar y leer ────────────────────────────────────────────────
// Fijar la misma meta dos veces la SUSTITUYE (índice único). Valor 0 o negativo BORRA la meta: es
// como el usuario "quita" un objetivo sin necesitar un botón aparte ni un estado "meta a cero" que
// nadie sabría interpretar.
export function fijarObjetivo(db, { tipo, periodo, clave, alcance, user_id = null, valor }) {
  if (!TIPOS.includes(tipo)) { const e = new Error('Tipo de objetivo no válido'); e.status = 400; throw e; }
  if (!PERIODOS.includes(periodo)) { const e = new Error('Periodo no válido'); e.status = 400; throw e; }
  if (!ALCANCES.includes(alcance)) { const e = new Error('Alcance no válido'); e.status = 400; throw e; }
  if (!String(clave || '').trim()) { const e = new Error('Falta el periodo concreto'); e.status = 400; throw e; }
  // La clave TIENE que tener la forma que produce `clavePeriodo`, o la comparación con lo real no
  // encontraría nada y el plan diría "0 € reales" tan tranquilo. Se valida aquí, no en la pantalla.
  const formas = { mes: /^\d{4}-\d{2}$/, trimestre: /^\d{4}-T[1-4]$/, anio: /^\d{4}$/ };
  if (!formas[periodo].test(String(clave))) {
    const e = new Error(`El periodo "${clave}" no tiene la forma de un ${periodo} (${periodo === 'mes' ? '2026-07' : periodo === 'trimestre' ? '2026-T3' : '2026'})`);
    e.status = 400; throw e;
  }
  const uid = alcance === 'responsable' ? (Number(user_id) || null) : null;
  if (alcance === 'responsable' && !uid) { const e = new Error('Un objetivo de responsable necesita a quién'); e.status = 400; throw e; }
  const v = Number(valor) || 0;
  if (v <= 0) {
    db.prepare(`DELETE FROM financial_targets WHERE tipo=? AND periodo=? AND clave=? AND alcance=? AND COALESCE(user_id,0)=?`)
      .run(tipo, periodo, clave, alcance, uid || 0);
    return { borrado: true };
  }
  db.prepare(`INSERT INTO financial_targets (tipo, periodo, clave, alcance, user_id, valor, updated_at)
              VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)
              ON CONFLICT (tipo, periodo, clave, alcance, COALESCE(user_id, 0))
              DO UPDATE SET valor=excluded.valor, updated_at=CURRENT_TIMESTAMP`)
    .run(tipo, periodo, clave, alcance, uid, r2(v));
  return { ok: true };
}

export function listarObjetivos(db, { periodo = null } = {}) {
  const w = periodo ? ' WHERE t.periodo = ?' : '';
  return db.prepare(
    `SELECT t.*, u.name AS user_name FROM financial_targets t
       LEFT JOIN admin_users u ON u.id = t.user_id${w} ORDER BY t.clave DESC, t.tipo, t.alcance`
  ).all(...(periodo ? [periodo] : []));
}

// ── EL REAL ──────────────────────────────────────────────────────────────────
// Facturación real de un periodo/alcance. `ventasPorPeriodo` ya lo da; aquí solo se elige la fila.
function facturacionReal(db, periodo, clave, user_id) {
  const filas = ventasPorPeriodo(db, { periodo, responsable_id: user_id === null ? undefined : user_id });
  return (filas.find(f => f.periodo === clave) || { base: 0 }).base;
}

// Beneficio real (= MARGEN) de un periodo/alcance. Global reutiliza `margenResumen` tal cual. Por
// responsable hay que acotar a SUS facturas antes de sumar el margen — la cascada del responsable ya
// vive en `ventas-metrics.js` y se reutiliza su join; no se reescribe la regla.
function beneficioReal(db, periodo, clave, user_id) {
  const { from, to } = rangoDePeriodo(periodo, clave);
  if (user_id === null) {
    const m = margenResumen(db, { from, to });
    return { beneficio: m.beneficio, sinCoste: m.sinCoste, ingresosConCoste: m.ingresosConCoste };
  }
  const facturas = countingSalesInvoices(db, { from, to });
  if (!facturas.length) return { beneficio: 0, sinCoste: 0, ingresosConCoste: 0 };
  const ph = facturas.map(() => '?').join(',');
  const suyas = db.prepare(
    `SELECT i.id, ${SQL_RESPONSABLE} FROM invoices i ${SQL_RESPONSABLE_JOIN} WHERE i.id IN (${ph})`
  ).all(...facturas.map(f => f.id)).filter(f => (f.responsable_id ?? null) === user_id).map(f => f.id);
  if (!suyas.length) return { beneficio: 0, sinCoste: 0, ingresosConCoste: 0 };
  const ph2 = suyas.map(() => '?').join(',');
  const lineas = db.prepare(
    `SELECT quantity, total_price, unit_cost FROM invoice_items WHERE invoice_id IN (${ph2})`
  ).all(...suyas);
  let ingresosConCoste = 0, coste = 0, sinCoste = 0;
  for (const l of lineas) {
    const base = Number(l.total_price) || 0;
    // MISMA regla que `margenResumen`: sin coste conocido NO es margen del 100 %, se aparta.
    if (l.unit_cost == null) { sinCoste += base; continue; }
    ingresosConCoste += base;
    coste += (Number(l.unit_cost) || 0) * (Number(l.quantity) || 0);
  }
  return { beneficio: r2(ingresosConCoste - coste), sinCoste: r2(sinCoste), ingresosConCoste: r2(ingresosConCoste) };
}

// ── LA COMPARACIÓN ───────────────────────────────────────────────────────────
// Una fila por objetivo fijado: meta, real, desviación en importe y en %. Nada de metas inventadas:
// si el dueño no fijó nada para un periodo, ese periodo NO sale — un plan lleno de ceros que nadie
// puso sería ruido disfrazado de información.
export function planFinanciero(db, { periodo = null } = {}) {
  const filas = listarObjetivos(db, { periodo }).map(o => {
    const uid = o.alcance === 'responsable' ? o.user_id : null;
    let real = 0, aviso = null;
    if (o.tipo === 'facturacion') {
      real = facturacionReal(db, o.periodo, o.clave, uid);
    } else {
      const b = beneficioReal(db, o.periodo, o.clave, uid);
      real = b.beneficio;
      // El aviso NO es decorativo: sin él, un beneficio bajo se lee como "voy fatal" cuando en
      // realidad la mitad de las ventas ni siquiera se está juzgando. Misma honestidad que
      // Rentabilidad (paso 2).
      if (b.sinCoste > 0) aviso = { sinCoste: b.sinCoste, ingresosConCoste: b.ingresosConCoste };
    }
    const desviacion = r2(real - o.valor);
    return {
      id: o.id, tipo: o.tipo, periodo: o.periodo, clave: o.clave, alcance: o.alcance,
      user_id: o.user_id, responsable: o.alcance === 'global' ? 'Todo el negocio' : (o.user_name || SIN_ASIGNAR),
      objetivo: r2(o.valor), real: r2(real), desviacion,
      desviacionPct: o.valor ? r2(desviacion / o.valor * 100) : null,
      cumplido: real >= o.valor, aviso,
    };
  });
  return filas;
}
