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
// ejecutor. **Prueba el MISMO código que corre en producción**, con las mismas guardas de permiso y
// las mismas validaciones: lo único que se salta es la conversación que decide QUÉ acción ejecutar.
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
