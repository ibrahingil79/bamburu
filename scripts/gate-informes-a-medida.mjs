// GATE de la FICHA D — analíticas: informes a medida (D1 · D2 · D3 · D4 · D5).
//   node scripts/gate-informes-a-medida.mjs
//
// Prueba las CUATRO partes contra el servidor REAL (:3000, el mismo proceso que Caddy proxya al
// público) y contra la BD real del tenant `desarrollo-bamburu`.
//
// SEIS COSAS QUE ESTE GATE HACE A PROPÓSITO, y cada una tapa una forma de dar un verde falso:
//
//  1. **SE TRAE SUS PROPIAS CITAS.** La agenda de este negocio tiene CUATRO citas, ninguna facturada,
//     ninguna con ausencia y ninguna con puesto asignado — con eso no se puede contrastar la mitad de
//     las medidas. El gate crea las suyas (con su marca y su sufijo aleatorio), las mide y las borra.
//     Nunca se engancha a las que ya había: un gate que depende de lo que dejó otro no mide el
//     producto, se mide a sí mismo.
//  2. **CADA MEDIDA SE CONTRASTA CONTANDO A MANO** en la base por otro camino. Si el constructor dice
//     14 citas, este gate cuenta 14 con un `SELECT COUNT(*)` y las compara.
//  3. **LA PANTALLA SE MIRA EN UN NAVEGADOR DE VERDAD**, no solo en el HTML del servidor: lo que la
//     ficha D cambia es *qué se dibuja al abrir*, y eso no se ve en el HTML — el HTML trae las nueve
//     tarjetas igual, ocultas. Se comprueba que al cargar NO se ha pedido ni un cruce y que ningún
//     canvas tiene nada pintado, y luego se PULSA.
//  4. **LOS BOTONES SE PULSAN, no se buscan en el DOM.** Borrar, renombrar y compartir se ejercitan de
//     verdad y se comprueba el efecto en la base. Un botón que existe y no hace nada es el fallo que
//     esta ficha viene a cerrar (el DELETE llevaba desde julio sin que lo llamara nadie).
//  5. **EL PAPEL SE COMPARA VALOR A VALOR CON LA PANTALLA.** No «tiene tabla»: cada celda del papel
//     contra cada fila del cruce, una a una.
//  6. **CONTROL POSITIVO EN TODO LO QUE ES UNA AUSENCIA.** «No hay gráficos al abrir» solo vale si
//     después SÍ los hay al pulsar; «la medida no aparece» solo vale si con la otra dimensión sí.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import path from 'path';
import { tenantDb, APP_DIR, launchOpts, autoAceptarPaneles } from './lib/gate-env.mjs';
import { cruzar, camposPara, AREAS } from '../modules/erp/constructor-analitica.js';
import { RECETAS } from '../modules/erp/dibujo.js';
import { LISTADOS } from '../modules/erp/listados.js';

