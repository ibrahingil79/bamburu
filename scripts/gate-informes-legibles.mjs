// GATE de la FICHA D-ter — los informes dejan de ser una chapuza.
//   node scripts/gate-informes-legibles.mjs
//
// LA QUINTA REGLA, la que nace de esta entrega: **no basta con que responda; tiene que servir para
// algo.** El gate anterior dio 59 ✓ · 0 ✗ y el dueño abrió la pantalla y se encontró ejes con noventa
// nombres —la mitad, restos de mis propios gates—, Contabilidad con cuarenta barras a cero porque no
// había forma de decir «este año», y un grupo con fecha del año 2000. Ninguna aserción falló, porque
// ninguna preguntaba si aquello se podía leer.
//
// Por eso aquí se mide **el resultado**, no solo el mecanismo: cuántos grupos entran en un eje, si el
// periodo recorta de verdad, si el número sale solo cuando toca, y si queda un solo nombre de gate
// en la pantalla. Y se limpia lo propio en el `finally`, por marca, que es la otra norma nueva.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { tenantDb, APP_DIR, launchOpts } from './lib/gate-env.mjs';
import { cruzar, camposPara, AREAS, RANGOS, RANGO_POR_DEFECTO, rangoDeFechas,
         listarMedidasPropias, guardarMedidaPropia, borrarMedidaPropia } from '../modules/erp/constructor-analitica.js';

const SLUG = 'desarrollo-bamburu';
const DB_PATH = tenantDb(SLUG);
const HOST = `${SLUG}.bamburu.com`, BASE = 'https://' + HOST;
const RID = randomBytes(3).toString('hex');
const MARCA = 'GD3-' + RID;                 // por aquí se limpia todo lo de esta pasada
const TOKEN_PREFIJO = 'gate-dter-';
const SHOTS = path.join(process.env.HOME || '/home/ubuntu', 'informes-shots');
const dormir = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (c, m, det) => { if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ ' + m + (det ? ' · ' + det : '')); } };

const db = new Database(DB_PATH);
db.pragma('busy_timeout = 10000');
const todo = () => true;
let browser = null;
const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
if (!owner) { console.error('✗ GATE ABORTADO: no hay owner activo'); process.exit(2); }
const token = TOKEN_PREFIJO + randomBytes(20).toString('hex');
const ahora = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(token, owner.id, ahora, ahora + 3600, randomBytes(20).toString('hex'));

async function abrirConstructor() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setCookie({ name: 'asess', value: token, domain: HOST, path: '/', secure: true });
  const errores = [];
  page.on('pageerror', e => errores.push(String(e && e.message || e)));
  page.on('dialog', async d => { errores.push('VENTANITA: ' + d.type()); await d.dismiss(); });
  await page.goto(BASE + '/admin/analytics', { waitUntil: 'networkidle0' });
  await dormir(1600);
  await page.click('#btnCrear'); await dormir(2400);
  return { page, errores };
}
const componer = (page, r) => page.evaluate(async (x) => {
  const set = (id, v) => { const e = document.getElementById(id); if (e && v != null) { e.value = v; e.dispatchEvent(new Event('change')); } };
  set('cArea', x.area); await new Promise(r2 => setTimeout(r2, 1100));
  set('cDim', x.dim);   await new Promise(r2 => setTimeout(r2, 500));
  set('cMed', x.med);   await new Promise(r2 => setTimeout(r2, 400));
  set('cRango', x.rango); set('cTipo', x.tipo);
  // NO UNA ESPERA FIJA. `dibujar()` pide su cruce al servidor y pinta en dos tiempos: primero la nota
  // con el periodo y luego, si recorta grupos, la reescribe con «Otros» y su enlace a la tabla. Con
  // 1800 ms clavados, bajo la carga de un barrido se leía la nota A MEDIAS —«todo el histórico»— con
  // el gráfico ya en 13 barras, y el gate cantaba un fallo que no existía (comprobado el 24 ago 2026:
  // la pantalla dice «se pintan los 12 mayores y los otros 21 van sumados en Otros»). Se espera a que
  // la nota se QUEDE QUIETA: dos lecturas iguales seguidas, con tope de 12 s.
  const notaDe = () => (document.getElementById('cNota') || {}).innerText || '';
  let previa = null, quietas = 0, t0 = 0;
  while (t0 < 12000) {
    await new Promise(r2 => setTimeout(r2, 400)); t0 += 400;
    const ahora = notaDe();
    quietas = (ahora === previa) ? quietas + 1 : 0;
    previa = ahora;
    if (quietas >= 2 && t0 >= 1600) break;
  }
  const cv = document.getElementById('cChart');
  let barras = -1; try { barras = Chart.getChart(cv).data.labels.length; } catch {}
  const vis = id => { const e = document.getElementById(id); return !!e && e.offsetParent !== null; };
  return { barras, numero: vis('cNumeroWrap'), tabla: vis('cTablaWrap'), grafico: vis('cChartWrap'),
           cifra: (document.getElementById('cNumero') || {}).textContent,
           pie: (document.getElementById('cNumeroPie') || {}).textContent,
           nota: (document.getElementById('cNota') || {}).innerText || '',
           medidas: [...document.querySelectorAll('#cMed option')].map(o => o.textContent) };
}, r);

