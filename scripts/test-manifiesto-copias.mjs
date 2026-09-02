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

// =============================================================================================
// Escenario 4 — (h) el destino cambia de mundo ENTRE pasadas, sin que nadie edite el
//               manifiesto a mano: exactamente lo que hace `cifrar-copias-de-seguridad.sh`
//               la noche que Ibrahin lo ejecute (y su camino inverso, al apagarlo). Las
//               huellas guardadas de antes son de otro mundo y no deben compararse; el
//               objeto se re-ancla, sin alarma, y la retención sigue funcionando.
// =============================================================================================
function escenario4() {
  imprimir(`\n[transición] Escenario 4 — (h) el destino cambia de mundo entre pasadas`);
  const lab = montarLab('claro');
  const remoteClaro = lab.remote;

  // Noche 1, EN CLARO: un histórico que NO se resube cada noche (a diferencia de las BD),
  // para que sobreviva a la transición como un registro "viejo" de verdad.
  const nombreHistorico = `historico-${fechaHace(5)}.db`;
  sembrarObjetoViejo(lab, nombreHistorico, 'contenido-historico', 5);
  let r = ejecutarBash(lab);
  check('(h-1) noche 1 en claro, verde', r.status === 0, r.combinado);

  // --- Se enciende el cifrado: se crea el crypt sobre una raíz NUEVA, se migra el
  // histórico dentro (copiar y SOLO entonces retirar, como `--migrar-historico --hazlo`) y
  // se escribe el fichero de destinos — el mismo cerrojo que usa `montarLab('cifrado')`.
  const raizCifrada = join(lab.tmp, 'base-cifrada'); mkdirSync(raizCifrada, { recursive: true });
  const pass = execFileSync(RCLONE, ['obscure', 'clave-transicion'], { env: lab.env, encoding: 'utf8' }).trim();
  const pass2 = execFileSync(RCLONE, ['obscure', 'sal-transicion'], { env: lab.env, encoding: 'utf8' }).trim();
  execFileSync(RCLONE, ['config', 'create', 'ltrans', 'crypt',
    `remote=lbase:${raizCifrada}`, `password=${pass}`, `password2=${pass2}`,
    'filename_encryption=standard', 'directory_name_encryption=true'], { env: lab.env });
  execFileSync(RCLONE, ['copy', `${remoteClaro}/`, 'ltrans:daily/'], { env: lab.env });
  execFileSync(RCLONE, ['delete', `${remoteClaro}/`], { env: lab.env });
  const destinosDir = join(lab.home, '.config', 'bamburu'); mkdirSync(destinosDir, { recursive: true });
  const destinosConf = join(destinosDir, 'backup-destinos.conf');
  writeFileSync(destinosConf, 'DESTINO_principal=ltrans:daily\n', { mode: 0o600 });
  lab.remote = 'ltrans:daily';

  // --- Noche 2, primera pasada CIFRADA tras la transición. ---
  const lineasAntes = leerLineas(rutaManifiesto(lab)).length;
  r = ejecutarBash(lab);
  check('(h-2) primera pasada cifrada tras encender el cifrado sale 0 (sin alarma falsa)', r.status === 0, r.combinado);
  check('(h-2) "0 alarmas"', /0 alarmas/.test(r.combinado), r.combinado);
  check('(h-2) el resumen nombra el re-anclaje: EN CLARO a CIFRADO',
    /\d+ objetos re-anclados porque el destino cambió de EN CLARO a CIFRADO/.test(r.combinado), r.combinado);
  const regHistoricoCifrado = ultimoRegistro(lab, nombreHistorico);
  check(`(h-2) "${nombreHistorico}" queda re-anclado, no huérfano`,
    regHistoricoCifrado?.origen === 'reanclado', JSON.stringify(regHistoricoCifrado));
  check('(h-2) el manifiesto sigue creciendo (no se quedó clavado)',
    leerLineas(rutaManifiesto(lab)).length > lineasAntes);

  // La retención tiene que seguir funcionando tras el re-anclaje: se siembra un objeto ya
  // caducado DESPUÉS de la pasada de arriba (si se sembrara antes, esa misma pasada verde
  // se lo llevaría por delante y no probaría nada tras la transición).
  const nombreCaduco = `viejisimo-${fechaHace(20)}.db`;
  sembrarObjetoViejo(lab, nombreCaduco, 'contenido-viejisimo', 20);
  r = ejecutarBash(lab);
  check('(h-3) siguiente pasada ya establecida en cifrado sale 0', r.status === 0, r.combinado);
  check('(h-3) la retención SÍ se ejecuta tras el re-anclaje: se retira lo caducado',
    !listarDestino(lab).includes(nombreCaduco));

  // --- Excepción de continuidad de contenido, yendo de CIFRADO a CLARO (observación 4 del
  // revisor: hoy no la ejerce nadie, porque el registro nunca llegaba a esta vuelta con un
  // sha256 de contenido no nulo). Se borra la BD de este negocio ANTES de la vuelta: así esa
  // noche NO se re-sube (bash solo empaqueta lo que encuentra en $DATA_DIR/tenants/*.db) y su
  // único rastro en el destino es el objeto migrado de la etapa cifrada, con la huella de
  // CONTENIDO que traía su último registro "subido".
  const nombreDbNegocio = `negocio-prueba-${fechaHace(0)}.db`;
  const regDbNegocioCifrado = ultimoRegistro(lab, nombreDbNegocio);
  check('(continuidad, setup) la BD del negocio está registrada "subido" con huella de contenido antes de la vuelta',
    regDbNegocioCifrado?.origen === 'subido' && !!regDbNegocioCifrado?.sha256, JSON.stringify(regDbNegocioCifrado));
  rmSync(join(lab.dataDir, 'tenants', 'negocio-prueba.db'), { force: true });

  // --- Camino inverso: se apaga el cifrado. El histórico se migra de vuelta al remote en
  // claro original y se borra el fichero de destinos — el cerrojo desaparece con él.
  execFileSync(RCLONE, ['copy', 'ltrans:daily/', `${remoteClaro}/`], { env: lab.env });
  execFileSync(RCLONE, ['delete', 'ltrans:daily/'], { env: lab.env });
  rmSync(destinosConf, { force: true });
  lab.remote = remoteClaro;

  const lineasAntesVuelta = leerLineas(rutaManifiesto(lab)).length;
  r = ejecutarBash(lab);
  check('(h-4) primera pasada en claro tras apagar el cifrado sale 0 (sin alarma falsa)', r.status === 0, r.combinado);
  check('(h-4) "0 alarmas"', /0 alarmas/.test(r.combinado), r.combinado);
  check('(h-4) el resumen nombra el re-anclaje: CIFRADO a EN CLARO',
    /\d+ objetos re-anclados porque el destino cambió de CIFRADO a EN CLARO/.test(r.combinado), r.combinado);
  check('(h-4) el manifiesto sigue creciendo',
    leerLineas(rutaManifiesto(lab)).length > lineasAntesVuelta);

  const regDbNegocioClaro = ultimoRegistro(lab, nombreDbNegocio);
  check('(continuidad) la BD que no se resubió esta noche se re-ancla por su CONTENIDO, sin alarma',
    r.status === 0 && regDbNegocioClaro?.origen === 'reanclado', JSON.stringify(regDbNegocioClaro));

  // --- Y si alguien ALTERA ese objeto que sobrevivió solo por continuidad de contenido, la
  // pasada siguiente lo detecta y lo nombra: la excepción compara de verdad, no calla.
  alterarObjeto(lab, nombreDbNegocio, 'CONTENIDO-ALTERADO-TRAS-LA-VUELTA-A-CLARO');
  r = ejecutarBash(lab);
  check('(continuidad) alterar esa BD tras la vuelta sale 1', r.status === 1, r.combinado);
  check(`(continuidad) la alarma nombra "${nombreDbNegocio}"`, r.combinado.includes(nombreDbNegocio), r.combinado);
}

