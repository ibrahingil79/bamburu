// suscripcion-datos.js — Los 90 días para llevarse todo, y la bóveda.
//
// Tarea `suscripcion-datos-tras-el-corte` (2 sep 2026). Se apoya en el corte que ya existe y **no lo
// cambia**: el corte no toca ni una fila, y esto tampoco.
//
// LA REGLA QUE MANDA SOBRE TODAS: **en ningún momento se destruye información de un negocio.** Ni
// tras el corte, ni en la bóveda, ni «temporalmente», ni «para limpiar». En este fichero no hay un
// solo `DELETE` ni un solo `DROP`, y hay una comprobación en el barrido que lo vigila.
//
// LA BÓVEDA ES UN ESTADO, NO UN SITIO. Pasados los 90 días **no se mueve nada**: los datos siguen en
// la base del negocio, exactamente donde estaban, y lo único que cambia es que la ventana de
// descarga se cierra. Tres consecuencias, y las tres son a propósito:
//   1. El rescate de la tarea siguiente **se encuentra el negocio entero**, sin nada que restaurar.
//   2. Un borrado futuro hecho a propósito —cuando se escriba la política de RGPD, que es trabajo
//      de negocio y no de código— **sigue siendo posible**: no hay que sacar nada de ningún sitio
//      raro antes de poder atender una petición de borrado.
//   3. No existe el momento peligroso: mover datos es la operación en la que se pierden.
//
// EL RELOJ ARRANCA EL DÍA DEL CORTE Y NO SE REINICIA. Es la misma trampa que la del corte: si
// `descarga_hasta` se recalculara en cada pasada o en cada aviso, la ventana se alargaría sola y los
// 90 días no llegarían nunca. Se fija UNA vez, al cortar, y no se vuelve a tocar.

import { controlDb } from './control-db.js';
import { suscripcionDe, guardarSuscripcion, hoyISO, sumarDias, diasEntre, fechaEnPalabras } from './suscripcion.js';

/** Días que tiene el cliente para descargarlo todo, desde el corte. Es la regla del dueño: 90. */
export const DIAS_DE_DESCARGA = 90;

/**
 * Abre la ventana de descarga. Se llama UNA vez, al cortar.
 * Idempotente y sin marcha atrás: si ya había fecha, no la mueve. Ése es el punto.
 */
export function abrirVentanaDeDescarga(tenantId, { db = controlDb, desde = null } = {}) {
  const s = suscripcionDe(tenantId, db);
  if (!s) return null;
  if (s.descarga_hasta) return s;          // ya estaba abierta: NO se alarga
  const corte = desde || s.cortado_en || hoyISO();
  guardarSuscripcion(tenantId, { descarga_hasta: sumarDias(corte, DIAS_DE_DESCARGA) }, db);
  return suscripcionDe(tenantId, db);
}

/**
 * La situación de los datos, ya masticada para pintarla. El criterio del dueño es que el cliente
 * **sepa en todo momento cuántos días le quedan y qué pasará después**, así que esto devuelve
 * siempre las dos cosas, en palabras.
 */
export function situacionDeLosDatos(tenantId, { db = controlDb, hoy = null } = {}) {
  const dia = hoy || hoyISO();
  const s = suscripcionDe(tenantId, db);
  if (!s || !s.cortado_por_impago || !s.descarga_hasta) {
    return { aplica: false, fase: 'sin_corte' };
  }
  const quedan = diasEntre(dia, s.descarga_hasta);
  const enBoveda = quedan <= 0;
  return {
    aplica: true,
    fase: enBoveda ? 'boveda' : 'ventana_abierta',
    dias_restantes: enBoveda ? 0 : quedan,
    hasta: s.descarga_hasta,
    hasta_en_palabras: fechaEnPalabras(s.descarga_hasta),
    en_boveda_desde: s.en_boveda_desde || null,
    titulo: enBoveda
      ? 'Tus datos están guardados en la bóveda'
      : `Te quedan ${quedan} ${quedan === 1 ? 'día' : 'días'} para descargar tus datos`,
    detalle: enBoveda
      ? 'La ventana de descarga se cerró, pero **no se ha borrado nada**: tus datos siguen enteros, '
        + 'exactamente como los dejaste. Para volver a sacarlos, escríbenos.'
      : `Puedes descargarte TODO lo tuyo —clientes, facturas, catálogo, agenda— en un solo archivo, `
        + `tú solo y sin pedir permiso, hasta el ${fechaEnPalabras(s.descarga_hasta)}. `
        + `Después, tus datos NO se borran: pasan a una bóveda de la que se pueden rescatar.`,
    // La descarga solo se puede preparar y bajar mientras la ventana está abierta.
    puede_descargar: !enBoveda,
    descarga: {
      estado: s.descarga_estado || null,
      lista_en: s.descarga_lista_en || null,
      fichero: s.descarga_fichero || null,
      error: s.descarga_error || null,
      resumen: (() => { try { return s.descarga_resumen ? JSON.parse(s.descarga_resumen) : null; } catch { return null; } })(),
    },
  };
}

/**
 * Los negocios a los que hoy se les cierra la ventana. Los recorre la pasada diaria.
 * Se les pone la MARCA de bóveda; **no se toca ni un dato suyo**.
 */
export function aLosQueSeLesCierraLaVentana({ db = controlDb, hoy = null } = {}) {
  const dia = hoy || hoyISO();
  try {
    return db.prepare(`
      SELECT t.id, t.name, t.slug, s.descarga_hasta
        FROM tenants t JOIN tenant_suscripciones s ON s.tenant_id = t.id
       WHERE s.cortado_por_impago = 1
         AND s.descarga_hasta IS NOT NULL
         AND s.en_boveda_desde IS NULL`).all()
      .filter(f => diasEntre(dia, f.descarga_hasta) <= 0);
  } catch { return []; }
}

/**
 * Cierra la ventana y marca la bóveda. **No mueve, no archiva y no borra nada**: solo escribe una
 * fecha en `control.db`. Si algún día alguien añade aquí un `DELETE`, el barrido lo canta.
 */
export function guardarEnLaBoveda(tenantId, { db = controlDb, hoy = null } = {}) {
  const dia = hoy || hoyISO();
  guardarSuscripcion(tenantId, { en_boveda_desde: dia }, db);
  return situacionDeLosDatos(tenantId, { db, hoy: dia });
}
