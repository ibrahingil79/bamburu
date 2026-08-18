// ════════════════════════════════════════════════════════════════════════════════════════════════
// MENÚ — LA DEFINICIÓN ÚNICA DE LA NAVEGACIÓN DEL PANEL
//
// Sale de `layout.js` (donde vivía dentro de `adminLayout`) para que las TRES caras de la navegación
// —el rail, el buscador y las anclas— coman EXACTAMENTE de la misma mesa. Escribir una segunda lista
// de destinos para el buscador era el error obvio: se quedaría vieja y acabaría enseñando puertas que
// el menú esconde. Aquí no hay dos listas: hay una.
//
// REGLA QUE MANDA EN ESTE FICHERO: no se esconde, no se quita y no se aplaza NI UNA entrada. En julio
// se probó un menú "lean" que escondía funciones y se revirtió a propósito (U1, `494d2ab`). Lo que se
// hace es SEPARAR lo del día a día de los ajustes DENTRO del mismo desplegable: todo sigue visible en
// la misma pantalla y al mismo número de clics. Separar, no plegar.
//
// PERMISOS: aquí NO se arregla nada. `filtroDeUsuario` reproduce, línea por línea, las DOS reglas que
// el menú ya aplicaba —ni mejor ni peor—, para que el buscador herede el comportamiento de hoy y los
// dos se arreglen a la vez el día que se aborde. Ver el comentario de `filtroDeUsuario`.
import { vocabulario } from './oficios.js';                   // PASO 8 — fuente ÚNICA de las palabras de pantalla
import { contarAvisosPendientes } from './citas-avisos.js';   // AGENDA SENCILLA §2.3 — contador de la Cola
import { getLayoutRaw, setLayout, delLayout } from './inicio-layout.js';

// ── Nav permission map: key → permiso exigido (null = visible para cualquiera con sesión) ──────────
// Copiado TAL CUAL de layout.js. Se conservan las claves de pantallas que hoy no cuelgan de ninguna
// entrada (tags, orders, pos, refunds, discounts, store-settings…): no estorban y perderlas sería
// perder el candado el día que esas pantallas vuelvan al menú.
//
// ⚠️ HALLAZGO DEL PASO 0, ANOTADO Y NO ARREGLADO: `contabilidad` es la única de las 40 claves del rail
// SIN entrada aquí, mientras `/admin/contabilidad` exige `invoices.read`. Un empleado con permisos
// propios y sin `invoices.read` VE «Libros y modelos» y se come un 403 al pulsar. No se toca en esta
// tarea (el encargo lo prohíbe expresamente): el buscador lo hereda igual, y ambos se arreglan a la vez.
export const NAV_PERMS = {
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
  proyectos:        'proyectos.read',   // peldaño 7 · servicios profesionales
  tiempo:           'tiempo.read',      // peldaño 7 · PIEZA 2 · registro de tiempo
  'facturar-horas': 'invoices.create',  // peldaño 7 · PIEZA 3 · facturar horas (mismo permiso que emitir factura)
  rentabilidad:     ['proyectos.read', 'invoices.read'],   // peldaño 7 · PIEZA 4 · exige AMBOS (proyectos + P&G)
  citas:            'citas.read',        // peldaño 7 · PIEZA 5 · agenda de citas
  'citas-cola':     'citas.read',
  'citas-servicios':'citas.read',
  'citas-recursos': 'citas.read',
  // Mismo candado que la pantalla a la que lleva (/admin/users): quien no administra usuarios
  // tampoco ve la entrada desde la Agenda. Es un atajo, no un permiso nuevo.
  'citas-personas': 'admin.manage_users',
  'citas-horarios': 'citas.read',
  'citas-ajustes':  'citas.edit',
  'citas-publica':  'citas.edit',   // peldaño 7 · PIEZA 6 · mandos de la puerta pública de reserva
  analytics:        'analytics.read',
  vigia:            'analytics.read',   // DISA predictiva · el vigía (dentro filtra por detector)
  disa:             null,
  perfil:           null,   // todo usuario gestiona su propio perfil
  users:            'admin.manage_users',
  settings:         'admin.settings',
  security:         'admin.settings',
  'change-password': null,
  'purchases-capture': 'purchases.create',
};

