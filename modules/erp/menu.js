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
  // La pantalla nueva cuelga de FACTURAS, no de un permiso propio: un descuento cambia lo que se
  // factura, así que quien no puede ver facturas tampoco tiene por qué ver las promociones.
  descuentos:       'invoices.read',
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
  // El control horario NO lleva candado en el menú A PROPÓSITO: la ley da a CADA trabajador derecho
  // a consultar su propio registro, así que la entrada la ve todo el mundo. Lo que sí lleva permiso
  // (`tiempo.read`) es el bloque del EQUIPO dentro de la pantalla — eso son datos de otras personas.
  fichaje:          null,
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
  // ── LAS CATORCE QUE NO ESTABAN EN EL MENÚ (24 ago 2026) ──────────────────────────────────────
  // Eran secciones de verdad a las que solo se llegaba desde dentro de otra pantalla o escribiendo
  // la dirección. Cada una entra con EL CANDADO DE SU PROPIA PANTALLA, no con uno inventado: si el
  // menú pidiera menos, sería una puerta abierta de tapadillo; si pidiera más, escondería algo que
  // el usuario sí puede abrir.
  //
  // ⚠️ Y DE PASO SE CIERRA EL HALLAZGO QUE LLEVABA AQUÍ ANOTADO SIN ARREGLAR: `contabilidad` era la
  // única clave del rail SIN candado, mientras `/admin/contabilidad` exige `invoices.read`. Un
  // empleado sin ese permiso VEÍA «Libros y modelos» y se comía un 403 al pulsar. Ahora no la ve.
  contabilidad:        'invoices.read',
  'contab-ventas':     'invoices.read',
  'contab-compras':    'invoices.read',
  'contab-diario':     'invoices.read',
  'contab-mayor':      'invoices.read',
  'contab-bienes':     'invoices.read',
  'contab-pyg':        'invoices.read',
  'contab-modelos':    'invoices.read',
  'crm-cola':          'crm.read',
  'crm-tareas':        'crm.read',
  'migracion-importar': 'company.read',
  'settings-plantillas': 'company.read',
  'settings-fiscal':   'company.read',
  // PELDAÑO 8 · el registro de accesos al historial. Su candado NO es `requirePerm` corriente: el
  // permiso `historial.read` no perdona el rol de administrador (ver core/auth.js). Aquí se declara
  // para que el rail lo respete igual, y `condicionesConfig` lo esconde fuera del oficio de salud.
  'historial-accesos': 'historial.read',
  // ⚙️ 24 ago 2026 · CORREGIDO EL MISMO DÍA QUE SE PUSO. Se declaró `null` porque la pantalla filtra
  // por dentro lo que enseña — y es verdad—, pero eso hacía que **cualquier empleado viera en su
  // menú una entrada de la configuración del negocio**. Lo cazó `gate-menu-navegacion`: «y NO ve
  // ninguna otra parte de la configuración del negocio — avisos=true». Filtrar dentro no basta si
  // la puerta se enseña fuera. Pide lo mismo que las otras dos de su sección.
  'settings-avisos':   'company.read',
  avisos:              null,   // la pantalla de avisos tampoco; ya se alcanzaba desde la campana
  security:         'admin.settings',
  'change-password': null,
  'purchases-capture': 'purchases.create',
  // B1 — la migración asistida. MISMO candado que exige `/admin/migracion` (`company.read`, ver
  // `routes/migracion.js`): darle entrada de menú no abre ni cierra ninguna puerta, solo la enseña.
  migracion:        'company.read',
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
// valor por defecto es visible. Por eso «Envío Verifactu» (es una cola operativa, no un ajuste) se
// queda arriba.
//
// ⚠️ MARCAR NO ES PARTIR. `ajustes: true` dice lo que la entrada ES; que el desplegable se parta en dos
// bloques lo decide `MIN_AJUSTES` al pintar (ver abajo). Un área con una sola entrada de ajuste se
// pinta como UNA lista, sin rótulo: dos carteles para separar tres cosas de una es más cartel que menú.
// La marca se conserva igual, para que el día que esa área tenga tres ajustes el bloque aparezca solo.
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
    // PUNTO 11 (23 ago 2026) — la función de descuentos VUELVE, y esta vez con puerta. La vieja
    // (`/admin/discounts`) se desmontó por estar MUERTA: era de la tienda, con códigos para un
    // carrito, y no tocaba ni una factura. Esta sirve a la facturación, así que vive en Ventas.
    { href: '/admin/descuentos', label: 'Descuentos y bonos', key: 'descuentos', icon: 'ti-discount' },
    // «Portal de cliente» YA NO ESTÁ AQUÍ: se fue a Clientes el 18 ago 2026, por decisión de Ibrahin.
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
    // Las dos pantallas que colgaban del embudo y no se veían desde fuera.
    { href: '/admin/crm/cola', label: 'Cola comercial', key: 'crm-cola', icon: 'ti-list-check' },
    { href: '/admin/crm/tareas', label: 'Tareas del CRM', key: 'crm-tareas', icon: 'ti-checkbox' },
    // SOLO EN EL OFICIO DE SALUD. `siHay: 'historial'` la esconde en peluquerías, talleres y demás:
    // en esos negocios no existe ni la entrada, ni la pestaña, ni la ruta (que da 404).
    { href: '/admin/historial/accesos', label: 'Quién ha abierto un historial', key: 'historial-accesos',
      icon: 'ti-lock-access', siHay: 'historial', ajustes: true,
      alias: ['Historial clínico', 'Accesos', 'Auditoría del historial'] },
    // MOVIDO DESDE VENTAS (18 ago 2026, decisión de Ibrahin). Es la puerta por la que un CLIENTE entra
    // a ver sus facturas, y desde aquí se le manda su enlace: pertenece a «a quién le vendes», no a los
    // documentos de venta. ⚠️ SU CANDADO NO CAMBIA: sigue exigiendo `invoices.read`, el de su pantalla
    // (/admin/portal), NO el de Clientes. Mover una entrada de área no puede cambiar quién puede
    // entrar por ella — eso sería abrir o cerrar una puerta de tapadillo.
    { href: '/admin/portal', label: 'Portal de cliente', key: 'portal', icon: 'ti-external-link' },
    { href: '/admin/clients/groups', label: 'Grupos', key: 'client-groups', icon: 'ti-users-group', ajustes: true },
  ]},
  // Peldaño 7 · servicios profesionales — ÁREA PROPIA en el rail (sacada de Ventas a petición de Ibrahim,
  // 21 jul 2026): proyectos, sus horas y la facturación de esas horas viven juntos, no mezclados con Ventas.
  { id: 'proyectos', label: 'Proyectos', icon: 'ti-briefcase', items: [
    { href: '/admin/proyectos', label: 'Proyectos', key: 'proyectos', icon: 'ti-folders' },
    { href: '/admin/tiempo', label: 'Registro de tiempo', key: 'tiempo', icon: 'ti-clock-play' },
    // PUNTO 12 (23 ago 2026) — el registro de jornada, que es OTRA cosa que el registro de tiempo:
    // uno factura horas de proyecto y el otro cumple el RD-ley 8/2019. Van juntos porque los dos
    // hablan de horas, pero no comparten tabla: mezclarlos metería la pausa de la comida en las
    // horas facturables de un cliente.
    { href: '/admin/fichaje', label: 'Control horario', key: 'fichaje', icon: 'ti-clock-check' },
    { href: '/admin/facturar-horas', label: 'Facturar horas', key: 'facturar-horas', icon: 'ti-clock-dollar' },
    { href: '/admin/rentabilidad', label: 'Rentabilidad', key: 'rentabilidad', icon: 'ti-chart-pie' },
  ]},
  // Peldaño 7 · PIEZA 5 — SISTEMA DE CITAS. EN AGENDA SOLO VIVE LO QUE SE USA ATENDIENDO CLIENTES
  // (decisión de producto de Ibrahin, 18 ago 2026). Lo que se monta una vez y se olvida —cuándo abro,
  // cuánto dura cada servicio, mi equipo, cómo se piden las citas, mi página de reservas y los
  // puestos— se mudó a la CONFIGURACIÓN DEL NEGOCIO: vive en `CONFIG_NEGOCIO`, más abajo en este
  // mismo fichero. NO SE ELIMINÓ NI UNA: son las mismas seis puertas, con las mismas rutas y los
  // mismos permisos, en otro sitio. Mudar no es esconder, y este fichero sigue teniendo UNA lista.
  //
  // Con DOS entradas y NINGUNA de ajuste el desplegable va de UNA PIEZA, y eso no se decide aquí: lo
  // decide `MIN_AJUSTES` al pintar. No es el calendario FISCAL (ese vive en Contabilidad/Ajustes).
  { id: 'agenda', label: 'Agenda', icon: 'ti-calendar', items: [
    { href: '/admin/citas', label: 'Agenda', key: 'citas', icon: 'ti-calendar-event' },
    // «Recordatorios a clientes» era «Cola de envíos». MISMO SITIO Y MISMO CONTADOR al lado cuando hay
    // pendientes: lo único que cambia es el nombre, porque «cola de envíos» es la palabra del que lo
    // programó, no la del que lo usa. El nombre viejo se sigue encontrando en el buscador (`alias`).
    { href: '/admin/citas/cola', label: 'Recordatorios a clientes', key: 'citas-cola', icon: 'ti-send',
      alias: ['Cola de envíos'] },
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
    // Los SIETE libros, cada uno con su entrada. Estaban vivos y solo se alcanzaban por las pestañas
    // de dentro: quien no supiera que existen no llegaba. Van marcados como `ajustes:false` (día a
    // día) porque son consulta diaria de una gestoría, no configuración.
    { href: '/admin/contabilidad/ventas', label: 'Libro de ventas', key: 'contab-ventas', icon: 'ti-file-dollar' },
    { href: '/admin/contabilidad/compras', label: 'Libro de compras', key: 'contab-compras', icon: 'ti-file-invoice' },
    { href: '/admin/contabilidad/diario', label: 'Diario', key: 'contab-diario', icon: 'ti-notebook' },
    { href: '/admin/contabilidad/mayor', label: 'Mayor', key: 'contab-mayor', icon: 'ti-books' },
    { href: '/admin/contabilidad/pyg', label: 'Pérdidas y ganancias', key: 'contab-pyg', icon: 'ti-chart-line' },
    { href: '/admin/contabilidad/bienes', label: 'Bienes de inversión', key: 'contab-bienes', icon: 'ti-building-factory' },
    { href: '/admin/contabilidad/modelos', label: 'Modelos de Hacienda', key: 'contab-modelos', icon: 'ti-file-certificate' },
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
    // B2 (23 ago 2026) — ETIQUETAS, reenganchada. Llevaba viva y sin enlace desde U7 (8 jul): pantalla
    // propia (`tagsViews`, products.js:842), responde 200 y no había forma de llegar salvo tecleando la
    // dirección. Es un maestro del catálogo, como Categorías, así que va marcada `ajustes` y a su lado.
    // `NAV_PERMS.tags` YA estaba declarado sin ningún item que lo usara — el mismo caso que analytics.
    { href: '/admin/tags', label: 'Etiquetas', key: 'tags', icon: 'ti-tag', ajustes: true,
      alias: ['Tags', 'Etiquetas de producto'] },
  ]},
  // ── ANALÍTICA — reenganchada al menú (17 jul 2026, escalera paso 2) ────────────────────────
  // La pantalla llevaba VIVA y sin enlace desde que U7 la encontró (8-jul): existía, respondía 200
  // y no había forma de llegar salvo tecleando la URL. `NAV_PERMS.analytics` ya estaba declarado
  // sin ningún item que lo usara — U7 lo anotó como hallazgo. Ahora lo usa este.
  // ⚙️ ACTUALIZADO EL 23 AGO 2026 (B2). Este comentario decía que `/admin/discounts` y `/admin/tags`
  // seguían sin enlace «a propósito». No era exacto: lo que el dueño dijo en U7 fue **«se abordarán
  // luego»** (TABLERO:1724), y ese luego es B2. **`/admin/tags` ya está enganchada** aquí arriba, en
  // Catálogo.
  // ⚙️ CORREGIDO EL MISMO 23 AGO 2026 (encargo CUPONES, que NO es la ficha B de la migración). Donde este comentario decía que `/admin/discounts`
  // «queda apuntada como candidata a desmontar, NO se retira aquí», ya NO es cierto: **se desmontó**.
  // La pantalla y su API están retiradas (`routes/index.js`) y sus tablas archivadas a
  // `discount_codes_archived` / `auto_discounts_archived`. No hay nada que enlazar: da 404.
  // El clúster de e-commerce (`/admin/orders`, `/admin/shipping`) está desmontado y da 404 —
  // resucitarlo por el menú sería revivir lo que D1/D2 apagaron.
  { id: 'analitica', label: 'Analítica', icon: 'ti-chart-histogram', items: [
    { href: '/admin/analytics', label: 'Informes', key: 'analytics', icon: 'ti-report-analytics' },
    // Escalera · paso 5 — DISA predictiva. El vigía analiza sobre los motores del constructor; por
    // eso vive aquí, junto a Informes, y no en el rail de chat de DISA.
    { href: '/admin/vigia', label: 'Vigía (DISA)', key: 'vigia', icon: 'ti-radar' },
  ]},
];

