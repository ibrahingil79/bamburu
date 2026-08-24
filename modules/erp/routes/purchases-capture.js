import { Hono } from 'hono';
import { safeError } from '../../../core/errors.js';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { adminLayout, can } from '../layout.js';
import { requirePerm, logActivity } from '../../../core/auth.js';
import { validate, price } from '../../../core/validate.js';
import { callClaude, imageBlock, documentBlock, textFromResponse } from '../../../core/llm.js';
import { getVatBands } from '../../../core/vat-bands.js';
import { searchProducts, createProductSvc } from './products.js';
import { searchSuppliers, createSupplierSvc, supplierFiscalIdConflict } from './suppliers.js';
import { createDirectPurchaseSvc } from './purchases.js';
import { createReceiptSvc, orderReceptionState } from './purchase-order-receipts.js';
import { createSupplierInvoiceSvc } from './supplier-invoices.js';
import { ENTITY } from '../../../core/activity-entities.js';
import {
  ALLOWED_MIME, MAX_UPLOAD_BYTES, saveAttachment, getAttachment,
  readAttachmentBuffer, linkAttachment,
} from '../attachments.js';
import { fmtEur as dineroEs } from '../margen.js';   // el dinero, como en España

// ════════════════════════════════════════════════════════════════════════════
// C2 — Captura de factura de proveedor por foto/PDF.
// El usuario sube una foto o PDF; Claude (visión, vía core/llm.js) extrae proveedor,
// fecha, líneas e importes; el servidor cuadra contra catálogo y proveedores; y se
// presenta una pantalla de revisión EDITABLE (no en el chat de DISA, sino en pantalla,
// tipo Dext/Hubdoc). Al confirmar, aterriza por los caminos YA construidos: recepción
// contra orden enviada (C1) o compra directa. CERO caminos nuevos de stock/coste.
// ════════════════════════════════════════════════════════════════════════════

const EXTRACTION_MODEL = 'claude-sonnet-4-6';   // visión + JSON

