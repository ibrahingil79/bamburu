// Paso (d) — MOTOR PROACTIVO DE AVISOS (general). Un colector de FUENTES: cada fuente es una
// función(db, today) → lista de avisos normalizados. avisosDelDia agrega todas las fuentes y
// las ordena por urgencia. Nace general A PROPÓSITO: añadir mañana una fuente (cobros de
// cliente, stock bajo, etc.) es registrar UNA función en SOURCES — nada más se rehace.
//
// El motor SOLO LEE (no escribe, no migra, no toca stock/WAC ni la cadena de hash) — salvo la
// huella de "visto", que es estado de UI. Fuentes conectadas: vencimientos de proveedor, cobros
// de cliente vencidos, stock bajo y borradores de recurrentes. Lo consumen cuatro superficies:
// la pantalla central (/admin/avisos), el contador del rail, el Inicio y el email diario
// (scripts/bamburu-avisos.mjs). Todas cuentan LO MISMO porque todas leen de aquí.

import { openPayables } from './pagos.js';
import { openDebts } from './cobros.js';

const r2 = n => Math.round(n * 100) / 100;

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
  const t = today || new Date().toISOString().slice(0, 10);
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
    const detalle = vencida
      ? 'Factura vencida hace ' + f.dias_vencida + ' día' + (f.dias_vencida === 1 ? '' : 's') + ' · pendiente ' + r2(f.pendiente)
      : (faltan === 0 ? 'Factura vence HOY' : 'Factura vence en ' + faltan + ' día' + (faltan === 1 ? '' : 's'))
        + ' (' + due + ') · pendiente ' + r2(f.pendiente);
    avisos.push({
      tipo: 'vencimiento_proveedor',
      urgencia: vencida ? (1000 + f.dias_vencida) : (100 - faltan),
      titulo, detalle, ref,
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
  const t = today || new Date().toISOString().slice(0, 10);
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
      detalle: 'Te deben ' + r2(d.pendiente).toFixed(2) + ' · vencida hace ' + d.dias_vencida
        + ' día' + (d.dias_vencida === 1 ? '' : 's') + ' (' + (d.due_date || '-') + ')',
      ref,
    });
  }
  avisos.sort((a, b) => b.urgencia - a.urgencia);
  return avisos;
}

