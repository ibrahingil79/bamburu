// ─────────────────────────────────────────────────────────────────────────────────────────────────
// EJECUTAR UNA CONSULTA DE DISA CON TOPE Y CON RELOJ — la única puerta.
//
// AUD-005. Antes esto era una línea:
//
//     const rows = db.prepare(sql).all();
//
// Sin tope de filas y sin plazo. El tope se le PEDÍA al modelo en la descripción de la herramienta
// («Usa LIMIT 20 como maximo»), que es un ruego, no un cerrojo: si el modelo se olvidaba, alucinaba
// o alguien le colaba texto por una factura adjunta, no había nada detrás. Medido el 3 sep 2026,
// lo que se iba al proveedor con UNA consulta: `SELECT * FROM invoices` → 928 filas, **1.098 KB**.
//
// LAS TRES COSAS QUE HACE, y por qué en este orden:
//   1. **Tope de filas impuesto por el servidor.** Se pide UNA fila de más para saber si había más
//      sin traerlas. Da igual lo que pida el SQL: `LIMIT 5000` sale recortado igual.
//   2. **Plazo real.** La consulta corre en un `worker_thread` y al vencer **se mata el hilo**. No
//      es «dejar de esperar»: `better-sqlite3` es síncrono y no tiene `interrupt()`, así que en el
//      hilo principal una consulta lenta bloquea el servidor para todos los negocios. Medido: un
//      `ORDER BY` sobre una expresión tarda 10,6 s en dar la PRIMERA fila, así que un reloj mirado
//      entre filas no llega a mirarse ni una vez.
//   3. **El recorte se anuncia.** Si se cortó, el resultado lo dice en un campo aparte y con el
//      texto ya escrito (`MOTIVO_RECORTE`). Un resultado recortado que parece completo es el peor
//      fallo posible aquí.
//
// Los valores viven en `limites-consulta.js`, en un solo sitio y con su motivo.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_FILAS, PLAZO_MS, MOTIVO_RECORTE, MSG_PLAZO_AGOTADO } from './limites-consulta.js';
import { recordError } from '../../core/control-db.js';

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'consulta-worker.js');

/**
 * Ejecuta `sql` contra la base de `ruta` con tope y plazo. **Nunca lanza**: devuelve el resultado o
 * un objeto con `error`, porque quien llama tiene que poder contárselo al modelo, no reventar.
 *
 * Devuelve `{ rows, count, recortado?, aviso? }` o `{ error, plazo_agotado? }`.
 */
export async function consultarConLimites(ruta, sql, {
  maxFilas = MAX_FILAS, plazoMs = PLAZO_MS, alRegistrar = null,
} = {}) {
  if (!ruta) return { error: 'No se pudo identificar la base del negocio para consultar.' };
  const t0 = Date.now();

  let worker;
  const resultado = await new Promise((resolve) => {
    let cerrado = false;
    const acabar = (r) => { if (!cerrado) { cerrado = true; resolve(r); } };

    try {
      worker = new Worker(WORKER, { workerData: { ruta, sql, maxFilas } });
    } catch (e) {
      return acabar({ error: 'No se pudo ejecutar la consulta: ' + (e.message || 'error interno') });
    }

    // EL RELOJ. `unref` para que un plazo pendiente no mantenga vivo el proceso si todo lo demás
    // terminó — un timer olvidado que impide cerrar es un cuelgue silencioso.
    const reloj = setTimeout(() => {
      worker.terminate();                       // ← esto es lo que la cancela DE VERDAD
      acabar({ error: MSG_PLAZO_AGOTADO, plazo_agotado: true });
    }, plazoMs);
    if (typeof reloj.unref === 'function') reloj.unref();

    worker.on('message', (m) => { clearTimeout(reloj); acabar(m); });
    // Un worker que muere sin mensaje NO puede quedarse colgado esperando: se responde con error.
    worker.on('error', (e) => { clearTimeout(reloj); acabar({ error: 'La consulta falló: ' + (e.message || 'error interno') }); });
    worker.on('exit', () => { clearTimeout(reloj); acabar({ error: 'La consulta se interrumpió antes de terminar.' }); });
  });

  try { if (worker) await worker.terminate(); } catch { /* ya estaba muerto */ }

  const ms = Date.now() - t0;

  if (resultado.error || resultado.ok === false) {
    const salida = { error: resultado.error || 'La consulta falló.' };
    if (resultado.plazo_agotado) salida.plazo_agotado = true;
    // EL REGISTRO. Se anota SIEMPRE que algo se cortó o falló: si no queda escrito, mañana nadie
    // puede decir desde cuándo pasa — la lección de la caída de la IA sin rastro.
    if (alRegistrar) alRegistrar({ ms, error: salida.error, plazo_agotado: !!resultado.plazo_agotado });
    return salida;
  }

  const filas = resultado.filas || [];
  const salida = { rows: filas, count: filas.length };
  if (resultado.hayMas) {
    salida.recortado = true;
    salida.aviso = MOTIVO_RECORTE.filas;
    if (alRegistrar) alRegistrar({ ms, recortado: true, filas: filas.length });
  }
  return salida;
}

/**
 * Deja constancia de que una consulta se recortó o se canceló. **Al registro de la plataforma que ya
 * existe** (`error_log` de `control.db`, vía `recordError`): no se inventa una tabla nueva, y así lo
 * que pase aquí se ve en el mismo sitio donde se miran los demás fallos.
 *
 * ⚠️ EL SQL VA SANEADO, y no es un detalle: lo escribe el modelo a partir de lo que pide el dueño,
 * así que sus literales SON los datos — «¿cuánto me debe Juan Pérez?» acaba en `WHERE name='Juan
 * Pérez'`. Eso es PII de los clientes DEL cliente, y un registro no se limpia solo. Quien llama pasa
 * el SQL ya pasado por `redactarSql`; aquí se recorta la longitud y nada más.
 *
 * Nunca lanza: un registro que tumba la consulta que estaba registrando sería peor que no tenerlo.
 */
export function registrarConsultaDisa(db, { sql, tenant, userId, ms, error, plazo_agotado, recortado, filas }) {
  try {
    const qué = plazo_agotado ? 'CANCELADA por plazo (' + PLAZO_MS + ' ms)'
      : error ? 'FALLÓ'
      : recortado ? 'RECORTADA a ' + MAX_FILAS + ' filas (traía más)'
      : null;
    if (!qué) return;                                   // una consulta normal no ensucia el registro
    recordError({
      tenantSlug: tenant || null, method: 'DISA', path: 'query_database',
      message: qué + ' · ' + (ms == null ? '?' : ms) + ' ms'
        + (userId ? ' · usuario ' + userId : '')
        + (filas != null ? ' · devueltas ' + filas : '')
        + ' · SQL(saneado): ' + String(sql || '').slice(0, 300),
    });
  } catch { /* el registro nunca puede romper nada */ }
}
