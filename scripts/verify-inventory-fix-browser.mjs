// Verificación — Inventario en navegador headless (Puppeteer), servidor real.
//
// ⚙️ SE TRAE SU PROPIO NEGOCIO (24 ago 2026). Contaba los productos físicos del negocio de desarrollo
// y los comparaba con la tabla: decía «80» y la pantalla enseñaba 119, porque su consulta y la de la
// pantalla no filtraban igual y el catálogo del negocio cambia cada semana. Con un catálogo propio y
// conocido —dos productos sembrados aquí— la cuenta es determinista y el desajuste, si vuelve, es
// del producto y no del inventario ajeno.
import Database from 'better-sqlite3';
import puppeteer from 'puppeteer';
import { negocioDesechable, sembrarFlujoDocumentos } from './lib/negocio-desechable.mjs';
import { createPedidoSvc, confirmPedidoSvc } from '../modules/erp/routes/pedidos.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const neg = await negocioDesechable('Gate Inventario');
const ORIGIN = neg.base;
let physCount, movsBefore, token, SEMILLA, PROD_NAME;
try {
  SEMILLA = sembrarFlujoDocumentos(neg.db, { stock: 20, precio: 30 });
  PROD_NAME = neg.db.prepare('SELECT name FROM products WHERE id=?').get(SEMILLA.productoId).name;
  // UN PEDIDO CONFIRMADO para que exista una RESERVA: es lo que mira el aviso de esta pantalla, y
  // antes lo daba por sentado del negocio ajeno.
  const pedidoId = createPedidoSvc(neg.db, { client_id: SEMILLA.clienteId, warehouse_id: SEMILLA.almacenId,
    lines: [{ product_id: SEMILLA.productoId, quantity: 5, unit_price: SEMILLA.precio, tax_rate: 21 }] });
  confirmPedidoSvc(neg.db, pedidoId);
  physCount = neg.db.prepare("SELECT COUNT(*) n FROM products WHERE status='active' AND COALESCE(type,'physical')='physical'").get().n;
  movsBefore = neg.db.prepare('SELECT COUNT(*) n FROM stock_movements').get().n;
  token = neg.sesion();
} catch (e) { console.error('✗ No se pudo sembrar: ' + e.message); neg.tirar(); process.exit(1); }

