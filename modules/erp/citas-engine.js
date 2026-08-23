// ESCALERA · PASO 7 · PIEZA 5 — MOTOR DE CITAS (lógica PURA, salvo lecturas de BD explícitas).
//
// Aquí vive el cálculo que no debe repetirse en dos sitios: resolver el horario de un día (semana +
// excepción, con la EXCEPCIÓN MANDANDO), calcular los HUECOS en vivo (horario − citas − márgenes,
// devolviendo LIBRE el tiempo muerto interior de otra cita), la GUARDA DE SOLAPE en servidor (misma
// persona o mismo recurso pisándose = conflicto; el tiempo muerto interior es la única excepción, y
// solo para la PERSONA: la silla/cabina sigue ocupada mientras el tinte reposa), y los saltos de estado.
//
// TIEMPO: todo en MINUTOS desde medianoche (enteros), en hora LOCAL del negocio (Europe/Madrid). La
// aritmética no toca husos ni DST; la zona solo se usa para resolver "hoy"/"ahora" (ahoraLocal). Las
// funciones de cálculo reciben ese "ahora" como argumento → son deterministas y testables sin reloj.

export const ZONA_NEGOCIO = 'Europe/Madrid';

// Cuando el negocio AÚN NO ha configurado ningún horario, la agenda funciona con un DÍA ABIERTO por
// defecto (8:00–21:00) para no exigir configuración antes de poder reservar (regla "el software
// trabaja"). Configurar Horarios RESTRINGE este default; en cuanto hay UN tramo de negocio el default
// desaparece (el negocio ya dijo cuándo abre). Una excepción "cerrado" sigue mandando siempre.
export const DEFAULT_OPEN = [8 * 60, 21 * 60];
export function hayHorarioNegocio(db) {
  return db.prepare("SELECT 1 FROM horario_tramos WHERE scope='negocio' LIMIT 1").get() != null;
}

// ── helpers de tiempo ────────────────────────────────────────────────────────────────────────────
export function hhmm(min) {
  min = Math.max(0, Math.round(min));
  const h = Math.floor(min / 60), m = min % 60;
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}
export function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const h = +m[1], mm = +m[2];
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}
// Solape de dos intervalos SEMIABIERTOS [a1,a2) y [b1,b2): tocar por el borde NO es solapar.
export function overlaps(a1, a2, b1, b2) { return a1 < b2 && b1 < a2; }

// "hoy"/"ahora" en la zona del negocio → { fecha:'YYYY-MM-DD', min: minutosDesdeMedianoche, dow:0-6 }.
// 'en-CA' da 'YYYY-MM-DD'; dow con getDay-equivalente vía Intl weekday.
export function ahoraLocal(tz = ZONA_NEGOCIO, now = new Date()) {
  const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const [h, m] = hm.split(':').map(Number);
  return { fecha, min: (h % 24) * 60 + m, dow: dowDeFecha(fecha) };
}
// Día de la semana (0=domingo … 6=sábado, como JS Date.getDay) de una fecha 'YYYY-MM-DD', sin husos.
export function dowDeFecha(fecha) {
  const [y, mo, d] = String(fecha).split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}
// Días entre dos fechas 'YYYY-MM-DD' (a − b), en UTC (mismo criterio que avisos/cobros).
export function diasEntre(a, b) {
  return Math.floor((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
}
// Une intervalos [ini,fin) solapados/contiguos en una lista mínima ordenada.
export function fusiona(intervalos) {
  const xs = intervalos.filter(x => x[1] > x[0]).slice().sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [i, f] of xs) {
    if (out.length && i <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], f);
    else out.push([i, f]);
  }
  return out;
}
// Resta a un conjunto de intervalos abiertos (base) los ocupados: base − ocupados.
export function resta(base, ocupados) {
  const occ = fusiona(ocupados);
  let libres = base.map(x => [x[0], x[1]]);
  for (const [oi, of] of occ) {
    const next = [];
    for (const [li, lf] of libres) {
      if (of <= li || oi >= lf) { next.push([li, lf]); continue; }   // no toca
      if (oi > li) next.push([li, oi]);
      if (of < lf) next.push([of, lf]);
    }
    libres = next;
  }
  return libres.filter(x => x[1] > x[0]);
}

