import { z } from 'zod';
import { str, strOpt, email as emailField, price, intPos } from '../../core/validate.js';
import { ADJUST_REASONS, ADJUST_MODES } from './stock.js';
// CRM: las listas cerradas viven en el motor (crm.js). Aquí solo se validan. Sin ciclo de imports:
// crm.js no importa schemas.js (solo core/escape.js).
import { ETAPA_KEYS, ORIGENES, MOTIVOS_PERDIDA, CANALES } from './crm.js';

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
  supplier_id: optId,             // proveedor HABITUAL (opcional). Antes se perdía: la columna, el <select>
                                  //  y el SQL existían, pero faltaba aquí y Zod lo stripeaba → siempre null.
  status: z.enum(['active', 'draft', 'archived']).default('active'),
  type: z.enum(['physical', 'digital', 'service']).default('physical'),  // P1+P2: + servicio
  tracking: z.enum(['none', 'lot', 'serial']).default('none'),           // Pilar 3: traza por lote / nº de serie

  tax_band: str(40),                                                     // OBLIGATORIO (dato fiscal): banda de IVA; el % lo resuelve el servidor desde banda+país
  featured: z.coerce.boolean().default(false),
  tags: z.array(intPos).optional().default([]),
  stock: z.coerce.number().int().min(0).default(0),
  warehouse_id: optWarehouse,            // Capa 2: almacén del stock inicial (apertura); principal por defecto
});

// Niveles de reposición por almacén (stock mínimo / objetivo). El cliente manda una fila por almacén;
// min_qty=0 = "no vigilar ese almacén" (el servicio borra la fila). Enteros no negativos.
export const stockLevelSchema = z.object({
  warehouse_id: z.coerce.number().int().positive(),
  min_qty:      z.coerce.number().int().min(0).max(1_000_000).default(0),
  target_qty:   z.coerce.number().int().min(0).max(1_000_000).default(0),
});
export const stockLevelsSchema = z.object({
  levels: z.array(stockLevelSchema).max(200).default([]),
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
  // Facturae exige dirección fiscal estructurada (Address · PostCode · Town · Province ·
  // CountryCode). Opcionales: solo hacen falta para exportar a Facturae/FACe.
  postal_code: strOpt(10),
  province: strOpt(100),
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
  // CRM — RESPONSABLE (dueño comercial de la ficha). `optId` acepta vacío/0 → null = "sin asignar",
  // que es un estado legítimo y NO un error: los clientes existentes nacen así y el dueño reparte
  // cuando quiera. Se asigna a mano; ni reparto automático ni DISA (decisión del dueño).
  responsable_user_id: optId,
});

// ── Peldaño 7 · PIEZA 1 — PROYECTO (entidad de servicios profesionales) ──────────────────────────
// El `codigo` (PRY-NNNN) NO se valida aquí: lo asigna el servidor con el contador (no editable). `cliente_id`
// y `responsable_id` son FK OPCIONALES (optId: vacío/0 → null = sin asignar), leídas EN VIVO al pintar.
// `modo_cobro` es LISTA CERRADA (z.enum rechaza cualquier otro valor → 400). `tarifa_hora`/`precio_cerrado`
// son opcionales aquí; el servicio guarda solo la que corresponde al modo (la otra a null).
export const proyectoSchema = z.object({
  nombre: str(200),
  cliente_id: optId,
  responsable_id: optId,
  modo_cobro: z.enum(['horas', 'precio_cerrado']),
  tarifa_hora: priceOpt,
  precio_cerrado: priceOpt,
  fecha_inicio: strOpt(10),
  fecha_fin_prevista: strOpt(10),
  estado: z.enum(['abierto', 'cerrado']).optional().default('abierto'),
  notas: strOpt(2000),
});

