import { z } from 'zod';
import { str, strOpt, email as emailField, price, intPos } from '../../core/validate.js';
import { ADJUST_REASONS, ADJUST_MODES } from './stock.js';

const optId = z.union([z.null(), z.coerce.number().int().positive()]).optional();
// Multi-almacén · Capa 2 — almacén opcional en las operaciones. Permisivo: '' / null /
// ausente = "no se eligió" → el servidor cae al principal (resolveWarehouseId). Nunca rechaza.
const optWarehouse = z.union([z.literal(''), z.null(), z.coerce.number().int().positive()]).optional();
const priceOpt = z.union([z.null(), z.coerce.number().nonnegative().max(1_000_000)]).optional();

// ── Products ───────────────────────────────────────────────────
export const productSchema = z.object({
  name: str(200),
  sku: str(100),                 // obligatorio
  description: strOpt(5000),
  price,
  compare_price: priceOpt,
  image_url: strOpt(500),
  digital_file_url: strOpt(500),
  category_id: optId,
  status: z.enum(['active', 'draft', 'archived']).default('active'),
  type: z.enum(['physical', 'digital', 'service']).default('physical'),  // P1+P2: + servicio
  tax_band: str(40),                                                     // OBLIGATORIO (dato fiscal): banda de IVA; el % lo resuelve el servidor desde banda+país
  featured: z.coerce.boolean().default(false),
  tags: z.array(intPos).optional().default([]),
  stock: z.coerce.number().int().min(0).default(0),
  warehouse_id: optWarehouse,            // Capa 2: almacén del stock inicial (apertura); principal por defecto
});

export const productImageSchema = z.object({
  url: str(500),
  alt: strOpt(200),
  position: z.coerce.number().int().nonnegative().optional().default(0),
});

export const variantSchema = z.object({
  name: str(200),
  option1_name: strOpt(100),
  option1_value: strOpt(100),
  option2_name: strOpt(100),
  option2_value: strOpt(100),
  sku: strOpt(100),
  price: priceOpt,
  stock: intPos.optional().default(0),
});

export const tagSchema = z.object({ name: str(100) });

// ── Categories ─────────────────────────────────────────────────
export const categorySchema = z.object({
  name: str(100),
  description: strOpt(500),
});

// ── Clients ────────────────────────────────────────────────────
export const clientSchema = z.object({
  name: str(200),
  fiscal_id: strOpt(50),
  email: emailField.optional().or(z.literal('')),
  phone: strOpt(50),
  address: strOpt(500),
  city: strOpt(100),
  country: strOpt(100),
  group_id: optId,
  notes: strOpt(2000),
  accepts_newsletter: z.coerce.boolean().optional().default(false),
  // T3 — datos de gestión. El IRPF NO es del cliente (es del autónomo): el cliente solo
  // aporta el tipo (particular/empresa); el % vive en la config del negocio y en la factura.
  client_type: z.enum(['particular', 'empresa']).optional().default('particular'),
  payment_term_days: z.coerce.number().int().min(0).optional().default(0),
  payment_method: z.enum(['', 'transferencia', 'efectivo', 'tarjeta', 'domiciliacion']).optional().default(''),
  // T4 Paso 2 — perfil de cobro: gobierna la cadencia de la próxima acción (motor en cobros.js).
  collections_profile: z.enum(['suave', 'estandar', 'firme', 'manual']).optional().default('estandar'),
});

// T5 — valores EXACTOS permitidos en los campos de lista cerrada del cliente, extraídos del
// propio clientSchema (fuente única: no se escriben a mano → no se desincronizan). Los usa
// DISA para no inventar valores. Desenvuelve los wrappers default/optional hasta el enum.
function enumOptions(schema) {
  let s = schema;
  // Desenvuelve default/optional/nullable/effects hasta llegar al enum (compatible zod v3/v4).
  for (let i = 0; i < 8 && s && s._def; i++) {
    if (Array.isArray(s.options)) return s.options.slice();   // ZodEnum.options (público)
    s = s._def.innerType || s._def.schema || null;
  }
  return (s && Array.isArray(s.options)) ? s.options.slice() : null;
}
export const clientFieldOptions = {
  client_type: enumOptions(clientSchema.shape.client_type),
  payment_method: enumOptions(clientSchema.shape.payment_method),
  collections_profile: enumOptions(clientSchema.shape.collections_profile),
};