// ── 1.3 HORARIOS — resolución de los tramos abiertos de un día (LA EXCEPCIÓN MANDA) ────────────────
// Devuelve [[ini,fin),…] para un ámbito (negocio o una persona) en una fecha concreta. Si hay
// excepción para ese ámbito+fecha, IGNORA la regla semanal: 'cerrado' → []; 'horario' → sus tramos.
export function tramosAmbito(db, scope, userId, fecha) {
  const dow = dowDeFecha(fecha);
  const exc = db.prepare(
    `SELECT tipo, inicio_min, fin_min FROM horario_excepciones
      WHERE scope=? AND ${userId == null ? 'user_id IS NULL' : 'user_id=?'} AND fecha=?`
  ).all(...(userId == null ? [scope, fecha] : [scope, userId, fecha]));
  if (exc.length) {
    if (exc.some(e => e.tipo === 'cerrado')) return [];
    return fusiona(exc.filter(e => e.tipo === 'horario' && e.inicio_min != null && e.fin_min != null).map(e => [e.inicio_min, e.fin_min]));
  }
  const rows = db.prepare(
    `SELECT inicio_min, fin_min FROM horario_tramos
      WHERE scope=? AND ${userId == null ? 'user_id IS NULL' : 'user_id=?'} AND dow=?`
  ).all(...(userId == null ? [scope, dow] : [scope, userId, dow]));
  const tr = fusiona(rows.map(r => [r.inicio_min, r.fin_min]));
  // Negocio sin ningún horario configurado → día abierto por defecto (ver DEFAULT_OPEN).
  if (!tr.length && scope === 'negocio' && !hayHorarioNegocio(db)) return [DEFAULT_OPEN.slice()];
  return tr;
}

// ¿Tiene esta persona un horario propio definido (algún tramo semanal)? Si NO, hereda el del negocio.
function personaTieneHorario(db, userId) {
  return db.prepare(`SELECT 1 FROM horario_tramos WHERE scope='user' AND user_id=? LIMIT 1`).get(userId) != null;
}

// Tramos ABIERTOS de una PERSONA en una fecha = (su horario propio o, si no tiene, el del negocio)
// ∩ el del negocio (nadie está disponible con el negocio cerrado). Con las excepciones de cada ámbito
// ya aplicadas dentro de tramosAmbito.
export function tramosPersona(db, userId, fecha) {
  const negocio = tramosAmbito(db, 'negocio', null, fecha);
  if (!negocio.length) return [];
  // Excepción de la persona (vacaciones/festivo propio) manda aunque herede el horario del negocio.
  const excPersona = db.prepare(
    `SELECT tipo, inicio_min, fin_min FROM horario_excepciones WHERE scope='user' AND user_id=? AND fecha=?`
  ).all(userId, fecha);
  let propios;
  if (excPersona.length) {
    if (excPersona.some(e => e.tipo === 'cerrado')) return [];
    propios = fusiona(excPersona.filter(e => e.tipo === 'horario' && e.inicio_min != null && e.fin_min != null).map(e => [e.inicio_min, e.fin_min]));
  } else if (personaTieneHorario(db, userId)) {
    const dow = dowDeFecha(fecha);
    const rows = db.prepare(`SELECT inicio_min, fin_min FROM horario_tramos WHERE scope='user' AND user_id=? AND dow=?`).all(userId, dow);
    propios = fusiona(rows.map(r => [r.inicio_min, r.fin_min]));
  } else {
    propios = negocio;   // sin horario propio → hereda el del negocio
  }
  return interseca(propios, negocio);
}

