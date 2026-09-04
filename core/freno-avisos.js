// ─────────────────────────────────────────────────────────────────────────────────────────────────
// EL FRENO DE LOS AVISOS REPETIDOS — que un fallo que dura no se convierta en cien mensajes.
//
// DE DÓNDE SALE (4 sep 2026). Al añadir el aviso por Telegram de las copias apareció el problema de
// siempre: una avería que dura manda un aviso por cada intento. El arranque ya lo había resuelto a
// su manera (`core/aviso-arranque.js`), pero allí la ventana es de 10 minutos porque lo que se acota
// es un bucle de reinicios de systemd. Una copia es otra cosa: pasa una vez al día, y el freno tiene
// que dejar pasar el aviso de mañana aunque el de hoy sea idéntico.
//
// LA REGLA, Y ES LA QUE MANDA SOBRE TODO LO DEMÁS: **ante la duda, SE AVISA.** Si el fichero de
// estado no se puede leer, si está corrupto, si no se puede escribir — se deja pasar el aviso. Un
// freno que se equivoca de más silencia justo la avería que tenía que contar, y eso es peor que
// recibir un mensaje repetido. Nada de aquí lanza nunca.
//
// ⚠️ NO ES el freno de `core/aviso-arranque.js`. Ese sigue teniendo el suyo dentro, con su ventana
// de 10 min y su fichero. Unificarlos es correcto y está anotado como deuda en TABLERO.md, pero
// hacerlo desde aquí tocaría el arranque, que no es lo que pedía esta tarea.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * ¿Toca mandar este aviso, o el MISMO ya salió hace nada?
 * @returns {boolean} true = mándalo. Ante cualquier duda, true.
 */
export function dejaPasar({ fichero, clave, ventanaMs, ahora = Date.now() }) {
  if (!fichero || !clave || !(ventanaMs > 0)) return true;   // mal configurado: avisar, no callar
  try {
    const est = JSON.parse(readFileSync(fichero, 'utf8'));
    const ultimo = est?.avisos?.[clave];
    if (typeof ultimo === 'number' && ahora - ultimo < ventanaMs) return false;
  } catch { /* sin fichero o ilegible: se avisa */ }
  return true;
}

/** Anota que este aviso ya salió. No poder anotarlo significa avisar de más, nunca de menos. */
export function anotar({ fichero, clave, ahora = Date.now() }) {
  if (!fichero || !clave) return;
  try {
    let est = {};
    try { est = JSON.parse(readFileSync(fichero, 'utf8')); } catch { /* nace ahora */ }
    est.avisos = est.avisos || {};
    est.avisos[clave] = ahora;
    // Se poda lo viejo para que el fichero no crezca sin fin con averías de hace semanas.
    for (const [k, v] of Object.entries(est.avisos)) {
      if (typeof v !== 'number' || ahora - v > 30 * 24 * 3600 * 1000) delete est.avisos[k];
    }
    mkdirSync(dirname(fichero), { recursive: true });
    writeFileSync(fichero, JSON.stringify(est, null, 2));
  } catch { /* ver arriba: callar nunca */ }
}