export const clientGroupSchema = z.object({
  name: str(100),
  description: strOpt(500),
  discount_pct: z.coerce.number().min(0).max(100).optional().default(0),
});

// ── Orders ─────────────────────────────────────────────────────
const posItemSchema = z.object({
  id: intPos,
  variant_id: optId,
  name: z.string().max(200),
  price,
  qty: z.coerce.number().int().positive(),
});

export const posSchema = z.object({
  client_id: optId,
  items: z.array(posItemSchema).min(1),
  shipping_method_id: optId,
  discount_code: z.union([z.string().max(50), z.null()]).optional(),
  warehouse_id: optWarehouse,            // Capa 2: almacén de la venta (guarda + salida); principal por defecto
});

export const orderStatusSchema = z.object({
  status: z.enum(['borrador','en_preparacion','enviado','completado','cancelado','reembolsado']),
  comment: strOpt(500),
});

export const orderNotesSchema = z.object({
  admin_notes: strOpt(2000),
});

export const orderTrackingSchema = z.object({
  tracking_number: strOpt(100),
});

export const refundSchema = z.object({
  amount: z.coerce.number().positive().max(1_000_000),
  reason: strOpt(500),
});

// ── Invoices ───────────────────────────────────────────────────
const invoiceLineSchema = z.object({
  description: str(500),
  quantity:    z.coerce.number().positive().max(1_000_000),
  unit_price:  z.coerce.number().nonnegative().max(1_000_000),
  tax_rate:    z.coerce.number().min(0).max(50).optional().default(0),  // A2: IVA por línea
  product_id:  optId,   // si la línea procede del catálogo: enlaza al producto para el aviso de exceso de stock (físicos)
});

export const invoiceCreateSchema = z.object({
  client_id:  intPos,
  lines:      z.array(invoiceLineSchema).min(1, 'Al menos una línea requerida'),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes:      strOpt(2000),
  irpf_rate:  z.coerce.number().min(0).max(50).optional().default(0),   // A2: IRPF global
  // Exceso de stock: facturar un físico por más de lo disponible NO se bloquea, pero NUNCA
  // en silencio — con exceso y sin este flag → 400; con el flag, solo si el usuario tiene
  // el permiso sales.emit_over_stock (owner/admin). El stock NO se mueve (la factura no es POS).
  confirm_excess: z.coerce.boolean().optional().default(false),
});

// A2: payload para POST /api/erp/invoices/compute-totals (preview en vivo)
export const invoiceComputeSchema = z.object({
  lines:     z.array(invoiceLineSchema).min(1, 'Al menos una línea requerida'),
  irpf_rate: z.coerce.number().min(0).max(50).optional().default(0),
});

// Ciclo de vida — ANULAR: solo requiere un motivo. La original no se toca salvo el status.
export const invoiceAnularSchema = z.object({
  motivo: z.string().trim().min(3, 'Indica el motivo de la anulación').max(500),
});

// Ciclo de vida — RECTIFICATIVA: factura nueva (serie propia) que referencia a la
// original. ADMITE IMPORTES NEGATIVOS (abono): a diferencia de la factura ordinaria,
// quantity y unit_price pueden ser negativos para devoluciones/anulación de operación.
const rectificativeLineSchema = z.object({
  description: str(500),
  quantity:    z.coerce.number().gte(-1_000_000).lte(1_000_000).refine(n => n !== 0, 'La cantidad no puede ser 0'),
  unit_price:  z.coerce.number().gte(-1_000_000).lte(1_000_000),
  tax_rate:    z.coerce.number().min(0).max(50).optional().default(0),
});

