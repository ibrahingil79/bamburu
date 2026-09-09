#!/usr/bin/env node
// gate-barrera-permisos.mjs — que el portero de permisos de verdad impida arrancar con una
// regresión, y de verdad deje pasar una mejora. Tarea `barrera-de-permisos` (8 sep 2026).
//
// ⚠️ QUÉ MIDE, Y CÓMO. Lanza `index.js` DE VERDAD como hijo — es la única forma honesta de probar
// algo que vive dentro de `index.js`, entre el último `route()` y `serve()` — pero en un PUERTO
// PROPIO (nunca 3000, el del servicio real) y con el Telegram apagado (mismo cuidado que
// `censo-permisos-rutas.mjs`: un gate es lectura, no puede despertar a nadie). Cada escenario
// PARCHEA un fichero real durante segundos y lo devuelve en el `finally`, aunque el hijo reviente:
// dejar el árbol tocado sería peor que el propio rojo que esto busca cazar.
//
// ⚙️ 9 SEP 2026 (`barrera-permisos-contamina-el-barrido`) — DEVOLVER EL CONTENIDO NO BASTA: el
// TEXTO volvía, pero `writeFileSync` adelanta la FECHA de modificación aunque el contenido acabe
// siendo idéntico. Y `scripts/lib/gate-env.mjs` → `exigeCodigoServido()` — la comprueba TODO gate
// de navegador antes de abrir Chromium — decide si el servicio vivo sirve "el código de disco"
// mirando esa fecha: en cuanto este gate tocaba `users.js`/`settings.js`/`index.js`, CUALQUIER gate
// de navegador posterior, en la misma pasada del servicio y sin reiniciar, veía un fichero "más
// nuevo que el arranque" y abortaba — en cascada, sin haber cambiado ni una línea real. Medido el
// 9 sep 2026: de 214 gates del barrido completo, más de 100 abortaron así.
// El arreglo: se guarda también la FECHA original de cada fichero (`statSync`, no solo su
// contenido) y se restaura con `utimesSync` justo después de devolver el texto — el fichero queda
// bit a bit Y minuto a minuto como estaba, no solo legible igual.
//
//   node scripts/gate-barrera-permisos.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, statSync, utimesSync } from 'node:fs';
import { createServer as netServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m, det) => {
  if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); }
  else { fail++; console.error('  ✗ FALLO: ' + m + (det ? ' · ' + det : '')); }
};

async function puertoLibre() {
  return new Promise(res => {
    const s = netServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}

function cargarEntorno() {
  const env = { ...process.env };
  try {
    for (const linea of readFileSync('/etc/bamburu.env', 'utf8').split('\n')) {
      const m = linea.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (env[m[1]] === undefined) env[m[1]] = v;
    }
  } catch { /* se intenta igual */ }
  env.BAMBURU_TELEGRAM_TOKEN = '';       // un gate no despierta a nadie
  env.BAMBURU_TELEGRAM_CHAT_ID = '';
  return env;
}

/** Arranca `index.js` de verdad, en un puerto propio, y devuelve {codigo, salida}. */
async function arrancar() {
  const env = cargarEntorno();
  env.PORT = String(await puertoLibre());
  // El hijo, si arranca bien, se queda sirviendo para siempre — igual que el servicio real. No hace
  // falta esperar a que muera solo: 4 s de sobra cubren el arranque (~700 ms medidos) y matan al
  // hijo justo después de que haya podido escribir "Bamburu listo" o el motivo de por qué no.
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'index.js')], {
    cwd: RAIZ, encoding: 'utf8', timeout: 4000, env,
  });
  return { codigo: r.status, salida: (r.stdout || '') + (r.stderr || '') };
}

// SNAPSHOT DE VERDAD, NO GIT. `index.js` lleva HOY cambios legítimos sin commitear (esta misma
// tarea). Un `git checkout` de emergencia compararía contra el último commit — que NUNCA tuvo esos
// cambios — y se los llevaría por delante. Se guarda el contenido EXACTO de cada fichero que este
// gate toca, ANTES de tocar nada, y la red de seguridad final restaura A ESO, nunca a HEAD.
// También se guarda su FECHA original (`atime`/`mtime`): el contenido volver no basta si la fecha
// se queda adelantada (ver cabecera del fichero).
const SNAPSHOT = new Map();
function instantaneaDe(fichero) {
  const abs = path.join(RAIZ, fichero);
  if (!SNAPSHOT.has(abs)) {
    const st = statSync(abs);
    SNAPSHOT.set(abs, { texto: readFileSync(abs, 'utf8'), atime: st.atime, mtime: st.mtime });
  }
  return abs;
}
/** Devuelve un fichero snapshot-ado a su contenido Y su fecha originales. */
function restaurar(abs, snap) {
  writeFileSync(abs, snap.texto);
  utimesSync(abs, snap.atime, snap.mtime);
}

/** Parchea un fichero real durante `fn` y lo devuelve tal cual estaba (texto Y fecha), PASE LO QUE PASE. */
async function conParche(fichero, buscar, cambiar, fn) {
  const abs = instantaneaDe(fichero);
  const snap = SNAPSHOT.get(abs);
  if (!snap.texto.includes(buscar)) throw new Error('marcador no encontrado en ' + fichero + ': ' + buscar.slice(0, 60));
  writeFileSync(abs, snap.texto.replace(buscar, cambiar));
  try { return await fn(); }
  finally { restaurar(abs, snap); }
}

