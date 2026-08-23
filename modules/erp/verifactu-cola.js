import { safeError } from '../../core/errors.js';
// ── VERI*FACTU · COLA DE ENVÍO AUTOMÁTICO POR NEGOCIO ────────────────────────────────────────
//
// Al emitir una factura, su registro de facturación queda con la huella CONGELADA (Tarea 1). La AEAT
// exige que `FechaHoraHusoGenRegistro` esté a ±240 s de SU reloj cuando recibe el registro; pasado
// ese margen lo acepta, pero "con errores" (código 2004). Medido en preproducción: 376 s →
// AceptadoConErrores; 0 s → Correcto. Así que el envío no puede depender de que alguien pulse un
// botón: tiene que salir solo, en segundos. Esta cola es esa pieza.
//
// ── Los DOS relojes (y por qué la cola agrupa) ──
//   · Ventana de la huella: 240 s desde que se emitió. Empuja a enviar YA.
//   · Control de flujo (art. 16.2 Orden HAC/1177/2024): entre envíos hay que esperar el
//     `TiempoEsperaEnvio` que devolvió la AEAT (t inicial = 60 s). Empuja a enviar DESPACIO.
// Un sobre por factura da un techo de 1 registro/60 s; en una ráfaga de mostrador la sexta factura
// llegaría fuera de ventana. Por eso cada vaciado manda TODO lo pendiente del negocio en UN sobre
// (1..1000 RegistroFactura, una sola Cabecera). Con eso, en calma la factura sale en segundos, y en
// ráfaga sale agrupada dentro del minuto: los dos relojes se cumplen a la vez.
//
// ── Qué NO hace ──
//   · No toca la huella, el QR ni el encadenado (Tarea 1 es inmutable).
//   · Nunca remite una anulación antes que su alta (ver PRECEDENCIA, más abajo): a la AEAT no se le
//     manda la baja de una factura que no conoce.
//   · No reenvía lo ya aceptado: reutiliza la idempotencia del motor (`yaAceptado`).
//   · No drena el pasado. Solo toca filas con `next_retry_at` no nulo, y solo la cola lo pone. Los
//     registros históricos (sin fila de envío) y los envíos manuales quedan intactos.
//   · No bloquea la emisión: se encola DESPUÉS del commit y cualquier fallo se traga. La factura se
//     emite igual; la remisión es un proceso aparte que se reintenta.
//
// ── Reintentos ──
// Solo se reintenta el fallo de COMUNICACIÓN (red caída, AEAT sin responder, SoapFault): es lo único
// que puede salir bien más tarde sin que nadie toque nada. Backoff 5s→15s→45s→135s→300s→300s y, al
// agotar los 6 intentos, estado terminal + AVISO (motor de avisos ya existente).
// Un rechazo de la AEAT ('incorrecto', p.ej. NIF no censado) NO se reintenta: el mismo XML da el
// mismo rechazo. Va directo a AVISO para que un humano corrija la factura.
// Pasados los 240 s el registro ya solo puede volver 'AceptadoConErrores', pero se sigue enviando:
// un registro remitido tarde es mejor que uno no remitido. Subsanarlo es otra pieza.
//
// ── Concurrencia ──
// La cola vive en el proceso de la app (uno solo, systemd), y un barrido de systemd la respalda por
// si el proceso muere entre encolar y enviar, o durante un backoff largo. Para que nunca envíen el
// mismo registro dos veces, reclamar una fila EMPUJA su `next_retry_at` al futuro (lease de 120 s)
// dentro de una transacción IMMEDIATE. El que no reclama, no envía.

import {
  enviarLote, getEnvio, yaAceptado, upsertEnvio, ESTADO,
  certStatusForTenant, certPassForTenant, sistemaInformaticoFaltantes,
} from './verifactu-envio.js';

export const MAX_INTENTOS = 6;                              // tras el 6º fallo de comunicación → terminal + aviso
export const BACKOFF_SEG = [5, 15, 45, 135, 300, 300];      // espera ANTES del intento n+1
export const ESPERA_DEFECTO_SEG = 60;                       // art. 16.2: t inicial = 60 s
export const LOTE_MAX = 1000;                               // 1..1000 RegistroFactura por envío (XSD)
export const LEASE_SEG = 120;                               // cerrojo entre procesos al reclamar
export const VENTANA_AEAT_SEG = 240;                        // margen de la huella (informativo, para avisos)
const TIMER_MAX_MS = 600_000;                               // nunca dormir más de 10 min sin reevaluar
const SLOP_MS = 250;                                        // que el timer no despierte un pelo antes de tiempo

