// ─────────────────────────────────────────────────────────────────────────────────────────────────
// EL HILO QUE EJECUTA LA CONSULTA DE DISA. Se le puede matar, y eso es todo su motivo de existir.
//
// `better-sqlite3` es síncrono y no expone `interrupt()`: desde el hilo principal no hay forma de
// abortar una consulta ya lanzada, y mientras corre bloquea el bucle de eventos —o sea el servidor
// entero, para TODOS los negocios—. Aquí dentro puede bloquear lo que quiera: si se pasa del plazo,
// el hilo principal termina este worker y se acabó.
//
// Abre la base en SOLO LECTURA. No es adorno: este hilo ejecuta SQL escrito por el modelo, y aunque
// `evaluateQueryAccess` ya exige SELECT antes de llegar aquí, dos cerrojos en serie cuestan cero.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import { parentPort, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';

const { ruta, sql, maxFilas } = workerData;

try {
  const db = new Database(ruta, { readonly: true, fileMustExist: true });
  // `iterate` y no `all`: así se para EN la fila `maxFilas + 1` en vez de materializar la tabla
  // entera en memoria para tirar el resto. Se pide una de más a propósito — es la única forma de
  // saber si había más sin traerlas: si aparece, hubo recorte.
  const filas = [];
  let hayMas = false;
  const it = db.prepare(sql).iterate();
  for (const fila of it) {
    if (filas.length >= maxFilas) { hayMas = true; it.return(); break; }
    filas.push(fila);
  }
  db.close();
  parentPort.postMessage({ ok: true, filas, hayMas });
} catch (e) {
  // El error se DEVUELVE, no se traga ni se deja morir el hilo en silencio: el que llama tiene que
  // poder distinguir «SQL malo» de «se acabó el tiempo», y son cosas distintas para el usuario.
  parentPort.postMessage({ ok: false, error: String(e && e.message ? e.message : e) });
}
