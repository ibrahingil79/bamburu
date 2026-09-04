import { getDisaWidget } from '../disa/widget.js';
import { escHtml, jsonForScript } from '../../core/escape.js';
import { estadoAvisos, hoyLocal, fuentesDe } from './avisos.js';
import { contarPropuestasPendientes, tiposVisiblesPara } from './propuestas.js';   // D5 — badge de Propuestas de DISA
// NAVEGACIÓN — la definición del menú vive en `menu.js`, en un solo sitio, y la comparten el rail, el
// buscador del topbar y las anclas del usuario. Aquí solo se pinta. `vocabulario()` (las palabras del
// oficio) y `contarAvisosPendientes()` (el contador de la Cola) se consultan allí, no aquí: eran las
// dos lecturas que este fichero hacía por su cuenta.
import { menuDeUsuario, anclasDeUsuario, destinosBuscador, tienePref, MIN_AJUSTES, MAX_ANCLAS } from './menu.js';
// PELDAÑO 8 · qué campos pide el oficio. `oficios.js` es HOJA (solo recibe `db`), así que el
// layout puede importarlo sin cerrar ningún círculo — es la razón por la que se escribió así.
import { oficioDe as oficioDeTenant, oficioPorId } from './oficios.js';
import { fmtEur as dineroEs } from './margen.js';   // el dinero, como en España
// LOS TOKENS Y LA PÁGINA DE ERROR YA NO SE ESCRIBEN AQUÍ, y no es una mudanza cosmética: `core/auth.js`
// necesita `errorShell` para la página de 403 de `requirePerm`, y no puede importar este fichero
// —`layout.js → avisos.js → reposicion.js → routes/purchase-orders.js → core/auth.js` cierra el ciclo,
// por nueve rutas distintas—. Viven en dos ficheros HOJA y se reexportan desde aquí, así que ningún
// importador de `../layout.js` cambia de ruta. Se IMPORTAN además de reexportarse porque este fichero
// los sigue usando (ROOT_TOKENS en adminLayout, ERR.PERM en el modal de acceso denegado).
import { ROOT_TOKENS } from './tokens.js';
import { ERR, cleanErrMsg, errorShell, errorPage } from './pagina-error.js';
export { ROOT_TOKENS, ERR, cleanErrMsg, errorShell, errorPage };


export function csrfField(token) {
  return `<input type="hidden" name="_csrf" value="${token}">`;
}

// Banda de DISA (DISEÑO §6) para vistas SERVER-rendered: aviso calmado con tinte azul y UN solo
// enlace de acción. `text` debe venir ya escapado por quien llama. Espejo de window.disaBand.
export function disaBand(text, href = '', cta = 'Revisar') {
  return `<div class="disa-band"><span class="db-ic"><i class="ti ti-sparkles"></i></span>`
    + `<span class="db-tx">${text}</span>`
    + (href ? `<a class="db-cta" href="${href}">${cta} →</a>` : '')
    + `</div>`;
}

// Menú "···" (DISEÑO §6) para vistas SERVER-rendered: acciones secundarias de una fila.
// items = [{label, href?, onclick?, danger?, target?}]. opts.label → botón con texto (p. ej.
// "Exportar ▾") en vez del "···". Espejo de window.rowMenu.
export function rowMenu(items = [], opts = {}) {
  const body = items.map(it => {
    const cls = 'rmenu-item' + (it.danger ? ' danger' : '');
    if (it.href) return `<a href="${it.href}" class="${cls}"${it.target ? ` target="${it.target}"` : ''}>${it.label}</a>`;
    return `<button type="button" class="${cls}" onclick="closeRowMenus();${it.onclick || ''}">${it.label}</button>`;
  }).join('');
  const trig = opts.label
    ? `<button type="button" class="rmenu-btn rmenu-btn-lbl" data-act="rowmenu">${opts.label} ▾</button>`
    : `<button type="button" class="rmenu-btn" data-act="rowmenu" aria-label="Más acciones" title="Más acciones">⋯</button>`;
  return `<span class="rmenu">${trig}<div class="rmenu-pop">${body}</div></span>`;
}

