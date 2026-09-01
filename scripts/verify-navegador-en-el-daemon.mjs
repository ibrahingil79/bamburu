#!/usr/bin/env node
// verify-navegador-en-el-daemon.mjs — que el barrido del daemon MIDA LO MISMO que el de mano.
//
// POR QUÉ EXISTE (1 sep 2026). El barrido que el orquestador pasa en sus ratos muertos daba
// **28 rojos falsos por pasada**, todos gates de navegador, muertos en ~1 s. Medido:
//
//   node scripts/gate-xss-escape.mjs                     →  29 OK, 0 fallos
//   el mismo, dentro del aislamiento del daemon          →  snap-confine is packaged without
//                                                           necessary permissions, cannot continue
//
// `/snap/bin/chromium` no es el navegador: es el ENVOLTORIO (un enlace a `/usr/bin/snap`), y
// `snap-confine` necesita setuid para montar su confinamiento. `NoNewPrivileges=true` —que lleva
// `orquestador.service`, y hace bien— se lo prohíbe. A mano no se nota, porque una sesión de
// terminal no lleva ese cerrojo. **Dos entornos, dos verdades, y el barrido automático mintiendo.**
//
// La cura no fue aflojar el cerrojo: fue usar el ELF de DENTRO del snap, que arranca directo sin
// pasar por `snap-confine`. La receta estaba MEDIDA Y ESCRITA en `gate-env.mjs` desde esa misma
// mañana — y sin conectar, con el valor por defecto apuntando al envoltorio. Esto vigila que no
// vuelva a desconectarse: es barato, no abre navegador y no toca el producto.
import { existsSync } from 'fs';
import { CHROMIUM, entornoDelNavegador, launchOpts } from './lib/gate-env.mjs';

let ok = 0; const fallos = [];
const comprobar = (que, cond, detalle = '') => {
  if (cond) { ok++; console.log('  ✓ ' + que); }
  else { fallos.push(que); console.log('  ✗ FALLO: ' + que + (detalle ? ' — ' + detalle : '')); }
};

console.log('\n[1] El navegador que se va a usar');
comprobar('el ejecutable existe', existsSync(CHROMIUM), CHROMIUM);
comprobar('NO es el envoltorio /snap/bin/chromium, que muere bajo NoNewPrivileges',
  CHROMIUM !== '/snap/bin/chromium', CHROMIUM);

console.log('\n[2] El entorno que necesita para arrancar sin snap-confine');
const env = entornoDelNavegador();
if (CHROMIUM.startsWith('/snap/chromium/')) {
  comprobar('se prepara entorno para el binario de dentro del snap', !!env);
  for (const v of ['HOME', 'LD_LIBRARY_PATH', 'SNAP', 'SNAP_USER_COMMON', 'SNAP_USER_DATA']) {
    comprobar('lleva ' + v, !!env?.[v]);
  }
  // El HOME de mentira NO puede caer en el HOME de verdad: el daemon lo tiene en solo lectura.
  comprobar('su HOME es escribible por el daemon (no cuelga del HOME real)',
    !!env?.HOME && !env.HOME.startsWith(process.env.HOME || '/home/ubuntu'), env?.HOME);
  comprobar('las carpetas del HOME de mentira existen ya',
    existsSync(env?.SNAP_USER_COMMON || '') && existsSync(env?.SNAP_USER_DATA || ''));
} else {
  comprobar('sin el snap de Chromium no se inventa entorno', env === undefined);
}

console.log('\n[3] Lo que reciben los 99 gates que abren navegador');
const o = launchOpts();
comprobar('launchOpts entrega ese mismo ejecutable', o.executablePath === CHROMIUM);
comprobar('y le pasa el entorno SOLO al navegador', CHROMIUM.startsWith('/snap/chromium/') ? !!o.env : o.env === undefined);
comprobar('con perfil desechable, que es lo que impide llenar el disco', !!o.userDataDir);

console.log('\n' + '─'.repeat(70));
console.log(`=== RESULTADO: ${ok} OK / ${fallos.length} FALLOS ===`);
process.exit(fallos.length ? 1 : 0);
