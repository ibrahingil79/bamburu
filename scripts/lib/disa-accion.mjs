// ─────────────────────────────────────────────────────────────────────────────────────────────────
// EJECUTAR UNA ACCIÓN DE DISA EN UNA COMPROBACIÓN, SIN PASAR POR EL MODELO.
//
// `executeAction` es el único punto donde una acción de DISA toca datos. Vive dentro de
// `register(app, db)` y hasta el 3 sep 2026 solo se alcanzaba hablando con el modelo: comprobar que
// «un cambio de stock deja su apunte» dependía del saldo del proveedor de IA y de que contestara lo
// que se esperaba. Un gate así es una moneda al aire, y por eso los que llaman al modelo están
// declarados FUERA del barrido.
//
// Esto monta el router de DISA sobre una app de mentira —no se sirve a nadie— y devuelve el
// ejecutor. **Prueba el MISMO código que corre en producción**: lo único que se salta es la
// conversación que decide QUÉ acción ejecutar.
//
// ⚠️ CORREGIDO EL 3 SEP 2026 (AUD-016). Aquí ponía «con las mismas guardas de permiso y las mismas
// validaciones», y NO ES CIERTO: `executeAction` no comprueba permisos ni valida el sobre. Esos tres
// cerrojos —`validActionEnvelope`, `actionAllowed`, `claimConfirmation`— viven ANTES, en la ruta
// `/message`, y llamar al ejecutor a pelo se los salta. Se tacha en vez de borrarse porque la frase
// vieja estuvo dando por probado algo que nadie probaba, que es peor que no tener comprobación.
// Quien quiera medir LOS CERROJOS —y no solo el efecto— usa `cerrojosDeDisa(db)`, aquí debajo.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import { register } from '../../modules/disa/index.js';

export function ejecutorDeAcciones(db) {
  const salida = register(new Hono(), db);
  if (!salida || typeof salida.executeAction !== 'function') {
    // Si la costura desaparece, esto NO puede seguir en silencio dando por buena una comprobación
    // que ya no comprueba nada.
    throw new Error('modules/disa/index.js ya no devuelve executeAction: la comprobación no puede ejecutar acciones de DISA.');
  }
  return (accion, session) => salida.executeAction(db, accion, session);
}

// Los cerrojos que la ruta `/message` aplica ANTES de ejecutar nada, tal cual, sin copiarlos. Los usa
// la batería de inyección (`scripts/gate-disa-inyeccion.mjs`) para preguntarles lo que de verdad
// importa: si la IA se traga una orden metida en un dato ajeno, ¿la para el servidor?
export function cerrojosDeDisa(db) {
  const salida = register(new Hono(), db);
  const faltan = ['actionAllowed', 'claimConfirmation', 'validActionEnvelope']
    .filter(k => typeof salida?.[k] !== 'function');
  if (faltan.length || !(salida?.EXECUTABLE_ACTIONS instanceof Set)) {
    // Sin los cerrojos NO se puede dar por buena ninguna aserción sobre ellos: se falla y se dice.
    throw new Error('modules/disa/index.js ya no expone los cerrojos (' + (faltan.join(', ') || 'EXECUTABLE_ACTIONS') + '): la batería no puede comprobarlos.');
  }
  return salida;
}