export const ROLE_FILTERS = {
  users:            r => r === 'owner' || r === 'admin',
  settings:         r => r === 'owner',
  'store-settings': r => r === 'owner' || r === 'admin',
  security:         r => r === 'owner' || r === 'admin',
};

// ── EL MENÚ ───────────────────────────────────────────────────────────────────────────────────────
// Rail de iconos por ÁREA + submenú flotante (flyout), estilo Holded (`494d2ab`). Cada hijo apunta a
// su ruta REAL; aquí no se crea, no se renombra y no se mueve de área nada.
//
// `ajustes: true` — LA ÚNICA NOVEDAD DE ESTA TAREA en la definición. Marca la entrada como
// configuración / maestro / plantilla, para que el desplegable la pinte en el bloque de abajo, bajo el
// rótulo «Ajustes de <Área>». NO la esconde, NO la pliega y NO le añade un clic: sigue en la misma
// pantalla, a la misma distancia. Es una línea y un rótulo, nada más.
//
// LA REGLA DE LA DUDA: si no está claro si una entrada es del día a día o de ajuste, va ARRIBA. El
// valor por defecto es visible. Por eso «Portal de cliente» (configura el IBAN pero también manda
// enlaces a clientes) y «Envío Verifactu» (es una cola operativa, no un ajuste) se quedan arriba.
export const MENU = [
  // DISA — 1er grupo del rail. Estaba escrito a mano en layout.js, fuera de esta lista: por eso sus
  // dos entradas no existían para nadie más. Ahora vive aquí y el buscador y las anclas las ven.
  // OJO: su candado NO es `NAV_PERMS`; es un O de tres permisos con semántica `can()`. Ver `permAlguno`.
  { id: 'disa', label: 'DISA', icon: 'ti-sparkles', items: [
    { href: '/admin/propuestas', label: 'Propuestas', key: 'propuestas', icon: 'ti-checklist',
      permAlguno: ['invoices.read', 'cobros.read', 'purchases.read'] },
    // Sin ruta: abre el MISMO chat flotante de siempre. Se puede BUSCAR (Enter lo abre), no se puede
    // anclar —el rail ancla destinos, y esto no es un destino.
    { label: 'Hablar con DISA', key: 'disa-chat', icon: 'ti-message-2',
      accion: "closeFly();if(window.disaOpen){disaOpen();}else{location.href='/admin/disa';}" },
  ]},
  { id: 'ventas', label: 'Ventas', icon: 'ti-shopping-cart', items: [
    { href: '/admin/invoices', label: 'Facturas', key: 'invoices', icon: 'ti-file-invoice' },
    { href: '/admin/quotes', label: 'Presupuestos', key: 'quotes', icon: 'ti-file-text' },
    { href: '/admin/recurrentes', label: 'Recurrentes', key: 'recurrentes', icon: 'ti-repeat' },
    { href: '/admin/pedidos', label: 'Pedidos', key: 'pedidos', icon: 'ti-clipboard-list' },
    { href: '/admin/albaranes', label: 'Albaranes', key: 'albaranes', icon: 'ti-truck-delivery' },
    { href: '/admin/cobros', label: 'Cobros', key: 'cobros', icon: 'ti-cash' },
    { href: '/admin/mostrador', label: 'TPV', key: 'mostrador', icon: 'ti-cash-register' },
    { href: '/admin/portal', label: 'Portal de cliente', key: 'portal', icon: 'ti-external-link' },
  ]},
  // «A quién le vendes» — ÁREA PROPIA en el rail (sacada de Ventas a petición de Ibrahim, 21 jul 2026):
  // Clientes, sus Grupos y el embudo comercial (Oportunidades) viven juntos, no sueltos dentro de Ventas,
  // que queda solo con los documentos de venta.
  { id: 'clientes', label: 'Clientes', icon: 'ti-address-book', items: [
    { href: '/admin/clients', label: 'Clientes', key: 'clients', icon: 'ti-users' },
    // Era un cartel gris (`disabled:true`, sin ruta ni tabla). Ahora es el embudo comercial real.
    // NO se llama "CRM": ese nombre colisionaba con "Clientes", que es donde vive el CRM básico
    // (ficha, grupos, historial) y que ya estaba CERRADO. Lo pendiente era el embudo, y así se
    // llama. La ruta sigue siendo /admin/crm (es el módulo), pero el usuario lee "Oportunidades",
    // que es la palabra de Holded ("embudos de venta" y "oportunidades"), no "negocios"/"deals".
    { href: '/admin/crm', label: 'Oportunidades', key: 'crm', icon: 'ti-target-arrow' },
    { href: '/admin/clients/groups', label: 'Grupos', key: 'client-groups', icon: 'ti-users-group', ajustes: true },
  ]},
  // Peldaño 7 · servicios profesionales — ÁREA PROPIA en el rail (sacada de Ventas a petición de Ibrahim,
  // 21 jul 2026): proyectos, sus horas y la facturación de esas horas viven juntos, no mezclados con Ventas.
  { id: 'proyectos', label: 'Proyectos', icon: 'ti-briefcase', items: [
    { href: '/admin/proyectos', label: 'Proyectos', key: 'proyectos', icon: 'ti-folders' },
    { href: '/admin/tiempo', label: 'Registro de tiempo', key: 'tiempo', icon: 'ti-clock-play' },
    { href: '/admin/facturar-horas', label: 'Facturar horas', key: 'facturar-horas', icon: 'ti-clock-dollar' },
    { href: '/admin/rentabilidad', label: 'Rentabilidad', key: 'rentabilidad', icon: 'ti-chart-pie' },
  ]},
  // Peldaño 7 · PIEZA 5 — SISTEMA DE CITAS. Área propia: la agenda y todo lo que la alimenta
  // (servicios reservables, recursos, horarios) y la cola de envíos de avisos. NO es el calendario
  // FISCAL (ese vive en Contabilidad/Ajustes). Candado citas.read/edit en todas las rutas.
  // Es el área que más gana con la separación: de 8 entradas en fila, 2 son del día a día.
  { id: 'agenda', label: 'Agenda', icon: 'ti-calendar', items: [
    { href: '/admin/citas', label: 'Agenda', key: 'citas', icon: 'ti-calendar-event' },
    { href: '/admin/citas/cola', label: 'Cola de envíos', key: 'citas-cola', icon: 'ti-send' },
    { href: '/admin/citas/servicios', label: 'Servicios reservables', key: 'citas-servicios', icon: 'ti-clock-hour-4', ajustes: true },
    // QUIÉN ATIENDE — faltaba. En el área de Agenda solo había "Recursos" (que con el oficio pasa a
    // llamarse "Sillas", "Cabinas"…), así que un peluquero que quería dar de alta a su segunda
    // estilista se encontraba "Sillas" como lo más parecido a una persona. Las personas son
    // `admin_users` y se gestionan en /admin/users; lo que faltaba era la puerta desde aquí.
    { href: '/admin/users', label: 'Quién atiende', key: 'citas-personas', icon: 'ti-users', ajustes: true },
    { href: '/admin/citas/recursos', label: 'Recursos', key: 'citas-recursos', icon: 'ti-armchair', ajustes: true },
    { href: '/admin/citas/horarios', label: 'Horarios', key: 'citas-horarios', icon: 'ti-calendar-time', ajustes: true },
    { href: '/admin/citas/ajustes', label: 'Ajustes de citas', key: 'citas-ajustes', icon: 'ti-settings', ajustes: true },
    { href: '/admin/citas/publica', label: 'Reservas por Internet', key: 'citas-publica', icon: 'ti-world', ajustes: true },
  ]},
  { id: 'compras', label: 'Compras y gastos', icon: 'ti-receipt', items: [
    { href: '/admin/supplier-invoices', label: 'Facturas recibidas', key: 'supplier-invoices', icon: 'ti-file-dollar' },
    { href: '/admin/purchases', label: 'Compra directa', key: 'purchases', icon: 'ti-shopping-cart' },
    { href: '/admin/purchase-orders', label: 'Órdenes de compra', key: 'purchase-orders', icon: 'ti-clipboard-list' },
    { href: '/admin/pagos', label: 'Pagos a proveedores', key: 'pagos', icon: 'ti-cash' },
    { href: '/admin/supplier-returns', label: 'Devoluciones', key: 'supplier-returns', icon: 'ti-arrow-back-up' },
    { href: '/admin/purchases/capture', label: 'Captura de factura', key: 'purchases-capture', icon: 'ti-camera' },
    { href: '/admin/suppliers', label: 'Proveedores', key: 'suppliers', icon: 'ti-building-store', ajustes: true },
  ]},
  { id: 'contabilidad', label: 'Contabilidad', icon: 'ti-book', items: [
    { href: '/admin/contabilidad', label: 'Libros y modelos', key: 'contabilidad', icon: 'ti-book' },
    { href: '/admin/conciliacion', label: 'Conciliación bancaria', key: 'conciliacion', icon: 'ti-arrows-exchange' },
    { href: '/admin/verifactu/envios', label: 'Envío Verifactu (AEAT)', key: 'verifactu-envio', icon: 'ti-cloud-upload' },
  ]},
  { id: 'inventario', label: 'Inventario', icon: 'ti-building-warehouse', items: [
    { href: '/admin/inventory', label: 'Stock', key: 'inventory', icon: 'ti-building-warehouse' },
    { href: '/admin/stock-transfers', label: 'Traslados', key: 'stock-transfers', icon: 'ti-transfer' },
    { href: '/admin/warehouses', label: 'Almacenes', key: 'warehouses', icon: 'ti-buildings', ajustes: true },
  ]},
  { id: 'catalogo', label: 'Catálogo', icon: 'ti-box', items: [
    { href: '/admin/products', label: 'Productos', key: 'products', icon: 'ti-box' },
    { href: '/admin/categories', label: 'Categorías', key: 'categories', icon: 'ti-category', ajustes: true },
  ]},
  // ── ANALÍTICA — reenganchada al menú (17 jul 2026, escalera paso 2) ────────────────────────
  // La pantalla llevaba VIVA y sin enlace desde que U7 la encontró (8-jul): existía, respondía 200
  // y no había forma de llegar salvo tecleando la URL. `NAV_PERMS.analytics` ya estaba declarado
  // sin ningún item que lo usara — U7 lo anotó como hallazgo. Ahora lo usa este.
  // NO se reengancha nada más: `/admin/discounts` y `/admin/tags` siguen sin enlace a propósito
  // (decisión del dueño en U7), y el clúster de e-commerce (`/admin/orders`, `/admin/shipping`)
  // está desmontado y da 404 — resucitarlo por el menú sería revivir lo que D1/D2 apagaron.
  { id: 'analitica', label: 'Analítica', icon: 'ti-chart-histogram', items: [
    { href: '/admin/analytics', label: 'Informes', key: 'analytics', icon: 'ti-report-analytics' },
    // Escalera · paso 5 — DISA predictiva. El vigía analiza sobre los motores del constructor; por
    // eso vive aquí, junto a Informes, y no en el rail de chat de DISA.
    { href: '/admin/vigia', label: 'Vigía (DISA)', key: 'vigia', icon: 'ti-radar' },
  ]},
];

