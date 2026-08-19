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
// Contactos y perfil de oficio: los dos existían ya, y de los dos se LEE — no se inventa un sistema
// paralelo para saber qué funciones usa un negocio (0.4).
import { contactosDe, visitasDetalle, ultimoContacto, diasDeVisita, TIPOS as TIPOS_CONTACTO } from './contactos.js';
import { vocabulario } from './oficios.js';
import { getLayoutRaw, setLayout } from './inicio-layout.js';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

// ── LA LISTA DE VENTAS, UNA SOLA VEZ POR PETICIÓN ───────────────────────────────────────────────
// `countingSalesInvoices(db, {})` recorre TODAS las facturas del negocio y decide una por una si
// cuentan como venta. Cuesta unos 55 ms en un tenant mediano — y esta pantalla la pedía CUATRO
// veces (la fecha del primer documento, el gasto total, el gasto del periodo y los días de visita),
// que son 220 ms de repetir el mismo trabajo. Se memoriza por `db`, con la lista congelada mientras
// dure la petición; entre peticiones se vuelve a pedir, porque para entonces puede haber cambiado.
//
// NO cambia ni una regla: es exactamente la misma lista, pedida una vez en vez de cuatro.
const _cacheVentas = new WeakMap();
function ventasDelNegocio(db) {
  if (_cacheVentas.has(db)) return _cacheVentas.get(db);
  const lista = countingSalesInvoices(db, {});
  _cacheVentas.set(db, lista);
  // La caché vive lo que tarda el turno actual del bucle de eventos: en una petición síncrona de
  // better-sqlite3 eso es exactamente «esta petición», y ni un milisegundo más.
  queueMicrotask(() => _cacheVentas.delete(db));
  return lista;
}
// Con filtro de fechas: se filtra la lista ya calculada en vez de volver a barrer la tabla.
function ventasEntre(db, desde = null, hasta = null) {
  if (!desde && !hasta) return ventasDelNegocio(db);
  return ventasDelNegocio(db).filter(i => {
    const f = String(i.issue_date || '').slice(0, 10);
    return (!desde || f >= desde) && (!hasta || f <= hasta);
  });
}
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
// LA REGLA (D4, no negociable): visita = **cita atendida, factura, venta de mostrador con cliente y
// presencial apuntado a mano**. NO cuentan correos, WhatsApp ni llamadas, y NUNCA lo automático que
// manda Bamburu. Un cliente con tres recordatorios automáticos y ninguna visita en 18 meses tiene que
// seguir pareciendo dormido — si no, el detector de enfriamiento deja de avisar justo de los clientes
// que se están yendo, y un aviso que no salta es peor que no tener aviso: nadie lo echa de menos.
//
// Un día = una visita, aunque haya varias citas o varias facturas: dos facturas del mismo martes no
// son dos visitas. La unión de las tres fuentes la hace `diasDeVisita` (contactos.js), que es el
// MISMO sitio del que come el registro; aquí solo se calcula la mediana.
function visitasDelCliente(db, clientId, puede = () => true) {
  const dias = diasDeVisita(db, clientId, puede, ventasDelNegocio(db));
  // La fuente se dice en pantalla para que el dueño sepa qué está mirando.
  return { dias, fuente: usaAgenda(db) ? 'citas y documentos' : 'documentos' };
}

