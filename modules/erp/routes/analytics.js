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
import { camposPara, cruzar, guardarPanel, listarPaneles, borrarPanel, areasPara, areaPerm,
         areasComparables, compararEnTiempo } from '../constructor-analitica.js';   // PASO 4a/4a-bis/4b: la puerta visual
import { modoDeEmpresa } from '../margen.js';   // G2: qué porcentaje manda como titular

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
      // El MODO viaja con los datos: la pantalla no puede pintar un % sin saber cuál está pintando.
      return c.json({ resumen: margenResumen(db, { from, to }), productos: margenPorProducto(db, { from, to }),
                      modo: modoDeEmpresa(db) });
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

  // ── ESCALERA · PASO 4a + 4a-bis — CONSTRUCTOR DE ANALÍTICAS ────────────────────────────────────
  // La puerta visual: el usuario elige qué cruzar y se dibuja SUS gráficos (CANON §3-bis, las dos
  // puertas). CUATRO ÁREAS: ventas · compras · clientes · inventario. Cada una tras SU permiso base
  // (invoices/purchases/clients/inventory .read), y cada campo puede exigir uno extra. El servidor lo
  // revalida en `cruzar()`: el desplegable filtrado NO es el candado, solo la cortesía.
  const permDe = c => (p) => can(c, p);
  const exigeArea = (c, area) => {
    const perm = areaPerm(area || 'ventas');
    if (perm && !can(c, perm)) { const e = new Error('No tienes permiso para el área ' + (area || 'ventas')); e.status = 403; throw e; }
  };

  // Qué áreas puede el usuario (para el selector de área de la pantalla).
  api.get('/constructor/areas', requirePerm('analytics.read'), c => {
    try { return c.json(areasPara(permDe(c))); }
    catch(e) { return c.json({error:safeError(e)}, e.status || 500); }
  });

  api.get('/constructor/campos', requirePerm('analytics.read'), c => {
    try {
      const area = c.req.query('area') || 'ventas';
      exigeArea(c, area);
      return c.json(camposPara(permDe(c), area, modoDeEmpresa(db)));
    } catch(e) { return c.json({error:safeError(e)}, e.status || 500); }
  });

  api.post('/constructor/cruzar', requirePerm('analytics.read'), async c => {
    try {
      const d = await c.req.json();
      exigeArea(c, d.area);   // el área base; los campos los revalida cruzar()
      return c.json(cruzar(db, { ...d, hasPerm: permDe(c) }));
    } catch(e) { return c.json({error:safeError(e)}, e.status || 500); }
  });

  // PASO 4b — COMPARAR ÁREAS EN EL TIEMPO (combinar fuentes). Cada serie es (área, medida) sobre el eje
  // temporal; `compararEnTiempo` revalida el permiso de CADA área vía `cruzar` — comparar no es una
  // puerta trasera. No se suman granos distintos: cada área es su propia serie.
  api.get('/constructor/comparables', requirePerm('analytics.read'), c => {
    try { return c.json(areasComparables(modoDeEmpresa(db)).filter(a => can(c, areaPerm(a.area)))); }
    catch(e) { return c.json({error:safeError(e)}, e.status || 500); }
  });
  api.post('/constructor/comparar', requirePerm('analytics.read'), async c => {
    try {
      const d = await c.req.json();
      return c.json(compararEnTiempo(db, { ...d, hasPerm: permDe(c) }));
    } catch(e) { return c.json({error:safeError(e)}, e.status || 500); }
  });

  // PANELES — de quien los crea. `user_id` de la SESIÓN, nunca del cuerpo (si no, cualquiera guardaría
  // en el nombre de otro). Solo `analytics.read`: guardan la RECETA, y al abrirlos `cruzar()` revalida
  // el permiso del área — no hace falta el permiso del área para tener la receta guardada.
  api.get('/constructor/paneles', requirePerm('analytics.read'), c => {
    try { return c.json(listarPaneles(db, c.get('session')?.userId)); }
    catch(e) { return c.json({error:safeError(e)}, e.status || 500); }
  });

  api.post('/constructor/paneles', requirePerm('analytics.read'), async c => {
    try {
      const d = await c.req.json();
      // Comparar no tiene un área única; solo se exige el área cuando el panel es de dimensión.
      if (d.config?.modo !== 'comparar') exigeArea(c, d.config?.area);
      const r = guardarPanel(db, c.get('session')?.userId, d);
      return c.json({ ...r, paneles: listarPaneles(db, c.get('session')?.userId) });
    } catch(e) { return c.json({error:safeError(e)}, e.status || 500); }
  });

  api.delete('/constructor/paneles/:id', requirePerm('analytics.read'), c => {
    try {
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
            <div class="kpi"><div class="kpi-label" id="mPctLbl">Margen</div><div class="kpi-val" id="mPct">-</div></div>
            <div class="kpi"><div class="kpi-label">Base del margen</div><div class="kpi-val" id="mIng">-</div></div>
            <div class="kpi"><div class="kpi-label">Coste</div><div class="kpi-val" id="mCos">-</div></div>
          </div>
          <!-- G3 — las DOS cifras, siempre, debajo del titular. Ni una pantalla enseña un % de
               margen sin decir sobre qué se divide. -->
          <div id="mgDoble" style="margin-top:.6rem;font-size:.82rem;color:var(--text2)"></div>
          <div id="mgAviso" style="display:none;margin-top:.75rem"></div>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Producto</th><th>Unidades</th><th>Ingresos sin IVA</th><th>Coste</th><th>Beneficio</th><th id="mgColLbl">Margen</th></tr></thead>
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
            <div class="form-group" style="min-width:130px"><label class="form-label">Área</label>
              <select class="form-control" id="cArea"></select></div>
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
          <div class="form-group" style="margin-top:.5rem">
            <label class="form-label" style="display:flex;align-items:center;gap:.5rem">
              <input type="checkbox" id="cCalcOn" style="width:15px;height:15px"> Cálculo propio
              <span style="font-size:.7rem;color:var(--muted)">— una fórmula con tus medidas, p. ej. <code>beneficio / base * 100</code></span></label>
            <input class="form-control" id="cFormula" placeholder="beneficio / base * 100" style="display:none;margin-top:.35rem;font-family:ui-monospace,monospace">
            <div id="cFormulaAyuda" style="display:none;font-size:.7rem;color:var(--muted);margin-top:.25rem"></div>
          </div>
          <div id="cAviso" style="display:none;margin:.6rem 0"></div>
          <div id="cChartWrap" style="height:280px;margin-top:.75rem"><canvas id="cChart"></canvas></div>
          <div id="cTablaWrap" style="display:none;margin-top:.75rem"></div>
        </div>
      </div>

      <div class="card" style="margin-bottom:1.5rem">
        <div class="card-head"><h3>Comparar áreas en el tiempo</h3>
          <div style="display:flex;gap:.5rem;align-items:center">
            <select class="form-control" id="cmpPeriodo" style="width:auto;font-size:.8rem"><option value="mes">Por mes</option><option value="trimestre">Por trimestre</option><option value="anio">Por año</option></select>
          </div>
        </div>
        <div class="card-body">
          <p style="font-size:.72rem;color:var(--muted);margin-bottom:.5rem">Cada área es su propia línea sobre el mismo eje de tiempo — p. ej. <strong>facturación vs. gasto por mes</strong>. No se suman entre sí: se ponen lado a lado.</p>
          <div id="cmpSeries"></div>
          <button type="button" class="btn btn-secondary btn-sm" id="cmpAdd" style="margin-top:.4rem">+ Añadir serie</button>
          <div id="cmpChartWrap" style="height:280px;margin-top:.75rem"><canvas id="cmpChart"></canvas></div>
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
      const eur=v=>(v==null?'—':Number(v).toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:'always'})+' ${sym}');
      const pctEs=v=>(v==null?'—':Number(v).toLocaleString('es-ES',{minimumFractionDigits:1,maximumFractionDigits:1,useGrouping:'always'})+' %');
      function pintarMargen(mg){
        const body=document.getElementById('mgBody'), aviso=document.getElementById('mgAviso');
        if(!mg||!mg.resumen){ body.innerHTML=window.emptyRow(6,'No he podido calcular la rentabilidad ahora mismo. Vuelve a cargar la página.'); return; }
        const r=mg.resumen;
        // G3 — EL PORCENTAJE NUNCA VA DESNUDO. El titular obedece al ajuste de empresa y la etiqueta
        // dice sobre qué se divide. Este es el mismo fallo del 36,3 % de la ficha de cliente: el
        // número era correcto y aun así engañaba, porque su denominador no aparecía en pantalla.
        var MG = mg.modo === 'coste' ? 'coste' : 'venta';
        var m = r.margen || {};
        var titular = MG === 'coste' ? m.pctCoste : m.pctVenta;
        document.getElementById('mBen').textContent = m.euros==null?'—':eur(m.euros);
        document.getElementById('mPct').textContent = titular==null?'—':pctEs(titular);
        var suf = MG==='coste' ? 'sobre lo que te costó' : 'sobre lo que cobras';
        document.getElementById('mPctLbl').textContent = 'Margen ' + suf;
        var colLbl = document.getElementById('mgColLbl'); if (colLbl) colLbl.textContent = 'Margen ' + suf;
        document.getElementById('mIng').textContent=eur(r.ingresosConCoste);
        document.getElementById('mCos').textContent=eur(r.coste);
        // Y las DOS cifras juntas, siempre, con el importe en euros: es el detalle que exige G3.
        var doble = document.getElementById('mgDoble');
        if (doble) doble.innerHTML = m.hay
          ? '<span'+(MG==='venta'?' style="font-weight:700;color:var(--text)"':'')+'>'+pctEs(m.pctVenta)+' sobre lo que cobras</span>'
            + ' &nbsp;·&nbsp; <span'+(MG==='coste'?' style="font-weight:700;color:var(--text)"':'')+'>'+pctEs(m.pctCoste)+' sobre lo que te costó</span>'
            + ' &nbsp;·&nbsp; los dos son '+eur(m.euros)+' sobre una base de '+eur(m.venta)
            + '. <a href="/admin/settings" style="font-size:.78rem">Cambiar cuál mando</a>'
          : 'Sin ninguna línea con coste conocido no se puede calcular margen. No es un 0: es que no se sabe.';
        // El aviso NO es decorativo: sin él, "beneficio 6.000 €" sobre 985.000 € facturados se lee
        // como un desastre, cuando en realidad el beneficio solo mide 63.000 € de esa facturación.
        if(r.sinCoste>0){
          aviso.style.display='';
          aviso.innerHTML='<div style="background:var(--accent-soft);border:1px solid var(--border2);border-radius:8px;padding:.6rem .75rem;font-size:.8rem;color:var(--text2)">'+
            '<strong style="color:var(--text)">El beneficio mira solo la parte que tiene coste.</strong> '+
            'Quedan fuera <strong>'+eur(r.sinCoste)+'</strong> ('+pctEs(r.sinCostePct)+' de tus ventas) '+
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
          '<td>'+(p.margen&&p.margen.hay
            ? '<strong>'+pctEs(MG==='coste'?p.margen.pctCoste:p.margen.pctVenta)+'</strong>'
            : '<span style="color:var(--muted)">—</span>')+'</td>'+
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
      // El constructor arranca en Ventas y cambia de área sin recargar la página. Al cambiar de área se
      // vuelven a pedir SUS campos (dimensiones y medidas distintas) — y como el catálogo lo filtra el
      // servidor por permiso, el usuario solo ve las áreas y campos que puede.
      let cArea='ventas';
      function llenarAreas(areas){
        const sel=document.getElementById('cArea');
        const ks=Object.keys(areas||{});
        sel.innerHTML=ks.map(k=>'<option value="'+k+'">'+escHtml(areas[k].etiqueta)+'</option>').join('');
        if(!ks.length){ document.getElementById('cChartWrap').innerHTML='<div style="color:var(--muted);padding:1rem 0">No tienes acceso a ninguna área para construir gráficos.</div>'; }
      }
      function rellenarCampos(){
        if(!cCampos||cCampos.error){ return; }
        document.getElementById('cDim').innerHTML=Object.entries(cCampos.dimensiones).map(([k,v])=>'<option value="'+k+'">'+escHtml(v.etiqueta)+'</option>').join('');
        document.getElementById('cMed').innerHTML=Object.entries(cCampos.medidas).map(([k,v])=>'<option value="'+k+'">'+escHtml(v.etiqueta)+'</option>').join('');
      }
      function engancharConstructor(){
        // Listeners UNA sola vez (los <select> conservan su listener aunque cambien sus <option>).
        for(const id of ['cDim','cPeriodo','cMed','cTipo']) document.getElementById(id).addEventListener('change',dibujar);
        document.getElementById('cArea').addEventListener('change',async e=>{
          cArea=e.target.value;
          cCampos=await api('GET','/api/erp/analytics/constructor/campos?area='+cArea).catch(()=>null);
          rellenarCampos(); dibujar();
        });
        document.getElementById('cGuardar').onclick=guardarPanelUI;
        document.getElementById('cPanel').onchange=abrirPanel;
        // PASO 4b — cálculo propio: al marcarlo aparece el campo de fórmula y la lista de medidas
        // disponibles. Se redibuja al escribir (con una pausa para no llamar en cada tecla).
        document.getElementById('cCalcOn').addEventListener('change',()=>{ toggleFormula(); dibujar(); });
        let tF; document.getElementById('cFormula').addEventListener('input',()=>{ clearTimeout(tF); tF=setTimeout(dibujar,500); });
        rellenarCampos(); toggleFormula(); dibujar();
      }
      function toggleFormula(){
        const on=document.getElementById('cCalcOn').checked;
        document.getElementById('cFormula').style.display=on?'':'none';
        const ayuda=document.getElementById('cFormulaAyuda');
        ayuda.style.display=on?'':'none';
        if(on&&cCampos&&cCampos.medidas) ayuda.textContent='Medidas que puedes usar: '+Object.keys(cCampos.medidas).join(', ');
        // El selector "Medir" queda en segundo plano cuando hay fórmula (lo que se pinta es el cálculo).
        document.getElementById('cMed').disabled=on;
      }
      function recetaActual(){
        const calcOn=document.getElementById('cCalcOn').checked;
        const f=document.getElementById('cFormula').value.trim();
        const r={ area:cArea, dimension:document.getElementById('cDim').value, periodo:document.getElementById('cPeriodo').value,
                  medidas:[document.getElementById('cMed').value], grafico:document.getElementById('cTipo').value };
        if(calcOn&&f) r.formula=f;
        return r;
      }
      async function dibujar(){
        const r=recetaActual();
        // El "agrupado por" solo tiene sentido en la dimensión fecha Y en áreas que agrupan por tiempo
        // (ventas/compras/inventario; clientes no). Enseñarlo donde no hace nada sugeriría que hace algo.
        document.getElementById('cPeriodoWrap').style.display = (r.dimension==='fecha' && cCampos && cCampos.usaPeriodo) ? '' : 'none';
        let d; try{ d=await api('POST','/api/erp/analytics/constructor/cruzar',r); }catch(e){ return; }
        // Si hay fórmula, lo que se pinta es el CÁLCULO (una medida derivada, número plano).
        const med=d.calculo?'calculo':r.medidas[0];
        const meta=d.calculo?{etiqueta:'Cálculo: '+(r.formula||''),dinero:false}:((cCampos.medidas||{})[med]||{});
        const av=document.getElementById('cAviso');
        // El aviso de "sin coste" solo existe en Ventas (el margen). En las demás áreas viene a null.
        if(d.aviso&&d.aviso.sinCoste){ av.style.display='';
          av.innerHTML='<div style="background:var(--accent-soft);border:1px solid var(--border2);border-radius:8px;padding:.55rem .7rem;font-size:.75rem;color:var(--text2)">'+
            '<strong style="color:var(--text)">El margen solo juzga lo que tiene coste.</strong> Quedan fuera '+eur(d.aviso.sinCoste)+
            ' de ventas sin coste registrado. No es que pierdas: es que su coste no se sabe.</div>';
        } else av.style.display='none';
        // En español: 30,0 % — no "30.0%". La etiqueta de la medida ya dice la base (viene de
        // camposPara con el modo de la empresa), así que el porcentaje no queda desnudo.
        const fmt=v=>v==null?'—':(meta.dinero?eur(v):(meta.pct?pctEs(v):Number(v)));
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
        // PASO 4b — compartir: se pregunta al guardar. Compartir enseña la RECETA a todo el negocio;
        // al abrirla, cada uno la ve con SUS permisos (un panel de Compras no se abre sin compras).
        const compartido=confirm('¿Compartirlo con el equipo? Verán el gráfico, pero cada uno con sus propios permisos: si no pueden ver un área, ese panel no se les abre.');
        try{ const r=await api('POST','/api/erp/analytics/constructor/paneles',{nombre,config:recetaActual(),compartido});
          cPaneles=r.paneles; llenarPaneles(); toast('Panel guardado'); }catch(e){}
      }
      function llenarPaneles(){
        // Los propios y, aparte, los que alguien compartió. Un panel compartido dice de quién es.
        const mios=cPaneles.filter(p=>p.propio), otros=cPaneles.filter(p=>!p.propio);
        let h='<option value="">Mis paneles…</option>';
        h+=mios.map(p=>'<option value="'+p.id+'">'+escHtml(p.nombre)+(p.compartido?' (compartido)':'')+'</option>').join('');
        if(otros.length) h+='<optgroup label="Compartidos contigo">'+otros.map(p=>'<option value="'+p.id+'">'+escHtml(p.nombre)+' · '+escHtml(p.autor||'')+'</option>').join('')+'</optgroup>';
        document.getElementById('cPanel').innerHTML=h;
      }
      async function abrirPanel(e){
        const p=cPaneles.find(x=>String(x.id)===e.target.value); if(!p||!p.config) return;
        // Se re-CRUZA, no se pinta lo guardado: un panel guarda la receta, no los datos, así que los
        // permisos se revalidan al abrirlo. Si guardara resultados, sería una fuga con fecha. Como el
        // panel puede ser de OTRA área, primero se cambia de área y se cargan SUS campos.
        cArea=p.config.area||'ventas';
        document.getElementById('cArea').value=cArea;
        cCampos=await api('GET','/api/erp/analytics/constructor/campos?area='+cArea).catch(()=>cCampos);
        rellenarCampos();
        document.getElementById('cDim').value=p.config.dimension;
        document.getElementById('cPeriodo').value=p.config.periodo||'mes';
        // Restaurar el cálculo propio si el panel lo tenía.
        document.getElementById('cCalcOn').checked=!!p.config.formula;
        document.getElementById('cFormula').value=p.config.formula||'';
        toggleFormula();
        document.getElementById('cMed').value=(p.config.medidas||[Object.keys(cCampos.medidas)[0]])[0];
        document.getElementById('cTipo').value=p.config.grafico||'barras';
        dibujar();
      }

      // ── PASO 4b — COMPARAR ÁREAS EN EL TIEMPO ──────────────────────────────
      let cmpComparables=null, cmpChartInst=null;
      const CMP_PAL=['#0ea5e9','#f59e0b','#10b981','#8b5cf6','#ef4444','#14b8a6'];
      function filaSerie(){
        if(!cmpComparables||!cmpComparables.length) return '';
        const areaOpts=cmpComparables.map(a=>'<option value="'+a.area+'">'+escHtml(a.etiqueta)+'</option>').join('');
        return '<div class="form-row cmp-serie" style="gap:.5rem;margin-bottom:.4rem;align-items:flex-end">'+
          '<div class="form-group" style="min-width:130px"><select class="form-control cmp-area">'+areaOpts+'</select></div>'+
          '<div class="form-group" style="min-width:150px"><select class="form-control cmp-med"></select></div>'+
          '<button type="button" class="btn btn-secondary btn-sm cmp-del">×</button></div>';
      }
      function rellenarMedSerie(row){
        const a=cmpComparables.find(x=>x.area===row.querySelector('.cmp-area').value);
        row.querySelector('.cmp-med').innerHTML=a?Object.entries(a.medidas).map(([k,v])=>'<option value="'+k+'">'+escHtml(v.etiqueta)+'</option>').join(''):'';
      }
      function engancharSerie(row){
        row.querySelector('.cmp-area').addEventListener('change',()=>{ rellenarMedSerie(row); dibujarCmp(); });
        row.querySelector('.cmp-med').addEventListener('change',dibujarCmp);
        row.querySelector('.cmp-del').addEventListener('click',()=>{ if(document.querySelectorAll('.cmp-serie').length>2){ row.remove(); dibujarCmp(); } });
      }
      function addSerie(){
        const wrap=document.getElementById('cmpSeries');
        wrap.insertAdjacentHTML('beforeend',filaSerie());
        const row=wrap.lastElementChild; rellenarMedSerie(row); engancharSerie(row); return row;
      }
      async function dibujarCmp(){
        const rows=[...document.querySelectorAll('.cmp-serie')];
        const series=rows.map(r=>({area:r.querySelector('.cmp-area').value,medida:r.querySelector('.cmp-med').value}));
        if(series.length<2) return;
        let d; try{ d=await api('POST','/api/erp/analytics/constructor/comparar',{series,periodo:document.getElementById('cmpPeriodo').value}); }catch(e){ return; }
        if(cmpChartInst) cmpChartInst.destroy();
        cmpChartInst=new Chart(document.getElementById('cmpChart').getContext('2d'),{
          type:'line',
          data:{labels:d.labels,datasets:d.series.map((s,i)=>({label:s.etiqueta,data:s.datos,
            borderColor:CMP_PAL[i%CMP_PAL.length],backgroundColor:CMP_PAL[i%CMP_PAL.length],tension:.25,spanGaps:false}))},
          options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true}},scales:{y:{beginAtZero:true}}}
        });
      }
      function engancharComparar(){
        if(!cmpComparables||cmpComparables.length<2){
          document.getElementById('cmpSeries').innerHTML='<div style="color:var(--muted);font-size:.8rem">Necesitas acceso a al menos dos áreas para comparar.</div>';
          document.getElementById('cmpAdd').style.display='none'; return;
        }
        // Dos series de arranque: la primera y la segunda área comparables.
        const r1=addSerie(); const r2=addSerie();
        if(cmpComparables[1]) r2.querySelector('.cmp-area').value=cmpComparables[1].area;
        rellenarMedSerie(r2);
        document.getElementById('cmpAdd').onclick=()=>{ if(document.querySelectorAll('.cmp-serie').length<6){ addSerie(); dibujarCmp(); } };
        document.getElementById('cmpPeriodo').addEventListener('change',dibujarCmp);
        dibujarCmp();
      }

      async function loadCharts(){
        const days=document.getElementById('periodSel').value;
        const [ov,period,top,stock,mg,resp,inf,plan,campos,paneles,areas,comparables]=await Promise.all([
          api('GET','/api/erp/analytics/overview').catch(()=>({})),
          api('GET','/api/erp/analytics/sales-by-period?days='+days).catch(()=>[]),
          api('GET','/api/erp/analytics/best-sellers?limit=8').catch(()=>[]),
          api('GET','/api/erp/analytics/stock-report').catch(()=>[]),
          api('GET','/api/erp/analytics/margen').catch(()=>null),
          api('GET','/api/erp/analytics/responsable').catch(()=>null),
          api('GET','/api/erp/analytics/informes').catch(()=>null),
          api('GET','/api/erp/analytics/plan').catch(()=>null),
          api('GET','/api/erp/analytics/constructor/campos').catch(()=>null),
          api('GET','/api/erp/analytics/constructor/paneles').catch(()=>[]),
          api('GET','/api/erp/analytics/constructor/areas').catch(()=>({})),
          api('GET','/api/erp/analytics/constructor/comparables').catch(()=>[])
        ]);
        document.getElementById('kRev').textContent='${sym}'+Number(ov.totalRevenue||0).toFixed(2);
        document.getElementById('kOrd').textContent=ov.totalOrders||0;
        document.getElementById('kAvg').textContent='${sym}'+Number(ov.avgOrder||0).toFixed(2);
        document.getElementById('kCli').textContent=ov.totalClients||0;

        pintarMargen(mg);
        respCache=resp; llenarSelResponsable(); pintarResponsable();
        infCache=inf; pintarInformes();
        planCache=plan; pintarPlan();
        if(!cCampos){ cCampos=campos; cPaneles=Array.isArray(paneles)?paneles:[]; llenarPaneles(); llenarAreas(areas); engancharConstructor(); cmpComparables=Array.isArray(comparables)?comparables:[]; engancharComparar(); }

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
