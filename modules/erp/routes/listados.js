// ════════════════════════════════════════════════════════════════════════════════════════════════
// LOS TRES VERBOS, UNA SOLA VEZ — imprimir · descargar en PDF · enviar por correo
// ════════════════════════════════════════════════════════════════════════════════════════════════
// TRES RUTAS PARA LOS OCHO LISTADOS, no tres por listado. Un listado nuevo no añade ni una ruta
// aquí: se declara en `listados.js` y ya tiene los tres verbos (C11). Esto es lo que impide que
// dentro de seis meses haya ocho generadores distintos, que es de donde venimos con `docParties`.
//
// EL CANDADO ES EL DE SU PANTALLA. Cada listado declara su `perm` y aquí se exige ESE, resuelto en
// caliente porque la ruta es genérica. No hay un permiso nuevo de «imprimir»: quien no puede ver un
// listado tampoco puede imprimirlo ni mandárselo a nadie.
import { Hono } from 'hono';
import { safeError } from '../../../core/errors.js';
import { escHtml } from '../../../core/escape.js';
import { can, printableShell, errorShell, ERR } from '../layout.js';
import { logActivity } from '../../../core/auth.js';
import { renderPdfFromHtml } from '../../../core/pdf.js';
import { sendEmail } from '../../../core/mailer.js';
import { listadoHtml, pieDePagina } from '../impresion.js';
import { LISTADOS, filtrosDeUrl } from '../listados.js';
import { ENTITY } from '../../../core/activity-entities.js';

// El papel, montado. Es el ÚNICO sitio del proyecto que compone un listado imprimible: las tres
// rutas comen de aquí, así que imprimir, descargar y enviar no pueden dar tres papeles distintos.
// FICHA D · PARTE 4 — `titulo`, `columnas` y `perm` pueden ser FUNCIÓN de (q, db), igual que
// `totales`, `notas` y `secciones` ya podían. Lo pide el informe compuesto, cuyo título es el nombre
// que le puso el dueño y cuyas columnas dependen de la medida elegida. Los quince listados que traen
// un valor fijo no notan nada: `campo()` devuelve tal cual lo que no sea función.
const campo = (v, q, db) => (typeof v === 'function' ? v(q, db) : v);

function papelDe(db, clave, q, quien) {
  const L = LISTADOS[clave];
  const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
  const titulo = campo(L.titulo, q, db);
  const columnas = campo(L.columnas, q, db);
  // `extra` es lo que la consulta sepa y las columnas no puedan deducir: los totales que ya trae
  // calculados un libro contable, los avisos de un modelo… Nace con los informes: sus cifras las
  // calcula contabilidad y AQUÍ NO SE RECALCULA NADA, solo se pinta lo que ella devuelve.
  const { filas, extra } = L.consulta(db, q);   // MISMA consulta que la pantalla, sin LIMIT
  // `totales`, `notas` y `secciones` pueden ser función (reciben las filas y el extra) o valor.
  const resolver = (v) => (typeof v === 'function' ? v(filas, extra) : v);
  const secciones = L.secciones ? resolver(L.secciones) : null;
  return {
    filas,
    secciones,
    titulo,
    html: listadoHtml(db, {
      titulo,
      columnas,
      // El dibujo, si el listado trae uno. Los quince de la ficha C no lo traen y salen igual que antes.
      grafico: L.grafico ? L.grafico(q, db, sym) : '',
      filas,
      filtros: L.filtros ? L.filtros(q, db) : [],
      periodo: L.periodo ? L.periodo(q) : null,
      totales: L.totales ? resolver(L.totales) : [],
      agrupar: L.agrupar || null,
      esSubtotal: L.esSubtotal || null,
      secciones,
      notas: L.notas ? resolver(L.notas) : null,
      tituloNotas: L.tituloNotas || null,
      generadoPor: quien || '',
      vacio: L.vacio,
      sym,
    }),
  };
}