// =============================================================================================
// Escenario 5 — (i) el destino cambia de mundo y el histórico SE QUEDA ATRÁS: el caso que
// tumbó al intento 3. El destino EN CLARO de la "noche 1" vive en su PROPIO remote
// ("lviejo"), aparte del que sostiene el destino cifrado nuevo, para poder retirarlo DE
// VERDAD en (i-5) sin tocar nada vivo.
// =============================================================================================
function escenario5() {
  imprimir('\n[transición] Escenario 5 — (i) cifrado sin migrar: el histórico se queda atrás, vigilado donde está');
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

  // El destino EN CLARO de "esta noche 1" vive en su propio remote, creado con
  // `rclone config create` para poder retirarlo de verdad en (i-5).
  execFileSync(RCLONE, ['config', 'create', 'lviejo', 'local'], { env });
  const destinoViejo = join(tmp, 'destino-viejo'); mkdirSync(destinoViejo, { recursive: true });
  const remoteViejo = `lviejo:${destinoViejo}`;
  const lab = { tmp, home, dataDir, env, remote: remoteViejo, modo: 'claro' };
  lab.env.BACKUP_REMOTE = remoteViejo;

  // --- (i-1) noche 1, en claro, con un histórico preexistente. ---
  const nombreHistorico = `historico-${fechaHace(5)}.db`;
  sembrarObjetoViejo(lab, nombreHistorico, 'contenido-historico-que-se-queda-atras', 5);
  let r = ejecutarBash(lab);
  check('(i-1) noche 1 en claro, con histórico preexistente, sale 0', r.status === 0, r.combinado);

  // --- (i-2) se enciende el cifrado sobre una raíz NUEVA, sin migrar nada — literalmente lo
  // que hace `cifrar-copias-de-seguridad.sh` y luego irse a dormir. ---
  execFileSync(RCLONE, ['config', 'create', 'lbase', 'local'], { env });
  const raizCifrada = join(tmp, 'base-cifrada'); mkdirSync(raizCifrada, { recursive: true });
  const pass = execFileSync(RCLONE, ['obscure', 'clave-i'], { env, encoding: 'utf8' }).trim();
  const pass2 = execFileSync(RCLONE, ['obscure', 'sal-i'], { env, encoding: 'utf8' }).trim();
  execFileSync(RCLONE, ['config', 'create', 'lnuevocripto', 'crypt',
    `remote=lbase:${raizCifrada}`, `password=${pass}`, `password2=${pass2}`,
    'filename_encryption=standard', 'directory_name_encryption=true'], { env });
  const destinosDir = join(home, '.config', 'bamburu'); mkdirSync(destinosDir, { recursive: true });
  const destinosConf = join(destinosDir, 'backup-destinos.conf');
  writeFileSync(destinosConf, 'DESTINO_principal=lnuevocripto:daily\n', { mode: 0o600 });
  lab.env.BACKUP_DESTINOS_CONF = destinosConf;
  lab.remote = 'lnuevocripto:daily';

  r = ejecutarBash(lab);
  check('(i-2) cifrado sin migrar: la pasada de esa noche sale 0', r.status === 0, r.combinado);
  check('(i-2) la salida NO contiene "¿borrado?"', !r.combinado.includes('¿borrado?'), r.combinado);
  check('(i-2) la salida dice que el histórico sigue en el destino anterior',
    /objetos del histórico siguen en el destino anterior/.test(r.combinado), r.combinado);
  check(`(i-2) nombra "${nombreHistorico}"`, r.combinado.includes(nombreHistorico), r.combinado);

  // --- (i-3) la retención SÍ se ejecuta: un objeto caducado sembrado en el destino NUEVO
  // desaparece. Se siembra DESPUÉS de (i-2) para que esa pasada verde no se lo lleve por
  // delante y la prueba demuestre algo tras la transición. ---
  const nombreCaduco = `viejisimo-${fechaHace(20)}.db`;
  sembrarObjetoViejo(lab, nombreCaduco, 'contenido-viejisimo', 20);
  r = ejecutarBash(lab);
  check('(i-3) siguiente pasada sale 0', r.status === 0, r.combinado);
  check('(i-3) la retención SÍ se ejecuta en el destino nuevo', !listarDestino(lab).includes(nombreCaduco));

  // --- (i-4) la vigilancia NO se pierde al cambiar de destino: alterar el objeto que se
  // quedó en el destino anterior hace saltar la alarma con su nombre. ---
  alterarObjeto({ tmp, remote: remoteViejo, env }, nombreHistorico, 'CONTENIDO-ALTERADO-EN-EL-DESTINO-ANTERIOR');
  r = ejecutarBash(lab);
  check('(i-4) alterar el histórico rezagado sale 1', r.status === 1, r.combinado);
  check(`(i-4) la alarma nombra "${nombreHistorico}"`, r.combinado.includes(nombreHistorico), r.combinado);

  // --- (i-5) se retira el remote viejo: a partir de aquí, SIN VIGILAR, nunca "¿borrado?". ---
  execFileSync(RCLONE, ['config', 'delete', 'lviejo'], { env });
  r = ejecutarBash(lab);
  check('(i-5) retirado el remote anterior, la pasada sale 0', r.status === 0, r.combinado);
  check('(i-5) la salida dice "quedan SIN VIGILAR"', r.combinado.includes('quedan SIN VIGILAR'), r.combinado);
  check('(i-5) la salida NO contiene "¿borrado?"', !r.combinado.includes('¿borrado?'), r.combinado);

  comprobarCorreoRezagados();
}

