// Rutas de VERI*FACTU · Anclaje externo — pantalla CONSULTABLE del sellado RFC-3161 de la cadena,
// fuera del servidor. Solo lectura: aquí no se ancla nada (eso lo hace el barrido de systemd, único
// escritor por diseño — docs/verifactu/anclaje-externo.md). El botón «Comprobar ahora» solo VERIFICA
// (openssl ts -verify en local, sin red) y nunca escribe ni sella. Estructura calcada de
// verifactu-envio-routes.js. Aditivo: no toca invoices.js, verifactu.js, verifactu-envio.js ni
// verifactu-cola.js.
import { Hono } from 'hono';
import { requirePerm } from '../../../core/auth.js';
import { adminLayout } from '../layout.js';
import { escHtml } from '../../../core/escape.js';
import { motivoAnclajeInactivo, verificarAnclajes } from '../verifactu-anclaje.js';

const HORAS_FRESCO = 48;
const fecha = iso => iso ? new Date(iso).toLocaleString('es-ES') : '—';

export function createVerifactuAnclajeRoutes(db) {
  const views = new Hono();

  views.get('/anclajes', requirePerm('invoices.read'), c => {
    const slug = c.get('tenant')?.slug || null;
    const motivo = motivoAnclajeInactivo(slug);
    const anclajes = db.prepare(`SELECT * FROM verifactu_anclajes WHERE estado='sellado' ORDER BY secuencia DESC`).all();
    const ultimo = anclajes[0] || null;

    // Solo lee (openssl ts -verify en local, sin red): seguro de llamar en cada carga de la pantalla.
    const veredicto = verificarAnclajes(db);

    const frescoH = ultimo ? (Date.now() - Date.parse(ultimo.created_at)) / 3600000 : Infinity;
    const activoYFresco = motivo === null && ultimo && frescoH < HORAS_FRESCO;

    let cartel;
    if (activoYFresco) {
      cartel = `<div style="margin:.5rem 0;padding:.5rem .75rem;border-left:3px solid var(--ok);background:var(--ok-s);font-size:12px;color:var(--ok)"><b>Sellado externo activo.</b> Último sello: ${escHtml(fecha(ultimo.sellado_at || ultimo.created_at))} (secuencia ${ultimo.secuencia}). Un tercero de fuera puede demostrar que tu material fiscal, hasta ese punto, no se ha tocado.</div>`;
    } else if (!ultimo) {
      cartel = `<div style="margin:.5rem 0;padding:.5rem .75rem;border-left:3px solid var(--danger);background:var(--danger-s);font-size:12px;color:var(--danger)"><b>Nunca se ha sellado nada.</b> Tus facturas se encadenan entre sí, pero hoy nadie de fuera puede demostrar que no se han tocado.${motivo ? ' ' + escHtml(motivo) : ''}</div>`;
    } else {
      const razon = motivo || `El último sello tiene ${Math.round(frescoH)} h (más de ${HORAS_FRESCO} h).`;
      cartel = `<div style="margin:.5rem 0;padding:.5rem .75rem;border-left:3px solid var(--warn);background:var(--warn-s);font-size:12px;color:var(--warn)"><b>Sellado externo inactivo o atrasado.</b> ${escHtml(razon)} Último sello: ${escHtml(fecha(ultimo.sellado_at || ultimo.created_at))} (secuencia ${ultimo.secuencia}).</div>`;
    }

    const auditoria = veredicto.ok
      ? (veredicto.total ? `<div style="margin:.5rem 0;padding:.5rem .75rem;border-left:3px solid var(--ok);background:var(--ok-s);font-size:12px;color:var(--ok)">Comprobación de la cadena de sellos: <b>cuadra</b> (${veredicto.total} anclaje(s), sin huecos).</div>` : '')
      : `<div style="margin:.5rem 0;padding:.5rem .75rem;border-left:3px solid var(--danger);background:var(--danger-s);font-size:12px;color:var(--danger)"><b>ALARMA en el anclaje ${veredicto.alarma.secuencia}:</b> ${escHtml(veredicto.alarma.motivo)}.</div>`;

    const q = c.req.query();
    const flash = q.comprobado
      ? (q.ok === '1'
          ? `<div style="margin:.5rem 0;padding:.5rem .75rem;border-left:3px solid var(--ok);background:var(--ok-s);font-size:12px;color:var(--ok)">Comprobado ahora: la cadena de sellos cuadra.</div>`
          : `<div style="margin:.5rem 0;padding:.5rem .75rem;border-left:3px solid var(--danger);background:var(--danger-s);font-size:12px;color:var(--danger)">Comprobado ahora: ${escHtml(q.motivo || 'la cadena de sellos NO cuadra')}.</div>`)
      : '';

    const rows = anclajes.map(a => `<tr>
        <td>${a.secuencia}</td>
        <td>${escHtml(fecha(a.sellado_at || a.created_at))}</td>
        <td style="text-align:right">${a.n_facturas}</td>
        <td title="${escHtml(a.raiz)}" style="font-family:monospace;font-size:11px">${escHtml(a.raiz.slice(0, 16))}…</td>
        <td>${a.cadena_ok ? '<span style="color:var(--ok)">sellado</span>' : `<span style="color:var(--warn)" title="${escHtml(a.cadena_detalle || '')}">sellado · alarma en origen</span>`}</td>
        <td style="font-size:12px;color:var(--text2)">${escHtml(a.tsa_url)}</td>
      </tr>`).join('') || `<tr><td colspan="6" style="text-align:center;color:var(--text2)">Aún no hay ningún anclaje sellado.</td></tr>`;

    const csrf = c.get('session')?.csrfToken || '';
    const content = `<div class="ph"><h2>Sellado externo (VERI*FACTU)</h2></div>
      <div style="color:var(--text2);font-size:12px;margin-bottom:.5rem">Cada cierto tiempo, una autoridad de sellado de tiempo (RFC-3161) ajena a Bamburu firma la raíz de tu material fiscal hasta ese momento. Si alguien con acceso a este servidor cambiara una factura después, esta pantalla lo diría. Solo lectura: aquí no se ancla nada.</div>
      ${cartel}
      ${auditoria}
      ${flash}
      <form method="post" action="/admin/verifactu/anclajes/comprobar" style="margin:.5rem 0">
        <input type="hidden" name="_csrf" value="${escHtml(csrf)}">
        <button class="btn" type="submit">Comprobar ahora</button>
      </form>
      <div class="card"><table>
        <thead><tr><th>Secuencia</th><th>Sello</th><th style="text-align:right">Facturas</th><th>Raíz</th><th>Estado</th><th>TSA</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
    return c.html(adminLayout('Sellado externo', content, 'verifactu-anclaje', csrf, c));
  });

  // Comprobar ahora: SOLO LEE. No ancla, no escribe, no llama a la TSA por red (openssl ts -verify
  // es una comprobación criptográfica local contra el certificado raíz ya guardado).
  views.post('/anclajes/comprobar', requirePerm('invoices.read'), c => {
    const veredicto = verificarAnclajes(db);
    const params = veredicto.ok
      ? { comprobado: '1', ok: '1' }
      : { comprobado: '1', ok: '0', motivo: `anclaje ${veredicto.alarma.secuencia}: ${veredicto.alarma.motivo}` };
    return c.redirect('/admin/verifactu/anclajes?' + new URLSearchParams(params).toString());
  });

  return { views };
}
