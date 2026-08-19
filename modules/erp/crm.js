// ════════════════════════════════════════════════════════════════════════════
// CRM COMERCIAL — motor del embudo de oportunidades y de la actividad de cliente.
//
// Es el ESPEJO de cobros.js, desacoplado de la factura. Allí la secuencia de
// seguimiento se dispara por el VENCIMIENTO de una deuda; aquí, por el SILENCIO
// sobre una oportunidad viva. Misma forma, mismo vocabulario, mismas garantías:
//
//     cobros.js                          crm.js
//     ─────────────────────────────      ──────────────────────────────────────
//     perfil del cliente (cadencia)  →   etapa del embudo (cadencia)
//     días desde el vencimiento      →   días de silencio desde el último toque
//     promesa de pago (pospone)      →   compromiso (pospone)
//     calcularProximaAccion()        →   calcularProximaAccionOportunidad()
//     priorizarCobros()              →   priorizarOportunidades()
//     collectionsWorklist()          →   salesWorklist()
//     registerCollectionAction()     →   registerClientActivitySvc()
//
// La oportunidad NUNCA es un documento fiscal: `amount` es una ESTIMACIÓN comercial.
// Cuando se gana, quien lleva el importe legal es el presupuesto/pedido/factura de la
// cadena documental. Este motor no toca invoices, ni el hash de Verifactu, ni el stock.
//
// Nada se envía ni se mueve solo: la próxima acción es una PROPUESTA (principio de
// Bamburu — la oportunidad llega con el trabajo hecho, no con un formulario en blanco).
// ════════════════════════════════════════════════════════════════════════════
import { renderEmail, renderEmailFabrica } from './email-templates.js';
import { escHtml } from '../../core/escape.js';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

