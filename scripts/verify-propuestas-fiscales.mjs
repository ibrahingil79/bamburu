// Gate — PROPUESTA DE DISA: vencimiento fiscal (D5e). Tipo `vencimiento_fiscal`.
//
// Ciclo completo sobre COPIAS de BD reales: los datos vivos NO se tocan. A diferencia de sus hermanas,
// esta propuesta no cuelga de un documento (factura/ocurrencia) ni de un cliente: cuelga de la FICHA
// FISCAL del tenant (qué presenta) y del CALENDARIO (cuándo vence). Lo difícil —y lo que aquí se
// afirma— es que SOLO se proponga lo DECLARADO (nunca se asume 303+130 para todos), que la fecha sea
// aproximada y con margen, que 303/130 lleven importe estimado y 111/115/anuales NO se inventen cifra,
// y que APROBAR ("preparar") deje el modelo listo SIN presentar nada a la AEAT.
//
//   node scripts/verify-propuestas-fiscales.mjs
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { copyFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runMigrations } from '../modules/erp/models.js';
import {
  generarPropuestasFiscales, propuestasPendientes, tiposVisiblesPara,
  TIPO_FISCAL, TIPO_IMPAGO,
} from '../modules/erp/propuestas.js';
import {
  MODELOS, MARGEN_DIAS, GRACIA_DIAS, modelosDeclarados, vencimientoNominal,
  etiquetaVencimiento, vencimientosProximos, NOTA_AEAT,
} from '../modules/erp/calendario-fiscal.js';
import { createPropuestasRoutes } from '../modules/erp/routes/propuestas.js';
// 24 ago 2026 · La copia va por `copiarBase` (sqlite .backup), no por copyFileSync: los negocios
// corren en WAL y un `cp` deja fuera el -wal, o sea mide una foto vieja. Ver scripts/lib/copia-consistente.mjs.
import { copiarBase } from './lib/copia-consistente.mjs';

const HOY = '2026-07-14';   // a 6 días del fin de plazo del 2T (20-jul): dentro de la ventana de disparo.
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

// UN NOMBRE DE TEMPORAL POR LLAMADA, no por negocio. 24 ago 2026: en verify-trazabilidad-flujos esta
// misma forma hizo que la segunda copia pisara la base que la primera tenía abierta, y la comprobación
// perdió un lote a media prueba. Aquí no había explotado todavía; el contador la desactiva.
let nCopias = 0;
const copias = [];
function copia(slug) {
  const p = join(tmpdir(), 'fisc-' + slug + '-' + process.pid + '-' + (++nCopias) + '.db');
  copiarBase(`data/tenants/${slug}.db`, p);
  copias.push(p);
  const db = new Database(p);
  runMigrations(db);
  db.prepare('DELETE FROM disa_proposals').run();
  return db;
}
// Declara la ficha fiscal (sella configured_at salvo que se pida lo contrario).
function declarar(db, flags = {}, configurado = true) {
  db.prepare(`UPDATE fiscal_profile SET presenta_iva=?, presenta_irpf_directa=?,
      tiene_retenciones_trabajo=?, tiene_retenciones_alquiler=?, situacion_especial=?,
      configured_at=? WHERE id=1`)
    .run(flags.iva?1:0, flags.irpf?1:0, flags.retTrab?1:0, flags.retAlq?1:0, flags.esp?1:0,
         configurado ? '2026-07-01T00:00:00Z' : null);
}
function appPara(db, perms, opts = {}) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('isOwner', !!opts.owner); c.set('isAdmin', false);
    c.set('userPerms', perms);
    c.set('session', { userName: 'gate', userId: 99, csrfToken: 'x' });
    await next();
  });
  app.route('/', createPropuestasRoutes(db).api);
  return app;
}
const POST = (app, path, body = {}) => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const propDe = (db, model, period) => db.prepare("SELECT * FROM disa_proposals WHERE type=? AND fiscal_model=? AND fiscal_period=?").get(TIPO_FISCAL, model, period);

