// Rutas de Contabilidad · Pieza 1 — libros registro en UNA entrada de menú con dos PESTAÑAS
// (Ventas e ingresos / Compras y gastos). Formato oficial AEAT: UN ASIENTO = UNA FILA (una línea
// por tipo de IVA; multi-tipo = varias filas con la misma identificación de factura). Misma lógica
// en pantalla, PDF y export. Descarga real XLSX/CSV/PDF (Content-Disposition). Aditivo.
import { Hono } from 'hono';
import { requirePerm } from '../../../core/auth.js';
import { adminLayout } from '../layout.js';
import { escHtml } from '../../../core/escape.js';
import { renderPdfFromHtml } from '../../../core/pdf.js';
import { backfillLedger, libroVentas, libroCompras, libroDiario, libroMayor, mayorCuenta } from '../contabilidad.js';
import { ventasAsientos, comprasAsientos, ventasMatrix, comprasMatrix, toCSV, buildXlsx, libroHtml,
         diarioMatrix, mayorMatrix, diarioHtml, mayorHtml, bienesMatrix, bienesHtml } from '../contabilidad-export.js';
import { libroBienes, createInvestmentGood, updateInvestmentGood, bajaInvestmentGood, reactivarInvestmentGood } from '../contabilidad-bienes.js';

function defaultRange(db) {
  const y = (db.prepare('SELECT MAX(issue_date) m FROM invoices').get()?.m || '').slice(0, 4) || String(new Date().getFullYear());
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}
const symbolOf = db => db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const money = (sym, n) => sym + Number(n || 0).toFixed(2);
const rateLabel = r => (r === null || r === undefined) ? 'sin desglosar' : (Number(r) === 0 ? '0% (exento)' : `${r}%`);
const rangeOf = (c, db) => { const d = defaultRange(db); return { from: c.req.query('from') || d.from, to: c.req.query('to') || d.to }; };

function tabsBar(active, from, to) {
  const q = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const tab = (key, href, label) => `<a href="${href}${q}" class="btn ${active === key ? '' : 'btn-ghost'}" style="${active === key ? '' : 'opacity:.7'}">${label}</a>`;
  return `<div style="display:flex;gap:.5rem;margin-bottom:1rem;flex-wrap:wrap">
    ${tab('ventas', '/admin/contabilidad/ventas', 'Ventas e ingresos')}
    ${tab('compras', '/admin/contabilidad/compras', 'Compras y gastos')}
    ${tab('diario', '/admin/contabilidad/diario', 'Libro diario')}
    ${tab('mayor', '/admin/contabilidad/mayor', 'Libro mayor')}
    ${tab('bienes', '/admin/contabilidad/bienes', 'Bienes de inversión')}</div>`;
}
function periodForm(kind, from, to) {
  const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  return `<form method="get" action="/admin/contabilidad/${kind}" style="display:flex;gap:.75rem;align-items:end;flex-wrap:wrap;margin-bottom:1rem">
    <div><label class="doc-label">Desde</label><br><input type="date" name="from" value="${escHtml(from)}"></div>
    <div><label class="doc-label">Hasta</label><br><input type="date" name="to" value="${escHtml(to)}"></div>
    <button class="btn" type="submit">Ver periodo</button>
    <span style="flex:1"></span>
    <a class="btn btn-ghost" href="/admin/contabilidad/${kind}.xlsx?${q}">Excel (XLSX)</a>
    <a class="btn btn-ghost" href="/admin/contabilidad/${kind}.csv?${q}">CSV</a>
    <a class="btn btn-ghost" href="/admin/contabilidad/${kind}.pdf?${q}">PDF</a>
  </form>`;
}