// ── ENTRADAS FIJAS DEL RAIL — fuera de las áreas, arriba y abajo del todo ─────────────────────────
// Estaban escritas a mano en el HTML de `adminLayout`. Se declaran aquí para que el buscador las
// encuentre y se puedan anclar: son entradas del menú como cualquier otra. `adminLayout` las sigue
// pintando en su sitio de siempre, leyéndolas de aquí.
//
// ⚠️ NO PASAN POR EL FILTRO DE PERMISOS, igual que antes: las dos son de todos (el Inicio y la ayuda).
// Esto hereda el aviso que llevaba la rama `g.home` del menú viejo —que no usaba nadie y que aquí se
// retira—: si algún día se añade a esta lista una pantalla con candado, HAY QUE FILTRARLA, o el menú
// enseñará una puerta que solo se cierra al pulsarla (403).
export const FIJAS = [
  { href: '/admin', label: 'Inicio', key: 'dashboard', icon: 'ti-home', sitio: 'pin' },
  { href: '/docs', label: 'Ayuda y soporte', key: 'ayuda', icon: 'ti-lifebuoy', sitio: 'pie', target: '_blank' },
];

// ── Barra de Cuenta (desplegable del avatar): items reales ────────────────────────────────────────
// PERFIL absorbe lo personal: datos, contraseña y verificación en dos pasos. Por eso ya no están
// "Mi cuenta" (era la pantalla-cerrojo de contraseña obligatoria, sigue viva pero fuera del menú)
// ni "Seguridad" (solo tenía el 2FA; su ruta redirige a /admin/perfil).
// Una sola entrada de empresa: /admin/settings ES la "Configuración Empresa" (arreglado en U8, `9cf2e46`).
// «Documentación» y «Cerrar sesión» NO están aquí: los pinta `adminLayout` a mano, tras su separador, y
// se quedan exactamente donde están. Cerrar sesión, además, queda FUERA del buscador a propósito:
// un destino que se dispara con Enter no puede ser el que te echa de la sesión.
export const CUENTA = [
  { href: '/admin/perfil', label: 'Perfil', key: 'perfil', icon: 'ti-user' },
  { href: '/admin/settings', label: 'Datos del negocio', key: 'settings', icon: 'ti-building' },
  { href: '/admin/users', label: 'Usuarios', key: 'users', icon: 'ti-user-cog' },
  { href: '/admin/activity', label: 'Actividad', key: 'activity', icon: 'ti-history' },
];

