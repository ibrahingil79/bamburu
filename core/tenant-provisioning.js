import Database from 'better-sqlite3';
import path from 'path';
import { mkdirSync, unlinkSync } from 'fs';
import { hashPassword } from './auth.js';
import { runMigrations } from '../modules/erp/models.js';
import { getTenantBySlug, createTenant, getCountryConfig } from './control-db.js';
import { parseSignup } from './signup-schema.js';

// Borra el .db de un tenant a medio crear (y sus ficheros WAL/SHM). Idempotente.
function cleanupTenantDbFiles(absolutePath) {
  for (const f of [absolutePath, absolutePath + '-wal', absolutePath + '-shm']) {
    try { unlinkSync(f); } catch {}
  }
}

// Convierte un nombre de negocio en un slug URL-safe.
// Ej: 'Panaderia Garcia' → 'panaderia-garcia'
function toSlug(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')    // elimina marcas diacriticas (a→a, n→n, u→u...)
    .replace(/[^a-z0-9]+/g, '-')        // caracteres no alfanumericos → guion
    .replace(/^-+|-+$/g, '');           // sin guiones al inicio ni al final
}

export async function provisionTenant(input) {
  // 0. Defensa en profundidad: nadie crea un tenant con datos sin validar (defecto C).
  //    Lanza Error { status:400, field } si algo no es válido.
  const { businessName, ownerName, email, password, phone = '', country = 'ES', sector = '' } =
    parseSignup(input, { draft: false });

  // 1. Generar slug unico
  let slug = toSlug(businessName);
  if (getTenantBySlug(slug)) {
    slug = slug + '-' + Date.now();
  }

  // 2. Definir ruta del .db
  const db_filename = path.join('data', 'tenants', slug + '.db');
  mkdirSync(path.join(process.cwd(), 'data', 'tenants'), { recursive: true });

  // 3. Hashear contrasena (bcrypt saltRounds=12, igual que core/auth.js)
  const passwordHash = await hashPassword(password);

  // 4. Crear y migrar el .db del tenant
  const absolutePath = path.join(process.cwd(), db_filename);
  let tenantDb;
  try {
    tenantDb = new Database(absolutePath);
    tenantDb.pragma('journal_mode = WAL');
    tenantDb.pragma('foreign_keys = ON');
    runMigrations(tenantDb);

    // Inicializar company_config con la configuración del país
    const countryConfig = getCountryConfig(country);
    if (countryConfig) {
      tenantDb.prepare(`
        UPDATE company_config SET
          country = ?,
          currency = ?,
          currency_symbol = ?,
          tax_name = ?,
          fiscal_id_label = ?,
          document_name = ?,
          tax_rate = ?
        WHERE id = 1
      `).run(
        countryConfig.code,
        countryConfig.currency,
        countryConfig.currency_symbol,
        countryConfig.tax_name,
        countryConfig.fiscal_id_label,
        countryConfig.document_name,
        countryConfig.tax_default
      );
    }

    tenantDb.prepare("DELETE FROM admin_users WHERE email = 'admin@bamburu.com'").run();

    tenantDb.prepare(`INSERT INTO admin_users
      (name, email, password_hash, role, active, must_change_password)
      VALUES (?, ?, ?, 'owner', 1, 0)`)
      .run(ownerName, email, passwordHash);

    tenantDb.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('owner_phone', ?)`)
      .run(phone);
    tenantDb.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('country', ?)`)
      .run(country);
    // Sector: se guarda como materia prima para la personalización futura de DISA (defecto F).
    tenantDb.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('business_sector', ?)`)
      .run(sector);

    tenantDb.close();
  } catch (err) {
    if (tenantDb) try { tenantDb.close(); } catch {}
    cleanupTenantDbFiles(absolutePath);
    throw err;
  }

  // 5. Registrar en control.db. Si esto falla DESPUÉS de crear el .db, el archivo quedaría
  //    huérfano → lo limpiamos y propagamos el error (defecto J).
  let tenant;
  try {
    tenant = createTenant({ name: businessName, slug, db_filename, plan: 'starter', country });
  } catch (err) {
    cleanupTenantDbFiles(absolutePath);
    throw err;
  }

  return { tenant, slug, db_filename };
}