// ── Parseo numérico tolerante (formatos de factura: "1.234,56", "1,234.56", "12,5 €") ──
export function toNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[^0-9.,-]/g, '');
  if (!s) return null;
  const hasComma = s.includes(','), hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // el separador decimal es el que aparece más a la derecha
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    // una sola coma → decimal (en factura ES es lo normal)
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// Normaliza la fecha a YYYY-MM-DD (acepta ISO o DD/MM/YYYY · DD-MM-YYYY); '' si no se entiende.
export function normDate(v) {
  if (!v) return '';
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

// ── Validación de forma del JSON extraído (zod, tolerante) ──────────────────
const extractionLineSchema = z.object({
  description: z.any().optional(),
  quantity:   z.any().optional(),
  unit_cost:  z.any().optional(),
  vat_rate:   z.any().optional(),
}).passthrough();

const extractionSchema = z.object({
  supplier: z.object({ name: z.any().optional(), fiscal_id: z.any().optional() }).nullable().optional(),
  date:           z.any().optional(),
  invoice_number: z.any().optional(),
  lines:          z.array(extractionLineSchema).optional(),
  totals: z.object({ base: z.any().optional(), tax: z.any().optional(), total: z.any().optional() }).nullable().optional(),
}).passthrough();

const readErr = () => { const e = new Error('No he podido leer el documento. Prueba con una foto más nítida o un PDF mejor.'); e.status = 422; return e; };

// Parsea la respuesta del modelo con TOLERANCIA: quita fences ```json, recorta al
// objeto { ... } y valida la forma con zod. Devuelve un objeto NORMALIZADO (números
// ya parseados). Si no hay JSON usable o no hay ninguna línea → error claro (422),
// nunca un guardado a medias.
export function parseExtraction(text) {
  if (!text || !String(text).trim()) throw readErr();
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const first = s.indexOf('{'), last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  let raw;
  try { raw = JSON.parse(s); } catch { throw readErr(); }
  const res = extractionSchema.safeParse(raw);
  if (!res.success) throw readErr();
  const d = res.data;
  const str = v => (v == null ? '' : String(v).trim());
  const norm = {
    supplier: { name: str(d.supplier?.name), fiscal_id: str(d.supplier?.fiscal_id) },
    date: normDate(d.date),
    invoice_number: str(d.invoice_number),
    lines: (d.lines || []).map(l => ({
      description: str(l.description),
      quantity:  toNumber(l.quantity),
      unit_cost: toNumber(l.unit_cost),
      vat_rate:  toNumber(l.vat_rate),
    })).filter(l => l.description || l.unit_cost != null),
    totals: {
      base:  toNumber(d.totals?.base),
      tax:   toNumber(d.totals?.tax),
      total: toNumber(d.totals?.total),
    },
  };
  // normaliza valores por defecto razonables (la cantidad por defecto es 1)
  norm.lines = norm.lines.map(l => ({
    ...l,
    quantity: (l.quantity != null && l.quantity > 0) ? l.quantity : 1,
    unit_cost: l.unit_cost != null ? l.unit_cost : 0,
  }));
  if (!norm.lines.length) throw readErr();
  return norm;
}

// ── Llamada de extracción a Claude (visión) vía core/llm.js ─────────────────
const EXTRACTION_SYSTEM =
  'Eres un extractor de datos de facturas de proveedor. Lees una imagen o PDF de una ' +
  'factura y devuelves SOLO un objeto JSON con los datos, sin explicaciones ni texto ' +
  'adicional. No inventes datos: si algo no es visible, usa null.';

function extractionUserText() {
  return 'Extrae los datos de esta factura de proveedor y responde EXCLUSIVAMENTE con un ' +
    'objeto JSON válido (sin fences, sin texto antes ni después) con esta forma exacta:\n' +
    '{"supplier":{"name":string|null,"fiscal_id":string|null},' +
    '"date":"YYYY-MM-DD"|null,"invoice_number":string|null,' +
    '"lines":[{"description":string,"quantity":number,"unit_cost":number,"vat_rate":number|null}],' +
    '"totals":{"base":number|null,"tax":number|null,"total":number|null}}\n' +
    'Reglas: "unit_cost" es el precio unitario NETO (SIN IVA) de cada línea. "vat_rate" es ' +
    'el % de IVA de la línea si es visible (p. ej. 21, 10, 4, 0), si no null. "base" es la ' +
    'base imponible total, "tax" el IVA total y "total" el importe total con IVA. Usa punto ' +
    'como separador decimal. Si un dato no aparece, pon null.';
}

export async function extractInvoice({ buffer, mime }, opts = {}) {
  const base64 = buffer.toString('base64');
  const block = mime === 'application/pdf' ? documentBlock(base64) : imageBlock(base64, mime);
  const resp = await callClaude({
    model: opts.model || EXTRACTION_MODEL,
    max_tokens: 2500,
    system: EXTRACTION_SYSTEM,
    messages: [{ role: 'user', content: [block, { type: 'text', text: extractionUserText() }] }],
    apiKey: opts.apiKey,
    fetchImpl: opts.fetchImpl,
    billDb: opts.billDb,
  });
  return parseExtraction(textFromResponse(resp));
}

// ── Cuadre en servidor ──────────────────────────────────────────────────────
const eqi = (a, b) => String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();

// Proveedor primero por NIF exacto (supplierFiscalIdConflict), si no por nombre
// (searchSuppliers). Cada línea contra catálogo por SKU/código/nombre (searchProducts).
export function matchExtraction(db, extracted) {
  // Proveedor
  let supplier = null;
  if (extracted.supplier.fiscal_id) {
    const conf = supplierFiscalIdConflict(db, extracted.supplier.fiscal_id);
    if (conf && conf.active) supplier = { id: conf.id, name: conf.name, matched_by: 'nif' };
    else if (conf && !conf.active) supplier = null;   // archivado: no se autoselecciona (restaurar/crear lo decide el usuario)
  }
  if (!supplier && extracted.supplier.name) {
    const found = searchSuppliers(db, { q: extracted.supplier.name, limit: 1 });
    if (found.length) supplier = { id: found[0].id, name: found[0].name, matched_by: 'name' };
  }

  // Líneas
  const lines = extracted.lines.map(l => {
    const cand = matchLineToProduct(db, l.description);
    return { ...l, match: cand || { matched: false } };
  });
  return { supplier, lines };
}

// Busca el producto propuesto para la descripción de una línea: primero un match
// EXACTO de SKU o código interno entre los candidatos; si no, el primer candidato por
// nombre. Si la descripción larga no devuelve nada, reintenta con las primeras palabras.
function matchLineToProduct(db, description) {
  const desc = String(description || '').trim();
  if (!desc) return null;
  let cands = searchProducts(db, { q: desc, limit: 5 });
  if (!cands.length) {
    const short = desc.split(/\s+/).slice(0, 3).join(' ');
    if (short && short !== desc) cands = searchProducts(db, { q: short, limit: 5 });
  }
  if (!cands.length) return null;
  const exact = cands.find(p => (p.sku && eqi(p.sku, desc)) || (p.product_code && eqi(p.product_code, desc)));
  const p = exact || cands[0];
  return { matched: true, product_id: p.id, name: p.name, sku: p.sku, product_code: p.product_code, tax_band: p.tax_band, tax_rate: p.tax_rate, price: p.price };
}

// Órdenes ENVIADAS del proveedor con pendiente > 0 (ni recibidas ni cerradas/anuladas).
export function supplierOpenOrders(db, supplierId) {
  const orders = db.prepare("SELECT * FROM purchase_orders WHERE supplier_id=? AND status='enviada' ORDER BY id DESC").all(supplierId);
  const out = [];
  for (const o of orders) {
    if (o.received_status === 'recibida' || o.received_status === 'cerrada_manual') continue;
    const st = orderReceptionState(db, o.id);
    if (st.totalPendiente > 0) {
      out.push({ id: o.id, order_number: o.order_number, date: o.date, total_pendiente: st.totalPendiente, lines: st.lines });
    }
  }
  return out;
}

// ── Confirmación / aterrizaje (Fase 3) ──────────────────────────────────────
const confirmLineSchema = z.object({
  product_mode:  z.enum(['existing', 'new']).default('existing'),
  product_id:    z.coerce.number().int().positive().nullable().optional(),
  new_name:      z.string().trim().max(200).optional().default(''),
  new_sku:       z.string().trim().max(100).optional().default(''),
  new_tax_band:  z.string().trim().max(40).optional().default(''),
  order_item_id: z.coerce.number().int().positive().nullable().optional(),
  quantity:      z.coerce.number().int().positive(),
  unit_cost:     price,
});

export const confirmCaptureSchema = z.object({
  attachment_id:  z.coerce.number().int().positive().nullable().optional(),
  supplier_mode:  z.enum(['existing', 'new']).default('existing'),
  supplier_id:    z.coerce.number().int().positive().nullable().optional(),
  new_supplier:   z.object({
                    name:      z.string().trim().min(1).max(200),
                    fiscal_id: z.string().trim().max(50).optional().default(''),
                  }).nullable().optional(),
  target_mode:    z.enum(['direct', 'order']).default('direct'),
  order_id:       z.coerce.number().int().positive().nullable().optional(),
  reference:      z.string().trim().max(100).optional().default(''),
  date:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes:          z.string().trim().max(1000).optional().default(''),
  confirm_excess: z.coerce.boolean().optional().default(false),
  lines:          z.array(confirmLineSchema).min(1, 'Al menos una línea'),
  // Capa de dinero (a) — importes de la factura del proveedor (CON IVA en inv_total) que
  // la captura calcula. Al confirmar, generan AUTO la factura recibida (la deuda). Opcionales:
  // si no hay total (p. ej. dictado por voz sin importes), no se crea factura recibida.
  inv_base:       z.union([z.null(), z.coerce.number().min(0).max(100_000_000)]).optional(),
  inv_tax:        z.union([z.null(), z.coerce.number().min(0).max(100_000_000)]).optional(),
  inv_total:      z.union([z.null(), z.coerce.number().min(0).max(100_000_000)]).optional(),
});

// Ejecuta, en servidor y EN ESTE ORDEN, dentro de UNA transacción (todo o nada — nunca
// un guardado a medias): crear proveedor nuevo si procede → crear productos nuevos si
// procede → aterrizar (recepción contra orden o compra directa) → enlazar el adjunto.
// Crea la factura recibida (deuda) que acompaña al aterrizaje de stock, con los importes
// reales que la captura leyó. Se llama DENTRO de la transacción de confirmCaptureSvc, así
// que NO abre transacción propia. onDuplicate:'skip' para no tumbar el aterrizaje de stock
// si esa factura ya existía (se devuelve el aviso). Sin total > 0 (p. ej. voz sin importes)
// no se crea deuda. supplier_invoice_number = la referencia (nº del proveedor).
function autoSupplierInvoice(db, d, entity_type, entity_id) {
  const total = Number(d.inv_total);
  if (!(total > 0)) return null;   // sin importe → no hay deuda que registrar
  return createSupplierInvoiceSvc(db, {
    entity_type, entity_id,
    supplier_invoice_number: d.reference || '',
    invoice_date: d.date,
    base: d.inv_base != null ? Number(d.inv_base) : 0,
    tax:  d.inv_tax  != null ? Number(d.inv_tax)  : 0,
    total,
    notes: d.notes || '',
  }, { onDuplicate: 'skip', today: d.date });
}

export function confirmCaptureSvc(db, d) {
  const run = db.transaction(() => {
    // 1 + 3) destino contra ORDEN: el proveedor lo manda la propia orden.
    if (d.target_mode === 'order') {
      if (!d.order_id) { const e = new Error('Falta la orden de compra'); e.status = 400; throw e; }
      const items = d.lines
        .filter(l => l.order_item_id && l.quantity > 0)
        .map(l => ({ order_item_id: l.order_item_id, quantity: l.quantity, unit_cost: l.unit_cost }));
      if (!items.length) { const e = new Error('No hay ninguna línea que cuadre contra la orden'); e.status = 400; throw e; }
      const receipt = createReceiptSvc(db, d.order_id, { date: d.date, notes: d.notes, items, confirm_excess: d.confirm_excess });
      if (d.attachment_id) linkAttachment(db, d.attachment_id, 'po_receipt', receipt.id);
      const debt = autoSupplierInvoice(db, d, 'po_receipt', receipt.id);
      return { entity_type: 'po_receipt', entity_id: receipt.id, redirect: '/admin/purchase-order-receipts/' + receipt.id, label: receipt.receipt_number, supplier_invoice: debt };
    }

    // 1) proveedor (compra directa): existente o creado al vuelo (servicio validado + guarda de NIF).
    let supplierId = d.supplier_id || null;
    if (d.supplier_mode === 'new') {
      if (!d.new_supplier || !d.new_supplier.name) { const e = new Error('Falta el nombre del proveedor nuevo'); e.status = 400; throw e; }
      const s = createSupplierSvc(db, { name: d.new_supplier.name, fiscal_id: d.new_supplier.fiscal_id || '' });
      supplierId = s.id;
    }
    if (!supplierId) { const e = new Error('Falta el proveedor'); e.status = 400; throw e; }

    // 2) productos nuevos (por el camino validado; banda de IVA OBLIGATORIA, sin defecto silencioso).
    const items = [];
    for (const l of d.lines) {
      let pid = l.product_id || null;
      if (l.product_mode === 'new') {
        if (!l.new_name) { const e = new Error('Falta el nombre de un producto nuevo'); e.status = 400; throw e; }
        if (!l.new_tax_band) { const e = new Error('La banda de IVA del producto nuevo es obligatoria (elígela explícitamente)'); e.status = 400; throw e; }
        const sku = l.new_sku || ('CAP-' + l.new_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '-' + Date.now());
        const p = createProductSvc(db, { name: l.new_name, sku, tax_band: l.new_tax_band, price: l.unit_cost, type: 'physical', stock: 0 });
        pid = p.id;
      }
      if (!pid) { const e = new Error('Cada línea debe resolver a un producto (elige uno del catálogo o crea uno nuevo)'); e.status = 400; throw e; }
      items.push({ product_id: pid, quantity: l.quantity, unit_cost: l.unit_cost });
    }

    // 3) compra directa con estado received (mueve stock y WAC por el libro, como ya hace).
    const pid = createDirectPurchaseSvc(db, {
      supplier_id: supplierId, reference: d.reference, date: d.date, notes: d.notes, status: 'received', items,
    });
    if (d.attachment_id) linkAttachment(db, d.attachment_id, 'purchase', pid);
    const debt = autoSupplierInvoice(db, d, 'purchase', pid);
    return { entity_type: 'purchase', entity_id: pid, redirect: '/admin/purchases/' + pid, label: '#' + pid, supplier_invoice: debt };
  });
  return run();
}

// ════════════════════════════════════════════════════════════════════════════
// Rutas
// ════════════════════════════════════════════════════════════════════════════
// Pipeline COMPARTIDO de captura (lo usa la pantalla C2 y el chat de DISA, así DISA
// reutiliza EXACTAMENTE este extractor — sin un camino nuevo de extracción): guarda el
// adjunto, lo lee con el modelo (visión), PERSISTE la lectura cruda en
// attachments.extraction_json (para precargar la revisión sin volver a llamar al modelo)
// y cuadra contra catálogo/proveedores. NO escribe NADA de stock/compras (eso solo lo
// hace confirmCaptureSvc al confirmar). Devuelve el blob que la pantalla espera en DATA.
export async function runCapture(db, tenant, session, { buffer, mime, originalName = '' }) {
  // Guarda el original SIEMPRE (aunque la extracción falle, el documento queda guardado).
  const att = saveAttachment(db, tenant, { buffer, originalName, mime });

  // Extracción (simulable en el gate de navegador con C2_FAKE_EXTRACTION).
  let extracted;
  const fake = process.env.C2_FAKE_EXTRACTION;
  if (fake) extracted = parseExtraction(fake);
  else extracted = await extractInvoice({ buffer, mime }, { billDb: db });

  // Persistir SOLO la lectura cruda del modelo (no match/open_orders: son derivados de BD,
  // se recalculan frescos al precargar la pantalla).
  db.prepare('UPDATE attachments SET extraction_json=? WHERE id=?').run(JSON.stringify(extracted), att.id);

  const match = matchExtraction(db, extracted);
  const open_orders = match.supplier ? supplierOpenOrders(db, match.supplier.id) : [];
  if (session) logActivity(db, session, 'Capturó factura de proveedor', ENTITY.ATTACHMENT, att.id, originalName);
  return { attachment_id: att.id, mime, extracted, match, open_orders };
}

// Captura DICTADA POR VOZ (DISA): no hay foto/PDF, pero el destino y el control visual
// son los MISMOS que la captura por imagen. En vez de extraer con visión, DISA ya trae el
// resultado; aquí solo lo NORMALIZAMOS por el MISMO `parseExtraction` (cero normalización
// nueva) y lo persistimos como un adjunto SIN fichero (path='' → readAttachmentBuffer lo
// trata como "sin documento"; mime='' → la pantalla muestra el panel degradado). El handoff
// reusa `?attachment=ID` → `preparedCapture` (recalcula match/open_orders frescos). A partir
// de ahí, la pantalla editable y el confirm (createReceiptSvc/createDirectPurchaseSvc) son
// IDÉNTICOS a la captura por foto. NO escribe nada de stock/compras.
export function captureFromExtraction(db, session, extractedRaw) {
  // Misma normalización que el extractor de visión (números EU, fecha, defaults, líneas).
  const extracted = parseExtraction(JSON.stringify(extractedRaw || {}));
  const r = db.prepare(
    "INSERT INTO attachments (kind, original_name, path, mime, size, extraction_json) VALUES ('supplier_invoice_voice', ?, '', '', 0, ?)"
  ).run('Compra dictada por voz a DISA', JSON.stringify(extracted));
  const attId = r.lastInsertRowid;
  if (session) logActivity(db, session, 'Dictó compra por voz a DISA', ENTITY.ATTACHMENT, attId, extracted.supplier?.name || '');
  return { attachment_id: attId, extracted };
}

// Reconstruye el blob de la pantalla a partir de un adjunto YA extraído (precarga sin
// re-extraer): lee extraction_json y RECALCULA match + open_orders frescos. Devuelve null
// si el adjunto no existe o no tiene lectura guardada.
export function preparedCapture(db, attachmentId) {
  const att = getAttachment(db, attachmentId);
  if (!att || !att.extraction_json) return null;
  let extracted;
  try { extracted = JSON.parse(att.extraction_json); } catch { return null; }
  const match = matchExtraction(db, extracted);
  const open_orders = match.supplier ? supplierOpenOrders(db, match.supplier.id) : [];
  return { attachment_id: att.id, mime: att.mime, extracted, match, open_orders };
}

export function createPurchaseCaptureRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  // ── Subida + extracción ──────────────────────────────────────────────────
  api.post('/', requirePerm('purchases.create'),
    bodyLimit({ maxSize: MAX_UPLOAD_BYTES, onError: c => c.json({ error: 'El archivo supera el máximo de 12 MB. Sube una foto o PDF más ligero.' }, 413) }),
    async c => {
      try {
        const body = await c.req.parseBody();
        const file = body.file;
        if (!file || typeof file === 'string') return c.json({ error: 'Adjunta un archivo (foto o PDF de la factura).' }, 400);
        const mime = file.type || '';
        if (!ALLOWED_MIME[mime]) return c.json({ error: 'Formato no admitido. Sube una imagen (JPG, PNG, WebP) o un PDF.' }, 400);
        const buffer = Buffer.from(await file.arrayBuffer());
        if (!buffer.length) return c.json({ error: 'El archivo está vacío.' }, 400);
        if (buffer.length > MAX_UPLOAD_BYTES) return c.json({ error: 'El archivo supera el máximo de 12 MB.' }, 413);

        const result = await runCapture(db, c.get('tenant'), c.get('session'), { buffer, mime, originalName: file.name || '' });
        return c.json(result);
      } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
    });

  // Órdenes enviadas con pendiente de un proveedor (para el bloque "Destino").
  api.get('/supplier-orders', requirePerm('purchases.read'), c => {
    try {
      const sid = parseInt(c.req.query('supplier_id'));
      if (!sid) return c.json([]);
      return c.json(supplierOpenOrders(db, sid));
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // Servir el documento original: SOLO con sesión + permiso de lectura de compras.
  api.get('/file/:id', requirePerm('purchases.read'), c => {
    try {
      const att = getAttachment(db, parseInt(c.req.param('id')));
      if (!att) return c.json({ error: 'No encontrado' }, 404);
      const buf = readAttachmentBuffer(att);
      if (!buf) return c.json({ error: 'Archivo no disponible' }, 404);
      const safeName = (att.original_name || 'documento').replace(/[^\w.\- ]/g, '_');
      return new Response(buf, {
        headers: {
          'Content-Type': att.mime || 'application/octet-stream',
          'Content-Disposition': 'inline; filename="' + safeName + '"',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // Confirmar / aterrizar.
  api.post('/confirm', requirePerm('purchases.create'), validate(confirmCaptureSchema), c => {
    try {
      const r = confirmCaptureSvc(db, c.get('validated'));
      logActivity(db, c.get('session'), 'Aterrizó factura de proveedor capturada', r.entity_type, r.entity_id, r.label || '');
      return c.json({ ...r, message: 'Factura registrada' }, 201);
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // ── Página de revisión ───────────────────────────────────────────────────
  views.get('/', requirePerm('purchases.create'), c => {
    const csrf = c.get('session')?.csrfToken || '';
    const cfg = db.prepare('SELECT currency_symbol, country FROM company_config WHERE id=1').get() || {};
    const sym = cfg.currency_symbol || '€';
    const bands = getVatBands((cfg.country || 'ES').toUpperCase());
    const today = new Date().toISOString().slice(0, 10);
    // Precarga desde el chat de DISA: ?attachment=ID → reconstruye el blob desde la lectura
    // guardada (recalcula match/open_orders frescos, NO re-extrae) y arranca en el Paso 2.
    let preload = null;
    const attId = parseInt(c.req.query('attachment'));
    if (attId) preload = preparedCapture(db, attId);
    return c.html(adminLayout('Capturar factura', capturePage({ sym, bands, today, preload }), 'purchases', csrf, c));
  });

  return { api, views };
}

// ── HTML + JS de la pantalla de revisión (paso 1 subir · paso 2 revisar) ─────
function capturePage({ sym, bands, today, preload = null }) {
  const bandsJson = JSON.stringify(bands);
  // Precarga (chat de DISA): se inyecta el blob ya extraído; escapamos `<` para no
  // romper el <script> con el contenido del documento.
  const preloadJson = preload ? JSON.stringify(preload).replace(/</g, '\\u003c') : 'null';
  return `
  <div class="ph">
    <h2>Capturar factura de proveedor</h2>
    <a href="/admin/purchases" class="btn btn-secondary">Volver</a>
  </div>

  <!-- PASO 1 — subida -->
  <div id="step1" class="card" style="max-width:640px;margin:0 auto">
    <div class="card-head"><h3>1 · Sube la factura</h3></div>
    <div class="card-body">
      <p style="color:var(--text2);margin-bottom:1rem">Sube una <strong>foto</strong> o un <strong>PDF</strong> de la factura del proveedor. La IA leerá proveedor, líneas e importes y podrás revisarlo y corregirlo antes de guardar nada.</p>
      <label id="dropZone" for="fileInput" style="display:block;border:2px dashed var(--border2);border-radius:12px;padding:2rem;text-align:center;cursor:pointer;transition:border-color .15s">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" stroke-width="1.6" style="margin-bottom:.5rem"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <div id="fileLabel" style="color:var(--text2)">Pulsa para elegir archivo o hacer una foto</div>
        <div style="color:var(--text3);font-size:.78rem;margin-top:.3rem">JPG · PNG · WebP · PDF · máx. 12 MB</div>
      </label>
      <input id="fileInput" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" style="display:none" onchange="onFilePick()">
      <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem">
        <button id="btnExtract" class="btn btn-primary" onclick="extract()" disabled>Extraer datos</button>
      </div>
      <div id="extractMsg" style="margin-top:.75rem"></div>
    </div>
  </div>

  <!-- PASO 2 — revisión -->
  <div id="step2" style="display:none">
    <div class="grid" style="grid-template-columns:minmax(280px,420px) 1fr;gap:1rem;align-items:start">
      <div class="card" id="docCol" style="position:sticky;top:1rem">
        <div class="card-head"><h3>Documento</h3><button class="btn btn-secondary btn-sm" onclick="resetCapture()">Subir otra</button></div>
        <div class="card-body" id="docPreview" style="text-align:center"></div>
      </div>
      <div>
        <div class="card" style="margin-bottom:1rem">
          <div class="card-head"><h3>Proveedor</h3></div>
          <div class="card-body" id="supplierBox"></div>
        </div>
        <div class="card" id="destinoCard" style="margin-bottom:1rem;display:none">
          <div class="card-head"><h3>Destino</h3></div>
          <div class="card-body" id="destinoBox"></div>
        </div>
        <div class="card" style="margin-bottom:1rem">
          <div class="card-head"><h3>Datos</h3></div>
          <div class="card-body">
            <div class="form-row">
              <div class="form-group"><label class="form-label">Nº factura proveedor</label><input class="form-control" id="fRef"></div>
              <div class="form-group"><label class="form-label">Fecha *</label><input class="form-control" type="date" id="fDate" value="${today}"></div>
            </div>
            <div class="form-group"><label class="form-label">Notas</label><input class="form-control" id="fNotes"></div>
          </div>
        </div>
        <div class="card" style="margin-bottom:1rem">
          <div class="card-head"><h3>Líneas</h3><button class="btn btn-secondary btn-sm" id="btnAddLine" onclick="addBlankLine()">+ Añadir línea</button></div>
          <div class="table-wrap" style="overflow:visible"><table>
            <thead id="linesHead"></thead>
            <tbody id="linesBody"></tbody>
          </table></div>
        </div>
        <div class="card" style="margin-bottom:1rem">
          <div class="card-body" id="totalsBox"></div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:.5rem">
          <a href="/admin/purchases" class="btn btn-secondary">Cancelar</a>
          <button id="btnConfirm" class="btn btn-primary" onclick="confirmCapture()">Confirmar y registrar</button>
        </div>
      </div>
    </div>
  </div>

  <script>
  var SYM = ${JSON.stringify(sym)};
  var BANDS = ${bandsJson};
  var PRELOAD = ${preloadJson};   // blob precargado desde el chat de DISA (o null)
  var DATA = null;          // respuesta de extracción { attachment_id, mime, extracted, match, open_orders }
  var supplier = null;      // { mode:'existing'|'new'|'none', id, name, fiscal_id }
  var target = { mode:'direct', order_id:null };
  var lines = [];           // estado editable de líneas (modo directo)
  var orderLines = [];      // estado editable (modo orden)
  var lineSeq = 0;
  var LAST_TOTALS = { base:0, tax:0, total:0 };   // últimos totales calculados (→ factura recibida auto)

  // ───────── Paso 1 ─────────
  function onFilePick(){
    var f = document.getElementById('fileInput').files[0];
    var ok = !!f;
    document.getElementById('fileLabel').textContent = f ? f.name : 'Pulsa para elegir archivo o hacer una foto';
    document.getElementById('btnExtract').disabled = !ok;
  }
  async function extract(){
    var f = document.getElementById('fileInput').files[0];
    if(!f){ toast('Elige un archivo','err'); return; }
    var btn = document.getElementById('btnExtract'); btn.disabled = true;
    document.getElementById('extractMsg').innerHTML = '<div class="alert alert-warn">Leyendo la factura con la IA… esto puede tardar unos segundos.</div>';
    var fd = new FormData(); fd.append('file', f);
    try {
      var r = await fetch('/api/erp/purchases/capture', { method:'POST', headers:{ 'x-csrf-token': window.CSRF_TOKEN }, body: fd });
      var d = await r.json();
      if(!r.ok || d.error) throw new Error(d.error || 'No se pudo leer el documento');
      DATA = d;
      document.getElementById('extractMsg').innerHTML = '';
      buildReview();
    } catch(e){
      document.getElementById('extractMsg').innerHTML = '<div class="alert alert-err">'+escHtml(e.message)+'</div>';
      btn.disabled = false;
    }
  }
  function resetCapture(){ location.reload(); }

  // ───────── Paso 2 — montaje ─────────
  // Mapea el % de IVA de la línea a UNA banda del país, SOLO si es inequívoco (1:1).
  // Si el rate no aparece, o varias bandas comparten ese %, devuelve '' (la pantalla la
  // exige como obligatoria: no adivinamos). Para la voz, esto prerellena la banda que DISA
  // ya recogió; para la foto, ayuda igual cuando el modelo leyó un % nítido.
  function bandFromRate(rate){
    if(rate==null || rate==='') return '';
    var hits = BANDS.filter(function(b){ return Number(b.rate)===Number(rate); });
    return hits.length===1 ? hits[0].code : '';
  }
  function buildReview(){
    document.getElementById('step1').style.display='none';
    document.getElementById('step2').style.display='block';
    // documento — degradado si la compra se dictó por voz (sin foto/PDF: DATA.mime vacío)
    var url = '/api/erp/purchases/capture/file/'+DATA.attachment_id;
    document.getElementById('docPreview').innerHTML = !DATA.mime
      ? '<div class="alert alert-info" style="margin:0">🎙️ Compra <strong>dictada por voz</strong> a DISA — no hay documento adjunto. Revisa los datos precargados y confirma.</div>'
      : (DATA.mime==='application/pdf')
      ? '<embed src="'+url+'" type="application/pdf" style="width:100%;height:70vh;border:1px solid var(--border);border-radius:8px"><div style="margin-top:.5rem"><a href="'+url+'" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">Abrir PDF</a></div>'
      : '<a href="'+url+'" target="_blank" rel="noopener"><img src="'+url+'" style="max-width:100%;border-radius:8px;border:1px solid var(--border)"></a>';
    // datos
    if(DATA.extracted.invoice_number) document.getElementById('fRef').value = DATA.extracted.invoice_number;
    if(DATA.extracted.date) document.getElementById('fDate').value = DATA.extracted.date;
    // proveedor
    var m = DATA.match.supplier;
    supplier = m ? { mode:'existing', id:m.id, name:m.name } : { mode:'none' };
    renderSupplier();
    // líneas (modo directo por defecto)
    lines = DATA.extracted.lines.map(function(l, i){
      var mt = DATA.match.lines[i] && DATA.match.lines[i].match;
      lineSeq++;
      return {
        uid: lineSeq,
        description: l.description,
        quantity: l.quantity,
        unit_cost: l.unit_cost,
        vat_rate: l.vat_rate,
        product_mode: (mt && mt.matched) ? 'existing' : 'unset',
        product_id: (mt && mt.matched) ? mt.product_id : null,
        product_label: (mt && mt.matched) ? ((mt.sku?'['+mt.sku+'] ':'')+mt.name) : '',
        new_name: l.description, new_sku:'', new_tax_band: bandFromRate(l.vat_rate)
      };
    });
    renderDestino();
    renderLines();
    renderTotals();
  }

  // ───────── Proveedor ─────────
  function renderSupplier(){
    var box = document.getElementById('supplierBox');
    var ex = DATA.extracted.supplier;
    if(supplier.mode==='existing'){
      box.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap">'
        +'<div><span class="badge b-green">Cuadrado</span> <strong>'+escHtml(supplier.name)+'</strong>'
        +(DATA.match.supplier && DATA.match.supplier.matched_by==='nif'?' <span style="color:var(--text3);font-size:.78rem">(por NIF)</span>':' <span style="color:var(--text3);font-size:.78rem">(por nombre)</span>')+'</div>'
        +'<button class="btn btn-secondary btn-sm" onclick="supplierChange()">Cambiar</button>'
        +'</div>';
    } else if(supplier.mode==='new'){
      box.innerHTML =
        '<div class="alert alert-warn">Se creará un proveedor NUEVO al confirmar.</div>'
        +'<div class="form-row">'
        +'<div class="form-group"><label class="form-label">Nombre *</label><input class="form-control" id="nsName" value="'+escHtml(supplier.name||ex.name||'')+'" oninput="supplier.name=this.value"></div>'
        +'<div class="form-group"><label class="form-label">NIF/CIF</label><input class="form-control" id="nsNif" value="'+escHtml(supplier.fiscal_id||ex.fiscal_id||'')+'" oninput="supplier.fiscal_id=this.value"></div>'
        +'</div>'
        +'<button class="btn btn-secondary btn-sm" onclick="supplierChange()">Elegir uno existente</button>';
    } else {
      box.innerHTML =
        '<div class="alert alert-warn">No se ha encontrado el proveedor "'+escHtml(ex.name||'')+'"'+(ex.fiscal_id?(' (NIF '+escHtml(ex.fiscal_id)+')'):'')+'. Elige uno o créalo.</div>'
        +supplierSearchHtml()
        +'<button class="btn btn-secondary btn-sm" style="margin-top:.5rem" onclick="supplierNew()">+ Crear proveedor nuevo</button>';
      bindSupplierSearch();
    }
  }
  function supplierSearchHtml(){
    return '<div style="position:relative;max-width:360px">'
      +'<input class="form-control" id="supSearch" autocomplete="off" placeholder="Buscar proveedor por nombre o NIF...">'
      +'<div id="supSuggest" style="display:none;position:absolute;z-index:30;left:0;right:0;top:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:8px;max-height:240px;overflow:auto;box-shadow:0 6px 16px rgba(0,0,0,.4)"></div>'
      +'</div>';
  }
  function bindSupplierSearch(){
    var inp = document.getElementById('supSearch'); if(!inp) return;
    var box = document.getElementById('supSuggest');
    inp.oninput = async function(){
      var q = inp.value.trim();
      if(!q){ box.style.display='none'; box.innerHTML=''; return; }
      try {
        var res = await api('GET','/api/erp/suppliers/search?q='+encodeURIComponent(q));
        if(!res.length){ box.style.display='none'; box.innerHTML=''; return; }
        box.innerHTML = res.map(function(s){
          return '<div style="padding:.5rem .7rem;cursor:pointer;border-bottom:1px solid var(--border)" onmousedown="event.preventDefault();pickSupplier('+s.id+',\\''+escJs(s.name)+'\\')"><strong>'+escHtml(s.name)+'</strong>'+(s.fiscal_id?' <span style="color:var(--text3);font-size:.8rem">'+escHtml(s.fiscal_id)+'</span>':'')+'</div>';
        }).join('');
        box.style.display='';
      } catch(e){ box.style.display='none'; }
    };
    inp.onblur = function(){ setTimeout(function(){ box.style.display='none'; },150); };
  }
  function pickSupplier(id,name){ supplier = { mode:'existing', id:id, name:name }; DATA.match.supplier = { id:id, name:name, matched_by:'manual' }; renderSupplier(); refreshOpenOrders(id); }
  function supplierChange(){ supplier = { mode:'none' }; renderSupplier(); renderDestino(); }
  function supplierNew(){ var ex = DATA.extracted.supplier; supplier = { mode:'new', name:ex.name||'', fiscal_id:ex.fiscal_id||'' }; renderSupplier(); target={mode:'direct',order_id:null}; renderDestino(); renderLines(); renderTotals(); }

  // Al elegir un proveedor manualmente, recargar sus órdenes abiertas para el destino.
  async function refreshOpenOrders(id){
    try { DATA.open_orders = await api('GET','/api/erp/purchases/capture/supplier-orders?supplier_id='+id); }
    catch(e){ DATA.open_orders = []; }
    target = { mode:'direct', order_id:null };
    renderDestino(); renderLines(); renderTotals();
  }

  // ───────── Destino (compra directa vs cuadrar contra orden) ─────────
  function renderDestino(){
    var card = document.getElementById('destinoCard');
    var oo = (supplier && supplier.mode==='existing') ? (DATA.open_orders||[]) : [];
    if(!oo.length){ card.style.display='none'; target={mode:'direct',order_id:null}; return; }
    card.style.display='';
    var box = document.getElementById('destinoBox');
    var html = '<p style="color:var(--text2);margin-bottom:.6rem">Este proveedor tiene órdenes enviadas con pendiente. Puedes cuadrar la factura contra una o registrarla como compra directa.</p>';
    html += '<label style="display:block;margin-bottom:.4rem;cursor:pointer"><input type="radio" name="dest" value="direct" '+(target.mode==='direct'?'checked':'')+' onchange="pickDest(\\'direct\\',null)"> Compra directa</label>';
    oo.forEach(function(o){
      html += '<label style="display:block;margin-bottom:.4rem;cursor:pointer"><input type="radio" name="dest" value="'+o.id+'" '+(target.mode==='order'&&target.order_id===o.id?'checked':'')+' onchange="pickDest(\\'order\\','+o.id+')"> Cuadrar contra <strong>'+escHtml(o.order_number||('#'+o.id))+'</strong> <span style="color:var(--text3);font-size:.8rem">('+o.total_pendiente+' uds. pendientes)</span></label>';
    });
    box.innerHTML = html;
  }
  function pickDest(mode, orderId){
    target = { mode:mode, order_id:orderId };
    if(mode==='order'){ buildOrderLines(orderId); }
    renderLines(); renderTotals();
  }
  // Mapea las líneas de la factura contra las pendientes de la orden por product_id.
  function buildOrderLines(orderId){
    var o = (DATA.open_orders||[]).find(function(x){return x.id===orderId;});
    orderLines = (o ? o.lines : []).map(function(l){
      // ¿trae esta factura algo de este product_id? (línea ya cuadrada al mismo producto)
      var inv = lines.find(function(x){ return x.product_mode==='existing' && x.product_id===l.product_id; });
      lineSeq++;
      return {
        uid: lineSeq,
        order_item_id: l.order_item_id,
        product_id: l.product_id,
        product_label: (l.sku?'['+l.sku+'] ':'')+l.product_name,
        pedido: l.pedido, recibido: l.recibido, pendiente: l.pendiente,
        quantity: inv ? inv.quantity : l.pendiente,
        unit_cost: inv ? inv.unit_cost : l.unit_cost
      };
    });
  }

  // ───────── Líneas ─────────
  function renderLines(){
    if(target.mode==='order') return renderOrderLines();
    document.getElementById('btnAddLine').style.display='';
    document.getElementById('linesHead').innerHTML = '<tr><th>Producto</th><th>Cantidad</th><th>Coste neto</th><th>IVA</th><th>Subtotal</th><th></th></tr>';
    var body = document.getElementById('linesBody');
    if(!lines.length){ body.innerHTML='<tr><td colspan="6" style="text-align:center;padding:1.5rem;color:var(--text3)">Sin líneas. Usa "+ Añadir línea".</td></tr>'; return; }
    body.innerHTML = lines.map(function(l){ return directRowHtml(l); }).join('');
    lines.forEach(function(l){ if(l.product_mode==='unset' || l.product_mode==='new') bindProductSearch(l.uid); });
  }
  function directRowHtml(l){
    var prodCell;
    if(l.product_mode==='existing'){
      prodCell = '<div style="display:flex;align-items:center;gap:.4rem"><span class="badge b-green">✓</span> <span>'+escHtml(l.product_label)+'</span> <button class="btn btn-secondary btn-sm" onclick="lineChangeProduct('+l.uid+')">cambiar</button></div>';
    } else if(l.product_mode==='new'){
      prodCell = newProductCell(l);
    } else {
      prodCell = '<div class="alert alert-warn" style="margin-bottom:.4rem;padding:.4rem .6rem">Sin cuadre: elige un producto o crea uno nuevo.</div>'
        +productSearchHtml(l.uid)
        +'<button class="btn btn-secondary btn-sm" style="margin-top:.4rem" onclick="lineNewProduct('+l.uid+')">+ Crear producto nuevo</button>';
    }
    var iva = l.vat_rate!=null ? (l.vat_rate+'%') : '<span style="color:var(--text3)">?</span>';
    var sub = (l.quantity*l.unit_cost)||0;
    return '<tr data-uid="'+l.uid+'">'
      +'<td style="position:relative;min-width:240px">'+prodCell+'</td>'
      +'<td><input class="form-control" type="number" min="1" step="1" value="'+l.quantity+'" style="width:80px" oninput="lineSet('+l.uid+',\\'quantity\\',this.value)"></td>'
      +'<td><input class="form-control" type="number" min="0" step="0.01" value="'+Number(l.unit_cost).toFixed(2)+'" style="width:110px" oninput="lineSet('+l.uid+',\\'unit_cost\\',this.value)"></td>'
      +'<td>'+iva+'</td>'
      +'<td class="sub" style="font-weight:600">'+dineroEs(sub, SYM)+'</td>'
      +'<td><button class="btn btn-danger btn-sm" onclick="lineRemove('+l.uid+')">×</button></td>'
      +'</tr>';
  }
  function newProductCell(l){
    var opts = '<option value="">— IVA obligatorio —</option>'+BANDS.map(function(b){ return '<option value="'+b.code+'"'+(l.new_tax_band===b.code?' selected':'')+'>'+escHtml(b.label)+' ('+b.rate+'%)</option>'; }).join('');
    return '<div style="border:1px dashed var(--border2);border-radius:8px;padding:.5rem">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.4rem"><span class="badge b-teal">Producto NUEVO</span><button class="btn btn-secondary btn-sm" onclick="lineChangeProduct('+l.uid+')">elegir existente</button></div>'
      +'<input class="form-control" placeholder="Nombre *" value="'+escHtml(l.new_name||'')+'" oninput="lineSet('+l.uid+',\\'new_name\\',this.value)" style="margin-bottom:.35rem">'
      +'<input class="form-control" placeholder="SKU (opcional)" value="'+escHtml(l.new_sku||'')+'" oninput="lineSet('+l.uid+',\\'new_sku\\',this.value)" style="margin-bottom:.35rem">'
      +'<select class="form-control" onchange="lineSet('+l.uid+',\\'new_tax_band\\',this.value)">'+opts+'</select>'
      +'</div>';
  }
  function productSearchHtml(uid){
    return '<input class="form-control prodsearch" data-uid="'+uid+'" autocomplete="off" placeholder="Buscar producto por nombre, SKU o código...">'
      +'<div class="prodsuggest" data-uid="'+uid+'" style="display:none;position:absolute;z-index:30;left:0;right:0;background:var(--bg3);border:1px solid var(--border2);border-radius:8px;max-height:240px;overflow:auto;box-shadow:0 6px 16px rgba(0,0,0,.4)"></div>';
  }
  function bindProductSearch(uid){
    var inp = document.querySelector('.prodsearch[data-uid="'+uid+'"]'); if(!inp) return;
    var box = document.querySelector('.prodsuggest[data-uid="'+uid+'"]');
    inp.oninput = async function(){
      var q = inp.value.trim();
      if(!q){ box.style.display='none'; box.innerHTML=''; return; }
      try {
        var res = await api('GET','/api/erp/products/search?q='+encodeURIComponent(q));
        if(!res.length){ box.style.display='none'; box.innerHTML=''; return; }
        box.innerHTML = res.map(function(p){
          var label = (p.sku?'['+p.sku+'] ':'')+p.name;
          return '<div style="padding:.5rem .7rem;cursor:pointer;border-bottom:1px solid var(--border)" onmousedown="event.preventDefault();linePickProduct('+uid+','+p.id+',\\''+escJs(label)+'\\')"><strong>'+escHtml(p.name)+'</strong>'+(p.sku?' <span style="color:var(--text3);font-size:.8rem">['+escHtml(p.sku)+']</span>':'')+' <span style="color:var(--text3);font-size:.8rem">'+escHtml(p.product_code||'')+'</span></div>';
        }).join('');
        box.style.display='';
      } catch(e){ box.style.display='none'; }
    };
    inp.onblur = function(){ setTimeout(function(){ box.style.display='none'; },150); };
  }
  function lineFind(uid){ return lines.find(function(l){return l.uid===uid;}); }
  function lineSet(uid, key, val){
    var l = lineFind(uid); if(!l) return;
    if(key==='quantity'){ l.quantity = parseInt(val)||0; }
    else if(key==='unit_cost'){ l.unit_cost = parseFloat(val)||0; }
    else { l[key] = val; }
    if(key==='quantity'||key==='unit_cost'){ updateRowSub(uid); renderTotals(); }
  }
  function updateRowSub(uid){
    var l = lineFind(uid); if(!l) return;
    var tr = document.querySelector('#linesBody tr[data-uid="'+uid+'"]');
    if(tr){ var s=tr.querySelector('.sub'); if(s) s.textContent=dineroEs((l.quantity*l.unit_cost)||0, SYM); }
  }
  function linePickProduct(uid, pid, label){ var l=lineFind(uid); if(!l)return; l.product_mode='existing'; l.product_id=pid; l.product_label=label; renderLines(); renderTotals(); }
  function lineChangeProduct(uid){ var l=lineFind(uid); if(!l)return; l.product_mode='unset'; l.product_id=null; renderLines(); }
  function lineNewProduct(uid){ var l=lineFind(uid); if(!l)return; l.product_mode='new'; if(!l.new_name) l.new_name=l.description||''; renderLines(); }
  function lineRemove(uid){ lines = lines.filter(function(l){return l.uid!==uid;}); renderLines(); renderTotals(); }
  function addBlankLine(){ lineSeq++; lines.push({ uid:lineSeq, description:'', quantity:1, unit_cost:0, vat_rate:null, product_mode:'unset', product_id:null, product_label:'', new_name:'', new_sku:'', new_tax_band:'' }); renderLines(); renderTotals(); }

  // ───────── Líneas en modo ORDEN ─────────
  function renderOrderLines(){
    document.getElementById('btnAddLine').style.display='none';
    document.getElementById('linesHead').innerHTML = '<tr><th>Producto</th><th>Pedido</th><th>Recibido</th><th>Pendiente</th><th>Recibir ahora</th><th>Coste neto</th><th>Subtotal</th></tr>';
    var body = document.getElementById('linesBody');
    body.innerHTML = orderLines.map(function(l){
      var sub=((l.quantity*l.unit_cost)||0);
      var warn = (l.quantity>l.pendiente) ? '<div style="color:var(--warn);font-size:.74rem;margin-top:3px">Pedido '+l.pedido+', recibirás '+(l.recibido+l.quantity)+' — exceso de '+((l.recibido+l.quantity)-l.pedido)+'</div>' : '';
      return '<tr data-uid="'+l.uid+'"'+(l.quantity>l.pendiente?' style="background:var(--warn-s)"':'')+'>'
        +'<td>'+escHtml(l.product_label)+'</td>'
        +'<td style="text-align:right">'+l.pedido+'</td>'
        +'<td style="text-align:right">'+l.recibido+'</td>'
        +'<td style="text-align:right;font-weight:600">'+l.pendiente+'</td>'
        +'<td><input class="form-control" type="number" min="0" step="1" value="'+l.quantity+'" style="width:90px" oninput="orderSet('+l.uid+',\\'quantity\\',this.value)">'+warn+'</td>'
        +'<td><input class="form-control" type="number" min="0" step="0.01" value="'+Number(l.unit_cost).toFixed(2)+'" style="width:110px" oninput="orderSet('+l.uid+',\\'unit_cost\\',this.value)"></td>'
        +'<td class="sub" style="font-weight:600">'+dineroEs(sub, SYM)+'</td>'
        +'</tr>';
    }).join('');
  }
  function orderFind(uid){ return orderLines.find(function(l){return l.uid===uid;}); }
  function orderSet(uid,key,val){ var l=orderFind(uid); if(!l)return; if(key==='quantity')l.quantity=parseInt(val)||0; else l.unit_cost=parseFloat(val)||0; renderOrderLines(); renderTotals(); }

  // ───────── Totales ─────────
  function renderTotals(){
    var rows = target.mode==='order' ? orderLines : lines;
    var byRate = {}; var base=0;
    rows.forEach(function(l){
      var b = (l.quantity*l.unit_cost)||0; base += b;
      var rate = (l.vat_rate!=null) ? l.vat_rate : '?';
      byRate[rate] = (byRate[rate]||0) + b;
    });
    var ivaTotal=0, rateHtml='';
    Object.keys(byRate).forEach(function(rate){
      if(rate==='?'){ rateHtml += '<div style="display:flex;justify-content:space-between"><span>IVA (sin tasa indicada)</span><span>—</span></div>'; return; }
      var iva = byRate[rate]*Number(rate)/100; ivaTotal+=iva;
      rateHtml += '<div style="display:flex;justify-content:space-between"><span>IVA '+rate+'% sobre '+byRate[rate].toFixed(2)+'</span><span>'+dineroEs(iva, SYM)+'</span></div>';
    });
    var total = base + ivaTotal;
    // Importes que generarán AUTO la factura recibida (la deuda) al confirmar. El total es
    // CON IVA (lo que se debe).
    LAST_TOTALS = {
      base: Math.round(base*100)/100,
      tax: Math.round(ivaTotal*100)/100,
      total: Math.round(total*100)/100
    };
    var ex = DATA.extracted.totals||{};
    var cmp = '';
    if(ex.total!=null){
      var diff = Math.abs(total - ex.total);
      cmp = (diff>0.02)
        ? '<div class="alert alert-warn" style="margin-top:.6rem">Los totales calculados ('+dineroEs(total, SYM)+') no cuadran con los del documento ('+dineroEs(ex.total, SYM)+'). Revisa, pero puedes confirmar lo que veas correcto.</div>'
        : '<div style="color:var(--text3);font-size:.78rem;margin-top:.5rem">Cuadra con el total del documento ('+dineroEs(ex.total, SYM)+').</div>';
    }
    document.getElementById('totalsBox').innerHTML =
      '<div style="display:flex;justify-content:space-between;margin-bottom:.3rem"><span>Base</span><strong>'+dineroEs(base, SYM)+'</strong></div>'
      +rateHtml
      +'<div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);margin-top:.4rem;padding-top:.4rem"><span style="font-weight:700">Total</span><strong style="font-size:1.1rem">'+dineroEs(total, SYM)+'</strong></div>'
      +(ex.base!=null||ex.total!=null ? '<div style="color:var(--text3);font-size:.78rem;margin-top:.4rem">Documento: base '+(ex.base!=null?Number(ex.base).toFixed(2):'—')+' · IVA '+(ex.tax!=null?Number(ex.tax).toFixed(2):'—')+' · total '+(ex.total!=null?Number(ex.total).toFixed(2):'—')+' '+SYM+'</div>' : '')
      +cmp;
  }

  // ───────── Confirmar ─────────
  async function confirmCapture(){
    var date = document.getElementById('fDate').value;
    if(!date){ toast('La fecha es obligatoria','err'); return; }
    var payload = {
      attachment_id: DATA.attachment_id,
      reference: document.getElementById('fRef').value.trim(),
      date: date,
      notes: document.getElementById('fNotes').value.trim(),
      target_mode: target.mode,
      order_id: target.mode==='order' ? target.order_id : null,
      supplier_mode: supplier.mode==='new' ? 'new' : 'existing',
      supplier_id: supplier.mode==='existing' ? supplier.id : null,
      new_supplier: supplier.mode==='new' ? { name:(supplier.name||'').trim(), fiscal_id:(supplier.fiscal_id||'').trim() } : null,
      lines: [],
      confirm_excess: false,
      // Importes de la factura del proveedor → factura recibida (deuda) automática.
      inv_base: LAST_TOTALS.base,
      inv_tax: LAST_TOTALS.tax,
      inv_total: LAST_TOTALS.total
    };
    if(target.mode==='order'){
      var excess = [];
      payload.lines = orderLines.filter(function(l){return l.quantity>0;}).map(function(l){
        if(l.quantity>l.pendiente) excess.push(l.product_label+': pedido '+l.pedido+', recibirás '+(l.recibido+l.quantity));
        return { product_mode:'existing', order_item_id:l.order_item_id, quantity:l.quantity, unit_cost:l.unit_cost };
      });
      if(!payload.lines.length){ toast('Indica al menos una línea con cantidad','err'); return; }
      if(excess.length){
        if(!await window.confirmarEnPagina({titulo:'Vas a recibir MÁS de lo pedido',texto:excess.join(' · '),aceptar:'Confirmar el exceso'})) return;
        payload.confirm_excess = true;
      }
    } else {
      if(supplier.mode==='none'){ toast('Elige o crea el proveedor','err'); return; }
      if(supplier.mode==='new' && !(supplier.name||'').trim()){ toast('El proveedor nuevo necesita nombre','err'); return; }
      var bad = null;
      payload.lines = lines.filter(function(l){return l.quantity>0;}).map(function(l){
        if(l.product_mode==='existing'){ return { product_mode:'existing', product_id:l.product_id, quantity:l.quantity, unit_cost:l.unit_cost }; }
        if(l.product_mode==='new'){
          if(!(l.new_name||'').trim()) bad='Un producto nuevo necesita nombre';
          if(!l.new_tax_band) bad='Elige la banda de IVA del producto nuevo "'+(l.new_name||'')+'"';
          return { product_mode:'new', new_name:(l.new_name||'').trim(), new_sku:(l.new_sku||'').trim(), new_tax_band:l.new_tax_band, quantity:l.quantity, unit_cost:l.unit_cost };
        }
        bad='Hay una línea sin producto: elige uno o créalo (o bórrala)';
        return null;
      });
      if(bad){ toast(bad,'err'); return; }
      if(!payload.lines.length){ toast('Añade al menos una línea con cantidad','err'); return; }
    }
    var btn = document.getElementById('btnConfirm'); btn.disabled=true;
    try {
      var r = await api('POST','/api/erp/purchases/capture/confirm', payload);
      toast(r.message||'Registrado');
      window.location.href = r.redirect;
    } catch(e){ toast(e.message||'Error al registrar','err'); btn.disabled=false; }
  }

  // util para meter strings en handlers inline
  window.escJs = function(s){ return String(s==null?'':s).replace(/\\\\/g,'\\\\\\\\').replace(/'/g,"\\\\'").replace(/"/g,'&quot;').replace(/\\n/g,' '); };

  // drag & drop sobre la zona de subida
  (function(){
    var dz = document.getElementById('dropZone');
    if(!dz) return;
    ['dragover','dragenter'].forEach(function(ev){ dz.addEventListener(ev,function(e){ e.preventDefault(); dz.style.borderColor='var(--teal)'; }); });
    ['dragleave','drop'].forEach(function(ev){ dz.addEventListener(ev,function(e){ e.preventDefault(); dz.style.borderColor='var(--border2)'; }); });
    dz.addEventListener('drop',function(e){ if(e.dataTransfer.files.length){ document.getElementById('fileInput').files=e.dataTransfer.files; onFilePick(); } });
  })();

  // Precarga desde el chat de DISA (sin re-extraer): salta el Paso 1 y monta la revisión.
  if (PRELOAD) { DATA = PRELOAD; buildReview(); }
  </script>`;
}
