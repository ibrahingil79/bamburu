#!/usr/bin/env node
// ═════════════════════════════════════════════════════════════════════════════════════════════════
// gate-cifrado-en-reposo.mjs — ¿están las bases CIFRADAS EN EL DISCO, de verdad?
//
// QUÉ MIDE, Y POR QUÉ ASÍ. No pregunta al código si cree que cifra: **mira los ficheros**. Un gate
// que comprobara «el punto de apertura llama a PRAGMA key» daría verde sobre una base en claro el
// día que alguien mueva una ruta — y es exactamente el fallo que este gate existe para cazar.
//
//   · el fichero NO empieza por «SQLite format 3»
//   · el `sqlite3` DEL SISTEMA no puede abrirlo
//   · abrirlo SIN llave falla
//   · ni el .db ni su -wal ni su -shm contienen texto reconocible de una base de Bamburu
//   · CON llave abre y `integrity_check` dice ok
//
// Y DESPUÉS SE PONE ROJO A SÍ MISMO, tres veces. Un gate que solo sabe decir «verde» sobre lo que ya
// está bien no ha demostrado que sepa ver el fallo — esa lección está escrita en `CLAUDE.md` con
// nombre y apellidos: tres versiones del gate de pantallas daban verde con la pantalla ROTA. Aquí
// las tres averías se siembran en un banco aparte (un árbol de mentira en /tmp), nunca sobre `data/`:
//
//   a) sin llave          → el programa se PARA, y lo dice sin enseñar la llave
//   b) llave incorrecta   → el programa se PARA, y no lo disfraza de base corrupta
//   c) base vuelta a claro → este gate la CAZA y la NOMBRA
//
//   node scripts/gate-cifrado-en-reposo.mjs
// ═════════════════════════════════════════════════════════════════════════════════════════════════
import Database from 'better-sqlite3';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
const DIR_DATOS = path.join(RAIZ, 'data');
const DIR_NEGOCIOS = path.join(DIR_DATOS, 'tenants');
const SHIM = path.join(RAIZ, 'core', 'sqlite-bamburu');

let pass = 0, fail = 0;
const ok = (c, m, d) => {
  if (c) { pass++; console.log('  ✓ ' + m + (d ? ' · ' + d : '')); }
  else { fail++; console.error('  ✗ FALLO: ' + m + (d ? ' · ' + d : '')); }
};

// Texto que TODA base de SQLite en claro lleva dentro, y que una cifrada no puede enseñar.
const DELATORES = ['SQLite format 3', 'CREATE TABLE', 'sqlite_autoindex'];

const cabecera = ruta => { try { return fs.readFileSync(ruta, { length: 16 }).subarray(0, 15).toString('latin1'); } catch { return ''; } };
const contiene = (ruta, aguja) => { try { return fs.readFileSync(ruta).includes(Buffer.from(aguja, 'latin1')); } catch { return false; } };

function basesVivas() {
  const l = [];
  if (fs.existsSync(DIR_NEGOCIOS))
    for (const f of fs.readdirSync(DIR_NEGOCIOS).filter(f => f.endsWith('.db')).sort()) l.push(path.join(DIR_NEGOCIOS, f));
  const c = path.join(DIR_DATOS, 'control.db');
  if (fs.existsSync(c)) l.push(c);
  return l;
}

/**
 * EL OJO DEL GATE, aislado a propósito en una función: es lo mismo que se ejecuta sobre las bases de
 * verdad y sobre las averías sembradas. Si el ojo estuviera escrito dos veces, la autoprueba
 * comprobaría un ojo distinto del que se usa — y no probaría nada.
 *
 * Devuelve la lista de bases QUE ESTÁN MAL, cada una con su motivo y su nombre.
 */
