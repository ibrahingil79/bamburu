// ════════════════════════════════════════════════════════════════════════════
// INICIO PERSONALIZABLE — resolución + persistencia de layouts. Escalera · paso 6.
//
// MODELO (opción C · híbrido): el dueño define un default DE EMPRESA y encima cada usuario retoca el
// suyo. La cascada elige el ámbito MÁS específico disponible:  usuario:<id>  >  empresa  >  fabrica.
// Nunca un lienzo en blanco: si nadie ha tocado nada, se ve el de FÁBRICA (semilla en código).
//
// POR EMPRESA (no por rol): los permisos de esta app son POR USUARIO (`user_permissions`); las tablas de
// roles con nombre existen pero NO gobiernan el acceso (ver PASO 0). Así que el default del dueño es uno
// solo, de empresa, y el filtrado por permiso se hace por usuario: un bloque de un área que un usuario
// no puede ver NO se le pinta (se omite en silencio), nunca se le cuela.
//
// PERMISOS reutilizados, no reimplementados: el permiso de área sale de `areaPerm` (constructor) y del
// mismo `can()`/`requirePerm` de las dos puertas. Los gráficos de panel se pintan re-cruzando por el
// motor del constructor (cero cifras propias). SOLO LECTURA sobre datos de negocio: esto solo guarda la
// COLOCACIÓN de bloques (config de presentación), nunca deriva ni escribe una cifra.
import { listarPaneles, areaPerm, AREAS } from './constructor-analitica.js';
import { ventasResumen, pedidosResumen } from './ventas-metrics.js';
import { estadoAvisos, hoyLocal } from './avisos.js';
import { usaAgenda, ocupacionDia } from './vigia-agenda.js';
import { hayHorarioNegocio, tramosAmbito, ahoraLocal } from './citas-engine.js';
import { agendaData } from './routes/citas.js';   // LA MISMA función que sirve la vista día

// Datos de render de un panel guardado: su receta (config), la medida a pintar y el meta de esa medida
// (etiqueta/dinero/%), tomados del catálogo REAL del constructor — para que el Inicio lo pinte con SU
// motor sin recalcular nada. Se comparte entre `sanear` (lo colocado) y `bloquesDisponibles` (la paleta).
function enriquecerPanel(p) {
  const area = p.config?.area || 'ventas';
  const medida = p.config?.formula ? 'calculo' : (p.config?.medidas?.[0] || 'base');
  const m = AREAS[area]?.medidas?.[medida];
  const meta = p.config?.formula ? { etiqueta: 'Cálculo', dinero: false, pct: false }
    : (m ? { etiqueta: m.etiqueta, dinero: !!m.dinero, pct: !!m.pct } : { etiqueta: medida, dinero: false, pct: false });
  return { area, medida, meta, config: p.config, nombre: p.nombre };
}

// ── BLOQUES NATIVOS del Inicio (los que ya existían) que se pueden colocar en la rejilla ─────────
// `perm` = permiso que exige para verse (null = todos; los datos internos se filtran igual por permiso).
export const NATIVOS = {
  kpis:   { etiqueta: 'Cifras del negocio', desc: 'Ventas del mes, pedidos, pendientes y avisos.', perm: null,             icon: 'ti-layout-dashboard', w: 4, h: 1 },
  // `soloAgenda` — el bloque NI SE OFRECE si el negocio no lleva agenda. Es la misma guarda que
  // llevan los cuatro detectores de agenda del vigía y por el mismo motivo: sin horario puesto, el
  // motor da por abierto de 8 a 21 todos los días, así que «te quedan 13 h libres» sería un número
  // inventado con pinta de dato. Antes que enseñar eso, no se enseña nada.
  hoy:    { etiqueta: 'Hoy en la agenda',   desc: 'Las citas de hoy y las horas que te quedan libres.', perm: 'citas.read', icon: 'ti-calendar-event', w: 2, h: 2, soloAgenda: true },
  vigia:  { etiqueta: 'Vigía de DISA',      desc: 'Lo que más conviene mirar, ordenado por prioridad.', perm: 'analytics.read', icon: 'ti-radar',           w: 2, h: 2 },
  avisos: { etiqueta: 'Avisos pendientes',  desc: 'Cobros, pagos, stock y recurrentes por resolver.', perm: null,             icon: 'ti-bell',            w: 2, h: 2 },
};

// ¿Se puede ofrecer este bloque en ESTE negocio? Separa «no tienes permiso» de «esto aquí no aplica»:
// son dos motivos distintos de no verlo y conviene no confundirlos al leer el código.
export function bloqueAplica(db, tipo) {
  const n = NATIVOS[tipo];
  if (!n) return false;
  if (!n.soloAgenda) return true;
  try { return usaAgenda(db); } catch { return false; }
}

