#!/usr/bin/env node
//
// avisar-telegram.mjs — mandar un aviso a Telegram desde un guion de shell.
//
// El texto entra por la ENTRADA ESTÁNDAR, nunca por argumentos: lo que va en la línea de comandos
// se ve entero en `ps` y acaba en los registros del sistema, y este proyecto ya pagó esa lección con
// la rotación de una clave. Aquí el texto no es secreto, pero la costumbre se mantiene donde se
// pueda mantener gratis.
//
// Imprime UNA línea con lo que ha pasado y sale con 0 si el aviso salió, 1 si no. Quien lo llama
// decide qué hacer con eso — pero un aviso que falla NO puede tumbar al que avisaba.
//
// El TEMA va como único argumento y es OBLIGATORIO: desde el 3 sep 2026 el bot es exclusivo de
// Bamburu y todo aviso empieza diciendo quién habla y de qué. La cabecera la pone la puerta común.
//
// FRENO OPCIONAL (4 sep 2026): `--clave <k> --ventana-min <m>` no vuelve a mandar el MISMO aviso
// si salió hace menos de <m> minutos. Es opcional a propósito — sin esos dos argumentos esto se
// comporta exactamente igual que antes, y ninguno de los que ya llamaban aquí cambia de conducta.
//
//   printf '%s' "texto" | node scripts/avisar-telegram.mjs copias
//   printf '%s' "texto" | node scripts/avisar-telegram.mjs copias --clave copia-principal-fallo --ventana-min 360
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mandarTelegram } from '../core/telegram-servidor.js';
import { dejaPasar, anotar } from '../core/freno-avisos.js';

const TEMA = (process.argv[2] || '').trim();
if (!TEMA) { console.log('aviso NO enviado: falta el tema (uso: … | node scripts/avisar-telegram.mjs <tema>)'); process.exit(1); }

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? (process.argv[i + 1] || '') : ''; };
const CLAVE = arg('--clave').trim();
const VENTANA_MIN = Number(arg('--ventana-min')) || 0;
// Ruta ABSOLUTA, resuelta desde este fichero: quien llama es un guion de shell que puede correr
// desde cualquier carpeta, y un estado que cambia de sitio según el cwd no frena nada.
const ESTADO = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'estado-avisos.json');

let texto = '';
process.stdin.setEncoding('utf8');
for await (const trozo of process.stdin) texto += trozo;
texto = texto.trim();
if (!texto) { console.log('aviso NO enviado: texto vacío'); process.exit(1); }

if (CLAVE && VENTANA_MIN > 0
    && !dejaPasar({ fichero: ESTADO, clave: CLAVE, ventanaMs: VENTANA_MIN * 60000 })) {
  // Sale con 0: no es un fallo del aviso, es el freno haciendo su trabajo. Quien llama no debe
  // tratar "ya avisé hace un rato" como "no se pudo avisar".
  console.log('aviso NO repetido: «' + CLAVE + '» ya salió hace menos de ' + VENTANA_MIN + ' min');
  process.exit(0);
}

const r = await mandarTelegram({ texto, tema: TEMA });
if (r.ok && CLAVE) anotar({ fichero: ESTADO, clave: CLAVE });
console.log(r.ok ? 'aviso enviado por Telegram' : 'aviso NO enviado: ' + r.motivo);
process.exit(r.ok ? 0 : 1);
