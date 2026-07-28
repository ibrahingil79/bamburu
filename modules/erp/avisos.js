// Paso (d) — MOTOR PROACTIVO DE AVISOS (general). Un colector de FUENTES: cada fuente es una
// función(db, today) → lista de avisos normalizados. avisosDelDia agrega todas las fuentes y
// las ordena por urgencia. Nace general A PROPÓSITO: añadir mañana una fuente (cobros de
// cliente, stock bajo, etc.) es registrar UNA función en SOURCES — nada más se rehace.
//
// El motor SOLO LEE (no escribe, no migra, no toca stock/WAC ni la cadena de hash) — salvo la
// huella de "visto", que es estado de UI. Fuentes conectadas: registros Verifactu sin remitir,
// vencimientos de proveedor, cobros de cliente vencidos, clientes en riesgo (CRM), stock bajo y
// borradores de recurrentes. Lo consumen cuatro superficies: la pantalla central (/admin/avisos),
// la campana del topbar, el Inicio y el email diario (scripts/bamburu-avisos.mjs). Todas cuentan
// LO MISMO porque todas leen de aquí.

import { renderEmail, renderEmailFabrica, TONO_UNICO } from './email-templates.js';
import { openPayables } from './pagos.js';
import { openDebts } from './cobros.js';
import { MAX_INTENTOS } from './verifactu-cola.js';
import { salesWorklist } from './crm.js';
import { productosBajoMinimo } from './reposicion.js';
// PIEZA 6 · solicitudes de cita por Internet. Se importa del módulo HOJA a propósito: reserva-publica.js
// depende de routes/citas.js → layout.js → este mismo fichero, y el círculo dejaría PERM_POR_FUENTE en
// zona muerta al arrancar. La hoja solo depende de citas-engine.js.
import { reservasPublicasPendientes } from './reserva-publica-config.js';

const r2 = n => Math.round(n * 100) / 100;

