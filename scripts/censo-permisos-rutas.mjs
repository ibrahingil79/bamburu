#!/usr/bin/env node
// Censo de permisos por ruta — Paso 1 de la tarea `permisos-paso-1-censo-rutas` (7 sep 2026).
//
// ═══ EL MÉTODO DE CONTEO, QUE ES LA MITAD DE LA ENTREGA ═══════════════════════════════════════
//
// La cifra vieja de la ficha («600 de 1.025 rutas sin permiso visible») **no era reproducible**:
// salía de contar con expresiones regulares, y contando sobre el árbol salen 1.995 declaraciones y
// 464 guardas, que no da ni 600 ni 1.025 por ningún camino. El motivo es que **no se puede contar
// rutas leyendo el código**: los routers se llaman `app`, `api`, `sa`, `r`, `router`, `views`,
// `puerta`… (110 objetos `new Hono()`), se anidan con `route()`, y el camino final de una ruta no
// está escrito en ninguna línea — se compone al montar.
//
// **Este censo no cuenta código: le PREGUNTA A LA APLICACIÓN.** Monta Bamburu entera igual que el
// servidor y lee `app.routes`, la tabla interna de Hono, donde cada ruta ya tiene su camino COMPLETO
// resuelto. Es, por definición, la lista de lo que el servidor sirve de verdad.
//
// Tres reglas de conteo, escritas para que cualquiera repita el número:
//
//  1. **Una RUTA es un par (método, camino)** de `app.routes` con método distinto de `ALL`. Las
//     entradas `ALL /algo/*` son MIDDLEWARE (`use`), no rutas: se cuentan aparte y se aplican a las
//     rutas cuyo camino encaja. Contarlas como rutas era una de las formas de inflar la cifra.
//  2. **EL ORDEN DE REGISTRO MANDA.** Un `use()` solo alcanza a lo registrado DESPUÉS de él. Medido
//     el 7 sep 2026 con Hono a mano: una ruta declarada antes del `use('*')` no pasa por él. Es
//     exactamente así como el superadmin deja públicas sus dos pantallas de entrada y protege el
//     resto. **La primera versión de este censo ignoraba el orden**, y por eso daba por guardadas
//     rutas públicas y por públicas rutas guardadas.
//  3. **UNA GUARDA SE RECONOCE POR LO QUE HACE, NO POR SU NOMBRE.** No basta con las cuatro guardas
//     etiquetadas de `core/`: cada módulo tiene las suyas (`superadminAuth`, `apexGuard`,
//     `saCsrf`…). Cuenta como guarda todo middleware cuyo código pueda **negar el paso**: redirigir
//     a una pantalla de entrada, o responder 401 / 403, o llamar a `denegarPermiso`.
//     **La primera versión solo miraba las etiquetas y declaró «sin guarda» las 22 rutas del
//     superadmin** —las que suspenden negocios y lanzan copias—. Se cazó comprobándolas contra el
//     servidor vivo: las 22 redirigen a `/superadmin/login`. Un censo que dice «sin guarda» donde sí
//     la hay es peor que no tener censo, porque cierra la pregunta.
//  4. **Sesión no es permiso.** `adminAuth` solo exige estar dentro. Una ruta con sesión y sin
//     permiso se cuenta en su propia casilla, porque confundir las dos cosas es el agujero que este
//     censo viene a enseñar.
//
// Cada ruta se sirve con su `fichero:línea` REAL, sacada del inspector de Node
// (`[[FunctionLocation]]`), no de una búsqueda de texto: es la posición del manejador que de verdad
// se ejecuta.
//
//   node scripts/censo-permisos-rutas.mjs                    → informe legible
//   node scripts/censo-permisos-rutas.mjs --json <fich>      → el mapa entero, para otra herramienta
//   node scripts/censo-permisos-rutas.mjs --md <fich>        → escribe el inventario en Markdown
//   node scripts/censo-permisos-rutas.mjs --declarar <fich>  → escribe la DECLARACIÓN que compara
//     el arranque (tarea `barrera-de-permisos`, 8 sep 2026) — la ejecuta un humano, nunca el arranque

