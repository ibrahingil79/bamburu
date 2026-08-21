// Gate — DISA crea compras DICTÁNDOLAS por voz (Pilar 3) — servidor real (tenant
// desarrollo-bamburu). La voz solo cambia la PUERTA: reproduce el MISMO payload normalizado
// que la captura por foto y aterriza por los caminos ya construidos.
//
// DETERMINISTA (no gasta modelo): el adjunto de voz se crea con captureFromExtraction (el
// MISMO código que usa la acción dictar_compra) y la respuesta del chat se mockea con su
// capture_url. Así se prueba el BUG REPORTADO sin depender de la API:
//   PART 1: el chat de TEXTO debe AUTO-NAVEGAR al recibir capture_url, en las 3 superficies
//           (widget, dashboard, asistente IA). Antes solo navegaba el flujo de adjuntar foto.
//   PART 2: pantalla precargada por voz → confirmar → stock + WAC por el libro + producto nuevo
//           con su banda + "Documento origen" (nota de voz) enlazado.
//   PART 3: proveedor y producto inexistentes → la pantalla ofrece crearlos.
//   PART 4: prefill de banda 1:1 + guardarraíl (10→reducido, 21→general, rate raro→en blanco).
//
// El flujo de extremo a extremo CON modelo real (DISA emitiendo dictar_compra) se verificó en
// la corrida 26/26 previa; aquí se aísla el arreglo de navegación, robusto y sin créditos.
//
//   node scripts/gate-disa-dictar-compra.mjs
import puppeteer from 'puppeteer';
import { tenantDb, launchOpts } from './lib/gate-env.mjs';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { captureFromExtraction } from '../modules/erp/routes/purchases-capture.js';

const DB_PATH = tenantDb('desarrollo-bamburu');
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const DOMAIN = 'desarrollo-bamburu.localhost';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const db = new Database(DB_PATH);
const token = randomBytes(32).toString('base64url');
const csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 1800, csrf);

const VAINILLA_ID = 2;   // Vela Vainilla 200g (física, existente)
const stockOf = id => db.prepare('SELECT stock, average_cost FROM products WHERE id=?').get(id);
const cleanupAttachments = [];

// Crea un adjunto de voz por el MISMO camino que la acción dictar_compra.
function voiceAttachment(extracted) {
  const r = captureFromExtraction(db, null, extracted);
  cleanupAttachments.push(r.attachment_id);
  return r.attachment_id;
}

