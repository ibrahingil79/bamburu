// Rutas de Contabilidad · Pieza 1 — libros registro en UNA entrada de menú con dos PESTAÑAS
// (Ventas e ingresos / Compras y gastos). Formato oficial AEAT: UN ASIENTO = UNA FILA (una línea
// por tipo de IVA; multi-tipo = varias filas con la misma identificación de factura). Misma lógica
// en pantalla, PDF y export. Descarga real XLSX/CSV/PDF (Content-Disposition). Aditivo.
import { Hono } from 'hono';
import { requirePerm } from '../../../core/auth.js';
import { adminLayout, rowMenu, emptyRow, errorShell, cleanErrMsg } from '../layout.js';
import { escHtml } from '../../../core/escape.js';
import { renderPdfFromHtml } from '../../../core/pdf.js';
import { papelDeListado, botonesListado, JS_LISTADO_ENVIAR } from './listados.js';

// De la clave que usa esta pantalla a la del registro de listados. Se escribe UNA vez: las rutas de
// los tres verbos son genéricas y no saben de contabilidad.
const CLAVE_LISTADO = { ventas: 'libro-ventas', compras: 'libro-compras', diario: 'libro-diario',
                        mayor: 'libro-mayor', bienes: 'libro-bienes', pyg: 'pyg', modelos: 'modelos' };
import { pieDePagina as pieDeListado } from '../impresion.js';
import { backfillLedger, libroVentas, libroCompras, libroDiario, libroMayor, mayorCuenta } from '../contabilidad.js';
import { ventasAsientos, comprasAsientos, ventasMatrix, comprasMatrix, toCSV, buildXlsx, diarioMatrix, mayorMatrix, bienesMatrix, pygMatrix } from '../contabilidad-export.js';
import { libroBienes, createInvestmentGood, updateInvestmentGood, bajaInvestmentGood, reactivarInvestmentGood } from '../contabilidad-bienes.js';
import { modelo303, modelo130, filas303, filas130, quarterRange } from '../contabilidad-modelos.js';
import { cuentaPyG, filasPyG } from '../contabilidad-pyg.js';
import { fechaEs } from '../voz.js';   // la fecha, en cristiano
import { fmtEur as dineroEs } from '../margen.js';   // el dinero, como en España
import { fmtEur } from '../margen.js';   // el dinero, escrito como en España

function defaultRange(db) {
  const y = (db.prepare('SELECT MAX(issue_date) m FROM invoices').get()?.m || '').slice(0, 4) || String(new Date().getFullYear());
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}
const symbolOf = db => db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
// El dinero, escrito como en España (117.087,43 €). Una sola forma en todo el producto: fmtEur.
const money = (sym, n) => fmtEur(Number(n || 0), sym);
const rateLabel = r => (r === null || r === undefined) ? 'sin desglosar' : (Number(r) === 0 ? '0% (exento)' : `${r}%`);
const rangeOf = (c, db) => { const d = defaultRange(db); return { from: c.req.query('from') || d.from, to: c.req.query('to') || d.to }; };