function ventasTable(libro, sym) {
  const head = `<tr><th>Factura</th><th>F. exped.</th><th>F. oper.</th><th>Tipo</th><th>NIF</th><th>Destinatario</th>
    <th style="text-align:right">Base</th><th style="text-align:right">Tipo IVA</th><th style="text-align:right">Cuota IVA</th>
    <th style="text-align:right">Retención IRPF</th><th style="text-align:right">Total línea</th></tr>`;
  const body = ventasAsientos(libro).map(a => {
    const badge = a.es_rectificativa ? ` <span title="Rectificativa" style="background:#fde68a;color:#92400e;border-radius:4px;padding:0 4px;font-size:10px">R${a.rect_mode ? '·' + a.rect_mode : ''}</span>` : '';
    return `<tr><td>${escHtml(a.invoice_number || '')}${badge}</td><td>${escHtml(a.issue_date || '')}</td><td>${escHtml(a.operation_date || '—')}</td>
      <td>${escHtml(a.tipo_factura || '')}</td><td>${escHtml(a.nif || '')}</td><td>${escHtml(a.nombre || '')}</td>
      <td style="text-align:right">${money(sym, a.base)}</td><td style="text-align:right">${rateLabel(a.rate)}</td><td style="text-align:right">${money(sym, a.cuota)}</td>
      <td style="text-align:right">${a.irpf != null && a.irpf !== 0 ? money(sym, a.irpf) : ''}</td><td style="text-align:right">${money(sym, a.total_linea)}</td></tr>`;
  }).join('') || '<tr><td colspan="11" style="text-align:center;color:var(--text2)">Sin operaciones en el periodo</td></tr>';
  const foot = `<tr style="font-weight:700"><td colspan="6" style="text-align:right">TOTALES</td>
    <td style="text-align:right">${money(sym, libro.totals.base)}</td><td></td><td style="text-align:right">${money(sym, libro.totals.cuota)}</td>
    <td style="text-align:right">${money(sym, libro.totals.irpf)}</td><td style="text-align:right">${money(sym, libro.totals.total)}</td></tr>`;
  return `<table><thead>${head}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table>`;
}
function comprasTable(libro, sym) {
  const head = `<tr><th>Nº recepción</th><th>Nº fra. proveedor</th><th>F. exped.</th><th>F. oper.</th><th>NIF</th><th>Proveedor</th>
    <th style="text-align:right">Base</th><th style="text-align:right">Tipo IVA</th><th style="text-align:right">Cuota soportada</th><th style="text-align:right">Total línea</th></tr>`;
  const body = comprasAsientos(libro).map(a => `<tr><td>${escHtml(a.internal_code || '')}</td><td>${escHtml(a.supplier_number || '')}</td>
      <td>${escHtml(a.invoice_date || '')}</td><td>${escHtml(a.operation_date || '—')}</td><td>${escHtml(a.nif || '')}</td><td>${escHtml(a.nombre || '')}</td>
      <td style="text-align:right">${money(sym, a.base)}</td><td style="text-align:right">${rateLabel(a.rate)}</td><td style="text-align:right">${money(sym, a.cuota)}</td>
      <td style="text-align:right">${money(sym, a.total_linea)}</td></tr>`).join('') || '<tr><td colspan="10" style="text-align:center;color:var(--text2)">Sin operaciones en el periodo</td></tr>';
  const foot = `<tr style="font-weight:700"><td colspan="6" style="text-align:right">TOTALES</td>
    <td style="text-align:right">${money(sym, libro.totals.base)}</td><td></td><td style="text-align:right">${money(sym, libro.totals.cuota)}</td>
    <td style="text-align:right">${money(sym, libro.totals.total)}</td></tr>`;
  return `<table><thead>${head}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table>`;
}

