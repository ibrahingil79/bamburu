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
import { existsSync } from 'fs';
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

// El Chromium que trae puppeteer NO arranca en este servidor (ARM): "Syntax error: newline
// unexpected". Hay que usar el de snap. Se puede forzar otro con PUPPETEER_EXECUTABLE_PATH.
export const CHROMIUM = process.env.PUPPETEER_EXECUTABLE_PATH || '/snap/bin/chromium';

// Opciones de lanzamiento comunes. Se esparcen sobre las de cada gate: launch({ ...launchOpts(), ... }).
export function launchOpts() {
  if (!existsSync(CHROMIUM)) {
    abortar('No hay Chromium ejecutable en: ' + CHROMIUM,
            'Instálalo (snap install chromium) o apunta PUPPETEER_EXECUTABLE_PATH a uno que funcione.');
  }
  return { headless: 'new', executablePath: CHROMIUM, args: ['--no-sandbox'] };
}
