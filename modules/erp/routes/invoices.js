import { Hono } from 'hono';
import { createHash } from 'crypto';
import { requirePerm, logActivity } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { invoiceCreateSchema, invoiceComputeSchema, invoiceAnularSchema, invoiceRectificativaSchema, invoicePaymentSchema, collectionActionSchema } from '../schemas.js';
import { getCountryConfig } from '../../../core/control-db.js';
import { adminLayout } from '../layout.js';
import { lineSearchCellHtml, lineSearchScript } from '../views/line-search.js';
import { cobroModalHtml, cobroModalScript } from '../views/cobro-modal.js';
import { paymentsSum, invoiceCobro, cobroState, isCobrable, ESTADO_LABEL,
  invoiceProximaAccion, invoiceActionHistory, registerCollectionAction, collectionEmail } from '../cobros.js';
import { sendEmail } from '../../../core/mailer.js';

// T4 Paso 1 — fecha de vencimiento de una factura = fecha de emisión + plazo de pago
// del cliente (días). Se guarda en la factura al emitir; cada factura conserva el suyo.
function computeDueDate(db, issueDate, clientId) {
  let term = 0;
  if (clientId) {
    const cl = db.prepare('SELECT payment_term_days FROM clients WHERE id=?').get(clientId);
    term = (cl && Number(cl.payment_term_days)) || 0;
  }
  if (!term) return issueDate;
  const d = new Date(issueDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + term);
  return d.toISOString().slice(0, 10);
}

// A2: helper puro de cálculo de totales (IVA múltiple por línea + IRPF global).
// Devuelve subtotal, agrupado por tasa, IVA total, base de IRPF, importe IRPF
// y total final. Todo redondeado a céntimo. Es la fuente de verdad de la
// matemática fiscal de Capa 1; createInvoice y el endpoint /compute-totals
// (preview en vivo) la usan.
export function computeTotals(lines, irpfRate = 0) {
  const r2 = n => Math.round(n * 100) / 100;
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('Se requiere al menos una línea');
  }

  let subtotal = 0;
  const taxByRate = {};                      // { '21': {base, amount}, '10': {...}, ... }

  for (const line of lines) {
    const qty   = Number(line.quantity) || 0;
    const price = Number(line.unit_price) || 0;
    const rate  = Number(line.tax_rate) || 0;
    const base  = r2(qty * price);
    const tax   = r2(base * rate / 100);

    subtotal += base;

    const key = String(rate);
    if (!taxByRate[key]) taxByRate[key] = { rate, base: 0, amount: 0 };
    taxByRate[key].base   += base;
    taxByRate[key].amount += tax;
  }

  // Redondeos finales por grupo para evitar arrastre.
  for (const k of Object.keys(taxByRate)) {
    taxByRate[k].base   = r2(taxByRate[k].base);
    taxByRate[k].amount = r2(taxByRate[k].amount);
  }
  subtotal = r2(subtotal);

  const taxAmount  = r2(Object.values(taxByRate).reduce((s, t) => s + t.amount, 0));
  const irpfBase   = subtotal;
  const irpfAmount = r2(irpfBase * (Number(irpfRate) || 0) / 100);
  const total      = r2(subtotal + taxAmount - irpfAmount);

  return { subtotal, taxByRate, taxAmount, irpfBase, irpfAmount, total };
}

// A2: determina la "tasa principal" para invoices.tax_rate.
// - Si todas las líneas comparten la misma tasa → esa tasa.
// - Si hay mezcla → 0 (semáforo "ver desglose en invoice_items").
function mainTaxRate(taxByRate) {
  const keys = Object.keys(taxByRate);
  if (keys.length === 1) return taxByRate[keys[0]].rate;
  return 0;
}

function getNextSeq(db, series, year) {
  db.prepare(`INSERT INTO invoice_sequences (series,year,last_seq) VALUES (?,?,0) ON CONFLICT(series,year) DO NOTHING`).run(series, year);
  db.prepare(`UPDATE invoice_sequences SET last_seq=last_seq+1 WHERE series=? AND year=?`).run(series, year);
  return db.prepare(`SELECT last_seq FROM invoice_sequences WHERE series=? AND year=?`).get(series, year).last_seq;
}

function getPrevHash(db, series, year) {
  const prev = db.prepare(`SELECT verifactu_hash FROM invoices WHERE series=? AND year=? ORDER BY sequence DESC LIMIT 1`).get(series, year);
  return prev?.verifactu_hash || '';
}

function calcHash(inv) {
  const data = [inv.invoice_number, inv.issue_date, inv.company_fiscal_id, inv.client_fiscal_id || '', inv.total.toFixed(2), inv.prev_hash].join('|');
  return createHash('sha256').update(data).digest('hex');
}

export function generateInvoice(db, orderId) {
  // prevent duplicate
  const existing = db.prepare('SELECT id, invoice_number FROM invoices WHERE order_id=?').get(orderId);
  if (existing) return { id: existing.id, invoice_number: existing.invoice_number, already: true };

  const order = db.prepare('SELECT * FROM sales_orders WHERE id=?').get(orderId);
  if (!order) throw new Error('Pedido no encontrado');
  if (order.status !== 'completado') throw new Error('Solo se pueden facturar pedidos completados');

  const cfg = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
  const client = order.client_id ? db.prepare('SELECT * FROM clients WHERE id=?').get(order.client_id) : null;
  const items = db.prepare('SELECT * FROM sales_items WHERE order_id=?').all(orderId);

  const series = cfg.invoice_series || 'F';
  const year = new Date().getFullYear();
  const seq = getNextSeq(db, series, year);
  const invoice_number = `${series}${year}-${String(seq).padStart(4, '0')}`;
  const issue_date = new Date().toISOString().slice(0, 10);

  const subtotal = parseFloat((order.total / (1 + (cfg.tax_rate || 21) / 100)).toFixed(2));
  const tax_amount = parseFloat((order.total - subtotal).toFixed(2));
  const prev_hash = getPrevHash(db, series, year);

  const inv = {
    invoice_number,
    order_id: orderId,
    client_id: order.client_id || null,
    series,
    year,
    sequence: seq,
    issue_date,
    company_name: cfg.name || 'Mi empresa',
    company_fiscal_id: cfg.fiscal_id || '',
    company_address: cfg.address || '',
    client_name: client ? client.name : (order.client_name || ''),
    client_fiscal_id: client ? (client.fiscal_id || '') : '',
    client_address: client ? (client.address || '') : '',
    client_email: client ? (client.email || '') : '',
    subtotal,
    tax_rate: cfg.tax_rate || 21,
    tax_name: cfg.tax_name || 'IVA',
    tax_amount,
    total: order.total,
    currency: cfg.currency || 'EUR',
    currency_symbol: cfg.currency_symbol || '€',
    document_name: cfg.document_name || 'Factura',
    prev_hash,
  };
  inv.verifactu_hash = calcHash(inv);

  const due_date = computeDueDate(db, issue_date, order.client_id || null);
  const result = db.prepare(`INSERT INTO invoices
    (invoice_number,order_id,client_id,series,year,sequence,issue_date,
     company_name,company_fiscal_id,company_address,
     client_name,client_fiscal_id,client_address,client_email,
     subtotal,tax_rate,tax_name,tax_amount,total,
     currency,currency_symbol,document_name,
     verifactu_hash,prev_hash,due_date)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    inv.invoice_number, inv.order_id, inv.client_id, inv.series, inv.year, inv.sequence, inv.issue_date,
    inv.company_name, inv.company_fiscal_id, inv.company_address,
    inv.client_name, inv.client_fiscal_id, inv.client_address, inv.client_email,
    inv.subtotal, inv.tax_rate, inv.tax_name, inv.tax_amount, inv.total,
    inv.currency, inv.currency_symbol, inv.document_name,
    inv.verifactu_hash, inv.prev_hash, due_date
  );
  const invoiceId = result.lastInsertRowid;

  const insItem = db.prepare('INSERT INTO invoice_items (invoice_id,description,quantity,unit_price,total_price) VALUES (?,?,?,?,?)');
  for (const it of items) {
    insItem.run(invoiceId, it.product_name, it.quantity, it.unit_price, it.total);
  }

  return { id: invoiceId, invoice_number };
}

// A1+A2: crear factura directa (sin pedido). Cada línea lleva su propia tasa
// de IVA; el IRPF es global y solo aplica si country='ES'. Asigna correlativo
// y hash encadenado igual que generateInvoice, pero sin tocar sales_orders.
// order_id queda NULL.
export function createInvoice(db, invoiceData) {
  const { client_id, lines, issue_date, notes = '', irpf_rate = 0 } = invoiceData;

  const client = db.prepare('SELECT id, name, fiscal_id, address, email FROM clients WHERE id=?').get(client_id);
  if (!client) throw new Error('Cliente no existe');

  const cfg = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
  const country = (cfg.country || 'ES').toUpperCase();
  // IRPF solo aplica a tenants ES por ahora. Otros países lo ignoran silenciosamente.
  const appliedIrpfRate = country === 'ES' ? (Number(irpf_rate) || 0) : 0;

  const totals = computeTotals(lines, appliedIrpfRate);
  const headerTaxRate = mainTaxRate(totals.taxByRate);  // 0 si hay mezcla, tasa única si todas iguales

  const series    = cfg.invoice_series || 'F';
  const year      = new Date().getFullYear();
  const issueDate = issue_date || new Date().toISOString().slice(0, 10);

  const create = db.transaction(() => {
    const seq = getNextSeq(db, series, year);
    const invoice_number = `${series}${year}-${String(seq).padStart(4, '0')}`;
    const prev_hash = getPrevHash(db, series, year);
    const verifactu_hash = calcHash({
      invoice_number,
      issue_date: issueDate,
      company_fiscal_id: cfg.fiscal_id || '',
      client_fiscal_id: client.fiscal_id || '',
      total: totals.total,
      prev_hash,
    });

    const due_date = computeDueDate(db, issueDate, client_id);
    const result = db.prepare(`INSERT INTO invoices
      (invoice_number, order_id, client_id, series, year, sequence, issue_date,
       company_name, company_fiscal_id, company_address,
       client_name, client_fiscal_id, client_address, client_email,
       subtotal, tax_rate, tax_name, tax_amount, total,
       currency, currency_symbol, document_name,
       verifactu_hash, prev_hash, notes,
       irpf_rate, irpf_amount, due_date)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      invoice_number, null, client_id,
      series, year, seq, issueDate,
      cfg.company_name || 'Mi empresa', cfg.fiscal_id || '', cfg.address || '',
      client.name, client.fiscal_id || '', client.address || '', client.email || '',
      totals.subtotal, headerTaxRate, cfg.tax_name || 'IVA', totals.taxAmount, totals.total,
      cfg.currency || 'EUR', cfg.currency_symbol || '€', cfg.document_name || 'Factura',
      verifactu_hash, prev_hash, notes,
      appliedIrpfRate, totals.irpfAmount, due_date
    );
    const invoiceId = result.lastInsertRowid;

    const insItem = db.prepare('INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total_price, tax_rate, tax_amount) VALUES (?,?,?,?,?,?,?)');
    for (const line of lines) {
      const qty   = Number(line.quantity);
      const price = Number(line.unit_price);
      const rate  = Number(line.tax_rate) || 0;
      const base  = Math.round(qty * price * 100) / 100;
      const tax   = Math.round(base * rate / 100 * 100) / 100;
      insItem.run(invoiceId, line.description, qty, price, base, rate, tax);
    }
    return { id: invoiceId, invoice_number };
  });

  return create();
}

