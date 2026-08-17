// ════════════════════════════════════════════════════════════════════════════
// EL VIGÍA APRENDE DE AGENDA — Escalera · peldaño 8 · PIEZA 3.
//
// Cuatro detectores nuevos para el vigía del peldaño 5. Misma regla de oro que el resto del vigía:
// AQUÍ NO SE HACEN CUENTAS PROPIAS. Cada cifra sale del motor que la posee —el de citas
// (citas-engine.js), el mismo que pinta la agenda y la puerta pública— y este fichero solo MARCA lo
// que cruza un umbral y redacta el porqué.
//
// SOLO LECTURA: ni un INSERT, ni un UPDATE, ni una columna nueva. Se calcula en vivo, como el resto
// del vigía; nada se persiste.
//
// ── POR QUÉ LA OCUPACIÓN NO SALE DE huecos() ─────────────────────────────────────────────────────
// El encargo pedía sacar los huecos de `huecos()`, "el mismo motor que pinta la agenda". No se puede,
// y no es un matiz: `huecos()` responde a OTRA pregunta. Responde "¿dónde cabe un servicio de X
// minutos para la persona Y?" y devuelve MINUTOS DE INICIO alineados a la rejilla. Tres consecuencias:
//   · necesita una duración, y aquí no hay servicio elegido (mismo problema que ya tuvo la vista de
//     mes de la pieza 2, que lo dejó escrito en routes/citas.js);
//   · sus resultados SE SOLAPAN — un bloque libre de 3 h con rejilla de 30 min da 6 inicios, que no
//     son 6 horas libres —, así que sumarlos daría una cifra falsa;
//   · y no coincidiría con la agenda, que dibuja RANGO menos CITAS.
// Se usan por tanto las mismas piezas un escalón más abajo —`tramosPersona` (el horario real de cada
// quien) y `ocupacionPersona` (lo que ya está pillado, con sus márgenes y tiempos muertos)—, que son
// EXACTAMENTE las que `huecos()` llama por dentro. Sigue siendo el motor de citas: no hay cálculo
// paralelo. Y es la única forma de que las horas libres del aviso salgan idénticas, al minuto, a las
// que enseña la agenda de ese día. (Decisión del dueño, 17 ago 2026.)
//
// ── SI EL NEGOCIO NO USA AGENDA, ESTOS DETECTORES CALLAN ─────────────────────────────────────────
// No es cortesía, es lo que los hace viables. Sin horario configurado, el motor abre TODOS los días
// de 8:00 a 21:00 (`DEFAULT_OPEN`, decisión deliberada de la pieza 5 para no exigir configuración
// antes de poder reservar). Un negocio que jamás toca la agenda tendría 13 h libres por persona y por
// día, todos los días: el detector A sería una máquina de ruido perpetuo. La guarda es doble —sin
// horario de negocio Y sin ninguna cita— para que un negocio que sí usa la agenda pero aún no ha
// configurado horarios siga vigilado.

import {
  tramosPersona, ocupacionPersona, resta, interseca, hhmm, hayHorarioNegocio,
} from './citas-engine.js';

const DIA = 86400000;
const sumaMin = tramos => tramos.reduce((n, [a, b]) => n + (b - a), 0);
const diasEntreISO = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / DIA);
const masDias = (fecha, n) => new Date(Date.parse(fecha + 'T00:00:00Z') + n * DIA).toISOString().slice(0, 10);

