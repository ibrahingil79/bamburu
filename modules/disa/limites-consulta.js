// ─────────────────────────────────────────────────────────────────────────────────────────────────
// LOS LÍMITES DE UNA CONSULTA DE DISA — en UN solo sitio, con su motivo escrito.
//
// POR QUÉ VIVEN AQUÍ Y NO REPARTIDOS (AUD-005, 3 sep 2026). Es la lección que este repo ya pagó con
// la llave anti-cobros-duplicados: **una regla que vive en quien la usa vuelve en cuanto alguien la
// olvida** — se escribió a mano cuatro veces el mismo día y cada arreglo la dejaba volver por el
// siguiente sitio. Si mañana aparece otro camino de consulta, importa de aquí o el centinela
// (`scripts/censo-consultas-disa.mjs`) lo canta.
//
// ⚠️ Y LO PRIMERO, porque es lo que define todo lo demás: **el tope no se le PIDE al modelo, se le
// IMPONE.** La descripción de la herramienta seguirá sugiriéndole que use `LIMIT`, porque ayuda a
// que escriba mejor SQL, pero eso es un ruego. Lo que corta es el servidor, y corta aunque la
// consulta pida `LIMIT 5000` o no pida ninguno.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

// ── CUÁNTAS FILAS ────────────────────────────────────────────────────────────────────────────────
// 200. El techo de lo que sirve para responder por chat.
//
// Medido el 3 sep 2026 sobre `desarrollo-bamburu`, contando el JSON que sale hacia el proveedor de
// IA dentro del `tool_result` (que es lo que de verdad viaja, y donde van los datos de los clientes
// del cliente: nombres, NIF, direcciones e importes):
//
//     SELECT * FROM invoices       →   928 filas → 1.098 KB     ← más de un MEGA, en un mensaje
//     SELECT * FROM ledger_lines   → 5.585 filas →   595 KB
//     SELECT * FROM clients        →   212 filas →   117 KB
//
// Y un solo mensaje puede gastar 8 herramientas (`MAX_HERRAMIENTAS_POR_MENSAJE`), o sea que el techo
// de ayer era del orden de 8 MB de datos del negocio por mensaje de chat.
//
// 200 deja sitio para un listado de verdad —«mis clientes de Madrid»— sin acercarse a eso: 200 filas
// de la tabla más gorda medida son ~240 KB. Por debajo (20, 50) se cortarían respuestas legítimas y
// DISA contestaría a medias creyendo que contesta entero, que es justo lo que se viene a evitar.
export const MAX_FILAS = 200;

// ── CUÁNTO TIEMPO ────────────────────────────────────────────────────────────────────────────────
// 5 segundos. Una consulta de chat que tarda más ya no sirve para conversar.
//
// Medido el mismo día: ninguna consulta legítima sobre estas bases pasa de ~100 ms. Los 5 s no están
// para las consultas normales —les sobra cien veces—, están para cortar en seco la que solo puede
// venir de un error del modelo o de un abuso: un cruce de tablas, un `ORDER BY` sobre una expresión.
//
// ⚠️ EL PLAZO SOLO ES DE VERDAD SI SE EJECUTA EN OTRO HILO, y esto está medido, no supuesto:
// `better-sqlite3` es SÍNCRONO y **no expone `interrupt()`** (`typeof db.interrupt === 'undefined'`).
// Un reloj mirado «entre filas» no vale: con
//     SELECT a.id FROM ledger_lines a, ledger_lines b ORDER BY (a.id * b.id)
// SQLite tiene que ordenarlo TODO antes de soltar la primera fila — **10.623 ms hasta la primera**,
// así que ese contador no llega a mirarse ni una vez. Y mientras corre, al ser síncrono, **bloquea
// el bucle de eventos: el servidor entero, para todos los negocios**.
// Por eso la consulta va a un `worker_thread` y al vencer el plazo **se mata el hilo**. Eso sí la
// cancela, y de paso el resto de los negocios siguen respondiendo mientras tanto.
export const PLAZO_MS = 5000;

// ── EL AVISO DE RECORTE ──────────────────────────────────────────────────────────────────────────
// Un resultado recortado que parece completo es el peor fallo posible aquí: DISA contestaría «tus
// cinco mejores clientes son…» sobre una lista cortada y lo daría por bueno. Así que el aviso viaja
// DENTRO del resultado que ve el modelo, en un campo que no se puede confundir con datos, y con el
// texto ya escrito — para que ningún camino se invente su propia forma de decirlo (ni se le olvide).
export const MOTIVO_RECORTE = {
  filas: 'RECORTADO: la consulta devolvía más filas de las que se pueden traer al chat. Aquí van solo las primeras '
       + MAX_FILAS + '. NO son todas: dilo al responder y ofrece afinar la consulta (filtrar, agrupar o pedir un periodo).',
};

export const MSG_PLAZO_AGOTADO =
  'La consulta ha tardado más de ' + (PLAZO_MS / 1000) + ' segundos y se ha cancelado. No se han traído datos. '
  + 'Suele pasar cuando cruza tablas grandes: dilo al responder y prueba con algo más acotado (menos tablas, un filtro o un periodo).';