// ── UN PAPEL MUY LARGO SE AVISA, NUNCA SE RECORTA ───────────────────────────────────────────────
// La regla del proyecto es que un listado sale ENTERO o no sale: recortar en silencio convierte un
// documento en una mentira. Pero mandar sin avisar un PDF de cien páginas a una impresora o a un
// correo tampoco está bien, así que se avisa ANTES y decide el usuario.
//
// SE ESTIMA POR FILAS y no generando el PDF para contarlo: generar cien páginas para preguntar si
// se quieren cien páginas es justo el trabajo que se quiere evitar.
//
// EL LISTÓN ESTÁ MEDIDO SOBRE PAPELES REALES de este producto, no supuesto: el libro de ventas hace
// 7 hojas con 183 filas (26 por hoja), el libro diario 78 con 2.401 (31 por hoja, contando que sus
// filas de asiento ocupan lo suyo) y el de clientes 4 con 131 (33). Se toma 30, que es el caso
// realista: la primera versión de esto puso 60 «a ojo» y el diario, que hace 78 hojas, no avisaba.
const FILAS_POR_HOJA = 30;
const HOJAS_AVISO = 50;
const paginasEstimadas = (filas, secciones) => {
  const n = (secciones && secciones.length)
    ? secciones.reduce((a, s2) => a + ((s2.filas || []).length), 0)
    : (filas || []).length;
  return Math.max(1, Math.ceil(n / FILAS_POR_HOJA));
};

const nombreFichero = (titulo) =>
  (titulo.replace(/[^\wáéíóúñÁÉÍÓÚÑ ]+/g, '').trim().replace(/\s+/g, '-') + '-'
   + new Date().toISOString().slice(0, 10) + '.pdf').replace(/[\/\\]/g, '-');

// EL PAPEL DE UN LISTADO, PARA QUIEN NO PASE POR LAS TRES RUTAS. Lo usan los informes contables,
// que tienen su propia dirección de descarga desde hace meses y no se les va a cambiar la URL a la
// gestoría. Es LA MISMA función que sirve a los tres verbos: no hay dos caminos de composición.
export function papelDeListado(db, clave, q, quien) {
  return papelDe(db, clave, { ...filtrosVacios(), ...q }, quien);
}
const filtrosVacios = () => ({ q: '', categoria: '', estado: '', desde: '', hasta: '', cliente_id: null,
  archivados: false, producto_id: null, proveedor_id: null, anio: '', trimestre: '' });

