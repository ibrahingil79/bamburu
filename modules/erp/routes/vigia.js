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

export function createVigiaRoutes(db) {
  const api = new Hono();
  const views = new Hono();
  const permDe = c => (p) => can(c, p);

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

  // La pantalla. Lista cruda por detector: Qué · Cifra · Fecha · Motivo. Render en cliente desde el
  // JSON de arriba (mismo patrón que el resto de la Analítica), para que sea la MISMA cifra sin copiarla.
  views.get('/', requirePerm('analytics.read'), c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const content = `
      <div class="ph"><h2>Vigía · DISA predictiva</h2></div>
      <div class="card" style="margin-bottom:1rem">
        <div class="card-body">
          <p style="margin:0;color:var(--text2);font-size:.85rem">
            El vigía recorre tus motores de área y marca lo que conviene mirar. <strong>No hace sus
            propias cuentas</strong>: cada cifra sale del mismo motor que pinta la pantalla de esa área
            (Cobros, Pagos, Ventas, Plan) — no puede contradecirla. Solo lee.</p>
          <p id="vigMeta" style="margin:.5rem 0 0;color:var(--muted);font-size:.78rem"></p>
        </div>
      </div>
      <div id="vigAviso" style="display:none;margin-bottom:1rem"></div>
      <div id="vigBody">${'<div class="card"><div class="card-body" style="color:var(--muted)">Cargando hallazgos…</div></div>'}</div>

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
      (async function(){
        const data = await api('GET','/api/erp/vigia/hallazgos').catch(()=>null);
        pintarVigia(data);
      })();
      </script>`;
    return c.html(adminLayout('Vigía · DISA predictiva', content, 'vigia', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
