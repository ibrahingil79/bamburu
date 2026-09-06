#!/usr/bin/env node
// ═════════════════════════════════════════════════════════════════════════════════════════════════
// cifrar-bases-en-reposo.mjs — pasa a cifrado las bases que hoy están en claro. BASE A BASE.
//
// EL ORDEN NO ES UNA RECOMENDACIÓN, ES EL PRODUCTO. Por cada base, y sin saltarse ni un paso:
//
//   1 · censo de la base en claro (integrity_check + esquema + huella de contenido tabla a tabla)
//   2 · COPIA CONSISTENTE previa, con la API de copia de SQLite (nunca un `cp`: el WAL lleva las
//       escrituras recientes y una copia en crudo se las deja) — y se VERIFICA abriéndola y
//       comparando su censo con el de la original
//   3 · se cifra SOBRE LA COPIA, jamás sobre la original
//   4 · se abre la copia CON LA LLAVE: integrity_check + censo idéntico al de la original
//   5 · y SOLO ENTONCES se sustituye: la original en claro se APARTA (no se borra) y la cifrada
//       ocupa su sitio, con permisos 600
//   6 · se vuelve a abrir ya colocada, por el camino normal, y se comprueba otra vez
//
// SI UNA FALLA, SE PARA Y SE DICE CUÁL. No se sigue con la siguiente: media docena de bases medio
// migradas es un estado del que no se sale leyendo un registro.
//
// LAS ORIGINALES NO SE DESTRUYEN. Se apartan igual que las bases fantasma del 4 sep 2026: una
// carpeta FUERA de `data/`, con su LEEME y las huellas SHA-256 de cada fichero. Borrarlas de verdad
// es una segunda decisión, y es de Ibrahin.
//
//   node scripts/cifrar-bases-en-reposo.mjs              # simulacro: dice qué haría y no toca nada
//   node scripts/cifrar-bases-en-reposo.mjs --hazlo      # lo hace
//   node scripts/cifrar-bases-en-reposo.mjs --estado     # ¿cuáles están cifradas y cuáles no?
// ═════════════════════════════════════════════════════════════════════════════════════════════════
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
const DIR_DATOS = path.join(RAIZ, 'data');
const DIR_NEGOCIOS = path.join(DIR_DATOS, 'tenants');
const FECHA = new Date().toISOString().slice(0, 10);
const APARTADAS = path.join(os.homedir(), 'bases-retiradas', FECHA + '-en-claro-antes-de-cifrar');

const args = process.argv.slice(2);
const HAZLO = args.includes('--hazlo');
const SOLO_ESTADO = args.includes('--estado');

// ── Utilidades ───────────────────────────────────────────────────────────────────────────────────

const enClaro = ruta => {
  try { return fs.readFileSync(ruta, { length: 16 }).subarray(0, 15).toString('latin1') === 'SQLite format 3'; }
  catch { return false; }
};

const sha = ruta => createHash('sha256').update(fs.readFileSync(ruta)).digest('hex');

/** Las bases vivas del sistema, en el orden en que se migran: los negocios primero, control.db al
 *  final. Si algo se tuerce a mitad, `control.db` —el índice que enruta— es lo último que cambia. */
function basesVivas() {
  const lista = [];
  if (fs.existsSync(path.join(DIR_NEGOCIOS)))
    for (const f of fs.readdirSync(DIR_NEGOCIOS).filter(f => f.endsWith('.db')).sort())
      lista.push(path.join(DIR_NEGOCIOS, f));
  const control = path.join(DIR_DATOS, 'control.db');
  if (fs.existsSync(control)) lista.push(control);
  return lista;
}

/**
 * EL CENSO DE UNA BASE — lo que se compara antes y después.
 *
 * No basta con `integrity_check`: responde `ok` a cualquier base sana, **aunque sea otra**. Es la
 * misma lección que ya está escrita en `scripts/bamburu-backup.sh`, medida sustituyendo el fichero
 * descargado por el de otro negocio y viendo pasar el verde.
 *
 * Así que el censo mira el CONTENIDO: el esquema entero, y por cada tabla el número de filas y una
 * huella de todas sus filas. La huella se hace ordenando las filas ya serializadas, no por `rowid`:
 * hay tablas `WITHOUT ROWID` y el orden físico puede cambiar al cifrar (que reescribe el fichero
 * entero). Lo que tiene que ser idéntico es el CONJUNTO de filas, no su colocación.
 */