// Mediana (no media: robusta a la visita rara que dispara el promedio). Mismo criterio que
// `umbralDormido` en ventas-metrics.js — el ritmo de una persona no se aprende con promedios.
function mediana(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ── UMBRALES ─────────────────────────────────────────────────────────────────────────────────────
// Fijos y con nombre, como los del vigía: ajustarlos es leer una línea. Esta pieza no trae pantalla
// de configuración (sería otro encargo).
export const OCUPACION_FLOJA_PCT = 60;   // A: por debajo de este % de ocupación, el día está flojo
export const DIAS_VISTA          = 3;    // A: cuántos días ABIERTOS se miran hacia delante
export const RITMO_FACTOR        = 1.5;  // B: se avisa al pasar 1,5 veces el ritmo propio
export const RITMO_MIN_CITAS     = 3;    // B: con menos citas atendidas NO se inventa ritmo
export const SIN_PROXIMA_DIAS    = 7;    // C: atendido en los últimos N días y sin cita futura
export const AUSENCIA_DIAS       = 30;   // D: no_show en los últimos N días

// ── ¿ESTE NEGOCIO USA LA AGENDA? ─────────────────────────────────────────────────────────────────
export function usaAgenda(db) {
  try {
    if (hayHorarioNegocio(db)) return true;
    return db.prepare("SELECT 1 FROM citas WHERE archived=0 LIMIT 1").get() != null;
  } catch { return false; }   // tenant sin el esquema de citas todavía
}

const personasActivas = db => {
  try { return db.prepare('SELECT id, name FROM admin_users WHERE active=1 ORDER BY id').all(); }
  catch { return []; }
};

// ── OCUPACIÓN DE UN DÍA ──────────────────────────────────────────────────────────────────────────
// Por persona: su horario real de ese día (`tramosPersona`) menos lo que ya tiene pillado
// (`ocupacionPersona`). Lo ocupado se INTERSECA con el horario antes de sumar: una cita que se sale
// del horario (posible: el motor deja crear fuera de horas) no puede hacer que la ocupación pase del
// 100 % ni restar horas libres que nunca existieron.
export function ocupacionDia(db, fecha) {
  let abierto = 0, ocupado = 0, abre = false;
  const libresPorPersona = [];
  for (const p of personasActivas(db)) {
    const base = tramosPersona(db, p.id, fecha);
    if (!base.length) continue;                       // esa persona no trabaja ese día
    abre = true;
    const dentro = interseca(ocupacionPersona(db, p.id, fecha), base);
    const libres = resta(base, dentro);
    abierto += sumaMin(base);
    ocupado += sumaMin(dentro);
    if (libres.length) {
      libresPorPersona.push({
        user_id: p.id, nombre: p.name,
        libre_min: sumaMin(libres),
        tramos: libres.map(([a, b]) => ({ desde: hhmm(a), hasta: hhmm(b), min: b - a })),
      });
    }
  }
  const libre = Math.max(0, abierto - ocupado);
  return {
    fecha, abre, abierto_min: abierto, ocupado_min: ocupado, libre_min: libre,
    pct: abierto > 0 ? Math.round(ocupado / abierto * 100) : 0,
    personas: libresPorPersona,
  };
}

// Los próximos N días ABIERTOS a partir de MAÑANA. Mañana y no hoy: el hueco de esta mañana ya se
// perdió, y contarlo como libre sería contar como oportunidad algo que ya no lo es. Se miran hasta
// 30 días naturales para encontrar los N abiertos (un negocio que abre dos días por semana también
// tiene derecho a su aviso); si no aparecen, se devuelven los que haya.
export function proximosDiasAbiertos(db, hoy, n = DIAS_VISTA) {
  const out = [];
  for (let i = 1; i <= 30 && out.length < n; i++) {
    const d = ocupacionDia(db, masDias(hoy, i));
    if (d.abre && d.abierto_min > 0) out.push(d);
  }
  return out;
}

// ── (A) HUECO QUE SE VA A PERDER ─────────────────────────────────────────────────────────────────
// Un día abierto por debajo del umbral de ocupación. Propone, NO ejecuta: dice qué día, cuántas horas
// libres y en qué tramos concretos y de quién. No envía nada, no ofrece nada a nadie, no escribe.
export function huecosQueSePierden(db, hoy) {
  if (!usaAgenda(db)) return [];
  const out = [];
  for (const d of proximosDiasAbiertos(db, hoy)) {
    if (d.pct >= OCUPACION_FLOJA_PCT) continue;
    if (d.libre_min <= 0) continue;
    // Los tramos, de la persona con más hueco hacia abajo; y dentro de cada una, en orden de reloj.
    const personas = [...d.personas].sort((a, b) => b.libre_min - a.libre_min);
    const detalle = personas.map(p =>
      p.nombre + ': ' + p.tramos.map(t => t.desde + '–' + t.hasta).join(', ')).join(' · ');
    out.push({
      fecha: d.fecha,
      horas_libres: Math.round(d.libre_min / 60 * 10) / 10,
      libre_min: d.libre_min, abierto_min: d.abierto_min, pct: d.pct,
      dias_para: diasEntreISO(d.fecha, hoy),
      personas, detalle,
    });
  }
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha));   // lo más próximo primero
}

