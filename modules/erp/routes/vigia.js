// EL VIGÍA — rutas. Escalera · paso 5 (DISA predictiva) · PIEZA 1.
// La puerta visual del motor de detección (`modules/erp/vigia.js`): una LISTA cruda pero real de
// hallazgos (área · qué · cifra · fecha · motivo). Sin gráficos ni diseño todavía — eso es de piezas
// posteriores; aquí solo se demuestra que el vigía detecta y cuadra.
//
// PERMISOS (las dos puertas, CANON §3-bis): la página se gatea con `analytics.read`, como el
// constructor. DENTRO, cada detector solo corre si el usuario tiene el permiso de la pantalla que
// posee su cifra (`hasPerm` = `can(c,·)`), y se DICE qué falta en vez de dejar un hueco mudo. Forzar
// un detector sin su permiso (`?detector=`) devuelve 403 — el desplegable filtrado no es el candado.
import { Hono } from 'hono';
import { safeError } from '../../../core/errors.js';
import { adminLayout, can } from '../layout.js';
import { requirePerm } from '../../../core/auth.js';
import { detectar, catalogoDetectores } from '../vigia.js';
import { narrar } from '../voz.js';   // Escalera · paso 5 — DISA predictiva · PIEZA 2: la voz
import { graficoDe } from '../dibujo.js';   // Escalera · paso 5 — DISA predictiva · PIEZA 3: el dibujo
import { priorizar } from '../prioridad.js';   // Escalera · paso 5 — DISA predictiva · PIEZA 5: dónde te espera

