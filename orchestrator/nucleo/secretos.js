// secretos.js — Tapa lo que nunca debe acabar escrito en ningún sitio.
//
// No basta con «tener cuidado al escribir logs»: un mensaje de error de una librería, una
// traza o un volcado de configuración pueden arrastrar el token sin que nadie lo pretenda.
// Por eso TODO lo que va al registro pasa por aquí primero.

// ⚙️ 4 SEP 2026 — LA RED POR FORMA SE QUEDA, LA RED POR NOMBRE SE FUE. La fábrica ya no tiene
// ninguna credencial de bot (el bot es exclusivo de Bamburu y su código aquí se borró), así que
// `ORQUESTADOR_TELEGRAM_TOKEN` salió de la lista de abajo: tapar por el valor de una variable que
// no existe es tapar por nada. Esta otra red NO se toca aunque hable de Telegram: no sabe hablar
// con nadie, solo reconoce una FORMA, y su trabajo es que un token —venga de donde venga— nunca
// acabe escrito en un registro. Una defensa que no puede emitir no es una puerta.
const FORMA_TOKEN_BOT = /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g;

/** Variables de entorno cuyo VALOR nunca puede aparecer en un texto. */
const VARIABLES_SECRETAS = [
  'ANTHROPIC_API_KEY',
  'RESEND_API_KEY',
  'NOTION_TOKEN',
];

/**
 * Devuelve el texto con los secretos tapados.
 * Dos redes, a propósito:
 *   1. por FORMA — caza un token aunque venga de un sitio que no controlamos;
 *   2. por VALOR — caza el token concreto de esta máquina aunque no tenga la forma esperada.
 */
export function tapar(texto, entorno = process.env) {
  let t = String(texto ?? '');
  for (const nombre of VARIABLES_SECRETAS) {
    const valor = entorno[nombre];
    if (valor && valor.length >= 8) t = t.split(valor).join(`«${nombre} tapado»`);
  }
  return t.replace(FORMA_TOKEN_BOT, '«token tapado»');
}

/** Para enseñar por pantalla que algo está puesto, sin enseñarlo. */
export function pista(valor) {
  const v = String(valor ?? '');
  if (!v) return '(vacío)';
  if (v.length <= 8) return '••••';
  return `${v.slice(0, 4)}…${v.slice(-2)} (${v.length} caracteres)`;
}
