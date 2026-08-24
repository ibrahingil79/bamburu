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
import { tmpdir } from 'os';
import { join } from 'path';

const perfiles = new Set();
let enganchado = false;

function limpiar() {
  for (const d of perfiles) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
  perfiles.clear();
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
