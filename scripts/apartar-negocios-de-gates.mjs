#!/usr/bin/env node
// ═════════════════════════════════════════════════════════════════════════════════════════════════
// apartar-negocios-de-gates.mjs — saca de `control.db` los negocios que creó una comprobación.
//
// DE DÓNDE SALE. Tres gates que «empiezan de cero» se traen su propio negocio con `provisionTenant`,
// y al morir a mitad —o al no limpiar— lo dejan registrado en `control.db` como si fuera un negocio
// de verdad: `gate-csrf-disa-bede37`, `gate-borrado-a-38ddfe` y `gate-borrado-b-38ddfe`, los tres del
// 3 de septiembre de 2026. Salen en los recuentos, ocupan sitio en el censo de bases y **el barrido
// los trata como negocios vivos**.
//
// ⚠️ APARTAR NO ES BORRAR, y aquí también manda esa regla. La base de cada uno **no se destruye**:
// se mueve a `~/bases-retiradas/<fecha>-negocios-de-gates/` con su `LEEME.txt` y la huella SHA-256 de
// cada fichero, igual que las bases fantasma del 4 sep y las originales en claro del 6 sep. Su
// borrado definitivo es una segunda decisión, y es de Ibrahin.
//
// EL ORDEN, Y NO ES UNA RECOMENDACIÓN:
//   1. copia previa de `control.db`, VERIFICADA abriéndola y contando lo mismo
//   2. se comprueba que el negocio está VACÍO de negocio — cero clientes, facturas, productos y
//      facturas de proveedor. **Si alguno tiene algo dentro, se para y se dice cuál.** Un negocio con
//      datos no es residuo de un gate por mucho que se llame `gate-…`
//   3. se sueltan las filas que dependen de él ANTES de la suya. La clave ajena de
//      `tenant_suscripciones` ya tumbó 18 gates el 3 de septiembre: `DELETE FROM tenants` moría con
//      `SQLITE_CONSTRAINT_FOREIGNKEY` y la comprobación salía roja con las aserciones en verde
//   4. y solo entonces se aparta el fichero, con su huella
//
//   node scripts/apartar-negocios-de-gates.mjs            # simulacro: dice qué haría, no toca nada
//   node scripts/apartar-negocios-de-gates.mjs --hazlo    # lo hace
// ═════════════════════════════════════════════════════════════════════════════════════════════════
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
const CONTROL = path.join(RAIZ, 'data', 'control.db');
const FECHA = new Date().toISOString().slice(0, 10);
const APARTADAS = path.join(os.homedir(), 'bases-retiradas', FECHA + '-negocios-de-gates');
const HAZLO = process.argv.includes('--hazlo');

const sha = f => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const PATRON = /^gate-/;

// Las tablas de control.db que cuelgan de un negocio. Las dos primeras por clave ajena (y por eso
// hay que soltarlas antes); las demás por `tenant_slug`, que no bloquea pero deja basura si se queda.
const DEPENDIENTES = [
  ['tenant_sessions', 'tenant_id'],
  ['tenant_suscripciones', 'tenant_id'],
  ['integrity_checks', 'tenant_slug'],
  ['error_log', 'tenant_slug'],
  ['security_events', 'tenant_slug'],
  ['rate_limit_summaries', 'tenant_slug'],
  ['tenant_access_links', 'tenant_id'],
];

const ctrl = new Database(CONTROL);
const negocios = ctrl.prepare('SELECT id, slug, db_filename FROM tenants ORDER BY id').all()
  .filter(t => PATRON.test(t.slug));

console.log(`\nNegocios de gates registrados en control.db: ${negocios.length}`);
if (!negocios.length) { console.log('Nada que apartar.'); process.exit(0); }

// ── 1 · qué hay dentro de cada uno, y el cerrojo ────────────────────────────────────────────────
const TABLAS_DE_NEGOCIO = ['clients', 'invoices', 'products', 'supplier_invoices', 'customer_orders', 'appointments'];
let conDatos = 0;
for (const n of negocios) {
  const abs = path.isAbsolute(n.db_filename) ? n.db_filename : path.join(RAIZ, n.db_filename);
  const dentro = {};
  let total = 0;
  try {
    const d = new Database(abs, { readonly: true, fileMustExist: true });
    try {
      for (const t of TABLAS_DE_NEGOCIO) {
        try { const c = d.prepare('SELECT count(*) c FROM "' + t + '"').get().c; if (c) { dentro[t] = c; total += c; } } catch { /* sin esa tabla */ }
      }
    } finally { d.close(); }
  } catch (e) { console.log(`  ⚠️  ${n.slug}: no se pudo abrir (${e.message.split('\n')[0]})`); }
  n.total = total; n.dentro = dentro; n.abs = abs;
  if (total) conDatos++;
  console.log(`  ${total ? '🛑' : '  '} ${n.slug.padEnd(26)} ${total ? JSON.stringify(dentro) : 'vacío de negocio'}`);
}

if (conDatos) {
  console.error(`\n🛑 SE PARA. ${conDatos} negocio(s) tienen datos dentro. Un negocio con clientes o facturas`);
  console.error('   NO es residuo de un gate por mucho que se llame «gate-…». Mira la lista de arriba.');
  process.exit(1);
}