// Pestañas de filtro por ESTADO para listados (estilo ficha compartido .tabs/.tab). Cada entrada
// es [valor, etiqueta]; '' = "Todos". Los enlaces conservan la búsqueda `q` y reinician la página.
export function estadoTabs(active = '', entries = [], q = '') {
  const link = (v) => {
    const u = new URLSearchParams();
    if (q) u.set('q', q);
    if (v) u.set('estado', v);
    const s = u.toString();
    return s ? `?${s}` : '?';
  };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<div class="tabs">`
    + entries.map(([v, label]) => `<a href="${esc(link(v))}" class="tab${v === (active || '') ? ' active' : ''}">${esc(label)}</a>`).join('')
    + `</div>`;
}

// ── Estado VACÍO compartido (U2) ─────────────────────────────────────────────────
// Bloque centrado con voz de DISA: icono sutil (marca) + UNA frase + acción opcional.
// `text` ya viene escapado por quien llama (es voz de producto, texto fijo). Reutiliza
// los tokens (--accent-soft/--accent) y el botón .btn-primary; espejo de window.emptyState.
// opts: { cta, href } acción principal (botón azul) · soft:true → enlace suave (vacío
// derivado) · tone:'ok' → vacío "bueno" (check verde, sin acción) · icon: icono Tabler.
export function emptyState(text, opts = {}) {
  const { cta = '', href = '', onclick = '', soft = false, icon = 'ti-sparkles', tone = '' } = opts;
  let action = '';
  if (cta && onclick) action = `<button type="button" class="btn btn-primary" onclick="${onclick}">${cta}</button>`;
  else if (cta && href) action = soft ? `<a class="empty-soft" href="${href}">${cta} →</a>` : `<a class="btn btn-primary" href="${href}">${cta}</a>`;
  const ic = tone === 'ok' ? 'ti-circle-check' : icon;
  return `<div class="empty"><span class="empty-ic${tone === 'ok' ? ' ok' : ''}"><i class="ti ${ic}"></i></span>`
    + `<div class="empty-tx">${text}</div>${action}</div>`;
}

// Fila de tabla vacía: envuelve emptyState en <tr><td colspan>. Espejo de window.emptyRow.
export function emptyRow(cols, text, opts = {}) {
  return `<tr><td colspan="${cols}" class="empty-cell">${emptyState(text, opts)}</td></tr>`;
}

// ── Skeleton de CARGA compartido (U2) ────────────────────────────────────────────
// Filas atenuadas con leve pulso mientras el fetch resuelve. Sustituye el <tbody> vacío
// (pantallazo en blanco) y los "Cargando..." sueltos por un patrón único. Espejo de
// window.skeletonRows. `cols` = nº de columnas de la tabla; `rows` = filas fantasma.
export function skeletonRows(cols, rows = 6) {
  const cells = Array.from({ length: cols }, () => `<td><span class="skel"></span></td>`).join('');
  return Array.from({ length: rows }, () => `<tr class="skel-row">${cells}</tr>`).join('');
}

export function can(c, perm) {
  if (c.get('isOwner')) return true;
  if (c.get('isAdmin')) return true;
  const perms = c.get('userPerms') || [];
  return perms.includes(perm);
}

// Qué FUENTES de avisos puede ver este usuario. Cada fuente exige el mismo permiso que su pantalla
// de origen (PERM_POR_FUENTE), así que un aviso nunca es una puerta trasera a datos que la pantalla
// te niega. Falla cerrado: una fuente sin permiso declarado no se sirve a nadie.
//
// El CÁLCULO vive en avisos.js (`fuentesDe`), no aquí: el correo diario necesita exactamente esta
// respuesta y no tiene contexto de Hono del que sacarla. Aquí solo se traduce el contexto a los dos
// datos que hacen falta —rol y lista de permisos—, que es lo único que esta función sabe y el cron no.
export function fuentesPermitidas(c) {
  const role = c.get('isOwner') ? 'owner' : (c.get('isAdmin') ? 'admin' : (c.get('session')?.role || ''));
  return fuentesDe({ role, perms: c.get('userPerms') || [] });
}

// ══ PINTAR EL RAIL — UN SOLO RENDERIZADOR ═════════════════════════════════════════════════════════
// Lo usan `adminLayout` (al servir la página) y la ruta de anclas (que devuelve el bloque YA repintado
// tras anclar o reordenar). Si el HTML del rail se escribiera además en el JavaScript del navegador
// serían DOS renderizadores, y el día que uno cambie el otro se queda viejo en silencio.
//
// `ctx` = { active, anclado:Set, disaBadge }.

// La chincheta. Misma pieza para las entradas del desplegable y para las ÁREAS; lo único que cambia es
// dónde se coloca (`extra`), porque el área tiene chevron a la derecha y la entrada no.
function pinBtn(clave, on, extra = '') {
  const t = on ? 'Quitar de anclados' : 'Anclar arriba del menú';
  return `<button type="button" class="fly-pin${extra ? ' ' + extra : ''}${on ? ' on' : ''}" data-anc="${escHtml(clave)}"`
    + ` title="${t}" aria-label="${t}" aria-pressed="${on}"><i class="ti ${on ? 'ti-pin-filled' : 'ti-pin'}"></i></button>`;
}

// Una entrada del desplegable. La chincheta va DENTRO del enlace, asoma al pasar por encima y NO
// navega (el listener delegado hace preventDefault antes de que el enlace se entere).
// Las etiquetas van ESCAPADAS: una de ellas —«Puestos»— es texto libre que escribe el dueño
// (`cita_puesto_plural`) y aquí se pintaba en crudo, o sea XSS almacenado hacia sus empleados.
function flyItemHTML(i, ctx, bloque = 'diario') {
  const act = i.key === ctx.active ? ' active' : '';
  const ic = `<i class="ti ${i.icon}"></i><span class="fly-tx">${escHtml(i.label)}</span>`;
  // Cartel gris "pendiente": hoy no lo usa ninguna entrada, pero la capacidad se conserva. Sin esta
  // rama, poner `disabled: true` mañana pintaría un enlace normal a una pantalla que no existe.
  if (i.disabled) return `<span class="fly-item disabled" title="Pendiente — aún no disponible">${ic}<span class="nav-pending">pendiente</span></span>`;
  // (D) ARRASTRABLE: la entrada se mueve de sitio dentro de SU área. `data-ord` es su clave y
  // `data-bloque` el lado de la línea en el que está — soltarla al otro lado la cambia de bloque.
  const arr = ` draggable="true" data-ord="${escHtml(i.key)}" data-area="${escHtml(i.areaId || '')}" data-bloque="${bloque}"`;
  if (!i.href) return `<button type="button" class="fly-item${act}"${arr} data-act="${escHtml(i.accion)}">${ic}</button>`;
  return `<a href="${i.href}" class="fly-item${act}"${arr}>${ic}${pinBtn(i.key, ctx.anclado.has(i.key))}</a>`;
}

// (A) JERARQUÍA DENTRO DEL ÁREA — dos bloques separados por una línea y un rótulo. Es SEPARAR, NO
// plegar: las dos mitades se pintan en el mismo desplegable, a la vez, y nada gana un clic. Arriba,
// sin rótulo, lo del día a día; abajo, bajo «Ajustes de <Área>», la configuración y los maestros.
function flyBloquesHTML(a, ctx) {
  const arriba = a.diario.map(i => flyItemHTML(i, ctx, 'diario')).join('');
  const abajo = a.ajustes.map(i => flyItemHTML(i, ctx, 'ajustes')).join('');
  // UNA SOLA LISTA cuando el bloque de ajustes no da para tanto (MIN_AJUSTES): los ajustes se pintan
  // al final, sin línea y sin rótulo. Siguen visibles, en la misma pantalla y a los mismos clics — lo
  // único que se va es el cartel. Partir tres entradas y una en dos secciones con título era más
  // cartel que menú (decisión de Ibrahin, 18 ago 2026).
  if (a.ajustes.length < MIN_AJUSTES) return arriba + abajo;
  // Cuando SÍ se parte, la línea es además el destino con el que se pasa una entrada de un bloque al
  // otro. Si el de arriba se queda vacío se pinta MARCADA: el CSS la esconde en reposo y la enseña al
  // arrastrar, para que se pueda deshacer.
  const sep = `<div class="fly-sep${arriba ? '' : ' vacio'}" data-drop="diario" data-area="${escHtml(a.id)}"></div>`;
  const grp = `<div class="fly-grp" data-drop="ajustes" data-area="${escHtml(a.id)}">Ajustes de ${escHtml(a.label)}</div>`;
  return arriba + sep + grp + abajo;
}

// Un ÁREA del rail: su icono, su nombre y su desplegable. Con `ancla:true` es la COPIA que vive en el
// bloque de anclados: se comporta igual (abre el mismo desplegable) pero se puede arrastrar, y **no
// lleva el id ni el badge de DISA** — dos elementos con el mismo id serían HTML inválido y el contador
// solo se actualizaría en uno. El área de siempre no se mueve de su sitio: arriba hay un atajo, no un
// traslado.
function areaNavgHTML(a, ctx, { ancla = false } = {}) {
  const esDisa = a.id === 'disa';
  const groupActive = a.todos.some(i => i.key === ctx.active) || (esDisa && (ctx.active === 'propuestas' || ctx.active === 'disa'));
  const ic = (esDisa && !ancla)
    ? `<span class="rail-ic"><i class="ti ${a.icon}"></i>${ctx.disaBadge || ''}</span>`
    : `<i class="ti ${a.icon}"></i>`;
  const clave = 'area:' + a.id;
  // (D) El ÁREA se mueve de sitio en el rail: `data-ord` la identifica como pieza reordenable. La
  // copia ANCLADA no: esa se ordena dentro del bloque de anclados, con `data-anc`.
  const arr = ancla
    ? ` data-anc="${escHtml(clave)}" draggable="true"`
    : ` data-ord="area:${escHtml(a.id)}" data-area="__rail__" draggable="true"`;
  return `<div class="navg${ancla ? ' anc' : ''}"${arr} data-navg="1">`
    + `<button type="button"${esDisa && !ancla ? ' id="disaRailBtn"' : ''} class="nav-item${groupActive ? ' active' : ''}" title="${escHtml(a.label)}" aria-label="${escHtml(a.label)}" data-act="navfly">${ic}<span class="nav-label">${escHtml(a.label)}</span><i class="ti ti-chevron-right nav-chev"></i></button>`
    + pinBtn(clave, ctx.anclado.has(clave), 'nav-pin')
    + `<div class="flyout"><div class="flyout-h">${escHtml(a.label)}</div>${flyBloquesHTML(a, ctx)}</div>`
    + `</div>`;
}

// (C) EL BLOQUE DE LO ANCLADO — el CONTENIDO de `#railAnc` (el envoltorio lo pinta el layout y existe
// siempre, vacío o no, para que repintarlo sea cambiarle el interior).
// Se ancla CUALQUIER entrada del menú: las de los desplegables **y las áreas**. Un área anclada trae
// su desplegable entero; una entrada anclada es un enlace. Ni una ni otra sale de su sitio de origen.
export function anclasBloqueHTML(anclas, ctx) {
  if (!anclas.length) return '';
  return anclas.map(i => i.tipo === 'area'
    ? areaNavgHTML(i.area, ctx, { ancla: true })
    : `<a href="${i.href}" class="nav-item anc${i.key === ctx.active ? ' active' : ''}" data-anc="${escHtml(i.key)}" draggable="true" title="${escHtml(i.label)}">`
      + `<i class="ti ${i.icon}"></i><span class="nav-label">${escHtml(i.label)}</span>${pinBtn(i.key, true, 'nav-pin')}</a>`
  ).join('') + `<div class="anc-sep"></div>`;
}

// EL RAIL ENTERO — lo que va dentro de `<nav class="sb-nav">`. Lo pinta el servidor y punto: cuando el
// usuario ancla o reordena, el endpoint devuelve ESTO ya hecho y el navegador solo lo sustituye. Un
// segundo renderizador en el JavaScript acabaría diciendo algo distinto del primero.
// `fijasPie` es una LISTA, no una entrada. Dejó de ser una sola el 23 ago 2026, cuando «Trae tus
// datos» se sumó a «Ayuda y soporte» al pie del rail. Con un `find` la segunda entrada no se habría
// pintado nunca — y sin error: simplemente no estaría. Se acepta también una entrada suelta por si
// algún llamador viejo la pasa así.
export function railHTML(menu, anclas, ctx, fijasPie, hayPref) {
  const pie = Array.isArray(fijasPie) ? fijasPie : (fijasPie ? [fijasPie] : []);
  return `<div class="rail-anc" id="railAnc">${anclasBloqueHTML(anclas, ctx)}</div>`
    + menu.areas.map(a => areaNavgHTML(a, ctx)).join('')
    + `<span class="rail-spacer"></span>`
    // (D) Volver al menú de fábrica. Solo aparece si el usuario ha tocado algo: quien no ha movido
    // nada no tiene nada que restablecer, y un botón que no hace falta es ruido.
    + (hayPref
        ? `<button type="button" class="nav-item rail-reset" id="railReset" title="Restablecer mi menú" aria-label="Restablecer mi menú" data-act="menu-reset"><i class="ti ti-rotate"></i><span class="nav-label">Restablecer mi menú</span></button>`
        : '')
    + pie.map(f => `<a href="${f.href}"${f.target ? ` target="${f.target}"` : ''} class="nav-item${f.key && ctx.active === f.key ? ' active' : ''}" title="${escHtml(f.label)}"><i class="ti ${f.icon}"></i><span class="nav-label">${escHtml(f.label)}</span></a>`).join('');
}

// ══ PINTAR LA CONFIGURACIÓN DEL NEGOCIO ═══════════════════════════════════════════════════════════
// La sección (o secciones) de `CONFIG_NEGOCIO` que este usuario ve, tal y como se pintan dentro de
// /admin/settings. Vive AQUÍ, junto a `railHTML`, y no en routes/settings.js, por la misma razón por
// la que el rail no se pinta en el navegador: si el HTML del menú se escribiera en dos sitios, el día
// que cambie uno el otro se queda viejo en silencio. La pantalla de ajustes llama a esto y ya está.
//
// Lo que llega ya viene FILTRADO por permiso y por condición (`menuDeUsuario`): aquí no se decide
// quién ve qué, solo cómo se ve. Si `config` viene vacío, esto devuelve cadena vacía y la pantalla no
// pinta ni el título.
//
// Las etiquetas van ESCAPADAS: una de ellas —el nombre del puesto— es texto libre que escribe el
// dueño (`cita_puesto_plural`), o sea XSS almacenado hacia sus empleados si se pinta en crudo.
export function configNegocioHTML(config, ctx = {}) {
  if (!config || !config.length) return '';
  const act = ctx.active || '';
  return config.map(sec => {
    const filas = sec.items.map(i => {
      const on = i.key === act ? ' cfg-on' : '';
      return `<a class="cfg-item${on}" href="${i.href}">`
        + `<span class="cfg-ic"><i class="ti ${i.icon}"></i></span>`
        + `<span class="cfg-tx"><strong>${escHtml(i.label)}</strong>`
        + (i.desc ? `<small>${escHtml(i.desc)}</small>` : '')
        + `</span><i class="ti ti-chevron-right cfg-chev"></i></a>`;
    }).join('');
    return `<div class="card cfg-sec" id="${escHtml(sec.id)}" style="max-width:700px;margin-top:1rem"><div class="card-body">`
      + `<h3 style="margin:0 0 .3rem;font-size:1rem"><i class="ti ${sec.icon}" style="margin-right:.35rem"></i>${escHtml(sec.label)}</h3>`
      + (sec.descripcion ? `<p style="color:var(--text2);font-size:13px;margin:0 0 .9rem">${escHtml(sec.descripcion)}</p>` : '')
      + `<div class="cfg-list">${filas}</div>`
      + `</div></div>`;
  }).join('');
}

export function adminLayout(title, content, active = '', csrfToken = '', c = null, hideDisaSidebar = false) {
  const session = c?.get?.('session') || {};
  const role = session.role || '';
  const isOwner = role === 'owner';
  const isAdmin = role === 'admin' || isOwner;
  const perms = c?.get?.('userPerms') || [];

  // PELDAÑO 8 · los campos que pide el oficio de este negocio. Falla en blando a propósito: si el
  // tenant todavía no tiene `company_config` (un negocio a medio crear), la lista sale vacía y las
  // pantallas se pintan igual. Un campo de más que no aparece es una molestia; una pantalla caída
  // por preguntar por el oficio, no.
  let oficioCampos = [];
  try {
    const dbc = c?.get?.('db');
    // OJO: `oficioDe` devuelve el ID (una cadena), no el objeto. Escrito como estaba, esto pedía
    // `'salud'.campos_ficha` y salía undefined — la lista llegaba vacía SIEMPRE y el campo no se
    // pintaba en ningún sitio. Lo cazó el gate abriendo un negocio de salud de verdad.
    if (dbc) { const o = oficioPorId(oficioDeTenant(dbc)); oficioCampos = (o && o.campos_ficha) || []; }
  } catch { oficioCampos = []; }

  // Estado de avisos de ESTE usuario para la ÚNICA señal del chrome: la campana.
  // Se recalcula en cada render (nunca es un número guardado). Manda el ESTADO, no el conteo:
  //   'rojo'    → hay algo que este usuario no ha visto  → punto rojo
  //   'visto'   → hay avisos, pero ya los abrió          → punto gris (siguen pendientes)
  //   'apagado' → no hay nada                            → sin punto
  // Antes el punto colgaba del conteo, así que seguía encendido después de leerlos.
  // Si falla, 'apagado' y sin punto — nunca rompe el render de la página.
  //
  // Cuenta SOLO las fuentes que este usuario puede ver (fuentesPermitidas). Y si la ruta ya calculó
  // el estado (el Inicio lo necesita para su tarjeta), lo deja en `avisosEstado` y aquí se reutiliza:
  // antes /admin ejecutaba el motor entero DOS veces por carga, con argumentos idénticos.
  let avisos = { count: 0, sinVer: 0, estado: 'apagado' };
  try {
    const _db = c?.get?.('db');
    if (_db) {
      const est = c?.get?.('avisosEstado')
        || estadoAvisos(_db, hoyLocal(), session.userId, fuentesPermitidas(c));
      avisos = { count: est.count || 0, sinVer: (est.nuevos || []).length, estado: est.estado };
    }
  } catch { avisos = { count: 0, sinVer: 0, estado: 'apagado' }; }
  // D5 — Propuestas de DISA pendientes, para el badge del topbar. Cada TIPO se cuenta solo si el
  // usuario puede ver ESE tipo (mismo permiso que su pantalla de origen; owner/admin bypass):
  // Qué tipos cuenta el badge lo decide `tiposVisiblesPara` (propuestas.js), la ÚNICA fuente de esa
  // regla — la misma que usan las rutas del panel. Antes esta lista estaba COPIADA aquí, y al añadir
  // tipos nuevos solo se actualizaba allí: el panel enseñaba 22 y el badge decía 21. Un badge que
  // miente te enseña a no fiarte del número, que es peor que no tenerlo.
  // Así el badge nunca delata la existencia de propuestas que el usuario no puede abrir.
  // Un COUNT barato; si falla, 0 (nunca rompe el chrome).
  let propuestasPend = 0;
  try {
    const _db = c?.get?.('db');
    const tipos = tiposVisiblesPara(c, can);
    if (_db && tipos.length) propuestasPend = contarPropuestasPendientes(_db, tipos);
  } catch { propuestasPend = 0; }
  // El título tiene que decir EXACTAMENTE lo mismo que dirá `bellSync` en el primer refresco, o el
  // número da un salto en cuanto la campana se actualiza sola. Antes, con estado 'rojo', el
  // servidor pintaba «46 avisos sin ver» usando el TOTAL, y bellSync lo corregía a «3 avisos sin
  // ver» (los realmente no vistos). Nadie lo notaba porque nada refrescaba la campana; ahora sí.
  // Un solo criterio: si queda algo sin ver, se cuenta lo SIN VER; si no, los pendientes ya vistos.
  const bellTitle = avisos.estado === 'apagado'
    ? 'Avisos — no tienes nada pendiente'
    : (avisos.sinVer
        ? `${avisos.sinVer} aviso${avisos.sinVer === 1 ? '' : 's'} sin ver`
        : `${avisos.count} aviso${avisos.count === 1 ? '' : 's'} pendientes (ya vistos)`);

  // Foto de perfil del usuario (admin_users.foto_url, la elige en /admin/perfil). Mismo patrón
  // que disaCount: si falla, cae a la inicial — nunca rompe el render.
  let fotoUrl = '';
  try {
    const _db = c?.get?.('db');
    if (_db && session.userId) {
      fotoUrl = _db.prepare('SELECT foto_url FROM admin_users WHERE id=?').get(session.userId)?.foto_url || '';
    }
  } catch { fotoUrl = ''; }

  // Banner de SOLO LECTURA: el negocio fue suspendido por impago (suspended_admin) desde el
  // panel de superadmin. Entra y ve sus datos, pero el guard bloquea cualquier escritura.
  const readOnly = !!c?.get?.('tenantReadOnly');
  const _noteRaw = c?.get?.('tenant')?.suspend_note || '';
  const _note = _noteRaw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // ── LAS DOS FRANJAS DEL IMPAGO (tarea `suscripcion-impago-y-corte`, 2 sep 2026) ─────────────────
  //
  // Son DOS estados distintos y por eso son dos franjas, no una con el texto cambiado:
  //   · **Impago sin cortar** (quedan días): la cuenta funciona. Se avisa y se ofrece arreglarlo.
  //   · **Cortado** (solo lectura): la cuenta no deja escribir. Hay que decir **exactamente qué
  //     hacer para volver**, que es el criterio 5 del dueño — la franja de antes decía «hasta
  //     reactivarla» y no decía cómo, que es justo lo que no vale.
  //
  // Las dos llevan **botón**, y el botón va a `/admin/suscripcion`, que `readOnlyGuard` deja pasar
  // aunque la cuenta esté cortada. Ese detalle es el corazón de la tarea: el 2 de septiembre ese
  // mismo estado bloqueaba el botón de pagar, y al negocio al que se le pedía regularizar se le
  // quitaba la única forma de hacerlo.
  const _imp = c?.get?.('impago') || null;
  const _btn = `<a href="/admin/suscripcion" style="display:inline-block;margin-left:10px;background:#fff;color:#7c2d12;padding:3px 12px;border-radius:6px;font-weight:600;text-decoration:none">Arreglar mi pago</a>`;
  const roBanner = readOnly
    ? `<div style="background:#7c2d12;color:#fed7aa;padding:11px 18px;font-size:13px;font-weight:500;text-align:center">⚠️ Tu cuenta está en <strong>SOLO LECTURA</strong>: no hemos podido cobrar tu suscripción. Puedes ver y descargar todo; no puedes crear ni modificar. <strong>No se ha borrado nada.</strong> Para volver, entra en «Mi suscripción», pon una tarjeta que funcione y pulsa «Recuperar mi cuenta».${_btn}</div>`
    : (_imp
      ? `<div style="background:#9a3412;color:#ffedd5;padding:11px 18px;font-size:13px;font-weight:500;text-align:center">⚠️ <strong>Hay un problema con tu pago.</strong> No hemos podido cobrar tu suscripción${_imp.corteEl ? ` y, si no se arregla, el <strong>${_imp.corteEl.split('-').reverse().join('/')}</strong> tu cuenta pasará a solo lectura` : ''}. Se arregla en un minuto.${_btn}</div>`
      : '');

  // ── EL MENÚ DE ESTE USUARIO ───────────────────────────────────────────────────────────────────
  // La definición ya NO vive aquí: está en `menu.js`, en UN solo sitio, y de ahí comen las TRES caras
  // de la navegación —el rail, el buscador del topbar y las anclas del usuario—. Aquí solo se PINTA.
  // Escribir una segunda lista de destinos para el buscador se quedaría vieja y acabaría enseñando
  // puertas que el menú esconde; por eso no hay dos listas, hay una.
  const _dbNav = c?.get?.('db') || null;
  const menu = menuDeUsuario(_dbNav, { role, perms, userId: session.userId });
  // Las anclas NUNCA rompen el chrome: si algo falla, se sale con el menú de fábrica y ya está.
  let anclas = [];
  try { if (_dbNav && session.userId) anclas = anclasDeUsuario(_dbNav, session.userId, menu); }
  catch { anclas = []; }
  const anclado = new Set(anclas.map(a => a.key));

  // ── DISA en el riel (2º icono, debajo de Inicio) ─────────────────────────────
  // Ve el panel de Propuestas quien pueda ver AL MENOS UN tipo: cobros (invoices.read/cobros.read) o
  // pagos a proveedor (purchases.read). Esa regla vive ahora en `menu.js` (`permAlguno`), así que el
  // badge se limita a preguntar si la entrada sobrevivió al filtro: una sola fuente para las dos cosas.
  // Antes eran dos expresiones distintas de la misma regla, aquí mismo, y podían separarse.
  const verPropuestas = menu.areas.some(a => a.id === 'disa' && a.todos.some(i => i.key === 'propuestas'));
  const disaBadge = verPropuestas
    ? `<span class="rail-count" id="propCount"${propuestasPend ? '' : ' style="display:none"'}>${propuestasPend || ''}</span>`
    : '';
  const ctxRail = { active, anclado, disaBadge };
  // ¿Ha tocado algo este usuario? Decide si el rail enseña «Restablecer mi menú».
  let hayPref = false;
  try { if (_dbNav && session.userId) hayPref = tienePref(_dbNav, session.userId); } catch { hayPref = false; }

  // (B) BUSCADOR — se alimenta del MISMO menú ya filtrado por permisos. Por construcción no puede
  // enseñar una puerta que el rail esconda: no existe otra lista de la que sacarla.
  const destinos = destinosBuscador(menu);

  // Las dos entradas FIJAS del rail (Inicio arriba del todo, Ayuda al pie) también salen de `menu.js`,
  // que es lo que permite encontrarlas en el buscador y anclarlas como cualquier otra.
  const fijaPin = menu.fijas.find(f => f.sitio === 'pin') || { href: '/admin', label: 'Inicio', icon: 'ti-home', key: 'dashboard' };
  const fijasPie = menu.fijas.filter(f => f.sitio === 'pie');
  if (!fijasPie.length) fijasPie.push({ href: '/docs', label: 'Ayuda y soporte', key: 'ayuda', icon: 'ti-lifebuoy' });
  const railInner = railHTML(menu, anclas, ctxRail, fijasPie, hayPref);

  // ── Avatar + barra de Cuenta (mockup): cabecera + items gateados + Documentación + salir ──
  const acctVisible = menu.cuenta;
  const userName = session.userName || 'Cuenta';
  const escName = String(userName).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const initial = (String(userName).trim().charAt(0) || 'U').toUpperCase();
  const roleLabel = isOwner ? 'Propietario' : role === 'admin' ? 'Administrador' : role === 'employee' ? 'Empleado' : 'Usuario';
  // Avatar: la foto del Perfil si la hay, si no la inicial. Una sola pieza para los dos sitios
  // que lo pintan (el botón del sidebar y la cabecera del desplegable).
  const escFoto = String(fotoUrl).replace(/"/g, '&quot;');
  const avatarHTML = fotoUrl
    ? `<img src="${escFoto}" alt="" class="acct-avatar" style="object-fit:cover">`
    : `<span class="acct-avatar">${initial}</span>`;
  const acctMenuHTML =
    `<div class="acct-mh">${avatarHTML}<div><div class="acct-mh-n">${escName}</div><div class="acct-mh-e">${roleLabel}</div></div></div>`
    + acctVisible.map(i => `<a href="${i.href}" class="acct-item"><i class="ti ${i.icon}"></i><span>${i.label}</span></a>`).join('')
    + `<div class="acct-sep"></div>`
    + `<a href="/docs" target="_blank" class="acct-item"><i class="ti ti-file-text"></i><span>Documentación</span></a>`
    + `<div class="acct-sep"></div>`
    + `<a href="/admin/logout" class="acct-item danger"><i class="ti ti-logout"></i><span>Cerrar sesión</span></a>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${title} — Bamburu</title>
  <meta name="csrf-token" content="${csrfToken}">
  <!-- Tipografía DEL SISTEMA (DISEÑO §2.6): sin fuentes cargadas de internet. -->
  <!-- Iconos Tabler AUTO-HOSPEDADOS (DISEÑO §2.7 — prohibido depender de iconos de internet).
       CSS + webfont servidos desde /public/vendor/tabler (self-host); cero llamadas a CDN. -->
  <link rel="stylesheet" href="/public/vendor/tabler/tabler-icons.min.css">
  <script nonce="${c?.get?.('cspNonce') || ''}">
    window.CSRF_TOKEN="${csrfToken}";
    window.USER_PERMS=${JSON.stringify(perms)};
    window.USER_IS_OWNER=${isOwner};
    window.USER_IS_ADMIN=${isAdmin};
    // PELDAÑO 8 (24 ago 2026) — QUÉ CAMPOS PIDE EL OFICIO DE ESTE NEGOCIO. Va en el layout, con el
    // resto de lo que toda pantalla necesita saber, y NO en cada pantalla por su cuenta: el
    // vocabulario del oficio ya se partió una vez en dos sitios y la lección está escrita en el
    // oficios.js. Aquí solo viaja la LISTA de campos, no una decisión: cada pantalla mira si el
    // suyo está y lo pinta o no.
    window.OFICIO_CAMPOS=${JSON.stringify(oficioCampos)};
    window.canDo=function(p){if(window.USER_IS_OWNER||window.USER_IS_ADMIN)return true;return window.USER_PERMS.includes(p);};
    // NAVEGACIÓN — el menú de ESTE usuario, YA filtrado por permisos en el servidor. El buscador y las
    // anclas leen de aquí y de ningún otro sitio: por eso no pueden enseñar una puerta que el rail
    // esconda. No es una lista de permisos ni una llave: es lo mismo que ya está pintado en el rail.
    window.MENU_DESTINOS=${jsonForScript(destinos)};
    window.MENU_ANCLAS=${jsonForScript(anclas.map(a => a.key))};
    window.MENU_MAX_ANCLAS=${MAX_ANCLAS};
    window.MENU_ACTIVE=${jsonForScript(active || '')};
  </script>
  <script nonce="${c?.get?.('cspNonce') || ''}">
    function openModal(id){document.getElementById(id).classList.add('open')}
    function closeModal(id){document.getElementById(id).classList.remove('open')}
    // FICHA D-bis — CERRAR CON ESCAPE Y PULSANDO FUERA. Ningun modal del producto lo hacia, y es lo
    // que espera cualquiera. Va en el componente compartido, no en una pantalla: hacerlo solo en una
    // dejaria dos comportamientos distintos para el mismo cacharro.
    document.addEventListener('keydown',function(e){
      if(e.key!=='Escape') return;
      var abierto=document.querySelector('.modal-overlay.open');
      if(abierto){ abierto.classList.remove('open'); if(abierto.__alCerrar) abierto.__alCerrar(); }
    });
    document.addEventListener('mousedown',function(e){
      var ov=e.target;
      if(ov&&ov.classList&&ov.classList.contains('modal-overlay')&&ov.classList.contains('open')){
        ov.classList.remove('open'); if(ov.__alCerrar) ov.__alCerrar();
      }
    });

    // ── PEDIR UN DATO SIN VENTANITA DEL NAVEGADOR (ficha D-bis) ───────────────────────────────
    // NACE DE UNA AVERIA REAL, y su unico trabajo es que no se repita. Guardar un informe pedia el
    // nombre con prompt() y acto seguido confirmaba con confirm(). Chrome, ante el SEGUNDO dialogo
    // seguido, ofrece la casilla «Impedir que esta pagina cree cuadros de dialogo adicionales»; en
    // cuanto alguien la marca, prompt() devuelve null y confirm() devuelve false SIN ENSEÑAR NADA.
    // El boton quedaba muerto: ni dialogo, ni peticion, ni aviso. Medido el 23 ago 2026.
    //
    // Estas dos funciones sustituyen a prompt() y confirm() por un panel DENTRO de la pagina. Quedan
    // aqui, en el componente compartido, porque las otras 81 ventanitas del producto tienen la misma
    // trampa y su migracion esta apuntada en el TABLERO: cuando toque, es cambiar la llamada.
    //
    // El parametro campos: [{id, etiqueta, valor, ayuda, tipo:'texto'|'casilla'|'lista', opciones:[{v,t}]}]
    // Devuelve una promesa con el objeto de valores, o null si se cancela.
    window.pedirDatos=function(opciones){
      var o=opciones||{};
      return new Promise(function(resolve){
        var ov=document.createElement('div');
        ov.className='modal-overlay open';
        var campos=(o.campos||[]);
        var cuerpo=campos.map(function(c){
          if(c.tipo==='casilla') return '<div class="form-group"><label class="form-label" style="display:flex;gap:.5rem;align-items:flex-start;cursor:pointer">'
            +'<input type="checkbox" id="pd-'+c.id+'" style="width:16px;height:16px;margin-top:2px"'+(c.valor?' checked':'')+'>'
            +'<span><span style="font-weight:600">'+escHtmlCli(c.etiqueta)+'</span>'
            +(c.ayuda?'<span style="display:block;font-weight:400;font-size:.74rem;color:var(--muted);margin-top:.15rem">'+escHtmlCli(c.ayuda)+'</span>':'')
            +'</span></label></div>';
          if(c.tipo==='lista') return '<div class="form-group"><label class="form-label" for="pd-'+c.id+'">'+escHtmlCli(c.etiqueta)+'</label>'
            +'<select class="form-control" id="pd-'+c.id+'">'+(c.opciones||[]).map(function(x){
               return '<option value="'+escHtmlCli(x.v)+'"'+(String(x.v)===String(c.valor)?' selected':'')+'>'+escHtmlCli(x.t)+'</option>';}).join('')+'</select>'
            +(c.ayuda?'<div style="font-size:.74rem;color:var(--muted);margin-top:.2rem">'+escHtmlCli(c.ayuda)+'</div>':'')
            +'<div class="pd-err" data-para="'+c.id+'" style="display:none;color:var(--danger);font-size:.74rem;margin-top:.25rem"></div></div>';
          return '<div class="form-group"><label class="form-label" for="pd-'+c.id+'">'+escHtmlCli(c.etiqueta)+'</label>'
            +'<input class="form-control" id="pd-'+c.id+'" type="'+(c.tipo==='numero'?'number':'text')+'" value="'+escHtmlCli(c.valor==null?'':c.valor)+'"'
            +(c.marcador?' placeholder="'+escHtmlCli(c.marcador)+'"':'')+'>'
            +(c.ayuda?'<div style="font-size:.74rem;color:var(--muted);margin-top:.2rem">'+escHtmlCli(c.ayuda)+'</div>':'')
            +'<div class="pd-err" data-para="'+c.id+'" style="display:none;color:var(--danger);font-size:.74rem;margin-top:.25rem"></div></div>';
        }).join('');
        ov.innerHTML='<div class="modal" role="dialog" aria-modal="true"><div class="modal-head">'
          +'<h3>'+escHtmlCli(o.titulo||'')+'</h3><button type="button" class="modal-close" data-pd="x">✕</button></div>'
          +'<div class="modal-body">'+(o.texto?'<p style="font-size:.82rem;color:var(--text2);margin-bottom:.9rem">'+escHtmlCli(o.texto)+'</p>':'')+cuerpo
          +'<div id="pd-general" style="display:none;background:#FBE3E3;border:1px solid #F0CFCC;color:#C0392B;border-radius:8px;padding:.55rem .7rem;font-size:.78rem;margin-top:.4rem"></div></div>'
          +'<div class="modal-foot"><button type="button" class="btn btn-secondary" data-pd="x">'+escHtmlCli(o.cancelar||'Cancelar')+'</button>'
          +'<button type="button" class="btn btn-primary" data-pd="ok">'+escHtmlCli(o.aceptar||'Guardar')+'</button></div></div>';
        document.body.appendChild(ov);
        var vivo=true;
        function cerrar(val){ if(!vivo) return; vivo=false; ov.remove(); resolve(val); }
        ov.__alCerrar=function(){ cerrar(null); };
        ov.querySelectorAll('[data-pd="x"]').forEach(function(b){ b.onclick=function(){ cerrar(null); }; });
        var leer=function(){ var o2={}; campos.forEach(function(c){ var el=document.getElementById('pd-'+c.id);
          o2[c.id]= c.tipo==='casilla' ? !!el.checked : el.value; }); return o2; };
        var pintarError=function(id,msg){
          var g=document.getElementById('pd-general');
          if(!id){ g.style.display=''; g.textContent=msg; return; }
          var e=ov.querySelector('.pd-err[data-para="'+id+'"]');
          if(e){ e.style.display=''; e.textContent=msg; }
          var el=document.getElementById('pd-'+id); if(el){ el.style.borderColor='var(--danger)'; el.focus(); }
        };
        var limpiar=function(){ ov.querySelectorAll('.pd-err').forEach(function(e){e.style.display='none';});
          document.getElementById('pd-general').style.display='none';
          campos.forEach(function(c){ var el=document.getElementById('pd-'+c.id); if(el) el.style.borderColor=''; }); };
        var aceptar=async function(){
          limpiar();
          var val=leer();
          if(typeof o.validar==='function'){
            var fallo=o.validar(val);
            // EL PANEL NO SE CIERRA EN SILENCIO NUNCA: o pasa la validacion, o se dice que no y donde.
            if(fallo){ pintarError(fallo.campo||null, fallo.mensaje||'Revisa este dato.'); return; }
          }
          if(typeof o.alAceptar==='function'){
            var b=ov.querySelector('[data-pd="ok"]'); var txt=b.textContent;
            b.disabled=true; b.textContent='Guardando…';
            try{ await o.alAceptar(val); }
            catch(err){
              // Y SI FALLA, SE DICE. Rehabilitar el boton va aqui y tambien en el camino feliz:
              // deshabilitarlo antes de algo asincrono y soltarlo solo si sale bien deja el mando
              // muerto cuando falla (fallo de clase ya pagado en este repo).
              b.disabled=false; b.textContent=txt;
              pintarError(null, (err&&err.message)||'No hemos podido guardarlo. Vuelve a intentarlo.');
              return;
            }
            b.disabled=false; b.textContent=txt;
          }
          cerrar(val);
        };
        ov.querySelector('[data-pd="ok"]').onclick=aceptar;
        ov.addEventListener('keydown',function(e){ if(e.key==='Enter'&&e.target.tagName==='INPUT'&&e.target.type!=='checkbox'){ e.preventDefault(); aceptar(); } });
        // FOCO Y TEXTO SELECCIONADO en el primer campo: el nombre propuesto se acepta con Enter o se
        // reescribe sin tener que borrarlo antes.
        setTimeout(function(){ var pri=campos.find(function(c){return c.tipo!=='casilla';});
          if(pri){ var el=document.getElementById('pd-'+pri.id); if(el){ el.focus(); if(el.select) el.select(); } } },30);
      });
    };

    // Confirmar SIN ventanita. Misma promesa: true / false.
    window.confirmarEnPagina=function(opciones){
      var o=opciones||{};
      return window.pedirDatos({ titulo:o.titulo, texto:o.texto, campos:[],
        aceptar:o.aceptar||'Sí, adelante', cancelar:o.cancelar||'No, dejarlo',
        alAceptar:o.alAceptar }).then(function(v){ return v!==null; });
    };
    // Escape de HTML del lado del cliente (el del servidor no vive aqui).
    function escHtmlCli(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
    window.escHtmlCli=escHtmlCli;

    // ── EL DINERO Y LAS FECHAS, ESCRITOS COMO EN ESPAÑA ──────────────────────────────────────────
    // UNA sola forma para todo el producto, aquí, en el componente compartido: el mismo sitio donde
    // vive el escape de HTML y por el mismo motivo. Antes había QUINCE ayudantes distintos repartidos por
    // las pantallas —la mitad escribían €117087.43, con el símbolo delante y punto decimal— y por
    // eso convivían dos formas de escribir la misma cifra. Se escribe 117.087,43 €: miles con
    // punto, decimales con coma, símbolo DETRÁS y separado.
    //
    // LO QUE ESTO NO ES: no vale para el valor de un campo ni para lo que se manda al servidor. Ahi
    // el numero va crudo, porque alguien lo vuelve a leer y 1.234,56 no es un numero. Esto es solo
    // para lo que LEE UNA PERSONA.
    window.eur=function(n,sym){
      if(n==null||n==='') return '—';
      var v=Number(n); if(!isFinite(v)) return '—';
      return v.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:'always'})
        + ' ' + (sym||window.MONEDA_SIMBOLO||'€');
    };
    // MISMO NOMBRE EN LOS DOS LADOS. En el servidor se importa fmtEur con este alias; aquí es
    // global. Así la misma expresión —dineroEs(x, sym)— vale escriba donde escriba quien la usa,
    // y no hay que acordarse de en qué mitad del fichero se está.
    window.dineroEs=window.eur;

    // Un porcentaje, con su coma: 46,6 %
    window.pct=function(n,dec){
      if(n==null||n==='') return '—';
      var v=Number(n); if(!isFinite(v)) return '—';
      var d=(dec==null?1:dec);
      return v.toLocaleString('es-ES',{minimumFractionDigits:d,maximumFractionDigits:d}) + ' %';
    };
    // Un numero a secas, tambien en espanol: 10,00 h · 1.234,5. Para lo que NO es dinero ni
    // porcentaje (horas, unidades). Mismo motivo: en la misma pantalla no pueden convivir
    // «1.000,00 EUR» y «10.00 h».
    window.numEs=function(n,dec){
      if(n==null||n==='') return '—';
      var v=Number(n); if(!isFinite(v)) return '—';
      var d=(dec==null?2:dec);
      return v.toLocaleString('es-ES',{minimumFractionDigits:d,maximumFractionDigits:d,useGrouping:'always'});
    };
    // Y LA FECHA. 2026-08-24 es como se guarda, no como se dice: en pantalla va 24/08/2026.
    window.fechaEs=function(iso){
      var m=/^(\\d{4})-(\\d{2})-(\\d{2})/.exec(String(iso==null?'':iso));
      return m ? (m[3]+'/'+m[2]+'/'+m[1]) : String(iso==null?'':iso);
    };
    function toast(msg,type='ok'){
      const t=document.createElement('div');
      const styles={ok:'background:#E4F6EA;border:1px solid #CDE8D8;color:#157F3B',err:'background:#FBE3E3;border:1px solid #F0CFCC;color:#C0392B',warn:'background:#FBEED0;border:1px solid #EBDDB7;color:#8A5B00'};
      // FICHA D-bis — EL AVISO SALIA DEBAJO DEL BOTON FLOTANTE DE DISA y se leia a medias. Medido:
      // el aviso estaba en bottom/right 24px con z-index 9999, y #disaFab en bottom/right 24px con
      // z-index 99999 — el MISMO rincon y el aviso por debajo. En la captura se leia «Informe guar».
      // Se arregla por los dos lados: se sube por encima de la burbuja (88px, que es su alto mas su
      // margen) Y se le da mas z-index, porque la burbuja se puede ARRASTRAR y el hueco no basta.
      t.style.cssText='position:fixed;bottom:88px;right:1.5rem;padding:.75rem 1.1rem;border-radius:12px;font-size:.85rem;font-weight:500;z-index:100000;box-shadow:0 12px 36px rgba(16,24,40,.16);max-width:320px';
      Object.assign(t.style, {});
      t.setAttribute('style', t.style.cssText + ';' + (styles[type]||styles.ok));
      t.textContent=msg;
      document.body.appendChild(t);
      requestAnimationFrame(()=>requestAnimationFrame(()=>t.style.opacity='1'));
      setTimeout(()=>t.remove(),3200);
    }
    function switchTab(group,key){
      document.querySelectorAll('[data-tab-group="'+group+'"]').forEach(el=>{el.classList.toggle('active',el.dataset.tabKey===key)});
      document.querySelectorAll('[data-pane-group="'+group+'"]').forEach(el=>{el.classList.toggle('active',el.dataset.paneKey===key)});
    }
    // ── Errores (U3): textos y limpiador compartidos (espejo de ERR/cleanErrMsg del server) ──
    window.ERR={
      GEN:'No hemos podido completar la acción. Vuelve a intentarlo en un momento; si sigue pasando, escríbenos a soporte.',
      GEN_SHORT:'No se pudo completar. Inténtalo de nuevo.',
      NET:'Parece que se perdió la conexión. Revisa tu internet y vuelve a intentarlo.',
      LOAD:'No hemos podido cargar los datos. Recarga la página; si sigue igual, inténtalo en un momento.',
      PERM:'No tienes permiso para esta acción. Si lo necesitas, pídeselo al dueño o a un administrador del negocio.',
      VALID:'Revisa el formulario: hay algún campo incompleto o con un formato que no cuadra.',
      PDF:'No hemos podido generar el PDF ahora mismo. Vuelve a intentarlo en un momento; si persiste, avísanos.',
      EMAIL:'No hemos podido enviar el email. Comprueba la dirección del destinatario e inténtalo más tarde.'
    };
    var _DUP={'categories.name':'Ya existe una categoría con ese nombre. Usa otro.','admin_users.email':'Ya hay un usuario con ese email.','discount_codes.code':'Ese código de descuento ya está en uso. Prueba con otro.','products.sku':'Ya existe un producto con ese SKU. Usa una referencia distinta.'};
    // OJO: este bloque vive dentro de un template literal (el <script nonce="${c?.get?.('cspNonce') || ''}"> de adminLayout), así que las
    // barras de las regex van DOBLADAS (\\s, \\., \\(, \\), \\d, \\b) para llegar intactas al navegador.
    window.cleanErrMsg=function(msg){
      var s=(msg==null?'':String(msg)).trim();
      if(!s)return window.ERR.GEN_SHORT;
      var uq=s.match(/UNIQUE constraint failed:\\s*([a-z0-9_]+\\.[a-z0-9_]+)/i);
      if(uq)return _DUP[uq[1].toLowerCase()]||'Ya existe un registro con ese valor. Revisa los datos e inténtalo de nuevo.';
      if(/SQLITE_|no such (table|column)|NOT NULL constraint|datatype mismatch|FOREIGN KEY constraint|CHECK constraint|constraint failed|is not defined|Cannot read propert|is not a function|\\bat .+\\.js:\\d+/i.test(s))return window.ERR.GEN;
      if(/^Datos inválidos/i.test(s))return window.ERR.VALID;
      s=s.replace(/\\s*\\((?:confirm_[a-z_]+|cobros\\.manage|purchases\\.create|D\\d)\\)/g,'');
      s=s.replace(/\\s*\\((?:R1[–-]R5|S o I)\\)/g,'');
      return s;
    };
    async function api(method,url,body){
      const opts={method,headers:{'Content-Type':'application/json'}};
      if(!['GET','HEAD'].includes(method.toUpperCase()))opts.headers['x-csrf-token']=window.CSRF_TOKEN;
      if(body)opts.body=JSON.stringify(body);
      let r;
      try{ r=await fetch(url,opts); }catch(_e){ throw new Error(window.ERR.NET); }   // sin red → mensaje claro
      if(r.status===403&&method!=='GET'){if(typeof showAccessDenied==='function')showAccessDenied();throw new Error(window.ERR.PERM);}
      if(r.status===403)throw new Error(window.ERR.PERM);
      let d;
      try{ d=await r.json(); }catch(_e){ d=null; }                                   // respuesta no-JSON (500 HTML, etc.)
      if(!d){ if(r.ok) return {}; throw new Error(window.ERR.GEN); }
      if(d.error)throw new Error(window.cleanErrMsg(d.error));
      // Cualquier MUTACIÓN puede cambiar los avisos: cobrar, pagar, ajustar stock, mover una
      // oportunidad del CRM, emitir una recurrente… En vez de que cada pantalla se acuerde de
      // avisar a la campana (y una se olvide), se engancha aquí, que es el ÚNICO sitio por el
      // que pasan todas. Los endpoints de avisos se excluyen: esos ya sincronizan con bellSync,
      // y volver a preguntar sería pagar el escaneo caro dos veces por cada clic.
      if(!['GET','HEAD'].includes(method.toUpperCase()) && url.indexOf('/api/erp/avisos')!==0
         && typeof window.bellTrasCambio==='function') window.bellTrasCambio();
      return d;
    }
    window.escHtml=function(s){
      if(s==null)return'';
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    };
    window.showAccessDenied=function(){
      var m=document.getElementById('accessDeniedModal');
      if(m)m.style.display='flex';
    };
    // ── Patrón por pantalla (DISEÑO §6) — helpers compartidos ──
    // Banda de DISA: aviso calmado con UN enlace de acción ("Revisar →"). text ya viene escapado.
    window.disaBand=function(text,href,cta){
      return '<div class="disa-band"><span class="db-ic"><i class="ti ti-sparkles"></i></span>'
        +'<span class="db-tx">'+text+'</span>'
        +(href?'<a class="db-cta" href="'+href+'">'+(cta||'Revisar')+' →</a>':'')+'</div>';
    };
    // Estado VACÍO (U2): icono sutil + frase + acción opcional. text ya viene escapado.
    // opts: {cta,href} botón azul · soft:true enlace suave · tone:'ok' vacío bueno (check).
    window.emptyState=function(text,opts){
      opts=opts||{};
      var cta=opts.cta||'',href=opts.href||'',onclick=opts.onclick||'',soft=opts.soft,icon=opts.icon||'ti-sparkles',tone=opts.tone||'';
      var action='';
      if(cta&&onclick)action='<button type="button" class="btn btn-primary" onclick="'+onclick+'">'+cta+'</button>';
      else if(cta&&href)action=soft?'<a class="empty-soft" href="'+href+'">'+cta+' →</a>':'<a class="btn btn-primary" href="'+href+'">'+cta+'</a>';
      var ic=tone==='ok'?'ti-circle-check':icon;
      return '<div class="empty"><span class="empty-ic'+(tone==='ok'?' ok':'')+'"><i class="ti '+ic+'"></i></span><div class="empty-tx">'+text+'</div>'+action+'</div>';
    };
    // Fila de tabla vacía: envuelve emptyState en <tr><td colspan>.
    window.emptyRow=function(cols,text,opts){return '<tr><td colspan="'+cols+'" class="empty-cell">'+window.emptyState(text,opts)+'</td></tr>';};
    // Skeleton de CARGA (U2): filas atenuadas con leve pulso mientras resuelve el fetch.
    window.skeletonRows=function(cols,rows){rows=rows||6;var cells='';for(var i=0;i<cols;i++)cells+='<td><span class="skel"></span></td>';var out='';for(var r=0;r<rows;r++)out+='<tr class="skel-row">'+cells+'</tr>';return out;};
    // Menú "···": acciones secundarias de una fila. items=[{label, href?, onclick?, danger?, target?}].
    window.rowMenu=function(items,opts){
      opts=opts||{};
      var body=(items||[]).map(function(it){
        var cls='rmenu-item'+(it.danger?' danger':'');
        if(it.href) return '<a href="'+it.href+'" class="'+cls+'"'+(it.target?' target="'+it.target+'"':'')+'>'+it.label+'</a>';
        return '<button type="button" class="'+cls+'" onclick="closeRowMenus();'+(it.onclick||'')+'">'+it.label+'</button>';
      }).join('');
      var trig=opts.label
        ? '<button type="button" class="rmenu-btn rmenu-btn-lbl" data-act="rowmenu">'+opts.label+' ▾</button>'
        : '<button type="button" class="rmenu-btn" data-act="rowmenu" aria-label="Más acciones" title="Más acciones">⋯</button>';
      return '<span class="rmenu">'+trig+'<div class="rmenu-pop">'+body+'</div></span>';
    };
    window.closeRowMenus=function(){document.querySelectorAll('.rmenu-pop.open').forEach(function(p){p.classList.remove('open');});};
    window.toggleRowMenu=function(btn){
      var pop=btn.nextElementSibling, isOpen=pop.classList.contains('open');
      window.closeRowMenus();
      if(isOpen) return;
      var r=btn.getBoundingClientRect();
      pop.classList.add('open');
      var pw=pop.offsetWidth;
      pop.style.top=(r.bottom+4)+'px';
      pop.style.left=Math.max(8,r.right-pw)+'px';
    };
    document.addEventListener('click',function(e){if(!e.target.closest('.rmenu'))window.closeRowMenus();});
    window.addEventListener('scroll',function(){window.closeRowMenus();},true);
    document.addEventListener('keydown',function(e){if(e.key==='Escape')window.closeRowMenus();});
    // ── Rail estilo Holded — flyout (submenú flotante) por área ──
    var _flyTimer=null;
    window.cancelCloseFly=function(){if(_flyTimer){clearTimeout(_flyTimer);_flyTimer=null;}};
    window.closeFly=function(){document.querySelectorAll('.flyout.open').forEach(function(f){f.classList.remove('open');});var sb=document.querySelector('.sidebar');if(sb)sb.classList.remove('flyopen');};
    window.scheduleCloseFly=function(){window.cancelCloseFly();_flyTimer=setTimeout(window.closeFly,180);};
    window.openFly=function(g){
      window.cancelCloseFly();
      var fly=g.querySelector('.flyout'); if(!fly) return;
      document.querySelectorAll('.flyout.open').forEach(function(f){if(f!==fly)f.classList.remove('open');});
      var sb=document.querySelector('.sidebar'); if(sb) sb.classList.add('flyopen');
      // El rail queda anclado a 240px (.sidebar.flyopen); el flyout va justo a su derecha.
      // Usamos la constante (no getBoundingClientRect) porque el ancho está a mitad de transición.
      var icon=g.querySelector('.nav-item'), r=icon.getBoundingClientRect();
      fly.style.left='246px';
      fly.style.top='0px';
      fly.classList.add('open');
      var oh=fly.offsetHeight;
      fly.style.top=Math.max(8, Math.min(r.top, window.innerHeight-8-oh))+'px';
    };
    window.toggleFly=function(g){
      var fly=g.querySelector('.flyout');
      if(fly&&fly.classList.contains('open')) fly.classList.remove('open'); else window.openFly(g);
    };
    document.addEventListener('click',function(e){if(!e.target.closest('.navg'))window.closeFly();});
    // El flyout se cierra al hacer scroll DE LA PÁGINA, no al desplazar un panel de dentro. Con
    // capture:true este listener veía TODOS los scrolls, incluidos los de cualquier contenedor con
    // overflow — y desde que la agenda es un lienzo con scroll propio, colocarse en la hora actual
    // cerraba el menú lateral solo. Se abría el desplegable y se cerraba en la cara.
    window.addEventListener('scroll',function(e){
      var t=e.target;
      if(t===document||t===document.documentElement||t===document.body||t===window) window.closeFly();
    },true);
    document.addEventListener('keydown',function(e){if(e.key==='Escape')window.closeFly();});

    // ══ (B) BUSCADOR QUE NAVEGA ═══════════════════════════════════════════════════════════════
    // Come de window.MENU_DESTINOS: el menú de ESTE usuario, ya filtrado por permisos en el servidor.
    // No hay una segunda lista de destinos —se quedaría vieja y acabaría enseñando puertas que el menú
    // esconde—, así que lo que no está en el rail tampoco está aquí.
    // OJO: este <script nonce="${c?.get?.('cspNonce') || ''}"> vive en el <head>, así que al ejecutarse el topbar TODAVÍA NO EXISTE. Hay que
    // esperar al DOM o los listeners no se enganchan a nada y el buscador queda mudo — sin error, sin
    // aviso, sin nada. (Las anclas de abajo no lo necesitan: van por delegación en document.)
    (function(){
    function arrancaBuscador(){
      var wrap=document.getElementById('tbSearch'), inp=document.getElementById('tbq'), pan=document.getElementById('tbres');
      if(!wrap||!inp||!pan) return;
      var DEST=window.MENU_DESTINOS||[];
      // Coincidencia POR NOMBRE: sin búsqueda difusa (así lo pide la pieza). Lo único que se normaliza
      // son mayúsculas y tildes — quien teclea "analitica" busca "Analítica", y eso no es adivinar: es
      // escribir en español sin acentos.
      //
      // SÍ hay nombres VIEJOS (alias), y no son sinónimos inventados: son el nombre que esa misma
      // entrada tuvo hasta que se renombró. Quien lleva un año buscando «Cola de envíos» la encuentra,
      // y lo que ve en el resultado es el nombre NUEVO — que es como se llama ahora y como la va a
      // encontrar la próxima vez. Un alias nunca crea un destino: solo abre otra puerta al mismo.
      function norm(s){return String(s==null?'':s).toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');}
      for(var k=0;k<DEST.length;k++){
        DEST[k]._n=norm(DEST[k].label);
        DEST[k]._a=(DEST[k].alias||[]).map(norm);
      }
      var res=[], sel=-1;
      // Posición de la coincidencia MÁS TEMPRANA entre el nombre y sus alias: 0 = empieza por lo
      // tecleado, >0 = lo contiene, -1 = no coincide. Así un alias que empieza por el término pesa
      // igual que el nombre — buscar "cola" tiene que dejar arriba «Recordatorios a clientes».
      function donde(d, n){
        var mejor=-1, p=d._n.indexOf(n);
        if(p===0) return 0;
        if(p>0) mejor=p;
        for(var j=0;j<d._a.length;j++){
          var q=d._a[j].indexOf(n);
          if(q===0) return 0;
          if(q>0 && (mejor<0 || q<mejor)) mejor=q;
        }
        return mejor;
      }
      function buscar(q){
        var n=norm(q).trim();
        if(!n) return [];
        var empieza=[], contiene=[];
        for(var i=0;i<DEST.length;i++){
          var p=donde(DEST[i], n);
          if(p===0) empieza.push(DEST[i]); else if(p>0) contiene.push(DEST[i]);
        }
        return empieza.concat(contiene).slice(0,8);   // los que EMPIEZAN por lo tecleado, primero
      }
      function pintar(){
        if(!res.length){ pan.innerHTML='<p class="tb-res-none">Nada del menú se llama así.</p>'; return; }
        pan.innerHTML=res.map(function(d,i){
          var ar=d.area?'<span class="tb-res-ar">'+escHtml(d.area)+'</span>':'';
          return '<a class="tb-res-i'+(i===sel?' sel':'')+'" role="option" aria-selected="'+(i===sel)+'" data-i="'+i+'" href="'+escHtml(d.href||'#')+'">'
            +'<i class="ti '+escHtml(d.icon||'ti-arrow-right')+'"></i><span class="tb-res-tx">'+escHtml(d.label)+'</span>'+ar+'</a>';
        }).join('');
      }
      function abrir(){ pan.classList.add('open'); inp.setAttribute('aria-expanded','true'); }
      function cerrar(){ pan.classList.remove('open'); inp.setAttribute('aria-expanded','false'); }
      function ir(d){
        if(!d) return;
        cerrar();
        if(d.href){ location.href=d.href; return; }
        // «Hablar con DISA» no es una pantalla: es el chat flotante de siempre. Se abre igual que desde
        // el menú —sin hilo nuevo y sin duplicar el widget—, no se navega a ningún sitio.
        if(window.disaOpen){ window.disaOpen(); } else { location.href='/admin/disa'; }
      }
      inp.addEventListener('input',function(){
        wrap.classList.toggle('busca',!!inp.value);
        res=buscar(inp.value); sel=res.length?0:-1;
        if(inp.value){ pintar(); abrir(); } else { cerrar(); }
      });
      inp.addEventListener('keydown',function(e){
        if(e.key==='ArrowDown'||e.key==='ArrowUp'){
          if(!res.length) return;
          e.preventDefault();
          sel=((sel<0?0:sel)+(e.key==='ArrowDown'?1:res.length-1))%res.length;
          pintar();
          var el=pan.querySelector('.tb-res-i.sel'); if(el&&el.scrollIntoView) el.scrollIntoView({block:'nearest'});
        } else if(e.key==='Enter'){
          if(res.length){ e.preventDefault(); ir(res[sel<0?0:sel]); }
        } else if(e.key==='Escape'){
          // Con texto, Esc limpia el buscador y NO cierra nada más (por eso se corta la propagación:
          // si no, el mismo Esc cerraría también el flyout y el cajón del móvil).
          if(inp.value){ e.stopPropagation(); inp.value=''; wrap.classList.remove('busca'); res=[]; sel=-1; cerrar(); }
          else inp.blur();
        }
      });
      inp.addEventListener('focus',function(){ if(res.length) abrir(); });
      pan.addEventListener('click',function(e){
        var a=e.target.closest('.tb-res-i'); if(!a) return;
        e.preventDefault(); ir(res[parseInt(a.getAttribute('data-i'),10)]);
      });
      document.addEventListener('click',function(e){ if(!e.target.closest('#tbSearch')) cerrar(); });
      // Atajo de teclado. Ctrl+K está tomado por la barra de direcciones en Chrome: hay que cortarlo.
      var esMac=/Mac|iPhone|iPad/.test((navigator.platform||'')+' '+(navigator.userAgent||''));
      var kbd=document.getElementById('tbkbd'); if(kbd&&esMac) kbd.textContent='⌘K';
      document.addEventListener('keydown',function(e){
        if((e.ctrlKey||e.metaKey)&&(e.key==='k'||e.key==='K')){ e.preventDefault(); inp.focus(); inp.select(); }
      });
    }
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',arrancaBuscador);
    else arrancaBuscador();
    })();

    // ══ (C)+(D) EL MENÚ DE CADA UNO — anclar, y mover de orden ═══════════════════════════════════
    // La casa viene ordenada y el usuario la ajusta ENCIMA. Se ancla CUALQUIER entrada —las de los
    // desplegables Y las áreas— y se MUEVE DE ORDEN cualquiera de las dos. Lo que no cambia: nada se
    // esconde, nada se quita, ninguna entrada se muda a otra área, y quien no toca nada ve el menú de
    // fábrica.
    //
    // EL RAIL NO SE PINTA AQUÍ. Lo pinta el servidor con su renderizador y lo devuelve ya hecho; aquí
    // solo se sustituye. Un segundo renderizador en el navegador acabaría diciendo algo distinto del
    // primero el día que uno de los dos cambie — y un área anclada arrastra su desplegable entero.
    (function(){
      var MAX=window.MENU_MAX_ANCLAS||8;
      function pintarPins(){
        var claves=window.MENU_ANCLAS||[];
        document.querySelectorAll('.fly-pin').forEach(function(b){
          var on=claves.indexOf(b.getAttribute('data-anc'))>=0;
          b.classList.toggle('on',on);
          b.setAttribute('aria-pressed',on?'true':'false');
          b.title=on?'Quitar de anclados':'Anclar arriba del menú';
          b.setAttribute('aria-label',b.title);
          var ic=b.querySelector('i'); if(ic) ic.className='ti '+(on?'ti-pin-filled':'ti-pin');
        });
      }
      // Sustituye el rail entero por el que devuelve el servidor. Se cierra el desplegable antes:
      // los nodos que tenía abiertos dejan de existir.
      function pintarRail(r){
        if (!r) return;
        if (Array.isArray(r.anclas)) window.MENU_ANCLAS = r.anclas;
        if (typeof r.rail === 'string') {
          window.closeFly();
          var nav = document.getElementById('sbNav');
          if (nav) nav.innerHTML = r.rail;
        }
        pintarPins();
      }
      function guardar(claves){
        return api('PUT','/api/erp/menu/anclas',{claves:claves,activa:window.MENU_ACTIVE||''})
          .then(function(r){ if(r && !Array.isArray(r.anclas)) r.anclas = claves; pintarRail(r); })
          .catch(function(e){ toast((e&&e.message)||window.ERR.GEN_SHORT,'err'); });
      }
      // Anclar / desanclar desde el desplegable. El botón vive DENTRO del enlace, así que hay que
      // cortar la navegación antes de que el <a> se la lleve.
      document.addEventListener('click',function(e){
        var b=e.target.closest('.fly-pin'); if(!b) return;
        e.preventDefault(); e.stopPropagation();
        var k=b.getAttribute('data-anc'), claves=(window.MENU_ANCLAS||[]).slice(), i=claves.indexOf(k);
        if(i>=0) claves.splice(i,1);
        else {
          if(claves.length>=MAX){ toast('Puedes tener '+MAX+' anclados como mucho. Quita uno para poner otro.','warn'); return; }
          claves.push(k);
        }
        guardar(claves);
      });
      // ══ (D) MOVER DE ORDEN — anclas, ÁREAS y ENTRADAS de submenú ══════════════════════════════
    // Tres cosas que se arrastran, un solo mecanismo. Cada pieza arrastrable dice quién es:
    //   · bloque de anclados → data-anc  (hija directa de #railAnc)
    //   · área del rail      → data-ord="area:<id>"  data-area="__rail__"
    //   · entrada de submenú → data-ord="<clave>"    data-area="<id de su área>"  data-bloque=diario|ajustes
    // Una entrada NO se muda a otra área: solo se ordena dentro de la suya, y cruzar la línea de
    // «Ajustes de …» la cambia de bloque. Se suelta ANTES o DESPUÉS según por qué mitad se entre.
    var arr = null;       // { tipo:'anc'|'ord', clave, area, bloque }
    function limpiarMarcas(){
      document.querySelectorAll('.arr-src,.over-a,.over-b').forEach(function(x){ x.classList.remove('arr-src','over-a','over-b'); });
    }
    function pieza(e){
      var el = e.target.closest && e.target.closest('[data-anc],[data-ord]');
      if (!el) return null;
      if (el.hasAttribute('data-anc') && el.parentElement && el.parentElement.id === 'railAnc')
        return { el: el, tipo: 'anc', clave: el.getAttribute('data-anc') };
      if (el.hasAttribute('data-ord'))
        return { el: el, tipo: 'ord', clave: el.getAttribute('data-ord'),
                 area: el.getAttribute('data-area'), bloque: el.getAttribute('data-bloque') || '' };
      return null;
    }
    document.addEventListener('dragstart', function(e){
      var p = pieza(e); if (!p) return;
      // Arrastrar un área con su desplegable abierto lo dejaría flotando detrás del cursor.
      if (p.tipo === 'anc' || p.area === '__rail__') window.closeFly();
      arr = p; p.el.classList.add('arr-src');
      document.body.classList.add('arrastrando');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.clave); } catch(_e){}
    });
    document.addEventListener('dragend', function(){ arr = null; document.body.classList.remove('arrastrando'); limpiarMarcas(); });
    // ¿Sobre qué se puede soltar lo que llevo? Solo sobre piezas de SU MISMA familia y su misma área.
    function destino(e){
      if (!arr) return null;
      if (arr.tipo === 'anc') { var p = pieza(e); return (p && p.tipo === 'anc' && p.el !== arr.el) ? { el: p.el } : null; }
      // La línea de ajustes (y su rótulo) son destino: mueven la entrada de bloque.
      var linea = e.target.closest && e.target.closest('[data-drop]');
      if (linea && arr.area !== '__rail__' && linea.getAttribute('data-area') === arr.area)
        return { el: linea, linea: linea.getAttribute('data-drop') };
      var q = pieza(e);
      if (!q || q.tipo !== 'ord' || q.el === arr.el) return null;
      if (q.area !== arr.area) return null;            // ni entre áreas, ni entrada contra área
      return { el: q.el };
    }
    document.addEventListener('dragover', function(e){
      var d = destino(e); if (!d) return;
      e.preventDefault();
      limpiarMarcas();
      if (arr) arr.el.classList.add('arr-src');
      var r = d.el.getBoundingClientRect();
      d.el.classList.add((e.clientY - r.top) < r.height / 2 ? 'over-a' : 'over-b');
    });
    document.addEventListener('drop', function(e){
      var d = destino(e); if (!d) return;
      e.preventDefault();
      var antes = d.el.classList.contains('over-a');
      var mia = arr;
      arr = null; document.body.classList.remove('arrastrando'); limpiarMarcas();
      if (mia.tipo === 'anc') return soltarAncla(mia, d.el, antes);
      soltarOrden(mia, d, antes);
    });
    // Reordenar el bloque de anclados.
    function soltarAncla(mia, elDestino, antes){
      var claves = (window.MENU_ANCLAS||[]).slice();
      var de = claves.indexOf(mia.clave), a = claves.indexOf(elDestino.getAttribute('data-anc'));
      if (de < 0 || a < 0) return;
      claves.splice(de, 1);
      var pos = claves.indexOf(elDestino.getAttribute('data-anc'));
      claves.splice(antes ? pos : pos + 1, 0, mia.clave);
      guardar(claves);
    }
    // Reordenar áreas del rail, o entradas dentro de un área (con su bloque).
    function soltarOrden(mia, d, antes){
      if (mia.area === '__rail__') {
        var ids = [...document.querySelectorAll('#sbNav > .navg[data-ord]')].map(function(x){ return x.getAttribute('data-ord'); });
        var destinoId = d.el.getAttribute('data-ord');
        return menuOrden({ areas: mover(ids, mia.clave, destinoId, antes).map(function(k){ return k.replace(/^area:/, ''); }) });
      }
      var fly = mia.el.closest('.flyout');
      var lista = function(b){ return [...fly.querySelectorAll('.fly-item[data-bloque="' + b + '"]')].map(function(x){ return x.getAttribute('data-ord'); }); };
      var diario = lista('diario'), ajustes = lista('ajustes');
      var quita = function(a){ var i = a.indexOf(mia.clave); if (i >= 0) a.splice(i, 1); };
      quita(diario); quita(ajustes);
      if (d.linea) {
        // Soltada SOBRE la línea: cambia de bloque. Arriba de la línea = final del día a día;
        // sobre el rótulo = principio de los ajustes.
        if (d.linea === 'ajustes') ajustes.unshift(mia.clave); else diario.push(mia.clave);
      } else {
        var destBloque = d.el.getAttribute('data-bloque');
        var arrLista = destBloque === 'ajustes' ? ajustes : diario;
        var pos = arrLista.indexOf(d.el.getAttribute('data-ord'));
        if (pos < 0) pos = arrLista.length;
        arrLista.splice(antes ? pos : pos + 1, 0, mia.clave);
      }
      var entradas = {}; entradas[mia.area] = { diario: diario, ajustes: ajustes };
      menuOrden({ entradas: entradas });
    }
    function mover(lista, clave, destinoClave, antes){
      var out = lista.slice(), de = out.indexOf(clave);
      if (de >= 0) out.splice(de, 1);
      var pos = out.indexOf(destinoClave);
      if (pos < 0) pos = out.length;
      out.splice(antes ? pos : pos + 1, 0, clave);
      return out;
    }
    // Guardar el orden y repintar el rail con lo que devuelve el servidor (un solo renderizador).
    function menuOrden(cambio){
      cambio.activa = window.MENU_ACTIVE || '';
      return api('PUT','/api/erp/menu/orden',cambio)
        .then(pintarRail)
        .catch(function(e){ toast((e&&e.message)||window.ERR.GEN_SHORT,'err'); });
    }
    window.menuRestablecer = async function(){
      if (!await window.confirmarEnPagina({ titulo:'Dejar el menú como venía de fábrica',
        texto:'Se quitan tus anclados y tu orden. Nada más: las pantallas siguen todas donde están.',
        aceptar:'Sí, restablecerlo' })) return;
      api('DELETE','/api/erp/menu/orden',{activa:window.MENU_ACTIVE||''})
        .then(function(r){ pintarRail(r); toast('Menú restablecido'); })
        .catch(function(e){ toast((e&&e.message)||window.ERR.GEN_SHORT,'err'); });
    };
    })();
  </script>
  <style>
${ROOT_TOKENS}

    *{box-sizing:border-box;margin:0;padding:0}
    /* min-height en dvh (viewport dinámico): en móvil, 100vh incluye la zona bajo la barra del
       navegador y deja scroll fantasma; 100dvh = alto realmente visible. En escritorio dvh=vh. */
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,system-ui,sans-serif;background:var(--bg);color:var(--text);display:flex;min-height:100vh;min-height:100dvh;font-size:14px;-webkit-font-smoothing:antialiased}

    /* ── Sidebar CLARO — RAIL de iconos que SE DESPLIEGA al hover mostrando los nombres ──
       (estilo Holded). En reposo: solo iconos (62px). Al pasar el ratón / con un flyout abierto:
       se ensancha y muestra el nombre de cada área, con la actual resaltada. El flyout sigue
       abriendo las sub-funciones a la derecha. */
    .sidebar{width:var(--sw);background:var(--chrome);border-right:1px solid var(--chrome-div);position:fixed;top:0;left:0;height:100vh;overflow-x:hidden;overflow-y:auto;z-index:100;display:flex;flex-direction:column;transition:width .16s ease}
    /* 240 px (antes 216): cada fila del rail desplegado lleva ahora su chincheta, y con 216 el nombre
       del área más largo («Compras y gastos») se quedaba sin sitio y salía cortado. Si se cambia este
       número hay que cambiar TAMBIÉN el left del flyout en openFly() — van pegados. */
    .sidebar:hover,.sidebar.flyopen{width:240px;box-shadow:6px 0 24px rgba(16,24,40,.10)}
    .sidebar::-webkit-scrollbar{width:6px}
    .sidebar::-webkit-scrollbar-thumb{background:rgba(0,0,0,.12);border-radius:6px}
    /* DISA fija arriba — la marca y el Inicio. YA NO lleva contador de avisos: la única señal
       de avisos de todo el chrome es la campana del topbar (una sola cosa que mirar). */
    .disa-pin{position:relative;display:flex;align-items:center;justify-content:center;gap:0;height:50px;flex-shrink:0;color:var(--brand);text-decoration:none;overflow:hidden}
    .sidebar:hover .disa-pin,.sidebar.flyopen .disa-pin{justify-content:flex-start;gap:12px;padding-left:1.05rem}
    .disa-pin i.ti{font-size:22px;line-height:1;flex-shrink:0}
    .disa-pin:hover{color:var(--accent-d)}
    .disa-pin.active i.ti{color:var(--accent)}
    .disa-pin .nav-label{font-weight:600;color:var(--text)}
    .sb-nav{flex:1;padding:.4rem .5rem .6rem;display:flex;flex-direction:column;gap:3px;overflow-x:hidden}
    .rail-spacer{flex:1;min-height:8px}
    .navg{position:relative}
    .nav-item{display:flex;align-items:center;justify-content:center;gap:0;padding:.55rem;border-radius:10px;color:var(--chrome-ic);text-decoration:none;cursor:pointer;background:none;border:none;width:100%;font-family:inherit;transition:background .15s,color .15s}
    .sidebar:hover .nav-item,.sidebar.flyopen .nav-item{justify-content:flex-start;gap:12px;padding-left:.7rem}
    .nav-item:hover{background:var(--bg3);color:var(--accent)}
    .nav-item.active{background:var(--chrome-active);color:var(--accent)}
    .nav-item i.ti{flex-shrink:0;font-size:20px;line-height:1;color:inherit}
    /* Etiqueta del rail: oculta en reposo, visible al desplegar */
    .nav-label{white-space:nowrap;opacity:0;max-width:0;overflow:hidden;font-size:13px;font-weight:500;transition:opacity .12s}
    .sidebar:hover .nav-label,.sidebar.flyopen .nav-label{opacity:1;max-width:150px}
    .nav-item.active .nav-label{font-weight:600}
    .nav-chev{margin-left:auto;font-size:14px!important;opacity:0;transition:opacity .12s}
    .sidebar:hover .nav-chev,.sidebar.flyopen .nav-chev{opacity:.45}
    /* Badge de Propuestas pendientes, pegado al icono de DISA (mismo patrón que el contador
       del topbar que sustituye: círculo rojo pequeño sobre la esquina del icono). */
    .rail-ic{position:relative;display:inline-flex;flex-shrink:0}
    .rail-count{position:absolute;top:-7px;right:-9px;min-width:15px;height:15px;padding:0 3px;border-radius:8px;background:#DC2626;color:#fff;font-size:9px;font-weight:700;line-height:15px;text-align:center;pointer-events:none}
    /* Flyout: submenú flotante del rail (position:fixed → escapa el clip del rail) */
    .flyout{position:fixed;min-width:210px;background:#fff;border:1px solid var(--border2);border-radius:12px;box-shadow:0 10px 30px rgba(16,24,40,.14);padding:7px;display:none;z-index:200}
    .flyout.open{display:block}
    .flyout-h{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);padding:5px 10px 6px}
    .fly-item{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:8px;color:var(--body-tx);text-decoration:none;font-size:13px;white-space:nowrap}
    button.fly-item{width:100%;background:none;border:none;cursor:pointer;font-family:inherit;text-align:left}
    .fly-item:hover{background:var(--bg3)}
    .fly-item.active{background:var(--accent-soft);color:var(--accent);font-weight:500}
    .fly-item.disabled{color:var(--text3);opacity:.65;cursor:default;pointer-events:none}
    .fly-item i.ti{flex-shrink:0;font-size:16px;width:16px;color:var(--text3)}
    .fly-item.active i.ti{color:var(--accent)}
    .nav-pending{margin-left:auto;font-size:9px;font-weight:500;text-transform:uppercase;letter-spacing:.04em;color:var(--text3);border:.5px solid var(--border2);border-radius:7px;padding:1px 5px}
    /* (A) Los DOS bloques del desplegable: día a día arriba (sin rótulo) y ajustes abajo, con una
       línea y su nombre. Son 15 px de aire y una etiqueta: nada se pliega, nada gana un clic. */
    .fly-tx{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
    .fly-sep{height:1px;background:var(--border);margin:6px 8px 2px}
    .fly-grp{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);padding:4px 10px 4px}
    /* (C) El botón de anclar: vive dentro del enlace, asoma al pasar por encima y se queda fijo si ya
       está anclado. En táctil no hay hover, así que ahí se ve siempre (ver la media query de móvil). */
    .fly-pin{flex-shrink:0;margin-left:6px;background:none;border:none;padding:2px;border-radius:6px;cursor:pointer;color:var(--text3);opacity:0;transition:opacity .12s,color .12s;line-height:0}
    .fly-item:hover .fly-pin,.fly-pin:focus-visible{opacity:1}
    .fly-pin.on{opacity:1;color:var(--accent)}
    .fly-pin:hover{background:var(--border);color:var(--accent)}
    .fly-pin i.ti{font-size:14px!important;width:14px!important;color:inherit!important}
    /* La chincheta de un ÁREA va SUELTA dentro del .navg, no dentro de su botón: un <button> dentro de
       otro <button> es HTML inválido. Y solo asoma con el rail desplegado — en 62 px no hay sitio.
       El hueco se lo QUITA AL PADDING de la fila, no al nombre: si se posiciona encima, la chincheta
       tapa la última letra («Compras y gasto📌») y parece que el menú corta las palabras. */
    .nav-pin{position:absolute;right:5px;top:50%;transform:translateY(-50%);margin:0;display:none}
    .sidebar:hover .nav-pin,.sidebar.flyopen .nav-pin,.sidebar.open .nav-pin{display:block}
    .sidebar:hover .navg>.nav-item,.sidebar.flyopen .navg>.nav-item,.sidebar.open .navg>.nav-item,
    .sidebar:hover a.nav-item.anc,.sidebar.flyopen a.nav-item.anc,.sidebar.open a.nav-item.anc{padding-right:30px}
    .navg:hover .nav-pin,a.nav-item.anc:hover .nav-pin{opacity:1}
    /* (C) El bloque de lo anclado, arriba del rail. VACÍO no ocupa nada: quien no ancla nada ve el
       menú de siempre, byte por byte. */
    .rail-anc{display:flex;flex-direction:column;gap:3px}
    .rail-anc:empty{display:none}
    .anc-sep{height:1px;background:var(--chrome-div);margin:5px 6px}
    /* La entrada anclada tiene que ser su propio marco de posición: sin esto, su chincheta (absolute)
       se colgaba del .sidebar —el ancestro posicionado más cercano— y se iba a la esquina de arriba. */
    a.nav-item.anc{position:relative}
    /* (D) MOVER DE ORDEN — la misma señal para las tres cosas que se arrastran: anclas, áreas y
       entradas de submenú. over-a = se suelta ANTES (línea arriba) · over-b = DESPUÉS. */
    .anc,[data-ord]{cursor:grab}
    .arr-src{opacity:.4;cursor:grabbing}
    .over-a{box-shadow:inset 0 2px 0 var(--accent)}
    .over-b{box-shadow:inset 0 -2px 0 var(--accent)}
    .fly-sep.over-a,.fly-sep.over-b,.fly-grp.over-a,.fly-grp.over-b{background:var(--accent-soft);border-radius:6px}
    /* La línea de «Ajustes de …» de un área SIN ajustes no se ve en reposo (sería un rótulo vacío),
       pero aparece mientras se arrastra: es el destino con el que se pasa una entrada al otro bloque. */
    .fly-sep.vacio,.fly-grp.vacio{display:none}
    body.arrastrando .fly-sep.vacio,body.arrastrando .fly-grp.vacio{display:block;opacity:.6}
    body.arrastrando .fly-sep,body.arrastrando .fly-grp{min-height:14px}
    /* Volver al menú de fábrica. Solo se pinta si el usuario ha tocado algo. */
    .rail-reset{color:var(--text3)}
    .rail-reset:hover{color:var(--accent)}

    /* ── Topbar CLARO (dirección UX 2026-07-06): buscador · campana · avatar ── */
    .wrap{margin-left:var(--sw);flex:1;display:flex;flex-direction:column;min-height:100vh;min-height:100dvh}
    .topbar{background:var(--chrome);border-bottom:1px solid var(--chrome-div);padding:.6rem 1.1rem;display:flex;align-items:center;gap:14px;position:sticky;top:0;z-index:50}
    .tb-search{flex:1;max-width:430px;display:flex;align-items:center;gap:8px;background:var(--bg3);border:.5px solid var(--border2);border-radius:9px;padding:7px 12px;color:var(--text3);font-size:13px;cursor:text;position:relative}
    .tb-search i.ti{font-size:16px}
    .tb-search:focus-within{border-color:var(--accent);background:#fff}
    /* (B) El buscador, ya con input de verdad. El <kbd> del atajo se aparta en cuanto se escribe. */
    .tb-search input{flex:1;min-width:0;background:none;border:none;outline:none;font-family:inherit;font-size:13px;color:var(--text)}
    .tb-search input::placeholder{color:var(--text3)}
    .tb-kbd{flex-shrink:0;font-family:inherit;font-size:10px;font-weight:600;color:var(--text3);border:.5px solid var(--border2);border-radius:5px;padding:1px 5px;background:var(--bg2)}
    .tb-search.busca .tb-kbd{display:none}
    .tb-res{display:none;position:absolute;top:calc(100% + 6px);left:0;right:0;background:var(--bg2);border:1px solid var(--border2);border-radius:12px;box-shadow:0 12px 34px rgba(16,24,40,.16);padding:6px;z-index:300;max-height:min(60vh,420px);overflow-y:auto}
    .tb-res.open{display:block}
    .tb-res-i{display:flex;align-items:center;gap:10px;width:100%;padding:7px 10px;border-radius:8px;background:none;border:none;cursor:pointer;font-family:inherit;font-size:13px;color:var(--body-tx);text-align:left;text-decoration:none}
    .tb-res-i:hover,.tb-res-i.sel{background:var(--accent-soft);color:var(--accent)}
    .tb-res-i i.ti{flex-shrink:0;font-size:16px;width:16px;color:var(--text3)}
    .tb-res-i.sel i.ti{color:var(--accent)}
    .tb-res-tx{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .tb-res-ar{flex-shrink:0;font-size:11px;color:var(--text3)}
    .tb-res-i.sel .tb-res-ar{color:var(--accent)}
    .tb-res-none{padding:10px 12px;font-size:12.5px;color:var(--text3)}
    /* LA CONFIGURACIÓN DEL NEGOCIO — las entradas mudadas desde Agenda (18 ago 2026). Lista de filas
       pulsables con nombre y una frase de qué es: en el rail cabía un nombre y aquí cabe la
       explicación, que es medio motivo por el que se mudaron. No es un menú flotante: es contenido de
       la pantalla, así que se pinta ancho y con aire. */
    .cfg-list{display:flex;flex-direction:column;gap:2px}
    .cfg-item{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;color:var(--body-tx);text-decoration:none;border:1px solid transparent}
    .cfg-item:hover{background:var(--accent-soft);border-color:var(--border2)}
    .cfg-item.cfg-on{background:var(--accent-soft);border-color:var(--accent)}
    .cfg-ic{flex-shrink:0;display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;background:var(--bg3);color:var(--text2)}
    .cfg-item:hover .cfg-ic,.cfg-item.cfg-on .cfg-ic{background:var(--accent);color:#fff}
    .cfg-ic i.ti{font-size:17px}
    .cfg-tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
    .cfg-tx strong{font-size:13.5px;font-weight:600}
    .cfg-tx small{font-size:12px;color:var(--text2);line-height:1.35}
    .cfg-chev{flex-shrink:0;color:var(--text3);font-size:16px}
    @media (max-width:600px){ .cfg-tx small{display:none} }
    /* La campana ABRE un panel de notificaciones (antes era un div decorativo con el punto rojo
       siempre encendido y sin destino). Desde el panel se marca cada aviso como visto, o todos. */
    .tb-bell-wrap{position:relative;margin-left:auto;display:flex}
    .tb-bell{color:var(--chrome-tx);font-size:18px;position:relative;display:flex;cursor:pointer;background:none;border:none;padding:0;font-family:inherit}
    .tb-bell:hover{color:var(--accent)}
    /* Punto de la campana: ROJO = algo sin ver · GRIS = pendientes, ya vistos · ausente = nada. */
    .tb-bell .dot{position:absolute;top:-1px;right:-1px;width:7px;height:7px;border-radius:50%;background:#DC2626;border:1.5px solid var(--chrome)}
    .tb-bell .dot.visto{background:var(--text3)}
    .bell-panel{position:absolute;top:calc(100% + 10px);right:0;width:380px;max-width:calc(100vw - 24px);background:#fff;border:1px solid var(--border2);border-radius:12px;box-shadow:0 6px 20px rgba(16,24,40,0.10);display:none;z-index:120;overflow:hidden}
    .bell-panel.open{display:block}
    .bell-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:11px 13px;border-bottom:1px solid var(--border2)}
    .bell-head strong{font-size:13px}
    .bell-all{background:none;border:none;color:var(--accent);font-size:11.5px;cursor:pointer;font-family:inherit;padding:0}
    .bell-all:disabled{color:var(--text3);cursor:default}
    .bell-list{max-height:340px;overflow-y:auto}
    .bell-item{display:flex;align-items:flex-start;gap:9px;padding:10px 13px;border-bottom:1px solid var(--bg3);text-decoration:none;color:inherit}
    .bell-item:last-child{border-bottom:none}
    .bell-item.nuevo{background:var(--danger-s)}
    .bell-item-txt{flex:1;min-width:0}
    .bell-item-t{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .bell-item-d{font-size:11px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .bell-ver{flex-shrink:0;background:none;border:1px solid var(--border2);border-radius:6px;color:var(--text2);font-size:11px;cursor:pointer;padding:3px 7px;font-family:inherit}
    .bell-ver:hover{border-color:var(--accent);color:var(--accent)}
    .bell-foot{display:block;text-align:center;padding:10px;font-size:12px;color:var(--accent);text-decoration:none;border-top:1px solid var(--border2);background:var(--bg2)}
    .bell-foot:hover{background:var(--bg3)}
    .bell-empty{padding:22px 13px;text-align:center;color:var(--text2);font-size:12px;margin:0}
    .topbar-title{font-weight:500;font-size:.85rem;color:var(--text2)}
    .content{flex:1;padding:20px 22px}
    /* Hamburguesa (solo móvil) + fondo del drawer. Ocultos por defecto → sin efecto en escritorio. */
    .nav-toggle{display:none;align-items:center;justify-content:center;background:none;border:none;color:var(--chrome-tx);font-size:22px;line-height:1;cursor:pointer;padding:5px;border-radius:8px;flex-shrink:0;font-family:inherit}
    .nav-toggle:hover{background:var(--bg3);color:var(--accent)}
    .nav-backdrop{display:none;position:fixed;inset:0;background:rgba(16,24,40,.42);z-index:99}
    /* ── Avatar + desplegable (mockup) ── */
    .acct{position:relative;flex-shrink:0}
    .acct-btn{display:flex;align-items:center;background:none;border:none;cursor:pointer;padding:0;border-radius:50%;font-family:inherit}
    .acct-avatar{width:31px;height:31px;border-radius:50%;background:#3A4357;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0}
    .acct-menu{position:absolute;top:calc(100% + 8px);right:0;min-width:212px;background:#fff;border:1px solid var(--border2);border-radius:12px;box-shadow:0 6px 20px rgba(16,24,40,0.10);padding:7px;display:none;z-index:120}
    .acct-menu.open{display:block}
    .acct-mh{display:flex;align-items:center;gap:9px;padding:7px 8px 9px;border-bottom:.5px solid #F0F1F3;margin-bottom:5px}
    .acct-mh .acct-avatar{box-shadow:none}
    .acct-mh-n{font-size:13px;font-weight:500;line-height:1.2;color:var(--text)}
    .acct-mh-e{font-size:11px;color:var(--text3)}
    .acct-item{display:flex;align-items:center;gap:10px;padding:8px;border-radius:8px;color:var(--body-tx);text-decoration:none;font-size:13px;font-weight:400;transition:background .12s}
    .acct-item:hover{background:var(--bg3)}
    .acct-item i.ti,.acct-item svg{flex-shrink:0;font-size:16px;width:16px;height:16px;color:var(--text3)}
    .acct-item.danger{color:var(--danger)}
    .acct-item.danger i.ti,.acct-item.danger svg{color:var(--danger)}
    .acct-item.danger:hover{background:var(--danger-s)}
    .acct-sep{height:.5px;background:#F0F1F3;margin:5px 2px}
    /* ── Visor de documentos (DISEÑO §5): documento a la izquierda + panel a la derecha ── */
    .docwrap{display:flex;gap:20px;align-items:flex-start}
    .docpaper{flex:1;min-width:0;background:#FFFFFF;border:1px solid var(--border2);border-radius:13px;padding:34px 38px;box-shadow:0 1px 3px rgba(16,24,40,.05);color:var(--text);font-size:13px}
    .docpaper h1{font-size:22px;font-weight:500;margin:0 0 4px;color:var(--text)}
    .docpaper .doc-sub{color:var(--text2);font-size:12px;margin-bottom:26px}
    .docpaper .doc-cols{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-bottom:26px}
    .docpaper .doc-label{font-size:11px;text-transform:uppercase;color:var(--text2);font-weight:500;letter-spacing:.04em;margin-bottom:4px}
    .docpaper table{width:100%;border-collapse:collapse;margin-bottom:22px;font-size:13px}
    .docpaper thead th{background:var(--bg3);padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);font-weight:500;border-bottom:1px solid var(--border)}
    .docpaper tbody td{padding:8px 12px;border-bottom:1px solid var(--border);color:var(--text)}
    .docpaper .doc-totals{margin-left:auto;width:300px}
    .docpaper .doc-totals td:first-child{color:var(--text2)}
    .docpaper .doc-totals td:last-child{text-align:right;font-weight:500}
    .docpaper .doc-totals tr.grand td{font-size:15px;border-top:1px solid var(--text);padding-top:10px;color:var(--text)}
    .docpaper .doc-hash{margin-top:26px;padding:12px 14px;background:var(--bg3);border:1px solid var(--border);border-radius:10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:var(--text2);word-break:break-all}
    .docpanel{width:300px;flex-shrink:0;position:sticky;top:80px;display:flex;flex-direction:column;gap:14px}
    .docpanel .card-body{padding:16px}
    .docpanel .dp-row{display:flex;justify-content:space-between;gap:10px;padding:5px 0;font-size:.84rem}
    .docpanel .dp-row .k{color:var(--text2)}
    .docpanel .dp-row .v{color:var(--text);font-weight:500;text-align:right}
    .docpanel .dp-actions{display:flex;flex-direction:column;gap:8px}
    .docpanel .dp-actions .btn{justify-content:center;width:100%}
    @media(max-width:980px){.docwrap{flex-direction:column}.docpanel{width:100%;position:static}}
    @media print{
      .sidebar,.topbar,.docpanel,#disaFab,#disaPanel,.disa-fab{display:none!important}
      .wrap{margin-left:0!important}.content{padding:0!important}
      .docwrap{display:block}
      .docpaper{border:none;box-shadow:none;border-radius:0;padding:0;max-width:820px;margin:auto}
      body{background:#fff!important}
    }

    /* ── Cards ── */
    .card{background:var(--bg2);border:1px solid var(--border2);border-radius:var(--radius-lg)}
    .card-head{padding:.875rem 1.25rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
    .card-head h3{font-size:.88rem;font-weight:500;color:var(--text)}
    .card-body{padding:1.25rem}

    /* ══ LA TARJETA DE CIFRA — EL COMPONENTE ÚNICO (ficha I1) ═══════════════════════════════════
       Hasta el 23 ago 2026 el producto tenía TRES tarjetas de cifra distintas, medidas pantalla a
       pantalla con scripts/inventario-tarjetas.mjs: .bf-card (8, solo en la ficha de cliente),
       .kpi (10, en Stock, Informes, Boletín y Devoluciones) y .cm-num (4, en el Inicio). Eran
       casi iguales y ninguna sabía lo que sabía la otra. Ahora hay UNA, y vive aquí, en el estilo
       global, para que la siguiente pantalla que necesite una cifra no invente la cuarta.

       ANATOMÍA:  .bf-cards  la rejilla    ·  .bf-card  la caja
                  .bf-k  el rótulo         ·  .bf-v  la cifra   ·  .bf-s  la explicación
                  .bf-go la flecha (solo si se puede pulsar)
       MODIFICADORES:  .bf-card.grande  para las cifras de titular del Inicio
                       .bf-v.debe / .gana / .pierde / .na   el color, y solo donde dice algo

       EL COLOR DICE ALGO, no adorna (CANON: jerarquía por peso y espacio). Se reserva para lo que
       exige una decisión —una deuda viva en rojo, un margen en verde—; lo demás se queda en negro.
       Si se colorea todo, no destaca nada. */
    .bf-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:.6rem;margin-bottom:1rem}
    .bf-card{display:flex;flex-direction:column;gap:.15rem;text-align:left;width:100%;min-width:0;
      background:var(--bg2);border:1px solid var(--border2);border-radius:14px;padding:.85rem 1rem;
      font-family:inherit;cursor:pointer;position:relative;box-sizing:border-box;transition:border-color .15s,box-shadow .15s}
    .bf-card:hover,.bf-card:focus-visible{border-color:var(--accent);box-shadow:0 2px 10px rgba(47,107,255,.12);outline:none}
    .bf-card[disabled],.bf-card.inerte{cursor:default}
    .bf-card[disabled]:hover,.bf-card.inerte:hover{border-color:var(--border2);box-shadow:none}
    /* El recorte con puntos suspensivos es de la tarjeta pequeña: en la grande la cifra puede ser
       larga (117.087,43 €) y cortarla sería peor que dejarla saltar de línea. */
    .bf-card>span{display:block;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .bf-k{font-size:.68rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text3);padding-right:1.2rem}
    .bf-k>i.ti{font-size:.85rem;vertical-align:-.08em;margin-right:.25rem}
    .bf-v{font-size:1.12rem;font-weight:700;letter-spacing:-.01em;color:var(--text)}
    .bf-v.na{font-size:1rem;color:var(--text3);font-weight:600}
    .bf-v.debe,.bf-v.pierde{color:var(--danger)}
    .bf-v.gana{color:var(--ok)}
    .bf-s{font-size:.73rem;color:var(--text2)}
    .bf-s strong,.bf-s b{color:var(--text)}
    .bf-go{position:absolute;top:.8rem;right:.8rem;color:var(--text3);font-size:.8rem}
    .bf-card:hover .bf-go{color:var(--accent)}
    /* GRANDE — la cifra de titular del Inicio. Misma caja, misma familia; solo cambia la escala, y
       aquí el texto NO se recorta: estas tarjetas llevan una explicación de dos líneas debajo. */
    .bf-card.grande{padding:13px 15px;gap:3px}
    .bf-card.grande .bf-k{font-size:11.5px;font-weight:500;text-transform:none;letter-spacing:0;color:var(--text2)}
    .bf-card.grande .bf-v{font-size:23px;letter-spacing:-.6px;line-height:1.15}
    .bf-card.grande .bf-s{font-size:11.5px;color:var(--text3);line-height:1.45}
    .bf-card.grande>span{white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere}
    @media(max-width:820px){ .bf-cards{grid-template-columns:repeat(2,minmax(0,1fr))} .bf-card.grande .bf-v{font-size:21px} }
    @media(max-width:400px){ .bf-cards{grid-template-columns:1fr} }
    /* Relleno para las cajas que meten su contenido DIRECTO dentro de .card, sin .card-body. La
       .card global no lleva relleno a propósito (una tabla debe ir a borde, sus celdas ya traen el
       suyo), así que la prosa y los campos que van sueltos necesitan pedirlo. */
    .bf-caja{padding:1.1rem 1.2rem}
    .bf-caja>h3:first-child,.bf-caja>h4:first-child{margin-top:0}
    @media(max-width:520px){ .bf-caja{padding:.9rem} }

    /* ── Grid ── */
    .grid{display:grid;gap:1rem}
    .g2{grid-template-columns:repeat(2,1fr)}
    .g3{grid-template-columns:repeat(3,1fr)}
    .g4{grid-template-columns:repeat(4,1fr)}
    .ga{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}

    /* ── Buttons ── */
    .btn{display:inline-flex;align-items:center;gap:.35rem;padding:.42rem .9rem;border-radius:8px;font-size:.82rem;font-weight:500;cursor:pointer;border:none;text-decoration:none;transition:all .15s;line-height:1.4;font-family:inherit}
    .btn-primary{background:var(--teal);color:#fff}
    .btn-primary:hover{background:var(--teal-d);box-shadow:0 4px 16px var(--teal-glow);transform:translateY(-1px)}
    .btn-secondary{background:#FFFFFF;color:#3F4A5C;border:1px solid var(--border2)}
    .btn-secondary:hover{background:#F1F4F8;color:var(--text)}
    .btn-danger{background:var(--danger-s);color:var(--danger);border:1px solid #F0CFCC}
    .btn-danger:hover{background:#F6DAD7}
    .btn-warning{background:var(--warn-s);color:var(--warn);border:1px solid #EBDDB7}
    .btn-sm{padding:.26rem .6rem;font-size:.76rem}

    /* ── Tables ── */
    .table-wrap{overflow-x:auto}
    table{width:100%;border-collapse:collapse;font-size:.84rem}
    thead th{background:var(--bg3);color:var(--text3);font-size:.7rem;font-weight:500;text-transform:uppercase;letter-spacing:.07em;padding:.6rem 1rem;text-align:left;border-bottom:1px solid var(--border)}
    tbody td{padding:.7rem 1rem;border-bottom:1px solid var(--border);color:var(--text2)}
    tbody tr:hover td{background:#F6F8FB;color:var(--text)}
    tbody tr:last-child td{border-bottom:none}

    /* ── Forms ── */
    .form-group{margin-bottom:.85rem}
    .form-label{display:block;font-size:.79rem;font-weight:500;margin-bottom:.3rem;color:var(--text2)}
    .form-control{width:100%;padding:.5rem .75rem;border:1px solid var(--border2);border-radius:var(--radius);font-size:.85rem;color:var(--text);background:#FFFFFF;font-family:inherit;transition:border-color .15s,box-shadow .15s;outline:none}
    .form-control:focus{border-color:var(--teal);box-shadow:0 0 0 3px var(--teal-soft)}
    .form-control::placeholder{color:var(--text3)}
    textarea.form-control{resize:vertical;min-height:80px}
    .form-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.75rem}
    select.form-control option{background:#FFFFFF;color:#23262C}

    /* ── Badges ── */
    .badge{display:inline-flex;align-items:center;padding:.18rem .55rem;border-radius:99px;font-size:.69rem;font-weight:500}
    .b-green{background:var(--ok-s);color:var(--ok)}
    .b-yellow{background:var(--warn-s);color:var(--warn)}
    .b-red{background:var(--danger-s);color:var(--danger)}
    .b-blue{background:#E4EDFF;color:#2451C7}
    .b-purple{background:#F0EBFB;color:#6D4DC0}
    .b-gray{background:#ECEDF0;color:#565A62}
    .b-teal{background:#ECEEF1;color:#3A4150}

    /* ── Modals ── */
    .modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:200;align-items:center;justify-content:center;padding:1rem;backdrop-filter:blur(4px)}
    .modal-overlay.open{display:flex}
    .modal{background:var(--bg2);border:1px solid var(--border2);border-radius:16px;width:100%;max-width:580px;max-height:90vh;overflow-y:auto;box-shadow:0 30px 80px rgba(0,0,0,.6)}
    .modal-head{padding:1.1rem 1.4rem;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
    .modal-head h3{font-size:.92rem;font-weight:500}
    .modal-body{padding:1.4rem}
    .modal-foot{padding:.9rem 1.4rem;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:.6rem}
    .modal-close{background:none;border:none;cursor:pointer;color:var(--text3);font-size:1.2rem;padding:.2rem;transition:color .15s}
    .modal-close:hover{color:var(--text)}

    /* ── Alerts ── */
    .alert{padding:.75rem 1rem;border-radius:var(--radius);margin-bottom:1rem;font-size:.84rem}
    .alert-warn{background:var(--warn-s);color:var(--warn);border:1px solid #EBDDB7}
    .alert-err{background:var(--danger-s);color:var(--danger);border:1px solid #F0CFCC}
    .alert-ok{background:var(--ok-s);color:var(--ok);border:1px solid #CDE8D8}
    .alert-info{background:var(--info-s);color:var(--info);border:1px solid #BAE6FD}

    /* ── Patrón por pantalla (DISEÑO §6) ─────────────────────────────────────────────
       Banda de DISA: aviso CALMADO con tinte azul claro y UN solo enlace de acción
       (nunca un grupo de botones). Menú "···": recoge las acciones secundarias de fila. */
    .disa-band{display:flex;align-items:center;gap:12px;background:var(--accent-soft);border:1px solid #CFE0FF;border-radius:var(--radius-lg);padding:11px 15px;margin-bottom:1.25rem;font-size:.86rem;color:var(--text)}
    .disa-band .db-ic{color:var(--accent);font-size:18px;flex-shrink:0;display:flex;line-height:1}
    .disa-band .db-tx{flex:1;min-width:0}
    .disa-band .db-cta{color:var(--accent);font-weight:600;text-decoration:none;white-space:nowrap;font-size:.85rem;flex-shrink:0}
    .disa-band .db-cta:hover{text-decoration:underline}
    .rmenu{position:relative;display:inline-block}
    .rmenu-btn{background:none;border:1px solid var(--border2);border-radius:8px;cursor:pointer;color:var(--text2);font-size:1rem;line-height:1;padding:.2rem .5rem;font-family:inherit;transition:background .12s,border-color .12s}
    .rmenu-btn:hover{background:var(--bg3);border-color:var(--text3);color:var(--text)}
    .rmenu-btn-lbl{font-size:.82rem;font-weight:500;padding:.42rem .8rem}
    .rmenu-pop{position:fixed;min-width:172px;background:#fff;border:1px solid var(--border2);border-radius:10px;box-shadow:0 8px 24px rgba(16,24,40,.12);padding:6px;display:none;z-index:300}
    .rmenu-pop.open{display:block}
    .rmenu-item{display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:7px;font-size:.82rem;color:var(--body-tx);text-decoration:none;cursor:pointer;white-space:nowrap;background:none;border:none;width:100%;text-align:left;font-family:inherit}
    .rmenu-item:hover{background:var(--bg3)}
    .rmenu-item.danger{color:var(--danger)}
    .rmenu-item.danger:hover{background:var(--danger-s)}

    /* ── Estado VACÍO (U2) — voz de DISA: icono sutil + frase + acción opcional.
       Reutiliza tokens (--accent-soft/--accent, --ok-s/--ok) y el botón .btn-primary. ── */
    .empty{display:flex;flex-direction:column;align-items:center;text-align:center;gap:.55rem;padding:2.75rem 1.5rem;color:var(--text2)}
    .empty-ic{width:42px;height:42px;border-radius:12px;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center;font-size:21px;line-height:1;flex-shrink:0}
    .empty-ic.ok{background:var(--ok-s);color:var(--ok)}
    .empty-tx{font-size:.9rem;color:var(--text2);max-width:34rem;line-height:1.5}
    .empty .btn{margin-top:.35rem}
    .empty-soft{color:var(--accent);font-weight:500;text-decoration:none;font-size:.85rem;margin-top:.1rem}
    .empty-soft:hover{text-decoration:underline}
    .empty-cell{background:transparent!important}
    tbody tr:hover .empty-cell{background:transparent!important}
    /* ── Skeleton de CARGA (U2) — filas atenuadas con leve pulso (shimmer sobre --bg3) ── */
    .skel{display:block;height:.72rem;width:100%;border-radius:6px;background:var(--bg3);position:relative;overflow:hidden}
    .skel::after{content:"";position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,rgba(255,255,255,.6),transparent);animation:skel 1.3s ease-in-out infinite}
    .skel-block{height:62px;border-radius:9px}
    .skel-row td{padding:.7rem 1rem}
    .skel-row:hover td{background:transparent!important}
    @keyframes skel{100%{transform:translateX(100%)}}
    @media(prefers-reduced-motion:reduce){.skel::after{animation:none}}

    /* ── Misc ── */
    .ph{display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem}
    .ph h2{font-size:1.05rem;font-weight:500}
    .search{padding:.45rem .75rem;border:1px solid var(--border2);border-radius:var(--radius);font-size:.84rem;background:#FFFFFF;color:var(--text);font-family:inherit;outline:none;min-width:200px;transition:border-color .15s}
    .search:focus{border-color:var(--teal)}
    .search::placeholder{color:var(--text3)}
    img.thumb{width:38px;height:38px;object-fit:cover;border-radius:6px;border:1px solid var(--border)}
    /* Pestañas tipo FICHA/CARPETA (DISEÑO): la activa es una tarjeta blanca elevada que se
       une al panel de debajo; las inactivas quedan detrás sobre la línea base. */
    .tabs{display:flex;align-items:flex-end;gap:5px;border-bottom:1px solid var(--border2);margin-bottom:1.25rem;overflow-x:auto}
    .tab{padding:.5rem .95rem;cursor:pointer;font-size:.83rem;font-weight:500;color:var(--text2);background:var(--bg);border:1px solid var(--border2);border-bottom-color:transparent;border-radius:9px 9px 0 0;margin-bottom:-1px;white-space:nowrap;text-decoration:none;transition:all .15s}
    .tab:hover{color:var(--text);background:var(--bg3)}
    .tab.active{color:var(--accent);font-weight:600;background:var(--bg2);border-color:var(--border2);border-bottom-color:var(--bg2)}
    .tab-pane{display:none}.tab-pane.active{display:block}
    .stars{color:#F59E0B}
    @media(max-width:768px){
      /* El buscador del topbar se mantiene en UNA línea (si no, el texto se parte en dos y engorda
         la barra, descuadrando cualquier alto calculado). */
      .tb-search{min-width:0}
      /* El atajo de teclado no pinta nada en un móvil, y en 390 px se come el sitio del texto. */
      .tb-kbd{display:none}
      /* En táctil no hay hover: el botón de anclar tiene que verse siempre o no existe. */
      .fly-pin{opacity:.55}
      /* En el cajón el submenú es INLINE, así que el .navg CRECE con el acordeón abierto y un
         top:50% mandaría la chincheta del área al centro del grupo entero, flotando entre sus
         entradas. Aquí se ata a la fila del área. (En escritorio no pasa: el flyout es fixed y
         no cuenta para el alto del .navg.) */
      .sidebar.open .nav-pin{top:10px;transform:none}
      /* Pantallas a pantalla completa (el chat de DISA): el contenido RELLENA el hueco bajo el
         topbar con flexbox, sin restar una altura fija de topbar → el compositor queda siempre a la
         vista, sin scroll, sea cual sea el alto real del topbar o del navegador móvil. */
      .content-flush{padding:0;display:flex;flex-direction:column;overflow:hidden;min-height:0}
      /* ── Navegación: el rail pasa a DRAWER off-canvas que abre la hamburguesa ── */
      .nav-toggle{display:inline-flex}
      /* 280 px (antes 250): el bloque de ajustes va indentado y ahora cada entrada lleva su chincheta,
         así que con 250 se cortaban nombres como "Servicios reservables". Siguen quedando 110 px de
         fondo que tocar para cerrar el cajón. */
      .sidebar{transform:translateX(-100%);width:280px;transition:transform .2s ease;overflow-y:auto}
      /* La regla .sidebar.flyopen (216 px) es del rail de ESCRITORIO y le ganaba por especificidad al cajón:
         abrir un acordeón en el móvil ENCOGÍA el cajón y partía los nombres. Aquí manda el cajón. */
      .sidebar.open,.sidebar.open.flyopen{transform:translateX(0);width:280px;box-shadow:8px 0 30px rgba(16,24,40,.22)}
      /* Con el drawer abierto se muestran los nombres (en táctil no hay hover que los despliegue) */
      .sidebar.open .nav-label{opacity:1;max-width:200px}
      .sidebar.open .nav-item,.sidebar.open .disa-pin{justify-content:flex-start;gap:12px}
      .sidebar.open .nav-item{padding-left:.7rem}
      .sidebar.open .disa-pin{padding-left:1.05rem}
      .sidebar.open .nav-chev{opacity:.45}
      /* Submenús: en acordeón INLINE dentro del drawer (no popovers flotantes que se saldrían) */
      .sidebar.open .flyout{position:static;min-width:0;width:auto;box-shadow:none;border:none;background:transparent;padding:2px 0 6px 24px;z-index:auto;top:auto!important;left:auto!important}
      .sidebar.open .flyout-h{display:none}
      body.nav-open .nav-backdrop{display:block}
      .wrap{margin-left:0;min-width:0}
      .content{min-width:0}
      .acct-meta{display:none}
      #disaFab{bottom:16px;right:16px}
      #disaPanel{width:calc(100vw - 24px);right:12px;bottom:80px}
      .g4{grid-template-columns:repeat(2,1fr)}
      .g3{grid-template-columns:repeat(2,1fr)}
      .g2{grid-template-columns:1fr}
      /* ── Tablas anchas: que scrollee la TABLA sola, no la página (patrón único para todas) ── */
      .content table{display:block;width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}
      /* ── Formularios en rejilla inline (recurrentes, bienes…) → 1 columna en móvil ── */
      form [style*="grid-template-columns"]{grid-template-columns:1fr!important}
      /* ── Modales → hoja inferior a lo ancho, alcanzable con el pulgar, con scroll propio ── */
      .modal-overlay{padding:0;align-items:flex-end}
      .modal{max-width:100%;width:100%;max-height:92vh;border-radius:16px 16px 0 0}
    }
  </style>
</head>
<body>
  <aside class="sidebar">
    <a href="${fijaPin.href}" class="disa-pin${active === fijaPin.key ? ' active' : ''}" title="${escHtml(fijaPin.label)}">
      <i class="ti ${fijaPin.icon}"></i>
      <span class="nav-label">${escHtml(fijaPin.label)}</span>
    </a>
    <nav class="sb-nav" id="sbNav">${railInner}</nav>
  </aside>
  <div class="nav-backdrop" data-act="nav-close" aria-hidden="true"></div>
  <div class="wrap">
    <div class="topbar">
      <button type="button" class="nav-toggle" aria-label="Abrir menú" aria-expanded="false" data-act="nav-toggle"><i class="ti ti-menu-2"></i></button>
      <!-- (B) BUSCADOR QUE NAVEGA. Hasta hoy esto era DECORADO: un div con un <span> de texto fijo, sin
           input, sin JS y sin destino, cuyo reclamo («Buscar cliente, factura, producto…») prometía
           buscar DATOS. Ahora es un buscador de verdad, pero del MENÚ —áreas y entradas—, así que el
           reclamo dice lo que hace. La búsqueda de datos queda ANOTADA y sin construir: sería otra
           tarea, y tocaría endpoints y consultas que este encargo declara intocables. -->
      <div class="tb-search" id="tbSearch">
        <i class="ti ti-search"></i>
        <input type="text" id="tbq" placeholder="Buscar en el menú…" autocomplete="off" spellcheck="false"
               role="combobox" aria-expanded="false" aria-controls="tbres" aria-autocomplete="list"
               aria-label="Buscar en el menú">
        <kbd class="tb-kbd" id="tbkbd" aria-hidden="true">Ctrl K</kbd>
        <div class="tb-res" id="tbres" role="listbox" aria-label="Resultados del menú"></div>
      </div>
      <div class="tb-bell-wrap">
        <button type="button" class="tb-bell" id="tbBell" title="${bellTitle}" aria-label="${bellTitle}"
                aria-haspopup="true" aria-expanded="false" data-act="bell">
          <i class="ti ti-bell"></i>${avisos.estado === 'apagado' ? '' : `<span class="dot${avisos.estado === 'visto' ? ' visto' : ''}"></span>`}
        </button>
        <div class="bell-panel" id="bellPanel">
          <div class="bell-head">
            <strong>Avisos</strong>
            <button type="button" class="bell-all" id="bellAll" data-act="bell-all">Marcar todos como vistos</button>
          </div>
          <div class="bell-list" id="bellList"><p class="bell-empty">Cargando…</p></div>
          <a class="bell-foot" href="/admin/avisos">Ver y resolver todos</a>
        </div>
      </div>
      <div class="acct">
        <button class="acct-btn" id="acctBtn" type="button" aria-haspopup="true" aria-expanded="false" data-act="acct" title="${escName}">
          ${avatarHTML}
        </button>
        <div class="acct-menu" id="acctMenu">${acctMenuHTML}</div>
      </div>
    </div>
    <main class="content${active === 'disa' ? ' content-flush' : ''}">${roBanner}${content}</main>
  </div>
  <script nonce="${c?.get?.('cspNonce') || ''}">
    // ── 4 SEP 2026 (csp-erp-migrar-handlers) — UN SOLO OYENTE PARA TODO EL ARMAZON ────────────────
    // Antes cada control del armazon llevaba su codigo escrito en el propio atributo. Eso son ~60
    // handlers en CADA UNA de las 363 pantallas del panel, puestos desde 21 sitios de este fichero,
    // y un nonce NO los cubre: al endurecer la cabecera se quedarian MUDOS sin avisar. No fallan al
    // cargar, fallan al pulsar.
    //
    // Ahora cada control dice QUE hace con data-act y aqui se despacha. Un oyente en lugar de
    // sesenta, y los controles que se pintan despues (una fila nueva, un menu recargado) funcionan
    // solos: la delegacion no necesita volver a enganchar nada.
    //
    // Sin acentos graves en este comentario A PROPOSITO: vive dentro de una plantilla de texto y uno
    // solo la cerraria en seco. Esta escrito en CLAUDE.md y ya ha mordido dos veces.
    document.addEventListener('click',function(e){
      var el=e.target.closest('[data-act]'); if(!el) return;
      switch(el.getAttribute('data-act')){
        case 'nav-toggle':     window.toggleNav&&window.toggleNav(); break;
        case 'nav-close':      window.closeNav&&window.closeNav(); break;
        case 'bell':           window.toggleBell&&window.toggleBell(e); break;
        case 'bell-all':       window.bellMarcarTodos&&window.bellMarcarTodos(e); break;
        case 'acct':           window.toggleAcct&&window.toggleAcct(e); break;
        case 'disa-abrir':     { if(window.closeFly)window.closeFly();
                                 if(window.disaOpen){window.disaOpen();} else {location.href='/admin/disa';} break; }
        case 'navfly':         { var g=el.closest('[data-navg]'); if(g&&window.toggleFly)window.toggleFly(g); break; }
        case 'rowmenu':        window.toggleRowMenu&&window.toggleRowMenu(el); break;
        case 'menu-reset':     window.menuRestablecer&&window.menuRestablecer(); break;
        // 5 SEP 2026 — el boton de Imprimir de los seis papeles. Estaba escrito en el atributo de
        // cinco botones identicos, uno por tipo de documento; ahora lo despacha este mismo oyente.
        case 'imprimir':       window.print(); break;
        case 'cerrar-acceso':  { var m=document.getElementById('accessDeniedModal'); if(m)m.style.display='none'; break; }
      }
    });

    // Los desplegables del menu lateral. El evento mouseenter NO burbujea, asi que aqui no vale delegar:
    // se enganchan a los grupos, que se pintan en el servidor y ya estan cuando esto corre.
    (function(){
      function enganchar(){
        document.querySelectorAll('[data-navg]').forEach(function(g){
          if(g.__fly) return; g.__fly=1;
          g.addEventListener('mouseenter',function(){ window.openFly&&window.openFly(g); });
          g.addEventListener('mouseleave',function(){ window.scheduleCloseFly&&window.scheduleCloseFly(); });
          var f=g.querySelector('.flyout');
          if(f){ f.addEventListener('mouseenter',function(){ window.cancelCloseFly&&window.cancelCloseFly(); });
                 f.addEventListener('mouseleave',function(){ window.scheduleCloseFly&&window.scheduleCloseFly(); }); }
        });
      }
      if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',enganchar); else enganchar();
      // El menu se puede repintar (al anclar o restablecer): se vuelve a enganchar lo nuevo.
      window.engancharMenuLateral=enganchar;
    })();

    document.addEventListener('click',e=>{if(e.target.classList.contains('modal-overlay'))e.target.classList.remove('open')});
    // ── Menú lateral en móvil: drawer que abre la hamburguesa del topbar (en escritorio, sin efecto) ──
    window.toggleNav=function(){var sb=document.querySelector('.sidebar');if(!sb)return;var open=sb.classList.toggle('open');document.body.classList.toggle('nav-open',open);var b=document.querySelector('.nav-toggle');if(b)b.setAttribute('aria-expanded',open?'true':'false');};
    window.closeNav=function(){var sb=document.querySelector('.sidebar');if(sb)sb.classList.remove('open');document.body.classList.remove('nav-open');var b=document.querySelector('.nav-toggle');if(b)b.setAttribute('aria-expanded','false');};
    document.addEventListener('keydown',function(e){if(e.key==='Escape')window.closeNav();});
    document.addEventListener('click',function(e){var a=e.target.closest('.sidebar a[href]');if(a)window.closeNav();});
    // ── Campana de notificaciones ────────────────────────────────────────────────
    // El panel lee del MISMO motor que la pantalla (/api/erp/avisos): mismos avisos, mismo
    // número. Cada aviso se marca visto por separado; también hay "marcar todos". Nada se
    // marca solo por abrir el panel: "visto" lo decide el usuario.
    // DOS funciones, y separarlas NO es cosmética: mezclarlas causó un bucle infinito.
    //
    //   bellDot(sinVer,total) — pinta el punto y el título. SIN EFECTOS: no invalida nada,
    //                           no pide nada. La usa quien ya tiene los números en la mano.
    //   bellSync(sinVer,total) — bellDot + invalida el caché del panel + si el panel está
    //                           abierto, lo repinta pidiendo la lista. Es la vía para tocar la
    //                           campana DESDE FUERA (otra pantalla ya cambió los avisos).
    //
    // Antes solo existía bellSync, y bellPinta (que repinta la lista) la llamaba al terminar.
    // Con el panel abierto eso era: bellCargar → bellPinta → bellSync → bellCargar → … Cada vuelta
    // era una petición de red, así que abrir la campana disparaba ~120 peticiones en 6 segundos
    // hasta que el freno del endpoint devolvía 429 y el panel decía «No pude cargar tus avisos».
    // El freno hizo su trabajo: cortó una recursión, no un abuso. La causa estaba aquí.
    // Regla: quien acaba de pintar la lista NO vuelve a pedirla. bellPinta usa bellDot.
    function bellDot(sinVer,total){
      var b=document.getElementById('tbBell'); if(!b) return;
      var dot=b.querySelector('.dot');
      if(!total){ if(dot) dot.remove(); }
      else {
        if(!dot){ dot=document.createElement('span'); dot.className='dot'; b.appendChild(dot); }
        dot.classList.toggle('visto', !sinVer);            // rojo = queda algo sin ver
      }
      b.title = !total ? 'Avisos — no tienes nada pendiente'
        : (sinVer ? (sinVer+' aviso'+(sinVer===1?'':'s')+' sin ver')
                  : (total+' aviso'+(total===1?'':'s')+' pendientes (ya vistos)'));
    }
    window.bellSync=function(sinVer,total){
      bellDot(sinVer,total);
      _bellCargado=false;                                   // lo cacheado ya no vale
      var p=document.getElementById('bellPanel');
      if(p&&p.classList.contains('open')) bellCargar();     // abierto → repinta ahora
    };
    var _bellCargado=false;
    // D5 — el panel de Propuestas llama a esto tras cada acción para que el badge (ahora sobre el
    // icono de DISA del riel) cuadre sin recargar. Solo actualiza el número visible; no reescanea cobros.
    window.propBadgeSync=function(n){
      var el=document.getElementById('propCount'); if(!el) return;
      if(n>0){ el.textContent=String(n); el.style.display=''; }
      else { el.textContent=''; el.style.display='none'; }
      var b=document.getElementById('disaRailBtn');
      if(b) b.title='DISA'+(n>0?(' — '+n+' propuesta'+(n===1?'':'s')+' pendiente'+(n===1?'':'s')):'');
    };
    function bellPinta(d){
      var list=document.getElementById('bellList');
      var all=document.getElementById('bellAll');
      var av=d.avisos||[];
      if(!av.length){ list.innerHTML='<p class="bell-empty">No tienes nada pendiente. Todo al día.</p>'; }
      else {
        // Sin ver primero: es lo que enciende el punto rojo.
        var orden=av.slice().sort(function(a,b){return (b.nuevo?1:0)-(a.nuevo?1:0);}).slice(0,8);
        // La clave va en data-key (nunca incrustada en un onclick): la lee el listener delegado.
        list.innerHTML=orden.map(function(a){
          return '<div class="bell-item'+(a.nuevo?' nuevo':'')+'">'
            +'<div class="bell-item-txt"><div class="bell-item-t">'+escHtml(a.titulo)+'</div>'
            +'<div class="bell-item-d">'+escHtml(a.detalle)+'</div></div>'
            +'<button type="button" class="bell-ver" data-key="'+escHtml(a.key)+'" data-visto="'+(a.nuevo?'1':'0')+'"'
            +' title="'+(a.nuevo?'Marcar este aviso como visto':'Volver a marcarlo como no visto')+'">'
            +(a.nuevo?'Visto':'✓ Visto')+'</button>'
            +'</div>';
        }).join('') + (av.length>8 ? '<p class="bell-empty">y '+(av.length-8)+' más</p>' : '');
      }
      if(all) all.disabled = !d.sinVer;
      bellDot(d.sinVer, d.count);   // NO bellSync: la lista ya está pintada; pedirla otra vez = bucle
    }
    // Cerrojo de reentrada: dos cargas solapadas del panel no sirven de nada y, si algún día
    // alguien vuelve a encadenar bellPinta → bellSync, esto evita que se convierta en una avalancha.
    var _bellCargando=false;
    async function bellCargar(){
      if(_bellCargando) return;
      _bellCargando=true;
      try{ bellPinta(await api('GET','/api/erp/avisos')); _bellCargado=true; }
      catch(e){ document.getElementById('bellList').innerHTML='<p class="bell-empty">No pude cargar tus avisos.</p>'; }
      finally{ _bellCargando=false; }
    }
    // Delegación: un solo listener para todos los botones "Visto" del panel.
    document.addEventListener('click',async function(e){
      var btn=e.target.closest('#bellList .bell-ver'); if(!btn) return;
      e.stopPropagation(); e.preventDefault();
      var visto = btn.dataset.visto === '1';
      try{ bellPinta(await api('POST','/api/erp/avisos/'+(visto?'visto':'no-visto'),{keys:[btn.dataset.key]}));
           if(typeof window.avisosOnVisto==='function') window.avisosOnVisto();
           bellAvisarPestanas();      // "visto" es de esta persona: sus otras pestañas se enteran
      }catch(err){ toast(err.message||'Error','err'); }
    });
    window.bellMarcarTodos=async function(e){
      e.stopPropagation();
      try{ bellPinta(await api('POST','/api/erp/avisos/visto',{}));   // sin keys = todos
           toast('Avisos marcados como vistos');
           if(typeof window.avisosOnVisto==='function') window.avisosOnVisto();
           bellAvisarPestanas();
      }catch(err){ toast(err.message||'Error','err'); }
    };
    // ── CONTADOR EN VIVO (en TODAS las pantallas del panel) ─────────────────────────────
    // Antes, el punto y el número salían del render del servidor y se quedaban congelados: fuera
    // de /admin/avisos solo cambiaban al recargar la página o al abrir el panel. Ahora se
    // refrescan solos por tres vías, y ninguna se salta el blindaje del 9 de julio: el conteo
    // sigue viniendo del servidor, por usuario, por aviso y por permiso. El cliente NO recalcula
    // nada — solo pregunta y pinta.
    //
    //   1) Sondeo ligero cada minuto, y solo con la pestaña visible.
    //   2) Al volver a la pestaña (visibilitychange): lo primero que ves ya está al día.
    //   3) Tras CUALQUIER mutación, venga de la pantalla que venga (enganche en api()).
    //
    // Pide /api/erp/avisos/contador, que devuelve tres números y ni un dato de negocio.
    var BELL_MS = 60000;   // 1 sondeo/min por pestaña. El freno del endpoint es 120/min por
                           // negocio+IP: una oficina entera cabe sin acercarse al techo.
    window.bellRefrescar = async function(){
      if(document.hidden) return;                 // en segundo plano no se gasta el escaneo
      try{
        var p=document.getElementById('bellPanel');
        if(p&&p.classList.contains('open')){ await bellCargar(); return; }   // abierto → lista entera
        var d=await api('GET','/api/erp/avisos/contador');
        window.bellSync(d.sinVer||0, d.count||0);
      }catch(_e){ /* fallo de red: no se rompe la pantalla, el siguiente sondeo lo arregla */ }
    };

    // Otras PESTAÑAS del mismo negocio. El canal es por ORIGEN, y cada negocio es un subdominio
    // propio, así que un negocio jamás recibe la señal de otro: el aislamiento sale gratis. Si el
    // navegador no trae BroadcastChannel, no pasa nada — el sondeo del minuto llega igual.
    var _bellChan=null;
    try{ _bellChan=('BroadcastChannel' in window)?new BroadcastChannel('bamburu-avisos'):null; }catch(_e){}
    if(_bellChan) _bellChan.onmessage=function(){ window.bellRefrescar(); };
    function bellAvisarPestanas(){ if(_bellChan){ try{ _bellChan.postMessage(1); }catch(_e){} } }
    window.bellAvisarPestanas=bellAvisarPestanas;   // la pantalla de avisos también la usa

    // Lo llama api() tras cada mutación. Debounce: guardar tres cosas seguidas es UN recálculo.
    var _bellDebounce=null;
    window.bellTrasCambio=function(){
      bellAvisarPestanas();
      // La pantalla de avisos ya se recalcula entera tras cada acción (loadAvisos → bellSync).
      // Pedirle además el contador sería un segundo escaneo caro por cada cobro registrado.
      if(typeof window.avisosOnVisto==='function') return;
      clearTimeout(_bellDebounce);
      _bellDebounce=setTimeout(function(){ window.bellRefrescar(); }, 700);
    };

    setInterval(function(){ window.bellRefrescar(); }, BELL_MS);
    document.addEventListener('visibilitychange',function(){ if(!document.hidden) window.bellRefrescar(); });

    function toggleBell(e){
      e.stopPropagation();
      var p=document.getElementById('bellPanel'),b=document.getElementById('tbBell');
      var open=p.classList.toggle('open');
      b.setAttribute('aria-expanded',open?'true':'false');
      if(open&&!_bellCargado) bellCargar();
    }
    function closeBell(){
      var p=document.getElementById('bellPanel'),b=document.getElementById('tbBell');
      if(p&&p.classList.contains('open')){p.classList.remove('open');if(b)b.setAttribute('aria-expanded','false');}
    }
    document.addEventListener('click',function(e){if(!e.target.closest('.tb-bell-wrap'))closeBell();});
    document.addEventListener('keydown',function(e){if(e.key==='Escape')closeBell();});

    function toggleAcct(e){e.stopPropagation();var m=document.getElementById('acctMenu'),b=document.getElementById('acctBtn');var open=m.classList.toggle('open');b.setAttribute('aria-expanded',open?'true':'false');}
    document.addEventListener('click',function(e){var m=document.getElementById('acctMenu');if(m&&m.classList.contains('open')&&!e.target.closest('.acct')){m.classList.remove('open');var b=document.getElementById('acctBtn');if(b)b.setAttribute('aria-expanded','false');}});
    document.addEventListener('keydown',function(e){if(e.key==='Escape'){var m=document.getElementById('acctMenu');if(m&&m.classList.contains('open')){m.classList.remove('open');var b=document.getElementById('acctBtn');if(b)b.setAttribute('aria-expanded','false');}}});
  </script>
  

${hideDisaSidebar ? '' : getDisaWidget(c?.get?.('cspNonce') || '')}
  <div id="accessDeniedModal" style="display:none;position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.6);z-index:99999;align-items:center;justify-content:center">
    <div style="background:#FFFFFF;border:1px solid #EDEFF2;border-radius:13px;padding:32px;text-align:center;max-width:380px;box-shadow:0 30px 80px rgba(16,24,40,.18)">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#A6453F" stroke-width="2" style="margin-bottom:16px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <h3 style="color:#23262C;margin:0 0 8px">Acceso no permitido</h3>
      <p style="color:#828B9B;font-size:13px;margin:0 0 20px">${ERR.PERM}</p>
      <button data-act="cerrar-acceso" style="background:#3A4150;border:none;color:#fff;padding:8px 24px;border-radius:9px;cursor:pointer;font-weight:500">Entendido</button>
    </div>
  </div>
</body>
</html>`;
}

// Visor de documentos compartido (DISEÑO §5): documento a la izquierda + panel de datos/
// acciones a la derecha. Se pasa como `content` a adminLayout(). `paper` = el documento
// (solo lectura); `panel` = tarjetas con estado, datos clave y acciones. La impresión/PDF
// (window.print) muestra solo `.docpaper` vía @media print del layout.
export function docShell(paper, panel) {
  return `<div class="docwrap"><div class="docpaper">${paper}</div><aside class="docpanel">${panel || ''}</aside></div>`;
}

// printableShell(bodyHtml, { title }) — HTML STANDALONE del documento imprimible, para:
//   · generar el PDF (core/pdf.js renderPdfFromHtml) y
//   · enviarlo como cuerpo/base de email,
// con la MISMA maquetación que la pantalla. Reutiliza el cuerpo del documento TAL CUAL (el
// `paper` que ya construye cada vista); aquí solo se le da el envoltorio: fuente del sistema,
// las variables de color y los estilos .docpaper/.doc-* + badge/alert que la factura usa por
// clase (presupuesto/pedido/albarán usan estilos en línea y no dependen de esto, pero quedan
// dentro del mismo lienzo .docpaper). @page A4 para que el PDF cuadre el tamaño.
export function printableShell(bodyHtml, { title = 'Documento' } = {}) {
  return `<!DOCTYPE html><html lang="es"><head>
<meta charset="UTF-8">
<title>${escHtml(title)}</title>
<style>
  /* Tipografía DEL SISTEMA (DISEÑO §2.6): sin fuentes cargadas de internet. */
  :root{
    --bg:#F5F6F8;--bg2:#FFFFFF;--bg3:#F1F3F5;--border:#EEEFF2;--border2:#E4E6EA;
    --text:#14161B;--text2:#5C616B;--text3:#8A8F99;--teal:#2F6BFF;--radius:9px;
    --danger:#C0392B;--danger-s:#FBE3E3;--warn:#8A5B00;--warn-s:#FBEED0;--ok:#157F3B;--ok-s:#E4F6EA;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  @page{size:A4;margin:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,system-ui,sans-serif;background:#fff;color:var(--text);font-size:13px;-webkit-font-smoothing:antialiased}
  .docpaper{max-width:820px;margin:auto;padding:6mm 4mm;color:var(--text);font-size:13px}
  .docpaper h1{font-size:22px;font-weight:500;margin:0 0 4px;color:var(--text)}
  .docpaper .doc-sub{color:var(--text2);font-size:12px;margin-bottom:26px}
  .docpaper .doc-cols{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-bottom:26px}
  .docpaper .doc-label{font-size:11px;text-transform:uppercase;color:var(--text2);font-weight:500;letter-spacing:.04em;margin-bottom:4px}
  .docpaper table{width:100%;border-collapse:collapse;margin-bottom:22px;font-size:13px}
  .docpaper thead th{background:var(--bg3);padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);font-weight:500;border-bottom:1px solid var(--border)}
  .docpaper tbody td{padding:8px 12px;border-bottom:1px solid var(--border);color:var(--text)}
  .docpaper .doc-totals{margin-left:auto;width:300px}
  .docpaper .doc-totals td:first-child{color:var(--text2)}
  .docpaper .doc-totals td:last-child{text-align:right;font-weight:500}
  .docpaper .doc-totals tr.grand td{font-size:15px;border-top:1px solid var(--text);padding-top:10px;color:var(--text)}
  .docpaper .doc-hash{margin-top:26px;padding:12px 14px;background:var(--bg3);border:1px solid var(--border);border-radius:10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:var(--text2);word-break:break-all}
  .badge{display:inline-flex;align-items:center;padding:.18rem .55rem;border-radius:99px;font-size:.69rem;font-weight:500}
  .b-green{background:var(--ok-s);color:var(--ok)}.b-yellow{background:var(--warn-s);color:var(--warn)}
  .b-red{background:var(--danger-s);color:var(--danger)}.b-gray{background:#EFF1F4;color:#3F4A5C}.b-teal{background:#ECEEF1;color:#3A4150}
  .alert{padding:.75rem 1rem;border-radius:var(--radius);margin-bottom:1rem;font-size:.84rem}
  .alert-warn{background:var(--warn-s);color:var(--warn);border:1px solid #EBDDB7}
  .alert-err{background:var(--danger-s);color:var(--danger);border:1px solid #F0CFCC}
  .alert-ok{background:var(--ok-s);color:var(--ok);border:1px solid #CDE8D8}
</style></head>
<body><div class="docpaper">${bodyHtml}</div></body></html>`;
}
