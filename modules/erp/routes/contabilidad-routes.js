// Rutas de Contabilidad · Pieza 1 — libros registro en UNA entrada de menú con dos PESTAÑAS
// (Ventas e ingresos / Compras y gastos). Formato oficial AEAT: UN ASIENTO = UNA FILA (una línea
// por tipo de IVA; multi-tipo = varias filas con la misma identificación de factura). Misma lógica
// en pantalla, PDF y export. Descarga real XLSX/CSV/PDF (Content-Disposition). Aditivo.
import { Hono } from 'hono';
import { requirePerm } from '../../../core/auth.js';
import { adminLayout } from '../layout.js';
import { escHtml } from '../../../core/escape.js';
import { renderPdfFromHtml } from '../../../core/pdf.js';
import { backfillLedger, libroVentas, libroCompras } from '../contabilidad.js';
import { ventasAsientos, comprasAsientos, ventasMatrix, comprasMatrix, toCSV, buildXlsx, libroHtml } from '../contabilidad-export.js';

function defaultRange(db) {
  const y = (db.prepare('SELECT MAX(issue_date) m FROM invoices').get()?.m || '').slice(0, 4) || String(new Date().getFullYear());
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}
const symbolOf = db => db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
const money = (sym, n) => sym + Number(n || 0).toFixed(2);
const rateLabel = r => (r === null || r === undefined) ? 'sin desglosar' : (Number(r) === 0 ? '0% (exento)' : `${r}%`);
const rangeOf = (c, db) => { const d = defaultRange(db); return { from: c.req.query('from') || d.from, to: c.req.query('to') || d.to }; };

function tabsBar(active, from, to) {
  const q = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const tab = (key, href, label) => `<a href="${href}${q}" class="btn ${active === key ? '' : 'btn-ghost'}" style="${active === key ? '' : 'opacity:.7'}">${label}</a>`;
  return `<div style="display:flex;gap:.5rem;margin-bottom:1rem">
    ${tab('ventas', '/admin/contabilidad/ventas', 'Ventas e ingresos')}
    ${tab('compras', '/admin/contabilidad/compras', 'Compras y gastos')}</div>`;
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

  return { api, views };
}
