// C6 · B1, B7, B8 — que ningún secreto ni PII salga por un log.
//
// B1/B7 son "NO imprimir": no hay comportamiento que ejercitar, así que se comprueban leyendo el
// código. Es un test de los que envejecen bien: si alguien vuelve a meter un console.log con la
// contraseña dentro, esto se pone rojo. B8 sí tiene función (redactarSql) y se prueba con datos.
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
// 25 ago 2026 · Los dominios de las direcciones de prueba pasan a `.test`, que está RESERVADO y no
// puede existir (RFC 2606). Antes usaban dominios que sí existen —de otra gente—, así que un correo
// del producto podía acabar en una bandeja ajena, y cada intento era un rebote contra bamburu.com.
// La puerta del correo los desvía a simulación. Ver docs/censo-correos.md.

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (p) => readFileSync(join(APP, p), 'utf8');

let ok = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✓ ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ FALLO: ${label}${extra ? ' — ' + extra : ''}`); }
};

// Un console.log que interpole una variable con pinta de contraseña. Busca el patrón, no el texto
// exacto: lo que se vigila es "imprimir un secreto", venga con la etiqueta que venga.
function imprimeSecreto(src) {
  const lineas = src.split('\n');
  return lineas.filter(l => {
    if (!/console\.(log|error|warn|info)/.test(l)) return false;
    if (/^\s*\/\//.test(l)) return false;                                   // comentarios no
    return /\$\{\s*(pwd|password|newPassword|tempPassword|DEV_PASSWORD|pass)\b/i.test(l)
        || /\+\s*(pwd|password|newPassword|tempPassword|DEV_PASSWORD|pass)\b/.test(l);
  });
}

console.log('\n[B1] El alta de negocio ya no imprime la contraseña semilla');
{
  const src = leer('modules/erp/models.js');
  const malas = imprimeSecreto(src);
  check('ROJO antes de C6 · ningún console.log con la contraseña', malas.length === 0, malas.join(' | ').slice(0, 90));
  check('la cuenta semilla se sigue creando (no se ha roto el alta)', src.includes("'admin@bamburu.com'"));
  check('y se dice que existe, sin decir su contraseña', /BD sin admin|cuenta semilla/i.test(src));
}

console.log('\n[B7] Los scripts de ops ya no imprimen contraseñas');
{
  for (const f of ['scripts/reset-admin.js', 'scripts/seed-superadmin.mjs', 'scripts/init-dev.mjs']) {
    const malas = imprimeSecreto(leer(f));
    check(`ROJO antes de C6 · ${f} no imprime ningún secreto`, malas.length === 0, malas.join(' | ').slice(0, 80));
  }
  check('reset-admin pide la contraseña por teclado', leer('scripts/reset-admin.js').includes('pedirContrasenyaNueva'));
  check('seed-superadmin también', leer('scripts/seed-superadmin.mjs').includes('pedirContrasenyaNueva'));
  check('y ya no generan contraseñas al azar para enseñarlas',
    !/randomBytes\([0-9]+\)\.toString\('base64url'\)/.test(leer('scripts/reset-admin.js')));

  const prompt = leer('scripts/lib/prompt-secret.mjs');
  check('el teclado exige terminal de verdad (si capturan stdout, aborta)', prompt.includes('isTTY'));
  check('y el eco se silencia', prompt.includes('silenciado'));
  check('reset-admin sigue exigiendo 10 (el mismo listón que las pantallas)',
    /pedirContrasenyaNueva\([^)]*\)/.test(leer('scripts/reset-admin.js')) && prompt.includes('minimo = 10'));
}

// ⚙️ 7 SEP 2026 (`sacar-disa-paso-2-borrado`) — AQUÍ IBA "[B8] DISA no manda al log los valores
// del WHERE": probaba `redactarSql` (modules/disa/index.js), que limpiaba de PII la traza de la
// herramienta de consulta genérica del chat antes de escribirla en el log. Se retira con el
// chat: no queda ninguna consulta que loguear.

console.log('\n[B9] Ninguna BD de negocio es legible por otros usuarios de la máquina');
{
  const { execSync } = await import('child_process');
  const sueltos = execSync(`find ${JSON.stringify(join(APP, 'data'))} -type f \\( -name '*.db' -o -name '*.db-wal' -o -name '*.db-shm' \\) -perm /077 2>/dev/null || true`)
    .toString().trim();
  check('ROJO antes de C6 · ni un fichero de BD con permisos de grupo/otros', sueltos === '', sueltos.split('\n').slice(0, 3).join(' '));
  const perms = leer('core/db-file-perms.js');
  check('las nuevas nacen restringidas (chmod explícito, no umask)', perms.includes('0o600') && perms.includes('chmodSync'));
  check('y también sus -wal/-shm (el WAL lleva datos)', perms.includes("'-wal'") && perms.includes("'-shm'"));
  check('el creador la aplica', leer('core/tenant-provisioning.js').includes('restringirBd'));
  check('y al abrir se autocura (arregla las que ya existían)', leer('core/tenant-middleware.js').includes('restringirBd'));
}

console.log(`\n${'─'.repeat(58)}`);
console.log(`  ${ok} OK · ${fail} fallos`);
console.log('─'.repeat(58) + '\n');
process.exit(fail === 0 ? 0 : 1);