// LIBRO DIARIO — asientos cronológicos; cada línea con cuenta (código+nombre) en Debe/Haber.
function diarioTable(diario, sym) {
  const cuadre = diario.cuadra
    ? `<span style="color:#15803d">✓ cuadra (Debe = Haber)</span>`
    : `<span style="color:#b91c1c">✗ DESCUADRE</span>`;
  const bloques = diario.rows.map(a => {
    const ls = a.lines.map(l => `<tr><td></td><td>${escHtml(l.account_code)} · ${escHtml(l.account_name || '')}</td>
      <td style="text-align:right">${l.debit ? money(sym, l.debit) : ''}</td><td style="text-align:right">${l.credit ? money(sym, l.credit) : ''}</td></tr>`).join('');
    return `<tr style="background:var(--bg2,#f6f6f8)"><td>${escHtml(a.entry_date)}</td>
      <td colspan="3"><b>Asiento ${a.id}</b> · ${escHtml(a.entry_type)} — ${escHtml(a.memo || '')}${a.cuadra ? '' : ' <span style="color:#b91c1c">(descuadra)</span>'}</td></tr>${ls}`;
  }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text2)">Sin asientos en el periodo</td></tr>';
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
      <td style="text-align:right">${money(sym, r.saldo)}</td></tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text2)">Sin movimientos en el periodo</td></tr>';
  const foot = `<tr style="font-weight:700"><td colspan="2" style="text-align:right">TOTALES</td>
    <td style="text-align:right">${money(sym, mayor.totals.debe)}</td><td style="text-align:right">${money(sym, mayor.totals.haber)}</td>
    <td style="text-align:right">${money(sym, r2(mayor.totals.debe - mayor.totals.haber))}</td></tr>`;
  return `<table><thead><tr><th>Cuenta</th><th>Nombre</th><th style="text-align:right">Debe</th><th style="text-align:right">Haber</th><th style="text-align:right">Saldo</th></tr></thead>
    <tbody>${body}</tbody><tfoot>${foot}</tfoot></table>`;
}
// Detalle de UNA cuenta (drill-down): movimientos con saldo acumulado línea a línea.
function mayorDetalle(det, sym) {
  const body = det.rows.map(m => `<tr><td>${escHtml(m.entry_date)}</td><td>${m.entry_id}</td><td>${escHtml(m.entry_type)}</td>
      <td>${escHtml(m.memo || '')}</td><td style="text-align:right">${m.debit ? money(sym, m.debit) : ''}</td>
      <td style="text-align:right">${m.credit ? money(sym, m.credit) : ''}</td><td style="text-align:right">${money(sym, m.saldo)}</td></tr>`).join('')
    || '<tr><td colspan="7" style="text-align:center;color:var(--text2)">Sin movimientos</td></tr>';
  return `<div class="card" style="margin-top:1rem"><div class="card-body">
      <h3>Cuenta ${escHtml(det.code)} · ${escHtml(det.name || '')}</h3>
      <span style="color:var(--text2);font-size:12px">Debe ${money(sym, det.debe)} · Haber ${money(sym, det.haber)} · Saldo ${money(sym, det.saldo)}</span></div>
    <table><thead><tr><th>Fecha</th><th>Asiento</th><th>Tipo</th><th>Concepto</th><th style="text-align:right">Debe</th><th style="text-align:right">Haber</th><th style="text-align:right">Saldo acum.</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
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
  views.get('/ventas.pdf', requirePerm('invoices.read'), async c => {
    const { from, to } = rangeOf(c, db); backfillLedger(db); const libro = libroVentas(db, from, to);
    const pdf = await renderPdfFromHtml(libroHtml('Libro de ventas e ingresos', `${from} → ${to}`, ventasAsientos(libro), libro.totals, symbolOf(db), 'ventas'));
    return fileResp(pdf, 'application/pdf', `libro-ventas-${tag(from, to)}.pdf`);
  });
  views.get('/compras.xlsx', requirePerm('invoices.read'), c => {
    const { from, to } = rangeOf(c, db); backfillLedger(db);
    return fileResp(buildXlsx([{ name: 'RECIBIDAS_GASTOS', matrix: comprasMatrix(libroCompras(db, from, to)) }]), XLSX_MIME, `libro-compras-${tag(from, to)}.xlsx`);
  });
  views.get('/compras.csv', requirePerm('invoices.read'), c => {
    const { from, to } = rangeOf(c, db); backfillLedger(db);
    return fileResp(Buffer.from(toCSV(comprasMatrix(libroCompras(db, from, to))), 'utf8'), 'text/csv; charset=utf-8', `libro-compras-${tag(from, to)}.csv`);
  });
  views.get('/compras.pdf', requirePerm('invoices.read'), async c => {
    const { from, to } = rangeOf(c, db); backfillLedger(db); const libro = libroCompras(db, from, to);
    const pdf = await renderPdfFromHtml(libroHtml('Libro de compras y gastos', `${from} → ${to}`, comprasAsientos(libro), libro.totals, symbolOf(db), 'compras'));
    return fileResp(pdf, 'application/pdf', `libro-compras-${tag(from, to)}.pdf`);
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
  views.get('/diario.pdf', requirePerm('invoices.read'), async c => {
    const { from, to } = rangeOf(c, db); backfillLedger(db);
    const pdf = await renderPdfFromHtml(diarioHtml(`${from} → ${to}`, libroDiario(db, from, to), symbolOf(db)));
    return fileResp(pdf, 'application/pdf', `libro-diario-${tag(from, to)}.pdf`);
  });
  views.get('/mayor.xlsx', requirePerm('invoices.read'), c => {
    const { from, to } = rangeOf(c, db); backfillLedger(db);
    return fileResp(buildXlsx([{ name: 'MAYOR', matrix: mayorMatrix(libroMayor(db, from, to)) }]), XLSX_MIME, `libro-mayor-${tag(from, to)}.xlsx`);
  });
  views.get('/mayor.csv', requirePerm('invoices.read'), c => {
    const { from, to } = rangeOf(c, db); backfillLedger(db);
    return fileResp(Buffer.from(toCSV(mayorMatrix(libroMayor(db, from, to))), 'utf8'), 'text/csv; charset=utf-8', `libro-mayor-${tag(from, to)}.csv`);
  });
  views.get('/mayor.pdf', requirePerm('invoices.read'), async c => {
    const { from, to } = rangeOf(c, db); backfillLedger(db);
    const pdf = await renderPdfFromHtml(mayorHtml(`${from} → ${to}`, libroMayor(db, from, to), symbolOf(db)));
    return fileResp(pdf, 'application/pdf', `libro-mayor-${tag(from, to)}.pdf`);
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
        ${td(escHtml(g.description || '') + (g.de_baja ? ` <span style="color:#b91c1c">baja ${escHtml(g.baja_date)}</span>` : ''))}
        ${td(escHtml(g.doc_number || ''))}${td(escHtml(g.supplier_name || ''))}${td(escHtml(g.supplier_fiscal_id || ''))}
        ${td(escHtml(g.start_date || ''))}${td(money(sym, g.acquisition_value), 1)}${td(money(sym, g.amortizable_base), 1)}
        ${td(Number(g.annual_rate) + '%', 1)}${td(money(sym, g.acuInicio), 1)}${td(money(sym, g.cuota), 1)}${td(money(sym, g.acuFinal), 1)}${td(money(sym, g.pendiente), 1)}
        <td>${edit}${baja}</td></tr>`;
    }).join('') || '<tr><td colspan="13" style="text-align:center;color:var(--text2)">Sin bienes de inversión registrados</td></tr>';
    const altaForm = `<details><summary class="btn" style="display:inline-block">+ Alta de bien</summary>
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
  views.post('/bienes', requirePerm('invoices.create'), async c => { try { createInvestmentGood(db, await c.req.parseBody()); return backToBienes(c); } catch (e) { return c.text(e.message, e.status || 400); } });
  views.post('/bienes/:id', requirePerm('invoices.create'), async c => { try { updateInvestmentGood(db, +c.req.param('id'), await c.req.parseBody()); return backToBienes(c); } catch (e) { return c.text(e.message, e.status || 400); } });
  views.post('/bienes/:id/baja', requirePerm('invoices.create'), async c => { try { const b = await c.req.parseBody(); bajaInvestmentGood(db, +c.req.param('id'), b.baja_date, b.motivo); return backToBienes(c); } catch (e) { return c.text(e.message, e.status || 400); } });
  views.post('/bienes/:id/reactivar', requirePerm('invoices.create'), c => { try { reactivarInvestmentGood(db, +c.req.param('id')); return backToBienes(c); } catch (e) { return c.text(e.message, e.status || 400); } });

  views.get('/bienes.xlsx', requirePerm('invoices.read'), c => {
    const { from, to } = rangeOf(c, db);
    return fileResp(buildXlsx([{ name: 'BIENES_INVERSION', matrix: bienesMatrix(libroBienes(db, from, to), from, to) }]), XLSX_MIME, `libro-bienes-inversion-${tag(from, to)}.xlsx`);
  });
  views.get('/bienes.csv', requirePerm('invoices.read'), c => {
    const { from, to } = rangeOf(c, db);
    return fileResp(Buffer.from(toCSV(bienesMatrix(libroBienes(db, from, to), from, to)), 'utf8'), 'text/csv; charset=utf-8', `libro-bienes-inversion-${tag(from, to)}.csv`);
  });
  views.get('/bienes.pdf', requirePerm('invoices.read'), async c => {
    const { from, to } = rangeOf(c, db);
    const pdf = await renderPdfFromHtml(bienesHtml(`${from} → ${to}`, libroBienes(db, from, to), symbolOf(db)));
    return fileResp(pdf, 'application/pdf', `libro-bienes-inversion-${tag(from, to)}.pdf`);
  });

  return { api, views };
}
