#!/usr/bin/env node
// verify-comprobaciones-sin-correo-real.mjs — NINGUNA COMPROBACIÓN ESCRIBE A UNA BANDEJA REAL.
//
// LA NORMA (25 ago 2026, Ibrahin): «Ninguna comprobación automática vuelve a enviar correo a una
// bandeja real desde el dominio de Bamburu. Todas pasan a las direcciones de simulación de Resend.»
//
// POR QUÉ HACE FALTA VIGILARLO. El 24 de agosto llegaron 45 correos a la bandeja del dueño y **39 los
// mandaron dos comprobaciones**. Ninguna lo hacía a propósito: `gate-c6-find-tenant` cogía «el primer
// admin del primer negocio activo» —que en esta máquina es él— y `gate-inicio-arranque` pedía una
// migración de verdad, cuyo aviso va al buzón del equipo, que por defecto es también él. Se arregló;
// esto es para que no vuelva. Ver docs/censo-correos.md.
//
// QUÉ MIRA. Las direcciones escritas a mano en los ficheros de comprobación QUE ESTÁN EN EL BARRIDO.
// Una dirección vale si es de simulación (`@resend.dev`) o si es de un dominio que no puede existir
// (`.test`, `.local`, `.invalid`, `.example`, `ejemplo.com`) — esas las desvía la puerta del correo.
// Cualquier otra es una bandeja de verdad y no pinta nada aquí.

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { esImposible } from '../core/correo-freno.js';
import { GRUPOS } from './lib/gates-mapa.mjs';

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ✓ ' + m + (d ? ' — ' + d : '')); } else { fail++; console.error('  ✗ FALLO: ' + m + (d ? ' — ' + d : '')); } };

const RE_CORREO = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Vale: simulación, o dominio imposible (la puerta lo desvía), o un marcador de plantilla.
function permitida(d) {
  const b = d.toLowerCase();
  if (b.endsWith('@resend.dev') || b.includes('@resend.dev')) return true;
  if (esImposible(b)) return true;
  if (b.includes('@dominio') || b.includes('@correo.') || b.endsWith('@x.com') || b.endsWith('@a.b')) return true;
  return false;
}

// Direcciones que NO son destinatarios: el remitente del producto y el buzón que una comprobación
// vigila precisamente para exigir que NO se use.
const NO_SON_DESTINO = new Set(['noreply@bamburu.com', 'hola@bamburu.com', 'admin@bamburu.com']);

function culpables(texto) {
  const malas = new Set();
  for (const linea of texto.split('\n')) {
    const limpia = linea.replace(/^\s*\/\/.*$/, '');            // un comentario no envía nada
    for (const d of limpia.match(RE_CORREO) || []) {
      const b = d.toLowerCase();
      if (permitida(b) || NO_SON_DESTINO.has(b)) continue;
      malas.add(b);
    }
  }
  return [...malas];
}

// LAS DOS QUE LLEVAN DIRECCIONES REALES A PROPÓSITO, Y POR QUÉ.
// No es una lista de perdonados: son las dos comprobaciones que prueban ESTE mismo mecanismo, y para
// eso necesitan una dirección real que enseñarle al clasificador — su aserción dice, precisamente, que
// NO se permite. Si se les quitara, dejarían de comprobar nada. Se nombran una a una, con su motivo, y
// más abajo se exige que sigan existiendo: una excepción que apunta a un fichero borrado es una puerta
// abierta que nadie ve.
const A_PROPOSITO = new Map([
  ['verify-comprobaciones-sin-correo-real', 'es esta misma: su control positivo mete una dirección real para exigir que la cace'],
  ['verify-correo-freno', 'prueba que el desvío NO toca las direcciones reales, así que tiene que nombrar algunas'],
]);

console.log('\n[1] Las comprobaciones del barrido no llevan direcciones reales');
const enBarrido = new Set(Object.values(GRUPOS).flat());
const sucias = [];
for (const f of readdirSync('scripts').filter(x => x.endsWith('.mjs'))) {
  const nombre = f.replace('.mjs', '');
  if (!enBarrido.has(nombre)) continue;
  if (A_PROPOSITO.has(nombre)) continue;
  const malas = culpables(readFileSync(join('scripts', f), 'utf8'));
  if (malas.length) sucias.push(nombre + ' → ' + malas.join(', '));
}
ok(sucias.length === 0, 'ninguna de las ' + enBarrido.size + ' comprobaciones del barrido escribe a una bandeja real',
   sucias.length ? sucias.slice(0, 6).join(' | ') : 'ninguna');

// Y las excepciones no pueden pudrirse: si una apunta a un fichero que ya no está, es una puerta
// abierta que nadie vigila.
for (const [n, motivo] of A_PROPOSITO) {
  ok(existsSync(join('scripts', n + '.mjs')), 'la excepción «' + n + '» sigue apuntando a algo que existe', motivo);
}

console.log('\n[2] Y sabe cazarlo (control positivo)');
// Un lint que puede dar cero necesita un caso que SÍ debe cazar: si no, no se distingue
// «está todo limpio» de «no estoy mirando nada».
const trampa = "const DESTINO = 'ibrahingil@gmail.com';\nawait mandar(DESTINO);";
ok(culpables(trampa).includes('ibrahingil@gmail.com'),
   'con una dirección real metida a mano, la señala', JSON.stringify(culpables(trampa)));
ok(culpables("// antes esto iba a ibrahingil@gmail.com y por eso se cambió").length === 0,
   'y NO se queja de una dirección que solo aparece en un comentario');
ok(culpables("const t = 'delivered+gate@resend.dev';").length === 0, 'ni de una de simulación');
ok(culpables("const c = 'ana@t.local';").length === 0, 'ni de una imposible (la puerta la desvía)');

console.log('\n' + '─'.repeat(70));
console.log('=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail === 0 ? 0 : 1);