const consoleErrors = [];
const pageErrors = [];
const browser = await puppeteer.launch({ headless: 'new', executablePath: '/snap/bin/chromium', userDataDir: '/home/ubuntu/.cache/pptr-verify', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => pageErrors.push(e.message));
await page.setViewport({ width: 1280, height: 1000 });
await page.setCookie({ name: 'asess', value: token, domain: new URL(ORIGIN).hostname, path: '/' });

try {
  console.log('\n=== FIX Inventario — navegador real (Chromium) ===\n');

  // 1) Cargar Inventario y esperar a que el JS popule la tabla (esto NO ocurría con el SyntaxError).
  await page.goto(ORIGIN + '/admin/inventory', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => {
    const b = document.getElementById('invBody');
    return b && b.querySelector('tr td strong') && !/Cargando|Sin productos/.test(b.innerText);
  }, { timeout: 8000 }).catch(() => {});

  ok(pageErrors.length === 0, 'sin errores de página (pageerror): ' + (pageErrors[0] || 'ninguno'));
  ok(!consoleErrors.some(e => /SyntaxError|Invalid or unexpected token/i.test(e)), 'sin SyntaxError en consola' + (consoleErrors.length ? ' (otros: ' + consoleErrors.join(' | ') + ')' : ''));

  // 2) Render: productos físicos + KPIs.
  const rows = await page.$$eval('#invBody tr', trs => trs.filter(tr => tr.querySelector('td strong')).length);
  const kTotal = await page.$eval('#kTotal', e => e.textContent.trim());
  const kVal = await page.$eval('#kVal', e => e.textContent.trim());
  ok(rows === physCount && kTotal === String(physCount), 'aparecen los ' + physCount + ' productos físicos en la tabla (KPI Total=' + kTotal + ', filas=' + rows + ')');
  ok(/^€?\d/.test(kVal), 'KPIs poblados (valor de inventario = ' + kVal + ')');

  // 3) Kardex / movimientos: abrir "Ver stock" del producto 5 y ver sus movimientos.
  // El producto es el que sembró ESTA comprobación, no el id 5 de otro negocio.
  await page.evaluate(([id, n]) => window.openStockKardex(id, n), [SEMILLA.productoId, PROD_NAME]);
  await page.waitForFunction(() => { const b = document.getElementById('stockKardexBody'); return b && !/Cargando/.test(b.innerText); }, { timeout: 6000 });
  const kardexInfo = await page.evaluate(() => {
    const b = document.getElementById('stockKardexBody');
    return { txt: b.textContent, movRows: b.querySelectorAll('table tbody tr').length };
  });
  ok(/Stock por almacén/.test(kardexInfo.txt) && /Stock actual/.test(kardexInfo.txt) && kardexInfo.movRows >= 1, 'el kardex se ve: stock actual + desglose por almacén + ' + kardexInfo.movRows + ' fila(s) (almacenes + movimientos)');
  await page.evaluate(() => window.closeModal && window.closeModal('stockKardexModal'));
  await sleep(200);

  // 4) Aviso de reserva "¿Ajustar igualmente?": ajustar el almacén con reserva por debajo de lo reservado.
  //    Capturamos el confirm() y lo CANCELAMOS (dismiss) → NO se escribe ningún ajuste.
  // ⚙️ 24 ago 2026 · EL AVISO YA NO ES UNA VENTANITA DEL NAVEGADOR. Aquí había un `page.on('dialog')`
  // esperando un confirm() que dejó de existir al migrar las 80 al panel de la casa: el aviso salía,
  // nadie lo leía, y las dos aserciones caían.
  // Aquí NO se usa `autoAceptarPaneles` a propósito: lo que esta comprobación mide es que al
  // CANCELAR el aviso no se toque el stock, y un ayudante que acepta solo mediría lo contrario.
  let dialogMsg = null;
  // No se espera a que TERMINE: `openAjustar` abre el panel y se queda esperando al usuario, así que
  // aguardar su promesa cuelga la comprobación. Se dispara y se espera al panel, que es lo que importa.
  page.evaluate(([id, n]) => { window.openAjustar(id, n); }, [SEMILLA.productoId, PROD_NAME]).catch(() => {});
  await page.waitForFunction(() => document.getElementById('stockAdjModal')?.classList.contains('show') || document.getElementById('stockAdjModal')?.style.display !== 'none', { timeout: 4000 }).catch(() => {});
  await page.evaluate((WID) => {
    const wh = document.getElementById('stockAdjWh'); if (wh) { wh.value = String(WID); window.stockAdjWhChange && window.stockAdjWhChange(); }
    document.getElementById('stockAdjMode').value = 'set';
    document.getElementById('stockAdjValue').value = '0';
    const rs = document.getElementById('stockAdjReason'); if (rs && rs.options.length > 1) rs.selectedIndex = 1;
  }, SEMILLA.almacenId);
  await page.evaluate(() => window.guardarAjuste());
  // El aviso sale DENTRO de la página: se espera, se lee y se CANCELA.
  // El aviso sale ENCIMA del modal de ajuste, así que hay DOS overlays abiertos: se coge el que
  // trae la advertencia, no el formulario. Buscarlo por su texto es más honesto que por su posición.
  await page.waitForFunction(
    () => [...document.querySelectorAll('.modal-overlay.open')].some(o => /reservad/i.test(o.innerText)),
    { timeout: 6000 }).catch(() => {});
  dialogMsg = await page.evaluate(() => {
    const o = [...document.querySelectorAll('.modal-overlay.open')].find(x => /reservad/i.test(x.innerText));
    return o ? o.innerText : null;
  });
  await page.evaluate(() => {
    const o = [...document.querySelectorAll('.modal-overlay.open')].find(x => /reservad/i.test(x.innerText));
    const x = o && o.querySelector('[data-pd="x"]');
    if (x) x.click();
  });
  await sleep(800);
  ok(dialogMsg !== null && /reservad/i.test(dialogMsg) && /¿Ajustar igualmente\?/.test(dialogMsg), 'el aviso de reserva sale bien: ' + JSON.stringify(dialogMsg));
  ok(dialogMsg && dialogMsg.includes('\n'), 'el mensaje conserva sus saltos de línea (el \\n\\n se resuelve en runtime, no rompe el bloque)');

  // 5) Al CANCELAR el aviso no se ha escrito ningún ajuste (la corrección no altera datos).
  const dbv = new Database(neg.abs, { readonly: true });
  const movsAfter = dbv.prepare('SELECT COUNT(*) n FROM stock_movements').get().n;
  dbv.close();
  ok(movsAfter === movsBefore, 'al cancelar el aviso NO se creó ningún movimiento (stock_movements ' + movsBefore + ' = ' + movsAfter + ')');
} catch (e) { console.error('ERROR', e.message); fail++; } finally {
  try { await browser.close(); } catch (_) {}
  neg.tirar();
  console.log('  [limpieza] negocio de prueba «' + neg.slug + '» tirado entero');
}
console.log('\n=== RESULTADO NAVEGADOR: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
