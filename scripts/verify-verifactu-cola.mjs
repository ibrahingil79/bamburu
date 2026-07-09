// Verificación VERI*FACTU · COLA de envío automático por negocio (SIMULADOR local, sin red a la AEAT).
//   node scripts/verify-verifactu-cola.mjs
//
// Ejercita la cola completa: encolado tras la emisión, ventana de 240 s, agrupación en un sobre por
// el control de flujo (art. 16.2), idempotencia, red caída + reintento con backoff hasta el estado
// terminal, rechazo de la AEAT (que NO se reintenta), aislamiento entre negocios, el cerrojo del
// reclamo, y la promesa de que NADA de esto puede tumbar la emisión de una factura.
//
// El reloj se INYECTA (opts.ahoraMs/opts.now): un gate no puede tardar 60 s reales en probar una
// espera de 60 s. La red sí es real (un servidor SOAP local), no un mock del cliente HTTP.
import Database from 'better-sqlite3';
import http from 'http';
import { tmpdir } from 'os'; import { join } from 'path'; import { randomBytes } from 'crypto';
import { runMigrations } from '../modules/erp/models.js';
import { createInvoice, emitTicketSvc } from '../modules/erp/routes/invoices.js';
import { getEnvio, ESTADO } from '../modules/erp/verifactu-envio.js';
import {
  vaciar, reclamar, encolarSiProcede, proximoEnvioPermitido, proximoTrabajo,
  motivoColaInactiva, detenerTodo, MAX_INTENTOS, BACKOFF_SEG, ESPERA_DEFECTO_SEG,
} from '../modules/erp/verifactu-cola.js';
import { enviosVerifactu, avisosDelDia, avisoKey } from '../modules/erp/avisos.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const dbs = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = ms => new Date(ms).toISOString();

// ── El productor del software está configurado (si no, el motor bloquea por datos y no sale nada) ──
process.env.VERIFACTU_PRODUCTOR_NOMBRE = 'Bamburu Software SL';
process.env.VERIFACTU_PRODUCTOR_NIF = 'B12345678';

// ── Simulador SOAP local ─────────────────────────────────────────────────────────────────────
// Registra CADA sobre recibido: cuántos RegistroAlta lleva, de qué obligado, y con qué series.
// `modo` decide la respuesta. 'caida' destruye el socket = red caída de verdad (no un mock).
const sobres = [];            // { obligado, series[], n }
const rechazar = new Set();   // series que la AEAT tumba con 'Incorrecto'
let modo = 'ok';

const server = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    if (modo === 'caida') { req.destroy(); res.destroy(); return; }

    // OJO: un regex global de NumSerieFactura mordería también el <RegistroAnterior> del encadenado.
    // Hay que ir RegistroAlta a RegistroAlta y, dentro, coger el de <IDFactura>.
    const altas = [...b.matchAll(/<sf:RegistroAlta>([\s\S]*?)<\/sf:RegistroAlta>/g)].map(m => m[1]);
    const series = altas.map(a => (a.match(/<sf:IDFactura>[\s\S]*?<sf:NumSerieFactura>([^<]+)<\/sf:NumSerieFactura>/) || [])[1]);
    const obligado = (b.match(/<sf:ObligadoEmision>[\s\S]*?<sf:NIF>([^<]+)<\/sf:NIF>/) || [])[1];
    sobres.push({ obligado, series, n: altas.length });

    res.setHeader('Content-Type', 'text/xml');
    if (modo === 'fault') {
      return res.end(`<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body>
        <env:Fault><faultcode>env:Client</faultcode><faultstring>Codigo[4102].El XML no cumple el esquema.</faultstring></env:Fault>
        </env:Body></env:Envelope>`);
    }
    const lineas = series.map(s => rechazar.has(s)
      ? `<R:RespuestaLinea><s:IDFactura><s:NumSerieFactura>${s}</s:NumSerieFactura></s:IDFactura>
         <s:EstadoRegistro>Incorrecto</s:EstadoRegistro><s:CodigoErrorRegistro>1239</s:CodigoErrorRegistro>
         <s:DescripcionErrorRegistro>El NIF no esta identificado en el censo</s:DescripcionErrorRegistro></R:RespuestaLinea>`
      : `<R:RespuestaLinea><s:IDFactura><s:NumSerieFactura>${s}</s:NumSerieFactura></s:IDFactura>
         <s:EstadoRegistro>Correcto</s:EstadoRegistro></R:RespuestaLinea>`).join('');
    const estadoEnvio = series.some(s => rechazar.has(s)) ? (series.every(s => rechazar.has(s)) ? 'Incorrecto' : 'ParcialmenteCorrecto') : 'Correcto';
    res.end(`<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body>
      <R:RespuestaRegFactuSistemaFacturacion xmlns:R="urn:r" xmlns:s="urn:s"><s:CSV>CSV-${sobres.length}</s:CSV>
      <s:TiempoEsperaEnvio>${ESPERA_DEFECTO_SEG}</s:TiempoEsperaEnvio><s:EstadoEnvio>${estadoEnvio}</s:EstadoEnvio>
      ${lineas}</R:RespuestaRegFactuSistemaFacturacion></env:Body></env:Envelope>`);
  });
});

