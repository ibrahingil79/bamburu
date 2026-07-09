import { getDisaWidget } from '../disa/widget.js';
import { estadoAvisos, hoyLocal, PERM_POR_FUENTE } from './avisos.js';

export const ROOT_TOKENS = `
    :root{
      /* Tokens EXACTOS de la dirección UX del 2026-07-06 (DISEÑO.md §0-bis + §2).
         FUENTE ÚNICA de color/tipo/espaciado de la app. Cambiar aquí = toda la app.
         SUSTITUCIÓN 1 (chrome claro) y SUSTITUCIÓN 2 (acento azul) aplicadas aquí. */
      --bg:        #F5F6F8;   /* fondo de aplicación (claro) */
      --bg2:       #FFFFFF;   /* superficies / tarjetas / chrome / paneles */
      --bg3:       #F1F3F5;   /* subsuperficie: search, hover, sutil */
      --card:      #FFFFFF;   /* alias de superficie de panel (= --bg2). Lo usan los paneles de
                                 sugerencias del buscador de línea (var(--card,#1e1e1e)); sin definir
                                 caían en el fallback oscuro #1e1e1e → nombre ilegible. */
      --border:    #EEEFF2;   /* separadores (DISEÑO §2.4) */
      --border2:   #E4E6EA;   /* bordes (DISEÑO §2.4) */
      --border-disa: #D6DCE4; /* borde de la tarjeta de DISA (DISEÑO §2.2) */
      --text:      #14161B;   /* texto principal (DISEÑO §2.3) */
      --text2:     #5C616B;   /* texto secundario (DISEÑO §2.3) */
      --text3:     #8A8F99;   /* texto tenue (DISEÑO §2.3) */
      --body-tx:   #3A3F48;   /* texto cuerpo (entre principal y secundario) */
      --accent:    #2F6BFF;   /* AZUL — acción principal y enlaces (DISEÑO §2.2, SUSTITUCIÓN 2) */
      --accent-d:  #2456D6;   /* azul fuerte / hover / activo */
      --accent-soft:#E4EDFF;  /* fondo azul claro: item activo / avisos de DISA / chips */
      /* Acento morado SEMÁNTICO (IRPF/retención + stock reservado). No es acento de marca: es el
         tercer acento de dato que ya usaban documentos e inventario (U1, 2026-07-05). */
      --accent-purple: #9333EA;  --accent-purple-s: #F0EBFB;
      --grp:       #8A8F99;   /* título de grupo de menú (= texto tenue) */
      --muted:     #5C616B;   /* alias heredado (= secundario) */
      --p:         #2F6BFF;   /* alias heredado (= acento azul) */
      /* Alias de compatibilidad: el código heredado usa var(--teal*) → ahora ES el azul de marca */
      --teal:      #2F6BFF;
      --teal-d:    #2456D6;
      --teal-soft: rgba(47,107,255,0.10);
      --teal-glow: rgba(47,107,255,0.20);
      /* Estados — chips (DISEÑO §2.5). fondo (-s) / texto */
      --danger:    #C0392B;  --danger-s:  #FBE3E3;   /* Vencida */
      --warn:      #8A5B00;  --warn-s:    #FBEED0;   /* Pendiente */
      --ok:        #157F3B;  --ok-s:      #E4F6EA;   /* Pagada */
      --info:      #2451C7;  --info-s:    #E4EDFF;   /* Enviada (azul) */
      /* Chrome CLARO (barra superior + menú lateral). Dirección UX 2026-07-06 (SUSTITUCIÓN 1):
         sidebar y superficies claras; el azul es el acento del item activo, no el fondo. */
      --chrome:        #FFFFFF;   /* fondo del chrome (rail + topbar) — BLANCO */
      --chrome-tx:     #5C616B;   /* texto de menú inactivo */
      --chrome-tx-on:  #2F6BFF;   /* texto/icono de menú activo (azul) */
      --chrome-ic:     #8A8F99;   /* icono de menú inactivo */
      --chrome-grp:    #8A8F99;   /* título de grupo de menú */
      --chrome-active: #E4EDFF;   /* fondo del item activo (azul claro) */
      --chrome-div:    #EEEFF2;   /* divisor / borde del chrome */
      --brand:         #2F6BFF;   /* marca (sparkles) — azul */
      --sw:        62px;
      --sw-exp:    176px;
      --radius:    9px;
      --radius-lg: 12px;
      /* ── Escala de ESPACIADO (U1). Fuente única; valores calcados de los ya usados para que
         aplicarla sea 1:1 (no recoloca nada). El espaciado inline estructural por-vista se
         conserva mientras no haya un paso equivalente. ── */
      --space-1:  .25rem;   /* 4px  */
      --space-2:  .5rem;    /* 8px  */
      --space-3:  .75rem;   /* 12px */
      --space-4:  1rem;     /* 16px */
      --space-5:  1.25rem;  /* 20px */
      --space-6:  1.5rem;   /* 24px */
      /* ── Escala de TIPOGRAFÍA (U1). Inter en body; tamaños/pesos calcados de los usados. ── */
      --fs-xs:    .72rem;   --fs-sm:  .82rem;   --fs-md:  .88rem;
      --fs-base:  14px;     --fs-lg:  1.05rem;  --fs-xl:  1.7rem;
      --fw-normal: 400;     --fw-medium: 500;   --fw-semibold: 600;
    }`;


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
    ? `<button type="button" class="rmenu-btn rmenu-btn-lbl" onclick="toggleRowMenu(this)">${opts.label} ▾</button>`
    : `<button type="button" class="rmenu-btn" onclick="toggleRowMenu(this)" aria-label="Más acciones" title="Más acciones">⋯</button>`;
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

