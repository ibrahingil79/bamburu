// Rutas de FACTURAS RECURRENTES · Bloque A — plantillas + borradores generados. Ver:
// recurrentes.read · gestionar plantillas: recurrentes.manage · EMITIR el borrador: invoices.create
// (la emisión crea la factura real por el flujo existente, con huella). Aditivo.
import { Hono } from 'hono';
import { requirePerm } from '../../../core/auth.js';
import { checkPermission } from '../../../core/permission-check.js';
import { adminLayout, emptyRow, errorShell, cleanErrMsg } from '../layout.js';
import { escHtml } from '../../../core/escape.js';
import { generateDueOccurrences, borradoresPendientes, proximasFechas, importeEstimado,
         emitirOcurrencia, omitirOcurrencia, createTemplate, setTemplateStatus } from '../recurrentes.js';

const today = () => new Date().toISOString().slice(0, 10);
const symbolOf = db => db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
const money = (sym, n) => sym + Number(n || 0).toFixed(2);
const CAD = { 1: 'Mensual', 3: 'Trimestral', 12: 'Anual' };
const cadLabel = n => CAD[n] || `Cada ${n} meses`;
const canEmit = (c, db) => { const s = c.get('session'); return s?.role === 'owner' || s?.role === 'admin' || checkPermission(db, s, 'invoices', 'create'); };