// ── Peldaño 7 · PIEZA 2 — REGISTRO DE TIEMPO ─────────────────────────────────────────────────────
// Arrancar cronómetro: solo proyecto + descripción (la duración la cuenta el servidor al parar).
export const tiempoStartSchema = z.object({
  proyecto_id: z.coerce.number().int().positive(),
  descripcion: strOpt(300),
});
// Entrada MANUAL o EDICIÓN: proyecto + descripción + fecha (YYYY-MM-DD) + duración (horas + minutos, sin
// redondeos → el servidor la pasa a segundos) + facturable. La duración total debe ser > 0 (lo valida el
// servicio). NO se pide tarifa: el importe se calcula con la de la persona.
export const tiempoManualSchema = z.object({
  proyecto_id: z.coerce.number().int().positive(),
  descripcion: strOpt(300),
  fecha: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe ser AAAA-MM-DD'),
  horas: z.coerce.number().int().min(0).max(999).optional().default(0),
  minutos: z.coerce.number().int().min(0).max(59).optional().default(0),
  facturable: z.coerce.boolean().optional().default(true),
});

// ── Peldaño 7 · PIEZA 3 — FACTURAR HORAS ─────────────────────────────────────────────────────────
// Selección de entradas de tiempo a facturar (el cliente sale del proyecto). `tax_rate`/`irpf_rate` son
// opcionales (si no vienen: el IVA general de la empresa y 0 de IRPF). La agrupación en líneas por
// (tarea + tarifa) y las guardas (proyecto con cliente, entradas facturables/no facturadas) las hace el servicio.
export const facturarHorasSchema = z.object({
  proyecto_id: z.coerce.number().int().positive(),
  entry_ids: z.array(z.coerce.number().int().positive()).min(1),
  issue_date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  tax_rate: z.coerce.number().min(0).max(100).optional(),
  irpf_rate: z.coerce.number().min(0).max(60).optional().default(0),
});

// ── Peldaño 7 · PIEZA 5 — SISTEMA DE CITAS ───────────────────────────────────────────────────────
const fechaISO = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe ser AAAA-MM-DD');
const minDia = z.coerce.number().int().min(0).max(1439);        // minuto del día [0..1439]
const CITA_ESTADOS = ['pedida', 'confirmada', 'atendida', 'no_show', 'anulada'];

// Recurso (silla, cabina, sala, box, equipo). tipo = lista cerrada; nombre obligatorio.
export const recursoSchema = z.object({
  nombre: str(100),
  tipo: z.enum(['silla', 'cabina', 'sala', 'box', 'equipo', 'otro']).default('otro'),
  notas: strOpt(500),
});

// Servicio RESERVABLE = capa sobre el producto-servicio existente (precio e IVA SIGUEN en el catálogo).
// muerto_* = ventana interior en la que la persona queda LIBRE; margen = limpieza posterior.
export const serviceConfigSchema = z.object({
  reservable: z.coerce.boolean().optional().default(true),
  duracion_min: z.coerce.number().int().min(1).max(1440),
  muerto_ini_min: z.coerce.number().int().min(0).max(1440).optional().default(0),
  muerto_dur_min: z.coerce.number().int().min(0).max(1440).optional().default(0),
  margen_min: z.coerce.number().int().min(0).max(1440).optional().default(0),
  provider_ids: z.array(intPos).optional().default([]),    // quién puede prestarlo (vacío = cualquiera)
  resource_ids: z.array(intPos).optional().default([]),    // qué recurso necesita (vacío = ninguno)
});

// Horario semanal de un ámbito (negocio o una persona): la UI manda la rejilla ENTERA; el servicio
// reemplaza los tramos de ese ámbito. Cada tramo es un intervalo abierto de un día (descansos = huecos).
const tramoSchema = z.object({ dow: z.coerce.number().int().min(0).max(6), inicio_min: minDia, fin_min: minDia });
export const horarioSchema = z.object({
  scope: z.enum(['negocio', 'user']),
  user_id: optId,
  tramos: z.array(tramoSchema).max(200).default([]),
});

