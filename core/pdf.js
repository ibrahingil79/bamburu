// ════════════════════════════════════════════════════════════════════════════
// GENERADOR DE PDF — ÚNICO PUNTO de la plataforma que produce un PDF. Es
// document-agnostic: NO sabe de presupuestos, pedidos, albaranes ni facturas;
// recibe el HTML imprimible YA EXISTENTE de un documento y lo renderiza con
// Chromium (page.pdf()). Cualquier documento se cablea pasándole su HTML
// imprimible (ver modules/erp/layout.js → printableShell, que envuelve el cuerpo
// del documento en un HTML standalone con la misma maquetación que la pantalla).
//
// Navegador en SINGLETON perezoso, reutilizado entre llamadas (nada de lanzar
// Chromium por petición). Si la conexión se cae (browser.isConnected()===false),
// se relanza en la siguiente llamada.
// ════════════════════════════════════════════════════════════════════════════
import puppeteer from 'puppeteer';
import fs from 'fs';

// Resolución del binario de Chromium. IMPORTANTE: el `/snap/bin/chromium` (snap) NO arranca
// bajo systemd — snap-confine exige cap_dac_override y el servicio corre con capabilities
// recortadas ("snap-confine ... cap_dac_override not found"). Por eso usamos el Chrome que
// puppeteer descarga en ~/.cache/puppeteer (binario normal, sin confinamiento snap, arranca
// con --no-sandbox). Orden: env PUPPETEER_EXECUTABLE_PATH → bundled de la caché → snap (último
// recurso, sirve en ejecución interactiva con capabilities completas).
function resolveExecutablePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  // En este servidor (ARM64) el Chrome que puppeteer descarga en la caché es x86-64 (descarga de
  // arch equivocada → "Syntax error" al ejecutarlo). El único Chromium del arch correcto es el de
  // snap, que SÍ arranca bajo systemd con NoNewPrivileges=false. Preferimos snap si existe.
  if (fs.existsSync('/snap/bin/chromium')) return '/snap/bin/chromium';
  // Fallback (hosts x86-64 sin snap): el bundled de la caché de puppeteer.
  const homes = [process.env.HOME, '/home/ubuntu'].filter(Boolean);
  for (const h of homes) {
    const base = h + '/.cache/puppeteer/chrome';
    try {
      const dirs = fs.readdirSync(base).filter(d => d.startsWith('linux')).sort().reverse();
      for (const d of dirs) {
        const p = base + '/' + d + '/chrome-linux64/chrome';
        if (fs.existsSync(p)) return p;
      }
    } catch {}
  }
  return '/snap/bin/chromium';
}
const EXECUTABLE_PATH = resolveExecutablePath();

let _browser = null;
let _launching = null;

// ¿Sigue vivo el navegador? Puppeteer expone `browser.connected` (propiedad) en versiones
// recientes y `browser.isConnected()` (método) en las antiguas — soportamos ambas.
function browserAlive(b) {
  if (!b) return false;
  if (typeof b.connected === 'boolean') return b.connected;
  if (typeof b.isConnected === 'function') return b.isConnected();
  return false;
}

async function getBrowser() {
  if (browserAlive(_browser)) return _browser;
  // Evita relanzar en paralelo si llegan dos peticiones a la vez.
  if (_launching) return _launching;
  _launching = puppeteer.launch({
    headless: 'new',
    executablePath: EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  }).then(b => { _browser = b; _launching = null; return b; })
    .catch(e => { _launching = null; throw e; });
  return _launching;
}

// renderPdfFromHtml(html, { filename }) → Buffer con el PDF.
// - setContent del HTML; espera networkidle + document.fonts.ready ANTES de page.pdf()
//   para que Inter (web font) esté cargada y no salga en la fuente de reserva.
// - A4, printBackground (chrome grafito + colores de estado), márgenes razonables,
//   preferCSSPageSize por si el HTML define @page.
export async function renderPdfFromHtml(html, { filename } = {}) {
  if (!html || typeof html !== 'string') {
    const e = new Error('renderPdfFromHtml: HTML vacío'); e.status = 500; throw e;
  }
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    // Espera a que las fuentes (Inter) terminen de cargar; si no hay red, fonts.ready
    // resuelve igual con la de reserva y no bloquea (el page.pdf sigue).
    try { await page.evaluate(async () => { if (document.fonts && document.fonts.ready) await document.fonts.ready; }); } catch {}
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '12mm', right: '12mm', bottom: '14mm', left: '12mm' },
    });
    const buf = Buffer.from(pdf);
    if (!buf.length || buf.slice(0, 4).toString('latin1') !== '%PDF') {
      const e = new Error('renderPdfFromHtml: el PDF generado no es válido'); e.status = 500; throw e;
    }
    return buf;
  } finally {
    try { await page.close(); } catch {}
  }
}
