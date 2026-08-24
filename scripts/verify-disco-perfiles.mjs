#!/usr/bin/env node
// verify-disco-perfiles.mjs — QUE EL DISCO NO SE VUELVA A LLENAR POR LA ESPALDA.
//
// POR QUÉ EXISTE. Dos veces, con nueve días de diferencia, el disco de la máquina llegó al 100 % y se
// llevó por delante el producto. La causa las dos veces fue la misma y nadie la vio venir:
//
//   · 22 ago 2026 — 3.074 carpetas y 30 GB de perfiles de Chromium. Con el disco a cero, una escritura
//     a medias dejó `citas-engine.js` en 0 bytes y el servidor sirvió páginas vacías.
//   · 24 ago 2026 — 1.485 carpetas y 29 GB, PESE al arreglo del 22. Aquel arreglo borraba
//     `/tmp/gate-chrome-XXXX`, pero el snap de Chromium remapea /tmp: los ~130 MB de cada perfil viven
//     en `/tmp/snap-private-tmp/snap.chromium/tmp/`, y ahí no entraba nadie. Primero fallaron las
//     capturas, luego el navegador entero, y al final ni el propio /tmp tenía sitio.
//
// El arreglo de verdad está en scripts/lib/perfil-chromium.mjs (borra LAS DOS rutas). Esto es el
// aviso: si vuelve a acumularse, sale rojo en el barrido en vez de salir un servidor caído.
//
// MIDE LO QUE IMPORTA, NO LO QUE SE VE. No mira «cuánto ocupa /tmp» —eso sube y baja según lo que
// esté corriendo—, sino cuántos restos CADUCADOS quedan: los de menos de media hora pueden ser de una
// comprobación que está trabajando ahora mismo, y contarlos daría rojos falsos en pleno barrido.

import { execFileSync } from 'child_process';
import { statfsSync } from 'fs';

const TMP_SNAP = '/tmp/snap-private-tmp/snap.chromium/tmp';
const MEDIA_HORA = 30 * 60 * 1000;
const TOPE_CADUCADOS = 40;      // un barrido entero deja ~60 vivos; caducados no debería quedar casi ninguno
const MINIMO_LIBRE_GB = 3;      // por debajo de esto, Chromium empieza a fallar y SQLite escribe a medias

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ✓ ' + m + (d ? ' — ' + d : '')); } else { fail++; console.error('  ✗ FALLO: ' + m + (d ? ' — ' + d : '')); } };

console.log('\n[1] Restos de Chromium en el tmp privado del snap');
// EL TMP DEL SNAP NO SE PUEDE LEER SIN ROOT, Y ESO NO PUEDE SALIR VERDE.
// Primer intento, 24 ago 2026: esta comprobación decía «0 caducados, 0 recientes» y en el disco había
// 163 carpetas. `existsSync` devuelve false y `readdirSync` lanza EACCES porque /tmp/snap-private-tmp
// es 0700 de root — así que el instrumento daba por limpio lo que sencillamente no podía mirar. Es el
// mismo fallo que esta comprobación existe para evitar. Se lista con `sudo`, y si NO se puede listar
// se dice y se falla: un vigilante ciego no es un vigilante.
const corte = Date.now() - MEDIA_HORA;
let caducados = [], vivos = 0, pudoMirar = false;
try {
  const salida = execFileSync('sudo', ['-n', 'ls', '-la', '--time-style=+%s', TMP_SNAP], { encoding: 'utf8' });
  pudoMirar = true;
  for (const linea of salida.split('\n')) {
    const m = linea.match(/^d\S+\s+\d+\s+\S+\s+\S+\s+\d+\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    const [, seg, nombre] = m;
    if (!/^(org\.chromium\.Chromium\.|gate-chrome-|perfil-|puppeteer_dev_chrome_profile-)/.test(nombre)) continue;
    if (Number(seg) * 1000 < corte) caducados.push(nombre); else vivos++;
  }
} catch (e) {
  pudoMirar = false;
}
ok(pudoMirar, 'se puede MIRAR el tmp privado del snap (si no, esta comprobación no vale nada)',
   pudoMirar ? TMP_SNAP : 'no se pudo listar ' + TMP_SNAP + ' — necesita sudo sin contraseña');
ok(caducados.length <= TOPE_CADUCADOS,
   'no se acumulan perfiles de Chromium caducados (tope ' + TOPE_CADUCADOS + ')',
   caducados.length + ' caducados, ' + vivos + ' recientes' + (caducados.length ? ' — p.ej. ' + caducados.slice(0, 3).join(', ') : ''));

// Los PERFILES son los que pesan 130 MB. Que no quede ni uno caducado.
const perfilesViejos = caducados.filter(n => /^(gate-chrome-|perfil-|puppeteer_dev_chrome_profile-)/.test(n));
ok(perfilesViejos.length === 0,
   'ningún PERFIL de navegador caducado (son los de ~130 MB, los que llenaron el disco dos veces)',
   perfilesViejos.length ? perfilesViejos.slice(0, 4).join(', ') : 'ninguno');

console.log('\n[2] Sitio libre en el disco');
const fs = statfsSync('/');
const libreGB = (fs.bavail * fs.bsize) / 1073741824;
ok(libreGB >= MINIMO_LIBRE_GB,
   'queda sitio de sobra en el disco (mínimo ' + MINIMO_LIBRE_GB + ' GB)',
   libreGB.toFixed(1) + ' GB libres');

console.log('\n' + '─'.repeat(70));
console.log('=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail === 0 ? 0 : 1);