// ── EL FILTRO DE PERMISOS — DOS reglas, las dos calcadas de layout.js ─────────────────────────────
//
// (1) `NAV_PERMS` + `ROLE_FILTERS`, la regla del rail. Solo se aplica a quien tiene permisos PROPIOS
//     (`hasCustomPerms`). Consecuencia CONOCIDA Y ANOTADA: un empleado con CERO permisos ve el menú
//     entero. NO se arregla aquí — es otra tarea, y el encargo pide expresamente que el buscador
//     herede el comportamiento del menú "ni mejor ni peor" para que ambos se arreglen a la vez.
//
// (2) `permAlguno`, la regla de DISA: un O de varios permisos con semántica `can()` —owner/admin pasan
//     siempre; el resto necesita AL MENOS UNO, tenga o no permisos propios. NO se puede meter en (1):
//     con la regla (1), un empleado sin permisos vería «Propuestas», y hoy NO la ve. Son dos reglas
//     distintas porque hoy ya lo son; unificarlas sería cambiar el comportamiento de tapadillo.
export function filtroDeUsuario({ role = '', perms = [] } = {}) {
  const isOwner = role === 'owner';
  const isAdmin = role === 'admin' || isOwner;
  const hasCustomPerms = !isAdmin && !isOwner && perms.length > 0;
  const can = p => isOwner || isAdmin || perms.includes(p);
  return i => {
    if (ROLE_FILTERS[i.key] && !ROLE_FILTERS[i.key](role)) return false;
    if (i.permAlguno) return i.permAlguno.some(can);
    if (hasCustomPerms) {
      const req = NAV_PERMS[i.key];
      if (req != null) {
        const reqs = Array.isArray(req) ? req : [req];
        if (!reqs.every(r => perms.includes(r))) return false;
      }
    }
    return true;
  };
}

