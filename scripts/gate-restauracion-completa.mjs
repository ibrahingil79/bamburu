#!/usr/bin/env node
//
// gate-restauracion-completa.mjs — AUD-020: que la prueba de restauración siga sabiendo decir NO.
//
// QUÉ MIDE, Y POR QUÉ NO TOCA DRIVE. La prueba de verdad
// (`scripts/restauracion-sistema-completo.mjs`) se ejecuta contra la copia REAL y tarda ~83 s
// bajándose 16 artefactos. Eso no puede correr en cada pasada del barrido. Este gate monta una
// copia de mentira COMPLETA en una carpeta local —con su `crypt` de rclone encima, igual que la
// de verdad— y ejecuta **el mismo guion, sin una línea distinta**, contra ella.
//
// LO QUE DE VERDAD VIGILA son los ROJOS. Que una restauración funcione el día que se prueba es
// media respuesta; la otra media es que **sepa fallar y decir qué falta**. Por eso aquí se le
// quitan piezas a la copia, una a una, y se exige que se pare y lo NOMBRE:
//   · sin el entorno   → «sin él el ERP no carga y Bamburu no arranca»
//   · sin control.db   → «sin él no se sabe qué negocios existen»
//   · sin negocios     → «no hay ni una base de negocio»
//   · copia vacía      → «la copia está vacía»
//   · base corrupta    → no se la traga por buena
//
// `--sin-aviso` en cada llamada: este gate no despierta a nadie por Telegram. Los avisos son de
// la prueba de verdad contra la copia de verdad, no de un ensayo con datos inventados.
//
//   node scripts/gate-restauracion-completa.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
const GUION = path.join(RAIZ, 'scripts/restauracion-sistema-completo.mjs');
const RCLONE = '/usr/bin/rclone';
const FECHA = new Date().toISOString().slice(0, 10);

let pass = 0, fail = 0;
const ok = (c, m, det) => {
  if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); }
  else { fail++; console.error('  ✗ FALLO: ' + m + (det ? ' · ' + det : '')); }
};

const BANCO = mkdtempSync(path.join(tmpdir(), 'gate-restauracion-'));
const CONF = path.join(BANCO, 'rclone.conf');
const rc = (...a) => execFileSync(RCLONE, a, { encoding: 'utf8', env: { ...process.env, RCLONE_CONFIG: CONF } });

/** Ejecuta la prueba REAL contra el destino de mentira. Devuelve { codigo, salida }. */
function restaurar(backend) {
  const r = spawnSync(process.execPath, [GUION, '--backend', backend, '--sin-aviso'], {
    encoding: 'utf8', timeout: 240_000,
    env: { ...process.env, RCLONE_CONFIG: CONF },
  });
  return { codigo: r.status, salida: (r.stdout || '') + (r.stderr || '') };
}

/** Una copia de mentira pero COMPLETA: lo mismo que sube `bamburu-backup.sh`, con los mismos nombres. */
function sembrarCopia(dirOrigen, { conEntorno = true, conControl = true, conNegocio = true, negocioRoto = false } = {}) {
  // ⚠️ SE PURGA EL DESTINO, y esto es lo que la primera versión hizo mal: `dirOrigen` es una ruta
  // REMOTA de rclone («zzcif:daily»), no una carpeta local, así que un `rmSync` sobre ella no
  // borraba nada. Los artefactos de la siembra anterior seguían ahí y los casos «sin entorno» o
  // «sin control.db» pasaban en VERDE — la pieza que se creía quitada seguía puesta. Lo cazó este
  // mismo gate al ponerse rojo, que es justo para lo que sirve probar en rojo.
  try { rc('purge', dirOrigen); } catch { /* aún no existe: nada que purgar */ }
  const tmp = path.join(BANCO, 'siembra');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(path.join(tmp, 'uploads'), { recursive: true });

  if (conControl) {
    // El esquema REAL de `tenants`, no uno inventado: si el de producción cambia, esto se entera.
    const c = path.join(tmp, 'control.db');
    execFileSync('sqlite3', [c, `CREATE TABLE tenants (id INTEGER PRIMARY KEY, name TEXT, slug TEXT,
      db_filename TEXT, plan TEXT, status TEXT, created_at TEXT, updated_at TEXT, country TEXT,
      suspended_at TEXT, suspend_note TEXT);
      INSERT INTO tenants (id,name,slug,db_filename,status) VALUES
        (1,'ZZ Gate Restauracion','zz-gate-restaura','data/tenants/zz-gate-restaura.db','active');`]);
    rc('copyto', c, dirOrigen + '/control-' + FECHA + '.db');
  }
  if (conNegocio) {
    const n = path.join(tmp, 'negocio.db');
    if (negocioRoto) writeFileSync(n, 'esto no es una base de datos, es basura a propósito\n');
    else execFileSync('sqlite3', [n, 'CREATE TABLE zz_semilla (x TEXT); INSERT INTO zz_semilla VALUES (\'zz\');']);
    rc('copyto', n, dirOrigen + '/zz-gate-restaura-' + FECHA + '.db');
  }
  if (conEntorno) {
    // El entorno mínimo con el que el ERP carga. `RESEND_API_KEY` tiene que estar: sin ella el
    // módulo esencial revienta al construir el cliente de correo — que es EXACTAMENTE el fallo
    // real del 3 sep, y por eso este gate lo lleva puesto en el caso verde.
    const e = path.join(tmp, 'entorno');
    mkdirSync(path.join(e, 'certificados'), { recursive: true });
    writeFileSync(path.join(e, 'bamburu.env'),
      'RESEND_API_KEY=re_zz_gate_falsa\nPUBLIC_BASE_DOMAIN=bamburu.com\nANTHROPIC_API_KEY=zz-falsa\n');
    writeFileSync(path.join(e, 'LEEME-PARA-VOLVER.txt'), 'copia de mentira del gate\n');
    const tar = path.join(tmp, 'entorno.tar.gz');
    execFileSync('tar', ['-czf', tar, '-C', e, '.']);
    rc('copyto', tar, dirOrigen + '/entorno-' + FECHA + '.tar.gz');
  }
  const tarUp = path.join(tmp, 'uploads.tar.gz');
  execFileSync('tar', ['-czf', tarUp, '-C', tmp, 'uploads']);
  rc('copyto', tarUp, dirOrigen + '/uploads-' + FECHA + '.tar.gz');
}