// (i-6) el correo ✅ del caso "cifrado sin migrar" incluye la línea de los rezagados, sin que
// bash conozca su texto: con un `curl` falso al principio del PATH del laboratorio (escribe
// su `--data` a un fichero) y RESEND_API_KEY definida. Repite (i-1)+(i-2) en un lab nuevo,
// para no arrastrar el estado ya "sin vigilar" que deja (i-5).
function comprobarCorreoRezagados() {
  imprimir('\n[transición] (i-6) el correo ✅ del caso "cifrado sin migrar" incluye la línea de los rezagados');
  const tmp = nuevoTmp();
  const home = join(tmp, 'home'); mkdirSync(home, { recursive: true });
  const dataDir = join(tmp, 'data');
  crearDb(join(dataDir, 'control.db'));
  crearDb(join(dataDir, 'tenants', 'negocio-prueba.db'));
  mkdirSync(join(dataDir, 'uploads'), { recursive: true });
  writeFileSync(join(dataDir, 'uploads', 'nota.txt'), 'archivo de prueba\n');

  const curlLog = join(tmp, 'curl-data.txt');
  const binDir = join(tmp, 'bin'); mkdirSync(binDir, { recursive: true });
  const curlFalso = join(binDir, 'curl');
  writeFileSync(curlFalso, `#!/usr/bin/env bash
prev=""
for a in "$@"; do
  if [ "$prev" = "--data" ]; then printf '%s' "$a" >> "${curlLog}"; fi
  prev="$a"
done
echo '{"id":"fake"}'
`);
  chmodSync(curlFalso, 0o755);

  const env = {
    ...process.env,
    HOME: home,
    PATH: `${binDir}:${process.env.PATH}`,
    RCLONE_CONFIG: join(tmp, 'rc.conf'),
    BACKUP_DATA_DIR: dataDir,
    BACKUP_RETENTION_DAYS: '14',
    BACKUP_HC_URL: '',
    RESEND_API_KEY: 'clave-de-prueba-no-real',
  };
  delete env.HEALTHCHECKS_URL;
  delete env.BACKUP_LABEL;
  delete env.BACKUP_SUFFIX;

  execFileSync(RCLONE, ['config', 'create', 'lviejo', 'local'], { env });
  const destinoViejo = join(tmp, 'destino-viejo'); mkdirSync(destinoViejo, { recursive: true });
  const remoteViejo = `lviejo:${destinoViejo}`;
  const lab = { tmp, home, dataDir, env, remote: remoteViejo, modo: 'claro' };
  lab.env.BACKUP_REMOTE = remoteViejo;

  const nombreHistorico = `historico-${fechaHace(5)}.db`;
  sembrarObjetoViejo(lab, nombreHistorico, 'contenido-para-el-correo', 5);
  let r = ejecutarBash(lab);
  check('(i-6 setup) noche 1 en claro, verde', r.status === 0, r.combinado);

  execFileSync(RCLONE, ['config', 'create', 'lbase', 'local'], { env });
  const raizCifrada = join(tmp, 'base-cifrada'); mkdirSync(raizCifrada, { recursive: true });
  const pass = execFileSync(RCLONE, ['obscure', 'clave-i6'], { env, encoding: 'utf8' }).trim();
  const pass2 = execFileSync(RCLONE, ['obscure', 'sal-i6'], { env, encoding: 'utf8' }).trim();
  execFileSync(RCLONE, ['config', 'create', 'lnuevocripto', 'crypt',
    `remote=lbase:${raizCifrada}`, `password=${pass}`, `password2=${pass2}`,
    'filename_encryption=standard', 'directory_name_encryption=true'], { env });
  const destinosDir = join(home, '.config', 'bamburu'); mkdirSync(destinosDir, { recursive: true });
  const destinosConf = join(destinosDir, 'backup-destinos.conf');
  writeFileSync(destinosConf, 'DESTINO_principal=lnuevocripto:daily\n', { mode: 0o600 });
  lab.env.BACKUP_DESTINOS_CONF = destinosConf;
  lab.remote = 'lnuevocripto:daily';

  r = ejecutarBash(lab);
  check('(i-6) cifrado sin migrar, con RESEND_API_KEY, sale 0', r.status === 0, r.combinado);
  const cuerpoCorreo = existsSync(curlLog) ? readFileSync(curlLog, 'utf8') : '';
  check('(i-6) el correo ✅ incluye la línea de los rezagados',
    /objetos del hist.rico siguen en el destino anterior/.test(cuerpoCorreo), cuerpoCorreo.slice(0, 400));
}

