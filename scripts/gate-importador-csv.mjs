// ════════════════════════════════════════════════════════════════════════════════════════════════
// GATE — EL IMPORTADOR DE CSV (ficha H · H1 · H2 · H3)
//
// LO QUE ESTE GATE EXISTE PARA IMPEDIR:
//
//   1. QUE LA VISTA PREVIA ESCRIBA. La promesa entera del importador es «nada entra hasta que lo
//      confirmes». No se comprueba leyendo la pantalla: se CUENTAN las filas de la base antes y
//      después de analizar tres veces (una de ellas remapeando columnas), y tienen que ser las
//      mismas. Y se cancela desde el navegador, con el botón de verdad, y se vuelve a contar.
//
//   2. QUE «O TODO O NADA» SEA UNA FRASE. Se PROVOCA un fallo a mitad de la transacción con un
//      disparador de SQLite, y se exige que no quede NI UNA de las filas anteriores ni el lote a
//      medias. Medir solo el camino feliz habría dado verde con la atomicidad rota.
//
//   3. QUE LA PANTALLA MUERA EN SILENCIO. Se compila el HTML CRUDO que sale del servidor. Escuchar
//      la consola no sirve (un SyntaxError de un <script> inline no emite ningún evento) y compilar
//      el DOM tampoco (el parser trunca el trozo roto y lo que queda compila). Es la lección del
//      22 ago, y esta pantalla se sirve desde una plantilla de 13 KB: es justo el caso.
//
//   4. QUE EL IMPORTADOR SE COMA A LA MIGRACIÓN ASISTIDA (H3). Se exige que la asistida siga
//      entera, ofrecida PRIMERO, y que las facturas sigan yendo por ella — en la pantalla y en el
//      código. El día que alguien meta facturas en el importador, este gate se pone rojo y obliga
//      a leer por qué no están.
//
//   5. QUE LA PUERTA NO TENGA CANDADO. Escribir exige el permiso de alta (`clients.create` /
//      `products.create`), el mismo que el formulario. Se prueba con un empleado real sin permisos.
//
// NEGOCIO PROPIO (declarado en EMPIEZAN_DE_CERO): este gate DA DE ALTA clientes y productos. En el
// negocio de desarrollo dejaría basura y le movería los totales a los gates que miden neto-cero.
//
//   node scripts/gate-importador-csv.mjs
import puppeteer from 'puppeteer';
import path from 'path';
import { writeFileSync, unlinkSync } from 'fs';
import { randomBytes } from 'crypto';
import Database from 'better-sqlite3';
import { launchOpts } from './lib/gate-env.mjs';
import { controlDb, getTenantBySlug } from '../core/control-db.js';
import { provisionTenant } from '../core/tenant-provisioning.js';
// 25 ago 2026 · Direcciones de dominio IMPOSIBLE (`.test`), no de dominios que existen de verdad.
// `ej.com`, `minegocio.com` y `barpepe.com` son dominios reales de otra gente: un correo de
// recuperación de contraseña dirigido ahí acaba en casa de un desconocido. `.test` está reservado
// justo para esto (RFC 2606) y la puerta del correo lo desvía a simulación. Ver docs/censo-correos.md.

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dormir = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { if (c) { pass++; console.log('  ✓ ' + m + (x ? ' — ' + x : '')); } else { fail++; console.error('  ✗ FALLO: ' + m + (x ? ' — ' + x : '')); } };

// El fichero de prueba va bajo $HOME: el Chromium de snap no lee /tmp y el <input type=file> se
// queda sin nada, con un rojo que no tiene que ver con lo que se está probando.
//
// ⚠️ Y NO PUEDE EMPEZAR POR PUNTO — medido el 23 ago 2026, costó un rojo entero. El confinamiento
// del snap concede `$HOME/[^.]**`, o sea TODO menos lo oculto. Con un nombre oculto Chromium ve el
// fichero y hasta da bien su `size`, pero al leerlo devuelve `NotReadableError`: el `FileReader` de
// la pantalla falla, el botón se queda en «Leyendo…» y el gate muere esperando la vista previa.
// Parece un producto roto y es el nombre del fichero de prueba. Un Blob del mismo contenido se lee
// perfectamente, y esa es la forma rápida de distinguir una cosa de la otra.
const CSV_DIR = process.env.HOME || APP;
const CSV_BUENO = path.join(CSV_DIR, 'gate-imp-' + randomBytes(3).toString('hex') + '.csv');
// Y uno DELIBERADAMENTE ilegible, con el mismo truco que costó el rojo: oculto, así que el navegador
// lo ve pero no lo lee. Es la única forma barata de provocar un `NotReadableError` de verdad.
const CSV_ILEGIBLE = path.join(CSV_DIR, '.gate-imp-ilegible-' + randomBytes(3).toString('hex') + '.csv');

