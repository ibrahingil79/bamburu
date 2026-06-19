import Database from 'better-sqlite3';
import path from 'path';

// BD central de control: registra todos los tenants y sus sesiones.
// Es independiente de las BDs individuales de cada negocio.
const CONTROL_DB_PATH = path.join(process.cwd(), 'data', 'control.db');
export const controlDb = new Database(CONTROL_DB_PATH);
controlDb.pragma('journal_mode = WAL');
controlDb.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// Migraciones — idempotentes (IF NOT EXISTS)
// ---------------------------------------------------------------------------

function runMigrations(db) {
  // Registro de negocios (uno por fila)
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL,
      slug         TEXT    UNIQUE NOT NULL,
      db_filename  TEXT    UNIQUE NOT NULL,
      plan         TEXT    DEFAULT 'starter',
      status       TEXT    DEFAULT 'active',
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try {
    db.exec("ALTER TABLE tenants ADD COLUMN country TEXT DEFAULT 'ES'");
  } catch {}

  // Sesiones cross-tenant: relaciona una cookie con un usuario de un tenant
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenant_sessions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id     INTEGER  NOT NULL,
      session_token TEXT     UNIQUE NOT NULL,
      user_id       INTEGER  NOT NULL,
      user_email    TEXT     NOT NULL,
      user_role     TEXT,
      expires_at    DATETIME NOT NULL,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    )
  `);

  // Valores de configuración de la plataforma (clave/valor libre)
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Acumulador GLOBAL del gasto de Anthropic por mes natural (freno anti-avalancha de gasto).
  // El gasto por-negocio vive en la BD de cada tenant (tabla disa_spend); este es la suma global.
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_spend_global (
      month      TEXT PRIMARY KEY,
      eur        REAL    NOT NULL DEFAULT 0,
      alerted_80 INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Configuración de países disponibles en la plataforma
  db.exec(`
    CREATE TABLE IF NOT EXISTS country_configs (
      code            TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      currency        TEXT NOT NULL,
      currency_symbol TEXT NOT NULL,
      tax_name        TEXT NOT NULL,
      tax_rates       TEXT NOT NULL,
      tax_default     REAL NOT NULL,
      fiscal_id_label TEXT NOT NULL,
      document_name   TEXT NOT NULL
    )
  `);
  db.exec(`
    INSERT OR IGNORE INTO country_configs VALUES
    ('ES','España','EUR','€','IVA','21,10,4',21.0,'NIF/CIF','Factura'),
    ('MX','México','MXN','$','IVA','16,8,0',16.0,'RFC','CFDI'),
    ('CO','Colombia','COP','$','IVA','19,5,0',19.0,'NIT','Factura electrónica')
  `);
}

// ---------------------------------------------------------------------------
// Inicialización — llamar una sola vez al arrancar el servidor
// ---------------------------------------------------------------------------

export function initControlDb() {
  runMigrations(controlDb);
  return controlDb;
}

// ---------------------------------------------------------------------------
// Helpers de lectura (solo SELECT; escritura en tarea 4)
// ---------------------------------------------------------------------------

// Resuelve un subdominio al tenant correspondiente.
// Devuelve la fila completa o null si no existe.
export function getTenantBySlug(slug) {
  return controlDb
    .prepare('SELECT * FROM tenants WHERE slug = ?')
    .get(slug) ?? null;
}

// Devuelve el tenant por su ID interno o null si no existe.
export function getTenantById(id) {
  return controlDb
    .prepare('SELECT * FROM tenants WHERE id = ?')
    .get(id) ?? null;
}

// Valida una cookie de sesión y devuelve { session, tenant } o null.
// El portero usa esto para autenticar cada petición.
export function getSessionByToken(token) {
  const session = controlDb
    .prepare('SELECT * FROM tenant_sessions WHERE session_token = ? AND expires_at > CURRENT_TIMESTAMP')
    .get(token);
  if (!session) return null;

  const tenant = getTenantById(session.tenant_id);
  if (!tenant) return null;

  return { session, tenant };
}

// ---------------------------------------------------------------------------
// Helpers de escritura (tarea 4)
// ---------------------------------------------------------------------------

export function createTenant({ name, slug, db_filename, plan = 'starter', country = 'ES' }) {
  const result = controlDb
    .prepare(`INSERT INTO tenants (name, slug, db_filename, plan, country) VALUES (?, ?, ?, ?, ?)`)
    .run(name, slug, db_filename, plan, country);
  return getTenantById(result.lastInsertRowid);
}

export function createTenantSession({ tenant_id, session_token, user_id, user_email, user_role, expires_at }) {
  const result = controlDb
    .prepare(`INSERT INTO tenant_sessions
      (tenant_id, session_token, user_id, user_email, user_role, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
    .run(tenant_id, session_token, user_id, user_email, user_role, expires_at);
  return controlDb.prepare('SELECT * FROM tenant_sessions WHERE id = ?').get(result.lastInsertRowid);
}

