import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { hashPasswordLegacy, BCRYPT_COST } from '../../core/auth.js';
import { backfillCodes } from './codes.js';
import { recomputeStock } from './stock.js';
import { ensureLedgerSchema } from './contabilidad.js';
import { ensureBienesSchema } from './contabilidad-bienes.js';

function addCol(db, table, col, def) {
  const cols = db.pragma(`table_info(${table})`).map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

export function runMigrations(db) {
  // Core
  db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);

  // D1 — ¿ya se archivó el clúster viejo de ventas + cuentas de tienda? Si sí, NO recrear esas
  // tablas (los CREATE de abajo van guardados con `if (!d1Archived)`), para que el rename → _archived
  // sea idempotente y no reaparezcan vacías. La migración de archivado (al final) pone este flag.
  const d1Archived = !!db.prepare('SELECT value FROM settings WHERE key=?').get('migration_d1_archive_store_2026_v1');
  // D2 — ¿ya se archivaron los restos e-commerce (feedback, product_reviews, newsletter_subscribers,
  // shipping_methods)? Si sí, NO recrearlos (CREATE guardados con `if (!d2Archived)`). NO incluye
  // tags/product_tags (función viva del catálogo) ni store_settings (se conserva, tienda Capa 2).
  const d2Archived = !!db.prepare('SELECT value FROM settings WHERE key=?').get('migration_d2_archive_ecommerce_2026_v1');
  // ENCARGO CUPONES (23 ago 2026) — ¿ya se archivaron los CUPONES (discount_codes, auto_discounts)? Si sí, NO
  // recrearlos (sus CREATE van guardados con `if (!bArchived)`), para que el rename → _archived sea
  // idempotente y no reaparezcan vacíos en el arranque siguiente. Mismo patrón que D1 y D2.
  const bArchived = !!db.prepare('SELECT value FROM settings WHERE key=?').get('migration_b_archive_discounts_2026_v1');

  // Admin users
  db.exec(`CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'employee',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Activity log
  db.exec(`CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    user_name TEXT DEFAULT 'Sistema',
    action TEXT NOT NULL,
    entity TEXT DEFAULT '',
    entity_id INTEGER,
    details TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Company config
  db.exec(`CREATE TABLE IF NOT EXISTS company_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    company_name TEXT DEFAULT 'Mi Empresa',
    fiscal_id TEXT DEFAULT '',
    tax_rate REAL DEFAULT 21.0,
    logo_url TEXT DEFAULT '',
    address TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    website TEXT DEFAULT ''
  )`);
  db.exec(`INSERT OR IGNORE INTO company_config (id) VALUES (1)`);
  addCol(db, 'company_config', 'logo_url', "TEXT DEFAULT ''");
  // ── C-0 (21 ago 2026) · EL LOGO DEJA DE SER UNA URL Y PASA A SER UN FICHERO NUESTRO ─────────────
  // `logo_url` era un campo de texto donde se pegaba una dirección de internet. Nunca se pintó en un
  // documento, y no podía pintarse: los PDF los genera Chromium EN EL SERVIDOR, así que un `<img
  // src="https://…">` habría hecho que cada factura disparara una petición saliente al host que
  // dijera quien editara ese campo. Ahora el logo es un ADJUNTO del propio negocio
  // (`kind='company_logo'`), se sirve desde aquí y se incrusta en el papel: cero peticiones fuera.
  // `logo_url` NO SE BORRA — la regla del proyecto es archivar, no destruir—: se queda con lo que
  // hubiera, sin leerse. Nadie tenía nada dentro (comprobado en los siete negocios), pero eso se
  // sabe hoy y no dentro de un año.
  addCol(db, 'company_config', 'company_logo_id', 'INTEGER');
  addCol(db, 'company_config', 'address', "TEXT DEFAULT ''");
  addCol(db, 'company_config', 'phone', "TEXT DEFAULT ''");
  addCol(db, 'company_config', 'email', "TEXT DEFAULT ''");
  addCol(db, 'company_config', 'website',         "TEXT DEFAULT ''");
  addCol(db, 'company_config', 'country',         "TEXT DEFAULT 'ES'");
  addCol(db, 'company_config', 'currency',        "TEXT DEFAULT 'EUR'");
  addCol(db, 'company_config', 'currency_symbol', "TEXT DEFAULT '€'");
  addCol(db, 'company_config', 'tax_name',        "TEXT DEFAULT 'IVA'");
  addCol(db, 'company_config', 'fiscal_id_label', "TEXT DEFAULT 'NIF/CIF'");
  addCol(db, 'company_config', 'document_name',   "TEXT DEFAULT 'Factura'");
  addCol(db, 'company_config', 'invoice_series',  "TEXT DEFAULT 'F'");
  // Retención de IRPF por defecto del negocio (% del autónomo). Precarga la factura
  // según el tipo de cliente; el dato legal es el de la factura. Default 0.
  addCol(db, 'company_config', 'irpf_default',    'REAL DEFAULT 0');
  // D5 — días tras el vencimiento a partir de los cuales DISA propone un recordatorio de impago.
  addCol(db, 'company_config', 'dias_recordatorio_impago', 'INTEGER DEFAULT 7');
  // D5b — días ANTES del vencimiento a partir de los cuales DISA propone registrar el pago a un
  // proveedor. Hermano del anterior, invertido en el tiempo: aquel mira hacia atrás (ya vencido),
  // este hacia delante (está a punto de vencer). Mismo defecto (7) y mismo sitio en Ajustes.
  addCol(db, 'company_config', 'dias_aviso_pago', 'INTEGER DEFAULT 7');

  // Store settings
  db.exec(`CREATE TABLE IF NOT EXISTS store_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    store_name TEXT DEFAULT 'Mi Tienda',
    tagline TEXT DEFAULT '',
    logo_url TEXT DEFAULT '',
    banner_url TEXT DEFAULT '',
    primary_color TEXT DEFAULT '#10b981',
    announcement TEXT DEFAULT '',
    facebook_url TEXT DEFAULT '',
    instagram_url TEXT DEFAULT '',
    twitter_url TEXT DEFAULT '',
    terms_html TEXT DEFAULT '',
    privacy_html TEXT DEFAULT '',
    returns_html TEXT DEFAULT '',
    seo_title TEXT DEFAULT '',
    seo_description TEXT DEFAULT ''
  )`);
  db.exec(`INSERT OR IGNORE INTO store_settings (id) VALUES (1)`);
  addCol(db, 'store_settings', 'theme', "TEXT DEFAULT 'minimal_light'");
  addCol(db, 'store_settings', 'homepage_sections', "TEXT DEFAULT NULL");

  // 2FA TOTP columns
  addCol(db, 'admin_users', 'totp_secret',  "TEXT DEFAULT NULL");
  addCol(db, 'admin_users', 'totp_enabled', "INTEGER DEFAULT 0");

  // Password reset tokens
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id)
    )
  `);

  // Settings defaults
  db.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('region', 'es-ES')`);

  // Tags
  db.exec(`CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Categories
  db.exec(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Client groups
  db.exec(`CREATE TABLE IF NOT EXISTS client_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    discount_pct REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Clients (extended)
  db.exec(`CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    fiscal_id TEXT DEFAULT '',
    email TEXT,
    phone TEXT DEFAULT '',
    address TEXT DEFAULT '',
    city TEXT DEFAULT '',
    country TEXT DEFAULT '',
    group_id INTEGER,
    notes TEXT DEFAULT '',
    total_spent REAL DEFAULT 0,
    accepts_newsletter INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES client_groups(id) ON DELETE SET NULL
  )`);
  addCol(db, 'clients', 'city', 'TEXT DEFAULT ""');
  addCol(db, 'clients', 'country', 'TEXT DEFAULT ""');
  addCol(db, 'clients', 'group_id', 'INTEGER');
  addCol(db, 'clients', 'notes', 'TEXT DEFAULT ""');
  addCol(db, 'clients', 'accepts_newsletter', 'INTEGER DEFAULT 0');
  addCol(db, 'clients', 'active', 'INTEGER DEFAULT 1');
  // T3 — datos de gestión del cliente (el cálculo de IRPF es de Ventas; aquí solo se guarda).
  // Defaults seguros: particular / 0 / contado / sin especificar → nunca aplica retención por sorpresa.
  addCol(db, 'clients', 'client_type', "TEXT DEFAULT 'particular'");   // particular | empresa
  addCol(db, 'clients', 'irpf_rate', 'REAL DEFAULT 0');                // % retención por defecto (0 si particular)
  addCol(db, 'clients', 'payment_term_days', 'INTEGER DEFAULT 0');     // plazo de pago en días (0 = contado)
  addCol(db, 'clients', 'payment_method', "TEXT DEFAULT ''");          // transferencia | efectivo | tarjeta | domiciliacion

  // T4 Paso 2 — perfil de cobro del cliente. Gobierna la cadencia de la próxima acción
  // (motor en cobros.js): suave | estandar | firme | manual. addCol rellena las filas
  // existentes con el DEFAULT 'estandar'; el UPDATE asegura que ningún NULL se cuele
  // (idempotente; nunca pisa un perfil ya elegido). Aditivo: no toca facturas ni cobros.
  addCol(db, 'clients', 'collections_profile', "TEXT DEFAULT 'estandar'");
  db.prepare("UPDATE clients SET collections_profile='estandar' WHERE collections_profile IS NULL OR collections_profile=''").run();

  // Products (extended)
  db.exec(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE,
    sku TEXT DEFAULT '',
    description TEXT DEFAULT '',
    price REAL NOT NULL DEFAULT 0,
    compare_price REAL DEFAULT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    image_url TEXT DEFAULT '',
    category_id INTEGER,
    status TEXT DEFAULT 'active',
    type TEXT DEFAULT 'physical',
    digital_file_url TEXT DEFAULT '',
    featured INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
  )`);
  addCol(db, 'products', 'slug', 'TEXT');
  addCol(db, 'products', 'description', 'TEXT DEFAULT ""');
  addCol(db, 'products', 'compare_price', 'REAL DEFAULT NULL');
  addCol(db, 'products', 'type', 'TEXT DEFAULT "physical"');
  addCol(db, 'products', 'digital_file_url', 'TEXT DEFAULT ""');
  addCol(db, 'products', 'featured', 'INTEGER DEFAULT 0');
  addCol(db, 'products', 'supplier_id', 'INTEGER DEFAULT NULL');

  // Pilar 3 (coste/valoración): coste medio ponderado del producto. CACHÉ DERIVADA del
  // libro stock_movements (igual que products.stock): nunca se escribe a mano, se recalcula
  // en recomputeStock. Las filas existentes quedan a 0 y el backfill de más abajo las
  // recalcula desde las entradas de compra.
  addCol(db, 'products', 'average_cost', 'REAL DEFAULT 0');

  // P1+P2: IVA propio por producto. Las filas existentes quedan con DEFAULT 21;
  // el backfill (una sola vez) las alinea al IVA por defecto del negocio por si
  // el tenant no usa 21. El tipo 'service' es solo un valor más de la columna
  // 'type' (texto libre) → no requiere migración: cero impacto en filas previas.
  addCol(db, 'products', 'tax_rate', 'REAL NOT NULL DEFAULT 21');
  const prodTaxMigKey = 'migration_products_tax_rate_2026_v1';
  if (!db.prepare('SELECT value FROM settings WHERE key=?').get(prodTaxMigKey)) {
    const cfg = db.prepare('SELECT tax_rate FROM company_config WHERE id=1').get();
    const defaultRate = cfg && cfg.tax_rate != null ? cfg.tax_rate : 21;
    db.prepare('UPDATE products SET tax_rate=?').run(defaultRate);
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(prodTaxMigKey, 'done');
  }

  // P1+P2 (refinamiento): IVA por BANDA legal en vez de número libre. El producto
  // guarda la banda (general/reducido/superreducido/exento) y el % se resuelve desde
  // core/vat-bands.js. Backfill (una vez) mapea los productos existentes por su tipo.
  addCol(db, 'products', 'tax_band', "TEXT NOT NULL DEFAULT 'general'");
  const prodBandMigKey = 'migration_products_tax_band_2026_v1';
  if (!db.prepare('SELECT value FROM settings WHERE key=?').get(prodBandMigKey)) {
    const upd = db.prepare('UPDATE products SET tax_band=? WHERE tax_rate=?');
    upd.run('general', 21);
    upd.run('reducido', 10);
    upd.run('superreducido', 4);
    upd.run('exento', 0);
    // Cualquier tipo fuera de las bandas legales ES → General (no se pierde nada).
    db.prepare("UPDATE products SET tax_band='general' WHERE tax_band NOT IN ('general','reducido','superreducido','exento')").run();
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(prodBandMigKey, 'done');
  }

  // Product images
  db.exec(`CREATE TABLE IF NOT EXISTS product_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    alt TEXT DEFAULT '',
    position INTEGER DEFAULT 0,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  )`);

  // Product tags
  db.exec(`CREATE TABLE IF NOT EXISTS product_tags (
    product_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (product_id, tag_id),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
  )`);

  // Product variants
  db.exec(`CREATE TABLE IF NOT EXISTS product_variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    option1_name TEXT DEFAULT '',
    option1_value TEXT DEFAULT '',
    option2_name TEXT DEFAULT '',
    option2_value TEXT DEFAULT '',
    sku TEXT DEFAULT '',
    price REAL DEFAULT NULL,
    stock INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  )`);

  // Product reviews — D2: no recrear si ya está archivada (reseñas desmontadas).
  if (!d2Archived) db.exec(`CREATE TABLE IF NOT EXISTS product_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    client_id INTEGER,
    customer_name TEXT DEFAULT '',
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    comment TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  )`);

  // Shipping methods — D2: no recrear si ya está archivada (envíos desmontados).
  if (!d2Archived) db.exec(`CREATE TABLE IF NOT EXISTS shipping_methods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    price REAL DEFAULT 0,
    free_from REAL DEFAULT NULL,
    estimated_days TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Discount codes — ENCARGO CUPONES: guardados por `bArchived` (ver el archivado al final del fichero).
  if (!bArchived) {
  db.exec(`CREATE TABLE IF NOT EXISTS discount_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    type TEXT DEFAULT 'percentage',
    value REAL NOT NULL,
    min_order REAL DEFAULT 0,
    max_uses INTEGER DEFAULT NULL,
    uses_count INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    expires_at DATETIME DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Auto discounts
  db.exec(`CREATE TABLE IF NOT EXISTS auto_discounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'percentage',
    value REAL NOT NULL,
    condition_type TEXT DEFAULT 'min_order',
    condition_value TEXT DEFAULT '0',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  }  // fin if(!bArchived) — cupones

  // Sales orders (extended)
  // D1 — clúster viejo de ventas (sales_orders / sales_items / order_status_history): NO recrear si ya
  // se archivó (si no, reaparecerían vacías tras el rename). La migración de archivado (al final) los renombra.
  if (!d1Archived) {
  db.exec(`CREATE TABLE IF NOT EXISTS sales_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT UNIQUE,
    client_id INTEGER,
    shipping_method_id INTEGER,
    discount_code_id INTEGER,
    subtotal REAL DEFAULT 0,
    shipping_cost REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    total REAL DEFAULT 0,
    status TEXT DEFAULT 'completed',
    source TEXT DEFAULT 'pos',
    customer_notes TEXT DEFAULT '',
    admin_notes TEXT DEFAULT '',
    tracking_number TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
  )`);
  addCol(db, 'sales_orders', 'shipping_method_id', 'INTEGER');
  addCol(db, 'sales_orders', 'discount_code_id', 'INTEGER');
  addCol(db, 'sales_orders', 'shipping_cost', 'REAL DEFAULT 0');
  addCol(db, 'sales_orders', 'discount_amount', 'REAL DEFAULT 0');
  addCol(db, 'sales_orders', 'source', 'TEXT DEFAULT "pos"');
  addCol(db, 'sales_orders', 'customer_notes', 'TEXT DEFAULT ""');
  addCol(db, 'sales_orders', 'admin_notes', 'TEXT DEFAULT ""');
  addCol(db, 'sales_orders', 'tracking_number', 'TEXT DEFAULT ""');

  // Sales items (extended)
  db.exec(`CREATE TABLE IF NOT EXISTS sales_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER,
    variant_id INTEGER,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    total REAL NOT NULL,
    FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE CASCADE
  )`);
  addCol(db, 'sales_items', 'variant_id', 'INTEGER');

  // Order status history
  db.exec(`CREATE TABLE IF NOT EXISTS order_status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    comment TEXT DEFAULT '',
    user_name TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE CASCADE
  )`);
  }  // fin if(!d1Archived) — clúster viejo de ventas

  // Refunds
  db.exec(`CREATE TABLE IF NOT EXISTS refunds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    reason TEXT DEFAULT '',
    status TEXT DEFAULT 'processed',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE CASCADE
  )`);

  // ── PILAR 3 · Paso 1 — Inventario unificado: libro de movimientos + caché ───
  // El stock es la SUMA de stock_movements (append-only). products.stock queda como
  // caché derivada. Multi-almacén preparado en datos (warehouse_id por movimiento) pero
  // la UI usa UN almacén por defecto. La tabla vieja `inventory_movements` se ARCHIVA
  // (renombrada a `_legacy`), no se borra (regla del incidente `services`).
  db.exec(`CREATE TABLE IF NOT EXISTS warehouses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    active INTEGER DEFAULT 1
  )`);
  if (!db.prepare('SELECT id FROM warehouses LIMIT 1').get()) {
    db.prepare("INSERT INTO warehouses (name, active) VALUES ('Almacén principal', 1)").run();
  }
  // Multi-almacén · Capa 1 — almacén por defecto EXPLÍCITO (is_default). addCol aditivo +
  // backfill de una sola vez (bandera en settings): marca is_default=1 en EXACTAMENTE el
  // almacén que defaultWarehouseId devolvía hasta hoy (el primer activo por id) y 0 en el
  // resto. Así el comportamiento es idéntico hasta que el usuario reasigne el principal a
  // mano. Idempotente: re-ejecutar no cambia nada (la bandera corta).
  addCol(db, 'warehouses', 'is_default', 'INTEGER DEFAULT 0');
  // Multi-almacén · Capa 2 — almacén elegido por operación (aditivo, NULL = principal,
  // resuelto por resolveWarehouseId → comportamiento idéntico a Capa 1 hasta que se elija).
  // admin_users ya existe aquí; purchases / purchase_order_receipts reciben su columna
  // JUNTO a la creación de su tabla (más abajo), no aquí.
  // No hay backfill: NULL ya cae al principal; los movimientos históricos no se tocan.
  addCol(db, 'admin_users', 'last_warehouse_id', 'INTEGER');   // último almacén usado en POS por ese usuario
  const whDefaultKey = 'migration_warehouse_default_2026_v1';
  if (!db.prepare('SELECT value FROM settings WHERE key=?').get(whDefaultKey)) {
    const def = db.prepare('SELECT id FROM warehouses WHERE active=1 ORDER BY id LIMIT 1').get();
    db.transaction(() => {
      db.prepare('UPDATE warehouses SET is_default=0').run();
      if (def) db.prepare('UPDATE warehouses SET is_default=1 WHERE id=?').run(def.id);
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(whDefaultKey, 'done');
    })();
  }

  db.exec(`CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    warehouse_id INTEGER NOT NULL,
    type TEXT NOT NULL,                 -- apertura|entrada|salida|ajuste|transferencia
    quantity INTEGER NOT NULL,          -- delta CON SIGNO (+ entra, − sale)
    reason TEXT,                        -- lista cerrada, solo en 'ajuste' (null en los demás)
    origin_type TEXT,                   -- opening|order|purchase|manual|reversal|legacy
    origin_id INTEGER,                  -- id del pedido/compra que lo originó (null si no aplica)
    reverses_movement_id INTEGER,       -- id del movimiento que revierte (null normal)
    note TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_movements_reverses ON stock_movements(reverses_movement_id)`);
  // Multi-almacén · Capa 1 — stock por almacén se calcula al vuelo sumando el libro por
  // (warehouse_id); este índice acelera ese GROUP BY. Aditivo, idempotente.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_movements_warehouse ON stock_movements(warehouse_id)`);
  // Pilar 3 (coste/valoración): coste unitario de las unidades de ESE movimiento. Entrada de
  // compra → coste de la línea; salidas, aperturas, legacy, ajustes y reversiones → NULL (que el
  // WAC trata como coste 0). Alimenta el coste medio ponderado (cache en products.average_cost).
  addCol(db, 'stock_movements', 'unit_cost', 'REAL');

  // ── TRAZABILIDAD POR LOTE / Nº DE SERIE (Pilar 3) ──────────────────────────────────────────────
  // Terreno nuevo, aditivo y SIN romper nada: un producto nace `tracking='none'` (sin traza) y todo
  // funciona EXACTAMENTE igual que hoy (lot_id NULL en sus movimientos). La traza solo entra cuando el
  // dueño marca un producto como 'lot' (lotes con caducidad) o 'serial' (unidades con nº de serie único).
  //
  // MODELO UNIFICADO: un lote y un nº de serie son lo mismo con distinta `kind` — una "unidad de traza"
  // (stock_lots) con un `code` (código de lote o nº de serie) único por producto. La serie es un lote de
  // capacidad 1: su saldo nunca pasa de 1 (invariante que guarda el motor). El SALDO por lote/almacén NO
  // se materializa: se deriva del libro sumando `quantity` por `lot_id` (+ `warehouse_id`), misma filosofía
  // que el stock por almacén. Así la traza NO añade una segunda fuente de verdad que pueda descuadrar.
  addCol(db, 'products', 'tracking', "TEXT NOT NULL DEFAULT 'none'");   // 'none' | 'lot' | 'serial'
  db.exec(`CREATE TABLE IF NOT EXISTS stock_lots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    code       TEXT NOT NULL,           -- código de LOTE o Nº DE SERIE
    kind       TEXT NOT NULL,           -- 'lot' | 'serial'
    expiry     TEXT,                    -- caducidad YYYY-MM-DD (opcional; NULL en serie o lote sin caducidad)
    created_at TEXT,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);
  // Un código/serie es único POR PRODUCTO: recibir el mismo lote otra vez reutiliza su fila (suma stock);
  // un nº de serie repetido es un error (no puede haber dos unidades con la misma serie) — lo aplica el motor.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_lots_product_code ON stock_lots(product_id, code)`);
  // El movimiento del libro apunta a su unidad de traza (NULL en productos sin traza, como hasta ahora).
  addCol(db, 'stock_movements', 'lot_id', 'INTEGER');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_movements_lot ON stock_movements(lot_id)`);

  // Migración de datos UNA vez: importa el libro viejo, siembra saldos iniciales y archiva.
  const stockMigKey = 'migration_stock_unify_2026_v1';
  if (!db.prepare('SELECT value FROM settings WHERE key=?').get(stockMigKey)) {
    const defWh = (db.prepare('SELECT id FROM warehouses WHERE active=1 ORDER BY id LIMIT 1').get() || {}).id;
    const hasLegacy = db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name='inventory_movements'").get().n;
    const migrate = db.transaction(() => {
      // 1) Importa inventory_movements → stock_movements (mapeo mecánico por type viejo).
      if (hasLegacy) {
        const legacy = db.prepare('SELECT * FROM inventory_movements ORDER BY id').all();
        const ins = db.prepare(
          `INSERT INTO stock_movements (product_id, warehouse_id, type, quantity, reason, origin_type, origin_id, reverses_movement_id, note, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`
        );
        for (const m of legacy) {
          const q = m.type === 'in' ? Math.abs(m.quantity)
                  : m.type === 'out' ? -Math.abs(m.quantity)
                  : m.quantity;                                   // 'adjust' viejo (no hay en datos): se conserva tal cual
          const newType = m.type === 'in' ? 'entrada' : m.type === 'out' ? 'salida' : 'ajuste';
          ins.run(m.product_id, defWh, newType, q, null, 'legacy', null, null, m.reason || '', m.created_at);
        }
        // 3) Archiva la tabla vieja (no se borra): renombra a _legacy.
        db.exec('ALTER TABLE inventory_movements RENAME TO inventory_movements_legacy');
      }
      // 2) Saldo inicial por producto físico: apertura = stock_heredado − SUMA(legacy importadas).
      //    Así SUMA(libro) == products.stock EXACTO el día 1. created_at sentinela (antes que todo).
      const physicals = db.prepare("SELECT id, stock FROM products WHERE type='physical'").all();
      const insOpen = db.prepare(
        `INSERT INTO stock_movements (product_id, warehouse_id, type, quantity, reason, origin_type, origin_id, reverses_movement_id, note, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      );
      for (const p of physicals) {
        const sum = db.prepare('SELECT COALESCE(SUM(quantity),0) s FROM stock_movements WHERE product_id=?').get(p.id).s;
        const baseline = (p.stock || 0) - sum;
        if (baseline !== 0) {
          insOpen.run(p.id, defWh, 'apertura', baseline, null, 'opening', null, null, 'Saldo inicial (migración)', '2000-01-01 00:00:00');
        }
      }
      // 4) products.stock pasa a caché derivada: recálculo de control (debe coincidir con el previo).
      for (const p of physicals) {
        const s = db.prepare('SELECT COALESCE(SUM(quantity),0) s FROM stock_movements WHERE product_id=?').get(p.id).s;
        db.prepare('UPDATE products SET stock=? WHERE id=?').run(s, p.id);
      }
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(stockMigKey, 'done');
    });
    migrate();
  }

  // Customer accounts (store login) — D1: no recrear si ya está archivada (tienda apagada).
  if (!d1Archived) db.exec(`CREATE TABLE IF NOT EXISTS customer_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER UNIQUE,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  )`);

  // Wishlist — D1: no recrear si ya está archivada (tienda apagada).
  if (!d1Archived) db.exec(`CREATE TABLE IF NOT EXISTS wishlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(customer_id, product_id),
    FOREIGN KEY (customer_id) REFERENCES customer_accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  )`);

  // Newsletter — D2: no recrear si ya está archivada (newsletter desmontado).
  if (!d2Archived) db.exec(`CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Sessions (SQLite-backed, replaces in-memory Maps)
  db.exec(`CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
  )`);

  // C5-bis — códigos de rescate del 2FA del DUEÑO. Espejo de superadmin_recovery_codes
  // (core/control-db.js), pero por negocio: aquella vive en control.db con superadmin_id; esta, en
  // la BD de cada tenant con admin_user_id. No se comparte tabla porque no se comparte base.
  //
  // Existen para que perder el móvil no sea perder el negocio. Hasta ahora el dueño podía activar el
  // 2FA y quedarse fuera para siempre: la única salida era que alguien entrara por SSH.
  //
  // Hasheados (bcrypt), como una contraseña: quien lea esta tabla no entra con lo que ve. `used_at`
  // en vez de borrar la fila — un código gastado deja rastro de CUÁNDO, que es justo lo que querrías
  // saber si un día se gasta uno que tú no usaste. Aditiva e idempotente.
  db.exec(`CREATE TABLE IF NOT EXISTS admin_recovery_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user_id INTEGER NOT NULL,
    code_hash TEXT NOT NULL,
    used_at INTEGER DEFAULT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_admin_recovery_owner ON admin_recovery_codes (admin_user_id, used_at)');

  if (!d1Archived) db.exec(`CREATE TABLE IF NOT EXISTS customer_sessions (
    token TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (account_id) REFERENCES customer_accounts(id) ON DELETE CASCADE
  )`);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at)`);
  if (!d1Archived) db.exec(`CREATE INDEX IF NOT EXISTS idx_customer_sessions_expires ON customer_sessions(expires_at)`);

  addCol(db, 'admin_sessions', 'csrf_token', 'TEXT');

  const csrfMigKey = 'migration_csrf_tokens_2026_v1';
  if (!db.prepare('SELECT value FROM settings WHERE key=?').get(csrfMigKey)) {
    const sessions = db.prepare('SELECT token FROM admin_sessions WHERE csrf_token IS NULL').all();
    const upd = db.prepare('UPDATE admin_sessions SET csrf_token=? WHERE token=?');
    for (const s of sessions) {
      upd.run(randomBytes(16).toString('base64url'), s.token);
    }
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(csrfMigKey, 'done');
  }

  addCol(db, 'admin_users', 'must_change_password', 'INTEGER DEFAULT 0');

  const migKey = 'migration_force_password_change_2026_v1';
  const already = db.prepare('SELECT value FROM settings WHERE key=?').get(migKey);
  if (!already) {
    db.prepare('UPDATE admin_users SET must_change_password=1').run();
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(migKey, 'done');
  }

  // Seed default admin if none exists
  const adminCount = db.prepare('SELECT COUNT(*) as c FROM admin_users').get().c;
  if (adminCount === 0) {
    const pwd = randomBytes(12).toString('base64url');
    const hash = bcrypt.hashSync(pwd, BCRYPT_COST);   // el coste vive en un solo sitio (core/auth.js)
    db.prepare('INSERT INTO admin_users (name, email, password_hash, role, must_change_password) VALUES (?,?,?,?,?)')
      .run('Administrador', 'admin@bamburu.com', hash, 'owner', 1);
    // C6/B1 — la contraseña NO se imprime. Este bloque corre en CADA alta de negocio (la BD nace
    // vacía → adminCount === 0), así que imprimía una credencial en el journal por cada cliente
    // nuevo. Era el anti-patrón exacto de los dos incidentes previos, repetido en bucle.
    //
    // Y no hace falta que nadie la lea: el provisioning BORRA esta cuenta acto seguido
    // (core/tenant-provisioning.js) y crea al dueño real. Existe solo para que la BD no quede sin
    // owner si alguien migra a mano. Si algún día hay que entrar por ella, se le pone contraseña
    // con `node scripts/reset-admin.js admin@bamburu.com` — que la pide por teclado y no la imprime.
    console.log('[Migraciones] BD sin admin: creada la cuenta semilla admin@bamburu.com '
      + '(contraseña aleatoria NO impresa; el alta la sustituye por el dueño real).');
  }

  // Migrate old users table if exists
  try {
    const oldUsers = db.prepare('SELECT * FROM users').all();
    for (const u of oldUsers) {
      try {
        db.prepare('INSERT OR IGNORE INTO admin_users (name, email, password_hash, role) VALUES (?,?,?,?)')
          .run(u.name, u.email, u.password_hash, u.role || 'employee');
      } catch (_) {}
    }
  } catch (_) {}

  // Suppliers
  db.exec(`CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact TEXT DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // Saneamiento de Proveedor (espejo del T1 de Clientes): datos fiscales para documentos
  // de compra + soft-delete. Aditivo por tenant; filas antiguas → activo, NIF/dirección ''.
  addCol(db, 'suppliers', 'fiscal_id', "TEXT DEFAULT ''");   // NIF/CIF (guarda de duplicados)
  addCol(db, 'suppliers', 'address',   "TEXT DEFAULT ''");
  addCol(db, 'suppliers', 'city',      "TEXT DEFAULT ''");
  addCol(db, 'suppliers', 'active',    'INTEGER DEFAULT 1'); // archivar en vez de borrar
  db.prepare('UPDATE suppliers SET active=1 WHERE active IS NULL').run();
  // Capa de dinero (a) — datos de gestión del proveedor, espejo del T3 de clients:
  // plazo de pago (fija el vencimiento de la factura recibida) y forma de pago. Aditivo;
  // filas antiguas → 0 / ''. NO se añaden datos bancarios/IBAN aquí (queda en cola).
  addCol(db, 'suppliers', 'payment_term_days', 'INTEGER DEFAULT 0');   // plazo de pago en días (0 = contado)
  addCol(db, 'suppliers', 'payment_method',    "TEXT DEFAULT ''");     // transferencia | efectivo | tarjeta | domiciliacion
  db.prepare('UPDATE suppliers SET payment_term_days=0 WHERE payment_term_days IS NULL').run();
  db.prepare("UPDATE suppliers SET payment_method='' WHERE payment_method IS NULL").run();

  // ── Código interno autogenerado (cliente / proveedor / producto) ────────────
  // Identificación interna CLI-/PROV-/PROD-NNNN (no es guarda de duplicados). Contador por
  // tipo y por tenant (code_counters). Backfill idempotente a las filas existentes en orden
  // de creación; aditivo (addCol), nunca destructivo. (clients/products/suppliers ya creadas.)
  db.exec(`CREATE TABLE IF NOT EXISTS code_counters (
    entity TEXT PRIMARY KEY,
    last_seq INTEGER NOT NULL DEFAULT 0
  )`);
  addCol(db, 'clients',   'client_code',   'TEXT');
  addCol(db, 'suppliers', 'supplier_code', 'TEXT');
  addCol(db, 'products',  'product_code',  'TEXT');
  backfillCodes(db, { table: 'clients',   column: 'client_code',   entity: 'client' });
  backfillCodes(db, { table: 'suppliers', column: 'supplier_code', entity: 'supplier' });
  backfillCodes(db, { table: 'products',  column: 'product_code',  entity: 'product' });

  // Purchases
  db.exec(`CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL,
    reference TEXT DEFAULT '',
    date DATE NOT NULL,
    notes TEXT DEFAULT '',
    status TEXT DEFAULT 'received' CHECK(status IN ('pending','received','cancelled')),
    total REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
  )`);

  // Purchase items
  db.exec(`CREATE TABLE IF NOT EXISTS purchase_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    unit_cost REAL NOT NULL CHECK(unit_cost >= 0),
    FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);

  // Motor de Compras: archivar (no borrar) las compras rotas heredadas (sin líneas en
  // purchase_items) para que no ensucien el listado. Aditivo (addCol). Una vez por tenant.
  addCol(db, 'purchases', 'archived', 'INTEGER DEFAULT 0');
  addCol(db, 'purchases', 'warehouse_id', 'INTEGER');   // Capa 2: almacén de destino de la compra directa (NULL = principal)
  const purgeKey = 'migration_purchases_archive_broken_2026_v1';
  if (!db.prepare('SELECT value FROM settings WHERE key=?').get(purgeKey)) {
    db.prepare(`UPDATE purchases SET archived=1
                WHERE id NOT IN (SELECT DISTINCT purchase_id FROM purchase_items)`).run();
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(purgeKey, 'done');
  }

  // C1.a — Orden de compra: PEDIDO al proveedor con numeración y documento propios.
  // NO toca inventario ni coste (las recepciones contra la orden son C1.b). La compra
  // directa (purchases) se conserva intacta como flujo paralelo. order_number es NULL
  // en borrador y gana OC-NNNN (code_counters) al enviar: el borrador no consume número.
  db.exec(`CREATE TABLE IF NOT EXISTS purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT,
    supplier_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'borrador' CHECK(status IN ('borrador','enviada','anulada')),
    date DATE NOT NULL,
    expected_date DATE,
    notes TEXT DEFAULT '',
    replaces_order_id INTEGER,
    anulada_motivo TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
    FOREIGN KEY (replaces_order_id) REFERENCES purchase_orders(id)
  )`);
  // Foto congelada de emisor y proveedor, copiada AL ENVIAR (mismo patrón que la
  // factura al emitir): NULL en borrador; la orden enviada/anulada muestra los datos
  // del momento del envío aunque luego cambien Ajustes o la ficha del proveedor.
  addCol(db, 'purchase_orders', 'company_name',       'TEXT');
  addCol(db, 'purchase_orders', 'company_fiscal_id',  'TEXT');
  addCol(db, 'purchase_orders', 'company_address',    'TEXT');
  addCol(db, 'purchase_orders', 'company_phone',      'TEXT');
  addCol(db, 'purchase_orders', 'supplier_name',      'TEXT');
  addCol(db, 'purchase_orders', 'supplier_fiscal_id', 'TEXT');
  addCol(db, 'purchase_orders', 'supplier_address',   'TEXT');

  // unit_cost es NETO (sin IVA); tax_rate se resuelve desde la banda del producto al
  // guardar la línea (igual que la factura) y es SOLO para el documento.
  db.exec(`CREATE TABLE IF NOT EXISTS purchase_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    unit_cost REAL NOT NULL CHECK(unit_cost >= 0),
    tax_rate REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);

  // C1.b — Recepciones contra la orden: una orden ENVIADA se recibe en varias veces.
  // Cada recepción es un documento propio e INMUTABLE (corregir = anular con motivo y
  // crear otra; anular revierte su stock con movimientos inversos, nunca borrando).
  // El estado de recepción de la orden NO puede vivir en purchase_orders.status: el
  // CHECK (borrador|enviada|anulada) está horneado en la tabla de los tenants ya
  // creados y reescribirlo exigiría reconstruir la tabla. Columna ADITIVA
  // received_status (NULL=sin recepciones | 'parcial' | 'recibida'), mantenida
  // automáticamente al confirmar/anular recepciones; status no cambia de significado.
  db.exec(`CREATE TABLE IF NOT EXISTS purchase_order_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    receipt_number TEXT,
    date DATE NOT NULL,
    notes TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'confirmada' CHECK(status IN ('confirmada','anulada')),
    anulada_motivo TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES purchase_orders(id)
  )`);
  // unit_cost = coste unitario NETO REALMENTE recibido (precargado de la línea de la
  // orden, editable antes de confirmar): es el que entra al libro y fija el WAC.
  db.exec(`CREATE TABLE IF NOT EXISTS purchase_order_receipt_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_id INTEGER NOT NULL,
    order_item_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    unit_cost REAL NOT NULL CHECK(unit_cost >= 0),
    FOREIGN KEY (receipt_id) REFERENCES purchase_order_receipts(id) ON DELETE CASCADE,
    FOREIGN KEY (order_item_id) REFERENCES purchase_order_items(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_po_receipts_order ON purchase_order_receipts(order_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_po_receipt_items_receipt ON purchase_order_receipt_items(receipt_id)`);
  addCol(db, 'purchase_order_receipts', 'warehouse_id', 'INTEGER');   // Capa 2: almacén de ESA recepción (NULL = principal)

  // Devolución a proveedor: SOLO la capa física (sale el stock + documento inmutable).
  // La capa del dinero (lo que el proveedor abona / cuentas con proveedores) es tarea
  // FUTURA y NO vive aquí. Una devolución siempre nace de un documento de origen que ya
  // movió stock: una compra directa RECIBIDA ('purchase') o una recepción CONFIRMADA
  // ('po_receipt'). supplier_name/supplier_fiscal_id son la FOTO CONGELADA del proveedor
  // al confirmar (resueltos del origen — mismo patrón que la factura/orden). return_number
  // (DEV-NNNN, code_counters) se asigna al confirmar; no hay borrador. Documento INMUTABLE:
  // corregir = anular (con motivo) y crear otra; nada se borra.
  db.exec(`CREATE TABLE IF NOT EXISTS supplier_returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    origin_type TEXT NOT NULL CHECK(origin_type IN ('purchase','po_receipt')),
    origin_id INTEGER NOT NULL,
    supplier_id INTEGER NOT NULL,
    supplier_name TEXT,                 -- foto congelada al confirmar (del origen)
    supplier_fiscal_id TEXT,            -- foto congelada al confirmar (del origen)
    return_number TEXT,
    date DATE NOT NULL,
    motivo TEXT NOT NULL,
    notes TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'confirmada' CHECK(status IN ('confirmada','anulada')),
    anulada_motivo TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
  )`);
  // unit_cost = coste de la línea de ORIGEN (copiado al confirmar). Es SOLO para el VALOR
  // del documento ("te deben X €"): al confirmar la salida va al libro con coste NULL (una
  // salida no toca el WAC de lo que queda). Al ANULAR, la re-entrada usa ESTE coste (no
  // NULL) para recomponer el WAC sin hundirlo a 0.
  db.exec(`CREATE TABLE IF NOT EXISTS supplier_return_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    return_id INTEGER NOT NULL,
    origin_item_id INTEGER NOT NULL,    -- línea de purchase_items / purchase_order_receipt_items de origen
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    unit_cost REAL NOT NULL CHECK(unit_cost >= 0),
    FOREIGN KEY (return_id) REFERENCES supplier_returns(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_supplier_returns_origin ON supplier_returns(origin_type, origin_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_supplier_returns_supplier ON supplier_returns(supplier_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_supplier_return_items_return ON supplier_return_items(return_id)`);

  // ── Multi-almacén · Capa 3 — TRASLADOS entre almacenes ────────────────────────
  // Mueve mercancía de un almacén a otro en un solo gesto: por cada línea, una salida
  // del ORIGEN (coste NULL: una salida no toca el WAC) + una entrada en el DESTINO con el
  // WAC GLOBAL congelado (vuelve a entrar el mismo valor que salió). Resultado: cantidad
  // total y WAC global del producto SIN CAMBIO; solo se redistribuye entre almacenes.
  // from/to_warehouse_name son la FOTO CONGELADA del almacén al confirmar (mismo patrón que
  // supplier_name en las devoluciones). transfer_number (TR-NNNN, code_counters) se asigna al
  // confirmar; no hay borrador ni estado "en tránsito" (Capa 3 es instantánea). Documento
  // INMUTABLE: corregir = anular (con motivo) y crear otro; nada se borra.
  db.exec(`CREATE TABLE IF NOT EXISTS stock_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_number TEXT,
    from_warehouse_id INTEGER NOT NULL,
    from_warehouse_name TEXT,           -- foto congelada al confirmar
    to_warehouse_id INTEGER NOT NULL,
    to_warehouse_name TEXT,             -- foto congelada al confirmar
    date DATE NOT NULL,
    notes TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'confirmada' CHECK(status IN ('confirmada','anulada')),
    anulada_motivo TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (from_warehouse_id) REFERENCES warehouses(id),
    FOREIGN KEY (to_warehouse_id) REFERENCES warehouses(id)
  )`);
  // unit_cost = WAC GLOBAL del producto congelado al confirmar. Es el coste con el que la
  // entrada en el DESTINO recompone el valor (y, al anular, la re-entrada en el ORIGEN).
  // Congelarlo (en vez de leer el WAC en vivo) es lo que mantiene la neutralidad aunque el
  // traslado vacíe el stock global a 0 a mitad (el medio se resetea y este coste lo recompone).
  db.exec(`CREATE TABLE IF NOT EXISTS stock_transfer_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    unit_cost REAL NOT NULL CHECK(unit_cost >= 0),
    FOREIGN KEY (transfer_id) REFERENCES stock_transfers(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_transfers_from ON stock_transfers(from_warehouse_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_transfers_to ON stock_transfers(to_warehouse_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_transfer ON stock_transfer_items(transfer_id)`);

  addCol(db, 'purchase_orders', 'received_status', 'TEXT');
  // C1.c — cierre manual con pendiente: received_status gana el valor TERMINAL
  // 'cerrada_manual' (la columna es TEXT sin CHECK → ampliar valores es aditivo)
  // y el motivo obligatorio se guarda aparte. Cerrar no mueve stock ni borra nada.
  addCol(db, 'purchase_orders', 'cerrada_motivo', 'TEXT');

  // C2 — Adjuntos (documentos origen subidos por el usuario: foto/PDF de factura de
  // proveedor). El binario vive FUERA del repo (data/uploads/<tenant>/), aquí solo el
  // metadato. entity_type/entity_id quedan NULL hasta que la captura aterriza en una
  // recepción ('po_receipt') o una compra directa ('purchase'). Aditiva. Nada se borra:
  // un adjunto se conserva aunque su documento se anule.
  db.exec(`CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'supplier_invoice',
    original_name TEXT DEFAULT '',
    path TEXT NOT NULL,
    mime TEXT DEFAULT '',
    size INTEGER DEFAULT 0,
    entity_type TEXT,
    entity_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id)`);
  // Captura DENTRO del chat de DISA (Pilar 3): se guarda la LECTURA CRUDA del modelo
  // (el `extracted`) junto al adjunto, para precargar la pantalla de revisión sin volver
  // a llamar al modelo. NULL en adjuntos previos / subidas que no extraen. Aditiva.
  addCol(db, 'attachments', 'extraction_json', 'TEXT');

  // ════════════════════════════════════════════════════════════════════════════
  // CAPA DE DINERO CON PROVEEDORES · Paso (a) — DEUDA de compras de stock.
  // Espejo de Cobros (invoice_payments + invoices.due_date) del lado proveedor.
  // La deuda NO cuelga del coste de la mercancía: cuelga de la FACTURA DEL PROVEEDOR
  // como documento propio, porque lo que se paga es el TOTAL CON IVA (que la captura
  // C2 calcula y hoy se descartaba). Por eso "factura recibida" es una entidad nueva.
  // NO toca la cadena de hash ni el Verifactu (la factura del proveedor no es emisión
  // nuestra). NO toca la capa física (stock/WAC): solo LEE importes.
  // ════════════════════════════════════════════════════════════════════════════
  // Factura recibida (documento INMUTABLE). Nace AUTO desde la captura C2 (con los
  // importes reales) o MANUAL (mercancía antes que factura), SIEMPRE enlazada a un
  // documento de stock de origen (po_receipt | purchase). internal_code FRP-NNNN
  // (code_counters) al crear, no editable. supplier_invoice_number = el número del
  // proveedor (texto libre, puede repetir entre proveedores; guarda de duplicado por
  // proveedor+número). total = CON IVA = lo que se debe. status vigente|anulada;
  // corregir = anular (motivo) + crear otra, nunca editar/borrar. Snapshot del
  // proveedor congelado al crear (mismo patrón que la orden/devolución).
  db.exec(`CREATE TABLE IF NOT EXISTS supplier_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL,
    internal_code TEXT,
    supplier_invoice_number TEXT DEFAULT '',
    invoice_date DATE NOT NULL,
    due_date DATE,
    base REAL NOT NULL DEFAULT 0,
    tax REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'vigente' CHECK(status IN ('vigente','anulada')),
    anulada_motivo TEXT,
    supplier_name TEXT,                 -- foto congelada al crear
    supplier_fiscal_id TEXT,            -- foto congelada al crear
    supplier_address TEXT,              -- foto congelada al crear
    entity_type TEXT,                   -- 'po_receipt' | 'purchase' (documento de stock de origen)
    entity_id INTEGER,
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_supplier_invoices_supplier ON supplier_invoices(supplier_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_supplier_invoices_entity ON supplier_invoices(entity_type, entity_id)`);

  // Pagos a proveedor (totales o parciales) de una factura recibida. Espejo EXACTO de
  // invoice_payments. El ESTADO de pago NO se guarda: se calcula en vivo (pagos.js)
  // desde la suma de pagos y due_date, para que nunca quede viejo.
  db.exec(`CREATE TABLE IF NOT EXISTS supplier_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_invoice_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    paid_date DATE NOT NULL,
    payment_method TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_invoice_id) REFERENCES supplier_invoices(id) ON DELETE CASCADE
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_supplier_payments_invoice ON supplier_payments(supplier_invoice_id)`);

  // ── Paso (b) — FACTURAS DE GASTO PURO (gestoría, alquiler, software, banca…) ──
  // Una factura de gasto NO trae mercancía ni producto de catálogo: entity_type/entity_id
  // quedan NULL (ya eran opcionales en el paso a). Lleva LÍNEAS con concepto libre + base +
  // tipo de IVA, para capturar el desglose de IVA soportado por tipo (materia prima del gasto
  // deducible del autónomo; aquí NO se construye ningún informe fiscal, solo se captura el dato).
  // Las facturas CON origen de stock del paso (a) NO llevan líneas y NO se tocan: sus
  // base/tax/total siguen viniendo del documento de mercancía. Tabla OPCIONAL: aditiva.
  db.exec(`CREATE TABLE IF NOT EXISTS supplier_invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_invoice_id INTEGER NOT NULL,
    concepto TEXT NOT NULL DEFAULT '',
    base REAL NOT NULL DEFAULT 0,
    tax_rate REAL NOT NULL DEFAULT 0,        -- banda legal: 21/10/4/0 (0 = exento)
    cuota REAL NOT NULL DEFAULT 0,           -- = base * tax_rate / 100
    FOREIGN KEY (supplier_invoice_id) REFERENCES supplier_invoices(id) ON DELETE CASCADE
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_supplier_invoice_items_invoice ON supplier_invoice_items(supplier_invoice_id)`);
  // Categoría de gasto (lista cerrada definida en código). NULL en las facturas de stock.
  addCol(db, 'supplier_invoices', 'expense_category', 'TEXT');

  // ── Paso (d) — MOTOR PROACTIVO DE AVISOS: registro de envío del resumen diario ──
  // Idempotencia del email diario por tenant: una fila por día (fecha = PK). El proceso
  // programado (scripts/bamburu-avisos.mjs) consulta esta tabla antes de enviar: si ya hay
  // fila para hoy, NO reenvía (evita duplicar el correo en una segunda ejecución del timer
  // por Persistent/reintento). Solo deja rastro cuando de verdad se envió algo.
  db.exec(`CREATE TABLE IF NOT EXISTS daily_alert_log (
    fecha DATE PRIMARY KEY,                  -- AAAA-MM-DD del envío (uno por día)
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    canal TEXT DEFAULT 'email',
    avisos INTEGER NOT NULL DEFAULT 0        -- cuántos avisos llevaba el resumen
  )`);
  // Estado VISTO/NUEVO del badge de avisos (Opción C). Singleton (id=1): la HUELLA de los
  // avisos ya vistos = conjunto de claves (factura en aviso / producto en stock bajo). El
  // badge vuelve a ROJO solo si aparece una clave NUEVA respecto a esta huella; que un aviso
  // ya visto empeore NO reactiva el rojo (misma clave). Aditiva, no destructiva.
  db.exec(`CREATE TABLE IF NOT EXISTS alert_seen (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    fingerprint TEXT NOT NULL DEFAULT '[]',  -- JSON: lista de claves de avisos vistas
    seen_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // ── "Visto" POR USUARIO, no por negocio ──────────────────────────────────────────
  // alert_seen nació singleton (CHECK id=1): si el dueño abría los avisos, quedaban vistos
  // TAMBIÉN para el empleado. "Visto" es un hecho de una persona. Como el CHECK impide meter
  // más de una fila, la columna user_id no cabe en la tabla vieja: se añade en una tabla nueva.
  // ADITIVO Y REVERSIBLE: alert_seen NO se toca ni se borra (regla permanente); revertir el
  // código restaura el comportamiento anterior con su huella intacta.
  db.exec(`CREATE TABLE IF NOT EXISTS alert_seen_user (
    user_id INTEGER PRIMARY KEY,             -- admin_users.id (0 = procesos sin sesión)
    fingerprint TEXT NOT NULL DEFAULT '[]',  -- JSON: lista de claves de avisos vistas por ESE usuario
    seen_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // Siembra ÚNICA: la huella del negocio pasa a ser el punto de partida de cada usuario que ya
  // existía, para que nadie vea el badge en rojo de golpe por avisos que ya había leído. Los
  // usuarios creados DESPUÉS no se siembran: empiezan con la huella vacía (todo es nuevo para
  // ellos), que es justo lo correcto.
  const seenMigKey = 'migration_alert_seen_per_user_v1';
  if (!db.prepare('SELECT value FROM settings WHERE key=?').get(seenMigKey)) {
    try {
      const legacy = db.prepare('SELECT fingerprint FROM alert_seen WHERE id=1').get();
      if (legacy && legacy.fingerprint) {
        const ins = db.prepare('INSERT OR IGNORE INTO alert_seen_user (user_id, fingerprint) VALUES (?,?)');
        db.transaction(() => {
          for (const u of db.prepare('SELECT id FROM admin_users').all()) ins.run(u.id, legacy.fingerprint);
        })();
      }
    } catch { /* tenant sin admin_users todavía: nada que sembrar */ }
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(seenMigKey, 'done');
  }

  // Pilar 3 (coste/valoración) — backfill del coste, UNA vez por tenant. Corre DESPUÉS de que
  // existan las columnas nuevas (stock_movements.unit_cost, products.average_cost) y la tabla
  // purchase_items. Las compras ya guardadas NO se tocan (purchase_items.unit_cost es inmutable):
  // solo se RELLENA el coste de los movimientos de entrada de compra y se recalcula la caché.
  const costMigKey = 'migration_inventory_cost_2026_v1';
  if (!db.prepare('SELECT value FROM settings WHERE key=?').get(costMigKey)) {
    const backfill = db.transaction(() => {
      // 1) Entradas de compra sin coste → coste de purchase_items cruzando por (compra, producto).
      //    Si hay varias líneas del mismo producto en la misma compra: media ponderada por cantidad.
      const entradas = db.prepare(
        "SELECT id, product_id, origin_id FROM stock_movements WHERE type='entrada' AND origin_type='purchase' AND unit_cost IS NULL AND origin_id IS NOT NULL"
      ).all();
      const lineCost = db.prepare(
        'SELECT SUM(quantity*unit_cost) AS num, SUM(quantity) AS den FROM purchase_items WHERE purchase_id=? AND product_id=?'
      );
      const setCost = db.prepare('UPDATE stock_movements SET unit_cost=? WHERE id=?');
      for (const mv of entradas) {
        const r = lineCost.get(mv.origin_id, mv.product_id);
        if (r && r.den) setCost.run(r.num / r.den, mv.id);   // sin líneas que casen → se queda NULL (coste 0)
      }
      // 2) Recalcula la caché (stock + average_cost) de TODOS los productos desde el libro.
      for (const p of db.prepare('SELECT id FROM products').all()) recomputeStock(db, p.id);
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(costMigKey, 'done');
    });
    backfill();
  }

  // Feedback — D2: no recrear si ya está archivada (buzón desmontado).
  if (!d2Archived) db.exec(`CREATE TABLE IF NOT EXISTS feedback (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    rating     INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    message    TEXT NOT NULL,
    page       TEXT DEFAULT '',
    user_name  TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Invoices
  db.exec(`CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT UNIQUE NOT NULL,
    order_id INTEGER,
    client_id INTEGER,
    series TEXT DEFAULT 'F',
    year INTEGER NOT NULL,
    sequence INTEGER NOT NULL,
    issue_date DATE NOT NULL,
    company_name TEXT NOT NULL,
    company_fiscal_id TEXT NOT NULL,
    company_address TEXT DEFAULT '',
    client_name TEXT DEFAULT '',
    client_fiscal_id TEXT DEFAULT '',
    client_address TEXT DEFAULT '',
    client_email TEXT DEFAULT '',
    subtotal REAL NOT NULL DEFAULT 0,
    tax_rate REAL NOT NULL DEFAULT 21,
    tax_name TEXT NOT NULL DEFAULT 'IVA',
    tax_amount REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    currency TEXT DEFAULT 'EUR',
    currency_symbol TEXT DEFAULT '€',
    document_name TEXT DEFAULT 'Factura',
    verifactu_hash TEXT DEFAULT '',
    prev_hash TEXT DEFAULT '',
    status TEXT DEFAULT 'emitida' CHECK(status IN ('emitida','rectificada','anulada')),
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES sales_orders(id),
    FOREIGN KEY (client_id) REFERENCES clients(id)
  )`);

  // A1: migración idempotente — hace nullable invoices.order_id en tenants antiguos.
  // SQLite no soporta DROP NOT NULL directamente; hay que recrear la tabla.
  {
    const cols = db.prepare("PRAGMA table_info(invoices)").all();
    const orderIdCol = cols.find(c => c.name === 'order_id');
    if (orderIdCol && orderIdCol.notnull === 1) {
      db.exec("PRAGMA foreign_keys = OFF");
      db.exec("BEGIN");
      try {
        db.exec(`CREATE TABLE invoices_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          invoice_number TEXT UNIQUE NOT NULL,
          order_id INTEGER,
          client_id INTEGER,
          series TEXT DEFAULT 'F',
          year INTEGER NOT NULL,
          sequence INTEGER NOT NULL,
          issue_date DATE NOT NULL,
          company_name TEXT NOT NULL,
          company_fiscal_id TEXT NOT NULL,
          company_address TEXT DEFAULT '',
          client_name TEXT DEFAULT '',
          client_fiscal_id TEXT DEFAULT '',
          client_address TEXT DEFAULT '',
          client_email TEXT DEFAULT '',
          subtotal REAL NOT NULL DEFAULT 0,
          tax_rate REAL NOT NULL DEFAULT 21,
          tax_name TEXT NOT NULL DEFAULT 'IVA',
          tax_amount REAL NOT NULL DEFAULT 0,
          total REAL NOT NULL DEFAULT 0,
          currency TEXT DEFAULT 'EUR',
          currency_symbol TEXT DEFAULT '€',
          document_name TEXT DEFAULT 'Factura',
          verifactu_hash TEXT DEFAULT '',
          prev_hash TEXT DEFAULT '',
          status TEXT DEFAULT 'emitida' CHECK(status IN ('emitida','rectificada','anulada')),
          notes TEXT DEFAULT '',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (order_id) REFERENCES sales_orders(id),
          FOREIGN KEY (client_id) REFERENCES clients(id)
        )`);
        db.exec("INSERT INTO invoices_new SELECT * FROM invoices");
        db.exec("DROP TABLE invoices");
        db.exec("ALTER TABLE invoices_new RENAME TO invoices");
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      } finally {
        db.exec("PRAGMA foreign_keys = ON");
      }
    }
  }

  db.exec(`CREATE TABLE IF NOT EXISTS invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL DEFAULT 0,
    total_price REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
  )`);

  // A2: IVA por línea + IRPF global. Columnas con DEFAULT 0 → cero regresión:
  // facturas viejas tienen invoice_items.tax_rate=0 pero invoices.tax_amount
  // global intacto, así que la vista imprimible sigue cuadrando.
  addCol(db, 'invoice_items', 'tax_rate',   'REAL NOT NULL DEFAULT 0');
  addCol(db, 'invoice_items', 'tax_amount', 'REAL NOT NULL DEFAULT 0');

  // ── ESCALERA · PASO 4a — CONSTRUCTOR DE ANALÍTICAS: los paneles guardados (aditivo) ───────────
  // De QUIEN LOS CREA (decisión del dueño, 17 jul 2026); compartir es el paso 4b.
  // `config` guarda la RECETA en JSON (qué dimensión, qué medidas, qué filtros, qué gráfico), **NO
  // los datos**. Es deliberado: al abrir el panel se vuelve a pasar por `cruzar()`, que revalida los
  // permisos de HOY. Si se guardaran los resultados, un panel sería una fuga con fecha — bastaría
  // perder un permiso y seguir viendo lo de antes tan tranquilo.
  db.exec(`CREATE TABLE IF NOT EXISTS analytics_panels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    config TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_analytics_panels_user ON analytics_panels(user_id)`);
  // ── FICHA D-ter · «MIS MEDIDAS» (aditiva, idempotente) ────────────────────────────────────────
  // Sustituye a la caja de fórmulas que había en la pantalla del constructor. Un dueño no escribe
  // expresiones: ELIGE de dos listas y una operación, y le pone nombre. Por eso aquí no se guarda
  // texto libre sino las TRES piezas (medida A, operación, medida B) más si se multiplica por cien.
  // Nada que compilar, nada que validar contra inyección: no hay expresión que interpretar.
  db.exec(`CREATE TABLE IF NOT EXISTS analytics_medidas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    area TEXT NOT NULL,
    nombre TEXT NOT NULL,
    medida_a TEXT NOT NULL,
    op TEXT NOT NULL DEFAULT '/',
    medida_b TEXT NOT NULL,
    por_cien INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_analytics_medidas_user ON analytics_medidas(user_id, area)`);
  // ── FICHA G2 · EL CANAL DE COMUNICACIONES DEL PORTAL (aditiva, idempotente) ────────────────────
  // Un hilo por cliente, sin asunto: es una conversación, no un buzón de tickets. `autor` dice de
  // qué lado viene ('negocio' | 'cliente') y es lo único que decide quién lo escribió — el cliente
  // entra por token, no tiene usuario, así que `admin_user_id` solo se llena del lado del negocio.
  // `visto_*` permite el contador de sin leer de cada lado sin borrar nada.
  db.exec(`CREATE TABLE IF NOT EXISTS portal_mensajes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    autor TEXT NOT NULL CHECK(autor IN ('negocio','cliente')),
    texto TEXT NOT NULL,
    admin_user_id INTEGER,
    visto_negocio INTEGER DEFAULT 0,
    visto_cliente INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_portal_mensajes_cli ON portal_mensajes(client_id, id)`);
  // Paso 4b — COMPARTIR. Un panel compartido lo ven todos, pero guarda la RECETA, no los datos: al
  // abrirlo se vuelve a cruzar y se revalidan los permisos de HOY. Compartir la receta NO filtra — un
  // panel de Compras compartido no se abre para quien no tiene `purchases.read` (falla cerrado). Solo
  // el dueño del panel lo comparte/descomparte (WHERE user_id).
  addCol(db, 'analytics_panels', 'compartido', 'INTEGER DEFAULT 0');

  // ── ESCALERA · PASO 6 — INICIO PERSONALIZABLE: layouts del Inicio (aditivo, reversible) ──────
  // Un layout por ÁMBITO (`scope`): 'fabrica' (semilla en código, no se persiste) · 'empresa' (el
  // default que edita el dueño) · 'usuario:<id>' (el retoque de cada usuario). `blocks` = JSON con la
  // lista ordenada de bloques { tipo, refId, x, y, w, h }. La resolución elige el ámbito MÁS específico.
  // NO es tabla de DISA (DISA sigue fuera de WRITABLE_TABLES); esto es config de presentación por tenant.
  db.exec(`CREATE TABLE IF NOT EXISTS dashboard_layouts (
    scope TEXT PRIMARY KEY,
    blocks TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER
  )`);

  // ── ESCALERA · PASO 7 (servicios profesionales) · PIEZA 1 — PROYECTO (aditivo, idempotente, sin DROP) ──
  // Una entidad "proyecto" por tenant. `codigo` PRY-NNNN (contador `code_counters`, no editable). `cliente_id`
  // y `responsable_id` son FK LÓGICAS opcionales (se resuelven EN VIVO por LEFT JOIN al pintar, como el
  // responsable de cliente del peldaño 3): reasignar cambia la ficha, no se congela. `modo_cobro` y `estado`
  // son listas cerradas (se validan en el servidor). `active` = archivar-no-borrar. FUERA de WRITABLE_TABLES.
  db.exec(`CREATE TABLE IF NOT EXISTS proyectos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT,
    nombre TEXT NOT NULL,
    cliente_id INTEGER,
    responsable_id INTEGER,
    modo_cobro TEXT NOT NULL DEFAULT 'horas',
    tarifa_hora REAL,
    precio_cerrado REAL,
    fecha_inicio TEXT,
    fecha_fin_prevista TEXT,
    estado TEXT NOT NULL DEFAULT 'abierto',
    active INTEGER NOT NULL DEFAULT 1,
    notas TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT
  )`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_proyectos_codigo ON proyectos(codigo)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_proyectos_active ON proyectos(active)`);

  // ── ESCALERA · PASO 7 · PIEZA 2 — REGISTRO DE TIEMPO (aditivo, idempotente, sin DROP) ────────────
  // Una entrada de tiempo por trabajo hecho en un proyecto. `duracion_seg` es EXACTA (segundos, sin
  // redondeos); NULL = cronómetro CORRIENDO (`started_at` puesto, aún sin parar). `fecha` es el día de
  // la entrada (para la vista semanal). `facturable` marca si cuenta para facturar; el importe NO se
  // guarda: se calcula EN VIVO con la tarifa de la persona (respaldo la del proyecto). `active` =
  // ocultar-no-destruir. FUERA de WRITABLE_TABLES (DISA no la escribe).
  db.exec(`CREATE TABLE IF NOT EXISTS time_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proyecto_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    descripcion TEXT DEFAULT '',
    fecha TEXT NOT NULL,
    started_at TEXT,
    duracion_seg INTEGER,
    facturable INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_time_entries_user ON time_entries(user_id, fecha)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_time_entries_proy ON time_entries(proyecto_id)`);
  // Un solo cronómetro ACTIVO por persona: como mucho una fila corriendo (duracion NULL) y viva por user.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_time_entries_running ON time_entries(user_id) WHERE duracion_seg IS NULL AND active=1`);
  // PIEZA 3 — enlace entrada → factura que la cobró. "Facturada" se deriva EN VIVO (invoice_id puesto Y la
  // factura enlazada está 'emitida'): si la factura se anula, la entrada vuelve a estar disponible sola, sin
  // tocar el motor de anulación. (Es entrada→factura, distinto del factura→proyecto que llega en la pieza 4.)
  addCol(db, 'time_entries', 'invoice_id', 'INTEGER');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_time_entries_invoice ON time_entries(invoice_id)`);
  // PIEZA 4 (parte 2) — COSTE DE LAS HORAS: coste-hora CONGELADO en la entrada al crearla (misma filosofía
  // que el WAC del peldaño 2: cambiar el coste-hora de una persona HOY no reescribe la rentabilidad de un
  // proyecto pasado). `coste_hora_congelado` = coste/hora de la persona (admin_users.coste_hora) en el
  // instante de crear la entrada; NULL/0 = "sin coste registrado" (NO es coste 0). `coste_backfill`=1 marca
  // las entradas anteriores a la función (retro-rellenadas al coste-hora del momento, NO el del día real).
  // Es coste (gestión), separado del importe FACTURABLE (venta, en vivo con tarifa_hora). Aditivo, sin DROP.
  addCol(db, 'time_entries', 'coste_hora_congelado', 'REAL');
  addCol(db, 'time_entries', 'coste_backfill', 'INTEGER NOT NULL DEFAULT 0');
  // PIEZA 4 (parte 1) — RENTABILIDAD POR PROYECTO: etiqueta de proyecto (FK nullable, opcional, leída EN
  // VIVO) en los DOS documentos que postean al P&G: factura de venta (+abono/rectificativa) y factura
  // recibida (compra de mercadería + gasto + abono de proveedor). La "compra directa" (tabla `purchases`)
  // NO se etiqueta: es STOCK, no postea a grupos 6/7. El P&G se filtra por proyecto resolviendo el asiento
  // → su documento (origin_type/origin_id, ya indexado) → project_id, sin columna nueva en el diario ni
  // tocar el posteo/Verifactu. Aditivo, idempotente, sin DROP; ambas tablas siguen FUERA de WRITABLE_TABLES.
  addCol(db, 'invoices', 'project_id', 'INTEGER');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_invoices_project ON invoices(project_id)`);
  addCol(db, 'supplier_invoices', 'project_id', 'INTEGER');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_supplier_invoices_project ON supplier_invoices(project_id)`);

  // ── ESCALERA · PASO 3 · BLOQUE 2 — PLAN FINANCIERO: los objetivos (aditivo, reversible) ───────
  // El lado "real" ya existe (ventasPorPeriodo / margenResumen). Esto es el lado "objetivo", que es
  // dato NUEVO: las metas las teclea el dueño, no salen de ninguna parte.
  //   · tipo    — 'facturacion' | 'beneficio'.
  //   · periodo — 'mes' | 'trimestre' | 'anio'.
  //   · clave   — el periodo concreto, con la MISMA forma que devuelve `clavePeriodo()`:
  //               '2026-07' · '2026-T3' · '2026'. Una sola gramática para la meta y para lo real; si
  //               fueran dos, compararlas exigiría traducir, y ahí es donde se cuela el error.
  //   · alcance — 'global' | 'responsable'.
  //   · user_id — NULL si global; el usuario si es de un responsable.
  //   · valor   — el importe SIN IVA (decisión del dueño: el IVA es de Hacienda).
  // BENEFICIO = MARGEN (venta − coste congelado), NO el resultado del P&G. Decisión del dueño
  // (17 jul): así cuadra en los tres alcances (global = Σ responsables + sin asignar) y es lo que un
  // comercial puede mover — un objetivo que sube o baja porque el dueño cambió de local no es suyo.
  // El P&G se queda en Contabilidad como única verdad del resultado del negocio; no se duplica aquí.
  // ÍNDICE ÚNICO: una meta por (tipo, periodo, clave, alcance, usuario). Fijar dos veces la misma
  // meta la SUSTITUYE, no la duplica. `COALESCE(user_id,0)` porque en SQLite dos NULL son distintos
  // entre sí — sin eso, "global" admitiría filas repetidas y la pantalla mostraría dos metas.
  // LOS NIVELES NO SE FUERZAN A CUADRAR, a propósito: el dueño fija el que quiera y la pantalla
  // enseña lo real al lado. Son metas, no contabilidad — que enero+febrero+marzo no sumen el T1 no es
  // un error, es que decidió otra cosa. Forzarlo obligaría a inventar metas que nadie puso.
  db.exec(`CREATE TABLE IF NOT EXISTS financial_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL CHECK (tipo IN ('facturacion','beneficio')),
    periodo TEXT NOT NULL CHECK (periodo IN ('mes','trimestre','anio')),
    clave TEXT NOT NULL,
    alcance TEXT NOT NULL CHECK (alcance IN ('global','responsable')),
    user_id INTEGER,
    valor REAL NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT
  )`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_targets_unico
           ON financial_targets (tipo, periodo, clave, alcance, COALESCE(user_id, 0))`);

  // ── CRM · RESPONSABLE DE CLIENTE + atribución de la venta (aditivo, reversible) ──────────────
  // Quién lleva a cada cliente. Se asigna A MANO (no hay reparto automático, y DISA no lo toca).
  // NULL = "sin asignar", que es un estado legítimo y el de arranque de TODOS los existentes: la
  // analítica por responsable se llena a medida que el dueño reparte.
  //   · `clients.responsable_user_id` — el dueño comercial de la ficha.
  //   · `invoices.emitted_by`         — quién EMITIÓ el documento. Solo lo rellena el mostrador.
  // LA CASCADA (resuelta en ventas-metrics.js, fuente única — aquí solo viven los datos):
  //   1) hay cliente  → responsable del cliente, DERIVADO EN VIVO (no congelado).
  //   2) si no, hay emitted_by → quien cobró, CONGELADO (mostrador anónimo).
  //   3) si no → sin asignar.
  // POR QUÉ EL (1) SE DERIVA Y NO SE CONGELA, al revés que el coste del paso 2: el coste es un
  // HECHO del día de la venta (lo que te costó entonces) y no puede cambiar; el responsable es una
  // RELACIÓN VIVA (quién lleva a este cliente HOY). Si reasignas un cliente, su histórico debe
  // reatribuirse solo — es lo que espera cualquier CRM. Verificado que es seguro: los clientes se
  // ARCHIVAN (active=0), nunca se borran, y hay 0 facturas con un client_id inexistente.
  // NO toca la huella: `emitted_by` es identificación, no entra en `calcHash` (número, fecha, NIF,
  // total, huella previa) ni en ningún campo firmado.
  addCol(db, 'clients',  'responsable_user_id', 'INTEGER');
  addCol(db, 'invoices', 'emitted_by',          'INTEGER');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_clients_responsable ON clients(responsable_user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_invoices_emitted_by ON invoices(emitted_by)`);

  // Backfill del histórico del MOSTRADOR, una sola vez (bandera). El dato ya existe: `activity_logs`
  // registra "Emitió ticket de mostrador" con su `user_id` desde siempre. No se inventa nada — se
  // recupera lo que ya estaba escrito, y solo para tickets (`client_id IS NULL`, que es la rama 2 de
  // la cascada). Si un ticket no tiene log, se queda NULL → "sin asignar", que es la verdad.
  // Los clientes NO se backfillean: nacen "sin asignar" a propósito (decisión del dueño).
  const respBackfillKey = 'migration_mostrador_emitted_by_backfill_2026_v1';
  if (!db.prepare('SELECT value FROM settings WHERE key=?').get(respBackfillKey)) {
    db.transaction(() => {
      db.prepare(`UPDATE invoices SET emitted_by = (
                    SELECT a.user_id FROM activity_logs a
                     WHERE a.entity='invoice' AND a.entity_id = invoices.id
                       AND a.action LIKE 'Emitió ticket%' AND a.user_id IS NOT NULL
                     ORDER BY a.id LIMIT 1)
                  WHERE emitted_by IS NULL AND client_id IS NULL`).run();
      db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(respBackfillKey, 'done');
    })();
  }

  // ── ESCALERA · PASO 2 (MARGEN) — el coste, congelado en la línea (aditivo, reversible) ──
  // La línea de venta guardaba SOLO el precio: ni el coste, ni SIQUIERA de qué producto era. El
  // enlace existía en la petición (schemas: `product_id`) y se tiraba al insertar, así que la
  // analítica agrupaba por DESCRIPCIÓN (texto libre) y el margen era imposible de calcular.
  //   · `product_id` — qué se vendió. NULL = línea libre (concepto tecleado, sin catálogo).
  //   · `unit_cost`  — el WAC del producto CONGELADO al emitir. NULL = **sin coste registrado**.
  //   · `cost_source`— 'snapshot' (congelado al emitir) | 'backfill' (aproximado, ver abajo).
  // POR QUÉ SE CONGELA: `products.average_cost` es una caché VIVA que se mueve con cada compra. Si
  // el informe leyera el WAC de hoy, el margen de una factura de enero cambiaría solo porque en
  // marzo compraste más caro. Un documento emitido es inmutable: su coste también. Mismo patrón
  // que ya congela empresa y cliente en `invoices`.
  // NULL NO ES CERO: un servicio, un digital, una línea libre o un físico nunca comprado no tienen
  // coste CONOCIDO. Contarlos a 0 les daría un margen del 100% y la cifra total mentiría. El
  // informe los aparta como "sin coste registrado" (ver `margenResumen` en ventas-metrics.js).
  // NO toca la huella Verifactu: `calcHash` come número, fecha, NIF, total y huella previa — nunca
  // las líneas. Añadir columnas a la línea no puede mover una cadena legal.
  addCol(db, 'invoice_items', 'product_id',  'INTEGER');
  addCol(db, 'invoice_items', 'unit_cost',   'REAL');
  addCol(db, 'invoice_items', 'cost_source', 'TEXT');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_invoice_items_product ON invoice_items(product_id)`);

  // Backfill histórico, UNA sola vez (bandera). Las líneas viejas no tienen product_id, así que el
  // único puente posible es la DESCRIPCIÓN — que es exactamente como la analítica venía agrupando.
  // Se casa por nombre exacto contra el catálogo; lo que no case, se queda sin coste (correcto: una
  // línea libre nunca fue un producto). El coste que se pone es el WAC de HOY, que NO es el del día
  // de la venta: por eso queda marcado `cost_source='backfill'` y el informe puede distinguirlo de
  // lo congelado de verdad. Aproximación honesta y etiquetada > cifra limpia y falsa.
  // Los documentos NUEVOS nacen con 'snapshot' y no pasan por aquí.
  const costeBackfillKey = 'migration_invoice_items_coste_backfill_2026_v1';
  if (!db.prepare('SELECT value FROM settings WHERE key=?').get(costeBackfillKey)) {
    db.transaction(() => {
      db.prepare(`UPDATE invoice_items SET product_id = (
                    SELECT p.id FROM products p WHERE p.name = invoice_items.description LIMIT 1)
                  WHERE product_id IS NULL`).run();
      db.prepare(`UPDATE invoice_items SET unit_cost = (
                    SELECT p.average_cost FROM products p WHERE p.id = invoice_items.product_id),
                      cost_source = 'backfill'
                  WHERE unit_cost IS NULL AND product_id IS NOT NULL
                    AND (SELECT COALESCE(p.average_cost,0) FROM products p WHERE p.id = invoice_items.product_id) > 0`).run();
      db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(costeBackfillKey, 'done');
    })();
  }
  addCol(db, 'invoices',      'irpf_rate',   'REAL NOT NULL DEFAULT 0');
  addCol(db, 'invoices',      'irpf_amount', 'REAL NOT NULL DEFAULT 0');

  // ── Ciclo de vida de la factura (ES): ANULAR y RECTIFICAR ──────────────────
  // Regla de oro fiscal: una factura emitida NUNCA se edita ni se borra (rompería
  // la cadena de hash). Anular y rectificar son ASIENTOS NUEVOS enlazados en la
  // cadena; la original solo cambia su `status` (campo FUERA del hash, así que
  // marcarla no altera su verifactu_hash ni rompe la cadena).
  //
  // Columnas aditivas en invoices para la rectificativa (es una factura real con
  // numeración propia que referencia a la original):
  addCol(db, 'invoices', 'record_type',          "TEXT NOT NULL DEFAULT 'alta'"); // 'alta' | 'rectificativa'
  addCol(db, 'invoices', 'rectifies_invoice_id', 'INTEGER');                       // FK a la factura original
  addCol(db, 'invoices', 'rectification_type',   "TEXT DEFAULT ''");               // R1..R5
  addCol(db, 'invoices', 'rectification_mode',   "TEXT DEFAULT ''");               // 'S' sustitución | 'I' diferencias
  // PIEZA B — factura COMPLETA de canje (TipoFactura F3) que SUSTITUYE a un ticket (factura
  // simplificada serie S). Apunta al ticket sustituido. El ticket NO se borra ni anula: queda
  // "sustituido" (derivado de esta FK), sin efecto fiscal, enlazado. Aditiva, idempotente.
  addCol(db, 'invoices', 'substitutes_invoice_id', 'INTEGER');                      // FK al ticket (factura simplificada) sustituido

  // Serie propia para rectificativas (estándar legal ES). No mete huecos en la
  // numeración F de facturas ordinarias; tiene su propia cadena de hash.
  addCol(db, 'company_config', 'rectificative_series', "TEXT DEFAULT 'R'");

  // Registros de ANULACIÓN: asiento nuevo hash-enlazado al hash de la factura
  // original (prev_hash = verifactu_hash de la original). La original se marca
  // 'anulada' pero su fila queda intacta. NO consume número de factura.
  db.exec(`CREATE TABLE IF NOT EXISTS invoice_anulaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    invoice_number TEXT NOT NULL,
    motivo TEXT NOT NULL,
    issue_date DATE NOT NULL,
    company_fiscal_id TEXT DEFAULT '',
    prev_hash TEXT DEFAULT '',
    verifactu_hash TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id)
  )`);

  // ── VERI*FACTU · Tarea 1 — Registro de facturación oficial (alta/anulación) ──
  // Cadena de huella OFICIAL de la AEAT (doc v0.1.2), SEPARADA de la cadena propietaria
  // de integridad (invoices.verifactu_hash, que recorre superadmin/integridad.js). NO toca
  // ninguna tabla existente. Encadenamiento ÚNICO por tenant (alta+anulación en orden de id)
  // que ARRANCA LIMPIO en la implantación: el primer registro lleva prev_huella='' y
  // primer_registro='S'. Las facturas anteriores NO se registran retroactivamente. La huella y
  // su FechaHoraHusoGenRegistro se CONGELAN al generar (la Tarea 2 transmite ese valor exacto).
  // Aditiva e idempotente. La Tarea 2 (envío AEAT) reconstruye el RegistroAlta/Anulación completo
  // desde estos campos + la factura inmutable enlazada. Detalle en modules/erp/verifactu.js.
  db.exec(`CREATE TABLE IF NOT EXISTS verifactu_registros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    record_type TEXT NOT NULL CHECK(record_type IN ('alta','anulacion')),
    id_emisor TEXT NOT NULL,
    num_serie TEXT NOT NULL,
    fecha_expedicion TEXT NOT NULL,
    tipo_factura TEXT,
    cuota_total TEXT,
    importe_total TEXT,
    prev_huella TEXT NOT NULL DEFAULT '',
    huella TEXT NOT NULL,
    fecha_hora_huso TEXT NOT NULL,
    primer_registro TEXT NOT NULL DEFAULT 'N',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id)
  )`);
  // A1 (Eje C) — CINTURÓN idempotente para el encadenado por NIF: completa `id_emisor` donde estuviera
  // VACÍO con el NIF de la propia empresa (una BD de tenant = un solo obligado tributario). Es un dato de
  // IDENTIFICACIÓN: NO toca la huella, la huella anterior, la fecha ni ningún campo firmado de la cadena —
  // solo permite que el filtrado por NIF no deje huérfano un registro histórico sin NIF. Comprobado el
  // 15-jul-2026: 0 filas afectadas en los tenants actuales (todos ya poblados y coincidiendo con su NIF).
  // Una sola vez, por bandera; los registros nuevos siempre nacen con su id_emisor.
  const nifBackfillKey = 'migration_verifactu_id_emisor_backfill_2026_v1';
  if (!db.prepare('SELECT value FROM settings WHERE key=?').get(nifBackfillKey)) {
    const nif = (db.prepare('SELECT fiscal_id FROM company_config WHERE id=1').get() || {}).fiscal_id;
    db.transaction(() => {
      if (nif) db.prepare("UPDATE verifactu_registros SET id_emisor=? WHERE id_emisor IS NULL OR id_emisor=''").run(nif);
      db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(nifBackfillKey, 'done');
    })();
  }

  // ── VERI*FACTU · Tarea 2 (Fase A) — ESTADO DE ENVÍO a la AEAT (aditiva, idempotente) ──
  // Una fila por registro de facturación (1:1 con verifactu_registros vía registro_id UNIQUE):
  // el envío es idempotente por diseño (upsert; no se reenvía lo ya 'correcto'). Guarda el estado,
  // el CSV, los códigos/descripciones de error de la AEAT y la respuesta cruda (no se tragan), más
  // el XML enviado para auditoría. NO toca la huella/QR (Tarea 1, inmutable). Detalle en
  // modules/erp/verifactu-envio.js.
  db.exec(`CREATE TABLE IF NOT EXISTS verifactu_envios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    registro_id INTEGER NOT NULL UNIQUE,
    estado TEXT NOT NULL DEFAULT 'pendiente',
    entorno TEXT,
    endpoint TEXT,
    estado_envio TEXT,
    estado_registro TEXT,
    codigo_error TEXT,
    descripcion_error TEXT,
    csv TEXT,
    tiempo_espera_envio INTEGER,
    http_status INTEGER,
    request_xml TEXT,
    response_xml TEXT,
    aviso TEXT,
    intentos INTEGER NOT NULL DEFAULT 0,
    enviado_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (registro_id) REFERENCES verifactu_registros(id)
  )`);

  // ── VERI*FACTU · COLA de envío automático — reloj del reintento (aditiva) ──
  // `next_retry_at` es lo ÚNICO que la cola añade al estado de envío, y hace de tres cosas a la vez:
  //   · marca de propiedad — una fila con next_retry_at NULL NO la toca la cola (registros históricos
  //     y envíos manuales quedan fuera; encender la cola no drena el pasado).
  //   · reloj del reintento — cuándo vuelve a ser elegible tras un fallo de comunicación (backoff).
  //   · cerrojo entre procesos — al reclamar una fila se empuja al futuro (lease), así el barrido de
  //     systemd y la cola en proceso nunca envían el mismo registro dos veces.
  // Se guarda SIEMPRE en ISO-8601 UTC con Z (new Date().toISOString()), igual que `enviado_at`, y
  // NUNCA con CURRENT_TIMESTAMP: 'AAAA-MM-DD HH:MM:SS' y 'AAAA-MM-DDTHH:MM:SS.sssZ' se comparan como
  // cadenas y el espacio (0x20) ordena antes que la 'T' (0x54) — mezclarlos rompe el <= del reclamo.
  addCol(db, 'verifactu_envios', 'next_retry_at', 'DATETIME');
  db.exec('CREATE INDEX IF NOT EXISTS idx_verifactu_envios_retry ON verifactu_envios(next_retry_at)');

  // ── PORTAL DE CLIENTE · Bloque C — enlaces mágicos temporales (aditiva) ──
  // El cliente accede por /portal/<token> (sin contraseña). El token es temporal y solo da acceso a
  // las facturas de SU client_id. Solo lectura: el portal no toca documentos ni ledger.
  db.exec(`CREATE TABLE IF NOT EXISTS portal_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME,
    FOREIGN KEY (client_id) REFERENCES clients(id)
  );
  CREATE INDEX IF NOT EXISTS idx_portal_tokens_token ON portal_tokens(token);`);

  // ── CONCILIACIÓN BANCARIA · Pieza 1 — extracto Norma 43 + cruce de ingresos (aditiva) ──
  // bank_movements: un movimiento del extracto bancario (Cuaderno 43). El `balance` (saldo corriente)
  // NO viene por movimiento en el reg. 22: se CALCULA acumulando desde el saldo inicial (reg. 11), y
  // entra en `natural_hash` para deduplicar de forma robusta (dos abonos idénticos el mismo día tienen
  // saldos distintos → no colapsan; el mismo movimiento reimportado tiene el mismo saldo → no duplica).
  // Aditiva: no toca facturas, cobros ni el ledger. Detalle en modules/erp/conciliacion.js.
  db.exec(`CREATE TABLE IF NOT EXISTS bank_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account TEXT NOT NULL,
    entity_code TEXT DEFAULT '',
    office_code TEXT DEFAULT '',
    account_number TEXT DEFAULT '',
    op_date DATE NOT NULL,
    value_date DATE,
    amount REAL NOT NULL,
    is_credit INTEGER NOT NULL DEFAULT 0,
    balance REAL,
    concept_common TEXT DEFAULT '',
    concept TEXT DEFAULT '',
    doc_number TEXT DEFAULT '',
    ref1 TEXT DEFAULT '',
    ref2 TEXT DEFAULT '',
    natural_hash TEXT NOT NULL UNIQUE,
    source_file TEXT DEFAULT '',
    imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_bank_movements_opdate ON bank_movements(op_date);`);

  // ── FACTURAS RECURRENTES · Bloque A (aditiva) — plantillas de cuota/iguala que Bamburu genera solas ──
  // La generación crea una OCURRENCIA en estado 'borrador' (NO una factura emitida: el CHECK de
  // invoices no admite borrador y la huella Verifactu solo nace al emitir). El dueño revisa y emite
  // con un clic → ahí se crea la factura real por el flujo existente (createInvoice). Idempotente por
  // UNIQUE(template_id, due_date). Detalle en modules/erp/recurrentes.js.
  db.exec(`CREATE TABLE IF NOT EXISTS recurring_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER,
    document_name TEXT DEFAULT 'Factura',
    interval_months INTEGER NOT NULL DEFAULT 1,
    start_date DATE NOT NULL,
    end_date DATE,
    max_occurrences INTEGER,
    irpf_rate REAL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'activa',
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id)
  );
  CREATE TABLE IF NOT EXISTS recurring_template_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL DEFAULT 0,
    tax_rate REAL NOT NULL DEFAULT 21,
    FOREIGN KEY (template_id) REFERENCES recurring_templates(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS recurring_occurrences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL,
    due_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'borrador',
    invoice_id INTEGER,
    generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    emitted_at DATETIME,
    UNIQUE(template_id, due_date),
    FOREIGN KEY (template_id) REFERENCES recurring_templates(id)
  );`);

  // bank_reconciliations: el VÍNCULO movimiento ↔ objetivo (cobro existente o factura), o "ignorado".
  // El estado de conciliación de un movimiento se DERIVA de aquí (no hay columna de estado en el
  // movimiento). Una fila por movimiento (UNIQUE); deshacer = borrar la fila. `created_payment_id`
  // marca el cobro creado AL conciliar (para avisar antes de borrarlo en el deshacer).
  db.exec(`CREATE TABLE IF NOT EXISTS bank_reconciliations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    movement_id INTEGER NOT NULL UNIQUE,
    estado TEXT NOT NULL DEFAULT 'conciliado',
    target_type TEXT,
    target_id INTEGER,
    created_payment_id INTEGER,
    reconciled_by TEXT DEFAULT '',
    reconciled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (movement_id) REFERENCES bank_movements(id)
  )`);

  // ── PILAR 4 · VENTAS · PIEZA 1 — PRESUPUESTO (quotes) ──────────────────────
  // Documento PRESUPUESTO, ESPEJO de la orden de compra (purchase_orders): mismo ciclo
  // borrador (editable, sin número) → emitido (gana PRE-NNNN vía code_counters y se bloquea)
  // → anulado (con motivo; corregir = anular y rehacer, vía replaces_quote_id). Foto congelada
  // de emisor + cliente AL EMITIR (igual que la factura/OC): el borrador lee en vivo. Estados de
  // SEGUIMIENTO en columna aditiva follow_status (aceptado|rechazado|caducado), separada del
  // ciclo. Totales con la MISMA matemática de la factura (base + IVA por tasa + IRPF). Aditiva e
  // idempotente. DISA NO escribe presupuestos (quotes/quote_items fuera de WRITABLE_TABLES).
  db.exec(`CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_number TEXT,
    client_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'borrador' CHECK(status IN ('borrador','emitido','anulado')),
    follow_status TEXT,
    date DATE NOT NULL,
    valid_until DATE,
    notes TEXT DEFAULT '',
    replaces_quote_id INTEGER,
    anulada_motivo TEXT,
    company_name TEXT, company_fiscal_id TEXT, company_address TEXT, company_phone TEXT, company_email TEXT,
    client_name TEXT, client_fiscal_id TEXT, client_address TEXT, client_email TEXT,
    subtotal REAL NOT NULL DEFAULT 0,
    tax_amount REAL NOT NULL DEFAULT 0,
    irpf_rate REAL NOT NULL DEFAULT 0,
    irpf_amount REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    currency TEXT DEFAULT 'EUR',
    currency_symbol TEXT DEFAULT '€',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (replaces_quote_id) REFERENCES quotes(id)
  )`);
  // Líneas: ESPEJO de la FACTURA (no de la OC) — admite línea de catálogo (product_id + IVA por
  // banda) Y línea libre (product_id NULL, IVA 21% por defecto). unit_price es NETO (sin IVA).
  db.exec(`CREATE TABLE IF NOT EXISTS quote_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_id INTEGER NOT NULL,
    product_id INTEGER,
    description TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL DEFAULT 0,
    total_price REAL NOT NULL DEFAULT 0,
    tax_rate REAL NOT NULL DEFAULT 0,
    tax_amount REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);
  // MOTOR DE CONVERSIÓN — enlace GENERAL origen↔destino entre documentos (presupuesto→factura/
  // ticket; preparado para pedido→albarán→factura sin rehacerlo). Una fila por conversión; admite
  // varias por origen (conversión parcial futura). Hoy solo conversión del documento COMPLETO.
  db.exec(`CREATE TABLE IF NOT EXISTS document_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT NOT NULL,
    source_id INTEGER NOT NULL,
    dest_type TEXT NOT NULL,
    dest_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_doclinks_source ON document_links(source_type, source_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_doclinks_dest   ON document_links(dest_type, dest_id)`);

  // ── PILAR 4 · VENTAS · PIEZA 2a — PEDIDO (customer_orders) ─────────────────
  // Documento PEDIDO de venta en firme, ESPEJO del PRESUPUESTO (quotes): mismo ciclo
  // borrador (editable, sin número, sin reserva) → confirmado (gana PED-NNNN vía code_counters
  // y se bloquea; aquí nace la RESERVA de stock) → anulado (con motivo; suelta la reserva;
  // corregir = anular y rehacer, vía replaces_order_id). Foto congelada de emisor + cliente AL
  // CONFIRMAR. Totales con la MISMA matemática de la factura (base + IVA por tasa + IRPF). A
  // diferencia del presupuesto: lleva ALMACÉN (la reserva sale de ese almacén) y una fecha de
  // entrega prevista INFORMATIVA (no caduca, no libera). NO reutiliza el clúster e-commerce
  // viejo (sales_orders). 'entregado' queda en el CHECK reservado para la PIEZA 2b (albarán):
  // hoy NUNCA se asigna; permitirlo ahora evita una migración con rebuild después. La RESERVA
  // es una capa derivada (suma de líneas de pedidos confirmados); NO escribe en stock_movements.
  // Aditiva e idempotente. DISA NO escribe pedidos (fuera de WRITABLE_TABLES).
  db.exec(`CREATE TABLE IF NOT EXISTS customer_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT,
    client_id INTEGER NOT NULL,
    warehouse_id INTEGER,
    status TEXT NOT NULL DEFAULT 'borrador' CHECK(status IN ('borrador','confirmado','anulado','entregado')),
    date DATE NOT NULL,
    expected_delivery_date DATE,
    notes TEXT DEFAULT '',
    replaces_order_id INTEGER,
    anulada_motivo TEXT,
    company_name TEXT, company_fiscal_id TEXT, company_address TEXT, company_phone TEXT, company_email TEXT,
    client_name TEXT, client_fiscal_id TEXT, client_address TEXT, client_email TEXT,
    subtotal REAL NOT NULL DEFAULT 0,
    tax_amount REAL NOT NULL DEFAULT 0,
    irpf_rate REAL NOT NULL DEFAULT 0,
    irpf_amount REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    currency TEXT DEFAULT 'EUR',
    currency_symbol TEXT DEFAULT '€',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
    FOREIGN KEY (replaces_order_id) REFERENCES customer_orders(id)
  )`);
  // Líneas: ESPEJO de quote_items — catálogo (product_id + IVA por banda) o línea libre
  // (product_id NULL, IVA 21%). unit_price NETO. La reserva solo cuenta las líneas con
  // product_id de producto FÍSICO (servicios/digitales/libres no reservan: lo decide el motor).
  db.exec(`CREATE TABLE IF NOT EXISTS customer_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER,
    description TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL DEFAULT 0,
    total_price REAL NOT NULL DEFAULT 0,
    tax_rate REAL NOT NULL DEFAULT 0,
    tax_amount REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (order_id) REFERENCES customer_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);
  // El "reservado" se deriva al vuelo de estas líneas (pedidos confirmados, por producto y
  // almacén): este índice acelera ese agregado. Aditivo, idempotente.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_customer_order_items_product ON customer_order_items(product_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_customer_orders_status ON customer_orders(status, warehouse_id)`);

  // ── PILAR 4 · VENTAS · PIEZA 2b — ALBARÁN / entrega (delivery_notes) ───────
  // Documento de ENTREGA, ESPEJO de la RECEPCIÓN de compra (purchase_order_receipts): es el
  // ÚNICO punto de la cadena de ventas donde el stock SALE de verdad del libro. DEL-NNNN al
  // confirmar (no hay borrador, igual que la recepción), INMUTABLE; corregir = anular (motivo)
  // y rehacer. Dos orígenes: desde un PEDIDO confirmado (order_id) — consume su reserva al
  // entregar, parciales permitidos — o SUELTO (order_id NULL, líneas de catálogo/libres). Foto
  // congelada de empresa+cliente al confirmar (patrón pedido/factura). Solo físicos mueven stock.
  // El estado de entrega del pedido vive en la columna ADITIVA customer_orders.delivered_status
  // (NULL | 'parcial' | 'entregado'), espejo de received_status; el "entregado" por línea se
  // deriva de los albaranes confirmados (delivery_note_items.order_item_id), nunca una columna
  // manual. NO reutiliza el clúster e-commerce viejo. DISA NO escribe albaranes (fuera de WRITABLE).
  db.exec(`CREATE TABLE IF NOT EXISTS delivery_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delivery_number TEXT,
    client_id INTEGER NOT NULL,
    order_id INTEGER,
    warehouse_id INTEGER,
    status TEXT NOT NULL DEFAULT 'confirmado' CHECK(status IN ('confirmado','anulado')),
    date DATE NOT NULL,
    notes TEXT DEFAULT '',
    anulada_motivo TEXT,
    company_name TEXT, company_fiscal_id TEXT, company_address TEXT, company_phone TEXT, company_email TEXT,
    client_name TEXT, client_fiscal_id TEXT, client_address TEXT, client_email TEXT,
    subtotal REAL NOT NULL DEFAULT 0,
    tax_amount REAL NOT NULL DEFAULT 0,
    irpf_rate REAL NOT NULL DEFAULT 0,
    irpf_amount REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    currency TEXT DEFAULT 'EUR',
    currency_symbol TEXT DEFAULT '€',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (order_id) REFERENCES customer_orders(id),
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
  )`);
  // order_item_id: línea del pedido que esta línea entrega (NULL en albarán suelto); permite
  // derivar "entregado por línea" y cuadrar la reserva. unit_price NETO + tax_rate por línea
  // (copiados del pedido o del catálogo) para precargar la factura. Solo físicos mueven stock.
  db.exec(`CREATE TABLE IF NOT EXISTS delivery_note_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delivery_note_id INTEGER NOT NULL,
    order_item_id INTEGER,
    product_id INTEGER,
    description TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL DEFAULT 0,
    total_price REAL NOT NULL DEFAULT 0,
    tax_rate REAL NOT NULL DEFAULT 0,
    tax_amount REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (delivery_note_id) REFERENCES delivery_notes(id) ON DELETE CASCADE,
    FOREIGN KEY (order_item_id) REFERENCES customer_order_items(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_delivery_notes_order ON delivery_notes(order_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_delivery_note_items_dn ON delivery_note_items(delivery_note_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_delivery_note_items_orderitem ON delivery_note_items(order_item_id)`);
  // Estado de entrega del pedido (espejo de purchase_orders.received_status). ADITIVO: no toca
  // el CHECK de customer_orders.status; el pedido sigue 'confirmado' aunque esté entregado.
  addCol(db, 'customer_orders', 'delivered_status', 'TEXT');   // NULL | 'parcial' | 'entregado'

  // ── T4 Paso 1: motor de cobros (estado de cobro de la factura) ─────────────
  // Cobros (totales o parciales) de una factura. Una factura puede tener varios.
  // El ESTADO de cobro NO se guarda: se calcula siempre en vivo (modules/erp/cobros.js)
  // desde la suma de cobros y la fecha de vencimiento, para que nunca quede viejo.
  db.exec(`CREATE TABLE IF NOT EXISTS invoice_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    paid_date DATE NOT NULL,
    payment_method TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id)`);

  // Fecha de vencimiento GUARDADA en la factura (no calculada al vuelo): el plazo del
  // cliente puede cambiar y cada factura debe conservar el suyo. Al emitir se fija
  // = issue_date + payment_term_days del cliente. due_date NO entra en el hash
  // (calcHash usa number|issue_date|fiscal_ids|total|prev_hash) → cadena intacta.
  addCol(db, 'invoices', 'due_date', 'DATE');
  const dueMigKey = 'migration_invoices_due_date_2026_v1';
  if (!db.prepare('SELECT value FROM settings WHERE key=?').get(dueMigKey)) {
    // Backfill una vez: facturas existentes → issue_date + plazo ACTUAL del cliente,
    // o issue_date si no hay cliente/plazo. Aditivo; ninguna factura se borra.
    db.prepare(`UPDATE invoices SET due_date = COALESCE(
        (SELECT date(invoices.issue_date, '+' || COALESCE(c.payment_term_days,0) || ' days')
           FROM clients c WHERE c.id = invoices.client_id),
        invoices.issue_date)
      WHERE due_date IS NULL OR due_date = ''`).run();
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(dueMigKey, 'done');
  }

  // ── T4 Paso 2: pipeline de cobros — registro de ACCIONES de cobro ───────────
  // Cada gestión de cobro de una factura (recordatorio por email, contacto manual o
  // promesa de pago) queda registrada aquí. El motor (cobros.js) lee este log para
  // calcular la PRÓXIMA acción (qué paso de la cadencia falta) y para posponerla
  // cuando hay una promesa viva. Nada se borra: se archiva con active=0.
  db.exec(`CREATE TABLE IF NOT EXISTS collection_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    client_id INTEGER,
    type TEXT NOT NULL,                 -- recordatorio_email | contacto_manual | promesa_pago
    channel TEXT,                       -- email | telefono | whatsapp | otro (NULL si no aplica)
    stage TEXT,                         -- etapa de la cadencia en el momento de la acción
    note TEXT,
    promised_date TEXT,                 -- ISO; solo en promesa_pago
    created_at TEXT NOT NULL,           -- ISO
    active INTEGER DEFAULT 1,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_collection_actions_invoice ON collection_actions(invoice_id)`);

  // D5 (Eje B) — PROPUESTAS DE DISA. La primera proactividad real: DISA prepara borradores que el
  // dueño APRUEBA (nunca autoenvía). Tabla GENÉRICA a propósito (arranca solo con
  // 'recordatorio_impago', pero pensada para futuros tipos): un tipo, una referencia a factura y a
  // cliente, el estado del ciclo, y el borrador (asunto + cuerpo) ya generado por PLANTILLA.
  //   estado: pendiente | aprobada_enviada | descartada
  // Aislada por negocio como todo (una fila vive en la BD de su tenant).
  db.exec(`CREATE TABLE IF NOT EXISTS disa_proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT 'recordatorio_impago',
    invoice_id INTEGER,
    client_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pendiente',
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT,
    resolved_by TEXT
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_disa_proposals_status ON disa_proposals(status)`);
  // IDEMPOTENCIA ESTRICTA: una sola propuesta por (factura, tipo) para SIEMPRE, sea cual sea su
  // estado. Así una descartada NO se vuelve a proponer, y el generador no duplica (INSERT OR IGNORE).
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_disa_proposals_invoice_type ON disa_proposals(invoice_id, type)`);

  // D5b — PROPUESTA DE PAGO A PROVEEDOR POR VENCER. La propuesta apunta a una factura RECIBIDA
  // (supplier_invoices), que es OTRO espacio de ids que las de venta (invoices): la factura de venta
  // nº 7 y la recibida nº 7 no tienen nada que ver. Por eso NO se reutiliza invoice_id — se añaden
  // columnas propias (aditivo, sin DROP). Si se sobrecargara invoice_id, propuestasPendientes(), que
  // hace LEFT JOIN invoices ON i.id = p.invoice_id, uniría la propuesta a una factura de venta ajena.
  addCol(db, 'disa_proposals', 'supplier_invoice_id', 'INTEGER');
  addCol(db, 'disa_proposals', 'supplier_id', 'INTEGER');
  // Misma idempotencia estricta que arriba, para el lado proveedor. Los dos índices conviven sin
  // chocar: en SQLite los NULL de un índice único se consideran todos distintos entre sí, así que
  // las filas de impago (supplier_invoice_id NULL) no compiten entre ellas, ni las de pago (invoice_id NULL).
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_disa_proposals_supplier_invoice_type ON disa_proposals(supplier_invoice_id, type)`);

  // PROPUESTA DE EMITIR UNA FACTURA RECURRENTE. Tercer espacio de ids: la propuesta apunta a una
  // OCURRENCIA (recurring_occurrences) — la factura todavía NO existe, ese es justo el asunto. Por eso
  // no se reutiliza invoice_id: se llenaría con el id de una ocurrencia y propuestasPendientes(), que
  // hace LEFT JOIN invoices ON i.id = p.invoice_id, la ataría a una factura de venta ajena. Aditivo, sin DROP.
  addCol(db, 'disa_proposals', 'occurrence_id', 'INTEGER');
  // Misma idempotencia estricta que sus dos hermanos: una sola propuesta por (ocurrencia, tipo) para
  // SIEMPRE, sea cual sea su estado → una descartada NO se vuelve a proponer. Y convive con los otros
  // dos índices por lo dicho arriba: los NULL de un índice único son todos distintos entre sí, así que
  // las filas de impago/pago (occurrence_id NULL) no compiten entre ellas.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_disa_proposals_occurrence_type ON disa_proposals(occurrence_id, type)`);

  // PROPUESTA DE CLIENTE DORMIDO. Se ancla al CLIENTE (client_id, que ya existe): no hay documento al
  // que agarrarse — el asunto es justamente que no hay documento desde hace demasiado.
  //
  // Y aquí el índice NO puede ser como el de sus tres hermanas. Ellas usan un único total (documento,
  // tipo): una vez propuesta —o descartada— esa factura, NUNCA más. Para un cliente eso sería falso:
  // un cliente al que descartaste hace un año y que sigue sin comprar MERECE que se te vuelva a
  // recordar. Pero tampoco puede reproponerse cada mañana.
  //
  // La solución es un índice único PARCIAL: solo sobre las propuestas de este tipo que están
  // PENDIENTES. Así:
  //   · un cliente ya propuesto y pendiente NO se vuelve a proponer (el índice lo impide, en la BD),
  //   · y el HISTORIAL (descartadas, enviadas) convive sin reescribirse — que es la regla del proyecto.
  // El tiempo de espera antes de volver a proponerlo (90 días) NO se mete aquí: lo aplica el generador
  // mirando resolved_at. Un índice sabe decir "esto ya existe"; no sabe de calendarios.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_disa_proposals_dormido_pendiente
             ON disa_proposals(client_id, type)
           WHERE type='cliente_dormido' AND status='pendiente'`);

  // PROPUESTA DE VENCIMIENTO FISCAL — el recordatorio de que TOCA presentar un modelo (303, 130,
  // 111, 115, resúmenes anuales) SOLO de los que ESTE tenant declara en su ficha fiscal (ver
  // fiscal_profile, abajo). Quinto espacio de ancla: aquí no hay documento (factura/ocurrencia) ni
  // cliente, hay un (MODELO, AÑO, PERIODO). Por eso no se reutiliza ninguna columna existente —se
  // añaden tres propias, aditivo y sin DROP. Si se sobrecargara invoice_id/client_id, los LEFT JOIN
  // de propuestasPendientes atarían la propuesta a una factura o cliente ajenos.
  addCol(db, 'disa_proposals', 'fiscal_model', 'TEXT');     // '303' | '130' | '111' | '115' | '390' | '190' | '180'
  addCol(db, 'disa_proposals', 'fiscal_year', 'INTEGER');   // ejercicio al que se refiere la declaración
  addCol(db, 'disa_proposals', 'fiscal_period', 'TEXT');    // '1T'..'4T' (trimestral) | 'anual'
  // Misma idempotencia ESTRICTA que impago/pago/recurrente: una sola propuesta por (modelo, año,
  // periodo) para SIEMPRE, sea cual sea su estado → una descartada/preparada NO se vuelve a proponer,
  // y el siguiente periodo es otra clave (otra propuesta), como debe ser: el vencimiento se repite.
  // Convive con los otros índices únicos: en SQLite los NULL de un índice único son todos distintos
  // entre sí, así que las filas de los demás tipos (fiscal_model NULL) no compiten aquí.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_disa_proposals_fiscal
             ON disa_proposals(fiscal_model, fiscal_year, fiscal_period, type)`);

  // FICHA FISCAL DEL TENANT — la FUENTE DE VERDAD de qué modelos presenta este negocio. Sin ella, el
  // motor tendría que ASUMIR que todos presentan lo mismo (303+130), y un recordatorio fiscal que se
  // calla un modelo que sí debes presentar (p. ej. el 111 de un negocio con un empleado) es peor que
  // no tener recordatorio: da falsa tranquilidad y puede costar una multa. Por eso cada negocio
  // DECLARA su situación (en lenguaje llano, en Ajustes) y de aquí se derivan sus modelos.
  //
  // Singleton por tenant (id=1), igual que company_config. Booleans de obligación en 0 por defecto:
  // un negocio que NO ha declarado nada NO recibe ninguna propuesta fiscal (no se asume nada). La
  // inferencia desde la actividad real solo PRE-RELLENA el formulario; lo que manda es lo declarado.
  // Aditiva e idempotente. FUERA de WRITABLE_TABLES: DISA no se escribe a sí misma qué presenta el dueño.
  db.exec(`CREATE TABLE IF NOT EXISTS fiscal_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    presenta_iva INTEGER NOT NULL DEFAULT 0,                -- factura con IVA → 303 (trimestral) + 390 (anual)
    presenta_irpf_directa INTEGER NOT NULL DEFAULT 0,       -- estimación directa → 130 (trimestral)
    tiene_retenciones_trabajo INTEGER NOT NULL DEFAULT 0,   -- empleados/profesionales retenidos → 111 + 190 (anual)
    tiene_retenciones_alquiler INTEGER NOT NULL DEFAULT 0,  -- alquiler de local con retención → 115 + 180 (anual)
    situacion_especial INTEGER NOT NULL DEFAULT 0,          -- módulos, recargo de equivalencia, otro régimen: NO se deriva, se avisa
    no_cubierto TEXT DEFAULT '',                            -- nota del caso ambiguo que el motor no asume
    configured_at TEXT,                                     -- NULL = nunca declarado (distingue "sin declarar" de "declaró que no")
    updated_at TEXT,
    updated_by TEXT DEFAULT ''
  )`);
  db.exec(`INSERT OR IGNORE INTO fiscal_profile (id) VALUES (1)`);

  // ── NIVELES DE REPOSICIÓN (Pilar 3 · stock mínimo / punto de pedido) ─────────────────────────
  // Nivel MÍNIMO y OBJETIVO de stock POR (producto, almacén). APAGADO POR DEFECTO: solo se vigila el
  // (producto, almacén) donde el dueño ponga un número — una fila aquí ES la vigilancia. Al borrar el
  // mínimo (ponerlo a 0) se borra la fila (deja de vigilarse). Solo tiene sentido para productos FÍSICOS
  // (la UI y el motor filtran por type='physical'); no se fuerza con FK para no atar la migración.
  //   · min_qty:    umbral. El aviso salta cuando el DISPONIBLE del almacén (físico − reservado) < min_qty.
  //   · target_qty: objetivo de reposición. La cantidad a pedir = target − disponible. 0 = usar el mínimo.
  // FUERA de WRITABLE_TABLES (DISA no se pone niveles a sí misma): se escribe por servicio validado desde
  // la ficha del producto. No toca el libro de stock (stock_movements) ni el WAC: es solo configuración.
  db.exec(`CREATE TABLE IF NOT EXISTS stock_levels (
    product_id   INTEGER NOT NULL,
    warehouse_id INTEGER NOT NULL,
    min_qty      INTEGER NOT NULL DEFAULT 0,
    target_qty   INTEGER NOT NULL DEFAULT 0,
    updated_at   TEXT,
    updated_by   TEXT DEFAULT '',
    PRIMARY KEY (product_id, warehouse_id)
  )`);

  // PROPUESTA DE REPOSICIÓN DE STOCK (D5f) — el sexto tipo. Se ancla al PROVEEDOR habitual del producto
  // (reutiliza la columna supplier_id que ya existe): una propuesta = un borrador de orden de compra a
  // ese proveedor con TODOS sus productos bajo mínimo como líneas. No hay documento previo; el ancla es
  // el proveedor. Dos columnas propias, aditivas:
  //   · repo_signature: huella de la SITUACIÓN (qué productos/almacenes están bajo mínimo). Distingue
  //     "sigue la misma situación descartada" de "un producto nuevo cayó" → sin re-proponer lo descartado.
  //   · repo_po_id: la orden de compra en borrador creada al APROBAR. Mientras ese borrador siga vivo, no
  //     se propone otra compra encima al mismo proveedor.
  addCol(db, 'disa_proposals', 'repo_signature', 'TEXT');
  addCol(db, 'disa_proposals', 'repo_po_id', 'INTEGER');
  // "Una propuesta VIVA por proveedor": índice único PARCIAL sobre las PENDIENTES (como el de dormidos).
  // El historial (descartada/aprobada) convive sin reescribirse; solo se bloquea una segunda pendiente
  // del mismo proveedor. Convive con los demás índices únicos: los NULL de supplier_id (impago, fiscal…)
  // son todos distintos entre sí en SQLite, así que no compiten aquí.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_disa_proposals_reposicion_pendiente
             ON disa_proposals(supplier_id, type)
           WHERE type='reposicion_stock' AND status='pendiente'`);

  // PLANTILLAS DE EMAIL EDITADAS. Aquí SOLO viven las ediciones del dueño: la plantilla de FÁBRICA de
  // cada tipo vive en el código (email-templates.js) y NO se puede perder. Por eso "Volver al original"
  // es, literalmente, borrar la fila — no hay copia de fábrica que restaurar desde ningún sitio, porque
  // la de fábrica nunca se sobrescribió.
  // Aditiva e idempotente. FUERA de WRITABLE_TABLES: DISA no reescribe los textos que el negocio manda.
  db.exec(`CREATE TABLE IF NOT EXISTS email_templates (
    tipo TEXT NOT NULL,
    tono TEXT NOT NULL DEFAULT '_',
    subject TEXT NOT NULL DEFAULT '',
    html TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by TEXT DEFAULT '',
    PRIMARY KEY (tipo, tono)
  )`);

  // T4 Paso 2.1 — gestión a nivel de CUENTA. Un cobro/recordatorio/promesa de cuenta se
  // materializa en varias filas (un invoice_payment o un collection_action por factura viva).
  // Esta columna OPCIONAL agrupa esas filas para poder trazar de qué lote vinieron. Aditiva,
  // NULL en la gestión factura-a-factura de Paso 1/2; no toca el hash ni el núcleo de invoices.
  addCol(db, 'invoice_payments', 'account_batch_id', 'TEXT');
  addCol(db, 'collection_actions', 'account_batch_id', 'TEXT');

  db.exec(`CREATE TABLE IF NOT EXISTS invoice_sequences (
    series TEXT NOT NULL,
    year INTEGER NOT NULL,
    last_seq INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (series, year)
  )`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // ESCALERA · PASO 7 · PIEZA 5 — SISTEMA DE CITAS (motor + agenda interna)
  // Un SOLO motor para dos negocios: cita previa (peluquería/estética/salud) y servicios por horas.
  // TODO aditivo, idempotente, SIN DROP. TODAS estas tablas van FUERA de WRITABLE_TABLES (DISA solo
  // LEE la agenda, nunca la escribe: pieza 1.14). NO tocan Verifactu, P&G, proyectos ni el calendario
  // FISCAL (calendario-fiscal.js, otra cosa). El cobro y el registro de tiempo REUTILIZAN los motores
  // ya existentes (createInvoice / emitTicketSvc / time_entries); aquí no nace ningún camino de emisión.
  // Horas guardadas como MINUTOS desde medianoche (enteros) en hora local del negocio (Europe/Madrid):
  // sin husos ni DST dentro de la aritmética; la zona solo se aplica al resolver "hoy"/"ahora".
  // ══════════════════════════════════════════════════════════════════════════════════════════════

  // 1.2 RECURSOS — silla, cabina, sala, box, equipo. Una cita puede exigir persona Y recurso.
  db.exec(`CREATE TABLE IF NOT EXISTS recursos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'otro',
    notas TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_recursos_active ON recursos(active)`);

  // 1.1 SERVICIO RESERVABLE — capa de gestión SOBRE el producto-servicio que YA existe (products.type
  // ='service'). NO es un segundo catálogo: precio e IVA SIGUEN viniendo de products (fuente única).
  // Aquí solo lo que la reserva necesita: duración, tiempo muerto INTERIOR (la persona queda LIBRE ese
  // rato — el tinte), margen posterior (limpieza/cobro). product_id es la PK: relación 1-a-1 con la
  // fila de catálogo. Se borra en cascada lógica: si el producto deja de ser servicio, esta fila queda
  // inerte (reservable=0). Minutos, enteros.
  db.exec(`CREATE TABLE IF NOT EXISTS service_config (
    product_id INTEGER PRIMARY KEY,
    reservable INTEGER NOT NULL DEFAULT 1,
    duracion_min INTEGER NOT NULL DEFAULT 30,
    muerto_ini_min INTEGER NOT NULL DEFAULT 0,
    muerto_dur_min INTEGER NOT NULL DEFAULT 0,
    margen_min INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT
  )`);
  // Quién puede prestar el servicio (persona) y qué recurso necesita. Vacío = "cualquiera" / "ninguno".
  db.exec(`CREATE TABLE IF NOT EXISTS service_providers (
    product_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    PRIMARY KEY (product_id, user_id)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS service_resources (
    product_id INTEGER NOT NULL,
    recurso_id INTEGER NOT NULL,
    PRIMARY KEY (product_id, recurso_id)
  )`);

  // 1.3 HORARIOS — del negocio y de cada persona. Cada FILA es un TRAMO abierto de un día de la semana
  // (dow 0=domingo … 6=sábado, como JS Date.getDay). Los DESCANSOS son el hueco ENTRE dos tramos del
  // mismo día (9-14 y 16-20 → dos filas; 14-16 es el descanso). scope='negocio' (user_id NULL) o
  // scope='user'. Una persona SIN filas hereda el horario del negocio; con filas, manda el suyo
  // (intersecado con el del negocio). Minutos desde medianoche.
  db.exec(`CREATE TABLE IF NOT EXISTS horario_tramos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL DEFAULT 'negocio',
    user_id INTEGER,
    dow INTEGER NOT NULL,
    inicio_min INTEGER NOT NULL,
    fin_min INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_horario_scope ON horario_tramos(scope, user_id, dow)`);

  // Excepciones con FECHA (vacaciones, festivo, cierre puntual, horario especial). LA EXCEPCIÓN MANDA
  // sobre la regla semanal para ese día+ámbito. tipo='cerrado' → cerrado todo el día; tipo='horario'
  // → estos tramos EN LUGAR de los semanales (una fila por tramo). scope negocio/user igual que arriba.
  db.exec(`CREATE TABLE IF NOT EXISTS horario_excepciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL DEFAULT 'negocio',
    user_id INTEGER,
    fecha TEXT NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'cerrado',
    inicio_min INTEGER,
    fin_min INTEGER,
    motivo TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_horario_exc ON horario_excepciones(scope, user_id, fecha)`);

  // 1.5 LA CITA. Cliente de la ficha (cliente_id) o cliente SUELTO (nombre + móvil). Uno o varios
  // servicios encadenados (tabla cita_servicios). Persona SIEMPRE; recurso opcional. Horas en minutos
  // locales. La GEOMETRÍA (duración/tiempo muerto/margen) se CONGELA en cita_servicios al reservar
  // (misma filosofía que el coste-hora: cambiar el default de un servicio HOY no mueve una cita ya
  // puesta). Estados: pedida → confirmada → atendida | no_show | anulada. Archivar-no-borrar.
  // 1.9 token = LLAVE no adivinable del enlace público; token_expira caduca pasada la cita.
  // 1.8 invoice_id / time_entry_id se rellenan si al ATENDER se cobró / se generó entrada de tiempo.
  db.exec(`CREATE TABLE IF NOT EXISTS citas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT,
    cliente_id INTEGER,
    cliente_suelto_nombre TEXT DEFAULT '',
    cliente_suelto_movil TEXT DEFAULT '',
    user_id INTEGER NOT NULL,
    recurso_id INTEGER,
    fecha TEXT NOT NULL,
    inicio_min INTEGER NOT NULL,
    dur_min INTEGER NOT NULL DEFAULT 0,
    margen_min INTEGER NOT NULL DEFAULT 0,
    estado TEXT NOT NULL DEFAULT 'pedida',
    nota TEXT DEFAULT '',
    project_id INTEGER,
    token TEXT,
    token_expira INTEGER,
    invoice_id INTEGER,
    time_entry_id INTEGER,
    confirmada_at TEXT,
    atendida_at TEXT,
    anulada_at TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT
  )`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_citas_codigo ON citas(codigo)`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_citas_token ON citas(token) WHERE token IS NOT NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_citas_fecha ON citas(fecha)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_citas_user ON citas(user_id, fecha)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_citas_recurso ON citas(recurso_id, fecha)`);
  // ── QUIÉN ANULÓ LA CITA (Tarea 2 · cabo 4, 20 ago 2026) ─────────────────────────────────────
  // ADITIVA Y NADA MÁS: `anulada_at` NO se toca ni se renombra — sigue diciendo CUÁNDO. Esta columna
  // dice QUIÉN, que es otra pregunta y hasta hoy no se guardaba en ninguna parte.
  //
  // TRES VALORES Y NI UNO MÁS: 'cliente' · 'negocio' · 'automatico'. Sin texto libre: un motivo
  // escrito a mano no se puede contar, y lo que no se puede contar no sirve para separar el plantón
  // del cierre del negocio, que es para lo que existe este dato.
  //
  // NULL SIGNIFICA «SIN REGISTRAR», Y ESO SE RESPETA. Las citas anuladas antes de esta migración se
  // quedan en NULL para siempre: no se les adivina un autor. Inventar el pasado para que la columna
  // quede bonita es exactamente cómo un dato empieza a mentir.
  //
  // OJO: «no se presentó» NO vive aquí. Es un ESTADO de la cita (`no_show`, en citas-engine.js) desde
  // el peldaño 8, y se queda donde está: nadie anuló nada, sencillamente no vino.
  addCol(db, 'citas', 'anulada_por', "TEXT");

  // Servicios ENCADENADOS de una cita, en orden. Geometría CONGELADA al reservar (ver arriba). El
  // nombre y el precio del servicio se leen EN VIVO del catálogo al pintar/cobrar (fuente única).
  //   offset_min  — inicio del servicio relativo al inicio de la cita.
  //   muerto_*    — ventana interior en la que la PERSONA queda libre (relativa al inicio del servicio).
  db.exec(`CREATE TABLE IF NOT EXISTS cita_servicios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cita_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    orden INTEGER NOT NULL DEFAULT 0,
    offset_min INTEGER NOT NULL DEFAULT 0,
    dur_min INTEGER NOT NULL DEFAULT 0,
    muerto_ini_min INTEGER NOT NULL DEFAULT 0,
    muerto_dur_min INTEGER NOT NULL DEFAULT 0
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cita_servicios_cita ON cita_servicios(cita_id)`);

  // 1.7 BLOQUEAR un rato sin cita (comida, recado, mantenimiento de un recurso). Cuenta como ocupado
  // para los huecos y para la guarda de solape. Puede colgar de una persona y/o de un recurso.
  db.exec(`CREATE TABLE IF NOT EXISTS agenda_bloqueos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    recurso_id INTEGER,
    fecha TEXT NOT NULL,
    inicio_min INTEGER NOT NULL,
    fin_min INTEGER NOT NULL,
    motivo TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bloqueos_fecha ON agenda_bloqueos(fecha)`);

  // 1.10/1.12 RASTRO DE AVISOS. Un aviso = confirmación o recordatorio, por un canal. estado honesto:
  // por la vía MANUAL solo sabemos que se pulsó el botón → 'marcado' (con canal y hora); por email
  // automático → 'email_enviado' / 'email_fallo'. PROHIBIDO 'entregado'/'leído' por estas vías.
  db.exec(`CREATE TABLE IF NOT EXISTS cita_avisos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cita_id INTEGER NOT NULL,
    tipo TEXT NOT NULL,
    canal TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'marcado',
    enviado_at TEXT DEFAULT CURRENT_TIMESTAMP,
    por_user_id INTEGER,
    nota TEXT DEFAULT ''
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cita_avisos_cita ON cita_avisos(cita_id, tipo)`);

  // 1.13 EL DATO listo para cuando llegue el canal automático (NO se construye capa de canales; solo
  // el DATO). Móvil en formato internacional + marca de "sin móvil válido" + consentimiento RGPD con
  // fecha. Aditivo sobre clients.
  addCol(db, 'clients', 'movil_e164', "TEXT DEFAULT ''");
  addCol(db, 'clients', 'movil_invalido', 'INTEGER NOT NULL DEFAULT 0');
  addCol(db, 'clients', 'consiente_avisos', 'INTEGER NOT NULL DEFAULT 0');
  addCol(db, 'clients', 'consiente_avisos_fecha', 'TEXT');

  // 1.4/1.10 AJUSTES de citas del negocio (en company_config, junto al resto de config). Rejilla,
  // antelación mínima, ventana máxima, corte del mismo día, canal por defecto y modo de recordatorio.
  addCol(db, 'company_config', 'cita_grid_min', 'INTEGER NOT NULL DEFAULT 30');            // rejilla 15/30
  addCol(db, 'company_config', 'cita_antelacion_min', 'INTEGER NOT NULL DEFAULT 0');       // antelación mínima (min)
  addCol(db, 'company_config', 'cita_ventana_dias', 'INTEGER NOT NULL DEFAULT 60');        // ventana máxima (días)
  addCol(db, 'company_config', 'cita_corte_mismo_dia_min', 'INTEGER');                     // hora de corte del mismo día (min desde medianoche); NULL = sin corte
  addCol(db, 'company_config', 'cita_margen_defecto_min', 'INTEGER NOT NULL DEFAULT 0');   // margen posterior por defecto
  addCol(db, 'company_config', 'cita_canal_defecto', "TEXT NOT NULL DEFAULT 'whatsapp'");  // whatsapp | sms | email
  addCol(db, 'company_config', 'cita_modo_recordatorio', "TEXT NOT NULL DEFAULT 'manual'"); // manual | auto_email
  // AGENDA SENCILLA — cómo llama ESTE negocio a sus "puestos" en su pantalla (silla, cabina, sala…).
  // Es SOLO una etiqueta de presentación: la tabla sigue siendo `recursos` y el código no se renombra.
  addCol(db, 'company_config', 'cita_puesto_sing', "TEXT NOT NULL DEFAULT 'Puesto'");
  addCol(db, 'company_config', 'cita_puesto_plural', "TEXT NOT NULL DEFAULT 'Puestos'");

  // ══ PASO 8 — PERFIL DE OFICIO ════════════════════════════════════════════════════════════════
  // A qué se dedica el negocio. Enum de 6 resuelto en modules/erp/oficios.js (peluqueria, estetica,
  // salud, taller, asesoria, otro). Hace EXACTAMENTE DOS COSAS: cambia palabras de pantalla y precarga
  // el catálogo de servicios. No enciende ni apaga nada, no toca el motor de citas.
  //
  // NACE EN 'otro' A PROPÓSITO: los negocios que YA existen no se enteran de esto. 'otro' llama a los
  // puestos "Puesto/Puestos" —el mismo default histórico de las dos columnas de arriba— y no trae
  // catálogo, así que ven exactamente lo que veían ayer. Aditiva: una columna, sin DROP, sin reescribir.
  addCol(db, 'company_config', 'oficio', "TEXT NOT NULL DEFAULT 'otro'");

  // ══ PIEZA 6 — PUERTA PÚBLICA DE RESERVA ══════════════════════════════════════════════════════
  // Todo lo de abajo es ADITIVO sobre la pieza 5: ni una columna se reescribe, ni una tabla se
  // recrea, ningún DROP. El motor (huecos/solape/horarios) NO se toca: se USA.
  //
  // EL INTERRUPTOR ESTÁ APAGADO. `cita_pub_activa` nace en 0: hasta que el dueño lo enciende, las
  // rutas públicas responden 404 — no "vacío", 404. Un negocio que actualiza no publica nada por
  // sorpresa, y esa es la propiedad que hay que poder demostrar en una migración de este tipo.
  addCol(db, 'company_config', 'cita_pub_activa', 'INTEGER NOT NULL DEFAULT 0');
  // La dirección propia: https://<negocio>.bamburu.com/reservar/<handle>. El negocio lo sigue
  // resolviendo el SUBDOMINIO (no se toca tenant-middleware ni control.db); el handle se comprueba
  // contra el del tenant ya resuelto y, si no cuadra, 404. Vacío = se genera del nombre del negocio.
  addCol(db, 'company_config', 'cita_pub_handle', "TEXT NOT NULL DEFAULT ''");
  // Antelación mínima y máxima PROPIAS de la puerta pública (defectos del encargo: 2 h y 60 días).
  // No pisan `cita_antelacion_min`/`cita_ventana_dias` (las de dentro): se pasan como ARGUMENTOS al
  // mismo huecos() del motor, así que no hay un segundo cálculo que pueda desviarse del primero.
  addCol(db, 'company_config', 'cita_pub_antelacion_min', 'INTEGER NOT NULL DEFAULT 120');
  addCol(db, 'company_config', 'cita_pub_ventana_dias', 'INTEGER NOT NULL DEFAULT 60');
  // 'auto' = confirmación automática (defecto) · 'aprobar' = el dueño aprueba. En 'aprobar' la
  // solicitud RETIENE el hueco (la cita existe y ocupa) y caduca sola a las N horas sin respuesta.
  addCol(db, 'company_config', 'cita_pub_modo', "TEXT NOT NULL DEFAULT 'auto'");
  addCol(db, 'company_config', 'cita_pub_retencion_horas', 'INTEGER NOT NULL DEFAULT 24');
  // Ventana en que el cliente puede cambiar o anular desde su enlace. `_activo`=0 lo desactiva.
  addCol(db, 'company_config', 'cita_pub_cancelar_horas', 'INTEGER NOT NULL DEFAULT 24');
  addCol(db, 'company_config', 'cita_pub_cancelar_activo', 'INTEGER NOT NULL DEFAULT 1');
  // Texto de la política de cancelación (se MUESTRA antes de confirmar y se repite en el email) y
  // enlace a la política de privacidad que acompaña a la casilla de consentimiento.
  addCol(db, 'company_config', 'cita_pub_politica', "TEXT NOT NULL DEFAULT ''");
  addCol(db, 'company_config', 'cita_pub_privacidad_url', "TEXT NOT NULL DEFAULT ''");

  // ── LA PÁGINA DE RESERVAS SE ENCIENDE SOLA (decisión de Ibrahin, 18 ago 2026) ────────────────────
  // `cita_pub_auto` = el encendido automático YA SE INTENTÓ en este negocio. Es un pestillo de UNA
  // SOLA VEZ, y es lo que hace honesto el interruptor de apagado: si el automatismo pudiera volver a
  // encenderla, apagarla sería mentira. Nace en 0 → todavía no ha pasado.
  // `cita_pub_auto_visto` = el dueño ya vio el aviso de que se encendió (lo apagó o dijo "vale"), así
  // que el aviso deja de aparecer. Separado del pestillo porque son dos hechos distintos.
  addCol(db, 'company_config', 'cita_pub_auto', 'INTEGER NOT NULL DEFAULT 0');
  addCol(db, 'company_config', 'cita_pub_auto_visto', 'INTEGER NOT NULL DEFAULT 0');

  // Un servicio reservable DENTRO no es reservable DESDE FUERA. Son dos permisos distintos y el de
  // fuera nace en 0: el dueño elige uno a uno qué enseña. `reservable` (pieza 5) sigue significando
  // exactamente lo que significaba.
  addCol(db, 'service_config', 'publico', 'INTEGER NOT NULL DEFAULT 0');

  // Quién aparece fuera, y CON QUÉ NOMBRE. Tabla propia en vez de columnas en `admin_users`: esa es
  // la tabla de autenticación y no se le añaden campos de escaparate. Por defecto NO aparece nadie.
  // `nombre_publico` es el nombre que pone el DUEÑO; si está vacío, la puerta pública NO cae al
  // admin_users.name — enseña "Profesional" (F: el usuario del sistema no se filtra jamás).
  db.exec(`CREATE TABLE IF NOT EXISTS cita_pub_personas (
    user_id INTEGER PRIMARY KEY,
    visible INTEGER NOT NULL DEFAULT 0,
    nombre_publico TEXT NOT NULL DEFAULT '',
    updated_at TEXT
  )`);

  // La cita NACIDA FUERA. Fila 1-a-1 con `citas`; su MERA EXISTENCIA es la marca de origen público,
  // así que la tabla `citas` de la pieza 5 no cambia ni un bit y sus citas se comportan como hoy.
  // Aquí vive lo que solo tiene sentido en una reserva de fuera:
  //   · email        — el cliente suelto de la pieza 5 no tiene email y aquí hace falta para confirmar
  //   · consent_*    — casilla obligatoria: se guarda el TEXTO EXACTO aceptado y la fecha y hora
  //   · politica_texto — la política de cancelación TAL COMO SE MOSTRÓ (no la de hoy: la de entonces)
  //   · aprobacion   — 'auto' | 'pendiente' | 'aprobada' | 'rechazada' | 'caducada'
  //   · retiene_hasta— epoch en que la solicitud pendiente caduca sola (modo "yo apruebo")
  db.exec(`CREATE TABLE IF NOT EXISTS cita_reserva_publica (
    cita_id INTEGER PRIMARY KEY,
    email TEXT NOT NULL DEFAULT '',
    consent_texto TEXT NOT NULL DEFAULT '',
    consent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    politica_texto TEXT NOT NULL DEFAULT '',
    aprobacion TEXT NOT NULL DEFAULT 'auto',
    retiene_hasta INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cita_reserva_pub_aprob ON cita_reserva_publica(aprobacion)`);


  // A3: catálogo de servicios del autónomo. Tabla NUEVA e independiente de
  // `products` (e-commerce, Capa 2 congelada). El autónomo guarda lo que repite
  // (nombre + precio + IVA + IRPF) y lo reutiliza al facturar. Las líneas de
  // factura COPIAN estos valores en invoice_items, así que borrar un servicio
  // NO afecta a facturas ya emitidas.
  // P3: unificar catálogo. La tabla suelta `services` (A3) se migra a productos de
  // tipo 'servicio' y se elimina. El IVA (número) se mapea a banda legal; el IRPF del
  // servicio se descarta (CANON: el IRPF no es del producto). SKU autogenerado SVC-NNNN.
  // No se recrea la tabla: tenants nuevos nunca la tienen → se salta.
  const svcMigKey = 'migration_services_to_products_2026_v1';
  const hasServicesTable = db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name='services'").get().n;
  if (hasServicesTable && !db.prepare('SELECT value FROM settings WHERE key=?').get(svcMigKey)) {
    const rateToBand = { 21: 'general', 10: 'reducido', 4: 'superreducido', 0: 'exento' };
    const rows = db.prepare('SELECT * FROM services ORDER BY id').all();
    const ins = db.prepare(`INSERT INTO products (name,slug,sku,price,stock,status,type,tax_rate,tax_band) VALUES (?,?,?,?,?,?,?,?,?)`);
    const migrate = db.transaction(() => {
      for (const s of rows) {
        let band = rateToBand[Math.round(Number(s.tax_rate))];
        let rate;
        if (band) { rate = Number(s.tax_rate); } else { band = 'general'; rate = 21; }  // tasa rara → General
        const baseSlug = String(s.name || 'servicio').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'servicio';
        ins.run(s.name || 'Servicio', baseSlug + '-svc-' + s.id, 'SVC-' + String(s.id).padStart(4, '0'),
                Number(s.base_price) || 0, 0, 'active', 'service', rate, band);
      }
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(svcMigKey, 'done');
      db.exec('DROP TABLE services');
    });
    migrate();
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS disa_conversations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      messages   TEXT NOT NULL DEFAULT '[]',
      context    TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS disa_usage (
      month      TEXT NOT NULL,
      count      INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (month)
    )
  `);

  // Gasto de Anthropic de ESTE negocio por mes natural (freno de gasto por-negocio, 5 €/mes).
  // En € (1 USD = 1 EUR a propósito; ver core/llm.js). La suma global vive en control.db.
  db.exec(`
    CREATE TABLE IF NOT EXISTS disa_spend (
      month      TEXT PRIMARY KEY,
      eur        REAL NOT NULL DEFAULT 0
    )
  `);

  // Límites de plataforma por-negocio que fija el SUPERADMIN (escritura sancionada desde el panel).
  // Hoy solo 'ai_cap_eur' (tope de gasto de IA/mes). Ausente = se usa el default de core/llm.js.
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_limits (
      key   TEXT PRIMARY KEY,
      value REAL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS disa_profile (
      id           INTEGER PRIMARY KEY CHECK(id = 1),
      business_type TEXT DEFAULT '',
      sector       TEXT DEFAULT '',
      description  TEXT DEFAULT '',
      goals        TEXT DEFAULT '',
      preferences  TEXT DEFAULT '',
      decisions    TEXT DEFAULT '',
      notes        TEXT DEFAULT '',
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`INSERT OR IGNORE INTO disa_profile (id) VALUES (1)`);

  // ── PERMISOS (ACL) ──────────────────────────────────────────────────────────────────────────
  // B12 · 23 ago 2026 — AQUÍ SE CREABAN TAMBIÉN `roles`, `role_permissions` y `user_roles`, y se
  // sembraban cuatro roles (Admin/Seller/Accountant/Viewer). Estaban MUERTAS desde siempre: la
  // aplicación de permisos lee SOLO `user_permissions`, así que ni concedían ni podían filtrar
  // nada. Se dejan de crear, y la migración de más abajo renombra las que ya existan a
  // `*_archived` — no se destruye ninguna, que es la regla permanente del proyecto.
  // `permissions` y `user_permissions` SE QUEDAN: son las que mandan de verdad.
  db.exec(`
    CREATE TABLE IF NOT EXISTS permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module TEXT NOT NULL,
      action TEXT NOT NULL,
      description TEXT,
      UNIQUE(module, action)
    );

    CREATE TABLE IF NOT EXISTS user_permissions (
      admin_user_id INTEGER NOT NULL,
      permission_id INTEGER NOT NULL,
      PRIMARY KEY (admin_user_id, permission_id),
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id),
      FOREIGN KEY (permission_id) REFERENCES permissions(id)
    );
  `);

  // (B12) La siembra de los cuatro roles predefinidos vivía aquí y se ha retirado con ellos.

  // Seed permisos predefinidos
  const permissionsData = [
    { module: 'products',  action: 'read',          description: 'Ver productos' },
    { module: 'products',  action: 'create',         description: 'Crear productos' },
    { module: 'products',  action: 'edit',           description: 'Editar productos' },
    { module: 'products',  action: 'delete',         description: 'Eliminar productos' },
    { module: 'orders',    action: 'read',           description: 'Ver pedidos' },
    { module: 'orders',    action: 'create',         description: 'Crear pedidos' },
    { module: 'orders',    action: 'edit',           description: 'Editar pedidos' },
    { module: 'orders',    action: 'update_status',  description: 'Cambiar estado' },
    { module: 'clients',   action: 'read',           description: 'Ver clientes' },
    { module: 'clients',   action: 'create',         description: 'Crear clientes' },
    { module: 'clients',   action: 'edit',           description: 'Editar clientes' },
    { module: 'invoices',  action: 'read',           description: 'Ver facturas' },
    { module: 'invoices',  action: 'create',         description: 'Generar facturas' },
    { module: 'admin',     action: 'manage_users',   description: 'Gestionar usuarios' },
    { module: 'admin',     action: 'manage_roles',   description: 'Gestionar roles' },
    { module: 'admin',     action: 'settings',       description: 'Configuración empresa' },
    { module: 'inventory', action: 'read',    description: 'Ver inventario' },
    { module: 'inventory', action: 'edit',    description: 'Editar inventario' },
    { module: 'suppliers', action: 'read',    description: 'Ver proveedores' },
    { module: 'suppliers', action: 'create',  description: 'Crear proveedores' },
    { module: 'suppliers', action: 'edit',    description: 'Editar proveedores' },
    { module: 'suppliers', action: 'delete',  description: 'Eliminar proveedores' },
    { module: 'purchases', action: 'read',    description: 'Ver compras' },
    { module: 'purchases', action: 'create',  description: 'Crear compras' },
    { module: 'purchases', action: 'edit',    description: 'Editar compras' },
    { module: 'purchases', action: 'delete',  description: 'Eliminar compras' },
    { module: 'discounts', action: 'read',    description: 'Ver descuentos' },
    { module: 'discounts', action: 'create',  description: 'Crear descuentos' },
    { module: 'discounts', action: 'edit',    description: 'Editar descuentos' },
    { module: 'discounts', action: 'delete',  description: 'Eliminar descuentos' },
    { module: 'categories',action: 'read',    description: 'Ver categorías' },
    { module: 'categories',action: 'create',  description: 'Crear categorías' },
    { module: 'categories',action: 'edit',    description: 'Editar categorías' },
    { module: 'categories',action: 'delete',  description: 'Eliminar categorías' },
    { module: 'tags',      action: 'read',    description: 'Ver etiquetas' },
    { module: 'tags',      action: 'create',  description: 'Crear etiquetas' },
    { module: 'tags',      action: 'edit',    description: 'Editar etiquetas' },
    { module: 'tags',      action: 'delete',  description: 'Eliminar etiquetas' },
    { module: 'analytics', action: 'read',    description: 'Ver analítica' },
    { module: 'activity',  action: 'read',    description: 'Ver actividad' },
    { module: 'feedback',  action: 'create',  description: 'Enviar comentarios' },
    { module: 'sales',     action: 'emit_over_stock', description: 'Emitir factura con exceso de stock (físicos)' },
    { module: 'quotes',    action: 'read',    description: 'Ver presupuestos' },
    { module: 'quotes',    action: 'create',  description: 'Crear presupuestos' },
    { module: 'quotes',    action: 'edit',    description: 'Editar/emitir presupuestos' },
    { module: 'pedidos',   action: 'read',    description: 'Ver pedidos' },
    { module: 'pedidos',   action: 'create',  description: 'Crear pedidos' },
    { module: 'pedidos',   action: 'edit',    description: 'Editar/confirmar/anular pedidos' },
    { module: 'albaranes', action: 'read',    description: 'Ver albaranes (entregas)' },
    { module: 'albaranes', action: 'create',  description: 'Crear/confirmar albaranes (entregar)' },
    { module: 'albaranes', action: 'edit',    description: 'Anular albaranes / facturar entregas' },
    // Permisos · Paso 1 FASE 2 — Cobros con permiso propio (antes iba por orders.read, del POS retirado).
    { module: 'cobros',    action: 'read',    description: 'Ver Cobros: deudas, worklist y estado de cobro' },
    { module: 'cobros',    action: 'manage',  description: 'Registrar cobros y acciones de cobro/cuenta' },
    // Conciliación bancaria · Pieza 1 — permiso propio (registrar un cobro desde aquí exige además cobros.manage).
    { module: 'conciliacion', action: 'read',   description: 'Ver conciliación bancaria: movimientos y estado' },
    { module: 'conciliacion', action: 'manage', description: 'Importar extractos (Norma 43) y conciliar/ignorar/deshacer' },
    { module: 'recurrentes',  action: 'read',   description: 'Ver facturas recurrentes: plantillas y borradores' },
    { module: 'recurrentes',  action: 'manage', description: 'Crear/editar/pausar plantillas recurrentes' },
    // CRM comercial — permiso propio. NO se reutiliza clients.* : ver la ficha de un cliente y
    // gobernar el embudo de ventas son dos accesos distintos (un administrativo puede necesitar
    // el primero sin el segundo). `manage` cubre crear/mover/cerrar oportunidad y registrar actividad.
    { module: 'crm',       action: 'read',   description: 'Ver el CRM: embudo de oportunidades y actividad de cliente' },
    { module: 'crm',       action: 'manage', description: 'Crear/mover/cerrar oportunidades y registrar actividad de cliente' },
    // Peldaño 7 · servicios profesionales — Proyectos. `edit` cubre crear/editar/archivar/restaurar.
    { module: 'proyectos', action: 'read',   description: 'Ver proyectos' },
    { module: 'proyectos', action: 'edit',   description: 'Crear/editar/archivar/restaurar proyectos' },
    // Peldaño 7 · PIEZA 2 — Registro de tiempo. `edit` = registrar/editar; la PROPIEDAD restringe a las
    // propias (dueño/admin, por bypass, gestionan las de cualquiera).
    { module: 'tiempo',    action: 'read',   description: 'Ver el registro de tiempo' },
    { module: 'tiempo',    action: 'edit',   description: 'Registrar y editar entradas de tiempo (las propias)' },
    // Peldaño 7 · PIEZA 5 — Sistema de citas. `edit` cubre crear/mover/confirmar/atender/anular citas,
    // gestionar recursos, horarios, servicios reservables y la cola de envíos. El enlace público de la
    // cita va por LLAVE (token), no por este permiso: no expone nada más que su propia cita.
    { module: 'citas',     action: 'read',   description: 'Ver la agenda de citas, recursos y horarios' },
    { module: 'citas',     action: 'edit',   description: 'Crear/mover/confirmar/atender/anular citas y gestionar recursos, horarios y avisos' },
    // 21 ago 2026 · DECISIÓN DEL DUEÑO. Hasta hoy la agenda tenía UN SOLO candado: quien podía verla
    // veía las citas de TODO EL EQUIPO — nombres de cliente incluidos. `ver_todas` separa las dos
    // cosas. SIN este permiso, el servidor solo devuelve LAS CITAS PROPIAS, y también las horas
    // libres se calculan solo sobre las suyas: enseñar la capacidad de gente cuya agenda no puedes
    // ver sería la misma fuga por otra puerta. El dueño y los administradores lo tienen por bypass
    // de rol (`can()`), así que a ellos no les cambia nada.
    { module: 'citas',     action: 'ver_todas', description: 'Ver la agenda de TODO el equipo (sin este permiso, cada persona ve solo sus citas)' },
  ];
  for (const p of permissionsData) {
    db.prepare('INSERT OR IGNORE INTO permissions (module, action, description) VALUES (?, ?, ?)').run(p.module, p.action, p.description);
  }

  // Seed role_permissions
  // (B12 · 23 ago 2026) AQUÍ SE SEMBRABA `role_permissions`: qué permisos llevaba cada uno de los
  // cuatro roles. Se retira con ellos. **Lo sembrado sigue legible** en `role_permissions_archived`,
  // y el reparto que describía queda además escrito en el TABLERO, por si algún día se decide
  // construir permisos por rol de verdad: sería el punto de partida, no un dato perdido.

  // DISA — Multi-agentes
  db.exec(`
    CREATE TABLE IF NOT EXISTS disa_agents (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT UNIQUE NOT NULL,
      slug            TEXT UNIQUE NOT NULL,
      specialization  TEXT NOT NULL,
      system_prompt   TEXT NOT NULL,
      description     TEXT,
      icon            TEXT DEFAULT '🤖',
      active          INTEGER DEFAULT 1,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS disa_agent_instructions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id         INTEGER NOT NULL,
      instruction_text TEXT NOT NULL,
      priority         INTEGER DEFAULT 0,
      FOREIGN KEY (agent_id) REFERENCES disa_agents(id)
    );
  `);

  addCol(db, 'disa_conversations', 'agent_id', 'INTEGER DEFAULT 1');

  // DISA — Threads (conversaciones separadas tipo ChatGPT)
  db.exec(`
    CREATE TABLE IF NOT EXISTS disa_conversation_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT 'Nueva conversación',
      user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_active INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_threads_updated
      ON disa_conversation_threads(updated_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS disa_quick_chips (
      user_id INTEGER PRIMARY KEY,
      chips TEXT NOT NULL DEFAULT '[]',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  addCol(db, 'disa_conversations', 'thread_id', 'INTEGER');

  // Migrar mensajes sin thread → thread histórico
  db.prepare(`
    INSERT INTO disa_conversation_threads (title, created_at)
      SELECT 'Conversaciones previas', mindate
      FROM (SELECT MIN(created_at) AS mindate FROM disa_conversations WHERE thread_id IS NULL)
      WHERE mindate IS NOT NULL
  `).run();

  db.prepare(`
    UPDATE disa_conversations
      SET thread_id = (SELECT id FROM disa_conversation_threads ORDER BY id LIMIT 1)
      WHERE thread_id IS NULL
  `).run();

  // Seed agentes predefinidos
  const agentsData = [
    {
      slug: 'disa_admin',
      name: 'DISA Administración',
      specialization: 'Configuración, usuarios, reportes',
      icon: '⚙️',
      system_prompt: `Eres el asistente administrativo de Bamburu. Tu rol es ayudar con:
- Configuración de empresa (nombre, país, moneda)
- Gestión de usuarios y roles
- Generación de reportes
- Análisis de rendimiento

Sé directo, eficiente y proactivo. Si el usuario pregunta sobre ventas o productos, canaliza a DISA Ventas.`,
    },
    {
      slug: 'disa_ventas',
      name: 'DISA Ventas',
      specialization: 'Pedidos, clientes, descuentos',
      icon: '📊',
      system_prompt: `Eres el jefe de ventas de Bamburu. Tu rol es ayudar con:
- Gestión de pedidos (crear, editar, cambiar estado)
- Gestión de clientes (crear, editar, analizar)
- Descuentos y promociones
- Análisis de ventas y tendencias

Enfócate en aumentar ingresos y satisfacción del cliente.`,
    },
    {
      slug: 'disa_web',
      name: 'DISA Web',
      specialization: 'Tienda, productos, categorías',
      icon: '🛒',
      system_prompt: `Eres el gerente de ecommerce de Bamburu. Tu rol es ayudar con:
- Gestión de productos (crear, editar, categorizar)
- Variantes de producto (tallas, colores, etc.)
- Inventario y stock
- Catálogo de la tienda

Enfócate en la experiencia del cliente y las conversiones.`,
    },
    {
      slug: 'disa_finanzas',
      name: 'DISA Finanzas',
      specialization: 'Ingresos, gastos, impuestos',
      icon: '💰',
      system_prompt: `Eres el contador de Bamburu. Tu rol es ayudar con:
- Análisis de ingresos y gastos
- Cálculo de impuestos
- Reportes financieros
- Flujo de caja

Sé preciso con los números y siempre redondea correctamente.`,
    },
  ];

  for (const agent of agentsData) {
    db.prepare(`
      INSERT OR IGNORE INTO disa_agents (name, slug, specialization, system_prompt, icon)
      VALUES (?, ?, ?, ?, ?)
    `).run(agent.name, agent.slug, agent.specialization, agent.system_prompt, agent.icon);
  }

  // ── D1 — ARCHIVAR clúster viejo de ventas + cuentas de tienda (rename → _archived, idempotente) ──
  // "Eliminar" = archivar, NUNCA DROP. Solo renombra si la tabla existe y su _archived aún NO. Va al
  // final, después de los CREATE (que quedan guardados por `d1Archived` para no reaparecer vacías).
  // NO se archivan aquí (lectores admin VIVOS → requieren desmontar su UI = D2): product_reviews
  // (routes/reviews.js) y newsletter_subscribers (routes/newsletter.js + clients.js). `refunds` queda
  // fuera de la lista (cuelga del POS viejo; no pedida).
  const d1Key = 'migration_d1_archive_store_2026_v1';
  if (!db.prepare('SELECT value FROM settings WHERE key=?').get(d1Key)) {
    const archiveTable = (name) => {
      const src = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
      const dst = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name + '_archived');
      if (src && !dst) db.exec(`ALTER TABLE ${name} RENAME TO ${name}_archived`);
    };
    const tx = db.transaction(() => {
      ['sales_orders', 'sales_items', 'order_status_history',
       'customer_accounts', 'customer_sessions', 'wishlist'].forEach(archiveTable);
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(d1Key, 'done');
    });
    tx();
  }

  // ── D2 — ARCHIVAR restos e-commerce (rename → _archived, idempotente, sin DROP) ──
  // Solo tras desmontar su UI (feedback, reviews, newsletter, shipping). NO incluye:
  // tags/product_tags (función viva del catálogo, decisión del dueño) ni store_settings (se
  // conserva el diseño por si la tienda vuelve en Capa 2). Mismo helper/patrón que D1.
  const d2Key = 'migration_d2_archive_ecommerce_2026_v1';
  if (!db.prepare('SELECT value FROM settings WHERE key=?').get(d2Key)) {
    const archiveTable = (name) => {
      const src = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
      const dst = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name + '_archived');
      if (src && !dst) db.exec(`ALTER TABLE ${name} RENAME TO ${name}_archived`);
    };
    const tx2 = db.transaction(() => {
      ['feedback', 'product_reviews', 'newsletter_subscribers', 'shipping_methods'].forEach(archiveTable);
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(d2Key, 'done');
    });
    tx2();
  }

  // ── ENCARGO CUPONES — ARCHIVAR (rename → _archived, idempotente, sin DROP) ───────────────────
  // ⚠️ LA CLAVE DE LA BANDERA DICE `_b_` Y SE QUEDA ASÍ. Se escribió cuando este encargo se llamaba
  // «ficha B», nombre que ya tenía la ficha de la migración asistida del mismo día. El nombre humano
  // se corrigió; la clave NO se puede tocar: ya está puesta en las BD, y cambiarla haría `bArchived`
  // falso, recrearía `discount_codes` VACÍA y dejaría la tabla viva y la archivada a la vez.
  // Solo tras desmontar su UI y su API (`/admin/discounts`, `/api/erp/discounts`, routes/index.js) y
  // cortar la superficie de DISA (acciones dedicadas, vía genérica, allowlist de lectura, URLs).
  // "Eliminar" = archivar, NUNCA DROP: los tres cupones que existen en `desarrollo-bamburu` siguen
  // ahí, legibles en `discount_codes_archived`. Mismo helper y mismo patrón que D1 y D2.
  //
  // Los PERMISOS `discounts.*` NO se tocan a propósito: el encargo dice que no se tocan permisos, y
  // borrarlos de `permissions` arrastraría filas de `user_permissions` de usuarios reales. Se quedan
  // asignables y sin pantalla que abrir, igual que quedaron los de las áreas que apagaron D1 y D2.
  const bKey = 'migration_b_archive_discounts_2026_v1';
  if (!db.prepare('SELECT value FROM settings WHERE key=?').get(bKey)) {
    const archiveTable = (name) => {
      const src = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
      const dst = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name + '_archived');
      if (src && !dst) db.exec(`ALTER TABLE ${name} RENAME TO ${name}_archived`);
    };
    const txB = db.transaction(() => {
      ['discount_codes', 'auto_discounts'].forEach(archiveTable);
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(bKey, 'done');
    });
    txB();
  }

  // ── DESCUENTOS, PROMOCIONES Y BONOS (23 ago 2026, noche · punto 11) ─────────────────────────
  // TODO ADITIVO E IDEMPOTENTE. Y la decisión que lo gobierna todo, escrita aquí porque es la que
  // hace que esto NO toque el motor fiscal:
  //
  //   **UN DESCUENTO ES UNA LÍNEA DEL DOCUMENTO, no una columna de la cabecera.**
  //
  // Una línea con importe negativo y el MISMO tipo de IVA que lo que rebaja. `computeTotals` ya la
  // suma bien —el subtotal baja, el IVA baja en proporción y el desglose por tipo cuadra—, así que
  // no cambia ni una línea del cálculo, ni el sello, ni VERI*FACTU. Y en el papel se LEE: el cliente
  // ve qué le has descontado y por qué, en vez de un total más bajo sin explicación.
  //
  // La otra decisión: EL MOTOR PROPONE, EL USUARIO CONFIRMA (CANON). Ningún descuento se mete solo
  // en una factura. Se calcula, se enseña, y quien emite decide.
  addCol(db, 'clients', 'descuento_pct', 'REAL NOT NULL DEFAULT 0');   // el que lleva SIEMPRE ese cliente
  db.exec(`
    -- PROMOCIONES: una regla con fecha. Lo que antes eran «cupones» de la tienda (con código, para
    -- un carrito) pasa a ser esto, que es lo que un autónomo usa de verdad: «en agosto, 15 % en
    -- revisiones». El CÓDIGO se conserva como campo opcional, para las que sí se dan a mano.
    CREATE TABLE IF NOT EXISTS promociones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      codigo TEXT DEFAULT '',                 -- opcional: si se rellena, hay que teclearlo
      tipo TEXT NOT NULL DEFAULT 'porcentaje' CHECK(tipo IN ('porcentaje','importe')),
      valor REAL NOT NULL DEFAULT 0,
      desde DATE, hasta DATE,                 -- NULL = sin límite por ese lado
      minimo REAL NOT NULL DEFAULT 0,         -- base mínima del documento para que aplique
      alcance TEXT NOT NULL DEFAULT 'todo' CHECK(alcance IN ('todo','categoria','producto')),
      categoria_id INTEGER, product_id INTEGER,
      usos_max INTEGER, usos INTEGER NOT NULL DEFAULT 0,
      activa INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (categoria_id) REFERENCES categories(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
    -- BONOS: un talonario prepagado de un cliente. Se VENDE como una línea normal de factura (el
    -- ingreso se declara al venderlo, que es el tratamiento simple y el que usa un autónomo que
    -- vende «un bono de 10 sesiones»), y CONSUMIRLO no emite factura: descuenta del talonario.
    CREATE TABLE IF NOT EXISTS bonos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      nombre TEXT NOT NULL,
      product_id INTEGER,                     -- a qué servicio da derecho (opcional)
      sesiones INTEGER NOT NULL DEFAULT 0,    -- cuántas trae
      usadas INTEGER NOT NULL DEFAULT 0,
      importe REAL NOT NULL DEFAULT 0,        -- lo que pagó por él
      invoice_id INTEGER,                     -- la factura con la que se vendió
      caduca DATE,
      activo INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
    -- Cada consumo, apuntado. Sin esto no se puede contestar «¿cuándo gastó las cinco?», y un
    -- talonario cuyo contador baja sin dejar rastro es exactamente lo que nadie se cree.
    CREATE TABLE IF NOT EXISTS bono_consumos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bono_id INTEGER NOT NULL,
      fecha DATE NOT NULL,
      sesiones INTEGER NOT NULL DEFAULT 1,
      cita_id INTEGER, nota TEXT DEFAULT '',
      user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (bono_id) REFERENCES bonos(id)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_promociones_activa ON promociones(activa, desde, hasta)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bonos_cliente ON bonos(client_id, activo)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bono_consumos ON bono_consumos(bono_id, fecha)`);

  // LOS TRES CUPONES ARCHIVADOS VUELVEN, convertidos en promociones (punto 11). Estaban legibles en
  // `discount_codes_archived` desde el encargo de cupones, y encajan: los tres son «un porcentaje o
  // un importe fijo, con su código». Lo que NO se recupera es su mecánica de carrito de tienda —esa
  // pantalla estaba muerta y la tienda está congelada—: entran con su código, y se aplican al
  // documento que se esté haciendo. Nacen INACTIVAS: recuperar no es encender.
  const promKey = 'migration_promos_desde_cupones_2026_v1';
  if (!db.prepare('SELECT value FROM settings WHERE key=?').get(promKey)) {
    const txP = db.transaction(() => {
      const hay = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='discount_codes_archived'").get();
      if (hay) {
        for (const c of db.prepare('SELECT * FROM discount_codes_archived').all()) {
          db.prepare(
            `INSERT INTO promociones (nombre, codigo, tipo, valor, minimo, usos_max, usos, activa, hasta)
             VALUES (?,?,?,?,?,?,?,0,?)`
          ).run(c.code, c.code, c.type === 'fixed' ? 'importe' : 'porcentaje', Number(c.value) || 0,
                Number(c.min_order) || 0, c.max_uses ?? null, Number(c.uses_count) || 0,
                c.expires_at ? String(c.expires_at).slice(0, 10) : null);
        }
      }
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(promKey, 'done');
    });
    txP();
  }

  // ── CONTROL HORARIO · EL REGISTRO DE JORNADA (23 ago 2026, noche · punto 12) ────────────────
  // OBLIGATORIO POR LEY en España desde el RD-ley 8/2019 (art. 34.9 ET) para quien tiene personas
  // contratadas: registro DIARIO de la jornada de cada trabajador, con su hora de INICIO y de FIN;
  // conservable **cuatro años**; y a disposición del trabajador, sus representantes y la Inspección.
  //
  // POR QUÉ ES UNA TABLA APARTE Y NO `time_entries`, que ya existe. Son dos cosas distintas y
  // mezclarlas estropearía las dos:
  //   · `time_entries` es tiempo DE PROYECTO, y sirve para FACTURAR horas. Lleva proyecto, si es
  //     facturable y su coste/hora congelado.
  //   · Una JORNADA no tiene proyecto ni se factura, e incluye la pausa de la comida. Si la metiera
  //     en `time_entries`, las horas facturables de un cliente incluirían el bocadillo, y el registro
  //     legal quedaría a merced de que alguien borrase una entrada de proyecto.
  // Lo que SÍ se comparte es el sitio: la pantalla vive junto al Registro de tiempo, en su área.
  //
  // ES UN LIBRO DE EVENTOS, no un estado. Se apuntan FICHAJES (entrada, pausa, vuelta, salida) y la
  // jornada se DERIVA de ellos. Un registro legal tiene que poder auditarse: si guardara solo «hoy
  // trabajó 7,5 h», nadie podría comprobar de dónde sale.
  //
  // Y NO SE BORRA NUNCA. Corregir un fichaje deja el original marcado (`corregido_de`), con quién y
  // por qué. Un registro de jornada que se puede reescribir en silencio no vale para lo que existe.
  db.exec(`
    CREATE TABLE IF NOT EXISTS fichajes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      fecha DATE NOT NULL,                    -- el día al que pertenece (el de la ENTRADA)
      hora TEXT NOT NULL,                     -- HH:MM, hora local del negocio
      tipo TEXT NOT NULL CHECK(tipo IN ('entrada','pausa','vuelta','salida')),
      origen TEXT NOT NULL DEFAULT 'pantalla',
      nota TEXT DEFAULT '',
      -- Corrección: NUNCA se edita el original. Se apunta uno nuevo que dice a cuál sustituye, y el
      -- viejo queda anulado con su motivo. Los dos siguen ahí.
      corregido_de INTEGER,
      anulado INTEGER NOT NULL DEFAULT 0,
      motivo TEXT DEFAULT '',
      hecho_por INTEGER,                      -- quién lo apuntó (puede no ser el trabajador)
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES admin_users(id),
      FOREIGN KEY (corregido_de) REFERENCES fichajes(id)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_fichajes_dia ON fichajes(user_id, fecha, anulado)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_fichajes_fecha ON fichajes(fecha)`);

  // ── AGENDA DEL CRM · TAREAS Y SEGUIMIENTOS (23 ago 2026, noche · punto 13) ──────────────────
  // QUÉ FALTABA, medido antes de escribir: `client_activities` ya guarda lo que PASÓ (contactos,
  // notas, compromisos) y hasta tiene `commitment_date` —«me llama el día X»—. Lo que no había es
  // una TAREA: algo pendiente, con **dueño** y **estado**, que avise cuando llega su día.
  //
  // POR QUÉ NO SE METE EN `client_activities`. Esa tabla es un REGISTRO de lo ocurrido, y la línea
  // de tiempo del cliente la pinta como historia. Meter ahí una tarea pendiente haría que el
  // historial enseñara como hecho algo que no ha pasado todavía. Son dos cosas y se quedan en dos
  // tablas — pero la línea de tiempo las junta al pintarlas, que es donde el dueño las quiere ver.
  //
  // ARCHIVAR, NUNCA BORRAR (regla del proyecto): una tarea se marca hecha o se anula con su motivo.
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_tareas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,                       -- puede ser de un cliente…
      opportunity_id INTEGER,                  -- …y además, de una oportunidad concreta
      titulo TEXT NOT NULL,
      detalle TEXT DEFAULT '',
      fecha DATE NOT NULL,                     -- para cuándo
      user_id INTEGER,                         -- DE QUIÉN es (el dueño de la tarea)
      estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','hecha','anulada')),
      hecha_at TEXT, hecha_por INTEGER, resultado TEXT DEFAULT '',
      motivo TEXT DEFAULT '',                  -- por qué se anuló
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (opportunity_id) REFERENCES opportunities(id),
      FOREIGN KEY (user_id) REFERENCES admin_users(id)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_crm_tareas_pend ON crm_tareas(estado, fecha)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_crm_tareas_cli ON crm_tareas(client_id, estado)`);

  // ── B12 · LAS TRES TABLAS DE ROLES, ARCHIVADAS (23 ago 2026, noche · punto 8) ────────────────
  // `roles`, `role_permissions` y `user_roles` se sembraban desde siempre y NO CONCEDÍAN NADA: la
  // aplicación de permisos lee solo `user_permissions`. El informe del Eje C las declaró código
  // muerto en julio y las dejó como «riesgo asumido» porque retirarlas o cablearlas era una
  // decisión de diseño. La decisión, tomada esta noche por encargo del dueño, es RETIRARLAS:
  // cablearlas sería rediseñar el modelo de permisos entero, y dejarlas es peor que quitarlas
  // —un esquema con `roles` PARECE un sistema de permisos, y quien le dé el rol «Admin» a alguien
  // creerá que le ha concedido algo—.
  //
  // ARCHIVAR, NUNCA DESTRUIR: se renombran a `*_archived`. Lo que había dentro (los cuatro roles
  // sembrados y las filas que `ensureAdminRole` escribía en cada login) sigue legible. `permissions`
  // y `user_permissions` NO se tocan.
  const b12Key = 'migration_b12_archive_roles_2026_v1';
  if (!db.prepare('SELECT value FROM settings WHERE key=?').get(b12Key)) {
    const archivar = (name) => {
      const src = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
      const dst = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name + '_archived');
      if (src && !dst) db.exec(`ALTER TABLE ${name} RENAME TO ${name}_archived`);
    };
    const tx12 = db.transaction(() => {
      // Las hijas primero: `user_roles` y `role_permissions` apuntan a `roles`.
      ['user_roles', 'role_permissions', 'roles'].forEach(archivar);
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(b12Key, 'done');
    });
    tx12();
  }

  // ── Contabilidad (Pieza 1): cuaderno de doble cara + libros registro ──────────
  // Aditivo: crea las tablas del libro diario (ledger_*) y siembra el plan de cuentas
  // mínimo. NO postea aquí (el backfill se reconcilia perezosamente al abrir el libro y
  // por los hooks de cada documento). Idempotente (CREATE TABLE IF NOT EXISTS + seed OR IGNORE).
  ensureLedgerSchema(db);

  // ── Contabilidad (Pieza 3): libro de bienes de inversión ──────────────────────
  // DATO NUEVO (qué se capitaliza + parámetros de amortización) → tabla propia, aditiva e
  // idempotente. NO entra en WRITABLE_TABLES (DISA no escribe aquí). La amortización se calcula
  // en lectura. Sin DROP ni borrado.
  ensureBienesSchema(db);

  // ── Perfil de usuario ─────────────────────────────────────────────────────────
  // Datos PERSONALES del usuario logueado (distintos de los de la empresa, que viven en
  // `settings`). Aditivo e idempotente vía addCol: nunca DROP, nunca reescribe `name`.
  // `apellidos` arranca VACÍO a propósito: `name` es un campo libre y partirlo por el primer
  // espacio produciría apellidos falsos ("María del Carmen" → apellido "del"). Lo rellena el
  // usuario desde /admin/perfil.
  addCol(db, 'admin_users', 'apellidos',     "TEXT DEFAULT ''");
  addCol(db, 'admin_users', 'telefono',      "TEXT DEFAULT ''");
  addCol(db, 'admin_users', 'pais_telefono', "TEXT DEFAULT '+34'");
  // `idioma` GUARDA la preferencia; hoy NO traduce nada: la interfaz está en español y el motor
  // de i18n real es una tarea futura aparte (ver TABLERO, cola de Eje A). No usar esta columna
  // para decidir textos hasta que exista ese motor.
  addCol(db, 'admin_users', 'idioma',        "TEXT DEFAULT 'es'");
  addCol(db, 'admin_users', 'foto_url',      'TEXT');
  // Peldaño 7 · PIEZA 2 — tarifa/hora de FACTURACIÓN (precio de VENTA) de la persona. La fija el
  // dueño/admin en Usuarios; con ella se calcula EN VIVO el importe facturable de cada entrada de tiempo
  // (con la del proyecto de respaldo si la persona no tiene) y se factura en la pieza 3. El empleado no se
  // la edita a sí mismo. NO es un coste: el coste-hora va aparte (coste_hora, abajo).
  addCol(db, 'admin_users', 'tarifa_hora',   'REAL');
  // Peldaño 7 · PIEZA 4 (parte 2) — COSTE/hora de la persona (precio de COSTE, ESPEJO de tarifa_hora). La fija
  // quien gestiona Usuarios (mismo permiso que la tarifa). Se congela en cada entrada de tiempo al crearla y
  // alimenta el "resultado de gestión" del panel de rentabilidad. Es capa de GESTIÓN: NO entra en el P&G ni en
  // el diario. Por defecto vacío/0 = "sin coste registrado". Separado de la tarifa (venta) a propósito.
  addCol(db, 'admin_users', 'coste_hora',    'REAL');
  // Backfill idempotente (una sola vez): estampa en las entradas de tiempo YA existentes el coste-hora ACTUAL
  // de su persona, marcándolas como backfill (no es el coste del día real). Al introducirse la función el
  // coste-hora suele estar vacío, así que casi siempre estampa NULL (= "sin coste"): el flag distingue "sin
  // coste porque es anterior a la función" de "sin coste porque la persona no tiene coste-hora". No reescribe
  // entradas ya estampadas en vivo. Guardado con una clave en settings para no repetirse.
  if (!db.prepare('SELECT value FROM settings WHERE key=?').get('migration_time_entries_coste_backfill_2026_v1')) {
    db.prepare(`UPDATE time_entries
                   SET coste_hora_congelado = (SELECT u.coste_hora FROM admin_users u WHERE u.id = time_entries.user_id),
                       coste_backfill = 1
                 WHERE coste_hora_congelado IS NULL`).run();
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('migration_time_entries_coste_backfill_2026_v1', new Date().toISOString());
  }

  // ── Facturae ──────────────────────────────────────────────────────────────────
  // Facturae 3.2.2 exige dirección fiscal ESTRUCTURADA (Address · PostCode · Town · Province ·
  // CountryCode). Bamburu solo tenía `address` libre + `city`. Todo aditivo y OPCIONAL: un cliente
  // que no factura a la Administración no necesita rellenar nada y el alta normal no cambia.
  addCol(db, 'clients', 'postal_code', "TEXT DEFAULT ''");
  addCol(db, 'clients', 'province',    "TEXT DEFAULT ''");
  // El EMISOR también: hoy company_config no tenía ni CP ni municipio ni provincia, así que ninguna
  // factura podía ser un Facturae válido (docs/facturae/investigacion.md §3.3).
  addCol(db, 'company_config', 'postal_code', "TEXT DEFAULT ''");
  addCol(db, 'company_config', 'city',        "TEXT DEFAULT ''");
  addCol(db, 'company_config', 'province',    "TEXT DEFAULT ''");

  // SNAPSHOT en la factura. `invoices` ya congelaba nombre/NIF/dirección libre de ambas partes; le
  // faltaban las piezas estructuradas. Se congelan AL EMITIR y no se vuelven a tocar: un Facturae
  // regenerado en 2028 debe llevar la dirección de 2026, no la de hoy. Vacío = no había dato
  // entonces (no se inventa: la factura simplemente no puede exportarse a Facturae).
  for (const p of ['client', 'company']) {
    addCol(db, 'invoices', `${p}_postal_code`, "TEXT DEFAULT ''");
    addCol(db, 'invoices', `${p}_city`,        "TEXT DEFAULT ''");
    addCol(db, 'invoices', `${p}_province`,    "TEXT DEFAULT ''");
    addCol(db, 'invoices', `${p}_country`,     "TEXT DEFAULT ''");
  }
  // Tipo de factura (lista L2 AEAT: F1 · F2 simplificada · F3 sustitutiva · R1–R5) FIJO en la
  // factura. OJO: NO era transitorio — ya se persistía en `verifactu_registros.tipo_factura`. Se
  // desnormaliza aquí porque (a) es un atributo de la factura, no del registro de Verifactu, y
  // (b) las facturas anteriores a Verifactu no tienen registro. Backfill desde ahí: no se pierde nada.
  addCol(db, 'invoices', 'tipo_factura', 'TEXT');
  const tipoMigKey = 'migration_invoices_tipo_factura_backfill_v1';
  if (!db.prepare('SELECT value FROM settings WHERE key=?').get(tipoMigKey)) {
    db.prepare(`UPDATE invoices SET tipo_factura = (
                  SELECT v.tipo_factura FROM verifactu_registros v
                  WHERE v.invoice_id = invoices.id AND v.record_type='alta'
                  ORDER BY v.id LIMIT 1)
                WHERE tipo_factura IS NULL`).run();
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(tipoMigKey, 'done');
  }

  // ── CRM COMERCIAL — embudo de oportunidades + actividad de cliente (aditiva) ───
  // Dos tablas NUEVAS. Nada existente se toca: `clients`, `collection_actions`,
  // `document_links` y los documentos del ciclo siguen exactamente igual.
  //
  // OPORTUNIDAD = una venta POSIBLE (aún no es documento). Cuando se gana, el documento
  // que la materializa (presupuesto/pedido/factura) sigue su propia cadena; la oportunidad
  // no duplica importes fiscales — su `amount` es una ESTIMACIÓN comercial, no una base
  // imponible. Por eso vive fuera de la contabilidad y del hash de Verifactu.
  //
  // `stage` NO lleva CHECK a propósito: un CHECK obliga a recrear la tabla para cambiar el
  // embudo (SQLite no permite alterarlo) y recrear = DROP, prohibido por la regla permanente.
  // La lista cerrada de etapas la valida el esquema zod + el servicio (fuente única en crm.js).
  // `status` SÍ lleva CHECK: los tres estados (activa/ganada/perdida) son la semántica de la
  // tabla, no una configuración.
  db.exec(`CREATE TABLE IF NOT EXISTS opportunities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,          -- valor estimado (comercial, no fiscal)
    stage TEXT NOT NULL DEFAULT 'nuevo',     -- etapa del embudo (ETAPAS en crm.js)
    probability INTEGER NOT NULL DEFAULT 0,  -- 0..100
    expected_close_date TEXT,                -- ISO AAAA-MM-DD, cierre PREVISTO
    source TEXT DEFAULT '',                  -- origen (ORIGENES en crm.js)
    notes TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'activa' CHECK(status IN ('activa','ganada','perdida')),
    lost_reason TEXT,                        -- solo en 'perdida' (MOTIVOS_PERDIDA en crm.js)
    closed_at TEXT,                          -- ISO, cuando pasó a ganada/perdida
    stage_changed_at TEXT NOT NULL,          -- ISO; alimenta "días en la etapa"
    active INTEGER NOT NULL DEFAULT 1,       -- archivar-no-borrar (nunca DELETE)
    created_at TEXT NOT NULL,
    FOREIGN KEY (client_id) REFERENCES clients(id)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_opportunities_client ON opportunities(client_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_opportunities_stage  ON opportunities(status, stage)`);

  // ACTIVIDAD DE CLIENTE — el registro de "qué pasó con este cliente" que `collection_actions`
  // NO puede ser: allí `invoice_id` es NOT NULL con FK CASCADE, y SQLite no sabe quitar un
  // NOT NULL sin recrear la tabla (= DROP, prohibido). Se crea la tabla HERMANA, y el timeline
  // de la ficha UNE las dos (más los documentos del ciclo). `collection_actions` sigue siendo
  // la bitácora del motor de cobros y su cadencia; nadie la toca.
  //
  // `opportunity_id` es OPCIONAL: hay actividad de cliente sin oportunidad (una llamada suelta)
  // y actividad de oportunidad (el seguimiento del embudo). `commitment_date` es el espejo de
  // `promised_date` de cobros: mientras esté viva, el motor no vuelve a proponer que insistas.
  db.exec(`CREATE TABLE IF NOT EXISTS client_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    opportunity_id INTEGER,                  -- NULL = actividad del cliente, no de una oportunidad
    type TEXT NOT NULL,                      -- contacto | nota | compromiso | email | cambio_etapa | cierre
    channel TEXT,                            -- email | telefono | whatsapp | reunion | nota | otro
    stage TEXT,                              -- etapa de la oportunidad en el momento de la acción
    note TEXT,
    commitment_date TEXT,                    -- ISO; compromiso ("me llama el día X")
    created_at TEXT NOT NULL,                -- ISO
    user_name TEXT DEFAULT '',               -- quién lo registró (o 'DISA')
    active INTEGER NOT NULL DEFAULT 1,       -- archivar-no-borrar
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (opportunity_id) REFERENCES opportunities(id)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_client_activities_client ON client_activities(client_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_client_activities_opp    ON client_activities(opportunity_id)`);

  // ── AVISOS Y CORREOS — el dueño manda sobre su bandeja de entrada (aditivo, sin DROP) ───────────
  //
  // TRES TABLAS NUEVAS Y NINGUNA COLUMNA RENOMBRADA. `daily_alert_log` se queda EXACTAMENTE como
  // está: su clave primaria es `fecha` a secas, así que no admite una fila por persona, y recrearla
  // para ampliarle la clave sería destruir datos. Se le deja su trabajo de siempre (la marca del
  // negocio) y la idempotencia POR PERSONA se lleva a `resumen_envios`.

  // (1) La preferencia de CADA PERSONA sobre el resumen que recibe. LA AUSENCIA DE FILA ES EL
  // DEFECTO —activado, cada día, a las 8:00, todas sus fuentes—, así que esta migración no siembra
  // una fila por usuario ni deja a nadie sin correo el primer día: quien no ha tocado nada, sigue
  // igual. `fuentes` vacío = "todas las que pueda ver"; si el usuario recorta, aquí se guarda la
  // lista elegida, pero el permiso manda igual al enviar (una fuente marcada que ya no puede ver
  // NO se le manda). El filtro es una intersección, nunca una puerta trasera.
  db.exec(`CREATE TABLE IF NOT EXISTS avisos_pref_usuario (
    admin_user_id INTEGER PRIMARY KEY,
    activo      INTEGER NOT NULL DEFAULT 1,          -- 0 = no quiere el resumen por correo
    frecuencia  TEXT    NOT NULL DEFAULT 'diaria',   -- 'diaria' | 'semanal'
    dia_semana  INTEGER NOT NULL DEFAULT 1,          -- 1=lunes … 7=domingo (ISO); solo si 'semanal'
    hora        INTEGER NOT NULL DEFAULT 8,          -- 0..23, hora local del negocio (Europe/Madrid)
    fuentes     TEXT    NOT NULL DEFAULT '',         -- '' = todas; si no, tipos separados por comas
    updated_at  TEXT    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_user_id) REFERENCES admin_users(id)
  )`);

  // (2) IDEMPOTENCIA POR PERSONA Y CONSTANCIA DE QUE SE EVALUÓ. Una fila por día y persona, con
  // UNIQUE(fecha, admin_user_id): dos pasadas del temporizador a la misma hora no pueden mandar dos
  // correos. Y se escribe TAMBIÉN cuando no se envía (`enviado=0` + motivo), que es justo lo que
  // hoy no queda registrado: un día sin avisos era indistinguible de un día en que el cron no corrió.
  db.exec(`CREATE TABLE IF NOT EXISTS resumen_envios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha         DATE    NOT NULL,                  -- AAAA-MM-DD local del negocio
    admin_user_id INTEGER NOT NULL,
    enviado       INTEGER NOT NULL DEFAULT 0,        -- 1 = salió el correo · 0 = se evaluó y no salió
    motivo        TEXT    NOT NULL DEFAULT '',       -- enviado | sin_nada_que_contar | apagado | no_toca | sin_email | error
    lineas        INTEGER NOT NULL DEFAULT 0,        -- cuántas frases llevaba el parte
    sent_at       TEXT    DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (fecha, admin_user_id)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_resumen_envios_fecha ON resumen_envios(fecha)`);

  // (3) Los correos AUTOMÁTICOS y de botón que el negocio manda a sus clientes, encendidos o
  // apagados. Otra vez: LA AUSENCIA DE FILA ES "ENCENDIDO". Ningún negocio deja de enviar nada por
  // actualizar; lo que gana es poder apagarlo. `recordatorio_cita` NO vive aquí — su interruptor de
  // verdad es `company_config.cita_modo_recordatorio`, que ya existía y nace apagado; duplicarlo
  // habría creado dos mandos para una sola cosa (y el nuevo, encendido, habría empezado a mandar
  // recordatorios que hoy no se mandan).
  db.exec(`CREATE TABLE IF NOT EXISTS email_tipo_pref (
    tipo       TEXT PRIMARY KEY,                     -- id del CATALOGO de email-templates.js
    activo     INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER
  )`);

  // ── FICHA DE CLIENTE 360 (aditivo, idempotente, sin DROP) ───────────────────────────────────────
  //
  // (1) NOTAS A MANO, con autor e historial. El campo `clients.notes` que ya existía NO se toca:
  // sigue en su sitio, con su contenido, y se pinta donde se pintaba. Aquella era UNA nota que se
  // pisaba a sí misma —sin autor y sin fecha—; esto es el cuaderno. Conviven: no se migra nada.
  // FUERA de WRITABLE_TABLES a propósito: esto lo escribe una persona, no DISA.
  db.exec(`CREATE TABLE IF NOT EXISTS client_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id  INTEGER NOT NULL,
    texto      TEXT    NOT NULL,
    user_id    INTEGER,                        -- quién la escribió (admin_users.id)
    user_name  TEXT    NOT NULL DEFAULT '',    -- copiado al escribir: la nota sobrevive al usuario
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT,
    active     INTEGER NOT NULL DEFAULT 1,     -- archivar-no-borrar (regla permanente)
    FOREIGN KEY (client_id) REFERENCES clients(id)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_client_notes_client ON client_notes(client_id, created_at DESC)`);

  // ── REGISTRO DE CONTACTOS (aditivo, idempotente, sin DROP) ─────────────────────────────────────
  //
  // POR QUÉ EXISTE Y POR QUÉ ES UNA TABLA APARTE. «Última vez que vino» contestaba solo con la
  // agenda, y en un negocio que no lleva agenda eso deja al dueño sin saber cuándo habló con nadie.
  // Pero mezclar «hablé con él» con «vino» rompería el detector de enfriamiento: tres correos
  // automáticos harían parecer vivo a un cliente que lleva año y medio sin aparecer. Por eso hay
  // DOS cosas separadas —contacto y visita— y esta tabla las distingue con dos columnas:
  //
  //   `es_visita`     1 = pisó el negocio o compró. SOLO cuenta para ritmo y «última vez que vino».
  //   `es_automatico` 1 = lo mandó Bamburu solo (recordatorio, confirmación). NUNCA es visita, y se
  //                   distingue a simple vista en pantalla: un correo que mandó la máquina no es
  //                   señal de que el cliente esté vivo.
  //
  // FUERA de WRITABLE_TABLES a propósito: los contactos los apunta una persona o los deriva un
  // documento REAL. DISA no escribe aquí — inventarse un contacto es inventarse una conversación.
  //
  // NADA SE RECALCULA HACIA ATRÁS (R4): esta tabla nace vacía y se llena con lo que pase desde hoy.
  // Lo histórico ya está en sus documentos y la ficha lo sigue leyendo de ellos.
  db.exec(`CREATE TABLE IF NOT EXISTS client_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id     INTEGER NOT NULL,
    fecha         TEXT    NOT NULL,                    -- 'YYYY-MM-DD HH:MM' hora local del negocio
    tipo          TEXT    NOT NULL,                    -- presencial|telefono|whatsapp|correo|mensaje|cita
    direccion     TEXT    NOT NULL DEFAULT 'saliente', -- entrante|saliente
    es_visita     INTEGER NOT NULL DEFAULT 0,          -- ¿pisó el negocio o compró? (D4)
    es_automatico INTEGER NOT NULL DEFAULT 0,          -- ¿lo mandó Bamburu solo? (D2)
    resultado     TEXT    NOT NULL DEFAULT '',         -- texto libre, opcional
    doc_tipo      TEXT,                                -- factura|cita|oportunidad|… si cuelga de un documento
    doc_id        INTEGER,
    user_id       INTEGER,                             -- quién lo hizo; NULL = Bamburu
    user_name     TEXT    NOT NULL DEFAULT '',         -- copiado al escribir: sobrevive al usuario
    origen        TEXT    NOT NULL DEFAULT 'manual',   -- manual|auto (de dónde salió la fila)
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    active        INTEGER NOT NULL DEFAULT 1,          -- archivar-no-borrar (regla permanente)
    FOREIGN KEY (client_id) REFERENCES clients(id)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_client_contacts_cli ON client_contacts(client_id, fecha DESC)`);
  // El índice que impide DUPLICAR un contacto derivado: una factura o una cita generan UNA fila y
  // solo una, aunque el disparador se ejecute dos veces (reintento, doble guardado, migración).
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_client_contacts_doc
             ON client_contacts(doc_tipo, doc_id, tipo) WHERE doc_id IS NOT NULL`);

  // ── PETICIONES DE MIGRACIÓN ASISTIDA (aditivo, idempotente, sin DROP) ──────────────────────────
  //
  // «Trae tus datos del programa anterior» tiene que llevar a algún sitio de verdad. Y ese sitio NO
  // es un importador automático: **la migración la hace el equipo de Bamburu, a mano y gratis**.
  // Esta tabla es el buzón de esa petición — de dónde viene, qué quiere traer, y el fichero si ya lo
  // tenía—, para que quede constancia en el negocio y no solo en un correo que alguien puede perder.
  //
  // NO SE INSINÚA UN IMPORTADOR QUE NO EXISTE: es la misma regla que se aplicó con WhatsApp en la
  // ficha de cliente. Prometer una automatización que no está es peor que no ofrecer nada, porque el
  // dueño deja de buscar la solución que sí tiene.
  //
  // FUERA de WRITABLE_TABLES a propósito: esto lo escribe una persona pidiendo ayuda, no DISA.
  db.exec(`CREATE TABLE IF NOT EXISTS migracion_peticiones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    origen      TEXT    NOT NULL,                  -- holded | quipu | excel | otro
    origen_otro TEXT    NOT NULL DEFAULT '',       -- si origen='otro', qué programa
    quiere      TEXT    NOT NULL DEFAULT '',       -- lista separada por comas: clientes,productos,facturas,proveedores
    comentario  TEXT    NOT NULL DEFAULT '',
    fichero     TEXT,                              -- nombre del fichero adjunto, si lo hubo
    fichero_bytes INTEGER,
    estado      TEXT    NOT NULL DEFAULT 'pedida', -- pedida | en_curso | hecha  (lo mueve el equipo)
    user_id     INTEGER,
    user_name   TEXT    NOT NULL DEFAULT '',
    email_ok    INTEGER NOT NULL DEFAULT 0,        -- ¿salió el correo al equipo?
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    active      INTEGER NOT NULL DEFAULT 1
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_migracion_peticiones_fecha ON migracion_peticiones(created_at DESC)`);

  // Y LA LIMPIEZA, AUTOMÁTICA. Un contacto sin cliente no significa nada: si alguna vez se borra un
  // cliente de verdad, sus contactos se van con él. **El producto NUNCA borra un cliente** —archiva
  // con active=0, que es la regla permanente— así que esto no destruye nada en uso normal; existe
  // porque la clave foránea, sin esto, impide el borrado y deja el fallo en manos de quien lo haga.
  // Es lo que habría hecho un ON DELETE CASCADE, que no se puede añadir a una tabla ya creada sin
  // reconstruirla (y reconstruir tablas está prohibido: R4). Aditivo, idempotente y reversible.
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_client_contacts_borrar_cliente
             BEFORE DELETE ON clients
             BEGIN DELETE FROM client_contacts WHERE client_id = OLD.id; END`);

  // (2) LOS ÍNDICES QUE FALTABAN. La ficha 360 hace ocho o diez consultas POR CLIENTE en una sola
  // pantalla; sin índice, cada una es un barrido de la tabla entera. De las diez tablas implicadas
  // solo dos lo tenían (oportunidades y actividad). Aditivo puro: un índice no cambia un dato.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_invoices_client        ON invoices(client_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_citas_cliente          ON citas(cliente_id, fecha)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_collection_act_client  ON collection_actions(client_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_proyectos_cliente      ON proyectos(cliente_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_quotes_client          ON quotes(client_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_customer_orders_client ON customer_orders(client_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_delivery_notes_client  ON delivery_notes(client_id)`);

  // ── IMPORTADOR DE CSV · EL REGISTRO DE CADA IMPORTACIÓN (ficha H · aditivo, sin DROP) ─────────
  //
  // Existe por H2: «posibilidad de deshacer». Sin saber QUÉ fichas entraron en cada importación,
  // deshacer sería adivinar — y adivinar aquí significa archivar un cliente que el dueño creó a
  // mano el martes. Por eso se apunta ficha a ficha, y no «los últimos N clientes».
  //
  // DESHACER ARCHIVA, NO BORRA (regla permanente del proyecto): clientes a `active=0`, productos a
  // `status='archived'`, exactamente lo que hace el botón de archivar de cada pantalla. Por eso
  // aquí no hay ningún DELETE, ni en la tabla ni en el motor.
  //
  // FUERA de WRITABLE_TABLES a propósito: esto lo escribe una persona subiendo su fichero. DISA no
  // importa ficheros.
  db.exec(`CREATE TABLE IF NOT EXISTS importaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo           TEXT    NOT NULL,                 -- clientes | productos  (facturas NO: ver importador.js)
    fichero        TEXT    NOT NULL DEFAULT '',      -- nombre del CSV que subió, para reconocerlo en la lista
    filas_total    INTEGER NOT NULL DEFAULT 0,
    filas_creadas  INTEGER NOT NULL DEFAULT 0,
    filas_omitidas INTEGER NOT NULL DEFAULT 0,       -- las que fallaban y NO entraron (se vieron antes)
    user_id        INTEGER,
    user_name      TEXT    NOT NULL DEFAULT '',
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    deshecha_at    TEXT                              -- NULL = viva; con fecha = ya se deshizo (idempotente)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS importacion_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    importacion_id INTEGER NOT NULL,
    entidad        TEXT    NOT NULL,                 -- client | product
    entidad_id     INTEGER NOT NULL,
    FOREIGN KEY (importacion_id) REFERENCES importaciones(id)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_importacion_items_lote ON importacion_items(importacion_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_importaciones_fecha    ON importaciones(created_at DESC)`);

  // ── F · EL MAPA DE LA FICHA DE CLIENTE (23 ago 2026) ────────────────────────────────────────
  // El punto en el mapa NO va en `clients`, y no es un capricho de orden: el encargo dice «lo que
  // no se toca son los datos del cliente». Esto NO es un dato del cliente — es una CACHÉ de lo que
  // contestó el buscador de OpenStreetMap cuando se guardó su dirección. Se puede tirar entera y
  // reconstruirse guardando otra vez, y ningún documento ni ninguna factura depende de ella.
  //
  // `huella` es la dirección exacta que se resolvió. Sin ella, un cliente que se muda seguiría
  // enseñando la chincheta de su casa anterior con toda la confianza del mundo: la ficha exige que
  // la huella guardada coincida con la dirección de HOY antes de pintar nada.
  // `resuelto=0` es una respuesta legítima y se guarda a propósito ("se preguntó y no se pudo"),
  // para no volver a molestar al servicio de fuera con lo mismo. Motor: `erp/mapa-cliente.js`.
  db.exec(`CREATE TABLE IF NOT EXISTS client_geo (
    client_id  INTEGER PRIMARY KEY REFERENCES clients(id),
    huella     TEXT    NOT NULL DEFAULT '',
    lat        REAL,
    lon        REAL,
    etiqueta   TEXT,
    resuelto   INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);

  console.log('✅ ERP: Migraciones completadas');
  // ── C-0 · EL LOGO EN LA FOTO CONGELADA DEL DOCUMENTO ─────────────────────────────────────────
  // VA AL FINAL, Y NO ES UN DETALLE: la primera versión lo puso arriba, junto al resto de columnas
  // de `company_config`, y ahí las tablas de documentos TODAVÍA NO EXISTEN. Un negocio nuevo moría
  // en el alta con «no such table: invoices». Lo cazó el gate al levantar su primer negocio de cero,
  // que es exactamente para lo que los gates levantan negocios de cero.
  // Mismo motivo que las demás columnas congeladas: cambiar el logo hoy no puede reescribir una
  // factura de marzo. Aditivo y NULL para todo lo emitido hasta hoy — correcto: no llevaban logo.
  for (const t of ['invoices', 'quotes', 'customer_orders', 'delivery_notes', 'purchase_orders']) {
    addCol(db, t, 'company_logo_id', 'INTEGER');
  }
}