// Intersección de dos conjuntos de intervalos.
export function interseca(a, b) {
  const out = [];
  for (const [ai, af] of fusiona(a)) for (const [bi, bf] of fusiona(b)) {
    const i = Math.max(ai, bi), f = Math.min(af, bf);
    if (f > i) out.push([i, f]);
  }
  return fusiona(out);
}

// ── Ocupación (citas + bloqueos) ───────────────────────────────────────────────────────────────
// Intervalos en que la PERSONA está ocupada ese día: por cada servicio de cada cita viva, su tramo
// MENOS su ventana de tiempo muerto interior (ahí la persona está libre), más el margen posterior de
// la cita (limpieza/cobro). Excluye anuladas/archivadas y, opcionalmente, una cita (para revalidar
// al mover). `bloqueos` de persona cuentan enteros.
export function ocupacionPersona(db, userId, fecha, excludeCitaId = null) {
  const citas = db.prepare(
    `SELECT id, inicio_min, dur_min, margen_min FROM citas
      WHERE user_id=? AND fecha=? AND estado NOT IN ('anulada') AND archived=0 ${excludeCitaId ? 'AND id<>?' : ''}`
  ).all(...(excludeCitaId ? [userId, fecha, excludeCitaId] : [userId, fecha]));
  const ocup = [];
  for (const cita of citas) {
    const svcs = db.prepare(`SELECT offset_min, dur_min, muerto_ini_min, muerto_dur_min FROM cita_servicios WHERE cita_id=?`).all(cita.id);
    if (svcs.length) {
      for (const s of svcs) {
        const sIni = cita.inicio_min + s.offset_min, sFin = sIni + s.dur_min;
        if (s.muerto_dur_min > 0) {
          const mIni = sIni + s.muerto_ini_min, mFin = mIni + s.muerto_dur_min;
          if (mIni > sIni) ocup.push([sIni, Math.min(mIni, sFin)]);   // antes del hueco muerto
          if (mFin < sFin) ocup.push([Math.max(mFin, sIni), sFin]);   // después del hueco muerto
        } else ocup.push([sIni, sFin]);
      }
    } else {
      ocup.push([cita.inicio_min, cita.inicio_min + cita.dur_min]);   // cita sin líneas (bloque simple)
    }
    if (cita.margen_min > 0) ocup.push([cita.inicio_min + cita.dur_min, cita.inicio_min + cita.dur_min + cita.margen_min]);
  }
  const bloqs = db.prepare(`SELECT inicio_min, fin_min FROM agenda_bloqueos WHERE user_id=? AND fecha=?`).all(userId, fecha);
  for (const b of bloqs) ocup.push([b.inicio_min, b.fin_min]);
  return fusiona(ocup);
}

// Intervalos en que el RECURSO está ocupado ese día: la cita ENTERA (inicio → fin + margen), sin
// excepción de tiempo muerto (la silla/cabina no se libera mientras el tinte reposa). Más sus bloqueos.
export function ocupacionRecurso(db, recursoId, fecha, excludeCitaId = null) {
  const citas = db.prepare(
    `SELECT inicio_min, dur_min, margen_min FROM citas
      WHERE recurso_id=? AND fecha=? AND estado NOT IN ('anulada') AND archived=0 ${excludeCitaId ? 'AND id<>?' : ''}`
  ).all(...(excludeCitaId ? [recursoId, fecha, excludeCitaId] : [recursoId, fecha]));
  const ocup = citas.map(c => [c.inicio_min, c.inicio_min + c.dur_min + c.margen_min]);
  const bloqs = db.prepare(`SELECT inicio_min, fin_min FROM agenda_bloqueos WHERE recurso_id=? AND fecha=?`).all(recursoId, fecha);
  for (const b of bloqs) ocup.push([b.inicio_min, b.fin_min]);
  return fusiona(ocup);
}