export function createVigiaRoutes(db) {
  const api = new Hono();
  const views = new Hono();
  const permDe = c => (p) => can(c, p);

  // PIEZA 3: resolvedores de rótulo para el filtro del gráfico (solo lectura, un nombre — NO una cifra).
  // El nombre ya es visible en el aviso; `cruzar` sigue exigiendo el permiso del área al pintar. Ojo: se
  // construyen DENTRO del handler (por petición) — `db` es un proxy por tenant y solo acepta `prepare`
  // con el contexto de tenant puesto, no al montar las rutas.
  const resolversDe = () => ({
    nombreCliente: id => db.prepare('SELECT name FROM clients WHERE id=?').get(id)?.name || null,
    nombreProveedor: id => db.prepare('SELECT name FROM suppliers WHERE id=?').get(id)?.name || null,
  });

  // Catálogo de detectores (metadatos, sin datos): qué hay y qué permiso pide cada uno.
  api.get('/detectores', requirePerm('analytics.read'), c => {
    try { return c.json(catalogoDetectores()); }
    catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // Los hallazgos. `?detector=` para pedir uno solo (403 si el usuario no tiene su permiso). `?hoy=`
  // (ISO) para fijar el día — útil en verificación; es solo lectura, no cambia nada.
  api.get('/hallazgos', requirePerm('analytics.read'), c => {
    try {
      const soloDetector = c.req.query('detector') || null;
      const hoyQ = c.req.query('hoy');
      const hoy = /^\d{4}-\d{2}-\d{2}$/.test(hoyQ || '') ? hoyQ : null;
      return c.json(detectar(db, { hasPerm: permDe(c), hoy, soloDetector }));
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // LA VOZ (PIEZA 2). Mismos hallazgos que /hallazgos pero VESTIDOS: cada uno con su (a) qué pasa +
  // desde cuándo y (b) decisión propuesta, compuestos determinísticamente en `voz.js` (server-side).
  // Hereda permisos del vigía (viste solo lo que `detectar` entregó a este usuario); `?detector=` sin
  // permiso da 403 igual que en /hallazgos. Devuelve `avisos` + todo lo del barrido (hallazgos crudos,
  // sinPermiso, umbrales) para que la pantalla pinte la voz Y el detalle crudo desde UNA sola llamada.
  api.get('/avisos', requirePerm('analytics.read'), c => {
    try {
      const soloDetector = c.req.query('detector') || null;
      const hoyQ = c.req.query('hoy');
      const hoy = /^\d{4}-\d{2}-\d{2}$/.test(hoyQ || '') ? hoyQ : null;
      const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
      const narrado = narrar(detectar(db, { hasPerm: permDe(c), hoy, soloDetector }), sym);
      // PIEZA 5: se ordenan por prioridad (el de más impacto arriba) y se etiqueta cada uno con su grupo.
      // PIEZA 3 del peldaño 8: se le pasa el día del barrido para que los avisos de AGENDA —que no
      // llevan importe— se ordenen por cercanía a hoy y no por tamaño.
      const ordenados = priorizar(narrado.avisos, narrado.hoy);
      // `?top=N` → solo los N primeros, SIN gráfico: lo usa el bloque de Inicio (compacto, no dibuja).
      const topN = parseInt(c.req.query('top'), 10);
      if (Number.isInteger(topN) && topN > 0) {
        narrado.avisos = ordenados.slice(0, topN);
      } else {
        // PIEZA 3: a cada aviso se le adjunta la RECETA de su gráfico de apoyo (para el motor del
        // constructor). No se pinta ni se calcula nada aquí; el render lo hace `cruzar` + Chart.js.
        const resolvers = resolversDe();
        narrado.avisos = ordenados.map(a => ({ ...a, grafico: graficoDe(a, resolvers) }));
      }
      return c.json(narrado);
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // La pantalla. Lista cruda por detector: Qué · Cifra · Fecha · Motivo. Render en cliente desde el
  // JSON de arriba (mismo patrón que el resto de la Analítica), para que sea la MISMA cifra sin copiarla.
  views.get('/', requirePerm('analytics.read'), c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const content = `
      <div class="ph"><h2>Vigía · DISA predictiva</h2></div>
      <div class="card" style="margin-bottom:1rem">
        <div class="card-body">
          <p style="margin:0;color:var(--text2);font-size:.85rem">
            El vigía recorre tus motores de área y marca lo que conviene mirar. DISA te lo cuenta en
            llano y te <strong>propone una decisión</strong>. <strong>No hace sus propias cuentas</strong>:
            cada cifra sale del mismo motor que pinta la pantalla de esa área (Cobros, Pagos, Ventas,
            Plan) — no puede contradecirla, y cada aviso trae un <strong>gráfico de apoyo</strong>
            dibujado por tu propio constructor de analíticas. Solo lee y te lo explica: <strong>no
            ejecuta nada</strong>.</p>
          <p id="vigMeta" style="margin:.5rem 0 0;color:var(--muted);font-size:.78rem"></p>
        </div>
      </div>
      <div id="vigAviso" style="display:none;margin-bottom:1rem"></div>

      <!-- LA VOZ (PIEZA 2): narración + decisión propuesta. Es lo que ve el autónomo. -->
      <div id="vozBody">${'<div class="card"><div class="card-body" style="color:var(--muted)">Cargando avisos…</div></div>'}</div>

      <!-- EL DETALLE CRUDO (PIEZA 1): la tabla del vigía, para verificar que las cifras cuadran. -->
      <details style="margin-top:1.25rem">
        <summary style="cursor:pointer;color:var(--muted);font-size:.82rem">Ver el detalle crudo del vigía (la cifra tal cual del motor de cada área)</summary>
        <div id="vigBody" style="margin-top:.75rem">${'<div class="card"><div class="card-body" style="color:var(--muted)">Cargando hallazgos…</div></div>'}</div>
      </details>

      <!-- PIEZA 3 (el dibujo): el MISMO motor de render del constructor — Chart.js (mismo vendor local)
           + el endpoint /constructor/cruzar. No hay motor de dibujo nuevo. -->
      <script src="/public/vendor/chartjs/chart.umd.min.js"></script>
      <script src="/public/js/grafico-constructor.js"></script>
      <script>
      const SYM = ${JSON.stringify(sym)};
      const eur = v => SYM + Number(v||0).toFixed(2);
      const fmtCifra = h => h.moneda ? eur(h.cifra) : String(h.cifra);
      function pintarVigia(data){
        const body = document.getElementById('vigBody'), meta = document.getElementById('vigMeta'), av = document.getElementById('vigAviso');
        if(!data){ body.innerHTML = '<div class="card"><div class="card-body" style="color:var(--muted)">No he podido cargar los hallazgos. Vuelve a cargar la página.</div></div>'; return; }
        meta.textContent = 'Al día ' + data.hoy + ' · ' + data.total + ' hallazgo' + (data.total===1?'':'s') + '. Umbrales fijos: vencida ≥'+data.umbrales.VENCIDA_DIAS_MIN+'d · caída facturación ≥'+data.umbrales.CAIDA_FACTURACION_PCT+'% · caída margen ≥'+data.umbrales.CAIDA_MARGEN_PCT+'% · desvío plan ≥'+data.umbrales.DESVIO_PLAN_PCT+'% · pago vence ≤'+data.umbrales.PAGO_VENCE_DIAS+'d.';
        // Se dice QUÉ no ves y por qué (no un hueco mudo): la regla del resto de la Analítica.
        if((data.sinPermiso||[]).length){
          av.style.display='';
          av.innerHTML = '<div style="background:var(--accent-soft);border:1px solid var(--border2);border-radius:8px;padding:.6rem .75rem;font-size:.8rem;color:var(--text2)">'
            + 'No ves los hallazgos de <strong>'+data.sinPermiso.map(s=>escHtml(s.etiqueta)).join('</strong>, <strong>')+'</strong> porque no tienes su permiso.</div>';
        } else av.style.display='none';
        // Agrupar por detector, en el orden en que vienen.
        const grupos = new Map();
        for(const h of (data.hallazgos||[])){
          if(!grupos.has(h.detector)) grupos.set(h.detector, { etiqueta:h.detectorEtiqueta, area:h.areaEtiqueta, filas:[] });
          grupos.get(h.detector).filas.push(h);
        }
        if(!grupos.size){
          body.innerHTML = '<div class="card"><div class="card-body" style="color:var(--muted)">'
            + 'Sin hallazgos ahora mismo en las áreas que puedes ver. El vigía no inventa: si no hay problema, no marca nada.</div></div>';
          return;
        }
        let html = '';
        for(const [key, g] of grupos){
          html += '<div class="card" style="margin-bottom:1rem"><div class="card-head">'
            + '<h3>'+escHtml(g.etiqueta)+' <span style="color:var(--muted);font-weight:400;font-size:.8rem">('+escHtml(g.area)+' · '+g.filas.length+')</span></h3></div>'
            + '<div class="table-wrap"><table><thead><tr><th>Qué</th><th>Cifra</th><th>Fecha</th><th>Motivo</th></tr></thead><tbody>'
            + g.filas.map(h => '<tr>'
                + '<td><strong>'+escHtml(h.titulo)+'</strong></td>'
                + '<td style="white-space:nowrap">'+escHtml(fmtCifra(h))+'</td>'
                + '<td style="white-space:nowrap;color:var(--muted)">'+escHtml(h.fecha||'—')+'</td>'
                + '<td style="color:var(--text2);font-size:.82rem">'+escHtml(h.motivo||'')+'</td>'
              + '</tr>').join('')
            + '</tbody></table></div></div>';
        }
        body.innerHTML = html;
      }
      // ── LA VOZ: una tarjeta por aviso, con (a) qué pasa y (b) decisión propuesta. El texto ya viene
      // compuesto del servidor (voz.js, determinístico); aquí solo se ESCAPA y se pinta. Sin botones ni
      // formularios: la voz narra y propone, no ejecuta.
      function pintarVoz(data){
        const body = document.getElementById('vozBody');
        if(!body) return;
        if(!data){ body.innerHTML = '<div class="card"><div class="card-body" style="color:var(--muted)">No he podido cargar los avisos. Vuelve a cargar la página.</div></div>'; return; }
        const avisos = data.avisos||[];
        if(!avisos.length){
          body.innerHTML = '<div class="card"><div class="card-body" style="color:var(--muted)">'
            + 'Nada que te avise ahora mismo en las áreas que puedes ver. DISA no inventa: si no hay problema, no dice nada.</div></div>';
          return;
        }
        window.__avisos = avisos;
        // PIEZA 5: la lista sale ORDENADA por prioridad (el servidor ya la ordenó). Se separan por grupo
        // (Alta/Media/Baja) con una cabecera y cada tarjeta lleva su píldora de prioridad — se ve claro
        // a qué grupo pertenece cada aviso.
        let html = '', grupoActual = null;
        avisos.forEach((a,i) => {
          const p = a.prioridad;
          if (p && p.grupo !== grupoActual) {
            grupoActual = p.grupo;
            const n = avisos.filter(x => x.prioridad && x.prioridad.grupo === grupoActual).length;
            html += '<div style="font-size:.82rem;font-weight:600;color:var(--text2);margin:'+(i?'1.1rem':'0')+' 0 .5rem">Prioridad '+escHtml(p.etiqueta.toLowerCase())+' <span style="color:var(--muted);font-weight:400">('+n+')</span></div>';
          }
          html += '<div class="card" style="margin-bottom:.85rem"><div class="card-body">'
            + '<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.15rem">'
              + '<span style="font-size:.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;flex:1">'+escHtml(a.detectorEtiqueta)+' · '+escHtml(a.areaEtiqueta)+'</span>'
              + pillPrioridad(p) + '</div>'
            + '<div style="font-weight:600;margin-bottom:.35rem">'+escHtml(a.encabezado||'')+'</div>'
            + '<p style="margin:0 0 .5rem;color:var(--text)">'+escHtml(a.quePasa||'')+'</p>'
            + '<p style="margin:0;padding:.55rem .7rem;background:var(--accent-soft);border-left:3px solid var(--accent);border-radius:6px;color:var(--text)">'
              + '<strong>Decisión propuesta:</strong> '+escHtml(a.decision||'')+'</p>'
            + (a.porque ? '<p style="margin:.5rem 0 0;color:var(--muted);font-size:.76rem">El dato del vigía: '+escHtml(a.porque)+'</p>' : '')
            + graficoHtml(a,i)
            + '</div></div>';
        });
        body.innerHTML = html;
        montarGraficos();
      }
      // Píldora de prioridad: alta (rojo) · media (ámbar) · baja (gris). Solo color + texto, sin acción.
      function pillPrioridad(p){
        if(!p) return '';
        const col = p.grupo==='alta' ? 'var(--danger)' : p.grupo==='media' ? 'var(--warn)' : 'var(--text3)';
        const bg  = p.grupo==='alta' ? 'var(--danger-s)' : p.grupo==='media' ? 'var(--warn-s)' : 'var(--bg3)';
        return '<span style="font-size:.66rem;font-weight:700;padding:1px 9px;border-radius:20px;white-space:nowrap;background:'+bg+';color:'+col+'">'+escHtml(p.etiqueta)+'</span>';
      }
      // ── EL DIBUJO (PIEZA 3): bajo cada aviso, su gráfico de apoyo, dibujado por el MOTOR DEL
      // CONSTRUCTOR (Chart.js + /constructor/cruzar). Aquí NO se calcula ninguna cifra ni se pinta con
      // un motor nuevo: se pasa la receta (que trae el aviso) al constructor y se dibuja con su render
      // compartido (public/js/grafico-constructor.js). Perezoso: cada gráfico se dibuja al hacerse visible.
      function graficoHtml(a,i){
        const g = a.grafico;
        if(!g) return '';
        if(!g.receta){
          return g.gap ? '<p style="margin:.5rem 0 0;color:var(--muted);font-size:.74rem">Sin gráfico de apoyo del constructor para este tipo: '+escHtml(g.gap)+'</p>' : '';
        }
        return '<div class="voz-graf" data-i="'+i+'" style="margin-top:.6rem;padding-top:.5rem;border-top:1px solid var(--border2)">'
          + '<div class="voz-graf-canvas" style="height:180px"><canvas id="vg'+i+'"></canvas></div>'
          + '<p style="margin:.35rem 0 0;color:var(--muted);font-size:.73rem">'+escHtml(g.explica||'')
            + (g.gap ? ' <span style="opacity:.75">('+escHtml(g.gap)+')</span>' : '') + '</p>'
          + '<p class="voz-graf-nota" style="display:none;margin:.35rem 0 0;color:var(--muted);font-size:.73rem"></p>'
          + '</div>';
      }
      const grafCache = new Map();   // receta -> respuesta de cruzar (dedupe: recetas repetidas = una sola llamada)
      function cruzarReceta(receta){
        const key = JSON.stringify(receta);
        if(!grafCache.has(key)){
          grafCache.set(key, (async () => {
            try{
              // fetch DIRECTO al endpoint del constructor (no el api() compartido): un gráfico de apoyo
              // es una LECTURA; no debe disparar el rescan de la campana ni el modal de "acceso denegado"
              // al pasar por un aviso cuya área no ves. El 403 se enseña como nota discreta (permiso heredado).
              const r = await fetch('/api/erp/analytics/constructor/cruzar', {
                method:'POST', headers:{'Content-Type':'application/json','x-csrf-token':window.CSRF_TOKEN||''},
                body: JSON.stringify(receta) });
              if(r.status===403) return { status:403 };
              const d = await r.json().catch(()=>null);
              if(!r.ok || !d || d.error) return { error:true };
              return { ok:d };
            }catch(e){ return { error:true }; }
          })());
        }
        return grafCache.get(key);
      }
      const grafInst = {};
      async function dibujarAviso(cont){
        const i = cont.getAttribute('data-i');
        const a = (window.__avisos||[])[i], g = a && a.grafico;
        if(!g || !g.receta) return;
        const canvas = document.getElementById('vg'+i);
        const wrap = cont.querySelector('.voz-graf-canvas');
        const nota = cont.querySelector('.voz-graf-nota');
        const fallo = txt => { if(wrap) wrap.style.display='none'; if(nota){ nota.style.display=''; nota.textContent=txt; } };
        const res = await cruzarReceta(g.receta);
        if(res.status===403){ fallo('No puedes ver este gráfico: te falta el permiso del área.'); return; }
        if(res.error){ fallo('No he podido cargar este gráfico ahora mismo.'); return; }
        const d = res.ok;
        if(!d || !d.filas || !d.filas.length){ fallo('Sin datos suficientes para el gráfico.'); return; }
        if(grafInst[i]){ try{ grafInst[i].destroy(); }catch(e){} }
        try{ grafInst[i] = GraficoConstructor.dibujarCruce(canvas, { filas:d.filas, medida:g.medida, meta:g.meta, grafico:g.grafico }, { sym:SYM }); }
        catch(e){ fallo('No he podido dibujar este gráfico.'); }
      }
      let grafObs = null;
      function montarGraficos(){
        if(grafObs){ grafObs.disconnect(); }
        const conts = document.querySelectorAll('#vozBody .voz-graf');
        if(typeof GraficoConstructor==='undefined' || typeof Chart==='undefined'){ return; }   // sin render: no se fuerza
        if(!('IntersectionObserver' in window)){ conts.forEach(dibujarAviso); return; }
        grafObs = new IntersectionObserver((entries)=>{
          for(const e of entries){ if(e.isIntersecting){ dibujarAviso(e.target); grafObs.unobserve(e.target); } }
        },{ rootMargin:'150px' });
        conts.forEach(el => grafObs.observe(el));
      }
      (async function(){
        // Una sola llamada: /avisos trae la voz (avisos) Y el barrido crudo (hallazgos, sinPermiso…).
        const data = await api('GET','/api/erp/vigia/avisos').catch(()=>null);
        pintarVoz(data);
        pintarVigia(data);
      })();
      </script>`;
    return c.html(adminLayout('Vigía · DISA predictiva', content, 'vigia', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