// Borra el vínculo sesión→negocio (al cerrar sesión). Idempotente.
export function destroyTenantSession(token) {
  controlDb.prepare('DELETE FROM tenant_sessions WHERE session_token = ?').run(token);
}

export function getCountryConfig(code) {
  return controlDb
    .prepare('SELECT * FROM country_configs WHERE code = ?')
    .get(code) ?? null;
}

export function getAllCountryConfigs() {
  return controlDb
    .prepare('SELECT * FROM country_configs ORDER BY name')
    .all();
}

export function getTenantByEmail(email) {
  const tenants = controlDb
    .prepare("SELECT * FROM tenants WHERE status='active'")
    .all();

  for (const tenant of tenants) {
    try {
      const db = new Database(
        path.isAbsolute(tenant.db_filename)
          ? tenant.db_filename
          : path.join(process.cwd(), tenant.db_filename)
      );
      const user = db
        .prepare('SELECT id FROM admin_users WHERE email=? AND active=1')
        .get(email);
      db.close();
      if (user) return tenant;
    } catch {
      continue;
    }
  }
  return null;
}

// Como getTenantByEmail pero devuelve TODOS los negocios donde el email es admin activo.
// Lo usa /find-tenant: si hay varios, deja que el usuario elija a cuál entrar (en vez de
// elegir el primero en silencio). Devuelve [] si no hay ninguno.
export function getTenantsByEmail(email) {
  const tenants = controlDb
    .prepare("SELECT * FROM tenants WHERE status='active'")
    .all();

  const matches = [];
  for (const tenant of tenants) {
    try {
      const db = new Database(
        path.isAbsolute(tenant.db_filename)
          ? tenant.db_filename
          : path.join(process.cwd(), tenant.db_filename)
      );
      const user = db
        .prepare('SELECT id FROM admin_users WHERE email=? AND active=1')
        .get(email);
      db.close();
      if (user) matches.push(tenant);
    } catch {
      continue;
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Gasto GLOBAL de Anthropic (freno de gasto, por mes natural 'YYYY-MM')
// ---------------------------------------------------------------------------

// Devuelve { eur, alerted_80 } del mes (0 si no hay fila).
export function getGlobalLlmSpend(month) {
  return controlDb
    .prepare('SELECT eur, alerted_80 FROM llm_spend_global WHERE month = ?')
    .get(month) ?? { eur: 0, alerted_80: 0 };
}

// Suma gasto al acumulador global del mes (crea la fila si no existe).
export function addGlobalLlmSpend(month, eur) {
  controlDb
    .prepare(`INSERT INTO llm_spend_global (month, eur) VALUES (?, ?)
              ON CONFLICT(month) DO UPDATE SET eur = eur + excluded.eur`)
    .run(month, eur);
}

// Marca que ya se envió el aviso del 80% de este mes (para no repetirlo).
export function markGlobalLlmAlerted(month) {
  controlDb.prepare('UPDATE llm_spend_global SET alerted_80 = 1 WHERE month = ?').run(month);
}
