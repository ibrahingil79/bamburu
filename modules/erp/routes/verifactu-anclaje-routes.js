// Rutas de VERI*FACTU · Anclaje externo — pantalla CONSULTABLE del sellado RFC-3161 de la cadena,
// fuera del servidor. Solo lectura: aquí no se ancla nada (eso lo hace el barrido de systemd, único
// escritor por diseño — docs/verifactu/anclaje-externo.md). El botón «Comprobar los últimos N» solo
// VERIFICA (openssl ts -verify en local, sin red) y nunca escribe ni sella. Estructura calcada de
// verifactu-envio-routes.js. Aditivo: no toca invoices.js, verifactu.js, verifactu-envio.js ni
// verifactu-cola.js.
//
// El GET NO llama a verificarAnclajes(): esa función hace, por cada anclaje sellado, un
// openssl ts -verify + un openssl ts -reply -text (~11 ms), y como better-sqlite3 es síncrono, con
// miles de anclajes cargaría la pantalla congelando el proceso entero (todos los negocios) durante
// segundos. La auditoría COMPLETA de la cadena la hace, una vez al día, el barrido de systemd
// (scripts/bamburu-anclaje-verifactu.mjs), que guarda su veredicto en verifactu_anclajes_auditorias —
// esta pantalla solo LEE esa última fila y la enseña con su antigüedad. El botón «Comprobar los
// últimos N» dispara una comprobación acotada, en el momento, para el tramo final.
import { Hono } from 'hono';
import { requirePerm } from '../../../core/auth.js';
import { adminLayout } from '../layout.js';
import { escHtml } from '../../../core/escape.js';
import { motivoAnclajeInactivo, verificarAnclajes, textoVeredicto, ANCLAJE_COMPROBAR_LIMITE, ANCLAJE_LATIDO_H } from '../verifactu-anclaje.js';

const HORAS_FRESCO = 48;
const fecha = iso => iso ? new Date(iso).toLocaleString('es-ES') : '—';

// El veredicto de la fila de la auditoría (columnas de verifactu_anclajes_auditorias) traducido al
// mismo objeto que espera textoVeredicto(), para que la pantalla, el botón y el correo no puedan decir
// cosas distintas sobre el mismo estado.
function veredictoDeAuditoria(a) {
  return {
    veredicto: a.veredicto, totalFilas: a.total_filas, sellados: a.sellados, verificados: a.verificados,
    sinComprobar: a.sin_comprobar, fueraDeVentana: a.fuera_de_ventana, alarmadas: a.alarmadas,
    alarma: a.alarma_secuencia != null ? { secuencia: a.alarma_secuencia, sellado_at: null, motivo: a.alarma_motivo } : null,
  };
}

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

    // La auditoría COMPLETA (recorrer TODA la sucesión, no solo la tabla de arriba) no se calcula
    // aquí: la hace, una vez al día, el barrido de systemd, y esta pantalla solo lee su último
    // resultado — con su antigüedad, y en ámbar en cuanto pasa de 2 × ANCLAJE_LATIDO_H, aunque el
    // veredicto guardado dijera que todo estaba en orden. Un veredicto guardado sin caducidad es un
    // censo que dice CERO (CLAUDE.md).
    const ultimaAuditoria = db.prepare('SELECT * FROM verifactu_anclajes_auditorias ORDER BY id DESC LIMIT 1').get() || null;
    let bloqueAuditoria;
    if (!ultimaAuditoria) {
      bloqueAuditoria = `<div style="margin:.5rem 0;padding:.5rem .75rem;border-left:3px solid var(--warn);background:var(--warn-s);font-size:12px;color:var(--warn)"><b>Nunca se ha recorrido la cadena de sellos entera.</b> La tabla de más abajo son solo los últimos ${ANCLAJE_COMPROBAR_LIMITE}; el recorrido completo lo hace, una vez al día, el barrido de systemd.</div>`;
    } else {
      const edadAuditoriaH = (Date.now() - Date.parse(ultimaAuditoria.corrida_at)) / 3600000;
      const auditoriaFresca = edadAuditoriaH <= ANCLAJE_LATIDO_H * 2;
      const textoAud = textoVeredicto(veredictoDeAuditoria(ultimaAuditoria));
      if (!auditoriaFresca) {
        bloqueAuditoria = `<div style="margin:.5rem 0;padding:.5rem .75rem;border-left:3px solid var(--warn);background:var(--warn-s);font-size:12px;color:var(--warn)"><b>Última auditoría completa: ${escHtml(fecha(ultimaAuditoria.corrida_at))}.</b> Este resultado ya no vale: es de hace ${Math.round(edadAuditoriaH)} h (más de ${ANCLAJE_LATIDO_H * 2} h). Decía: ${escHtml(textoAud)}</div>`;
      } else {
        const color = ultimaAuditoria.veredicto === 'cuadra' ? 'ok' : (ultimaAuditoria.veredicto === 'alarma' ? 'danger' : 'warn');
        bloqueAuditoria = `<div style="margin:.5rem 0;padding:.5rem .75rem;border-left:3px solid var(--${color});background:var(--${color}-s);font-size:12px;color:var(--${color})"><b>Última auditoría completa</b> (${escHtml(fecha(ultimaAuditoria.corrida_at))}): ${escHtml(textoAud)}</div>`;
      }
    }

    const q = c.req.query();
    const flash = q.comprobado
      ? (() => {
          const color = q.v === 'cuadra' ? 'ok' : (q.v === 'alarma' ? 'danger' : 'warn');
          return `<div style="margin:.5rem 0;padding:.5rem .75rem;border-left:3px solid var(--${color});background:var(--${color}-s);font-size:12px;color:var(--${color})">Comprobado ahora: ${escHtml(q.msg || 'sin detalle')}</div>`;
        })()
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
      ${bloqueAuditoria}
      ${flash}
      <form method="post" action="/admin/verifactu/anclajes/comprobar" style="margin:.5rem 0">
        <input type="hidden" name="_csrf" value="${escHtml(csrf)}">
        <button class="btn" type="submit">Comprobar los últimos ${ANCLAJE_COMPROBAR_LIMITE}</button>
      </form>
      ${nota}
      <div class="card"><table>
        <thead><tr><th>Secuencia</th><th>Sello</th><th style="text-align:right">Facturas</th><th>Raíz</th><th>Estado</th><th>TSA</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
    return c.html(adminLayout('Sellado externo', content, 'verifactu-anclaje', csrf, c));
  });

  // Comprobar los últimos N: SOLO LEE. No ancla, no escribe, no llama a la TSA por red (openssl
  // ts -verify es una comprobación criptográfica local contra el certificado ya guardado). Acotado a
  // los últimos ANCLAJE_COMPROBAR_LIMITE anclajes: sin acotar, el botón congela el proceso entero. Con
  // menos anclajes sellados que el total, el veredicto es SIEMPRE 'parcial' — nunca dice que todo está
  // en orden sobre anclajes que no ha mirado.
  views.post('/anclajes/comprobar', requirePerm('invoices.read'), c => {
    const veredicto = verificarAnclajes(db, { limite: ANCLAJE_COMPROBAR_LIMITE });
    const comprobados = veredicto.sellados - veredicto.fueraDeVentana;
    const params = {
      comprobado: '1', v: veredicto.veredicto, n: String(comprobados), total: String(veredicto.sellados),
      msg: textoVeredicto(veredicto),
    };
    return c.redirect('/admin/verifactu/anclajes?' + new URLSearchParams(params).toString());
  });

  return { views };
}
