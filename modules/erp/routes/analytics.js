import { Hono } from 'hono';
import { safeError } from '../../../core/errors.js';
import { adminLayout, skeletonRows, can } from '../layout.js';
import { requirePerm } from '../../../core/auth.js';
import { ventasResumen, topProductos, ventasPorDia, ventasCsvRows, margenResumen, margenPorProducto,
         ventasPorResponsable, clientesPorResponsable, ventasPorPeriodo, ventasPorCliente,
         cobradoVsPendiente, clientesNuevosPorMes, clientesDormidos, PERIODOS } from '../ventas-metrics.js';   // PIEZA C: ventas · PASO 2: margen · CRM: responsable · PASO 3: informes
import { comprasPorProveedor, gastoPorCategoria, pendientePagoPorVencimiento } from '../pagos.js';   // PASO 3: informes de compras (misma regla de conteo que Pagos)
import { openDebts } from '../cobros.js';   // PASO 3: deuda vencida — el motor que ya usa Cobros
import { hoyLocal } from '../avisos.js';    // fecha local Europe/Madrid (en UTC, a las 00-02 h una factura recién vencida desaparecía)
import { planFinanciero, fijarObjetivo } from '../plan-financiero.js';   // PASO 3 · bloque 2: objetivos vs. real
import { logActivity } from '../../../core/auth.js';
import { ENTITY } from '../../../core/activity-entities.js';
import { camposPara, cruzar, guardarPanel, listarPaneles, borrarPanel } from '../constructor-analitica.js';   // PASO 4a: la puerta visual

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

  // ── ESCALERA · PASO 3 — INFORMES POR ÁREA ──────────────────────────────────────────────────────
  // Diez informes predefinidos, cada uno tras `analytics.read` **Y el permiso de su área** (las dos
  // puertas, CANON §3-bis). El endpoint sirve lo que el usuario puede ver y **dice qué le falta** en
  // vez de callarse: un hueco mudo se lee como "no hay datos", y eso es mentir por omisión.
  // INVENTARIO y CONTABILIDAD quedan FUERA a propósito: ya se ven en Stock y en Libros y modelos.
  // Duplicarlos aquí crearía dos sitios que dicen lo mismo — y el día que discreparan, nadie sabría
  // cuál creer. Es la regla de la única verdad, la misma que gobierna `ventas-metrics.js`.
  api.get('/informes', requirePerm('analytics.read'), c => {
    try {
      const from = c.req.query('from') || null, to = c.req.query('to') || null;
      const periodo = PERIODOS.includes(c.req.query('periodo')) ? c.req.query('periodo') : 'mes';
      const hoy = hoyLocal();
      const out = { periodo }, falta = [];

      if (can(c, 'invoices.read')) {
        out.ventas = {
          porPeriodo: ventasPorPeriodo(db, { periodo, from, to }),
          porCliente: ventasPorCliente(db, { from, to, limit: 20 }),
          porResponsable: ventasPorResponsable(db, { from, to }),
          cobrado: cobradoVsPendiente(db, { from, to }),
        };
      } else falta.push('ventas');

      if (can(c, 'purchases.read')) {
        out.compras = {
          porProveedor: comprasPorProveedor(db, { from, to, limit: 20 }),
          porCategoria: gastoPorCategoria(db, { from, to }),
          pendientePorVencimiento: pendientePagoPorVencimiento(db, hoy),
        };
      } else falta.push('compras');

      if (can(c, 'clients.read')) {
        // Ranking, dormidos y deuda salen de los motores que YA existen (`ventasPorCliente`,
        // `clientesDormidos` con su ritmo aprendido, `openDebts`). Ni una regla nueva.
        const deuda = openDebts(db, hoy);
        out.clientes = {
          ranking: ventasPorCliente(db, { from, to, limit: 20 }).filter(x => x.client_id),
          dormidos: clientesDormidos(db, hoy).slice(0, 20),
          deudaVencida: (deuda.rows || []).filter(r => Number(r.maxVencida) > 0).slice(0, 20),
          nuevosPorMes: clientesNuevosPorMes(db, { meses: 12 }),
          porResponsable: clientesPorResponsable(db),
        };
      } else falta.push('clientes');

      out.sinPermiso = falta;
      return c.json(out);
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  // ── PASO 3 · BLOQUE 2 — PLAN FINANCIERO (objetivos vs. real) ───────────────────────────────────
  // VER el plan: `analytics.read` + `invoices.read` (son cifras de venta y de margen).
  // FIJAR una meta: **solo owner/admin**. Es quien manda quien pone los objetivos — no se crea un
  // permiso nuevo (CANON: el candado más estricto que ya existe), y un empleado no se pone sus
  // propias metas ni las de otro. Decisión del dueño.
  const mandaAqui = c => c.get('isAdmin') || ['owner', 'admin'].includes(c.get('session')?.role);

  api.get('/plan', requirePerm('analytics.read'), c => {
    try {
      if (!can(c, 'invoices.read')) return c.json({ error: 'No tienes permiso para ver las cifras de venta' }, 403);
      const periodo = PERIODOS.includes(c.req.query('periodo')) ? c.req.query('periodo') : null;
      return c.json({ filas: planFinanciero(db, { periodo }), puedeFijar: mandaAqui(c) });
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.post('/plan', requirePerm('analytics.read'), async c => {
    try {
      if (!mandaAqui(c)) return c.json({ error: 'Solo el dueño o un administrador fijan los objetivos del negocio' }, 403);
      const d = await c.req.json();
      const r = fijarObjetivo(db, d);
      logActivity(db, c.get('session'), r.borrado ? 'Quitó un objetivo del plan' : 'Fijó un objetivo del plan',
                  ENTITY.COMPANY_CONFIG, null, `${d.tipo} · ${d.periodo} ${d.clave} · ${d.alcance}${d.user_id ? ' #' + d.user_id : ''}`);
      return c.json({ ...r, filas: planFinanciero(db, {}) });
    } catch(e) { return c.json({error:safeError(e)}, e.status || 500); }
  });

  // ── ESCALERA · PASO 4a — CONSTRUCTOR DE ANALÍTICAS (área: VENTAS) ──────────────────────────────
  // La puerta visual: el usuario elige qué cruzar y se dibuja SUS gráficos, no los cuatro que alguien
  // decidió por él (CANON §3-bis, "las dos puertas").
  // CANDADO: `analytics.read` + `invoices.read` (es el área de ventas). Cada CAMPO puede exigir un
  // permiso extra (cliente/provincia → clients.read; producto/categoría → products.read), y el
  // servidor lo revalida en `cruzar()`: el desplegable filtrado NO es el candado, solo la cortesía.
  const permDe = c => (p) => can(c, p);
  const exigeVentas = c => {
    if (!can(c, 'invoices.read')) { const e = new Error('No tienes permiso para ver las cifras de venta'); e.status = 403; throw e; }
  };

  api.get('/constructor/campos', requirePerm('analytics.read'), c => {
    try {
      exigeVentas(c);
      return c.json(camposPara(permDe(c)));
    } catch(e) { return c.json({error:safeError(e)}, e.status || 500); }
  });

  api.post('/constructor/cruzar', requirePerm('analytics.read'), async c => {
    try {
      exigeVentas(c);
      const d = await c.req.json();
      return c.json(cruzar(db, { ...d, hasPerm: permDe(c) }));
    } catch(e) { return c.json({error:safeError(e)}, e.status || 500); }
  });

  // PANELES — de quien los crea. El `user_id` sale de la SESIÓN, nunca del cuerpo de la petición:
  // si viniera de fuera, cualquiera guardaría paneles en el nombre de otro.
  api.get('/constructor/paneles', requirePerm('analytics.read'), c => {
    try {
      exigeVentas(c);
      return c.json(listarPaneles(db, c.get('session')?.userId));
    } catch(e) { return c.json({error:safeError(e)}, e.status || 500); }
  });

  api.post('/constructor/paneles', requirePerm('analytics.read'), async c => {
    try {
      exigeVentas(c);
      const d = await c.req.json();
      const r = guardarPanel(db, c.get('session')?.userId, d);
      return c.json({ ...r, paneles: listarPaneles(db, c.get('session')?.userId) });
    } catch(e) { return c.json({error:safeError(e)}, e.status || 500); }
  });

  api.delete('/constructor/paneles/:id', requirePerm('analytics.read'), c => {
    try {
      exigeVentas(c);
      borrarPanel(db, c.get('session')?.userId, c.req.param('id'));
      return c.json({ ok: true, paneles: listarPaneles(db, c.get('session')?.userId) });
    } catch(e) { return c.json({error:safeError(e)}, e.status || 500); }
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

  // PASO 3 — export de los informes. **CSV**, como todo lo que exporta esta pantalla. Un solo fichero
  // con los diez, separados por su cabecera: quien lo abre quiere sus números, no diez descargas.
  // Mismos candados que la vista: un área sin permiso NO sale en el CSV — el export no es la puerta de
  // atrás del permiso.
  api.get('/export/informes', requirePerm('analytics.read'), c => {
    try {
      const from = c.req.query('from') || null, to = c.req.query('to') || null;
      const periodo = PERIODOS.includes(c.req.query('periodo')) ? c.req.query('periodo') : 'mes';
      const hoy = hoyLocal();
      const q = v => '"'+String(v??'').replace(/"/g,'""')+'"';
      const L = [];
      const bloque = (titulo, cabecera, filas) => { L.push('', '# ' + titulo, cabecera.join(','), ...filas); };

      if (can(c, 'invoices.read')) {
        bloque('VENTAS por ' + periodo, ['Periodo','Facturas','Base_sin_IVA'],
          ventasPorPeriodo(db, { periodo, from, to }).map(r => [q(r.periodo), r.facturas, r.base].join(',')));
        bloque('VENTAS por cliente', ['Cliente','Facturas','Base_sin_IVA'],
          ventasPorCliente(db, { from, to, limit: 500 }).map(r => [q(r.cliente), r.facturas, r.base].join(',')));
        bloque('VENTAS por responsable', ['Responsable','Facturas','Base_sin_IVA'],
          ventasPorResponsable(db, { from, to }).map(r => [q(r.responsable), r.facturas, r.base].join(',')));
        const cb = cobradoVsPendiente(db, { from, to });
        bloque('COBRADO vs PENDIENTE', ['Facturas','Facturado','Cobrado','Pendiente','Cobrado_%'],
          [[cb.facturas, cb.facturado, cb.cobrado, cb.pendiente, cb.cobradoPct].join(',')]);
      }
      if (can(c, 'purchases.read')) {
        bloque('COMPRAS por proveedor', ['Proveedor','Facturas','Base_sin_IVA'],
          comprasPorProveedor(db, { from, to, limit: 500 }).map(r => [q(r.proveedor), r.facturas, r.base].join(',')));
        bloque('GASTO por categoria', ['Categoria','Facturas','Base_sin_IVA'],
          gastoPorCategoria(db, { from, to }).map(r => [q(r.categoria), r.facturas, r.base].join(',')));
        bloque('PENDIENTE de pago por vencimiento', ['Tramo','Facturas','Pendiente','Max_dias_vencida'],
          pendientePagoPorVencimiento(db, hoy).map(r => [q(r.etiqueta), r.facturas, r.pendiente, r.maxDiasVencida].join(',')));
      }
      if (can(c, 'clients.read')) {
        bloque('CLIENTES ranking por facturacion', ['Cliente','Facturas','Base_sin_IVA'],
          ventasPorCliente(db, { from, to, limit: 500 }).filter(x => x.client_id).map(r => [q(r.cliente), r.facturas, r.base].join(',')));
        bloque('CLIENTES dormidos', ['Cliente','Dias_sin_comprar','Umbral','Compras','Ultima_compra'],
          clientesDormidos(db, hoy).map(r => [q(r.name || r.cliente), r.dias ?? '', r.umbral ?? '', r.compras ?? '', q(r.ultima ?? '')].join(',')));
        bloque('CLIENTES deuda vencida', ['Cliente','Deuda_total','Dias_mas_vencida'],
          (openDebts(db, hoy).rows || []).filter(r => Number(r.maxVencida) > 0).map(r => [q(r.name), r.deudaTotal, r.maxVencida].join(',')));
        bloque('CLIENTES nuevos por mes', ['Mes','Clientes'],
          clientesNuevosPorMes(db, { meses: 24 }).map(r => [q(r.periodo), r.clientes].join(',')));
      }
      return c.body(L.slice(1).join('\n'), 200, {'Content-Type':'text/csv','Content-Disposition':'attachment; filename="informes.csv"'});
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
        <div class="card-head"><h3>Construye tu gráfico</h3>
          <div style="display:flex;gap:.5rem;align-items:center">
            <select class="form-control" id="cPanel" style="width:auto;font-size:.8rem"><option value="">Mis paneles…</option></select>
            <button type="button" class="btn btn-secondary btn-sm" id="cGuardar">Guardar</button>
          </div>
        </div>
        <div class="card-body">
          <div class="form-row" style="align-items:flex-end;gap:.6rem;flex-wrap:wrap">
            <div class="form-group" style="min-width:150px"><label class="form-label">Mirar por</label>
              <select class="form-control" id="cDim"></select></div>
            <div class="form-group" id="cPeriodoWrap" style="min-width:120px"><label class="form-label">Agrupado</label>
              <select class="form-control" id="cPeriodo"><option value="mes">Por mes</option><option value="trimestre">Por trimestre</option><option value="anio">Por año</option></select></div>
            <div class="form-group" style="min-width:170px"><label class="form-label">Medir</label>
              <select class="form-control" id="cMed"></select></div>
            <div class="form-group" style="min-width:130px"><label class="form-label">Gráfico</label>
              <select class="form-control" id="cTipo">
                <option value="barras">Barras</option><option value="lineas">Líneas</option>
                <option value="tarta">Tarta</option><option value="tabla">Tabla</option>
              </select></div>
          </div>
          <div id="cAviso" style="display:none;margin:.6rem 0"></div>
          <div id="cChartWrap" style="height:280px;margin-top:.75rem"><canvas id="cChart"></canvas></div>
          <div id="cTablaWrap" style="display:none;margin-top:.75rem"></div>
        </div>
      </div>

      <div class="card" style="margin-bottom:1.5rem">
        <div class="card-head"><h3>Plan financiero — objetivos vs. real</h3>
          <div style="display:flex;gap:.5rem" id="planNuevoWrap"></div>
        </div>
        <div class="card-body">
          <div id="planAviso" style="display:none;margin-bottom:.6rem"></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Qué</th><th>Periodo</th><th>Alcance</th><th>Objetivo</th><th>Real</th><th>Desviación</th></tr></thead>
            <tbody id="planBody">${skeletonRows(4)}</tbody>
          </table></div>
          <p style="font-size:.72rem;color:var(--muted);margin-top:.6rem">
            Cada meta se fija por su cuenta y se compara con lo real de ese periodo. <strong>Que tus meses no
            sumen tu trimestre no es un error</strong>: son metas, no contabilidad — decides el nivel que quieras.
          </p>
        </div>
      </div>

      <div class="card" style="margin-bottom:1.5rem">
        <div class="card-head"><h3>Informes por área</h3>
          <div style="display:flex;gap:.5rem;align-items:center">
            <select class="form-control" id="infPeriodo" style="width:auto;font-size:.8rem">
              <option value="mes">Por mes</option><option value="trimestre">Por trimestre</option><option value="anio">Por año</option>
            </select>
            <a href="/api/erp/analytics/export/informes" class="btn btn-secondary btn-sm" id="infCsv">CSV Informes</a>
          </div>
        </div>
        <div class="card-body">
          <div class="tabs" id="infTabs">
            <button type="button" class="tab active" data-area="ventas">Ventas</button>
            <button type="button" class="tab" data-area="compras">Compras</button>
            <button type="button" class="tab" data-area="clientes">Clientes</button>
          </div>
          <div id="infBody" style="margin-top:.75rem">${skeletonRows(4)}</div>
        </div>
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

      // PASO 3 — INFORMES POR ÁREA. Tres pestañas (Ventas · Compras · Clientes) con sus diez informes.
      // Inventario y Contabilidad NO están, a propósito: ya se ven en Stock y en Libros y modelos, y
      // duplicarlos crearía dos verdades. Si falta un permiso se DICE, no se deja un hueco mudo.
      let infCache=null, infArea='ventas';
      const tabla=(cabs,filas)=>'<div class="table-wrap"><table><thead><tr>'+cabs.map(c=>'<th>'+c+'</th>').join('')+
        '</tr></thead><tbody>'+(filas.length?filas.join(''):'<tr><td colspan="'+cabs.length+'" style="color:var(--muted)">Sin datos en este periodo.</td></tr>')+'</tbody></table></div>';
      const h3=t=>'<h4 style="margin:1rem 0 .4rem;font-size:.85rem;color:var(--text2)">'+t+'</h4>';
      function pintarInformes(){
        const b=document.getElementById('infBody');
        if(!infCache){ b.innerHTML='<div style="color:var(--muted)">No he podido cargar los informes.</div>'; return; }
        if((infCache.sinPermiso||[]).includes(infArea)){
          b.innerHTML='<div style="color:var(--muted);padding:.5rem 0">No ves los informes de '+escHtml(infArea)+' porque no tienes su permiso.</div>'; return; }
        const d=infCache[infArea]; if(!d){ b.innerHTML='<div style="color:var(--muted)">Sin datos.</div>'; return; }
        let h='';
        if(infArea==='ventas'){
          h+=h3('Ventas por '+infCache.periodo+' (sin IVA)')+tabla(['Periodo','Facturas','Base'],
            d.porPeriodo.map(r=>'<tr><td><strong>'+escHtml(r.periodo)+'</strong></td><td>'+r.facturas+'</td><td>'+eur(r.base)+'</td></tr>'));
          h+=h3('Ventas por cliente')+tabla(['Cliente','Facturas','Base'],
            d.porCliente.map(r=>'<tr><td>'+escHtml(r.cliente)+'</td><td>'+r.facturas+'</td><td>'+eur(r.base)+'</td></tr>'));
          h+=h3('Ventas por responsable')+tabla(['Responsable','Facturas','Base'],
            d.porResponsable.map(r=>'<tr><td>'+escHtml(r.responsable)+'</td><td>'+r.facturas+'</td><td>'+eur(r.base)+'</td></tr>'));
          const c=d.cobrado;
          h+=h3('Cobrado vs pendiente (con IVA — es lo que entra en caja)')+tabla(['Facturado','Cobrado','Pendiente','% cobrado'],
            ['<tr><td>'+eur(c.facturado)+'</td><td style="color:var(--ok)">'+eur(c.cobrado)+'</td><td style="color:var(--warn)">'+eur(c.pendiente)+'</td><td><strong>'+Number(c.cobradoPct).toFixed(1)+'%</strong></td></tr>']);
        } else if(infArea==='compras'){
          h+=h3('Compras por proveedor (sin IVA)')+tabla(['Proveedor','Facturas','Base'],
            d.porProveedor.map(r=>'<tr><td>'+escHtml(r.proveedor)+'</td><td>'+r.facturas+'</td><td>'+eur(r.base)+'</td></tr>'));
          h+=h3('Gasto por categoría (sin IVA)')+tabla(['Categoría','Facturas','Base'],
            d.porCategoria.map(r=>'<tr><td>'+escHtml(r.categoria)+'</td><td>'+r.facturas+'</td><td>'+eur(r.base)+'</td></tr>'));
          h+=h3('Pendiente de pago por vencimiento')+tabla(['Tramo','Facturas','Pendiente'],
            d.pendientePorVencimiento.map(r=>'<tr><td>'+escHtml(r.etiqueta)+'</td><td>'+r.facturas+'</td><td>'+eur(r.pendiente)+'</td></tr>'));
        } else {
          h+=h3('Ranking por facturación (sin IVA)')+tabla(['Cliente','Facturas','Base'],
            d.ranking.map(r=>'<tr><td>'+escHtml(r.cliente)+'</td><td>'+r.facturas+'</td><td>'+eur(r.base)+'</td></tr>'));
          h+=h3('Clientes dormidos (con su ritmo aprendido)')+tabla(['Cliente','Días sin comprar','Su umbral','Compras'],
            d.dormidos.map(r=>'<tr><td>'+escHtml(r.name||r.cliente||'')+'</td><td>'+(r.dias??'—')+'</td><td>'+(r.umbral??'—')+'</td><td>'+(r.compras??'—')+'</td></tr>'));
          h+=h3('Deuda vencida por cliente')+tabla(['Cliente','Deuda','Días de la más vencida'],
            d.deudaVencida.map(r=>'<tr><td>'+escHtml(r.name||'')+'</td><td style="color:var(--danger)">'+eur(r.deudaTotal)+'</td><td>'+r.maxVencida+'</td></tr>'));
          h+=h3('Clientes nuevos por mes')+tabla(['Mes','Nuevos'],
            d.nuevosPorMes.map(r=>'<tr><td>'+escHtml(r.periodo)+'</td><td>'+r.clientes+'</td></tr>'));
        }
        b.innerHTML=h;
      }
      function engancharTabs(){
        document.querySelectorAll('#infTabs .tab').forEach(t=>t.addEventListener('click',()=>{
          document.querySelectorAll('#infTabs .tab').forEach(x=>x.classList.remove('active'));
          t.classList.add('active'); infArea=t.dataset.area; pintarInformes();
        }));
        document.getElementById('infPeriodo').addEventListener('change',async e=>{
          const p=e.target.value;
          document.getElementById('infCsv').href='/api/erp/analytics/export/informes?periodo='+p;
          infCache=await api('GET','/api/erp/analytics/informes?periodo='+p).catch(()=>null);
          pintarInformes();
        });
      }

      // PASO 3 · BLOQUE 2 — PLAN FINANCIERO. Solo salen las metas que el dueño FIJÓ: un plan lleno de
      // ceros que nadie puso sería ruido disfrazado de información. Fijar es de owner/admin; quien no
      // puede, ve el plan pero no el botón (y el servidor lo vuelve a comprobar: el botón no es el
      // candado).
      let planCache=null;
      const TIPO_LABEL={facturacion:'Facturación',beneficio:'Beneficio'};
      function pintarPlan(){
        const body=document.getElementById('planBody'), av=document.getElementById('planAviso');
        const wrap=document.getElementById('planNuevoWrap');
        if(!planCache){ body.innerHTML=window.emptyRow(6,'No he podido cargar el plan.'); return; }
        wrap.innerHTML = planCache.puedeFijar
          ? '<button type="button" class="btn btn-sm" id="btnMeta">Fijar objetivo</button>' : '';
        if(planCache.puedeFijar) document.getElementById('btnMeta').onclick=nuevaMeta;
        const f=planCache.filas||[];
        if(!f.length){
          body.innerHTML=window.emptyRow(6, planCache.puedeFijar
            ? 'Todavía no has fijado ningún objetivo. Pon una meta y aquí verás cómo vas.'
            : 'El dueño aún no ha fijado objetivos.');
          av.style.display='none'; return;
        }
        // El aviso del beneficio es el mismo de Rentabilidad y por el mismo motivo: sin él, un
        // beneficio bajo se lee como "voy fatal" cuando media facturación ni se está juzgando.
        const conAviso=f.filter(x=>x.aviso);
        if(conAviso.length){
          const s=Math.max(...conAviso.map(x=>x.aviso.sinCoste));
          av.style.display='';
          av.innerHTML='<div style="background:var(--accent-soft);border:1px solid var(--border2);border-radius:8px;padding:.6rem .75rem;font-size:.78rem;color:var(--text2)">'+
            '<strong style="color:var(--text)">El beneficio solo juzga lo que tiene coste.</strong> '+
            'Hay hasta '+eur(s)+' de ventas sin coste registrado (servicios, conceptos libres o productos nunca comprados) que no cuentan como beneficio. No es que pierdas: es que su coste no se sabe.</div>';
        } else av.style.display='none';
        body.innerHTML=f.map(x=>{
          const col=x.cumplido?'var(--ok)':'var(--danger)';
          const signo=x.desviacion>=0?'+':'';
          return '<tr>'+
            '<td><strong>'+TIPO_LABEL[x.tipo]+'</strong></td>'+
            '<td>'+escHtml(x.clave)+' <span style="color:var(--muted);font-size:.7rem">('+x.periodo+')</span></td>'+
            '<td>'+escHtml(x.responsable)+'</td>'+
            '<td>'+eur(x.objetivo)+'</td>'+
            '<td>'+eur(x.real)+'</td>'+
            '<td style="color:'+col+'"><strong>'+signo+eur(x.desviacion)+'</strong>'+
              (x.desviacionPct==null?'':' <span style="font-size:.72rem">('+signo+Number(x.desviacionPct).toFixed(1)+'%)</span>')+'</td>'+
          '</tr>';
        }).join('');
      }
      async function nuevaMeta(){
        const tipo=prompt('¿Qué objetivo? Escribe: facturacion  o  beneficio'); if(!tipo) return;
        const periodo=prompt('¿Periodo? Escribe: mes, trimestre o anio'); if(!periodo) return;
        const ej=periodo==='mes'?'2026-07':periodo==='trimestre'?'2026-T3':'2026';
        const clave=prompt('¿Cuál en concreto? Ejemplo para '+periodo+': '+ej); if(!clave) return;
        const quien=prompt('¿De quién? Deja vacío para TODO EL NEGOCIO, o pon el nº de usuario del responsable')||'';
        const valor=prompt('¿Cuánto (sin IVA)? Pon 0 para quitar la meta'); if(valor===null) return;
        const body={tipo:tipo.trim(),periodo:periodo.trim(),clave:clave.trim(),
          alcance:quien.trim()?'responsable':'global',user_id:quien.trim()?Number(quien.trim()):null,valor:Number(valor)};
        try{ const r=await api('POST','/api/erp/analytics/plan',body); planCache={...planCache,filas:r.filas}; pintarPlan(); toast('Objetivo guardado'); }
        catch(e){ /* api() ya enseña el error del servidor en un toast */ }
      }

      // ── PASO 4a — EL CONSTRUCTOR. La puerta visual: el usuario cruza lo que quiere y elige cómo
      // verlo. No pide gráficos cerrados: pide una receta (dimensión × medida × gráfico) y el
      // servidor la cruza sobre el conjunto YA verificado — por eso ningún panel puede contradecir a
      // Ventas. Los desplegables solo ofrecen lo que el usuario puede ver, pero eso es cortesía: el
      // servidor lo revalida (probado en el gate).
      let cCampos=null, cChartInst=null, cPaneles=[];
      const PALETA=['#0ea5e9','#10b981','#f59e0b','#8b5cf6','#ef4444','#14b8a6','#ec4899','#64748b'];
      function llenarConstructor(){
        if(!cCampos||cCampos.error){ return; }
        const dim=document.getElementById('cDim'), med=document.getElementById('cMed');
        dim.innerHTML=Object.entries(cCampos.dimensiones).map(([k,v])=>'<option value="'+k+'">'+escHtml(v.etiqueta)+'</option>').join('');
        med.innerHTML=Object.entries(cCampos.medidas).map(([k,v])=>'<option value="'+k+'">'+escHtml(v.etiqueta)+'</option>').join('');
        for(const id of ['cDim','cPeriodo','cMed','cTipo']) document.getElementById(id).addEventListener('change',dibujar);
        document.getElementById('cGuardar').onclick=guardarPanelUI;
        document.getElementById('cPanel').onchange=abrirPanel;
        dibujar();
      }
      function recetaActual(){
        return { dimension:document.getElementById('cDim').value, periodo:document.getElementById('cPeriodo').value,
                 medidas:[document.getElementById('cMed').value], grafico:document.getElementById('cTipo').value };
      }
      async function dibujar(){
        const r=recetaActual();
        // El selector de agrupación solo tiene sentido en la dimensión fecha: enseñarlo en "cliente"
        // sugeriría que hace algo, y no haría nada.
        document.getElementById('cPeriodoWrap').style.display = r.dimension==='fecha' ? '' : 'none';
        let d; try{ d=await api('POST','/api/erp/analytics/constructor/cruzar',r); }catch(e){ return; }
        const med=r.medidas[0], meta=cCampos.medidas[med]||{};
        const av=document.getElementById('cAviso');
        if(d.aviso){ av.style.display='';
          av.innerHTML='<div style="background:var(--accent-soft);border:1px solid var(--border2);border-radius:8px;padding:.55rem .7rem;font-size:.75rem;color:var(--text2)">'+
            '<strong style="color:var(--text)">El margen solo juzga lo que tiene coste.</strong> Quedan fuera '+eur(d.aviso.sinCoste)+
            ' de ventas sin coste registrado. No es que pierdas: es que su coste no se sabe.</div>';
        } else av.style.display='none';
        const fmt=v=>v==null?'—':(meta.dinero?eur(v):(meta.pct?Number(v).toFixed(1)+'%':Number(v)));
        if(r.grafico==='tabla'){
          document.getElementById('cChartWrap').style.display='none';
          const w=document.getElementById('cTablaWrap'); w.style.display='';
          w.innerHTML='<div class="table-wrap"><table><thead><tr><th>'+escHtml(d.dimensionEtiqueta)+'</th><th>'+escHtml(meta.etiqueta||med)+'</th></tr></thead><tbody>'+
            (d.filas.length?d.filas.map(f=>'<tr><td>'+escHtml(f.clave)+'</td><td>'+fmt(f[med])+'</td></tr>').join('')
             :'<tr><td colspan="2" style="color:var(--muted)">Sin datos.</td></tr>')+'</tbody></table></div>';
          return;
        }
        document.getElementById('cTablaWrap').style.display='none';
        document.getElementById('cChartWrap').style.display='';
        if(cChartInst) cChartInst.destroy();
        const tipo=r.grafico==='lineas'?'line':r.grafico==='tarta'?'pie':'bar';
        // Los null (sin coste conocido) NO se pintan como 0: en un gráfico, un 0 es una afirmación
        // ("no ganó nada") y null es un hueco, que es la verdad.
        const datos=d.filas.map(f=>f[med]);
        cChartInst=new Chart(document.getElementById('cChart').getContext('2d'),{
          type:tipo,
          data:{labels:d.filas.map(f=>String(f.clave).substring(0,22)),
                datasets:[{label:meta.etiqueta||med,data:datos,
                  backgroundColor:tipo==='pie'?PALETA:'rgba(14,165,233,.6)',
                  borderColor:tipo==='pie'?'#0b1220':'#0ea5e9',borderWidth:1,borderRadius:tipo==='bar'?4:0,
                  tension:tipo==='line'?.25:0,spanGaps:false}]},
          options:{responsive:true,maintainAspectRatio:false,
            plugins:{legend:{display:tipo==='pie'},tooltip:{callbacks:{label:x=>' '+fmt(x.parsed.y ?? x.parsed)}}},
            scales:tipo==='pie'?{}:{y:{beginAtZero:true,ticks:{callback:v=>meta.dinero?'${sym}'+v:(meta.pct?v+'%':v)}}}}
        });
      }
      async function guardarPanelUI(){
        const nombre=prompt('¿Cómo lo llamas?'); if(!nombre) return;
        try{ const r=await api('POST','/api/erp/analytics/constructor/paneles',{nombre,config:recetaActual()});
          cPaneles=r.paneles; llenarPaneles(); toast('Panel guardado'); }catch(e){}
      }
      function llenarPaneles(){
        document.getElementById('cPanel').innerHTML='<option value="">Mis paneles…</option>'+
          cPaneles.map(p=>'<option value="'+p.id+'">'+escHtml(p.nombre)+'</option>').join('');
      }
      function abrirPanel(e){
        const p=cPaneles.find(x=>String(x.id)===e.target.value); if(!p||!p.config) return;
        // Se re-CRUZA, no se pinta lo guardado: un panel guarda la receta, no los datos, así que los
        // permisos se revalidan al abrirlo. Si guardara resultados, sería una fuga con fecha.
        document.getElementById('cDim').value=p.config.dimension;
        document.getElementById('cPeriodo').value=p.config.periodo||'mes';
        document.getElementById('cMed').value=(p.config.medidas||['base'])[0];
        document.getElementById('cTipo').value=p.config.grafico||'barras';
        dibujar();
      }

      async function loadCharts(){
        const days=document.getElementById('periodSel').value;
        const [ov,period,top,stock,mg,resp,inf,plan,campos,paneles]=await Promise.all([
          api('GET','/api/erp/analytics/overview').catch(()=>({})),
          api('GET','/api/erp/analytics/sales-by-period?days='+days).catch(()=>[]),
          api('GET','/api/erp/analytics/best-sellers?limit=8').catch(()=>[]),
          api('GET','/api/erp/analytics/stock-report').catch(()=>[]),
          api('GET','/api/erp/analytics/margen').catch(()=>null),
          api('GET','/api/erp/analytics/responsable').catch(()=>null),
          api('GET','/api/erp/analytics/informes').catch(()=>null),
          api('GET','/api/erp/analytics/plan').catch(()=>null),
          api('GET','/api/erp/analytics/constructor/campos').catch(()=>null),
          api('GET','/api/erp/analytics/constructor/paneles').catch(()=>[])
        ]);
        document.getElementById('kRev').textContent='${sym}'+Number(ov.totalRevenue||0).toFixed(2);
        document.getElementById('kOrd').textContent=ov.totalOrders||0;
        document.getElementById('kAvg').textContent='${sym}'+Number(ov.avgOrder||0).toFixed(2);
        document.getElementById('kCli').textContent=ov.totalClients||0;

        pintarMargen(mg);
        respCache=resp; llenarSelResponsable(); pintarResponsable();
        infCache=inf; pintarInformes();
        planCache=plan; pintarPlan();
        if(!cCampos){ cCampos=campos; cPaneles=Array.isArray(paneles)?paneles:[]; llenarPaneles(); llenarConstructor(); }

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
      engancharTabs();
      loadCharts();
      </script>`;
    return c.html(adminLayout('Analítica', content, 'analytics', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
