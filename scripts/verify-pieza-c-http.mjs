// Verificación — PIEZA C · una venta REAL por mostrador reflejada en los 4 lectores (servidor vivo).
//   node scripts/verify-pieza-c-http.mjs
// Contra el servidor en marcha (tenant desarrollo): emite un ticket de mostrador por el endpoint REAL
// (POST /api/erp/mostrador/sale) y comprueba que la venta aparece en (1) KPI del dashboard, (2) analítica
// (overview), (3) contexto/summary de DISA. Luego crea una factura CON cliente y comprueba (4) su historial.
// Después ANULA esa factura y verifica que deja de sumar. Por último (5) comprueba que el aviso "Pedidos
// bloqueados" de /summary se nutre de la cadena nueva (customer_orders) y apunta a /admin/pedidos.
// No retira el POS viejo; solo lee de la cadena nueva.
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { createInvoice, anularInvoice } from '../modules/erp/routes/invoices.js';
import { pedidosSinEntregar } from '../modules/erp/ventas-metrics.js';

const DB = 'data/tenants/desarrollo-bamburu.db';
const ORIGIN = 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

const db = new Database(DB);
db.pragma('busy_timeout = 5000');
const token = randomBytes(24).toString('base64url');
const csrf = randomBytes(16).toString('hex');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 1800, csrf);
const wh = db.prepare('SELECT id FROM warehouses WHERE is_default=1').get()?.id;
const prod = db.prepare("SELECT id, price, tax_rate FROM products WHERE status='active' AND COALESCE(type,'physical')='physical' AND price>0 ORDER BY id LIMIT 1").get();
const client = db.prepare('SELECT id, name FROM clients WHERE active=1 ORDER BY id LIMIT 1').get();
const STALE_ORDER_NO = 'VERIFY-STALE-' + now;   // pedido de prueba "bloqueado" (se siembra y se limpia)

