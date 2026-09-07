#!/usr/bin/env node
// Gate — el servidor CIERRA las bases de negocio que ya no sirven.
//
// Ficha `conexiones-que-no-se-cierran` (7 sep 2026). Hasta ese día `core/tenant-middleware.js`
// guardaba cada conexión en un `Map` y no la soltaba jamás: un barrido completo dejaba **92
// conexiones a ficheros de base ya borrados**, y el 6 de septiembre eso tumbó el acceso al panel
// entero.
//
// Mide las DOS formas de que una conexión deje de servir, y las mide de verdad —creando bases,
// borrándolas por debajo y provocando el huerfanato con otro proceso—, no por nombres ni por
// búsqueda de texto:
//
//   [1] LA BASE DESAPARECE  → la conexión se cierra sola.        (es lo que arregla los 92)
//   [2] LA CONEXIÓN SE VUELVE RANCIA → se detecta y se REABRE.   (es el fallo de sesión del 6 sep)
//
// Y de cada una hace su ROJO PROVOCADO: desactiva el arreglo y exige que la comprobación CAIGA.
// Una comprobación que no ha fallado nunca no vale.
//
//   node scripts/gate-conexiones-que-se-cierran.mjs

import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { censoDelServicio } from './censo-conexiones-bases.mjs';

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BANCO = mkdtempSync(path.join(tmpdir(), 'gate-conexiones-'));
const COPIAS = [];            // módulos temporales con el arreglo desactivado, a borrar en el finally
let pass = 0, fail = 0;

const ok = (cond, txt, detalle = '') => {
  if (cond) { pass++; console.log(`  ✓ ${txt}`); }
  else { fail++; console.log(`  ✗ ${txt}${detalle ? ' — ' + detalle : ''}`); }
};

// Un negocio de mentira con su base en el banco. Fuera de `data/tenants/`, así que el punto único
// la abre SIN llave: esta comprobación no necesita el cifrado para nada.
let n = 0;
const negocio = () => { const slug = `gate-conex-${process.pid}-${++n}`; return { slug, id: 9000 + n, db_filename: path.join(BANCO, slug + '.db') }; };

// OTRO PROCESO escribe una fila en la base. Es la mitad honesta de la prueba: sirve para provocar
// el huerfanato y, después, para comprobar que la conexión reabierta vuelve a enterarse.
function escribirDesdeOtroProceso(ruta) {
  const guion = path.join(BANCO, 'otro-proceso.mjs');
  writeFileSync(guion, `
import Database from ${JSON.stringify(path.join(RAIZ, 'core/sqlite-bamburu/indice.cjs'))};
const d = new Database(${JSON.stringify(ruta)});
d.pragma('journal_mode = WAL');
d.exec('CREATE TABLE IF NOT EXISTS huella_del_gate (x)');
d.prepare('INSERT INTO huella_del_gate VALUES (77)').run();
d.close();
`);
  execFileSync(process.execPath, [guion], { stdio: 'pipe' });
}

// Provoca el huerfanato EXACTAMENTE como pasó de verdad: se borra el diario por debajo y otro
// proceso lo vuelve a crear. La conexión vieja se queda sujetando un fichero que ya no es el del
// disco, y deja de ver lo que escriben los demás.
function huerfanar(ruta) {
  for (const s of ['-wal', '-shm']) { try { rmSync(ruta + s, { force: true }); } catch {} }
  escribirDesdeOtroProceso(ruta);
}

// Carga una copia de tenant-middleware.js con una parte del arreglo DESACTIVADA. Va al lado del
// original (mismo directorio) para que sus importaciones relativas sigan resolviendo.
async function middlewareSinArreglo(etiqueta, romper) {
  const fuente = readFileSync(path.join(RAIZ, 'core/tenant-middleware.js'), 'utf8');
  const roto = romper(fuente);
  if (roto === fuente) throw new Error(`el rojo provocado «${etiqueta}» no cambió nada: el parche ya no encaja`);
  const destino = path.join(RAIZ, `core/.rojo-provocado-${etiqueta}-${process.pid}.js`);
  writeFileSync(destino, roto);
  COPIAS.push(destino);
  return import(destino + `?v=${Date.now()}`);
}