function censar(db) {
  const esquema = db.prepare(
    "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
  ).all();
  const tablas = esquema.filter(o => o.type === 'table').map(o => o.name);

  const porTabla = {};
  for (const t of tablas) {
    let filas;
    try { filas = db.prepare('SELECT * FROM "' + t.replace(/"/g, '""') + '"').all(); }
    catch (e) { porTabla[t] = { error: e.message }; continue; }
    const serializadas = filas.map(f => JSON.stringify(
      Object.keys(f).sort().map(k => {
        const v = f[k];
        return [k, Buffer.isBuffer(v) ? 'b64:' + v.toString('base64') : v];
      })
    )).sort();
    const h = createHash('sha256');
    for (const s of serializadas) h.update(s).update('\n');
    porTabla[t] = { filas: filas.length, huella: h.digest('hex') };
  }

  const total = Object.values(porTabla).reduce((a, v) => a + (v.filas || 0), 0);
  const huellaGlobal = createHash('sha256')
    .update(JSON.stringify(esquema))
    .update(JSON.stringify(porTabla))
    .digest('hex');

  return { tablas: tablas.length, filas: total, porTabla, esquema, huella: huellaGlobal };
}

/** Dice EN QUÉ se diferencian dos censos, con nombres — no un «no coinciden» a secas. */
function diferencias(a, b) {
  const d = [];
  if (a.tablas !== b.tablas) d.push(`nº de tablas: ${a.tablas} → ${b.tablas}`);
  if (JSON.stringify(a.esquema) !== JSON.stringify(b.esquema)) d.push('el esquema no es idéntico');
  const nombres = new Set([...Object.keys(a.porTabla), ...Object.keys(b.porTabla)]);
  for (const t of nombres) {
    const x = a.porTabla[t], y = b.porTabla[t];
    if (!x) { d.push(`tabla «${t}» aparece de la nada`); continue; }
    if (!y) { d.push(`tabla «${t}» ha desaparecido`); continue; }
    if (x.error || y.error) { d.push(`tabla «${t}»: ${x.error || y.error}`); continue; }
    if (x.filas !== y.filas) d.push(`tabla «${t}»: ${x.filas} filas → ${y.filas}`);
    else if (x.huella !== y.huella) d.push(`tabla «${t}»: mismas ${x.filas} filas pero el contenido cambia`);
  }
  return d;
}

const integridad = db => {
  const r = db.pragma('integrity_check');
  return r.length === 1 && r[0].integrity_check === 'ok' ? null : JSON.stringify(r).slice(0, 200);
};

// ── Estado ───────────────────────────────────────────────────────────────────────────────────────

function estado() {
  const l = Database.hayLlave();
  console.log('LLAVE');
  console.log('  fichero ......... ' + Database.FICHERO_LLAVE);
  console.log('  disponible ...... ' + (l.hay ? 'sí' : 'NO — ' + l.motivo));
  console.log('  cifrado ......... ' + Database.CIFRADO.cipher + ', kdf_iter ' + Database.CIFRADO.kdf_iter);
  console.log('\nBASES VIVAS');
  let claras = 0, cifradas = 0;
  for (const ruta of basesVivas()) {
    const rel = path.relative(RAIZ, ruta);
    const claro = enClaro(ruta);
    if (claro) claras++; else cifradas++;
    const wal = fs.existsSync(ruta + '-wal') ? ` (+wal ${(fs.statSync(ruta + '-wal').size / 1024).toFixed(0)}K)` : '';
    console.log(`  ${claro ? '⚠️  EN CLARO' : '🔒 cifrada '}  ${rel.padEnd(42)} ${(fs.statSync(ruta).size / 1024).toFixed(0).padStart(6)}K${wal}`);
  }
  console.log(`\n  ${cifradas} cifradas · ${claras} en claro`);
  return claras;
}

// ── La migración de UNA base ─────────────────────────────────────────────────────────────────────

async function migrarUna(ruta, llave) {
  const rel = path.relative(RAIZ, ruta);
  console.log(`\n── ${rel}`);

  if (!enClaro(ruta)) { console.log('   ya está cifrada — no se toca'); return { saltada: true }; }

  const trabajo = fs.mkdtempSync(path.join(os.tmpdir(), 'cifrar-'));
  const copiaClara = path.join(trabajo, path.basename(ruta, '.db') + '.claro.db');
  const copiaCifrada = path.join(trabajo, path.basename(ruta, '.db') + '.cifrada.db');
  const limpiar = () => { try { fs.rmSync(trabajo, { recursive: true, force: true }); } catch (_) {} };

  try {
    // 1 · censo de la original
    let censoOriginal, tam;
    {
      const d = new Database(ruta, { readonly: true, fileMustExist: true, bamburuSinLlave: true });
      try {
        const mal = integridad(d);
        if (mal) throw new Error('la base EN CLARO ya venía mal: integrity_check => ' + mal);
        censoOriginal = censar(d);
      } finally { d.close(); }
      tam = fs.statSync(ruta).size;
      console.log(`   1) censo: ${censoOriginal.tablas} tablas · ${censoOriginal.filas} filas · integrity_check ok`);
    }

    // 2 · copia consistente previa, y se verifica
    {
      const d = new Database(ruta, { readonly: true, fileMustExist: true, bamburuSinLlave: true });
      try { await d.backup(copiaClara); } finally { d.close(); }
      const c = new Database(copiaClara, { readonly: true, fileMustExist: true, bamburuSinLlave: true });
      try {
        const mal = integridad(c);
        if (mal) throw new Error('la copia previa no pasa integrity_check => ' + mal);
        const dif = diferencias(censoOriginal, censar(c));
        if (dif.length) throw new Error('la copia previa NO tiene el mismo contenido:\n      · ' + dif.join('\n      · '));
      } finally { c.close(); }
      console.log(`   2) copia previa consistente verificada (${(fs.statSync(copiaClara).size / 1024).toFixed(0)}K, mismo contenido)`);
    }

    // 3 · se cifra SOBRE LA COPIA
    {
      fs.copyFileSync(copiaClara, copiaCifrada);
      fs.chmodSync(copiaCifrada, 0o600);
      const d = new Database(copiaCifrada, { fileMustExist: true, bamburuSinLlave: true });
      try { Database.cifrarEnElSitio(d, llave); } finally { d.close(); }
      if (enClaro(copiaCifrada)) throw new Error('tras cifrar, el fichero SIGUE siendo SQLite en claro');
      console.log('   3) cifrada sobre la copia — la cabecera ya no es SQLite en claro');
    }

    // 4 · se abre la cifrada con la llave y se compara
    {
      const d = new Database(copiaCifrada, { readonly: true, fileMustExist: true, bamburuLlave: llave });
      try {
        const mal = integridad(d);
        if (mal) throw new Error('la copia cifrada no pasa integrity_check => ' + mal);
        const dif = diferencias(censoOriginal, censar(d));
        if (dif.length) throw new Error('la copia cifrada NO tiene el mismo contenido:\n      · ' + dif.join('\n      · '));
      } finally { d.close(); }
      // Y que sin llave NO se lea, que es de lo que va todo esto.
      let seLeyo = false;
      try {
        const s = new Database(copiaCifrada, { readonly: true, fileMustExist: true, bamburuSinLlave: true });
        try { s.prepare('SELECT count(*) FROM sqlite_master').get(); seLeyo = true; } finally { s.close(); }
      } catch (_) { /* lo esperado */ }
      if (seLeyo) throw new Error('la copia «cifrada» se puede leer SIN llave');
      console.log('   4) con llave: integrity_check ok y mismo contenido · sin llave: no se abre');
    }

    if (!HAZLO) { console.log('   5) SIMULACRO: aquí se sustituiría. No se ha tocado nada.'); limpiar(); return { simulacro: true }; }

    // 5 · sustituir: la original se APARTA, la cifrada ocupa su sitio
    {
      fs.mkdirSync(APARTADAS, { recursive: true });
      fs.chmodSync(APARTADAS, 0o700);
      const huellas = [];
      for (const suf of ['', '-wal', '-shm']) {
        const orig = ruta + suf;
        if (!fs.existsSync(orig)) continue;
        const destino = path.join(APARTADAS, path.basename(orig));
        fs.renameSync(orig, destino);
        fs.chmodSync(destino, 0o600);
        huellas.push({ fichero: path.basename(orig), bytes: fs.statSync(destino).size, sha256: sha(destino) });
      }
      fs.renameSync(copiaCifrada, ruta);
      fs.chmodSync(ruta, 0o600);
      console.log(`   5) sustituida · la original (${huellas.length} fichero${huellas.length === 1 ? '' : 's'}) apartada en ${path.relative(os.homedir(), APARTADAS)}`);
      apuntarEnElLeeme(rel, huellas, censoOriginal, tam);
    }

    // 6 · ya colocada, otra vez: por el camino normal, sin pasarle nada
    {
      const d = new Database(ruta, { readonly: true, fileMustExist: true });
      try {
        const mal = integridad(d);
        if (mal) throw new Error('¡ya colocada! no pasa integrity_check => ' + mal);
        const dif = diferencias(censoOriginal, censar(d));
        if (dif.length) throw new Error('¡ya colocada! el contenido NO coincide:\n      · ' + dif.join('\n      · '));
      } finally { d.close(); }
      console.log('   6) en su sitio, abierta por el camino normal: integrity_check ok y mismo contenido ✅');
    }

    limpiar();
    return { hecha: true, filas: censoOriginal.filas, tablas: censoOriginal.tablas };
  } catch (e) {
    limpiar();
    throw new Error(`${rel}: ${e.message}`);
  }
}

// ── El LEEME de las apartadas ────────────────────────────────────────────────────────────────────

function apuntarEnElLeeme(rel, huellas, censo, tam) {
  const f = path.join(APARTADAS, 'LEEME.txt');
  if (!fs.existsSync(f)) {
    fs.writeFileSync(f,
`BASES DE DATOS EN CLARO, APARTADAS AL CIFRAR EN REPOSO — ${FECHA}
════════════════════════════════════════════════════════════════════════════════

QUÉ SON. Las bases de Bamburu tal y como estaban ANTES de cifrarse en reposo
(ficha cifrado-en-reposo-bases). Cada una se sustituyó por su versión cifrada
solo después de comprobar, sobre una copia, que el contenido era idéntico tabla
a tabla y que integrity_check daba ok.

NO SE HAN BORRADO: SE HAN APARTADO. Es el mismo trato que las bases fantasma del
4 de septiembre de 2026. Su borrado definitivo es una segunda decisión, y es de
Ibrahin.

⚠️ ESTAS BASES ESTÁN EN CLARO. Contienen clientes, facturas y NIF legibles por
cualquiera que tenga el fichero. La carpeta está en 0700 y los ficheros en 0600.
Mientras existan, el cifrado en reposo protege a las bases VIVAS, no a estas
copias. Ese es justo el motivo por el que su borrado hay que decidirlo.

CÓMO VOLVER ATRÁS, si alguna vez hiciera falta: parar bamburu.service, devolver
el .db (y su -wal y -shm si están) a su ruta original, y dejar la dependencia
\`better-sqlite3\` del package.json apuntando al paquete de siempre en vez de a
core/sqlite-bamburu. Sin ese segundo paso, el programa intentará descifrar una
base que está en claro y NO arrancará — a propósito.

QUÉ HAY AQUÍ
`);
  }
  const lineas = [
    ``,
    `── ${rel}`,
    `   ${censo.tablas} tablas · ${censo.filas} filas · ${(tam / 1024).toFixed(0)} K`,
    ...huellas.map(h => `   ${h.fichero.padEnd(34)} ${String(h.bytes).padStart(9)} B  sha256 ${h.sha256}`),
  ];
  fs.appendFileSync(f, lineas.join('\n') + '\n');
  fs.chmodSync(f, 0o600);
}

// ── Puesta en marcha ─────────────────────────────────────────────────────────────────────────────

const claras = estado();
if (SOLO_ESTADO) process.exit(0);

if (claras === 0) { console.log('\nNo hay ninguna base en claro. Nada que hacer.'); process.exit(0); }

const llave = Database.llaveParaMigrar();
if (!llave) {
  console.error('\n🛑 No hay llave, así que no se migra nada.');
  console.error('   ' + Database.hayLlave().motivo + '.');
  console.error('   La genera Ibrahin. Ver docs/seguridad/cifrado-en-reposo.md');
  process.exit(1);
}

console.log(HAZLO
  ? '\n▶ MIGRANDO DE VERDAD. Base a base; a la primera que falle, se para.\n'
  : '\n▶ SIMULACRO (sin --hazlo): se hace TODO menos sustituir.\n');

let hechas = 0, saltadas = 0;
for (const ruta of basesVivas()) {
  try {
    const r = await migrarUna(ruta, llave);
    if (r.hecha) hechas++;
    if (r.saltada) saltadas++;
  } catch (e) {
    console.error('\n🛑 SE PARA AQUÍ. Ha fallado esta base y no se sigue con la siguiente:');
    console.error('   ' + e.message);
    console.error('\n   Lo migrado hasta ahora sigue bien y en su sitio. Las originales apartadas están en');
    console.error('   ' + APARTADAS);
    process.exit(1);
  }
}

console.log(`\n${HAZLO ? '✅' : '▶'} ${hechas} base${hechas === 1 ? '' : 's'} cifrada${hechas === 1 ? '' : 's'}` +
  (saltadas ? ` · ${saltadas} ya lo estaban` : '') + (HAZLO ? '' : ' (simulacro: no se ha tocado nada)'));
if (HAZLO && hechas) console.log(`   Las originales en claro, apartadas con sus huellas en:\n   ${APARTADAS}`);
