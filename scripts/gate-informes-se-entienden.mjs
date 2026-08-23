// GATE de la FICHA D-bis — la pantalla de informes se hace entender.
//   node scripts/gate-informes-se-entienden.mjs
//
// ESTE GATE EXISTE PORQUE EL ANTERIOR DIO 97 ✓ · 0 ✗ SOBRE UN BOTÓN QUE NO FUNCIONABA.
// Aquel comprobaba el guardado llamando a la API con un cuerpo JSON que escribía yo. Probaba que el
// servidor guarda cuando le llega un nombre; no probaba nada del tramo donde estaba la avería. Las
// cuatro reglas de CLAUDE.md nacen de ahí y este gate las aplica:
//
//   1. NADA POR DENTRO. Si el usuario pulsa un botón, aquí se pulsa ESE botón. Ni una aserción de
//      guardado llama a `fetch` directamente.
//   2. TAMBIÉN CUANDO EL USUARIO DICE QUE NO: cancelar, dejar el campo vacío, escribir solo espacios.
//      Los tres eran caminos muertos y silenciosos.
//   3. CON LAS VENTANITAS SILENCIADAS. Es la avería real: Chrome ofrece «Impedir que esta página cree
//      cuadros de diálogo adicionales» en el SEGUNDO diálogo seguido, y a partir de ahí `prompt`
//      devuelve null sin enseñar nada. Aquí se simula neutralizándolas y se exige que el producto
//      siga funcionando, no que se disculpe.
//   4. SE MIRA LA CAPTURA. Se hace una y se comprueba sobre PÍXELES lo que solo se ve mirando: que el
//      aviso no queda debajo de la burbuja de DISA y que el nombre del índice está a la izquierda.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { tenantDb, APP_DIR, launchOpts } from './lib/gate-env.mjs';
import { cruzar, camposPara, AREAS } from '../modules/erp/constructor-analitica.js';

const SLUG = 'desarrollo-bamburu';
const DB_PATH = tenantDb(SLUG);
const BASE = `https://${SLUG}.bamburu.com`;          // la dirección PÚBLICA, como la usa el dueño
const HOST = `${SLUG}.bamburu.com`;
const RID = randomBytes(3).toString('hex');
const MARCA = 'GD2-' + RID;
const TOKEN_PREFIJO = 'gate-dbis-';
const CAPTURA = path.join(process.env.HOME || '/home/ubuntu', 'informes-shots', 'ficha-d-bis.png');
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

const nPaneles = () => db.prepare('SELECT COUNT(*) c FROM analytics_panels').get().c;

// Una pestaña con su contexto propio (dos pestañas comparten cookies y la segunda pisa a la primera).
async function abrir({ silenciarDialogos = false } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setCookie({ name: 'asess', value: token, domain: HOST, path: '/', secure: true });
  const estado = { errores: [], dialogos: [] };
  page.on('pageerror', e => estado.errores.push(String(e && e.message || e)));
  // Si sale UNA ventanita del navegador en esta pantalla, es un fallo por sí solo: se anota y se acepta
  // para no dejar la pestaña colgada.
  page.on('dialog', async d => { estado.dialogos.push(d.type() + ': ' + d.message().slice(0, 60)); await d.dismiss(); });
  if (silenciarDialogos) {
    // LO QUE HACE CHROME cuando el usuario marca la casilla: los diálogos dejan de salir y devuelven
    // el valor de «cancelar», en silencio.
    await page.evaluateOnNewDocument(() => { window.prompt = () => null; window.confirm = () => false; });
  }
  await page.goto(BASE + '/admin/analytics', { waitUntil: 'networkidle0' });
  await dormir(1600);
  return { page, estado };
}
const modalAbierto = page => page.evaluate(() => !!document.querySelector('.modal-overlay.open'));
const textoModal = page => page.evaluate(() => { const m = document.querySelector('.modal-overlay.open'); return m ? m.innerText.replace(/\s+/g, ' ').trim() : null; });
const escribir = (page, id, v) => page.evaluate((i, x) => { const e = document.getElementById(i); e.value = x; e.dispatchEvent(new Event('input')); }, id, v);
const pulsarModal = (page, cual) => page.evaluate((c) => document.querySelector('.modal-overlay.open [data-pd="' + c + '"]').click(), cual);