export function createListadosRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  // El candado, resuelto en caliente: la ruta es genérica pero el permiso es el de SU pantalla.
  // FICHA D · PARTE 4 — el informe compuesto necesita saber QUIÉN pide el papel (para resolver su
  // receta con la misma visibilidad de la pantalla) y con QUÉ permisos. Se mete en `q`, que es lo que
  // ya viaja hasta la consulta; así no hay que pasar la sesión por seis sitios.
  const conSesion = (c, q) => ({ ...q, _userId: c.get('session')?.userId, _hasPerm: (p) => can(c, p) });

  const guarda = (c, clave) => {
    const L = LISTADOS[clave];
    if (!L) return { error: 'Listado no encontrado', status: 404 };
    if (!c.get('session')) return { error: 'No autorizado', status: 401 };
    // El permiso puede depender del propio listado pedido (el informe compuesto: manda el área de su
    // receta). Si resolverlo falla —informe inexistente, o de otro— se contesta ESO, no un 403 genérico.
    let perm;
    try { perm = campo(L.perm, conSesion(c, filtrosDeUrl(c)), db); }
    catch (e) { return { error: e.message || 'No se pudo resolver el listado', status: e.status || 400 }; }
    if (!can(c, perm)) return { error: 'No tienes permiso para ver este listado', status: 403 };
    return { L };
  };
  const quienDe = c => c.get('session')?.name || c.get('session')?.email || '';

  // ── IMPRIMIR ──────────────────────────────────────────────────────────────────────────────────
  // Devuelve el MISMO papel que el PDF, en una página que se manda a la impresora sola. No es una
  // segunda maquetación: es `papelDe`, igual que los otros dos verbos.
  views.get('/:clave/imprimir', c => {
    const clave = c.req.param('clave');
    const g = guarda(c, clave);
    if (g.error) return c.html(errorShell('No podemos abrir este listado', g.error, { action: 'Volver', href: '/admin' }), g.status);
    try {
      const { html, titulo } = papelDe(db, clave, conSesion(c, filtrosDeUrl(c)), quienDe(c));
      return c.html(printableShell(html + '<script>window.addEventListener("load",function(){setTimeout(window.print,250)})<\/script>', { title: titulo }));
    } catch (e) { return c.html(errorShell('No hemos podido preparar la impresión', ERR.GEN, { action: 'Volver', href: g.L.volver }), e.status || 500); }
  });

  // ── DESCARGAR EN PDF ──────────────────────────────────────────────────────────────────────────
  views.get('/:clave/pdf', async c => {
    const clave = c.req.param('clave');
    const g = guarda(c, clave);
    if (g.error) return c.json({ error: g.error }, g.status);
    try {
      const { html, titulo, filas, secciones } = papelDe(db, clave, conSesion(c, filtrosDeUrl(c)), quienDe(c));
      // EL AVISO DE LOS PAPELES LARGOS. Con `?entero=1` sale sin preguntar; sin él, se dice cuántas
      // hojas van a salir y se deja decidir. No se recorta ni una fila en ninguno de los dos casos.
      const hojas = paginasEstimadas(filas, secciones);
      if (hojas > HOJAS_AVISO && c.req.query('entero') !== '1') {
        return c.json({
          aviso: 'largo',
          hojas,
          mensaje: 'Este papel va a salir con unas ' + hojas + ' hojas. Sale ENTERO, no se recorta nada: '
                 + 'solo queremos que lo sepas antes de mandarlo a la impresora o por correo.',
          seguir: c.req.path + '?' + new URLSearchParams({ ...Object.fromEntries(new URL(c.req.url).searchParams), entero: '1' }).toString(),
        }, 409);
      }
      const pdf = await renderPdfFromHtml(printableShell(html, { title: titulo }), { pie: pieDePagina(titulo) });
      return new Response(pdf, {
        headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="' + nombreFichero(titulo) + '"' },
      });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // ── ENVIAR POR CORREO ─────────────────────────────────────────────────────────────────────────
  // MISMA HONESTIDAD QUE LA COLA DE RECORDATORIOS: pulsar no es llegar. Resend devuelve
  // `{ data, error }` y NO lanza, así que hay que mirar el `error` — si el envío no sale, se dice en
  // pantalla y NO se registra como enviado. Marcar como enviado algo que no salió es peor que no
  // tener la función.
  api.post('/:clave/enviar', async c => {
    const clave = c.req.param('clave');
    const g = guarda(c, clave);
    if (g.error) return c.json({ error: g.error }, g.status);
    try {
      const body = await c.req.json().catch(() => ({}));
      const to = String(body.to == null ? '' : body.to).trim();
      if (!to) return c.json({ error: 'Escribe a quién se lo mandas.' }, 400);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return c.json({ error: 'Ese correo no tiene buena pinta. Revísalo.' }, 400);

      const empresa = db.prepare('SELECT company_name FROM company_config WHERE id=1').get()?.company_name || 'Bamburu';
      const { html, titulo, filas } = papelDe(db, clave, conSesion(c, filtrosDeUrl(c)), quienDe(c));
      const pdf = await renderPdfFromHtml(printableShell(html, { title: titulo }), { pie: pieDePagina(titulo) });

      const r = await sendEmail({
        // EL REMITENTE, que faltaba y lo cazó el gate: Resend no lanza, devuelve
        // «Missing `from` field» dentro de la respuesta — así que sin mirar el `error` el envío
        // habría pasado por bueno sin salir. Mismo remitente que el resto de correos del producto.
        from: empresa + ' <noreply@bamburu.com>',
        to,
        subject: titulo + ' · ' + empresa,
        html: '<p>Te adjuntamos el <strong>' + escHtml(titulo.toLowerCase()) + '</strong> de <strong>' + escHtml(empresa) + '</strong>'
            + ' (' + filas.length + (filas.length === 1 ? ' línea' : ' líneas') + ').</p>'
            + '<p style="color:#667085;font-size:13px">Los filtros aplicados vienen escritos en la cabecera del documento.</p>',
        attachments: [{ filename: nombreFichero(titulo), content: pdf }],
      });
      // Resend NO lanza: devuelve el fallo dentro. Si no se mira, un envío fallido pasaría por bueno.
      if (r && r.error) {
        return c.json({ error: 'No hemos podido enviarlo: ' + (r.error.message || 'el correo no salió') + '. No se ha marcado como enviado.' }, 502);
      }
      logActivity(db, c.get('session'), 'Envió por correo ' + titulo.toLowerCase(), ENTITY.ACTIVIDAD || 'listado', 0, to);
      return c.json({ ok: true, to, lineas: filas.length });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  return { api, views };
}

// ── LOS TRES BOTONES, UNA SOLA VEZ ──────────────────────────────────────────────────────────────
// Los pinta cualquier pantalla de listado con una línea. Salen del mismo sitio y llevan los filtros
// que la pantalla tenga puestos EN ESE MOMENTO: lo que se imprime es lo que se está viendo.
export function botonesListado(clave, qs = '') {
  const q = qs ? ('?' + qs) : '';
  // Estilos EN LÍNEA a propósito: así este bloque se pega en cualquier pantalla sin depender de que
  // esa pantalla haya cargado una hoja concreta.
  return `<div style="display:inline-flex;gap:.4rem;flex-wrap:wrap">
    <a class="btn btn-secondary btn-sm" href="/admin/listados/${clave}/imprimir${q}" target="_blank" rel="noopener"><i class="ti ti-printer"></i> Imprimir</a>
    <button type="button" class="btn btn-secondary btn-sm" onclick="descargarListado('${clave}','${escHtml(qs)}')"><i class="ti ti-download"></i> Descargar PDF</button>
    <button type="button" class="btn btn-secondary btn-sm" onclick="enviarListado('${clave}','${escHtml(qs)}')"><i class="ti ti-mail"></i> Enviar por correo</button>
  </div>`;
}

// El diálogo de envío. Va aquí y no en cada pantalla por el mismo motivo que todo lo demás.
export const JS_LISTADO_ENVIAR = `
// LA DESCARGA PASA POR AQUÍ Y NO POR UN ENLACE DIRECTO, y el motivo es el aviso de los papeles
// largos: el servidor responde 409 con «esto son 81 hojas» en vez del PDF, y un <a> dejaría ese
// aviso en pantalla como un JSON crudo. Así se pregunta en cristiano y, si dices que sí, baja
// ENTERO — nunca recortado.
async function descargarListado(clave, qs){
  var base = '/admin/listados/' + clave + '/pdf' + (qs ? ('?' + qs) : '');
  try {
    var r = await fetch(base, { headers: { 'Accept': 'application/pdf' } });
    if (r.status === 409) {
      var d = await r.json();
      if (!await window.confirmarEnPagina({titulo:'Es un listado muy largo',texto:d.mensaje,aceptar:'Descargarlo igualmente'})) return;
      base = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'entero=1';
      r = await fetch(base);
    }
    if (!r.ok) { toast('No hemos podido preparar el PDF.','err'); return; }
    var blob = await r.blob();
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (clave + '.pdf');
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
  } catch(e) { toast('No hemos podido preparar el PDF.','err'); }
}

async function enviarListado(clave, qs){
  var _v = await window.pedirDatos({titulo:'Mandar el listado por correo',aceptar:'Enviar',
    campos:[{id:'to',etiqueta:'¿A qué correo lo mandamos?',marcador:'alguien@ejemplo.com'}],
    validar:function(v2){ return !String(v2.to||'').trim() ? {campo:'to',mensaje:'Escribe a quién se lo mandas.'} : null; }});
  if (!_v) return;
  var to = String(_v.to).trim();
  try {
    var d = await api('POST','/api/erp/listados/'+clave+'/enviar'+(qs?('?'+qs):''), { to: to });
    toast('Enviado a '+d.to+' ('+d.lineas+(d.lineas===1?' línea':' líneas')+') ✓');
  } catch(e) { toast(e.message,'err'); }
}
`;
