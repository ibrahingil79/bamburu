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
export function dinero(n, sym = '€') {
  const v = Number(n) || 0;
  return v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + sym;
}
export function numero(n, dec = 0) {
  return (Number(n) || 0).toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
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
// `thead { display: table-header-group }` es LA línea importante de todo esto: es lo que hace que la
// cabecera de columnas se repita sola en cada hoja al paginar. No hay que cortar la tabla a mano ni
// calcular cuántas filas caben — el navegador lo hace bien desde hace veinte años, y hacerlo a mano
// sería inventarse un paginador que se rompería con la primera fila alta.
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
export function listadoHtml(db, {
  titulo, columnas, filas = [], filtros = [], periodo = null, totales = [],
  agrupar = null, generadoPor = '', vacio = 'No hay datos que mostrar con estos filtros.',
  sym = '€', cuando = null,
}) {
  const { emisor } = partesDe(db, null);          // configuración EN VIVO: un listado es de hoy
  const ahora = cuando || new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });

  let cuerpo;
  if (!filas.length) {
    // UN LISTADO VACÍO NO ES UN PDF EN BLANCO NI UN ERROR. Es un documento que dice que no hay
    // nada — que es un dato, y que además demuestra que la consulta se hizo.
    cuerpo = '<div class="lst-vacio">' + escHtml(vacio) + '</div>';
  } else {
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
      return previa + '<tr>' + columnas.map(c => celda(c, fila, sym)).join('') + '</tr>';
    }).join('');
    cuerpo = '<table class="lst"><thead><tr>'
      + columnas.map(c => '<th' + (c.align === 'right' ? ' class="r"' : (c.align === 'center' ? ' class="c"' : '')) + '>' + escHtml(c.rotulo) + '</th>').join('')
      + '</tr></thead><tbody>' + trs + '</tbody></table>';
  }

  const tot = totales.length
    ? '<table class="lst-totales">' + totales.map(t => {
        const fmt = FORMATOS[t.formato || 'dinero'] || FORMATOS.dinero;
        return '<tr' + (t.grand ? ' class="grand"' : '') + '><td>' + escHtml(t.etiqueta) + '</td><td>' + fmt(t.valor, sym) + '</td></tr>';
      }).join('') + '</table>'
    : '';

  return '<style>' + LISTADO_CSS + '</style>'
    + membreteHtml({ emisor, otra: null })
    + cabeceraHtml({ titulo, filtros, periodo, generadoPor, cuando: ahora, filas: filas.length })
    + cuerpo + tot;
}
