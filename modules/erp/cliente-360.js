// ════════════════════════════════════════════════════════════════════════════════════════════════
// FICHA DE CLIENTE 360 — el motor de lectura
//
// La ficha era una FICHA DE COBROS: deuda, facturas y poco más. Esto la convierte en la historia del
// cliente. Y lo hace SIN calcular ni una cifra por su cuenta.
//
// LA REGLA QUE MANDA EN ESTE FICHERO: cero cálculos paralelos. Cada número sale del motor que YA lo
// produce y que ya se enseña en su pantalla —cobros, ventas, el constructor, la agenda, el vigía—, de
// modo que la ficha no puede discrepar con el sitio del que salió. Si un dato NO tiene motor, aquí se
// devuelve `null` y la pantalla pinta «—» con su explicación. **Nunca 0, nunca estimado.** Un cero
// inventado en una ficha de cliente es peor que un hueco: el hueco se pregunta, el cero se cree.
//
// PERMISOS: no se inventa ninguno. Se recibe `puede(permiso)` y CADA bloque se calcula solo si su
// permiso está. Lo que no se puede ver no viaja al navegador — no se pinta en gris, no llega. El
// filtrado es del servidor; la pantalla solo pinta lo que le dieron.
import { clientDebt } from './cobros.js';
import { countingSalesInvoices } from './ventas-metrics.js';
import { cruzar } from './constructor-analitica.js';
import { clientCrmSummary } from './crm.js';
import { RITMO_MIN_CITAS, usaAgenda } from './vigia-agenda.js';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const hoyISO = () => new Date().toISOString().slice(0, 10);
const haceMeses = (n, ref = hoyISO()) => {
  const d = new Date(ref + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
};
const diasEntre = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);