// ── 1.4 HUECOS CALCULADOS EN VIVO ────────────────────────────────────────────────────────────────
// Devuelve las horas de inicio válidas (minutos) para una cita de duración dur+margen, con una
// persona y (opcional) un recurso, en una rejilla dada, respetando antelación mínima, ventana máxima
// y corte del mismo día. `ahora` = { fecha, min } en la zona del negocio (lo calcula ahoraLocal).
export function huecos(db, opts) {
  const { fecha, user_id, recurso_id = null, dur_min, margen_min = 0, ahora } = opts;
  const grid = Math.max(5, opts.grid || 30);
  const antelacion = Math.max(0, opts.antelacion_min || 0);
  const ventanaDias = opts.ventana_dias == null ? 3650 : opts.ventana_dias;
  const corteMin = opts.corte_mismo_dia_min == null ? null : opts.corte_mismo_dia_min;
  const total = dur_min + margen_min;
  if (total <= 0) return [];

  // Ventana máxima y días pasados.
  const dd = diasEntre(fecha, ahora.fecha);
  if (dd < 0 || dd > ventanaDias) return [];
  // Corte del mismo día: si es hoy y ya pasó la hora de corte, no hay huecos hoy.
  if (dd === 0 && corteMin != null && ahora.min >= corteMin) return [];

  // Tramos abiertos de la persona, y si hay recurso, intersecados con el horario del negocio (el
  // recurso está disponible cuando el negocio abre).
  let base = tramosPersona(db, user_id, fecha);
  if (recurso_id != null) base = interseca(base, tramosAmbito(db, 'negocio', null, fecha));
  if (!base.length) return [];

  const ocupP = ocupacionPersona(db, user_id, fecha);
  const ocupR = recurso_id != null ? ocupacionRecurso(db, recurso_id, fecha) : [];
  const libresP = resta(base, ocupP);
  const libres = recurso_id != null ? resta(libresP, ocupR) : libresP;

  const minInicioHoy = dd === 0 ? ahora.min + antelacion : (dd > 0 ? -1 : Infinity);
  const out = [];
  for (const [li, lf] of libres) {
    // Alinear el primer arranque a la rejilla dentro del tramo libre.
    let s = Math.ceil(li / grid) * grid;
    for (; s + total <= lf; s += grid) {
      if (dd === 0 && s < minInicioHoy) continue;   // antelación mínima / ya pasó
      out.push(s);
    }
  }
  return out;
}

// ── 1.6 GUARDA DE SOLAPE EN SERVIDOR ─────────────────────────────────────────────────────────────
// Comprueba que una cita (nueva o movida) no pisa a otra por PERSONA ni por RECURSO. El tiempo muerto
// interior es la única excepción, y solo para la persona (ver ocupacionPersona/ocupacionRecurso).
// `servicios` = [{ offset_min, dur_min, muerto_ini_min, muerto_dur_min }] ya geometrizados.
// Devuelve { ok:true } o { ok:false, motivo, campo } (el llamador responde 409).
export function comprobarSolape(db, c) {
  const { user_id, recurso_id = null, fecha, inicio_min, dur_min, margen_min = 0, servicios = [], excludeCitaId = null } = c;
  // Intervalos que la NUEVA cita ocupa para la persona (servicio − tiempo muerto) + margen.
  const nuevaP = [];
  if (servicios.length) {
    for (const s of servicios) {
      const sIni = inicio_min + s.offset_min, sFin = sIni + s.dur_min;
      if (s.muerto_dur_min > 0) {
        const mIni = sIni + s.muerto_ini_min, mFin = mIni + s.muerto_dur_min;
        if (mIni > sIni) nuevaP.push([sIni, Math.min(mIni, sFin)]);
        if (mFin < sFin) nuevaP.push([Math.max(mFin, sIni), sFin]);
      } else nuevaP.push([sIni, sFin]);
    }
  } else nuevaP.push([inicio_min, inicio_min + dur_min]);
  if (margen_min > 0) nuevaP.push([inicio_min + dur_min, inicio_min + dur_min + margen_min]);

  const ocupP = ocupacionPersona(db, user_id, fecha, excludeCitaId);
  for (const [ni, nf] of fusiona(nuevaP)) for (const [oi, of] of ocupP)
    if (overlaps(ni, nf, oi, of)) return { ok: false, motivo: 'La persona ya tiene otra cita a esa hora.', campo: 'persona' };

  if (recurso_id != null) {
    const nuevaR = [[inicio_min, inicio_min + dur_min + margen_min]];
    const ocupR = ocupacionRecurso(db, recurso_id, fecha, excludeCitaId);
    for (const [ni, nf] of nuevaR) for (const [oi, of] of ocupR)
      if (overlaps(ni, nf, oi, of)) return { ok: false, motivo: 'El recurso ya está ocupado a esa hora.', campo: 'recurso' };
  }
  return { ok: true };
}

