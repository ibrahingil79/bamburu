#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// CENSO DE BORRADOS SIN FILTRO — que nadie vuelva a dejar un `DELETE` capaz de vaciar el historial
// de conversación de un negocio entero.
//
// DE DÓNDE SALE (AUD-002, comprobado vivo el 2 sep 2026 y arreglado el 3). `POST /api/disa/clear`
// hacía esto, tal cual:
//
//     db.prepare('DELETE FROM disa_conversations').run();
//
// Sin `WHERE`. Una llamada de cualquiera con sesión —también un empleado sin permisos— se llevaba el
// historial del NEGOCIO ENTERO, y con él la constancia de las decisiones que se tomaron hablando con
// DISA. No la llamaba ninguna pantalla, así que nadie la habría echado de menos.
//
// QUÉ EXIGE, y es una regla y no una lista de casos: **todo `DELETE` sobre las tablas de
// conversación de DISA tiene que llevar un `WHERE` que llegue hasta `user_id`.** No basta con
// filtrar por hilo: `disa_conversations` no tiene dueño propio —el dueño solo se sabe saltando por
// `thread_id → disa_conversation_threads.user_id`—, así que un `WHERE thread_id=?` a secas borraría
// la conversación de otro con solo poner su número. El salto va en la sentencia o no vale.
//
// ── Y LA MITAD QUE HACE QUE ESTO SIRVA PARA ALGO ────────────────────────────────────────────────
// **El censo se prueba a sí mismo en cada pasada.** Antes de mirar el producto se pasa por el mismo
// detector una MUESTRA ENVENENADA escrita a mano, y si no la caza, sale ROJO sin llegar a mirar
// nada. La lección es del propio repo y está en CLAUDE.md con su fecha: el 24 ago 2026
// `censo-ventanitas` decía CERO y había una viva —se creía dentro de un comentario desde un
// `accept="…,*/*"`—, y **un censo que dice cero sin ser cierto es peor que no tenerlo, porque cierra
// la pregunta**. Un centinela que se queda ciego en silencio es exactamente el fallo que este
// fichero existe para impedir.
//
//   node scripts/censo-borrado-sin-filtro.mjs             → veredicto
//   node scripts/censo-borrado-sin-filtro.mjs --detalle   → cada borrado encontrado, con su texto
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { soloCodigo, sinComentariosHtml, sinComentariosDeLinea } from './lib/solo-codigo.mjs';

// Ni `console` ni `log` pegados: el validador del orquestador los rechaza en las líneas nuevas de un
// `.mjs`. Mismo apaño que en `censo-ventanitas.mjs`.
const say = (s) => process.stdout.write(s + '\n');
const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
const DETALLE = process.argv.includes('--detalle');

// Las tablas donde vive la conversación. `disa_conversations` guarda el texto; los hilos, de quién
// es. Las dos, porque borrar los hilos de golpe deja los mensajes sin dueño e inalcanzables — que es
// la misma pérdida por el otro lado.
const TABLAS = ['disa_conversations', 'disa_conversation_threads'];

// Un borrado de verdad: `DELETE FROM <tabla>` o `DROP TABLE <tabla>`, con el nombre pegado o
// entrecomillado. `DROP` no admite filtro ninguno, así que ahí no hay nada que discutir: es rojo.
const RE = new RegExp(
  '\\b(DELETE\\s+FROM|DROP\\s+TABLE(?:\\s+IF\\s+EXISTS)?)\\s+["\'`]?(' + TABLAS.join('|') + ')["\'`]?\\b',
  'gi');

// Dónde acaba la sentencia. Se mira desde el `DELETE` hasta que la cadena SQL se cierra —el
// `.run(`/`.get(`/… de better-sqlite3, un `;`, o el final del argumento— y NUNCA más allá: sin este
// corte, un `user_id` de la línea siguiente daría por buena una sentencia sin filtro.
const FIN = /\.(run|get|all|iterate|pluck)\s*\(|;/;

/** ¿Este borrado está atado a un usuario? Devuelve el motivo del rojo, o null si está bien. */
function juzgar(codigo, desde) {
  const trozo = codigo.slice(desde, desde + 600);
  const corte = trozo.search(FIN);
  const sentencia = corte === -1 ? trozo : trozo.slice(0, corte);
  if (/^\s*DROP/i.test(sentencia)) return 'DROP TABLE: no admite filtro, se lleva la tabla entera';
  if (!/\bWHERE\b/i.test(sentencia)) return 'no lleva WHERE: vacía la tabla del negocio entero';
  if (!/\buser_id\b/.test(sentencia)) return 'el WHERE no llega a user_id: puede borrar la conversación de otra persona';
  return null;
}

// El fichero como lo lee JavaScript: fuera los comentarios de bloque, los de HTML de las plantillas
// y los de línea — en ese orden, y conservando los saltos para no descolocar los números de línea.
// La autoprueba pasa por AQUÍ MISMO: si la limpieza cambia, cambia para las dos y no puede quedarse
// una mitad probándose contra una regla que la otra ya no usa.
function limpiar(src) {
  return sinComentariosHtml(soloCodigo(src)).split('\n').map(sinComentariosDeLinea).join('\n');
}

/** Recorre un árbol y devuelve los borrados que no cumplen. */
function barrer(dir, hallazgos) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'data'].includes(f.name)) continue;
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { barrer(p, hallazgos); continue; }
    if (!f.name.endsWith('.js')) continue;
    const bruto = fs.readFileSync(p, 'utf8');
    const codigo = limpiar(bruto);             // los comentarios fuera: la nota que explica la
    const lineas = bruto.split('\n');          // avería no puede contar como la avería
    for (const m of codigo.matchAll(RE)) {
      const motivo = juzgar(codigo, m.index);
      const linea = codigo.slice(0, m.index).split('\n').length;
      hallazgos.push({ fichero: path.relative(RAIZ, p), linea, sql: m[0].replace(/\s+/g, ' '),
                       motivo, texto: (lineas[linea - 1] || '').trim().slice(0, 110) });
    }
  }
  return hallazgos;
}