try {
  const M = await import('../core/tenant-middleware.js');

  // ── [1] LA BASE DESAPARECE ────────────────────────────────────────────────────────────────────
  console.log('\n[1] cuando la base desaparece, la conexión se cierra');
  {
    const t = negocio();
    M.getTenantDb(t);
    ok(M.censoConexiones().detalle.some(d => d.slug === t.slug), 'la conexión queda en el caché al abrir');

    for (const s of ['', '-wal', '-shm']) rmSync(t.db_filename + s, { force: true });
    ok(M.censoConexiones().detalle.find(d => d.slug === t.slug)?.estado === 'muerta',
       'el censo la ve MUERTA en cuanto el fichero deja de existir');

    const cerradas = M.repasarConexiones();
    ok(cerradas.muertas >= 1, 'el repaso la cierra', `cerró ${cerradas.muertas}`);
    ok(!M.censoConexiones().detalle.some(d => d.slug === t.slug), 'y desaparece del caché');
    ok(M.censoConexiones().muertas === 0, 'el censo queda a CERO muertas', `quedan ${M.censoConexiones().muertas}`);
  }

  // ── [2] LA CONEXIÓN SE VUELVE RANCIA ──────────────────────────────────────────────────────────
  console.log('\n[2] cuando la conexión se vuelve rancia, se detecta y se REABRE');
  {
    const t = negocio();
    const antes = M.getTenantDb(t);
    antes.exec('CREATE TABLE IF NOT EXISTS huella_del_gate (x)');
    antes.pragma('wal_checkpoint(TRUNCATE)');
    antes.prepare('SELECT count(*) c FROM huella_del_gate').get();

    huerfanar(t.db_filename);

    ok(M.censoConexiones().detalle.find(d => d.slug === t.slug)?.estado === 'rancia',
       'el censo la ve RANCIA (la base vive, su diario murió debajo)');

    // El síntoma real, antes de arreglarlo: la conexión vieja NO ve lo que escribió el otro proceso.
    let veVieja = -1;
    try { veVieja = antes.prepare('SELECT count(*) c FROM huella_del_gate').get().c; } catch {}
    ok(veVieja === 0, 'la conexión rancia NO ve la fila del otro proceso (es el síntoma del 6 sep)', `ve ${veVieja}`);

    const despues = M.getTenantDb(t);
    ok(despues !== antes, 'al volver a pedirla, devuelve una conexión NUEVA (la ha reabierto)');
    ok(M.censoConexiones().detalle.find(d => d.slug === t.slug)?.estado === 'sana',
       'y la nueva nace SANA');
    ok(M.censoConexiones().rancias === 0, 'el censo queda a CERO rancias', `quedan ${M.censoConexiones().rancias}`);

    // LA RECUPERACIÓN, medida donde se puede medir. **No se le exige a la conexión nueva que vea la
    // fila que se escribió MIENTRAS estaba huérfana**: eso ya no existe. Medido el 7 sep aislando el
    // caso: si una conexión está ABIERTA cuando le borran el diario por debajo, lo que escriba otro
    // proceso a partir de ahí SE PIERDE, y sigue perdido aunque después se cierre y se reabra
    // (0 filas de 1); con la conexión CERRADA antes del huerfanato no se pierde nada (1 de 1).
    // Exigirle que la vea sería exigir lo imposible. Lo que sí se exige —y es lo que dice si el
    // arreglo sirve— es que **a partir de ahora vuelva a enterarse de lo que hacen los demás**.
    escribirDesdeOtroProceso(t.db_filename);        // otro proceso escribe, SIN volver a huerfanar
    const veNueva = despues.prepare('SELECT count(*) c FROM huella_del_gate').get().c;
    ok(veNueva >= 1, 'y a partir de ahí SÍ ve lo que escriben los demás procesos: se ha recuperado', `ve ${veNueva}`);
    M.cerrarTenant(t.slug);
  }

  // ── [3] CADUCIDAD, TOPE Y CIERRE ORDENADO ─────────────────────────────────────────────────────
  console.log('\n[3] caducidad por inactividad, tope y cierre ordenado');
  {
    const t = negocio();
    M.getTenantDb(t);
    // Sin tocar el reloj del sistema: se le pide al repaso que crea que han pasado dos horas.
    const cerradas = M.repasarConexiones({ ahora: Date.now() + 2 * 60 * 60 * 1000 });
    ok(cerradas.caducadas >= 1, 'una conexión sin usar 2 h se cierra por inactividad', `caducadas ${cerradas.caducadas}`);
    ok(!M.censoConexiones().detalle.some(d => d.slug === t.slug), 'y sale del caché');

    ok(typeof M.cerrarBasesDeNegocio === 'function', 'existe el cierre ordenado de las bases al parar');
    const t2 = negocio(); M.getTenantDb(t2);
    ok(M.cerrarBasesDeNegocio() >= 1, 'el cierre ordenado cierra lo que quedaba abierto');
    ok(M.censoConexiones().abiertas === 0, 'y deja el caché vacío');
  }

  // ── [4] ROJO PROVOCADO · quitando el CIERRE ───────────────────────────────────────────────────
  console.log('\n[4] ROJO PROVOCADO — sin el cierre, [1] tiene que caer');
  {
    const R = await middlewareSinArreglo('cierre', f =>
      f.replace('function retirar(slug, motivo, { yaMismo = false } = {}) {\n  const e = tenantConnections.get(slug);',
                'function retirar(slug, motivo, { yaMismo = false } = {}) {\n  if (process.env.GATE_SIN_CIERRE) return false;   // ← arreglo desactivado a propósito\n  const e = tenantConnections.get(slug);'));
    process.env.GATE_SIN_CIERRE = '1';
    const t = negocio();
    R.getTenantDb(t);
    for (const s of ['', '-wal', '-shm']) rmSync(t.db_filename + s, { force: true });
    R.repasarConexiones();
    const quedan = R.censoConexiones().muertas;
    ok(quedan >= 1, 'sin el cierre, la conexión a la base borrada SE QUEDA (la comprobación [1] cae)', `quedan ${quedan}`);
    delete process.env.GATE_SIN_CIERRE;
  }

  // ── [5] ROJO PROVOCADO · quitando la DETECCIÓN DE RANCIA ──────────────────────────────────────
  console.log('\n[5] ROJO PROVOCADO — sin la detección de rancia, [2] tiene que caer');
  {
    const R = await middlewareSinArreglo('rancia', f =>
      f.replace('export function estadoDeConexion(e) {',
                'export function estadoDeConexion(e) {\n  if (process.env.GATE_SIN_RANCIA) return \'sana\';   // ← arreglo desactivado a propósito'));
    process.env.GATE_SIN_RANCIA = '1';
    const t = negocio();
    const antes = R.getTenantDb(t);
    antes.exec('CREATE TABLE IF NOT EXISTS huella_del_gate (x)');
    antes.pragma('wal_checkpoint(TRUNCATE)');
    antes.prepare('SELECT count(*) c FROM huella_del_gate').get();
    huerfanar(t.db_filename);

    ok(R.censoConexiones().rancias === 0,
       'sin la detección, el censo dice CERO rancias teniendo una (la comprobación [2] cae por el censo)');
    const despues = R.getTenantDb(t);
    ok(despues === antes, 'y devuelve la MISMA conexión rancia en vez de reabrirla');
    const ve = despues.prepare('SELECT count(*) c FROM huella_del_gate').get().c;
    ok(ve === 0, 'que sigue sin ver la fila del otro proceso: el fallo de sesión, otra vez', `ve ${ve}`);
    delete process.env.GATE_SIN_RANCIA;
  }

  // ── [6] EL SERVICIO VIVO ──────────────────────────────────────────────────────────────────────
  console.log('\n[6] el servicio vivo, medido en /proc');
  {
    const c = censoDelServicio();
    if (!c) { console.log('  · bamburu.service no está en marcha — no se mide'); }
    else {
      console.log(`  · ${c.abiertas} bases abiertas · 🟢 ${c.sanas} sanas · 🔴 ${c.muertas} muertas · 🟠 ${c.rancias} rancias`);
      ok(c.muertas === 0, 'el servicio no sostiene ninguna base BORRADA', `sostiene ${c.muertas}`);
      ok(c.rancias === 0, 'el servicio no sostiene ninguna conexión RANCIA', `sostiene ${c.rancias}`);
    }
  }
} finally {
  for (const f of COPIAS) { try { rmSync(f, { force: true }); } catch {} }
  try { rmSync(BANCO, { recursive: true, force: true }); } catch {}
  delete process.env.GATE_SIN_CIERRE;
  delete process.env.GATE_SIN_RANCIA;
}

console.log(`\nRESULTADO: ${pass} ✓ · ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
