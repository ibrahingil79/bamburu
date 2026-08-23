// Verificación VERI*FACTU — REMISIÓN DE ANULACIONES a la AEAT (SIMULADOR local, sin red a la AEAT).
//   node scripts/verify-verifactu-anulaciones.mjs
//
// Mide el mecanismo, no el resultado: cada aserción está escrita para caerse si se le quita la pieza
// que dice comprobar. Cubre lo que pidió el encargo del 23-ago-2026 y las dos cosas que aparecieron
// al leer el esquema oficial y que NO estaban en él (el emparejamiento por tipo de operación y que
// el caso normal es "alta nunca enviada").
//
// Lo que NO hace: no enciende nada. La cola solo se activa dentro de este gate, contra un servidor
// SOAP local, y se desarma al terminar. No toca ningún negocio real ni ninguna factura existente.
import Database from 'better-sqlite3';
import http from 'http';
import { tmpdir } from 'os'; import { join } from 'path'; import { randomBytes } from 'crypto';
import { runMigrations } from '../modules/erp/models.js';
import { createInvoice, anularInvoice } from '../modules/erp/routes/invoices.js';
import {
  enviarRegistro, enviarLote, getEnvio, buildRegistroAnulacion, esFechaAeat, ESTADO,
} from '../modules/erp/verifactu-envio.js';
import {
  encolarAnulacionSiProcede, reclamar, detenerTodo, motivoColaInactiva, CASO_ANULACION,
} from '../modules/erp/verifactu-cola.js';
import { anulacionHuella, toFechaExpedicion } from '../modules/erp/verifactu.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const NIF_EMPRESA = '89890001K';
const SI = { NombreRazon: 'Bamburu Software SL', NIF: 'B12345678', IdSistemaInformatico: 'BM', NombreSistemaInformatico: 'Bamburu', Version: '1.0', NumeroInstalacion: '1', TipoUsoPosibleSoloVerifactu: 'S', TipoUsoPosibleMultiOT: 'S', IndicadorMultiplesOT: 'S' };

// ── Simulador SOAP local ─────────────────────────────────────────────────────────────────────
// Devuelve UNA RespuestaLinea por registro recibido, EN ORDEN, y cada una con su
// <Operacion><TipoOperacion> (Alta|Anulacion) — que es como responde la AEAT según
// RespuestaSuministro.xsd, y lo único que distingue el alta de su anulación (comparten NumSerie).
const sobres = [];                 // cada sobre recibido: { regs: [{tipo, serie}], xml }
const veredicto = new Map();       // 'serie|Tipo' → 'Incorrecto' (lo que no esté aquí sale Correcto)
const server = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    // Un solo regex para los dos tipos: así se conserva el ORDEN del documento, que es lo que el
    // motor usa como red de seguridad cuando la respuesta no trae TipoOperacion.
    const regs = [...b.matchAll(/<sf:(RegistroAlta|RegistroAnulacion)>([\s\S]*?)<\/sf:\1>/g)].map(m => {
      const tipo = m[1] === 'RegistroAlta' ? 'Alta' : 'Anulacion';
      const tag = tipo === 'Alta' ? 'NumSerieFactura' : 'NumSerieFacturaAnulada';
      const serie = (m[2].match(new RegExp('<sf:IDFactura>[\\s\\S]*?<sf:' + tag + '>([^<]+)</sf:' + tag + '>')) || [])[1];
      return { tipo, serie };
    });
    sobres.push({ regs, xml: b });
    const lineas = regs.map(r => {
      const malo = veredicto.get(r.serie + '|' + r.tipo);
      const estado = malo ? 'Incorrecto' : 'Correcto';
      const err = malo ? `<s:CodigoErrorRegistro>${malo}</s:CodigoErrorRegistro><s:DescripcionErrorRegistro>Rechazo simulado ${r.tipo}</s:DescripcionErrorRegistro>` : '';
      return `<R:RespuestaLinea><s:IDFactura><s:IDEmisorFactura>${NIF_EMPRESA}</s:IDEmisorFactura>`
        + `<s:NumSerieFactura>${r.serie}</s:NumSerieFactura></s:IDFactura>`
        + `<s:Operacion><s:TipoOperacion>${r.tipo}</s:TipoOperacion></s:Operacion>`
        + `<s:EstadoRegistro>${estado}</s:EstadoRegistro>${err}</R:RespuestaLinea>`;
    }).join('');
    res.setHeader('Content-Type', 'text/xml');
    res.end(`<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body>
      <R:RespuestaRegFactuSistemaFacturacion xmlns:R="urn:r" xmlns:s="urn:s"><s:CSV>CSV-SIM</s:CSV>
      <s:TiempoEsperaEnvio>60</s:TiempoEsperaEnvio><s:EstadoEnvio>Correcto</s:EstadoEnvio>
      ${lineas}</R:RespuestaRegFactuSistemaFacturacion></env:Body></env:Envelope>`);
  });
});

