// ════════════════════════════════════════════════════════════════════════════════════════════════
// CONTROL HORARIO · LA PANTALLA — punto 12, 23 ago 2026
//
// TRES COSAS, y el orden importa porque es el de quien la usa:
//   1. FICHAR. Un botón grande que dice lo que toca ahora. Es lo que se hace catorce veces al día.
//   2. LO MÍO. Mi semana, con mis horas. **Esto no lleva permiso**: la ley da al trabajador derecho
//      a consultar SU registro, así que cualquiera que pueda entrar ve el suyo.
//   3. EL EQUIPO. Quién está dentro y el resumen de cada uno. Eso SÍ lleva permiso (`tiempo.read`),
//      porque son datos de otras personas.
//
// LO QUE NO HACE, y va escrito en la propia pantalla para que nadie lo dé por hecho: no calcula
// nóminas, no sabe de horas extra ni de convenios, y no vigila descansos mínimos. Registra y suma.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { Hono } from 'hono';
import { requirePerm } from '../../../core/auth.js';
import { checkPermission } from '../../../core/permission-check.js';
import { adminLayout } from '../layout.js';
import { escHtml } from '../../../core/escape.js';
import { safeError } from '../../../core/errors.js';
import { logActivity } from '../../../core/auth.js';
import { fichar, corregir, estadoDe, jornadaDe, resumen, quienEstaDentro, historialDe,
         horasTexto, TIPO_LABEL } from '../fichaje.js';
import { ahoraLocal } from '../citas-engine.js';