// ── EL MENÚ DE ESTE USUARIO ───────────────────────────────────────────────────────────────────────
// Resuelve las etiquetas que dependen del negocio y filtra por permiso. Devuelve cada área ya partida
// en sus dos bloques (`diario` / `ajustes`) y también entera (`todos`), porque el buscador y las anclas
// no quieren saber nada de bloques.
//
// Las etiquetas del oficio salen de `vocabulario()`, la fuente ÚNICA (PASO 8). Antes el parche del menú
// leía `cita_puesto_plural` por su cuenta, en paralelo a `ajustesCitas()`: dos lecturas de lo mismo.
// Barato y tolerante a fallo: si algo peta, se queda el default y el contador a 0 — el chrome nunca se
// rompe por esto.
export function menuDeUsuario(db, { role = '', perms = [], userId = null } = {}) {
  let plural = null, pend = 0;
  try {
    if (db) {
      plural = vocabulario(db).puesto_plural;
      pend = contarAvisosPendientes(db);
    }
  } catch { plural = null; pend = 0; }

  const etiqueta = it => {
    if (it.key === 'citas-recursos' && plural) return plural;
    if (it.key === 'citas-cola') return 'Cola de envíos' + (pend > 0 ? ' · ' + pend : '');
    return it.label;
  };

  const pasa = filtroDeUsuario({ role, perms });
  const areas = [];
  for (const g of MENU) {
    const todos = g.items.filter(pasa).map(it => ({ ...it, label: etiqueta(it), area: g.label, areaId: g.id }));
    if (!todos.length) continue;
    areas.push({
      id: g.id, label: g.label, icon: g.icon,
      diario:  todos.filter(i => !i.ajustes),
      ajustes: todos.filter(i => i.ajustes),
      todos,
    });
  }
  const cuenta = CUENTA.filter(pasa).map(it => ({ ...it, area: 'Cuenta', areaId: 'cuenta' }));
  const fijas  = FIJAS.map(it => ({ ...it, area: '', areaId: 'fijas' }));
  // El ORDEN de este usuario se aplica al final, sobre el menú ya filtrado. Nunca quita nada: lo que
  // no esté en su lista se coloca detrás, en el orden de fábrica (ver `aplicarOrden`).
  let pref = { areas: [], entradas: {} };
  try { if (db && userId) pref = leerPref(db, userId); } catch { /* el menú nunca se rompe por esto */ }
  return { areas: aplicarOrden(areas, pref), cuenta, fijas };
}

