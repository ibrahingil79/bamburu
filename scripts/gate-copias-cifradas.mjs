#!/usr/bin/env node
//
// gate-copias-cifradas.mjs — AUD-008: que la copia vaya CIFRADA, que sirva para VOLVER, y que los
// secretos no salgan jamás en claro.
//
// ⚠️ QUÉ MIDE, Y CÓMO. **Ejecuta el guion de copia de verdad** —el mismo `scripts/bamburu-backup.sh`
// que corre cada madrugada— contra un mundo de mentira: un `crypt` de rclone montado sobre una
// carpeta local, unas bases de datos de juguete y un fichero de entorno inventado. Sin red, sin
// Drive, sin tocar nada del servidor. Después **mira los bytes del destino en crudo**: si el
// contenido del entorno se puede leer ahí, el cifrado no está haciendo nada.
//
// LOS TRES ESCENARIOS, y el segundo es el que importa de verdad:
//   [1] Destino CIFRADO  -> la copia lleva el entorno y los certificados, y en crudo no se lee nada.
//   [2] Destino EN CLARO -> la copia SALE IGUAL (no quedarse sin copia manda) pero **SIN secretos**.
//   [3] Llave EQUIVOCADA -> no se puede leer lo que hay. Si se pudiera, el cifrado sería decorativo.
//   [4] Un fallo AVISA   -> se fuerza un fallo y se exige que llame al aviso de Telegram.
//
//   node scripts/gate-copias-cifradas.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
const GUION = path.join(RAIZ, 'scripts/bamburu-backup.sh');
const RCLONE = '/usr/bin/rclone';
let pass = 0, fail = 0;
const ok = (c, m, det) => {
  if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); }
  else { fail++; console.error('  ✗ FALLO: ' + m + (det ? ' · ' + det : '')); }
};

// El secreto de mentira. Se busca LITERAL en los bytes del destino: es la única forma honesta de
// afirmar «no viaja en claro» — mirar el nombre del fichero no dice nada del contenido.
const CANARIO = 'ZZ-CANARIO-SECRETO-' + Math.random().toString(36).slice(2, 10).toUpperCase();

const BANCO = mkdtempSync(path.join(tmpdir(), 'gate-copias-'));
const rc = (...args) => execFileSync(RCLONE, args, { encoding: 'utf8', env: { ...process.env, RCLONE_CONFIG: path.join(BANCO, 'rclone.conf') } });

/** Un mundo de mentira completo: datos, entorno, certificados y un sitio donde dejar la copia. */
function montarMundo(nombre) {
  const dir = path.join(BANCO, nombre);
  mkdirSync(path.join(dir, 'data/tenants'), { recursive: true });
  mkdirSync(path.join(dir, 'data/uploads'), { recursive: true });
  mkdirSync(path.join(dir, 'destino'), { recursive: true });
  mkdirSync(path.join(dir, 'home'), { recursive: true });
  mkdirSync(path.join(dir, 'certs'), { recursive: true });
  // Dos bases de verdad, con sqlite3 del sistema: el guion hace snapshot e integrity_check.
  for (const [f, t] of [['data/control.db', 'tenants'], ['data/tenants/zz-prueba.db', 'cosas']]) {
    execFileSync('sqlite3', [path.join(dir, f), `CREATE TABLE ${t}(id INTEGER PRIMARY KEY, x TEXT); INSERT INTO ${t}(x) VALUES('zz');`]);
  }
  writeFileSync(path.join(dir, 'data/uploads/algo.txt'), 'un fichero subido\n');
  writeFileSync(path.join(dir, 'env'), 'STRIPE_SECRET_KEY=' + CANARIO + '\nOTRA=1\n');
  return dir;
}

/** Corre el guion de copia REAL con el mundo de mentira colgado por entorno. */
function copiar(dir, { remote, destinos = null, envFile = 'env', telegramCli = null }) {
  const env = {
    ...process.env,
    HOME: path.join(dir, 'home'),
    RCLONE_CONFIG: path.join(BANCO, 'rclone.conf'),
    BACKUP_DATA_DIR: path.join(dir, 'data'),
    BACKUP_ENV_FILE: path.join(dir, envFile),
    VERIFACTU_CERT_DIR: path.join(dir, 'certs'),
    BACKUP_REMOTE: remote,
    BACKUP_LABEL: 'principal',
    BACKUP_SUFFIX: '-gate',
    BACKUP_DESTINOS_CONF: destinos || path.join(dir, 'no-existe.conf'),
    TELEGRAM_CLI: telegramCli || path.join(dir, 'telegram-falso.sh'),
  };
  delete env.RESEND_API_KEY;       // ni un correo de verdad
  delete env.HEALTHCHECKS_URL;     // ni un ping de verdad
  const r = spawnSync('bash', [GUION], { encoding: 'utf8', env, timeout: 300000 });
  return { codigo: r.status, salida: (r.stdout || '') + (r.stderr || '') };
}