const iso = ms => new Date(ms).toISOString();               // ISO-8601 UTC con Z, SIEMPRE (ver models.js)
const RETRIABLES = [ESTADO.PENDIENTE, ESTADO.ERROR_COM];

// El entorno por defecto es PRUEBAS. Apuntar a producción es un acto deliberado (VERIFACTU_ENTORNO),
// nunca un descuido de configuración.
const entornoPorDefecto = () => process.env.VERIFACTU_ENTORNO || 'pruebas';

// Válvula de escape para bancos de pruebas y staging: si VERIFACTU_ENDPOINT apunta a un simulador,
// TODA la cola (incluido el planificador) habla con él, no con la AEAT, y no hace falta certificado.
// Sin esta variable — el caso de producción — el endpoint sale de AEAT_ENDPOINTS[entorno].
const endpointPorDefecto = () => process.env.VERIFACTU_ENDPOINT || null;

// ── ¿Puede esta cola enviar por este negocio? Devuelve el MOTIVO de que no, o null si sí. ──
// Es la única puerta: si devuelve un motivo, no se encola, no se reintenta y no se genera ruido.
// Contra un endpoint que no es la AEAT (el simulador de los gates) no hace falta certificado.
// Sin `endpoint` explícito manda el del entorno, para que la pantalla y la cola nunca discrepen.
export function motivoColaInactiva(slug, endpoint = endpointPorDefecto()) {
  if (process.env.VERIFACTU_COLA === 'off') return 'La cola automática está apagada (VERIFACTU_COLA=off).';
  if (!slug) return 'Sin negocio identificado: la cola solo corre con el tenant resuelto.';

  const esAeat = !endpoint || /aeat\.es|agenciatributaria\.gob\.es/.test(endpoint);
  if (esAeat) {
    const cs = certStatusForTenant(slug);
    if (!cs.present) return cs.reason;
    if (certPassForTenant(slug) === undefined) {
      return 'Falta la contraseña del certificado en el entorno del servicio: el envío automático no puede abrirlo. Hasta configurarla, los registros esperan al envío manual.';
    }
  }
  const faltan = sistemaInformaticoFaltantes();
  if (faltan.length) return 'SistemaInformatico incompleto: ' + faltan.join(', ') + '.';
  return null;
}
export const colaActiva = (slug, endpoint) => motivoColaInactiva(slug, endpoint) === null;

// ── Reloj del control de flujo, DERIVADO DE LA BD (no de memoria) ────────────────────────────
// Momento (ms) a partir del cual este obligado puede volver a enviar. Se lee del último envío que de
// verdad llegó a la AEAT: `http_status` no nulo. Un fallo de red deja `http_status` NULL a propósito
// (no hubo envío → no consumió el turno), así que no penaliza. Vivir en la BD y no en una variable
// hace que un reinicio del proceso, o el barrido de systemd desde OTRO proceso, respeten el turno.
export function proximoEnvioPermitido(db, ahoraMs = Date.now()) {
  const ult = db.prepare(`SELECT enviado_at, tiempo_espera_envio FROM verifactu_envios
      WHERE enviado_at IS NOT NULL AND http_status IS NOT NULL
      ORDER BY enviado_at DESC LIMIT 1`).get();
  if (!ult) return 0;
  const desde = Date.parse(ult.enviado_at);
  if (!Number.isFinite(desde)) return 0;
  const t = Number(ult.tiempo_espera_envio) > 0 ? Number(ult.tiempo_espera_envio) : ESPERA_DEFECTO_SEG;
  return desde + t * 1000;
}

