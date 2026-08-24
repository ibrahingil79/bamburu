// Gate — SUPERADMIN: ninguna escritura por una conexión propia.
//
// Hallazgo del diagnóstico del 10-jul: setTenantAiCap abría su PROPIA conexión de escritura a la .db
// del negocio, fuera de la caché de tenant-middleware. Dos escritores contra el mismo fichero SQLite
// se serializan: si esa escritura se atasca, deja al negocio esperando (busy_timeout de 5 s).
//
// Este gate fija la regla para siempre: en modules/superadmin/ se puede LEER abriendo conexiones
// (readonly no compite por el bloqueo de escritura), pero ESCRIBIR solo por la conexión cacheada.
// Si alguien vuelve a colar un `new Database(...)` de escritura, esto se pone rojo.
//   node scripts/verify-superadmin-escrituras.mjs
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';
import { copyFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { getTenantDb, getTenantConnection } from '../core/tenant-middleware.js';
import { WAL_SIZE_LIMIT } from '../core/control-db.js';
// 24 ago 2026 · La copia va por `copiarBase` (sqlite .backup), no por copyFileSync: los negocios
// corren en WAL y un `cp` deja fuera el -wal, o sea mide una foto vieja. Ver scripts/lib/copia-consistente.mjs.
import { copiarBase } from './lib/copia-consistente.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

// ── 1. Ninguna apertura de ESCRITURA en superadmin ──────────────────────────────────────────
console.log('\n[1] superadmin no abre conexiones de escritura');
const dir = 'modules/superadmin';
const aperturas = [];
for (const f of readdirSync(dir).filter(f => f.endsWith('.js'))) {
  const src = readFileSync(join(dir, f), 'utf8');
  // Cada `new Database(...)` con su lista de argumentos (hasta el cierre del paréntesis).
  for (const m of src.matchAll(/new Database\(([^;]*?)\)\s*;/gs)) {
    aperturas.push({ fichero: f, args: m[1].replace(/\s+/g, ' ').trim() });
  }
}
console.log('  · ' + aperturas.length + ' apertura(s) de BD en el módulo');
const escritura = aperturas.filter(a => !/readonly:\s*true/.test(a.args));
ok(escritura.length === 0,
   escritura.length ? 'HAY apertura(s) de ESCRITURA: ' + JSON.stringify(escritura)
                    : 'todas las aperturas son readonly:true (un lector no bloquea al negocio)');

// ── 2. El tope de IA se escribe por la caché ────────────────────────────────────────────────
console.log('\n[2] el tope de IA pasa por la conexión cacheada');
const sa = readFileSync(join(dir, 'index.js'), 'utf8');
const cuerpo = sa.slice(sa.indexOf('function setTenantAiCap'), sa.indexOf('function setTenantAiCap') + 500);
ok(/getTenantDb\(/.test(cuerpo), 'setTenantAiCap usa getTenantDb() — la caché de tenant-middleware');
ok(!/new Database/.test(cuerpo), 'setTenantAiCap NO abre una conexión propia');
ok(!/\.close\(\)/.test(cuerpo), 'y NO cierra la conexión: la caché es su dueña, la comparte con la app');
ok(/getTenantDb/.test(sa.slice(0, sa.indexOf('const TENANT_CAP_DEFAULT'))), 'importa getTenantDb de core/tenant-middleware.js');

// ── 3. La caché es de verdad una caché (misma conexión, no una nueva por llamada) ───────────
console.log('\n[3] getTenantDb devuelve SIEMPRE la misma conexión');
const tmp = join(tmpdir(), 'sa-cap-' + process.pid + '.db');
copiarBase('data/tenants/desarrollo-bamburu.db', tmp);
const tenantFake = { slug: 'zz-gate-' + process.pid, db_filename: tmp };
const c1 = getTenantDb(tenantFake);
const c2 = getTenantDb(tenantFake);
ok(c1 === c2, 'dos llamadas → EL MISMO objeto de conexión (no se abre una segunda)');
ok(getTenantConnection(tenantFake.slug) === c1, 'y es la que sirve getTenantConnection() al resto de la app');

// ── 4. Escribir el tope por esa conexión funciona (lo que hace superadmin ahora) ────────────
console.log('\n[4] el tope se escribe y se lee');
c1.prepare("INSERT INTO platform_limits (key,value) VALUES ('ai_cap_eur',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(33.5);
const leido = c1.prepare("SELECT value FROM platform_limits WHERE key='ai_cap_eur'").get()?.value;
ok(leido === 33.5, `el tope queda escrito por la conexión cacheada (${leido} €)`);
ok(c1.prepare('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'platform_limits\'').get(),
   'platform_limits existe: la crea runMigrations (por eso setTenantAiCap ya no necesita CREATE TABLE)');

// ── 5. El tope del WAL va puesto en las conexiones de la caché ──────────────────────────────
console.log('\n[5] la conexión cacheada nace con el tope del WAL');
const lim = c1.pragma('journal_size_limit', { simple: true });
ok(lim === WAL_SIZE_LIMIT, `journal_size_limit = ${lim} (${(lim / 1048576).toFixed(0)} MiB) — el -wal se trunca tras cada checkpoint`);

c1.close();
try { unlinkSync(tmp); unlinkSync(tmp + '-wal'); unlinkSync(tmp + '-shm'); } catch {}
console.log('\n' + (fail ? '✗ ' + fail + ' fallos, ' : '') + pass + ' OK');
process.exit(fail ? 1 : 0);