// ── (D) ORDEN PROPIO — mover de sitio los menús y los submenús ────────────────────────────────────
// CAMBIO DE REGLA, pedido por Ibrahin (17 ago 2026): el encargo original decía «las áreas de fábrica NO
// se reordenan». Ahora SÍ se reordenan, y las entradas dentro de su área también. Lo que NO cambia:
// nada se esconde, nada se quita, y ninguna entrada se muda a otra área.
//
// LA REGLA QUE PROTEGE EL INVENTARIO: el orden guardado es una lista de CLAVES, y una lista de claves
// envejece —mañana hay una entrada nueva que nadie tenía guardada—. Por eso lo que no está en la lista
// NO desaparece: se coloca DETRÁS, en su orden de fábrica. Un menú personalizado en agosto tiene que
// seguir enseñando la función que se construya en septiembre, sin que el usuario toque nada.
//
// La línea de «Ajustes de <Área>» es un DESTINO de verdad: soltar una entrada encima de la línea la
// pasa a ajustes, y soltarla arriba la devuelve al día a día. Es una preferencia de ESTE usuario; la
// clasificación de fábrica (`ajustes: true`) no se toca.
function porOrden(items, claves) {
  const porClave = new Map(items.map(i => [i.key, i]));
  const out = [];
  for (const k of (Array.isArray(claves) ? claves : [])) {
    const it = porClave.get(k);
    if (it) { out.push(it); porClave.delete(k); }
  }
  return { colocados: out, resto: porClave };
}

export function aplicarOrden(areas, pref) {
  const { colocados, resto } = porOrden(areas.map(a => ({ ...a, key: a.id })), pref.areas);
  const ordenadas = colocados.concat([...resto.values()]);   // lo no listado (áreas nuevas), detrás
  return ordenadas.map(a => {
    const o = (pref.entradas || {})[a.id];
    if (!o) return a;
    const enDiario = new Set(Array.isArray(o.diario) ? o.diario : []);
    const enAjustes = new Set(Array.isArray(o.ajustes) ? o.ajustes : []);
    // El bucket lo decide el usuario si opinó sobre esa entrada; si no, el de fábrica.
    const bucket = i => (enDiario.has(i.key) ? 'diario' : enAjustes.has(i.key) ? 'ajustes' : (i.ajustes ? 'ajustes' : 'diario'));
    const diarioF = a.todos.filter(i => bucket(i) === 'diario');
    const ajustesF = a.todos.filter(i => bucket(i) === 'ajustes');
    const d = porOrden(diarioF, o.diario);
    const j = porOrden(ajustesF, o.ajustes);
    return { ...a,
      diario: d.colocados.concat([...d.resto.values()]),
      ajustes: j.colocados.concat([...j.resto.values()]) };
  });
}

