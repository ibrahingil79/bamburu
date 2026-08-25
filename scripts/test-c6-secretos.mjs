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

console.log('\n[B8] DISA no manda al log los valores del WHERE (son PII de tus clientes)');
{
  const { redactarSql } = await import('../modules/disa/index.js');

  const casos = [
    { sql: "SELECT total FROM invoices WHERE client_name='Juan Pérez'", fuera: ['Juan Pérez'] },
    { sql: "SELECT * FROM clients WHERE email='ana@ejemplo.com' LIMIT 10", fuera: ['ana@ejemplo.com'] },
    { sql: "SELECT * FROM clients WHERE phone='+34600123456'", fuera: ['+34600123456'] },
    { sql: "SELECT * FROM invoices WHERE total > 1500.50 AND year = 2026", fuera: ['1500.50', '2026'] },
    { sql: `SELECT * FROM clients WHERE nombre="María O'Neill"`, fuera: ['María', "O'Neill"] },
  ];
  for (const { sql, fuera } of casos) {
    const red = redactarSql(sql);
    const filtrado = fuera.filter(v => red.includes(v));
    check(`ROJO antes de C6 · no se filtra ${fuera.join(' / ')}`, filtrado.length === 0, red);
  }

  // La FORMA se conserva: sin esto el log no serviría para nada y alguien lo volvería a abrir.
  const red = redactarSql("SELECT c.name, SUM(i.total) FROM clients c JOIN invoices i ON i.client_id=c.id WHERE c.email='x@y.test' GROUP BY c.id");
  check('conserva las tablas', red.includes('clients') && red.includes('invoices'));
  check('conserva el JOIN y el GROUP BY', red.includes('JOIN') && red.includes('GROUP BY'));
  check('conserva la columna del WHERE (se ve por qué buscaba, no a quién)', red.includes('c.email'));
  check('aguanta null/undefined sin reventar', redactarSql(null) === '' && redactarSql(undefined) === '');

  // El sitio real: lo que loguea la herramienta debe pasar por redactarSql, nunca el sql crudo.
  //
  // ⚙️ REESCRITO EL 24 AGO 2026. Antes esto buscaba el TEXTO LITERAL `console.log('[DISA] query_database:`
  // en UNA línea. El producto sigue haciendo lo correcto, pero la traza se generalizó para cubrir
  // todas las herramientas —`'[DISA] ' + toolUse.name + ':'`— y se partió en tres líneas, así que la
  // comprobación no encontraba su cadena y cantaba un fallo de producto que no existía.
  // **Medía cómo estaba ESCRITA la línea, no lo que hace.** Ahora se busca la SENTENCIA entera
  // (desde `console.log('[DISA] ` hasta su `);`) y se afirma sobre el mecanismo.
  const disa = leer('modules/disa/index.js');
  // Se busca la traza DE LA HERRAMIENTA, no cualquier `[DISA]`: hay varias, y la primera del fichero
  // es la del arranque («Usando BD»). La que importa es la que imprime `toolUse.name`.
  const i = disa.indexOf("console.log('[DISA] ' + toolUse.name");
  const sentencia = i === -1 ? '' : disa.slice(i, disa.indexOf(');', i) + 2);
  check('la traza de la herramienta pasa el SQL por redactarSql',
    /query_database'\s*\?\s*redactarSql\(/.test(sentencia.replace(/\s+/g, ' ')),
    sentencia.replace(/\s+/g, ' ').slice(0, 80));
  check('y NO manda el sql crudo al log',
    sentencia !== '' && !/(?<!redactarSql\()\binp\.sql\b(?![^)]*\))/.test(sentencia) && !/toolUse\.input\?\.sql\s*,/.test(sentencia));
}

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