// ── Geometría de una cadena de servicios ─────────────────────────────────────────────────────────
// A partir de los service_config (en el orden elegido), calcula offsets encadenados, duración total y
// margen posterior (el del ÚLTIMO servicio: la limpieza es al terminar la cita). Congela la geometría.
export function geometriaCadena(configs) {
  let offset = 0;
  const servicios = [];
  for (const cfg of configs) {
    const dur = Math.max(0, cfg.duracion_min || 0);
    servicios.push({
      product_id: cfg.product_id,
      offset_min: offset,
      dur_min: dur,
      muerto_ini_min: Math.max(0, Math.min(cfg.muerto_ini_min || 0, dur)),
      muerto_dur_min: Math.max(0, Math.min(cfg.muerto_dur_min || 0, Math.max(0, dur - (cfg.muerto_ini_min || 0)))),
    });
    offset += dur;
  }
  const margen = configs.length ? Math.max(0, configs[configs.length - 1].margen_min || 0) : 0;
  return { servicios, dur_total: offset, margen_min: margen };
}

// ── Estados y sus saltos ─────────────────────────────────────────────────────────────────────────
export const ESTADOS = ['pedida', 'confirmada', 'atendida', 'no_show', 'anulada'];
export const ESTADO_LABEL = { pedida: 'Pedida', confirmada: 'Confirmada', atendida: 'Atendida', no_show: 'No se presentó', anulada: 'Anulada' };

// ── QUIÉN ANULÓ (cabo 4 de la TAREA 2) — la lista vive AQUÍ, no en una ruta ────────────────────
// Tres valores y ni uno más. Cada camino de anulación dice el suyo; el que no puede saberlo (una
// caducidad automática) dice 'automatico', que es la verdad y no un hueco. Lo que NUNCA se hace es
// rellenarlo solo con un valor por defecto: una anulación sin autor conocido se queda en NULL y se
// enseña como «Sin registrar» — a las anteriores al cambio no se les inventa autor.
//
// POR QUÉ SE MUDÓ AQUÍ el 23 ago 2026: las etiquetas estaban escritas DOS veces —una en el
// JavaScript de la pantalla de la agenda y otra a punto de escribirse en el constructor de
// informes—, y dos copias de una lista son dos listas: el día que una cambie, la otra se queda
// vieja en silencio. `citas-engine.js` no importa nada, así que puede leerlo todo el mundo.
export const ANULADA_POR = ['cliente', 'negocio', 'automatico'];
export const ANULADA_POR_LABEL = {
  cliente: 'El cliente', negocio: 'El negocio', automatico: 'Caducó sola, sin respuesta',
};
export const ANULADA_POR_SIN = 'Sin registrar';
const TRANSICIONES = {
  pedida:     ['confirmada', 'atendida', 'no_show', 'anulada'],
  confirmada: ['atendida', 'no_show', 'anulada'],
  atendida:   ['anulada'],   // se puede anular una atendida (revierte el cobro por su motor); NETO-CERO
  no_show:    ['anulada'],
  anulada:    [],
};
export function puedeTransicionar(from, to) {
  if (from === to) return true;
  return (TRANSICIONES[from] || []).includes(to);
}
