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
import { margen as margenMotor, modoDeEmpresa, fmtEur } from './margen.js';

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
// QUÉ CUENTA COMO VISITA. Hasta hoy: una cita de agenda marcada como atendida, y NADA MÁS. En un
// negocio que factura sin usar agenda eso producía una frase falsa —«con 0 visitas todavía» a un
// cliente con 21 facturas y su última compra hace 39 días—, y una ficha que dice algo demostrablemente
// falso deja de creerse entera.
//
// La regla ahora es: **si el negocio lleva agenda, manda la agenda; si no, mandan sus documentos.**
//   · Con agenda (`usaAgenda`) → días con cita ATENDIDA. Idéntico a antes, y por tanto idéntico a lo
//     que calcula `clientesFueraDeRitmo`: el vigía y la ficha no pueden discrepar en un negocio de
//     citas, que es donde el vigía opera.
//   · Sin agenda, o con agenda pero sin ninguna cita suya → días en los que compró (facturas que
//     cuentan como venta). Es la única definición de «vino» que ese negocio tiene.
// Un día = una visita, aunque haya varias citas o varias facturas: dos facturas del mismo martes no
// son dos visitas.
function visitasDelCliente(db, clientId) {
  const dedup = (xs) => { const d = []; for (const f of xs.filter(Boolean).sort()) if (d[d.length - 1] !== f) d.push(f); return d; };
  if (usaAgenda(db)) {
    try {
      const filas = db.prepare(
        `SELECT fecha FROM citas
          WHERE cliente_id=? AND estado='atendida' AND archived=0
          ORDER BY fecha, id`).all(clientId);
      const dias = dedup(filas.map(f => f.fecha));
      if (dias.length) return { dias, fuente: 'citas' };
    } catch { /* sin tabla de agenda: se cae a documentos */ }
  }
  try {
    const dias = dedup(countingSalesInvoices(db, {}).filter(i => Number(i.client_id) === Number(clientId))
      .map(i => String(i.issue_date).slice(0, 10)));
    return { dias, fuente: 'facturas' };
  } catch { return { dias: [], fuente: 'facturas' }; }
}

export function ritmoDelCliente(db, clientId) {
  const r = visitasDelCliente(db, clientId);
  if (r.dias.length < RITMO_MIN_CITAS) {
    return { ritmo_dias: null, visitas: r.dias.length, fuente: r.fuente, dias: r.dias,
             motivo: r.dias.length
               ? 'con ' + r.dias.length + ' visita' + (r.dias.length === 1 ? '' : 's') + ' no se puede aún; hacen falta ' + RITMO_MIN_CITAS
               : 'todavía no ha venido ninguna vez',
             falta: RITMO_MIN_CITAS - r.dias.length };
  }
  const huecos = [];
  for (let i = 1; i < r.dias.length; i++) huecos.push(diasEntre(r.dias[i], r.dias[i - 1]));
  const ritmo = medianaDe(huecos);
  if (!(ritmo > 0)) return { ritmo_dias: null, visitas: r.dias.length, fuente: r.fuente, dias: r.dias,
                             motivo: 'todas sus visitas son del mismo día' };
  return { ritmo_dias: Math.round(ritmo), visitas: r.dias.length, fuente: r.fuente, dias: r.dias, motivo: null };
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
    // `fila.margen` viene del MOTOR ÚNICO: las DOS cifras, la base sobre la que se dividen y lo que
    // queda fuera por no tener coste. Se pasa entero — la pantalla NO puede enseñar el % desnudo.
    return { ...fila.margen, ventaTotal: r2(fila.base), beneficio: fila.margen.euros, pct: fila.margen.pctVenta };
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
                   cifra: h.cifra ?? null, moneda: !!h.moneda, fecha: h.fecha || null,
                   ref: h.ref || {} }));
  } catch { return null; }
}