export const invoiceRectificativaSchema = z.object({
  rectification_type: z.enum(['R1', 'R2', 'R3', 'R4', 'R5']),   // tipo legal R1–R5
  rectification_mode: z.enum(['S', 'I']),                        // S sustitución | I diferencias
  lines:      z.array(rectificativeLineSchema).min(1, 'Al menos una línea requerida'),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes:      strOpt(2000),
  irpf_rate:  z.coerce.number().min(0).max(50).optional().default(0),
});

// T4 Paso 1 — registrar un cobro de una factura (total o parcial). El importe es
// positivo (dinero recibido); el estado de cobro se calcula en vivo, no se guarda.
export const invoicePaymentSchema = z.object({
  amount:         z.coerce.number().positive('El importe debe ser mayor que 0').max(1_000_000),
  paid_date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  payment_method: z.string().trim().max(40).optional().default(''),
  note:           strOpt(500),
});

// T4 Paso 2 — registrar una ACCIÓN de cobro (recordatorio por email, contacto manual o
// promesa de pago). El email es confirm-first: el cuerpo editado por el usuario llega en
// email_subject/email_text (opcionales). promesa_pago exige fecha.
export const collectionActionSchema = z.object({
  type:          z.enum(['recordatorio_email', 'contacto_manual', 'promesa_pago']),
  channel:       z.enum(['email', 'telefono', 'whatsapp', 'otro']).optional().nullable(),
  note:          strOpt(1000),
  promised_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  email_subject: z.string().trim().max(200).optional(),
  email_text:    z.string().max(5000).optional(),
}).refine(d => d.type !== 'promesa_pago' || !!d.promised_date, {
  message: 'La promesa de pago necesita una fecha', path: ['promised_date'],
});

// T4 Paso 2.1 — acción a nivel de CUENTA del cliente (sobre todas sus facturas vivas).
// cobro_cuenta lleva importe + modo (auto/manual) y, en manual, el reparto por factura.
export const accountActionSchema = z.object({
  type:          z.enum(['recordatorio_cuenta', 'promesa_cuenta', 'cobro_cuenta']),
  note:          strOpt(1000),
  promised_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  email_subject: z.string().trim().max(200).optional(),
  email_text:    z.string().max(8000).optional(),
  importe:       z.coerce.number().positive().max(1_000_000).optional(),
  modo:          z.enum(['auto', 'manual']).optional().default('auto'),
  payment_method: z.string().trim().max(40).optional().default(''),
  asignacion:    z.array(z.object({
                   invoice_id: z.coerce.number().int().positive(),
                   importe:    z.coerce.number().min(0).max(1_000_000),
                 })).optional(),
}).refine(d => d.type !== 'promesa_cuenta' || !!d.promised_date, {
  message: 'La promesa de cuenta necesita una fecha', path: ['promised_date'],
}).refine(d => d.type !== 'cobro_cuenta' || (d.importe && d.importe > 0), {
  message: 'El cobro a cuenta necesita un importe', path: ['importe'],
}).refine(d => d.type !== 'cobro_cuenta' || d.modo !== 'manual' || (Array.isArray(d.asignacion) && d.asignacion.length > 0), {
  message: 'El reparto manual necesita la asignación por factura', path: ['asignacion'],
});

// ── Discounts ──────────────────────────────────────────────────
export const discountCodeSchema = z.object({
  code: z.string().trim().min(3).max(50).regex(/^[A-Z0-9_-]+$/i),
  type: z.enum(['percentage', 'fixed']),
  value: price,
  min_order: z.coerce.number().nonnegative().optional().default(0),
  max_uses: z.union([z.null(), z.coerce.number().int().positive()]).optional(),
  active: z.coerce.boolean().optional().default(true),
  expires_at: strOpt(30),
});

export const autoDiscountSchema = z.object({
  name: str(200),
  type: z.enum(['percentage', 'fixed']),
  value: price,
  condition_type: z.enum(['min_order', 'category']).default('min_order'),
  condition_value: z.string().max(100).optional().default('0'),
});

// ── Inventory ──────────────────────────────────────────────────
export const inventoryMovementSchema = z.object({
  product_id: intPos,
  type: z.enum(['in', 'out', 'adjust']),
  quantity: z.coerce.number().int().positive(),
  reason: strOpt(500),
});