const SLUG = 'desarrollo-bamburu';
const DB_PATH = tenantDb(SLUG);
const BASE = `http://${SLUG}.localhost:3000`;
const RID = randomBytes(3).toString('hex');
const MARCA = 'GATE-D-' + RID;                 // por aquí se reconoce y se limpia todo lo del gate
const TOKEN_PREFIJO = 'gate-fichad-';
const dormir = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (c, m, det) => { if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ ' + m + (det ? ' · ' + det : '')); } };

const db = new Database(DB_PATH);
db.pragma('busy_timeout = 10000');
const todo = () => true;
let browser = null, creado = { citas: [], clientes: [], recurso: null, factura: null, paneles: [] };

// ── Sesión de dueño, con prefijo para poder limpiar por prefijo si el gate muere a mitad ──────────
const token = TOKEN_PREFIJO + randomBytes(20).toString('hex');
const csrf = randomBytes(20).toString('hex');
const ahora = Math.floor(Date.now() / 1000);
const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
if (!owner) { console.error('✗ GATE ABORTADO: no hay owner activo en ' + SLUG); process.exit(2); }
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(token, owner.id, ahora, ahora + 1800, csrf);
const H = { cookie: 'asess=' + token };
const API = (m, p, b) => fetch(BASE + p, {
  method: m, headers: { ...H, 'Content-Type': 'application/json', 'x-csrf-token': csrf },
  body: b ? JSON.stringify(b) : undefined,
});

try {
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[0] EL GATE SE TRAE SU AGENDA: citas propias con lo que la real no tiene');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Un jueves y un lunes cualesquiera DENTRO del horario del negocio (9:00–14:00 de lunes a jueves,
  // medido). Se ponen a las 10:00 para que caigan dentro seguro.
  const F1 = '2026-03-05', F2 = '2026-03-09';   // jueves y lunes de un mes sin citas reales
  const insCli = db.prepare("INSERT INTO clients (name, client_type, active) VALUES (?,'particular',1)");
  const cliA = insCli.run(MARCA + ' Cliente A').lastInsertRowid;
  const cliB = insCli.run(MARCA + ' Cliente B').lastInsertRowid;
  creado.clientes = [cliA, cliB];
  creado.recurso = db.prepare("INSERT INTO recursos (nombre, tipo, active) VALUES (?,'sala',1)").run(MARCA + ' Sala 1').lastInsertRowid;
  // Una factura EMITIDA de verdad para poder medir «ingresos de las citas facturadas».
  const seq = (db.prepare("SELECT COALESCE(MAX(sequence),0)+1 s FROM invoices WHERE series='F' AND year=2026").get().s) + 5000;
  creado.factura = db.prepare(
    `INSERT INTO invoices (invoice_number,series,year,sequence,issue_date,company_name,company_fiscal_id,
       client_fiscal_id,client_name,subtotal,tax_amount,total,status,record_type,verifactu_hash,prev_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'emitida','alta','','')`
  ).run(MARCA, 'GATED', 2026, seq, F1, MARCA + ' SL', '89890001K', '', MARCA + ' Cliente A', 200, 42, 242).lastInsertRowid;

  const insCita = db.prepare(
    `INSERT INTO citas (codigo, fecha, inicio_min, dur_min, margen_min, estado, user_id, recurso_id,
       cliente_id, invoice_id, archived, created_at)
     VALUES (?,?,?,?,0,?,?,?,?,?,0,datetime('now'))`);
  const nueva = (fecha, ini, dur, estado, cli, rec, inv) =>
    creado.citas.push(insCita.run(MARCA + '-' + creado.citas.length, fecha, ini, dur, estado, owner.id, rec, cli, inv).lastInsertRowid);
  nueva(F1, 600, 60, 'atendida',   cliA, creado.recurso, creado.factura);   // facturada
  nueva(F1, 660, 30, 'no_show',    cliA, creado.recurso, null);             // ausencia
  nueva(F1, 700, 30, 'anulada',    cliB, null,           null);             // anulada
  nueva(F2, 600, 90, 'confirmada', cliB, creado.recurso, null);
  // La QUINTA es la que separa las dos medidas de horas: a las 16:00, con el negocio cerrado a las
  // 14:00. Reserva media hora y NO ocupa ni un minuto del horario. Sin una cita así, las dos
  // medidas coinciden por casualidad y la aserción de abajo no probaría nada.
  nueva(F2, 960, 30, 'confirmada', cliB, null, null);
  ok(creado.citas.length === 5, 'creadas 5 citas de prueba (1 facturada · 1 ausencia · 1 anulada · 1 normal · 1 fuera de horario)', creado.citas.join(','));

  const enRango = { from: F1, to: F2 };
  const dentro = 'archived=0 AND fecha BETWEEN \'' + F1 + '\' AND \'' + F2 + '\'';

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] D1+D4 · EL ÁREA DE AGENDA — cada medida contrastada contando a mano');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const areas = Object.keys(AREAS);
  // Eran seis; desde la noche del 23-24 ago 2026 son SIETE (entró «Catálogo», punto 9: los
  // productos parados, que el área de Inventario no puede contestar porque su fila es un
  // movimiento y un producto que nunca se movió no produce fila). Lo que este gate guarda es que
  // Agenda siga estando y que el número no BAJE.
  ok(areas.length >= 7 && areas.includes('agenda') && areas.includes('catalogo'),
     'el constructor tiene sus áreas, con Agenda y Catálogo entre ellas', areas.join(' · '));
  const campos = camposPara(todo, 'agenda');
  const dims = Object.keys(campos.dimensiones);
  // Eran seis; la séptima («Quién anuló la cita») entró la noche del 23-24 ago con los cabos de
  // agenda. Se comprueban por NOMBRE, que es lo que detecta una pérdida: un recuento a secas se
  // queda verde si desaparece una y aparece otra.
  for (const d of ['fecha', 'cliente', 'servicio', 'persona', 'puesto', 'estado', 'anulada_por'])
    ok(dims.includes(d), '  dimensión «' + d + '»');
  ok(dims.length >= 7, 'siete dimensiones o más en Agenda', dims.join(', '));

  // A MANO, por otro camino que el del constructor.
  const aMano = {
    citas:     db.prepare(`SELECT COUNT(*) c FROM citas WHERE ${dentro}`).get().c,
    anuladas:  db.prepare(`SELECT COUNT(*) c FROM citas WHERE ${dentro} AND estado='anulada'`).get().c,
    ausencias: db.prepare(`SELECT COUNT(*) c FROM citas WHERE ${dentro} AND estado='no_show'`).get().c,
    minutos:   db.prepare(`SELECT COALESCE(SUM(dur_min),0) m FROM citas WHERE ${dentro} AND estado<>'anulada'`).get().m,
    ingresos:  db.prepare(`SELECT COALESCE(SUM(i.subtotal),0) s FROM invoices i WHERE i.id IN (SELECT invoice_id FROM citas WHERE ${dentro} AND invoice_id IS NOT NULL)`).get().s,
  };
  const suma = (r, k) => r.filas.reduce((n, f) => n + (Number(f[k]) || 0), 0);
  const porEstado = cruzar(db, { area: 'agenda', dimension: 'estado', ...enRango, limit: 999, hasPerm: todo,
    medidas: ['citas', 'horas_reservadas', 'ingresos', 'anuladas', 'ausencias'] });
  ok(suma(porEstado, 'citas') === aMano.citas, 'Nº de citas cuadra con el recuento a mano', `${suma(porEstado, 'citas')} vs ${aMano.citas}`);
  ok(Math.abs(suma(porEstado, 'horas_reservadas') - aMano.minutos / 60) < 0.005,
     'Horas reservadas cuadran (y las anuladas no suman, como en ocupacionPersona)',
     `${suma(porEstado, 'horas_reservadas')} h vs ${(aMano.minutos / 60).toFixed(2)} h`);
  ok(suma(porEstado, 'anuladas') === aMano.anuladas, 'Citas anuladas cuadran', `${suma(porEstado, 'anuladas')} vs ${aMano.anuladas}`);
  ok(suma(porEstado, 'ausencias') === aMano.ausencias, 'Ausencias cuadran', `${suma(porEstado, 'ausencias')} vs ${aMano.ausencias}`);
  ok(Math.abs(suma(porEstado, 'ingresos') - aMano.ingresos) < 0.005, 'Ingresos facturados cuadran', `${suma(porEstado, 'ingresos')} € vs ${aMano.ingresos} €`);

  // Las seis dimensiones REPARTEN sin perder ni inventar citas: el total por cada una es el mismo.
  for (const d of dims) {
    const r = cruzar(db, { area: 'agenda', dimension: d, medidas: ['citas'], ...enRango, limit: 999, hasPerm: todo });
    ok(suma(r, 'citas') === aMano.citas, `  agrupando por «${campos.dimensiones[d].etiqueta}» siguen siendo ${aMano.citas} citas`, String(suma(r, 'citas')));
  }
  // Y una que sí reparte de verdad: el puesto. Tres citas tienen sala y una no.
  const porPuesto = cruzar(db, { area: 'agenda', dimension: 'puesto', medidas: ['citas'], ...enRango, limit: 999, hasPerm: todo });
  const conSala = db.prepare(`SELECT COUNT(*) c FROM citas WHERE ${dentro} AND recurso_id IS NOT NULL`).get().c;
  const filaSala = porPuesto.filas.find(f => String(f.clave).includes(MARCA));
  ok(!!filaSala && filaSala.citas === conSala, 'la dimensión «puesto» reparte de verdad (no es una columna vacía)',
     `${filaSala ? filaSala.citas : 0} en la sala vs ${conSala} a mano`);

  console.log('\n[1-bis] Las cuatro medidas de CAPACIDAD: solo donde son ciertas');
  for (const m of ['horas_abiertas', 'horas_ocupadas', 'horas_libres', 'ocupacion_pct'])
    ok(Array.isArray(campos.medidas[m].soloCon) && campos.medidas[m].soloCon.join() === 'fecha,persona',
       `«${campos.medidas[m].etiqueta}» declara que solo vale por fecha o persona`);
  for (const m of ['citas', 'horas_reservadas', 'ingresos', 'anuladas', 'ausencias'])
    ok(!campos.medidas[m].soloCon, `  control: «${campos.medidas[m].etiqueta}» NO está limitada (vale con las seis)`);
  for (const d of ['cliente', 'servicio', 'puesto', 'estado']) {
    let err = null;
    try { cruzar(db, { area: 'agenda', dimension: d, medidas: ['horas_libres'], hasPerm: todo }); } catch (e) { err = e; }
    ok(err && err.status === 400 && /hora libre no tiene/.test(err.message),
       `pedir horas libres por «${d}» se rechaza con su explicación`, err ? err.message.slice(0, 60) + '…' : 'la permitió');
  }
  for (const d of ['fecha', 'persona']) {
    let err = null, r = null;
    try { r = cruzar(db, { area: 'agenda', dimension: d, medidas: ['horas_libres'], ...enRango, limit: 999, hasPerm: todo }); } catch (e) { err = e; }
    ok(!err && r.filas.length > 0, `  control: por «${d}» SÍ se puede y devuelve filas`, err ? err.message : r.filas.length + ' filas');
  }
  // La capacidad, contra el motor de citas por otro camino.
  const capF = cruzar(db, { area: 'agenda', dimension: 'fecha', periodo: 'anio', ...enRango, limit: 999, hasPerm: todo,
    medidas: ['horas_abiertas', 'horas_ocupadas', 'horas_libres', 'ocupacion_pct'] });
  const { ocupacionDia } = await import('../modules/erp/vigia-agenda.js');
  let ab = 0, oc = 0;
  for (let t = Date.parse(F1 + 'T00:00:00Z'); t <= Date.parse(F2 + 'T00:00:00Z'); t += 86400000) {
    const o = ocupacionDia(db, new Date(t).toISOString().slice(0, 10)); ab += o.abierto_min; oc += o.ocupado_min;
  }
  ok(Math.abs(suma(capF, 'horas_abiertas') - ab / 60) < 0.02, 'Horas abiertas cuadran con ocupacionDia sumado día a día',
     `${suma(capF, 'horas_abiertas')} h vs ${(ab / 60).toFixed(2)} h`);
  ok(Math.abs(suma(capF, 'horas_ocupadas') - oc / 60) < 0.02, 'Horas ocupadas del horario cuadran', `${suma(capF, 'horas_ocupadas')} h vs ${(oc / 60).toFixed(2)} h`);
  ok(Math.abs((suma(capF, 'horas_abiertas') - suma(capF, 'horas_ocupadas')) - suma(capF, 'horas_libres')) < 0.02,
     'abiertas − ocupadas = libres (las tres son la misma cuenta)');
  ok(capF.capacidad && capF.capacidad.desde === F1, 'la respuesta DECLARA la ventana que midió (toda cifra declara su base)',
     capF.capacidad ? capF.capacidad.desde + ' a ' + capF.capacidad.hasta : 'no la declara');
  // Las DOS medidas de horas son distintas a propósito, y aquí se ve: la ausencia y la anulada.
  const resv = cruzar(db, { area: 'agenda', dimension: 'fecha', periodo: 'anio', medidas: ['horas_reservadas'], ...enRango, limit: 9, hasPerm: todo });
  const dif = suma(resv, 'horas_reservadas') - suma(capF, 'horas_ocupadas');
  ok(Math.abs(dif - 0.5) < 0.02,
     'las dos medidas de horas se separan EXACTAMENTE en la media hora de la cita fuera de horario',
     `reservadas ${suma(resv, 'horas_reservadas')} h · ocupadas del horario ${suma(capF, 'horas_ocupadas')} h · diferencia ${dif.toFixed(2)} h`);

  console.log('\n[1-ter] Los cuatro avisos del vigía ya llevan gráfico');
  const nombreCliente = id => db.prepare('SELECT name FROM clients WHERE id=?').get(id)?.name || null;
  for (const det of ['hueco_perdido', 'fuera_de_ritmo', 'sin_proxima_cita', 'ausencias']) {
    const g = RECETAS[det]({ ref: { fecha: F1, client_id: cliA } }, { nombreCliente: () => nombreCliente(cliA) });
    ok(!!g.receta && g.receta.area === 'agenda', `«${det}» tiene receta y es del área de agenda`, g.receta ? g.receta.medidas[0] : g.gap);
    if (g.receta) {
      const r = cruzar(db, { ...g.receta, hasPerm: todo, limit: 99 });
      ok(Array.isArray(r.filas), `  y su receta es un cruce válido`, r.filas.length + ' filas');
    }
  }
  // El cartel se mide sobre el CÓDIGO VIVO, no sobre el fichero entero: el comentario que explica que
  // se retiró contiene la frase a propósito, y buscarla a secas daría un rojo por leer la explicación.
  const fuente = (await import('fs')).readFileSync(path.join(APP_DIR, 'modules', 'erp', 'dibujo.js'), 'utf8');
  const vivo = fuente.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  ok(!vivo.includes('SIN_AREA_CITAS'), 'el cartel «el constructor todavía no tiene un área de agenda» ya no está en el código vivo');
  ok(['hueco_perdido','fuera_de_ritmo','sin_proxima_cita','ausencias']
      .every(d => { const g = RECETAS[d]({ ref: { fecha: F1, client_id: cliA } }, { nombreCliente: () => 'x' }); return !!g.receta; }),
     '  y ninguno de los cuatro devuelve ya «sin gráfico»');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] D2 · LA PANTALLA ES UN ÍNDICE — mirado en un navegador, no en el HTML');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  browser = await puppeteer.launch(launchOpts());
  const ctx = await browser.createBrowserContext();     // contexto propio: dos pestañas comparten cookies
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 1200 });
  await page.setCookie({ name: 'asess', value: token, domain: SLUG + '.localhost', path: '/' });
  // Borrar un informe pedía confirmación con confirm(); desde el 24 ago 2026 abre el panel de
  // `pedirDatos`. El `page.on('dialog')` de más abajo ya no lo alcanza: si nadie acepta el panel, el
  // botón se queda a medias y el informe no se borra (así salió este gate en el barrido del 24).
  await autoAceptarPaneles(page);
  const errores = [];
  page.on('pageerror', e => errores.push(String(e && e.message || e)));
  const cruces = [];
  page.on('request', r => { if (r.url().includes('/constructor/cruzar')) cruces.push(r.url()); });

  await page.goto(BASE + '/admin/analytics', { waitUntil: 'networkidle0' });
  await dormir(1200);
  ok(errores.length === 0, 'la pantalla carga sin un solo error de JavaScript', errores.join(' | ') || 'ninguno');
  const alAbrir = await page.evaluate(() => ({
    kpis: !!document.getElementById('kpiRow'),
    crear: !!document.getElementById('btnCrear'),
    filas: [...document.querySelectorAll('.inf-fila')].map(b => b.dataset.inf),
    constructorVisible: (document.getElementById('cardConstructor') || {}).offsetParent !== null,
    tarjetasVisibles: [...document.querySelectorAll('[id^="inf-"]')].filter(d => d.offsetParent !== null).map(d => d.id),
    // Un canvas "pintado" tiene algún píxel no transparente. Es la prueba de que NO se dibujó nada.
    canvasPintados: [...document.querySelectorAll('canvas')].filter(cv => {
      try { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true; return false; } catch { return false; }
    }).map(cv => cv.id),
  }));
  ok(!alAbrir.kpis, 'la fila de cuatro indicadores ya NO está');
  ok(alAbrir.crear, 'el botón «Crear un informe» está');
  ok(alAbrir.filas.length === 8, 'el índice lista los OCHO informes de fábrica', alAbrir.filas.join(', '));
  ok(!alAbrir.constructorVisible, 'el constructor arranca oculto');
  ok(alAbrir.tarjetasVisibles.length === 0, 'ninguna tarjeta de informe está desplegada', alAbrir.tarjetasVisibles.join(', ') || 'ninguna');
  ok(alAbrir.canvasPintados.length === 0, 'AL ABRIR NO SE HA DIBUJADO NI UN GRÁFICO', alAbrir.canvasPintados.join(', ') || 'ningún canvas pintado');
  ok(cruces.length === 0, 'y no se ha pedido ni un cruce al servidor', cruces.length + ' peticiones');

  // CONTROL POSITIVO: al pulsar, SÍ se dibuja. Sin esto, «no hay gráficos» valdría con la página rota.
  await page.click('.inf-fila[data-inf="ventas-periodo"]');
  await dormir(1800);
  const trasPulsar = await page.evaluate(() => {
    const cv = document.getElementById('salesChart');
    let pintado = false;
    try { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) { pintado = true; break; } } catch {}
    return { visible: document.getElementById('inf-ventas-periodo').offsetParent !== null, pintado };
  });
  ok(trasPulsar.visible && trasPulsar.pintado, 'CONTROL: al pulsar «Ventas por período» la tarjeta se abre y el gráfico SÍ se dibuja');

  // Y el constructor, al pulsar «Crear un informe».
  await page.click('#btnCrear');
  await dormir(2000);
  ok(await page.evaluate(() => document.getElementById('cardConstructor').offsetParent !== null), 'el botón «Crear un informe» abre el constructor');
  ok(cruces.length > 0, 'y ENTONCES sí se pide el cruce', cruces.length + ' peticiones');

  // Nada perdido: los diez informes de «Informes por área» siguen dentro de su tarjeta.
  await page.click('.inf-fila[data-inf="por-area"]');
  await dormir(1500);
  const pestanas = await page.evaluate(() => [...document.querySelectorAll('#infTabs .tab')].map(t => t.dataset.area));
  ok(pestanas.length === 3, '«Informes por área» conserva sus TRES pestañas', pestanas.join(', '));

  console.log('\n[2-bis] El área de Agenda se puede elegir en la pantalla');
  const areasEnPantalla = await page.evaluate(() => [...document.querySelectorAll('#cArea option')].map(o => o.value));
  ok(areasEnPantalla.includes('agenda'), 'el desplegable de áreas ofrece «agenda»', areasEnPantalla.join(', '));
  // Y las medidas de capacidad aparecen/desaparecen con la dimensión.
  const medidasCon = async (dim) => page.evaluate(async (d) => {
    const sa = document.getElementById('cArea'); sa.value = 'agenda'; sa.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 900));
    const sd = document.getElementById('cDim'); sd.value = d; sd.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 500));
    return [...document.querySelectorAll('#cMed option')].map(o => o.value);
  }, dim);
  const mFecha = await medidasCon('fecha');
  ok(mFecha.includes('horas_libres'), 'agrupando por fecha, «horas libres» está en el desplegable', mFecha.join(','));
  const mCliente = await medidasCon('cliente');
  ok(!mCliente.includes('horas_libres'), 'agrupando por cliente, «horas libres» DESAPARECE del desplegable', mCliente.join(','));
  ok(mCliente.includes('citas'), '  control: por cliente sí siguen las medidas de grano cita');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] D3 · GUARDAR, RENOMBRAR, COMPARTIR Y BORRAR — pulsando, no mirando');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const nP = () => db.prepare('SELECT COUNT(*) c FROM analytics_panels').get().c;
  const antesN = nP();
  const r1 = await (await API('POST', '/api/erp/analytics/constructor/paneles',
    { nombre: MARCA + ' informe', config: { area: 'agenda', dimension: 'fecha', periodo: 'mes', medidas: ['citas'], grafico: 'barras' }, compartido: false })).json();
  creado.paneles.push(r1.id);
  ok(nP() === antesN + 1, 'guardar como nuevo crea UNO', `${antesN} → ${nP()}`);

  // GUARDAR CAMBIOS: mismo id, no un duplicado. Era el fallo: el front nunca mandaba el id.
  const r2 = await (await API('POST', '/api/erp/analytics/constructor/paneles',
    { id: r1.id, nombre: MARCA + ' informe', config: { area: 'agenda', dimension: 'persona', periodo: 'mes', medidas: ['citas'], grafico: 'tarta' } })).json();
  ok(nP() === antesN + 1 && r2.id === r1.id, 'guardar CAMBIOS actualiza el mismo, no duplica', `${nP()} paneles · id ${r2.id}`);
  const cfg = JSON.parse(db.prepare('SELECT config FROM analytics_panels WHERE id=?').get(r1.id).config);
  ok(cfg.dimension === 'persona' && cfg.grafico === 'tarta', '  y la receta guardada es la nueva', JSON.stringify(cfg).slice(0, 60));

  // RENOMBRAR
  await API('POST', '/api/erp/analytics/constructor/paneles', { id: r1.id, nombre: MARCA + ' renombrado', config: cfg });
  ok(db.prepare('SELECT nombre FROM analytics_panels WHERE id=?').get(r1.id).nombre === MARCA + ' renombrado', 'renombrar cambia el nombre en la base');

  // COMPARTIR y DESCOMPARTIR
  await API('POST', '/api/erp/analytics/constructor/paneles', { id: r1.id, nombre: MARCA + ' renombrado', config: cfg, compartido: true });
  ok(db.prepare('SELECT compartido FROM analytics_panels WHERE id=?').get(r1.id).compartido === 1, 'compartir lo marca compartido');
  await API('POST', '/api/erp/analytics/constructor/paneles', { id: r1.id, nombre: MARCA + ' renombrado', config: cfg, compartido: false });
  ok(db.prepare('SELECT compartido FROM analytics_panels WHERE id=?').get(r1.id).compartido === 0, 'y dejar de compartir lo desmarca');

  // BORRAR, PULSANDO EL BOTÓN DE LA PANTALLA. El endpoint llevaba desde julio sin que lo llamara nadie.
  const rBorrar = await (await API('POST', '/api/erp/analytics/constructor/paneles',
    { nombre: MARCA + ' para borrar', config: { area: 'agenda', dimension: 'fecha', periodo: 'mes', medidas: ['citas'], grafico: 'barras' }, compartido: false })).json();
  creado.paneles.push(rBorrar.id);
  await page.goto(BASE + '/admin/analytics', { waitUntil: 'networkidle0' });
  await dormir(1500);
  page.on('dialog', async d => { await d.accept(); });
  const hayBoton = await page.evaluate((id) => !!document.querySelector('[data-del="' + id + '"]'), rBorrar.id);
  ok(hayBoton, 'la pantalla pinta un botón de Borrar para el informe guardado');
  const antesBorrar = nP();
  await page.evaluate((id) => document.querySelector('[data-del="' + id + '"]').click(), rBorrar.id);
  await dormir(1800);
  ok(nP() === antesBorrar - 1, 'AL PULSARLO el informe desaparece de la base (el DELETE ya lo llama alguien)', `${antesBorrar} → ${nP()}`);
  creado.paneles = creado.paneles.filter(x => x !== rBorrar.id);
  const facturasVivas = db.prepare('SELECT COUNT(*) c FROM invoices').get().c;
  ok(facturasVivas > 0, '  y no se ha llevado por delante ningún dato del negocio', facturasVivas + ' facturas siguen ahí');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] D5 · IMPRIMIR, PDF Y CORREO — por el motor único, y las cifras valor a valor');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const rPapel = await (await API('POST', '/api/erp/analytics/constructor/paneles',
    { nombre: MARCA + ' papel', config: { area: 'agenda', dimension: 'estado', periodo: 'mes', medidas: ['citas'], grafico: 'barras' }, compartido: false })).json();
  creado.paneles.push(rPapel.id);

  ok(!!LISTADOS.panel, 'el informe compuesto es una entrada del registro de LISTADOS (mismo motor)');
  const imp = await fetch(BASE + '/admin/listados/panel/imprimir?panel_id=' + rPapel.id, { headers: H, redirect: 'manual' });
  const papel = await imp.text();
  ok(imp.status === 200, 'imprimir responde 200', 'got ' + imp.status);
  ok(papel.includes('lst-cab'), '  el papel lleva el membrete y la cabecera del motor de la ficha C');
  ok(papel.includes('<div class="lst-graf">') && papel.includes('<svg'), '  EL PAPEL LLEVA EL DIBUJO');
  ok(papel.includes('<table class="lst">'), '  y la TABLA de datos debajo');
  ok(papel.includes(MARCA + ' papel'), '  con el título del informe', 'sí');
  for (const etq of ['Área', 'Mirado por', 'Midiendo'])
    ok(papel.includes(etq), `  la cabecera declara «${etq}»`);
  ok(papel.includes('window.print'), '  y se manda a la impresora sola');

  // VALOR A VALOR contra la pantalla.
  const pant = await (await API('POST', '/api/erp/analytics/constructor/cruzar',
    { area: 'agenda', dimension: 'estado', periodo: 'mes', medidas: ['citas'] })).json();
  const celdas = [...papel.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map(m => m[1].trim());
  let iguales = 0, distintas = [];
  for (const f of pant.filas) {
    const k = celdas.indexOf(String(f.clave));
    const enPapel = k >= 0 ? celdas[k + 1] : null;
    const esperado = Number(f.citas).toLocaleString('es-ES', { useGrouping: 'always', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (enPapel === esperado) iguales++; else distintas.push(`${f.clave}: pantalla ${esperado} · papel ${enPapel}`);
  }
  ok(pant.filas.length > 0 && distintas.length === 0,
     `las ${pant.filas.length} cifras del papel y de la pantalla son las MISMAS, una a una`,
     distintas.length ? distintas.join(' | ') : `${iguales}/${pant.filas.length} idénticas`);
  // Y el dibujo sale de los mismos números que la tabla.
  const svg = (papel.match(/<div class="lst-graf">[\s\S]*?<\/svg>/) || [''])[0];
  // El eje ABREVIA los rótulos largos a propósito (y lo declara en el pie del dibujo), así que se
  // admite la forma abreviada: lo que se comprueba es que no falta ni sobra ningún grupo.
  const enSvg = f => { const k = String(f.clave); return svg.includes(k) || svg.includes(k.slice(0, 11) + '…'); };
  ok(pant.filas.every(enSvg), 'el dibujo rotula los mismos grupos que la tabla (entero o abreviado)',
     pant.filas.filter(f => !enSvg(f)).map(f => f.clave).join(', ') || `los ${pant.filas.length}`);
  const barras = (svg.match(/<rect /g) || []).length;
  ok(barras === pant.filas.length, '  y dibuja UNA barra por grupo, ni una de más', `${barras} barras · ${pant.filas.length} grupos`);

  const pdf = await fetch(BASE + '/admin/listados/panel/pdf?panel_id=' + rPapel.id, { headers: H });
  const buf = Buffer.from(await pdf.arrayBuffer());
  ok(pdf.status === 200 && buf.slice(0, 4).toString('latin1') === '%PDF', 'el PDF se descarga y es un PDF de verdad', buf.length + ' bytes');

  // El correo: se ejercita la ruta REAL. Sin credenciales de Resend contesta 502 y NO marca enviado —
  // que también es lo correcto. Lo que se prueba aquí es que la ruta existe y monta su PDF.
  const mail = await (await API('POST', '/api/erp/listados/panel/enviar?panel_id=' + rPapel.id, { to: 'gate-' + RID + '@bamburu.test' }));
  const mj = await mail.json().catch(() => ({}));
  ok([200, 502].includes(mail.status), 'la ruta de enviar por correo existe y responde con criterio',
     mail.status === 200 ? 'enviado' : 'no salió y lo DICE: ' + String(mj.error).slice(0, 60));

  console.log('\n[4-bis] El candado del papel es el del ÁREA de la receta, no uno nuevo');
  const perm = typeof LISTADOS.panel.perm === 'function'
    ? LISTADOS.panel.perm({ panel_id: rPapel.id, _userId: owner.id, _hasPerm: todo }, db) : LISTADOS.panel.perm;
  ok(perm === 'citas.read', 'un informe de Agenda exige citas.read para imprimirse', String(perm));
  const rVentas = await (await API('POST', '/api/erp/analytics/constructor/paneles',
    { nombre: MARCA + ' ventas', config: { area: 'ventas', dimension: 'fecha', periodo: 'mes', medidas: ['base'], grafico: 'lineas' }, compartido: false })).json();
  creado.paneles.push(rVentas.id);
  const permV = LISTADOS.panel.perm({ panel_id: rVentas.id, _userId: owner.id, _hasPerm: todo }, db);
  ok(permV === 'invoices.read', '  y uno de Ventas exige invoices.read (el candado cambia con la receta)', String(permV));

  console.log('\n[5] Lo que NO se ha roto');
  const uno = await fetch(BASE + '/admin/listados/clientes/imprimir', { headers: H, redirect: 'manual' });
  const hc = await uno.text();
  ok(uno.status === 200 && hc.includes('lst-cab'), 'un listado de los quince de la ficha C sigue imprimiéndose igual', 'clientes → ' + uno.status);
  // OJO: `lst-graf` aparece SIEMPRE, en el CSS del motor. Lo que dice si hay dibujo es el DIV.
  ok(!hc.includes('<div class="lst-graf">'), '  y sale SIN dibujo, exactamente como antes');
  const vig = await fetch(BASE + '/admin/vigia', { headers: H, redirect: 'manual' });
  ok(vig.status === 200, 'la pantalla del vigía sigue respondiendo', 'got ' + vig.status);
  const ini = await fetch(BASE + '/admin', { headers: H, redirect: 'manual' });
  ok(ini.status === 200, 'y el Inicio también (la ficha E no se ha tocado)', 'got ' + ini.status);

} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN: ' + e.message + '\n' + e.stack);
} finally {
  // LIMPIEZA. Por los ids creados Y por la marca, para que si el gate muere a mitad la pasada
  // siguiente no herede basura ni se enganche a ella.
  try { if (browser) await browser.close(); } catch {}
  try {
    for (const id of creado.paneles) db.prepare('DELETE FROM analytics_panels WHERE id=?').run(id);
    db.prepare("DELETE FROM analytics_panels WHERE nombre LIKE 'GATE-D-%'").run();
    db.prepare("DELETE FROM citas WHERE codigo LIKE 'GATE-D-%'").run();
    if (creado.factura) db.prepare('DELETE FROM invoices WHERE id=?').run(creado.factura);
    db.prepare("DELETE FROM invoices WHERE series='GATED'").run();
    db.prepare("DELETE FROM recursos WHERE nombre LIKE 'GATE-D-%'").run();
    db.prepare("DELETE FROM clients WHERE name LIKE 'GATE-D-%'").run();
    db.prepare("DELETE FROM admin_sessions WHERE token LIKE '" + TOKEN_PREFIJO + "%'").run();
  } catch (e) { console.error('  (limpieza incompleta: ' + e.message + ')'); }
  try { db.close(); } catch {}
}

console.log(`\n${'─'.repeat(70)}\nRESULTADO: ${pass} ✓  ·  ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