const DBF = join(tmpdir(), 'vf-anul-' + randomBytes(4).toString('hex') + '.db');
const db = new Database(DBF);

const regDe = (invoiceId, tipo) => db.prepare('SELECT * FROM verifactu_registros WHERE invoice_id=? AND record_type=? ORDER BY id LIMIT 1').get(invoiceId, tipo);
const cadenaAltas = () => db.prepare("SELECT id, id_emisor, num_serie, fecha_expedicion, tipo_factura, cuota_total, importe_total, prev_huella, huella, fecha_hora_huso, primer_registro FROM verifactu_registros WHERE record_type='alta' ORDER BY id").all();
const factura = (cli, dia, precio) => createInvoice(db, { client_id: cli, issue_date: dia, irpf_rate: 0, lines: [{ description: 'Servicio', quantity: 1, unit_price: precio, tax_rate: 21 }] });

try {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const endpoint = `http://127.0.0.1:${server.address().port}/VerifactuSOAP`;
  const sim = { endpoint, cert: null, sistemaInfo: SI };

  // La cola se activa SOLO aquí dentro y SOLO contra el simulador (endpoint que no es la AEAT → sin
  // certificado). Fuera del gate nada de esto cambia: la cola de producción sigue como estaba.
  process.env.VERIFACTU_PRODUCTOR_NOMBRE = SI.NombreRazon;
  process.env.VERIFACTU_PRODUCTOR_NIF = SI.NIF;
  process.env.VERIFACTU_ENDPOINT = endpoint;

  runMigrations(db);
  db.bamburuSlug = 'gate-anulaciones';        // lo que hace el tenant-middleware al abrir la conexión
  // OJO: runMigrations YA deja una fila id=1 con fiscal_id vacío, así que un INSERT OR IGNORE aquí no
  // hace nada y todos los registros nacerían con id_emisor='' — y la cadena por NIF no se mediría.
  db.prepare(`UPDATE company_config SET company_name='Taller Gate SL', fiscal_id=?, country='ES',
                invoice_series='F', rectificative_series='R', tax_name='IVA' WHERE id=1`).run(NIF_EMPRESA);
  if (db.prepare('SELECT fiscal_id FROM company_config WHERE id=1').get().fiscal_id !== NIF_EMPRESA) throw new Error('El NIF de la empresa no quedó puesto: el gate mediría sobre una cadena sin emisor.');
  db.prepare("INSERT INTO clients (name, fiscal_id, client_type, payment_term_days) VALUES ('Cliente Uno','B99999999','empresa',0)").run();
  const cli = db.prepare("SELECT id FROM clients WHERE fiscal_id='B99999999'").get().id;

  console.log('\n=== 0 · La cola queda DORMIDA fuera del simulador (no se enciende nada) ===\n');
  const guardaEndpoint = process.env.VERIFACTU_ENDPOINT;
  delete process.env.VERIFACTU_ENDPOINT;
  ok(motivoColaInactiva('gate-anulaciones') !== null, 'contra la AEAT real y sin certificado, la cola está INACTIVA (nada sale solo)');
  process.env.VERIFACTU_ENDPOINT = guardaEndpoint;
  ok(motivoColaInactiva('gate-anulaciones') === null, 'contra el simulador del gate, la cola sí está activa (es lo que permite medirla)');

  // ── Un parque de facturas antes de tocar nada. Las cuatro se emiten IGUAL; lo que las separa es
  //    lo que le pasa a su alta después. La cadena de altas se fotografía AQUÍ.
  const fAceptada  = factura(cli, '2026-03-10', 100);
  const fPendiente = factura(cli, '2026-03-11', 200);
  const fRechazada = factura(cli, '2026-03-12', 300);
  const fDoble     = factura(cli, '2026-03-13', 400);
  const fJuntas    = factura(cli, '2026-03-14', 500);
  detenerTodo();                                   // que ningún timer de la cola envíe por su cuenta

  const CADENA_ANTES = cadenaAltas();
  const FACTURAS_ANTES = db.prepare('SELECT COUNT(*) c FROM invoices').get().c;

  console.log('\n=== 1 · CASO NORMAL HOY: alta NUNCA enviada → se encola DETRÁS de su alta ===\n');
  // Es el caso que de verdad se va a ejercitar: medido el 23-ago-2026 sobre las 28 BD del sistema,
  // de 299 facturas anuladas NINGUNA tenía su alta remitida y aceptada.
  const envAltaAntes = getEnvio(db, regDe(fPendiente.id, 'alta').id);
  ok(!!envAltaAntes && envAltaAntes.estado === ESTADO.PENDIENTE && envAltaAntes.intentos === 0 && !envAltaAntes.enviado_at,
     'precondición: el alta está encolada pero NO ha salido nunca hacia la AEAT (0 intentos, sin fecha de envío)');
  const anulP = anularInvoice(db, fPendiente.id, 'Prueba — alta sin enviar');
  detenerTodo();
  const regAnulP = db.prepare('SELECT * FROM verifactu_registros WHERE id=?').get(anulP.registro_id);
  const envAnulP = getEnvio(db, anulP.registro_id);
  ok(regAnulP && regAnulP.record_type === 'anulacion', 'se genera el registro de ANULACIÓN en local');
  ok(!!envAnulP && envAnulP.estado === ESTADO.PENDIENTE, 'queda ENCOLADA (fila de envío en pendiente)');
  ok(!!envAnulP.next_retry_at, 'la cola es dueña de la fila (next_retry_at puesto)');
  ok(/espera en la cola/i.test(envAnulP.aviso || ''), 'y dice por qué espera, en el propio registro de envío');
  // LA PUERTA: está en la cola, pero NADIE se la lleva mientras su alta no conste aceptada.
  ok(!reclamar(db, Date.now()).includes(anulP.registro_id), 'PRECEDENCIA: el reclamo NO se la lleva mientras el alta no esté aceptada');
  ok(sobres.length === 0, 'y no ha salido ni un sobre hacia la AEAT');
  // Ahora se acepta el alta: la anulación tiene que hacerse elegible SOLA, sin soltarla a mano.
  const eAltaP = await enviarRegistro(db, regDe(fPendiente.id, 'alta').id, sim);
  ok(eAltaP.estado === ESTADO.CORRECTO, 'se remite el alta y la AEAT la acepta');
  ok(reclamar(db, Date.now()).includes(anulP.registro_id), 'en cuanto el alta consta aceptada, el reclamo SÍ se lleva la anulación (sin paso de liberación)');

  console.log('\n=== 2 · Los cuatro datos identificativos, dentro del registro ===\n');
  const original = db.prepare('SELECT * FROM invoices WHERE id=?').get(fPendiente.id);
  ok(regAnulP.id_emisor === NIF_EMPRESA, '1/4 · NIF del emisor');
  ok(regAnulP.num_serie === original.invoice_number, '2/4 · serie y número de la factura anulada');
  ok(regAnulP.fecha_expedicion === toFechaExpedicion(original.issue_date), '3/4 · fecha de EMISIÓN de la factura anulada (la de la original, no la de hoy)');
  ok(esFechaAeat(regAnulP.fecha_expedicion), '     …y en el formato DD-MM-YYYY que exige sf:fecha');
  ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(regAnulP.fecha_hora_huso || ''), '4/4 · fecha en que se ANULA (FechaHoraHusoGenRegistro, ISO-8601 con huso)');
  // La fecha de anulación es la de HOY, no la de la factura: es lo que la distingue del dato 3.
  ok(regAnulP.fecha_hora_huso.slice(0, 10) !== original.issue_date.slice(0, 10), '     …y es la fecha de la ANULACIÓN, distinta de la de emisión de la factura');

  console.log('\n=== 3 · Encadenada de verdad: la huella se recalcula y cuadra ===\n');
  const previo = db.prepare('SELECT * FROM verifactu_registros WHERE id < ? AND id_emisor = ? ORDER BY id DESC LIMIT 1').get(regAnulP.id, NIF_EMPRESA);
  ok(!!previo && regAnulP.prev_huella === previo.huella, 'prev_huella = huella del registro INMEDIATAMENTE anterior de la cadena');
  const recalculada = anulacionHuella({
    idEmisor: regAnulP.id_emisor, numSerie: regAnulP.num_serie, fechaExpedicion: regAnulP.fecha_expedicion,
    prevHuella: regAnulP.prev_huella, fechaHoraHuso: regAnulP.fecha_hora_huso,
  });
  ok(recalculada === regAnulP.huella, 'la huella guardada es EXACTAMENTE la que sale de recalcularla (no es un campo suelto)');
  ok(regAnulP.id_emisor === previo.id_emisor, 'la cadena va por NIF: enlaza con un registro del MISMO emisor');

  console.log('\n=== 4 · La cadena de ALTAS sale idéntica antes y después ===\n');
  ok(JSON.stringify(cadenaAltas()) === JSON.stringify(CADENA_ANTES), 'ni un campo de la cadena de altas se ha movido al anular');
  ok(db.prepare('SELECT COUNT(*) c FROM invoices').get().c === FACTURAS_ANTES, 'cero facturas creadas o borradas');
  ok(db.prepare("SELECT COUNT(*) c FROM invoices WHERE id=?").get(fPendiente.id).c === 1, 'la factura original sigue existiendo (se marca, no se borra)');

  console.log('\n=== 5 · Alta ENVIADA Y ACEPTADA → se encola normalmente ===\n');
  const regAltaA = regDe(fAceptada.id, 'alta');
  await enviarRegistro(db, regAltaA.id, sim);
  ok(getEnvio(db, regAltaA.id).estado === ESTADO.CORRECTO, 'precondición: la AEAT ya aceptó el alta');
  const anulA = anularInvoice(db, fAceptada.id, 'Prueba — alta aceptada');
  detenerTodo();
  const resA = { env: getEnvio(db, anulA.registro_id) };
  ok(!!resA.env && resA.env.estado === ESTADO.PENDIENTE && !!resA.env.next_retry_at, 'la anulación se encola');
  ok(reclamar(db, Date.now()).includes(anulA.registro_id), 'y es elegible YA (su alta ya consta en la AEAT)');

  console.log('\n=== 6 · Alta RECHAZADA por la AEAT → se anota y NO se encola ===\n');
  const regAltaR = regDe(fRechazada.id, 'alta');
  veredicto.set(db.prepare('SELECT num_serie FROM verifactu_registros WHERE id=?').get(regAltaR.id).num_serie + '|Alta', '1239');
  const eAltaR = await enviarRegistro(db, regAltaR.id, sim);
  ok(eAltaR.estado === ESTADO.INCORRECTO, 'precondición: la AEAT rechazó el alta');
  const anulR = anularInvoice(db, fRechazada.id, 'Prueba — alta rechazada');
  detenerTodo();
  const envAnulR = getEnvio(db, anulR.registro_id);
  ok(!!db.prepare('SELECT id FROM verifactu_registros WHERE id=?').get(anulR.registro_id), 'la anulación SÍ se registra y encadena en local');
  ok(envAnulR.estado === ESTADO.BLOQUEADO, 'pero su envío queda BLOQUEADO (no hay nada que anular en la AEAT)');
  ok(/rechaz/i.test(envAnulR.aviso || ''), 'y queda ANOTADO el motivo');
  ok(envAnulR.next_retry_at === null, 'la cola NO es dueña de la fila (next_retry_at nulo)');
  ok(!reclamar(db, Date.now()).includes(anulR.registro_id), 'el reclamo nunca se la lleva');

  console.log('\n=== 7 · YA ANULADA → se rechaza el intento ===\n');
  anularInvoice(db, fDoble.id, 'Prueba — primera anulación');
  detenerTodo();
  const nAnulAntes = db.prepare("SELECT COUNT(*) c FROM verifactu_registros WHERE invoice_id=? AND record_type='anulacion'").get(fDoble.id).c;
  let saltó = false;
  try { anularInvoice(db, fDoble.id, 'Prueba — segunda anulación'); } catch (e) { saltó = /solo se puede anular una factura emitida/i.test(e.message); }
  ok(saltó, 'anular por segunda vez lanza y no deja continuar');
  ok(db.prepare("SELECT COUNT(*) c FROM verifactu_registros WHERE invoice_id=? AND record_type='anulacion'").get(fDoble.id).c === nAnulAntes, 'y NO se crea un segundo registro de anulación');
  ok(db.prepare("SELECT COUNT(*) c FROM invoice_anulaciones WHERE invoice_id=?").get(fDoble.id).c === 1, 'un solo asiento de anulación para esa factura');

  console.log('\n=== 8 · El XML de la anulación cumple el esquema oficial ===\n');
  const xmlAnul = buildRegistroAnulacion({ registro: regAnulP, prevRegistro: previo, sistemaInfo: SI });
  ok(!xmlAnul.bloqueado, 'con los datos completos, no se bloquea');
  const x = xmlAnul.xml;
  ok(x.startsWith('<sf:RegistroAnulacion>') && x.endsWith('</sf:RegistroAnulacion>'), 'es un <sf:RegistroAnulacion> (elemento global del XSD)');
  ok(x.includes('<sf:IDEmisorFacturaAnulada>' + NIF_EMPRESA + '</sf:IDEmisorFacturaAnulada>'), 'IDEmisorFacturaAnulada (nombre propio de la baja, no el del alta)');
  ok(x.includes('<sf:NumSerieFacturaAnulada>' + regAnulP.num_serie + '</sf:NumSerieFacturaAnulada>'), 'NumSerieFacturaAnulada');
  ok(x.includes('<sf:FechaExpedicionFacturaAnulada>' + regAnulP.fecha_expedicion + '</sf:FechaExpedicionFacturaAnulada>'), 'FechaExpedicionFacturaAnulada');
  ok(x.includes('<sf:Huella>' + regAnulP.huella + '</sf:Huella>') && x.includes('<sf:FechaHoraHusoGenRegistro>' + regAnulP.fecha_hora_huso + '</sf:FechaHoraHusoGenRegistro>'), 'lleva la huella y la marca de tiempo CONGELADAS (no re-derivadas)');
  // Lo que NO debe llevar: son los campos del alta, y meterlos rompe el esquema de la baja.
  for (const prohibido of ['Desglose', 'CuotaTotal', 'ImporteTotal', 'TipoFactura', 'Destinatarios', 'NombreRazonEmisor'])
    ok(!x.includes('<sf:' + prohibido + '>'), 'NO lleva ' + prohibido + ' (es del alta, no de la baja)');
  ok(!x.includes('SinRegistroPrevio'), 'NO lleva SinRegistroPrevio (decisión del dueño: la anulación espera a su alta)');
  // Orden de la secuencia del XSD: IDVersion → IDFactura → Encadenamiento → SistemaInformatico →
  // FechaHoraHusoGenRegistro → TipoHuella → Huella.
  // Hay que VACIAR antes Encadenamiento y SistemaInformatico: los dos llevan dentro etiquetas que se
  // llaman igual que hijos de arriba (<sf:Huella>, <sf:NIF>), y buscarlas a pelo caza la de dentro y
  // mide otra cosa. Se compara la secuencia COMPLETA, no que los índices crezcan.
  const plano = x
    .replace(/<sf:Encadenamiento>[\s\S]*?<\/sf:Encadenamiento>/, '<sf:Encadenamiento/>')
    .replace(/<sf:SistemaInformatico>[\s\S]*?<\/sf:SistemaInformatico>/, '<sf:SistemaInformatico/>');
  const ESPERADO = ['IDVersion', 'IDFactura', 'Encadenamiento', 'SistemaInformatico', 'FechaHoraHusoGenRegistro', 'TipoHuella', 'Huella'];
  const hijos = [...plano.matchAll(/<sf:([A-Za-z]+)[>/]/g)].map(m => m[1]).filter(t => ESPERADO.includes(t));
  ok(JSON.stringify(hijos) === JSON.stringify(ESPERADO), 'los elementos van en el ORDEN EXACTO de RegistroFacturacionAnulacionType (' + hijos.join(' → ') + ')');

  console.log('\n=== 9 · LA GUARDA DE FECHA: dd-mm-yyyy, y el ISO se PARA (no se convierte) ===\n');
  // El aviso que circulaba —"la anulación solo admite el formato internacional año-mes-día"— es falso:
  // sf:fecha es <length 10> + <pattern \d{2,2}-\d{2,2}-\d{4,4}> y lo usan igual el alta y la anulación.
  // Convertir a ISO habría provocado el 4102 en TODAS las anulaciones. Aquí se comprueba las dos caras.
  ok(esFechaAeat('23-06-2026') && !esFechaAeat('2026-06-23'), 'la guarda acepta DD-MM-YYYY y rechaza el ISO año-mes-día');
  const enIso = buildRegistroAnulacion({ registro: { ...regAnulP, fecha_expedicion: '2026-06-23' }, prevRegistro: previo, sistemaInfo: SI });
  ok(enIso.bloqueado, 'un registro con la fecha en ISO se BLOQUEA: no se manda un XML que la AEAT va a rechazar');
  ok(enIso.avisos.some(a => /DD-MM-YYYY/.test(a) && /4102/.test(a)), 'y el aviso dice el formato correcto y el error que evitaría');
  ok(x.includes('<sf:FechaExpedicionFacturaAnulada>' + toFechaExpedicion(original.issue_date) + '</sf:FechaExpedicionFacturaAnulada>'), 'el XML que SÍ sale lleva la fecha en DD-MM-YYYY, no en ISO');
  const sinFecha = buildRegistroAnulacion({ registro: { ...regAnulP, fecha_expedicion: '' }, prevRegistro: previo, sistemaInfo: SI });
  ok(sinFecha.bloqueado && sinFecha.avisos.some(a => /fecha de emisión/i.test(a)), 'y si falta del todo, también se para (los cuatro datos son sin excepción)');
  for (const [campo, etiqueta] of [['id_emisor', 'NIF del emisor'], ['num_serie', 'serie y número'], ['fecha_hora_huso', 'fecha y hora de la anulación']]) {
    const r = buildRegistroAnulacion({ registro: { ...regAnulP, [campo]: '' }, prevRegistro: previo, sistemaInfo: SI });
    ok(r.bloqueado, 'sin ' + etiqueta + ' el registro no sale');
  }

  console.log('\n=== 10 · Alta y anulación en el MISMO sobre: cada una con SU respuesta ===\n');
  // Comparten NumSerieFactura. Emparejar por serie sola cruzaba los estados y cada fila se quedaba
  // con el de la otra. El desempate es Operacion/TipoOperacion. Se fuerza el choque a propósito:
  // se manda el alta y su anulación juntas, y se hace que la AEAT acepte una y rechace la otra.
  const anulJ = anularInvoice(db, fJuntas.id, 'Prueba — las dos en un sobre');
  detenerTodo();
  const regAltaJ = regDe(fJuntas.id, 'alta');
  const serieJ = regAltaJ.num_serie;
  ok(db.prepare('SELECT num_serie FROM verifactu_registros WHERE id=?').get(anulJ.registro_id).num_serie === serieJ, 'precondición: el alta y su anulación llevan el MISMO número de serie');
  veredicto.set(serieJ + '|Anulacion', '3001');          // la AEAT acepta el alta y rechaza la anulación
  const sobresAntes = sobres.length;
  await enviarLote(db, [regAltaJ.id, anulJ.registro_id], sim);
  ok(sobres.length === sobresAntes + 1 && sobres.at(-1).regs.length === 2, 'las dos viajan en UN solo sobre');
  const envAltaJ = getEnvio(db, regAltaJ.id), envAnulJ = getEnvio(db, anulJ.registro_id);
  ok(envAltaJ.estado === ESTADO.CORRECTO, 'el ALTA se queda con SU respuesta (aceptada)');
  ok(envAnulJ.estado === ESTADO.INCORRECTO && envAnulJ.codigo_error === '3001', 'la ANULACIÓN se queda con SU respuesta (rechazada 3001) — no con la del alta');
  ok(/Anulacion/.test(envAnulJ.response_xml || '') && !/Anulacion/.test(envAltaJ.response_xml || ''), 'y el trozo de respuesta guardado en cada fila es el suyo');

  console.log('\n=== 11 · Nada se ha encendido ni se ha perdido por el camino ===\n');
  ok(JSON.stringify(cadenaAltas()) === JSON.stringify(CADENA_ANTES), 'después de TODO lo anterior, la cadena de altas sigue idéntica');
  ok(db.prepare('SELECT COUNT(*) c FROM invoices').get().c === FACTURAS_ANTES, 'cero facturas borradas en toda la comprobación');
  const anuladas = db.prepare("SELECT COUNT(*) c FROM invoices WHERE status='anulada'").get().c;
  ok(anuladas === db.prepare("SELECT COUNT(*) c FROM verifactu_registros WHERE record_type='anulacion'").get().c, 'una anulación del producto = un registro de anulación (' + anuladas + ' y ' + anuladas + ')');
  ok(sobres.every(s => s.regs.length > 0), 'no se ha mandado ningún sobre vacío');

} catch (e) { console.error('ERROR', e.stack || e.message); fail++; } finally {
  detenerTodo();
  server.close();
  db.close();
  try { (await import('fs')).unlinkSync(DBF); } catch {}
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
