// Verificación VERI*FACTU · ANCLAJE EXTERNO — la cadena, sellada por un tercero (RFC-3161), fuera
// del servidor. §4.9 del plano (docs/architecture/task-anclar-verifactu-fuera-analysis.md).
//   node scripts/verify-verifactu-anclaje.mjs
//
// Levanta su PROPIA TSA local de usar y tirar (CA + firmante generados con openssl, servidor
// RFC-3161 servido con `openssl ts -reply`, igual que el simulador SOAP de verify-verifactu-cola.mjs
// pero para sellado de tiempo). Sin red, sin secretos, sin tocar nada del servidor — salvo los DOS
// puntos que la propia pantalla necesita comprobar SERVIDA (criterio 1 y el último de §6), que van
// contra el servidor real (localhost:3000) con un negocio DESECHABLE (negocioDesechable()): nace y
// se tira entero al final, así que nada de lo que crea puede quedar pegado a una factura de verdad.
//
// Bloques, en el orden del plano:
//   1. Inactivo por defecto (sin VERIFACTU_ANCLAJE_TSA) + la pantalla lo dice sin abrir el código.
//   2. Ida y vuelta real contra la TSA local: se ancla, se verifica y se guarda.
//   3. Token corrupto: NO se persiste, estado='fallo'.
//   4. Manipulación (sobre una COPIA): verifyTenantInvoices da verde, verificarAnclajes da ROJO.
//   5. Borrado del anclaje del medio: verificarAnclajes da ROJO por hueco.
//   6. No toca nada: SHA-256 de invoices/invoice_anulaciones/verifactu_registros idéntico antes y
//      después de una pasada COMPLETA de scripts/bamburu-anclaje-verifactu.mjs; y esos 4 ficheros de
//      la familia Verifactu no están en el diff de la rama.
//   7. Solo sale una huella: los bytes que recibe la TSA no llevan NIF, número de factura, cliente
//      ni importe.
//   8. Latido: sin material nuevo, +25 h ancla igual; a las +2 h del nuevo, no.
import http from 'http';
import { execFileSync, spawn } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync, copyFileSync, rmSync, statSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes, createHash } from 'crypto';
import Database from 'better-sqlite3';
import { negocioDesechable } from './lib/negocio-desechable.mjs';
import { APP_DIR } from './lib/gate-env.mjs';
import { createInvoice, anularInvoice } from '../modules/erp/routes/invoices.js';
import { verifyTenantInvoices } from '../modules/superadmin/integridad.js';
import { motivoAnclajeInactivo, anclar, verificarAnclajes } from '../modules/erp/verifactu-anclaje.js';
import { controlDb } from '../core/control-db.js';

const APEX = 'http://127.0.0.1:3000';
const TOKEN_PREFIJO = 'gate-anclaje-';