// ── INICIO DE FÁBRICA — sensato y ya montado. Semilla en código (no se persiste). ───────────────
// CAMBIA CON EL CUADRO DE MANDO, y por un motivo que se vio en pantalla: la rejilla de fábrica traía
// «Cifras del negocio», «Hoy en la agenda» y el «Vigía de DISA», que ahora están ARRIBA, fijos y más
// grandes. El resultado era la misma cifra dos veces en la misma pantalla — y dos «Ventas del mes»
// que no se parecen es exactamente lo que esta tarea viene a matar.
//
// Así que de fábrica queda SOLO «Avisos pendientes», que no lo pinta nadie más (sale del motor de
// avisos: cobros, pagos, stock y recurrentes; el vigía es otro motor y otra pregunta). Los otros tres
// NO se eliminan: siguen en la PALETA, para quien los quiera colocar a mano. Y los layouts que un
// usuario ya haya guardado se respetan tal cual: esto es la semilla, no una migración.
export const FABRICA = [
  { tipo: 'avisos', refId: null, x: 0, y: 0, w: 4, h: 2 },
];
export function fabricaDe(db) {
  return FABRICA;
}

// El permiso que exige un bloque: nativo → su `perm`; panel → el permiso de su área.
export function permDeBloque(b, panelesById) {
  if (b.tipo === 'panel') {
    const p = panelesById.get(b.refId);
    return p ? areaPerm(p.config?.area || 'ventas') : '__inexistente__';   // panel que no ve → cae cerrado
  }
  return NATIVOS[b.tipo]?.perm || null;
}

// ── PERSISTENCIA por ámbito ─────────────────────────────────────────────────────────────────────
export function getLayout(db, scope) {
  const row = db.prepare('SELECT blocks FROM dashboard_layouts WHERE scope=?').get(scope);
  if (!row) return null;
  try { const b = JSON.parse(row.blocks); return Array.isArray(b) ? b : null; } catch { return null; }
}
// Igual que getLayout pero SIN exigir que el JSON sea una LISTA. La guarda `Array.isArray` de arriba
// es del INICIO (sus layouts son listas de bloques), no de la tabla: las preferencias de menú por
// usuario (`menu:usuario:<id>`) guardan un OBJETO —anclas + orden—, y con getLayout se leerían como
// null. Misma tabla, mismas funciones, sin SQL copiado en otro fichero.
export function getLayoutRaw(db, scope) {
  const row = db.prepare('SELECT blocks FROM dashboard_layouts WHERE scope=?').get(scope);
  if (!row) return null;
  try { return JSON.parse(row.blocks); } catch { return null; }
}
export function setLayout(db, scope, blocks, userId = null) {
  db.prepare(`INSERT INTO dashboard_layouts (scope, blocks, updated_at, updated_by) VALUES (?,?,CURRENT_TIMESTAMP,?)
              ON CONFLICT(scope) DO UPDATE SET blocks=excluded.blocks, updated_at=CURRENT_TIMESTAMP, updated_by=excluded.updated_by`)
    .run(scope, JSON.stringify(blocks), userId);
  return { ok: true };
}
export function delLayout(db, scope) {
  db.prepare('DELETE FROM dashboard_layouts WHERE scope=?').run(scope);
  return { ok: true };
}

// ── RESOLUCIÓN (cascada) — qué layout le toca a este usuario, y de qué ámbito viene ─────────────
export function resolver(db, userId) {
  const propio = getLayout(db, 'usuario:' + userId);
  if (propio) return { blocks: propio, origen: 'usuario', tieneCapaPropia: true };
  const empresa = getLayout(db, 'empresa');
  if (empresa) return { blocks: empresa, origen: 'empresa', tieneCapaPropia: false };
  return { blocks: fabricaDe(db), origen: 'fabrica', tieneCapaPropia: false };
}