try {
  // ── 1. Esquema ──────────────────────────────────────────────────────────────
  console.log('\n[1] Esquema');
  const db = copia('desarrollo-bamburu');
  const cols = db.prepare("PRAGMA table_info(disa_proposals)").all().map(r => r.name);
  ok(['fiscal_model', 'fiscal_year', 'fiscal_period'].every(c => cols.includes(c)),
     'disa_proposals tiene sus tres columnas propias (no reutiliza invoice_id/client_id)');
  const idx = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='disa_proposals'").all();
  const fiscalIdx = idx.find(i => i.name === 'idx_disa_proposals_fiscal');
  ok(!!fiscalIdx && /UNIQUE/i.test(fiscalIdx.sql), 'existe el índice ÚNICO de vencimientos');
  ok(!!fiscalIdx && /fiscal_model.*fiscal_year.*fiscal_period.*type/s.test(fiscalIdx.sql),
     'y es por (modelo, año, periodo, type): una sola propuesta por vencimiento, para siempre');
  ok(idx.some(i => i.name === 'idx_disa_proposals_invoice_type'), 'los índices de sus hermanas siguen intactos');
  const prof = db.prepare("SELECT * FROM fiscal_profile WHERE id=1").get();
  ok(!!prof && prof.configured_at == null, 'fiscal_profile nace como singleton SIN declarar (configured_at NULL)');
  ok(['presenta_iva', 'presenta_irpf_directa', 'tiene_retenciones_trabajo', 'tiene_retenciones_alquiler'].every(k => prof[k] === 0),
     'y con TODAS las obligaciones a 0: un negocio que no declaró nada no recibe nada');

  // ── 2. LA REGLA: solo se propone lo DECLARADO ───────────────────────────────
  console.log('\n[2] Solo lo declarado — nunca se asume 303+130 para todos');
  ok(modelosDeclarados(null).length === 0, 'sin ficha → ningún modelo');
  ok(JSON.stringify(modelosDeclarados({ presenta_iva: 1 })) === JSON.stringify(['303', '390']),
     'declarar IVA → 303 (trimestral) + 390 (anual), y nada más');
  ok(JSON.stringify(modelosDeclarados({ presenta_irpf_directa: 1 })) === JSON.stringify(['130']),
     'declarar IRPF directa → 130 (el 111 NO se deriva de aquí: es otra cosa)');
  ok(JSON.stringify(modelosDeclarados({ tiene_retenciones_trabajo: 1 })) === JSON.stringify(['111', '190']),
     'retenciones de trabajo → 111 + 190');
  ok(JSON.stringify(modelosDeclarados({ tiene_retenciones_alquiler: 1 })) === JSON.stringify(['115', '180']),
     'retenciones de alquiler → 115 + 180');
  ok(modelosDeclarados({ situacion_especial: 1 }).length === 0,
     'situación especial (módulos, recargo…) NO deriva ningún modelo por su cuenta: se avisa, no se inventa');

  // ── 3. Calendario: fechas NOMINALES aproximadas y etiqueta en llano ─────────
  console.log('\n[3] Calendario: el "cuándo", aproximado a propósito');
  ok(vencimientoNominal('303', 2026, '1T') === '2026-04-20', '1T vence ~20 de abril');
  ok(vencimientoNominal('303', 2026, '2T') === '2026-07-20', '2T vence ~20 de julio');
  ok(vencimientoNominal('303', 2026, '3T') === '2026-10-20', '3T vence ~20 de octubre');
  ok(vencimientoNominal('303', 2026, '4T') === '2027-01-30', '4T de 303/130 vence ~30 de enero del año siguiente');
  ok(vencimientoNominal('111', 2026, '4T') === '2027-01-20', '4T de retenciones (111/115) vence ~20 de enero');
  ok(vencimientoNominal('390', 2026, 'anual') === '2027-01-30', 'resumen anual de IVA (390) ~30 de enero');
  ok(vencimientoNominal('190', 2026, 'anual') === '2027-01-31', 'resúmenes anuales de retenciones (190/180) ~31 de enero');
  ok(etiquetaVencimiento('303', 2026, '2T') === 'IVA del 2º trimestre de 2026', 'etiqueta en llano ("IVA", no "303")');
  ok(etiquetaVencimiento('390', 2026, 'anual') === 'Resumen anual de IVA de 2026', 'el anual se etiqueta sin trimestre');
  ok(MODELOS['303'].tieneImporte === true && MODELOS['111'].tieneImporte === false,
     '303 sabe calcular su importe (motor de contabilidad); 111 aún no');

  // ── 4. La VENTANA de disparo (margen antes, gracia después) ─────────────────
  console.log('\n[4] Ventana de disparo: ~10 días antes, con gracia tras el plazo');
  const soloIva = { presenta_iva: 1 };
  ok(vencimientosProximos(soloIva, '2026-05-01').length === 0,
     'lejos de cualquier plazo (1 de mayo) → no se propone nada, no se adelanta meses');
  ok(vencimientosProximos(soloIva, '2026-07-10').some(v => v.model === '303' && v.period === '2T'),
     'a 10 días del 20-jul (el margen) → el IVA del 2T entra');
  ok(!vencimientosProximos(soloIva, '2026-07-09').some(v => v.period === '2T'),
     'a 11 días todavía NO (fuera del margen de ' + MARGEN_DIAS + ')');
  ok(vencimientosProximos(soloIva, '2026-07-23').some(v => v.period === '2T'),
     'pasado el plazo, dentro de la gracia (23-jul, +3) SIGUE avisando: el plazo real suele correrse hacia delante');
  ok(!vencimientosProximos(soloIva, '2026-07-24').some(v => v.period === '2T'),
     'pero superada la gracia de ' + GRACIA_DIAS + ' días, deja de avisar');

  // ── 5. Generación + idempotencia ────────────────────────────────────────────
  console.log('\n[5] Generación e idempotencia');
  const r0 = generarPropuestasFiscales(db, { today: HOY });
  ok(r0.creadas === 0 && r0.sinPerfil === true, 'sin ficha declarada: 0 creadas y sinPerfil=true (no se asume nada)');

  declarar(db, { iva: true, irpf: true, retTrab: true });
  const r1 = generarPropuestasFiscales(db, { today: HOY });
  ok(r1.creadas === 3, 'declarando IVA+IRPF+retenciones, cerca del 20-jul → 3 vencimientos del 2T (303, 130, 111)');
  ok(!!propDe(db, '303', '2T') && !!propDe(db, '130', '2T') && !!propDe(db, '111', '2T'), 'los tres son 303/130/111 del 2T');
  ok(!propDe(db, '390', 'anual') && !propDe(db, '190', 'anual'),
     'los anuales (390/190) NO se proponen en julio: su plazo es en enero (la ventana los deja fuera)');
  const r2 = generarPropuestasFiscales(db, { today: HOY });
  ok(r2.creadas === 0 && r2.yaTenian === 3, 'segunda pasada: 0 creadas, 3 ya tenían (idempotente)');
  let choco = false;
  try { db.prepare("INSERT INTO disa_proposals (type, fiscal_model, fiscal_year, fiscal_period, status) VALUES (?,?,?,?,'pendiente')").run(TIPO_FISCAL, '303', 2026, '2T'); }
  catch { choco = true; }
  ok(choco, 'el índice único rechaza una segunda propuesta del MISMO (modelo,año,periodo): el candado está en la BD');

  // ── 6. El panel: recálculo EN VIVO, importe y "viva" ────────────────────────
  console.log('\n[6] El panel recalcula en vivo');
  const props = propuestasPendientes(db, HOY, [TIPO_FISCAL]);
  ok(props.length === 3, 'devuelve los 3 vencimientos pendientes');
  ok(props.every(p => p.deadline === '2026-07-20' && p.dias_para_fin === 6),
     'fecha y días RECALCULADOS en vivo (20-jul, faltan 6): nunca de una copia guardada');
  ok(props.every(p => p.nota_aeat === NOTA_AEAT), 'cada tarjeta lleva la línea de seguridad "confirma en la AEAT"');
  const v303 = props.find(p => p.fiscal_model === '303'), v111 = props.find(p => p.fiscal_model === '111');
  ok(v303.tiene_importe === true && (v303.importe === null || typeof v303.importe === 'number'),
     'el 303 marca tiene_importe=true y trae una cifra estimada (o null si el libro no da), nunca inventada');
  ok(v111.tiene_importe === false && v111.importe === null,
     'el 111 NO trae importe: se avisa de la fecha, no se inventa una cifra (importe null)');
  ok(props.every(p => p.viva === true), 'todas vivas: el dueño aún declara esos modelos');

  // Desmarca el IVA: el 303 deja de estar "vivo" (pero sigue pendiente y avisado), el 130 sigue.
  declarar(db, { iva: false, irpf: true, retTrab: true });
  const props2 = propuestasPendientes(db, HOY, [TIPO_FISCAL]);
  const p303v = props2.find(p => p.fiscal_model === '303'), p130v = props2.find(p => p.fiscal_model === '130');
  ok(p303v && p303v.viva === false, 'al dejar de declarar IVA, el 303 pasa a viva=false (el panel avisa, no empuja a presentar lo que ya no toca)');
  ok(p130v && p130v.viva === true, 'y el 130 sigue vivo');
  declarar(db, { iva: true, irpf: true, retTrab: true });   // se restablece para el resto

  // ── 7. PREPARAR = dejar listo, SIN presentar a la AEAT ──────────────────────
  console.log('\n[7] Preparar: deja el modelo listo, NO presenta nada');
  const app = appPara(db, ['invoices.read']);
  const idx303 = propDe(db, '303', '2T').id, idx111 = propDe(db, '111', '2T').id;

  // 303 → devuelve el enlace al borrador en Impuestos.
  const resP = await POST(app, '/' + idx303 + '/preparar');
  const bodyP = await resP.json();
  ok(resP.status === 200 && bodyP.ok, 'POST /:id/preparar (303) → 200 ok');
  ok(bodyP.ver_modelos === '/admin/contabilidad/modelos?year=2026&q=2', 'para el 303 devuelve el enlace al borrador del 2T en Impuestos');
  ok(/no presenta|preséntalo tú/i.test(bodyP.message), 'y el mensaje deja claro que Bamburu NO presenta: lo presenta el dueño');
  const p303tras = db.prepare('SELECT * FROM disa_proposals WHERE id=?').get(idx303);
  ok(p303tras.status === 'preparada' && p303tras.resolved_at && p303tras.resolved_by === 'gate',
     'la propuesta queda PREPARADA, con quién y cuándo');

  // 111 → sin importe aún: se anota, sin enlace a borrador.
  const resP2 = await POST(app, '/' + idx111 + '/preparar');
  const bodyP2 = await resP2.json();
  ok(resP2.status === 200 && bodyP2.ver_modelos === null, 'preparar el 111 → 200 pero SIN enlace a borrador (aún no hay importe)');
  ok(/anotado|más adelante/i.test(bodyP2.message), 'y el mensaje dice que su importe llega más adelante');

  // Guardas de la ruta.
  const yaResuelta = await POST(app, '/' + idx303 + '/preparar');
  ok(yaResuelta.status === 409, 'preparar una YA preparada → 409 (no se resuelve dos veces)');
  db.prepare("INSERT INTO disa_proposals (type, status, subject) VALUES (?, 'pendiente', 'x')").run(TIPO_IMPAGO);
  const otra = db.prepare("SELECT id FROM disa_proposals WHERE type=? ORDER BY id DESC").get(TIPO_IMPAGO).id;
  ok((await POST(app, '/' + otra + '/preparar')).status === 400, 'preparar algo que NO es un vencimiento fiscal → 400');
  ok((await POST(app, '/999999/preparar')).status === 404, 'preparar un id inexistente → 404');
  const appSinPerm = appPara(db, ['purchases.read']);   // ve pagos, NO modelos fiscales
  ok((await POST(appSinPerm, '/' + idx111 + '/preparar')).status === 403, 'sin invoices.read → preparar 403');

  // Preparada/descartada NO se re-propone; y sale del panel.
  const tras = propuestasPendientes(db, HOY, [TIPO_FISCAL]);
  ok(!tras.some(p => p.id === idx303 || p.id === idx111), 'las preparadas salen del panel (solo se muestran las pendientes)');
  const r3 = generarPropuestasFiscales(db, { today: HOY });
  ok(r3.creadas === 0, 'y una preparada NO se vuelve a proponer (mismo periodo, misma clave única)');

  // ── 8. Candado de permisos + el badge no miente ─────────────────────────────
  console.log('\n[8] Candado y badge (invoices.read, como la pantalla de modelos)');
  const dbC = copia('desarrollo-bamburu');
  declarar(dbC, { iva: true });
  generarPropuestasFiscales(dbC, { today: HOY });
  ok(!!propDe(dbC, '303', '2T'), 'hay un vencimiento que proteger');

  const appNada = appPara(dbC, []);
  ok((await appNada.request('/')).status === 403, 'sin permisos: GET /propuestas → 403');
  const appPago = appPara(dbC, ['purchases.read']);   // ve pagos, NO fiscal
  const gPago = await (await appPago.request('/')).json();
  ok(!(gPago.propuestas || []).some(x => x.type === TIPO_FISCAL), 'SIN invoices.read: el vencimiento NO aparece en su lista');
  const appVe = appPara(dbC, ['invoices.read']);
  const gVe = await (await appVe.request('/')).json();
  ok((gVe.propuestas || []).some(x => x.type === TIPO_FISCAL), 'CON invoices.read: sí lo ve');
  const cVe = await (await appVe.request('/contador')).json();
  ok(cVe.count === (gVe.propuestas || []).length, 'el badge (' + cVe.count + ') dice lo mismo que el panel (' + (gVe.propuestas || []).length + '): el tipo nuevo entra en el badge');

  // La GENERACIÓN también se filtra por permiso: quien no puede verlo, no lo dispara.
  dbC.prepare('DELETE FROM disa_proposals').run();
  // SE MIDE EL FILTRO POR PERMISO, NO EL CALENDARIO. Esto exigía que tras generar apareciera el
  // vencimiento del 2T, y eso solo es cierto si el día de HOY cae dentro de su ventana de disparo.
  // Todo el resto del fichero trabaja con una fecha fija, pero esta parte va por la RUTA HTTP, que
  // usa la fecha REAL y no admite otra — y con razón: una ruta que acepte «haz como si fuera otro
  // día» es una puerta que no se abre por comodidad de un gate. Así que en julio pasaba y en agosto
  // fallaba sola, sin que nadie tocara nada. La ruta solo mete la clave `fiscal` en su respuesta si
  // quien llama puede verlo: eso es exactamente lo que esta comprobación quiere demostrar.
  const genPago = await (await POST(appPago, '/generar')).json();
  ok(!('fiscal' in genPago), 'quien no tiene invoices.read ni siquiera GENERA el vencimiento (falla cerrado)',
     JSON.stringify(Object.keys(genPago)));
  const genVe = await (await POST(appVe, '/generar')).json();
  ok('fiscal' in genVe, 'y quien lo tiene, sí', JSON.stringify(Object.keys(genVe)));

  // La fuente única declara los SEIS tipos.
  const tiposOwner = tiposVisiblesPara({ get: k => k === 'isOwner' }, () => true);
  ok(tiposOwner.length === 6 && tiposOwner.includes(TIPO_FISCAL), 'la fuente única declara los SEIS tipos, con el fiscal (' + tiposOwner.join(', ') + ')');

  // ── 9. Aislamiento entre negocios ───────────────────────────────────────────
  console.log('\n[9] Aislamiento entre negocios');
  const dbB = copia('ibrahin-repuestos');
  declarar(dbB, { iva: true });
  generarPropuestasFiscales(dbB, { today: HOY });
  ok(dbB.prepare("SELECT COUNT(*) n FROM disa_proposals WHERE type=?").get(TIPO_FISCAL).n >= 1,
     'el otro negocio genera los SUYOS a partir de SU propia ficha (una BD por negocio)');

} finally {
  for (const p of copias) { for (const f of [p, p + '-wal', p + '-shm']) { try { unlinkSync(f); } catch {} } }
  console.log('\n  (copias desechables borradas; el negocio vivo NO se ha tocado)');
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Propuestas de vencimiento fiscal: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