// ── EL CATÁLOGO DE DESTINOS — lo que ve el buscador y lo que se puede anclar ──────────────────────
// Sale del menú YA FILTRADO: por construcción es imposible que el buscador enseñe una puerta que el
// menú esconde, porque no hay otra lista de la que sacarla.
// Se incluyen las áreas mismas (buscar "Agenda" lleva a la Agenda) y todas sus entradas.
export function destinosBuscador(menu) {
  const out = [];
  for (const a of menu.areas) {
    // El área como destino: lleva a su PRIMERA entrada del día a día (la que abre el desplegable).
    // Salvo que una entrada suya se llame IGUAL que el área («Agenda» dentro de Agenda, «Clientes»
    // dentro de Clientes…): ahí sobra el resultado del área, porque llevan al mismo sitio y el usuario
    // vería la misma palabra dos veces. Se queda la entrada, que es la que dice a qué pantalla va.
    const primera = a.diario[0] || a.todos[0];
    const seLlamaIgual = a.todos.some(i => i.label === a.label);
    if (primera && primera.href && !seLlamaIgual) {
      out.push({ tipo: 'area', key: 'area:' + a.id, label: a.label, area: '', href: primera.href, icon: a.icon });
    }
    for (const i of a.todos) out.push({ tipo: 'entrada', key: i.key, label: i.label, area: i.area, href: i.href || '', icon: i.icon, accion: i.accion || '' });
  }
  for (const i of menu.fijas)  out.push({ tipo: 'entrada', key: i.key, label: i.label, area: '', href: i.href, icon: i.icon });
  for (const i of menu.cuenta) out.push({ tipo: 'entrada', key: i.key, label: i.label, area: i.area, href: i.href, icon: i.icon });
  return out;
}

// Lo ANCLABLE de este usuario, indexado por clave. «Cualquier entrada del menú» es literal: entran
// **las áreas del rail** (clave `area:<id>`) **y** las entradas de sus desplegables, más las fijas y
// las de cuenta. Lo único que no entra es «Hablar con DISA»: no tiene ruta, y el bloque de anclados
// ancla sitios a los que ir — se busca, no se ancla.
//
// Anclar un área NO la mueve, ni la renombra, ni la saca del rail: sigue en su sitio y en su orden.
// Lo que aparece arriba es un ATAJO que abre el MISMO desplegable.
export function anclablesPorClave(menu) {
  const m = new Map();
  for (const a of menu.areas) {
    m.set('area:' + a.id, { tipo: 'area', key: 'area:' + a.id, label: a.label, icon: a.icon, area: a });
    for (const i of a.todos) if (i.href) m.set(i.key, { tipo: 'entrada', ...i });
  }
  for (const i of menu.fijas)  m.set(i.key, { tipo: 'entrada', ...i });
  for (const i of menu.cuenta) m.set(i.key, { tipo: 'entrada', ...i });
  return m;
}

// ── LO PROPIO DE CADA USUARIO: ANCLAS (C) + ORDEN (D) ────────────────────────────────────────────
// Frontera de Salesforce: la casa viene ordenada y el usuario la ajusta ENCIMA. Anclar NO saca la
// entrada de su área, y reordenar NO renombra ni quita nada ni muda entradas de un área a otra.
//
// DÓNDE VIVE: en `dashboard_layouts`, la tabla de preferencias por usuario del peldaño 6, con ámbito
// `menu:usuario:<id>` — y con SUS funciones (getLayoutRaw/setLayout/delLayout, que aceptan cualquier
// ámbito), no con SQL copiado. No se crea un segundo sistema de preferencias. UNA fila por usuario
// guarda TODO lo suyo del menú: sus anclas y su orden.
//   ⚠️ AVISO A QUIEN TOQUE `inicio-layout.js`: esta tabla YA NO guarda solo layouts del Inicio. Los
//   ámbitos del Inicio son 'empresa' y 'usuario:<id>'; el de aquí, 'menu:usuario:<id>'. Hoy nadie
//   borra por prefijo (los DELETE son por ámbito exacto) y así tiene que seguir: un
//   `DELETE ... WHERE scope LIKE 'usuario:%'` se llevaría por delante el menú de todo el mundo.
//
// LA AUSENCIA DE FILA ES EL DEFECTO: quien no toca nada ve EXACTAMENTE el menú de fábrica. Por eso
// una preferencia vacía BORRA la fila en vez de guardar listas vacías.
export const MAX_ANCLAS = 8;
const scopeMenu = userId => 'menu:usuario:' + userId;