function basesEnClaro(rutas) {
  const malas = [];
  for (const ruta of rutas) {
    const motivos = [];
    if (cabecera(ruta) === 'SQLite format 3') motivos.push('la cabecera dice «SQLite format 3»');
    for (const d of DELATORES) if (contiene(ruta, d)) motivos.push(`el fichero contiene «${d}» legible`);
    // El `sqlite3` del sistema es el forastero perfecto: no sabe nada de nuestra llave. Si él la
    // abre, está en claro y no hay más que hablar.
    try {
      const salida = execFileSync('sqlite3', [ruta, '.tables'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
      if (salida.trim()) motivos.push('el sqlite3 del sistema lista sus tablas');
    } catch (_) { /* lo correcto: no puede abrirla */ }
    // Dentro del repo se nombra por su ruta relativa; fuera (el banco de la autoprueba, en /tmp) por
    // el nombre del fichero, que es lo que se lee. Un `../../../tmp/…` no ayuda a nadie.
    const nombre = ruta.startsWith(RAIZ + path.sep) ? path.relative(RAIZ, ruta) : path.basename(ruta);
    if (motivos.length) malas.push({ base: nombre, motivos });
  }
  return malas;
}

// ── El banco de la autoprueba: un árbol de mentira, nunca `data/` ────────────────────────────────
const BANCO = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-cifrado-'));
const LLAVE_DE_MENTIRA = 'f'.repeat(63) + '1';

function montarBanco() {
  fs.mkdirSync(path.join(BANCO, 'core'), { recursive: true });
  fs.mkdirSync(path.join(BANCO, 'data', 'tenants'), { recursive: true });
  fs.cpSync(SHIM, path.join(BANCO, 'core', 'sqlite-bamburu'), { recursive: true });
  fs.symlinkSync(path.join(RAIZ, 'node_modules'), path.join(BANCO, 'node_modules'));
  fs.writeFileSync(path.join(BANCO, 'llave.env'), 'BAMBURU_LLAVE_BASES=' + LLAVE_DE_MENTIRA + '\n', { mode: 0o600 });
  fs.writeFileSync(path.join(BANCO, 'llave-otra.env'), 'BAMBURU_LLAVE_BASES=' + 'a'.repeat(64) + '\n', { mode: 0o600 });
}

/** Ejecuta un trozo de código en un hijo, con el punto de apertura DEL BANCO y el fichero de llave que se le diga. */
function enElBanco(ficheroLlave, codigo) {
  const guion = path.join(BANCO, 'sonda-' + Math.random().toString(36).slice(2) + '.cjs');
  fs.writeFileSync(guion,
    `process.env.BAMBURU_FICHERO_LLAVE = ${JSON.stringify(ficheroLlave)};\n` +
    `delete process.env.BAMBURU_LLAVE_BASES;\n` +
    `const Database = require(${JSON.stringify(path.join(BANCO, 'core', 'sqlite-bamburu', 'indice.cjs'))});\n` +
    codigo + '\n');
  const r = spawnSync(process.execPath, [guion], { cwd: BANCO, encoding: 'utf8', timeout: 30000 });
  fs.rmSync(guion, { force: true });
  return { codigo: r.status, salida: (r.stdout || '') + (r.stderr || '') };
}

try {
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] HAY LLAVE, Y LA CONFIGURACIÓN DE CIFRADO ESTÁ EN UN SOLO SITIO');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const l = Database.hayLlave();
  ok(l.hay, 'el punto único de apertura encuentra la llave', l.hay ? Database.FICHERO_LLAVE : l.motivo);
  ok(Database.CIFRADO && Database.CIFRADO.cipher === 'chacha20',
     'el cifrado está declarado en el punto de apertura', JSON.stringify(Database.CIFRADO));
  ok(fs.existsSync(path.join(SHIM, 'indice.cjs')), 'el punto único de apertura existe donde dice el package.json');
  {
    const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
    ok(/core\/sqlite-bamburu/.test(pkg.dependencies['better-sqlite3'] || ''),
       'la dependencia «better-sqlite3» apunta al punto único', pkg.dependencies['better-sqlite3']);
  }
  {
    // Que no haya una segunda puerta: nadie más puede IMPORTAR el motor cifrado a pelo, porque
    // quien lo importe se salta la llave y abre lo que le dé la gana.
    //
    // ⚠️ SE BUSCA LA IMPORTACIÓN, NO EL NOMBRE. La primera versión buscaba el nombre del motor como
    // texto suelto y **se encontraba a sí misma**: esta misma línea lo menciona. Un gate que se caza
    // a sí mismo no está midiendo el árbol, está midiendo su propio texto.
    const fuera = execFileSync('bash', ['-c',
      `cd ${JSON.stringify(RAIZ)} && grep -rlnE "(require\\(|from )['\\\"]better-sqlite3-multiple-ciphers['\\\"]" `
      + `--include=*.js --include=*.mjs --include=*.cjs core modules scripts index.js 2>/dev/null `
      + `| grep -v "^core/sqlite-bamburu/" || true`
    ], { encoding: 'utf8' }).trim();
    ok(fuera === '', 'nadie IMPORTA el motor cifrado salvo el punto único', fuera || 'ni un sitio más');
  }

  const bases = basesVivas();
  ok(bases.length > 0, 'hay bases vivas que comprobar', bases.length + ' bases');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] NINGUNA BASE VIVA ES LEGIBLE COMO SQLite EN CLARO');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  {
    const malas = basesEnClaro(bases);
    ok(malas.length === 0,
       'las ' + bases.length + ' bases vivas están cifradas en el disco',
       malas.length ? '' : 'ni una en claro');
    for (const m of malas) console.error(`      🔴 ${m.base} — ${m.motivos.join(' · ')}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] NI LOS -wal NI LOS -shm FILTRAN NADA');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // El -wal conserva su cabecera de 32 bytes sin cifrar (es de la propia SQLite y no lleva datos);
  // lo que NO puede llevar en claro son las PÁGINAS, que es donde están los clientes y las facturas.
  {
    let mirados = 0, sucios = [];
    for (const b of bases) for (const suf of ['-wal', '-shm']) {
      const f = b + suf;
      if (!fs.existsSync(f) || fs.statSync(f).size === 0) continue;
      mirados++;
      for (const d of ['CREATE TABLE', 'sqlite_autoindex']) if (contiene(f, d)) sucios.push(path.relative(RAIZ, f) + ' («' + d + '»)');
    }
    ok(sucios.length === 0, `los ${mirados} ficheros -wal/-shm con contenido no llevan texto de la base`, sucios.join(', '));
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] CON LLAVE ABREN TODAS, Y integrity_check DICE ok');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  {
    let buenas = 0; const rotas = [];
    for (const b of bases) {
      try {
        const d = new Database(b, { readonly: true, fileMustExist: true });
        try {
          const r = d.pragma('integrity_check');
          const tablas = d.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get().n;
          if (r.length === 1 && r[0].integrity_check === 'ok' && tablas > 0) buenas++;
          else rotas.push(path.relative(RAIZ, b) + ' → ' + JSON.stringify(r).slice(0, 80) + ' · ' + tablas + ' tablas');
        } finally { d.close(); }
      } catch (e) { rotas.push(path.relative(RAIZ, b) + ' → ' + e.message.split('\n')[0]); }
    }
    ok(rotas.length === 0, `las ${bases.length} bases abren con la llave e integrity_check: ok`, buenas + ' de ' + bases.length);
    for (const r of rotas) console.error('      🔴 ' + r);
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] SIN LLAVE NO SE ABRE NINGUNA — probado sobre las de verdad');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  {
    const abiertas = [];
    for (const b of bases) {
      try {
        const d = new Database(b, { readonly: true, fileMustExist: true, bamburuSinLlave: true });
        try { d.prepare('SELECT count(*) FROM sqlite_master').get(); abiertas.push(path.relative(RAIZ, b)); }
        finally { d.close(); }
      } catch (_) { /* lo correcto */ }
    }
    ok(abiertas.length === 0, 'sin llave no se lee ninguna de las ' + bases.length, abiertas.join(', '));
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[6] LOS PERMISOS SIGUEN SIENDO PRIVADOS');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  {
    const flojas = [];
    for (const b of bases) for (const suf of ['', '-wal', '-shm']) {
      const f = b + suf; if (!fs.existsSync(f)) continue;
      const m = fs.statSync(f).mode & 0o777;
      if (m & 0o077) flojas.push(path.relative(RAIZ, f) + ' (' + m.toString(8) + ')');
    }
    ok(flojas.length === 0, 'ni un fichero de base es legible por grupo u otros', flojas.join(', '));
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[7] AUTOPRUEBA — TRES AVERÍAS SEMBRADAS, LAS TRES TIENEN QUE PONERSE ROJAS');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  montarBanco();
  const baseBanco = path.join(BANCO, 'data', 'tenants', 'negocio-de-prueba.db');
  {
    const r = enElBanco(path.join(BANCO, 'llave.env'), `
      const d = new Database(${JSON.stringify(baseBanco)});
      d.pragma('journal_mode = WAL');
      d.exec('CREATE TABLE clientes (id INTEGER PRIMARY KEY, nombre TEXT, nif TEXT)');
      d.prepare('INSERT INTO clientes (nombre,nif) VALUES (?,?)').run('ZZ Gate Cifrado', 'B99999999');
      d.pragma('wal_checkpoint(TRUNCATE)');
      d.close();
      console.log('SEMBRADA');`);
    ok(/SEMBRADA/.test(r.salida), 'el banco monta una base cifrada de mentira', r.salida.trim().split('\n').pop());
    ok(basesEnClaro([baseBanco]).length === 0, 'y el ojo del gate la da por BUENA (si no, lo que sigue no probaría nada)');
  }

  console.log('\n  ── avería (a): NO HAY LLAVE');
  {
    const r = enElBanco(path.join(BANCO, 'no-existe.env'), `
      try { new Database(${JSON.stringify(baseBanco)}, { fileMustExist: true }); console.log('ABRIO'); }
      catch (e) { console.log('PARO'); console.log(e.message); }`);
    ok(/PARO/.test(r.salida) && !/ABRIO/.test(r.salida), 'el programa SE PARA');
    ok(/falta la llave de cifrado de las bases/.test(r.salida), 'y dice el motivo en cristiano');
    ok(!r.salida.includes(LLAVE_DE_MENTIRA) && !/[0-9a-f]{64}/.test(r.salida), 'sin volcar la llave, ni un trozo');
    ok(!r.salida.includes(baseBanco), 'sin volcar la ruta de la base');
  }

  console.log('\n  ── avería (b): LA LLAVE ES OTRA');
  {
    const r = enElBanco(path.join(BANCO, 'llave-otra.env'), `
      try { new Database(${JSON.stringify(baseBanco)}, { fileMustExist: true }); console.log('ABRIO'); }
      catch (e) { console.log('PARO'); console.log(e.message); }`);
    ok(/PARO/.test(r.salida) && !/ABRIO/.test(r.salida), 'el programa SE PARA');
    ok(/la llave de cifrado NO abre las bases/.test(r.salida),
       'y lo llama por su nombre, no «base corrupta»');
    ok(!/[0-9a-f]{64}/.test(r.salida), 'sin volcar ninguna llave');
  }

  console.log('\n  ── avería (c): UNA BASE DEVUELTA A CLARO');
  {
    const r = enElBanco(path.join(BANCO, 'llave.env'), `
      const d = new Database(${JSON.stringify(baseBanco)}, { fileMustExist: true, bamburuSinLlave: true });
      d.pragma("cipher = 'chacha20'"); d.pragma('kdf_iter = 1');
      d.pragma('key = "x\\'${LLAVE_DE_MENTIRA}\\'"');
      d.pragma("rekey = ''");
      d.close();
      console.log('DESCIFRADA');`);
    ok(/DESCIFRADA/.test(r.salida), 'la avería se siembra: la base vuelve a claro', r.salida.trim().split('\n').pop());
    const cazadas = basesEnClaro([baseBanco]);
    ok(cazadas.length === 1, 'el gate LA CAZA');
    ok(cazadas.length === 1 && cazadas[0].base.includes('negocio-de-prueba.db'), 'y LA NOMBRA', cazadas[0] && cazadas[0].base);
    ok(cazadas.length === 1 && cazadas[0].motivos.length >= 2, 'diciendo por qué', cazadas[0] && cazadas[0].motivos.join(' · '));
  }
} finally {
  // Lo que la prueba crea, la prueba lo borra — pase, falle o reviente. El banco vive entero en
  // /tmp y no toca `data/` en ningún momento, así que se va de una pieza.
  try { fs.rmSync(BANCO, { recursive: true, force: true }); } catch (_) {}
}

console.log(`\n${pass} ✓ · ${fail} ✗`);
process.exit(fail ? 1 : 0);
