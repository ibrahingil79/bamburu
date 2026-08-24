// RENTABILIDAD POR PROYECTO — Escalera · paso 7 · PIEZA 4 (parte 1). Pantalla + API. SOLO LECTURA.
// Panel (datos para la ficha del proyecto) y comparativa de proyectos, derivados del P&G filtrado
// (modules/erp/rentabilidad.js). Candado: proyectos.read Y el permiso de Contabilidad/P&G (invoices.read)
// en TODAS las rutas incluida la vista — se encadenan dos requirePerm (Hono los corre en orden; dueño/admin
// pasan por bypass). Sin ambos: ni entrada de menú ni URL (403).
import { Hono } from 'hono';
import { safeError } from '../../../core/errors.js';
import { adminLayout } from '../layout.js';
import { requirePerm } from '../../../core/auth.js';
import { escHtml } from '../../../core/escape.js';
import { rentabilidadProyecto, comparativaProyectos } from '../rentabilidad.js';
import { fmtEur, fmtPct, fmtNum } from '../margen.js';   // el dinero, el % y las horas, como en España

export function createRentabilidadRoutes(db) {
  const api = new Hono();
  const views = new Hono();
  const gate = [requirePerm('proyectos.read'), requirePerm('invoices.read')];   // AND de los dos permisos

  // ── API ──────────────────────────────────────────────────────────────────────
  api.get('/proyecto/:id', ...gate, c => {
    try { return c.json(rentabilidadProyecto(db, c.req.param('id'))); }
    catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });
  api.get('/comparativa', ...gate, c => {
    try { return c.json(comparativaProyectos(db)); }
    catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // ── VISTA: comparativa de proyectos (con candado) ────────────────────────────
  views.get('/', ...gate, c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const cmp = comparativaProyectos(db);
    // El dinero, escrito como en España. Una sola forma en todo el producto.
    const dinero = n => fmtEur(Number(n || 0), sym);
    const signo = n => (n < 0 ? 'color:var(--danger,#b23);font-weight:600' : (n > 0 ? 'color:var(--ok,#1a7f37)' : 'color:var(--muted)'));
    const pct = n => fmtPct(n);   // 100,0 % — con coma y con su espacio, como en España

    const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
    const totalGestion = r2(cmp.total.resultado - cmp.coste_horas_total);   // gestión total = contable − Σ coste horas

    const filas = cmp.filas.map(f => `<tr${f.pierde ? ' style="background:var(--danger-soft,rgba(220,50,50,.07))"' : ''}>
        <td style="font-family:monospace;font-size:.8rem;color:var(--muted)">${escHtml(f.codigo || '-')}</td>
        <td><strong>${escHtml(f.nombre)}</strong>${f.activo ? '' : ' <span class="badge b-gray">archivado</span>'}${f.pierde ? ' <span class="badge b-red">pierde</span>' : (f.pierde_gestion ? ' <span class="badge b-yellow" title="Gana en contable pero pierde al restar el coste de las horas">pierde con horas</span>' : '')}</td>
        <td style="white-space:nowrap;text-align:right">${dinero(f.ingresos)}</td>
        <td style="white-space:nowrap;text-align:right">${dinero(f.gastos)}</td>
        <td style="white-space:nowrap;text-align:right;${signo(f.resultado)}">${dinero(f.resultado)}</td>
        <td style="white-space:nowrap;text-align:right">${pct(f.margenPct)}</td>
        <td style="white-space:nowrap;text-align:right;color:var(--muted)">${dinero(f.coste_horas)}</td>
        <td style="white-space:nowrap;text-align:right;${signo(f.resultado_gestion)}">${dinero(f.resultado_gestion)}</td>
        <td style="white-space:nowrap;text-align:right;color:var(--muted)">${dinero(f.cobrado)}</td>
      </tr>`).join('');

    const filaEstructura = `<tr style="color:var(--muted)">
        <td></td><td><em>Estructura (no asignado a ningún proyecto)</em></td>
        <td style="text-align:right">${dinero(cmp.estructura.ingresos)}</td>
        <td style="text-align:right">${dinero(cmp.estructura.gastos)}</td>
        <td style="text-align:right;${signo(cmp.estructura.resultado)}">${dinero(cmp.estructura.resultado)}</td>
        <td></td><td style="text-align:right" title="La estructura no tiene horas imputadas">—</td><td style="text-align:right">—</td><td></td></tr>`;
    const filaTotal = `<tr style="border-top:2px solid var(--border);font-weight:700">
        <td></td><td>TOTAL (= P&amp;G de la empresa)</td>
        <td style="text-align:right">${dinero(cmp.total.ingresos)}</td>
        <td style="text-align:right">${dinero(cmp.total.gastos)}</td>
        <td style="text-align:right;${signo(cmp.total.resultado)}">${dinero(cmp.total.resultado)}</td>
        <td></td>
        <td style="text-align:right">${dinero(cmp.coste_horas_total)}</td>
        <td style="text-align:right;${signo(totalGestion)}">${dinero(totalGestion)}</td>
        <td></td></tr>`;

    const avisoHoras = cmp.hay_horas_sin_coste
      ? `<div class="alert" style="margin-bottom:1rem;background:var(--warn-s,rgba(200,140,20,.10))">
          ⚠️ Hay <strong>${fmtNum(cmp.horas_sin_coste, 2)} h</strong> sin coste-hora registrado: quedan <strong>FUERA</strong> del coste de las horas (no se cuentan como coste 0).
          Pon el <em>coste por hora</em> de esas personas en <a href="/admin/users">Usuarios</a> para que entren.
        </div>` : '';

    const content = `
      <div class="ph"><h2>Rentabilidad por proyecto</h2></div>
      <div class="alert" style="margin-bottom:1rem;background:var(--info-s,rgba(40,90,200,.08))">
        <strong>Resultado contable</strong> = ingresos (facturado sin IVA) − gastos asignados. Sale del <strong>mismo P&amp;G</strong> filtrado por proyecto:
        la suma de todos los proyectos más la estructura es el P&amp;G total de la empresa, al céntimo${cmp.cuadra ? '' : ' ⚠️ (descuadre ' + cmp.descuadre + ')'}.<br>
        <strong>Resultado de gestión</strong> = resultado contable − <strong>coste de las horas</strong> (Σ horas × coste-hora congelado). Es una capa de <strong>GESTIÓN</strong>:
        el coste de las horas <strong>NO entra en el P&amp;G</strong> ni en la contabilidad; tu resultado contable no cambia. El <em>cobrado</em> es dato de caja, no cambia el resultado.
      </div>
      ${avisoHoras}
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Código</th><th>Proyecto</th><th style="text-align:right">Ingresos</th><th style="text-align:right">Gastos</th><th style="text-align:right">Resultado contable</th><th style="text-align:right">Margen</th><th style="text-align:right">Coste horas</th><th style="text-align:right">Resultado gestión</th><th style="text-align:right">Cobrado</th></tr></thead>
        <tbody>${filas || '<tr><td colspan="9" style="color:var(--muted);text-align:center;padding:1.5rem">Aún no hay proyectos con actividad. Etiqueta facturas y gastos a un proyecto para ver su rentabilidad.</td></tr>'}
        ${filaEstructura}${filaTotal}</tbody>
      </table></div></div>`;
    return c.html(adminLayout('Rentabilidad por proyecto', content, 'rentabilidad', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