// Días entre dos fechas YYYY-MM-DD (a - b), en UTC (misma función que cobros.js: evita
// que un cambio de zona horaria mueva un día la cadencia).
function daysBetween(a, b) {
  return Math.floor((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
}
function addDays(iso, n) {
  return new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}
const dayOf = iso => String(iso || '').slice(0, 10);

// ════════════════════════════════════════════════════════════════════════════
// EL EMBUDO — fuente única de las etapas. La BD NO lleva CHECK sobre `stage` (cambiar
// un CHECK obliga a recrear la tabla = DROP, prohibido): la lista cerrada se valida aquí
// y en el esquema zod, que la lee de aquí. Un solo sitio.
//
// Nombres decididos contra los embudos por defecto de los CRM de referencia, verificados en
// fuente oficial (ver docs/crm/embudo-referencia.md):
//
//  · 4 etapas ABIERTAS + 2 estados TERMINALES. Es la forma de PIPEDRIVE (API Deals: `status`
//    ∈ open|won|lost, ortogonal a `stage_id`; `lost_reason` "can only be set if deal status is
//    lost") y de HOLDED (Abierto/Ganado/Perdido sobre la etapa del embudo). NO la de Salesforce
//    ni HubSpot, que meten "Closed Won"/"Closed Lost" como etapas del picklist.
//    Los dos productos del segmento (PYME/autónomo, y Holded es el competidor directo español)
//    eligen estado separado, y con razón: si "Perdida" es una etapa, DESTRUYES el dato de en qué
//    etapa se cayó — que es justo la métrica que le sirve a un autónomo. Aquí `stage` se conserva
//    intacto al cerrar, así que `stage` de una perdida ES "perdida_en_etapa", sin columna extra.
//
//  · CUATRO etapas abiertas, como Holded ("Por defecto aparecerán 4 etapas"). Pipedrive trae 5 y
//    HubSpot 5, pero las suyas incluyen etapas de EVENTO DE CALENDARIO (Demo Scheduled, Appointment
//    scheduled, Presentation scheduled): artefactos de venta SaaS con comité de compra. Se descartan
//    también las 8 abiertas de Salesforce (Value Proposition, Id. Decision Makers, Perception
//    Analysis): su gradiente 50/60/70% exige volumen histórico para calibrarse.
//
//  · "Presupuesto enviado" (no "Propuesta"): los tres CRMs nombran esta etapa por el ARTEFACTO
//    entregado — Proposal/Price Quote (SF), Proposal Made (PD), Contract sent (HS) — y en Bamburu
//    ese artefacto ya existe con su cadena documental (presupuesto → pedido → factura).
//  · "Cualificado", participio (hito superado), como Pipedrive (Qualified) y HubSpot (Qualified to
//    buy); no "Cualificación" (proceso en curso, sustantivo, solo Salesforce). El participio hace
//    inequívoco el drag & drop: la columna dice lo que YA pasó.
//
//  · Probabilidades 10/30/60/85: interpolación razonada entre SF (10/10/20/50/60/70/75/90) y HS
//    (20/40/60/80/90). Es DECISIÓN DE DISEÑO, no dato de fuente. Se copia el override de Pipedrive
//    ("deal probability overrides stage probability"): mover de etapa NO pisa una probabilidad que
//    el usuario haya tocado a mano. HubSpot la sobreescribe siempre; con ciclo corto y poco volumen
//    eso produce previsiones basura.
// ════════════════════════════════════════════════════════════════════════════
export const ETAPAS = [
  { key: 'nuevo',       label: 'Nuevo contacto',       prob: 10, cadencia: 2 },
  { key: 'cualificado', label: 'Cualificado',          prob: 30, cadencia: 5 },
  { key: 'propuesta',   label: 'Presupuesto enviado',  prob: 60, cadencia: 7 },
  { key: 'negociacion', label: 'Negociación',          prob: 85, cadencia: 3 },
];
export const ETAPA_KEYS  = ETAPAS.map(e => e.key);
export const ETAPA_LABEL = Object.fromEntries(ETAPAS.map(e => [e.key, e.label]));
export const ETAPA_PROB  = Object.fromEntries(ETAPAS.map(e => [e.key, e.prob]));
// Días de SILENCIO tolerados en cada etapa antes de proponer el siguiente toque. Es el
// equivalente de CADENCIAS en cobros.js. Cuanto más caliente la etapa, menos silencio.
export const CADENCIA_ETAPA = Object.fromEntries(ETAPAS.map(e => [e.key, e.cadencia]));

export const ESTADOS = ['activa', 'ganada', 'perdida'];
export const ESTADO_LABEL = { activa: 'Abierta', ganada: 'Ganada', perdida: 'Perdida' };
export const ESTADO_BADGE = { activa: 'b-blue', ganada: 'b-green', perdida: 'b-gray' };

// Etiquetas de urgencia de la PRÓXIMA acción (las dos que no son etapa del embudo).
export const URGENCIA_LABEL = {
  ...ETAPA_LABEL,
  en_riesgo:   'En riesgo',
  compromiso:  'Compromiso',
};
// Orden del pipeline de trabajo (mayor = más arriba). `en_riesgo` (cierre previsto ya
// pasado y la oportunidad sigue abierta) manda sobre todo. `compromiso` baja del todo:
// hay una fecha dada por el cliente, no toca insistir.
export const URGENCIA_ORDER = {
  en_riesgo: 6, negociacion: 5, propuesta: 4, cualificado: 3, nuevo: 2, compromiso: 1,
};

// Motivo de pérdida. HALLAZGO de la investigación: **ningún** CRM de referencia trae lista por
// defecto — Salesforce no tiene siquiera campo estándar; Pipedrive, HubSpot y Holded la dejan
// vacía y configurable. Así que esta lista es PROPUESTA RAZONADA, no dato de fuente. Se copia de
// Pipedrive/Holded el modelo HÍBRIDO: picklist + texto libre conviviendo (`otro` EXIGE nota).
// Sin motivo no se pierde nada: una oportunidad perdida sin causa no enseña nada el año que viene.
export const MOTIVOS_PERDIDA = ['precio', 'competencia', 'sin_presupuesto', 'sin_respuesta', 'fuera_de_plazo', 'fuera_de_alcance', 'lo_hace_internamente', 'otro'];
export const MOTIVO_PERDIDA_LABEL = {
  precio: 'Precio / demasiado caro', competencia: 'Eligió a otro proveedor', sin_presupuesto: 'Sin presupuesto',
  sin_respuesta: 'Dejó de responder', fuera_de_plazo: 'Fuera de plazo', fuera_de_alcance: 'Fuera de mi ámbito de servicio',
  lo_hace_internamente: 'Lo resuelve internamente', otro: 'Otro',
};

// Origen de la oportunidad. Anclado en `LeadSource` de Salesforce — la ÚNICA lista de origen que
// la investigación pudo verificar en documentación oficial (StandardValueSet compartido por Lead,
// Contact, Account y Opportunity): Advertisement · Employee Referral · External Referral · Partner ·
// Public Relations · Seminar Internal · Seminar Partner · Trade Show · Web · Word of mouth · Other.
// Podada de lo que no existe en la vida de un autónomo (Seminar Partner, Public Relations) y con
// "Recomendación" fusionando Word of mouth + External Referral: es su canal número uno real.
export const ORIGENES = ['recomendacion', 'web', 'redes', 'cliente_existente', 'llamada_entrante', 'feria', 'publicidad', 'colaborador', 'directorio', 'otro'];
export const ORIGEN_LABEL = {
  recomendacion: 'Recomendación / boca a boca', web: 'Web', redes: 'Redes sociales',
  cliente_existente: 'Cliente existente', llamada_entrante: 'Llamada o email entrante', feria: 'Evento o feria',
  publicidad: 'Publicidad', colaborador: 'Colaborador / partner', directorio: 'Directorio o marketplace', otro: 'Otro',
};

// Canales de una actividad (los del encargo + 'otro').
export const CANALES = ['email', 'telefono', 'whatsapp', 'reunion', 'nota', 'otro'];
export const CANAL_LABEL = {
  email: 'Email', telefono: 'Teléfono', whatsapp: 'WhatsApp', reunion: 'Reunión', nota: 'Nota', otro: 'Otro',
};
export const TIPOS_ACTIVIDAD = ['contacto', 'nota', 'compromiso', 'email', 'cambio_etapa', 'cierre'];

// Tonos del seguimiento comercial, en orden. Suben con cada toque no respondido dentro de
// la MISMA etapa (y un nivel más si hubo un compromiso incumplido). Espejo de TONOS en
// cobros.js, pero un comercial nunca amenaza: el último escalón es "cierro el tema", no
// "medidas oportunas".
const TONOS = ['primer-contacto', 'seguimiento', 'insistencia', 'ultimo-intento'];
function bumpTono(t) {
  const i = TONOS.indexOf(t);
  return TONOS[Math.min((i < 0 ? 0 : i) + 1, TONOS.length - 1)];
}

// ── Lecturas base ───────────────────────────────────────────────────────────
// Actividad viva de una oportunidad (el log que lee el motor de próxima acción).
export function opportunityActivities(db, opportunityId) {
  return db.prepare(
    'SELECT * FROM client_activities WHERE opportunity_id=? AND active=1 ORDER BY created_at, id'
  ).all(opportunityId);
}
// Historial de actividad de un cliente (con y sin oportunidad).
export function clientActivities(db, clientId) {
  return db.prepare(
    'SELECT * FROM client_activities WHERE client_id=? AND active=1 ORDER BY created_at DESC, id DESC'
  ).all(clientId);
}

// El compromiso VIVO = el último compromiso registrado con fecha (el último gobierna),
// igual que lastPromise() en cobros.js.
function lastCompromiso(log) {
  const c = log.filter(a => a.commitment_date);
  return c.length ? c[c.length - 1] : null;
}

// Último TOQUE real de la oportunidad dentro de su etapa actual: la actividad más reciente
// posterior al cambio de etapa. Si no hubo ninguna, el propio cambio de etapa cuenta como
// toque (acabas de moverla; no te reclama nada al segundo siguiente).
// Los eventos automáticos (cambio_etapa/cierre) NO cuentan como contacto con el cliente.
function ultimoToque(opp, log) {
  const desde = dayOf(opp.stage_changed_at) || dayOf(opp.created_at);
  const toques = log
    .filter(a => a.type !== 'cambio_etapa' && a.type !== 'cierre')
    .map(a => dayOf(a.created_at))
    .filter(d => d >= desde);
  return toques.length ? toques[toques.length - 1] : desde;
}

// Cuántos toques ya se han dado en la etapa actual (gobierna el tono: cada silencio sube uno).
function toquesEnEtapa(opp, log) {
  const desde = dayOf(opp.stage_changed_at) || dayOf(opp.created_at);
  return log.filter(a => a.type !== 'cambio_etapa' && a.type !== 'cierre' && dayOf(a.created_at) >= desde).length;
}

// Días que la oportunidad lleva en su etapa actual (dato de la tarjeta del Kanban).
export function diasEnEtapa(opp, hoy) {
  const d = dayOf(opp.stage_changed_at) || dayOf(opp.created_at);
  return d ? Math.max(0, daysBetween(hoy, d)) : 0;
}

// ── PRÓXIMA ACCIÓN de UNA oportunidad ───────────────────────────────────────
// opp: fila de opportunities. log: client_activities de esa oportunidad (activas). hoy: ISO.
// Devuelve { etapa, accion, fechaObjetivo, tono, motivo } | null (null = nada que proponer).
//   accion ∈ { 'seguimiento', 'revisar', null }
//     'seguimiento' → toca dar un toque (email/llamada); el tono lo fija la insistencia.
//     'revisar'     → el cierre previsto ya pasó: decide (gánala, piérdela o repón fecha).
//     null          → informativo (hay compromiso vivo, o aún no toca).
export function calcularProximaAccionOportunidad(opp, log, hoy) {
  if (!opp || opp.status !== 'activa' || !opp.active) return null;   // cerrada o archivada → nada
  log = log || [];

  // 1) Compromiso vivo → no se insiste hasta esa fecha. (Espejo exacto de la promesa de pago.)
  const comp = lastCompromiso(log);
  let compromisoIncumplido = false;
  if (comp) {
    if (comp.commitment_date >= hoy) {
      return {
        etapa: 'compromiso', accion: null, fechaObjetivo: comp.commitment_date, tono: null,
        motivo: 'Compromiso hasta ' + comp.commitment_date + ' (no insistas hasta esa fecha)',
      };
    }
    compromisoIncumplido = true;   // pasó la fecha y sigue abierta → reanuda y sube el tono
  }

  const etapa = opp.stage;
  const toque = ultimoToque(opp, log);
  const silencio = Math.max(0, daysBetween(hoy, toque));
  const cad = CADENCIA_ETAPA[etapa] ?? 5;
  const fechaSeguimiento = addDays(toque, cad);

  let tono = TONOS[Math.min(toquesEnEtapa(opp, log), TONOS.length - 1)];
  if (compromisoIncumplido) tono = bumpTono(tono);

  // 2) Cierre PREVISTO ya pasado y la oportunidad sigue abierta → decisión, no otro email.
  //    Manda sobre el seguimiento: seguir dando toques a una oportunidad cuya fecha de cierre
  //    ya venció es exactamente lo que engorda un embudo de mentira.
  const cierre = dayOf(opp.expected_close_date);
  if (cierre && cierre < hoy) {
    const dias = daysBetween(hoy, cierre);
    return {
      etapa: 'en_riesgo', accion: 'revisar', fechaObjetivo: cierre, tono,
      motivo: 'El cierre previsto era el ' + cierre + ' (hace ' + dias + ' día' + (dias === 1 ? '' : 's')
        + '): decide si la ganas, la pierdes o pones fecha nueva',
    };
  }

  // 3) Silencio por encima de la cadencia de la etapa → toca seguimiento.
  if (silencio >= cad) {
    return {
      etapa, accion: 'seguimiento', fechaObjetivo: fechaSeguimiento, tono,
      motivo: (compromisoIncumplido ? 'Compromiso incumplido — ' : '')
        + (silencio === 0 ? 'Sin contacto todavía' : 'Sin contacto desde hace ' + silencio + ' día' + (silencio === 1 ? '' : 's'))
        + ' en «' + (ETAPA_LABEL[etapa] || etapa) + '»',
    };
  }

  // 4) Aún dentro de la cadencia → informativo, con la fecha del siguiente toque.
  return {
    etapa, accion: null, fechaObjetivo: fechaSeguimiento, tono: null,
    motivo: 'Último contacto el ' + toque + '; siguiente seguimiento el ' + fechaSeguimiento,
  };
}

// Próxima acción de una oportunidad leyendo su log de la BD.
export function opportunityProximaAccion(db, opp, hoy) {
  return calcularProximaAccionOportunidad(opp, opportunityActivities(db, opp.id), hoy);
}

// ── Priorización EXPLICABLE ─────────────────────────────────────────────────
// Orden: urgencia de la próxima acción → días de retraso sobre su fecha objetivo (desc)
// → valor estimado (desc). Cada item se queda con un `.motivo` legible de por qué está ahí.
export function priorizarOportunidades(items, hoy) {
  const rank = it => URGENCIA_ORDER[it.proximaAccion ? it.proximaAccion.etapa : 'nuevo'] ?? 0;
  const retraso = it => {
    const f = it.proximaAccion && it.proximaAccion.fechaObjetivo;
    return f ? daysBetween(hoy, f) : 0;      // >0 = ya tocaba hace N días
  };
  return items.slice().sort((a, b) =>
    (rank(b) - rank(a)) || (retraso(b) - retraso(a)) || ((b.amount || 0) - (a.amount || 0))
  );
}

// ── COLA DE TRABAJO COMERCIAL (espejo de collectionsWorklist) ───────────────
// Todas las oportunidades ABIERTAS, cada una con su próxima acción y su motivo, ordenadas
// por urgencia. `pendientes` = las que piden una acción HOY (accion != null). Una sola
// fuente de verdad para las tres superficies: Kanban, cola y voz de DISA.
export function salesWorklist(db, hoy) {
  const opps = db.prepare(
    "SELECT o.*, c.name AS client_name, c.email AS client_email FROM opportunities o "
    + "JOIN clients c ON c.id=o.client_id WHERE o.active=1 AND o.status='activa'"
  ).all();
  const items = opps.map(o => {
    const proximaAccion = calcularProximaAccionOportunidad(o, opportunityActivities(db, o.id), hoy);
    return {
      ...o,
      dias_en_etapa: diasEnEtapa(o, hoy),
      proximaAccion,
      motivo: proximaAccion ? proximaAccion.motivo : '',
      accionPendiente: !!(proximaAccion && proximaAccion.accion),
    };
  });
  const rows = priorizarOportunidades(items, hoy);
  return {
    total: r2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)),
    pendientes: rows.filter(r => r.accionPendiente).length,
    rows,
  };
}