const tenants = [];
function limpiar() {
  try { unlinkSync(CSV_BUENO); } catch {}
  try { unlinkSync(CSV_ILEGIBLE); } catch {}
  for (const { slug, db } of tenants) {
    try { if (db) db.close(); } catch {}
    const t = getTenantBySlug(slug);
    if (t) controlDb.prepare('DELETE FROM tenant_sessions WHERE tenant_id=?').run(t.id);
    controlDb.prepare('DELETE FROM tenants WHERE slug=?').run(slug);
    if (t) {
      const abs = path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP, t.db_filename);
      for (const f of [abs, abs + '-wal', abs + '-shm']) { try { unlinkSync(f); } catch {} }
    }
  }
}
async function nuevoNegocio(nombre) {
  const r = randomBytes(3).toString('hex');
  const alta = await provisionTenant({ businessName: nombre + ' ' + r, ownerName: 'Dueña ' + r,
    email: 'gic-' + r + '@bamburu.test', password: 'Gate.Imp.' + r + '!', phone: '+34 600 000 000' });
  const t = getTenantBySlug(alta.slug);
  const db = new Database(path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP, t.db_filename));
  tenants.push({ slug: alta.slug, db });
  const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner'").get();
  return { slug: alta.slug, db, owner, ...sesion(db, owner.id), base: 'http://' + alta.slug + '.localhost:3000' };
}
function sesion(db, userId) {
  const now = Math.floor(Date.now() / 1000);
  const tok = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tok, userId, now, now + 3600, csrf);
  return { tok, csrf };
}
// Contexto PROPIO por pestaña: dos pestañas del mismo browser comparten cookies y la segunda sesión
// pisa a la primera, fingiendo rojos que no existen.
async function pestana(browser, N, tok) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
  await page.setCookie({ name: 'asess', value: tok, domain: N.slug + '.localhost', path: '/' });
  return { ctx, page };
}
const cuenta = (db, sql) => db.prepare(sql).get().n;

// EL FICHERO DEL ENCARGO, palabra por palabra: tres filas buenas y una mala.
const CSV = [
  'Nombre;NIF;Email;Ciudad',
  'Ana Ruiz Delgado;12345678Z;ana@ejemplo.com;Sevilla',
  'Bar Pepe SL;B12345674;admin@barpepe.test;Cádiz',
  ';99999999R;sinnombre@ejemplo.com;Huelva',
  'Carmen Gil Soto;X1234567L;carmen@ejemplo.com;Málaga',
].join('\n');