// ── EL RITMO PROPIO, EL MISMO QUE USA EL DETECTOR DE ENFRIAMIENTO ────────────────────────────────
// Se calcula con las MISMAS piezas y los MISMOS umbrales que `clientesFueraDeRitmo`: visitas
// atendidas (una por día), mediana de los huecos entre ellas —mediana y no media, porque una visita
// rara no puede mover el ritmo de nadie— y, con menos de RITMO_MIN_CITAS visitas, NO se inventa
// ritmo: se devuelve null y la ficha dice cuántas visitas faltan. Si esto y el vigía dijeran cosas
// distintas para el mismo cliente, uno de los dos estaría mintiendo.
function medianaDe(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function ritmoDelCliente(db, clientId) {
  if (!usaAgenda(db)) return { ritmo_dias: null, visitas: 0, motivo: 'este negocio no usa agenda' };
  let filas = [];
  try {
    filas = db.prepare(
      `SELECT fecha FROM citas
        WHERE cliente_id=? AND estado='atendida' AND archived=0
        ORDER BY fecha, id`).all(clientId);
  } catch { return { ritmo_dias: null, visitas: 0, motivo: 'sin datos de agenda' }; }
  const dias = [];
  for (const f of filas) if (dias[dias.length - 1] !== f.fecha) dias.push(f.fecha);
  if (dias.length < RITMO_MIN_CITAS) {
    return { ritmo_dias: null, visitas: dias.length,
             motivo: 'con ' + dias.length + ' visita' + (dias.length === 1 ? '' : 's') + ' todavía no se puede saber su ritmo (hacen falta ' + RITMO_MIN_CITAS + ')' };
  }
  const huecos = [];
  for (let i = 1; i < dias.length; i++) huecos.push(diasEntre(dias[i], dias[i - 1]));
  const ritmo = medianaDe(huecos);
  if (!(ritmo > 0)) return { ritmo_dias: null, visitas: dias.length, motivo: 'todas sus visitas son del mismo día' };
  return { ritmo_dias: Math.round(ritmo), visitas: dias.length, motivo: null };
}

// ── CUÁNDO EMPEZÓ Y CUÁNDO VINO LA ÚLTIMA VEZ ───────────────────────────────────────────────────
// «Cliente desde» es la fecha de su PRIMER DOCUMENTO REAL, no la del alta: al autónomo le importa
// desde cuándo le compra, no desde cuándo está en la base. Cuentan las facturas que cuentan como
// venta (las de mostrador CON cliente son facturas, así que entran por aquí) y las CITAS ATENDIDAS
// — en una peluquería el primer contacto es una cita, y dejarla fuera diría que un cliente de dos
// años es de ayer. La fecha de alta no se pierde: sigue en los datos fijos, diciendo lo que es.
function fechasDeDocumentos(db, clientId, puede) {
  const fac = [], citas = [];
  if (puede('invoices.read')) {
    for (const i of countingSalesInvoices(db, {})) if (i.client_id === clientId) fac.push(i.issue_date);
  }
  if (puede('citas.read')) {
    try {
      for (const r of db.prepare(
        "SELECT fecha FROM citas WHERE cliente_id=? AND estado='atendida' AND archived=0").all(clientId)) citas.push(r.fecha);
    } catch { /* sin agenda */ }
  }
  const todas = fac.concat(citas).filter(Boolean).sort();
  return { primera: todas[0] || null, ultima: todas[todas.length - 1] || null, hayFacturas: fac.length > 0, hayCitas: citas.length > 0 };
}

// ── LO QUE HA GASTADO ───────────────────────────────────────────────────────────────────────────
// Base sin IVA y con la MISMA regla de venta que el resto del sistema (`countingSalesInvoices`, que
// es la que decide qué cuenta y qué no). Una factura anulada NO suma — y aun así SALE en la línea de
// tiempo, marcada, porque pasó. Las rectificativas netean por su total, como en Ventas.
function gastoDe(db, clientId, desde) {
  let base = 0, n = 0;
  for (const i of countingSalesInvoices(db, desde ? { from: desde } : {})) {
    if (i.client_id !== clientId) continue;
    base += Number(i.subtotal) || 0; n++;
  }
  return { base: r2(base), facturas: n };
}

// ── EL MARGEN QUE DEJA ──────────────────────────────────────────────────────────────────────────
// Sale del constructor, área Ventas cruzada por Cliente, que es la pantalla donde el dueño lo ve. NO
// se recalcula aquí. Y respeta su regla: lo que no tiene coste conocido se aparta en vez de contarse
// como margen del 100 %. Si de este cliente no se conoce ningún coste, esto devuelve null → «—».
function margenDe(db, clientId, nombre, puede) {
  if (!puede('invoices.read') || !puede('clients.read')) return null;
  try {
    const r = cruzar(db, {
      area: 'ventas', dimension: 'cliente', medidas: ['base', 'coste', 'beneficio', 'margenPct'],
      limit: 5000, hasPerm: puede,
    });
    const fila = (r.filas || []).find(f => f.clave === nombre);
    if (!fila) return null;
    // `beneficio`/`margenPct` vienen a null cuando no hay coste conocido: se respeta tal cual.
    if (fila.beneficio == null || fila.margenPct == null) return { beneficio: null, pct: null, sinCoste: true };
    return { beneficio: r2(fila.beneficio), pct: fila.margenPct, sinCoste: false };
  } catch { return null; }
}

// ── QUÉ COMPRA ──────────────────────────────────────────────────────────────────────────────────
// Sus servicios y productos más repetidos de los últimos 12 meses, por veces y por importe, con la
// MISMA regla de venta: solo entran las facturas que cuentan.
export function queCompra(db, clientId, puede, meses = 12) {
  if (!puede('invoices.read')) return null;
  const desde = haceMeses(meses);
  const ids = countingSalesInvoices(db, { from: desde }).filter(i => i.client_id === clientId).map(i => i.id);
  if (!ids.length) return [];
  const map = new Map();
  const ph = ids.map(() => '?').join(',');
  let lineas = [];
  try {
    lineas = db.prepare(
      // `total_price` es el importe de la línea SIN IVA (el IVA va aparte, en tax_amount): la misma
      // base con la que se cuenta la venta en el resto del sistema.
      `SELECT description AS nombre, quantity AS uds, total_price AS base FROM invoice_items WHERE invoice_id IN (${ph})`
    ).all(...ids);
  } catch { return null; }
  for (const l of lineas) {
    const k = (l.nombre || '').trim() || '(sin nombre)';
    const e = map.get(k) || { nombre: k, veces: 0, uds: 0, base: 0 };
    e.veces++; e.uds += Number(l.uds) || 0; e.base += Number(l.base) || 0;
    map.set(k, e);
  }
  return [...map.values()].map(e => ({ ...e, base: r2(e.base) }))
    .sort((a, b) => b.veces - a.veces || b.base - a.base).slice(0, 8);
}

// ── LOS CONTADORES DE LA CABECERA ───────────────────────────────────────────────────────────────
// Cada uno abre su lista YA filtrada por este cliente. Se devuelven TODOS los que el usuario puede
// ver, incluso con 0 — un 0 es información («no ha pedido cita nunca»), y esconderlo sería contar
// solo lo bonito. Lo que NO se puede ver, no viaja.
export function contadoresDe(db, clientId, puede, deuda) {
  const c = [];
  const cuenta = (sql, ...args) => { try { return db.prepare(sql).get(...args).n; } catch { return 0; } };
  if (puede('citas.read')) c.push({ key: 'citas', etiqueta: 'Citas', icon: 'ti-calendar-event',
    n: cuenta("SELECT COUNT(*) n FROM citas WHERE cliente_id=? AND archived=0", clientId),
    href: '/admin/citas' });
  if (puede('invoices.read')) c.push({ key: 'facturas', etiqueta: 'Facturas', icon: 'ti-file-invoice',
    n: cuenta('SELECT COUNT(*) n FROM invoices WHERE client_id=?', clientId),
    href: '/admin/invoices?cliente=' + clientId });
  if (puede('crm.read')) c.push({ key: 'oportunidades', etiqueta: 'Oportunidades', icon: 'ti-target-arrow',
    n: cuenta('SELECT COUNT(*) n FROM opportunities WHERE client_id=? AND active=1', clientId),
    href: '/admin/crm' });
  if (puede('proyectos.read')) c.push({ key: 'proyectos', etiqueta: 'Proyectos', icon: 'ti-folders',
    n: cuenta('SELECT COUNT(*) n FROM proyectos WHERE cliente_id=? AND active=1', clientId),
    href: '/admin/proyectos' });
  if (puede('invoices.read')) c.push({ key: 'deuda', etiqueta: 'Deuda', icon: 'ti-cash',
    n: null, eur: deuda ? deuda.total : 0, href: '/admin/cobros' });
  return c;
}

// ── LO QUE DISA VE DE ÉL ────────────────────────────────────────────────────────────────────────
// Los avisos que el vigía YA calcula, filtrados por este cliente. Mismo texto y misma cifra que en
// la pantalla del vigía: se le pide a él y se filtra, no se vuelve a detectar nada. Si algún día un
// detector cambia de criterio, la ficha cambia con él sin que nadie la toque.
export function avisosDisaDe(db, clientId, puede, detectar) {
  if (!puede('analytics.read')) return null;
  try {
    const res = detectar(db, { hoy: hoyISO() });
    // El cliente del hallazgo vive en `ref`, no en la raíz: `ref.client_id`. Buscarlo arriba devolvía
    // cero avisos SIEMPRE, y una ficha que nunca dice nada parece una ficha tranquila.
    return (res.hallazgos || [])
      .filter(h => Number(h?.ref?.client_id) === Number(clientId))
      .map(h => ({ detector: h.detector, etiqueta: h.detectorEtiqueta, area: h.areaEtiqueta || '',
                   titulo: h.titulo || '', detalle: h.motivo || '',
                   cifra: h.cifra ?? null, moneda: !!h.moneda, fecha: h.fecha || null }));
  } catch { return null; }
}

// ── LA CABECERA DE CIFRAS ───────────────────────────────────────────────────────────────────────
export function cabecera360(db, cliente, puede) {
  const clientId = cliente.id;
  const hoy = hoyISO();
  const out = { moneda: db.prepare('SELECT currency_symbol s FROM company_config WHERE id=1').get()?.s || '€' };

  const f = fechasDeDocumentos(db, clientId, puede);
  out.desde = f.primera
    ? { fecha: f.primera, alta: (cliente.created_at || '').slice(0, 10) || null }
    // NUNCA en blanco: si no hay documento, se dice eso mismo y se enseña la fecha de alta.
    : { fecha: null, alta: (cliente.created_at || '').slice(0, 10) || null,
        nota: 'Aún no te ha comprado' };
  out.ultima = f.ultima ? { fecha: f.ultima, dias: diasEntre(hoy, f.ultima) } : null;

  const ritmo = puede('citas.read') ? ritmoDelCliente(db, clientId) : null;
  out.ritmo = ritmo;

  if (puede('invoices.read')) {
    const total = gastoDe(db, clientId, null);
    const anio = gastoDe(db, clientId, haceMeses(12));
    out.gasto = { total: total.base, doce_meses: anio.base, facturas: total.facturas };
    out.ticket_medio = total.facturas ? r2(total.base / total.facturas) : null;
    const d = clientDebt(db, clientId, hoy);
    out.deuda = { total: r2(d.total), oldest: d.oldest || null };
    out.margen = margenDe(db, clientId, cliente.name, puede);
  } else {
    // Sin permiso de facturas no viaja NADA de dinero. Ni a 0: no llega.
    out.gasto = null; out.ticket_medio = null; out.deuda = null; out.margen = null;
  }
  return out;
}