try {
  console.log('\n[1] Con la declaración al día, arranca normal');
  {
    const r = await arrancar();
    ok(r.codigo === 0 || /Bamburu listo/.test(r.salida), 'el hijo llega a "Bamburu listo"', 'código ' + r.codigo);
    ok(/Barrera de permisos: la app coincide/.test(r.salida), 'la barrera confirma que coincide con lo declarado');
    if (r.codigo !== 0 && !/Bamburu listo/.test(r.salida)) console.error(r.salida.slice(-800));
  }

  console.log('\n[2] Ruta NUEVA sin declarar → NO arranca, y dice cuál');
  await conParche('index.js',
    "app.all('/admin/disa/*', c => c.redirect('/admin'));",
    "app.all('/admin/disa/*', c => c.redirect('/admin'));\napp.get('/api/erp/__gate_barrera_ruta_nueva', c => c.json({ok:true}));",
    async () => {
      const r = await arrancar();
      ok(r.codigo !== 0, 'el hijo NO llega a arrancar', 'código ' + r.codigo);
      ok(/ruta\(s\) nueva\(s\)/.test(r.salida) && /__gate_barrera_ruta_nueva/.test(r.salida),
         'el mensaje nombra la ruta nueva sin declarar');
    });

  console.log('\n[3] Quitar el permiso a una ruta → NO arranca, y lo dice');
  await conParche('modules/erp/routes/users.js',
    "activityViews.get('/', requirePerm('admin.manage_users'), c => {",
    "activityViews.get('/', c => {",
    async () => {
      const r = await arrancar();
      ok(r.codigo !== 0, 'el hijo NO llega a arrancar', 'código ' + r.codigo);
      ok(/piden AHORA MENOS/.test(r.salida) && /GET \/admin\/activity/.test(r.salida),
         'el mensaje nombra la ruta rebajada y de qué a qué');
    });

  console.log('\n[4] Añadir un permiso a una ruta → arranca, y avisa (no bloquea)');
  await conParche('modules/erp/routes/settings.js',
    "views.get('/', puedeVerAjustes, c => {",
    "views.get('/', requirePerm('company.read'), puedeVerAjustes, c => {",
    async () => {
      const r = await arrancar();
      ok(/Bamburu listo/.test(r.salida), 'el hijo SÍ llega a arrancar', 'código ' + r.codigo);
      ok(/piden AHORA MÁS/.test(r.salida) && /GET \/admin\/settings/.test(r.salida),
         'y avisa de la mejora, sin bloquear');
    });

  console.log('\n[5] ROJO PROVOCADO — sin la barrera, la MISMA rebaja pasa en silencio');
  await conParche('index.js',
    'const veredicto = compararConDeclaracion(app);',
    'const veredicto = { ok: true, avisos: [] };  // gate-barrera-permisos: barrera desactivada a propósito',
    () => conParche('modules/erp/routes/users.js',
      "activityViews.get('/', requirePerm('admin.manage_users'), c => {",
      "activityViews.get('/', c => {",
      async () => {
        const r = await arrancar();
        ok(/Bamburu listo/.test(r.salida), 'CON la barrera desactivada, la rebaja SÍ deja arrancar', 'código ' + r.codigo);
        ok(!/no arranca/i.test(r.salida), 'y no dice una palabra del problema: pasa en silencio');
      }));
} catch (e) {
  fail++; console.error('  ✗ EXCEPCIÓN:', e.message);
} finally {
  // RED DE SEGURIDAD, APARTE DEL `finally` DE CADA `conParche`. Medido el 8 sep 2026, dos veces: un
  // `timeout` EXTERNO que mata al proceso entero no le da tiempo a un `finally` async a terminar de
  // escribir, y ANTES de esto restaurar con `git checkout` se comió cambios legítimos sin commitear
  // de este mismo fichero — comparar contra HEAD está mal cuando HEAD nunca tuvo el trabajo de hoy.
  // Se compara contra la INSTANTÁNEA tomada al principio (`SNAPSHOT`), nunca contra git.
  // Compara TEXTO y también FECHA: un `conParche` que restauró el texto pero murió antes de su
  // propio `utimesSync` (mismo `timeout` externo) dejaría la fecha adelantada igual, y eso es
  // justo lo que revienta el barrido — la red de seguridad tiene que cazar también eso.
  for (const [abs, snap] of SNAPSHOT) {
    let actual = null, st = null;
    try { actual = readFileSync(abs, 'utf8'); st = statSync(abs); } catch { /* fichero no legible: se avisa abajo */ }
    if (actual !== snap.texto || !st || st.mtimeMs !== snap.mtime.getTime()) {
      console.error('  ⚠️ RED DE SEGURIDAD: ' + path.relative(RAIZ, abs) + ' quedó sin revertir (texto o fecha) — restaurando desde la instantánea de este gate (NO desde git)');
      restaurar(abs, snap);
      fail++;
    }
  }
}

console.log('\n' + (fail ? '✗ ' + fail + ' fallos, ' : '') + pass + ' OK');
process.exit(fail ? 1 : 0);
