import { Hono } from 'hono';
import { safeError } from '../../../core/errors.js';
import { adminLayout, skeletonRows, can } from '../layout.js';
import { escHtml } from '../../../core/escape.js';   // ficha D: el índice se arma en el SERVIDOR
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
import { listarMedidasPropias, guardarMedidaPropia, borrarMedidaPropia, OPERACIONES, RANGOS, RANGO_POR_DEFECTO } from '../constructor-analitica.js';
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
  // FICHA D · PARTE 3 — quién puede tocar el informe de OTRO. Solo el dueño, y a propósito NO el
  // admin: `mandaAqui` (de arriba) es para ver cifras de todos, no para borrarle el trabajo a nadie.
  const esDuenyo = c => c.get('session')?.role === 'owner';

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

  // FICHA D-ter — las medidas PROPIAS del usuario, que entran en «quiero saber» como una más.
  const propiasDe = c => { try { return listarMedidasPropias(db, c.get('session')?.userId); } catch { return []; } };
  api.get('/constructor/medidas', requirePerm('analytics.read'), c => {
    try { return c.json({ medidas: propiasDe(c), operaciones: Object.entries(OPERACIONES).map(([v, o]) => ({ v, t: o.etiqueta })) }); }
    catch(e) { return c.json({error:safeError(e)}, e.status || 500); }
  });
  api.post('/constructor/medidas', requirePerm('analytics.read'), async c => {
    try {
      const d = await c.req.json();
      exigeArea(c, d.area);
      guardarMedidaPropia(db, c.get('session')?.userId, d);
      return c.json({ ok: true, medidas: propiasDe(c) });
    } catch(e) { return c.json({error:safeError(e)}, e.status || 500); }
  });
  api.delete('/constructor/medidas/:id', requirePerm('analytics.read'), c => {
    try { borrarMedidaPropia(db, c.get('session')?.userId, c.req.param('id'));
      return c.json({ ok: true, medidas: propiasDe(c) }); }
    catch(e) { return c.json({error:safeError(e)}, e.status || 500); }
  });

  api.get('/constructor/campos', requirePerm('analytics.read'), c => {
    try {
      const area = c.req.query('area') || 'ventas';
      exigeArea(c, area);
      return c.json(camposPara(permDe(c), area, modoDeEmpresa(db), propiasDe(c)));
    } catch(e) { return c.json({error:safeError(e)}, e.status || 500); }
  });

  api.post('/constructor/cruzar', requirePerm('analytics.read'), async c => {
    try {
      const d = await c.req.json();
      exigeArea(c, d.area);   // el área base; los campos los revalida cruzar()
      return c.json(cruzar(db, { ...d, propias: propiasDe(c), hasPerm: permDe(c) }));
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

  // FICHA D · PARTE 3 — el mismo POST sirve para CREAR y para GUARDAR CAMBIOS: si el cuerpo trae `id`,
  // se actualiza ese informe en vez de nacer otro. Hasta hoy el front nunca mandaba `id`, así que cada
  // «Guardar» dejaba un duplicado y no había forma de corregir un nombre. El renombrar y el
  // compartir/descompartir pasan por aquí también: son el mismo campo del mismo registro.
  api.post('/constructor/paneles', requirePerm('analytics.read'), async c => {
    try {
      const d = await c.req.json();
      // Comparar no tiene un área única; solo se exige el área cuando el panel es de dimensión.
      if (d.config?.modo !== 'comparar') exigeArea(c, d.config?.area);
      const r = guardarPanel(db, c.get('session')?.userId, d, esDuenyo(c));
      return c.json({ ...r, paneles: listarPaneles(db, c.get('session')?.userId) });
    } catch(e) { return c.json({error:safeError(e)}, e.status || 500); }
  });

  // Este endpoint existía desde el paso 4b y NO LO LLAMABA NADIE: se podía guardar un informe y no
  // había forma de borrarlo desde la pantalla. La ficha D lo engancha. Borra la RECETA, nunca un dato
  // del negocio — la confirmación de la pantalla lo dice con esas palabras.
  api.delete('/constructor/paneles/:id', requirePerm('analytics.read'), c => {
    try {
      borrarPanel(db, c.get('session')?.userId, c.req.param('id'), esDuenyo(c));
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
    // ── FICHA D · PARTE 2 — ESTA PANTALLA ES UN ÍNDICE, NO UN MURO ─────────────────────────────
    // Palabras del dueño: «que el cliente pueda elaborar informes según su requerimiento y no
    // mostrar una serie de datos donde él mismo se pierde». Antes se abría con 4 indicadores y NUEVE
    // tarjetas dibujándose de golpe, y el constructor —lo que él pidió— era la cuarta, enterrada.
    // Ahora al abrir NO SE DIBUJA NI UN GRÁFICO: primero crear, luego los tuyos, luego la lista.
    //
    // NO SE HA PERDIDO NI UN INFORME: las ocho tarjetas que no eran el constructor son las ocho
    // entradas de `INFORMES`, con el MISMO cuerpo y la MISMA consulta. Cambian de sitio, no de
    // contenido. Y la de «Informes por área» sigue llevando dentro sus tres pestañas con sus diez
    // informes, que tampoco se tocan.
    //
    // EL CANDADO DEL ÍNDICE es el permiso del ÁREA de cada informe: quien no puede ver compras no lee
    // «Compras» en la lista. Owner y admin lo ven todo (`can`). Ojo con lo que esto NO es: los
    // endpoints siguen exigiendo `analytics.read` como antes — filtran su CONTENIDO por área, que es
    // como estaban. Aquí se cierra la puerta de la lista, no se reescriben los permisos del producto.
    const INFORMES = [
      { clave: 'ventas-periodo', nombre: 'Ventas por período',   perm: 'invoices.read',
        linea: 'Cuánto has facturado día a día en la ventana que elijas.' },
      { clave: 'top-productos',  nombre: 'Productos más vendidos', perm: 'invoices.read',
        linea: 'Qué se vende más, por ingresos.' },
      { clave: 'rentabilidad',   nombre: 'Rentabilidad',          perm: 'invoices.read',
        linea: 'Qué queda después del coste, y sobre qué parte de la facturación se sabe.' },
      { clave: 'comparar',       nombre: 'Comparar áreas en el tiempo', perm: 'analytics.read',
        linea: 'Dos o más áreas sobre el mismo eje de tiempo: facturación contra gasto, por ejemplo.' },
      { clave: 'plan',           nombre: 'Plan financiero — objetivos vs. real', perm: 'invoices.read',
        linea: 'Lo que te propusiste contra lo que va saliendo.' },
      { clave: 'por-area',       nombre: 'Informes por área',     perm: 'analytics.read',
        linea: 'Los diez informes de siempre, en tres pestañas: ventas, compras y clientes.' },
      { clave: 'responsable',    nombre: 'Por responsable',       perm: 'invoices.read',
        linea: 'Qué ha facturado cada persona y cuántos clientes lleva.' },
      { clave: 'stock',          nombre: 'Informe de stock',      perm: 'inventory.read',
        linea: 'Qué tienes, cuánto vale y qué está por debajo del mínimo.' },
    ].filter(i => can(c, i.perm));

    // ── FICHA D-bis · PARTE 4 — SE EMPIEZA POR UNA PREGUNTA, NO POR UN LIENZO ────────────────
    // Cada tarjeta abre el constructor con la frase YA COMPLETADA y el gráfico dibujado; desde ahí se
    // retoca y se guarda como propio. Crear de cero sigue existiendo, pero deja de ser la puerta única.
    //
    // CADA PREGUNTA ES UNA RECETA QUE EL CONSTRUCTOR YA SABE RESOLVER. Ninguna se maquilla: se probaron
    // las doce del encargo contra el motor y TRES no se podían montar. Dos se arreglaron de raíz
    // (la dimensión «Cliente» que faltaba en el área de Clientes, y que el gráfico pinte varias
    // medidas); la duodécima —«¿qué productos se mueven y cuáles están PARADOS?»— se queda FUERA a
    // propósito y anotada en el TABLERO: el área de Inventario mide movimientos, así que un producto
    // parado no produce ninguna fila y no puede aparecer. Medido: 121 productos físicos, 76 con algún
    // movimiento → 45 invisibles. Enseñar solo los que se mueven y llamarlo «y cuáles están parados»
    // sería mentir en el título de la tarjeta.
    //
    // El candado es el del ÁREA: un negocio sin agenda no ve las de agenda, y un empleado sin compras
    // no ve las de gastos. Mismo `can()` que el resto del índice.
    const PREGUNTAS = [
      { g:'Ventas', t:'¿Cuánto he facturado este año, mes a mes?', perm:'invoices.read',
        r:{area:'ventas',dimension:'fecha',periodo:'mes',medidas:['base'],grafico:'lineas'} },
      { g:'Ventas', t:'¿Qué clientes me dan más dinero?', perm:'invoices.read',
        r:{area:'ventas',dimension:'cliente',periodo:'mes',medidas:['base'],grafico:'barras'} },
      { g:'Ventas', t:'¿Qué clientes me dan más margen?', perm:'invoices.read',
        r:{area:'ventas',dimension:'cliente',periodo:'mes',medidas:['beneficio'],grafico:'barras'} },
      { g:'Ventas', t:'¿Qué vendo más y qué vendo menos?', perm:'invoices.read',
        r:{area:'ventas',dimension:'producto',periodo:'mes',medidas:['unidades'],grafico:'barras'} },
      { g:'Cobros y clientes', t:'¿Quién me debe dinero?', perm:'clients.read',
        r:{area:'clientes',dimension:'cliente',periodo:'mes',medidas:['deuda'],grafico:'barras'} },
      { g:'Cobros y clientes', t:'¿De dónde vienen mis clientes?', perm:'clients.read',
        r:{area:'clientes',dimension:'provincia',periodo:'mes',medidas:['clientes'],grafico:'tarta'} },
      { g:'Gastos', t:'¿En qué me gasto el dinero?', perm:'purchases.read',
        r:{area:'compras',dimension:'categoria',periodo:'mes',medidas:['base'],grafico:'tarta'} },
      { g:'Gastos', t:'¿A qué proveedores les compro más?', perm:'purchases.read',
        r:{area:'compras',dimension:'proveedor',periodo:'mes',medidas:['base'],grafico:'barras'} },
      { g:'Agenda', t:'¿Qué servicios me llenan más la agenda?', perm:'citas.read',
        r:{area:'agenda',dimension:'servicio',periodo:'mes',medidas:['horas_reservadas'],grafico:'barras'} },
      { g:'Agenda', t:'¿Cuántas horas trabajo de verdad frente a las que tengo abiertas?', perm:'citas.read',
        r:{area:'agenda',dimension:'fecha',periodo:'mes',medidas:['horas_ocupadas','horas_abiertas'],grafico:'lineas'} },
      { g:'Agenda', t:'¿Cuántas citas se me caen?', perm:'citas.read',
        r:{area:'agenda',dimension:'estado',periodo:'mes',medidas:['citas'],grafico:'tarta'} },
    ].filter(p => can(c, p.perm));

    const preguntasHtml = PREGUNTAS.map((p, i) =>
      '<button type="button" data-preg="' + i + '">'
      + '<span class="pg-a">' + escHtml(p.g) + '</span>' + escHtml(p.t) + '</button>').join('');

    const indiceHtml = INFORMES.map(i =>
      '<button type="button" class="inf-fila" data-inf="' + i.clave + '">'
      + '<span class="inf-n">' + escHtml(i.nombre) + '</span>'
      + '<span class="inf-l">' + escHtml(i.linea) + '</span>'
      + '<span class="inf-v" aria-hidden="true">›</span></button>').join('');

    const content = `
      <div class="ph"><h2>Analítica</h2></div>

      <style>
        /* FICHA D-bis — ESTABA AL REVES EN PANTALLA: el nombre pegado a la derecha y la flechita
           arriba a la izquierda. El motivo: .inf-v llevaba grid-row pero NO grid-column, asi que la
           colocacion automatica lo metia el primero, en la columna 1, y empujaba el nombre a la 2.
           Se arregla diciendole SU columna a cada pieza, que es lo que faltaba. Solo se via mirando
           la captura: ninguna asercion del gate lo habria notado nunca. */
        .inf-fila{display:grid;grid-template-columns:1fr auto;grid-template-rows:auto auto;
          gap:.1rem .8rem;width:100%;text-align:left;
          background:none;border:0;border-bottom:1px solid var(--border);padding:.7rem .2rem;cursor:pointer}
        .inf-fila:last-child{border-bottom:0}
        .inf-fila:hover{background:var(--accent-soft)}
        .inf-fila .inf-n{grid-column:1;grid-row:1;font-weight:600;color:var(--text);text-align:left}
        .inf-fila .inf-l{grid-column:1;grid-row:2;font-size:.75rem;color:var(--muted);text-align:left}
        .inf-fila .inf-v{grid-column:2;grid-row:1 / span 2;align-self:center;color:var(--muted);font-size:1.1rem;transition:transform .15s}
        .inf-fila[aria-expanded="true"] .inf-v{transform:rotate(90deg)}
        .frase{display:flex;flex-wrap:wrap;align-items:flex-start;gap:.45rem .55rem;font-size:1rem;line-height:2.3}
        .frase .fr-t{color:var(--text2);padding-top:.45rem}
        .frase .fr-c{display:inline-flex;flex-direction:column;gap:.1rem}
        .frase .fr-c select{width:auto;min-width:9rem;font-weight:600}
        .frase .fr-a{font-size:.68rem;color:var(--muted);line-height:1.2;font-weight:400;padding-left:.15rem}
        @media(max-width:760px){ .frase{line-height:1.9} .frase .fr-c select{min-width:100%} }
        .preg{display:grid;grid-template-columns:repeat(auto-fill,minmax(255px,1fr));gap:.6rem}
        .preg button{text-align:left;background:var(--bg2);border:1px solid var(--border2);border-radius:12px;
          padding:.75rem .85rem;cursor:pointer;font-size:.85rem;color:var(--text);line-height:1.35;transition:border-color .15s,background .15s}
        .preg button:hover{border-color:var(--accent);background:var(--accent-soft)}
        .preg .pg-a{display:block;font-size:.66rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:.25rem}
        .crear-caja{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap}
        .mis-inf{display:flex;align-items:center;justify-content:space-between;gap:.6rem;flex-wrap:wrap;
          border-bottom:1px solid var(--border);padding:.55rem .2rem}
        .mis-inf:last-child{border-bottom:0}
        .mis-inf .mi-acc{display:flex;gap:.35rem;flex-wrap:wrap}
      </style>

      ${PREGUNTAS.length ? `
      <div class="card" style="margin-bottom:1.5rem">
        <div class="card-head"><h3>Preguntas frecuentes</h3></div>
        <div class="card-body">
          <p style="font-size:.78rem;color:var(--muted);margin-bottom:.7rem">
            Pulsa una y te la contesto con tus datos. Luego puedes retocarla y guardarla como tuya.</p>
          <div class="preg">${preguntasHtml}</div>
        </div>
      </div>` : ''}

      <div class="card" style="margin-bottom:1.5rem">
        <div class="card-body crear-caja">
          <div>
            <div style="font-weight:700;font-size:1.02rem">¿No está la pregunta que buscas?</div>
            <div style="font-size:.78rem;color:var(--muted);margin-top:.15rem">
              Móntala tú: eliges de qué área, qué número quieres ver y cómo repartirlo. Se puede guardar, imprimir y mandar por correo.</div>
          </div>
          <button type="button" class="btn btn-primary" id="btnCrear" style="font-size:.95rem;padding:.6rem 1.1rem">Crear un informe</button>
        </div>
      </div>

      <div class="card" style="margin-bottom:1.5rem">
        <div class="card-head"><h3>Mis informes guardados</h3></div>
        <div class="card-body" id="misInformes">${skeletonRows(1)}</div>
      </div>

      <div class="card" style="margin-bottom:1.5rem">
        <div class="card-head"><h3>Informes disponibles</h3></div>
        <div class="card-body" style="padding-top:.2rem">
          ${indiceHtml || '<div style="color:var(--muted);font-size:.8rem">No tienes permiso para ninguno de los informes de fábrica. Puedes crear los tuyos con el botón de arriba.</div>'}
        </div>
      </div>

      <div class="card" id="inf-ventas-periodo" style="margin-bottom:1.5rem;display:none">
        <div class="card-head"><h3>Ventas por período</h3>
          <div style="display:flex;gap:.5rem">
            <select class="form-control" id="periodSel" style="width:auto;font-size:.8rem">
              <option value="7">Últimos 7 días</option>
              <option value="30" selected>Últimos 30 días</option>
              <option value="90">Últimos 90 días</option>
            </select>
          </div>
        </div>
        <div class="card-body" style="height:240px"><canvas id="salesChart"></canvas></div>
      </div>

      <div class="card" id="inf-top-productos" style="margin-bottom:1.5rem;display:none">
        <div class="card-head"><h3>Productos más vendidos</h3></div>
        <div class="card-body" style="height:240px"><canvas id="topChart"></canvas></div>
      </div>

      <div class="card" id="inf-rentabilidad" style="margin-bottom:1.5rem;display:none">
        <div class="card-head"><h3>Rentabilidad</h3>
          <div style="display:flex;gap:.5rem">
            <a href="/api/erp/analytics/export/margen" class="btn btn-secondary btn-sm">CSV Rentabilidad</a>
          </div>
        </div>
        <div class="card-body">
          <div class="bf-cards" id="mgRow" style="margin-bottom:0">
            <div class="bf-card inerte"><span class="bf-k">Beneficio</span><span class="bf-v gana" id="mBen">—</span></div>
            <div class="bf-card inerte"><span class="bf-k" id="mPctLbl">Margen</span><span class="bf-v" id="mPct">—</span></div>
            <div class="bf-card inerte"><span class="bf-k">Base del margen</span><span class="bf-v" id="mIng">—</span></div>
            <div class="bf-card inerte"><span class="bf-k">Coste</span><span class="bf-v" id="mCos">—</span></div>
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

      <div class="card" id="cardConstructor" style="margin-bottom:1.5rem;display:none">
        <div class="card-head"><h3>Tu informe</h3>
          <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
            <span id="cEditando" style="display:none;font-size:.75rem;color:var(--muted)"></span>
            <button type="button" class="btn btn-primary btn-sm" id="cGuardar" style="display:none">Guardar cambios</button>
            <button type="button" class="btn btn-secondary btn-sm" id="cGuardarNuevo">Guardar como nuevo</button>
          </div>
        </div>
        <div class="card-body">
          <!-- FICHA D-bis · PARTE 3 — LA FRASE. Antes eran cinco desplegables abiertos a la vez con 27
               opciones y ni una palabra que dijera para qué servía cada uno; «Mirar por» y «Medir» son
               lo mismo en la cabeza de un dueño. Ahora la pantalla se lee de corrido:
                 De [Ventas] quiero saber [cuánto he facturado], repartido por [cliente], [este año],
                 y verlo en [barras].
               Mismas opciones, mismo motor: cambia el orden, el envoltorio y las palabras. -->
          <div class="frase">
            <span class="fr-t">De</span>
            <span class="fr-c"><select class="form-control" id="cArea"></select>
              <span class="fr-a">el área del negocio</span></span>
            <span class="fr-t">quiero saber</span>
            <span class="fr-c"><select class="form-control" id="cMed"></select>
              <span class="fr-a" id="cMedAyuda">el número que quieres ver</span></span>
            <span class="fr-t">, repartido por</span>
            <span class="fr-c"><select class="form-control" id="cDim"></select>
              <span class="fr-a" id="cDimAyuda">en qué grupos quieres separar los datos</span></span>
            <span class="fr-t">,</span>
            <!-- FICHA D-ter · PARTE 2 — EL PERIODO, que no existía. Sin él los informes salían con
                 TODO el histórico: cuarenta barras a cero en Contabilidad y un grupo del año 2000
                 (el stock de apertura). Por defecto, los últimos 12 meses. Nunca el histórico. -->
            <span class="fr-c"><select class="form-control" id="cRango"></select>
              <span class="fr-a">de qué periodo</span></span>
            <span class="fr-c" id="cEntreWrap" style="display:none;flex-direction:row;gap:.35rem;align-items:flex-start">
              <input type="date" class="form-control" id="cDesde" style="width:auto">
              <input type="date" class="form-control" id="cHasta" style="width:auto"></span>
            <span class="fr-t" id="cPeriodoComa">,</span>
            <span class="fr-c" id="cPeriodoWrap"><select class="form-control" id="cPeriodo">
                <option value="mes">mes a mes</option><option value="trimestre">por trimestres</option><option value="anio">año por año</option>
              </select><span class="fr-a">el paso del tiempo</span></span>
            <span class="fr-t">, y verlo en</span>
            <span class="fr-c"><select class="form-control" id="cTipo">
                <option value="auto">lo que mejor se lea</option>
                <option value="numero">un número</option>
                <option value="tabla">una tabla</option>
                <option value="barras">barras</option>
                <option value="lineas">una línea</option>
                <option value="tarta">un quesito</option>
              </select><span class="fr-a">la forma del dibujo</span></span>
            <span class="fr-t">.</span>
          </div>

          <!-- FICHA D-ter · PARTE 1 — LA CAJA DE FÓRMULAS SE VA DE AQUÍ. Un dueño de negocio no
               escribe expresiones. Las cuentas que se piden a diario son ahora MEDIDAS CON NOMBRE
               dentro de «quiero saber» (ticket medio, margen en %, % de ocupación, % de ausencias,
               facturación media por cliente, % pendiente de pago, duración media de la cita…), ya
               calculadas. Y quien quiera la suya la construye ELIGIENDO de listas, ahí abajo, en
               «Mis medidas». Nunca se teclea una fórmula, y no queda un solo nombre interno. -->
          <div id="cMisMedidas" style="margin-top:.9rem;font-size:.78rem;color:var(--muted)"></div>

          <div id="cAviso" style="display:none;margin:.6rem 0"></div>
          <div id="cNota" style="display:none;font-size:.74rem;color:var(--muted);margin:.5rem 0"></div>
          <div id="cVacio" style="display:none;font-size:.82rem;color:var(--muted);margin:.6rem 0"></div>
          <div id="cNumeroWrap" style="display:none;text-align:center;padding:2.2rem 0">
            <div id="cNumero" style="font-size:3.2rem;font-weight:700;line-height:1.1;color:var(--text)">—</div>
            <div id="cNumeroPie" style="font-size:.85rem;color:var(--muted);margin-top:.5rem"></div>
          </div>
          <div id="cChartWrap" style="height:280px;margin-top:.75rem"><canvas id="cChart"></canvas></div>
          <div id="cTablaWrap" style="display:none;margin-top:.75rem"></div>
        </div>
      </div>

      <div class="card" id="inf-comparar" style="margin-bottom:1.5rem;display:none">
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

      <div class="card" id="inf-plan" style="margin-bottom:1.5rem;display:none">
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

      <div class="card" id="inf-por-area" style="margin-bottom:1.5rem;display:none">
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

      <div class="card" id="inf-responsable" style="margin-bottom:1.5rem;display:none">
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

      <div class="card" id="inf-stock" style="margin-bottom:1.5rem;display:none">
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
      // FICHA D · PARTE 3 — el DUEÑO puede renombrar, compartir y borrar el informe de cualquiera.
      // A propósito el admin NO: ver las cifras de todos no es poder borrarle el trabajo a nadie.
      // Esto solo pinta o esconde botones; quien decide de verdad es el servidor (esDuenyo).
      const PUEDE_TODO=${JSON.stringify(c.get('session')?.role === 'owner')};
      // Las recetas de las preguntas frecuentes, ya filtradas por permiso en el servidor.
      const PREGUNTAS=${JSON.stringify(PREGUNTAS.map(p => ({ t: p.t, r: p.r })))};
      // Medidas EXTRA de la receta actual: solo se llena cuando una pregunta pide más de una
      // («trabajadas frente a abiertas»). Al tocar cualquier desplegable se vacía, porque a partir
      // de ahí manda lo que el usuario ha elegido a mano.
      let medidasExtra=null, cAreasCache=null, cPropias=[];
      const RANGOS=${JSON.stringify(RANGOS)};
      const RANGO_DEF=${JSON.stringify(RANGO_POR_DEFECTO)};
      const TOPE_GRUPOS=12;   // más de doce barras con sus nombres encimados no se leen
      const TEXTO_VACIO='Todavía no hay datos para responder a esto. En cuanto los haya, el gráfico se llena solo.';

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
      // FICHA D-bis — ERAN CINCO VENTANITAS SEGUIDAS pidiendo palabras clave escritas a mano
      // («facturacion o beneficio», «mes, trimestre o anio», el numero de usuario del responsable).
      // Cinco dialogos encadenados es la peor version de la averia que arregla esta entrega: basta
      // que el navegador silencie el segundo para que los tres siguientes no salgan y el objetivo se
      // pierda sin decir nada. Ahora es UN formulario, con listas en vez de palabras que adivinar.
      async function nuevaMeta(){
        const hoy=new Date();
        const ejemplos={mes:hoy.getFullYear()+'-'+String(hoy.getMonth()+1).padStart(2,'0'),
                        trimestre:hoy.getFullYear()+'-T'+(Math.floor(hoy.getMonth()/3)+1),
                        anio:String(hoy.getFullYear())};
        const personas=(respCache&&Array.isArray(respCache.ventas))?respCache.ventas:[];
        const v=await window.pedirDatos({
          titulo:'Ponerte un objetivo',
          texto:'Escribe la meta y la pantalla te dira, cada vez que la abras, cuanto llevas frente a ella.',
          campos:[
            {id:'tipo',tipo:'lista',etiqueta:'¿Objetivo de qué?',valor:'facturacion',
             opciones:[{v:'facturacion',t:'Lo facturado (sin IVA)'},{v:'beneficio',t:'El beneficio'}]},
            {id:'periodo',tipo:'lista',etiqueta:'¿Cada cuánto?',valor:'mes',
             opciones:[{v:'mes',t:'Por mes'},{v:'trimestre',t:'Por trimestre'},{v:'anio',t:'Por año'}]},
            {id:'clave',tipo:'texto',etiqueta:'¿Cuál en concreto?',valor:ejemplos.mes,
             ayuda:'Por mes se escribe 2026-07 · por trimestre 2026-T3 · por año 2026'},
            {id:'valor',tipo:'numero',etiqueta:'¿Cuánto, sin IVA?',valor:'',
             ayuda:'Pon 0 para quitar un objetivo que ya tengas.'},
            {id:'quien',tipo:'lista',etiqueta:'¿De quién?',valor:'',
             opciones:[{v:'',t:'De todo el negocio'}].concat(personas.filter(x=>x.user_id).map(x=>({v:String(x.user_id),t:x.responsable})))},
          ],
          aceptar:'Guardar el objetivo',
          validar:(d)=>{
            if(!String(d.clave||'').trim()) return {campo:'clave',mensaje:'Escribe a qué periodo se refiere. Por ejemplo '+ejemplos[d.periodo]+'.'};
            if(String(d.valor||'').trim()==='') return {campo:'valor',mensaje:'Escribe cuánto. Pon 0 si quieres quitar el objetivo.'};
            if(isNaN(Number(d.valor))) return {campo:'valor',mensaje:'Eso no es una cantidad. Escribe solo números.'};
            return null;
          },
          alAceptar:async(d)=>{
            const body={tipo:d.tipo,periodo:d.periodo,clave:String(d.clave).trim(),
              alcance:d.quien?'responsable':'global',user_id:d.quien?Number(d.quien):null,valor:Number(d.valor)};
            const r=await api('POST','/api/erp/analytics/plan',body);
            planCache={...planCache,filas:r.filas}; pintarPlan();
          },
        });
        if(v) toast('Objetivo guardado');
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
        cAreasCache=areas||{};
        const sel=document.getElementById('cArea');
        const ks=Object.keys(areas||{});
        sel.innerHTML=ks.map(k=>'<option value="'+k+'">'+escHtml(areas[k].etiqueta)+'</option>').join('');
        if(!ks.length){ document.getElementById('cChartWrap').innerHTML='<div style="color:var(--muted);padding:1rem 0">No tienes acceso a ninguna área para construir gráficos.</div>'; }
      }
      function rellenarCampos(){
        if(!cCampos||cCampos.error){ return; }
        document.getElementById('cDim').innerHTML=Object.entries(cCampos.dimensiones).map(([k,v])=>'<option value="'+k+'">'+escHtml(v.etiqueta)+'</option>').join('');
        rellenarMedidas();
      }
      // FICHA D · PARTE 1 — LAS MEDIDAS DEPENDEN DE POR DÓNDE SE AGRUPE. Una medida marcada soloCon
      // (las de capacidad del área de Agenda: horas abiertas, ocupadas del horario, libres y % de
      // ocupación) solo es cierta agrupando por fecha o por persona: una hora libre no tiene cliente
      // ni servicio. Fuera de ahí se quita del desplegable en vez de ofrecer un número que no existe.
      // Esto es cortesía; el candado está en el servidor, que responde 400 y explica por qué.
      function rellenarMedidas(){
        if(!cCampos||!cCampos.medidas) return;
        const dim=document.getElementById('cDim').value;
        const sel=document.getElementById('cMed'), antes=sel.value;
        // Fuera las de capacidad donde no valen, y fuera las que no dicen nada en esta dimension.
        const validas=Object.entries(cCampos.medidas).filter(([,v])=>
          (!v.soloCon||v.soloCon.includes(dim)) && !(v.nuncaCon&&v.nuncaCon.includes(dim)));
        sel.innerHTML=validas.map(([k,v])=>'<option value="'+k+'">'+escHtml(v.etiqueta)+'</option>').join('');
        // Si la que estaba elegida ya no vale, se cae a la primera y se dice por qué.
        if(validas.some(([k])=>k===antes)) sel.value=antes;
        refrescarAyudas();
        if(validas.some(([k])=>k===antes)) { /* seguía valiendo */ }
        else if(antes&&cCampos.medidas[antes]&&cCampos.medidas[antes].nuncaCon&&cCampos.medidas[antes].nuncaCon.includes(dim)){
          const et=(cCampos.dimensiones[dim]||{}).etiqueta||dim;
          toast('«'+cCampos.medidas[antes].etiqueta+'» repartido por '+String(et).toLowerCase()+' daría un 1 en cada grupo: no dice nada.');
        }
        else if(antes&&cCampos.medidas[antes]&&cCampos.medidas[antes].soloCon){
          const et=(cCampos.dimensiones[dim]||{}).etiqueta||dim;
          toast('«'+cCampos.medidas[antes].etiqueta+'» se mide sobre el horario, no sobre cada cita: no se puede repartir por '+String(et).toLowerCase()+'.');
        }
      }
      function engancharConstructor(){
        // Listeners UNA sola vez (los <select> conservan su listener aunque cambien sus <option>).
        for(const id of ['cPeriodo','cTipo']) document.getElementById(id).addEventListener('change',dibujar);
        document.getElementById('cMed').addEventListener('change',()=>{ refrescarAyudas(); dibujar(); });
        // La dimensión primero recalcula qué medidas valen (ver rellenarMedidas) y luego dibuja.
        document.getElementById('cDim').addEventListener('change',()=>{ rellenarMedidas(); dibujar(); });
        document.getElementById('cArea').addEventListener('change',async e=>{
          cArea=e.target.value;
          cCampos=await api('GET','/api/erp/analytics/constructor/campos?area='+cArea).catch(()=>null);
          rellenarCampos(); pintarMisMedidas(); dibujar();
        });
        document.getElementById('cGuardar').onclick=()=>guardarPanelUI(true);
        document.getElementById('cGuardarNuevo').onclick=()=>guardarPanelUI(false);
        // PASO 4b — cálculo propio: al marcarlo aparece el campo de fórmula y la lista de medidas
        // disponibles. Se redibuja al escribir (con una pausa para no llamar en cada tecla).
        // FICHA D-ter — la caja de formulas se fue de la pantalla; en su sitio, «Mis medidas».
        document.getElementById('cRango').addEventListener('change',()=>{
          document.getElementById('cEntreWrap').style.display = document.getElementById('cRango').value==='entre' ? 'inline-flex' : 'none';
          dibujar(); });
        for(const id of ['cDesde','cHasta']) document.getElementById(id).addEventListener('change',dibujar);
        // FICHA D · PARTE 2 — AQUÍ NO SE DIBUJA. Antes esto acababa en dibujar(), que lanzaba un
        // cruce nada más cargar la pantalla. El primer trazo lo hace abrirConstructor(), cuando
        // alguien pulsa «Crear un informe» o abre uno guardado.
        rellenarCampos(); llenarRangos(); pintarMisMedidas();
      }
      // ── FICHA D-ter · PARTE 1 — «MIS MEDIDAS» ────────────────────────────────────────────────
      // La capacidad de la caja de formulas no se pierde: cambia de forma. Aqui no se escribe una
      // expresion, se ELIGE de dos listas y una operacion, y se le pone nombre. A partir de ahi la
      // medida aparece como una mas en «quiero saber», ya calculada, y con su cuenta escrita en la
      // ayuda de debajo. El usuario no ve un nombre interno en ningun momento.
      let cOperaciones=[{v:'/',t:'dividido entre'},{v:'-',t:'menos'},{v:'+',t:'más'},{v:'*',t:'por'}];
      function pintarMisMedidas(){
        const cont=document.getElementById('cMisMedidas'); if(!cont) return;
        const mias=cPropias.filter(m=>m.area===cArea);
        const etq=k=>((cCampos&&cCampos.medidas)||{})[k]?cCampos.medidas[k].etiqueta:k;
        const op=v=>(cOperaciones.find(o=>o.v===v)||{}).t||v;
        cont.innerHTML='<div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap">'
          +'<strong style="color:var(--text2)">Mis medidas</strong>'
          +'<button type="button" class="btn btn-secondary btn-sm" id="cNuevaMedida">Crear una medida mía</button>'
          +'<span style="font-size:.72rem">una cuenta con dos de las cifras de arriba, con el nombre que le pongas</span></div>'
          +(mias.length?'<div style="margin-top:.5rem;display:flex;flex-direction:column;gap:.25rem">'+mias.map(m=>
             '<div style="display:flex;align-items:center;gap:.5rem"><span style="color:var(--text);font-weight:600">'+escHtml(m.nombre)+'</span>'
             +'<span>= '+escHtml(etq(m.medida_a))+' '+escHtml(op(m.op))+' '+escHtml(etq(m.medida_b))+(m.por_cien?' por cien':'')+'</span>'
             +'<button type="button" class="btn btn-danger btn-sm" data-medq="'+m.id+'">Quitar</button></div>').join('')+'</div>':'');
        document.getElementById('cNuevaMedida').onclick=nuevaMedidaPropia;
        cont.querySelectorAll('[data-medq]').forEach(b=>b.onclick=()=>quitarMedidaPropia(b.dataset.medq));
      }
      async function nuevaMedidaPropia(){
        if(!cCampos||!cCampos.medidas) return;
        // Solo se ofrecen las medidas del area que NO son de capacidad ni propias: combinar una
        // propia con otra propia encadenaria cuentas y el nombre dejaria de decir de donde sale.
        const opciones=Object.entries(cCampos.medidas).filter(([,m])=>!m.soloCon&&!m.propia)
          .map(([k,m])=>({v:k,t:m.etiqueta}));
        if(opciones.length<2){ toast('Esta área no tiene dos cifras que combinar','err'); return; }
        let hecho=false;
        await window.pedirDatos({
          titulo:'Crear una medida mía',
          texto:'Elige dos cifras y qué se hace con ellas. La cuenta la hago yo; tú le pones el nombre.',
          campos:[
            {id:'a',tipo:'lista',etiqueta:'Coge',valor:opciones[0].v,opciones},
            {id:'op',tipo:'lista',etiqueta:'y hazle',valor:'/',opciones:cOperaciones},
            {id:'b',tipo:'lista',etiqueta:'esto otro',valor:(opciones[1]||opciones[0]).v,opciones},
            {id:'por_cien',tipo:'casilla',etiqueta:'Enseñarlo como porcentaje',ayuda:'Multiplica el resultado por cien y le pone el signo %.'},
            {id:'nombre',tipo:'texto',etiqueta:'¿Cómo la llamas?',valor:'',marcador:'Margen sobre lo que cobro'},
          ],
          aceptar:'Crear la medida',
          validar:(d)=>String(d.nombre||'').trim()?null:{campo:'nombre',mensaje:'Ponle un nombre: es como la vas a encontrar en la lista.'},
          alAceptar:async(d)=>{
            const r=await api('POST','/api/erp/analytics/constructor/medidas',
              {area:cArea,nombre:String(d.nombre).trim(),medida_a:d.a,op:d.op,medida_b:d.b,por_cien:!!d.por_cien});
            cPropias=r.medidas; hecho=true;
          },
        });
        if(hecho){ cCampos=await api('GET','/api/erp/analytics/constructor/campos?area='+cArea).catch(()=>cCampos);
          rellenarCampos(); pintarMisMedidas(); toast('Medida creada: ya está en «quiero saber»'); }
      }
      async function quitarMedidaPropia(id){
        const m=cPropias.find(x=>String(x.id)===String(id)); if(!m) return;
        const si=await window.confirmarEnPagina({titulo:'¿Quitar «'+m.nombre+'»?',
          texto:'Deja de aparecer en «quiero saber». No se borra ningún dato del negocio.',
          aceptar:'Sí, quitarla', cancelar:'No, dejarla',
          alAceptar:async()=>{ const r=await api('DELETE','/api/erp/analytics/constructor/medidas/'+id); cPropias=r.medidas; }});
        if(si){ cCampos=await api('GET','/api/erp/analytics/constructor/campos?area='+cArea).catch(()=>cCampos);
          rellenarCampos(); pintarMisMedidas(); toast('Medida quitada'); }
      }

      function llenarRangos(){
        const sel=document.getElementById('cRango');
        if(sel.options.length) return;
        sel.innerHTML=Object.entries(RANGOS).map(([k,t])=>'<option value="'+k+'"'+(k===RANGO_DEF?' selected':'')+'>'+escHtml(t)+'</option>').join('');
      }
      // FICHA D-ter · PARTE 5 — LA AYUDA QUE MENTIA. Los textos de debajo de cada hueco se quedaban
      // congelados en la primera area: si mirabas Ventas y luego Compras, seguian describiendo Ventas.
      // Ahora se recalculan cada vez que cambia el area, la medida o el reparto.
      function refrescarAyudas(){
        if(!cCampos) return;
        const m=(cCampos.medidas||{})[document.getElementById('cMed').value]||{};
        const d=(cCampos.dimensiones||{})[document.getElementById('cDim').value]||{};
        document.getElementById('cMedAyuda').textContent = m.ayuda || 'el numero que quieres ver';
        document.getElementById('cDimAyuda').textContent = d.ayuda ||
          ('un grupo por cada '+String(d.etiqueta||'').toLowerCase()+', y su cifra al lado');
      }

      function recetaActual(){
        const rango=document.getElementById('cRango').value||RANGO_DEF;
        // FICHA D-bis — la receta puede llevar VARIAS medidas. El motor ya las devolvía todas; lo que
        // faltaba era que la pantalla las pintara. Lo necesita «¿cuántas horas trabajo frente a las
        // que tengo abiertas?», que lleva un «frente a» dentro y son dos líneas del mismo gráfico.
        const r={ area:cArea, dimension:document.getElementById('cDim').value, periodo:document.getElementById('cPeriodo').value,
                  medidas:(medidasExtra&&medidasExtra.length)?medidasExtra.slice():[document.getElementById('cMed').value],
                  grafico:document.getElementById('cTipo').value };
        r.rango=rango;
        if(rango==='entre'){ r.desde=document.getElementById('cDesde').value||null; r.hasta=document.getElementById('cHasta').value||null; }
        return r;
      }
      // De las palabras que ve el usuario a los nombres del motor. Se sustituye la etiqueta MÁS LARGA
      // primero, para que «Beneficio en euros» no se rompa por dentro al sustituir otra más corta.
      async function dibujar(){
        const r=recetaActual();
        // El "agrupado por" solo tiene sentido en la dimensión fecha Y en áreas que agrupan por tiempo
        // (ventas/compras/inventario; clientes no). Enseñarlo donde no hace nada sugeriría que hace algo.
        const conPeriodo = (r.dimension==='fecha' && cCampos && cCampos.usaPeriodo);
        document.getElementById('cPeriodoWrap').style.display = conPeriodo ? '' : 'none';
        document.getElementById('cPeriodoComa').style.display = conPeriodo ? '' : 'none';
        let d; try{ d=await api('POST','/api/erp/analytics/constructor/cruzar',r); }catch(e){ return; }
        // Si hay fórmula, lo que se pinta es el CÁLCULO (una medida derivada, número plano).
        const med=d.calculo?'calculo':r.medidas[0];
        const meta=d.calculo?{etiqueta:'Cálculo: '+(r.formula||''),dinero:false}:((cCampos.medidas||{})[med]||{});
        // Las medidas que hay que pintar. Con fórmula, una (el cálculo). Sin ella, TODAS las que pida
        // la receta — normalmente una, dos cuando la pregunta compara («trabajadas frente a abiertas»).
        const series=d.calculo?['calculo']:(r.medidas||[med]);
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

        // FICHA D-ter · PARTE 3 — LA FORMA, DECIDIDA POR EL RESULTADO. El usuario puede elegirla
        // siempre; «lo que mejor se lea» es solo el arranque, y elige por el numero de grupos:
        // un solo valor -> el numero grande y solo · hasta 12 -> barras · mas de 12 -> tabla.
        let forma=r.grafico;
        if(forma==='auto') forma = d.filas.length<=1 ? 'numero' : (d.filas.length<=TOPE_GRUPOS ? 'barras' : 'tabla');
        const nota=document.getElementById('cNota');
        const trozos=[];
        if(d.rangoEtiqueta) trozos.push(d.rangoEtiqueta.toLowerCase());
        if(d.gruposVacios) trozos.push(d.gruposVacios+(d.gruposVacios===1?' grupo vacío no se pinta':' grupos vacíos no se pintan'));

        const wrapN=document.getElementById('cNumeroWrap');
        wrapN.style.display='none';
        if(forma==='numero'){
          // UN NÚMERO TAMBIÉN ES UN INFORME: la cifra grande y sola, con su periodo debajo.
          document.getElementById('cChartWrap').style.display='none';
          document.getElementById('cTablaWrap').style.display='none';
          wrapN.style.display='';
          const total=d.filas.reduce((n2,f)=>n2+(Number(f[med])||0),0);
          const uno=d.filas.length===1?d.filas[0][med]:total;
          document.getElementById('cNumero').textContent=d.filas.length?fmt(uno):'—';
          document.getElementById('cNumeroPie').textContent=
            (meta.etiqueta||'')+(d.rangoEtiqueta?' · '+d.rangoEtiqueta.toLowerCase():'')+(d.filas.length?'':' · '+TEXTO_VACIO);
          nota.style.display=trozos.length?'':'none'; nota.textContent=trozos.join(' · ');
          return;
        }
        nota.style.display=trozos.length?'':'none'; nota.textContent=trozos.join(' · ');
        if(forma==='tabla'){
          document.getElementById('cChartWrap').style.display='none';
          const w=document.getElementById('cTablaWrap'); w.style.display='';
          const cab=series.map(k=>'<th>'+escHtml(((cCampos.medidas||{})[k]||{}).etiqueta||(k==='calculo'?meta.etiqueta:k))+'</th>').join('');
          const fmtDe=k=>{const mm=k==='calculo'?meta:((cCampos.medidas||{})[k]||{});
            return v=>v==null?'—':(mm.dinero?eur(v):(mm.pct?pctEs(v):Number(v)));};
          w.innerHTML='<div class="table-wrap"><table><thead><tr><th>'+escHtml(d.dimensionEtiqueta)+'</th>'+cab+'</tr></thead><tbody>'+
            (d.filas.length?d.filas.map(f=>'<tr><td>'+escHtml(f.clave)+'</td>'+series.map(k=>'<td>'+fmtDe(k)(f[k])+'</td>').join('')+'</tr>').join('')
             :'<tr><td colspan="'+(series.length+1)+'" style="color:var(--muted)">'+escHtml(TEXTO_VACIO)+'</td></tr>')+'</tbody></table></div>';
          return;
        }
        document.getElementById('cTablaWrap').style.display='none';
        document.getElementById('cChartWrap').style.display='';
        if(cChartInst) cChartInst.destroy();
        const tipo=forma==='lineas'?'line':forma==='tarta'?'pie':'bar';
        // Los null (sin coste conocido) NO se pintan como 0: en un gráfico, un 0 es una afirmación
        // ("no ganó nada") y null es un hueco, que es la verdad.
        // UN DATASET POR MEDIDA. Con una serie sale exactamente igual que antes; con dos, dos líneas
        // en el mismo eje. La tarta no admite varias series: si la receta trae más de una, se pinta la
        // primera (y la tabla de debajo, en el modo tabla, sí las lleva todas).
        // FICHA D-ter · PARTE 4 — NADA ILEGIBLE. Sesenta barras con los nombres encimados no se leen.
        // Se pintan los DOCE MAYORES y el resto se suma en «Otros», con una linea que lo dice y un
        // enlace para verlo entero en tabla. La TABLA siempre las lleva todas: aqui no se pierde nada,
        // se deja de amontonar.
        let pintar=d.filas, recortados=0;
        if(d.filas.length>TOPE_GRUPOS && tipo!=='line'){
          const orden=[...d.filas].sort((a2,b2)=>(Number(b2[med])||0)-(Number(a2[med])||0));
          const cabeza=orden.slice(0,TOPE_GRUPOS), cola=orden.slice(TOPE_GRUPOS);
          recortados=cola.length;
          const otros={clave:'Otros ('+cola.length+')'};
          for(const k of series) otros[k]=cola.reduce((n2,f)=>n2+(Number(f[k])||0),0);
          pintar=cabeza.concat([otros]);
        }
        if(recortados){
          nota.style.display='';
          nota.innerHTML=escHtml(trozos.concat(['se pintan los '+TOPE_GRUPOS+' mayores y los otros '+recortados+' van sumados en «Otros»']).join(' · '))
            +' — <a href="#" id="cVerTabla" style="color:var(--accent)">verlo todo en tabla</a>';
          setTimeout(()=>{ const a2=document.getElementById('cVerTabla'); if(a2) a2.onclick=(e2)=>{ e2.preventDefault();
            document.getElementById('cTipo').value='tabla'; dibujar(); }; },0);
        }
        const usa = tipo==='pie' ? series.slice(0,1) : series;
        const COL=['#0ea5e9','#f59e0b','#10b981','#8b5cf6','#ef4444','#14b8a6'];
        const etqDe=k=>((cCampos.medidas||{})[k]||{}).etiqueta||(k==='calculo'?meta.etiqueta:k);
        cChartInst=new Chart(document.getElementById('cChart').getContext('2d'),{
          type:tipo,
          data:{labels:pintar.map(f=>String(f.clave).substring(0,22)),
                datasets:usa.map((k,i)=>({label:etqDe(k),data:pintar.map(f=>f[k]),
                  backgroundColor:tipo==='pie'?PALETA:(COL[i%COL.length]+'99'),
                  borderColor:tipo==='pie'?'#0b1220':COL[i%COL.length],borderWidth:1,borderRadius:tipo==='bar'?4:0,
                  tension:tipo==='line'?.25:0,spanGaps:false}))},
          options:{responsive:true,maintainAspectRatio:false,
            plugins:{legend:{display:tipo==='pie'||usa.length>1},tooltip:{callbacks:{label:x=>' '+(x.dataset.label?x.dataset.label+': ':'')+fmt(x.parsed.y ?? x.parsed)}}},
            scales:tipo==='pie'?{}:{y:{beginAtZero:true,ticks:{callback:v=>meta.dinero?'${sym}'+v:(meta.pct?v+'%':v)}}}}
        });
        // Sin datos no se deja un lienzo mudo: se dice por qué está vacío.
        const avVacio=document.getElementById('cVacio');
        if(avVacio){ avVacio.style.display=d.filas.length?'none':''; avVacio.textContent=TEXTO_VACIO; }
      }
      // FICHA D · PARTE 3 — GUARDAR CAMBIOS vs GUARDAR COMO NUEVO. Antes solo existía lo segundo, y
      // encima disfrazado de lo primero: el botón decía «Guardar» y cada pulsación dejaba un
      // duplicado. Ahora «Guardar cambios» solo aparece cuando hay un informe abierto, y manda su id.
      async function guardarPanelUI(sobreEscribir){
        const abierto = sobreEscribir ? panelPorId(panelAbierto) : null;
        if (sobreEscribir && !abierto) { toast('No hay ningún informe abierto que actualizar','err'); return; }

        // GUARDAR CAMBIOS sobre uno abierto no pregunta nada: ya tiene nombre y ya sabe si se comparte.
        if (abierto) {
          try{
            const r=await api('POST','/api/erp/analytics/constructor/paneles',{id:abierto.id,nombre:abierto.nombre,config:recetaActual()});
            cPaneles=r.paneles; pintarMisInformes(); refrescarBotonesGuardar();
            lucirInforme(abierto.id,'Cambios guardados');
          }catch(e){ toast('No hemos podido guardar los cambios. Vuelve a intentarlo.','err'); }
          return;
        }

        // FICHA D-bis — AQUÍ ESTABA LA AVERÍA. Eran prompt() + confirm() encadenados, y en cuanto el
        // navegador silenciaba los diálogos (la casilla que Chrome ofrece en el SEGUNDO seguido) el
        // botón quedaba muerto: sin ventana, sin petición y sin una palabra. Ahora es UN panel dentro
        // de la página, con el nombre ya propuesto y la casilla de compartir a la vista.
        await window.pedirDatos({
          titulo:'Guardar este informe',
          campos:[
            {id:'nombre',tipo:'texto',etiqueta:'¿Cómo lo llamas?',valor:nombrePropuesto(),
             ayuda:'Es el nombre con el que lo verás en «Mis informes guardados».'},
            {id:'compartido',tipo:'casilla',etiqueta:'Compartirlo con el equipo',
             ayuda:'Verán el gráfico, pero cada uno con sus propios permisos: si no pueden ver un área, ese informe no se les abre.'},
          ],
          aceptar:'Guardar',
          validar:(d)=>{
            // NUNCA se cierra en silencio: si el nombre está vacío o son espacios, se dice AHÍ.
            if(!String(d.nombre||'').trim()) return {campo:'nombre',mensaje:'Ponle un nombre para poder encontrarlo después.'};
            return null;
          },
          alAceptar:async(d)=>{
            const r=await api('POST','/api/erp/analytics/constructor/paneles',
              {nombre:String(d.nombre).trim(), config:recetaActual(), compartido:!!d.compartido});
            cPaneles=r.paneles; panelAbierto=r.id;
            pintarMisInformes(); refrescarBotonesGuardar();
            ultimoGuardado=r.id;
          },
        });
        if(ultimoGuardado){ lucirInforme(ultimoGuardado,'Informe guardado'); ultimoGuardado=null; }
      }
      let ultimoGuardado=null;

      // Un nombre propuesto que se entiende: «Ventas por cliente · 2026». Sale de la propia receta,
      // así que el usuario lo acepta con Enter en el 90 % de los casos.
      function nombrePropuesto(){
        const a=(cAreasCache&&cAreasCache[cArea])?cAreasCache[cArea].etiqueta:cArea;
        const d=((cCampos&&cCampos.dimensiones)||{})[document.getElementById('cDim').value];
        const dim=d?String(d.etiqueta).toLowerCase():'';
        return a+(dim?' por '+dim:'')+' · '+new Date().getFullYear();
      }

      // FICHA D-bis · PARTE 2 — LA PRUEBA DE QUE HA GUARDADO ES EL INFORME EN LA LISTA, no un
      // mensajito de tres segundos en una esquina. Se sube hasta «Mis informes guardados» y se
      // resalta el recién guardado un par de segundos.
      function lucirInforme(id,aviso){
        const cont=document.getElementById('misInformes');
        if(cont){
          const card=cont.closest('.card')||cont;
          card.scrollIntoView({behavior:'smooth',block:'center'});
          const fila=cont.querySelector('[data-fila="'+id+'"]');
          if(fila){
            fila.style.transition='background-color .4s';
            fila.style.backgroundColor='var(--accent-soft)';
            setTimeout(()=>{ fila.style.backgroundColor=''; },2200);
          }
        }
        if(aviso) toast(aviso);
      }

      // Compatibilidad: el desplegable de paneles desapareció (los informes guardados viven ahora en
      // su propia tarjeta), pero varias funciones lo llamaban. Se deja como no-op con su motivo.
      function llenarPaneles(){ /* ficha D: la lista la pinta pintarMisInformes */ }

      function refrescarBotonesGuardar(){
        const p = panelPorId(panelAbierto);
        const bg = document.getElementById('cGuardar'), et = document.getElementById('cEditando');
        if (!bg || !et) return;
        bg.style.display = p ? '' : 'none';
        et.style.display = p ? '' : 'none';
        et.textContent = p ? 'Editando: ' + p.nombre : '';
      }

      // Carga un informe guardado EN el constructor. Se re-CRUZA, no se pinta lo guardado: un informe
      // guarda la receta, no los datos, así que los permisos se revalidan al abrirlo. Si guardara
      // resultados sería una fuga con fecha.
      async function cargarPanelEn(id){
        const p=panelPorId(id); if(!p||!p.config) return;
        panelAbierto=p.id;
        cArea=p.config.area||'ventas';
        document.getElementById('cArea').value=cArea;
        cCampos=await api('GET','/api/erp/analytics/constructor/campos?area='+cArea).catch(()=>cCampos);
        rellenarCampos();
        document.getElementById('cDim').value=p.config.dimension;
        document.getElementById('cPeriodo').value=p.config.periodo||'mes';
        document.getElementById('cRango').value=p.config.rango||RANGO_DEF;
        document.getElementById('cEntreWrap').style.display=p.config.rango==='entre'?'inline-flex':'none';
        if(p.config.desde) document.getElementById('cDesde').value=p.config.desde;
        if(p.config.hasta) document.getElementById('cHasta').value=p.config.hasta;
        // La medida puede ser de capacidad: hay que rellenar el desplegable ANTES de elegirla.
        rellenarMedidas();
        document.getElementById('cMed').value=(p.config.medidas||[Object.keys(cCampos.medidas)[0]])[0];
        document.getElementById('cTipo').value=p.config.grafico||'barras';
        refrescarBotonesGuardar();
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

      // ── FICHA D · PARTE 2 — CARGA PEREZOSA ──────────────────────────────────────────────────
      // Antes esto era un Promise.all de DOCE peticiones al abrir la pantalla, y pintaba los nueve
      // paneles quisiera uno verlos o no. Ahora al abrir se piden DOS cosas: la lista de informes
      // guardados y el catálogo del constructor (que es lo que hace falta para el botón «Crear»).
      // Cada informe de fábrica se carga la PRIMERA vez que se pulsa su fila, y no se vuelve a pedir.
      const YA = {};
      const dias = () => (document.getElementById('periodSel') || {}).value || '30';

      async function cargarInforme(clave){
        if (YA[clave]) return; YA[clave] = true;
        try{
          if(clave==='ventas-periodo'){
            const period=await api('GET','/api/erp/analytics/sales-by-period?days='+dias()).catch(()=>[]);
            if(salesChartInst)salesChartInst.destroy();
            salesChartInst=new Chart(document.getElementById('salesChart').getContext('2d'),{type:'bar',data:{labels:period.map(d=>d.date),datasets:[{label:'${sym}',data:period.map(d=>d.total),backgroundColor:'rgba(16,185,129,.6)',borderColor:'#10b981',borderWidth:1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{callback:v=>'${sym}'+v}}}}});
            document.getElementById('periodSel').onchange=async()=>{ YA['ventas-periodo']=false; await cargarInforme('ventas-periodo'); };
          }
          else if(clave==='top-productos'){
            const top=await api('GET','/api/erp/analytics/best-sellers?limit=8').catch(()=>[]);
            if(topChartInst)topChartInst.destroy();
            topChartInst=new Chart(document.getElementById('topChart').getContext('2d'),{type:'bar',data:{labels:top.map(p=>p.product_name.substring(0,15)),datasets:[{label:'Ingresos',data:top.map(p=>p.total_val),backgroundColor:'rgba(14,165,233,.6)',borderColor:'#0ea5e9',borderWidth:1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{beginAtZero:true,ticks:{callback:v=>'${sym}'+v}}}}});
          }
          else if(clave==='rentabilidad'){ pintarMargen(await api('GET','/api/erp/analytics/margen').catch(()=>null)); }
          else if(clave==='responsable'){ respCache=await api('GET','/api/erp/analytics/responsable').catch(()=>null); llenarSelResponsable(); pintarResponsable(); }
          else if(clave==='por-area'){ infCache=await api('GET','/api/erp/analytics/informes').catch(()=>null); pintarInformes(); }
          else if(clave==='plan'){ planCache=await api('GET','/api/erp/analytics/plan').catch(()=>null); pintarPlan(); }
          else if(clave==='comparar'){
            cmpComparables=await api('GET','/api/erp/analytics/constructor/comparables').catch(()=>[]);
            if(!Array.isArray(cmpComparables)) cmpComparables=[];
            engancharComparar();
          }
          else if(clave==='stock'){ pintarStock(await api('GET','/api/erp/analytics/stock-report').catch(()=>[])); }
        }catch(e){ YA[clave]=false; }
      }

      function pintarStock(stock){
        document.getElementById('stockBody').innerHTML=stock.length?stock.map(p=>'<tr>'+
          '<td><strong>'+escHtml(p.name)+'</strong></td>'+
          '<td style="color:var(--muted)">'+escHtml(p.sku||'-')+'</td>'+
          '<td>'+escHtml(p.category||'-')+'</td>'+
          '<td><strong style="color:'+(p.stock<5?'var(--danger)':'inherit')+'">'+p.stock+'</strong></td>'+
          '<td>${sym}'+Number(p.price).toFixed(2)+'</td>'+
          '<td style="color:var(--ok);font-weight:600">${sym}'+Number(p.inventory_value||0).toFixed(2)+'</td>'+
          '</tr>').join(''):window.emptyRow(6,'No hay productos con stock que mostrar.');
      }

      // ── FICHA D · PARTE 3 — MIS INFORMES GUARDADOS, con todo lo que faltaba ──────────────────
      // Hasta hoy se podía guardar y NO se podía deshacer: ni borrar, ni renombrar, ni dejar de
      // compartir, y cada «Guardar» creaba un duplicado porque el front nunca mandaba el id.
      let panelAbierto = null;    // el informe que está cargado en el constructor (para «Guardar»)

      function pintarMisInformes(){
        const cont=document.getElementById('misInformes');
        if(!cPaneles.length){
          cont.innerHTML='<div style="color:var(--muted);font-size:.82rem">Aquí se guardan los informes que te montas: la receta, no los datos, '
            +'así que al abrirlos vuelven a calcularse con las cifras de hoy. Todavía no tienes ninguno.'
            +'</div><button type="button" class="btn btn-primary btn-sm" id="btnCrear2" style="margin-top:.7rem">Crear un informe</button>';
          document.getElementById('btnCrear2').onclick=abrirConstructor;
          return;
        }
        cont.innerHTML=cPaneles.map(p=>{
          const mio=p.propio;
          const acc=[
            '<button type="button" class="btn btn-secondary btn-sm" data-ab="'+p.id+'">Abrir</button>',
            '<a class="btn btn-secondary btn-sm" href="/admin/listados/panel/imprimir?panel_id='+p.id+'" target="_blank" rel="noopener">Imprimir</a>',
            '<button type="button" class="btn btn-secondary btn-sm" data-pdf="'+p.id+'">PDF</button>',
            '<button type="button" class="btn btn-secondary btn-sm" data-mail="'+p.id+'">Enviar</button>',
          ];
          // Renombrar, compartir y borrar solo el que lo creó (y el dueño, que lo resuelve el servidor).
          if(mio||PUEDE_TODO) acc.push('<button type="button" class="btn btn-secondary btn-sm" data-ren="'+p.id+'">Renombrar</button>');
          if(mio||PUEDE_TODO) acc.push('<button type="button" class="btn btn-secondary btn-sm" data-comp="'+p.id+'">'+(p.compartido?'Dejar de compartir':'Compartir')+'</button>');
          if(mio||PUEDE_TODO) acc.push('<button type="button" class="btn btn-danger btn-sm" data-del="'+p.id+'">Borrar</button>');
          return '<div class="mis-inf" data-fila="'+p.id+'"><div><div style="font-weight:600">'+escHtml(p.nombre)+'</div>'
            +'<div style="font-size:.72rem;color:var(--muted)">'
            +(mio?(p.compartido?'Tuyo · compartido con el equipo':'Tuyo'):'Compartido por '+escHtml(p.autor||'alguien'))
            +'</div></div><div class="mi-acc">'+acc.join('')+'</div></div>';
        }).join('');
        cont.querySelectorAll('[data-ab]').forEach(b=>b.onclick=()=>{ abrirConstructor(); cargarPanelEn(b.dataset.ab); });
        cont.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>borrarInforme(b.dataset.del));
        cont.querySelectorAll('[data-ren]').forEach(b=>b.onclick=()=>renombrarInforme(b.dataset.ren));
        cont.querySelectorAll('[data-comp]').forEach(b=>b.onclick=()=>alternarCompartir(b.dataset.comp));
        cont.querySelectorAll('[data-pdf]').forEach(b=>b.onclick=()=>bajarPdf(b.dataset.pdf));
        cont.querySelectorAll('[data-mail]').forEach(b=>b.onclick=()=>enviarInforme(b.dataset.mail));
      }

      const panelPorId=id=>cPaneles.find(x=>String(x.id)===String(id));

      async function borrarInforme(id){
        const p=panelPorId(id); if(!p) return;
        // La confirmación dice EXACTAMENTE qué se borra. Un dueño que lee «borrar informe» puede
        // entender que se lleva las facturas por delante; hay que quitarle esa duda con palabras.
        const si=await window.confirmarEnPagina({
          titulo:'¿Borrar «'+p.nombre+'»?',
          texto:'Se borra solo la receta: qué mides y cómo lo agrupas. No se borra ningún dato del negocio — ni una factura, ni una cita, ni un cliente.',
          aceptar:'Sí, borrar el informe', cancelar:'No, dejarlo',
          alAceptar:async()=>{
            const r=await api('DELETE','/api/erp/analytics/constructor/paneles/'+id);
            cPaneles=r.paneles; pintarMisInformes();
            if(String(panelAbierto)===String(id)) panelAbierto=null; refrescarBotonesGuardar();
          },
        });
        if(si) toast('Informe borrado');
      }

      async function renombrarInforme(id){
        const p=panelPorId(id); if(!p) return;
        await window.pedirDatos({
          titulo:'Cambiar el nombre',
          campos:[{id:'nombre',tipo:'texto',etiqueta:'¿Cómo quieres que se llame?',valor:p.nombre}],
          aceptar:'Cambiar el nombre',
          validar:(d)=>String(d.nombre||'').trim()?null:{campo:'nombre',mensaje:'No puede quedarse sin nombre.'},
          alAceptar:async(d)=>{
            const r=await api('POST','/api/erp/analytics/constructor/paneles',{id:p.id,nombre:String(d.nombre).trim(),config:p.config});
            cPaneles=r.paneles; pintarMisInformes();
          },
        });
        lucirInforme(p.id,'Nombre cambiado');
      }

      async function alternarCompartir(id){
        const p=panelPorId(id); if(!p) return;
        const si=await window.confirmarEnPagina({
          titulo: p.compartido ? '¿Dejar de compartir «'+p.nombre+'»?' : '¿Compartir «'+p.nombre+'» con el equipo?',
          texto: p.compartido
            ? 'Quien no lo creó dejará de verlo en su lista. Tú lo conservas.'
            : 'Verán el gráfico, pero cada uno con SUS permisos: si no pueden ver un área, ese informe no se les abre.',
          aceptar: p.compartido ? 'Sí, dejar de compartir' : 'Sí, compartir', cancelar:'No, dejarlo',
          alAceptar:async()=>{
            const r=await api('POST','/api/erp/analytics/constructor/paneles',
              {id:p.id,nombre:p.nombre,config:p.config,compartido:!p.compartido});
            cPaneles=r.paneles; pintarMisInformes();
          },
        });
        if(si) lucirInforme(p.id, p.compartido?'Ya no se comparte':'Compartido con el equipo');
      }

      // ── FICHA D · PARTE 4 — LOS TRES VERBOS, por el motor único de la ficha C ────────────────
      // Ni una línea de HTML de informe aquí: se llama a /admin/listados/panel/{imprimir,pdf} y a
      // /api/erp/listados/panel/enviar, que son las MISMAS tres rutas de los quince listados.
      async function bajarPdf(id){
        const url='/admin/listados/panel/pdf?panel_id='+id;
        try{
          const r=await fetch(url,{credentials:'same-origin'});
          // El motor avisa (409) cuando el papel va a salir muy largo. Se pregunta y se sigue, igual
          // que en los otros listados: nunca se recorta una fila en silencio.
          if(r.status===409){ const a=await r.json();
            const si=await window.confirmarEnPagina({ titulo:'Este papel va a salir largo',
              texto:a.mensaje, aceptar:'Sí, bajarlo entero', cancelar:'No, dejarlo' });
            if(!si) return;
            window.open(a.seguir,'_blank','noopener'); return; }
          if(!r.ok){ const e=await r.json().catch(()=>({})); toast(e.error||'No hemos podido preparar el PDF','err'); return; }
          const b=await r.blob(), a=document.createElement('a');
          a.href=URL.createObjectURL(b); a.download='informe.pdf'; document.body.appendChild(a); a.click();
          setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },1500);
        }catch(e){ toast('No hemos podido preparar el PDF','err'); }
      }

      async function enviarInforme(id){
        const p=panelPorId(id); if(!p) return;
        let enviado=null;
        await window.pedirDatos({
          titulo:'Enviar «'+p.nombre+'» por correo',
          texto:'Va como PDF adjunto, con el gráfico y la tabla de datos.',
          campos:[{id:'to',tipo:'texto',etiqueta:'¿A qué correo?',valor:'',marcador:'nombre@ejemplo.com'}],
          aceptar:'Enviar',
          validar:(d)=>{
            const t=String(d.to||'').trim();
            if(!t) return {campo:'to',mensaje:'Escribe a quién se lo mandas.'};
            if(!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(t)) return {campo:'to',mensaje:'Ese correo no tiene buena pinta. Revísalo.'};
            return null;
          },
          alAceptar:async(d)=>{
            const r=await api('POST','/api/erp/listados/panel/enviar?panel_id='+id,{to:String(d.to).trim()});
            enviado=r.to;
          },
        });
        if(enviado) toast('Enviado a '+enviado);
      }

      // ── EL ÍNDICE ────────────────────────────────────────────────────────────────────────────
      let constructorDibujado=false;
      function abrirConstructor(){
        const card=document.getElementById('cardConstructor');
        card.style.display='';
        if(!constructorDibujado){ constructorDibujado=true; dibujar(); }
        card.scrollIntoView({behavior:'smooth',block:'start'});
      }

      // FICHA D-bis · PARTE 4 — abrir una pregunta = rellenar la frase y dibujar. No hay un segundo
      // camino de cálculo: se compone la MISMA receta que compondría el usuario a mano.
      async function abrirPregunta(i){
        const p=PREGUNTAS[i]; if(!p) return;
        panelAbierto=null;
        cArea=p.r.area;
        document.getElementById('cArea').value=cArea;
        cCampos=await api('GET','/api/erp/analytics/constructor/campos?area='+cArea).catch(()=>cCampos);
        rellenarCampos();
        document.getElementById('cDim').value=p.r.dimension;
        rellenarMedidas();
        document.getElementById('cMed').value=p.r.medidas[0];
        document.getElementById('cPeriodo').value=p.r.periodo||'mes';
        document.getElementById('cTipo').value=p.r.grafico||'barras';
        document.getElementById('cRango').value=p.r.rango||RANGO_DEF;
        document.getElementById('cEntreWrap').style.display='none';
        // Si la pregunta compara dos números, se llevan los dos al gráfico.
        medidasExtra = p.r.medidas.length>1 ? p.r.medidas.slice() : null;
        refrescarBotonesGuardar();
        const card=document.getElementById('cardConstructor');
        card.style.display=''; constructorDibujado=true;
        dibujar();
        card.scrollIntoView({behavior:'smooth',block:'start'});
      }

      function engancharIndice(){
        document.getElementById('btnCrear').onclick=abrirConstructor;
        document.querySelectorAll('[data-preg]').forEach(b=>b.onclick=()=>abrirPregunta(Number(b.dataset.preg)));
        // En cuanto el usuario toca la frase a mano, deja de mandar la pregunta.
        for(const id of ['cArea','cDim','cMed','cTipo','cPeriodo'])
          document.getElementById(id).addEventListener('change',()=>{ medidasExtra=null; });
        document.querySelectorAll('.inf-fila').forEach(b=>{
          b.setAttribute('aria-expanded','false');
          b.onclick=async()=>{
            const card=document.getElementById('inf-'+b.dataset.inf); if(!card) return;
            const abierto=card.style.display!=='none';
            card.style.display=abierto?'none':'';
            b.setAttribute('aria-expanded',abierto?'false':'true');
            if(!abierto){ await cargarInforme(b.dataset.inf); card.scrollIntoView({behavior:'smooth',block:'nearest'}); }
          };
        });
      }

      async function arranque(){
        // SOLO DOS PETICIONES AL ABRIR. Ni un gráfico se dibuja hasta que se pulsa algo.
        const [campos,paneles,areas]=await Promise.all([
          api('GET','/api/erp/analytics/constructor/campos').catch(()=>null),
          api('GET','/api/erp/analytics/constructor/paneles').catch(()=>[]),
          api('GET','/api/erp/analytics/constructor/areas').catch(()=>({}))
        ]);
        cCampos=campos; cPaneles=Array.isArray(paneles)?paneles:[];
        try{ const mm=await api('GET','/api/erp/analytics/constructor/medidas');
          cPropias=mm.medidas||[]; if(Array.isArray(mm.operaciones)&&mm.operaciones.length) cOperaciones=mm.operaciones; }catch(e){}
        llenarPaneles(); llenarAreas(areas); engancharConstructor();
        pintarMisInformes(); engancharIndice(); refrescarBotonesGuardar();
      }
      window.addEventListener('DOMContentLoaded',arranque);
      </script>`;
    return c.html(adminLayout('Analítica', content, 'analytics', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
