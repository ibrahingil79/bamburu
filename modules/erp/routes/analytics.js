import { Hono } from 'hono';
import { safeError } from '../../../core/errors.js';
import { adminLayout, skeletonRows, can } from '../layout.js';
import { requirePerm } from '../../../core/auth.js';
import { ventasResumen, topProductos, ventasPorDia, ventasCsvRows, margenResumen, margenPorProducto,
         ventasPorResponsable, clientesPorResponsable } from '../ventas-metrics.js';   // PIEZA C: ventas desde la cadena nueva (facturas) · PASO 2: margen · CRM: responsable

export function createAnalyticsRoutes(db, cfg = {}) {
  const sym = cfg.sym || '€';
  const api = new Hono();
  const views = new Hono();

  api.get('/overview', requirePerm('analytics.read'), c => {
    try {
      // PIEZA C — ingresos/nº pedidos/ticket medio desde la cadena nueva (facturas que cuentan).
      const v = ventasResumen(db);
      return c.json({
        totalRevenue: v.total,                              // total facturado (con IVA)
        totalOrders: v.count,
        avgOrder: v.count ? Math.round(v.total / v.count * 100) / 100 : 0,
        totalClients: db.prepare("SELECT COUNT(*) as v FROM clients").get().v,
        totalProducts: db.prepare("SELECT COUNT(*) as v FROM products WHERE status='active'").get().v,
        lowStock: db.prepare("SELECT COUNT(*) as v FROM products WHERE stock<5 AND status='active'").get().v,
      });
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.get('/sales-by-period', requirePerm('analytics.read'), c => {
    try {
      const days = parseInt(c.req.query('days') || '30');
      return c.json(ventasPorDia(db, days));   // PIEZA C — ventas/día desde facturas que cuentan
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.get('/best-sellers', requirePerm('analytics.read'), c => {
    try {
      const limit = parseInt(c.req.query('limit') || '10');
      return c.json(topProductos(db, { limit }));   // PIEZA C — top productos desde líneas de facturas que cuentan
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  // PASO 2 — RENTABILIDAD del periodo + desglose por producto. Mismo candado que el resto de la
  // Analítica (`analytics.read`): el coste es un dato sensible —revela lo que te cuesta comprar— y
  // no nace con permiso propio porque ya existe el de esta pantalla (CANON §3-bis: las dos puertas,
  // los mismos candados). `?from=&to=` opcionales (ISO); sin ellos, todo el histórico.
  api.get('/margen', requirePerm('analytics.read'), c => {
    try {
      const from = c.req.query('from') || null, to = c.req.query('to') || null;
      return c.json({ resumen: margenResumen(db, { from, to }), productos: margenPorProducto(db, { from, to }) });
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  // CRM — VENTAS Y CLIENTES POR RESPONSABLE (dimensión del catálogo del peldaño 3).
  // DOS PUERTAS, DOS CANDADOS: las ventas por responsable exigen `analytics.read` **y**
  // `invoices.read`; los clientes por responsable, `analytics.read` **y** `clients.read`. Es la regla
  // de CANON §3-bis llevada al detalle: una pieza que cruza áreas exige TODOS los permisos que toca —
  // si no, el informe sería el atajo para ver por la puerta de atrás lo que la pantalla te niega.
  // `?from=&to=` opcionales. El filtro por responsable (incluido "sin asignar") se resuelve en el
  // cliente sobre estas filas: son pocas por naturaleza (una por usuario).
  api.get('/responsable', requirePerm('analytics.read'), c => {
    try {
      const from = c.req.query('from') || null, to = c.req.query('to') || null;
      const out = {};
      if (can(c, 'invoices.read')) out.ventas = ventasPorResponsable(db, { from, to });
      if (can(c, 'clients.read'))  out.clientes = clientesPorResponsable(db);
      // Se dice QUÉ falta y por qué, en vez de devolver un hueco mudo que se lea como "no hay datos".
      out.sinPermiso = [!can(c, 'invoices.read') && 'ventas', !can(c, 'clients.read') && 'clientes'].filter(Boolean);
      return c.json(out);
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.get('/stock-report', requirePerm('analytics.read'), c => {
    try {
      return c.json(db.prepare("SELECT p.name, p.sku, p.stock, p.price, (p.stock*p.price) as inventory_value, c.name as category FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.status='active' ORDER BY p.stock ASC").all());
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  // CSV exports
  api.get('/export/sales', requirePerm('analytics.read'), c => {
    try {
      // PIEZA C — una fila por línea de las facturas que cuentan (serie = origen del documento).
      const rows = ventasCsvRows(db);
      const q = v => '"'+String(v??'').replace(/"/g,'""')+'"';
      const h = ['Factura','Fecha','Estado','Serie','Cliente','Producto','Cantidad','Precio_Unitario','Total'];
      const r = rows.map(x => [q(x.invoice_number),q(x.issue_date),q(x.status),q(x.series),q(x.client),q(x.product_name),x.quantity,x.unit_price,x.total].join(','));
      return c.body([h.join(','),...r].join('\n'), 200, {'Content-Type':'text/csv','Content-Disposition':'attachment; filename="ventas.csv"'});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  // PASO 2 — export de rentabilidad. **CSV, como TODO lo que exporta esta pantalla** (no XLSX ni PDF:
  // eso es de Contabilidad, y aquí sería inventar un formato nuevo). Mismo `requirePerm` que la
  // pantalla: quien no ve el margen por la vista tampoco lo saca por aquí — si no, el export sería la
  // puerta de atrás del candado.
  api.get('/export/margen', requirePerm('analytics.read'), c => {
    try {
      const from = c.req.query('from') || null, to = c.req.query('to') || null;
      const { resumen, productos } = { resumen: margenResumen(db, { from, to }), productos: margenPorProducto(db, { from, to }) };
      const q = v => '"'+String(v??'').replace(/"/g,'""')+'"';
      const n = v => (v == null ? '' : v);
      const h = ['Producto','Unidades','Ingresos_sin_IVA','Coste','Beneficio','Margen_%','Ventas_sin_coste_registrado','Coste_aproximado'];
      const r = productos.map(p => [q(p.product_name), p.qty, p.ingresos, n(p.coste), n(p.beneficio), n(p.margenPct), p.sinCoste, p.aproximado ? 'si' : ''].join(','));
      // El total va en el mismo fichero, al final: un export que solo trae el desglose obliga a sumar
      // a mano y a equivocarse — y el total NO es la suma de la columna de margen (ver informe).
      const tot = ['TOTAL', '', resumen.ingresos, resumen.coste, resumen.beneficio, n(resumen.margenPct), resumen.sinCoste, ''].join(',');
      return c.body([h.join(','), ...r, tot].join('\n'), 200, {'Content-Type':'text/csv','Content-Disposition':'attachment; filename="rentabilidad.csv"'});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.get('/export/products', requirePerm('analytics.read'), c => {
    try {
      const rows = db.prepare('SELECT p.name,p.sku,p.price,p.stock,p.status,p.type,c.name as category FROM products p LEFT JOIN categories c ON p.category_id=c.id ORDER BY p.name').all();
      const q = v => '"'+String(v??'').replace(/"/g,'""')+'"';
      const h = ['Nombre','SKU','Precio','Stock','Estado','Tipo','Categoria'];
      const r = rows.map(x => [q(x.name),q(x.sku),x.price,x.stock,q(x.status),q(x.type),q(x.category)].join(','));
      return c.body([h.join(','),...r].join('\n'), 200, {'Content-Type':'text/csv','Content-Disposition':'attachment; filename="productos.csv"'});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.get('/export/clients', requirePerm('analytics.read'), c => {
    try {
      const rows = db.prepare('SELECT c.name,c.fiscal_id,c.email,c.phone,c.city,c.country,g.name as grupo,c.total_spent FROM clients c LEFT JOIN client_groups g ON c.group_id=g.id ORDER BY c.total_spent DESC').all();
      const q = v => '"'+String(v??'').replace(/"/g,'""')+'"';
      const h = ['Nombre','ID_Fiscal','Email','Teléfono','Ciudad','País','Grupo','Total_Gastado'];
      const r = rows.map(x => [q(x.name),q(x.fiscal_id),q(x.email),q(x.phone),q(x.city),q(x.country),q(x.grupo),x.total_spent].join(','));
      return c.body([h.join(','),...r].join('\n'), 200, {'Content-Type':'text/csv','Content-Disposition':'attachment; filename="clientes.csv"'});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  views.get('/', requirePerm('analytics.read'), c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const content = `
      <div class="ph"><h2>Analítica</h2>
        <div style="display:flex;gap:.5rem">
          <select class="form-control" id="periodSel" style="width:auto" onchange="loadCharts()">
            <option value="7">Últimos 7 días</option>
            <option value="30" selected>Últimos 30 días</option>
            <option value="90">Últimos 90 días</option>
          </select>
        </div>
      </div>

      <div class="grid ga" style="margin-bottom:1.5rem" id="kpiRow">
        <div class="kpi"><div class="kpi-label">Ingresos</div><div class="kpi-val" id="kRev" style="color:var(--ok)">-</div></div>
        <div class="kpi"><div class="kpi-label">Pedidos</div><div class="kpi-val" id="kOrd">-</div></div>
        <div class="kpi"><div class="kpi-label">Ticket medio</div><div class="kpi-val" id="kAvg">-</div></div>
        <div class="kpi"><div class="kpi-label">Clientes</div><div class="kpi-val" id="kCli">-</div></div>
      </div>

      <div class="grid g2" style="margin-bottom:1.5rem">
        <div class="card">
          <div class="card-head"><h3>Ventas por período</h3></div>
          <div class="card-body" style="height:240px"><canvas id="salesChart"></canvas></div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Productos más vendidos</h3></div>
          <div class="card-body" style="height:240px"><canvas id="topChart"></canvas></div>
        </div>
      </div>

      <div class="card" style="margin-bottom:1.5rem">
        <div class="card-head"><h3>Rentabilidad</h3>
          <div style="display:flex;gap:.5rem">
            <a href="/api/erp/analytics/export/margen" class="btn btn-secondary btn-sm">CSV Rentabilidad</a>
          </div>
        </div>
        <div class="card-body">
          <div class="grid ga" id="mgRow">
            <div class="kpi"><div class="kpi-label">Beneficio</div><div class="kpi-val" id="mBen" style="color:var(--ok)">-</div></div>
            <div class="kpi"><div class="kpi-label">Margen</div><div class="kpi-val" id="mPct">-</div></div>
            <div class="kpi"><div class="kpi-label">Ingresos sin IVA</div><div class="kpi-val" id="mIng">-</div></div>
            <div class="kpi"><div class="kpi-label">Coste</div><div class="kpi-val" id="mCos">-</div></div>
          </div>
          <div id="mgAviso" style="display:none;margin-top:.75rem"></div>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Producto</th><th>Unidades</th><th>Ingresos sin IVA</th><th>Coste</th><th>Beneficio</th><th>Margen</th></tr></thead>
          <tbody id="mgBody">${skeletonRows(5)}</tbody>
        </table></div>
      </div>

      <div class="card" style="margin-bottom:1.5rem">
        <div class="card-head"><h3>Por responsable</h3>
          <div style="display:flex;gap:.5rem;align-items:center">
            <select class="form-control" id="respSel" style="width:auto;font-size:.8rem"><option value="">Todos</option></select>
          </div>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Responsable</th><th>Clientes</th><th>Facturas</th><th>Facturado sin IVA</th></tr></thead>
          <tbody id="respBody">${skeletonRows(3)}</tbody>
        </table></div>
      </div>

      <div class="card" style="margin-bottom:1.5rem">
        <div class="card-head"><h3>Informe de stock</h3>
          <div style="display:flex;gap:.5rem">
            <a href="/api/erp/analytics/export/products" class="btn btn-secondary btn-sm">CSV Productos</a>
            <a href="/api/erp/analytics/export/sales" class="btn btn-secondary btn-sm">CSV Ventas</a>
            <a href="/api/erp/analytics/export/clients" class="btn btn-secondary btn-sm">CSV Clientes</a>
          </div>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Producto</th><th>SKU</th><th>Categoría</th><th>Stock</th><th>Precio</th><th>Valor en inventario</th></tr></thead>
          <tbody id="stockBody">${skeletonRows(6)}</tbody>
        </table></div>
      </div>

      <script src="/public/vendor/chartjs/chart.umd.min.js"></script>
      <script>
      let salesChartInst=null,topChartInst=null;

      // PASO 2 — RENTABILIDAD. La regla de esta vista: lo que no se sabe se dice, no se rellena.
      // Un margen null se pinta "—" (no 0, que diría "no ganas nada", ni 100, que diría "todo
      // beneficio"), y si hay ventas sin coste conocido se avisa ARRIBA y con su importe: el dueño
      // tiene que saber sobre qué parte de su facturación está mirando el beneficio.
      const eur=v=>'${sym}'+Number(v||0).toFixed(2);
      function pintarMargen(mg){
        const body=document.getElementById('mgBody'), aviso=document.getElementById('mgAviso');
        if(!mg||!mg.resumen){ body.innerHTML=window.emptyRow(6,'No he podido calcular la rentabilidad ahora mismo. Vuelve a cargar la página.'); return; }
        const r=mg.resumen;
        document.getElementById('mBen').textContent=r.margenPct==null?'—':eur(r.beneficio);
        document.getElementById('mPct').textContent=r.margenPct==null?'—':Number(r.margenPct).toFixed(1)+'%';
        document.getElementById('mIng').textContent=eur(r.ingresosConCoste);
        document.getElementById('mCos').textContent=eur(r.coste);
        // El aviso NO es decorativo: sin él, "beneficio 6.000 €" sobre 985.000 € facturados se lee
        // como un desastre, cuando en realidad el beneficio solo mide 63.000 € de esa facturación.
        if(r.sinCoste>0){
          aviso.style.display='';
          aviso.innerHTML='<div style="background:var(--accent-soft);border:1px solid var(--border2);border-radius:8px;padding:.6rem .75rem;font-size:.8rem;color:var(--text2)">'+
            '<strong style="color:var(--text)">El beneficio mira solo la parte que tiene coste.</strong> '+
            'Quedan fuera <strong>'+eur(r.sinCoste)+'</strong> ('+Number(r.sinCostePct).toFixed(1)+'% de tus ventas) '+
            'sin coste registrado: servicios, conceptos libres o productos que nunca compraste. '+
            'No son beneficio — es que su coste no se sabe.'+
            (r.lineasAproximadas?' <em>'+r.lineasAproximadas+' línea(s) usan un coste aproximado (anteriores a esta función).</em>':'')+
            '</div>';
        } else aviso.style.display='none';
        body.innerHTML=mg.productos.length?mg.productos.map(p=>'<tr>'+
          '<td><strong>'+escHtml(p.product_name)+'</strong>'+(p.aproximado?' <span title="Coste aproximado" style="color:var(--muted)">≈</span>':'')+'</td>'+
          '<td>'+Number(p.qty)+'</td>'+
          '<td>'+eur(p.ingresos)+'</td>'+
          '<td>'+(p.coste==null?'<span style="color:var(--muted)">sin coste</span>':eur(p.coste))+'</td>'+
          '<td>'+(p.beneficio==null?'<span style="color:var(--muted)">—</span>':eur(p.beneficio))+'</td>'+
          '<td>'+(p.margenPct==null?'<span style="color:var(--muted)">—</span>':'<strong>'+Number(p.margenPct).toFixed(1)+'%</strong>')+'</td>'+
          '</tr>').join(''):window.emptyRow(6,'Todavía no has vendido nada. Cuando emitas tu primera factura, aquí verás lo que ganas de verdad.');
      }

      // CRM — POR RESPONSABLE. Cruza dos áreas (ventas y clientes), así que puede llegar a medias si
      // el usuario solo tiene una: se dice cuál falta en vez de pintar un hueco que se lea como "no
      // hay datos". "Sin asignar" es una fila más y NO se esconde: ocultarla descuadraría el total
      // contra Ventas y nadie sabría por qué.
      let respCache=null;
      function pintarResponsable(){
        const body=document.getElementById('respBody');
        if(!respCache){ body.innerHTML=window.emptyRow(4,'No he podido cargar el reparto por responsable.'); return; }
        const sel=document.getElementById('respSel').value;
        const cli=new Map((respCache.clientes||[]).map(x=>[String(x.responsable_id??''),x.clientes]));
        let filas=(respCache.ventas||[]).map(v=>({...v, clientes: cli.get(String(v.responsable_id??''))??0}));
        // Un responsable con clientes pero sin ventas todavía también existe: si no, la cartera
        // recién repartida parecería no estar.
        for(const [k,n] of cli) if(!filas.some(f=>String(f.responsable_id??'')===k))
          filas.push({responsable_id:k===''?null:Number(k), responsable:(respCache.clientes.find(x=>String(x.responsable_id??'')===k)||{}).responsable, facturas:0, base:0, clientes:n});
        if(sel!=='') filas=filas.filter(f=>String(f.responsable_id??'sin')===sel);
        if(!filas.length){ body.innerHTML=window.emptyRow(4,'Nadie tiene ventas ni clientes con ese filtro.'); return; }
        body.innerHTML=filas.map(f=>'<tr>'+
          '<td><strong>'+escHtml(f.responsable||'Sin asignar')+'</strong></td>'+
          '<td>'+f.clientes+'</td><td>'+f.facturas+'</td><td>'+eur(f.base)+'</td></tr>').join('');
        if((respCache.sinPermiso||[]).length)
          body.innerHTML+='<tr><td colspan="4" style="color:var(--muted);font-size:.75rem">No ves '+respCache.sinPermiso.join(' ni ')+' porque no tienes su permiso.</td></tr>';
      }
      function llenarSelResponsable(){
        const s=document.getElementById('respSel'); if(!respCache) return;
        const vistos=new Map();
        for(const v of (respCache.ventas||[])) vistos.set(String(v.responsable_id??'sin'), v.responsable);
        for(const c of (respCache.clientes||[])) vistos.set(String(c.responsable_id??'sin'), c.responsable);
        s.innerHTML='<option value="">Todos</option>'+[...vistos].map(([k,n])=>'<option value="'+k+'">'+escHtml(n||'Sin asignar')+'</option>').join('');
        s.onchange=pintarResponsable;
      }

      async function loadCharts(){
        const days=document.getElementById('periodSel').value;
        const [ov,period,top,stock,mg,resp]=await Promise.all([
          api('GET','/api/erp/analytics/overview').catch(()=>({})),
          api('GET','/api/erp/analytics/sales-by-period?days='+days).catch(()=>[]),
          api('GET','/api/erp/analytics/best-sellers?limit=8').catch(()=>[]),
          api('GET','/api/erp/analytics/stock-report').catch(()=>[]),
          api('GET','/api/erp/analytics/margen').catch(()=>null),
          api('GET','/api/erp/analytics/responsable').catch(()=>null)
        ]);
        document.getElementById('kRev').textContent='${sym}'+Number(ov.totalRevenue||0).toFixed(2);
        document.getElementById('kOrd').textContent=ov.totalOrders||0;
        document.getElementById('kAvg').textContent='${sym}'+Number(ov.avgOrder||0).toFixed(2);
        document.getElementById('kCli').textContent=ov.totalClients||0;

        pintarMargen(mg);
        respCache=resp; llenarSelResponsable(); pintarResponsable();

        if(salesChartInst)salesChartInst.destroy();
        salesChartInst=new Chart(document.getElementById('salesChart').getContext('2d'),{type:'bar',data:{labels:period.map(d=>d.date),datasets:[{label:'${sym}',data:period.map(d=>d.total),backgroundColor:'rgba(16,185,129,.6)',borderColor:'#10b981',borderWidth:1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{callback:v=>'${sym}'+v}}}}});

        if(topChartInst)topChartInst.destroy();
        topChartInst=new Chart(document.getElementById('topChart').getContext('2d'),{type:'bar',data:{labels:top.map(p=>p.product_name.substring(0,15)),datasets:[{label:'Ingresos',data:top.map(p=>p.total_val),backgroundColor:'rgba(14,165,233,.6)',borderColor:'#0ea5e9',borderWidth:1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{beginAtZero:true,ticks:{callback:v=>'${sym}'+v}}}}});

        document.getElementById('stockBody').innerHTML=stock.length?stock.map(p=>'<tr>'+
          '<td><strong>'+escHtml(p.name)+'</strong></td>'+
          '<td style="color:var(--muted)">'+escHtml(p.sku||'-')+'</td>'+
          '<td>'+escHtml(p.category||'-')+'</td>'+
          '<td><strong style="color:'+(p.stock<5?'var(--danger)':'inherit')+'">'+p.stock+'</strong></td>'+
          '<td>${sym}'+Number(p.price).toFixed(2)+'</td>'+
          '<td style="color:var(--ok);font-weight:600">${sym}'+Number(p.inventory_value||0).toFixed(2)+'</td>'+
          '</tr>').join(''):window.emptyRow(6,'Sin datos de stock todavía: aparecerán cuando tengas productos con movimiento.');
      }
      loadCharts();
      </script>`;
    return c.html(adminLayout('Analítica', content, 'analytics', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
