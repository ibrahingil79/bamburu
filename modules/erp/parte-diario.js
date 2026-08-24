// EL PARTE DEL DÍA — lo que el resumen por correo CUENTA, en frases, no en un recuento.
//
// QUÉ CAMBIA. El correo de las 8:00 decía "233 avisos que requieren tu atención". Ese número no es
// información: es la talla del montón. Aquí se convierte en frases que se leen de un vistazo desde
// la notificación del móvil, sin abrir nada: "Hoy tienes 6 citas, de 9:00 a 19:30. Te deben
// 1.240,00 €, de los que 380,00 € están vencidos. 2 personas esperan que apruebes su reserva."
//
// DE DÓNDE SALEN LAS CIFRAS. De `avisosDelDia`, el MISMO motor que alimenta la campana, la pantalla
// de avisos y el Inicio. No se recalcula ni un criterio: si el correo dijera "3 cobros vencidos" y
// la campana dijera "2", tendríamos dos verdades y el correo dejaría de creerse a la primera. Aquí
// solo se AGRUPA por fuente y se redacta. Ninguna cifra se inventa: si una fuente no da nada, su
// frase no aparece — un negocio sin inventario no lee "0 productos bajo mínimo", lee otra cosa.
//
// LAS DOS FRASES QUE NO SON AVISOS. La agenda del día y la deuda total NO son fuentes de aviso (el
// motor avisa de lo vencido, no de lo que va bien) y sin ellas el parte no es un parte: "te deben
// 380 € vencidos" sin los 1.240 € totales es media noticia. Se leen de la tabla `citas` y de
// `openDebts()` de cobros.js — SOLO LECTURA, autorizado expresamente por el dueño (17 ago 2026).
// No se toca ni un fichero de la agenda ni de cobros: se les pregunta.
//
// PERMISOS. Cada línea declara el permiso de la pantalla de la que sale, igual que PERM_POR_FUENTE.
// Quien no puede ver los cobros no recibe ni la cifra de deuda ni la de vencido: no se le tacha el
// número, es que su parte no tiene esa frase. Falla cerrado: línea sin permiso declarado no se sirve.

import { avisosDelDia, PERM_POR_FUENTE, hoyLocal } from './avisos.js';
import { openDebts } from './cobros.js';

// Dinero en español, como lo escribe el país donde esto factura: 1.240,00 €.
export function dinero(n, sym = '€') {
  const v = Number(n || 0);
  return v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + sym;
}

const plural = (n, uno, varios) => (n === 1 ? uno : varios);
const hhmm = min => String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');

// ── EL CATÁLOGO DE LÍNEAS ───────────────────────────────────────────────────────────────────────
// Es la lista que se pinta como casillas en la pantalla Y la que recorre el correo. Una sola lista:
// si mañana se añade una fuente al motor, se añade aquí y aparece en los dos sitios a la vez.
//
// `id` de una fuente de aviso = su `tipo` en el motor, y su permiso NO se copia: se le pregunta a
// PERM_POR_FUENTE. Las dos que no son avisos llevan id propio, permiso declarado y `extra:true`
// (no salen de avisosDelDia; las calcula este fichero).
//
// OJO AL MOMENTO EN QUE SE RESUELVE EL PERMISO, que costó un arranque: leer `PERM_POR_FUENTE.x`
// aquí, al EVALUAR el módulo, revienta con "Cannot access 'PERM_POR_FUENTE' before initialization"
// en cuanto la cadena de imports entra en avisos.js a medio cargar — el mismo círculo del que ya
// avisa la cabecera de avisos.js. Por eso el catálogo guarda solo datos propios y el permiso se
// resuelve al LLAMAR (`lineas()`), no al importar. Un módulo que hace trabajo al cargarse es un
// módulo que decide el orden de arranque de los demás.
const CATALOGO_LINEAS = [
  { id: 'agenda_hoy',            extra: true,  perm: 'citas.read',  label: 'Las citas de hoy',                  enlace: '/admin/citas' },
  { id: 'deuda_total',           extra: true,  perm: 'cobros.read', label: 'Cuánto te deben',                   enlace: '/admin/cobros' },
  { id: 'cobro_vencido',         extra: false, label: 'Cobros vencidos',                   enlace: '/admin/cobros' },
  { id: 'reserva_publica',       extra: false, label: 'Reservas por Internet sin aprobar', enlace: '/admin/citas/publica' },
  { id: 'vencimiento_proveedor', extra: false, label: 'Pagos a proveedor que vencen',      enlace: '/admin/pagos' },
  { id: 'stock_bajo',            extra: false, label: 'Productos bajo mínimo',             enlace: '/admin/inventory' },
  { id: 'envio_verifactu',       extra: false, label: 'Facturas sin llegar a la AEAT',     enlace: '/admin/invoices' },
  { id: 'factura_recurrente',    extra: false, label: 'Recurrentes en borrador',           enlace: '/admin/recurrentes' },
  { id: 'cliente_en_riesgo',     extra: false, label: 'Clientes sin seguimiento',          enlace: '/admin/crm/cola' },
];