const listaLimpia = (v, tope = Infinity) => {
  const vistas = new Set(); const out = [];
  for (const k of (Array.isArray(v) ? v : [])) {
    if (typeof k !== 'string' || !k || vistas.has(k)) continue;
    vistas.add(k); out.push(k);
    if (out.length >= tope) break;
  }
  return out;
};

// Lee la preferencia de menú de este usuario. Acepta el formato VIEJO (una lista suelta = solo anclas)
// porque la pieza de las anclas salió antes que la del orden y puede haber filas así guardadas.
export function leerPref(db, userId) {
  const vacia = { anclas: [], areas: [], entradas: {} };
  if (!db || !userId) return vacia;
  const g = getLayoutRaw(db, scopeMenu(userId));
  if (Array.isArray(g)) return { anclas: listaLimpia(g, MAX_ANCLAS), areas: [], entradas: {} };
  if (!g || typeof g !== 'object') return vacia;
  const entradas = {};
  for (const [areaId, o] of Object.entries(g.entradas || {})) {
    if (!o || typeof o !== 'object') continue;
    const d = listaLimpia(o.diario), j = listaLimpia(o.ajustes);
    if (d.length || j.length) entradas[areaId] = { diario: d, ajustes: j };
  }
  return { anclas: listaLimpia(g.anclas, MAX_ANCLAS), areas: listaLimpia(g.areas), entradas };
}

export function escribirPref(db, userId, pref) {
  const limpia = {
    anclas: listaLimpia(pref.anclas, MAX_ANCLAS),
    areas: listaLimpia(pref.areas),
    entradas: {},
  };
  for (const [areaId, o] of Object.entries(pref.entradas || {})) {
    if (!o || typeof o !== 'object') continue;
    const d = listaLimpia(o.diario), j = listaLimpia(o.ajustes);
    if (d.length || j.length) limpia.entradas[areaId] = { diario: d, ajustes: j };
  }
  const vacia = !limpia.anclas.length && !limpia.areas.length && !Object.keys(limpia.entradas).length;
  if (vacia) { delLayout(db, scopeMenu(userId)); return { ok: true, ...limpia }; }
  setLayout(db, scopeMenu(userId), limpia, userId);
  return { ok: true, ...limpia };
}

// Vuelta al menú DE FÁBRICA: se borra la fila entera, anclas y orden. No hay medias tintas — el
// usuario pide "como venía", y como venía es sin fila.
export function borrarPref(db, userId) { delLayout(db, scopeMenu(userId)); return { ok: true }; }

// ¿Este usuario ha tocado algo? Lo usa el rail para enseñar (o no) el botón de restablecer.
export function tienePref(db, userId) {
  const p = leerPref(db, userId);
  return !!(p.anclas.length || p.areas.length || Object.keys(p.entradas).length);
}

export function getAnclas(db, userId) { return leerPref(db, userId).anclas; }

export function setAnclas(db, userId, claves) {
  const pref = leerPref(db, userId);
  const r = escribirPref(db, userId, { ...pref, anclas: claves });
  return { ok: true, anclas: r.anclas };
}

// (D) Guardar el ORDEN. `areas` = ids de área en su orden; `entradas` = por área, sus dos bloques.
export function setOrden(db, userId, { areas, entradas }) {
  const pref = leerPref(db, userId);
  const r = escribirPref(db, userId, {
    anclas: pref.anclas,
    areas: areas === undefined ? pref.areas : areas,
    entradas: entradas === undefined ? pref.entradas : entradas,
  });
  return { ok: true, areas: r.areas, entradas: r.entradas };
}

export function anclasDeUsuario(db, userId, menu) {
  const claves = getAnclas(db, userId);
  if (!claves.length) return [];
  const porClave = anclablesPorClave(menu);
  return claves.map(k => porClave.get(k)).filter(Boolean);
}