// "Hoy" en la fecha LOCAL del negocio, no en UTC. El servidor corre en UTC, así que entre las 00:00
// y las 02:00 de España `new Date().toISOString().slice(0,10)` seguía devolviendo el día ANTERIOR:
// una factura que acababa de vencer no salía como vencida, y desaparecía de la campana hasta las 2
// de la madrugada. Las fechas de vencimiento son días de calendario, no instantes.
export const ZONA_NEGOCIO = 'Europe/Madrid';   // España (CANON: cumplimiento legal ES). Multi-país: T.O.D.O.
export function hoyLocal(tz = ZONA_NEGOCIO) {
  // 'en-CA' formatea como AAAA-MM-DD, que es justo el formato que usa todo el motor.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}

// Días entre dos fechas YYYY-MM-DD (a - b), en UTC. Mismo criterio que pagos/cobros.
function daysBetween(a, b) {
  return Math.floor((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
}

// Forma normalizada de un aviso (lo que toda fuente devuelve):
//   { tipo, urgencia, titulo, detalle, ref }
//   urgencia: número; mayor = más arriba. Convención: vencido = 1000 + días vencida;
//             por vencer = 100 - días que faltan (cuanto menos falta, más urgente).
//   ref: { source, ...identificadores } para que el consumidor enlace al documento.

// ── FUENTE: facturas de proveedor que vencen en ≤7 días o ya vencidas ───────────────
// Reutiliza openPayables (torre de control de pagos, solo lectura). Excluye abonos (crédito
// a tu favor: pendiente<0) y lo ya pagado. Ordena: vencido primero (más vencido arriba),
// luego lo que vence antes.
export function vencimientosProveedor(db, today) {
  const t = today || hoyLocal();
  const { rows } = openPayables(db, t);
  const avisos = [];
  for (const f of rows) {
    if (!(f.pendiente > 0.0049)) continue;                 // abonos / saldados → fuera
    const due = f.due_date;
    if (!due) continue;
    const vencida = f.dias_vencida > 0;                    // openPayables ya da días vencida
    const faltan = daysBetween(due, t);                    // due - hoy: >0 = aún no vence
    if (!vencida && !(faltan >= 0 && faltan <= 7)) continue;   // ni vencida ni próxima → fuera

    const ref = {
      source: 'vencimientos_proveedor',
      supplier_id: f.supplier_id, supplier_name: f.supplier_name,
      supplier_invoice_id: f.supplier_invoice_id, internal_code: f.internal_code,
      due_date: due, pendiente: r2(f.pendiente),
      vencida, dias_vencida: f.dias_vencida || 0, dias_para_vencer: vencida ? 0 : faltan,
    };
    const titulo = (f.supplier_name || 'Proveedor') + ' · ' + (f.internal_code || ('#' + f.supplier_invoice_id));
    avisos.push({
      tipo: 'vencimiento_proveedor',
      urgencia: vencida ? (1000 + f.dias_vencida) : (100 - faltan),
      titulo, ref,   // el detalle lo redacta detalleAviso() (necesita el símbolo de moneda)
    });
  }
  avisos.sort((a, b) => b.urgencia - a.urgencia);
  return avisos;
}

// ── FUENTE: facturas de CLIENTE vencidas (te deben dinero) ──────────────────────────
// Espejo exacto de vencimientosProveedor, pero del otro lado del dinero. Reutiliza openDebts
// (torre de control de cobros, solo lectura): ese motor ya decide qué factura cuenta como deuda
// (countsAsReceivable: fuera anuladas, sustituidas y abonos), ya suma los cobros parciales y ya
// marca `estado === 'vencida'` cuando queda pendiente y pasó el vencimiento. Aquí NO se recalcula
// nada de eso: se filtra y se normaliza.
//
// Solo VENCIDAS (a diferencia de proveedor, que además avisa de lo que vence en ≤7 días): lo que
// aún no ha vencido no es un aviso, es el pipeline normal de /admin/cobros.
export function cobrosVencidos(db, today) {
  const t = today || hoyLocal();
  const { rows } = openDebts(db, t);
  const avisos = [];
  for (const d of rows) {
    if (d.estado !== 'vencida') continue;                  // pendiente pero aún en plazo → fuera
    if (!(d.pendiente > 0.0049)) continue;                 // guarda: openDebts ya lo filtra
    const ref = {
      source: 'cobros_vencidos',
      client_id: d.client_id, client_name: d.client_name,
      invoice_id: d.invoice_id, invoice_number: d.invoice_number,
      due_date: d.due_date, pendiente: r2(d.pendiente),
      dias_vencida: d.dias_vencida || 0, tramo: d.tramo || null,
    };
    avisos.push({
      tipo: 'cobro_vencido',
      urgencia: 1000 + (d.dias_vencida || 0),              // misma convención que lo vencido de proveedor
      titulo: (d.client_name || 'Cliente') + ' · ' + (d.invoice_number || ('#' + d.invoice_id)),
      ref,
    });
  }
  avisos.sort((a, b) => b.urgencia - a.urgencia);
  return avisos;
}

// ── FUENTE: productos BAJO SU MÍNIMO de stock (por almacén) ──────────────────────────
// Reemplaza la vieja heurística de umbral FIJO (stock<5 sobre la caché global) por el mínimo REAL que el
// dueño configura por (producto, almacén) — ver reposicion.js. Un aviso por almacén que cae por debajo de
// SU mínimo, medido contra el DISPONIBLE (físico − reservado). Un producto sin proveedor habitual también
// avisa, pero diciendo que le asigne uno para poder prepararle la compra (no se lo inventa). Sigue siendo
// una FUENTE del motor: badge y resumen cuentan lo mismo. (`today` no se usa: el mínimo no depende del día.)
export function stockBajo(db, today) {
  return productosBajoMinimo(db).map(e => ({
    tipo: 'stock_bajo',
    urgencia: 50 - Number(e.disponible || 0),   // menos disponible = más arriba (misma banda que antes)
    titulo: e.product_name,
    detalle: 'Bajo mínimo en ' + e.warehouse_name + ': ' + e.disponible + ' disponible' + (e.disponible === 1 ? '' : 's')
      + ' (mínimo ' + e.min_qty + ')'
      + (e.supplier_id && e.supplier_name ? '' : ' — asígnale un proveedor para prepararte la compra'),
    ref: { source: 'stock_bajo', product_id: e.product_id, warehouse_id: e.warehouse_id,
           disponible: e.disponible, min_qty: e.min_qty, sin_proveedor: !(e.supplier_id && e.supplier_name) },
  }));
}

// Borradores de FACTURAS RECURRENTES pendientes de revisar/emitir (Bloque A). Query inline para no
// crear dependencia entre avisos y recurrentes.
export function borradoresRecurrentes(db, today) {
  const rows = db.prepare(`SELECT o.id, o.due_date, t.document_name, COALESCE(c.name,'—') client_name
      FROM recurring_occurrences o JOIN recurring_templates t ON t.id=o.template_id
      LEFT JOIN clients c ON c.id=t.client_id WHERE o.status='borrador' ORDER BY o.due_date`).all();
  return rows.map(o => ({
    tipo: 'factura_recurrente',
    urgencia: 200,     // por encima de stock bajo, por debajo de lo vencido
    titulo: `${o.document_name} recurrente · ${o.client_name}`,
    detalle: `Borrador listo para revisar y emitir (fecha ${o.due_date})`,
    ref: { source: 'factura_recurrente', occurrence_id: o.id },
  }));
}

// ── FUENTE: registros Verifactu que NO llegaron a la AEAT y ya no llegarán solos ───────────────
// La cola (verifactu-cola.js) reintenta sola los fallos de comunicación. Aquí solo aparece lo que
// quedó en punto muerto y necesita a una persona:
//   · rechazado ('incorrecto') — la AEAT lo tumbó (p. ej. NIF no censado). Reenviar el mismo XML da
//     el mismo rechazo: hay que corregir la factura.
//   · bloqueado ('bloqueado_datos') — falta un dato obligatorio; el registro ni salió (nunca se
//     inventa un dato para poder enviar).
//   · comunicación agotada — se gastaron los MAX_INTENTOS de la cola.
// Lo que sigue en reintento NO avisa (todavía se está resolviendo solo), y lo aceptado tampoco.
// Urgencia por encima de todo lo demás a propósito: un registro de facturación sin remitir es un
// problema legal, y no debe poder quedar sepultado bajo facturas vencidas (cuya urgencia crece con
// los días). Es un número: si el dueño lo prefiere más abajo, se baja aquí y solo aquí.
export function enviosVerifactu(db, today) {
  let rows;
  try {
    rows = db.prepare(`SELECT e.registro_id, e.estado, e.intentos, e.codigo_error, e.descripcion_error, e.aviso,
                              r.num_serie, r.fecha_expedicion
        FROM verifactu_envios e JOIN verifactu_registros r ON r.id = e.registro_id
       WHERE r.record_type='alta'
         AND ( e.estado IN ('incorrecto','bloqueado_datos')
            OR (e.estado='error_comunicacion' AND e.intentos >= ?) )
       ORDER BY e.registro_id`).all(MAX_INTENTOS);
  } catch {
    return [];   // tenant sin el esquema de Verifactu todavía
  }
  return rows.map(r => {
    const detalle = r.estado === 'incorrecto'
      ? 'La AEAT rechazó el registro' + (r.codigo_error ? ' (error ' + r.codigo_error + ')' : '') + ': ' + (r.descripcion_error || 'sin descripción') + '. Corrige la factura y vuelve a enviarlo.'
      : r.estado === 'bloqueado_datos'
        ? 'No se envió por falta de datos: ' + (r.aviso || 'revisa la factura') + '.'
        : 'No se pudo comunicar con la AEAT tras ' + r.intentos + ' intentos: ' + (r.descripcion_error || 'sin respuesta') + '.';
    return {
      tipo: 'envio_verifactu',
      urgencia: 2000,
      titulo: 'Verifactu · factura ' + r.num_serie + ' sin remitir a la AEAT',
      detalle,
      ref: { source: 'envio_verifactu', registro_id: r.registro_id, num_serie: r.num_serie, estado: r.estado },
    };
  });
}

// ── FUENTE: oportunidades del CRM cuyo seguimiento ya venció ("cliente en riesgo") ──────────────
// NO define un criterio propio: se lo pregunta al CRM. `salesWorklist` ya recorre las oportunidades
// ABIERTAS (status='activa' AND active=1), les calcula su próxima acción con
// `calcularProximaAccionOportunidad` y marca `accionPendiente` = "su fecha ya pasó". Escribir aquí
// la regla otra vez habría creado una segunda verdad, que se desincroniza con /admin/crm/cola en
// cuanto alguien toque una cadencia.
//
// Qué cuenta como vencido, según ese motor (las tres ramas, siempre con la oportunidad abierta):
//   · el cierre previsto (`expected_close_date`) ya pasó  → el CRM lo llama etapa 'en_riesgo'
//   · el silencio supera la cadencia de su etapa          → toca seguimiento
//   · se incumplió un compromiso (`commitment_date`)      → sube el tono y reanuda el seguimiento
// Lo que NO cuenta: un compromiso VIVO (fecha futura). El CRM dice "no insistas hasta esa fecha", y
// el aviso lo respeta: avisar ahí sería contradecir a la propia pantalla que te manda esperar.
export function clientesEnRiesgo(db, today) {
  const t = today || hoyLocal();
  let rows;
  try { rows = salesWorklist(db, t).rows; }
  catch { return []; }                                   // tenant sin el esquema del CRM todavía
  const avisos = [];
  for (const o of rows) {
    if (!o.accionPendiente) continue;
    const pa = o.proximaAccion || {};
    const retraso = pa.fechaObjetivo ? Math.max(0, daysBetween(t, pa.fechaObjetivo)) : 0;
    avisos.push({
      tipo: 'cliente_en_riesgo',
      // Entre la recurrente (200) y el dinero vencido (1000+). Una oportunidad que se enfría
      // importa, pero jamás debe tapar una factura sin cobrar ni un registro sin remitir a la
      // AEAT. El retraso ordena DENTRO de la fuente, y va topado para no escalar fuera de banda.
      urgencia: 300 + Math.min(retraso, 99),
      titulo: (o.client_name || 'Cliente') + ' · ' + (o.title || 'Oportunidad'),
      detalle: pa.motivo || 'Su próxima acción comercial ya venció.',
      ref: {
        source: 'clientes_en_riesgo',
        opportunity_id: o.id, client_id: o.client_id, client_name: o.client_name,
        title: o.title, amount: r2(o.amount || 0), stage: o.stage,
        accion: pa.accion || null, fecha_objetivo: pa.fechaObjetivo || null, retraso,
      },
    });
  }
  avisos.sort((a, b) => b.urgencia - a.urgencia);
  return avisos;
}

// Cada fuente lleva el MISMO permiso que ya exige su pantalla de origen. Un aviso no puede ser una
// puerta trasera a datos que su pantalla te niega: quien no puede abrir /admin/cobros tampoco puede
// leer "te deben 15,61 € de la factura F2026-0017" en la campana.
//   envio_verifactu       → /admin/verifactu/envios  (invoices.read)
//   vencimiento_proveedor → /admin/pagos             (purchases.read)
//   cobro_vencido         → /admin/cobros            (cobros.read)
//   stock_bajo            → /admin/inventory         (inventory.read)
//   factura_recurrente    → /admin/recurrentes       (recurrentes.read)
//   cliente_en_riesgo     → /admin/crm/cola          (crm.read)
//   reserva_publica       → /admin/citas              (citas.read)
// (reserva_publica lleva citas.read, no citas.edit, PORQUE ESE ES SU ORIGEN: lo que el aviso enseña
//  —cliente, día y hora— es exactamente lo que ya se ve en la agenda con citas.read. Los BOTONES de
//  aprobar/rechazar viven en /admin/citas/publica y sí exigen citas.edit; el aviso solo avisa.)
export const PERM_POR_FUENTE = {
  envio_verifactu:       'invoices.read',
  vencimiento_proveedor: 'purchases.read',
  cobro_vencido:         'cobros.read',
  stock_bajo:            'inventory.read',
  factura_recurrente:    'recurrentes.read',
  cliente_en_riesgo:     'crm.read',
  reserva_publica:       'citas.read',
};

// Fuentes registradas. Añadir una fuente = escribir la función, registrarla aquí y darle su permiso
// en PERM_POR_FUENTE. Sin permiso declarado, la fuente NO se sirve a nadie (falla cerrado).
const SOURCES = [
  { tipo: 'envio_verifactu',       fn: enviosVerifactu },
  { tipo: 'vencimiento_proveedor', fn: vencimientosProveedor },
  { tipo: 'cobro_vencido',         fn: cobrosVencidos },
  { tipo: 'cliente_en_riesgo',     fn: clientesEnRiesgo },
  { tipo: 'stock_bajo',            fn: stockBajo },
  { tipo: 'factura_recurrente',    fn: borradoresRecurrentes },
  // PIEZA 6 — registrar la fuente aquí es TODO lo que hace falta para que las solicitudes de cita por
  // Internet aparezcan en la campana, en /admin/avisos, en el Inicio y en el email diario. Esos son
  // "los canales que ya hay": cero mensajería nueva.
  { tipo: 'reserva_publica',       fn: reservasPublicasPendientes },
];

// Todos los avisos del día, ordenados por urgencia (más urgente arriba). Robusto: si una fuente
// peta, se ignora esa fuente y siguen las demás (un fallo aislado no silencia todo el aviso).
//
// `tipos` = conjunto de fuentes que quien pregunta TIENE DERECHO a ver. Las demás ni se ejecutan:
// además de cerrar la fuga, ahorra el escaneo caro (openDebts) a quien no puede verlo. Omitirlo
// (undefined) devuelve todas las fuentes — es el caso del email diario, que va al negocio y no a
// un usuario. Pasar un conjunto vacío devuelve cero avisos: falla cerrado, no abierto.
export function avisosDelDia(db, today, tipos) {
  const t = today || hoyLocal();
  const puede = tipos === undefined ? () => true : x => tipos.has(x);
  const todos = [];
  for (const src of SOURCES) {
    if (!puede(src.tipo)) continue;
    try { todos.push(...src.fn(db, t)); } catch { /* fuente caída: se omite, las demás siguen */ }
  }
  todos.sort((a, b) => b.urgencia - a.urgencia);
  return todos;
}

// ── Plantilla de email del RESUMEN DIARIO (espejo de collectionEmail) ───────────────
// Server-side, español. Devuelve { subject, html, text }. Nada se envía aquí: solo construye.
// El remitente es el negocio (igual que cobros: from noreply@bamburu.com, replyTo = su email).
export function avisosEmail(ctx) {
  const { avisos, company, db } = ctx;
  const sym = (company && company.currency_symbol) || '€';
  const n = avisos.length;
  const groups = resumenAvisos(avisos);                  // [{tipo, count, frase}] en orden estable

  const BLOQUE = {
    vencimiento_proveedor: 'Facturas de proveedor (vencidas o que vencen en ≤7 días)',
    cobro_vencido: 'Facturas de cliente vencidas (te deben)',
    cliente_en_riesgo: 'Clientes en riesgo (seguimiento comercial vencido)',
    factura_recurrente: 'Facturas recurrentes en borrador',
    reserva_publica: 'Solicitudes de cita por Internet (pendientes de aprobar)',
    stock_bajo: 'Productos bajo su mínimo de stock',
  };
  const filaDetalle = a => detalleAviso(a, sym, { compacto: true });

  // La LISTA es un bloque que genera el sistema (un bloque por fuente, con sus filas ya ordenadas por
  // urgencia). El dueño la coloca donde quiera con {{avisos}}, pero no la teclea: la pone Bamburu.
  const bloquesHtml = [];
  for (const g of groups) {
    const items = avisos.filter(a => a.tipo === g.tipo);
    const titulo = (BLOQUE[g.tipo] || g.tipo) + ' (' + items.length + ')';
    const rows = items.map(a => {
      const vencido = a.tipo === 'cobro_vencido' || (a.tipo === 'vencimiento_proveedor' && a.ref && a.ref.vencida);
      const color = vencido ? '#b42318' : '#1f2937';
      return '<tr><td style="padding:6px 8px;font-weight:600">' + escapeHtml(a.titulo) + '</td>'
        + '<td style="padding:6px 8px;color:' + color + '">' + escapeHtml(filaDetalle(a)) + '</td></tr>';
    }).join('');
    bloquesHtml.push('<p style="margin:16px 0 6px;font-weight:700">' + escapeHtml(titulo) + '</p>'
      + '<table style="border-collapse:collapse;width:100%;background:#f9fafb;border-radius:8px">' + rows + '</table>');
  }

  const vars = {
    empresa: (company && company.company_name) || 'tu negocio',
    n: String(n),
    resumen: groups.map(g => g.frase).join('; '),
    avisos: { esHtml: true, valor: bloquesHtml.join('') },
  };
  return db ? renderEmail(db, 'resumen_avisos', TONO_UNICO, vars)
            : renderEmailFabrica('resumen_avisos', TONO_UNICO, vars);
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// ════════════════════════════════════════════════════════════════════════════
// RESUMEN-PRIMERO (badge) + ESTADO visto/nuevo (Opción C). El badge NO lanza una pregunta
// abierta a DISA: muestra este RESUMEN DE CONTEOS, derivado de las mismas fuentes del motor.
// ════════════════════════════════════════════════════════════════════════════

// Clave estable de un aviso para la HUELLA de "visto" (identidad, NO gravedad): una factura
// que empeora (vence en 5d → vencida) conserva su clave → no cuenta como nuevo.
// La clave viaja al cliente (atributo data-key) para marcar ESE aviso como visto: debe ser corta
// y sin comillas. Antes `factura_recurrente` caía al caso genérico y salía un JSON entero.
// ÚNICO formateador del detalle de un aviso. `sym` = símbolo de moneda del negocio (el motor no lo
// conoce: se lo pasa quien pinta). `compacto` = la celda estrecha del email; largo = la pantalla.
// Antes había TRES casi idénticos (el del motor, el del email y el de la pantalla), y el del motor
// se calculaba solo para que la pantalla lo pisara: trabajo muerto en cada render. Cambiar cómo se
// redacta un vencimiento ahora se hace en un sitio, y la pantalla, el correo y el panel no discrepan.
export function detalleAviso(a, sym = '', { compacto = false } = {}) {
  const r = (a && a.ref) || {};
  const dinero = n => sym + Number(n || 0).toFixed(2);
  const dias = n => n + ' día' + (n === 1 ? '' : 's');

  if (a.tipo === 'cobro_vencido') {
    return compacto
      ? 'vencida hace ' + r.dias_vencida + 'd · te deben ' + dinero(r.pendiente)
      : 'Te deben ' + dinero(r.pendiente) + ' · vencida hace ' + dias(r.dias_vencida) + ' (' + (r.due_date || '-') + ')';
  }
  if (a.tipo === 'vencimiento_proveedor') {
    if (compacto) {
      const e = r.vencida ? 'vencida hace ' + r.dias_vencida + 'd'
        : (r.dias_para_vencer === 0 ? 'vence hoy' : 'vence en ' + r.dias_para_vencer + 'd');
      return e + ' · pendiente ' + dinero(r.pendiente);
    }
    const e = r.vencida
      ? 'Vencida hace ' + dias(r.dias_vencida)
      : (r.dias_para_vencer === 0 ? 'Vence HOY' : 'Vence en ' + dias(r.dias_para_vencer)) + ' (' + (r.due_date || '-') + ')';
    return e + ' · pendiente ' + dinero(r.pendiente);
  }
  if (a.tipo === 'stock_bajo' && compacto) return r.disponible + ' disp · mín ' + r.min_qty;
  // El motivo largo del CRM ("El cierre previsto era el… decide si la ganas…") no cabe en la celda
  // estrecha del email: ahí va el retraso, que es el dato que hace actuar.
  if (a.tipo === 'cliente_en_riesgo' && compacto) {
    return r.retraso > 0 ? 'seguimiento vencido hace ' + r.retraso + 'd' : 'el seguimiento toca hoy';
  }
  return a.detalle || '';
}

// La clave identifica un aviso a lo largo del tiempo (para la huella de "visto"). Es identidad, NO
// gravedad: una factura que empeora conserva su clave y no vuelve a contar como nueva.
//
// OJO al cambiar una rama: la huella guardada NO se migra. `factura_recurrente` caía antes al caso
// genérico ('factura_recurrente:{...json...}') y pasó a 'fr:<id>' para poder viajar dentro de un
// atributo data-key sin comillas. Efecto de UNA sola vez tras ese despliegue: los borradores de
// recurrentes ya descartados reaparecen como no vistos y reencienden la campana. Está documentado a
// propósito, no se revierte: la clave vieja era insegura en el DOM.
export function avisoKey(a) {
  const r = (a && a.ref) || {};
  if (r.source === 'vencimientos_proveedor') return 'vp:' + r.supplier_invoice_id;
  if (r.source === 'cobros_vencidos') return 'cv:' + r.invoice_id;
  if (r.source === 'stock_bajo') return 'sb:' + r.product_id + ':' + r.warehouse_id;
  if (r.source === 'factura_recurrente') return 'fr:' + r.occurrence_id;
  if (r.source === 'envio_verifactu') return 'vf:' + r.registro_id;
  // Identidad = la oportunidad, no su gravedad: si pasa de "toca seguimiento" a "cierre vencido",
  // conserva su clave y no reaparece como nueva (mismo criterio que la factura que empeora).
  if (r.source === 'clientes_en_riesgo') return 'cr:' + r.opportunity_id;
  // Igual aquí: la identidad es la SOLICITUD, no lo que le queda de vida. Sin este caso la clave caía
  // al genérico (JSON de todo el ref, con horas_restantes dentro) y el aviso reaparecía como nuevo cada
  // hora por mucho que el dueño lo hubiera marcado visto.
  if (r.source === 'reserva_publica') return 'rp:' + r.cita_id;
  return (r.source || (a && a.tipo) || '?') + ':' + (r.id != null ? r.id : JSON.stringify(r));
}

// Frase por tipo de fuente (singular/plural). Mapa = la cara legible de cada fuente del motor.
const TIPO_FRASE = {
  envio_verifactu: n => n + ' factura' + (n === 1 ? '' : 's') + ' sin remitir a la AEAT (Verifactu)',
  vencimiento_proveedor: n => n + ' factura' + (n === 1 ? '' : 's') + ' de proveedor que vence' + (n === 1 ? '' : 'n') + ' o ' + (n === 1 ? 'está' : 'están') + ' vencida' + (n === 1 ? '' : 's'),
  cobro_vencido: n => n + ' factura' + (n === 1 ? '' : 's') + ' de cliente vencida' + (n === 1 ? '' : 's') + ' sin cobrar',
  cliente_en_riesgo: n => n + ' oportunidad' + (n === 1 ? '' : 'es') + ' del CRM con el seguimiento vencido',
  stock_bajo: n => n + ' producto' + (n === 1 ? '' : 's') + ' bajo su mínimo de stock',
  factura_recurrente: n => n + ' factura' + (n === 1 ? '' : 's') + ' recurrente' + (n === 1 ? '' : 's') + ' en borrador para revisar',
  reserva_publica: n => n + ' solicitud' + (n === 1 ? '' : 'es') + ' de cita por Internet pendiente' + (n === 1 ? '' : 's') + ' de aprobar',
};
// Orden estable del resumen. `envio_verifactu` abre porque es lo único con consecuencia legal.
// `cobro_vencido` va tras proveedor para no reordenar lo que ya veía el dueño; dentro de la LISTA
// el orden real lo manda `urgencia` (días vencida), donde cobros y pagos se intercalan por gravedad.
// OJO: resumenAvisos SOLO recorre esta lista. Un tipo que falte aquí desaparece del resumen y del email
// aunque su fuente lo devuelva — y desaparece EN SILENCIO. Añadir fuente = añadirla también aquí.
const TIPO_ORDEN = ['envio_verifactu', 'vencimiento_proveedor', 'cobro_vencido', 'cliente_en_riesgo', 'reserva_publica', 'factura_recurrente', 'stock_bajo'];

// Resumen de CONTEOS por fuente (grupos no vacíos), en orden estable. Σ counts = total avisos
// (== número del badge). NO incluye detalle ni ofrece acciones.
export function resumenAvisos(avisos) {
  const groups = [];
  for (const tipo of TIPO_ORDEN) {
    const n = avisos.filter(a => a.tipo === tipo).length;
    if (n) groups.push({ tipo, count: n, frase: (TIPO_FRASE[tipo] || (k => k + ' avisos'))(n) });
  }
  return groups;
}

// Texto del resumen-primero que DISA "dice" al pulsar el badge (conteos, sin detalle, sin acción).
export function resumenTexto(avisos) {
  const groups = resumenAvisos(avisos);
  if (!groups.length) return 'Ahora mismo no tienes nada pendiente.';
  const k = groups.length;
  const frases = groups.map(g => g.frase);
  const lista = frases.length === 1 ? frases[0] : frases.slice(0, -1).join(', ') + ' y ' + frases[frases.length - 1];
  const cierre = avisos.length === 1 ? ' ¿Quieres verlo?' : ' ¿Cuál quieres ver?';
  return 'Tienes ' + k + ' cosa' + (k === 1 ? '' : 's') + ' que mirar: ' + lista + '.' + cierre;
}

// ── Huella de "visto" — POR USUARIO (antes era singleton por tenant) ────────────────
// Vive en alert_seen_user (user_id = PK). "Visto" es un hecho de una PERSONA, no del negocio:
// que el dueño abra sus avisos no puede dejarlos vistos para el empleado. La tabla vieja
// `alert_seen` (id=1) se conserva intacta — la migración la copió a cada usuario existente y
// nadie la lee ya: revertir el código devuelve el comportamiento anterior con su estado.
//
// userId ausente (scripts, tests, procesos sin sesión) → bucket 0, aislado de los usuarios reales.
const uidOf = userId => Number(userId) || 0;

export function getSeenFingerprint(db, userId) {
  try {
    const row = db.prepare('SELECT fingerprint FROM alert_seen_user WHERE user_id=?').get(uidOf(userId));
    return new Set(JSON.parse((row && row.fingerprint) || '[]'));
  } catch { return new Set(); }
}
export function setSeenFingerprint(db, keys, userId) {
  const json = JSON.stringify([...keys]);
  db.prepare(`INSERT INTO alert_seen_user (user_id, fingerprint, seen_at) VALUES (?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(user_id) DO UPDATE SET fingerprint=excluded.fingerprint, seen_at=excluded.seen_at`)
    .run(uidOf(userId), json);
}

// Estado del badge (Opción C): 'apagado' (sin avisos), 'rojo' (hay algo NUEVO vs la huella),
// 'visto' (hay avisos pero ya se abrieron, nada nuevo).
//
// `count` YA NO es "del negocio": es el total de lo que ESTE usuario tiene derecho a ver. Si no
// filtrásemos el número, la campana de un empleado sin permiso de cobros le seguiría diciendo
// cuántas facturas vencidas hay. El invariante pasa de "todas las superficies cuentan lo mismo" a
// "todas las superficies cuentan lo mismo QUE TÚ PUEDES VER". El email diario va al negocio (sin
// usuario) y sigue contándolas todas.
export function estadoAvisos(db, today, userId, tipos) {
  const avisos = avisosDelDia(db, today, tipos);
  const keys = avisos.map(avisoKey);
  if (!avisos.length) return { count: 0, estado: 'apagado', avisos, keys, nuevos: [] };
  const seen = getSeenFingerprint(db, userId);
  const nuevos = keys.filter(k => !seen.has(k));
  return { count: avisos.length, estado: nuevos.length ? 'rojo' : 'visto', avisos, keys, nuevos };
}

// Resumen-primero de DISA: conteos por fuente, sin detalle y sin acciones. NO MARCA NADA.
//
// Antes se llamaba marcarVistoYResumir y hacía setSeenFingerprint(todas las claves vivas): pisaba
// la huella entera. Eso borraba en silencio los "no visto" que el usuario había marcado a propósito
// aviso por aviso — bastaba pulsar la tarjeta de DISA para perderlos. Y fusionar en vez de pisar
// tampoco lo arregla: volver a añadir la clave que el usuario quitó la marca igual.
//
// Un RESUMEN DE CONTEOS no es descartar nada. "Visto" lo decide el usuario, como en la pantalla
// (que tampoco marca al abrirse) y en la campana. Para marcar están marcarVistos/desmarcarVistos.
export function resumirAvisos(db, today, userId, tipos) {
  const avisos = avisosDelDia(db, today, tipos);
  return { reply: resumenTexto(avisos), count: avisos.length, groups: resumenAvisos(avisos) };
}

// ── Visto/no visto de UN aviso concreto ─────────────────────────────────────────────
// La huella es un CONJUNTO de claves, así que marcar un aviso suelto es añadir su clave.
//
// Dos conjuntos distintos, y confundirlos rompe cosas:
//   · vivasTodas   → TODAS las fuentes. Es contra lo que se PODA, para que la huella no crezca sin
//                    fin. Podar contra las permitidas borraría las claves de fuentes que este
//                    usuario vio ayer y hoy no puede ver (o al revés): se le reencenderían solas.
//   · permitidas   → solo las fuentes que este usuario puede ver. Es lo único que se le deja marcar
//                    o desmarcar, y lo único que cuenta para su "sin ver".
//
// Una sola pasada del motor sirve para marcar Y para responder: antes el POST calculaba avisosDelDia
// dos veces (una aquí, otra en estadoAvisos), pagando el escaneo caro de cobros por duplicado.
export function aplicarVisto(db, { keys, marcar, today, userId, tipos }) {
  const t = today || hoyLocal();
  const todos = avisosDelDia(db, t);                    // sin filtrar: la poda necesita el universo
  const vivasTodas = new Set(todos.map(avisoKey));
  const avisos = tipos === undefined ? todos : todos.filter(a => tipos.has(a.tipo));
  const permitidas = new Set(avisos.map(avisoKey));

  const seen = getSeenFingerprint(db, userId);
  // `keys` vacío o ausente → todas las del usuario ("marcar todos como vistos").
  const objetivo = (keys && keys.length) ? keys : [...permitidas];
  for (const k of objetivo) {
    if (!permitidas.has(k)) continue;                   // no se toca lo que no se puede ni ver
    if (marcar) seen.add(k); else seen.delete(k);
  }
  const next = [...seen].filter(k => vivasTodas.has(k));
  setSeenFingerprint(db, next, userId);

  const nextSet = new Set(next);
  const nuevos = [...permitidas].filter(k => !nextSet.has(k));
  return {
    count: avisos.length,
    estado: !avisos.length ? 'apagado' : (nuevos.length ? 'rojo' : 'visto'),
    avisos, keys: [...permitidas], nuevos,
  };
}

// Azúcar sobre aplicarVisto, para los tests y los scripts que ya los usaban.
export const marcarVistos   = (db, keys, today, userId, tipos) => aplicarVisto(db, { keys, marcar: true,  today, userId, tipos });
export const desmarcarVistos = (db, keys, today, userId, tipos) => aplicarVisto(db, { keys, marcar: false, today, userId, tipos });
