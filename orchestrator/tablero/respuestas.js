// respuestas.js — Guarda en el tablero lo que Ibrahin contesta desde el móvil.
//
// ⚙️ POR QUÉ EXISTE (1 sep 2026). Nueve tareas están paradas esperando una decisión suya. Sacarlas
// de la cola fue lo correcto —si la máquina las coge sin criterio, el arquitecto las declara mal
// planteadas y acaban subiendo al móvil como si fueran una avería—, pero las dejó **en un documento
// que nadie lee salvo que pregunte por él**. Contestarlas tenía que ser posible desde el móvil, o
// se quedaban colgadas indefinidamente.
//
// LO QUE ESTA PIEZA NO HACE, y es tan importante como lo que hace: **no interpreta la respuesta,
// no la resume y no discute con ella.** La guarda TAL CUAL él la escribió, con su fecha, y devuelve
// la tarea a la cola. Quien la va a leer es el arquitecto para hacer el plano, y una respuesta
// resumida por el camino es una decisión de producto tomada por quien no debe.
import fs from 'node:fs';
import { escribirAtomico } from '../nucleo/almacen.js';

const hoy = () => new Date().toISOString().slice(0, 10);

/**
 * Escribe la respuesta en su tarea y la devuelve a la cola.
 *
 * Devolverla a la cola son dos cambios, y hacen falta LOS DOS (medido el 1 sep 2026):
 *   · el encabezado `## ⏸ ESPERANDO DECISIÓN DE IBRAHIN — X` vuelve a `## TAREA — X`, porque
 *     `reader.js` solo reconoce como tarea lo que empieza por «TAREA —»;
 *   · y el `estado:` vuelve a `pendiente`, porque `esperando` saca la tarea de la cola.
 * Cambiar uno solo la deja a medias: visible pero no cogible, o al revés.
 *
 * @returns { ok, motivo }
 */
export function guardarRespuesta({ rutaTablero, titulo, respuesta, cuando = hoy() }) {
  let texto;
  try { texto = fs.readFileSync(rutaTablero, 'utf8'); }
  catch (e) { return { ok: false, motivo: `no pude leer el tablero: ${e.message}` }; }

  const lineas = texto.split('\n');
  const i = lineas.findIndex((l) =>
    /^#{1,6}\s*⏸\s*ESPERANDO DECISI[ÓO]N DE IBRAHIN\s*[—–-]\s*/i.test(l) && l.includes(titulo));
  if (i === -1) return { ok: false, motivo: 'ya no está esperando: alguien la ha movido' };

  // 1 · El encabezado vuelve a ser el de una tarea.
  lineas[i] = `## TAREA — ${titulo}`;

  // 1-bis · Y se retira la instrucción de «contéstala y volverá a la cola», que **ya no es
  // cierta**: la tarea YA ha vuelto. Dejarla ahí es un renglón que le dice al siguiente que haga
  // algo que está hecho, y este documento tiene reglas escritas contra justo eso.
  {
    let k = i + 1, tope = Math.min(lineas.length, i + 12);
    while (k < tope) {
      if (/Cont[eé]stala y esta tarea vuelve a la cola/i.test(lineas[k])) {
        // La instrucción son sus dos o tres renglones de cita seguidos.
        let j = k;
        while (j < lineas.length && /^>/.test(lineas[j])) j++;
        lineas.splice(k, j - k, '> <i>Contestada — ver la respuesta más abajo.</i>');
        break;
      }
      k++;
    }
  }

  // 2 · El estado vuelve a «pendiente», y la respuesta queda escrita justo debajo, con su fecha.
  //     Se busca dentro del bloque, no en todo el documento: hay un `estado:` por tarea.
  let fin = lineas.length;
  for (let k = i + 1; k < lineas.length; k++) { if (/^#{1,6}\s/.test(lineas[k])) { fin = k; break; } }
  const e = lineas.findIndex((l, k) => k > i && k < fin && /^-\s*\*\*estado:\*\*/i.test(l));
  if (e === -1) return { ok: false, motivo: 'esa tarea no tiene línea de estado: no sé devolverla a la cola' };
  lineas[e] = '- **estado:** pendiente';

  // La respuesta va DESPUÉS del preámbulo de campos, para no romperlo. Y va literal, entre
  // comillas, con la fecha: es lo que el arquitecto va a leer para hacer el plano.
  let tras = e + 1;
  while (tras < fin && /^-\s*\*\*/.test(lineas[tras])) tras++;
  lineas.splice(tras, 0,
    '',
    `> ### ✅ RESPUESTA DE IBRAHIN (${cuando}), contestada desde el móvil`,
    '>',
    ...String(respuesta).split('\n').map((l) => `> **${l}**`),
    '>',
    '> Está escrita tal cual la dijo: **no se ha resumido ni interpretado por el camino.** Es lo que',
    '> el arquitecto tiene que leer para hacer el plano, y un resumen sería una decisión de producto',
    '> tomada por quien no debe.');

  try { escribirAtomico(rutaTablero, lineas.join('\n')); }
  catch (err) { return { ok: false, motivo: `no pude escribir el tablero: ${err.message}` }; }
  return { ok: true };
}
