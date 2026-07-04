// Exportación de los libros registro · Pieza 1 (formato oficial AEAT — "Formato Electrónico
// Común de los Libros Registro de IVA/IRPF", plantilla LSI.xlsx verificada el 2026-06-26).
//
// PRINCIPIO OFICIAL: UN ASIENTO = UNA FILA. Un asiento es una línea base/tipo/cuota; una factura
// con varios tipos ocupa VARIAS filas repitiendo los datos comunes (misma Identificación de la
// Factura). NUNCA se apilan importes en una celda ni se usan bloques de columnas repetidos.
//
// Reglas verificadas contra la plantilla oficial:
//  · "Total Factura" lleva el SUBTOTAL de cada línea (base+cuota de esa línea); la acumulación =
//    total de la factura ("equivalente a consignarlo una sola vez"). NUNCA se le resta el IRPF.
//  · La retención (Tipo/Importe) se anota UNA sola vez por factura (en su primera línea).
//  · Fechas dd/mm/aaaa. "Periodo" = trimestre 1T/2T/3T/4T. "Fecha Operación" vacía si no difiere.
//
// Hojas: EXPEDIDAS_INGRESOS y RECIBIDAS_GASTOS. Las columnas que la plantilla pide y Bamburu no
// tiene se dejan VACÍAS (nunca inventadas) — ver PENDING_COLUMNS.
import { escHtml } from '../../core/escape.js';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const fechaES = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
const trimestre = s => { const m = /^\d{4}-(\d{2})/.exec(s || ''); if (!m) return ''; return Math.ceil(Number(m[1]) / 3) + 'T'; };
const ejercicio = s => (s || '').slice(0, 4);

// ── Aplana un libro (filas por factura con desglose) a ASIENTOS (una fila por tipo) ──
export function ventasAsientos(libro) {
  const out = []; let n = 0;
  for (const r of libro.rows) {
    const d = r.desglose.length ? r.desglose : [{ rate: 0, base: 0, cuota: 0 }];
    d.forEach((g, i) => {
      n++;
      out.push({
        n, primera: i === 0, lineas: d.length,
        invoice_number: r.invoice_number, series: r.series, numero: (r.invoice_number || '').slice((r.series || '').length),
        issue_date: r.issue_date, operation_date: r.operation_date, tipo_factura: r.tipo_factura,
        es_rectificativa: r.es_rectificativa, rect_mode: r.rect_mode, nif: r.nif, nombre: r.nombre,
        rate: g.rate, base: r2(g.base), cuota: r2(g.cuota), total_linea: r2(g.base + g.cuota),
        irpf: i === 0 ? r2(r.irpf) : null,   // retención sólo en la primera línea de la factura
      });
    });
  }
  return out;
}
export function comprasAsientos(libro) {
  const out = []; let n = 0;
  for (const r of libro.rows) {
    const d = r.desglose.length ? r.desglose : [{ rate: 0, base: 0, cuota: 0 }];
    d.forEach((g, i) => {
      n++;
      out.push({
        n, primera: i === 0, lineas: d.length,
        internal_code: r.internal_code, supplier_number: r.supplier_number, invoice_date: r.invoice_date,
        operation_date: r.operation_date, nif: r.nif, nombre: r.nombre,
        rate: g.rate, base: r2(g.base), cuota: r2(g.cuota), total_linea: r2(g.base + g.cuota),
      });
    });
  }
  return out;
}

// ── Cabeceras oficiales EXACTAS (orden de la plantilla LSI.xlsx) ─────────────
const COLS_EXPEDIDAS = ['Ejercicio', 'Periodo', 'Actividad-Código', 'Actividad-Tipo', 'Grupo o Epígrafe del IAE',
  'Tipo de Factura', 'Concepto de Ingreso', 'Ingreso Computable', 'Fecha Expedición', 'Fecha Operación',
  'Serie', 'Número', 'Número-Final', 'NIF Destinatario-Tipo', 'Código País', 'Identificación', 'Nombre Destinatario',
  'Clave de Operación', 'Calificación de la Operación', 'Operación Exenta', 'Total Factura', 'Base Imponible',
  'Tipo de IVA', 'Cuota IVA Repercutida', 'Tipo de Recargo Eq.', 'Cuota Recargo Eq.', 'Cobro-Fecha', 'Cobro-Importe',
  'Cobro-Medio Utilizado', 'Cobro-Identificación Medio', 'Tipo Retención del IRPF', 'Importe Retenido del IRPF',
  'Registro Acuerdo Facturación', 'Inmueble-Situación', 'Referencia Catastral', 'Referencia Externa'];