// ── LA CONFIGURACIÓN DEL NEGOCIO — lo que se monta una vez y se olvida ────────────────────────────
// DECISIÓN DE PRODUCTO DE IBRAHIN (18 ago 2026), y es la regla que decide todo lo demás:
//
//        EN AGENDA SOLO VIVE LO QUE SE USA ATENDIENDO CLIENTES.
//        TODO LO QUE SE MONTA UNA VEZ Y SE OLVIDA VIVE EN LA CONFIGURACIÓN DEL NEGOCIO.
//
// Estas seis ESTABAN en el desplegable de Agenda y se han mudado aquí. NO SE ELIMINA NINGUNA FUNCIÓN:
// mismas rutas (quien tenga un enlace guardado sigue llegando), mismos permisos, otro sitio.
//
// POR QUÉ VIVEN EN ESTE FICHERO Y NO ESCRITAS A MANO EN `routes/settings.js`. Porque el buscador y las
// anclas comen de aquí. Si la sección se escribiera en la pantalla de ajustes habría DOS listas —la
// del buscador y la de la pantalla— y el día que una cambie, la otra se queda vieja en silencio. Es
// exactamente el error contra el que está escrita la cabecera de este fichero: aquí no hay dos listas.
//
// ⚠️ LA SECCIÓN NO HEREDA EL CANDADO DE LA PÁGINA QUE LA CONTIENE. `/admin/settings` exige
// `company.read` para SU contenido (empresa, fiscal, plantillas), pero cada entrada de aquí conserva
// EXACTAMENTE el permiso que tenía en Agenda, ni uno más: `citas-horarios` sigue siendo `citas.read`
// y `citas-personas` sigue siendo `admin.manage_users`. Quien tenga `citas.read` y no `company.read`
// ve ESTA sección y nada más de esa pantalla; quien no tenga ninguna de las seis no ve la sección.
// Un cambio de sitio no puede abrir ni cerrar una puerta — la misma regla que se aplicó al mudar
// «Portal de cliente» de Ventas a Clientes.
//
// `alias` = los nombres VIEJOS. No se pintan en ningún sitio: solo los busca el buscador, para que
// quien lleva un año escribiendo «Cola de envíos» u «Horarios» siga encontrando su pantalla.
//
// `siHay` = la entrada solo existe si la condición se cumple (ver `condicionesConfig`). Hoy solo la
// usan los puestos. Es la ÚNICA entrada condicional del menú, y por eso lleva su regla escrita al
// lado en vez de en un mapa lejano.
export const CONFIG_NEGOCIO = [
  {
    id: 'cfg-agenda',
    label: 'Cómo funciona mi agenda',
    icon: 'ti-calendar-cog',
    descripcion: 'Lo que montas una vez y se queda montado: cuándo abres, cuánto dura cada cosa, quién atiende y cómo te piden cita.',
    // EL ORDEN NO ES ALFABÉTICO NI CAPRICHOSO: es el orden en que se monta un negocio. Primero cuándo
    // abro, luego qué vendo y cuánto dura, luego quién lo hace, luego cómo me lo piden.
    items: [
      { href: '/admin/citas/horarios', label: 'Cuándo abro', key: 'citas-horarios', icon: 'ti-calendar-time',
        alias: ['Horarios'],
        desc: 'Tu horario semanal, los descansos y las excepciones (vacaciones, festivos, cierres).' },
      { href: '/admin/citas/servicios', label: 'Cuánto dura cada servicio', key: 'citas-servicios', icon: 'ti-clock-hour-4',
        alias: ['Servicios reservables', 'Servicios'],
        desc: 'El tiempo que ocupa cada servicio en tu agenda. El precio y el IVA siguen viniendo de tu catálogo.' },
      // «Mi equipo» lleva a /admin/users, que es donde viven las personas. Sigue siendo un ATAJO con el
      // candado de SU pantalla (`admin.manage_users`), no un permiso nuevo. Lo que se ha quitado es el
      // atajo desde Agenda, que es de donde venía.
      { href: '/admin/users', label: 'Mi equipo', key: 'citas-personas', icon: 'ti-users',
        alias: ['Quién atiende', 'Personas', 'Usuarios'],
        desc: 'Quién atiende en tu negocio. Cada persona puede tener su propio horario.' },
      { href: '/admin/citas/ajustes', label: 'Cómo se piden las citas', key: 'citas-ajustes', icon: 'ti-settings',
        alias: ['Ajustes de citas'],
        desc: 'Antelación mínima, hasta cuándo se puede reservar, margen entre citas y cómo salen los recordatorios.' },
      { href: '/admin/citas/publica', label: 'Mi página de reservas', key: 'citas-publica', icon: 'ti-world',
        alias: ['Reservas por Internet', 'Reserva pública'],
        desc: 'La dirección donde tus clientes piden cita solos, y qué se ve en ella.' },
      // ── LA ÚNICA ENTRADA CONDICIONAL DEL MENÚ ───────────────────────────────────────────────────
      // NACE OCULTA y aparece sola cuando el negocio tiene al menos un puesto de alta, o cuando algún
      // servicio exige uno. NO SE ELIMINA LA FUNCIÓN: un taller con dos elevadores la necesita para no
      // vender un sitio que no tiene; lo que no tiene sentido es enseñársela a la peluquera que trabaja
      // sola. Para el negocio que la necesita y aún no lo sabe, la puerta de entrada está DENTRO de
      // «Cuánto dura cada servicio»: al marcar que un servicio necesita un sitio o un aparato, se da de
      // alta ahí mismo y la entrada aparece.
      //
      // El NOMBRE lo pone el oficio (Sillas / Cabinas / Salas / Boxes) y sigue siendo editable en
      // «Cómo se piden las citas» — igual que cuando vivía en Agenda. Ver `etiqueta()`.
      { href: '/admin/citas/recursos', label: 'Puestos', key: 'citas-recursos', icon: 'ti-armchair',
        siHay: 'puestos',
        alias: ['Recursos', 'Puestos', 'Sillas', 'Cabinas', 'Salas', 'Boxes'],
        desc: 'Las sillas, cabinas, salas o aparatos que una cita ocupa además de la persona.' },
    ],
  },
  // ── LAS TRES PANTALLAS DE AJUSTES QUE NO ESTABAN EN NINGÚN MENÚ (24 ago 2026) ──────────────────
  // Vivían dentro de «Datos del negocio» y solo se llegaba a ellas pulsando un botón de esa pantalla.
  // Son configuración del negocio, así que van donde vive la configuración del negocio, con el mismo
  // candado que cada una exige por su cuenta.
  {
    id: 'cfg-empresa',
    label: 'Cómo habla mi negocio y qué presenta',
    icon: 'ti-building',
    descripcion: 'La voz de tus correos, cuándo avisa Bamburu y qué modelos te tocan con Hacienda.',
    items: [
      { href: '/admin/settings/plantillas', label: 'Plantillas de correo', key: 'settings-plantillas', icon: 'ti-mail-cog',
        alias: ['Emails', 'Correos', 'Plantillas de email'],
        desc: 'El texto de cada correo que sale de Bamburu, escrito con tus palabras.' },
      { href: '/admin/settings/avisos', label: 'Avisos y correos', key: 'settings-avisos', icon: 'ti-bell-cog',
        alias: ['Notificaciones', 'Recordatorios'],
        desc: 'Qué te avisa Bamburu, cuándo, y a qué dirección llega el resumen del día.' },
      { href: '/admin/settings/situacion-fiscal', label: 'Mi situación fiscal', key: 'settings-fiscal', icon: 'ti-file-certificate',
        alias: ['Modelos', 'Hacienda', 'IVA', 'IRPF', '303', '130'],
        desc: 'Qué declaras. De aquí salen los modelos que DISA te recuerda, y sus fechas.' },
    ],
  },
];