let pass = 0, fail = 0, sinVerificar = 0;
const ok = (c, m, det) => { if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ ' + m + (det ? ' · ' + det : '')); } };
const noVerificado = (m, det) => { sinVerificar++; console.error('  ⚠ NO VERIFICADO: ' + m + (det ? ' · ' + det : '')); };

// ── ¿El proceso `bamburu` en marcha sirve el código que hay en disco AHORA MISMO? ──────────────────
// Variante NO FATAL de `exigeCodigoServido` (scripts/lib/gate-env.mjs): esta sesión no tiene sudo
// para reiniciar el servicio (el orquestador tampoco lo tiene — `orchestrator/nucleo/despliegue.js`
// solo lo DETECTA y le pide a un humano que lo arregle). En vez de abortar el gate ENTERO —que
// tumbaría también los bloques 2 a 8, que no necesitan el servidor vivo para nada—, los dos puntos
// que sí lo necesitan se saltan CON AVISO EXPLÍCITO (`noVerificado`, no cuenta como ✓) si el proceso
// está desfasado. Un ✓ conseguido contra código viejo sería peor que no tenerlo.
function servidorSirveCodigoFresco() {
  let arranque;
  try { arranque = Date.parse(execFileSync('systemctl', ['show', 'bamburu', '-p', 'ActiveEnterTimestamp', '--value'], { encoding: 'utf8' }).trim()); }
  catch { return true; }   // sin systemd (otra máquina): no se estorba, igual que exigeCodigoServido
  if (!arranque || Number.isNaN(arranque)) return true;
  let masNuevo = 0;
  const mirar = ruta => {
    let st; try { st = statSync(ruta); } catch { return; }
    if (st.isDirectory()) { for (const f of readdirSync(ruta)) mirar(join(ruta, f)); return; }
    if (/\.(js|mjs)$/.test(ruta) && st.mtimeMs > masNuevo) masNuevo = st.mtimeMs;
  };
  for (const d of ['modules', 'core', 'index.js']) mirar(join(APP_DIR, d));
  return !(masNuevo > arranque + 2000);
}

// ── La TSA local, de usar y tirar ────────────────────────────────────────────────────────────────
function crearCertificadosTsa(dir) {
  const caKey = join(dir, 'ca.key'), caPem = join(dir, 'ca.pem');
  const tsaKey = join(dir, 'tsa.key'), tsaCsr = join(dir, 'tsa.csr'), tsaPem = join(dir, 'tsa.pem');
  const extfile = join(dir, 'extfile.cnf');
  const cnf = join(dir, 'openssl.cnf');

  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', caKey, '-out', caPem, '-days', '2', '-nodes', '-subj', '/CN=GATE TSA CA'], { stdio: 'ignore' });
  execFileSync('openssl', ['genrsa', '-out', tsaKey, '2048'], { stdio: 'ignore' });
  execFileSync('openssl', ['req', '-new', '-key', tsaKey, '-out', tsaCsr, '-subj', '/CN=GATE TSA Signer'], { stdio: 'ignore' });
  // SIN extendedKeyUsage=critical,timeStamping el token no verifica (medido en el plano: se pierde
  // media hora buscando por qué). Con él, `openssl x509 -purpose` dice "Time Stamp signing : Yes".
  writeFileSync(extfile, 'extendedKeyUsage = critical,timeStamping\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n');
  execFileSync('openssl', ['x509', '-req', '-in', tsaCsr, '-CA', caPem, '-CAkey', caKey, '-CAcreateserial', '-out', tsaPem, '-days', '2', '-extfile', extfile], { stdio: 'ignore' });
  writeFileSync(join(dir, 'tsaserial'), '01\n');
  // `openssl ts -reply` EXIGE la sección [tsa]; sin ella no arranca (medido en el plano).
  writeFileSync(cnf, [
    '[tsa]', 'default_tsa = tsa_config1', '',
    '[tsa_config1]',
    'dir = ' + dir,
    'serial = $dir/tsaserial',
    'crypto_device = builtin',
    'signer_cert = $dir/tsa.pem',
    'certs = $dir/ca.pem',
    'signer_key = $dir/tsa.key',
    'signer_digest = sha256',
    'default_policy = 1.2.3.4.1',
    'digests = sha256',
    'accuracy = secs:1',
    'clock_precision_digits = 0',
    'ordering = yes',
    'tsa_name = yes',
    'ess_cert_id_valid = no',
    'ess_cert_id_alg = sha256',
    '',
  ].join('\n'));
  return { caPem, cnf };
}

// Servidor http que recibe el .tsq y responde con lo que devuelva `openssl ts -reply`. Guarda TODO
// lo que recibe (bloque 7: solo debe salir una huella) y puede devolver un token corrompido a
// propósito (bloque 3), sin tocar el fichero real que generó `openssl` (se corrompe una COPIA).
async function crearTsaLocal(dir) {
  const { caPem, cnf } = crearCertificadosTsa(dir);
  const estado = { modo: 'ok' };
  const capturados = [];
  const server = http.createServer((req, res) => {
    const partes = [];
    req.on('data', d => partes.push(d));
    req.on('end', () => {
      const cuerpo = Buffer.concat(partes);
      capturados.push(cuerpo);
      const id = randomBytes(6).toString('hex');
      const reqPath = join(dir, 'req-' + id + '.tsq');
      const respPath = join(dir, 'resp-' + id + '.tsr');
      try {
        writeFileSync(reqPath, cuerpo);
        execFileSync('openssl', ['ts', '-reply', '-config', cnf, '-queryfile', reqPath, '-out', respPath], { stdio: 'ignore' });
        let bytes = readFileSync(respPath);
        // El BYTE FINAL, no uno del medio: medido a mano, un bit volteado a mitad del token cae casi
        // siempre dentro del certificado adjunto (que `openssl ts -verify` no reverifica byte a
        // byte) y el "Verification: OK" seguía saliendo — un corrupto que no se detecta es peor que
        // no probarlo. Los últimos bytes son la firma RSA del CMS: ahí un solo bit sí rompe siempre.
        if (estado.modo === 'corrupto') { bytes = Buffer.from(bytes); bytes[bytes.length - 1] ^= 0xff; }
        res.writeHead(200, { 'Content-Type': 'application/timestamp-reply' });
        res.end(bytes);
      } catch (e) {
        res.writeHead(500); res.end('tsa de mentira: ' + e.message);
      } finally {
        try { unlinkSync(reqPath); } catch {}
        try { unlinkSync(respPath); } catch {}
      }
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/tsa';
  return { url, caPem, estado, capturados, cerrar: () => new Promise(r => server.close(r)) };
}

const sha256 = s => createHash('sha256').update(s).digest('hex');
const shaTablasFiscales = db => sha256(JSON.stringify({
  inv: db.prepare('SELECT * FROM invoices ORDER BY id').all(),
  anu: db.prepare('SELECT * FROM invoice_anulaciones ORDER BY id').all(),
  reg: db.prepare('SELECT * FROM verifactu_registros ORDER BY id').all(),
}));

let neg = null;
let tsa = null;
let tsaDir = null;
const copias = [];       // rutas de ficheros temporales que hay que borrar SIEMPRE
let saTokenGate = null;  // sesión efímera de superadmin, si llega a crearse

// Guarda el entorno tal como estaba: un gate no puede dejar variables puestas para el siguiente.
const ENV_KEYS = ['VERIFACTU_ANCLAJE', 'VERIFACTU_ANCLAJE_TSA', 'VERIFACTU_ANCLAJE_TSA_CA'];
const envOriginal = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
function restaurarEnv() {
  for (const k of ENV_KEYS) { if (envOriginal[k] === undefined) delete process.env[k]; else process.env[k] = envOriginal[k]; }
}

try {
  console.log('\n=== Prepara el negocio DESECHABLE y la TSA local ===\n');
  for (const k of ENV_KEYS) delete process.env[k];   // arranca APAGADO, como en producción hoy

  neg = await negocioDesechable('Gate Anclaje Verifactu');
  neg.db.bamburuSlug = neg.slug;   // lo que hace el tenant-middleware al abrir la conexión de verdad
  neg.db.prepare("UPDATE company_config SET company_name=?, fiscal_id=? WHERE id=1").run('Negocio Gate Anclaje', 'B87654321');
  const clienteId = neg.db.prepare(
    "INSERT INTO clients (name, fiscal_id, client_type, payment_term_days) VALUES (?,?,?,0)"
  ).run('Cliente Secreto Anclaje', 'B12340000', 'empresa').lastInsertRowid;

  tsaDir = mkdtempSync(join(tmpdir(), 'gate-tsa-'));
  tsa = await crearTsaLocal(tsaDir);
  ok(!!tsa.url, 'TSA local levantada', tsa.url);

  console.log('\n=== [1] Inactivo por defecto: sin VERIFACTU_ANCLAJE_TSA ===\n');
  const motivo1 = motivoAnclajeInactivo(neg.slug);
  ok(typeof motivo1 === 'string' && /autoridad de sellado/.test(motivo1), 'motivoAnclajeInactivo devuelve el motivo en palabras', motivo1);

  const f1 = createInvoice(neg.db, { client_id: clienteId, issue_date: '2026-03-01', irpf_rate: 0, lines: [{ description: 'Servicio secreto de prueba', quantity: 1, unit_price: 1234.56, tax_rate: 21 }] });
  ok(!!f1.id, 'emitir una factura sigue funcionando con el anclaje inactivo', f1.invoice_number);

  const r1 = await anclar(neg.db);
  ok(r1.anclado === false && r1.motivo === motivo1, 'anclar() no ancla y devuelve el mismo motivo', JSON.stringify(r1));
  ok(neg.db.prepare('SELECT COUNT(*) c FROM verifactu_anclajes').get().c === 0, 'no se ha insertado ninguna fila en verifactu_anclajes');

  console.log('\n=== [1b] La pantalla lo dice sin abrir el código (servidor real) ===\n');
  const cookieNeg = 'asess=' + neg.sesion() + '; btenant=' + neg.slug;
  const codigoFresco = servidorSirveCodigoFresco();
  if (!codigoFresco) {
    noVerificado('GET /admin/verifactu/anclajes', 'el proceso bamburu.service sirve código de ANTES de este cambio y esta sesión no tiene sudo para reiniciarlo (systemctl restart pide privilegio que este entorno no da). Repetir tras reiniciar el servicio.');
  } else {
    const rPantalla1 = await fetch(APEX + '/admin/verifactu/anclajes', { headers: { cookie: cookieNeg }, redirect: 'manual' });
    const htmlPantalla1 = await rPantalla1.text();
    ok(rPantalla1.status === 200, 'GET /admin/verifactu/anclajes responde 200 (URL final la misma, sin redirección)', 'status=' + rPantalla1.status);
    ok(htmlPantalla1.includes('Sellado externo'), 'es la pantalla que se pidió, no un login ni un 403');
    ok(new RegExp(motivo1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(htmlPantalla1), 'y muestra el MISMO motivo que devuelve motivoAnclajeInactivo()');
  }

  console.log('\n=== [2] Ida y vuelta real contra la TSA local: se ancla, se verifica y se guarda ===\n');
  process.env.VERIFACTU_ANCLAJE_TSA = tsa.url;
  process.env.VERIFACTU_ANCLAJE_TSA_CA = tsa.caPem;
  ok(motivoAnclajeInactivo(neg.slug) === null, 'con la TSA configurada, motivoAnclajeInactivo() → null (activo)');

  const r2 = await anclar(neg.db);
  ok(r2.anclado === true && r2.secuencia === 1, 'primer anclaje: sellado, secuencia 1', JSON.stringify(r2));
  ok(r2.cadenaOk === true, 'la cadena propietaria cuadraba en ese momento');
  const fila2 = neg.db.prepare('SELECT * FROM verifactu_anclajes WHERE secuencia=1').get();
  ok(!!fila2 && fila2.estado === 'sellado' && !!fila2.token, 'la fila queda sellado, con su token guardado');
  writeFileSync(join(tsaDir, 'verifica2.tsr'), fila2.token);
  const salidaVerify2 = execFileSync('openssl', ['ts', '-verify', '-digest', fila2.raiz.toLowerCase(), '-in', join(tsaDir, 'verifica2.tsr'), '-CAfile', tsa.caPem]).toString();
  ok(/Verification: OK/.test(salidaVerify2), 'el token GUARDADO verifica de verdad con openssl ts -verify');

  console.log('\n=== [2b] La pantalla ahora dice «activo», con datos reales ===\n');
  if (!codigoFresco) {
    noVerificado('GET /admin/verifactu/anclajes (activo)', 'mismo motivo que en [1b]: código en disco más nuevo que el arranque del proceso');
  } else {
    const rPantalla2 = await fetch(APEX + '/admin/verifactu/anclajes', { headers: { cookie: cookieNeg } });
    const htmlPantalla2 = await rPantalla2.text();
    ok(rPantalla2.status === 200 && htmlPantalla2.includes('Sellado externo activo'), 'la pantalla dice "Sellado externo activo"');
    ok(!htmlPantalla2.includes('Nunca se ha sellado nada'), 'y ya NO dice "Nunca se ha sellado nada"');
  }

  console.log('\n=== [3] Token corrupto: NO se persiste, estado=fallo ===\n');
  const f3 = createInvoice(neg.db, { client_id: clienteId, issue_date: '2026-03-02', irpf_rate: 0, lines: [{ description: 'Otro servicio', quantity: 1, unit_price: 40, tax_rate: 21 }] });
  tsa.estado.modo = 'corrupto';
  const r3 = await anclar(neg.db);
  ok(r3.anclado === false && !!r3.error, 'un token corrompido no se acepta', JSON.stringify(r3));
  const fila3 = neg.db.prepare('SELECT * FROM verifactu_anclajes WHERE estado=\'fallo\' ORDER BY id DESC LIMIT 1').get();
  ok(!!fila3 && fila3.secuencia === 0 && fila3.token === null, 'la fila de fallo queda con secuencia=0 y SIN token');
  ok(neg.db.prepare("SELECT COUNT(*) c FROM verifactu_anclajes WHERE estado='sellado'").get().c === 1, 'sigue habiendo un único anclaje SELLADO (el corrupto no cuenta)');
  tsa.estado.modo = 'ok';

  console.log('\n=== [una anulación, para que invoice_anulaciones tenga algo que comparar en el bloque 6] ===\n');
  const anu = anularInvoice(neg.db, f3.id, 'anulación de prueba del gate');
  ok(!!anu, 'la factura F3 queda anulada (invoice_anulaciones con contenido real)');

  console.log('\n=== [reintento sano tras el corrupto: segundo anclaje SELLADO de verdad ===\n');
  const r3b = await anclar(neg.db);
  ok(r3b.anclado === true && r3b.secuencia === 2, 'con la TSA sana, el mismo material se ancla: secuencia 2', JSON.stringify(r3b));

  const f3c = createInvoice(neg.db, { client_id: clienteId, issue_date: '2026-03-03', irpf_rate: 0, lines: [{ description: 'Tercer servicio', quantity: 2, unit_price: 15, tax_rate: 21 }] });
  const r3c = await anclar(neg.db);
  ok(r3c.anclado === true && r3c.secuencia === 3, 'un tercer anclaje, secuencia 3 (necesario para el bloque 5: borrar el del MEDIO)', JSON.stringify(r3c));

  console.log('\n=== [4] Manipulación sobre una COPIA: verifyTenantInvoices da verde, verificarAnclajes da ROJO ===\n');
  neg.db.pragma('wal_checkpoint(TRUNCATE)');
  const copia4 = join(tsaDir, 'copia-manipulada.db');
  copyFileSync(neg.abs, copia4);
  copias.push(copia4);
  const db4 = new Database(copia4);
  try {
    const facturaTocada = db4.prepare('SELECT * FROM invoices WHERE id=?').get(f1.id);
    db4.prepare('UPDATE invoices SET total = total + 0.01 WHERE id=?').run(f1.id);
    // Lo que haría el atacante: recalcular TODA la cadena propietaria (calcHash) desde ese punto,
    // igual que la hace `createInvoice`/`verifyTenantInvoices` (por series/year, en orden de sequence).
    const calcHash = inv => createHash('sha256').update([inv.invoice_number, inv.issue_date, inv.company_fiscal_id, inv.client_fiscal_id || '', inv.total.toFixed(2), inv.prev_hash].join('|')).digest('hex');
    const grupo = db4.prepare('SELECT * FROM invoices WHERE series=? AND year=? ORDER BY sequence ASC').all(facturaTocada.series, facturaTocada.year);
    let prev = '';
    const upd = db4.prepare('UPDATE invoices SET verifactu_hash=?, prev_hash=? WHERE id=?');
    for (const inv of grupo) {
      // `grupo` ya viene leído DESPUÉS del UPDATE de arriba: `inv.total` de f1 YA es total+0.01.
      const hash = calcHash({ ...inv, prev_hash: prev });
      upd.run(hash, prev, inv.id);
      prev = hash;
    }
    const chequeoPropio = verifyTenantInvoices(copia4);
    ok(chequeoPropio.ok === true, 'la cadena PROPIETARIA (recalculada por el atacante) da verde: cuadra consigo misma', JSON.stringify(chequeoPropio));
    const veredicto4 = verificarAnclajes(db4);
    ok(veredicto4.ok === false, 'y verificarAnclajes() da ROJO: el sello externo NO cuadra con lo tocado', JSON.stringify(veredicto4.alarma));
    ok(!!veredicto4.alarma && veredicto4.alarma.secuencia >= 1 && !!veredicto4.alarma.sellado_at, 'la alarma nombra el anclaje y su fecha de sello', JSON.stringify(veredicto4.alarma));
  } finally { db4.close(); }

  console.log('\n=== [5] Borrado del anclaje del medio: verificarAnclajes da ROJO por hueco ===\n');
  const copia5 = join(tsaDir, 'copia-borrado.db');
  copyFileSync(neg.abs, copia5);
  copias.push(copia5);
  const db5 = new Database(copia5);
  try {
    ok(db5.prepare("SELECT COUNT(*) c FROM verifactu_anclajes WHERE estado='sellado'").get().c === 3, 'la copia parte de los 3 anclajes sellados');
    db5.prepare('DELETE FROM verifactu_anclajes WHERE secuencia=2').run();
    const veredicto5 = verificarAnclajes(db5);
    ok(veredicto5.ok === false, 'sin el anclaje 2, verificarAnclajes() da ROJO', JSON.stringify(veredicto5.alarma));
    ok(/anclaje|hueco|falta/i.test(veredicto5.alarma?.motivo || ''), 'y el motivo habla de la cadena de anclajes rota', veredicto5.alarma?.motivo);
  } finally { db5.close(); }

  console.log('\n=== [6] No toca nada: SHA-256 idéntico antes/después de una pasada COMPLETA del script ===\n');
  const f6 = createInvoice(neg.db, { client_id: clienteId, issue_date: '2026-03-04', irpf_rate: 0, lines: [{ description: 'Cuarto servicio', quantity: 1, unit_price: 60, tax_rate: 21 }] });
  const shaAntes = shaTablasFiscales(neg.db);
  const anclajesAntes = neg.db.prepare('SELECT COUNT(*) c FROM verifactu_anclajes').get().c;
  // ASÍNCRONO a propósito (spawn, no execFileSync): la TSA de mentira vive DENTRO de este mismo
  // proceso (http.createServer). Un execFileSync bloquea el bucle de eventos entero mientras el hijo
  // corre, y entonces la TSA no puede contestar sus propias peticiones — el hijo se queda esperando
  // hasta agotar el timeout. Con spawn() el bucle de eventos sigue libre y la TSA responde.
  await new Promise((resolve, reject) => {
    const hijo = spawn('node', ['scripts/bamburu-anclaje-verifactu.mjs'], {
      cwd: APP_DIR,
      stdio: 'inherit',
      env: {
        ...process.env,
        RESEND_API_KEY: 'gate-no-usar-clave-invalida',   // que el correo falle solo: cero riesgo de mandar nada real
        ANCLAJE_VERIFACTU_DB: neg.abs,
        VERIFACTU_ANCLAJE_TSA: tsa.url,
        VERIFACTU_ANCLAJE_TSA_CA: tsa.caPem,
      },
    });
    hijo.on('error', reject);
    hijo.on('exit', code => code === 0 ? resolve() : reject(new Error('bamburu-anclaje-verifactu.mjs salió con código ' + code)));
  });
  const shaDespues = shaTablasFiscales(neg.db);
  const anclajesDespues = neg.db.prepare('SELECT COUNT(*) c FROM verifactu_anclajes').get().c;
  ok(anclajesDespues > anclajesAntes, 'la pasada completa SÍ ancló algo nuevo (si no, esto no probaría nada)', anclajesAntes + ' → ' + anclajesDespues);
  ok(shaAntes === shaDespues, 'y el SHA-256 de invoices + invoice_anulaciones + verifactu_registros es IDÉNTICO', shaAntes.slice(0, 16) + '… vs ' + shaDespues.slice(0, 16) + '…');

  const tocados = execFileSync('git', ['diff', '--name-only', 'master'], { cwd: APP_DIR }).toString().trim().split('\n').filter(Boolean);
  const intocables = ['modules/erp/routes/invoices.js', 'modules/erp/verifactu.js', 'modules/erp/verifactu-envio.js', 'modules/erp/verifactu-cola.js'];
  const rotos = intocables.filter(f => tocados.includes(f));
  ok(rotos.length === 0, 'ninguno de los 4 ficheros intocables de la familia Verifactu está en el diff de la rama', rotos.join(', ') || '(ninguno)');

  console.log('\n=== [7] Solo sale una huella: los bytes que recibe la TSA no llevan datos de negocio ===\n');
  ok(tsa.capturados.length > 0, 'la TSA de mentira recibió al menos una petición', tsa.capturados.length + ' petición(es)');
  const agujas = ['B87654321', 'B12340000', 'Cliente Secreto Anclaje', f1.invoice_number, '1234.56', '1234,56', 'Servicio secreto'];
  for (const bytes of tsa.capturados) {
    const texto = bytes.toString('latin1');
    for (const aguja of agujas) ok(!texto.includes(aguja), 'la petición a la TSA NO contiene "' + aguja + '"');
  }

  console.log('\n=== [8] Latido: sin material nuevo, +25 h ancla igual; a las +2 h del nuevo, no ===\n');
  const ultimoAntes = neg.db.prepare("SELECT * FROM verifactu_anclajes WHERE estado='sellado' ORDER BY secuencia DESC LIMIT 1").get();
  const t25 = Date.parse(ultimoAntes.created_at) + 25 * 3600 * 1000;
  const r8a = await anclar(neg.db, { ahoraMs: t25 });
  ok(r8a.anclado === true, 'sin factura nueva pero con +25 h, el latido ancla igual', JSON.stringify(r8a));
  const ultimoTrasLatido = neg.db.prepare("SELECT * FROM verifactu_anclajes WHERE estado='sellado' ORDER BY secuencia DESC LIMIT 1").get();
  const t2 = Date.parse(ultimoTrasLatido.created_at) + 2 * 3600 * 1000;
  const r8b = await anclar(neg.db, { ahoraMs: t2 });
  ok(r8b.anclado === false, 'y a las +2 h del nuevo, sin material, NO toca aún', JSON.stringify(r8b));

  console.log('\n=== Criterio final: /superadmin/integridad, columna «Sellado», sobre el servidor real ===\n');
  if (!codigoFresco) {
    noVerificado('/superadmin/integridad (columna Sellado)', 'mismo motivo: código en disco más nuevo que el arranque del proceso');
  } else {
  const sa = controlDb.prepare('SELECT id FROM superadmins ORDER BY id LIMIT 1').get();
  if (!sa) { console.error('  (sin superadmin en control.db: se salta esta comprobación puntual)'); }
  else {
    saTokenGate = TOKEN_PREFIJO + randomBytes(24).toString('hex');
    const csrf = randomBytes(24).toString('hex');
    const ahora = Math.floor(Date.now() / 1000);
    controlDb.prepare('INSERT INTO superadmin_sessions (token,superadmin_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
      .run(saTokenGate, sa.id, ahora, ahora + 900, csrf);
    const H = { cookie: 'sadm=' + saTokenGate };
    const rRun = await fetch(APEX + '/superadmin/integridad/run', { method: 'POST', headers: { ...H, 'x-csrf-token': csrf, 'Content-Type': 'application/json' }, body: '{}' });
    ok(rRun.status === 200, '/superadmin/integridad/run responde 200');
    const rPag = await fetch(APEX + '/superadmin/integridad', { headers: H, redirect: 'manual' });
    const htmlSa = await rPag.text();
    ok(rPag.status === 200 && htmlSa.includes('Integridad de facturas'), '/superadmin/integridad responde 200 con su URL final (no un login)');
    ok(htmlSa.includes('<th>Sellado</th>'), 'la tabla tiene la columna «Sellado»');
    ok(new RegExp(neg.slug).test(htmlSa), 'y aparece la fila de nuestro negocio desechable', neg.slug);
  }
  }

} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN: ' + (e.stack || e.message));
} finally {
  restaurarEnv();
  if (tsa) { try { await tsa.cerrar(); } catch {} }
  for (const c of copias) { for (const f of [c, c + '-wal', c + '-shm']) { try { unlinkSync(f); } catch {} } }
  if (tsaDir) { try { rmSync(tsaDir, { recursive: true, force: true }); } catch {} }
  if (saTokenGate) { try { controlDb.prepare('DELETE FROM superadmin_sessions WHERE token=?').run(saTokenGate); } catch {} }
  if (neg) { try { neg.tirar(); } catch {} }
}

console.log(`\n${'─'.repeat(70)}\nRESULTADO: ${pass} ✓  ·  ${fail} ✗` + (sinVerificar ? `  ·  ${sinVerificar} ⚠ NO VERIFICADO` : ''));
if (sinVerificar) console.log('⚠️  Hay criterios NO VERIFICADOS en esta pasada — no cuentan como pasados. Repetir tras "sudo systemctl restart bamburu".');
process.exit(fail === 0 ? 0 : 1);