const COLS_RECIBIDAS = ['Ejercicio', 'Periodo', 'Actividad-Código', 'Actividad-Tipo', 'Grupo o Epígrafe del IAE',
  'Tipo de Factura', 'Concepto de Gasto', 'Gasto Deducible', 'Fecha Expedición', 'Fecha Operación',
  'Identificación Factura Expedidor (Serie-Número)', 'Número-Final', 'Fecha Recepción', 'Número Recepción',
  'Número Recepción Final', 'NIF Expedidor-Tipo', 'Código País', 'Identificación', 'Nombre Expedidor',
  'Clave de Operación', 'Bien de Inversión', 'Inversión del Sujeto Pasivo', 'Deducible en Periodo Posterior',
  'Periodo Deducción-Ejercicio', 'Periodo Deducción-Periodo', 'Total Factura', 'Base Imponible', 'Tipo de IVA',
  'Cuota IVA Soportado', 'Cuota Deducible', 'Tipo de Recargo Eq.', 'Cuota Recargo Eq.', 'Pago-Fecha', 'Pago-Importe',
  'Pago-Medio Utilizado', 'Pago-Identificación Medio', 'Tipo Retención del IRPF', 'Importe Retenido del IRPF',
  'Registro Acuerdo Facturación', 'Inmueble-Situación', 'Referencia Catastral', 'Referencia Externa'];

// Columnas oficiales SIN dato en Bamburu (vacías, NUNCA inventadas) — para reportar/decidir.
export const PENDING_COLUMNS = {
  EXPEDIDAS_INGRESOS: ['Actividad (Código/Tipo/IAE)', 'Concepto de Ingreso', 'Ingreso Computable (IRPF)', 'NIF Destinatario-Tipo', 'Código País', 'Clave de Operación', 'Calificación de la Operación', 'Operación Exenta (E1–E6/N1–N2)', 'Tipo de Recargo Eq. y Cuota', 'Cobro (criterio de caja)', 'Tipo Retención del IRPF (%) — se exporta el importe, no el %', 'Registro Acuerdo Facturación', 'Inmueble / Referencia Catastral', 'Referencia Externa'],
  RECIBIDAS_GASTOS: ['Actividad (Código/Tipo/IAE)', 'Tipo de Factura', 'Concepto de Gasto', 'Gasto Deducible (IRPF)', 'NIF Expedidor-Tipo', 'Código País', 'Clave de Operación', 'Bien de Inversión', 'Inversión del Sujeto Pasivo', 'Deducible en Periodo Posterior / Periodo Deducción', 'Cuota Deducible', 'Tipo y Cuota de Recargo Eq.', 'Pago (criterio de caja)', 'Retención del IRPF', 'Registro Acuerdo Facturación', 'Inmueble / Referencia Catastral', 'Referencia Externa'],
};

// Mapea cada asiento a la fila oficial (mismo nº de celdas que la cabecera; '' = pendiente).
function rowExpedidas(a) {
  const c = new Array(COLS_EXPEDIDAS.length).fill('');
  c[0] = ejercicio(a.issue_date); c[1] = trimestre(a.issue_date);
  c[5] = a.tipo_factura || '';
  c[8] = fechaES(a.issue_date); c[9] = a.operation_date ? fechaES(a.operation_date) : '';
  c[10] = a.series || ''; c[11] = a.numero || '';
  c[15] = a.nif || ''; c[16] = a.nombre || '';
  c[20] = a.total_linea; c[21] = a.base; c[22] = a.rate === null ? '' : a.rate; c[23] = a.cuota;
  if (a.irpf != null && a.irpf !== 0) c[31] = a.irpf;   // Importe Retenido sólo en la 1ª línea
  return c;
}
function rowRecibidas(a) {
  const c = new Array(COLS_RECIBIDAS.length).fill('');
  c[0] = ejercicio(a.invoice_date); c[1] = trimestre(a.invoice_date);
  c[8] = fechaES(a.invoice_date); c[9] = a.operation_date ? fechaES(a.operation_date) : '';
  c[10] = a.supplier_number || ''; c[13] = a.internal_code || '';
  c[17] = a.nif || ''; c[18] = a.nombre || '';
  c[25] = a.total_linea; c[26] = a.base; c[27] = a.rate === null ? '' : a.rate; c[28] = a.cuota;
  return c;
}

