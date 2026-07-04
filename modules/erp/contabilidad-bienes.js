// CONTABILIDAD · Pieza 3 — Libro registro de BIENES DE INVERSIÓN + amortización (solo el libro;
// NO se vuelca al diario en esta pieza). Requisitos verificados contra Orden HAC/773/2019 (art. 4)
// y la plantilla oficial AEAT (LSI.xlsx, hoja BIENES-INVERSIÓN), 2026-06-26.
//
// DATO NUEVO (qué se capitaliza y con qué parámetros) → tabla propia `investment_goods` (aditiva,
// idempotente; NO entra en WRITABLE_TABLES: DISA no escribe aquí). La amortización se calcula EN
// LECTURA (como el mayor): cuota lineal por % anual, prorrateada por días, con tope = valor
// amortizable y corte en la fecha de baja. Método único: LINEAL.
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const daysBetween = (a, b) => Math.floor((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
const dayBefore = d => { const t = Date.parse(d + 'T00:00:00Z') - 86400000; return new Date(t).toISOString().slice(0, 10); };
const daysInYear = y => ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 366 : 365;

// Crea la tabla del libro de bienes de inversión (idempotente). Llamada desde runMigrations.
export function ensureBienesSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS investment_goods (
      id INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      purchase_id INTEGER,                 -- enlace opcional a purchases (de ahí proveedor/doc/valor)
      doc_number TEXT DEFAULT '',          -- nº de factura / documento / recepción
      supplier_name TEXT DEFAULT '',
      supplier_fiscal_id TEXT DEFAULT '',
      acquisition_value REAL NOT NULL DEFAULT 0,
      amortizable_base REAL NOT NULL DEFAULT 0,   -- por defecto = valor de adquisición
      method TEXT NOT NULL DEFAULT 'lineal',      -- solo LINEAL en esta pieza
      annual_rate REAL NOT NULL DEFAULT 0,        -- % de amortización anual
      start_date DATE NOT NULL,                   -- fecha de puesta en funcionamiento (inicio amort.)
      baja_date DATE,                             -- baja (corta la amortización a partir de aquí)
      baja_motivo TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_investment_goods_start ON investment_goods(start_date);
  `);
}

// ── Amortización acumulada (lineal, prorrateada por días) hasta una fecha dada ──
// Respeta la puesta en funcionamiento (nada antes de start_date), corta en baja_date,
// y nunca supera el valor amortizable (tope).
export function acumuladaHasta(g, date) {
  const start = g.start_date;
  if (!date || !start || date < start) return 0;
  const cap = r2(g.amortizable_base);
  const end = (g.baja_date && g.baja_date < date) ? g.baja_date : date;   // la baja detiene la amortización
  const quota = cap * (Number(g.annual_rate) || 0) / 100;                 // cuota anual nominal
  // Prorrateo por días DENTRO de cada año natural (extremos incluidos), dividiendo por los días
  // reales de ese año: un año natural completo devenga EXACTAMENTE la cuota anual, también en bisiestos.
  let acc = 0;
  for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) {
    const segStart = start > `${y}-01-01` ? start : `${y}-01-01`;
    const segEnd = end < `${y}-12-31` ? end : `${y}-12-31`;
    acc += quota * (daysBetween(segEnd, segStart) + 1) / daysInYear(y);
  }
  return Math.min(cap, r2(acc));
}

// Amortización de UN bien para el periodo [from, to]: acumulada al inicio, cuota del periodo,
// acumulada al final y pendiente. (Columnas oficiales del bloque "Amortización".)
export function amortizacionPeriodo(g, from, to) {
  const acuInicio = acumuladaHasta(g, dayBefore(from));   // amortizado ANTES del periodo
  const acuFinal = acumuladaHasta(g, to);
  const cuota = r2(acuFinal - acuInicio);
  const pendiente = r2(r2(g.amortizable_base) - acuFinal);
  return { acuInicio: r2(acuInicio), cuota, acuFinal: r2(acuFinal), pendiente };
}

// ── Lectura del libro: todos los bienes con su amortización en el periodo ──
export function libroBienes(db, from, to) {
  // Solo bienes ya en funcionamiento dentro del periodo: los puestos en marcha después de `to`
  // no pertenecen a este ejercicio (ni a sus TOTALES).
  const goods = db.prepare('SELECT * FROM investment_goods WHERE start_date <= ? ORDER BY start_date, id').all(to);
  let totAdq = 0, totAmort = 0, totCuota = 0, totAcum = 0, totPend = 0;
  const rows = goods.map(g => {
    const am = amortizacionPeriodo(g, from, to);
    totAdq = r2(totAdq + g.acquisition_value); totAmort = r2(totAmort + g.amortizable_base);
    totCuota = r2(totCuota + am.cuota); totAcum = r2(totAcum + am.acuFinal); totPend = r2(totPend + am.pendiente);
    return { ...g, ...am, de_baja: !!g.baja_date };
  });
  return { rows, totals: { adquisicion: totAdq, amortizable: totAmort, cuota: totCuota, acumulada: totAcum, pendiente: totPend } };
}

// ── Servicios de escritura (única vía; las usa el endpoint con requirePerm + CSRF) ──
function validateGood(d) {
  const description = String(d.description || '').trim();
  if (!description) { const e = new Error('La descripción del bien es obligatoria'); e.status = 400; throw e; }
  const start_date = String(d.start_date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date)) { const e = new Error('Fecha de puesta en funcionamiento inválida (YYYY-MM-DD)'); e.status = 400; throw e; }
  const acquisition_value = r2(d.acquisition_value);
  if (!(acquisition_value > 0)) { const e = new Error('El valor de adquisición debe ser mayor que 0'); e.status = 400; throw e; }
  const amortizable_base = d.amortizable_base != null && d.amortizable_base !== '' ? r2(d.amortizable_base) : acquisition_value;
  if (!(amortizable_base > 0)) { const e = new Error('El valor amortizable debe ser mayor que 0'); e.status = 400; throw e; }
  const annual_rate = r2(d.annual_rate);
  if (!(annual_rate >= 0 && annual_rate <= 100)) { const e = new Error('El porcentaje de amortización debe estar entre 0 y 100'); e.status = 400; throw e; }
  return { description, start_date, acquisition_value, amortizable_base, annual_rate };
}

// Trae proveedor/NIF/nº de documento/valor de una compra existente (purchases + suppliers).
function fromPurchase(db, purchaseId) {
  const p = db.prepare('SELECT * FROM purchases WHERE id=?').get(purchaseId);
  if (!p) { const e = new Error('Compra no encontrada'); e.status = 404; throw e; }
  const s = db.prepare('SELECT name, fiscal_id FROM suppliers WHERE id=?').get(p.supplier_id) || {};
  return { doc_number: p.reference || ('#' + p.id), supplier_name: s.name || '', supplier_fiscal_id: s.fiscal_id || '', value: r2(p.total) };
}

export function createInvestmentGood(db, d) {
  let { doc_number = '', supplier_name = '', supplier_fiscal_id = '', acquisition_value } = d;
  let purchase_id = d.purchase_id ? Number(d.purchase_id) : null;
  if (purchase_id) {
    // Antes de validar: la compra enlazada aporta proveedor/NIF/nº y, si no se teclea, el valor.
    const fp = fromPurchase(db, purchase_id);
    doc_number = doc_number || fp.doc_number; supplier_name = supplier_name || fp.supplier_name; supplier_fiscal_id = supplier_fiscal_id || fp.supplier_fiscal_id;
    if (acquisition_value == null || acquisition_value === '') acquisition_value = fp.value;
  }
  const v = validateGood({ ...d, acquisition_value });
  const r = db.prepare(`INSERT INTO investment_goods
      (description, purchase_id, doc_number, supplier_name, supplier_fiscal_id, acquisition_value, amortizable_base, method, annual_rate, start_date)
      VALUES (?,?,?,?,?,?,?, 'lineal', ?, ?)`)
    .run(v.description, purchase_id, String(doc_number || ''), String(supplier_name || ''), String(supplier_fiscal_id || ''),
         v.acquisition_value, v.amortizable_base, v.annual_rate, v.start_date);
  return { id: r.lastInsertRowid };
}

export function updateInvestmentGood(db, id, d) {
  const g = db.prepare('SELECT * FROM investment_goods WHERE id=?').get(id);
  if (!g) { const e = new Error('Bien no encontrado'); e.status = 404; throw e; }
  const v = validateGood({ ...g, ...d });
  if (g.baja_date && g.baja_date < v.start_date) { const e = new Error('La puesta en funcionamiento no puede ser posterior a la fecha de baja registrada'); e.status = 400; throw e; }
  db.prepare(`UPDATE investment_goods SET description=?, doc_number=?, supplier_name=?, supplier_fiscal_id=?,
      acquisition_value=?, amortizable_base=?, annual_rate=?, start_date=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(v.description, String(d.doc_number ?? g.doc_number ?? ''), String(d.supplier_name ?? g.supplier_name ?? ''),
         String(d.supplier_fiscal_id ?? g.supplier_fiscal_id ?? ''), v.acquisition_value, v.amortizable_base, v.annual_rate, v.start_date, id);
  return { id };
}

// Baja del bien (fecha + motivo). No borra: marca la baja (la amortización se corta en esa fecha).
export function bajaInvestmentGood(db, id, baja_date, motivo) {
  const g = db.prepare('SELECT * FROM investment_goods WHERE id=?').get(id);
  if (!g) { const e = new Error('Bien no encontrado'); e.status = 404; throw e; }
  const bd = String(baja_date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bd)) { const e = new Error('Fecha de baja inválida (YYYY-MM-DD)'); e.status = 400; throw e; }
  if (bd < g.start_date) { const e = new Error('La fecha de baja no puede ser anterior a la puesta en funcionamiento'); e.status = 400; throw e; }
  const m = String(motivo || '').trim();
  if (!m) { const e = new Error('Indica el motivo de la baja'); e.status = 400; throw e; }
  db.prepare('UPDATE investment_goods SET baja_date=?, baja_motivo=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(bd, m, id);
  return { id, baja_date: bd };
}
// Deshace la baja (por si se marca por error). Reactiva la amortización. Conserva baja_motivo
// como rastro (el libro solo lo muestra cuando hay baja_date; una baja posterior lo sobrescribe).
export function reactivarInvestmentGood(db, id) {
  const g = db.prepare('SELECT id FROM investment_goods WHERE id=?').get(id);
  if (!g) { const e = new Error('Bien no encontrado'); e.status = 404; throw e; }
  db.prepare('UPDATE investment_goods SET baja_date=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);
  return { id };
}