try {
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] EL MOTOR: la dimensión que faltaba y el gráfico de dos series');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  ok(!!AREAS.clientes.dimensiones.cliente, 'el área de Clientes ya tiene la dimensión «Cliente»');
  const deuda = cruzar(db, { area: 'clientes', dimension: 'cliente', medidas: ['deuda'], hasPerm: todo, limit: 999 });
  ok(deuda.filas.length > 0, '  y «¿quién me debe dinero?» devuelve nombres', deuda.filas.length + ' clientes');
  const dos = cruzar(db, { area: 'agenda', dimension: 'fecha', periodo: 'mes', hasPerm: todo, limit: 99,
    medidas: ['horas_ocupadas', 'horas_abiertas'] });
  ok(dos.medidas.length === 2, 'el motor devuelve DOS medidas para «trabajadas frente a abiertas»', dos.medidas.join(' + '));
  const cv = camposPara(todo, 'ventas');
  ok(cv.medidas.beneficio.etiqueta === 'Beneficio en euros', 'renombrada: «Beneficio en euros»', cv.medidas.beneficio.etiqueta);
  ok(cv.medidas.margenPct.etiqueta === 'Margen en %', 'renombrada: «Margen en %»', cv.medidas.margenPct.etiqueta);
  ok(!!cv.medidas.margenPct.ayuda, '  y su base no se pierde: va en la ayuda', cv.medidas.margenPct.ayuda);
  // NADA SE PIERDE: mismas medidas y dimensiones que antes, más la de Clientes.
  const totalDims = Object.values(AREAS).reduce((n, a) => n + Object.keys(a.dimensiones).length, 0);
  const totalMeds = Object.values(AREAS).reduce((n, a) => n + Object.keys(a.medidas).length, 0);
  // NADA SE PIERDE, contado antes y después: antes 32 dimensiones y 31 medidas; ahora 33 y 31.
  // La única diferencia es la dimensión «Cliente» que faltaba. Ni una medida menos.
  ok(totalDims === 33 && totalMeds === 31, 'el catálogo entero sigue ahí: 32 dimensiones + la nueva = 33 · 31 medidas, las mismas',
     totalDims + ' dims · ' + totalMeds + ' medidas');

  browser = await puppeteer.launch(launchOpts());

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] NO QUEDA NI UNA VENTANITA DEL NAVEGADOR EN ESTA PANTALLA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const fuente = fs.readFileSync(path.join(APP_DIR, 'modules', 'erp', 'routes', 'analytics.js'), 'utf8');
  const vivo = fuente.split('\n').filter(l => !/^\s*\/\//.test(l.trim())).join('\n');
  const quedan = (vivo.match(/(?<![.\w])(prompt|confirm)\s*\(/g) || []).filter(x => !x.includes('confirmarEnPagina'));
  ok(quedan.length === 0, 'ni un prompt() ni un confirm() en el código vivo de Analíticas', quedan.join(', ') || 'ninguno');
  ok(typeof (await import('fs')).readFileSync(path.join(APP_DIR, 'modules', 'erp', 'layout.js'), 'utf8') === 'string'
     && fs.readFileSync(path.join(APP_DIR, 'modules', 'erp', 'layout.js'), 'utf8').includes('window.pedirDatos'),
     'existe el panel compartido `pedirDatos` (reutilizado, no inventado)');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] REGLA 1 — SE PULSA EL BOTÓN. Guardar por el camino del usuario');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  {
    const { page, estado } = await abrir();
    await page.click('#btnCrear'); await dormir(2200);
    const antes = nPaneles();
    await page.click('#cGuardarNuevo'); await dormir(700);
    ok(await modalAbierto(page), 'al pulsar Guardar se abre un panel DENTRO de la página');
    ok(estado.dialogos.length === 0, '  y NO sale ninguna ventanita del navegador', estado.dialogos.join(' | ') || 'ninguna');
    const t = await textoModal(page);
    ok(/Guardar este informe/.test(t), '  el panel dice qué es', (t || '').slice(0, 40));
    const propuesto = await page.evaluate(() => document.getElementById('pd-nombre').value);
    ok(propuesto && propuesto.length > 4, '  trae un nombre propuesto ya escrito', JSON.stringify(propuesto));
    ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'pd-nombre'),
       '  con el foco puesto en él');
    ok(/Compartirlo con el equipo/.test(t), '  y la casilla de compartir con su explicación');
    await escribir(page, 'pd-nombre', MARCA + ' guardado a mano');
    await pulsarModal(page, 'ok'); await dormir(1800);
    ok(nPaneles() === antes + 1, 'PULSANDO EL BOTÓN, el informe se guarda', `${antes} → ${nPaneles()}`);
    ok(!(await modalAbierto(page)), '  y el panel se cierra solo');
    ok(estado.errores.length === 0, '  sin un solo error de JavaScript', estado.errores.join(' | ') || 'ninguno');
    // REGLA 4 (parte 2): la prueba es el informe EN LA LISTA, y se sube hasta ella.
    const v = await page.evaluate(() => {
      const c = document.getElementById('misInformes');
      const card = c.closest('.card').getBoundingClientRect();
      return { enLista: /guardado a mano/.test(c.innerText), enPantalla: card.bottom > 0 && card.top < innerHeight };
    });
    ok(v.enLista, 'el informe aparece en «Mis informes guardados»');
    ok(v.enPantalla, '  y la página ha subido hasta ella: la prueba se VE');
    await page.close();
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] REGLA 2 — CUANDO EL USUARIO DICE QUE NO. Los tres caminos que morían en silencio');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  for (const [nombre, valor] of [['vacío', ''], ['solo espacios', '    ']]) {
    const { page } = await abrir();
    await page.click('#btnCrear'); await dormir(2200);
    const antes = nPaneles();
    await page.click('#cGuardarNuevo'); await dormir(700);
    await escribir(page, 'pd-nombre', valor);
    await pulsarModal(page, 'ok'); await dormir(900);
    const err = await page.evaluate(() => { const e = document.querySelector('.modal-overlay.open .pd-err'); return e && e.style.display !== 'none' ? e.textContent : null; });
    ok(await modalAbierto(page), `nombre ${nombre}: el panel NO se cierra`);
    ok(!!err, `  y lo dice ahí mismo, en rojo`, err || 'NO DICE NADA');
    ok(nPaneles() === antes, `  y no guarda nada`, `${antes} → ${nPaneles()}`);
    await page.close();
  }
  {
    const { page } = await abrir();
    await page.click('#btnCrear'); await dormir(2200);
    const antes = nPaneles();
    await page.click('#cGuardarNuevo'); await dormir(700);
    await pulsarModal(page, 'x'); await dormir(700);
    ok(!(await modalAbierto(page)) && nPaneles() === antes, 'cancelar: se cierra y no guarda (y eso sí es correcto)');
    // Escape y clic fuera, que el encargo pide y ningún modal del producto tenía.
    await page.click('#cGuardarNuevo'); await dormir(600);
    await page.keyboard.press('Escape'); await dormir(500);
    ok(!(await modalAbierto(page)), 'se cierra con Escape');
    await page.click('#cGuardarNuevo'); await dormir(600);
    await page.evaluate(() => { const m = document.querySelector('.modal-overlay.open');
      m.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    await dormir(500);
    ok(!(await modalAbierto(page)), 'y pulsando fuera');
    await page.close();
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] REGLA 3 — CON LAS VENTANITAS SILENCIADAS. La avería, exactamente');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  {
    const { page, estado } = await abrir({ silenciarDialogos: true });
    await page.click('#btnCrear'); await dormir(2200);
    const antes = nPaneles();
    await page.click('#cGuardarNuevo'); await dormir(800);
    ok(await modalAbierto(page), 'CON LOS DIÁLOGOS SILENCIADOS el panel sale igual (antes aquí no pasaba NADA)');
    await escribir(page, 'pd-nombre', MARCA + ' silenciado');
    await pulsarModal(page, 'ok'); await dormir(1800);
    ok(nPaneles() === antes + 1, '  y guarda igual', `${antes} → ${nPaneles()}`);
    ok(estado.errores.length === 0, '  sin errores', estado.errores.join(' | ') || 'ninguno');
    await page.close();
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[6] LAS ONCE PREGUNTAS: se pulsan y contestan');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  {
    const { page, estado } = await abrir();
    const tarjetas = await page.evaluate(() => [...document.querySelectorAll('[data-preg]')].map(b => b.innerText.replace(/\s+/g, ' ').trim()));
    ok(tarjetas.length === 11, 'hay ONCE preguntas (la 12ª queda fuera y anotada, ver TABLERO)', tarjetas.length + '');
    ok(tarjetas.some(t => /Quién me debe dinero/.test(t)), '  entre ellas «¿Quién me debe dinero?» (la que no se podía)');
    ok(tarjetas.some(t => /horas trabajo de verdad/.test(t)), '  y «¿Cuántas horas trabajo de verdad…?» (la de dos series)');
    ok(!tarjetas.some(t => /parados/.test(t)), '  y NO está la de productos parados, que no se puede contestar');
    // Se PULSAN todas. Cada una tiene que dejar el constructor abierto y con algo dibujado.
    let dibujadas = 0, mudas = [];
    for (let i = 0; i < tarjetas.length; i++) {
      await page.evaluate((n) => { window.scrollTo(0, 0); document.querySelector('[data-preg="' + n + '"]').click(); }, i);
      await dormir(1500);
      const r = await page.evaluate(() => {
        const cv = document.getElementById('cChart'); let pintado = false;
        try { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
          for (let k = 3; k < d.length; k += 4) if (d[k] !== 0) { pintado = true; break; } } catch {}
        const tabla = document.getElementById('cTablaWrap');
        const vacio = document.getElementById('cVacio');
        return { abierto: document.getElementById('cardConstructor').offsetParent !== null,
                 pintado, tabla: tabla.style.display !== 'none' && tabla.innerText.length > 10,
                 explica: vacio && vacio.style.display !== 'none' && vacio.innerText.length > 10 };
      });
      if (r.abierto && (r.pintado || r.tabla || r.explica)) dibujadas++; else mudas.push(i + 1 + ' · ' + tarjetas[i].slice(0, 40));
    }
    ok(dibujadas === tarjetas.length, 'las ONCE abren el constructor y contestan (con dibujo o diciendo que no hay datos)',
       mudas.length ? 'mudas: ' + mudas.join(' | ') : `${dibujadas}/${tarjetas.length}`);
    ok(estado.dialogos.length === 0, '  y ninguna saca una ventanita del navegador');
    // La de dos series pinta DOS líneas, no una.
    const iDos = tarjetas.findIndex(t => /horas trabajo de verdad/.test(t));
    await page.evaluate((n) => { window.scrollTo(0, 0); document.querySelector('[data-preg="' + n + '"]').click(); }, iDos);
    await dormir(1800);
    const nSeries = await page.evaluate(() => { try { return Chart.getChart(document.getElementById('cChart')).data.datasets.length; } catch { return -1; } });
    ok(nSeries === 2, '«trabajadas frente a abiertas» pinta DOS series en el mismo gráfico', nSeries + ' series');
    await page.close();
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[7] LA FRASE, Y QUE NINGUNA PALABRA QUEDE SUELTA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const { page, estado } = await abrir();
  await page.click('#btnCrear'); await dormir(2200);
  const frase = await page.evaluate(() => {
    const f = document.querySelector('.frase');
    return { texto: f ? f.innerText.replace(/\s+/g, ' ').trim() : null,
             ayudas: [...document.querySelectorAll('.frase .fr-a')].map(a => a.textContent.trim()),
             selects: [...document.querySelectorAll('.frase select')].length,
             avanzadoAbierto: document.getElementById('cAvanzado').open,
             formulaVisible: document.getElementById('cFormula').offsetParent !== null };
  });
  ok(/^De .* quiero saber .* repartido por/.test(frase.texto), 'la pantalla se lee como una frase', (frase.texto || '').slice(0, 70) + '…');
  ok(frase.selects === 5, '  con los cinco desplegables de siempre (no se pierde ninguno)', frase.selects + '');
  ok(frase.ayudas.length === 5 && frase.ayudas.every(a => a.length > 5),
     '  y CADA UNO lleva su línea de ayuda debajo', frase.ayudas.join(' / '));
  ok(!frase.avanzadoAbierto && !frase.formulaVisible, 'la fórmula está en «Opciones avanzadas», plegada');
  // La ayuda de la fórmula, en las palabras del usuario.
  await page.evaluate(() => { document.getElementById('cAvanzado').open = true;
    const c = document.getElementById('cCalcOn'); c.checked = true; c.dispatchEvent(new Event('change')); });
  await dormir(900);
  const ayudaF = await page.evaluate(() => document.getElementById('cFormulaAyuda').textContent);
  ok(/Facturado \(sin IVA\)/.test(ayudaF), 'la ayuda de la fórmula usa las palabras del usuario', ayudaF.slice(0, 70) + '…');
  for (const tecnico of ['base', 'margenPct', 'unidades'])
    ok(!new RegExp('(^|[^a-zA-Z])' + tecnico + '([^a-zA-Z]|$)').test(ayudaF), `  y no enseña el nombre interno «${tecnico}»`);
  // Y una fórmula escrita EN PALABRAS tiene que dar un número.
  await page.evaluate(() => { const f = document.getElementById('cFormula');
    f.value = 'Beneficio en euros / Facturado (sin IVA) * 100'; f.dispatchEvent(new Event('input')); });
  await dormir(1800);
  const calc = await page.evaluate(() => { try { const ch = Chart.getChart(document.getElementById('cChart'));
    return ch.data.datasets[0].data.filter(x => x != null).length; } catch { return -1; } });
  ok(calc > 0, 'una fórmula escrita EN PALABRAS se calcula igual', calc + ' puntos con valor');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[8] REGLA 4 — SE MIRA LA CAPTURA (sobre píxeles, no de oídas)');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  await page.evaluate(() => window.toast('Informe guardado'));
  await dormir(400);
  const pintura = await page.evaluate(() => {
    const t = [...document.querySelectorAll('body > div')].find(e => (e.textContent || '').trim() === 'Informe guardado');
    const fab = document.getElementById('disaFab');
    const rt = t && t.getBoundingClientRect(), rf = fab && fab.getBoundingClientRect();
    const solapa = rt && rf ? !(rt.right < rf.left || rt.left > rf.right || rt.bottom < rf.top || rt.top > rf.bottom) : null;
    const fila = document.querySelector('.inf-fila');
    const n = fila && fila.querySelector('.inf-n').getBoundingClientRect();
    const v = fila && fila.querySelector('.inf-v').getBoundingClientRect();
    return { hayToast: !!t, solapa, zToast: t ? getComputedStyle(t).zIndex : null,
             nombreX: n ? Math.round(n.left) : null, flechaX: v ? Math.round(v.left) : null,
             filaX: fila ? Math.round(fila.getBoundingClientRect().left) : null };
  });
  ok(pintura.hayToast, 'el aviso se pinta');
  ok(pintura.solapa === false, 'EL AVISO YA NO QUEDA DEBAJO DE LA BURBUJA DE DISA', pintura.solapa === false ? 'no se tocan' : 'SE SOLAPAN');
  ok(Number(pintura.zToast) > 99999, '  y además queda por encima si alguien arrastra la burbuja', 'z-index ' + pintura.zToast);
  ok(pintura.nombreX !== null && pintura.nombreX < pintura.flechaX,
     'EL ÍNDICE: el nombre a la izquierda y la flechita a la derecha',
     `nombre en x=${pintura.nombreX} · flecha en x=${pintura.flechaX}`);
  ok(Math.abs(pintura.nombreX - pintura.filaX) < 12, '  y el nombre pegado al borde izquierdo de su fila',
     `nombre ${pintura.nombreX} vs fila ${pintura.filaX}`);
  fs.mkdirSync(path.dirname(CAPTURA), { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await dormir(500);
  await page.screenshot({ path: CAPTURA, fullPage: false });
  ok(fs.existsSync(CAPTURA) && fs.statSync(CAPTURA).size > 20000, 'captura de la pantalla terminada guardada', CAPTURA);
  ok(estado.errores.length === 0, 'y toda la sesión sin un error de JavaScript', estado.errores.join(' | ') || 'ninguno');
  await page.close();

  console.log('\n[9] Lo que NO se ha roto');
  const r1 = await fetch(BASE + '/admin/listados/clientes/imprimir', { headers: { cookie: 'asess=' + token }, redirect: 'manual' });
  ok(r1.status === 200, 'un listado de la ficha C sigue imprimiéndose', 'got ' + r1.status);
  for (const ruta of ['/admin', '/admin/vigia', '/admin/citas']) {
    const r = await fetch(BASE + ruta, { headers: { cookie: 'asess=' + token }, redirect: 'manual' });
    ok(r.status === 200, `${ruta} responde`, 'got ' + r.status);
  }

} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN: ' + e.message + '\n' + e.stack);
} finally {
  try { if (browser) await browser.close(); } catch {}
  try {
    db.prepare("DELETE FROM analytics_panels WHERE nombre LIKE 'GD2-%'").run();
    db.prepare("DELETE FROM admin_sessions WHERE token LIKE '" + TOKEN_PREFIJO + "%'").run();
  } catch (e) { console.error('  (limpieza incompleta: ' + e.message + ')'); }
  try { db.close(); } catch {}
}

console.log(`\n${'─'.repeat(70)}\nRESULTADO: ${pass} ✓  ·  ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
