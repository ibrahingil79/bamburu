// ════════════════════════════════════════════════════════════════════════════
// CATÁLOGO ÚNICO DE ENTIDADES DE `activity_logs`.
//
// Por qué existe: la misma acción se registra desde DOS sitios —la pantalla del panel y la acción
// equivalente de DISA— y cada uno tecleaba el nombre de la entidad a mano. Divergieron en TODO:
//
//     pantalla        DISA
//     ────────        ──────────────
//     invoice         invoices
//     product         products
//     client          clients
//     supplier        suppliers
//     admin_user      admin_users
//
// Consecuencia: quien consulta el historial por entidad se deja fuera lo que hizo DISA. Se arregló
// primero para el traslado (constante compartida) y esto lo cierra para todo lo demás.
//
// REGLA: nadie escribe el literal. Se importa de aquí. Si el literal no está en un único sitio, dos
// sitios acabarán discrepando — no es una hipótesis, ya pasó con las cinco de arriba.
//
// CONVENCIÓN: **singular**, que es la que ya usaban las rutas del ERP (y son 19 entidades contra las
// 12 de DISA, así que mover a DISA era el cambio pequeño). El nombre describe la COSA tocada, no la
// tabla donde vive.
//
// LO QUE NO SE HACE: reescribir el histórico. Las filas viejas conservan su etiqueta (`invoices`,
// `products`, …). Un registro de actividad no se reescribe hacia atrás; se corrige de aquí en
// adelante. Ver `scripts/verify-actividad-etiquetas.mjs`.
// ════════════════════════════════════════════════════════════════════════════

export const ENTITY = {
  // Documentos de venta
  INVOICE:          'invoice',
  QUOTE:            'quote',
  CUSTOMER_ORDER:   'customer_order',
  DELIVERY_NOTE:    'delivery_note',
  OPPORTUNITY:      'opportunity',

  // Compras
  PURCHASE:         'purchase',
  PURCHASE_ORDER:   'purchase_order',
  PO_RECEIPT:       'po_receipt',
  SUPPLIER_INVOICE: 'supplier_invoice',
  SUPPLIER_RETURN:  'supplier_return',
  SUPPLIER:         'supplier',

  // Catálogo e inventario
  PRODUCT:          'product',
  PRODUCT_VARIANT:  'product_variant',
  PRODUCT_IMAGE:    'product_image',
  PRODUCT_TAG:      'product_tag',
  CATEGORY:         'category',
  TAG:              'tag',
  WAREHOUSE:        'warehouse',
  STOCK_MOVEMENT:   'stock_movement',
  STOCK_TRANSFER:   'stock_transfer',

  // Personas y configuración
  CLIENT:           'client',
  CLIENT_GROUP:     'client_group',
  ADMIN_USER:       'admin_user',
  COMPANY_CONFIG:   'company_config',
  DISCOUNT_CODE:    'discount_code',
  ATTACHMENT:       'attachment',
  PROJECT:          'proyecto',
  TIME_ENTRY:       'registro_tiempo',
};

// Tabla → entidad, para la vía GENÉRICA de DISA (`insert_record`/`update_record`/`delete_record`
// sobre WRITABLE_TABLES), que hoy registra el nombre crudo de la tabla. Debe cubrir TODAS las tablas
// escribibles: el gate falla si aparece una sin mapear, para que añadir una tabla obligue a decidir
// su etiqueta en vez de colar un plural por la puerta de atrás.
export const TABLE_TO_ENTITY = {
  // Las 8 tablas de WRITABLE_TABLES (la vía genérica de DISA). El gate falla si alguna falta.
  categories:       ENTITY.CATEGORY,
  tags:             ENTITY.TAG,
  product_tags:     ENTITY.PRODUCT_TAG,
  products:         ENTITY.PRODUCT,
  product_variants: ENTITY.PRODUCT_VARIANT,
  product_images:   ENTITY.PRODUCT_IMAGE,
  client_groups:    ENTITY.CLIENT_GROUP,
  suppliers:        ENTITY.SUPPLIER,
  // Tablas que hoy NO son escribibles por la vía genérica, pero que sí tienen entidad canónica. Se
  // mapean igualmente: si mañana alguien las añade a WRITABLE_TABLES, no se cuela un plural.
  clients:          ENTITY.CLIENT,
  invoices:         ENTITY.INVOICE,
  admin_users:      ENTITY.ADMIN_USER,
  discount_codes:   ENTITY.DISCOUNT_CODE,
  warehouses:       ENTITY.WAREHOUSE,
};

// Entidad de una tabla. Si algún día se añade una tabla escribible sin mapear, se devuelve su nombre
// crudo: se degrada al comportamiento de antes (una etiqueta fea) en vez de romper una escritura de
// DISA por una entrada que falta en un mapa. El gate lo caza antes de que llegue a producción.
export function entityForTable(table) {
  return TABLE_TO_ENTITY[table] || String(table || '');
}

// Todas las etiquetas válidas, para el desplegable del historial y para los gates.
export const ENTITY_VALUES = Object.freeze([...new Set(Object.values(ENTITY))].sort());