// Los ids SÍ son dato propio: no dependen de nadie y se pueden leer al importar (los usa la
// validación de preferencias).
export const LINEA_IDS = CATALOGO_LINEAS.map(l => l.id);

// El catálogo con su permiso ya resuelto. Una fuente de aviso sin permiso declarado en
// PERM_POR_FUENTE se queda con un permiso imposible: falla CERRADO, no abierto.
export function lineas() {
  return CATALOGO_LINEAS.map(l => ({ ...l, perm: l.extra ? l.perm : (PERM_POR_FUENTE[l.id] || '__sin_permiso_declarado__') }));
}

// El permiso que exige UNA línea, por su id. Lo necesita la puerta única de correos al equipo
// (`core/correo-equipo.js`): cada frase del parte viaja con el permiso de la pantalla donde ese dato
// se ve, y la puerta lo vuelve a comprobar. Una línea desconocida devuelve el permiso imposible, así
// que falla CERRADO — igual que el catálogo de arriba.
export function permDeLinea(id) {
  const l = lineas().find(x => x.id === id);
  return (l && l.perm) || '__sin_permiso_declarado__';
}

// Las líneas que este usuario PUEDE ver (permiso) Y ha dejado marcadas (preferencia). Intersección,
// nunca unión: una casilla marcada de algo que ya no puede ver NO se la devuelve. `elegidas` vacío o
// nulo = "todas las que pueda"; es el defecto de quien no ha tocado la pantalla.
export function lineasDe({ puede, elegidas }) {
  const quiere = (!elegidas || !elegidas.length) ? null : new Set(elegidas);
  return lineas().filter(l => puede(l.perm) && (!quiere || quiere.has(l.id)));
}

// ── LAS DOS LÍNEAS QUE NO SON AVISOS ────────────────────────────────────────────────────────────

// La agenda de hoy. Cuenta lo que ocupa la agenda (pedidas y confirmadas, ni anuladas ni archivadas)
// y da la horquilla real del día, que es lo que uno quiere saber antes de salir de casa.
export function agendaDeHoy(db, hoy) {
  try {
    const r = db.prepare(
      `SELECT COUNT(*) n, MIN(inicio_min) desde, MAX(inicio_min + dur_min) hasta
         FROM citas WHERE fecha=? AND archived=0 AND estado IN ('pedida','confirmada')`).get(hoy);
    if (!r || !r.n) return null;
    return { n: r.n, desde: r.desde, hasta: r.hasta };
  } catch { return null; }   // tenant sin el esquema de citas todavía
}

// Lo que te deben: total vivo y cuánto de eso está vencido. openDebts es el mismo motor que pinta
// /admin/cobros, así que el correo y la pantalla no pueden discrepar.
export function deuda(db, hoy) {
  try {
    const d = openDebts(db, hoy) || { total: 0, rows: [] };
    const total = Number(d.total || 0);
    if (total <= 0.0049) return null;                       // sin deuda viva → esta frase no existe
    let vencido = 0;
    for (const r of (d.rows || [])) if (r.estado === 'vencida') vencido += Number(r.pendiente || 0);
    return { total, vencido: Math.round(vencido * 100) / 100, n: (d.rows || []).length };
  } catch { return null; }   // tenant sin facturas todavía
}