// ── Ciclo de vida: ANULAR ────────────────────────────────────────────────────
// Hash del registro de anulación. Familia del calcHash de facturas pero con un
// prefijo 'ANULACION' (no colisiona con un hash de factura) y enlazado al hash de
// la factura original (prev_hash = original.verifactu_hash).
function calcAnulacionHash(an) {
  const data = ['ANULACION', an.invoice_number, an.issue_date, an.company_fiscal_id, an.motivo, an.prev_hash].join('|');
  return createHash('sha256').update(data).digest('hex');
}

// Anula una factura: crea un asiento de anulación NUEVO (tabla invoice_anulaciones)
// hash-enlazado al hash de la original, y marca la original como 'anulada'. La fila
// original NO se edita (salvo el campo status, que está fuera del hash) ni se borra.
export function anularInvoice(db, invoiceId, motivo) {
  const motivoClean = String(motivo || '').trim();
  if (!motivoClean) throw new Error('Se requiere un motivo de anulación');

  const original = db.prepare('SELECT * FROM invoices WHERE id=?').get(invoiceId);
  if (!original) throw new Error('Factura no encontrada');
  if (original.status !== 'emitida') throw new Error('Solo se puede anular una factura emitida');

  const cfg = db.prepare('SELECT fiscal_id FROM company_config WHERE id=1').get() || {};
  const issue_date = new Date().toISOString().slice(0, 10);
  const company_fiscal_id = original.company_fiscal_id || cfg.fiscal_id || '';

  const run = db.transaction(() => {
    const prev_hash = original.verifactu_hash || '';
    const verifactu_hash = calcAnulacionHash({
      invoice_number: original.invoice_number,
      issue_date,
      company_fiscal_id,
      motivo: motivoClean,
      prev_hash,
    });
    const res = db.prepare(`INSERT INTO invoice_anulaciones
      (invoice_id, invoice_number, motivo, issue_date, company_fiscal_id, prev_hash, verifactu_hash)
      VALUES (?,?,?,?,?,?,?)`
    ).run(original.id, original.invoice_number, motivoClean, issue_date, company_fiscal_id, prev_hash, verifactu_hash);

    db.prepare("UPDATE invoices SET status='anulada' WHERE id=?").run(original.id);
    return { id: res.lastInsertRowid, invoice_id: original.id, invoice_number: original.invoice_number };
  });
  return run();
}