// Deja SOLO los bloques que este usuario puede ver (permiso heredado). Un panel que no ve, o un bloque
// de un área sin permiso, se OMITE (no se le cuela ni el del default del dueño). Enriquece los de panel
// con su nombre/área para que la pantalla los pinte sin volver a preguntar.
export function sanear(blocks, { puede, panelesById, aplica = () => true }) {
  const out = [];
  for (const b of (blocks || [])) {
    if (b.tipo === 'panel') {
      const p = panelesById.get(b.refId);
      if (!p) continue;                                   // panel borrado o que no ve → fuera
      if (!puede(areaPerm(p.config?.area || 'ventas'))) continue;
      const e = enriquecerPanel(p);
      out.push({ tipo: 'panel', refId: b.refId, x: b.x | 0, y: b.y | 0, w: b.w, h: b.h,
                 nombre: e.nombre, area: e.area, config: e.config, medida: e.medida, meta: e.meta });
    } else {
      const nat = NATIVOS[b.tipo];
      if (!nat) continue;                                 // bloque desconocido → fuera
      if (nat.perm && !puede(nat.perm)) continue;         // nativo sin permiso → fuera (no se cuela)
      if (!aplica(b.tipo)) continue;                      // no aplica a este negocio → fuera
      out.push({ tipo: b.tipo, refId: null, x: b.x | 0, y: b.y | 0, w: b.w, h: b.h, etiqueta: nat.etiqueta });
    }
  }
  return out;
}

// ── PALETA — los bloques que este usuario PUEDE añadir (nativos permitidos + sus paneles visibles) ─
export function bloquesDisponibles(db, userId, puede) {
  const nativos = Object.entries(NATIVOS)
    .filter(([tipo, n]) => (!n.perm || puede(n.perm)) && bloqueAplica(db, tipo))
    .map(([tipo, n]) => ({ tipo, etiqueta: n.etiqueta, desc: n.desc, icon: n.icon, w: n.w, h: n.h }));
  const paneles = listarPaneles(db, userId)
    .filter(p => puede(areaPerm(p.config?.area || 'ventas')))
    .map(p => {
      const e = enriquecerPanel(p);
      return { tipo: 'panel', refId: p.id, etiqueta: p.nombre, area: e.area, grafico: p.config?.grafico || 'tabla',
               propio: p.propio, autor: p.autor, w: NATIVOS.vigia.w, h: NATIVOS.vigia.h,
               config: e.config, medida: e.medida, meta: e.meta };
    });
  return { nativos, paneles };
}

// ── VALIDAR/NORMALIZAR un layout entrante (antes de guardar) ────────────────────────────────────
// Recorta tamaños a la rejilla (w 1..4, h 1..4), fija el tipo válido, y limita el nº de bloques. NO
// comprueba permisos aquí (eso lo hace la ruta, que tiene el `puede` del usuario): esto solo sanea forma.
export function normalizar(blocks) {
  if (!Array.isArray(blocks)) { const e = new Error('El layout debe ser una lista de bloques'); e.status = 400; throw e; }
  const clamp = (v, lo, hi, def) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
  return blocks.slice(0, 40).map((b, i) => {
    const tipo = String(b && b.tipo || '');
    const esPanel = tipo === 'panel';
    const rid = esPanel ? Number(b.refId) : null;
    if (esPanel ? !Number.isInteger(rid) : !NATIVOS[tipo]) return null;
    return { tipo, refId: esPanel ? rid : null, x: 0, y: i, w: clamp(b.w, 1, 4, 2), h: clamp(b.h, 1, 4, 1) };
  }).filter(Boolean);
}

