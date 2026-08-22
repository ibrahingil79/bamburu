// ════════════════════════════════════════════════════════════════════════════════════════════════
// EL MOTOR DE IMPRESIÓN — uno solo para TODOS los listados
// ════════════════════════════════════════════════════════════════════════════════════════════════
// LA REGLA QUE MANDA AQUÍ: **un listado no trae su propio generador.** Declara qué columnas tiene,
// cómo se ordenan, qué suma y ya está. Todo lo demás —el membrete, la paginación, la cabecera que se
// repite en cada hoja, el «Página X de Y», la fecha, quién lo generó y los filtros aplicados— lo
// pone este fichero. Es la misma regla de fuente única que C-0 acaba de restaurar en los documentos,
// y viene del mismo sitio: cuatro copias de `docParties` y dos dialectos de membrete costaron una
// tarea entera de limpieza. No se vuelve a empezar por ahí.
//
// EL MEMBRETE NO SE REINVENTA (C10-f): se llama al de `documentos.js`, con su logo. Se comprobó
// ANTES de escribir esto que sirve tal cual para un listado —da el emisor con logo y deja la segunda
// columna vacía, como el ticket de mostrador— así que no hubo que ampliarlo.
//
// TODO IMPRESO DECLARA SU BASE (C10-d). Es la misma ley que el pie del calendario: un listado de
// facturas filtrado que no dice que está filtrado **es un documento que miente**, y encima uno que
// se manda a un cliente o a una gestoría. Sin filtros dice «Todos». La cabecera nunca va vacía.
import { partesDe, membreteHtml } from './documentos.js';
import { escHtml } from '../../core/escape.js';