// ── Mensajes de ERROR compartidos (U3) ────────────────────────────────────────────
// FUENTE ÚNICA de los textos de error (plantillas T1–T11 de docs/ux/u3-textos-errores.md).
// Voz de DISA en el admin: qué pasó en llano + qué hacer. El portal público usa su propia
// voz NEUTRA en su shell (modules/portal). Espejo exacto en window.ERR para el front.
export const ERR = {
  GEN:       'No hemos podido completar la acción. Vuelve a intentarlo en un momento; si sigue pasando, escríbenos a soporte.',
  GEN_SHORT: 'No se pudo completar. Inténtalo de nuevo.',
  NET:       'Parece que se perdió la conexión. Revisa tu internet y vuelve a intentarlo.',
  LOAD:      'No hemos podido cargar los datos. Recarga la página; si sigue igual, inténtalo en un momento.',
  PERM:      'No tienes permiso para esta acción. Si lo necesitas, pídeselo al dueño o a un administrador del negocio.',
  VALID:     'Revisa el formulario: hay algún campo incompleto o con un formato que no cuadra.',
  PDF:       'No hemos podido generar el PDF ahora mismo. Vuelve a intentarlo en un momento; si persiste, avísanos.',
  EMAIL:     'No hemos podido enviar el email. Comprueba la dirección del destinatario e inténtalo más tarde.',
  SERVER:    'Algo ha ido mal por nuestro lado. Vuelve atrás e inténtalo de nuevo; si se repite, escríbenos a soporte.',
  PAGE:      'No encontramos esta página. Puede que el enlace haya cambiado.',
};

// Traduce un mensaje CRUDO (error SQLite, tokens internos, códigos de permiso) a lenguaje
// llano. NO cambia la causa ni cuándo se lanza el error: solo el TEXTO que se muestra. Si el
// mensaje ya es llano (regla de negocio), lo devuelve intacto. Mismas reglas en back y front
// (espejo en window.cleanErrMsg). Duplicados UNIQUE → mensaje contextual por tabla.columna.
const DUP_MSG = {
  'categories.name':     'Ya existe una categoría con ese nombre. Usa otro.',
  'admin_users.email':   'Ya hay un usuario con ese email.',
  'discount_codes.code': 'Ese código de descuento ya está en uso. Prueba con otro.',
  'products.sku':        'Ya existe un producto con ese SKU. Usa una referencia distinta.',
};
export function cleanErrMsg(msg) {
  let s = (msg == null ? '' : String(msg)).trim();
  if (!s) return ERR.GEN_SHORT;
  const uq = s.match(/UNIQUE constraint failed:\s*([a-z0-9_]+\.[a-z0-9_]+)/i);
  if (uq) return DUP_MSG[uq[1].toLowerCase()] || 'Ya existe un registro con ese valor. Revisa los datos e inténtalo de nuevo.';
  // Cualquier otro error interno de base de datos / runtime → genérico (nunca crudo al usuario).
  if (/SQLITE_|no such (table|column)|NOT NULL constraint|datatype mismatch|FOREIGN KEY constraint|CHECK constraint|constraint failed|is not defined|Cannot read propert|is not a function|\bat .+\.js:\d+/i.test(s)) return ERR.GEN;
  if (/^Datos inválidos/i.test(s)) return ERR.VALID;
  // Tokens internos y códigos de permiso filtrados entre paréntesis → fuera (sin tocar el resto).
  s = s.replace(/\s*\((?:confirm_[a-z_]+|cobros\.manage|purchases\.create|D\d)\)/g, '');
  s = s.replace(/\s*\((?:R1[–-]R5|S o I)\)/g, '');
  return s;
}

