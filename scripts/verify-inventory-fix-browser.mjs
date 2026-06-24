// Verificación — FIX Inventario en blanco (bug Pieza 2a en stock-modal.js). Motor real (Chromium/Blink).
//   node scripts/verify-inventory-fix-browser.mjs
// Ejecuta el JS de la página como un navegador real y captura la CONSOLA. Antes del fix, el bloque
// <script> no parseaba (SyntaxError) y nada se ejecutaba → pantalla en blanco. Comprueba: sin errores
// de consola, render de productos físicos + KPIs, kardex/movimientos visibles, y que el aviso
// "reservado / ¿Ajustar igualmente?" sigue saliendo bien (con sus saltos de línea) al chocar con una reserva.
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import puppeteer from 'puppeteer';

const DB = 'data/tenants/desarrollo-bamburu.db';
const ORIGIN = 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const db = new Database(DB);
const token = randomBytes(24).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 1800, randomBytes(8).toString('hex'));
const physCount = db.prepare("SELECT COUNT(*) n FROM products WHERE status='active' AND COALESCE(type,'physical')='physical'").get().n;
const movsBefore = db.prepare('SELECT COUNT(*) n FROM stock_movements').get().n;
db.close();

const consoleErrors = [];
const pageErrors = [];
const browser = await puppeteer.launch({ headless: 'new', executablePath: '/snap/bin/chromium', userDataDir: '/home/ubuntu/.cache/pptr-verify', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => pageErrors.push(e.message));
await page.setViewport({ width: 1280, height: 1000 });
await page.setCookie({ name: 'asess', value: token, domain: '127.0.0.1', path: '/' }, { name: 'btenant', value: 'desarrollo-bamburu', domain: '127.0.0.1', path: '/' });

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
  await page.evaluate(() => window.openStockKardex(5, 'Cesta Relax Premium'));
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
  let dialogMsg = null;
  page.on('dialog', async d => { dialogMsg = d.message(); await d.dismiss(); });
  await page.evaluate(() => window.openAjustar(5, 'Cesta Relax Premium'));
  await page.waitForFunction(() => document.getElementById('stockAdjModal')?.classList.contains('show') || document.getElementById('stockAdjModal')?.style.display !== 'none', { timeout: 4000 }).catch(() => {});
  await page.evaluate(() => {
    const wh = document.getElementById('stockAdjWh'); if (wh) { wh.value = '1'; window.stockAdjWhChange && window.stockAdjWhChange(); }
    document.getElementById('stockAdjMode').value = 'set';
    document.getElementById('stockAdjValue').value = '0';
    const rs = document.getElementById('stockAdjReason'); if (rs && rs.options.length > 1) rs.selectedIndex = 1;
  });
  await page.evaluate(() => window.guardarAjuste());
  await page.waitForFunction(() => true, { timeout: 1500 }).catch(() => {});
  await sleep(800);
  ok(dialogMsg !== null && /reservad/i.test(dialogMsg) && /¿Ajustar igualmente\?/.test(dialogMsg), 'el aviso de reserva sale bien: ' + JSON.stringify(dialogMsg));
  ok(dialogMsg && dialogMsg.includes('\n'), 'el mensaje conserva sus saltos de línea (el \\n\\n del fix se resuelve en runtime, no rompe el <script>)');

  // 5) Al CANCELAR el aviso no se ha escrito ningún ajuste (la corrección no altera datos).
  const dbv = new Database(DB, { readonly: true });
  const movsAfter = dbv.prepare('SELECT COUNT(*) n FROM stock_movements').get().n;
  dbv.close();
  ok(movsAfter === movsBefore, 'al cancelar el aviso NO se creó ningún movimiento (stock_movements ' + movsBefore + ' = ' + movsAfter + ')');
} catch (e) { console.error('ERROR', e.message); fail++; } finally {
  await browser.close();
  const d = new Database(DB); d.prepare('DELETE FROM admin_sessions WHERE token=?').run(token); d.close();
}
console.log('\n=== RESULTADO NAVEGADOR: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
