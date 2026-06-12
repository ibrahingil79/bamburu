// Suite de lógica del alta de negocio (servicio validado + esquema + robustez).
// No usa el servidor: prueba directamente core/signup-schema, core/tenant-signup y
// core/tenant-provisioning. Crea/borra artefactos en la control.db real y los limpia.
import path from 'path';
import { existsSync, unlinkSync } from 'fs';
import Database from 'better-sqlite3';
import { parseSignup } from '../core/signup-schema.js';
import { emailTaken, validateSignupDraft, createTenantSvc } from '../core/tenant-signup.js';
import { provisionTenant } from '../core/tenant-provisioning.js';
import { controlDb, getTenantBySlug } from '../core/control-db.js';

let ok = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✓ ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ FALLO: ${label}${extra ? ' — ' + extra : ''}`); }
};
const threw = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

const tenantsCount = () => controlDb.prepare('SELECT COUNT(*) n FROM tenants').get().n;
function dropTenantFiles(db_filename) {
  const abs = path.isAbsolute(db_filename) ? db_filename : path.join(process.cwd(), db_filename);
  for (const f of [abs, abs + '-wal', abs + '-shm']) { try { unlinkSync(f); } catch {} }
}
function deleteTenant(slug) {
  const t = getTenantBySlug(slug);
  controlDb.prepare('DELETE FROM tenants WHERE slug=?').run(slug);
  if (t) dropTenantFiles(t.db_filename);
}

const DEV_EMAIL = 'ibrahingil@gmail.com';   // owner del tenant dev (email ya existente)
const created = [];                          // tenants a limpiar al final

try {
  console.log('\n[1] Validación de esquema (parseSignup)');
  {
    const e1 = await threw(() => parseSignup({ businessName: 'X', ownerName: 'A', email: 'no-es-email', password: 'abcdefgh' }));
    check('email inválido → 400 field=email', e1?.status === 400 && e1?.field === 'email');
    const e2 = await threw(() => parseSignup({ businessName: 'X', ownerName: 'A', email: 'a@b.com', password: 'corta' }));
    check('contraseña < 8 → 400 field=password', e2?.status === 400 && e2?.field === 'password');
    const e3 = await threw(() => parseSignup({ ownerName: 'A', email: 'a@b.com', password: 'abcdefgh' }));
    check('falta businessName → 400 field=businessName', e3?.status === 400 && e3?.field === 'businessName');
    const e4 = await threw(() => parseSignup({ businessName: 'X', email: 'a@b.com', password: 'abcdefgh' }));
    check('falta ownerName → 400 field=ownerName', e4?.status === 400 && e4?.field === 'ownerName');
    const d = parseSignup({ businessName: 'Mi Tienda', sector: 'Comercio', ownerName: 'Ana', email: 'ANA@Ej.COM', country: 'XX', password: 'abcdefgh' });
    check('válido: email en minúsculas', d.email === 'ana@ej.com');
    check('válido: país desconocido → ES', d.country === 'ES');
    check('válido: sector conservado', d.sector === 'Comercio');
    const draft = parseSignup({ businessName: 'X', ownerName: 'A', email: 'a@b.com' }, { draft: true });
    check('borrador sin contraseña valida (sector opcional = "")', draft.sector === '' && !('password' in draft));
  }

  console.log('\n[2] Unicidad de email entre tenants (emailTaken / validateSignupDraft)');
  {
    check('emailTaken del owner dev → true', emailTaken(DEV_EMAIL) === true);
    const freebie = 'libre-' + Date.now() + '@ejemplo.com';
    check('emailTaken de un email nuevo → false', emailTaken(freebie) === false);
    const e = await threw(() => validateSignupDraft({ businessName: 'X', ownerName: 'A', email: DEV_EMAIL }));
    check('validateSignupDraft con email duplicado → 409 field=email', e?.status === 409 && e?.field === 'email');
    const okDraft = validateSignupDraft({ businessName: 'X', ownerName: 'A', email: freebie });
    check('validateSignupDraft con email libre → ok', okDraft.email === freebie);
  }

  console.log('\n[3] createTenantSvc rechaza inválidos SIN crear nada');
  {
    const before = tenantsCount();
    const e1 = await threw(() => createTenantSvc({ businessName: 'X', ownerName: 'A', email: 'malo', password: 'abcdefgh' }));
    check('email malo → throw 400', e1?.status === 400 && e1?.field === 'email');
    const e2 = await threw(() => createTenantSvc({ businessName: 'X', ownerName: 'A', email: 'b@b.com', password: '123' }));
    check('contraseña corta → throw 400', e2?.status === 400 && e2?.field === 'password');
    const e3 = await threw(() => createTenantSvc({ businessName: 'X', ownerName: 'A', email: DEV_EMAIL, password: 'abcdefgh' }));
    check('email duplicado → throw 409', e3?.status === 409 && e3?.field === 'email');
    check('no se creó ningún tenant con datos inválidos', tenantsCount() === before, `count ${before}`);
  }

  console.log('\n[4] createTenantSvc camino feliz: crea, guarda sector, email queda ocupado');
  {
    const email = 'alta-ok-' + Date.now() + '@ejemplo.com';
    const res = await createTenantSvc({ businessName: 'Peluquería Prueba Alta', sector: 'Peluquería', ownerName: 'Lola Prueba', email, password: 'clave1234' });
    created.push(res.slug);
    check('devuelve slug', !!res.slug, res.slug);
    const abs = path.join(process.cwd(), 'data', 'tenants', res.slug + '.db');
    check('el .db del tenant existe', existsSync(abs));
    const tdb = new Database(abs);
    const sector = tdb.prepare("SELECT value FROM settings WHERE key='business_sector'").get();
    check('sector guardado en settings (defecto F)', sector?.value === 'Peluquería', sector?.value);
    const owner = tdb.prepare('SELECT name,email,role FROM admin_users WHERE active=1').get();
    check('owner creado con email normalizado', owner?.email === email && owner?.role === 'owner');
    tdb.close();
    check('emailTaken del nuevo email → true', emailTaken(email) === true);
    // limpieza
    deleteTenant(res.slug);
    created.pop();
    check('tras limpiar, emailTaken vuelve a false', emailTaken(email) === false);
    check('tras limpiar, el .db ya no existe', !existsSync(abs));
  }

  console.log('\n[5] Limpieza de .db huérfano si control.db falla tras crearlo (defecto J)');
  {
    const decoySlug = 'zzz-orphan-decoy-' + Date.now();
    const targetSlug = 'zzz-orphan-test-' + Date.now();
    const targetFile = path.join('data', 'tenants', targetSlug + '.db');
    // Sembramos un choque de db_filename UNIQUE: createTenant fallará DESPUÉS de crear el .db.
    controlDb.prepare('INSERT INTO tenants (name, slug, db_filename, plan, country) VALUES (?,?,?,?,?)')
      .run('Decoy', decoySlug, targetFile, 'starter', 'ES');
    const before = tenantsCount();
    const err = await threw(() => provisionTenant({
      businessName: targetSlug.replace(/-/g, ' '),   // su slug será exactamente targetSlug
      ownerName: 'Huérfano', email: 'orphan-' + Date.now() + '@ejemplo.com', password: 'clave1234',
    }));
    // El slug puede llevar sufijo si colisiona, pero el db_filename objetivo es el del choque.
    const abs = path.join(process.cwd(), targetFile);
    check('provisionTenant lanzó el error de control.db', !!err, err?.message?.slice(0, 40));
    check('NO quedó tenant nuevo registrado', tenantsCount() === before, `count ${before}`);
    check('el .db huérfano fue limpiado', !existsSync(abs));
    // limpieza del decoy
    controlDb.prepare('DELETE FROM tenants WHERE slug=?').run(decoySlug);
  }
} finally {
  for (const slug of created) { try { deleteTenant(slug); } catch {} }
}

console.log(`\n===== RESULTADO: ${ok} OK, ${fail} fallos =====`);
process.exit(fail ? 1 : 0);
