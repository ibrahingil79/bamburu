// Capturas de la pantalla central de avisos y de sus enlaces directos, contra el servidor real.
// Solo lectura: crea una sesión temporal y la borra al terminar. No es un gate (eso es
// gate-avisos-badge.mjs): esto sirve para MIRAR el resultado antes de darlo por cerrado.
//   node scripts/shot-avisos.mjs [directorio-de-salida]
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { mkdirSync } from 'fs';
import { join } from 'path';

const DB_PATH = '/home/ubuntu/bamburu/data/tenants/desarrollo-bamburu.db';
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const OUT = process.argv[2] || join(process.env.HOME, 'avisos-shots');
mkdirSync(OUT, { recursive: true });

const db = new Database(DB_PATH);
const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 1800, csrf);

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/snap/bin/chromium',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.setCookie({ name: 'asess', value: token, domain: 'desarrollo-bamburu.localhost', path: '/' });

const shot = async (name, url, waitFor) => {
  await page.goto(BASE + url, { waitUntil: 'networkidle0' });
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 8000 });
  const file = join(OUT, name + '.png');
  await page.screenshot({ path: file });
  console.log('  ✓ ' + name + ' → ' + file + '   (' + url + ')');
};

try {
  await shot('1-avisos-pantalla', '/admin/avisos', '#avBody tr.frow');
  await shot('2-inicio-resumen', '/admin', '.disa-rows');
  await shot('4-enlace-stock', '/admin/inventory?q=' + encodeURIComponent('Difusor de bambú'), '#invBody tr');
  await shot('5-enlace-proveedor', '/admin/supplier-invoices/10', '.card');

  // El panel de la campana (se abre pulsándola, no navegando).
  await page.goto(BASE + '/admin/avisos', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#avBody tr.frow', { timeout: 8000 });
  await page.click('#tbBell');
  await page.waitForSelector('#bellPanel.open .bell-item', { timeout: 8000 });
  await page.screenshot({ path: join(OUT, '6-panel-campana.png') });
  console.log('  ✓ 6-panel-campana → ' + join(OUT, '6-panel-campana.png') + '   (campana abierta)');
} finally {
  db.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  await browser.close();
  db.close();
}