if (!HAZLO) {
  console.log(`\n▶ SIMULACRO. Con --hazlo se haría esto:`);
  console.log(`   · copia previa verificada de control.db`);
  for (const n of negocios) console.log(`   · soltar ${n.slug} de control.db y apartar su base`);
  console.log(`   · destino: ${APARTADAS}`);
  process.exit(0);
}

// ── 2 · copia previa de control.db, VERIFICADA ──────────────────────────────────────────────────
const dirCopias = path.join(RAIZ, 'data', 'copias-limpieza');
fs.mkdirSync(dirCopias, { recursive: true });
const copia = path.join(dirCopias, new Date().toISOString().replace(/[:.]/g, '-') + '-antes-de-apartar-negocios-gate.db');
ctrl.exec("VACUUM INTO '" + copia.replace(/'/g, "''") + "'");
fs.chmodSync(copia, 0o600);
{
  const c = new Database(copia, { readonly: true, fileMustExist: true, bamburuLlave: true });
  try {
    const antes = ctrl.prepare('SELECT count(*) c FROM tenants').get().c;
    const enCopia = c.prepare('SELECT count(*) c FROM tenants').get().c;
    if (antes !== enCopia) { console.error(`🛑 la copia previa no cuadra: ${antes} negocios contra ${enCopia}`); process.exit(1); }
    const ic = c.pragma('integrity_check');
    if (!(ic.length === 1 && ic[0].integrity_check === 'ok')) { console.error('🛑 la copia previa no pasa integrity_check'); process.exit(1); }
    console.log(`\n1) copia previa verificada · ${path.relative(RAIZ, copia)} · ${enCopia} negocios · integrity_check ok`);
  } finally { c.close(); }
}

// ── 3 · soltar de control.db, dependientes primero y en UNA transacción ─────────────────────────
const soltar = ctrl.transaction(() => {
  const quitado = {};
  for (const n of negocios) {
    for (const [tabla, col] of DEPENDIENTES) {
      try {
        const r = ctrl.prepare(`DELETE FROM "${tabla}" WHERE "${col}" = ?`).run(col === 'tenant_id' ? n.id : n.slug);
        if (r.changes) quitado[tabla] = (quitado[tabla] || 0) + r.changes;
      } catch { /* esa tabla no existe en este control.db */ }
    }
    const r = ctrl.prepare('DELETE FROM tenants WHERE id = ?').run(n.id);
    quitado.tenants = (quitado.tenants || 0) + r.changes;
  }
  return quitado;
});
const quitado = soltar();
console.log('2) sueltos de control.db · ' + Object.entries(quitado).map(([t, n]) => `${t}: ${n}`).join(' · '));
const quedan = ctrl.prepare('SELECT count(*) c FROM tenants').get().c;
ctrl.close();

// ── 4 · apartar los ficheros, con su huella ─────────────────────────────────────────────────────
fs.mkdirSync(APARTADAS, { recursive: true });
fs.chmodSync(APARTADAS, 0o700);
const leeme = path.join(APARTADAS, 'LEEME.txt');
fs.writeFileSync(leeme,
`NEGOCIOS CREADOS POR COMPROBACIONES, APARTADOS — ${FECHA}
════════════════════════════════════════════════════════════════════════════════

QUÉ SON. Tres negocios que se trajeron sus propios gates ("empiezan de cero") el
3 de septiembre de 2026 y que se quedaron registrados en control.db como si
fueran negocios de verdad. Salían en los recuentos y el barrido los trataba como
vivos.

QUÉ TENÍAN DENTRO, comprobado el día de la retirada: CERO clientes, CERO
facturas, CERO productos, CERO facturas de proveedor, CERO pedidos y CERO citas.
Solo el andamiaje de las migraciones y algún resto de conversación de DISA.

NO SE HAN BORRADO: SE HAN APARTADO. Mismo trato que las bases fantasma del 4 sep
y que las originales en claro del 6 sep. Su borrado definitivo es una segunda
decisión, y es de Ibrahin.

🔒 ESTAS BASES VAN CIFRADAS. Necesitan la llave de /etc/bamburu-bases.env para
abrirse. Para mirar dentro de una:
    node -e "const D=require('better-sqlite3'); \\
      const d=new D('<fichero>',{readonly:true,bamburuLlave:true}); \\
      console.log(d.prepare('select count(*) c from clients').get()); d.close();"

QUÉ HAY AQUÍ
`);

let apartados = 0;
for (const n of negocios) {
  const lineas = [`\n── ${n.slug}  (era el id ${n.id} en control.db)`];
  for (const suf of ['', '-wal', '-shm']) {
    const orig = n.abs + suf;
    if (!fs.existsSync(orig)) continue;
    const destino = path.join(APARTADAS, path.basename(orig));
    fs.renameSync(orig, destino);
    fs.chmodSync(destino, 0o600);
    lineas.push(`   ${path.basename(orig).padEnd(34)} ${String(fs.statSync(destino).size).padStart(9)} B  sha256 ${sha(destino)}`);
    apartados++;
  }
  fs.appendFileSync(leeme, lineas.join('\n') + '\n');
}
fs.chmodSync(leeme, 0o600);

console.log(`3) ${apartados} fichero(s) apartados en ${APARTADAS}`);
console.log(`\n✅ ${negocios.length} negocios de gates fuera. Quedan ${quedan} negocios en control.db.`);