// ── PRECEDENCIA: una anulación NUNCA sale antes que su alta ──────────────────────────────────
// Regla legal antes que técnica: no se comunica la baja de una factura que la AEAT no conoce. Un
// registro de ALTA es elegible por sí mismo; uno de ANULACIÓN solo cuando el alta DE SU MISMA FACTURA
// consta ACEPTADA — 'correcto' o 'aceptado_con_errores', que son las dos formas de quedar registrado
// allí (el 2004 por huella caducada entra por la segunda, y el registro existe igual).
//
// Se comprueba DENTRO del SQL del reclamo, no con un paso posterior que suelte las que esperan. Esa
// era la alternativa y es peor: un paso de liberación hay que acordarse de llamarlo desde todos los
// sitios donde un alta pasa a aceptada, y el día que aparezca un sitio nuevo la anulación se queda
// dormida para siempre sin que nadie se entere. Aquí la fila está en la cola desde el primer día y
// simplemente NADIE se la lleva hasta que su alta esté aceptada; en cuanto lo está, el `programar`
// que corre al aterrizar cada sobre —y el barrido de systemd— la ven solas. No hay estado que soltar.
//
// El caso normal HOY es justo este: de las facturas anuladas que existen, NINGUNA tenía su alta
// remitida (medido el 23-ago-2026: 299 anuladas, 0 con alta aceptada). Así que este camino no es la
// esquina rara, es la carretera.
const ALTA_ACEPTADA_DE_LA_MISMA_FACTURA = `EXISTS (
        SELECT 1 FROM verifactu_registros ra
          JOIN verifactu_envios ea ON ea.registro_id = ra.id
         WHERE ra.invoice_id = r.invoice_id AND ra.record_type = 'alta'
           AND ea.estado IN ('${ESTADO.CORRECTO}', '${ESTADO.CON_ERRORES}'))`;
const ELEGIBLE_POR_TIPO = `(r.record_type = 'alta'
      OR (r.record_type = 'anulacion' AND ${ALTA_ACEPTADA_DE_LA_MISMA_FACTURA}))`;

// Momento (ms) del próximo registro que toca enviar, o null si no hay trabajo. Incluye los que están
// esperando su backoff: por eso la cola sabe despertarse sola sin depender del barrido.
export function proximoTrabajo(db) {
  const r = db.prepare(`SELECT MIN(e.next_retry_at) AS t FROM verifactu_envios e
      JOIN verifactu_registros r ON r.id = e.registro_id
     WHERE ${ELEGIBLE_POR_TIPO} AND e.next_retry_at IS NOT NULL
       AND e.estado IN (?, ?) AND e.intentos < ?`).get(...RETRIABLES, MAX_INTENTOS);
  if (!r || !r.t) return null;
  const ms = Date.parse(r.t);
  return Number.isFinite(ms) ? ms : null;
}

// ── Reclamo atómico (cerrojo entre procesos) ─────────────────────────────────────────────────
// Selecciona lo elegible y, en la MISMA transacción IMMEDIATE, empuja su next_retry_at al futuro
// (lease). Quien no consiga escribir, no se lleva las filas. Si el proceso muere con el lease puesto,
// a los 120 s las filas vuelven a ser elegibles solas: no hay estado que limpiar a mano.
export function reclamar(db, ahoraMs = Date.now(), limite = LOTE_MAX) {
  const ahora = iso(ahoraMs);
  const lease = iso(ahoraMs + LEASE_SEG * 1000);
  const tx = db.transaction(() => {
    const filas = db.prepare(`SELECT e.registro_id FROM verifactu_envios e
        JOIN verifactu_registros r ON r.id = e.registro_id
       WHERE ${ELEGIBLE_POR_TIPO} AND e.next_retry_at IS NOT NULL AND e.next_retry_at <= ?
         AND e.estado IN (?, ?) AND e.intentos < ?
       ORDER BY e.registro_id LIMIT ?`).all(ahora, ...RETRIABLES, MAX_INTENTOS, limite);
    const ids = filas.map(f => f.registro_id);
    if (ids.length) {
      db.prepare(`UPDATE verifactu_envios SET next_retry_at=? WHERE registro_id IN (${ids.map(() => '?').join(',')})`).run(lease, ...ids);
    }
    return ids;
  });
  return tx.immediate();
}

// Cuándo vuelve a tocar este registro tras un intento, o null si su estado es TERMINAL.
// Terminal = aceptado (nada que hacer), rechazado/bloqueado (lo tiene que arreglar un humano), o
// agotados los intentos de comunicación. Los tres casos los recoge el motor de avisos.
export function siguienteIntento(envio, ahoraMs) {
  if (!envio) return null;
  if (envio.estado !== ESTADO.ERROR_COM) return null;
  if (envio.intentos >= MAX_INTENTOS) return null;
  const espera = BACKOFF_SEG[Math.min(envio.intentos - 1, BACKOFF_SEG.length - 1)] ?? BACKOFF_SEG[BACKOFF_SEG.length - 1];
  return iso(ahoraMs + espera * 1000);
}