// Pilar 3 · Paso 1 — ajuste manual de stock: modo (poner/sumar/restar) + motivo (lista
// cerrada) obligatorio + nota opcional. Tipos/motivos vienen del motor (fuente única).
export const stockAdjustSchema = z.object({
  mode:   z.enum(ADJUST_MODES),
  value:  z.coerce.number().int().min(0),
  reason: z.enum(ADJUST_REASONS),
  note:   strOpt(500),
  warehouse_id: optWarehouse,            // Capa 2: almacén del ajuste; principal por defecto
});

// ── Shipping ───────────────────────────────────────────────────
export const shippingSchema = z.object({
  name: str(100),
  description: strOpt(500),
  price,
  free_from: priceOpt,
  estimated_days: strOpt(100),
  active: z.coerce.boolean().default(true),
});

// ── Users ──────────────────────────────────────────────────────
export const userCreateSchema = z.object({
  name: str(100),
  email: emailField,
  password: z.string().min(10).max(200),
  role: z.enum(['owner', 'admin', 'employee', 'readonly']),
});

export const userUpdateSchema = z.object({
  name: str(100).optional(),
  email: emailField.optional().or(z.literal('')),
  password: z.string().min(10).max(200).optional(),
  role: z.enum(['owner', 'admin', 'employee', 'readonly']).optional(),
  active: z.coerce.boolean().optional(),
});

// ── Settings ───────────────────────────────────────────────────
// A2: companySchema deja de ser passthrough puro para validar tax_rate.
// El resto de campos siguen pasando libres (passthrough).
export const companySchema = z.object({
  tax_rate: z.coerce.number().min(0).max(50).optional(),
  irpf_default: z.coerce.number().min(0).max(100).optional(),
}).passthrough();
export const storeSettingsSchema = z.object({}).passthrough();

// ── Reviews ────────────────────────────────────────────────────
export const reviewStatusSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']),
});

// ── Auth ───────────────────────────────────────────────────────
export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1).max(200),
});

export const changePwdSchema = z.object({
  current_password: z.string().min(1).max(200),
  new_password: z.string().min(10).max(200),
  confirm_password: z.string().min(10).max(200),
});

// ── Suppliers / Purchases ──────────────────────────────────────
export const supplierSchema = z.object({
  name:      str(200),
  fiscal_id: strOpt(50),   // NIF/CIF — guarda de duplicados (solo activos; vacío no bloquea)
  contact:   strOpt(200),
  email:     strOpt(200),
  phone:     strOpt(50),
  address:   strOpt(500),
  city:      strOpt(100),
  notes:     strOpt(1000),
  // Capa de dinero (a) — datos de gestión, espejo del T3 de clients. Defaults seguros
  // (contado / sin especificar): el vencimiento de la factura recibida sale de aquí.
  payment_term_days: z.coerce.number().int().min(0).max(3650).optional().default(0),
  payment_method:    z.enum(['', 'transferencia', 'efectivo', 'tarjeta', 'domiciliacion']).optional().default(''),
});

// ── Factura recibida (Capa de dinero proveedor · Paso a) ───────────────────────
// Creación MANUAL: la mercancía llegó antes que la factura. SIEMPRE enlazada a un
// documento de stock YA existente (recepción confirmada o compra recibida). El total
// es CON IVA (lo que se debe). base/tax son informativos del documento. supplier_id se
// deriva del documento de origen en el servicio (no se teclea suelto).
// Una línea de factura de GASTO: concepto libre + base + tipo de IVA (banda legal). La cuota
// la calcula el servidor (base*tax_rate/100); 0% = exento permitido.
const supplierInvoiceLineSchema = z.object({
  concepto: z.string().trim().max(300).optional().default(''),
  base:     z.coerce.number().min(0).max(100_000_000),
  tax_rate: z.coerce.number().min(0).max(50),
});