import { Session } from 'node:inspector/promises';
import path from 'node:path';
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// ⚙️ 8 SEP 2026 (`barrera-de-permisos`) — LA CLASIFICACIÓN (qué exige cada ruta) se mudó a
// `core/mapa-rutas.js`: la necesita también el arranque del servidor, y una clasificación en dos
// copias es la forma exacta en que empiezan a decir cosas distintas. Aquí se queda lo que es solo
// de este script: `localizar()` (el inspector, caro, y solo para el informe humano) y el CLI.
import { clasificarRutas } from '../core/mapa-rutas.js';

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Localiza cada función (fichero:línea) con el inspector. Devuelve un Map fn → 'fichero:línea'. */
async function localizar(funciones) {
  const sesion = new Session();
  sesion.connect();
  const guiones = new Map();
  sesion.on('Debugger.scriptParsed', ({ params }) => guiones.set(params.scriptId, params.url));
  await sesion.post('Debugger.enable');
  globalThis.__censoFns = funciones;
  const sitio = new Map();
  for (let i = 0; i < funciones.length; i++) {
    try {
      const { result } = await sesion.post('Runtime.evaluate', { expression: `globalThis.__censoFns[${i}]` });
      const { internalProperties } = await sesion.post('Runtime.getProperties', { objectId: result.objectId, ownProperties: false });
      const loc = internalProperties?.find(p => p.name === '[[FunctionLocation]]')?.value?.value;
      if (!loc) continue;
      const url = guiones.get(loc.scriptId) || '';
      const f = url.startsWith('file://') ? path.relative(RAIZ, fileURLToPath(url)) : url;
      sitio.set(funciones[i], `${f}:${loc.lineNumber + 1}`);
    } catch { /* alguna función nativa o ya recogida: se queda sin sitio, y se dice */ }
  }
  delete globalThis.__censoFns;
  sesion.disconnect();
  return sitio;
}

/**
 * Carga `/etc/bamburu.env` igual que hace systemd, porque montar Bamburu entera exige sus claves
 * (sin la de Resend, el módulo `erp` no importa y el arranque muere).
 *
 * ⚠️ **Y APAGA EL AVISO A TELEGRAM, a propósito.** La primera pasada de este censo, sin entorno,
 * hizo caer el arranque y **mandó un aviso de verdad al Telegram de Ibrahin**. Un censo es una
 * herramienta de lectura: no puede despertar a nadie. Sin credenciales, la puerta común no manda.
 */
