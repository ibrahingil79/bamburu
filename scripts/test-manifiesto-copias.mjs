// test-manifiesto-copias.mjs — Prueba de punta a punta del manifiesto de huellas del
// histórico de copias (manifiesto-huellas-backups). Sin Drive, sin sudo y sin red: ejecuta
// el `scripts/bamburu-backup.sh` REAL —no una versión de mentira— contra un remote local
// `local` (mundo EN CLARO) y contra un `crypt` local (mundo CIFRADO), cubriendo los siete
// casos (a)-(g) del análisis en los dos mundos.
//
// Nota del análisis, medida el 2 sep 2026: `~/.config/rclone/rclone.conf` está en solo
// lectura para el orquestador. Por eso NADA aquí toca los remotes de producción:
// RCLONE_CONFIG, HOME y BACKUP_DATA_DIR quedan completamente redirigidos a `/tmp` para
// cada laboratorio, y el destino es siempre `local`/`crypt`, nunca `gdrive:`.
//
// Lo que una prueba crea, la prueba lo borra: todos los laboratorios se registran al
// nacer y se eliminan en el `finally`, pase, falle o reviente algo por el camino.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, statSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const BACKUP_SH = join(APP, 'scripts', 'bamburu-backup.sh');
const HELPER = join(APP, 'scripts', 'lib', 'manifiesto-copias.mjs');
const RCLONE = '/usr/bin/rclone';

// Salida por stdout (no `console.log`, para no arrastrar residuos de depuración): una línea,
// con su salto final.
function imprimir(linea) {
  process.stdout.write(`${linea}\n`);
}

let ok = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) { ok++; imprimir(`  ✓ ${label}`); }
  else { fail++; imprimir(`  ✗ FALLO: ${label}${extra ? ' — ' + String(extra).slice(0, 250) : ''}`); }
};

// --- Laboratorios: se registran al crearse y se borran TODOS al final, pase lo que pase ---
const labs = [];
function nuevoTmp() {
  const t = mkdtempSync(join(tmpdir(), 'manif-test-'));
  labs.push(t);
  return t;
}

// Un wrapper que cuenta cuántas veces se invoca rclone, para el criterio "en claro, la
// verificación del histórico hace UNA sola llamada a rclone". Solo lo usa el AYUDANTE
// (vía RCLONE_BIN); bash sigue llamando a /usr/bin/rclone directamente para subir/verificar.
const WRAPPER = join(nuevoTmp(), 'rclone-contador.sh');
writeFileSync(WRAPPER, `#!/usr/bin/env bash\necho "$*" >> "\${RCLONE_LOG:?}"\nexec ${RCLONE} "$@"\n`);
chmodSync(WRAPPER, 0o755);

function fechaHace(dias) {
  return execFileSync('date', ['-d', `-${dias} days`, '+%F'], { encoding: 'utf8' }).trim();
}
function epochDeFecha(fecha) {
  return Number(execFileSync('date', ['-d', fecha, '+%s'], { encoding: 'utf8' }).trim());
}

function crearDb(ruta) {
  mkdirSync(dirname(ruta), { recursive: true });
  const db = new Database(ruta);
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  db.prepare('INSERT INTO t (v) VALUES (?)').run('inicial');
  db.close();
}
function tocarDb(ruta) {
  const db = new Database(ruta);
  db.prepare('INSERT INTO t (v) VALUES (?)').run('cambio-' + Date.now());
  db.close();
}