// Factura recibida — DOS modos en un solo schema:
//  (a) CON origen de stock (paso a): entity_type+entity_id + total (proveedor derivado del origen).
//  (b) GASTO PURO (paso b): supplier_id directo + ≥1 línea (concepto/base/IVA); total = Σ líneas.
export const supplierInvoiceSchema = z.object({
  entity_type:             z.enum(['po_receipt', 'purchase']).optional(),
  entity_id:               z.coerce.number().int().positive().optional(),
  supplier_id:             z.coerce.number().int().positive().optional(),   // gasto: proveedor tecleado
  expense_category:        strOpt(80),
  lines:                   z.array(supplierInvoiceLineSchema).optional(),
  supplier_invoice_number: strOpt(100),
  invoice_date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  due_date:                z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),   // gasto: editable
  base:                    z.coerce.number().min(0).max(100_000_000).optional().default(0),
  tax:                     z.coerce.number().min(0).max(100_000_000).optional().default(0),
  total:                   z.coerce.number().min(0).max(100_000_000).optional(),
  notes:                   strOpt(1000),
})
  .refine(d => d.entity_type ? !!d.entity_id : true, { message: 'Falta el documento de origen', path: ['entity_id'] })
  .refine(d => d.entity_type || d.supplier_id, { message: 'Indica el proveedor (factura de gasto) o el documento de origen', path: ['supplier_id'] })
  .refine(d => d.entity_type || (Array.isArray(d.lines) && d.lines.length >= 1), { message: 'Una factura de gasto necesita al menos una línea', path: ['lines'] })
  .refine(d => d.entity_type ? (d.total != null && d.total > 0) : true, { message: 'El total debe ser mayor que 0', path: ['total'] });

// Anular una factura recibida: solo motivo (mismo criterio que factura/devoluciones).
export const supplierInvoiceAnularSchema = z.object({
  motivo: z.string().trim().min(3, 'Indica el motivo de la anulación').max(500),
});

// Registrar un pago a proveedor (total o parcial). Espejo EXACTO de invoicePaymentSchema:
// importe positivo (dinero pagado); el estado de pago se calcula en vivo, no se guarda.
export const supplierPaymentSchema = z.object({
  amount:         z.coerce.number().positive('El importe debe ser mayor que 0').max(1_000_000),
  paid_date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  payment_method: z.string().trim().max(40).optional().default(''),
  note:           strOpt(500),
});

// Paso (e) — PAGO A CUENTA del proveedor (saldar varias facturas a la vez). Espejo de
// accountActionSchema (parte cobro_cuenta), lado proveedor: importe + modo (auto/manual) y,
// en manual, el reparto por factura. Lo valida el endpoint; el reparto lo hace el servicio.
export const supplierAccountPaymentSchema = z.object({
  amount:         z.coerce.number().positive('El importe debe ser mayor que 0').max(1_000_000),
  modo:           z.enum(['auto', 'manual']).optional().default('auto'),
  paid_date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  payment_method: z.string().trim().max(40).optional().default(''),
  note:           strOpt(500),
  asignacion:     z.array(z.object({
                    supplier_invoice_id: z.coerce.number().int().positive(),
                    importe:             z.coerce.number().min(0).max(1_000_000),
                  })).optional(),
}).refine(d => d.modo !== 'manual' || (Array.isArray(d.asignacion) && d.asignacion.length > 0), {
  message: 'El reparto manual necesita la asignación por factura', path: ['asignacion'],
});

// Multi-almacén · Capa 1 — el almacén solo tiene nombre (obligatorio, único entre activos
// lo valida el servicio contra la BD). is_default/active los gobiernan acciones propias.
export const warehouseSchema = z.object({
  name: str(120),
});

export const purchaseItemSchema = z.object({
  product_id: intPos,
  quantity:   intPos,
  unit_cost:  price,
});

export const purchaseSchema = z.object({
  supplier_id: intPos,
  reference:   strOpt(100),
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes:       strOpt(1000),
  status:      z.enum(['pending','received','cancelled']).default('received'),
  items:       z.array(purchaseItemSchema).min(1),
  warehouse_id: optWarehouse,            // Capa 2: almacén de destino de la compra; principal por defecto
});