// ── EL HISTORIAL DE CITAS DE CADA CLIENTE ────────────────────────────────────────────────────────
// Días DISTINTOS en que fue ATENDIDO (dos citas el mismo día son una visita, no dos: la misma lección
// que ya aprendió `umbralDormido` con las facturas del mismo día). Solo clientes de ficha: una cita
// suelta sin `cliente_id` no tiene a quién avisar.
function visitasPorCliente(db) {
  let filas = [];
  try {
    filas = db.prepare(
      `SELECT c.cliente_id AS client_id, cl.name AS client_name, c.fecha, c.id AS cita_id
         FROM citas c JOIN clients cl ON cl.id = c.cliente_id
        WHERE c.cliente_id IS NOT NULL AND cl.active=1
          AND c.estado='atendida' AND c.archived=0
        ORDER BY c.cliente_id, c.fecha, c.id`).all();
  } catch { return new Map(); }
  const porCliente = new Map();
  for (const f of filas) {
    if (!porCliente.has(f.client_id)) porCliente.set(f.client_id, { client_id: f.client_id, client_name: f.client_name, dias: [], ultimaCitaId: null });
    const e = porCliente.get(f.client_id);
    if (e.dias[e.dias.length - 1] !== f.fecha) e.dias.push(f.fecha);
    e.ultimaCitaId = f.cita_id;
  }
  return porCliente;
}

// Qué servicio hizo en una cita (el primero de la cadena, que es el que la nombra).
function servicioDeCita(db, citaId) {
  try {
    return db.prepare(
      `SELECT p.name FROM cita_servicios cs JOIN products p ON p.id = cs.product_id
        WHERE cs.cita_id=? ORDER BY cs.orden, cs.id LIMIT 1`).get(citaId)?.name || null;
  } catch { return null; }
}

// LOS CLIENTES QUE MANDA EL DETECTOR DE CITAS. Todo el que tenga ritmo aprendible por citas
// (RITMO_MIN_CITAS visitas o más) queda BAJO LA JURISDICCIÓN de este detector — haya saltado o no.
// Es lo que impide el aviso doble: si el motor de citas dice que este cliente va en su ritmo, el
// detector de facturas no puede decir a la vez que está dormido. Dos avisos contradictorios sobre la
// misma persona son peores que ninguno.
export function clientesConRitmoDeCitas(db) {
  if (!usaAgenda(db)) return new Set();
  const out = new Set();
  for (const [id, e] of visitasPorCliente(db)) if (e.dias.length >= RITMO_MIN_CITAS) out.add(id);
  return out;
}