function cargarEntorno() {
  try {
    for (const linea of readFileSync('/etc/bamburu.env', 'utf8').split('\n')) {
      const m = linea.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  } catch { /* sin entorno se intenta igual, y el fallo se verá */ }
  process.env.BAMBURU_TELEGRAM_TOKEN = '';
  process.env.BAMBURU_TELEGRAM_CHAT_ID = '';
}

/**
 * Un puerto libre de verdad. **No vale `PORT=0`**: `index.js` hace `Number(process.env.PORT) || 3000`
 * y `0` es falso, así que caía al 3000 — el del servicio vivo — y el censo intentaba robarle el
 * puerto a producción (EADDRINUSE). Se pide uno al sistema y se suelta antes de usarlo.
 */
async function puertoLibre() {
  const { createServer } = await import('node:net');
  return new Promise(res => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}

export async function censar() {
  cargarEntorno();
  if (!Number(process.env.PORT)) process.env.PORT = String(await puertoLibre());
  const { app } = await import(path.join(RAIZ, 'index.js'));

  // Localizar TODAS las funciones implicadas, de una vez — la parte cara, solo para este informe.
  const fns = [...new Set(app.routes.map(e => e.handler))].filter(f => typeof f === 'function');
  const sitio = await localizar(fns);

  return clasificarRutas(app, sitio);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const c = await censar();
  // A FICHERO, no por pantalla: montar Bamburu escribe sus propios mensajes de arranque en la
  // salida estándar y se mezclan con el JSON. Se intentó filtrar y salía cortado.
  const j = process.argv.indexOf('--json');
  if (j !== -1) {
    const destino = process.argv[j + 1] && !process.argv[j + 1].startsWith('--') ? process.argv[j + 1] : null;
    if (!destino) { console.error('  --json necesita un fichero de destino'); process.exit(2); }
    writeFileSync(destino, JSON.stringify(c, null, 2));
    console.error(`  mapa escrito: ${destino} (${c.total} rutas)`);
    process.exit(0);
  }
  const md = process.argv.indexOf('--md');
  if (md !== -1 && process.argv[md + 1]) {
    const L = [];
    L.push('| Método | Ruta | Exige | Dónde está |');
    L.push('|---|---|---|---|');
    for (const r of c.rutas) {
      const exige = r.permisos.length ? '`' + r.permisos.join('` + `') + '`'
                  : r.porDentro.length ? 'por dentro: ' + r.porDentro.join(', ')
                  : r.sesion ? 'solo sesión' : '— **nada**';
      L.push(`| ${r.metodo} | \`${r.camino}\` | ${exige} | \`${r.donde}\` |`);
    }
    writeFileSync(process.argv[md + 1], L.join('\n') + '\n');
    console.error(`  inventario escrito: ${process.argv[md + 1]} (${c.total} rutas)`);
  }
  // ⚙️ 8 SEP 2026 (`barrera-de-permisos`) — la DECLARACIÓN que compara el arranque real. La escribe
  // un humano a mano, ejecutando esto, después de mirar lo que cambió — nunca el propio arranque.
  //
  // `pendiente_revisar` en las de «solo sesión»/«sin guarda» que NO son de la propia cuenta: es el
  // juicio de `permisos-por-ruta.md` (7 sep 2026) llevado adelante por patrón de camino, no
  // reverificado ruta a ruta hoy. **Declarar no es aprobar** — sigue siendo la pregunta de la tarea
  // `cerrar-las-38-rutas-abiertas`, no una respuesta.
  const PROPIA_CUENTA = [
    /^\/admin$/,                                                // el Inicio: lo ve cualquiera con sesión
    /^\/(admin\/)?(login|logout|change-password|forgot-password|reset-password)(\/|$|\?)/,
    /^\/admin\/(perfil|avisos|security|setup-2fa|confirm-2fa|disable-2fa|verify-2fa)(\/|$)/,
    /^\/api\/erp\/(perfil|avisos)(\/|$)/,
    /^\/admin\/fichaje$/, /^\/api\/erp\/fichaje$/,
    /^\/api\/erp\/fichaje\/(entrar|salir|estado)(\/|$)/,      // el PROPIO fichaje; /historial/:userId es de otro
    /^\/api\/erp\/(inicio|menu)\/orden(\/|$)/,                 // cómo ordena SU Inicio y SU menú
    /^\/portal(\/|$)/,                                          // el cliente, con su propio enlace
    /^\/reserva(\/|$)/,                                         // reserva pública, con el suyo
    /^\/(acceso|registro|find-tenant)(\/|$)/,
    /^\/api\/registro(\/|$)/,
    /^\/(favicon|docs)/,
    /^\/superadmin\/login$/,
    /^\/stripe\/webhook$/,
    /^\/admin\/autologin$/,
    /^\/$/,
  ];
  const declarar = process.argv.indexOf('--declarar');
  if (declarar !== -1 && process.argv[declarar + 1]) {
    const rutas = {};
    for (const r of c.rutas) {
      const clave = r.metodo + ' ' + r.camino;
      const fila = { veredicto: r.veredicto };
      if (r.permisos.length) fila.permisos = r.permisos;
      if ((r.veredicto === 'solo sesion' || r.veredicto === 'sin guarda')
          && !PROPIA_CUENTA.some(re => re.test(r.camino))) {
        fila.pendiente_revisar = true;
      }
      rutas[clave] = fila;
    }
    const declaracion = {
      generado_en: new Date().toISOString(),
      generado_por: 'node scripts/censo-permisos-rutas.mjs --declarar',
      total_rutas: c.total,
      rutas,
    };
    writeFileSync(process.argv[declarar + 1], JSON.stringify(declaracion, null, 2) + '\n');
    const pendientes = Object.values(rutas).filter(r => r.pendiente_revisar).length;
    console.error(`  declaración escrita: ${process.argv[declarar + 1]} (${c.total} rutas, ${pendientes} pendientes de revisar)`);
  }
  console.log(`\nCENSO DE PERMISOS POR RUTA\n`);
  console.log(`  entradas en la tabla de Hono : ${c.entradasEnLaTabla}   (una por manejador)`);
  console.log(`  de ellas, middleware (use)   : ${c.middleware}`);
  console.log(`  RUTAS (método + camino)      : ${c.total}\n`);
  console.log(`    🔐 exigen un permiso con nombre : ${String(c.conPermiso).padStart(4)}`);
  console.log(`    🔎 lo comprueban por dentro     : ${String(c.porDentro).padStart(4)}`);
  console.log(`    👤 solo exigen SESIÓN           : ${String(c.soloSesion).padStart(4)}`);
  console.log(`    ⚠️  sin guarda ninguna           : ${String(c.sinGuarda).padStart(4)}\n`);
  process.exit(0);
}