// =============================================================================================
// Escenario 6 — (j) rotación de la clave del `crypt`, sobre la MISMA raíz. Es lo que hoy
// declara "¿borrado?" sobre un fichero subido cinco segundos antes (§1.3 del análisis).
// =============================================================================================
function escenario6() {
  imprimir('\n[cifrado] Escenario 6 — (j) rotación de la clave del crypt, sobre la MISMA raíz');
  const lab = montarLab('cifrado');
  const nombreHistorico = `historico-${fechaHace(6)}.db`;
  sembrarObjetoViejo(lab, nombreHistorico, 'contenido-historico-clave-vieja', 6);

  let r = ejecutarBash(lab);
  check('(j-1) noche 1 cifrada, con histórico preexistente, sale 0', r.status === 0, r.combinado);
  const nombreDbHoy = `negocio-prueba-${fechaHace(0)}.db`;
  const regHoyAntes = ultimoRegistro(lab, nombreDbHoy);

  // Se reescribe el crypt con OTRA password, sobre la MISMA raíz (mismo `remote=lbase:...`,
  // la base NO cambia) — exactamente lo que tumbaba al intento 3.
  const pass = execFileSync(RCLONE, ['obscure', 'clave-nueva-tras-rotar'], { env: lab.env, encoding: 'utf8' }).trim();
  const pass2 = execFileSync(RCLONE, ['obscure', 'sal-nueva-tras-rotar'], { env: lab.env, encoding: 'utf8' }).trim();
  execFileSync(RCLONE, ['config', 'update', 'lcripto', `password=${pass}`, `password2=${pass2}`], { env: lab.env });

  const lineasAntesRotar = leerLineas(rutaManifiesto(lab)).length;
  r = ejecutarBash(lab);
  check('(j-2) noche 2, tras rotar la clave, sale 0', r.status === 0, r.combinado);
  check('(j-2) "0 alarmas"', /0 alarmas/.test(r.combinado), r.combinado);
  check('(j-2) NO dice "¿borrado?" de ningún fichero', !r.combinado.includes('¿borrado?'), r.combinado);
  check('(j-2) el manifiesto sigue creciendo', leerLineas(rutaManifiesto(lab)).length > lineasAntesRotar);

  // El artefacto de HOY (tenant DB, re-subido cada noche) queda registrado con su ruta
  // cifrada NUEVA — la vieja ya no existe bajo la clave nueva.
  const regHoyDespues = ultimoRegistro(lab, nombreDbHoy);
  check(`(j-2) "${nombreDbHoy}" queda registrado con su ruta cifrada nueva`,
    !!regHoyDespues?.destino?.ruta && regHoyDespues.destino.ruta !== regHoyAntes?.destino?.ruta,
    JSON.stringify({ antes: regHoyAntes?.destino?.ruta, despues: regHoyDespues?.destino?.ruta }));
  check(`(j-2) "${nombreDbHoy}" aparece en el destino de hoy`, listarDestino(lab).includes(nombreDbHoy));

  // El histórico de la clave VIEJA sigue ahí (nadie lo tocó): se comprueba DONDE ESTÁ, no se
  // declara huérfano.
  const regHistorico = ultimoRegistro(lab, nombreHistorico);
  check(`(j-2) "${nombreHistorico}" (clave vieja) sale comprobado donde está, no huérfano`,
    !!regHistorico && !r.combinado.includes(`falta "${nombreHistorico}"`), JSON.stringify(regHistorico));
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
  try {
    escenario4();
  } catch (e) {
    fail++;
    imprimir(`  ✗ FALLO: excepción en escenario4: ${e.message}`);
  }
  try {
    escenario5();
  } catch (e) {
    fail++;
    imprimir(`  ✗ FALLO: excepción en escenario5: ${e.message}`);
  }
  try {
    escenario6();
  } catch (e) {
    fail++;
    imprimir(`  ✗ FALLO: excepción en escenario6: ${e.message}`);
  }
  comprobarCorreoEstatico();
} finally {
  for (const l of labs) { try { rmSync(l, { recursive: true, force: true }); } catch {} }
}

imprimir(`\n${'─'.repeat(58)}`);
imprimir(`  ${ok} OK · ${fail} fallos`);
imprimir('─'.repeat(58) + '\n');
process.exit(fail === 0 ? 0 : 1);