let browser = null;
try {
  writeFileSync(CSV_BUENO, CSV, 'utf8');
  browser = await puppeteer.launch(launchOpts());
  const N = await nuevoNegocio('Importador CSV');
  const pedir = (ruta, opts = {}) => fetch(N.base + ruta, {
    ...opts, headers: { cookie: 'asess=' + N.tok, ...(opts.headers || {}) },
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] LA PANTALLA EXISTE, ES LA PEDIDA, Y SU JS COMPILA (HTML CRUDO)');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const r1 = await pedir('/admin/migracion/importar', { redirect: 'follow' });
  const html = await r1.text();
  ok(r1.status === 200, 'responde 200', String(r1.status));
  ok(new URL(r1.url).pathname === '/admin/migracion/importar', 'y la URL FINAL es la pedida (no redirige)', new URL(r1.url).pathname);
  const bloques = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(b => b.trim());
  let rotos = 0;
  for (const b of bloques) { try { new Function(b); } catch (e) { rotos++; console.error('     ' + e.message); } }
  ok(bloques.length >= 2, 'trae ' + bloques.length + ' bloques <script> inline');
  ok(rotos === 0, 'y TODOS compilan desde el HTML crudo (no desde el DOM, que trunca el roto)');
  const mio = bloques.find(b => b.indexOf('impImportar') >= 0);
  ok(!!mio && mio.length > 8000, 'el bloque del importador llega ENTERO, sin truncar', (mio ? mio.length : 0) + ' chars');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] H3 · LA ASISTIDA SIGUE ENTERA Y SE OFRECE PRIMERO');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const h2 = await (await pedir('/admin/migracion')).text();
  ok(/La migración la hacemos nosotros, y es gratis/.test(h2), 'la asistida conserva su oferta');
  ok(/Pedir la migración/.test(h2), 'y su botón de siempre');
  // ⚙️ 24 ago 2026 · SE MIDE EL CUERPO DE LA PANTALLA, NO EL DOCUMENTO ENTERO. Esto comparaba
  // posiciones en todo el HTML, y el menú lateral se pinta ANTES que el contenido: desde que el
  // importador tiene su entrada en el rail —una de las catorce pantallas que estaban escondidas—,
  // su enlace aparecía el primero y la aserción cantaba que la asistida ya no iba delante.
  // Lo que se quiere afirmar es del CONTENIDO: que en esta pantalla se ofrece antes la asistida.
  const cuerpo = h2.slice(Math.max(0, h2.indexOf('<div class="ph"')));
  const posAsistida = cuerpo.indexOf('La migración la hacemos nosotros');
  const posImport   = cuerpo.indexOf('/admin/migracion/importar');
  ok(posImport > 0, 'la pantalla ofrece TAMBIÉN el importador');
  ok(posAsistida > 0 && posAsistida < posImport, 'y la asistida va PRIMERO: se suma, no la sustituye');
  ok(/[Ll]as facturas/.test(h2), 'y se dice en pantalla qué pasa con las facturas');
  ok(/no entran por aquí/.test(html), 'el importador también lo dice, en su propia pantalla');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] LA VISTA PREVIA NO ESCRIBE — MEDIDO EN LA BASE, NO EN LA PANTALLA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const antes = cuenta(N.db, 'SELECT COUNT(*) n FROM clients');
  const analizar = (cuerpo) => pedir('/api/erp/importar/analizar', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': N.csrf },
    body: JSON.stringify(cuerpo),
  });
  const ja = await (await analizar({ tipo: 'clientes', texto: CSV })).json();
  ok(ja.resumen && ja.resumen.total === 4, 've las 4 filas de datos (la cabecera no cuenta)', JSON.stringify(ja.resumen || {}));
  ok(ja.resumen && ja.resumen.buenas === 3 && ja.resumen.malas === 1, 'y dice 3 buenas · 1 mala');
  const mala = (ja.filas || []).find(f => f.errores.length);
  ok(!!mala && mala.n === 4, 'señala la fila 4 del FICHERO, no un índice interno', mala ? String(mala.n) : '—');
  ok(!!mala && /Nombre/.test(mala.errores[0]), 'y dice por qué falla', mala ? mala.errores[0] : '—');
  await analizar({ tipo: 'clientes', texto: CSV, mapeo: { name: 1, fiscal_id: 0 } });
  await analizar({ tipo: 'clientes', texto: CSV });
  ok(cuenta(N.db, 'SELECT COUNT(*) n FROM clients') === antes,
     'TRES análisis (uno remapeado) y la tabla no se ha movido', antes + ' → ' + cuenta(N.db, 'SELECT COUNT(*) n FROM clients'));
  ok(cuenta(N.db, 'SELECT COUNT(*) n FROM importaciones') === 0, 'y no hay ni un lote apuntado');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] EL RECORRIDO DEL ENCARGO, EN EL NAVEGADOR: subir → ver la mala → CANCELAR');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const { page } = await pestana(browser, N, N.tok);
  const errsPagina = [];
  page.on('pageerror', e => errsPagina.push(String((e && e.message) || e)));
  await page.goto(N.base + '/admin/migracion/importar', { waitUntil: 'networkidle0' });
  await dormir(600);
  await page.click('[data-tipo="clientes"]');
  await (await page.$('#impFichero')).uploadFile(CSV_BUENO);
  await dormir(300);
  await page.click('#impVer');
  await page.waitForFunction(() => document.getElementById('impPaso2').style.display === '', { timeout: 20000 });
  await dormir(700);

  const vista = await page.evaluate(() => ({
    resumen: (document.getElementById('impResumen') || {}).innerText || '',
    filasMalas: [...document.querySelectorAll('#impTabla tr.mala td.imp-fila-n')].map(e => e.textContent.trim()).filter(Boolean),
    motivos: [...document.querySelectorAll('#impTabla tr.mala td.err')].map(e => e.innerText.trim()),
    boton: (document.getElementById('impImportar') || {}).textContent || '',
    mapeoNombre: (() => { const s = document.querySelector('[data-campo="name"]'); return s && s.selectedOptions[0] ? s.selectedOptions[0].text : ''; })(),
  }));
  ok(/\b3\b/.test(vista.resumen) && /\b1\b/.test(vista.resumen), 'la pantalla dice 3 entran y 1 falla', vista.resumen.replace(/\n+/g, ' | '));
  ok(vista.filasMalas.length === 1 && vista.filasMalas[0] === '4', 'y marca EXACTAMENTE la fila 4', vista.filasMalas.join(','));
  ok(/obligatorio/i.test(vista.motivos.join(' ')), 'con el motivo escrito al lado', vista.motivos.join(' / '));
  ok(vista.mapeoNombre === 'Nombre', 'y el mapeo automático acertó la columna del nombre', vista.mapeoNombre);
  ok(/3/.test(vista.boton), 'el botón dice cuántas van a entrar', vista.boton.trim());

  const antesCancelar = cuenta(N.db, 'SELECT COUNT(*) n FROM clients');
  await page.click('#impCancelar');
  await dormir(700);
  ok(cuenta(N.db, 'SELECT COUNT(*) n FROM clients') === antesCancelar,
     'AL CANCELAR NO HA ENTRADO NADA', antesCancelar + ' → ' + cuenta(N.db, 'SELECT COUNT(*) n FROM clients'));
  ok(cuenta(N.db, 'SELECT COUNT(*) n FROM importaciones') === 0, 'ni queda apuntada la importación');
  ok(await page.evaluate(() => document.getElementById('impPaso1').style.display === ''), 'y la pantalla vuelve al principio');

  // ── UN FICHERO QUE NO SE PUEDE LEER NO DEJA EL BOTÓN MUERTO ────────────────────────────────
  // Salió de un rojo de este mismo gate (23 ago 2026): el botón se ponía en «Leyendo…», el
  // `FileReader` fallaba y NADIE lo devolvía a su sitio. Se veía el aviso y detrás quedaba un mando
  // deshabilitado para siempre, sin más salida que recargar. Se provoca de verdad —fichero oculto,
  // que el confinamiento del snap deja ver pero no leer— porque un fallo simulado no habría
  // recorrido el mismo camino.
  writeFileSync(CSV_ILEGIBLE, CSV, 'utf8');
  await (await page.$('#impFichero')).uploadFile(CSV_ILEGIBLE);
  await dormir(300);
  await page.click('#impVer');
  await dormir(1500);
  const trasFallo = await page.evaluate(() => ({
    texto: (document.getElementById('impVer') || {}).textContent || '',
    inerte: !!(document.getElementById('impVer') || {}).disabled,
    paso2: (document.getElementById('impPaso2') || {}).style.display,
  }));
  ok(!trasFallo.inerte && /vista previa/i.test(trasFallo.texto),
     'un fichero ILEGIBLE avisa y DEVUELVE el botón a su sitio: no se queda muerto en «Leyendo…»',
     trasFallo.texto.trim() + (trasFallo.inerte ? ' · DESHABILITADO' : ' · se puede volver a pulsar'));
  ok(trasFallo.paso2 === 'none', 'y no se abre una vista previa vacía');
  ok(errsPagina.length === 0, 'sin errores de página en todo el recorrido', errsPagina.join(' | ') || 'ninguno');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] CONFIRMAR: entran las 3, la mala se queda fuera y se dice');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const ri = await pedir('/api/erp/importar/importar', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': N.csrf },
    body: JSON.stringify({ tipo: 'clientes', texto: CSV, nombre: 'gate.csv' }),
  });
  const ji = await ri.json();
  ok(ri.status === 200 && ji.creadas === 3, 'crea 3', JSON.stringify({ s: ri.status, c: ji.creadas, o: ji.omitidas }));
  ok(ji.omitidas === 1 && ji.filas_omitidas.length === 1, 'y devuelve cuál se quedó fuera y por qué');
  ok(cuenta(N.db, 'SELECT COUNT(*) n FROM clients WHERE active=1') === antes + 3, 'la tabla tiene 3 más');
  ok(N.db.prepare("SELECT COUNT(*) n FROM clients WHERE client_code LIKE 'CLI-%'").get().n >= 3,
     'con código interno CLI-NNNN: pasó por el servicio de alta compartido, no por un INSERT propio');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[6] O ENTRA TODO O NO ENTRA NADA — PROVOCANDO EL FALLO A MITAD');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // No se mide el camino feliz: se sabotea la TERCERA fila con un disparador y se exige que las dos
  // anteriores tampoco queden. Sin transacción, este bloque queda en rojo.
  {
    const CSV_TX = ['Nombre;NIF', 'Tx Uno;A44444444', 'Tx Dos;A55555555', 'Tx Tres;A66666666'].join('\n');
    const pre = cuenta(N.db, 'SELECT COUNT(*) n FROM clients');
    const preLotes = cuenta(N.db, 'SELECT COUNT(*) n FROM importaciones');
    N.db.exec("CREATE TRIGGER trg_gate_sabotaje BEFORE INSERT ON clients WHEN NEW.fiscal_id='A66666666' BEGIN SELECT RAISE(ABORT,'sabotaje del gate'); END");
    const rx = await pedir('/api/erp/importar/importar', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': N.csrf },
      body: JSON.stringify({ tipo: 'clientes', texto: CSV_TX, nombre: 'sabotaje.csv' }),
    });
    N.db.exec('DROP TRIGGER trg_gate_sabotaje');
    ok(rx.status >= 400, 'el fallo a mitad se responde como error, no como éxito', String(rx.status));
    ok(cuenta(N.db, 'SELECT COUNT(*) n FROM clients') === pre,
       'y NO queda NI UNA de las dos filas que ya habían entrado', pre + ' → ' + cuenta(N.db, 'SELECT COUNT(*) n FROM clients'));
    ok(cuenta(N.db, 'SELECT COUNT(*) n FROM importaciones') === preLotes, 'ni el lote a medias');
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[7] LOS FALLOS SE VEN ANTES: NIF repetido, contra la base Y dentro del fichero');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  {
    const jd = await (await analizar({ tipo: 'clientes', texto: ['Nombre;NIF', 'Otro Ana;12345678Z'].join('\n') })).json();
    ok(jd.resumen.malas === 1 && /Ana Ruiz/.test(jd.filas[0].errores[0]),
       'un NIF que YA está en Bamburu se canta antes de importar, con el nombre de quien lo tiene', jd.filas[0].errores[0]);
    const jf = await (await analizar({ tipo: 'clientes', texto: ['Nombre;NIF', 'Uno;A98989898', 'Dos;A98989898'].join('\n') })).json();
    ok(jf.resumen.malas === 1 && /repetido en este fichero/.test(jf.filas.find(f => f.errores.length).errores[0]),
       'y un NIF repetido DENTRO del propio fichero también — antes de tocar la base');
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[8] PRODUCTOS: el IVA es obligatorio y no cae a un defecto silencioso');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  {
    const P = ['Nombre;Referencia;Precio;IVA', 'Corte;SRV-1;15,00;21', 'Champú;PRD-1;8,90;7'].join('\n');
    const jp = await (await analizar({ tipo: 'productos', texto: P })).json();
    ok(jp.resumen.buenas === 1 && jp.resumen.malas === 1, 'un IVA del 7% no existe en España y la fila falla', JSON.stringify(jp.resumen));
    ok(jp.filas[0].datos.price === 15, 'y «15,00» se lee como 15 (la vista previa enseña el número ya interpretado)');
    const sinIva = ['Nombre;Referencia;Precio', 'Corte;S1;15,00'].join('\n');
    const j1 = await (await analizar({ tipo: 'productos', texto: sinIva })).json();
    ok(j1.resumen.malas === 1 && /IVA/.test(j1.filas[0].errores[0]), 'sin columna de IVA y sin elección del dueño: falla');
    const j2 = await (await analizar({ tipo: 'productos', texto: sinIva, banda: 'general' })).json();
    ok(j2.resumen.buenas === 1 && j2.filas[0].datos.tax_band === 'general', 'con la banda ELEGIDA por el dueño: entra');
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[9] DESHACER (H2): ARCHIVA, NO BORRA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  {
    const lote = N.db.prepare("SELECT id FROM importaciones WHERE fichero='gate.csv'").get();
    ok(!!lote, 'la importación quedó apuntada con su fichero');
    const filas = cuenta(N.db, 'SELECT COUNT(*) n FROM clients');
    const rd = await pedir('/api/erp/importar/' + lote.id + '/deshacer', { method: 'POST', headers: { 'x-csrf-token': N.csrf } });
    const jd = await rd.json();
    ok(rd.status === 200 && jd.archivadas === 3, 'deshacer archiva las 3 del lote', JSON.stringify(jd));
    ok(cuenta(N.db, 'SELECT COUNT(*) n FROM clients') === filas, 'las filas SIGUEN en la tabla: no se ha borrado nada', String(filas));
    ok(N.db.prepare("SELECT COUNT(*) n FROM clients WHERE active=0").get().n >= 3, 'y están archivadas (active=0)');
    const r2 = await pedir('/api/erp/importar/' + lote.id + '/deshacer', { method: 'POST', headers: { 'x-csrf-token': N.csrf } });
    ok(r2.status === 409, 'deshacer dos veces no vuelve a tocar nada', String(r2.status));
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[10] EL CANDADO: escribir exige el permiso de alta, y el CSRF no es opcional');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  {
    const rsc = await pedir('/api/erp/importar/analizar', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tipo: 'clientes', texto: CSV }),
    });
    ok(rsc.status === 403, 'sin token CSRF → 403', String(rsc.status));

    const rss = await fetch(N.base + '/admin/migracion/importar', { redirect: 'manual' });
    ok([301, 302, 401, 403].includes(rss.status), 'sin sesión no se sirve la pantalla', String(rss.status));

    // Un empleado REAL sin permisos de alta. No se simula: se crea, se le da sesión y se le pide.
    const pw = '$2b$10$' + 'x'.repeat(53);
    N.db.prepare("INSERT INTO admin_users (email,password_hash,name,role,active) VALUES (?,?,?,'employee',1)")
      .run('empleado-' + randomBytes(3).toString('hex') + '@bamburu.test', pw, 'Empleado sin permisos');
    const emp = N.db.prepare("SELECT id FROM admin_users WHERE role='employee' ORDER BY id DESC LIMIT 1").get();
    const s = sesion(N.db, emp.id);
    const rE = await fetch(N.base + '/api/erp/importar/importar', {
      method: 'POST', headers: { cookie: 'asess=' + s.tok, 'content-type': 'application/json', 'x-csrf-token': s.csrf },
      body: JSON.stringify({ tipo: 'clientes', texto: CSV, nombre: 'empleado.csv' }),
    });
    ok(rE.status === 403, 'un empleado sin clients.create NO puede importar clientes', String(rE.status));
    ok(cuenta(N.db, "SELECT COUNT(*) n FROM importaciones WHERE fichero='empleado.csv'") === 0, 'y no ha escrito nada');
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[11] LAS FACTURAS NO ENTRAN POR AQUÍ — Y SI ALGÚN DÍA ENTRAN, ESTO SE PONE ROJO');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // No es decoración: `createInvoice` asigna correlativo del año en curso, registra el ALTA en la
  // cadena legal con la marca de tiempo de AHORA y encola la remisión a la AEAT. Importar facturas
  // por ahí las declararía por segunda vez. Mientras eso no lo decida el dueño, el tipo NO existe.
  {
    const rf = await pedir('/api/erp/importar/analizar', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': N.csrf },
      body: JSON.stringify({ tipo: 'facturas', texto: 'Numero;Fecha;Total\nF-1;2024-03-05;121,00' }),
    });
    ok(rf.status === 400, 'el importador RECHAZA el tipo «facturas»', String(rf.status));
    ok(cuenta(N.db, 'SELECT COUNT(*) n FROM invoices') === 0, 'y no ha nacido ninguna factura');
    ok(cuenta(N.db, 'SELECT COUNT(*) n FROM verifactu_registros') === 0, 'ni un solo registro en la cadena legal');
  }

} catch (e) {
  fail++;
  console.error('\n✗ EXCEPCIÓN: ' + ((e && e.stack) || e));
} finally {
  if (browser) { try { await browser.close(); } catch {} }
  limpiar();
}

console.log('\n' + '─'.repeat(70));
// EL PIE, EN EL FORMATO QUE EL BARRIDO SABE LEER. Decía «N aserciones, todas en verde», que es
// bonito y el runner no lo entiende: salía SOSPECHOSO —«no demuestra nada»— pasándolo todo. Ver
// scripts/run-gates.mjs · RESUMEN.
console.log('RESULTADO: ' + pass + ' ✓  ·  ' + fail + ' ✗');
console.log(fail ? '✗ GATE IMPORTADOR CSV: ' + pass + ' pasadas · ' + fail + ' FALLOS'
                 : '✓ GATE IMPORTADOR CSV: ' + pass + ' aserciones, todas en verde');
process.exit(fail ? 1 : 0);