// Navegación en DOS niveles (reagrupación 7→3, SOLO presentación; cada vista sigue en su ruta,
// con su gateo y sus exports intactos). Nivel 1 = 3 pestañas ficha; nivel 2 = pestañas ficha
// también (2ª fila), solo dentro de "Libros oficiales".
//   · Libros oficiales → ventas · compras · diario · mayor · bienes
//   · Impuestos        → modelos (303/130)
//   · Resultados       → pérdidas y ganancias  [sitio previsto para el futuro Balance]
const LIBROS_OFICIALES = [
  ['ventas', 'Ventas e ingresos'],
  ['compras', 'Compras y gastos'],
  ['diario', 'Libro diario'],
  ['mayor', 'Libro mayor'],
  ['bienes', 'Bienes de inversión'],
];
const grupoDe = active => active === 'modelos' ? 'impuestos' : (active === 'pyg' ? 'resultados' : 'libros');
function tabsBar(active, from, to) {
  const q = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const grupo = grupoDe(active);
  const top = (key, href, label) => `<a href="${href}" class="tab${grupo === key ? ' active' : ''}">${label}</a>`;
  const nivel1 = `<div class="tabs">
    ${top('libros', `/admin/contabilidad/ventas${q}`, 'Libros oficiales')}
    ${top('impuestos', '/admin/contabilidad/modelos', 'Impuestos')}
    ${top('resultados', `/admin/contabilidad/pyg${q}`, 'Resultados')}</div>`;
  if (grupo !== 'libros') return nivel1;
  const sub = LIBROS_OFICIALES.map(([key, label]) =>
    `<a href="/admin/contabilidad/${key}${q}" class="tab${active === key ? ' active' : ''}">${label}</a>`).join('');
  return `${nivel1}<div class="tabs">${sub}</div>`;
}
// Selector de ejercicio + trimestre para la pestaña Modelos (usa year/q, no from/to).
function modelosPeriodForm(year, q) {
  const opt = (v, label) => `<option value="${v}" ${Number(q) === v ? 'selected' : ''}>${label}</option>`;
  return `<form method="get" action="/admin/contabilidad/modelos" style="display:flex;gap:.75rem;align-items:end;flex-wrap:wrap;margin-bottom:1rem">
    <div><label class="doc-label">Ejercicio</label><br><input type="number" name="year" value="${escHtml(String(year))}" style="width:6rem"></div>
    <div><label class="doc-label">Trimestre</label><br><select name="q">${opt(1, '1T (ene–mar)')}${opt(2, '2T (abr–jun)')}${opt(3, '3T (jul–sep)')}${opt(4, '4T (oct–dic)')}</select></div>
    <button class="btn" type="submit">Ver periodo</button>
    <span style="flex:1"></span>
    <a class="btn btn-ghost" href="/admin/contabilidad/modelos.pdf?year=${year}&q=${q}">PDF (borrador)</a>
    <!-- C9 · los tres verbos también en los borradores de modelos, que tienen su propia barra. -->
    ${botonesListado('modelos', 'anio=' + year + '&trimestre=' + q)}
    <script>${JS_LISTADO_ENVIAR}<\/script>
    <a class="btn btn-ghost" href="/admin/contabilidad/modelos.csv?year=${year}&q=${q}">CSV</a>
  </form>`;
}
// Renderiza un modelo como tabla casilla·descripción·importe. Las filas separadoras (casilla '—')
// son subtítulos; casilla 65 se muestra como porcentaje.
function modeloTabla(filas, sym) {
  const fmt = (casilla, imp) => imp === '' ? '' : (casilla === '65' ? `${Number(imp)} %` : money(sym, imp));
  const body = filas.map(([casilla, desc, imp]) => casilla === '—'
    ? `<tr style="background:var(--bg2)"><td colspan="3" style="font-weight:600">${escHtml(desc)}</td></tr>`
    : `<tr><td style="width:4rem;color:var(--text2)">${escHtml(casilla)}</td><td>${escHtml(desc)}</td>
        <td style="text-align:right;white-space:nowrap">${fmt(casilla, imp)}</td></tr>`).join('');
  return `<table><thead><tr><th style="width:4rem">Casilla</th><th>Concepto</th><th style="text-align:right">Importe</th></tr></thead><tbody>${body}</tbody></table>`;
}
function avisosBox(warnings) {
  if (!warnings || !warnings.length) return '';
  return `<div style="margin:.5rem 0;padding:.5rem .75rem;border-left:3px solid var(--warn);background:var(--warn-s);font-size:12px;color:var(--warn)">
    <b>Antes de presentar, revisa:</b><ul style="margin:.3rem 0 0;padding-left:1.1rem">${warnings.map(w => `<li>${escHtml(w)}</li>`).join('')}</ul></div>`;
}
function periodForm(kind, from, to) {
  const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  return `<form method="get" action="/admin/contabilidad/${kind}" style="display:flex;gap:.75rem;align-items:end;flex-wrap:wrap;margin-bottom:1rem">
    <div><label class="doc-label">Desde</label><br><input type="date" name="from" value="${escHtml(from)}"></div>
    <div><label class="doc-label">Hasta</label><br><input type="date" name="to" value="${escHtml(to)}"></div>
    <button class="btn" type="submit">Ver periodo</button>
    <span style="flex:1"></span>
    ${rowMenu([
      { label: 'Excel (XLSX) · archivo oficial', href: `/admin/contabilidad/${kind}.xlsx?${q}` },
      { label: 'CSV · archivo oficial', href: `/admin/contabilidad/${kind}.csv?${q}` },
      { label: 'PDF', href: `/admin/contabilidad/${kind}.pdf?${q}` },
    ], { label: 'Exportar' })}
    <!-- C9 · LOS TRES VERBOS también aquí. Hasta hoy un libro solo se podía DESCARGAR: no había
         forma de mandárselo a la gestoría sin bajarlo y adjuntarlo a mano. -->
    ${botonesListado(CLAVE_LISTADO[kind] || kind, q.replace('from=', 'desde=').replace('to=', 'hasta='))}
    <script>${JS_LISTADO_ENVIAR}<\/script>
  </form>`;
}

function ventasTable(libro, sym) {
  const head = `<tr><th>Factura</th><th>F. exped.</th><th>F. oper.</th><th>Tipo</th><th>NIF</th><th>Destinatario</th>
    <th style="text-align:right">Base</th><th style="text-align:right">Tipo IVA</th><th style="text-align:right">Cuota IVA</th>
    <th style="text-align:right">Retención IRPF</th><th style="text-align:right">Total línea</th></tr>`;
  const body = ventasAsientos(libro).map(a => {
    const badge = a.es_rectificativa ? ` <span title="Rectificativa" style="background:var(--warn-s);color:var(--warn);border-radius:4px;padding:0 4px;font-size:10px">R${a.rect_mode ? '·' + a.rect_mode : ''}</span>` : '';
    return `<tr><td>${escHtml(a.invoice_number || '')}${badge}</td><td>${a.issue_date ? fechaEs(a.issue_date) : ''}</td><td>${a.operation_date ? fechaEs(a.operation_date) : '—'}</td>
      <td>${escHtml(a.tipo_factura || '')}</td><td>${escHtml(a.nif || '')}</td><td>${escHtml(a.nombre || '')}</td>
      <td style="text-align:right">${money(sym, a.base)}</td><td style="text-align:right">${rateLabel(a.rate)}</td><td style="text-align:right">${money(sym, a.cuota)}</td>
      <td style="text-align:right">${a.irpf != null && a.irpf !== 0 ? money(sym, a.irpf) : ''}</td><td style="text-align:right">${money(sym, a.total_linea)}</td></tr>`;
  }).join('') || emptyRow(11, 'No hay operaciones en este periodo. Cambia las fechas o emite tu primera factura.');
  const foot = `<tr style="font-weight:700"><td colspan="6" style="text-align:right">TOTALES</td>
    <td style="text-align:right">${money(sym, libro.totals.base)}</td><td></td><td style="text-align:right">${money(sym, libro.totals.cuota)}</td>
    <td style="text-align:right">${money(sym, libro.totals.irpf)}</td><td style="text-align:right">${money(sym, libro.totals.total)}</td></tr>`;
  return `<table><thead>${head}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table>`;
}
function comprasTable(libro, sym) {
  const head = `<tr><th>Nº recepción</th><th>Nº fra. proveedor</th><th>F. exped.</th><th>F. oper.</th><th>NIF</th><th>Proveedor</th>
    <th style="text-align:right">Base</th><th style="text-align:right">Tipo IVA</th><th style="text-align:right">Cuota soportada</th><th style="text-align:right">Total línea</th></tr>`;
  const body = comprasAsientos(libro).map(a => `<tr><td>${escHtml(a.internal_code || '')}</td><td>${escHtml(a.supplier_number || '')}</td>
      <td>${a.invoice_date ? fechaEs(a.invoice_date) : ''}</td><td>${a.operation_date ? fechaEs(a.operation_date) : '—'}</td><td>${escHtml(a.nif || '')}</td><td>${escHtml(a.nombre || '')}</td>
      <td style="text-align:right">${money(sym, a.base)}</td><td style="text-align:right">${rateLabel(a.rate)}</td><td style="text-align:right">${money(sym, a.cuota)}</td>
      <td style="text-align:right">${money(sym, a.total_linea)}</td></tr>`).join('') || emptyRow(10, 'No hay operaciones en este periodo. Cambia las fechas o emite tu primera factura.');
  const foot = `<tr style="font-weight:700"><td colspan="6" style="text-align:right">TOTALES</td>
    <td style="text-align:right">${money(sym, libro.totals.base)}</td><td></td><td style="text-align:right">${money(sym, libro.totals.cuota)}</td>
    <td style="text-align:right">${money(sym, libro.totals.total)}</td></tr>`;
  return `<table><thead>${head}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table>`;
}