export function createRecurrentesRoutes(db) {
  const views = new Hono();

  views.get('/', requirePerm('recurrentes.read'), c => {
    const sym = symbolOf(db), csrf = c.get('session')?.csrfToken || '';
    generateDueOccurrences(db, today());   // genera borradores vencidos (idempotente), como backfillLedger en contabilidad
    const tpls = db.prepare('SELECT * FROM recurring_templates ORDER BY status, id DESC').all();
    const borradores = borradoresPendientes(db);
    const clientes = db.prepare('SELECT id, name FROM clients ORDER BY name').all();
    const puedeGestionar = c.get('session')?.role === 'owner' || c.get('session')?.role === 'admin' || checkPermission(db, c.get('session'), 'recurrentes', 'manage');
    const puedeEmitir = canEmit(c, db);

    const borrHtml = borradores.map(o => {
      const est = importeEstimado(db, o.template_id);
      const emitir = puedeEmitir
        ? `<form method="post" action="/admin/recurrentes/borrador/${o.id}/emitir" style="display:inline"><input type="hidden" name="_csrf" value="${escHtml(csrf)}"><button class="btn" type="submit">Emitir factura</button></form>`
        : `<span style="color:var(--warn);font-size:12px">Necesita permiso de emisión</span>`;
      const omitir = puedeGestionar ? `<form method="post" action="/admin/recurrentes/borrador/${o.id}/omitir" style="display:inline;margin-left:.3rem"><input type="hidden" name="_csrf" value="${escHtml(csrf)}"><button class="btn btn-ghost" type="submit">Omitir</button></form>` : '';
      return `<tr><td>${escHtml(o.due_date)}</td><td>${escHtml(o.document_name)} · ${escHtml(o.client_name)}</td>
        <td style="text-align:right">${money(sym, est.total)}</td><td>${emitir}${omitir}</td></tr>`;
    }).join('') || emptyRow(4, 'No hay borradores esperando. Cuando toque una recurrente, la verás aquí para revisarla y emitirla.');

    const tplHtml = tpls.map(t => {
      const cli = db.prepare('SELECT name FROM clients WHERE id=?').get(t.client_id)?.name || '—';
      const prox = t.status === 'activa' ? proximasFechas(t, today(), 3).join(', ') || '—' : '(pausada)';
      const est = importeEstimado(db, t.id);
      const toggle = puedeGestionar ? `<form method="post" action="/admin/recurrentes/${t.id}/${t.status === 'activa' ? 'pausar' : 'activar'}" style="display:inline"><input type="hidden" name="_csrf" value="${escHtml(csrf)}"><button class="btn btn-ghost" type="submit">${t.status === 'activa' ? 'Pausar' : 'Activar'}</button></form>` : '';
      return `<tr><td>${escHtml(cli)}</td><td>${escHtml(cadLabel(t.interval_months))}</td><td>${escHtml(t.start_date)}${t.end_date ? ' → ' + escHtml(t.end_date) : (t.max_occurrences ? ` (${t.max_occurrences}x)` : '')}</td>
        <td style="text-align:right">${money(sym, est.total)}</td><td>${t.status === 'activa' ? '<span style="color:var(--ok)">Activa</span>' : '<span style="color:var(--warn)">Pausada</span>'}</td>
        <td style="font-size:12px;color:var(--text2)">${escHtml(prox)}</td><td>${toggle}</td></tr>`;
    }).join('') || (puedeGestionar
      ? emptyRow(7, 'Aún no tienes facturas recurrentes. ¿Programamos la primera?', { cta: 'Nueva plantilla', onclick: "var d=document.getElementById('nuevaPlantilla');if(d)d.open=true" })
      : emptyRow(7, 'Aún no tienes facturas recurrentes.'));

    const nueva = puedeGestionar ? `<details id="nuevaPlantilla"><summary class="btn" style="display:inline-block">+ Nueva plantilla</summary>
      <form method="post" action="/admin/recurrentes" style="margin:.75rem 0;max-width:820px">
        <input type="hidden" name="_csrf" value="${escHtml(csrf)}">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.5rem">
          <label>Cliente<select name="client_id" required>${clientes.map(cl => `<option value="${cl.id}">${escHtml(cl.name)}</option>`).join('')}</select></label>
          <label>Cadencia<select name="interval_months"><option value="1">Mensual</option><option value="3">Trimestral</option><option value="12">Anual</option><option value="2">Cada 2 meses</option><option value="6">Cada 6 meses</option></select></label>
          <label>Fecha de inicio<input type="date" name="start_date" required></label>
          <label>Fin (opcional)<input type="date" name="end_date"></label>
          <label>Nº ocurrencias (opcional)<input type="number" min="1" name="max_occurrences"></label>
          <label>IRPF %<input type="number" step="0.01" name="irpf_rate" value="0"></label>
        </div>
        <div style="margin-top:.5rem"><b>Líneas</b> <span style="color:var(--text2);font-size:12px">(1 fila mínima)</span></div>
        ${[0, 1, 2].map(i => `<div style="display:grid;grid-template-columns:3fr 1fr 1fr 1fr;gap:.4rem;margin:.2rem 0">
          <input name="desc_${i}" placeholder="Descripción"><input type="number" step="0.01" name="qty_${i}" placeholder="Cant." value="${i === 0 ? 1 : ''}">
          <input type="number" step="0.01" name="price_${i}" placeholder="Precio"><input type="number" step="0.01" name="tax_${i}" placeholder="IVA %" value="${i === 0 ? 21 : ''}"></div>`).join('')}
        <button class="btn" type="submit" style="margin-top:.5rem">Crear plantilla</button>
      </form></details>` : '';

    const content = `<div class="ph"><h2>Facturas recurrentes</h2></div>
      <div style="color:var(--text2);font-size:12px;margin-bottom:.5rem">Define facturas que se repiten (cuota/iguala). En su fecha, Bamburu crea el <b>borrador</b> y te avisa; tú lo revisas y lo emites con un clic (ahí coge la huella Verifactu). No se emite nada solo.</div>
      <div class="card"><div class="card-body"><h3>Borradores pendientes de emitir</h3></div>
        <table><thead><tr><th>Fecha</th><th>Concepto</th><th style="text-align:right">Importe</th><th>Acción</th></tr></thead><tbody>${borrHtml}</tbody></table></div>
      <div class="card" style="margin-top:1rem"><div class="card-body"><h3>Plantillas</h3><div style="margin-top:.5rem">${nueva}</div></div>
        <table><thead><tr><th>Cliente</th><th>Cadencia</th><th>Vigencia</th><th style="text-align:right">Importe</th><th>Estado</th><th>Próximas</th><th></th></tr></thead><tbody>${tplHtml}</tbody></table></div>`;
    return c.html(adminLayout('Recurrentes', content, 'recurrentes', csrf, c));
  });

  const back = c => c.redirect('/admin/recurrentes');

  views.post('/', requirePerm('recurrentes.manage'), async c => {
    try {
      const b = await c.req.parseBody();
      const lines = [0, 1, 2].map(i => ({ description: b[`desc_${i}`], quantity: b[`qty_${i}`], unit_price: b[`price_${i}`], tax_rate: b[`tax_${i}`] }));
      createTemplate(db, { client_id: b.client_id, interval_months: b.interval_months, start_date: b.start_date,
        end_date: b.end_date || null, max_occurrences: b.max_occurrences || null, irpf_rate: b.irpf_rate, lines });
    } catch (e) { return c.html(errorShell('No hemos podido completar la acción', cleanErrMsg(e.message), { action: 'Volver a Recurrentes', href: '/admin/recurrentes' }), e.status || 400); }
    return back(c);
  });

  views.post('/:id/pausar', requirePerm('recurrentes.manage'), async c => { try { await c.req.parseBody(); setTemplateStatus(db, +c.req.param('id'), 'pausada'); } catch (e) { return c.html(errorShell('No hemos podido completar la acción', cleanErrMsg(e.message), { action: 'Volver a Recurrentes', href: '/admin/recurrentes' }), e.status || 400); } return back(c); });
  views.post('/:id/activar', requirePerm('recurrentes.manage'), async c => { try { await c.req.parseBody(); setTemplateStatus(db, +c.req.param('id'), 'activa'); } catch (e) { return c.html(errorShell('No hemos podido completar la acción', cleanErrMsg(e.message), { action: 'Volver a Recurrentes', href: '/admin/recurrentes' }), e.status || 400); } return back(c); });

  // Emitir el borrador → factura real (requiere el permiso de emisión de facturas, no basta recurrentes.manage).
  views.post('/borrador/:id/emitir', requirePerm('invoices.create'), async c => {
    try { await c.req.parseBody(); emitirOcurrencia(db, +c.req.param('id')); }
    catch (e) { return c.html(errorShell('No hemos podido completar la acción', cleanErrMsg(e.message), { action: 'Volver a Recurrentes', href: '/admin/recurrentes' }), e.status || 400); }
    return back(c);
  });
  views.post('/borrador/:id/omitir', requirePerm('recurrentes.manage'), async c => { try { await c.req.parseBody(); omitirOcurrencia(db, +c.req.param('id')); } catch (e) { return c.html(errorShell('No hemos podido completar la acción', cleanErrMsg(e.message), { action: 'Volver a Recurrentes', href: '/admin/recurrentes' }), e.status || 400); } return back(c); });

  return { views };
}