// ── FORMATO ESPAÑOL, EN UN SOLO SITIO ───────────────────────────────────────────────────────────
// 1.234,56 € y no 1234.56. Vive aquí para que ningún listado se invente el suyo: es exactamente el
// tipo de cosa que acaba divergiendo entre pantallas si cada una la resuelve por su cuenta.
// `useGrouping: 'always'` NO es un capricho: por defecto el español moderno NO pone punto en los
// números de cuatro cifras (1234,56), y en un papel de contabilidad eso se lee mal — una columna
// donde unas cifras llevan punto y otras no obliga a contar dígitos. El encargo pide separador de
// miles, así que se pide SIEMPRE. Lo destapó el gate: la aserción del formato falló con «1234,56».
const GRUPO = { useGrouping: 'always' };
export function dinero(n, sym = '€') {
  const v = Number(n) || 0;
  return v.toLocaleString('es-ES', { ...GRUPO, minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + sym;
}
export function numero(n, dec = 0) {
  return (Number(n) || 0).toLocaleString('es-ES', { ...GRUPO, minimumFractionDigits: dec, maximumFractionDigits: dec });
}
export function fechaEs(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] : String(iso);
}

// Cómo se pinta cada celda según lo que declare la columna. `texto` es el que no toca nada.
const FORMATOS = {
  texto:  (v) => escHtml(v == null ? '' : v),
  dinero: (v, sym) => dinero(v, sym),
  numero: (v) => numero(v),
  decimal: (v) => numero(v, 2),
  fecha:  (v) => escHtml(fechaEs(v)),
  pct:    (v) => numero(v, 1) + ' %',
};

// ── EL PIE DE PÁGINA ────────────────────────────────────────────────────────────────────────────
// «Página X de Y» NO se puede hacer con CSS: Chromium no implementa las cajas de margen de página.
// Se hace con el `footerTemplate` de puppeteer y sus clases mágicas (`pageNumber`, `totalPages`),
// que es lo que `core/pdf.js` acepta ahora como `pie`. Los estilos van EN LÍNEA a propósito: el pie
// se renderiza en un documento aparte y no ve la hoja de estilos del papel.
export function pieDePagina(titulo) {
  return '<div style="width:100%;font-size:8px;color:#667085;padding:0 12mm;'
       + 'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;'
       + 'display:flex;justify-content:space-between;align-items:center">'
       + '<span>' + escHtml(titulo || '') + '</span>'
       + '<span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>'
       + '</div>';
}

// ── LA HOJA DE ESTILOS DEL LISTADO ──────────────────────────────────────────────────────────────
// `thead { display: table-header-group }` es lo que hace que la cabecera de columnas se repita sola
// en cada hoja al paginar. No hay que cortar la tabla a mano ni calcular cuántas filas caben — el
// navegador lo hace bien desde hace veinte años, y hacerlo a mano sería inventarse un paginador que
// se rompería con la primera fila alta.
//
// SE ESCRIBE AUNQUE SEA EL VALOR POR DEFECTO, y conviene saberlo antes de «limpiarla»: quitarla NO
// cambia nada (medido: 3 hojas de 3 siguen con cabecera), porque es lo que un `<thead>` ya hace.
// Lo que sí la rompe es pisarla —con `table-row-group` la cabecera baja a 1 hoja de 3—, y por eso
// se deja escrita: declara la intención y deja el sitio marcado. La prueba de reversión de esta
// tarea empezó quitándola y no tumbó nada; el fallo era de la reversión, no de la aserción.
export const LISTADO_CSS = `
  .lst-cab{margin:0 0 14px}
  .lst-tit{font-size:20px;font-weight:600;margin:0 0 2px;color:var(--text)}
  .lst-meta{font-size:10px;color:var(--text2);line-height:1.6}
  .lst-meta b{color:var(--text);font-weight:600}
  .lst-filtros{margin-top:8px;padding:7px 10px;background:var(--bg3,#F4F5F7);border-radius:6px;
               font-size:10px;color:var(--text2);line-height:1.65}
  .lst-filtros .k{color:var(--text3)}
  .lst-filtros .v{color:var(--text);font-weight:600}
  table.lst{width:100%;border-collapse:collapse;font-size:10.5px;margin-top:4px}
  table.lst thead{display:table-header-group}
  table.lst tr{break-inside:avoid;page-break-inside:avoid}
  table.lst th{background:var(--bg3,#F4F5F7);padding:6px 8px;text-align:left;font-size:9px;
               text-transform:uppercase;letter-spacing:.05em;color:var(--text2);font-weight:600;
               border-bottom:1px solid var(--border,#E4E7EC)}
  table.lst td{padding:5px 8px;border-bottom:1px solid var(--border,#EDEFF2);color:var(--text)}
  table.lst td.r,table.lst th.r{text-align:right}
  table.lst td.c,table.lst th.c{text-align:center}
  table.lst tr.grupo td{background:var(--bg3,#F4F5F7);font-weight:600;font-size:10px;padding:6px 8px}
  table.lst tfoot td{padding:7px 8px;font-weight:600;border-top:1.5px solid var(--text)}
  table.lst tfoot{display:table-footer-group}
  .lst-vacio{padding:26px 10px;text-align:center;color:var(--text2);font-size:11px;
             border:1px dashed var(--border2,#D0D5DD);border-radius:8px;margin-top:8px}
  .lst-totales{margin-top:10px;margin-left:auto;width:280px;font-size:11px}
  .lst-totales td{padding:4px 8px}
  .lst-totales td:last-child{text-align:right;font-weight:600}
  .lst-totales tr.grand td{border-top:1.5px solid var(--text);font-size:13px;padding-top:8px}
  /* ── LAS TRES PIEZAS QUE PIDIERON LOS INFORMES CONTABLES (22 ago 2026) ────────────────────────
     Son declarativas y ADITIVAS: un listado que no las declare sale exactamente igual que antes.
     Nacen porque dos de los siete papeles de contabilidad no eran tablas planas y la alternativa
     era un segundo motor, que es justo lo que C10 prohíbe. */
  table.lst tr.sub td{background:var(--bg3,#F4F5F7);font-weight:700}
  table.lst tr.sub td:first-child{border-left:2px solid var(--text3,#98A2B3)}
  .lst-sec{margin-top:16px}
  .lst-sec:first-of-type{margin-top:4px}
  .lst-sec-tit{font-size:13px;font-weight:600;margin:0 0 4px;color:var(--text)}
  .lst-notas{margin-top:10px;padding:7px 10px;border-left:3px solid var(--warn,#F79009);
             background:var(--warn-s,#FFFAEB);font-size:10px;color:var(--text2);line-height:1.6}
  .lst-notas b{color:var(--text);font-weight:600}
  .lst-notas ul{margin:4px 0 0;padding-left:16px}
`;

// ── LA CABECERA QUE DECLARA LA BASE (C10-c + C10-d) ─────────────────────────────────────────────
function cabeceraHtml({ titulo, filtros, periodo, generadoPor, cuando, filas }) {
  const f = (filtros && filtros.length)
    ? filtros.map(x => '<span class="k">' + escHtml(x.etiqueta) + ':</span> <span class="v">' + escHtml(x.valor) + '</span>').join(' &nbsp;·&nbsp; ')
    : '<span class="k">Filtros:</span> <span class="v">Todos</span>';
  const per = periodo && (periodo.desde || periodo.hasta)
    ? ' &nbsp;·&nbsp; <span class="k">Periodo:</span> <span class="v">'
      + escHtml(periodo.desde ? fechaEs(periodo.desde) : 'inicio') + ' – '
      + escHtml(periodo.hasta ? fechaEs(periodo.hasta) : 'hoy') + '</span>'
    : '';
  return '<div class="lst-cab">'
    + '<h1 class="lst-tit">' + escHtml(titulo) + '</h1>'
    + '<div class="lst-meta">Generado el <b>' + escHtml(cuando) + '</b>'
    + (generadoPor ? ' por <b>' + escHtml(generadoPor) + '</b>' : '')
    + ' &nbsp;·&nbsp; <b>' + numero(filas) + '</b> ' + (filas === 1 ? 'línea' : 'líneas') + '</div>'
    + '<div class="lst-filtros">' + f + per + '</div>'
    + '</div>';
}

function celda(col, fila, sym) {
  const fmt = FORMATOS[col.formato || 'texto'] || FORMATOS.texto;
  const bruto = typeof col.valor === 'function' ? col.valor(fila) : fila[col.clave];
  const clase = col.align === 'right' ? ' class="r"' : (col.align === 'center' ? ' class="c"' : '');
  return '<td' + clase + '>' + fmt(bruto, sym) + '</td>';
}

// ── EL CUERPO DE UNA TABLA ──────────────────────────────────────────────────────────────────────
// Se saca aparte para que un papel pueda llevar VARIAS: los borradores de modelos son un solo
// documento con la tabla del 303 y la del 130, cada una con su título. Antes esto vivía dentro del
// motor y solo se podía pintar una vez.
//
// `esSubtotal(fila)` marca una fila como total intercalado y la pinta destacada EN SU SITIO. Lo pide
// la Cuenta de pérdidas y ganancias, donde los subtotales van entre las partidas y no al final: un
// P&G con sus subtotales movidos al pie deja de ser un P&G.
function tablaHtml({ columnas, filas, agrupar, esSubtotal, vacio, sym }) {
  if (!filas.length) return '<div class="lst-vacio">' + escHtml(vacio) + '</div>';
  let ultimoGrupo = null;
  const trs = filas.map(fila => {
    let previa = '';
    if (agrupar) {
      const g = typeof agrupar.rotulo === 'function' ? agrupar.rotulo(fila) : fila[agrupar.clave];
      if (g !== ultimoGrupo) {
        ultimoGrupo = g;
        previa = '<tr class="grupo"><td colspan="' + columnas.length + '">' + escHtml(g == null ? '—' : g) + '</td></tr>';
      }
    }
    const clase = (typeof esSubtotal === 'function' && esSubtotal(fila)) ? ' class="sub"' : '';
    return previa + '<tr' + clase + '>' + columnas.map(c => celda(c, fila, sym)).join('') + '</tr>';
  }).join('');
  return '<table class="lst"><thead><tr>'
    + columnas.map(c => '<th' + (c.align === 'right' ? ' class="r"' : (c.align === 'center' ? ' class="c"' : '')) + '>' + escHtml(c.rotulo) + '</th>').join('')
    + '</tr></thead><tbody>' + trs + '</tbody></table>';
}

// ── LAS NOTAS AL PIE ────────────────────────────────────────────────────────────────────────────
// Un aviso del tipo «antes de presentar, revisa…» es parte del papel, no decoración: quitarlo de un
// borrador del 303 le retira una advertencia que el obligado tiene que leer. Por eso el motor sabe
// pintarlo en vez de obligar a cada informe a traerse su propio HTML.
function notasHtml(notas, titulo) {
  const lista = (notas || []).filter(Boolean);
  if (!lista.length) return '';
  return '<div class="lst-notas"><b>' + escHtml(titulo || 'Antes de darlo por bueno, revisa:') + '</b>'
    + '<ul>' + lista.map(n => '<li>' + escHtml(n) + '</li>').join('') + '</ul></div>';
}

// ── EL MOTOR ────────────────────────────────────────────────────────────────────────────────────
// Recibe DATOS y una declaración; devuelve el papel entero. Añadir un listado nuevo es escribir su
// declaración: ni una línea de este fichero cambia (C11).
//
//   columnas: [{ clave|valor, rotulo, formato, align }]
//   filas:    [ {...} ]
//   filtros:  [{ etiqueta, valor }]     — vacío ⇒ «Todos»
//   periodo:  { desde, hasta } | null
//   totales:  [{ etiqueta, valor, formato, grand }]
//   agrupar:  { clave, rotulo(fila) } | null
//   esSubtotal: (fila) => bool | null    — la fila se pinta destacada EN SU SITIO
//   secciones: [{ titulo, columnas, filas, totales, agrupar, esSubtotal, notas, tituloNotas }] | null
//   notas:    [ 'texto', … ] | null      — aviso al pie del papel
export function listadoHtml(db, {
  titulo, columnas, filas = [], filtros = [], periodo = null, totales = [],
  agrupar = null, generadoPor = '', vacio = 'No hay datos que mostrar con estos filtros.',
  sym = '€', cuando = null, esSubtotal = null, secciones = null, notas = null, tituloNotas = null,
}) {
  const { emisor } = partesDe(db, null);          // configuración EN VIVO: un listado es de hoy
  const ahora = cuando || new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });

  // UN LISTADO VACÍO NO ES UN PDF EN BLANCO NI UN ERROR. Es un documento que dice que no hay nada —
  // que es un dato, y que además demuestra que la consulta se hizo. Lo resuelve `tablaHtml`.
  //
  // DOS MODOS, Y EL DE SIEMPRE NO CAMBIA: sin `secciones`, un papel es UNA tabla, exactamente como
  // antes. Con `secciones`, son varias, cada una con su título, sus columnas y sus notas — que es lo
  // que necesitan los borradores de modelos (303 y 130 en el mismo documento).
  let cuerpo;
  if (secciones && secciones.length) {
    cuerpo = secciones.map(sec => {
      const t = tablaHtml({
        columnas: sec.columnas || columnas,
        filas: sec.filas || [],
        agrupar: sec.agrupar || null,
        esSubtotal: sec.esSubtotal || esSubtotal,
        vacio: sec.vacio || vacio,
        sym,
      });
      const totSec = (sec.totales && sec.totales.length) ? totalesHtml(sec.totales, sym) : '';
      return '<div class="lst-sec">'
        + (sec.titulo ? '<h2 class="lst-sec-tit">' + escHtml(sec.titulo) + '</h2>' : '')
        + t + totSec + notasHtml(sec.notas, sec.tituloNotas) + '</div>';
    }).join('');
  } else {
    cuerpo = tablaHtml({ columnas, filas, agrupar, esSubtotal, vacio, sym });
  }

  const tot = totales.length ? totalesHtml(totales, sym) : '';

  return '<style>' + LISTADO_CSS + '</style>'
    + membreteHtml({ emisor, otra: null })
    + cabeceraHtml({ titulo, filtros, periodo, generadoPor, cuando: ahora,
                     filas: secciones && secciones.length
                       ? secciones.reduce((n, s2) => n + ((s2.filas || []).length), 0)
                       : filas.length })
    + cuerpo + tot + notasHtml(notas, tituloNotas);
}

// Los totales del pie, aparte para que puedan pintarse también por sección.
function totalesHtml(totales, sym) {
  return '<table class="lst-totales">' + totales.map(t => {
    const fmt = FORMATOS[t.formato || 'dinero'] || FORMATOS.dinero;
    return '<tr' + (t.grand ? ' class="grand"' : '') + '><td>' + escHtml(t.etiqueta) + '</td><td>' + fmt(t.valor, sym) + '</td></tr>';
  }).join('') + '</table>';
}
