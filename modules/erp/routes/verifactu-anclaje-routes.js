// Rutas de VERI*FACTU · Anclaje externo — pantalla CONSULTABLE del sellado RFC-3161 de la cadena,
// fuera del servidor. Solo lectura: aquí no se ancla nada (eso lo hace el barrido de systemd, único
// escritor por diseño — docs/verifactu/anclaje-externo.md). El botón «Comprobar ahora» solo VERIFICA
// (openssl ts -verify en local, sin red) y nunca escribe ni sella. Estructura calcada de
// verifactu-envio-routes.js. Aditivo: no toca invoices.js, verifactu.js, verifactu-envio.js ni
// verifactu-cola.js.
//
// El GET NO llama a verificarAnclajes(): esa función hace 3 SELECT completos + un openssl ts -verify
// POR CADA anclaje sellado, y como better-sqlite3 es síncrono, con miles de anclajes cargaría la
// pantalla congelando el proceso entero (todos los negocios) durante segundos. La auditoría completa
// solo se dispara al pulsar «Comprobar ahora», y esa comprobación va acotada a los últimos
// ANCLAJE_COMPROBAR_LIMITE anclajes por el mismo motivo (docs/verifactu/anclaje-externo.md).
import { Hono } from 'hono';
import { requirePerm } from '../../../core/auth.js';
import { adminLayout } from '../layout.js';
import { escHtml } from '../../../core/escape.js';
import { motivoAnclajeInactivo, verificarAnclajes, ANCLAJE_COMPROBAR_LIMITE } from '../verifactu-anclaje.js';

const HORAS_FRESCO = 48;
const fecha = iso => iso ? new Date(iso).toLocaleString('es-ES') : '—';

