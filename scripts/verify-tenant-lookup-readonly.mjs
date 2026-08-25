// Gate — BUSCAR UN EMAIL no abre la BD de nadie en modo escritura.
//
// Hallazgo del diagnóstico del 10-jul (el hermano del de superadmin): getTenantByEmail y
// getTenantsByEmail —que usan el alta y el login por email— recorren la .db de CADA negocio activo
// y las abrían en LECTURA+ESCRITURA solo para hacer un SELECT. Dos pegas:
//   1. Una conexión de escritura de más contra el mismo fichero, que se serializa con la del propio
//      negocio. Es el patrón que el diagnóstico de carga marcó como riesgo.
//   2. Si el fichero NO existía, SQLite lo CREABA vacío en el intento: una .db fantasma por cada
//      tenant descuadrado, nacida de una simple búsqueda.
// Ahora se abren con { readonly: true, fileMustExist: true }.
//   node scripts/verify-tenant-lookup-readonly.mjs
import { readFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { getTenantByEmail, getTenantsByEmail } from '../core/control-db.js';
// 25 ago 2026 · Los dominios de las direcciones de prueba pasan a `.test`, que está RESERVADO y no
// puede existir (RFC 2606). Antes usaban dominios que sí existen —de otra gente—, así que un correo
// del producto podía acabar en una bandeja ajena, y cada intento era un rebote contra bamburu.com.
// La puerta del correo los desvía a simulación. Ver docs/censo-correos.md.

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

// ── 1. Estructural: en control-db.js, la ÚNICA conexión de escritura es la de control.db ────
console.log('\n[1] control-db.js no abre ninguna .db de tenant en escritura');
const src = readFileSync('core/control-db.js', 'utf8');
const aperturas = [...src.matchAll(/new Database\(([^;]*?)\)\s*;/gs)].map(m => m[1].replace(/\s+/g, ' ').trim());
console.log('  · ' + aperturas.length + ' apertura(s) de BD en el fichero');
const deTenant = aperturas.filter(a => !/CONTROL_DB_PATH/.test(a));
ok(deTenant.length === 1, 'solo hay UNA apertura que no sea la de control.db (el helper compartido)');
ok(deTenant.every(a => /readonly:\s*true/.test(a)), 'y es readonly:true — no compite por el bloqueo de escritura');
ok(deTenant.every(a => /fileMustExist:\s*true/.test(a)), 'y fileMustExist:true — un fichero ausente falla, no NACE');
ok(/openTenantReadonly/.test(src), 'las dos búsquedas por email comparten el mismo helper (no se duplica el criterio)');
const cuerpos = ['getTenantByEmail', 'getTenantsByEmail'].map(f => src.slice(src.indexOf('export function ' + f), src.indexOf('export function ' + f) + 700));
ok(cuerpos.every(c => /openTenantReadonly\(/.test(c) && !/new Database/.test(c)),
   'ni getTenantByEmail ni getTenantsByEmail abren una conexión por su cuenta');

// ── 2. Semántica de los flags: readonly no escribe, y fileMustExist no crea ─────────────────
console.log('\n[2] qué hacen de verdad esos flags');
const fantasma = join(tmpdir(), 'fantasma-' + process.pid + '.db');
if (existsSync(fantasma)) unlinkSync(fantasma);
let lanzo = false;
try { new Database(fantasma, { readonly: true, fileMustExist: true }); } catch { lanzo = true; }
ok(lanzo, 'abrir una BD que no existe con fileMustExist → falla (lo traga el catch de quien busca)');
ok(!existsSync(fantasma), 'y NO deja el fichero creado: se acabaron las .db fantasma');

// Sin los flags (el comportamiento VIEJO): la abre y la CREA. Esto es lo que se ha quitado.
const viejo = join(tmpdir(), 'viejo-' + process.pid + '.db');
if (existsSync(viejo)) unlinkSync(viejo);
new Database(viejo).close();
ok(existsSync(viejo), 'demostración del bug: sin esos flags, SQLite CREA el fichero al abrirlo');
unlinkSync(viejo);

// readonly de verdad: no deja escribir.
const real = new Database('data/tenants/desarrollo-bamburu.db', { readonly: true, fileMustExist: true });
let bloqueado = false;
try { real.exec('CREATE TABLE zz_no_deberia (x INTEGER)'); } catch { bloqueado = true; }
ok(bloqueado, 'una conexión readonly NO puede escribir en la .db del negocio');
real.close();

// ── 3. Funcional: buscar por email sigue encontrando el negocio ─────────────────────────────
console.log('\n[3] la búsqueda por email sigue funcionando');
// EL CORREO SE LEE DE LA BASE, no se escribe aquí. Esta comprobación busca un negocio POR correo, así
// que necesita uno que exista de verdad — y hasta el 25 ago 2026 estaba puesta a mano la bandeja del
// dueño. No manda nada (es una consulta), pero una dirección real escrita en una comprobación es cómo
// empiezan estas cosas. Leyéndola de la base sigue existiendo y no está escrita en ninguna parte.
const dev = new Database('data/tenants/desarrollo-bamburu.db', { readonly: true, fileMustExist: true });
const email = dev.prepare("SELECT email FROM admin_users WHERE active=1 AND email LIKE '%@%' ORDER BY id LIMIT 1").get()?.email;
dev.close();
if (!email) { console.error('\n✗ ABORTADO — el negocio de desarrollo no tiene ningún admin con correo. No ha verificado NADA.'); process.exit(2); }
const uno = getTenantByEmail(email);
ok(!!uno && !!uno.slug, `getTenantByEmail("${email}") → "${uno?.slug}"`);
const todos = getTenantsByEmail(email);
ok(Array.isArray(todos) && todos.length >= 1, `getTenantsByEmail → ${todos.length} negocio(s): ${todos.map(t => t.slug).join(', ')}`);
ok(todos.some(t => t.slug === uno.slug), 'el que devuelve la búsqueda simple está entre los de la múltiple');
ok(getTenantByEmail('no-existe-' + process.pid + '@bamburu.test') === null, 'un email que no está en ningún negocio → null');
ok(getTenantsByEmail('no-existe-' + process.pid + '@bamburu.test').length === 0, 'y la búsqueda múltiple devuelve []');

// ── 4. Los DOS flujos que dependen de esto, ejercidos de verdad ─────────────────────────────
// getTenantsByEmail → login por email (/find-tenant, index.js). getTenantByEmail → emailTaken,
// que el alta usa para no dejar registrar dos veces el mismo correo.
console.log('\n[4] los dos flujos que dependen de estas funciones');
const { emailTaken } = await import('../core/tenant-signup.js');
ok(emailTaken(email) === true, 'ALTA: un email ya registrado se detecta como ocupado');
ok(emailTaken('libre-' + process.pid + '@bamburu.test') === false, 'ALTA: un email libre se detecta como libre');
ok(getTenantsByEmail(email)[0]?.slug === uno.slug, 'LOGIN por email: /find-tenant resuelve el negocio correcto');

console.log('\n' + (fail ? '✗ ' + fail + ' fallos, ' : '') + pass + ' OK');
process.exit(fail ? 1 : 0);