// ── Un vaciado: reclama lo pendiente del negocio y lo manda en UN sobre ──────────────────────
// No lanza: cualquier fallo vuelve como { error }. Nada de lo que pase aquí puede tumbar una emisión.
export async function vaciar(db, opts = {}) {
  const slug = opts.slug ?? db.bamburuSlug ?? null;
  const entorno = opts.entorno || entornoPorDefecto();
  const endpoint = opts.endpoint || endpointPorDefecto();

  const motivo = motivoColaInactiva(slug, endpoint);
  if (motivo) return { enviados: 0, motivo };

  const ahoraMs = opts.ahoraMs ?? Date.now();
  const permitido = proximoEnvioPermitido(db, ahoraMs);
  if (ahoraMs < permitido) return { enviados: 0, esperaHasta: permitido, motivo: 'control de flujo (art. 16.2)' };

  const ids = reclamar(db, ahoraMs, opts.limite ?? LOTE_MAX);
  if (!ids.length) return { enviados: 0 };

  let envios;
  try {
    envios = await enviarLote(db, ids, {
      entorno, slug, endpoint,
      cert: opts.cert, sistemaInfo: opts.sistemaInfo,
      now: opts.now, timeoutMs: opts.timeoutMs, rejectUnauthorized: opts.rejectUnauthorized,
    });
  } catch (e) {
    // El lote ni se construyó (p. ej. emisores mezclados). Se suelta el lease para que otro lo mire;
    // no se pierde nada y no se reintenta en bucle cerrado.
    const soltar = db.prepare('UPDATE verifactu_envios SET next_retry_at=? WHERE registro_id=?');
    const reintento = iso(ahoraMs + BACKOFF_SEG[0] * 1000);
    db.transaction(() => { for (const id of ids) soltar.run(reintento, id); }).immediate();
    return { enviados: 0, error: safeError(e) };
  }

  // Programar (o cerrar) cada registro según lo que dijo la AEAT.
  const marcar = db.prepare('UPDATE verifactu_envios SET next_retry_at=? WHERE registro_id=?');
  db.transaction(() => {
    for (const envio of envios) {
      if (!envio) continue;
      marcar.run(siguienteIntento(envio, ahoraMs), envio.registro_id);
    }
  }).immediate();

  const cuenta = e => envios.filter(x => x && x.estado === e).length;
  return {
    // `procesados` incluye los que NO salieron (bloqueado_datos): se reclamaron y se resolvieron.
    // Lo que de verdad llegó a la AEAT es `aceptados` + `rechazados`.
    procesados: ids.length,
    enviados: ids.length,
    aceptados: cuenta(ESTADO.CORRECTO) + cuenta(ESTADO.CON_ERRORES),
    correctos: cuenta(ESTADO.CORRECTO),
    conErrores: cuenta(ESTADO.CON_ERRORES),
    rechazados: cuenta(ESTADO.INCORRECTO),
    bloqueados: cuenta(ESTADO.BLOQUEADO),
    fallos: cuenta(ESTADO.ERROR_COM),
    envios,
  };
}

// ── Planificador en proceso (uno por negocio) ────────────────────────────────────────────────
// `enVuelo` garantiza un solo sobre en el aire por negocio. Node es de un hilo y better-sqlite3 es
// síncrono, así que un `encolar` no puede interponerse entre la lectura de trabajo de `programar` y
// el armado del timer: no hay carrera que cubrir con cerrojos aquí dentro (entre PROCESOS sí, y de
// eso se ocupa el lease del reclamo).
const colas = new Map();   // slug → { timer, enVuelo }
const estadoDe = slug => { let c = colas.get(slug); if (!c) colas.set(slug, c = { timer: null, enVuelo: false }); return c; };