/** Todo lo que hay en el destino en crudo, como bytes, para buscar el canario dentro. */
function bytesDelDestino(dirDestino) {
  const trozos = [];
  const andar = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      trozos.push(Buffer.from(e.name));
      if (e.isDirectory()) andar(p); else trozos.push(readFileSync(p));
    }
  };
  if (existsSync(dirDestino)) andar(dirDestino);
  return Buffer.concat(trozos);
}

try {
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] DESTINO CIFRADO — la copia lleva el entorno y los certificados');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const m1 = montarMundo('cifrado');
  writeFileSync(path.join(m1, 'certs/zz-negocio.p12'), 'certificado de mentira ' + CANARIO + '\n');
  rc('config', 'create', 'zzbase', 'local');
  rc('config', 'create', 'zzcif', 'crypt', 'remote=' + path.join(m1, 'destino'),
     'password=' + rc('obscure', 'clave-de-prueba-1').trim(),
     'password2=' + rc('obscure', 'sal-de-prueba-1').trim(),
     'filename_encryption=standard', 'directory_name_encryption=true');
  const destinos = path.join(m1, 'destinos.conf');
  writeFileSync(destinos, 'DESTINO_principal=zzcif:daily\n');

  const r1 = copiar(m1, { remote: 'zzcif:daily', destinos });
  ok(r1.codigo === 0, 'la copia con destino cifrado termina bien', 'código ' + r1.codigo);
  ok(/destino: .* — CIFRADO/.test(r1.salida), '  y se reconoce a sí misma como CIFRADA');
  ok(/entorno\+certificados: .*1 fichero/.test(r1.salida),
     'incluye el entorno Y el certificado que había en la carpeta');
  ok(/entorno-\d{4}-\d{2}-\d{2}\.tar\.gz .*restore OK|subiendo entorno-/.test(r1.salida),
     '  y lo sube, lo verifica y prueba el restore como cualquier otro artefacto');

  // Lo que de verdad demuestra que sirve para VOLVER: bajarlo y abrirlo.
  const vuelta = path.join(m1, 'vuelta'); mkdirSync(vuelta, { recursive: true });
  rc('copy', 'zzcif:daily', vuelta);
  const bajados = readdirSync(vuelta);
  const entorno = bajados.find(f => f.startsWith('entorno-'));
  ok(!!entorno, 'el paquete del entorno está en el destino y se puede bajar CON la llave', bajados.join(', '));
  if (entorno) {
    const lista = execFileSync('tar', ['-tzf', path.join(vuelta, entorno)], { encoding: 'utf8' });
    ok(/bamburu\.env/.test(lista), '  y dentro viene el fichero de entorno');
    ok(/certificados\/zz-negocio\.p12/.test(lista), '  y el certificado, en su carpeta');
    ok(/LEEME-PARA-VOLVER\.txt/.test(lista), '  y el recordatorio de cómo volver');
    const dentro = execFileSync('tar', ['-xzOf', path.join(vuelta, entorno), './bamburu.env'], { encoding: 'utf8' });
    ok(dentro.includes(CANARIO), '  y el contenido es el de verdad, no un fichero vacío');
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] Y EN CRUDO, EN EL DESTINO, NO SE LEE NADA');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const crudo = bytesDelDestino(path.join(m1, 'destino'));
  ok(crudo.length > 1000, 'hay bytes de verdad en el destino', crudo.length + ' bytes');
  ok(!crudo.includes(CANARIO), 'el secreto NO aparece en los bytes del destino', 'buscado literal');
  ok(!crudo.includes('bamburu.env'), 'ni el nombre del fichero de entorno');
  ok(!crudo.includes('entorno-'), 'ni el nombre del paquete: los NOMBRES también van cifrados');
  ok(!crudo.includes('SQLite format'), 'ni la cabecera de una base de datos SQLite');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] DESTINO EN CLARO — la copia sale igual, PERO SIN SECRETOS');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // Es el cerrojo que separa una copia de una filtración: el guion sabe volver a claro a propósito
  // para no quedarse sin copia, y en ese caso el entorno NO puede viajar.
  const m2 = montarMundo('claro');
  const r2 = copiar(m2, { remote: 'zzbase:' + path.join(m2, 'destino') });   // sin destinos.conf
  ok(r2.codigo === 0, 'con destino en claro la copia SIGUE saliendo', 'código ' + r2.codigo);
  ok(/EN CLARO/.test(r2.salida), '  y se reconoce a sí misma como EN CLARO');
  ok(/entorno\+certificados: NO se incluyen/.test(r2.salida),
     'el entorno y los certificados NO se incluyen — y lo DICE, no lo calla');
  const crudo2 = bytesDelDestino(path.join(m2, 'destino'));
  ok(!crudo2.includes(CANARIO), 'y el secreto NO está en el destino en claro', crudo2.length + ' bytes revisados');
  ok(crudo2.includes('SQLite format'), '  (los datos sí están: la copia no se ha quedado vacía)');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] CON LA LLAVE EQUIVOCADA NO SE PUEDE LEER');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rc('config', 'create', 'zzmala', 'crypt', 'remote=' + path.join(m1, 'destino'),
     'password=' + rc('obscure', 'ESTA-NO-ES-LA-LLAVE').trim(),
     'password2=' + rc('obscure', 'NI-ESTA-LA-SAL').trim(),
     'filename_encryption=standard', 'directory_name_encryption=true');
  let listaMala = '';
  try { listaMala = rc('lsf', 'zzmala:daily', '-R'); } catch (e) { listaMala = ''; }
  ok(!/entorno-|\.db|bamburu\.env/.test(listaMala),
     'con la llave equivocada no se lista ni un nombre de fichero', JSON.stringify(listaMala.slice(0, 40)));
  const malDir = path.join(m1, 'mala'); mkdirSync(malDir, { recursive: true });
  try { rc('copy', 'zzmala:daily', malDir); } catch { /* que falle está bien */ }
  const sacado = existsSync(malDir) ? readdirSync(malDir) : [];
  ok(sacado.length === 0, '  y no se saca ni un fichero', sacado.length ? sacado.join(', ') : 'ninguno');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] UN FALLO NO SE QUEDA CALLADO: AVISA');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const m3 = montarMundo('fallo');
  const marca = path.join(m3, 'aviso-recibido.txt');
  // El doble va en JavaScript A PROPÓSITO: el guion invoca al ayudante con `node`, y un doble
  // escrito en bash daría un rojo que no es del producto. (Pasó en la primera pasada de este gate.)
  const tg = path.join(m3, 'telegram-falso.mjs');
  writeFileSync(tg, 'import fs from "node:fs";let t="";process.stdin.setEncoding("utf8");'
    + 'for await (const c of process.stdin) t+=c;'
    + 'fs.writeFileSync(' + JSON.stringify(marca) + ', t);'
    + 'console.log("aviso enviado (doble de prueba)");\n');
  rc('config', 'create', 'zzcif3', 'crypt', 'remote=' + path.join(m3, 'destino'),
     'password=' + rc('obscure', 'clave-3').trim(), 'password2=' + rc('obscure', 'sal-3').trim(),
     'filename_encryption=standard', 'directory_name_encryption=true');
  const dst3 = path.join(m3, 'destinos.conf');
  writeFileSync(dst3, 'DESTINO_principal=zzcif3:daily\n');
  // El fallo provocado: el fichero de entorno no existe. Con destino cifrado eso es un FALLO,
  // porque una copia sin él no permite volver.
  const r3 = copiar(m3, { remote: 'zzcif3:daily', destinos: dst3, envFile: 'no-existe.env', telegramCli: tg });
  ok(r3.codigo !== 0, 'si no se puede leer el entorno, la copia FALLA en vez de darse por buena', 'código ' + r3.codigo);
  ok(/no permite volver/.test(r3.salida), '  y dice por qué', '');
  ok(existsSync(marca), 'y el aviso a Telegram SE LLAMA — no se queda en un registro que no lee nadie');
  if (existsSync(marca)) {
    const texto = readFileSync(marca, 'utf8');
    ok(/COPIA DE SEGURIDAD FALLIDA/.test(texto), '  con un titular que se entiende en el móvil');
    ok(/principal/.test(texto) && /Falló en/.test(texto), '  y con qué copia fue y en qué falló');
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[6] UNA SOLA PIEZA SIRVE LAS DOS COPIAS');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const units = readdirSync(path.join(RAIZ, 'deploy/systemd')).filter(f => /^bamburu-backup.*\.service$/.test(f));
  const cuales = units.map(u => [u, readFileSync(path.join(RAIZ, 'deploy/systemd', u), 'utf8')]);
  const conGuion = cuales.filter(([, t]) => /bamburu-backup\.sh/.test(t));
  ok(conGuion.length >= 2, 'las dos copias llaman AL MISMO guion', conGuion.map(([u]) => u).join(' · '));
  ok(cuales.every(([, t]) => !/bamburu-backup-secondary\.sh|backup2\.sh/.test(t)),
     '  y no existe una segunda copia del guion que pueda divergir');

} catch (e) {
  fail++;
  console.error('  ✗ EXCEPCIÓN: ' + (e?.stack || e?.message || e));
} finally {
  rmSync(BANCO, { recursive: true, force: true });
}

console.log('\n═════════ RESULTADO: ' + pass + ' ✓ · ' + fail + ' ✗ ═════════');
process.exit(fail ? 1 : 0);