// ── EL BLOQUE «HOY» — CERO CIFRA PROPIA ─────────────────────────────────────────────────────────
// Las citas salen de `agendaData`, que es EXACTAMENTE la función que sirve la vista día de la
// agenda (`GET /api/erp/citas/agenda`). Las horas libres salen de `ocupacionDia`, que es de donde
// come el detector de huecos del vigía (`huecosQueSePierden` → `proximosDiasAbiertos` → `ocupacionDia`).
//
// UN MATIZ QUE CONVIENE NO ESCONDER: el AVISO del vigía empieza en MAÑANA a propósito —«el hueco de
// esta mañana ya se perdió»—, así que del día de hoy el vigía no avisa nunca. La CIFRA, en cambio,
// sale de la misma función con la fecha de hoy: mismo camino de código, mismo número, distinto día.
//
// Permiso `citas.read`, filtrado AQUÍ (servidor): lo que no se puede ver no viaja al navegador.
export function datosHoy(db, { puede, fecha }) {
  if (!puede('citas.read')) return null;
  const hoy = fecha || hoyLocal();
  let citas = [], bloqueos = [];
  try {
    const dia = agendaData(db, { desde: hoy, hasta: hoy });
    citas = (dia.citas || [])
      .sort((a, b) => a.inicio_min - b.inicio_min)
      .map(c => ({
        id: c.id, hora: hhmmDe(c.inicio_min), fin: hhmmDe(c.inicio_min + c.dur_min),
        // La GEOMETRÍA de la cita, tal cual la da la agenda: la franja del día se dibuja con estos
        // minutos, no con una cuenta propia. Dibujar no es calcular.
        inicio_min: c.inicio_min, dur_min: c.dur_min, fin_min: c.inicio_min + c.dur_min,
        cliente: c.cliente, servicios: c.servicios || '', persona: c.persona || '—', estado: c.estado,
      }));
    // Los EVENTOS del día (vacaciones, cierres, reuniones): la misma consulta que sirve la vista día.
    bloqueos = (dia.bloqueos || []).map(b => ({
      id: b.id, inicio_min: b.inicio_min, fin_min: b.fin_min,
      hora: hhmmDe(b.inicio_min), fin: hhmmDe(b.fin_min),
      motivo: b.motivo || '', user_id: b.user_id || null,
    }));
  } catch { citas = []; bloqueos = []; }
  let ocupacion = null;
  try { ocupacion = ocupacionDia(db, hoy); } catch { ocupacion = null; }
  // Los tramos ABIERTOS del negocio ese día — el fondo de la franja. Es la MISMA función de la que
  // come `ocupacionDia` por dentro (`tramosPersona` → `tramosAmbito`), no una segunda lectura.
  let tramos = [];
  try { tramos = (tramosAmbito(db, 'negocio', null, hoy) || []).map(([a, b]) => ({ ini: a, fin: b })); } catch { tramos = []; }
  // La hora AHORA, en la zona del negocio, solo si la franja es la de hoy de verdad.
  let ahora = null;
  try { const a = ahoraLocal(); if (a.fecha === hoy) ahora = a.min; } catch { ahora = null; }
  // La PRÓXIMA cita: la primera que aún no ha terminado. Si el día ya pasó (o es otro), no hay
  // «próxima» que destacar y se dice con null en vez de destacar la primera de la mañana.
  const proxima = ahora == null ? null : (citas.find(c => c.fin_min > ahora) || null);
  return {
    fecha: hoy,
    citas,
    bloqueos,
    n: citas.length,
    tramos,
    ahora,
    proxima_id: proxima ? proxima.id : null,
    proxima,
    // SIN HORARIO PUESTO, EL MOTOR ABRE DE 8 A 21 TODOS LOS DÍAS. Eso convierte «te quedan 13 h
    // libres» en un número inventado con pinta de dato. No se esconde ni se maquilla: el bloque lo
    // dice y manda a ponerlo, igual que ya hace la pantalla de la agenda con su `sin_horario`.
    sin_horario: (() => { try { return !hayHorarioNegocio(db); } catch { return true; } })(),
    abre: !!(ocupacion && ocupacion.abre),
    abierto_min: ocupacion ? ocupacion.abierto_min : null,
    ocupado_min: ocupacion ? ocupacion.ocupado_min : null,
    libre_min: ocupacion ? ocupacion.libre_min : null,
    libre_h: ocupacion ? Math.round(ocupacion.libre_min / 60 * 10) / 10 : null,
    pct: ocupacion ? ocupacion.pct : null,
  };
}
const hhmmDe = m => String(Math.floor((Number(m) || 0) / 60)).padStart(2, '0') + ':' + String((Number(m) || 0) % 60).padStart(2, '0');

// ── DATOS de los bloques nativos (KPIs + avisos), filtrados por permiso — MISMA lógica que el Inicio ─
export function datosNativos(db, { puede, userId, fuentes, sym }) {
  const verVentas = puede('invoices.read'), verPedidos = puede('pedidos.read');
  let ventas = null, pedidos = null, pendiente = null;
  // LA MISMA BASE QUE EL CUADRO DE MANDO: sin IVA. Antes esta cifra iba con IVA y la de arriba sin
  // él, así que la misma pantalla enseñaba dos «Ventas del mes» distintas y ninguna decía cuál era
  // cuál. Es el mismo motor y el mismo periodo; lo único que cambia es qué campo se lee.
  try { if (verVentas) ventas = Math.round(ventasResumen(db, { from: new Date().toISOString().slice(0, 7) + '-01' }).base); } catch {}
  try { if (verPedidos) { const ped = pedidosResumen(db); pedidos = ped.confirmadosMes; pendiente = ped.pendientes; } } catch {}
  let count = 0, estado = 'apagado';
  try { const est = estadoAvisos(db, hoyLocal(), userId, fuentes); count = est.count; estado = est.estado; } catch {}
  return {
    kpis: { sym, verVentas, verPedidos, ventas, pedidos, pendiente },
    avisos: { count, estado },
    hoy: bloqueAplica(db, 'hoy') ? datosHoy(db, { puede }) : null,
  };
}
