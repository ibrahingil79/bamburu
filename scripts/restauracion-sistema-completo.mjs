#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// restauracion-sistema-completo.mjs — AUD-020: LEVANTAR BAMBURU ENTERO DESDE UNA COPIA.
//
// QUÉ AÑADE A LO QUE YA HABÍA, que es el motivo de la ficha. La copia diaria
// (`bamburu-backup.sh`) ya baja cada artefacto, lo compara BYTE A BYTE con el original y
// comprueba que abre. Y `ensayo-restauracion-cifrada.sh` demuestra que la llave custodiada por
// Ibrahin, ella sola, descifra el archivo. **Ninguna de las dos levanta el sistema.** Que un
// fichero abra no es que el negocio vuelva: el 3 sep, con los datos restaurados pero sin
// `/etc/bamburu.env`, Bamburu NO ARRANCÓ. Esa distancia —entre «tengo los datos» y «tengo el
// negocio»— es exactamente lo que mide este guion.
//
// EL CAMINO ENTERO, en orden, y el primer fallo para el reloj:
//   1. Descarga del BACKEND (un remote `crypt` ya configurado) el artefacto MÁS RECIENTE de cada
//      tipo: `control-<fecha>.db`, cada `<negocio>-<fecha>.db`, `uploads-<fecha>.tar.gz` y
//      `entorno-<fecha>.tar.gz`.
//   2. Comprueba cada pieza: `integrity_check` de cada base **y que no esté vacía** (una base
//      recién creada también responde `ok`: que abra no es que sirva), y `tar -tzf` de cada tar.
//   3. Monta el árbol AISLADO y arranca el `index.js` REAL contra él, con `BAMBURU_DATA_ROOT` y
//      `PORT` apuntando al aislado — ni toca `data/` de producción ni pelea por el puerto 3000.
//   4. Espera a que conteste `/admin/login` de un negocio DE VERDAD de la copia, con plazo.
//   5. Dice CUÁNTO HA TARDADO todo, medido de principio a fin.
//   6. Apaga y borra lo suyo. Siempre, pase lo que pase.
//
// EL CÓDIGO NO ES PARTE DE LA COPIA, y no debe serlo: vive en GitHub. Se enlaza el del repo, que
// es el mismo commit desplegado. Lo que la copia tiene que devolver son los DATOS y la
// CONFIGURACIÓN, que es lo que no está en ningún otro sitio.
//
// SI FALLA CUALQUIER PASO: se dice cuál y por qué, se sale en rojo, y se avisa por Telegram con la
// cabecera «BAMBURU — restauración», como el resto de avisos. `--sin-aviso` lo calla: lo usa el
// gate, que prueba ESTE guion contra una copia de mentira y no debe despertar a nadie.
//
//   node scripts/restauracion-sistema-completo.mjs --backend gdrive_cif:daily
//   node scripts/restauracion-sistema-completo.mjs --backend zzcif:daily --sin-aviso
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';

const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
const RCLONE = '/usr/bin/rclone';

// El plazo para que el servicio conteste. Generoso a propósito: arrancar carga los cuatro módulos
// y abre las migraciones perezosas. Si se pasa de aquí, no es lentitud: es que no levanta.
const PLAZO_ARRANQUE_MS = 90_000;

const args = process.argv.slice(2);
const valor = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const BACKEND = valor('--backend');
const SIN_AVISO = args.includes('--sin-aviso');
if (!BACKEND) {
  console.error('uso: node scripts/restauracion-sistema-completo.mjs --backend <remote-crypt:subdir> [--sin-aviso]');
  process.exit(2);
}

const t0 = Date.now();
const transcurrido = () => ((Date.now() - t0) / 1000).toFixed(1);
const paso = (m) => console.log('· ' + m);

let TRABAJO = null;
let servidor = null;

/** Un puerto libre de verdad, preguntado al sistema — no un número inventado que igual está cogido. */
function puertoLibre() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}

/** Falla en ROJO diciendo QUÉ pieza falta. Avisa por Telegram salvo que se le calle. */
async function morir(queFalta, detalle) {
  const seg = transcurrido();
  console.error('\n✗ LA RESTAURACIÓN NO SE PUEDE COMPLETAR');
  console.error('  Falta o falla: ' + queFalta);
  if (detalle) console.error('  Detalle: ' + String(detalle).slice(0, 800));
  console.error('  Parado a los ' + seg + ' s.');

  if (!SIN_AVISO) {
    try {
      const { mandarTelegram } = await import(path.join(RAIZ, 'core/telegram-servidor.js'));
      const r = await mandarTelegram({
        tema: 'restauración',
        texto: '🛑 <b>La copia NO permite levantar el sistema</b>\n'
          + 'Origen: <code>' + BACKEND + '</code>\n'
          + 'Falta o falla: <code>' + String(queFalta).replace(/[<>&]/g, ' ').slice(0, 200) + '</code>\n'
          + (detalle ? 'Detalle: <code>' + String(detalle).replace(/[<>&]/g, ' ').slice(0, 300) + '</code>\n' : '')
          + '\nTener los datos no es tener el negocio. Revísalo.',
      });
      console.error('  Aviso a Telegram: ' + (r.ok ? 'enviado' : 'NO enviado — ' + r.motivo));
    } catch (e) {
      console.error('  Aviso a Telegram: NO enviado — ' + (e?.message || e));
    }
  }
  limpiar();
  process.exit(1);
}