// ── (B) CLIENTE FUERA DE SU RITMO ────────────────────────────────────────────────────────────────
// Ritmo propio = mediana de días entre visitas consecutivas. Con menos de RITMO_MIN_CITAS visitas NO
// se inventa ritmo: no hay aviso. Se avisa al pasar RITMO_FACTOR veces ese ritmo.
export function clientesFueraDeRitmo(db, hoy) {
  if (!usaAgenda(db)) return [];
  const out = [];
  for (const [, e] of visitasPorCliente(db)) {
    if (e.dias.length < RITMO_MIN_CITAS) continue;          // sin historial suficiente, se calla
    const huecos = [];
    for (let i = 1; i < e.dias.length; i++) huecos.push(diasEntreISO(e.dias[i], e.dias[i - 1]));
    const ritmo = mediana(huecos);
    if (!(ritmo > 0)) continue;                             // todas el mismo día → no hay ritmo
    const umbral = Math.round(ritmo * RITMO_FACTOR);
    const ultima = e.dias[e.dias.length - 1];
    const dias = diasEntreISO(hoy, ultima);
    if (dias <= umbral) continue;                           // va dentro de su ritmo
    out.push({
      client_id: e.client_id, client_name: e.client_name,
      ultima_visita: ultima, dias_sin_venir: dias,
      visitas: e.dias.length, ritmo_dias: Math.round(ritmo), umbral_dias: umbral,
      exceso: dias - umbral,
      ultimo_servicio: servicioDeCita(db, e.ultimaCitaId),
    });
  }
  return out.sort((a, b) => b.exceso - a.exceso);
}

// ── (C) SE FUE SIN PRÓXIMA CITA ──────────────────────────────────────────────────────────────────
// Atendido en los últimos SIN_PROXIMA_DIAS días y sin ninguna cita futura viva. Un aviso por cliente
// (la consulta agrupa por cliente: no puede repetirse aunque tenga varias visitas en la ventana).
export function seFueSinProxima(db, hoy) {
  if (!usaAgenda(db)) return [];
  const desde = masDias(hoy, -SIN_PROXIMA_DIAS);
  try {
    return db.prepare(
      `SELECT c.cliente_id AS client_id, cl.name AS client_name,
              MAX(c.fecha) AS ultima_visita, MAX(c.id) AS cita_id
         FROM citas c JOIN clients cl ON cl.id = c.cliente_id
        WHERE c.cliente_id IS NOT NULL AND cl.active=1
          AND c.estado='atendida' AND c.archived=0
          AND c.fecha >= ? AND c.fecha <= ?
          AND NOT EXISTS (
            SELECT 1 FROM citas f
             WHERE f.cliente_id = c.cliente_id AND f.archived=0
               AND f.estado NOT IN ('anulada','no_show') AND f.fecha > ?)
        GROUP BY c.cliente_id
        ORDER BY ultima_visita DESC, c.cliente_id`).all(desde, hoy, hoy)
      .map(r => ({ ...r, dias_desde: diasEntreISO(hoy, r.ultima_visita), ultimo_servicio: servicioDeCita(db, r.cita_id) }));
  } catch { return []; }
}

// ── (D) AUSENCIAS ────────────────────────────────────────────────────────────────────────────────
// El estado 'no_show' EXISTE de verdad en el motor (citas-engine.js: ESTADOS), con su etiqueta "No se
// presentó" y su transición. No se deduce de nada: se lee. Un aviso por cliente con las faltas de los
// últimos AUSENCIA_DIAS días. Se mide por `citas.fecha` (el día en que faltó) porque no hay sello
// `no_show_at` — y la fecha de la cita es, además, el dato correcto para esto.
export function ausenciasRecientes(db, hoy) {
  if (!usaAgenda(db)) return [];
  const desde = masDias(hoy, -AUSENCIA_DIAS);
  try {
    return db.prepare(
      `SELECT c.cliente_id AS client_id, cl.name AS client_name,
              COUNT(*) AS faltas, MAX(c.fecha) AS ultima_falta
         FROM citas c JOIN clients cl ON cl.id = c.cliente_id
        WHERE c.cliente_id IS NOT NULL AND cl.active=1
          AND c.estado='no_show' AND c.archived=0
          AND c.fecha >= ? AND c.fecha <= ?
        GROUP BY c.cliente_id
        ORDER BY faltas DESC, ultima_falta DESC`).all(desde, hoy)
      .map(r => ({ ...r, dias_desde: diasEntreISO(hoy, r.ultima_falta) }));
  } catch { return []; }
}