const browser = await puppeteer.launch({ ...launchOpts() });
async function newAdminPage() {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  await page.setCookie({ name: 'asess', value: token, domain: DOMAIN, path: '/' });
  page.on('dialog', async d => { await d.accept(); });
  return page;
}
// Mockea la respuesta de /api/disa/message para devolver un capture_url (simula que DISA
// dictó una compra) sin llamar al modelo. El resto de peticiones pasan tal cual.
async function mockDisaReply(page, captureUrl) {
  await page.evaluate((cu) => {
    const orig = window.fetch;
    window.fetch = async (url, opts) => {
      const u = typeof url === 'string' ? url : (url && url.url) || '';
      if (u.includes('/api/disa/message')) {
        return new Response(JSON.stringify({ reply: 'He preparado la compra. Te llevo a la pantalla de revisión.', capture_url: cu, thread_id: 1, action_executed: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return orig(url, opts);
    };
  }, captureUrl);
}

try {
  // ════ PART 1 — El chat de TEXTO auto-navega en las 3 superficies (BUG REPORTADO) ════
  console.log('\nPART 1 · El chat de texto AUTO-NAVEGA al recibir capture_url (3 superficies)');
  const navAtt = voiceAttachment({
    supplier: { name: 'Aromas del Sur SL', fiscal_id: '1111' }, date: '2026-06-15',
    lines: [{ description: 'Vela Vainilla 200g', quantity: 3, unit_cost: 4, vat_rate: 21 }],
  });
  const navUrl = '/admin/purchases/capture?attachment=' + navAtt;

  // (a) WIDGET flotante (#dpInput / dpSend)
  {
    const page = await newAdminPage();
    await page.goto(BASE + '/admin/inventory', { waitUntil: 'networkidle0' });
    await page.evaluate(() => window.disaOpen());
    await page.waitForSelector('#dpInput', { visible: true, timeout: 10000 });
    await mockDisaReply(page, navUrl);
    await page.type('#dpInput', 'apunta una compra a Aromas del Sur SL: 3 velas vainilla a 4');
    await page.evaluate(() => window.dpSend());
    await page.waitForFunction(() => location.pathname === '/admin/purchases/capture', { timeout: 8000 })
      .then(() => ok(true, 'WIDGET: el chat de texto auto-navega a la pantalla de captura'))
      .catch(() => ok(false, 'WIDGET: NO navegó (bug)'));
    await page.close();
  }
  // (b) DASHBOARD — RETIRADO, y no por comodidad: ESA SUPERFICIE YA NO EXISTE, a propósito.
  // El chat de DISA se fue del Inicio en el rediseño de la portada, y está dicho por escrito en el
  // propio producto (`modules/erp/views/disaHome.html.js`: «EL CHAT DE DISA SE VA DEL INICIO, Y SOLO
  // DEL INICIO. DISA sigue estando entera: en su pantalla (/admin/disa) y en la entrada del menú»).
  // El gate seguía escribiendo en `#dh-input`, que ya no se pinta en ninguna parte, y moría con un
  // timeout de 10 s — un rojo permanente que parecía del producto y era de una pantalla jubilada.
  // NO se apunta a otra pantalla para salvar el paso: lo que medía era el dictado DESDE la portada,
  // y eso es justo lo que se decidió quitar. El dictado desde la pantalla de DISA lo cubre el
  // apartado (c), que sigue vivo aquí abajo con `#msgInput`.
  // (c) ASISTENTE IA (#msgInput / disaSend)
  {
    const page = await newAdminPage();
    await page.goto(BASE + '/admin/disa', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#msgInput', { timeout: 10000 });
    await mockDisaReply(page, navUrl);
    await page.type('#msgInput', 'apunta una compra a Aromas del Sur SL: 3 velas vainilla a 4');
    await page.evaluate(() => window.disaSend());
    await page.waitForFunction(() => location.pathname === '/admin/purchases/capture', { timeout: 8000 })
      .then(() => ok(true, 'ASISTENTE IA: el chat de texto auto-navega a la pantalla de captura'))
      .catch(() => ok(false, 'ASISTENTE IA: NO navegó (bug)'));
    await page.close();
  }

  // ════ PART 2 — Pantalla precargada por voz → confirmar (stock + WAC + documento origen) ════
  console.log('\nPART 2 · Revisión precargada por voz → confirmar → stock + WAC + documento origen');
  const vainillaBefore = stockOf(VAINILLA_ID);
  {
    const att = voiceAttachment({
      supplier: { name: 'Aromas del Sur SL', fiscal_id: '1111' }, date: '2026-06-15',
      lines: [
        { description: 'Vela Vainilla 200g', quantity: 3, unit_cost: 4, vat_rate: 21 },
        { description: 'Difusor de bambú artesanal premium', quantity: 2, unit_cost: 7.5, vat_rate: 10 },
      ],
    });
    const page = await newAdminPage();
    await page.goto(BASE + '/admin/purchases/capture?attachment=' + att, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#step2', { visible: true, timeout: 15000 });
    ok(await page.$eval('#step1', el => getComputedStyle(el).display === 'none'), 'Paso 1 OCULTO — entró precargado');
    ok(await page.$('#docPreview img') === null && await page.$eval('#docPreview', el => /dictada por voz/i.test(el.textContent)),
      'panel del documento degradado: "dictada por voz" (sin imagen)');
    ok(await page.$eval('#supplierBox', el => /Aromas del Sur/i.test(el.textContent)).catch(() => false),
      'proveedor reconocido (Aromas del Sur, por NIF)');
    const nLines = await page.evaluate(() => window.lines.length);
    ok(nLines === 2, 'la revisión trae 2 líneas precargadas');
    // banda prerellenada desde vat_rate 10 → reducido (se fija en estado para TODA línea,
    // la busco por descripción para no depender de si cuadró con un producto existente).
    const difBand = await page.evaluate(() => {
      const l = window.lines.find(x => /Difusor/i.test(x.description || ''));
      return l ? l.new_tax_band : null;
    });
    ok(difBand === 'reducido', 'línea del Difusor: banda prerellenada a "reducido" (vat 10)');

    // Confirm determinista: Vainilla (3×4) existente + Difusor nuevo (banda reducido) + compra directa.
    await page.evaluate(() => {
      const matched = window.lines.find(l => l.product_mode === 'existing' && l.product_id);
      const nuevo = window.lines.find(l => l !== matched);
      window.lines.slice().forEach(l => { if (l !== matched && l !== nuevo) window.lineRemove(l.uid); });
      if (matched) { window.lineSet(matched.uid, 'quantity', '3'); window.lineSet(matched.uid, 'unit_cost', '4'); }
      if (nuevo) {
        window.lineNewProduct(nuevo.uid);
        window.lineSet(nuevo.uid, 'new_name', 'Difusor de bambú artesanal premium');
        window.lineSet(nuevo.uid, 'new_tax_band', 'reducido');
        window.lineSet(nuevo.uid, 'quantity', '2');
        window.lineSet(nuevo.uid, 'unit_cost', '7.5');
      }
      window.pickSupplier(1, 'Aromas del Sur SL');
      window.pickDest('direct', null);
    });
    await sleep(300);
    await page.click('#btnConfirm');
    await page.waitForNavigation({ timeout: 20000 }).catch(() => {});
    const url = page.url();
    ok(/\/admin\/purchases\/\d+$/.test(url), 'confirmar → ficha de la compra (' + url.split('/').pop() + ')');
    if (/\/admin\/purchases\/\d+$/.test(url)) {
      const purchaseId = parseInt(url.split('/').pop());
      const vainillaAfter = stockOf(VAINILLA_ID);
      ok(vainillaAfter.stock === vainillaBefore.stock + 3, 'stock de Vainilla +3 por el libro (' + vainillaBefore.stock + '→' + vainillaAfter.stock + ')');
      const expWac = (vainillaBefore.stock * vainillaBefore.average_cost + 3 * 4) / (vainillaBefore.stock + 3);
      ok(Math.abs(vainillaAfter.average_cost - expWac) < 1e-6, 'WAC recalculado por el libro (≈' + expWac.toFixed(4) + ')');
      const np = db.prepare("SELECT tax_band, tax_rate, stock, average_cost FROM products WHERE name='Difusor de bambú artesanal premium' ORDER BY id DESC LIMIT 1").get();
      ok(np && np.tax_band === 'reducido' && np.tax_rate === 10, 'producto NUEVO creado con banda explícita (reducido 10%), no general/21');
      ok(np && np.stock === 2 && Math.abs(np.average_cost - 7.5) < 1e-6, 'stock (2) y WAC (7.5) del producto nuevo por el libro');
      const at = db.prepare("SELECT * FROM attachments WHERE entity_type='purchase' AND entity_id=?").get(purchaseId);
      ok(!!at, 'adjunto de voz enlazado a la compra (documento origen)');
      const ficha = await page.content();
      ok(/Documento origen/.test(ficha) && /dictada por voz/i.test(ficha), '"Documento origen" en la ficha como nota de voz (sin enlace roto)');
    }
    await page.close();
  }

  // ════ PART 3 — Proveedor y producto INEXISTENTES → ofrecer crearlos ════
  console.log('\nPART 3 · Proveedor y producto inexistentes → la pantalla ofrece crearlos');
  {
    const att = voiceAttachment({
      supplier: { name: 'Velas del Norte SL', fiscal_id: '' }, date: '2026-06-15',
      lines: [{ description: 'Portavela de cerámica artesanal único xyz', quantity: 5, unit_cost: 3, vat_rate: 21 }],
    });
    const page = await newAdminPage();
    await page.goto(BASE + '/admin/purchases/capture?attachment=' + att, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#step2', { visible: true, timeout: 15000 });
    ok(await page.$eval('#supplierBox', el => /Crear proveedor|nuevo/i.test(el.textContent)).catch(() => false),
      'proveedor inexistente → la pantalla ofrece crearlo');
    ok(await page.$eval('#linesBody', el => /Crear producto|elegir existente|NUEVO/i.test(el.textContent)).catch(() => false),
      'producto inexistente → la pantalla ofrece crearlo');
    await page.close();
  }

  // ════ PART 4 — Prefill de banda 1:1 + guardarraíl (rate raro → en blanco) ════
  console.log('\nPART 4 · Prefill de banda IVA 1:1 y guardarraíl (rate raro → en blanco)');
  {
    const att = voiceAttachment({
      supplier: { name: 'Proveedor Prefill Test', fiscal_id: '' }, date: '2026-06-15',
      lines: [
        { description: 'ZZ-prefill-reducido-xyz', quantity: 1, unit_cost: 5, vat_rate: 10 },
        { description: 'ZZ-prefill-general-xyz', quantity: 1, unit_cost: 5, vat_rate: 21 },
        { description: 'ZZ-prefill-raro-xyz', quantity: 1, unit_cost: 5, vat_rate: 7 },
      ],
    });
    const page = await newAdminPage();
    await page.goto(BASE + '/admin/purchases/capture?attachment=' + att, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#step2', { visible: true, timeout: 15000 });
    const bands = await page.evaluate(() => window.lines.map(l => l.new_tax_band));
    console.log('  → bandas prerellenadas:', JSON.stringify(bands));
    ok(bands[0] === 'reducido', 'vat_rate 10 → banda "reducido" (1:1)');
    ok(bands[1] === 'general', 'vat_rate 21 → banda "general" (1:1)');
    ok(bands[2] === '', 'vat_rate 7 (desconocido) → en BLANCO (no adivina; la pantalla la exige)');
    await page.close();
  }
} catch (e) {
  console.error('GATE ERROR:', e);
  ok(false, 'el gate terminó sin excepción');
} finally {
  await browser.close();
  for (const id of cleanupAttachments) { try { db.prepare('DELETE FROM attachments WHERE id=? AND entity_id IS NULL').run(id); } catch {} }
  db.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  db.close();
}

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' OK, ' + fail + ' fallos');
process.exit(fail ? 1 : 0);
