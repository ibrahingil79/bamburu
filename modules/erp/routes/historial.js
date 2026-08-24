// ─────────────────────────────────────────────────────────────────────────────────────────────────
// HISTORIAL CLÍNICO · las pantallas. Peldaño 8, oficio salud y bienestar.
//
// TODO lo de aquí pasa por DOS puertas, en este orden:
//   1. `tieneHistorial(db)` — ¿este negocio es de salud? Si no, la ruta ni existe: 404. En una
//      peluquería o un taller no hay nada que encontrar ni forzando la dirección.
//   2. `requireHistorial()` — el permiso, que **no perdona el rol de administrador**. Ver el porqué
//      en `core/auth.js`.
//
// Y nada de enseñar la puerta y dar error al empujarla: quien no tiene el permiso no ve la pestaña.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import { requireHistorial, puedeHistorial } from '../../../core/auth.js';
import { adminLayout, printableShell, errorShell, ERR, cleanErrMsg } from '../layout.js';
import { escHtml } from '../../../core/escape.js';
import { fechaEs } from '../voz.js';
import {
  tieneHistorial, consentimientoDe, tieneConsentimientoVivo, otorgarConsentimiento, revocarConsentimiento,
  antecedentesVigentes, antecedentesHistorico, guardarAntecedentes, notasDe, crearNota,
  registrarAcceso, accesosDe, conservacionDe, copiaParaPaciente,
  CONSENTIMIENTO_TEXTO, CONSENTIMIENTO_VERSION, SIN_CONSENTIMIENTO,
  borrarHistorial, AVISO_BORRADO,
} from '../historial.js';

const esc = escHtml;
const quien = c => ({ userId: c.get('session')?.userId || null, userNombre: c.get('session')?.userName || '' });

// La primera puerta: fuera del oficio de salud, estas rutas NO EXISTEN.
const soloSalud = db => async (c, next) => {
  if (!tieneHistorial(db)) return c.notFound();
  return next();
};