// --- Monta un negocio de mentira + un destino (local o crypt) ------------------------------
function montarLab(modo) {
  const tmp = nuevoTmp();
  const home = join(tmp, 'home'); mkdirSync(home, { recursive: true });
  const dataDir = join(tmp, 'data');
  crearDb(join(dataDir, 'control.db'));
  crearDb(join(dataDir, 'tenants', 'negocio-prueba.db'));
  mkdirSync(join(dataDir, 'uploads'), { recursive: true });
  writeFileSync(join(dataDir, 'uploads', 'nota.txt'), 'archivo de prueba\n');

  const env = {
    ...process.env,
    HOME: home,
    RCLONE_CONFIG: join(tmp, 'rc.conf'),
    BACKUP_DATA_DIR: dataDir,
    BACKUP_RETENTION_DAYS: '14',
    BACKUP_HC_URL: '',
  };
  delete env.RESEND_API_KEY;
  delete env.HEALTHCHECKS_URL;
  delete env.BACKUP_LABEL;
  delete env.BACKUP_SUFFIX;

  execFileSync(RCLONE, ['config', 'create', 'lbase', 'local'], { env });

  let remote;
  if (modo === 'claro') {
    const destino = join(tmp, 'destino');
    mkdirSync(destino, { recursive: true });
    remote = `lbase:${destino}`;
    env.BACKUP_REMOTE = remote;
  } else {
    const raiz = join(tmp, 'base');
    mkdirSync(raiz, { recursive: true });
    const pass = execFileSync(RCLONE, ['obscure', 'clave-de-prueba'], { env, encoding: 'utf8' }).trim();
    const pass2 = execFileSync(RCLONE, ['obscure', 'sal-de-prueba'], { env, encoding: 'utf8' }).trim();
    execFileSync(RCLONE, ['config', 'create', 'lcripto', 'crypt',
      `remote=lbase:${raiz}`, `password=${pass}`, `password2=${pass2}`,
      'filename_encryption=standard', 'directory_name_encryption=true'], { env });
    remote = 'lcripto:daily';
    const cfgDir = join(tmp, 'cfg-bamburu'); mkdirSync(cfgDir, { recursive: true });
    const destinosConf = join(cfgDir, 'backup-destinos.conf');
    writeFileSync(destinosConf, 'DESTINO_principal=lcripto:daily\n', { mode: 0o600 });
    env.BACKUP_DESTINOS_CONF = destinosConf;
  }

  return { tmp, home, dataDir, env, remote, modo };
}