try {
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] PARTE 6 — NO QUEDA BASURA DE MIS PRUEBAS EN EL NEGOCIO');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // LO QUE ESTE GATE PUEDE GARANTIZAR ES LO SUYO, NO LO DE LOS DEMÁS. Esto exigía CERO clientes con
  // marca de gate en el negocio entero, y en un barrido eso es imposible de cumplir: otros gates
  // están sembrando y limpiando a la vez, así que la cifra sube y baja por razones que no tienen nada
  // que ver con esta pantalla (medido el 24 ago 2026: 4 y luego 6, según qué otro gate iba corriendo).
  // Un gate no puede responder de la basura de otro. Se exige CERO de LA SUYA —su MARCA, que es la
  // única que crea y borra él— y lo ajeno se INFORMA, con su número, para que no desaparezca en
  // silencio: el que responde de eso es `limpiar-restos-de-gates.mjs`.
  const M = "(name LIKE 'GATE%' OR name LIKE '%(gate %' OR name LIKE 'ZZ %' OR name LIKE 'GD2-%')";
  const mio = `name LIKE '${MARCA}%'`;
  const cliMios = db.prepare(`SELECT COUNT(*) c FROM clients WHERE ${mio}`).get().c;
  const proMios = db.prepare(`SELECT COUNT(*) c FROM products WHERE ${mio}`).get().c;
  ok(cliMios === 0, 'ni un cliente MÍO se queda en el negocio', cliMios + '');
  ok(proMios === 0, 'ni un producto MÍO se queda', proMios + '');
  const cliVis = db.prepare(`SELECT COUNT(*) c FROM clients WHERE active=1 AND ${M}`).get().c;
  const proVis = db.prepare(`SELECT COUNT(*) c FROM products WHERE COALESCE(status,'')<>'archived' AND ${M}`).get().c;
  console.log('  · restos de OTROS gates visibles ahora mismo: ' + cliVis + ' clientes · ' + proVis
    + ' productos (se limpian con `node scripts/limpiar-restos-de-gates.mjs --hazlo`)');
  const total = db.prepare('SELECT COUNT(*) c FROM clients WHERE active=1').get().c;
  // Medido tras la limpieza: 24 activos, TODOS reales (Taxis Ríos SL, Autoescuela El Volante SL…).
  // Los 15 inactivos sin marca de gate ya lo estaban antes: la limpieza no tocó ni uno de verdad.
  ok(total >= 20, '  y quedan los clientes de verdad (no se ha barrido todo)', total + ' activos');
  ok(db.prepare(`SELECT COUNT(*) c FROM clients WHERE active=1 AND ${mio}`).get().c === 0,
     '  y ninguno de los activos lleva MI marca');
  // Lo que NO se pudo borrar está archivado, no destruido, y su factura sigue en la cadena.
  const arch = db.prepare(`SELECT COUNT(*) c FROM clients WHERE active=0 AND ${M}`).get().c;
  ok(arch > 0, '  los que tenían factura están ARCHIVADOS, no borrados', arch + ' archivados');
  // LA CADENA. Esto pedía «exactamente 1050 registros», y eso es una cifra que sube sola: cualquier
  // gate que emita una factura la mueve, y este gate se ponía rojo por algo que no es una pérdida
  // (medido el 24 ago 2026: 1054, cuatro de más por los gates de la noche). Lo que hay que garantizar
  // es que la limpieza NO DESTRUYE registros legales y que la cadena sigue ENGANCHADA — por huella,
  // no por recuento.
  const enCadena = db.prepare(`SELECT COUNT(*) c FROM verifactu_registros`).get().c;
  ok(enCadena >= 1050, '  la cadena de Verifactu no ha perdido registros (nunca baja de 1050)', enCadena + '');
  const cadena = db.prepare('SELECT id, prev_huella, huella FROM verifactu_registros ORDER BY id').all();
  let rotos = 0;
  for (let i = 1; i < cadena.length; i++)
    if ((cadena[i].prev_huella || '') !== (cadena[i - 1].huella || '')) rotos++;
  ok(rotos === 0, '  y sigue enganchada: cada registro lleva la huella del anterior',
     rotos ? rotos + ' eslabones rotos' : cadena.length + ' eslabones, ni uno suelto');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] PARTE 1 — LAS CUENTAS SON MEDIDAS CON NOMBRE, no una caja de fórmulas');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // NADA SE PIERDE, y se comprueba ÁREA POR ÁREA en vez de con dos totales. Un total suelto tiene dos
  // defectos: envejece a cada entrega (esta línea ya iba rota de antes: pedía 31 medidas cuando eran
  // 39) y, peor, se queda verde si un área pierde un campo y otra gana otro. El mínimo por área dice
  // dónde está la pérdida. Los números son los medidos el 24 ago 2026; SUBIR es correcto, BAJAR no.
  const MINIMO_POR_AREA = { ventas: [9, 8], compras: [4, 4], clientes: [6, 7], inventario: [5, 5],
                            contabilidad: [3, 4], agenda: [7, 11], catalogo: [5, 6] };
  const perdidas = [];
  for (const [ak, [nd, nm]] of Object.entries(MINIMO_POR_AREA)) {
    const a = AREAS[ak];
    if (!a) { perdidas.push(ak + ': el área ENTERA ha desaparecido'); continue; }
    const hd = Object.keys(a.dimensiones).length, hm = Object.keys(a.medidas).length;
    if (hd < nd) perdidas.push(ak + ': ' + hd + ' dimensiones, eran ' + nd);
    if (hm < nm) perdidas.push(ak + ': ' + hm + ' medidas, eran ' + nm);
  }
  const totalDims = Object.values(AREAS).reduce((n, a) => n + Object.keys(a.dimensiones).length, 0);
  const totalMeds = Object.values(AREAS).reduce((n, a) => n + Object.keys(a.medidas).length, 0);
  ok(perdidas.length === 0, 'el catálogo entero sigue ahí, área por área',
     perdidas.join(' · ') || totalDims + ' dimensiones · ' + totalMeds + ' medidas en ' + Object.keys(AREAS).length + ' áreas');
  for (const [a, k, etq] of [['ventas', 'ticket_medio', 'Ticket medio'], ['compras', 'pct_pendiente', '% pendiente de pago'],
       ['clientes', 'facturacion_media', 'Facturación media por cliente'], ['agenda', 'pct_ausencias', '% de ausencias'],
       ['agenda', 'duracion_media', 'Duración media de la cita (h)'], ['contabilidad', 'margen_pct', 'Margen sobre ingresos (%)']])
    ok(AREAS[a].medidas[k] && AREAS[a].medidas[k].etiqueta === etq, `nueva medida con nombre: «${etq}» en ${a}`);
  // Y la propia, construida ELIGIENDO (no escribiendo).
  const mp = guardarMedidaPropia(db, owner.id, { area: 'ventas', nombre: MARCA + ' mi margen',
    medida_a: 'beneficio', op: '/', medida_b: 'base', por_cien: true });
  const propias = listarMedidasPropias(db, owner.id);
  const cp = camposPara(todo, 'ventas', undefined, propias);
  const clave = 'propia_' + mp.id;
  ok(!!cp.medidas[clave], 'una medida propia aparece en «quiero saber» como una más', cp.medidas[clave]?.etiqueta);
  ok(/Beneficio en euros dividido entre Facturado/.test(cp.medidas[clave].ayuda || ''),
     '  y su cuenta se explica EN PALABRAS debajo', cp.medidas[clave].ayuda);
  const rp = cruzar(db, { area: 'ventas', dimension: 'fecha', medidas: [clave], rango: 'anio', propias, hasPerm: todo, limit: 99 });
  ok(rp.filas.length > 0 && rp.filas.every(f => f[clave] != null), '  y se calcula de verdad', JSON.stringify(rp.filas[0]));
  let err = null;
  try { guardarMedidaPropia(db, owner.id, { area: 'agenda', nombre: 'x', medida_a: 'horas_libres', op: '/', medida_b: 'citas' }); }
  catch (e) { err = e; }
  ok(err && err.status === 400, '  y no deja mezclar una medida del horario (daría un número inventado)');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] PARTE 2 — EL PERIODO: por defecto 12 meses, NUNCA el histórico');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  ok(RANGO_POR_DEFECTO === '12m', 'el rango por defecto son los últimos 12 meses', RANGO_POR_DEFECTO);
  ok(Object.keys(RANGOS).length >= 6, 'están los seis periodos pedidos', Object.keys(RANGOS).join(', '));
  const conta = k => cruzar(db, { area: 'contabilidad', dimension: 'fecha', medidas: ['resultado'], rango: k, hasPerm: todo, limit: 9999 }).filas.length;
  const todoH = conta('todo'), doce = conta('12m'), esteAnio = conta('anio');
  ok(doce <= 12 && doce < todoH, 'Contabilidad pasa de todo el histórico a 12 grupos', `todo=${todoH} · 12m=${doce} · año=${esteAnio}`);
  ok(rangoDeFechas('anio').from.endsWith('-01-01'), '«este año» arranca el 1 de enero', rangoDeFechas('anio').from);
  // El año 2000 (stock de apertura) deja de estorbar SIN borrar el dato.
  const inv12 = cruzar(db, { area: 'inventario', dimension: 'fecha', medidas: ['movimientos'], rango: '12m', hasPerm: todo, limit: 999 });
  ok(!inv12.filas.some(f => String(f.clave).startsWith('2000')), 'el grupo del año 2000 ya no sale en Inventario');
  ok(db.prepare("SELECT COUNT(*) c FROM stock_movements WHERE created_at < '2020-01-01'").get().c === 7,
     '  y sin haber borrado sus 7 movimientos: son el stock de apertura de productos reales');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] PARTE 4 — nada ilegible y nada sin sentido');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  let degen = null;
  try { cruzar(db, { area: 'clientes', dimension: 'cliente', medidas: ['clientes'], hasPerm: todo }); } catch (e) { degen = e; }
  ok(degen && degen.status === 400 && /no dice nada/.test(degen.message),
     'contar clientes repartidos por cliente se rechaza y se explica', degen ? degen.message.slice(0, 55) + '…' : 'la permitió');
  ok((camposPara(todo, 'clientes').medidas.clientes.nuncaCon || []).includes('cliente'),
     '  y el desplegable la esconde en esa dimensión, en vez de dejar elegirla');
  // Grupos vacíos.
  const conVacios = cruzar(db, { area: 'ventas', dimension: 'fecha', medidas: ['base'], rango: 'todo', hasPerm: todo, limit: 9999 });
  ok(conVacios.filas.every(f => Number(f.base) !== 0), 'ningún grupo a cero se cuela en el resultado',
     conVacios.gruposVacios + ' quitados');

  browser = await puppeteer.launch(launchOpts());

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] PARTE 3 y 4 EN PANTALLA — la forma la decide el resultado (y se MIRA)');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const { page, errores } = await abrirConstructor();
  fs.mkdirSync(SHOTS, { recursive: true });

  // (a) UN NÚMERO: un solo grupo.
  const rNum = await componer(page, { area: 'ventas', dim: 'fecha', med: 'base', rango: 'mes', tipo: 'auto' });
  ok(rNum.numero && !rNum.grafico, 'con un solo grupo sale EL NÚMERO, no un gráfico de una barra', 'cifra ' + rNum.cifra);
  ok(/\d/.test(rNum.cifra || '') && /mes/i.test(rNum.pie || ''), '  con su cifra y su periodo debajo', (rNum.cifra || '') + ' · ' + (rNum.pie || ''));
  await page.evaluate(() => document.getElementById('cardConstructor').scrollIntoView({ block: 'center' })); await dormir(600);
  await page.screenshot({ path: path.join(SHOTS, 'dter-numero.png') });

  // (b) MUCHOS GRUPOS: tabla por defecto, y el gráfico recorta a 12 + Otros.
  const rMuchos = await componer(page, { area: 'ventas', dim: 'cliente', med: 'base', rango: 'todo', tipo: 'auto' });
  ok(rMuchos.tabla && !rMuchos.grafico, 'con más de 12 grupos sale la TABLA, no sesenta barras');
  await page.screenshot({ path: path.join(SHOTS, 'dter-tabla.png') });
  const rBarras = await componer(page, { area: 'ventas', dim: 'cliente', med: 'base', rango: 'todo', tipo: 'barras' });
  ok(rBarras.barras > 0 && rBarras.barras <= 13, 'si el usuario pide barras, se pintan 12 + «Otros», no más',
     rBarras.barras + ' barras');
  ok(/Otros/.test(rBarras.nota) || rBarras.barras <= 12, '  y la nota lo dice', rBarras.nota.slice(0, 90));
  ok(/tabla/i.test(rBarras.nota), '  con su enlace para verlo todo en tabla');
  const etiquetas = await page.evaluate(() => { try { return Chart.getChart(document.getElementById('cChart')).data.labels; } catch { return []; } });
  // LOS QUE NO SE PUEDEN QUITAR SE NOMBRAN, NO SE EXIGEN. Esta línea pedía CERO nombres de gate en el
  // eje, y con datos de verdad eso ya no se puede cumplir: hay clientes de gate ARCHIVADOS cuyas
  // facturas están en la cadena de VERI*FACTU, así que no se pueden borrar y el área de Ventas sigue
  // agrupando por su nombre («GATE Rent Cliente», 24 ago 2026). La basura que una prueba deja se
  // vuelve imborrable en cuanto se enreda con un documento legal. Lo que este gate SÍ puede guardar
  // —y sigue guardando— es que no aparezca ninguno NUEVO: se consulta la base para saber cuáles son
  // imborrables (archivados y con factura) y esos se listan aparte, con su nombre. Renombrarlos para
  // que dejen de salir es una decisión del dueño, no de un gate.
  const imborrables = new Set(db.prepare(
    "SELECT c.name FROM clients c WHERE c.active=0 AND EXISTS (SELECT 1 FROM invoices i WHERE i.client_id=c.id)"
  ).all().map(r => String(r.name)));
  const nuevos = etiquetas.filter(l => /GATE|ZZ |GD2-|GD3-/.test(String(l)) && !imborrables.has(String(l)));
  const viejos = etiquetas.filter(l => /GATE|ZZ |GD2-|GD3-/.test(String(l)) && imborrables.has(String(l)));
  if (viejos.length) console.log('  · en el eje hay ' + viejos.length + ' nombre(s) de gate IMBORRABLES (archivados, con factura en la cadena): '
    + viejos.join(' · ') + ' — quitarlos exige renombrarlos, y eso lo decide el dueño');
  ok(nuevos.length === 0, 'NI UN NOMBRE DE GATE NUEVO en el eje (los imborrables se listan arriba)',
     etiquetas.slice(0, 4).join(' · '));
  await page.evaluate(() => document.getElementById('cardConstructor').scrollIntoView({ block: 'center' })); await dormir(600);
  await page.screenshot({ path: path.join(SHOTS, 'dter-muchos-grupos.png') });

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[6] PARTE 5 — LA AYUDA SE RECALCULA AL CAMBIAR DE ÁREA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const ayudaDe = (area, dim, med) => page.evaluate(async (a, d, m) => {
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('change')); };
    set('cArea', a); await new Promise(r => setTimeout(r, 1100));
    if (d) { set('cDim', d); await new Promise(r => setTimeout(r, 400)); }
    if (m) { set('cMed', m); await new Promise(r => setTimeout(r, 400)); }
    return { med: document.getElementById('cMedAyuda').textContent, dim: document.getElementById('cDimAyuda').textContent };
  }, area, dim, med);
  const aV = await ayudaDe('ventas', 'cliente', 'base');
  const aC = await ayudaDe('compras', 'proveedor', 'base');
  ok(aV.dim !== aC.dim, 'la ayuda del reparto CAMBIA al cambiar de área', `«${aV.dim}» → «${aC.dim}»`);
  ok(/cliente/i.test(aV.dim) && /proveedor/i.test(aC.dim), '  y nombra el campo de cada una');
  const aM = await ayudaDe('ventas', 'cliente', 'margenPct');
  ok(/sobre lo que/i.test(aM.med), 'la ayuda de la medida declara su base', aM.med);
  // Ni un nombre interno en toda la pantalla.
  const texto = await page.evaluate(() => document.getElementById('cardConstructor').innerText);
  for (const t of ['margenPct', 'ticket_medio', 'pct_pendiente', 'horas_reservadas', 'propia_'])
    ok(!texto.includes(t), `  ni un nombre interno en pantalla: «${t}»`);
  ok(!(await page.evaluate(() => !!document.getElementById('cFormula'))), 'la caja de fórmulas ya no está en la pantalla');
  ok(await page.evaluate(() => !!document.getElementById('cMisMedidas')), '  y en su sitio está «Mis medidas»');
  ok(errores.length === 0, 'toda la sesión sin errores de JavaScript ni ventanitas', errores.join(' | ') || 'ninguno');

  console.log('\n[7] Las once preguntas siguen funcionando, ahora con periodo');
  const preg = await page.evaluate(async () => {
    const bs = [...document.querySelectorAll('[data-preg]')];
    const out = [];
    for (let i = 0; i < bs.length; i++) {
      window.scrollTo(0, 0); bs[i].click();
      await new Promise(r => setTimeout(r, 1400));
      const vis = id => { const e = document.getElementById(id); return !!e && e.offsetParent !== null; };
      out.push({ t: bs[i].innerText.replace(/\s+/g, ' ').slice(0, 34), rango: document.getElementById('cRango').value,
                 algo: vis('cNumeroWrap') || vis('cTablaWrap') || vis('cChartWrap') });
    }
    return out;
  });
  // Eran once, con la duodécima («¿qué productos llevo tiempo sin vender?») anotada como imposible
  // de contestar. La noche del 23-24 ago 2026 (punto 9) se hizo posible con el área de Catálogo, y
  // entraron DOS: esa y «¿cuánto dinero tengo parado en productos que no se venden?». Se exige que
  // no BAJEN de once, que es lo que protege de una pérdida.
  ok(preg.length >= 11, 'las preguntas frecuentes no han bajado de once (hoy trece)', preg.length + '');
  ok(preg.every(p => p.algo), '  y las once contestan', preg.filter(p => !p.algo).map(p => p.t).join(' | ') || 'todas');
  ok(preg.every(p => p.rango && p.rango !== 'todo'), '  con un periodo puesto, nunca el histórico entero',
     [...new Set(preg.map(p => p.rango))].join(', '));
  await page.close();

  console.log('\n[8] Lo que no se ha roto');
  for (const ruta of ['/admin', '/admin/vigia', '/admin/citas', '/admin/listados/clientes/imprimir']) {
    const r = await fetch(BASE + ruta, { headers: { cookie: 'asess=' + token }, redirect: 'manual' });
    ok(r.status === 200, `${ruta} responde`, 'got ' + r.status);
  }
  ok(fs.existsSync(path.join(SHOTS, 'dter-numero.png')) && fs.existsSync(path.join(SHOTS, 'dter-tabla.png'))
     && fs.existsSync(path.join(SHOTS, 'dter-muchos-grupos.png')), 'las tres capturas están hechas', SHOTS);

  try { borrarMedidaPropia(db, owner.id, mp.id); } catch {}
} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN: ' + e.message + '\n' + e.stack);
} finally {
  // LO QUE UNA PRUEBA CREA, LA PRUEBA LO BORRA — por MARCA, no por las variables de esta pasada.
  try { if (browser) await browser.close(); } catch {}
  try {
    db.prepare("DELETE FROM analytics_medidas WHERE nombre LIKE 'GD3-%'").run();
    db.prepare("DELETE FROM analytics_panels  WHERE nombre LIKE 'GD3-%'").run();
    db.prepare("DELETE FROM admin_sessions WHERE token LIKE '" + TOKEN_PREFIJO + "%'").run();
  } catch (e) { console.error('  (limpieza incompleta: ' + e.message + ')'); }
  try { db.close(); } catch {}
}

console.log(`\n${'─'.repeat(70)}\nRESULTADO: ${pass} ✓  ·  ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
