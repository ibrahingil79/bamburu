#!/usr/bin/env node
// Gate — la copia de seguridad NO borra lo viejo si le falta algún negocio.
//
// Ficha `retencion-backup-fallo-parcial` (7 sep 2026). Corre el `scripts/bamburu-backup.sh` REAL
// —no una versión de mentira— contra un destino LOCAL (nunca `gdrive:`), con negocios de mentira.
//
// **Lo que vigila, y por qué es lo peor que puede pasar sin que nadie se entere.** La lista de bases
// se arma con un comodín sobre `data/tenants/*.db`: el script solo puede copiar lo que VE, y no
// tenía forma de saber lo que DEBERÍA ver. Medido en banco antes del arreglo: se quita el fichero de
// un negocio y la copia termina **con éxito**, el correo dice «backup completado correctamente
// (4 archivos)», el nombre del que falta **no aparece por ningún lado**, y la retención **borra su
// última copia vieja**. En pocos días ese negocio no tiene copia en ninguna parte.
//
//   node scripts/gate-copia-completa.mjs

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, utimesSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const BACKUP_SH = join(APP, 'scripts', 'bamburu-backup.sh');
const RCLONE = '/usr/bin/rclone';
const HOY = execFileSync('date', ['+%F'], { encoding: 'utf8' }).trim();

let pass = 0, fail = 0;
const bancos = [];
const ok = (c, t, d = '') => { if (c) { pass++; console.log(`  ✓ ${t}`); } else { fail++; console.log(`  ✗ ${t}${d ? ' — ' + d : ''}`); } };

function crearDb(ruta) {
  mkdirSync(dirname(ruta), { recursive: true });
  const db = new Database(ruta);
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  db.prepare('INSERT INTO t (v) VALUES (?)').run('x');
  db.close();
}

/** Un Bamburu de mentira: control.db con su tabla de negocios, sus bases, y un destino local. */
function banco(negocios, { conTablaTenants = true } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'copia-completa-'));
  bancos.push(tmp);
  const home = join(tmp, 'home'); mkdirSync(home, { recursive: true });
  const dataDir = join(tmp, 'data');
  crearDb(join(dataDir, 'control.db'));
  if (conTablaTenants) {
    const c = new Database(join(dataDir, 'control.db'));
    c.exec('CREATE TABLE tenants (id INTEGER PRIMARY KEY, slug TEXT, db_filename TEXT, status TEXT)');
    const ins = c.prepare('INSERT INTO tenants (slug, db_filename, status) VALUES (?,?,?)');
    for (const n of negocios) ins.run(n, `data/tenants/${n}.db`, 'active');
    c.close();
  }
  for (const n of negocios) crearDb(join(dataDir, 'tenants', n + '.db'));
  mkdirSync(join(dataDir, 'uploads'), { recursive: true });
  writeFileSync(join(dataDir, 'uploads', 'nota.txt'), 'x\n');
  const destino = join(tmp, 'destino'); mkdirSync(destino, { recursive: true });
  const env = { ...process.env, HOME: home, RCLONE_CONFIG: join(tmp, 'rc.conf'),
    BACKUP_DATA_DIR: dataDir, BACKUP_RETENTION_DAYS: '7', BACKUP_HC_URL: '' };
  delete env.RESEND_API_KEY; delete env.HEALTHCHECKS_URL;
  delete env.BAMBURU_TELEGRAM_TOKEN; delete env.BAMBURU_TELEGRAM_CHAT_ID;
  execFileSync(RCLONE, ['config', 'create', 'lbase', 'local'], { env });
  env.BACKUP_REMOTE = `lbase:${destino}`;
  return { tmp, dataDir, destino, env };
}

/** Una copia VIEJA ya en el destino, con fecha de hace 30 días: es lo que la retención borraría. */
function sembrarVieja(b, nombre) {
  const f = join(b.destino, nombre);
  writeFileSync(f, 'copia vieja buena');
  const hace30 = new Date(Date.now() - 30 * 86400 * 1000);
  utimesSync(f, hace30, hace30);
}