// Prepara la BD de un negocio, con su propio NIF de obligado (aislamiento multi-tenant).
function nuevoTenant(slug, fiscalId) {
  const f = join(tmpdir(), `vfcola-${slug}-${randomBytes(4).toString('hex')}.db`);
  const db = new Database(f);
  db.pragma('foreign_keys = ON');     // como el tenant-middleware: la FK de verifactu_envios es real
  db.bamburuSlug = slug;              // lo que hace el tenant-middleware al abrir la conexión
  runMigrations(db);
  // runMigrations ya siembra company_config id=1 ('Mi Empresa', fiscal_id=''), así que un
  // INSERT OR IGNORE no haría nada y el obligado saldría VACÍO en la Cabecera. Hay que ACTUALIZAR.
  db.prepare("INSERT OR IGNORE INTO company_config (id, company_name, fiscal_id, country, invoice_series, rectificative_series, tax_name) VALUES (1,?,?,'ES','F','R','IVA')").run('Negocio ' + slug, fiscalId);
  db.prepare("UPDATE company_config SET company_name=?, fiscal_id=?, country='ES', invoice_series='F', rectificative_series='R' WHERE id=1").run('Negocio ' + slug, fiscalId);
  db.prepare("INSERT INTO clients (name, fiscal_id, client_type, payment_term_days) VALUES ('Cliente Uno','B99999999','empresa',0)").run();
  db.prepare("INSERT INTO clients (name, fiscal_id, client_type, payment_term_days) VALUES ('Sin NIF','','particular',0)").run();
  try { db.prepare("INSERT INTO warehouses (name, is_default) VALUES ('Principal',1)").run(); } catch {}
  dbs.push({ db, f });
  return db;
}
const cliente = (db, nif) => db.prepare('SELECT id FROM clients WHERE fiscal_id=?').get(nif).id;
const regDe = (db, invoiceId) => db.prepare("SELECT * FROM verifactu_registros WHERE invoice_id=? AND record_type='alta' ORDER BY id LIMIT 1").get(invoiceId);
const factura = (db, cli, precio, fecha) => createInvoice(db, { client_id: cli, issue_date: fecha, irpf_rate: 0, lines: [{ description: 'Servicio', quantity: 1, unit_price: precio, tax_rate: 21 }] });