// ── FUENTE: productos con stock bajo (<5 uds, activos) ──────────────────────────────
// El stock bajo pasa a ser una FUENTE del motor (antes lo contaba dashboard.js por su lado):
// así el resumen del badge refleja EXACTAMENTE las mismas fuentes que cuenta el badge, y el
// número del badge y el del resumen COINCIDEN siempre. El cálculo (stock<5 activos) es el de
// dashboard.js, intacto. (Voz DISA de stock / punto de pedido = otra tarea; aquí solo el aviso.)
export function stockBajo(db, today) {
  const rows = db.prepare("SELECT id, name, stock FROM products WHERE stock < 5 AND status='active' ORDER BY stock ASC, name").all();
  return rows.map(p => ({
    tipo: 'stock_bajo',
    urgencia: 50 - Number(p.stock || 0),     // menos stock = más arriba; por debajo de lo vencido
    titulo: p.name,
    detalle: 'Stock bajo: ' + p.stock + ' unidad' + (Number(p.stock) === 1 ? '' : 'es'),
    ref: { source: 'stock_bajo', product_id: p.id, stock: p.stock },
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

// Fuentes registradas. Añadir una fuente = escribir la función y añadirla aquí. NADA más cambia
// (ni el panel, ni el resumen del badge, ni el email, ni la pantalla central de /admin/avisos).
const SOURCES = [vencimientosProveedor, cobrosVencidos, stockBajo, borradoresRecurrentes];

// Todos los avisos del día (todas las fuentes), ordenados por urgencia (más urgente arriba).
// Robusto: si una fuente peta, se ignora esa fuente y siguen las demás (un fallo aislado no
// silencia todo el aviso).
export function avisosDelDia(db, today) {
  const t = today || new Date().toISOString().slice(0, 10);
  const todos = [];
  for (const src of SOURCES) {
    try { todos.push(...src(db, t)); } catch { /* fuente caída: se omite, las demás siguen */ }
  }
  todos.sort((a, b) => b.urgencia - a.urgencia);
  return todos;
}

// ── Plantilla de email del RESUMEN DIARIO (espejo de collectionEmail) ───────────────
// Server-side, español. Devuelve { subject, html, text }. Nada se envía aquí: solo construye.
// El remitente es el negocio (igual que cobros: from noreply@bamburu.com, replyTo = su email).
export function avisosEmail(ctx) {
  const { avisos, company } = ctx;
  const sym = (company && company.currency_symbol) || '€';
  const empresa = (company && company.company_name) || 'tu negocio';
  const n = avisos.length;

  // El email sale de avisosDelDia COMPLETO (las mismas fuentes que el flag: vencimientos de
  // proveedor + stock bajo). Se muestra UN BLOQUE por fuente, cada uno con sus filas (ya
  // ordenadas por urgencia) y su conteo. Una fuente sin nada no aparece; los conteos del email
  // y los del badge COINCIDEN (misma fuente). No es un balance: solo lo urgente.
  const groups = resumenAvisos(avisos);                  // [{tipo, count, frase}] en orden estable
  const subject = 'Bamburu · ' + n + ' aviso' + (n === 1 ? '' : 's') + ' que requieren tu atención';
  const intro = 'Buenos días. Esto es lo que requiere tu atención hoy: ' + groups.map(g => g.frase).join('; ') + '.';

  const BLOQUE = {
    vencimiento_proveedor: 'Facturas de proveedor (vencidas o que vencen en ≤7 días)',
    cobro_vencido: 'Facturas de cliente vencidas (te deben)',
    factura_recurrente: 'Facturas recurrentes en borrador',
    stock_bajo: 'Productos con stock bajo',
  };
  // Detalle de una fila según su fuente (con la moneda donde toca; stock va en unidades).
  const filaDetalle = a => {
    const r = a.ref || {};
    if (a.tipo === 'vencimiento_proveedor') {
      const estado = r.vencida ? ('vencida hace ' + r.dias_vencida + 'd')
        : (r.dias_para_vencer === 0 ? 'vence hoy' : 'vence en ' + r.dias_para_vencer + 'd');
      return estado + ' · pendiente ' + sym + Number(r.pendiente || 0).toFixed(2);
    }
    if (a.tipo === 'cobro_vencido') {
      return 'vencida hace ' + r.dias_vencida + 'd · te deben ' + sym + Number(r.pendiente || 0).toFixed(2);
    }
    if (a.tipo === 'stock_bajo') return 'stock ' + r.stock + ' uds';
    return a.detalle;
  };

  const bloquesTxt = [], bloquesHtml = [];
  for (const g of groups) {
    const items = avisos.filter(a => a.tipo === g.tipo);
    const titulo = (BLOQUE[g.tipo] || g.tipo) + ' (' + items.length + ')';
    bloquesTxt.push(titulo + ':', ...items.map(a => '  · ' + a.titulo + ' — ' + filaDetalle(a)), '');
    const rows = items.map(a => {
      const vencido = a.tipo === 'cobro_vencido' || (a.tipo === 'vencimiento_proveedor' && a.ref && a.ref.vencida);
      const color = vencido ? '#b42318' : '#1f2937';
      return '<tr><td style="padding:6px 8px;font-weight:600">' + escapeHtml(a.titulo) + '</td>'
        + '<td style="padding:6px 8px;color:' + color + '">' + escapeHtml(filaDetalle(a)) + '</td></tr>';
    }).join('');
    bloquesHtml.push('<p style="margin:16px 0 6px;font-weight:700">' + escapeHtml(titulo) + '</p>'
      + '<table style="border-collapse:collapse;width:100%;background:#f9fafb;border-radius:8px">' + rows + '</table>');
  }

  const text = ['Hola,', '', intro, '', ...bloquesTxt, 'Entra en Bamburu para gestionarlos.', '', 'Un saludo,', 'Bamburu (por ' + empresa + ')'].join('\n');
  const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937">'
    + '<p>Hola,</p><p>' + escapeHtml(intro) + '</p>'
    + bloquesHtml.join('')
    + '<p style="margin-top:16px"><a href="https://bamburu.com" style="color:#2563eb">Entra en Bamburu</a> para gestionarlos.</p>'
    + '<p style="margin-top:24px;color:#6b7280;font-size:.85rem">Un saludo,<br>Bamburu (por ' + escapeHtml(empresa) + ')</p>'
    + '</div>';

  return { subject, html, text };
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
export function avisoKey(a) {
  const r = (a && a.ref) || {};
  if (r.source === 'vencimientos_proveedor') return 'vp:' + r.supplier_invoice_id;
  if (r.source === 'cobros_vencidos') return 'cv:' + r.invoice_id;
  if (r.source === 'stock_bajo') return 'sb:' + r.product_id;
  if (r.source === 'factura_recurrente') return 'fr:' + r.occurrence_id;
  return (r.source || (a && a.tipo) || '?') + ':' + (r.id != null ? r.id : JSON.stringify(r));
}

// Frase por tipo de fuente (singular/plural). Mapa = la cara legible de cada fuente del motor.
const TIPO_FRASE = {
  vencimiento_proveedor: n => n + ' factura' + (n === 1 ? '' : 's') + ' de proveedor que vence' + (n === 1 ? '' : 'n') + ' o ' + (n === 1 ? 'está' : 'están') + ' vencida' + (n === 1 ? '' : 's'),
  cobro_vencido: n => n + ' factura' + (n === 1 ? '' : 's') + ' de cliente vencida' + (n === 1 ? '' : 's') + ' sin cobrar',
  stock_bajo: n => n + ' producto' + (n === 1 ? '' : 's') + ' con stock bajo',
  factura_recurrente: n => n + ' factura' + (n === 1 ? '' : 's') + ' recurrente' + (n === 1 ? '' : 's') + ' en borrador para revisar',
};
// Orden estable del resumen. `cobro_vencido` va tras proveedor para no reordenar lo que ya
// veía el dueño; dentro de la LISTA el orden real lo manda `urgencia` (días vencida), donde
// cobros y pagos se intercalan por gravedad.
const TIPO_ORDEN = ['vencimiento_proveedor', 'cobro_vencido', 'factura_recurrente', 'stock_bajo'];

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
// 'visto' (hay avisos pero ya se abrieron, nada nuevo). count = total avisos (== badge).
// El estado es de ESTE usuario; el count es del negocio (los avisos son los mismos para todos).
export function estadoAvisos(db, today, userId) {
  const avisos = avisosDelDia(db, today);
  const keys = avisos.map(avisoKey);
  if (!avisos.length) return { count: 0, estado: 'apagado', avisos, keys };
  const seen = getSeenFingerprint(db, userId);
  const nuevos = keys.filter(k => !seen.has(k));
  return { count: avisos.length, estado: nuevos.length ? 'rojo' : 'visto', avisos, keys, nuevos };
}

// Marca los avisos actuales como VISTOS PARA ESTE USUARIO y devuelve el resumen-primero.
// Lo llama DISA al dar el resumen: si te los ha enseñado, los has visto.
export function marcarVistoYResumir(db, today, userId) {
  const avisos = avisosDelDia(db, today);
  setSeenFingerprint(db, avisos.map(avisoKey), userId);
  return { reply: resumenTexto(avisos), count: avisos.length, groups: resumenAvisos(avisos) };
}

// ── Visto/no visto de UN aviso concreto ─────────────────────────────────────────────
// La huella es un CONJUNTO de claves, así que marcar un aviso suelto es añadir su clave.
// Se PODA siempre contra los avisos vivos de hoy: la huella no crece sin fin, y un aviso que
// se resuelve y vuelve a aparecer cuenta como nuevo otra vez (su clave ya no estaba).
function clavesVivas(db, today) {
  return new Set(avisosDelDia(db, today).map(avisoKey));
}

// Añade claves a la huella. `keys` vacío o ausente → marca TODOS los avisos de hoy.
export function marcarVistos(db, keys, today, userId) {
  const vivas = clavesVivas(db, today);
  const seen = getSeenFingerprint(db, userId);
  for (const k of (keys && keys.length ? keys : vivas)) if (vivas.has(k)) seen.add(k);
  setSeenFingerprint(db, [...seen].filter(k => vivas.has(k)), userId);
  return { sinVer: vivas.size - [...seen].filter(k => vivas.has(k)).length, total: vivas.size };
}

// Quita claves de la huella (volver a marcar como NO visto: "esto todavía lo tengo que mirar").
export function desmarcarVistos(db, keys, today, userId) {
  const vivas = clavesVivas(db, today);
  const seen = getSeenFingerprint(db, userId);
  for (const k of (keys || [])) seen.delete(k);
  const next = [...seen].filter(k => vivas.has(k));
  setSeenFingerprint(db, next, userId);
  return { sinVer: vivas.size - next.length, total: vivas.size };
}