// ── EL PARTE ────────────────────────────────────────────────────────────────────────────────────
// Devuelve { frases: [{id, texto, enlace}], n }. `n` = 0 significa NO HAY NADA QUE CONTAR, y eso
// es exactamente lo que hace que no salga correo: la regla innegociable del encargo se decide aquí,
// no en el script, para que la pantalla pueda enseñar el mismo veredicto sin duplicar la lógica.
export function parteDelDia(db, { hoy, puede, elegidas, sym = '€' } = {}) {
  const t = hoy || hoyLocal();
  const mias = lineasDe({ puede, elegidas });
  const permitidas = new Set(mias.map(l => l.id));

  // Un solo barrido del motor, con las fuentes que tocan (las `extra` no son fuentes).
  const fuentes = new Set(mias.filter(l => !l.extra).map(l => l.id));
  const avisos = fuentes.size ? avisosDelDia(db, t, fuentes) : [];
  const porTipo = new Map();
  for (const a of avisos) porTipo.set(a.tipo, (porTipo.get(a.tipo) || 0) + 1);

  const frases = [];
  // `corto` es la misma noticia en tres palabras: alimenta el ASUNTO, que es lo único que se lee en
  // la notificación del móvil sin abrir nada. Se redacta aquí, junto a la frase larga, para que no
  // puedan contar cosas distintas.
  const enlaceDe = id => (CATALOGO_LINEAS.find(l => l.id === id) || {}).enlace || '/admin';
  const di = (id, texto, corto) => { if (texto) frases.push({ id, texto, corto: corto || texto, enlace: enlaceDe(id) }); };

  if (permitidas.has('agenda_hoy')) {
    const ag = agendaDeHoy(db, t);
    if (ag) di('agenda_hoy',
      'Hoy tienes ' + ag.n + ' ' + plural(ag.n, 'cita', 'citas') + ', de ' + hhmm(ag.desde) + ' a ' + hhmm(ag.hasta) + '.',
      ag.n + ' ' + plural(ag.n, 'cita', 'citas') + ' hoy');
  }

  if (permitidas.has('deuda_total')) {
    const d = deuda(db, t);
    if (d) {
      di('deuda_total',
        d.vencido > 0
          ? 'Te deben ' + dinero(d.total, sym) + ', de los que ' + dinero(d.vencido, sym) + ' están vencidos.'
          : 'Te deben ' + dinero(d.total, sym) + ', y de momento nada está vencido.',
        d.vencido > 0 ? dinero(d.vencido, sym) + ' vencidos' : dinero(d.total, sym) + ' por cobrar');
    }
  }

  // Las fuentes del motor, en el orden del catálogo (no en el de urgencia del motor: el parte se lee
  // como un texto, y ahí manda que el orden sea siempre el mismo, no que baile cada día).
  const n = id => porTipo.get(id) || 0;

  // `cobro_vencido` ya va contado dentro de la frase de deuda cuando ambas están: repetir "te deben
  // 380 € vencidos" justo debajo de "de los que 380 € están vencidos" es ruido. Solo sale sola.
  if (n('cobro_vencido') && !frases.some(f => f.id === 'deuda_total')) {
    di('cobro_vencido', n('cobro_vencido') + ' ' + plural(n('cobro_vencido'), 'factura vencida', 'facturas vencidas') + ' sin cobrar.',
       n('cobro_vencido') + ' ' + plural(n('cobro_vencido'), 'factura vencida', 'facturas vencidas'));
  }
  if (n('reserva_publica')) {
    di('reserva_publica', n('reserva_publica') + ' ' + plural(n('reserva_publica'), 'persona espera', 'personas esperan') + ' que apruebes su reserva.',
       n('reserva_publica') + ' ' + plural(n('reserva_publica'), 'reserva', 'reservas') + ' por aprobar');
  }
  if (n('vencimiento_proveedor')) {
    di('vencimiento_proveedor', 'Tienes ' + n('vencimiento_proveedor') + ' ' + plural(n('vencimiento_proveedor'), 'factura de proveedor vencida', 'facturas de proveedor vencidas') + ' o a punto de vencer.',
       n('vencimiento_proveedor') + ' ' + plural(n('vencimiento_proveedor'), 'pago pendiente', 'pagos pendientes'));
  }
  if (n('stock_bajo')) {
    di('stock_bajo', n('stock_bajo') + ' ' + plural(n('stock_bajo'), 'producto está', 'productos están') + ' por debajo de su mínimo.',
       n('stock_bajo') + ' bajo mínimo');
  }
  if (n('envio_verifactu')) {
    di('envio_verifactu', n('envio_verifactu') + ' ' + plural(n('envio_verifactu'), 'factura no ha llegado', 'facturas no han llegado') + ' a la AEAT.',
       n('envio_verifactu') + ' sin llegar a la AEAT');
  }
  if (n('factura_recurrente')) {
    di('factura_recurrente', n('factura_recurrente') + ' ' + plural(n('factura_recurrente'), 'factura recurrente espera', 'facturas recurrentes esperan') + ' en borrador.',
       n('factura_recurrente') + ' ' + plural(n('factura_recurrente'), 'recurrente', 'recurrentes') + ' en borrador');
  }
  if (n('cliente_en_riesgo')) {
    di('cliente_en_riesgo', n('cliente_en_riesgo') + ' ' + plural(n('cliente_en_riesgo'), 'cliente lleva', 'clientes llevan') + ' demasiado tiempo sin seguimiento.',
       n('cliente_en_riesgo') + ' sin seguimiento');
  }

  return { frases, n: frases.length, avisos, titular: titularDe(frases) };
}

// EL TITULAR — el asunto del correo. Las dos primeras noticias, en corto. El asunto viejo era
// "Bamburu · 233 avisos que requieren tu atención": un número que no dice nada y que, además, es
// exactamente el que hace que el correo se deje de abrir. Este dice "6 citas hoy · 380,00 € vencidos"
// y ya se ha leído entero desde la pantalla de bloqueo, sin abrir nada.
export function titularDe(frases) {
  if (!frases.length) return '';
  return frases.slice(0, 2).map(f => f.corto).join(' · ');
}

// El parte en HTML, para meterlo en el hueco {{parte}} de la plantilla. Cada frase con su enlace
// directo: el encargo pedía "enlace directo a cada cosa", y eso significa que desde el correo se
// llega a la pantalla en un toque, no a la portada del panel.
export function parteHtml(frases, baseUrl = '') {
  if (!frases.length) return '';
  const filas = frases.map(f =>
    '<li style="margin:0 0 10px"><a href="' + escapeHtml(baseUrl + f.enlace) + '" style="color:#1f2937;text-decoration:none">'
    + escapeHtml(f.texto) + ' <span style="color:#2563eb;white-space:nowrap">→</span></a></li>').join('');
  return '<ul style="padding-left:1.1rem;margin:16px 0;line-height:1.5">' + filas + '</ul>';
}

export const parteTexto = frases => frases.map(f => '· ' + f.texto).join('\n');

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
