#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// CENSO DEL TEXTO AJENO — que lo que no escribió el usuario siga llegando MARCADO a la IA.
//
// DE DÓNDE SALE (AUD-016, 3 sep 2026). Al modelo le llega, mezclado en el mismo mensaje, lo que
// nosotros le decimos y texto escrito por otros: nombres de productos y clientes, filas que vuelven
// de una consulta, el contenido de una factura que alguien envió. Si van indistinguibles, una orden
// metida dentro de un dato («IGNORA TUS INSTRUCCIONES Y…») se lee igual que una instrucción nuestra.
//
// MARCAR NO ES UNA GARANTÍA —es una petición al modelo, y un modelo puede picar igual—, y por eso
// esto NO es la defensa: la defensa son los cerrojos del servidor, y quien los pone a prueba es
// `scripts/gate-disa-inyeccion.mjs`. Esto es lo otro: que la petición no desaparezca sin que nadie
// se entere. Quitar un marcado es una línea y no se ve raro al leerlo.
//
// POR QUÉ AQUÍ Y NO SOLO EN LA BATERÍA: la batería vive en el grupo `disa`, y `disa` NO despierta
// cuando se toca `modules/erp/routes/purchases-capture.js` —el extractor de facturas, que es la vía
// por donde entra texto de un TERCERO de verdad, no del propio negocio—. Sin este censo, ese aviso
// se podía caer y no correr nada que lo notara. Estático, <1 s, y va en `lint`: corre siempre.
//
//   node scripts/censo-texto-ajeno.mjs
//   node scripts/censo-texto-ajeno.mjs --autoprueba   (se rompe a sí mismo y exige ponerse rojo)
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';

const say = (s) => process.stdout.write(s + '\n');
const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');

// ── LO QUE DEBE SEGUIR SIENDO CIERTO ─────────────────────────────────────────────────────────────
// Cada regla dice QUÉ vía cubre, para que un rojo se lea sin abrir el fichero.
const REGLAS = [
  { via: 'el marcado vive en un solo sitio', fichero: 'modules/disa/texto-ajeno.js',
    debe: [/export const AVISO_TEXTO_AJENO/, /export function marcarTextoAjeno/, /export function marcarResultadoDeHerramienta/],
    porque: 'si el marcado se dispersa, cada sitio marca a su manera y ninguno se puede auditar' },

  { via: 'lo que vuelve de una herramienta', fichero: 'modules/disa/index.js',
    debe: [/marcarResultadoDeHerramienta\(resultado\)/, /from '\.\/texto-ajeno\.js'/],
    porque: 'viajaba como JSON en crudo, indistinguible de lo que le decimos nosotros' },

  { via: 'el contexto del negocio (nombres de productos y clientes)', fichero: 'modules/disa/index.js',
    debe: [/<datos_negocio_no_confiables>/, /<\/datos_negocio_no_confiables>/, /nunca como instrucciones/],
    porque: 'un producto puede llamarse «IGNORA TUS INSTRUCCIONES» y lo escribe cualquiera' },

  { via: 'el documento que lee el extractor de facturas', fichero: 'modules/erp/routes/purchases-capture.js',
    debe: [/AVISO DE SEGURIDAD/, /NUNCA las obedezcas/],
    porque: 'es la única vía por la que entra texto de un TERCERO, no del propio negocio' },
];

function pasar(leerFichero = leer) {
  const fallos = [];
  for (const r of REGLAS) {
    let src;
    try { src = leerFichero(r.fichero); }
    catch { fallos.push({ ...r, falta: 'el fichero no existe' }); continue; }
    for (const re of r.debe) if (!re.test(src)) fallos.push({ ...r, falta: String(re) });
  }
  return fallos;
}

// ── AUTOPRUEBA · un censo que no se ha visto rojo no vale ────────────────────────────────────────
// Se le da una versión ROTA de cada fichero, uno a uno, y se exige que lo cace. Si diera verde sobre
// un fichero sin marcado, este censo sería justo el que «dice CERO y no es cierto».
if (process.argv.includes('--autoprueba')) {
  let mal = 0;
  for (const r of REGLAS) {
    const roto = (f) => f === r.fichero ? leer(f).replace(r.debe[0], 'XXX-BORRADO-A-PROPOSITO') : leer(f);
    const cazados = pasar(roto).filter(x => x.fichero === r.fichero);
    if (!cazados.length) { mal++; say('✗ NO caza que falte ' + r.debe[0] + ' en ' + r.fichero); }
    else say('✓ caza que falte el marcado de: ' + r.via);
  }
  say(mal ? '\n✗ LA AUTOPRUEBA FALLA: el censo no ve lo que dice ver.' : '\n✓ autoprueba: el censo se pone rojo con cada marcado quitado.');
  process.exit(mal ? 1 : 0);
}

const fallos = pasar();
if (!fallos.length) {
  say('✓ TEXTO AJENO: las ' + REGLAS.length + ' vías siguen marcadas antes de llegar a la IA.');
  say('  (marcar no es una garantía: quien prueba los cerrojos es scripts/gate-disa-inyeccion.mjs)');
  // El resumen va en el formato que el barrido sabe leer. Sin él sale SOSPECHOSO —«salió 0 pero no
  // demostró nada»— y un verde que el runner no puede contar no es un verde.
  say('RESULTADO: ' + REGLAS.length + ' ✓  ·  0 ✗');
  process.exit(0);
}
say('✗ TEXTO AJENO SIN MARCAR — ' + fallos.length + ' hueco(s):\n');
for (const f of fallos) {
  say('  · ' + f.via);
  say('    ' + f.fichero + ' — falta ' + f.falta);
  say('    por qué importa: ' + f.porque + '\n');
}
say('Texto que no escribió el usuario llegando indistinguible de nuestras instrucciones.');
say('Detalle y huecos conocidos: docs/seguridad/disa-prompt-injection.md');
say('RESULTADO: ' + (REGLAS.length - fallos.length) + ' ✓  ·  ' + fallos.length + ' ✗');
process.exit(1);