export function programar(db, slug, opts = {}) {
  if (!slug || motivoColaInactiva(slug, opts.endpoint || endpointPorDefecto())) return;
  const c = estadoDe(slug);
  if (c.timer) { clearTimeout(c.timer); c.timer = null; }   // siempre re-arma con el cálculo más fresco
  if (c.enVuelo) return;                                    // el vuelo en curso reprograma al aterrizar

  const trabajo = proximoTrabajo(db);
  if (trabajo === null) return;                             // nada que enviar: la cola se apaga sola

  const ahoraMs = Date.now();
  const cuando = Math.max(trabajo, proximoEnvioPermitido(db, ahoraMs));
  const espera = Math.min(Math.max(0, cuando - ahoraMs) + SLOP_MS, TIMER_MAX_MS);

  c.timer = setTimeout(() => {
    c.timer = null;
    c.enVuelo = true;
    Promise.resolve()
      .then(() => vaciar(db, { ...opts, slug }))
      .catch(() => { /* vaciar ya no lanza; red de seguridad */ })
      .finally(() => { c.enVuelo = false; programar(db, slug, opts); });
  }, espera);
  c.timer.unref?.();     // un timer de la cola nunca debe impedir que un script o un test terminen
}

// ── Enganche desde la emisión (post-commit) ──────────────────────────────────────────────────
// Se llama con la factura YA confirmada. Devuelve true si el registro quedó encolado. Nunca lanza:
// si la cola no puede con ello, el registro se queda como hasta ahora (esperando el botón "Enviar").
export function encolarSiProcede(db, registroId) {
  try {
    const slug = db.bamburuSlug ?? null;
    if (!registroId || motivoColaInactiva(slug)) return false;
    if (yaAceptado(getEnvio(db, registroId))) return false;

    // Fila de envío en 'pendiente' y elegible YA. Crearla aquí (y no al enviar) es lo que hace la cola
    // resistente a un reinicio: si el proceso muere ahora mismo, el barrido de systemd la encuentra.
    db.prepare(`INSERT INTO verifactu_envios (registro_id, estado, next_retry_at, created_at, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(registro_id) DO UPDATE SET next_retry_at=excluded.next_retry_at, updated_at=CURRENT_TIMESTAMP`)
      .run(registroId, ESTADO.PENDIENTE, iso(Date.now()));

    programar(db, slug);
    return true;
  } catch {
    return false;   // la emisión de la factura manda: la remisión nunca la tumba
  }
}

// ── Enganche desde la ANULACIÓN (post-commit) ────────────────────────────────────────────────
// Se llama con la anulación YA confirmada: el registro de anulación existe, está encadenado y su
// huella está congelada (Tarea 1). Esto decide únicamente QUÉ SE HACE CON SU REMISIÓN, y son cuatro
// situaciones distintas con cuatro comportamientos distintos. Nunca lanza: la factura ya está
// anulada en local pase lo que pase aquí — igual que la emisión, la remisión no la puede tumbar.
//
// El cuarto caso del encargo —"ya anulada"— no se decide aquí: lo corta `anularInvoice` antes de
// llegar, exigiendo que la factura esté 'emitida'. Una factura no se anula dos veces, así que un
// segundo registro de anulación no llega a existir.
export const CASO_ANULACION = {
  ALTA_ACEPTADA:  'alta_aceptada',    // 1 — la AEAT conoce la factura → se encola normalmente
  ALTA_PENDIENTE: 'alta_pendiente',   // 2 — el alta aún no ha salido → se encola DETRÁS de ella (el caso normal hoy)
  ALTA_RECHAZADA: 'alta_rechazada',   // 3 — la AEAT rechazó el alta → no hay nada que anular allí; se anota y no se encola
  SIN_ALTA:       'sin_alta',         // factura sin registro de alta (anterior a la implantación de la Tarea 1)
};

export const AVISO_ANULACION = {
  [CASO_ANULACION.ALTA_PENDIENTE]: 'La anulación espera en la cola a que la AEAT acepte el alta de esta factura: no se remite la baja de una factura que Hacienda todavía no conoce. Sale sola en cuanto el alta esté aceptada.',
  [CASO_ANULACION.ALTA_RECHAZADA]: 'La AEAT rechazó el alta de esta factura, así que allí no hay nada que anular. La anulación queda registrada y encadenada en local, pero NO se remite.',
  [CASO_ANULACION.SIN_ALTA]: 'Esta factura no tiene registro de facturación de alta (es anterior a la implantación del registro Verifactu), así que la AEAT no la conoce y su anulación no se puede remitir. Queda registrada y encadenada en local.',
};