// ── DISA RECOMIENDA, NO INFORMA (bloque C) ──────────────────────────────────────────────────────
// LO QUE MUERE AQUÍ: seis avisos idénticos en fila —«Factura F2026-0184 de Ana Suárez Campos
// vencida», «Factura F2026-0269 de Ana Suárez Campos vencida»…— uno por documento. Eso es un
// listado, y un listado no es una asistente: obliga al dueño a hacer la suma, sacar la conclusión y
// decidir él qué hacer, que era justo el trabajo que DISA tenía que ahorrarle.
//
// LO QUE SE PONE: una línea POR FAMILIA con la decisión ya formulada. Seis facturas vencidas se
// convierten en «Tiene 6 facturas vencidas por 1.255,30 €. La más antigua lleva 737 días. Te
// recomiendo gestionar el cobro de la cuenta entera», con los botones para hacerlo.
//
// CERO CÁLCULO NUEVO (C5): la cifra es la SUMA de las cifras que el vigía ya publicó y los días
// salen de su misma fecha. Si un detector cambia de criterio, esto cambia con él. Lo único que se
// añade es la frase — y la frase no es un dato, es la recomendación.
//
// Sin nada que recomendar (C6) devuelve lista vacía y el bloque NO se pinta. Nunca una caja que
// diga "todo en orden": el silencio ya lo dice, y una frase vacía ocupa el sitio de una que importe.
const FAMILIAS = [
  {
    key: 'deuda', detectores: ['deuda_vencida'],
    titulo: (n, tot, sym) => 'Tiene ' + n + ' factura' + (n === 1 ? '' : 's') + ' vencida' + (n === 1 ? '' : 's') + ' por ' + tot + ' ' + sym + '.',
    recomienda: n => n === 1 ? 'Te recomiendo reclamarla.' : 'Te recomiendo gestionar el cobro de la cuenta entera.',
    accion: { texto: 'Gestionar cuenta', tipo: 'cuenta' },
    suma: true,
  },
  {
    key: 'pago_pronto', detectores: ['pago_vence_pronto'],
    titulo: (n, tot, sym) => n + ' factura' + (n === 1 ? '' : 's') + ' está' + (n === 1 ? '' : 'n') + ' a punto de vencer (' + tot + ' ' + sym + ').',
    recomienda: () => 'Te recomiendo avisarle antes de que se pase la fecha.',
    accion: { texto: 'Gestionar cuenta', tipo: 'cuenta' },
    suma: true,
  },
  {
    key: 'dormido', detectores: ['cliente_dormido', 'fuera_de_ritmo'],
    titulo: (n, tot, sym, hs) => hs[0].titulo || 'Hace tiempo que no viene.',
    recomienda: () => 'Te recomiendo escribirle antes de que se vaya del todo.',
    accion: { texto: 'Ver su historia', tipo: 'historia' },
    suma: false,
  },
  {
    key: 'plantones', detectores: ['ausencias'],
    titulo: (n, tot, sym, hs) => hs[0].titulo || 'Ha faltado a citas.',
    recomienda: () => 'Te recomiendo confirmarle la próxima cita por teléfono.',
    accion: { texto: 'Ver sus citas', tipo: 'citas' },
    suma: false,
  },
  {
    key: 'sin_cita', detectores: ['sin_proxima_cita'],
    titulo: (n, tot, sym, hs) => hs[0].titulo || 'No tiene próxima cita.',
    recomienda: () => 'Te recomiendo cerrarle la siguiente antes de que se le olvide.',
    accion: { texto: 'Abrir la agenda', tipo: 'citas' },
    suma: false,
  },
];

