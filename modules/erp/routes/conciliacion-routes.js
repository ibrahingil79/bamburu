// Rutas de CONCILIACIÓN BANCARIA · Pieza 1 — subir extracto Norma 43, ver movimientos, sugerencias,
// y conciliar/ignorar/deshacer. Ver: conciliacion.read · gestionar: conciliacion.manage · registrar
// cobro desde aquí: exige además cobros.manage (owner/admin lo saltan por bypass). Aditivo.
import { Hono } from 'hono';
import { requirePerm } from '../../../core/auth.js';
import { checkPermission } from '../../../core/permission-check.js';
import { adminLayout, emptyRow, errorShell, ERR, cleanErrMsg } from '../layout.js';
import { escHtml } from '../../../core/escape.js';
import { buildXlsx, toCSV } from '../contabilidad-export.js';
import { importNorma43, sugerenciasIngreso, conciliarConCobro, conciliarConFactura, ignorarMovimiento, deshacer,
         sugerenciasGasto, conciliarConGasto, conciliarConPagoProveedor } from '../conciliacion.js';
import { fmtEur as dineroEs } from '../margen.js';   // el dinero, como en España

const symbolOf = db => db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
const money = (sym, n) => { const v = Number(n || 0); return (v < 0 ? '-' : '') + dineroEs(Math.abs(v), sym); };
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const fileResp = (buf, type, name) => new Response(buf, { headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}"` } });
// owner/admin saltan; el resto necesita el permiso concreto (para el gate de registrar cobro).
const can = (c, db, mod, act) => { const s = c.get('session'); return s?.role === 'owner' || s?.role === 'admin' || checkPermission(db, s, mod, act); };

const ESTADO_BADGE = {
  pendiente:  ['Pendiente', 'var(--text2)'],
  conciliado: ['Conciliado', 'var(--ok)'],
  ignorado:   ['Ignorado', 'var(--warn)'],
};
function badge(estado) { const [l, c] = ESTADO_BADGE[estado] || [estado, 'var(--text2)']; return `<span style="color:${c};font-weight:600">${escHtml(l)}</span>`; }

function movimientosFiltrados(db, { from, to, estado }) {
  const where = [], args = [];
  if (from) { where.push('m.op_date >= ?'); args.push(from); }
  if (to) { where.push('m.op_date <= ?'); args.push(to); }
  let sql = `SELECT m.*, COALESCE(r.estado,'pendiente') estado, r.target_type, r.target_id, r.created_payment_id
             FROM bank_movements m LEFT JOIN bank_reconciliations r ON r.movement_id = m.id`;
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY m.op_date DESC, m.id DESC';
  let rows = db.prepare(sql).all(...args);
  if (estado && estado !== 'todos') rows = rows.filter(r => r.estado === estado);
  return rows;
}
function filtraTipo(rows, tipo) {
  if (tipo === 'abonos') return rows.filter(r => r.is_credit);
  if (tipo === 'cargos') return rows.filter(r => !r.is_credit);
  return rows;
}

function movMatrix(rows) {
  return {
    headers: ['Fecha op.', 'Fecha valor', 'Concepto', 'Importe', 'Saldo', 'Tipo', 'Estado'],
    rows: rows.map(m => [m.op_date, m.value_date || '', m.concept || '', Number(m.amount), m.balance != null ? Number(m.balance) : '',
      m.is_credit ? 'Abono' : 'Cargo', m.estado]),
  };
}

export function createConciliacionRoutes(db) {
  const views = new Hono();

  views.get('/', requirePerm('conciliacion.read'), c => {
    const sym = symbolOf(db);
    const from = c.req.query('from') || '', to = c.req.query('to') || '', estado = c.req.query('estado') || 'todos', tipo = c.req.query('tipo') || 'todos';
    const rows = filtraTipo(movimientosFiltrados(db, { from, to, estado }), tipo);
    const csrf = c.get('session')?.csrfToken || '';
    const puedeGestionar = can(c, db, 'conciliacion', 'manage');
    const puedeCobrar = can(c, db, 'cobros', 'manage');
    const puedePagar = can(c, db, 'purchases', 'create');

    const filtro = `<form method="get" style="display:flex;gap:.75rem;align-items:end;flex-wrap:wrap;margin:1rem 0">
      <div><label class="doc-label">Desde</label><br><input type="date" name="from" value="${escHtml(from)}"></div>
      <div><label class="doc-label">Hasta</label><br><input type="date" name="to" value="${escHtml(to)}"></div>
      <div><label class="doc-label">Estado</label><br><select name="estado">
        ${['todos', 'pendiente', 'conciliado', 'ignorado'].map(e => `<option value="${e}" ${estado === e ? 'selected' : ''}>${e[0].toUpperCase() + e.slice(1)}</option>`).join('')}
      </select></div>
      <div><label class="doc-label">Tipo</label><br><select name="tipo">
        ${[['todos', 'Todos'], ['abonos', 'Abonos (ingresos)'], ['cargos', 'Cargos (gastos)']].map(([v, l]) => `<option value="${v}" ${tipo === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select></div>
      <button class="btn" type="submit">Filtrar</button><span style="flex:1"></span>
      <a class="btn btn-ghost" href="/admin/conciliacion/export.xlsx?from=${from}&to=${to}&estado=${estado}">Excel</a>
      <a class="btn btn-ghost" href="/admin/conciliacion/export.csv?from=${from}&to=${to}&estado=${estado}">CSV</a>
    </form>`;

    const subir = puedeGestionar ? `<div class="card"><div class="card-body">
      <h3>Subir extracto bancario (Norma 43 / Cuaderno 43)</h3>
      <form method="post" action="/admin/conciliacion/import" enctype="multipart/form-data" style="display:flex;gap:.75rem;align-items:center;flex-wrap:wrap">
        <input type="hidden" name="_csrf" value="${escHtml(csrf)}">
        <input type="file" name="file" accept=".q43,.n43,.txt,.043,*/*" required>
        <button class="btn" type="submit">Importar</button>
        <span style="color:var(--text2);font-size:12px">Reimportar el mismo fichero no duplica movimientos.</span>
      </form></div></div>` : '';

    const filas = rows.map(m => {
      const imp = `<span style="color:${m.is_credit ? 'var(--ok)' : 'var(--danger)'}">${money(sym, m.amount)}</span>`;
      let acciones = '';
      if (m.estado === 'pendiente' && puedeGestionar) {
        if (m.is_credit) {
          const sugs = sugerenciasIngreso(db, m, { ventanaDias: 7 }).slice(0, 3);
          acciones = sugs.map(s => {
            const label = `${s.type === 'cobro' ? 'Cobro' : 'Factura'} ${escHtml(s.invoice_number || '')} · ${escHtml(s.client_name || '')} · ${money(sym, s.amount)}${s.hints.length ? ' · ' + s.hints.join('/') : ''}`;
            const action = s.type === 'cobro' ? 'conciliar-cobro' : 'conciliar-factura';
            const cobroNote = s.type === 'factura' ? (puedeCobrar ? ' <span style="color:var(--text2);font-size:11px">(registra el cobro)</span>' : ' <span style="color:var(--warn);font-size:11px">(necesita permiso de cobros)</span>') : '';
            return `<form method="post" action="/admin/conciliacion/${m.id}/${action}" style="margin:.15rem 0">
              <input type="hidden" name="_csrf" value="${escHtml(csrf)}"><input type="hidden" name="target_id" value="${s.id}">
              <input type="hidden" name="registrar_cobro" value="1">
              <button class="btn btn-ghost" type="submit" style="text-align:left">✓ ${label}${cobroNote}</button></form>`;
          }).join('') || '<span style="color:var(--text2);font-size:12px">Sin sugerencias automáticas.</span>';
        } else {
          // CARGO (gasto) — Pieza 2: sugiere pago a proveedor / factura de proveedor.
          const sugs = sugerenciasGasto(db, m, { ventanaDias: 7 }).slice(0, 3);
          acciones = sugs.map(s => {
            const label = `${s.type === 'pago_proveedor' ? 'Pago' : 'Compra'} ${escHtml(s.ref || '')} · ${escHtml(s.name || '')} · ${money(sym, s.amount)}${s.hints.length ? ' · ' + s.hints.join('/') : ''}`;
            const action = s.type === 'pago_proveedor' ? 'conciliar-pago' : 'conciliar-gasto';
            const pagoNote = s.type === 'gasto' ? (puedePagar ? ' <span style="color:var(--text2);font-size:11px">(registra el pago)</span>' : ' <span style="color:var(--warn);font-size:11px">(necesita permiso de compras)</span>') : '';
            return `<form method="post" action="/admin/conciliacion/${m.id}/${action}" style="margin:.15rem 0">
              <input type="hidden" name="_csrf" value="${escHtml(csrf)}"><input type="hidden" name="target_id" value="${s.id}">
              <input type="hidden" name="registrar_pago" value="1">
              <button class="btn btn-ghost" type="submit" style="text-align:left">✓ ${label}${pagoNote}</button></form>`;
          }).join('') || '<span style="color:var(--text2);font-size:12px">Sin sugerencias automáticas.</span>';
        }
        acciones += `<form method="post" action="/admin/conciliacion/${m.id}/ignorar" style="margin-top:.2rem"><input type="hidden" name="_csrf" value="${escHtml(csrf)}"><button class="btn btn-ghost" type="submit">Ignorar</button></form>`;
      } else if (m.estado !== 'pendiente' && puedeGestionar) {
        const cobroPago = m.target_type === 'supplier_payment' ? 'pago' : 'cobro';
        // ── LA ÚLTIMA VENTANITA DEL NAVEGADOR DEL PRODUCTO (retirada el 24 ago 2026) ──────────────
        // Aquí vivía un `onclick="return confirm(...)"`. El censo daba CERO y no era cierto: se
        // quedaba ciego en este fichero desde el `accept="…,*/*"` de más arriba, que confundía con
        // el principio de un comentario. La trampa es la de siempre: el navegador ofrece apagar los
        // diálogos y, apagados, `confirm()` devuelve false SIN ENSEÑAR NADA — el botón se queda
        // muerto y el usuario no sabe por qué. Ahora pregunta DENTRO de la página, como el resto.
        const delFlag = m.created_payment_id ? '<input type="hidden" name="delete_payment" value="1">' : '';
        const avisoId = 'desh' + m.id;
        acciones = `<form method="post" action="/admin/conciliacion/${m.id}/deshacer" id="${avisoId}"><input type="hidden" name="_csrf" value="${escHtml(csrf)}">${delFlag}<button class="btn btn-ghost" type="submit"${m.created_payment_id ? ` data-aviso="${avisoId}" data-que="${escHtml(cobroPago)}"` : ''}>Deshacer</button></form>`;
      }
      const VINC = {
        invoice_payment: `cobro #${m.target_id}${m.created_payment_id ? ' (creado aquí)' : ''}`,
        invoice: `factura #${m.target_id}`,
        supplier_payment: `pago a proveedor #${m.target_id}${m.created_payment_id ? ' (creado aquí)' : ''}`,
        supplier_invoice: `compra/gasto #${m.target_id}`,
      };
      const vinc = VINC[m.target_type] || '';
      return `<tr>
        <td>${escHtml(m.op_date)}</td>
        <td style="max-width:22rem">${escHtml(m.concept || '')}${vinc ? `<br><span style="color:var(--text2);font-size:11px">→ ${escHtml(vinc)}</span>` : ''}</td>
        <td style="text-align:right;white-space:nowrap">${imp}</td>
        <td style="text-align:right;white-space:nowrap">${m.balance != null ? money(sym, m.balance) : ''}</td>
        <td>${badge(m.estado)}</td>
        <td>${acciones}</td></tr>`;
    }).join('') || (puedeGestionar
      ? emptyRow(6, 'Aún no has subido ningún extracto. Súbelo (Norma 43) y cruzo tus cobros por ti.', { cta: 'Subir extracto', onclick: "var f=document.querySelector('input[name=file]');if(f){f.scrollIntoView({block:'center'});f.click()}" })
      : emptyRow(6, 'Aún no hay movimientos bancarios que conciliar.'));

    const content = `<div class="ph"><h2>Conciliación bancaria</h2></div>
      <div style="color:var(--text2);font-size:12px;margin-bottom:.5rem">Sube el extracto de tu banco (Norma 43) y cruza los abonos con tus facturas/cobros. Todo por sugerencia que tú confirmas; los cargos (gastos) se listan pero su cruce es una pieza posterior.</div>
      ${subir}${filtro}
      <div class="card"><table>
        <thead><tr><th>Fecha</th><th>Concepto</th><th style="text-align:right">Importe</th><th style="text-align:right">Saldo</th><th>Estado</th><th>Acción / sugerencia</th></tr></thead>
        <tbody>${filas}</tbody></table></div>
      <script>
        // Deshacer una conciliación que CREÓ un cobro o un pago borra también ese apunte, así que se
        // pregunta antes. La pregunta va en un panel de la propia página (window.confirmarEnPagina,
        // en layout.js): un confirm() del navegador se puede apagar y deja el botón muerto sin decir
        // nada. Se engancha por delegación para que valga también con la tabla recién repintada.
        document.addEventListener('click', async function (ev) {
          const b = ev.target.closest('button[data-aviso]');
          if (!b) return;
          ev.preventDefault();
          const que = b.getAttribute('data-que') || 'cobro';
          const seguir = await window.confirmarEnPagina({
            titulo: 'Deshacer y eliminar el ' + que,
            texto: 'Este movimiento creó un ' + que + ' al conciliar. Si lo deshaces, ese ' + que + ' se ELIMINA también.',
            aceptar: 'Deshacer y eliminar',
          });
          if (!seguir) return;
          const f = document.getElementById(b.getAttribute('data-aviso'));
          if (f) f.submit();
        });
      </script>`;
    return c.html(adminLayout('Conciliación', content, 'conciliacion', csrf, c));
  });

  const back = c => c.redirect('/admin/conciliacion' + (c.req.query('from') ? '' : ''));

  views.post('/import', requirePerm('conciliacion.manage'), async c => {
    try {
      const body = await c.req.parseBody();
      const f = body['file'];
      const text = typeof f === 'string' ? f : (f && typeof f.text === 'function' ? await f.text() : '');
      if (!text.trim()) return c.html(errorShell('No hemos podido leer el extracto', 'El fichero está vacío o no se puede leer. Revisa que sea un extracto Norma 43 (.n43) válido y vuelve a subirlo.', { action: 'Volver a Conciliación', href: '/admin/conciliacion' }), 400);
      importNorma43(db, text, { sourceFile: (f && f.name) || 'extracto.q43' });
    } catch (e) { return c.html(errorShell('No hemos podido importar el extracto', 'No hemos podido leer el extracto. Revisa que sea un fichero Norma 43 (.n43) válido y vuelve a subirlo.', { action: 'Volver a Conciliación', href: '/admin/conciliacion' }), e.status || 400); }
    return back(c);
  });

  views.post('/:id/conciliar-cobro', requirePerm('conciliacion.manage'), async c => {
    try { const b = await c.req.parseBody(); conciliarConCobro(db, +c.req.param('id'), +b.target_id, { by: c.get('session')?.email || '' }); }
    catch (e) { return c.html(errorShell('No hemos podido completar la conciliación', cleanErrMsg(e.message), { action: 'Volver a Conciliación', href: '/admin/conciliacion' }), e.status || 400); }
    return back(c);
  });

  views.post('/:id/conciliar-factura', requirePerm('conciliacion.manage'), async c => {
    try {
      const b = await c.req.parseBody();
      const registrar = b.registrar_cobro === '1';
      if (registrar && !can(c, db, 'cobros', 'manage')) return c.html(errorShell('No tienes permiso', ERR.PERM, { action: 'Volver a Conciliación', href: '/admin/conciliacion' }), 403);
      conciliarConFactura(db, +c.req.param('id'), +b.target_id, { by: c.get('session')?.email || '', registrarCobro: registrar });
    } catch (e) { return c.html(errorShell('No hemos podido completar la conciliación', cleanErrMsg(e.message), { action: 'Volver a Conciliación', href: '/admin/conciliacion' }), e.status || 400); }
    return back(c);
  });

  views.post('/:id/conciliar-pago', requirePerm('conciliacion.manage'), async c => {
    try { const b = await c.req.parseBody(); conciliarConPagoProveedor(db, +c.req.param('id'), +b.target_id, { by: c.get('session')?.email || '' }); }
    catch (e) { return c.html(errorShell('No hemos podido completar la conciliación', cleanErrMsg(e.message), { action: 'Volver a Conciliación', href: '/admin/conciliacion' }), e.status || 400); }
    return back(c);
  });

  views.post('/:id/conciliar-gasto', requirePerm('conciliacion.manage'), async c => {
    try {
      const b = await c.req.parseBody();
      const registrar = b.registrar_pago === '1';
      if (registrar && !can(c, db, 'purchases', 'create')) return c.html(errorShell('No tienes permiso', ERR.PERM, { action: 'Volver a Conciliación', href: '/admin/conciliacion' }), 403);
      conciliarConGasto(db, +c.req.param('id'), +b.target_id, { by: c.get('session')?.email || '', registrarPago: registrar });
    } catch (e) { return c.html(errorShell('No hemos podido completar la conciliación', cleanErrMsg(e.message), { action: 'Volver a Conciliación', href: '/admin/conciliacion' }), e.status || 400); }
    return back(c);
  });

  views.post('/:id/ignorar', requirePerm('conciliacion.manage'), async c => {
    try { await c.req.parseBody(); ignorarMovimiento(db, +c.req.param('id'), { by: c.get('session')?.email || '' }); }
    catch (e) { return c.html(errorShell('No hemos podido completar la conciliación', cleanErrMsg(e.message), { action: 'Volver a Conciliación', href: '/admin/conciliacion' }), e.status || 400); }
    return back(c);
  });

  views.post('/:id/deshacer', requirePerm('conciliacion.manage'), async c => {
    try { const b = await c.req.parseBody(); deshacer(db, +c.req.param('id'), { deletePayment: b.delete_payment === '1' ? true : false }); }
    catch (e) { return c.html(errorShell('No hemos podido completar la conciliación', cleanErrMsg(e.message), { action: 'Volver a Conciliación', href: '/admin/conciliacion' }), e.status || 400); }
    return back(c);
  });

  views.get('/export.xlsx', requirePerm('conciliacion.read'), c => {
    const rows = movimientosFiltrados(db, { from: c.req.query('from'), to: c.req.query('to'), estado: c.req.query('estado') });
    return fileResp(buildXlsx([{ name: 'MOVIMIENTOS', matrix: movMatrix(rows) }]), XLSX_MIME, 'conciliacion.xlsx');
  });
  views.get('/export.csv', requirePerm('conciliacion.read'), c => {
    const rows = movimientosFiltrados(db, { from: c.req.query('from'), to: c.req.query('to'), estado: c.req.query('estado') });
    return fileResp(Buffer.from(toCSV(movMatrix(rows)), 'utf8'), 'text/csv; charset=utf-8', 'conciliacion.csv');
  });

  return { views };
}