// ── EL EMBUDO por columnas (lo que pinta el Kanban) ─────────────────────────
// Una columna por etapa abierta, con la SUMA de valor estimado de sus tarjetas (cuánto
// dinero hay en cada fase) y el conteo. Reutiliza salesWorklist: cero cálculo duplicado.
// `ganadas`/`perdidas` son los estados terminales, con su total (del periodo que se pida).
export function pipelineByStage(db, hoy) {
  const wl = salesWorklist(db, hoy);
  const columnas = ETAPAS.map(e => {
    const items = wl.rows.filter(r => r.stage === e.key);
    return {
      key: e.key, label: e.label, prob: e.prob,
      count: items.length,
      total: r2(items.reduce((s, r) => s + (Number(r.amount) || 0), 0)),
      items,
    };
  });
  // Una etapa desconocida (p. ej. si algún día se retira del embudo) no puede tragarse
  // tarjetas en silencio: se muestran en la primera columna y se avisa.
  const huerfanas = wl.rows.filter(r => !ETAPA_KEYS.includes(r.stage));
  if (huerfanas.length) { columnas[0].items = columnas[0].items.concat(huerfanas); columnas[0].count += huerfanas.length; }

  const cerradas = st => db.prepare(
    "SELECT COUNT(*) n, COALESCE(SUM(amount),0) t FROM opportunities WHERE active=1 AND status=?"
  ).get(st);
  const g = cerradas('ganada'), p = cerradas('perdida');
  return {
    columnas,
    totalAbierto: wl.total,
    abiertas: wl.rows.length,
    pendientes: wl.pendientes,
    // Valor PONDERADO del embudo (Σ valor × probabilidad): lo que de verdad esperas cerrar.
    ponderado: r2(wl.rows.reduce((s, r) => s + (Number(r.amount) || 0) * (Number(r.probability) || 0) / 100, 0)),
    ganadas:  { count: g.n, total: r2(g.t) },
    perdidas: { count: p.n, total: r2(p.t) },
    huerfanas: huerfanas.length,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// SERVICIOS VALIDADOS — la ÚNICA vía de escritura. Los usan TANTO las rutas HTTP
// COMO DISA (que no hace INSERT directo, patrón T5/cobros). Errores con .status.
// La validación de esquema (zod) la hace quien llama a través de `validate()`, y el
// servicio REVALIDA lo que es regla de negocio (etapa viva, estado terminal, cliente real).
// ════════════════════════════════════════════════════════════════════════════

function nowISO(opts) { return opts?.now || new Date().toISOString(); }
function todayISO(opts) { return opts?.today || new Date().toISOString().slice(0, 10); }

function getClientOr404(db, clientId) {
  const cl = db.prepare('SELECT * FROM clients WHERE id=?').get(clientId);
  if (!cl) { const e = new Error('Cliente no encontrado'); e.status = 404; throw e; }
  if (!cl.active) { const e = new Error('Ese cliente está archivado: restáuralo antes de abrirle una oportunidad'); e.status = 400; throw e; }
  return cl;
}
export function getOpportunityOr404(db, id) {
  const o = db.prepare('SELECT * FROM opportunities WHERE id=?').get(id);
  if (!o) { const e = new Error('Oportunidad no encontrada'); e.status = 404; throw e; }
  return o;
}
// Guarda compartida: no se opera sobre una oportunidad archivada ni cerrada. Es el
// equivalente de isCobrable() — un solo sitio decide qué admite gestión.
function assertGestionable(o) {
  if (!o.active) { const e = new Error('Esa oportunidad está archivada'); e.status = 400; throw e; }
  if (o.status !== 'activa') {
    const e = new Error('Esa oportunidad ya está ' + (o.status === 'ganada' ? 'ganada' : 'perdida') + ': reábrela si quieres seguir trabajándola');
    e.status = 400; throw e;
  }
}

// Inserta una fila de actividad. Punto ÚNICO de escritura de client_activities.
function insertActivityRow(db, r) {
  return db.prepare(
    'INSERT INTO client_activities (client_id, opportunity_id, type, channel, stage, note, commitment_date, created_at, user_name, active) VALUES (?,?,?,?,?,?,?,?,?,1)'
  ).run(r.client_id, r.opportunity_id || null, r.type, r.channel || null, r.stage || null,
        r.note || null, r.commitment_date || null, r.created_at, r.user_name || '');
}

// ── Crear oportunidad ───────────────────────────────────────────────────────
// La probabilidad, si no la dan, la fija la etapa (como hacen Salesforce/HubSpot con su
// Probability por defecto). El usuario puede sobreescribirla; mover de etapa NO la pisa si
// la tocó a mano (ver moveOpportunityStageSvc).
export function createOpportunitySvc(db, input, opts = {}) {
  const d = input;
  getClientOr404(db, d.client_id);
  const stage = ETAPA_KEYS.includes(d.stage) ? d.stage : 'nuevo';
  const prob = (d.probability === undefined || d.probability === null || d.probability === '')
    ? ETAPA_PROB[stage] : Math.max(0, Math.min(100, Math.round(Number(d.probability))));
  const now = nowISO(opts);
  const r = db.prepare(
    'INSERT INTO opportunities (client_id, title, amount, stage, probability, expected_close_date, source, notes, status, stage_changed_at, created_at, active) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)'
  ).run(d.client_id, d.title, r2(d.amount || 0), stage, prob,
        d.expected_close_date || null, d.source || '', d.notes || '', 'activa', now, now);
  return { id: r.lastInsertRowid, title: d.title, stage, probability: prob, client_id: d.client_id };
}

// ── Editar oportunidad (campos, no ciclo) ───────────────────────────────────
// El ciclo (etapa/estado) se mueve por moveOpportunityStageSvc/closeOpportunitySvc, que
// dejan registro. Editar aquí la etapa a mano se saltaría ese registro.
export function updateOpportunitySvc(db, id, input) {
  const o = getOpportunityOr404(db, id);
  if (!o.active) { const e = new Error('Esa oportunidad está archivada'); e.status = 400; throw e; }
  const d = input;
  // Cambiar de cliente NO es "editar": se llevaría por delante el timeline del cliente viejo
  // (su actividad quedaría colgando de una oportunidad que ya no es suya). Se rechaza en voz
  // alta en vez de ignorarlo en silencio, que es peor.
  if (d.client_id !== undefined && Number(d.client_id) !== Number(o.client_id)) {
    const e = new Error('Una oportunidad no cambia de cliente: ciérrala y abre otra en el cliente correcto');
    e.status = 400; throw e;
  }
  const prob = (d.probability === undefined || d.probability === null || d.probability === '')
    ? o.probability : Math.max(0, Math.min(100, Math.round(Number(d.probability))));
  db.prepare('UPDATE opportunities SET title=?, amount=?, probability=?, expected_close_date=?, source=?, notes=? WHERE id=?')
    .run(d.title, r2(d.amount || 0), prob, d.expected_close_date || null, d.source || '', d.notes || '', id);
  return { id: Number(id), title: d.title };
}

// ── Mover de etapa (el drag & drop del Kanban y la voz de DISA) ─────────────
// Deja SIEMPRE registro (`cambio_etapa`) y reinicia el reloj de la etapa: los "días en la
// etapa" y la cadencia de silencio se miden desde aquí. Mover a la misma etapa no es un
// error silencioso: se rechaza (un drop sobre la propia columna no debe reiniciar el reloj).
export function moveOpportunityStageSvc(db, id, stage, opts = {}) {
  const o = getOpportunityOr404(db, id);
  assertGestionable(o);
  if (!ETAPA_KEYS.includes(stage)) {
    const e = new Error('Etapa no válida: ' + stage); e.status = 400; throw e;
  }
  if (o.stage === stage) {
    const e = new Error('La oportunidad ya está en «' + (ETAPA_LABEL[stage] || stage) + '»'); e.status = 400; throw e;
  }
  const now = nowISO(opts);
  // La probabilidad sigue a la etapa SALVO que el usuario la haya personalizado (≠ la de su
  // etapa actual): en ese caso se respeta su criterio; el motor no le pisa el juicio.
  const personalizada = Number(o.probability) !== Number(ETAPA_PROB[o.stage]);
  const prob = personalizada ? o.probability : ETAPA_PROB[stage];
  const desde = o.stage;
  db.transaction(() => {
    db.prepare('UPDATE opportunities SET stage=?, probability=?, stage_changed_at=? WHERE id=?').run(stage, prob, now, id);
    insertActivityRow(db, {
      client_id: o.client_id, opportunity_id: o.id, type: 'cambio_etapa', channel: null, stage,
      note: 'De «' + (ETAPA_LABEL[desde] || desde) + '» a «' + (ETAPA_LABEL[stage] || stage) + '»'
        + (opts.note ? ' · ' + opts.note : ''),
      commitment_date: null, created_at: now, user_name: opts.userName || '',
    });
  })();
  return { id: Number(id), from: desde, to: stage, probability: prob, title: o.title };
}

// ── Cerrar: GANADA o PERDIDA (estados terminales, con su registro) ──────────
// `perdida` EXIGE motivo (lista cerrada). Terminal no significa irreversible: reopen existe
// y también deja registro (un drop por error en un Kanban no puede ser un callejón sin salida).
export function closeOpportunitySvc(db, id, input, opts = {}) {
  const o = getOpportunityOr404(db, id);
  assertGestionable(o);
  const status = input.status;
  if (status !== 'ganada' && status !== 'perdida') { const e = new Error('Estado de cierre no válido'); e.status = 400; throw e; }
  if (status === 'perdida' && !MOTIVOS_PERDIDA.includes(input.lost_reason)) {
    const e = new Error('Para dar una oportunidad por perdida hace falta el motivo'); e.status = 400; throw e;
  }
  // Modelo híbrido de Pipedrive/Holded: picklist + texto libre. 'Otro' sin explicación no es un
  // motivo, es un agujero: el año que viene el embudo no te dirá nada de por qué se cayeron.
  if (status === 'perdida' && input.lost_reason === 'otro' && !String(input.note || '').trim()) {
    const e = new Error('Si el motivo es «Otro», cuéntame en una línea qué pasó'); e.status = 400; throw e;
  }
  const now = nowISO(opts);
  db.transaction(() => {
    db.prepare('UPDATE opportunities SET status=?, lost_reason=?, closed_at=?, probability=? WHERE id=?')
      .run(status, status === 'perdida' ? input.lost_reason : null, now, status === 'ganada' ? 100 : 0, id);
    insertActivityRow(db, {
      client_id: o.client_id, opportunity_id: o.id, type: 'cierre', channel: null, stage: o.stage,
      note: status === 'ganada'
        ? 'Ganada' + (input.note ? ' · ' + input.note : '')
        : 'Perdida — ' + (MOTIVO_PERDIDA_LABEL[input.lost_reason] || input.lost_reason) + (input.note ? ' · ' + input.note : ''),
      commitment_date: null, created_at: now, user_name: opts.userName || '',
    });
  })();
  return { id: Number(id), status, title: o.title, lost_reason: status === 'perdida' ? input.lost_reason : null };
}

// Reabrir una cerrada: vuelve a 'activa' en la etapa que tenía, con el reloj a cero y su
// registro. Sin esto, un drop equivocado sobre Ganado/Perdido sería irreparable.
export function reopenOpportunitySvc(db, id, opts = {}) {
  const o = getOpportunityOr404(db, id);
  if (!o.active) { const e = new Error('Esa oportunidad está archivada'); e.status = 400; throw e; }
  if (o.status === 'activa') { const e = new Error('Esa oportunidad ya está abierta'); e.status = 400; throw e; }
  const now = nowISO(opts);
  const desde = o.status;
  db.transaction(() => {
    db.prepare('UPDATE opportunities SET status=?, lost_reason=NULL, closed_at=NULL, probability=?, stage_changed_at=? WHERE id=?')
      .run('activa', ETAPA_PROB[o.stage] ?? 0, now, id);
    insertActivityRow(db, {
      client_id: o.client_id, opportunity_id: o.id, type: 'cambio_etapa', channel: null, stage: o.stage,
      note: 'Reabierta (estaba ' + (desde === 'ganada' ? 'ganada' : 'perdida') + ')',
      commitment_date: null, created_at: now, user_name: opts.userName || '',
    });
  })();
  return { id: Number(id), status: 'activa', stage: o.stage, title: o.title };
}

// Archivar (NUNCA borrar) — regla permanente del proyecto.
export function archiveOpportunitySvc(db, id) {
  const o = getOpportunityOr404(db, id);
  db.prepare('UPDATE opportunities SET active=0 WHERE id=?').run(id);
  return { id: Number(id), title: o.title };
}
export function restoreOpportunitySvc(db, id) {
  const o = getOpportunityOr404(db, id);
  db.prepare('UPDATE opportunities SET active=1 WHERE id=?').run(id);
  return { id: Number(id), title: o.title };
}

// ── REGISTRAR ACTIVIDAD DE CLIENTE (con o sin oportunidad, con o sin factura) ──
// Es la tabla hermana de collection_actions que el encargo pedía: aquí `invoice_id` no
// existe siquiera. Tipos:
//   contacto   → exige `channel` (llamada, whatsapp, reunión…). Solo registra.
//   nota       → nota libre. Solo registra.
//   compromiso → exige `commitment_date`. Pospone la próxima acción (espejo de promesa_pago).
//   email      → ENVÍA por Resend (opts.sendEmail inyectado) y registra. Confirm-first arriba.
// El envío usa el MISMO mailer que cobros y responde al dueño (replyTo), no a Bamburu.
export async function registerClientActivitySvc(db, clientId, input, opts = {}) {
  const cl = getClientOr404(db, clientId);
  const now = nowISO(opts);
  const type = input.type;
  if (!TIPOS_ACTIVIDAD.includes(type) || type === 'cambio_etapa' || type === 'cierre') {
    const e = new Error('Tipo de actividad no válido'); e.status = 400; throw e;   // los automáticos no se registran a mano
  }

  // Oportunidad opcional: si viene, debe existir y ser de ESTE cliente (nunca cruzar fichas).
  let opp = null;
  if (input.opportunity_id) {
    opp = getOpportunityOr404(db, input.opportunity_id);
    if (opp.client_id !== cl.id) { const e = new Error('Esa oportunidad no es de este cliente'); e.status = 400; throw e; }
  }

  if (type === 'contacto' && !CANALES.includes(input.channel)) {
    const e = new Error('Un contacto necesita canal (teléfono, WhatsApp, reunión…)'); e.status = 400; throw e;
  }
  if (type === 'compromiso' && !input.commitment_date) {
    const e = new Error('Un compromiso necesita la fecha en la que quedasteis'); e.status = 400; throw e;
  }

  let emailInfo = null;
  if (type === 'email') {
    if (!cl.email) { const e = new Error('Este cliente no tiene email al que escribirle'); e.status = 400; throw e; }
    if (typeof opts.sendEmail !== 'function') { const e = new Error('El envío de email no está configurado'); e.status = 500; throw e; }
    const company = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
    const prox = opp ? calcularProximaAccionOportunidad(opp, opportunityActivities(db, opp.id), todayISO(opts)) : null;
    const tono = input.tono || (prox && prox.tono) || 'primer-contacto';
    const tpl = opportunityEmail(tono, { client: cl, company, opp, db });
    // El usuario ve y puede editar asunto/cuerpo en el modal antes de enviar: si llegan, mandan.
    const subject = input.email_subject || tpl.subject;
    const text = input.email_text || tpl.text;
    const html = input.email_html || (input.email_text ? null : tpl.html);
    const empresa = company.company_name || 'Bamburu';
    const payload = { from: empresa + ' <noreply@bamburu.com>', to: cl.email, subject, ...(html ? { html } : {}), text };
    if (company.email) payload.replyTo = company.email;   // las respuestas van al autónomo
    const { data, error } = await opts.sendEmail(payload);   // Resend NO lanza: devuelve {data,error}
    if (error) { const e = new Error('No hemos podido enviar el email. Comprueba la dirección del destinatario e inténtalo más tarde.'); e.status = 502; throw e; }
    emailInfo = { sent: true, to: cl.email, subject, id: data && data.id };
  }

  const res = insertActivityRow(db, {
    client_id: cl.id, opportunity_id: opp ? opp.id : null, type,
    channel: type === 'email' ? 'email' : (input.channel || null),
    stage: opp ? opp.stage : null,
    note: input.note || null,
    commitment_date: type === 'compromiso' ? input.commitment_date : (input.commitment_date || null),
    created_at: now, user_name: opts.userName || '',
  });
  return { id: res.lastInsertRowid, type, client_id: cl.id, client_name: cl.name, opportunity_id: opp ? opp.id : null, email: emailInfo };
}

// ── Plantillas de email de SEGUIMIENTO comercial (server-side, remitente = el autónomo) ──
// Espejo de collectionEmail(): se precargan en el modal, el usuario las edita y confirma.
// Nada se envía aquí: esta función solo construye. Un comercial no amenaza: el último tono
// cierra el tema con elegancia, no advierte de "medidas oportunas".
//
// El tono 'reenganche' es el ÚNICO que NO habla de una oportunidad abierta, y por eso no usa
// `asuntoObra`. Lo usa la propuesta de CLIENTE DORMIDO, y se añadió porque encajarle 'seguimiento'
// producía un email sutilmente FALSO: "Retomo el hilo de tu solicitud" a alguien que no ha pedido
// nada. Un cliente que se fue nota esas cosas — que le escriban por un asunto que no existe es peor
// que no escribirle. Aquí no hay obra de la que retomar el hilo: hay una relación que se enfrió.
// Sin marketing, sin culpa ("te echamos de menos") y sin promesas: se saluda y se deja la puerta
// abierta. El dueño lo edita antes de enviarlo, siempre.
export function opportunityEmail(tono, ctx) {
  const { client, company, opp, db } = ctx;
  const vars = {
    cliente: (client && client.name) || 'cliente',
    asunto: (opp && opp.title) ? opp.title : 'tu solicitud',
    empresa: (company && company.company_name) || 'Nosotros',
  };
  return db ? renderEmail(db, 'comercial', tono, vars)
            : renderEmailFabrica('comercial', tono, vars);
}

// ════════════════════════════════════════════════════════════════════════════
// TIMELINE UNIFICADO DEL CLIENTE — las cuatro fuentes en una sola línea de tiempo.
//   1. OPORTUNIDADES  (opportunities: apertura y cierre)
//   2. ACTIVIDAD      (client_activities: contactos, notas, compromisos, emails, cambios de etapa)
//   3. DOCUMENTOS     (quotes/customer_orders/delivery_notes/invoices + document_links: la cadena)
//   4. COBROS         (invoice_payments + collection_actions: el motor de cobros que ya existía)
// No duplica nada: LEE de las tablas vivas y las ordena. Devuelve eventos ya normalizados
// { ts, kind, icon, title, detail, href, badge } de más reciente a más antiguo.
//
// PERMISOS: las cuatro fuentes tienen CUATRO permisos distintos (crm.read, quotes.read,
// pedidos.read, albaranes.read, invoices.read, cobros.read). Si el timeline las volcase todas
// por tener `crm.read`, sería una puerta trasera para leer facturas y cobros sin su llave.
// Por eso `opts.include` trocea las fuentes: quien llama pasa lo que el usuario puede ver.
// Por defecto TODO (los tests y la voz de DISA ya vienen gateados aguas arriba).
// ════════════════════════════════════════════════════════════════════════════
const CANAL_ICON = { email: 'ti-mail', telefono: 'ti-phone', whatsapp: 'ti-brand-whatsapp', reunion: 'ti-users', nota: 'ti-note', otro: 'ti-dots' };
const TIPO_ACT_ICON = { contacto: 'ti-phone', nota: 'ti-note', compromiso: 'ti-calendar-event', email: 'ti-mail', cambio_etapa: 'ti-arrow-right-circle', cierre: 'ti-flag' };

// Las fuentes del timeline, cada una con su permiso propio aguas arriba. Las cuatro últimas las
// añade la FICHA 360: agenda, proyectos, horas y notas.
export const TIMELINE_ALL = { oportunidades: true, actividad: true, quotes: true, orders: true, albaranes: true, invoices: true, cobros: true,
                              citas: true, proyectos: true, tiempo: true, notas: true };

export function clientTimeline(db, clientId, hoy, opts = {}) {
  const inc = { ...TIMELINE_ALL, ...(opts.include || {}) };
  const ev = [];
  const push = e => { if (e.ts) ev.push(e); };
  const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
  // En español: 286,77 € — no «€286.77». La línea de tiempo es de las pocas superficies que
  // escribían el dinero al revés, y se veía en la ficha de cliente entera.
  const money = n => Number(n || 0).toLocaleString('es-ES',
    { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }) + ' ' + sym;

  // 1) OPORTUNIDADES — apertura y cierre.
  for (const o of (inc.oportunidades ? db.prepare('SELECT * FROM opportunities WHERE client_id=? AND active=1 ORDER BY created_at').all(clientId) : [])) {
    // OJO: el evento de apertura NO pinta `o.stage`/`o.probability` — son el estado de HOY, y
    // contarían el pasado con datos del presente ("abierta en Negociación al 100%" es mentira).
    // La etapa de cada momento la cuentan los eventos `cambio_etapa`, que sí la congelaron.
    push({ ts: o.created_at, kind: 'oportunidad', icon: 'ti-target-arrow',
           title: 'Oportunidad abierta: ' + o.title,
           detail: [money(o.amount), o.source ? ORIGEN_LABEL[o.source] || o.source : '',
                    o.expected_close_date ? 'cierre previsto ' + o.expected_close_date : ''].filter(Boolean).join(' · '),
           badge: 'b-blue', opportunity_id: o.id });
    if (o.status !== 'activa' && o.closed_at) {
      push({ ts: o.closed_at, kind: 'oportunidad', icon: o.status === 'ganada' ? 'ti-trophy' : 'ti-circle-x',
             title: 'Oportunidad ' + (o.status === 'ganada' ? 'GANADA' : 'perdida') + ': ' + o.title,
             detail: money(o.amount) + (o.lost_reason ? ' · ' + (MOTIVO_PERDIDA_LABEL[o.lost_reason] || o.lost_reason) : ''),
             badge: o.status === 'ganada' ? 'b-green' : 'b-gray', opportunity_id: o.id });
    }
  }

  // 2) ACTIVIDAD registrada (la tabla hermana: existe sin factura detrás).
  const oppTitles = new Map(db.prepare('SELECT id, title FROM opportunities WHERE client_id=?').all(clientId).map(o => [o.id, o.title]));
  for (const a of (inc.actividad ? db.prepare('SELECT * FROM client_activities WHERE client_id=? AND active=1').all(clientId) : [])) {
    const t = a.type;
    const titulo = t === 'contacto'    ? 'Contacto por ' + (CANAL_LABEL[a.channel] || a.channel || 'otro')
                 : t === 'nota'        ? 'Nota'
                 : t === 'compromiso'  ? 'Compromiso para el ' + a.commitment_date
                 : t === 'email'       ? 'Email enviado'
                 : t === 'cambio_etapa'? 'Cambio de etapa'
                 : t === 'cierre'      ? 'Cierre de oportunidad'
                 : t;
    const opp = a.opportunity_id ? oppTitles.get(a.opportunity_id) : null;
    push({ ts: a.created_at, kind: 'actividad', icon: TIPO_ACT_ICON[t] || CANAL_ICON[a.channel] || 'ti-point',
           title: titulo,
           detail: [opp ? '«' + opp + '»' : '', a.note || '', a.user_name ? '— ' + a.user_name : ''].filter(Boolean).join(' · '),
           badge: '', opportunity_id: a.opportunity_id || null });
  }

  // 3) DOCUMENTOS del ciclo comercial + la cadena (document_links). Cada documento dice de
  //    dónde viene: "Presupuesto PRE-0007 → convertido en pedido PED-0003", etc.
  const linkFrom = (type, id) => db.prepare('SELECT dest_type, dest_id FROM document_links WHERE source_type=? AND source_id=?').all(type, id);
  const linkTo   = (type, id) => db.prepare('SELECT source_type, source_id FROM document_links WHERE dest_type=? AND dest_id=?').all(type, id);
  const DOC_LABEL = { quote: 'Presupuesto', order: 'Pedido', delivery_note: 'Albarán', invoice: 'Factura', ticket: 'Ticket' };
  const numOf = (type, id) => {
    const q = { quote: ['quotes', 'quote_number'], order: ['customer_orders', 'order_number'],
                delivery_note: ['delivery_notes', 'delivery_number'], invoice: ['invoices', 'invoice_number'],
                ticket: ['invoices', 'invoice_number'] }[type];
    if (!q) return '#' + id;
    const row = db.prepare('SELECT ' + q[1] + ' n FROM ' + q[0] + ' WHERE id=?').get(id);
    return row ? row.n : '#' + id;
  };
  // La cadena solo nombra documentos de un tipo que el usuario PUEDA ver: si no tiene
  // invoices.read, un presupuesto no le revela "→ Factura F-0007".
  const VISIBLE = { quote: inc.quotes, order: inc.orders, delivery_note: inc.albaranes, invoice: inc.invoices, ticket: inc.invoices };
  const cadena = (type, id) => {
    const partes = [];
    for (const l of linkTo(type, id))   if (VISIBLE[l.source_type]) partes.push('viene de ' + (DOC_LABEL[l.source_type] || l.source_type) + ' ' + numOf(l.source_type, l.source_id));
    for (const l of linkFrom(type, id)) if (VISIBLE[l.dest_type])   partes.push('→ ' + (DOC_LABEL[l.dest_type] || l.dest_type) + ' ' + numOf(l.dest_type, l.dest_id));
    return partes.join(' · ');
  };

  for (const q of (inc.quotes ? db.prepare('SELECT * FROM quotes WHERE client_id=?').all(clientId) : []))
    push({ ts: q.created_at, kind: 'documento', icon: 'ti-file-text', title: 'Presupuesto ' + (q.quote_number || ''),
           detail: [money(q.total), q.status, cadena('quote', q.id)].filter(Boolean).join(' · '),
           badge: q.status === 'anulado' ? 'b-gray' : 'b-blue', href: '/admin/quotes/' + q.id });

  for (const o of (inc.orders ? db.prepare('SELECT * FROM customer_orders WHERE client_id=?').all(clientId) : []))
    push({ ts: o.created_at, kind: 'documento', icon: 'ti-clipboard-list', title: 'Pedido ' + (o.order_number || ''),
           detail: [money(o.total), o.status, cadena('order', o.id)].filter(Boolean).join(' · '),
           badge: o.status === 'anulado' ? 'b-gray' : o.status === 'confirmado' ? 'b-blue' : 'b-yellow', href: '/admin/pedidos/' + o.id });

  for (const a of (inc.albaranes ? db.prepare('SELECT * FROM delivery_notes WHERE client_id=?').all(clientId) : []))
    push({ ts: a.created_at, kind: 'documento', icon: 'ti-truck-delivery', title: 'Albarán ' + (a.delivery_number || ''),
           detail: [money(a.total), a.status, cadena('delivery_note', a.id)].filter(Boolean).join(' · '),
           badge: a.status === 'anulado' ? 'b-gray' : 'b-green', href: '/admin/albaranes/' + a.id });

  for (const f of (inc.invoices ? db.prepare('SELECT * FROM invoices WHERE client_id=?').all(clientId) : []))
    push({ ts: f.created_at || (f.issue_date + 'T00:00:00'), kind: 'documento', icon: 'ti-file-invoice',
           title: 'Factura ' + (f.invoice_number || ''),
           detail: [money(f.total), f.status, cadena('invoice', f.id)].filter(Boolean).join(' · '),
           badge: f.status === 'anulada' ? 'b-gray' : 'b-blue', href: '/admin/invoices/' + f.id });

  // 4) COBROS — el motor que ya existía. Pagos y gestiones de cobro de las facturas del cliente.
  const invIds = inc.cobros ? db.prepare('SELECT id, invoice_number FROM invoices WHERE client_id=?').all(clientId) : [];
  const invNum = new Map(invIds.map(i => [i.id, i.invoice_number]));
  if (invIds.length) {
    const ph = invIds.map(() => '?').join(',');
    const ids = invIds.map(i => i.id);
    for (const p of db.prepare('SELECT * FROM invoice_payments WHERE invoice_id IN (' + ph + ')').all(...ids))
      push({ ts: p.created_at, kind: 'cobro', icon: 'ti-cash', title: 'Cobro de ' + money(p.amount),
             detail: ['Factura ' + (invNum.get(p.invoice_id) || ''), p.payment_method || '', p.note || ''].filter(Boolean).join(' · '),
             badge: 'b-green', href: '/admin/invoices/' + p.invoice_id });
    for (const a of db.prepare('SELECT * FROM collection_actions WHERE active=1 AND invoice_id IN (' + ph + ')').all(...ids)) {
      const titulo = a.type === 'recordatorio_email' ? 'Recordatorio de cobro enviado'
                   : a.type === 'promesa_pago' ? 'Promesa de pago para el ' + a.promised_date
                   : 'Gestión de cobro por ' + (CANAL_LABEL[a.channel] || a.channel || 'otro');
      push({ ts: a.created_at, kind: 'cobro', icon: a.type === 'promesa_pago' ? 'ti-calendar-event' : 'ti-bell',
             title: titulo, detail: ['Factura ' + (invNum.get(a.invoice_id) || ''), a.note || ''].filter(Boolean).join(' · '),
             badge: 'b-yellow', href: '/admin/invoices/' + a.invoice_id });
    }
  }

  // 5) AGENDA — las citas del cliente, incluidas las que NO salieron bien. Una cancelada y un
  // plantón son parte de su historia: esconderlos dejaría una ficha que solo cuenta lo bonito.
  // El estado sale tal cual del motor de agenda; aquí no se deduce ninguno.
  if (inc.citas) {
    let citas = [];
    try {
      citas = db.prepare(
        `SELECT c.*, GROUP_CONCAT(p.name, ' + ') AS servicios
           FROM citas c
           LEFT JOIN cita_servicios cs ON cs.cita_id = c.id
           LEFT JOIN products p ON p.id = cs.product_id
          WHERE c.cliente_id=? AND c.archived=0
          GROUP BY c.id`).all(clientId);
    } catch { citas = []; }
    const EST = { pedida: ['Cita pedida', 'b-yellow'], confirmada: ['Cita confirmada', 'b-blue'],
                  atendida: ['Vino a su cita', 'b-green'], no_show: ['NO SE PRESENTÓ', 'b-red'],
                  anulada: ['Cita anulada', 'b-gray'] };
    for (const c of citas) {
      const [tit, badge] = EST[c.estado] || ['Cita', 'b-gray'];
      push({ ts: c.fecha + 'T' + String(Math.floor(c.inicio_min / 60)).padStart(2, '0') + ':' + String(c.inicio_min % 60).padStart(2, '0') + ':00',
             kind: 'cita', icon: c.estado === 'no_show' ? 'ti-user-x' : 'ti-calendar-event',
             title: tit + (c.codigo ? ' · ' + c.codigo : ''),
             detail: [c.servicios || '', c.dur_min ? c.dur_min + ' min' : ''].filter(Boolean).join(' · '),
             badge, href: '/admin/citas' });
    }
  }

  // 6) PROYECTOS Y HORAS. Las horas NO tienen cliente: cuelgan del proyecto, y el proyecto sí lo
  // tiene. Se leen A TRAVÉS DEL PROYECTO — no se añade cliente a las entradas de tiempo, que sería
  // duplicar un dato que ya se sabe. Cada permiso por separado: se pueden ver proyectos sin ver horas.
  if (inc.proyectos || inc.tiempo) {
    let proys = [];
    try { proys = db.prepare('SELECT * FROM proyectos WHERE cliente_id=? AND active=1').all(clientId); } catch { proys = []; }
    if (inc.proyectos) for (const p of proys)
      push({ ts: p.created_at || (p.fecha_inicio ? p.fecha_inicio + 'T00:00:00' : null), kind: 'proyecto', icon: 'ti-folders',
             title: 'Proyecto ' + (p.codigo || '') + (p.nombre ? ' · ' + p.nombre : ''),
             detail: [p.estado || '', p.modo_cobro || ''].filter(Boolean).join(' · '),
             badge: p.estado === 'cerrado' ? 'b-gray' : 'b-blue', href: '/admin/proyectos' });
    if (inc.tiempo && proys.length) {
      const ph = proys.map(() => '?').join(',');
      const nom = new Map(proys.map(p => [p.id, p.codigo || p.nombre || '']));
      let ent = [];
      try {
        ent = db.prepare(
          `SELECT * FROM time_entries WHERE active=1 AND duracion_seg IS NOT NULL AND proyecto_id IN (${ph}) ORDER BY fecha DESC LIMIT 200`
        ).all(...proys.map(p => p.id));
      } catch { ent = []; }
      for (const t of ent) {
        const h = Math.floor((t.duracion_seg || 0) / 3600), m = Math.round(((t.duracion_seg || 0) % 3600) / 60);
        push({ ts: t.fecha + 'T00:00:00', kind: 'tiempo', icon: 'ti-clock-play',
               title: (h ? h + ' h ' : '') + (m ? m + ' min' : (h ? '' : '—')) + ' en ' + (nom.get(t.proyecto_id) || 'un proyecto'),
               detail: [t.descripcion || '', t.facturable ? 'facturable' : 'no facturable'].filter(Boolean).join(' · '),
               badge: t.facturable ? 'b-blue' : 'b-gray', href: '/admin/tiempo' });
      }
    }
  }

  // 7) CORREOS DE CITA. Ojo con lo que se promete: el sistema sabe que se PULSÓ el botón, no que el
  // mensaje llegara. Por eso pone «marcado como enviado» y nunca «entregado» — el mismo texto que
  // usa la cola de envíos. Los correos del CRM ya entran arriba, como actividad.
  if (inc.citas) {
    let avisos = [];
    try {
      avisos = db.prepare(
        `SELECT a.*, c.codigo FROM cita_avisos a JOIN citas c ON c.id = a.cita_id
          WHERE c.cliente_id=? ORDER BY a.id DESC LIMIT 100`).all(clientId);
    } catch { avisos = []; }
    const CANAL = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'email' };
    for (const a of avisos)
      push({ ts: a.created_at || a.enviado_at, kind: 'aviso', icon: 'ti-send',
             title: (a.tipo === 'recordatorio' ? 'Recordatorio' : 'Confirmación') + ' por ' + (CANAL[a.canal] || a.canal || '—'),
             detail: 'marcado como enviado' + (a.codigo ? ' · ' + a.codigo : ''), badge: 'b-gray', href: '/admin/citas/cola' });
  }

  // 8) NOTAS A MANO — lo único que esta ficha escribe. Van con autor y fecha.
  if (inc.notas) {
    let notas = [];
    try { notas = db.prepare('SELECT * FROM client_notes WHERE client_id=? AND active=1').all(clientId); } catch { notas = []; }
    for (const n of notas)
      push({ ts: n.created_at, kind: 'nota', icon: 'ti-note',
             title: n.texto.length > 90 ? n.texto.slice(0, 90) + '…' : n.texto,
             detail: (n.user_name || 'alguien') + (n.updated_at ? ' · editada' : ''), badge: 'b-yellow', nota_id: n.id });
  }

  // Más reciente arriba. `created_at` de las tablas viejas es 'YYYY-MM-DD HH:MM:SS' y el de las
  // nuevas es ISO con 'T': se normaliza para que el orden sea el real y no alfabético por accidente.
  const norm = s => String(s || '').replace(' ', 'T');
  return ev.sort((a, b) => norm(b.ts).localeCompare(norm(a.ts)));
}

// Resumen del cliente para la ficha y para la voz de DISA: sus oportunidades abiertas con
// próxima acción, más los totales ganado/perdido. Reutiliza el motor (cero cálculo nuevo).
export function clientCrmSummary(db, clientId, hoy) {
  const opps = db.prepare('SELECT * FROM opportunities WHERE client_id=? AND active=1 ORDER BY created_at DESC').all(clientId);
  const abiertas = opps.filter(o => o.status === 'activa').map(o => ({
    ...o,
    stage_label: ETAPA_LABEL[o.stage] || o.stage,   // la ficha pinta sin mapas propios (fuente única)
    dias_en_etapa: diasEnEtapa(o, hoy),
    proximaAccion: calcularProximaAccionOportunidad(o, opportunityActivities(db, o.id), hoy),
  }));
  const sum = arr => r2(arr.reduce((s, o) => s + (Number(o.amount) || 0), 0));
  return {
    client_id: Number(clientId),
    abiertas: priorizarOportunidades(abiertas, hoy),
    valorAbierto: sum(abiertas),
    ganadas:  { count: opps.filter(o => o.status === 'ganada').length,  total: sum(opps.filter(o => o.status === 'ganada')) },
    perdidas: { count: opps.filter(o => o.status === 'perdida').length, total: sum(opps.filter(o => o.status === 'perdida')) },
  };
}