// ── Orden de compra (C1.a) ─────────────────────────────────────
// La línea SIEMPRE es un producto del catálogo (sin línea libre) y su coste es NETO
// (sin IVA). El tax_rate NO viene del cliente: lo resuelve el servidor desde el
// producto (products.tax_rate, ya resuelto de su banda legal) al guardar la línea.
const purchaseOrderItemSchema = z.object({
  product_id: z.coerce.number().int().positive(),
  quantity:   z.coerce.number().int().positive(),
  unit_cost:  price,
});

export const purchaseOrderSchema = z.object({
  supplier_id:   z.coerce.number().int().positive(),
  date:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expected_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  notes:         strOpt(1000),
  items:         z.array(purchaseOrderItemSchema).min(1, 'Al menos una línea requerida'),
});

// Anular (y anular-y-rehacer): motivo obligatorio, mismo criterio que la factura.
export const purchaseOrderAnularSchema = z.object({
  motivo: z.string().trim().min(3, 'Indica el motivo de la anulación').max(500),
});

// C1.b — Recepción contra la orden: líneas referenciadas por order_item_id; la cantidad
// no puede superar el pendiente (lo valida el servicio contra la BD) y el coste es el
// REALMENTE recibido (precargado del de la orden, editable). Anular reusa el schema de motivo.
const purchaseOrderReceiptItemSchema = z.object({
  order_item_id: z.coerce.number().int().positive(),
  quantity:      z.coerce.number().int().positive(),
  unit_cost:     price,
});

export const purchaseOrderReceiptSchema = z.object({
  date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: strOpt(1000),
  items: z.array(purchaseOrderReceiptItemSchema).min(1, 'Al menos una línea requerida'),
  // C1.c — recibir MÁS que el pendiente exige confirmación EXPLÍCITA del cliente
  // (aviso confirmado, nunca silencioso): con exceso y sin este flag → 400.
  confirm_excess: z.coerce.boolean().optional().default(false),
  warehouse_id: optWarehouse,            // Capa 2: almacén de ESTA recepción; principal por defecto
});

// ── Devolución a proveedor ─────────────────────────────────────
// Solo la capa física. La línea referencia la línea de ORIGEN (origin_item_id) de la
// compra/recepción; el coste NO viene del cliente (lo copia el servidor del origen). La
// cantidad ≤ devolvible la valida el servicio contra la BD. Motivo obligatorio (mín. 3).
const supplierReturnItemSchema = z.object({
  origin_item_id: z.coerce.number().int().positive(),
  quantity:       z.coerce.number().int().positive(),
});

export const supplierReturnSchema = z.object({
  origin_type: z.enum(['purchase', 'po_receipt']),
  origin_id:   z.coerce.number().int().positive(),
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  motivo:      z.string().trim().min(3, 'Indica el motivo de la devolución').max(500),
  notes:       strOpt(1000),
  items:       z.array(supplierReturnItemSchema).min(1, 'Al menos una línea requerida'),
});

// ── Traslado entre almacenes (Multi-almacén · Capa 3) ──────────
// Mueve mercancía de un almacén a otro en un solo gesto (sale de uno, entra en otro).
// El coste NO viene del cliente: lo congela el servidor del WAC global del producto al
// confirmar. La cantidad ≤ disponible en ORIGEN la valida el servicio contra la BD.
// origen ≠ destino y ambos activos los valida el servicio. Multi-línea (varios productos
// entre los DOS mismos almacenes). Sin motivo al crear; el motivo es obligatorio al ANULAR.
const stockTransferItemSchema = z.object({
  product_id: intPos,
  quantity:   intPos,
});

export const stockTransferSchema = z.object({
  from_warehouse_id: intPos,
  to_warehouse_id:   intPos,
  date:              z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes:             strOpt(1000),
  items:             z.array(stockTransferItemSchema).min(1, 'Al menos una línea requerida'),
});

export const draftOrderSchema = z.object({
  client_id:      optId,
  items:          z.array(posItemSchema).min(1),
  customer_notes: strOpt(1000),
  admin_notes:    strOpt(1000),
});
