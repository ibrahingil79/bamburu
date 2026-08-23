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
  // UN CERO SE DEJA EN BLANCO. En un libro contable la diferencia importa: una celda vacía dice
  // «esta línea no toca esta columna» y un cero dice «toca, y vale cero». El papel viejo del diario
  // y del mayor lo hacía así (`numOrBlank`), y la comparación cifra a cifra de C10-e cazó que el
  // nuevo pintaba un 0,00 de más. No es lo mismo que `dinero`, y por eso es un formato aparte.
  dinero0: (v, sym) => (Math.round((Number(v) || 0) * 100) === 0 ? '' : dinero(v, sym)),
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
  /* ficha D — el dibujo. Lleva break-inside avoid para que no lo parta un salto de pagina. */
  .lst-graf{margin:10px 0 14px;break-inside:avoid;page-break-inside:avoid}
  .lst-graf svg{display:block;max-width:100%}
  .g-tit{font-size:11px;font-weight:700;fill:#111827}
  .g-eje{font-size:9px;fill:#6b7280}
  .g-lab{font-size:10px;fill:#374151}
  .g-rej{stroke:#e5e7eb;stroke-width:1}
  .g-ax{stroke:#9ca3af;stroke-width:1}
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

// ── EL DIBUJO EN PAPEL (ficha D · parte 4) ──────────────────────────────────────────────────────
// POR QUÉ SE DIBUJA AQUÍ, EN SVG, Y NO CON EL CHART.JS DE LA PANTALLA. El PDF se genera con
// `page.setContent` (core/pdf.js), que NO tiene dirección base: un `<script src="/public/js/…">` no
// resolvería, así que habría que incrustar la librería entera en cada papel Y esperar a que termine
// de animar antes de imprimir. Dos motivos de fragilidad para algo que en un papel es estático.
// En SVG no hay librería, no hay espera y sale idéntico por los tres verbos —imprimir, PDF y correo—
// porque los tres pasan por el mismo `listadoHtml`.
//
// LO QUE ESTO NO ES: un segundo origen de cifras. Recibe LOS MISMOS pares (etiqueta, valor) que se
// pintan en la tabla de debajo, sacados del mismo `cruzar`. El dibujo y la tabla no pueden discrepar
// porque son el mismo array leído dos veces. El gate lo comprueba leyendo los números DE DENTRO del
// SVG y comparándolos con los de la tabla, uno a uno.
const SVG_W = 720, SVG_H = 260, SVG_PAD = { i: 58, d: 12, a: 14, b: 46 };
const PALETA = ['#0ea5e9', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#14b8a6', '#6366f1', '#ec4899'];

// Rótulo corto para un eje: un nombre de cliente de 40 letras convierte el eje en una mancha.
const corta = (t, n) => { const x = String(t == null ? '' : t); return x.length > n ? x.slice(0, n - 1) + '…' : x; };
// El valor, formateado como en la tabla: si la medida es dinero lleva su símbolo; si es %, su signo.
const valorFmt = (v, meta, sym) => meta && meta.dinero ? dinero(v, sym) : (meta && meta.pct ? numero(v, 1) + ' %' : numero(v, 2));

// Escala "bonita" para el eje: 1, 2, 2.5 o 5 por potencia de diez. Un eje que acaba en 4.317 se lee
// peor que uno que acaba en 5.000, y en un papel no hay tooltip que lo rescate.
function techo(max) {
  if (!(max > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 2, 2.5, 5, 10]) if (max <= m * p) return m * p;
  return 10 * p;
}

export function graficoSvg({ tipo = 'barras', etiquetas = [], valores = [], meta = null, sym = '€', titulo = '' } = {}) {
  const n = Math.min(etiquetas.length, valores.length);
  if (tipo === 'tabla' || !n) return '';          // una tabla no lleva dibujo: la tabla ya está debajo
  const et = etiquetas.slice(0, n).map(x => String(x == null ? '' : x));
  const va = valores.slice(0, n).map(x => Number(x) || 0);
  const cab = titulo ? '<text x="0" y="10" class="g-tit">' + escHtml(titulo) + '</text>' : '';
  const desplaza = titulo ? 18 : 0;

  if (tipo === 'tarta') {
    const total = va.reduce((a, b) => a + Math.abs(b), 0);
    if (!(total > 0)) return '';
    const cx = 130, cy = 118 + desplaza, r = 96;
    let ang = -Math.PI / 2, trozos = '', leyenda = '';
    va.forEach((v, i) => {
      const frac = Math.abs(v) / total, fin = ang + frac * 2 * Math.PI;
      const x1 = cx + r * Math.cos(ang), y1 = cy + r * Math.sin(ang);
      const x2 = cx + r * Math.cos(fin), y2 = cy + r * Math.sin(fin);
      const grande = frac > 0.5 ? 1 : 0;
      // Un único trozo del 100 % no se puede dibujar con un arco (empieza y acaba en el mismo punto):
      // se pinta el círculo entero, que es lo que es.
      trozos += frac >= 0.999
        ? '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + PALETA[i % PALETA.length] + '"/>'
        : '<path d="M' + cx + ',' + cy + ' L' + x1.toFixed(1) + ',' + y1.toFixed(1)
          + ' A' + r + ',' + r + ' 0 ' + grande + ',1 ' + x2.toFixed(1) + ',' + y2.toFixed(1) + ' Z" fill="'
          + PALETA[i % PALETA.length] + '" stroke="#fff" stroke-width="1"/>';
      const ly = 26 + desplaza + i * 18;
      if (ly < SVG_H - 6) leyenda += '<rect x="266" y="' + (ly - 9) + '" width="10" height="10" rx="2" fill="' + PALETA[i % PALETA.length] + '"/>'
        + '<text x="283" y="' + ly + '" class="g-lab">' + escHtml(corta(et[i], 34)) + ' — ' + escHtml(valorFmt(v, meta, sym))
        + ' (' + numero(frac * 100, 1) + ' %)</text>';
      ang = fin;
    });
    return '<div class="lst-graf"><svg viewBox="0 0 ' + SVG_W + ' ' + SVG_H + '" width="100%" height="' + SVG_H + '" role="img">'
      + cab + trozos + leyenda + '</svg></div>';
  }

  // Barras y líneas comparten ejes.
  const x0 = SVG_PAD.i, y0 = SVG_PAD.a + desplaza, x1 = SVG_W - SVG_PAD.d, y1 = SVG_H - SVG_PAD.b;
  const ancho = x1 - x0, alto = y1 - y0;
  const maxV = techo(Math.max(0, ...va));
  const yDe = v => y1 - (Math.max(0, v) / maxV) * alto;
  let rejilla = '';
  for (let i = 0; i <= 4; i++) {
    const y = y1 - (alto * i) / 4, v = (maxV * i) / 4;
    rejilla += '<line x1="' + x0 + '" y1="' + y.toFixed(1) + '" x2="' + x1 + '" y2="' + y.toFixed(1) + '" class="g-rej"/>'
      + '<text x="' + (x0 - 6) + '" y="' + (y + 3.5).toFixed(1) + '" class="g-eje" text-anchor="end">' + escHtml(numero(v, maxV < 10 ? 1 : 0)) + '</text>';
  }
  // Con muchas categorías no caben todos los rótulos: se pinta uno de cada k y se dice en el pie.
  const paso = Math.ceil(n / 14);
  let ejeX = '';
  for (let i = 0; i < n; i += paso) {
    const cx = x0 + (ancho * (i + 0.5)) / n;
    ejeX += '<text x="' + cx.toFixed(1) + '" y="' + (y1 + 14) + '" class="g-eje" text-anchor="middle">' + escHtml(corta(et[i], 12)) + '</text>';
  }

  let cuerpo = '';
  if (tipo === 'lineas') {
    const pts = va.map((v, i) => (x0 + (ancho * (i + 0.5)) / n).toFixed(1) + ',' + yDe(v).toFixed(1)).join(' ');
    cuerpo = '<polyline points="' + pts + '" fill="none" stroke="' + PALETA[0] + '" stroke-width="2.2" stroke-linejoin="round"/>'
      + va.map((v, i) => '<circle cx="' + (x0 + (ancho * (i + 0.5)) / n).toFixed(1) + '" cy="' + yDe(v).toFixed(1) + '" r="2.8" fill="' + PALETA[0] + '"/>').join('');
  } else {
    const bw = Math.max(3, (ancho / n) * 0.62);
    cuerpo = va.map((v, i) => {
      const cx = x0 + (ancho * (i + 0.5)) / n, y = yDe(v);
      return '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1)
        + '" height="' + Math.max(0, y1 - y).toFixed(1) + '" rx="2" fill="' + PALETA[0] + '"/>';
    }).join('');
  }
  const nota = paso > 1 ? '<text x="' + x0 + '" y="' + (SVG_H - 6) + '" class="g-eje">Se rotula 1 de cada '
    + paso + ' · la tabla de abajo las lleva todas</text>' : '';
  return '<div class="lst-graf"><svg viewBox="0 0 ' + SVG_W + ' ' + SVG_H + '" width="100%" height="' + SVG_H + '" role="img">'
    + cab + rejilla + cuerpo
    + '<line x1="' + x0 + '" y1="' + y1 + '" x2="' + x1 + '" y2="' + y1 + '" class="g-ax"/>'
    + ejeX + nota + '</svg></div>';
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
  // ficha D · parte 4 — un papel puede llevar un DIBUJO encima de su tabla. Es SVG ya montado
  // (`graficoSvg`, arriba). Los quince listados que ya existen no lo pasan y salen exactamente igual
  // que antes: sin `grafico`, esto no añade ni un carácter al papel.
  grafico = '',
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
    + (grafico || '')
    + cuerpo + tot + notasHtml(notas, tituloNotas);
}

// Los totales del pie, aparte para que puedan pintarse también por sección.
function totalesHtml(totales, sym) {
  return '<table class="lst-totales">' + totales.map(t => {
    const fmt = FORMATOS[t.formato || 'dinero'] || FORMATOS.dinero;
    return '<tr' + (t.grand ? ' class="grand"' : '') + '><td>' + escHtml(t.etiqueta) + '</td><td>' + fmt(t.valor, sym) + '</td></tr>';
  }).join('') + '</table>';
}