// Excepción con fecha (vacaciones, festivo, cierre puntual, horario especial). La excepción manda.
export const excepcionSchema = z.object({
  scope: z.enum(['negocio', 'user']),
  user_id: optId,
  fecha: fechaISO,
  tipo: z.enum(['cerrado', 'horario']),
  inicio_min: z.union([z.null(), z.literal(''), minDia]).optional(),
  fin_min: z.union([z.null(), z.literal(''), minDia]).optional(),
  motivo: strOpt(200),
});

// La cita. Cliente de la ficha (cliente_id) o cliente suelto (nombre + móvil). service_ids = servicios
// encadenados, en orden. inicio_min = minuto del día. project_id opcional (cuelga de un proyecto).
export const citaSchema = z.object({
  cliente_id: optId,
  cliente_suelto_nombre: strOpt(200),
  cliente_suelto_movil: strOpt(30),
  user_id: z.coerce.number().int().positive(),
  recurso_id: optId,
  fecha: fechaISO,
  inicio_min: minDia,
  service_ids: z.array(intPos).max(20).optional().default([]),
  nota: strOpt(1000),
  project_id: optId,
  estado: z.enum(CITA_ESTADOS).optional(),
});

// Mover una cita (arrastrar en la agenda): revalida en servidor. Mantiene sus servicios.
export const citaMoverSchema = z.object({
  fecha: fechaISO,
  inicio_min: minDia,
  user_id: optId,
  recurso_id: optId,
});

export const citaEstadoSchema = z.object({ estado: z.enum(CITA_ESTADOS) });

// Al ATENDER: opciones de salida al dinero (reutiliza TPV o createInvoice) y de registro de tiempo.
export const citaAtenderSchema = z.object({
  cobrar: z.coerce.boolean().optional().default(false),
  via: z.enum(['ticket', 'factura']).optional().default('ticket'),
  payment_method: z.enum(['efectivo', 'tarjeta', 'transferencia']).optional().default('efectivo'),
  registrar_tiempo: z.coerce.boolean().optional().default(false),
});

// Bloquear un rato sin cita (comida, recado, mantenimiento). Persona y/o recurso.
export const bloqueoSchema = z.object({
  user_id: optId,
  recurso_id: optId,
  fecha: fechaISO,
  inicio_min: minDia,
  fin_min: minDia,
  motivo: strOpt(200),
});

// Marcar un aviso como enviado a mano (WhatsApp/SMS/email). Estado HONESTO: 'marcado', nunca 'entregado'.
export const avisoMarcarSchema = z.object({
  tipo: z.enum(['confirmacion', 'recordatorio']),
  canal: z.enum(['whatsapp', 'sms', 'email']),
});

