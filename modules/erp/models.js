import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { hashPasswordLegacy } from '../../core/auth.js';

function addCol(db, table, col, def) {
  const cols = db.pragma(`table_info(${table})`).map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

export function runMigrations(db) {
  // Core
  db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);

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

  // Product reviews
  db.exec(`CREATE TABLE IF NOT EXISTS product_reviews (
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

  // Shipping methods
  db.exec(`CREATE TABLE IF NOT EXISTS shipping_methods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    price REAL DEFAULT 0,
    free_from REAL DEFAULT NULL,
    estimated_days TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Discount codes
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

  // Sales orders (extended)
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

  // Inventory movements (extended)
  db.exec(`CREATE TABLE IF NOT EXISTS inventory_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    variant_id INTEGER,
    type TEXT NOT NULL CHECK(type IN ('in','out','adjust')),
    quantity INTEGER NOT NULL,
    reason TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  )`);
  addCol(db, 'inventory_movements', 'variant_id', 'INTEGER');

  // Customer accounts (store login)
  db.exec(`CREATE TABLE IF NOT EXISTS customer_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER UNIQUE,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  )`);

  // Wishlist
  db.exec(`CREATE TABLE IF NOT EXISTS wishlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(customer_id, product_id),
    FOREIGN KEY (customer_id) REFERENCES customer_accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  )`);

  // Newsletter
  db.exec(`CREATE TABLE IF NOT EXISTS newsletter_subscribers (
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

  db.exec(`CREATE TABLE IF NOT EXISTS customer_sessions (
    token TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (account_id) REFERENCES customer_accounts(id) ON DELETE CASCADE
  )`);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_customer_sessions_expires ON customer_sessions(expires_at)`);

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
    const hash = bcrypt.hashSync(pwd, 12);
    db.prepare('INSERT INTO admin_users (name, email, password_hash, role, must_change_password) VALUES (?,?,?,?,?)')
      .run('Administrador', 'admin@bamburu.com', hash, 'owner', 1);
    console.log(`
=====================================================
⚠️  ADMIN CREADO POR PRIMERA VEZ
   Email:      admin@bamburu.com
   Contraseña: ${pwd}

   GUÁRDALA AHORA. No volverá a mostrarse.
   Se te pedirá cambiarla en el primer login.
=====================================================`);
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

  // Feedback
  db.exec(`CREATE TABLE IF NOT EXISTS feedback (
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

  db.exec(`CREATE TABLE IF NOT EXISTS invoice_sequences (
    series TEXT NOT NULL,
    year INTEGER NOT NULL,
    last_seq INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (series, year)
  )`);

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

  // Roles y permisos (ACL)
  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module TEXT NOT NULL,
      action TEXT NOT NULL,
      description TEXT,
      UNIQUE(module, action)
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id INTEGER NOT NULL,
      permission_id INTEGER NOT NULL,
      PRIMARY KEY (role_id, permission_id),
      FOREIGN KEY (role_id) REFERENCES roles(id),
      FOREIGN KEY (permission_id) REFERENCES permissions(id)
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      admin_user_id INTEGER NOT NULL,
      role_id INTEGER NOT NULL,
      PRIMARY KEY (admin_user_id, role_id),
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id),
      FOREIGN KEY (role_id) REFERENCES roles(id)
    );

    CREATE TABLE IF NOT EXISTS user_permissions (
      admin_user_id INTEGER NOT NULL,
      permission_id INTEGER NOT NULL,
      PRIMARY KEY (admin_user_id, permission_id),
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id),
      FOREIGN KEY (permission_id) REFERENCES permissions(id)
    );
  `);

  // Seed roles predefinidos
  const rolesData = [
    { name: 'Admin',       description: 'Acceso total' },
    { name: 'Seller',      description: 'Gestión de pedidos y clientes' },
    { name: 'Accountant',  description: 'Facturación y reportes' },
    { name: 'Viewer',      description: 'Solo lectura' },
  ];
  for (const role of rolesData) {
    db.prepare('INSERT OR IGNORE INTO roles (name, description) VALUES (?, ?)').run(role.name, role.description);
  }

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
  ];
  for (const p of permissionsData) {
    db.prepare('INSERT OR IGNORE INTO permissions (module, action, description) VALUES (?, ?, ?)').run(p.module, p.action, p.description);
  }

  // Seed role_permissions
  const rolePermissions = {
    Admin:      ['products.read','products.create','products.edit','products.delete',
                 'orders.read','orders.create','orders.edit','orders.update_status',
                 'clients.read','clients.create','clients.edit',
                 'invoices.read','invoices.create',
                 'admin.manage_users','admin.manage_roles','admin.settings'],
    Seller:     ['products.read',
                 'orders.read','orders.create','orders.edit','orders.update_status',
                 'clients.read','clients.create','clients.edit',
                 'invoices.read'],
    Accountant: ['orders.read','clients.read','invoices.read','invoices.create','admin.settings'],
    Viewer:     ['products.read','orders.read','clients.read','invoices.read'],
  };
  for (const [roleName, perms] of Object.entries(rolePermissions)) {
    const role = db.prepare('SELECT id FROM roles WHERE name=?').get(roleName);
    if (!role) continue;
    for (const perm of perms) {
      const [mod, act] = perm.split('.');
      const permission = db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get(mod, act);
      if (permission) {
        db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run(role.id, permission.id);
      }
    }
  }

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

  console.log('✅ ERP: Migraciones completadas');
}