try {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const endpoint = `http://127.0.0.1:${server.address().port}/VerifactuSOAP`;
  // Con el endpoint apuntando al simulador, la cola se activa sin certificado (no es la AEAT).
  process.env.VERIFACTU_ENDPOINT = endpoint;

  const db = nuevoTenant('negocio-uno', '89890001K');
  const cli = cliente(db, 'B99999999');
  const sinNif = cliente(db, '');

  console.log('\n=== La cola está activa (endpoint de simulador, productor configurado) ===\n');
  ok(motivoColaInactiva('negocio-uno') === null, 'motivoColaInactiva → null (activa)');
  ok(motivoColaInactiva(null) !== null, 'sin negocio identificado → inactiva (un script no dispara envíos)');

  console.log('\n=== Emitir una factura la encola y la remite sola, dentro de la ventana de 240 s ===\n');
  const f1 = factura(db, cli, 100, '2026-03-10');
  const r1 = regDe(db, f1.id);
  ok(!!getEnvio(db, r1.id), 'al emitir queda fila de envío (resiste un reinicio antes de enviar)');
  ok(getEnvio(db, r1.id).estado === ESTADO.PENDIENTE, 'estado inicial: pendiente');

  await sleep(600);   // el planificador arma el timer a 250 ms
  const e1 = getEnvio(db, r1.id);
  ok(e1.estado === ESTADO.CORRECTO, 'sin tocar nada, la AEAT lo acepta: estado CORRECTO');
  ok(sobres.length === 1 && sobres[0].n === 1, 'salió UN sobre con UN registro');
  ok(sobres[0].obligado === '89890001K', 'el sobre va a nombre del obligado de ESE negocio');

  const hueco = (Date.parse(e1.enviado_at) - Date.parse(r1.fecha_hora_huso)) / 1000;
  ok(hueco >= 0 && hueco < 240, `llegó dentro de la ventana: ${hueco.toFixed(1)} s < 240 s`);
  ok(e1.csv === 'CSV-1' && e1.tiempo_espera_envio === 60, 'persistido: CSV + TiempoEsperaEnvio de la AEAT');
  ok(getEnvio(db, r1.id).next_retry_at === null, 'aceptado → la cola lo suelta (next_retry_at NULL)');

  console.log('\n=== Ráfaga: el control de flujo (60 s) obliga a AGRUPAR, no a esperar por cada factura ===\n');
  const f2 = factura(db, cli, 50, '2026-03-11');
  const f3 = factura(db, cli, 25, '2026-03-12');
  const r2 = regDe(db, f2.id), r3 = regDe(db, f3.id);
  await sleep(400);
  ok(sobres.length === 1, 'no sale un segundo sobre antes de tiempo (art. 16.2: t = 60 s)');
  ok(getEnvio(db, r2.id).estado === ESTADO.PENDIENTE && getEnvio(db, r3.id).estado === ESTADO.PENDIENTE, 'las dos esperan turno, encoladas');

  const t60 = Date.parse(getEnvio(db, r1.id).enviado_at) + 61_000;
  ok(proximoEnvioPermitido(db) > Date.now(), 'la cola sabe que aún no le toca (reloj derivado de la BD)');
  const v = await vaciar(db, { ahoraMs: t60, now: iso(t60), endpoint });
  ok(v.enviados === 2 && v.correctos === 2, 'al tocar turno remite las DOS');
  ok(sobres.length === 2 && sobres[1].n === 2, 'las dos en UN SOLO sobre (2 RegistroAlta, una Cabecera)');
  ok(sobres[1].series.includes(r2.num_serie) && sobres[1].series.includes(r3.num_serie), 'el sobre lleva las dos series correctas');

  console.log('\n=== Auditoría por registro sin coste cuadrático (el sobre no se copia N veces) ===\n');
  const audit1 = getEnvio(db, r1.id), audit2 = getEnvio(db, r2.id), audit3 = getEnvio(db, r3.id);
  const nAltas = x => (x.match(/<sf:RegistroAlta>/g) || []).length;
  const idSerie = x => (x.match(/<sf:IDFactura><sf:IDEmisorFactura>[^<]*<\/sf:IDEmisorFactura><sf:NumSerieFactura>([^<]+)</) || [])[1];
  ok(audit1.request_xml.includes('<sfLR:Cabecera>'), 'sobre de UN registro → se guarda el sobre entero (como siempre)');
  ok(!audit2.request_xml.includes('<sfLR:Cabecera>') && nAltas(audit2.request_xml) === 1, 'sobre de VARIOS → cada fila guarda UN solo <RegistroAlta>, no el sobre');
  // OJO: el <RegistroAnterior> de r3 lleva la huella de r2 — eso es el ENCADENADO, no contaminación.
  // Lo que identifica al registro es su <IDFactura>, no la ausencia de la huella del vecino.
  ok(idSerie(audit2.request_xml) === r2.num_serie && audit2.request_xml.includes('<sf:Huella>' + r2.huella + '</sf:Huella>'), 'y guarda LO SUYO: su IDFactura y su huella');
  ok(idSerie(audit3.request_xml) === r3.num_serie && nAltas(audit3.request_xml) === 1, 'idem el otro registro del lote (su IDFactura, un solo alta)');
  ok(audit3.request_xml.includes(r2.huella), 'y conserva su <RegistroAnterior> → la cadena sigue auditable en la fila');
  ok(audit2.response_xml.includes(r2.num_serie) && !audit2.response_xml.includes(r3.num_serie), 'la respuesta guardada es SU RespuestaLinea (emparejada por serie exacta)');
  ok(audit2.csv === audit3.csv && audit2.estado_envio === 'Correcto', 'el CSV y el EstadoEnvio del sobre siguen en sus columnas (no se pierde nada)');

  console.log('\n=== Idempotencia: lo aceptado no se reenvía jamás ===\n');
  const antes = sobres.length;
  const vi = await vaciar(db, { ahoraMs: t60 + 120_000, now: iso(t60 + 120_000), endpoint });
  ok(vi.enviados === 0 && sobres.length === antes, 'nada que reclamar: no se vuelve a llamar a la AEAT');
  ok(db.prepare('SELECT COUNT(*) c FROM verifactu_envios').get().c === 3, 'una sola fila de envío por registro');

  console.log('\n=== El cerrojo del reclamo: dos procesos no envían el mismo registro ===\n');
  const f4 = factura(db, cli, 10, '2026-03-13');
  const r4 = regDe(db, f4.id);
  const t2 = t60 + 200_000;
  const primero = reclamar(db, t2);
  const segundo = reclamar(db, t2);
  ok(primero.includes(r4.id), 'el primero reclama el registro');
  ok(segundo.length === 0, 'el segundo no se lleva nada (lease en vigor)');

  console.log('\n=== Red caída: la factura se emite igual, el envío se reintenta con backoff ===\n');
  modo = 'caida';
  let reloj = t2 + 130_000;   // pasado el lease de 120 s, el registro vuelve a ser elegible solo
  const vf = await vaciar(db, { ahoraMs: reloj, now: iso(reloj), endpoint });
  ok(vf.fallos === 1, 'la red caída deja el envío en error de comunicación');
  const eF = getEnvio(db, r4.id);
  ok(eF.estado === ESTADO.ERROR_COM && eF.intentos === 1, 'estado error_comunicacion, intento 1');
  ok(eF.http_status === null, 'http_status NULL: no hubo envío → no consume el turno del control de flujo');
  ok(!!db.prepare('SELECT id FROM invoices WHERE id=?').get(f4.id), 'la FACTURA existe igual: el fallo de remisión no la tumbó');
  const espera1 = (Date.parse(eF.next_retry_at) - reloj) / 1000;
  ok(Math.abs(espera1 - BACKOFF_SEG[0]) < 1, `próximo reintento en ${BACKOFF_SEG[0]} s (backoff)`);

  console.log('\n=== Vuelve la red: el reintento lo remite sin que nadie toque nada ===\n');
  modo = 'ok';
  reloj += BACKOFF_SEG[0] * 1000;
  const vr = await vaciar(db, { ahoraMs: reloj, now: iso(reloj), endpoint });
  ok(vr.correctos === 1, 'el reintento sale y la AEAT lo acepta');
  ok(getEnvio(db, r4.id).estado === ESTADO.CORRECTO && getEnvio(db, r4.id).next_retry_at === null, 'queda CORRECTO y fuera de la cola');

  console.log('\n=== Backoff creciente y estado TERMINAL al agotar los intentos ===\n');
  const f5 = factura(db, cli, 7, '2026-03-14');
  const r5 = regDe(db, f5.id);
  modo = 'caida';
  const esperas = [];
  for (let i = 0; i < MAX_INTENTOS; i++) {
    reloj += 400_000;   // muy pasado el turno y el lease: siempre elegible
    await vaciar(db, { ahoraMs: reloj, now: iso(reloj), endpoint });
    const e = getEnvio(db, r5.id);
    if (e.next_retry_at) esperas.push(Math.round((Date.parse(e.next_retry_at) - reloj) / 1000));
  }
  ok(esperas.join(',') === BACKOFF_SEG.slice(0, MAX_INTENTOS - 1).join(','), `backoff creciente: ${esperas.join('→')} s`);
  const e5 = getEnvio(db, r5.id);
  ok(e5.intentos === MAX_INTENTOS && e5.next_retry_at === null, `tras ${MAX_INTENTOS} intentos: terminal, la cola lo suelta (no reintenta para siempre)`);
  reloj += 400_000;
  const vAgot = await vaciar(db, { ahoraMs: reloj, now: iso(reloj), endpoint });
  ok(vAgot.enviados === 0, 'un registro agotado ya no se reclama');
  modo = 'ok';

  console.log('\n=== La AEAT rechaza: NO se reintenta (el mismo XML da el mismo rechazo) → aviso ===\n');
  const f6 = factura(db, cli, 33, '2026-03-15');
  const r6 = regDe(db, f6.id);
  rechazar.add(r6.num_serie);
  reloj += 400_000;
  await vaciar(db, { ahoraMs: reloj, now: iso(reloj), endpoint });
  const e6 = getEnvio(db, r6.id);
  ok(e6.estado === ESTADO.INCORRECTO && e6.codigo_error === '1239', 'rechazo persistido con su código de error');
  ok(e6.next_retry_at === null, 'un rechazo NO se reintenta solo: sale de la cola y espera a un humano');

  console.log('\n=== Lote mixto: una factura sin NIF no bloquea a las demás ===\n');
  const fMala = factura(db, sinNif, 20, '2026-03-16');
  const fBuena = factura(db, cli, 21, '2026-03-16');
  const rMala = regDe(db, fMala.id), rBuena = regDe(db, fBuena.id);
  const sobresAntes = sobres.length;
  reloj += 400_000;
  await vaciar(db, { ahoraMs: reloj, now: iso(reloj), endpoint });
  ok(getEnvio(db, rMala.id).estado === ESTADO.BLOQUEADO && /NIF del destinatario/.test(getEnvio(db, rMala.id).aviso || ''), 'la mala queda bloqueada por datos, con AVISO (no se inventa el NIF)');
  ok(getEnvio(db, rBuena.id).estado === ESTADO.CORRECTO, 'la buena sale igual');
  ok(sobres[sobresAntes].n === 1, 'el sobre solo lleva la buena (la bloqueada ni sale)');
  ok(getEnvio(db, rMala.id).next_retry_at === null, 'la bloqueada sale de la cola (la arregla un humano)');

  console.log('\n=== Los avisos: lo que quedó en punto muerto se ve, lo que se reintenta solo NO ===\n');
  const avisos = enviosVerifactu(db, '2026-03-20');
  const claves = avisos.map(a => a.ref.registro_id);
  ok(claves.includes(r5.id), 'avisa del que agotó los reintentos de comunicación');
  ok(claves.includes(r6.id), 'avisa del rechazado por la AEAT');
  ok(claves.includes(rMala.id), 'avisa del bloqueado por falta de datos');
  ok(!claves.includes(r1.id) && !claves.includes(r4.id), 'NO avisa de los aceptados');
  ok(avisos.every(a => a.tipo === 'envio_verifactu' && a.urgencia === 2000), 'un solo tipo, urgencia por encima de cobros/pagos');
  const todos = avisosDelDia(db, '2026-03-20');
  ok(todos.length >= avisos.length && todos[0].tipo === 'envio_verifactu', 'el motor general los recoge y los pone los primeros');
  ok(avisoKey(avisos[0]) === 'vf:' + avisos[0].ref.registro_id, 'clave estable del aviso (marcar como visto funciona)');

  console.log('\n=== El histórico NO se drena: registros viejos sin fila de envío se quedan quietos ===\n');
  process.env.VERIFACTU_COLA = 'off';
  const fVieja = factura(db, cli, 90, '2026-01-05');    // emitida con la cola apagada = registro histórico
  const rVieja = regDe(db, fVieja.id);
  ok(getEnvio(db, rVieja.id) === null, 'con la cola apagada no se crea fila de envío');
  delete process.env.VERIFACTU_COLA;
  reloj += 400_000;
  const vHist = await vaciar(db, { ahoraMs: reloj, now: iso(reloj), endpoint });
  ok(vHist.enviados === 0, 'al reactivar la cola, el registro histórico NO se remite solo');
  ok(getEnvio(db, rVieja.id) === null, 'sigue sin fila de envío: solo lo tocará el botón "Enviar"');
  ok(proximoTrabajo(db) === null, 'la cola se queda sin trabajo (no gira en vacío)');

  console.log('\n=== Aislamiento multi-tenant: cada negocio, su cola y su obligado ===\n');
  const db2 = nuevoTenant('negocio-dos', '13334347M');
  const cli2 = cliente(db2, 'B99999999');
  const sobresPrev = sobres.length;
  const g1 = factura(db2, cli2, 60, '2026-03-18');
  const rg1 = regDe(db2, g1.id);
  await sleep(600);
  ok(sobres.length === sobresPrev + 1, 'el negocio dos envía por su cuenta (su reloj de flujo es el suyo)');
  ok(sobres[sobresPrev].obligado === '13334347M', 'su sobre va a nombre de SU obligado, no del otro');
  ok(getEnvio(db2, rg1.id).estado === ESTADO.CORRECTO, 'aceptado en el negocio dos');
  ok(db2.prepare('SELECT COUNT(*) c FROM verifactu_envios').get().c === 1, 'su tabla de envíos solo tiene lo suyo');
  ok(db.prepare('SELECT COUNT(*) c FROM verifactu_envios').get().c === 8, 'la del negocio uno no se contamina');

  console.log('\n=== El mostrador (F2, ráfagas) también entra en la cola ===\n');
  const tk = emitTicketSvc(db2, { payment_method: 'efectivo', lines: [{ description: 'Venta libre', quantity: 1, unit_price: 10, tax_rate: 21 }] });
  const rtk = regDe(db2, tk.id);
  ok(!!getEnvio(db2, rtk.id), 'el ticket F2 queda encolado al emitirse');

  console.log('\n=== La emisión NUNCA se bloquea por la cola ===\n');
  ok(encolarSiProcede(db, 999999) === false, 'encolar un registro inexistente devuelve false (no lanza; la FK salta y se traga)');
  const dbScript = nuevoTenant('sin-slug', '11111111H');
  delete dbScript.bamburuSlug;   // una BD abierta por un script, sin tenant resuelto
  const fs1 = factura(dbScript, cliente(dbScript, 'B99999999'), 5, '2026-03-19');
  ok(!!fs1.id && getEnvio(dbScript, regDe(dbScript, fs1.id).id) === null, 'sin tenant resuelto la factura se emite y NADA se encola');

} catch (e) {
  console.error('ERROR', e.stack || e.message); fail++;
} finally {
  detenerTodo();
  server.close();
  for (const { db, f } of dbs) { try { db.close(); } catch {} try { (await import('fs')).unlinkSync(f); } catch {} }
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