// Ajustes de citas del negocio (viven en company_config).
export const citaAjustesSchema = z.object({
  cita_grid_min: z.coerce.number().int().min(5).max(120),
  cita_antelacion_min: z.coerce.number().int().min(0).max(525600),
  cita_ventana_dias: z.coerce.number().int().min(1).max(3650),
  cita_corte_mismo_dia_min: z.union([z.null(), z.literal(''), minDia]).optional(),
  cita_margen_defecto_min: z.coerce.number().int().min(0).max(600),
  cita_canal_defecto: z.enum(['whatsapp', 'sms', 'email']),
  cita_modo_recordatorio: z.enum(['manual', 'auto_email']),
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

// ── Presupuestos (quotes) — Pilar 4 · Pieza 1 ──────────────────
// Línea ESPEJO de la factura: catálogo (product_id) o línea libre; unit_price NETO.
const quoteLineSchema = z.object({
  description: str(500),
  quantity:    z.coerce.number().positive().max(1_000_000),
  unit_price:  z.coerce.number().nonnegative().max(1_000_000),
  tax_rate:    z.coerce.number().min(0).max(50).optional().default(0),
  product_id:  optId,   // línea de catálogo → el servidor re-resuelve el IVA desde la banda del producto
});
export const quoteCreateSchema = z.object({
  client_id:   intPos,
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  valid_until: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
  notes:       strOpt(2000),
  lines:       z.array(quoteLineSchema).min(1, 'Al menos una línea requerida'),
});
export const quoteComputeSchema = z.object({
  client_id: optId,
  lines:     z.array(quoteLineSchema).min(1, 'Al menos una línea requerida'),
});
export const quoteAnularSchema = z.object({
  motivo: z.string().trim().min(3, 'Indica el motivo de la anulación').max(500),
});
// Envío por email: destinatario EDITABLE (un único correo). El formato y el "vacío" los valida
// el servicio con mensajes claros (campo vacío → 400; formato inválido → 400).
export const quoteEmailSchema = z.object({
  to: z.string().trim().max(200).optional().default(''),
});
export const quoteConvertSchema = z.object({
  // destino del motor de conversión: 'invoice' (real) y 'order' (PIEZA 2a: pedido en borrador,
  // arrastra líneas). 'ticket' queda registrado pero su creador se construye con la pieza de TPV.
  dest: z.enum(['invoice', 'order', 'ticket']),
  confirm_excess: z.coerce.boolean().optional().default(false),
});
export const quoteFollowSchema = z.object({
  follow_status: z.enum(['aceptado', 'rechazado', 'caducado', '']).optional().default(''),
});

// ── Pedidos (customer_orders) — Pilar 4 · Pieza 2a ─────────────
// Línea ESPEJO del presupuesto/factura: catálogo (product_id) o línea libre; unit_price NETO.
const pedidoLineSchema = z.object({
  description: str(500),
  quantity:    z.coerce.number().positive().max(1_000_000),
  unit_price:  z.coerce.number().nonnegative().max(1_000_000),
  tax_rate:    z.coerce.number().min(0).max(50).optional().default(0),
  product_id:  optId,   // línea de catálogo → el servidor re-resuelve el IVA desde la banda del producto
});
export const pedidoCreateSchema = z.object({
  client_id:    intPos,
  warehouse_id: optWarehouse,            // almacén del que sale la reserva; principal por defecto
  date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expected_delivery_date: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),  // INFORMATIVA: no caduca, no libera
  notes:        strOpt(2000),
  lines:        z.array(pedidoLineSchema).min(1, 'Al menos una línea requerida'),
});
export const pedidoComputeSchema = z.object({
  client_id: optId,
  lines:     z.array(pedidoLineSchema).min(1, 'Al menos una línea requerida'),
});
export const pedidoAnularSchema = z.object({
  motivo: z.string().trim().min(3, 'Indica el motivo de la anulación').max(500),
});

// ── Albaranes / entregas (delivery_notes) — Pilar 4 · Pieza 2b ─────────────
// Línea de albarán: desde pedido (order_item_id) o suelta (product_id de catálogo / línea libre).
// quantity positiva (entrega parcial = a la baja sobre el pendiente). unit_price NETO.
const albaranLineSchema = z.object({
  order_item_id: optId,   // línea del pedido que entrega (NULL en albarán suelto)
  product_id:    optId,   // línea de catálogo → re-resuelve IVA por banda; NULL = línea libre (no mueve stock)
  description:   str(500),
  quantity:      z.coerce.number().positive().max(1_000_000),
  unit_price:    z.coerce.number().nonnegative().max(1_000_000),
  tax_rate:      z.coerce.number().min(0).max(50).optional().default(0),
});
export const albaranCreateSchema = z.object({
  order_id:     optId,                   // entrega DESDE un pedido confirmado; ausente = albarán suelto
  client_id:    optId,                   // obligatorio en el suelto (sin pedido); en el de pedido se toma del pedido
  warehouse_id: optWarehouse,            // almacén de SALIDA; principal por defecto / el del pedido
  date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes:        strOpt(2000),
  lines:        z.array(albaranLineSchema).min(1, 'Al menos una línea requerida'),
  confirm_over: z.coerce.boolean().optional().default(false),   // confirmar entregar por encima del disponible (aviso-confirmado)
});
export const albaranAnularSchema = z.object({
  motivo: z.string().trim().min(3, 'Indica el motivo de la anulación').max(500),
});

// ── Mostrador / ticket (factura simplificada F2) — Pilar 4 · PIEZA A ────────
// Línea: producto de catálogo (product_id → el servidor re-resuelve precio + IVA por banda) o
// línea libre (concepto + importe, IVA 21% fijo). SIN cliente, SIN IRPF (venta a consumidor).
const mostradorLineSchema = z.object({
  product_id:  optId,
  description: strOpt(500),
  quantity:    z.coerce.number().positive().max(1_000_000),
  unit_price:  z.coerce.number().nonnegative().max(1_000_000),
  tax_rate:    z.coerce.number().min(0).max(50).optional().default(21),   // solo aplica a línea libre; en catálogo lo fija el servidor por banda
});
export const mostradorSaleSchema = z.object({
  warehouse_id:   optWarehouse,                          // almacén de salida; principal por defecto
  payment_method: z.enum(['efectivo', 'tarjeta']),       // lista cerrada; cobro al momento
  lines:          z.array(mostradorLineSchema).min(1, 'Al menos una línea requerida'),
  confirm_excess: z.coerce.boolean().optional().default(false),   // espejo de la factura: vender un físico por encima del disponible exige confirmación explícita
});

// PIEZA B — emitir factura completa de canje (F3) que sustituye un ticket: solo el cliente
// destinatario (las líneas se arrastran del ticket; el resto lo fija el servidor).
export const sustitutivaSchema = z.object({
  client_id: intPos,
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

// ── CRM comercial ──────────────────────────────────────────────
// Las listas cerradas NO se escriben a mano aquí: se leen de crm.js (fuente única), igual que
// clientFieldOptions hace con clientSchema. Así el prompt de DISA, el formulario y el validador
// no pueden desincronizarse nunca. `z.enum` necesita una tupla no vacía → se castea el array.
const enumOf = (arr) => z.enum(arr);
const idReq = z.coerce.number().int().positive();

export const opportunitySchema = z.object({
  client_id:           idReq,
  title:               str(200),
  amount:              z.coerce.number().nonnegative().max(100_000_000).optional().default(0),
  stage:               enumOf(ETAPA_KEYS).optional().default('nuevo'),
  // Probabilidad: si no viene, la fija la etapa (crm.js). '' se trata como "no viene".
  probability:         z.union([z.literal(''), z.null(), z.coerce.number().int().min(0).max(100)]).optional(),
  expected_close_date: z.union([z.literal(''), z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
  source:              z.union([z.literal(''), enumOf(ORIGENES)]).optional().default(''),
  notes:               strOpt(2000),
});

// Mover de etapa: solo etapas ABIERTAS. Ganada/Perdida NO son etapas (ver docs/crm/embudo-referencia.md),
// van por closeOpportunitySchema — que es lo que impide "arrastrar a Perdido" sin dar motivo.
export const opportunityStageSchema = z.object({
  stage: enumOf(ETAPA_KEYS),
  note:  strOpt(500),
});

export const closeOpportunitySchema = z.object({
  status:      z.enum(['ganada', 'perdida']),
  lost_reason: z.union([z.literal(''), z.null(), enumOf(MOTIVOS_PERDIDA)]).optional(),
  note:        strOpt(1000),
}).refine(d => d.status !== 'perdida' || MOTIVOS_PERDIDA.includes(d.lost_reason), {
  message: 'Para dar una oportunidad por perdida hace falta el motivo', path: ['lost_reason'],
}).refine(d => !(d.status === 'perdida' && d.lost_reason === 'otro') || !!String(d.note || '').trim(), {
  message: 'Si el motivo es «Otro», cuéntame en una línea qué pasó', path: ['note'],
});

// Actividad de cliente (con o sin oportunidad, SIEMPRE sin factura). Espejo de collectionActionSchema.
// 'cambio_etapa' y 'cierre' NO se aceptan aquí: los escribe el motor al mover/cerrar, no un humano.
export const clientActivitySchema = z.object({
  opportunity_id:  z.union([z.literal(''), z.null(), z.coerce.number().int().positive()]).optional(),
  type:            z.enum(['contacto', 'nota', 'compromiso', 'email']),
  channel:         z.union([z.literal(''), z.null(), enumOf(CANALES)]).optional(),
  note:            strOpt(2000),
  commitment_date: z.union([z.literal(''), z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
  tono:            strOpt(30),
  email_subject:   z.string().trim().max(200).optional(),
  email_text:      z.string().max(8000).optional(),
}).refine(d => d.type !== 'contacto' || CANALES.includes(d.channel), {
  message: 'Un contacto necesita canal (teléfono, WhatsApp, reunión…)', path: ['channel'],
}).refine(d => d.type !== 'compromiso' || !!d.commitment_date, {
  message: 'Un compromiso necesita la fecha en la que quedasteis', path: ['commitment_date'],
});

// Espejo de clientFieldOptions: valores EXACTOS para que DISA no invente ninguno.
export const crmFieldOptions = { stage: ETAPA_KEYS, source: ORIGENES, lost_reason: MOTIVOS_PERDIDA, channel: CANALES };

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
  confirm_below_reserved: z.coerce.boolean().optional().default(false),   // PIEZA 2a: confirmar dejar el almacén por debajo de lo reservado
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
  // Peldaño 7 · PIEZA 2 — tarifa/hora de FACTURACIÓN (venta) de la persona (la fija el dueño/admin en Usuarios).
  tarifa_hora: priceOpt,
  // Peldaño 7 · PIEZA 4 (parte 2) — coste/hora (coste, ESPEJO de la tarifa; mismo permiso). Capa de gestión.
  coste_hora: priceOpt,
});

// ── Settings ───────────────────────────────────────────────────
// A2: companySchema deja de ser passthrough puro para validar tax_rate.
// El resto de campos siguen pasando libres (passthrough).
export const companySchema = z.object({
  tax_rate: z.coerce.number().min(0).max(50).optional(),
  irpf_default: z.coerce.number().min(0).max(100).optional(),
  // D5 — días tras el vencimiento para que DISA proponga recordatorio de impago (0..365).
  dias_recordatorio_impago: z.coerce.number().int().min(0).max(365).optional(),
  dias_aviso_pago: z.coerce.number().int().min(0).max(365).optional(),
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

export const forgotSchema = z.object({
  email: emailField,
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
  project_id:              z.union([z.coerce.number().int().positive(), z.literal(''), z.null()]).optional(),   // PIEZA 4 · etiqueta de proyecto (opcional)
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
// ── Trazabilidad por lote / nº de serie (Pilar 3) ──────────────────────────────
// ENTRADA: unidades que entran. LOTE → [{code, expiry?, quantity}]. SERIE → una por unidad [{code}, ...].
export const loteEntradaSchema = z.object({
  code:     str(80),
  expiry:   z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
  quantity: z.coerce.number().int().positive().optional(),
});
// SALIDA: de qué lote/serie (ya existente) sale la mercancía y cuánto.
export const asignacionLoteSchema = z.object({
  lot_id:   z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().positive(),
});

const purchaseOrderReceiptItemSchema = z.object({
  order_item_id: z.coerce.number().int().positive(),
  quantity:      z.coerce.number().int().positive(),
  unit_cost:     price,
  lotes:         z.array(loteEntradaSchema).max(500).optional(),   // traza: solo si el producto la lleva
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
  confirm_below_reserved: z.coerce.boolean().optional().default(false),   // PIEZA 2a: confirmar dejar el origen por debajo de lo reservado
});

export const draftOrderSchema = z.object({
  client_id:      optId,
  items:          z.array(posItemSchema).min(1),
  customer_notes: strOpt(1000),
  admin_notes:    strOpt(1000),
});
