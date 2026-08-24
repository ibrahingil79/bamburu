// scripts/lib/perfil-chromium.mjs
//
// UN PERFIL DE CHROMIUM POR ARRANQUE, Y QUE SE BORRE AUNQUE LA COMPROBACIÓN REVIENTE.
//
// Dos desastres distintos, y esta pieza es la única forma de evitar los dos a la vez.
//
// 1) EL DISCO. El 22 ago 2026 el disco se llenó al 100 % y el producto se cayó: cada comprobación de
//    navegador lanza Chromium, que se hace un perfil de ~130 MB, y nadie los borraba. Una tarde de
//    barridos dejó 3.074 carpetas y 30 GB. Con el disco a cero, una escritura a medias dejó un fichero
//    del servidor en 0 bytes y se sirvieron páginas vacías. Puppeteer SÍ borra el suyo, pero solo si el
//    navegador se cierra ordenadamente — y una comprobación que revienta a medias no lo cierra. Por eso
//    el perfil se declara: para saber cuál es el nuestro y poder borrarlo pase lo que pase.
//
// 2) EL CHOQUE. El 24 ago 2026, diez comprobaciones tenían un perfil FIJO y compartido. En el barrido,
//    la segunda que arrancaba moría con «The browser is already running» — mensaje engañoso: puppeteer
//    lo lanza en cuanto Chromium dice «Failed to create a ProcessSingleton», y no había ningún navegador
//    ajeno; el snap simplemente no podía poner su cerrojo ahí.
//
// Quitar la opción arregla (2) y REABRE (1), que es el que tira el servidor. Un directorio único por
// arranque, con su borrado enganchado a la salida y a las señales, arregla los dos.
//
// `scripts/lib/gate-env.mjs` hacía ya justo esto para los gates; aquí vive suelto para que las
// comprobaciones que no pasan por `launchOpts()` no tengan que copiarlo ni importar todo gate-env.

import { mkdtempSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join, basename } from 'path';

const perfiles = new Set();
let enganchado = false;

// ── Y AQUÍ ESTÁ LO QUE NADIE VIO EL 22 DE AGOSTO ────────────────────────────────────────────────
// Borrar `/tmp/gate-chrome-XXXX` NO libera el disco. El snap de Chromium está confinado y le remapea
// /tmp: lo que escribe acaba de verdad en `/tmp/snap-private-tmp/snap.chromium/tmp/gate-chrome-XXXX`.
// El directorio de fuera queda vacío, se borra sin protestar, y los ~130 MB de dentro se quedan ahí
// para siempre.
//
// Por eso el arreglo del 22 ago 2026 —que ya declaraba el perfil para poder borrarlo— NO SIRVIÓ: el
// 24 ago el disco volvió a llenarse al 100 %, con 1.485 carpetas y 29 GB en el tmp privado del snap.
// Se cayeron las capturas, luego el navegador entero, y el propio /tmp del sistema se quedó sin sitio.
// La vez anterior fue peor: una escritura a medias dejó un fichero del servidor en 0 bytes.
//
// Hay que borrar LAS DOS RUTAS. Si algún día Chromium deja de ser un snap, la segunda simplemente no
// existirá y el `force: true` no dirá nada.
const TMP_SNAP = '/tmp/snap-private-tmp/snap.chromium/tmp';

// Y BORRAR LA COPIA DEL SNAP NECESITA SUDO. `/tmp/snap-private-tmp` es 0700 DE ROOT: un `rmSync` desde
// aquí lanza EACCES, y como iba dentro de un try/catch mudo, la limpieza parecía funcionar y no hacía
// nada. Medido: tras una pasada, los `perfil-*` de ahí dentro pasaban de 3 a 4. Con `sudo -n` (sin
// contraseña) sí se borran. Si un día no hubiera sudo, esto no puede fallar en silencio: por eso
// existe `scripts/verify-disco-perfiles.mjs`, que se pone ROJO en el barrido cuando se acumulan.
function borrarDelSnap(nombre) {
  try { execFileSync('sudo', ['-n', 'rm', '-rf', join(TMP_SNAP, nombre)], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function limpiar() {
  for (const d of perfiles) {
    try { rmSync(d, { recursive: true, force: true }); } catch {}
    borrarDelSnap(basename(d));
  }
  perfiles.clear();
  limpiaRestosViejos();
}

// Y Chromium deja además LO SUYO: un `org.chromium.Chromium.XXXXXX` por arranque, unos 4 MB. Parece
// poco hasta que se multiplica por las 204 comprobaciones de un barrido: ~800 MB por pasada, que es
// como se llena un disco sin que nadie note nada.
//
// Solo se barren los CADUCADOS (más de media hora). En un barrido corren varias comprobaciones a la
// vez y el directorio de una que esté trabajando está recién tocado: borrarlo la tumbaría, y una
// comprobación que se cae por culpa de la limpieza de otra es exactamente el tipo de rojo falso que
// hace desconfiar de todo el barrido.
const MEDIA_HORA = 30 * 60 * 1000;

function limpiaRestosViejos() {
  const corte = Date.now() - MEDIA_HORA;
  let salida;
  // Listar también necesita sudo, por lo mismo. Sin él, no se barre nada y el vigilante lo cantará.
  try { salida = execFileSync('sudo', ['-n', 'ls', '-la', '--time-style=+%s', TMP_SNAP], { encoding: 'utf8' }); }
  catch { return; }
  for (const linea of salida.split('\n')) {
    const m = linea.match(/^d\S+\s+\d+\s+\S+\s+\S+\s+\d+\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    const [, seg, nombre] = m;
    if (!/^(org\.chromium\.Chromium\.|gate-chrome-|perfil-|puppeteer_dev_chrome_profile-)/.test(nombre)) continue;
    if (Number(seg) * 1000 > corte) continue;   // recién tocado: puede ser de otra comprobación viva
    borrarDelSnap(nombre);
  }
}

export function perfilDesechable(etiqueta = 'verify') {
  const dir = mkdtempSync(join(tmpdir(), 'perfil-' + etiqueta + '-'));
  perfiles.add(dir);
  if (!enganchado) {
    enganchado = true;
    process.on('exit', limpiar);
    for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      process.on(s, () => { limpiar(); process.exit(130); });
    }
  }
  return dir;
}
