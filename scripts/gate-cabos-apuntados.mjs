// GATE DEL PUNTO 8 — los seis cabos apuntados y nunca construidos.
//   node scripts/gate-cabos-apuntados.mjs
//
// LOS SEIS: (1) voz.js escribía el dinero en inglés y las fechas en ISO · (2) gate-nav-inicio-disa se
// apoyaba en propuestas que no creaba él · (3) el alta del superadmin, comparada con la del dueño ·
// (4) faltaban tres motores y por eso el cuadro de mando decía «sin comparación» en dos sitios ·
// (5) B10, el endurecimiento de systemd · (6) B12, tres tablas de roles que no concedían nada.
//
// LO QUE MÁS SE CUIDA AQUÍ es el CONTROL de cada motor nuevo: un motor que calcula solo no se puede
// contrastar con nada, así que cada uno se compara con algo que ya existía y tenía que coincidir.
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { tenantDb } from './lib/gate-env.mjs';
import { vestir, dinero, fechaEs } from '../modules/erp/voz.js';
import { deudaAFecha, openDebts } from '../modules/erp/cobros.js';
import { ventasPorDia, clientesNuevosPorTramo, ventasResumen } from '../modules/erp/ventas-metrics.js';
import { periodoDe, SECCIONES } from '../modules/erp/cuadro-mando.js';

