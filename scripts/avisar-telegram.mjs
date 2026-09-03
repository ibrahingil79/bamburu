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
//   printf '%s' "texto" | node scripts/avisar-telegram.mjs
import { mandarTelegram } from '../core/telegram-servidor.js';
import path from 'node:path';

const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);

let texto = '';
process.stdin.setEncoding('utf8');
for await (const trozo of process.stdin) texto += trozo;
texto = texto.trim();
if (!texto) { console.log('aviso NO enviado: texto vacío'); process.exit(1); }

const r = await mandarTelegram({ texto, raiz: RAIZ });
console.log(r.ok ? 'aviso enviado por Telegram' : 'aviso NO enviado: ' + r.motivo);
process.exit(r.ok ? 0 : 1);