export function createVerifactuAnclajeRoutes(db) {
  const views = new Hono();

  views.get('/anclajes', requirePerm('invoices.read'), c => {
    const slug = c.get('tenant')?.slug || null;
    const motivo = motivoAnclajeInactivo(slug);
    // Sin el BLOB `token` (solo lo necesita verificarAnclajes) y acotada: pintar la tabla no debe
    // traer a memoria miles de sellos de ~2-4 KB cada uno.
    const totalSellados = db.prepare(`SELECT COUNT(*) c FROM verifactu_anclajes WHERE estado='sellado'`).get().c;
    const anclajes = db.prepare(
      `SELECT id, secuencia, raiz, sellado_at, created_at, n_facturas, cadena_ok, cadena_detalle, tsa_url
         FROM verifactu_anclajes WHERE estado='sellado' ORDER BY secuencia DESC LIMIT ?`
    ).all(ANCLAJE_COMPROBAR_LIMITE);
    const ultimo = anclajes[0] || null;

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

    // La auditoría completa (verificarAnclajes) NO se calcula aquí: solo se dispara al pulsar
    // «Comprobar ahora», y su resultado llega como flash tras la redirección (abajo).
    const q = c.req.query();
    const flash = q.comprobado
      ? (q.ok === '1'
          ? `<div style="margin:.5rem 0;padding:.5rem .75rem;border-left:3px solid var(--ok);background:var(--ok-s);font-size:12px;color:var(--ok)">Comprobado ahora: la cadena de sellos <b>cuadra</b> (${escHtml(q.n || '?')} anclaje(s) comprobado(s), sin huecos).</div>`
          : q.ok === 'sc'
            ? `<div style="margin:.5rem 0;padding:.5rem .75rem;border-left:3px solid var(--warn);background:var(--warn-s);font-size:12px;color:var(--warn)">Comprobado ahora: la cadena de raíces y la numeración cuadran, pero el sello criptográfico de ${escHtml(q.sc || '?')} de ${escHtml(q.n || '?')} anclaje(s) <b>NO se ha podido comprobar</b> — falta el certificado raíz de la TSA (VERIFACTU_ANCLAJE_TSA_CA).</div>`
            : `<div style="margin:.5rem 0;padding:.5rem .75rem;border-left:3px solid var(--danger);background:var(--danger-s);font-size:12px;color:var(--danger)">Comprobado ahora: <b>${escHtml(q.motivo || 'la cadena de sellos NO cuadra')}</b> (de ${escHtml(q.n || '?')} anclaje(s) comprobado(s)).</div>`)
      : '';

    const rows = anclajes.map(a => `<tr>
        <td>${a.secuencia}</td>
        <td>${escHtml(fecha(a.sellado_at || a.created_at))}</td>
        <td style="text-align:right">${a.n_facturas}</td>
        <td title="${escHtml(a.raiz)}" style="font-family:monospace;font-size:11px">${escHtml(a.raiz.slice(0, 16))}…</td>
        <td>${a.cadena_ok ? '<span style="color:var(--ok)">sellado</span>' : `<span style="color:var(--warn)" title="${escHtml(a.cadena_detalle || '')}">sellado · alarma en origen</span>`}</td>
        <td style="font-size:12px;color:var(--text2)">${escHtml(a.tsa_url)}</td>
      </tr>`).join('') || `<tr><td colspan="6" style="text-align:center;color:var(--text2)">Aún no hay ningún anclaje sellado.</td></tr>`;

    const nota = totalSellados > anclajes.length
      ? `<div style="color:var(--text2);font-size:12px;margin:.25rem 0">Mostrando los últimos ${anclajes.length} de ${totalSellados} anclajes.</div>`
      : '';

    const csrf = c.get('session')?.csrfToken || '';
    const content = `<div class="ph"><h2>Sellado externo (VERI*FACTU)</h2></div>
      <div style="color:var(--text2);font-size:12px;margin-bottom:.5rem">Cada cierto tiempo, una autoridad de sellado de tiempo (RFC-3161) ajena a Bamburu firma la raíz de tu material fiscal hasta ese momento. Si alguien con acceso a este servidor cambiara una factura después, esta pantalla lo diría. Solo lectura: aquí no se ancla nada.</div>
      ${cartel}
      ${flash}
      <form method="post" action="/admin/verifactu/anclajes/comprobar" style="margin:.5rem 0">
        <input type="hidden" name="_csrf" value="${escHtml(csrf)}">
        <button class="btn" type="submit">Comprobar ahora</button>
      </form>
      ${nota}
      <div class="card"><table>
        <thead><tr><th>Secuencia</th><th>Sello</th><th style="text-align:right">Facturas</th><th>Raíz</th><th>Estado</th><th>TSA</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
    return c.html(adminLayout('Sellado externo', content, 'verifactu-anclaje', csrf, c));
  });

  // Comprobar ahora: SOLO LEE. No ancla, no escribe, no llama a la TSA por red (openssl ts -verify
  // es una comprobación criptográfica local contra el certificado raíz ya guardado). Acotado a los
  // últimos ANCLAJE_COMPROBAR_LIMITE anclajes: sin acotar, el botón congela el proceso entero.
  views.post('/anclajes/comprobar', requirePerm('invoices.read'), c => {
    const veredicto = verificarAnclajes(db, { limite: ANCLAJE_COMPROBAR_LIMITE });
    let params;
    if (veredicto.ok === true) {
      params = { comprobado: '1', ok: '1', n: String(veredicto.comprobados) };
    } else if (veredicto.ok === false) {
      params = { comprobado: '1', ok: '0', n: String(veredicto.comprobados), motivo: `anclaje ${veredicto.alarma.secuencia}: ${veredicto.alarma.motivo}` };
    } else {
      // ok === null: la cadena de raíces/numeración cuadra, pero no había certificado raíz para
      // comprobar la firma de ningún token. No es un "cuadra": no se traduce nunca a ok=1.
      params = { comprobado: '1', ok: 'sc', n: String(veredicto.comprobados), sc: String(veredicto.sinComprobar) };
    }
    return c.redirect('/admin/verifactu/anclajes?' + new URLSearchParams(params).toString());
  });

  return { views };
}