const COOKIE = 'asess=' + token + '; btenant=desarrollo-bamburu';
const get = async path => fetch(ORIGIN + path, { headers: { cookie: COOKIE } });
const getJson = async path => (await get(path)).json();
const dashVentas = async () => {
  const html = await (await get('/admin')).text();
  const m = html.match(/Ventas del mes[\s\S]*?disa-fig-value">[^\d-]*(-?[\d.]+)/);
  return m ? Number(m[1]) : null;
};

try {
  console.log('\n=== PIEZA C — venta real de mostrador en los 4 lectores (HTTP) ===\n');
  if (!wh || !prod || !client) { ok(false, 'faltan datos base en dev (almacén/producto/cliente)'); throw new Error('sin datos'); }

  // Importe del ticket: 1× producto a precio de catálogo con su banda de IVA (lo fija el servidor).
  const base = r2(prod.price), iva = r2(base * (prod.tax_rate || 0) / 100), ticketTotal = r2(base + iva);

  // ── BASELINE ──
  const b = {
    dash: await dashVentas(),
    ovRev: (await getJson('/api/erp/analytics/overview')).totalRevenue,
    ovOrd: (await getJson('/api/erp/analytics/overview')).totalOrders,
    sumRev: (await getJson('/api/disa/summary')).metrics.revenue,
    sumOrd: (await getJson('/api/disa/summary')).metrics.orders,
  };
  ok(b.dash !== null && typeof b.ovRev === 'number', 'baseline leído de los lectores HTTP (dashboard ' + b.dash + ', overview ' + r2(b.ovRev) + '/' + b.ovOrd + ' docs)');

  // ── 1) VENTA REAL POR MOSTRADOR (endpoint real, con CSRF) ──
  const saleRes = await fetch(ORIGIN + '/api/erp/mostrador/sale', {
    method: 'POST',
    headers: { cookie: COOKIE, 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify({ warehouse_id: wh, payment_method: 'efectivo', lines: [{ product_id: prod.id, quantity: 1, unit_price: prod.price, tax_rate: prod.tax_rate || 0 }] }),
  });
  const sale = await saleRes.json();
  ok(saleRes.status === 201 && sale.invoice_number?.startsWith('S'), 'mostrador: ticket emitido por el endpoint real (' + (sale.invoice_number || sale.error) + ', total ' + ticketTotal + ')');

  // ── 2) Reflejo en los 3 lectores agregados ──
  const a1 = {
    dash: await dashVentas(),
    ovRev: (await getJson('/api/erp/analytics/overview')).totalRevenue,
    ovOrd: (await getJson('/api/erp/analytics/overview')).totalOrders,
    sumRev: (await getJson('/api/disa/summary')).metrics.revenue,
    sumOrd: (await getJson('/api/disa/summary')).metrics.orders,
  };
  ok(a1.dash === Math.round(b.dash + ticketTotal), 'KPI dashboard "Ventas del mes" subió el total del ticket (' + b.dash + ' → ' + a1.dash + ')');
  ok(r2(a1.ovRev) === r2(b.ovRev + ticketTotal) && a1.ovOrd === b.ovOrd + 1, 'analítica /overview: ingresos +' + ticketTotal + ' y nº docs +1');
  ok(r2(a1.sumRev) === r2(b.sumRev + ticketTotal) && a1.sumOrd === b.sumOrd + 1, 'DISA /summary: ventas del mes +' + ticketTotal + ' y +1 doc');

  // ── 3) Factura CON cliente → su historial ──
  const inv = createInvoice(db, { client_id: client.id, lines: [{ description: 'Servicio PIEZA C', quantity: 1, unit_price: 300, tax_rate: 21 }] });
  const histRes = await getJson('/api/erp/clients/' + client.id);
  const inHist = (histRes.orders || []).some(o => o.order_number === inv.invoice_number && r2(o.total) === 363);
  ok(inHist, 'historial del cliente "' + client.name + '" incluye su factura nueva (' + inv.invoice_number + ', 363)');
  const a2 = { ovRev: (await getJson('/api/erp/analytics/overview')).totalRevenue, ovOrd: (await getJson('/api/erp/analytics/overview')).totalOrders };
  ok(r2(a2.ovRev) === r2(a1.ovRev + 363) && a2.ovOrd === a1.ovOrd + 1, 'la factura con cliente también suma en analítica (+363, +1 doc)');

  // ── 4) ANULAR → deja de sumar; sigue en el historial marcada anulada ──
  anularInvoice(db, inv.id, 'prueba PIEZA C (anulada no suma)');
  const a3 = { ovRev: (await getJson('/api/erp/analytics/overview')).totalRevenue, ovOrd: (await getJson('/api/erp/analytics/overview')).totalOrders };
  ok(r2(a3.ovRev) === r2(a1.ovRev) && a3.ovOrd === a1.ovOrd, 'factura ANULADA deja de sumar en analítica (vuelve al valor previo)');
  const histRes2 = await getJson('/api/erp/clients/' + client.id);
  ok((histRes2.orders || []).some(o => o.order_number === inv.invoice_number && o.status === 'anulada'), 'la anulada sigue en el historial del cliente, marcada "anulada"');

  // ── 5) AVISO "Pedidos bloqueados" → cadena nueva (customer_orders) y href /admin/pedidos ──
  // Sembramos un pedido CONFIRMADO, sin entregar, fechado hace 10 días: debe contar en pedidosSinEntregar
  // y aparecer como aviso en /summary (la sesión es dueña → ve la alerta sin tropezar con pedidos.read).
  const staleDate = new Date(Date.now() - 10 * 86400000).toISOString();
  db.prepare("INSERT INTO customer_orders (order_number, client_id, status, date, delivered_status, subtotal, tax_amount, total) VALUES (?,?,'confirmado',?,NULL,0,0,0)").run(STALE_ORDER_NO, client.id, staleDate);
  const expStale = pedidosSinEntregar(db, 3);   // cuenta real desde la cadena nueva
  const sumAlerts = (await getJson('/api/disa/summary')).alerts || [];
  const blk = sumAlerts.find(a => a.title === 'Pedidos bloqueados');
  ok(expStale > 0 && !!blk, 'DISA /summary: el aviso "Pedidos bloqueados" aparece desde la cadena nueva (customer_orders, ' + expStale + ' sin entregar)');
  ok(!!blk && blk.href === '/admin/pedidos', 'el aviso apunta a /admin/pedidos (cadena nueva, no al POS viejo)');
  ok(!!blk && blk.body.startsWith(expStale + ' pedido'), 'el contador del aviso coincide con pedidosSinEntregar(db,3) = ' + expStale);
} catch (e) { console.error('ERROR', e.message); fail++; } finally {
  db.prepare('DELETE FROM customer_orders WHERE order_number=?').run(STALE_ORDER_NO);   // retira el pedido sembrado
  db.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  db.close();
}
console.log('\n=== RESULTADO HTTP: ' + pass + ' OK / ' + fail + ' FALLOS ===');
console.log('(El ticket de mostrador queda como artefacto real de prueba en dev; la factura con cliente queda ANULADA por el test.)');
process.exit(fail ? 1 : 0);