export function createHistorialRoutes(db) {
  const views = new Hono();
  const api = new Hono();
  views.use('*', soloSalud(db));
  api.use('*', soloSalud(db));
  views.use('*', requireHistorial());
  api.use('*', requireHistorial());

  // ── LA PESTAÑA DEL PACIENTE ───────────────────────────────────────────────────────────────────
  views.get('/:id{[0-9]+}', c => {
    const id = +c.req.param('id');
    const cli = db.prepare('SELECT id, name FROM clients WHERE id=?').get(id);
    if (!cli) return c.html(errorShell('No encontramos a ese paciente', ERR.PAGE, { action: 'Ver pacientes', href: '/admin/clients' }), 404);
    const csrf = c.get('session')?.csrfToken || '';

    // ABRIR EL HISTORIAL ES UN ACCESO, y se registra antes de pintar nada.
    registrarAcceso(db, id, { ...quien(c), accion: 'abrir', detalle: 'Abrió el historial en pantalla' });

    const cons = consentimientoDe(db, id);
    const vivo = !!(cons && !cons.revocado_at);
    const ant = antecedentesVigentes(db, id);
    const hist = antecedentesHistorico(db, id);
    const notas = notasDe(db, id);
    const cons2 = conservacionDe(db, id);

    const avisoConsent = vivo
      ? `<div class="alert" style="background:var(--ok-s,#E4F6EA);border:1px solid #CDE8D8;color:#157F3B;margin-bottom:1rem">
           Autorización recogida el ${esc(fechaEs((cons.otorgado_at || '').slice(0, 10)))} por ${esc(cons.otorgado_por_nombre || '—')}
           (versión ${esc(cons.version)}).
           <form method="post" action="/admin/historial/${id}/consentimiento/revocar" style="display:inline;margin-left:.5rem">
             <input type="hidden" name="_csrf" value="${esc(csrf)}">
             <button class="btn btn-ghost" type="submit">Retirar la autorización</button>
           </form>
         </div>`
      : `<div class="alert alert-warn" style="margin-bottom:1rem">
           <strong>${cons ? 'La autorización está retirada.' : 'Este paciente aún no ha autorizado nada.'}</strong>
           <div style="margin-top:.3rem">${esc(SIN_CONSENTIMIENTO)}</div>
           ${cons ? `<div style="margin-top:.3rem;color:var(--text2);font-size:12px">Retirada el ${esc(fechaEs((cons.revocado_at || '').slice(0, 10)))}. El historial se conserva: la ley obliga.</div>` : ''}
           <details style="margin-top:.6rem"><summary class="btn" style="display:inline-block">Recoger la autorización</summary>
             <form method="post" action="/admin/historial/${id}/consentimiento" style="margin-top:.6rem;max-width:44rem">
               <input type="hidden" name="_csrf" value="${esc(csrf)}">
               <div style="white-space:pre-wrap;background:var(--bg3);padding:.8rem;border-radius:6px;font-size:13px">${esc(CONSENTIMIENTO_TEXTO)}</div>
               <div style="color:var(--text2);font-size:12px;margin:.4rem 0">Se guarda este texto entero, con la fecha y tu nombre. Versión ${esc(CONSENTIMIENTO_VERSION)}.</div>
               <button class="btn" type="submit">El paciente lo ha autorizado</button>
             </form>
           </details>
         </div>`;

    const campo = (n, et, v) => `<label style="display:block;margin-bottom:.5rem">${esc(et)}
      <textarea name="${n}" rows="2" class="form-control" ${vivo ? '' : 'disabled'}>${esc(v || '')}</textarea></label>`;

    const antHtml = `<div class="card"><div class="card-body">
        <h3>Antecedentes</h3>
        <div style="color:var(--text2);font-size:12px;margin-bottom:.6rem">Al guardar no se pisa lo anterior: se añade una versión con su fecha y su autor.</div>
        <form method="post" action="/admin/historial/${id}/antecedentes">
          <input type="hidden" name="_csrf" value="${esc(csrf)}">
          ${campo('motivo_consulta', 'Motivo de consulta', ant?.motivo_consulta)}
          ${campo('antecedentes', 'Antecedentes', ant?.antecedentes)}
          ${campo('alergias', 'Alergias', ant?.alergias)}
          ${campo('medicacion', 'Medicación', ant?.medicacion)}
          ${campo('observaciones', 'Observaciones', ant?.observaciones)}
          <button class="btn" type="submit" ${vivo ? '' : 'disabled'}>Guardar antecedentes</button>
          ${vivo ? '' : '<span style="color:var(--warn);font-size:12px;margin-left:.5rem">Necesitas su autorización para escribir.</span>'}
        </form>
        ${hist.length > 1 ? `<details style="margin-top:.8rem"><summary style="cursor:pointer;color:var(--text2);font-size:13px">Ver las ${hist.length} versiones anteriores</summary>
          <ul style="margin-top:.5rem;font-size:13px">${hist.map(h => `<li>Versión ${h.version} · ${esc(fechaEs((h.created_at || '').slice(0, 10)))} · ${esc(h.autor_nombre || '—')}</li>`).join('')}</ul></details>` : ''}
      </div></div>`;

    const notaHtml = n => {
      const corregida = notas.find(x => x.corrige_nota_id === n.id);
      return `<div class="card" style="margin-top:.6rem"><div class="card-body">
        <div style="display:flex;justify-content:space-between;gap:1rem">
          <strong>${esc(fechaEs(n.fecha))} · ${esc(n.profesional_nombre || '—')}</strong>
          ${n.corrige_nota_id ? `<span style="color:var(--warn);font-size:12px">Corrige a la nota #${n.corrige_nota_id}</span>` : ''}
          ${corregida ? `<span style="color:var(--text2);font-size:12px">Corregida por la #${corregida.id} — se conserva</span>` : ''}
        </div>
        ${n.valoracion ? `<div style="margin-top:.3rem"><em>Valoración:</em> ${esc(n.valoracion)}</div>` : ''}
        ${n.tratamiento ? `<div><em>Tratamiento:</em> ${esc(n.tratamiento)}</div>` : ''}
        ${n.siguiente_paso ? `<div><em>Siguiente paso:</em> ${esc(n.siguiente_paso)}</div>` : ''}
        ${n.privado ? `<div style="margin-top:.4rem;padding:.5rem;background:var(--bg3);border-left:3px solid var(--warn);font-size:13px">
            <strong>Anotación privada</strong> — <span style="color:var(--text2)">no se entrega al paciente en su copia; la ley excluye del derecho de acceso las anotaciones subjetivas del profesional.</span>
            <div style="margin-top:.3rem">${esc(n.privado)}</div></div>` : ''}
      </div></div>`;
    };

    const content = `<div class="ph"><h2>Historial clínico · ${esc(cli.name)}</h2>
        <div style="display:flex;gap:.5rem">
          <a class="btn btn-secondary" href="/admin/clients/${id}">Volver a la ficha</a>
          <a class="btn btn-secondary" href="/admin/historial/${id}/copia" target="_blank">Copia para el paciente</a>
        </div></div>
      <div class="alert" style="margin-bottom:1rem;background:var(--bg3);color:var(--text2);font-size:12px">${esc(cons2.texto)}</div>
      ${avisoConsent}
      ${antHtml}
      <div class="card" style="margin-top:1rem"><div class="card-body">
        <h3>Evolución por sesión</h3>
        <div style="color:var(--text2);font-size:12px">Una nota firmada no se borra ni se pisa: se corrige añadiendo otra, y la anterior sigue visible.</div>
        <details style="margin-top:.6rem"><summary class="btn" style="display:inline-block">+ Nueva nota de sesión</summary>
          <form method="post" action="/admin/historial/${id}/nota" style="margin-top:.6rem;max-width:44rem">
            <input type="hidden" name="_csrf" value="${esc(csrf)}">
            <label style="display:block">Fecha<input type="date" name="fecha" class="form-control" value="${new Date().toISOString().slice(0, 10)}" required></label>
            ${campo('valoracion', 'Qué se valoró', '')}
            ${campo('tratamiento', 'Qué se hizo', '')}
            ${campo('siguiente_paso', 'Siguiente paso', '')}
            <label style="display:block;margin-bottom:.5rem">Anotación privada
              <span style="color:var(--text2);font-size:12px">— tuya. NO se entrega al paciente en su copia.</span>
              <textarea name="privado" rows="2" class="form-control" ${vivo ? '' : 'disabled'}></textarea></label>
            <button class="btn" type="submit" ${vivo ? '' : 'disabled'}>Guardar la nota</button>
          </form></details>
        ${notas.length ? notas.map(notaHtml).join('') : '<div style="color:var(--text2);margin-top:.6rem">Todavía no hay sesiones registradas.</div>'}
      </div></div>
      ${c.get('session')?.role === 'owner' ? `<details style="margin-top:1.5rem"><summary style="cursor:pointer;color:var(--danger,#b23);font-size:13px">Borrar este historial</summary>
        <div class="alert alert-err" style="margin-top:.6rem">${esc(AVISO_BORRADO)}</div>
        <form method="post" action="/admin/historial/${id}/borrar" style="max-width:36rem">
          <input type="hidden" name="_csrf" value="${esc(csrf)}">
          <label style="display:block;margin-bottom:.4rem">Escribe <strong>${esc(cli.name)}</strong> para confirmar
            <input name="confirmar" class="form-control" autocomplete="off" placeholder="${esc(cli.name)}"></label>
          <button class="btn btn-danger" type="submit">Borrar el historial</button>
        </form></details>` : ''}`;
    return c.html(adminLayout('Historial clínico', content, 'clients', csrf, c));
  });

  const volver = (c, id) => c.redirect('/admin/historial/' + id);
  const conError = (c, e) => c.html(errorShell('No hemos podido completar la acción', cleanErrMsg(e.message),
    { action: 'Volver al historial', href: '/admin/historial/' + c.req.param('id') }), e.status || 400);

  views.post('/:id{[0-9]+}/consentimiento', async c => {
    const id = +c.req.param('id');
    try { await c.req.parseBody(); otorgarConsentimiento(db, id, quien(c)); } catch (e) { return conError(c, e); }
    return volver(c, id);
  });
  views.post('/:id{[0-9]+}/consentimiento/revocar', async c => {
    const id = +c.req.param('id');
    try { const b = await c.req.parseBody(); revocarConsentimiento(db, id, { ...quien(c), motivo: b.motivo }); } catch (e) { return conError(c, e); }
    return volver(c, id);
  });
  views.post('/:id{[0-9]+}/antecedentes', async c => {
    const id = +c.req.param('id');
    try { const b = await c.req.parseBody(); guardarAntecedentes(db, id, b, quien(c)); } catch (e) { return conError(c, e); }
    return volver(c, id);
  });
  views.post('/:id{[0-9]+}/nota', async c => {
    const id = +c.req.param('id');
    try { const b = await c.req.parseBody(); crearNota(db, id, b, quien(c)); } catch (e) { return conError(c, e); }
    return volver(c, id);
  });

  // ── LA COPIA PARA EL PACIENTE — SIN LAS ANOTACIONES PRIVADAS ─────────────────────────────────
  views.get('/:id{[0-9]+}/copia', c => {
    const id = +c.req.param('id');
    const d = copiaParaPaciente(db, id);
    if (!d.cliente) return c.notFound();
    registrarAcceso(db, id, { ...quien(c), accion: 'exportar', detalle: 'Generó la copia del historial para el paciente' });
    const bloque = n => `<div style="margin:10px 0;padding:8px 0;border-top:1px solid #ddd">
        <strong>${esc(fechaEs(n.fecha))}</strong> — ${esc(n.profesional_nombre || '')}
        ${n.corrige_nota_id ? ' <em>(corrige a una nota anterior)</em>' : ''}
        ${n.valoracion ? '<div><b>Valoración:</b> ' + esc(n.valoracion) + '</div>' : ''}
        ${n.tratamiento ? '<div><b>Tratamiento:</b> ' + esc(n.tratamiento) + '</div>' : ''}
        ${n.siguiente_paso ? '<div><b>Siguiente paso:</b> ' + esc(n.siguiente_paso) + '</div>' : ''}
      </div>`;
    const a = d.antecedentes;
    const html = `<h1>Historial clínico</h1>
      <p><strong>${esc(d.cliente.name)}</strong>${d.cliente.fecha_nacimiento ? ' · nacida/o el ' + esc(fechaEs(d.cliente.fecha_nacimiento)) : ''}</p>
      <p style="color:#555;font-size:12px">Copia generada el ${esc(fechaEs(d.generado.slice(0, 10)))}. No incluye las anotaciones
      subjetivas del profesional: la ley las excluye del derecho de acceso.</p>
      ${a ? `<h2>Antecedentes</h2>
        ${a.motivo_consulta ? '<div><b>Motivo de consulta:</b> ' + esc(a.motivo_consulta) + '</div>' : ''}
        ${a.antecedentes ? '<div><b>Antecedentes:</b> ' + esc(a.antecedentes) + '</div>' : ''}
        ${a.alergias ? '<div><b>Alergias:</b> ' + esc(a.alergias) + '</div>' : ''}
        ${a.medicacion ? '<div><b>Medicación:</b> ' + esc(a.medicacion) + '</div>' : ''}
        ${a.observaciones ? '<div><b>Observaciones:</b> ' + esc(a.observaciones) + '</div>' : ''}` : ''}
      <h2>Evolución</h2>
      ${d.notas.length ? d.notas.map(bloque).join('') : '<p>Sin sesiones registradas.</p>'}`;
    return c.html(printableShell(html, { title: 'Historial clínico · ' + d.cliente.name }));
  });

  // ── BORRAR — A MANO, CON DOBLE CONFIRMACIÓN Y LA LEY DELANTE ─────────────────────────────────
  views.post('/:id{[0-9]+}/borrar', async c => {
    const id = +c.req.param('id');
    if (c.get('session')?.role !== 'owner') {
      return c.html(errorShell('Solo la persona dueña puede borrar un historial',
        'Borrar un historial clínico es una decisión con consecuencias legales, así que la toma quien responde ante la ley.',
        { action: 'Volver', href: '/admin/historial/' + id }), 403);
    }
    try {
      const b = await c.req.parseBody();
      // LA SEGUNDA CONFIRMACIÓN, y no es un adorno: hay que escribir el nombre del paciente. Una
      // ventana de «¿seguro?» se acepta sin leer; escribir el nombre obliga a mirar a quién borras.
      const cli = db.prepare('SELECT name FROM clients WHERE id=?').get(id);
      if (!cli) return c.notFound();
      if (String(b.confirmar || '').trim().toLowerCase() !== String(cli.name).trim().toLowerCase()) {
        return c.html(errorShell('No se ha borrado nada',
          'Para borrar hay que escribir el nombre del paciente exactamente como aparece en su ficha. '
          + 'Es la segunda confirmación: obliga a mirar a quién se está borrando.',
          { action: 'Volver al historial', href: '/admin/historial/' + id }), 400);
      }
      borrarHistorial(db, id, quien(c));
    } catch (e) { return conError(c, e); }
    return c.redirect('/admin/historial/' + id);
  });

  // ── EL REGISTRO DE ACCESOS — pantalla del dueño ───────────────────────────────────────────────
  views.get('/accesos', c => {
    const clientId = +(c.req.query('paciente') || 0) || null;
    const userId = +(c.req.query('persona') || 0) || null;
    const filas = accesosDe(db, { clientId, userId });
    const VERBO = { abrir: 'abrió el historial de', escribir: 'escribió en el historial de',
      corregir: 'corrigió una nota del historial de', imprimir: 'imprimió el historial de',
      exportar: 'generó la copia del historial de', borrar: 'BORRÓ el historial de',
      consentimiento: 'tocó la autorización de' };
    const pacientes = db.prepare('SELECT DISTINCT a.client_id id, c.name FROM hc_accesos a LEFT JOIN clients c ON c.id=a.client_id ORDER BY c.name').all();
    const personas = db.prepare('SELECT DISTINCT user_id id, user_nombre nombre FROM hc_accesos WHERE user_id IS NOT NULL ORDER BY user_nombre').all();
    const opt = (l, sel, val, txt) => `<option value="${val}"${String(sel) === String(val) ? ' selected' : ''}>${esc(txt)}</option>`;
    const content = `<div class="ph"><h2>Quién ha abierto un historial</h2></div>
      <div style="color:var(--text2);font-size:12px;margin-bottom:.6rem">Cada vez que alguien abre, escribe, corrige o exporta un historial queda aquí. Este registro no se puede editar ni borrar desde Bamburu.</div>
      <form method="get" style="display:flex;gap:.5rem;margin-bottom:1rem">
        <select name="paciente" class="form-control" style="max-width:16rem">${opt(0, clientId, '', 'Todos los pacientes')}${pacientes.map(p => opt(0, clientId, p.id, p.name || ('#' + p.id))).join('')}</select>
        <select name="persona" class="form-control" style="max-width:16rem">${opt(0, userId, '', 'Todas las personas')}${personas.map(p => opt(0, userId, p.id, p.nombre || ('#' + p.id))).join('')}</select>
        <button class="btn" type="submit">Filtrar</button>
      </form>
      <div class="card"><table><thead><tr><th>Cuándo</th><th>Qué pasó</th></tr></thead><tbody>
        ${filas.length ? filas.map(f => `<tr><td style="white-space:nowrap">${esc(fechaEs((f.created_at || '').slice(0, 10)))} ${esc((f.created_at || '').slice(11, 16))}</td>
          <td><strong>${esc(f.user_nombre || 'Alguien')}</strong> ${esc(VERBO[f.accion] || f.accion)} <strong>${esc(f.client_name || ('#' + f.client_id))}</strong>${f.detalle ? ' — <span style="color:var(--text2)">' + esc(f.detalle) + '</span>' : ''}</td></tr>`).join('')
          : '<tr><td colspan="2" style="color:var(--text2)">Todavía no ha entrado nadie a ningún historial.</td></tr>'}
      </tbody></table></div>`;
    return c.html(adminLayout('Quién ha abierto un historial', content, 'historial-accesos', c.get('session')?.csrfToken || '', c));
  });

  return { views, api };
}
