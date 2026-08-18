// Entorno común de los gates de navegador.
//
// NACE DE UN BUG REAL, y su único trabajo es que no se repita. Los gates escritos antes de la
// migración del servidor guardaban la ruta de la BD A MANO: '/home/ibrahin/bamburu/data/...'.
// Al migrar la app a /home/ubuntu, CATORCE gates quedaron MUERTOS —morían al abrir la BD, o al
// arrancar un Chromium que en este servidor (ARM) no existe— y nadie se enteró durante tres semanas.
//
// Las dos reglas que impone este módulo:
//   1. La ruta de la BD se RESUELVE desde la ubicación del script, nunca se escribe a mano. Mover el
//      repo de sitio no puede volver a matar un gate.
//   2. Si falta algo imprescindible (la BD, el Chromium), el gate ABORTA con un mensaje explícito y
//      código != 0. Un gate que no puede arrancar no ha verificado NADA: tiene que decirlo a gritos,
//      no morir con una traza que un barrido de regresión pueda confundir con ruido.
import { existsSync, statSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

export const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Aborta el gate dejando claro que NO es un aprobado. Código 2 (distinto del 1 de "hay fallos"):
// 1 = el gate corrió y encontró fallos · 2 = el gate NO PUDO CORRER. No son lo mismo.
function abortar(msg, pista) {
  console.error('\n✗ GATE ABORTADO — no ha verificado NADA. Esto NO es un aprobado.');
  console.error('  ' + msg);
  if (pista) console.error('  ' + pista);
  process.exit(2);
}

// Ruta a la BD de un tenant, resuelta desde el repo. Si no existe, el gate aborta.
export function tenantDb(slug = 'desarrollo-bamburu') {
  const p = join(APP_DIR, 'data', 'tenants', slug + '.db');
  if (!existsSync(p)) abortar('No existe la BD del tenant: ' + p, '¿Se movió el repo, o falta el tenant "' + slug + '"?');
  return p;
}

// Los gates que llaman al MODELO REAL dependen de que el negocio tenga cuota de IA este mes. El
// freno de gasto de core/llm.js corta ANTES de llamar a la API (429) cuando el gasto del mes supera
// el tope del tenant, y entonces el gate no prueba nada: se queda mirando una pantalla que nunca se
// pinta y muere con una traza confusa (así estuvieron gate-c2-captura y gate-disa-captura-chat, con
// el diagnóstico equivocado de "selector caducado" encima).
//
// Sin cuota NO hay veredicto: se aborta con código 2, como cuando falta el Chromium. "No he podido
// probarlo" y "ha fallado" no son lo mismo, y confundirlos es como nació el falso verde de julio.
export function requireLlmQuota(db) {
  const TOPE_POR_DEFECTO = 5;   // core/llm.js · TENANT_CAP_EUR
  const mes = new Date().toISOString().slice(0, 7);
  let gasto = 0, tope = TOPE_POR_DEFECTO;
  try { gasto = db.prepare('SELECT eur FROM disa_spend WHERE month=?').get(mes)?.eur || 0; } catch { /* sin tabla: no bloquea */ }
  try {
    const v = db.prepare("SELECT value FROM platform_limits WHERE key='ai_cap_eur'").get()?.value;
    if (typeof v === 'number' && v >= 0) tope = v;
  } catch { /* sin tabla: el default */ }
  if (gasto >= tope) {
    abortar(
      'El negocio ha agotado su cuota de IA de ' + mes + ': ' + gasto.toFixed(3) + ' € de un tope de ' + tope + ' €.',
      'El modelo devolvería 429 y este gate no probaría NADA. Sube el tope (platform_limits.ai_cap_eur) o espera al mes que viene.'
    );
  }
}

// El Chromium que trae puppeteer NO arranca en este servidor (ARM): "Syntax error: newline
// unexpected". Hay que usar el de snap. Se puede forzar otro con PUPPETEER_EXECUTABLE_PATH.
export const CHROMIUM = process.env.PUPPETEER_EXECUTABLE_PATH || '/snap/bin/chromium';

// Algunos gates prueban un flujo que solo existe SOBRE UNA RED CONCRETA (el alta por la dirección de
// Tailscale, p. ej.). Si esa red no está montada en la máquina donde se corre, el gate no puede
// probar nada — y morir con un ERR_NAME_NOT_RESOLVED disfraza "aquí no se puede probar" de "esto
// está roto". Se aborta con código 2 y se dice cuál de las dos cosas es.
export async function requireHost(hostname, pista) {
  const { lookup } = await import('dns/promises');
  try { await lookup(hostname); }
  catch {
    abortar('El host "' + hostname + '" no resuelve en esta máquina: el gate no puede ni conectarse.',
            pista || 'No es un fallo del producto: es que este entorno no tiene esa red montada.');
  }
}

// La UI dejó de avisar con alert() y ahora usa toast() (un div que se borra solo a los 3,2 s). Un
// gate que espere un `dialog` de Chromium no verá NADA — y, peor, la respuesta que había dejado
// preparada para ese alert se la comerá el prompt() siguiente, que recibirá basura (así reventaba
// gate-orden-compra-c1a: anulaba con un motivo vacío y se quedaba esperando una navegación que no
// llegaba nunca).
//
// Esto engancha el toast REAL de la página y apunta cada aviso en window.__toasts. No sustituye ni
// simula nada: deja que el toast se pinte, solo toma nota. Sirve para AFIRMAR lo que el usuario ve,
// sin carreras contra el temporizador que lo borra. Hay que llamarlo antes del primer goto (se
// reinstala solo en cada navegación).
export async function engancharToasts(page) {
  await page.evaluateOnNewDocument(() => {
    window.__toasts = [];
    const instalar = () => {
      if (window.__toastEnganchado || typeof window.toast !== 'function') return;
      const original = window.toast;
      window.toast = function (msg, tipo) {
        window.__toasts.push({ msg: String(msg), tipo: tipo || 'ok' });
        return original.apply(this, arguments);
      };
      window.__toastEnganchado = true;
    };
    document.addEventListener('DOMContentLoaded', instalar);
    window.addEventListener('load', instalar);
  });
}

// Los avisos que la página ha enseñado desde la última navegación.
export const toastsDe = page => page.evaluate(() => window.__toasts || []);

// Espera a que aparezca un toast que case con `re` y lo devuelve (null si no llega a tiempo).
export async function esperarToast(page, re, timeout = 15000) {
  try {
    await page.waitForFunction(
      (fuente) => (window.__toasts || []).some(t => new RegExp(fuente, 'i').test(t.msg)),
      { timeout }, re.source);
  } catch { return null; }
  const todos = await toastsDe(page);
  return todos.find(t => re.test(t.msg)) || null;
}

// ── EL CÓDIGO DE DISCO TIENE QUE SER EL QUE SE ESTÁ SIRVIENDO ────────────────────────────────────
//
// NACE DE UN FALLO REAL (18 ago 2026) y su único trabajo es que no se repita. Los gates apuntan a
// :3000, que es EXACTAMENTE el proceso que Caddy proxya al público (reverse_proxy 127.0.0.1:3000):
// no hay instancia de laboratorio. Pero eso no basta, porque Node carga los módulos AL ARRANCAR:
// si se edita un fichero y no se reinicia el servicio, el gate prueba el código VIEJO y da verde —
// y ese verde se apunta en un commit que contiene código que nadie ha ejecutado. La pantalla real
// sigue igual y el TABLERO dice "hecho".
//
// Así que antes de abrir el navegador se compara el fichero MÁS NUEVO de la aplicación con el
// arranque del proceso. Si el proceso es más viejo, el gate ABORTA (código 2, "no ha verificado
// NADA") y dice qué hay que hacer. No avisa: corta.
function ficheroMasNuevo() {
  const dirs = ['modules', 'core', 'index.js'];
  let max = 0, cual = '';
  const mirar = (ruta) => {
    let st; try { st = statSync(ruta); } catch { return; }
    if (st.isDirectory()) { for (const f of readdirSync(ruta)) mirar(join(ruta, f)); return; }
    if (!/\.(js|mjs)$/.test(ruta)) return;
    if (st.mtimeMs > max) { max = st.mtimeMs; cual = ruta; }
  };
  for (const d of dirs) mirar(join(APP_DIR, d));
  return { ms: max, fichero: cual.replace(APP_DIR + '/', '') };
}

export function exigeCodigoServido() {
  let arranque;
  try {
    const salida = execSync('systemctl show bamburu -p ActiveEnterTimestamp --value', { encoding: 'utf8' }).trim();
    arranque = Date.parse(salida);
  } catch { return; }                       // sin systemd (otra máquina): no se estorba
  if (!arranque || Number.isNaN(arranque)) return;
  const nuevo = ficheroMasNuevo();
  if (!nuevo.ms) return;
  // Un margen de 2 s: `systemctl restart` devuelve en cuanto el proceso arranca y los relojes de
  // mtime y de systemd no tienen por qué cuadrar al milisegundo.
  if (nuevo.ms > arranque + 2000) {
    abortar(
      'EL PROCESO NO ESTÁ SIRVIENDO EL CÓDIGO DE DISCO.',
      'El servicio arrancó el ' + new Date(arranque).toISOString() + ' y ' + nuevo.fichero +
      ' se tocó el ' + new Date(nuevo.ms).toISOString() + '.\n' +
      '  Node carga los módulos al arrancar: este gate probaría el código VIEJO y daría un verde falso.\n' +
      '  Reinicia y vuelve a lanzarlo:  sudo systemctl restart bamburu');
  }
}

// Opciones de lanzamiento comunes. Se esparcen sobre las de cada gate: launch({ ...launchOpts(), ... }).
// Aquí se exige, de paso, que lo que se va a probar sea lo que hay escrito: NINGÚN gate de navegador
// puede saltarse la comprobación, porque todos pasan por aquí.
export function launchOpts() {
  if (!existsSync(CHROMIUM)) {
    abortar('No hay Chromium ejecutable en: ' + CHROMIUM,
            'Instálalo (snap install chromium) o apunta PUPPETEER_EXECUTABLE_PATH a uno que funcione.');
  }
  exigeCodigoServido();
  return { headless: 'new', executablePath: CHROMIUM, args: ['--no-sandbox'] };
}