export function recomendacionesDisa(db, clientId, puede, detectar) {
  const avisos = avisosDisaDe(db, clientId, puede, detectar);
  if (!avisos || !avisos.length) return [];
  const sym = db.prepare('SELECT currency_symbol s FROM company_config WHERE id=1').get()?.s || '€';
  const out = [];
  const usados = new Set();
  for (const fam of FAMILIAS) {
    const hs = avisos.filter(a => fam.detectores.includes(a.detector));
    if (!hs.length) continue;
    hs.forEach(h => usados.add(h));
    const total = r2(hs.reduce((x, h) => x + (Number(h.cifra) || 0), 0));
    // Los días de la MÁS ANTIGUA salen de la fecha que el propio vigía publicó. Sin fecha, no se
    // inventa una antigüedad: la frase se queda sin esa parte.
    const fechas = hs.map(h => h.fecha).filter(Boolean).sort();
    const dias = fechas.length ? diasEntre(hoyISO(), fechas[0]) : null;
    out.push({
      key: fam.key,
      n: hs.length,
      titulo: fam.titulo(hs.length, fam.suma ? fmtEur(total, '').trim() : null, sym, hs),
      antiguedad: (fam.suma && dias != null && dias > 0)
        ? 'La más antigua lleva ' + dias + ' día' + (dias === 1 ? '' : 's') + '.' : null,
      recomienda: fam.recomienda(hs.length),
      accion: fam.accion,
      total: fam.suma ? total : null,
      // Los documentos que hay detrás, para el detalle. NO se pintan en fila: se abren si se piden.
      detras: hs.map(h => ({ titulo: h.titulo, detalle: h.detalle, fecha: h.fecha, cifra: h.cifra,
                             invoice_id: h.ref?.invoice_id || null })),
    });
  }
  // Un detector que no encaje en ninguna familia NO se pierde: sale con su propio texto, uno por
  // detector (no por documento). Preferimos una línea genérica a esconder un aviso.
  const sueltos = new Map();
  for (const a of avisos) {
    if (usados.has(a)) continue;
    const e = sueltos.get(a.detector) || { key: a.detector, n: 0, titulo: a.titulo, recomienda: null,
                                           accion: null, antiguedad: null, total: null, detras: [] };
    e.n++; e.detras.push({ titulo: a.titulo, detalle: a.detalle, fecha: a.fecha, cifra: a.cifra });
    if (e.n > 1) e.titulo = a.etiqueta + ': ' + e.n + ' avisos';
    sueltos.set(a.detector, e);
  }
  return out.concat([...sueltos.values()]);
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
    out.margen_modo = modoDeEmpresa(db);   // qué porcentaje manda como titular (G2)
  } else {
    // Sin permiso de facturas no viaja NADA de dinero. Ni a 0: no llega.
    out.gasto = null; out.ticket_medio = null; out.deuda = null; out.margen = null;
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// EL DETALLE DE CADA TARJETA (D2) — por qué esa cifra vale eso
//
// Una tarjeta que no se puede abrir es un número que hay que creerse. Cada una de las ocho abre la
// lista de documentos de la que sale, para que el dueño pueda sumarla a mano si le apetece — que es
// exactamente el remedio del fallo de 0.2: el 36,3 % dejaba de ser comprobable porque su denominador
// no aparecía en ninguna parte.
//
// NO SE CALCULA NADA NUEVO AQUÍ. Se listan las mismas facturas que ya sumaron las cifras de la
// cabecera, con la misma regla de venta (`countingSalesInvoices`). Si la lista y el titular no
// cuadraran, el titular estaría mal, no la lista.
//
// PERMISOS: la clave que no tenga permiso devuelve null y la ruta responde 403. `clients.read` no
// abre facturas.
const TARJETAS = ['desde', 'ultima', 'ritmo', 'gasto', 'doce', 'ticket', 'deuda', 'margen'];
export const CLAVES_TARJETA = TARJETAS;

// Las facturas de este cliente que cuentan como venta, ya ordenadas de la más nueva a la más vieja.
function facturasDe(db, clientId, desde = null) {
  return countingSalesInvoices(db, desde ? { from: desde } : {})
    .filter(i => Number(i.client_id) === Number(clientId))
    .sort((a, b) => (a.issue_date < b.issue_date ? 1 : a.issue_date > b.issue_date ? -1 : b.id - a.id));
}

const filaFactura = i => ({
  clave: 'F' + i.id,
  titulo: i.invoice_number || ('Factura ' + i.id),
  fecha: String(i.issue_date || '').slice(0, 10),
  importe: r2(Number(i.subtotal) || 0),
  detalle: 'sin IVA',
  href: '/admin/invoices/' + i.id,
});

export function detalleTarjeta(db, cliente, clave, puede) {
  const clientId = cliente.id;
  const sym = db.prepare('SELECT currency_symbol s FROM company_config WHERE id=1').get()?.s || '€';
  const dinero = k => (k === 'desde' || k === 'ultima' || k === 'ritmo') ? false : true;
  if (!TARJETAS.includes(clave)) return null;
  if (dinero(clave) && !puede('invoices.read')) return null;

  if (clave === 'desde' || clave === 'ultima') {
    // El primer / último documento REAL. Aquí sí entran las citas: en una peluquería el primer
    // contacto es una cita, y contar solo facturas diría que un cliente de dos años es de ayer.
    const eventos = [];
    if (puede('invoices.read')) for (const i of facturasDe(db, clientId)) eventos.push(filaFactura(i));
    if (puede('citas.read')) {
      try {
        for (const r of db.prepare(
          "SELECT id,fecha,hora_inicio FROM citas WHERE cliente_id=? AND estado='atendida' AND archived=0").all(clientId))
          eventos.push({ clave: 'C' + r.id, titulo: 'Cita atendida', fecha: r.fecha,
                         detalle: r.hora_inicio || '', importe: null, href: '/admin/citas?fecha=' + r.fecha });
      } catch { /* sin agenda */ }
    }
    eventos.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
    if (!eventos.length) return { clave, titulo: clave === 'desde' ? 'Cliente desde' : 'Última vez que vino',
                                  vacio: 'Todavía no tiene ningún documento ni ninguna cita atendida.', filas: [] };
    const uno = clave === 'desde' ? eventos[eventos.length - 1] : eventos[0];
    return {
      clave,
      titulo: clave === 'desde' ? 'Su primer documento' : 'Lo último que hizo contigo',
      nota: clave === 'desde'
        ? 'La fecha de «Cliente desde» es la de este documento, no la del alta en la base (' + ((cliente.created_at || '').slice(0, 10) || 'sin fecha de alta') + ').'
        : 'De aquí sale «Última vez que vino».',
      filas: [uno],
      // El resto, por si quiere ver el contexto sin salir de la capa.
      masTitulo: eventos.length > 1 ? 'Todo lo demás, de lo más reciente a lo más antiguo' : null,
      mas: eventos.filter(e => e !== uno).slice(0, 50),
      sym,
    };
  }

  if (clave === 'ritmo') {
    // Sus visitas CON EL HUECO entre cada una: la mediana de esos huecos es el ritmo. Se enseña la
    // lista para que se vea de dónde sale la mediana y por qué no es la media.
    const r = ritmoDelCliente(db, clientId);
    const filas = [];
    for (let i = r.dias.length - 1; i >= 0; i--) {
      const hueco = i > 0 ? diasEntre(r.dias[i], r.dias[i - 1]) : null;
      filas.push({ clave: 'V' + r.dias[i], titulo: hueco == null ? 'Primera visita' : hueco + ' días después',
                   fecha: r.dias[i], importe: null, detalle: '' });
    }
    return {
      clave, titulo: 'Sus visitas',
      nota: r.fuente === 'citas'
        ? 'Una visita = un día con cita atendida. El ritmo es la MEDIANA de los huecos, no la media: una visita rara no puede mover el ritmo de nadie.'
        : 'Este negocio no lleva agenda, así que una visita = un día en el que te compró. El ritmo es la MEDIANA de los huecos, no la media.',
      vacio: filas.length ? null : 'Todavía no ha venido ninguna vez.',
      resumen: r.ritmo_dias ? 'Viene cada ' + r.ritmo_dias + ' días de media' : (r.motivo || null),
      filas, sym,
    };
  }

  if (clave === 'gasto' || clave === 'doce' || clave === 'ticket') {
    const desde = clave === 'doce' ? haceMeses(12) : null;
    const fac = facturasDe(db, clientId, desde);
    const suma = r2(fac.reduce((x, i) => x + (Number(i.subtotal) || 0), 0));
    const titulos = { gasto: 'Todas sus facturas', doce: 'Sus facturas de los últimos 12 meses',
                      ticket: 'Las facturas que forman la media' };
    return {
      clave, titulo: titulos[clave],
      nota: clave === 'ticket'
        ? 'El ticket medio es esta suma dividida entre el número de facturas: ' + suma + ' / ' + fac.length + '.'
        : 'Base sin IVA. Las facturas anuladas no suman —aunque siguen en su historia—, y los abonos restan.',
      resumen: clave === 'ticket' && fac.length
        ? 'Media de ' + r2(suma / fac.length) + ' ' + sym + ' por factura'
        : suma + ' ' + sym + ' en ' + fac.length + ' factura' + (fac.length === 1 ? '' : 's'),
      vacio: fac.length ? null : (clave === 'doce' ? 'No te ha comprado nada en los últimos 12 meses.' : 'Todavía no le has facturado nada.'),
      filas: fac.map(filaFactura), total: suma, sym,
    };
  }

  if (clave === 'deuda') {
    // Esta tarjeta NO devuelve una lista muerta: la pinta la pantalla con la maquinaria de cobro que
    // ya existe (registrar cobro, gestionar, gestionar cuenta). Aquí solo va lo que hace falta para
    // encabezarla; el detalle lo pide el navegador al endpoint de siempre.
    if (!puede('cobros.read') && !puede('invoices.read')) return null;
    const d = clientDebt(db, clientId, hoyISO());
    return { clave, titulo: 'Gestión de cobro', gestion: true, sym,
             total: r2(d.total), oldest: d.oldest || null,
             vacio: r2(d.total) > 0 ? null : 'No te debe nada ahora mismo.' };
  }

  // ── MARGEN: el desglose que faltaba ────────────────────────────────────────────────────────────
  // Documento a documento, con las dos bases separadas: lo que tiene coste y lo que no. Es la
  // respuesta física a «de dónde sale ese porcentaje»: el denominador está aquí, sumable a mano.
  const fac = facturasDe(db, clientId);
  const filas = [];
  let venta = 0, coste = 0, fuera = 0;
  for (const i of fac) {
    let lineas = [];
    try { lineas = db.prepare('SELECT quantity, total_price, unit_cost FROM invoice_items WHERE invoice_id=?').all(i.id); }
    catch { lineas = []; }
    let v = 0, c = 0, f = 0;
    for (const l of lineas) {
      const base = Number(l.total_price) || 0;
      if (l.unit_cost == null) { f += base; continue; }
      v += base; c += (Number(l.unit_cost) || 0) * (Number(l.quantity) || 0);
    }
    venta += v; coste += c; fuera += f;
    filas.push({ clave: 'F' + i.id, titulo: i.invoice_number || ('Factura ' + i.id),
                 fecha: String(i.issue_date || '').slice(0, 10), href: '/admin/invoices/' + i.id,
                 venta: r2(v), coste: r2(c), euros: v ? r2(v - c) : null, fuera: r2(f) });
  }
  const m = margenMotor({ venta, coste, fuera });
  return { clave, titulo: 'De dónde sale el margen', margen: m, modo: modoDeEmpresa(db), sym,
           vacio: filas.length ? null : 'Todavía no le has facturado nada.',
           filas };
}