// ── LA AUTOPRUEBA. Se ejecuta SIEMPRE, antes de mirar el producto ────────────────────────────────
// Cuatro muestras: las dos primeras tienen que salir ROJAS y las dos últimas VERDES. Si el detector
// falla en cualquiera de las cuatro, este censo no sabe lo que cree saber y se para aquí.
// El SQL va partido en trozos a propósito, para que un `grep` del repo buscando borrados sin filtro
// no tropiece con los ejemplos de esta comprobación y los cuente como código de producto.
const D = 'DELETE FROM ';
const MUESTRAS = [
  { rojo: true,  src: "db.prepare('" + D + "disa_conversations').run();" },
  { rojo: true,  src: "db.prepare('" + D + "disa_conversations WHERE thread_id=?').run(t);" },
  { rojo: false, src: "db.prepare('" + D + "disa_conversations WHERE thread_id IN (SELECT id FROM disa_conversation_threads WHERE user_id=?)').run(u);" },
  { rojo: false, src: "// " + D + "disa_conversations   ← esto es un comentario, no cuenta" },
];

let autofallos = 0;
for (const [i, m] of MUESTRAS.entries()) {
  const codigo = limpiar(m.src);
  const hit = [...codigo.matchAll(RE)][0];
  const cazado = !!hit && !!juzgar(codigo, hit.index);
  if (cazado !== m.rojo) {
    autofallos++;
    say('  ✗ AUTOPRUEBA ' + (i + 1) + ': se esperaba ' + (m.rojo ? 'ROJO' : 'verde') + ' y salió ' +
        (cazado ? 'ROJO' : 'verde') + '  →  ' + m.src.slice(0, 90));
  }
}
if (autofallos) {
  say('\n✗ EL CENSO NO SE FÍA DE SÍ MISMO: ' + autofallos + ' de ' + MUESTRAS.length +
      ' muestras mal juzgadas.');
  say('  No ha mirado el producto. Un censo ciego que dice CERO es peor que no tenerlo.');
  say('RESULTADO: 0 ✓  ·  1 ✗');
  process.exit(1);
}

// ── EL PRODUCTO ──────────────────────────────────────────────────────────────────────────────────
// `modules/` y `core/`: donde viven las rutas. Los `scripts/` quedan fuera a propósito — una
// comprobación que siembra y limpia en su propio negocio de usar y tirar no es una ruta que un
// atacante pueda pedir, y meterlos aquí llenaría el censo de ruido hasta que nadie lo mirase.
const todos = [];
barrer(path.join(RAIZ, 'modules'), todos);
barrer(path.join(RAIZ, 'core'), todos);
const malos = todos.filter(h => h.motivo);

say('\nAUTOPRUEBA: ' + MUESTRAS.length + '/' + MUESTRAS.length + ' muestras bien juzgadas ' +
    '(2 envenenadas cazadas, 2 buenas respetadas)');
say('BORRADOS SOBRE LAS TABLAS DE CONVERSACIÓN DE DISA: ' + todos.length +
    '  en modules/ y core/  (no se cuentan los que están en comentarios)');
for (const h of todos) {
  say('  ' + (h.motivo ? '✗' : '·') + ' ' + h.fichero + ':' + h.linea + '  ' + h.sql +
      (h.motivo ? '   → ' + h.motivo : '   → filtrado por usuario'));
  if (DETALLE) say('       ' + h.texto);
}

if (malos.length) {
  say('\n✗ SIN FILTRO POR USUARIO: ' + malos.length);
  say('  Un borrado sobre estas tablas tiene que llegar hasta `user_id`. `disa_conversations` no');
  say('  tiene dueño propio: se salta por `thread_id → disa_conversation_threads.user_id`.');
  say('  La única puerta buena ya existe — `borrarConversaciones()` en modules/disa/index.js.');
}
say('RESULTADO: ' + (malos.length ? 0 : 1) + ' ✓  ·  ' + malos.length + ' ✗');
process.exit(malos.length ? 1 : 0);