export function ventasMatrix(libro) { return { headers: COLS_EXPEDIDAS, rows: ventasAsientos(libro).map(rowExpedidas) }; }
export function comprasMatrix(libro) { return { headers: COLS_RECIBIDAS, rows: comprasAsientos(libro).map(rowRecibidas) }; }

// ── CSV (UTF-8 con BOM, separador ';') ───────────────────────────────────────
export function toCSV(matrix) {
  const esc = v => { if (v === null || v === undefined || v === '') return ''; const s = String(v); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '﻿' + [matrix.headers.map(esc).join(';'), ...matrix.rows.map(r => r.map(esc).join(';'))].join('\r\n');
}

// ════════════════════════════════════════════════════════════════════════════
// XLSX sin dependencias — escritor ZIP (STORE) + CRC32 + OOXML mínimo multi-hoja.
// ════════════════════════════════════════════════════════════════════════════
const CRC_TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF]; return (c ^ -1) >>> 0; }
function zipStore(files) {
  const enc = files.map(f => ({ name: Buffer.from(f.name, 'utf8'), data: Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8') }));
  const chunks = [], central = []; let offset = 0;
  const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n >>> 0); return b; };
  const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
  for (const f of enc) {
    const crc = crc32(f.data), size = f.data.length;
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(size), u32(size), u16(f.name.length), u16(0), f.name]);
    chunks.push(local, f.data);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(size), u32(size), u16(f.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), f.name]));
    offset += local.length + f.data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(enc.length), u16(enc.length), u32(cd.length), u32(offset), u16(0)]);
  return Buffer.concat([...chunks, cd, eocd]);
}
const xesc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function colLetter(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
function sheetXml(matrix) {
  const rowXml = (cells, rn) => '<row r="' + rn + '">' + cells.map((v, ci) => {
    const ref = colLetter(ci) + rn;
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
    if (v === '' || v === null || v === undefined) return `<c r="${ref}"/>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
  }).join('') + '</row>';
  const rows = [rowXml(matrix.headers, 1), ...matrix.rows.map((r, i) => rowXml(r, i + 2))].join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
}
export function buildXlsx(sheets) {
  const files = [];
  files.push({ name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>` });
  files.push({ name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` });
  files.push({ name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((s, i) => `<sheet name="${xesc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` });
  files.push({ name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}</Relationships>` });
  sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.matrix) }));
  return zipStore(files);
}

// ── PDF de gestoría (HTML legible, una fila por asiento, columnas esenciales) ─
export function libroHtml(titulo, periodo, asientos, totals, sym, kind) {
  const esVentas = kind === 'ventas';
  const head = esVentas
    ? '<tr><th>Factura</th><th>F. exped.</th><th>F. oper.</th><th>Tipo</th><th>NIF</th><th>Destinatario</th><th>Base</th><th>Tipo IVA</th><th>Cuota</th><th>Retención</th><th>Total línea</th></tr>'
    : '<tr><th>Nº recepción</th><th>Nº fra. prov.</th><th>F. exped.</th><th>F. oper.</th><th>NIF</th><th>Expedidor</th><th>Base</th><th>Tipo IVA</th><th>Cuota</th><th>Total línea</th></tr>';
  const rate = r => r === null ? 'sin desglosar' : (Number(r) === 0 ? '0% (exento)' : r + '%');
  const m = n => sym + Number(n || 0).toFixed(2);
  const rows = asientos.map(a => esVentas
    ? `<tr><td>${escHtml(a.invoice_number)}${a.es_rectificativa ? ' (R' + (a.rect_mode ? '·' + a.rect_mode : '') + ')' : ''}</td><td>${escHtml(a.issue_date || '')}</td><td>${a.operation_date ? escHtml(a.operation_date) : '—'}</td><td>${escHtml(a.tipo_factura || '')}</td><td>${escHtml(a.nif || '')}</td><td>${escHtml(a.nombre || '')}</td><td>${m(a.base)}</td><td>${rate(a.rate)}</td><td>${m(a.cuota)}</td><td>${a.irpf != null && a.irpf !== 0 ? m(a.irpf) : ''}</td><td>${m(a.total_linea)}</td></tr>`
    : `<tr><td>${escHtml(a.internal_code || '')}</td><td>${escHtml(a.supplier_number || '')}</td><td>${escHtml(a.invoice_date || '')}</td><td>${a.operation_date ? escHtml(a.operation_date) : '—'}</td><td>${escHtml(a.nif || '')}</td><td>${escHtml(a.nombre || '')}</td><td>${m(a.base)}</td><td>${rate(a.rate)}</td><td>${m(a.cuota)}</td><td>${m(a.total_linea)}</td></tr>`).join('');
  const cols = esVentas ? 11 : 10;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:-apple-system,Segoe UI,sans-serif;font-size:10px;color:#111}h1{font-size:15px;margin:0 0 2px}.sub{color:#555;margin-bottom:8px}
    table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:2px 4px;text-align:right}th{background:#eee;text-align:center}td:nth-child(-n+6){text-align:left}
    .tot{font-weight:700;background:#fafafa}</style></head><body>
    <h1>${escHtml(titulo)}</h1><div class="sub">Periodo ${escHtml(periodo)} · un asiento por línea (formato AEAT) · copia para gestoría</div>
    <table><thead>${head}</thead><tbody>${rows || `<tr><td colspan="${cols}">Sin operaciones</td></tr>`}</tbody>
    <tfoot><tr class="tot"><td colspan="6" style="text-align:right">TOTALES</td><td>${m(totals.base)}</td><td></td><td>${m(totals.cuota)}</td>${esVentas ? '<td></td>' : ''}<td>${m(totals.total)}</td></tr></tfoot></table></body></html>`;
}

// ── PIEZA 2 — Export del LIBRO DIARIO y el LIBRO MAYOR (formato propio limpio) ──
const numOrBlank = n => (Math.round((Number(n) || 0) * 100) === 0 ? '' : r2(n));

// DIARIO: una fila por línea de asiento (Fecha · Asiento · Tipo · Concepto · Cuenta · Debe · Haber).
export function diarioMatrix(diario) {
  const headers = ['Fecha', 'Asiento', 'Tipo', 'Concepto', 'Cuenta', 'Nombre de la cuenta', 'Debe', 'Haber'];
  const rows = [];
  for (const a of diario.rows) for (const l of a.lines)
    rows.push([fechaES(a.entry_date), a.id, a.entry_type, a.memo || '', l.account_code, l.account_name || '', numOrBlank(l.debit), numOrBlank(l.credit)]);
  return { headers, rows };
}
// MAYOR: una fila por cuenta (Cuenta · Nombre · Debe · Haber · Saldo).
export function mayorMatrix(mayor) {
  return {
    headers: ['Cuenta', 'Nombre de la cuenta', 'Debe', 'Haber', 'Saldo'],
    rows: mayor.rows.map(r => [r.code, r.name || '', r2(r.debe), r2(r.haber), r2(r.saldo)]),
  };
}

export function diarioHtml(periodo, diario, sym) {
  const m = n => sym + Number(n || 0).toFixed(2);
  const bloques = diario.rows.map(a => {
    const ls = a.lines.map(l => `<tr><td>${escHtml(l.account_code)}</td><td>${escHtml(l.account_name || '')}</td><td style="text-align:right">${l.debit ? m(l.debit) : ''}</td><td style="text-align:right">${l.credit ? m(l.credit) : ''}</td></tr>`).join('');
    return `<tr class="hd"><td colspan="4"><b>${escHtml(a.entry_date)}</b> · asiento ${a.id} · ${escHtml(a.entry_type)} — ${escHtml(a.memo || '')}</td></tr>${ls}`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,Segoe UI,sans-serif;font-size:10px;color:#111}h1{font-size:15px;margin:0 0 2px}.sub{color:#555;margin-bottom:8px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:2px 5px}.hd td{background:#eef;font-weight:600}.tot{font-weight:700;background:#fafafa}</style></head><body>
    <h1>Libro Diario</h1><div class="sub">Periodo ${escHtml(periodo)} · asientos de doble cara</div>
    <table><thead><tr><th>Cuenta</th><th>Nombre</th><th>Debe</th><th>Haber</th></tr></thead><tbody>${bloques}</tbody>
    <tfoot><tr class="tot"><td colspan="2" style="text-align:right">TOTALES</td><td style="text-align:right">${m(diario.totals.debe)}</td><td style="text-align:right">${m(diario.totals.haber)}</td></tr></tfoot></table></body></html>`;
}
export function mayorHtml(periodo, mayor, sym) {
  const m = n => sym + Number(n || 0).toFixed(2);
  const rows = mayor.rows.map(r => `<tr><td>${escHtml(r.code)}</td><td>${escHtml(r.name || '')}</td><td style="text-align:right">${m(r.debe)}</td><td style="text-align:right">${m(r.haber)}</td><td style="text-align:right">${m(r.saldo)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,Segoe UI,sans-serif;font-size:10px;color:#111}h1{font-size:15px;margin:0 0 2px}.sub{color:#555;margin-bottom:8px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:2px 5px;text-align:right}th{background:#eee}td:nth-child(-n+2){text-align:left}.tot{font-weight:700;background:#fafafa}</style></head><body>
    <h1>Libro Mayor</h1><div class="sub">Periodo ${escHtml(periodo)} · saldos por cuenta</div>
    <table><thead><tr><th>Cuenta</th><th>Nombre</th><th>Debe</th><th>Haber</th><th>Saldo</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr class="tot"><td colspan="2" style="text-align:right">TOTALES</td><td>${m(mayor.totals.debe)}</td><td>${m(mayor.totals.haber)}</td><td>${m(r2(mayor.totals.debe - mayor.totals.haber))}</td></tr></tfoot></table></body></html>`;
}

// ── PIEZA 3 — Export del LIBRO DE BIENES DE INVERSIÓN (columnas oficiales AEAT) ──
// Orden/nombres de la hoja BIENES-INVERSIÓN de la plantilla LSI.xlsx (verificada 2026-06-26).
// Columnas que la plantilla pide y Bamburu no tiene → vacías (nunca inventadas): ver PENDING.
const COLS_BIENES = ['Ejercicio', 'Periodo', 'Actividad-Código', 'Actividad-Tipo', 'Grupo o Epígrafe del IAE',
  'Tipo de Bien', 'Descripción del Bien-Identificador', 'Descripción del Bien-Literal', 'Fecha Inicio Utilización',
  'Valor Adquisición', 'Valor Amortizable', 'Método de Amortización', 'Porcentaje de Amortización',
  'Amortización Acumulada al Inicio', 'Cuota Resultante', 'Acumulada al Final', 'Pendiente',
  'Fecha Expedición', 'Identificación Factura Expedidor (Serie-Número)', 'Número-Final', 'Número Recepción',
  'Número Recepción Final', 'NIF Expedidor-Tipo', 'Código País', 'Identificación', 'Nombre Expedidor',
  'Año Inicio-Base Imponible', 'Tipo de IVA', 'Prorrata Definitiva', 'Cuota Deducible',
  'Regularización-Prorrata Definitiva', 'Regularización-Cuota Deducible', 'Cuota a Regularizar',
  'Baja del Bien-Fecha', 'Baja del Bien-Causa', 'Transmisión-Serie', 'Transmisión-Número',
  'Transmisión-Número-Final', 'Registro Acuerdo Facturación', 'Referencia Externa'];

PENDING_COLUMNS.BIENES_INVERSION = ['Periodo', 'Actividad (Código/Tipo/IAE)', 'Tipo de Bien', 'Descripción-Identificador (código)', 'Fecha Expedición', 'NIF Expedidor-Tipo', 'Código País', 'Regularización del IVA (prorrata, cuota deducible, regularización anual)', 'Transmisión del bien (serie/número)', 'Registro Acuerdo Facturación', 'Referencia Externa'];

export function bienesMatrix(libro, from, to) {
  // Ejercicio: solo si el periodo cae en un único año natural; un rango que cruza el año no tiene
  // un ejercicio único y se deja vacío (nunca inventado).
  const ej = (from || '').slice(0, 4) === (to || '').slice(0, 4) ? (to || '').slice(0, 4) : '';
  const rows = libro.rows.map(g => {
    const c = new Array(COLS_BIENES.length).fill('');
    c[0] = ej;                                  // Ejercicio
    c[7] = g.description || '';                 // Descripción (literal)
    c[8] = fechaES(g.start_date);               // Fecha Inicio Utilización
    c[9] = r2(g.acquisition_value); c[10] = r2(g.amortizable_base);
    c[11] = 'LINEAL'; c[12] = r2(g.annual_rate);
    c[13] = r2(g.acuInicio); c[14] = r2(g.cuota); c[15] = r2(g.acuFinal); c[16] = r2(g.pendiente);
    c[18] = g.doc_number || '';                 // Identificación Factura del Expedidor
    c[24] = g.supplier_fiscal_id || '';         // Identificación (NIF)
    c[25] = g.supplier_name || '';              // Nombre Expedidor
    c[33] = g.baja_date ? fechaES(g.baja_date) : '';
    c[34] = g.baja_date ? (g.baja_motivo || '') : '';   // motivo solo con baja vigente (reactivar lo conserva como rastro)
    return c;
  });
  return { headers: COLS_BIENES, rows };
}

export function bienesHtml(periodo, libro, sym) {
  const m = n => sym + Number(n || 0).toFixed(2);
  const rows = libro.rows.map(g => `<tr>
      <td>${escHtml(g.description || '')}${g.de_baja ? ' <b>(baja ' + escHtml(g.baja_date) + ')</b>' : ''}</td>
      <td>${escHtml(g.doc_number || '')}</td><td>${escHtml(g.supplier_name || '')}</td><td>${escHtml(g.supplier_fiscal_id || '')}</td>
      <td>${escHtml(g.start_date || '')}</td><td style="text-align:right">${m(g.acquisition_value)}</td><td style="text-align:right">${m(g.amortizable_base)}</td>
      <td style="text-align:right">${Number(g.annual_rate)}%</td><td style="text-align:right">${m(g.acuInicio)}</td><td style="text-align:right">${m(g.cuota)}</td>
      <td style="text-align:right">${m(g.acuFinal)}</td><td style="text-align:right">${m(g.pendiente)}</td></tr>`).join('')
    || '<tr><td colspan="12" style="text-align:center">Sin bienes registrados</td></tr>';
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,Segoe UI,sans-serif;font-size:10px;color:#111}h1{font-size:15px;margin:0 0 2px}.sub{color:#555;margin-bottom:8px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:2px 4px;text-align:right}th{background:#eee;text-align:center}td:nth-child(-n+5){text-align:left}.tot{font-weight:700;background:#fafafa}</style></head><body>
    <h1>Libro registro de bienes de inversión</h1><div class="sub">Periodo ${escHtml(periodo)} · amortización lineal</div>
    <table><thead><tr><th>Descripción</th><th>Documento</th><th>Proveedor</th><th>NIF</th><th>Puesta func.</th><th>V. adquisición</th><th>V. amortizable</th><th>% anual</th><th>Acum. inicio</th><th>Cuota periodo</th><th>Acum. final</th><th>Pendiente</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr class="tot"><td colspan="5" style="text-align:right">TOTALES</td><td>${m(libro.totals.adquisicion)}</td><td>${m(libro.totals.amortizable)}</td><td></td><td></td><td>${m(libro.totals.cuota)}</td><td>${m(libro.totals.acumulada)}</td><td>${m(libro.totals.pendiente)}</td></tr></tfoot></table></body></html>`;
}