const lunesDe = f => { const d = new Date(f + 'T00:00:00Z'); const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow); return d.toISOString().slice(0, 10); };
const masDias = (f, n) => new Date(Date.parse(f + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

export function createFichajeRoutes(db) {
  const api = new Hono();
  const views = new Hono();
  const esJefe = c => !!c.get('isAdmin') || checkPermission(db, c.get('session'), 'tiempo', 'read');

  // ── API ──────────────────────────────────────────────────────────────────────────────────────
  // FICHAR LO MÍO no pide permiso: es un derecho, no una concesión. Fichar por OTRO sí, y además
  // queda apuntado quién lo hizo.
  api.post('/', async c => {
    try {
      const b = await c.req.json().catch(() => ({}));
      const yo = c.get('session')?.userId;
      const de = Number(b.user_id) || yo;
      if (de !== yo && !esJefe(c)) return c.json({ error: 'Solo puedes fichar por ti.' }, 403);
      const r = fichar(db, { userId: de, tipo: b.tipo, hora: b.hora || null, fecha: b.fecha || null,
                             hechoPor: yo, nota: b.nota || '', origen: de === yo ? 'pantalla' : 'por otro' });
      logActivity(db, c.get('session'), 'Fichó ' + (TIPO_LABEL[b.tipo] || b.tipo).toLowerCase(),
                  'fichaje', r.id, de === yo ? '' : 'por el usuario ' + de);
      return c.json(r);
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  api.post('/corregir', requirePerm('tiempo.edit'), async c => {
    try {
      const b = await c.req.json();
      const r = corregir(db, { fichajeId: Number(b.id), hora: b.hora, motivo: b.motivo,
                               hechoPor: c.get('session')?.userId || null });
      logActivity(db, c.get('session'), 'Corrigió un fichaje', 'fichaje', r.id, String(b.motivo || ''));
      return c.json(r);
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  api.get('/estado', c => {
    const yo = c.get('session')?.userId;
    const f = c.req.query('fecha') || ahoraLocal().fecha;
    return c.json({ ...estadoDe(db, yo, f), jornada: jornadaDe(db, yo, f) });
  });
  api.get('/mio', c => {
    const yo = c.get('session')?.userId;
    const desde = c.req.query('desde') || lunesDe(ahoraLocal().fecha);
    return c.json(resumen(db, yo, desde, c.req.query('hasta') || masDias(desde, 6)));
  });
  // El de OTRO sí pide permiso: son datos de otra persona.
  api.get('/de/:userId', requirePerm('tiempo.read'), c => {
    const desde = c.req.query('desde') || lunesDe(ahoraLocal().fecha);
    return c.json(resumen(db, Number(c.req.param('userId')), desde, c.req.query('hasta') || masDias(desde, 6)));
  });
  api.get('/dentro', requirePerm('tiempo.read'), c => c.json(quienEstaDentro(db, c.req.query('fecha') || null)));
  api.get('/historial/:userId/:fecha', c => {
    const yo = c.get('session')?.userId;
    if (Number(c.req.param('userId')) !== yo && !esJefe(c)) return c.json({ error: 'No puedes ver el de otra persona.' }, 403);
    return c.json(historialDe(db, Number(c.req.param('userId')), c.req.param('fecha')));
  });

  // ── LA PANTALLA ──────────────────────────────────────────────────────────────────────────────
  views.get('/', c => {
    const csrf = c.get('session')?.csrfToken || '';
    const yo = c.get('session')?.userId;
    const jefe = esJefe(c);
    const hoy = ahoraLocal().fecha;
    const st = estadoDe(db, yo, hoy);
    const lunes = lunesDe(hoy);
    const mia = resumen(db, yo, lunes, masDias(lunes, 6));
    const equipo = jefe ? db.prepare('SELECT id, name FROM admin_users WHERE active=1 ORDER BY name').all() : [];
    const dentro = jefe ? quienEstaDentro(db, hoy) : [];

    const BOTON = { entrada: ['Entrar', 'var(--ok)'], pausa: ['Pausa', 'var(--warn)'],
                    vuelta: ['Volver', 'var(--ok)'], salida: ['Salir', 'var(--danger)'] };
    const botones = st.puede.map(t =>
      `<button class="btn" data-fichar="${t}" style="background:${BOTON[t][1]};color:#fff;font-size:1rem;padding:.8rem 1.6rem">${BOTON[t][0]}</button>`).join(' ');
    const rotulo = { fuera: 'Todavía no has fichado hoy', trabajando: 'Estás trabajando desde las ' + (st.desde || '—'),
                     pausa: 'Estás en pausa desde las ' + (st.desde || '—'), cerrada: 'Jornada cerrada a las ' + (st.desde || '—') }[st.estado];

    const filaDia = (d, uid) => `<tr>
      <td>${escHtml(DIAS[(new Date(d.fecha + 'T00:00:00Z').getUTCDay() + 6) % 7])} ${escHtml(d.fecha.slice(8) + '/' + d.fecha.slice(5, 7))}</td>
      <td>${escHtml(d.entrada || '—')}</td><td>${escHtml(d.salida || (d.abierta ? 'sin cerrar' : '—'))}</td>
      <td>${escHtml(horasTexto(d.minutos))}</td>
      <td style="color:var(--text3)">${d.pausa_min ? escHtml(horasTexto(d.pausa_min)) : '—'}</td>
      <td>${d.abierta ? '<span class="badge b-warn">abierta</span>' : ''}</td>
      <td class="r"><button class="btn btn-secondary btn-sm" data-hist="${uid}|${d.fecha}">Ver fichajes</button></td></tr>`;

    const content = `
      <div class="ph"><h2>Control horario</h2></div>
      <div class="alert" style="margin-bottom:1rem">Registro de jornada. <strong>Es obligatorio por ley</strong>
        si tienes personas contratadas (RD-ley 8/2019): entrada, salida y pausas de cada día, guardado
        cuatro años y consultable por cada trabajador. <strong>Nada se borra</strong>: una corrección deja
        el fichaje original a la vista, con su motivo.
        <br><span style="color:var(--text3)">Lo que esto <strong>no</strong> hace: nóminas, horas extra,
        convenios ni descansos mínimos. Registra y suma.</span></div>

      <div class="card bf-caja" style="margin-bottom:1rem;text-align:center">
        <div style="font-size:2.2rem;font-weight:700;letter-spacing:-1px" id="reloj">--:--</div>
        <div style="color:var(--text2);margin:.3rem 0 1rem" id="rotulo">${escHtml(rotulo)}</div>
        <div style="display:flex;gap:.6rem;justify-content:center;flex-wrap:wrap" id="botones">${botones}</div>
        <div style="margin-top:.9rem;color:var(--text3);font-size:.85rem" id="llevo">Hoy llevas
          <strong>${escHtml(horasTexto(jornadaDe(db, yo, hoy).minutos))}</strong></div>
      </div>

      <div class="card bf-caja" style="margin-bottom:1rem">
        <h3 style="margin-top:0">Mi semana</h3>
        <div style="font-size:.8rem;color:var(--text2);margin-bottom:.5rem">Del ${escHtml(lunes)} al ${escHtml(masDias(lunes, 6))} ·
          total <strong>${escHtml(horasTexto(mia.total_min))}</strong>${mia.pausa_min ? ' · pausas ' + escHtml(horasTexto(mia.pausa_min)) : ''}</div>
        <div class="table-wrap"><table><thead><tr><th>Día</th><th>Entrada</th><th>Salida</th><th>Trabajado</th>
          <th>Pausas</th><th></th><th></th></tr></thead><tbody>
          ${mia.dias.map(d => filaDia(d, yo)).join('') || '<tr><td colspan="7" style="color:var(--text3);padding:1.2rem;text-align:center">Esta semana todavía no has fichado.</td></tr>'}
        </tbody></table></div>
      </div>

      ${jefe ? `
      <div class="card bf-caja">
        <h3 style="margin-top:0">El equipo</h3>
        <div style="font-size:.8rem;color:var(--text2);margin-bottom:.6rem">${dentro.length
          ? 'Ahora mismo: ' + dentro.map(d => escHtml(d.name) + ' (' + (d.estado === 'pausa' ? 'en pausa' : 'trabajando') + ')').join(' · ')
          : 'Ahora mismo no hay nadie con la jornada abierta.'}</div>
        <div style="display:flex;gap:.5rem;align-items:end;flex-wrap:wrap;margin-bottom:.7rem">
          <div class="form-group" style="margin:0"><label class="form-label">Persona</label>
            <select class="form-control" id="qUser">${equipo.map(u => `<option value="${u.id}">${escHtml(u.name)}</option>`).join('')}</select></div>
          <div class="form-group" style="margin:0"><label class="form-label">Desde</label>
            <input type="date" class="form-control" id="qDesde" value="${escHtml(lunes)}"></div>
          <div class="form-group" style="margin:0"><label class="form-label">Hasta</label>
            <input type="date" class="form-control" id="qHasta" value="${escHtml(masDias(lunes, 6))}"></div>
          <button class="btn" id="qVer">Ver</button>
          <button class="btn btn-secondary" id="qImprimir">Imprimir</button>
        </div>
        <div id="qSalida" style="color:var(--text3);font-size:.85rem">Elige una persona y un periodo.</div>
      </div>` : ''}
      <script>
      const CSRF=${JSON.stringify(csrf)}, YO=${JSON.stringify(yo)}, HOY=${JSON.stringify(hoy)};
      const DIAS=${JSON.stringify(DIAS)};
      // EL RELOJ ES EL DEL NEGOCIO, NO EL DEL ORDENADOR. Se arranca con el minuto que dice el
      // SERVIDOR y a partir de ahí se cuenta solo. Con el reloj del navegador, la captura del
      // 23 ago 2026 enseñaba «23:39» en grande y «en pausa desde las 01:39» debajo: dos relojes
      // distintos en la misma tarjeta. En un registro de jornada eso no es un detalle — parece que
      // el fichaje se apuntó a otra hora.
      const MIN_SERVIDOR = ${ahoraLocal().min}, T0 = Date.now();
      async function api(m,u,b){ const r=await fetch(u,{method:m,headers:{'Content-Type':'application/json','x-csrf-token':CSRF},body:b?JSON.stringify(b):undefined});
        let d=null; try{ d=await r.json(); }catch(e){} if(!r.ok||(d&&d.error)) throw new Error(window.cleanErrMsg((d&&d.error)||'')); return d; }
      function reloj(){
        const min = (MIN_SERVIDOR + Math.floor((Date.now()-T0)/60000)) % 1440;
        document.getElementById('reloj').textContent =
          String(Math.floor(min/60)).padStart(2,'0')+':'+String(min%60).padStart(2,'0');
      }
      function hhmm(min){ return Math.floor(min/60)+' h '+String(Math.round(min%60)).padStart(2,'0')+' min'; }
      async function ficharAhora(tipo){
        const nombres={entrada:'Entrar',pausa:'Empezar la pausa',vuelta:'Volver de la pausa',salida:'Salir'};
        const si = await window.confirmarEnPagina({ titulo: nombres[tipo],
          texto:'Se apunta con la hora de ahora. Queda registrado y no se borra: si te equivocas, se corrige y se ve la corrección.',
          aceptar:'Sí, '+nombres[tipo].toLowerCase() });
        if(!si) return;
        try{ await api('POST','/api/erp/fichaje',{tipo}); toast('Fichado'); setTimeout(()=>location.reload(),600); }
        catch(e){ toast(e.message,'err'); }
      }
      async function verHistorial(uid, fecha){
        let h=[]; try{ h=await api('GET','/api/erp/fichaje/historial/'+uid+'/'+fecha); }catch(e){ toast(e.message,'err'); return; }
        const txt = h.length ? h.map(x => x.hora+' '+x.tipo+(x.anulado?' (CORREGIDO: '+(x.motivo||'')+')':'')
          +(x.corregido_de?' [sustituye a otro]':'')).join('   |   ') : 'Sin fichajes ese día.';
        await window.confirmarEnPagina({ titulo:'Fichajes del '+fecha, texto:txt, aceptar:'Cerrar', cancelar:'Cerrar' });
      }
      window.addEventListener('DOMContentLoaded',()=>{
        reloj(); setInterval(reloj,20000);
        document.querySelectorAll('[data-fichar]').forEach(b=>b.onclick=()=>ficharAhora(b.dataset.fichar));
        document.querySelectorAll('[data-hist]').forEach(b=>b.onclick=()=>{
          const [u,f]=b.dataset.hist.split('|'); verHistorial(u,f); });
        const qv=document.getElementById('qVer');
        if(qv) qv.onclick=async()=>{
          const u=document.getElementById('qUser').value, d=document.getElementById('qDesde').value, h=document.getElementById('qHasta').value;
          const box=document.getElementById('qSalida');
          try{
            const r=await api('GET','/api/erp/fichaje/de/'+u+'?desde='+d+'&hasta='+h);
            if(!r.dias.length){ box.innerHTML='<em>Esa persona no fichó ningún día en ese periodo.</em>'; return; }
            box.innerHTML='<div style="margin-bottom:.5rem">Total <strong>'+hhmm(r.total_min)+'</strong>'
              +(r.pausa_min?' · pausas '+hhmm(r.pausa_min):'')+(r.abiertas?' · <span style="color:var(--warn)">'+r.abiertas+' jornada(s) sin cerrar</span>':'')+'</div>'
              +'<div class="table-wrap"><table><thead><tr><th>Día</th><th>Entrada</th><th>Salida</th><th>Trabajado</th><th>Pausas</th></tr></thead><tbody>'
              +r.dias.map(x=>'<tr><td>'+x.fecha+'</td><td>'+(x.entrada||'—')+'</td><td>'+(x.salida||(x.abierta?'sin cerrar':'—'))
                +'</td><td>'+hhmm(x.minutos)+'</td><td>'+(x.pausa_min?hhmm(x.pausa_min):'—')+'</td></tr>').join('')
              +'</tbody></table></div>';
          }catch(e){ box.innerHTML='<span style="color:var(--danger)">'+window.escHtmlCli(e.message)+'</span>'; }
        };
        const qi=document.getElementById('qImprimir');
        if(qi) qi.onclick=()=>window.print();
      });
      </script>`;
    return c.html(adminLayout('Control horario', content, 'fichaje', csrf, c));
  });

  return { api, views };
}