try {
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[0] UNA COPIA DE MENTIRA, CIFRADA, EN UNA CARPETA LOCAL');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const destino = path.join(BANCO, 'destino');
  mkdirSync(destino, { recursive: true });
  rc('config', 'create', 'zzcif', 'crypt', 'remote=' + destino,
     'password=' + rc('obscure', 'clave-gate-restauracion').trim(),
     'password2=' + rc('obscure', 'sal-gate-restauracion').trim(),
     'filename_encryption=standard', 'directory_name_encryption=true');
  sembrarCopia('zzcif:daily');
  const listado = rc('lsf', 'zzcif:daily/').trim().split('\n').filter(Boolean);
  ok(listado.length === 4, 'copia de mentira sembrada con sus 4 artefactos', listado.join(', '));

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] EN VERDE: la copia completa levanta el sistema');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const verde = restaurar('zzcif:daily');
  ok(verde.codigo === 0, 'la restauración completa termina en verde', 'código ' + verde.codigo);
  ok(/EL SISTEMA ENTERO SE LEVANTA DESDE LA COPIA/.test(verde.salida), '  y lo dice con todas las letras');
  ok(/TIEMPO TOTAL/.test(verde.salida), '  y DICE CUÁNTO HA TARDADO, que es medio criterio de la ficha');
  ok(/→ HTTP 200/.test(verde.salida), '  tras comprobar una pantalla real del negocio restaurado');
  if (verde.codigo !== 0) console.error(verde.salida.split('\n').slice(-6).join('\n'));

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] EN ROJO: si falta una pieza, se para Y DICE CUÁL');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const casos = [
    ['sin el ENTORNO',      { conEntorno: false }, /entorno.*Bamburu no arranca|falta.*entorno/i],
    ['sin CONTROL.DB',      { conControl: false }, /control\.db/i],
    ['sin NEGOCIOS',        { conNegocio: false }, /ni una base de negocio/i],
    ['con un negocio ROTO', { negocioRoto: true }, /ninguna base de negocio se pudo restaurar|no sirve/i],
  ];
  for (const [nombre, opciones, patron] of casos) {
    sembrarCopia('zzcif:daily', opciones);
    const r = restaurar('zzcif:daily');
    ok(r.codigo !== 0, nombre + ' → la prueba FALLA en rojo', 'código ' + r.codigo);
    ok(patron.test(r.salida), '  y nombra la pieza que falta', (r.salida.match(/Falta o falla: (.*)/) || ['', '?'])[1].slice(0, 70));
  }

  // La copia vacía del todo: el caso más tonto y el más fácil de dar por bueno sin querer.
  const vacio = path.join(BANCO, 'vacio');
  mkdirSync(vacio, { recursive: true });
  rc('config', 'create', 'zzvacio', 'crypt', 'remote=' + vacio,
     'password=' + rc('obscure', 'clave-gate-restauracion').trim(),
     'password2=' + rc('obscure', 'sal-gate-restauracion').trim(),
     'filename_encryption=standard', 'directory_name_encryption=true');
  const rVacio = restaurar('zzvacio:daily');
  ok(rVacio.codigo !== 0, 'copia VACÍA → la prueba falla en rojo', 'código ' + rVacio.codigo);
  ok(/vacía|no se puede leer la copia/i.test(rVacio.salida), '  y lo dice, en vez de levantar la nada');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] NO TOCA PRODUCCIÓN');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // El arranque aislado corre con `BAMBURU_DATA_ROOT` y `PORT` propios. Sin eso, cada pasada
  // repasaría los permisos de `data/` de producción y pelearía por el puerto 3000.
  const guion = readFileSync(GUION, 'utf8');
  ok(/BAMBURU_DATA_ROOT: TRABAJO/.test(guion), 'el arranque aislado apunta su raíz de datos al banco de pruebas');
  ok(/PORT: String\(puerto\)/.test(guion), '  y a un puerto libre pedido al sistema, no al 3000 de producción');
  ok(/puertoLibre/.test(guion), '  con el puerto preguntado al sistema, no inventado');
  const idx = readFileSync(path.join(RAIZ, 'index.js'), 'utf8');
  ok(/process\.env\.BAMBURU_DATA_ROOT \|\| APP_DIR_RAIZ/.test(idx),
     'y sin la variable puesta, producción se comporta igual que siempre');
  ok(/Number\(process\.env\.PORT\) \|\| 3000/.test(idx), '  también con el puerto: sin PORT, 3000 de siempre');

  // Y la prueba de que no ha dejado nada suyo por el camino.
  ok(!existsSync(path.join(RAIZ, 'data', 'tenants', 'zz-gate-restaura.db')),
     'no ha dejado el negocio de mentira en los datos de producción');

} catch (e) {
  fail++;
  console.error('  ✗ EXCEPCIÓN: ' + (e?.stack || e?.message || e));
} finally {
  rmSync(BANCO, { recursive: true, force: true });
}

console.log('\n═════════ RESULTADO: ' + pass + ' ✓ · ' + fail + ' ✗ ═════════');
process.exit(fail ? 1 : 0);