const correr = (b, guion = BACKUP_SH) => {
  const r = spawnSync('bash', [guion], { env: b.env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { estado: r.status, salida: `${r.stdout || ''}${r.stderr || ''}` };
};
const hayRetencion = s => /retención: borrando/.test(s);

try {
  console.log('\n[1] con todos los negocios en su sitio, la copia sale entera y la retención corre');
  {
    const b = banco(['uno', 'dos', 'tres']);
    sembrarVieja(b, 'uno-2026-07-01.db');
    const r = correr(b);
    const quedan = readdirSync(b.destino);
    ok(r.estado === 0, 'la copia termina con éxito', `salida ${r.estado}`);
    ok(hayRetencion(r.salida), 'y la retención SÍ se ejecuta');
    ok(!quedan.includes('uno-2026-07-01.db'), 'la copia de hace 30 días se retira, que es su trabajo');
    for (const n of ['control', 'uno', 'dos', 'tres'])
      ok(quedan.includes(`${n}-${HOY}.db`), `«${n}» está en la copia de hoy`);
    ok(/todos copiados/.test(r.salida), 'y el registro dice que estaban todos');
  }

  console.log('\n[2] si a un negocio le falta su base, NO se borra nada y se dice cuál');
  {
    const b = banco(['uno', 'dos', 'tres']);
    sembrarVieja(b, 'dos-2026-07-01.db');            // la única copia que queda de «dos»
    rmSync(join(b.dataDir, 'tenants', 'dos.db'));    // y su fichero desaparece
    const r = correr(b);
    const quedan = readdirSync(b.destino);
    ok(r.estado !== 0, 'la copia se declara FALLIDA', `salida ${r.estado}`);
    ok(!hayRetencion(r.salida), 'la retención NO se ejecuta');
    ok(quedan.includes('dos-2026-07-01.db'), '⭐ la última copia vieja de «dos» SIGUE AHÍ');
    ok(/INCOMPLETA/.test(r.salida), 'el aviso dice que la copia está incompleta');
    ok(/—\s*dos\b/.test(r.salida), 'y NOMBRA al negocio que falta', (r.salida.match(/INCOMPLETA[^\n]*/) || [''])[0].slice(0, 120));
    ok(quedan.includes(`uno-${HOY}.db`) && quedan.includes(`tres-${HOY}.db`),
       'y lo que sí se pudo copiar queda subido, no se tira');
  }

  console.log('\n[3] una control.db sin tabla de negocios no rompe la copia');
  {
    const b = banco(['uno'], { conTablaTenants: false });
    const r = correr(b);
    ok(r.estado === 0, 'la copia sigue funcionando', `salida ${r.estado}`);
    ok(/no tiene tabla de negocios/.test(r.salida), 'y lo dice en el registro en vez de callarlo');
  }

  console.log('\n[4] ROJO PROVOCADO — sin la comprobación, [2] tiene que caer');
  {
    const fuente = readFileSync(BACKUP_SH, 'utf8');
    const roto = fuente.replace(
      'ESPERADAS="$("$NODE" "$ESPERADAS_HELPER" "$DATA_DIR/control.db" 2>&1)"',
      'ESPERADAS="SIN_TABLA_TENANTS"; true "$("$NODE" --version 2>&1)"');
    if (roto === fuente) throw new Error('el rojo provocado no cambió nada: el parche ya no encaja');
    const b = banco(['uno', 'dos', 'tres']);
    const guion = join(b.tmp, 'sin-comprobacion.sh');
    writeFileSync(guion, roto);
    sembrarVieja(b, 'dos-2026-07-01.db');
    rmSync(join(b.dataDir, 'tenants', 'dos.db'));
    const r = correr(b, guion);
    const quedan = readdirSync(b.destino);
    ok(r.estado === 0 && hayRetencion(r.salida),
       'sin la comprobación, la copia incompleta se da por BUENA y la retención corre', `salida ${r.estado}`);
    ok(!quedan.includes('dos-2026-07-01.db'),
       '⭐ y la última copia de «dos» DESAPARECE: es exactamente lo que [2] impide');
  }
} finally {
  for (const t of bancos) { try { rmSync(t, { recursive: true, force: true }); } catch {} }
}

console.log(`\nRESULTADO: ${pass} ✓ · ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
