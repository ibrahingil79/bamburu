// Códigos de rescate del 2FA — la salida de emergencia cuando el móvil se pierde, se rompe o se
// formatea. Sin esto, el segundo factor deja de ser una cerradura y pasa a ser una trampa: quien
// pierde el teléfono pierde la cuenta, y en el caso del superadmin, la plataforma entera.
//
// Decisiones y por qué:
//   · 10 códigos. Suficientes para varios sustos sin que la lista sea impresentable en papel.
//   · Alfabeto SIN 0/O/1/I/L: estos códigos se copian a mano desde un papel, a menudo con prisa y
//     mal cuerpo. Un cero que se lee como O es un rescate fallido justo el día que hacía falta.
//   · 10 caracteres de 31 posibles ≈ 49 bits. Se guardan con bcrypt, así que probarlos a ciegas es
//     inviable aunque alguien se lleve la tabla entera.
//   · bcrypt y no sha256: el coste está en el hash a propósito. Son diez comparaciones como mucho,
//     en un camino que se usa una vez cada varios años — no es sitio donde ahorrar milisegundos.
import bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { BCRYPT_COST } from './auth.js';

const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // sin 0 O 1 I L
const LARGO = 10;
const CUANTOS = 10;

// randomInt (no Math.random) — esto es material criptográfico, y el rechazo por módulo lo resuelve
// el propio randomInt: da uniforme en [0, max).
function generarUno() {
  let s = '';
  for (let i = 0; i < LARGO; i++) s += ALFABETO[randomInt(ALFABETO.length)];
  return s.slice(0, 5) + '-' + s.slice(5);   // XXXXX-XXXXX, más fácil de leer y de teclear
}

// Lo que teclea una persona cansada: espacios de más, minúsculas, el guion puesto o no.
// Todo eso es el mismo código. Se normaliza igual al crearlo que al comprobarlo.
export function normalizar(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Devuelve { codigos, hashes }: los codigos se enseñan UNA vez y no se vuelven a poder ver;
// los hashes son lo único que se guarda.
export async function generarCodigosRescate() {
  const codigos = Array.from({ length: CUANTOS }, generarUno);
  const hashes = await Promise.all(codigos.map(c => bcrypt.hash(normalizar(c), BCRYPT_COST)));
  return { codigos, hashes };
}

// Busca el código entre los que quedan sin usar. Devuelve la fila que casa, o null.
// NO marca nada: gastarlo es cosa de quien llama (consumeRecoveryCode), que es quien sabe si el
// intento acabó bien. Así un fallo posterior no deja el código quemado sin haber servido de nada.
export async function buscarCodigo(code, filas) {
  const limpio = normalizar(code);
  // Un código válido tiene una forma concreta; lo que no la tiene no merece diez bcrypt.
  if (limpio.length !== LARGO) return null;
  for (const fila of filas) {
    if (await bcrypt.compare(limpio, fila.code_hash)) return fila;
  }
  return null;
}