// ── Ciclo de vida: RECTIFICAR ────────────────────────────────────────────────
// Crea una FACTURA rectificativa: documento nuevo con numeración propia (serie 'R'),
// su propia cadena de hash, que referencia a la original (rectifies_invoice_id) y
// registra tipo R1–R5 y modalidad S/I. Marca la original como 'rectificada'. Admite
// importes NEGATIVOS (abono). La original no se edita (salvo status) ni se borra.
export function createRectificativa(db, data) {
  const { original_id, lines, rectification_type, rectification_mode,
          irpf_rate = 0, notes = '', issue_date } = data;

  if (!['R1', 'R2', 'R3', 'R4', 'R5'].includes(rectification_type)) throw new Error('Tipo de rectificativa inválido (R1–R5)');
  if (!['S', 'I'].includes(rectification_mode)) throw new Error('Modalidad inválida (S o I)');

  const original = db.prepare('SELECT * FROM invoices WHERE id=?').get(original_id);
  if (!original) throw new Error('Factura original no encontrada');
  if (original.status !== 'emitida') throw new Error('Solo se puede rectificar una factura emitida');

  const cfg = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
  const country = (cfg.country || 'ES').toUpperCase();
  const appliedIrpfRate = country === 'ES' ? (Number(irpf_rate) || 0) : 0;

  // computeTotals es sign-agnostic → soporta líneas negativas (abono).
  const totals = computeTotals(lines, appliedIrpfRate);
  const headerTaxRate = mainTaxRate(totals.taxByRate);

  const series    = cfg.rectificative_series || 'R';
  const year      = new Date().getFullYear();
  const issueDate = issue_date || new Date().toISOString().slice(0, 10);

  const run = db.transaction(() => {
    const seq = getNextSeq(db, series, year);
    const invoice_number = `${series}${year}-${String(seq).padStart(4, '0')}`;
    const prev_hash = getPrevHash(db, series, year);
    const verifactu_hash = calcHash({
      invoice_number,
      issue_date: issueDate,
      company_fiscal_id: original.company_fiscal_id || cfg.fiscal_id || '',
      client_fiscal_id: original.client_fiscal_id || '',
      total: totals.total,
      prev_hash,
    });

    const due_date = computeDueDate(db, issueDate, original.client_id || null);
    const result = db.prepare(`INSERT INTO invoices
      (invoice_number, order_id, client_id, series, year, sequence, issue_date,
       company_name, company_fiscal_id, company_address,
       client_name, client_fiscal_id, client_address, client_email,
       subtotal, tax_rate, tax_name, tax_amount, total,
       currency, currency_symbol, document_name,
       verifactu_hash, prev_hash, notes, irpf_rate, irpf_amount,
       record_type, rectifies_invoice_id, rectification_type, rectification_mode, status, due_date)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      invoice_number, null, original.client_id || null, series, year, seq, issueDate,
      original.company_name, original.company_fiscal_id, original.company_address,
      original.client_name, original.client_fiscal_id, original.client_address, original.client_email,
      totals.subtotal, headerTaxRate, original.tax_name || cfg.tax_name || 'IVA', totals.taxAmount, totals.total,
      original.currency || 'EUR', original.currency_symbol || '€', original.document_name || 'Factura',
      verifactu_hash, prev_hash, notes, appliedIrpfRate, totals.irpfAmount,
      'rectificativa', original.id, rectification_type, rectification_mode, 'emitida', due_date
    );
    const invoiceId = result.lastInsertRowid;

    const insItem = db.prepare('INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total_price, tax_rate, tax_amount) VALUES (?,?,?,?,?,?,?)');
    for (const line of lines) {
      const qty   = Number(line.quantity);
      const price = Number(line.unit_price);
      const rate  = Number(line.tax_rate) || 0;
      const base  = Math.round(qty * price * 100) / 100;
      const tax   = Math.round(base * rate / 100 * 100) / 100;
      insItem.run(invoiceId, line.description, qty, price, base, rate, tax);
    }

    db.prepare("UPDATE invoices SET status='rectificada' WHERE id=?").run(original.id);
    return { id: invoiceId, invoice_number, rectifies: original.invoice_number };
  });
  return run();
}

export function createInvoiceRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  // GET /api/erp/invoices — list (+ estado de cobro en vivo por factura)
  api.get('/', requirePerm('orders.read'), c => {
    try {
      // Bug fix: la columna real en sales_orders es order_number, no reference.
      // Antes de A1 nunca había facturas en BD así que el error 500 no se notaba.
      // cobrado se suma con subconsulta (una sola query) y el estado se deriva en vivo.
      const rows = db.prepare(`SELECT i.*, o.order_number as order_ref,
          (SELECT COALESCE(SUM(p.amount),0) FROM invoice_payments p WHERE p.invoice_id=i.id) AS cobrado
        FROM invoices i LEFT JOIN sales_orders o ON o.id=i.order_id ORDER BY i.created_at DESC LIMIT 200`).all();
      const today = new Date().toISOString().slice(0, 10);
      for (const r of rows) {
        const st = cobroState(r, r.cobrado, today);
        r.cobrado = st.cobrado; r.pendiente = st.pendiente;
        r.cobro_estado = st.estado; r.cobro_estado_label = ESTADO_LABEL[st.estado] || st.estado;
        r.dias_vencida = st.dias_vencida;
        r.cobrable = isCobrable(db, r);   // gate del botón/modal de cobro en el listado
        r.proxima = invoiceProximaAccion(db, r, today);   // Paso 2: misma próxima acción que las otras superficies
      }
      return c.json(rows);
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  // GET /api/erp/invoices/:id — single invoice JSON (+ enlaces de ciclo de vida)
  api.get('/:id', requirePerm('orders.read'), c => {
    try {
      const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(c.req.param('id'));
      if (!inv) return c.json({ error: 'No encontrada' }, 404);
      const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY id').all(inv.id);
      // Enlaces: registro de anulación (si anulada), la rectificativa que la rectifica
      // (si rectificada) y la factura original (si esta es una rectificativa).
      const anulacion = db.prepare('SELECT * FROM invoice_anulaciones WHERE invoice_id=? ORDER BY id DESC LIMIT 1').get(inv.id) || null;
      const rectifiedBy = db.prepare('SELECT id, invoice_number FROM invoices WHERE rectifies_invoice_id=? ORDER BY id DESC LIMIT 1').get(inv.id) || null;
      const rectifiesOriginal = inv.rectifies_invoice_id
        ? (db.prepare('SELECT id, invoice_number FROM invoices WHERE id=?').get(inv.rectifies_invoice_id) || null)
        : null;
      // Cobros registrados + estado de cobro en vivo + si admite cobro.
      const payments = db.prepare('SELECT * FROM invoice_payments WHERE invoice_id=? ORDER BY paid_date, id').all(inv.id);
      const today = new Date().toISOString().slice(0, 10);
      const cobro = invoiceCobro(db, inv, today);
      const cobrable = isCobrable(db, inv);
      // Paso 2: próxima acción de cobro + historial de acciones (compartido por las 3 superficies).
      const proxima = invoiceProximaAccion(db, inv, today);
      const collectionActions = invoiceActionHistory(db, inv.id);
      return c.json({ ...inv, items, anulacion, rectifiedBy, rectifiesOriginal, payments, cobro, cobrable, proxima, collectionActions });
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  // POST /api/erp/invoices/from-order/:orderId — generate invoice from order
  api.post('/from-order/:orderId', requirePerm('orders.edit'), c => {
    try {
      const orderId = parseInt(c.req.param('orderId'));
      const res = generateInvoice(db, orderId);
      return c.json(res);
    } catch (e) {
      let code = 500;
      if (e.message === 'Pedido no encontrado') code = 404;
      else if (e.message === 'Solo se pueden facturar pedidos completados') code = 400;
      return c.json({ error: e.message }, code);
    }
  });

  // A2: POST /api/erp/invoices/compute-totals — preview en vivo desde la UI
  // Debe ir ANTES de POST '/' para que Hono no lo capture como crear factura.
  api.post('/compute-totals', requirePerm('invoices.create'), validate(invoiceComputeSchema), c => {
    try {
      const { lines, irpf_rate } = c.get('validated');
      const cfg = db.prepare('SELECT country FROM company_config WHERE id=1').get() || {};
      const country = (cfg.country || 'ES').toUpperCase();
      const appliedIrpfRate = country === 'ES' ? (Number(irpf_rate) || 0) : 0;
      return c.json(computeTotals(lines, appliedIrpfRate));
    } catch (e) {
      return c.json({ error: e.message }, 400);
    }
  });

  // A1: POST /api/erp/invoices — crear factura directa (sin pedido)
  api.post('/', requirePerm('invoices.create'), validate(invoiceCreateSchema), c => {
    try {
      const data = c.get('validated');
      const result = createInvoice(db, data);
      logActivity(db, c.get('session'), 'Creó factura', 'invoice', result.id, result.invoice_number);
      return c.json(result, 201);
    } catch (e) {
      let code = 400;
      if (e.message === 'Cliente no existe') code = 404;
      return c.json({ error: e.message }, code);
    }
  });

  // POST /api/erp/invoices/:id/anular — anula una factura (asiento nuevo; original intacta)
  api.post('/:id/anular', requirePerm('invoices.create'), validate(invoiceAnularSchema), c => {
    try {
      const { motivo } = c.get('validated');
      const res = anularInvoice(db, parseInt(c.req.param('id')), motivo);
      logActivity(db, c.get('session'), 'Anuló factura', 'invoice', res.invoice_id, `${res.invoice_number} — ${motivo}`);
      return c.json(res);
    } catch (e) {
      const code = e.message === 'Factura no encontrada' ? 404 : 400;
      return c.json({ error: e.message }, code);
    }
  });

  // POST /api/erp/invoices/:id/rectificativa — crea factura rectificativa (serie R)
  api.post('/:id/rectificativa', requirePerm('invoices.create'), validate(invoiceRectificativaSchema), c => {
    try {
      const data = c.get('validated');
      const res = createRectificativa(db, { ...data, original_id: parseInt(c.req.param('id')) });
      logActivity(db, c.get('session'), 'Creó rectificativa', 'invoice', res.id, `${res.invoice_number} (rectifica ${res.rectifies})`);
      return c.json(res, 201);
    } catch (e) {
      const code = e.message === 'Factura original no encontrada' ? 404 : 400;
      return c.json({ error: e.message }, code);
    }
  });

  // POST /api/erp/invoices/:id/payments — registrar un cobro (total o parcial)
  api.post('/:id/payments', requirePerm('invoices.create'), validate(invoicePaymentSchema), c => {
    try {
      const id = parseInt(c.req.param('id'));
      const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(id);
      if (!inv) return c.json({ error: 'Factura no encontrada' }, 404);
      // Protección real (no solo ocultar el botón): solo facturas vivas admiten cobro.
      // No cobrable = anulada, abono (total<0) o sustituida por una rectificativa (S).
      if (!isCobrable(db, inv)) return c.json({ error: 'Esta factura no admite cobro (anulada, abono o sustituida por una rectificativa)' }, 400);
      const { amount, paid_date, payment_method, note } = c.get('validated');
      const today = new Date().toISOString().slice(0, 10);
      const res = db.prepare('INSERT INTO invoice_payments (invoice_id, amount, paid_date, payment_method, note) VALUES (?,?,?,?,?)')
        .run(id, amount, paid_date || today, payment_method || '', note || '');
      logActivity(db, c.get('session'), 'Registró cobro', 'invoice', id, `${inv.invoice_number} · ${amount}`);
      return c.json({ id: res.lastInsertRowid, cobro: invoiceCobro(db, inv, today) }, 201);
    } catch (e) { return c.json({ error: e.message }, 400); }
  });

  // GET /api/erp/invoices/:id/collection-email-preview — plantilla precargada (editable
  // en el modal) según el tono de la próxima acción. Solo construye, no envía.
  api.get('/:id/collection-email-preview', requirePerm('orders.read'), c => {
    try {
      const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(c.req.param('id'));
      if (!inv) return c.json({ error: 'Factura no encontrada' }, 404);
      const today = new Date().toISOString().slice(0, 10);
      const cobro = invoiceCobro(db, inv, today);
      const prox = invoiceProximaAccion(db, inv, today);
      const client = inv.client_id ? db.prepare('SELECT * FROM clients WHERE id=?').get(inv.client_id) : null;
      const company = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
      const tono = (prox && prox.tono) || 'amable';
      const tpl = collectionEmail(tono, { inv, client, cobro, company });
      return c.json({ subject: tpl.subject, text: tpl.text, tono, to: client && client.email || '', has_email: !!(client && client.email) });
    } catch (e) { return c.json({ error: e.message }, 400); }
  });

  // POST /api/erp/invoices/:id/collection-actions — registrar una acción de cobro.
  // ÚNICA vía de escritura (la usan las 3 superficies y DISA): el servicio reutiliza el
  // doble seguro de Paso 1 (rechaza 400 sobre factura no viva) y, en recordatorio_email,
  // envía por Resend antes de registrar. Nada se envía solo: el front confirma primero.
  api.post('/:id/collection-actions', requirePerm('invoices.create'), validate(collectionActionSchema), async c => {
    try {
      const input = c.get('validated');
      const res = await registerCollectionAction(db, parseInt(c.req.param('id')), input, { sendEmail });
      const label = input.type === 'recordatorio_email' ? 'Envió recordatorio'
        : input.type === 'promesa_pago' ? 'Registró promesa de pago' : 'Registró contacto';
      logActivity(db, c.get('session'), label, 'invoice', res.id, `${res.invoice_number} · ${res.stage}`);
      return c.json(res, 201);
    } catch (e) { return c.json({ error: e.message }, e.status || 400); }
  });

  // GET /admin/invoices — list view
  views.get('/', requirePerm('orders.read'), c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const content = `
      <div class="ph">
        <h2>Facturas</h2>
        <a href="/admin/invoices/new" class="btn btn-primary">Nueva factura</a>
      </div>
      <div class="card">
        <div class="card-head"><h3>Todas las facturas</h3><input class="search" id="searchBox" placeholder="Buscar..." oninput="filterTable()"></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Número</th><th>Pedido</th><th>Cliente</th><th>Fecha</th><th>Total</th><th>Pendiente</th><th>Cobro</th><th>Estado</th><th></th></tr></thead>
          <tbody id="invBody"></tbody>
        </table></div>
      </div>

      <!-- Gestión de cobro (solo en el panel, nunca en el documento/PDF de la factura). -->
      ${cobroModalHtml()}
      <script>
      ${cobroModalScript(sym)}
      window.cobroOnSaved = function(id){ loadInvoices(); };   // refresca la tabla tras un cobro
      let rows=[];
      async function loadInvoices(){
        rows=await api('GET','/api/erp/invoices').catch(()=>[]);
        filterTable();
      }
      function filterTable(){
        const q=document.getElementById('searchBox').value.toLowerCase();
        const f=q?rows.filter(r=>r.invoice_number.toLowerCase().includes(q)||(r.client_name||'').toLowerCase().includes(q)):rows;
        const stBadge={emitida:'b-green',rectificada:'b-yellow',anulada:'b-red'};
        const cobroBadge={pendiente:'b-yellow',parcial:'b-blue',cobrada:'b-green',vencida:'b-red',abono:'b-gray'};
        document.getElementById('invBody').innerHTML=f.length?f.map(r=>{
          // Facturas sin pedido (A1/A2 directas): order_id = NULL → mostrar "—" sin enlace roto.
          const pedidoCell = r.order_id
            ? '<a href="/admin/orders/'+r.order_id+'">'+(r.order_ref||r.order_id)+'</a>'
            : '<span style="color:var(--muted)">—</span>';
          // Acciones de ciclo de vida: solo una factura "emitida" se puede anular o rectificar.
          let acts = '<a href="/admin/invoices/'+r.id+'" target="_blank" class="btn btn-secondary btn-sm">Ver</a>';
          // Cobro: solo facturas vivas (no anulada, no abono, no sustituida) — gestión en el panel.
          // Paso 2: "Gestionar" abre el centro compartido (cobro + próxima acción + acciones).
          if (r.cobrable) {
            acts += ' <button class="btn btn-secondary btn-sm" onclick="openGestion('+r.id+')">Gestionar</button>';
          }
          if (r.status === 'emitida') {
            acts += ' <button class="btn btn-secondary btn-sm" onclick="anular('+r.id+',\\''+(r.invoice_number||'')+'\\')">Anular</button>'
                  + ' <a href="/admin/invoices/'+r.id+'/rectificativa/new" class="btn btn-secondary btn-sm">Rectificar</a>';
          }
          // Cobro: para anuladas no aplica (no son deuda); para el resto, pendiente + badge en vivo.
          // Paso 2: bajo el estado, la PRÓXIMA acción de cobro (misma que en Cobros y ficha).
          const proxLine = (r.proxima)
            ? '<div style="font-size:.78rem;color:var(--muted);margin-top:.15rem">'+(window.proximaBadgeHtml?window.proximaBadgeHtml(r.proxima):'')+' '+(r.proxima.accion==='recordatorio_email'?'recordatorio':((window.STAGE_LABEL&&window.STAGE_LABEL[r.proxima.etapa])||r.proxima.etapa))+'</div>'
            : '';
          const cobroCell = (r.status==='anulada')
            ? '<span style="color:var(--muted)">—</span>'
            : '<span class="badge '+(cobroBadge[r.cobro_estado]||'')+'">'+(r.cobro_estado_label||'')+(r.cobro_estado==='vencida'&&r.dias_vencida?' '+r.dias_vencida+'d':'')+'</span>'+proxLine;
          const pendienteCell = (r.status==='anulada')
            ? '<span style="color:var(--muted)">—</span>'
            : '${sym}'+Number(r.pendiente||0).toFixed(2);
          return \`<tr>
          <td><strong>\${r.invoice_number}</strong></td>
          <td>\${pedidoCell}</td>
          <td>\${r.client_name||'-'}</td>
          <td style="color:var(--muted);font-size:.85rem">\${r.issue_date||'-'}</td>
          <td><strong>${sym}\${r.total?.toFixed(2)||'0.00'}</strong></td>
          <td>\${pendienteCell}</td>
          <td>\${cobroCell}</td>
          <td><span class="badge \${stBadge[r.status]||''}"\>\${r.status}</span></td>
          <td style="white-space:nowrap">\${acts}</td>
        </tr>\`}).join(''):'<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--muted)">Sin facturas</td></tr>';
      }
      async function anular(id, num){
        const motivo = prompt('Motivo de anulación de la factura '+num+':');
        if (motivo === null) return;                 // cancelado
        if (!motivo.trim()){ toast('El motivo es obligatorio','err'); return; }
        try {
          await api('POST','/api/erp/invoices/'+id+'/anular',{ motivo: motivo.trim() });
          toast('Factura '+num+' anulada');
          loadInvoices();
        } catch(e){ toast(e.message||'Error anulando','err'); }
      }

      loadInvoices();
      </script>`;
    return c.html(adminLayout('Facturas', content, 'invoices', c.get('session')?.csrfToken || '', c));
  });

  // A1+A2: GET /admin/invoices/new — formulario para crear factura sin pedido
  views.get('/new', requirePerm('invoices.create'), c => {
    const cfg = db.prepare('SELECT currency_symbol, country, tax_rate, tax_name, irpf_default FROM company_config WHERE id=1').get() || {};
    const irpfDefault = Number(cfg.irpf_default) || 0;   // retención del negocio; precarga la factura según el cliente
    const sym = cfg.currency_symbol || '€';
    const country = (cfg.country || 'ES').toUpperCase();
    const cc = getCountryConfig(country) || { tax_rates: '21,10,4', tax_default: 21 };
    // tax_rates en country_configs es un CSV → array de numbers ordenado desc.
    const rates = cc.tax_rates.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    const defaultRate = Number(cc.tax_default) || rates[0] || 0;
    const today = new Date().toISOString().slice(0, 10);
    const showIrpf = country === 'ES';

    const ratesJson = JSON.stringify(rates);

    const content = `
      <div class="ph">
        <h2>Nueva factura</h2>
        <a href="/admin/invoices" class="btn btn-secondary">Cancelar</a>
      </div>

      <div class="card" style="max-width:900px">
        <div class="card-body">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Cliente *</label>
              <select id="f-client" class="form-control">
                <option value="">— Selecciona cliente —</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Fecha emisión</label>
              <input type="date" id="f-date" class="form-control" value="${today}">
            </div>
          </div>

          <hr style="margin:1.25rem 0;border:none;border-top:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
            <h3 style="font-size:.9rem;font-weight:600;margin:0">Líneas</h3>
            <button class="btn btn-secondary btn-sm" onclick="addLine()">+ Añadir línea</button>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Descripción</th>
                  <th style="width:80px">Cant.</th>
                  <th style="width:120px">P. unit.</th>
                  <th style="width:100px;text-align:right">Subtotal</th>
                  <th style="width:36px"></th>
                </tr>
              </thead>
              <tbody id="lines-body"></tbody>
              <!-- El pie lo pinta doRecalc en vivo: Base + IVA por tasa + IRPF (si >0) + Total. -->
              <tfoot id="totals-foot"></tfoot>
            </table>
          </div>

          <div class="form-group" style="margin-top:1.25rem">
            <label class="form-label">Notas (opcional)</label>
            <textarea id="f-notes" class="form-control" rows="2"></textarea>
          </div>

          <div style="text-align:right;margin-top:1rem">
            <button class="btn btn-primary" id="btn-emit" onclick="emitInvoice()">Emitir factura</button>
          </div>
        </div>
      </div>

      <script>
      const SYM = '${sym}';
      const RATES = ${ratesJson};            // [21, 10, 4, ...]
      const DEFAULT_RATE = ${defaultRate};
      const SHOW_IRPF = ${showIrpf};
      const IRPF_DEFAULT = ${irpfDefault};   // retención del negocio (precarga; empresa la aplica, particular no)
      const LINE_CELL = ${JSON.stringify(lineSearchCellHtml())};  // celda buscador (componente compartido)
      let clients = [];
      let catalog = [];                        // catálogo completo activo para el buscador de línea
      let recalcTimer = null;

      async function loadAll(){
        try {
          const [cl, prods] = await Promise.all([
            api('GET','/api/erp/clients').catch(()=>[]),
            api('GET','/api/erp/products').catch(()=>[]),
          ]);
          clients = cl;
          // Catálogo completo activo (físico/digital/servicio): el buscador de línea ofrece todos.
          catalog = (prods || []).filter(p => p.status === 'active');
          const sel = document.getElementById('f-client');
          for (const cl of clients) {
            const o = document.createElement('option');
            o.value = cl.id; o.textContent = cl.name + (cl.fiscal_id ? ' — ' + cl.fiscal_id : '');
            sel.appendChild(o);
          }
        } catch(e){ toast(e.message||'Error cargando datos','err'); }
        addLine();
        // Al cambiar de cliente recalcula: el IRPF del pie depende de su tipo (empresa/particular).
        document.getElementById('f-client').addEventListener('change', scheduleRecalc);
      }

      // IRPF de la factura: NO se elige aquí. Es la retención del negocio (IRPF_DEFAULT) y
      // solo se aplica si el cliente es empresa/profesional; particular → 0. Si el autónomo
      // necesita otro %, lo cambia en su configuración de empresa, no en la factura.
      function currentIrpfRate(){
        if (!SHOW_IRPF) return 0;
        const id = parseInt(document.getElementById('f-client').value);
        const cl = clients.find(x => x.id === id);
        return (cl && cl.client_type === 'empresa') ? IRPF_DEFAULT : 0;
      }

      function addLine(){
        const tbody = document.getElementById('lines-body');
        const row = document.createElement('tr');
        // Línea única: un solo campo de descripción que ES el buscador de catálogo
        // (componente compartido con el pedido). Escribes libre (línea libre) o eliges
        // una sugerencia (rellena precio + IVA por banda, vía applyLinePick).
        // El IVA de la línea NO se elige nunca: va en un campo OCULTO (.line-tax). Producto →
        // hereda su banda (applyLinePick); línea libre (texto sin producto) → 21% FIJO.
        row.innerHTML =
          LINE_CELL +
          '<td><input type="number" class="form-control line-qty" step="0.01" min="0.01" value="1"></td>' +
          '<td><input type="number" class="form-control line-price" step="0.01" min="0" value="0"></td>' +
          '<td style="text-align:right;padding:.7rem 1rem"><span class="line-subtotal">' + SYM + '0.00</span></td>' +
          '<td><button class="btn btn-danger btn-sm" onclick="this.closest(\\'tr\\').remove();scheduleRecalc()">✕</button></td>';
        row.cells[0].insertAdjacentHTML('beforeend', '<input type="hidden" class="line-tax" value="21">');
        tbody.appendChild(row);
        row.querySelectorAll('.line-qty, .line-price').forEach(inp => inp.addEventListener('input', scheduleRecalc));
        scheduleRecalc();
      }

      ${lineSearchScript()}

      // Al elegir un producto del catálogo: rellena descripción y precio, y hereda el IVA
      // de su BANDA (p.tax_rate, resuelto en core/vat-bands.js) en el campo oculto,
      // sobrescribiendo el 21% por defecto de la línea libre. El IRPF no es del producto.
      function applyLinePick(row, p){
        row.querySelector('.line-desc').value  = p.name;
        row.querySelector('.line-price').value = Number(p.price || 0).toFixed(2);
        row.querySelector('.line-tax').value   = String(Number(p.tax_rate) || 0);
        scheduleRecalc();
      }

      function scheduleRecalc(){
        if (recalcTimer) clearTimeout(recalcTimer);
        recalcTimer = setTimeout(doRecalc, 300);
      }

      function collectLines(){
        const lines = [];
        for (const r of document.querySelectorAll('#lines-body tr')) {
          const desc = r.querySelector('.line-desc').value || '_';     // placeholder válido para preview
          const qty   = parseFloat(r.querySelector('.line-qty').value)   || 0;
          const price = parseFloat(r.querySelector('.line-price').value) || 0;
          const rate  = parseFloat(r.querySelector('.line-tax').value)   || 0;
          lines.push({ description: desc, quantity: qty || 0.01, unit_price: price, tax_rate: rate });
          // visual subtotal por línea (sin esperar al servidor)
          r.querySelector('.line-subtotal').textContent = SYM + (qty * price).toFixed(2);
        }
        return lines;
      }

      async function doRecalc(){
        const lines = collectLines();
        if (lines.length === 0) return;
        const irpf_rate = currentIrpfRate();
        try {
          const t = await api('POST','/api/erp/invoices/compute-totals', { lines, irpf_rate });
          renderTotals(t, irpf_rate);
        } catch(e) {
          // Silencioso: si la línea está incompleta (precio 0, etc.) no spameamos toasts.
        }
      }

      // Pie de la factura: Base imponible → IVA AGRUPADO POR TASA (base + cuota por tipo) →
      // IRPF (tipo + cuota, restando) solo si >0 → Total. Todo ya calculado por el servidor.
      function renderTotals(t, irpfRate){
        const labelTd = (txt, color) => '<td colspan="3" style="text-align:right;padding:.45rem 1rem'+(color?';color:'+color:'')+'">'+txt+'</td>';
        const valTd   = (txt, color) => '<td style="text-align:right;padding:.45rem 1rem'+(color?';color:'+color:'')+'">'+txt+'</td><td></td>';
        let html = '<tr><td colspan="3" style="text-align:right;font-weight:600;padding:.7rem 1rem">Base imponible</td>' +
                   '<td style="text-align:right;padding:.7rem 1rem">'+SYM+t.subtotal.toFixed(2)+'</td><td></td></tr>';
        const rates = Object.values(t.taxByRate || {});
        if (rates.length === 0) {
          html += '<tr>'+labelTd('IVA','var(--muted)')+valTd(SYM+'0.00','var(--muted)')+'</tr>';
        } else {
          for (const x of rates) {
            const lbl = (Number(x.rate) > 0 ? 'IVA '+x.rate+'%' : 'Exento (0%)') + ' (sobre '+SYM+Number(x.base).toFixed(2)+')';
            html += '<tr>'+labelTd(lbl,'var(--muted)')+valTd(SYM+Number(x.amount).toFixed(2),'var(--muted)')+'</tr>';
          }
        }
        if (SHOW_IRPF && t.irpfAmount > 0) {
          html += '<tr>'+labelTd('IRPF '+irpfRate+'%','#e879f9')+valTd('−'+SYM+t.irpfAmount.toFixed(2),'#e879f9')+'</tr>';
        }
        html += '<tr><td colspan="3" style="text-align:right;font-weight:700;font-size:1.05rem;padding:.7rem 1rem">Total</td>' +
                '<td style="text-align:right;font-weight:700;font-size:1.05rem;padding:.7rem 1rem">'+SYM+t.total.toFixed(2)+'</td><td></td></tr>';
        document.getElementById('totals-foot').innerHTML = html;
      }

      async function emitInvoice(){
        const client_id = parseInt(document.getElementById('f-client').value);
        if (!client_id) { toast('Selecciona un cliente','err'); return; }
        const issue_date = document.getElementById('f-date').value || undefined;
        const notes = document.getElementById('f-notes').value || '';
        const irpf_rate = currentIrpfRate();
        const lines = [];
        for (const r of document.querySelectorAll('#lines-body tr')) {
          const desc = r.querySelector('.line-desc').value.trim();
          const qty = parseFloat(r.querySelector('.line-qty').value);
          const price = parseFloat(r.querySelector('.line-price').value);
          const rate = parseFloat(r.querySelector('.line-tax').value) || 0;
          if (!desc) { toast('Falta descripción en una línea','err'); return; }
          if (!(qty > 0)) { toast('Cantidad debe ser > 0','err'); return; }
          if (!(price >= 0)) { toast('Precio inválido','err'); return; }
          lines.push({ description: desc, quantity: qty, unit_price: price, tax_rate: rate });
        }
        if (lines.length === 0) { toast('Añade al menos una línea','err'); return; }
        const btn = document.getElementById('btn-emit');
        btn.disabled = true;
        try {
          const res = await api('POST','/api/erp/invoices',{ client_id, lines, issue_date, notes, irpf_rate });
          toast('Factura ' + res.invoice_number + ' emitida');
          window.location.href = '/admin/invoices/' + res.id;
        } catch(e) {
          toast(e.message || 'Error emitiendo factura','err');
          btn.disabled = false;
        }
      }

      loadAll();
      </script>`;
    return c.html(adminLayout('Nueva factura', content, 'invoices', c.get('session')?.csrfToken || '', c));
  });

  // GET /admin/invoices/:id/rectificativa/new — formulario de rectificativa
  // precargado desde la original. (Va ANTES de '/:id' para no ser capturada por él.)
  views.get('/:id/rectificativa/new', requirePerm('invoices.create'), c => {
    const original = db.prepare('SELECT * FROM invoices WHERE id=?').get(c.req.param('id'));
    if (!original) return c.text('Factura no encontrada', 404);
    if (original.status !== 'emitida') {
      return c.html(adminLayout('Rectificativa',
        `<div class="ph"><h2>Rectificativa</h2><a href="/admin/invoices/${original.id}" class="btn btn-secondary">Volver</a></div>
         <div class="card"><div class="card-body">Solo se puede rectificar una factura <strong>emitida</strong>. Esta está <strong>${original.status}</strong>.</div></div>`,
        'invoices', c.get('session')?.csrfToken || '', c));
    }
    const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY id').all(original.id);

    const cfg = db.prepare('SELECT currency_symbol, country, rectificative_series FROM company_config WHERE id=1').get() || {};
    const sym = cfg.currency_symbol || '€';
    const country = (cfg.country || 'ES').toUpperCase();
    const cc = getCountryConfig(country) || { tax_rates: '21,10,4', tax_default: 21 };
    const rates = cc.tax_rates.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    const today = new Date().toISOString().slice(0, 10);
    const rSeries = cfg.rectificative_series || 'R';

    // Líneas precargadas desde la original (descripción, cantidad, precio, IVA por línea).
    const seedLines = items.map(it => ({
      description: it.description,
      quantity: Number(it.quantity),
      unit_price: Number(it.unit_price),
      tax_rate: Number(it.tax_rate) || 0,
    }));

    const content = `
      <div class="ph">
        <h2>Rectificativa de ${original.invoice_number}</h2>
        <a href="/admin/invoices/${original.id}" class="btn btn-secondary">Cancelar</a>
      </div>

      <div class="card" style="max-width:900px">
        <div class="card-body">
          <div style="background:#e0f2fe;color:#075985;padding:10px 14px;border-radius:6px;font-size:13px;margin-bottom:1rem">
            Rectifica a <strong>${original.invoice_number}</strong> · Cliente: <strong>${(original.client_name || 'Cliente general').replace(/</g,'&lt;')}</strong>.
            Se emitirá en serie <strong>${rSeries}</strong> con numeración propia. Admite importes negativos (abono).
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Tipo de rectificativa *</label>
              <select id="f-rtype" class="form-control">
                <option value="R1">R1 · error fundado en derecho</option>
                <option value="R2">R2 · concurso/impago (art.80.3)</option>
                <option value="R3">R3 · impago (art.80.4)</option>
                <option value="R4" selected>R4 · resto de causas</option>
                <option value="R5">R5 · simplificada/ticket</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Modalidad *</label>
              <select id="f-rmode" class="form-control">
                <option value="I" selected>Por diferencias (I)</option>
                <option value="S">Por sustitución (S)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Fecha emisión</label>
              <input type="date" id="f-date" class="form-control" value="${today}">
            </div>
          </div>
          <p style="font-size:12px;color:var(--muted);margin:-.25rem 0 .5rem">
            <strong>Diferencias (I):</strong> indica solo el delta (usa importes negativos para un abono).
            <strong>Sustitución (S):</strong> indica la factura corregida completa.
          </p>

          <hr style="margin:1.25rem 0;border:none;border-top:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
            <h3 style="font-size:.9rem;font-weight:600;margin:0">Líneas</h3>
            <div style="display:flex;gap:.5rem">
              <button class="btn btn-secondary btn-sm" onclick="negarTodo()" title="Invierte el signo de todas las líneas (abono total)">± Invertir signos</button>
              <button class="btn btn-secondary btn-sm" onclick="addLine()">+ Añadir línea</button>
            </div>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Descripción</th>
                  <th style="width:90px">Cant.</th>
                  <th style="width:120px">P. unit.</th>
                  <th style="width:100px;text-align:right">Subtotal</th>
                  <th style="width:36px"></th>
                </tr>
              </thead>
              <tbody id="lines-body"></tbody>
              <tfoot id="totals-foot"></tfoot>
            </table>
          </div>

          <div class="form-group" style="margin-top:1.25rem">
            <label class="form-label">Notas (opcional)</label>
            <textarea id="f-notes" class="form-control" rows="2"></textarea>
          </div>

          <div style="text-align:right;margin-top:1rem">
            <button class="btn btn-primary" id="btn-emit" onclick="emitRectificativa()">Emitir rectificativa</button>
          </div>
        </div>
      </div>

      <script>
      const SYM = '${sym}';
      const RATES = ${JSON.stringify(rates)};
      const SEED_LINES = ${JSON.stringify(seedLines)};
      const IRPF_RATE = ${Number(original.irpf_rate) || 0};   // se mantiene el IRPF de la original
      const ORIGINAL_ID = ${original.id};
      const LINE_CELL = ${JSON.stringify(lineSearchCellHtml())};
      let catalog = [];
      let recalcTimer = null;

      async function loadAll(){
        try {
          const prods = await api('GET','/api/erp/products').catch(()=>[]);
          catalog = (prods || []).filter(p => p.status === 'active');
        } catch(e){}
        if (SEED_LINES.length) { for (const l of SEED_LINES) addLine(l); }
        else addLine();
        scheduleRecalc();
      }

      function addLine(seed){
        const tbody = document.getElementById('lines-body');
        const row = document.createElement('tr');
        // Línea de rectificativa: admite cantidad y precio NEGATIVOS (abono) → sin min.
        row.innerHTML =
          LINE_CELL +
          '<td><input type="number" class="form-control line-qty" step="0.01" value="1"></td>' +
          '<td><input type="number" class="form-control line-price" step="0.01" value="0"></td>' +
          '<td style="text-align:right;padding:.7rem 1rem"><span class="line-subtotal">' + SYM + '0.00</span></td>' +
          '<td><button class="btn btn-danger btn-sm" onclick="this.closest(\\'tr\\').remove();scheduleRecalc()">✕</button></td>';
        row.cells[0].insertAdjacentHTML('beforeend', '<input type="hidden" class="line-tax" value="21">');
        tbody.appendChild(row);
        if (seed) {
          row.querySelector('.line-desc').value  = seed.description || '';
          row.querySelector('.line-qty').value   = seed.quantity;
          row.querySelector('.line-price').value = Number(seed.unit_price || 0).toFixed(2);
          row.querySelector('.line-tax').value   = String(Number(seed.tax_rate) || 0);
        }
        row.querySelectorAll('.line-qty, .line-price').forEach(inp => inp.addEventListener('input', scheduleRecalc));
        scheduleRecalc();
      }

      ${lineSearchScript()}

      // Al elegir un producto del catálogo: rellena descripción, precio e IVA por banda.
      function applyLinePick(row, p){
        row.querySelector('.line-desc').value  = p.name;
        row.querySelector('.line-price').value = Number(p.price || 0).toFixed(2);
        row.querySelector('.line-tax').value   = String(Number(p.tax_rate) || 0);
        scheduleRecalc();
      }

      function negarTodo(){
        for (const r of document.querySelectorAll('#lines-body tr')) {
          const q = r.querySelector('.line-qty');
          q.value = String(-(parseFloat(q.value) || 0));
        }
        scheduleRecalc();
      }

      function scheduleRecalc(){
        if (recalcTimer) clearTimeout(recalcTimer);
        recalcTimer = setTimeout(doRecalc, 200);
      }

      // Cálculo de totales en cliente (idéntico al servidor) — soporta importes NEGATIVOS,
      // por eso no usamos /compute-totals (su validación exige cantidad positiva).
      function computeTotals(lines, irpfRate){
        const r2 = n => Math.round(n * 100) / 100;
        let subtotal = 0; const taxByRate = {};
        for (const l of lines) {
          const base = r2((Number(l.quantity)||0) * (Number(l.unit_price)||0));
          const rate = Number(l.tax_rate) || 0;
          const tax  = r2(base * rate / 100);
          subtotal += base;
          const k = String(rate);
          if (!taxByRate[k]) taxByRate[k] = { rate, base: 0, amount: 0 };
          taxByRate[k].base += base; taxByRate[k].amount += tax;
        }
        for (const k of Object.keys(taxByRate)) { taxByRate[k].base = r2(taxByRate[k].base); taxByRate[k].amount = r2(taxByRate[k].amount); }
        subtotal = r2(subtotal);
        const taxAmount  = r2(Object.values(taxByRate).reduce((s,t)=>s+t.amount,0));
        const irpfAmount = r2(subtotal * (Number(irpfRate)||0) / 100);
        const total = r2(subtotal + taxAmount - irpfAmount);
        return { subtotal, taxByRate, taxAmount, irpfAmount, total };
      }

      function collectLines(){
        const lines = [];
        for (const r of document.querySelectorAll('#lines-body tr')) {
          const desc  = r.querySelector('.line-desc').value || '_';
          const qty   = parseFloat(r.querySelector('.line-qty').value)   || 0;
          const price = parseFloat(r.querySelector('.line-price').value) || 0;
          const rate  = parseFloat(r.querySelector('.line-tax').value)   || 0;
          lines.push({ description: desc, quantity: qty, unit_price: price, tax_rate: rate });
          r.querySelector('.line-subtotal').textContent = SYM + (qty * price).toFixed(2);
        }
        return lines;
      }

      function doRecalc(){
        const t = computeTotals(collectLines(), IRPF_RATE);
        renderTotals(t);
      }

      function renderTotals(t){
        const labelTd = (txt,color) => '<td colspan="3" style="text-align:right;padding:.45rem 1rem'+(color?';color:'+color:'')+'">'+txt+'</td>';
        const valTd   = (txt,color) => '<td style="text-align:right;padding:.45rem 1rem'+(color?';color:'+color:'')+'">'+txt+'</td><td></td>';
        let html = '<tr><td colspan="3" style="text-align:right;font-weight:600;padding:.7rem 1rem">Base imponible</td>' +
                   '<td style="text-align:right;padding:.7rem 1rem">'+SYM+t.subtotal.toFixed(2)+'</td><td></td></tr>';
        const rs = Object.values(t.taxByRate || {});
        if (!rs.length) html += '<tr>'+labelTd('IVA','var(--muted)')+valTd(SYM+'0.00','var(--muted)')+'</tr>';
        else for (const x of rs) {
          const lbl = (Number(x.rate) > 0 ? 'IVA '+x.rate+'%' : 'Exento (0%)') + ' (sobre '+SYM+Number(x.base).toFixed(2)+')';
          html += '<tr>'+labelTd(lbl,'var(--muted)')+valTd(SYM+Number(x.amount).toFixed(2),'var(--muted)')+'</tr>';
        }
        if (Math.abs(t.irpfAmount) > 0) html += '<tr>'+labelTd('IRPF '+IRPF_RATE+'%','#e879f9')+valTd('−'+SYM+t.irpfAmount.toFixed(2),'#e879f9')+'</tr>';
        html += '<tr><td colspan="3" style="text-align:right;font-weight:700;font-size:1.05rem;padding:.7rem 1rem">Total</td>' +
                '<td style="text-align:right;font-weight:700;font-size:1.05rem;padding:.7rem 1rem">'+SYM+t.total.toFixed(2)+'</td><td></td></tr>';
        document.getElementById('totals-foot').innerHTML = html;
      }

      async function emitRectificativa(){
        const rectification_type = document.getElementById('f-rtype').value;
        const rectification_mode = document.getElementById('f-rmode').value;
        const issue_date = document.getElementById('f-date').value || undefined;
        const notes = document.getElementById('f-notes').value || '';
        const lines = [];
        for (const r of document.querySelectorAll('#lines-body tr')) {
          const desc  = r.querySelector('.line-desc').value.trim();
          const qty   = parseFloat(r.querySelector('.line-qty').value);
          const price = parseFloat(r.querySelector('.line-price').value);
          const rate  = parseFloat(r.querySelector('.line-tax').value) || 0;
          if (!desc) { toast('Falta descripción en una línea','err'); return; }
          if (!Number.isFinite(qty) || qty === 0) { toast('Cantidad no puede ser 0','err'); return; }
          if (!Number.isFinite(price)) { toast('Precio inválido','err'); return; }
          lines.push({ description: desc, quantity: qty, unit_price: price, tax_rate: rate });
        }
        if (!lines.length) { toast('Añade al menos una línea','err'); return; }
        const btn = document.getElementById('btn-emit');
        btn.disabled = true;
        try {
          const res = await api('POST','/api/erp/invoices/'+ORIGINAL_ID+'/rectificativa',
            { rectification_type, rectification_mode, lines, issue_date, notes });
          toast('Rectificativa ' + res.invoice_number + ' emitida');
          window.location.href = '/admin/invoices/' + res.id;
        } catch(e) {
          toast(e.message || 'Error emitiendo rectificativa','err');
          btn.disabled = false;
        }
      }

      loadAll();
      </script>`;
    return c.html(adminLayout('Rectificativa', content, 'invoices', c.get('session')?.csrfToken || '', c));
  });

  // GET /admin/invoices/:id — printable invoice
  views.get('/:id', requirePerm('orders.read'), c => {
    try {
      const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(c.req.param('id'));
      if (!inv) return c.text('Factura no encontrada', 404);
      const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY id').all(inv.id);
      const sym = inv.currency_symbol || '€';

      // Enlaces de ciclo de vida para el banner de estado.
      const anulacion = db.prepare('SELECT * FROM invoice_anulaciones WHERE invoice_id=? ORDER BY id DESC LIMIT 1').get(inv.id) || null;
      const rectifiedBy = db.prepare('SELECT id, invoice_number FROM invoices WHERE rectifies_invoice_id=? ORDER BY id DESC LIMIT 1').get(inv.id) || null;
      const rectifiesOriginal = inv.rectifies_invoice_id
        ? (db.prepare('SELECT id, invoice_number FROM invoices WHERE id=?').get(inv.rectifies_invoice_id) || null)
        : null;
      const csrfToken = c.get('session')?.csrfToken || '';
      const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const rTypeLabels = { R1: 'R1 · error fundado en derecho', R2: 'R2 · concurso/impago (art.80.3)', R3: 'R3 · impago (art.80.4)', R4: 'R4 · resto de causas', R5: 'R5 · simplificada/ticket' };

      const rows = items.map(it => `
        <tr>
          <td>${it.description}</td>
          <td style="text-align:right">${it.quantity}</td>
          <td style="text-align:right">${sym}${it.unit_price.toFixed(2)}</td>
          <td style="text-align:right">${sym}${it.total_price.toFixed(2)}</td>
        </tr>`).join('');

      const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${inv.document_name} ${inv.invoice_number}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;font-size:13px;color:#1e293b;padding:40px;max-width:800px;margin:auto}
  h1{font-size:24px;font-weight:700;margin-bottom:4px}
  .sub{color:#64748b;font-size:12px;margin-bottom:32px}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-bottom:32px}
  .label{font-size:11px;text-transform:uppercase;color:#64748b;font-weight:600;margin-bottom:4px}
  table{width:100%;border-collapse:collapse;margin-bottom:24px}
  th{background:#f8fafc;padding:8px 12px;text-align:left;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0}
  td{padding:8px 12px;border-bottom:1px solid #f1f5f9}
  .totals{margin-left:auto;width:280px}
  .totals tr td:first-child{color:#64748b}
  .totals tr td:last-child{text-align:right;font-weight:600}
  .totals tr.grand td{font-size:15px;border-top:2px solid #1e293b;padding-top:10px}
  .hash{margin-top:32px;padding:12px;background:#f8fafc;border-radius:6px;font-family:monospace;font-size:10px;color:#94a3b8;word-break:break-all}
  .status-pill{display:inline-block;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;margin-top:4px}
  .status-emitida{background:#dcfce7;color:#166534}
  .status-rectificada{background:#fef3c7;color:#92400e}
  .status-anulada{background:#fee2e2;color:#991b1b}
  .actions{display:flex;gap:8px}
  .btn-primary{padding:8px 16px;background:#1e293b;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;text-decoration:none}
  .btn-secondary{padding:8px 16px;background:#fff;color:#1e293b;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;font-size:13px;text-decoration:none}
  .lifecycle{margin:0 0 24px;padding:12px 16px;border-radius:6px;font-size:13px}
  .lifecycle a{color:inherit;font-weight:600}
  .lc-anulada{background:#fee2e2;color:#991b1b}
  .lc-rectificada{background:#fef3c7;color:#92400e}
  .lc-rectificativa{background:#e0f2fe;color:#075985}
  @media print{body{padding:20px}.hash{break-inside:avoid}.actions{display:none}.status-pill{display:none}}
</style>
</head>
<body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px">
  <div>
    <h1>${inv.document_name}</h1>
    <div class="sub">${inv.invoice_number}</div>
    <div class="status-pill status-${inv.status}">${inv.status === 'emitida' ? 'Emitida' : inv.status === 'rectificada' ? 'Rectificada' : 'Anulada'} el ${inv.issue_date}</div>
  </div>
  <div class="actions">
    <a href="/admin/invoices" class="btn-secondary">← Volver al listado</a>
    ${inv.status === 'emitida' ? `<button onclick="anularFactura()" class="btn-secondary">Anular</button>
    <a href="/admin/invoices/${inv.id}/rectificativa/new" class="btn-secondary">Crear rectificativa</a>` : ''}
    <button onclick="window.print()" class="btn-primary">Imprimir</button>
  </div>
</div>

${(() => {
  // Banner de ciclo de vida: explica el estado y enlaza los documentos relacionados.
  if (inv.status === 'anulada' && anulacion) {
    return `<div class="lifecycle lc-anulada">
      <strong>Factura anulada</strong> el ${esc(anulacion.issue_date)}.
      Motivo: ${esc(anulacion.motivo)}.
      <div style="font-size:11px;color:#94a3b8;margin-top:4px;font-family:monospace;word-break:break-all">Asiento de anulación · hash ${esc(anulacion.verifactu_hash)}</div>
    </div>`;
  }
  if (inv.status === 'rectificada' && rectifiedBy) {
    return `<div class="lifecycle lc-rectificada">
      <strong>Factura rectificada</strong> por
      <a href="/admin/invoices/${rectifiedBy.id}">${esc(rectifiedBy.invoice_number)}</a>.
    </div>`;
  }
  if (inv.record_type === 'rectificativa' && rectifiesOriginal) {
    return `<div class="lifecycle lc-rectificativa">
      <strong>Factura rectificativa</strong> ${esc(rTypeLabels[inv.rectification_type] || inv.rectification_type || '')}
      · ${inv.rectification_mode === 'S' ? 'por sustitución' : 'por diferencias'}.
      Rectifica a <a href="/admin/invoices/${rectifiesOriginal.id}">${esc(rectifiesOriginal.invoice_number)}</a>.
    </div>`;
  }
  return '';
})()}

<div class="cols">
  <div>
    <div class="label">Emisor</div>
    <div><strong>${inv.company_name}</strong></div>
    ${inv.company_fiscal_id ? `<div>${inv.company_fiscal_id}</div>` : ''}
    ${inv.company_address ? `<div style="color:#64748b">${inv.company_address}</div>` : ''}
  </div>
  <div>
    <div class="label">Cliente</div>
    <div><strong>${inv.client_name || 'Cliente general'}</strong></div>
    ${inv.client_fiscal_id ? `<div>${inv.client_fiscal_id}</div>` : ''}
    ${inv.client_address ? `<div style="color:#64748b">${inv.client_address}</div>` : ''}
    ${inv.client_email ? `<div style="color:#64748b">${inv.client_email}</div>` : ''}
  </div>
</div>

<table>
  <thead><tr><th>Descripción</th><th style="text-align:right">Cant.</th><th style="text-align:right">P. unitario</th><th style="text-align:right">Total</th></tr></thead>
  <tbody>${rows}</tbody>
</table>

${(() => {
  // Tres casos:
  // (1) Items con tasa registrada (A1+A2) → desglose desde items. 1 row si única tasa,
  //     N rows si mezcla. Fila al 0% se etiqueta "Exento de IVA".
  // (2) Factura vieja sin tasa en items pero con tax_rate global → resumen simple.
  // (3) Factura toda exenta (items todos al 0%) → "Exento de IVA".
  let taxBlock = '';
  const itemsHaveTax = items.length > 0 &&
    items.some(it => Number(it.tax_rate) > 0 || Number(it.tax_amount) > 0);

  if (itemsHaveTax) {
    const groups = {};
    for (const it of items) {
      const r = Number(it.tax_rate) || 0;
      if (!groups[r]) groups[r] = { base: 0, amount: 0 };
      groups[r].base   += Number(it.total_price) || 0;
      groups[r].amount += Number(it.tax_amount)  || 0;
    }
    taxBlock = Object.keys(groups).sort((a,b) => b-a).map(r => {
      const base = groups[r].base.toFixed(2);
      if (Number(r) === 0) {
        return `<tr><td>Exento de IVA (sobre ${sym}${base})</td><td>${sym}0.00</td></tr>`;
      }
      return `<tr><td>${inv.tax_name} ${r}% (sobre ${sym}${base})</td><td>${sym}${groups[r].amount.toFixed(2)}</td></tr>`;
    }).join('');
  } else if (inv.tax_rate > 0) {
    taxBlock = `<tr><td>${inv.tax_name} (${inv.tax_rate}%)</td><td>${sym}${inv.tax_amount.toFixed(2)}</td></tr>`;
  } else if (items.length > 0) {
    // Factura completa al 0% — A2 con todas las líneas exentas.
    const totalBase = items.reduce((s, it) => s + (Number(it.total_price) || 0), 0);
    taxBlock = `<tr><td>Exento de IVA (sobre ${sym}${totalBase.toFixed(2)})</td><td>${sym}0.00</td></tr>`;
  } else {
    taxBlock = `<tr><td>${inv.tax_name}</td><td>${sym}${inv.tax_amount.toFixed(2)}</td></tr>`;
  }

  const irpfBlock = (Number(inv.irpf_amount) > 0)
    ? `<tr><td style="color:#9333ea">IRPF (${inv.irpf_rate}%)</td><td style="color:#9333ea">−${sym}${inv.irpf_amount.toFixed(2)}</td></tr>`
    : '';
  return `<table class="totals">
  <tr><td>Base imponible</td><td>${sym}${inv.subtotal.toFixed(2)}</td></tr>
  ${taxBlock}
  ${irpfBlock}
  <tr class="grand"><td>TOTAL</td><td>${sym}${inv.total.toFixed(2)}</td></tr>
</table>`;
})()}

${inv.notes ? `<div style="margin-top:16px;color:#64748b">${inv.notes}</div>` : ''}

<div class="hash">
  <strong>Hash Verifactu:</strong> ${inv.verifactu_hash}<br>
  <strong>Hash anterior:</strong> ${inv.prev_hash || '(primera factura)'}
</div>
<script>
  const CSRF = ${JSON.stringify(csrfToken)};
  async function anularFactura(){
    const motivo = prompt('Motivo de anulación de la factura ${inv.invoice_number}:');
    if (motivo === null) return;
    if (!motivo.trim()){ alert('El motivo es obligatorio'); return; }
    try {
      const r = await fetch('/api/erp/invoices/${inv.id}/anular', {
        method:'POST',
        headers:{'Content-Type':'application/json','x-csrf-token':CSRF},
        body: JSON.stringify({ motivo: motivo.trim() })
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      location.reload();
    } catch(e){ alert(e.message || 'Error anulando la factura'); }
  }
</script>
</body>
</html>`;
      return c.html(html);
    } catch (e) { return c.text(e.message, 500); }
  });

  return { api, views };
}