// El RITMO propio: la mediana de los huecos entre visitas, con los MISMOS umbrales que el detector
// de enfriamiento. Mediana y no media, porque una visita rara no puede mover el ritmo de nadie. Con
// menos de RITMO_MIN_CITAS visitas NO se inventa ritmo: se dice cuántas faltan.
export function ritmoDelCliente(db, clientId, puede = () => true) {
  const r = visitasDelCliente(db, clientId, puede);
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
    for (const i of ventasDelNegocio(db)) if (i.client_id === clientId) fac.push(i.issue_date);
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
function gastoDe(db, clientId, desde, hasta = null) {
  let base = 0, n = 0;
  for (const i of ventasEntre(db, desde, hasta)) {
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
  const ids = ventasEntre(db, desde).filter(i => i.client_id === clientId).map(i => i.id);
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

// ── EL PERIODO CONFIGURABLE DE LA TARJETA (C4) ──────────────────────────────────────────────────
// «Últimos 12 meses» era una decisión tomada por nosotros. Un taller mira el trimestre, una asesoría
// el año fiscal, y una peluquería los seis meses de temporada. **Mismo motor, solo cambia el rango**:
// no hay una segunda forma de sumar, hay otra fecha de corte.
//
// Se recuerda POR USUARIO en `dashboard_layouts`, que es la tabla que ya guarda preferencias
// personales (la usan el Inicio y el menú). No nace una tabla para guardar un desplegable.
export const PERIODOS_FICHA = {
  m3:   { etiqueta: 'Últimos 3 meses',  meses: 3 },
  m6:   { etiqueta: 'Últimos 6 meses',  meses: 6 },
  m12:  { etiqueta: 'Últimos 12 meses', meses: 12 },
  anio: { etiqueta: 'Este año',         meses: null },
  libre:{ etiqueta: 'Fechas propias',   meses: null },
};
export const PERIODO_POR_DEFECTO = 'm12';
const scopeFicha = userId => 'ficha-cliente:' + Number(userId);

export function periodoDeUsuario(db, userId) {
  const vacio = { clave: PERIODO_POR_DEFECTO, desde: null, hasta: null };
  if (!db || !userId) return vacio;
  try {
    const g = getLayoutRaw(db, scopeFicha(userId));
    if (!g || typeof g !== 'object' || Array.isArray(g)) return vacio;
    const clave = PERIODOS_FICHA[g.periodo] ? g.periodo : PERIODO_POR_DEFECTO;
    const iso = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
    return { clave, desde: iso(g.desde), hasta: iso(g.hasta) };
  } catch { return vacio; }
}

export function guardarPeriodoDeUsuario(db, userId, { clave, desde = null, hasta = null }) {
  if (!PERIODOS_FICHA[clave]) { const e = new Error('No conozco ese periodo'); e.status = 400; throw e; }
  const iso = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
  // Fechas propias sin fechas no es un periodo: se rechaza en vez de guardar algo que luego mentiría.
  if (clave === 'libre' && (!iso(desde) || !iso(hasta))) {
    const e = new Error('Para fechas propias hacen falta las dos fechas'); e.status = 400; throw e;
  }
  setLayout(db, scopeFicha(userId), { periodo: clave, desde: iso(desde), hasta: iso(hasta) }, userId);
  return periodoDeUsuario(db, userId);
}

// Traduce la preferencia a un rango de fechas de verdad, con el título que le corresponde.
export function rangoDePeriodo(p) {
  const hoy = hoyISO();
  const def = PERIODOS_FICHA[p?.clave] ? p.clave : PERIODO_POR_DEFECTO;
  if (def === 'libre' && p.desde && p.hasta)
    return { desde: p.desde, hasta: p.hasta, titulo: 'Del ' + p.desde + ' al ' + p.hasta, clave: 'libre' };
  if (def === 'anio')
    return { desde: hoy.slice(0, 4) + '-01-01', hasta: hoy, titulo: 'Este año', clave: 'anio' };
  const m = PERIODOS_FICHA[def].meses || 12;
  return { desde: haceMeses(m), hasta: hoy, titulo: PERIODOS_FICHA[def].etiqueta, clave: def };
}

// ── LOS CONTADORES DE LA CABECERA ───────────────────────────────────────────────────────────────
// Cada uno abre su lista YA filtrada por este cliente. Se devuelven TODOS los que el usuario puede
// ver, incluso con 0 — un 0 es información («no ha pedido cita nunca»), y esconderlo sería contar
// solo lo bonito. Lo que NO se puede ver, no viaja.
export function contadoresDe(db, clientId, puede, deuda) {
  const c = [];
  const cuenta = (sql, ...args) => { try { return db.prepare(sql).get(...args).n; } catch { return 0; } };
  // ── F · QUÉ CHIPS APARECEN, Y POR QUÉ ─────────────────────────────────────────────────────────
  // Se ocultan por lo que el negocio USA, **nunca por valer 0**. Un 0 es información: a la asesoría
  // con cero proyectos hay que enseñárselo, porque es su trabajo y ese 0 le dice que puede empezar.
  // Esconderlo por estar vacío sería la peor lección posible.
  //
  // NO SE INVENTA UN SISTEMA NUEVO (0.4): se lee lo que YA existe —la bandera `usa_proyectos` del
  // perfil de oficio y `usaAgenda(db)`, que mira el estado real del negocio— y punto.
  //
  // NADA SE ELIMINA (R6): lo que se oculta viaja igual con `oculto:true`, y la pantalla lo ofrece en
  // «Más opciones» para encenderlo de un clic. Es una preferencia de vista, no una amputación.
  const voc = (() => { try { return vocabulario(db); } catch { return { usa_proyectos: true }; } })();
  const conAgenda = (() => { try { return usaAgenda(db); } catch { return false; } })();
  const extra = new Set(chipsForzados(db));

  if (puede('citas.read')) c.push({ key: 'citas', etiqueta: 'Citas', icon: 'ti-calendar-event',
    n: cuenta("SELECT COUNT(*) n FROM citas WHERE cliente_id=? AND archived=0", clientId),
    // `usaAgenda` ya mira el estado real (hay horario o hay citas), así que un negocio con citas
    // nunca se queda sin el chip.
    href: '/admin/citas', oculto: !conAgenda && !extra.has('citas'),
    porque: 'Este negocio no lleva agenda' });
  if (puede('invoices.read')) c.push({ key: 'facturas', etiqueta: 'Facturas', icon: 'ti-file-invoice',
    n: cuenta('SELECT COUNT(*) n FROM invoices WHERE client_id=?', clientId),
    href: '/admin/invoices?cliente=' + clientId });
  if (puede('crm.read')) c.push({ key: 'oportunidades', etiqueta: 'Oportunidades', icon: 'ti-target-arrow',
    n: cuenta('SELECT COUNT(*) n FROM opportunities WHERE client_id=? AND active=1', clientId),
    href: '/admin/crm' });
  if (puede('proyectos.read')) c.push({ key: 'proyectos', etiqueta: 'Proyectos', icon: 'ti-folders',
    n: cuenta('SELECT COUNT(*) n FROM proyectos WHERE cliente_id=? AND active=1', clientId),
    href: '/admin/proyectos',
    // F1 dice «se ocultan si el negocio NO USA esa función». Tener proyectos ES usarla: esconder un
    // chip que lleva a datos reales sería esconderle al dueño lo suyo, y eso no lo hace ninguna
    // regla de esta tarea. Así que se oculta solo si el oficio no la trae Y además no hay ninguno.
    oculto: !voc.usa_proyectos && !extra.has('proyectos')
            && cuenta('SELECT COUNT(*) n FROM proyectos WHERE active=1') === 0,
    porque: 'En tu oficio no se suele trabajar por proyectos' });
  // El chip de «Deuda» ya NO viaja: es una tarjeta, y decir lo mismo dos veces no es informar (C5).
  return c;
}

// Los chips que el dueño ha ENCENDIDO a mano aunque su oficio no los traiga. Se guardan por negocio
// (no por usuario): es una decisión sobre cómo trabaja el negocio, no un gusto de quien mira.
const CLAVE_CHIPS = 'ficha_chips_extra';
export function chipsForzados(db) {
  try {
    const v = db.prepare('SELECT value FROM settings WHERE key=?').get(CLAVE_CHIPS)?.value;
    return v ? String(v).split(',').filter(Boolean) : [];
  } catch { return []; }
}
export function encenderChip(db, key, encender = true) {
  const actuales = new Set(chipsForzados(db));
  if (encender) actuales.add(key); else actuales.delete(key);
  db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(CLAVE_CHIPS, [...actuales].join(','));
  return [...actuales];
}

// ── LO QUE DISA VE DE ÉL ────────────────────────────────────────────────────────────────────────
// Los avisos que el vigía YA calcula, filtrados por este cliente. Mismo texto y misma cifra que en
// la pantalla del vigía: se le pide a él y se filtra, no se vuelve a detectar nada. Si algún día un
// detector cambia de criterio, la ficha cambia con él sin que nadie la toque.
// `yaDetectado` permite pasar el resultado del vigía si quien llama YA lo tiene. Correr los
// detectores es lo más caro de esta pantalla (unos 300 ms sobre un tenant mediano) y se hacía DOS
// VECES por petición —una aquí y otra en `recomendacionesDisa`— para sacar exactamente lo mismo.
export function avisosDisaDe(db, clientId, puede, detectar, yaDetectado = null) {
  if (!puede('analytics.read')) return null;
  try {
    const res = yaDetectado || detectar(db, { hoy: hoyISO() });
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

export function recomendacionesDisa(db, clientId, puede, detectar, yaDetectado = null) {
  const avisos = avisosDisaDe(db, clientId, puede, detectar, yaDetectado);
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
export function cabecera360(db, cliente, puede, { periodo = null } = {}) {
  const clientId = cliente.id;
  const hoy = hoyISO();
  const out = { moneda: db.prepare('SELECT currency_symbol s FROM company_config WHERE id=1').get()?.s || '€' };

  const f = fechasDeDocumentos(db, clientId, puede);
  // C2 — «CLIENTE DESDE» SALE DE LAS TARJETAS. No pide ninguna acción: es un dato de identidad, como
  // el NIF o el teléfono, y ocupaba un sitio que necesitaba lo urgente. Baja a los datos del cliente
  // y NO se pierde: sigue viajando aquí, solo que la pantalla lo pinta en otro sitio.
  out.desde = f.primera
    ? { fecha: f.primera, alta: (cliente.created_at || '').slice(0, 10) || null }
    : { fecha: null, alta: (cliente.created_at || '').slice(0, 10) || null, nota: 'Aún no te ha comprado' };

  // ── LAS DOS FECHAS, QUE NO SON LA MISMA (D5) ─────────────────────────────────────────────────
  // «Última vez que vino» = última VISITA (pisó el negocio o compró).
  // «Último contacto»     = último trato de cualquier tipo, incluido lo que mandó Bamburu solo.
  // En un cliente con tres correos automáticos y ninguna visita en 18 meses dan fechas DISTINTAS, y
  // esa diferencia es justo lo que el dueño necesita ver.
  const vis = diasDeVisita(db, clientId, puede, ventasDelNegocio(db));
  const ultimaVisita = vis.length ? vis[vis.length - 1] : null;
  out.ultima = ultimaVisita ? { fecha: ultimaVisita, dias: diasEntre(hoy, ultimaVisita) } : null;
  out.contacto = ultimoContacto(db, clientId, puede);

  out.ritmo = ritmoDelCliente(db, clientId, puede);

  if (puede('invoices.read')) {
    const total = gastoDe(db, clientId, null);
    const rango = rangoDePeriodo(periodo || { clave: PERIODO_POR_DEFECTO });
    const enRango = gastoDe(db, clientId, rango.desde, rango.hasta);
    out.gasto = { total: total.base, periodo: enRango.base, facturas: total.facturas,
                  facturas_periodo: enRango.facturas };
    out.periodo = rango;
    out.ticket_medio = total.facturas ? r2(total.base / total.facturas) : null;
    const d = clientDebt(db, clientId, hoy);
    out.deuda = { total: r2(d.total), oldest: d.oldest || null };
    out.margen = margenDe(db, clientId, cliente.name, puede);
    out.margen_modo = modoDeEmpresa(db);   // qué porcentaje manda como titular (I2)
  } else {
    // Sin permiso de facturas no viaja NADA de dinero. Ni a 0: no llega.
    out.gasto = null; out.ticket_medio = null; out.deuda = null; out.margen = null; out.periodo = null;
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
// ── C1 · EL ORDEN MANDA LO URGENTE ──────────────────────────────────────────────────────────────
// Primero lo que exige una decisión hoy (te debe, qué te deja), luego lo que describe (cuánto gasta),
// y al final lo que sitúa en el tiempo. «Cliente desde» ya no está: no pide ninguna acción, así que
// baja a los datos del cliente (C2).
const TARJETAS = ['deuda', 'margen', 'gasto', 'periodo', 'ticket', 'ultima', 'contacto', 'ritmo'];
export const CLAVES_TARJETA = TARJETAS;

// Las facturas de este cliente que cuentan como venta, ya ordenadas de la más nueva a la más vieja.
function facturasDe(db, clientId, desde = null, hasta = null) {
  return ventasEntre(db, desde, hasta)
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

export function detalleTarjeta(db, cliente, clave, puede, { periodo = null } = {}) {
  const clientId = cliente.id;
  const sym = db.prepare('SELECT currency_symbol s FROM company_config WHERE id=1').get()?.s || '€';
  // Las tres tarjetas de tiempo (última visita, último contacto, ritmo) NO son de dinero: se abren
  // con `clients.read`. Las demás exigen ver facturas — `clients.read` no es la llave maestra.
  const dinero = k => !['ultima', 'contacto', 'ritmo'].includes(k);
  if (!TARJETAS.includes(clave)) return null;
  if (dinero(clave) && !puede('invoices.read')) return null;

  // ── C3 · «ÚLTIMA VEZ QUE VINO», «ÚLTIMO CONTACTO» Y «CADA CUÁNTO VIENE» ABREN EL REGISTRO ────
  // No abren facturas: abren lo que EXPLICA su cifra. Las tres van al mismo sitio con distinto
  // filtro, porque las tres hablan de lo mismo visto de tres maneras.
  if (clave === 'ultima' || clave === 'contacto' || clave === 'ritmo') {
    const soloVisitas = clave !== 'contacto';
    // Las visitas se componen de las tres fuentes (agenda, facturas, presenciales a mano) para que
    // la lista CUADRE con la fecha que enseña la tarjeta; el registro completo sale de la tabla.
    const reg = soloVisitas
      ? (() => { const v = visitasDetalle(db, clientId, puede, ventasDelNegocio(db));
                 return { eventos: v, total: v.length, tipos: [...new Set(v.map(x => x.tipo))].sort() }; })()
      : contactosDe(db, clientId, { cuantos: 200 });
    const r = clave === 'ritmo' ? ritmoDelCliente(db, clientId, puede) : null;
    return {
      clave, registro: true, soloVisitas, sym,
      titulo: clave === 'contacto' ? 'Todo lo que ha pasado con él' : 'Sus visitas',
      nota: clave === 'contacto'
        ? 'Aquí entra todo: lo presencial, lo que hablasteis y lo que Bamburu mandó solo — eso último va marcado, porque un correo automático no dice que el cliente esté vivo.'
        : 'Una visita es que **pisó el negocio o compró**: cita atendida, factura, venta de mostrador o presencial apuntado a mano. Los correos, WhatsApp y llamadas NO cuentan como visita, y por eso «Último contacto» puede dar otra fecha.',
      resumen: clave === 'ritmo'
        ? (r?.ritmo_dias ? 'Viene cada ' + r.ritmo_dias + ' días (mediana de los huecos, no media)' : (r?.motivo || null))
        : null,
      vacio: reg.eventos.length ? null
        : (clave === 'contacto' ? 'Todavía no hay nada apuntado con este cliente.'
                                : 'Todavía no ha venido ninguna vez.'),
      eventos: reg.eventos, total: reg.total, tipos: reg.tipos,
      catalogo: TIPOS_CONTACTO, puede_apuntar: puede('clients.edit'),
    };
  }

  if (clave === 'gasto' || clave === 'periodo' || clave === 'ticket') {
    const rango = clave === 'periodo' ? rangoDePeriodo(periodo || { clave: PERIODO_POR_DEFECTO }) : null;
    const fac = rango ? facturasDe(db, clientId, rango.desde, rango.hasta) : facturasDe(db, clientId);
    const suma = r2(fac.reduce((x, i) => x + (Number(i.subtotal) || 0), 0));
    const titulos = { gasto: 'Todos sus documentos',
                      periodo: rango ? 'Sus documentos · ' + rango.titulo.toLowerCase() : 'Sus documentos',
                      ticket: 'Las facturas que forman la media' };
    return {
      clave, titulo: titulos[clave], periodo: rango,
      nota: clave === 'ticket'
        ? 'El ticket medio es esta suma dividida entre el número de facturas: ' + suma + ' / ' + fac.length + '.'
        : 'Base sin IVA. Las facturas anuladas no suman —aunque siguen en su historia—, y los abonos restan.',
      resumen: clave === 'ticket' && fac.length
        ? 'Media de ' + r2(suma / fac.length) + ' ' + sym + ' por factura'
        : fmtEur(suma, sym) + ' en ' + fac.length + ' documento' + (fac.length === 1 ? '' : 's'),
      vacio: fac.length ? null
        : (clave === 'periodo' ? 'No te ha comprado nada en ese periodo.' : 'Todavía no le has facturado nada.'),
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