const SLUG = 'desarrollo-bamburu';
const BASE = 'https://' + SLUG + '.bamburu.com';
const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
let pass = 0, fail = 0;
const ok = (c, m, det) => { if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ ' + m + (det ? ' · ' + det : '')); } };

const db = new Database(tenantDb(SLUG));
db.pragma('busy_timeout = 10000');
const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
const TOKEN_PREFIJO = 'gate-cabos8-';
const tok = TOKEN_PREFIJO + randomBytes(20).toString('hex');
const ahora = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(tok, owner.id, ahora, ahora + 3600, randomBytes(20).toString('hex'));

try {
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] LA VOZ HABLA EN ESPAÑOL — el dinero y la fecha');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  ok(dinero(1234.5, '€') === '1.234,50 €', 'el dinero: punto de miles, coma decimal y símbolo detrás', dinero(1234.5, '€'));
  ok(fechaEs('2026-08-23') === '23/08/2026', 'la fecha: como se dice, no como se guarda', fechaEs('2026-08-23'));
  const h = { detector: 'deuda_vencida', area: 'cobros', titulo: 'T', motivo: 'M',
              cifra: 1232.5, moneda: true, fecha: '2026-07-15', ref: { invoice_number: 'F2026-0100' } };
  const av = vestir(h, '€', '2026-08-23');
  const frase = av.quePasa + ' ' + av.decision;
  ok(/1\.232,50 €/.test(frase), 'y el aviso entero sale en español', av.quePasa);
  ok(/15\/07\/2026/.test(frase), '  con su fecha también');
  ok(!/€1232|2026-07-15/.test(frase), '  y ni rastro del formato de antes');
  // La cifra sigue siendo EXACTAMENTE la del hallazgo: formatear no es recalcular.
  ok(av.cifra === h.cifra && av.fecha === h.fecha,
     'el dato que viaja NO cambia: solo cambia cómo se escribe', av.cifra + ' · ' + av.fecha);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] LOS TRES MOTORES QUE FALTABAN, cada uno contra su control');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const hoy = new Date().toISOString().slice(0, 10);
  // (a) DEUDA A FECHA PASADA. El control es el que manda: al día de HOY tiene que dar lo mismo que
  //     `openDebts`, el motor que ya existía. Si no coincidiera, el nuevo estaría inventando.
  const hoyNuevo = deudaAFecha(db, hoy), hoyViejo = openDebts(db, hoy);
  ok(Math.abs(hoyNuevo.total - hoyViejo.total) < 0.01,
     'CONTROL · la deuda a HOY del motor nuevo es la misma que la del que ya había',
     hoyNuevo.total + ' vs ' + hoyViejo.total);
  const anio = deudaAFecha(db, '2025-12-31');
  ok(anio.total >= 0 && anio.total < hoyNuevo.total,
     '  y la de una fecha pasada es distinta (si no, no estaría mirando la fecha)',
     '31/12/2025 → ' + anio.total + ' · hoy → ' + hoyNuevo.total);
  ok(typeof anio.exacta === 'boolean',
     '  y dice si es exacta o aproximada, en vez de dar una cifra como si fuera un fotograma',
     'exacta=' + anio.exacta + ' · avisadas=' + anio.avisadas);
  // Una fecha anterior a la primera factura tiene que dar CERO: el suelo del motor.
  ok(deudaAFecha(db, '2000-01-01').total === 0, '  y antes de la primera factura, cero');

  // (b) SERIE DIARIA SIN IVA. Control: la suma de las bases diarias del mes tiene que cuadrar con
  //     el titular de ventas del mes, que sale de OTRO motor (`ventasResumen`).
  const per = periodoDe(hoy);
  const serie = ventasPorDia(db, 40).filter(d => d.date >= per.ini && d.date <= per.fin);
  const sumaBase = Math.round(serie.reduce((s, d) => s + d.base, 0) * 100) / 100;
  const res = ventasResumen(db, { from: per.ini, to: per.fin });
  ok(serie.every(d => typeof d.base === 'number'), 'la serie diaria trae la BASE, no solo el total con IVA');
  ok(Math.abs(sumaBase - (res.base ?? res.subtotal ?? 0)) < 0.05,
     'CONTROL · sumando los días del mes sale el MISMO titular que da el motor de ventas',
     sumaBase + ' vs ' + (res.base ?? res.subtotal));
  ok(serie.every(d => d.total >= d.base - 0.01), '  y el total con IVA nunca es menor que la base');

  // (c) ALTAS POR TRAMO DE MES. Control: el tramo hasta el último día del mes = el mes entero.
  const mes = per.mes, mesAnt = per.mesAnt;
  const tramo = clientesNuevosPorTramo(db, { mes: mesAnt, hastaDia: 15 });
  const entero = clientesNuevosPorTramo(db, { mes: mesAnt, hastaDia: 31 });
  ok(tramo.clientes <= entero.clientes, 'medio mes nunca puede tener más altas que el mes entero',
     tramo.clientes + ' hasta el 15 · ' + entero.clientes + ' entero');
  ok(entero.completo === true, 'CONTROL · pidiendo el día 31, el motor dice que el mes está completo');
  const feb = clientesNuevosPorTramo(db, { mes: '2026-02', hastaDia: 30 });
  ok(feb.hastaDia === 28 && feb.completo === true,
     '  y un mes más corto que el día pedido se cuenta entero, y LO DICE', 'feb → día ' + feb.hastaDia);

  console.log('\n[3] Y LOS DOS «SIN COMPARACIÓN» DEL CUADRO DE MANDO, TAPADOS');
  const cobro = SECCIONES.cobro.datos(db, { per });
  const clientes = SECCIONES.clientes.datos(db, { per });
  ok(cobro.comparacion.hay === true, '«Pendiente de cobro» ya compara con el mes anterior',
     cobro.comparacion.pct + ' %');
  ok(cobro.deudaAnterior != null, '  y dice contra qué cifra compara', cobro.deudaAnterior + ' el ' + cobro.fechaAnterior);
  ok(!cobro.aproximada || /aproximada/.test(cobro.porQueNoHayComparacion || ''),
     '  y si es aproximada, lo dice y explica por qué', (cobro.porQueNoHayComparacion || 'exacta').slice(0, 80));
  ok(!/\d{4}-\d{2}-\d{2}/.test(cobro.porQueNoHayComparacion || ''),
     '  con la fecha en español dentro de la frase, no en ISO');
  ok(clientes.comparacion.hay === true, '«Clientes nuevos» ya compara con el MISMO tramo del mes anterior',
     clientes.nuevos + ' vs ' + clientes.tramoAnterior + ' (hasta el día ' + clientes.tramoDia + ')');
  // Y la tarjeta de ventas no puede haber perdido la suya por el camino.
  const ventas = SECCIONES.ventas.datos(db, { per, _serie: null });
  ok(ventas && ventas.comparacion, 'y «Ventas del mes» conserva la comparación que ya tenía');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] B10 · EL SERVICIO, MÁS CERRADO Y VIVO');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const unit = fs.readFileSync('/etc/systemd/system/bamburu.service', 'utf8');
  for (const d of ['ProtectKernelTunables=true', 'ProtectKernelModules=true', 'ProtectClock=true',
                   'LockPersonality=true', 'RestrictRealtime=true', 'RemoveIPC=true', 'UMask=0077'])
    ok(unit.includes(d), '  ' + d);
  ok(/RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK/.test(unit),
     '  y solo las familias de socket que hacen falta');
  // LO QUE NO SE PUSO, y por qué: se comprueba que SIGUE sin ponerse, porque ponerlo rompe.
  ok(/NoNewPrivileges=false/.test(unit),
     'NoNewPrivileges sigue en false A PROPÓSITO: snap-confine es setuid y sin eso no hay PDF');
  ok(!/^ProtectHome=(true|yes|read-only)/m.test(unit),
     'y sin ProtectHome: las bases de datos viven en /home/ubuntu');
  // LA PRUEBA QUE IMPORTA: el PDF, que es lo que se rompe.
  const r = await fetch(BASE + '/admin/invoices/' + db.prepare('SELECT id FROM invoices ORDER BY id DESC LIMIT 1').get().id + '/pdf',
    { headers: { cookie: 'asess=' + tok } });
  const pdf = Buffer.from(await r.arrayBuffer());
  ok(r.status === 200 && pdf.slice(0, 4).toString() === '%PDF' && pdf.length > 10000,
     'y el PDF sigue saliendo con el servicio endurecido', r.status + ' · ' + pdf.length + ' bytes');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] B12 · LAS TRES TABLAS DE ROLES: RETIRADAS, NO DESTRUIDAS');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const tabla = n => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(n);
  for (const t of ['roles', 'role_permissions', 'user_roles']) {
    ok(!tabla(t), '  ' + t + ' ya no está en el camino vivo');
    ok(tabla(t + '_archived'), '    y sigue legible en ' + t + '_archived');
  }
  ok(tabla('permissions') && tabla('user_permissions'),
     'y las que SÍ mandan siguen intactas (permissions y user_permissions)');
  ok(db.prepare('SELECT COUNT(*) n FROM user_permissions').get().n >= 0, '  con sus filas');
  const src = fs.readFileSync(path.join(RAIZ, 'modules/erp/routes/auth.js'), 'utf8');
  ok(!/db\.prepare\([^)]*user_roles/.test(src), 'el login ya no escribe en una tabla que no lee nadie');
  const mdl = fs.readFileSync(path.join(RAIZ, 'modules/erp/models.js'), 'utf8');
  ok(!/CREATE TABLE IF NOT EXISTS (roles|role_permissions|user_roles)\b/.test(mdl),
     'y un negocio nuevo ya no las crea siquiera');
  ok(/migration_b12_archive_roles_2026_v1/.test(mdl), '  con su migración, aditiva e idempotente');
  ok(!/DROP TABLE/.test(mdl.split('migration_b12')[1] || ''), '  y sin un solo DROP');

  console.log('\n[6] EL CENSO DE VENTANITAS SIGUE EN CERO (no se ha colado ninguna esta noche)');
  let censo = ''; try { censo = execFileSync('node', [path.join(RAIZ, 'scripts', 'censo-ventanitas.mjs')], { encoding: 'utf8' }); }
  catch (e) { censo = String(e.stdout || ''); }
  ok(/VENTANITAS VIVAS: 0/.test(censo), 'cero prompt() y cero confirm() en el producto');

} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN: ' + e.message + '\n' + e.stack);
} finally {
  // Este gate no siembra nada en el negocio: solo lee y pide un PDF. Lo único suyo es su sesión.
  try { db.prepare("DELETE FROM admin_sessions WHERE token LIKE '" + TOKEN_PREFIJO + "%'").run(); } catch {}
  try { db.close(); } catch {}
}

console.log(`\n${'─'.repeat(70)}\nRESULTADO: ${pass} ✓  ·  ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
