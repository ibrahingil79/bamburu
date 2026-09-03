// ════════════════════════════════════════════════════════════════════════════
// MOTOR DE CONTABILIDAD · Pieza 1 — cuaderno de doble cara (libro diario) + los dos
// libros registro (ventas e ingresos / compras y gastos).
//
// El CUADERNO (ledger_entries + ledger_lines) es la ÚNICA fuente de verdad contable.
// Los asientos se GENERAN desde los documentos inmutables que ya existen (invoices,
// invoice_payments, invoice_anulaciones, supplier_invoices, supplier_payments) — NUNCA
// se editan a mano. Los dos libros son VISTAS derivadas del cuaderno.
//
// Modelo CONTINENTAL español: el gasto nace al recibir la factura; SIN coste de venta
// por operación (la variación de existencias será pieza de cierre futura).
//
// Aditivo: no toca la lógica/datos de los documentos, ni la cadena de hash/Verifactu,
// ni el stock, ni permisos. Reutiliza countsAsReceivable (cobros.js) y countsAsPayable
// (pagos.js) — cero lógica fiscal duplicada.
//
// Inmutabilidad: corregir un asiento = asiento que lo REVIERTE (reverses_entry_id),
// nunca editar/borrar (mismo patrón que stock_movements y facturas).
// ════════════════════════════════════════════════════════════════════════════
import { countsAsReceivable } from './cobros.js';
import { fechaEs } from './voz.js';   // la fecha del memo, en cristiano
import { countsAsPayable } from './pagos.js';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

// ── Plan de cuentas mínimo (PGC de empresa RD 1514/2007), 3 dígitos, extensible ──
// Códigos verificados contra el PGC oficial (no de memoria).
export const ACCOUNTS = [
  ['430', 'Clientes', 'activo'],
  ['473', 'Hacienda Pública, retenciones y pagos a cuenta', 'activo'],   // IRPF soportado en ventas
  ['477', 'Hacienda Pública, IVA repercutido', 'pasivo'],
  ['700', 'Ventas de mercaderías', 'ingreso'],
  ['705', 'Prestaciones de servicios', 'ingreso'],
  ['400', 'Proveedores', 'pasivo'],
  ['410', 'Acreedores por prestaciones de servicios', 'pasivo'],
  ['472', 'Hacienda Pública, IVA soportado', 'activo'],
  ['600', 'Compras de mercaderías', 'gasto'],
  ['621', 'Arrendamientos y cánones', 'gasto'],
  ['622', 'Reparaciones y conservación', 'gasto'],
  ['623', 'Servicios de profesionales independientes', 'gasto'],
  ['624', 'Transportes', 'gasto'],
  ['625', 'Primas de seguros', 'gasto'],
  ['626', 'Servicios bancarios y similares', 'gasto'],
  ['627', 'Publicidad, propaganda y relaciones públicas', 'gasto'],
  ['628', 'Suministros', 'gasto'],
  ['629', 'Otros servicios', 'gasto'],
  ['570', 'Caja, euros', 'activo'],
  ['572', 'Bancos e instituciones de crédito c/c vista, euros', 'activo'],
];

// expense_category (lista cerrada de la app) → cuenta del subgrupo 62 (servicios exteriores).
const EXPENSE_ACCOUNT = {
  'Alquiler': '621',
  'Suministros': '628',
  'Servicios profesionales': '623',
  'Software y herramientas': '629',
  'Banca y financieros': '626',
  'Marketing y publicidad': '627',
  'Transporte y vehículo': '624',
  'Material de oficina': '629',
  'Otros': '629',
};
const expenseAccount = cat => EXPENSE_ACCOUNT[cat] || '629';
// Método de pago → cuenta de tesorería. efectivo→Caja(570); resto (tarjeta/transferencia/—)→Bancos(572).
const treasuryAccount = method => (method === 'efectivo' ? '570' : '572');