// ── Página de ERROR maquetada (U3) ────────────────────────────────────────────────
// Reemplaza los `c.text(...)` crudos por una página con el MISMO lenguaje visual que los
// estados vacíos de U2 (icono sobre --accent-soft + frase + acción). Standalone (no depende
// de sesión ni permisos): sirve para 404 de documento, PDF fallido, 500 global y 404 de ruta.
// El icono es SVG inline (sin depender del webfont). `title`/`message`/`action` van escapados.
export function errorShell(title, message, opts = {}) {
  const { action = '', href = '' } = opts;
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const ico = `<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;
  const cta = (action && href) ? `<a class="e-act" href="${esc(href)}">${esc(action)} →</a>` : '';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>`
    + `<style>${ROOT_TOKENS}
    *{box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:var(--text);background:var(--bg);margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.5rem}
    .e-card{background:var(--bg2);border:1px solid var(--border2);border-radius:var(--radius-lg);padding:2.75rem 2rem;max-width:30rem;width:100%;text-align:center;box-shadow:0 12px 36px rgba(16,24,40,.06)}
    .e-ic{width:46px;height:46px;border-radius:12px;background:var(--accent-soft);color:var(--accent);display:inline-flex;align-items:center;justify-content:center;margin-bottom:1rem}
    .e-ti{font-size:1.05rem;font-weight:600;color:var(--text);margin:0 0 .5rem}
    .e-tx{font-size:.9rem;color:var(--text2);line-height:1.5;margin:0}
    .e-act{display:inline-block;margin-top:1.25rem;background:var(--accent);color:#fff;text-decoration:none;padding:.5rem 1rem;border-radius:var(--radius);font-size:.85rem;font-weight:500}</style></head>`
    + `<body><div class="e-card"><span class="e-ic">${ico}</span>`
    + `<h1 class="e-ti">${esc(title)}</h1><p class="e-tx">${esc(message)}</p>${cta}</div></body></html>`;
}