function limpiar() {
  try { if (servidor && !servidor.killed) process.kill(-servidor.pid, 'SIGKILL'); } catch { /* ya estaba muerto */ }
  try { if (TRABAJO) rmSync(TRABAJO, { recursive: true, force: true }); } catch { /* nada que borrar */ }
}
process.on('exit', limpiar);

try {
  console.log('RESTAURACIÓN COMPLETA — origen: ' + BACKEND + '\n');

  // ── 1 · QUÉ HAY EN LA COPIA ────────────────────────────────────────────────────────────────────
  paso('listando la copia…');
  let lista = '';
  try {
    lista = execFileSync(RCLONE, ['lsf', BACKEND + '/'], { encoding: 'utf8', timeout: 120_000 });
  } catch (e) {
    await morir('no se puede leer la copia en ' + BACKEND, e?.stderr || e?.message);
  }
  const ficheros = lista.split('\n').map(s => s.trim()).filter(Boolean).filter(f => !f.endsWith('/'));
  if (!ficheros.length) await morir('la copia está vacía', BACKEND + ' no devuelve ni un fichero');

  // La fecha MÁS RECIENTE que aparezca, no «el primero que salga»: dentro de la ventana de
  // retención conviven varios días y restaurar mezclando fechas sería restaurar cualquier cosa.
  const fechas = [...new Set(ficheros.map(f => (f.match(/-(\d{4}-\d{2}-\d{2})\.(db|tar\.gz)$/) || [])[1]).filter(Boolean))].sort();
  if (!fechas.length) await morir('ningún fichero de la copia lleva fecha reconocible', ficheros.slice(0, 5).join(', '));
  const FECHA = fechas[fechas.length - 1];
  const delDia = ficheros.filter(f => f.includes('-' + FECHA + '.'));
  paso('copia del ' + FECHA + ' — ' + delDia.length + ' artefacto(s)');

  const nombreControl = delDia.find(f => f === 'control-' + FECHA + '.db');
  const nombreEntorno = delDia.find(f => f === 'entorno-' + FECHA + '.tar.gz');
  const nombreUploads = delDia.find(f => f === 'uploads-' + FECHA + '.tar.gz');
  const negocios = delDia.filter(f => f.endsWith('-' + FECHA + '.db') && f !== nombreControl);

  if (!nombreControl) await morir('control.db — sin él no se sabe qué negocios existen ni dónde viven', 'no está en la copia del ' + FECHA);
  if (!nombreEntorno) await morir('el entorno (entorno-' + FECHA + '.tar.gz) — sin él el ERP no carga y Bamburu no arranca', 'no está en la copia del ' + FECHA);
  if (!negocios.length) await morir('no hay ni una base de negocio en la copia', 'solo ' + delDia.join(', '));

  // ── 2 · BAJARLO Y COMPROBAR PIEZA A PIEZA ──────────────────────────────────────────────────────
  TRABAJO = mkdtempSync(path.join(tmpdir(), 'restauracion-'));
  execFileSync('chmod', ['700', TRABAJO]);
  const DATOS = path.join(TRABAJO, 'data');
  mkdirSync(path.join(DATOS, 'tenants'), { recursive: true });
  mkdirSync(path.join(DATOS, 'uploads'), { recursive: true });

  paso('descargando ' + (negocios.length + 2 + (nombreUploads ? 1 : 0)) + ' artefacto(s)…');
  const bajar = (nombre, destino) => {
    try {
      execFileSync(RCLONE, ['copyto', BACKEND + '/' + nombre, destino], { encoding: 'utf8', timeout: 600_000 });
    } catch (e) { return e?.stderr || e?.message || 'fallo al descargar'; }
    return existsSync(destino) ? null : 'el fichero no llegó';
  };

  /** Que abra NO basta: una base vacía también responde `ok`. Se exige esquema dentro. */
  const baseSana = (ruta) => {
    let ic = '';
    try { ic = execFileSync('sqlite3', [ruta, 'PRAGMA integrity_check;'], { encoding: 'utf8' }).trim(); }
    catch (e) { return 'no se puede abrir (' + (e?.stderr || e?.message || '').slice(0, 120) + ')'; }
    if (ic !== 'ok') return 'integrity_check => ' + ic;
    let objetos = '0';
    try { objetos = execFileSync('sqlite3', [ruta, 'SELECT count(*) FROM sqlite_master;'], { encoding: 'utf8' }).trim(); }
    catch (e) { return 'no se puede contar el esquema (' + (e?.message || '').slice(0, 80) + ')'; }
    if (!Number(objetos)) return 'abre pero está VACÍA (0 objetos): eso no es una copia útil';
    return null;
  };

  const rutaControl = path.join(DATOS, 'control.db');
  let err = bajar(nombreControl, rutaControl);
  if (err) await morir('control.db no se pudo descargar', err);
  err = baseSana(rutaControl);
  if (err) await morir('control.db no sirve', err);

  let negociosOk = 0;
  const negociosMal = [];
  for (const n of negocios) {
    const slug = n.replace('-' + FECHA + '.db', '');
    const destino = path.join(DATOS, 'tenants', slug + '.db');
    const e1 = bajar(n, destino) || baseSana(destino);
    if (e1) { negociosMal.push(slug + ': ' + e1); continue; }
    negociosOk++;
  }
  if (!negociosOk) await morir('ninguna base de negocio se pudo restaurar', negociosMal.join(' · ').slice(0, 400));
  paso(negociosOk + ' negocio(s) restaurados y verificados' + (negociosMal.length ? ' · ' + negociosMal.length + ' con problemas' : ''));

  // El entorno: la pieza que distingue «tengo los datos» de «puedo levantar el negocio».
  const tarEntorno = path.join(TRABAJO, nombreEntorno);
  err = bajar(nombreEntorno, tarEntorno);
  if (err) await morir('el entorno no se pudo descargar', err);
  const dirEntorno = path.join(TRABAJO, 'entorno');
  mkdirSync(dirEntorno, { recursive: true });
  try { execFileSync('tar', ['-xzf', tarEntorno, '-C', dirEntorno]); }
  catch (e) { await morir('el entorno no se puede abrir (tar corrupto)', e?.stderr || e?.message); }
  const rutaEnv = path.join(dirEntorno, 'bamburu.env');
  if (!existsSync(rutaEnv)) await morir('el paquete de entorno no trae bamburu.env', 'contenido: ' + readdirSync(dirEntorno).join(', '));
  const certs = existsSync(path.join(dirEntorno, 'certificados')) ? readdirSync(path.join(dirEntorno, 'certificados')).length : 0;
  paso('entorno restaurado (bamburu.env + ' + certs + ' certificado(s))');

  if (nombreUploads) {
    const tarUp = path.join(TRABAJO, nombreUploads);
    const e2 = bajar(nombreUploads, tarUp);
    if (e2) await morir('los uploads no se pudieron descargar', e2);
    try { execFileSync('tar', ['-xzf', tarUp, '-C', DATOS]); }
    catch (e) { await morir('los uploads no se pueden abrir (tar corrupto)', e?.stderr || e?.message); }
    paso('uploads restaurados');
  }

  // ── 3 · EL ÁRBOL AISLADO ───────────────────────────────────────────────────────────────────────
  // El código se enlaza del repo: no está en la copia y no debe estarlo (vive en GitHub).
  for (const dir of ['modules', 'node_modules']) {
    try { symlinkSync(path.join(RAIZ, dir), path.join(TRABAJO, dir)); }
    catch (e) { await morir('no se pudo enlazar el código (' + dir + ')', e?.message); }
  }

  // ── 4 · ARRANCAR Y ESPERAR A QUE CONTESTE ──────────────────────────────────────────────────────
  const puerto = await puertoLibre();
  paso('arrancando Bamburu con lo restaurado, en el puerto ' + puerto + '…');

  // El entorno restaurado se carga como entorno del proceso — es el de la COPIA, no el del
  // servidor: si la copia no lo trajera completo, el arranque lo dirá aquí y no en producción.
  const envCopia = {};
  for (const linea of readFileSync(rutaEnv, 'utf8').split('\n')) {
    const l = linea.trim();
    if (!l || l.startsWith('#')) continue;
    const i = l.indexOf('=');
    if (i > 0) envCopia[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  }

  const log = path.join(TRABAJO, 'arranque.log');
  writeFileSync(log, '');
  const salida = (await import('node:fs')).openSync(log, 'a');
  servidor = spawn(process.execPath, [path.join(RAIZ, 'index.js')], {
    cwd: TRABAJO,
    env: { ...process.env, ...envCopia, PORT: String(puerto), BAMBURU_DATA_ROOT: TRABAJO },
    stdio: ['ignore', salida, salida],
    detached: true,   // grupo propio: al matarlo se va él y todo lo que haya abierto
  });

  const leerLog = () => { try { return readFileSync(log, 'utf8'); } catch { return ''; } };
  const dormir = (ms) => new Promise(r => setTimeout(r, ms));

  // ⚠️ SE PIDE CON `curl` Y NO CON `fetch`, y no es capricho: el `fetch` de Node IGNORA la
  // cabecera `Host` (es un encabezado prohibido en la norma), así que la petición sale con
  // `Host: 127.0.0.1:<puerto>` y NO resuelve ningún negocio — devuelve 404 y la prueba acusaría
  // a la copia de un fallo que es del instrumento. Aquí el `Host` es justo lo que se está
  // probando: es como Bamburu sabe de qué negocio le hablan.
  const pedir = (host, ruta = '/admin/login') => {
    try {
      return execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '10',
        '-H', 'Host: ' + host, 'http://127.0.0.1:' + puerto + ruta], { encoding: 'utf8' }).trim();
    } catch { return '000'; }
  };

  // Se espera a que CONTESTE, no a que "parezca arrancado". Y si el proceso se muere por el
  // camino se corta ya: esperar 90 s a algo que ya no existe es perder el tiempo y mentir.
  let vivo = false, muerto = false;
  const limite = Date.now() + PLAZO_ARRANQUE_MS;
  while (Date.now() < limite) {
    if (servidor.exitCode !== null) { muerto = true; break; }
    if (pedir('no-existe.bamburu.com') !== '000') { vivo = true; break; }
    await dormir(500);
  }

  if (muerto || !vivo) {
    const texto = leerLog();
    const motivo = (texto.match(/^.*(?:MÓDULO ESENCIAL CAÍDO|Motivo:|Error:).*$/m) || [''])[0].trim();
    await morir(
      muerto ? 'Bamburu NO ARRANCA con lo que trae la copia' : 'Bamburu arrancó pero no contestó en ' + (PLAZO_ARRANQUE_MS / 1000) + ' s',
      motivo || texto.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 400));
  }

  // Y ahora contra un negocio DE VERDAD de la copia: que el servicio conteste no basta si el
  // negocio restaurado no se puede ni abrir.
  let slugPrueba = null;
  try {
    slugPrueba = execFileSync('sqlite3', [rutaControl,
      "SELECT slug FROM tenants WHERE slug IS NOT NULL AND slug <> '' ORDER BY id LIMIT 1;"], { encoding: 'utf8' }).trim();
  } catch { /* se queda en null y se dice abajo */ }
  if (!slugPrueba) await morir('control.db no lista ni un negocio', 'no se puede comprobar ninguna pantalla real');

  // El negocio se alcanza por SUBDOMINIO: `<slug>.<PUBLIC_BASE_DOMAIN>`. El dominio base sale del
  // entorno RESTAURADO, no del de este servidor — si la copia no lo trajera, esto también se vería.
  const base = envCopia.PUBLIC_BASE_DOMAIN || 'bamburu.com';
  const dominio = slugPrueba + '.' + base;

  const respuesta = pedir(dominio);
  if (respuesta !== '200') {
    await morir('la pantalla de entrada de «' + slugPrueba + '» responde ' + respuesta + ', no 200',
      leerLog().split('\n').filter(Boolean).slice(-4).join(' | ').slice(0, 400));
  }

  // ── 5 · EL TIEMPO, MEDIDO ──────────────────────────────────────────────────────────────────────
  const segundos = transcurrido();
  console.log('\n✅ EL SISTEMA ENTERO SE LEVANTA DESDE LA COPIA');
  console.log('   origen ............. ' + BACKEND + ' (copia del ' + FECHA + ')');
  console.log('   negocios ........... ' + negociosOk + ' restaurados y abiertos'
    + (negociosMal.length ? ' · ' + negociosMal.length + ' con problemas: ' + negociosMal.join(' · ').slice(0, 200) : ''));
  console.log('   entorno ............ bamburu.env + ' + certs + ' certificado(s)');
  console.log('   pantalla probada ... /admin/login de «' + slugPrueba + '» → HTTP 200');
  console.log('   TIEMPO TOTAL ....... ' + segundos + ' s  (medido, de principio a fin)');
  console.log('\nRESULTADO: 1 ✓  ·  0 ✗');
  limpiar();
  process.exit(0);

} catch (e) {
  await morir('la prueba reventó por un error inesperado', e?.stack || e?.message || e);
}