// ── Esquema (lazy, idempotente, por tenant) ─────────────────────────────────
export function ensureLedgerSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ledger_accounts (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      account_group TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS ledger_entries (
      id INTEGER PRIMARY KEY,
      entry_date DATE NOT NULL,
      entry_type TEXT NOT NULL,
      origin_type TEXT NOT NULL,
      origin_id INTEGER NOT NULL,
      reverses_entry_id INTEGER,
      memo TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(origin_type, origin_id, entry_type)
    );
    CREATE TABLE IF NOT EXISTS ledger_lines (
      id INTEGER PRIMARY KEY,
      entry_id INTEGER NOT NULL,
      account_code TEXT NOT NULL,
      debit REAL NOT NULL DEFAULT 0,
      credit REAL NOT NULL DEFAULT 0,
      tax_rate REAL,
      line_kind TEXT,
      FOREIGN KEY (entry_id) REFERENCES ledger_entries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_entries_date ON ledger_entries(entry_date);
    CREATE INDEX IF NOT EXISTS idx_ledger_entries_origin ON ledger_entries(origin_type, origin_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_lines_entry ON ledger_lines(entry_id);
  `);
  const ins = db.prepare('INSERT OR IGNORE INTO ledger_accounts (code, name, account_group) VALUES (?,?,?)');
  for (const [code, name, group] of ACCOUNTS) ins.run(code, name, group);
}

// ── Constructor de líneas normalizadas (debe/haber siempre >= 0) ─────────────
// Empuja una anotación con su lado NATURAL ('D' o 'H'); si el importe es negativo
// (rectificativa de abono, abono de proveedor, reembolso) se vuelca al lado contrario.
function pushLine(lines, account, amount, naturalSide, rate = null, kind = null) {
  const a = r2(amount);
  if (a === 0) return;
  const onDebit = naturalSide === 'D' ? a > 0 : a < 0;
  lines.push({
    account_code: account,
    debit: onDebit ? Math.abs(a) : 0,
    credit: onDebit ? 0 : Math.abs(a),
    tax_rate: rate,
    line_kind: kind,
  });
}

// ── Escritor de asiento (idempotente + cuadre obligatorio Σdebe=Σhaber) ──────
function writeEntry(db, { entry_type, origin_type, origin_id, entry_date, memo = '', reverses_entry_id = null, lines }) {
  const existing = db.prepare('SELECT id FROM ledger_entries WHERE origin_type=? AND origin_id=? AND entry_type=?')
    .get(origin_type, origin_id, entry_type);
  if (existing) return existing.id;   // ya posteado → no duplica

  const sumD = r2(lines.reduce((s, l) => s + l.debit, 0));
  const sumH = r2(lines.reduce((s, l) => s + l.credit, 0));
  if (Math.round(sumD * 100) !== Math.round(sumH * 100)) {
    throw new Error(`Asiento descuadrado (${entry_type} ${origin_type}#${origin_id}): debe ${sumD} ≠ haber ${sumH}`);
  }
  if (!lines.length) return null;

  // El descuadre ya se ha validado ARRIBA (antes de tocar la BD), así que aquí no puede
  // abortar nada. Si ya estamos dentro de una transacción (p. ej. el hook corre dentro de la
  // transacción de la captura de compra), insertamos directo — better-sqlite3 NO anida
  // transacciones; si no, abrimos una propia para que entry+líneas sean atómicos.
  const doWrite = () => {
    const res = db.prepare(`INSERT INTO ledger_entries (entry_date, entry_type, origin_type, origin_id, reverses_entry_id, memo)
      VALUES (?,?,?,?,?,?)`).run(entry_date, entry_type, origin_type, origin_id, reverses_entry_id, memo);
    const eid = res.lastInsertRowid;
    const insL = db.prepare('INSERT INTO ledger_lines (entry_id, account_code, debit, credit, tax_rate, line_kind) VALUES (?,?,?,?,?,?)');
    for (const l of lines) insL.run(eid, l.account_code, r2(l.debit), r2(l.credit), l.tax_rate, l.line_kind);
    return eid;
  };
  return db.inTransaction ? doWrite() : db.transaction(doWrite)();
}

// Reversa un asiento existente (mismas cuentas, debe/haber cruzados). Fecha = la del
// asiento original, para que ANULADAS/SUSTITUIDAS neteen a cero en su MISMO periodo.
function reverseExisting(db, original, entry_type, memo) {
  const lines = db.prepare('SELECT account_code, debit, credit, tax_rate, line_kind FROM ledger_lines WHERE entry_id=?').all(original.id)
    .map(l => ({ account_code: l.account_code, debit: l.credit, credit: l.debit, tax_rate: l.tax_rate, line_kind: l.line_kind }));
  return writeEntry(db, {
    entry_type, origin_type: original.origin_type, origin_id: original.origin_id,
    entry_date: original.entry_date, reverses_entry_id: original.id, memo, lines,
  });
}

// ── ASIENTOS HUÉRFANOS: EL DOCUMENTO SE BORRÓ Y EL APUNTE SE QUEDÓ ───────────────────────────────
// DE DÓNDE SALE (24 ago 2026). `verify-contabilidad-backfill` llevaba meses sin ejecutarlo nadie —era
// una de las 99 invisibles— y decía la verdad: el LIBRO sumaba más que los DOCUMENTOS VIVOS. Medido
// en el negocio de desarrollo: ventas 419.843,99 € de libro contra 418.803,39 € de documentos, y
// compras 121.883,06 contra 119.618,26. La causa, buscada a mano: **33 asientos cuyo documento ya no
// existe** — limpiezas de comprobaciones que borraron facturas sin deshacer su apunte.
//
// CÓMO SE CORRIGE, y por qué así. Un libro contable NO SE BORRA: se corrige con un asiento que anula
// al anterior y deja rastro de que existió. Es lo que hace un contable y lo que espera cualquier
// gestoría que mire estos libros. Por eso aquí no hay ningún DELETE.
//
// Y AQUÍ LA FECHA ES LA DE HOY, no la del original — al revés que `reverseExisting`. El motivo es
// distinto en cada caso: una factura ANULADA se reversa en SU periodo para que netee a cero donde
// estaba; un huérfano NO es una anulación de negocio, es una CORRECCIÓN de los libros, y una
// corrección se fecha el día que se hace. Fecharla hacia atrás sería reescribir un periodo cerrado.
export function reversarHuerfanos(db, { hoy, simulacro = false } = {}) {
  const fecha = hoy || new Date().toISOString().slice(0, 10);
  const huerfanos = db.prepare(`
    SELECT e.* FROM ledger_entries e
     WHERE e.reverses_entry_id IS NULL
       AND (
         (e.origin_type='invoice'          AND NOT EXISTS (SELECT 1 FROM invoices i          WHERE i.id=e.origin_id))
      OR (e.origin_type='supplier_invoice' AND NOT EXISTS (SELECT 1 FROM supplier_invoices s WHERE s.id=e.origin_id))
      OR (e.origin_type='invoice_payment'  AND NOT EXISTS (SELECT 1 FROM invoice_payments p  WHERE p.id=e.origin_id))
      OR (e.origin_type='supplier_payment' AND NOT EXISTS (SELECT 1 FROM supplier_payments p WHERE p.id=e.origin_id))
       )
       AND NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.reverses_entry_id = e.id)
     ORDER BY e.id`).all();
  if (simulacro) return { encontrados: huerfanos.length, anulados: 0, detalle: huerfanos };
  const hacer = () => {
    let n = 0;
    for (const e of huerfanos) {
      const lines = db.prepare('SELECT account_code, debit, credit, tax_rate, line_kind FROM ledger_lines WHERE entry_id=?').all(e.id)
        .map(l => ({ account_code: l.account_code, debit: l.credit, credit: l.debit, tax_rate: l.tax_rate, line_kind: l.line_kind }));
      if (!lines.length) continue;
      writeEntry(db, {
        entry_type: 'reversion', origin_type: e.origin_type, origin_id: e.origin_id,
        entry_date: fecha, reverses_entry_id: e.id,
        // La fecha del memo va en cristiano: este texto SE LEE en el diario, y una fecha ISO en
        // pantalla es exactamente lo que el resto del producto ya no hace.
        memo: 'Anula asiento huérfano de documento borrado (asiento #' + e.id
              + ', ' + e.origin_type + ' #' + e.origin_id + ', fechado ' + fechaEs(e.entry_date) + ')',
        lines,
      });
      n++;
    }
    return n;
  };
  const anulados = db.inTransaction ? hacer() : db.transaction(hacer)();
  return { encontrados: huerfanos.length, anulados, detalle: huerfanos };
}

// ── LO QUE UNA CORRECCIÓN DE OTRO PERIODO METE EN ESTE ───────────────────────────────────────────
// 24 ago 2026. Un asiento que ANULA a otro se fecha el día que se hace —no se reabre un periodo
// cerrado—, así que la corrección de un apunte de junio aterriza en AGOSTO con signo negativo. El
// libro histórico sigue cuadrando; el de AGOSTO, no: trae un descuento cuya factura no es de agosto.
//
// Medido el día que pasó: el desglose de agosto se movió 992,20 €, que eran exactamente las
// reversiones de asientos de junio y julio fechadas hoy.
//
// **Esto no afloja nada: hace que la comparación compare lo mismo en los dos lados.** Una corrección
// de otro periodo no es una venta de este, y contarla como si lo fuera deja un rojo permanente —y un
// rojo permanente se acaba ignorando, que es como se llega a 99 comprobaciones que nadie mira.
//
// ⚙️ 3 SEP 2026 · LA REGLA ESTABA ESCRITA A MEDIAS, Y EL COMENTARIO DE ARRIBA YA PROMETÍA LAS DOS
// MITADES. Decía «hace que la comparación compare lo mismo en los dos lados» y solo miraba UN lado:
// la reversión fechada DENTRO del periodo cuyo original está fuera. **Le faltaba el espejo** — el
// original DENTRO del periodo y su reversión FUERA—, que es lo que sale cuando se corrige en
// septiembre un apunte de agosto.
//
// Cómo apareció: el 3 de septiembre se anularon 12 asientos huérfanos de `desarrollo-bamburu`; dos
// estaban fechados el 29 y el 30 de AGOSTO y su contrasiento fue de HOY, septiembre. El libro de
// agosto se quedó con **96,80 €** de apuntes cuya factura ya no existe, la comprobación cantó un
// descuadre y **tenía razón**: 3.821,79 − 96,80 = 3.724,99, que es justo lo vivo. Lo que fallaba no
// era el producto ni la corrección: era que esta función solo sabía restar en un sentido.
//
// Las dos mitades, y por qué se restan las dos:
//   · **Reversión DENTRO, original FUERA** → el periodo trae un descuento que no es suyo. Se quita
//     lo que aporta la REVERSIÓN (negativo), así que restarlo SUBE la cifra del periodo.
//   · **Original DENTRO, reversión FUERA** → el periodo trae una venta que ya se anuló en otro mes.
//     Se quita lo que aporta el ORIGINAL (positivo), así que restarlo BAJA la cifra del periodo.
// En los dos casos la operación es la misma —`libro − total`—, y el signo lo pone cada mitad.
//
// Devuelve lo que esas correcciones aportan al periodo, con su detalle, para que la cifra se pueda
// enseñar en vez de aplicarse a ciegas. `sentido` dice de cuál de las dos mitades viene cada fila:
// una cifra agregada que no se puede desglosar es la que nadie puede comprobar.
export function correccionesDeOtroPeriodo(db, tipoOrigen, from, to) {
  if (!from || !to) return { total: 0, detalle: [] };
  // Lo que un asiento aporta a las cuentas de resultado del libro. Se escribe una vez: si mañana
  // entra otra cuenta, entra para las dos mitades o vuelve el mismo agujero por el otro lado.
  const APORTA = "ROUND(SUM(CASE WHEN l.account_code IN ('700','705','477') THEN l.credit - l.debit ELSE 0 END), 2)";

  // Mitad 1 — la de siempre: la REVERSIÓN cae dentro del periodo y su original, fuera.
  const dentro = db.prepare(`
    SELECT e.id, e.entry_date, e.origin_id, o.entry_date AS fecha_original,
           'reversion_dentro' AS sentido, ${APORTA} AS aporta
      FROM ledger_entries e
      JOIN ledger_entries o ON o.id = e.reverses_entry_id
      JOIN ledger_lines  l ON l.entry_id = e.id
     WHERE e.entry_type = 'reversion'
       AND e.origin_type = ?
       AND e.entry_date BETWEEN ? AND ?
       AND (o.entry_date < ? OR o.entry_date > ?)
     GROUP BY e.id`).all(tipoOrigen, from, to, from, to);

  // Mitad 2 — EL ESPEJO: el ORIGINAL cae dentro del periodo y su reversión, fuera. Aquí se suman las
  // líneas del ORIGINAL (`o`), no las de la reversión: es el apunte del original el que sigue dentro
  // del libro de este periodo inflándolo.
  const fuera = db.prepare(`
    SELECT o.id, o.entry_date, o.origin_id, e.entry_date AS fecha_reversion,
           'original_dentro' AS sentido, ${APORTA} AS aporta
      FROM ledger_entries e
      JOIN ledger_entries o ON o.id = e.reverses_entry_id
      JOIN ledger_lines  l ON l.entry_id = o.id
     WHERE e.entry_type = 'reversion'
       AND e.origin_type = ?
       AND o.entry_date BETWEEN ? AND ?
       AND (e.entry_date < ? OR e.entry_date > ?)
     GROUP BY o.id`).all(tipoOrigen, from, to, from, to);

  const filas = dentro.concat(fuera);
  const total = Math.round(filas.reduce((s, f) => s + (f.aporta || 0), 0) * 100) / 100;
  return { total, detalle: filas };
}

// Cuántos asientos quedan sin documento y SIN anular. Es lo que mide la comprobación que impide que
// el agujero se vuelva a abrir: si alguien borra un documento sin deshacer su apunte, esto sube.
export function huerfanosVivos(db) {
  return reversarHuerfanos(db, { simulacro: true }).detalle;
}

function saleEntryOf(db, invoiceId) {
  return db.prepare("SELECT * FROM ledger_entries WHERE origin_type='invoice' AND origin_id=? AND entry_type IN ('venta','rectificativa')").get(invoiceId);
}
function reversalExists(db, origin_type, origin_id) {
  return !!db.prepare("SELECT 1 FROM ledger_entries WHERE origin_type=? AND origin_id=? AND entry_type IN ('anulacion_venta','reversion') LIMIT 1").get(origin_type, origin_id);
}

// ── POSTEO: factura de VENTA (reconcilia el estado de UNA factura) ───────────
// Reusa countsAsReceivable EXACTO: anulada/ sustituida / rectificada-S → no cuenta
// (su asiento se reversa); rectificada-I y resto → cuenta.
export function postInvoice(db, invoiceId) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(invoiceId);
  if (!inv) return;
  const counts = countsAsReceivable(db, inv);
  const sale = saleEntryOf(db, invoiceId);

  if (!counts) {
    if (sale && !reversalExists(db, 'invoice', invoiceId)) {
      const type = inv.status === 'anulada' ? 'anulacion_venta' : 'reversion';
      reverseExisting(db, sale, type, type === 'anulacion_venta'
        ? `Anulación de la venta ${inv.invoice_number}`
        : `Reversión (sustituida/rectificada) de ${inv.invoice_number}`);
    }
    return;
  }
  if (sale) return;   // ya posteada y sigue contando

  // Construye el asiento de venta desde las LÍNEAS (desglose por tipo de IVA real).
  const items = db.prepare('SELECT total_price AS base, tax_rate, tax_amount FROM invoice_items WHERE invoice_id=?').all(invoiceId);
  let byRate = {};
  for (const it of items) {
    const k = String(Number(it.tax_rate) || 0);
    if (!byRate[k]) byRate[k] = { rate: Number(it.tax_rate) || 0, base: 0, cuota: 0 };
    byRate[k].base += Number(it.base) || 0;
    byRate[k].cuota += Number(it.tax_amount) || 0;
  }
  // Facturas LEGACY (anteriores a la migración A2): las líneas no llevan el desglose de IVA
  // (tax_rate/tax_amount = 0) pero el HEADER sí (subtotal/tax_rate/tax_amount). Mismo criterio
  // que la compra header-only: si las líneas no suman cuota pero el header tiene IVA, uso el
  // header; un solo tipo (el del header, o el efectivo si es banda legal; si no, NULL).
  const itemsCuota = r2(Object.values(byRate).reduce((s, g) => s + g.cuota, 0));
  let saleFlagged = false;
  if (Math.round(itemsCuota * 100) === 0 && Math.round(r2(inv.tax_amount) * 100) !== 0) {
    let rate = Number(inv.tax_rate) || 0;
    if (!rate && r2(inv.subtotal)) {
      const eff = Math.round((r2(inv.tax_amount) / r2(inv.subtotal)) * 100);
      if ([0, 4, 10, 21].includes(eff)) rate = eff; else { rate = null; saleFlagged = true; }
    }
    byRate = { [String(rate)]: { rate, base: r2(inv.subtotal), cuota: r2(inv.tax_amount) } };
  }
  const isTicket = inv.series === 'S';                 // F2 (mostrador, anónima, nace cobrada)
  const isSust   = !!inv.substitutes_invoice_id;       // F3 (hereda el cobro del ticket)
  const revenueAcct = isTicket ? '700' : '705';        // mostrador→mercaderías; resto→servicios (extensible)
  const lines = [];
  let sumBase = 0, sumCuota = 0;
  for (const g of Object.values(byRate)) {
    pushLine(lines, revenueAcct, r2(g.base), 'H', g.rate, 'base');
    pushLine(lines, '477', r2(g.cuota), 'H', g.rate, 'iva');
    sumBase += g.base; sumCuota += g.cuota;
  }
  const irpf = r2(inv.irpf_amount);
  // Comprobación A: el cargo se compone (base + IVA − retención); NUNCA se resta dos veces.
  const cargo = r2(r2(sumBase) + r2(sumCuota) - irpf);
  if (Math.round(cargo * 100) !== Math.round(r2(inv.total) * 100)) {
    throw new Error(`Comprobación A falló en ${inv.invoice_number}: base+IVA−IRPF=${cargo} ≠ total guardado ${r2(inv.total)}`);
  }
  if (isTicket || isSust) {
    // Nace cobrada → tesorería en vez de cliente (ticket: su pago; F3: el pago heredado del ticket).
    const payRow = isSust
      ? db.prepare('SELECT payment_method FROM invoice_payments WHERE invoice_id=? ORDER BY id LIMIT 1').get(inv.substitutes_invoice_id)
      : db.prepare('SELECT payment_method FROM invoice_payments WHERE invoice_id=? ORDER BY id LIMIT 1').get(invoiceId);
    pushLine(lines, treasuryAccount(payRow?.payment_method), r2(inv.total), 'D', null, 'tesoreria');
  } else {
    if (irpf) pushLine(lines, '473', irpf, 'D', null, 'irpf');   // retención soportada reduce el saldo de cliente
    pushLine(lines, '430', r2(inv.total), 'D', null, 'contraparte');
  }
  const entry_type = inv.record_type === 'rectificativa' ? 'rectificativa' : 'venta';
  writeEntry(db, {
    entry_type, origin_type: 'invoice', origin_id: invoiceId, entry_date: inv.issue_date,
    memo: `${inv.document_name || 'Factura'} ${inv.invoice_number}${saleFlagged ? ' [IVA sin desglosar]' : ''}`, lines,
  });
}

// Postea un COBRO de cliente (invoice_payments). Los cobros de TICKETS (serie S) NO se
// postean aparte: su tesorería ya está en el asiento de venta del ticket.
export function postInvoicePayment(db, paymentId) {
  const pay = db.prepare('SELECT * FROM invoice_payments WHERE id=?').get(paymentId);
  if (!pay) return;
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(pay.invoice_id);
  if (!inv) return;
  if (inv.series === 'S') return;   // ticket: cobro ya recogido en su venta (no duplicar tesorería)
  const lines = [];
  pushLine(lines, treasuryAccount(pay.payment_method), r2(pay.amount), 'D', null, 'tesoreria');
  pushLine(lines, '430', r2(pay.amount), 'H', null, 'contraparte');
  writeEntry(db, {
    entry_type: 'cobro', origin_type: 'invoice_payment', origin_id: paymentId, entry_date: pay.paid_date,
    memo: `Cobro de ${inv.invoice_number}`, lines,
  });
}

// ── POSTEO: factura recibida / abono de proveedor (reconcilia UNA factura) ───
export function postSupplierInvoice(db, supplierInvoiceId) {
  const inv = db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(supplierInvoiceId);
  if (!inv) return;
  const counts = countsAsPayable(inv);   // status != 'anulada'
  const existing = db.prepare("SELECT * FROM ledger_entries WHERE origin_type='supplier_invoice' AND origin_id=? AND entry_type IN ('compra_gasto','abono_proveedor')").get(supplierInvoiceId);

  if (!counts) {
    if (existing && !reversalExists(db, 'supplier_invoice', supplierInvoiceId)) {
      reverseExisting(db, existing, 'reversion', `Anulación de la factura recibida ${inv.internal_code || inv.id}`);
    }
    return;
  }
  if (existing) return;

  const isExpense = !!inv.expense_category;
  const baseAcct = isExpense ? expenseAccount(inv.expense_category) : '600';
  const counterAcct = isExpense ? '410' : '400';
  const lines = [];
  const items = db.prepare('SELECT base, tax_rate, cuota FROM supplier_invoice_items WHERE supplier_invoice_id=?').all(supplierInvoiceId);
  let flagged = false;
  if (items.length) {
    // Desglose por tipo desde las líneas (gasto y abono lo tienen).
    const byRate = {};
    for (const it of items) {
      const k = String(Number(it.tax_rate) || 0);
      if (!byRate[k]) byRate[k] = { rate: Number(it.tax_rate) || 0, base: 0, cuota: 0 };
      byRate[k].base += Number(it.base) || 0; byRate[k].cuota += Number(it.cuota) || 0;
    }
    for (const g of Object.values(byRate)) {
      pushLine(lines, baseAcct, r2(g.base), 'D', g.rate, 'base');
      pushLine(lines, '472', r2(g.cuota), 'D', g.rate, 'iva');
    }
  } else {
    // Compra de mercadería SOLO en cabecera (sin líneas): un tipo si el efectivo es banda legal;
    // si no cuadra, base con tipo NULL y marca "IVA sin desglosar" (nunca inventar reparto).
    const base = r2(inv.base), tax = r2(inv.tax);
    let rate = null;
    if (base) {
      const eff = Math.round((tax / base) * 100);
      if ([0, 4, 10, 21].includes(eff)) rate = eff; else flagged = true;
    }
    pushLine(lines, baseAcct, base, 'D', rate, 'base');
    pushLine(lines, '472', tax, 'D', rate, 'iva');
  }
  pushLine(lines, counterAcct, r2(inv.total), 'H', null, 'contraparte');
  const entry_type = r2(inv.total) < 0 ? 'abono_proveedor' : 'compra_gasto';
  writeEntry(db, {
    entry_type, origin_type: 'supplier_invoice', origin_id: supplierInvoiceId, entry_date: inv.invoice_date,
    memo: `${entry_type === 'abono_proveedor' ? 'Abono' : 'Factura'} proveedor ${inv.internal_code || inv.id}${flagged ? ' [IVA sin desglosar]' : ''}`,
    lines,
  });
}

// Postea un PAGO a proveedor (supplier_payments). Reembolso (negativo) se normaliza solo.
export function postSupplierPayment(db, paymentId) {
  const pay = db.prepare('SELECT * FROM supplier_payments WHERE id=?').get(paymentId);
  if (!pay) return;
  const inv = db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(pay.supplier_invoice_id);
  if (!inv) return;
  const counterAcct = inv.expense_category ? '410' : '400';
  const lines = [];
  pushLine(lines, counterAcct, r2(pay.amount), 'D', null, 'contraparte');
  pushLine(lines, treasuryAccount(pay.payment_method), r2(pay.amount), 'H', null, 'tesoreria');
  writeEntry(db, {
    entry_type: 'pago_proveedor', origin_type: 'supplier_payment', origin_id: paymentId, entry_date: pay.paid_date,
    memo: `Pago a proveedor (factura ${inv.internal_code || inv.id})`, lines,
  });
}

// ── BACKFILL / RED DE SEGURIDAD: postea todo documento sin asiento. Re-ejecutable. ──
// Cada post* es idempotente (UNIQUE origin_type+origin_id+entry_type), así que un hook
// fallido se autocorrige en la siguiente pasada. No aborta: recoge errores por documento.
export function backfillLedger(db) {
  ensureLedgerSchema(db);
  const errors = [];
  const run = (label, fn) => { try { fn(); } catch (e) { errors.push(`${label}: ${e.message}`); } };

  for (const r of db.prepare('SELECT id FROM invoices ORDER BY id').all()) run(`invoice#${r.id}`, () => postInvoice(db, r.id));
  for (const r of db.prepare('SELECT id FROM invoice_payments ORDER BY id').all()) run(`invoice_payment#${r.id}`, () => postInvoicePayment(db, r.id));
  for (const r of db.prepare('SELECT id FROM supplier_invoices ORDER BY id').all()) run(`supplier_invoice#${r.id}`, () => postSupplierInvoice(db, r.id));
  for (const r of db.prepare('SELECT id FROM supplier_payments ORDER BY id').all()) run(`supplier_payment#${r.id}`, () => postSupplierPayment(db, r.id));

  const n = db.prepare('SELECT COUNT(*) c FROM ledger_entries').get().c;
  return { entries: n, errors };
}

// ════════════════════════════════════════════════════════════════════════════
// VISTAS — los dos libros registro, derivados del CUADERNO (no de los documentos).
// ════════════════════════════════════════════════════════════════════════════

// Agrega las líneas de un asiento de un origen dado, por cuenta y por tipo de IVA.
function entriesForOrigin(db, originType, entryTypes, from, to) {
  const ph = entryTypes.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT e.id, e.origin_id, e.entry_type, e.entry_date,
            l.account_code, l.debit, l.credit, l.tax_rate, l.line_kind
       FROM ledger_entries e JOIN ledger_lines l ON l.entry_id=e.id
      WHERE e.origin_type=? AND e.entry_type IN (${ph}) AND e.entry_date BETWEEN ? AND ?`
  ).all(originType, ...entryTypes, from, to);
  return rows;
}

// Junta base (line_kind='base') y cuota (line_kind='iva') por tipo de IVA en un solo mapa
// { clave: {rate, base, cuota} }. La clave es el tipo (o 'sd' = IVA sin desglosar, tax_rate NULL).
function addRate(rates, taxRate, base, cuota) {
  const k = (taxRate === null || taxRate === undefined) ? 'sd' : String(taxRate);
  if (!rates[k]) rates[k] = { rate: (taxRate === null || taxRate === undefined) ? null : Number(taxRate), base: 0, cuota: 0 };
  rates[k].base = r2(rates[k].base + base);
  rates[k].cuota = r2(rates[k].cuota + cuota);
}
// Desglose ordenado por tipo (mayor a menor; 'sin desglosar' al final), con base y cuota por tipo.
function desgloseArray(rates) {
  return Object.values(rates)
    .filter(g => Math.round(g.base * 100) !== 0 || Math.round(g.cuota * 100) !== 0)
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
}

// LIBRO DE VENTAS E INGRESOS / facturas expedidas. Una fila por factura con DESGLOSE por
// cada tipo de IVA (base + tipo% + cuota), retención IRPF si la hay, y total. Signed:
// rectificativas/anulaciones netean. Lee NIF/nº/fecha/tipo del documento origen (no recalcula).
export function libroVentas(db, from, to) {
  const rows = entriesForOrigin(db, 'invoice', ['venta', 'rectificativa', 'anulacion_venta', 'reversion'], from, to);
  const byInv = {};
  for (const l of rows) {
    const inv = (byInv[l.origin_id] ||= { invoice_id: l.origin_id, rates: {}, base: 0, cuota: 0, irpf: 0 });
    if (l.account_code === '700' || l.account_code === '705') {
      const signed = r2(l.credit - l.debit);                 // ingreso: haber positivo
      addRate(inv.rates, l.tax_rate, signed, 0);
      inv.base = r2(inv.base + signed);
    } else if (l.account_code === '477') {
      const signed = r2(l.credit - l.debit);
      addRate(inv.rates, l.tax_rate, 0, signed);
      inv.cuota = r2(inv.cuota + signed);
    } else if (l.account_code === '473') {
      inv.irpf = r2(inv.irpf + r2(l.debit - l.credit));       // retención soportada (cargo)
    }
  }
  const out = [];
  let totBase = 0, totCuota = 0, totIrpf = 0;
  for (const inv of Object.values(byInv)) {
    if (Math.round(inv.base * 100) === 0 && Math.round(inv.cuota * 100) === 0) continue;   // anuladas netas → fuera
    const doc = db.prepare('SELECT invoice_number, series, issue_date, client_name, client_fiscal_id, record_type, rectification_type, rectification_mode FROM invoices WHERE id=?').get(inv.invoice_id);
    const vf = db.prepare("SELECT tipo_factura FROM verifactu_registros WHERE invoice_id=? AND record_type='alta' ORDER BY id LIMIT 1").get(inv.invoice_id);
    const fiscalItems = db.prepare('SELECT total_price,tax_rate,tax_amount,fiscal_treatment,fiscal_exemption_code,fiscal_non_subject_code,fiscal_reverse_charge FROM invoice_items WHERE invoice_id=? ORDER BY id').all(inv.invoice_id);
    let desglose = desgloseArray(inv.rates);
    if (fiscalItems.length && fiscalItems.every(i => i.fiscal_treatment && i.fiscal_treatment !== 'pending')) {
      const sign = inv.base < 0 ? -1 : 1, groups = new Map();
      for (const i of fiscalItems) {
        const key = [i.fiscal_treatment,i.fiscal_exemption_code||'',i.fiscal_non_subject_code||'',i.fiscal_reverse_charge||0,i.tax_rate].join('|');
        const g = groups.get(key) || { rate:Number(i.tax_rate)||0,base:0,cuota:0,fiscal_treatment:i.fiscal_treatment,fiscal_exemption_code:i.fiscal_exemption_code,fiscal_non_subject_code:i.fiscal_non_subject_code,fiscal_reverse_charge:i.fiscal_reverse_charge };
        g.base=r2(g.base+Math.abs(Number(i.total_price)||0)*sign); g.cuota=r2(g.cuota+Math.abs(Number(i.tax_amount)||0)*sign); groups.set(key,g);
      }
      desglose=[...groups.values()];
    }
    out.push({
      invoice_number: doc?.invoice_number, series: doc?.series,
      issue_date: doc?.issue_date, operation_date: null,   // el modelo no guarda fecha de operación distinta de la de expedición
      tipo_factura: vf?.tipo_factura || (doc?.series === 'R' ? (doc?.rectification_type || 'R') : doc?.series === 'S' ? 'F2' : 'F1'),
      es_rectificativa: doc?.record_type === 'rectificativa', rect_mode: doc?.rectification_mode || '',
      nif: doc?.client_fiscal_id || '', nombre: doc?.client_name || 'VENTAS A CONSUMIDOR FINAL',
      desglose, base: r2(inv.base), cuota: r2(inv.cuota), irpf: r2(inv.irpf), total: r2(inv.base + inv.cuota),
    });
    totBase = r2(totBase + inv.base); totCuota = r2(totCuota + inv.cuota); totIrpf = r2(totIrpf + inv.irpf);
  }
  out.sort((a, b) => (a.issue_date || '').localeCompare(b.issue_date || '') || (a.invoice_number || '').localeCompare(b.invoice_number || ''));
  out.forEach((r, i) => r.n = i + 1);   // número de anotación (orden en el periodo)
  return { rows: out, totals: { base: totBase, cuota: totCuota, irpf: totIrpf, total: r2(totBase + totCuota) } };
}

// LIBRO DE COMPRAS Y GASTOS / facturas recibidas. Una fila por factura con DESGLOSE por
// cada tipo de IVA soportado (base + tipo% + cuota) y total. (IRPF de compras fuera, por decisión.)
export function libroCompras(db, from, to) {
  const rows = entriesForOrigin(db, 'supplier_invoice', ['compra_gasto', 'abono_proveedor', 'reversion'], from, to);
  const byInv = {};
  const GASTO = new Set(['600', '621', '622', '623', '624', '625', '626', '627', '628', '629']);
  for (const l of rows) {
    const inv = (byInv[l.origin_id] ||= { sid: l.origin_id, rates: {}, base: 0, cuota: 0 });
    const signed = r2(l.debit - l.credit);   // gasto/compra: debe positivo
    if (GASTO.has(l.account_code)) {
      addRate(inv.rates, l.tax_rate, signed, 0);
      inv.base = r2(inv.base + signed);
    } else if (l.account_code === '472') {
      addRate(inv.rates, l.tax_rate, 0, signed);
      inv.cuota = r2(inv.cuota + signed);
    }
  }
  const out = [];
  let totBase = 0, totCuota = 0;
  for (const inv of Object.values(byInv)) {
    if (Math.round(inv.base * 100) === 0 && Math.round(inv.cuota * 100) === 0) continue;
    const doc = db.prepare('SELECT internal_code, supplier_invoice_number, invoice_date, supplier_name, supplier_fiscal_id FROM supplier_invoices WHERE id=?').get(inv.sid);
    out.push({
      internal_code: doc?.internal_code, supplier_number: doc?.supplier_invoice_number || '',
      invoice_date: doc?.invoice_date, operation_date: null,
      nif: doc?.supplier_fiscal_id || '', nombre: doc?.supplier_name || '',
      desglose: desgloseArray(inv.rates), base: r2(inv.base), cuota: r2(inv.cuota), total: r2(inv.base + inv.cuota),
    });
    totBase = r2(totBase + inv.base); totCuota = r2(totCuota + inv.cuota);
  }
  out.sort((a, b) => (a.invoice_date || '').localeCompare(b.invoice_date || '') || (a.internal_code || '').localeCompare(b.internal_code || ''));
  out.forEach((r, i) => r.n = i + 1);   // número de recepción (orden en el periodo)
  return { rows: out, totals: { base: totBase, cuota: totCuota, total: r2(totBase + totCuota) } };
}

// ════════════════════════════════════════════════════════════════════════════
// PIEZA 2 — VISTAS contables clásicas (libro diario / libro mayor), SOLO LECTURA.
// Sacan a la luz los asientos de doble cara que ya existen. No crean ni escriben nada.
// ════════════════════════════════════════════════════════════════════════════

// LIBRO DIARIO — asientos en orden cronológico, cada uno con sus líneas (cuenta + debe/haber).
export function libroDiario(db, from, to) {
  const entries = db.prepare('SELECT * FROM ledger_entries WHERE entry_date BETWEEN ? AND ? ORDER BY entry_date, id').all(from, to);
  const lineStmt = db.prepare(
    `SELECT l.account_code, COALESCE(a.name,'') account_name, l.debit, l.credit, l.tax_rate, l.line_kind
       FROM ledger_lines l LEFT JOIN ledger_accounts a ON a.code=l.account_code WHERE l.entry_id=? ORDER BY l.id`);
  let totDebe = 0, totHaber = 0;
  const rows = entries.map(e => {
    const lines = lineStmt.all(e.id);
    const d = r2(lines.reduce((s, l) => s + l.debit, 0));
    const h = r2(lines.reduce((s, l) => s + l.credit, 0));
    totDebe = r2(totDebe + d); totHaber = r2(totHaber + h);
    return { id: e.id, entry_date: e.entry_date, entry_type: e.entry_type, origin_type: e.origin_type, origin_id: e.origin_id, memo: e.memo, lines, debe: d, haber: h, cuadra: Math.round(d * 100) === Math.round(h * 100) };
  });
  return { rows, totals: { debe: r2(totDebe), haber: r2(totHaber) }, cuadra: Math.round(totDebe * 100) === Math.round(totHaber * 100) };
}

// LIBRO MAYOR — agregado por cuenta PGC: total Debe, Haber y Saldo (debe−haber).
export function libroMayor(db, from, to) {
  const rows = db.prepare(
    `SELECT l.account_code code, COALESCE(a.name,'') name, ROUND(SUM(l.debit),2) debe, ROUND(SUM(l.credit),2) haber
       FROM ledger_lines l JOIN ledger_entries e ON e.id=l.entry_id LEFT JOIN ledger_accounts a ON a.code=l.account_code
      WHERE e.entry_date BETWEEN ? AND ? GROUP BY l.account_code ORDER BY l.account_code`).all(from, to)
    .map(r => ({ ...r, debe: r2(r.debe), haber: r2(r.haber), saldo: r2(r.debe - r.haber) }));
  const totals = { debe: r2(rows.reduce((s, r) => s + r.debe, 0)), haber: r2(rows.reduce((s, r) => s + r.haber, 0)) };
  return { rows, totals };
}

// DRILL-DOWN del mayor — movimientos de UNA cuenta en orden de fecha, con saldo acumulado.
export function mayorCuenta(db, code, from, to) {
  const name = db.prepare('SELECT name FROM ledger_accounts WHERE code=?').get(code)?.name || '';
  const movs = db.prepare(
    `SELECT e.entry_date, e.id entry_id, e.entry_type, e.memo, e.origin_type, e.origin_id, l.debit, l.credit
       FROM ledger_lines l JOIN ledger_entries e ON e.id=l.entry_id
      WHERE l.account_code=? AND e.entry_date BETWEEN ? AND ? ORDER BY e.entry_date, e.id, l.id`).all(code, from, to);
  let saldo = 0;
  const rows = movs.map(m => { saldo = r2(saldo + m.debit - m.credit); return { ...m, saldo }; });
  return { code, name, rows, debe: r2(movs.reduce((s, m) => s + m.debit, 0)), haber: r2(movs.reduce((s, m) => s + m.credit, 0)), saldo };
}