// ¿Qué condiciones `siHay` se cumplen en ESTE negocio? Una sola consulta por condición, y tolerante a
// fallo: si algo peta, la condición se da por NO cumplida y la entrada no aparece — el menú nunca se
// rompe por esto, y fallar cerrado es lo correcto para algo que decide si se ve una puerta.
//
// `puestos`: hay al menos un puesto de alta O algún servicio exige uno. La segunda mitad importa: un
// servicio puede exigir un puesto que luego se archivó, y esconder la pantalla dejaría ese servicio
// sin forma de arreglarse.
export function condicionesConfig(db) {
  const hay = sql => { try { return db.prepare(sql).get() != null; } catch { return false; } };
  if (!db) return { puestos: false };
  return {
    // PELDAÑO 8 · el historial clínico solo existe en el oficio de salud.
    historial: (() => { try { return db.prepare("SELECT 1 FROM company_config WHERE id=1 AND oficio='salud'").get() != null; } catch { return false; } })(),
    puestos: hay('SELECT 1 FROM recursos WHERE active=1 LIMIT 1')
          || hay('SELECT 1 FROM service_resources LIMIT 1'),
  };
}


// ── ENTRADAS FIJAS DEL RAIL — fuera de las áreas, arriba y abajo del todo ─────────────────────────
// Estaban escritas a mano en el HTML de `adminLayout`. Se declaran aquí para que el buscador las
// encuentre y se puedan anclar: son entradas del menú como cualquier otra. `adminLayout` las sigue
// pintando en su sitio de siempre, leyéndolas de aquí.
//
// ⚠️ ESE DÍA LLEGÓ (23 ago 2026, B1). El aviso de aquí decía: «si algún día se añade a esta lista una
// pantalla con candado, HAY QUE FILTRARLA, o el menú enseñará una puerta que solo se cierra al
// pulsarla (403)». «Trae tus datos» tiene candado (`company.read`), así que **las FIJAS ya pasan por
// el filtro de permisos** — ver `menuDeUsuario`. Inicio y la ayuda no cambian de comportamiento: sus
// claves no exigen nada en `NAV_PERMS` (`dashboard: null`, `ayuda` ni siquiera está), así que siguen
// siendo de todos. Lo que se ha quitado es el riesgo, no una puerta.
//
// POR QUÉ LA MIGRACIÓN VA AQUÍ Y NO EN UN ÁREA: no es del día a día de ningún área —no es una venta,
// ni una compra, ni un cliente—, es lo PRIMERO que hace quien viene de otro programa. Al pie del rail
// está siempre visible, no depende de que el negocio esté vacío y queda junto a la ayuda, que es donde
// mira quien acaba de entrar. Sus otras dos puertas siguen donde estaban y ninguna depende de esta:
// el paso del panel «Pon en marcha tu negocio» (`arranque.js`), que se pliega, y la tarjeta fija de
// «Datos del negocio» (`routes/settings.js`).
export const FIJAS = [
  { href: '/admin', label: 'Inicio', key: 'dashboard', icon: 'ti-home', sitio: 'pin' },
  // B1 — LA ENTRADA PERMANENTE A LA MIGRACIÓN ASISTIDA. Los `alias` son las palabras con las que un
  // dueño la busca de verdad: nadie teclea «migración asistida», teclea «Holded» o «importar».
  { href: '/admin/migracion', label: 'Trae tus datos', key: 'migracion', icon: 'ti-file-import', sitio: 'pie',
    alias: ['Migración', 'Migrar', 'Importar datos', 'Traer mis datos', 'Holded', 'Quipu', 'Excel',
            'Cambiar de programa', 'Programa anterior'] },
  // EL IMPORTADOR DE FICHEROS, junto a la migración asistida: son las dos formas de traerse los datos
  // —una la hace el equipo por ti, la otra la haces tú— y hasta hoy solo se llegaba a la segunda
  // escribiendo la dirección. Mismo candado que su pantalla (`company.read`).
  { href: '/admin/migracion/importar', label: 'Importar un fichero', key: 'migracion-importar', icon: 'ti-table-import',
    sitio: 'pie', alias: ['CSV', 'Importar CSV', 'Subir fichero', 'Excel'] },
  // LA PANTALLA DE AVISOS. Ya se alcanzaba desde la campana («Ver y resolver todos»), así que no
  // estaba huérfana como las otras trece — pero un destino que solo existe dentro de un desplegable
  // no se puede buscar ni anclar, y eso sí faltaba.
  { href: '/admin/avisos', label: 'Avisos', key: 'avisos', icon: 'ti-bell', sitio: 'pie',
    alias: ['Notificaciones', 'Pendientes', 'Alertas'] },
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
    // El nombre del puesto lo pone el OFICIO y lo puede reescribir el dueño. Sigue igual que cuando la
    // entrada vivía en Agenda: mudarla de sitio no le cambia el nombre.
    if (it.key === 'citas-recursos' && plural) return plural;
    // Mismo contador de siempre, nombre nuevo (era «Cola de envíos»).
    if (it.key === 'citas-cola') return 'Recordatorios a clientes' + (pend > 0 ? ' · ' + pend : '');
    return it.label;
  };

  const pasa = filtroDeUsuario({ role, perms });
  // ⚙️ 24 ago 2026 · `siHay` YA NO ES SOLO DE LA CONFIGURACIÓN. Lo usaba únicamente `CONFIG_NEGOCIO`
  // (para los puestos), y el rail lo ignoraba. El historial clínico lo necesita en el rail: es una
  // entrada que **solo existe en el oficio de salud**, y una entrada condicional que el rail no filtra
  // es una puerta enseñada a quien no puede abrirla.
  const cond0 = condicionesConfig(db);
  const hayCond = it => !it.siHay || cond0[it.siHay] === true;
  const areas = [];
  for (const g of MENU) {
    const todos = g.items.filter(pasa).filter(hayCond).map(it => ({ ...it, label: etiqueta(it), area: g.label, areaId: g.id }));
    if (!todos.length) continue;
    areas.push({
      id: g.id, label: g.label, icon: g.icon,
      diario:  todos.filter(i => !i.ajustes),
      ajustes: todos.filter(i => i.ajustes),
      todos,
    });
  }

  // ── LA CONFIGURACIÓN DEL NEGOCIO, filtrada DOS veces ─────────────────────────────────────────────
  // (1) por el permiso PROPIO de cada entrada —el mismo `pasa` que el rail, ni mejor ni peor—, y
  // (2) por su condición `siHay`, que hoy solo usan los puestos.
  // Una sección sin entradas visibles NO se devuelve: quien no tiene ninguna de las seis no ve ni el
  // título. Así la pantalla de ajustes no tiene que decidir nada — pinta lo que le llega.
  const cond = cond0;
  const config = [];
  for (const sec of CONFIG_NEGOCIO) {
    const items = sec.items
      .filter(pasa)
      .filter(it => !it.siHay || cond[it.siHay] === true)
      .map(it => ({ ...it, label: etiqueta(it), area: sec.label, areaId: sec.id }));
    if (!items.length) continue;
    config.push({ id: sec.id, label: sec.label, icon: sec.icon, descripcion: sec.descripcion, items });
  }

  // «Datos del negocio» abre la pantalla que ALOJA esa sección. Si el usuario tiene algo dentro, la
  // entrada tiene que estar: si no, la mudanza le CERRARÍA el camino visual a seis puertas que hoy
  // abre desde Agenda — y un cambio de sitio no puede cerrar una puerta. NO abre nada: el contenido
  // propio de esa pantalla (empresa, fiscal, plantillas) sigue exigiendo `company.read`, y lo que
  // este usuario verá al entrar es exactamente su sección y nada más.
  const cuenta = CUENTA
    .filter(it => pasa(it) || (it.key === 'settings' && config.length > 0))
    .map(it => ({ ...it, area: 'Cuenta', areaId: 'cuenta' }));
  // Las FIJAS pasan por el MISMO filtro que el resto desde que una de ellas tiene candado
  // («Trae tus datos», `company.read`). Inicio y la ayuda no lo notan: no exigen ningún permiso.
  const fijas  = FIJAS.filter(pasa).filter(hayCond).map(it => ({ ...it, area: '', areaId: 'fijas' }));
  // El ORDEN de este usuario se aplica al final, sobre el menú ya filtrado. Nunca quita nada: lo que
  // no esté en su lista se coloca detrás, en el orden de fábrica (ver `aplicarOrden`).
  let pref = { areas: [], entradas: {} };
  try { if (db && userId) pref = leerPref(db, userId); } catch { /* el menú nunca se rompe por esto */ }
  return { areas: aplicarOrden(areas, pref), cuenta, fijas, config };
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
// Se incluyen las áreas mismas (buscar "Agenda" lleva a la Agenda), todas sus entradas Y las de la
// configuración del negocio — que están en otra pantalla, pero son entradas del menú igual.
//
// `alias` = los nombres VIEJOS de una entrada renombrada. Viajan hasta el buscador y NO se pintan: se
// buscan. Sin esto, mudar y renombrar seis entradas dejaría a quien lleva un año tecleando «Cola de
// envíos» delante de un «Nada del menú se llama así» — que es exactamente perder la función aunque el
// enlace siga existiendo.
export function destinosBuscador(menu) {
  const out = [];
  const dest = (i, area) => ({ tipo: 'entrada', key: i.key, label: i.label, area, href: i.href || '',
                               icon: i.icon, accion: i.accion || '', alias: i.alias || [] });
  for (const a of menu.areas) {
    // El área como destino: lleva a su PRIMERA entrada del día a día (la que abre el desplegable).
    // Salvo que una entrada suya se llame IGUAL que el área («Agenda» dentro de Agenda, «Clientes»
    // dentro de Clientes…): ahí sobra el resultado del área, porque llevan al mismo sitio y el usuario
    // vería la misma palabra dos veces. Se queda la entrada, que es la que dice a qué pantalla va.
    const primera = a.diario[0] || a.todos[0];
    const seLlamaIgual = a.todos.some(i => i.label === a.label);
    if (primera && primera.href && !seLlamaIgual) {
      out.push({ tipo: 'area', key: 'area:' + a.id, label: a.label, area: '', href: primera.href, icon: a.icon, alias: [] });
    }
    for (const i of a.todos) out.push(dest(i, i.area));
  }
  // Las de la configuración del negocio. Se etiquetan con el nombre de SU sección, para que el
  // resultado diga de dónde sale («Cuándo abro · Cómo funciona mi agenda») y no parezca que están en
  // el rail. Ya vienen filtradas por permiso y por condición desde `menuDeUsuario`.
  for (const sec of (menu.config || [])) for (const i of sec.items) out.push(dest(i, sec.label));
  // Los `alias` de las fijas SÍ viajan al buscador: sin esto, «Trae tus datos» solo se encontraría
  // tecleando su nombre exacto, y quien viene de otro programa teclea «Holded», no «trae tus datos».
  for (const i of menu.fijas)  out.push({ tipo: 'entrada', key: i.key, label: i.label, area: '', href: i.href, icon: i.icon, alias: i.alias || [] });
  for (const i of menu.cuenta) out.push({ tipo: 'entrada', key: i.key, label: i.label, area: i.area, href: i.href, icon: i.icon, alias: [] });
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
  // Las de la configuración del negocio se anclan igual que las demás. Es lo que impide que la mudanza
  // les quite una capacidad que hoy tienen: quien se subía «Horarios» al rail puede seguir haciéndolo.
  for (const sec of (menu.config || [])) for (const i of sec.items) if (i.href) m.set(i.key, { tipo: 'entrada', ...i });
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
// Cuántas entradas de ajuste tiene que haber para que el desplegable se parta en DOS bloques con su
// rótulo. Por debajo de esto se pinta UNA sola lista (los ajustes al final, sin rótulo): nada se
// esconde y nada gana un clic — lo único que desaparece es el cartel.
// Decisión de Ibrahin (18 ago 2026): «en el desplegable de Clientes hay como dos secciones, quiero
// una sola». Con este umbral solo Agenda se parte, que es donde se ganaba algo (6 ajustes de 8).
export const MIN_AJUSTES = 3;

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