// LIBRO DIARIO — asientos cronológicos; cada línea con cuenta (código+nombre) en Debe/Haber.
function diarioTable(diario, sym) {
  const cuadre = diario.cuadra
    ? `<span style="color:var(--ok)">✓ cuadra (Debe = Haber)</span>`
    : `<span style="color:var(--danger)">✗ DESCUADRE</span>`;
  const bloques = diario.rows.map(a => {
    const ls = a.lines.map(l => `<tr><td></td><td>${escHtml(l.account_code)} · ${escHtml(l.account_name || '')}</td>
      <td style="text-align:right">${l.debit ? money(sym, l.debit) : ''}</td><td style="text-align:right">${l.credit ? money(sym, l.credit) : ''}</td></tr>`).join('');
    return `<tr style="background:var(--bg2)"><td>${fechaEs(a.entry_date)}</td>
      <td colspan="3"><b>Asiento ${a.id}</b> · ${escHtml(a.entry_type)} — ${escHtml(a.memo || '')}${a.cuadra ? '' : ' <span style="color:var(--danger)">(descuadra)</span>'}</td></tr>${ls}`;
  }).join('') || emptyRow(4, 'No hay asientos en este periodo. Cambia las fechas o emite tu primera factura.');
  const foot = `<tr style="font-weight:700"><td colspan="2" style="text-align:right">TOTALES</td>
    <td style="text-align:right">${money(sym, diario.totals.debe)}</td><td style="text-align:right">${money(sym, diario.totals.haber)}</td></tr>`;
  return `<div style="margin:.25rem 0 .75rem;font-size:13px">Cuadre del diario: ${cuadre}</div>
    <table><thead><tr><th>Fecha</th><th>Cuenta</th><th style="text-align:right">Debe</th><th style="text-align:right">Haber</th></tr></thead>
    <tbody>${bloques}</tbody><tfoot>${foot}</tfoot></table>`;
}
// LIBRO MAYOR — saldo por cuenta; cada cuenta enlaza a su detalle (drill-down ?cuenta=).
function mayorTable(mayor, sym, from, to) {
  const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const body = mayor.rows.map(r => `<tr>
      <td><a href="/admin/contabilidad/mayor?cuenta=${encodeURIComponent(r.code)}&${q}">${escHtml(r.code)}</a></td>
      <td>${escHtml(r.name || '')}</td>
      <td style="text-align:right">${money(sym, r.debe)}</td><td style="text-align:right">${money(sym, r.haber)}</td>
      <td style="text-align:right">${money(sym, r.saldo)}</td></tr>`).join('') || emptyRow(5, 'No hay movimientos en este periodo. Cambia las fechas o emite tu primera factura.');
  const foot = `<tr style="font-weight:700"><td colspan="2" style="text-align:right">TOTALES</td>
    <td style="text-align:right">${money(sym, mayor.totals.debe)}</td><td style="text-align:right">${money(sym, mayor.totals.haber)}</td>
    <td style="text-align:right">${money(sym, r2(mayor.totals.debe - mayor.totals.haber))}</td></tr>`;
  return `<table><thead><tr><th>Cuenta</th><th>Nombre</th><th style="text-align:right">Debe</th><th style="text-align:right">Haber</th><th style="text-align:right">Saldo</th></tr></thead>
    <tbody>${body}</tbody><tfoot>${foot}</tfoot></table>`;
}
// Detalle de UNA cuenta (drill-down): movimientos con saldo acumulado línea a línea.
function mayorDetalle(det, sym) {
  const body = det.rows.map(m => `<tr><td>${fechaEs(m.entry_date)}</td><td>${m.entry_id}</td><td>${escHtml(m.entry_type)}</td>
      <td>${escHtml(m.memo || '')}</td><td style="text-align:right">${m.debit ? money(sym, m.debit) : ''}</td>
      <td style="text-align:right">${m.credit ? money(sym, m.credit) : ''}</td><td style="text-align:right">${money(sym, m.saldo)}</td></tr>`).join('')
    || emptyRow(7, 'No hay movimientos en este periodo.');
  return `<div class="card" style="margin-top:1rem"><div class="card-body">
      <h3>Cuenta ${escHtml(det.code)} · ${escHtml(det.name || '')}</h3>
      <span style="color:var(--text2);font-size:12px">Debe ${money(sym, det.debe)} · Haber ${money(sym, det.haber)} · Saldo ${money(sym, det.saldo)}</span></div>
    <table><thead><tr><th>Fecha</th><th>Asiento</th><th>Tipo</th><th>Concepto</th><th style="text-align:right">Debe</th><th style="text-align:right">Haber</th><th style="text-align:right">Saldo acum.</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

// CUENTA DE PÉRDIDAS Y GANANCIAS — estructura formal PGC PYMES; subtotales resaltados; los
// gastos entran en negativo (mostrados entre paréntesis, convención contable).
function pygTable(pyg, sym) {
  const m = n => { const v = Number(n || 0); return v < 0 ? `(${dineroEs(Math.abs(v), sym)})` : `${dineroEs(v, sym)}`; };
  const body = filasPyG(pyg).map(([etiqueta, nombre, importe, tipo]) => tipo === 'subtotal'
    ? `<tr style="font-weight:700;background:var(--bg2)"><td>${escHtml(etiqueta)}</td><td>${escHtml(nombre)}</td><td style="text-align:right;white-space:nowrap">${m(importe)}</td></tr>`
    : `<tr><td style="color:var(--text2)">${escHtml(etiqueta)}</td><td>${escHtml(nombre)}</td><td style="text-align:right;white-space:nowrap">${m(importe)}</td></tr>`).join('');
  return `<table><thead><tr><th style="width:3.5rem">Partida</th><th>Concepto</th><th style="text-align:right">Importe</th></tr></thead><tbody>${body}</tbody></table>`;
}

const fileResp = (buf, type, name) => new Response(buf, { headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}"` } });
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function createContabilidadRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  api.get('/libros', requirePerm('invoices.read'), c => {
    const { from, to } = rangeOf(c, db); backfillLedger(db);
    return c.json({ from, to, ventas: libroVentas(db, from, to), compras: libroCompras(db, from, to) });
  });

  views.get('/', requirePerm('invoices.read'), c => c.redirect('/admin/contabilidad/ventas'));

  views.get('/ventas', requirePerm('invoices.read'), c => {
    const sym = symbolOf(db); const { from, to } = rangeOf(c, db); backfillLedger(db);
    const libro = libroVentas(db, from, to);
    const content = `<div class="ph"><h2>Contabilidad — Libros registro</h2></div>
      ${tabsBar('ventas', from, to)}${periodForm('ventas', from, to)}
      <div class="card"><div class="card-body"><h3>Libro de ventas e ingresos — facturas expedidas</h3>
        <span style="color:var(--text2);font-size:12px">Formato AEAT: un asiento por línea (una fila por tipo de IVA; las facturas multi-tipo aparecen en varias filas con el mismo número). Anuladas neteadas; sustituidas fuera; rectificativas marcadas (R·S/I).</span></div>
        ${ventasTable(libro, sym)}</div>`;
    return c.html(adminLayout('Contabilidad', content, 'contabilidad', c.get('session')?.csrfToken || '', c));
  });

  views.get('/compras', requirePerm('invoices.read'), c => {
    const sym = symbolOf(db); const { from, to } = rangeOf(c, db); backfillLedger(db);
    const libro = libroCompras(db, from, to);
    const content = `<div class="ph"><h2>Contabilidad — Libros registro</h2></div>
      ${tabsBar('compras', from, to)}${periodForm('compras', from, to)}
      <div class="card"><div class="card-body"><h3>Libro de compras y gastos — facturas recibidas</h3>
        <span style="color:var(--text2);font-size:12px">Formato AEAT: un asiento por línea (una fila por tipo de IVA). Abonos en negativo; anuladas fuera.</span></div>
        ${comprasTable(libro, sym)}</div>`;
    return c.html(adminLayout('Contabilidad', content, 'contabilidad', c.get('session')?.csrfToken || '', c));
  });

  // ── Descargas (XLSX/CSV = formato oficial AEAT; PDF = copia gestoría) ──
  const tag = (f, t) => `${f}_${t}`;
  views.get('/ventas.xlsx', requirePerm('invoices.read'), c => {
    const { from, to } = rangeOf(c, db); backfillLedger(db);
    return fileResp(buildXlsx([{ name: 'EXPEDIDAS_INGRESOS', matrix: ventasMatrix(libroVentas(db, from, to)) }]), XLSX_MIME, `libro-ventas-${tag(from, to)}.xlsx`);
  });
  views.get('/ventas.csv', requirePerm('invoices.read'), c => {
    const { from, to } = rangeOf(c, db); backfillLedger(db);
    return fileResp(Buffer.from(toCSV(ventasMatrix(libroVentas(db, from, to))), 'utf8'), 'text/csv; charset=utf-8', `libro-ventas-${tag(from, to)}.csv`);
  });
  // C10-e · POR EL MOTOR ÚNICO. Aquí vivía el HTML a mano de este informe; ya no queda ni una
  // línea. El papel lo compone la misma pieza que los otros catorce listados, así que este
  // informe gana de golpe membrete, cabecera repetida en cada hoja y «Página X de Y».
  views.get('/ventas.pdf', requirePerm('invoices.read'), async c => {
    const { from, to } = rangeOf(c, db); backfillLedger(db);
    const { html, titulo } = papelDeListado(db, 'libro-ventas', { desde: from, hasta: to }, c.get('session')?.name || '');
    const pdf = await renderPdfFromHtml(html, { pie: pieDeListado(titulo) });
    return fileResp(pdf, 'application/pdf', `ventas-${tag(from, to)}.pdf`);
  });
  views.get('/compras.xlsx', requirePerm('invoices.read'), c => {
    const { from, to } = rangeOf(c, db); backfillLedger(db);
    return fileResp(buildXlsx([{ name: 'RECIBIDAS_GASTOS', matrix: comprasMatrix(libroCompras(db, from, to)) }]), XLSX_MIME, `libro-compras-${tag(from, to)}.xlsx`);
  });
  views.get('/compras.csv', requirePerm('invoices.read'), c => {
    const { from, to } = rangeOf(c, db); backfillLedger(db);
    return fileResp(Buffer.from(toCSV(comprasMatrix(libroCompras(db, from, to))), 'utf8'), 'text/csv; charset=utf-8', `libro-compras-${tag(from, to)}.csv`);
  });
  // C10-e · POR EL MOTOR ÚNICO. Aquí vivía el HTML a mano de este informe; ya no queda ni una
  // línea. El papel lo compone la misma pieza que los otros catorce listados, así que este
  // informe gana de golpe membrete, cabecera repetida en cada hoja y «Página X de Y».
  views.get('/compras.pdf', requirePerm('invoices.read'), async c => {
    const { from, to } = rangeOf(c, db); backfillLedger(db);
    const { html, titulo } = papelDeListado(db, 'libro-compras', { desde: from, hasta: to }, c.get('session')?.name || '');
    const pdf = await renderPdfFromHtml(html, { pie: pieDeListado(titulo) });
    return fileResp(pdf, 'application/pdf', `compras-${tag(from, to)}.pdf`);
  });

  // ── PIEZA 2 — Libro Diario ──────────────────────────────────────────────────
  views.get('/diario', requirePerm('invoices.read'), c => {
    const sym = symbolOf(db); const { from, to } = rangeOf(c, db); backfillLedger(db);
    const diario = libroDiario(db, from, to);
    const content = `<div class="ph"><h2>Contabilidad — Libros registro</h2></div>
      ${tabsBar('diario', from, to)}${periodForm('diario', from, to)}
      <div class="card"><div class="card-body"><h3>Libro diario — asientos de doble cara</h3>
        <span style="color:var(--text2);font-size:12px">Lista cronológica; cada asiento con sus líneas al Debe/Haber sobre el plan de cuentas. Derivado del cuaderno (solo lectura).</span></div>
        ${diarioTable(diario, sym)}</div>`;
    return c.html(adminLayout('Contabilidad', content, 'contabilidad', c.get('session')?.csrfToken || '', c));
  });

  // ── PIEZA 2 — Libro Mayor (+ drill-down por cuenta) ──────────────────────────
  views.get('/mayor', requirePerm('invoices.read'), c => {
    const sym = symbolOf(db); const { from, to } = rangeOf(c, db); backfillLedger(db);
    const mayor = libroMayor(db, from, to);
    const cuenta = (c.req.query('cuenta') || '').replace(/[^0-9A-Za-z]/g, '');
    const detalle = cuenta ? mayorDetalle(mayorCuenta(db, cuenta, from, to), sym) : '';
    const content = `<div class="ph"><h2>Contabilidad — Libros registro</h2></div>
      ${tabsBar('mayor', from, to)}${periodForm('mayor', from, to)}
      <div class="card"><div class="card-body"><h3>Libro mayor — saldos por cuenta</h3>
        <span style="color:var(--text2);font-size:12px">Pulsa una cuenta para ver sus movimientos con saldo acumulado.</span></div>
        ${mayorTable(mayor, sym, from, to)}</div>${detalle}`;
    return c.html(adminLayout('Contabilidad', content, 'contabilidad', c.get('session')?.csrfToken || '', c));
  });

  // ── PIEZA 2 — Export del diario y del mayor (XLSX/CSV/PDF) ────────────────────
  views.get('/diario.xlsx', requirePerm('invoices.read'), c => {
    const { from, to } = rangeOf(c, db); backfillLedger(db);
    return fileResp(buildXlsx([{ name: 'DIARIO', matrix: diarioMatrix(libroDiario(db, from, to)) }]), XLSX_MIME, `libro-diario-${tag(from, to)}.xlsx`);
  });
  views.get('/diario.csv', requirePerm('invoices.read'), c => {
    const { from, to } = rangeOf(c, db); backfillLedger(db);
    return fileResp(Buffer.from(toCSV(diarioMatrix(libroDiario(db, from, to))), 'utf8'), 'text/csv; charset=utf-8', `libro-diario-${tag(from, to)}.csv`);
  });
  // C10-e · POR EL MOTOR ÚNICO. Aquí vivía el HTML a mano de este informe; ya no queda ni una
  // línea. El papel lo compone la misma pieza que los otros catorce listados, así que este
  // informe gana de golpe membrete, cabecera repetida en cada hoja y «Página X de Y».
  views.get('/diario.pdf', requirePerm('invoices.read'), async c => {
    const { from, to } = rangeOf(c, db); backfillLedger(db);
    const { html, titulo } = papelDeListado(db, 'libro-diario', { desde: from, hasta: to }, c.get('session')?.name || '');
    const pdf = await renderPdfFromHtml(html, { pie: pieDeListado(titulo) });
    return fileResp(pdf, 'application/pdf', `diario-${tag(from, to)}.pdf`);
  });
  views.get('/mayor.xlsx', requirePerm('invoices.read'), c => {
    const { from, to } = rangeOf(c, db); backfillLedger(db);
    return fileResp(buildXlsx([{ name: 'MAYOR', matrix: mayorMatrix(libroMayor(db, from, to)) }]), XLSX_MIME, `libro-mayor-${tag(from, to)}.xlsx`);
  });
  views.get('/mayor.csv', requirePerm('invoices.read'), c => {
    const { from, to } = rangeOf(c, db); backfillLedger(db);
    return fileResp(Buffer.from(toCSV(mayorMatrix(libroMayor(db, from, to))), 'utf8'), 'text/csv; charset=utf-8', `libro-mayor-${tag(from, to)}.csv`);
  });
  // C10-e · POR EL MOTOR ÚNICO. Aquí vivía el HTML a mano de este informe; ya no queda ni una
  // línea. El papel lo compone la misma pieza que los otros catorce listados, así que este
  // informe gana de golpe membrete, cabecera repetida en cada hoja y «Página X de Y».
  views.get('/mayor.pdf', requirePerm('invoices.read'), async c => {
    const { from, to } = rangeOf(c, db); backfillLedger(db);
    const { html, titulo } = papelDeListado(db, 'libro-mayor', { desde: from, hasta: to }, c.get('session')?.name || '');
    const pdf = await renderPdfFromHtml(html, { pie: pieDeListado(titulo) });
    return fileResp(pdf, 'application/pdf', `mayor-${tag(from, to)}.pdf`);
  });

  // ── PIEZA 3 — Libro de bienes de inversión (DATO NUEVO; amortización en lectura) ──
  views.get('/bienes', requirePerm('invoices.read'), c => {
    const sym = symbolOf(db); const { from, to } = rangeOf(c, db);
    const libro = libroBienes(db, from, to);
    const csrf = c.get('session')?.csrfToken || '';
    const td = (v, r) => `<td${r ? ' style="text-align:right"' : ''}>${v}</td>`;
    const filas = libro.rows.map(g => {
      const baseForm = `<input type="hidden" name="_csrf" value="${escHtml(csrf)}">`;
      const edit = `<details><summary>Editar</summary><form method="post" action="/admin/contabilidad/bienes/${g.id}" style="display:grid;grid-template-columns:1fr 1fr;gap:.4rem;margin:.5rem 0">${baseForm}
        <label>Descripción<input name="description" value="${escHtml(g.description || '')}" required></label>
        <label>Nº documento<input name="doc_number" value="${escHtml(g.doc_number || '')}"></label>
        <label>Proveedor<input name="supplier_name" value="${escHtml(g.supplier_name || '')}"></label>
        <label>NIF<input name="supplier_fiscal_id" value="${escHtml(g.supplier_fiscal_id || '')}"></label>
        <label>Valor adquisición<input type="number" step="0.01" name="acquisition_value" value="${g.acquisition_value}" required></label>
        <label>Valor amortizable<input type="number" step="0.01" name="amortizable_base" value="${g.amortizable_base}"></label>
        <label>% anual<input type="number" step="0.01" name="annual_rate" value="${g.annual_rate}" required></label>
        <label>Puesta en func.<input type="date" name="start_date" value="${escHtml(g.start_date || '')}" required></label>
        <button class="btn" type="submit">Guardar</button></form></details>`;
      const baja = g.de_baja
        ? `<form method="post" action="/admin/contabilidad/bienes/${g.id}/reactivar" style="margin-top:.3rem">${baseForm}<button class="btn btn-ghost" type="submit">Reactivar</button></form>`
        : `<details><summary>Dar de baja</summary><form method="post" action="/admin/contabilidad/bienes/${g.id}/baja" style="margin:.4rem 0">${baseForm}
          <input type="date" name="baja_date" required> <input name="motivo" placeholder="Motivo" required>
          <button class="btn" type="submit">Baja</button></form></details>`;
      return `<tr>
        ${td(escHtml(g.description || '') + (g.de_baja ? ` <span style="color:var(--danger)">baja ${escHtml(g.baja_date)}</span>` : ''))}
        ${td(escHtml(g.doc_number || ''))}${td(escHtml(g.supplier_name || ''))}${td(escHtml(g.supplier_fiscal_id || ''))}
        ${td(escHtml(g.start_date || ''))}${td(money(sym, g.acquisition_value), 1)}${td(money(sym, g.amortizable_base), 1)}
        ${td(Number(g.annual_rate) + '%', 1)}${td(money(sym, g.acuInicio), 1)}${td(money(sym, g.cuota), 1)}${td(money(sym, g.acuFinal), 1)}${td(money(sym, g.pendiente), 1)}
        <td>${edit}${baja}</td></tr>`;
    }).join('') || emptyRow(13, 'Aún no has registrado bienes de inversión. Cuando compres un bien amortizable, márcalo aquí.', { cta: 'Nuevo bien', onclick: "var d=document.getElementById('altaBien');if(d)d.open=true" });
    const altaForm = `<details id="altaBien"><summary class="btn" style="display:inline-block">+ Alta de bien</summary>
      <form method="post" action="/admin/contabilidad/bienes" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.5rem;margin:.75rem 0;max-width:900px">
        <input type="hidden" name="_csrf" value="${escHtml(csrf)}">
        <label>Descripción*<input name="description" required></label>
        <label>Compra enlazada (id, opcional)<input type="number" name="purchase_id" placeholder="id de purchases"></label>
        <label>Nº documento<input name="doc_number"></label>
        <label>Proveedor<input name="supplier_name"></label>
        <label>NIF proveedor<input name="supplier_fiscal_id"></label>
        <label>Puesta en funcionamiento*<input type="date" name="start_date" required></label>
        <label>Valor adquisición* (def.= total de la compra enlazada)<input type="number" step="0.01" name="acquisition_value"></label>
        <label>Valor amortizable (def.=adquisición)<input type="number" step="0.01" name="amortizable_base"></label>
        <label>% amortización anual*<input type="number" step="0.01" name="annual_rate" required></label>
        <div style="grid-column:1/-1"><button class="btn" type="submit">Registrar bien</button> <span style="color:var(--text2);font-size:12px">Método: lineal. Si enlazas una compra, se traen proveedor/NIF/nº/valor.</span></div>
      </form></details>`;
    const content = `<div class="ph"><h2>Contabilidad — Libros registro</h2></div>
      ${tabsBar('bienes', from, to)}${periodForm('bienes', from, to)}
      <div class="card"><div class="card-body"><h3>Libro de bienes de inversión — amortización lineal</h3>
        <span style="color:var(--text2);font-size:12px">Tercer libro registro (Orden HAC/773/2019). La amortización se calcula en lectura: cuota del periodo prorrateada por días, con tope = valor amortizable; la baja la detiene.</span>
        <div style="margin-top:.5rem">${altaForm}</div></div>
        <table><thead><tr><th>Descripción</th><th>Documento</th><th>Proveedor</th><th>NIF</th><th>Puesta func.</th>
          <th style="text-align:right">V. adquisición</th><th style="text-align:right">V. amortizable</th><th style="text-align:right">% anual</th>
          <th style="text-align:right">Acum. inicio</th><th style="text-align:right">Cuota periodo</th><th style="text-align:right">Acum. final</th><th style="text-align:right">Pendiente</th><th>Acciones</th></tr></thead>
        <tbody>${filas}</tbody>
        <tfoot><tr style="font-weight:700"><td colspan="5" style="text-align:right">TOTALES</td>
          <td style="text-align:right">${money(sym, libro.totals.adquisicion)}</td><td style="text-align:right">${money(sym, libro.totals.amortizable)}</td><td></td><td></td>
          <td style="text-align:right">${money(sym, libro.totals.cuota)}</td><td style="text-align:right">${money(sym, libro.totals.acumulada)}</td><td style="text-align:right">${money(sym, libro.totals.pendiente)}</td><td></td></tr></tfoot>
        </table></div>`;
    return c.html(adminLayout('Contabilidad', content, 'contabilidad', csrf, c));
  });

  const backToBienes = c => c.redirect('/admin/contabilidad/bienes');
  views.post('/bienes', requirePerm('invoices.create'), async c => { try { createInvestmentGood(db, await c.req.parseBody()); return backToBienes(c); } catch (e) { return c.html(errorShell('No hemos podido guardar el bien', cleanErrMsg(e.message), { action: 'Volver a Bienes de inversión', href: '/admin/contabilidad/bienes' }), e.status || 400); } });
  views.post('/bienes/:id', requirePerm('invoices.create'), async c => { try { updateInvestmentGood(db, +c.req.param('id'), await c.req.parseBody()); return backToBienes(c); } catch (e) { return c.html(errorShell('No hemos podido guardar el bien', cleanErrMsg(e.message), { action: 'Volver a Bienes de inversión', href: '/admin/contabilidad/bienes' }), e.status || 400); } });
  views.post('/bienes/:id/baja', requirePerm('invoices.create'), async c => { try { const b = await c.req.parseBody(); bajaInvestmentGood(db, +c.req.param('id'), b.baja_date, b.motivo); return backToBienes(c); } catch (e) { return c.html(errorShell('No hemos podido guardar el bien', cleanErrMsg(e.message), { action: 'Volver a Bienes de inversión', href: '/admin/contabilidad/bienes' }), e.status || 400); } });
  views.post('/bienes/:id/reactivar', requirePerm('invoices.create'), c => { try { reactivarInvestmentGood(db, +c.req.param('id')); return backToBienes(c); } catch (e) { return c.html(errorShell('No hemos podido guardar el bien', cleanErrMsg(e.message), { action: 'Volver a Bienes de inversión', href: '/admin/contabilidad/bienes' }), e.status || 400); } });

  views.get('/bienes.xlsx', requirePerm('invoices.read'), c => {
    const { from, to } = rangeOf(c, db);
    return fileResp(buildXlsx([{ name: 'BIENES_INVERSION', matrix: bienesMatrix(libroBienes(db, from, to), from, to) }]), XLSX_MIME, `libro-bienes-inversion-${tag(from, to)}.xlsx`);
  });
  views.get('/bienes.csv', requirePerm('invoices.read'), c => {
    const { from, to } = rangeOf(c, db);
    return fileResp(Buffer.from(toCSV(bienesMatrix(libroBienes(db, from, to), from, to)), 'utf8'), 'text/csv; charset=utf-8', `libro-bienes-inversion-${tag(from, to)}.csv`);
  });
  // C10-e · POR EL MOTOR ÚNICO. Aquí vivía el HTML a mano de este informe; ya no queda ni una
  // línea. El papel lo compone la misma pieza que los otros catorce listados, así que este
  // informe gana de golpe membrete, cabecera repetida en cada hoja y «Página X de Y».
  views.get('/bienes.pdf', requirePerm('invoices.read'), async c => {
    const { from, to } = rangeOf(c, db); backfillLedger(db);
    const { html, titulo } = papelDeListado(db, 'libro-bienes', { desde: from, hasta: to }, c.get('session')?.name || '');
    const pdf = await renderPdfFromHtml(html, { pie: pieDeListado(titulo) });
    return fileResp(pdf, 'application/pdf', `bienes-${tag(from, to)}.pdf`);
  });

  // ── PIEZA 5 — Cuenta de Pérdidas y Ganancias (estado formal PGC PYMES, SOLO LECTURA) ──
  // Vista derivada del libro diario; misma cara y mismo gateo (invoices.read) que el resto.
  views.get('/pyg', requirePerm('invoices.read'), c => {
    const sym = symbolOf(db); const { from, to } = rangeOf(c, db); backfillLedger(db);
    const pyg = cuentaPyG(db, from, to);
    const res = pyg.resultadoEjercicio > 0 ? 'beneficio' : (pyg.resultadoEjercicio < 0 ? 'pérdida' : 'sin resultado');
    const content = `<div class="ph"><h2>Contabilidad — Libros registro</h2></div>
      ${tabsBar('pyg', from, to)}${periodForm('pyg', from, to)}
      <div class="card"><div class="card-body"><h3>Cuenta de pérdidas y ganancias</h3>
        <span style="color:var(--text2);font-size:12px">Modelo del PGC de PYMES (RD 1515/2007), derivada del libro diario (solo lectura). Los gastos figuran en negativo (entre paréntesis). Resultado del ejercicio: <b>${money(sym, pyg.resultadoEjercicio)} (${escHtml(res)})</b>.</span>
        ${avisosBox(pyg.warnings)}</div>
        ${pygTable(pyg, sym)}</div>`;
    return c.html(adminLayout('Contabilidad', content, 'contabilidad', c.get('session')?.csrfToken || '', c));
  });
  views.get('/pyg.xlsx', requirePerm('invoices.read'), c => {
    const { from, to } = rangeOf(c, db); backfillLedger(db);
    return fileResp(buildXlsx([{ name: 'PERDIDAS_Y_GANANCIAS', matrix: pygMatrix(cuentaPyG(db, from, to)) }]), XLSX_MIME, `cuenta-pyg-${tag(from, to)}.xlsx`);
  });
  views.get('/pyg.csv', requirePerm('invoices.read'), c => {
    const { from, to } = rangeOf(c, db); backfillLedger(db);
    return fileResp(Buffer.from(toCSV(pygMatrix(cuentaPyG(db, from, to))), 'utf8'), 'text/csv; charset=utf-8', `cuenta-pyg-${tag(from, to)}.csv`);
  });
  // C10-e · POR EL MOTOR ÚNICO. Aquí vivía el HTML a mano de este informe; ya no queda ni una
  // línea. El papel lo compone la misma pieza que los otros catorce listados, así que este
  // informe gana de golpe membrete, cabecera repetida en cada hoja y «Página X de Y».
  views.get('/pyg.pdf', requirePerm('invoices.read'), async c => {
    const { from, to } = rangeOf(c, db); backfillLedger(db);
    const { html, titulo } = papelDeListado(db, 'pyg', { desde: from, hasta: to }, c.get('session')?.name || '');
    const pdf = await renderPdfFromHtml(html, { pie: pieDeListado(titulo) });
    return fileResp(pdf, 'application/pdf', `pyg-${tag(from, to)}.pdf`);
  });

  // ── PIEZA 4 — Modelos AEAT (303 IVA y 130 IRPF), BORRADORES listos para validar ──
  // Vistas derivadas de los libros; Bamburu prepara, nunca presenta (CANON §0-ter).
  const modelosParams = c => {
    const now = new Date();
    const year = Number(c.req.query('year')) || (db.prepare('SELECT MAX(issue_date) m FROM invoices').get()?.m || '').slice(0, 4) || now.getFullYear();
    let q = Number(c.req.query('q'));
    if (![1, 2, 3, 4].includes(q)) q = Math.floor(now.getMonth() / 3) + 1;
    return { year: Number(year), q };
  };
  views.get('/modelos', requirePerm('invoices.read'), c => {
    const sym = symbolOf(db); const { year, q } = modelosParams(c); backfillLedger(db);
    const m303 = modelo303(db, year, q), m130 = modelo130(db, year, q);
    const { from, to } = quarterRange(year, q);
    const res303 = m303.casilla71 < 0 ? 'a compensar' : (m303.casilla71 > 0 ? 'a ingresar' : 'sin resultado');
    const res130 = m130.c19 < 0 ? 'sin ingreso (negativo o cero)' : (m130.c19 > 0 ? 'a ingresar' : 'sin ingreso');
    const content = `<div class="ph"><h2>Contabilidad — Libros registro</h2></div>
      ${tabsBar('modelos', from, to)}${modelosPeriodForm(year, q)}
      <div style="color:var(--text2);font-size:12px;margin-bottom:1rem">Periodo ${fechaEs(from)} → ${fechaEs(to)}. <b>Borradores</b> calculados desde tus libros: Bamburu los deja listos para que tú o tu gestoría los revisen y presenten. Bamburu no presenta ante la AEAT.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;align-items:start">
        <div class="card"><div class="card-body"><h3>Modelo 303 · IVA — ${escHtml(String(q))}T ${escHtml(String(year))}</h3>
          <span style="color:var(--text2);font-size:12px">IVA repercutido − IVA soportado deducible. Resultado de la liquidación (casilla 71): <b>${money(sym, m303.casilla71)} ${escHtml(res303)}</b>.</span>
          ${avisosBox(m303.warnings)}</div>
          ${modeloTabla(filas303(m303), sym)}</div>
        <div class="card"><div class="card-body"><h3>Modelo 130 · IRPF — ${escHtml(String(q))}T ${escHtml(String(year))}</h3>
          <span style="color:var(--text2);font-size:12px">Pago fraccionado (20% del rendimiento acumulado − retenciones − pagos previos). Resultado (casilla 19): <b>${money(sym, m130.c19)} ${escHtml(res130)}</b>.</span>
          ${avisosBox(m130.warnings)}</div>
          ${modeloTabla(filas130(m130), sym)}</div>
      </div>`;
    return c.html(adminLayout('Contabilidad', content, 'contabilidad', c.get('session')?.csrfToken || '', c));
  });

  // Export del borrador: PDF (para la gestoría) y CSV (casilla·concepto·importe de ambos modelos).
  // AQUÍ VIVÍA `modelosBorradorHtml`, el sexto y último generador a mano: pintaba las dos tablas del
  // 303 y el 130 con su HTML propio. Se ha ido con los otros cinco (C10-e): el papel lo compone el
  // motor, que desde esta tarea sabe llevar varias secciones en un mismo documento.
  // C10-e · POR EL MOTOR ÚNICO. Aquí vivía el HTML a mano de este informe; ya no queda ni una
  // línea. El papel lo compone la misma pieza que los otros catorce listados, así que este
  // informe gana de golpe membrete, cabecera repetida en cada hoja y «Página X de Y».
  views.get('/modelos.pdf', requirePerm('invoices.read'), async c => {
    const { year, q: qt } = modelosParams(c); backfillLedger(db);
    const { html, titulo } = papelDeListado(db, 'modelos', { anio: String(year), trimestre: String(qt) }, c.get('session')?.name || '');
    const pdf = await renderPdfFromHtml(html, { pie: pieDeListado(titulo) });
    return fileResp(pdf, 'application/pdf', `modelos-${`${qt}T-${year}`}.pdf`);
  });
  views.get('/modelos.csv', requirePerm('invoices.read'), c => {
    const { year, q } = modelosParams(c); backfillLedger(db);
    const m303 = modelo303(db, year, q), m130 = modelo130(db, year, q);
    const esc = v => { const s = String(v ?? ''); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = [['Modelo', 'Casilla', 'Concepto', 'Importe']];
    for (const [cas, desc, imp] of filas303(m303)) if (cas !== '—') rows.push(['303', cas, desc, imp === '' ? '' : imp]);
    for (const [cas, desc, imp] of filas130(m130)) if (cas !== '—') rows.push(['130', cas, desc, imp === '' ? '' : imp]);
    const csv = '﻿' + rows.map(r => r.map(esc).join(';')).join('\r\n');
    return fileResp(Buffer.from(csv, 'utf8'), 'text/csv; charset=utf-8', `borrador-modelos-${year}-${q}T.csv`);
  });

  return { api, views };
}