function ejecutarBash(lab) {
  const r = spawnSync('bash', [BACKUP_SH], { env: lab.env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { status: r.status, combinado: `${r.stdout || ''}${r.stderr || ''}` };
}

const rutaManifiesto = (lab) => join(lab.home, '.local', 'state', 'bamburu-backup', 'manifiesto.jsonl');
const rutaEstado = (lab) => join(lab.home, '.local', 'state', 'bamburu-backup', 'manifiesto.estado.json');
const rutaLastOk = (lab) => join(lab.home, '.local', 'state', 'bamburu-backup', 'last-success');

function leerLineas(ruta) {
  if (!existsSync(ruta)) return [];
  return readFileSync(ruta, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
function ultimoRegistro(lab, nombre) {
  const lineas = leerLineas(rutaManifiesto(lab)).filter((l) => l.nombre === nombre);
  return lineas.length ? lineas[lineas.length - 1] : null;
}

function listarDestino(lab) {
  const out = execFileSync(RCLONE, ['lsf', lab.remote, '--files-only'], { env: lab.env, encoding: 'utf8' });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

// Simula "esto ya estaba subido de otra noche": nombre, contenido Y EDAD reales (mtime del
// fichero local, que rclone conserva al subir). Así el manifiesto (que lee la fecha del
// NOMBRE) y la retención de rclone (que lee el mtime real) están de acuerdo, igual que en
// producción — y `--min-age` de verdad puede caducar el objeto cuando toca (caso e).
function sembrarObjetoViejo(lab, nombre, contenido, dias) {
  const local = join(lab.tmp, `seed-${nombre}`);
  writeFileSync(local, contenido);
  const epoch = epochDeFecha(fechaHace(dias));
  utimesSync(local, epoch, epoch);
  execFileSync(RCLONE, ['copyto', local, `${lab.remote}/${nombre}`], { env: lab.env });
}

// Simula "un atacante con la cuenta de Drive reemplazó el contenido": sube algo distinto al
// MISMO nombre, por fuera del bucle de subida de bash (no entra en `--artefactos`), así que
// solo el paso 5 (verificar histórico) lo puede detectar.
function alterarObjeto(lab, nombre, contenidoNuevo) {
  const local = join(lab.tmp, `alterado-${nombre}`);
  writeFileSync(local, contenidoNuevo);
  execFileSync(RCLONE, ['copyto', local, `${lab.remote}/${nombre}`], { env: lab.env });
}
function borrarObjeto(lab, nombre) {
  execFileSync(RCLONE, ['deletefile', `${lab.remote}/${nombre}`], { env: lab.env });
}

// =============================================================================================
// Escenario 1 — (a) primera pasada sobre histórico preexistente, (b) segunda limpia,
//               (g) re-subida el mismo día con contenido distinto.
// =============================================================================================
function escenario1(modo) {
  imprimir(`\n[${modo}] Escenario 1 — (a) primera pasada · (b) segunda limpia · (g) re-subida con cambio`);
  const lab = montarLab(modo);
  const nombreViejo = `historico-${fechaHace(6)}.db`;
  sembrarObjetoViejo(lab, nombreViejo, 'contenido-historico-preexistente', 6);

  // --- (a) ---
  let r = ejecutarBash(lab);
  check('(a) primera pasada, con histórico preexistente y sin manifiesto, sale 0', r.status === 0, r.combinado);
  check('(a) el resumen dice "0 alarmas"', /0 alarmas/.test(r.combinado), r.combinado);
  check('(a) el resumen cuenta los objetos que esta copia no subió', /objetos que esta copia no subió/.test(r.combinado), r.combinado);
  const regObservado = ultimoRegistro(lab, nombreViejo);
  check(`(a) "${nombreViejo}" queda registrado con origen "observado"`, regObservado?.origen === 'observado');

  const manifRuta = rutaManifiesto(lab);
  const lineas = leerLineas(manifRuta);
  check('(criterio 2) hay al menos 3 líneas (2 subidas de hoy + el histórico observado)', lineas.length >= 3, lineas.length);
  for (const l of lineas) {
    check(`(criterio 2) "${l.nombre}": prev/hash son SHA-256 de 64 hex`, /^[0-9a-f]{64}$/.test(l.hash));
    if (l.origen === 'subido') {
      check(`(criterio 2) "${l.nombre}" (subido): sha256 de 64 hex`, /^[0-9a-f]{64}$/.test(l.sha256));
    }
  }
  const permisos = statSync(manifRuta).mode & 0o777;
  check('(criterio 2) el manifiesto está en permisos 600', permisos === 0o600, permisos.toString(8));
  const vc = spawnSync('node', [HELPER, 'verificar-cadena', '--manifiesto', manifRuta], { encoding: 'utf8' });
  check('(criterio 2) "verificar-cadena" sale 0', vc.status === 0, vc.stdout);

  // --- (b), y de paso el criterio 6 en el mundo en claro ---
  if (modo === 'claro') {
    const log = join(lab.tmp, 'rclone-calls.log');
    writeFileSync(log, '');
    lab.env.RCLONE_BIN = WRAPPER;
    lab.env.RCLONE_LOG = log;
    r = ejecutarBash(lab);
    delete lab.env.RCLONE_BIN; delete lab.env.RCLONE_LOG;
    const llamadas = readFileSync(log, 'utf8').split('\n').filter(Boolean);
    check('(criterio 6) en claro, la verificación del histórico hace UNA sola llamada a rclone', llamadas.length === 1, llamadas.join(' | '));
    check('(criterio 6) esa llamada pide sha256', /--hash-type sha256/.test(llamadas[0] || ''), llamadas[0]);
  } else {
    r = ejecutarBash(lab);
  }
  check('(b) segunda pasada, sin cambios, sale 0', r.status === 0, r.combinado);
  check('(b) segunda pasada, "0 alarmas"', /0 alarmas/.test(r.combinado), r.combinado);
  check('(criterio 6) el resumen dice "0 descargas"', /0 descargas/.test(r.combinado), r.combinado);

  // --- (g) re-subida el mismo día con contenido distinto ---
  tocarDb(join(lab.dataDir, 'tenants', 'negocio-prueba.db'));
  r = ejecutarBash(lab);
  check('(g) re-subida el mismo día con contenido nuevo sale 0 (verde)', r.status === 0, r.combinado);
  check('(g) sin alarmas — manda el registro más reciente', /0 alarmas/.test(r.combinado), r.combinado);
}

// =============================================================================================
// Escenario 2 — (c) alterar un objeto reciente, (d) borrarlo, (f) editar el manifiesto.
// =============================================================================================
function escenario2(modo) {
  imprimir(`\n[${modo}] Escenario 2 — (c) alterar · (d) borrar (edad<retención) · (f) editar el manifiesto`);
  const lab = montarLab(modo);
  const nombreReciente = `reciente-${fechaHace(5)}.db`;
  sembrarObjetoViejo(lab, nombreReciente, 'contenido-original-reciente', 5);

  let r = ejecutarBash(lab); // lo registra "observado"; la retención SÍ corre (5d < 14d) y no lo toca
  check('(setup 2) primera pasada verde', r.status === 0, r.combinado);
  check(`(setup 2) "${nombreReciente}" sigue en el destino`, listarDestino(lab).includes(nombreReciente));

  // Se siembra AHORA, justo antes de la primera pasada con alarma: si se sembrara antes, la
  // retención de la pasada verde de arriba se lo llevaría por delante y la prueba de "la
  // retención no corrió" no demostraría nada.
  const nombreViejisimo = `viejisimo-${fechaHace(20)}.db`;
  sembrarObjetoViejo(lab, nombreViejisimo, 'contenido-viejisimo', 20);

  // --- (c) alterar ---
  alterarObjeto(lab, nombreReciente, 'CONTENIDO-ALTERADO-POR-UN-ATACANTE');
  r = ejecutarBash(lab);
  check('(c) pasada con manipulación sale 1', r.status === 1, r.combinado);
  check(`(c) la salida nombra "${nombreReciente}"`, r.combinado.includes(nombreReciente));
  check('(c) la retención NO se ejecutó: el objeto de +RETENTION_DAYS sigue en el destino',
    listarDestino(lab).includes(nombreViejisimo));
  const lastOk1 = Number(readFileSync(rutaLastOk(lab), 'utf8').trim());
  check('(criterio 4) last-success queda reciente pese a la alarma (la copia de HOY sí se hizo)',
    Math.abs(Date.now() / 1000 - lastOk1) < 180, lastOk1);

  // --- (d) borrar ---
  borrarObjeto(lab, nombreReciente);
  r = ejecutarBash(lab);
  check('(d) pasada con borrado (edad < retención) sale 1', r.status === 1, r.combinado);
  check(`(d) la salida nombra "${nombreReciente}"`, r.combinado.includes(nombreReciente));
  check('(d) la retención sigue sin ejecutarse', listarDestino(lab).includes(nombreViejisimo));

  // --- (f) editar a mano una línea antigua del manifiesto ---
  const manifRuta = rutaManifiesto(lab);
  const crudas = readFileSync(manifRuta, 'utf8').split('\n').filter(Boolean);
  const primero = JSON.parse(crudas[0]);
  primero.bytes = (primero.bytes || 0) + 999;
  crudas[0] = JSON.stringify(primero);
  writeFileSync(manifRuta, crudas.join('\n') + '\n');
  const trasEditar = readFileSync(manifRuta, 'utf8');

  r = ejecutarBash(lab);
  check('(f) pasada tras editar a mano una línea antigua sale 1', r.status === 1, r.combinado);
  check('(f) se dice que la cadena no cuadra', /cadena/.test(r.combinado), r.combinado);
  check('(f) NO se ha añadido nada al manifiesto', readFileSync(manifRuta, 'utf8') === trasEditar);
}

// =============================================================================================
// Escenario 3 — (e) un objeto caduca de verdad (edad >= retención) y su ausencia NO alarma.
// =============================================================================================
function escenario3(modo) {
  imprimir(`\n[${modo}] Escenario 3 — (e) objeto caducado, ausencia sin alarma`);
  const lab = montarLab(modo);
  const nombreCaduco = `caduco-${fechaHace(15)}.db`;
  sembrarObjetoViejo(lab, nombreCaduco, 'contenido-que-va-a-caducar', 15);

  // Primera pasada: lo registra "observado" y, por ser verde, la retención corre de verdad
  // y se lo lleva (edad 15 >= RETENTION_DAYS=14).
  let r = ejecutarBash(lab);
  check('(setup e) primera pasada verde', r.status === 0, r.combinado);
  check(`(setup e) "${nombreCaduco}" ya no está en el destino (lo retiró la retención real)`,
    !listarDestino(lab).includes(nombreCaduco));

  // Segunda pasada: falta, con edad 15 >= RETENTION_DAYS-1(13) -> caducó, no es un borrado.
  r = ejecutarBash(lab);
  check('(e) la ausencia de un objeto caducado no alarma: sale 0', r.status === 0, r.combinado);
  check('(e) "0 alarmas"', /0 alarmas/.test(r.combinado), r.combinado);
}

function probarMundo(modo) {
  imprimir(`\n${'═'.repeat(70)}\nMUNDO: ${modo.toUpperCase()}\n${'═'.repeat(70)}`);
  for (const fn of [escenario1, escenario2, escenario3]) {
    try {
      fn(modo);
    } catch (e) {
      fail++;
      imprimir(`  ✗ FALLO: excepción en ${fn.name}(${modo}): ${e.message}`);
    }
  }
}

// --- Comprobación estática del criterio 7 (correo con SHA-256 por artefacto y cabeza) ------
// No hay red que interceptar (RESEND_API_KEY va sin definir a propósito en los laboratorios,
// para no intentar mandar nada real), así que esto se comprueba sobre el propio guion: que
// el cuerpo del correo de éxito interpola $SUMMARY (que ya lleva "sha256 $sha" por artefacto,
// añadido en esta tarea) y $MANIF_BLOQUE (que lleva la cabeza de la cadena).
function comprobarCorreoEstatico() {
  imprimir('\n[estático] El correo de éxito lleva el SHA-256 de cada artefacto y la cabeza');
  const src = readFileSync(BACKUP_SH, 'utf8');
  const conSha = (src.match(/— sha256 \$sha"/g) || []).length;
  check('(criterio 7) cada bloque de subida (BD y uploads) anota "sha256 $sha" para el correo', conSha === 2, conSha);
  const idx = src.indexOf('✅ Backup Bamburu');
  const bloque = idx === -1 ? '' : src.slice(idx, idx + 600);
  check('(criterio 7) el correo de éxito incluye $SUMMARY (huellas de hoy)', bloque.includes('$SUMMARY'));
  check('(criterio 7) el correo de éxito incluye $MANIF_BLOQUE (cabeza de la cadena)', bloque.includes('$MANIF_BLOQUE'));
}

try {
  for (const modo of ['claro', 'cifrado']) probarMundo(modo);
  comprobarCorreoEstatico();
} finally {
  for (const l of labs) { try { rmSync(l, { recursive: true, force: true }); } catch {} }
}

imprimir(`\n${'─'.repeat(58)}`);
imprimir(`  ${ok} OK · ${fail} fallos`);
imprimir('─'.repeat(58) + '\n');
process.exit(fail === 0 ? 0 : 1);