export function encolarAnulacionSiProcede(db, registroId) {
  try {
    if (!registroId) return { caso: null, encolado: false, aviso: null };
    const reg = db.prepare("SELECT * FROM verifactu_registros WHERE id=? AND record_type='anulacion'").get(registroId);
    if (!reg) return { caso: null, encolado: false, aviso: null };

    // El alta DE SU MISMA FACTURA y cómo le fue. `getEnvio` devuelve null si nunca se intentó.
    const alta = db.prepare("SELECT id FROM verifactu_registros WHERE invoice_id=? AND record_type='alta' ORDER BY id LIMIT 1").get(reg.invoice_id);
    const envAlta = alta ? getEnvio(db, alta.id) : null;

    const caso = !alta ? CASO_ANULACION.SIN_ALTA
      : envAlta && envAlta.estado === ESTADO.INCORRECTO ? CASO_ANULACION.ALTA_RECHAZADA
      : yaAceptado(envAlta) ? CASO_ANULACION.ALTA_ACEPTADA
      : CASO_ANULACION.ALTA_PENDIENTE;
    const aviso = AVISO_ANULACION[caso] || null;

    // Casos 3 y "sin alta": SE ANOTA Y NO SE ENCOLA. La anotación se hace siempre, esté la cola
    // activa o no, porque no es una acción de envío: es dejar escrito por qué esto no va a salir
    // nunca. `next_retry_at` se queda NULL, que es lo que en esta cola significa "no es mía".
    if (caso === CASO_ANULACION.ALTA_RECHAZADA || caso === CASO_ANULACION.SIN_ALTA) {
      upsertEnvio(db, registroId, { estado: ESTADO.BLOQUEADO, aviso });
      return { caso, encolado: false, aviso };
    }

    // Casos 1 y 2: la anulación entra en la cola. La fila se crea SIEMPRE (así la anulación es
    // consultable en la pantalla de envíos desde el primer momento, y el botón manual la alcanza);
    // lo que decide si la cola automática es su dueña es `next_retry_at`, y ese solo se pone si la
    // cola puede enviar por este negocio. Sin cola activa se comporta exactamente como un alta hoy:
    // la fila espera al envío manual.
    const slug = db.bamburuSlug ?? null;
    const activa = motivoColaInactiva(slug) === null;
    upsertEnvio(db, registroId, { estado: ESTADO.PENDIENTE, aviso });
    if (!activa) return { caso, encolado: false, aviso };

    // Elegible YA. Que salga o no lo decide la PRECEDENCIA en el reclamo: en el caso 2 la fila está
    // en la cola pero nadie se la lleva hasta que su alta conste aceptada. No hay que soltarla luego.
    db.prepare('UPDATE verifactu_envios SET next_retry_at=?, updated_at=CURRENT_TIMESTAMP WHERE registro_id=?')
      .run(iso(Date.now()), registroId);

    programar(db, slug);
    return { caso, encolado: true, aviso };
  } catch {
    return { caso: null, encolado: false, aviso: null };   // la anulación manda: la remisión nunca la tumba
  }
}

// Barrido de un negocio (lo usa el timer de systemd). Vacía en tandas mientras el control de flujo lo
// permita, para que un backlog acumulado tras una caída no se quede a medias.
export async function barrer(db, opts = {}) {
  const res = { tandas: 0, enviados: 0, aceptados: 0, fallos: 0, motivo: null };
  for (let i = 0; i < (opts.maxTandas ?? 5); i++) {
    const r = await vaciar(db, opts);
    if (r.motivo) { res.motivo = r.motivo; break; }
    if (!r.enviados) break;
    res.tandas++; res.enviados += r.enviados; res.aceptados += r.aceptados || 0; res.fallos += r.fallos || 0;
    if (proximoTrabajo(db) === null) break;
    if (Date.now() < proximoEnvioPermitido(db)) break;   // toca esperar turno: lo coge el siguiente barrido
  }
  return res;
}

// Solo para pruebas: desarma los timers vivos (que un gate no deje el proceso colgado).
export function detenerTodo() {
  for (const c of colas.values()) { if (c.timer) clearTimeout(c.timer); c.timer = null; }
  colas.clear();
}
