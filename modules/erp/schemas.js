import { z } from 'zod';
import { str, strOpt, email as emailField, price, intPos } from '../../core/validate.js';

const optId = z.union([z.null(), z.coerce.number().int().positive()]).optional();
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
  // T3 — datos de gestión (solo se guardan; el cálculo de IRPF es de Ventas).
  client_type: z.enum(['particular', 'empresa']).optional().default('particular'),
  irpf_rate: z.coerce.number().min(0).max(100).optional().default(0),
  payment_term_days: z.coerce.number().int().min(0).optional().default(0),
  payment_method: z.enum(['', 'transferencia', 'efectivo', 'tarjeta', 'domiciliacion']).optional().default(''),
});

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
});

export const invoiceCreateSchema = z.object({
  client_id:  intPos,
  lines:      z.array(invoiceLineSchema).min(1, 'Al menos una línea requerida'),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes:      strOpt(2000),
  irpf_rate:  z.coerce.number().min(0).max(50).optional().default(0),   // A2: IRPF global
});

// A2: payload para POST /api/erp/invoices/compute-totals (preview en vivo)
export const invoiceComputeSchema = z.object({
  lines:     z.array(invoiceLineSchema).min(1, 'Al menos una línea requerida'),
  irpf_rate: z.coerce.number().min(0).max(50).optional().default(0),
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
  name:    str(200),
  contact: strOpt(200),
  email:   strOpt(200),
  phone:   strOpt(50),
  notes:   strOpt(1000),
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
});

export const draftOrderSchema = z.object({
  client_id:      optId,
  items:          z.array(posItemSchema).min(1),
  customer_notes: strOpt(1000),
  admin_notes:    strOpt(1000),
});