// Atajo: devuelve la respuesta de error maquetada con su código. Uso en rutas:
// return errorPage(c, 404, 'No encontramos esta factura', '…', {action, href}).
export function errorPage(c, status, title, message, opts = {}) {
  return c.html(errorShell(title, message, opts), status);
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
export function fuentesPermitidas(c) {
  const s = new Set();
  for (const [tipo, perm] of Object.entries(PERM_POR_FUENTE)) if (can(c, perm)) s.add(tipo);
  return s;
}

export function adminLayout(title, content, active = '', csrfToken = '', c = null, hideDisaSidebar = false) {
  const session = c?.get?.('session') || {};
  const role = session.role || '';
  const isOwner = role === 'owner';
  const isAdmin = role === 'admin' || isOwner;
  const perms = c?.get?.('userPerms') || [];

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
  let avisos = { count: 0, estado: 'apagado' };
  try {
    const _db = c?.get?.('db');
    if (_db) {
      const est = c?.get?.('avisosEstado')
        || estadoAvisos(_db, hoyLocal(), session.userId, fuentesPermitidas(c));
      avisos = { count: est.count || 0, estado: est.estado };
    }
  } catch { avisos = { count: 0, estado: 'apagado' }; }
  const bellTitle = avisos.estado === 'apagado'
    ? 'Avisos — no tienes nada pendiente'
    : `${avisos.count} aviso${avisos.count === 1 ? '' : 's'}${avisos.estado === 'rojo' ? ' sin ver' : ' pendientes (ya vistos)'}`;

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
  const roBanner = readOnly
    ? `<div style="background:#7c2d12;color:#fed7aa;padding:11px 18px;font-size:13px;font-weight:500;text-align:center">⚠️ Tu cuenta está en <strong>SOLO LECTURA</strong> por regularizar. Puedes ver tus datos y facturas, pero no crear ni modificar nada hasta reactivarla.${_note ? ' · ' + _note : ''}</div>`
    : '';

  // Nav permission map: key → required perm (null = always visible to all logged-in users)
  const navPerms = {
    dashboard:        null,
    activity:         'activity.read',
    products:         'products.read',
    categories:       'categories.read',
    tags:             'tags.read',
    orders:           'orders.read',
    pos:              'orders.create',
    'store-settings': null,
    refunds:          'orders.edit',
    'supplier-returns': 'purchases.read',
    'stock-transfers': 'inventory.read',
    discounts:        'discounts.read',
    quotes:           'quotes.read',
    pedidos:          'pedidos.read',
    albaranes:        'albaranes.read',
    mostrador:        'invoices.create',
    invoices:         'invoices.read',
    recurrentes:      'recurrentes.read',
    'verifactu-envio': 'invoices.read',
    conciliacion:     'conciliacion.read',
    cobros:           'invoices.read',
    portal:           'invoices.read',
    pagos:            'purchases.read',
    'supplier-invoices': 'purchases.read',
    inventory:        'inventory.read',
    warehouses:       'inventory.read',
    suppliers:        'suppliers.read',
    purchases:        'purchases.read',
    'purchase-orders': 'purchases.read',
    clients:          'clients.read',
    'client-groups':  'clients.read',
    crm:              'crm.read',
    analytics:        'analytics.read',
    disa:             null,
    perfil:           null,   // todo usuario gestiona su propio perfil
    users:            'admin.manage_users',
    settings:         'admin.settings',
    security:         'admin.settings',
    'change-password': null,
    'purchases-capture': 'purchases.create',
  };

  const roleFilters = {
    users:            r => r === 'owner' || r === 'admin',
    settings:         r => r === 'owner',
    'store-settings': r => r === 'owner' || r === 'admin',
    security:         r => r === 'owner' || r === 'admin',
  };

  // ── MENÚ estilo HOLDED — rail de iconos por ÁREA + submenú FLOTANTE (flyout) ──────────
  // (Dirección UX 2026-07-06, revisada: el "lean estricto" escondía demasiado. Ahora NINGUNA
  //  función se esconde: el rail muestra un icono por área y, al pasar/pulsar, abre un flyout
  //  con TODAS sus funciones.) Inicio es enlace directo (la home de DISA, §4). El resto son
  //  grupos desplegables. Cada hijo apunta a su ruta real; nada se crea ni se renombra.
  const nav = [
    { label: 'Ventas', icon: 'ti-shopping-cart', items: [
      { href: '/admin/invoices', label: 'Facturas', key: 'invoices', icon: 'ti-file-invoice' },
      { href: '/admin/quotes', label: 'Presupuestos', key: 'quotes', icon: 'ti-file-text' },
      { href: '/admin/recurrentes', label: 'Recurrentes', key: 'recurrentes', icon: 'ti-repeat' },
      { href: '/admin/pedidos', label: 'Pedidos', key: 'pedidos', icon: 'ti-clipboard-list' },
      { href: '/admin/albaranes', label: 'Albaranes', key: 'albaranes', icon: 'ti-truck-delivery' },
      { href: '/admin/cobros', label: 'Cobros', key: 'cobros', icon: 'ti-cash' },
      { href: '/admin/mostrador', label: 'TPV', key: 'mostrador', icon: 'ti-cash-register' },
      { href: '/admin/portal', label: 'Portal de cliente', key: 'portal', icon: 'ti-external-link' },
      { href: '/admin/clients', label: 'Clientes', key: 'clients', icon: 'ti-users' },
      { href: '/admin/clients/groups', label: 'Grupos', key: 'client-groups', icon: 'ti-users-group' },
      // Era un cartel gris (`disabled:true`, sin ruta ni tabla). Ahora es el embudo comercial real.
      // NO se llama "CRM": ese nombre colisionaba con "Clientes", que es donde vive el CRM básico
      // (ficha, grupos, historial) y que ya estaba CERRADO. Lo pendiente era el embudo, y así se
      // llama. La ruta sigue siendo /admin/crm (es el módulo), pero el usuario lee "Oportunidades",
      // que es la palabra de Holded ("embudos de venta" y "oportunidades"), no "negocios"/"deals".
      { href: '/admin/crm', label: 'Oportunidades', key: 'crm', icon: 'ti-target-arrow' },
    ]},
    { label: 'Compras y gastos', icon: 'ti-receipt', items: [
      { href: '/admin/supplier-invoices', label: 'Facturas recibidas', key: 'supplier-invoices', icon: 'ti-file-dollar' },
      { href: '/admin/purchases', label: 'Compra directa', key: 'purchases', icon: 'ti-shopping-cart' },
      { href: '/admin/purchase-orders', label: 'Órdenes de compra', key: 'purchase-orders', icon: 'ti-clipboard-list' },
      { href: '/admin/pagos', label: 'Pagos a proveedores', key: 'pagos', icon: 'ti-cash' },
      { href: '/admin/supplier-returns', label: 'Devoluciones', key: 'supplier-returns', icon: 'ti-arrow-back-up' },
      { href: '/admin/purchases/capture', label: 'Captura de factura', key: 'purchases-capture', icon: 'ti-camera' },
      { href: '/admin/suppliers', label: 'Proveedores', key: 'suppliers', icon: 'ti-building-store' },
    ]},
    { label: 'Contabilidad', icon: 'ti-book', items: [
      { href: '/admin/contabilidad', label: 'Libros y modelos', key: 'contabilidad', icon: 'ti-book' },
      { href: '/admin/conciliacion', label: 'Conciliación bancaria', key: 'conciliacion', icon: 'ti-arrows-exchange' },
      { href: '/admin/verifactu/envios', label: 'Envío Verifactu (AEAT)', key: 'verifactu-envio', icon: 'ti-cloud-upload' },
    ]},
    { label: 'Inventario', icon: 'ti-building-warehouse', items: [
      { href: '/admin/inventory', label: 'Stock', key: 'inventory', icon: 'ti-building-warehouse' },
      { href: '/admin/warehouses', label: 'Almacenes', key: 'warehouses', icon: 'ti-buildings' },
      { href: '/admin/stock-transfers', label: 'Traslados', key: 'stock-transfers', icon: 'ti-transfer' },
    ]},
    { label: 'Catálogo', icon: 'ti-box', items: [
      { href: '/admin/products', label: 'Productos', key: 'products', icon: 'ti-box' },
      { href: '/admin/categories', label: 'Categorías', key: 'categories', icon: 'ti-category' },
    ]},
  ];

  // ── Barra de Cuenta (desplegable del avatar, mockup): items reales + Documentación + salir ──
  const accountItems = [
    // PERFIL absorbe lo personal: datos, contraseña y verificación en dos pasos. Por eso ya no
    // están "Mi cuenta" (era la pantalla-cerrojo de contraseña obligatoria, sigue viva pero fuera
    // del menú) ni "Seguridad" (solo tenía el 2FA; su ruta redirige a /admin/perfil).
    { href: '/admin/perfil', label: 'Perfil', key: 'perfil', icon: 'ti-user' },
    // Una sola entrada de empresa: /admin/settings ES la "Configuración Empresa". Antes había dos
    // ("Ajustes" + "Datos del negocio"), con la segunda apuntando a /admin/settings/company, que
    // solo existe como API (/api/erp/settings/company) → daba 404, y ambas compartían key 'settings'
    // (marcaba dos items activos). El onboarding (disaHome.html.js) ya apuntaba bien a /admin/settings.
    { href: '/admin/settings', label: 'Datos del negocio', key: 'settings', icon: 'ti-building' },
    { href: '/admin/users', label: 'Usuarios', key: 'users', icon: 'ti-user-cog' },
    { href: '/admin/activity', label: 'Actividad', key: 'activity', icon: 'ti-history' },
  ];

  const hasCustomPerms = !isAdmin && !isOwner && perms.length > 0;
  const navFilter = i => {
    if (roleFilters[i.key] && !roleFilters[i.key](role)) return false;
    if (hasCustomPerms) { const req = navPerms[i.key]; if (req != null && !perms.includes(req)) return false; }
    return true;
  };
  // Rail: Inicio (enlace directo) + un icono por ÁREA. Cada área abre un flyout con sus hijos
  // (filtrados por permiso). Un área se marca activa si la pantalla actual es uno de sus hijos.
  const navHTML = nav.map(g => {
    if (g.home) {
      return `<a href="${g.href}" class="nav-item${active === g.key ? ' active' : ''}" title="${g.label}"><i class="ti ${g.icon}"></i></a>`;
    }
    const items = g.items.filter(navFilter);
    if (!items.length) return '';
    const groupActive = items.some(i => i.key === active);
    const fly = items.map(i => i.disabled
      ? `<span class="fly-item disabled" title="Pendiente — aún no disponible"><i class="ti ${i.icon}"></i>${i.label}<span class="nav-pending">pendiente</span></span>`
      : `<a href="${i.href}" class="fly-item${i.key === active ? ' active' : ''}"><i class="ti ${i.icon}"></i>${i.label}</a>`
    ).join('');
    return `<div class="navg" onmouseenter="openFly(this)" onmouseleave="scheduleCloseFly()">`
      + `<button type="button" class="nav-item${groupActive ? ' active' : ''}" title="${g.label}" aria-label="${g.label}" onclick="toggleFly(this.closest('.navg'))"><i class="ti ${g.icon}"></i><span class="nav-label">${g.label}</span><i class="ti ti-chevron-right nav-chev"></i></button>`
      + `<div class="flyout" onmouseenter="cancelCloseFly()" onmouseleave="scheduleCloseFly()"><div class="flyout-h">${g.label}</div>${fly}</div>`
      + `</div>`;
  }).join('');

  // ── Avatar + barra de Cuenta (mockup): cabecera + items gateados + Documentación + salir ──
  const acctVisible = accountItems.filter(navFilter);
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
  <script>
    window.CSRF_TOKEN="${csrfToken}";
    window.USER_PERMS=${JSON.stringify(perms)};
    window.USER_IS_OWNER=${isOwner};
    window.USER_IS_ADMIN=${isAdmin};
    window.canDo=function(p){if(window.USER_IS_OWNER||window.USER_IS_ADMIN)return true;return window.USER_PERMS.includes(p);};
  </script>
  <script>
    function openModal(id){document.getElementById(id).classList.add('open')}
    function closeModal(id){document.getElementById(id).classList.remove('open')}
    function toast(msg,type='ok'){
      const t=document.createElement('div');
      const styles={ok:'background:#E4F6EA;border:1px solid #CDE8D8;color:#157F3B',err:'background:#FBE3E3;border:1px solid #F0CFCC;color:#C0392B',warn:'background:#FBEED0;border:1px solid #EBDDB7;color:#8A5B00'};
      t.style.cssText='position:fixed;bottom:1.5rem;right:1.5rem;padding:.75rem 1.1rem;border-radius:12px;font-size:.85rem;font-weight:500;z-index:9999;box-shadow:0 12px 36px rgba(16,24,40,.16);max-width:300px';
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
    // OJO: este bloque vive dentro de un template literal (el <script> de adminLayout), así que las
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
        ? '<button type="button" class="rmenu-btn rmenu-btn-lbl" onclick="toggleRowMenu(this)">'+opts.label+' ▾</button>'
        : '<button type="button" class="rmenu-btn" onclick="toggleRowMenu(this)" aria-label="Más acciones" title="Más acciones">⋯</button>';
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
      // El rail queda anclado a 216px (.sidebar.flyopen); el flyout va justo a su derecha.
      // Usamos la constante (no getBoundingClientRect) porque el ancho está a mitad de transición.
      var icon=g.querySelector('.nav-item'), r=icon.getBoundingClientRect();
      fly.style.left='222px';
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
    window.addEventListener('scroll',function(){window.closeFly();},true);
    document.addEventListener('keydown',function(e){if(e.key==='Escape')window.closeFly();});
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
    .sidebar:hover,.sidebar.flyopen{width:216px;box-shadow:6px 0 24px rgba(16,24,40,.10)}
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
    /* Flyout: submenú flotante del rail (position:fixed → escapa el clip del rail) */
    .flyout{position:fixed;min-width:210px;background:#fff;border:1px solid var(--border2);border-radius:12px;box-shadow:0 10px 30px rgba(16,24,40,.14);padding:7px;display:none;z-index:200}
    .flyout.open{display:block}
    .flyout-h{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);padding:5px 10px 6px}
    .fly-item{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:8px;color:var(--body-tx);text-decoration:none;font-size:13px;white-space:nowrap}
    .fly-item:hover{background:var(--bg3)}
    .fly-item.active{background:var(--accent-soft);color:var(--accent);font-weight:500}
    .fly-item.disabled{color:var(--text3);opacity:.65;cursor:default;pointer-events:none}
    .fly-item i.ti{flex-shrink:0;font-size:16px;width:16px;color:var(--text3)}
    .fly-item.active i.ti{color:var(--accent)}
    .nav-pending{margin-left:auto;font-size:9px;font-weight:500;text-transform:uppercase;letter-spacing:.04em;color:var(--text3);border:.5px solid var(--border2);border-radius:7px;padding:1px 5px}

    /* ── Topbar CLARO (dirección UX 2026-07-06): buscador · campana · avatar ── */
    .wrap{margin-left:var(--sw);flex:1;display:flex;flex-direction:column;min-height:100vh;min-height:100dvh}
    .topbar{background:var(--chrome);border-bottom:1px solid var(--chrome-div);padding:.6rem 1.1rem;display:flex;align-items:center;gap:14px;position:sticky;top:0;z-index:50}
    .tb-search{flex:1;max-width:430px;display:flex;align-items:center;gap:8px;background:var(--bg3);border:.5px solid var(--border2);border-radius:9px;padding:7px 12px;color:var(--text3);font-size:13px;cursor:text}
    .tb-search i.ti{font-size:16px}
    .tb-search:focus-within{border-color:var(--accent);background:#fff}
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
    .kpi{background:var(--bg2);border:1px solid var(--border2);border-radius:var(--radius-lg);padding:1.25rem;transition:border-color .2s}
    .kpi:hover{border-color:var(--border2)}
    .kpi-label{font-size:.72rem;color:var(--text3);font-weight:500;text-transform:uppercase;letter-spacing:.06em}
    .kpi-val{font-size:1.7rem;font-weight:500;margin:.3rem 0 .15rem;color:var(--text)}
    .kpi-sub{font-size:.75rem;color:var(--text3)}

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
      .tb-search span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      /* Pantallas a pantalla completa (el chat de DISA): el contenido RELLENA el hueco bajo el
         topbar con flexbox, sin restar una altura fija de topbar → el compositor queda siempre a la
         vista, sin scroll, sea cual sea el alto real del topbar o del navegador móvil. */
      .content-flush{padding:0;display:flex;flex-direction:column;overflow:hidden;min-height:0}
      /* ── Navegación: el rail pasa a DRAWER off-canvas que abre la hamburguesa ── */
      .nav-toggle{display:inline-flex}
      .sidebar{transform:translateX(-100%);width:250px;transition:transform .2s ease;overflow-y:auto}
      .sidebar.open{transform:translateX(0);box-shadow:8px 0 30px rgba(16,24,40,.22)}
      /* Con el drawer abierto se muestran los nombres (en táctil no hay hover que los despliegue) */
      .sidebar.open .nav-label{opacity:1;max-width:170px}
      .sidebar.open .nav-item,.sidebar.open .disa-pin{justify-content:flex-start;gap:12px}
      .sidebar.open .nav-item{padding-left:.7rem}
      .sidebar.open .disa-pin{padding-left:1.05rem}
      .sidebar.open .nav-chev{opacity:.45}
      /* Submenús: en acordeón INLINE dentro del drawer (no popovers flotantes que se saldrían) */
      .sidebar.open .flyout{position:static;min-width:0;width:auto;box-shadow:none;border:none;background:transparent;padding:2px 0 6px 34px;z-index:auto;top:auto!important;left:auto!important}
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
    <a href="/admin" class="disa-pin${active === 'dashboard' ? ' active' : ''}" title="Inicio — DISA">
      <i class="ti ti-sparkles"></i>
      <span class="nav-label">Inicio</span>
    </a>
    <nav class="sb-nav">
      ${navHTML}
      <span class="rail-spacer"></span>
      <a href="/docs" target="_blank" class="nav-item" title="Ayuda y soporte"><i class="ti ti-lifebuoy"></i><span class="nav-label">Ayuda y soporte</span></a>
    </nav>
  </aside>
  <div class="nav-backdrop" onclick="closeNav()" aria-hidden="true"></div>
  <div class="wrap">
    <div class="topbar">
      <button type="button" class="nav-toggle" aria-label="Abrir menú" aria-expanded="false" onclick="toggleNav()"><i class="ti ti-menu-2"></i></button>
      <div class="tb-search"><i class="ti ti-search"></i><span>Buscar cliente, factura, producto…</span></div>
      <div class="tb-bell-wrap">
        <button type="button" class="tb-bell" id="tbBell" title="${bellTitle}" aria-label="${bellTitle}"
                aria-haspopup="true" aria-expanded="false" onclick="toggleBell(event)">
          <i class="ti ti-bell"></i>${avisos.estado === 'apagado' ? '' : `<span class="dot${avisos.estado === 'visto' ? ' visto' : ''}"></span>`}
        </button>
        <div class="bell-panel" id="bellPanel">
          <div class="bell-head">
            <strong>Avisos</strong>
            <button type="button" class="bell-all" id="bellAll" onclick="bellMarcarTodos(event)">Marcar todos como vistos</button>
          </div>
          <div class="bell-list" id="bellList"><p class="bell-empty">Cargando…</p></div>
          <a class="bell-foot" href="/admin/avisos">Ver y resolver todos</a>
        </div>
      </div>
      <div class="acct">
        <button class="acct-btn" id="acctBtn" type="button" aria-haspopup="true" aria-expanded="false" onclick="toggleAcct(event)" title="${escName}">
          ${avatarHTML}
        </button>
        <div class="acct-menu" id="acctMenu">${acctMenuHTML}</div>
      </div>
    </div>
    <main class="content${active === 'disa' ? ' content-flush' : ''}">${roBanner}${content}</main>
  </div>
  <script>
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
    // ÚNICA vía para tocar la campana desde fuera. Antes solo pintaba el punto: la LISTA cacheada
    // del panel se quedaba vieja, así que tras cobrar una factura en /admin/avisos la campana
    // seguía ofreciéndola como pendiente, con el punto ya en gris. Ahora invalida el caché y, si el
    // panel está abierto, lo repinta. Nadie debe tocar el punto a mano.
    window.bellSync=function(sinVer,total){
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
      _bellCargado=false;                                   // lo cacheado ya no vale
      var p=document.getElementById('bellPanel');
      if(p&&p.classList.contains('open')) bellCargar();     // abierto → repinta ahora
    };
    var _bellCargado=false;
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
      window.bellSync(d.sinVer, d.count);
    }
    async function bellCargar(){
      try{ bellPinta(await api('GET','/api/erp/avisos')); _bellCargado=true; }
      catch(e){ document.getElementById('bellList').innerHTML='<p class="bell-empty">No pude cargar tus avisos.</p>'; }
    }
    // Delegación: un solo listener para todos los botones "Visto" del panel.
    document.addEventListener('click',async function(e){
      var btn=e.target.closest('#bellList .bell-ver'); if(!btn) return;
      e.stopPropagation(); e.preventDefault();
      var visto = btn.dataset.visto === '1';
      try{ bellPinta(await api('POST','/api/erp/avisos/'+(visto?'visto':'no-visto'),{keys:[btn.dataset.key]}));
           if(typeof window.avisosOnVisto==='function') window.avisosOnVisto();
      }catch(err){ toast(err.message||'Error','err'); }
    });
    window.bellMarcarTodos=async function(e){
      e.stopPropagation();
      try{ bellPinta(await api('POST','/api/erp/avisos/visto',{}));   // sin keys = todos
           toast('Avisos marcados como vistos');
           if(typeof window.avisosOnVisto==='function') window.avisosOnVisto();
      }catch(err){ toast(err.message||'Error','err'); }
    };
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
  

${hideDisaSidebar ? '' : getDisaWidget()}
  <div id="accessDeniedModal" style="display:none;position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.6);z-index:99999;align-items:center;justify-content:center">
    <div style="background:#FFFFFF;border:1px solid #EDEFF2;border-radius:13px;padding:32px;text-align:center;max-width:380px;box-shadow:0 30px 80px rgba(16,24,40,.18)">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#A6453F" stroke-width="2" style="margin-bottom:16px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <h3 style="color:#23262C;margin:0 0 8px">Acceso no permitido</h3>
      <p style="color:#828B9B;font-size:13px;margin:0 0 20px">${ERR.PERM}</p>
      <button onclick="document.getElementById('accessDeniedModal').style.display='none'" style="background:#3A4150;border:none;color:#fff;padding:8px 24px;border-radius:9px;cursor:pointer;font-weight:500">Entendido</button>
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
<title>${String(title).replace(/</g, '&lt;')}</title>
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
